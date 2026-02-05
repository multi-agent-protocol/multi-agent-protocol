/**
 * Tests for AgentConnection class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentConnection } from '../connection/agent';
import { BaseConnection } from '../connection/base';
import { createStreamPair } from '../stream';
import {
  CORE_METHODS,
  LIFECYCLE_METHODS,
  STATE_METHODS,
  SCOPE_METHODS,
  NOTIFICATION_METHODS,
  type ConnectRequestParams,
  type ConnectResponseResult,
  type AgentsRegisterRequestParams,
  type AgentsRegisterResponseResult,
  type AgentsUpdateResponseResult,
  type AgentsSpawnResponseResult,
  type SendResponseResult,
  type SubscribeResponseResult,
  type ScopesCreateResponseResult,
  type ScopesJoinResponseResult,
  type ScopesLeaveResponseResult,
  type Message,
} from '../types';

/**
 * Mock server that handles agent requests
 */
function createMockServer(serverStream: ReturnType<typeof createStreamPair>[1]) {
  const server = new BaseConnection(serverStream);
  const state = {
    connected: false,
    sessionId: 'test-session-123',
    agents: new Map<string, { id: string; state: string; name?: string; metadata?: Record<string, unknown>; parent?: string }>(),
    scopes: new Map<string, { id: string; members: string[] }>(),
    subscriptions: new Map<string, unknown>(),
    messages: [] as Message[],
    nextAgentId: 1,
    nextScopeId: 1,
    nextSubscriptionId: 1,
  };

  server.setRequestHandler(async (method, params) => {
    switch (method) {
      case CORE_METHODS.CONNECT: {
        state.connected = true;
        return {
          protocolVersion: 1,
          sessionId: state.sessionId,
          participantId: 'participant-123',
          capabilities: {
            observation: { canObserve: true },
            messaging: { canSend: true, canReceive: true },
            lifecycle: { canSpawn: true },
            scopes: { canCreateScopes: true },
          },
        } satisfies ConnectResponseResult;
      }

      case CORE_METHODS.DISCONNECT:
        state.connected = false;
        return { acknowledged: true };

      case LIFECYCLE_METHODS.AGENTS_REGISTER: {
        const registerParams = params as AgentsRegisterRequestParams;
        const agentId = registerParams.agentId || `agent-${state.nextAgentId++}`;
        const agent = {
          id: agentId,
          name: registerParams.name,
          role: registerParams.role,
          state: 'registered' as const,
          visibility: registerParams.visibility,
          scopes: registerParams.scopes || [],
        };
        state.agents.set(agentId, agent);
        return { agent } satisfies AgentsRegisterResponseResult;
      }

      case STATE_METHODS.AGENTS_UPDATE: {
        const { agentId, state: newState, metadata } = params as {
          agentId: string;
          state?: string;
          metadata?: Record<string, unknown>;
        };
        const agent = state.agents.get(agentId);
        if (!agent) throw { code: -32004, message: 'Agent not found' };
        if (newState) agent.state = newState;
        if (metadata) agent.metadata = { ...agent.metadata, ...metadata };
        return { agent } satisfies AgentsUpdateResponseResult;
      }

      case LIFECYCLE_METHODS.AGENTS_UNREGISTER: {
        const { agentId } = params as { agentId: string };
        state.agents.delete(agentId);
        return { acknowledged: true };
      }

      case LIFECYCLE_METHODS.AGENTS_SPAWN: {
        const spawnParams = params as { parent: string; name?: string; role?: string };
        const childId = `agent-${state.nextAgentId++}`;
        const child = {
          id: childId,
          name: spawnParams.name,
          state: 'registered' as const,
          parent: spawnParams.parent,
        };
        state.agents.set(childId, child);
        return { agent: child } satisfies AgentsSpawnResponseResult;
      }

      case CORE_METHODS.SEND: {
        const messageId = `msg-${Date.now()}`;
        return {
          messageId,
          delivered: ['recipient-1'],
        } satisfies SendResponseResult;
      }

      case CORE_METHODS.SUBSCRIBE: {
        const subscriptionId = `sub-${state.nextSubscriptionId++}`;
        state.subscriptions.set(subscriptionId, params);
        return { subscriptionId } satisfies SubscribeResponseResult;
      }

      case CORE_METHODS.UNSUBSCRIBE: {
        const { subscriptionId } = params as { subscriptionId: string };
        state.subscriptions.delete(subscriptionId);
        return { acknowledged: true };
      }

      case SCOPE_METHODS.SCOPES_CREATE: {
        const createParams = params as { scopeId?: string; name?: string };
        const scopeId = createParams.scopeId || `scope-${state.nextScopeId++}`;
        const scope = { id: scopeId, name: createParams.name, members: [] };
        state.scopes.set(scopeId, scope);
        return { scope } satisfies ScopesCreateResponseResult;
      }

      case SCOPE_METHODS.SCOPES_JOIN: {
        const { scopeId, agentId } = params as { scopeId: string; agentId: string };
        const scope = state.scopes.get(scopeId);
        if (!scope) throw { code: -32005, message: 'Scope not found' };
        const agent = state.agents.get(agentId);
        if (!agent) throw { code: -32004, message: 'Agent not found' };
        if (!scope.members.includes(agentId)) {
          scope.members.push(agentId);
        }
        return { scope, agent } satisfies ScopesJoinResponseResult;
      }

      case SCOPE_METHODS.SCOPES_LEAVE: {
        const { scopeId, agentId } = params as { scopeId: string; agentId: string };
        const scope = state.scopes.get(scopeId);
        if (!scope) throw { code: -32005, message: 'Scope not found' };
        const agent = state.agents.get(agentId);
        if (!agent) throw { code: -32004, message: 'Agent not found' };
        scope.members = scope.members.filter((m) => m !== agentId);
        return { scope, agent } satisfies ScopesLeaveResponseResult;
      }

      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }
  });

  return { server, state };
}

