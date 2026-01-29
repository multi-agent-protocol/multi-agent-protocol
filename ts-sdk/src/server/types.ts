/**
 * MAP Server SDK - Type Definitions
 *
 * This module contains all interfaces and types for the server-side SDK.
 */

// =============================================================================
// Events
// =============================================================================

/**
 * A MAP event that can be emitted, stored, and delivered to subscribers.
 */
export interface MAPEvent {
  /** ULID for ordering and deduplication */
  id: string;
  /** Event type (e.g., 'agent.registered', 'scope.agent.joined') */
  type: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Event-specific payload */
  data: unknown;
  /** Source of the event */
  source?: {
    agentId?: string;
    scopeId?: string;
    sessionId?: string;
  };
  /** Parent event ID for causal ordering */
  causedBy?: string;
}

/**
 * Filter criteria for querying events.
 */
export interface EventFilter {
  /** Filter by event types */
  types?: string[];
  /** Return events after this event ID */
  since?: string;
  /** Return events before this event ID */
  until?: string;
  /** Maximum number of events to return */
  limit?: number;
}

/**
 * Storage backend for events. Implement this interface to provide
 * custom persistence (Redis, Postgres, etc.).
 */
export interface EventStore {
  /** Append an event to storage */
  append(event: MAPEvent): void;

  /** Query events matching filter criteria */
  query(filter: EventFilter): MAPEvent[];

  /** Get a specific event by ID */
  getById(id: string): MAPEvent | undefined;

  /** Clear all events (useful for testing) */
  clear(): void;
}

/**
 * Event handler callback type.
 */
export type EventHandler = (event: MAPEvent) => void;

/**
 * Central event dispatcher. All building blocks emit events through this.
 */
export interface EventBus {
  /**
   * Emit an event. Assigns ID and timestamp automatically.
   * @returns The complete event with ID and timestamp
   */
  emit(event: Omit<MAPEvent, "id" | "timestamp">): MAPEvent;

  /**
   * Subscribe to events by type.
   * @param types Event type(s) to listen for, or '*' for all
   * @param handler Callback invoked for each matching event
   * @returns Unsubscribe function
   */
  on(types: string | string[], handler: EventHandler): () => void;

  /**
   * Query historical events.
   */
  getEvents(filter: EventFilter): MAPEvent[];

  /** The underlying storage backend */
  readonly store: EventStore;
}

export interface EventBusOptions {
  /** Custom event store (defaults to InMemoryEventStore) */
  store?: EventStore;
}

// =============================================================================
// Agents
// =============================================================================

/** Valid agent states */
export type ServerAgentState = "idle" | "busy" | "suspended" | "stopped";

/**
 * A registered agent in the system.
 */
export interface RegisteredAgent {
  /** Unique agent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Optional role identifier */
  role?: string;
  /** Current agent state */
  state: ServerAgentState;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
  /** Session that owns this agent */
  sessionId: string;
  /** Registration timestamp */
  registeredAt: number;
  /** Last state change timestamp */
  lastStateChange: number;
}

/**
 * Filter criteria for listing agents.
 */
export interface AgentFilter {
  /** Filter by state */
  state?: ServerAgentState;
  /** Filter by role */
  role?: string;
  /** Filter by session */
  sessionId?: string;
  /** Filter by scope membership */
  scopeId?: string;
}

/**
 * Storage backend for agents. Implement for persistence.
 */
export interface AgentStore {
  save(agent: RegisteredAgent): void;
  get(id: string): RegisteredAgent | undefined;
  list(filter?: AgentFilter): RegisteredAgent[];
  delete(id: string): boolean;
  clear(): void;
}

/**
 * Manages agent lifecycle and state.
 *
 * Events emitted:
 * - agent.registered
 * - agent.unregistered
 * - agent.state.changed
 * - agent.metadata.changed
 */
export interface AgentRegistry {
  /**
   * Register a new agent.
   */
  register(params: {
    name: string;
    role?: string;
    metadata?: Record<string, unknown>;
    sessionId: string;
  }): RegisteredAgent;

