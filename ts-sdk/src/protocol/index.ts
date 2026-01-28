/**
 * Protocol utilities for MAP SDK
 *
 * Provides:
 * - METHOD_REGISTRY: Single source of truth for all methods with metadata
 * - Response builders: Type-safe response construction
 * - Helper functions for method capability checking
 */

import type {
  Agent,
  Scope,
  ParticipantCapabilities,
  ConnectResponseResult,
  DisconnectResponseResult,
  SendResponseResult,
  AgentsRegisterResponseResult,
  AgentsUnregisterResponseResult,
  AgentsListResponseResult,
  AgentsGetResponseResult,
  AgentsUpdateResponseResult,
  AgentsSpawnResponseResult,
  ScopesCreateResponseResult,
  ScopesListResponseResult,
  ScopesJoinResponseResult,
  ScopesLeaveResponseResult,
  SubscribeResponseResult,
  UnsubscribeResponseResult,
  SessionInfo,
  SubscriptionId,
  MessageId,
  ParticipantId,
  ProtocolVersion,
  SessionId,
} from '../types';

// =============================================================================
// Method Registry
// =============================================================================

/** Method category for organization */
export type MethodCategory =
  | 'core'
  | 'observation'
  | 'lifecycle'
  | 'state'
  | 'steering'
  | 'scope'
  | 'session'
  | 'auth'
  | 'federation'
  | 'notification';

/** Capability path like 'observation.canQuery' */
export type CapabilityPath = string;

/** Method metadata */
export interface MethodInfo {
  /** The wire method name */
  method: string;
  /** Category for organization */
  category: MethodCategory;
  /** Required capabilities (empty = no special capabilities needed) */
  capabilities: CapabilityPath[];
  /** Human-readable description */
  description: string;
}

/**
 * Method Registry - Single source of truth for all MAP methods
 *
 * Use this instead of individual method constants for:
 * - Capability checking
 * - Method validation
 * - Documentation generation
 */
