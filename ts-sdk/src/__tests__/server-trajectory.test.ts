/**
 * Tests for Trajectory protocol handlers, store, and manager.
 *
 * Covers:
 * - InMemoryTrajectoryStore — CRUD and filtering
 * - TrajectoryManagerImpl — checkpoint lifecycle, events, content
 * - createTrajectoryHandlers() — all trajectory/* handlers
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventBusImpl } from "../server/events";
import {
  InMemoryTrajectoryStore,
  TrajectoryManagerImpl,
  createTrajectoryHandlers,
} from "../server/trajectory";
import { MAPRequestError } from "../errors";
import { EVENT_TYPES, TRAJECTORY_ERROR_CODES } from "../types";
import type {
  TrajectoryCheckpoint,
  TrajectoryContentResultInline,
} from "../types";
import type {
  HandlerContext,
  HandlerRegistry,
  EventBus,
  TrajectoryStore,
  TrajectoryManager,
} from "../server/types";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockContext(overrides?: Partial<HandlerContext>): HandlerContext {
  return {
    session: {
      id: "session-1",
      role: "agent",
      status: "connected",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      metadata: {},
      agentIds: ["agent-1"],
      subscriptionIds: [],
    },
    requestId: "req-1",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeCheckpoint(
  id: string,
  overrides?: Partial<TrajectoryCheckpoint>
): TrajectoryCheckpoint {
  return {
    id,
    agentId: "agent-1",
    timestamp: Date.now(),
    ...overrides,
  };
}

// =============================================================================
// InMemoryTrajectoryStore
// =============================================================================

describe("InMemoryTrajectoryStore", () => {
  let store: InMemoryTrajectoryStore;

  beforeEach(() => {
    store = new InMemoryTrajectoryStore();
  });

  it("should save and get a checkpoint", () => {
    const cp = makeCheckpoint("cp-1");
    store.save(cp);

    const result = store.get("cp-1");
    expect(result).toBeDefined();
    expect(result!.id).toBe("cp-1");
    expect(result!.agentId).toBe("agent-1");
  });

  it("should return undefined for missing checkpoint", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("should list all checkpoints sorted by timestamp descending", () => {
    store.save(makeCheckpoint("cp-1", { timestamp: 1000 }));
    store.save(makeCheckpoint("cp-2", { timestamp: 3000 }));
    store.save(makeCheckpoint("cp-3", { timestamp: 2000 }));

    const results = store.list();
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe("cp-2"); // newest first
    expect(results[1].id).toBe("cp-3");
    expect(results[2].id).toBe("cp-1");
  });

  it("should filter by agentId", () => {
    store.save(makeCheckpoint("cp-1", { agentId: "agent-a" }));
    store.save(makeCheckpoint("cp-2", { agentId: "agent-b" }));
    store.save(makeCheckpoint("cp-3", { agentId: "agent-a" }));

    const results = store.list({ agentId: "agent-a" });
    expect(results).toHaveLength(2);
    expect(results.every((c) => c.agentId === "agent-a")).toBe(true);
  });

  it("should filter by sessionId", () => {
    store.save(makeCheckpoint("cp-1", { sessionId: "sess-1" }));
    store.save(makeCheckpoint("cp-2", { sessionId: "sess-2" }));
    store.save(makeCheckpoint("cp-3", { sessionId: "sess-1" }));

    const results = store.list({ sessionId: "sess-1" });
    expect(results).toHaveLength(2);
  });

  it("should filter by afterTimestamp", () => {
    store.save(makeCheckpoint("cp-1", { timestamp: 1000 }));
    store.save(makeCheckpoint("cp-2", { timestamp: 2000 }));
    store.save(makeCheckpoint("cp-3", { timestamp: 3000 }));

    const results = store.list({ afterTimestamp: 1500 });
    expect(results).toHaveLength(2);
    expect(results.map((c) => c.id)).toEqual(["cp-3", "cp-2"]);
  });

  it("should filter by beforeTimestamp", () => {
    store.save(makeCheckpoint("cp-1", { timestamp: 1000 }));
    store.save(makeCheckpoint("cp-2", { timestamp: 2000 }));
    store.save(makeCheckpoint("cp-3", { timestamp: 3000 }));

    const results = store.list({ beforeTimestamp: 2500 });
    expect(results).toHaveLength(2);
    expect(results.map((c) => c.id)).toEqual(["cp-2", "cp-1"]);
  });

  it("should delete a checkpoint", () => {
    store.save(makeCheckpoint("cp-1"));
    expect(store.delete("cp-1")).toBe(true);
    expect(store.get("cp-1")).toBeUndefined();
    expect(store.delete("cp-1")).toBe(false);
  });

  it("should clear all checkpoints", () => {
    store.save(makeCheckpoint("cp-1"));
    store.save(makeCheckpoint("cp-2"));
    store.clear();
    expect(store.list()).toHaveLength(0);
  });
});

// =============================================================================
// TrajectoryManagerImpl
// =============================================================================

describe("TrajectoryManagerImpl", () => {
  let store: TrajectoryStore;
  let eventBus: EventBus;
  let manager: TrajectoryManager;

  beforeEach(() => {
    store = new InMemoryTrajectoryStore();
    eventBus = new EventBusImpl();
    manager = new TrajectoryManagerImpl({ store, eventBus });
  });

  describe("reportCheckpoint", () => {
    it("should store the checkpoint and return it with timestamp", () => {
      const before = Date.now();
      const cp = manager.reportCheckpoint(
        { id: "cp-1", agentId: "agent-1", label: "Test checkpoint" },
        "agent-1"
      );

      expect(cp.id).toBe("cp-1");
      expect(cp.agentId).toBe("agent-1");
      expect(cp.label).toBe("Test checkpoint");
      expect(cp.timestamp).toBeGreaterThanOrEqual(before);

      // Verify it's in the store
      expect(manager.get("cp-1")).toBeDefined();
    });

    it("should preserve a client-provided timestamp", () => {
      const cp = manager.reportCheckpoint(
        { id: "cp-1", agentId: "agent-1", timestamp: 42000 },
        "agent-1"
      );
      expect(cp.timestamp).toBe(42000);
    });

    it("should emit a trajectory.checkpoint event", () => {
      const events: unknown[] = [];
      eventBus.on(EVENT_TYPES.TRAJECTORY_CHECKPOINT, (e) => events.push(e));

      manager.reportCheckpoint(
        { id: "cp-1", agentId: "agent-1" },
        "agent-1"
      );

      expect(events).toHaveLength(1);
      const event = events[0] as any;
      expect(event.data.checkpoint.id).toBe("cp-1");
      expect(event.source.agentId).toBe("agent-1");
    });
  });

  describe("get", () => {
    it("should return a stored checkpoint", () => {
      manager.reportCheckpoint({ id: "cp-1", agentId: "agent-1" }, "agent-1");
      expect(manager.get("cp-1")).toBeDefined();
    });

    it("should return undefined for missing checkpoint", () => {
      expect(manager.get("nonexistent")).toBeUndefined();
    });
  });

  describe("list", () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        manager.reportCheckpoint(
          { id: `cp-${i}`, agentId: "agent-1", timestamp: 1000 + i },
          "agent-1"
        );
      }
    });

    it("should list all checkpoints", () => {
      const result = manager.list();
      expect(result.checkpoints).toHaveLength(5);
      expect(result.hasMore).toBe(false);
    });

    it("should paginate with limit", () => {
      const result = manager.list(undefined, 2);
      expect(result.checkpoints).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it("should paginate with cursor", () => {
      const page1 = manager.list(undefined, 2);
      const page2 = manager.list(undefined, 2, page1.nextCursor);

      expect(page2.checkpoints).toHaveLength(2);
      // No overlap between pages
      const page1Ids = new Set(page1.checkpoints.map((c) => c.id));
      for (const cp of page2.checkpoints) {
        expect(page1Ids.has(cp.id)).toBe(false);
      }
    });
  });

  describe("requestContent", () => {
    it("should throw CHECKPOINT_NOT_FOUND for missing checkpoint", async () => {
      try {
        await manager.requestContent("nonexistent");
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MAPRequestError);
        expect((error as MAPRequestError).code).toBe(
          TRAJECTORY_ERROR_CODES.TRAJECTORY_CHECKPOINT_NOT_FOUND
        );
      }
    });

    it("should throw CONTENT_UNAVAILABLE when no provider set", async () => {
      manager.reportCheckpoint({ id: "cp-1", agentId: "agent-1" }, "agent-1");

      try {
        await manager.requestContent("cp-1");
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MAPRequestError);
        expect((error as MAPRequestError).code).toBe(
          TRAJECTORY_ERROR_CODES.TRAJECTORY_CONTENT_UNAVAILABLE
        );
      }
    });

    it("should delegate to content provider", async () => {
      manager.reportCheckpoint({ id: "cp-1", agentId: "agent-1" }, "agent-1");

      const mockResult: TrajectoryContentResultInline = {
        checkpointId: "cp-1",
        streaming: false,
        artifacts: { metadata: { foo: "bar" } },
      };

      (manager as TrajectoryManagerImpl).setContentProvider({
        getContent: async () => mockResult,
      });

      const result = await manager.requestContent("cp-1");
      expect(result.streaming).toBe(false);
      expect(result.checkpointId).toBe("cp-1");
      expect((result as TrajectoryContentResultInline).artifacts.metadata).toEqual({ foo: "bar" });
    });
  });
});

// =============================================================================
// createTrajectoryHandlers
// =============================================================================

describe("createTrajectoryHandlers", () => {
  let eventBus: EventBus;
  let manager: TrajectoryManager;
  let handlers: HandlerRegistry;
  let ctx: HandlerContext;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    const store = new InMemoryTrajectoryStore();
    manager = new TrajectoryManagerImpl({ store, eventBus });
    handlers = createTrajectoryHandlers({ trajectory: manager });
    ctx = createMockContext();
  });

  describe("trajectory/checkpoint", () => {
    it("should report and return a checkpoint", async () => {
      const result = (await handlers["trajectory/checkpoint"](
        {
          checkpoint: {
            id: "cp-1",
            agentId: "agent-1",
            label: "Test",
            metadata: { branch: "main" },
          },
        },
        ctx
      )) as any;

      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint.id).toBe("cp-1");
      expect(result.checkpoint.label).toBe("Test");
      expect(result.checkpoint.timestamp).toBeDefined();
    });
  });

  describe("trajectory/list", () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        await handlers["trajectory/checkpoint"](
          {
            checkpoint: {
              id: `cp-${i}`,
              agentId: "agent-1",
              timestamp: 1000 + i,
            },
          },
          ctx
        );
      }
    });

    it("should list all checkpoints", async () => {
      const result = (await handlers["trajectory/list"]({}, ctx)) as any;
      expect(result.checkpoints).toHaveLength(3);
      expect(result.hasMore).toBe(false);
    });

    it("should support limit", async () => {
      const result = (await handlers["trajectory/list"](
        { limit: 2 },
        ctx
      )) as any;
      expect(result.checkpoints).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });

  describe("trajectory/get", () => {
    it("should return a checkpoint by ID", async () => {
      await handlers["trajectory/checkpoint"](
        { checkpoint: { id: "cp-1", agentId: "agent-1" } },
        ctx
      );

      const result = (await handlers["trajectory/get"](
        { checkpointId: "cp-1" },
        ctx
      )) as any;
      expect(result.checkpoint.id).toBe("cp-1");
    });

    it("should throw for missing checkpoint", async () => {
      try {
        await handlers["trajectory/get"](
          { checkpointId: "nonexistent" },
          ctx
        );
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MAPRequestError);
        expect((error as MAPRequestError).code).toBe(
          TRAJECTORY_ERROR_CODES.TRAJECTORY_CHECKPOINT_NOT_FOUND
        );
      }
    });
  });

  describe("trajectory/content", () => {
    it("should return content from provider", async () => {
      await handlers["trajectory/checkpoint"](
        { checkpoint: { id: "cp-1", agentId: "agent-1" } },
        ctx
      );

      (manager as TrajectoryManagerImpl).setContentProvider({
        getContent: async () => ({
          checkpointId: "cp-1",
          streaming: false,
          artifacts: {
            metadata: { agent: "Claude Code" },
            transcript: "line 1\nline 2",
          },
        }),
      });

      const result = (await handlers["trajectory/content"](
        { checkpointId: "cp-1" },
        ctx
      )) as any;

      expect(result.content.streaming).toBe(false);
      expect(result.content.artifacts.transcript).toBe("line 1\nline 2");
    });
  });
});
