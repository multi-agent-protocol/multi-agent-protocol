/**
 * AgentRegistry implementation
 *
 * Manages agent lifecycle and state with event emission.
 */

import type {
  RegisteredAgent,
  AgentFilter,
  AgentStore,
  AgentRegistry,
  AgentRegistryOptions,
  ServerAgentState,
  EventBus,
} from "../types";
import { ulid } from "../../utils/ulid";
import { InMemoryAgentStore } from "./stores/in-memory";

/**
 * Error thrown when an agent is not found.
 */
export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = "AgentNotFoundError";
  }
}

/**
 * Error thrown for invalid state transitions.
 */
export class InvalidStateTransitionError extends Error {
  constructor(from: ServerAgentState, to: ServerAgentState) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

/**
 * Valid state transitions.
 *
 * State machine:
 *   idle <-> busy
 *   idle -> suspended -> idle
 *   idle -> stopped
 *   busy -> suspended -> busy (resumes to previous state)
 *   busy -> stopped
 *   suspended -> stopped
 */
const VALID_TRANSITIONS: Record<ServerAgentState, ServerAgentState[]> = {
  idle: ["busy", "suspended", "stopped"],
  busy: ["idle", "suspended", "stopped"],
  suspended: ["idle", "busy", "stopped"],
  stopped: [], // Terminal state
};

/**
 * Check if a state transition is valid.
 */
function isValidTransition(
  from: ServerAgentState,
  to: ServerAgentState
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * AgentRegistry implementation.
 *
 * Manages agent lifecycle:
 * - Registration and unregistration
 * - State transitions with validation
 * - Metadata updates
 * - Bulk cleanup by session
 *
 * Events emitted:
 * - agent.registered
 * - agent.unregistered
 * - agent.state.changed
 * - agent.metadata.changed
 */
export class AgentRegistryImpl implements AgentRegistry {
  private readonly eventBus: EventBus;
  private readonly store: AgentStore;

  constructor(options: AgentRegistryOptions) {
    this.eventBus = options.eventBus;
    this.store = options.store ?? new InMemoryAgentStore();
  }

  /**
   * Register a new agent.
   */
  register(params: {
    name: string;
    role?: string;
    metadata?: Record<string, unknown>;
    sessionId: string;
  }): RegisteredAgent {
    const now = Date.now();
    const agent: RegisteredAgent = {
      id: ulid(),
      name: params.name,
      role: params.role,
      state: "idle",
      metadata: params.metadata ?? {},
      sessionId: params.sessionId,
      registeredAt: now,
      lastStateChange: now,
    };

    this.store.save(agent);

    this.eventBus.emit({
      type: "agent.registered",
      data: { agent },
      source: { agentId: agent.id, sessionId: params.sessionId },
    });

    return agent;
  }

  /**
   * Get agent by ID.
   */
  get(id: string): RegisteredAgent | undefined {
    return this.store.get(id);
  }

  /**
   * List agents matching filter criteria.
   */
  list(filter?: AgentFilter): RegisteredAgent[] {
    return this.store.list(filter);
  }

  /**
   * Unregister an agent.
   */
  unregister(id: string): boolean {
    const agent = this.store.get(id);
    if (!agent) {
      return false;
    }

    const deleted = this.store.delete(id);
    if (deleted) {
      this.eventBus.emit({
        type: "agent.unregistered",
        data: { agentId: id, agent },
        source: { agentId: id, sessionId: agent.sessionId },
      });
    }

    return deleted;
  }

  /**
   * Update agent state with validation.
   */
  updateState(id: string, state: ServerAgentState): RegisteredAgent {
    const agent = this.store.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    // Check if state is actually changing
    if (agent.state === state) {
      return agent;
    }

    // Validate transition
    if (!isValidTransition(agent.state, state)) {
      throw new InvalidStateTransitionError(agent.state, state);
    }

    const previousState = agent.state;
    const updatedAgent: RegisteredAgent = {
      ...agent,
      state,
      lastStateChange: Date.now(),
    };

    this.store.save(updatedAgent);

    this.eventBus.emit({
      type: "agent.state.changed",
      data: { agent: updatedAgent, previousState },
      source: { agentId: id, sessionId: agent.sessionId },
    });

    return updatedAgent;
  }

  /**
   * Update agent metadata (merges with existing).
   */
  updateMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): RegisteredAgent {
    const agent = this.store.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    const updatedAgent: RegisteredAgent = {
      ...agent,
      metadata: { ...agent.metadata, ...metadata },
    };

    this.store.save(updatedAgent);

    this.eventBus.emit({
      type: "agent.metadata.changed",
      data: { agent: updatedAgent, changes: metadata },
      source: { agentId: id, sessionId: agent.sessionId },
    });

    return updatedAgent;
  }

  /**
   * Unregister all agents for a session.
   * Used for cleanup when a session disconnects.
   */
  unregisterBySession(sessionId: string): string[] {
    const agents = this.store.list({ sessionId });
    const unregisteredIds: string[] = [];

    for (const agent of agents) {
      if (this.unregister(agent.id)) {
        unregisteredIds.push(agent.id);
      }
    }

    return unregisteredIds;
  }
}
