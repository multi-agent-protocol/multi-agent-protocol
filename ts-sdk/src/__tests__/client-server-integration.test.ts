/**
 * Client-Server SDK Integration Tests
 *
 * Tests that verify client SDK and server SDK work together correctly.
 * Uses real server SDK building blocks (not TestServer mock).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createIntegrationHarness,
  waitForEvent,
  type IntegrationTestHarness,
} from "./helpers";

describe("Client-Server Integration", () => {
  let harness: IntegrationTestHarness;

  beforeEach(() => {
    harness = createIntegrationHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  // ===========================================================================
  // Connection Lifecycle
  // ===========================================================================

  describe("Connection Lifecycle", () => {
    it("client connect creates server session", async () => {
      const { connection, connectResult, disconnect } =
        await harness.createClient("TestClient");

      // Verify connect result
      expect(connectResult.sessionId).toBeDefined();
      expect(connectResult.participantId).toBeDefined();

      // Verify session exists on server
      const serverSessions = harness.sessions.list();
      expect(serverSessions.length).toBeGreaterThanOrEqual(1);

      // Verify connection state
      expect(connection.isConnected).toBe(true);

      await disconnect();
    });

    it("agent connect creates server session", async () => {
      const { connection, connectResult, disconnect } =
        await harness.createAgent("TestAgent");

      // Verify connect result
      expect(connectResult.sessionId).toBeDefined();
      expect(connectResult.participantId).toBeDefined();

      // Verify session exists on server
      const serverSessions = harness.sessions.list({ role: "agent" });
      expect(serverSessions.length).toBeGreaterThanOrEqual(1);

      // Verify connection state
      expect(connection.isConnected).toBe(true);

      await disconnect();
    });

    it("disconnect removes client from active state", async () => {
      const { connection, disconnect } = await harness.createClient();

      expect(connection.isConnected).toBe(true);

      await disconnect();

      expect(connection.isConnected).toBe(false);
    });

    it("multiple clients can connect simultaneously", async () => {
      const client1 = await harness.createClient("Client1");
      const client2 = await harness.createClient("Client2");
      const client3 = await harness.createClient("Client3");

      expect(client1.connection.isConnected).toBe(true);
      expect(client2.connection.isConnected).toBe(true);
      expect(client3.connection.isConnected).toBe(true);

      // All should have different session IDs
      const sessionIds = [
        client1.connectResult.sessionId,
        client2.connectResult.sessionId,
        client3.connectResult.sessionId,
      ];
      expect(new Set(sessionIds).size).toBe(3);

      await client1.disconnect();
      await client2.disconnect();
      await client3.disconnect();
    });
  });

  // ===========================================================================
  // Agent Operations
  // ===========================================================================

  describe("Agent Operations", () => {
    it("register creates agent on server", async () => {
      const { agent, disconnect } = await harness.createAgent("TestAgent");

      // Verify agent exists on server
      const serverAgent = harness.agents.get(agent.id);
      expect(serverAgent).toBeDefined();
      expect(serverAgent?.name).toBe("TestAgent");

      await disconnect();
    });

    it("registered agent appears in listAgents", async () => {
      const { agent: agent1 } = await harness.createAgent("Agent1");
      const { agent: agent2 } = await harness.createAgent("Agent2");

      // Create a client to list agents
      const { connection: client, disconnect } = await harness.createClient();

      const result = await client.listAgents();

      expect(result.agents.length).toBeGreaterThanOrEqual(2);
      expect(result.agents.map((a) => a.name)).toContain("Agent1");
      expect(result.agents.map((a) => a.name)).toContain("Agent2");

      await disconnect();
    });

    it("getAgent returns correct agent data", async () => {
      const { agent, disconnect: disconnectAgent } =
        await harness.createAgent("SpecificAgent");
      const { connection: client, disconnect: disconnectClient } =
        await harness.createClient();

      const result = await client.getAgent(agent.id);

      expect(result.agent.id).toBe(agent.id);
      expect(result.agent.name).toBe("SpecificAgent");

      await disconnectClient();
      await disconnectAgent();
    });

    it("updateState changes server state", async () => {
      const { connection, agent, disconnect } =
        await harness.createAgent("StatefulAgent");

      // Update state
      await connection.updateState("busy");

      // Verify on server
      const serverAgent = harness.agents.get(agent.id);
      expect(serverAgent?.state).toBe("busy");

      await disconnect();
    });

    it("updateMetadata merges with existing", async () => {
      const { connection, agent, disconnect } =
        await harness.createAgent("MetadataAgent");

      // Update metadata
      await connection.updateMetadata({ key1: "value1" });
      await connection.updateMetadata({ key2: "value2" });

      // Verify on server - should have both keys
      const serverAgent = harness.agents.get(agent.id);
      expect(serverAgent?.metadata).toMatchObject({
        key1: "value1",
        key2: "value2",
      });

      await disconnect();
    });

    it("disconnect unregisters agent from server", async () => {
      const { connection, agent, disconnect } =
        await harness.createAgent("TempAgent");

      // Verify agent exists
      expect(harness.agents.get(agent.id)).toBeDefined();

      // Disconnect (automatically unregisters the agent)
      await disconnect();

      // Verify agent removed
      expect(harness.agents.get(agent.id)).toBeUndefined();
    });

    it("multiple independent agents", async () => {
      // Each AgentConnection represents one agent
      // Multiple agents require multiple connections
      const { agent: agent1, disconnect: disconnect1 } =
        await harness.createAgent("FirstAgent");
      const { agent: agent2, disconnect: disconnect2 } =
        await harness.createAgent("SecondAgent");

      // Both should exist on server
      expect(harness.agents.get(agent1.id)).toBeDefined();
      expect(harness.agents.get(agent2.id)).toBeDefined();

      // List should show both
      const serverAgents = harness.agents.list();
      expect(serverAgents.length).toBe(2);

      await disconnect1();
      await disconnect2();
    });
  });

  // ===========================================================================
  // Scope Operations
  // ===========================================================================

  describe("Scope Operations", () => {
    it("createScope creates on server", async () => {
      const { connection, disconnect } = await harness.createAgent("ScopeAgent");

      const scope = await connection.createScope({ name: "TestScope" });

      // Verify on server
      const serverScope = harness.scopes.get(scope.id);
      expect(serverScope).toBeDefined();
      expect(serverScope?.name).toBe("TestScope");

      await disconnect();
    });

    it("created scope appears in listScopes", async () => {
      const { connection: agent, disconnect: disconnectAgent } =
        await harness.createAgent("Agent");
      const { connection: client, disconnect: disconnectClient } =
        await harness.createClient();

      await agent.createScope({ name: "Scope1" });
      await agent.createScope({ name: "Scope2" });

      const result = await client.listScopes();

      expect(result.scopes.length).toBeGreaterThanOrEqual(2);
      expect(result.scopes.map((s) => s.name)).toContain("Scope1");
      expect(result.scopes.map((s) => s.name)).toContain("Scope2");

      await disconnectClient();
      await disconnectAgent();
    });

    it("joinScope adds agent to scope members", async () => {
      const { connection, agent, disconnect } =
        await harness.createAgent("JoinAgent");

      const scope = await connection.createScope({ name: "JoinableScope" });
      await connection.joinScope(scope.id);

      // Verify membership on server
      const members = harness.scopes.getMembers(scope.id);
      expect(members).toContain(agent.id);

      await disconnect();
    });

    it("leaveScope removes agent from scope members", async () => {
      const { connection, agent, disconnect } =
        await harness.createAgent("LeaveAgent");

      const scope = await connection.createScope({ name: "LeavableScope" });
      await connection.joinScope(scope.id);

      // Verify joined
      expect(harness.scopes.getMembers(scope.id)).toContain(agent.id);

      // Leave
      await connection.leaveScope(scope.id);

      // Verify left
      expect(harness.scopes.getMembers(scope.id)).not.toContain(agent.id);

      await disconnect();
    });

    it("nested scopes with parentId", async () => {
      const { connection, disconnect } = await harness.createAgent("HierarchyAgent");

      const parent = await connection.createScope({ name: "Parent" });
      const child = await connection.createScope({
        name: "Child",
        parentId: parent.id,
      });

      // Verify hierarchy on server
      const serverChild = harness.scopes.get(child.id);
      expect(serverChild?.parentId).toBe(parent.id);

      const serverParent = harness.scopes.getParent(child.id);
      expect(serverParent?.name).toBe("Parent");

      await disconnect();
    });
  });

  // ===========================================================================
  // Messaging
  // ===========================================================================

  describe("Messaging", () => {
    it("agent to agent delivery", async () => {
      const { connection: sender, agent: senderAgent } =
        await harness.createAgent("Sender");
      const { connection: receiver, agent: receiverAgent } =
        await harness.createAgent("Receiver");

      // Set up message handler on receiver
      const receivedMessages: unknown[] = [];
      receiver.onMessage((msg) => {
        receivedMessages.push(msg);
      });

      // Send message
      await sender.send(receiverAgent.id, { text: "Hello!" });

      // Wait a bit for delivery
      await new Promise((r) => setTimeout(r, 50));

      // Check delivered messages tracked by harness
      const delivered = harness.getDeliveredMessages();
      expect(delivered.some((d) => d.agentId === receiverAgent.id)).toBe(true);

      await sender.disconnect();
      await receiver.disconnect();
    });

    it("message payload preserved exactly", async () => {
      const { connection: sender, agent: senderAgent } =
        await harness.createAgent("PayloadSender");
      const { agent: receiverAgent } = await harness.createAgent("PayloadReceiver");

      const payload = {
        text: "Hello",
        number: 42,
        nested: { array: [1, 2, 3] },
      };

      await sender.send(receiverAgent.id, payload);

      await new Promise((r) => setTimeout(r, 50));

      const delivered = harness.getDeliveredMessages();
      const msg = delivered.find((d) => d.agentId === receiverAgent.id);
      expect(msg?.message.payload).toEqual(payload);
    });

    it("scope broadcast reaches all members", async () => {
      const { connection: sender, agent: senderAgent } =
        await harness.createAgent("BroadcastSender");
      const { agent: receiver1 } = await harness.createAgent("Receiver1");
      const { agent: receiver2 } = await harness.createAgent("Receiver2");

      // Create scope and join all agents
      const scope = await sender.createScope({ name: "BroadcastScope" });
      await sender.joinScope(scope.id);

      // Join receivers to scope on server side
      harness.scopes.join(scope.id, receiver1.id);
      harness.scopes.join(scope.id, receiver2.id);

      harness.clearDeliveredMessages();

      // Broadcast to scope
      await sender.send(scope.id, { text: "Broadcast!" });

      await new Promise((r) => setTimeout(r, 50));

      // Should be delivered to both receivers (not sender if excludeSender)
      const delivered = harness.getDeliveredMessages();
      const recipientIds = delivered.map((d) => d.agentId);

      expect(recipientIds).toContain(receiver1.id);
      expect(recipientIds).toContain(receiver2.id);
    });
  });

  // ===========================================================================
  // Subscriptions and Events
  // ===========================================================================

  describe("Subscriptions and Events", () => {
    it("subscribe returns subscription id", async () => {
      const { connection: client, disconnect } = await harness.createClient();

      const subscription = await client.subscribe({
        eventTypes: ["agent.registered"],
      });

      expect(subscription).toBeDefined();
      // Subscription should have an async iterator
      expect(typeof subscription[Symbol.asyncIterator]).toBe("function");

      await disconnect();
    });

    it("receives agent.registered event", async () => {
      const { connection: client, disconnect: disconnectClient } =
        await harness.createClient();

      // Subscribe to agent events
      const events: unknown[] = [];
      const subscription = await client.subscribe({
        eventTypes: ["agent.registered"],
      });

      // Start collecting events
      const collecting = (async () => {
        for await (const event of subscription) {
          events.push(event);
          if (events.length >= 1) break;
        }
      })();

      // Register an agent (should trigger event)
      const { disconnect: disconnectAgent } =
        await harness.createAgent("EventAgent");

      // Wait for event
      await Promise.race([
        collecting,
        new Promise((r) => setTimeout(r, 500)),
      ]);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]).toMatchObject({
        type: "agent.registered",
      });

      await disconnectAgent();
      await disconnectClient();
    });

    it("eventTypes filter limits events", async () => {
      const { connection: client, disconnect: disconnectClient } =
        await harness.createClient();

      // Subscribe only to scope events
      const events: unknown[] = [];
      const subscription = await client.subscribe({
        eventTypes: ["scope.created"],
      });

      // Collect events briefly
      const collecting = (async () => {
        for await (const event of subscription) {
          events.push(event);
          break;
        }
      })();

      // Create an agent (should NOT trigger event for this subscription)
      const { connection: agent, disconnect: disconnectAgent } =
        await harness.createAgent("FilterAgent");

      // Create a scope (SHOULD trigger event)
      await agent.createScope({ name: "FilterScope" });

      await Promise.race([
        collecting,
        new Promise((r) => setTimeout(r, 500)),
      ]);

      // Should only have scope event, not agent event
      if (events.length > 0) {
        expect(events[0]).toMatchObject({ type: "scope.created" });
      }

      await disconnectAgent();
      await disconnectClient();
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("Error Handling", () => {
    it("nonexistent agent returns error", async () => {
      const { connection: client, disconnect } = await harness.createClient();

      await expect(client.getAgent("nonexistent-agent-id")).rejects.toThrow();

      await disconnect();
    });

    it("errors are catchable promises", async () => {
      const { connection: client, disconnect } = await harness.createClient();

      let caughtError: Error | null = null;
      try {
        await client.getAgent("does-not-exist");
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toBeDefined();

      await disconnect();
    });
  });

  // ===========================================================================
  // Concurrent Operations
  // ===========================================================================

  describe("Concurrent Operations", () => {
    it("multiple agents register simultaneously", async () => {
      // Register multiple agents in parallel
      const registrations = await Promise.all([
        harness.createAgent("Concurrent1"),
        harness.createAgent("Concurrent2"),
        harness.createAgent("Concurrent3"),
      ]);

      // All should have unique IDs
      const agentIds = registrations.map((r) => r.agent.id);
      expect(new Set(agentIds).size).toBe(3);

      // All should exist on server
      for (const { agent } of registrations) {
        expect(harness.agents.get(agent.id)).toBeDefined();
      }
    });

    it("cross-agent messaging works", async () => {
      const { connection: agent1, agent: a1 } =
        await harness.createAgent("CrossAgent1");
      const { connection: agent2, agent: a2 } =
        await harness.createAgent("CrossAgent2");

      harness.clearDeliveredMessages();

      // Both send to each other
      await Promise.all([
        agent1.send(a2.id, { from: "agent1" }),
        agent2.send(a1.id, { from: "agent2" }),
      ]);

      await new Promise((r) => setTimeout(r, 50));

      const delivered = harness.getDeliveredMessages();

      // Should have messages for both agents
      expect(delivered.some((d) => d.agentId === a1.id)).toBe(true);
      expect(delivered.some((d) => d.agentId === a2.id)).toBe(true);
    });

    it("cleanup closes all connections", async () => {
      const client1 = await harness.createClient("Cleanup1");
      const client2 = await harness.createClient("Cleanup2");
      const agent1 = await harness.createAgent("CleanupAgent");

      expect(client1.connection.isConnected).toBe(true);
      expect(client2.connection.isConnected).toBe(true);
      expect(agent1.connection.isConnected).toBe(true);

      await harness.cleanup();

      // All should be disconnected
      expect(client1.connection.isConnected).toBe(false);
      expect(client2.connection.isConnected).toBe(false);
      expect(agent1.connection.isConnected).toBe(false);
    });
  });
});
