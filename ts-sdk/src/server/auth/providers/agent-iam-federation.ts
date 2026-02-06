/**
 * AgentIAM Federation Gateway — cross-system token verification and preparation.
 *
 * Handles incoming federated tokens (verify with peer's signing key) and
 * prepares outgoing tokens (delegate with local key, short TTL).
 *
 * Each peer system has its own signing key, provided as a TokenServiceLike
 * instance in `peerTokenServices`.
 */

import type { AuthPrincipal } from '../../../types';
import type {
  FederationContext,
  FederationTrustConfig,
  FederationResult,
} from '../types';
import type { TokenServiceLike, AgentIAMToken } from './agent-iam';

// =============================================================================
// Options
// =============================================================================

export interface AgentIAMFederationGatewayOptions {
  /** Local system's TokenService (for delegating outgoing tokens). */
  localTokenService: TokenServiceLike;

  /** Local system identifier. */
  localSystemId: string;

  /**
   * TokenService instances for each trusted peer system.
   * Key: peer's systemId, Value: TokenService configured with that peer's signing key.
   */
  peerTokenServices: Record<string, TokenServiceLike>;

  /**
   * Per-peer trust configuration (scope mapping, max hops).
   * Key: peer's systemId, Value: trust config.
   */
  peerTrustConfigs?: Record<string, FederationTrustConfig>;

  /** Default TTL in minutes for federated tokens. Defaults to 60. */
  federatedTokenTTLMinutes?: number;

  /** Global max hops override. Defaults to 5. */
  defaultMaxHops?: number;
}

// =============================================================================
// Federation Gateway
// =============================================================================

export class AgentIAMFederationGateway {
  readonly #localTokenService: TokenServiceLike;
  readonly #localSystemId: string;
  readonly #peerTokenServices: Map<string, TokenServiceLike>;
  readonly #peerTrustConfigs: Map<string, FederationTrustConfig>;
  readonly #federatedTTL: number;
  readonly #defaultMaxHops: number;

