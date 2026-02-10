/**
 * DID:WBA (Web-Based Agent) utilities for MAP federation.
 *
 * Provides DID resolution, proof generation/verification,
 * and server-side authentication for did:wba-based federation.
 */

export { DIDWBAResolver, parseDIDWBA, didToUrl } from './resolver';
export type { DIDResolverOptions, ParsedDIDWBA } from './resolver';

export { generateDIDWBAProof, verifyDIDWBAProof, buildProofPayload } from './proof';
export type { ProofGenerationOptions, ProofVerificationOptions } from './proof';
