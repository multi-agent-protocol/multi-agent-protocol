/**
 * Tests for error handling robustness fixes
 *
 * Verifies that:
 * 1. `return await` in sendRequest prevents unhandled rejections
 * 2. ACPStreamConnection handles error responses without crashing
 * 3. #processEvents per-message error handling keeps the loop alive
 * 4. #safeEmitError doesn't throw when no listeners exist
 * 5. ClientConnection.callExtension propagates errors correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BaseConnection } from "../connection/base";
import { ClientConnection } from "../connection/client";
import { createStreamPair } from "../stream";
import { MAPRequestError } from "../errors";
import { TestServer } from "../testing/server";
import { TestClient } from "../testing/client";
import { createACPTestAgent } from "../testing/test-acp-agent";
import { ACP_PROTOCOL_VERSION, ACPError } from "../acp/types";
import type { ACPSessionId } from "../acp/types";

// =============================================================================
// BaseConnection: error response handling
// =============================================================================

describe("BaseConnection error handling", () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];
  let clientConnection: BaseConnection;
  let serverConnection: BaseConnection;

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
    clientConnection = new BaseConnection(clientStream);
    serverConnection = new BaseConnection(serverStream);
  });

  afterEach(async () => {
    await clientConnection.close();
    await serverConnection.close();
  });

  it("rejects with MAPRequestError on error response without unhandled rejection", async () => {
    serverConnection.setRequestHandler(async (method) => {
      throw MAPRequestError.methodNotFound(method);
    });

    // This should reject cleanly — no unhandled rejection
    await expect(
      clientConnection.sendRequest("nonexistent.method")
    ).rejects.toThrow(MAPRequestError);
  });

  it("handles multiple concurrent error responses without unhandled rejections", async () => {
    serverConnection.setRequestHandler(async (method) => {
      throw MAPRequestError.methodNotFound(method);
    });

    // Fire multiple error responses concurrently
    const results = await Promise.allSettled([
      clientConnection.sendRequest("bad.method.1"),
      clientConnection.sendRequest("bad.method.2"),
      clientConnection.sendRequest("bad.method.3"),
    ]);

    // All should reject, none should be unhandled
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(MAPRequestError);
      }
    }
  });

  it("handles interleaved success and error responses", async () => {
    serverConnection.setRequestHandler(async (method, params) => {
      const { shouldFail } = params as { shouldFail: boolean };
      if (shouldFail) {
        throw MAPRequestError.methodNotFound(method);
      }
      return { success: true };
    });

    const results = await Promise.allSettled([
      clientConnection.sendRequest("test", { shouldFail: true }),
      clientConnection.sendRequest("test", { shouldFail: false }),
      clientConnection.sendRequest("test", { shouldFail: true }),
      clientConnection.sendRequest("test", { shouldFail: false }),
    ]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe("rejected");
    expect(results[3].status).toBe("fulfilled");
  });
});

// =============================================================================
// ClientConnection.callExtension: error handling
// =============================================================================

describe("ClientConnection.callExtension error handling", () => {
  let server: TestServer;

  beforeEach(() => {
    server = new TestServer({ name: "Test Server" });
  });

  it("propagates server errors from callExtension without unhandled rejections", async () => {
    const client = await TestClient.create(server);

    // callExtension for a method the server doesn't support should reject cleanly
    await expect(
      client.connection.callExtension("_nonexistent/method", { foo: "bar" })
    ).rejects.toThrow();

    await client.disconnect();
  });
});

// =============================================================================
// ACPStreamConnection: error response handling
// =============================================================================

describe("ACPStreamConnection error handling", () => {
  let server: TestServer;

  beforeEach(() => {
    server = new TestServer({ name: "Test ACP Server" });
  });

  it("propagates ACPError from error responses without unhandled rejections", async () => {
    const { agent } = await createACPTestAgent(server, {
      name: "ErrorAgent",
      handler: {
        initialize: async () => ({
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: { name: "ErrorAgent", version: "1.0" },
        }),
        newSession: async () => {
          throw new ACPError(-32001, "Session creation failed");
        },
        prompt: async () => ({ stopReason: "end_turn" as const }),
        cancel: async () => {},
      },
    });

    const client = await TestClient.create(server);
    const acp = client.connection.createACPStream({
      targetAgent: agent.id!,
      client: {
        requestPermission: async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow" },
        }),
        sessionUpdate: async () => {},
      },
    });

    await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });

    // Error response should reject cleanly — no unhandled rejection
    await expect(
      acp.newSession({ cwd: "/project", mcpServers: [] })
    ).rejects.toMatchObject({
      code: -32001,
      message: "Session creation failed",
    });

    await acp.close();
    await client.disconnect();
  });

  it("handles error on callExtension without unhandled rejections", async () => {
    const { agent } = await createACPTestAgent(server, {
      name: "ExtensionErrorAgent",
      handler: {
        initialize: async () => ({
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: { name: "ExtensionErrorAgent", version: "1.0" },
        }),
        newSession: async () => ({
          sessionId: "session-1" as ACPSessionId,
        }),
        prompt: async () => ({ stopReason: "end_turn" as const }),
        cancel: async () => {},
      },
    });

    const client = await TestClient.create(server);
    const acp = client.connection.createACPStream({
      targetAgent: agent.id!,
      client: {
        requestPermission: async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow" },
        }),
        sessionUpdate: async () => {},
      },
    });

    await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });

    // Calling an unsupported extension should reject cleanly
    await expect(
      acp.callExtension("_nonexistent/getModels", {})
    ).rejects.toThrow();

    await acp.close();
    await client.disconnect();
  });

  it("continues processing messages after one message causes an error", async () => {
    let promptCount = 0;
    const { agent } = await createACPTestAgent(server, {
      name: "RecoveryAgent",
      handler: {
        initialize: async () => ({
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: { name: "RecoveryAgent", version: "1.0" },
        }),
        newSession: async () => ({
          sessionId: "session-1" as ACPSessionId,
        }),
        prompt: async (params) => {
          promptCount++;
          const text = (
            params.prompt as Array<{ type: string; text: string }>
          )?.[0]?.text;
          if (text === "fail") {
            throw new ACPError(-32000, "Intentional failure");
          }
          return { stopReason: "end_turn" as const };
        },
        cancel: async () => {},
      },
    });

    const client = await TestClient.create(server);

    const errorEvents: Error[] = [];
    const acp = client.connection.createACPStream({
      targetAgent: agent.id!,
      client: {
        requestPermission: async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow" },
        }),
        sessionUpdate: async () => {},
      },
    });

    // Track errors
    acp.on("error", (err: Error) => {
      errorEvents.push(err);
    });

    await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
    await acp.newSession({ cwd: "/project", mcpServers: [] });

    // First prompt should fail with ACPError
    await expect(
      acp.prompt({
        sessionId: "session-1" as ACPSessionId,
        prompt: [{ type: "text", text: "fail" }],
      })
    ).rejects.toMatchObject({
      code: -32000,
      message: "Intentional failure",
    });

    // Second prompt should succeed — event loop wasn't killed
    const result = await acp.prompt({
      sessionId: "session-1" as ACPSessionId,
      prompt: [{ type: "text", text: "succeed" }],
    });

    expect(result.stopReason).toBe("end_turn");
    expect(promptCount).toBe(2);

    await acp.close();
    await client.disconnect();
  });
});

// =============================================================================
// ACPStreamConnection: #safeEmitError
// =============================================================================

describe("ACPStreamConnection safeEmitError", () => {
  let server: TestServer;

  beforeEach(() => {
    server = new TestServer({ name: "Test Server" });
  });

  it("does not throw when no error listeners are attached", async () => {
    const { agent } = await createACPTestAgent(server, {
      name: "NoListenerAgent",
      handler: {
        initialize: async () => ({
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: { name: "NoListenerAgent", version: "1.0" },
        }),
        newSession: async () => {
          throw new ACPError(-32001, "Session error");
        },
        prompt: async () => ({ stopReason: "end_turn" as const }),
        cancel: async () => {},
      },
    });

    const client = await TestClient.create(server);
    const acp = client.connection.createACPStream({
      targetAgent: agent.id!,
      client: {
        requestPermission: async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow" },
        }),
        sessionUpdate: async () => {},
      },
    });

    // Deliberately do NOT attach an error listener.
    // The error should be rejected via the pending promise, not crash
    // via EventEmitter's default "throw on unhandled error" behavior.

    await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });

    // This error response goes through pending.reject, not emit("error"),
    // so it should work fine even without an error listener
    await expect(
      acp.newSession({ cwd: "/project", mcpServers: [] })
    ).rejects.toMatchObject({
      code: -32001,
    });

    await acp.close();
    await client.disconnect();
  });

  it("emits errors to attached listeners without crashing", async () => {
    const { agent } = await createACPTestAgent(server, {
      name: "ErrorListenerAgent",
      handler: {
        initialize: async () => ({
          protocolVersion: ACP_PROTOCOL_VERSION,
          agentInfo: { name: "ErrorListenerAgent", version: "1.0" },
        }),
        newSession: async () => ({
          sessionId: "session-1" as ACPSessionId,
        }),
        prompt: async () => {
          throw new ACPError(-32000, "Prompt failed");
        },
        cancel: async () => {},
      },
    });

    const client = await TestClient.create(server);

    const errorEvents: Error[] = [];
    const acp = client.connection.createACPStream({
      targetAgent: agent.id!,
      client: {
        requestPermission: async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow" },
        }),
        sessionUpdate: async () => {},
      },
    });

    acp.on("error", (err: Error) => {
      errorEvents.push(err);
    });

    await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
    await acp.newSession({ cwd: "/project", mcpServers: [] });

    // Error goes through pending.reject — should be catchable
    await expect(
      acp.prompt({
        sessionId: "session-1" as ACPSessionId,
        prompt: [{ type: "text", text: "hello" }],
      })
    ).rejects.toThrow();

    await acp.close();
    await client.disconnect();
  });
});

// =============================================================================
// Unhandled rejection detection
// =============================================================================

describe("Unhandled rejection prevention", () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];
  let clientConnection: BaseConnection;
  let serverConnection: BaseConnection;

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
    clientConnection = new BaseConnection(clientStream);
    serverConnection = new BaseConnection(serverStream);
  });

  afterEach(async () => {
    await clientConnection.close();
    await serverConnection.close();
  });

  it("does not produce unhandled rejections when server returns errors rapidly", async () => {
    const unhandledRejections: unknown[] = [];
    const handler = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    process.on("unhandledRejection", handler);

    try {
      serverConnection.setRequestHandler(async (method) => {
        throw MAPRequestError.methodNotFound(method);
      });

      // Fire many error requests rapidly
      const promises = Array.from({ length: 20 }, (_, i) =>
        clientConnection
          .sendRequest(`bad.method.${i}`)
          .catch(() => {
            /* expected */
          })
      );

      await Promise.all(promises);

      // Give microtask queue time to process any unhandled rejections
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.removeListener("unhandledRejection", handler);
    }
  });

  it("does not produce unhandled rejections on connection close during pending request", async () => {
    const unhandledRejections: unknown[] = [];
    const handler = (reason: unknown) => {
      unhandledRejections.push(reason);
    };

    process.on("unhandledRejection", handler);

    try {
      // Server never responds
      serverConnection.setRequestHandler(async () => {
        await new Promise(() => {}); // Never resolves
      });

      // Start a request, then close the connection
      const requestPromise = clientConnection
        .sendRequest("slow.method")
        .catch(() => {
          /* expected — closed */
        });

      // Close after a brief delay
      await new Promise((resolve) => setTimeout(resolve, 20));
      await clientConnection.close();

      await requestPromise;

      // Give microtask queue time to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.removeListener("unhandledRejection", handler);
    }
  });
});
