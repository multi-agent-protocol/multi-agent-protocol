/**
 * Authentication types for MAP Server
 *
 * Defines the interfaces for pluggable authentication.
 */

import type {
  AuthMethod,
  AuthCredentials,
  AuthResult,
  AuthPrincipal,
  ServerAuthCapabilities,
  ParticipantCapabilities,
  AgentPermissions,
} from '../../types';

/**
 * Context provided to authenticators during authentication.
 */
export interface AuthContext {
  /** Transport type (websocket, stdio, etc.) */
  transportType?: string;
  /** Remote address (if available) */
  remoteAddress?: string;
  /** TLS certificate info (for mTLS) */
  tlsCertificate?: {
    subject: string;
    issuer: string;
    fingerprint: string;
    validFrom: Date;
    validTo: Date;
  };
  /** Additional transport-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Authenticator interface.
 *
 * Implement this interface to add custom authentication methods.
 */
export interface Authenticator {
  /** Which authentication method(s) this authenticator handles */
  readonly methods: readonly AuthMethod[];

  /**
   * Authenticate credentials.
   *
   * @param credentials - The credentials to validate
   * @param context - Additional context about the connection
   * @returns Authentication result with principal or error
   */
  authenticate(
    credentials: AuthCredentials,
    context: AuthContext
  ): Promise<AuthResult>;

  /**
   * Optional: Called when the authenticator is registered.
   * Use for async initialization (e.g., fetching JWKS).
   */
  initialize?(): Promise<void>;

  /**
   * Optional: Called when the server is shutting down.
   * Use for cleanup (e.g., clearing caches, closing connections).
   */
  shutdown?(): Promise<void>;
}

/**
 * Configuration for the authentication system.
 */
export interface AuthConfig {
  /** Is authentication required for connections? */
  required: boolean;

  /** Registered authenticators */
  authenticators: Authenticator[];

  /** OAuth2 authorization server metadata URL (for client discovery) */
  oauth2MetadataUrl?: string;

  /** JWKS URL (for client-side token verification info) */
  jwksUrl?: string;

  /** Server realm identifier */
  realm?: string;

  /**
   * Transport-based auth bypass.
   * If true, connections via certain transports skip auth.
   * @example { stdio: true } - Skip auth for subprocess agents
   */
  bypassForTransports?: Record<string, boolean>;
}

/**
 * Authentication manager interface.
 *
 * Coordinates multiple authenticators and handles auth flow.
 */
export interface AuthManager {
  /** Get the auth configuration */
  readonly config: AuthConfig;

  /** Get supported auth methods */
  readonly supportedMethods: AuthMethod[];

  /** Get server auth capabilities (for advertising to clients) */
  getCapabilities(): ServerAuthCapabilities;

  /**
   * Authenticate credentials using registered authenticators.
   *
   * @param credentials - The credentials to validate
   * @param context - Additional context about the connection
   * @returns Authentication result
   */
  authenticate(
    credentials: AuthCredentials,
    context: AuthContext
  ): Promise<AuthResult>;

  /**
   * Check if auth should be bypassed for a given context.
   *
   * @param context - Connection context
   * @returns true if auth can be skipped
   */
  shouldBypass(context: AuthContext): boolean;

  /**
   * Initialize all authenticators.
   */
  initialize(): Promise<void>;

  /**
   * Shutdown all authenticators.
   */
  shutdown(): Promise<void>;
}

/**
 * Options for creating an AuthManager.
 */
export interface AuthManagerOptions {
  /** Is authentication required? */
  required?: boolean;

  /** Authenticators to register */
  authenticators?: Authenticator[];

  /** Auth providers (extended authenticators with capability mapping) */
  providers?: AuthProvider[];

  /** OAuth2 metadata URL */
  oauth2MetadataUrl?: string;

  /** JWKS URL */
  jwksUrl?: string;

  /** Server realm */
  realm?: string;

