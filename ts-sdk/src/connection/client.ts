/**
 * Client connection for MAP protocol
 *
 * Used by clients to connect to a MAP system, query agents,
 * subscribe to events, and send messages.
 */

import type { Stream } from '../stream';
import { BaseConnection, type BaseConnectionOptions } from './base';
import { Subscription, createSubscription } from '../subscription';
import {
  CORE_METHODS,
  OBSERVATION_METHODS,
  STATE_METHODS,
  STEERING_METHODS,
  SESSION_METHODS,
  NOTIFICATION_METHODS,
  PROTOCOL_VERSION,
  type ParticipantCapabilities,
  type SessionId,
  type AgentId,
  type ScopeId,
  type SubscriptionId,
  type Address,
  type Agent,
  type Scope,
  type Message,
  type MessageMeta,
  type SubscriptionFilter,
  type EventNotificationParams,
  type ConnectRequestParams,
  type ConnectResponseResult,
  type DisconnectResponseResult,
  type SessionListResponseResult,
  type SessionLoadResponseResult,
  type SessionCloseResponseResult,
  type AgentsListRequestParams,
  type AgentsListResponseResult,
  type AgentsGetResponseResult,
  type AgentsGetRequestParams,
  type SendRequestParams,
  type SendResponseResult,
  type SubscribeRequestParams,
  type SubscribeResponseResult,
  type UnsubscribeResponseResult,
  type StructureGraphRequestParams,
  type StructureGraphResponseResult,
  type ScopesListRequestParams,
  type ScopesListResponseResult,
  type ScopesGetResponseResult,
  type ScopesMembersRequestParams,
  type ScopesMembersResponseResult,
  type InjectRequestParams,
  type InjectResponseResult,
} from '../types';

/**
 * Options for client connection
 */
export interface ClientConnectionOptions extends BaseConnectionOptions {
  /** Client name for identification */
  name?: string;
  /** Client capabilities */
  capabilities?: ParticipantCapabilities;
}

/**
 * Client connection to a MAP system.
 *
 * Provides methods for:
 * - Querying agents and structure
 * - Subscribing to events
 * - Sending messages to agents
 * - (With permissions) Steering agents
 */
export class ClientConnection {
  readonly #connection: BaseConnection;
  readonly #subscriptions: Map<SubscriptionId, Subscription> = new Map();
  readonly #options: ClientConnectionOptions;

  #sessionId: SessionId | null = null;
  #serverCapabilities: ParticipantCapabilities | null = null;
  #connected = false;

  constructor(stream: Stream, options: ClientConnectionOptions = {}) {
    this.#connection = new BaseConnection(stream, options);
    this.#options = options;

    // Set up notification handler for events
    this.#connection.setNotificationHandler(this.#handleNotification.bind(this));
  }

  // ===========================================================================
  // Connection Lifecycle
  // ===========================================================================

  /**
   * Connect to the MAP system
   */
  async connect(options?: {
    sessionId?: SessionId;
    auth?: { method: 'bearer' | 'api-key' | 'mtls' | 'none'; token?: string };
  }): Promise<ConnectResponseResult> {
    const params: ConnectRequestParams = {
      protocolVersion: PROTOCOL_VERSION,
      participantType: 'client',
      name: this.#options.name,
      capabilities: this.#options.capabilities,
      sessionId: options?.sessionId,
      auth: options?.auth,
    };

    const result = await this.#connection.sendRequest<
      ConnectRequestParams,
      ConnectResponseResult
    >(CORE_METHODS.CONNECT, params);

    this.#sessionId = result.sessionId;
    this.#serverCapabilities = result.capabilities;
    this.#connected = true;

    return result;
  }

  /**
   * Disconnect from the MAP system
   */
  async disconnect(reason?: string): Promise<void> {
    if (!this.#connected) return;

    try {
      await this.#connection.sendRequest<{ reason?: string }, DisconnectResponseResult>(
        CORE_METHODS.DISCONNECT,
        reason ? { reason } : undefined
      );
    } finally {
      // Close all subscriptions
      for (const subscription of this.#subscriptions.values()) {
        subscription._close();
      }
      this.#subscriptions.clear();

      await this.#connection.close();
      this.#connected = false;
    }
  }

  /**
   * Whether the client is connected
   */
  get isConnected(): boolean {
    return this.#connected && !this.#connection.isClosed;
  }

  /**
   * Current session ID
   */
  get sessionId(): SessionId | null {
    return this.#sessionId;
  }

  /**
   * Server capabilities
   */
  get serverCapabilities(): ParticipantCapabilities | null {
    return this.#serverCapabilities;
  }

