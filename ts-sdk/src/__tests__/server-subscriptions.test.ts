/**
 * Tests for server SubscriptionManager
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemorySubscriptionStore,
  SubscriptionManagerImpl,
  type ServerSubscription,
} from "../server/subscriptions";
import { EventBusImpl, type MAPEvent } from "../server/events";
import { ScopeManagerImpl } from "../server/scopes";

describe("InMemorySubscriptionStore", () => {
  let store: InMemorySubscriptionStore;

  beforeEach(() => {
    store = new InMemorySubscriptionStore();
  });

  const createSubscription = (
    overrides: Partial<ServerSubscription> = {}
  ): ServerSubscription => ({
    id: "sub-1",
    sessionId: "session-1",
    filter: {},
    createdAt: Date.now(),
    paused: false,
    ...overrides,
  });

  describe("save and get", () => {
    it("should store and retrieve a subscription", () => {
      const subscription = createSubscription();
      store.save(subscription);

      expect(store.get(subscription.id)).toEqual(subscription);
    });

    it("should return undefined for unknown ID", () => {
      expect(store.get("unknown")).toBeUndefined();
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.save(createSubscription({ id: "sub-1", sessionId: "session-1" }));
      store.save(createSubscription({ id: "sub-2", sessionId: "session-1" }));
      store.save(createSubscription({ id: "sub-3", sessionId: "session-2" }));
    });

    it("should return all subscriptions with no filter", () => {
      expect(store.list()).toHaveLength(3);
    });

    it("should filter by sessionId", () => {
      const subs = store.list({ sessionId: "session-1" });
      expect(subs).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("should remove a subscription", () => {
      const subscription = createSubscription();
      store.save(subscription);

      expect(store.delete(subscription.id)).toBe(true);
      expect(store.get(subscription.id)).toBeUndefined();
    });
  });
});

describe("SubscriptionManagerImpl", () => {
  let eventBus: EventBusImpl;
  let manager: SubscriptionManagerImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    manager = new SubscriptionManagerImpl({ eventBus });
  });

  describe("create", () => {
    it("should create subscription with ULID", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["test.event"] },
      });

      expect(subscription.id).toBeDefined();
      expect(subscription.id.length).toBe(26);
      expect(subscription.sessionId).toBe("session-1");
      expect(subscription.filter.eventTypes).toEqual(["test.event"]);
      expect(subscription.paused).toBe(false);
    });

    it("should set startAfter as lastEventId", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
        startAfter: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
      });

      expect(subscription.lastEventId).toBe("01HQJY3KCNP5VXWZ8M4R6T2G9A");
    });
  });

  describe("cancel", () => {
    it("should cancel subscription", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      expect(manager.cancel(subscription.id)).toBe(true);
      expect(manager.get(subscription.id)).toBeUndefined();
    });

    it("should return false for unknown subscription", () => {
      expect(manager.cancel("unknown")).toBe(false);
    });
  });

  describe("cancelBySession", () => {
    it("should cancel all subscriptions for session", () => {
      const sub1 = manager.create({ sessionId: "session-1", filter: {} });
      const sub2 = manager.create({ sessionId: "session-1", filter: {} });
      manager.create({ sessionId: "session-2", filter: {} });

      const cancelled = manager.cancelBySession("session-1");

      expect(cancelled).toHaveLength(2);
      expect(cancelled).toContain(sub1.id);
      expect(cancelled).toContain(sub2.id);
    });
  });

  describe("pause and resume", () => {
    it("should pause delivery", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      manager.pause(subscription.id);

      expect(manager.get(subscription.id)?.paused).toBe(true);
    });

    it("should resume delivery", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      manager.pause(subscription.id);
      manager.resume(subscription.id);

      expect(manager.get(subscription.id)?.paused).toBe(false);
    });
  });

  describe("acknowledge", () => {
    it("should update lastEventId", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      manager.acknowledge(subscription.id, "01HQJY3KCNP5VXWZ8M4R6T2G9B");

      expect(manager.get(subscription.id)?.lastEventId).toBe(
        "01HQJY3KCNP5VXWZ8M4R6T2G9B"
      );
    });
  });

  describe("match", () => {
    it("should match subscription with no filter", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "test.event",
        timestamp: Date.now(),
        data: {},
      };

      expect(manager.match(event)).toContain(subscription.id);
    });

    it("should match by event type", () => {
      const sub1 = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["type.a"] },
      });
      const sub2 = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["type.b"] },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "type.a",
        timestamp: Date.now(),
        data: {},
      };

      const matches = manager.match(event);
      expect(matches).toContain(sub1.id);
      expect(matches).not.toContain(sub2.id);
    });

    it("should match by event type prefix", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["agent.*"] },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "agent.registered",
        timestamp: Date.now(),
        data: {},
      };

      expect(manager.match(event)).toContain(subscription.id);
    });

    it("should match by agent", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: { agents: ["agent-1"] },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "test",
        timestamp: Date.now(),
        data: {},
        source: { agentId: "agent-1" },
      };

      expect(manager.match(event)).toContain(subscription.id);
    });

    it("should not match if agent not in filter", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: { agents: ["agent-1"] },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "test",
        timestamp: Date.now(),
        data: {},
        source: { agentId: "agent-2" },
      };

      expect(manager.match(event)).not.toContain(subscription.id);
    });
  });

  describe("getEventStream", () => {
    it("should return async iterable", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      const stream = manager.getEventStream(subscription.id);
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });

    it("should receive events matching filter", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["test.event"] },
      });

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit event
      const emitted = eventBus.emit({ type: "test.event", data: { foo: "bar" } });

      // Get event from stream
      const result = await iterator.next();

      expect(result.done).toBe(false);
      expect(result.value.id).toBe(emitted.id);
      expect(result.value.type).toBe("test.event");
    });

    it("should not receive events that don't match filter", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["type.a"] },
      });

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit non-matching event
      eventBus.emit({ type: "type.b", data: {} });

      // Emit matching event
      const emitted = eventBus.emit({ type: "type.a", data: {} });

      const result = await iterator.next();
      expect(result.value.id).toBe(emitted.id);
    });

    it("should not receive events when paused", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      manager.pause(subscription.id);

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit event while paused
      eventBus.emit({ type: "test.event", data: {} });

      // Emit event after resume
      manager.resume(subscription.id);
      const emitted = eventBus.emit({ type: "test.event", data: {} });

      const result = await iterator.next();
      expect(result.value.id).toBe(emitted.id);
    });

    it("should return done when cancelled", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Cancel subscription
      manager.cancel(subscription.id);

      const result = await iterator.next();
      expect(result.done).toBe(true);
    });

    it("should return empty iterable for unknown subscription", async () => {
      const stream = manager.getEventStream("unknown");
      const iterator = stream[Symbol.asyncIterator]();

      const result = await iterator.next();
      expect(result.done).toBe(true);
    });
  });

  describe("causal ordering", () => {
    it("should deliver events without causal dependencies immediately", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit event without dependencies
      const emitted = eventBus.emit({ type: "test", data: {} });

      const result = await iterator.next();
      expect(result.value.id).toBe(emitted.id);
    });

    it("should deliver dependent events after their dependencies", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // First emit A (the cause)
      const eventA = eventBus.emit({ type: "cause", data: {} });

      // Then emit B which depends on A
      const eventB = eventBus.emit({
        type: "effect",
        data: {},
        causedBy: eventA.id,
      });

      // First event should be A
      const result1 = await iterator.next();
      expect(result1.value.type).toBe("cause");

      // Second should be B
      const result2 = await iterator.next();
      expect(result2.value.type).toBe("effect");
    });
  });

  describe("scope matching with nested scopes", () => {
    let scopeManager: ScopeManagerImpl;
    let managerWithScopes: SubscriptionManagerImpl;

    beforeEach(() => {
      scopeManager = new ScopeManagerImpl({ eventBus });
      managerWithScopes = new SubscriptionManagerImpl({
        eventBus,
        scopes: scopeManager,
      });
    });

    it("should match events from nested scopes", () => {
      const parent = scopeManager.create({ name: "Parent" });
      const child = scopeManager.create({ name: "Child", parentId: parent.id });

      const subscription = managerWithScopes.create({
        sessionId: "session-1",
        filter: { scopes: [parent.id] },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "test",
        timestamp: Date.now(),
        data: {},
        source: { scopeId: child.id },
      };

      expect(managerWithScopes.match(event)).toContain(subscription.id);
    });

    it("should match events from direct scope", () => {
      const scope = scopeManager.create({ name: "Scope" });

      const subscription = managerWithScopes.create({
        sessionId: "session-1",
        filter: { scopes: [scope.id] },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "test",
        timestamp: Date.now(),
        data: {},
        source: { scopeId: scope.id },
      };

      expect(managerWithScopes.match(event)).toContain(subscription.id);
    });

    it("should not match events from unrelated scopes", () => {
      const scope1 = scopeManager.create({ name: "Scope 1" });
      const scope2 = scopeManager.create({ name: "Scope 2" });

      const subscription = managerWithScopes.create({
        sessionId: "session-1",
        filter: { scopes: [scope1.id] },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "test",
        timestamp: Date.now(),
        data: {},
        source: { scopeId: scope2.id },
      };

      expect(managerWithScopes.match(event)).not.toContain(subscription.id);
    });
  });
});
