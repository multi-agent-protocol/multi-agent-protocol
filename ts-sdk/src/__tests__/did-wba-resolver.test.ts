/**
 * Tests for DID:WBA resolver (Proposal 1).
 */

import { describe, it, expect, vi } from "vitest";
import { DIDWBAResolver, parseDIDWBA, didToUrl, isSafeDomain } from "../federation/did-wba/resolver";
import type { DIDDocument } from "../types";

// ============================================================================
// Tests: parseDIDWBA
// ============================================================================

describe("parseDIDWBA", () => {
  it("should parse a simple did:wba DID", () => {
    const result = parseDIDWBA("did:wba:agents.example.com:gateway");
    expect(result).toEqual({ domain: "agents.example.com", path: "gateway" });
  });

  it("should parse a multi-segment path", () => {
    const result = parseDIDWBA("did:wba:example.com:agents:worker-01");
    expect(result).toEqual({ domain: "example.com", path: "agents/worker-01" });
  });

  it("should parse a deep path", () => {
    const result = parseDIDWBA("did:wba:example.com:org:team:agent:alpha");
    expect(result).toEqual({ domain: "example.com", path: "org/team/agent/alpha" });
  });

  it("should throw for non-did:wba DID", () => {
    expect(() => parseDIDWBA("did:key:z6Mkh...")).toThrow("must start with");
  });

  it("should throw for DID without path", () => {
    expect(() => parseDIDWBA("did:wba:example.com")).toThrow("at least domain and path");
  });

  it("should throw for empty string", () => {
    expect(() => parseDIDWBA("")).toThrow("must start with");
  });

  it("should reject localhost (SSRF protection)", () => {
    expect(() => parseDIDWBA("did:wba:localhost:agent")).toThrow("not allowed");
  });

  it("should reject private IP 127.x (SSRF protection)", () => {
    expect(() => parseDIDWBA("did:wba:127.0.0.1:agent")).toThrow("not allowed");
  });

  it("should reject private IP 10.x (SSRF protection)", () => {
    expect(() => parseDIDWBA("did:wba:10.0.0.5:agent")).toThrow("not allowed");
  });

  it("should reject private IP 192.168.x (SSRF protection)", () => {
    expect(() => parseDIDWBA("did:wba:192.168.1.1:agent")).toThrow("not allowed");
  });

  it("should reject AWS metadata endpoint (SSRF protection)", () => {
    expect(() => parseDIDWBA("did:wba:169.254.169.254:latest:meta-data")).toThrow("not allowed");
  });

  it("should reject path traversal", () => {
    expect(() => parseDIDWBA("did:wba:example.com:..:..:etc")).toThrow("path traversal");
  });

  it("should reject empty path segments", () => {
    expect(() => parseDIDWBA("did:wba:example.com::agent")).toThrow("empty path segment");
  });

  it("should handle percent-encoded port numbers", () => {
    const result = parseDIDWBA("did:wba:example.com%3A8080:agent");
    expect(result.domain).toBe("example.com:8080");
    expect(result.path).toBe("agent");
  });
});

// ============================================================================
// Tests: didToUrl
// ============================================================================

describe("didToUrl", () => {
  it("should convert simple DID to URL", () => {
    expect(didToUrl("did:wba:agents.example.com:gateway")).toBe(
      "https://agents.example.com/gateway/did.json"
    );
  });

  it("should convert multi-segment DID to URL", () => {
    expect(didToUrl("did:wba:example.com:agents:worker-01")).toBe(
      "https://example.com/agents/worker-01/did.json"
    );
  });

  it("should throw for invalid DID", () => {
    expect(() => didToUrl("did:key:z6Mkh...")).toThrow();
  });
});

// ============================================================================
// Tests: DIDWBAResolver
// ============================================================================

