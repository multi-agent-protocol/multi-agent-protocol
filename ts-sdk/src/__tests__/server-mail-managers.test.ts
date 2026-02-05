/**
 * Tests for Mail manager implementations.
 *
 * Covers:
 * - ConversationManagerImpl
 * - TurnManagerImpl
 * - ThreadManagerImpl
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBusImpl } from "../server/events";
import {
  ConversationManagerImpl,
  ConversationNotFoundError,
  ConversationClosedError,
  ParticipantAlreadyJoinedError,
  ParticipantNotFoundError,
  TurnManagerImpl,
  TurnNotFoundError,
  TurnConversationNotFoundError,
  InvalidContentTypeError,
  validateContentType,
  ThreadManagerImpl,
  ThreadNotFoundError,
  RootTurnNotFoundError,
  RootTurnConversationMismatchError,
  ParentThreadNotFoundError,
  InMemoryTurnStore,
} from "../server/mail";
import type { EventBus } from "../server/types";

// =============================================================================
// ConversationManager
// =============================================================================

describe("ConversationManagerImpl", () => {
  let eventBus: EventBus;
  let conversations: ConversationManagerImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    conversations = new ConversationManagerImpl({ eventBus });
  });

  describe("create", () => {
    it("should create a conversation with defaults", () => {
      const { conversation, participant } = conversations.create({
        createdBy: "user-1",
      });

      expect(conversation.id).toMatch(/^conv-/);
      expect(conversation.type).toBe("multi-agent");
      expect(conversation.status).toBe("active");
      expect(conversation.createdBy).toBe("user-1");
      expect(conversation.participantCount).toBe(1);

      expect(participant.id).toBe("user-1");
      expect(participant.role).toBe("initiator");
      expect(participant.conversationId).toBe(conversation.id);
    });

    it("should create with custom type and subject", () => {
      const { conversation } = conversations.create({
        type: "user-session",
        subject: "Design Review",
        createdBy: "user-1",
      });

      expect(conversation.type).toBe("user-session");
      expect(conversation.subject).toBe("Design Review");
    });

    it("should create with metadata", () => {
      const { conversation } = conversations.create({
        createdBy: "user-1",
        metadata: { priority: "high" },
      });

      expect(conversation.metadata).toEqual({ priority: "high" });
    });

    it("should add initial participants", () => {
      const { conversation } = conversations.create({
        createdBy: "user-1",
        initialParticipants: [
          { id: "agent-1", role: "assistant" },
          { id: "agent-2", role: "worker" },
        ],
      });

      expect(conversation.participantCount).toBe(3); // creator + 2

      const participants = conversations.listParticipants(conversation.id);
      expect(participants).toHaveLength(3);
    });

    it("should support parent conversation", () => {
      const { conversation: parent } = conversations.create({ createdBy: "user-1" });
      const { conversation: child } = conversations.create({
        createdBy: "user-1",
        parentConversationId: parent.id,
      });

      expect(child.parentConversationId).toBe(parent.id);
    });

    it("should throw when parent conversation not found", () => {
      expect(() =>
        conversations.create({
          createdBy: "user-1",
          parentConversationId: "nonexistent",
        })
      ).toThrow(ConversationNotFoundError);
    });

    it("should emit mail.created event", () => {
      const handler = vi.fn();
      eventBus.on("mail.created", handler);

      const { conversation } = conversations.create({
        createdBy: "user-1",
        subject: "Test",
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mail.created",
          data: expect.objectContaining({
            conversationId: conversation.id,
            createdBy: "user-1",
            subject: "Test",
          }),
        })
      );
    });

    it("should emit mail.participant.joined for creator and initial participants", () => {
      const handler = vi.fn();
      eventBus.on("mail.participant.joined", handler);

      conversations.create({
        createdBy: "user-1",
        initialParticipants: [{ id: "agent-1" }],
      });

      expect(handler).toHaveBeenCalledTimes(2); // creator + agent-1
    });
  });

  describe("get", () => {
    it("should get a conversation by ID", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      const result = conversations.get(conversation.id);
      expect(result).toBeDefined();
      expect(result!.conversation.id).toBe(conversation.id);
    });

    it("should return undefined for unknown ID", () => {
      expect(conversations.get("unknown")).toBeUndefined();
    });

    it("should include participants when requested", () => {
      const { conversation } = conversations.create({
        createdBy: "user-1",
        initialParticipants: [{ id: "agent-1" }],
      });

      const result = conversations.get(conversation.id, { participants: true });
      expect(result!.participants).toHaveLength(2);
    });
  });

  describe("list", () => {
    it("should list all conversations", () => {
      conversations.create({ createdBy: "user-1" });
      conversations.create({ createdBy: "user-2" });

      expect(conversations.list()).toHaveLength(2);
    });

    it("should filter by status", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.create({ createdBy: "user-2" });
      conversations.close(conversation.id, "user-1");

      const active = conversations.list({ status: ["active"] });
      expect(active).toHaveLength(1);
    });
  });

  describe("close", () => {
    it("should close a conversation", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      const closed = conversations.close(conversation.id, "user-1");

      expect(closed.status).toBe("completed");
      expect(closed.closedAt).toBeDefined();
    });

    it("should throw when conversation not found", () => {
      expect(() => conversations.close("unknown", "user-1")).toThrow(
        ConversationNotFoundError
      );
    });

    it("should throw when already closed", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.close(conversation.id, "user-1");

      expect(() => conversations.close(conversation.id, "user-1")).toThrow(
        ConversationClosedError
      );
    });

    it("should emit mail.closed event", () => {
      const handler = vi.fn();
      eventBus.on("mail.closed", handler);

      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.close(conversation.id, "user-1", "done");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mail.closed",
          data: expect.objectContaining({
            conversationId: conversation.id,
            closedBy: "user-1",
            reason: "done",
          }),
        })
      );
    });
  });

  describe("join", () => {
    it("should add a participant to a conversation", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });

      const result = conversations.join({
        conversationId: conversation.id,
        participantId: "agent-1",
        type: "agent",
        role: "assistant",
        agentInfo: { agentId: "a1", name: "Helper" },
      });

      expect(result.participant.id).toBe("agent-1");
      expect(result.participant.role).toBe("assistant");
      expect(result.participant.agentInfo).toEqual({ agentId: "a1", name: "Helper" });
      expect(result.conversation.participantCount).toBe(2);
    });

    it("should throw when conversation not found", () => {
      expect(() =>
        conversations.join({
          conversationId: "unknown",
          participantId: "agent-1",
        })
      ).toThrow(ConversationNotFoundError);
    });

    it("should throw when conversation is closed", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.close(conversation.id, "user-1");

      expect(() =>
        conversations.join({
          conversationId: conversation.id,
          participantId: "agent-1",
        })
      ).toThrow(ConversationClosedError);
    });

    it("should throw when participant already joined", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });

      expect(() =>
        conversations.join({
          conversationId: conversation.id,
          participantId: "user-1",
        })
      ).toThrow(ParticipantAlreadyJoinedError);
    });

    it("should emit mail.participant.joined event", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });

      const handler = vi.fn();
      eventBus.on("mail.participant.joined", handler);

      conversations.join({
        conversationId: conversation.id,
        participantId: "agent-1",
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mail.participant.joined",
          data: expect.objectContaining({
            conversationId: conversation.id,
            participant: expect.objectContaining({ id: "agent-1" }),
          }),
        })
      );
    });
  });

  describe("leave", () => {
    it("should mark a participant as left", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.join({
        conversationId: conversation.id,
        participantId: "agent-1",
      });

      conversations.leave(conversation.id, "agent-1");

      const participant = conversations.getParticipant(conversation.id, "agent-1");
      expect(participant!.leftAt).toBeDefined();

      const updated = conversations.get(conversation.id)!.conversation;
      expect(updated.participantCount).toBe(1); // only creator left
    });

    it("should throw when conversation not found", () => {
      expect(() => conversations.leave("unknown", "user-1")).toThrow(
        ConversationNotFoundError
      );
    });

    it("should throw when participant not found", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      expect(() => conversations.leave(conversation.id, "nonexistent")).toThrow(
        ParticipantNotFoundError
      );
    });

    it("should throw when participant already left", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.join({
        conversationId: conversation.id,
        participantId: "agent-1",
      });
      conversations.leave(conversation.id, "agent-1");

      expect(() => conversations.leave(conversation.id, "agent-1")).toThrow(
        ParticipantNotFoundError
      );
    });

    it("should emit mail.participant.left event", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.join({
        conversationId: conversation.id,
        participantId: "agent-1",
      });

      const handler = vi.fn();
      eventBus.on("mail.participant.left", handler);

      conversations.leave(conversation.id, "agent-1", "task complete");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mail.participant.left",
          data: expect.objectContaining({
            conversationId: conversation.id,
            participantId: "agent-1",
            reason: "task complete",
          }),
        })
      );
    });
  });

  describe("invite", () => {
    it("should invite a participant", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });

      const participant = conversations.invite({
        conversationId: conversation.id,
        participant: { id: "agent-1", role: "worker" },
      });

      expect(participant.id).toBe("agent-1");
      expect(participant.role).toBe("worker");
    });

    it("should throw when conversation not found", () => {
      expect(() =>
        conversations.invite({
          conversationId: "unknown",
          participant: { id: "agent-1" },
        })
      ).toThrow(ConversationNotFoundError);
    });

    it("should throw when already joined", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });

      expect(() =>
        conversations.invite({
          conversationId: conversation.id,
          participant: { id: "user-1" },
        })
      ).toThrow(ParticipantAlreadyJoinedError);
    });
  });

  describe("join with custom permissions", () => {
    it("should apply custom permissions on join", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });

      const { participant } = conversations.join({
        conversationId: conversation.id,
        participantId: "agent-1",
        permissions: {
          canSend: false,
          canInvite: true,
          historyAccess: "from-join",
        },
      });

      expect(participant.permissions.canSend).toBe(false);
      expect(participant.permissions.canInvite).toBe(true);
      expect(participant.permissions.historyAccess).toBe("from-join");
      // Defaults should still apply for unspecified fields
      expect(participant.permissions.canObserve).toBe(true);
    });
  });

  describe("invite with details", () => {
    it("should apply custom permissions and agentInfo on invite", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });

      const participant = conversations.invite({
        conversationId: conversation.id,
        participant: {
          id: "agent-1",
          type: "agent",
          role: "worker",
          permissions: { canCreateThreads: false },
          agentInfo: { agentId: "a1", name: "Worker Bot", role: "translator" },
        },
      });

      expect(participant.type).toBe("agent");
      expect(participant.permissions.canCreateThreads).toBe(false);
      expect(participant.agentInfo).toEqual({
        agentId: "a1",
        name: "Worker Bot",
        role: "translator",
      });
    });

    it("should throw when inviting to a closed conversation", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.close(conversation.id, "user-1");

      expect(() =>
        conversations.invite({
          conversationId: conversation.id,
          participant: { id: "agent-1" },
        })
      ).toThrow(ConversationClosedError);
    });
  });

  describe("create with initialParticipants agentInfo", () => {
    it("should pass agentInfo to initial participants", () => {
      const { conversation } = conversations.create({
        createdBy: "user-1",
        initialParticipants: [
          {
            id: "agent-1",
            type: "agent",
            role: "assistant",
            agentInfo: { agentId: "a1", name: "Helper" },
          },
        ],
      });

      const participants = conversations.listParticipants(conversation.id);
      const agent = participants.find((p) => p.id === "agent-1");
      expect(agent).toBeDefined();
      expect(agent!.agentInfo).toEqual({ agentId: "a1", name: "Helper" });
      expect(agent!.type).toBe("agent");
    });
  });

  describe("create with parentTurnId", () => {
    it("should set parentTurnId on child conversation", () => {
      const { conversation: parent } = conversations.create({ createdBy: "user-1" });
      const { conversation: child } = conversations.create({
        createdBy: "user-1",
        parentConversationId: parent.id,
        parentTurnId: "turn-xyz",
      });

      expect(child.parentTurnId).toBe("turn-xyz");
    });
  });

  describe("getParticipant", () => {
    it("should get a specific participant", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      const participant = conversations.getParticipant(conversation.id, "user-1");

      expect(participant).toBeDefined();
      expect(participant!.id).toBe("user-1");
      expect(participant!.role).toBe("initiator");
    });

    it("should return undefined for non-member", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      expect(conversations.getParticipant(conversation.id, "nobody")).toBeUndefined();
    });
  });

  describe("list with type filter", () => {
    it("should filter conversations by type", () => {
      conversations.create({ createdBy: "user-1", type: "user-session" });
      conversations.create({ createdBy: "user-1", type: "multi-agent" });
      conversations.create({ createdBy: "user-1", type: "agent-task" });

      const results = conversations.list({ type: ["user-session", "agent-task"] });
      expect(results).toHaveLength(2);
    });
  });

  describe("listParticipants", () => {
    it("should list active participants", () => {
      const { conversation } = conversations.create({ createdBy: "user-1" });
      conversations.join({
        conversationId: conversation.id,
        participantId: "agent-1",
      });
      conversations.leave(conversation.id, "agent-1");

      const active = conversations.listParticipants(conversation.id, true);
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("user-1");

      const all = conversations.listParticipants(conversation.id);
      expect(all).toHaveLength(2);
    });
  });
});

// =============================================================================
// TurnManager
// =============================================================================

describe("TurnManagerImpl", () => {
  let eventBus: EventBus;
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;
  let conversationId: string;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    conversations = new ConversationManagerImpl({ eventBus });
    turns = new TurnManagerImpl({ eventBus, conversations });

    const { conversation } = conversations.create({ createdBy: "user-1" });
    conversationId = conversation.id;
  });

  describe("validateContentType", () => {
    it("should accept well-known content types", () => {
      expect(() => validateContentType("text")).not.toThrow();
      expect(() => validateContentType("data")).not.toThrow();
      expect(() => validateContentType("event")).not.toThrow();
      expect(() => validateContentType("reference")).not.toThrow();
    });

    it("should accept custom x- content types", () => {
      expect(() => validateContentType("x-tool-call")).not.toThrow();
      expect(() => validateContentType("x-custom")).not.toThrow();
    });

    it("should reject invalid content types", () => {
      expect(() => validateContentType("invalid")).toThrow(InvalidContentTypeError);
      expect(() => validateContentType("x-")).toThrow(InvalidContentTypeError);
      expect(() => validateContentType("")).toThrow(InvalidContentTypeError);
    });
  });

  describe("recordTurn", () => {
    it("should record an explicit turn", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "Hello world",
      });

      expect(turn.id).toMatch(/^turn-/);
      expect(turn.conversationId).toBe(conversationId);
      expect(turn.participant).toBe("user-1");
      expect(turn.contentType).toBe("text");
      expect(turn.content).toBe("Hello world");
      expect(turn.source).toEqual({ type: "explicit", method: "mail/turn" });
      expect(turn.status).toBe("complete");
    });

    it("should record with thread and reply", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "Reply",
        threadId: "thread-1",
        inReplyTo: "turn-prev",
      });

      expect(turn.threadId).toBe("thread-1");
      expect(turn.inReplyTo).toBe("turn-prev");
    });

    it("should record with visibility", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "Private",
        visibility: { type: "private" },
      });

      expect(turn.visibility).toEqual({ type: "private" });
    });

    it("should record with streaming status", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "",
        status: "streaming",
      });

      expect(turn.status).toBe("streaming");
    });

    it("should throw for invalid content type", () => {
      expect(() =>
        turns.recordTurn({
          conversationId,
          participant: "user-1",
          contentType: "bogus",
          content: "test",
        })
      ).toThrow(InvalidContentTypeError);
    });

    it("should throw when conversation not found", () => {
      expect(() =>
        turns.recordTurn({
          conversationId: "nonexistent",
          participant: "user-1",
          contentType: "text",
          content: "test",
        })
      ).toThrow(TurnConversationNotFoundError);
    });

    it("should emit mail.turn.added event", () => {
      const handler = vi.fn();
      eventBus.on("mail.turn.added", handler);

      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "Hello",
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mail.turn.added",
          data: expect.objectContaining({
            conversationId,
            turn: expect.objectContaining({ id: turn.id }),
          }),
        })
      );
    });
  });

  describe("recordInterceptedTurn", () => {
    it("should record an intercepted turn from map/send", () => {
      const turn = turns.recordInterceptedTurn({
        conversationId,
        participant: "agent-1",
        contentType: "text",
        content: "Response",
        messageId: "msg-123",
      });

      expect(turn.source).toEqual({ type: "intercepted", messageId: "msg-123" });
      expect(turn.status).toBe("complete");
    });

    it("should throw for invalid content type", () => {
      expect(() =>
        turns.recordInterceptedTurn({
          conversationId,
          participant: "agent-1",
          contentType: "bad",
          content: "test",
          messageId: "msg-1",
        })
      ).toThrow(InvalidContentTypeError);
    });
  });

  describe("get", () => {
    it("should get a turn by ID", () => {
      const recorded = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "Hello",
      });

      const turn = turns.get(recorded.id);
      expect(turn).toBeDefined();
      expect(turn!.id).toBe(recorded.id);
    });

    it("should return undefined for unknown ID", () => {
      expect(turns.get("unknown")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("should list turns for a conversation", () => {
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "text", content: "1" });
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "text", content: "2" });
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "data", content: {} });

      expect(turns.list({ conversationId })).toHaveLength(3);
    });

    it("should filter by content type", () => {
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "text", content: "1" });
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "data", content: {} });

      const results = turns.list({ conversationId, contentTypes: ["text"] });
      expect(results).toHaveLength(1);
    });

    it("should paginate with limit", () => {
      for (let i = 0; i < 5; i++) {
        turns.recordTurn({ conversationId, participant: "user-1", contentType: "text", content: `${i}` });
      }

      const page = turns.list({ conversationId, limit: 2 });
      expect(page).toHaveLength(2);
    });
  });

  describe("updateStatus", () => {
    it("should update turn status", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "",
        status: "streaming",
      });

      const updated = turns.updateStatus(turn.id, "complete");
      expect(updated.status).toBe("complete");

      // Verify persisted
      expect(turns.get(turn.id)!.status).toBe("complete");
    });

    it("should throw when turn not found", () => {
      expect(() => turns.updateStatus("unknown", "complete")).toThrow(TurnNotFoundError);
    });

    it("should emit mail.turn.updated event", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "",
        status: "streaming",
      });

      const handler = vi.fn();
      eventBus.on("mail.turn.updated", handler);

      turns.updateStatus(turn.id, "complete");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mail.turn.updated",
          data: expect.objectContaining({
            conversationId,
            turnId: turn.id,
            status: "complete",
          }),
        })
      );
    });
  });

  describe("count", () => {
    it("should count turns in a conversation", () => {
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "text", content: "1" });
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "text", content: "2" });

      expect(turns.count(conversationId)).toBe(2);
    });

    it("should return 0 for empty conversation", () => {
      expect(turns.count(conversationId)).toBe(0);
    });

    it("should count turns by thread", () => {
      turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "in thread",
        threadId: "thread-1",
      });
      turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "in thread",
        threadId: "thread-1",
      });
      turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "no thread",
      });

      expect(turns.count(conversationId, "thread-1")).toBe(2);
      expect(turns.count(conversationId)).toBe(3);
    });
  });

  describe("recordTurn with metadata", () => {
    it("should store metadata on turn", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "Hello",
        metadata: { source: "api", priority: 1 },
      });

      expect(turn.metadata).toEqual({ source: "api", priority: 1 });
      expect(turns.get(turn.id)!.metadata).toEqual({ source: "api", priority: 1 });
    });

    it("should default metadata to empty object", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "text",
        content: "Hello",
      });

      expect(turn.metadata).toEqual({});
    });
  });

  describe("recordTurn with custom x- content type", () => {
    it("should accept custom x- content types", () => {
      const turn = turns.recordTurn({
        conversationId,
        participant: "user-1",
        contentType: "x-tool-call",
        content: { tool: "search", args: { query: "test" } },
      });

      expect(turn.contentType).toBe("x-tool-call");
      expect(turn.content).toEqual({ tool: "search", args: { query: "test" } });
    });
  });

  describe("recordInterceptedTurn with all optional fields", () => {
    it("should record intercepted turn with threadId, inReplyTo, visibility, and metadata", () => {
      const turn = turns.recordInterceptedTurn({
        conversationId,
        participant: "agent-1",
        contentType: "text",
        content: "Intercepted reply",
        messageId: "msg-456",
        threadId: "thread-1",
        inReplyTo: "turn-prev",
        visibility: { type: "role", roles: ["assistant"] },
        metadata: { interceptedFrom: "map/send" },
      });

      expect(turn.source).toEqual({ type: "intercepted", messageId: "msg-456" });
      expect(turn.threadId).toBe("thread-1");
      expect(turn.inReplyTo).toBe("turn-prev");
      expect(turn.visibility).toEqual({ type: "role", roles: ["assistant"] });
      expect(turn.metadata).toEqual({ interceptedFrom: "map/send" });
    });
  });

  describe("list by participant", () => {
    it("should filter turns by participant", () => {
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "text", content: "a" });
      turns.recordTurn({ conversationId, participant: "agent-1", contentType: "text", content: "b" });
      turns.recordTurn({ conversationId, participant: "user-1", contentType: "text", content: "c" });

      const results = turns.list({ conversationId, participantId: "agent-1" });
      expect(results).toHaveLength(1);
      expect(results[0].participant).toBe("agent-1");
    });
  });
});

// =============================================================================
// ThreadManager
// =============================================================================

describe("ThreadManagerImpl", () => {
  let eventBus: EventBus;
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;
  let threads: ThreadManagerImpl;
  let conversationId: string;
  let rootTurnId: string;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    conversations = new ConversationManagerImpl({ eventBus });
    turns = new TurnManagerImpl({ eventBus, conversations });

    // ThreadManager needs the raw TurnStore — create a shared instance
    const turnStore = new InMemoryTurnStore();
    turns = new TurnManagerImpl({ eventBus, conversations, store: turnStore });
    threads = new ThreadManagerImpl({ eventBus, turnStore });

    const { conversation } = conversations.create({ createdBy: "user-1" });
    conversationId = conversation.id;

    const turn = turns.recordTurn({
      conversationId,
      participant: "user-1",
      contentType: "text",
      content: "Root message",
    });
    rootTurnId = turn.id;
  });

  describe("create", () => {
    it("should create a thread rooted at a turn", () => {
      const thread = threads.create({
        conversationId,
        rootTurnId,
        subject: "Side discussion",
        createdBy: "user-1",
      });

      expect(thread.id).toMatch(/^thread-/);
      expect(thread.conversationId).toBe(conversationId);
      expect(thread.rootTurnId).toBe(rootTurnId);
      expect(thread.subject).toBe("Side discussion");
      expect(thread.createdBy).toBe("user-1");
      expect(thread.turnCount).toBe(0);
      expect(thread.participantCount).toBe(0);
    });

    it("should create a nested thread", () => {
      const parent = threads.create({
        conversationId,
        rootTurnId,
        createdBy: "user-1",
      });

      const child = threads.create({
        conversationId,
        rootTurnId,
        parentThreadId: parent.id,
        createdBy: "user-1",
      });

      expect(child.parentThreadId).toBe(parent.id);
    });

    it("should throw when root turn not found", () => {
      expect(() =>
        threads.create({
          conversationId,
          rootTurnId: "nonexistent",
          createdBy: "user-1",
        })
      ).toThrow(RootTurnNotFoundError);
    });

    it("should throw when root turn belongs to different conversation", () => {
      const { conversation: other } = conversations.create({ createdBy: "user-2" });
      const otherTurn = turns.recordTurn({
        conversationId: other.id,
        participant: "user-2",
        contentType: "text",
        content: "Other",
      });

      expect(() =>
        threads.create({
          conversationId,
          rootTurnId: otherTurn.id,
          createdBy: "user-1",
        })
      ).toThrow(RootTurnConversationMismatchError);
    });

    it("should throw when parent thread not found", () => {
      expect(() =>
        threads.create({
          conversationId,
          rootTurnId,
          parentThreadId: "nonexistent",
          createdBy: "user-1",
        })
      ).toThrow(ParentThreadNotFoundError);
    });

    it("should emit mail.thread.created event", () => {
      const handler = vi.fn();
      eventBus.on("mail.thread.created", handler);

      const thread = threads.create({
        conversationId,
        rootTurnId,
        createdBy: "user-1",
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mail.thread.created",
          data: expect.objectContaining({
            conversationId,
            thread: expect.objectContaining({ id: thread.id }),
          }),
        })
      );
    });
  });

  describe("get", () => {
    it("should get a thread by ID", () => {
      const created = threads.create({
        conversationId,
        rootTurnId,
        createdBy: "user-1",
      });

      const thread = threads.get(created.id);
      expect(thread).toBeDefined();
      expect(thread!.id).toBe(created.id);
    });

    it("should return undefined for unknown ID", () => {
      expect(threads.get("unknown")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("should list threads in a conversation", () => {
      threads.create({ conversationId, rootTurnId, createdBy: "user-1" });
      threads.create({ conversationId, rootTurnId, createdBy: "user-1" });

      expect(threads.list(conversationId)).toHaveLength(2);
    });

    it("should filter by parent thread", () => {
      const parent = threads.create({ conversationId, rootTurnId, createdBy: "user-1" });
      threads.create({
        conversationId,
        rootTurnId,
        parentThreadId: parent.id,
        createdBy: "user-1",
      });
      threads.create({ conversationId, rootTurnId, createdBy: "user-1" });

      const children = threads.list(conversationId, parent.id);
      expect(children).toHaveLength(1);
    });

    it("should return empty for unknown conversation", () => {
      expect(threads.list("unknown")).toHaveLength(0);
    });
  });

  describe("incrementTurnCount", () => {
    it("should increment turn count", () => {
      const thread = threads.create({ conversationId, rootTurnId, createdBy: "user-1" });

      threads.incrementTurnCount(thread.id);
      threads.incrementTurnCount(thread.id);

      expect(threads.get(thread.id)!.turnCount).toBe(2);
    });

    it("should throw when thread not found", () => {
      expect(() => threads.incrementTurnCount("unknown")).toThrow(ThreadNotFoundError);
    });
  });

  describe("incrementParticipantCount", () => {
    it("should increment participant count", () => {
      const thread = threads.create({ conversationId, rootTurnId, createdBy: "user-1" });

      threads.incrementParticipantCount(thread.id);

      expect(threads.get(thread.id)!.participantCount).toBe(1);
    });

    it("should throw when thread not found", () => {
      expect(() => threads.incrementParticipantCount("unknown")).toThrow(ThreadNotFoundError);
    });
  });

  describe("updatedAt tracking", () => {
    it("should update updatedAt on incrementTurnCount", () => {
      const thread = threads.create({ conversationId, rootTurnId, createdBy: "user-1" });
      const originalUpdatedAt = thread.updatedAt;

      threads.incrementTurnCount(thread.id);

      const updated = threads.get(thread.id)!;
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it("should update updatedAt on incrementParticipantCount", () => {
      const thread = threads.create({ conversationId, rootTurnId, createdBy: "user-1" });
      const originalUpdatedAt = thread.updatedAt;

      threads.incrementParticipantCount(thread.id);

      const updated = threads.get(thread.id)!;
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });
  });
});

// =============================================================================
// Cross-Manager Integration
// =============================================================================

describe("Mail managers integration", () => {
  let eventBus: EventBus;
  let conversations: ConversationManagerImpl;
  let turns: TurnManagerImpl;
  let threads: ThreadManagerImpl;
  let turnStore: InstanceType<typeof InMemoryTurnStore>;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    conversations = new ConversationManagerImpl({ eventBus });
    turnStore = new InMemoryTurnStore();
    turns = new TurnManagerImpl({ eventBus, conversations, store: turnStore });
    threads = new ThreadManagerImpl({ eventBus, turnStore });
  });

  it("should support full conversation lifecycle", () => {
    // 1. Create conversation with initial participants
    const { conversation } = conversations.create({
      createdBy: "user-1",
      subject: "Design Discussion",
      initialParticipants: [
        { id: "agent-1", type: "agent", role: "assistant" },
      ],
    });
    expect(conversation.participantCount).toBe(2);

    // 2. Record turns
    const turn1 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "user-1",
      contentType: "text",
      content: "What about using React?",
    });

    const turn2 = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "React is a good choice. Let me elaborate.",
      inReplyTo: turn1.id,
    });

    expect(turns.count(conversation.id)).toBe(2);

    // 3. Create a thread from a turn
    const thread = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn2.id,
      subject: "React deep dive",
      createdBy: "user-1",
    });
    expect(thread.rootTurnId).toBe(turn2.id);

    // 4. Record turns in the thread
    turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "React has virtual DOM...",
      threadId: thread.id,
    });
    threads.incrementTurnCount(thread.id);

    expect(turns.count(conversation.id, thread.id)).toBe(1);
    expect(threads.get(thread.id)!.turnCount).toBe(1);

    // 5. Another agent joins
    const { participant: agent2 } = conversations.join({
      conversationId: conversation.id,
      participantId: "agent-2",
      type: "agent",
      role: "worker",
      agentInfo: { agentId: "a2", name: "Reviewer" },
    });
    expect(agent2.agentInfo?.name).toBe("Reviewer");
    expect(conversations.get(conversation.id)!.conversation.participantCount).toBe(3);

    // 6. Agent leaves
    conversations.leave(conversation.id, "agent-2", "review complete");
    expect(conversations.get(conversation.id)!.conversation.participantCount).toBe(2);

    // 7. Close conversation
    const closed = conversations.close(conversation.id, "user-1", "discussion complete");
    expect(closed.status).toBe("completed");
    expect(closed.closedAt).toBeDefined();
  });

  it("should track events across all managers", () => {
    const events: string[] = [];
    eventBus.on("*", (event) => {
      events.push(event.type);
    });

    // Create conversation (emits participant.joined + created)
    const { conversation } = conversations.create({ createdBy: "user-1" });

    // Record a turn (emits turn.added)
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "user-1",
      contentType: "text",
      content: "Hello",
    });

    // Create thread (emits thread.created)
    threads.create({
      conversationId: conversation.id,
      rootTurnId: turn.id,
      createdBy: "user-1",
    });

    // Close conversation (emits closed)
    conversations.close(conversation.id, "user-1");

    expect(events).toContain("mail.participant.joined");
    expect(events).toContain("mail.created");
    expect(events).toContain("mail.turn.added");
    expect(events).toContain("mail.thread.created");
    expect(events).toContain("mail.closed");
  });

  it("should support intercepted turns in conversations", () => {
    const { conversation } = conversations.create({ createdBy: "user-1" });

    const intercepted = turns.recordInterceptedTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "Auto-captured from map/send",
      messageId: "msg-auto-1",
    });

    expect(intercepted.source.type).toBe("intercepted");
    expect(turns.list({ conversationId: conversation.id })).toHaveLength(1);
  });

  it("should support nested threads", () => {
    const { conversation } = conversations.create({ createdBy: "user-1" });
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "user-1",
      contentType: "text",
      content: "Root",
    });

    const parentThread = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn.id,
      subject: "Main thread",
      createdBy: "user-1",
    });

    const childThread = threads.create({
      conversationId: conversation.id,
      rootTurnId: turn.id,
      parentThreadId: parentThread.id,
      subject: "Sub-thread",
      createdBy: "user-1",
    });

    expect(childThread.parentThreadId).toBe(parentThread.id);
    expect(threads.list(conversation.id, parentThread.id)).toHaveLength(1);
    expect(threads.list(conversation.id)).toHaveLength(2);
  });

  it("should support streaming turn status updates", () => {
    const { conversation } = conversations.create({ createdBy: "user-1" });

    // Start streaming
    const turn = turns.recordTurn({
      conversationId: conversation.id,
      participant: "agent-1",
      contentType: "text",
      content: "",
      status: "streaming",
    });
    expect(turn.status).toBe("streaming");

    // Complete streaming
    const updated = turns.updateStatus(turn.id, "complete");
    expect(updated.status).toBe("complete");
    expect(turns.get(turn.id)!.status).toBe("complete");
  });
});
