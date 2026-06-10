/**
 * Authentication middleware for RouterConnection
 *
 * Integrates AuthManager with the middleware chain.
 */

import type { Middleware } from '../types';
import type { AuthManager, AuthContext } from './types';

/**
 * JSON-RPC error codes for auth errors.
 */
export const AUTH_ERRORS = {
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
} as const;

/**
 * Authentication error.
 */
export class AuthenticationError extends Error {
  readonly code: number;
  readonly authErrorCode: string;

  constructor(message: string, authErrorCode: string = 'auth_required') {
    super(message);
    this.name = 'AuthenticationError';
    this.code = AUTH_ERRORS.UNAUTHORIZED;
    this.authErrorCode = authErrorCode;
  }
}

/**
 * Options for auth middleware.
 */
export interface AuthMiddlewareOptions {
  /**
   * Methods that don't require authentication.
   * By default, map/connect is allowed (it handles its own auth).
   */
  exemptMethods?: string[];

  /**
   * Extract auth context from handler context.
   * Override this if you have custom context with transport info.
   */
  getAuthContext?: (ctx: unknown) => AuthContext;
}

/**
 * Create an authentication middleware.
 *
 * This middleware checks if the session is authenticated before
 * allowing access to protected methods.
 *
 * @param authManager - The AuthManager to use for auth checks
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * const server = new MAPServer({
 *   middleware: [
 *     authMiddleware(authManager),
 *   ],
 * });
 * ```
 */
export function authMiddleware(
  authManager: AuthManager,
  options: AuthMiddlewareOptions = {}
): Middleware {
  const exemptMethods = new Set(options.exemptMethods ?? [
    'map/connect',
    'map/authenticate',
  ]);

  return async (method, _params, ctx, next) => {
    // Allow exempt methods
    if (exemptMethods.has(method)) {
      return next();
    }

    // Check if session has a principal (is authenticated)
    const session = ctx.session as {
      principal?: unknown;
      metadata?: { transportType?: string };
    } | undefined;

    if (!session?.principal) {
      // Auth required but session not authenticated
      if (authManager.config.required) {
        // Check if auth should be bypassed for this transport
        const authContext: AuthContext = options.getAuthContext
          ? options.getAuthContext(ctx)
          : { transportType: session?.metadata?.transportType };

        if (!authManager.shouldBypass(authContext)) {
          throw new AuthenticationError(
            'Authentication required',
            'auth_required'
          );
        }
      }
    }

    return next();
  };
}

/**
 * Create a middleware that logs authentication events.
 */
export function authLoggingMiddleware(
  logger: Pick<Console, 'log' | 'warn'> = console
): Middleware {
  return async (method, _params, ctx, next) => {
    const session = ctx.session as {
      id?: string;
      principal?: { id?: string };
    } | undefined;

    const principalId = session?.principal?.id ?? 'anonymous';
    const sessionId = session?.id ?? 'unknown';

    logger.log(`[AUTH] ${principalId} (${sessionId}) -> ${method}`);

    return next();
  };
}
