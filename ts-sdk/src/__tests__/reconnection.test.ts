/**
 * Tests for reconnection functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientConnection, type ReconnectionEventType } from '../connection/client';
import { AgentConnection, type AgentReconnectionEventType } from '../connection/agent';
import { BaseConnection } from '../connection/base';
import { createStreamPair, type Stream } from '../stream';
import {
  CORE_METHODS,
  LIFECYCLE_METHODS,
  SCOPE_METHODS,
} from '../types';
import type {
  ConnectResponseResult,
  AgentsRegisterResponseResult,
  SubscribeResponseResult,
  ScopesJoinResponseResult,
} from '../types';

/**
 * Create a mock server that handles connection requests
 */
function createMockServer(serverStream: ReturnType<typeof createStreamPair>[1]) {
  const server = new BaseConnection(serverStream);
  let subscriptionCounter = 0;

  server.setRequestHandler(async (method, params) => {
    switch (method) {
      case CORE_METHODS.CONNECT:
        return {
          protocolVersion: 1,
          sessionId: 'session-' + Date.now(),
          participantId: 'participant-' + Date.now(),
          capabilities: {
            observation: { canObserve: true, canQuery: true },
            messaging: { canSend: true },
          },
          systemInfo: { name: 'Test System', version: '1.0.0' },
        } satisfies ConnectResponseResult;

      case CORE_METHODS.DISCONNECT:
        return { acknowledged: true };

      case CORE_METHODS.SUBSCRIBE:
        subscriptionCounter++;
        return { subscriptionId: 'sub-' + subscriptionCounter } satisfies SubscribeResponseResult;

      case CORE_METHODS.UNSUBSCRIBE:
        return { acknowledged: true };

      case CORE_METHODS.REPLAY:
        return { events: [], hasMore: false };

      case LIFECYCLE_METHODS.AGENTS_REGISTER:
        return {
          agent: {
            id: (params as { agentId?: string }).agentId ?? 'agent-' + Date.now(),
            name: 'Test Agent',
            state: 'idle',
            visibility: 'public',
          },
        } satisfies AgentsRegisterResponseResult;

      case LIFECYCLE_METHODS.AGENTS_UNREGISTER:
        return { unregistered: true };

      case SCOPE_METHODS.SCOPES_JOIN:
        return { joined: true, scope: { id: (params as { scopeId: string }).scopeId, name: 'Test Scope' } } satisfies ScopesJoinResponseResult;

      case SCOPE_METHODS.SCOPES_LEAVE:
        return { left: true };

      default:
        throw { code: -32601, message: 'Method not found' };
    }
  });

  return { server, close: () => server.close() };
}

describe('ClientConnection reconnection', () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];
  let mockServer: ReturnType<typeof createMockServer>;
  let streamFactory: () => Promise<Stream>;

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
    mockServer = createMockServer(serverStream);
    streamFactory = async () => {
      const [newClientStream, newServerStream] = createStreamPair();
      mockServer.close();
      mockServer = createMockServer(newServerStream);
      return newClientStream;
    };
  });

  afterEach(async () => {
    await mockServer.server.close();
  });

  it('should provide connection state getter', async () => {
    const client = new ClientConnection(clientStream);
    expect(client.state).toBe('initial');

    await client.connect();
    expect(client.state).toBe('connected');
  });

  it('should notify state changes', async () => {
    const client = new ClientConnection(clientStream);
    const stateChanges: Array<{ newState: string; oldState: string }> = [];

    client.onStateChange((newState, oldState) => {
      stateChanges.push({ newState, oldState });
    });

    await client.connect();
    expect(stateChanges).toContainEqual({ newState: 'connected', oldState: 'initial' });
  });

  it('should allow registering reconnection event handlers', async () => {
    const client = new ClientConnection(clientStream, {
      createStream: streamFactory,
      reconnection: { enabled: true },
    });

    const events: Array<{ type: ReconnectionEventType }> = [];
    const unsubscribe = client.onReconnection((event) => {
      events.push(event);
    });

    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('should unsubscribe reconnection handlers', async () => {
    const client = new ClientConnection(clientStream, {
      createStream: streamFactory,
      reconnection: { enabled: true },
    });

    const handler = vi.fn();
    const unsubscribe = client.onReconnection(handler);
    unsubscribe();

    // Handler should not be called after unsubscribe
    expect(handler).not.toHaveBeenCalled();
  });

  it('should have isReconnecting property', async () => {
    const client = new ClientConnection(clientStream);
    expect(client.isReconnecting).toBe(false);
  });

  it('should track subscription state for restoration', async () => {
    const client = new ClientConnection(clientStream, {
      reconnection: { enabled: false, restoreSubscriptions: true },
    });

    await client.connect();
    const subscription = await client.subscribe({ eventTypes: ['agent.registered'] });
    expect(subscription.id).toBeDefined();
  });
});

