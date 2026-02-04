/**
 * APIKeyAuthenticator - Simple API key authentication
 *
 * Validates API keys against a user-provided validator function.
 */

import type { AuthCredentials, AuthResult } from '../../../types';
import type { Authenticator, AuthContext, AuthenticatorOptions } from '../types';

/**
 * Result of API key validation.
 */
export interface APIKeyValidationResult {
  /** Is the key valid? */
  valid: boolean;
  /** Principal ID for this key */
  principalId?: string;
  /** Additional metadata/claims for this key */
  metadata?: Record<string, unknown>;
  /** Error message if invalid */
  error?: string;
}

/**
 * Function to validate an API key.
 */
export type APIKeyValidator = (
  key: string,
  context: AuthContext
) => Promise<APIKeyValidationResult> | APIKeyValidationResult;

export interface APIKeyAuthenticatorOptions extends AuthenticatorOptions {
  /**
   * Function to validate API keys.
   * Must return validation result with principal info.
   */
  validateKey: APIKeyValidator;

  /**
   * Optional: Extract key from credential string.
   * By default, the entire credential is used as the key.
   *
   * @example Strip 'Bearer ' prefix
   * ```typescript
   * extractKey: (credential) => credential.replace(/^Bearer\s+/i, '')
   * ```
   */
  extractKey?: (credential: string) => string;
}

/**
 * APIKeyAuthenticator - Validates API keys.
 *
 * @example With database lookup
 * ```typescript
 * const authenticator = new APIKeyAuthenticator({
 *   validateKey: async (key) => {
 *     const record = await db.apiKeys.findByHash(hash(key));
 *     if (!record || record.revoked) {
 *       return { valid: false, error: 'Invalid or revoked API key' };
 *     }
 *     return {
 *       valid: true,
 *       principalId: record.ownerId,
 *       metadata: { scopes: record.scopes },
 *     };
 *   },
 * });
 * ```
 *
 * @example With static keys (for testing)
 * ```typescript
 * const validKeys = new Map([
 *   ['test-key-1', { principalId: 'user-1' }],
 *   ['test-key-2', { principalId: 'user-2' }],
 * ]);
 *
 * const authenticator = new APIKeyAuthenticator({
 *   validateKey: (key) => {
 *     const record = validKeys.get(key);
 *     return record
 *       ? { valid: true, ...record }
 *       : { valid: false, error: 'Unknown API key' };
 *   },
 * });
 * ```
 */
export class APIKeyAuthenticator implements Authenticator {
  readonly methods = ['api-key'] as const;
  readonly #options: APIKeyAuthenticatorOptions;

  constructor(options: APIKeyAuthenticatorOptions) {
    if (!options.validateKey) {
      throw new Error('APIKeyAuthenticator requires a validateKey function');
    }
    this.#options = options;
  }

  async authenticate(
    credentials: AuthCredentials,
    context: AuthContext
  ): Promise<AuthResult> {
    const rawCredential = credentials.credential;

    if (!rawCredential) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'API key is required',
        },
      };
    }

    // Extract key (optionally transform the credential)
    const key = this.#options.extractKey
      ? this.#options.extractKey(rawCredential)
      : rawCredential;

    if (!key) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'API key is required',
        },
      };
    }

    // Validate the key
    try {
      const result = await this.#options.validateKey(key, context);

      if (!result.valid) {
        return {
          success: false,
          error: {
            code: 'invalid_credentials',
            message: result.error ?? 'Invalid API key',
          },
        };
      }

      return {
        success: true,
        principal: {
          id: result.principalId ?? 'api-key-user',
          claims: result.metadata,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: error instanceof Error ? error.message : 'API key validation failed',
        },
      };
    }
  }
}

/**
 * Create a simple in-memory API key authenticator for testing.
 *
 * @param keys - Map of API key -> principal ID
 * @returns APIKeyAuthenticator instance
 *
 * @example
 * ```typescript
 * const authenticator = createSimpleAPIKeyAuthenticator({
 *   'test-key-1': 'user-1',
 *   'test-key-2': 'user-2',
 * });
 * ```
 */
export function createSimpleAPIKeyAuthenticator(
  keys: Record<string, string>
): APIKeyAuthenticator {
  const keyMap = new Map(Object.entries(keys));

  return new APIKeyAuthenticator({
    validateKey: (key) => {
      const principalId = keyMap.get(key);
      return principalId
        ? { valid: true, principalId }
        : { valid: false, error: 'Unknown API key' };
    },
  });
}
