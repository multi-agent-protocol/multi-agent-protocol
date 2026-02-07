/**
 * Tests for AgentIAMFederationGateway — cross-system token verification
 * and preparation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentIAMFederationGateway } from "../server/auth/providers/agent-iam-federation";
import { AgentIAMProvider } from "../server/auth/providers/agent-iam";
import type { AgentIAMFederationGatewayOptions } from "../server/auth/providers/agent-iam-federation";
import type {
  AgentIAMToken,
  TokenServiceLike,
} from "../server/auth/providers/agent-iam";
import type {
  FederationContext,
  FederationTrustConfig,
} from "../server/auth/types";

// =============================================================================
// Test helpers
// =============================================================================

function createMockToken(overrides?: Partial<AgentIAMToken>): AgentIAMToken {
  return {
    agentId: "agent-001",
    scopes: ["files:read", "compute:run"],
    constraints: {},
    delegatable: true,
    maxDelegationDepth: 3,
    currentDepth: 0,
    signature: "valid-sig",
    expiresAt: "2026-12-31T23:59:59Z",
    identity: {
      systemId: "system-a",
      principalId: "user-123",
      principalType: "human",
    },
    federation: {
      crossSystemAllowed: true,
      allowedSystems: ["system-a", "system-b", "system-c"],
      originSystem: "system-a",
      hopCount: 0,
      maxHops: 5,
      allowFurtherFederation: true,
    },
    ...overrides,
  };
}

function createMockTokenService(
  overrides?: Partial<TokenServiceLike>,
): TokenServiceLike {
  return {
    verify: vi.fn().mockReturnValue({ valid: true }),
    serialize: vi.fn().mockReturnValue("serialized-token"),
    deserialize: vi.fn().mockImplementation((s: string) => JSON.parse(s)),
    delegate: vi.fn().mockImplementation((parent: AgentIAMToken, req) => ({
      ...parent,
      agentId: req.agentId ?? parent.agentId,
      scopes: req.requestedScopes,
      delegatable: req.delegatable ?? parent.delegatable,
      currentDepth: parent.currentDepth + 1,
    })),
    ...overrides,
  };
}

function createFederationContext(
  overrides?: Partial<FederationContext>,
): FederationContext {
  return {
    localSystemId: "system-b",
    ...overrides,
  };
}

function createGateway(
  overrides?: Partial<AgentIAMFederationGatewayOptions>,
): AgentIAMFederationGateway {
  const localTokenService = createMockTokenService();
  const peerTokenServices: Record<string, TokenServiceLike> = {
    "system-a": createMockTokenService(),
  };

  return new AgentIAMFederationGateway({
    localTokenService,
    localSystemId: "system-b",
    peerTokenServices,
    ...overrides,
  });
}

// =============================================================================
// handleFederatedToken — happy path
// =============================================================================

describe("AgentIAMFederationGateway handleFederatedToken", () => {
  describe("happy path", () => {
    it("should accept a valid token from a known peer", async () => {
      const token = createMockToken();
      const peerSvc = createMockTokenService();
      const gateway = createGateway({
        peerTokenServices: { "system-a": peerSvc },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(true);
      expect(result.principal).toBeDefined();
      expect(result.principal!.id).toBe("federated:system-a:agent-001");
      expect(result.principal!.issuer).toBe("system-a");
    });

    it("should accept token-as-string and deserialize via peer service", async () => {
      const token = createMockToken();
      const serialized = JSON.stringify(token);
      const peerSvc = createMockTokenService({
        deserialize: vi.fn().mockReturnValue(token),
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": peerSvc },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        serialized,
        createFederationContext(),
      );

      expect(result.allowed).toBe(true);
      expect(peerSvc.deserialize).toHaveBeenCalledWith(serialized);
    });

    it("should accept token-as-object without deserializing", async () => {
      const token = createMockToken();
      const peerSvc = createMockTokenService();
      const gateway = createGateway({
        peerTokenServices: { "system-a": peerSvc },
      });

      await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(peerSvc.deserialize).not.toHaveBeenCalled();
    });

    it("should translate scopes via peer trust config", async () => {
      const token = createMockToken({ scopes: ["files:read", "compute:run"] });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
        peerTrustConfigs: {
          "system-a": {
            scopeMapping: { "files:": "storage:", "compute:": "exec:" },
          },
        },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(true);
      expect(result.principal!.claims!.scopes).toEqual([
        "storage:read",
        "exec:run",
      ]);
    });

    it("should use context trust config scope mapping with precedence over peer config", async () => {
      const token = createMockToken({ scopes: ["files:read"] });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
        peerTrustConfigs: {
          "system-a": { scopeMapping: { "files:": "storage:" } },
        },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext({
          trustConfig: { scopeMapping: { "files:": "docs:" } },
        }),
      );

      expect(result.allowed).toBe(true);
      // Context mapping overrides peer mapping
      expect(result.principal!.claims!.scopes).toEqual(["docs:read"]);
    });

    it("should increment hop count in principal claims", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          hopCount: 1,
          maxHops: 5,
          allowFurtherFederation: true,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(true);
      expect(result.principal!.claims!.hopCount).toBe(2);
    });

    it("should preserve identity claims in principal", async () => {
      const token = createMockToken({
        identity: {
          systemId: "system-a",
          principalId: "user-123",
          principalType: "human",
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.principal!.claims!.principalId).toBe("user-123");
      expect(result.principal!.claims!.principalType).toBe("human");
    });

    it("should set originSystem from token metadata, defaulting to sourceSystemId", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          originSystem: "system-origin",
          hopCount: 0,
          maxHops: 5,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.principal!.claims!.originSystem).toBe("system-origin");
    });

    it("should default originSystem to sourceSystemId when not set", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          originSystem: undefined,
          hopCount: 0,
          maxHops: 5,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.principal!.claims!.originSystem).toBe("system-a");
    });

    it("should accept when allowedSystems is unset (open federation)", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          allowedSystems: undefined,
          hopCount: 0,
          maxHops: 5,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // handleFederatedToken — rejection cases
  // ===========================================================================

  describe("rejection cases", () => {
    it("should reject unknown peer system", async () => {
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-unknown",
        createMockToken(),
        createFederationContext(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Unknown peer system");
    });

    it("should reject when source not in context trustedSystems", async () => {
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        createMockToken(),
        createFederationContext({
          trustConfig: { trustedSystems: ["system-c"] },
        }),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not in trusted systems");
    });

    it("should reject on deserialization failure", async () => {
      const peerSvc = createMockTokenService({
        deserialize: vi.fn().mockImplementation(() => {
          throw new Error("bad token");
        }),
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": peerSvc },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        "invalid-string",
        createFederationContext(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("deserialize");
    });

    it("should reject on verification failure", async () => {
      const peerSvc = createMockTokenService({
        verify: vi
          .fn()
          .mockReturnValue({ valid: false, error: "Bad signature" }),
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": peerSvc },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        createMockToken(),
        createFederationContext(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Bad signature");
    });

    it("should reject when crossSystemAllowed is false", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: false,
          hopCount: 0,
          maxHops: 5,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cross-system federation");
    });

    it("should reject when no federation field on token", async () => {
      const token = createMockToken({ federation: undefined });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cross-system federation");
    });

    it("should reject when local system not in allowedSystems", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          allowedSystems: ["system-a", "system-c"],
          hopCount: 0,
          maxHops: 5,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext({ localSystemId: "system-b" }),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not in token allowedSystems");
    });

    it("should reject when max hops exceeded", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          hopCount: 5,
          maxHops: 5,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Max federation hops");
    });

    it("should use minimum of token maxHops, context maxHops, and default maxHops", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          hopCount: 2,
          maxHops: 10, // token says 10
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
        defaultMaxHops: 3, // default says 3
      });

      // hopCount 2 >= min(10, 3) = 3? No, 2 < 3 → allowed
      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext({
          trustConfig: { maxHops: 2 }, // context says 2
        }),
      );

      // min(10, 2, 3) = 2 → hopCount 2 >= 2 → rejected
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Max federation hops");
    });

    it("should reject when allowFurtherFederation is false and hopCount > 0", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          hopCount: 1,
          maxHops: 5,
          allowFurtherFederation: false,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("further federation");
    });

    it("should allow when allowFurtherFederation is false but hopCount is 0 (first hop)", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          hopCount: 0,
          maxHops: 5,
          allowFurtherFederation: false,
        },
      });
      const gateway = createGateway({
        peerTokenServices: { "system-a": createMockTokenService() },
      });

      const result = await gateway.handleFederatedToken(
        "system-a",
        token,
        createFederationContext(),
      );

      expect(result.allowed).toBe(true);
    });
  });
});

// =============================================================================
// prepareFederatedToken
// =============================================================================

describe("AgentIAMFederationGateway prepareFederatedToken", () => {
  describe("happy path", () => {
    it("should prepare a token for a valid target", async () => {
      const localSvc = createMockTokenService();
      const gateway = createGateway({ localTokenService: localSvc });

      const token = createMockToken();
      const result = await gateway.prepareFederatedToken(
        { id: "agent-001" },
        token,
        "system-c",
      );

      expect(result.allowed).toBe(true);
      expect(result.token).toBe("serialized-token");
      expect(localSvc.delegate).toHaveBeenCalled();
      expect(localSvc.serialize).toHaveBeenCalled();
    });

    it("should use custom TTL when configured", async () => {
      const localSvc = createMockTokenService();
      const gateway = createGateway({
        localTokenService: localSvc,
        federatedTokenTTLMinutes: 30,
      });

      const token = createMockToken();
      await gateway.prepareFederatedToken({ id: "agent-001" }, token, "system-c");

      expect(localSvc.delegate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ttlMinutes: 30 }),
      );
    });

    it("should use default 60 minute TTL when not configured", async () => {
      const localSvc = createMockTokenService();
      const gateway = createGateway({ localTokenService: localSvc });

      const token = createMockToken();
      await gateway.prepareFederatedToken({ id: "agent-001" }, token, "system-c");

      expect(localSvc.delegate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ttlMinutes: 60 }),
      );
    });

    it("should increment hop count on delegated token", async () => {
      const localSvc = createMockTokenService();
      // Capture what gets serialized
      let serializedToken: AgentIAMToken | undefined;
      localSvc.serialize = vi.fn().mockImplementation((t: AgentIAMToken) => {
        serializedToken = t;
        return "serialized";
      });

      const gateway = createGateway({ localTokenService: localSvc });
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          hopCount: 1,
          maxHops: 5,
          allowFurtherFederation: true,
          allowedSystems: ["system-c"],
        },
      });

      await gateway.prepareFederatedToken({ id: "agent-001" }, token, "system-c");

      expect(serializedToken!.federation!.hopCount).toBe(2);
    });

    it("should preserve originSystem on delegated token", async () => {
      const localSvc = createMockTokenService();
      let serializedToken: AgentIAMToken | undefined;
      localSvc.serialize = vi.fn().mockImplementation((t: AgentIAMToken) => {
        serializedToken = t;
        return "serialized";
      });

      const gateway = createGateway({ localTokenService: localSvc });
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          originSystem: "system-origin",
          hopCount: 0,
          maxHops: 5,
          allowedSystems: ["system-c"],
        },
      });

      await gateway.prepareFederatedToken({ id: "agent-001" }, token, "system-c");

      expect(serializedToken!.federation!.originSystem).toBe("system-origin");
    });

    it("should set originSystem to localSystemId when not set on source token", async () => {
      const localSvc = createMockTokenService();
      let serializedToken: AgentIAMToken | undefined;
      localSvc.serialize = vi.fn().mockImplementation((t: AgentIAMToken) => {
        serializedToken = t;
        return "serialized";
      });

      const gateway = createGateway({
        localTokenService: localSvc,
        localSystemId: "system-b",
      });
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          originSystem: undefined,
          hopCount: 0,
          maxHops: 5,
          allowedSystems: ["system-c"],
        },
      });

      await gateway.prepareFederatedToken({ id: "agent-001" }, token, "system-c");

      expect(serializedToken!.federation!.originSystem).toBe("system-b");
    });

    it("should translate scopes via peer trust config for target", async () => {
      const localSvc = createMockTokenService();
      const gateway = createGateway({
        localTokenService: localSvc,
        peerTrustConfigs: {
          "system-c": {
            scopeMapping: { "files:": "storage:", "compute:": "exec:" },
          },
        },
      });

      const token = createMockToken({
        scopes: ["files:read", "compute:run"],
        federation: {
          crossSystemAllowed: true,
          hopCount: 0,
          maxHops: 5,
          allowedSystems: ["system-c"],
        },
      });

      await gateway.prepareFederatedToken({ id: "agent-001" }, token, "system-c");

      expect(localSvc.delegate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          requestedScopes: ["storage:read", "exec:run"],
        }),
      );
    });

    it("should delegate with delegatable=false and inheritIdentity=true", async () => {
      const localSvc = createMockTokenService();
      const gateway = createGateway({ localTokenService: localSvc });

      const token = createMockToken();
      await gateway.prepareFederatedToken({ id: "agent-001" }, token, "system-c");

      expect(localSvc.delegate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          delegatable: false,
          inheritIdentity: true,
        }),
      );
    });
  });

  // ===========================================================================
  // prepareFederatedToken — rejection cases
  // ===========================================================================

  describe("rejection cases", () => {
    it("should reject when providerData is null", async () => {
      const gateway = createGateway();

      const result = await gateway.prepareFederatedToken(
        { id: "agent-001" },
        null,
        "system-c",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No token data");
    });

    it("should reject when providerData is undefined", async () => {
      const gateway = createGateway();

      const result = await gateway.prepareFederatedToken(
        { id: "agent-001" },
        undefined,
        "system-c",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No token data");
    });

    it("should reject when crossSystemAllowed is false", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: false,
          hopCount: 0,
          maxHops: 5,
        },
      });
      const gateway = createGateway();

      const result = await gateway.prepareFederatedToken(
        { id: "agent-001" },
        token,
        "system-c",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cross-system federation");
    });

    it("should reject when federation field is missing", async () => {
      const token = createMockToken({ federation: undefined });
      const gateway = createGateway();

      const result = await gateway.prepareFederatedToken(
        { id: "agent-001" },
        token,
        "system-c",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cross-system federation");
    });

    it("should reject when target not in allowedSystems", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          allowedSystems: ["system-a", "system-b"],
          hopCount: 0,
          maxHops: 5,
        },
      });
      const gateway = createGateway();

      const result = await gateway.prepareFederatedToken(
        { id: "agent-001" },
        token,
        "system-c",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Target system not in token allowedSystems");
    });

    it("should reject when max hops exceeded", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          hopCount: 5,
          maxHops: 5,
          allowedSystems: ["system-c"],
        },
      });
      const gateway = createGateway();

      const result = await gateway.prepareFederatedToken(
        { id: "agent-001" },
        token,
        "system-c",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Max federation hops");
    });

    it("should reject when allowFurtherFederation is false and hopCount > 0", async () => {
      const token = createMockToken({
        federation: {
          crossSystemAllowed: true,
          hopCount: 1,
          maxHops: 5,
          allowFurtherFederation: false,
          allowedSystems: ["system-c"],
        },
      });
      const gateway = createGateway();

      const result = await gateway.prepareFederatedToken(
        { id: "agent-001" },
        token,
        "system-c",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("further federation");
    });
  });
});

// =============================================================================
// AgentIAMProvider integration — delegation to gateway
// =============================================================================

describe("AgentIAMProvider federation gateway integration", () => {
  it("should delegate handleFederatedToken to gateway", async () => {
    const peerSvc = createMockTokenService();
    const gateway = new AgentIAMFederationGateway({
      localTokenService: createMockTokenService(),
      localSystemId: "system-b",
      peerTokenServices: { "system-a": peerSvc },
    });

    const provider = new AgentIAMProvider({
      tokenService: createMockTokenService(),
      federationGateway: gateway,
    });

    const token = createMockToken();
    const result = await provider.handleFederatedToken(
      "system-a",
      token,
      createFederationContext(),
    );

    expect(result.allowed).toBe(true);
    expect(result.principal!.id).toBe("federated:system-a:agent-001");
  });

  it("should delegate prepareFederatedToken to gateway", async () => {
    const localSvc = createMockTokenService();
    const gateway = new AgentIAMFederationGateway({
      localTokenService: localSvc,
      localSystemId: "system-b",
      peerTokenServices: {},
    });

    const provider = new AgentIAMProvider({
      tokenService: createMockTokenService(),
      federationGateway: gateway,
    });

    const token = createMockToken();
    const result = await provider.prepareFederatedToken(
      { id: "agent-001" },
      token,
      "system-c",
    );

    expect(result.allowed).toBe(true);
    expect(result.token).toBe("serialized-token");
  });

  it("should return 'not configured' for handleFederatedToken without gateway", async () => {
    const provider = new AgentIAMProvider({
      tokenService: createMockTokenService(),
    });

    const result = await provider.handleFederatedToken(
      "system-a",
      createMockToken(),
      createFederationContext(),
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not configured");
  });

  it("should return 'not configured' for prepareFederatedToken without gateway", async () => {
    const provider = new AgentIAMProvider({
      tokenService: createMockTokenService(),
    });

    const result = await provider.prepareFederatedToken(
      { id: "agent-001" },
      createMockToken(),
      "system-c",
    );

    expect(result.allowed).toBe(false);
    expect(result.token).toBe("");
    expect(result.reason).toContain("not configured");
  });
});

// =============================================================================
// Scope translation
// =============================================================================

describe("scope translation", () => {
  it("should pass through all scopes when no mapping exists", async () => {
    const gateway = createGateway({
      peerTokenServices: { "system-a": createMockTokenService() },
    });

    const token = createMockToken({ scopes: ["files:read", "compute:run"] });
    const result = await gateway.handleFederatedToken(
      "system-a",
      token,
      createFederationContext(),
    );

    expect(result.principal!.claims!.scopes).toEqual([
      "files:read",
      "compute:run",
    ]);
  });

  it("should translate matching prefixes", async () => {
    const gateway = createGateway({
      peerTokenServices: { "system-a": createMockTokenService() },
      peerTrustConfigs: {
        "system-a": { scopeMapping: { "files:": "storage:" } },
      },
    });

    const token = createMockToken({ scopes: ["files:read", "files:write"] });
    const result = await gateway.handleFederatedToken(
      "system-a",
      token,
      createFederationContext(),
    );

    expect(result.principal!.claims!.scopes).toEqual([
      "storage:read",
      "storage:write",
    ]);
  });

  it("should leave non-matching scopes unchanged", async () => {
    const gateway = createGateway({
      peerTokenServices: { "system-a": createMockTokenService() },
      peerTrustConfigs: {
        "system-a": { scopeMapping: { "files:": "storage:" } },
      },
    });

    const token = createMockToken({
      scopes: ["files:read", "compute:run"],
    });
    const result = await gateway.handleFederatedToken(
      "system-a",
      token,
      createFederationContext(),
    );

    expect(result.principal!.claims!.scopes).toEqual([
      "storage:read",
      "compute:run",
    ]);
  });

  it("should use longest prefix match", async () => {
    const gateway = createGateway({
      peerTokenServices: { "system-a": createMockTokenService() },
      peerTrustConfigs: {
        "system-a": {
          scopeMapping: {
            "files:": "storage:",
            "files:admin:": "admin-storage:",
          },
        },
      },
    });

    const token = createMockToken({
      scopes: ["files:read", "files:admin:delete"],
    });
    const result = await gateway.handleFederatedToken(
      "system-a",
      token,
      createFederationContext(),
    );

    expect(result.principal!.claims!.scopes).toEqual([
      "storage:read",
      "admin-storage:delete",
    ]);
  });

  it("should handle exact-match scopes (no suffix after prefix)", async () => {
    const gateway = createGateway({
      peerTokenServices: { "system-a": createMockTokenService() },
      peerTrustConfigs: {
        "system-a": { scopeMapping: { admin: "superuser" } },
      },
    });

    const token = createMockToken({ scopes: ["admin"] });
    const result = await gateway.handleFederatedToken(
      "system-a",
      token,
      createFederationContext(),
    );

    expect(result.principal!.claims!.scopes).toEqual(["superuser"]);
  });
});
