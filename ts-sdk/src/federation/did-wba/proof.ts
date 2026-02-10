/**
 * DID:WBA Proof Generation and Verification
 *
 * Generates and verifies cryptographic proofs for DID:WBA authentication.
 * Proofs are JWS compact serializations over (challenge + did + created).
 */

import type { DIDWBAProof } from '../../types';

/**
 * Options for generating a DID:WBA proof.
 */
export interface ProofGenerationOptions {
  /** The DID being authenticated */
  did: string;
  /** Server-provided challenge nonce */
  challenge: string;
  /** Private key in JWK format */
  privateKey: JsonWebKey;
  /** Proof type (default: "JsonWebSignature2020") */
  proofType?: string;
}

/**
 * Options for verifying a DID:WBA proof.
 */
export interface ProofVerificationOptions {
  /** The DID that claims ownership */
  did: string;
  /** The proof to verify */
  proof: DIDWBAProof;
  /** Public key from the DID Document (JWK format) */
  publicKey: JsonWebKey;
  /** Maximum proof age in ms (default: 300000 = 5 min) */
  maxAgeMs?: number;
}

/**
 * Build the canonical payload string for a DID:WBA proof.
 * The payload is the concatenation of challenge, did, and created timestamp.
 */
export function buildProofPayload(did: string, challenge: string, created: string): string {
  return `${challenge}.${did}.${created}`;
}

/**
 * Generate a DID:WBA proof for federation authentication.
 *
 * @param options - Proof generation options
 * @returns The generated proof
 */
export async function generateDIDWBAProof(options: ProofGenerationOptions): Promise<DIDWBAProof> {
  const { did, challenge, privateKey, proofType = "JsonWebSignature2020" } = options;
  const created = new Date().toISOString();

  const payload = buildProofPayload(did, challenge, created);
  const payloadBytes = new TextEncoder().encode(payload);

  // Determine algorithm from key type
  const algorithm = getSigningAlgorithm(privateKey);

  // Import the private key
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    privateKey,
    algorithm,
    false,
    ['sign']
  );

  // Sign the payload
  const signature = await crypto.subtle.sign(
    algorithm,
    cryptoKey,
    payloadBytes
  );

  // Encode as base64url
  const jws = base64UrlEncode(new Uint8Array(signature));

  return {
    type: proofType,
    created,
    challenge,
    jws,
  };
}

/**
 * Verify a DID:WBA proof against a public key.
 *
 * @param options - Proof verification options
 * @returns true if the proof is valid
 */
export async function verifyDIDWBAProof(options: ProofVerificationOptions): Promise<boolean> {
  const { did, proof, publicKey, maxAgeMs = 5 * 60 * 1000 } = options;

  // Check proof age
  const proofCreated = new Date(proof.created).getTime();
  if (isNaN(proofCreated)) {
    return false;
  }
  const age = Date.now() - proofCreated;
  if (age < 0 || age > maxAgeMs) {
    return false;
  }

  // Reconstruct the payload
  const payload = buildProofPayload(did, proof.challenge, proof.created);
  const payloadBytes = new TextEncoder().encode(payload);

  // Decode the JWS signature
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(proof.jws);
  } catch {
    return false;
  }

  // Determine algorithm from key type
  const algorithm = getSigningAlgorithm(publicKey);

  // Import the public key
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      publicKey,
      algorithm,
      false,
      ['verify']
    );
  } catch {
    return false;
  }

  // Verify the signature
  try {
    return await crypto.subtle.verify(
      algorithm,
      cryptoKey,
      signatureBytes,
      payloadBytes
    );
  } catch {
    return false;
  }
}

// =============================================================================
// Internal Utilities
// =============================================================================

/**
 * Determine the Web Crypto algorithm parameters from a JWK.
 */
function getSigningAlgorithm(key: JsonWebKey): EcdsaParams & EcKeyImportParams {
  if (key.kty === 'EC') {
    const namedCurve = key.crv ?? 'P-256';
    const hashMap: Record<string, string> = {
      'P-256': 'SHA-256',
      'P-384': 'SHA-384',
      'P-521': 'SHA-512',
    };
    return {
      name: 'ECDSA',
      namedCurve,
      hash: { name: hashMap[namedCurve] ?? 'SHA-256' },
    };
  }

  throw new Error(`Unsupported key type: ${key.kty}. Only EC keys are currently supported.`);
}

/**
 * Base64url encode a Uint8Array.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64url decode a string to Uint8Array.
 */
function base64UrlDecode(str: string): Uint8Array {
  // Add padding
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
