/**
 * Federation handlers
 *
 * Handler factory for federation-specific protocol methods.
 */

import type {
  HandlerRegistry,
  HandlerContext,
  FederationGateway,
  PeerConnection,
  ServerFederationEnvelope,
} from "../types";
import type { AuthManager } from "../auth/types";
import type { FederationAuth } from "../../types";
import { generateFederationChallenge } from "../../federation/challenge";

/**
 * Options for creating federation handlers.
 */
export interface FederationHandlerOptions {
  /** The federation gateway */
  gateway: FederationGateway;
  /** Auth manager for single-request federation authentication */
  authManager?: AuthManager;
}

/**
 * Error thrown when federation operation fails.
 */
export class FederationError extends Error {
  readonly code: number;

  constructor(message: string, code: number = -32000) {
    super(message);
    this.name = "FederationError";
    this.code = code;
  }
}

/**
 * Error thrown when caller doesn't have federation permissions.
 */
export class FederationPermissionError extends FederationError {
  constructor(message: string = "Federation operations require gateway role") {
    super(message, -32003);
    this.name = "FederationPermissionError";
  }
}

/**
 * Create handlers for federation protocol methods.
 *
 * @example
 * ```typescript
 * const federationHandlers = createFederationHandlers({ gateway });
 *
 * const allHandlers = combineHandlers(
 *   createAgentHandlers({ agents, eventBus }),
 *   createScopeHandlers({ scopes, eventBus }),
 *   federationHandlers,
 * );
 * ```
 */