  /**
   * AbortSignal that triggers when the connection closes
   */
  get signal(): AbortSignal {
    return this.#connection.signal;
  }

  /**
   * Promise that resolves when the connection closes
   */
  get closed(): Promise<void> {
    return this.#connection.closed;
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * List available sessions
   */
  async listSessions(): Promise<SessionListResponseResult> {
    return this.#connection.sendRequest(SESSION_METHODS.SESSION_LIST);
  }

  /**
   * Load an existing session
   */
  async loadSession(sessionId: SessionId): Promise<SessionLoadResponseResult> {
    return this.#connection.sendRequest(SESSION_METHODS.SESSION_LOAD, { sessionId });
  }

  /**
   * Close the current session
   */
  async closeSession(sessionId?: SessionId): Promise<SessionCloseResponseResult> {
    return this.#connection.sendRequest(SESSION_METHODS.SESSION_CLOSE, { sessionId });
  }

  // ===========================================================================
  // Agent Queries
  // ===========================================================================

  /**
   * List agents with optional filters
   */
  async listAgents(options?: AgentsListRequestParams): Promise<AgentsListResponseResult> {
    return this.#connection.sendRequest(OBSERVATION_METHODS.AGENTS_LIST, options);
  }

  /**
   * Get a single agent by ID
   */
  async getAgent(
    agentId: AgentId,
    options?: { include?: { children?: boolean; descendants?: boolean } }
  ): Promise<AgentsGetResponseResult> {
    const params: AgentsGetRequestParams = { agentId, ...options };
    return this.#connection.sendRequest<AgentsGetRequestParams, AgentsGetResponseResult>(
      OBSERVATION_METHODS.AGENTS_GET,
      params
    );
  }

  /**
   * Get the agent structure/hierarchy graph
   */
  async getStructureGraph(
    options?: StructureGraphRequestParams
  ): Promise<StructureGraphResponseResult> {
    return this.#connection.sendRequest(OBSERVATION_METHODS.STRUCTURE_GRAPH, options);
  }

  // ===========================================================================
  // Scope Queries
  // ===========================================================================

  /**
   * List scopes
   */
  async listScopes(options?: ScopesListRequestParams): Promise<ScopesListResponseResult> {
    return this.#connection.sendRequest(OBSERVATION_METHODS.SCOPES_LIST, options);
  }

  /**
   * Get a single scope by ID
   */
  async getScope(scopeId: ScopeId): Promise<Scope> {
    const result = await this.#connection.sendRequest<
      { scopeId: ScopeId },
      ScopesGetResponseResult
    >(OBSERVATION_METHODS.SCOPES_GET, { scopeId });
    return result.scope;
  }

