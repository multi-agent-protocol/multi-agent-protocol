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
  /**
   * Parent event ID(s) for causal ordering.
   * Can be a single event ID or an array of event IDs for multiple causes.
   */
  causedBy?: string | string[];
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

/**
 * Callback invoked when a subscriber throws during event handling.
 * Provides context for debugging and monitoring.
 */
export type SubscriberErrorCallback = (
  error: Error,
  event: MAPEvent,
  subscriberIndex: number
) => void;

export interface EventBusOptions {
  /** Custom event store (defaults to InMemoryEventStore) */
  store?: EventStore;
  /**
   * Callback invoked when a subscriber throws during event handling.
   * Subscribers are isolated - one throwing won't affect others.
   * Default: logs to console.error
   */
  onSubscriberError?: SubscriberErrorCallback;
}

// =============================================================================
// Agents
// =============================================================================

/** Standard agent states */
export type StandardAgentState = "idle" | "busy" | "suspended" | "stopped";

/** Custom agent state (must start with "custom:") */
export type CustomAgentState = `custom:${string}`;

/**
 * Valid agent states.
 *
 * Standard states: "idle", "busy", "suspended", "stopped"
 * Custom states: Any string starting with "custom:" (e.g., "custom:thinking")
 */
export type ServerAgentState = StandardAgentState | CustomAgentState;

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
  /**
   * Capabilities this agent provides.
   * Used for capability-based discovery with glob pattern matching.
   * Example: ["translate:en", "translate:fr", "summarize"]
   */
  capabilities?: string[];
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
  /**
   * Filter by capability (supports glob patterns).
   * Exact match: "translate:en"
   * Glob pattern: "translate:*" matches "translate:en", "translate:fr", etc.
   */
  capability?: string;
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
  /** Authenticated principal (if authenticated) */
  principal?: {
    id: string;
    issuer?: string;
    claims?: Record<string, unknown>;
  };
  /** Provider-specific auth data, keyed by providerId */
  providers?: Record<string, {
    principal: { id: string; issuer?: string; claims?: Record<string, unknown> };
    providerData: unknown;
  }>;
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
  /**
   * Atomically claim and invalidate a resume token.
   * Returns the session if the token was valid and claimed, undefined otherwise.
   * This prevents race conditions where multiple clients could resume the same session.
   */
  claimResumeToken?(token: string): ServerSession | undefined;
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
/**
 * Match mode for subscription filters.
 * - "all": All specified criteria must match (default, AND logic)
 * - "any": Any single criterion matching is sufficient (OR logic)
 */
export type SubscriptionFilterMatchMode = "any" | "all";

export interface SubscriptionFilter {
  /** Event types to receive */
  eventTypes?: string[];
  /** Agents to watch */
  agents?: string[];
  /** Scopes to watch (includes nested scopes by default) */
  scopes?: string[];
  /** Message types to filter (for message events) */
  messageTypes?: string[];
  /**
   * Match mode for criteria.
   * - "all" (default): All specified criteria must match
   * - "any": Any single criterion matching is sufficient
   */
  match?: SubscriptionFilterMatchMode;
  /**
   * OR conditions - match if ANY sub-filter matches.
   * When present, other filter fields are ignored.
   */
  $or?: SubscriptionFilter[];
  /**
   * AND conditions - match if ALL sub-filters match.
   * When present, other filter fields are ignored.
   */
  $and?: SubscriptionFilter[];
  /** Mail-specific filter for conversation events */
  mail?: MailSubscriptionFilter;
}

/**
 * Mail-specific subscription filter.
 * Matches mail events by conversation, thread, participant, or content type.
 */
export interface MailSubscriptionFilter {
  /** Filter by conversation ID */
  conversationId?: string;
  /** Filter by thread ID */
  threadId?: string;
  /** Filter by participant ID */
  participantId?: string;
  /** Filter by content type */
  contentType?: string;
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
  /** Timestamp when subscription was paused (undefined if not paused) */
  pausedAt?: number;
}

/**
 * Causal ordering configuration.
 */
/**
 * Mode for handling events with multiple causal dependencies.
 * - "all": Wait for ALL causes before releasing (stricter, default)
 * - "any": Release when ANY cause is seen (more permissive)
 */
export type MultiCauseMode = "all" | "any";

