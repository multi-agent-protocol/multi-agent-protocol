/**
 * Capability intersection logic for auth providers.
 *
 * When a provider maps external permissions to MAP capabilities,
 * the result is intersected with server defaults using most-restrictive (AND) logic.
 * If either side denies a capability, the result is denied.
 */

import type {
  ParticipantCapabilities,
  AgentPermissions,
  AgentVisibilityRule,
  ScopeVisibilityRule,
  StructureVisibilityRule,
  AgentMessagingRule,
  ScopeMessagingRule,
  AgentAcceptanceRule,
  ClientAcceptanceRule,
  SystemAcceptanceRule,
} from '../../types';

/**
 * Boolean AND that treats undefined as "no opinion" (permissive).
 * - If either is explicitly false → false
 * - If both are true → true
 * - If one is true and the other undefined → true
 * - If both undefined → undefined
 */
export function and(a?: boolean, b?: boolean): boolean | undefined {
  if (a === false || b === false) return false;
  if (a === true && b === true) return true;
  if (a === true) return true;
  if (b === true) return true;
  return undefined;
}

/**
 * Intersect two ParticipantCapabilities using most-restrictive (AND) logic.
 * If either side denies a capability, the result is denied.
 *
 * Server-config capabilities (mail, streaming, protocols) pass through from base unchanged.
 */
export function intersectCapabilities(
  base: ParticipantCapabilities,
  overlay: Partial<ParticipantCapabilities>
): ParticipantCapabilities {
  return {
    observation: (base.observation || overlay.observation) ? {
      canObserve: and(base.observation?.canObserve, overlay.observation?.canObserve),
      canQuery: and(base.observation?.canQuery, overlay.observation?.canQuery),
    } : undefined,
    messaging: (base.messaging || overlay.messaging) ? {
      canSend: and(base.messaging?.canSend, overlay.messaging?.canSend),
      canReceive: and(base.messaging?.canReceive, overlay.messaging?.canReceive),
      canBroadcast: and(base.messaging?.canBroadcast, overlay.messaging?.canBroadcast),
    } : undefined,
    lifecycle: (base.lifecycle || overlay.lifecycle) ? {
      canSpawn: and(base.lifecycle?.canSpawn, overlay.lifecycle?.canSpawn),
      canRegister: and(base.lifecycle?.canRegister, overlay.lifecycle?.canRegister),
      canUnregister: and(base.lifecycle?.canUnregister, overlay.lifecycle?.canUnregister),
      canSteer: and(base.lifecycle?.canSteer, overlay.lifecycle?.canSteer),
      canStop: and(base.lifecycle?.canStop, overlay.lifecycle?.canStop),
    } : undefined,
    scopes: (base.scopes || overlay.scopes) ? {
      canCreateScopes: and(base.scopes?.canCreateScopes, overlay.scopes?.canCreateScopes),
      canManageScopes: and(base.scopes?.canManageScopes, overlay.scopes?.canManageScopes),
    } : undefined,
    federation: (base.federation || overlay.federation) ? {
      canFederate: and(base.federation?.canFederate, overlay.federation?.canFederate),
    } : undefined,
    // Server-config capabilities pass through unchanged
    mail: base.mail,
    streaming: base.streaming,
    protocols: base.protocols,
    acp: base.acp,
  };
}

// Restrictiveness ordering for rule-based permission types.
// Lower index = more restrictive.
const VISIBILITY_ORDER: readonly string[] = ['direct', 'hierarchy', 'scoped', 'all'];
const SCOPE_VISIBILITY_ORDER: readonly string[] = ['member', 'all'];
const STRUCTURE_ORDER: readonly string[] = ['none', 'local', 'full'];
const MESSAGING_ORDER: readonly string[] = ['direct', 'hierarchy', 'scoped', 'all'];
const SCOPE_MESSAGING_ORDER: readonly string[] = ['member', 'all'];
const ACCEPTANCE_ORDER: readonly string[] = ['none', 'all'];

/**
 * Pick the more restrictive of two rule values.
 * If either is an object (explicit include list), it wins as more restrictive than any string rule.
 * If both are strings, the one with lower index in the ordering wins.
 */
function moreRestrictiveRule<T extends string | { include: unknown[] }>(
  a: T | undefined,
  b: T | undefined,
  order: readonly string[]
): T | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;

  // Object rules ({ include: [...] }) are most restrictive
  if (typeof a === 'object') return a;
  if (typeof b === 'object') return b;

  const aIdx = order.indexOf(a as string);
  const bIdx = order.indexOf(b as string);

  // Unknown values are treated as least restrictive
  const aEff = aIdx === -1 ? order.length : aIdx;
  const bEff = bIdx === -1 ? order.length : bIdx;

  return aEff <= bEff ? a : b;
}

/**
 * Intersect two AgentPermissions using most-restrictive logic.
 * For rule-based fields, takes the more restrictive rule.
 */
export function intersectAgentPermissions(
  base: AgentPermissions,
  overlay: Partial<AgentPermissions>
): AgentPermissions {
  return {
    canSee: (base.canSee || overlay.canSee) ? {
      agents: moreRestrictiveRule<AgentVisibilityRule>(
        base.canSee?.agents, overlay.canSee?.agents, VISIBILITY_ORDER
      ),
      scopes: moreRestrictiveRule<ScopeVisibilityRule>(
        base.canSee?.scopes, overlay.canSee?.scopes, SCOPE_VISIBILITY_ORDER
      ),
      structure: moreRestrictiveRule<StructureVisibilityRule>(
        base.canSee?.structure, overlay.canSee?.structure, STRUCTURE_ORDER
      ) as StructureVisibilityRule | undefined,
    } : undefined,
    canMessage: (base.canMessage || overlay.canMessage) ? {
      agents: moreRestrictiveRule<AgentMessagingRule>(
        base.canMessage?.agents, overlay.canMessage?.agents, MESSAGING_ORDER
      ),
      scopes: moreRestrictiveRule<ScopeMessagingRule>(
        base.canMessage?.scopes, overlay.canMessage?.scopes, SCOPE_MESSAGING_ORDER
      ),
    } : undefined,
    acceptsFrom: (base.acceptsFrom || overlay.acceptsFrom) ? {
      agents: moreRestrictiveRule<AgentAcceptanceRule>(
        base.acceptsFrom?.agents, overlay.acceptsFrom?.agents, ACCEPTANCE_ORDER
      ),
      clients: moreRestrictiveRule<ClientAcceptanceRule>(
        base.acceptsFrom?.clients, overlay.acceptsFrom?.clients, ACCEPTANCE_ORDER
      ),
      systems: moreRestrictiveRule<SystemAcceptanceRule>(
        base.acceptsFrom?.systems, overlay.acceptsFrom?.systems, ACCEPTANCE_ORDER
      ),
    } : undefined,
  };
}
