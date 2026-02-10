/**
 * DID:WBA Authenticator for MAP Server
 *
 * Authenticates federation connections using did:wba credentials.
 * Resolves DID documents over HTTPS, extracts verification keys,
 * and verifies cryptographic proofs.
 */

import type { AuthMethod, AuthCredentials, AuthResult } from '../../types';
import type { Authenticator, AuthContext } from './types';
import { DIDWBAResolver, parseDIDWBA } from '../../federation/did-wba/resolver';
import type { DIDResolverOptions } from '../../federation/did-wba/resolver';
import { verifyDIDWBAProof } from '../../federation/did-wba/proof';
import { generateFederationChallenge, validateChallengeAge } from '../../federation/challenge';

/**
 * Options for the DID:WBA authenticator.
 */
export interface DIDWBAAuthenticatorOptions {
  /** DID resolver options (cache TTL, timeout, custom fetch) */
  resolver?: DIDResolverOptions;
  /** Trusted domain patterns (e.g., ["*.example.com", "partner.org"]) */
  trustedDomains?: string[];
  /** Challenge nonce TTL in ms (default: 300000 = 5 min) */
  challengeTtlMs?: number;
}

/**
 * Authenticator that validates did:wba credentials for federation.
 *
 * Authentication flow:
 * 1. Parse DID from credentials
 * 2. Validate DID matches trusted domain patterns (if configured)
 * 3. Resolve DID document via HTTPS
 * 4. Extract verification key from authentication relationship
 * 5. Verify proof signature
 * 6. Return authenticated principal
 */
export class DIDWBAAuthenticator implements Authenticator {
  readonly methods: readonly AuthMethod[] = ['did:wba' as AuthMethod];

  private readonly resolver: DIDWBAResolver;
  private readonly trustedDomains?: string[];
  private readonly challengeTtlMs: number;

  constructor(options?: DIDWBAAuthenticatorOptions) {
    this.resolver = new DIDWBAResolver(options?.resolver);
    this.trustedDomains = options?.trustedDomains;
    this.challengeTtlMs = options?.challengeTtlMs ?? 5 * 60 * 1000;
  }

  /**
   * Authenticate did:wba credentials.
   */
  async authenticate(
    credentials: AuthCredentials,
    _context: AuthContext
  ): Promise<AuthResult> {
    if (credentials.method !== 'did:wba') {
      return {
        success: false,
        error: { code: 'method_not_supported', message: 'Expected did:wba method' },
      };
    }

    // Extract DID and proof from metadata
    const did = credentials.metadata?.did as string | undefined;
    const proof = credentials.metadata?.proof as {
      type: string;
      created: string;
      challenge: string;
      jws: string;
    } | undefined;

    if (!did || !proof) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'did:wba credentials require "did" and "proof" in metadata',
        },
      };
    }

    // Validate DID format
    let domain: string;
    try {
      const parsed = parseDIDWBA(did);
      domain = parsed.domain;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: `Invalid DID format: ${(error as Error).message}`,
        },
      };
    }

    // Check trusted domains
    if (this.trustedDomains && !this.isTrustedDomain(domain)) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: `Domain "${domain}" is not in the trusted domains list`,
        },
      };
    }

    // Validate challenge freshness
    if (!validateChallengeAge(proof.challenge, this.challengeTtlMs)) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'Challenge nonce is expired or invalid',
        },
      };
    }

    // Resolve DID document
    let doc;
    try {
      doc = await this.resolver.resolve(did);
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: `DID resolution failed: ${(error as Error).message}`,
        },
      };
    }

    // Extract verification keys
    const keys = this.resolver.extractVerificationKeys(doc);
    if (keys.length === 0) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'No verification keys found in DID document',
        },
      };
    }

    // Try each verification key until one succeeds
    for (const key of keys) {
      if (!key.publicKeyJwk) continue;

      try {
        const valid = await verifyDIDWBAProof({
          did,
          proof,
          publicKey: key.publicKeyJwk as JsonWebKey,
          maxAgeMs: this.challengeTtlMs,
        });

        if (valid) {
          return {
            success: true,
            principal: {
              id: did,
              issuer: `https://${domain}`,
              claims: {
                domain,
                verificationMethod: key.id,
              },
            },
          };
        }
      } catch {
        // Try next key
        continue;
      }
    }

    return {
      success: false,
      error: {
        code: 'invalid_credentials',
        message: 'Proof verification failed against all available keys',
      },
    };
  }

  /**
   * Generate a challenge nonce for DID:WBA authentication.
   */
  generateChallenge(): string {
    return generateFederationChallenge();
  }

  /**
   * Check if a domain matches the trusted domain patterns.
   */
  isTrustedDomain(domain: string): boolean {
    if (!this.trustedDomains) return true;

    return this.trustedDomains.some((pattern) => {
      if (pattern.startsWith('*.')) {
        // Wildcard subdomain match
        const suffix = pattern.slice(2);
        return domain === suffix || domain.endsWith(`.${suffix}`);
      }
      return domain === pattern;
    });
  }

  async initialize(): Promise<void> {
    // No async initialization needed
  }

  async shutdown(): Promise<void> {
    this.resolver.clearCache();
  }
}