  /** Get agent by ID */
  get(id: string): RegisteredAgent | undefined;

  /** List agents matching filter */
  list(filter?: AgentFilter): RegisteredAgent[];

  /** Unregister an agent */
  unregister(id: string): boolean;

  /** Update agent state */
  updateState(id: string, state: ServerAgentState): RegisteredAgent;

  /** Update agent metadata (merges with existing) */
  updateMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): RegisteredAgent;

  /** Unregister all agents for a session (cleanup on disconnect) */
  unregisterBySession(sessionId: string): string[];
}

export interface AgentRegistryOptions {
  eventBus: EventBus;
  store?: AgentStore;
}

// =============================================================================
// Scopes (with Hierarchy)
// =============================================================================

/**
 * A scope for grouping agents. Supports parent-child hierarchy.
 */
export interface ServerScope {
  /** Unique scope identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: number;
  /** Creator (agent or session ID) */
  createdBy?: string;
  /** Parent scope ID for hierarchy (null for root scopes) */
  parentId?: string;
}

/**
 * Filter criteria for listing scopes.
 */
export interface ScopeFilter {
  /** Filter by parent (null for root scopes only) */
  parentId?: string | null;
  /** Include all descendants of this scope */
  ancestorId?: string;
}

/**
 * Storage backend for scopes. Implement for persistence.
 */
export interface ScopeStore {
  saveScope(scope: ServerScope): void;
  getScope(id: string): ServerScope | undefined;
  listScopes(filter?: ScopeFilter): ServerScope[];
  deleteScope(id: string): boolean;

  /** Get all ancestor scope IDs (parent chain) */
  getAncestors(scopeId: string): string[];

  /** Get all descendant scope IDs */
  getDescendants(scopeId: string): string[];

  // Membership
  addMember(scopeId: string, agentId: string): void;
  removeMember(scopeId: string, agentId: string): void;
  getMembers(scopeId: string, includeDescendants?: boolean): string[];
  getScopesForAgent(agentId: string): string[];

  clear(): void;
}

/**
 * Manages scopes and membership with hierarchy support.
 *
 * Events emitted:
 * - scope.created
 * - scope.deleted
 * - scope.agent.joined
 * - scope.agent.left
 */
export interface ScopeManager {
  /** Create a new scope */
  create(params: {
    name: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
    parentId?: string;
  }): ServerScope;

  /** Get scope by ID */
  get(id: string): ServerScope | undefined;

  /** List scopes with optional filter */
  list(filter?: ScopeFilter): ServerScope[];

  /** Delete a scope (and optionally its descendants) */
  delete(id: string, opts?: { deleteDescendants?: boolean }): boolean;

  /** Get parent scope */
  getParent(scopeId: string): ServerScope | undefined;

  /** Get child scopes */
  getChildren(scopeId: string): ServerScope[];

  /** Get all ancestor scopes (parent chain to root) */
  getAncestors(scopeId: string): ServerScope[];

  /** Get all descendant scopes */
  getDescendants(scopeId: string): ServerScope[];

  /** Add agent to scope */
  join(scopeId: string, agentId: string): void;

  /** Remove agent from scope */
  leave(scopeId: string, agentId: string): void;

  /** Get all agents in a scope (optionally including descendants) */
  getMembers(
    scopeId: string,
    opts?: { includeDescendants?: boolean }
  ): string[];

  /** Get all scopes an agent belongs to */
  getScopesForAgent(agentId: string): string[];

  /** Check if agent is in scope (optionally checking ancestors) */
  isMember(
    scopeId: string,
    agentId: string,
    opts?: { checkAncestors?: boolean }
  ): boolean;

  /** Remove agent from all scopes (cleanup) */
  leaveAll(agentId: string): string[];
}

export interface ScopeManagerOptions {
  eventBus: EventBus;
  store?: ScopeStore;
}

