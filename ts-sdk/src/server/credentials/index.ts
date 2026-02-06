/**
 * Credential brokering module.
 *
 * Exposes agent-iam's credential brokering as `cred/*` MAP methods.
 */

// Handler factory
export { createCredentialHandlers } from './handlers';
export type { CredentialHandlerOptions } from './handlers';

// Types
export type {
  CredentialCapabilityConfig,
  BrokerLike,
  CredentialResult,
} from './types';
