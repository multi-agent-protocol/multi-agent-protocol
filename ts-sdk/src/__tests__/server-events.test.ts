/**
 * Tests for server EventBus and InMemoryEventStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemoryEventStore,
  EventBusImpl,
  type MAPEvent,
} from "../server/events";

describe("InMemoryEventStore", () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  describe("append", () => {
    it("should store an event", () => {
      const event: MAPEvent = {
        id: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
        type: "test.event",
        timestamp: Date.now(),
        data: { foo: "bar" },
      };

      store.append(event);

      expect(store.getById(event.id)).toEqual(event);
      expect(store.size).toBe(1);
    });

    it("should not duplicate events with same ID", () => {
      const event: MAPEvent = {
        id: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
        type: "test.event",
        timestamp: Date.now(),
        data: { foo: "bar" },
      };

      store.append(event);
      store.append(event);

      expect(store.size).toBe(1);
    });

    it("should evict oldest events when max size exceeded", () => {
      const smallStore = new InMemoryEventStore({ maxSize: 3 });

      for (let i = 0; i < 5; i++) {
        smallStore.append({
          id: `01HQJY3KCNP5VXWZ8M4R6T2G9${String.fromCharCode(65 + i)}`,
          type: "test.event",
          timestamp: Date.now() + i,
          data: { index: i },
        });
      }

      expect(smallStore.size).toBe(3);
      // First two events should be evicted
      expect(smallStore.getById("01HQJY3KCNP5VXWZ8M4R6T2G9A")).toBeUndefined();
      expect(smallStore.getById("01HQJY3KCNP5VXWZ8M4R6T2G9B")).toBeUndefined();
      // Last three should exist
      expect(smallStore.getById("01HQJY3KCNP5VXWZ8M4R6T2G9C")).toBeDefined();
      expect(smallStore.getById("01HQJY3KCNP5VXWZ8M4R6T2G9D")).toBeDefined();
      expect(smallStore.getById("01HQJY3KCNP5VXWZ8M4R6T2G9E")).toBeDefined();
    });
  });

  describe("query", () => {
    beforeEach(() => {
      // Add events with different types
      store.append({
        id: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
        type: "agent.registered",
        timestamp: 1000,
        data: {},
      });
      store.append({
        id: "01HQJY3KCNP5VXWZ8M4R6T2G9B",
        type: "agent.state.changed",
        timestamp: 2000,
        data: {},
      });
      store.append({
        id: "01HQJY3KCNP5VXWZ8M4R6T2G9C",
        type: "scope.created",
        timestamp: 3000,
        data: {},
      });
    });

    it("should return all events with empty filter", () => {
      const results = store.query({});
      expect(results).toHaveLength(3);
    });

    it("should filter by types", () => {
      const results = store.query({ types: ["agent.registered"] });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("agent.registered");
    });

    it("should filter by multiple types", () => {
      const results = store.query({
        types: ["agent.registered", "scope.created"],
      });
      expect(results).toHaveLength(2);
    });

    it("should filter by since (exclusive)", () => {
      const results = store.query({ since: "01HQJY3KCNP5VXWZ8M4R6T2G9A" });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("01HQJY3KCNP5VXWZ8M4R6T2G9B");
    });

    it("should filter by until (inclusive)", () => {
      const results = store.query({ until: "01HQJY3KCNP5VXWZ8M4R6T2G9B" });
      expect(results).toHaveLength(2);
      expect(results[1].id).toBe("01HQJY3KCNP5VXWZ8M4R6T2G9B");
    });

    it("should respect limit", () => {
      const results = store.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("should combine filters", () => {
      const results = store.query({
        types: ["agent.registered", "agent.state.changed"],
        since: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
        limit: 1,
      });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("agent.state.changed");
    });
  });

  describe("getById", () => {
    it("should return event by ID", () => {
      const event: MAPEvent = {
        id: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
        type: "test.event",
        timestamp: Date.now(),
        data: {},
      };
      store.append(event);

      expect(store.getById(event.id)).toEqual(event);
    });

    it("should return undefined for unknown ID", () => {
      expect(store.getById("unknown")).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("should remove all events", () => {
      store.append({
        id: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
        type: "test",
        timestamp: Date.now(),
        data: {},
      });
      store.append({
        id: "01HQJY3KCNP5VXWZ8M4R6T2G9B",
        type: "test",
        timestamp: Date.now(),
        data: {},
      });

      store.clear();

      expect(store.size).toBe(0);
      expect(store.query({})).toHaveLength(0);
    });
  });
});

describe("EventBusImpl", () => {
  let bus: EventBusImpl;

  beforeEach(() => {
    bus = new EventBusImpl();
  });

  describe("emit", () => {
    it("should assign ID and timestamp to event", () => {
      const emitted = bus.emit({
        type: "test.event",
        data: { foo: "bar" },
      });

      expect(emitted.id).toBeDefined();
      expect(emitted.id.length).toBe(26); // ULID length
      expect(emitted.timestamp).toBeDefined();
      expect(typeof emitted.timestamp).toBe("number");
    });

    it("should store event in store", () => {
      const emitted = bus.emit({
        type: "test.event",
        data: { foo: "bar" },
      });

      expect(bus.store.getById(emitted.id)).toEqual(emitted);
    });

    it("should preserve source and causedBy", () => {
      const emitted = bus.emit({
        type: "test.event",
        data: {},
        source: { agentId: "agent-1" },
        causedBy: "01HQJY3KCNP5VXWZ8M4R6T2G9A",
      });

      expect(emitted.source).toEqual({ agentId: "agent-1" });
      expect(emitted.causedBy).toBe("01HQJY3KCNP5VXWZ8M4R6T2G9A");
    });
  });

  describe("on", () => {
    it("should call handler for matching event type", () => {
      const handler = vi.fn();
      bus.on("test.event", handler);

      bus.emit({ type: "test.event", data: {} });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "test.event" })
      );
    });

    it("should not call handler for non-matching event type", () => {
      const handler = vi.fn();
      bus.on("test.event", handler);

      bus.emit({ type: "other.event", data: {} });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should support wildcard subscription", () => {
      const handler = vi.fn();
      bus.on("*", handler);

      bus.emit({ type: "any.event", data: {} });
      bus.emit({ type: "other.event", data: {} });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should support prefix pattern subscriptions", () => {
      const handler = vi.fn();
      bus.on("agent.*", handler);

      bus.emit({ type: "agent.registered", data: {} });
      bus.emit({ type: "agent.state.changed", data: {} });
      bus.emit({ type: "scope.created", data: {} });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should support array of types", () => {
      const handler = vi.fn();
      bus.on(["type.a", "type.b"], handler);

      bus.emit({ type: "type.a", data: {} });
      bus.emit({ type: "type.b", data: {} });
      bus.emit({ type: "type.c", data: {} });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should return unsubscribe function", () => {
      const handler = vi.fn();
      const unsubscribe = bus.on("test.event", handler);

      bus.emit({ type: "test.event", data: {} });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      bus.emit({ type: "test.event", data: {} });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple subscriptions", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on("test.event", handler1);
      bus.on("test.event", handler2);

      bus.emit({ type: "test.event", data: {} });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should continue after handler throws", () => {
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error("handler error");
      });
      const successHandler = vi.fn();

      bus.on("test.event", errorHandler);
      bus.on("test.event", successHandler);

      // Should not throw
      expect(() => bus.emit({ type: "test.event", data: {} })).not.toThrow();
      expect(successHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("getEvents", () => {
    it("should query events from store", () => {
      bus.emit({ type: "type.a", data: {} });
      bus.emit({ type: "type.b", data: {} });
      bus.emit({ type: "type.a", data: {} });

      const results = bus.getEvents({ types: ["type.a"] });
      expect(results).toHaveLength(2);
    });
  });

  describe("subscriptionCount", () => {
    it("should track active subscriptions", () => {
      expect(bus.subscriptionCount).toBe(0);

      const unsub1 = bus.on("type.a", () => {});
      expect(bus.subscriptionCount).toBe(1);

      const unsub2 = bus.on("type.b", () => {});
      expect(bus.subscriptionCount).toBe(2);

      unsub1();
      expect(bus.subscriptionCount).toBe(1);

      unsub2();
      expect(bus.subscriptionCount).toBe(0);
    });
  });

  describe("custom store", () => {
    it("should use provided store", () => {
      const customStore = new InMemoryEventStore({ maxSize: 5 });
      const customBus = new EventBusImpl({ store: customStore });

      customBus.emit({ type: "test", data: {} });

      expect(customBus.store).toBe(customStore);
      expect(customStore.size).toBe(1);
    });
  });
});
