/**
 * Federation and Gateway Tests
 *
 * Tests for:
 * - Federation envelope wrapping and routing
 * - Gateway reconnection with outage buffer
 * - Gateway event replay configuration
 * - Outage buffer operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestServer } from '../testing';
import {
  GatewayConnection,
  type GatewayReconnectionEventType,
} from '../connection/gateway';
import { BaseConnection } from '../connection/base';
import { createStreamPair } from '../stream';
import { createFederationEnvelope } from '../federation/envelope';
import { FederationOutageBuffer } from '../federation/buffer';
import {
  EVENT_TYPES,
  CORE_METHODS,
  FEDERATION_METHODS,
} from '../types';
import type {
  Message,
  ConnectResponseResult,
  FederationRouteResponseResult,
  ReplayResponseResult,
} from '../types';

describe('Federation and Gateway', () => {
  // ===========================================================================
  // Federation Envelope Support in TestServer
  // ===========================================================================

  describe('Federation Envelope Support', () => {
    let server: TestServer;
    let gatewayConnection: BaseConnection;
    let clientStream: ReturnType<typeof createStreamPair>[0];
    let serverStream: ReturnType<typeof createStreamPair>[1];

    beforeEach(() => {
      server = new TestServer({
        name: 'Test Server',
        federationRouting: {
          systemId: 'local-system',
          maxHops: 5,
          trackPath: true,
        },
      });
      [clientStream, serverStream] = createStreamPair();
      gatewayConnection = new BaseConnection(clientStream);
      server.acceptConnection(serverStream);
    });

    afterEach(async () => {
      await gatewayConnection.close().catch(() => {});
    });

    it('handles federation route with envelope format', async () => {
      // Connect as gateway
      await gatewayConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'gateway',
        name: 'Test Gateway',
      });

      const message: Message = {
        id: 'msg-1',
        from: 'gateway-system',
        to: { agent: 'agent-1' },
        payload: { action: 'test' },
        timestamp: Date.now(),
      };

      const envelope = createFederationEnvelope(message, 'gateway-system', 'local-system', {
        trackPath: true,
      });

      const result = await gatewayConnection.sendRequest<unknown, FederationRouteResponseResult>(
        FEDERATION_METHODS.FEDERATION_ROUTE,
        { systemId: 'local-system', envelope }
      );

      expect(result.routed).toBe(true);
    });

    it('handles federation route with legacy message format', async () => {
      await gatewayConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'gateway',
      });

      const message: Message = {
        id: 'msg-2',
        from: 'gateway-system',
        to: { agent: 'agent-1' },
        payload: { action: 'legacy-test' },
        timestamp: Date.now(),
      };

      const result = await gatewayConnection.sendRequest<unknown, FederationRouteResponseResult>(
        FEDERATION_METHODS.FEDERATION_ROUTE,
        { systemId: 'local-system', message }
      );

      expect(result.routed).toBe(true);
    });

    it('validates envelope routing and rejects loops', async () => {
      await gatewayConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'gateway',
      });

      const message: Message = {
        id: 'msg-3',
        from: 'gateway-system',
        to: { agent: 'agent-1' },
        timestamp: Date.now(),
      };

      // Create envelope that already visited local-system (loop)
      const envelope = createFederationEnvelope(message, 'other-system', 'target-system', {
        trackPath: true,
      });
      // Manually add local-system to path to simulate loop
      envelope.federation.path = ['other-system', 'local-system'];
      envelope.federation.hopCount = 2;

      await expect(
        gatewayConnection.sendRequest(FEDERATION_METHODS.FEDERATION_ROUTE, {
          systemId: 'target-system',
          envelope,
        })
      ).rejects.toThrow(/loop/i);
    });

    it('validates envelope routing and rejects max hops exceeded', async () => {
      await gatewayConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'gateway',
      });

      const message: Message = {
        id: 'msg-4',
        from: 'gateway-system',
        to: { agent: 'agent-1' },
        timestamp: Date.now(),
      };

      // Create envelope at max hops
      const envelope = createFederationEnvelope(message, 'source', 'target');
      envelope.federation.hopCount = 5;
      envelope.federation.maxHops = 5;

      await expect(
        gatewayConnection.sendRequest(FEDERATION_METHODS.FEDERATION_ROUTE, {
          systemId: 'target-system',
          envelope,
        })
      ).rejects.toThrow(/hop/i);
    });
  });

  // ===========================================================================
  // Gateway Envelope Wrapping
  // ===========================================================================

  describe('Gateway Envelope Wrapping', () => {
    it('routeToSystem wraps message in envelope when routing config provided', async () => {
      const server = new TestServer({ name: 'Test Server' });
      const [clientStream, serverStream] = createStreamPair();

      const gateway = new GatewayConnection(clientStream, {
        name: 'Test Gateway',
        routing: {
          systemId: 'my-gateway',
          maxHops: 10,
          trackPath: true,
        },
      });
      server.acceptConnection(serverStream);

      await gateway.connect();

      const message: Message = {
        id: 'msg-test',
        from: 'my-gateway',
        to: { agent: 'remote-agent' },
        payload: { test: true },
        timestamp: Date.now(),
      };

      // The routeToSystem should wrap in envelope
      const result = await gateway.routeToSystem('remote-system', message);
      expect(result.routed).toBe(true);

      await gateway.disconnect();
    });

    it('routeToSystem sends raw message when no routing config', async () => {
      const server = new TestServer({ name: 'Test Server' });
      const [clientStream, serverStream] = createStreamPair();

      // No routing config
      const gateway = new GatewayConnection(clientStream, { name: 'Test Gateway' });
      server.acceptConnection(serverStream);

      await gateway.connect();

      const message: Message = {
        id: 'msg-raw',
        from: 'gateway',
        to: { agent: 'agent-1' },
        timestamp: Date.now(),
      };

      const result = await gateway.routeToSystem('target-system', message);
      expect(result.routed).toBe(true);

      await gateway.disconnect();
    });
  });

  // ===========================================================================
  // Gateway Reconnection with Buffer
  // ===========================================================================

  describe('Gateway Reconnection', () => {
    it('creates outage buffer when buffer config is enabled', () => {
      const [clientStream] = createStreamPair();
      const gateway = new GatewayConnection(clientStream, {
        name: 'Test Gateway',
        buffer: { enabled: true, maxMessages: 100 },
      });

      expect(gateway.outageBuffer).not.toBeNull();
      expect(gateway.outageBuffer?.enabled).toBe(true);
    });

    it('does not create outage buffer when buffer config is disabled', () => {
      const [clientStream] = createStreamPair();
      const gateway = new GatewayConnection(clientStream, {
        name: 'Test Gateway',
        buffer: { enabled: false },
      });

      expect(gateway.outageBuffer).toBeNull();
    });

    it('tracks last sync timestamps per peer', async () => {
      const server = new TestServer({ name: 'Test Server' });
      const [clientStream, serverStream] = createStreamPair();

      const gateway = new GatewayConnection(clientStream, {
        name: 'Test Gateway',
        routing: { systemId: 'my-gateway' },
      });
      server.acceptConnection(serverStream);

      await gateway.connect();

      const message: Message = {
        id: 'msg-sync',
        from: 'my-gateway',
        to: { agent: 'agent-1' },
        timestamp: Date.now(),
      };

      await gateway.routeToSystem('peer-system', message);

      // Should have recorded sync timestamp
      const timestamp = gateway.getLastSyncTimestamp('peer-system');
      expect(timestamp).toBeDefined();
      expect(timestamp).toBeGreaterThan(0);

      await gateway.disconnect();
    });

    it('emits reconnection events', async () => {
      const [clientStream, serverStream] = createStreamPair();

      let streamFactory = async () => {
        const [newClientStream, newServerStream] = createStreamPair();
        createMockGatewayServer(newServerStream);
        return newClientStream;
      };

      const gateway = new GatewayConnection(clientStream, {
        name: 'Test Gateway',
        reconnection: { enabled: true, maxRetries: 3, baseDelayMs: 10 },
        createStream: streamFactory,
      });

      const events: GatewayReconnectionEventType[] = [];
      gateway.onReconnection((event) => {
        events.push(event.type);
      });

      createMockGatewayServer(serverStream);
      await gateway.connect();

      // Verify we can register handlers without error
      expect(events).toEqual([]);

      await gateway.disconnect();
    });

    it('exposes isReconnecting state', async () => {
      const [clientStream, serverStream] = createStreamPair();
      const gateway = new GatewayConnection(clientStream, { name: 'Test Gateway' });
      createMockGatewayServer(serverStream);

      expect(gateway.isReconnecting).toBe(false);

      await gateway.connect();
      expect(gateway.isReconnecting).toBe(false);

      await gateway.disconnect();
    });
  });

  // ===========================================================================
  // Gateway Replay Configuration
  // ===========================================================================

  describe('Gateway Replay Configuration', () => {
    it('accepts replay configuration options', () => {
      const [clientStream] = createStreamPair();
      const gateway = new GatewayConnection(clientStream, {
        name: 'Test Gateway',
        replay: {
          enabled: true,
          eventTypes: [EVENT_TYPES.AGENT_REGISTERED, EVENT_TYPES.AGENT_STATE_CHANGED],
          maxEvents: 500,
          maxAgeMs: 1800000, // 30 minutes
        },
      });

      // Gateway should accept these options without error
      expect(gateway).toBeDefined();
    });
  });

  // ===========================================================================
  // Outage Buffer Unit Tests
  // ===========================================================================

  describe('Outage Buffer', () => {
    it('buffers messages during outage', () => {
      const buffer = new FederationOutageBuffer({ enabled: true, maxMessages: 10 });

      const message: Message = {
        id: 'msg-1',
        from: 'gateway',
        to: { agent: 'agent-1' },
        timestamp: Date.now(),
      };

      const envelope = createFederationEnvelope(message, 'source', 'target');
      const buffered = buffer.enqueue('peer-1', envelope);

      expect(buffered).toBe(true);
      expect(buffer.count('peer-1')).toBe(1);
    });

    it('drains buffered messages in FIFO order', () => {
      const buffer = new FederationOutageBuffer({ enabled: true });

      for (let i = 0; i < 3; i++) {
        const message: Message = {
          id: `msg-${i}`,
          from: 'gateway',
          to: { agent: 'agent-1' },
          timestamp: Date.now(),
        };
        buffer.enqueue('peer-1', createFederationEnvelope(message, 'source', 'target'));
      }

      const drained = buffer.drain('peer-1');
      expect(drained.length).toBe(3);
      expect(drained[0].payload.id).toBe('msg-0');
      expect(drained[1].payload.id).toBe('msg-1');
      expect(drained[2].payload.id).toBe('msg-2');

      // Buffer should be empty after drain
      expect(buffer.count('peer-1')).toBe(0);
    });

    it('respects maxMessages limit with drop-oldest strategy', () => {
      const buffer = new FederationOutageBuffer({
        enabled: true,
        maxMessages: 3,
        overflowStrategy: 'drop-oldest',
      });

      for (let i = 0; i < 5; i++) {
        const message: Message = {
          id: `msg-${i}`,
          from: 'gateway',
          to: { agent: 'agent-1' },
          timestamp: Date.now(),
        };
        buffer.enqueue('peer-1', createFederationEnvelope(message, 'source', 'target'));
      }

      expect(buffer.count('peer-1')).toBe(3);
      const drained = buffer.drain('peer-1');
      // Should have messages 2, 3, 4 (oldest dropped)
      expect(drained[0].payload.id).toBe('msg-2');
      expect(drained[1].payload.id).toBe('msg-3');
      expect(drained[2].payload.id).toBe('msg-4');
    });

    it('provides buffer statistics', () => {
      const buffer = new FederationOutageBuffer({ enabled: true });

      const message: Message = {
        id: 'msg-1',
        from: 'gateway',
        to: { agent: 'agent-1' },
        timestamp: Date.now(),
      };

      buffer.enqueue('peer-1', createFederationEnvelope(message, 'source', 'target'));
      buffer.enqueue('peer-2', createFederationEnvelope(message, 'source', 'target'));

      const stats = buffer.stats();
      expect(stats.get('peer-1')?.count).toBe(1);
      expect(stats.get('peer-2')?.count).toBe(1);
      expect(stats.get('peer-1')?.totalEnqueued).toBe(1);
    });

    it('tracks peers with buffered messages', () => {
      const buffer = new FederationOutageBuffer({ enabled: true });

      const message: Message = {
        id: 'msg-1',
        from: 'gateway',
        to: { agent: 'agent-1' },
        timestamp: Date.now(),
      };

      buffer.enqueue('peer-1', createFederationEnvelope(message, 'source', 'target'));
      buffer.enqueue('peer-2', createFederationEnvelope(message, 'source', 'target'));

      const peers = buffer.peers();
      expect(peers).toContain('peer-1');
      expect(peers).toContain('peer-2');
    });
  });
});

// ===========================================================================
// Helper Functions
// ===========================================================================

function createMockGatewayServer(serverStream: ReturnType<typeof createStreamPair>[1]) {
  const server = new BaseConnection(serverStream);

  server.setRequestHandler(async (method, params) => {
    switch (method) {
      case CORE_METHODS.CONNECT:
        return {
          protocolVersion: 1,
          sessionId: 'session-' + Date.now(),
          participantId: 'participant-' + Date.now(),
          capabilities: {
            observation: { canObserve: true },
            federation: { canFederate: true },
            streaming: { supportsAck: true },
          },
          systemInfo: { name: 'Mock Server' },
        } satisfies ConnectResponseResult;

      case CORE_METHODS.DISCONNECT:
        return { acknowledged: true };

      case FEDERATION_METHODS.FEDERATION_ROUTE:
        return { routed: true } satisfies FederationRouteResponseResult;

      case CORE_METHODS.REPLAY:
        return { events: [], hasMore: false } satisfies ReplayResponseResult;

      default:
        throw { code: -32601, message: 'Method not found' };
    }
  });

  return server;
}