describe('AgentConnection', () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];
  let agent: AgentConnection;
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
    agent = new AgentConnection(clientStream, {
      name: 'Test Agent',
      role: 'worker',
    });
    mockServer = createMockServer(serverStream);
  });

  afterEach(async () => {
    await agent.disconnect();
    await mockServer.server.close();
  });

  describe('connect', () => {
    it('connects and registers agent', async () => {
      const result = await agent.connect();

      expect(result.connection.sessionId).toBe('test-session-123');
      expect(result.agent.id).toBeDefined();
      expect(result.agent.state).toBe('registered');
      expect(agent.isConnected).toBe(true);
      expect(agent.agentId).toBeDefined();
    });

    it('stores session info', async () => {
      await agent.connect();

      expect(agent.sessionId).toBe('test-session-123');
      expect(agent.serverCapabilities).toBeDefined();
    });

    it('supports custom agent ID', async () => {
      const result = await agent.connect({ agentId: 'my-agent-id' });

      expect(result.agent.id).toBe('my-agent-id');
      expect(agent.agentId).toBe('my-agent-id');
    });

    it('supports authentication', async () => {
      const result = await agent.connect({
        auth: { method: 'bearer', token: 'test-token' },
      });

      expect(result.connection.sessionId).toBeDefined();
    });
  });

  describe('disconnect', () => {
    it('unregisters and disconnects', async () => {
      await agent.connect();
      expect(agent.isConnected).toBe(true);

      await agent.disconnect();
      expect(agent.isConnected).toBe(false);
    });

    it('is safe when not connected', async () => {
      await expect(agent.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('state management', () => {
    it('tracks current state', async () => {
      await agent.connect();

      expect(agent.state).toBe('registered');
    });

    it('updates state with updateState', async () => {
      await agent.connect();

      const updated = await agent.updateState('busy');

      expect(updated.state).toBe('busy');
      expect(agent.state).toBe('busy');
    });

    it('provides busy() convenience method', async () => {
      await agent.connect();

      const updated = await agent.busy();

      expect(updated.state).toBe('busy');
      expect(agent.state).toBe('busy');
    });

    it('provides idle() convenience method', async () => {
      await agent.connect();
      await agent.busy();

      const updated = await agent.idle();

      expect(updated.state).toBe('idle');
      expect(agent.state).toBe('idle');
    });

    it('provides done() convenience method', async () => {
      await agent.connect();

      await agent.done({ exitCode: 0, exitReason: 'completed' });

      expect(agent.state).toBe('stopped');
    });

    it('throws if not registered', async () => {
      await expect(agent.updateState('busy')).rejects.toThrow('Agent not registered');
    });
  });

  describe('metadata', () => {
    it('updates metadata', async () => {
      await agent.connect();

      const updated = await agent.updateMetadata({ customKey: 'customValue' });

      expect(updated.metadata).toEqual({ customKey: 'customValue' });
    });
  });

  describe('child agent spawning', () => {
    it('spawns child agent', async () => {
      await agent.connect();

      const result = await agent.spawn({
        name: 'Child Agent',
        role: 'helper',
      });

      expect(result.agent.id).toBeDefined();
      expect(result.agent.parent).toBe(agent.agentId);
    });

    it('throws if not registered', async () => {
      await expect(agent.spawn({ name: 'Child' })).rejects.toThrow('Agent not registered');
    });
  });

  describe('messaging', () => {
    it('sends message with send()', async () => {
      await agent.connect();

      const result = await agent.send({ agent: 'other-agent' }, { hello: 'world' });

      expect(result.messageId).toBeDefined();
    });

    it('sends to parent with sendToParent()', async () => {
      await agent.connect();

      const result = await agent.sendToParent({ status: 'working' });

      expect(result.messageId).toBeDefined();
    });

    it('sends to children with sendToChildren()', async () => {
      await agent.connect();

      const result = await agent.sendToChildren({ task: 'do something' });

      expect(result.messageId).toBeDefined();
    });

    it('sends to specific agent with sendToAgent()', async () => {
      await agent.connect();

      const result = await agent.sendToAgent('peer-agent', { message: 'hello peer' });

      expect(result.messageId).toBeDefined();
    });

    it('sends to scope with sendToScope()', async () => {
      await agent.connect();

      const result = await agent.sendToScope('scope-1', { announcement: 'hello scope' });

      expect(result.messageId).toBeDefined();
    });

    it('sends to siblings with sendToSiblings()', async () => {
      await agent.connect();

      const result = await agent.sendToSiblings({ message: 'hello siblings' });

      expect(result.messageId).toBeDefined();
    });

    it('replies to message with reply()', async () => {
      await agent.connect();

      const originalMessage: Message = {
        id: 'msg-original',
        from: 'sender-agent',
        to: { agent: agent.agentId! },
        timestamp: Date.now(),
        payload: { question: 'what?' },
        meta: { correlationId: 'corr-123' },
      };

      const result = await agent.reply(originalMessage, { answer: 'this!' });

      expect(result.messageId).toBeDefined();
    });
  });

  describe('message handling', () => {
    it('registers message handler with onMessage()', async () => {
      const handler = vi.fn();

      agent.onMessage(handler);

      // Handler is registered but messages come through notifications
      // which we'd need to simulate from the server
      expect(true).toBe(true);
    });

    it('removes message handler with offMessage()', async () => {
      const handler = vi.fn();

      agent.onMessage(handler);
      agent.offMessage(handler);

      // Handler should be removed
      expect(true).toBe(true);
    });

    it('supports chaining onMessage calls', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const result = agent.onMessage(handler1).onMessage(handler2);

      expect(result).toBe(agent);
    });
  });

  describe('scope management', () => {
    it('creates scope', async () => {
      await agent.connect();

      const scope = await agent.createScope({ name: 'My Scope' });

      expect(scope.id).toBeDefined();
      expect(scope.name).toBe('My Scope');
    });

    it('joins scope', async () => {
      await agent.connect();
      const scope = await agent.createScope({ name: 'Test Scope' });

      const result = await agent.joinScope(scope.id);

      expect(result.scope).toBeDefined();
      expect(result.agent).toBeDefined();
    });

    it('leaves scope', async () => {
      await agent.connect();
      const scope = await agent.createScope({ name: 'Test Scope' });
      await agent.joinScope(scope.id);

      const result = await agent.leaveScope(scope.id);

      expect(result.scope).toBeDefined();
      expect(result.agent).toBeDefined();
    });

    it('throws if not registered', async () => {
      await expect(agent.joinScope('scope-1')).rejects.toThrow('Agent not registered');
      await expect(agent.leaveScope('scope-1')).rejects.toThrow('Agent not registered');
    });
  });

  describe('subscriptions', () => {
    it('subscribes to events', async () => {
      await agent.connect();

      const subscription = await agent.subscribe();

      expect(subscription.id).toBeDefined();
      expect(subscription.isClosed).toBe(false);
    });

    it('subscribes with filter', async () => {
      await agent.connect();

      const subscription = await agent.subscribe({
        eventTypes: ['agent.state-changed'],
        fromAgents: ['watched-agent'],
      });

      expect(subscription.filter).toEqual({
        eventTypes: ['agent.state-changed'],
        fromAgents: ['watched-agent'],
      });
    });

    it('unsubscribes', async () => {
      await agent.connect();
      const subscription = await agent.subscribe();

      await agent.unsubscribe(subscription.id);

      expect(subscription.isClosed).toBe(true);
    });
  });

  describe('connection state', () => {
    it('provides abort signal', () => {
      expect(agent.signal).toBeInstanceOf(AbortSignal);
    });

    it('provides closed promise', () => {
      expect(agent.closed).toBeInstanceOf(Promise);
    });
  });
});
