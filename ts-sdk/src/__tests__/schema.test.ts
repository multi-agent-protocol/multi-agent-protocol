/**
 * Tests for Zod schema validators
 */

import { describe, it, expect } from 'vitest';
import {
  AgentIdSchema,
  ScopeIdSchema,
  ParticipantTypeSchema,
  AgentStateSchema,
  AgentVisibilitySchema,
  ParticipantCapabilitiesSchema,
  AddressSchema,
  DirectAddressSchema,
  MultiAddressSchema,
  ScopeAddressSchema,
  RoleAddressSchema,
  HierarchicalAddressSchema,
  BroadcastAddressSchema,
  AgentSchema,
  ScopeSchema,
  MessageSchema,
  EventSchema,
  MAPRequestSchema,
  MAPResponseSchema,
  MAPNotificationSchema,
  MAPErrorSchema,
  SubscriptionFilterSchema,
} from '../schema';

describe('Zod schema validators', () => {
  describe('identifiers', () => {
    it('validates agent ID', () => {
      expect(AgentIdSchema.safeParse('agent-123').success).toBe(true);
      expect(AgentIdSchema.safeParse('').success).toBe(true); // empty string is valid
      expect(AgentIdSchema.safeParse(123).success).toBe(false);
    });

    it('validates scope ID', () => {
      expect(ScopeIdSchema.safeParse('scope-456').success).toBe(true);
      expect(ScopeIdSchema.safeParse(null).success).toBe(false);
    });
  });

  describe('enums', () => {
    it('validates participant type', () => {
      expect(ParticipantTypeSchema.safeParse('agent').success).toBe(true);
      expect(ParticipantTypeSchema.safeParse('client').success).toBe(true);
      expect(ParticipantTypeSchema.safeParse('system').success).toBe(true);
      expect(ParticipantTypeSchema.safeParse('gateway').success).toBe(true);
      expect(ParticipantTypeSchema.safeParse('unknown').success).toBe(false);
    });

    it('validates agent state including custom states', () => {
      // Standard states
      expect(AgentStateSchema.safeParse('registered').success).toBe(true);
      expect(AgentStateSchema.safeParse('idle').success).toBe(true);
      expect(AgentStateSchema.safeParse('busy').success).toBe(true);
      expect(AgentStateSchema.safeParse('waiting').success).toBe(true);
      expect(AgentStateSchema.safeParse('stopping').success).toBe(true);
      expect(AgentStateSchema.safeParse('stopped').success).toBe(true);
      expect(AgentStateSchema.safeParse('error').success).toBe(true);

      // Custom x-* states
      expect(AgentStateSchema.safeParse('x-custom').success).toBe(true);
      expect(AgentStateSchema.safeParse('x-my-state').success).toBe(true);

      // Invalid states
      expect(AgentStateSchema.safeParse('invalid').success).toBe(false);
      expect(AgentStateSchema.safeParse('custom').success).toBe(false);
    });

    it('validates agent visibility', () => {
      expect(AgentVisibilitySchema.safeParse('public').success).toBe(true);
      expect(AgentVisibilitySchema.safeParse('parent-only').success).toBe(true);
      expect(AgentVisibilitySchema.safeParse('scope').success).toBe(true);
      expect(AgentVisibilitySchema.safeParse('system').success).toBe(true);
      expect(AgentVisibilitySchema.safeParse('invalid').success).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('validates empty capabilities', () => {
      expect(ParticipantCapabilitiesSchema.safeParse({}).success).toBe(true);
    });

    it('validates full capabilities', () => {
      const capabilities = {
        observation: {
          canObserve: true,
          canQuery: true,
        },
        messaging: {
          canSend: true,
          canReceive: true,
          canBroadcast: false,
        },
        lifecycle: {
          canSpawn: true,
          canRegister: false,
          canUnregister: false,
          canSteer: false,
          canStop: false,
        },
        scopes: {
          canCreateScopes: true,
          canManageScopes: false,
        },
      };

      expect(ParticipantCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
    });

    it('validates partial capabilities', () => {
      const capabilities = {
        observation: {
          canObserve: true,
        },
      };

      expect(ParticipantCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
    });

    it('rejects invalid capability fields', () => {
      const capabilities = {
        observation: {
          invalidField: true,
        },
      };

      expect(ParticipantCapabilitiesSchema.safeParse(capabilities).success).toBe(false);
    });
  });

  describe('addresses', () => {
    it('validates direct address', () => {
      expect(DirectAddressSchema.safeParse({ agent: 'agent-123' }).success).toBe(true);
      expect(DirectAddressSchema.safeParse({ agent: 123 }).success).toBe(false);
      expect(DirectAddressSchema.safeParse({}).success).toBe(false);
    });

    it('validates multi address', () => {
      expect(MultiAddressSchema.safeParse({ agents: ['a1', 'a2'] }).success).toBe(true);
      expect(MultiAddressSchema.safeParse({ agents: [] }).success).toBe(false); // min 1
      expect(MultiAddressSchema.safeParse({ agents: 'a1' }).success).toBe(false);
    });

    it('validates scope address', () => {
      expect(ScopeAddressSchema.safeParse({ scope: 'scope-123' }).success).toBe(true);
    });

    it('validates role address', () => {
      expect(RoleAddressSchema.safeParse({ role: 'worker' }).success).toBe(true);
      expect(RoleAddressSchema.safeParse({ role: 'worker', scope: 'scope-1' }).success).toBe(true);
    });

    it('validates hierarchical address', () => {
      expect(HierarchicalAddressSchema.safeParse({ parent: true }).success).toBe(true);
      expect(HierarchicalAddressSchema.safeParse({ children: true }).success).toBe(true);
      expect(HierarchicalAddressSchema.safeParse({ siblings: true }).success).toBe(true);
      expect(HierarchicalAddressSchema.safeParse({ ancestors: true }).success).toBe(true);
      expect(HierarchicalAddressSchema.safeParse({ descendants: true }).success).toBe(true);
    });

    it('validates broadcast address', () => {
      expect(BroadcastAddressSchema.safeParse({ broadcast: true }).success).toBe(true);
      expect(BroadcastAddressSchema.safeParse({ broadcast: false }).success).toBe(false);
    });

    it('validates union address schema', () => {
      expect(AddressSchema.safeParse({ agent: 'a1' }).success).toBe(true);
      expect(AddressSchema.safeParse({ agents: ['a1', 'a2'] }).success).toBe(true);
      expect(AddressSchema.safeParse({ scope: 's1' }).success).toBe(true);
      expect(AddressSchema.safeParse({ role: 'worker' }).success).toBe(true);
      expect(AddressSchema.safeParse({ parent: true }).success).toBe(true);
      expect(AddressSchema.safeParse({ broadcast: true }).success).toBe(true);
    });
  });

  describe('agent', () => {
    it('validates minimal agent', () => {
      const agent = {
        id: 'agent-123',
        state: 'idle',
      };

      expect(AgentSchema.safeParse(agent).success).toBe(true);
    });

    it('validates full agent', () => {
      const agent = {
        id: 'agent-123',
        name: 'Test Agent',
        description: 'A test agent',
        parent: 'parent-agent',
        relationships: [
          { type: 'peer', agentId: 'peer-agent' },
        ],
        state: 'busy',
        role: 'worker',
        scopes: ['scope-1', 'scope-2'],
        visibility: 'public',
        lifecycle: {
          createdAt: 1234567890,
          startedAt: 1234567891,
        },
        capabilities: {
          messaging: { canSend: true },
        },
        metadata: { custom: 'data' },
      };

      expect(AgentSchema.safeParse(agent).success).toBe(true);
    });

    it('rejects agent without required fields', () => {
      expect(AgentSchema.safeParse({}).success).toBe(false);
      expect(AgentSchema.safeParse({ id: 'a1' }).success).toBe(false); // missing state
      expect(AgentSchema.safeParse({ state: 'idle' }).success).toBe(false); // missing id
    });
  });

  describe('scope', () => {
    it('validates minimal scope', () => {
      const scope = {
        id: 'scope-123',
      };

      expect(ScopeSchema.safeParse(scope).success).toBe(true);
    });

    it('validates full scope', () => {
      const scope = {
        id: 'scope-123',
        name: 'Test Scope',
        parent: 'parent-scope',
        children: ['child-1', 'child-2'],
        joinPolicy: 'open',
        visibility: 'public',
        messageVisibility: 'members',
        sendPolicy: 'anyone',
        metadata: { custom: 'data' },
      };

      expect(ScopeSchema.safeParse(scope).success).toBe(true);
    });
  });

  describe('message', () => {
    it('validates minimal message', () => {
      const message = {
        id: 'msg-123',
        from: 'agent-1',
        to: { agent: 'agent-2' },
        timestamp: Date.now(),
      };

      expect(MessageSchema.safeParse(message).success).toBe(true);
    });

    it('validates full message', () => {
      const message = {
        id: 'msg-123',
        from: 'agent-1',
        to: { scope: 'scope-1' },
        timestamp: Date.now(),
        payload: { action: 'do-something', data: [1, 2, 3] },
        meta: {
          correlationId: 'corr-123',
          priority: 'high',
          delivery: 'at-least-once',
          relationship: 'peer',
        },
      };

      expect(MessageSchema.safeParse(message).success).toBe(true);
    });
  });

  describe('event', () => {
    it('validates event', () => {
      const event = {
        type: 'agent.registered',
        timestamp: Date.now(),
        data: { agentId: 'agent-1' },
      };

      expect(EventSchema.safeParse(event).success).toBe(true);
    });

    it('rejects invalid event type', () => {
      const event = {
        type: 'invalid.event',
        timestamp: Date.now(),
      };

      expect(EventSchema.safeParse(event).success).toBe(false);
    });
  });

  describe('subscription filter', () => {
    it('validates empty filter', () => {
      expect(SubscriptionFilterSchema.safeParse({}).success).toBe(true);
    });

    it('validates full filter', () => {
      const filter = {
        eventTypes: ['agent.registered', 'agent.state-changed'],
        scopes: ['scope-1'],
        fromAgents: ['agent-1', 'agent-2'],
        includeChildren: true,
      };

      expect(SubscriptionFilterSchema.safeParse(filter).success).toBe(true);
    });
  });

  describe('JSON-RPC messages', () => {
    it('validates request', () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'connect',
        params: { protocolVersion: 1 },
      };

      expect(MAPRequestSchema.safeParse(request).success).toBe(true);
    });

    it('validates request without params', () => {
      const request = {
        jsonrpc: '2.0',
        id: 'abc-123',
        method: 'disconnect',
      };

      expect(MAPRequestSchema.safeParse(request).success).toBe(true);
    });

    it('validates success response', () => {
      const response = {
        jsonrpc: '2.0',
        id: 1,
        result: { sessionId: 'sess-123' },
      };

      expect(MAPResponseSchema.safeParse(response).success).toBe(true);
    });

    it('validates error response', () => {
      const response = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      };

      expect(MAPResponseSchema.safeParse(response).success).toBe(true);
    });

    it('validates notification', () => {
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/event',
        params: { subscriptionId: 'sub-1', event: {} },
      };

      expect(MAPNotificationSchema.safeParse(notification).success).toBe(true);
    });

    it('rejects notification with id', () => {
      const invalid = {
        jsonrpc: '2.0',
        id: 1, // notifications shouldn't have id
        method: 'notifications/event',
      };

      // The schema allows id field but our type guard would reject it
      // Here we just test the schema accepts the structure
      expect(MAPNotificationSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('error', () => {
    it('validates minimal error', () => {
      const error = {
        code: -32600,
        message: 'Invalid Request',
      };

      expect(MAPErrorSchema.safeParse(error).success).toBe(true);
    });

    it('validates error with data', () => {
      const error = {
        code: -32000,
        message: 'Custom error',
        data: {
          category: 'auth',
          retryable: true,
          retryAfterMs: 5000,
          details: { reason: 'token expired' },
        },
      };

      expect(MAPErrorSchema.safeParse(error).success).toBe(true);
    });
  });
});
