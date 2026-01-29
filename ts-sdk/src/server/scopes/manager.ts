/**
 * ScopeManager implementation
 *
 * Manages scopes with parent-child hierarchy support.
 */

import type {
  ServerScope,
  ScopeFilter,
  ScopeStore,
  ScopeManager,
  ScopeManagerOptions,
  EventBus,
} from "../types";
import { ulid } from "../../utils/ulid";
import { InMemoryScopeStore } from "./stores/in-memory";

/**
 * Error thrown when a scope is not found.
 */
export class ScopeNotFoundError extends Error {
  constructor(scopeId: string) {
    super(`Scope not found: ${scopeId}`);
    this.name = "ScopeNotFoundError";
  }
}

/**
 * Error thrown when parent scope doesn't exist.
 */
export class InvalidParentScopeError extends Error {
  constructor(parentId: string) {
    super(`Parent scope not found: ${parentId}`);
    this.name = "InvalidParentScopeError";
  }
}

/**
 * ScopeManager implementation.
 *
 * Manages scopes with hierarchy:
 * - Creation with optional parent
 * - Hierarchy traversal (ancestors, descendants)
 * - Membership management
 * - Cascade deletion
 *
 * Events emitted:
 * - scope.created
 * - scope.deleted
 * - scope.agent.joined
 * - scope.agent.left
 */
export class ScopeManagerImpl implements ScopeManager {
  private readonly eventBus: EventBus;
  private readonly store: ScopeStore;

  constructor(options: ScopeManagerOptions) {
    this.eventBus = options.eventBus;
    this.store = options.store ?? new InMemoryScopeStore();
  }

  /**
   * Create a new scope.
   */
  create(params: {
    name: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
    parentId?: string;
  }): ServerScope {
    // Validate parent exists if specified
    if (params.parentId) {
      const parent = this.store.getScope(params.parentId);
      if (!parent) {
        throw new InvalidParentScopeError(params.parentId);
      }
    }

    const scope: ServerScope = {
      id: ulid(),
      name: params.name,
      metadata: params.metadata ?? {},
      createdAt: Date.now(),
      createdBy: params.createdBy,
      parentId: params.parentId,
    };

    this.store.saveScope(scope);

    this.eventBus.emit({
      type: "scope.created",
      data: { scope },
      source: { scopeId: scope.id },
    });

    return scope;
  }

  /**
   * Get scope by ID.
   */
  get(id: string): ServerScope | undefined {
    return this.store.getScope(id);
  }

  /**
   * List scopes with optional filter.
   */
  list(filter?: ScopeFilter): ServerScope[] {
    return this.store.listScopes(filter);
  }

  /**
   * Delete a scope.
   * @param opts.deleteDescendants If true, also delete all child scopes
   */
  delete(id: string, opts?: { deleteDescendants?: boolean }): boolean {
    const scope = this.store.getScope(id);
    if (!scope) {
      return false;
    }

    const deletedDescendants: string[] = [];

    // Delete descendants if requested
    if (opts?.deleteDescendants) {
      const descendants = this.store.getDescendants(id);
      for (const descendantId of descendants) {
        if (this.store.deleteScope(descendantId)) {
          deletedDescendants.push(descendantId);
        }
      }
    }

    const deleted = this.store.deleteScope(id);
    if (deleted) {
      this.eventBus.emit({
        type: "scope.deleted",
        data: {
          scopeId: id,
          deletedDescendants: deletedDescendants.length > 0 ? deletedDescendants : undefined,
        },
        source: { scopeId: id },
      });
    }

    return deleted;
  }

  /**
   * Get parent scope.
   */
  getParent(scopeId: string): ServerScope | undefined {
    const scope = this.store.getScope(scopeId);
    if (!scope?.parentId) {
      return undefined;
    }
    return this.store.getScope(scope.parentId);
  }

  /**
   * Get direct child scopes.
   */
  getChildren(scopeId: string): ServerScope[] {
    return this.store.listScopes({ parentId: scopeId });
  }

  /**
   * Get all ancestor scopes (parent chain to root).
   */
  getAncestors(scopeId: string): ServerScope[] {
    const ancestorIds = this.store.getAncestors(scopeId);
    return ancestorIds
      .map((id) => this.store.getScope(id))
      .filter((s): s is ServerScope => s !== undefined);
  }

  /**
   * Get all descendant scopes.
   */
  getDescendants(scopeId: string): ServerScope[] {
    const descendantIds = this.store.getDescendants(scopeId);
    return descendantIds
      .map((id) => this.store.getScope(id))
      .filter((s): s is ServerScope => s !== undefined);
  }

  /**
   * Add agent to scope.
   */
  join(scopeId: string, agentId: string): void {
    const scope = this.store.getScope(scopeId);
    if (!scope) {
      throw new ScopeNotFoundError(scopeId);
    }

    this.store.addMember(scopeId, agentId);

    this.eventBus.emit({
      type: "scope.agent.joined",
      data: { scopeId, agentId },
      source: { scopeId, agentId },
    });
  }

  /**
   * Remove agent from scope.
   */
  leave(scopeId: string, agentId: string): void {
    const scope = this.store.getScope(scopeId);
    if (!scope) {
      throw new ScopeNotFoundError(scopeId);
    }

    this.store.removeMember(scopeId, agentId);

    this.eventBus.emit({
      type: "scope.agent.left",
      data: { scopeId, agentId },
      source: { scopeId, agentId },
    });
  }

  /**
   * Get all agents in a scope.
   * @param opts.includeDescendants If true, include agents from descendant scopes
   */
  getMembers(scopeId: string, opts?: { includeDescendants?: boolean }): string[] {
    return this.store.getMembers(scopeId, opts?.includeDescendants);
  }

  /**
   * Get all scopes an agent belongs to.
   */
  getScopesForAgent(agentId: string): string[] {
    return this.store.getScopesForAgent(agentId);
  }

  /**
   * Check if agent is a member of scope.
   * @param opts.checkAncestors If true, also check if agent is member of any ancestor scope
   */
  isMember(
    scopeId: string,
    agentId: string,
    opts?: { checkAncestors?: boolean }
  ): boolean {
    const scopes = this.store.getScopesForAgent(agentId);

    // Check direct membership
    if (scopes.includes(scopeId)) {
      return true;
    }

    // Check ancestor membership if requested
    if (opts?.checkAncestors) {
      const ancestors = this.store.getAncestors(scopeId);
      for (const ancestorId of ancestors) {
        if (scopes.includes(ancestorId)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Remove agent from all scopes.
   * Used for cleanup when agent is unregistered.
   */
  leaveAll(agentId: string): string[] {
    const scopes = this.store.getScopesForAgent(agentId);

    for (const scopeId of scopes) {
      this.store.removeMember(scopeId, agentId);

      this.eventBus.emit({
        type: "scope.agent.left",
        data: { scopeId, agentId },
        source: { scopeId, agentId },
      });
    }

    return scopes;
  }
}
