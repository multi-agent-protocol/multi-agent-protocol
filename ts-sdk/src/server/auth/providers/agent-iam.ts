/**
 * AgentIAMProvider — AuthProvider implementation for agent-iam tokens.
 *
 * Accepts a TokenServiceLike instance via constructor injection so the
 * consumer brings their own `agent-iam` dependency (it is not bundled
 * with the MAP SDK).
 *
 * @example
 * ```typescript
 * import { TokenService } from 'agent-iam';
 * import { AgentIAMProvider } from '@multi-agent-protocol/sdk/server/auth';
 *
 * const tokenService = new TokenService(secret);
 * const provider = new AgentIAMProvider({ tokenService, systemId: 'my-system' });
 * ```
 */

import type {
  AuthMethod,
  AuthCredentials,
  AuthResult,
  AuthPrincipal,
} from '../../../types';
import type {
  AuthContext,
  AuthProvider,
  CapabilityMapping,
  SpawnDelegationRequest,
  DelegatedCredentials,
  FederationContext,
  FederationResult,
} from '../types';
import {
  AgentIAMCapabilityMapper,
  type AgentIAMCapabilityMapperOptions,
  type MappableToken,
} from './agent-iam-mapper';
import type { AgentIAMFederationGateway } from './agent-iam-federation';

// =============================================================================
// Minimal interfaces consumed by the provider.
// Match the agent-iam API surface without importing the package.
// =============================================================================

/**
 * Minimal token shape expected from agent-iam.
 * Extends MappableToken with fields needed for authentication.
 */
export interface AgentIAMToken extends MappableToken {
  agentId: string;
  parentId?: string;
  delegatable: boolean;
  maxDelegationDepth: number;
  currentDepth: number;
  expiresAt?: string;
  constraints: Record<string, unknown>;
  signature?: string;
  identity?: {
    systemId: string;
    principalId?: string;
    principalType?: 'human' | 'service' | 'agent';
    tenantId?: string;
    organizationId?: string;
  };
  federation?: {
    crossSystemAllowed: boolean;
    allowedSystems?: string[];
    originSystem?: string;
    hopCount?: number;
    maxHops?: number;
    allowFurtherFederation?: boolean;
  };
  /**
   * Persistent identity binding (agent-iam 0.0.3+).
   * When present, the token carries a stable identity that survives
   * across sessions, token refreshes, and delegation chains.
   */
  persistentIdentity?: {
    persistentId: string;
    identityType: string;
    proof?: string;
    challenge?: string;
    publicKey?: string;
    publicKeyJwk?: { kty: string; crv?: string; x?: string; [key: string]: unknown };
    endorsements?: unknown[];
  };
}

/**
 * Minimal TokenService interface.
 * Consumers provide an instance that satisfies this shape
 * (e.g. `new TokenService(secret)` from agent-iam).
 */
export interface TokenServiceLike {
  verify(token: AgentIAMToken): { valid: boolean; error?: string };
  serialize(token: AgentIAMToken): string;
  deserialize(serialized: string): AgentIAMToken;
  delegate(parent: AgentIAMToken, request: {
    agentId?: string;
    requestedScopes: string[];
    delegatable?: boolean;
    ttlMinutes?: number;
    inheritIdentity?: boolean;
    inheritPersistentIdentity?: boolean;
    agentCapabilities?: Record<string, unknown>;
  }): AgentIAMToken;
}

// =============================================================================
// Provider options
// =============================================================================

export interface AgentIAMProviderOptions {
  /** A TokenService (or compatible) instance for token operations. */
  tokenService: TokenServiceLike;
  /** Expected system ID — tokens with a mismatched identity.systemId are rejected. */
  systemId?: string;
  /** Expected tenant ID — tokens with a mismatched identity.tenantId are rejected. */
  tenantId?: string;
  /** Options forwarded to the capability mapper. */
  mapperOptions?: AgentIAMCapabilityMapperOptions;
  /** Federation gateway for cross-system token verification and preparation. */
  federationGateway?: AgentIAMFederationGateway;
}

// =============================================================================
// AgentIAMProvider
// =============================================================================

export class AgentIAMProvider implements AuthProvider {
  readonly methods: readonly AuthMethod[] = ['x-agent-iam'];
  readonly providerId = 'agent-iam';

  readonly #tokenService: TokenServiceLike;
  readonly #mapper: AgentIAMCapabilityMapper;
  readonly #systemId?: string;
  readonly #tenantId?: string;
  readonly #federationGateway?: AgentIAMFederationGateway;

