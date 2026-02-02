/**
 * MTLSAuthenticator - Mutual TLS (client certificate) authentication
 *
 * Authentication is performed at the transport layer via client certificates.
 * This authenticator validates that mTLS was performed and extracts principal
 * information from the certificate.
 */

import type { AuthCredentials, AuthResult } from '../../../types';
import type { Authenticator, AuthContext, AuthenticatorOptions } from '../types';

/**
 * Options for MTLSAuthenticator.
 */
export interface MTLSAuthenticatorOptions extends AuthenticatorOptions {
  /**
   * Extract principal ID from certificate subject.
   * By default, uses the Common Name (CN).
   *
   * @param subject - Certificate subject string (e.g., "CN=agent-1,O=MyOrg")
   * @returns Principal ID
   */
  extractPrincipalId?: (subject: string) => string;

  /**
   * Validate the certificate.
   * By default, trusts any valid certificate (TLS already validated it).
   *
   * @param cert - Certificate info from context
   * @returns true if valid, false or error message if invalid
   */
  validateCertificate?: (cert: NonNullable<AuthContext['tlsCertificate']>) =>
    boolean | string | Promise<boolean | string>;

  /**
   * Allowed certificate fingerprints.
   * If provided, only certificates with matching fingerprints are accepted.
   */
  allowedFingerprints?: string[];

  /**
   * Allowed certificate issuers.
   * If provided, only certificates from these issuers are accepted.
   */
  allowedIssuers?: string[];
}

/**
 * MTLSAuthenticator - Uses client certificate for authentication.
 *
 * The TLS layer must be configured to request and verify client certificates.
 * This authenticator reads the certificate info from the AuthContext and
 * extracts the principal identity.
 *
 * @example Basic usage
 * ```typescript
 * const authenticator = new MTLSAuthenticator();
 *
 * // When accepting connections, provide TLS cert info in context:
 * const context: AuthContext = {
 *   transportType: 'websocket',
 *   tlsCertificate: {
 *     subject: 'CN=agent-worker-01,O=MyOrg',
 *     issuer: 'CN=MyCA,O=MyOrg',
 *     fingerprint: 'sha256:abc123...',
 *     validFrom: new Date(),
 *     validTo: new Date(),
 *   },
 * };
 * ```
 *
 * @example With fingerprint allowlist
 * ```typescript
 * const authenticator = new MTLSAuthenticator({
 *   allowedFingerprints: [
 *     'sha256:abc123...',
 *     'sha256:def456...',
 *   ],
 * });
 * ```
 */
export class MTLSAuthenticator implements Authenticator {
  readonly methods = ['mtls'] as const;
  readonly #options: MTLSAuthenticatorOptions;

  constructor(options: MTLSAuthenticatorOptions = {}) {
    this.#options = options;
  }

  async authenticate(
    _credentials: AuthCredentials,
    context: AuthContext
  ): Promise<AuthResult> {
    // mTLS requires certificate info in context
    const cert = context.tlsCertificate;

    if (!cert) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'Client certificate not provided. mTLS authentication requires a valid client certificate.',
        },
      };
    }

    // Check certificate validity period
    const now = new Date();
    if (now < cert.validFrom) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'Client certificate is not yet valid',
        },
      };
    }

    if (now > cert.validTo) {
      return {
        success: false,
        error: {
          code: 'expired',
          message: 'Client certificate has expired',
        },
      };
    }

    // Check fingerprint allowlist
    if (this.#options.allowedFingerprints?.length) {
      if (!this.#options.allowedFingerprints.includes(cert.fingerprint)) {
        return {
          success: false,
          error: {
            code: 'invalid_credentials',
            message: 'Client certificate fingerprint not in allowlist',
          },
        };
      }
    }

    // Check issuer allowlist
    if (this.#options.allowedIssuers?.length) {
      if (!this.#options.allowedIssuers.includes(cert.issuer)) {
        return {
          success: false,
          error: {
            code: 'invalid_credentials',
            message: 'Client certificate issuer not in allowlist',
          },
        };
      }
    }

    // Custom certificate validation
    if (this.#options.validateCertificate) {
      const validationResult = await this.#options.validateCertificate(cert);
      if (validationResult !== true) {
        return {
          success: false,
          error: {
            code: 'invalid_credentials',
            message: typeof validationResult === 'string'
              ? validationResult
              : 'Certificate validation failed',
          },
        };
      }
    }

    // Extract principal ID
    const principalId = this.#options.extractPrincipalId
      ? this.#options.extractPrincipalId(cert.subject)
      : this.#extractCN(cert.subject);

    return {
      success: true,
      principal: {
        id: principalId,
        issuer: cert.issuer,
        claims: {
          fingerprint: cert.fingerprint,
          subject: cert.subject,
          validFrom: cert.validFrom.toISOString(),
          validTo: cert.validTo.toISOString(),
        },
      },
    };
  }

  /**
   * Extract Common Name (CN) from certificate subject.
   */
  #extractCN(subject: string): string {
    // Parse "CN=value,O=org,..." format
    const match = subject.match(/CN=([^,]+)/i);
    return match ? match[1] : subject;
  }
}
