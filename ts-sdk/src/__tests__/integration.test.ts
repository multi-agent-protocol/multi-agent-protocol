/**
 * Integration tests for MAP SDK
 *
 * Comprehensive tests exercising the full SDK functionality including:
 * - Connection lifecycle
 * - Agent registration and state management
 * - Messaging and routing
 * - Scopes and collaboration
 * - Subscriptions and events
 * - Hierarchy and ownership
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestServer, TestClient, TestAgent } from '../testing';
import { ClientConnection } from '../connection/client';
import { AgentConnection } from '../connection/agent';
import { BaseConnection } from '../connection/base';
import { createStreamPair } from '../stream';
import { EVENT_TYPES, isOrphanedAgent, CORE_METHODS, LIFECYCLE_METHODS } from '../types';
import type { Event, Message, Agent } from '../types';

describe('Integration Tests', () => {
  let server: TestServer;

  beforeEach(() => {
    server = new TestServer({
      name: 'Test Server',
      version: '1.0.0',
    });
  });

  // ===========================================================================
  // Connection Lifecycle
  // ===========================================================================

  describe('Connection Lifecycle', () => {
    describe('client connections', () => {
      let client: ClientConnection;
      let clientStream: ReturnType<typeof createStreamPair>[0];
      let serverStream: ReturnType<typeof createStreamPair>[1];

      beforeEach(() => {
        [clientStream, serverStream] = createStreamPair();
        client = new ClientConnection(clientStream, { name: 'Test Client' });
        server.acceptConnection(serverStream);
      });

      afterEach(async () => {
        await client.disconnect();
      });

      it('connects to server and receives session info', async () => {
        const result = await client.connect();

        expect(result.sessionId).toBe(server.sessionId);
        expect(result.participantId).toBeDefined();
        expect(result.systemInfo?.name).toBe('Test Server');
        expect(client.isConnected).toBe(true);
      });

      it('disconnects cleanly', async () => {
        await client.connect();
        expect(client.isConnected).toBe(true);

        await client.disconnect();
        expect(client.isConnected).toBe(false);
      });

      it('tracks participant count', async () => {
        expect(server.participantCount).toBe(0);

        await client.connect();
        expect(server.participantCount).toBe(1);

        await client.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(server.participantCount).toBe(0);
      });

      it('triggers abort signal on disconnect', async () => {
        await client.connect();

        const abortHandler = vi.fn();
        client.signal.addEventListener('abort', abortHandler);

        await client.disconnect();

        expect(abortHandler).toHaveBeenCalled();
      });

      it('resolves closed promise on disconnect', async () => {
        await client.connect();

        const closedPromise = client.closed;
        await client.disconnect();

        await expect(closedPromise).resolves.toBeUndefined();
      });
    });

    describe('agent connections', () => {
      let agent: AgentConnection;
      let clientStream: ReturnType<typeof createStreamPair>[0];
      let serverStream: ReturnType<typeof createStreamPair>[1];

      beforeEach(() => {
        [clientStream, serverStream] = createStreamPair();
        agent = new AgentConnection(clientStream, {
          name: 'Test Agent',
          role: 'worker',
        });
        server.acceptConnection(serverStream);
      });

      afterEach(async () => {
        if (agent.isConnected) {
          await agent.disconnect();
        }
      });

      it('connects and registers in one step', async () => {
        const result = await agent.connect();

        expect(result.connection.sessionId).toBe(server.sessionId);
        expect(result.agent.id).toBeDefined();
        expect(result.agent.name).toBe('Test Agent');
        expect(result.agent.role).toBe('worker');
        expect(result.agent.state).toBe('registered');
        expect(agent.isConnected).toBe(true);
        expect(agent.agentId).toBe(result.agent.id);
      });

      it('appears in server agent list after registration', async () => {
        await agent.connect();

        expect(server.agents.size).toBe(1);
        expect(server.agents.has(agent.agentId!)).toBe(true);
      });

      it('unregisters on disconnect', async () => {
        await agent.connect();
        const agentId = agent.agentId!;

        expect(server.agents.has(agentId)).toBe(true);

        await agent.disconnect();

        expect(server.agents.has(agentId)).toBe(false);
      });
    });

    describe('participant events', () => {
      it('emits participant_connected on connection', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const subscription = await client.subscribe({ eventTypes: ['participant_connected'] });

        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        const agent = await TestAgent.create(server, { name: 'New Agent' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(events.some((e) => e.type === 'participant_connected')).toBe(true);
        const connectEvent = events.find((e) => e.type === 'participant_connected');
        expect(connectEvent?.data?.participantType).toBe('agent');

        await agent.disconnect();
        await subscription.unsubscribe();
        await client.disconnect();
      });

      it('emits participant_disconnected on disconnection', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const subscription = await client.subscribe({ eventTypes: ['participant_disconnected'] });

        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        const agent = await TestAgent.create(server, { name: 'Temporary Agent' });
        await agent.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(events.some((e) => e.type === 'participant_disconnected')).toBe(true);

        await subscription.unsubscribe();
        await client.disconnect();
      });
    });
  });

  // ===========================================================================
  // Agent State Management
  // ===========================================================================

  describe('Agent State Management', () => {
    let agent: TestAgent;

    beforeEach(async () => {
      agent = await TestAgent.create(server, { name: 'Stateful Agent', role: 'worker' });
    });

    afterEach(async () => {
      await agent.disconnect();
    });

    it('updates state', async () => {
      const updated = await agent.setState('busy');

      expect(updated.state).toBe('busy');
      expect(agent.state).toBe('busy');
      expect(server.agents.get(agent.id!)?.state).toBe('busy');
    });

    it('uses convenience state methods', async () => {
      await agent.busy();
      expect(agent.state).toBe('busy');

      await agent.idle();
      expect(agent.state).toBe('idle');
    });

    it('updates metadata', async () => {
      const updated = await agent.setMetadata({ taskId: '123', progress: 0.5 });

      expect(updated.metadata).toEqual({ taskId: '123', progress: 0.5 });
    });

    it('emits state change events', async () => {
      const client = await TestClient.create(server, { name: 'Observer' });
      const subscription = await client.subscribe({ eventTypes: ['agent_state_changed'] });
      const events: Event[] = [];
      subscription.on('event', (e) => events.push(e));

      await agent.busy();
      await agent.idle();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.length).toBe(2);
      expect(events[0].data?.previousState).toBe('registered');
      expect(events[0].data?.newState).toBe('busy');
      expect(events[1].data?.previousState).toBe('busy');
      expect(events[1].data?.newState).toBe('idle');

      await subscription.unsubscribe();
      await client.disconnect();
    });
  });

  // ===========================================================================
  // Agent Ownership
  // ===========================================================================

  describe('Agent Ownership', () => {
    it('sets ownerId to registering participant', async () => {
      const agent = await TestAgent.create(server, { name: 'Owned Agent' });

      const serverAgent = server.agents.get(agent.id!);
      expect(serverAgent?.ownerId).toBeDefined();
      expect(typeof serverAgent?.ownerId).toBe('string');

      await agent.disconnect();
    });

    it('assigns different ownerIds to different agents', async () => {
      const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
      const agent2 = await TestAgent.create(server, { name: 'Agent 2' });

      const serverAgent1 = server.agents.get(agent1.id!);
      const serverAgent2 = server.agents.get(agent2.id!);

      expect(serverAgent1?.ownerId).not.toBe(serverAgent2?.ownerId);

      await agent1.disconnect();
      await agent2.disconnect();
    });

    it('unregisters owned agents on disconnect (default policy)', async () => {
      const agent = await TestAgent.create(server, { name: 'Auto-unregister Agent' });
      const agentId = agent.id!;

      expect(server.agents.has(agentId)).toBe(true);

      await agent.connection.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(server.agents.has(agentId)).toBe(false);
    });

    it('includes ownerId in agent_registered event', async () => {
      const client = await TestClient.create(server, { name: 'Observer' });
      const subscription = await client.subscribe({ eventTypes: [EVENT_TYPES.AGENT_REGISTERED] });

      const events: Event[] = [];
      subscription.on('event', (e) => events.push(e));

      const agent = await TestAgent.create(server, { name: 'New Agent', role: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.length).toBe(1);
      expect(events[0].data?.ownerId).toBeDefined();

      await subscription.unsubscribe();
      await agent.disconnect();
      await client.disconnect();
    });

    it('sets ownerId to null for orphaned agents', async () => {
      // Use BaseConnection directly to control disconnect behavior
      // (AgentConnection.disconnect() always unregisters first)
      const [clientStream, serverStream] = createStreamPair();
      const connection = new BaseConnection(clientStream);
      server.acceptConnection(serverStream);

      // Connect as agent participant
      await connection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'agent',
        name: 'Orphan Test',
      });

      // Register an agent
      const registerResult = await connection.sendRequest<
        { name: string },
        { agent: Agent }
      >(LIFECYCLE_METHODS.AGENTS_REGISTER, { name: 'Orphan Agent' });
      const agentId = registerResult.agent.id;

      // Verify agent has non-null ownerId
      const agentBefore = server.agents.get(agentId);
      expect(agentBefore?.ownerId).not.toBeNull();
      expect(isOrphanedAgent(agentBefore!)).toBe(false);

      // Disconnect with orphan policy (don't unregister first)
      await connection.sendRequest(CORE_METHODS.DISCONNECT, {
        policy: { agentBehavior: 'orphan' },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Agent should still exist but with null ownerId
      const agentAfter = server.agents.get(agentId);
      expect(agentAfter).toBeDefined();
      expect(agentAfter?.ownerId).toBeNull();
      expect(isOrphanedAgent(agentAfter!)).toBe(true);
    });

    it('emits agent_orphaned event with previousOwner', async () => {
      const client = await TestClient.create(server, { name: 'Observer' });
      const subscription = await client.subscribe({ eventTypes: [EVENT_TYPES.AGENT_ORPHANED] });

      const events: Event[] = [];
      subscription.on('event', (e) => events.push(e));

      // Use BaseConnection to control disconnect behavior
      const [agentStream, agentServerStream] = createStreamPair();
      const agentConn = new BaseConnection(agentStream);
      server.acceptConnection(agentServerStream);

      // Connect and register
      await agentConn.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'agent',
        name: 'Orphan Event Test',
      });
      await agentConn.sendRequest(LIFECYCLE_METHODS.AGENTS_REGISTER, {
        name: 'Orphan Event Agent',
      });

      // Disconnect with orphan policy
      await agentConn.sendRequest(CORE_METHODS.DISCONNECT, {
        policy: { agentBehavior: 'orphan' },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.length).toBe(1);
      expect(events[0].type).toBe(EVENT_TYPES.AGENT_ORPHANED);
      expect(events[0].data?.previousOwner).toBeDefined();
      expect(events[0].data?.previousOwner).not.toBeNull();

      await subscription.unsubscribe();
      await client.disconnect();
    });

    it('isOrphanedAgent helper correctly identifies orphaned agents', () => {
      // Test with non-orphaned agent (has ownerId)
      const ownedAgent: Agent = {
        id: 'agent-1',
        ownerId: 'participant-1',
        state: 'idle',
      };
      expect(isOrphanedAgent(ownedAgent)).toBe(false);

      // Test with orphaned agent (null ownerId)
      const orphanedAgent: Agent = {
        id: 'agent-2',
        ownerId: null,
        state: 'orphaned',
      };
      expect(isOrphanedAgent(orphanedAgent)).toBe(true);
    });
  });

  // ===========================================================================
  // EVENT_TYPES Constants
  // ===========================================================================

  describe('EVENT_TYPES Constants', () => {
    it('EVENT_TYPES values match expected event type strings', () => {
      expect(EVENT_TYPES.AGENT_REGISTERED).toBe('agent_registered');
      expect(EVENT_TYPES.AGENT_UNREGISTERED).toBe('agent_unregistered');
      expect(EVENT_TYPES.AGENT_STATE_CHANGED).toBe('agent_state_changed');
      expect(EVENT_TYPES.AGENT_ORPHANED).toBe('agent_orphaned');
      expect(EVENT_TYPES.PARTICIPANT_CONNECTED).toBe('participant_connected');
      expect(EVENT_TYPES.PARTICIPANT_DISCONNECTED).toBe('participant_disconnected');
      expect(EVENT_TYPES.MESSAGE_SENT).toBe('message_sent');
      expect(EVENT_TYPES.SCOPE_CREATED).toBe('scope_created');
      expect(EVENT_TYPES.SCOPE_MEMBER_JOINED).toBe('scope_member_joined');
      expect(EVENT_TYPES.SCOPE_MEMBER_LEFT).toBe('scope_member_left');
    });

    it('can use EVENT_TYPES in subscription filters', async () => {
      const client = await TestClient.create(server, { name: 'Observer' });

      // Use multiple EVENT_TYPES in filter
      const subscription = await client.subscribe({
        eventTypes: [
          EVENT_TYPES.AGENT_REGISTERED,
          EVENT_TYPES.AGENT_STATE_CHANGED,
        ],
      });

      const events: Event[] = [];
      subscription.on('event', (e) => events.push(e));

      // Create an agent (triggers AGENT_REGISTERED)
      const agent = await TestAgent.create(server, { name: 'Test Agent' });

      // Change state (triggers AGENT_STATE_CHANGED)
      await agent.busy();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should receive both event types
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain(EVENT_TYPES.AGENT_REGISTERED);
      expect(eventTypes).toContain(EVENT_TYPES.AGENT_STATE_CHANGED);

      await subscription.unsubscribe();
      await agent.disconnect();
      await client.disconnect();
    });
  });

  // ===========================================================================
  // Agent Hierarchy
  // ===========================================================================

  describe('Agent Hierarchy', () => {
    it('spawns child agents', async () => {
      const parent = await TestAgent.create(server, { name: 'Parent', role: 'supervisor' });

      const child = await parent.spawn({ name: 'Child', role: 'worker' });

      expect(child.id).toBeDefined();
      expect(child.parent).toBe(parent.id);
      expect(server.agents.size).toBe(2);

      await parent.disconnect();
    });

    it('spawns multiple children', async () => {
      const parent = await TestAgent.create(server, { name: 'Parent' });

      const child1 = await parent.spawn({ name: 'Child 1' });
      const child2 = await parent.spawn({ name: 'Child 2' });

      expect(child1.parent).toBe(parent.id);
      expect(child2.parent).toBe(parent.id);
      expect(server.agents.size).toBe(3);

      await parent.disconnect();
    });

    it('returns children when requested via getAgent', async () => {
      const parent = await TestAgent.create(server, { name: 'Parent' });
      await parent.spawn({ name: 'Child 1' });
      await parent.spawn({ name: 'Child 2' });

      const client = await TestClient.create(server, { name: 'Observer' });
      const result = await client.getAgent(parent.id!, { include: { children: true } });

      expect(result.children).toBeDefined();
      expect(result.children?.length).toBe(2);
      expect(result.children?.every((c) => c.parent === parent.id)).toBe(true);

      await parent.disconnect();
      await client.disconnect();
    });

    it('returns descendants recursively', async () => {
      const grandparent = await TestAgent.create(server, { name: 'Grandparent' });
      const child = await grandparent.spawn({ name: 'Child' });

      // Create a grandchild connection
      const [gcStream, gcServerStream] = createStreamPair();
      const grandchildConn = new AgentConnection(gcStream, { name: 'Grandchild', parent: child.id });
      server.acceptConnection(gcServerStream);
      await grandchildConn.connect();

      const client = await TestClient.create(server, { name: 'Observer' });
      const result = await client.getAgent(grandparent.id!, { include: { descendants: true } });

      expect(result.descendants).toBeDefined();
      expect(result.descendants?.length).toBeGreaterThanOrEqual(1);

      await grandchildConn.disconnect();
      await grandparent.disconnect();
      await client.disconnect();
    });

    it('unregisters children when parent disconnects', async () => {
      const parent = await TestAgent.create(server, { name: 'Parent' });
      const child1 = await parent.spawn({ name: 'Child 1' });
      const child2 = await parent.spawn({ name: 'Child 2' });

      expect(server.agents.size).toBe(3);

      await parent.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(server.agents.has(parent.id!)).toBe(false);
      expect(server.agents.has(child1.id)).toBe(false);
      expect(server.agents.has(child2.id)).toBe(false);
    });
  });

  // ===========================================================================
  // Messaging
  // ===========================================================================

  describe('Messaging', () => {
    describe('point-to-point', () => {
      it('sends message between agents', async () => {
        const sender = await TestAgent.create(server, { name: 'Sender' });
        const receiver = await TestAgent.create(server, { name: 'Receiver' });

        await sender.sendTo(receiver.id!, { hello: 'world' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(receiver.receivedMessages.length).toBe(1);
        expect(receiver.lastMessage?.payload).toEqual({ hello: 'world' });
        expect(sender.receivedMessages.length).toBe(0);

        await sender.disconnect();
        await receiver.disconnect();
      });

      it('routes messages to correct agent connection', async () => {
        const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
        const agent2 = await TestAgent.create(server, { name: 'Agent 2' });

        await agent1.sendTo(agent2.id!, { from: 'agent1' });
        await agent2.sendTo(agent1.id!, { from: 'agent2' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(agent1.lastMessage?.payload).toEqual({ from: 'agent2' });
        expect(agent2.lastMessage?.payload).toEqual({ from: 'agent1' });

        await agent1.disconnect();
        await agent2.disconnect();
      });

      it('client sends message to agent', async () => {
        const agent = await TestAgent.create(server, { name: 'Worker' });
        const client = await TestClient.create(server, { name: 'Controller' });

        await client.sendTo(agent.id!, { instruction: 'process data' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(agent.receivedMessages.length).toBe(1);
        expect(agent.lastMessage?.payload).toEqual({ instruction: 'process data' });

        await agent.disconnect();
        await client.disconnect();
      });
    });

    describe('hierarchical messaging', () => {
      it('sends to parent and parent receives message', async () => {
        // Create parent-child hierarchy with separate connections
        const parent = await TestAgent.create(server, { name: 'Parent' });

        // Create child with parent relationship
        const [childStream, childServerStream] = createStreamPair();
        const childConn = new BaseConnection(childStream);
        server.acceptConnection(childServerStream);

        await childConn.sendRequest(CORE_METHODS.CONNECT, {
          protocolVersion: 1,
          participantType: 'agent',
          name: 'Child',
        });

        const childResult = await childConn.sendRequest<
          { name: string; parent: string },
          { agent: Agent }
        >(LIFECYCLE_METHODS.AGENTS_REGISTER, {
          name: 'Child Agent',
          parent: parent.id!,
        });

        // Child sends to parent
        await childConn.sendRequest(CORE_METHODS.SEND, {
          to: { parent: true },
          payload: { status: 'working' },
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Parent should have received the message
        expect(parent.receivedMessages.length).toBe(1);
        expect(parent.lastMessage?.payload).toEqual({ status: 'working' });

        await childConn.sendRequest(CORE_METHODS.DISCONNECT, {});
        await parent.disconnect();
      });

      it('sends to children and children receive messages', async () => {
        const parent = await TestAgent.create(server, { name: 'Parent' });

        // Create children with separate connections so they can receive messages
        const child1 = await TestAgent.create(server, { name: 'Child 1' });
        const child2 = await TestAgent.create(server, { name: 'Child 2' });

        // Manually set parent relationship in server
        const child1Agent = server.agents.get(child1.id!);
        const child2Agent = server.agents.get(child2.id!);
        if (child1Agent) (child1Agent as { parent?: string }).parent = parent.id!;
        if (child2Agent) (child2Agent as { parent?: string }).parent = parent.id!;

        // Parent sends to children
        await parent.sendToChildren({ instruction: 'start task' });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Both children should have received the message
        expect(child1.receivedMessages.length).toBe(1);
        expect(child1.lastMessage?.payload).toEqual({ instruction: 'start task' });
        expect(child2.receivedMessages.length).toBe(1);
        expect(child2.lastMessage?.payload).toEqual({ instruction: 'start task' });

        await parent.disconnect();
        await child1.disconnect();
        await child2.disconnect();
      });

      it('sends to siblings', async () => {
        const parent = await TestAgent.create(server, { name: 'Parent' });

        // Create siblings
        const sibling1 = await TestAgent.create(server, { name: 'Sibling 1' });
        const sibling2 = await TestAgent.create(server, { name: 'Sibling 2' });
        const sibling3 = await TestAgent.create(server, { name: 'Sibling 3' });

        // Set parent relationships
        const s1 = server.agents.get(sibling1.id!);
        const s2 = server.agents.get(sibling2.id!);
        const s3 = server.agents.get(sibling3.id!);
        if (s1) (s1 as { parent?: string }).parent = parent.id!;
        if (s2) (s2 as { parent?: string }).parent = parent.id!;
        if (s3) (s3 as { parent?: string }).parent = parent.id!;

        // Sibling 1 sends to siblings
        await sibling1.sendToSiblings({ greeting: 'hello siblings' });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Siblings 2 and 3 should receive, but not sibling 1 (sender)
        expect(sibling1.receivedMessages.length).toBe(0);
        expect(sibling2.receivedMessages.length).toBe(1);
        expect(sibling2.lastMessage?.payload).toEqual({ greeting: 'hello siblings' });
        expect(sibling3.receivedMessages.length).toBe(1);
        expect(sibling3.lastMessage?.payload).toEqual({ greeting: 'hello siblings' });

        await parent.disconnect();
        await sibling1.disconnect();
        await sibling2.disconnect();
        await sibling3.disconnect();
      });

      it('sends to descendants (multi-level)', async () => {
        // Create hierarchy: grandparent -> parent -> child
        const grandparent = await TestAgent.create(server, { name: 'Grandparent' });
        const parentAgent = await TestAgent.create(server, { name: 'Parent' });
        const child = await TestAgent.create(server, { name: 'Child' });

        // Set hierarchy
        const parentAgentData = server.agents.get(parentAgent.id!);
        const childAgentData = server.agents.get(child.id!);
        if (parentAgentData) (parentAgentData as { parent?: string }).parent = grandparent.id!;
        if (childAgentData) (childAgentData as { parent?: string }).parent = parentAgent.id!;

        // Grandparent sends to all descendants using generic send
        await grandparent.connection.send({ descendants: true }, { broadcast: 'to all descendants' });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Both parent and child should receive
        expect(parentAgent.receivedMessages.length).toBe(1);
        expect(parentAgent.lastMessage?.payload).toEqual({ broadcast: 'to all descendants' });
        expect(child.receivedMessages.length).toBe(1);
        expect(child.lastMessage?.payload).toEqual({ broadcast: 'to all descendants' });

        await grandparent.disconnect();
        await parentAgent.disconnect();
        await child.disconnect();
      });

      it('sends to ancestors (multi-level)', async () => {
        // Create hierarchy: grandparent -> parent -> child
        const grandparent = await TestAgent.create(server, { name: 'Grandparent' });
        const parentAgent = await TestAgent.create(server, { name: 'Parent' });
        const child = await TestAgent.create(server, { name: 'Child' });

        // Set hierarchy
        const parentAgentData = server.agents.get(parentAgent.id!);
        const childAgentData = server.agents.get(child.id!);
        if (parentAgentData) (parentAgentData as { parent?: string }).parent = grandparent.id!;
        if (childAgentData) (childAgentData as { parent?: string }).parent = parentAgent.id!;

        // Child sends to all ancestors
        await child.connection.send({ ancestors: true }, { status: 'from child to ancestors' });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Both parent and grandparent should receive
        expect(parentAgent.receivedMessages.length).toBe(1);
        expect(parentAgent.lastMessage?.payload).toEqual({ status: 'from child to ancestors' });
        expect(grandparent.receivedMessages.length).toBe(1);
        expect(grandparent.lastMessage?.payload).toEqual({ status: 'from child to ancestors' });
        // Child shouldn't receive its own message
        expect(child.receivedMessages.length).toBe(0);

        await grandparent.disconnect();
        await parentAgent.disconnect();
        await child.disconnect();
      });

      it('respects depth limit for descendants', async () => {
        // Create 3-level hierarchy: root -> level1 -> level2
        const root = await TestAgent.create(server, { name: 'Root' });
        const level1 = await TestAgent.create(server, { name: 'Level 1' });
        const level2 = await TestAgent.create(server, { name: 'Level 2' });

        // Set hierarchy
        const l1 = server.agents.get(level1.id!);
        const l2 = server.agents.get(level2.id!);
        if (l1) (l1 as { parent?: string }).parent = root.id!;
        if (l2) (l2 as { parent?: string }).parent = level1.id!;

        // Root sends to descendants with depth=1 (only direct children)
        await root.connection.send({ descendants: true, depth: 1 }, { message: 'depth limited' });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Only level1 should receive (depth 1)
        expect(level1.receivedMessages.length).toBe(1);
        expect(level2.receivedMessages.length).toBe(0);

        await root.disconnect();
        await level1.disconnect();
        await level2.disconnect();
      });
    });

    describe('broadcast messaging', () => {
      it('broadcasts to all agents', async () => {
        const client = await TestClient.create(server, { name: 'Broadcaster' });
        const agents: TestAgent[] = [];

        for (let i = 0; i < 3; i++) {
          agents.push(await TestAgent.create(server, { name: `Agent ${i}` }));
        }

        await client.broadcast({ announcement: 'Hello everyone!' });

        expect(server.messages.length).toBe(1);

        for (const agent of agents) {
          await agent.disconnect();
        }
        await client.disconnect();
      });

      it('sends to agents by role', async () => {
        const client = await TestClient.create(server, { name: 'Controller' });
        await TestAgent.create(server, { name: 'Worker 1', role: 'worker' });
        await TestAgent.create(server, { name: 'Worker 2', role: 'worker' });
        await TestAgent.create(server, { name: 'Supervisor', role: 'supervisor' });

        await client.sendToRole('worker', { task: 'do work' });

        expect(server.messages.length).toBe(1);

        await client.disconnect();
      });
    });

    describe('message tracking', () => {
      it('records all messages on server', async () => {
        const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
        const agent2 = await TestAgent.create(server, { name: 'Agent 2' });

        await agent1.sendTo(agent2.id!, { msg: 1 });
        await agent2.sendTo(agent1.id!, { msg: 2 });

        expect(server.messages.length).toBe(2);
        expect(server.messages[0].payload).toEqual({ msg: 1 });
        expect(server.messages[1].payload).toEqual({ msg: 2 });

        await agent1.disconnect();
        await agent2.disconnect();
      });

      it('includes timestamp in messages', async () => {
        const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
        const agent2 = await TestAgent.create(server, { name: 'Agent 2' });

        const before = Date.now();
        await agent1.sendTo(agent2.id!, { test: true });
        const after = Date.now();

        expect(server.messages[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(server.messages[0].timestamp).toBeLessThanOrEqual(after);

        await agent1.disconnect();
        await agent2.disconnect();
      });
    });
  });

  // ===========================================================================
  // Scopes
  // ===========================================================================

  describe('Scopes', () => {
    describe('scope lifecycle', () => {
      it('creates scope', async () => {
        const agent = await TestAgent.create(server, { name: 'Creator' });

        const scope = await agent.createScope('My Scope');

        expect(scope.id).toBeDefined();
        expect(scope.name).toBe('My Scope');
        expect(server.scopes.size).toBe(1);

        await agent.disconnect();
      });

      it('joins scope', async () => {
        const agent = await TestAgent.create(server, { name: 'Joiner' });
        const scope = await agent.createScope('Test Scope');

        const result = await agent.joinScope(scope.id);

        expect(result.scope).toBeDefined();
        expect(result.scope.id).toBe(scope.id);
        expect(result.agent).toBeDefined();
        expect(result.agent.id).toBe(agent.id);

        await agent.disconnect();
      });

      it('leaves scope', async () => {
        const agent = await TestAgent.create(server, { name: 'Leaver' });
        const scope = await agent.createScope('Test Scope');
        await agent.joinScope(scope.id);

        const result = await agent.leaveScope(scope.id);

        expect(result.scope).toBeDefined();
        expect(result.agent).toBeDefined();

        await agent.disconnect();
      });

      it('emits scope events', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const agent = await TestAgent.create(server, { name: 'Scope Agent' });

        const subscription = await client.subscribe({
          eventTypes: ['scope_created', 'scope_member_joined', 'scope_member_left'],
        });
        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        const scope = await agent.createScope('Event Scope');
        await agent.joinScope(scope.id);
        await agent.leaveScope(scope.id);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(events.some((e) => e.type === 'scope_created')).toBe(true);
        expect(events.some((e) => e.type === 'scope_member_joined')).toBe(true);
        expect(events.some((e) => e.type === 'scope_member_left')).toBe(true);

        await subscription.unsubscribe();
        await agent.disconnect();
        await client.disconnect();
      });
    });

    describe('scope collaboration', () => {
      it('multiple agents join scope', async () => {
        const agents = await Promise.all([
          TestAgent.create(server, { name: 'Agent 1' }),
          TestAgent.create(server, { name: 'Agent 2' }),
          TestAgent.create(server, { name: 'Agent 3' }),
        ]);

        const scope = await agents[0].createScope('Collaboration');
        await Promise.all(agents.map((a) => a.joinScope(scope.id)));

        // All should be able to send to scope
        const result = await agents[1].sendToScope(scope.id, { update: 'progress' });
        expect(result).toBeDefined();

        await Promise.all(agents.map((a) => a.disconnect()));
      });

      it('sends messages to scope members', async () => {
        const agents = await Promise.all([
          TestAgent.create(server, { name: 'Agent 1' }),
          TestAgent.create(server, { name: 'Agent 2' }),
          TestAgent.create(server, { name: 'Agent 3' }),
        ]);

        const scope = await agents[0].createScope('Team');
        await Promise.all(agents.map((a) => a.joinScope(scope.id)));

        await agents[0].sendToScope(scope.id, { announcement: 'hello team' });

        expect(server.messages.length).toBe(1);

        await Promise.all(agents.map((a) => a.disconnect()));
      });
    });
  });

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  describe('Subscriptions', () => {
    describe('basic subscriptions', () => {
      it('subscribes and unsubscribes', async () => {
        const client = await TestClient.create(server, { name: 'Subscriber' });

        const subscription = await client.subscribe();

        expect(subscription.id).toBeDefined();
        expect(subscription.isClosed).toBe(false);

        await subscription.unsubscribe();
        expect(subscription.isClosed).toBe(true);

        await client.disconnect();
      });

      it('receives events through subscription', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const subscription = await client.subscribe({ eventTypes: ['agent_registered'] });

        const events: Event[] = [];
        subscription.on('event', (event) => events.push(event));

        const agent = await TestAgent.create(server, { name: 'Event Test Agent' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(events.length).toBeGreaterThan(0);
        expect(events[0].type).toBe('agent_registered');

        await agent.disconnect();
        await subscription.unsubscribe();
        await client.disconnect();
      });

      it('supports async iteration', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const subscription = await client.subscribe({ eventTypes: ['agent_registered'] });

        const createAgents = async () => {
          for (let i = 0; i < 3; i++) {
            await TestAgent.create(server, { name: `Agent ${i}` });
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
          subscription._close();
        };

        createAgents();

        const events: Event[] = [];
        for await (const event of subscription) {
          events.push(event);
        }

        expect(events.length).toBe(3);
        expect(events.every((e) => e.type === 'agent_registered')).toBe(true);

        await client.disconnect();
      });
    });

    describe('subscription filters', () => {
      it('filters by event type', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const subscription = await client.subscribe({ eventTypes: ['scope_created'] });
        const events: Event[] = [];
        subscription.on('event', (event) => events.push(event));

        const agent = await TestAgent.create(server, { name: 'Agent' });
        await agent.createScope('New Scope');
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Should only have scope event, not agent registration
        expect(events.length).toBe(1);
        expect(events[0].type).toBe('scope_created');

        await subscription.unsubscribe();
        await agent.disconnect();
        await client.disconnect();
      });

      it('filters by source agents (fromAgents)', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
        const agent2 = await TestAgent.create(server, { name: 'Agent 2' });

        const subscription = await client.subscribe({
          eventTypes: ['agent_state_changed'],
          fromAgents: [agent1.id!],
        });
        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        await agent1.busy();
        await agent2.busy();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(events.every((e) => e.source === agent1.id)).toBe(true);

        await subscription.unsubscribe();
        await agent1.disconnect();
        await agent2.disconnect();
        await client.disconnect();
      });

      it('filters by role (fromRoles)', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const worker = await TestAgent.create(server, { name: 'Worker', role: 'worker' });
        const supervisor = await TestAgent.create(server, { name: 'Supervisor', role: 'supervisor' });

        const subscription = await client.subscribe({
          eventTypes: ['agent_state_changed'],
          fromRoles: ['worker'],
        });
        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        await worker.busy();
        await supervisor.busy();
        await new Promise((resolve) => setTimeout(resolve, 50));

        const workerEvents = events.filter((e) => e.source === worker.id);
        expect(workerEvents.length).toBeGreaterThan(0);

        await subscription.unsubscribe();
        await worker.disconnect();
        await supervisor.disconnect();
        await client.disconnect();
      });

      it('filters by scope', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const agent = await TestAgent.create(server, { name: 'Agent' });

        const scope1 = await agent.createScope('Scope 1');
        const scope2 = await agent.createScope('Scope 2');

        const subscription = await client.subscribe({
          eventTypes: ['scope_member_joined'],
          scopes: [scope1.id],
        });
        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        await agent.joinScope(scope1.id);
        await agent.joinScope(scope2.id);
        await new Promise((resolve) => setTimeout(resolve, 50));

        const scope1Events = events.filter(
          (e) => e.type === 'scope_member_joined' && e.data?.scopeId === scope1.id
        );
        expect(scope1Events.length).toBe(1);

        await subscription.unsubscribe();
        await agent.disconnect();
        await client.disconnect();
      });

      it('filters by correlationIds', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });

        // Subscribe to events with specific correlation IDs
        const subscription = await client.subscribe({
          correlationIds: ['corr-123', 'corr-456'],
        });
        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        // Emit events with different correlation IDs via server
        server.emitEvent({
          type: EVENT_TYPES.MESSAGE_SENT,
          source: 'test',
          data: { correlationId: 'corr-123', messageId: 'msg-1' },
        });
        server.emitEvent({
          type: EVENT_TYPES.MESSAGE_SENT,
          source: 'test',
          data: { correlationId: 'corr-789', messageId: 'msg-2' }, // Should not match
        });
        server.emitEvent({
          type: EVENT_TYPES.MESSAGE_SENT,
          source: 'test',
          data: { correlationId: 'corr-456', messageId: 'msg-3' },
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Should only receive events with matching correlation IDs
        expect(events.length).toBe(2);
        expect(events.every((e) =>
          ['corr-123', 'corr-456'].includes((e.data as { correlationId: string }).correlationId)
        )).toBe(true);

        await subscription.unsubscribe();
        await client.disconnect();
      });

      it('filters by metadataMatch', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });

        // Subscribe to events with specific metadata values
        const subscription = await client.subscribe({
          metadataMatch: { priority: 'high', category: 'alert' },
        });
        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        // Emit events with different metadata
        server.emitEvent({
          type: EVENT_TYPES.SYSTEM_ERROR,
          data: { metadata: { priority: 'high', category: 'alert', source: 'A' } },
        });
        server.emitEvent({
          type: EVENT_TYPES.SYSTEM_ERROR,
          data: { metadata: { priority: 'low', category: 'alert' } }, // Should not match (priority mismatch)
        });
        server.emitEvent({
          type: EVENT_TYPES.SYSTEM_ERROR,
          data: { metadata: { priority: 'high', category: 'info' } }, // Should not match (category mismatch)
        });
        server.emitEvent({
          type: EVENT_TYPES.SYSTEM_ERROR,
          data: { metadata: { priority: 'high', category: 'alert', extra: 'data' } }, // Should match (has both)
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Should only receive events with matching metadata
        expect(events.length).toBe(2);
        for (const event of events) {
          const metadata = (event.data as { metadata: Record<string, unknown> }).metadata;
          expect(metadata.priority).toBe('high');
          expect(metadata.category).toBe('alert');
        }

        await subscription.unsubscribe();
        await client.disconnect();
      });

      it('combines multiple filters with AND logic', async () => {
        const client = await TestClient.create(server, { name: 'Observer' });
        const worker = await TestAgent.create(server, { name: 'Worker', role: 'worker' });
        const supervisor = await TestAgent.create(server, { name: 'Supervisor', role: 'supervisor' });

        // Subscribe with multiple filters - should AND them
        const subscription = await client.subscribe({
          eventTypes: [EVENT_TYPES.AGENT_STATE_CHANGED],
          fromRoles: ['worker'],
        });
        const events: Event[] = [];
        subscription.on('event', (e) => events.push(e));

        // Both agents change state
        await worker.busy();
        await supervisor.busy();
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Should only receive worker state changes (matches both eventType AND role)
        expect(events.length).toBe(1);
        expect(events[0].source).toBe(worker.id);

        await subscription.unsubscribe();
        await worker.disconnect();
        await supervisor.disconnect();
        await client.disconnect();
      });
    });
  });

  // ===========================================================================
  // Client Control Operations
  // ===========================================================================

  describe('Client Control Operations', () => {
    it('queries agents', async () => {
      await TestAgent.create(server, { name: 'Worker 1', role: 'worker' });
      await TestAgent.create(server, { name: 'Worker 2', role: 'worker' });
      await TestAgent.create(server, { name: 'Supervisor', role: 'supervisor' });

      const client = await TestClient.create(server, { name: 'Query Client' });

      const allAgents = await client.listAgents();
      expect(allAgents.length).toBe(3);

      const workers = await client.findAgentsByRole('worker');
      expect(workers.length).toBe(2);

      const supervisor = await client.findAgentByName('Supervisor');
      expect(supervisor?.role).toBe('supervisor');

      await client.disconnect();
    });

    it('queries scopes', async () => {
      const agent = await TestAgent.create(server, { name: 'Agent' });
      await agent.createScope('Scope 1');
      await agent.createScope('Scope 2');

      const client = await TestClient.create(server, { name: 'Query Client' });
      const scopes = await client.listScopes();

      expect(scopes.length).toBe(2);

      await agent.disconnect();
      await client.disconnect();
    });

    it('stops agent', async () => {
      const agent = await TestAgent.create(server, { name: 'Stoppable Agent' });
      const client = await TestClient.create(server, { name: 'Controller' });

      await client.stopAgent(agent.id!);

      expect(server.agents.get(agent.id!)?.state).toBe('stopping');

      await agent.disconnect();
      await client.disconnect();
    });

    it('injects context into agent', async () => {
      const agent = await TestAgent.create(server, { name: 'Injectable Agent' });
      const client = await TestClient.create(server, { name: 'Controller' });

      await client.inject(agent.id!, { priority: 'focus on task X' });

      // Injection acknowledged (actual injection handling is server-dependent)
      await agent.disconnect();
      await client.disconnect();
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('throws on agent not found', async () => {
      const client = await TestClient.create(server, { name: 'Client' });

      await expect(client.getAgent('nonexistent-agent')).rejects.toThrow('Agent not found');

      await client.disconnect();
    });

    it('throws on scope not found', async () => {
      const agent = await TestAgent.create(server, { name: 'Agent' });

      await expect(agent.joinScope('nonexistent-scope')).rejects.toThrow('Scope not found');

      await agent.disconnect();
    });

    it('throws on duplicate agent registration', async () => {
      const agent1 = await TestAgent.create(server, { name: 'Agent', agentId: 'fixed-id' });

      const [agent2Stream, agent2ServerStream] = createStreamPair();
      const agent2 = new AgentConnection(agent2Stream, { name: 'Agent 2' });
      server.acceptConnection(agent2ServerStream);

      await expect(agent2.connect({ agentId: 'fixed-id' })).rejects.toThrow('already exists');

      await agent1.disconnect();
    });
  });

  // ===========================================================================
  // Test Helpers
  // ===========================================================================

  describe('Test Helpers', () => {
    describe('TestAgent', () => {
      it('tracks received messages', async () => {
        const receiver = await TestAgent.create(server, { name: 'Receiver' });
        const sender = await TestAgent.create(server, { name: 'Sender' });

        expect(receiver.receivedMessages.length).toBe(0);

        await sender.sendTo(receiver.id!, { hello: 'world' });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(receiver.receivedMessages.length).toBe(1);
        expect(receiver.lastMessage?.payload).toEqual({ hello: 'world' });

        await receiver.disconnect();
        await sender.disconnect();
      });

      it('clears messages', async () => {
        const receiver = await TestAgent.create(server, { name: 'Receiver' });
        const sender = await TestAgent.create(server, { name: 'Sender' });

        await sender.sendTo(receiver.id!, { msg: 1 });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(receiver.receivedMessages.length).toBe(1);

        receiver.clearMessages();
        expect(receiver.receivedMessages.length).toBe(0);

        await receiver.disconnect();
        await sender.disconnect();
      });

      it('waits for message', async () => {
        const receiver = await TestAgent.create(server, { name: 'Receiver' });
        const sender = await TestAgent.create(server, { name: 'Sender' });

        const messagePromise = receiver.waitForMessage(2000);

        setTimeout(async () => {
          await sender.sendTo(receiver.id!, { delayed: true });
        }, 50);

        const message = await messagePromise;
        expect(message.payload).toEqual({ delayed: true });

        await receiver.disconnect();
        await sender.disconnect();
      });
    });

    describe('TestClient', () => {
      it('collects events over time', async () => {
        const client = await TestClient.create(server, { name: 'Collector' });

        const eventsPromise = client.collectEvents({ eventTypes: ['agent_registered'] }, 200);

        const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
        const agent2 = await TestAgent.create(server, { name: 'Agent 2' });

        const events = await eventsPromise;

        expect(events.length).toBe(2);
        expect(events.every((e) => e.type === 'agent_registered')).toBe(true);

        await agent1.disconnect();
        await agent2.disconnect();
        await client.disconnect();
      });

      it('waits for specific event', async () => {
        const client = await TestClient.create(server, { name: 'Waiter' });

        const eventPromise = client.waitForEvent('agent_registered', 2000);

        setTimeout(async () => {
          await TestAgent.create(server, { name: 'Delayed Agent' });
        }, 50);

        const event = await eventPromise;

        expect(event.type).toBe('agent_registered');
        expect(event.data?.name).toBe('Delayed Agent');

        await client.disconnect();
      });
    });
  });

  // ===========================================================================
  // Event Replay
  // ===========================================================================

  describe('Event Replay', () => {
    let client: ClientConnection;
    let clientStream: ReturnType<typeof createStreamPair>[0];
    let serverStream: ReturnType<typeof createStreamPair>[1];

    beforeEach(async () => {
      [clientStream, serverStream] = createStreamPair();
      client = new ClientConnection(clientStream, { name: 'Replay Client' });
      server.acceptConnection(serverStream);
      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
    });

    it('replays events from event history', async () => {
      // Create some events
      const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
      const agent2 = await TestAgent.create(server, { name: 'Agent 2' });
      const agent3 = await TestAgent.create(server, { name: 'Agent 3' });

      // Replay all events
      const result = await client.replay();

      // Should have events (participant connected + agent registered events)
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.events.every((e) => e.eventId)).toBe(true);
      expect(result.events.every((e) => e.timestamp > 0)).toBe(true);

      await agent1.disconnect();
      await agent2.disconnect();
      await agent3.disconnect();
    });

    it('supports keyset pagination with afterEventId', async () => {
      // Create events
      const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
      const agent2 = await TestAgent.create(server, { name: 'Agent 2' });
      const agent3 = await TestAgent.create(server, { name: 'Agent 3' });

      // Get first page with limit 2
      const page1 = await client.replay({ limit: 2 });
      expect(page1.events.length).toBe(2);
      expect(page1.hasMore).toBe(true);

      // Get second page using afterEventId
      const lastEventId = page1.events.at(-1)?.eventId;
      const page2 = await client.replay({ afterEventId: lastEventId, limit: 2 });
      expect(page2.events.length).toBe(2);

      // Events should be different between pages
      const page1Ids = new Set(page1.events.map((e) => e.eventId));
      const page2Ids = new Set(page2.events.map((e) => e.eventId));
      expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false);

      await agent1.disconnect();
      await agent2.disconnect();
      await agent3.disconnect();
    });

    it('filters events by event type', async () => {
      // Create agents to generate agent_registered events
      const agent = await TestAgent.create(server, { name: 'Test Agent' });

      // Replay only agent_registered events
      const result = await client.replay({
        filter: { eventTypes: ['agent_registered'] },
      });

      // All returned events should be agent_registered
      expect(result.events.every((e) => e.event.type === 'agent_registered')).toBe(true);

      await agent.disconnect();
    });

    it('filters events by timestamp range', async () => {
      const beforeTimestamp = Date.now();

      // Create event
      const agent = await TestAgent.create(server, { name: 'Test Agent' });

      const afterTimestamp = Date.now();

      // Replay with timestamp range
      const result = await client.replay({
        fromTimestamp: beforeTimestamp,
        toTimestamp: afterTimestamp,
      });

      // All events should be within the time range
      expect(result.events.every((e) => e.timestamp >= beforeTimestamp && e.timestamp <= afterTimestamp)).toBe(true);

      await agent.disconnect();
    });

    it('replayAll iterates through all events', async () => {
      // Create multiple events
      const agent1 = await TestAgent.create(server, { name: 'Agent 1' });
      const agent2 = await TestAgent.create(server, { name: 'Agent 2' });

      // Collect all events using replayAll
      const allEvents = [];
      for await (const event of client.replayAll({ limit: 1 })) {
        allEvents.push(event);
      }

      // Should have multiple events
      expect(allEvents.length).toBeGreaterThan(0);

      // All events should have valid fields
      expect(allEvents.every((e) => e.eventId && e.timestamp && e.event)).toBe(true);

      await agent1.disconnect();
      await agent2.disconnect();
    });

    it('returns totalCount in replay response', async () => {
      const agent = await TestAgent.create(server, { name: 'Test Agent' });

      const result = await client.replay();

      expect(typeof result.totalCount).toBe('number');
      expect(result.totalCount).toBeGreaterThan(0);

      await agent.disconnect();
    });

    it('includes eventId in live event notifications', async () => {
      // Subscribe to events
      const subscription = await client.subscribe();
      const receivedEvents: Event[] = [];

      subscription.on('event', (event) => {
        receivedEvents.push(event);
      });

      // Create an agent to trigger event
      const agent = await TestAgent.create(server, { name: 'Live Event Agent' });

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check that eventId was included in the delivery
      // The subscription tracks lastEventId
      expect(subscription.lastEventId).toBeDefined();

      await subscription.unsubscribe();
      await agent.disconnect();
    });
  });
});
