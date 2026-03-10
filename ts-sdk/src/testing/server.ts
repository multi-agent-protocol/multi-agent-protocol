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
  FEDERATION_METHODS,
  TASK_METHODS,
  NOTIFICATION_METHODS,
  PERMISSION_METHODS,
  PROTOCOL_VERSION,
  EVENT_TYPES,
  type Agent,
  type AgentId,
  type Scope,
  type ScopeId,
  type SessionId,
  type ParticipantId,
  type ParticipantCapabilities,
  type SubscriptionId,
  type SubscriptionFilter,
  type SubscriptionAckParams,
  type Message,
  type MessageId,
  type Event,
  type Address,
  type MAPTask,
  type TaskId,
  type MAPTaskStatus,
  type ConnectRequestParams,
  type ConnectResponseResult,
  type AgentsRegisterRequestParams,
  type AgentsListRequestParams,
  type SendRequestParams,
  type SubscribeRequestParams,
  type ScopesCreateRequestParams,
  type InjectRequestParams,
  type DisconnectPolicy,
  type ReplayRequestParams,
  type ReplayResponseResult,
  type TasksCreateRequestParams,
  type TasksAssignRequestParams,
  type TasksUpdateRequestParams,
  type TasksListRequestParams,
  type FederationRouteRequestParams,
  type FederationRoutingConfig,
  type FederationEnvelope,
  type PermissionsUpdateRequestParams,
  type PermissionsUpdateResponseResult,
  type AgentPermissions,
  type AgentsUpdateRequestParams,
} from '../types';
import {
  processFederationEnvelope,
  isValidEnvelope,
  unwrapEnvelope,
} from '../federation';
import {
  type SystemExposure,
  type PermissionContext,
  filterVisibleAgents,
  filterVisibleScopes,
  isEventTypeExposed,
} from '../permissions';
import {
  buildConnectResponse,
  buildSendResponse,
  buildAgentsRegisterResponse,
  buildAgentsUnregisterResponse,
  buildAgentsListResponse,
  buildAgentsGetResponse,
  buildAgentsUpdateResponse,
  buildScopesCreateResponse,
  buildScopesListResponse,
  buildScopesJoinResponse,
  buildScopesLeaveResponse,
  buildSubscribeResponse,
  buildUnsubscribeResponse,
} from '../protocol';
import { ulid } from '../utils';

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
  /** Current effective capabilities for this participant */
  capabilities?: ParticipantCapabilities;
}

/**
 * Server subscription info
 */
interface ServerSubscription {
  id: SubscriptionId;
  participantId: ParticipantId;
  filter?: SubscriptionFilter;
  sequenceNumber: number;
  /** Last acknowledged sequence number from client */
  lastAckedSequence?: number;
}

/**
 * Options for test server
 */
export interface TestServerOptions {
  name?: string;
  version?: string;
  capabilities?: ParticipantCapabilities;
  /** Maximum number of events to retain for replay. Default: 10000 */
  maxEventHistory?: number;
  /** System exposure configuration for permission filtering */
  exposure?: SystemExposure;
  /** Federation routing configuration for envelope validation */
  federationRouting?: FederationRoutingConfig;
}

/**
 * Stored event for replay capability
 */
interface StoredEvent {
  eventId: string;
  timestamp: number;
  event: Event;
  /** Event IDs that caused this event */
  causedBy?: string[];
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
  readonly #tasks: Map<TaskId, MAPTask> = new Map();
  readonly #messages: Message[] = [];
  readonly #eventHistory: StoredEvent[] = [];
  readonly #maxEventHistory: number;

  /**
   * Tracks recent event IDs for causal linking.
   * Key format: "type:source" or "type:messageId" for message events
   */
  readonly #recentEventIds: Map<string, string> = new Map();

  #sessionId: SessionId;
  #nextParticipantId = 1;
  #nextAgentId = 1;
  #nextScopeId = 1;
  #nextSubscriptionId = 1;
  #nextMessageId = 1;
  #nextTaskId = 1;

