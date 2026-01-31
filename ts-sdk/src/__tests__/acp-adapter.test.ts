/**
 * Tests for ACPAgentAdapter
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ACPAgentAdapter } from "../acp/adapter";
import { ACPError, ACP_METHODS, ACP_PROTOCOL_VERSION, isACPEnvelope } from "../acp/types";
import type {
  ACPSessionId,
  ACPAgentHandler,
  ACPEnvelope,
  ACPAgentContext,
} from "../acp/types";
import type { AgentConnection } from "../connection/agent";
import type { Message } from "../types";

// Mock AgentConnection
function createMockAgentConnection() {
  const messageHandlers: ((message: Message) => void)[] = [];
  const sentMessages: { to: unknown; payload: unknown; meta?: unknown }[] = [];

  const mockConnection = {
    onMessage: vi.fn((handler: (message: Message) => void) => {
      messageHandlers.push(handler);
      return () => {
        const idx = messageHandlers.indexOf(handler);
        if (idx >= 0) messageHandlers.splice(idx, 1);
      };
    }),
    send: vi.fn(async (to: unknown, payload: unknown, meta?: unknown) => {
      sentMessages.push({ to, payload, meta });
      return { messageId: `msg-${Date.now()}` };
    }),
    // Helper to simulate incoming message
    _simulateMessage: (message: Message) => {
      for (const handler of messageHandlers) {
        handler(message);
      }
    },
    _sentMessages: sentMessages,
  };

  return mockConnection as unknown as AgentConnection & {
    _simulateMessage: (message: Message) => void;
    _sentMessages: typeof sentMessages;
  };
}

describe("ACPAgentAdapter", () => {
  let mockAgent: ReturnType<typeof createMockAgentConnection>;
  let adapter: ACPAgentAdapter;
  let handler: ACPAgentHandler;

  beforeEach(() => {
    mockAgent = createMockAgentConnection();

    handler = {
      initialize: vi.fn().mockResolvedValue({
        protocolVersion: ACP_PROTOCOL_VERSION,
        agentInfo: { name: "TestAgent", version: "1.0" },
        agentCapabilities: { loadSession: true },
      }),
      newSession: vi.fn().mockResolvedValue({
        sessionId: "session-123" as ACPSessionId,
      }),
      prompt: vi.fn().mockResolvedValue({
        stopReason: "end_turn" as const,
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    adapter = new ACPAgentAdapter(mockAgent, handler);
  });

  describe("message handling", () => {
    it("should register message handler on construction", () => {
      expect(mockAgent.onMessage).toHaveBeenCalled();
    });

    it("should ignore non-ACP messages", () => {
      const message: Message = {
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: { type: "regular-message" },
      };

      mockAgent._simulateMessage(message);

      expect(handler.initialize).not.toHaveBeenCalled();
      expect(mockAgent._sentMessages.length).toBe(0);
    });

    it("should process ACP initialize request", async () => {
      const envelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: {
            protocolVersion: ACP_PROTOCOL_VERSION,
            clientInfo: { name: "TestClient", version: "1.0" },
          },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      const message: Message = {
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: envelope,
      };

      mockAgent._simulateMessage(message);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          protocolVersion: ACP_PROTOCOL_VERSION,
        }),
        expect.objectContaining({
          streamId: "stream-1",
          clientParticipantId: "client-1",
        })
      );

      // Check response was sent
      expect(mockAgent._sentMessages.length).toBe(1);
      const response = mockAgent._sentMessages[0];
      expect(response.to).toEqual({ participant: "client-1" });
      expect(isACPEnvelope(response.payload)).toBe(true);

      const responseEnvelope = response.payload as ACPEnvelope;
      expect(responseEnvelope.acp.id).toBe("req-1");
      expect(responseEnvelope.acp.result).toMatchObject({
        protocolVersion: ACP_PROTOCOL_VERSION,
      });
    });

    it("should process ACP newSession request", async () => {
      // First initialize to set up stream context
      const initEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: initEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now newSession
      const newSessionEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-2",
          method: ACP_METHODS.SESSION_NEW,
          params: { cwd: "/project", mcpServers: [] },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-2",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: newSessionEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler.newSession).toHaveBeenCalled();

      // Check session ID is tracked
      expect(adapter.getSessionId("stream-1")).toBe("session-123");
    });

    it("should process ACP prompt request", async () => {
      // Set up stream context
      const initEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: initEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Prompt request
      const promptEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-2",
          method: ACP_METHODS.SESSION_PROMPT,
          params: {
            sessionId: "session-123",
            prompt: [{ type: "text", text: "Hello" }],
          },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: "session-123",
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-2",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: promptEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-123",
          prompt: [{ type: "text", text: "Hello" }],
        }),
        expect.any(Object)
      );
    });

    it("should handle cancel notification (no response)", async () => {
      // Set up stream context
      const initEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: initEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const initialSentCount = mockAgent._sentMessages.length;

      // Cancel notification (no id)
      const cancelEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          method: ACP_METHODS.SESSION_CANCEL,
          params: { sessionId: "session-123" },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: "session-123",
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-2",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: cancelEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler.cancel).toHaveBeenCalled();
      // No response should be sent for notifications
      expect(mockAgent._sentMessages.length).toBe(initialSentCount);
    });

    it("should return error for unknown method", async () => {
      const envelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: "unknown/method",
          params: {},
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: envelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAgent._sentMessages.length).toBe(1);
      const response = mockAgent._sentMessages[0].payload as ACPEnvelope;
      expect(response.acp.error).toBeDefined();
      expect(response.acp.error?.code).toBe(-32601);
      expect(response.acp.error?.message).toContain("Unknown method");
    });

    it("should handle handler errors", async () => {
      handler.initialize = vi.fn().mockRejectedValue(
        new ACPError(-32001, "Custom error")
      );

      const envelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: envelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const response = mockAgent._sentMessages[0].payload as ACPEnvelope;
      expect(response.acp.error).toMatchObject({
        code: -32001,
        message: "Custom error",
      });
    });

    it("should handle non-ACPError exceptions", async () => {
      handler.initialize = vi.fn().mockRejectedValue(
        new Error("Unexpected error")
      );

      const envelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: envelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const response = mockAgent._sentMessages[0].payload as ACPEnvelope;
      expect(response.acp.error).toMatchObject({
        code: -32603, // Internal error
        message: "Unexpected error",
      });
    });
  });

  describe("agent-to-client communication", () => {
    it("should send session update notification", async () => {
      // Set up stream context first
      const initEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: initEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      mockAgent._sentMessages.length = 0; // Clear init response

      // Send session update
      await adapter.sendSessionUpdate("stream-1", {
        sessionId: "session-123" as ACPSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello!" },
        },
      });

      expect(mockAgent._sentMessages.length).toBe(1);
      const sent = mockAgent._sentMessages[0];
      expect(sent.to).toEqual({ participant: "client-1" });

      const envelope = sent.payload as ACPEnvelope;
      expect(envelope.acp.method).toBe(ACP_METHODS.SESSION_UPDATE);
      expect(envelope.acp.id).toBeUndefined(); // Notification
      expect(envelope.acpContext.direction).toBe("agent-to-client");
    });

    it("should throw error for unknown stream", async () => {
      await expect(
        adapter.sendSessionUpdate("unknown-stream", {
          sessionId: "session-123" as ACPSessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello!" },
          },
        })
      ).rejects.toThrow("Unknown stream");
    });
  });

  describe("stream context tracking", () => {
    it("should track stream context", async () => {
      const initEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: initEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(adapter.hasStream("stream-1")).toBe(true);
      expect(adapter.getClientParticipantId("stream-1")).toBe("client-1");
      expect(adapter.getSessionId("stream-1")).toBeNull();
    });

    it("should update session ID on newSession", async () => {
      const initEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: initEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const newSessionEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-2",
          method: ACP_METHODS.SESSION_NEW,
          params: { cwd: "/project", mcpServers: [] },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-2",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: newSessionEnvelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(adapter.getSessionId("stream-1")).toBe("session-123");
    });

    it("should remove stream context", () => {
      // Manually trigger context creation
      const initEnvelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.INITIALIZE,
          params: { protocolVersion: ACP_PROTOCOL_VERSION },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: initEnvelope,
      });

      expect(adapter.hasStream("stream-1")).toBe(true);

      const removed = adapter.removeStream("stream-1");
      expect(removed).toBe(true);
      expect(adapter.hasStream("stream-1")).toBe(false);
    });
  });

  describe("optional handlers", () => {
    it("should return error for unimplemented authenticate", async () => {
      const envelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.AUTHENTICATE,
          params: { methodId: "api-key" },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: envelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const response = mockAgent._sentMessages[0].payload as ACPEnvelope;
      expect(response.acp.error?.code).toBe(-32601);
      expect(response.acp.error?.message).toContain("authenticate");
    });

    it("should call authenticate when implemented", async () => {
      handler.authenticate = vi.fn().mockResolvedValue({});

      const envelope: ACPEnvelope = {
        acp: {
          jsonrpc: "2.0",
          id: "req-1",
          method: ACP_METHODS.AUTHENTICATE,
          params: { methodId: "api-key" },
        },
        acpContext: {
          streamId: "stream-1",
          sessionId: null,
          direction: "client-to-agent",
        },
      };

      mockAgent._simulateMessage({
        id: "msg-1",
        from: "client-1",
        to: { agent: "agent-1" },
        timestamp: Date.now(),
        payload: envelope,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler.authenticate).toHaveBeenCalled();
      const response = mockAgent._sentMessages[0].payload as ACPEnvelope;
      expect(response.acp.result).toBeDefined();
      expect(response.acp.error).toBeUndefined();
    });
  });
});
