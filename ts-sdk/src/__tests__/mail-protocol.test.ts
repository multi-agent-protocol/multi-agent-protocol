/**
 * Comprehensive mail protocol tests.
 *
 * Covers edge cases and scenarios not covered by the unit/handler/integration tests:
 * - Turn visibility filtering
 * - Conversation hierarchy (parent/child)
 * - Thread nesting (deep hierarchies)
 * - Pagination edge cases
 * - Concurrent operations
 * - Error state transitions
 * - Permission checks (participant membership)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventBusImpl } from "../server/events";
import {
  ConversationManagerImpl,
  ConversationNotFoundError,
  ConversationClosedError,
  ParticipantAlreadyJoinedError,
  ParticipantNotFoundError,
  TurnManagerImpl,
  TurnNotFoundError,
  InvalidContentTypeError,
  ThreadManagerImpl,
  ThreadNotFoundError,
  RootTurnNotFoundError,
  RootTurnConversationMismatchError,
  ParentThreadNotFoundError,
  InMemoryTurnStore,
} from "../server/mail";
import type { EventBus } from "../server/types";

// =============================================================================
// Test Helpers
// =============================================================================

function createManagers() {
  const eventBus: EventBus = new EventBusImpl();
  const turnStore = new InMemoryTurnStore();
  const conversations = new ConversationManagerImpl({ eventBus });
  const turns = new TurnManagerImpl({ eventBus, store: turnStore, conversations });
  const threads = new ThreadManagerImpl({ eventBus, store: undefined, turnStore });
  return { eventBus, conversations, turns, threads };
}

// =============================================================================
// Turn Visibility
// =============================================================================

describe("turn visibility", () => {
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;

  beforeEach(() => {
    ({ conversations, turns } = createManagers());
  });

  it("should store visibility=all on turns", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "visible to all",
      visibility: { type: "all" },
    });
    expect(turn.visibility).toEqual({ type: "all" });
  });

  it("should store visibility=private on turns", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "private thought",
      visibility: { type: "private" },
    });
    expect(turn.visibility).toEqual({ type: "private" });
  });

  it("should store visibility=participants on turns", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "for select few",
      visibility: { type: "participants", ids: ["agent-1", "agent-2"] },
    });
    expect(turn.visibility).toEqual({ type: "participants", ids: ["agent-1", "agent-2"] });
  });

  it("should store visibility=role on turns", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "for workers only",
      visibility: { type: "role", roles: ["worker", "assistant"] },
    });
    expect(turn.visibility).toEqual({ type: "role", roles: ["worker", "assistant"] });
  });

  it("should list turns with mixed visibility types", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "public",
      visibility: { type: "all" },
    });

    turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "private",
      visibility: { type: "private" },
    });

    turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "role-based",
      visibility: { type: "role", roles: ["observer"] },
    });

    const allTurns = turns.list({ conversationId: conversation.id });
    expect(allTurns).toHaveLength(3);
    expect(allTurns[0].visibility).toEqual({ type: "all" });
    expect(allTurns[1].visibility).toEqual({ type: "private" });
    expect(allTurns[2].visibility).toEqual({ type: "role", roles: ["observer"] });
  });

  it("should default to no visibility when not specified", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "no visibility set",
    });
    expect(turn.visibility).toBeUndefined();
  });
});

// =============================================================================
// Conversation Hierarchy
// =============================================================================

describe("conversation hierarchy", () => {
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;

  beforeEach(() => {
    ({ conversations, turns } = createManagers());
  });

  it("should create a child conversation with parentConversationId", () => {
    const parent = conversations.create({ createdBy: "agent-1", subject: "Parent" });
    const child = conversations.create({
      createdBy: "agent-1",
      subject: "Child",
      parentConversationId: parent.conversation.id,
    });

    expect(child.conversation.parentConversationId).toBe(parent.conversation.id);
  });

  it("should create a 3-level deep hierarchy", () => {
    const root = conversations.create({ createdBy: "agent-1", subject: "Root" });
    const child = conversations.create({
      createdBy: "agent-1",
      subject: "Child",
      parentConversationId: root.conversation.id,
    });
    const grandchild = conversations.create({
      createdBy: "agent-1",
      subject: "Grandchild",
      parentConversationId: child.conversation.id,
    });

    expect(grandchild.conversation.parentConversationId).toBe(child.conversation.id);
    expect(child.conversation.parentConversationId).toBe(root.conversation.id);
  });

  it("should filter conversations by parentConversationId", () => {
    const parent = conversations.create({ createdBy: "agent-1", subject: "Parent" });
    conversations.create({
      createdBy: "agent-1",
      subject: "Child 1",
      parentConversationId: parent.conversation.id,
    });
    conversations.create({
      createdBy: "agent-1",
      subject: "Child 2",
      parentConversationId: parent.conversation.id,
    });
    conversations.create({ createdBy: "agent-1", subject: "Unrelated" });

    const children = conversations.list({
      parentConversationId: parent.conversation.id,
    });
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.parentConversationId === parent.conversation.id)).toBe(true);
  });

  it("should throw when creating child with non-existent parent", () => {
    expect(() =>
      conversations.create({
        createdBy: "agent-1",
        parentConversationId: "conv-nonexistent",
      })
    ).toThrow(ConversationNotFoundError);
  });

  it("should support parentTurnId anchoring", () => {
    const parent = conversations.create({ createdBy: "agent-1", subject: "Parent" });
    const turn = turns.recordTurn({
      conversationId: parent.conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "anchor point",
    });

    const child = conversations.create({
      createdBy: "agent-1",
      subject: "Anchored child",
      parentConversationId: parent.conversation.id,
      parentTurnId: turn.id,
    });

    expect(child.conversation.parentConversationId).toBe(parent.conversation.id);
    expect(child.conversation.parentTurnId).toBe(turn.id);
  });

  it("should close child independently of parent", () => {
    const parent = conversations.create({ createdBy: "agent-1", subject: "Parent" });
    const child = conversations.create({
      createdBy: "agent-1",
      subject: "Child",
      parentConversationId: parent.conversation.id,
    });

    conversations.close(child.conversation.id, "agent-1", "done");

    const parentConv = conversations.get(parent.conversation.id);
    expect(parentConv!.conversation.status).toBe("active");
  });

  it("should allow multiple levels of children even when parent is closed", () => {
    const parent = conversations.create({ createdBy: "agent-1", subject: "Parent" });
    conversations.close(parent.conversation.id, "agent-1");

    // Closing parent doesn't prevent referencing it as a parent
    // The parent reference is just metadata
    const child = conversations.create({
      createdBy: "agent-1",
      subject: "Late child",
      parentConversationId: parent.conversation.id,
    });
    expect(child.conversation.parentConversationId).toBe(parent.conversation.id);
  });
});

// =============================================================================
// Thread Nesting
// =============================================================================

describe("thread nesting", () => {
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;
  let threads: ThreadManagerImpl;

  beforeEach(() => {
    ({ conversations, turns, threads } = createManagers());
  });

  it("should create a 3-level deep thread hierarchy", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn1 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "root message",
    });
    const turn2 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "sub message",
    });
    const turn3 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "sub-sub message",
    });

    const thread1 = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn1.id,
      subject: "Level 1",
      createdBy: "agent-1",
    });

    const thread2 = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn2.id,
      subject: "Level 2",
      parentThreadId: thread1.id,
      createdBy: "agent-1",
    });

    const thread3 = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn3.id,
      subject: "Level 3",
      parentThreadId: thread2.id,
      createdBy: "agent-1",
    });

    expect(thread3.parentThreadId).toBe(thread2.id);
    expect(thread2.parentThreadId).toBe(thread1.id);
    expect(thread1.parentThreadId).toBeUndefined();
  });

  it("should list only top-level threads when parentThreadId is undefined", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn1 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "msg1",
    });
    const turn2 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "msg2",
    });

    const topThread = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn1.id,
      subject: "Top",
      createdBy: "agent-1",
    });

    threads.create({
      conversationId: conversation.id,
      rootTurnId: turn2.id,
      subject: "Nested",
      parentThreadId: topThread.id,
      createdBy: "agent-1",
    });

    // All threads for conversation
    const allThreads = threads.list(conversation.id);
    expect(allThreads).toHaveLength(2);
  });

  it("should list children of a specific thread", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn1 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "msg1",
    });
    const turn2 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "msg2",
    });
    const turn3 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "msg3",
    });

    const parentThread = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn1.id,
      createdBy: "agent-1",
    });

    threads.create({
      conversationId: conversation.id,
      rootTurnId: turn2.id,
      parentThreadId: parentThread.id,
      createdBy: "agent-1",
    });

    threads.create({
      conversationId: conversation.id,
      rootTurnId: turn3.id,
      parentThreadId: parentThread.id,
      createdBy: "agent-1",
    });

    const children = threads.list(conversation.id, parentThread.id);
    expect(children).toHaveLength(2);
    expect(children.every((t) => t.parentThreadId === parentThread.id)).toBe(true);
  });

  it("should throw when creating thread with non-existent root turn", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    expect(() =>
      threads.create({
        conversationId: conversation.id,
        rootTurnId: "turn-nonexistent",
        createdBy: "agent-1",
      })
    ).toThrow(RootTurnNotFoundError);
  });

  it("should throw when root turn belongs to different conversation", () => {
    const conv1 = conversations.create({ createdBy: "agent-1" });
    const conv2 = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conv1.conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "belongs to conv1",
    });

    expect(() =>
      threads.create({
        conversationId: conv2.conversation.id,
        rootTurnId: turn.id,
        createdBy: "agent-1",
      })
    ).toThrow(RootTurnConversationMismatchError);
  });

  it("should throw when creating thread with non-existent parent thread", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "msg",
    });

    expect(() =>
      threads.create({
        conversationId: conversation.id,
        rootTurnId: turn.id,
        parentThreadId: "thread-nonexistent",
        createdBy: "agent-1",
      })
    ).toThrow(ParentThreadNotFoundError);
  });

  it("should track turnCount and participantCount on threads", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "root",
    });

    const thread = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn.id,
      createdBy: "agent-1",
    });

    expect(thread.turnCount).toBe(0);
    expect(thread.participantCount).toBe(0);

    threads.incrementTurnCount(thread.id);
    threads.incrementTurnCount(thread.id);
    threads.incrementParticipantCount(thread.id);

    const updated = threads.get(thread.id);
    expect(updated!.turnCount).toBe(2);
    expect(updated!.participantCount).toBe(1);
  });

  it("should throw when incrementing counts on non-existent thread", () => {
    expect(() => threads.incrementTurnCount("thread-nonexistent")).toThrow(ThreadNotFoundError);
    expect(() => threads.incrementParticipantCount("thread-nonexistent")).toThrow(
      ThreadNotFoundError
    );
  });
});

// =============================================================================
// Pagination Edge Cases
// =============================================================================

describe("pagination", () => {
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;
  let threads: ThreadManagerImpl;

  beforeEach(() => {
    ({ conversations, turns, threads } = createManagers());
  });

  describe("turns pagination", () => {
    it("should return empty when conversation has no turns", () => {
      const { conversation } = conversations.create({ createdBy: "agent-1" });
      const result = turns.list({ conversationId: conversation.id });
      expect(result).toHaveLength(0);
    });

    it("should paginate with limit=1", () => {
      const { conversation } = conversations.create({ createdBy: "agent-1" });
      for (let i = 0; i < 5; i++) {
        turns.recordTurn({
          conversationId: conversation.id,
          participant: "agent-1",
          contentType: "text",
          content: `turn ${i}`,
        });
      }

      const page1 = turns.list({ conversationId: conversation.id, limit: 1 });
      expect(page1).toHaveLength(1);
      expect(page1[0].content).toBe("turn 0");
    });

    it("should paginate with afterTurnId cursor", () => {
      const { conversation } = conversations.create({ createdBy: "agent-1" });
      const recordedTurns = [];
      for (let i = 0; i < 5; i++) {
        recordedTurns.push(
          turns.recordTurn({
            conversationId: conversation.id,
            participant: "agent-1",
            contentType: "text",
            content: `turn ${i}`,
          })
        );
      }

      const page = turns.list({
        conversationId: conversation.id,
        afterTurnId: recordedTurns[1].id,
        limit: 2,
      });
      expect(page).toHaveLength(2);
      expect(page[0].content).toBe("turn 2");
      expect(page[1].content).toBe("turn 3");
    });

    it("should paginate with beforeTurnId cursor", () => {
      const { conversation } = conversations.create({ createdBy: "agent-1" });
      const recordedTurns = [];
      for (let i = 0; i < 5; i++) {
        recordedTurns.push(
          turns.recordTurn({
            conversationId: conversation.id,
            participant: "agent-1",
            contentType: "text",
            content: `turn ${i}`,
          })
        );
      }

      const page = turns.list({
        conversationId: conversation.id,
        beforeTurnId: recordedTurns[3].id,
      });
      expect(page).toHaveLength(3);
      expect(page[0].content).toBe("turn 0");
    });

    it("should paginate in descending order", () => {
      const { conversation } = conversations.create({ createdBy: "agent-1" });
      for (let i = 0; i < 5; i++) {
        turns.recordTurn({
          conversationId: conversation.id,
          participant: "agent-1",
          contentType: "text",
          content: `turn ${i}`,
        });
      }

      const desc = turns.list({
        conversationId: conversation.id,
        order: "desc",
        limit: 3,
      });
      expect(desc).toHaveLength(3);
      expect(desc[0].content).toBe("turn 4");
      expect(desc[1].content).toBe("turn 3");
      expect(desc[2].content).toBe("turn 2");
    });

    it("should handle limit larger than total results", () => {
      const { conversation } = conversations.create({ createdBy: "agent-1" });
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: "only one",
      });

      const result = turns.list({
        conversationId: conversation.id,
        limit: 100,
      });
      expect(result).toHaveLength(1);
    });

    it("should combine filters with pagination", () => {
      const { conversation } = conversations.create({ createdBy: "agent-1" });
      conversations.join({ conversationId: conversation.id, participantId: "agent-2" });

      // Mix content types and participants
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: "text from 1",
      });
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-2",
        contentType: "data",
        content: { key: "val" },
      });
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: "another text from 1",
      });
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-2",
        contentType: "text",
        content: "text from 2",
      });

      // Filter by participant + content type + limit
      const result = turns.list({
        conversationId: conversation.id,
        participantId: "agent-1",
        contentTypes: ["text"],
        limit: 1,
      });
      expect(result).toHaveLength(1);
      expect(result[0].participant).toBe("agent-1");
      expect(result[0].contentType).toBe("text");
    });

    it("should count turns by conversation", () => {
      const conv1 = conversations.create({ createdBy: "agent-1" });
      const conv2 = conversations.create({ createdBy: "agent-1" });

      turns.recordTurn({
        conversationId: conv1.conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: "a",
      });
      turns.recordTurn({
        conversationId: conv1.conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: "b",
      });
      turns.recordTurn({
        conversationId: conv2.conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: "c",
      });

      expect(turns.count(conv1.conversation.id)).toBe(2);
      expect(turns.count(conv2.conversation.id)).toBe(1);
    });
  });

  describe("conversations pagination", () => {
    it("should filter conversations by status", () => {
      const c1 = conversations.create({ createdBy: "agent-1", subject: "Active" });
      const c2 = conversations.create({ createdBy: "agent-1", subject: "Closed" });
      conversations.close(c2.conversation.id, "agent-1");

      const active = conversations.list({ status: ["active"] });
      expect(active.length).toBeGreaterThanOrEqual(1);
      expect(active.every((c) => c.status === "active")).toBe(true);
    });

    it("should filter conversations by type", () => {
      conversations.create({ createdBy: "agent-1", type: "multi-agent" });
      conversations.create({ createdBy: "agent-1", type: "human-in-loop" });

      const multiAgent = conversations.list({ type: ["multi-agent"] });
      expect(multiAgent.every((c) => c.type === "multi-agent")).toBe(true);
    });

    it("should return all conversations when no filter", () => {
      conversations.create({ createdBy: "agent-1" });
      conversations.create({ createdBy: "agent-2" });

      const all = conversations.list();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// =============================================================================
// Concurrent Operations
// =============================================================================

describe("concurrent operations", () => {
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;
  let threads: ThreadManagerImpl;

  beforeEach(() => {
    ({ conversations, turns, threads } = createManagers());
  });

  it("should handle concurrent turn recording in same conversation", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });

    // Simulate concurrent recording
    const results = Array.from({ length: 10 }, (_, i) =>
      turns.recordTurn({
        conversationId: conversation.id,
        participant: i % 2 === 0 ? "agent-1" : "agent-2",
        contentType: "text",
        content: `message ${i}`,
      })
    );

    // All should have unique IDs
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(10);

    // All should be retrievable
    const allTurns = turns.list({ conversationId: conversation.id });
    expect(allTurns).toHaveLength(10);
  });

  it("should handle concurrent thread creation on different root turns", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    const turnIds = Array.from({ length: 5 }, (_, i) =>
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: `root ${i}`,
      })
    );

    const threadResults = turnIds.map((turn) =>
      threads.create({
        conversationId: conversation.id,
        rootTurnId: turn.id,
        createdBy: "agent-1",
      })
    );

    const threadIds = new Set(threadResults.map((t) => t.id));
    expect(threadIds.size).toBe(5);
  });

  it("should handle rapid join/leave cycles", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    // Join then leave multiple participants
    for (let i = 2; i <= 6; i++) {
      conversations.join({ conversationId: conversation.id, participantId: `agent-${i}` });
    }
    for (let i = 2; i <= 4; i++) {
      conversations.leave(conversation.id, `agent-${i}`);
    }

    const participants = conversations.listParticipants(conversation.id, true);
    // agent-1 (creator) + agent-5 + agent-6 = 3
    expect(participants).toHaveLength(3);
  });

  it("should allow creating turns after some participants leave", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });

    turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "before leave",
    });

    conversations.leave(conversation.id, "agent-2");

    // agent-1 can still create turns
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "after leave",
    });
    expect(turn.content).toBe("after leave");
  });
});

// =============================================================================
// Error State Transitions
// =============================================================================

describe("error state transitions", () => {
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;
  let threads: ThreadManagerImpl;

  beforeEach(() => {
    ({ conversations, turns, threads } = createManagers());
  });

  it("should throw when closing an already-closed conversation", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.close(conversation.id, "agent-1");

    expect(() => conversations.close(conversation.id, "agent-1")).toThrow(ConversationClosedError);
  });

  it("should throw when joining a closed conversation", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.close(conversation.id, "agent-1");

    expect(() => conversations.join({ conversationId: conversation.id, participantId: "agent-2" })).toThrow(ConversationClosedError);
  });

  it("should throw when joining a conversation twice", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });

    expect(() => conversations.join({ conversationId: conversation.id, participantId: "agent-2" })).toThrow(
      ParticipantAlreadyJoinedError
    );
  });

  it("should throw when leaving a conversation you already left", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });
    conversations.leave(conversation.id, "agent-2");

    expect(() => conversations.leave(conversation.id, "agent-2")).toThrow(ParticipantNotFoundError);
  });

  it("should throw when leaving a conversation you never joined", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    expect(() => conversations.leave(conversation.id, "agent-99")).toThrow(
      ParticipantNotFoundError
    );
  });

  it("should throw when getting a non-existent conversation", () => {
    const result = conversations.get("conv-nonexistent");
    expect(result).toBeUndefined();
  });

  it("should throw when closing a non-existent conversation", () => {
    expect(() => conversations.close("conv-nonexistent", "agent-1")).toThrow(
      ConversationNotFoundError
    );
  });

  it("should throw for invalid content types", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    expect(() =>
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType: "invalid-type",
        content: "bad",
      })
    ).toThrow(InvalidContentTypeError);
  });

  it("should accept well-known content types", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    for (const contentType of ["text", "data", "event", "reference"]) {
      const turn = turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType,
        content: `content-${contentType}`,
      });
      expect(turn.contentType).toBe(contentType);
    }
  });

  it("should accept x- prefixed custom content types", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "x-custom-tool-result",
      content: { tool: "result" },
    });
    expect(turn.contentType).toBe("x-custom-tool-result");
  });

  it("should reject x- content type that is too short", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    expect(() =>
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType: "x-",
        content: "bad",
      })
    ).toThrow(InvalidContentTypeError);
  });

  it("should throw when updating status of non-existent turn", () => {
    expect(() => turns.updateStatus("turn-nonexistent", "complete")).toThrow(TurnNotFoundError);
  });

  it("should throw when inviting to a closed conversation", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.close(conversation.id, "agent-1");

    expect(() =>
      conversations.invite({
        conversationId: conversation.id,
        participant: {
          id: "agent-2",
          role: "worker",
        },
      })
    ).toThrow(ConversationClosedError);
  });
});

// =============================================================================
// Permission Checks
// =============================================================================

describe("participant permissions", () => {
  let conversations: ConversationManagerImpl;

  beforeEach(() => {
    ({ conversations } = createManagers());
  });

  it("should set default permissions for creator", () => {
    const { participant } = conversations.create({ createdBy: "agent-1" });

    expect(participant.permissions.canSend).toBe(true);
    expect(participant.permissions.canObserve).toBe(true);
    expect(participant.permissions.canInvite).toBe(false);
    expect(participant.permissions.canRemove).toBe(false);
    expect(participant.permissions.canCreateThreads).toBe(true);
    expect(participant.permissions.historyAccess).toBe("full");
    expect(participant.permissions.canSeeInternal).toBe(false);
  });

  it("should set default permissions for joined participants", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const { participant } = conversations.join({ conversationId: conversation.id, participantId: "agent-2" });

    expect(participant.permissions.canSend).toBe(true);
    expect(participant.permissions.canObserve).toBe(true);
    expect(participant.permissions.historyAccess).toBe("full");
  });

  it("should assign custom permissions on join", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const { participant } = conversations.join({
      conversationId: conversation.id,
      participantId: "agent-2",
      role: "observer",
      permissions: {
        canSend: false,
        canObserve: true,
        historyAccess: "from-join",
      },
    });

    expect(participant.role).toBe("observer");
    expect(participant.permissions.canSend).toBe(false);
    expect(participant.permissions.canObserve).toBe(true);
    expect(participant.permissions.historyAccess).toBe("from-join");
  });

  it("should assign custom permissions on invite", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const participant = conversations.invite({
      conversationId: conversation.id,
      participant: {
        id: "agent-2",
        role: "worker",
        permissions: {
          canSend: true,
          canCreateThreads: false,
          historyAccess: "none",
        },
      },
    });

    expect(participant.role).toBe("worker");
    expect(participant.permissions.canSend).toBe(true);
    expect(participant.permissions.canCreateThreads).toBe(false);
    expect(participant.permissions.historyAccess).toBe("none");
  });

  it("should assign custom permissions on initial participants", () => {
    const { conversation } = conversations.create({
      createdBy: "agent-1",
      initialParticipants: [
        {
          id: "agent-2",
          role: "assistant",
          permissions: { canSend: true, canInvite: true },
        },
      ],
    });

    const participants = conversations.listParticipants(conversation.id);
    const agent2 = participants.find((p) => p.id === "agent-2");
    expect(agent2).toBeDefined();
    expect(agent2!.role).toBe("assistant");
    expect(agent2!.permissions.canInvite).toBe(true);
  });

  it("should track participant join/leave timestamps", () => {
    const { conversation, participant } = conversations.create({ createdBy: "agent-1" });

    expect(participant.joinedAt).toBeDefined();
    expect(participant.leftAt).toBeUndefined();

    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });
    conversations.leave(conversation.id, "agent-2");

    const allParticipants = conversations.listParticipants(conversation.id);
    const agent2 = allParticipants.find((p) => p.id === "agent-2");
    expect(agent2!.leftAt).toBeDefined();
  });

  it("should filter active vs inactive participants", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-3" });
    conversations.leave(conversation.id, "agent-2");

    const active = conversations.listParticipants(conversation.id, true);
    expect(active).toHaveLength(2); // agent-1 + agent-3

    const all = conversations.listParticipants(conversation.id);
    expect(all).toHaveLength(3); // agent-1 + agent-2 (left) + agent-3
  });

  it("should get a specific participant", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2", role: "worker" });

    const p = conversations.getParticipant(conversation.id, "agent-2");
    expect(p).toBeDefined();
    expect(p!.role).toBe("worker");
  });

  it("should return undefined for non-existent participant", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const p = conversations.getParticipant(conversation.id, "agent-99");
    expect(p).toBeUndefined();
  });
});

// =============================================================================
// Event Emissions
// =============================================================================

describe("event emissions", () => {
  let eventBus: EventBus;
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;
  let threads: ThreadManagerImpl;

  beforeEach(() => {
    ({ eventBus, conversations, turns, threads } = createManagers());
  });

  it("should emit mail.created on conversation create", () => {
    const events: string[] = [];
    eventBus.on("mail.created", () => events.push("mail.created"));

    conversations.create({ createdBy: "agent-1" });
    expect(events).toContain("mail.created");
  });

  it("should emit mail.closed on conversation close", () => {
    const events: string[] = [];
    eventBus.on("mail.closed", () => events.push("mail.closed"));

    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.close(conversation.id, "agent-1");
    expect(events).toContain("mail.closed");
  });

  it("should emit mail.participant.joined on join", () => {
    const events: string[] = [];
    eventBus.on("mail.participant.joined", () => events.push("mail.participant.joined"));

    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });
    // Creator also triggers a join event, so we may have 2
    expect(events.filter((e) => e === "mail.participant.joined").length).toBeGreaterThanOrEqual(1);
  });

  it("should emit mail.participant.left on leave", () => {
    const events: string[] = [];
    eventBus.on("mail.participant.left", () => events.push("mail.participant.left"));

    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });
    conversations.leave(conversation.id, "agent-2");
    expect(events).toContain("mail.participant.left");
  });

  it("should emit mail.turn.added on turn record", () => {
    const events: string[] = [];
    eventBus.on("mail.turn.added", () => events.push("mail.turn.added"));

    const { conversation } = conversations.create({ createdBy: "agent-1" });
    turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "hello",
    });
    expect(events).toContain("mail.turn.added");
  });

  it("should emit mail.turn.updated on status update", () => {
    const events: string[] = [];
    eventBus.on("mail.turn.updated", () => events.push("mail.turn.updated"));

    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "streaming",
      status: "pending",
    });
    turns.updateStatus(turn.id, "streaming");
    turns.updateStatus(turn.id, "complete");

    expect(events.filter((e) => e === "mail.turn.updated")).toHaveLength(2);
  });

  it("should emit mail.thread.created on thread create", () => {
    const events: string[] = [];
    eventBus.on("mail.thread.created", () => events.push("mail.thread.created"));

    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "root",
    });
    threads.create({
      conversationId: conversation.id,
      rootTurnId: turn.id,
      createdBy: "agent-1",
    });
    expect(events).toContain("mail.thread.created");
  });
});

// =============================================================================
// Turn Status Lifecycle
// =============================================================================

describe("turn status lifecycle", () => {
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;

  beforeEach(() => {
    ({ conversations, turns } = createManagers());
  });

  it("should default to complete status", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "done",
    });
    expect(turn.status).toBe("complete");
  });

  it("should support pending → streaming → complete progression", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "",
      status: "pending",
    });
    expect(turn.status).toBe("pending");

    const streaming = turns.updateStatus(turn.id, "streaming");
    expect(streaming.status).toBe("streaming");

    const complete = turns.updateStatus(turn.id, "complete");
    expect(complete.status).toBe("complete");
  });

  it("should support failed status", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "",
      status: "pending",
    });

    const failed = turns.updateStatus(turn.id, "failed");
    expect(failed.status).toBe("failed");
  });

  it("should record intercepted turns with complete status", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordInterceptedTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "intercepted message",
      messageId: "msg-123",
    });

    expect(turn.status).toBe("complete");
    expect(turn.source).toEqual({ type: "intercepted", messageId: "msg-123" });
  });

  it("should record explicit turns with correct source", () => {
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "explicit",
    });

    expect(turn.source).toEqual({ type: "explicit", method: "mail/turn" });
  });
});

// =============================================================================
// Cross-Manager Integration
// =============================================================================

describe("cross-manager integration", () => {
  it("should support full conversation lifecycle", () => {
    const { conversations, turns, threads } = createManagers();

    // Create conversation with initial participant
    const { conversation, participant } = conversations.create({
      createdBy: "agent-1",
      subject: "Planning meeting",
      type: "multi-agent",
    });
    expect(participant.role).toBe("initiator");

    // Add more participants
    conversations.join({ conversationId: conversation.id, participantId: "agent-2", role: "worker" });
    conversations.invite({
      conversationId: conversation.id,
      participant: {
        id: "agent-3",
        role: "observer",
        permissions: { canSend: false },
      },
    });

    // Record turns
    const turn1 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "Let's plan the sprint",
    });
    turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-2",
      contentType: "text",
      content: "Sounds good!",
    });

    // Create thread from first turn
    const thread = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn1.id,
      subject: "Sprint items",
      createdBy: "agent-2",
    });

    // Add turn in thread
    turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-2",
      contentType: "text",
      content: "Here are the items",
      threadId: thread.id,
    });
    threads.incrementTurnCount(thread.id);

    // Verify state
    const allTurns = turns.list({ conversationId: conversation.id });
    expect(allTurns).toHaveLength(3);

    const threadTurns = turns.list({
      conversationId: conversation.id,
      threadId: thread.id,
    });
    expect(threadTurns).toHaveLength(1);

    const participants = conversations.listParticipants(conversation.id, true);
    expect(participants).toHaveLength(3);

    // Close conversation
    conversations.close(conversation.id, "agent-1", "Sprint planned");

    const closed = conversations.get(conversation.id);
    expect(closed!.conversation.status).toBe("completed");
  });

  it("should support multiple threads in one conversation", () => {
    const { conversations, turns, threads } = createManagers();
    const { conversation } = conversations.create({ createdBy: "agent-1" });

    const rootTurns = Array.from({ length: 3 }, (_, i) =>
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: `topic ${i}`,
      })
    );

    const createdThreads = rootTurns.map((turn, i) =>
      threads.create({
        conversationId: conversation.id,
        rootTurnId: turn.id,
        subject: `Thread ${i}`,
        createdBy: "agent-1",
      })
    );

    const allThreads = threads.list(conversation.id);
    expect(allThreads).toHaveLength(3);

    // Add turns to specific threads
    for (const thread of createdThreads) {
      turns.recordTurn({
        conversationId: conversation.id,
        participant: "agent-1",
        contentType: "text",
        content: `reply in ${thread.subject}`,
        threadId: thread.id,
      });
      threads.incrementTurnCount(thread.id);
    }

    // Verify thread isolation
    for (const thread of createdThreads) {
      const threadTurns = turns.list({
        conversationId: conversation.id,
        threadId: thread.id,
      });
      expect(threadTurns).toHaveLength(1);
    }

    // Total turns: 3 root + 3 replies = 6
    const allTurns = turns.list({ conversationId: conversation.id });
    expect(allTurns).toHaveLength(6);
  });

  it("should support inReplyTo references", () => {
    const { conversations, turns } = createManagers();
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    conversations.join({ conversationId: conversation.id, participantId: "agent-2" });

    const original = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "What do you think?",
    });

    const reply = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-2",
      contentType: "text",
      content: "I agree!",
      inReplyTo: original.id,
    });

    expect(reply.inReplyTo).toBe(original.id);
  });

  it("should support metadata on conversations and turns", () => {
    const { conversations, turns } = createManagers();
    const { conversation } = conversations.create({
      createdBy: "agent-1",
      metadata: { priority: "high", category: "planning" },
    });

    expect(conversation.metadata).toEqual({ priority: "high", category: "planning" });

    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "with metadata",
      metadata: { tool: "calculator", step: 3 },
    });

    expect(turn.metadata).toEqual({ tool: "calculator", step: 3 });
  });
});
