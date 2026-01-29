/**
 * Permission utilities for MAP SDK
 *
 * Provides building blocks for implementing the 4-layer permission model:
 * - Layer 1: System configuration (what's exposed at all)
 * - Layer 2: Client permissions (what can this client do)
 * - Layer 3: Scope permissions (what's allowed in this scope)
 * - Layer 4: Agent permissions (what can this agent do)
 *
 * These utilities are opt-in building blocks for router implementations.
 * They provide the logic for permission checks but don't enforce them.
 */

import type {
  Agent,
  AgentId,
  AgentPermissions,
  AgentPermissionConfig,
  AgentVisibilityRule,
  AgentVisibility,
  AgentAcceptanceRule,
  ClientAcceptanceRule,
  SystemAcceptanceRule,
  Scope,
  ScopeId,
  Event,
  EventType,
  ParticipantCapabilities,
  ParticipantId,
  ParticipantType,
} from '../types';
import { getRequiredCapabilities, hasRequiredCapabilities } from '../protocol';

// =============================================================================
// Types
// =============================================================================

/**
 * System-level exposure configuration.
 * Controls what entities are visible to participants at all.
 */
export interface SystemExposure {
  agents?: {
    /** Whether agents are public by default (default: true) */
    publicByDefault?: boolean;
    /** Glob patterns for agents that are always public */
    publicAgents?: string[];
    /** Glob patterns for agents that are always hidden (takes precedence) */
    hiddenAgents?: string[];
  };
  events?: {
    /** Event types that are exposed (whitelist, if provided) */
    exposedTypes?: EventType[];
    /** Event types that are always hidden (blacklist) */
    hiddenTypes?: EventType[];
  };
  scopes?: {
    /** Whether scopes are public by default (default: true) */
    publicByDefault?: boolean;
    /** Glob patterns for scopes that are always public */
    publicScopes?: string[];
    /** Glob patterns for scopes that are always hidden (takes precedence) */
    hiddenScopes?: string[];
  };
}

/**
 * Full system configuration for permissions
 */
export interface PermissionSystemConfig {
  /** What entities are exposed to participants */
  exposure?: SystemExposure;
  /** Resource limits */
  limits?: {
    maxConnections?: number;
    maxConnectionsPerClient?: number;
    maxSubscriptionsPerConnection?: number;
    maxAgentsPerClient?: number;
  };
}

/**
 * Represents a connected participant for permission checks
 */
export interface PermissionParticipant {
  /** Participant ID */
  id: string;
  /** Participant type */
  type: ParticipantType;
  /** Granted capabilities */
  capabilities: ParticipantCapabilities;
}

/**
 * Context for permission checks
 */
export interface PermissionContext {
  /** System-wide configuration */
  system: PermissionSystemConfig;
  /** The participant performing the action */
  participant: PermissionParticipant;
  /** Agent IDs owned by this participant */
  ownedAgentIds?: AgentId[];
  /** Scope membership: scopeId -> agent IDs that are members */
  scopeMembership?: Map<ScopeId, AgentId[]>;
}

/**
 * Action being performed for permission checking
 */
export interface PermissionAction {
  /** Action category */
  type: 'query' | 'message' | 'lifecycle' | 'scope' | 'subscribe';
  /** Wire method name (e.g., 'map/agents/list') */
  method: string;
  /** Target of the action */
  target?: {
    agentId?: AgentId;
    scopeId?: ScopeId;
    eventTypes?: EventType[];
  };
}

/**
 * Result of a permission check
 */
export interface PermissionResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Reason for denial (if denied) */
  reason?: string;
  /** Which layer denied the action (if denied) */
  layer?: 1 | 2 | 3 | 4;
}

// =============================================================================
// Layer 1: System Exposure Checks
// =============================================================================

/**
 * Check if an agent is exposed by system configuration.
 *
 * Hidden patterns take precedence over public patterns.
 * If no configuration, agents are exposed by default.
 *
 * @param exposure - System exposure configuration
 * @param agentId - Agent ID to check
 * @returns true if the agent is exposed
 */
