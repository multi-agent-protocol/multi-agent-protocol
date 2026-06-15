/**
 * RouterConnection implementation
 *
 * JSON-RPC router that dispatches requests to handlers with middleware support.
 */

import type { Stream, AnyMessage } from "../../stream";
import type {
  ServerSession,
  SessionManager,
  SessionRole,
  HandlerContext,
  Handler,
  HandlerRegistry,
  Middleware,
  RouterConnection,
  RouterConnectionOptions,
} from "../types";
import type { MAPRequestBase, MAPResponse, MAPError } from "../../types";
import { MAPRequestError } from "../../errors";

/**
 * JSON-RPC error codes
 */
const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * RouterConnection implementation.
 *
 * Handles JSON-RPC message routing with:
 * - Request/response correlation
 * - Middleware chain execution
 * - Session management integration
 * - Error handling
 */
export class RouterConnectionImpl implements RouterConnection {
  private readonly stream: Stream;
  private readonly handlers: HandlerRegistry;
  private readonly middleware: Middleware[];
  private readonly sessions: SessionManager;
  private readonly role: SessionRole;
  private readonly name?: string;
  private readonly resumeToken?: string;
  private readonly metadata?: Record<string, unknown>;

  private _session: ServerSession | null = null;
  private _closed: Promise<void>;
  private _closedResolve!: () => void;
  private _abortController: AbortController;
  private _started = false;
  private _running = false;
  private _isClosed = false;
  private _notificationHandler: ((method: string, params: unknown) => void) | null = null;

  constructor(options: RouterConnectionOptions) {
    this.stream = options.stream;
    this.handlers = options.handlers;
    this.middleware = options.middleware ?? [];
    this.sessions = options.sessions;
    this.role = options.role;
    this.name = options.name;
    this.resumeToken = options.resumeToken;
    this.metadata = options.metadata;

    this._abortController = new AbortController();
    this._closed = new Promise((resolve) => {
      this._closedResolve = resolve;
    });
  }

  /**
   * Get the current session.
   */
  get session(): ServerSession {
    if (!this._session) {
      throw new Error("Connection not started");
    }
    return this._session;
  }

  /**
   * Promise that resolves when connection closes.
   */
  get closed(): Promise<void> {
    return this._closed;
  }

  /**
   * Start processing messages.
   */
  async start(): Promise<void> {
    if (this._started) {
      throw new Error("Connection already started");
    }
    this._started = true;

    // Initialize session
    if (this.resumeToken) {
      const result = this.sessions.resume(this.resumeToken);
      if (result.success && result.session) {
        this._session = result.session;
        // Update metadata on resume if provided (e.g., transportType may change)
        if (this.metadata) {
          this._session.metadata = { ...this._session.metadata, ...this.metadata };
        }
      } else {
        // Resume failed - create new session
        this._session = this.sessions.create({
          role: this.role,
          name: this.name,
          metadata: this.metadata,
        });
      }
    } else {
      this._session = this.sessions.create({
        role: this.role,
        name: this.name,
        metadata: this.metadata,
      });
    }

    // Start message processing loop
    this._running = true;
    this.processMessages().catch((error) => {
      console.error("RouterConnection error:", error);
      this.close();
    });
  }

  /**
   * Stop processing and close the connection.
   */
  async close(): Promise<void> {
    if (this._isClosed) {
      return;
    }
    this._isClosed = true;

    this._running = false;
    this._abortController.abort();

    // Disconnect session (makes it resumable)
    if (this._session) {
      this.sessions.disconnect(this._session.id);
    }

    // Close the stream
    try {
      const writer = this.stream.writable.getWriter();
      await writer.close();
    } catch {
      // Ignore close errors
    }

    this._closedResolve();
  }

  /**
   * Register a handler for incoming notifications from the client.
   * By default, notifications are silently ignored. Setting a handler
   * allows the server to process custom notifications (e.g., opentasks
   * responses, trajectory content responses).
   */
  onNotification(handler: (method: string, params: unknown) => void): void {
    this._notificationHandler = handler;
  }

  /**
   * Send a notification to the connected peer.
   */
  async notify(method: string, params: unknown): Promise<void> {
    const notification = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };

