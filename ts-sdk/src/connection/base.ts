/**
 * Base connection class for MAP protocol
 *
 * Handles JSON-RPC message correlation, request/response matching,
 * and connection lifecycle management.
 */

import type { Stream, AnyMessage } from '../stream';
import type { RequestId, MAPError } from '../types';
import {
  isRequest,
  isNotification,
  isResponse,
  isErrorResponse,
  createRequest,
  createNotification,
  createSuccessResponse,
  createErrorResponse,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type JsonRpcResponse,
} from '../jsonrpc';
import { MAPRequestError, MAPConnectionError, MAPTimeoutError } from '../errors';

/**
 * Pending response tracker
 */
interface PendingResponse<T = unknown> {
  resolve: (result: T) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Handler for incoming requests
 */
export type RequestHandler = (
  method: string,
  params: unknown
) => Promise<unknown>;

/**
 * Handler for incoming notifications
 */
export type NotificationHandler = (
  method: string,
  params: unknown
) => Promise<void>;

/**
 * Connection state for tracking lifecycle
 */
export type ConnectionState =
  | 'initial'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed';

/**
 * Handler for connection state changes
 */
export type StateChangeHandler = (
  newState: ConnectionState,
  oldState: ConnectionState
) => void;

/**
 * Options for base connection
 */
export interface BaseConnectionOptions {
  /** Default timeout for requests in milliseconds */
  defaultTimeout?: number;
}

/**
 * Base connection class providing JSON-RPC message handling.
 *
 * This class is used internally by the role-specific connection classes
 * (ClientConnection, AgentConnection, etc.)
 */
export class BaseConnection {
  #stream: Stream;
  readonly #pendingResponses: Map<RequestId, PendingResponse> = new Map();
  readonly #abortController: AbortController = new AbortController();
  readonly #closedPromise: Promise<void>;
  readonly #defaultTimeout: number;
  readonly #stateChangeHandlers: Set<StateChangeHandler> = new Set();

  #nextRequestId: number = 1;
  #writeQueue: Promise<void> = Promise.resolve();
  #requestHandler: RequestHandler | null = null;
  #notificationHandler: NotificationHandler | null = null;
  #closed = false;
  #closeResolver!: () => void;
  #state: ConnectionState = 'initial';

  constructor(stream: Stream, options: BaseConnectionOptions = {}) {
    this.#stream = stream;
    this.#defaultTimeout = options.defaultTimeout ?? 30000;

    // Create closed promise
    this.#closedPromise = new Promise((resolve) => {
      this.#closeResolver = resolve;
    });

