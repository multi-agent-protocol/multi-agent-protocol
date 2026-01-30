/**
 * Tests for MAPServer convenience layer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MAPServer,
  type MAPServerOptions,
  EventBusImpl,
  AgentRegistryImpl,
  SessionManagerImpl,
  ScopeManagerImpl,
  SubscriptionManagerImpl,
  MessageRouterImpl,
  InMemoryEventStore,
  InMemoryAgentStore,
  type MAPEvent,
  type HandlerRegistry,
} from "../server";
import { createStreamPair } from "../stream";
import { ClientConnection } from "../connection/client";
import { AgentConnection } from "../connection/agent";

describe("MAPServer", () => {
  let server: MAPServer;

  afterEach(async () => {
    if (server) {
      await server.close({ force: true });
    }
  });

  describe("construction", () => {
    it("should create with default options", () => {
      server = new MAPServer();

      expect(server.eventBus).toBeDefined();
      expect(server.agents).toBeDefined();
      expect(server.scopes).toBeDefined();
      expect(server.sessions).toBeDefined();
      expect(server.subscriptions).toBeDefined();
      expect(server.messages).toBeDefined();
      expect(server.handlers).toBeDefined();
    });

    it("should create with custom name and version", () => {
      server = new MAPServer({
        name: "TestServer",
        version: "2.0.0",
      });

      expect(server).toBeDefined();
    });

    it("should use custom stores when provided", () => {
      const customEventStore = new InMemoryEventStore();
      const customAgentStore = new InMemoryAgentStore();

      server = new MAPServer({
        stores: {
          events: customEventStore,
          agents: customAgentStore,
        },
      });

      expect(server.eventBus).toBeDefined();
      expect(server.agents).toBeDefined();
    });

    it("should use custom building blocks when provided", () => {
      const customEventBus = new EventBusImpl();
      const customAgents = new AgentRegistryImpl({ eventBus: customEventBus });

      server = new MAPServer({
        eventBus: customEventBus,
        agents: customAgents,
      });

      expect(server.eventBus).toBe(customEventBus);
      expect(server.agents).toBe(customAgents);
    });

    it("should merge additional handlers", () => {
      const customHandler = async () => ({ custom: true });

      server = new MAPServer({
        additionalHandlers: {
          "custom/method": customHandler,
        },
      });

      expect(server.handlers["custom/method"]).toBe(customHandler);
      // Built-in handlers should still exist
      expect(server.handlers["map/connect"]).toBeDefined();
    });

    it("should replace handlers entirely when provided", () => {
      const customHandlers: HandlerRegistry = {
        "only/handler": async () => ({ only: true }),
      };

      server = new MAPServer({
        handlers: customHandlers,
      });

      expect(server.handlers).toBe(customHandlers);
      expect(server.handlers["map/connect"]).toBeUndefined();
    });
  });

  describe("accept", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "TestServer" });
    });

    it("should accept a connection and return router", () => {
      const [clientStream, serverStream] = createStreamPair();

      const router = server.accept(serverStream);

      expect(router).toBeDefined();
      expect(router.start).toBeDefined();
      expect(router.close).toBeDefined();
    });

    it("should track accepted connections", () => {
      const [, serverStream1] = createStreamPair();
      const [, serverStream2] = createStreamPair();

      server.accept(serverStream1);
      server.accept(serverStream2);

      expect(server.connections.size).toBe(2);
    });

    it("should remove connection from tracking when closed", async () => {
      const [, serverStream] = createStreamPair();

      const router = server.accept(serverStream);
      expect(server.connections.size).toBe(1);

      await router.close();

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(server.connections.size).toBe(0);
    });

    it("should accept with custom role", () => {
      const [, serverStream] = createStreamPair();

      const router = server.accept(serverStream, { role: "client" });

      expect(router).toBeDefined();
    });
  });

  describe("close", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "TestServer" });
    });

    it("should close all connections gracefully", async () => {
      const [, serverStream1] = createStreamPair();
      const [, serverStream2] = createStreamPair();

      server.accept(serverStream1);
      server.accept(serverStream2);

      expect(server.connections.size).toBe(2);

      await server.close();

      expect(server.connections.size).toBe(0);
    });

    it("should force close when force option is true", async () => {
      const [, serverStream] = createStreamPair();

      server.accept(serverStream);

      await server.close({ force: true });

      expect(server.connections.size).toBe(0);
    });

    it("should respect timeout option", async () => {
      const [, serverStream] = createStreamPair();

      server.accept(serverStream);

      // Should complete without hanging
      await server.close({ timeout: 100 });

      expect(server.connections.size).toBe(0);
    });
  });

  describe("convenience methods", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "TestServer" });
    });

    it("should emit events via emit()", () => {
      const event = server.emit({
        type: "test.event",
        data: { value: 42 },
      });

      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.type).toBe("test.event");
      expect(event.data).toEqual({ value: 42 });
    });

    it("should subscribe to events via on()", () => {
      const events: MAPEvent[] = [];

      server.on("test.event", (event) => {
        events.push(event);
      });

      server.emit({ type: "test.event", data: {} });
      server.emit({ type: "test.event", data: {} });

      expect(events).toHaveLength(2);
    });

    it("should unsubscribe from events", () => {
      const events: MAPEvent[] = [];

      const unsubscribe = server.on("test.event", (event) => {
        events.push(event);
      });

      server.emit({ type: "test.event", data: {} });
      unsubscribe();
      server.emit({ type: "test.event", data: {} });

      expect(events).toHaveLength(1);
    });

    it("should subscribe to all events with '*'", () => {
      const events: MAPEvent[] = [];

      server.on("*", (event) => {
        events.push(event);
      });

      server.emit({ type: "type.a", data: {} });
      server.emit({ type: "type.b", data: {} });

      expect(events).toHaveLength(2);
    });
  });

  describe("event delivery", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "TestServer" });
    });

    it("should be enabled by default", () => {
      // Event delivery is wired internally - we just verify no errors
      const [, serverStream] = createStreamPair();
      server.accept(serverStream);

      // Should not throw
      server.emit({ type: "test.event", data: {} });
    });

    it("should be disabled when eventDelivery.enabled is false", () => {
      server = new MAPServer({
        name: "TestServer",
        eventDelivery: { enabled: false },
      });

      // Should not throw
      server.emit({ type: "test.event", data: {} });
    });
  });

  describe("direct building block access", () => {
    beforeEach(() => {
      server = new MAPServer({ name: "TestServer" });
    });

    it("should allow direct agent registration", () => {
      const agent = server.agents.register({
        name: "DirectAgent",
        sessionId: "test-session",
      });

      expect(agent.name).toBe("DirectAgent");
      expect(server.agents.get(agent.id)).toBeDefined();
    });

    it("should allow direct scope creation", () => {
      const scope = server.scopes.create({
        name: "DirectScope",
      });

      expect(scope.name).toBe("DirectScope");
      expect(server.scopes.get(scope.id)).toBeDefined();
    });

    it("should allow direct session creation", () => {
      const session = server.sessions.create({
        role: "agent",
        name: "DirectSession",
      });

      expect(session.name).toBe("DirectSession");
      expect(server.sessions.get(session.id)).toBeDefined();
    });
  });
});

describe("MAPServer integration", () => {
  let server: MAPServer;

  afterEach(async () => {
    if (server) {
      await server.close({ force: true });
    }
  });

  it("should handle full client connection flow", async () => {
    server = new MAPServer({ name: "IntegrationServer" });

    const [clientStream, serverStream] = createStreamPair();

    // Accept connection on server
    const router = server.accept(serverStream, { role: "client" });
    router.start();

    // Connect client
    const client = new ClientConnection(clientStream, { name: "TestClient" });
    const result = await client.connect();

    expect(result.sessionId).toBeDefined();
    expect(result.systemInfo?.name).toBe("IntegrationServer");

    await client.disconnect();
  });

  it("should handle full agent connection flow", async () => {
    server = new MAPServer({ name: "IntegrationServer" });

    const [clientStream, serverStream] = createStreamPair();

    // Accept connection on server
    const router = server.accept(serverStream, { role: "agent" });
    router.start();

    // Connect agent
    const agent = new AgentConnection(clientStream, {
      name: "TestAgent",
      role: "worker",
    });
    const result = await agent.connect();

    expect(result.agent.name).toBe("TestAgent");
    expect(result.agent.role).toBe("worker");

    // Verify agent is in registry
    const registeredAgent = server.agents.get(result.agent.id);
    expect(registeredAgent?.name).toBe("TestAgent");

    await agent.disconnect();
  });

  it("should handle multiple concurrent connections", async () => {
    server = new MAPServer({ name: "IntegrationServer" });

    const connections: Array<{
      client: ClientConnection;
      router: ReturnType<typeof server.accept>;
    }> = [];

    // Create 5 connections
    for (let i = 0; i < 5; i++) {
      const [clientStream, serverStream] = createStreamPair();
      const router = server.accept(serverStream, { role: "client" });
      router.start();

      const client = new ClientConnection(clientStream, {
        name: `Client${i}`,
      });
      await client.connect();

      connections.push({ client, router });
    }

    expect(server.connections.size).toBe(5);

    // Disconnect all
    for (const { client } of connections) {
      await client.disconnect();
    }
  });

  it("should deliver events to subscribed clients", async () => {
    server = new MAPServer({ name: "IntegrationServer" });

    const [clientStream, serverStream] = createStreamPair();

    const router = server.accept(serverStream, { role: "client" });
    router.start();

    const client = new ClientConnection(clientStream, { name: "TestClient" });
    await client.connect();

    // Subscribe to events
    const subscription = await client.subscribe({
      eventTypes: ["agent.registered"],
    });

    // Register an agent to trigger event
    const [agentStream, agentServerStream] = createStreamPair();
    const agentRouter = server.accept(agentServerStream, { role: "agent" });
    agentRouter.start();

    const agent = new AgentConnection(agentStream, {
      name: "EventAgent",
      role: "test",
    });
    await agent.connect();

    // Receive event
    const eventPromise = (async () => {
      for await (const event of subscription) {
        if (event.type === "agent.registered") {
          return event;
        }
      }
    })();

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 1000)
    );

    const event = await Promise.race([eventPromise, timeoutPromise]);

    expect(event).toBeDefined();
    expect(event?.type).toBe("agent.registered");

    await agent.disconnect();
    await client.disconnect();
  });
});
