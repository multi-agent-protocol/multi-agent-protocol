/**
 * Tests for Permission utilities
 */

import { describe, it, expect } from 'vitest';
import {
  // Types
  type SystemExposure,
  type PermissionSystemConfig,
  type PermissionParticipant,
  type PermissionContext,
  type PermissionAction,
  // Layer 1: System exposure
  isAgentExposed,
  isEventTypeExposed,
  isScopeExposed,
  // Layer 2: Capabilities
  hasCapability,
  canPerformMethod,
  // Layer 3: Scope permissions
  canSeeScope,
  canSendToScope,
  canJoinScope,
  // Layer 4: Agent permissions
  canSeeAgent,
  canMessageAgent,
  canControlAgent,
  // High-level resolution
  canPerformAction,
  // Filtering utilities
  filterVisibleAgents,
  filterVisibleScopes,
  filterVisibleEvents,
  // Agent permission resolution
  DEFAULT_AGENT_PERMISSION_CONFIG,
  deepMergePermissions,
  mapVisibilityToRule,
  resolveAgentPermissions,
  canAgentAcceptMessage,
  canAgentSeeAgent,
  canAgentMessageAgent,
} from '../permissions';
import type { Agent, Scope, Event, ParticipantCapabilities, AgentPermissions, AgentPermissionConfig } from '../types';

