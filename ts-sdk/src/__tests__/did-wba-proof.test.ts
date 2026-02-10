/**
 * Tests for DID:WBA proof generation and verification (Proposal 1).
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  generateDIDWBAProof,
  verifyDIDWBAProof,
  buildProofPayload,
} from "../federation/did-wba/proof";

// ============================================================================
// Test Keys — generated at runtime for environment compatibility
// ============================================================================

let TEST_PRIVATE_KEY: JsonWebKey;
let TEST_PUBLIC_KEY: JsonWebKey;
let WRONG_PRIVATE_KEY: JsonWebKey;
let WRONG_PUBLIC_KEY: JsonWebKey;

const TEST_DID = "did:wba:agents.example.com:gateway";
const TEST_CHALLENGE = "map_chal_01ABCDEFGHJ0123456789AB";

const EC_PARAMS = { name: "ECDSA", namedCurve: "P-256" };

beforeAll(async () => {
  // Generate test key pair
  const keyPair = await crypto.subtle.generateKey(EC_PARAMS, true, ["sign", "verify"]);
  TEST_PRIVATE_KEY = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  TEST_PUBLIC_KEY = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  // Generate a different key pair for mismatch tests
  const wrongPair = await crypto.subtle.generateKey(EC_PARAMS, true, ["sign", "verify"]);
  WRONG_PRIVATE_KEY = await crypto.subtle.exportKey("jwk", wrongPair.privateKey);
  WRONG_PUBLIC_KEY = await crypto.subtle.exportKey("jwk", wrongPair.publicKey);
});

// ============================================================================
// Tests: buildProofPayload
// ============================================================================

describe("buildProofPayload", () => {
  it("should build canonical payload string", () => {
    const payload = buildProofPayload(TEST_DID, "challenge-123", "2026-02-10T00:00:00Z");
    expect(payload).toBe(
      "challenge-123.did:wba:agents.example.com:gateway.2026-02-10T00:00:00Z"
    );
  });
});

// ============================================================================
// Tests: generateDIDWBAProof + verifyDIDWBAProof
// ============================================================================

describe("DID:WBA proof generation and verification", () => {
  it("should generate and verify a valid proof", async () => {
    const proof = await generateDIDWBAProof({
      did: TEST_DID,
      challenge: TEST_CHALLENGE,
      privateKey: TEST_PRIVATE_KEY,
    });

    expect(proof.type).toBe("JsonWebSignature2020");
    expect(proof.challenge).toBe(TEST_CHALLENGE);
    expect(proof.created).toBeDefined();
    expect(proof.jws).toBeDefined();
    expect(proof.jws.length).toBeGreaterThan(0);

    const valid = await verifyDIDWBAProof({
      did: TEST_DID,
      proof,
      publicKey: TEST_PUBLIC_KEY,
    });

    expect(valid).toBe(true);
  });

  it("should reject proof with wrong public key", async () => {
    const proof = await generateDIDWBAProof({
      did: TEST_DID,
      challenge: TEST_CHALLENGE,
      privateKey: TEST_PRIVATE_KEY,
    });

    const valid = await verifyDIDWBAProof({
      did: TEST_DID,
      proof,
      publicKey: WRONG_PUBLIC_KEY,
    });

    expect(valid).toBe(false);
  });

  it("should reject proof with wrong DID", async () => {
    const proof = await generateDIDWBAProof({
      did: TEST_DID,
      challenge: TEST_CHALLENGE,
      privateKey: TEST_PRIVATE_KEY,
    });

    const valid = await verifyDIDWBAProof({
      did: "did:wba:other.example.com:agent",
      proof,
      publicKey: TEST_PUBLIC_KEY,
    });

    expect(valid).toBe(false);
  });

  it("should reject proof with tampered challenge", async () => {
    const proof = await generateDIDWBAProof({
      did: TEST_DID,
      challenge: TEST_CHALLENGE,
      privateKey: TEST_PRIVATE_KEY,
    });

    const tampered = { ...proof, challenge: "tampered_challenge" };
    const valid = await verifyDIDWBAProof({
      did: TEST_DID,
      proof: tampered,
      publicKey: TEST_PUBLIC_KEY,
    });

    expect(valid).toBe(false);
  });

  it("should reject expired proof", async () => {
    const proof = await generateDIDWBAProof({
      did: TEST_DID,
      challenge: TEST_CHALLENGE,
      privateKey: TEST_PRIVATE_KEY,
    });

    const expired = { ...proof, created: "2020-01-01T00:00:00Z" };

    const valid = await verifyDIDWBAProof({
      did: TEST_DID,
      proof: expired,
      publicKey: TEST_PUBLIC_KEY,
      maxAgeMs: 1000,
    });

    expect(valid).toBe(false);
  });

  it("should reject proof with invalid created timestamp", async () => {
    const proof = await generateDIDWBAProof({
      did: TEST_DID,
      challenge: TEST_CHALLENGE,
      privateKey: TEST_PRIVATE_KEY,
    });

    const badDate = { ...proof, created: "not-a-date" };
    const valid = await verifyDIDWBAProof({
      did: TEST_DID,
      proof: badDate,
      publicKey: TEST_PUBLIC_KEY,
    });

    expect(valid).toBe(false);
  });

  it("should reject proof with invalid JWS", async () => {
    const proof = await generateDIDWBAProof({
      did: TEST_DID,
      challenge: TEST_CHALLENGE,
      privateKey: TEST_PRIVATE_KEY,
    });

    const badJws = { ...proof, jws: "!!!invalid_base64url!!!" };
    const valid = await verifyDIDWBAProof({
      did: TEST_DID,
      proof: badJws,
      publicKey: TEST_PUBLIC_KEY,
    });

    expect(valid).toBe(false);
  });

  it("should use custom proof type", async () => {
    const proof = await generateDIDWBAProof({
      did: TEST_DID,
      challenge: TEST_CHALLENGE,
      privateKey: TEST_PRIVATE_KEY,
      proofType: "CustomSignature2026",
    });

    expect(proof.type).toBe("CustomSignature2026");

    // Should still verify correctly
    const valid = await verifyDIDWBAProof({
      did: TEST_DID,
      proof,
      publicKey: TEST_PUBLIC_KEY,
    });
    expect(valid).toBe(true);
  });
});
