/**
 * MAP Server Authentication Module
 *
 * Provides pluggable authentication for MAP servers.
 *
 * @example Basic usage with JWT
 * ```typescript
 * import {
 *   AuthManagerImpl,
 *   JWTAuthenticator,
 *   authMiddleware,
 * } from '@anthropic/multi-agent-protocol/server/auth';
 *
 * const authManager = new AuthManagerImpl({
 *   required: true,
 *   authenticators: [
 *     new JWTAuthenticator({
 *       jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
 *       issuer: 'https://auth.example.com',
 *       audience: 'map-server',
 *     }),
 *   ],
 * });
 *
 * const server = new MAPServer({
 *   middleware: [authMiddleware(authManager)],
 * });
 * ```
 *
 * @example Multiple auth methods
 * ```typescript
 * const authManager = new AuthManagerImpl({
 *   required: true,
 *   authenticators: [
 *     new JWTAuthenticator({ jwksUrl: '...' }),
 *     new APIKeyAuthenticator({ validateKey: async (key) => ... }),
 *     new NoAuthAuthenticator(), // Fallback for local dev
 *   ],
 * });
 * ```
 */

// Types
export * from './types';

// Manager
export { AuthManagerImpl, createAuthManager } from './manager';

// Capabilities intersection
export { intersectCapabilities, intersectAgentPermissions, and } from './capabilities';

// Middleware
export {
  authMiddleware,
  authLoggingMiddleware,
  AuthenticationError,
  AUTH_ERRORS,
} from './middleware';
export type { AuthMiddlewareOptions } from './middleware';

// Authenticators
export {
  NoAuthAuthenticator,
  APIKeyAuthenticator,
  JWTAuthenticator,
  MTLSAuthenticator,
  createSimpleAPIKeyAuthenticator,
} from './authenticators';

export type {
  NoAuthOptions,
  APIKeyAuthenticatorOptions,
  APIKeyValidator,
  APIKeyValidationResult,
  JWTAuthenticatorOptions,
  JsonWebKeySet,
  MTLSAuthenticatorOptions,
} from './authenticators';

// Providers (extended authenticators with capability mapping)
export {
  AgentIAMProvider,
  AgentIAMCapabilityMapper,
} from './providers';

export type {
  AgentIAMProviderOptions,
  AgentIAMToken,
  TokenServiceLike,
  AgentIAMCapabilityMapperOptions,
  MappableToken,
} from './providers';