describe('Permission Utilities', () => {
  // ===========================================================================
  // Layer 1: System Exposure
  // ===========================================================================

  describe('Layer 1: System Exposure', () => {
    describe('isAgentExposed', () => {
      it('returns true when no exposure config', () => {
        expect(isAgentExposed(undefined, 'any-agent')).toBe(true);
      });

      it('returns true by default when agents config is empty', () => {
        expect(isAgentExposed({}, 'any-agent')).toBe(true);
      });

      it('respects publicByDefault=false', () => {
        const exposure: SystemExposure = {
          agents: { publicByDefault: false },
        };
        expect(isAgentExposed(exposure, 'any-agent')).toBe(false);
      });

      it('respects hiddenAgents patterns', () => {
        const exposure: SystemExposure = {
          agents: { hiddenAgents: ['internal-*', 'secret-agent'] },
        };
        expect(isAgentExposed(exposure, 'internal-worker')).toBe(false);
        expect(isAgentExposed(exposure, 'internal-manager')).toBe(false);
        expect(isAgentExposed(exposure, 'secret-agent')).toBe(false);
        expect(isAgentExposed(exposure, 'public-agent')).toBe(true);
      });

      it('respects publicAgents patterns', () => {
        const exposure: SystemExposure = {
          agents: {
            publicByDefault: false,
            publicAgents: ['public-*', 'visible-agent'],
          },
        };
        expect(isAgentExposed(exposure, 'public-worker')).toBe(true);
        expect(isAgentExposed(exposure, 'visible-agent')).toBe(true);
        expect(isAgentExposed(exposure, 'private-agent')).toBe(false);
      });

      it('hiddenAgents takes precedence over publicAgents', () => {
        const exposure: SystemExposure = {
          agents: {
            publicAgents: ['*-agent'],
            hiddenAgents: ['internal-*'],
          },
        };
        expect(isAgentExposed(exposure, 'public-agent')).toBe(true);
        expect(isAgentExposed(exposure, 'internal-agent')).toBe(false);
      });

      it('supports glob patterns with ?', () => {
        const exposure: SystemExposure = {
          agents: { hiddenAgents: ['agent-?'] },
        };
        expect(isAgentExposed(exposure, 'agent-1')).toBe(false);
        expect(isAgentExposed(exposure, 'agent-a')).toBe(false);
        expect(isAgentExposed(exposure, 'agent-12')).toBe(true);
      });
    });

    describe('isEventTypeExposed', () => {
      it('returns true when no exposure config', () => {
        expect(isEventTypeExposed(undefined, 'agent_registered')).toBe(true);
      });

      it('returns true when no event config', () => {
        expect(isEventTypeExposed({}, 'agent_registered')).toBe(true);
      });

      it('respects exposedTypes whitelist', () => {
        const exposure: SystemExposure = {
          events: { exposedTypes: ['agent_registered', 'agent_unregistered'] },
        };
        expect(isEventTypeExposed(exposure, 'agent_registered')).toBe(true);
        expect(isEventTypeExposed(exposure, 'agent_unregistered')).toBe(true);
        expect(isEventTypeExposed(exposure, 'message_sent')).toBe(false);
      });

      it('respects hiddenTypes blacklist', () => {
        const exposure: SystemExposure = {
          events: { hiddenTypes: ['internal_event', 'debug_event'] },
        };
        expect(isEventTypeExposed(exposure, 'internal_event')).toBe(false);
        expect(isEventTypeExposed(exposure, 'debug_event')).toBe(false);
        expect(isEventTypeExposed(exposure, 'agent_registered')).toBe(true);
      });

      it('hiddenTypes takes precedence over exposedTypes', () => {
        const exposure: SystemExposure = {
          events: {
            exposedTypes: ['agent_registered', 'internal_event'],
            hiddenTypes: ['internal_event'],
          },
        };
        expect(isEventTypeExposed(exposure, 'agent_registered')).toBe(true);
        expect(isEventTypeExposed(exposure, 'internal_event')).toBe(false);
      });
    });

    describe('isScopeExposed', () => {
      it('returns true when no exposure config', () => {
        expect(isScopeExposed(undefined, 'any-scope')).toBe(true);
      });

      it('respects publicByDefault=false', () => {
        const exposure: SystemExposure = {
          scopes: { publicByDefault: false },
        };
        expect(isScopeExposed(exposure, 'any-scope')).toBe(false);
      });

      it('respects hiddenScopes patterns', () => {
        const exposure: SystemExposure = {
          scopes: { hiddenScopes: ['private-*', 'internal'] },
        };
        expect(isScopeExposed(exposure, 'private-chat')).toBe(false);
        expect(isScopeExposed(exposure, 'internal')).toBe(false);
        expect(isScopeExposed(exposure, 'public-room')).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Layer 2: Capabilities
  // ===========================================================================

  describe('Layer 2: Capabilities', () => {
    const fullCapabilities: ParticipantCapabilities = {
      observation: { canObserve: true, canQuery: true },
      messaging: { canSend: true, canReceive: true, canBroadcast: true },
      lifecycle: { canSpawn: true, canRegister: true, canUnregister: true, canStop: true, canSteer: true },
      scopes: { canCreateScopes: true, canManageScopes: true },
    };

    const limitedCapabilities: ParticipantCapabilities = {
      observation: { canObserve: true, canQuery: false },
      messaging: { canSend: false, canReceive: true, canBroadcast: false },
    };

    describe('hasCapability', () => {
      it('returns true for granted capabilities', () => {
        expect(hasCapability(fullCapabilities, 'observation.canQuery')).toBe(true);
        expect(hasCapability(fullCapabilities, 'lifecycle.canSpawn')).toBe(true);
      });

      it('returns false for missing capabilities', () => {
        expect(hasCapability(limitedCapabilities, 'observation.canQuery')).toBe(false);
        expect(hasCapability(limitedCapabilities, 'messaging.canSend')).toBe(false);
      });

      it('returns false for undefined capability categories', () => {
        expect(hasCapability(limitedCapabilities, 'lifecycle.canSpawn')).toBe(false);
        expect(hasCapability(limitedCapabilities, 'scopes.canCreateScopes')).toBe(false);
      });
    });

    describe('canPerformMethod', () => {
      it('returns true for methods with all required capabilities', () => {
        expect(canPerformMethod('map/agents/list', fullCapabilities)).toBe(true);
        expect(canPerformMethod('map/send', fullCapabilities)).toBe(true);
      });

      it('returns false for methods missing required capabilities', () => {
        expect(canPerformMethod('map/agents/list', limitedCapabilities)).toBe(false);
        expect(canPerformMethod('map/send', limitedCapabilities)).toBe(false);
      });

      it('returns true for methods with no capability requirements', () => {
        expect(canPerformMethod('map/connect', limitedCapabilities)).toBe(true);
        expect(canPerformMethod('map/disconnect', limitedCapabilities)).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Layer 3: Scope Permissions
  // ===========================================================================

  describe('Layer 3: Scope Permissions', () => {
    const clientParticipant: PermissionParticipant = {
      id: 'client-1',
      type: 'client',
      capabilities: { observation: { canObserve: true, canQuery: true } },
    };

    const systemParticipant: PermissionParticipant = {
      id: 'system',
      type: 'system',
      capabilities: {},
    };

    describe('canSeeScope', () => {
      it('allows seeing public scopes', () => {
        const scope: Scope = { id: 'scope-1', visibility: 'public' };
        expect(canSeeScope(scope, clientParticipant)).toBe(true);
      });

      it('denies seeing members-only scope without membership', () => {
        const scope: Scope = { id: 'scope-1', visibility: 'members' };
        expect(canSeeScope(scope, clientParticipant, [])).toBe(false);
      });

      it('allows seeing members-only scope with membership', () => {
        const scope: Scope = { id: 'scope-1', visibility: 'members' };
        expect(canSeeScope(scope, clientParticipant, ['agent-1'])).toBe(true);
      });

      it('denies client from seeing system scope', () => {
        const scope: Scope = { id: 'scope-1', visibility: 'system' };
        expect(canSeeScope(scope, clientParticipant)).toBe(false);
      });

      it('allows system to see system scope', () => {
        const scope: Scope = { id: 'scope-1', visibility: 'system' };
        expect(canSeeScope(scope, systemParticipant)).toBe(true);
      });

      it('defaults to public visibility', () => {
        const scope: Scope = { id: 'scope-1' };
        expect(canSeeScope(scope, clientParticipant)).toBe(true);
      });
    });

    describe('canSendToScope', () => {
      it('allows sending to scope with any sendPolicy', () => {
        const scope: Scope = { id: 'scope-1', sendPolicy: 'any' };
        expect(canSendToScope(scope, clientParticipant, [])).toBe(true);
      });

      it('denies sending to members-only scope without membership', () => {
        const scope: Scope = { id: 'scope-1', sendPolicy: 'members' };
        expect(canSendToScope(scope, clientParticipant, [])).toBe(false);
      });

      it('allows sending to members-only scope with membership', () => {
        const scope: Scope = { id: 'scope-1', sendPolicy: 'members' };
        expect(canSendToScope(scope, clientParticipant, ['agent-1'])).toBe(true);
      });

      it('always allows system to send', () => {
        const scope: Scope = { id: 'scope-1', sendPolicy: 'members' };
        expect(canSendToScope(scope, systemParticipant, [])).toBe(true);
      });

      it('defaults to members sendPolicy', () => {
        const scope: Scope = { id: 'scope-1' };
        expect(canSendToScope(scope, clientParticipant, [])).toBe(false);
        expect(canSendToScope(scope, clientParticipant, ['agent-1'])).toBe(true);
      });
    });

    describe('canJoinScope', () => {
      it('allows joining open scope', () => {
        const scope: Scope = { id: 'scope-1', joinPolicy: 'open' };
        expect(canJoinScope(scope, 'client')).toBe(true);
      });

      it('denies joining invite-only scope', () => {
        const scope: Scope = { id: 'scope-1', joinPolicy: 'invite' };
        expect(canJoinScope(scope, 'client')).toBe(false);
      });

      it('denies joining role scope without matching role', () => {
        const scope: Scope = { id: 'scope-1', joinPolicy: 'role', autoJoinRoles: ['worker'] };
        expect(canJoinScope(scope, 'client', 'manager')).toBe(false);
      });

      it('allows joining role scope with matching role', () => {
        const scope: Scope = { id: 'scope-1', joinPolicy: 'role', autoJoinRoles: ['worker', 'manager'] };
        expect(canJoinScope(scope, 'client', 'worker')).toBe(true);
      });

      it('denies client from joining system scope', () => {
        const scope: Scope = { id: 'scope-1', joinPolicy: 'system' };
        expect(canJoinScope(scope, 'client')).toBe(false);
      });

      it('allows system to join system scope', () => {
        const scope: Scope = { id: 'scope-1', joinPolicy: 'system' };
        expect(canJoinScope(scope, 'system')).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Layer 4: Agent Permissions
  // ===========================================================================

  describe('Layer 4: Agent Permissions', () => {
    const clientParticipant: PermissionParticipant = {
      id: 'client-1',
      type: 'client',
      capabilities: {},
    };

    const systemParticipant: PermissionParticipant = {
      id: 'system',
      type: 'system',
      capabilities: {},
    };

    describe('canSeeAgent', () => {
      it('allows seeing public agents', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'public' };
        expect(canSeeAgent(agent, clientParticipant)).toBe(true);
      });

      it('denies seeing parent-only agent without ownership', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'parent-only', parent: 'parent-1' };
        expect(canSeeAgent(agent, clientParticipant, [])).toBe(false);
      });

      it('allows seeing parent-only agent when owning parent', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'parent-only', parent: 'parent-1' };
        expect(canSeeAgent(agent, clientParticipant, ['parent-1'])).toBe(true);
      });

      it('allows seeing parent-only agent when owning agent itself', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'parent-only' };
        expect(canSeeAgent(agent, clientParticipant, ['agent-1'])).toBe(true);
      });

      it('denies client from seeing system agent', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'system' };
        expect(canSeeAgent(agent, clientParticipant)).toBe(false);
      });

      it('allows system to see system agent', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'system' };
        expect(canSeeAgent(agent, systemParticipant)).toBe(true);
      });

      it('defaults to public visibility', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        expect(canSeeAgent(agent, clientParticipant)).toBe(true);
      });
    });

    describe('canMessageAgent', () => {
      it('allows messaging visible agents', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'public' };
        expect(canMessageAgent(agent, clientParticipant)).toBe(true);
      });

      it('denies messaging invisible agents', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'system' };
        expect(canMessageAgent(agent, clientParticipant)).toBe(false);
      });
    });

    describe('canControlAgent', () => {
      it('allows system to control any agent', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        expect(canControlAgent(agent, systemParticipant)).toBe(true);
      });

      it('allows controlling owned agent', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        expect(canControlAgent(agent, clientParticipant, ['agent-1'])).toBe(true);
      });

      it('allows controlling child of owned agent', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', parent: 'parent-1' };
        expect(canControlAgent(agent, clientParticipant, ['parent-1'])).toBe(true);
      });

      it('denies controlling unowned agent', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        expect(canControlAgent(agent, clientParticipant, [])).toBe(false);
      });
    });
  });

  // ===========================================================================
  // High-Level Resolution
  // ===========================================================================

  describe('High-Level Resolution', () => {
    const fullCapabilities: ParticipantCapabilities = {
      observation: { canObserve: true, canQuery: true },
      messaging: { canSend: true, canReceive: true },
      lifecycle: { canSpawn: true, canRegister: true },
    };

    const context: PermissionContext = {
      system: {
        exposure: {
          agents: { hiddenAgents: ['internal-*'] },
          events: { hiddenTypes: ['debug_event'] },
        },
      },
      participant: {
        id: 'client-1',
        type: 'client',
        capabilities: fullCapabilities,
      },
      ownedAgentIds: ['agent-1'],
    };

    describe('canPerformAction', () => {
      it('allows action with no targets and sufficient capabilities', () => {
        const action: PermissionAction = {
          type: 'query',
          method: 'map/agents/list',
        };
        const result = canPerformAction(context, action);
        expect(result.allowed).toBe(true);
      });

      it('denies action targeting hidden agent (Layer 1)', () => {
        const action: PermissionAction = {
          type: 'query',
          method: 'map/agents/get',
          target: { agentId: 'internal-worker' },
        };
        const result = canPerformAction(context, action);
        expect(result.allowed).toBe(false);
        expect(result.layer).toBe(1);
        expect(result.reason).toContain('not exposed');
      });

      it('denies action targeting hidden event type (Layer 1)', () => {
        const action: PermissionAction = {
          type: 'subscribe',
          method: 'map/subscribe',
          target: { eventTypes: ['debug_event'] },
        };
        const result = canPerformAction(context, action);
        expect(result.allowed).toBe(false);
        expect(result.layer).toBe(1);
      });

      it('denies action missing required capability (Layer 2)', () => {
        const limitedContext: PermissionContext = {
          ...context,
          participant: {
            ...context.participant,
            capabilities: { observation: { canObserve: false, canQuery: false } },
          },
        };
        const action: PermissionAction = {
          type: 'query',
          method: 'map/agents/list',
        };
        const result = canPerformAction(limitedContext, action);
        expect(result.allowed).toBe(false);
        expect(result.layer).toBe(2);
        expect(result.reason).toContain('capability');
      });

      it('allows action on public agent with sufficient capabilities', () => {
        const action: PermissionAction = {
          type: 'query',
          method: 'map/agents/get',
          target: { agentId: 'public-agent' },
        };
        const result = canPerformAction(context, action);
        expect(result.allowed).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Filtering Utilities
  // ===========================================================================

  describe('Filtering Utilities', () => {
    const context: PermissionContext = {
      system: {
        exposure: {
          agents: { hiddenAgents: ['internal-*'] },
          scopes: { hiddenScopes: ['private-*'] },
          events: { hiddenTypes: ['debug_event'] },
        },
      },
      participant: {
        id: 'client-1',
        type: 'client',
        capabilities: {},
      },
      ownedAgentIds: ['agent-1'],
      scopeMembership: new Map([['scope-1', ['agent-1']]]),
    };

    describe('filterVisibleAgents', () => {
      it('filters out hidden agents', () => {
        const agents: Agent[] = [
          { id: 'public-agent', state: 'running' },
          { id: 'internal-worker', state: 'running' },
          { id: 'internal-manager', state: 'running' },
        ];
        const visible = filterVisibleAgents(agents, context);
        expect(visible.map((a) => a.id)).toEqual(['public-agent']);
      });

      it('filters out system-visibility agents for non-system participant', () => {
        const agents: Agent[] = [
          { id: 'public-agent', state: 'running', visibility: 'public' },
          { id: 'system-agent', state: 'running', visibility: 'system' },
        ];
        const visible = filterVisibleAgents(agents, context);
        expect(visible.map((a) => a.id)).toEqual(['public-agent']);
      });

      it('includes parent-only agents when owning parent', () => {
        const agents: Agent[] = [
          { id: 'child-agent', state: 'running', visibility: 'parent-only', parent: 'agent-1' },
        ];
        const visible = filterVisibleAgents(agents, context);
        expect(visible.map((a) => a.id)).toEqual(['child-agent']);
      });
    });

    describe('filterVisibleScopes', () => {
      it('filters out hidden scopes', () => {
        const scopes: Scope[] = [
          { id: 'public-scope' },
          { id: 'private-room' },
          { id: 'private-chat' },
        ];
        const visible = filterVisibleScopes(scopes, context);
        expect(visible.map((s) => s.id)).toEqual(['public-scope']);
      });

      it('filters out members-only scopes without membership', () => {
        const scopes: Scope[] = [
          { id: 'scope-1', visibility: 'members' },  // Member via scopeMembership
          { id: 'scope-2', visibility: 'members' },  // Not a member
        ];
        const visible = filterVisibleScopes(scopes, context);
        expect(visible.map((s) => s.id)).toEqual(['scope-1']);
      });
    });

    describe('filterVisibleEvents', () => {
      it('filters out hidden event types', () => {
        const events: Event[] = [
          { id: '1', type: 'agent_registered', timestamp: 1 },
          { id: '2', type: 'debug_event', timestamp: 2 },
          { id: '3', type: 'message_sent', timestamp: 3 },
        ];
        const visible = filterVisibleEvents(events, context);
        expect(visible.map((e) => e.type)).toEqual(['agent_registered', 'message_sent']);
      });
    });
  });

  // ===========================================================================
  // Agent Permission Resolution (Hybrid Model)
  // ===========================================================================

  describe('Agent Permission Resolution', () => {
    describe('DEFAULT_AGENT_PERMISSION_CONFIG', () => {
      it('has default permissions', () => {
        expect(DEFAULT_AGENT_PERMISSION_CONFIG.defaultPermissions).toBeDefined();
        expect(DEFAULT_AGENT_PERMISSION_CONFIG.defaultPermissions.canSee).toBeDefined();
        expect(DEFAULT_AGENT_PERMISSION_CONFIG.defaultPermissions.canMessage).toBeDefined();
        expect(DEFAULT_AGENT_PERMISSION_CONFIG.defaultPermissions.acceptsFrom).toBeDefined();
      });

      it('has rolePermissions object', () => {
        expect(DEFAULT_AGENT_PERMISSION_CONFIG.rolePermissions).toBeDefined();
      });
    });

    describe('deepMergePermissions', () => {
      it('merges simple values', () => {
        const base: AgentPermissions = {
          canSee: { agents: 'all' },
          canMessage: { agents: 'hierarchy' },
        };
        const override: Partial<AgentPermissions> = {
          canMessage: { agents: 'all' },
        };
        const merged = deepMergePermissions(base, override);
        expect(merged.canSee?.agents).toBe('all');
        expect(merged.canMessage?.agents).toBe('all');
      });

      it('deep merges nested objects', () => {
        const base: AgentPermissions = {
          canSee: { agents: 'all', scopes: 'scoped' },
        };
        const override: Partial<AgentPermissions> = {
          canSee: { structure: 'full' },
        };
        const merged = deepMergePermissions(base, override);
        expect(merged.canSee?.agents).toBe('all');
        expect(merged.canSee?.scopes).toBe('scoped');
        expect(merged.canSee?.structure).toBe('full');
      });
    });

    describe('mapVisibilityToRule', () => {
      it('maps public to all', () => {
        expect(mapVisibilityToRule('public')).toBe('all');
      });

      it('maps parent-only to hierarchy', () => {
        expect(mapVisibilityToRule('parent-only')).toBe('hierarchy');
      });

      it('maps scope to scoped', () => {
        expect(mapVisibilityToRule('scope')).toBe('scoped');
      });

      it('maps system to direct', () => {
        expect(mapVisibilityToRule('system')).toBe('direct');
      });
    });

    describe('resolveAgentPermissions', () => {
      it('returns default permissions for agent with no role', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        const permissions = resolveAgentPermissions(agent);
        expect(permissions).toBeDefined();
        expect(permissions.canSee).toBeDefined();
        expect(permissions.acceptsFrom).toBeDefined();
      });

      it('merges role permissions', () => {
        const config: AgentPermissionConfig = {
          defaultPermissions: {
            canSee: { agents: 'all' },
          },
          rolePermissions: {
            coordinator: {
              canSee: { agents: 'hierarchy' },
            },
          },
        };
        const agent: Agent = { id: 'agent-1', state: 'running', role: 'coordinator' };
        const permissions = resolveAgentPermissions(agent, config);
        expect(permissions.canSee?.agents).toBe('hierarchy');
      });

      it('applies agent-specific overrides', () => {
        const config: AgentPermissionConfig = {
          defaultPermissions: {
            canSee: { agents: 'all' },
            canMessage: { agents: 'hierarchy' },
          },
          rolePermissions: {},
        };
        const agent: Agent = {
          id: 'agent-1',
          state: 'running',
          permissionOverrides: {
            canMessage: { agents: 'all' },
          },
        };
        const permissions = resolveAgentPermissions(agent, config);
        expect(permissions.canSee?.agents).toBe('all');
        expect(permissions.canMessage?.agents).toBe('all');
      });

      it('overrides take precedence over role', () => {
        const config: AgentPermissionConfig = {
          defaultPermissions: {
            canSee: { agents: 'all' },
          },
          rolePermissions: {
            worker: {
              canSee: { agents: 'scoped' },
            },
          },
        };
        const agent: Agent = {
          id: 'agent-1',
          state: 'running',
          role: 'worker',
          permissionOverrides: {
            canSee: { agents: 'hierarchy' },
          },
        };
        const permissions = resolveAgentPermissions(agent, config);
        expect(permissions.canSee?.agents).toBe('hierarchy');
      });

      it('maps legacy visibility to canSee.agents', () => {
        const agent: Agent = { id: 'agent-1', state: 'running', visibility: 'parent-only' };
        const permissions = resolveAgentPermissions(agent);
        expect(permissions.canSee?.agents).toBe('hierarchy');
      });
    });

    describe('canAgentAcceptMessage', () => {
      it('accepts from agents when acceptsFrom.agents = all', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { acceptsFrom: { agents: 'all' } },
          rolePermissions: {},
        };
        expect(canAgentAcceptMessage(agent, { senderType: 'agent', senderId: 'client-1', senderAgentId: 'agent-2' }, config)).toBe(true);
      });

      it('accepts from clients when acceptsFrom.clients = all', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { acceptsFrom: { clients: 'all' } },
          rolePermissions: {},
        };
        expect(canAgentAcceptMessage(agent, { senderType: 'client', senderId: 'client-1' }, config)).toBe(true);
      });

      it('rejects from clients when acceptsFrom.clients = none', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { acceptsFrom: { clients: 'none' } },
          rolePermissions: {},
        };
        expect(canAgentAcceptMessage(agent, { senderType: 'client', senderId: 'client-1' }, config)).toBe(false);
      });

      it('accepts from hierarchy when acceptsFrom.agents = hierarchy and sender is parent', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { acceptsFrom: { agents: 'hierarchy' } },
          rolePermissions: {},
        };
        expect(canAgentAcceptMessage(agent, {
          senderType: 'agent',
          senderId: 'client-1',
          senderAgentId: 'parent-agent',
          isParent: true,
        }, config)).toBe(true);
      });

      it('rejects from non-hierarchy when acceptsFrom.agents = hierarchy', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { acceptsFrom: { agents: 'hierarchy' } },
          rolePermissions: {},
        };
        expect(canAgentAcceptMessage(agent, {
          senderType: 'agent',
          senderId: 'client-1',
          senderAgentId: 'other-agent',
        }, config)).toBe(false);
      });

      it('accepts from scoped agents when acceptsFrom.agents = scoped and shares scope', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { acceptsFrom: { agents: 'scoped' } },
          rolePermissions: {},
        };
        expect(canAgentAcceptMessage(agent, {
          senderType: 'agent',
          senderId: 'client-1',
          senderAgentId: 'other-agent',
          sharedScopes: ['scope-1'],
        }, config)).toBe(true);
      });

      it('accepts from specific agents when using include list', () => {
        const agent: Agent = { id: 'agent-1', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { acceptsFrom: { agents: { include: ['allowed-agent'] } } },
          rolePermissions: {},
        };
        expect(canAgentAcceptMessage(agent, {
          senderType: 'agent',
          senderId: 'client-1',
          senderAgentId: 'allowed-agent',
        }, config)).toBe(true);
        expect(canAgentAcceptMessage(agent, {
          senderType: 'agent',
          senderId: 'client-1',
          senderAgentId: 'other-agent',
        }, config)).toBe(false);
      });
    });

    describe('canAgentSeeAgent', () => {
      it('allows seeing when canSee.agents = all', () => {
        const viewer: Agent = { id: 'viewer', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canSee: { agents: 'all' } },
          rolePermissions: {},
        };
        expect(canAgentSeeAgent(viewer, 'target', {}, config)).toBe(true);
      });

      it('allows seeing hierarchy when canSee.agents = hierarchy and is parent', () => {
        const viewer: Agent = { id: 'viewer', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canSee: { agents: 'hierarchy' } },
          rolePermissions: {},
        };
        expect(canAgentSeeAgent(viewer, 'target', { isParent: true }, config)).toBe(true);
      });

      it('allows seeing hierarchy when canSee.agents = hierarchy and is child', () => {
        const viewer: Agent = { id: 'viewer', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canSee: { agents: 'hierarchy' } },
          rolePermissions: {},
        };
        expect(canAgentSeeAgent(viewer, 'target', { isChild: true }, config)).toBe(true);
      });

      it('denies seeing non-hierarchy when canSee.agents = hierarchy', () => {
        const viewer: Agent = { id: 'viewer', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canSee: { agents: 'hierarchy' } },
          rolePermissions: {},
        };
        expect(canAgentSeeAgent(viewer, 'target', {}, config)).toBe(false);
      });

      it('allows seeing scoped agents when canSee.agents = scoped and shares scope', () => {
        const viewer: Agent = { id: 'viewer', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canSee: { agents: 'scoped' } },
          rolePermissions: {},
        };
        expect(canAgentSeeAgent(viewer, 'target', { sharedScopes: ['scope-1'] }, config)).toBe(true);
      });

      it('denies seeing non-scoped when canSee.agents = scoped', () => {
        const viewer: Agent = { id: 'viewer', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canSee: { agents: 'scoped' } },
          rolePermissions: {},
        };
        expect(canAgentSeeAgent(viewer, 'target', {}, config)).toBe(false);
      });

      it('allows seeing specific agents when using include list', () => {
        const viewer: Agent = { id: 'viewer', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canSee: { agents: { include: ['allowed-target'] } } },
          rolePermissions: {},
        };
        expect(canAgentSeeAgent(viewer, 'allowed-target', {}, config)).toBe(true);
        expect(canAgentSeeAgent(viewer, 'other-target', {}, config)).toBe(false);
      });
    });

    describe('canAgentMessageAgent', () => {
      it('allows messaging when canMessage.agents = all', () => {
        const sender: Agent = { id: 'sender', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canMessage: { agents: 'all' } },
          rolePermissions: {},
        };
        expect(canAgentMessageAgent(sender, 'target', {}, config)).toBe(true);
      });

      it('allows messaging hierarchy when canMessage.agents = hierarchy and is parent', () => {
        const sender: Agent = { id: 'sender', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canMessage: { agents: 'hierarchy' } },
          rolePermissions: {},
        };
        expect(canAgentMessageAgent(sender, 'target', { isParent: true }, config)).toBe(true);
      });

      it('denies messaging non-hierarchy when canMessage.agents = hierarchy', () => {
        const sender: Agent = { id: 'sender', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canMessage: { agents: 'hierarchy' } },
          rolePermissions: {},
        };
        expect(canAgentMessageAgent(sender, 'target', {}, config)).toBe(false);
      });

      it('allows messaging scoped agents when canMessage.agents = scoped and shares scope', () => {
        const sender: Agent = { id: 'sender', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canMessage: { agents: 'scoped' } },
          rolePermissions: {},
        };
        expect(canAgentMessageAgent(sender, 'target', { sharedScopes: ['scope-1'] }, config)).toBe(true);
      });

      it('allows messaging specific agents when using include list', () => {
        const sender: Agent = { id: 'sender', state: 'running' };
        const config: AgentPermissionConfig = {
          defaultPermissions: { canMessage: { agents: { include: ['allowed-target'] } } },
          rolePermissions: {},
        };
        expect(canAgentMessageAgent(sender, 'allowed-target', {}, config)).toBe(true);
        expect(canAgentMessageAgent(sender, 'other-target', {}, config)).toBe(false);
      });
    });
  });
});
