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
    "map/connect": async (_params: unknown, ctx: HandlerContext) => {
      // Session is already created by RouterConnection.start()
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
        reconnected: false,
        ownedAgents: ctx.session.agentIds,
      };
    },

    "map/disconnect": async (_params: unknown, ctx: HandlerContext) => {
      // Clean up all resources for this session

      // Unregister all agents
      if (agents) {
        agents.unregisterBySession(ctx.session.id);
      }

      // Cancel all subscriptions
      if (subscriptions) {
        subscriptions.cancelBySession(ctx.session.id);
      }

      // Leave all scopes for agents
      if (scopes && agents) {
        for (const agentId of ctx.session.agentIds) {
          scopes.leaveAll(agentId);
        }
      }

      // Disconnect session (makes it resumable)
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
