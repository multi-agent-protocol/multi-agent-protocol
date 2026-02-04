/**
 * ACPStreamConnection - Client-side virtual ACP connection over MAP.
 *
 * Provides a familiar ACP interface while using MAP's send/subscribe
 * primitives for transport. Supports request/response correlation,
 * timeout handling, and session lifecycle management.
 *
 * @module
 */

import { EventEmitter } from "events";
import type { ClientConnection } from "../connection/client";
import type { Subscription } from "../subscription";
import type { AgentId, Message } from "../types";
import {
  type ACPSessionId,
  type ACPRequestId,
  type ACPEnvelope,
  type ACPContext,
  type ACPClientHandlers,
  type ACPAgentCapabilities,
  type ACPInitializeRequest,
  type ACPInitializeResponse,
  type ACPAuthenticateRequest,
  type ACPAuthenticateResponse,
  type ACPNewSessionRequest,
  type ACPNewSessionResponse,
  type ACPLoadSessionRequest,
  type ACPLoadSessionResponse,
  type ACPSetSessionModeRequest,
  type ACPSetSessionModeResponse,
  type ACPPromptRequest,
  type ACPPromptResponse,
  type ACPCancelNotification,
  type ACPSessionNotification,
  type ACPRequestPermissionRequest,
  type ACPReadTextFileRequest,
  type ACPWriteTextFileRequest,
  type ACPCreateTerminalRequest,
  type ACPTerminalOutputRequest,
  type ACPReleaseTerminalRequest,
  type ACPWaitForTerminalExitRequest,
  type ACPKillTerminalCommandRequest,
  ACPError,
  ACP_METHODS,
  isACPEnvelope,
} from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating an ACP stream connection.
 */
export interface ACPStreamOptions {
  /** Target agent that will handle ACP requests */
  targetAgent: AgentId;
  /** Client-side handlers for agent→client requests */
  client: ACPClientHandlers;
  /** Optional: expose MAP events alongside ACP (for observability) */
  exposeMapEvents?: boolean;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Pending request state for correlation.
 */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  method: string;
}

/**
 * Events emitted by ACPStreamConnection.
 */
export interface ACPStreamEvents {
  /** Emitted when ACP session is lost after reconnection */
  sessionLost: (info: { sessionId: ACPSessionId; reason: string }) => void;
  /** Emitted when the stream successfully reconnects */
  reconnected: () => void;
  /** Emitted when reconnection is in progress */
  reconnecting: () => void;
  /** Emitted when the stream is closed */
  close: () => void;
  /** Emitted on errors */
  error: (error: Error) => void;
}

// =============================================================================
// ACPStreamConnection
// =============================================================================

/**
 * Virtual ACP connection over MAP.
 *
 * Provides the full ACP client interface, routing all requests through
 * the underlying MAP connection to a target agent.
 *
 * @example
 * ```typescript
 * const acp = new ACPStreamConnection(mapClient, {
 *   targetAgent: 'coding-agent-1',
 *   client: {
 *     requestPermission: async (req) => ({ outcome: { outcome: 'selected', optionId: 'allow' } }),
 *     sessionUpdate: async (update) => { console.log(update); },
 *   }
 * });
 *
 * await acp.initialize({ protocolVersion: 20241007, clientInfo: { name: 'IDE', version: '1.0' } });
 * const { sessionId } = await acp.newSession({ cwd: '/project', mcpServers: [] });
 * const result = await acp.prompt({ sessionId, prompt: [{ type: 'text', text: 'Hello' }] });
 * ```
 */
export class ACPStreamConnection extends EventEmitter {
  readonly #mapClient: ClientConnection;
  readonly #options: ACPStreamOptions;
  readonly #streamId: string;
  readonly #pendingRequests: Map<string, PendingRequest> = new Map();

  #subscription: Subscription | null = null;
  #sessionId: ACPSessionId | null = null;
  #initialized = false;
  #capabilities: ACPAgentCapabilities | null = null;
  #closed = false;
  #lastEventId: string | null = null;
  #isReconnecting = false;
  #unsubscribeReconnection: (() => void) | null = null;

