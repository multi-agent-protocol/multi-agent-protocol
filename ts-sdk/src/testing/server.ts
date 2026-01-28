/**
 * Test MAP Server Implementation
 *
 * A simple in-memory MAP server for testing purposes.
 * Implements the core MAP protocol methods.
 */

import type { Stream } from '../stream';
import { BaseConnection } from '../connection/base';
import { MAPRequestError } from '../errors';
import {
  CORE_METHODS,
  OBSERVATION_METHODS,
  LIFECYCLE_METHODS,
  STATE_METHODS,
  STEERING_METHODS,
  SCOPE_METHODS,
  NOTIFICATION_METHODS,
  PROTOCOL_VERSION,
  type Agent,
  type AgentId,
  type AgentState,
  type Scope,
  type ScopeId,
  type SessionId,
  type ParticipantId,
  type ParticipantCapabilities,
  type SubscriptionId,
  type SubscriptionFilter,
  type Message,
  type MessageId,
  type Event,
  type Address,
  type ConnectRequestParams,
  type ConnectResponseResult,
  type AgentsRegisterRequestParams,
  type AgentsListRequestParams,
  type SendRequestParams,
  type SubscribeRequestParams,
  type ScopesCreateRequestParams,
  type InjectRequestParams,
  type DisconnectPolicy,
} from '../types';

/**
 * Participant connection info
 */
interface ParticipantConnection {
  id: ParticipantId;
  type: 'agent' | 'client' | 'gateway';
  name?: string;
  connection: BaseConnection;
  subscriptions: Set<SubscriptionId>;
  agentId?: AgentId; // The agent ID if this participant registered as an agent
}

/**
 * Server subscription info
 */
interface ServerSubscription {
  id: SubscriptionId;
  participantId: ParticipantId;
  filter?: SubscriptionFilter;
  sequenceNumber: number;
}

/**
 * Options for test server
 */
export interface TestServerOptions {
  name?: string;
  version?: string;
  capabilities?: ParticipantCapabilities;
}

/**
 * Test MAP Server
 *
 * Provides a fully functional MAP server for integration testing.
 */
export class TestServer {
  readonly #options: TestServerOptions;
  readonly #participants: Map<ParticipantId, ParticipantConnection> = new Map();
  readonly #agents: Map<AgentId, Agent> = new Map();
  readonly #scopes: Map<ScopeId, Scope & { members: Set<AgentId> }> = new Map();
  readonly #subscriptions: Map<SubscriptionId, ServerSubscription> = new Map();
  readonly #messages: Message[] = [];

  #sessionId: SessionId;
  #nextParticipantId = 1;
  #nextAgentId = 1;
  #nextScopeId = 1;
  #nextSubscriptionId = 1;
  #nextMessageId = 1;

  constructor(options: TestServerOptions = {}) {
    this.#options = options;
    this.#sessionId = `session-${Date.now()}`;
  }

  /**
   * Accept a new connection
   */
  acceptConnection(stream: Stream): BaseConnection {
    const connection = new BaseConnection(stream);
    connection.setRequestHandler(this.#handleRequest.bind(this, connection));
    return connection;
  }

  /**
   * Get current session ID
   */
  get sessionId(): SessionId {
    return this.#sessionId;
  }

  /**
   * Get all registered agents
   */
  get agents(): ReadonlyMap<AgentId, Agent> {
    return this.#agents;
  }

  /**
   * Get all scopes
   */
  get scopes(): ReadonlyMap<ScopeId, Scope> {
    return this.#scopes;
  }

  /**
   * Get all messages sent through the server
   */
  get messages(): readonly Message[] {
    return this.#messages;
  }

  /**
   * Get connected participant count
   */
  get participantCount(): number {
    return this.#participants.size;
  }

  /**
   * Emit an event to subscribers
   */
  emitEvent(event: Omit<Event, 'id' | 'timestamp'>): void {
    const fullEvent: Event = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      ...event,
    };

    for (const subscription of this.#subscriptions.values()) {
      if (this.#matchesFilter(fullEvent, subscription.filter)) {
        const participant = this.#participants.get(subscription.participantId);
        if (participant) {
          subscription.sequenceNumber++;
          participant.connection.sendNotification(NOTIFICATION_METHODS.EVENT, {
            subscriptionId: subscription.id,
            sequenceNumber: subscription.sequenceNumber,
            event: fullEvent,
          });
        }
      }
    }
  }

