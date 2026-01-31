/**
 * TestACPAgent - Mock ACP agent for unit testing.
 *
 * Provides a lightweight mock for testing ACP client code without
 * needing a full MAP server or real agent implementation.
 *
 * @module
 */

import { EventEmitter } from "events";
import type {
  ACPSessionId,
  ACPRequestId,
  ACPAgentHandler,
  ACPInitializeRequest,
  ACPInitializeResponse,
  ACPAuthenticateRequest,
  ACPAuthenticateResponse,
  ACPNewSessionRequest,
  ACPNewSessionResponse,
  ACPLoadSessionRequest,
  ACPLoadSessionResponse,
  ACPSetSessionModeRequest,
  ACPSetSessionModeResponse,
  ACPPromptRequest,
  ACPPromptResponse,
  ACPCancelNotification,
  ACPSessionNotification,
  ACPAgentCapabilities,
  ACPRequestPermissionRequest,
  ACPRequestPermissionResponse,
  ACPReadTextFileRequest,
  ACPReadTextFileResponse,
  ACPWriteTextFileRequest,
  ACPWriteTextFileResponse,
  ACPCreateTerminalRequest,
  ACPCreateTerminalResponse,
  ACPTerminalOutputRequest,
  ACPTerminalOutputResponse,
  ACPReleaseTerminalRequest,
  ACPReleaseTerminalResponse,
  ACPWaitForTerminalExitRequest,
  ACPWaitForTerminalExitResponse,
  ACPKillTerminalCommandRequest,
  ACPKillTerminalCommandResponse,
  ACPEnvelope,
  ACPContext,
} from "../acp/types";
import { ACPError, ACP_METHODS, ACP_PROTOCOL_VERSION } from "../acp/types";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for TestACPAgent
 */
export interface TestACPAgentOptions {
  /** Custom handler implementations (partial) */
  handlers?: Partial<ACPAgentHandler>;
  /** Default delay for simulating async operations (ms) */
  defaultDelay?: number;
  /** Agent capabilities to advertise */
  capabilities?: ACPAgentCapabilities;
  /** Simulate errors for specific methods */
  errorOnMethod?: Record<string, { code: number; message: string }>;
}

/**
 * Context for handler methods
 */
interface MockContext {
  streamId: string;
  sessionId: ACPSessionId | null;
  clientId: string;
}

/**
 * Received request tracking
 */
interface ReceivedRequest {
  method: string;
  params: unknown;
  timestamp: number;
  streamId: string;
}

/**
 * Pending client request for request/response correlation
 */
interface PendingClientRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

// =============================================================================
// TestACPAgent
// =============================================================================

/**
 * Mock ACP agent for unit testing.
 *
 * Allows testing ACP client code without a real server or agent.
 * Provides configurable handlers, delay simulation, and error injection.
 *
 * @example
 * ```typescript
 * const mockAgent = new TestACPAgent({
 *   handlers: {
 *     prompt: async (params) => {
 *       // Simulate streaming updates
 *       mockAgent.sendSessionUpdate(streamId, {
 *         sessionId: params.sessionId,
 *         update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello!' } }
 *       });
 *       return { stopReason: 'end_turn' };
 *     }
 *   }
 * });
 *
 * // Connect to the mock agent
 * const stream = mockAgent.createMockStream('client-1');
 *
 * // Process a request
 * const response = await stream.request('initialize', { protocolVersion: 20241007 });
 * ```
 */
export class TestACPAgent extends EventEmitter {
  readonly #options: TestACPAgentOptions;
  readonly #sessions: Map<ACPSessionId, { streamId: string; createdAt: Date }> = new Map();
  readonly #receivedRequests: ReceivedRequest[] = [];
  readonly #pendingClientRequests: Map<string, PendingClientRequest> = new Map();
  readonly #streamContexts: Map<string, { clientId: string; sessionId: ACPSessionId | null }> = new Map();

