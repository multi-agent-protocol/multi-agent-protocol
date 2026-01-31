/**
 * Integration tests for ACP-over-MAP
 *
 * Tests the full flow: client → MAP → agent → MAP → client
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TestServer } from "../testing/server";
import { TestClient } from "../testing/client";
import { createACPTestAgent } from "../testing/test-acp-agent";
import { createStreamPair } from "../stream";
import { ClientConnection } from "../connection/client";
import { ACP_PROTOCOL_VERSION, ACPError } from "../acp/types";
import type {
  ACPSessionId,
  ACPAgentHandler,
  ACPPromptRequest,
  ACPAgentContext,
} from "../acp/types";

describe("ACP-over-MAP Integration", () => {
  let server: TestServer;

  beforeEach(() => {
    server = new TestServer({ name: "Test MAP Server" });
  });

  describe("Full ACP Flow", () => {
    it("should complete initialize → newSession → prompt flow", async () => {
      // Create ACP agent
      const promptHandler = vi.fn().mockImplementation(
        async (params: ACPPromptRequest, ctx: ACPAgentContext) => {
          // Return simple response
          return { stopReason: "end_turn" as const };
        }
      );

      const { agent } = await createACPTestAgent(server, {
        name: "CodingAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "CodingAgent", version: "1.0" },
            agentCapabilities: { loadSession: true },
          }),
          newSession: async () => ({
            sessionId: "session-123" as ACPSessionId,
          }),
          prompt: promptHandler,
          cancel: async () => {},
        },
      });

      // Create client
      const client = await TestClient.create(server);

      // Create ACP stream
      const sessionUpdates: unknown[] = [];
      const acp = client.connection.createACPStream({
        targetAgent: agent.id!,
        client: {
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "allow" },
          }),
          sessionUpdate: async (update) => {
            sessionUpdates.push(update);
          },
        },
      });

      // Initialize
      const initResponse = await acp.initialize({
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: { name: "TestIDE", version: "1.0" },
      });

      expect(initResponse.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
      expect(initResponse.agentInfo?.name).toBe("CodingAgent");
      expect(acp.initialized).toBe(true);

      // New session
      const sessionResponse = await acp.newSession({
        cwd: "/project",
        mcpServers: [],
      });

      expect(sessionResponse.sessionId).toBe("session-123");
      expect(acp.sessionId).toBe("session-123");

      // Prompt
      const promptResponse = await acp.prompt({
        sessionId: sessionResponse.sessionId,
        prompt: [{ type: "text", text: "Hello, agent!" }],
      });

      expect(promptResponse.stopReason).toBe("end_turn");
      expect(promptHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-123",
          prompt: [{ type: "text", text: "Hello, agent!" }],
        }),
        expect.any(Object)
      );

      // Cleanup
      await acp.close();
      await client.disconnect();
    });

    it("should handle multiple concurrent ACP streams", async () => {
      // Create agent
      let sessionCounter = 0;
      const { agent } = await createACPTestAgent(server, {
        name: "MultiStreamAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "MultiStreamAgent", version: "1.0" },
          }),
          newSession: async () => ({
            sessionId: `session-${++sessionCounter}` as ACPSessionId,
          }),
          prompt: async () => ({ stopReason: "end_turn" as const }),
          cancel: async () => {},
        },
      });

      // Create client with two streams
      const client = await TestClient.create(server);

      const acp1 = client.connection.createACPStream({
        targetAgent: agent.id!,
        client: {
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "allow" },
          }),
          sessionUpdate: async () => {},
        },
      });

      const acp2 = client.connection.createACPStream({
        targetAgent: agent.id!,
        client: {
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "allow" },
          }),
          sessionUpdate: async () => {},
        },
      });

      // Both streams should have unique IDs
      expect(acp1.streamId).not.toBe(acp2.streamId);

      // Initialize both
      await Promise.all([
        acp1.initialize({ protocolVersion: ACP_PROTOCOL_VERSION }),
        acp2.initialize({ protocolVersion: ACP_PROTOCOL_VERSION }),
      ]);

      // Create sessions
      const [session1, session2] = await Promise.all([
        acp1.newSession({ cwd: "/project1", mcpServers: [] }),
        acp2.newSession({ cwd: "/project2", mcpServers: [] }),
      ]);

      expect(session1.sessionId).toBe("session-1");
      expect(session2.sessionId).toBe("session-2");

      // Cleanup
      await Promise.all([acp1.close(), acp2.close()]);
      await client.disconnect();
    });

    it("should handle ACP errors properly", async () => {
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

      // Should propagate ACP error
      await expect(
        acp.newSession({ cwd: "/project", mcpServers: [] })
      ).rejects.toMatchObject({
        code: -32001,
        message: "Session creation failed",
      });

      await acp.close();
      await client.disconnect();
    });
  });

  describe("Agent-to-Client Requests", () => {
    it("should handle permission requests from agent", async () => {
      let permissionResolver: ((value: unknown) => void) | null = null;

      const { agent, adapter } = await createACPTestAgent(server, {
        name: "PermissionAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "PermissionAgent", version: "1.0" },
          }),
          newSession: async () => ({
            sessionId: "session-1" as ACPSessionId,
          }),
          prompt: async (_params, ctx) => {
            // Request permission during prompt
            const permission = await adapter.requestPermission(ctx.streamId, {
              sessionId: ctx.sessionId!,
              options: [
                {
                  id: "allow",
                  kind: "allow",
                  title: "Allow",
                  description: "Allow the operation",
                },
                {
                  id: "deny",
                  kind: "deny",
                  title: "Deny",
                  description: "Deny the operation",
                },
              ],
            });

            // Notify test that permission was received
            if (permissionResolver) {
              permissionResolver(permission);
            }

            return { stopReason: "end_turn" as const };
          },
          cancel: async () => {},
        },
      });

      const client = await TestClient.create(server);

      const permissionRequests: unknown[] = [];
      const acp = client.connection.createACPStream({
        targetAgent: agent.id!,
        client: {
          requestPermission: async (req) => {
            permissionRequests.push(req);
            return {
              outcome: { outcome: "selected" as const, optionId: "allow" },
            };
          },
          sessionUpdate: async () => {},
        },
      });

      await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      await acp.newSession({ cwd: "/project", mcpServers: [] });

      // Create promise to wait for permission result
      const permissionPromise = new Promise((resolve) => {
        permissionResolver = resolve;
      });

      // Start prompt (which will request permission)
      const promptPromise = acp.prompt({
        sessionId: acp.sessionId!,
        prompt: [{ type: "text", text: "Do something" }],
      });

      // Wait for both
      const [, permissionResult] = await Promise.all([
        promptPromise,
        permissionPromise,
      ]);

      // Verify permission was requested and responded
      expect(permissionRequests.length).toBe(1);
      expect(permissionResult).toMatchObject({
        outcome: { outcome: "selected", optionId: "allow" },
      });

      await acp.close();
      await client.disconnect();
    });
  });

  describe("Streaming Updates", () => {
    it("should receive session updates from agent", async () => {
      const { agent, adapter } = await createACPTestAgent(server, {
        name: "StreamingAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "StreamingAgent", version: "1.0" },
          }),
          newSession: async () => ({
            sessionId: "session-1" as ACPSessionId,
          }),
          prompt: async (params, ctx) => {
            // Send multiple updates
            adapter.sendSessionUpdate(ctx.streamId, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Hello, " },
              },
            });

            adapter.sendSessionUpdate(ctx.streamId, {
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "world!" },
              },
            });

            return { stopReason: "end_turn" as const };
          },
          cancel: async () => {},
        },
      });

      const client = await TestClient.create(server);

      const updates: unknown[] = [];
      const acp = client.connection.createACPStream({
        targetAgent: agent.id!,
        client: {
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "allow" },
          }),
          sessionUpdate: async (update) => {
            updates.push(update);
          },
        },
      });

      await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      await acp.newSession({ cwd: "/project", mcpServers: [] });
      await acp.prompt({
        sessionId: acp.sessionId!,
        prompt: [{ type: "text", text: "Say hello" }],
      });

      // Allow time for updates to be received
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(updates.length).toBeGreaterThanOrEqual(2);

      await acp.close();
      await client.disconnect();
    });
  });

  describe("Capability Advertisement", () => {
    it("should advertise ACP capability when agent is registered", async () => {
      const { agent } = await createACPTestAgent(server, {
        name: "ACPAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "ACPAgent", version: "1.0" },
          }),
          newSession: async () => ({
            sessionId: "session-1" as ACPSessionId,
          }),
          prompt: async () => ({ stopReason: "end_turn" as const }),
          cancel: async () => {},
        },
        acpCapability: {
          version: "2024-10-07",
          features: ["streaming", "tools"],
        },
      });

      const client = await TestClient.create(server);
      const agents = await client.connection.listAgents();

      const acpAgent = agents.agents.find((a) => a.id === agent.id);
      expect(acpAgent).toBeDefined();
      expect(acpAgent?.capabilities?.protocols).toContain("acp");
      expect(acpAgent?.capabilities?.acp?.version).toBe("2024-10-07");
      expect(acpAgent?.capabilities?.acp?.features).toContain("streaming");

      await client.disconnect();
    });
  });

  describe("Stream Lifecycle", () => {
    it("should clean up stream on close", async () => {
      const { agent } = await createACPTestAgent(server, {
        name: "LifecycleAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "LifecycleAgent", version: "1.0" },
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

      // Track active streams
      expect(client.connection.acpStreams.size).toBe(1);
      expect(client.connection.getACPStream(acp.streamId)).toBe(acp);

      // Close stream
      const closeSpy = vi.fn();
      acp.on("close", closeSpy);
      await acp.close();

      expect(closeSpy).toHaveBeenCalled();
      expect(acp.isClosed).toBe(true);
      expect(client.connection.acpStreams.size).toBe(0);

      await client.disconnect();
    });

    it("should close all streams on client disconnect", async () => {
      const { agent } = await createACPTestAgent(server, {
        name: "DisconnectAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "DisconnectAgent", version: "1.0" },
          }),
          newSession: async () => ({
            sessionId: "session-1" as ACPSessionId,
          }),
          prompt: async () => ({ stopReason: "end_turn" as const }),
          cancel: async () => {},
        },
      });

      const client = await TestClient.create(server);

      const acp1 = client.connection.createACPStream({
        targetAgent: agent.id!,
        client: {
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "allow" },
          }),
          sessionUpdate: async () => {},
        },
      });

      const acp2 = client.connection.createACPStream({
        targetAgent: agent.id!,
        client: {
          requestPermission: async () => ({
            outcome: { outcome: "selected" as const, optionId: "allow" },
          }),
          sessionUpdate: async () => {},
        },
      });

      await Promise.all([
        acp1.initialize({ protocolVersion: ACP_PROTOCOL_VERSION }),
        acp2.initialize({ protocolVersion: ACP_PROTOCOL_VERSION }),
      ]);

      expect(client.connection.acpStreams.size).toBe(2);

      // Disconnect client
      await client.disconnect();

      // Streams should be closed
      expect(acp1.isClosed).toBe(true);
      expect(acp2.isClosed).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle unknown methods", async () => {
      const { agent } = await createACPTestAgent(server, {
        name: "ErrorAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "ErrorAgent", version: "1.0" },
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

      // Try to call a method before session is created
      await expect(
        acp.prompt({
          sessionId: "nonexistent" as ACPSessionId,
          prompt: [{ type: "text", text: "test" }],
        })
      ).rejects.toThrow();

      await acp.close();
      await client.disconnect();
    });

    it("should reject pending requests when stream closes", async () => {
      const { agent, adapter } = await createACPTestAgent(server, {
        name: "SlowAgent",
        handler: {
          initialize: async () => ({
            protocolVersion: ACP_PROTOCOL_VERSION,
            agentInfo: { name: "SlowAgent", version: "1.0" },
          }),
          newSession: async () => ({
            sessionId: "session-1" as ACPSessionId,
          }),
          prompt: async () => {
            // Simulate long-running operation
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return { stopReason: "end_turn" as const };
          },
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
        timeout: 10000,
      });

      await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
      await acp.newSession({ cwd: "/project", mcpServers: [] });

      // Start prompt and close stream immediately
      const promptPromise = acp.prompt({
        sessionId: acp.sessionId!,
        prompt: [{ type: "text", text: "test" }],
      });

      // Close stream while prompt is in progress
      await acp.close();

      // Prompt should be rejected
      await expect(promptPromise).rejects.toThrow("ACP stream closed");

      await client.disconnect();
    });
  });
});
