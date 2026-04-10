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

    it("should send message to agent using prefixed address", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const sender = agents.register({
        name: "Sender",
        sessionId: mockSession.id,
      });
      mockSession.agentIds.push(sender.id);

      const receiver = agents.register({
        name: "Receiver",
        sessionId: "other-session",
      });

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => {
        deliveredMessages.push({ agentId, msg });
      });

      // Use prefixed address format: agent:{id}
      const result = await handlers["map/send"](
        { to: `agent:${receiver.id}`, payload: { text: "hello" } },
        mockContext
      );

      expect(result.messageId).toBeDefined();
      expect(deliveredMessages.some((m) => m.agentId === receiver.id)).toBe(true);
    });

    it("should send message to scope using prefixed address", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const scope = scopes.create({ name: "Prefixed Scope" });
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

      // Use prefixed address format: scope:{id}
      const result = await handlers["map/send"](
        { to: `scope:${scope.id}`, payload: { announcement: "hello all" } },
        mockContext
      );

      expect(result.messageId).toBeDefined();
      // Should be delivered to receiver (sender excluded)
      expect(deliveredMessages.some((m) => m.agentId === receiver.id)).toBe(true);
    });

    it("should handle mixed prefixed and unprefixed addresses in array", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const sender = agents.register({
        name: "Sender",
        sessionId: mockSession.id,
      });
      mockSession.agentIds.push(sender.id);

      const receiver1 = agents.register({
        name: "Receiver1",
        sessionId: "other-session-1",
      });
      const receiver2 = agents.register({
        name: "Receiver2",
        sessionId: "other-session-2",
      });

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => {
        deliveredMessages.push({ agentId, msg });
      });

      // Mix prefixed and unprefixed addresses
      const result = await handlers["map/send"](
        { to: [`agent:${receiver1.id}`, receiver2.id], payload: { text: "hello" } },
        mockContext
      );

      expect(result.messageId).toBeDefined();
      expect(result.delivered).toHaveLength(2);
      expect(deliveredMessages.some((m) => m.agentId === receiver1.id)).toBe(true);
      expect(deliveredMessages.some((m) => m.agentId === receiver2.id)).toBe(true);
    });

    // ── Structured Address object tests ─────────────────────────────────

    it("should send message using DirectAddress object { agent: id }", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const sender = agents.register({ name: "Sender", sessionId: mockSession.id });
      mockSession.agentIds.push(sender.id);
      const receiver = agents.register({ name: "Receiver", sessionId: "other" });

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => { deliveredMessages.push({ agentId, msg }); });

      const result = await handlers["map/send"](
        { to: { agent: receiver.id }, payload: { text: "hello via DirectAddress" } },
        mockContext,
      );

      expect(result.messageId).toBeDefined();
      expect(deliveredMessages.some(m => m.agentId === receiver.id)).toBe(true);
      expect(deliveredMessages[0].msg.payload).toEqual({ text: "hello via DirectAddress" });
    });

    it("should send message using ScopeAddress object { scope: id }", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const scope = scopes.create({ name: "ObjectScope" });
      const sender = agents.register({ name: "Sender", sessionId: mockSession.id });
      const receiver = agents.register({ name: "Receiver", sessionId: "other" });
      mockSession.agentIds.push(sender.id);
      scopes.join(scope.id, sender.id);
      scopes.join(scope.id, receiver.id);

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => { deliveredMessages.push({ agentId, msg }); });

      const result = await handlers["map/send"](
        { to: { scope: scope.id }, payload: { text: "hello scope" } },
        mockContext,
      );

      expect(result.messageId).toBeDefined();
      expect(deliveredMessages.some(m => m.agentId === receiver.id)).toBe(true);
    });

    it("should send message using MultiAddress object { agents: [id1, id2] }", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const sender = agents.register({ name: "Sender", sessionId: mockSession.id });
      mockSession.agentIds.push(sender.id);
      const receiver1 = agents.register({ name: "R1", sessionId: "s1" });
      const receiver2 = agents.register({ name: "R2", sessionId: "s2" });

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => { deliveredMessages.push({ agentId, msg }); });

      const result = await handlers["map/send"](
        { to: { agents: [receiver1.id, receiver2.id] }, payload: { text: "multi" } },
        mockContext,
      );

      expect(result.messageId).toBeDefined();
      expect(deliveredMessages.some(m => m.agentId === receiver1.id)).toBe(true);
      expect(deliveredMessages.some(m => m.agentId === receiver2.id)).toBe(true);
    });

    it("should send message using array of DirectAddress objects", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const sender = agents.register({ name: "Sender", sessionId: mockSession.id });
      mockSession.agentIds.push(sender.id);
      const r1 = agents.register({ name: "R1", sessionId: "s1" });
      const r2 = agents.register({ name: "R2", sessionId: "s2" });

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => { deliveredMessages.push({ agentId, msg }); });

      const result = await handlers["map/send"](
        { to: [{ agent: r1.id }, { agent: r2.id }], payload: { text: "array" } },
        mockContext,
      );

      expect(result.messageId).toBeDefined();
      expect(result.delivered).toHaveLength(2);
      expect(deliveredMessages.some(m => m.agentId === r1.id)).toBe(true);
      expect(deliveredMessages.some(m => m.agentId === r2.id)).toBe(true);
    });

    it("should send message using mixed string and Address objects in array", async () => {
      const handlers = createMessageHandlers({ messages, scopes });

      const sender = agents.register({ name: "Sender", sessionId: mockSession.id });
      mockSession.agentIds.push(sender.id);
      const r1 = agents.register({ name: "R1", sessionId: "s1" });
      const r2 = agents.register({ name: "R2", sessionId: "s2" });

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => { deliveredMessages.push({ agentId, msg }); });

      const result = await handlers["map/send"](
        { to: [{ agent: r1.id }, r2.id], payload: { text: "mixed" } },
        mockContext,
      );

      expect(result.messageId).toBeDefined();
      expect(result.delivered).toHaveLength(2);
    });

    it("should handle DirectAddress with ACP envelope payload", async () => {
      // This is the critical path: ACPStreamConnection sends ACP envelopes
      // to a target agent using DirectAddress objects
      const handlers = createMessageHandlers({ messages, scopes });

      const sender = agents.register({ name: "Sender", sessionId: mockSession.id });
      mockSession.agentIds.push(sender.id);
      const receiver = agents.register({ name: "ACPAgent", sessionId: "acp-session" });

      const deliveredMessages: any[] = [];
      messages.onDeliver((agentId, msg) => { deliveredMessages.push({ agentId, msg }); });

      const acpEnvelope = {
        acp: { jsonrpc: "2.0", id: "req-1", method: "session/new", params: {} },
        acpContext: { streamId: "stream-1", sessionId: null, direction: "client-to-agent" },
      };

      const result = await handlers["map/send"](
        {
          to: { agent: receiver.id },
          payload: acpEnvelope,
          meta: { protocol: "acp", correlationId: "req-1" },
        },
        mockContext,
      );

      expect(result.messageId).toBeDefined();
      expect(deliveredMessages).toHaveLength(1);
      expect(deliveredMessages[0].agentId).toBe(receiver.id);
      expect(deliveredMessages[0].msg.payload).toEqual(acpEnvelope);
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

    it("should preserve resources on disconnect for session resume", async () => {
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

      // Disconnect (resumable)
      await handlers["map/disconnect"]({}, mockContext);

      // Resources should be PRESERVED for session resume
      expect(agents.get(agent.id)).toBeDefined();
      expect(subscriptions.get(sub.id)).toBeDefined();
      expect(scopes.getMembers(scope.id)).toContain(agent.id);
    });

    it("should return session info", async () => {
      const handlers = createConnectionHandlers({ sessions });

      const result = await handlers["map/session/info"]({}, mockContext);

      expect(result.id).toBe(mockSession.id);
      expect(result.role).toBe("client");
      expect(result.name).toBe("Test Client");
    });

    it("should close session permanently and clean up all resources", async () => {
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

      // Permanently close session
      const result = await handlers["map/session/close"]({}, mockContext);

      expect(result.success).toBe(true);
      expect(sessions.get(mockSession.id)).toBeUndefined();

      // Resources should be cleaned up on permanent close
      expect(agents.get(agent.id)).toBeUndefined();
      expect(subscriptions.get(sub.id)).toBeUndefined();
    });

    describe("reclaimAgents", () => {
      it("should reclaim all agents when reclaimAgents is not specified", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          agents,
        });

        // Create agents
        const agent1 = agents.register({ name: "Agent 1", sessionId: mockSession.id });
        const agent2 = agents.register({ name: "Agent 2", sessionId: mockSession.id });
        mockSession.agentIds.push(agent1.id, agent2.id);

        const result = await handlers["map/connect"]({}, mockContext);

        expect(result.reclaimedAgents).toHaveLength(2);
        expect(result.reclaimedAgents).toContain(agent1.id);
        expect(result.reclaimedAgents).toContain(agent2.id);
      });

      it("should reclaim only specified agents", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          agents,
        });

        // Create agents
        const agent1 = agents.register({ name: "Agent 1", sessionId: mockSession.id });
        const agent2 = agents.register({ name: "Agent 2", sessionId: mockSession.id });
        mockSession.agentIds.push(agent1.id, agent2.id);

        const result = await handlers["map/connect"](
          { reclaimAgents: [agent1.id] },
          mockContext
        );

        expect(result.reclaimedAgents).toHaveLength(1);
        expect(result.reclaimedAgents).toContain(agent1.id);
      });

      it("should throw error if agent does not exist", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          agents,
        });

        await expect(
          handlers["map/connect"](
            { reclaimAgents: ["nonexistent-agent"] },
            mockContext
          )
        ).rejects.toThrow("Agent not found: nonexistent-agent");
      });

      it("should throw error if agent belongs to different session", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          agents,
        });

        // Create agent in different session
        const otherSession = sessions.create({ role: "client" });
        const otherAgent = agents.register({
          name: "Other Agent",
          sessionId: otherSession.id,
        });

        await expect(
          handlers["map/connect"](
            { reclaimAgents: [otherAgent.id] },
            mockContext
          )
        ).rejects.toThrow(`Agent ${otherAgent.id} belongs to different session`);
      });

      it("should report multiple errors for multiple invalid agents", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          agents,
        });

        // Create agent in different session
        const otherSession = sessions.create({ role: "client" });
        const otherAgent = agents.register({
          name: "Other Agent",
          sessionId: otherSession.id,
        });

        await expect(
          handlers["map/connect"](
            { reclaimAgents: ["nonexistent", otherAgent.id] },
            mockContext
          )
        ).rejects.toThrow(/Agent not found.*belongs to different session/);
      });

      it("should return empty reclaimedAgents for new session", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          agents,
        });

        const result = await handlers["map/connect"]({}, mockContext);

        expect(result.reclaimedAgents).toHaveLength(0);
        expect(result.reconnected).toBe(false);
      });
    });

    describe("mail capabilities", () => {
      it("should not include mail capabilities when not configured", async () => {
        const handlers = createConnectionHandlers({ sessions });

        const result = await handlers["map/connect"]({}, mockContext);

        expect(result.capabilities.mail).toBeUndefined();
      });

      it("should not include mail capabilities when disabled", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          mailCapabilities: { enabled: false },
        });

        const result = await handlers["map/connect"]({}, mockContext);

        expect(result.capabilities.mail).toBeUndefined();
      });

      it("should include mail capabilities when enabled", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          mailCapabilities: { enabled: true },
        });

        const result = await handlers["map/connect"]({}, mockContext);

        expect(result.capabilities.mail).toBeDefined();
        expect(result.capabilities.mail.enabled).toBe(true);
      });

      it("should default all sub-capabilities to true", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          mailCapabilities: { enabled: true },
        });

        const result = await handlers["map/connect"]({}, mockContext);

        const mail = result.capabilities.mail;
        expect(mail.canCreate).toBe(true);
        expect(mail.canJoin).toBe(true);
        expect(mail.canInvite).toBe(true);
        expect(mail.canViewHistory).toBe(true);
        expect(mail.canCreateThreads).toBe(true);
      });

      it("should respect custom sub-capability overrides", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          mailCapabilities: {
            enabled: true,
            canCreate: false,
            canInvite: false,
            canCreateThreads: false,
          },
        });

        const result = await handlers["map/connect"]({}, mockContext);

        const mail = result.capabilities.mail;
        expect(mail.canCreate).toBe(false);
        expect(mail.canJoin).toBe(true);
        expect(mail.canInvite).toBe(false);
        expect(mail.canViewHistory).toBe(true);
        expect(mail.canCreateThreads).toBe(false);
      });

      it("should include capabilities alongside existing fields", async () => {
        const handlers = createConnectionHandlers({
          sessions,
          mailCapabilities: { enabled: true },
          serverName: "TestServer",
          serverVersion: "2.0.0",
        });

        const result = await handlers["map/connect"]({}, mockContext);

        // Existing fields still present
        expect(result.systemInfo.name).toBe("TestServer");
        expect(result.systemInfo.version).toBe("2.0.0");
        expect(result.capabilities.roles).toEqual([mockSession.role]);

        // Mail capabilities also present
        expect(result.capabilities.mail.enabled).toBe(true);
      });
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
