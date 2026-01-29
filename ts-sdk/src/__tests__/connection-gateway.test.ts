/**
 * Tests for GatewayConnection class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GatewayConnection } from '../connection/gateway';
import { BaseConnection } from '../connection/base';
import { createStreamPair } from '../stream';
import {
  CORE_METHODS,
  EXTENSION_METHODS,
  type ConnectResponseResult,
  type FederationConnectResponseResult,
  type FederationRouteResponseResult,
} from '../types';

/**
 * Mock server that handles gateway requests
 */
function createMockServer(serverStream: ReturnType<typeof createStreamPair>[1]) {
  const server = new BaseConnection(serverStream);
  const state = {
    connected: false,
    sessionId: 'gateway-session-123',
    connectedSystems: new Map<string, { name?: string; version?: string }>(),
  };

  server.setRequestHandler(async (method, params) => {
    switch (method) {
      case CORE_METHODS.CONNECT: {
        state.connected = true;
        return {
          protocolVersion: 1,
          sessionId: state.sessionId,
          participantId: 'gateway-123',
          capabilities: {
            messaging: { canSend: true, canReceive: true, canBroadcast: true },
          },
          systemInfo: { name: 'Local System', version: '1.0.0' },
        } satisfies ConnectResponseResult;
      }

      case CORE_METHODS.DISCONNECT:
        state.connected = false;
        return { acknowledged: true };

      case EXTENSION_METHODS.FEDERATION_CONNECT: {
        const { systemId, endpoint } = params as { systemId: string; endpoint: string };

        // Simulate successful connection to remote system
        state.connectedSystems.set(systemId, {
          name: `Remote System (${systemId})`,
          version: '2.0.0',
        });

        return {
          connected: true,
          systemInfo: {
            name: `Remote System (${systemId})`,
            version: '2.0.0',
          },
        } satisfies FederationConnectResponseResult;
      }

      case EXTENSION_METHODS.FEDERATION_ROUTE: {
        const { systemId, message } = params as { systemId: string; message: unknown };

        if (!state.connectedSystems.has(systemId)) {
          throw { code: -32000, message: 'System not connected' };
        }

        return {
          routed: true,
          messageId: `federated-msg-${Date.now()}`,
        } satisfies FederationRouteResponseResult;
      }

      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }
  });

  return { server, state };
}

describe('GatewayConnection', () => {
  let clientStream: ReturnType<typeof createStreamPair>[0];
  let serverStream: ReturnType<typeof createStreamPair>[1];
  let gateway: GatewayConnection;
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    [clientStream, serverStream] = createStreamPair();
    gateway = new GatewayConnection(clientStream, {
      name: 'Test Gateway',
    });
    mockServer = createMockServer(serverStream);
  });

  afterEach(async () => {
    await gateway.disconnect();
    await mockServer.server.close();
  });

  describe('connect', () => {
    it('connects to local MAP system', async () => {
      const result = await gateway.connect();

      expect(result.sessionId).toBe('gateway-session-123');
      expect(result.participantId).toBe('gateway-123');
      expect(gateway.isConnected).toBe(true);
      expect(gateway.sessionId).toBe('gateway-session-123');
    });

    it('stores server capabilities', async () => {
      await gateway.connect();

      expect(gateway.serverCapabilities).toBeDefined();
      expect(gateway.serverCapabilities?.messaging?.canSend).toBe(true);
    });

    it('supports authentication', async () => {
      const result = await gateway.connect({
        auth: { method: 'bearer', token: 'gateway-token' },
      });

      expect(result.sessionId).toBeDefined();
    });
  });

  describe('disconnect', () => {
    it('disconnects from local system', async () => {
      await gateway.connect();
      expect(gateway.isConnected).toBe(true);

      await gateway.disconnect();
      expect(gateway.isConnected).toBe(false);
    });

    it('accepts disconnect reason', async () => {
      await gateway.connect();
      await gateway.disconnect('shutdown');

      expect(gateway.isConnected).toBe(false);
    });

    it('is safe when not connected', async () => {
      await expect(gateway.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('connectToSystem', () => {
    it('connects to remote MAP system', async () => {
      await gateway.connect();

      const result = await gateway.connectToSystem(
        'remote-system-1',
        'wss://remote.example.com/map'
      );

      expect(result.connected).toBe(true);
      expect(result.systemInfo?.name).toContain('Remote System');
    });

    it('tracks connected systems', async () => {
      await gateway.connect();

      await gateway.connectToSystem('system-a', 'wss://a.example.com/map');
      await gateway.connectToSystem('system-b', 'wss://b.example.com/map');

      const systems = gateway.connectedSystems;
      expect(systems.size).toBe(2);
      expect(systems.has('system-a')).toBe(true);
      expect(systems.has('system-b')).toBe(true);
    });

    it('supports authentication to remote system', async () => {
      await gateway.connect();

      const result = await gateway.connectToSystem(
        'secure-system',
        'wss://secure.example.com/map',
        { method: 'api-key', credentials: 'secret-key' }
      );

      expect(result.connected).toBe(true);
    });
  });

  describe('routeToSystem', () => {
    it('routes message to connected remote system', async () => {
      await gateway.connect();
      await gateway.connectToSystem('remote-system', 'wss://remote.example.com/map');

      const result = await gateway.routeToSystem('remote-system', {
        id: 'msg-123',
        from: 'local-agent',
        to: { agent: 'remote-agent' },
        timestamp: Date.now(),
        payload: { hello: 'remote world' },
      });

      expect(result.routed).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('throws if system not connected', async () => {
      await gateway.connect();

      await expect(
        gateway.routeToSystem('unknown-system', {
          id: 'msg-123',
          from: 'local-agent',
          to: { agent: 'remote-agent' },
          timestamp: Date.now(),
        })
      ).rejects.toThrow();
    });
  });

  describe('isSystemConnected', () => {
    it('returns true for connected systems', async () => {
      await gateway.connect();
      await gateway.connectToSystem('system-1', 'wss://s1.example.com/map');

      expect(gateway.isSystemConnected('system-1')).toBe(true);
    });

    it('returns false for unconnected systems', async () => {
      await gateway.connect();

      expect(gateway.isSystemConnected('unknown-system')).toBe(false);
    });
  });

  describe('connectedSystems', () => {
    it('returns copy of connected systems map', async () => {
      await gateway.connect();
      await gateway.connectToSystem('system-1', 'wss://s1.example.com/map');

      const systems = gateway.connectedSystems;

      // Modifying the returned map shouldn't affect internal state
      systems.delete('system-1');
      expect(gateway.isSystemConnected('system-1')).toBe(true);
    });

    it('returns empty map when no systems connected', async () => {
      await gateway.connect();

      expect(gateway.connectedSystems.size).toBe(0);
    });
  });

  describe('connection state', () => {
    it('provides abort signal', () => {
      expect(gateway.signal).toBeInstanceOf(AbortSignal);
    });

    it('provides closed promise', () => {
      expect(gateway.closed).toBeInstanceOf(Promise);
    });

    it('signal aborts on disconnect', async () => {
      await gateway.connect();

      const abortPromise = new Promise((resolve) => {
        gateway.signal.addEventListener('abort', resolve);
      });

      await gateway.disconnect();

      await expect(abortPromise).resolves.toBeDefined();
    });
  });
});
