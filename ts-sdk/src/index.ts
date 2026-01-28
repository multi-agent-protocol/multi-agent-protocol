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
  ClientConnection,
  type ClientConnectionOptions,
  AgentConnection,
  type AgentConnectionOptions,
  type MessageHandler,
  GatewayConnection,
  type GatewayConnectionOptions,
} from './connection';

// ===========================================================================
// Router - Router interface (implementation not included)
// ===========================================================================
export {
  type ConnectedParticipant,
  type MAPRouterConfig,
  type MAPRouter,
  type MAPRouterFactory,
} from './router';

// ===========================================================================
// Schema - Zod validators (optional, requires zod peer dependency)
// ===========================================================================
export * from './schema';
