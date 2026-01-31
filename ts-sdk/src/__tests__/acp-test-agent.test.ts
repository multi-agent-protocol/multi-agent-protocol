/**
 * Tests for TestACPAgent and MockACPStream
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TestACPAgent,
  MockACPStream,
} from "../testing/test-acp-agent";
import { ACPError, ACP_PROTOCOL_VERSION } from "../acp/types";
import type { ACPSessionId } from "../acp/types";

describe("TestACPAgent", () => {
  let agent: TestACPAgent;

  beforeEach(() => {
    agent = new TestACPAgent();
  });

  describe("default handlers", () => {
    it("should handle initialize with default response", async () => {
      const stream = agent.createMockStream("client-1");

      const response = await stream.initialize({
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: { name: "TestClient", version: "1.0" },
      });

      expect(response.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
      expect(response.agentInfo?.name).toBe("TestACPAgent");
      expect(response.agentCapabilities?.loadSession).toBe(true);
      expect(stream.initialized).toBe(true);
    });

    it("should handle newSession with auto-generated session ID", async () => {
      const stream = agent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });

      const response = await stream.newSession({
        cwd: "/test",
        mcpServers: [],
      });

      expect(response.sessionId).toMatch(/^test-session-/);
      expect(stream.sessionId).toBe(response.sessionId);
    });

    it("should handle loadSession for existing session", async () => {
      const stream = agent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      const { sessionId } = await stream.newSession({ cwd: "/test", mcpServers: [] });

      // Create another stream and load the session
      const stream2 = agent.createMockStream("client-2");
      await stream2.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      await stream2.loadSession({ sessionId });

      expect(stream2.sessionId).toBe(sessionId);
    });

    it("should throw error for loadSession with unknown session", async () => {
      const stream = agent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });

      await expect(
        stream.loadSession({ sessionId: "unknown-session" as ACPSessionId })
      ).rejects.toThrow("Session not found");
    });

    it("should handle prompt with default echo response", async () => {
      const stream = agent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      const { sessionId } = await stream.newSession({ cwd: "/test", mcpServers: [] });

      // Listen for session updates
      const updates: unknown[] = [];
      stream.on("sessionUpdate", (update) => updates.push(update));

      const response = await stream.prompt({
        sessionId,
        prompt: [{ type: "text" as const, text: "Hello" }],
      });

      expect(response.stopReason).toBe("end_turn");
      expect(updates.length).toBeGreaterThan(0);
    });

    it("should handle setSessionMode", async () => {
      const stream = agent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      const { sessionId } = await stream.newSession({ cwd: "/test", mcpServers: [] });

      const response = await stream.setSessionMode({
        sessionId,
        modeId: "plan",
      });

      expect(response).toBeDefined();
    });
  });

  describe("custom handlers", () => {
    it("should use custom initialize handler", async () => {
      const customAgent = new TestACPAgent({
        handlers: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "CustomAgent", version: "2.0" },
            agentCapabilities: { loadSession: false },
          }),
        },
      });

      const stream = customAgent.createMockStream("client-1");
      const response = await stream.initialize({
        protocolVersion: ACP_PROTOCOL_VERSION,
      });

      expect(response.agentInfo?.name).toBe("CustomAgent");
      expect(response.agentCapabilities?.loadSession).toBe(false);
    });

    it("should use custom prompt handler", async () => {
      const promptHandler = vi.fn().mockResolvedValue({
        stopReason: "tool_use",
      });

      const customAgent = new TestACPAgent({
        handlers: {
          prompt: promptHandler,
        },
      });

      const stream = customAgent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      const { sessionId } = await stream.newSession({ cwd: "/test", mcpServers: [] });

      const response = await stream.prompt({
        sessionId,
        prompt: [{ type: "text" as const, text: "Test prompt" }],
      });

      expect(promptHandler).toHaveBeenCalled();
      expect(response.stopReason).toBe("tool_use");
    });
  });

  describe("error injection", () => {
    it("should inject errors for specified methods", async () => {
      const errorAgent = new TestACPAgent({
        errorOnMethod: {
          "session/new": { code: -32001, message: "Session limit reached" },
        },
      });

      const stream = errorAgent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });

      await expect(
        stream.newSession({ cwd: "/test", mcpServers: [] })
      ).rejects.toMatchObject({
        code: -32001,
        message: "Session limit reached",
      });
    });
  });

  describe("delay simulation", () => {
    it("should delay requests when defaultDelay is set", async () => {
      const delayAgent = new TestACPAgent({ defaultDelay: 50 });
      const stream = delayAgent.createMockStream("client-1");

      const start = Date.now();
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
    });
  });

  describe("request tracking", () => {
    it("should track all received requests", async () => {
      const stream = agent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      await stream.newSession({ cwd: "/test", mcpServers: [] });

      const requests = agent.receivedRequests;
      expect(requests.length).toBe(2);
      expect(requests[0].method).toBe("initialize");
      expect(requests[1].method).toBe("session/new");
    });

    it("should clear requests", async () => {
      const stream = agent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });

      expect(agent.receivedRequests.length).toBe(1);
      agent.clearRequests();
      expect(agent.receivedRequests.length).toBe(0);
    });
  });

  describe("session tracking", () => {
    it("should track active sessions", async () => {
      const stream = agent.createMockStream("client-1");
      await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      const { sessionId } = await stream.newSession({ cwd: "/test", mcpServers: [] });

      expect(agent.sessions.has(sessionId)).toBe(true);
      expect(agent.sessions.get(sessionId)?.streamId).toBe(stream.streamId);
    });
  });

  describe("agent-to-client communication", () => {
    it("should send session updates", () => {
      const stream = agent.createMockStream("client-1");
      const updates: unknown[] = [];
      stream.on("sessionUpdate", (update) => updates.push(update));

      agent.sendSessionUpdate(stream.streamId, {
        sessionId: "session-1" as ACPSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello!" },
        },
      });

      expect(updates.length).toBe(1);
      expect(updates[0]).toMatchObject({
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
        },
      });
    });

    it("should send agent requests and receive responses", async () => {
      const stream = agent.createMockStream("client-1");

      // Set up listener for agent requests
      stream.on("agentRequest", (req) => {
        if (req.method === "request_permission") {
          stream.respondToAgent(req.requestId, {
            outcome: { outcome: "selected", optionId: "allow" },
          });
        }
      });

      // Agent sends permission request
      const response = await agent.requestPermission(stream.streamId, {
        sessionId: "session-1" as ACPSessionId,
        options: [
          {
            id: "allow",
            kind: "allow",
            title: "Allow",
            description: "Allow the operation",
          },
        ],
      });

      expect(response.outcome).toMatchObject({
        outcome: "selected",
        optionId: "allow",
      });
    });
  });
});

describe("MockACPStream", () => {
  let agent: TestACPAgent;
  let stream: MockACPStream;

  beforeEach(() => {
    agent = new TestACPAgent();
    stream = agent.createMockStream("client-1");
  });

  it("should have unique streamId", () => {
    const stream2 = agent.createMockStream("client-2");
    expect(stream.streamId).not.toBe(stream2.streamId);
    expect(stream.streamId).toMatch(/^mock-stream-/);
  });

  it("should track clientId", () => {
    expect(stream.clientId).toBe("client-1");
  });

  it("should track initialization state", async () => {
    expect(stream.initialized).toBe(false);
    await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
    expect(stream.initialized).toBe(true);
  });

  it("should track session ID after newSession", async () => {
    await stream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
    expect(stream.sessionId).toBeNull();

    const { sessionId } = await stream.newSession({ cwd: "/test", mcpServers: [] });
    expect(stream.sessionId).toBe(sessionId);
  });

  it("should emit close event", () => {
    const closeSpy = vi.fn();
    stream.on("close", closeSpy);

    stream.close();

    expect(closeSpy).toHaveBeenCalled();
  });

  it("should send generic requests", async () => {
    const result = await stream.request<{ protocolVersion: number }>(
      "initialize",
      { protocolVersion: ACP_PROTOCOL_VERSION }
    );

    expect(result.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
  });

  it("should throw ACPError for errors", async () => {
    const errorAgent = new TestACPAgent({
      errorOnMethod: {
        initialize: { code: -32600, message: "Invalid request" },
      },
    });
    const errorStream = errorAgent.createMockStream("client-1");

    await expect(
      errorStream.initialize({ protocolVersion: ACP_PROTOCOL_VERSION })
    ).rejects.toBeInstanceOf(ACPError);
  });
});
