/**
 * Router system - RouterConnection and handler factories
 */

// Re-export types
export type {
  HandlerContext,
  Handler,
  HandlerRegistry,
  Middleware,
  RouterConnection,
  RouterConnectionOptions,
  MAPRouterInterface,
  BaseMAPRouterOptions,
} from "../types";

// Implementations
export { RouterConnectionImpl, createRouterConnection } from "./connection";

// Middleware
export {
  loggingMiddleware,
  timingMiddleware,
  rateLimitMiddleware,
  validationMiddleware,
  timeoutMiddleware,
  composeMiddleware,
} from "./middleware";

// Handler factories
export {
  createConnectionHandlers,
  combineHandlers,
  type ConnectionHandlerOptions,
  type MailCapabilityConfig,
} from "./handlers";

// Re-export workspace capability config for convenience
export type { WorkspaceCapabilityConfig } from "../workspace";

// MAPRouter OOP interface
export { routerToHandlers, getProtocolMethods, getInterfaceMethod } from "./adapter";
export { BaseMAPRouter, DefaultMAPRouter } from "./base-router";
