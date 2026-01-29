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
  StandardAgentState,
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
 * Error thrown when an agent state is invalid.
 */
export class InvalidAgentStateError extends Error {
  constructor(state: string, reason: string) {
    super(`Invalid agent state "${state}": ${reason}`);
    this.name = "InvalidAgentStateError";
  }
}

/** Standard agent states */
const STANDARD_STATES: readonly StandardAgentState[] = ["idle", "busy", "suspended", "stopped"];

/** Maximum length for custom state names */
const MAX_CUSTOM_STATE_LENGTH = 64;

/**
 * Check if a state is a standard agent state.
 */
export function isStandardState(state: string): state is StandardAgentState {
  return STANDARD_STATES.includes(state as StandardAgentState);
}

/**
 * Check if a state is a custom agent state (starts with "custom:").
 */
export function isCustomState(state: string): boolean {
  return state.startsWith("custom:");
}

/**
 * Validate an agent state.
 * - Standard states are always valid
 * - Custom states must start with "custom:" and have a non-empty suffix
 * - Custom state suffix must be <= 64 characters
 *
 * @throws InvalidAgentStateError if state is invalid
 */
export function validateAgentState(state: string): void {
  if (isStandardState(state)) {
    return; // Standard states are always valid
  }

  if (!isCustomState(state)) {
    throw new InvalidAgentStateError(
      state,
      `must be a standard state (${STANDARD_STATES.join(", ")}) or start with "custom:"`
    );
  }

  const suffix = state.slice(7); // Remove "custom:" prefix
  if (suffix.length === 0) {
    throw new InvalidAgentStateError(state, "custom state must have a non-empty suffix after 'custom:'");
  }

  if (suffix.length > MAX_CUSTOM_STATE_LENGTH) {
    throw new InvalidAgentStateError(
      state,
      `custom state suffix must be <= ${MAX_CUSTOM_STATE_LENGTH} characters (got ${suffix.length})`
    );
  }
}

/**
 * Valid state transitions for standard states.
 *
 * State machine:
 *   idle <-> busy
 *   idle -> suspended -> idle
 *   idle -> stopped
 *   busy -> suspended -> busy (resumes to previous state)
 *   busy -> stopped
 *   suspended -> stopped
 *
 * Custom states (custom:*) can transition to/from any state,
 * bypassing the standard state machine.
 */
const VALID_TRANSITIONS: Record<StandardAgentState, StandardAgentState[]> = {
  idle: ["busy", "suspended", "stopped"],
  busy: ["idle", "suspended", "stopped"],
  suspended: ["idle", "busy", "stopped"],
  stopped: [], // Terminal state
};

/**
 * Check if a state transition is valid.
 *
 * Rules:
 * - Custom states can transition to/from any state (bypass state machine)
 * - Standard states follow the VALID_TRANSITIONS state machine
 * - Transitioning to "stopped" is always allowed (cleanup)
 * - Transitioning from "stopped" is never allowed (terminal state)
 */
export function isValidTransition(
  from: ServerAgentState,
  to: ServerAgentState
): boolean {
  // Custom states can transition to/from any state
  if (isCustomState(from) || isCustomState(to)) {
    // Exception: cannot transition from "stopped" even to custom states
    if (from === "stopped") {
      return false;
    }
    return true;
  }

  // Both are standard states - use state machine
  return VALID_TRANSITIONS[from as StandardAgentState].includes(to as StandardAgentState);
}

/**
 * Check if a capability matches a pattern.
 * Supports:
 * - Exact match: "translate:en" matches "translate:en"
 * - Glob with *: "translate:*" matches "translate:en", "translate:fr"
 * - Glob with **: "translate:**" matches "translate:en:formal"
 */
export function matchesCapability(capability: string, pattern: string): boolean {
  // Exact match
  if (pattern === capability) {
    return true;
  }

  // Convert glob pattern to regex
  // First, replace ** with a placeholder to avoid conflicts
  let regexPattern = pattern.replace(/\*\*/g, "\x00DOUBLESTAR\x00");
  // Then replace single * with a placeholder
  regexPattern = regexPattern.replace(/\*/g, "\x00SINGLESTAR\x00");
  // Escape special regex chars
  regexPattern = regexPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // Replace placeholders with regex patterns
  regexPattern = regexPattern.replace(/\x00DOUBLESTAR\x00/g, ".*"); // ** matches anything
  regexPattern = regexPattern.replace(/\x00SINGLESTAR\x00/g, "[^:]*"); // * matches anything except colons

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(capability);
}

/**
 * Check if an agent has any capability matching the pattern.
 */
export function hasCapability(capabilities: string[] | undefined, pattern: string): boolean {
  if (!capabilities || capabilities.length === 0) {
    return false;
  }
  return capabilities.some((cap) => matchesCapability(cap, pattern));
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
    /** Capabilities this agent provides (for capability-based discovery) */
    capabilities?: string[];
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
      capabilities: params.capabilities,
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
   *
   * Supports both standard states (idle, busy, suspended, stopped)
   * and custom states (custom:thinking, custom:waiting, etc.).
   *
   * Standard states follow a state machine with restricted transitions.
   * Custom states can transition to/from any state.
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

    // Validate the state format
    validateAgentState(state);

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