export interface CausalOrderingOptions {
  /** Enable causal ordering (default: true) */
  enabled?: boolean;
  /** Max time to wait for dependencies (default: 5000ms) */
  maxWaitMs?: number;
  /** Max events to buffer while waiting (default: 1000) */
  maxBufferSize?: number;
  /**
   * Mode for handling events with multiple causes.
   * - "all" (default): Wait for ALL causes before releasing
   * - "any": Release when ANY cause is seen
   */
  multiCauseMode?: MultiCauseMode;
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
  /**
   * Atomically update the lastEventId for a subscription.
   * This prevents race conditions when multiple events are delivered concurrently.
   * @returns The updated subscription, or undefined if not found
   */
  updateLastEventId?(id: string, eventId: string): ServerSubscription | undefined;
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

  /** Get last delivered event ID for a subscription */
  getLastEventId(id: string): string | undefined;

  /**
   * Replay missed events to a subscription since its lastEventId.
   * Used on session resume to catch up on events that were missed during disconnect.
   * @returns Array of replayed events
   */
  replayEvents(id: string, options?: ReplayOptions): MAPEvent[];

  /**
   * Replay missed events to all subscriptions for a session.
   * Convenience method for session resume.
   * @returns Map of subscription ID to replayed events
   */
  replaySessionEvents(sessionId: string, options?: ReplayOptions): Map<string, MAPEvent[]>;

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
  /** Default replay options when replaying events on session resume */
  defaultReplayOptions?: ReplayOptions;
}

/**
 * Options for event replay on session resume.
 */
export interface ReplayOptions {
  /**
   * Maximum number of events to replay per subscription.
   * @default 1000
   */
  maxReplayCount?: number;

  /**
   * Maximum age of events to replay in milliseconds.
   * Events older than this are skipped.
   * @default 300000 (5 minutes)
   */
  maxReplayAgeMs?: number;

  /**
   * Filter replayed events by the subscription's filter.
   * If false, replays all events since lastEventId.
   * @default true
   */
  applyFilter?: boolean;
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
  /**
   * Optional message type for routing/filtering without payload inspection.
   * Can be used with subscription `messageTypes` filter.
   */
  messageType?: string;
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

