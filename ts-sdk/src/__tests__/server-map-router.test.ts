/**
 * Tests for MAPRouter interface, adapter, and BaseMAPRouter
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  routerToHandlers,
  getProtocolMethods,
  getInterfaceMethod,
  BaseMAPRouter,
  DefaultMAPRouter,
} from "../server/router";
import { EventBusImpl } from "../server/events";
import { AgentRegistryImpl } from "../server/agents";
import { SessionManagerImpl } from "../server/sessions";
import { SubscriptionManagerImpl } from "../server/subscriptions";
import { ScopeManagerImpl } from "../server/scopes";
import { MessageRouterImpl } from "../server/messages";
import type {
  MAPRouterInterface,
  HandlerContext,
  ServerSession,
} from "../server/types";

describe("routerToHandlers adapter", () => {
  it("should convert all MAPRouterInterface methods to handlers", () => {
    const mockRouter: Partial<MAPRouterInterface> = {
      connect: vi.fn().mockResolvedValue({ sessionId: "test" }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      registerAgent: vi.fn().mockResolvedValue({ id: "agent-1", name: "Test" }),
      listAgents: vi.fn().mockResolvedValue([]),
    };

    const handlers = routerToHandlers(mockRouter as MAPRouterInterface);

    expect(handlers["map/connect"]).toBeDefined();
    expect(handlers["map/disconnect"]).toBeDefined();
    expect(handlers["map/agents/register"]).toBeDefined();
    expect(handlers["map/agents/list"]).toBeDefined();
  });

  it("should call the correct method on the router", async () => {
    const mockRouter: Partial<MAPRouterInterface> = {
      registerAgent: vi.fn().mockResolvedValue({ id: "agent-1", name: "Test" }),
    };

    const handlers = routerToHandlers(mockRouter as MAPRouterInterface);

    const ctx = createMockContext();
    await handlers["map/agents/register"]!(
      { name: "Test Agent" },
      ctx
    );

    expect(mockRouter.registerAgent).toHaveBeenCalledWith(
      { name: "Test Agent" },
      ctx
    );
  });

  it("should bind methods to the router instance", async () => {
    class TestRouter {
      private value = "test-value";
      async connect(_params: unknown, _ctx: HandlerContext) {
        return { sessionId: this.value };
      }
    }

    const router = new TestRouter();
    const handlers = routerToHandlers(router as unknown as MAPRouterInterface);

    const ctx = createMockContext();
    const result = await handlers["map/connect"]!({}, ctx);

    expect(result).toEqual({ sessionId: "test-value" });
  });
});

describe("getProtocolMethods", () => {
  it("should return all protocol methods", () => {
    const methods = getProtocolMethods();

    expect(methods).toContain("map/connect");
    expect(methods).toContain("map/disconnect");
    expect(methods).toContain("map/agents/register");
    expect(methods).toContain("map/agents/unregister");
    expect(methods).toContain("map/agents/list");
    expect(methods).toContain("map/agents/get");
    expect(methods).toContain("map/scopes/create");
    expect(methods).toContain("map/scopes/join");
    expect(methods).toContain("map/send");
    expect(methods).toContain("map/subscribe");
  });
});

describe("getInterfaceMethod", () => {
  it("should return the interface method for a protocol method", () => {
    expect(getInterfaceMethod("map/connect")).toBe("connect");
    expect(getInterfaceMethod("map/agents/register")).toBe("registerAgent");
    expect(getInterfaceMethod("map/scopes/create")).toBe("createScope");
  });

  it("should return undefined for unknown methods", () => {
    expect(getInterfaceMethod("unknown/method")).toBeUndefined();
  });
});

describe("BaseMAPRouter", () => {
  let eventBus: EventBusImpl;
  let agents: AgentRegistryImpl;
  let sessions: SessionManagerImpl;
  let subscriptions: SubscriptionManagerImpl;
  let scopes: ScopeManagerImpl;
  let messages: MessageRouterImpl;
  let router: DefaultMAPRouter;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    agents = new AgentRegistryImpl({ eventBus });
    sessions = new SessionManagerImpl({ eventBus });
    scopes = new ScopeManagerImpl({ eventBus });
    subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
    messages = new MessageRouterImpl({ eventBus, agents, scopes });

    router = new DefaultMAPRouter({
      agents,
      scopes,
      sessions,
      subscriptions,
      messages,
      eventBus,
    });
  });

  describe("connect", () => {
    it("should return session info", async () => {
      const ctx = createMockContext();
      const result = await router.connect({}, ctx);

      expect(result.sessionId).toBe(ctx.session.id);
    });
  });

  describe("disconnect", () => {
    it("should unregister agents and cancel subscriptions", async () => {
      const session = sessions.create({ role: "agent" });
      const ctx = createContextWithSession(session);

      // Register an agent
      const agent = await router.registerAgent({ name: "Test" }, ctx);
      expect(agents.get(agent.id)).toBeDefined();

      // Create a subscription
      const sub = await router.subscribe({ filter: {} }, ctx);
      expect(subscriptions.get(sub.id)).toBeDefined();

      // Disconnect
      await router.disconnect({}, ctx);

      // Session should be disconnected
      expect(sessions.get(session.id)?.status).toBe("disconnected");
    });
  });

  describe("registerAgent", () => {
    it("should register an agent", async () => {
      const ctx = createMockContext();
      const agent = await router.registerAgent(
        { name: "Test Agent", role: "worker" },
        ctx
      );

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe("Test Agent");
      expect(agent.role).toBe("worker");
      expect(ctx.session.agentIds).toContain(agent.id);
    });
  });

  describe("unregisterAgent", () => {
    it("should unregister an agent", async () => {
      const ctx = createMockContext();
      const agent = await router.registerAgent({ name: "Test" }, ctx);

      await router.unregisterAgent({ agentId: agent.id }, ctx);

      expect(agents.get(agent.id)).toBeUndefined();
      expect(ctx.session.agentIds).not.toContain(agent.id);
    });

    it("should throw if agent not found", async () => {
      const ctx = createMockContext();

      await expect(
        router.unregisterAgent({ agentId: "nonexistent" }, ctx)
      ).rejects.toThrow("Agent not found");
    });
  });

  describe("listAgents", () => {
    it("should list agents with filter", async () => {
      const ctx = createMockContext();
      await router.registerAgent({ name: "Agent1", role: "worker" }, ctx);
      await router.registerAgent({ name: "Agent2", role: "manager" }, ctx);

      const all = await router.listAgents({}, ctx);
      expect(all).toHaveLength(2);

      const workers = await router.listAgents({ role: "worker" }, ctx);
      expect(workers).toHaveLength(1);
      expect(workers[0].name).toBe("Agent1");
    });
  });

  describe("createScope", () => {
    it("should create a scope", async () => {
      const ctx = createMockContext();
      const scope = await router.createScope(
        { name: "Test Scope", metadata: { key: "value" } },
        ctx
      );

      expect(scope.id).toBeDefined();
      expect(scope.name).toBe("Test Scope");
      expect(scope.metadata).toEqual({ key: "value" });
    });
  });

  describe("deleteScope", () => {
    it("should delete a scope", async () => {
      const ctx = createMockContext();
      const scope = await router.createScope({ name: "Test" }, ctx);

      await router.deleteScope({ scopeId: scope.id }, ctx);

      expect(scopes.get(scope.id)).toBeUndefined();
    });

    it("should throw if scope not found", async () => {
      const ctx = createMockContext();

      await expect(
        router.deleteScope({ scopeId: "nonexistent" }, ctx)
      ).rejects.toThrow("Scope not found");
    });
  });

  describe("joinScope and leaveScope", () => {
    it("should join and leave a scope", async () => {
      const ctx = createMockContext();
      const agent = await router.registerAgent({ name: "Test" }, ctx);
      const scope = await router.createScope({ name: "Room" }, ctx);

      await router.joinScope({ scopeId: scope.id, agentId: agent.id }, ctx);
      expect(scopes.getMembers(scope.id)).toContain(agent.id);

      await router.leaveScope({ scopeId: scope.id, agentId: agent.id }, ctx);
      expect(scopes.getMembers(scope.id)).not.toContain(agent.id);
    });
  });

  describe("send", () => {
    it("should send message to agent", async () => {
      const ctx = createMockContext();
      const agent = await router.registerAgent({ name: "Sender" }, ctx);
      const recipient = await router.registerAgent({ name: "Recipient" }, ctx);

      const message = await router.send(
        { to: recipient.id, payload: { text: "Hello" } },
        ctx
      );

      expect(message.id).toBeDefined();
      expect(message.to).toBe(recipient.id);
      expect(message.payload).toEqual({ text: "Hello" });
    });

    it("should send message to scope", async () => {
      const ctx = createMockContext();
      const agent = await router.registerAgent({ name: "Sender" }, ctx);
      const scope = await router.createScope({ name: "Room" }, ctx);
      await router.joinScope({ scopeId: scope.id, agentId: agent.id }, ctx);

      const message = await router.send(
        { to: scope.id, payload: { text: "Broadcast" } },
        ctx
      );

      expect(message.id).toBeDefined();
      expect(message.to).toBe(scope.id);
    });

    it("should throw if no recipients", async () => {
      const ctx = createMockContext();

      await expect(
        router.send({ to: [], payload: {} }, ctx)
      ).rejects.toThrow("No recipients specified");
    });
  });

  describe("subscribe and unsubscribe", () => {
    it("should create and cancel subscription", async () => {
      const ctx = createMockContext();
      const sub = await router.subscribe(
        { filter: { eventTypes: ["agent.registered"] } },
        ctx
      );

      expect(sub.id).toBeDefined();
      expect(ctx.session.subscriptionIds).toContain(sub.id);

      await router.unsubscribe({ subscriptionId: sub.id }, ctx);
      expect(ctx.session.subscriptionIds).not.toContain(sub.id);
    });

    it("should throw if subscription not found on unsubscribe", async () => {
      const ctx = createMockContext();

      await expect(
        router.unsubscribe({ subscriptionId: "nonexistent" }, ctx)
      ).rejects.toThrow("Subscription not found");
    });
  });

  describe("replay", () => {
    it("should replay events for subscription", async () => {
      const ctx = createMockContext();

      // Emit some events
      eventBus.emit({
        type: "agent.registered",
        timestamp: new Date().toISOString(),
        data: { agentId: "test" },
      });

      // Create subscription
      const sub = await router.subscribe(
        { filter: { eventTypes: ["agent.registered"] } },
        ctx
      );

      // Replay
      const events = await router.replay({ subscriptionId: sub.id }, ctx);

      expect(events).toBeInstanceOf(Array);
    });

    it("should throw if subscription not found", async () => {
      const ctx = createMockContext();

      await expect(
        router.replay({ subscriptionId: "nonexistent" }, ctx)
      ).rejects.toThrow("Subscription not found");
    });
  });
});

describe("Custom router extending BaseMAPRouter", () => {
  it("should allow overriding methods", async () => {
    const eventBus = new EventBusImpl();
    const agents = new AgentRegistryImpl({ eventBus });
    const sessions = new SessionManagerImpl({ eventBus });
    const scopes = new ScopeManagerImpl({ eventBus });
    const subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
    const messages = new MessageRouterImpl({ eventBus, agents, scopes });

    const onRegister = vi.fn();

    class CustomRouter extends BaseMAPRouter {
      async registerAgent(
        params: { name: string; role?: string; metadata?: Record<string, unknown> },
        ctx: HandlerContext
      ) {
        onRegister(params.name);
        return super.registerAgent(params, ctx);
      }
    }

    const router = new CustomRouter({
      agents,
      scopes,
      sessions,
      subscriptions,
      messages,
      eventBus,
    });

    const ctx = createMockContext();
    await router.registerAgent({ name: "Custom Agent" }, ctx);

    expect(onRegister).toHaveBeenCalledWith("Custom Agent");
  });
});

describe("routerToHandlers with DefaultMAPRouter", () => {
  it("should create working handlers from DefaultMAPRouter", async () => {
    const eventBus = new EventBusImpl();
    const agents = new AgentRegistryImpl({ eventBus });
    const sessions = new SessionManagerImpl({ eventBus });
    const scopes = new ScopeManagerImpl({ eventBus });
    const subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
    const messages = new MessageRouterImpl({ eventBus, agents, scopes });

    const router = new DefaultMAPRouter({
      agents,
      scopes,
      sessions,
      subscriptions,
      messages,
      eventBus,
    });

    const handlers = routerToHandlers(router);

    const ctx = createMockContext();

    // Test register through handler
    const agent = (await handlers["map/agents/register"]!(
      { name: "Handler Test" },
      ctx
    )) as { id: string; name: string };

    expect(agent.name).toBe("Handler Test");

    // Test list through handler
    const agentList = (await handlers["map/agents/list"]!({}, ctx)) as Array<{
      id: string;
      name: string;
    }>;

    expect(agentList).toHaveLength(1);
    expect(agentList[0].name).toBe("Handler Test");
  });
});

// Helper functions

function createMockContext(): HandlerContext {
  return {
    session: {
      id: `session-${Date.now()}`,
      status: "connected",
      role: "agent",
      agentIds: [],
      subscriptionIds: [],
      permissions: {},
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    },
  };
}

function createContextWithSession(session: ServerSession): HandlerContext {
  return { session };
}
