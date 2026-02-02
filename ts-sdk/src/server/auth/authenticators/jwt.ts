/**
 * JWTAuthenticator - JWT/Bearer token authentication
 *
 * Validates JWT tokens using JWKS (JSON Web Key Set) or static keys.
 * Supports RS256, RS384, RS512, ES256, ES384, ES512, and HS256 algorithms.
 *
 * Requires the 'jose' package: npm install jose
 */

import type { AuthCredentials, AuthResult } from '../../../types';
import type { Authenticator, AuthContext, AuthenticatorOptions, MAPJWTClaims } from '../types';

/**
 * Options for JWTAuthenticator.
 */
export interface JWTAuthenticatorOptions extends AuthenticatorOptions {
  /**
   * JWKS URL for fetching public keys.
   * Keys are cached and refreshed automatically.
   *
   * @example 'https://auth.example.com/.well-known/jwks.json'
   */
  jwksUrl?: string;

  /**
   * Static JWKS (JSON Web Key Set) if not using a URL.
   * Use this for testing or when keys don't change.
   */
  jwks?: JsonWebKeySet;

  /**
   * Symmetric secret for HS256 tokens.
   * Only use this for testing or when tokens are issued by this server.
   */
  secret?: string | Uint8Array;

  /**
   * Expected token issuer (iss claim).
   * If provided, tokens with different issuers are rejected.
   */
  issuer?: string | string[];

  /**
   * Expected audience (aud claim).
   * If provided, tokens without this audience are rejected.
   */
  audience?: string | string[];

  /**
   * Allowed algorithms.
   * @default ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']
   */
  algorithms?: string[];

  /**
   * Clock tolerance in seconds for exp/nbf validation.
   * @default 60
   */
  clockTolerance?: number;

  /**
   * Custom claims validation function.
   * Called after standard validation passes.
   */
  validateClaims?: (claims: MAPJWTClaims) => boolean | Promise<boolean>;

  /**
   * Transform claims to principal.
   * By default uses 'sub' as principal ID.
   */
  claimsToPrincipal?: (claims: MAPJWTClaims) => {
    id: string;
    issuer?: string;
    claims?: Record<string, unknown>;
  };

  /**
   * JWKS cache duration in milliseconds.
   * @default 600000 (10 minutes)
   */
  jwksCacheDuration?: number;
}

/**
 * JSON Web Key Set structure.
 */
export interface JsonWebKeySet {
  keys: JsonWebKey[];
}

// Lazy-loaded jose module
let joseModule: typeof import('jose') | null = null;

async function getJose(): Promise<typeof import('jose')> {
  if (!joseModule) {
    try {
      joseModule = await import('jose');
    } catch {
      throw new Error(
        'JWTAuthenticator requires the "jose" package. Install it with: npm install jose'
      );
    }
  }
  return joseModule;
}

/**
 * JWTAuthenticator - Validates JWT bearer tokens.
 *
 * @example With JWKS URL (recommended for production)
 * ```typescript
 * const authenticator = new JWTAuthenticator({
 *   jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
 *   issuer: 'https://auth.example.com',
 *   audience: 'map-server-prod',
 * });
 * ```
 *
 * @example With static secret (for testing)
 * ```typescript
 * const authenticator = new JWTAuthenticator({
 *   secret: 'your-256-bit-secret',
 *   issuer: 'test-issuer',
 * });
 * ```
 *
 * @example With custom claims validation
 * ```typescript
 * const authenticator = new JWTAuthenticator({
 *   jwksUrl: '...',
 *   validateClaims: (claims) => {
 *     // Require specific scope
 *     const scopes = claims.scope?.split(' ') ?? [];
 *     return scopes.includes('map:access');
 *   },
 * });
 * ```
 */
export class JWTAuthenticator implements Authenticator {
  readonly methods = ['bearer'] as const;
  readonly #options: JWTAuthenticatorOptions;
  #jwksCache: { keys: unknown; fetchedAt: number } | null = null;

  constructor(options: JWTAuthenticatorOptions = {}) {
    // Validate options
    if (!options.jwksUrl && !options.jwks && !options.secret) {
      throw new Error(
        'JWTAuthenticator requires one of: jwksUrl, jwks, or secret'
      );
    }

    this.#options = {
      algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
      clockTolerance: 60,
      jwksCacheDuration: 600000, // 10 minutes
      ...options,
    };

