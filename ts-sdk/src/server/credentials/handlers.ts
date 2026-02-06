/**
 * Credential brokering handler factories.
 *
 * Creates JSON-RPC handlers for credential-related methods.
 * Agents must first authenticate with `x-agent-iam` so that a token
 * is stored on the session; these handlers read that token to authorize
 * credential requests via the broker.
 */

import type { HandlerContext, HandlerRegistry, EventBus } from '../types';
import type { BrokerLike } from './types';

// =============================================================================
// Options
// =============================================================================

/**
 * Options for creating credential brokering handlers.
 */
export interface CredentialHandlerOptions {
  /** Broker instance (satisfies BrokerLike — e.g. agent-iam Broker) */
  broker: BrokerLike;
  /** EventBus for audit events (optional) */
  eventBus?: EventBus;
  /** If set, only these providers are available via cred/status */
  allowedProviders?: string[];
}

// =============================================================================
// Params
// =============================================================================

interface CredGetParams {
  /** Scope to request (e.g. 'github:repo:write') */
  scope: string;
  /** Resource to access (e.g. 'acme-corp/frontend') */
  resource: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Shape expected on token provider data for audit/listing purposes.
 * The concrete type is owned by the auth provider (e.g. AgentIAMToken);
 * we only require the subset needed by credential handlers.
 */
interface TokenLike {
  agentId: string;
  scopes: string[];
  constraints?: Record<string, unknown>;
  expiresAt?: string;
}

/**
 * Extract the agent-iam token from the session's provider data.
 * Throws if the session has not been authenticated with x-agent-iam.
 */
function getTokenFromSession(ctx: HandlerContext): TokenLike {
  const providerData = ctx.session.providers?.['agent-iam']?.providerData;
  if (!providerData) {
    throw new Error(
      'No agent-iam token on session',
    );
  }
  return providerData as TokenLike;
}

// =============================================================================
// Handler Factory
// =============================================================================

/**
 * Create handlers for credential brokering methods.
 *
 * Methods:
 * - `cred/get` — Request a short-lived credential for a scope + resource
 * - `cred/list` — List available scopes for the current token
 * - `cred/status` — Check broker status and configured providers
 */
export function createCredentialHandlers(
  options: CredentialHandlerOptions,
): HandlerRegistry {
  const { broker, eventBus, allowedProviders } = options;

  return {
    'cred/get': async (params: unknown, ctx: HandlerContext) => {
      const { scope, resource } = (params ?? {}) as Partial<CredGetParams>;

      if (!scope || typeof scope !== 'string') {
        throw new Error('Missing required parameter: scope');
      }
      if (!resource || typeof resource !== 'string') {
        throw new Error('Missing required parameter: resource');
      }

      const token = getTokenFromSession(ctx);

      // Explicit permission check before getCredential so we can emit an
      // accurate denial audit event. getCredential also checks internally,
      // but its errors are indistinguishable from provider failures.
      const check = broker.checkPermission(token, scope, resource);

      if (!check.valid) {
        // Emit denial audit event
        if (eventBus) {
          eventBus.emit({
            type: 'credential.denied',
            data: {
              agentId: token.agentId,
              scope,
              resource,
              reason: check.error,
            },
            source: { agentId: token.agentId },
          });
        }

        throw new Error(check.error ?? 'Permission denied');
      }

      // Get credential from provider
      const credential = await broker.getCredential(token, scope, resource);

      // Emit issuance audit event (never include the credential itself)
      if (eventBus) {
        eventBus.emit({
          type: 'credential.issued',
          data: {
            agentId: token.agentId,
            scope,
            resource,
            credentialType: credential.credentialType,
            expiresAt: credential.expiresAt,
          },
          source: { agentId: token.agentId },
        });
      }

      return credential;
    },

    'cred/list': async (_params: unknown, ctx: HandlerContext) => {
      const token = getTokenFromSession(ctx);

      return {
        agentId: token.agentId,
        scopes: token.scopes,
        constraints: token.constraints,
        expiresAt: token.expiresAt,
      };
    },

    // Deliberately does not require authentication — status is public
    // information that helps agents decide whether to authenticate.
    'cred/status': async () => {
      const status = broker.getStatus();

      // Filter to allowed providers if configured
      const providers = allowedProviders
        ? status.providers.filter((p) => allowedProviders.includes(p))
        : status.providers;

      return { providers };
    },
  };
}
