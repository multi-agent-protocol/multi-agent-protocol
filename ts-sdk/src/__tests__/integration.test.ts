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
import { createStreamPair } from '../stream';
import type { Event, Message } from '../types';

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
      const subscription = await client.subscribe({ eventTypes: ['agent_registered'] });

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
      it('sends to parent', async () => {
        const parent = await TestAgent.create(server, { name: 'Parent' });

        const result = await parent.sendToParent({ status: 'working' });

        expect(result).toBeDefined();
        expect(server.messages.length).toBe(1);

        await parent.disconnect();
      });

      it('sends to children', async () => {
        const parent = await TestAgent.create(server, { name: 'Parent' });
        await parent.spawn({ name: 'Child 1' });
        await parent.spawn({ name: 'Child 2' });

        const result = await parent.sendToChildren({ instruction: 'start task' });

        expect(result).toBeDefined();

        await parent.disconnect();
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
});
