/**
 * Credential brokering types.
 *
 * Follows the mail capability pattern — server operators enable credential
 * brokering via configuration, and the capability is advertised in the
 * connect response.
 */

// =============================================================================
// Capability Config
// =============================================================================

/**
 * Configuration for credential brokering capability.
 * Follows the same pattern as MailCapabilityConfig.
 */
export interface CredentialCapabilityConfig {
  /** Whether credential brokering is enabled on this server */
  enabled: boolean;
  /** Can request credentials via cred/get (default: true) */
  canGet?: boolean;
  /** Can list available scopes via cred/list (default: true) */
  canList?: boolean;
  /** Can check broker status via cred/status (default: true) */
  canStatus?: boolean;
  /** If set, only these providers are visible/available */
  allowedProviders?: string[];
}

// =============================================================================
// Broker DI Interface
// =============================================================================

/**
 * Credential result returned by the broker.
 * Mirrors agent-iam's CredentialResult type.
 */
export interface CredentialResult {
  /** Type of credential */
  credentialType: 'bearer_token' | 'aws_credentials' | 'api_key';
  /** Provider-specific credential data */
  credential: Record<string, unknown>;
  /** When the credential expires (ISO 8601) */
  expiresAt?: string;
}

/**
 * Minimal broker interface for credential brokering.
 *
 * Token parameters are typed as `unknown` so the interface is decoupled from
 * any specific auth-provider type. In practice the token will be whatever the
 * auth layer stored on `session.providers['agent-iam'].providerData` (e.g.
 * an `AgentIAMToken`), but the broker implementation is responsible for
 * knowing the concrete shape.
 *
 * @example
 * ```typescript
 * import { Broker } from 'agent-iam';
 * import { createCredentialHandlers } from '@multi-agent-protocol/sdk/server';
 *
 * const broker = new Broker('/path/to/config');
 * const handlers = createCredentialHandlers({ broker });
 * ```
 */
export interface BrokerLike {
  /**
   * Check if a token allows a specific scope + resource combination.
   */
  checkPermission(
    token: unknown,
    scope: string,
    resource: string,
  ): { valid: boolean; error?: string };

  /**
   * Get a short-lived credential for a specific scope + resource.
   *
   * Note: `getCredential` typically performs its own internal permission check.
   * The handler calls `checkPermission` first to produce accurate audit events
   * before delegating to `getCredential`.
   */
  getCredential(
    token: unknown,
    scope: string,
    resource: string,
  ): Promise<CredentialResult>;

  /**
   * Get broker status (configured providers, etc.).
   */
  getStatus(): { providers: string[]; [key: string]: unknown };
}
