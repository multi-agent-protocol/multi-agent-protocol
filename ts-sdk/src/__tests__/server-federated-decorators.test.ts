/**
 * Tests for federated decorators
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBusImpl } from "../server/events";
import { AgentRegistryImpl } from "../server/agents";
import { ScopeManagerImpl } from "../server/scopes";
import { MessageRouterImpl } from "../server/messages";
import {
  FederationGatewayImpl,
  FederatedAgentRegistry,
  FederatedScopeManager,
  FederatedMessageRouter,
  type PeerTransport,
} from "../server/federation";

describe("FederatedAgentRegistry", () => {
  let eventBus: EventBusImpl;
  let localAgents: AgentRegistryImpl;
  let gateway: FederationGatewayImpl;
  let federatedAgents: FederatedAgentRegistry;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    localAgents = new AgentRegistryImpl({ eventBus });
    gateway = new FederationGatewayImpl({
      systemId: "system-a",
      buffer: { maxMessages: 100 },
    });
    federatedAgents = new FederatedAgentRegistry({
      local: localAgents,
      gateway,
      sync: { onRegister: true, onStateChange: true, includeRemote: true },
    });
  });

  describe("register", () => {
    it("should register agent locally", () => {
      const agent = federatedAgents.register({
        name: "Agent1",
        sessionId: "session-1",
      });

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe("Agent1");
      expect(localAgents.get(agent.id)).toEqual(agent);
    });

    it("should broadcast to connected peers", async () => {
      const mockTransport: PeerTransport = {
        send: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };

      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
        transport: mockTransport,
      });

      federatedAgents.register({ name: "Agent1", sessionId: "s1" });

      // Give async broadcast time to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: "agent.registered",
            agent: expect.objectContaining({ name: "Agent1" }),
          }),
        })
      );
    });
  });

  describe("get", () => {
    it("should get local agent", () => {
      const agent = federatedAgents.register({ name: "Local", sessionId: "s1" });
      expect(federatedAgents.get(agent.id)).toEqual(agent);
    });

    it("should get remote agent", () => {
      // Simulate receiving a remote agent
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-123", name: "Remote", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      const remoteAgent = federatedAgents.get("remote:system-b:agent-123");
      expect(remoteAgent).toBeDefined();
      expect(remoteAgent?.name).toBe("Remote");
    });
  });

  describe("list", () => {
    it("should include both local and remote agents", () => {
      federatedAgents.register({ name: "Local", sessionId: "s1" });

      // Simulate receiving a remote agent
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-123", name: "Remote", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      const agents = federatedAgents.list();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.name).sort()).toEqual(["Local", "Remote"]);
    });

    it("should filter by role", () => {
      federatedAgents.register({ name: "Worker1", role: "worker", sessionId: "s1" });
      federatedAgents.register({ name: "Manager1", role: "manager", sessionId: "s1" });

      const workers = federatedAgents.list({ role: "worker" });
      expect(workers).toHaveLength(1);
      expect(workers[0].name).toBe("Worker1");
    });
  });

  describe("unregister", () => {
    it("should unregister local agent", () => {
      const agent = federatedAgents.register({ name: "Local", sessionId: "s1" });
      const result = federatedAgents.unregister(agent.id);

      expect(result).toBe(true);
      expect(federatedAgents.get(agent.id)).toBeUndefined();
    });

    it("should not unregister remote agent", () => {
      // Simulate receiving a remote agent
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-123", name: "Remote", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      const result = federatedAgents.unregister("remote:system-b:agent-123");
      expect(result).toBe(false);
    });
  });

  describe("updateState", () => {
    it("should update local agent state", () => {
      const agent = federatedAgents.register({ name: "Agent1", sessionId: "s1" });
      const updated = federatedAgents.updateState(agent.id, "busy");

      expect(updated.state).toBe("busy");
    });

    it("should throw for remote agent", () => {
      // Simulate receiving a remote agent
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-123", name: "Remote", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(() => {
        federatedAgents.updateState("remote:system-b:agent-123", "busy");
      }).toThrow("Cannot update remote agent");
    });
  });

  describe("remote agent events", () => {
    it("should handle agent.unregistered from peer", () => {
      // First register
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-123", name: "Remote", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(federatedAgents.get("remote:system-b:agent-123")).toBeDefined();

      // Then unregister
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.unregistered",
          agent: { id: "agent-123", name: "Remote", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(federatedAgents.get("remote:system-b:agent-123")).toBeUndefined();
    });

    it("should handle agent.state.changed from peer", () => {
      // Register
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-123", name: "Remote", state: "idle", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      // Update state
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.state.changed",
          agent: { id: "agent-123", name: "Remote", state: "busy", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      const agent = federatedAgents.get("remote:system-b:agent-123");
      expect(agent?.state).toBe("busy");
    });
  });

  describe("isRemote", () => {
    it("should return true for remote agent", () => {
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-123", name: "Remote", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(federatedAgents.isRemote("remote:system-b:agent-123")).toBe(true);
    });

    it("should return false for local agent", () => {
      const agent = federatedAgents.register({ name: "Local", sessionId: "s1" });
      expect(federatedAgents.isRemote(agent.id)).toBe(false);
    });
  });

  describe("clearRemoteSystem", () => {
    it("should clear all agents from a system", () => {
      // Add agents from two systems
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-1", name: "Remote1", sessionId: "s-remote" },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      gateway.handleIncomingMessage("system-c", {
        payload: {
          type: "agent.registered",
          agent: { id: "agent-2", name: "Remote2", sessionId: "s-remote" },
        },
        routing: { from: "system-c", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      federatedAgents.clearRemoteSystem("system-b");

      expect(federatedAgents.get("remote:system-b:agent-1")).toBeUndefined();
      expect(federatedAgents.get("remote:system-c:agent-2")).toBeDefined();
    });
  });
});

describe("FederatedScopeManager", () => {
  let eventBus: EventBusImpl;
  let localScopes: ScopeManagerImpl;
  let gateway: FederationGatewayImpl;
  let federatedScopes: FederatedScopeManager;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    localScopes = new ScopeManagerImpl({ eventBus });
    gateway = new FederationGatewayImpl({
      systemId: "system-a",
      buffer: { maxMessages: 100 },
    });
    federatedScopes = new FederatedScopeManager({
      local: localScopes,
      gateway,
      sync: { onCreateScope: true, onMembershipChange: true, includeRemote: true },
    });
  });

  describe("create", () => {
    it("should create scope locally", () => {
      const scope = federatedScopes.create({ name: "Room1" });

      expect(scope.id).toBeDefined();
      expect(scope.name).toBe("Room1");
      expect(localScopes.get(scope.id)).toEqual(scope);
    });
  });

  describe("get", () => {
    it("should get local scope", () => {
      const scope = federatedScopes.create({ name: "Room1" });
      expect(federatedScopes.get(scope.id)).toEqual(scope);
    });

    it("should get remote scope", () => {
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "scope.created",
          scope: { id: "scope-123", name: "RemoteRoom", metadata: {}, createdAt: Date.now() },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      const remoteScope = federatedScopes.get("remote:system-b:scope-123");
      expect(remoteScope).toBeDefined();
      expect(remoteScope?.name).toBe("RemoteRoom");
    });
  });

  describe("list", () => {
    it("should include both local and remote scopes", () => {
      federatedScopes.create({ name: "Local" });

      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "scope.created",
          scope: { id: "scope-123", name: "Remote", metadata: {}, createdAt: Date.now() },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      const scopes = federatedScopes.list();
      expect(scopes).toHaveLength(2);
      expect(scopes.map((s) => s.name).sort()).toEqual(["Local", "Remote"]);
    });
  });

  describe("delete", () => {
    it("should delete local scope", () => {
      const scope = federatedScopes.create({ name: "Room1" });
      const result = federatedScopes.delete(scope.id);

      expect(result).toBe(true);
      expect(federatedScopes.get(scope.id)).toBeUndefined();
    });

    it("should not delete remote scope", () => {
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "scope.created",
          scope: { id: "scope-123", name: "Remote", metadata: {}, createdAt: Date.now() },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      const result = federatedScopes.delete("remote:system-b:scope-123");
      expect(result).toBe(false);
    });
  });

  describe("join and leave", () => {
    it("should join and leave local scope", () => {
      const scope = federatedScopes.create({ name: "Room1" });

      federatedScopes.join(scope.id, "agent-1");
      expect(federatedScopes.getMembers(scope.id)).toContain("agent-1");

      federatedScopes.leave(scope.id, "agent-1");
      expect(federatedScopes.getMembers(scope.id)).not.toContain("agent-1");
    });

    it("should throw when joining remote scope", () => {
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "scope.created",
          scope: { id: "scope-123", name: "Remote", metadata: {}, createdAt: Date.now() },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(() => {
        federatedScopes.join("remote:system-b:scope-123", "agent-1");
      }).toThrow("Cannot join remote scope");
    });
  });

  describe("remote scope membership", () => {
    it("should track members of remote scope", () => {
      // Create remote scope
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "scope.created",
          scope: { id: "scope-123", name: "Remote", metadata: {}, createdAt: Date.now() },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      // Agent joins
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "scope.agent.joined",
          scopeId: "scope-123",
          agentId: "remote-agent-1",
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(federatedScopes.getMembers("remote:system-b:scope-123")).toContain("remote-agent-1");

      // Agent leaves
      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "scope.agent.left",
          scopeId: "scope-123",
          agentId: "remote-agent-1",
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(federatedScopes.getMembers("remote:system-b:scope-123")).not.toContain("remote-agent-1");
    });
  });
});

describe("FederatedMessageRouter", () => {
  let eventBus: EventBusImpl;
  let localAgents: AgentRegistryImpl;
  let localScopes: ScopeManagerImpl;
  let localMessages: MessageRouterImpl;
  let gateway: FederationGatewayImpl;
  let federatedAgents: FederatedAgentRegistry;
  let federatedMessages: FederatedMessageRouter;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    localAgents = new AgentRegistryImpl({ eventBus });
    localScopes = new ScopeManagerImpl({ eventBus });
    localMessages = new MessageRouterImpl({
      eventBus,
      agents: localAgents,
      scopes: localScopes,
    });
    gateway = new FederationGatewayImpl({
      systemId: "system-a",
      buffer: { maxMessages: 100 },
    });
    federatedAgents = new FederatedAgentRegistry({
      local: localAgents,
      gateway,
    });
    federatedMessages = new FederatedMessageRouter({
      local: localMessages,
      gateway,
      agents: federatedAgents,
    });
  });

  describe("sendToAgent", () => {
    it("should send to local agent via local router", () => {
      const agent = federatedAgents.register({ name: "Local", sessionId: "s1" });
      const delivered = vi.fn();
      federatedMessages.onDeliver(delivered);

      federatedMessages.sendToAgent({
        from: "sender",
        to: agent.id,
        payload: { text: "Hello" },
      });

      expect(delivered).toHaveBeenCalled();
    });

    it("should route to remote agent via gateway", async () => {
      const mockTransport: PeerTransport = {
        send: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };

      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
        transport: mockTransport,
      });

      const message = federatedMessages.sendToAgent({
        from: "local-agent",
        to: "remote:system-b:agent-123",
        payload: { text: "Hello remote!" },
      });

      // Give async routing time
      await new Promise((r) => setTimeout(r, 10));

      expect(message.to).toBe("remote:system-b:agent-123");
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            type: "message",
            message: expect.objectContaining({
              to: "agent-123", // Original ID, not prefixed
              payload: { text: "Hello remote!" },
            }),
          }),
        })
      );
    });
  });

  describe("sendToScope", () => {
    it("should send to local scope", () => {
      const agent = federatedAgents.register({ name: "Agent1", sessionId: "s1" });
      const scope = localScopes.create({ name: "Room1" });
      localScopes.join(scope.id, agent.id);

      const delivered = vi.fn();
      federatedMessages.onDeliver(delivered);

      federatedMessages.sendToScope({
        from: "sender",
        scopeId: scope.id,
        payload: { text: "Broadcast" },
      });

      expect(delivered).toHaveBeenCalled();
    });
  });

  describe("incoming messages from peers", () => {
    it("should deliver message to local agent", () => {
      const agent = federatedAgents.register({ name: "Local", sessionId: "s1" });

      const delivered = vi.fn();
      federatedMessages.onDeliver(delivered);

      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "message",
          message: {
            id: "msg-123",
            from: "remote-agent",
            to: agent.id,
            payload: { text: "Hello from remote!" },
            timestamp: Date.now(),
          },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(delivered).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "remote:system-b:remote-agent",
          to: agent.id,
          payload: { text: "Hello from remote!" },
        })
      );
    });

    it("should warn for unknown local agent", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      gateway.handleIncomingMessage("system-b", {
        payload: {
          type: "message",
          message: {
            id: "msg-123",
            from: "remote-agent",
            to: "unknown-agent",
            payload: { text: "Hello!" },
            timestamp: Date.now(),
          },
        },
        routing: { from: "system-b", to: "system-a", hops: [], maxHops: 5 },
        timestamp: Date.now(),
      });

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("isRemoteAgent", () => {
    it("should detect remote agent IDs", () => {
      expect(federatedMessages.isRemoteAgent("remote:system-b:agent-1")).toBe(true);
      expect(federatedMessages.isRemoteAgent("local-agent-1")).toBe(false);
    });
  });

  describe("parseRemoteAgentId", () => {
    it("should parse valid remote ID", () => {
      const result = federatedMessages.parseRemoteAgentId("remote:system-b:agent-123");
      expect(result).toEqual({
        systemId: "system-b",
        originalId: "agent-123",
      });
    });

    it("should return null for invalid ID", () => {
      expect(federatedMessages.parseRemoteAgentId("local-agent")).toBeNull();
      expect(federatedMessages.parseRemoteAgentId("remote:")).toBeNull();
    });
  });

  describe("flushQueue", () => {
    it("should return 0 for remote agents", () => {
      const result = federatedMessages.flushQueue("remote:system-b:agent-1");
      expect(result).toBe(0);
    });
  });
});
