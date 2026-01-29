/**
 * FederatedAgentRegistry decorator
 *
 * Wraps an AgentRegistry to add federation capabilities.
 */

import type {
  AgentRegistry,
  RegisteredAgent,
  AgentFilter,
  ServerAgentState,
  FederatedAgentRegistryOptions,
  FederatedAgentSyncOptions,
  FederationGateway,
} from "../../types";
import {
  formatFederatedId,
  parseFederatedId,
  isFederatedId,
  isFromSystem,
} from "../federated-id";

/**
 * Default sync options - all syncing enabled.
 */
const DEFAULT_SYNC_OPTIONS: Required<FederatedAgentSyncOptions> = {
  onRegister: true,
  onStateChange: true,
  includeRemote: true,
};

/**
 * FederatedAgentRegistry decorator.
 *
 * Wraps a local AgentRegistry and adds federation capabilities:
 * - Broadcasts local agent changes to peers
 * - Tracks remote agents from peers
 * - Merges remote agents into list() results
 *
 * @example
 * ```typescript
 * const local = new AgentRegistryImpl({ eventBus });
 * const federated = new FederatedAgentRegistry({
 *   local,
 *   gateway,
 *   sync: { onRegister: true, includeRemote: true },
 * });
 *
 * // Use like normal AgentRegistry
 * const agent = federated.register({ name: "Alice", sessionId: "s1" });
 * // Agent is automatically broadcast to peers
 * ```
 */
export class FederatedAgentRegistry implements AgentRegistry {
  private readonly local: AgentRegistry;
  private readonly gateway: FederationGateway;
  private readonly sync: Required<FederatedAgentSyncOptions>;

  /** Remote agents from peer systems */
  private readonly remoteAgents: Map<string, RegisteredAgent> = new Map();

  constructor(options: FederatedAgentRegistryOptions) {
    this.local = options.local;
    this.gateway = options.gateway;
    this.sync = { ...DEFAULT_SYNC_OPTIONS, ...options.sync };

    // Listen for incoming peer messages
    this.gateway.onPeerMessage(this.handlePeerMessage.bind(this));
  }

  /**
   * Register a new agent.
   * Broadcasts to peers if onRegister sync is enabled.
   */
  register(params: {
    name: string;
    role?: string;
    metadata?: Record<string, unknown>;
    sessionId: string;
  }): RegisteredAgent {
    const agent = this.local.register(params);

    if (this.sync.onRegister) {
      this.broadcastAgentEvent("agent.registered", agent);
    }

    return agent;
  }

  /**
   * Get agent by ID.
   * Checks both local and remote agents.
   */
  get(id: string): RegisteredAgent | undefined {
    // Check local first
    const local = this.local.get(id);
    if (local) return local;

    // Check remote
    if (this.sync.includeRemote) {
      return this.remoteAgents.get(id);
    }

    return undefined;
  }

  /**
   * List agents matching filter.
   * Includes remote agents if includeRemote sync is enabled.
   */
  list(filter?: AgentFilter): RegisteredAgent[] {
    const localAgents = this.local.list(filter);

    if (!this.sync.includeRemote) {
      return localAgents;
    }

    // Merge with remote agents
    const remoteAgents = this.filterRemoteAgents(filter);
    return [...localAgents, ...remoteAgents];
  }

  /**
   * Unregister an agent.
   * Broadcasts to peers if onRegister sync is enabled.
   */
  unregister(id: string): boolean {
    // Can't unregister remote agents locally
    if (this.remoteAgents.has(id)) {
      return false;
    }

    const agent = this.local.get(id);
    const success = this.local.unregister(id);

    if (success && agent && this.sync.onRegister) {
      this.broadcastAgentEvent("agent.unregistered", agent);
    }

    return success;
  }

  /**
   * Update agent state.
   * Broadcasts to peers if onStateChange sync is enabled.
   */
  updateState(id: string, state: ServerAgentState): RegisteredAgent {
    // Can't update remote agents locally
    if (this.remoteAgents.has(id)) {
      throw new Error(`Cannot update remote agent: ${id}`);
    }

    const agent = this.local.updateState(id, state);

    if (this.sync.onStateChange) {
      this.broadcastAgentEvent("agent.state.changed", agent);
    }

    return agent;
  }

