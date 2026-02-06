/**
 * Agent handler factories
 *
 * Creates JSON-RPC handlers for agent-related methods.
 */

import type {
  AgentRegistry,
  HandlerContext,
  HandlerRegistry,
  ServerAgentState,
  SessionManager,
} from "../types";
import type { AuthManager } from "../auth";
import type { AuthManagerImpl } from "../auth/manager";
import { MAPRequestError } from "../../errors";
import {
  AgentNotFoundError,
  InvalidStateTransitionError,
  InvalidAgentStateError,
} from "./registry";

/**
 * Options for creating agent handlers.
 */
export interface AgentHandlerOptions {
  agents: AgentRegistry;
  /**
   * SessionManager for tracking agent-session associations.
   * When provided, uses atomic SessionManager methods instead of direct session mutation.
   * This prevents race conditions and ensures proper cleanup on failure.
   */
  sessions?: SessionManager;
  /**
   * AuthManager for spawn credential delegation.
   * When provided and backed by an AuthProvider, delegated credentials
   * are returned in the spawn response for child agent setup.
   */
  authManager?: AuthManager;
}

/**
 * Parameters for agent registration.
 */
interface RegisterParams {
  name: string;
  role?: string;
  metadata?: Record<string, unknown>;
  /** Capabilities this agent provides (for capability-based discovery) */
  capabilities?: string[];
}

/**
 * Parameters for agent unregistration.
 */
interface UnregisterParams {
  agentId: string;
}

/**
 * Parameters for getting an agent.
 */
interface GetParams {
  agentId: string;
}

/**
 * Parameters for listing agents.
 */
interface ListParams {
  state?: ServerAgentState;
  role?: string;
  sessionId?: string;
  scopeId?: string;
  /** Filter by capability (supports glob patterns) */
  capability?: string;
}

/**
 * Parameters for updating agent state.
 */
interface UpdateStateParams {
  agentId: string;
  state: ServerAgentState;
}

/**
 * Parameters for updating agent metadata.
 */
interface UpdateMetadataParams {
  agentId: string;
  metadata: Record<string, unknown>;
}

/**
 * Parameters for combined agent update (protocol-compliant).
 */