// =============================================================================
// Sessions (with Resume Support)
// =============================================================================

/** Connection role */
export type SessionRole = "client" | "agent" | "gateway";

/** Session status */
export type SessionStatus = "connected" | "disconnected" | "expired";

/**
 * A connected session (client, agent, or gateway).
 * Supports disconnect/resume lifecycle.
 */
export interface ServerSession {
  /** Unique session identifier */
  id: string;
  /** Connection role */
  role: SessionRole;
  /** Human-readable name */
  name?: string;
  /** Current status */
  status: SessionStatus;
  /** Initial connection timestamp */
  connectedAt: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** Last disconnect timestamp (if disconnected) */
  disconnectedAt?: number;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
  /** Agents registered via this session */
  agentIds: string[];
  /** Active subscriptions */
  subscriptionIds: string[];
  /** Resume token for reconnection */
  resumeToken?: string;
}

/**
 * Resume result when reconnecting.
 */
export interface ResumeResult {
  /** Whether resume succeeded */
  success: boolean;
  /** The resumed session (if successful) */
  session?: ServerSession;
  /** Reason for failure (if unsuccessful) */
  reason?: "expired" | "invalid_token" | "not_found";
}

/**
 * Storage backend for sessions. Implement for persistence.
 */
export interface SessionStore {
  save(session: ServerSession): void;
  get(id: string): ServerSession | undefined;
  getByResumeToken(token: string): ServerSession | undefined;
  list(filter?: { role?: SessionRole; status?: SessionStatus }): ServerSession[];
  delete(id: string): boolean;
  clear(): void;
}

/**
 * Tracks connections and their resources with resume support.
 *
 * Events emitted:
 * - session.connected
 * - session.disconnected
 * - session.resumed
 * - session.expired
 */
export interface SessionManager {
  /** Create a new session */
  create(params: {
    role: SessionRole;
    name?: string;
    metadata?: Record<string, unknown>;
  }): ServerSession;

  /** Get session by ID */
  get(id: string): ServerSession | undefined;

  /** List sessions */
  list(filter?: { role?: SessionRole; status?: SessionStatus }): ServerSession[];

  /**
   * Mark session as disconnected (but resumable).
   * @returns Resume token for reconnection
   */
  disconnect(id: string): string | undefined;

  /**
   * Resume a disconnected session.
   */
  resume(resumeToken: string): ResumeResult;

  /**
   * Permanently close a session (not resumable).
   * @returns Session for cleanup
   */
  close(id: string): ServerSession | undefined;

  /**
   * Expire sessions that have been disconnected too long.
   * @returns Expired session IDs
   */
  expireStale(maxDisconnectMs: number): string[];

  /** Track agent registration */
  addAgent(sessionId: string, agentId: string): void;
  removeAgent(sessionId: string, agentId: string): void;

  /** Track subscriptions */
  addSubscription(sessionId: string, subscriptionId: string): void;
  removeSubscription(sessionId: string, subscriptionId: string): void;

  /** Update last activity timestamp */
  touch(id: string): void;
}

export interface SessionManagerOptions {
  eventBus: EventBus;
  store?: SessionStore;
  /** How long disconnected sessions remain resumable (default: 5 minutes) */
  resumeWindowMs?: number;
}

// =============================================================================
// Subscriptions (with Causal Ordering)
// =============================================================================

/**
 * Filter for subscription events.
 */
export interface SubscriptionFilter {
  /** Event types to receive */
  eventTypes?: string[];
  /** Agents to watch */
  agents?: string[];
  /** Scopes to watch (includes nested scopes by default) */
  scopes?: string[];
}

/**
 * An active subscription.
 */
export interface ServerSubscription {
  /** Unique subscription identifier */
  id: string;
  /** Owning session */
  sessionId: string;
  /** Filter criteria */
  filter: SubscriptionFilter;
  /** Creation timestamp */
  createdAt: number;
  /** Last delivered event ID (for replay/resume) */
  lastEventId?: string;
  /** Whether delivery is paused */
  paused: boolean;
}

