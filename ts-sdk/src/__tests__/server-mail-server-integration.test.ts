/**
 * Integration tests for MAPServer with mail support enabled.
 *
 * Tests that mail building blocks are properly wired into MAPServer
 * and that mail handlers, capabilities, and send interception work
 * end-to-end through the server.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MAPServer } from "../server/server";
import type { HandlerContext } from "../server/types";

// =============================================================================
// Test Helpers
// =============================================================================

function createMockContext(server: MAPServer, overrides?: Partial<HandlerContext>): HandlerContext {
  const session = server.sessions.create({ role: "agent" });
  return {
    session,
    requestId: "req-1",
    signal: new AbortController().signal,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("MAPServer mail integration", () => {
  describe("mail disabled (default)", () => {
    let server: MAPServer;

    beforeEach(() => {
      server = new MAPServer({ name: "TestServer" });
    });

    it("should have null mail managers", () => {
      expect(server.conversations).toBeNull();
      expect(server.turns).toBeNull();
      expect(server.threads).toBeNull();
    });

    it("should not register mail handlers", () => {
      expect(server.handlers["mail/create"]).toBeUndefined();
      expect(server.handlers["mail/turn"]).toBeUndefined();
      expect(server.handlers["mail/thread/create"]).toBeUndefined();
    });

    it("should not include mail capabilities in connect response", async () => {
      const ctx = createMockContext(server);
      const result = await server.handlers["map/connect"]({}, ctx);
      expect(result.capabilities.mail).toBeUndefined();
    });
  });

  describe("mail explicitly disabled", () => {
    it("should have null mail managers when enabled is false", () => {
      const server = new MAPServer({ mail: { enabled: false } });
      expect(server.conversations).toBeNull();
      expect(server.turns).toBeNull();
      expect(server.threads).toBeNull();
    });
  });

  describe("mail enabled", () => {
    let server: MAPServer;

    beforeEach(() => {
      server = new MAPServer({
        name: "MailServer",
        version: "2.0.0",
        mail: { enabled: true },
      });
    });

    it("should have non-null mail managers", () => {
      expect(server.conversations).not.toBeNull();
      expect(server.turns).not.toBeNull();
      expect(server.threads).not.toBeNull();
    });

    it("should register all 13 mail handlers", () => {
      const mailMethods = [
        "mail/create",
        "mail/get",
        "mail/list",
        "mail/close",
        "mail/join",
        "mail/leave",
        "mail/invite",
        "mail/turn",
        "mail/turns/list",
        "mail/thread/create",
        "mail/thread/list",
        "mail/summary",
        "mail/replay",
      ];

      for (const method of mailMethods) {
        expect(server.handlers[method]).toBeDefined();
      }
    });

    it("should include mail capabilities in connect response", async () => {
      const ctx = createMockContext(server);
      const result = await server.handlers["map/connect"]({}, ctx);

      expect(result.capabilities.mail).toBeDefined();
      expect(result.capabilities.mail.enabled).toBe(true);
      expect(result.capabilities.mail.canCreate).toBe(true);
      expect(result.capabilities.mail.canJoin).toBe(true);
    });

    it("should include server info in connect response", async () => {
      const ctx = createMockContext(server);
      const result = await server.handlers["map/connect"]({}, ctx);

      expect(result.systemInfo.name).toBe("MailServer");
      expect(result.systemInfo.version).toBe("2.0.0");
    });

    describe("full mail lifecycle via handlers", () => {
      let ctx: HandlerContext;

      beforeEach(() => {
        ctx = createMockContext(server);
        // Register an agent so getParticipantId works
        const agent = server.agents.register({
          name: "TestAgent",
          sessionId: ctx.session.id,
        });
        ctx.session.agentIds.push(agent.id);
      });

      it("should create a conversation", async () => {
        const result = await server.handlers["mail/create"](
          { subject: "Test conversation" },
          ctx
        );

        expect(result.conversation).toBeDefined();
        expect(result.conversation.subject).toBe("Test conversation");
        expect(result.participant).toBeDefined();
      });

      it("should create conversation, add turn, and list turns", async () => {
        // Create conversation
        const createResult = await server.handlers["mail/create"](
          { subject: "Chat" },
          ctx
        );
        const convId = createResult.conversation.id;

        // Add a turn
        const turnResult = await server.handlers["mail/turn"](
          {
            conversationId: convId,
            contentType: "text",
            content: "Hello world",
          },
          ctx
        );
        expect(turnResult.turn).toBeDefined();
        expect(turnResult.turn.content).toBe("Hello world");

        // List turns
        const listResult = await server.handlers["mail/turns/list"](
          { conversationId: convId },
          ctx
        );
        expect(listResult.turns).toHaveLength(1);
        expect(listResult.turns[0].content).toBe("Hello world");
      });

      it("should create conversation, add turn, create thread", async () => {
        // Create conversation
        const createResult = await server.handlers["mail/create"](
          { subject: "Thread test" },
          ctx
        );
        const convId = createResult.conversation.id;

        // Add a turn
        const turnResult = await server.handlers["mail/turn"](
          {
            conversationId: convId,
            contentType: "text",
            content: "Root message",
          },
          ctx
        );

        // Create thread rooted at the turn
        const threadResult = await server.handlers["mail/thread/create"](
          {
            conversationId: convId,
            rootTurnId: turnResult.turn.id,
            subject: "Discussion",
          },
          ctx
        );
        expect(threadResult.thread).toBeDefined();
        expect(threadResult.thread.subject).toBe("Discussion");

        // List threads
        const threadList = await server.handlers["mail/thread/list"](
          { conversationId: convId },
          ctx
        );
        expect(threadList.threads).toHaveLength(1);
      });

      it("should close a conversation", async () => {
        const createResult = await server.handlers["mail/create"](
          { subject: "Close test" },
          ctx
        );
        const convId = createResult.conversation.id;

        const closeResult = await server.handlers["mail/close"](
          { conversationId: convId, reason: "Done" },
          ctx
        );
        expect(closeResult.conversation.status).toBe("completed");
      });

      it("should get conversation with includes", async () => {
        const createResult = await server.handlers["mail/create"](
          { subject: "Get test" },
          ctx
        );
        const convId = createResult.conversation.id;

        // Add a turn
        await server.handlers["mail/turn"](
          { conversationId: convId, contentType: "text", content: "msg" },
          ctx
        );

        // Get with includes
        const getResult = await server.handlers["mail/get"](
          {
            conversationId: convId,
            include: { participants: true, recentTurns: 10, threads: true, stats: true },
          },
          ctx
        );

        expect(getResult.conversation).toBeDefined();
        expect(getResult.participants).toBeDefined();
        expect(getResult.recentTurns).toHaveLength(1);
        expect(getResult.threads).toHaveLength(0);
        expect(getResult.stats.totalTurns).toBe(1);
      });

      it("should list conversations", async () => {
        await server.handlers["mail/create"]({ subject: "Conv 1" }, ctx);
        await server.handlers["mail/create"]({ subject: "Conv 2" }, ctx);

        const listResult = await server.handlers["mail/list"]({}, ctx);
        expect(listResult.conversations.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe("send interception", () => {
      it("should record intercepted turn when meta.mail is present", async () => {
        const ctx = createMockContext(server);
        const agent = server.agents.register({
          name: "SendAgent",
          sessionId: ctx.session.id,
        });
        ctx.session.agentIds.push(agent.id);

        // Create a target agent for messaging
        const targetSession = server.sessions.create({ role: "agent" });
        const target = server.agents.register({
          name: "Target",
          sessionId: targetSession.id,
        });

        // Create a conversation first
        const convResult = await server.handlers["mail/create"](
          { subject: "Interception test" },
          ctx
        );
        const convId = convResult.conversation.id;

        // Send with mail meta
        await server.handlers["map/send"](
          {
            to: target.id,
            payload: { text: "intercepted message" },
            meta: { mail: { conversationId: convId } },
          },
          ctx
        );

        // Verify the turn was recorded
        const turnsResult = await server.handlers["mail/turns/list"](
          { conversationId: convId },
          ctx
        );

        // Should have at least one turn (the intercepted one)
        const interceptedTurns = turnsResult.turns.filter(
          (t: { source?: { type?: string } }) => t.source?.type === "intercepted"
        );
        expect(interceptedTurns.length).toBeGreaterThanOrEqual(1);
      });

      it("should not record intercepted turn without meta.mail", async () => {
        const ctx = createMockContext(server);
        const agent = server.agents.register({
          name: "SendAgent",
          sessionId: ctx.session.id,
        });
        ctx.session.agentIds.push(agent.id);

        const targetSession = server.sessions.create({ role: "agent" });
        const target = server.agents.register({
          name: "Target",
          sessionId: targetSession.id,
        });

        // Create a conversation
        const convResult = await server.handlers["mail/create"](
          { subject: "No interception" },
          ctx
        );
        const convId = convResult.conversation.id;

        // Send without mail meta
        await server.handlers["map/send"](
          { to: target.id, payload: { text: "normal message" } },
          ctx
        );

        // Verify no intercepted turns
        const turnsResult = await server.handlers["mail/turns/list"](
          { conversationId: convId },
          ctx
        );
        const interceptedTurns = turnsResult.turns.filter(
          (t: { source?: { type?: string } }) => t.source?.type === "intercepted"
        );
        expect(interceptedTurns).toHaveLength(0);
      });
    });
  });

  describe("custom mail capabilities", () => {
    it("should pass capability overrides to connect response", async () => {
      const server = new MAPServer({
        mail: {
          enabled: true,
          capabilities: {
            canCreate: false,
            canInvite: false,
          },
        },
      });

      const ctx = createMockContext(server);
      const result = await server.handlers["map/connect"]({}, ctx);

      expect(result.capabilities.mail.enabled).toBe(true);
      expect(result.capabilities.mail.canCreate).toBe(false);
      expect(result.capabilities.mail.canJoin).toBe(true);
      expect(result.capabilities.mail.canInvite).toBe(false);
      expect(result.capabilities.mail.canViewHistory).toBe(true);
      expect(result.capabilities.mail.canCreateThreads).toBe(true);
    });
  });

  describe("mail events via eventBus", () => {
    it("should emit mail events through the shared eventBus", async () => {
      const server = new MAPServer({ mail: { enabled: true } });
      const ctx = createMockContext(server);
      const agent = server.agents.register({
        name: "EventAgent",
        sessionId: ctx.session.id,
      });
      ctx.session.agentIds.push(agent.id);

      const events: string[] = [];
      server.eventBus.on("mail.created", () => events.push("mail.created"));
      server.eventBus.on("mail.turn.added", () => events.push("mail.turn.added"));

      // Create conversation
      const result = await server.handlers["mail/create"](
        { subject: "Events test" },
        ctx
      );

      expect(events).toContain("mail.created");

      // Add turn
      await server.handlers["mail/turn"](
        {
          conversationId: result.conversation.id,
          contentType: "text",
          content: "Hello",
        },
        ctx
      );

      expect(events).toContain("mail.turn.added");
    });
  });
});
