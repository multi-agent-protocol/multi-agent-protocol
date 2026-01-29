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
} from "../types";

/**
 * Options for creating agent handlers.
 */
export interface AgentHandlerOptions {
  agents: AgentRegistry;
}

/**
 * Parameters for agent registration.
 */
interface RegisterParams {
  name: string;
  role?: string;
  metadata?: Record<string, unknown>;
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
 * Create handlers for agent-related methods.
 *
 * Methods:
 * - `map/agents/register` - Register a new agent
 * - `map/agents/unregister` - Unregister an agent
 * - `map/agents/list` - List agents with optional filters
 * - `map/agents/get` - Get a specific agent
 * - `map/agents/update/state` - Update agent state
 * - `map/agents/update/metadata` - Update agent metadata
 */
export function createAgentHandlers(options: AgentHandlerOptions): HandlerRegistry {
  const { agents } = options;

  return {
    "map/agents/register": async (params: unknown, ctx: HandlerContext) => {
      const { name, role, metadata } = params as RegisterParams;

      const agent = agents.register({
        name,
        role,
        metadata,
        sessionId: ctx.session.id,
      });

      // Track agent in session
      ctx.session.agentIds.push(agent.id);

      return agent;
    },

    "map/agents/unregister": async (params: unknown, ctx: HandlerContext) => {
      const { agentId } = params as UnregisterParams;

      const success = agents.unregister(agentId);
      if (!success) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      // Remove from session tracking
      const index = ctx.session.agentIds.indexOf(agentId);
      if (index !== -1) {
        ctx.session.agentIds.splice(index, 1);
      }

      return { success: true };
    },

    "map/agents/list": async (params: unknown) => {
      const filter = params as ListParams;
      return agents.list(filter);
    },

    "map/agents/get": async (params: unknown) => {
      const { agentId } = params as GetParams;
      const agent = agents.get(agentId);

      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      return agent;
    },

    "map/agents/update/state": async (params: unknown) => {
      const { agentId, state } = params as UpdateStateParams;
      return agents.updateState(agentId, state);
    },

    "map/agents/update/metadata": async (params: unknown) => {
      const { agentId, metadata } = params as UpdateMetadataParams;
      return agents.updateMetadata(agentId, metadata);
    },
  };
}
