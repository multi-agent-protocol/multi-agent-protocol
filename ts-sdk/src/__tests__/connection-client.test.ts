/**
 * Tests for ClientConnection class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientConnection } from '../connection/client';
import { BaseConnection } from '../connection/base';
import { createStreamPair } from '../stream';
import { CORE_METHODS, STRUCTURE_METHODS, EXTENSION_METHODS, NOTIFICATION_METHODS } from '../types';
import type {
  ConnectRequestParams,
  ConnectResponseResult,
  AgentsListResponseResult,
  AgentsGetResponseResult,
  SendResponseResult,
  SubscribeResponseResult,
  ScopesListResponseResult,
} from '../types';

/**
 * Mock server that handles client requests
 */
function createMockServer(serverStream: ReturnType<typeof createStreamPair>[1]) {
  const server = new BaseConnection(serverStream);
  const state = {
    connected: false,
    sessionId: 'test-session-123',
    agents: [
      { id: 'agent-1', name: 'Agent One', state: 'idle' as const },
      { id: 'agent-2', name: 'Agent Two', state: 'busy' as const },
    ],
    scopes: [{ id: 'scope-1', name: 'Main Scope' }],
    subscriptions: new Map<string, { filter?: unknown }>(),
  };

  server.setRequestHandler(async (method, params) => {
    switch (method) {
      case CORE_METHODS.CONNECT: {
        state.connected = true;
        return {
          protocolVersion: 1,
          sessionId: state.sessionId,
          participantId: 'client-123',
          capabilities: {
            observation: { canObserve: true, canQuery: true },
            messaging: { canSend: true },
          },
          systemInfo: { name: 'Test System', version: '1.0.0' },
        } satisfies ConnectResponseResult;
      }

      case CORE_METHODS.DISCONNECT:
        state.connected = false;
        return { acknowledged: true };

      case CORE_METHODS.AGENTS_LIST:
        return { agents: state.agents } satisfies AgentsListResponseResult;

      case CORE_METHODS.AGENTS_GET: {
        const { agentId } = params as { agentId: string };
        const agent = state.agents.find((a) => a.id === agentId);
        if (!agent) {
          throw { code: -32004, message: 'Agent not found' };
        }
        return { agent } satisfies AgentsGetResponseResult;
      }

      case CORE_METHODS.SEND:
        return {
          messageId: 'msg-' + Date.now(),
          delivered: ['agent-1'],
        } satisfies SendResponseResult;

      case CORE_METHODS.SUBSCRIBE: {
        const subscriptionId = 'sub-' + Date.now();
        state.subscriptions.set(subscriptionId, { filter: (params as { filter?: unknown })?.filter });
        return { subscriptionId } satisfies SubscribeResponseResult;
      }

      case CORE_METHODS.UNSUBSCRIBE: {
        const { subscriptionId } = params as { subscriptionId: string };
        state.subscriptions.delete(subscriptionId);
        return { acknowledged: true };
      }

      case STRUCTURE_METHODS.SCOPES_LIST:
        return { scopes: state.scopes } satisfies ScopesListResponseResult;

      case STRUCTURE_METHODS.AGENTS_STOP:
        return { stopping: true };

      case EXTENSION_METHODS.INJECT:
        return { injected: true };

      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }
  });

  return { server, state };
}

