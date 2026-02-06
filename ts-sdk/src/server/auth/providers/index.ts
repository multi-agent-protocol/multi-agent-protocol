/**
 * Auth Providers
 *
 * Extended authenticators that provide capability mapping,
 * spawn delegation, and federation support.
 */

// Agent IAM Provider
export { AgentIAMProvider } from './agent-iam';
export type {
  AgentIAMProviderOptions,
  AgentIAMToken,
  TokenServiceLike,
} from './agent-iam';

// Agent IAM Capability Mapper
export { AgentIAMCapabilityMapper } from './agent-iam-mapper';
export type {
  AgentIAMCapabilityMapperOptions,
  MappableToken,
} from './agent-iam-mapper';

// Agent IAM Federation Gateway
export { AgentIAMFederationGateway } from './agent-iam-federation';
export type { AgentIAMFederationGatewayOptions } from './agent-iam-federation';