/**
 * Causal ordering configuration.
 */
export interface CausalOrderingOptions {
  /** Enable causal ordering (default: true) */
  enabled?: boolean;
  /** Max time to wait for dependencies (default: 5000ms) */
  maxWaitMs?: number;
  /** Max events to buffer while waiting (default: 1000) */
  maxBufferSize?: number;
}

/**
 * Storage backend for subscriptions. Implement for persistence.
 */
export interface SubscriptionStore {
  save(subscription: ServerSubscription): void;
  get(id: string): ServerSubscription | undefined;
  list(filter?: { sessionId?: string }): ServerSubscription[];
  delete(id: string): boolean;
  clear(): void;
}

/**
 * Manages client subscriptions to events with causal ordering.
 */
export interface SubscriptionManager {
  /** Create a new subscription */
  create(params: {
    sessionId: string;
    filter: SubscriptionFilter;
    startAfter?: string;
  }): ServerSubscription;

  /** Get subscription by ID */
  get(id: string): ServerSubscription | undefined;

  /** Cancel a subscription */
  cancel(id: string): boolean;

  /** Cancel all subscriptions for a session */
  cancelBySession(sessionId: string): string[];

  /** Pause event delivery */
  pause(id: string): void;

  /** Resume event delivery */
  resume(id: string): void;

  /** Update last delivered event ID */
  acknowledge(id: string, eventId: string): void;

  /**
   * Find subscriptions that should receive an event.
   * @returns Subscription IDs that match
   */
  match(event: MAPEvent): string[];

  /**
   * Get ordered event stream for a subscription.
   * Handles causal ordering internally.
   */
  getEventStream(id: string): AsyncIterable<MAPEvent>;
}

export interface SubscriptionManagerOptions {
  eventBus: EventBus;
  store?: SubscriptionStore;
  scopes?: ScopeManager;
  causalOrdering?: CausalOrderingOptions;
}

// =============================================================================
// Messages (with Queuing)
// =============================================================================

/**
 * A message between agents.
 */
export interface ServerMessage {
  /** Unique message identifier */
  id: string;
  /** Sender (agent or session ID) */
  from: string;
  /** Recipient(s) - agent ID, scope ID, or array */
  to: string | string[];
  /** Message content */
  payload: unknown;
  /** Send timestamp */
  timestamp: number;
  /** For request/response patterns */
  replyTo?: string;
  /** Message priority (lower = higher priority) */
  priority?: number;
  /** TTL in milliseconds (for queued messages) */
  ttlMs?: number;
}

/**
 * Queued message awaiting delivery.
 */
export interface QueuedMessage {
  message: ServerMessage;
  targetAgentId: string;
  queuedAt: number;
  expiresAt: number;
  attempts: number;
}

/**
 * Callback for message delivery.
 */
export type DeliveryHandler = (agentId: string, message: ServerMessage) => void;

/**
 * Message queue configuration.
 */
export interface MessageQueueOptions {
  /** Enable queuing for offline agents (default: true) */
  enabled?: boolean;
  /** Max messages per agent (default: 100) */
  maxPerAgent?: number;
  /** Default TTL in milliseconds (default: 60000) */
  defaultTtlMs?: number;
  /** Max total queued messages (default: 10000) */
  maxTotal?: number;
}

/**
 * Storage backend for message queue. Implement for persistence.
 */
export interface MessageQueueStore {
  enqueue(msg: QueuedMessage): void;
  dequeue(agentId: string, limit?: number): QueuedMessage[];
  peek(agentId: string, limit?: number): QueuedMessage[];
  remove(messageId: string): boolean;
  getQueueSize(agentId: string): number;
  getTotalSize(): number;
  expireOld(): number;
  clear(): void;
}

/**
 * Routes messages between agents with queuing support.
 *
 * Events emitted:
 * - message.sent
 * - message.delivered
 * - message.queued
 * - message.expired
 */