  constructor(options: TestServerOptions = {}) {
    this.#options = options;
    this.#sessionId = `session-${Date.now()}`;
    this.#maxEventHistory = options.maxEventHistory ?? 10000;
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
   * Get all tasks
   */
  get tasks(): ReadonlyMap<TaskId, MAPTask> {
    return this.#tasks;
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
   * Get event history for replay testing
   */
  get eventHistory(): readonly StoredEvent[] {
    return this.#eventHistory;
  }

  /**
   * Emit an event to subscribers
   * @param event - The event to emit (without id/timestamp)
   * @param causedBy - Optional array of event IDs that caused this event
   * @returns The generated event ID
   */
  emitEvent(event: Omit<Event, 'id' | 'timestamp'>, causedBy?: string[]): string {
    const eventId = ulid();
    const timestamp = Date.now();
    const fullEvent: Event = {
      id: `evt-${timestamp}-${Math.random().toString(36).slice(2)}`,
      timestamp,
      ...event,
    };

    // Check system exposure for this event type
    if (!isEventTypeExposed(this.#options.exposure, event.type)) {
      // Event type is hidden - don't emit or store
      return eventId;
    }

    // Store in event history for replay
    this.#eventHistory.push({ eventId, timestamp, event: fullEvent, causedBy });

    // Track this event ID for future causal linking
    const trackingKey = event.source ? `${event.type}:${event.source}` : event.type;
    this.#recentEventIds.set(trackingKey, eventId);

    // Also track by specific data fields for certain event types
    const eventData = event.data as Record<string, unknown> | undefined;
    if (eventData?.messageId) {
      this.#recentEventIds.set(`message:${eventData.messageId}`, eventId);
    }
    if (eventData?.agentId) {
      this.#recentEventIds.set(`${event.type}:agent:${eventData.agentId}`, eventId);
    }

    // Evict oldest events if we exceed the limit
    while (this.#eventHistory.length > this.#maxEventHistory) {
      this.#eventHistory.shift();
    }

    for (const subscription of this.#subscriptions.values()) {
      if (this.#matchesFilter(fullEvent, subscription.filter)) {
        const participant = this.#participants.get(subscription.participantId);
        if (participant) {
          subscription.sequenceNumber++;
          participant.connection.sendNotification(NOTIFICATION_METHODS.EVENT, {
            subscriptionId: subscription.id,
            sequenceNumber: subscription.sequenceNumber,
            eventId,
            timestamp,
            event: fullEvent,
            causedBy,
          });
        }
      }
    }

    return eventId;
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

      case CORE_METHODS.REPLAY:
        return this.#handleReplay(params as ReplayRequestParams | undefined);

      // =======================================================================
      // Observation Methods
      // =======================================================================

      case OBSERVATION_METHODS.AGENTS_LIST:
        return this.#handleAgentsList(connection, params as AgentsListRequestParams | undefined);

      case OBSERVATION_METHODS.AGENTS_GET:
        return this.#handleAgentsGet(params as { agentId: AgentId; include?: { children?: boolean; descendants?: boolean } });

      case OBSERVATION_METHODS.SCOPES_LIST:
        return this.#handleScopesList(connection);

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
        return this.#handleAgentsUpdate(connection, params as AgentsUpdateRequestParams);

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

      // =======================================================================
      // Federation Methods
      // =======================================================================

      case FEDERATION_METHODS.FEDERATION_ROUTE:
        return this.#handleFederationRoute(params as FederationRouteRequestParams);

      // =======================================================================
      // Notification Methods (client → server)
      // =======================================================================

      case NOTIFICATION_METHODS.SUBSCRIBE_ACK:
        return this.#handleSubscriptionAck(params as SubscriptionAckParams);

      // =======================================================================
      // Permission Methods
      // =======================================================================

      case PERMISSION_METHODS.PERMISSIONS_UPDATE:
        return this.#handlePermissionsUpdate(
          connection,
          params as PermissionsUpdateRequestParams
        );

      // =======================================================================
      // Task Methods
      // =======================================================================

      case TASK_METHODS.TASKS_CREATE:
        return this.#handleTasksCreate(params as TasksCreateRequestParams);

      case TASK_METHODS.TASKS_ASSIGN:
        return this.#handleTasksAssign(params as TasksAssignRequestParams);

      case TASK_METHODS.TASKS_UPDATE:
        return this.#handleTasksUpdate(params as TasksUpdateRequestParams);

      case TASK_METHODS.TASKS_LIST:
        return this.#handleTasksList(params as TasksListRequestParams | undefined);

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
      capabilities: params.capabilities,
    };

    this.#participants.set(participantId, participant);

    // Clean up on connection close
    connection.closed.then(() => {
      this.#handleParticipantDisconnect(participantId);
    });

    // Emit participant connected event
    this.emitEvent({
      type: EVENT_TYPES.PARTICIPANT_CONNECTED,
      source: participantId,
      data: { participantId, participantType: params.participantType, name: params.name },
    });

    return buildConnectResponse({
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.#sessionId,
      participantId,
      capabilities: this.#options.capabilities ?? {
        observation: { canObserve: true, canQuery: true },
        messaging: { canSend: true, canReceive: true, canBroadcast: true },
        lifecycle: { canSpawn: true, canRegister: true, canUnregister: true, canStop: true, canSteer: true },
        scopes: { canCreateScopes: true, canManageScopes: true },
        streaming: { supportsAck: true, supportsPause: true },
      },
      systemInfo: {
        name: this.#options.name ?? 'Test MAP Server',
        version: this.#options.version ?? '1.0.0',
      },
    });
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

    // Emit participant disconnected event FIRST (this is the cause)
    const disconnectEventId = this.emitEvent({
      type: EVENT_TYPES.PARTICIPANT_DISCONNECTED,
      source: participantId,
      data: { participantId, participantType: participant.type },
    });

    // Handle agents owned by this participant based on policy
    const ownedAgents = Array.from(this.#agents.values()).filter((a) => a.ownerId === participantId);

    for (const agent of ownedAgents) {
      const agentBehavior = policy?.agentBehavior ?? 'unregister';

      if (agentBehavior === 'unregister') {
        // Unregister the agent and all descendants, caused by disconnect
        this.#terminateAgentTree(agent.id, [disconnectEventId]);
      } else if (agentBehavior === 'orphan') {
        // Mark agent as orphaned by setting ownerId to null
        const previousOwner = agent.ownerId;
        (agent as { ownerId: ParticipantId | null }).ownerId = null;
        this.emitEvent(
          {
            type: EVENT_TYPES.AGENT_ORPHANED,
            source: agent.id,
            data: { agentId: agent.id, previousOwner },
          },
          [disconnectEventId] // Caused by the disconnect event
        );
      }
      // 'grace-period' policy: would implement timeout logic in a real server
    }

    this.#participants.delete(participantId);
  }

  /**
   * Terminate an agent and all its descendants
   * @param agentId - Agent to terminate
   * @param causedBy - Event IDs that caused this termination (e.g., disconnect event)
   */
  #terminateAgentTree(agentId: AgentId, causedBy?: string[]): void {
    // Find and terminate children first
    const children = Array.from(this.#agents.values()).filter((a) => a.parent === agentId);
    for (const child of children) {
      this.#terminateAgentTree(child.id, causedBy);
    }

    // Then terminate this agent
    const agent = this.#agents.get(agentId);
    if (agent) {
      this.#agents.delete(agentId);

      // Remove from all scopes
      for (const scope of this.#scopes.values()) {
        scope.members.delete(agentId);
      }

      this.emitEvent(
        {
          type: EVENT_TYPES.AGENT_UNREGISTERED,
          source: agentId,
          data: { agentId, reason: 'owner_disconnected' },
        },
        causedBy
      );
    }
  }

  #handleAgentsList(connection: BaseConnection, params?: AgentsListRequestParams): { agents: Agent[] } {
    let agents = Array.from(this.#agents.values());

    // Apply permission filtering if exposure is configured
    const permissionContext = this.#buildPermissionContext(connection);
    if (permissionContext) {
      agents = filterVisibleAgents(agents, permissionContext);
    }

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

    return buildAgentsListResponse(agents);
  }

  #handleAgentsGet(params: {
    agentId: AgentId;
    include?: { children?: boolean; descendants?: boolean };
  }): { agent: Agent; children?: Agent[]; descendants?: Agent[] } {
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    const children = params.include?.children
      ? Array.from(this.#agents.values()).filter((a) => a.parent === params.agentId)
      : undefined;

    const descendants = params.include?.descendants
      ? this.#getDescendants(params.agentId)
      : undefined;

    return buildAgentsGetResponse(agent, children, descendants);
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

  #handleSend(connection: BaseConnection, params: SendRequestParams): { messageId: MessageId; delivered?: ParticipantId[] } {
    const messageId = `msg-${this.#nextMessageId++}`;
    const delivered: ParticipantId[] = [];

    // Find sender participant and their agent ID (for hierarchical addressing)
    let senderId: ParticipantId | undefined;
    let senderAgentId: AgentId | undefined;
    for (const [id, participant] of this.#participants) {
      if (participant.connection === connection) {
        senderId = id;
        senderAgentId = participant.agentId;
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

    // Resolve recipients (pass sender agent ID for hierarchical addressing)
    const recipients = this.#resolveAddress(params.to, senderAgentId);

    for (const recipientId of recipients) {
      const participant = this.#participants.get(recipientId);
      if (participant) {
        this.deliverMessage(recipientId, message);
        delivered.push(recipientId);

        // Emit message_delivered event with full message for subscriptions
        // Source is the sender (so fromAgents filter works for ACP-over-MAP)
        this.emitEvent({
          type: EVENT_TYPES.MESSAGE_DELIVERED,
          source: senderAgentId ?? senderId,
          data: { messageId, message, correlationId: params.meta?.correlationId },
        });
      }
    }

    // Emit message_sent event (includes full message for observation)
    this.emitEvent({
      type: EVENT_TYPES.MESSAGE_SENT,
      source: senderId,
      data: { messageId, to: params.to, message },
    });

    return buildSendResponse(messageId, delivered);
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

    return buildSubscribeResponse(subscriptionId);
  }

  #handleUnsubscribe(
    _connection: BaseConnection,
    params: { subscriptionId: SubscriptionId }
  ): { subscription: { id: SubscriptionId; closedAt: number } } {
    const subscription = this.#subscriptions.get(params.subscriptionId);
    if (subscription) {
      this.#subscriptions.delete(params.subscriptionId);
      const participant = this.#participants.get(subscription.participantId);
      if (participant) {
        participant.subscriptions.delete(params.subscriptionId);
      }
    }
    return buildUnsubscribeResponse(params.subscriptionId);
  }

  #handleReplay(params?: ReplayRequestParams): ReplayResponseResult {
    const {
      afterEventId,
      fromTimestamp,
      toTimestamp,
      filter,
      limit = 100,
    } = params ?? {};

    // Start with all events
    let events = [...this.#eventHistory];

    // Apply afterEventId filter (keyset pagination)
    if (afterEventId) {
      const idx = events.findIndex((e) => e.eventId === afterEventId);
      if (idx >= 0) {
        events = events.slice(idx + 1);
      }
      // If not found, return all events (could also throw error)
    }

    // Apply timestamp filters
    if (fromTimestamp !== undefined) {
      events = events.filter((e) => e.timestamp >= fromTimestamp);
    }
    if (toTimestamp !== undefined) {
      events = events.filter((e) => e.timestamp <= toTimestamp);
    }

    // Apply subscription filter
    if (filter) {
      events = events.filter((e) => this.#matchesFilter(e.event, filter));
    }

    // Determine if there are more events beyond the limit
    const hasMore = events.length > limit;

    // Apply limit
    events = events.slice(0, Math.min(limit, 1000));

    return {
      events: events.map((e) => ({
        eventId: e.eventId,
        timestamp: e.timestamp,
        event: e.event,
        causedBy: e.causedBy,
      })),
      hasMore,
      totalCount: this.#eventHistory.length,
    };
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
      permissionOverrides: params.permissionOverrides,
      lifecycle: {
        createdAt: Date.now(),
      },
    };

    this.#agents.set(agentId, agent);

    // Emit event
    this.emitEvent({
      type: EVENT_TYPES.AGENT_REGISTERED,
      source: agentId,
      data: { agentId, name: agent.name, role: agent.role, ownerId },
    });

    return buildAgentsRegisterResponse(agent);
  }

  #handleAgentsUnregister(params: { agentId: AgentId; reason?: string }): { agent: Agent } {
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    // Save a copy before deleting
    const agentCopy = { ...agent };

    this.#agents.delete(params.agentId);

    // Remove from all scopes
    for (const scope of this.#scopes.values()) {
      scope.members.delete(params.agentId);
    }

    // Emit event
    this.emitEvent({
      type: EVENT_TYPES.AGENT_UNREGISTERED,
      source: params.agentId,
      data: { agentId: params.agentId, reason: params.reason },
    });

    return buildAgentsUnregisterResponse(agentCopy);
  }

  #handleAgentsUpdate(
    connection: BaseConnection,
    params: AgentsUpdateRequestParams
  ): { agent: Agent } {
    const agent = this.#agents.get(params.agentId);
    if (!agent) {
      throw MAPRequestError.agentNotFound(params.agentId);
    }

    // Find the requesting participant (for event tracking)
    let requestingParticipantId: ParticipantId | undefined;
    for (const [id, p] of this.#participants) {
      if (p.connection === connection) {
        requestingParticipantId = id;
        break;
      }
    }

    const previousState = agent.state;

    if (params.state) {
      agent.state = params.state;
    }
    if (params.metadata) {
      agent.metadata = { ...agent.metadata, ...params.metadata };
    }

    // Handle permission overrides
    if (params.permissionOverrides) {
      // Merge with existing overrides
      const existingOverrides = agent.permissionOverrides ?? {};
      const newOverrides: Partial<AgentPermissions> = {};

      // Deep merge each permission category
      if (existingOverrides.canSee || params.permissionOverrides.canSee) {
        newOverrides.canSee = {
          ...existingOverrides.canSee,
          ...params.permissionOverrides.canSee,
        };
      }
      if (existingOverrides.canMessage || params.permissionOverrides.canMessage) {
        newOverrides.canMessage = {
          ...existingOverrides.canMessage,
          ...params.permissionOverrides.canMessage,
        };
      }
      if (existingOverrides.acceptsFrom || params.permissionOverrides.acceptsFrom) {
        newOverrides.acceptsFrom = {
          ...existingOverrides.acceptsFrom,
          ...params.permissionOverrides.acceptsFrom,
        };
      }

      agent.permissionOverrides = newOverrides;

      // Emit permissions_agent_updated event
      this.emitEvent({
        type: EVENT_TYPES.PERMISSIONS_AGENT_UPDATED,
        source: params.agentId,
        data: {
          agentId: params.agentId,
          changes: params.permissionOverrides,
          effectivePermissions: newOverrides as AgentPermissions,
          updatedBy: requestingParticipantId,
        },
      });
    }

    // Emit state change event
    if (params.state && params.state !== previousState) {
      this.emitEvent({
        type: EVENT_TYPES.AGENT_STATE_CHANGED,
        source: params.agentId,
        data: { agentId: params.agentId, previousState, newState: params.state },
      });
    }

    return buildAgentsUpdateResponse(agent);
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
      type: EVENT_TYPES.AGENT_STATE_CHANGED,
      source: params.agentId,
      data: { agentId: params.agentId, previousState: agent.state, newState: 'stopping' },
    });

    return { stopping: true, agent };
  }

  #handleScopesList(connection: BaseConnection): { scopes: Scope[] } {
    let scopes: Scope[] = Array.from(this.#scopes.values()).map(({ members, ...scope }) => scope);

    // Apply permission filtering if exposure is configured
    const permissionContext = this.#buildPermissionContext(connection);
    if (permissionContext) {
      scopes = filterVisibleScopes(scopes, permissionContext);
    }

    return buildScopesListResponse(scopes);
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
      type: EVENT_TYPES.SCOPE_CREATED,
      data: { scopeId, name: scope.name },
    });

    const { members, ...scopeWithoutMembers } = scope;
    return buildScopesCreateResponse(scopeWithoutMembers);
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
      type: EVENT_TYPES.SCOPE_MEMBER_JOINED,
      source: params.agentId,
      data: { scopeId: params.scopeId, agentId: params.agentId },
    });

    const { members, ...scopeWithoutMembers } = scope;
    return buildScopesJoinResponse(scopeWithoutMembers, agent);
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
      type: EVENT_TYPES.SCOPE_MEMBER_LEFT,
      source: params.agentId,
      data: { scopeId: params.scopeId, agentId: params.agentId },
    });

    const { members, ...scopeWithoutMembers } = scope;
    return buildScopesLeaveResponse(scopeWithoutMembers, agent);
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

  /**
   * Build a permission context for a connection.
   * Returns undefined if no exposure configuration is set.
   */
  #buildPermissionContext(connection: BaseConnection): PermissionContext | undefined {
    if (!this.#options.exposure) {
      return undefined;
    }

    // Find the participant for this connection
    let participant: ParticipantConnection | undefined;
    for (const p of this.#participants.values()) {
      if (p.connection === connection) {
        participant = p;
        break;
      }
    }

    if (!participant) {
      return undefined;
    }

    // Get owned agent IDs
    const ownedAgentIds: AgentId[] = [];
    for (const agent of this.#agents.values()) {
      if (agent.ownerId === participant.id) {
        ownedAgentIds.push(agent.id);
      }
    }

    // Build scope membership map
    const scopeMembership = new Map<ScopeId, AgentId[]>();
    for (const [scopeId, scope] of this.#scopes) {
      const memberAgentIds = Array.from(scope.members).filter((agentId) =>
        ownedAgentIds.includes(agentId)
      );
      if (memberAgentIds.length > 0) {
        scopeMembership.set(scopeId, memberAgentIds);
      }
    }

    return {
      system: { exposure: this.#options.exposure },
      participant: {
        id: participant.id,
        type: participant.type,
        capabilities: this.#options.capabilities ?? {
          observation: { canObserve: true, canQuery: true },
          messaging: { canSend: true, canReceive: true, canBroadcast: true },
          lifecycle: { canSpawn: true, canRegister: true, canUnregister: true, canStop: true, canSteer: true },
          scopes: { canCreateScopes: true, canManageScopes: true },
        },
      },
      ownedAgentIds,
      scopeMembership,
    };
  }

  #resolveAddress(address: Address, senderAgentId?: AgentId): ParticipantId[] {
    if (typeof address === 'string') {
      // Could be either a participant ID or agent ID
      return [this.#findParticipantForAgent(address) ?? address];
    }

    if ('participant' in address && address.participant) {
      // Direct participant addressing
      return this.#participants.has(address.participant) ? [address.participant] : [];
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

    // Hierarchical addressing - requires sender agent context
    if ('parent' in address || 'children' in address || 'siblings' in address ||
        'ancestors' in address || 'descendants' in address) {
      return this.#resolveHierarchicalAddress(address, senderAgentId);
    }

    return [];
  }

  /**
   * Resolve hierarchical address relative to sender agent
   */
  #resolveHierarchicalAddress(
    address: { parent?: true; children?: true; siblings?: true; ancestors?: true; descendants?: true; depth?: number },
    senderAgentId?: AgentId
  ): ParticipantId[] {
    if (!senderAgentId) return [];

    const senderAgent = this.#agents.get(senderAgentId);
    if (!senderAgent) return [];

    const targetAgentIds: AgentId[] = [];
    const depth = address.depth;

    // Parent - direct parent only
    if (address.parent && senderAgent.parent) {
      targetAgentIds.push(senderAgent.parent);
    }

    // Children - direct children only
    if (address.children) {
      const children = Array.from(this.#agents.values())
        .filter((a) => a.parent === senderAgentId);
      targetAgentIds.push(...children.map((a) => a.id));
    }

    // Siblings - agents with same parent (excluding self)
    if (address.siblings && senderAgent.parent) {
      const siblings = Array.from(this.#agents.values())
        .filter((a) => a.parent === senderAgent.parent && a.id !== senderAgentId);
      targetAgentIds.push(...siblings.map((a) => a.id));
    }

    // Ancestors - parent, grandparent, etc. (with optional depth limit)
    if (address.ancestors) {
      let currentAgent = senderAgent;
      let currentDepth = 0;
      while (currentAgent.parent && (depth === undefined || currentDepth < depth)) {
        targetAgentIds.push(currentAgent.parent);
        currentAgent = this.#agents.get(currentAgent.parent)!;
        if (!currentAgent) break;
        currentDepth++;
      }
    }

    // Descendants - children, grandchildren, etc. (with optional depth limit)
    if (address.descendants) {
      const collectDescendants = (agentId: AgentId, currentDepth: number): void => {
        if (depth !== undefined && currentDepth >= depth) return;

        const children = Array.from(this.#agents.values())
          .filter((a) => a.parent === agentId);

        for (const child of children) {
          targetAgentIds.push(child.id);
          collectDescendants(child.id, currentDepth + 1);
        }
      };
      collectDescendants(senderAgentId, 0);
    }

    // Convert agent IDs to participant IDs
    return targetAgentIds
      .map((agentId) => this.#findParticipantForAgent(agentId))
      .filter((id): id is ParticipantId => id !== undefined);
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

    // Filter by source agents
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

  // ===========================================================================
  // Federation Method Handlers
  // ===========================================================================

  #handleFederationRoute(params: FederationRouteRequestParams): { routed: boolean; messageId?: MessageId } {
    const { systemId, envelope, message } = params;

    let actualMessage: Message;

    // Handle envelope format (preferred)
    if (envelope && isValidEnvelope(envelope)) {
      // Validate routing if configured
      if (this.#options.federationRouting) {
        const result = processFederationEnvelope(
          envelope as FederationEnvelope<Message>,
          this.#options.federationRouting
        );
        if (!result.success) {
          throw new MAPRequestError(result.errorCode, result.errorMessage);
        }
      }
      actualMessage = unwrapEnvelope(envelope as FederationEnvelope<Message>);
    } else if (message) {
      // Backwards compatibility: plain message format
      actualMessage = message;
    } else {
      throw MAPRequestError.invalidParams('Missing envelope or message');
    }

    // Store the message (for testing purposes)
    this.#messages.push(actualMessage);

    // Emit federation event
    this.emitEvent({
      type: EVENT_TYPES.MESSAGE_SENT,
      source: actualMessage.from,
      data: {
        messageId: actualMessage.id,
        from: actualMessage.from,
        to: actualMessage.to,
        federatedTo: systemId,
      },
    });

    return { routed: true, messageId: actualMessage.id };
  }

  // ===========================================================================
  // Notification Handlers
  // ===========================================================================

  #handleSubscriptionAck(params: SubscriptionAckParams): void {
    const { subscriptionId, upToSequence } = params;
    const subscription = this.#subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.lastAckedSequence = upToSequence;
    }
    // Notifications don't return a response, but we need to return something
    // to avoid errors. The connection layer handles notifications specially.
  }

  /**
   * Get ack state for a subscription (for testing assertions)
   */
  getSubscriptionAckState(subscriptionId: SubscriptionId): { sequenceNumber: number; lastAckedSequence?: number } | undefined {
    const subscription = this.#subscriptions.get(subscriptionId);
    if (!subscription) return undefined;
    return {
      sequenceNumber: subscription.sequenceNumber,
      lastAckedSequence: subscription.lastAckedSequence,
    };
  }

  // ===========================================================================
  // Permission Handlers
  // ===========================================================================

  /**
   * Handle permissions update request.
   * Updates client capabilities and emits permission update event.
   */
  #handlePermissionsUpdate(
    connection: BaseConnection,
    params: PermissionsUpdateRequestParams
  ): PermissionsUpdateResponseResult {
    const { clientId, permissions } = params;

    // Find the target client
    const targetParticipant = this.#participants.get(clientId);
    if (!targetParticipant) {
      throw MAPRequestError.invalidParams(`Client ${clientId} not found`);
    }

    // Find the requesting participant (for event tracking)
    let requestingParticipantId: ParticipantId | undefined;
    for (const [id, p] of this.#participants) {
      if (p.connection === connection) {
        requestingParticipantId = id;
        break;
      }
    }

    // Merge permissions with existing
    const existingCapabilities = targetParticipant.capabilities ?? {};
    const effectivePermissions: ParticipantCapabilities = {};

    // Copy existing capabilities
    if (existingCapabilities.observation) {
      effectivePermissions.observation = { ...existingCapabilities.observation };
    }
    if (existingCapabilities.messaging) {
      effectivePermissions.messaging = { ...existingCapabilities.messaging };
    }
    if (existingCapabilities.lifecycle) {
      effectivePermissions.lifecycle = { ...existingCapabilities.lifecycle };
    }
    if (existingCapabilities.scopes) {
      effectivePermissions.scopes = { ...existingCapabilities.scopes };
    }
    if (existingCapabilities.federation) {
      effectivePermissions.federation = { ...existingCapabilities.federation };
    }
    if (existingCapabilities.streaming) {
      effectivePermissions.streaming = { ...existingCapabilities.streaming };
    }

    // Merge in new permissions
    if (permissions.observation) {
      effectivePermissions.observation = {
        ...effectivePermissions.observation,
        ...permissions.observation,
      };
    }
    if (permissions.messaging) {
      effectivePermissions.messaging = {
        ...effectivePermissions.messaging,
        ...permissions.messaging,
      };
    }
    if (permissions.lifecycle) {
      effectivePermissions.lifecycle = {
        ...effectivePermissions.lifecycle,
        ...permissions.lifecycle,
      };
    }
    if (permissions.scopes) {
      effectivePermissions.scopes = {
        ...effectivePermissions.scopes,
        ...permissions.scopes,
      };
    }
    if (permissions.federation) {
      effectivePermissions.federation = {
        ...effectivePermissions.federation,
        ...permissions.federation,
      };
    }
    if (permissions.streaming) {
      effectivePermissions.streaming = {
        ...effectivePermissions.streaming,
        ...permissions.streaming,
      };
    }

    // Update the participant's capabilities
    targetParticipant.capabilities = effectivePermissions;

    // Emit permissions_client_updated event
    this.emitEvent({
      type: EVENT_TYPES.PERMISSIONS_CLIENT_UPDATED,
      data: {
        clientId,
        changes: permissions,
        effectivePermissions,
        changedBy: requestingParticipantId,
      },
    });

    return {
      success: true,
      effectivePermissions,
    };
  }

  // ===========================================================================
  // Task Handlers
  // ===========================================================================

  #handleTasksCreate(params: TasksCreateRequestParams): { task: MAPTask } {
    const { task: taskInput } = params;
    const id = taskInput.id ?? `task-${this.#nextTaskId++}`;

    const task: MAPTask = {
      id,
      ...(taskInput.assignee !== undefined && { assignee: taskInput.assignee }),
      ...(taskInput.title !== undefined && { title: taskInput.title }),
      ...(taskInput.status !== undefined && { status: taskInput.status }),
      ...(taskInput.description !== undefined && { description: taskInput.description }),
      ...(taskInput.meta !== undefined && { meta: taskInput.meta }),
    };

    this.#tasks.set(id, task);

    this.emitEvent({
      type: EVENT_TYPES.TASK_CREATED,
      data: { task },
    });

    return { task };
  }

  #handleTasksAssign(params: TasksAssignRequestParams): { task: MAPTask } {
    const { taskId, agentId } = params;
    const task = this.#tasks.get(taskId);
    if (!task) {
      throw MAPRequestError.invalidParams(`Task ${taskId} not found`);
    }

    task.assignee = agentId;
    this.#tasks.set(taskId, task);

    this.emitEvent({
      type: EVENT_TYPES.TASK_ASSIGNED,
      data: { taskId, agentId },
    });

    return { task };
  }

  #handleTasksUpdate(params: TasksUpdateRequestParams): { task: MAPTask } {
    const { taskId, ...updates } = params;
    const task = this.#tasks.get(taskId);
    if (!task) {
      throw MAPRequestError.invalidParams(`Task ${taskId} not found`);
    }

    const previousStatus = task.status;

    if (updates.status !== undefined) task.status = updates.status;
    if (updates.title !== undefined) task.title = updates.title;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.assignee !== undefined) task.assignee = updates.assignee;
    if (updates.meta !== undefined) task.meta = { ...task.meta, ...updates.meta };

    this.#tasks.set(taskId, task);

    if (updates.status !== undefined && updates.status !== previousStatus) {
      this.emitEvent({
        type: EVENT_TYPES.TASK_STATUS,
        data: {
          taskId,
          previous: previousStatus ?? 'open',
          current: updates.status,
        },
      });
    }

    if (updates.status === 'completed') {
      this.emitEvent({
        type: EVENT_TYPES.TASK_COMPLETED,
        data: { taskId },
      });
    }

    return { task };
  }

  #handleTasksList(params?: TasksListRequestParams): { tasks: MAPTask[]; hasMore: boolean; nextCursor?: string } {
    let tasks = Array.from(this.#tasks.values());

    if (params?.filter) {
      const { assignee, status } = params.filter;
      if (assignee) {
        tasks = tasks.filter((t) => t.assignee === assignee);
      }
      if (status) {
        const statuses: MAPTaskStatus[] = Array.isArray(status) ? status : [status];
        tasks = tasks.filter((t) => t.status !== undefined && statuses.includes(t.status));
      }
    }

    const limit = params?.limit ?? 100;
    const startIndex = params?.cursor ? parseInt(params.cursor, 10) : 0;
    const slice = tasks.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < tasks.length;

    return {
      tasks: slice,
      hasMore,
      nextCursor: hasMore ? String(startIndex + limit) : undefined,
    };
  }
}
