/**
 * Regression guard: ACP stream close() racing with an in-flight #sendRequest
 *
 * Previously `#sendRequest` could observe `#closed === true` after
 * `mapClient.send` returned, and throw a synchronous "ACP stream closed"
 * error WITHOUT awaiting the pending request's promise. close() had
 * already called `pending.reject(...)` on that same promise, so the
 * rejected promise lived on as an unhandled rejection — Node's default
 * `--unhandled-rejections=throw` policy crashed the host.
 *
 * Fix: fall through to `return await resultPromise` in all cases. The
 * promise was already rejected by close(); awaiting it consumes the
 * rejection and re-throws it as a normal awaitable error.
 *
 * The race window is tiny (between `await mapClient.send()` resolving
 * and `#sendRequest` returning), so to reproduce it deterministically we
 * intercept the real MAP client's `send` and interleave `close()` while
 * `send` is still suspended.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TestServer } from "../testing/server";
import { TestClient } from "../testing/client";
import { createACPTestAgent } from "../testing/test-acp-agent";
import { ACP_PROTOCOL_VERSION } from "../acp/types";
import type {
  ACPSessionId,
  ACPPromptRequest,
  ACPAgentContext,
} from "../acp/types";

describe("ACP stream close race", () => {
  let server: TestServer;
  let unhandledRejections: unknown[];
  const onUnhandled = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  beforeEach(() => {
    server = new TestServer({ name: "Close-race test" });
    unhandledRejections = [];
    process.on("unhandledRejection", onUnhandled);
  });

  afterEach(() => {
    process.removeListener("unhandledRejection", onUnhandled);
  });

  it("close() interleaved with send() produces an awaitable error, not an unhandled rejection", async () => {
    const { agent } = await createACPTestAgent(server, {
      name: "RaceAgent",
      handler: {
        initialize: async () => ({
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: { name: "RaceAgent", version: "1.0" },
          agentCapabilities: { loadSession: true },
        }),
        newSession: async () => ({
          sessionId: "session-race" as ACPSessionId,
        }),
        prompt: async (_params: ACPPromptRequest, _ctx: ACPAgentContext) => ({
          stopReason: "end_turn" as const,
        }),
        cancel: async () => {},
      },
    });

    const client = await TestClient.create(server);
    const acp = client.connection.createACPStream({
      targetAgent: agent.id!,
      timeout: 60_000,
    });

    await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
    const session = await acp.newSession({});

    // Intercept the next `mapClient.send(...)` call so we can sit inside
    // its await while acp.close() runs. This is the exact window in which
    // the old #sendRequest would race close() and orphan the pending
    // promise. After close() runs we release send() so the normal
    // sendRequest continuation fires.
    const conn = client.connection as unknown as {
      send: (...args: unknown[]) => Promise<void>;
    };
    const realSend = conn.send.bind(conn);
    let sendAwaiting: (() => void) | null = null;
    const sendEntered = new Promise<void>((resolve) => {
      sendAwaiting = resolve;
    });
    let releaseSend: (() => void) | null = null;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let patched = true;
    conn.send = async (...args: unknown[]) => {
      if (patched) {
        patched = false;
        sendAwaiting?.();
        await sendGate;
      }
      return realSend(...args);
    };

    const promptP = acp.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "hello" }],
    });
    // Attach a catch synchronously so vitest never treats this as unhandled.
    const promptObservation = promptP.catch((err) => err);

    // Wait for sendRequest to reach the patched send()
    await sendEntered;

    // Close the stream while send() is mid-await. This rejects
    // #pendingRequests — when send() then returns, the old code would
    // hit the synchronous "ACP stream closed" throw and orphan the
    // already-rejected pending promise.
    const closeP = acp.close();
    releaseSend?.();
    await closeP;

    const observed = await promptObservation;
    expect(observed).toBeInstanceOf(Error);
    expect((observed as Error).message).toMatch(/ACP stream/);

    // Give the event loop a couple of ticks so any orphaned rejection
    // would have surfaced by now.
    await new Promise((r) => setTimeout(r, 50));

    expect(unhandledRejections).toEqual([]);
  });

  it("close() before any RPC surfaces awaitable errors for subsequent calls", async () => {
    const { agent } = await createACPTestAgent(server, {
      name: "EarlyAgent",
      handler: {
        initialize: async () => ({
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: { name: "EarlyAgent", version: "1.0" },
          agentCapabilities: { loadSession: true },
        }),
        newSession: async () => ({
          sessionId: "session-early" as ACPSessionId,
        }),
        prompt: async () => ({ stopReason: "end_turn" as const }),
        cancel: async () => {},
      },
    });

    const client = await TestClient.create(server);
    const acp = client.connection.createACPStream({
      targetAgent: agent.id!,
    });

    await acp.close();

    await expect(
      acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION }),
    ).rejects.toThrow(/ACP stream/);

    await new Promise((r) => setTimeout(r, 50));
    expect(unhandledRejections).toEqual([]);
  });
});