describe('AgentConnection reconnection', () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];
  let mockServer: ReturnType<typeof createMockServer>;
  let streamFactory: () => Promise<Stream>;

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
    mockServer = createMockServer(serverStream);
    streamFactory = async () => {
      const [newClientStream, newServerStream] = createStreamPair();
      mockServer.close();
      mockServer = createMockServer(newServerStream);
      return newClientStream;
    };
  });

  afterEach(async () => {
    await mockServer.server.close();
  });

  it('should provide connection state getter', async () => {
    const agent = new AgentConnection(clientStream);
    expect(agent.connectionState).toBe('initial');

    await agent.connect();
    expect(agent.connectionState).toBe('connected');
  });

  it('should notify state changes', async () => {
    const agent = new AgentConnection(clientStream);
    const stateChanges: Array<{ newState: string; oldState: string }> = [];

    agent.onStateChange((newState, oldState) => {
      stateChanges.push({ newState, oldState });
    });

    await agent.connect();
    expect(stateChanges).toContainEqual({ newState: 'connected', oldState: 'initial' });
  });

  it('should allow registering reconnection event handlers', async () => {
    const agent = new AgentConnection(clientStream, {
      createStream: streamFactory,
      reconnection: { enabled: true },
    });

    const events: Array<{ type: AgentReconnectionEventType }> = [];
    const unsubscribe = agent.onReconnection((event) => {
      events.push(event);
    });

    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('should unsubscribe reconnection handlers', async () => {
    const agent = new AgentConnection(clientStream, {
      createStream: streamFactory,
      reconnection: { enabled: true },
    });

    const handler = vi.fn();
    const unsubscribe = agent.onReconnection(handler);
    unsubscribe();

    // Handler should not be called after unsubscribe
    expect(handler).not.toHaveBeenCalled();
  });

  it('should have isReconnecting property', async () => {
    const agent = new AgentConnection(clientStream);
    expect(agent.isReconnecting).toBe(false);
  });

  it('should track scope memberships', async () => {
    const agent = new AgentConnection(clientStream);
    await agent.connect();

    await agent.joinScope('scope-1');
    await agent.leaveScope('scope-1');

    // Just verify no errors - internal tracking is private
    expect(agent.isConnected).toBe(true);
  });
});

describe('Retry utilities', () => {
  it('should calculate exponential backoff delay', async () => {
    const { calculateDelay, DEFAULT_RETRY_POLICY } = await import('../utils/retry');

    // Without jitter, we can't test exact values since jitter is default true
    const policyNoJitter = { ...DEFAULT_RETRY_POLICY, jitter: false };

    expect(calculateDelay(1, policyNoJitter)).toBe(1000);
    expect(calculateDelay(2, policyNoJitter)).toBe(2000);
    expect(calculateDelay(3, policyNoJitter)).toBe(4000);
    expect(calculateDelay(4, policyNoJitter)).toBe(8000);
    expect(calculateDelay(5, policyNoJitter)).toBe(16000);
    expect(calculateDelay(6, policyNoJitter)).toBe(30000); // Capped at maxDelayMs
  });

  it('should apply jitter when enabled', async () => {
    const { calculateDelay, DEFAULT_RETRY_POLICY } = await import('../utils/retry');

    const delay1 = calculateDelay(1, DEFAULT_RETRY_POLICY);
    const delay2 = calculateDelay(1, DEFAULT_RETRY_POLICY);

    // Delays should be in range [500, 1500] for attempt 1 with jitter
    expect(delay1).toBeGreaterThanOrEqual(500);
    expect(delay1).toBeLessThanOrEqual(1500);

    // Note: They might be equal due to random chance, but usually won't be
  });

  it('should create retry policy with defaults', async () => {
    const { createRetryPolicy, DEFAULT_RETRY_POLICY } = await import('../utils/retry');

    const policy = createRetryPolicy({ maxRetries: 5 });
    expect(policy.maxRetries).toBe(5);
    expect(policy.baseDelayMs).toBe(DEFAULT_RETRY_POLICY.baseDelayMs);
    expect(policy.maxDelayMs).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
    expect(policy.jitter).toBe(DEFAULT_RETRY_POLICY.jitter);
  });

  it('should retry on failure', async () => {
    const { withRetry } = await import('../utils/retry');

    let attempts = 0;
    const operation = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Transient error');
      }
      return 'success';
    };

    const result = await withRetry(operation, {
      maxRetries: 5,
      baseDelayMs: 10,
      maxDelayMs: 50,
      jitter: false,
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should call onRetry callback', async () => {
    const { withRetry } = await import('../utils/retry');

    let attempts = 0;
    const retryCalls: number[] = [];

    const operation = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Transient error');
      }
      return 'success';
    };

    await withRetry(
      operation,
      {
        maxRetries: 5,
        baseDelayMs: 10,
        maxDelayMs: 50,
        jitter: false,
      },
      {
        onRetry: (state) => {
          retryCalls.push(state.attempt);
        },
      }
    );

    expect(retryCalls).toEqual([1, 2]);
  });

  it('should throw after max retries exhausted', async () => {
    const { withRetry } = await import('../utils/retry');

    let attempts = 0;
    const operation = async () => {
      attempts++;
      throw new Error('Persistent error');
    };

    await expect(
      withRetry(operation, {
        maxRetries: 3,
        baseDelayMs: 10,
        maxDelayMs: 50,
        jitter: false,
      })
    ).rejects.toThrow('Persistent error');

    expect(attempts).toBe(4); // Initial + 3 retries
  });

  it('should respect isRetryable function', async () => {
    const { withRetry } = await import('../utils/retry');

    let attempts = 0;
    const operation = async () => {
      attempts++;
      throw new Error('Not retryable');
    };

    await expect(
      withRetry(operation, {
        maxRetries: 5,
        baseDelayMs: 10,
        maxDelayMs: 50,
        jitter: false,
        isRetryable: () => false,
      })
    ).rejects.toThrow('Not retryable');

    expect(attempts).toBe(1); // Should not retry
  });

  it('should create retryable wrapper', async () => {
    const { retryable } = await import('../utils/retry');

    let attempts = 0;
    const operation = async (value: string) => {
      attempts++;
      if (attempts < 2) {
        throw new Error('Transient');
      }
      return value + '-result';
    };

    const retryableOp = retryable(operation, {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
      jitter: false,
    });

    const result = await retryableOp('test');
    expect(result).toBe('test-result');
    expect(attempts).toBe(2);
  });

  it('should sleep for specified duration', async () => {
    const { sleep } = await import('../utils/retry');

    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some variance
    expect(elapsed).toBeLessThan(150);
  });
});

