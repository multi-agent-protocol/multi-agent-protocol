/**
 * Tests for DID:WBA authenticator (Proposal 1).
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { DIDWBAAuthenticator } from "../server/auth/did-wba-authenticator";
import { generateDIDWBAProof } from "../federation/did-wba/proof";
import { generateFederationChallenge } from "../federation/challenge";
import type { DIDDocument, AuthCredentials } from "../types";
import type { AuthContext } from "../server/auth/types";

// ============================================================================
// Test Keys — generated at runtime
// ============================================================================

let TEST_PRIVATE_KEY: JsonWebKey;
let TEST_PUBLIC_KEY: JsonWebKey;

const EC_PARAMS = { name: "ECDSA", namedCurve: "P-256" };
const TEST_DID = "did:wba:agents.example.com:gateway";

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(EC_PARAMS, true, ["sign", "verify"]);
  TEST_PRIVATE_KEY = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  TEST_PUBLIC_KEY = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
});

// ============================================================================
// Helpers
// ============================================================================

function createMockDIDDoc(): DIDDocument {
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: TEST_DID,
    verificationMethod: [
      {
        id: `${TEST_DID}#key-1`,
        type: "JsonWebKey2020",
        controller: TEST_DID,
        publicKeyJwk: TEST_PUBLIC_KEY,
      },
    ],
    authentication: [`${TEST_DID}#key-1`],
    service: [
      {
        id: `${TEST_DID}#map`,
        type: "MAPFederationEndpoint",
        serviceEndpoint: "wss://agents.example.com/map/federation",
      },
    ],
  };
}

function createMockFetch() {
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => createMockDIDDoc(),
  }));
}

const DEFAULT_CONTEXT: AuthContext = {
  transportType: "federation",
  metadata: { systemId: "system-b" },
};

async function createValidCredentials(): Promise<AuthCredentials> {
  const challenge = generateFederationChallenge();
  const proof = await generateDIDWBAProof({
    did: TEST_DID,
    challenge,
    privateKey: TEST_PRIVATE_KEY,
  });

  return {
    method: "did:wba" as any,
    metadata: { did: TEST_DID, proof },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("DIDWBAAuthenticator", () => {
  describe("authenticate — happy path", () => {
    it("should authenticate valid did:wba credentials", async () => {
      const fetchFn = createMockFetch();
      const authenticator = new DIDWBAAuthenticator({
        resolver: { fetchFn },
      });

      const credentials = await createValidCredentials();
      const result = await authenticator.authenticate(credentials, DEFAULT_CONTEXT);

      expect(result.success).toBe(true);
      expect(result.principal).toBeDefined();
      expect(result.principal!.id).toBe(TEST_DID);
      expect(result.principal!.issuer).toBe("https://agents.example.com");
      expect(result.principal!.claims).toMatchObject({
        domain: "agents.example.com",
        verificationMethod: `${TEST_DID}#key-1`,
      });
    });
  });

  describe("authenticate — error cases", () => {
    it("should reject non-did:wba method", async () => {
      const authenticator = new DIDWBAAuthenticator();
      const result = await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        DEFAULT_CONTEXT
      );

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("method_not_supported");
    });

    it("should reject missing DID in metadata", async () => {
      const authenticator = new DIDWBAAuthenticator();
      const result = await authenticator.authenticate(
        {
          method: "did:wba" as any,
          metadata: { proof: { type: "test", created: "now", challenge: "x", jws: "y" } },
        },
        DEFAULT_CONTEXT
      );

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("invalid_credentials");
    });

    it("should reject missing proof in metadata", async () => {
      const authenticator = new DIDWBAAuthenticator();
      const result = await authenticator.authenticate(
        { method: "did:wba" as any, metadata: { did: TEST_DID } },
        DEFAULT_CONTEXT
      );

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("invalid_credentials");
    });

    it("should reject invalid DID format", async () => {
      const authenticator = new DIDWBAAuthenticator();
      const result = await authenticator.authenticate(
        {
          method: "did:wba" as any,
          metadata: {
            did: "did:key:z6Mkh",
            proof: { type: "test", created: "now", challenge: "x", jws: "y" },
          },
        },
        DEFAULT_CONTEXT
      );

      expect(result.success).toBe(false);
      expect(result.error!.message).toContain("Invalid DID format");
    });

    it("should reject DID resolution failure", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("Network error"));
      const authenticator = new DIDWBAAuthenticator({
        resolver: { fetchFn },
      });

      const credentials = await createValidCredentials();
      const result = await authenticator.authenticate(credentials, DEFAULT_CONTEXT);

      expect(result.success).toBe(false);
      expect(result.error!.message).toContain("DID resolution failed");
    });

    it("should reject DID document with no verification keys", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          "@context": ["https://www.w3.org/ns/did/v1"],
          id: TEST_DID,
        }),
      });
      const authenticator = new DIDWBAAuthenticator({
        resolver: { fetchFn },
      });

      const credentials = await createValidCredentials();
      const result = await authenticator.authenticate(credentials, DEFAULT_CONTEXT);

      expect(result.success).toBe(false);
      expect(result.error!.message).toContain("No verification keys");
    });
  });

  describe("trusted domains", () => {
    it("should accept DID from trusted wildcard domain", async () => {
      const fetchFn = createMockFetch();
      const authenticator = new DIDWBAAuthenticator({
        resolver: { fetchFn },
        trustedDomains: ["*.example.com"],
      });

      const credentials = await createValidCredentials();
      const result = await authenticator.authenticate(credentials, DEFAULT_CONTEXT);

      expect(result.success).toBe(true);
    });

    it("should reject DID from untrusted domain", async () => {
      const authenticator = new DIDWBAAuthenticator({
        trustedDomains: ["trusted.org"],
      });

      const credentials = await createValidCredentials();
      const result = await authenticator.authenticate(credentials, DEFAULT_CONTEXT);

      expect(result.success).toBe(false);
      expect(result.error!.message).toContain("not in the trusted domains list");
    });

    it("should accept exact domain match", async () => {
      const fetchFn = createMockFetch();
      const authenticator = new DIDWBAAuthenticator({
        resolver: { fetchFn },
        trustedDomains: ["agents.example.com"],
      });

      const credentials = await createValidCredentials();
      const result = await authenticator.authenticate(credentials, DEFAULT_CONTEXT);

      expect(result.success).toBe(true);
    });
  });

  describe("isTrustedDomain", () => {
    it("should match wildcard subdomain", () => {
      const auth = new DIDWBAAuthenticator({ trustedDomains: ["*.example.com"] });

      expect(auth.isTrustedDomain("agents.example.com")).toBe(true);
      expect(auth.isTrustedDomain("deep.agents.example.com")).toBe(true);
      expect(auth.isTrustedDomain("example.com")).toBe(true);
      expect(auth.isTrustedDomain("evil.com")).toBe(false);
    });

    it("should match exact domain", () => {
      const auth = new DIDWBAAuthenticator({ trustedDomains: ["agents.example.com"] });

      expect(auth.isTrustedDomain("agents.example.com")).toBe(true);
      expect(auth.isTrustedDomain("other.example.com")).toBe(false);
    });

    it("should return true when no trusted domains configured", () => {
      const auth = new DIDWBAAuthenticator();
      expect(auth.isTrustedDomain("anything.example.com")).toBe(true);
    });
  });

  describe("generateChallenge", () => {
    it("should generate a valid challenge", () => {
      const auth = new DIDWBAAuthenticator();
      const challenge = auth.generateChallenge();
      expect(challenge).toMatch(/^map_chal_/);
    });

    it("should generate unique challenges", () => {
      const auth = new DIDWBAAuthenticator();
      expect(auth.generateChallenge()).not.toBe(auth.generateChallenge());
    });
  });

  describe("lifecycle", () => {
    it("should initialize without error", async () => {
      const auth = new DIDWBAAuthenticator();
      await expect(auth.initialize()).resolves.toBeUndefined();
    });

    it("should shutdown and clear cache", async () => {
      const auth = new DIDWBAAuthenticator();
      await expect(auth.shutdown()).resolves.toBeUndefined();
    });

    it("should report did:wba method", () => {
      const auth = new DIDWBAAuthenticator();
      expect(auth.methods).toContain("did:wba");
    });
  });
});
