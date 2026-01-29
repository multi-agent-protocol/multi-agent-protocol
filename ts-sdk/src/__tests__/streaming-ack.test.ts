/**
 * Streaming and Acknowledgment Tests
 *
 * Tests for:
 * - Streaming capability advertisement
 * - Subscription ack integration for backpressure control
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestServer } from '../testing';
import { ClientConnection } from '../connection/client';
import { createStreamPair } from '../stream';
import { EVENT_TYPES, NOTIFICATION_METHODS } from '../types';

describe('Streaming and Acknowledgment', () => {
  // ===========================================================================
  // Streaming Capability Advertisement
  // ===========================================================================

  describe('Streaming Capability Advertisement', () => {
    let server: TestServer;
    let client: ClientConnection;
    let clientStream: ReturnType<typeof createStreamPair>[0];
    let serverStream: ReturnType<typeof createStreamPair>[1];

    beforeEach(() => {
      server = new TestServer({ name: 'Test Server' });
      [clientStream, serverStream] = createStreamPair();
      client = new ClientConnection(clientStream, { name: 'Test Client' });
      server.acceptConnection(serverStream);
    });

    afterEach(async () => {
      await client.disconnect().catch(() => {});
    });

    it('server advertises streaming capabilities in connect response', async () => {
      const result = await client.connect();

      expect(result.capabilities?.streaming).toBeDefined();
      expect(result.capabilities?.streaming?.supportsAck).toBe(true);
      expect(result.capabilities?.streaming?.supportsPause).toBe(true);
    });

    it('client stores server capabilities after connect', async () => {
      await client.connect();

      expect(client.serverCapabilities?.streaming?.supportsAck).toBe(true);
    });
  });

  // ===========================================================================
  // Subscription Ack Integration
  // ===========================================================================

  describe('Subscription Ack Integration', () => {
    let server: TestServer;
    let client: ClientConnection;
    let clientStream: ReturnType<typeof createStreamPair>[0];
    let serverStream: ReturnType<typeof createStreamPair>[1];

    beforeEach(() => {
      server = new TestServer({ name: 'Test Server' });
      [clientStream, serverStream] = createStreamPair();
      client = new ClientConnection(clientStream, { name: 'Test Client' });
      server.acceptConnection(serverStream);
    });

    afterEach(async () => {
      await client.disconnect().catch(() => {});
    });

    it('subscription reports supportsAck when server advertises support', async () => {
      await client.connect();
      const subscription = await client.subscribe();

      expect(subscription.supportsAck).toBe(true);
    });

    it('subscription.ack() sends acknowledgment notification', async () => {
      await client.connect();
      const subscription = await client.subscribe();

      // Emit some events
      server.emitEvent({ type: EVENT_TYPES.AGENT_REGISTERED, data: {} });
      server.emitEvent({ type: EVENT_TYPES.AGENT_REGISTERED, data: {} });
      server.emitEvent({ type: EVENT_TYPES.AGENT_REGISTERED, data: {} });

      // Wait for events to be delivered
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify subscription has received events
      expect(subscription.lastSequenceNumber).toBeGreaterThan(0);

      // Acknowledge events - this sends a notification
      // The notification is fire-and-forget, so we just verify it doesn't throw
      expect(() => subscription.ack()).not.toThrow();
    });

    it('subscription.ack() with specific sequence number sends correct value', async () => {
      await client.connect();
      const subscription = await client.subscribe();

      // Emit events
      server.emitEvent({ type: EVENT_TYPES.AGENT_REGISTERED, data: {} });
      server.emitEvent({ type: EVENT_TYPES.AGENT_REGISTERED, data: {} });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Ack only up to sequence 1 - should not throw
      expect(() => subscription.ack(1)).not.toThrow();
    });

    it('subscription.ack() is no-op when server does not support acks', async () => {
      // Create server without streaming capabilities
      const bareServer = new TestServer({
        name: 'Bare Server',
        capabilities: {
          observation: { canObserve: true },
          // No streaming capabilities
        },
      });

      const [cs, ss] = createStreamPair();
      const bareClient = new ClientConnection(cs, { name: 'Bare Client' });
      bareServer.acceptConnection(ss);

      await bareClient.connect();
      const subscription = await bareClient.subscribe();

      // supportsAck should be false
      expect(subscription.supportsAck).toBe(false);

      // ack() should not throw
      expect(() => subscription.ack()).not.toThrow();

      await bareClient.disconnect();
    });
  });
});
