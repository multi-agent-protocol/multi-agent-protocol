/**
 * Multi-Agent Protocol (MAP) SDK
 *
 * A protocol for client connection and internal message routing in multi-agent systems.
 *
 * @module @anthropic/map-sdk
 */

// ===========================================================================
// Types - Protocol types and constants
// ===========================================================================
export * from './types';

// ===========================================================================
// Errors - Protocol error classes
// ===========================================================================
export {
  MAPRequestError,
  MAPConnectionError,
  MAPTimeoutError,
} from './errors';

// ===========================================================================
// Stream - Transport layer utilities
// ===========================================================================
export {
  type Stream,
  type AnyMessage,
  ndJsonStream,
  websocketStream,
  createStreamPair,
} from './stream';

// ===========================================================================
// JSON-RPC - Wire protocol utilities
// ===========================================================================
export {
  isRequest,
  isNotification,
  isResponse,
  isErrorResponse,
  createRequest,
  createNotification,
  createSuccessResponse,
  createErrorResponse,
} from './jsonrpc';

// ===========================================================================
// Subscription - Event subscription handling
// ===========================================================================
export { Subscription, createSubscription } from './subscription';

// ===========================================================================
// Connections - Role-specific connection classes
// ===========================================================================
export {
  BaseConnection,
  type BaseConnectionOptions,
  type RequestHandler,
  type NotificationHandler,
  type ConnectionState,
  type StateChangeHandler,
  ClientConnection,
  type ClientConnectionOptions,
  type ReconnectionOptions,
  type ReconnectionEventType,
  type ReconnectionEventHandler,
  AgentConnection,
  type AgentConnectionOptions,
  type MessageHandler,
  type AgentReconnectionOptions,
  type AgentReconnectionEventType,
  type AgentReconnectionEventHandler,
  GatewayConnection,
  type GatewayConnectionOptions,
} from './connection';

// ===========================================================================
// Router - Router interface (implementation not included)
// ===========================================================================
export {
  type ConnectedParticipant,
  type AgentExposure,
  type EventExposure,
  type ScopeExposure,
  type SystemExposure,
  type RouterLimits,
  type MAPRouterConfig,
  type MAPRouter,
  type MAPRouterFactory,
} from './router';

// ===========================================================================
// Schema - Zod validators (optional, requires zod peer dependency)
// ===========================================================================
export * from './schema';

// ===========================================================================
// Protocol - Method registry and response builders
// ===========================================================================
export {
  METHOD_REGISTRY,
  type MethodCategory,
  type CapabilityPath,
  type MethodInfo,
  getMethodsByCategory,
  getRequiredCapabilities,
  hasRequiredCapabilities,
  getMethodInfo,
  // Response builders
  buildConnectResponse,
  buildDisconnectResponse,
  buildSendResponse,
  buildAgentsRegisterResponse,
  buildAgentsUnregisterResponse,
  buildAgentsListResponse,
  buildAgentsGetResponse,
  buildAgentsUpdateResponse,
  buildAgentsSpawnResponse,
  buildScopesCreateResponse,
  buildScopesListResponse,
  buildScopesJoinResponse,
  buildScopesLeaveResponse,
  buildSubscribeResponse,
  buildUnsubscribeResponse,
} from './protocol';

// ===========================================================================
// Utils - Utility functions
// ===========================================================================
export {
  // ULID utilities
  ulid,
  monotonicFactory,
  ulidTimestamp,
  compareUlid,
  isValidUlid,
  // Retry utilities
  type RetryPolicy,
  type RetryState,
  type RetryCallbacks,
  DEFAULT_RETRY_POLICY,
  calculateDelay,
  withRetry,
  retryable,
  createRetryPolicy,
  sleep,
  // Causal ordering utilities
  CausalEventBuffer,
  type CausalEvent,
  type CausalEventBufferOptions,
  type CausalBufferPushResult,
  validateCausalOrder,
  sortCausalOrder,
} from './utils';

// ===========================================================================
// Permissions - Permission utilities for 4-layer model
// ===========================================================================
export {
  // Types (SystemExposure is exported from router module)
  type PermissionSystemConfig,
  type PermissionParticipant,
  type PermissionContext,
  type PermissionAction,
  type PermissionResult,
  // Layer 1: System exposure
  isAgentExposed,
  isEventTypeExposed,
  isScopeExposed,
  // Layer 2: Capabilities
  hasCapability,
  canPerformMethod,
  // Layer 3: Scope permissions
  canSeeScope,
  canSendToScope,
  canJoinScope,
  // Layer 4: Agent permissions
  canSeeAgent,
  canMessageAgent,
  canControlAgent,
  // High-level resolution
  canPerformAction,
  // Filtering utilities
  filterVisibleAgents,
  filterVisibleScopes,
  filterVisibleEvents,
} from './permissions';