    // Start receiving messages
    void this.#startReceiving();
  }

  /**
   * AbortSignal that triggers when the connection closes.
   * Useful for cancelling operations tied to this connection.
   */
  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  /**
   * Promise that resolves when the connection is closed.
   */
  get closed(): Promise<void> {
    return this.#closedPromise;
  }

  /**
   * Whether the connection is closed
   */
  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Set the handler for incoming requests
   */
  setRequestHandler(handler: RequestHandler): void {
    this.#requestHandler = handler;
  }

  /**
   * Set the handler for incoming notifications
   */
  setNotificationHandler(handler: NotificationHandler): void {
    this.#notificationHandler = handler;
  }

  /**
   * Current connection state
   */
  get state(): ConnectionState {
    return this.#state;
  }

  /**
   * Register a handler for state changes.
   *
   * @param handler - Function called when state changes
   * @returns Unsubscribe function to remove the handler
   */
  onStateChange(handler: StateChangeHandler): () => void {
    this.#stateChangeHandlers.add(handler);
    return () => this.#stateChangeHandlers.delete(handler);
  }

  /**
   * Transition to a new state and notify handlers.
   * @internal
   */
  _transitionTo(newState: ConnectionState): void {
    if (this.#state === newState) return;

    const oldState = this.#state;
    this.#state = newState;

    for (const handler of this.#stateChangeHandlers) {
      try {
        handler(newState, oldState);
      } catch (error) {
        console.error('MAP: State change handler error:', error);
      }
    }
  }

  /**
   * Reconnect with a new stream.
   *
   * This method is used by role-specific connections to replace the
   * underlying transport after a disconnect.
   *
   * @param newStream - The new stream to use
   * @throws If the connection is permanently closed
   */
  async reconnect(newStream: Stream): Promise<void> {
    if (this.#state === 'closed') {
      throw new Error('Cannot reconnect a permanently closed connection');
    }

    // Replace the stream
    this.#stream = newStream;
    this.#closed = false;

    // Reset the write queue
    this.#writeQueue = Promise.resolve();

    // Start receiving on the new stream
    void this.#startReceiving();

    this._transitionTo('connected');
  }

  /**
   * Send a request and wait for response
   */
  async sendRequest<TParams, TResult>(
    method: string,
    params?: TParams,
    options?: { timeout?: number }
  ): Promise<TResult> {
    if (this.#closed) {
      throw MAPConnectionError.closed();
    }

    const id = this.#nextRequestId++;
    const request = createRequest(id, method, params);

    const responsePromise = new Promise<TResult>((resolve, reject) => {
      const pending: PendingResponse<TResult> = { resolve, reject };

      // Set up timeout
      const timeout = options?.timeout ?? this.#defaultTimeout;
      if (timeout > 0) {
        pending.timeoutId = setTimeout(() => {
          this.#pendingResponses.delete(id);
          reject(new MAPTimeoutError(method, timeout));
        }, timeout);
      }

      this.#pendingResponses.set(id, pending as PendingResponse);
    });

    await this.#sendMessage(request as AnyMessage);

    // `return await` (not bare `return`) ensures the rejection handler is
    // attached synchronously, preventing the runtime from detecting the
    // rejection as unhandled during the gap before the async function
    // adopts the promise. This matters in Bun worker threads where
    // unhandled rejections terminate the thread.
    return await responsePromise;
  }

  /**
   * Send a notification (no response expected)
   */
  async sendNotification<TParams>(
    method: string,
    params?: TParams
  ): Promise<void> {
    if (this.#closed) {
      throw MAPConnectionError.closed();
    }

    const notification = createNotification(method, params);
    await this.#sendMessage(notification as AnyMessage);
  }

  /**
   * Send a response to a request
   */
  async sendResponse<TResult>(id: RequestId, result: TResult): Promise<void> {
    if (this.#closed) {
      throw MAPConnectionError.closed();
    }

    const response = createSuccessResponse(id, result);
    await this.#sendMessage(response);
  }

  /**
   * Send an error response to a request
   */
  async sendErrorResponse(id: RequestId, error: MAPError): Promise<void> {
    if (this.#closed) {
      throw MAPConnectionError.closed();
    }

    const response = createErrorResponse(id, error);
    await this.#sendMessage(response);
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.#closed) return;

    this.#closed = true;
    this._transitionTo('closed');
    this.#abortController.abort();

    // Reject all pending responses
    for (const [, pending] of this.#pendingResponses) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(MAPConnectionError.closed());
    }
    this.#pendingResponses.clear();

    // Close the stream
    try {
      const writer = this.#stream.writable.getWriter();
      await writer.close();
      writer.releaseLock();
    } catch {
      // Ignore close errors
    }

    this.#closeResolver();
  }

  /**
   * Start receiving messages from the stream
   */
  async #startReceiving(): Promise<void> {
    const reader = this.#stream.readable.getReader();

    try {
      while (!this.#closed) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        await this.#handleMessage(value);
      }
    } catch (error) {
      if (!this.#closed) {
        console.error('MAP: Error receiving message:', error);
      }
    } finally {
      reader.releaseLock();
      await this.close();
    }
  }

  /**
   * Handle an incoming message
   */
  async #handleMessage(message: AnyMessage): Promise<void> {
    try {
      if (isRequest(message)) {
        await this.#handleRequest(message);
      } else if (isNotification(message)) {
        await this.#handleNotification(message);
      } else if (isResponse(message)) {
        this.#handleResponse(message);
      } else {
        console.error('MAP: Unknown message type:', message);
      }
    } catch (error) {
      console.error('MAP: Error handling message:', error);
    }
  }

  /**
   * Handle an incoming request
   */
  async #handleRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;

    if (!this.#requestHandler) {
      await this.sendErrorResponse(
        id,
        MAPRequestError.methodNotFound(method).toError()
      );
      return;
    }

    try {
      const result = await this.#requestHandler(method, params);
      await this.sendResponse(id, result ?? null);
    } catch (error) {
      if (error instanceof MAPRequestError) {
        await this.sendErrorResponse(id, error.toError());
      } else {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await this.sendErrorResponse(
          id,
          MAPRequestError.internalError(message).toError()
        );
      }
    }
  }

  /**
   * Handle an incoming notification
   */
  async #handleNotification(notification: JsonRpcNotification): Promise<void> {
    const { method, params } = notification;

    if (!this.#notificationHandler) {
      // Notifications are fire-and-forget, so just log
      console.warn('MAP: No notification handler for:', method);
      return;
    }

    try {
      await this.#notificationHandler(method, params);
    } catch (error) {
      console.error('MAP: Error handling notification:', method, error);
    }
  }

  /**
   * Handle an incoming response
   */
  #handleResponse(response: JsonRpcResponse): void {
    const { id } = response;
    const pending = this.#pendingResponses.get(id);

    if (!pending) {
      console.warn('MAP: Received response for unknown request:', id);
      return;
    }

    this.#pendingResponses.delete(id);

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    if (isErrorResponse(response)) {
      pending.reject(MAPRequestError.fromError(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Send a message through the stream with write queue serialization
   */
  async #sendMessage(message: AnyMessage): Promise<void> {
    this.#writeQueue = this.#writeQueue
      .then(async () => {
        if (this.#closed) return;

        const writer = this.#stream.writable.getWriter();
        try {
          await writer.write(message);
        } finally {
          writer.releaseLock();
        }
      })
      .catch((error) => {
        console.error('MAP: Write error:', error);
      });

    return this.#writeQueue;
  }
}
