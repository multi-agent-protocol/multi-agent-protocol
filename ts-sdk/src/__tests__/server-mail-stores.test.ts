/**
 * Tests for Mail in-memory store implementations.
 *
 * Covers:
 * - InMemoryConversationStore
 * - InMemoryTurnStore
 * - InMemoryThreadStore
 * - InMemoryParticipantStore
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryConversationStore,
  InMemoryTurnStore,
  InMemoryThreadStore,
  InMemoryParticipantStore,
} from "../server/mail";
import type {
  ServerConversation,
  ServerTurn,
  ServerThread,
  ServerParticipant,
} from "../server/types";

// =============================================================================
// Helpers
// =============================================================================

const createConversation = (
  overrides: Partial<ServerConversation> = {}
): ServerConversation => ({
  id: "conv-1",
  type: "multi-agent",
  status: "active",
  participantCount: 2,
  createdAt: 1000,
  updatedAt: 1000,
  createdBy: "user-1",
  metadata: {},
  ...overrides,
});

const createTurn = (
  overrides: Partial<ServerTurn> = {}
): ServerTurn => ({
  id: "turn-1",
  conversationId: "conv-1",
  participant: "user-1",
  timestamp: 1000,
  contentType: "text",
  content: "hello",
  source: { type: "explicit", method: "mail/turn" },
  metadata: {},
  ...overrides,
});

const createThread = (
  overrides: Partial<ServerThread> = {}
): ServerThread => ({
  id: "thread-1",
  conversationId: "conv-1",
  rootTurnId: "turn-1",
  turnCount: 0,
  participantCount: 0,
  createdAt: 1000,
  updatedAt: 1000,
  createdBy: "user-1",
  ...overrides,
});

const createParticipant = (
  overrides: Partial<ServerParticipant> = {}
): ServerParticipant => ({
  id: "user-1",
  conversationId: "conv-1",
  type: "user",
  role: "initiator",
  joinedAt: 1000,
  permissions: {
    canSend: true,
    canObserve: true,
    canInvite: false,
    canRemove: false,
    canCreateThreads: true,
    historyAccess: "full",
    canSeeInternal: false,
  },
  ...overrides,
});

// =============================================================================
// ConversationStore
// =============================================================================

describe("InMemoryConversationStore", () => {
  let store: InMemoryConversationStore;

  beforeEach(() => {
    store = new InMemoryConversationStore();
  });

  describe("save and get", () => {
    it("should save and retrieve a conversation", () => {
      const conv = createConversation();
      store.save(conv);
      expect(store.get("conv-1")).toEqual(conv);
    });

    it("should return undefined for unknown ID", () => {
      expect(store.get("unknown")).toBeUndefined();
    });

    it("should return defensive copies", () => {
      const conv = createConversation();
      store.save(conv);

      const retrieved = store.get("conv-1")!;
      retrieved.status = "closed";
      expect(store.get("conv-1")!.status).toBe("active");
    });

    it("should update on re-save", () => {
      store.save(createConversation());
      store.save(createConversation({ status: "completed" }));
      expect(store.get("conv-1")!.status).toBe("completed");
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.save(createConversation({ id: "conv-1", type: "multi-agent", status: "active" }));
      store.save(createConversation({ id: "conv-2", type: "user-session", status: "active" }));
      store.save(createConversation({ id: "conv-3", type: "multi-agent", status: "completed" }));
    });

    it("should list all conversations with no filter", () => {
      expect(store.list()).toHaveLength(3);
    });

    it("should filter by type", () => {
      const results = store.list({ type: ["multi-agent"] });
      expect(results).toHaveLength(2);
      expect(results.every((c) => c.type === "multi-agent")).toBe(true);
    });

    it("should filter by status", () => {
      const results = store.list({ status: ["completed"] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("conv-3");
    });

    it("should filter by multiple types", () => {
      const results = store.list({ type: ["multi-agent", "user-session"] });
      expect(results).toHaveLength(3);
    });

    it("should filter by createdAfter", () => {
      store.save(createConversation({ id: "conv-4", createdAt: 5000 }));
      const results = store.list({ createdAfter: 2000 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("conv-4");
    });

    it("should filter by createdBefore", () => {
      store.save(createConversation({ id: "conv-4", createdAt: 500 }));
      const results = store.list({ createdBefore: 800 });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("conv-4");
    });

    it("should filter by parentConversationId", () => {
      store.save(createConversation({ id: "conv-child", parentConversationId: "conv-1" }));
      const results = store.list({ parentConversationId: "conv-1" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("conv-child");
    });

    it("should combine filters", () => {
      const results = store.list({ type: ["multi-agent"], status: ["active"] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("conv-1");
    });
  });

  describe("list with participantStore", () => {
    it("should filter by participantId when participantStore is provided", () => {
      const participantStore = new InMemoryParticipantStore();
      const convStore = new InMemoryConversationStore({ participantStore });

      convStore.save(createConversation({ id: "conv-1" }));
      convStore.save(createConversation({ id: "conv-2" }));

      participantStore.save(createParticipant({ id: "user-1", conversationId: "conv-1" }));
      participantStore.save(createParticipant({ id: "user-2", conversationId: "conv-2" }));

      const results = convStore.list({ participantId: "user-1" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("conv-1");
    });

    it("should return empty when filtering by participantId without participantStore", () => {
      store.save(createConversation());
      const results = store.list({ participantId: "user-1" });
      expect(results).toHaveLength(0);
    });
  });

  describe("delete", () => {
    it("should delete a conversation", () => {
      store.save(createConversation());
      expect(store.delete("conv-1")).toBe(true);
      expect(store.get("conv-1")).toBeUndefined();
    });

    it("should return false for unknown ID", () => {
      expect(store.delete("unknown")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all conversations", () => {
      store.save(createConversation({ id: "conv-1" }));
      store.save(createConversation({ id: "conv-2" }));
      store.clear();
      expect(store.list()).toHaveLength(0);
      expect(store.size).toBe(0);
    });
  });
});

// =============================================================================
// TurnStore
// =============================================================================

describe("InMemoryTurnStore", () => {
  let store: InMemoryTurnStore;

  beforeEach(() => {
    store = new InMemoryTurnStore();
  });

  describe("append and get", () => {
    it("should append and retrieve a turn", () => {
      const turn = createTurn();
      store.append(turn);
      expect(store.get("turn-1")).toEqual(turn);
    });

    it("should return undefined for unknown ID", () => {
      expect(store.get("unknown")).toBeUndefined();
    });

    it("should return defensive copies", () => {
      store.append(createTurn());
      const retrieved = store.get("turn-1")!;
      retrieved.content = "modified";
      expect(store.get("turn-1")!.content).toBe("hello");
    });

    it("should ignore duplicate IDs", () => {
      store.append(createTurn({ content: "first" }));
      store.append(createTurn({ content: "second" }));
      expect(store.get("turn-1")!.content).toBe("first");
      expect(store.size).toBe(1);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.append(createTurn({ id: "t1", timestamp: 1000, contentType: "text", participant: "user-1" }));
      store.append(createTurn({ id: "t2", timestamp: 2000, contentType: "data", participant: "agent-1" }));
      store.append(createTurn({ id: "t3", timestamp: 3000, contentType: "text", participant: "user-1", threadId: "thread-1" }));
      store.append(createTurn({ id: "t4", timestamp: 4000, contentType: "event", participant: "agent-1" }));
      store.append(createTurn({ id: "t5", timestamp: 5000, contentType: "text", participant: "user-1" }));
    });

    it("should list all turns for a conversation", () => {
      const results = store.list({ conversationId: "conv-1" });
      expect(results).toHaveLength(5);
    });

    it("should return empty for unknown conversation", () => {
      expect(store.list({ conversationId: "unknown" })).toHaveLength(0);
    });

    it("should filter by threadId", () => {
      const results = store.list({ conversationId: "conv-1", threadId: "thread-1" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t3");
    });

    it("should filter by contentTypes", () => {
      const results = store.list({ conversationId: "conv-1", contentTypes: ["text"] });
      expect(results).toHaveLength(3);
    });

    it("should filter by multiple contentTypes", () => {
      const results = store.list({ conversationId: "conv-1", contentTypes: ["text", "data"] });
      expect(results).toHaveLength(4);
    });

    it("should filter by participantId", () => {
      const results = store.list({ conversationId: "conv-1", participantId: "agent-1" });
      expect(results).toHaveLength(2);
    });

    it("should filter by afterTimestamp", () => {
      const results = store.list({ conversationId: "conv-1", afterTimestamp: 3000 });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("t4");
    });

    it("should filter by beforeTimestamp", () => {
      const results = store.list({ conversationId: "conv-1", beforeTimestamp: 3000 });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("t1");
    });

    it("should filter by timestamp range", () => {
      const results = store.list({
        conversationId: "conv-1",
        afterTimestamp: 1000,
        beforeTimestamp: 4000,
      });
      expect(results).toHaveLength(2);
      expect(results.map((t) => t.id)).toEqual(["t2", "t3"]);
    });

    it("should combine filters", () => {
      const results = store.list({
        conversationId: "conv-1",
        contentTypes: ["text"],
        participantId: "user-1",
        afterTimestamp: 2000,
      });
      expect(results).toHaveLength(2);
      expect(results.map((t) => t.id)).toEqual(["t3", "t5"]);
    });
  });

  describe("cursor pagination", () => {
    beforeEach(() => {
      for (let i = 1; i <= 10; i++) {
        store.append(createTurn({ id: `t${i}`, timestamp: i * 1000 }));
      }
    });

    it("should paginate with limit", () => {
      const results = store.list({ conversationId: "conv-1", limit: 3 });
      expect(results).toHaveLength(3);
      expect(results.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    });

    it("should paginate with afterTurnId", () => {
      const results = store.list({ conversationId: "conv-1", afterTurnId: "t3", limit: 3 });
      expect(results).toHaveLength(3);
      expect(results.map((t) => t.id)).toEqual(["t4", "t5", "t6"]);
    });

    it("should paginate with beforeTurnId", () => {
      const results = store.list({ conversationId: "conv-1", beforeTurnId: "t4" });
      expect(results).toHaveLength(3);
      expect(results.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    });

    it("should paginate with afterTurnId and beforeTurnId", () => {
      const results = store.list({
        conversationId: "conv-1",
        afterTurnId: "t2",
        beforeTurnId: "t7",
      });
      expect(results).toHaveLength(4);
      expect(results.map((t) => t.id)).toEqual(["t3", "t4", "t5", "t6"]);
    });

    it("should paginate with afterTurnId, limit, and continue", () => {
      const page1 = store.list({ conversationId: "conv-1", limit: 3 });
      expect(page1.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);

      const page2 = store.list({
        conversationId: "conv-1",
        afterTurnId: page1[page1.length - 1].id,
        limit: 3,
      });
      expect(page2.map((t) => t.id)).toEqual(["t4", "t5", "t6"]);

      const page3 = store.list({
        conversationId: "conv-1",
        afterTurnId: page2[page2.length - 1].id,
        limit: 3,
      });
      expect(page3.map((t) => t.id)).toEqual(["t7", "t8", "t9"]);
    });
  });

  describe("ordering", () => {
    beforeEach(() => {
      for (let i = 1; i <= 5; i++) {
        store.append(createTurn({ id: `t${i}`, timestamp: i * 1000 }));
      }
    });

    it("should return ascending order by default", () => {
      const results = store.list({ conversationId: "conv-1" });
      expect(results.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    });

    it("should return descending order when requested", () => {
      const results = store.list({ conversationId: "conv-1", order: "desc" });
      expect(results.map((t) => t.id)).toEqual(["t5", "t4", "t3", "t2", "t1"]);
    });

    it("should respect limit in descending order", () => {
      const results = store.list({ conversationId: "conv-1", order: "desc", limit: 2 });
      expect(results.map((t) => t.id)).toEqual(["t5", "t4"]);
    });

    it("should respect cursors in descending order", () => {
      const results = store.list({
        conversationId: "conv-1",
        order: "desc",
        afterTurnId: "t1",
        beforeTurnId: "t5",
      });
      expect(results.map((t) => t.id)).toEqual(["t4", "t3", "t2"]);
    });
  });

  describe("delete", () => {
    it("should delete a turn", () => {
      store.append(createTurn());
      expect(store.delete("turn-1")).toBe(true);
      expect(store.get("turn-1")).toBeUndefined();
      expect(store.list({ conversationId: "conv-1" })).toHaveLength(0);
    });

    it("should return false for unknown ID", () => {
      expect(store.delete("unknown")).toBe(false);
    });
  });

  describe("deleteByConversation", () => {
    it("should delete all turns for a conversation", () => {
      store.append(createTurn({ id: "t1", conversationId: "conv-1" }));
      store.append(createTurn({ id: "t2", conversationId: "conv-1" }));
      store.append(createTurn({ id: "t3", conversationId: "conv-2" }));

      expect(store.deleteByConversation("conv-1")).toBe(2);
      expect(store.list({ conversationId: "conv-1" })).toHaveLength(0);
      expect(store.list({ conversationId: "conv-2" })).toHaveLength(1);
      expect(store.size).toBe(1);
    });

    it("should return 0 for unknown conversation", () => {
      expect(store.deleteByConversation("unknown")).toBe(0);
    });
  });

  describe("count", () => {
    it("should count turns in a conversation", () => {
      store.append(createTurn({ id: "t1" }));
      store.append(createTurn({ id: "t2" }));
      store.append(createTurn({ id: "t3", conversationId: "conv-2" }));
      expect(store.count("conv-1")).toBe(2);
    });

    it("should count turns in a thread", () => {
      store.append(createTurn({ id: "t1", threadId: "thread-1" }));
      store.append(createTurn({ id: "t2", threadId: "thread-1" }));
      store.append(createTurn({ id: "t3" }));
      expect(store.count("conv-1", "thread-1")).toBe(2);
    });

    it("should return 0 for unknown conversation", () => {
      expect(store.count("unknown")).toBe(0);
    });
  });

  describe("clear", () => {
    it("should remove all turns", () => {
      store.append(createTurn({ id: "t1" }));
      store.append(createTurn({ id: "t2" }));
      store.clear();
      expect(store.size).toBe(0);
      expect(store.list({ conversationId: "conv-1" })).toHaveLength(0);
    });
  });
});

// =============================================================================
// ThreadStore
// =============================================================================

describe("InMemoryThreadStore", () => {
  let store: InMemoryThreadStore;

  beforeEach(() => {
    store = new InMemoryThreadStore();
  });

  describe("save and get", () => {
    it("should save and retrieve a thread", () => {
      const thread = createThread();
      store.save(thread);
      expect(store.get("thread-1")).toEqual(thread);
    });

    it("should return undefined for unknown ID", () => {
      expect(store.get("unknown")).toBeUndefined();
    });

    it("should return defensive copies", () => {
      store.save(createThread());
      const retrieved = store.get("thread-1")!;
      retrieved.subject = "modified";
      expect(store.get("thread-1")!.subject).toBeUndefined();
    });

    it("should update on re-save", () => {
      store.save(createThread());
      store.save(createThread({ turnCount: 5 }));
      expect(store.get("thread-1")!.turnCount).toBe(5);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.save(createThread({ id: "th-1", conversationId: "conv-1" }));
      store.save(createThread({ id: "th-2", conversationId: "conv-1", parentThreadId: "th-1" }));
      store.save(createThread({ id: "th-3", conversationId: "conv-2" }));
    });

    it("should list threads by conversation", () => {
      const results = store.list({ conversationId: "conv-1" });
      expect(results).toHaveLength(2);
    });

    it("should return empty for unknown conversation", () => {
      expect(store.list({ conversationId: "unknown" })).toHaveLength(0);
    });

    it("should filter by parentThreadId", () => {
      const results = store.list({ conversationId: "conv-1", parentThreadId: "th-1" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("th-2");
    });
  });

  describe("delete", () => {
    it("should delete a thread", () => {
      store.save(createThread());
      expect(store.delete("thread-1")).toBe(true);
      expect(store.get("thread-1")).toBeUndefined();
    });

    it("should return false for unknown ID", () => {
      expect(store.delete("unknown")).toBe(false);
    });

    it("should update conversation index on delete", () => {
      store.save(createThread({ id: "th-1" }));
      store.save(createThread({ id: "th-2" }));
      store.delete("th-1");
      expect(store.list({ conversationId: "conv-1" })).toHaveLength(1);
    });
  });

  describe("deleteByConversation", () => {
    it("should delete all threads for a conversation", () => {
      store.save(createThread({ id: "th-1", conversationId: "conv-1" }));
      store.save(createThread({ id: "th-2", conversationId: "conv-1" }));
      store.save(createThread({ id: "th-3", conversationId: "conv-2" }));

      expect(store.deleteByConversation("conv-1")).toBe(2);
      expect(store.list({ conversationId: "conv-1" })).toHaveLength(0);
      expect(store.list({ conversationId: "conv-2" })).toHaveLength(1);
    });

    it("should return 0 for unknown conversation", () => {
      expect(store.deleteByConversation("unknown")).toBe(0);
    });
  });

  describe("clear", () => {
    it("should remove all threads", () => {
      store.save(createThread({ id: "th-1" }));
      store.save(createThread({ id: "th-2" }));
      store.clear();
      expect(store.size).toBe(0);
    });
  });
});

// =============================================================================
// ParticipantStore
// =============================================================================

describe("InMemoryParticipantStore", () => {
  let store: InMemoryParticipantStore;

  beforeEach(() => {
    store = new InMemoryParticipantStore();
  });

  describe("save and get", () => {
    it("should save and retrieve a participant", () => {
      const participant = createParticipant();
      store.save(participant);
      expect(store.get("conv-1", "user-1")).toEqual(participant);
    });

    it("should return undefined for unknown participant", () => {
      expect(store.get("conv-1", "unknown")).toBeUndefined();
    });

    it("should return undefined for unknown conversation", () => {
      store.save(createParticipant());
      expect(store.get("unknown", "user-1")).toBeUndefined();
    });

    it("should return defensive copies", () => {
      store.save(createParticipant());
      const retrieved = store.get("conv-1", "user-1")!;
      retrieved.permissions.canSend = false;
      expect(store.get("conv-1", "user-1")!.permissions.canSend).toBe(true);
    });

    it("should update on re-save", () => {
      store.save(createParticipant());
      store.save(createParticipant({ role: "observer" }));
      expect(store.get("conv-1", "user-1")!.role).toBe("observer");
    });

    it("should handle same participant in different conversations", () => {
      store.save(createParticipant({ conversationId: "conv-1" }));
      store.save(createParticipant({ conversationId: "conv-2" }));
      expect(store.get("conv-1", "user-1")).toBeDefined();
      expect(store.get("conv-2", "user-1")).toBeDefined();
      expect(store.size).toBe(2);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.save(createParticipant({ id: "user-1", conversationId: "conv-1", role: "initiator" }));
      store.save(createParticipant({ id: "agent-1", conversationId: "conv-1", role: "assistant", type: "agent", agentInfo: { agentId: "a1" } }));
      store.save(createParticipant({ id: "user-1", conversationId: "conv-2", role: "observer" }));
      store.save(createParticipant({ id: "agent-2", conversationId: "conv-2", role: "worker", type: "agent", leftAt: 5000 }));
    });

    it("should list by conversationId", () => {
      const results = store.list({ conversationId: "conv-1" });
      expect(results).toHaveLength(2);
    });

    it("should list by participantId across conversations", () => {
      const results = store.list({ participantId: "user-1" });
      expect(results).toHaveLength(2);
    });

    it("should filter by role", () => {
      const results = store.list({ conversationId: "conv-1", role: "assistant" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("agent-1");
    });

    it("should filter active participants", () => {
      const results = store.list({ conversationId: "conv-2", active: true });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("user-1");
    });

    it("should filter inactive (left) participants", () => {
      const results = store.list({ conversationId: "conv-2", active: false });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("agent-2");
    });

    it("should combine conversationId and role filter", () => {
      const results = store.list({ conversationId: "conv-1", role: "initiator" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("user-1");
    });

    it("should list all with no filter", () => {
      const results = store.list({});
      expect(results).toHaveLength(4);
    });
  });

  describe("delete", () => {
    it("should delete a participant", () => {
      store.save(createParticipant());
      expect(store.delete("conv-1", "user-1")).toBe(true);
      expect(store.get("conv-1", "user-1")).toBeUndefined();
    });

    it("should return false for unknown participant", () => {
      expect(store.delete("conv-1", "unknown")).toBe(false);
    });

    it("should update indexes on delete", () => {
      store.save(createParticipant({ id: "user-1", conversationId: "conv-1" }));
      store.save(createParticipant({ id: "user-1", conversationId: "conv-2" }));
      store.delete("conv-1", "user-1");

      expect(store.list({ conversationId: "conv-1" })).toHaveLength(0);
      expect(store.getConversationsForParticipant("user-1")).toEqual(["conv-2"]);
    });
  });

  describe("deleteByConversation", () => {
    it("should delete all participants for a conversation", () => {
      store.save(createParticipant({ id: "user-1", conversationId: "conv-1" }));
      store.save(createParticipant({ id: "agent-1", conversationId: "conv-1" }));
      store.save(createParticipant({ id: "user-1", conversationId: "conv-2" }));

      expect(store.deleteByConversation("conv-1")).toBe(2);
      expect(store.list({ conversationId: "conv-1" })).toHaveLength(0);
      expect(store.size).toBe(1);
    });

    it("should update participant index on bulk delete", () => {
      store.save(createParticipant({ id: "user-1", conversationId: "conv-1" }));
      store.save(createParticipant({ id: "user-1", conversationId: "conv-2" }));
      store.deleteByConversation("conv-1");

      expect(store.getConversationsForParticipant("user-1")).toEqual(["conv-2"]);
    });

    it("should return 0 for unknown conversation", () => {
      expect(store.deleteByConversation("unknown")).toBe(0);
    });
  });

  describe("getConversationsForParticipant", () => {
    beforeEach(() => {
      store.save(createParticipant({ id: "user-1", conversationId: "conv-1" }));
      store.save(createParticipant({ id: "user-1", conversationId: "conv-2" }));
      store.save(createParticipant({ id: "user-1", conversationId: "conv-3", leftAt: 5000 }));
    });

    it("should return all conversations for a participant", () => {
      const results = store.getConversationsForParticipant("user-1");
      expect(results).toHaveLength(3);
    });

    it("should return only active conversations when active=true", () => {
      const results = store.getConversationsForParticipant("user-1", true);
      expect(results).toHaveLength(2);
      expect(results).not.toContain("conv-3");
    });

    it("should return only left conversations when active=false", () => {
      const results = store.getConversationsForParticipant("user-1", false);
      expect(results).toHaveLength(1);
      expect(results).toContain("conv-3");
    });

    it("should return empty for unknown participant", () => {
      expect(store.getConversationsForParticipant("unknown")).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("should remove all participants and indexes", () => {
      store.save(createParticipant({ id: "user-1", conversationId: "conv-1" }));
      store.save(createParticipant({ id: "user-1", conversationId: "conv-2" }));
      store.clear();
      expect(store.size).toBe(0);
      expect(store.getConversationsForParticipant("user-1")).toHaveLength(0);
      expect(store.list({ conversationId: "conv-1" })).toHaveLength(0);
    });
  });
});