  /** Metadata for new sessions (e.g., transportType for auth bypass) */
  metadata?: Record<string, unknown>;
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
  /** Optional ScopeManager for cleaning up scope memberships when agents are unregistered */
  scopes?: ScopeManager;
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
// Mail (Conversations, Turns, Threads, Participants)
// =============================================================================

import type {
  ConversationType,
  ConversationStatus,
  ParticipantRole,
  TurnStatus,
  TurnSource,
  TurnVisibility,
} from "../types";

/**
 * Server-side conversation record.
 * Extends the client Conversation with server-internal fields.
 */
export interface ServerConversation {
  id: string;
  type: ConversationType;
  status: ConversationStatus;
  subject?: string;
  participantCount: number;
  parentConversationId?: string;
  parentTurnId?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  createdBy: string;
  metadata: Record<string, unknown>;
}

/**
 * Server-side conversation participant record.
 */
export interface ServerParticipant {
  id: string;
  conversationId: string;
  type: "user" | "agent" | "system";
  role: ParticipantRole;
  joinedAt: number;
  leftAt?: number;
  permissions: {
    canSend: boolean;
    canObserve: boolean;
    canInvite: boolean;
    canRemove: boolean;
    canCreateThreads: boolean;
    historyAccess: "none" | "from-join" | "full";
    canSeeInternal: boolean;
  };
  agentInfo?: {
    agentId: string;
    name?: string;
    role?: string;
  };
}

/**
 * Server-side turn record.
 */
export interface ServerTurn {
  id: string;
  conversationId: string;
  participant: string;
  timestamp: number;
  contentType: string;
  content: unknown;
  threadId?: string;
  inReplyTo?: string;
  source: TurnSource;
  visibility?: TurnVisibility;
  status?: TurnStatus;
  metadata: Record<string, unknown>;
}

/**
 * Server-side thread record.
 */
export interface ServerThread {
  id: string;
  conversationId: string;
  parentThreadId?: string;
  subject?: string;
  rootTurnId: string;
  turnCount: number;
  participantCount: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

// --- Filters ---

/**
 * Filter criteria for listing conversations.
 */
export interface ConversationFilter {
  type?: ConversationType[];
  status?: ConversationStatus[];
  participantId?: string;
  createdAfter?: number;
  createdBefore?: number;
  parentConversationId?: string;
}

/**
 * Filter criteria for listing turns.
 * conversationId is required — turns always belong to a conversation.
 */
export interface TurnFilter {
  conversationId: string;
  threadId?: string;
  contentTypes?: string[];
  participantId?: string;
  /** Cursor: return turns after this turn ID */
  afterTurnId?: string;
  /** Cursor: return turns before this turn ID */
  beforeTurnId?: string;
  /** Return turns after this timestamp */
  afterTimestamp?: number;
  /** Return turns before this timestamp */
  beforeTimestamp?: number;
  /** Maximum number of turns to return */
  limit?: number;
  /** Sort order (default: 'asc') */
  order?: "asc" | "desc";
}

/**
 * Filter criteria for listing threads.
 */
export interface ThreadFilter {
  conversationId: string;
  parentThreadId?: string;
}

/**
 * Filter criteria for listing participants.
 */
export interface ParticipantFilter {
  conversationId?: string;
  participantId?: string;
  role?: ParticipantRole;
  /** Only active participants (not left) */
  active?: boolean;
}

// --- Stores ---

/**
 * Storage backend for conversations. Implement for persistence.
 */
export interface ConversationStore {
  save(conversation: ServerConversation): void;
  get(id: string): ServerConversation | undefined;
  list(filter?: ConversationFilter): ServerConversation[];
  delete(id: string): boolean;
  clear(): void;
}

/**
 * Storage backend for turns. Implement for persistence.
 *
 * Turns require efficient querying by conversation with cursor-based
 * pagination and timestamp range support.
 */
export interface TurnStore {
  /** Append a turn */
  append(turn: ServerTurn): void;
  /** Get a specific turn by ID */
  get(id: string): ServerTurn | undefined;
  /** List turns matching filter criteria with pagination */
  list(filter: TurnFilter): ServerTurn[];
  /** Delete a specific turn */
  delete(id: string): boolean;
  /** Delete all turns for a conversation */
  deleteByConversation(conversationId: string): number;
  /** Count turns in a conversation (optionally filtered by thread) */
  count(conversationId: string, threadId?: string): number;
  clear(): void;
}

/**
 * Storage backend for threads. Implement for persistence.
 */
export interface ThreadStore {
  save(thread: ServerThread): void;
  get(id: string): ServerThread | undefined;
  list(filter: ThreadFilter): ServerThread[];
  delete(id: string): boolean;
  deleteByConversation(conversationId: string): number;
  clear(): void;
}

/**
 * Storage backend for conversation participants. Implement for persistence.
 *
 * Supports bidirectional lookup:
 * - conversation → participants
 * - participant → conversations
 */
export interface ParticipantStore {
  save(participant: ServerParticipant): void;
  /** Get a specific participant in a conversation */
  get(conversationId: string, participantId: string): ServerParticipant | undefined;
  /** List participants matching filter */
  list(filter: ParticipantFilter): ServerParticipant[];
  /** Remove a participant from a conversation */
  delete(conversationId: string, participantId: string): boolean;
  /** Delete all participants for a conversation */
  deleteByConversation(conversationId: string): number;
  /** Get all conversation IDs a participant belongs to */
  getConversationsForParticipant(participantId: string, active?: boolean): string[];
  clear(): void;
}

// --- Managers ---

/**
 * Default permissions for new participants.
 */
export interface DefaultParticipantPermissions {
  canSend?: boolean;
  canObserve?: boolean;
  canInvite?: boolean;
  canRemove?: boolean;
  canCreateThreads?: boolean;
  historyAccess?: "none" | "from-join" | "full";
  canSeeInternal?: boolean;
}

/**
 * Result of getting a conversation with optional includes.
 */
export interface ConversationGetResult {
  conversation: ServerConversation;
  participants?: ServerParticipant[];
  threads?: ServerThread[];
  recentTurns?: ServerTurn[];
  stats?: {
    totalTurns: number;
    turnsByContentType: Record<string, number>;
    activeParticipants: number;
    threadCount: number;
  };
}

/**
 * Manages conversation lifecycle and participants.
 *
 * Events emitted:
 * - mail.created
 * - mail.closed
 * - mail.participant.joined
 * - mail.participant.left
 */
export interface ConversationManager {
  /** Create a new conversation. Creator auto-joins as initiator. */
  create(params: {
    type?: ConversationType;
    subject?: string;
    createdBy: string;
    parentConversationId?: string;
    parentTurnId?: string;
    metadata?: Record<string, unknown>;
    /** Initial participants to add (in addition to creator) */
    initialParticipants?: Array<{
      id: string;
      type?: "user" | "agent" | "system";
      role?: ParticipantRole;
      permissions?: DefaultParticipantPermissions;
      agentInfo?: { agentId: string; name?: string; role?: string };
    }>;
  }): { conversation: ServerConversation; participant: ServerParticipant };

