/**
 * MAP Router Interface
 *
 * Defines the interface for implementing a MAP system router/server.
 * The actual router implementation is not included in the SDK.
 */

import type { Stream } from '../stream';
import type {
  ParticipantId,
  ParticipantType,
  ParticipantCapabilities,
  AgentId,
  ScopeId,
  SessionId,
  Agent,
  Scope,
  Message,
  Address,
  Event,
  EventType,
  SubscriptionFilter,
} from '../types';

/**
 * Information about a connected participant
 */
export interface ConnectedParticipant {
  id: ParticipantId;
  type: ParticipantType;
  name?: string;
  capabilities: ParticipantCapabilities;
  sessionId: SessionId;
  connectedAt: number;
}

/**
 * Agent exposure configuration.
 * Controls which agents are visible to external participants.
 */
export interface AgentExposure {
  /** Whether agents are public by default (default: true) */
  publicByDefault?: boolean;
  /** Glob patterns for agents that are always public */
  publicAgents?: string[];
  /** Glob patterns for agents that are always hidden (takes precedence over publicAgents) */
  hiddenAgents?: string[];
}

/**
 * Event exposure configuration.
 * Controls which event types are visible to external participants.
 */
export interface EventExposure {
  /** Event types that are exposed (whitelist - if provided, only these types are visible) */
  exposedTypes?: EventType[];
  /** Event types that are always hidden (blacklist - takes precedence) */
  hiddenTypes?: EventType[];
}

/**
 * Scope exposure configuration.
 * Controls which scopes are visible to external participants.
 */
export interface ScopeExposure {
  /** Whether scopes are public by default (default: true) */
  publicByDefault?: boolean;
  /** Glob patterns for scopes that are always public */
  publicScopes?: string[];
  /** Glob patterns for scopes that are always hidden (takes precedence over publicScopes) */
  hiddenScopes?: string[];
}

/**
 * System-level exposure configuration.
 * Controls what entities are visible to participants at the system level (Layer 1).
 */
export interface SystemExposure {
  /** Agent visibility configuration */
  agents?: AgentExposure;
  /** Event visibility configuration */
  events?: EventExposure;
  /** Scope visibility configuration */
  scopes?: ScopeExposure;
}

/**
 * Resource limits for the router.
 * Enforces capacity constraints to prevent resource exhaustion.
 */
export interface RouterLimits {
  /** Maximum total concurrent connections */
  maxConnections?: number;
  /** Maximum connections per unique client identity */
  maxConnectionsPerClient?: number;
  /** Maximum subscriptions per connection */
  maxSubscriptionsPerConnection?: number;
  /** Maximum agents a single client can register */
  maxAgentsPerClient?: number;
  /** Maximum scopes a single agent can join */
  maxScopesPerAgent?: number;
  /** Maximum events to retain for replay */
  maxEventHistory?: number;
}

/**
 * Router configuration
 */
export interface MAPRouterConfig {
  /** System name */
  name?: string;
  /** System version */
  version?: string;
  /** Default capabilities granted to clients */
  defaultClientCapabilities?: ParticipantCapabilities;
  /** Default capabilities granted to agents */
  defaultAgentCapabilities?: ParticipantCapabilities;

  /**
   * System-level exposure configuration.
   * Controls what entities are visible at Layer 1 of the permission model.
   */
  exposure?: SystemExposure;

  /**
   * Resource limits for the router.
   */
  limits?: RouterLimits;

  /**
   * Capabilities granted to anonymous/unauthenticated participants.
   * If not set, anonymous connections may be rejected or granted minimal permissions.
   */
  anonymousCapabilities?: ParticipantCapabilities;

  /** Authentication handler */
  authenticate?: (
    participantType: ParticipantType,
    auth: { method: string; token?: string }
  ) => Promise<{ allowed: boolean; capabilities?: ParticipantCapabilities }>;
}

/**
 * Interface for MAP router implementations.
 *
 * A router is the central component that:
 * - Accepts connections from participants (clients, agents, gateways)
 * - Routes messages between participants
 * - Manages agent lifecycle
 * - Handles subscriptions and event delivery
 * - Enforces permissions and visibility
 */
export interface MAPRouter {
  /**
   * Router configuration
   */
  readonly config: MAPRouterConfig;

  /**
   * Accept a new connection
   */
  acceptConnection(stream: Stream): Promise<ConnectedParticipant>;

  /**
   * Get all connected participants
   */
  getParticipants(): ConnectedParticipant[];

  /**
   * Get a specific participant
   */
  getParticipant(id: ParticipantId): ConnectedParticipant | undefined;

  /**
   * Disconnect a participant
   */
  disconnectParticipant(id: ParticipantId, reason?: string): Promise<void>;

  // ===========================================================================
  // Agent Management
  // ===========================================================================

  /**
   * Register a new agent
   */
  registerAgent(options: {
    agentId?: AgentId;
    name?: string;
    role?: string;
    parent?: AgentId;
    scopes?: ScopeId[];
    visibility?: string;
    capabilities?: ParticipantCapabilities;
    metadata?: Record<string, unknown>;
  }): Promise<Agent>;

  /**
   * Get an agent by ID
   */
  getAgent(agentId: AgentId): Agent | undefined;

  /**
   * List agents with filters
   */
  listAgents(filter?: {
    states?: string[];
    roles?: string[];
    scopes?: ScopeId[];
    parent?: AgentId;
  }): Agent[];

  /**
   * Update an agent
   */
  updateAgent(
    agentId: AgentId,
    updates: { state?: string; metadata?: Record<string, unknown> }
  ): Promise<Agent>;

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: AgentId): Promise<void>;

  // ===========================================================================
  // Scope Management
  // ===========================================================================

  /**
   * Create a scope
   */
  createScope(options: {
    scopeId?: ScopeId;
    name?: string;
    parent?: ScopeId;
    joinPolicy?: string;
    visibility?: string;
    messageVisibility?: string;
    sendPolicy?: string;
  }): Promise<Scope>;

  /**
   * Get a scope by ID
   */
  getScope(scopeId: ScopeId): Scope | undefined;

  /**
   * List scopes
   */
  listScopes(filter?: { parent?: ScopeId }): Scope[];

  /**
   * Delete a scope
   */
  deleteScope(scopeId: ScopeId): Promise<void>;

  /**
   * Add an agent to a scope
   */
  joinScope(scopeId: ScopeId, agentId: AgentId): Promise<void>;

  /**
   * Remove an agent from a scope
   */
  leaveScope(scopeId: ScopeId, agentId: AgentId): Promise<void>;

  /**
   * Get scope members
   */
  getScopeMembers(scopeId: ScopeId): AgentId[];

  // ===========================================================================
  // Messaging
  // ===========================================================================

  /**
   * Route a message to its destination(s)
   */
  routeMessage(
    from: ParticipantId,
    to: Address,
    message: Message
  ): Promise<{ delivered: ParticipantId[] }>;

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Create a subscription for a participant
   */
  createSubscription(
    participantId: ParticipantId,
    filter?: SubscriptionFilter
  ): Promise<string>;

  /**
   * Remove a subscription
   */
  removeSubscription(subscriptionId: string): Promise<void>;

  /**
   * Emit an event to subscribers
   */
  emitEvent(event: Event): void;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the router
   */
  start(): Promise<void>;

  /**
   * Stop the router
   */
  stop(): Promise<void>;
}

/**
 * Factory type for creating MAP routers
 */
export type MAPRouterFactory = (config?: MAPRouterConfig) => MAPRouter;