  #requestIdCounter = 0;
  #sessionIdCounter = 0;

  constructor(options: TestACPAgentOptions = {}) {
    super();
    this.#options = options;
  }

  // ===========================================================================
  // Properties
  // ===========================================================================

  /** All requests received by this mock agent */
  get receivedRequests(): readonly ReceivedRequest[] {
    return this.#receivedRequests;
  }

  /** Active sessions */
  get sessions(): ReadonlyMap<ACPSessionId, { streamId: string; createdAt: Date }> {
    return this.#sessions;
  }

  /** Clear received requests */
  clearRequests(): void {
    this.#receivedRequests.length = 0;
  }

  // ===========================================================================
  // Mock Stream Creation
  // ===========================================================================

  /**
   * Create a mock stream interface for testing.
   *
   * Returns an object that simulates the ACP stream from the client's perspective.
   */
  createMockStream(clientId: string): MockACPStream {
    const streamId = `mock-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    this.#streamContexts.set(streamId, { clientId, sessionId: null });

    return new MockACPStream(this, streamId, clientId);
  }

  // ===========================================================================
  // Request Processing
  // ===========================================================================

  /**
   * Process an incoming ACP request.
   * Called by MockACPStream when a request is made.
   */
  async processRequest(
    streamId: string,
    method: string,
    params: unknown
  ): Promise<unknown> {
    // Track the request
    this.#receivedRequests.push({
      method,
      params,
      timestamp: Date.now(),
      streamId,
    });

    // Simulate delay if configured
    const delay = this.#options.defaultDelay;
    if (delay && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Check for error injection
    const errorConfig = this.#options.errorOnMethod?.[method];
    if (errorConfig) {
      throw new ACPError(errorConfig.code, errorConfig.message);
    }

    // Get context
    const ctx = this.#getContext(streamId);

    // Route to handler
    switch (method) {
      case ACP_METHODS.INITIALIZE:
        return this.#handleInitialize(params as ACPInitializeRequest, ctx);
      case ACP_METHODS.AUTHENTICATE:
        return this.#handleAuthenticate(params as ACPAuthenticateRequest, ctx);
      case ACP_METHODS.SESSION_NEW:
        return this.#handleNewSession(params as ACPNewSessionRequest, ctx);
      case ACP_METHODS.SESSION_LOAD:
        return this.#handleLoadSession(params as ACPLoadSessionRequest, ctx);
      case ACP_METHODS.SESSION_SET_MODE:
        return this.#handleSetSessionMode(params as ACPSetSessionModeRequest, ctx);
      case ACP_METHODS.SESSION_PROMPT:
        return this.#handlePrompt(params as ACPPromptRequest, ctx);
      case ACP_METHODS.SESSION_CANCEL:
        await this.#handleCancel(params as ACPCancelNotification, ctx);
        return undefined; // Notification, no response
      default:
        throw new ACPError(-32601, `Unknown method: ${method}`);
    }
  }

  /**
   * Process a client response to an agent request.
   */
  processClientResponse(requestId: string, result?: unknown, error?: ACPError): void {
    const pending = this.#pendingClientRequests.get(requestId);
    if (!pending) return;

    this.#pendingClientRequests.delete(requestId);

    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(result);
    }
  }

  // ===========================================================================
  // Agent → Client Communication
  // ===========================================================================

  /**
   * Send a session update notification to the client.
   */
  sendSessionUpdate(streamId: string, notification: ACPSessionNotification): void {
    const envelope: ACPEnvelope = {
      acp: {
        jsonrpc: "2.0",
        method: ACP_METHODS.SESSION_UPDATE,
        params: notification,
      },
      acpContext: this.#createContext(streamId, "agent-to-client"),
    };

    this.emit("send", streamId, envelope);
  }

  /**
   * Send a request to the client and wait for response.
   */
  async sendClientRequest<TParams, TResult>(
    streamId: string,
    method: string,
    params: TParams
  ): Promise<TResult> {
    const requestId = `agent-req-${++this.#requestIdCounter}`;

    const envelope: ACPEnvelope = {
      acp: {
        jsonrpc: "2.0",
        id: requestId,
        method,
        params: params as unknown,
      },
      acpContext: {
        ...this.#createContext(streamId, "agent-to-client"),
        pendingClientRequest: {
          requestId,
          method,
          timeout: 30000,
        },
      },
    };

    // Register pending request BEFORE emitting (in case response is synchronous)
    const promise = new Promise<TResult>((resolve, reject) => {
      this.#pendingClientRequests.set(requestId, {
        resolve: resolve as (result: unknown) => void,
        reject,
        method,
      });
    });

