/**
 * AuthManager implementation
 *
 * Coordinates multiple authenticators and handles the authentication flow.
 */

import type {
  AuthMethod,
  AuthCredentials,
  AuthResult,
  ServerAuthCapabilities,
} from '../../types';
import type {
  Authenticator,
  AuthConfig,
  AuthContext,
  AuthManager,
  AuthManagerOptions,
} from './types';

/**
 * Default AuthManager implementation.
 *
 * @example
 * ```typescript
 * const authManager = new AuthManagerImpl({
 *   required: true,
 *   authenticators: [
 *     new JWTAuthenticator({ jwksUrl: '...' }),
 *     new APIKeyAuthenticator({ validateKey: async (key) => ... }),
 *   ],
 * });
 *
 * await authManager.initialize();
 *
 * const result = await authManager.authenticate(
 *   { method: 'bearer', credential: 'eyJ...' },
 *   { transportType: 'websocket' }
 * );
 * ```
 */
export class AuthManagerImpl implements AuthManager {
  readonly config: AuthConfig;
  readonly #authenticatorMap: Map<AuthMethod, Authenticator> = new Map();
  #initialized = false;

  constructor(options: AuthManagerOptions = {}) {
    const authenticators = options.authenticators ?? [];

    this.config = {
      required: options.required ?? false,
      authenticators,
      oauth2MetadataUrl: options.oauth2MetadataUrl,
      jwksUrl: options.jwksUrl,
      realm: options.realm,
      bypassForTransports: options.bypassForTransports,
    };

    // Build method -> authenticator map
    for (const authenticator of authenticators) {
      for (const method of authenticator.methods) {
        if (this.#authenticatorMap.has(method)) {
          console.warn(
            `[AuthManager] Multiple authenticators registered for method '${method}'. ` +
            `Using the first one.`
          );
          continue;
        }
        this.#authenticatorMap.set(method, authenticator);
      }
    }
  }

  /**
   * Get all supported authentication methods.
   */
  get supportedMethods(): AuthMethod[] {
    return Array.from(this.#authenticatorMap.keys());
  }

  /**
   * Get server auth capabilities for advertising to clients.
   */
  getCapabilities(): ServerAuthCapabilities {
    return {
      methods: this.supportedMethods,
      required: this.config.required,
      oauth2MetadataUrl: this.config.oauth2MetadataUrl,
      jwksUrl: this.config.jwksUrl,
      realm: this.config.realm,
    };
  }

  /**
   * Authenticate credentials.
   */
  async authenticate(
    credentials: AuthCredentials,
    context: AuthContext
  ): Promise<AuthResult> {
    // Check if method is supported
    const authenticator = this.#authenticatorMap.get(credentials.method);

    if (!authenticator) {
      return {
        success: false,
        error: {
          code: 'method_not_supported',
          message: `Authentication method '${credentials.method}' is not supported. ` +
            `Supported methods: ${this.supportedMethods.join(', ')}`,
        },
      };
    }

    // Delegate to the authenticator
    try {
      return await authenticator.authenticate(credentials, context);
    } catch (error) {
      // Wrap unexpected errors
      console.error('[AuthManager] Authentication error:', error);
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: error instanceof Error ? error.message : 'Authentication failed',
        },
      };
    }
  }

  /**
   * Check if auth should be bypassed for a given context.
   */
  shouldBypass(context: AuthContext): boolean {
    // If auth not required, always bypass
    if (!this.config.required) {
      return true;
    }

    // Check transport-based bypass
    if (context.transportType && this.config.bypassForTransports) {
      return this.config.bypassForTransports[context.transportType] === true;
    }

    return false;
  }

  /**
   * Initialize all authenticators.
   */
  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    const initPromises = this.config.authenticators
      .filter((auth) => auth.initialize)
      .map((auth) => auth.initialize!());

    await Promise.all(initPromises);
    this.#initialized = true;
  }

  /**
   * Shutdown all authenticators.
   */
  async shutdown(): Promise<void> {
    const shutdownPromises = this.config.authenticators
      .filter((auth) => auth.shutdown)
      .map((auth) => auth.shutdown!());

    await Promise.all(shutdownPromises);
    this.#initialized = false;
  }
}

/**
 * Create an AuthManager with the given options.
 */
export function createAuthManager(options?: AuthManagerOptions): AuthManager {
  return new AuthManagerImpl(options);
}