  /**
   * List members of a scope
   */
  async getScopeMembers(
    scopeId: ScopeId,
    options?: Omit<ScopesMembersRequestParams, 'scopeId'>
  ): Promise<ScopesMembersResponseResult> {
    return this.#connection.sendRequest(OBSERVATION_METHODS.SCOPES_MEMBERS, {
      scopeId,
      ...options,
    });
  }

  // ===========================================================================
  // Messaging
  // ===========================================================================

  /**
   * Send a message to an address
   */
  async send(
    to: Address,
    payload?: unknown,
    meta?: MessageMeta
  ): Promise<SendResponseResult> {
    const params: SendRequestParams = { to };
    if (payload !== undefined) params.payload = payload;
    if (meta) params.meta = meta;

    return this.#connection.sendRequest(CORE_METHODS.SEND, params);
  }

  /**
   * Send a message to a specific agent
   */
  async sendToAgent(
    agentId: AgentId,
    payload?: unknown,
    meta?: MessageMeta
  ): Promise<SendResponseResult> {
    return this.send({ agent: agentId }, payload, meta);
  }

  /**
   * Send a message to all agents in a scope
   */
  async sendToScope(
    scopeId: ScopeId,
    payload?: unknown,
    meta?: MessageMeta
  ): Promise<SendResponseResult> {
    return this.send({ scope: scopeId }, payload, meta);
  }

  /**
   * Send a message to agents with a specific role
   */
  async sendToRole(
    role: string,
    payload?: unknown,
    meta?: MessageMeta,
    withinScope?: ScopeId
  ): Promise<SendResponseResult> {
    return this.send({ role, within: withinScope }, payload, meta);
  }

  /**
   * Broadcast a message to all agents
   */
  async broadcast(payload?: unknown, meta?: MessageMeta): Promise<SendResponseResult> {
    return this.send({ broadcast: true }, payload, meta);
  }

  /**
   * Send a request and wait for a correlated response
   *
   * This is a higher-level pattern for request/response messaging.
   * A correlationId is automatically generated.
   */
  async request<T = unknown>(
    to: Address,
    payload?: unknown,
    options?: { timeout?: number; meta?: MessageMeta }
  ): Promise<Message<T>> {
    const correlationId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Subscribe to responses with this correlation ID
    const responseSub = await this.subscribe({
      // We'll filter in the handler since subscription filters don't support correlationId
    });

    try {
      // Send the request
      await this.send(to, payload, {
        ...options?.meta,
        expectsResponse: true,
        correlationId,
      });

      // Wait for response with matching correlationId
      const timeout = options?.timeout ?? 30000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Request timed out after ${timeout}ms`)), timeout);
      });

      const responsePromise = (async () => {
        for await (const event of responseSub) {
          if (
            event.type === 'message_delivered' &&
            event.data &&
            (event.data as { correlationId?: string }).correlationId === correlationId
          ) {
            return (event.data as { message: Message<T> }).message;
          }
        }
        throw new Error('Subscription closed before response received');
      })();

      return await Promise.race([responsePromise, timeoutPromise]);
    } finally {
      await responseSub.unsubscribe();
    }
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribe to events
   */
  async subscribe(filter?: SubscriptionFilter): Promise<Subscription> {
    const params: SubscribeRequestParams = {};
    if (filter) params.filter = filter;

    const result = await this.#connection.sendRequest<
      SubscribeRequestParams,
      SubscribeResponseResult
    >(CORE_METHODS.SUBSCRIBE, params);

    const subscription = createSubscription(
      result.subscriptionId,
      () => this.unsubscribe(result.subscriptionId),
      { filter }
    );

    this.#subscriptions.set(result.subscriptionId, subscription);

    return subscription;
  }

  /**
   * Unsubscribe from events
   */
  async unsubscribe(subscriptionId: SubscriptionId): Promise<void> {
    const subscription = this.#subscriptions.get(subscriptionId);
    if (subscription) {
      subscription._close();
      this.#subscriptions.delete(subscriptionId);
    }

    await this.#connection.sendRequest<
      { subscriptionId: SubscriptionId },
      UnsubscribeResponseResult
    >(CORE_METHODS.UNSUBSCRIBE, { subscriptionId });
  }

  // ===========================================================================
  // Steering (requires canSteer capability)
  // ===========================================================================

  /**
   * Inject context into a running agent
   */
  async inject(
    agentId: AgentId,
    content: unknown,
    delivery?: 'interrupt' | 'queue' | 'best-effort'
  ): Promise<InjectResponseResult> {
    const params: InjectRequestParams = { agentId, content };
    if (delivery) params.delivery = delivery;

    return this.#connection.sendRequest(STEERING_METHODS.INJECT, params);
  }

  // ===========================================================================
  // Lifecycle Control (requires canStop capability)
  // ===========================================================================

  /**
   * Request an agent to stop
   */
  async stopAgent(
    agentId: AgentId,
    options?: { reason?: string; force?: boolean }
  ): Promise<{ stopping: boolean; agent?: Agent }> {
    return this.#connection.sendRequest(STATE_METHODS.AGENTS_STOP, {
      agentId,
      ...options,
    });
  }

  /**
   * Suspend an agent
   */
  async suspendAgent(
    agentId: AgentId,
    reason?: string
  ): Promise<{ suspended: boolean; agent?: Agent }> {
    return this.#connection.sendRequest(STATE_METHODS.AGENTS_SUSPEND, {
      agentId,
      reason,
    });
  }

  /**
   * Resume a suspended agent
   */
  async resumeAgent(agentId: AgentId): Promise<{ resumed: boolean; agent?: Agent }> {
    return this.#connection.sendRequest(STATE_METHODS.AGENTS_RESUME, { agentId });
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Handle incoming notifications
   */
  async #handleNotification(method: string, params: unknown): Promise<void> {
    switch (method) {
      case NOTIFICATION_METHODS.EVENT: {
        const eventParams = params as EventNotificationParams;
        const subscription = this.#subscriptions.get(eventParams.subscriptionId);
        if (subscription) {
          subscription._pushEvent(eventParams);
        } else {
          console.warn('MAP: Event for unknown subscription:', eventParams.subscriptionId);
        }
        break;
      }

      case NOTIFICATION_METHODS.MESSAGE: {
        // Message notifications could be handled here if needed
        // For now, they're delivered through event subscriptions
        break;
      }

      default:
        console.warn('MAP: Unknown notification:', method);
    }
  }
}
