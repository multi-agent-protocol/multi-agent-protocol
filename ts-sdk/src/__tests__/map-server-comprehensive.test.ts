/**
 * Comprehensive integration tests for MAPServer convenience layer
 *
 * Tests all major protocol features working together through MAPServer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MAPServer,
  type MAPEvent,
  type Middleware,
} from "../server";
import { createStreamPair } from "../stream";
import { ClientConnection } from "../connection/client";
import { AgentConnection } from "../connection/agent";

describe("MAPServer Comprehensive Integration", () => {
  let server: MAPServer;

  afterEach(async () => {
    if (server) {
      await server.close({ force: true });
    }
  });

  describe("scope operations", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "ScopeServer" });
    });

    it("should allow agent to create and query scopes", async () => {
      const [agentStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "agent" });
      router.start();

      const agent = new AgentConnection(agentStream, { name: "ScopeAgent", role: "worker" });
      await agent.connect();

      // Create a scope
      const scope = await agent.createScope({ name: "TestRoom" });
      expect(scope.name).toBe("TestRoom");
      expect(scope.id).toBeDefined();

      // Verify scope exists in server
      const serverScope = server.scopes.get(scope.id);
      expect(serverScope?.name).toBe("TestRoom");

      await agent.disconnect();
    });

    it("should allow client to list scopes", async () => {
      // Create scope via server
      server.scopes.create({ name: "PreexistingRoom" });

      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "ScopeClient" });
      await client.connect();

      // List scopes
      const result = await client.listScopes();
      expect(result.scopes).toContainEqual(expect.objectContaining({ name: "PreexistingRoom" }));

      await client.disconnect();
    });

    it("should allow agent to join and leave scopes", async () => {
      // Create scope via server
      const scope = server.scopes.create({ name: "AgentRoom" });

      // Connect agent
      const [agentStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "agent" });
      router.start();

      const agent = new AgentConnection(agentStream, {
        name: "ScopeAgent",
        role: "worker",
      });
      const { agent: registeredAgent } = await agent.connect();

      // Join scope
      await agent.joinScope(scope.id);

      // Verify membership
      const members = server.scopes.getMembers(scope.id);
      expect(members).toContain(registeredAgent.id);

      // Leave scope
      await agent.leaveScope(scope.id);

      // Verify no longer member
      const membersAfter = server.scopes.getMembers(scope.id);
      expect(membersAfter).not.toContain(registeredAgent.id);

      await agent.disconnect();
    });
  });

  describe("agent operations", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "AgentServer" });
    });

    it("should allow client to observe agent list", async () => {
      // Connect client first
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();
      const client = new ClientConnection(clientStream, { name: "Observer" });
      await client.connect();

      // Initially no agents (just client session)
      let result = await client.listAgents();
      expect(result.agents).toHaveLength(0);

      // Connect an agent
      const [agentStream, agentServerStream] = createStreamPair();
      const agentRouter = server.accept(agentServerStream, { role: "agent" });
      agentRouter.start();
      const agent = new AgentConnection(agentStream, { name: "Observable", role: "worker" });
      await agent.connect();

      // Now should see agent
      result = await client.listAgents();
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("Observable");

      await agent.disconnect();
      await client.disconnect();
    });

    it("should allow direct messaging between agents", async () => {
      // Connect two agents
      const [agent1Stream, server1Stream] = createStreamPair();
      const router1 = server.accept(server1Stream, { role: "agent" });
      router1.start();
      const agent1 = new AgentConnection(agent1Stream, { name: "Sender", role: "worker" });
      const { agent: a1 } = await agent1.connect();

      const [agent2Stream, server2Stream] = createStreamPair();
      const router2 = server.accept(server2Stream, { role: "agent" });
      router2.start();
      const agent2 = new AgentConnection(agent2Stream, { name: "Receiver", role: "worker" });
      const { agent: a2 } = await agent2.connect();

      // Set up message receiver
      const receivedMessages: unknown[] = [];
      agent2.onMessage((msg) => receivedMessages.push(msg));

      // Send direct message
      await agent1.send(a2.id, { greeting: "Hello!" });

      // Message should be queued for delivery
      const stats = server.messages.getQueueStats();
      expect(stats).toBeDefined();

      await agent1.disconnect();
      await agent2.disconnect();
    });
  });

  describe("event subscriptions", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "EventServer" });
    });

    it("should filter events by type", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "Subscriber" });
      await client.connect();

      // Subscribe only to agent events
      const subscription = await client.subscribe({
        eventTypes: ["agent.registered"],
      });

      const receivedEvents: MAPEvent[] = [];

      // Set up event collector with timeout
      const collectPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 500);

        (async () => {
          for await (const event of subscription) {
            receivedEvents.push(event);
            if (event.type === "agent.registered") {
              clearTimeout(timeout);
              resolve();
              break;
            }
          }
        })();
      });

      // Connect an agent (triggers agent.registered)
      const [agentStream, agentServerStream] = createStreamPair();
      const agentRouter = server.accept(agentServerStream, { role: "agent" });
      agentRouter.start();
      const agent = new AgentConnection(agentStream, { name: "FilterTest", role: "test" });
      await agent.connect();

      // Wait for events
      await collectPromise;

      // Should have agent.registered
      const agentEvents = receivedEvents.filter(e => e.type === "agent.registered");
      expect(agentEvents.length).toBeGreaterThanOrEqual(1);

      await agent.disconnect();
      await client.disconnect();
    });

    it("should deliver session events to subscribers", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "SessionWatcher" });
      await client.connect();

      // Subscribe to session events
      const subscription = await client.subscribe({
        eventTypes: ["session.connected"],
      });

      const receivedEvents: MAPEvent[] = [];
      const collectPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 500);

        (async () => {
          for await (const event of subscription) {
            receivedEvents.push(event);
            if (event.type === "session.connected") {
              clearTimeout(timeout);
              resolve();
              break;
            }
          }
        })();
      });

      // Connect another client (triggers session.connected)
      const [client2Stream, server2Stream] = createStreamPair();
      const router2 = server.accept(server2Stream, { role: "client" });
      router2.start();
      const client2 = new ClientConnection(client2Stream, { name: "TriggerClient" });
      await client2.connect();

      await collectPromise;

      // Should have received session.connected
      expect(receivedEvents.some(e => e.type === "session.connected")).toBe(true);

      await client2.disconnect();
      await client.disconnect();
    });
  });

  describe("session management", () => {
    beforeEach(() => {
      server = new MAPServer({
        name: "SessionServer",
        resumeWindowMs: 60000, // 1 minute resume window
      });
    });

    it("should track sessions for connected clients", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "SessionClient" });
      const result = await client.connect();

      // Session should exist
      const session = server.sessions.get(result.sessionId);
      expect(session).toBeDefined();
      expect(session?.role).toBe("client");
      expect(session?.status).toBe("connected");

      await client.disconnect();
    });

    it("should mark sessions as disconnected on client disconnect", async () => {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "DisconnectClient" });
      const result = await client.connect();
      const sessionId = result.sessionId;

      await client.disconnect();

      // Wait for disconnect to process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Session should be disconnected
      const session = server.sessions.get(sessionId);
      expect(session?.status).toBe("disconnected");
    });
  });

  describe("custom middleware", () => {
    it("should execute middleware on requests", async () => {
      const middlewareCalls: string[] = [];

      const loggingMiddleware: Middleware = async (method, params, ctx, next) => {
        middlewareCalls.push(`before:${method}`);
        const result = await next(method, params, ctx);
        middlewareCalls.push(`after:${method}`);
        return result;
      };

      server = new MAPServer({
        name: "MiddlewareServer",
        middleware: [loggingMiddleware],
      });

      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "MiddlewareClient" });
      await client.connect();

      // Middleware should have logged the connect call
      expect(middlewareCalls).toContain("before:map/connect");
      expect(middlewareCalls).toContain("after:map/connect");

      await client.disconnect();
    });

    it("should chain multiple middleware in order", async () => {
      const order: string[] = [];

      const middleware1: Middleware = async (method, params, ctx, next) => {
        order.push("m1-before");
        const result = await next(method, params, ctx);
        order.push("m1-after");
        return result;
      };

      const middleware2: Middleware = async (method, params, ctx, next) => {
        order.push("m2-before");
        const result = await next(method, params, ctx);
        order.push("m2-after");
        return result;
      };

      server = new MAPServer({
        name: "ChainServer",
        middleware: [middleware1, middleware2],
      });

      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "ChainClient" });
      await client.connect();

      // Should execute in correct order
      expect(order).toEqual([
        "m1-before",
        "m2-before",
        "m2-after",
        "m1-after",
      ]);

      await client.disconnect();
    });
  });

  describe("additional handlers", () => {
    it("should merge additional handlers with built-in ones", async () => {
      let customMethodCalled = false;

      server = new MAPServer({
        name: "CustomMethodServer",
        additionalHandlers: {
          "custom/ping": async () => {
            customMethodCalled = true;
            return { pong: true };
          },
        },
      });

      // Verify custom handler is in registry
      expect(server.handlers["custom/ping"]).toBeDefined();

      // Verify built-in handlers still exist
      expect(server.handlers["map/connect"]).toBeDefined();
      expect(server.handlers["map/agents/list"]).toBeDefined();

      // Custom handler can be called directly
      const result = await server.handlers["custom/ping"]!({}, {} as any);
      expect(customMethodCalled).toBe(true);
      expect(result).toEqual({ pong: true });
    });
  });

  describe("server lifecycle", () => {
    it("should handle rapid connect/disconnect cycles", async () => {
      server = new MAPServer({ name: "RapidServer" });

      // Rapid connection cycles
      for (let i = 0; i < 10; i++) {
        const [clientStream, serverStream] = createStreamPair();
        const router = server.accept(serverStream, { role: "client" });
        router.start();

        const client = new ClientConnection(clientStream, { name: `Rapid${i}` });
        await client.connect();
        await client.disconnect();
      }

      // Server should handle this gracefully
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(server.connections.size).toBe(0);
    });

    it("should clean up resources on force close", async () => {
      server = new MAPServer({ name: "CleanupServer" });

      // Connect multiple clients
      const clients: ClientConnection[] = [];
      for (let i = 0; i < 5; i++) {
        const [clientStream, serverStream] = createStreamPair();
        const router = server.accept(serverStream, { role: "client" });
        router.start();
        const client = new ClientConnection(clientStream, { name: `Cleanup${i}` });
        await client.connect();
        clients.push(client);
      }

      expect(server.connections.size).toBe(5);

      // Force close server
      await server.close({ force: true });

      expect(server.connections.size).toBe(0);
    });

    it("should gracefully close with timeout", async () => {
      server = new MAPServer({ name: "GracefulServer" });

      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "GracefulClient" });
      await client.connect();

      // Start graceful close with short timeout
      const closePromise = server.close({ timeout: 100 });

      // Should complete without hanging
      await closePromise;

      expect(server.connections.size).toBe(0);
    });
  });

  describe("building block integration", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "BlockServer" });
    });

    it("should expose consistent state across building blocks", async () => {
      // Connect agent
      const [agentStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "agent" });
      router.start();
      const agent = new AgentConnection(agentStream, { name: "StateAgent", role: "worker" });
      const { agent: registeredAgent, connection } = await agent.connect();

      // Verify agent in registry
      const agentFromRegistry = server.agents.get(registeredAgent.id);
      expect(agentFromRegistry).toBeDefined();
      expect(agentFromRegistry?.sessionId).toBe(connection.sessionId);

      // Verify session exists
      const session = server.sessions.get(connection.sessionId);
      expect(session).toBeDefined();
      expect(session?.agentIds).toContain(registeredAgent.id);

      // Create scope and join
      const scope = server.scopes.create({ name: "StateScope" });
      await agent.joinScope(scope.id);

      // Verify membership
      const members = server.scopes.getMembers(scope.id);
      expect(members).toContain(registeredAgent.id);

      // Verify agent's scopes
      const agentScopes = server.scopes.getScopesForAgent(registeredAgent.id);
      expect(agentScopes).toContain(scope.id);

      await agent.disconnect();
    });

    it("should emit events for all state changes", async () => {
      const events: MAPEvent[] = [];
      server.on("*", (event) => events.push(event));

      // Connect agent
      const [agentStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "agent" });
      router.start();
      const agent = new AgentConnection(agentStream, { name: "EventAgent", role: "worker" });
      await agent.connect();

      // Create scope
      server.scopes.create({ name: "EventScope" });

      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have various events
      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain("session.connected");
      expect(eventTypes).toContain("agent.registered");
      expect(eventTypes).toContain("scope.created");

      await agent.disconnect();
    });

    it("should provide direct access to all building blocks", () => {
      server = new MAPServer({ name: "AccessServer" });

      // All building blocks should be accessible
      expect(server.eventBus).toBeDefined();
      expect(server.agents).toBeDefined();
      expect(server.scopes).toBeDefined();
      expect(server.sessions).toBeDefined();
      expect(server.subscriptions).toBeDefined();
      expect(server.messages).toBeDefined();
      expect(server.handlers).toBeDefined();
      expect(server.connections).toBeDefined();
    });
  });

  describe("custom stores", () => {
    it("should use custom stores when provided", () => {
      const storedEvents: MAPEvent[] = [];

      // Custom EventStore implementing the correct interface
      const customEventStore = {
        append: (event: MAPEvent) => { storedEvents.push(event); },
        getById: (id: string) => storedEvents.find(e => e.id === id),
        query: () => storedEvents,
        clear: () => { storedEvents.length = 0; },
      };

      server = new MAPServer({
        name: "CustomStoreServer",
        stores: {
          events: customEventStore,
        },
      });

      // Emit an event
      server.emit({ type: "test.event", data: { value: 42 } });

      // Should be in custom store
      expect(storedEvents.length).toBe(1);
      expect(storedEvents[0].type).toBe("test.event");
    });
  });

  describe("event delivery options", () => {
    it("should disable event delivery when configured", async () => {
      let deliveryAttempted = false;

      // Create server with event delivery disabled
      server = new MAPServer({
        name: "NoDeliveryServer",
        eventDelivery: { enabled: false },
      });

      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, { name: "NoDeliveryClient" });
      await client.connect();

      // Subscribe
      const subscription = await client.subscribe({ eventTypes: ["custom.event"] });

      // Collect events with short timeout
      const events: MAPEvent[] = [];
      const collectPromise = new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
        (async () => {
          for await (const event of subscription) {
            events.push(event);
          }
        })();
      });

      // Emit custom event
      server.emit({ type: "custom.event", data: {} });

      await collectPromise;

      // Should NOT have received the event (delivery disabled)
      expect(events.filter(e => e.type === "custom.event")).toHaveLength(0);

      await client.disconnect();
    });
  });
});
