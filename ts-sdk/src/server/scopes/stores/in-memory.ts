/**
 * In-memory ScopeStore implementation with hierarchy support
 */

import type { ServerScope, ScopeFilter, ScopeStore } from "../../types";

/**
 * In-memory implementation of ScopeStore with hierarchy and membership tracking.
 */
export class InMemoryScopeStore implements ScopeStore {
  private readonly scopes: Map<string, ServerScope> = new Map();
  private readonly membership: Map<string, Set<string>> = new Map(); // scopeId -> Set<agentId>
  private readonly agentScopes: Map<string, Set<string>> = new Map(); // agentId -> Set<scopeId>

  /**
   * Save a scope (create or update).
   */
  saveScope(scope: ServerScope): void {
    this.scopes.set(scope.id, { ...scope });
  }

  /**
   * Get scope by ID.
   */
  getScope(id: string): ServerScope | undefined {
    const scope = this.scopes.get(id);
    return scope ? { ...scope } : undefined;
  }

  /**
   * List scopes matching filter criteria.
   */
  listScopes(filter?: ScopeFilter): ServerScope[] {
    const results: ServerScope[] = [];

    for (const scope of this.scopes.values()) {
      // Filter by parentId (null means root scopes only)
      if (filter?.parentId !== undefined) {
        if (filter.parentId === null) {
          if (scope.parentId !== undefined) continue;
        } else {
          if (scope.parentId !== filter.parentId) continue;
        }
      }

      // Filter by ancestorId (include all descendants of this scope)
      if (filter?.ancestorId !== undefined) {
        const ancestors = this.getAncestors(scope.id);
        if (!ancestors.includes(filter.ancestorId)) continue;
      }

      results.push({ ...scope });
    }

    return results;
  }

  /**
   * Delete a scope by ID.
   */
  deleteScope(id: string): boolean {
    // Clean up membership
    const members = this.membership.get(id);
    if (members) {
      for (const agentId of members) {
        this.agentScopes.get(agentId)?.delete(id);
      }
      this.membership.delete(id);
    }

    return this.scopes.delete(id);
  }

  /**
   * Get all ancestor scope IDs (parent chain to root).
   */
  getAncestors(scopeId: string): string[] {
    const ancestors: string[] = [];
    let current = this.scopes.get(scopeId);

    while (current?.parentId) {
      ancestors.push(current.parentId);
      current = this.scopes.get(current.parentId);
    }

    return ancestors;
  }

  /**
   * Get all descendant scope IDs (children recursively).
   */
  getDescendants(scopeId: string): string[] {
    const descendants: string[] = [];
    const queue: string[] = [scopeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      // Find all direct children
      for (const scope of this.scopes.values()) {
        if (scope.parentId === currentId) {
          descendants.push(scope.id);
          queue.push(scope.id);
        }
      }
    }

    return descendants;
  }

  /**
   * Add agent to scope membership.
   */
  addMember(scopeId: string, agentId: string): void {
    // Add to scope -> agents mapping
    let members = this.membership.get(scopeId);
    if (!members) {
      members = new Set();
      this.membership.set(scopeId, members);
    }
    members.add(agentId);

    // Add to agent -> scopes mapping
    let scopes = this.agentScopes.get(agentId);
    if (!scopes) {
      scopes = new Set();
      this.agentScopes.set(agentId, scopes);
    }
    scopes.add(scopeId);
  }

  /**
   * Remove agent from scope membership.
   */
  removeMember(scopeId: string, agentId: string): void {
    this.membership.get(scopeId)?.delete(agentId);
    this.agentScopes.get(agentId)?.delete(scopeId);
  }

  /**
   * Get all agents in a scope.
   */
  getMembers(scopeId: string, includeDescendants?: boolean): string[] {
    const members = new Set<string>();

    // Add direct members
    const directMembers = this.membership.get(scopeId);
    if (directMembers) {
      for (const agentId of directMembers) {
        members.add(agentId);
      }
    }

    // Add descendant members if requested
    if (includeDescendants) {
      const descendants = this.getDescendants(scopeId);
      for (const descendantId of descendants) {
        const descendantMembers = this.membership.get(descendantId);
        if (descendantMembers) {
          for (const agentId of descendantMembers) {
            members.add(agentId);
          }
        }
      }
    }

    return Array.from(members);
  }

  /**
   * Get all scopes an agent belongs to.
   */
  getScopesForAgent(agentId: string): string[] {
    const scopes = this.agentScopes.get(agentId);
    return scopes ? Array.from(scopes) : [];
  }

  /**
   * Clear all scopes and membership.
   */
  clear(): void {
    this.scopes.clear();
    this.membership.clear();
    this.agentScopes.clear();
  }

  /**
   * Get the number of stored scopes.
   */
  get size(): number {
    return this.scopes.size;
  }
}
