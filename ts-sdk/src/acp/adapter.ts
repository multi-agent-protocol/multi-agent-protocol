/**
 * ACPAgentAdapter - Agent-side helper for ACP-over-MAP.
 *
 * Simplifies implementing ACP-compatible agents by handling the
 * MAP↔ACP translation layer automatically.
 *
 * @module
 */

import type { AgentConnection } from "../connection/agent";
import type { Message, ParticipantId } from "../types";
import {
  type ACPSessionId,
  type ACPRequestId,
  type ACPEnvelope,
  type ACPAgentContext,
  type ACPAgentHandler,
  type ACPInitializeRequest,
  type ACPAuthenticateRequest,
  type ACPNewSessionRequest,
  type ACPLoadSessionRequest,
  type ACPSetSessionModeRequest,
  type ACPPromptRequest,
  type ACPCancelNotification,
  type ACPSessionNotification,
  type ACPRequestPermissionRequest,
  type ACPRequestPermissionResponse,
  type ACPReadTextFileRequest,
  type ACPReadTextFileResponse,
  type ACPWriteTextFileRequest,
  type ACPWriteTextFileResponse,
  type ACPCreateTerminalRequest,
  type ACPCreateTerminalResponse,
  type ACPTerminalOutputRequest,
  type ACPTerminalOutputResponse,
  type ACPReleaseTerminalRequest,
  type ACPReleaseTerminalResponse,
  type ACPWaitForTerminalExitRequest,
  type ACPWaitForTerminalExitResponse,
  type ACPKillTerminalCommandRequest,
  type ACPKillTerminalCommandResponse,
  ACPError,
  ACP_METHODS,
  isACPEnvelope,
} from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Pending client request state for agent→client correlation.
 */
interface PendingClientRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  method: string;
}

/**
 * Stream context tracked per client stream.
 */
interface StreamContext {
  clientParticipantId: ParticipantId;
  sessionId: ACPSessionId | null;
}

// =============================================================================
// ACPAgentAdapter
// =============================================================================

/**
 * Adapter for implementing ACP-compatible agents.
 *
 * Handles the ACP envelope protocol, request routing, and provides
 * helper methods for agent→client communication.
 *
 * @example
 * ```typescript
 * const mapAgent = await AgentConnection.connect('ws://localhost:8080', {
 *   name: 'CodingAgent',
 *   capabilities: { protocols: ['acp'], acp: { version: '2024-10-07' } }
 * });
 *
 * const adapter = new ACPAgentAdapter(mapAgent, {
 *   initialize: async (params, ctx) => ({
 *     protocolVersion: 20241007,
 *     agentInfo: { name: 'CodingAgent', version: '1.0.0' },
 *     agentCapabilities: { loadSession: true }
 *   }),
 *   newSession: async (params, ctx) => ({
 *     sessionId: generateId()
 *   }),
 *   prompt: async (params, ctx) => {
 *     await adapter.sendSessionUpdate(ctx.streamId, {
 *       sessionId: params.sessionId,
 *       update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello!' } }
 *     });
 *     return { stopReason: 'end_turn' };
 *   },
 *   cancel: async (params, ctx) => {}
 * });
 * ```
 */
export class ACPAgentAdapter {
  readonly #mapAgent: AgentConnection;
  readonly #handler: ACPAgentHandler;
  readonly #streamContexts: Map<string, StreamContext> = new Map();
  readonly #pendingClientRequests: Map<string, PendingClientRequest> = new Map();
  readonly #clientRequestTimeout: number;