export interface MessageRouter {
  /** Send to a specific agent */
  sendToAgent(params: {
    from: string;
    to: string;
    payload: unknown;
    replyTo?: string;
    priority?: number;
    ttlMs?: number;
  }): ServerMessage;

  /** Broadcast to all agents in a scope */
  sendToScope(params: {
    from: string;
    scopeId: string;
    payload: unknown;
    excludeSender?: boolean;
    includeDescendants?: boolean;
  }): ServerMessage;

  /** Set delivery callback */
  onDeliver(handler: DeliveryHandler): void;

  /**
   * Flush queued messages for an agent (call when agent reconnects).
   * @returns Number of messages delivered
   */
  flushQueue(agentId: string): number;

  /** Get queue stats */
  getQueueStats(): {
    total: number;
    byAgent: Record<string, number>;
  };
}

export interface MessageRouterOptions {
  eventBus: EventBus;
  agents: AgentRegistry;
  scopes: ScopeManager;
  queue?: MessageQueueOptions;
  queueStore?: MessageQueueStore;
}

// =============================================================================
// Router Connection
// =============================================================================

/**
 * Context passed to handlers.
 */
export interface HandlerContext {
  /** Current session */
  session: ServerSession;
  /** Request metadata */
  requestId: string;
  /** Abort signal for cancellation */
  signal: AbortSignal;
}

/**
 * A request handler function.
 */
export type Handler<TParams = unknown, TResult = unknown> = (
  params: TParams,
  ctx: HandlerContext
) => Promise<TResult>;

/**
 * Registry of method handlers.
 */
export type HandlerRegistry = Record<string, Handler>;

/**
 * Middleware function.
 */
export type Middleware = (
  method: string,
  params: unknown,
  ctx: HandlerContext,
  next: () => Promise<unknown>
) => Promise<unknown>;

/**
 * JSON-RPC router that dispatches to handlers.
 * Supports session resume on reconnect.
 */
export interface RouterConnection {
  /** Start processing messages */
  start(): Promise<void>;

  /** Stop processing and close */
  close(): Promise<void>;

  /** Promise that resolves when connection closes */
  readonly closed: Promise<void>;

  /** Current session */
  readonly session: ServerSession;

  /** Send notification to connected peer */
  notify(method: string, params: unknown): Promise<void>;
}

export interface RouterConnectionOptions {
  /** Bidirectional stream */
  stream: import("../stream").Stream;

  /** Method handlers */
  handlers: HandlerRegistry;

  /** Middleware chain (executed in order) */
  middleware?: Middleware[];

  /** Session manager for connection tracking */
  sessions: SessionManager;

  /** Resume token for reconnection (optional) */
  resumeToken?: string;

  /** Role for new sessions */
  role: SessionRole;

  /** Name for new sessions */
  name?: string;
}

// =============================================================================
// Permissions
// =============================================================================

/**
 * Permission check result.
 */
export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks permissions at various levels.
 */
export interface PermissionChecker {
  /** Check if method is allowed for session role */
  canCallMethod(session: ServerSession, method: string): PermissionResult;

  /** Check if session can access a scope */
  canAccessScope(
    session: ServerSession,
    scopeId: string,
    action: string
  ): PermissionResult;

  /** Check if agent can perform action on target */
  canAgentPerform(
    agentId: string,
    action: string,
    targetId: string
  ): PermissionResult;
}

/**
 * Permission rule definition.
 */
export interface PermissionRule {
  /** Method pattern (glob supported) */
  method?: string;
  /** Required session role(s) */
  roles?: SessionRole[];
  /** Custom check function */
  check?: (session: ServerSession, params: unknown) => PermissionResult;
}

export interface PermissionCheckerOptions {
  rules: PermissionRule[];
  /** Default behavior when no rule matches */
  defaultAllow?: boolean;
}

// =============================================================================
// Resource Cleanup
// =============================================================================

