/**
 * Permission middleware for RouterConnection
 *
 * Integrates PermissionChecker with the middleware chain.
 */

import type { PermissionChecker, Middleware } from "../types";

/**
 * JSON-RPC error codes for permission errors.
 */
const PERMISSION_ERRORS = {
  FORBIDDEN: -32000,
  UNAUTHORIZED: -32001,
};

/**
 * Permission denied error.
 */
export class PermissionDeniedError extends Error {
  readonly code: number;

  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
    this.code = PERMISSION_ERRORS.FORBIDDEN;
  }
}

/**
 * Create a permission middleware that checks method access.
 *
 * @param checker - The PermissionChecker to use for access control
 * @returns Middleware function that denies unauthorized access
 */
export function permissionMiddleware(checker: PermissionChecker): Middleware {
  return async (method, _params, ctx, next) => {
    const result = checker.canCallMethod(ctx.session, method);

    if (!result.allowed) {
      throw new PermissionDeniedError(
        result.reason ?? `Permission denied for method: ${method}`
      );
    }

    return next();
  };
}

/**
 * Create a middleware that logs permission checks.
 *
 * @param checker - The PermissionChecker to use
 * @param logger - Optional logger (defaults to console)
 */
export function permissionLoggingMiddleware(
  checker: PermissionChecker,
  logger: Pick<Console, "log" | "warn"> = console
): Middleware {
  return async (method, _params, ctx, next) => {
    const result = checker.canCallMethod(ctx.session, method);

    if (result.allowed) {
      logger.log(
        `[PERMISSION] Allowed: ${ctx.session.role} -> ${method}`
      );
    } else {
      logger.warn(
        `[PERMISSION] Denied: ${ctx.session.role} -> ${method}: ${result.reason}`
      );
      throw new PermissionDeniedError(
        result.reason ?? `Permission denied for method: ${method}`
      );
    }

    return next();
  };
}

/**
 * Create a middleware that only checks specific methods.
 *
 * @param checker - The PermissionChecker to use
 * @param methodPatterns - Glob patterns for methods to check
 */
export function selectivePermissionMiddleware(
  checker: PermissionChecker,
  methodPatterns: string[]
): Middleware {
  return async (method, _params, ctx, next) => {
    // Check if method matches any pattern
    const shouldCheck = methodPatterns.some((pattern) => {
      // Simple glob matching
      const regex = new RegExp(
        "^" +
          pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, ".*")
            .replace(/\*/g, "[^/]*") +
          "$"
      );
      return regex.test(method);
    });

    if (!shouldCheck) {
      // Skip permission check for non-matching methods
      return next();
    }

    const result = checker.canCallMethod(ctx.session, method);

    if (!result.allowed) {
      throw new PermissionDeniedError(
        result.reason ?? `Permission denied for method: ${method}`
      );
    }

    return next();
  };
}
