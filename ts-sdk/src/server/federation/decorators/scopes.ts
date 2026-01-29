/**
 * FederatedScopeManager decorator
 *
 * Wraps a ScopeManager to add federation capabilities.
 */

import type {
  ScopeManager,
  ServerScope,
  ScopeFilter,
  FederatedScopeManagerOptions,
  FederatedScopeSyncOptions,
  FederationGateway,
} from "../../types";

/**
 * Default sync options - all syncing enabled.
 */
const DEFAULT_SYNC_OPTIONS: Required<FederatedScopeSyncOptions> = {
  onCreateScope: true,
  onMembershipChange: true,
  includeRemote: true,
};

/**
 * Prefix for remote scope IDs.
 */
const REMOTE_PREFIX = "remote:";

/**
 * Remote scope with additional tracking.
 */
interface RemoteScope extends ServerScope {
  members: Set<string>;
}

/**
 * FederatedScopeManager decorator.
 *
 * Wraps a local ScopeManager and adds federation capabilities:
 * - Broadcasts local scope changes to peers
 * - Tracks remote scopes from peers
 * - Merges remote scopes into list() results
 *
 * @example
 * ```typescript
 * const local = new ScopeManagerImpl({ eventBus });
 * const federated = new FederatedScopeManager({
 *   local,
 *   gateway,
 *   sync: { onCreateScope: true, includeRemote: true },
 * });
 *
 * // Use like normal ScopeManager
 * const scope = federated.create({ name: "team-room", createdBy: "agent1" });
 * // Scope is automatically broadcast to peers
 * ```
 */
export class FederatedScopeManager implements ScopeManager {
  private readonly local: ScopeManager;
  private readonly gateway: FederationGateway;
  private readonly sync: Required<FederatedScopeSyncOptions>;

  /** Remote scopes from peer systems */
  private readonly remoteScopes: Map<string, RemoteScope> = new Map();

  constructor(options: FederatedScopeManagerOptions) {
    this.local = options.local;
    this.gateway = options.gateway;
    this.sync = { ...DEFAULT_SYNC_OPTIONS, ...options.sync };

    // Listen for incoming peer messages
    this.gateway.onPeerMessage(this.handlePeerMessage.bind(this));
  }

  /**
   * Create a new scope.
   * Broadcasts to peers if onCreateScope sync is enabled.
   */
  create(params: {
    name: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
    parentId?: string;
  }): ServerScope {
    const scope = this.local.create(params);

    if (this.sync.onCreateScope) {
      this.broadcastScopeEvent("scope.created", scope);
    }

    return scope;
  }

  /**
   * Get scope by ID.
   * Checks both local and remote scopes.
   */
  get(id: string): ServerScope | undefined {
    // Check local first
    const local = this.local.get(id);
    if (local) return local;

    // Check remote
    if (this.sync.includeRemote) {
      return this.remoteScopes.get(id);
    }

    return undefined;
  }

  /**
   * List scopes with optional filter.
   * Includes remote scopes if includeRemote sync is enabled.
   */
  list(filter?: ScopeFilter): ServerScope[] {
    const localScopes = this.local.list(filter);

    if (!this.sync.includeRemote) {
      return localScopes;
    }

    // Merge with remote scopes
    const remoteScopes = this.filterRemoteScopes(filter);
    return [...localScopes, ...remoteScopes];
  }

  /**
   * Delete a scope.
   * Broadcasts to peers if onCreateScope sync is enabled.
   */
  delete(id: string, opts?: { deleteDescendants?: boolean }): boolean {
    // Can't delete remote scopes locally
    if (this.remoteScopes.has(id)) {
      return false;
    }

    const scope = this.local.get(id);
    const success = this.local.delete(id, opts);

    if (success && scope && this.sync.onCreateScope) {
      this.broadcastScopeEvent("scope.deleted", scope);
    }

    return success;
  }