export function isAgentExposed(
  exposure: SystemExposure | undefined,
  agentId: AgentId
): boolean {
  if (!exposure?.agents) return true; // Default: exposed

  const {
    publicByDefault = true,
    publicAgents = [],
    hiddenAgents = [],
  } = exposure.agents;

  // Hidden takes precedence
  if (matchesPatterns(agentId, hiddenAgents)) return false;

  // Check public list
  if (matchesPatterns(agentId, publicAgents)) return true;

  return publicByDefault;
}

/**
 * Check if an event type is exposed by system configuration.
 *
 * Hidden types take precedence. If a whitelist is provided,
 * only those types are exposed.
 *
 * @param exposure - System exposure configuration
 * @param eventType - Event type to check
 * @returns true if the event type is exposed
 */
export function isEventTypeExposed(
  exposure: SystemExposure | undefined,
  eventType: EventType
): boolean {
  if (!exposure?.events) return true;

  const { exposedTypes, hiddenTypes = [] } = exposure.events;

  // Hidden takes precedence
  if (hiddenTypes.includes(eventType)) return false;

  // If whitelist exists, must be in it
  if (exposedTypes && !exposedTypes.includes(eventType)) return false;

  return true;
}

/**
 * Check if a scope is exposed by system configuration.
 *
 * Hidden patterns take precedence over public patterns.
 *
 * @param exposure - System exposure configuration
 * @param scopeId - Scope ID to check
 * @returns true if the scope is exposed
 */
export function isScopeExposed(
  exposure: SystemExposure | undefined,
  scopeId: ScopeId
): boolean {
  if (!exposure?.scopes) return true;

  const {
    publicByDefault = true,
    publicScopes = [],
    hiddenScopes = [],
  } = exposure.scopes;

  // Hidden takes precedence
  if (matchesPatterns(scopeId, hiddenScopes)) return false;

  // Check public list
  if (matchesPatterns(scopeId, publicScopes)) return true;

  return publicByDefault;
}

// =============================================================================
// Layer 2: Client/Participant Capability Checks
// =============================================================================

/**
 * Check if a participant has a specific capability.
 *
 * @param capabilities - Participant's capabilities
 * @param path - Capability path like 'observation.canQuery'
 * @returns true if the capability is granted
 *
 * @example
 * ```typescript
 * if (hasCapability(participant.capabilities, 'lifecycle.canSpawn')) {
 *   // Can spawn agents
 * }
 * ```
 */
export function hasCapability(
  capabilities: ParticipantCapabilities,
  path: string
): boolean {
  const [category, cap] = path.split('.') as [keyof ParticipantCapabilities, string];
  const categoryCapabilities = capabilities[category] as Record<string, boolean> | undefined;
  return categoryCapabilities?.[cap] ?? false;
}

/**
 * Check if a participant can perform a method based on capabilities.
 *
 * @param method - Wire method name (e.g., 'map/agents/list')
 * @param capabilities - Participant's capabilities
 * @returns true if all required capabilities are present
 */
export function canPerformMethod(
  method: string,
  capabilities: ParticipantCapabilities
): boolean {
  return hasRequiredCapabilities(method, capabilities);
}

/**
 * Get the capabilities required for a method.
 *
 * @param method - Wire method name or registry key
 * @returns Array of capability paths
 */
export { getRequiredCapabilities };

// =============================================================================
// Layer 3: Scope Permission Checks
// =============================================================================

/**
 * Check if a participant can see a scope.
 *
 * @param scope - The scope to check
 * @param participant - The participant
 * @param memberAgentIds - Agent IDs owned by participant that are scope members
 * @returns true if the participant can see the scope
 */
