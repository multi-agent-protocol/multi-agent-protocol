/**
 * Validation middleware using Zod schemas
 *
 * Provides runtime validation of request parameters before handlers execute.
 * Returns standardized INVALID_PARAMS errors with detailed error information.
 */

import { z, type ZodSchema, type ZodError } from "zod";
import type { Middleware } from "../types";
import { MAPRequestError } from "../../errors";

// ===========================================================================
// Request Parameter Schemas
// ===========================================================================

/**
 * Schema for map/agents/register
 */
export const AgentsRegisterParamsSchema = z
  .object({
    name: z.string().min(1, "Agent name is required"),
    role: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Schema for map/agents/unregister
 */
export const AgentsUnregisterParamsSchema = z
  .object({
    agentId: z.string().min(1, "Agent ID is required"),
  })
  .strict();

/**
 * Schema for map/agents/get
 */
export const AgentsGetParamsSchema = z
  .object({
    agentId: z.string().min(1, "Agent ID is required"),
  })
  .strict();

/**
 * Schema for map/agents/list
 */
export const AgentsListParamsSchema = z
  .object({
    state: z
      .union([
        z.enum(["idle", "busy", "suspended", "stopped"]),
        z.string().startsWith("custom:"),
      ])
      .optional(),
    role: z.string().optional(),
    sessionId: z.string().optional(),
    scopeId: z.string().optional(),
    capability: z.string().optional(),
  })
  .strict();

/**
 * Schema for map/agents/update
 */
export const AgentsUpdateParamsSchema = z
  .object({
    agentId: z.string().min(1, "Agent ID is required"),
    state: z
      .union([
        z.enum(["idle", "busy", "suspended", "stopped"]),
        z.string().startsWith("custom:"),
      ])
      .optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((data) => data.state !== undefined || data.metadata !== undefined, {
    message: "At least one of 'state' or 'metadata' is required",
  });

/**
 * Schema for map/agents/update/state
 */
export const AgentsUpdateStateParamsSchema = z
  .object({
    agentId: z.string().min(1, "Agent ID is required"),
    state: z.union([
      z.enum(["idle", "busy", "suspended", "stopped"]),
      z.string().startsWith("custom:"),
    ]),
  })
  .strict();

/**
 * Schema for map/agents/update/metadata
 */
export const AgentsUpdateMetadataParamsSchema = z
  .object({
    agentId: z.string().min(1, "Agent ID is required"),
    metadata: z.record(z.unknown()),
  })
  .strict();

/**
 * Schema for map/scopes/create
 */
export const ScopesCreateParamsSchema = z
  .object({
    name: z.string().min(1, "Scope name is required"),
    metadata: z.record(z.unknown()).optional(),
    parentId: z.string().optional(),
  })
  .strict();

/**
 * Schema for map/scopes/delete
 */
export const ScopesDeleteParamsSchema = z
  .object({
    scopeId: z.string().min(1, "Scope ID is required"),
    deleteDescendants: z.boolean().optional(),
  })
  .strict();

/**
 * Schema for map/scopes/get
 */
export const ScopesGetParamsSchema = z
  .object({
    scopeId: z.string().min(1, "Scope ID is required"),
  })
  .strict();

/**
 * Schema for map/scopes/list
 */
export const ScopesListParamsSchema = z
  .object({
    parentId: z.string().nullable().optional(),
    ancestorId: z.string().optional(),
  })
  .strict();

/**
 * Schema for map/scopes/join
 */
export const ScopesJoinParamsSchema = z
  .object({
    scopeId: z.string().min(1, "Scope ID is required"),
    agentId: z.string().min(1, "Agent ID is required"),
  })
  .strict();

/**
 * Schema for map/scopes/leave
 */
export const ScopesLeaveParamsSchema = z
  .object({
    scopeId: z.string().min(1, "Scope ID is required"),
    agentId: z.string().min(1, "Agent ID is required"),
  })
  .strict();

/**
 * Schema for map/scopes/members
 */
export const ScopesMembersParamsSchema = z
  .object({
    scopeId: z.string().min(1, "Scope ID is required"),
    includeDescendants: z.boolean().optional(),
  })
  .strict();

/**
 * Recursive schema for subscription filter (supports $or/$and)
 */
const baseSubscriptionFilterSchema = z.object({
  eventTypes: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  fromAgents: z.array(z.string()).optional(),
  includeChildren: z.boolean().optional(),
  match: z.enum(["any", "all"]).optional(),
  messageTypes: z.array(z.string()).optional(),
});

// Use lazy for recursive types
export const SubscriptionFilterParamsSchema: z.ZodType<{
  eventTypes?: string[];
  scopes?: string[];
  fromAgents?: string[];
  includeChildren?: boolean;
  match?: "any" | "all";
  messageTypes?: string[];
  $or?: unknown[];
  $and?: unknown[];
}> = baseSubscriptionFilterSchema.extend({
  $or: z.lazy(() => z.array(SubscriptionFilterParamsSchema)).optional(),
  $and: z.lazy(() => z.array(SubscriptionFilterParamsSchema)).optional(),
});

/**
 * Schema for map/subscriptions/subscribe
 */
export const SubscribeParamsSchema = z
  .object({
    filter: SubscriptionFilterParamsSchema,
    startAfter: z.string().optional(),
  })
  .strict();

/**
 * Schema for map/subscriptions/unsubscribe
 */
export const UnsubscribeParamsSchema = z
  .object({
    subscriptionId: z.string().min(1, "Subscription ID is required"),
  })
  .strict();

/**
 * Schema for map/subscriptions/pause
 */
export const SubscriptionsPauseParamsSchema = z
  .object({
    subscriptionId: z.string().min(1, "Subscription ID is required"),
  })
  .strict();

/**
 * Schema for map/subscriptions/resume
 */
export const SubscriptionsResumeParamsSchema = z
  .object({
    subscriptionId: z.string().min(1, "Subscription ID is required"),
  })
  .strict();

/**
 * Schema for map/send
 */
export const SendParamsSchema = z
  .object({
    to: z.union([z.string(), z.array(z.string()).min(1)]),
    payload: z.unknown(),
    replyTo: z.string().optional(),
    priority: z.number().int().optional(),
    ttlMs: z.number().int().positive().optional(),
    messageType: z.string().optional(),
  })
  .strict();

/**
 * Schema for map/connect
 */
export const ConnectParamsSchema = z
  .object({
    role: z.enum(["client", "agent", "gateway"]).optional(),
    name: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    resumeToken: z.string().optional(),
    auth: z
      .object({
        method: z.enum(["bearer", "api-key", "mtls", "none"]),
        credential: z.string().optional(),
      })
      .optional(),
  })
  .strict();

/**
 * Schema for map/authenticate
 */
export const AuthenticateParamsSchema = z
  .object({
    method: z.enum(["bearer", "api-key", "mtls", "none"]),
    credential: z.string().optional(),
  })
  .strict();

/**
 * Schema for map/session/list - no params required
 */
export const SessionListParamsSchema = z.object({}).strict().optional();

/**
 * Schema for map/session/load
 */
export const SessionLoadParamsSchema = z
  .object({
    sessionId: z.string().min(1, "Session ID is required"),
  })
  .strict();

/**
 * Schema for map/session/close
 */
export const SessionCloseParamsSchema = z
  .object({
    sessionId: z.string().min(1, "Session ID is required"),
  })
  .strict();

/**
 * Schema for map/inject (testing)
 */
export const InjectParamsSchema = z
  .object({
    type: z.string().min(1, "Event type is required"),
    data: z.unknown(),
    source: z
      .object({
        agentId: z.string().optional(),
        scopeId: z.string().optional(),
        sessionId: z.string().optional(),
      })
      .optional(),
    causedBy: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

// ===========================================================================
// Method to Schema Mapping
// ===========================================================================

/**
 * Default schema mapping for all standard MAP methods.
 */
export const DEFAULT_VALIDATION_SCHEMAS: Record<string, ZodSchema> = {
  // Agent methods
  "map/agents/register": AgentsRegisterParamsSchema,
  "map/agents/unregister": AgentsUnregisterParamsSchema,
  "map/agents/get": AgentsGetParamsSchema,
  "map/agents/list": AgentsListParamsSchema,
  "map/agents/update": AgentsUpdateParamsSchema,
  "map/agents/update/state": AgentsUpdateStateParamsSchema,
  "map/agents/update/metadata": AgentsUpdateMetadataParamsSchema,

  // Scope methods
  "map/scopes/create": ScopesCreateParamsSchema,
  "map/scopes/delete": ScopesDeleteParamsSchema,
  "map/scopes/get": ScopesGetParamsSchema,
  "map/scopes/list": ScopesListParamsSchema,
  "map/scopes/join": ScopesJoinParamsSchema,
  "map/scopes/leave": ScopesLeaveParamsSchema,
  "map/scopes/members": ScopesMembersParamsSchema,

  // Subscription methods
  "map/subscriptions/subscribe": SubscribeParamsSchema,
  "map/subscriptions/unsubscribe": UnsubscribeParamsSchema,
  "map/subscriptions/pause": SubscriptionsPauseParamsSchema,
  "map/subscriptions/resume": SubscriptionsResumeParamsSchema,

  // Messaging methods
  "map/send": SendParamsSchema,

  // Connection methods
  "map/connect": ConnectParamsSchema,
  "map/authenticate": AuthenticateParamsSchema,

  // Session methods
  "map/session/list": SessionListParamsSchema,
  "map/session/load": SessionLoadParamsSchema,
  "map/session/close": SessionCloseParamsSchema,

  // Testing methods
  "map/inject": InjectParamsSchema,
};

// ===========================================================================
// Error Formatting
// ===========================================================================

/**
 * Format Zod errors into a readable details object.
 */
function formatZodError(error: ZodError): Record<string, unknown> {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
    code: issue.code,
  }));

  return {
    issues,
    // Provide a summary message
    summary: issues.map((i) => `${i.path}: ${i.message}`).join("; "),
  };
}

// ===========================================================================
// Middleware Factory
// ===========================================================================

/**
 * Options for the Zod validation middleware.
 */
export interface ZodValidationMiddlewareOptions {
  /**
   * Schema mapping for methods. Defaults to DEFAULT_VALIDATION_SCHEMAS.
   */
  schemas?: Record<string, ZodSchema>;

  /**
   * Methods to skip validation for (e.g., custom methods).
   */
  skipMethods?: string[];

  /**
   * If true, throws for methods with no schema defined.
   * If false (default), allows methods without schemas to pass.
   */
  strictMode?: boolean;

  /**
   * Custom error callback for logging/monitoring.
   */
  onValidationError?: (
    method: string,
    params: unknown,
    error: ZodError
  ) => void;
}

/**
 * Create a validation middleware using Zod schemas.
 *
 * This middleware validates request parameters before handlers execute,
 * returning standardized INVALID_PARAMS errors with detailed error information.
 *
 * @example
 * ```typescript
 * import { zodValidationMiddleware, DEFAULT_VALIDATION_SCHEMAS } from './middleware/validation';
 *
 * const middleware = zodValidationMiddleware({
 *   schemas: {
 *     ...DEFAULT_VALIDATION_SCHEMAS,
 *     'custom/method': myCustomSchema,
 *   },
 * });
 * ```
 */
export function zodValidationMiddleware(
  options: ZodValidationMiddlewareOptions = {}
): Middleware {
  const {
    schemas = DEFAULT_VALIDATION_SCHEMAS,
    skipMethods = [],
    strictMode = false,
    onValidationError,
  } = options;

  const skipSet = new Set(skipMethods);

  return async (method, params, _ctx, next) => {
    // Skip validation for specified methods
    if (skipSet.has(method)) {
      return next();
    }

    const schema = schemas[method];

    // No schema for this method
    if (!schema) {
      if (strictMode) {
        throw MAPRequestError.invalidParams({
          error: `No validation schema defined for method: ${method}`,
        });
      }
      return next();
    }

    // Validate params
    const result = schema.safeParse(params ?? {});

    if (!result.success) {
      // Call error callback if provided
      onValidationError?.(method, params, result.error);

      // Throw INVALID_PARAMS error with detailed information
      throw MAPRequestError.invalidParams(formatZodError(result.error));
    }

    return next();
  };
}

// ===========================================================================
// Re-export from router/middleware for convenience
// ===========================================================================

export {
  loggingMiddleware,
  timingMiddleware,
  rateLimitMiddleware,
  timeoutMiddleware,
  composeMiddleware,
} from "../router/middleware";
