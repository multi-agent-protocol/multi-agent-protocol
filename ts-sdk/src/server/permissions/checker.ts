/**
 * PermissionChecker implementation
 *
 * Provides method-level and resource-level permission checking.
 */

import type {
  PermissionResult,
  PermissionChecker,
  PermissionRule,
  PermissionCheckerOptions,
  ServerSession,
} from "../types";

/**
 * Simple glob pattern matching.
 * Supports * for single segment and ** for multiple segments.
 */
function matchesGlob(pattern: string, value: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars except * and /
    .replace(/\*\*/g, "<<DOUBLE_STAR>>") // Placeholder for **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/<<DOUBLE_STAR>>/g, ".*"); // ** matches anything including /

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(value);
}

/**
 * PermissionChecker implementation.
 *
 * Supports:
 * - Method-level access control with glob patterns
 * - Role-based access
 * - Custom check functions
 * - Scope-level permissions
 * - Agent-to-agent permissions
 */
export class PermissionCheckerImpl implements PermissionChecker {
  private readonly rules: PermissionRule[];
  private readonly defaultAllow: boolean;

  constructor(options: PermissionCheckerOptions) {
    this.rules = options.rules;
    this.defaultAllow = options.defaultAllow ?? false;
  }

  /**
   * Check if a session can call a specific method.
   */
  canCallMethod(session: ServerSession, method: string): PermissionResult {
    // Find matching rules
    const matchingRules = this.rules.filter((rule) => {
      if (!rule.method) return false;
      return matchesGlob(rule.method, method);
    });

    // No matching rules - use default
    if (matchingRules.length === 0) {
      return {
        allowed: this.defaultAllow,
        reason: this.defaultAllow
          ? undefined
          : `No permission rule for ${method}`,
      };
    }

    // Check each matching rule
    for (const rule of matchingRules) {
      // Check role requirement
      if (rule.roles && rule.roles.length > 0) {
        if (!rule.roles.includes(session.role)) {
          continue; // Role doesn't match, try next rule
        }
      }

      // Check custom function
      if (rule.check) {
        const result = rule.check(session, undefined);
        if (result.allowed) {
          return result;
        }
        // Custom check denied, continue to next rule
        continue;
      }

      // Rule matches and no custom check - allow
      return { allowed: true };
    }

    // No rule allowed access
    return {
      allowed: false,
      reason: `Access denied for role '${session.role}' to method '${method}'`,
    };
  }

  /**
   * Check if a session can access a scope with a specific action.
   */
  canAccessScope(
    session: ServerSession,
    scopeId: string,
    action: string,
  ): PermissionResult {
    // Build a virtual method name for scope access
    const virtualMethod = `scope/${scopeId}/${action}`;

    // Find rules that match scope access patterns
    const matchingRules = this.rules.filter((rule) => {
      if (!rule.method) return false;
      // Match patterns like "scope/*", "scope/**", or specific scope IDs
      return matchesGlob(rule.method, virtualMethod);
    });

    if (matchingRules.length === 0) {
      return {
        allowed: this.defaultAllow,
        reason: this.defaultAllow
          ? undefined
          : `No permission rule for scope access: ${scopeId}/${action}`,
      };
    }

    for (const rule of matchingRules) {
      if (rule.roles && rule.roles.length > 0) {
        if (!rule.roles.includes(session.role)) {
          continue;
        }
      }

      if (rule.check) {
        const result = rule.check(session, { scopeId, action });
        if (result.allowed) {
          return result;
        }
        continue;
      }

      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Access denied for role '${session.role}' to scope '${scopeId}' action '${action}'`,
    };
  }

  /**
   * Check if an agent can perform an action on a target.
   */
  canAgentPerform(
    agentId: string,
    action: string,
    targetId: string,
  ): PermissionResult {
    // Build a virtual method name for agent-to-agent actions
    const virtualMethod = `agent/${action}`;

    // Find rules that match agent action patterns
    const matchingRules = this.rules.filter((rule) => {
      if (!rule.method) return false;
      return matchesGlob(rule.method, virtualMethod);
    });

    if (matchingRules.length === 0) {
      return {
        allowed: this.defaultAllow,
        reason: this.defaultAllow
          ? undefined
          : `No permission rule for agent action: ${action}`,
      };
    }

    for (const rule of matchingRules) {
      // Agent rules don't have session, so skip role checks
      // Use custom check for fine-grained agent permissions
      if (rule.check) {
        // Pass agent context to custom check
        const mockSession = { agentId } as unknown as ServerSession;
        const result = rule.check(mockSession, { agentId, action, targetId });
        if (result.allowed) {
          return result;
        }
        continue;
      }

      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Agent '${agentId}' denied action '${action}' on '${targetId}'`,
    };
  }
}

