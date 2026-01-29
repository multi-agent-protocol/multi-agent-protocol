/**
 * Permission Update Tests
 *
 * Tests for:
 * - Client permission updates via map/permissions/update
 * - Agent permission updates via map/agents/update with permissionOverrides
 * - Permission events (permissions_client_updated, permissions_agent_updated)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestServer } from '../testing';
import { ClientConnection } from '../connection/client';
import { BaseConnection } from '../connection/base';
import { createStreamPair } from '../stream';
import {
  EVENT_TYPES,
  CORE_METHODS,
  PERMISSION_METHODS,
  NOTIFICATION_METHODS,
  STATE_METHODS,
  LIFECYCLE_METHODS,
} from '../types';
import type {
  Event,
  ConnectResponseResult,
  PermissionsUpdateResponseResult,
  AgentsUpdateResponseResult,
  SubscribeResponseResult,
} from '../types';

describe('Permission Updates', () => {
  // ===========================================================================
  // Client Permission Updates
  // ===========================================================================

  describe('Client Permission Updates', () => {
    let server: TestServer;
    let adminConnection: BaseConnection;
    let clientConnection: ClientConnection;
    let adminStream: ReturnType<typeof createStreamPair>[0];
    let adminServerStream: ReturnType<typeof createStreamPair>[1];
    let clientStream: ReturnType<typeof createStreamPair>[0];
    let clientServerStream: ReturnType<typeof createStreamPair>[1];

    beforeEach(() => {
      server = new TestServer({ name: 'Test Server' });

      // Admin connection (raw BaseConnection to make permission updates)
      [adminStream, adminServerStream] = createStreamPair();
      adminConnection = new BaseConnection(adminStream);
      server.acceptConnection(adminServerStream);

      // Client connection
      [clientStream, clientServerStream] = createStreamPair();
      clientConnection = new ClientConnection(clientStream, { name: 'Test Client' });
      server.acceptConnection(clientServerStream);
    });

    afterEach(async () => {
      await adminConnection.close().catch(() => {});
      await clientConnection.disconnect().catch(() => {});
    });

    it('updates client permissions via map/permissions/update', async () => {
      // Connect admin
      const adminResult = await adminConnection.sendRequest<unknown, ConnectResponseResult>(
        CORE_METHODS.CONNECT,
        { protocolVersion: 1, participantType: 'client', name: 'Admin' }
      );

      // Connect client
      const clientResult = await clientConnection.connect();

      // Update client permissions
      const updateResult = await adminConnection.sendRequest<unknown, PermissionsUpdateResponseResult>(
        PERMISSION_METHODS.PERMISSIONS_UPDATE,
        {
          clientId: clientResult.participantId,
          permissions: {
            messaging: { canBroadcast: false },
            lifecycle: { canSpawn: true },
          },
        }
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.effectivePermissions.messaging?.canBroadcast).toBe(false);
      expect(updateResult.effectivePermissions.lifecycle?.canSpawn).toBe(true);
    });

    it('emits permissions_client_updated event on permission change', async () => {
      // Connect admin and subscribe to events
      await adminConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'client',
        name: 'Admin',
      });

      const subResult = await adminConnection.sendRequest<unknown, SubscribeResponseResult>(
        CORE_METHODS.SUBSCRIBE,
        { filter: { eventTypes: [EVENT_TYPES.PERMISSIONS_CLIENT_UPDATED] } }
      );

      // Connect client
      const clientResult = await clientConnection.connect();

      // Collect events
      const events: Event[] = [];
      adminConnection.setNotificationHandler((method, params) => {
        if (method === NOTIFICATION_METHODS.EVENT) {
          events.push((params as { event: Event }).event);
        }
      });

      // Update permissions
      await adminConnection.sendRequest(PERMISSION_METHODS.PERMISSIONS_UPDATE, {
        clientId: clientResult.participantId,
        permissions: { observation: { canQuery: false } },
      });

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.some((e) => e.type === EVENT_TYPES.PERMISSIONS_CLIENT_UPDATED)).toBe(true);
      const permEvent = events.find((e) => e.type === EVENT_TYPES.PERMISSIONS_CLIENT_UPDATED);
      expect(permEvent?.data?.clientId).toBe(clientResult.participantId);
    });

    it('rejects permission update for non-existent client', async () => {
      await adminConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'client',
      });

      await expect(
        adminConnection.sendRequest(PERMISSION_METHODS.PERMISSIONS_UPDATE, {
          clientId: 'non-existent-client',
          permissions: { messaging: { canSend: false } },
        })
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Agent Permission Updates
  // ===========================================================================

  describe('Agent Permission Updates', () => {
    let server: TestServer;
    let agentConnection: BaseConnection;
    let clientConnection: BaseConnection;
    let agentStream: ReturnType<typeof createStreamPair>[0];
    let agentServerStream: ReturnType<typeof createStreamPair>[1];
    let clientStream: ReturnType<typeof createStreamPair>[0];
    let clientServerStream: ReturnType<typeof createStreamPair>[1];

    beforeEach(() => {
      server = new TestServer({ name: 'Test Server' });

      // Agent connection (to register agents)
      [agentStream, agentServerStream] = createStreamPair();
      agentConnection = new BaseConnection(agentStream);
      server.acceptConnection(agentServerStream);

      // Client connection (to make updates)
      [clientStream, clientServerStream] = createStreamPair();
      clientConnection = new BaseConnection(clientStream);
      server.acceptConnection(clientServerStream);
    });

    afterEach(async () => {
      await agentConnection.close().catch(() => {});
      await clientConnection.close().catch(() => {});
    });

    it('updates agent permissionOverrides via map/agents/update', async () => {
      // Connect agent and register
      await agentConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'agent',
        name: 'Test Agent',
      });

      const registerResult = await agentConnection.sendRequest<
        { name: string; role?: string },
        { agent: { id: string } }
      >(LIFECYCLE_METHODS.AGENTS_REGISTER, { name: 'Test Agent', role: 'worker' });

      const agentId = registerResult.agent.id;

      // Connect client
      await clientConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'client',
        name: 'Test Client',
      });

      // Update agent with permission overrides
      const updateResult = await clientConnection.sendRequest<unknown, AgentsUpdateResponseResult>(
        STATE_METHODS.AGENTS_UPDATE,
        {
          agentId,
          permissionOverrides: {
            acceptsFrom: { clients: 'all' },
            canMessage: { agents: 'siblings' },
          },
        }
      );

      expect(updateResult.agent.permissionOverrides).toBeDefined();
      expect(updateResult.agent.permissionOverrides?.acceptsFrom?.clients).toBe('all');
      expect(updateResult.agent.permissionOverrides?.canMessage?.agents).toBe('siblings');
    });

    it('emits permissions_agent_updated event on agent permission change', async () => {
      // Connect agent and register
      await agentConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'agent',
      });

      const registerResult = await agentConnection.sendRequest<
        { name: string },
        { agent: { id: string } }
      >(LIFECYCLE_METHODS.AGENTS_REGISTER, { name: 'Test Agent' });

      const agentId = registerResult.agent.id;

      // Connect client and subscribe to permission events
      await clientConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'client',
      });

      const subResult = await clientConnection.sendRequest<unknown, SubscribeResponseResult>(
        CORE_METHODS.SUBSCRIBE,
        { filter: { eventTypes: [EVENT_TYPES.PERMISSIONS_AGENT_UPDATED] } }
      );

      // Collect events
      const events: Event[] = [];
      clientConnection.setNotificationHandler((method, params) => {
        if (method === NOTIFICATION_METHODS.EVENT) {
          events.push((params as { event: Event }).event);
        }
      });

      // Update agent permissions
      await clientConnection.sendRequest(STATE_METHODS.AGENTS_UPDATE, {
        agentId,
        permissionOverrides: { canSee: { agents: 'all' } },
      });

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.some((e) => e.type === EVENT_TYPES.PERMISSIONS_AGENT_UPDATED)).toBe(true);
      const permEvent = events.find((e) => e.type === EVENT_TYPES.PERMISSIONS_AGENT_UPDATED);
      expect(permEvent?.data?.agentId).toBe(agentId);
    });

    it('merges permission overrides with existing overrides', async () => {
      // Connect agent and register with initial overrides
      await agentConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'agent',
      });

      const registerResult = await agentConnection.sendRequest<
        { name: string; permissionOverrides?: object },
        { agent: { id: string } }
      >(LIFECYCLE_METHODS.AGENTS_REGISTER, {
        name: 'Test Agent',
        permissionOverrides: { canSee: { agents: 'siblings' } },
      });

      const agentId = registerResult.agent.id;

      // Connect client
      await clientConnection.sendRequest(CORE_METHODS.CONNECT, {
        protocolVersion: 1,
        participantType: 'client',
      });

      // Update with additional overrides
      const updateResult = await clientConnection.sendRequest<unknown, AgentsUpdateResponseResult>(
        STATE_METHODS.AGENTS_UPDATE,
        {
          agentId,
          permissionOverrides: { canMessage: { agents: 'all' } },
        }
      );

      // Both should be present
      expect(updateResult.agent.permissionOverrides?.canSee?.agents).toBe('siblings');
      expect(updateResult.agent.permissionOverrides?.canMessage?.agents).toBe('all');
    });
  });
});