export function canSeeScope(
  scope: Scope,
  participant: PermissionParticipant,
  memberAgentIds: AgentId[] = []
): boolean {
  const visibility = scope.visibility ?? 'public';

  switch (visibility) {
    case 'public':
      return true;
    case 'members':
      return memberAgentIds.length > 0;
    case 'system':
      return participant.type === 'system';
    default:
      return false;
  }
}

/**
 * Check if a participant can send messages to a scope.
 *
 * @param scope - The scope to check
 * @param participant - The participant
 * @param memberAgentIds - Agent IDs owned by participant that are scope members
 * @returns true if the participant can send to the scope
 */
export function canSendToScope(
  scope: Scope,
  participant: PermissionParticipant,
  memberAgentIds: AgentId[] = []
): boolean {
  // System can always send
  if (participant.type === 'system') return true;

  const sendPolicy = scope.sendPolicy ?? 'members';

  switch (sendPolicy) {
    case 'any':
      return true;
    case 'members':
      return memberAgentIds.length > 0;
    default:
      return false;
  }
}

/**
 * Check if a participant can join a scope.
 *
 * @param scope - The scope to check
 * @param participantType - Type of the participant
 * @param agentRole - Role of the agent trying to join (for role-based policies)
 * @returns true if the participant can join the scope
 */
export function canJoinScope(
  scope: Scope,
  participantType: ParticipantType,
  agentRole?: string
): boolean {
  const joinPolicy = scope.joinPolicy ?? 'open';

  switch (joinPolicy) {
    case 'open':
      return true;
    case 'invite':
      // Would need invitation tracking - simplified to false
      return false;
    case 'role':
      // Check if agent role matches auto-join roles
      if (!agentRole || !scope.autoJoinRoles) return false;
      return scope.autoJoinRoles.includes(agentRole);
    case 'system':
      return participantType === 'system';
    default:
      return false;
  }
}

// =============================================================================
// Layer 4: Agent Permission Checks
// =============================================================================

/**
 * Check if a participant can see an agent.
 *
 * @param agent - The agent to check
 * @param participant - The participant
 * @param ownedAgentIds - Agent IDs owned by this participant
 * @returns true if the participant can see the agent
 */
export function canSeeAgent(
  agent: Agent,
  participant: PermissionParticipant,
  ownedAgentIds: AgentId[] = []
): boolean {
  const visibility = agent.visibility ?? 'public';

  switch (visibility) {
    case 'public':
      return true;
    case 'parent-only':
      // Can see if we own the parent or the agent itself
      if (ownedAgentIds.includes(agent.id)) return true;
      return agent.parent ? ownedAgentIds.includes(agent.parent) : false;
    case 'scope':
      // Would need scope membership check - simplified to true
      // In practice, would check if participant has agent in same scope
      return true;
    case 'system':
      return participant.type === 'system';
    default:
      return false;
  }
}

/**
 * Check if a participant can send messages to an agent.
 *
 * @param agent - Target agent
 * @param participant - The participant
 * @param ownedAgentIds - Agent IDs owned by this participant
 * @returns true if the participant can message the agent
 */
export function canMessageAgent(
  agent: Agent,
  participant: PermissionParticipant,
  ownedAgentIds: AgentId[] = []
): boolean {
  // Must be able to see the agent first
  if (!canSeeAgent(agent, participant, ownedAgentIds)) {
    return false;
  }

  // Additional messaging restrictions could be added here
  // For now, if you can see it, you can message it
  return true;
}

/**
 * Check if a participant can control an agent (stop, suspend, etc.).
 *
 * @param agent - Target agent
 * @param participant - The participant
 * @param ownedAgentIds - Agent IDs owned by this participant
 * @returns true if the participant can control the agent
 */
export function canControlAgent(
  agent: Agent,
  participant: PermissionParticipant,
  ownedAgentIds: AgentId[] = []
): boolean {
  // System can control any agent
  if (participant.type === 'system') return true;

  // Must own the agent or its ancestor
  if (ownedAgentIds.includes(agent.id)) return true;

  // Check if we own an ancestor (parent chain)
  // This would need the full agent registry in practice
  // Simplified: just check direct parent
  if (agent.parent && ownedAgentIds.includes(agent.parent)) return true;

  return false;
}

