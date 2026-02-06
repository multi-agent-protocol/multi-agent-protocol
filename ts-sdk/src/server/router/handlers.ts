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
import type { AuthManager, AuthManagerImpl } from "../auth";
import type { AuthCredentials, AuthResult } from "../../types";
import type { ServerSession } from "../types";

/**
 * Options for creating connection handlers.
 */
/**
 * Mail capability configuration for the server.
 * When provided, mail capabilities are included in the connect response.
 */
export interface MailCapabilityConfig {
  /** Whether mail is enabled on this server */
  enabled: boolean;
  /** Can create new conversations (default: true) */
  canCreate?: boolean;
  /** Can join existing conversations (default: true) */
  canJoin?: boolean;
  /** Can invite participants (default: true) */
  canInvite?: boolean;
  /** Can view conversation history (default: true) */
  canViewHistory?: boolean;
  /** Can create threads within conversations (default: true) */
  canCreateThreads?: boolean;
}

export interface ConnectionHandlerOptions {
  sessions: SessionManager;
  agents?: AgentRegistry;
  subscriptions?: SubscriptionManager;
  scopes?: ScopeManager;
  /** Server name for connect response */
  serverName?: string;
  /** Server version for connect response */
  serverVersion?: string;
  /** Authentication manager (optional) */
  authManager?: AuthManager;
  /** Mail capability configuration (optional). When provided and enabled, mail capabilities are advertised. */
  mailCapabilities?: MailCapabilityConfig;
  /** Credential brokering configuration (optional). When provided and enabled, credential capabilities are advertised. */
  credentialCapabilities?: import('../credentials').CredentialCapabilityConfig;
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
  /**
   * Authentication credentials.
   */
  auth?: AuthCredentials;
}

/**
 * After successful auth, store provider data on session and return capability mapping.
 * Returns the capability overlay if the auth method is backed by an AuthProvider.
 */
function storeProviderData(
  authManager: AuthManager,
  session: ServerSession,
  method: string,
  authResult: AuthResult
): void {
  if (!authResult.success || !authResult.principal || authResult.providerData === undefined) return;

  const manager = authManager as AuthManagerImpl;
  if (typeof manager.getProvider !== 'function') return;

  const provider = manager.getProvider(method);
  if (!provider) return;

  // Store provider data on session
  if (!session.providers) session.providers = {};
  session.providers[provider.providerId] = {
    principal: authResult.principal,
    providerData: authResult.providerData,
  };
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
  const { sessions, agents, subscriptions, scopes, serverName, serverVersion, authManager, mailCapabilities } = options;
  const credentialCapabilities = options.credentialCapabilities;

  return {
    "map/connect": async (params: unknown, ctx: HandlerContext) => {
      const { reclaimAgents, auth } = (params ?? {}) as ConnectParams;

      // Handle authentication if authManager is configured
      if (authManager) {
        // Check if auth should be bypassed for this transport
        const shouldBypass = authManager.shouldBypass({
          transportType: ctx.session.metadata?.transportType as string | undefined,
        });

        if (!shouldBypass) {
          if (auth) {
            // Authenticate with provided credentials
            const authResult = await authManager.authenticate(auth, {
              transportType: ctx.session.metadata?.transportType as string | undefined,
            });

            if (authResult.success && authResult.principal) {
              // Store principal on session
              ctx.session.principal = authResult.principal;
              // Store provider data if auth backed by a provider
              storeProviderData(authManager, ctx.session, auth.method, authResult);
            } else if (authManager.config.required) {
              // Auth failed and is required - return auth required response
              return {
                authRequired: authManager.getCapabilities(),
                error: authResult.error,
              };
            }
          } else if (authManager.config.required) {
            // No auth provided but required - return auth required response
            return {
              authRequired: authManager.getCapabilities(),
            };
          }
        }
      }

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

      // Build capabilities
      const capabilities: Record<string, unknown> = {
        roles: [ctx.session.role],
        features: [],
      };

      // Intersect provider-mapped capabilities if an auth provider contributed
      if (authManager && auth && ctx.session.providers) {
        const manager = authManager as AuthManagerImpl;
        if (typeof manager.getCapabilityMapping === 'function') {
          const mapping = manager.getCapabilityMapping(
            auth.method,
            ctx.session.principal!,
            Object.values(ctx.session.providers)[0]?.providerData
          );
          if (mapping) {
            // Merge provider-mapped participant capabilities into the response
            capabilities.providerCapabilities = mapping.participantCapabilities;
            if (mapping.defaultAgentPermissions) {
              capabilities.defaultAgentPermissions = mapping.defaultAgentPermissions;
            }
          }
        }
      }

      // Include mail capabilities if configured and enabled
      if (mailCapabilities?.enabled) {
        capabilities.mail = {
          enabled: true,
          canCreate: mailCapabilities.canCreate ?? true,
          canJoin: mailCapabilities.canJoin ?? true,
          canInvite: mailCapabilities.canInvite ?? true,
          canViewHistory: mailCapabilities.canViewHistory ?? true,
          canCreateThreads: mailCapabilities.canCreateThreads ?? true,
        };
      }

      // Include credential brokering capabilities if configured and enabled
      if (credentialCapabilities?.enabled) {
        capabilities.credentials = {
          enabled: true,
          canGet: credentialCapabilities.canGet ?? true,
          canList: credentialCapabilities.canList ?? true,
          canStatus: credentialCapabilities.canStatus ?? true,
        };
      }

      // Return protocol-compliant connect response
      return {
        protocolVersion: "2024-12",
        sessionId: ctx.session.id,
        participantId: ctx.session.id, // Use session ID as participant ID
        capabilities,
        systemInfo: {
          name: serverName ?? "MAP Server",
          version: serverVersion ?? "1.0.0",
        },
        reconnected: isResumed,
        ownedAgents: ctx.session.agentIds,
        reclaimedAgents: reclaimedAgents,
        principal: ctx.session.principal,
      };
    },

    "map/authenticate": async (params: unknown, ctx: HandlerContext) => {
      const credentials = params as AuthCredentials;

      if (!authManager) {
        return {
          success: true,
          sessionId: ctx.session.id,
          participantId: ctx.session.id,
          principal: { id: "anonymous" },
        };
      }

      const authResult = await authManager.authenticate(credentials, {
        transportType: ctx.session.metadata?.transportType as string | undefined,
      });

      if (authResult.success && authResult.principal) {
        // Store principal on session
        ctx.session.principal = authResult.principal;
        // Store provider data if auth backed by a provider
        storeProviderData(authManager, ctx.session, credentials.method, authResult);

        return {
          success: true,
          sessionId: ctx.session.id,
          participantId: ctx.session.id,
          principal: authResult.principal,
        };
      }

      return {
        success: false,
        error: authResult.error,
      };
    },

    "map/auth/refresh": async (params: unknown, ctx: HandlerContext) => {
      const credentials = params as AuthCredentials;

      if (!authManager) {
        return {
          success: true,
          principal: ctx.session.principal ?? { id: "anonymous" },
        };
      }

      // Validate the new credentials
      const authResult = await authManager.authenticate(credentials, {
        transportType: ctx.session.metadata?.transportType as string | undefined,
      });

      if (authResult.success && authResult.principal) {
        // Update principal on session
        ctx.session.principal = authResult.principal;
        // Update provider data if auth backed by a provider
        storeProviderData(authManager, ctx.session, credentials.method, authResult);

        return {
          success: true,
          principal: authResult.principal,
        };
      }

      return {
        success: false,
        error: authResult.error ?? {
          code: "invalid_credentials",
          message: "Token refresh failed",
        },
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
