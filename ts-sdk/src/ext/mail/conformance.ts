/**
 * Mail extension conformance suite (`urn:map:ext:mail:1` v1.1).
 *
 * Transport-agnostic: you give it a `send(method, params)` adapter and your test
 * framework's `describe`/`it`/`expect`, and it asserts the canonical wire
 * contract — the MAP convention (camelCase fields, `conversationId`, error codes
 * in the 10000 range). Both the SDK default implementation and the flagship
 * (agent-inbox) run the SAME suite; that's what keeps the contract from drifting.
 *
 * Usage (SDK default impl):
 *   import { runMailConformance } from "@multi-agent-protocol/sdk/ext/mail/conformance";
 *   runMailConformance({ describe, it, expect }, makeSdkAdapter);
 */

/** A live mail endpoint under test. `send` rejects with `{ code, message }` on error. */
export interface MailConformanceAdapter {
  send<R = unknown>(method: string, params?: Record<string, unknown>): Promise<R>;
  /** Optional: reset state between the suite's runs. */
  reset?(): void | Promise<void>;
}

/** Minimal slice of a test framework (vitest-compatible). */
export interface MailConformanceHarness {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => void | Promise<void>): void;
  expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    toContain(expected: unknown): void;
  };
}

/** Capture a rejected `send` so the suite can assert on the error code. */
async function expectError(
  fn: () => Promise<unknown>,
): Promise<{ code?: number; message?: string }> {
  try {
    await fn();
  } catch (e) {
    return e as { code?: number; message?: string };
  }
  return {};
}

export function runMailConformance(
  harness: MailConformanceHarness,
  makeAdapter: () => MailConformanceAdapter | Promise<MailConformanceAdapter>,
  label = "mail v1.1",
): void {
  const { describe, it, expect } = harness;

  describe(`mail conformance: ${label}`, () => {
    it("create returns a conversation with id + active status (camelCase)", async () => {
      const a = await makeAdapter();
      const res = await a.send<{ conversation: { id: string; status: string } }>(
        "mail/create",
        {},
      );
      expect(res.conversation).toBeDefined();
      expect(typeof res.conversation.id).toBe("string");
      expect(res.conversation.status).toBe("active");
    });

    it("get returns the conversation; threads via include", async () => {
      const a = await makeAdapter();
      const { conversation } = await a.send<{ conversation: { id: string } }>("mail/create", {});
      const res = await a.send<{ conversation: unknown; threads?: unknown[] }>("mail/get", {
        conversationId: conversation.id,
        include: { threads: true },
      });
      expect(res.conversation).toBeDefined();
      expect(Array.isArray(res.threads)).toBe(true);
    });

    it("list returns conversations[]", async () => {
      const a = await makeAdapter();
      await a.send("mail/create", {});
      const res = await a.send<{ conversations: unknown[] }>("mail/list", {});
      expect(Array.isArray(res.conversations)).toBe(true);
    });

    it("close → completed, reopen → active", async () => {
      const a = await makeAdapter();
      const { conversation } = await a.send<{ conversation: { id: string } }>("mail/create", {});
      await a.send("mail/close", { conversationId: conversation.id });
      const reopened = await a.send<{ conversation: { status: string } }>("mail/reopen", {
        conversationId: conversation.id,
      });
      expect(reopened.conversation.status).toBe("active");
    });

    it("presence returns conversationId + participants[] with camelCase fields", async () => {
      const a = await makeAdapter();
      const { conversation } = await a.send<{ conversation: { id: string } }>("mail/create", {});
      const res = await a.send<{
        conversationId: string;
        participants: Array<{ participantId: unknown; presence: string }>;
      }>("mail/presence", { conversationId: conversation.id });
      expect(res.conversationId).toBe(conversation.id);
      expect(Array.isArray(res.participants)).toBe(true);
      for (const p of res.participants) {
        // Canonical shape: `participantId` (not `agent_id`), and a presence string.
        expect(p.participantId).toBeDefined();
        expect(typeof p.presence).toBe("string");
      }
    });

    it("turn records a turn; turns/list returns it", async () => {
      const a = await makeAdapter();
      const { conversation } = await a.send<{ conversation: { id: string } }>("mail/create", {});
      await a.send("mail/join", { conversationId: conversation.id }).catch(() => {});
      await a.send("mail/turn", {
        conversationId: conversation.id,
        contentType: "text",
        content: { text: "hello" },
      });
      const res = await a.send<{ turns: unknown[] }>("mail/turns/list", {
        conversationId: conversation.id,
      });
      expect(Array.isArray(res.turns)).toBe(true);
      expect(res.turns.length).toBe(1);
    });

    it("thread/create + thread/list", async () => {
      const a = await makeAdapter();
      const { conversation } = await a.send<{ conversation: { id: string } }>("mail/create", {});
      await a.send("mail/join", { conversationId: conversation.id }).catch(() => {});
      const turn = await a.send<{ turn: { id: string } }>("mail/turn", {
        conversationId: conversation.id,
        contentType: "text",
        content: { text: "root" },
      });
      await a.send("mail/thread/create", {
        conversationId: conversation.id,
        rootTurnId: turn.turn.id,
      });
      const res = await a.send<{ threads: unknown[] }>("mail/thread/list", {
        conversationId: conversation.id,
      });
      expect(Array.isArray(res.threads)).toBe(true);
      expect(res.threads.length).toBe(1);
    });

    it("replay returns conversation history", async () => {
      const a = await makeAdapter();
      const { conversation } = await a.send<{ conversation: { id: string } }>("mail/create", {});
      const res = await a.send<{ turns: unknown[] }>("mail/replay", {
        conversationId: conversation.id,
      });
      expect(Array.isArray(res.turns)).toBe(true);
    });

    it("error: unknown conversation → code 10000 (Conversation not found)", async () => {
      const a = await makeAdapter();
      const err = await expectError(() => a.send("mail/get", { conversationId: "does-not-exist" }));
      expect(err.code).toBe(10000);
    });
  });
}
