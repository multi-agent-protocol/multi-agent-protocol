/**
 * Agent connection for MAP protocol
 *
 * Used by agents to connect to a MAP system, receive messages,
 * update state, spawn children, and communicate with peers.
 */

import type { Stream } from '../stream';
import { BaseConnection, type BaseConnectionOptions } from './base';
import { Subscription, createSubscription } from '../subscription';
import {
  CORE_METHODS,
  LIFECYCLE_METHODS,
  STATE_METHODS,
  SCOPE_METHODS,
  NOTIFICATION_METHODS,
  PROTOCOL_VERSION,
  type ParticipantCapabilities,
  type SessionId,
  type AgentId,
  type ScopeId,
  type SubscriptionId,
  type Address,
  type Agent,
  type AgentState,
  type AgentVisibility,
  type Scope,
  type Message,
  type MessageMeta,
  type SubscriptionFilter,
  type EventNotificationParams,
  type MessageNotificationParams,
  type ConnectRequestParams,
  type ConnectResponseResult,
  type DisconnectResponseResult,
  type AgentsRegisterRequestParams,
  type AgentsRegisterResponseResult,
  type AgentsSpawnRequestParams,
  type AgentsSpawnResponseResult,
  type AgentsUpdateResponseResult,
  type AgentsUnregisterResponseResult,
  type SendRequestParams,
  type SendResponseResult,
  type SubscribeRequestParams,
  type SubscribeResponseResult,
  type UnsubscribeResponseResult,
  type ScopesCreateRequestParams,
  type ScopesCreateResponseResult,
  type ScopesJoinResponseResult,
  type ScopesLeaveResponseResult,
} from '../types';

/**
 * Handler for incoming messages addressed to this agent
 */
export type MessageHandler = (message: Message) => void | Promise<void>;

/**
 * Options for agent connection
 */
export interface AgentConnectionOptions extends BaseConnectionOptions {
  /** Agent name */
  name?: string;
  /** Agent role */
  role?: string;
  /** Agent capabilities */
  capabilities?: ParticipantCapabilities;
  /** Agent visibility */
  visibility?: AgentVisibility;
  /** Parent agent ID (if this is a child agent) */
  parent?: AgentId;
  /** Initial scopes to join */
  scopes?: ScopeId[];
}

/**
 * Agent connection to a MAP system.
 *
 * Provides methods for:
 * - Registering self with the system
 * - Receiving and handling messages
 * - Sending messages to other agents
 * - Spawning child agents
 * - Updating own state
 * - Managing scope memberships
 */
export class AgentConnection {
  readonly #connection: BaseConnection;
  readonly #subscriptions: Map<SubscriptionId, Subscription> = new Map();
  readonly #options: AgentConnectionOptions;
  readonly #messageHandlers: Set<MessageHandler> = new Set();

  #agentId: AgentId | null = null;
  #sessionId: SessionId | null = null;
  #serverCapabilities: ParticipantCapabilities | null = null;
  #currentState: AgentState = 'registered';
  #connected = false;

  constructor(stream: Stream, options: AgentConnectionOptions = {}) {
    this.#connection = new BaseConnection(stream, options);
    this.#options = options;

    // Set up notification handler for events and messages
    this.#connection.setNotificationHandler(this.#handleNotification.bind(this));
  }

  // ===========================================================================
  // Connection Lifecycle
  // ===========================================================================

  /**
   * Connect and register with the MAP system
   */
  async connect(options?: {
    agentId?: AgentId;
    auth?: { method: 'bearer' | 'api-key' | 'mtls' | 'none'; token?: string };
  }): Promise<{ connection: ConnectResponseResult; agent: Agent }> {
    // First, establish the connection
    const connectParams: ConnectRequestParams = {
      protocolVersion: PROTOCOL_VERSION,
      participantType: 'agent',
      participantId: options?.agentId,
      name: this.#options.name,
      capabilities: this.#options.capabilities,
      auth: options?.auth,
    };

    const connectResult = await this.#connection.sendRequest<
      ConnectRequestParams,
      ConnectResponseResult
    >(CORE_METHODS.CONNECT, connectParams);

    this.#sessionId = connectResult.sessionId;
    this.#serverCapabilities = connectResult.capabilities;
    this.#connected = true;

    // Then register as an agent
    const registerParams: AgentsRegisterRequestParams = {
      agentId: options?.agentId,
      name: this.#options.name,
      role: this.#options.role,
      parent: this.#options.parent,
      scopes: this.#options.scopes,
      visibility: this.#options.visibility,
      capabilities: this.#options.capabilities,
    };

    const registerResult = await this.#connection.sendRequest<
      AgentsRegisterRequestParams,
      AgentsRegisterResponseResult
    >(LIFECYCLE_METHODS.AGENTS_REGISTER, registerParams);

    this.#agentId = registerResult.agent.id;
    this.#currentState = registerResult.agent.state;

    return { connection: connectResult, agent: registerResult.agent };
  }

