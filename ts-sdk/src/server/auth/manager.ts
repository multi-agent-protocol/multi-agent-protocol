/**
 * AuthManager implementation
 *
 * Coordinates multiple authenticators and handles the authentication flow.
 * Supports both plain Authenticators and extended AuthProviders.
 */

import type {
  AuthMethod,
  AuthCredentials,
  AuthResult,
  AuthPrincipal,
  ServerAuthCapabilities,
} from '../../types';
import type {
  Authenticator,
  AuthConfig,
  AuthContext,
  AuthManager,
  AuthManagerOptions,
  AuthProvider,
  CapabilityMapping,
  SpawnDelegationRequest,
  DelegatedCredentials,
} from './types';
import type { ServerSession } from '../types';

/**
 * Check if an authenticator is also an AuthProvider.
 */
function isAuthProvider(auth: Authenticator): auth is AuthProvider {
  return 'providerId' in auth && typeof (auth as AuthProvider).providerId === 'string';
}

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
 *   providers: [
 *     new AgentIAMProvider({ secret, systemId: 'my-system' }),
 *   ],
 * });
 *
 * await authManager.initialize();
 *
 * const result = await authManager.authenticate(
 *   { method: 'x-agent-iam', credential: '...' },
 *   { transportType: 'websocket' }
 * );
 * ```
 */
export class AuthManagerImpl implements AuthManager {
  readonly config: AuthConfig;
  readonly #authenticatorMap: Map<AuthMethod, Authenticator> = new Map();
  readonly #providerMap: Map<string, AuthProvider> = new Map();
  #initialized = false;

  constructor(options: AuthManagerOptions = {}) {
    const authenticators = options.authenticators ?? [];
    const providers = options.providers ?? [];

    // Merge providers into authenticators list for the config
    const allAuthenticators = [...authenticators, ...providers];

    this.config = {
      required: options.required ?? false,
      authenticators: allAuthenticators,
      oauth2MetadataUrl: options.oauth2MetadataUrl,
      jwksUrl: options.jwksUrl,
      realm: options.realm,
      bypassForTransports: options.bypassForTransports,
    };

    // Build method -> authenticator map
    for (const authenticator of allAuthenticators) {
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

    // Build provider map (by providerId and by method)
    const registerProvider = (provider: AuthProvider) => {
      this.#providerMap.set(provider.providerId, provider);
      for (const method of provider.methods) {
        this.#providerMap.set(`method:${method}`, provider);
      }
    };

    for (const provider of providers) {
      registerProvider(provider);
    }

    // Auto-detect providers in the authenticators array
    for (const auth of authenticators) {
      if (isAuthProvider(auth)) {
        registerProvider(auth);
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
   * Get an AuthProvider by providerId or auth method.
   */
  getProvider(methodOrProviderId: string): AuthProvider | undefined {
    return this.#providerMap.get(methodOrProviderId) ??
      this.#providerMap.get(`method:${methodOrProviderId}`);
  }

  /**
   * Get capability mapping for a provider-authenticated principal.
   * Returns undefined if the auth method is not backed by a provider.
   */
  getCapabilityMapping(
    method: string,
    principal: AuthPrincipal,
    providerData: unknown
  ): CapabilityMapping | undefined {
    const provider = this.#providerMap.get(`method:${method}`);
    if (!provider?.mapCapabilities) return undefined;
    return provider.mapCapabilities(principal, providerData);
  }

  /**
   * Delegate credentials for a spawned child agent.
   * Uses the primary (first) provider from the session.
   */
  async delegateForSpawn(
    session: ServerSession,
    spawnRequest: SpawnDelegationRequest
  ): Promise<DelegatedCredentials | undefined> {
    if (!session.providers) return undefined;

    const entries = Object.entries(session.providers);
    if (entries.length === 0) return undefined;

    const [providerId, { principal, providerData }] = entries[0];
    const provider = this.#providerMap.get(providerId);
    if (!provider?.delegateForSpawn) return undefined;

    return provider.delegateForSpawn(principal, providerData, spawnRequest);
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
