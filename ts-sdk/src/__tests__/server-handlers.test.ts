/**
 * Tests for server handler factories
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBusImpl } from "../server/events";
import { AgentRegistryImpl, createAgentHandlers } from "../server/agents";
import { ScopeManagerImpl, createScopeHandlers } from "../server/scopes";
import { SessionManagerImpl } from "../server/sessions";
import {
  SubscriptionManagerImpl,
  createSubscriptionHandlers,
} from "../server/subscriptions";
import { MessageRouterImpl, createMessageHandlers } from "../server/messages";
import {
  createConnectionHandlers,
  combineHandlers,
  type HandlerContext,
} from "../server/router";
import type { ServerSession } from "../server/types";

describe("Handler Factories", () => {
  let eventBus: EventBusImpl;
  let agents: AgentRegistryImpl;
  let scopes: ScopeManagerImpl;
  let sessions: SessionManagerImpl;
  let subscriptions: SubscriptionManagerImpl;
  let messages: MessageRouterImpl;

  let mockSession: ServerSession;
  let mockContext: HandlerContext;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    agents = new AgentRegistryImpl({ eventBus });
    scopes = new ScopeManagerImpl({ eventBus });
    sessions = new SessionManagerImpl({ eventBus });
    subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
    messages = new MessageRouterImpl({ eventBus, agents, scopes });

    mockSession = sessions.create({ role: "client", name: "Test Client" });
    mockContext = {
      session: mockSession,
      requestId: "req-1",
      signal: new AbortController().signal,
    };
  });

  describe("createAgentHandlers", () => {
    it("should register an agent", async () => {
      const handlers = createAgentHandlers({ agents });

      const result = await handlers["map/agents/register"](
        { name: "Test Agent", role: "worker" },
        mockContext
      );

      expect(result.agent.name).toBe("Test Agent");
      expect(result.agent.role).toBe("worker");
      expect(mockSession.agentIds).toContain(result.agent.id);

      // Verify agent was created correctly in the registry
      const agent = agents.get(result.agent.id);
      expect(agent?.sessionId).toBe(mockSession.id);
    });

    it("should unregister an agent", async () => {
      const handlers = createAgentHandlers({ agents });

      const agentResult = await handlers["map/agents/register"](
        { name: "Test Agent" },
        mockContext
      );

      const result = await handlers["map/agents/unregister"](
        { agentId: agentResult.agent.id },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(agents.get(agentResult.agent.id)).toBeUndefined();
    });

    it("should list agents", async () => {
      const handlers = createAgentHandlers({ agents });

      await handlers["map/agents/register"]({ name: "Agent 1" }, mockContext);
      await handlers["map/agents/register"](
        { name: "Agent 2", role: "worker" },
        mockContext
      );

      const all = await handlers["map/agents/list"]({}, mockContext);
      expect(all.agents).toHaveLength(2);

      const workers = await handlers["map/agents/list"](
        { role: "worker" },
        mockContext
      );
      expect(workers.agents).toHaveLength(1);
    });

    it("should get an agent", async () => {
      const handlers = createAgentHandlers({ agents });

      const created = await handlers["map/agents/register"](
        { name: "Test Agent" },
        mockContext
      );

      const result = await handlers["map/agents/get"](
        { agentId: created.agent.id },
        mockContext
      );

      expect(result.agent.id).toBe(created.agent.id);
      expect(result.agent.name).toBe("Test Agent");
    });

    it("should update agent state", async () => {
      const handlers = createAgentHandlers({ agents });

      const agentResult = await handlers["map/agents/register"](
        { name: "Test Agent" },
        mockContext
      );

      const result = await handlers["map/agents/update/state"](
        { agentId: agentResult.agent.id, state: "busy" },
        mockContext
      );

      expect(result.state).toBe("busy");
    });

    it("should update agent metadata", async () => {
      const handlers = createAgentHandlers({ agents });

      const agentResult = await handlers["map/agents/register"](
        { name: "Test Agent", metadata: { foo: "bar" } },
        mockContext
      );

      const result = await handlers["map/agents/update/metadata"](
        { agentId: agentResult.agent.id, metadata: { baz: "qux" } },
        mockContext
      );

      expect(result.metadata).toEqual({ foo: "bar", baz: "qux" });
    });
  });

  describe("createScopeHandlers", () => {
    it("should create a scope", async () => {
      const handlers = createScopeHandlers({ scopes });

      const result = await handlers["map/scopes/create"](
        { name: "Test Scope", metadata: { key: "value" } },
        mockContext
      );

      expect(result.scope.name).toBe("Test Scope");
      expect(result.scope.metadata).toEqual({ key: "value" });
      expect(result.scope.createdBy).toBe(mockSession.id);
    });

    it("should create child scope", async () => {
      const handlers = createScopeHandlers({ scopes });

      const parentResult = await handlers["map/scopes/create"](
        { name: "Parent" },
        mockContext
      );

      const childResult = await handlers["map/scopes/create"](
        { name: "Child", parentId: parentResult.scope.id },
        mockContext
      );

      expect(childResult.scope.parentId).toBe(parentResult.scope.id);
    });

    it("should delete a scope", async () => {
      const handlers = createScopeHandlers({ scopes });

      const scopeResult = await handlers["map/scopes/create"](
        { name: "Test" },
        mockContext
      );

      const result = await handlers["map/scopes/delete"](
        { scopeId: scopeResult.scope.id },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(scopes.get(scopeResult.scope.id)).toBeUndefined();
    });

    it("should list scopes", async () => {
      const handlers = createScopeHandlers({ scopes });

      await handlers["map/scopes/create"]({ name: "Scope 1" }, mockContext);
      await handlers["map/scopes/create"]({ name: "Scope 2" }, mockContext);

      const result = await handlers["map/scopes/list"]({}, mockContext);
      expect(result.scopes).toHaveLength(2);
    });

    it("should get a scope", async () => {
      const handlers = createScopeHandlers({ scopes });

      const created = await handlers["map/scopes/create"](
        { name: "Test" },
        mockContext
      );

      const result = await handlers["map/scopes/get"](
        { scopeId: created.scope.id },
        mockContext
      );

      expect(result.scope.id).toBe(created.scope.id);
    });

    it("should join and leave scope", async () => {
      const handlers = createScopeHandlers({ scopes });

      const scopeResult = await handlers["map/scopes/create"](
        { name: "Test" },
        mockContext
      );

      const agent = agents.register({
        name: "Agent",
        sessionId: mockSession.id,
      });

      await handlers["map/scopes/join"](
        { scopeId: scopeResult.scope.id, agentId: agent.id },
        mockContext
      );

      expect(scopes.getMembers(scopeResult.scope.id)).toContain(agent.id);

      await handlers["map/scopes/leave"](
        { scopeId: scopeResult.scope.id, agentId: agent.id },
        mockContext
      );

      expect(scopes.getMembers(scopeResult.scope.id)).not.toContain(agent.id);
    });

    it("should get scope members", async () => {
      const handlers = createScopeHandlers({ scopes });

      const scopeResult = await handlers["map/scopes/create"](
        { name: "Test" },
        mockContext
      );

      const agent1 = agents.register({
        name: "Agent 1",
        sessionId: mockSession.id,
      });
      const agent2 = agents.register({
        name: "Agent 2",
        sessionId: mockSession.id,
      });

      scopes.join(scopeResult.scope.id, agent1.id);
      scopes.join(scopeResult.scope.id, agent2.id);

      const result = await handlers["map/scopes/members"](
        { scopeId: scopeResult.scope.id },
        mockContext
      );

      expect(result.members).toContain(agent1.id);
      expect(result.members).toContain(agent2.id);
    });
  });

  describe("createSubscriptionHandlers", () => {
    it("should create a subscription", async () => {
      const handlers = createSubscriptionHandlers({ subscriptions, eventBus });

      const result = await handlers["map/subscribe"](
        { filter: { eventTypes: ["test.event"] } },
        mockContext
      );

      // Check protocol-compliant response
      expect(result.subscriptionId).toBeDefined();
      expect(mockSession.subscriptionIds).toContain(result.subscriptionId);

      // Verify subscription was created correctly in the manager
      const sub = subscriptions.get(result.subscriptionId);
      expect(sub).toBeDefined();
      expect(sub?.sessionId).toBe(mockSession.id);
      expect(sub?.filter.eventTypes).toEqual(["test.event"]);
    });

    it("should unsubscribe", async () => {
      const handlers = createSubscriptionHandlers({ subscriptions, eventBus });

      const sub = await handlers["map/subscribe"](
        { filter: {} },
        mockContext
      );

      const result = await handlers["map/unsubscribe"](
        { subscriptionId: sub.subscriptionId },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(subscriptions.get(sub.subscriptionId)).toBeUndefined();
    });

    it("should replay events", async () => {
      const handlers = createSubscriptionHandlers({ subscriptions, eventBus });

      // Emit some events
      eventBus.emit({ type: "test.event", data: { n: 1 } });
      eventBus.emit({ type: "test.event", data: { n: 2 } });

      const sub = await handlers["map/subscribe"](
        { filter: { eventTypes: ["test.event"] } },
        mockContext
      );

      const events = await handlers["map/replay"](
        { subscriptionId: sub.subscriptionId },
        mockContext
      );

      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it("should acknowledge events", async () => {
      const handlers = createSubscriptionHandlers({ subscriptions, eventBus });

      const sub = await handlers["map/subscribe"]({ filter: {} }, mockContext);
      const event = eventBus.emit({ type: "test", data: {} });

      const result = await handlers["map/ack"](
        { subscriptionId: sub.subscriptionId, eventId: event.id },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(subscriptions.get(sub.subscriptionId)?.lastEventId).toBe(event.id);
    });

    it("should pause and resume", async () => {
      const handlers = createSubscriptionHandlers({ subscriptions, eventBus });

      const sub = await handlers["map/subscribe"]({ filter: {} }, mockContext);

      await handlers["map/pause"]({ subscriptionId: sub.subscriptionId }, mockContext);
      expect(subscriptions.get(sub.subscriptionId)?.paused).toBe(true);

      await handlers["map/resume"]({ subscriptionId: sub.subscriptionId }, mockContext);
      expect(subscriptions.get(sub.subscriptionId)?.paused).toBe(false);
    });
  });

  describe("createMessageHandlers", () => {
    it("should send message to agent", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const agent = agents.register({
        name: "Receiver",
        sessionId: mockSession.id,
      });
      mockSession.agentIds.push(agent.id);

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => {
        deliveredMessages.push({ agentId, msg });
      });

      const receiver = agents.register({
        name: "Target",
        sessionId: "other-session",
      });

      const result = await handlers["map/send"](
        { to: receiver.id, payload: { text: "hello" } },
        mockContext
      );

      // Check protocol-compliant response
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe("string");
    });

    it("should send message to scope", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const scope = scopes.create({ name: "Test Scope" });
      const sender = agents.register({
        name: "Sender",
        sessionId: mockSession.id,
      });
      const receiver = agents.register({
        name: "Receiver",
        sessionId: "other-session",
      });

      mockSession.agentIds.push(sender.id);
      scopes.join(scope.id, sender.id);
      scopes.join(scope.id, receiver.id);

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => {
        deliveredMessages.push({ agentId, msg });
      });

      const result = await handlers["map/send/scope"](
        { scopeId: scope.id, payload: { announcement: "hello all" } },
        mockContext
      );

      // Check protocol-compliant response
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe("string");
      // Should be delivered to receiver (sender excluded)
      expect(deliveredMessages.some((m) => m.agentId === receiver.id)).toBe(
        true
      );
    });
  });

  describe("createConnectionHandlers", () => {
    it("should return session info on connect", async () => {
      const handlers = createConnectionHandlers({ sessions });

      const result = await handlers["map/connect"]({}, mockContext);

      expect(result.sessionId).toBe(mockSession.id);
    });

    it("should disconnect and return resume token", async () => {
      const handlers = createConnectionHandlers({
        sessions,
        agents,
        subscriptions,
        scopes,
      });

      const result = await handlers["map/disconnect"]({}, mockContext);

      expect(result.success).toBe(true);
      expect(result.resumeToken).toBeDefined();
      expect(sessions.get(mockSession.id)?.status).toBe("disconnected");
    });

    it("should clean up resources on disconnect", async () => {
      const handlers = createConnectionHandlers({
        sessions,
        agents,
        subscriptions,
        scopes,
      });

      // Create some resources
      const agent = agents.register({
        name: "Agent",
        sessionId: mockSession.id,
      });
      mockSession.agentIds.push(agent.id);

      const sub = subscriptions.create({
        sessionId: mockSession.id,
        filter: {},
      });
      mockSession.subscriptionIds.push(sub.id);

      const scope = scopes.create({ name: "Test" });
      scopes.join(scope.id, agent.id);

      // Disconnect
      await handlers["map/disconnect"]({}, mockContext);

      // Resources should be cleaned up
      expect(agents.get(agent.id)).toBeUndefined();
      expect(subscriptions.get(sub.id)).toBeUndefined();
    });

    it("should return session info", async () => {
      const handlers = createConnectionHandlers({ sessions });

      const result = await handlers["map/session/info"]({}, mockContext);

      expect(result.id).toBe(mockSession.id);
      expect(result.role).toBe("client");
      expect(result.name).toBe("Test Client");
    });

    it("should close session permanently", async () => {
      const handlers = createConnectionHandlers({
        sessions,
        agents,
        subscriptions,
        scopes,
      });

      const result = await handlers["map/session/close"]({}, mockContext);

      expect(result.success).toBe(true);
      expect(sessions.get(mockSession.id)).toBeUndefined();
    });
  });

  describe("combineHandlers", () => {
    it("should combine multiple handler registries", () => {
      const agentHandlers = createAgentHandlers({ agents });
      const scopeHandlers = createScopeHandlers({ scopes });

      const combined = combineHandlers(agentHandlers, scopeHandlers);

      expect(combined["map/agents/register"]).toBeDefined();
      expect(combined["map/scopes/create"]).toBeDefined();
    });

    it("should warn on duplicate handlers", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const handlers1 = { "test/method": async () => "first" };
      const handlers2 = { "test/method": async () => "second" };

      const combined = combineHandlers(handlers1, handlers2);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("test/method")
      );
      expect(combined["test/method"]).toBe(handlers2["test/method"]);

      warn.mockRestore();
    });
  });
});
