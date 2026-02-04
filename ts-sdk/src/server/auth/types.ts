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