  /**
   * Deliver a message notification to a participant
   */
  deliverMessage(participantId: ParticipantId, message: Message): void {
    const participant = this.#participants.get(participantId);
    if (participant) {
      participant.connection.sendNotification(NOTIFICATION_METHODS.MESSAGE, {
        message,
      });
    }
  }

  /**
   * Handle incoming requests
   */
  async #handleRequest(
    connection: BaseConnection,
    method: string,
    params: unknown
  ): Promise<unknown> {
    switch (method) {
      // =======================================================================
      // Core Methods
      // =======================================================================

      case CORE_METHODS.CONNECT:
        return this.#handleConnect(connection, params as ConnectRequestParams);

      case CORE_METHODS.DISCONNECT:
        return this.#handleDisconnect(connection, params as { policy?: DisconnectPolicy });

      case CORE_METHODS.SEND:
        return this.#handleSend(connection, params as SendRequestParams);

      case CORE_METHODS.SUBSCRIBE:
        return this.#handleSubscribe(connection, params as SubscribeRequestParams | undefined);

      case CORE_METHODS.UNSUBSCRIBE:
        return this.#handleUnsubscribe(connection, params as { subscriptionId: SubscriptionId });

      // =======================================================================
      // Observation Methods
      // =======================================================================

      case OBSERVATION_METHODS.AGENTS_LIST:
        return this.#handleAgentsList(params as AgentsListRequestParams | undefined);

      case OBSERVATION_METHODS.AGENTS_GET:
        return this.#handleAgentsGet(params as { agentId: AgentId; include?: { children?: boolean; descendants?: boolean } });

      case OBSERVATION_METHODS.SCOPES_LIST:
        return this.#handleScopesList();

      // =======================================================================
      // Lifecycle Methods
      // =======================================================================

      case LIFECYCLE_METHODS.AGENTS_REGISTER:
        return this.#handleAgentsRegister(connection, params as AgentsRegisterRequestParams);

      case LIFECYCLE_METHODS.AGENTS_UNREGISTER:
        return this.#handleAgentsUnregister(params as { agentId: AgentId; reason?: string });

      case LIFECYCLE_METHODS.AGENTS_SPAWN:
        return this.#handleAgentsSpawn(
          connection,
          params as { parent: AgentId; name?: string; role?: string }
        );

      // =======================================================================
      // State Methods
      // =======================================================================

      case STATE_METHODS.AGENTS_UPDATE:
        return this.#handleAgentsUpdate(
          params as { agentId: AgentId; state?: AgentState; metadata?: Record<string, unknown> }
        );

      case STATE_METHODS.AGENTS_STOP:
        return this.#handleAgentsStop(params as { agentId: AgentId; reason?: string });

      // =======================================================================
      // Scope Methods
      // =======================================================================

      case SCOPE_METHODS.SCOPES_CREATE:
        return this.#handleScopesCreate(params as ScopesCreateRequestParams);

      case SCOPE_METHODS.SCOPES_JOIN:
        return this.#handleScopesJoin(params as { scopeId: ScopeId; agentId: AgentId });

      case SCOPE_METHODS.SCOPES_LEAVE:
        return this.#handleScopesLeave(params as { scopeId: ScopeId; agentId: AgentId });

      // =======================================================================
      // Steering Methods
      // =======================================================================

      case STEERING_METHODS.INJECT:
        return this.#handleInject(params as InjectRequestParams);

      default:
        throw MAPRequestError.methodNotFound(method);
    }
  }

  // ===========================================================================
  // Core Method Handlers
  // ===========================================================================

  #handleConnect(
    connection: BaseConnection,
    params: ConnectRequestParams
  ): ConnectResponseResult {
    const participantId = params.participantId || `participant-${this.#nextParticipantId++}`;

    const participant: ParticipantConnection = {
      id: participantId,
      type: params.participantType as 'agent' | 'client' | 'gateway',
      name: params.name,
      connection,
      subscriptions: new Set(),
    };

    this.#participants.set(participantId, participant);

    // Clean up on connection close
    connection.closed.then(() => {
      this.#handleParticipantDisconnect(participantId);
    });

    // Emit participant connected event
    this.emitEvent({
      type: 'participant_connected',
      source: participantId,
      data: { participantId, participantType: params.participantType, name: params.name },
    });

    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      participantId,
      capabilities: this.#options.capabilities ?? {
        observation: { canObserve: true, canQuery: true },
        messaging: { canSend: true, canReceive: true, canBroadcast: true },
        lifecycle: { canSpawn: true, canRegister: true, canUnregister: true, canStop: true, canSteer: true },
        scopes: { canCreateScopes: true, canManageScopes: true },
      },
      systemInfo: {
        name: this.#options.name ?? 'Test MAP Server',
        version: this.#options.version ?? '1.0.0',
      },
    };
  }

  #handleDisconnect(
    connection: BaseConnection,
    params?: { policy?: DisconnectPolicy }
  ): { acknowledged: boolean } {
    // Find and remove participant
    for (const [id, participant] of this.#participants) {
      if (participant.connection === connection) {
        this.#handleParticipantDisconnect(id, params?.policy);
        break;
      }
    }
    return { acknowledged: true };
  }

  #handleParticipantDisconnect(participantId: ParticipantId, policy?: DisconnectPolicy): void {
    const participant = this.#participants.get(participantId);
    if (!participant) return;

    // Remove subscriptions
    for (const subId of participant.subscriptions) {
      this.#subscriptions.delete(subId);
    }

    // Handle agents owned by this participant based on policy
    const ownedAgents = Array.from(this.#agents.values()).filter((a) => a.ownerId === participantId);

    for (const agent of ownedAgents) {
      const agentBehavior = policy?.agentBehavior ?? 'unregister';

      if (agentBehavior === 'unregister') {
        // Unregister the agent and all descendants
        this.#terminateAgentTree(agent.id);
      } else if (agentBehavior === 'orphan') {
        // Mark agent as orphaned (use a special placeholder value)
        const previousOwner = agent.ownerId;
        (agent as { ownerId: ParticipantId }).ownerId = 'orphaned';
        this.emitEvent({
          type: 'agent_orphaned',
          source: agent.id,
          data: { agentId: agent.id, previousOwner },
        });
      }
      // 'grace-period' policy: would implement timeout logic in a real server
    }

    // Emit participant disconnected event
    this.emitEvent({
      type: 'participant_disconnected',
      source: participantId,
      data: { participantId, participantType: participant.type },
    });

    this.#participants.delete(participantId);
  }

  /**
   * Terminate an agent and all its descendants
   */
  #terminateAgentTree(agentId: AgentId): void {
    // Find and terminate children first
    const children = Array.from(this.#agents.values()).filter((a) => a.parent === agentId);
    for (const child of children) {
      this.#terminateAgentTree(child.id);
    }

    // Then terminate this agent
    const agent = this.#agents.get(agentId);
    if (agent) {
      this.#agents.delete(agentId);

      // Remove from all scopes
      for (const scope of this.#scopes.values()) {
        scope.members.delete(agentId);
      }

      this.emitEvent({
        type: 'agent_unregistered',
        source: agentId,
        data: { agentId, reason: 'owner_disconnected' },
      });
    }
  }

  #handleAgentsList(params?: AgentsListRequestParams): { agents: Agent[] } {
    let agents = Array.from(this.#agents.values());

    if (params?.filter) {
      const { states, roles, scopes, parent } = params.filter;

      if (states?.length) {
        agents = agents.filter((a) => states.includes(a.state));
      }
      if (roles?.length) {
        agents = agents.filter((a) => a.role && roles.includes(a.role));
      }
      if (scopes?.length) {
        agents = agents.filter((a) => a.scopes?.some((s) => scopes.includes(s)));
      }
      if (parent) {
        agents = agents.filter((a) => a.parent === parent);
      }
    }

    return { agents };
  }

  #handleAgentsGet(params: {
    agentId: AgentId;
    include?: { children?: boolean; descendants?: boolean };
  }): { agent: Agent; children?: Agent[]; descendants?: Agent[] } {
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    const result: { agent: Agent; children?: Agent[]; descendants?: Agent[] } = { agent };

    if (params.include?.children) {
      result.children = Array.from(this.#agents.values()).filter((a) => a.parent === params.agentId);
    }

    if (params.include?.descendants) {
      result.descendants = this.#getDescendants(params.agentId);
    }

    return result;
  }

  /**
   * Get all descendants of an agent recursively
   */
  #getDescendants(agentId: AgentId): Agent[] {
    const descendants: Agent[] = [];
    const children = Array.from(this.#agents.values()).filter((a) => a.parent === agentId);

    for (const child of children) {
      descendants.push(child);
      descendants.push(...this.#getDescendants(child.id));
    }

    return descendants;
  }

  #handleSend(connection: BaseConnection, params: SendRequestParams): { messageId: MessageId; delivered: ParticipantId[] } {
    const messageId = `msg-${this.#nextMessageId++}`;
    const delivered: ParticipantId[] = [];

    // Find sender
    let senderId: ParticipantId | undefined;
    for (const [id, participant] of this.#participants) {
      if (participant.connection === connection) {
        senderId = id;
        break;
      }
    }

    const message: Message = {
      id: messageId,
      from: senderId ?? 'unknown',
      to: params.to,
      timestamp: Date.now(),
      payload: params.payload,
      meta: params.meta,
    };

    this.#messages.push(message);

    // Resolve recipients
    const recipients = this.#resolveAddress(params.to);

    for (const recipientId of recipients) {
      const participant = this.#participants.get(recipientId);
      if (participant) {
        this.deliverMessage(recipientId, message);
        delivered.push(recipientId);
      }
    }

    // Emit message event
    this.emitEvent({
      type: 'message_sent',
      source: senderId,
      data: { messageId, to: params.to },
    });

    return { messageId, delivered };
  }

  #handleSubscribe(
    connection: BaseConnection,
    params?: SubscribeRequestParams
  ): { subscriptionId: SubscriptionId } {
    // Find participant
    let participantId: ParticipantId | undefined;
    for (const [id, participant] of this.#participants) {
      if (participant.connection === connection) {
        participantId = id;
        break;
      }
    }

    if (!participantId) {
      throw MAPRequestError.authRequired();
    }

    const subscriptionId = `sub-${this.#nextSubscriptionId++}`;

    const subscription: ServerSubscription = {
      id: subscriptionId,
      participantId,
      filter: params?.filter,
      sequenceNumber: 0,
    };

    this.#subscriptions.set(subscriptionId, subscription);
    this.#participants.get(participantId)!.subscriptions.add(subscriptionId);

    return { subscriptionId };
  }

  #handleUnsubscribe(
    _connection: BaseConnection,
    params: { subscriptionId: SubscriptionId }
  ): { unsubscribed: boolean } {
    const subscription = this.#subscriptions.get(params.subscriptionId);
    if (subscription) {
      this.#subscriptions.delete(params.subscriptionId);
      const participant = this.#participants.get(subscription.participantId);
      if (participant) {
        participant.subscriptions.delete(params.subscriptionId);
      }
    }
    return { unsubscribed: true };
  }

  // ===========================================================================
  // Structure Method Handlers
  // ===========================================================================

  #handleAgentsRegister(
    connection: BaseConnection,
    params: AgentsRegisterRequestParams
  ): { agent: Agent } {
    const agentId = params.agentId || `agent-${this.#nextAgentId++}`;

    if (this.#agents.has(agentId)) {
      throw MAPRequestError.agentExists(agentId);
    }

    // Find the owning participant
    let ownerId: ParticipantId = 'unknown';
    for (const [participantId, participant] of this.#participants) {
      if (participant.connection === connection) {
        ownerId = participantId;
        participant.agentId = agentId;
        break;
      }
    }

    const agent: Agent = {
      id: agentId,
      name: params.name,
      description: params.description,
      role: params.role,
      parent: params.parent,
      ownerId, // v2: Track which participant owns this agent
      state: 'registered',
      scopes: params.scopes,
      visibility: params.visibility,
      capabilities: params.capabilities,
      metadata: params.metadata,
      lifecycle: {
        createdAt: Date.now(),
      },
    };

    this.#agents.set(agentId, agent);

    // Emit event
    this.emitEvent({
      type: 'agent_registered',
      source: agentId,
      data: { agentId, name: agent.name, role: agent.role, ownerId },
    });

    return { agent };
  }

  #handleAgentsUnregister(params: { agentId: AgentId; reason?: string }): { unregistered: boolean } {
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    this.#agents.delete(params.agentId);

    // Remove from all scopes
    for (const scope of this.#scopes.values()) {
      scope.members.delete(params.agentId);
    }

    // Emit event
    this.emitEvent({
      type: 'agent_unregistered',
      source: params.agentId,
      data: { agentId: params.agentId, reason: params.reason },
    });

    return { unregistered: true };
  }

  #handleAgentsUpdate(params: {
    agentId: AgentId;
    state?: AgentState;
    metadata?: Record<string, unknown>;
  }): { agent: Agent } {
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    const previousState = agent.state;

    if (params.state) {
      agent.state = params.state;
    }
    if (params.metadata) {
      agent.metadata = { ...agent.metadata, ...params.metadata };
    }

    // Emit state change event
    if (params.state && params.state !== previousState) {
      this.emitEvent({
        type: 'agent_state_changed',
        source: params.agentId,
        data: { agentId: params.agentId, previousState, newState: params.state },
      });
    }

    return { agent };
  }

  #handleAgentsSpawn(
    connection: BaseConnection,
    params: { parent: AgentId; name?: string; role?: string }
  ): { agent: Agent } {
    // Verify parent exists
    if (!this.#agents.has(params.parent)) {
      throw MAPRequestError.agentNotFound(params.parent);
    }

    return this.#handleAgentsRegister(connection, {
      name: params.name,
      role: params.role,
      parent: params.parent,
    });
  }

  #handleAgentsStop(params: { agentId: AgentId; reason?: string }): { stopping: boolean; agent?: Agent } {
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    agent.state = 'stopping';

    this.emitEvent({
      type: 'agent_state_changed',
      source: params.agentId,
      data: { agentId: params.agentId, previousState: agent.state, newState: 'stopping' },
    });

    return { stopping: true, agent };
  }

  #handleScopesList(): { scopes: Scope[] } {
    const scopes = Array.from(this.#scopes.values()).map(({ members, ...scope }) => scope);
    return { scopes };
  }

  #handleScopesCreate(params: ScopesCreateRequestParams): { scope: Scope } {
    const scopeId = params.scopeId || `scope-${this.#nextScopeId++}`;

    const scope: Scope & { members: Set<AgentId> } = {
      id: scopeId,
      name: params.name,
      description: params.description,
      parent: params.parent,
      joinPolicy: params.joinPolicy,
      visibility: params.visibility,
      members: new Set(),
    };

    this.#scopes.set(scopeId, scope);

    this.emitEvent({
      type: 'scope_created',
      data: { scopeId, name: scope.name },
    });

    const { members, ...scopeWithoutMembers } = scope;
    return { scope: scopeWithoutMembers };
  }

  #handleScopesJoin(params: { scopeId: ScopeId; agentId: AgentId }): { scope: Scope; agent: Agent } {
    const scope = this.#scopes.get(params.scopeId);
    if (!scope) {
      throw MAPRequestError.scopeNotFound(params.scopeId);
    }

    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    scope.members.add(params.agentId);

    // Update agent's scope list
    if (!agent.scopes) {
      agent.scopes = [];
    }
    if (!agent.scopes.includes(params.scopeId)) {
      agent.scopes.push(params.scopeId);
    }

    this.emitEvent({
      type: 'scope_member_joined',
      source: params.agentId,
      data: { scopeId: params.scopeId, agentId: params.agentId },
    });

    const { members, ...scopeWithoutMembers } = scope;
    return { scope: scopeWithoutMembers, agent };
  }

  #handleScopesLeave(params: { scopeId: ScopeId; agentId: AgentId }): { scope: Scope; agent: Agent } {
    const scope = this.#scopes.get(params.scopeId);
    if (!scope) {
      throw MAPRequestError.scopeNotFound(params.scopeId);
    }

    scope.members.delete(params.agentId);

    // Update agent's scope list
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }
    if (agent.scopes) {
      agent.scopes = agent.scopes.filter((s) => s !== params.scopeId);
    }

    this.emitEvent({
      type: 'scope_member_left',
      source: params.agentId,
      data: { scopeId: params.scopeId, agentId: params.agentId },
    });

    const { members, ...scopeWithoutMembers } = scope;
    return { scope: scopeWithoutMembers, agent };
  }

  // ===========================================================================
  // Extension Method Handlers
  // ===========================================================================

  #handleInject(params: InjectRequestParams): { injected: boolean; delivery?: string } {
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    // In a real server, this would inject content into the agent
    // For testing, we just acknowledge it
    return { injected: true, delivery: params.delivery ?? 'queue' };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  #resolveAddress(address: Address): ParticipantId[] {
    if (typeof address === 'string') {
      // Could be either a participant ID or agent ID
      return [this.#findParticipantForAgent(address) ?? address];
    }

    if ('agent' in address && !('system' in address)) {
      const participantId = this.#findParticipantForAgent(address.agent);
      return participantId ? [participantId] : [];
    }

    if ('agents' in address) {
      return address.agents
        .map((agentId) => this.#findParticipantForAgent(agentId))
        .filter((id): id is ParticipantId => id !== undefined);
    }

    if ('scope' in address) {
      const scope = this.#scopes.get(address.scope);
      if (!scope) return [];
      return Array.from(scope.members)
        .map((agentId) => this.#findParticipantForAgent(agentId))
        .filter((id): id is ParticipantId => id !== undefined);
    }

    if ('broadcast' in address) {
      return Array.from(this.#participants.keys());
    }

    if ('role' in address) {
      const agents = Array.from(this.#agents.values()).filter((a) => a.role === address.role);
      return agents
        .map((a) => this.#findParticipantForAgent(a.id))
        .filter((id): id is ParticipantId => id !== undefined);
    }

    if ('parent' in address || 'children' in address) {
      // Hierarchical addressing - simplified implementation
      return [];
    }

    return [];
  }

  /**
   * Find the participant ID that registered a given agent
   */
  #findParticipantForAgent(agentId: AgentId): ParticipantId | undefined {
    for (const [participantId, participant] of this.#participants) {
      if (participant.agentId === agentId) {
        return participantId;
      }
    }
    return undefined;
  }

  #matchesFilter(event: Event, filter?: SubscriptionFilter): boolean {
    if (!filter) return true;

    // Filter by event types
    if (filter.eventTypes?.length) {
      if (!filter.eventTypes.includes(event.type)) {
        return false;
      }
    }

    // Filter by specific agents (legacy)
    if (filter.agents?.length && event.source) {
      if (!filter.agents.includes(event.source)) {
        return false;
      }
    }

    // Filter by source agents (v2)
    if (filter.fromAgents?.length && event.source) {
      if (!filter.fromAgents.includes(event.source)) {
        return false;
      }
    }

    // Filter by scopes
    if (filter.scopes?.length) {
      const eventData = event.data as Record<string, unknown> | undefined;
      const scopeId = eventData?.scopeId as string | undefined;
      if (!scopeId || !filter.scopes.includes(scopeId)) {
        return false;
      }
    }

    // Filter by roles (v2) - check if source agent has matching role
    if (filter.fromRoles?.length && event.source) {
      const agent = this.#agents.get(event.source);
      if (!agent?.role || !filter.fromRoles.includes(agent.role)) {
        return false;
      }
    }

    // Filter by correlation IDs (v2)
    if (filter.correlationIds?.length) {
      const eventData = event.data as Record<string, unknown> | undefined;
      const correlationId = eventData?.correlationId as string | undefined;
      if (!correlationId || !filter.correlationIds.includes(correlationId)) {
        return false;
      }
    }

    // Filter by metadata match (v2)
    if (filter.metadataMatch) {
      const eventData = event.data as Record<string, unknown> | undefined;
      const metadata = eventData?.metadata as Record<string, unknown> | undefined;
      if (!metadata) return false;

      for (const [key, value] of Object.entries(filter.metadataMatch)) {
        if (metadata[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }
}