/**
 * Strategy for handling cleanup.
 */
export interface CleanupStrategy {
  /** Called for each stale session */
  onStaleSession?(session: ServerSession): void;

  /** Called for each orphaned agent */
  onOrphanedAgent?(agent: RegisteredAgent): void;

  /** Called for each orphaned subscription */
  onOrphanedSubscription?(subscription: ServerSubscription): void;

  /** Called for expired queued messages */
  onExpiredMessages?(count: number): void;
}

/**
 * Cleanup thresholds configuration.
 */
export interface CleanupThresholds {
  /** Max time a session can be disconnected before expiring */
  sessionDisconnectMs?: number;
  /** Max time since last activity before session is stale */
  sessionInactiveMs?: number;
  /** Run cleanup every N milliseconds (0 = manual only) */
  intervalMs?: number;
}

/**
 * Stats returned from cleanup run.
 */
export interface CleanupStats {
  sessionsExpired: number;
  agentsUnregistered: number;
  subscriptionsCancelled: number;
  messagesExpired: number;
}

/**
 * Handles cleanup of stale resources.
 */
export interface ResourceCleaner {
  /**
   * Run cleanup cycle.
   * @returns Stats about what was cleaned
   */
  run(): Promise<CleanupStats>;

  /** Start automatic cleanup interval */
  start(): void;

  /** Stop automatic cleanup */
  stop(): void;

  /** Check if automatic cleanup is running */
  readonly running: boolean;
}

export interface ResourceCleanerOptions {
  sessions: SessionManager;
  agents: AgentRegistry;
  subscriptions: SubscriptionManager;
  messages: MessageRouter;
  thresholds?: CleanupThresholds;
  strategy?: CleanupStrategy;
}

// =============================================================================
// Federation
// =============================================================================

/**
 * Peer system connection.
 */
export interface PeerConnection {
  systemId: string;
  endpoint: string;
  status: "connected" | "disconnected" | "connecting";
  connectedAt?: number;
  lastActivity?: number;
}

/**
 * Federation envelope for cross-system messages.
 */
export interface ServerFederationEnvelope {
  /** Original message */
  payload: unknown;
  /** Routing metadata */
  routing: {
    from: string;
    to: string;
    hops: string[];
    maxHops: number;
  };
  /** Timestamp */
  timestamp: number;
}

/**
 * Outage buffer stats.
 */
export interface OutageBufferStats {
  total: number;
  bySystem: Record<string, number>;
}

/**
 * Buffers messages during peer outages.
 */
export interface OutageBuffer {
  /** Add message to buffer */
  add(systemId: string, envelope: ServerFederationEnvelope): void;

  /** Flush buffered messages (on reconnect) */
  flush(systemId: string): ServerFederationEnvelope[];

  /** Get buffer stats */
  stats(): OutageBufferStats;
}

/**
 * Peer message handler callback.
 */
export type PeerMessageHandler = (
  from: string,
  envelope: ServerFederationEnvelope
) => void;

/**
 * Gateway for federation between MAP systems.
 */
export interface FederationGateway {
  /** Connect to a peer system */
  connectPeer(params: {
    systemId: string;
    endpoint: string;
    credentials?: unknown;
  }): Promise<PeerConnection>;

  /** Route message to peer */
  routeToPeer(
    systemId: string,
    envelope: ServerFederationEnvelope
  ): Promise<void>;

  /** Handle incoming messages from peers */
  onPeerMessage(handler: PeerMessageHandler): void;

  /** List connected peers */
  listPeers(): PeerConnection[];

  /** Disconnect from peer */
  disconnectPeer(systemId: string): void;

  /** Outage buffer for resilience */
  readonly buffer: OutageBuffer;
}

export interface FederationGatewayOptions {
  systemId: string;
  buffer?: {
    maxMessages?: number;
  };
}

/**
 * Sync configuration for federated agents.
 */