    await this.sendMessage(notification);
  }

  /**
   * Main message processing loop.
   */
  private async processMessages(): Promise<void> {
    const reader = this.stream.readable.getReader();

    try {
      while (this._running) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Touch session on activity
        if (this._session) {
          this.sessions.touch(this._session.id);
        }

        // Process the message
        await this.handleMessage(value);
      }
    } catch (error) {
      if (this._running) {
        console.error("Error reading from stream:", error);
      }
    } finally {
      reader.releaseLock();
      this.close();
    }
  }

  /**
   * Handle an incoming message.
   */
  private async handleMessage(message: AnyMessage): Promise<void> {
    // Check if it's a request (has id and method)
    if (this.isRequest(message)) {
      await this.handleRequest(message as MAPRequestBase);
    } else if (this.isNotification(message)) {
      // Forward notifications to the handler if one is registered
      if (this._notificationHandler) {
        try {
          const msg = message as { method: string; params?: unknown };
          this._notificationHandler(msg.method, msg.params);
        } catch {
          // Don't let handler errors break message processing
        }
      }
    }
    // Responses (id but no method) are for client-side correlation
  }

  /**
   * Check if a message is a notification (method but no id).
   */
  private isNotification(message: AnyMessage): boolean {
    return (
      typeof message === "object" &&
      message !== null &&
      "jsonrpc" in message &&
      message.jsonrpc === "2.0" &&
      "method" in message &&
      !("id" in message)
    );
  }

  /**
   * Check if a message is a request.
   */
  private isRequest(message: AnyMessage): boolean {
    return (
      typeof message === "object" &&
      message !== null &&
      "jsonrpc" in message &&
      message.jsonrpc === "2.0" &&
      "id" in message &&
      "method" in message
    );
  }

  /**
   * Handle a JSON-RPC request.
   */
  private async handleRequest(request: MAPRequestBase): Promise<void> {
    const { id, method, params } = request;

    try {
      // Find handler
      const handler = this.handlers[method];
      if (!handler) {
        await this.sendError(id, {
          code: JSONRPC_ERRORS.METHOD_NOT_FOUND,
          message: `Method not found: ${method}`,
        });
        return;
      }

      // Create handler context
      const ctx: HandlerContext = {
        session: this._session!,
        requestId: String(id),
        signal: this._abortController.signal,
      };

      // Execute through middleware chain
      const result = await this.executeWithMiddleware(
        method,
        params,
        ctx,
        handler
      );

      // Send success response
      await this.sendResponse(id, result);
    } catch (error) {
      // Preserve structured MAPRequestError codes (e.g. 10000 mail not-found,
      // 2001 agent not-found) end-to-end; only fall back to INTERNAL_ERROR for
      // unknown throws.
      const mapError: MAPError =
        error instanceof MAPRequestError
          ? error.toError()
          : {
              code: JSONRPC_ERRORS.INTERNAL_ERROR,
              message: error instanceof Error ? error.message : "Internal error",
            };
      await this.sendError(id, mapError);
    }
  }

  /**
   * Execute handler with middleware chain.
   */
  private async executeWithMiddleware(
    method: string,
    params: unknown,
    ctx: HandlerContext,
    handler: Handler
  ): Promise<unknown> {
    // Build middleware chain
    let index = 0;

    const next = async (): Promise<unknown> => {
      if (index < this.middleware.length) {
        const middleware = this.middleware[index++];
        return middleware(method, params, ctx, next);
      } else {
        // End of middleware chain - call the handler
        return handler(params, ctx);
      }
    };

    return next();
  }

  /**
   * Send a success response.
   */
  private async sendResponse(
    id: string | number,
    result: unknown
  ): Promise<void> {
    const response: MAPResponse = {
      jsonrpc: "2.0",
      id,
      result,
    };
    await this.sendMessage(response);
  }

  /**
   * Send an error response.
   */
  private async sendError(id: string | number, error: MAPError): Promise<void> {
    const response: MAPResponse = {
      jsonrpc: "2.0",
      id,
      error,
    };
    await this.sendMessage(response);
  }

  /**
   * Send a message to the stream.
   */
  private async sendMessage(message: AnyMessage): Promise<void> {
    const writer = this.stream.writable.getWriter();
    try {
      await writer.write(message);
    } finally {
      writer.releaseLock();
    }
  }
}

/**
 * Create a RouterConnection.
 */
export function createRouterConnection(
  options: RouterConnectionOptions
): RouterConnection {
  return new RouterConnectionImpl(options);
}