  /**
   * Get parent scope.
   */
  getParent(scopeId: string): ServerScope | undefined {
    // Check if it's a remote scope
    const remote = this.remoteScopes.get(scopeId);
    if (remote?.parentId) {
      return this.remoteScopes.get(remote.parentId) ?? this.local.get(remote.parentId);
    }

    return this.local.getParent(scopeId);
  }

  /**
   * Get child scopes.
   */
  getChildren(scopeId: string): ServerScope[] {
    const localChildren = this.local.getChildren(scopeId);

    if (!this.sync.includeRemote) {
      return localChildren;
    }

    // Include remote children
    const remoteChildren = Array.from(this.remoteScopes.values()).filter(
      (s) => s.parentId === scopeId
    );

    return [...localChildren, ...remoteChildren];
  }

  /**
   * Get all ancestor scopes.
   */
  getAncestors(scopeId: string): ServerScope[] {
    // For remote scopes, just return empty (hierarchy tracking is complex across systems)
    if (this.remoteScopes.has(scopeId)) {
      return [];
    }

    return this.local.getAncestors(scopeId);
  }

  /**
   * Get all descendant scopes.
   */
  getDescendants(scopeId: string): ServerScope[] {
    // For remote scopes, just return empty
    if (this.remoteScopes.has(scopeId)) {
      return [];
    }

    return this.local.getDescendants(scopeId);
  }

  /**
   * Add agent to scope.
   * Broadcasts to peers if onMembershipChange sync is enabled.
   */
  join(scopeId: string, agentId: string): void {
    // Can't join remote scopes locally
    if (this.remoteScopes.has(scopeId)) {
      throw new Error(`Cannot join remote scope: ${scopeId}`);
    }

    this.local.join(scopeId, agentId);

    if (this.sync.onMembershipChange) {
      const scope = this.local.get(scopeId);
      if (scope) {
        this.broadcastMembershipEvent("scope.agent.joined", scope, agentId);
      }
    }
  }

  /**
   * Remove agent from scope.
   * Broadcasts to peers if onMembershipChange sync is enabled.
   */
  leave(scopeId: string, agentId: string): void {
    // Can't leave remote scopes locally
    if (this.remoteScopes.has(scopeId)) {
      throw new Error(`Cannot leave remote scope: ${scopeId}`);
    }

    this.local.leave(scopeId, agentId);

    if (this.sync.onMembershipChange) {
      const scope = this.local.get(scopeId);
      if (scope) {
        this.broadcastMembershipEvent("scope.agent.left", scope, agentId);
      }
    }
  }

  /**
   * Remove agent from all scopes.
   */
  leaveAll(agentId: string): void {
    // Get scopes before leaving
    const scopeIds = this.local.getScopesForAgent?.(agentId) ?? [];

    // Leave all local scopes
    for (const scopeId of scopeIds) {
      this.leave(scopeId, agentId);
    }
  }

  /**
   * Get all agents in a scope.
   */
  getMembers(
    scopeId: string,
    opts?: { includeDescendants?: boolean }
  ): string[] {
    // For remote scopes, return tracked members
    const remote = this.remoteScopes.get(scopeId);
    if (remote) {
      return Array.from(remote.members);
    }

    return this.local.getMembers(scopeId, opts);
  }

  /**
   * Get all scopes an agent belongs to.
   */
  getScopesForAgent?(agentId: string): string[] {
    const localScopes = this.local.getScopesForAgent?.(agentId) ?? [];

    if (!this.sync.includeRemote) {
      return localScopes;
    }

    // Include remote scopes
    const remoteScopes: string[] = [];
    for (const [id, scope] of this.remoteScopes) {
      if (scope.members.has(agentId)) {
        remoteScopes.push(id);
      }
    }

    return [...localScopes, ...remoteScopes];
  }

  /**
   * Check if a scope is remote.
   */
  isRemote(scopeId: string): boolean {
    return this.remoteScopes.has(scopeId);
  }

  /**
   * Get all remote scopes.
   */
  getRemoteScopes(): ServerScope[] {
    return Array.from(this.remoteScopes.values());
  }