describe("DIDWBAResolver", () => {
  const MOCK_DID = "did:wba:agents.example.com:gateway";
  const MOCK_DID_DOC: DIDDocument = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: MOCK_DID,
    verificationMethod: [
      {
        id: `${MOCK_DID}#key-1`,
        type: "JsonWebKey2020",
        controller: MOCK_DID,
        publicKeyJwk: { kty: "EC", crv: "P-256", x: "test-x", y: "test-y" },
      },
    ],
    authentication: [`${MOCK_DID}#key-1`],
    service: [
      {
        id: `${MOCK_DID}#map`,
        type: "MAPFederationEndpoint",
        serviceEndpoint: "wss://agents.example.com/map/federation",
        mapProtocolVersion: 1,
        mapCapabilities: { streaming: true },
      },
    ],
  };

  function createMockFetch(doc: DIDDocument = MOCK_DID_DOC, status = 200) {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Not Found",
      json: () => Promise.resolve(doc),
    } as any);
  }

  describe("resolve", () => {
    it("should resolve a DID document via HTTPS", async () => {
      const fetchFn = createMockFetch();
      const resolver = new DIDWBAResolver({ fetchFn });

      const doc = await resolver.resolve(MOCK_DID);

      expect(doc).toEqual(MOCK_DID_DOC);
      expect(fetchFn).toHaveBeenCalledWith(
        "https://agents.example.com/gateway/did.json",
        expect.objectContaining({
          headers: { Accept: "application/json" },
        })
      );
    });

    it("should cache resolved documents", async () => {
      const fetchFn = createMockFetch();
      const resolver = new DIDWBAResolver({ fetchFn });

      await resolver.resolve(MOCK_DID);
      await resolver.resolve(MOCK_DID);

      // Only one fetch call — second was served from cache
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("should re-fetch after cache expiry", async () => {
      const fetchFn = createMockFetch();
      const resolver = new DIDWBAResolver({ fetchFn, cacheTtlMs: 0 });

      await resolver.resolve(MOCK_DID);
      await resolver.resolve(MOCK_DID);

      // Both fetched — cache expired immediately
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("should throw on HTTP error", async () => {
      const fetchFn = createMockFetch(MOCK_DID_DOC, 404);
      const resolver = new DIDWBAResolver({ fetchFn });

      await expect(resolver.resolve(MOCK_DID)).rejects.toThrow("HTTP 404");
    });

    it("should throw on network error", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("Connection refused"));
      const resolver = new DIDWBAResolver({ fetchFn });

      await expect(resolver.resolve(MOCK_DID)).rejects.toThrow("Connection refused");
    });

    it("should throw on DID mismatch", async () => {
      const wrongDoc = { ...MOCK_DID_DOC, id: "did:wba:other.example.com:agent" };
      const fetchFn = createMockFetch(wrongDoc);
      const resolver = new DIDWBAResolver({ fetchFn });

      await expect(resolver.resolve(MOCK_DID)).rejects.toThrow("mismatch");
    });

    it("should throw on missing id field", async () => {
      const badDoc = { "@context": [], id: "" } as any;
      const fetchFn = createMockFetch(badDoc);
      const resolver = new DIDWBAResolver({ fetchFn });

      await expect(resolver.resolve(MOCK_DID)).rejects.toThrow('missing "id"');
    });
  });

  describe("extractMAPEndpoint", () => {
    it("should extract MAP federation endpoint", () => {
      const resolver = new DIDWBAResolver();
      const endpoint = resolver.extractMAPEndpoint(MOCK_DID_DOC);
      expect(endpoint).toBe("wss://agents.example.com/map/federation");
    });

    it("should return undefined when no MAP service", () => {
      const resolver = new DIDWBAResolver();
      const doc: DIDDocument = { "@context": [], id: MOCK_DID };
      expect(resolver.extractMAPEndpoint(doc)).toBeUndefined();
    });
  });

  describe("extractVerificationKeys", () => {
    it("should extract keys referenced by authentication", () => {
      const resolver = new DIDWBAResolver();
      const keys = resolver.extractVerificationKeys(MOCK_DID_DOC);
      expect(keys).toHaveLength(1);
      expect(keys[0].id).toBe(`${MOCK_DID}#key-1`);
    });

    it("should return empty array when no authentication", () => {
      const resolver = new DIDWBAResolver();
      const doc: DIDDocument = { "@context": [], id: MOCK_DID };
      expect(resolver.extractVerificationKeys(doc)).toHaveLength(0);
    });

    it("should skip unresolvable key references", () => {
      const resolver = new DIDWBAResolver();
      const doc: DIDDocument = {
        "@context": [],
        id: MOCK_DID,
        verificationMethod: [
          { id: `${MOCK_DID}#key-1`, type: "test", controller: MOCK_DID },
        ],
        authentication: [`${MOCK_DID}#key-2`], // References non-existent key
      };
      expect(resolver.extractVerificationKeys(doc)).toHaveLength(0);
    });
  });

  describe("clearCache", () => {
    it("should clear cached documents", async () => {
      const fetchFn = createMockFetch();
      const resolver = new DIDWBAResolver({ fetchFn });

      await resolver.resolve(MOCK_DID);
      resolver.clearCache();
      await resolver.resolve(MOCK_DID);

      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });
});
