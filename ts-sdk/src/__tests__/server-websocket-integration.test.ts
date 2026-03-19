/**
 * Integration Test: MAPServer over Real WebSocket
 *
 * Tests the MAPServer with real WebSocket transport, proving that
 * external applications (like OpenHive) can use the SDK server module
 * with standard Node.js WebSocket libraries.
 *
 * Flow tested:
 *   1. Start a ws WebSocketServer
 *   2. Create a MAPServer instance
 *   3. Accept connections via websocketStream()
 *   4. Client connects, registers, sends messages, disconnects
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { MAPServer, type MAPServerOptions } from "../server";
import { websocketStream } from "../stream";
import { AgentConnection } from "../connection/agent";

const PORT = 19690;

describe("MAPServer WebSocket Integration", () => {
  let wss: WebSocketServer;
  let server: MAPServer;

  beforeAll(async () => {
    // Create MAPServer with default in-memory stores
    server = new MAPServer({
      name: "IntegrationTestServer",
      version: "0.0.1",
    });

    // Start a real WebSocket server
    wss = new WebSocketServer({ port: PORT });

    wss.on("connection", (ws) => {
      // Convert ws WebSocket → SDK Stream → accept on MAPServer
      const stream = websocketStream(ws as unknown as globalThis.WebSocket);
      const router = server.accept(stream, {
        role: "agent",
        transportType: "websocket",
      });
      router.start();
    });

    // Wait for server to be ready
    await new Promise<void>((resolve) => {
      wss.on("listening", resolve);
    });
  });

  afterAll(async () => {
    await server.close({ timeout: 2000 });
    wss.close();
    await new Promise<void>((resolve) => wss.on("close", resolve));
  });

  it("accepts a client connection via AgentConnection.connect()", async () => {
    const agent = await AgentConnection.connect(`ws://127.0.0.1:${PORT}`, {
      name: "test-agent",
      role: "worker",
      scopes: ["test:scope"],
    });

    expect(agent.isConnected).toBe(true);
    expect(agent.agentId).toBeTruthy();

    await agent.disconnect();
  });

  it("accepts a client using createConnection + connectOnly + register", async () => {
    const agent = await AgentConnection.createConnection(
      `ws://127.0.0.1:${PORT}`,
      { name: "split-flow-agent", role: "executor" },
    );

    const connectResult = await agent.connectOnly();
    expect(connectResult.sessionId).toBeTruthy();
    expect(connectResult.protocolVersion).toBeDefined();

    // No auth required (server has no auth configured)
    expect(connectResult.authRequired).toBeUndefined();

    const registeredAgent = await agent.register();
    expect(registeredAgent.id).toBeTruthy();
    expect(registeredAgent.name).toBe("split-flow-agent");
    expect(registeredAgent.role).toBe("executor");

    await agent.disconnect();
  });

  it("supports multiple concurrent connections", async () => {
    const agent1 = await AgentConnection.connect(`ws://127.0.0.1:${PORT}`, {
      name: "agent-1",
      role: "worker",
    });

    const agent2 = await AgentConnection.connect(`ws://127.0.0.1:${PORT}`, {
      name: "agent-2",
      role: "worker",
    });

    expect(agent1.agentId).not.toBe(agent2.agentId);
    expect(server.connections.size).toBeGreaterThanOrEqual(2);

    await agent1.disconnect();
    await agent2.disconnect();
  });

  it("handles agent state updates", async () => {
    const agent = await AgentConnection.connect(`ws://127.0.0.1:${PORT}`, {
      name: "stateful-agent",
      role: "worker",
    });

    await agent.busy();
    const busyAgent = server.agents.get(agent.agentId!);
    expect(busyAgent?.state).toBe("busy");

    await agent.idle();
    const idleAgent = server.agents.get(agent.agentId!);
    expect(idleAgent?.state).toBe("idle");

    await agent.disconnect();
  });

  it("tracks agents in the registry", async () => {
    const agent = await AgentConnection.connect(`ws://127.0.0.1:${PORT}`, {
      name: "registry-test",
      role: "observer",
    });

    const agents = server.agents.list();
    const found = agents.find((a) => a.name === "registry-test");
    expect(found).toBeDefined();
    expect(found!.role).toBe("observer");

    await agent.disconnect();
  });

  it("emits events on agent registration", async () => {
    const events: string[] = [];
    const unsub = server.eventBus.on("agent.registered", () => events.push("registered"));

    const agent = await AgentConnection.connect(`ws://127.0.0.1:${PORT}`, {
      name: "event-test",
      role: "worker",
    });

    expect(events).toContain("registered");

    await agent.disconnect();
  });

  it("supports custom additional handlers", async () => {
    // Create a new server with a custom handler
    const customServer = new MAPServer({
      name: "CustomServer",
      additionalHandlers: {
        "x-openhive/sync": async (params: any) => {
          return { synced: true, resource: params.resource };
        },
      },
    });

    const customWss = new WebSocketServer({ port: PORT + 1 });
    customWss.on("connection", (ws) => {
      const stream = websocketStream(ws as unknown as globalThis.WebSocket);
      customServer.accept(stream, { role: "agent" }).start();
    });

    await new Promise<void>((resolve) => customWss.on("listening", resolve));

    try {
      const agent = await AgentConnection.connect(
        `ws://127.0.0.1:${PORT + 1}`,
        { name: "custom-handler-test", role: "worker" },
      );

      // Call the custom handler via extension
      const result = await agent.callExtension("x-openhive/sync", {
        resource: "memory-bank-001",
      });

      expect(result).toBeDefined();
      expect((result as any).synced).toBe(true);
      expect((result as any).resource).toBe("memory-bank-001");

      await agent.disconnect();
    } finally {
      await customServer.close({ timeout: 1000 });
      customWss.close();
      await new Promise<void>((resolve) => customWss.on("close", resolve));
    }
  });
});
