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

    it("should track pausedAt timestamp when paused", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      const beforePause = Date.now();
      manager.pause(subscription.id);
      const afterPause = Date.now();

      const pausedSub = manager.get(subscription.id);
      expect(pausedSub?.pausedAt).toBeDefined();
      expect(pausedSub?.pausedAt).toBeGreaterThanOrEqual(beforePause);
      expect(pausedSub?.pausedAt).toBeLessThanOrEqual(afterPause);
    });

    it("should clear pausedAt timestamp when resumed", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      manager.pause(subscription.id);
      expect(manager.get(subscription.id)?.pausedAt).toBeDefined();

      manager.resume(subscription.id);
      expect(manager.get(subscription.id)?.pausedAt).toBeUndefined();
    });

    it("should not update pausedAt if already paused", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      manager.pause(subscription.id);
      const firstPausedAt = manager.get(subscription.id)?.pausedAt;

      // Pause again - should not change pausedAt
      manager.pause(subscription.id);
      const secondPausedAt = manager.get(subscription.id)?.pausedAt;

      expect(secondPausedAt).toBe(firstPausedAt);
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

  describe("lastEventId tracking", () => {
    it("should automatically track lastEventId when events are delivered", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["test.event"] },
      });

      // Initially no lastEventId
      expect(manager.getLastEventId(subscription.id)).toBeUndefined();

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit and consume an event
      const emitted = eventBus.emit({ type: "test.event", data: { value: 1 } });
      await iterator.next();

      // lastEventId should now be set to the delivered event's ID
      expect(manager.getLastEventId(subscription.id)).toBe(emitted.id);
    });

    it("should update lastEventId with each delivered event", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit and consume first event
      const event1 = eventBus.emit({ type: "event.1", data: {} });
      await iterator.next();
      expect(manager.getLastEventId(subscription.id)).toBe(event1.id);

      // Emit and consume second event
      const event2 = eventBus.emit({ type: "event.2", data: {} });
      await iterator.next();
      expect(manager.getLastEventId(subscription.id)).toBe(event2.id);

      // Emit and consume third event
      const event3 = eventBus.emit({ type: "event.3", data: {} });
      await iterator.next();
      expect(manager.getLastEventId(subscription.id)).toBe(event3.id);
    });

    it("should return undefined for unknown subscription", () => {
      expect(manager.getLastEventId("unknown-subscription")).toBeUndefined();
    });

    it("should preserve lastEventId set via startAfter", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
        startAfter: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
      });

      expect(manager.getLastEventId(subscription.id)).toBe(
        "01HQJY3KCNP5VXWZ8M4R6T2G9A"
      );
    });

    it("should not update lastEventId for non-matching events", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["type.a"] },
      });

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit matching event
      const matchingEvent = eventBus.emit({ type: "type.a", data: {} });
      await iterator.next();
      expect(manager.getLastEventId(subscription.id)).toBe(matchingEvent.id);

      // Emit non-matching event (won't be delivered)
      eventBus.emit({ type: "type.b", data: {} });

      // lastEventId should still be the matching event
      expect(manager.getLastEventId(subscription.id)).toBe(matchingEvent.id);
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

    it("should handle causedBy as array (multiple causes)", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      const stream = manager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit causes A and B first
      const eventA = eventBus.emit({ type: "cause-a", data: {} });
      const eventB = eventBus.emit({ type: "cause-b", data: {} });

      // Then emit C which depends on both A and B
      eventBus.emit({
        type: "effect",
        data: {},
        causedBy: [eventA.id, eventB.id], // Array syntax
      });

      // Events should arrive in order: A, B, C
      const result1 = await iterator.next();
      expect(result1.value.type).toBe("cause-a");

      const result2 = await iterator.next();
      expect(result2.value.type).toBe("cause-b");

      const result3 = await iterator.next();
      expect(result3.value.type).toBe("effect");
    });
  });

  describe("multi-cause mode configuration", () => {
    it("should wait for all causes by default (multiCauseMode: all)", async () => {
      const allModeManager = new SubscriptionManagerImpl({
        eventBus,
        causalOrdering: { multiCauseMode: "all" },
      });

      const subscription = allModeManager.create({
        sessionId: "session-1",
        filter: {},
      });

      const stream = allModeManager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit causes A and B first so we know their IDs
      const eventA = eventBus.emit({ type: "cause-a", data: {} });
      const eventB = eventBus.emit({ type: "cause-b", data: {} });

      // Emit C which depends on both A and B
      eventBus.emit({
        type: "effect",
        data: {},
        causedBy: [eventA.id, eventB.id],
      });

      // All three should be delivered in order (causes first, then effect)
      const result1 = await iterator.next();
      expect(result1.value.type).toBe("cause-a");

      const result2 = await iterator.next();
      expect(result2.value.type).toBe("cause-b");

      const result3 = await iterator.next();
      expect(result3.value.type).toBe("effect");
    });

    it("should release on first cause with multiCauseMode: any", async () => {
      const anyModeManager = new SubscriptionManagerImpl({
        eventBus,
        causalOrdering: { multiCauseMode: "any" },
      });

      const subscription = anyModeManager.create({
        sessionId: "session-1",
        filter: {},
      });

      const stream = anyModeManager.getEventStream(subscription.id);
      const iterator = stream[Symbol.asyncIterator]();

      // Emit cause A first
      const eventA = eventBus.emit({ type: "cause-a", data: {} });

      // Emit C which depends on both A and B (B doesn't exist yet)
      // In "any" mode, this should be released immediately since A exists
      eventBus.emit({
        type: "effect",
        data: {},
        causedBy: [eventA.id, "nonexistent-b"],
      });

      // First should be A
      const result1 = await iterator.next();
      expect(result1.value.type).toBe("cause-a");

      // Second should be the effect (released because A was seen in "any" mode)
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

  describe("match modes and logical operators", () => {
    describe("match: 'any' mode", () => {
      it("should match if any criterion matches", () => {
        const subscription = manager.create({
          sessionId: "session-1",
          filter: {
            eventTypes: ["type.a"],
            agents: ["agent-1"],
            match: "any",
          },
        });

        // Event with matching type but no agent
        const event1: MAPEvent = {
          id: "event-1",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
        };
        expect(manager.match(event1)).toContain(subscription.id);

        // Event with matching agent but wrong type
        const event2: MAPEvent = {
          id: "event-2",
          type: "type.b",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-1" },
        };
        expect(manager.match(event2)).toContain(subscription.id);
      });

      it("should not match if no criterion matches", () => {
        const subscription = manager.create({
          sessionId: "session-1",
          filter: {
            eventTypes: ["type.a"],
            agents: ["agent-1"],
            match: "any",
          },
        });

        const event: MAPEvent = {
          id: "event-1",
          type: "type.b",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-2" },
        };
        expect(manager.match(event)).not.toContain(subscription.id);
      });
    });

    describe("match: 'all' mode (default)", () => {
      it("should require all criteria to match", () => {
        const subscription = manager.create({
          sessionId: "session-1",
          filter: {
            eventTypes: ["type.a"],
            agents: ["agent-1"],
            match: "all", // Explicit, but also default
          },
        });

        // Only type matches - should NOT match
        const event1: MAPEvent = {
          id: "event-1",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-2" },
        };
        expect(manager.match(event1)).not.toContain(subscription.id);

        // Both match - should match
        const event2: MAPEvent = {
          id: "event-2",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-1" },
        };
        expect(manager.match(event2)).toContain(subscription.id);
      });

      it("should be the default behavior", () => {
        const subscription = manager.create({
          sessionId: "session-1",
          filter: {
            eventTypes: ["type.a"],
            agents: ["agent-1"],
            // No match mode specified - defaults to "all"
          },
        });

        // Only type matches - should NOT match
        const event: MAPEvent = {
          id: "event-1",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-2" },
        };
        expect(manager.match(event)).not.toContain(subscription.id);
      });
    });

    describe("$or operator", () => {
      it("should match if any sub-filter matches", () => {
        const subscription = manager.create({
          sessionId: "session-1",
          filter: {
            $or: [
              { eventTypes: ["type.a"] },
              { eventTypes: ["type.b"] },
            ],
          },
        });

        const eventA: MAPEvent = {
          id: "event-a",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
        };
        expect(manager.match(eventA)).toContain(subscription.id);

        const eventB: MAPEvent = {
          id: "event-b",
          type: "type.b",
          timestamp: Date.now(),
          data: {},
        };
        expect(manager.match(eventB)).toContain(subscription.id);

        const eventC: MAPEvent = {
          id: "event-c",
          type: "type.c",
          timestamp: Date.now(),
          data: {},
        };
        expect(manager.match(eventC)).not.toContain(subscription.id);
      });

      it("should support complex $or conditions", () => {
        const subscription = manager.create({
          sessionId: "session-1",
          filter: {
            $or: [
              { eventTypes: ["type.a"], agents: ["agent-1"] },
              { eventTypes: ["type.b"], agents: ["agent-2"] },
            ],
          },
        });

        // type.a from agent-1 - matches first condition
        const event1: MAPEvent = {
          id: "event-1",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-1" },
        };
        expect(manager.match(event1)).toContain(subscription.id);

        // type.b from agent-2 - matches second condition
        const event2: MAPEvent = {
          id: "event-2",
          type: "type.b",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-2" },
        };
        expect(manager.match(event2)).toContain(subscription.id);

        // type.a from agent-2 - matches neither
        const event3: MAPEvent = {
          id: "event-3",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-2" },
        };
        expect(manager.match(event3)).not.toContain(subscription.id);
      });
    });

    describe("$and operator", () => {
      it("should match only if all sub-filters match", () => {
        const subscription = manager.create({
          sessionId: "session-1",
          filter: {
            $and: [
              { eventTypes: ["type.a"] },
              { agents: ["agent-1"] },
            ],
          },
        });

        // Both match
        const event1: MAPEvent = {
          id: "event-1",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-1" },
        };
        expect(manager.match(event1)).toContain(subscription.id);

        // Only type matches
        const event2: MAPEvent = {
          id: "event-2",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-2" },
        };
        expect(manager.match(event2)).not.toContain(subscription.id);

        // Only agent matches
        const event3: MAPEvent = {
          id: "event-3",
          type: "type.b",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-1" },
        };
        expect(manager.match(event3)).not.toContain(subscription.id);
      });
    });

    describe("nested operators", () => {
      it("should support nested $or and $and", () => {
        const subscription = manager.create({
          sessionId: "session-1",
          filter: {
            $or: [
              {
                $and: [
                  { eventTypes: ["type.a"] },
                  { agents: ["agent-1"] },
                ],
              },
              { eventTypes: ["type.urgent"] },
            ],
          },
        });

        // type.a from agent-1 - matches first $and
        const event1: MAPEvent = {
          id: "event-1",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-1" },
        };
        expect(manager.match(event1)).toContain(subscription.id);

        // type.urgent from any agent - matches second $or branch
        const event2: MAPEvent = {
          id: "event-2",
          type: "type.urgent",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-99" },
        };
        expect(manager.match(event2)).toContain(subscription.id);

        // type.a from agent-2 - doesn't match
        const event3: MAPEvent = {
          id: "event-3",
          type: "type.a",
          timestamp: Date.now(),
          data: {},
          source: { agentId: "agent-2" },
        };
        expect(manager.match(event3)).not.toContain(subscription.id);
      });
    });
  });

  describe("event replay", () => {
    it("should replay events since lastEventId", async () => {
      // Create a fresh manager for this test to avoid interference
      const testEventBus = new EventBusImpl();
      const testManager = new SubscriptionManagerImpl({ eventBus: testEventBus });

      // Emit some events first
      const event1 = testEventBus.emit({ type: "event.1", data: {} });
      const event2 = testEventBus.emit({ type: "event.2", data: {} });
      const event3 = testEventBus.emit({ type: "event.3", data: {} });

      // Create subscription starting after event1
      const subscription = testManager.create({
        sessionId: "session-1",
        filter: {},
        startAfter: event1.id,
      });

      // Replay should get event2 and event3 (after event1)
      const replayed = testManager.replayEvents(subscription.id);

      expect(replayed).toHaveLength(2);
      expect(replayed[0].id).toBe(event2.id);
      expect(replayed[1].id).toBe(event3.id);
    });

    it("should respect maxReplayCount option", async () => {
      // Create a fresh manager for this test to avoid interference
      const testEventBus = new EventBusImpl();
      const testManager = new SubscriptionManagerImpl({ eventBus: testEventBus });

      // Emit 5 events
      const events: MAPEvent[] = [];
      for (let i = 0; i < 5; i++) {
        events.push(testEventBus.emit({ type: `event.${i}`, data: {} }));
      }

      // Create subscription with startAfter set to first event
      const subscription = testManager.create({
        sessionId: "session-1",
        filter: {},
        startAfter: events[0].id,
      });

      // Replay with maxReplayCount of 2 - should get events[1] and events[2]
      const replayed = testManager.replayEvents(subscription.id, { maxReplayCount: 2 });

      expect(replayed).toHaveLength(2);
      expect(replayed[0].id).toBe(events[1].id);
      expect(replayed[1].id).toBe(events[2].id);
    });

    it("should respect maxReplayAgeMs option", async () => {
      // Create an old event by manipulating the store directly
      const oldEvent: MAPEvent = {
        id: "old-event",
        type: "old.event",
        timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
        data: {},
      };
      eventBus.store.append(oldEvent);

      // Create a recent event
      const recentEvent = eventBus.emit({ type: "recent.event", data: {} });

      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      // Replay with 5 minute max age - should only get recent event
      const replayed = manager.replayEvents(subscription.id, {
        maxReplayAgeMs: 5 * 60 * 1000,
      });

      expect(replayed.some((e) => e.id === recentEvent.id)).toBe(true);
      expect(replayed.some((e) => e.id === oldEvent.id)).toBe(false);
    });

    it("should apply subscription filter when applyFilter is true", async () => {
      eventBus.emit({ type: "type.a", data: {} });
      const eventB = eventBus.emit({ type: "type.b", data: {} });
      eventBus.emit({ type: "type.a", data: {} });

      const subscription = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["type.b"] },
      });

      const replayed = manager.replayEvents(subscription.id, { applyFilter: true });

      // Should only get type.b events
      expect(replayed).toHaveLength(1);
      expect(replayed[0].id).toBe(eventB.id);
    });

    it("should replay all events when applyFilter is false", async () => {
      const event1 = eventBus.emit({ type: "type.a", data: {} });
      const event2 = eventBus.emit({ type: "type.b", data: {} });
      const event3 = eventBus.emit({ type: "type.a", data: {} });

      const subscription = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["type.b"] }, // Filter only type.b
      });

      const replayed = manager.replayEvents(subscription.id, { applyFilter: false });

      // Should get all events since filter is not applied
      expect(replayed).toHaveLength(3);
      expect(replayed[0].id).toBe(event1.id);
      expect(replayed[1].id).toBe(event2.id);
      expect(replayed[2].id).toBe(event3.id);
    });

    it("should emit replay started and completed events", async () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {},
      });

      eventBus.emit({ type: "test.event", data: {} });

      const emittedEvents: MAPEvent[] = [];
      eventBus.on("subscription.replay.*", (event) => {
        emittedEvents.push(event);
      });

      manager.replayEvents(subscription.id);

      // Should have both started and completed events
      expect(emittedEvents.some((e) => e.type === "subscription.replay.started")).toBe(
        true
      );
      expect(emittedEvents.some((e) => e.type === "subscription.replay.completed")).toBe(
        true
      );
    });

    it("should return empty array for unknown subscription", () => {
      const replayed = manager.replayEvents("unknown-subscription");
      expect(replayed).toHaveLength(0);
    });
  });

  describe("replaySessionEvents", () => {
    it("should replay events to all subscriptions for a session", async () => {
      // Emit events
      const event1 = eventBus.emit({ type: "type.a", data: {} });
      const event2 = eventBus.emit({ type: "type.b", data: {} });

      // Create two subscriptions for the same session with different filters
      const sub1 = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["type.a"] },
      });
      const sub2 = manager.create({
        sessionId: "session-1",
        filter: { eventTypes: ["type.b"] },
      });

      // Also create subscription for different session
      manager.create({
        sessionId: "session-2",
        filter: {},
      });

      const results = manager.replaySessionEvents("session-1");

      expect(results.size).toBe(2);
      expect(results.get(sub1.id)).toHaveLength(1);
      expect(results.get(sub1.id)?.[0].id).toBe(event1.id);
      expect(results.get(sub2.id)).toHaveLength(1);
      expect(results.get(sub2.id)?.[0].id).toBe(event2.id);
    });

    it("should return empty map for session with no subscriptions", () => {
      const results = manager.replaySessionEvents("no-subscriptions-session");
      expect(results.size).toBe(0);
    });
  });

  describe("messageTypes filter", () => {
    it("should match by messageType in event data", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {
          messageTypes: ["request", "response"],
        },
      });

      const requestEvent: MAPEvent = {
        id: "event-1",
        type: "message.sent",
        timestamp: Date.now(),
        data: { messageType: "request", payload: {} },
      };
      expect(manager.match(requestEvent)).toContain(subscription.id);

      const responseEvent: MAPEvent = {
        id: "event-2",
        type: "message.sent",
        timestamp: Date.now(),
        data: { messageType: "response", payload: {} },
      };
      expect(manager.match(responseEvent)).toContain(subscription.id);

      const otherEvent: MAPEvent = {
        id: "event-3",
        type: "message.sent",
        timestamp: Date.now(),
        data: { messageType: "notification", payload: {} },
      };
      expect(manager.match(otherEvent)).not.toContain(subscription.id);
    });

    it("should match by messageType in nested message object", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {
          messageTypes: ["command"],
        },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "message.delivered",
        timestamp: Date.now(),
        data: { message: { messageType: "command", to: "agent-1" } },
      };
      expect(manager.match(event)).toContain(subscription.id);
    });

    it("should not match events without messageType", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {
          messageTypes: ["request"],
        },
      });

      const event: MAPEvent = {
        id: "event-1",
        type: "agent.registered",
        timestamp: Date.now(),
        data: { agent: { name: "Test" } },
      };
      expect(manager.match(event)).not.toContain(subscription.id);
    });

    it("should combine messageTypes with other filters", () => {
      const subscription = manager.create({
        sessionId: "session-1",
        filter: {
          eventTypes: ["message.sent"],
          messageTypes: ["request"],
          match: "all",
        },
      });

      // Both match
      const event1: MAPEvent = {
        id: "event-1",
        type: "message.sent",
        timestamp: Date.now(),
        data: { messageType: "request" },
      };
      expect(manager.match(event1)).toContain(subscription.id);

      // Wrong event type
      const event2: MAPEvent = {
        id: "event-2",
        type: "message.received",
        timestamp: Date.now(),
        data: { messageType: "request" },
      };
      expect(manager.match(event2)).not.toContain(subscription.id);

      // Wrong message type
      const event3: MAPEvent = {
        id: "event-3",
        type: "message.sent",
        timestamp: Date.now(),
        data: { messageType: "response" },
      };
      expect(manager.match(event3)).not.toContain(subscription.id);
    });
  });
});
