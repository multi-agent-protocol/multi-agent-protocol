/**
 * Scope handler factories
 *
 * Creates JSON-RPC handlers for scope-related methods.
 */

import type {
  ScopeManager,
  HandlerContext,
  HandlerRegistry,
  ScopeFilter,
} from "../types";

/**
 * Options for creating scope handlers.
 */
export interface ScopeHandlerOptions {
  scopes: ScopeManager;
}

/**
 * Parameters for scope creation.
 */
interface CreateParams {
  name: string;
  metadata?: Record<string, unknown>;
  parentId?: string;
}

/**
 * Parameters for scope deletion.
 */
interface DeleteParams {
  scopeId: string;
  deleteDescendants?: boolean;
}

/**
 * Parameters for getting a scope.
 */
interface GetParams {
  scopeId: string;
}

/**
 * Parameters for joining a scope.
 */
interface JoinParams {
  scopeId: string;
  agentId: string;
}

/**
 * Parameters for leaving a scope.
 */
interface LeaveParams {
  scopeId: string;
  agentId: string;
}

/**
 * Parameters for getting scope members.
 */
interface GetMembersParams {
  scopeId: string;
  includeDescendants?: boolean;
}

/**
 * Create handlers for scope-related methods.
 *
 * Methods:
 * - `map/scopes/create` - Create a new scope
 * - `map/scopes/delete` - Delete a scope
 * - `map/scopes/list` - List scopes with optional filters
 * - `map/scopes/get` - Get a specific scope
 * - `map/scopes/join` - Add an agent to a scope
 * - `map/scopes/leave` - Remove an agent from a scope
 * - `map/scopes/members` - Get members of a scope
 */
export function createScopeHandlers(options: ScopeHandlerOptions): HandlerRegistry {
  const { scopes } = options;

  return {
    "map/scopes/create": async (params: unknown, ctx: HandlerContext) => {
      const { name, metadata, parentId } = params as CreateParams;

      return scopes.create({
        name,
        metadata,
        parentId,
        createdBy: ctx.session.id,
      });
    },

    "map/scopes/delete": async (params: unknown) => {
      const { scopeId, deleteDescendants } = params as DeleteParams;

      const success = scopes.delete(scopeId, { deleteDescendants });
      if (!success) {
        throw new Error(`Scope not found: ${scopeId}`);
      }

      return { success: true };
    },

    "map/scopes/list": async (params: unknown) => {
      const filter = params as ScopeFilter;
      return scopes.list(filter);
    },

    "map/scopes/get": async (params: unknown) => {
      const { scopeId } = params as GetParams;
      const scope = scopes.get(scopeId);

      if (!scope) {
        throw new Error(`Scope not found: ${scopeId}`);
      }

      return scope;
    },

    "map/scopes/join": async (params: unknown) => {
      const { scopeId, agentId } = params as JoinParams;
      scopes.join(scopeId, agentId);
      return { success: true };
    },

    "map/scopes/leave": async (params: unknown) => {
      const { scopeId, agentId } = params as LeaveParams;
      scopes.leave(scopeId, agentId);
      return { success: true };
    },

    "map/scopes/members": async (params: unknown) => {
      const { scopeId, includeDescendants } = params as GetMembersParams;
      return scopes.getMembers(scopeId, { includeDescendants });
    },
  };
}