  /**
   * Disconnect from the MAP system
   */
  async disconnect(reason?: string): Promise<void> {
    if (!this.#connected) return;

    try {
      // Unregister the agent first
      if (this.#agentId) {
        await this.#connection.sendRequest<
          { agentId: AgentId; reason?: string },
          AgentsUnregisterResponseResult
        >(LIFECYCLE_METHODS.AGENTS_UNREGISTER, {
          agentId: this.#agentId,
          reason,
        });
      }

      // Then disconnect
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
   * Whether the agent is connected
   */
  get isConnected(): boolean {
    return this.#connected && !this.#connection.isClosed;
  }

  /**
   * This agent's ID
   */
  get agentId(): AgentId | null {
    return this.#agentId;
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
   * Current agent state
   */
  get state(): AgentState {
    return this.#currentState;
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
  // Message Handling
  // ===========================================================================

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler: MessageHandler): this {
    this.#messageHandlers.add(handler);
    return this;
  }

  /**
   * Remove a message handler
   */
  offMessage(handler: MessageHandler): this {
    this.#messageHandlers.delete(handler);
    return this;
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Update this agent's state
   */
  async updateState(state: AgentState): Promise<Agent> {
    if (!this.#agentId) {
      throw new Error('Agent not registered');
    }

    const result = await this.#connection.sendRequest<
      { agentId: AgentId; state: AgentState },
      AgentsUpdateResponseResult
    >(STATE_METHODS.AGENTS_UPDATE, {
      agentId: this.#agentId,
      state,
    });

    this.#currentState = result.agent.state;
    return result.agent;
  }

  /**
   * Update this agent's metadata
   */
  async updateMetadata(metadata: Record<string, unknown>): Promise<Agent> {
    if (!this.#agentId) {
      throw new Error('Agent not registered');
    }

    const result = await this.#connection.sendRequest<
      { agentId: AgentId; metadata: Record<string, unknown> },
      AgentsUpdateResponseResult
    >(STATE_METHODS.AGENTS_UPDATE, {
      agentId: this.#agentId,
      metadata,
    });

    return result.agent;
  }

  /**
   * Mark this agent as busy
   */
  async busy(): Promise<Agent> {
    return this.updateState('busy');
  }

  /**
   * Mark this agent as idle
   */
  async idle(): Promise<Agent> {
    return this.updateState('idle');
  }

  /**
   * Mark this agent as done/stopped
   */
  async done(result?: { exitCode?: number; exitReason?: string }): Promise<void> {
    if (!this.#agentId) {
      throw new Error('Agent not registered');
    }

    await this.updateState('stopped');

    // Optionally update metadata with result
    if (result) {
      await this.updateMetadata({
        exitCode: result.exitCode,
        exitReason: result.exitReason,
      });
    }
  }

  // ===========================================================================
  // Child Agent Management
  // ===========================================================================

  /**
   * Spawn a child agent
   */
  async spawn(options: {
    agentId?: AgentId;
    name?: string;
    role?: string;
    visibility?: AgentVisibility;
    capabilities?: ParticipantCapabilities;
    scopes?: ScopeId[];
    initialMessage?: Message;
    metadata?: Record<string, unknown>;
  }): Promise<AgentsSpawnResponseResult> {
    if (!this.#agentId) {
      throw new Error('Agent not registered');
    }

    const params: AgentsSpawnRequestParams = {
      ...options,
      parent: this.#agentId,
    };

    return this.#connection.sendRequest<
      AgentsSpawnRequestParams,
      AgentsSpawnResponseResult
    >(LIFECYCLE_METHODS.AGENTS_SPAWN, params);
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
   * Send a message to the parent agent
   */
  async sendToParent(payload?: unknown, meta?: MessageMeta): Promise<SendResponseResult> {
    return this.send({ parent: true }, payload, {
      ...meta,
      relationship: 'child-to-parent',
    });
  }

  /**
   * Send a message to child agents
   */
  async sendToChildren(payload?: unknown, meta?: MessageMeta): Promise<SendResponseResult> {
    return this.send({ children: true }, payload, {
      ...meta,
      relationship: 'parent-to-child',
    });
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
   * Send a message to sibling agents
   */
  async sendToSiblings(payload?: unknown, meta?: MessageMeta): Promise<SendResponseResult> {
    return this.send({ siblings: true }, payload, {
      ...meta,
      relationship: 'peer',
    });
  }

  /**
   * Reply to a message (uses correlationId from original)
   */
  async reply(
    originalMessage: Message,
    payload?: unknown,
    meta?: MessageMeta
  ): Promise<SendResponseResult> {
    return this.send({ agent: originalMessage.from as AgentId }, payload, {
      ...meta,
      correlationId: originalMessage.meta?.correlationId ?? originalMessage.id,
      isResult: true,
    });
  }

  // ===========================================================================
  // Scope Management
  // ===========================================================================

  /**
   * Create a new scope
   */
  async createScope(options: ScopesCreateRequestParams): Promise<Scope> {
    const result = await this.#connection.sendRequest<
      ScopesCreateRequestParams,
      ScopesCreateResponseResult
    >(SCOPE_METHODS.SCOPES_CREATE, options);
    return result.scope;
  }

  /**
   * Join a scope
   */
  async joinScope(scopeId: ScopeId): Promise<ScopesJoinResponseResult> {
    if (!this.#agentId) {
      throw new Error('Agent not registered');
    }

    return this.#connection.sendRequest<
      { scopeId: ScopeId; agentId: AgentId },
      ScopesJoinResponseResult
    >(SCOPE_METHODS.SCOPES_JOIN, {
      scopeId,
      agentId: this.#agentId,
    });
  }

  /**
   * Leave a scope
   */
  async leaveScope(scopeId: ScopeId): Promise<ScopesLeaveResponseResult> {
    if (!this.#agentId) {
      throw new Error('Agent not registered');
    }

    return this.#connection.sendRequest<
      { scopeId: ScopeId; agentId: AgentId },
      ScopesLeaveResponseResult
    >(SCOPE_METHODS.SCOPES_LEAVE, {
      scopeId,
      agentId: this.#agentId,
    });
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
        }
        break;
      }

      case NOTIFICATION_METHODS.MESSAGE: {
        const messageParams = params as MessageNotificationParams;
        // Deliver to message handlers
        for (const handler of this.#messageHandlers) {
          try {
            await handler(messageParams.message);
          } catch (error) {
            console.error('MAP: Message handler error:', error);
          }
        }
        break;
      }

      default:
        console.warn('MAP: Unknown notification:', method);
    }
  }
}