// =============================================================================
// High-Level Resolution
// =============================================================================

/**
 * Check if an action is permitted across all 4 layers.
 *
 * This is the main entry point for comprehensive permission checking.
 * It evaluates each layer in order and returns the first denial or success.
 *
 * @param context - Permission context with system config and participant info
 * @param action - The action to check
 * @returns Permission result with allowed status, reason, and layer
 *
 * @example
 * ```typescript
 * const result = canPerformAction(
 *   {
 *     system: { exposure: { agents: { hiddenAgents: ['internal-*'] } } },
 *     participant: { id: 'client-1', type: 'client', capabilities },
 *     ownedAgentIds: ['agent-1'],
 *   },
 *   {
 *     type: 'query',
 *     method: 'map/agents/get',
 *     target: { agentId: 'internal-worker' },
 *   }
 * );
 *
 * if (!result.allowed) {
 *   console.log(`Denied at layer ${result.layer}: ${result.reason}`);
 * }
 * ```
 */
export function canPerformAction(
  context: PermissionContext,
  action: PermissionAction
): PermissionResult {
  // Layer 1: System exposure
  if (action.target?.agentId) {
    if (!isAgentExposed(context.system.exposure, action.target.agentId)) {
      return {
        allowed: false,
        reason: 'Agent not exposed by system configuration',
        layer: 1,
      };
    }
  }
  if (action.target?.scopeId) {
    if (!isScopeExposed(context.system.exposure, action.target.scopeId)) {
      return {
        allowed: false,
        reason: 'Scope not exposed by system configuration',
        layer: 1,
      };
    }
  }
  if (action.target?.eventTypes) {
    for (const eventType of action.target.eventTypes) {
      if (!isEventTypeExposed(context.system.exposure, eventType)) {
        return {
          allowed: false,
          reason: `Event type '${eventType}' not exposed by system configuration`,
          layer: 1,
        };
      }
    }
  }

  // Layer 2: Participant capabilities
  const requiredCaps = getRequiredCapabilities(action.method);
  for (const cap of requiredCaps) {
    if (!hasCapability(context.participant.capabilities, cap)) {
      return {
        allowed: false,
        reason: `Missing required capability: ${cap}`,
        layer: 2,
      };
    }
  }

  // Layer 3 and 4 would require actual entity lookups
  // These are handled by the filtering utilities below

  return { allowed: true };
}

// =============================================================================
// Filtering Utilities
// =============================================================================

/**
 * Filter agents to only those visible to the participant.
 *
 * Applies both Layer 1 (system exposure) and Layer 4 (agent visibility).
 *
 * @param agents - Agents to filter
 * @param context - Permission context
 * @returns Filtered list of visible agents
 */
export function filterVisibleAgents(
  agents: Agent[],
  context: PermissionContext
): Agent[] {
  const ownedAgentIds = context.ownedAgentIds ?? [];

  return agents.filter((agent) => {
    // Layer 1: System exposure
    if (!isAgentExposed(context.system.exposure, agent.id)) {
      return false;
    }

    // Layer 4: Agent visibility
    if (!canSeeAgent(agent, context.participant, ownedAgentIds)) {
      return false;
    }

    return true;
  });
}

/**
 * Filter scopes to only those visible to the participant.
 *
 * Applies both Layer 1 (system exposure) and Layer 3 (scope visibility).
 *
 * @param scopes - Scopes to filter
 * @param context - Permission context
 * @returns Filtered list of visible scopes
 */