  constructor(options: AgentIAMProviderOptions) {
    this.#tokenService = options.tokenService;
    this.#systemId = options.systemId;
    this.#tenantId = options.tenantId;
    this.#mapper = new AgentIAMCapabilityMapper(options.mapperOptions);
    this.#federationGateway = options.federationGateway;
  }

  // ---------------------------------------------------------------------------
  // Authenticator interface
  // ---------------------------------------------------------------------------

  async authenticate(
    credentials: AuthCredentials,
    _context: AuthContext
  ): Promise<AuthResult> {
    const raw = credentials.credential;
    if (typeof raw !== 'string' || raw.length === 0) {
      return {
        success: false,
        error: { code: 'invalid_credentials', message: 'Missing or invalid token' },
      };
    }

    // Deserialize
    let token: AgentIAMToken;
    try {
      token = this.#tokenService.deserialize(raw);
    } catch {
      return {
        success: false,
        error: { code: 'invalid_credentials', message: 'Failed to deserialize token' },
      };
    }

    // Verify signature + expiry
    const result = this.#tokenService.verify(token);
    if (!result.valid) {
      return {
        success: false,
        error: { code: 'invalid_credentials', message: result.error ?? 'Token verification failed' },
      };
    }

    // Validate identity binding (if systemId/tenantId are configured)
    if (this.#systemId && token.identity?.systemId && token.identity.systemId !== this.#systemId) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: `Token systemId '${token.identity.systemId}' does not match expected '${this.#systemId}'`,
        },
      };
    }

    if (this.#tenantId && token.identity?.tenantId && token.identity.tenantId !== this.#tenantId) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: `Token tenantId '${token.identity.tenantId}' does not match expected '${this.#tenantId}'`,
        },
      };
    }

    // Build AuthPrincipal
    const principal: AuthPrincipal = {
      id: token.agentId,
      issuer: token.identity?.systemId ?? 'agent-iam',
      persistentId: token.persistentIdentity?.persistentId,
      claims: {
        scopes: token.scopes,
        delegatable: token.delegatable,
        currentDepth: token.currentDepth,
        ...(token.identity?.principalId && { principalId: token.identity.principalId }),
        ...(token.identity?.principalType && { principalType: token.identity.principalType }),
        ...(token.identity?.organizationId && { organizationId: token.identity.organizationId }),
      },
    };

    return {
      success: true,
      principal,
      providerData: token,
    };
  }

  // ---------------------------------------------------------------------------
  // AuthProvider extensions
  // ---------------------------------------------------------------------------

  mapCapabilities(
    _principal: AuthPrincipal,
    providerData: unknown
  ): CapabilityMapping {
    return this.#mapper.map(providerData as MappableToken);
  }

  async delegateForSpawn(
    _parentPrincipal: AuthPrincipal,
    parentProviderData: unknown,
    spawnRequest: SpawnDelegationRequest
  ): Promise<DelegatedCredentials> {
    const parentToken = parentProviderData as AgentIAMToken;

    const childToken = this.#tokenService.delegate(parentToken, {
      agentId: spawnRequest.childAgentId,
      requestedScopes: spawnRequest.requestedScopes ?? parentToken.scopes,
      delegatable: true,
      ttlMinutes: spawnRequest.ttlMinutes,
      inheritIdentity: spawnRequest.inheritIdentity ?? true,
      inheritPersistentIdentity: spawnRequest.inheritIdentity ?? true,
    });

    const serialized = this.#tokenService.serialize(childToken);

    return {
      method: 'x-agent-iam',
      credentials: { token: serialized },
      env: { AGENT_TOKEN: serialized },
    };
  }

  async handleFederatedToken(
    sourceSystemId: string,
    token: unknown,
    context: FederationContext
  ): Promise<FederationResult> {
    if (!this.#federationGateway) {
      return { allowed: false, reason: 'Federation gateway not configured' };
    }
    return this.#federationGateway.handleFederatedToken(sourceSystemId, token, context);
  }

  async prepareFederatedToken(
    principal: AuthPrincipal,
    providerData: unknown,
    targetSystemId: string
  ): Promise<{ token: string; allowed: boolean; reason?: string }> {
    if (!this.#federationGateway) {
      return { token: '', allowed: false, reason: 'Federation gateway not configured' };
    }
    return this.#federationGateway.prepareFederatedToken(principal, providerData, targetSystemId);
  }
}
