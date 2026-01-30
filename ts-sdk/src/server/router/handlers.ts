/**
 * Connection handler factories
 *
 * Creates JSON-RPC handlers for connection-related methods.
 */

import type {
  SessionManager,
  AgentRegistry,
  SubscriptionManager,
  ScopeManager,
  HandlerContext,
  HandlerRegistry,
} from "../types";

/**
 * Options for creating connection handlers.
 */
export interface ConnectionHandlerOptions {
  sessions: SessionManager;
  agents?: AgentRegistry;
  subscriptions?: SubscriptionManager;
  scopes?: ScopeManager;
  /** Server name for connect response */
  serverName?: string;
  /** Server version for connect response */
  serverVersion?: string;
}

/**
 * Parameters for connect request.
 */
interface ConnectParams {
  /**
   * Specific agent IDs to reclaim on session resume.
   * If provided, validates that these agents exist and belong to this session.
   * If not provided, all session agents are reclaimed automatically.
   */
  reclaimAgents?: string[];
}

/**
 * Create handlers for connection-related methods.
 *
 * Methods:
 * - `map/connect` - Get session info (session already created by RouterConnection)
 * - `map/disconnect` - Disconnect the session
 * - `map/session/info` - Get current session information
 */
export function createConnectionHandlers(
  options: ConnectionHandlerOptions
): HandlerRegistry {
  const { sessions, agents, subscriptions, scopes, serverName, serverVersion } = options;

  return {
    "map/connect": async (params: unknown, ctx: HandlerContext) => {
      const { reclaimAgents } = (params ?? {}) as ConnectParams;

      // Session is already created/resumed by RouterConnection.start()
      // Check if this is a resumed session by looking at whether it has pre-existing agents
      const isResumed = ctx.session.agentIds.length > 0;

      // Track which agents were actually reclaimed
      let reclaimedAgents: string[] = [];

      // If reclaimAgents is specified, validate and reclaim only those agents
      if (reclaimAgents && reclaimAgents.length > 0 && agents) {
        const errors: string[] = [];

        for (const agentId of reclaimAgents) {
          const agent = agents.get(agentId);

          if (!agent) {
            errors.push(`Agent not found: ${agentId}`);
            continue;
          }

          if (agent.sessionId !== ctx.session.id) {
            errors.push(`Agent ${agentId} belongs to different session`);
            continue;
          }

          // Agent exists and belongs to this session
          reclaimedAgents.push(agentId);
        }

        // If any errors occurred, throw with all error messages
        if (errors.length > 0) {
          throw new Error(`Failed to reclaim agents: ${errors.join("; ")}`);
        }
      } else {
        // No specific agents requested - all session agents are reclaimed
        reclaimedAgents = [...ctx.session.agentIds];
      }

      // Return protocol-compliant connect response
      return {
        protocolVersion: "2024-12",
        sessionId: ctx.session.id,
        participantId: ctx.session.id, // Use session ID as participant ID
        capabilities: {
          roles: [ctx.session.role],
          features: [],
        },
        systemInfo: {
          name: serverName ?? "MAP Server",
          version: serverVersion ?? "1.0.0",
        },
        reconnected: isResumed,
        ownedAgents: ctx.session.agentIds,
        reclaimedAgents: reclaimedAgents,
      };
    },

    "map/disconnect": async (_params: unknown, ctx: HandlerContext) => {
      // Disconnect session (makes it resumable)
      // NOTE: We preserve agents, subscriptions, and scope memberships for session resume.
      // They will be reclaimed when the session resumes, or cleaned up by ResourceCleaner
      // if the session expires without resuming.
      const resumeToken = sessions.disconnect(ctx.session.id);

      return {
        success: true,
        resumeToken,
      };
    },

    "map/session/info": async (_params: unknown, ctx: HandlerContext) => {
      return {
        id: ctx.session.id,
        role: ctx.session.role,
        name: ctx.session.name,
        status: ctx.session.status,
        connectedAt: ctx.session.connectedAt,
        lastActivity: ctx.session.lastActivity,
        agentIds: ctx.session.agentIds,
        subscriptionIds: ctx.session.subscriptionIds,
      };
    },

    "map/session/close": async (_params: unknown, ctx: HandlerContext) => {
      // Permanently close the session (not resumable)

      // Clean up all resources
      if (agents) {
        agents.unregisterBySession(ctx.session.id);
      }

      if (subscriptions) {
        subscriptions.cancelBySession(ctx.session.id);
      }

      if (scopes && agents) {
        for (const agentId of ctx.session.agentIds) {
          scopes.leaveAll(agentId);
        }
      }

      // Close session permanently
      sessions.close(ctx.session.id);

      return { success: true };
    },
  };
}

/**
 * Combine all handler factories into a single registry.
 */
export function combineHandlers(...registries: HandlerRegistry[]): HandlerRegistry {
  const combined: HandlerRegistry = {};

  for (const registry of registries) {
    for (const [method, handler] of Object.entries(registry)) {
      if (combined[method]) {
        console.warn(`Handler for ${method} already exists, overwriting`);
      }
      combined[method] = handler;
    }
  }

  return combined;
}
