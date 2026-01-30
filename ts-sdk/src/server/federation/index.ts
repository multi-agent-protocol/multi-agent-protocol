/**
 * Federation system - Gateway and federated decorators
 */

// Re-export types
export type {
  PeerConnection,
  ServerFederationEnvelope,
  OutageBufferStats,
  OutageBuffer,
  PeerMessageHandler,
  FederationGateway,
  FederationGatewayOptions,
  FederatedAgentSyncOptions,
  FederatedScopeSyncOptions,
  FederatedAgentRegistryOptions,
  FederatedScopeManagerOptions,
  FederatedMessageRouterOptions,
} from "../types";

// Implementations
export {
  OutageBufferImpl,
  type OutageBufferOptions,
} from "./buffer";
export {
  FederationGatewayImpl,
  MaxHopsExceededError,
  RoutingLoopError,
  PeerNotFoundError,
  type PeerTransport,
} from "./gateway";

// Decorators
export {
  FederatedAgentRegistry,
  FederatedScopeManager,
  FederatedMessageRouter,
} from "./decorators";

// Handlers
export {
  createFederationHandlers,
  FederationError,
  FederationPermissionError,
  type FederationHandlerOptions,
} from "./handlers";

// Federated ID utilities
export {
  formatFederatedId,
  parseFederatedId,
  isFederatedId,
  isFederatedAgent,
  isFederatedScope,
  isFromSystem,
  extractEntityId,
  extractSystemId,
  InvalidFederatedIdError,
  type FederatedEntityType,
  type FederatedIdComponents,
} from "./federated-id";