export function filterVisibleScopes(
  scopes: Scope[],
  context: PermissionContext
): Scope[] {
  const scopeMembership = context.scopeMembership ?? new Map();

  return scopes.filter((scope) => {
    // Layer 1: System exposure
    if (!isScopeExposed(context.system.exposure, scope.id)) {
      return false;
    }

    // Layer 3: Scope visibility
    const memberAgentIds = scopeMembership.get(scope.id) ?? [];
    if (!canSeeScope(scope, context.participant, memberAgentIds)) {
      return false;
    }

    return true;
  });
}

/**
 * Filter events to only those visible to the participant.
 *
 * Applies Layer 1 (system exposure) for event types.
 *
 * @param events - Events to filter
 * @param context - Permission context
 * @returns Filtered list of visible events
 */
export function filterVisibleEvents(
  events: Event[],
  context: PermissionContext
): Event[] {
  return events.filter((event) => {
    // Layer 1: Event type exposure
    if (!isEventTypeExposed(context.system.exposure, event.type)) {
      return false;
    }

    // Additional filtering based on event source could be added here
    // e.g., filter out events from hidden agents

    return true;
  });
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a value matches any of the glob patterns.
 *
 * @param value - Value to check
 * @param patterns - Glob patterns (supports * and ? wildcards)
 * @returns true if value matches any pattern
 */
function matchesPatterns(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchGlob(value, pattern));
}

/**
 * Simple glob matching supporting * and ? wildcards.
 *
 * @param value - Value to match
 * @param pattern - Glob pattern
 * @returns true if value matches pattern
 */
function matchGlob(value: string, pattern: string): boolean {
  // Escape special regex characters except * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(value);
}

// =============================================================================
// Agent Permission Resolution (Hybrid Model)
// =============================================================================

/**
 * Deep clone an object (simple implementation for permission objects)
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Deep merge two permission objects.
 * Second object's fields override first at the leaf level.
 *
 * @param base - Base permissions
 * @param override - Override permissions (partial)
 * @returns Merged permissions
 */
export function deepMergePermissions(
  base: AgentPermissions,
  override: Partial<AgentPermissions>
): AgentPermissions {
  const result: AgentPermissions = { ...base };

  if (override.canSee) {
    result.canSee = { ...base.canSee, ...override.canSee };
  }
  if (override.canMessage) {
    result.canMessage = { ...base.canMessage, ...override.canMessage };
  }
  if (override.acceptsFrom) {
    result.acceptsFrom = { ...base.acceptsFrom, ...override.acceptsFrom };
  }

  return result;
}

/**
 * Map legacy AgentVisibility to AgentVisibilityRule.
 *
 * @param visibility - Legacy visibility value
 * @returns Equivalent visibility rule
 */
export function mapVisibilityToRule(visibility: AgentVisibility): AgentVisibilityRule {
  switch (visibility) {
    case 'public':
      return 'all';
    case 'parent-only':
      return 'hierarchy';
    case 'scope':
      return 'scoped';
    case 'system':
      return 'direct';
    default:
      return 'all';
  }
}

/**
 * Default agent permission configuration.
 * Used when no configuration is provided.
 */
export const DEFAULT_AGENT_PERMISSION_CONFIG: AgentPermissionConfig = {
  defaultPermissions: {
    canSee: {
      agents: 'all',
      scopes: 'all',
      structure: 'full',
    },
    canMessage: {
      agents: 'all',
      scopes: 'all',
    },
    acceptsFrom: {
      agents: 'all',
      clients: 'all',
      systems: 'all',
    },
  },
  rolePermissions: {},
};

/**
 * Resolve effective permissions for an agent.
 *
 * Resolution order:
 * 1. Start with system default permissions
 * 2. If agent has a role, deep merge role permissions
 * 3. Deep merge agent's permissionOverrides
 * 4. (Backwards compat) Map legacy visibility field if no override
 *
 * @param agent - The agent to resolve permissions for
 * @param config - System permission configuration
 * @returns Resolved effective permissions
 *
 * @example
 * ```typescript
 * const config: AgentPermissionConfig = {
 *   defaultPermissions: { canSee: { agents: 'all' } },
 *   rolePermissions: {
 *     worker: { canSee: { agents: 'hierarchy' } },
 *   },
 * };
 *
 * const agent = { id: 'a1', role: 'worker', ownerId: 'c1', state: 'active' };
 * const perms = resolveAgentPermissions(agent, config);
 * // perms.canSee.agents === 'hierarchy'
 * ```
 */
