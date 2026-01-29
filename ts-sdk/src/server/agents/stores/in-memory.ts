/**
 * In-memory AgentStore implementation
 */

import type {
  RegisteredAgent,
  AgentFilter,
  AgentStore,
} from "../../types";

/**
 * In-memory implementation of AgentStore.
 */
export class InMemoryAgentStore implements AgentStore {
  private readonly agents: Map<string, RegisteredAgent> = new Map();

  /**
   * Save an agent (create or update).
   */
  save(agent: RegisteredAgent): void {
    this.agents.set(agent.id, { ...agent });
  }

  /**
   * Get agent by ID.
   */
  get(id: string): RegisteredAgent | undefined {
    const agent = this.agents.get(id);
    return agent ? { ...agent } : undefined;
  }

  /**
   * List agents matching filter criteria.
   */
  list(filter?: AgentFilter): RegisteredAgent[] {
    const results: RegisteredAgent[] = [];

    for (const agent of this.agents.values()) {
      // Filter by state
      if (filter?.state !== undefined && agent.state !== filter.state) {
        continue;
      }

      // Filter by role
      if (filter?.role !== undefined && agent.role !== filter.role) {
        continue;
      }

      // Filter by session
      if (filter?.sessionId !== undefined && agent.sessionId !== filter.sessionId) {
        continue;
      }

      // Note: scopeId filter is handled by caller (requires ScopeManager)
      results.push({ ...agent });
    }

    return results;
  }

  /**
   * Delete an agent by ID.
   */
  delete(id: string): boolean {
    return this.agents.delete(id);
  }

  /**
   * Clear all agents.
   */
  clear(): void {
    this.agents.clear();
  }

  /**
   * Get the number of stored agents.
   */
  get size(): number {
    return this.agents.size;
  }
}