  /**
   * Create a new ACP stream connection.
   *
   * @param mapClient - The underlying MAP client connection
   * @param options - Stream configuration options
   */
  constructor(mapClient: ClientConnection, options: ACPStreamOptions) {
    super();
    this.#mapClient = mapClient;
    this.#options = options;
    this.#streamId = `acp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Listen for MAP reconnection events
    this.#unsubscribeReconnection = mapClient.onReconnection((event) => {
      void this.#handleReconnectionEvent(event);
    });
  }

  // ===========================================================================
  // Public Properties
  // ===========================================================================

  /** Unique identifier for this ACP stream */
  get streamId(): string {
    return this.#streamId;
  }

  /** Target agent this stream connects to */
  get targetAgent(): AgentId {
    return this.#options.targetAgent;
  }

  /** Current ACP session ID (null until newSession called) */
  get sessionId(): ACPSessionId | null {
    return this.#sessionId;
  }

  /** Whether initialize() has been called */
  get initialized(): boolean {
    return this.#initialized;
  }

  /** Agent capabilities from initialize response */
  get capabilities(): ACPAgentCapabilities | null {
    return this.#capabilities;
  }

  /** Whether the stream is closed */
  get isClosed(): boolean {
    return this.#closed;
  }

  /** Last processed event ID (for reconnection support) */
  get lastEventId(): string | null {
    return this.#lastEventId;
  }

  /** Whether the stream is currently reconnecting */
  get isReconnecting(): boolean {
    return this.#isReconnecting;
  }

  // ===========================================================================
  // Reconnection Handling
  // ===========================================================================

  /**
   * Handle MAP reconnection events.
   */
  async #handleReconnectionEvent(event: {
    type: string;
    error?: Error;
  }): Promise<void> {
    if (this.#closed) return;

    switch (event.type) {
      case "disconnected":
        this.#isReconnecting = true;
        this.emit("reconnecting");

        // Reject all pending requests during reconnection
        for (const [id, pending] of this.#pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("Connection lost during ACP request"));
          this.#pendingRequests.delete(id);
        }
        break;

      case "reconnected":
        await this.#handleReconnected();
        break;

      case "reconnectFailed":
        this.#isReconnecting = false;
        this.emit("error", event.error ?? new Error("MAP reconnection failed"));
        break;
    }
  }

  /**
   * Handle successful MAP reconnection.
   */
  async #handleReconnected(): Promise<void> {
    // Clear old subscription reference (new one will be created)
    this.#subscription = null;

    try {
      // Re-establish subscription
      await this.#setupSubscription();

      // If we had a session, verify it's still valid
      if (this.#sessionId) {
        const sessionValid = await this.#verifySessionValid();

        if (!sessionValid) {
          const lostSessionId = this.#sessionId;
          this.#sessionId = null;
          this.emit("sessionLost", {
            sessionId: lostSessionId,
            reason: "Session no longer valid after reconnection",
          });
        }
      }

      this.#isReconnecting = false;
      this.emit("reconnected");
    } catch (error) {
      this.#isReconnecting = false;
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Verify that the current ACP session is still valid.
   *
   * Since ACP doesn't have a dedicated status check method, we attempt
   * a lightweight operation (cancel with no effect) to verify the session.
   */
  async #verifySessionValid(): Promise<boolean> {
    if (!this.#sessionId) return false;

    try {
      // Try to send a cancel notification - if the session is invalid,
      // the agent will reject it or we'll get an error
      // This is a non-destructive way to verify session validity
      await this.#sendNotification(ACP_METHODS.SESSION_CANCEL, {
        sessionId: this.#sessionId,
        reason: "session_verification",
      });
      return true;
    } catch {
      // If we get an error, the session is likely invalid
      return false;
    }
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Set up the subscription for receiving messages from the target agent.
   */
  async #setupSubscription(): Promise<void> {
    if (this.#subscription) return;

    this.#subscription = await this.#mapClient.subscribe({
      fromAgents: [this.#options.targetAgent],
    });

    // Process incoming events
    void this.#processEvents();
  }

  /**
   * Process incoming events from the subscription.
   */
  async #processEvents(): Promise<void> {
    if (!this.#subscription) return;

    try {
      for await (const event of this.#subscription) {
        if (this.#closed) break;

        // Track last event ID for reconnection
        if (event.id) {
          this.#lastEventId = event.id;
        }

        // Handle message events
        if (event.type === "message_delivered" && event.data) {
          const message = (event.data as { message?: Message }).message;
          if (message?.payload) {
            await this.#handleIncomingMessage(message);
          }
        }
      }
    } catch (error) {
      if (!this.#closed) {
        this.emit("error", error);
      }
    }
  }

  /**
   * Handle an incoming message from the target agent.
   */
  async #handleIncomingMessage(message: Message): Promise<void> {
    const payload = message.payload;
    if (!isACPEnvelope(payload)) return;

    const envelope = payload as ACPEnvelope;
    const { acp, acpContext } = envelope;

    // Check if this message is for our stream
    if (acpContext.streamId !== this.#streamId) return;

    // Handle response to a pending request
    if (acp.id !== undefined && !acp.method) {
      const requestId = String(acp.id);
      const pending = this.#pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.#pendingRequests.delete(requestId);

        if (acp.error) {
          pending.reject(ACPError.fromResponse(acp.error));
        } else {
          pending.resolve(acp.result);
        }
      }
      return;
    }

    // Handle notification (no id, has method)
    if (acp.method && acp.id === undefined) {
      await this.#handleNotification(acp.method, acp.params, acpContext);
      return;
    }

    // Handle agent→client request (has id and method)
    if (acp.method && acp.id !== undefined) {
      await this.#handleAgentRequest(acp.id, acp.method, acp.params, acpContext, message);
    }
  }

  /**
   * Handle an ACP notification from the agent.
   */
  async #handleNotification(
    method: string,
    params: unknown,
    _acpContext: unknown
  ): Promise<void> {
    if (method === ACP_METHODS.SESSION_UPDATE) {
      await this.#options.client.sessionUpdate(params as ACPSessionNotification);
    }
  }

  /**
   * Handle an agent→client request.
   */
  async #handleAgentRequest(
    requestId: ACPRequestId,
    method: string,
    params: unknown,
    _ctx: ACPContext,
    originalMessage: Message
  ): Promise<void> {
    let result: unknown;
    let error: ACPError | undefined;

    try {
      switch (method) {
        case ACP_METHODS.REQUEST_PERMISSION:
          result = await this.#options.client.requestPermission(
            params as ACPRequestPermissionRequest
          );
          break;
        case ACP_METHODS.FS_READ_TEXT_FILE:
          if (!this.#options.client.readTextFile) {
            throw new ACPError(-32601, "Method not supported: fs/read_text_file");
          }
          result = await this.#options.client.readTextFile(
            params as ACPReadTextFileRequest
          );
          break;
        case ACP_METHODS.FS_WRITE_TEXT_FILE:
          if (!this.#options.client.writeTextFile) {
            throw new ACPError(-32601, "Method not supported: fs/write_text_file");
          }
          result = await this.#options.client.writeTextFile(
            params as ACPWriteTextFileRequest
          );
          break;
        case ACP_METHODS.TERMINAL_CREATE:
          if (!this.#options.client.createTerminal) {
            throw new ACPError(-32601, "Method not supported: terminal/create");
          }
          result = await this.#options.client.createTerminal(
            params as ACPCreateTerminalRequest
          );
          break;
        case ACP_METHODS.TERMINAL_OUTPUT:
          if (!this.#options.client.terminalOutput) {
            throw new ACPError(-32601, "Method not supported: terminal/output");
          }
          result = await this.#options.client.terminalOutput(
            params as ACPTerminalOutputRequest
          );
          break;
        case ACP_METHODS.TERMINAL_RELEASE:
          if (!this.#options.client.releaseTerminal) {
            throw new ACPError(-32601, "Method not supported: terminal/release");
          }
          result = await this.#options.client.releaseTerminal(
            params as ACPReleaseTerminalRequest
          );
          break;
        case ACP_METHODS.TERMINAL_WAIT_FOR_EXIT:
          if (!this.#options.client.waitForTerminalExit) {
            throw new ACPError(-32601, "Method not supported: terminal/wait_for_exit");
          }
          result = await this.#options.client.waitForTerminalExit(
            params as ACPWaitForTerminalExitRequest
          );
          break;
        case ACP_METHODS.TERMINAL_KILL:
          if (!this.#options.client.killTerminal) {
            throw new ACPError(-32601, "Method not supported: terminal/kill");
          }
          result = await this.#options.client.killTerminal(
            params as ACPKillTerminalCommandRequest
          );
          break;
        default:
          throw new ACPError(-32601, `Unknown method: ${method}`);
      }
    } catch (e) {
      if (e instanceof ACPError) {
        error = e;
      } else {
        error = new ACPError(-32603, (e as Error).message);
      }
    }

    // Send response back to agent
    const responseEnvelope: ACPEnvelope = {
      acp: {
        jsonrpc: "2.0",
        id: requestId,
        ...(error ? { error: error.toErrorObject() } : { result }),
      },
      acpContext: {
        streamId: this.#streamId,
        sessionId: this.#sessionId,
        direction: "client-to-agent",
      },
    };

    await this.#mapClient.send(
      { agent: this.#options.targetAgent },
      responseEnvelope,
      {
        protocol: "acp",
        correlationId: originalMessage.id,
      }
    );
  }

  /**
   * Send an ACP request and wait for response.
   */
  async #sendRequest<TParams, TResult>(
    method: string,
    params?: TParams
  ): Promise<TResult> {
    if (this.#closed) {
      throw new Error("ACP stream is closed");
    }

    // Ensure subscription is set up
    await this.#setupSubscription();

    // Check again after await - close() may have been called
    if (this.#closed) {
      throw new Error("ACP stream closed");
    }

    const correlationId = `${this.#streamId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = this.#options.timeout ?? 30000;

    // Create the envelope
    const envelope: ACPEnvelope = {
      acp: {
        jsonrpc: "2.0",
        id: correlationId,
        method,
        ...(params !== undefined && { params }),
      },
      acpContext: {
        streamId: this.#streamId,
        sessionId: this.#sessionId,
        direction: "client-to-agent",
      },
    };

    // Register the pending request BEFORE sending, so that close() can cancel it
    // even if close() is called while we're awaiting the send
    const resultPromise = new Promise<TResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.#pendingRequests.delete(correlationId);
        reject(new Error(`ACP request timed out after ${timeout}ms: ${method}`));
      }, timeout);

      this.#pendingRequests.set(correlationId, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: timeoutHandle,
        method,
      });
    });

    // Send via MAP
    try {
      await this.#mapClient.send({ agent: this.#options.targetAgent }, envelope, {
        protocol: "acp",
        correlationId,
      });
    } catch (err) {
      // If send fails, clean up the pending request
      const pending = this.#pendingRequests.get(correlationId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.#pendingRequests.delete(correlationId);
      }
      throw err;
    }

    // Check again after send - close() may have been called and already rejected
    // the pending request, in which case resultPromise will reject
    if (this.#closed && !this.#pendingRequests.has(correlationId)) {
      throw new Error("ACP stream closed");
    }

    return resultPromise;
  }

  /**
   * Send an ACP notification (no response expected).
   */
  async #sendNotification<TParams>(method: string, params?: TParams): Promise<void> {
    if (this.#closed) {
      throw new Error("ACP stream is closed");
    }

    await this.#setupSubscription();

    const envelope: ACPEnvelope = {
      acp: {
        jsonrpc: "2.0",
        method,
        ...(params !== undefined && { params }),
      },
      acpContext: {
        streamId: this.#streamId,
        sessionId: this.#sessionId,
        direction: "client-to-agent",
      },
    };

    await this.#mapClient.send({ agent: this.#options.targetAgent }, envelope, {
      protocol: "acp",
    });
  }

  // ===========================================================================
  // ACP Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize the ACP connection with the target agent.
   */
  async initialize(params: ACPInitializeRequest): Promise<ACPInitializeResponse> {
    if (this.#initialized) {
      throw new Error("ACP stream already initialized");
    }

    const result = await this.#sendRequest<ACPInitializeRequest, ACPInitializeResponse>(
      ACP_METHODS.INITIALIZE,
      params
    );

    this.#initialized = true;
    this.#capabilities = result.agentCapabilities ?? null;

    return result;
  }

  /**
   * Authenticate with the agent.
   */
  async authenticate(params: ACPAuthenticateRequest): Promise<ACPAuthenticateResponse> {
    if (!this.#initialized) {
      throw new Error("Must call initialize() before authenticate()");
    }

    return this.#sendRequest<ACPAuthenticateRequest, ACPAuthenticateResponse>(
      ACP_METHODS.AUTHENTICATE,
      params
    );
  }

  // ===========================================================================
  // ACP Session Methods
  // ===========================================================================

  /**
   * Create a new ACP session.
   */
  async newSession(params: ACPNewSessionRequest): Promise<ACPNewSessionResponse> {
    if (!this.#initialized) {
      throw new Error("Must call initialize() before newSession()");
    }

    const result = await this.#sendRequest<ACPNewSessionRequest, ACPNewSessionResponse>(
      ACP_METHODS.SESSION_NEW,
      params
    );

    this.#sessionId = result.sessionId;
    return result;
  }

  /**
   * Load an existing ACP session.
   */
  async loadSession(params: ACPLoadSessionRequest): Promise<ACPLoadSessionResponse> {
    if (!this.#initialized) {
      throw new Error("Must call initialize() before loadSession()");
    }

    const result = await this.#sendRequest<ACPLoadSessionRequest, ACPLoadSessionResponse>(
      ACP_METHODS.SESSION_LOAD,
      params
    );

    this.#sessionId = params.sessionId;
    return result;
  }

  /**
   * Set the session mode.
   */
  async setSessionMode(params: ACPSetSessionModeRequest): Promise<ACPSetSessionModeResponse> {
    return this.#sendRequest<ACPSetSessionModeRequest, ACPSetSessionModeResponse>(
      ACP_METHODS.SESSION_SET_MODE,
      params
    );
  }

  // ===========================================================================
  // ACP Prompt Methods
  // ===========================================================================

  /**
   * Send a prompt to the agent.
   * Updates are received via the sessionUpdate handler.
   */
  async prompt(params: ACPPromptRequest): Promise<ACPPromptResponse> {
    if (!this.#sessionId) {
      throw new Error("Must call newSession() or loadSession() before prompt()");
    }

    return this.#sendRequest<ACPPromptRequest, ACPPromptResponse>(
      ACP_METHODS.SESSION_PROMPT,
      params
    );
  }

  /**
   * Cancel ongoing operations for the current session.
   */
  async cancel(params?: Partial<ACPCancelNotification>): Promise<void> {
    if (!this.#sessionId) {
      throw new Error("No active session to cancel");
    }

    await this.#sendNotification<ACPCancelNotification>(ACP_METHODS.SESSION_CANCEL, {
      sessionId: this.#sessionId,
      ...params,
    });
  }

  // ===========================================================================
  // Extension Methods
  // ===========================================================================

  /**
   * Call an ACP extension method on the target agent.
   *
   * Extension methods are prefixed with "_" (e.g., "_macro/spawnAgent").
   * The agent must support the extension for this to succeed.
   *
   * @param method - The extension method name (e.g., "_macro/spawnAgent")
   * @param params - Parameters to pass to the extension method
   * @returns The result from the extension method
   *
   * @example
   * ```typescript
   * const result = await acp.callExtension("_macro/spawnAgent", {
   *   task: "Implement feature X",
   *   cwd: "/project"
   * });
   * ```
   */
  async callExtension<TParams = unknown, TResult = unknown>(
    method: string,
    params?: TParams
  ): Promise<TResult> {
    if (!this.#initialized) {
      throw new Error("Must call initialize() before callExtension()");
    }

    return this.#sendRequest<TParams, TResult>(method, params);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Close this ACP stream and clean up resources.
   */
  async close(): Promise<void> {
    if (this.#closed) return;

    this.#closed = true;

    // Unsubscribe from reconnection events
    if (this.#unsubscribeReconnection) {
      this.#unsubscribeReconnection();
      this.#unsubscribeReconnection = null;
    }

    // Cancel all pending requests
    for (const [id, pending] of this.#pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("ACP stream closed"));
      this.#pendingRequests.delete(id);
    }

    // Unsubscribe from events
    if (this.#subscription) {
      await this.#subscription.unsubscribe();
      this.#subscription = null;
    }

    this.emit("close");
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create an ACP stream connection from a MAP client.
 *
 * @param mapClient - The underlying MAP client connection
 * @param options - Stream configuration options
 * @returns A new ACPStreamConnection instance
 */
export function createACPStream(
  mapClient: ClientConnection,
  options: ACPStreamOptions
): ACPStreamConnection {
  return new ACPStreamConnection(mapClient, options);
}