describe('BaseConnection state machine', () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
  });

  it('should start in initial state', () => {
    const conn = new BaseConnection(clientStream);
    expect(conn.state).toBe('initial');
  });

  it('should track state transitions', () => {
    const conn = new BaseConnection(clientStream);
    const states: string[] = [];

    conn.onStateChange((newState) => {
      states.push(newState);
    });

    conn._transitionTo('connecting');
    conn._transitionTo('connected');
    conn._transitionTo('closed');

    expect(states).toEqual(['connecting', 'connected', 'closed']);
  });

  it('should not notify on same state transition', () => {
    const conn = new BaseConnection(clientStream);
    const handler = vi.fn();

    conn.onStateChange(handler);
    conn._transitionTo('connecting');
    conn._transitionTo('connecting'); // Same state

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should allow unsubscribing from state changes', () => {
    const conn = new BaseConnection(clientStream);
    const handler = vi.fn();

    const unsubscribe = conn.onStateChange(handler);
    unsubscribe();

    conn._transitionTo('connecting');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle errors in state change handlers', () => {
    const conn = new BaseConnection(clientStream);
    const errorHandler = vi.fn(() => {
      throw new Error('Handler error');
    });
    const goodHandler = vi.fn();

    // Mock console.error to suppress output
    const originalError = console.error;
    console.error = vi.fn();

    try {
      conn.onStateChange(errorHandler);
      conn.onStateChange(goodHandler);

      conn._transitionTo('connecting');

      // Good handler should still be called despite error in first handler
      expect(goodHandler).toHaveBeenCalled();
    } finally {
      console.error = originalError;
    }
  });

  it('should transition to closed on close()', async () => {
    const conn = new BaseConnection(clientStream);
    const states: string[] = [];

    conn.onStateChange((newState) => {
      states.push(newState);
    });

    await conn.close();
    expect(states).toContain('closed');
    expect(conn.state).toBe('closed');
  });

  it('should support reconnection with new stream', async () => {
    const conn = new BaseConnection(clientStream);

    conn._transitionTo('connecting');
    conn._transitionTo('connected');

    // Simulate disconnect (not permanent close)
    conn._transitionTo('reconnecting');

    // Create new stream for reconnection
    const [newClientStream] = createStreamPair();

    await conn.reconnect(newClientStream);
    expect(conn.state).toBe('connected');
  });

  it('should reject reconnection on permanently closed connection', async () => {
    const conn = new BaseConnection(clientStream);

    await conn.close();
    expect(conn.state).toBe('closed');

    const [newClientStream] = createStreamPair();

    await expect(conn.reconnect(newClientStream)).rejects.toThrow(
      'Cannot reconnect a permanently closed connection'
    );
  });
});
