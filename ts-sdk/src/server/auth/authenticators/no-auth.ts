/**
 * NoAuthAuthenticator - For trusted local connections
 *
 * Allows connections without credentials. Use for:
 * - Local subprocess agents (stdio)
 * - Development/testing
 * - Behind a trusted proxy that handles auth
 */

import type { AuthCredentials, AuthResult } from '../../../types';
import type { Authenticator, AuthContext, AuthenticatorOptions } from '../types';

export interface NoAuthOptions extends AuthenticatorOptions {
  /**
   * Default principal ID for anonymous connections.
   * @default 'anonymous'
   */
  defaultPrincipalId?: string;

  /**
   * Additional claims to include for anonymous principals.
   */
  defaultClaims?: Record<string, unknown>;
}

/**
 * NoAuthAuthenticator - Allows unauthenticated connections.
 *
 * @example
 * ```typescript
 * const authenticator = new NoAuthAuthenticator({
 *   defaultPrincipalId: 'local-agent',
 * });
 * ```
 */
export class NoAuthAuthenticator implements Authenticator {
  readonly methods = ['none'] as const;
  readonly #options: NoAuthOptions;

  constructor(options: NoAuthOptions = {}) {
    this.#options = options;
  }

  async authenticate(
    _credentials: AuthCredentials,
    _context: AuthContext
  ): Promise<AuthResult> {
    return {
      success: true,
      principal: {
        id: this.#options.defaultPrincipalId ?? 'anonymous',
        claims: this.#options.defaultClaims,
      },
    };
  }
}