export function resolveAgentPermissions(
  agent: Agent,
  config: AgentPermissionConfig = DEFAULT_AGENT_PERMISSION_CONFIG
): AgentPermissions {
  // Start with defaults
  let permissions = deepClone(config.defaultPermissions);

  // Apply role permissions
  if (agent.role && config.rolePermissions[agent.role]) {
    permissions = deepMergePermissions(permissions, config.rolePermissions[agent.role]);
  }

  // Apply agent overrides
  if (agent.permissionOverrides) {
    permissions = deepMergePermissions(permissions, agent.permissionOverrides);
  }

  // Backwards compatibility: map legacy visibility
  if (agent.visibility && !agent.permissionOverrides?.canSee?.agents) {
    permissions.canSee = permissions.canSee ?? {};
    permissions.canSee.agents = mapVisibilityToRule(agent.visibility);
  }

  return permissions;
}

// =============================================================================
// Agent Acceptance Checks
// =============================================================================

/**
 * Context for checking if an agent accepts messages from a sender.
 */
export interface AcceptanceContext {
  /** Type of the sender */
  senderType: ParticipantType;
  /** Participant ID of the sender */
  senderId: ParticipantId;
  /** If sender is an agent, its agent ID */
  senderAgentId?: AgentId;
  /** If sender is from a federated system, its system ID */
  senderSystemId?: string;

  // Hierarchy info for 'hierarchy' rules
  /** Whether sender is the parent of target */
  isParent?: boolean;
  /** Whether sender is a child of target */
  isChild?: boolean;
  /** Whether sender is an ancestor of target */
  isAncestor?: boolean;
  /** Whether sender is a descendant of target */
  isDescendant?: boolean;

  // Scope info for 'scoped' rules
  /** Scope IDs that both sender and target are members of */
  sharedScopes?: ScopeId[];
}

/**
 * Check if an agent acceptance rule allows the sender.
 */
function checkAgentAcceptance(
  rule: AgentAcceptanceRule | undefined,
  context: AcceptanceContext
): boolean {
  if (!rule || rule === 'all') return true;

  if (rule === 'hierarchy') {
    return (
      context.isParent === true ||
      context.isChild === true ||
      context.isAncestor === true ||
      context.isDescendant === true
    );
  }

  if (rule === 'scoped') {
    return (context.sharedScopes?.length ?? 0) > 0;
  }

  if (typeof rule === 'object' && 'include' in rule) {
    return context.senderAgentId !== undefined && rule.include.includes(context.senderAgentId);
  }

  return false;
}

/**
 * Check if a client acceptance rule allows the sender.
 */
function checkClientAcceptance(
  rule: ClientAcceptanceRule | undefined,
  senderId: ParticipantId
): boolean {
  if (!rule || rule === 'all') return true;
  if (rule === 'none') return false;

  if (typeof rule === 'object' && 'include' in rule) {
    return rule.include.includes(senderId);
  }

  return false;
}

/**
 * Check if a system acceptance rule allows the sender.
 */
function checkSystemAcceptance(
  rule: SystemAcceptanceRule | undefined,
  senderSystemId: string | undefined
): boolean {
  if (!rule || rule === 'all') return true;
  if (rule === 'none') return false;

  if (typeof rule === 'object' && 'include' in rule) {
    return senderSystemId !== undefined && rule.include.includes(senderSystemId);
  }

  return false;
}

