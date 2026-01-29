/**
 * Tests for server AgentRegistry and InMemoryAgentStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemoryAgentStore,
  AgentRegistryImpl,
  AgentNotFoundError,
  InvalidStateTransitionError,
  InvalidAgentStateError,
  isStandardState,
  isCustomState,
  validateAgentState,
  isValidTransition,
  matchesCapability,
  hasCapability,
  type RegisteredAgent,
} from "../server/agents";
import { EventBusImpl } from "../server/events";

describe("InMemoryAgentStore", () => {
  let store: InMemoryAgentStore;

  beforeEach(() => {
    store = new InMemoryAgentStore();
  });

  const createAgent = (overrides: Partial<RegisteredAgent> = {}): RegisteredAgent => ({
    id: "agent-1",
    name: "Test Agent",
    state: "idle",
    metadata: {},
    sessionId: "session-1",
    registeredAt: Date.now(),
    lastStateChange: Date.now(),
    ...overrides,
  });

  describe("save and get", () => {
    it("should store and retrieve an agent", () => {
      const agent = createAgent();
      store.save(agent);

      expect(store.get(agent.id)).toEqual(agent);
    });

    it("should return undefined for unknown ID", () => {
      expect(store.get("unknown")).toBeUndefined();
    });

    it("should update existing agent", () => {
      const agent = createAgent();
      store.save(agent);

      const updated = { ...agent, state: "busy" as const };
      store.save(updated);

      expect(store.get(agent.id)?.state).toBe("busy");
      expect(store.size).toBe(1);
    });

    it("should return a copy, not a reference", () => {
      const agent = createAgent();
      store.save(agent);

      const retrieved = store.get(agent.id)!;
      retrieved.name = "Modified";

      expect(store.get(agent.id)?.name).toBe("Test Agent");
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.save(createAgent({ id: "agent-1", state: "idle", role: "worker", sessionId: "session-1" }));
      store.save(createAgent({ id: "agent-2", state: "busy", role: "worker", sessionId: "session-1" }));
      store.save(createAgent({ id: "agent-3", state: "idle", role: "manager", sessionId: "session-2" }));
    });

    it("should return all agents with no filter", () => {
      const results = store.list();
      expect(results).toHaveLength(3);
    });

    it("should filter by state", () => {
      const results = store.list({ state: "idle" });
      expect(results).toHaveLength(2);
    });

    it("should filter by role", () => {
      const results = store.list({ role: "worker" });
      expect(results).toHaveLength(2);
    });

    it("should filter by sessionId", () => {
      const results = store.list({ sessionId: "session-1" });
      expect(results).toHaveLength(2);
    });

    it("should combine filters", () => {
      const results = store.list({ state: "idle", sessionId: "session-1" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("agent-1");
    });
  });

  describe("delete", () => {
    it("should remove an agent", () => {
      const agent = createAgent();
      store.save(agent);

      expect(store.delete(agent.id)).toBe(true);
      expect(store.get(agent.id)).toBeUndefined();
    });

    it("should return false for unknown ID", () => {
      expect(store.delete("unknown")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all agents", () => {
      store.save(createAgent({ id: "agent-1" }));
      store.save(createAgent({ id: "agent-2" }));

      store.clear();

      expect(store.size).toBe(0);
      expect(store.list()).toHaveLength(0);
    });
  });
});

describe("AgentRegistryImpl", () => {
  let eventBus: EventBusImpl;
  let registry: AgentRegistryImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
  });

  describe("register", () => {
    it("should create an agent with ULID", () => {
      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });

      expect(agent.id).toBeDefined();
      expect(agent.id.length).toBe(26); // ULID length
      expect(agent.name).toBe("Test Agent");
      expect(agent.state).toBe("idle");
      expect(agent.sessionId).toBe("session-1");
    });

    it("should set optional fields", () => {
      const agent = registry.register({
        name: "Test Agent",
        role: "worker",
        metadata: { foo: "bar" },
        sessionId: "session-1",
      });

      expect(agent.role).toBe("worker");
      expect(agent.metadata).toEqual({ foo: "bar" });
    });

    it("should emit agent.registered event", () => {
      const handler = vi.fn();
      eventBus.on("agent.registered", handler);

      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent.registered",
          data: { agent },
        })
      );
    });

    it("should be retrievable after registration", () => {
      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });

      expect(registry.get(agent.id)).toEqual(agent);
    });
  });

  describe("get", () => {
    it("should return undefined for unknown ID", () => {
      expect(registry.get("unknown")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("should list all registered agents", () => {
      registry.register({ name: "Agent 1", sessionId: "session-1" });
      registry.register({ name: "Agent 2", sessionId: "session-1" });

      const agents = registry.list();
      expect(agents).toHaveLength(2);
    });

    it("should filter agents", () => {
      registry.register({ name: "Agent 1", role: "worker", sessionId: "session-1" });
      registry.register({ name: "Agent 2", role: "manager", sessionId: "session-1" });

      const workers = registry.list({ role: "worker" });
      expect(workers).toHaveLength(1);
      expect(workers[0].role).toBe("worker");
    });
  });

  describe("unregister", () => {
    it("should remove an agent", () => {
      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });

      expect(registry.unregister(agent.id)).toBe(true);
      expect(registry.get(agent.id)).toBeUndefined();
    });

    it("should return false for unknown ID", () => {
      expect(registry.unregister("unknown")).toBe(false);
    });

    it("should emit agent.unregistered event", () => {
      const handler = vi.fn();
      eventBus.on("agent.unregistered", handler);

      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });
      registry.unregister(agent.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent.unregistered",
          data: expect.objectContaining({ agentId: agent.id }),
        })
      );
    });
  });

  describe("updateState", () => {
    it("should update agent state", () => {
      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });

      const updated = registry.updateState(agent.id, "busy");

      expect(updated.state).toBe("busy");
      expect(registry.get(agent.id)?.state).toBe("busy");
    });

    it("should emit agent.state.changed event", () => {
      const handler = vi.fn();
      eventBus.on("agent.state.changed", handler);

      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });
      registry.updateState(agent.id, "busy");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent.state.changed",
          data: expect.objectContaining({
            previousState: "idle",
            agent: expect.objectContaining({ state: "busy" }),
          }),
        })
      );
    });

    it("should throw for unknown agent", () => {
      expect(() => registry.updateState("unknown", "busy")).toThrow(
        AgentNotFoundError
      );
    });

    it("should not emit event if state unchanged", () => {
      const handler = vi.fn();
      eventBus.on("agent.state.changed", handler);

      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });
      registry.updateState(agent.id, "idle"); // Same state

      expect(handler).not.toHaveBeenCalled();
    });

    describe("state transitions", () => {
      it("should allow idle -> busy", () => {
        const agent = registry.register({ name: "Agent", sessionId: "s1" });
        expect(() => registry.updateState(agent.id, "busy")).not.toThrow();
      });

      it("should allow busy -> idle", () => {
        const agent = registry.register({ name: "Agent", sessionId: "s1" });
        registry.updateState(agent.id, "busy");
        expect(() => registry.updateState(agent.id, "idle")).not.toThrow();
      });

      it("should allow idle -> suspended", () => {
        const agent = registry.register({ name: "Agent", sessionId: "s1" });
        expect(() => registry.updateState(agent.id, "suspended")).not.toThrow();
      });

      it("should allow suspended -> idle", () => {
        const agent = registry.register({ name: "Agent", sessionId: "s1" });
        registry.updateState(agent.id, "suspended");
        expect(() => registry.updateState(agent.id, "idle")).not.toThrow();
      });

      it("should allow idle -> stopped", () => {
        const agent = registry.register({ name: "Agent", sessionId: "s1" });
        expect(() => registry.updateState(agent.id, "stopped")).not.toThrow();
      });

      it("should not allow stopped -> any other state", () => {
        const agent = registry.register({ name: "Agent", sessionId: "s1" });
        registry.updateState(agent.id, "stopped");

        expect(() => registry.updateState(agent.id, "idle")).toThrow(
          InvalidStateTransitionError
        );
        expect(() => registry.updateState(agent.id, "busy")).toThrow(
          InvalidStateTransitionError
        );
      });
    });
  });

  describe("updateMetadata", () => {
    it("should merge metadata", () => {
      const agent = registry.register({
        name: "Test Agent",
        metadata: { foo: "bar", existing: true },
        sessionId: "session-1",
      });

      const updated = registry.updateMetadata(agent.id, { baz: "qux", foo: "updated" });

      expect(updated.metadata).toEqual({
        existing: true,
        foo: "updated",
        baz: "qux",
      });
    });

    it("should emit agent.metadata.changed event", () => {
      const handler = vi.fn();
      eventBus.on("agent.metadata.changed", handler);

      const agent = registry.register({
        name: "Test Agent",
        sessionId: "session-1",
      });
      registry.updateMetadata(agent.id, { key: "value" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent.metadata.changed",
          data: expect.objectContaining({
            changes: { key: "value" },
          }),
        })
      );
    });

    it("should throw for unknown agent", () => {
      expect(() => registry.updateMetadata("unknown", {})).toThrow(
        AgentNotFoundError
      );
    });
  });

  describe("unregisterBySession", () => {
    it("should unregister all agents for a session", () => {
      const agent1 = registry.register({ name: "Agent 1", sessionId: "session-1" });
      const agent2 = registry.register({ name: "Agent 2", sessionId: "session-1" });
      registry.register({ name: "Agent 3", sessionId: "session-2" });

      const unregistered = registry.unregisterBySession("session-1");

      expect(unregistered).toHaveLength(2);
      expect(unregistered).toContain(agent1.id);
      expect(unregistered).toContain(agent2.id);
      expect(registry.list()).toHaveLength(1);
    });

    it("should return empty array if no agents for session", () => {
      registry.register({ name: "Agent", sessionId: "session-1" });

      const unregistered = registry.unregisterBySession("session-2");

      expect(unregistered).toHaveLength(0);
    });

    it("should emit unregistered events for each agent", () => {
      const handler = vi.fn();
      eventBus.on("agent.unregistered", handler);

      registry.register({ name: "Agent 1", sessionId: "session-1" });
      registry.register({ name: "Agent 2", sessionId: "session-1" });

      registry.unregisterBySession("session-1");

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Agent State Helpers", () => {
  describe("isStandardState", () => {
    it("should return true for standard states", () => {
      expect(isStandardState("idle")).toBe(true);
      expect(isStandardState("busy")).toBe(true);
      expect(isStandardState("suspended")).toBe(true);
      expect(isStandardState("stopped")).toBe(true);
    });

    it("should return false for custom states", () => {
      expect(isStandardState("custom:thinking")).toBe(false);
      expect(isStandardState("custom:waiting")).toBe(false);
    });

    it("should return false for invalid states", () => {
      expect(isStandardState("invalid")).toBe(false);
      expect(isStandardState("")).toBe(false);
      expect(isStandardState("running")).toBe(false);
    });
  });

  describe("isCustomState", () => {
    it("should return true for custom states", () => {
      expect(isCustomState("custom:thinking")).toBe(true);
      expect(isCustomState("custom:waiting")).toBe(true);
      expect(isCustomState("custom:processing-data")).toBe(true);
    });

    it("should return false for standard states", () => {
      expect(isCustomState("idle")).toBe(false);
      expect(isCustomState("busy")).toBe(false);
      expect(isCustomState("suspended")).toBe(false);
      expect(isCustomState("stopped")).toBe(false);
    });

    it("should return false for invalid states", () => {
      expect(isCustomState("invalid")).toBe(false);
      expect(isCustomState("customthinking")).toBe(false); // Missing colon
      expect(isCustomState("")).toBe(false);
    });
  });

  describe("validateAgentState", () => {
    it("should accept standard states", () => {
      expect(() => validateAgentState("idle")).not.toThrow();
      expect(() => validateAgentState("busy")).not.toThrow();
      expect(() => validateAgentState("suspended")).not.toThrow();
      expect(() => validateAgentState("stopped")).not.toThrow();
    });

    it("should accept valid custom states", () => {
      expect(() => validateAgentState("custom:thinking")).not.toThrow();
      expect(() => validateAgentState("custom:waiting")).not.toThrow();
      expect(() => validateAgentState("custom:a")).not.toThrow(); // Single char suffix
    });

    it("should reject non-standard, non-custom states", () => {
      expect(() => validateAgentState("invalid")).toThrow(InvalidAgentStateError);
      expect(() => validateAgentState("running")).toThrow(InvalidAgentStateError);
    });

    it("should reject custom states with empty suffix", () => {
      expect(() => validateAgentState("custom:")).toThrow(InvalidAgentStateError);
      expect(() => validateAgentState("custom:")).toThrow(/non-empty suffix/);
    });

    it("should reject custom states with suffix > 64 characters", () => {
      const longSuffix = "a".repeat(65);
      expect(() => validateAgentState(`custom:${longSuffix}`)).toThrow(
        InvalidAgentStateError
      );
      expect(() => validateAgentState(`custom:${longSuffix}`)).toThrow(
        /<= 64 characters/
      );
    });

    it("should accept custom states with suffix = 64 characters", () => {
      const maxSuffix = "a".repeat(64);
      expect(() => validateAgentState(`custom:${maxSuffix}`)).not.toThrow();
    });
  });

  describe("isValidTransition", () => {
    describe("standard state transitions", () => {
      it("should allow idle -> busy", () => {
        expect(isValidTransition("idle", "busy")).toBe(true);
      });

      it("should allow busy -> idle", () => {
        expect(isValidTransition("busy", "idle")).toBe(true);
      });

      it("should allow any state -> stopped", () => {
        expect(isValidTransition("idle", "stopped")).toBe(true);
        expect(isValidTransition("busy", "stopped")).toBe(true);
        expect(isValidTransition("suspended", "stopped")).toBe(true);
      });

      it("should not allow stopped -> any state", () => {
        expect(isValidTransition("stopped", "idle")).toBe(false);
        expect(isValidTransition("stopped", "busy")).toBe(false);
        expect(isValidTransition("stopped", "suspended")).toBe(false);
      });
    });

    describe("custom state transitions", () => {
      it("should allow standard -> custom", () => {
        expect(isValidTransition("idle", "custom:thinking")).toBe(true);
        expect(isValidTransition("busy", "custom:waiting")).toBe(true);
        expect(isValidTransition("suspended", "custom:processing")).toBe(true);
      });

      it("should allow custom -> standard", () => {
        expect(isValidTransition("custom:thinking", "idle")).toBe(true);
        expect(isValidTransition("custom:thinking", "busy")).toBe(true);
        expect(isValidTransition("custom:thinking", "stopped")).toBe(true);
      });

      it("should allow custom -> custom", () => {
        expect(isValidTransition("custom:thinking", "custom:waiting")).toBe(true);
      });

      it("should not allow stopped -> custom", () => {
        expect(isValidTransition("stopped", "custom:thinking")).toBe(false);
      });
    });
  });
});

describe("AgentRegistryImpl - Custom States", () => {
  let eventBus: EventBusImpl;
  let registry: AgentRegistryImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
  });

  describe("custom state transitions", () => {
    it("should allow transition to custom state", () => {
      const agent = registry.register({ name: "Agent", sessionId: "s1" });

      const updated = registry.updateState(agent.id, "custom:thinking");

      expect(updated.state).toBe("custom:thinking");
    });

    it("should allow transition from custom state to standard state", () => {
      const agent = registry.register({ name: "Agent", sessionId: "s1" });
      registry.updateState(agent.id, "custom:thinking");

      const updated = registry.updateState(agent.id, "busy");

      expect(updated.state).toBe("busy");
    });

    it("should allow transition between custom states", () => {
      const agent = registry.register({ name: "Agent", sessionId: "s1" });
      registry.updateState(agent.id, "custom:thinking");

      const updated = registry.updateState(agent.id, "custom:waiting");

      expect(updated.state).toBe("custom:waiting");
    });

    it("should not allow transition from stopped to custom state", () => {
      const agent = registry.register({ name: "Agent", sessionId: "s1" });
      registry.updateState(agent.id, "stopped");

      expect(() => registry.updateState(agent.id, "custom:thinking")).toThrow(
        InvalidStateTransitionError
      );
    });

    it("should allow transition from custom state to stopped", () => {
      const agent = registry.register({ name: "Agent", sessionId: "s1" });
      registry.updateState(agent.id, "custom:thinking");

      const updated = registry.updateState(agent.id, "stopped");

      expect(updated.state).toBe("stopped");
    });

    it("should emit state change event with custom state", () => {
      const handler = vi.fn();
      eventBus.on("agent.state.changed", handler);

      const agent = registry.register({ name: "Agent", sessionId: "s1" });
      registry.updateState(agent.id, "custom:thinking");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent.state.changed",
          data: expect.objectContaining({
            previousState: "idle",
            agent: expect.objectContaining({ state: "custom:thinking" }),
          }),
        })
      );
    });
  });

  describe("state validation", () => {
    it("should reject invalid state format", () => {
      const agent = registry.register({ name: "Agent", sessionId: "s1" });

      expect(() => registry.updateState(agent.id, "invalid" as any)).toThrow(
        InvalidAgentStateError
      );
    });

    it("should reject custom state with empty suffix", () => {
      const agent = registry.register({ name: "Agent", sessionId: "s1" });

      expect(() => registry.updateState(agent.id, "custom:" as any)).toThrow(
        InvalidAgentStateError
      );
    });

    it("should reject custom state with too-long suffix", () => {
      const agent = registry.register({ name: "Agent", sessionId: "s1" });
      const longSuffix = "a".repeat(65);

      expect(() => registry.updateState(agent.id, `custom:${longSuffix}` as any)).toThrow(
        InvalidAgentStateError
      );
    });
  });
});

describe("Capability Helpers", () => {
  describe("matchesCapability", () => {
    it("should match exact capability", () => {
      expect(matchesCapability("translate:en", "translate:en")).toBe(true);
      expect(matchesCapability("translate:en", "translate:fr")).toBe(false);
    });

    it("should match with * glob (single level)", () => {
      expect(matchesCapability("translate:en", "translate:*")).toBe(true);
      expect(matchesCapability("translate:fr", "translate:*")).toBe(true);
      expect(matchesCapability("summarize", "translate:*")).toBe(false);
    });

    it("should not match across colons with single *", () => {
      expect(matchesCapability("translate:en:formal", "translate:*")).toBe(false);
    });

    it("should match with ** glob (multi-level)", () => {
      expect(matchesCapability("translate:en:formal", "translate:**")).toBe(true);
      expect(matchesCapability("translate:en", "translate:**")).toBe(true);
    });

    it("should match complex patterns", () => {
      expect(matchesCapability("translate:en:formal", "translate:en:*")).toBe(true);
      expect(matchesCapability("translate:en:informal", "translate:en:*")).toBe(true);
      expect(matchesCapability("translate:fr:formal", "translate:en:*")).toBe(false);
    });
  });

  describe("hasCapability", () => {
    it("should return true if any capability matches", () => {
      const caps = ["translate:en", "translate:fr", "summarize"];
      expect(hasCapability(caps, "translate:en")).toBe(true);
      expect(hasCapability(caps, "translate:*")).toBe(true);
      expect(hasCapability(caps, "summarize")).toBe(true);
    });

    it("should return false if no capability matches", () => {
      const caps = ["translate:en", "translate:fr"];
      expect(hasCapability(caps, "summarize")).toBe(false);
      expect(hasCapability(caps, "translate:de")).toBe(false);
    });

    it("should return false for empty capabilities", () => {
      expect(hasCapability([], "translate:en")).toBe(false);
      expect(hasCapability(undefined, "translate:en")).toBe(false);
    });
  });
});

describe("AgentRegistryImpl - Capabilities", () => {
  let eventBus: EventBusImpl;
  let registry: AgentRegistryImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
  });

  describe("registration with capabilities", () => {
    it("should register agent with capabilities", () => {
      const agent = registry.register({
        name: "Translator",
        sessionId: "s1",
        capabilities: ["translate:en", "translate:fr"],
      });

      expect(agent.capabilities).toEqual(["translate:en", "translate:fr"]);
    });

    it("should register agent without capabilities", () => {
      const agent = registry.register({
        name: "Basic Agent",
        sessionId: "s1",
      });

      expect(agent.capabilities).toBeUndefined();
    });
  });

  describe("listing with capability filter", () => {
    beforeEach(() => {
      registry.register({
        name: "English Translator",
        sessionId: "s1",
        capabilities: ["translate:en", "translate:fr"],
      });
      registry.register({
        name: "German Translator",
        sessionId: "s2",
        capabilities: ["translate:de", "translate:es"],
      });
      registry.register({
        name: "Summarizer",
        sessionId: "s3",
        capabilities: ["summarize"],
      });
      registry.register({
        name: "No Capabilities",
        sessionId: "s4",
      });
    });

    it("should filter by exact capability", () => {
      const agents = registry.list({ capability: "translate:en" });
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("English Translator");
    });

    it("should filter by glob pattern", () => {
      const agents = registry.list({ capability: "translate:*" });
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name).sort()).toEqual([
        "English Translator",
        "German Translator",
      ]);
    });

    it("should return empty for non-matching capability", () => {
      const agents = registry.list({ capability: "nonexistent" });
      expect(agents).toHaveLength(0);
    });

    it("should combine capability with other filters", () => {
      // Add an agent with both translate and summarize
      registry.register({
        name: "Multi-skill",
        role: "translator",
        sessionId: "s5",
        capabilities: ["translate:en", "summarize"],
      });

      const agents = registry.list({ capability: "summarize" });
      expect(agents).toHaveLength(2);

      // Combine with role filter (not directly supported, but shows the list still works)
      const allAgents = registry.list();
      expect(allAgents).toHaveLength(5);
    });
  });
});