export const METHOD_REGISTRY: Record<string, MethodInfo> = {
  // Core methods
  'connect': {
    method: 'map/connect',
    category: 'core',
    capabilities: [],
    description: 'Establish connection to MAP system',
  },
  'disconnect': {
    method: 'map/disconnect',
    category: 'core',
    capabilities: [],
    description: 'Disconnect from MAP system',
  },
  'send': {
    method: 'map/send',
    category: 'core',
    capabilities: ['messaging.canSend'],
    description: 'Send a message to an address',
  },
  'subscribe': {
    method: 'map/subscribe',
    category: 'core',
    capabilities: ['observation.canObserve'],
    description: 'Subscribe to event stream',
  },
  'unsubscribe': {
    method: 'map/unsubscribe',
    category: 'core',
    capabilities: ['observation.canObserve'],
    description: 'Unsubscribe from event stream',
  },
  'replay': {
    method: 'map/replay',
    category: 'core',
    capabilities: ['observation.canObserve'],
    description: 'Replay historical events with filtering and pagination',
  },

  // Observation methods
  'agents/list': {
    method: 'map/agents/list',
    category: 'observation',
    capabilities: ['observation.canQuery'],
    description: 'List agents with optional filters',
  },
  'agents/get': {
    method: 'map/agents/get',
    category: 'observation',
    capabilities: ['observation.canQuery'],
    description: 'Get agent by ID with optional hierarchy',
  },
  'scopes/list': {
    method: 'map/scopes/list',
    category: 'observation',
    capabilities: ['observation.canQuery'],
    description: 'List all scopes',
  },
  'scopes/get': {
    method: 'map/scopes/get',
    category: 'observation',
    capabilities: ['observation.canQuery'],
    description: 'Get scope by ID',
  },
  'scopes/members': {
    method: 'map/scopes/members',
    category: 'observation',
    capabilities: ['observation.canQuery'],
    description: 'List scope members',
  },
  'structure/graph': {
    method: 'map/structure/graph',
    category: 'observation',
    capabilities: ['observation.canQuery'],
    description: 'Get agent hierarchy graph',
  },

  // Lifecycle methods
  'agents/register': {
    method: 'map/agents/register',
    category: 'lifecycle',
    capabilities: ['lifecycle.canRegister'],
    description: 'Register a new agent',
  },
  'agents/unregister': {
    method: 'map/agents/unregister',
    category: 'lifecycle',
    capabilities: ['lifecycle.canUnregister'],
    description: 'Unregister an agent',
  },
  'agents/spawn': {
    method: 'map/agents/spawn',
    category: 'lifecycle',
    capabilities: ['lifecycle.canSpawn'],
    description: 'Spawn a child agent',
  },

  // State methods
  'agents/update': {
    method: 'map/agents/update',
    category: 'state',
    capabilities: ['lifecycle.canRegister'],
    description: 'Update agent state or metadata',
  },
  'agents/suspend': {
    method: 'map/agents/suspend',
    category: 'state',
    capabilities: ['lifecycle.canStop'],
    description: 'Suspend an agent',
  },
  'agents/resume': {
    method: 'map/agents/resume',
    category: 'state',
    capabilities: ['lifecycle.canStop'],
    description: 'Resume a suspended agent',
  },
  'agents/stop': {
    method: 'map/agents/stop',
    category: 'state',
    capabilities: ['lifecycle.canStop'],
    description: 'Stop an agent',
  },

  // Steering methods
  'inject': {
    method: 'map/inject',
    category: 'steering',
    capabilities: ['lifecycle.canSteer'],
    description: 'Inject context into an agent',
  },

  // Scope methods
  'scopes/create': {
    method: 'map/scopes/create',
    category: 'scope',
    capabilities: ['scopes.canCreateScopes'],
    description: 'Create a new scope',
  },
  'scopes/delete': {
    method: 'map/scopes/delete',
    category: 'scope',
    capabilities: ['scopes.canManageScopes'],
    description: 'Delete a scope',
  },
  'scopes/join': {
    method: 'map/scopes/join',
    category: 'scope',
    capabilities: [],
    description: 'Join a scope',
  },
  'scopes/leave': {
    method: 'map/scopes/leave',
    category: 'scope',
    capabilities: [],
    description: 'Leave a scope',
  },

  // Session methods
  'session/list': {
    method: 'map/session/list',
    category: 'session',
    capabilities: [],
    description: 'List sessions',
  },
  'session/load': {
    method: 'map/session/load',
    category: 'session',
    capabilities: [],
    description: 'Load a session',
  },
  'session/close': {
    method: 'map/session/close',
    category: 'session',
    capabilities: [],
    description: 'Close a session',
  },

  // Auth methods
  'auth/refresh': {
    method: 'map/auth/refresh',
    category: 'auth',
    capabilities: [],
    description: 'Refresh authentication token',
  },

  // Federation methods
  'federation/connect': {
    method: 'map/federation/connect',
    category: 'federation',
    capabilities: ['federation.canFederate'],
    description: 'Connect to federated system',
  },
  'federation/route': {
    method: 'map/federation/route',
    category: 'federation',
    capabilities: ['federation.canFederate'],
    description: 'Route message to federated system',
  },
} as const;

/**
 * Get methods by category
 */
export function getMethodsByCategory(category: MethodCategory): MethodInfo[] {
  return Object.values(METHOD_REGISTRY).filter((m) => m.category === category);
}

/**
 * Get required capabilities for a method
 */
export function getRequiredCapabilities(methodName: string): CapabilityPath[] {
  // Try direct lookup first
  const info = METHOD_REGISTRY[methodName];
  if (info) return info.capabilities;

  // Try finding by wire method name
  const byWire = Object.values(METHOD_REGISTRY).find((m) => m.method === methodName);
  return byWire?.capabilities ?? [];
}

/**
 * Check if capabilities satisfy method requirements
 */