    this.emit("send", streamId, envelope);

    return promise;
  }

  /**
   * Request permission from the client.
   */
  async requestPermission(
    streamId: string,
    request: ACPRequestPermissionRequest
  ): Promise<ACPRequestPermissionResponse> {
    return this.sendClientRequest(streamId, ACP_METHODS.REQUEST_PERMISSION, request);
  }

  /**
   * Read a text file from the client.
   */
  async readTextFile(
    streamId: string,
    request: ACPReadTextFileRequest
  ): Promise<ACPReadTextFileResponse> {
    return this.sendClientRequest(streamId, ACP_METHODS.FS_READ_TEXT_FILE, request);
  }

  /**
   * Write a text file on the client.
   */
  async writeTextFile(
    streamId: string,
    request: ACPWriteTextFileRequest
  ): Promise<ACPWriteTextFileResponse> {
    return this.sendClientRequest(streamId, ACP_METHODS.FS_WRITE_TEXT_FILE, request);
  }

  /**
   * Create a terminal on the client.
   */
  async createTerminal(
    streamId: string,
    request: ACPCreateTerminalRequest
  ): Promise<ACPCreateTerminalResponse> {
    return this.sendClientRequest(streamId, ACP_METHODS.TERMINAL_CREATE, request);
  }

  /**
   * Get terminal output from the client.
   */
  async terminalOutput(
    streamId: string,
    request: ACPTerminalOutputRequest
  ): Promise<ACPTerminalOutputResponse> {
    return this.sendClientRequest(streamId, ACP_METHODS.TERMINAL_OUTPUT, request);
  }

  /**
   * Release a terminal on the client.
   */
  async releaseTerminal(
    streamId: string,
    request: ACPReleaseTerminalRequest
  ): Promise<ACPReleaseTerminalResponse> {
    return this.sendClientRequest(streamId, ACP_METHODS.TERMINAL_RELEASE, request);
  }

  /**
   * Wait for terminal exit on the client.
   */
  async waitForTerminalExit(
    streamId: string,
    request: ACPWaitForTerminalExitRequest
  ): Promise<ACPWaitForTerminalExitResponse> {
    return this.sendClientRequest(streamId, ACP_METHODS.TERMINAL_WAIT_FOR_EXIT, request);
  }

  /**
   * Kill a terminal on the client.
   */
  async killTerminal(
    streamId: string,
    request: ACPKillTerminalCommandRequest
  ): Promise<ACPKillTerminalCommandResponse> {
    return this.sendClientRequest(streamId, ACP_METHODS.TERMINAL_KILL, request);
  }

  // ===========================================================================
  // Handler Implementations
  // ===========================================================================

  #getContext(streamId: string): MockContext {
    const streamCtx = this.#streamContexts.get(streamId);
    return {
      streamId,
      sessionId: streamCtx?.sessionId ?? null,
      clientId: streamCtx?.clientId ?? "unknown",
    };
  }

  #createContext(streamId: string, direction: "client-to-agent" | "agent-to-client"): ACPContext {
    const streamCtx = this.#streamContexts.get(streamId);
    return {
      streamId,
      sessionId: streamCtx?.sessionId ?? null,
      direction,
    };
  }

  async #handleInitialize(
    params: ACPInitializeRequest,
    ctx: MockContext
  ): Promise<ACPInitializeResponse> {
    if (this.#options.handlers?.initialize) {
      return this.#options.handlers.initialize(params, {
        streamId: ctx.streamId,
        sessionId: ctx.sessionId,
        clientParticipantId: ctx.clientId,
      });
    }

    // Default implementation
    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentInfo: {
        name: "TestACPAgent",
        version: "1.0.0",
      },
      agentCapabilities: this.#options.capabilities ?? {
        loadSession: true,
      },
    };
  }

  async #handleAuthenticate(
    params: ACPAuthenticateRequest,
    ctx: MockContext
  ): Promise<ACPAuthenticateResponse> {
    if (this.#options.handlers?.authenticate) {
      return this.#options.handlers.authenticate(params, {
        streamId: ctx.streamId,
        sessionId: ctx.sessionId,
        clientParticipantId: ctx.clientId,
      });
    }

    // Default implementation - accept any auth
    return {};
  }

  async #handleNewSession(
    params: ACPNewSessionRequest,
    ctx: MockContext
  ): Promise<ACPNewSessionResponse> {
    if (this.#options.handlers?.newSession) {
      const result = await this.#options.handlers.newSession(params, {
        streamId: ctx.streamId,
        sessionId: ctx.sessionId,
        clientParticipantId: ctx.clientId,
      });

      // Track session
      this.#sessions.set(result.sessionId, {
        streamId: ctx.streamId,
        createdAt: new Date(),
      });

      // Update stream context
      const streamCtx = this.#streamContexts.get(ctx.streamId);
      if (streamCtx) {
        streamCtx.sessionId = result.sessionId;
      }

      return result;
    }

    // Default implementation
    const sessionId = `test-session-${++this.#sessionIdCounter}` as ACPSessionId;
    this.#sessions.set(sessionId, {
      streamId: ctx.streamId,
      createdAt: new Date(),
    });

    // Update stream context
    const streamCtx = this.#streamContexts.get(ctx.streamId);
    if (streamCtx) {
      streamCtx.sessionId = sessionId;
    }

    return { sessionId };
  }

  async #handleLoadSession(
    params: ACPLoadSessionRequest,
    ctx: MockContext
  ): Promise<ACPLoadSessionResponse> {
    if (this.#options.handlers?.loadSession) {
      return this.#options.handlers.loadSession(params, {
        streamId: ctx.streamId,
        sessionId: ctx.sessionId,
        clientParticipantId: ctx.clientId,
      });
    }

    // Default implementation - check if session exists
    if (!this.#sessions.has(params.sessionId)) {
      throw new ACPError(-32002, `Session not found: ${params.sessionId}`);
    }

    // Update stream context
    const streamCtx = this.#streamContexts.get(ctx.streamId);
    if (streamCtx) {
      streamCtx.sessionId = params.sessionId;
    }

    return {};
  }

  async #handleSetSessionMode(
    params: ACPSetSessionModeRequest,
    ctx: MockContext
  ): Promise<ACPSetSessionModeResponse> {
    if (this.#options.handlers?.setSessionMode) {
      return this.#options.handlers.setSessionMode(params, {
        streamId: ctx.streamId,
        sessionId: ctx.sessionId,
        clientParticipantId: ctx.clientId,
      });
    }

    // Default implementation - just acknowledge
    // The actual mode state would be tracked by the agent
    void params.modeId; // Acknowledge we received the mode
    return {};
  }

  async #handlePrompt(
    params: ACPPromptRequest,
    ctx: MockContext
  ): Promise<ACPPromptResponse> {
    if (this.#options.handlers?.prompt) {
      return this.#options.handlers.prompt(params, {
        streamId: ctx.streamId,
        sessionId: ctx.sessionId,
        clientParticipantId: ctx.clientId,
      });
    }

    // Default implementation - simple echo
    this.sendSessionUpdate(ctx.streamId, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "Mock response",
        },
      },
    });

    return {
      stopReason: "end_turn",
    };
  }

  async #handleCancel(
    params: ACPCancelNotification,
    ctx: MockContext
  ): Promise<void> {
    if (this.#options.handlers?.cancel) {
      await this.#options.handlers.cancel(params, {
        streamId: ctx.streamId,
        sessionId: ctx.sessionId,
        clientParticipantId: ctx.clientId,
      });
    }

    // Default: just emit event for tracking
    this.emit("cancel", ctx.streamId, params);
  }
}

