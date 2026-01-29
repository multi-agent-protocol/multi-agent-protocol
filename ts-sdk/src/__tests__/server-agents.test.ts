/**
 * Tests for server AgentRegistry and InMemoryAgentStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemoryAgentStore,
  AgentRegistryImpl,
  AgentNotFoundError,
  InvalidStateTransitionError,
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
