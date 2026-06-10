/**
 * Built-in middleware helpers for RouterConnection
 */

import type { Middleware, HandlerContext } from "../types";

/**
 * Create a logging middleware.
 *
 * @param logger - Optional custom logger (defaults to console)
 */
export function loggingMiddleware(
  logger: Pick<Console, "log" | "error"> = console
): Middleware {
  return async (method, params, ctx, next) => {
    const start = Date.now();

    logger.log(
      `[${ctx.requestId}] -> ${method}`,
      params ? JSON.stringify(params).slice(0, 200) : ""
    );

    try {
      const result = await next();
      const duration = Date.now() - start;

      logger.log(`[${ctx.requestId}] <- ${method} OK (${duration}ms)`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;

      logger.error(
        `[${ctx.requestId}] <- ${method} ERROR (${duration}ms):`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  };
}

/**
 * Create a timing middleware that adds timing metadata.
 *
 * @param onTiming - Callback with timing data
 */
export function timingMiddleware(
  onTiming?: (data: { method: string; durationMs: number; requestId: string }) => void
): Middleware {
  return async (method, _params, ctx, next) => {
    const start = Date.now();

    try {
      return await next();
    } finally {
      const durationMs = Date.now() - start;
      onTiming?.({ method, durationMs, requestId: ctx.requestId });
    }
  };
}

/**
 * Create a rate limiting middleware.
 *
 * @param options - Rate limit configuration
 */
export function rateLimitMiddleware(options: {
  maxRequestsPerSecond: number;
  onLimitExceeded?: (ctx: HandlerContext) => void;
}): Middleware {
  const requestCounts = new Map<string, { count: number; resetAt: number }>();

  return async (_method, _params, ctx, next) => {
    const sessionId = ctx.session.id;
    const now = Date.now();

    let entry = requestCounts.get(sessionId);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + 1000 };
      requestCounts.set(sessionId, entry);
    }

    entry.count++;

    if (entry.count > options.maxRequestsPerSecond) {
      options.onLimitExceeded?.(ctx);
      throw new Error("Rate limit exceeded");
    }

    return next();
  };
}

/**
 * Create a validation middleware using a schema validator.
 *
 * @param validators - Map of method name to validator function
 */
export function validationMiddleware(
  validators: Record<string, (params: unknown) => { valid: boolean; error?: string }>
): Middleware {
  return async (method, params, _ctx, next) => {
    const validator = validators[method];
    if (validator) {
      const result = validator(params);
      if (!result.valid) {
        throw new Error(`Invalid params: ${result.error ?? "validation failed"}`);
      }
    }
    return next();
  };
}

/**
 * Create a timeout middleware.
 *
 * @param timeoutMs - Timeout in milliseconds
 */
export function timeoutMiddleware(timeoutMs: number): Middleware {
  return async (_method, _params, ctx, next) => {
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Clean up timer if request completes
      ctx.signal.addEventListener("abort", () => clearTimeout(timer));
    });

    return Promise.race([next(), timeoutPromise]);
  };
}

/**
 * Compose multiple middleware into one.
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware {
  return async (method, params, ctx, next) => {
    let index = 0;

    const composed = async (): Promise<unknown> => {
      if (index < middlewares.length) {
        const mw = middlewares[index++];
        return mw(method, params, ctx, composed);
      }
      return next();
    };

    return composed();
  };
}
