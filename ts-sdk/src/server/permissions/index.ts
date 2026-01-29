/**
 * Permission system - PermissionChecker and middleware
 */

// Re-export types
export type {
  PermissionResult,
  PermissionChecker,
  PermissionRule,
  PermissionCheckerOptions,
} from "../types";

// Implementations
export {
  PermissionCheckerImpl,
  createDefaultPermissionChecker,
} from "./checker";

// Middleware
export {
  permissionMiddleware,
  permissionLoggingMiddleware,
  selectivePermissionMiddleware,
  PermissionDeniedError,
} from "./middleware";