describe('ClientConnection', () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];
  let client: ClientConnection;
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
    client = new ClientConnection(clientStream, {
      name: 'Test Client',
    });
    mockServer = createMockServer(serverStream);
  });

  afterEach(async () => {
    await client.disconnect();
    await mockServer.server.close();
  });

  describe('connect', () => {
    it('establishes connection and returns session info', async () => {
      const result = await client.connect();

      expect(result.sessionId).toBe('test-session-123');
      expect(result.participantId).toBe('client-123');
      expect(result.systemInfo).toBeDefined();
      expect(client.isConnected).toBe(true);
      expect(client.sessionId).toBe('test-session-123');
    });

    it('stores server capabilities', async () => {
      await client.connect();

      expect(client.serverCapabilities).toBeDefined();
      expect(client.serverCapabilities?.observation?.canObserve).toBe(true);
    });

    it('supports authentication', async () => {
      const result = await client.connect({
        auth: { method: 'bearer', token: 'test-token' },
      });

      expect(result.sessionId).toBeDefined();
    });
  });

  describe('disconnect', () => {
    it('disconnects from the system', async () => {
      await client.connect();
      expect(client.isConnected).toBe(true);

      await client.disconnect();
      expect(client.isConnected).toBe(false);
    });

    it('accepts disconnect reason', async () => {
      await client.connect();
      await client.disconnect('user requested');

      expect(client.isConnected).toBe(false);
    });

    it('is safe to call when not connected', async () => {
      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('listAgents', () => {
    it('returns list of agents', async () => {
      await client.connect();

      const result = await client.listAgents();

      expect(result.agents).toHaveLength(2);
      expect(result.agents[0].id).toBe('agent-1');
      expect(result.agents[1].id).toBe('agent-2');
    });

    it('supports filtering by states', async () => {
      await client.connect();

      const result = await client.listAgents({ states: ['idle'] });

      // Server doesn't filter in mock, just verify the call works
      expect(result.agents).toBeDefined();
    });

    it('supports filtering by roles', async () => {
      await client.connect();

      const result = await client.listAgents({ roles: ['worker'] });

      expect(result.agents).toBeDefined();
    });

    it('supports filtering by scopes', async () => {
      await client.connect();

      const result = await client.listAgents({ scopes: ['scope-1'] });

      expect(result.agents).toBeDefined();
    });
  });

  describe('getAgent', () => {
    it('returns agent by ID', async () => {
      await client.connect();

      const agent = await client.getAgent('agent-1');

      expect(agent.id).toBe('agent-1');
      expect(agent.name).toBe('Agent One');
    });

    it('throws if agent not found', async () => {
      await client.connect();

      await expect(client.getAgent('nonexistent')).rejects.toThrow();
    });
  });

  describe('send', () => {
    it('sends message to address', async () => {
      await client.connect();

      const result = await client.send({ agent: 'agent-1' }, { hello: 'world' });

      expect(result.messageId).toBeDefined();
      expect(result.delivered).toContain('agent-1');
    });

    it('sends message with metadata', async () => {
      await client.connect();

      const result = await client.send(
        { agent: 'agent-1' },
        { data: 'test' },
        { priority: 'high', correlationId: 'corr-123' }
      );

      expect(result.messageId).toBeDefined();
    });
  });

  describe('sendToAgent', () => {
    it('sends message directly to agent', async () => {
      await client.connect();

      const result = await client.sendToAgent('agent-1', { message: 'hello' });

      expect(result.messageId).toBeDefined();
    });
  });

  describe('sendToScope', () => {
    it('sends message to all agents in scope', async () => {
      await client.connect();

      const result = await client.sendToScope('scope-1', { announcement: 'hello all' });

      expect(result.messageId).toBeDefined();
    });
  });

  describe('broadcast', () => {
    it('sends message to all agents', async () => {
      await client.connect();

      const result = await client.broadcast({ system: 'announcement' });

      expect(result.messageId).toBeDefined();
    });
  });

  describe('subscribe', () => {
    it('creates subscription and returns Subscription object', async () => {
      await client.connect();

      const subscription = await client.subscribe();

      expect(subscription.id).toBeDefined();
      expect(subscription.isClosed).toBe(false);
    });

    it('supports event type filter', async () => {
      await client.connect();

      const subscription = await client.subscribe({
        eventTypes: ['agent.registered', 'agent.state-changed'],
      });

      expect(subscription.filter?.eventTypes).toEqual([
        'agent.registered',
        'agent.state-changed',
      ]);
    });

    it('supports scope filter', async () => {
      await client.connect();

      const subscription = await client.subscribe({
        scopes: ['scope-1'],
      });

      expect(subscription.filter?.scopes).toEqual(['scope-1']);
    });

    it('supports agent filter', async () => {
      await client.connect();

      const subscription = await client.subscribe({
        agents: ['agent-1', 'agent-2'],
      });

      expect(subscription.filter?.agents).toEqual(['agent-1', 'agent-2']);
    });

    it('can unsubscribe', async () => {
      await client.connect();

      const subscription = await client.subscribe();
      expect(subscription.isClosed).toBe(false);

      await subscription.unsubscribe();
      expect(subscription.isClosed).toBe(true);
    });
  });

  describe('listScopes', () => {
    it('returns list of scopes', async () => {
      await client.connect();

      const result = await client.listScopes();

      expect(result.scopes).toHaveLength(1);
      expect(result.scopes[0].id).toBe('scope-1');
    });
  });

  describe('stopAgent', () => {
    it('requests agent to stop', async () => {
      await client.connect();

      const result = await client.stopAgent('agent-1');
      expect(result.stopping).toBe(true);
    });

    it('supports stop reason', async () => {
      await client.connect();

      const result = await client.stopAgent('agent-1', { reason: 'task complete' });
      expect(result.stopping).toBe(true);
    });
  });

  describe('inject', () => {
    it('injects context into agent', async () => {
      await client.connect();

      const result = await client.inject('agent-1', { instruction: 'prioritize task X' });
      expect(result.injected).toBe(true);
    });

    it('supports injection delivery mode', async () => {
      await client.connect();

      const result = await client.inject('agent-1', { data: 'context' }, 'interrupt');
      expect(result.injected).toBe(true);
    });
  });

  describe('connection state', () => {
    it('provides abort signal', async () => {
      expect(client.signal).toBeInstanceOf(AbortSignal);
      expect(client.signal.aborted).toBe(false);
    });

    it('provides closed promise', async () => {
      expect(client.closed).toBeInstanceOf(Promise);
    });

    it('aborts signal on disconnect', async () => {
      await client.connect();

      const abortPromise = new Promise((resolve) => {
        client.signal.addEventListener('abort', resolve);
      });

      await client.disconnect();

      await expect(abortPromise).resolves.toBeDefined();
    });
  });
});