interface UpdateParams {
  agentId: string;
  state?: ServerAgentState;
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for spawning a child agent.
 */
interface SpawnParams {
  /** Parent agent ID (must belong to the calling session) */
  parent: string;
  /** Name for the child agent */
  name?: string;
  /** Role for the child agent */
  role?: string;
  /** Metadata for the child agent */
  metadata?: Record<string, unknown>;
  /** Scopes the child should request (for credential delegation) */
  requestedScopes?: string[];
  /** TTL for delegated credentials in minutes */
  ttlMinutes?: number;
}

/**
 * Create handlers for agent-related methods.
 *
 * Methods:
 * - `map/agents/register` - Register a new agent
 * - `map/agents/unregister` - Unregister an agent
 * - `map/agents/list` - List agents with optional filters
 * - `map/agents/get` - Get a specific agent
 * - `map/agents/update` - Update agent state and/or metadata (protocol method)
 * - `map/agents/update/state` - Update agent state (legacy)
 * - `map/agents/update/metadata` - Update agent metadata (legacy)
 * - `map/agents/spawn` - Spawn a child agent with delegated credentials
 */
export function createAgentHandlers(options: AgentHandlerOptions): HandlerRegistry {
  const { agents, sessions, authManager } = options;

  return {
    "map/agents/register": async (params: unknown, ctx: HandlerContext) => {
      const { name, role, metadata, capabilities } = params as RegisterParams;

      const registeredAgent = agents.register({
        name,
        role,
        metadata,
        sessionId: ctx.session.id,
        capabilities,
      });

      // Track agent in session - use SessionManager if available for atomic updates
      if (sessions) {
        sessions.addAgent(ctx.session.id, registeredAgent.id);
      } else {
        // Legacy fallback: direct mutation (not recommended)
        ctx.session.agentIds.push(registeredAgent.id);
      }

      // Return protocol-compliant response with agent wrapped
      return {
        agent: {
          id: registeredAgent.id,
          name: registeredAgent.name,
          role: registeredAgent.role,
          state: registeredAgent.state,
          metadata: registeredAgent.metadata,
          capabilities: registeredAgent.capabilities,
          visibility: "public",
        },
      };
    },

    "map/agents/unregister": async (params: unknown, ctx: HandlerContext) => {
      const { agentId } = params as UnregisterParams;

      const success = agents.unregister(agentId);
      if (!success) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      // Remove from session tracking - use SessionManager if available
      if (sessions) {
        sessions.removeAgent(ctx.session.id, agentId);
      } else {
        // Legacy fallback: direct mutation (not recommended)
        const index = ctx.session.agentIds.indexOf(agentId);
        if (index !== -1) {
          ctx.session.agentIds.splice(index, 1);
        }
      }

      return { success: true };
    },

    "map/agents/list": async (params: unknown) => {
      const filter = params as ListParams;
      const agentList = agents.list(filter);

      // Return protocol-compliant response
      return {
        agents: agentList.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          state: a.state,
          metadata: a.metadata,
          capabilities: a.capabilities,
          visibility: "public",
        })),
      };
    },

    "map/agents/get": async (params: unknown) => {
      const { agentId } = params as GetParams;
      const agent = agents.get(agentId);

      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      // Return protocol-compliant response
      return {
        agent: {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          state: agent.state,
          metadata: agent.metadata,
          capabilities: agent.capabilities,
          visibility: "public",
        },
      };
    },

    "map/agents/update": async (params: unknown) => {
      const { agentId, state, metadata } = params as UpdateParams;

      let agent = agents.get(agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      // Update state if provided
      if (state !== undefined) {
        agent = agents.updateState(agentId, state);
      }

      // Update metadata if provided
      if (metadata !== undefined) {
        agent = agents.updateMetadata(agentId, metadata);
      }

      // Return protocol-compliant response
      return {
        agent: {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          state: agent.state,
          metadata: agent.metadata,
          capabilities: agent.capabilities,
          visibility: "public",
        },
      };
    },

    "map/agents/update/state": async (params: unknown) => {
      const { agentId, state } = params as UpdateStateParams;
      try {
        return agents.updateState(agentId, state);
      } catch (error) {
        if (error instanceof AgentNotFoundError) {
          throw MAPRequestError.agentNotFound(agentId);
        }
        if (error instanceof InvalidStateTransitionError) {
          throw MAPRequestError.stateInvalid(state, "transition");
        }
        if (error instanceof InvalidAgentStateError) {
          throw MAPRequestError.stateInvalid(state, "update");
        }
        throw error;
      }
    },

    "map/agents/update/metadata": async (params: unknown) => {
      const { agentId, metadata } = params as UpdateMetadataParams;
      try {
        return agents.updateMetadata(agentId, metadata);
      } catch (error) {
        if (error instanceof AgentNotFoundError) {
          throw MAPRequestError.agentNotFound(agentId);
        }
        throw error;
      }
    },

    "map/agents/spawn": async (params: unknown, ctx: HandlerContext) => {
      const { parent, name, role, metadata, requestedScopes, ttlMinutes } = params as SpawnParams;

      // Validate parent agent exists and belongs to calling session
      const parentAgent = agents.get(parent);
      if (!parentAgent) {
        throw new Error(`Parent agent not found: ${parent}`);
      }
      if (parentAgent.sessionId !== ctx.session.id) {
        throw new Error(`Parent agent ${parent} does not belong to this session`);
      }

      // Register the child agent
      const childAgent = agents.register({
        name: name ?? `${parentAgent.name}-child`,
        role,
        metadata: {
          ...metadata,
          parentId: parent,
        },
        sessionId: ctx.session.id,
      });

      // Track child in session
      if (sessions) {
        sessions.addAgent(ctx.session.id, childAgent.id);
      } else {
        ctx.session.agentIds.push(childAgent.id);
      }

      // Delegate credentials if authManager supports it
      let delegatedCredentials: Record<string, unknown> | undefined;
      if (authManager && ctx.session.providers) {
        const manager = authManager as AuthManagerImpl;
        if (typeof manager.delegateForSpawn === 'function') {
          const result = await manager.delegateForSpawn(ctx.session, {
            childAgentId: childAgent.id,
            requestedScopes,
            ttlMinutes,
          });
          if (result) {
            delegatedCredentials = {
              method: result.method,
              credentials: result.credentials,
              ...(result.env && { env: result.env }),
            };
          }
        }
      }

      const response: Record<string, unknown> = {
        agent: {
          id: childAgent.id,
          name: childAgent.name,
          role: childAgent.role,
          state: childAgent.state,
          metadata: childAgent.metadata,
          visibility: "public",
        },
      };
      if (delegatedCredentials) {
        response.delegatedCredentials = delegatedCredentials;
      }
      return response;
    },
  };
}
