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
  Scope,
  ScopeId,
  Event,
  EventType,
  ParticipantCapabilities,
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