/**
 * Baseline permission rules for MAP protocol methods.
 *
 * These rules define the recommended starting point for MAP server permissions:
 * - Connection methods: available to all roles
 * - Agent registration: only agents can register/unregister
 * - Agent observation: all roles can list/get agents
 * - Agent state changes: only agents can update their state
 * - Scope operations: all roles can manage scopes
 * - Messaging: all roles can send messages
 * - Subscriptions: all roles can subscribe to events
 *
 * Use these rules as a starting point and customize as needed.
 *
 * @example
 * ```typescript
 * import { BASELINE_PERMISSION_RULES, PermissionCheckerImpl } from "@multi-agent-protocol/sdk/server";
 *
 * const checker = new PermissionCheckerImpl({
 *   rules: [
 *     ...BASELINE_PERMISSION_RULES,
 *     // Add custom rules
 *     { method: "custom/*", roles: ["agent"] },
 *   ],
 * });
 * ```
 */
export const BASELINE_PERMISSION_RULES: PermissionRule[] = [
  // Connection methods - available to all
  { method: "map/connect", roles: ["client", "agent", "gateway"] },
  { method: "map/disconnect", roles: ["client", "agent", "gateway"] },
  { method: "map/session/*", roles: ["client", "agent", "gateway"] },

  // Agent registration - only agents can register
  { method: "map/agents/register", roles: ["agent"] },
  { method: "map/agents/unregister", roles: ["agent"] },

  // Agent observation - clients and agents can observe
  { method: "map/agents/list", roles: ["client", "agent", "gateway"] },
  { method: "map/agents/get", roles: ["client", "agent", "gateway"] },

  // Agent state changes - only the owning agent
  { method: "map/agents/update", roles: ["agent"] },
  { method: "map/agents/update/*", roles: ["agent"] },

  // Scope operations - all participants
  { method: "map/scopes/*", roles: ["client", "agent", "gateway"] },

  // Messaging - all participants
  { method: "map/send", roles: ["client", "agent", "gateway"] },
  { method: "map/send/*", roles: ["client", "agent", "gateway"] },

  // Subscriptions - all participants
  { method: "map/subscribe", roles: ["client", "agent", "gateway"] },
  { method: "map/unsubscribe", roles: ["client", "agent", "gateway"] },
  { method: "map/replay", roles: ["client", "agent", "gateway"] },
  { method: "map/ack", roles: ["client", "agent", "gateway"] },
  { method: "map/pause", roles: ["client", "agent", "gateway"] },
  { method: "map/resume", roles: ["client", "agent", "gateway"] },
];

/**
 * Create a PermissionChecker with baseline rules for MAP methods.
 *
 * @param overrides Optional overrides for rules or default behavior
 * @returns PermissionChecker instance with baseline + override rules
 */
export function createDefaultPermissionChecker(
  overrides?: Partial<PermissionCheckerOptions>,
): PermissionCheckerImpl {
  return new PermissionCheckerImpl({
    rules: [...BASELINE_PERMISSION_RULES, ...(overrides?.rules ?? [])],
    defaultAllow: overrides?.defaultAllow ?? false,
  });
}