// =============================================================================
// MockACPStream
// =============================================================================

/**
 * Mock ACP stream for client-side testing.
 *
 * Simulates the ACPStreamConnection interface without a real MAP connection.
 */
export class MockACPStream extends EventEmitter {
  readonly #agent: TestACPAgent;
  readonly #streamId: string;
  readonly #clientId: string;

  #sessionId: ACPSessionId | null = null;
  #initialized = false;

  constructor(agent: TestACPAgent, streamId: string, clientId: string) {
    super();
    this.#agent = agent;
    this.#streamId = streamId;
    this.#clientId = clientId;

    // Listen for messages from agent
    agent.on("send", (targetStreamId: string, envelope: ACPEnvelope) => {
      if (targetStreamId === streamId) {
        this.#handleAgentMessage(envelope);
      }
    });
  }

  /** Stream ID */
  get streamId(): string {
    return this.#streamId;
  }

  /** Client ID */
  get clientId(): string {
    return this.#clientId;
  }

  /** Current session ID */
  get sessionId(): ACPSessionId | null {
    return this.#sessionId;
  }

  /** Whether initialized */
  get initialized(): boolean {
    return this.#initialized;
  }

  /**
   * Send a request to the mock agent.
   */
  async request<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    const result = await this.#agent.processRequest(this.#streamId, method, params);
    return result as TResult;
  }

  /**
   * Initialize the ACP connection.
   */
  async initialize(params: ACPInitializeRequest): Promise<ACPInitializeResponse> {
    const result = await this.request<ACPInitializeResponse>(ACP_METHODS.INITIALIZE, params);
    this.#initialized = true;
    return result;
  }

  /**
   * Authenticate with the agent.
   */
  async authenticate(params: ACPAuthenticateRequest): Promise<ACPAuthenticateResponse> {
    return this.request<ACPAuthenticateResponse>(ACP_METHODS.AUTHENTICATE, params);
  }

  /**
   * Create a new session.
   */
  async newSession(params: ACPNewSessionRequest): Promise<ACPNewSessionResponse> {
    const result = await this.request<ACPNewSessionResponse>(ACP_METHODS.SESSION_NEW, params);
    this.#sessionId = result.sessionId;
    return result;
  }

  /**
   * Load an existing session.
   */
  async loadSession(params: ACPLoadSessionRequest): Promise<ACPLoadSessionResponse> {
    const result = await this.request<ACPLoadSessionResponse>(ACP_METHODS.SESSION_LOAD, params);
    this.#sessionId = params.sessionId;
    return result;
  }

  /**
   * Set session mode.
   */
  async setSessionMode(params: ACPSetSessionModeRequest): Promise<ACPSetSessionModeResponse> {
    return this.request<ACPSetSessionModeResponse>(ACP_METHODS.SESSION_SET_MODE, params);
  }

  /**
   * Send a prompt.
   */
  async prompt(params: ACPPromptRequest): Promise<ACPPromptResponse> {
    return this.request<ACPPromptResponse>(ACP_METHODS.SESSION_PROMPT, params);
  }

  /**
   * Cancel current operation.
   */
  async cancel(params?: Partial<ACPCancelNotification>): Promise<void> {
    await this.request(ACP_METHODS.SESSION_CANCEL, {
      sessionId: this.#sessionId,
      ...params,
    });
  }

  /**
   * Close the stream.
   */
  close(): void {
    this.emit("close");
  }

  /**
   * Handle incoming message from agent.
   */
  #handleAgentMessage(envelope: ACPEnvelope): void {
    const { acp, acpContext } = envelope;

    // Handle notification (no id, has method)
    if (acp.method && acp.id === undefined) {
      if (acp.method === ACP_METHODS.SESSION_UPDATE) {
        this.emit("sessionUpdate", acp.params);
      }
      return;
    }

    // Handle agent → client request (has id and method)
    if (acp.method && acp.id !== undefined) {
      this.emit("agentRequest", {
        requestId: acp.id,
        method: acp.method,
        params: acp.params,
        context: acpContext,
      });
    }
  }

  /**
   * Respond to an agent request.
   */
  respondToAgent(requestId: ACPRequestId, result?: unknown, error?: ACPError): void {
    this.#agent.processClientResponse(String(requestId), result, error);
  }
}

