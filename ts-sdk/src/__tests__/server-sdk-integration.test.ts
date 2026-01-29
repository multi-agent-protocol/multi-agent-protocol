/**
 * Integration tests for server SDK
 *
 * Verifies all building blocks work together correctly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventBusImpl } from "../server/events";
import { AgentRegistryImpl } from "../server/agents";
import { SessionManagerImpl } from "../server/sessions";
import { SubscriptionManagerImpl } from "../server/subscriptions";
import { ScopeManagerImpl } from "../server/scopes";
import { MessageRouterImpl } from "../server/messages";
import { ResourceCleanerImpl } from "../server/cleanup";
import {
  createConnectionHandlers,
  combineHandlers,
  BaseMAPRouter,
  DefaultMAPRouter,
  routerToHandlers,
} from "../server/router";
import {
  createAgentHandlers,
  createScopeHandlers,
  createMessageHandlers,
  createSubscriptionHandlers,
} from "../server";
import { PermissionCheckerImpl } from "../server/permissions";
import {
  FederationGatewayImpl,
  FederatedAgentRegistry,
  FederatedMessageRouter,
  createFederationHandlers,
} from "../server/federation";
import type { HandlerContext, RegisteredAgent, ServerScope, MAPEvent } from "../server/types";

describe("Server SDK Integration", () => {
  let eventBus: EventBusImpl;
  let agents: AgentRegistryImpl;
  let sessions: SessionManagerImpl;
  let subscriptions: SubscriptionManagerImpl;
  let scopes: ScopeManagerImpl;
  let messages: MessageRouterImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    agents = new AgentRegistryImpl({ eventBus });
    sessions = new SessionManagerImpl({ eventBus });
    scopes = new ScopeManagerImpl({ eventBus });
    subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
    messages = new MessageRouterImpl({ eventBus, agents, scopes });
  });

  describe("Basic server lifecycle", () => {
    it("should create all building blocks and wire handlers together", async () => {
      const handlers = combineHandlers(
        createConnectionHandlers({ sessions }),
        createAgentHandlers({ agents, eventBus }),
        createScopeHandlers({ scopes, eventBus }),
        createMessageHandlers({ messages }),
        createSubscriptionHandlers({ subscriptions, eventBus })
      );

      expect(handlers["map/connect"]).toBeDefined();
      expect(handlers["map/agents/register"]).toBeDefined();
      expect(handlers["map/scopes/create"]).toBeDefined();
      expect(handlers["map/send"]).toBeDefined();
      expect(handlers["map/subscribe"]).toBeDefined();
    });

    it("should emit events correctly", () => {
      const events: string[] = [];
      eventBus.on("*", (event: MAPEvent) => {
        events.push(event.type);
      });

      // Register agent
      agents.register({ name: "Test", sessionId: "s1" });
      expect(events).toContain("agent.registered");

      // Create scope
      const scope = scopes.create({ name: "Room" });
      expect(events).toContain("scope.created");

      // Join scope
      const agent = agents.register({ name: "Test2", sessionId: "s1" });
      scopes.join(scope.id, agent.id);
      expect(events).toContain("scope.agent.joined");
    });
  });

  describe("Session resume flow", () => {
    it("should preserve session state across disconnect/reconnect", async () => {
      // Create session and register agent
      const session = sessions.create({ role: "agent" });
      const agent = agents.register({ name: "ResumableAgent", sessionId: session.id });
      session.agentIds.push(agent.id);

      // Disconnect
      const resumeToken = sessions.disconnect(session.id);
      expect(resumeToken).toBeDefined();

      // Get updated session from manager
      const disconnectedSession = sessions.get(session.id);
      expect(disconnectedSession?.status).toBe("disconnected");

      // Resume
      const result = sessions.resume(resumeToken!);
      expect(result.success).toBe(true);
      expect(result.session?.id).toBe(session.id);
      expect(result.session?.status).toBe("connected");
      expect(result.session?.agentIds).toContain(agent.id);
    });

    it("should queue messages for offline agents and flush on reconnect", async () => {
      // Create agents
      const senderAgent = agents.register({ name: "Sender", sessionId: "sender-session" });
      const receiverAgent = agents.register({ name: "Receiver", sessionId: "receiver-session" });

      // Track delivered messages
      const deliveredMessages: unknown[] = [];
      messages.onDeliver((msg) => {
        deliveredMessages.push(msg);
      });

      // Send first message - will be delivered immediately since onDeliver is set
      messages.sendToAgent({
        from: senderAgent.id,
        to: receiverAgent.id,
        payload: { text: "Hello" },
      });

      expect(deliveredMessages).toHaveLength(1);
    });
  });

  describe("Scope hierarchy", () => {
    it("should create nested scopes and traverse hierarchy", () => {
      const root = scopes.create({ name: "Company" });
      const team1 = scopes.create({ name: "Engineering", parentId: root.id });
      const team2 = scopes.create({ name: "Sales", parentId: root.id });
      const subteam = scopes.create({ name: "Frontend", parentId: team1.id });

      // Verify hierarchy
      expect(scopes.getParent(team1.id)?.id).toBe(root.id);
      expect(scopes.getChildren(root.id).map((s) => s.name).sort()).toEqual([
        "Engineering",
        "Sales",
      ]);
      expect(scopes.getAncestors(subteam.id).map((s) => s.name)).toEqual([
        "Engineering",
        "Company",
      ]);
      expect(scopes.getDescendants(root.id).map((s) => s.name).sort()).toEqual([
        "Engineering",
        "Frontend",
        "Sales",
      ]);
    });

    it("should get members with includeDescendants", () => {
      const root = scopes.create({ name: "Root" });
      const child = scopes.create({ name: "Child", parentId: root.id });

      const agent1 = agents.register({ name: "Agent1", sessionId: "s1" });
      const agent2 = agents.register({ name: "Agent2", sessionId: "s1" });

      scopes.join(root.id, agent1.id);
      scopes.join(child.id, agent2.id);

      // Without descendants
      expect(scopes.getMembers(root.id)).toEqual([agent1.id]);

      // With descendants
      const allMembers = scopes.getMembers(root.id, { includeDescendants: true });
      expect(allMembers.sort()).toEqual([agent1.id, agent2.id].sort());
    });

    it("should broadcast message to scope members", () => {
      const scope = scopes.create({ name: "Broadcast Room" });
      const sender = agents.register({ name: "Sender", sessionId: "s1" });
      const receiver1 = agents.register({ name: "Receiver1", sessionId: "s2" });
      const receiver2 = agents.register({ name: "Receiver2", sessionId: "s3" });

      scopes.join(scope.id, sender.id);
      scopes.join(scope.id, receiver1.id);
      scopes.join(scope.id, receiver2.id);

      const deliveredTo: string[] = [];
      messages.onDeliver((agentId) => {
        deliveredTo.push(agentId);
      });

      messages.sendToScope({
        from: sender.id,
        scopeId: scope.id,
        payload: { text: "Hello everyone!" },
        excludeSender: true,
      });

      // Should deliver to both receivers but not sender
      expect(deliveredTo.sort()).toEqual([receiver1.id, receiver2.id].sort());
    });
  });

  describe("Permissions", () => {
    it("should enforce permission rules with method patterns", () => {
      const checker = new PermissionCheckerImpl({
        rules: [
          { method: "map/agents/list", roles: ["client", "agent"], allow: true },
          { method: "map/agents/register", roles: ["agent"], allow: true },
          { method: "map/agents/*", roles: ["agent"], allow: true },
        ],
        defaultAllow: false,
      });

      const clientSession = sessions.create({ role: "client" });
      const agentSession = sessions.create({ role: "agent" });

      // Client can list but not register
      expect(checker.canCallMethod(clientSession, "map/agents/list").allowed).toBe(true);
      expect(checker.canCallMethod(clientSession, "map/agents/register").allowed).toBe(false);

      // Agent can do both
      expect(checker.canCallMethod(agentSession, "map/agents/list").allowed).toBe(true);
      expect(checker.canCallMethod(agentSession, "map/agents/register").allowed).toBe(true);
    });
  });

  describe("Resource cleanup", () => {
    it("should clean up stale resources", async () => {
      const cleaner = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages,
        thresholds: {
          sessionDisconnectMs: 10,
          intervalMs: 0, // Manual mode
        },
      });

      // Create resources
      const session = sessions.create({ role: "agent" });
      const agent = agents.register({ name: "Stale Agent", sessionId: session.id });
      const sub = subscriptions.create({ sessionId: session.id, filter: {} });

      // Disconnect session
      sessions.disconnect(session.id);

      // Wait for stale threshold
      await new Promise((r) => setTimeout(r, 50));

      // Run cleanup
      const stats = await cleaner.run();

      expect(stats.sessionsExpired).toBe(1);
      expect(stats.agentsUnregistered).toBe(1);
      expect(stats.subscriptionsCancelled).toBe(1);

      // Verify resources removed
      expect(agents.get(agent.id)).toBeUndefined();
      expect(subscriptions.get(sub.id)).toBeUndefined();
    });
  });

  describe("OOP interface with BaseMAPRouter", () => {
    it("should allow custom router extending BaseMAPRouter", async () => {
      const registerCalls: string[] = [];

      class CustomRouter extends BaseMAPRouter {
        async registerAgent(
          params: { name: string; role?: string; metadata?: Record<string, unknown> },
          ctx: HandlerContext
        ): Promise<RegisteredAgent> {
          registerCalls.push(params.name);
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

      const session = sessions.create({ role: "agent" });
      const ctx: HandlerContext = {
        session,
        requestId: "req-1",
        signal: new AbortController().signal,
      };

      await router.registerAgent({ name: "Custom Agent" }, ctx);

      expect(registerCalls).toContain("Custom Agent");
      expect(agents.list()).toHaveLength(1);
    });

    it("should convert router to handlers", async () => {
      const router = new DefaultMAPRouter({
        agents,
        scopes,
        sessions,
        subscriptions,
        messages,
        eventBus,
      });

      const handlers = routerToHandlers(router);

      const session = sessions.create({ role: "agent" });
      const ctx: HandlerContext = {
        session,
        requestId: "req-1",
        signal: new AbortController().signal,
      };

      const agent = await handlers["map/agents/register"](
        { name: "Via Handler" },
        ctx
      );

      expect((agent as RegisteredAgent).name).toBe("Via Handler");
    });
  });

  describe("Federation integration", () => {
    it("should sync agents between federated registries", async () => {
      const gateway = new FederationGatewayImpl({
        systemId: "system-a",
      });

      const federatedAgents = new FederatedAgentRegistry({
        local: agents,
        gateway,
        sync: { onRegister: true, includeRemote: true },
      });

      // Register local agent
      const localAgent = federatedAgents.register({
        name: "Local Agent",
        sessionId: "s1",
      });

      expect(federatedAgents.list()).toHaveLength(1);
      expect(federatedAgents.isRemote(localAgent.id)).toBe(false);

      // Simulate remote agent arrival
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "remote-1", name: "Remote Agent", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      // Should now have both agents
      expect(federatedAgents.list()).toHaveLength(2);
      expect(federatedAgents.isRemote("remote:system-b:remote-1")).toBe(true);
    });

    it("should route messages to remote agents", async () => {
      const gateway = new FederationGatewayImpl({ systemId: "system-a" });
      const federatedAgents = new FederatedAgentRegistry({
        local: agents,
        gateway,
      });
      const federatedMessages = new FederatedMessageRouter({
        local: messages,
        gateway,
        agents: federatedAgents,
      });

      // Message to remote agent should be routed via gateway
      const message = federatedMessages.sendToAgent({
        from: "local-agent",
        to: "remote:system-b:remote-agent",
        payload: { text: "Cross-system message" },
      });

      expect(message.to).toBe("remote:system-b:remote-agent");

      // Check buffer stats (message should be queued since no transport)
      expect(gateway.buffer.stats().bySystem["system-b"]).toBe(1);
    });

    it("should create federation handlers with gateway role validation", async () => {
      const gateway = new FederationGatewayImpl({ systemId: "system-a" });
      const handlers = createFederationHandlers({ gateway });

      const gatewaySession = sessions.create({ role: "gateway" });
      const clientSession = sessions.create({ role: "client" });

      const gatewayCtx: HandlerContext = {
        session: gatewaySession,
        requestId: "req-1",
        signal: new AbortController().signal,
      };

      const clientCtx: HandlerContext = {
        session: clientSession,
        requestId: "req-2",
        signal: new AbortController().signal,
      };

      // Gateway can call federation methods
      await expect(
        handlers["map/federation/list"]({}, gatewayCtx)
      ).resolves.toBeDefined();

      // Client cannot
      await expect(
        handlers["map/federation/list"]({}, clientCtx)
      ).rejects.toThrow(/gateway role/i);
    });
  });

  describe("Full stack test", () => {
    it("should handle complete agent workflow via handlers", async () => {
      // Setup all components
      const handlers = combineHandlers(
        createConnectionHandlers({ sessions }),
        createAgentHandlers({ agents, eventBus }),
        createScopeHandlers({ scopes, eventBus }),
        createMessageHandlers({ messages }),
        createSubscriptionHandlers({ subscriptions, eventBus })
      );

      // Create session manually
      const session = sessions.create({ role: "agent" });
      const ctx: HandlerContext = {
        session,
        requestId: "req-1",
        signal: new AbortController().signal,
      };

      // Register agent via handler
      const agentResult = await handlers["map/agents/register"](
        { name: "Full Stack Agent", role: "worker" },
        ctx
      );
      expect(agentResult.agent).toBeDefined();

      // Create scope
      const scopeResult = await handlers["map/scopes/create"](
        { name: "Work Room" },
        ctx
      );
      expect(scopeResult.scope).toBeDefined();

      // Join scope
      await handlers["map/scopes/join"](
        { scopeId: scopeResult.scope.id, agentId: agentResult.agent.id },
        ctx
      );

      // Verify membership
      const members = scopes.getMembers(scopeResult.scope.id);
      expect(members).toContain(agentResult.agent.id);

      // Subscribe to events
      const sub = await handlers["map/subscribe"](
        { filter: { eventTypes: ["agent.registered"] } },
        ctx
      );
      expect(sub.subscriptionId).toBeDefined();
    });
  });
});