export function hasRequiredCapabilities(
  methodName: string,
  capabilities: ParticipantCapabilities
): boolean {
  const required = getRequiredCapabilities(methodName);
  if (required.length === 0) return true;

  for (const path of required) {
    const [category, capability] = path.split('.') as [keyof ParticipantCapabilities, string];
    const categoryCapabilities = capabilities[category] as Record<string, boolean> | undefined;
    if (!categoryCapabilities?.[capability]) {
      return false;
    }
  }
  return true;
}

/**
 * Get method info by wire method name (e.g., 'map/agents/list')
 */
export function getMethodInfo(wireMethod: string): MethodInfo | undefined {
  return Object.values(METHOD_REGISTRY).find((m) => m.method === wireMethod);
}

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Build connect response
 */
export function buildConnectResponse(params: {
  protocolVersion: ProtocolVersion;
  sessionId: SessionId;
  participantId: ParticipantId;
  capabilities: ParticipantCapabilities;
  systemInfo?: { name?: string; version?: string };
  reconnected?: boolean;
  reclaimedAgents?: Agent[];
  ownedAgents?: string[];
}): ConnectResponseResult {
  return {
    protocolVersion: params.protocolVersion,
    sessionId: params.sessionId,
    participantId: params.participantId,
    capabilities: params.capabilities,
    systemInfo: params.systemInfo,
    reconnected: params.reconnected,
    reclaimedAgents: params.reclaimedAgents,
    ownedAgents: params.ownedAgents,
  };
}

/**
 * Build disconnect response
 */
export function buildDisconnectResponse(session: SessionInfo): DisconnectResponseResult {
  return { session };
}

/**
 * Build send response
 */
export function buildSendResponse(
  messageId: MessageId,
  delivered: ParticipantId[]
): SendResponseResult {
  return { messageId, delivered };
}

/**
 * Build agents/register response
 */
export function buildAgentsRegisterResponse(agent: Agent): AgentsRegisterResponseResult {
  return { agent };
}

/**
 * Build agents/unregister response
 */
export function buildAgentsUnregisterResponse(agent: Agent): AgentsUnregisterResponseResult {
  return { agent };
}

/**
 * Build agents/list response
 */
export function buildAgentsListResponse(agents: Agent[]): AgentsListResponseResult {
  return { agents };
}

/**
 * Build agents/get response
 */
export function buildAgentsGetResponse(
  agent: Agent,
  children?: Agent[],
  descendants?: Agent[]
): AgentsGetResponseResult {
  const result: AgentsGetResponseResult = { agent };
  if (children) result.children = children;
  if (descendants) result.descendants = descendants;
  return result;
}

/**
 * Build agents/update response
 */
export function buildAgentsUpdateResponse(agent: Agent): AgentsUpdateResponseResult {
  return { agent };
}

/**
 * Build agents/spawn response
 */
export function buildAgentsSpawnResponse(agent: Agent): AgentsSpawnResponseResult {
  return { agent };
}

/**
 * Build scopes/create response
 */
export function buildScopesCreateResponse(scope: Scope): ScopesCreateResponseResult {
  return { scope };
}

/**
 * Build scopes/list response
 */
export function buildScopesListResponse(scopes: Scope[]): ScopesListResponseResult {
  return { scopes };
}

/**
 * Build scopes/join response
 */
export function buildScopesJoinResponse(scope: Scope, agent: Agent): ScopesJoinResponseResult {
  return { scope, agent };
}

/**
 * Build scopes/leave response
 */
export function buildScopesLeaveResponse(scope: Scope, agent: Agent): ScopesLeaveResponseResult {
  return { scope, agent };
}

/**
 * Build subscribe response
 */
export function buildSubscribeResponse(subscriptionId: SubscriptionId): SubscribeResponseResult {
  return { subscriptionId };
}

/**
 * Build unsubscribe response
 */
export function buildUnsubscribeResponse(
  subscriptionId: SubscriptionId,
  closedAt: number = Date.now()
): UnsubscribeResponseResult {
  return {
    subscription: {
      id: subscriptionId,
      closedAt,
    },
  };
}