  /**
   * Clear all remote scopes from a specific system.
   */
  clearRemoteSystem(systemId: string): void {
    const prefix = `${REMOTE_PREFIX}${systemId}:`;
    for (const [id] of this.remoteScopes) {
      if (id.startsWith(prefix)) {
        this.remoteScopes.delete(id);
      }
    }
  }

  /**
   * Broadcast a scope event to all peers.
   */
  private broadcastScopeEvent(
    type: "scope.created" | "scope.deleted",
    scope: ServerScope
  ): void {
    const peers = this.gateway.listPeers();
    for (const peer of peers) {
      if (peer.status === "connected") {
        const envelope = this.gateway.createEnvelope(peer.systemId, {
          type,
          scope: {
            ...scope,
            metadata: {
              ...scope.metadata,
              _federatedFrom: (this.gateway as any).systemId,
            },
          },
        });

        this.gateway.routeToPeer(peer.systemId, envelope).catch((err) => {
          console.error(`Failed to sync scope to ${peer.systemId}:`, err);
        });
      }
    }
  }

  /**
   * Broadcast a membership event to all peers.
   */
  private broadcastMembershipEvent(
    type: "scope.agent.joined" | "scope.agent.left",
    scope: ServerScope,
    agentId: string
  ): void {
    const peers = this.gateway.listPeers();
    for (const peer of peers) {
      if (peer.status === "connected") {
        const envelope = this.gateway.createEnvelope(peer.systemId, {
          type,
          scopeId: scope.id,
          agentId,
        });

        this.gateway.routeToPeer(peer.systemId, envelope).catch((err) => {
          console.error(`Failed to sync membership to ${peer.systemId}:`, err);
        });
      }
    }
  }

  /**
   * Handle incoming peer messages.
   */
  private handlePeerMessage(
    from: string,
    envelope: { payload: unknown }
  ): void {
    const payload = envelope.payload as {
      type: string;
      scope?: ServerScope;
      scopeId?: string;
      agentId?: string;
    };

    if (!payload.type?.startsWith("scope.")) {
      return;
    }

    switch (payload.type) {
      case "scope.created":
        if (payload.scope) {
          const remoteId = `${REMOTE_PREFIX}${from}:${payload.scope.id}`;
          this.remoteScopes.set(remoteId, {
            ...payload.scope,
            id: remoteId,
            metadata: {
              ...payload.scope.metadata,
              _federatedFrom: from,
              _originalId: payload.scope.id,
            },
            members: new Set(),
          });
        }
        break;

      case "scope.deleted":
        if (payload.scope) {
          const remoteId = `${REMOTE_PREFIX}${from}:${payload.scope.id}`;
          this.remoteScopes.delete(remoteId);
        }
        break;

      case "scope.agent.joined":
        if (payload.scopeId && payload.agentId) {
          const remoteId = `${REMOTE_PREFIX}${from}:${payload.scopeId}`;
          const scope = this.remoteScopes.get(remoteId);
          if (scope) {
            scope.members.add(payload.agentId);
          }
        }
        break;

      case "scope.agent.left":
        if (payload.scopeId && payload.agentId) {
          const remoteId = `${REMOTE_PREFIX}${from}:${payload.scopeId}`;
          const scope = this.remoteScopes.get(remoteId);
          if (scope) {
            scope.members.delete(payload.agentId);
          }
        }
        break;
    }
  }

  /**
   * Filter remote scopes by criteria.
   */
  private filterRemoteScopes(filter?: ScopeFilter): ServerScope[] {
    if (!filter) {
      return Array.from(this.remoteScopes.values());
    }

    return Array.from(this.remoteScopes.values()).filter((scope) => {
      if (filter.parentId !== undefined) {
        if (filter.parentId === null && scope.parentId) return false;
        if (filter.parentId !== null && scope.parentId !== filter.parentId) return false;
      }
      // Can't filter by ancestorId for remote scopes
      return true;
    });
  }
}