  constructor(options: AgentIAMFederationGatewayOptions) {
    this.#localTokenService = options.localTokenService;
    this.#localSystemId = options.localSystemId;
    this.#peerTokenServices = new Map(Object.entries(options.peerTokenServices));
    this.#peerTrustConfigs = new Map(
      Object.entries(options.peerTrustConfigs ?? {}),
    );
    this.#federatedTTL = options.federatedTokenTTLMinutes ?? 60;
    this.#defaultMaxHops = options.defaultMaxHops ?? 5;
  }

  // ---------------------------------------------------------------------------
  // Incoming: verify a federated token from a peer system
  // ---------------------------------------------------------------------------

  async handleFederatedToken(
    sourceSystemId: string,
    token: unknown,
    context: FederationContext,
  ): Promise<FederationResult> {
    // 1. Look up peer TokenService
    const peerTokenService = this.#peerTokenServices.get(sourceSystemId);
    if (!peerTokenService) {
      return { allowed: false, reason: `Unknown peer system: ${sourceSystemId}` };
    }

    // 2. Check trusted systems list (from context)
    if (context.trustConfig?.trustedSystems) {
      if (!context.trustConfig.trustedSystems.includes(sourceSystemId)) {
        return { allowed: false, reason: 'Source system not in trusted systems list' };
      }
    }

    // 3. Deserialize (string) or use as-is (object)
    let deserializedToken: AgentIAMToken;
    try {
      if (typeof token === 'string') {
        deserializedToken = peerTokenService.deserialize(token);
      } else {
        deserializedToken = token as AgentIAMToken;
      }
    } catch {
      return { allowed: false, reason: 'Failed to deserialize federated token' };
    }

    // 4. Verify signature
    const verification = peerTokenService.verify(deserializedToken);
    if (!verification.valid) {
      return {
        allowed: false,
        reason: verification.error ?? 'Token verification failed',
      };
    }

    // 5. Check federation.crossSystemAllowed
    if (!deserializedToken.federation?.crossSystemAllowed) {
      return { allowed: false, reason: 'Token does not allow cross-system federation' };
    }

    // 6. Check allowedSystems includes local system
    if (
      deserializedToken.federation.allowedSystems &&
      !deserializedToken.federation.allowedSystems.includes(context.localSystemId)
    ) {
      return { allowed: false, reason: 'Local system not in token allowedSystems' };
    }

    // 7. Check hop count
    const hopCount = deserializedToken.federation.hopCount ?? 0;
    const maxHops = Math.min(
      deserializedToken.federation.maxHops ?? this.#defaultMaxHops,
      context.trustConfig?.maxHops ?? this.#defaultMaxHops,
      this.#defaultMaxHops,
    );
    if (hopCount >= maxHops) {
      return { allowed: false, reason: 'Max federation hops exceeded' };
    }

    // 8. Check allowFurtherFederation (only applies after the first hop)
    if (
      hopCount > 0 &&
      deserializedToken.federation.allowFurtherFederation === false
    ) {
      return { allowed: false, reason: 'Token does not allow further federation' };
    }

    // 9. Translate scopes
    const scopeMapping = this.#mergeScopeMapping(sourceSystemId, context);
    const translatedScopes = this.#translateScopes(
      deserializedToken.scopes,
      scopeMapping,
    );

    // 10. Build AuthPrincipal
    const principal: AuthPrincipal = {
      id: `federated:${sourceSystemId}:${deserializedToken.agentId}`,
      issuer: sourceSystemId,
      claims: {
        scopes: translatedScopes,
        federatedFrom: sourceSystemId,
        originSystem:
          deserializedToken.federation.originSystem ?? sourceSystemId,
        hopCount: hopCount + 1,
        originalAgentId: deserializedToken.agentId,
        ...(deserializedToken.identity?.principalId && {
          principalId: deserializedToken.identity.principalId,
        }),
        ...(deserializedToken.identity?.principalType && {
          principalType: deserializedToken.identity.principalType,
        }),
      },
    };

    // 11. Return success
    return {
      allowed: true,
      principal,
      providerData: deserializedToken,
    };
  }

  // ---------------------------------------------------------------------------
  // Outgoing: prepare a token for use in another system
  // ---------------------------------------------------------------------------

  async prepareFederatedToken(
    _principal: AuthPrincipal,
    providerData: unknown,
    targetSystemId: string,
  ): Promise<{ token: string; allowed: boolean; reason?: string }> {
    // 1. Extract token
    if (!providerData) {
      return { token: '', allowed: false, reason: 'No token data available' };
    }
    const sourceToken = providerData as AgentIAMToken;

    // 2. Check crossSystemAllowed
    if (!sourceToken.federation?.crossSystemAllowed) {
      return {
        token: '',
        allowed: false,
        reason: 'Token does not allow cross-system federation',
      };
    }

    // 3. Check allowedSystems includes target
    if (
      sourceToken.federation.allowedSystems &&
      !sourceToken.federation.allowedSystems.includes(targetSystemId)
    ) {
      return {
        token: '',
        allowed: false,
        reason: 'Target system not in token allowedSystems',
      };
    }

    // 4. Check allowFurtherFederation (after first hop)
    const hopCount = sourceToken.federation.hopCount ?? 0;
    if (
      hopCount > 0 &&
      sourceToken.federation.allowFurtherFederation === false
    ) {
      return {
        token: '',
        allowed: false,
        reason: 'Token does not allow further federation',
      };
    }

    // 5. Check hop count
    const maxHops = sourceToken.federation.maxHops ?? this.#defaultMaxHops;
    if (hopCount >= maxHops) {
      return {
        token: '',
        allowed: false,
        reason: 'Max federation hops exceeded',
      };
    }

    // 6. Translate scopes
    const peerTrust = this.#peerTrustConfigs.get(targetSystemId);
    const translatedScopes = this.#translateScopes(
      sourceToken.scopes,
      peerTrust?.scopeMapping,
    );

    // 7. Delegate with short TTL
    const delegated = this.#localTokenService.delegate(sourceToken, {
      agentId: sourceToken.agentId,
      requestedScopes: translatedScopes,
      delegatable: false,
      ttlMinutes: this.#federatedTTL,
      inheritIdentity: true,
    });

    // 8. Set federation metadata on delegated token
    const withFederation: AgentIAMToken = {
      ...delegated,
      federation: {
        crossSystemAllowed: true,
        originSystem:
          sourceToken.federation.originSystem ?? this.#localSystemId,
        hopCount: hopCount + 1,
        maxHops,
        allowFurtherFederation:
          sourceToken.federation.allowFurtherFederation ?? false,
        allowedSystems: sourceToken.federation.allowedSystems,
      },
    };

    // 9. Serialize and return
    const serialized = this.#localTokenService.serialize(withFederation);
    return { token: serialized, allowed: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Merge scope mappings from context trust config and per-peer trust config.
   * Context config takes precedence.
   */
  #mergeScopeMapping(
    peerSystemId: string,
    context: FederationContext,
  ): Record<string, string> | undefined {
    const peerMapping = this.#peerTrustConfigs.get(peerSystemId)?.scopeMapping;
    const contextMapping = context.trustConfig?.scopeMapping;

    if (!peerMapping && !contextMapping) return undefined;

    return { ...peerMapping, ...contextMapping };
  }

  /**
   * Translate scopes using prefix-based mapping.
   * Finds the longest matching prefix and replaces it.
   * Non-matching scopes pass through unchanged.
   */
  #translateScopes(
    scopes: string[],
    scopeMapping: Record<string, string> | undefined,
  ): string[] {
    if (!scopeMapping || Object.keys(scopeMapping).length === 0) {
      return scopes;
    }

    return scopes.map((scope) => {
      let bestMatch = '';
      let bestReplacement = '';

      for (const [from, to] of Object.entries(scopeMapping)) {
        if (scope.startsWith(from) && from.length > bestMatch.length) {
          bestMatch = from;
          bestReplacement = to;
        }
      }

      if (bestMatch) {
        return bestReplacement + scope.slice(bestMatch.length);
      }
      return scope;
    });
  }
}