// =============================================================================
// Integration Testing Helpers
// =============================================================================

import type { TestServer } from "./server";
import { TestAgent, type TestAgentOptions } from "./agent";
import { ACPAgentAdapter } from "../acp/adapter";
import type { ACPCapability } from "../types";

/**
 * Options for creating an ACP-enabled test agent for integration testing.
 */
export interface ACPTestAgentOptions extends Omit<TestAgentOptions, "capabilities"> {
  /** ACP handler implementation */
  handler: ACPAgentHandler;
  /** ACP capability metadata */
  acpCapability?: ACPCapability;
  /** Additional agent capabilities */
  capabilities?: TestAgentOptions["capabilities"];
}

/**
 * Result of creating an ACP test agent.
 */
export interface ACPTestAgentResult {
  /** The underlying MAP test agent */
  agent: TestAgent;
  /** The ACP adapter for the agent */
  adapter: ACPAgentAdapter;
}

/**
 * Create an ACP-enabled test agent connected to a TestServer.
 *
 * This is the recommended way to integration test ACP-over-MAP flows.
 * It creates a TestAgent with ACP capability and wires it up with
 * an ACPAgentAdapter to handle ACP messages.
 *
 * @example
 * ```typescript
 * const server = new TestServer();
 *
 * const { agent, adapter } = await createACPTestAgent(server, {
 *   name: 'CodingAgent',
 *   handler: {
 *     initialize: async () => ({
 *       protocolVersion: 20241007,
 *       agentInfo: { name: 'CodingAgent', version: '1.0' },
 *     }),
 *     newSession: async () => ({ sessionId: 'session-1' }),
 *     prompt: async (params, ctx) => {
 *       // Send streaming update
 *       await adapter.sendSessionUpdate(ctx.streamId, {
 *         sessionId: params.sessionId,
 *         update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello!' } }
 *       });
 *       return { stopReason: 'end_turn' };
 *     },
 *     cancel: async () => {},
 *   },
 * });
 *
 * // Now use a TestClient to connect and create an ACP stream
 * const client = await TestClient.create(server);
 * const acp = client.connection.createACPStream({
 *   targetAgent: agent.id!,
 *   client: { ... }
 * });
 * ```
 */
export async function createACPTestAgent(
  server: TestServer,
  options: ACPTestAgentOptions
): Promise<ACPTestAgentResult> {
  const { handler, acpCapability, capabilities, ...agentOptions } = options;

  // Create the test agent with ACP capability
  const agent = await TestAgent.create(server, {
    ...agentOptions,
    capabilities: {
      ...capabilities,
      protocols: ["acp"],
      acp: acpCapability ?? {
        version: "2024-10-07",
      },
    },
  });

  // Create the ACP adapter
  const adapter = new ACPAgentAdapter(agent.connection, handler);

  return { agent, adapter };
}