export interface FederatedAgentSyncOptions {
  /** Sync local registrations to peers */
  onRegister?: boolean;
  /** Sync state changes to peers */
  onStateChange?: boolean;
  /** Include remote agents in list() */
  includeRemote?: boolean;
}

/**
 * Sync configuration for federated scopes.
 */
export interface FederatedScopeSyncOptions {
  onCreateScope?: boolean;
  onMembershipChange?: boolean;
  includeRemote?: boolean;
}

export interface FederatedAgentRegistryOptions {
  local: AgentRegistry;
  gateway: FederationGateway;
  sync?: FederatedAgentSyncOptions;
}

export interface FederatedScopeManagerOptions {
  local: ScopeManager;
  gateway: FederationGateway;
  sync?: FederatedScopeSyncOptions;
}

export interface FederatedMessageRouterOptions {
  local: MessageRouter;
  gateway: FederationGateway;
  agents: AgentRegistry;
}

// =============================================================================
// Optional OOP Interface
// =============================================================================

/**
 * OOP interface for implementing a MAP router.
 * All methods correspond to protocol methods.
 */
export interface MAPRouterInterface {
  // Connection
  connect(
    params: unknown,
    ctx: HandlerContext
  ): Promise<{ sessionId: string; resumeToken?: string }>;
  disconnect(params: unknown, ctx: HandlerContext): Promise<void>;
  resume(
    params: { resumeToken: string },
    ctx: HandlerContext
  ): Promise<ResumeResult>;

  // Agents
  registerAgent(
    params: { name: string; role?: string; metadata?: Record<string, unknown> },
    ctx: HandlerContext
  ): Promise<RegisteredAgent>;
  unregisterAgent(params: { agentId: string }, ctx: HandlerContext): Promise<void>;
  listAgents(params: AgentFilter, ctx: HandlerContext): Promise<RegisteredAgent[]>;
  getAgent(
    params: { agentId: string },
    ctx: HandlerContext
  ): Promise<RegisteredAgent | undefined>;
  updateAgentState(
    params: { agentId: string; state: ServerAgentState },
    ctx: HandlerContext
  ): Promise<RegisteredAgent>;
  updateAgentMetadata(
    params: { agentId: string; metadata: Record<string, unknown> },
    ctx: HandlerContext
  ): Promise<RegisteredAgent>;

  // Scopes
  createScope(
    params: {
      name: string;
      metadata?: Record<string, unknown>;
      parentId?: string;
    },
    ctx: HandlerContext
  ): Promise<ServerScope>;
  deleteScope(
    params: { scopeId: string; deleteDescendants?: boolean },
    ctx: HandlerContext
  ): Promise<void>;
  listScopes(params: ScopeFilter, ctx: HandlerContext): Promise<ServerScope[]>;
  getScope(
    params: { scopeId: string },
    ctx: HandlerContext
  ): Promise<ServerScope | undefined>;
  joinScope(
    params: { scopeId: string; agentId: string },
    ctx: HandlerContext
  ): Promise<void>;
  leaveScope(
    params: { scopeId: string; agentId: string },
    ctx: HandlerContext
  ): Promise<void>;

  // Messages
  send(
    params: {
      to: string | string[];
      payload: unknown;
      replyTo?: string;
      priority?: number;
    },
    ctx: HandlerContext
  ): Promise<ServerMessage>;

  // Subscriptions
  subscribe(
    params: { filter: SubscriptionFilter; startAfter?: string },
    ctx: HandlerContext
  ): Promise<ServerSubscription>;
  unsubscribe(
    params: { subscriptionId: string },
    ctx: HandlerContext
  ): Promise<void>;
  replay(
    params: { subscriptionId: string; since?: string; until?: string },
    ctx: HandlerContext
  ): Promise<MAPEvent[]>;
}

export interface BaseMAPRouterOptions {
  agents: AgentRegistry;
  scopes: ScopeManager;
  sessions: SessionManager;
  subscriptions: SubscriptionManager;
  messages: MessageRouter;
  eventBus: EventBus;
}