  /**
   * Create a new ACP agent adapter.
   *
   * @param mapAgent - The underlying MAP agent connection
   * @param handler - Handler implementing ACP agent methods
   * @param options - Optional configuration
   */
  constructor(
    mapAgent: AgentConnection,
    handler: ACPAgentHandler,
    options?: { clientRequestTimeout?: number }
  ) {
    this.#mapAgent = mapAgent;
    this.#handler = handler;
    this.#clientRequestTimeout = options?.clientRequestTimeout ?? 30000;

    // Register message handler
    // IMPORTANT: We use queueMicrotask to avoid deadlock for client requests.
    // The message handler is called from within the BaseConnection's notification
    // handler, which awaits it. If we process client requests synchronously and
    // need to send a response, we'd await a send that waits for a response from
    // the server. But the read loop can't process that response because it's
    // blocked awaiting us. By using queueMicrotask, we return immediately,
    // allowing the read loop to continue processing responses.
    //
    // However, we track stream context synchronously so that hasStream() works
    // immediately after a message is received.
    mapAgent.onMessage((message) => {
      // Check if this is an ACP message
      if (!message.payload || !isACPEnvelope(message.payload)) {
        return;
      }

      const envelope = message.payload as ACPEnvelope;
      const { acp, acpContext } = envelope;

      // Responses to pending client requests can be handled synchronously
      // since they don't involve sending anything
      if (acp.id !== undefined && !acp.method) {
        void this.#handleMessage(message);
        return;
      }

      // For client requests, track stream context synchronously
      if (acp.method) {
        this.#trackStreamContext(acpContext, message.from);
      }

      // Then defer the actual request processing to avoid deadlock
      queueMicrotask(() => void this.#handleMessage(message));
    });
  }

  /**
   * Track stream context for a client request.
   * This is called synchronously so that hasStream() works immediately.
   */
  #trackStreamContext(
    acpCtx: ACPEnvelope["acpContext"],
    clientParticipantId: ParticipantId
  ): void {
    if (!this.#streamContexts.has(acpCtx.streamId)) {
      this.#streamContexts.set(acpCtx.streamId, {
        clientParticipantId,
        sessionId: acpCtx.sessionId,
      });
    } else if (acpCtx.sessionId) {
      const streamCtx = this.#streamContexts.get(acpCtx.streamId)!;
      streamCtx.sessionId = acpCtx.sessionId;
    }
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Handle incoming messages from MAP.
   */
  async #handleMessage(message: Message): Promise<void> {
    // Check if this is an ACP message
    if (!message.payload || !isACPEnvelope(message.payload)) {
      return;
    }

    const envelope = message.payload as ACPEnvelope;
    const { acp, acpContext } = envelope;

    // Handle response to a pending client request
    if (acp.id !== undefined && !acp.method) {
      const requestId = String(acp.id);
      const pending = this.#pendingClientRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.#pendingClientRequests.delete(requestId);

        if (acp.error) {
          pending.reject(ACPError.fromResponse(acp.error));
        } else {
          pending.resolve(acp.result);
        }
      }
      return;
    }

    // Handle client→agent request or notification
    if (acp.method) {
      await this.#handleClientRequest(
        acp.id,
        acp.method,
        acp.params,
        acpContext,
        message
      );
    }
  }

  /**
   * Handle a client→agent request.
   */
  async #handleClientRequest(
    requestId: ACPRequestId | undefined,
    method: string,
    params: unknown,
    acpCtx: ACPEnvelope["acpContext"],
    originalMessage: Message
  ): Promise<void> {
    // Build the handler context
    const ctx: ACPAgentContext = {
      streamId: acpCtx.streamId,
      sessionId: acpCtx.sessionId,
      clientParticipantId: originalMessage.from,
    };

    // Note: Stream context is now tracked synchronously in the message handler
    // callback via #trackStreamContext, so we don't duplicate it here.

    let result: unknown;
    let error: ACPError | undefined;

    try {
      switch (method) {
        case ACP_METHODS.INITIALIZE:
          result = await this.#handler.initialize(
            params as ACPInitializeRequest,
            ctx
          );
          break;

        case ACP_METHODS.AUTHENTICATE:
          if (!this.#handler.authenticate) {
            throw new ACPError(-32601, "Method not implemented: authenticate");
          }
          result = await this.#handler.authenticate(
            params as ACPAuthenticateRequest,
            ctx
          );
          break;

        case ACP_METHODS.SESSION_NEW:
          result = await this.#handler.newSession(
            params as ACPNewSessionRequest,
            ctx
          );
          // Update stream context with new session ID
          const newSessionResult = result as { sessionId: ACPSessionId };
          const streamContext = this.#streamContexts.get(acpCtx.streamId);
          if (streamContext) {
            streamContext.sessionId = newSessionResult.sessionId;
          }
          break;

        case ACP_METHODS.SESSION_LOAD:
          if (!this.#handler.loadSession) {
            throw new ACPError(-32601, "Method not implemented: session/load");
          }
          result = await this.#handler.loadSession(
            params as ACPLoadSessionRequest,
            ctx
          );
          break;

        case ACP_METHODS.SESSION_SET_MODE:
          if (!this.#handler.setSessionMode) {
            throw new ACPError(-32601, "Method not implemented: session/set_mode");
          }
          result = await this.#handler.setSessionMode(
            params as ACPSetSessionModeRequest,
            ctx
          );
          break;

        case ACP_METHODS.SESSION_PROMPT:
          result = await this.#handler.prompt(params as ACPPromptRequest, ctx);
          break;

        case ACP_METHODS.SESSION_CANCEL:
          await this.#handler.cancel(params as ACPCancelNotification, ctx);
          // Notifications don't have responses
          return;

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

    // Send response (only for requests, not notifications)
    // IMPORTANT: We must NOT await this send operation because we're inside
    // a notification handler. Awaiting would cause a deadlock: the notification
    // handler awaits the send, which awaits a response from the server, but the
    // read loop can't process the response because it's blocked awaiting the
    // notification handler.
    if (requestId !== undefined) {
      const responseEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: requestId,
          ...(error ? { error: error.toErrorObject() } : { result }),
        },
        acpContext: {
          streamId: acpCtx.streamId,
          sessionId: this.#streamContexts.get(acpCtx.streamId)?.sessionId ?? null,
          direction: "agent-to-client",
        },
      };

      // Fire-and-forget with error logging
      this.#mapAgent
        .send(
          { participant: originalMessage.from },
          responseEnvelope,
          {
            protocol: "acp",
            correlationId: originalMessage.id,
          }
        )
        .catch((err) => {
          console.error("ACP: Failed to send response:", err);
        });
    }
  }

  // ===========================================================================
  // Agent→Client Communication
  // ===========================================================================

  /**
   * Send a session update notification to the client.
   */
  async sendSessionUpdate(
    streamId: string,
    notification: ACPSessionNotification
  ): Promise<void> {
    const streamCtx = this.#streamContexts.get(streamId);
    if (!streamCtx) {
      throw new Error(`Unknown stream: ${streamId}`);
    }

    const envelope: ACPEnvelope = {
      acp: {
        jsonrpc: "2.0",
        method: ACP_METHODS.SESSION_UPDATE,
        params: notification,
      },
      acpContext: {
        streamId,
        sessionId: streamCtx.sessionId,
        direction: "agent-to-client",
      },
    };

    await this.#mapAgent.send(
      { participant: streamCtx.clientParticipantId },
      envelope,
      { protocol: "acp" }
    );
  }

  /**
   * Send an agent→client request and wait for response.
   */
  async #sendClientRequest<TParams, TResult>(
    streamId: string,
    method: string,
    params: TParams
  ): Promise<TResult> {
    const streamCtx = this.#streamContexts.get(streamId);
    if (!streamCtx) {
      throw new Error(`Unknown stream: ${streamId}`);
    }

    const correlationId = `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const envelope: ACPEnvelope = {
      acp: {
        jsonrpc: "2.0",
        id: correlationId,
        method,
        params: params as unknown,
      },
      acpContext: {
        streamId,
        sessionId: streamCtx.sessionId,
        direction: "agent-to-client",
        pendingClientRequest: {
          requestId: correlationId,
          method,
          timeout: this.#clientRequestTimeout,
        },
      },
    };

    await this.#mapAgent.send(
      { participant: streamCtx.clientParticipantId },
      envelope,
      { protocol: "acp", correlationId }
    );

    return new Promise<TResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.#pendingClientRequests.delete(correlationId);
        reject(new Error(`Client request timed out: ${method}`));
      }, this.#clientRequestTimeout);

      this.#pendingClientRequests.set(correlationId, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: timeoutHandle,
        method,
      });
    });
  }

  /**
   * Request permission from the client.
   */
  async requestPermission(
    streamId: string,
    request: ACPRequestPermissionRequest
  ): Promise<ACPRequestPermissionResponse> {
    return this.#sendClientRequest<
      ACPRequestPermissionRequest,
      ACPRequestPermissionResponse
    >(streamId, ACP_METHODS.REQUEST_PERMISSION, request);
  }

  /**
   * Read a text file from the client.
   */
  async readTextFile(
    streamId: string,
    request: ACPReadTextFileRequest
  ): Promise<ACPReadTextFileResponse> {
    return this.#sendClientRequest<
      ACPReadTextFileRequest,
      ACPReadTextFileResponse
    >(streamId, ACP_METHODS.FS_READ_TEXT_FILE, request);
  }

  /**
   * Write a text file on the client.
   */
  async writeTextFile(
    streamId: string,
    request: ACPWriteTextFileRequest
  ): Promise<ACPWriteTextFileResponse> {
    return this.#sendClientRequest<
      ACPWriteTextFileRequest,
      ACPWriteTextFileResponse
    >(streamId, ACP_METHODS.FS_WRITE_TEXT_FILE, request);
  }

  /**
   * Create a terminal on the client.
   */
  async createTerminal(
    streamId: string,
    request: ACPCreateTerminalRequest
  ): Promise<ACPCreateTerminalResponse> {
    return this.#sendClientRequest<
      ACPCreateTerminalRequest,
      ACPCreateTerminalResponse
    >(streamId, ACP_METHODS.TERMINAL_CREATE, request);
  }

  /**
   * Get terminal output from the client.
   */
  async terminalOutput(
    streamId: string,
    request: ACPTerminalOutputRequest
  ): Promise<ACPTerminalOutputResponse> {
    return this.#sendClientRequest<
      ACPTerminalOutputRequest,
      ACPTerminalOutputResponse
    >(streamId, ACP_METHODS.TERMINAL_OUTPUT, request);
  }

  /**
   * Release a terminal on the client.
   */
  async releaseTerminal(
    streamId: string,
    request: ACPReleaseTerminalRequest
  ): Promise<ACPReleaseTerminalResponse> {
    return this.#sendClientRequest<
      ACPReleaseTerminalRequest,
      ACPReleaseTerminalResponse
    >(streamId, ACP_METHODS.TERMINAL_RELEASE, request);
  }

  /**
   * Wait for a terminal to exit on the client.
   */
  async waitForTerminalExit(
    streamId: string,
    request: ACPWaitForTerminalExitRequest
  ): Promise<ACPWaitForTerminalExitResponse> {
    return this.#sendClientRequest<
      ACPWaitForTerminalExitRequest,
      ACPWaitForTerminalExitResponse
    >(streamId, ACP_METHODS.TERMINAL_WAIT_FOR_EXIT, request);
  }

  /**
   * Kill a terminal command on the client.
   */
  async killTerminal(
    streamId: string,
    request: ACPKillTerminalCommandRequest
  ): Promise<ACPKillTerminalCommandResponse> {
    return this.#sendClientRequest<
      ACPKillTerminalCommandRequest,
      ACPKillTerminalCommandResponse
    >(streamId, ACP_METHODS.TERMINAL_KILL, request);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get the current session ID for a stream.
   */
  getSessionId(streamId: string): ACPSessionId | null {
    return this.#streamContexts.get(streamId)?.sessionId ?? null;
  }

  /**
   * Get the client participant ID for a stream.
   */
  getClientParticipantId(streamId: string): ParticipantId | undefined {
    return this.#streamContexts.get(streamId)?.clientParticipantId;
  }

  /**
   * Check if a stream is active.
   */
  hasStream(streamId: string): boolean {
    return this.#streamContexts.has(streamId);
  }

  /**
   * Remove a stream context (e.g., on disconnect).
   */
  removeStream(streamId: string): boolean {
    return this.#streamContexts.delete(streamId);
  }
}