/**
 * Check if an agent accepts messages from the given sender.
 *
 * Uses the agent's resolved permissions to determine if the sender
 * is allowed based on sender type and acceptance rules.
 *
 * @param targetAgent - The agent that would receive the message
 * @param context - Information about the sender
 * @param config - System permission configuration
 * @returns true if the agent accepts messages from this sender
 *
 * @example
 * ```typescript
 * const accepts = canAgentAcceptMessage(
 *   targetAgent,
 *   {
 *     senderType: 'agent',
 *     senderId: 'client-1',
 *     senderAgentId: 'agent-2',
 *     isParent: true,
 *   },
 *   config
 * );
 * ```
 */
export function canAgentAcceptMessage(
  targetAgent: Agent,
  context: AcceptanceContext,
  config: AgentPermissionConfig = DEFAULT_AGENT_PERMISSION_CONFIG
): boolean {
  const permissions = resolveAgentPermissions(targetAgent, config);
  const acceptsFrom = permissions.acceptsFrom;

  // No restrictions = accept all
  if (!acceptsFrom) return true;

  // Check based on sender type
  switch (context.senderType) {
    case 'agent':
      return checkAgentAcceptance(acceptsFrom.agents, context);
    case 'client':
      return checkClientAcceptance(acceptsFrom.clients, context.senderId);
    case 'system':
    case 'gateway':
      return checkSystemAcceptance(acceptsFrom.systems, context.senderSystemId);
    default:
      return false;
  }
}

/**
 * Check if an agent can see another agent based on permissions.
 *
 * @param viewerAgent - The agent trying to see
 * @param targetAgentId - ID of the agent being viewed
 * @param context - Hierarchy and scope context
 * @param config - System permission configuration
 * @returns true if viewer can see target
 */
export function canAgentSeeAgent(
  viewerAgent: Agent,
  targetAgentId: AgentId,
  context: {
    isParent?: boolean;
    isChild?: boolean;
    isAncestor?: boolean;
    isDescendant?: boolean;
    sharedScopes?: ScopeId[];
  },
  config: AgentPermissionConfig = DEFAULT_AGENT_PERMISSION_CONFIG
): boolean {
  const permissions = resolveAgentPermissions(viewerAgent, config);
  const canSee = permissions.canSee?.agents;

  if (!canSee || canSee === 'all') return true;

  if (canSee === 'hierarchy') {
    return (
      context.isParent === true ||
      context.isChild === true ||
      context.isAncestor === true ||
      context.isDescendant === true
    );
  }

  if (canSee === 'scoped') {
    return (context.sharedScopes?.length ?? 0) > 0;
  }

  if (canSee === 'direct') {
    // Direct means explicit allowlist only
    return false;
  }

  if (typeof canSee === 'object' && 'include' in canSee) {
    return canSee.include.includes(targetAgentId);
  }

  return false;
}

/**
 * Check if an agent can message another agent based on permissions.
 *
 * @param senderAgent - The agent sending the message
 * @param targetAgentId - ID of the target agent
 * @param context - Hierarchy and scope context
 * @param config - System permission configuration
 * @returns true if sender can message target
 */
export function canAgentMessageAgent(
  senderAgent: Agent,
  targetAgentId: AgentId,
  context: {
    isParent?: boolean;
    isChild?: boolean;
    isAncestor?: boolean;
    isDescendant?: boolean;
    sharedScopes?: ScopeId[];
  },
  config: AgentPermissionConfig = DEFAULT_AGENT_PERMISSION_CONFIG
): boolean {
  const permissions = resolveAgentPermissions(senderAgent, config);
  const canMessage = permissions.canMessage?.agents;

  if (!canMessage || canMessage === 'all') return true;

  if (canMessage === 'hierarchy') {
    return (
      context.isParent === true ||
      context.isChild === true ||
      context.isAncestor === true ||
      context.isDescendant === true
    );
  }

  if (canMessage === 'scoped') {
    return (context.sharedScopes?.length ?? 0) > 0;
  }

  if (typeof canMessage === 'object' && 'include' in canMessage) {
    return canMessage.include.includes(targetAgentId);
  }

  return false;
}