export function createFederationHandlers(
  options: FederationHandlerOptions
): HandlerRegistry {
  const { gateway } = options;

  return {
    /**
     * Connect to a peer system.
     *
     * Supports single-request authentication: if `auth` is provided in params,
     * the server attempts immediate authentication in the same round trip.
     * If auth is not provided or fails recoverably, returns `authRequired`
     * for the client to retry with credentials.
     *
     * @param params.systemId - ID of the peer system
     * @param params.endpoint - WebSocket or other endpoint URL
     * @param params.auth - Optional authentication credentials (single-request auth)
     * @param params.credentials - Legacy authentication credentials
     * @returns The peer connection with optional auth result
     */
    "map/federation/connect": async (
      params: {
        systemId: string;
        endpoint: string;
        auth?: FederationAuth;
        credentials?: unknown;
        authContext?: { source: string; challenge?: string };
        systemInfo?: { name: string; version: string; endpoint: string };
        protocolVersion?: string;
        exposure?: Record<string, unknown>;
      },
      ctx: HandlerContext
    ): Promise<PeerConnection & {
      connected: boolean;
      principal?: { id: string; issuer?: string; claims?: Record<string, unknown> };
      authRequired?: { methods: string[]; challenge?: string; required: boolean };
    }> => {
      validateGatewayRole(ctx);

      if (!params.systemId) {
        throw new FederationError("systemId is required");
      }
      if (!params.endpoint) {
        throw new FederationError("endpoint is required");
      }

      const { authManager } = options;

      // Single-request auth: if credentials provided, attempt immediate authentication
      if (params.auth && authManager) {
        const authResult = await authManager.authenticate(
          {
            method: params.auth.method as any,
            credential: params.auth.credentials,
            metadata: params.auth.metadata,
          },
          {
            transportType: 'federation',
            metadata: { systemId: params.systemId, endpoint: params.endpoint },
          }
        );

        if (!authResult.success) {
          // Recoverable failure — return authRequired so client can retry
          return {
            systemId: params.systemId,
            endpoint: params.endpoint,
            status: "disconnected",
            connected: false,
            authRequired: {
              methods: authManager.supportedMethods,
              challenge: generateFederationChallenge(),
              required: true,
            },
          };
        }

        // Auth succeeded — connect with principal
        try {
          const peer = await gateway.connectPeer({
            systemId: params.systemId,
            endpoint: params.endpoint,
            credentials: params.auth.credentials,
          });
          return {
            ...peer,
            connected: true,
            principal: authResult.principal,
            sessionId: `fed_${params.systemId}_${Date.now()}`,
          };
        } catch (error) {
          throw new FederationError(
            `Failed to connect to peer ${params.systemId}: ${(error as Error).message}`
          );
        }
      }

      // No auth provided — check if auth is required
      if (authManager && authManager.config.required) {
        return {
          systemId: params.systemId,
          endpoint: params.endpoint,
          status: "disconnected",
          connected: false,
          authRequired: {
            methods: authManager.supportedMethods,
            challenge: generateFederationChallenge(),
            required: true,
          },
        };
      }

      // No auth required — proceed with existing behavior (backwards-compatible)
      try {
        const peer = await gateway.connectPeer({
          systemId: params.systemId,
          endpoint: params.endpoint,
          credentials: params.credentials,
        });
        return { ...peer, connected: true };
      } catch (error) {
        throw new FederationError(
          `Failed to connect to peer ${params.systemId}: ${(error as Error).message}`
        );
      }
    },

    /**
     * Disconnect from a peer system.
     *
     * @param params.systemId - ID of the peer system to disconnect
     */
    "map/federation/disconnect": async (
      params: { systemId: string },
      ctx: HandlerContext
    ): Promise<void> => {
      validateGatewayRole(ctx);

      if (!params.systemId) {
        throw new FederationError("systemId is required");
      }

      gateway.disconnectPeer(params.systemId);
    },

    /**
     * List connected peer systems.
     *
     * @returns Array of peer connections
     */
    "map/federation/list": async (
      _params: unknown,
      ctx: HandlerContext
    ): Promise<PeerConnection[]> => {
      validateGatewayRole(ctx);

      return gateway.listPeers();
    },

    /**
     * Route a message to a peer system.
     *
     * @param params.systemId - Target peer system ID
     * @param params.payload - Message payload to send
     * @param params.maxHops - Maximum number of hops (for loop prevention)
     */
    "map/federation/route": async (
      params: {
        systemId: string;
        payload: unknown;
        maxHops?: number;
      },
      ctx: HandlerContext
    ): Promise<{ queued: boolean }> => {
      validateGatewayRole(ctx);

      if (!params.systemId) {
        throw new FederationError("systemId is required");
      }
      if (params.payload === undefined) {
        throw new FederationError("payload is required");
      }

      const envelope: ServerFederationEnvelope = {
        payload: params.payload,
        routing: {
          from: (gateway as any).systemId,
          to: params.systemId,
          hops: [],
          maxHops: params.maxHops ?? 5,
        },
        timestamp: Date.now(),
      };

      try {
        await gateway.routeToPeer(params.systemId, envelope);

        // Check if it was queued (peer not connected) or sent
        const peer = gateway.listPeers().find((p) => p.systemId === params.systemId);
        const queued = !peer || peer.status !== "connected";

        return { queued };
      } catch (error) {
        throw new FederationError(
          `Failed to route to ${params.systemId}: ${(error as Error).message}`
        );
      }
    },

    /**
     * Get buffer statistics.
     *
     * @returns Buffer stats including total messages and per-system counts
     */
    "map/federation/buffer/stats": async (
      _params: unknown,
      ctx: HandlerContext
    ): Promise<{ total: number; bySystem: Record<string, number> }> => {
      validateGatewayRole(ctx);

      return gateway.buffer.stats();
    },

    /**
     * Flush buffered messages for a peer.
     *
     * @param params.systemId - Peer system to flush buffer for
     * @returns Number of messages that were buffered
     */
    "map/federation/buffer/flush": async (
      params: { systemId: string },
      ctx: HandlerContext
    ): Promise<{ count: number }> => {
      validateGatewayRole(ctx);

      if (!params.systemId) {
        throw new FederationError("systemId is required");
      }

      const messages = gateway.buffer.flush(params.systemId);
      return { count: messages.length };
    },
  };
}

/**
 * Validate that the session has gateway role.
 */
function validateGatewayRole(ctx: HandlerContext): void {
  if (ctx.session.role !== "gateway") {
    throw new FederationPermissionError();
  }
}