  /**
   * Update agent metadata.
   * Broadcasts to peers if onStateChange sync is enabled.
   */
  updateMetadata(id: string, metadata: Record<string, unknown>): RegisteredAgent {
    // Can't update remote agents locally
    if (this.remoteAgents.has(id)) {
      throw new Error(`Cannot update remote agent: ${id}`);
    }

    const agent = this.local.updateMetadata(id, metadata);

    if (this.sync.onStateChange) {
      this.broadcastAgentEvent("agent.metadata.changed", agent);
    }

    return agent;
  }

  /**
   * Unregister all agents for a session.
   * Broadcasts each unregistration to peers.
   */
  unregisterBySession(sessionId: string): string[] {
    const agents = this.local.list({ sessionId });
    const unregisteredIds = this.local.unregisterBySession(sessionId);

    if (this.sync.onRegister && unregisteredIds.length > 0) {
      for (const agent of agents) {
        if (unregisteredIds.includes(agent.id)) {
          this.broadcastAgentEvent("agent.unregistered", agent);
        }
      }
    }

    return unregisteredIds;
  }

  /**
   * Check if an agent is remote.
   */
  isRemote(agentId: string): boolean {
    return this.remoteAgents.has(agentId);
  }

  /**
   * Get all remote agents.
   */
  getRemoteAgents(): RegisteredAgent[] {
    return Array.from(this.remoteAgents.values());
  }

  /**
   * Clear all remote agents from a specific system.
   */
  clearRemoteSystem(systemId: string): void {
    for (const [id] of this.remoteAgents) {
      if (isFromSystem(id, systemId)) {
        this.remoteAgents.delete(id);
      }
    }
  }

  /**
   * Broadcast an agent event to all peers.
   */
  private broadcastAgentEvent(
    type: "agent.registered" | "agent.unregistered" | "agent.state.changed" | "agent.metadata.changed",
    agent: RegisteredAgent
  ): void {
    const peers = this.gateway.listPeers();
    for (const peer of peers) {
      if (peer.status === "connected") {
        const envelope = this.gateway.createEnvelope(peer.systemId, {
          type,
          agent: {
            ...agent,
            // Mark as coming from this system
            metadata: {
              ...agent.metadata,
              _federatedFrom: (this.gateway as any).systemId,
            },
          },
        });

        this.gateway.routeToPeer(peer.systemId, envelope).catch((err) => {
          console.error(`Failed to sync agent to ${peer.systemId}:`, err);
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
      agent?: RegisteredAgent;
    };

    if (!payload.type?.startsWith("agent.") || !payload.agent) {
      return;
    }

    const remoteAgent = payload.agent;
    // Use standardized federated ID format: {systemId}:agent:{entityId}
    const remoteId = formatFederatedId(from, "agent", remoteAgent.id);

    switch (payload.type) {
      case "agent.registered":
        this.remoteAgents.set(remoteId, {
          ...remoteAgent,
          id: remoteId,
          metadata: {
            ...remoteAgent.metadata,
            _federatedFrom: from,
            _originalId: remoteAgent.id,
          },
        });
        break;

      case "agent.unregistered":
        this.remoteAgents.delete(remoteId);
        break;

      case "agent.state.changed":
      case "agent.metadata.changed":
        if (this.remoteAgents.has(remoteId)) {
          this.remoteAgents.set(remoteId, {
            ...remoteAgent,
            id: remoteId,
            metadata: {
              ...remoteAgent.metadata,
              _federatedFrom: from,
              _originalId: remoteAgent.id,
            },
          });
        }
        break;
    }
  }

  /**
   * Filter remote agents by criteria.
   */
  private filterRemoteAgents(filter?: AgentFilter): RegisteredAgent[] {
    if (!filter) {
      return Array.from(this.remoteAgents.values());
    }

    return Array.from(this.remoteAgents.values()).filter((agent) => {
      if (filter.role && agent.role !== filter.role) return false;
      if (filter.state && agent.state !== filter.state) return false;
      if (filter.sessionId && agent.sessionId !== filter.sessionId) return false;
      if (filter.scopeId) {
        // Can't filter remote agents by scope easily
        // Would need to track scope membership from remote
        return false;
      }
      return true;
    });
  }
}
