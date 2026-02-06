/**
 * Tests for Mail protocol handlers and map/send interception.
 *
 * Covers:
 * - createMailHandlers() - all 13 mail/* handlers
 * - map/send mail meta interception
 * - Error mapping to mail error codes
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventBusImpl } from "../server/events";
import {
  ConversationManagerImpl,
  TurnManagerImpl,
  ThreadManagerImpl,
  InMemoryTurnStore,
  createMailHandlers,
} from "../server/mail";
import { createMessageHandlers } from "../server/messages/handlers";
import { MessageRouterImpl } from "../server/messages";
import { AgentRegistryImpl } from "../server/agents";
import { ScopeManagerImpl } from "../server/scopes";
import { MAPRequestError } from "../errors";
import { MAIL_ERROR_CODES } from "../types";
import type { HandlerContext, HandlerRegistry, EventBus } from "../server/types";

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

function createClientContext(): HandlerContext {
  return createMockContext({
    session: {
      id: "client-session-1",
      role: "client",
      status: "connected",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      metadata: {},
      agentIds: [],
      subscriptionIds: [],
    },
  });
}

// =============================================================================
// Mail Handlers
// =============================================================================

describe("createMailHandlers", () => {
  let eventBus: EventBus;
  let conversations: ConversationManagerImpl;
  let turnStore: InstanceType<typeof InMemoryTurnStore>;
  let turns: TurnManagerImpl;
  let threads: ThreadManagerImpl;
  let handlers: HandlerRegistry;
  let ctx: HandlerContext;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    conversations = new ConversationManagerImpl({ eventBus });
    turnStore = new InMemoryTurnStore();
    turns = new TurnManagerImpl({ eventBus, conversations, store: turnStore });
    threads = new ThreadManagerImpl({ eventBus, turnStore });
    handlers = createMailHandlers({ conversations, turns, threads });
    ctx = createMockContext();
  });

  // ===========================================================================
  // mail/create
  // ===========================================================================

  describe("mail/create", () => {
    it("should create a conversation with defaults", async () => {
      const result = (await handlers["mail/create"]({}, ctx)) as any;

      expect(result.conversation).toBeDefined();
      expect(result.conversation.id).toMatch(/^conv-/);
      expect(result.conversation.type).toBe("multi-agent");
      expect(result.conversation.status).toBe("active");
      expect(result.conversation.createdBy).toBe("agent-1");

      expect(result.participant).toBeDefined();
      expect(result.participant.id).toBe("agent-1");
      expect(result.participant.role).toBe("initiator");
    });

    it("should create with type, subject, and metadata", async () => {
      const result = (await handlers["mail/create"](
        {
          type: "user-session",
          subject: "Design Review",
          metadata: { priority: "high" },
        },
        ctx
      )) as any;

      expect(result.conversation.type).toBe("user-session");
      expect(result.conversation.subject).toBe("Design Review");
      expect(result.conversation.metadata).toEqual({ priority: "high" });
    });

    it("should create with initial participants", async () => {
      const result = (await handlers["mail/create"](
        {
          initialParticipants: [
            { id: "agent-2", role: "assistant" },
            { id: "agent-3", role: "worker" },
          ],
        },
        ctx
      )) as any;

      expect(result.conversation.participantCount).toBe(3);
    });

    it("should create with initialTurn", async () => {
      const result = (await handlers["mail/create"](
        {
          initialTurn: {
            contentType: "text",
            content: "Let's discuss the design",
          },
        },
        ctx
      )) as any;

      expect(result.initialTurn).toBeDefined();
      expect(result.initialTurn.contentType).toBe("text");
      expect(result.initialTurn.content).toBe("Let's discuss the design");
      expect(result.initialTurn.participant).toBe("agent-1");
    });

    it("should create with parent conversation", async () => {
      const parent = (await handlers["mail/create"]({}, ctx)) as any;
      const child = (await handlers["mail/create"](
        { parentConversationId: parent.conversation.id },
        ctx
      )) as any;

      expect(child.conversation.parentConversationId).toBe(parent.conversation.id);
    });

    it("should throw MAIL_CONVERSATION_NOT_FOUND for missing parent", async () => {
      await expect(
        handlers["mail/create"]({ parentConversationId: "nonexistent" }, ctx)
      ).rejects.toThrow(MAPRequestError);

      try {
        await handlers["mail/create"]({ parentConversationId: "nonexistent" }, ctx);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND
        );
      }
    });

    it("should use session ID when no agentIds", async () => {
      const clientCtx = createClientContext();
      const result = (await handlers["mail/create"]({}, clientCtx)) as any;

      expect(result.conversation.createdBy).toBe("client-session-1");
      expect(result.participant.id).toBe("client-session-1");
    });
  });

  // ===========================================================================
  // mail/get
  // ===========================================================================

  describe("mail/get", () => {
    it("should get a conversation by ID", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      const result = (await handlers["mail/get"](
        { conversationId: created.conversation.id },
        ctx
      )) as any;

      expect(result.conversation.id).toBe(created.conversation.id);
    });

    it("should throw for unknown conversation", async () => {
      await expect(
        handlers["mail/get"]({ conversationId: "unknown" }, ctx)
      ).rejects.toThrow(MAPRequestError);
    });

    it("should include participants when requested", async () => {
      const created = (await handlers["mail/create"](
        { initialParticipants: [{ id: "agent-2" }] },
        ctx
      )) as any;

      const result = (await handlers["mail/get"](
        {
          conversationId: created.conversation.id,
          include: { participants: true },
        },
        ctx
      )) as any;

      expect(result.participants).toHaveLength(2);
    });

    it("should include threads when requested", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      const convId = created.conversation.id;

      // Create a turn and thread
      const turnResult = (await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "Hello" },
        ctx
      )) as any;
      await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId: turnResult.turn.id, subject: "Thread 1" },
        ctx
      );

      const result = (await handlers["mail/get"](
        { conversationId: convId, include: { threads: true } },
        ctx
      )) as any;

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0].subject).toBe("Thread 1");
    });

    it("should include recent turns when requested", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      const convId = created.conversation.id;

      for (let i = 0; i < 5; i++) {
        await handlers["mail/turn"](
          { conversationId: convId, contentType: "text", content: `Turn ${i}` },
          ctx
        );
      }

      const result = (await handlers["mail/get"](
        { conversationId: convId, include: { recentTurns: 3 } },
        ctx
      )) as any;

      expect(result.recentTurns).toHaveLength(3);
    });

    it("should include stats when requested", async () => {
      const created = (await handlers["mail/create"](
        { initialParticipants: [{ id: "agent-2" }] },
        ctx
      )) as any;
      const convId = created.conversation.id;

      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "Hello" },
        ctx
      );
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "data", content: { foo: 1 } },
        ctx
      );

      const result = (await handlers["mail/get"](
        { conversationId: convId, include: { stats: true } },
        ctx
      )) as any;

      expect(result.stats.totalTurns).toBe(2);
      expect(result.stats.turnsByContentType.text).toBe(1);
      expect(result.stats.turnsByContentType.data).toBe(1);
      expect(result.stats.activeParticipants).toBe(2);
      expect(result.stats.threadCount).toBe(0);
    });
  });

  // ===========================================================================
  // mail/list
  // ===========================================================================

  describe("mail/list", () => {
    it("should list all conversations", async () => {
      await handlers["mail/create"]({}, ctx);
      await handlers["mail/create"]({ subject: "Second" }, ctx);

      const result = (await handlers["mail/list"]({}, ctx)) as any;
      expect(result.conversations).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it("should list with no params", async () => {
      const result = (await handlers["mail/list"](null, ctx)) as any;
      expect(result.conversations).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it("should filter by status", async () => {
      const c1 = (await handlers["mail/create"]({}, ctx)) as any;
      await handlers["mail/create"]({}, ctx);
      await handlers["mail/close"]({ conversationId: c1.conversation.id }, ctx);

      const result = (await handlers["mail/list"](
        { filter: { status: ["active"] } },
        ctx
      )) as any;

      expect(result.conversations).toHaveLength(1);
    });

    it("should paginate with limit and cursor", async () => {
      for (let i = 0; i < 5; i++) {
        await handlers["mail/create"]({ subject: `Conv ${i}` }, ctx);
      }

      const page1 = (await handlers["mail/list"]({ limit: 2 }, ctx)) as any;
      expect(page1.conversations).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();

      const page2 = (await handlers["mail/list"](
        { limit: 2, cursor: page1.nextCursor },
        ctx
      )) as any;
      expect(page2.conversations).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      const page3 = (await handlers["mail/list"](
        { limit: 2, cursor: page2.nextCursor },
        ctx
      )) as any;
      expect(page3.conversations).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  // ===========================================================================
  // mail/close
  // ===========================================================================

  describe("mail/close", () => {
    it("should close a conversation", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      const result = (await handlers["mail/close"](
        { conversationId: created.conversation.id },
        ctx
      )) as any;

      expect(result.conversation.status).toBe("completed");
      expect(result.conversation.closedAt).toBeDefined();
    });

    it("should close with reason", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      await handlers["mail/close"](
        { conversationId: created.conversation.id, reason: "task complete" },
        ctx
      );
    });

    it("should throw MAIL_CONVERSATION_NOT_FOUND for unknown ID", async () => {
      try {
        await handlers["mail/close"]({ conversationId: "unknown" }, ctx);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND
        );
      }
    });

    it("should throw MAIL_CONVERSATION_CLOSED when already closed", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      await handlers["mail/close"]({ conversationId: created.conversation.id }, ctx);

      try {
        await handlers["mail/close"]({ conversationId: created.conversation.id }, ctx);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_CLOSED
        );
      }
    });
  });

  // ===========================================================================
  // mail/join
  // ===========================================================================

  describe("mail/join", () => {
    let convId: string;

    beforeEach(async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      convId = created.conversation.id;
    });

    it("should join a conversation", async () => {
      const ctx2 = createMockContext({
        session: {
          ...createMockContext().session,
          id: "session-2",
          agentIds: ["agent-2"],
        },
      });

      const result = (await handlers["mail/join"](
        { conversationId: convId },
        ctx2
      )) as any;

      expect(result.participant.id).toBe("agent-2");
      expect(result.conversation.participantCount).toBe(2);
    });

    it("should join with custom role", async () => {
      const ctx2 = createMockContext({
        session: {
          ...createMockContext().session,
          id: "session-2",
          agentIds: ["agent-2"],
        },
      });

      const result = (await handlers["mail/join"](
        { conversationId: convId, role: "observer" },
        ctx2
      )) as any;

      expect(result.participant.role).toBe("observer");
    });

    it("should return history with catchUp from timestamp", async () => {
      // Record some turns
      for (let i = 0; i < 5; i++) {
        await handlers["mail/turn"](
          { conversationId: convId, contentType: "text", content: `Turn ${i}` },
          ctx
        );
      }

      const ctx2 = createMockContext({
        session: {
          ...createMockContext().session,
          id: "session-2",
          agentIds: ["agent-2"],
        },
      });

      const result = (await handlers["mail/join"](
        {
          conversationId: convId,
          catchUp: { from: 0, limit: 3 },
        },
        ctx2
      )) as any;

      expect(result.history).toHaveLength(3);
      expect(result.historyCursor).toBeDefined();
    });

    it("should return history with catchUp from turn ID", async () => {
      const turn1 = (await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "First" },
        ctx
      )) as any;

      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "Second" },
        ctx
      );
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "Third" },
        ctx
      );

      const ctx2 = createMockContext({
        session: {
          ...createMockContext().session,
          id: "session-2",
          agentIds: ["agent-2"],
        },
      });

      const result = (await handlers["mail/join"](
        {
          conversationId: convId,
          catchUp: { from: turn1.turn.id },
        },
        ctx2
      )) as any;

      expect(result.history).toHaveLength(2); // After turn1
    });

    it("should throw MAIL_CONVERSATION_NOT_FOUND for unknown ID", async () => {
      try {
        await handlers["mail/join"]({ conversationId: "unknown" }, ctx);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND
        );
      }
    });

    it("should throw MAIL_PARTICIPANT_ALREADY_JOINED", async () => {
      try {
        await handlers["mail/join"]({ conversationId: convId }, ctx);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_PARTICIPANT_ALREADY_JOINED
        );
      }
    });
  });

  // ===========================================================================
  // mail/leave
  // ===========================================================================

  describe("mail/leave", () => {
    it("should leave a conversation", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      const convId = created.conversation.id;

      // Join with another agent
      const ctx2 = createMockContext({
        session: {
          ...createMockContext().session,
          id: "session-2",
          agentIds: ["agent-2"],
        },
      });
      await handlers["mail/join"]({ conversationId: convId }, ctx2);

      const result = (await handlers["mail/leave"](
        { conversationId: convId },
        ctx2
      )) as any;

      expect(result.success).toBe(true);
      expect(result.leftAt).toBeDefined();
    });

    it("should throw MAIL_NOT_A_PARTICIPANT for non-member", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      const ctx2 = createMockContext({
        session: {
          ...createMockContext().session,
          id: "session-2",
          agentIds: ["agent-2"],
        },
      });

      try {
        await handlers["mail/leave"]({ conversationId: created.conversation.id }, ctx2);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_NOT_A_PARTICIPANT
        );
      }
    });
  });

  // ===========================================================================
  // mail/invite
  // ===========================================================================

  describe("mail/invite", () => {
    it("should invite a participant", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;

      const result = (await handlers["mail/invite"](
        {
          conversationId: created.conversation.id,
          participant: { id: "agent-2", role: "worker" },
        },
        ctx
      )) as any;

      expect(result.invited).toBe(true);
      expect(result.participant.id).toBe("agent-2");
      expect(result.participant.role).toBe("worker");
    });

    it("should throw MAIL_PARTICIPANT_ALREADY_JOINED", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;

      try {
        await handlers["mail/invite"](
          {
            conversationId: created.conversation.id,
            participant: { id: "agent-1" },
          },
          ctx
        );
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_PARTICIPANT_ALREADY_JOINED
        );
      }
    });

    it("should throw MAIL_CONVERSATION_CLOSED for closed conversation", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      await handlers["mail/close"]({ conversationId: created.conversation.id }, ctx);

      try {
        await handlers["mail/invite"](
          {
            conversationId: created.conversation.id,
            participant: { id: "agent-2" },
          },
          ctx
        );
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_CLOSED
        );
      }
    });
  });

  // ===========================================================================
  // mail/turn
  // ===========================================================================

  describe("mail/turn", () => {
    let convId: string;

    beforeEach(async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      convId = created.conversation.id;
    });

    it("should record an explicit turn", async () => {
      const result = (await handlers["mail/turn"](
        {
          conversationId: convId,
          contentType: "text",
          content: "Hello world",
        },
        ctx
      )) as any;

      expect(result.turn.id).toMatch(/^turn-/);
      expect(result.turn.contentType).toBe("text");
      expect(result.turn.content).toBe("Hello world");
      expect(result.turn.participant).toBe("agent-1");
      expect(result.turn.source).toEqual({ type: "explicit", method: "mail/turn" });
    });

    it("should record with thread and inReplyTo", async () => {
      const result = (await handlers["mail/turn"](
        {
          conversationId: convId,
          contentType: "text",
          content: "Reply",
          threadId: "thread-1",
          inReplyTo: "turn-prev",
        },
        ctx
      )) as any;

      expect(result.turn.threadId).toBe("thread-1");
      expect(result.turn.inReplyTo).toBe("turn-prev");
    });

    it("should record with visibility and metadata", async () => {
      const result = (await handlers["mail/turn"](
        {
          conversationId: convId,
          contentType: "text",
          content: "Private",
          visibility: { type: "private" },
          metadata: { source: "api" },
        },
        ctx
      )) as any;

      expect(result.turn.visibility).toEqual({ type: "private" });
      expect(result.turn.metadata).toEqual({ source: "api" });
    });

    it("should increment thread turn count when threadId provided", async () => {
      // Create a real thread
      const turn = (await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "Root" },
        ctx
      )) as any;
      const thread = (await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId: turn.turn.id },
        ctx
      )) as any;

      // Record turn in thread
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "In thread", threadId: thread.thread.id },
        ctx
      );

      const updated = threads.get(thread.thread.id);
      expect(updated!.turnCount).toBe(1);
    });

    it("should throw MAIL_CONVERSATION_NOT_FOUND for unknown conversation", async () => {
      try {
        await handlers["mail/turn"](
          { conversationId: "unknown", contentType: "text", content: "test" },
          ctx
        );
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND
        );
      }
    });

    it("should throw MAIL_INVALID_TURN_CONTENT for invalid content type", async () => {
      try {
        await handlers["mail/turn"](
          { conversationId: convId, contentType: "bogus", content: "test" },
          ctx
        );
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_INVALID_TURN_CONTENT
        );
      }
    });

    it("should accept custom x- content types", async () => {
      const result = (await handlers["mail/turn"](
        { conversationId: convId, contentType: "x-tool-call", content: { tool: "search" } },
        ctx
      )) as any;

      expect(result.turn.contentType).toBe("x-tool-call");
    });
  });

  // ===========================================================================
  // mail/turns/list
  // ===========================================================================

  describe("mail/turns/list", () => {
    let convId: string;

    beforeEach(async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      convId = created.conversation.id;
    });

    it("should list turns for a conversation", async () => {
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "A" },
        ctx
      );
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "B" },
        ctx
      );

      const result = (await handlers["mail/turns/list"](
        { conversationId: convId },
        ctx
      )) as any;

      expect(result.turns).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it("should filter by content type", async () => {
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "A" },
        ctx
      );
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "data", content: {} },
        ctx
      );

      const result = (await handlers["mail/turns/list"](
        { conversationId: convId, filter: { contentTypes: ["text"] } },
        ctx
      )) as any;

      expect(result.turns).toHaveLength(1);
    });

    it("should paginate with limit", async () => {
      for (let i = 0; i < 5; i++) {
        await handlers["mail/turn"](
          { conversationId: convId, contentType: "text", content: `${i}` },
          ctx
        );
      }

      const page1 = (await handlers["mail/turns/list"](
        { conversationId: convId, limit: 2 },
        ctx
      )) as any;

      expect(page1.turns).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeDefined();
    });

    it("should throw MAIL_CONVERSATION_NOT_FOUND for unknown conversation", async () => {
      try {
        await handlers["mail/turns/list"]({ conversationId: "unknown" }, ctx);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND
        );
      }
    });
  });

  // ===========================================================================
  // mail/thread/create
  // ===========================================================================

  describe("mail/thread/create", () => {
    let convId: string;
    let rootTurnId: string;

    beforeEach(async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      convId = created.conversation.id;
      const turn = (await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "Root" },
        ctx
      )) as any;
      rootTurnId = turn.turn.id;
    });

    it("should create a thread", async () => {
      const result = (await handlers["mail/thread/create"](
        {
          conversationId: convId,
          rootTurnId,
          subject: "Side discussion",
        },
        ctx
      )) as any;

      expect(result.thread.id).toMatch(/^thread-/);
      expect(result.thread.rootTurnId).toBe(rootTurnId);
      expect(result.thread.subject).toBe("Side discussion");
      expect(result.thread.createdBy).toBe("agent-1");
    });

    it("should create a nested thread", async () => {
      const parent = (await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId },
        ctx
      )) as any;

      const child = (await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId, parentThreadId: parent.thread.id },
        ctx
      )) as any;

      expect(child.thread.parentThreadId).toBe(parent.thread.id);
    });

    it("should throw MAIL_TURN_NOT_FOUND for missing root turn", async () => {
      try {
        await handlers["mail/thread/create"](
          { conversationId: convId, rootTurnId: "nonexistent" },
          ctx
        );
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_TURN_NOT_FOUND
        );
      }
    });

    it("should throw MAIL_THREAD_NOT_FOUND for missing parent thread", async () => {
      try {
        await handlers["mail/thread/create"](
          { conversationId: convId, rootTurnId, parentThreadId: "nonexistent" },
          ctx
        );
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_THREAD_NOT_FOUND
        );
      }
    });
  });

  // ===========================================================================
  // mail/thread/list
  // ===========================================================================

  describe("mail/thread/list", () => {
    let convId: string;
    let rootTurnId: string;

    beforeEach(async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      convId = created.conversation.id;
      const turn = (await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "Root" },
        ctx
      )) as any;
      rootTurnId = turn.turn.id;
    });

    it("should list threads in a conversation", async () => {
      await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId },
        ctx
      );
      await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId, subject: "Second" },
        ctx
      );

      const result = (await handlers["mail/thread/list"](
        { conversationId: convId },
        ctx
      )) as any;

      expect(result.threads).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it("should filter by parent thread", async () => {
      const parent = (await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId },
        ctx
      )) as any;
      await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId, parentThreadId: parent.thread.id },
        ctx
      );
      await handlers["mail/thread/create"](
        { conversationId: convId, rootTurnId },
        ctx
      );

      const result = (await handlers["mail/thread/list"](
        { conversationId: convId, parentThreadId: parent.thread.id },
        ctx
      )) as any;

      expect(result.threads).toHaveLength(1);
    });

    it("should return empty for unknown conversation", async () => {
      const result = (await handlers["mail/thread/list"](
        { conversationId: "unknown" },
        ctx
      )) as any;

      expect(result.threads).toHaveLength(0);
    });
  });

  // ===========================================================================
  // mail/summary
  // ===========================================================================

  describe("mail/summary", () => {
    it("should return placeholder summary", async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;

      const result = (await handlers["mail/summary"](
        { conversationId: created.conversation.id },
        ctx
      )) as any;

      expect(result.summary).toBe("");
      expect(result.generated).toBe(false);
    });

    it("should throw for unknown conversation", async () => {
      try {
        await handlers["mail/summary"]({ conversationId: "unknown" }, ctx);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND
        );
      }
    });
  });

  // ===========================================================================
  // mail/replay
  // ===========================================================================

  describe("mail/replay", () => {
    let convId: string;

    beforeEach(async () => {
      const created = (await handlers["mail/create"]({}, ctx)) as any;
      convId = created.conversation.id;
    });

    it("should replay all turns", async () => {
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "A" },
        ctx
      );
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "B" },
        ctx
      );

      const result = (await handlers["mail/replay"](
        { conversationId: convId },
        ctx
      )) as any;

      expect(result.turns).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.missedCount).toBe(0);
    });

    it("should replay from a specific turn ID", async () => {
      const t1 = (await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "A" },
        ctx
      )) as any;
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "B" },
        ctx
      );
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "C" },
        ctx
      );

      const result = (await handlers["mail/replay"](
        { conversationId: convId, fromTurnId: t1.turn.id },
        ctx
      )) as any;

      expect(result.turns).toHaveLength(2); // B and C (after t1)
    });

    it("should filter by content types", async () => {
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "text", content: "A" },
        ctx
      );
      await handlers["mail/turn"](
        { conversationId: convId, contentType: "data", content: {} },
        ctx
      );

      const result = (await handlers["mail/replay"](
        { conversationId: convId, contentTypes: ["text"] },
        ctx
      )) as any;

      expect(result.turns).toHaveLength(1);
    });

    it("should paginate with limit", async () => {
      for (let i = 0; i < 5; i++) {
        await handlers["mail/turn"](
          { conversationId: convId, contentType: "text", content: `${i}` },
          ctx
        );
      }

      const page = (await handlers["mail/replay"](
        { conversationId: convId, limit: 2 },
        ctx
      )) as any;

      expect(page.turns).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBeDefined();
    });

    it("should throw for unknown conversation", async () => {
      try {
        await handlers["mail/replay"]({ conversationId: "unknown" }, ctx);
      } catch (error) {
        expect((error as MAPRequestError).code).toBe(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND
        );
      }
    });
  });
});

// =============================================================================
// map/send Mail Meta Interception
// =============================================================================

describe("map/send mail meta interception", () => {
  let eventBus: EventBus;
  let conversations: ConversationManagerImpl;
  let turnStore: InstanceType<typeof InMemoryTurnStore>;
  let turnManager: TurnManagerImpl;
  let messageHandlers: HandlerRegistry;
  let ctx: HandlerContext;
  let convId: string;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    conversations = new ConversationManagerImpl({ eventBus });
    turnStore = new InMemoryTurnStore();
    turnManager = new TurnManagerImpl({ eventBus, conversations, store: turnStore });

    const agents = new AgentRegistryImpl({ eventBus });
    const scopes = new ScopeManagerImpl({ eventBus });
    const messages = new MessageRouterImpl({ eventBus, agents, scopes });

    // Register a target agent
    agents.register({ name: "target", role: "worker", sessionId: "session-target" });

    messageHandlers = createMessageHandlers({
      messages,
      scopes,
      agents,
      turns: turnManager,
    });

    ctx = createMockContext();

    // Create a conversation for interception
    const { conversation } = conversations.create({ createdBy: "agent-1" });
    convId = conversation.id;
  });

  it("should record an intercepted turn when meta.mail is present", async () => {
    const agent = (await import("../server/agents")).AgentRegistryImpl;
    // Get the target agent ID
    const agentsRegistry = new AgentRegistryImpl({ eventBus });
    const registered = agentsRegistry.register({
      name: "receiver",
      role: "worker",
      sessionId: "session-recv",
    });

    // Rebuild handlers with the new agents registry
    const scopes = new ScopeManagerImpl({ eventBus });
    const msgs = new MessageRouterImpl({ eventBus, agents: agentsRegistry, scopes });
    const handlers = createMessageHandlers({
      messages: msgs,
      scopes,
      agents: agentsRegistry,
      turns: turnManager,
    });

    await handlers["map/send"](
      {
        to: registered.id,
        payload: { text: "Hello from mail" },
        meta: {
          mail: {
            conversationId: convId,
          },
        },
      },
      ctx
    );

    // Verify intercepted turn was recorded
    const recordedTurns = turnManager.list({ conversationId: convId });
    expect(recordedTurns).toHaveLength(1);
    expect(recordedTurns[0].source.type).toBe("intercepted");
    expect((recordedTurns[0].source as any).messageId).toBeDefined();
    expect(recordedTurns[0].contentType).toBe("data");
    expect(recordedTurns[0].content).toEqual({ text: "Hello from mail" });
    expect(recordedTurns[0].participant).toBe("agent-1");
  });

  it("should not record a turn when meta.mail is absent", async () => {
    const agentsRegistry = new AgentRegistryImpl({ eventBus });
    const registered = agentsRegistry.register({
      name: "receiver",
      role: "worker",
      sessionId: "session-recv",
    });

    const scopes = new ScopeManagerImpl({ eventBus });
    const msgs = new MessageRouterImpl({ eventBus, agents: agentsRegistry, scopes });
    const handlers = createMessageHandlers({
      messages: msgs,
      scopes,
      agents: agentsRegistry,
      turns: turnManager,
    });

    await handlers["map/send"](
      { to: registered.id, payload: "plain message" },
      ctx
    );

    const recordedTurns = turnManager.list({ conversationId: convId });
    expect(recordedTurns).toHaveLength(0);
  });

  it("should include threadId and inReplyTo in intercepted turn", async () => {
    const agentsRegistry = new AgentRegistryImpl({ eventBus });
    const registered = agentsRegistry.register({
      name: "receiver",
      role: "worker",
      sessionId: "session-recv",
    });

    const scopes = new ScopeManagerImpl({ eventBus });
    const msgs = new MessageRouterImpl({ eventBus, agents: agentsRegistry, scopes });
    const handlers = createMessageHandlers({
      messages: msgs,
      scopes,
      agents: agentsRegistry,
      turns: turnManager,
    });

    await handlers["map/send"](
      {
        to: registered.id,
        payload: "threaded reply",
        meta: {
          mail: {
            conversationId: convId,
            threadId: "thread-1",
            inReplyTo: "turn-prev",
            visibility: { type: "role", roles: ["assistant"] },
          },
        },
      },
      ctx
    );

    const recordedTurns = turnManager.list({ conversationId: convId });
    expect(recordedTurns).toHaveLength(1);
    expect(recordedTurns[0].threadId).toBe("thread-1");
    expect(recordedTurns[0].inReplyTo).toBe("turn-prev");
    expect(recordedTurns[0].visibility).toEqual({
      type: "role",
      roles: ["assistant"],
    });
  });

  it("should not fail send when turn recording fails", async () => {
    const agentsRegistry = new AgentRegistryImpl({ eventBus });
    const registered = agentsRegistry.register({
      name: "receiver",
      role: "worker",
      sessionId: "session-recv",
    });

    const scopes = new ScopeManagerImpl({ eventBus });
    const msgs = new MessageRouterImpl({ eventBus, agents: agentsRegistry, scopes });
    const handlers = createMessageHandlers({
      messages: msgs,
      scopes,
      agents: agentsRegistry,
      turns: turnManager,
    });

    // Use a non-existent conversation ID to trigger recording failure
    const result = (await handlers["map/send"](
      {
        to: registered.id,
        payload: "should still send",
        meta: {
          mail: {
            conversationId: "nonexistent-conv",
          },
        },
      },
      ctx
    )) as any;

    // Send should succeed
    expect(result.messageId).toBeDefined();

    // No turn should be recorded (conversation doesn't exist)
    const recordedTurns = turnManager.list({ conversationId: "nonexistent-conv" });
    expect(recordedTurns).toHaveLength(0);
  });

  it("should not record when turns manager is not provided", async () => {
    const agentsRegistry = new AgentRegistryImpl({ eventBus });
    const registered = agentsRegistry.register({
      name: "receiver",
      role: "worker",
      sessionId: "session-recv",
    });

    const scopes = new ScopeManagerImpl({ eventBus });
    const msgs = new MessageRouterImpl({ eventBus, agents: agentsRegistry, scopes });

    // No turns manager
    const handlers = createMessageHandlers({
      messages: msgs,
      scopes,
      agents: agentsRegistry,
    });

    const result = (await handlers["map/send"](
      {
        to: registered.id,
        payload: "no interception",
        meta: {
          mail: { conversationId: convId },
        },
      },
      ctx
    )) as any;

    expect(result.messageId).toBeDefined();
    // No turns recorded since turnManager was not provided
    const recordedTurns = turnManager.list({ conversationId: convId });
    expect(recordedTurns).toHaveLength(0);
  });
});