    // If using secret, allow HS256
    if (options.secret) {
      this.#options.algorithms = ['HS256', ...(this.#options.algorithms ?? [])];
    }
  }

  async initialize(): Promise<void> {
    // Pre-fetch JWKS if using URL
    if (this.#options.jwksUrl) {
      await this.#fetchJWKS();
    }
  }

  async authenticate(
    credentials: AuthCredentials,
    _context: AuthContext
  ): Promise<AuthResult> {
    const token = credentials.credential;

    if (!token) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'Bearer token is required',
        },
      };
    }

    try {
      const jose = await getJose();

      // Get the key source
      const keySource = await this.#getKeySource(jose);

      // Verify the token
      const { payload } = await jose.jwtVerify(token, keySource, {
        issuer: this.#options.issuer,
        audience: this.#options.audience,
        algorithms: this.#options.algorithms,
        clockTolerance: this.#options.clockTolerance,
      });

      const claims = payload as MAPJWTClaims;

      // Custom claims validation
      if (this.#options.validateClaims) {
        const valid = await this.#options.validateClaims(claims);
        if (!valid) {
          return {
            success: false,
            error: {
              code: 'insufficient_scope',
              message: 'Token claims validation failed',
            },
          };
        }
      }

      // Transform claims to principal
      const principal = this.#options.claimsToPrincipal
        ? this.#options.claimsToPrincipal(claims)
        : this.#defaultClaimsToPrincipal(claims);

      return {
        success: true,
        principal,
      };
    } catch (error) {
      return this.#handleJoseError(error);
    }
  }

  /**
   * Get the key source for verification.
   */
  async #getKeySource(jose: typeof import('jose')): Promise<
    ReturnType<typeof jose.createRemoteJWKSet> |
    ReturnType<typeof jose.createLocalJWKSet> |
    Uint8Array
  > {
    // Secret key (HS256)
    if (this.#options.secret) {
      return typeof this.#options.secret === 'string'
        ? new TextEncoder().encode(this.#options.secret)
        : this.#options.secret;
    }

    // Static JWKS
    if (this.#options.jwks) {
      return jose.createLocalJWKSet(this.#options.jwks as jose.JSONWebKeySet);
    }

    // Remote JWKS
    if (this.#options.jwksUrl) {
      return jose.createRemoteJWKSet(new URL(this.#options.jwksUrl), {
        cacheMaxAge: this.#options.jwksCacheDuration,
      });
    }

    throw new Error('No key source configured');
  }

  /**
   * Pre-fetch JWKS for faster first authentication.
   */
  async #fetchJWKS(): Promise<void> {
    if (!this.#options.jwksUrl) return;

    try {
      const response = await fetch(this.#options.jwksUrl);
      if (!response.ok) {
        console.warn(`[JWTAuthenticator] Failed to fetch JWKS: ${response.status}`);
        return;
      }

      const jwks = await response.json();
      this.#jwksCache = {
        keys: jwks,
        fetchedAt: Date.now(),
      };
    } catch (error) {
      console.warn('[JWTAuthenticator] Failed to fetch JWKS:', error);
    }
  }

  /**
   * Default claims to principal transformation.
   */
  #defaultClaimsToPrincipal(claims: MAPJWTClaims): {
    id: string;
    issuer?: string;
    claims?: Record<string, unknown>;
  } {
    return {
      id: claims.sub ?? 'unknown',
      issuer: claims.iss,
      claims: {
        scope: claims.scope,
        'map:capabilities': claims['map:capabilities'],
        // Include other useful claims
        aud: claims.aud,
        exp: claims.exp,
        iat: claims.iat,
      },
    };
  }

  /**
   * Handle jose library errors.
   */
  #handleJoseError(error: unknown): AuthResult {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'Token validation failed';

    // Map jose errors to auth error codes
    switch (errorName) {
      case 'JWTExpired':
        return {
          success: false,
          error: {
            code: 'expired',
            message: 'Token has expired',
          },
        };

      case 'JWTClaimValidationFailed':
        return {
          success: false,
          error: {
            code: 'invalid_credentials',
            message: `Claim validation failed: ${errorMessage}`,
          },
        };

      case 'JWSSignatureVerificationFailed':
        return {
          success: false,
          error: {
            code: 'invalid_credentials',
            message: 'Token signature verification failed',
          },
        };

      case 'JWKSNoMatchingKey':
        return {
          success: false,
          error: {
            code: 'invalid_credentials',
            message: 'No matching key found for token',
          },
        };

      default:
        return {
          success: false,
          error: {
            code: 'invalid_credentials',
            message: errorMessage,
          },
        };
    }
  }
}