  /** Get conversation by ID with optional includes */
  get(
    id: string,
    include?: {
      participants?: boolean;
      threads?: boolean;
      recentTurns?: number;
      stats?: boolean;
    }
  ): ConversationGetResult | undefined;

  /** List conversations with filtering */
  list(filter?: ConversationFilter): ServerConversation[];

  /** Close a conversation */
  close(id: string, closedBy: string, reason?: string): ServerConversation;

  /** Join a conversation */
  join(params: {
    conversationId: string;
    participantId: string;
    type?: "user" | "agent" | "system";
    role?: ParticipantRole;
    permissions?: DefaultParticipantPermissions;
    agentInfo?: { agentId: string; name?: string; role?: string };
  }): { conversation: ServerConversation; participant: ServerParticipant };

  /** Leave a conversation */
  leave(conversationId: string, participantId: string, reason?: string): void;

  /** Invite a participant */
  invite(params: {
    conversationId: string;
    participant: {
      id: string;
      type?: "user" | "agent" | "system";
      role?: ParticipantRole;
      permissions?: DefaultParticipantPermissions;
      agentInfo?: { agentId: string; name?: string; role?: string };
    };
  }): ServerParticipant;

  /** Get a participant in a conversation */
  getParticipant(conversationId: string, participantId: string): ServerParticipant | undefined;

  /** List participants in a conversation */
  listParticipants(conversationId: string, active?: boolean): ServerParticipant[];
}

export interface ConversationManagerOptions {
  eventBus: EventBus;
  store?: ConversationStore;
  participantStore?: ParticipantStore;
}

/**
 * Manages turn recording, querying, and visibility filtering.
 *
 * Events emitted:
 * - mail.turn.added
 * - mail.turn.updated
 */
export interface TurnManager {
  /** Record a turn (explicit via mail/turn) */
  recordTurn(params: {
    conversationId: string;
    participant: string;
    contentType: string;
    content: unknown;
    threadId?: string;
    inReplyTo?: string;
    visibility?: TurnVisibility;
    status?: TurnStatus;
    metadata?: Record<string, unknown>;
  }): ServerTurn;

  /** Record an intercepted turn (from map/send with mail meta) */
  recordInterceptedTurn(params: {
    conversationId: string;
    participant: string;
    contentType: string;
    content: unknown;
    messageId: string;
    threadId?: string;
    inReplyTo?: string;
    visibility?: TurnVisibility;
    metadata?: Record<string, unknown>;
  }): ServerTurn;

  /** Get a turn by ID */
  get(id: string): ServerTurn | undefined;

  /** List turns with filtering and pagination */
  list(filter: TurnFilter): ServerTurn[];

  /** Update turn status (e.g., streaming → complete) */
  updateStatus(id: string, status: TurnStatus): ServerTurn;

  /** Count turns in a conversation */
  count(conversationId: string, threadId?: string): number;
}

export interface TurnManagerOptions {
  eventBus: EventBus;
  store?: TurnStore;
  /** ConversationManager for validating conversation exists */
  conversations: ConversationManager;
}

/**
 * Manages conversation threads.
 *
 * Events emitted:
 * - mail.thread.created
 */
export interface ThreadManager {
  /** Create a thread rooted at a specific turn */
  create(params: {
    conversationId: string;
    rootTurnId: string;
    subject?: string;
    parentThreadId?: string;
    createdBy: string;
  }): ServerThread;

  /** Get a thread by ID */
  get(id: string): ServerThread | undefined;

  /** List threads in a conversation */
  list(conversationId: string, parentThreadId?: string): ServerThread[];

  /** Increment turn count for a thread */
  incrementTurnCount(threadId: string): void;

  /** Increment participant count for a thread */
  incrementParticipantCount(threadId: string): void;
}

export interface ThreadManagerOptions {
  eventBus: EventBus;
  store?: ThreadStore;
  /** TurnStore for validating rootTurnId exists */
  turnStore: TurnStore;
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
  close(params: unknown, ctx: HandlerContext): Promise<void>;

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