  /** Transports that bypass auth */
  bypassForTransports?: Record<string, boolean>;
}

/**
 * Helper type for creating authenticator options.
 */
export interface AuthenticatorOptions {
  /** Optional name for this authenticator instance */
  name?: string;
}

// =============================================================================
// Auth Provider (Extended Authenticator)
// =============================================================================

/**
 * Extended authenticator that manages its own token lifecycle.
 *
 * Providers go beyond simple credential validation to provide:
 * - Capability mapping (external permissions → MAP capabilities)
 * - Spawn delegation (create attenuated credentials for child agents)
 * - Federation (cross-system token handling)
 *
 * Existing Authenticator implementations continue to work unchanged.
 */
export interface AuthProvider extends Authenticator {
  /** Unique identifier for this provider (e.g., 'agent-iam') */
  readonly providerId: string;

  /**
   * Map provider-specific data to MAP capabilities.
   * Called after successful authentication to determine what the principal can do.
   */
  mapCapabilities?(
    principal: AuthPrincipal,
    providerData: unknown
  ): CapabilityMapping;

  /**
   * Delegate credentials when spawning a child agent.
   * Creates attenuated credentials for the child.
   */
  delegateForSpawn?(
    parentPrincipal: AuthPrincipal,
    parentProviderData: unknown,
    spawnRequest: SpawnDelegationRequest
  ): Promise<DelegatedCredentials>;

  /**
   * Handle an incoming federated token from another system.
   */
  handleFederatedToken?(
    sourceSystemId: string,
    token: unknown,
    context: FederationContext
  ): Promise<FederationResult>;

  /**
   * Prepare a token for use in another system.
   */
  prepareFederatedToken?(
    principal: AuthPrincipal,
    providerData: unknown,
    targetSystemId: string
  ): Promise<{ token: string; allowed: boolean; reason?: string }>;
}

/**
 * Result of mapping provider capabilities to MAP capabilities.
 */
export interface CapabilityMapping {
  /** Mapped participant capabilities */
  participantCapabilities: Partial<ParticipantCapabilities>;
  /** Default agent-level permissions */
  defaultAgentPermissions?: Partial<AgentPermissions>;
  /** Additional claims to merge into principal */
  additionalClaims?: Record<string, unknown>;
}

/**
 * Request to delegate credentials for a spawned child agent.
 */
export interface SpawnDelegationRequest {
  childAgentId: string;
  requestedScopes?: string[];
  requestedCapabilities?: Record<string, boolean>;
  ttlMinutes?: number;
  inheritIdentity?: boolean;
}

/**
 * Credentials returned for a spawned child agent.
 */
export interface DelegatedCredentials {
  /** Auth method for the child to use */
  method: AuthMethod;
  /** Credentials the child should present to connect */
  credentials: Record<string, unknown>;
  /** Environment variables to pass to the child process */
  env?: Record<string, string>;
}

/**
 * Context for federation token handling.
 */
export interface FederationContext {
  localSystemId: string;
  trustConfig?: FederationTrustConfig;
}

/**
 * Trust configuration for federated systems.
 */
export interface FederationTrustConfig {
  trustedSystems?: string[];
  scopeMapping?: Record<string, string>;
  maxHops?: number;
}

/**
 * Result of handling a federated token.
 */
export interface FederationResult {
  allowed: boolean;
  principal?: AuthPrincipal;
  providerData?: unknown;
  reason?: string;
}

// =============================================================================
// JWT Claims
// =============================================================================

/**
 * JWT-specific claims that MAP recognizes.
 */
export interface MAPJWTClaims {
  /** Subject (principal ID) */
  sub?: string;
  /** Issuer */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** Expiration time (Unix timestamp) */
  exp?: number;
  /** Issued at (Unix timestamp) */
  iat?: number;
  /** Not before (Unix timestamp) */
  nbf?: number;
  /** JWT ID */
  jti?: string;
  /** Space-separated scopes */
  scope?: string;
  /** MAP-specific capabilities */
  'map:capabilities'?: Record<string, boolean>;
  /** Additional claims */
  [key: string]: unknown;
}
