/**
 * Mail v1.1 default-impl conformance: reopen + presence.
 *
 * The SDK ships a default optional implementation of urn:map:ext:mail:1. v1.1
 * adds mail/reopen (un-close a completed conversation) and mail/presence
 * (participants + live status; the default impl reports "unknown" since it has
 * no presence registry — the flagship impl, agent-inbox, enriches this).
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
import type { HandlerContext, HandlerRegistry, EventBus } from "../server/types";

function makeCtx(): HandlerContext {
  return {
    session: {
      id: "s1",
      role: "agent",
      status: "connected",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      metadata: {},
      agentIds: ["agent-1"],
      subscriptionIds: [],
    },
    requestId: "r1",
    signal: new AbortController().signal,
  };
}

describe("mail v1.1 default impl: reopen + presence", () => {
  let handlers: HandlerRegistry;
  let ctx: HandlerContext;

  beforeEach(() => {
    const eventBus: EventBus = new EventBusImpl();
    const conversations = new ConversationManagerImpl({ eventBus });
    const turnStore = new InMemoryTurnStore();
    const turns = new TurnManagerImpl({ eventBus, conversations, store: turnStore });
    const threads = new ThreadManagerImpl({ eventBus, turnStore });
    handlers = createMailHandlers({ conversations, turns, threads });
    ctx = makeCtx();
  });

  it("mail/reopen sets a completed conversation back to active", async () => {
    const created = (await handlers["mail/create"]({}, ctx)) as any;
    const id = created.conversation.id;
    await handlers["mail/close"]({ conversationId: id }, ctx);

    const reopened = (await handlers["mail/reopen"]({ conversationId: id }, ctx)) as any;
    expect(reopened.conversation.status).toBe("active");
  });

  it("mail/reopen throws for an unknown conversation", async () => {
    await expect(
      handlers["mail/reopen"]({ conversationId: "nope" }, ctx),
    ).rejects.toThrow();
  });

  it("mail/presence returns the conversationId + participants with 'unknown' status", async () => {
    const created = (await handlers["mail/create"]({}, ctx)) as any;
    const id = created.conversation.id;

    const res = (await handlers["mail/presence"]({ conversationId: id }, ctx)) as any;
    expect(res.conversationId).toBe(id);
    expect(Array.isArray(res.participants)).toBe(true);
    for (const p of res.participants) {
      expect(p.presence).toBe("unknown");
      expect(p.participantId).toBeDefined();
    }
  });

  it("mail/presence throws for an unknown conversation", async () => {
    await expect(
      handlers["mail/presence"]({ conversationId: "nope" }, ctx),
    ).rejects.toThrow();
  });
});
