/**
 * Maps agent-iam token capabilities to MAP's ParticipantCapabilities and AgentPermissions.
 *
 * Priority:
 * 1. agentCapabilities field on token (explicit override)
 * 2. Scope-based inference from token.scopes
 */

import type { ParticipantCapabilities, AgentPermissions } from '../../../types';
import type { CapabilityMapping } from '../types';

/**
 * Minimal AgentToken shape consumed by the mapper.
 * Avoids hard dependency on agent-iam types at the module level.
 */
export interface MappableToken {
  scopes: string[];
  agentCapabilities?: {
    canSpawn?: boolean;
    canFederate?: boolean;
    canCreateScopes?: boolean;
    visibility?: 'public' | 'parent-only' | 'scope' | 'system';
    canMessage?: boolean;
    canReceive?: boolean;
    canObserve?: boolean;
    custom?: Record<string, boolean>;
  };
}

export interface AgentIAMCapabilityMapperOptions {
  /** Custom scope-to-capability mappings (overrides defaults) */
  scopeMap?: Record<string, string>;
}

/**
 * Maps agent-iam token capabilities to MAP's capability model.
 */
export class AgentIAMCapabilityMapper {
  constructor(_options: AgentIAMCapabilityMapperOptions = {}) {}

  /**
   * Map a token to a CapabilityMapping.
   */
  map(token: MappableToken): CapabilityMapping {
    const participantCapabilities = this.mapToParticipantCapabilities(token);
    const defaultAgentPermissions = this.mapToAgentPermissions(token);

    return {
      participantCapabilities,
      ...(defaultAgentPermissions && { defaultAgentPermissions }),
    };
  }

  mapToParticipantCapabilities(token: MappableToken): Partial<ParticipantCapabilities> {
    const caps = token.agentCapabilities;

    // If agentCapabilities is present, use it directly
    if (caps) {
      return {
        observation: {
          canObserve: caps.canObserve,
          canQuery: caps.canObserve,
        },
        messaging: {
          canSend: caps.canMessage,
          canReceive: caps.canReceive,
          canBroadcast: caps.canMessage,
        },
        lifecycle: {
          canSpawn: caps.canSpawn,
          canRegister: true,
        },
        scopes: {
          canCreateScopes: caps.canCreateScopes,
        },
        federation: {
          canFederate: caps.canFederate,
        },
      };
    }

    // Fall back to scope-based inference
    return this.inferFromScopes(token.scopes);
  }

  mapToAgentPermissions(token: MappableToken): Partial<AgentPermissions> | undefined {
    const caps = token.agentCapabilities;
    if (!caps) return undefined;

    const visibilityToRule: Record<string, 'all' | 'scoped' | 'hierarchy' | 'direct'> = {
      'public': 'all',
      'scope': 'scoped',
      'parent-only': 'hierarchy',
      'system': 'direct',
    };

    const visRule = caps.visibility ? visibilityToRule[caps.visibility] : undefined;

    return {
      canSee: {
        agents: visRule,
        scopes: caps.canObserve ? 'all' : 'member',
      },
      canMessage: {
        agents: caps.canMessage ? 'all' : undefined,
      },
      acceptsFrom: {
        agents: caps.canReceive ? 'all' : { include: [] },
      },
    };
  }

  private inferFromScopes(scopes: string[]): Partial<ParticipantCapabilities> {
    // Check for wildcard
    if (scopes.some(s => s === 'map:*' || s === '*')) {
      return {
        observation: { canObserve: true, canQuery: true },
        messaging: { canSend: true, canReceive: true, canBroadcast: true },
        lifecycle: { canSpawn: true, canRegister: true },
        scopes: { canCreateScopes: true, canManageScopes: true },
        federation: { canFederate: true },
      };
    }

    const result: Partial<ParticipantCapabilities> = {};

    for (const scope of scopes) {
      if (scope.startsWith('map:observe')) {
        result.observation = { ...result.observation, canObserve: true, canQuery: true };
      }
      if (scope.startsWith('map:send') || scope.startsWith('map:message')) {
        result.messaging = { ...result.messaging, canSend: true };
      }
      if (scope.startsWith('map:receive')) {
        result.messaging = { ...result.messaging, canReceive: true };
      }
      if (scope.startsWith('map:broadcast')) {
        result.messaging = { ...result.messaging, canBroadcast: true };
      }
      if (scope.startsWith('map:spawn')) {
        result.lifecycle = { ...result.lifecycle, canSpawn: true };
      }
      if (scope.startsWith('map:register')) {
        result.lifecycle = { ...result.lifecycle, canRegister: true };
      }
      if (scope.startsWith('map:scope:create')) {
        result.scopes = { ...result.scopes, canCreateScopes: true };
      }
      if (scope.startsWith('map:scope:manage')) {
        result.scopes = { ...result.scopes, canManageScopes: true };
      }
      if (scope.startsWith('map:federate')) {
        result.federation = { ...result.federation, canFederate: true };
      }
    }

    return result;
  }
}
