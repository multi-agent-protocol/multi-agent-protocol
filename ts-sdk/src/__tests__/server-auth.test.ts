/**
 * Tests for server authentication system
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AuthManagerImpl,
  NoAuthAuthenticator,
  APIKeyAuthenticator,
  MTLSAuthenticator,
  createSimpleAPIKeyAuthenticator,
  authMiddleware,
  AuthenticationError,
} from "../server/auth";
import type {
  Authenticator,
  AuthContext,
  AuthManager,
} from "../server/auth";
import type { AuthCredentials } from "../types";
import type { ServerSession, HandlerContext } from "../server/types";

// =============================================================================
// NoAuthAuthenticator Tests
// =============================================================================

describe("NoAuthAuthenticator", () => {
  it("should authenticate any request", async () => {
    const authenticator = new NoAuthAuthenticator();

    const result = await authenticator.authenticate(
      { method: "none" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.principal?.id).toBe("anonymous");
  });

  it("should use custom principal ID", async () => {
    const authenticator = new NoAuthAuthenticator({
      defaultPrincipalId: "local-agent",
    });

    const result = await authenticator.authenticate(
      { method: "none" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.principal?.id).toBe("local-agent");
  });

  it("should include custom claims", async () => {
    const authenticator = new NoAuthAuthenticator({
      defaultPrincipalId: "test-user",
      defaultClaims: { role: "admin", tier: "premium" },
    });

    const result = await authenticator.authenticate(
      { method: "none" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.principal?.claims).toEqual({ role: "admin", tier: "premium" });
  });

  it("should expose correct methods", () => {
    const authenticator = new NoAuthAuthenticator();
    expect(authenticator.methods).toEqual(["none"]);
  });
});

// =============================================================================
// APIKeyAuthenticator Tests
// =============================================================================

describe("APIKeyAuthenticator", () => {
  it("should validate correct API key", async () => {
    const authenticator = new APIKeyAuthenticator({
      validateKey: async (key) => {
        if (key === "valid-key-123") {
          return { valid: true, principalId: "user-456" };
        }
        return { valid: false };
      },
    });

    const result = await authenticator.authenticate(
      { method: "api-key", credential: "valid-key-123" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.principal?.id).toBe("user-456");
  });

  it("should reject invalid API key", async () => {
    const authenticator = new APIKeyAuthenticator({
      validateKey: async (key) => {
        return { valid: false, error: "Unknown API key" };
      },
    });

    const result = await authenticator.authenticate(
      { method: "api-key", credential: "invalid-key" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("invalid_credentials");
    expect(result.error?.message).toBe("Unknown API key");
  });

  it("should reject missing credential", async () => {
    const authenticator = new APIKeyAuthenticator({
      validateKey: async () => ({ valid: true, principalId: "test" }),
    });

    const result = await authenticator.authenticate(
      { method: "api-key" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("invalid_credentials");
    expect(result.error?.message).toContain("required");
  });

  it("should include metadata as claims", async () => {
    const authenticator = new APIKeyAuthenticator({
      validateKey: async (key) => ({
        valid: true,
        principalId: "user-1",
        metadata: { scopes: ["read", "write"], tier: "pro" },
      }),
    });

    const result = await authenticator.authenticate(
      { method: "api-key", credential: "any-key" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.principal?.claims).toEqual({
      scopes: ["read", "write"],
      tier: "pro",
    });
  });

  it("should support key extraction", async () => {
    const authenticator = new APIKeyAuthenticator({
      extractKey: (credential) => credential.replace(/^Bearer\s+/i, ""),
      validateKey: async (key) => {
        if (key === "extracted-key") {
          return { valid: true, principalId: "user-1" };
        }
        return { valid: false };
      },
    });

    const result = await authenticator.authenticate(
      { method: "api-key", credential: "Bearer extracted-key" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.principal?.id).toBe("user-1");
  });

  it("should pass context to validator", async () => {
    const validateKey = vi.fn().mockResolvedValue({ valid: true, principalId: "user-1" });

    const authenticator = new APIKeyAuthenticator({ validateKey });

    const context: AuthContext = {
      transportType: "websocket",
      remoteAddress: "192.168.1.1",
    };

    await authenticator.authenticate(
      { method: "api-key", credential: "key-123" },
      context
    );

    expect(validateKey).toHaveBeenCalledWith("key-123", context);
  });

  it("should throw if validateKey not provided", () => {
    expect(() => {
      // @ts-expect-error - testing missing required option
      new APIKeyAuthenticator({});
    }).toThrow("validateKey");
  });
});

describe("createSimpleAPIKeyAuthenticator", () => {
  it("should create authenticator with static keys", async () => {
    const authenticator = createSimpleAPIKeyAuthenticator({
      "key-1": "user-1",
      "key-2": "user-2",
    });

    const result1 = await authenticator.authenticate(
      { method: "api-key", credential: "key-1" },
      {}
    );
    expect(result1.success).toBe(true);
    expect(result1.principal?.id).toBe("user-1");

    const result2 = await authenticator.authenticate(
      { method: "api-key", credential: "key-2" },
      {}
    );
    expect(result2.success).toBe(true);
    expect(result2.principal?.id).toBe("user-2");

    const result3 = await authenticator.authenticate(
      { method: "api-key", credential: "unknown-key" },
      {}
    );
    expect(result3.success).toBe(false);
  });
});

// =============================================================================
// MTLSAuthenticator Tests
// =============================================================================

describe("MTLSAuthenticator", () => {
  const validCert = {
    subject: "CN=agent-worker-01,O=MyOrg",
    issuer: "CN=MyCA,O=MyOrg",
    fingerprint: "sha256:abc123",
    validFrom: new Date(Date.now() - 86400000), // 1 day ago
    validTo: new Date(Date.now() + 86400000), // 1 day from now
  };

  it("should authenticate with valid certificate", async () => {
    const authenticator = new MTLSAuthenticator();

    const result = await authenticator.authenticate(
      { method: "mtls" },
      { tlsCertificate: validCert }
    );

    expect(result.success).toBe(true);
    expect(result.principal?.id).toBe("agent-worker-01");
    expect(result.principal?.issuer).toBe("CN=MyCA,O=MyOrg");
  });

  it("should reject missing certificate", async () => {
    const authenticator = new MTLSAuthenticator();

    const result = await authenticator.authenticate(
      { method: "mtls" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("invalid_credentials");
    expect(result.error?.message).toContain("certificate not provided");
  });

  it("should reject expired certificate", async () => {
    const authenticator = new MTLSAuthenticator();

    const expiredCert = {
      ...validCert,
      validTo: new Date(Date.now() - 1000), // Expired
    };

    const result = await authenticator.authenticate(
      { method: "mtls" },
      { tlsCertificate: expiredCert }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("expired");
  });

  it("should reject not-yet-valid certificate", async () => {
    const authenticator = new MTLSAuthenticator();

    const futureCert = {
      ...validCert,
      validFrom: new Date(Date.now() + 86400000), // 1 day from now
    };

    const result = await authenticator.authenticate(
      { method: "mtls" },
      { tlsCertificate: futureCert }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("invalid_credentials");
  });

  it("should enforce fingerprint allowlist", async () => {
    const authenticator = new MTLSAuthenticator({
      allowedFingerprints: ["sha256:allowed1", "sha256:allowed2"],
    });

    // Rejected fingerprint
    const result1 = await authenticator.authenticate(
      { method: "mtls" },
      { tlsCertificate: { ...validCert, fingerprint: "sha256:notallowed" } }
    );
    expect(result1.success).toBe(false);
    expect(result1.error?.message).toContain("fingerprint");

    // Allowed fingerprint
    const result2 = await authenticator.authenticate(
      { method: "mtls" },
      { tlsCertificate: { ...validCert, fingerprint: "sha256:allowed1" } }
    );
    expect(result2.success).toBe(true);
  });

  it("should enforce issuer allowlist", async () => {
    const authenticator = new MTLSAuthenticator({
      allowedIssuers: ["CN=TrustedCA,O=TrustedOrg"],
    });

    // Rejected issuer
    const result1 = await authenticator.authenticate(
      { method: "mtls" },
      { tlsCertificate: validCert }
    );
    expect(result1.success).toBe(false);
    expect(result1.error?.message).toContain("issuer");

    // Allowed issuer
    const result2 = await authenticator.authenticate(
      { method: "mtls" },
      {
        tlsCertificate: {
          ...validCert,
          issuer: "CN=TrustedCA,O=TrustedOrg",
        },
      }
    );
    expect(result2.success).toBe(true);
  });

  it("should support custom certificate validation", async () => {
    const authenticator = new MTLSAuthenticator({
      validateCertificate: async (cert) => {
        if (cert.fingerprint === "sha256:revoked") {
          return "Certificate has been revoked";
        }
        return true;
      },
    });

    const result = await authenticator.authenticate(
      { method: "mtls" },
      { tlsCertificate: { ...validCert, fingerprint: "sha256:revoked" } }
    );

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("Certificate has been revoked");
  });

  it("should support custom principal ID extraction", async () => {
    const authenticator = new MTLSAuthenticator({
      extractPrincipalId: (subject) => `custom-${subject.split(",")[0]}`,
    });

    const result = await authenticator.authenticate(
      { method: "mtls" },
      { tlsCertificate: validCert }
    );

    expect(result.success).toBe(true);
    expect(result.principal?.id).toBe("custom-CN=agent-worker-01");
  });
});

// =============================================================================
// AuthManagerImpl Tests
// =============================================================================

describe("AuthManagerImpl", () => {
  it("should list supported methods from authenticators", () => {
    const manager = new AuthManagerImpl({
      authenticators: [
        new NoAuthAuthenticator(),
        createSimpleAPIKeyAuthenticator({ key: "user" }),
      ],
    });

    expect(manager.supportedMethods).toContain("none");
    expect(manager.supportedMethods).toContain("api-key");
  });

  it("should route authentication to correct authenticator", async () => {
    const manager = new AuthManagerImpl({
      authenticators: [
        new NoAuthAuthenticator({ defaultPrincipalId: "anon" }),
        createSimpleAPIKeyAuthenticator({ "key-1": "user-1" }),
      ],
    });

    const result1 = await manager.authenticate({ method: "none" }, {});
    expect(result1.success).toBe(true);
    expect(result1.principal?.id).toBe("anon");

    const result2 = await manager.authenticate(
      { method: "api-key", credential: "key-1" },
      {}
    );
    expect(result2.success).toBe(true);
    expect(result2.principal?.id).toBe("user-1");
  });

  it("should reject unsupported method", async () => {
    const manager = new AuthManagerImpl({
      authenticators: [new NoAuthAuthenticator()],
    });

    const result = await manager.authenticate(
      { method: "bearer", credential: "token" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("method_not_supported");
  });

  it("should return correct capabilities", () => {
    const manager = new AuthManagerImpl({
      required: true,
      authenticators: [new NoAuthAuthenticator()],
      oauth2MetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
      jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      realm: "my-server",
    });

    const capabilities = manager.getCapabilities();

    expect(capabilities.required).toBe(true);
    expect(capabilities.methods).toContain("none");
    expect(capabilities.oauth2MetadataUrl).toBe(
      "https://auth.example.com/.well-known/oauth-authorization-server"
    );
    expect(capabilities.jwksUrl).toBe("https://auth.example.com/.well-known/jwks.json");
    expect(capabilities.realm).toBe("my-server");
  });

  it("should bypass auth for configured transports", () => {
    const manager = new AuthManagerImpl({
      required: true,
      authenticators: [new NoAuthAuthenticator()],
      bypassForTransports: { stdio: true, inprocess: true },
    });

    expect(manager.shouldBypass({ transportType: "stdio" })).toBe(true);
    expect(manager.shouldBypass({ transportType: "inprocess" })).toBe(true);
    expect(manager.shouldBypass({ transportType: "websocket" })).toBe(false);
  });

  it("should always bypass if auth not required", () => {
    const manager = new AuthManagerImpl({
      required: false,
      authenticators: [new NoAuthAuthenticator()],
    });

    expect(manager.shouldBypass({ transportType: "websocket" })).toBe(true);
  });

  it("should initialize and shutdown authenticators", async () => {
    const initFn = vi.fn();
    const shutdownFn = vi.fn();

    const customAuthenticator: Authenticator = {
      methods: ["x-custom"],
      authenticate: async () => ({ success: true, principal: { id: "test" } }),
      initialize: initFn,
      shutdown: shutdownFn,
    };

    const manager = new AuthManagerImpl({
      authenticators: [customAuthenticator],
    });

    await manager.initialize();
    expect(initFn).toHaveBeenCalledTimes(1);

    await manager.shutdown();
    expect(shutdownFn).toHaveBeenCalledTimes(1);
  });

  it("should handle authenticator errors gracefully", async () => {
    const errorAuthenticator: Authenticator = {
      methods: ["x-error"],
      authenticate: async () => {
        throw new Error("Authenticator crashed!");
      },
    };

    const manager = new AuthManagerImpl({
      authenticators: [errorAuthenticator],
    });

    const result = await manager.authenticate({ method: "x-error" }, {});

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("invalid_credentials");
    expect(result.error?.message).toContain("Authenticator crashed!");
  });

  it("should warn about duplicate method registrations", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    new AuthManagerImpl({
      authenticators: [
        createSimpleAPIKeyAuthenticator({ key1: "user1" }),
        createSimpleAPIKeyAuthenticator({ key2: "user2" }),
      ],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Multiple authenticators")
    );

    warnSpy.mockRestore();
  });
});

// =============================================================================
// Auth Middleware Tests
// =============================================================================

describe("authMiddleware", () => {
  const createSession = (
    overrides: Partial<ServerSession> = {}
  ): ServerSession => ({
    id: "session-1",
    role: "client",
    status: "connected",
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    metadata: {},
    agentIds: [],
    subscriptionIds: [],
    ...overrides,
  });

  const createContext = (session: ServerSession): HandlerContext => ({
    session,
    requestId: "req-1",
    signal: new AbortController().signal,
  });

  it("should allow exempt methods without auth", async () => {
    const manager = new AuthManagerImpl({
      required: true,
      authenticators: [new NoAuthAuthenticator()],
    });

    const middleware = authMiddleware(manager);
    const next = vi.fn().mockResolvedValue({ result: "ok" });

    const session = createSession();
    const ctx = createContext(session);

    // map/connect is exempt by default
    const result = await middleware("map/connect", {}, ctx, next);

    expect(next).toHaveBeenCalled();
    expect(result).toEqual({ result: "ok" });
  });

  it("should allow authenticated sessions", async () => {
    const manager = new AuthManagerImpl({
      required: true,
      authenticators: [new NoAuthAuthenticator()],
    });

    const middleware = authMiddleware(manager);
    const next = vi.fn().mockResolvedValue({ result: "ok" });

    const session = createSession({
      principal: { id: "user-1" },
    });
    const ctx = createContext(session);

    const result = await middleware("map/agents/list", {}, ctx, next);

    expect(next).toHaveBeenCalled();
    expect(result).toEqual({ result: "ok" });
  });

  it("should reject unauthenticated sessions when auth required", async () => {
    const manager = new AuthManagerImpl({
      required: true,
      authenticators: [new NoAuthAuthenticator()],
    });

    const middleware = authMiddleware(manager);
    const next = vi.fn();

    const session = createSession(); // No principal
    const ctx = createContext(session);

    await expect(
      middleware("map/agents/list", {}, ctx, next)
    ).rejects.toThrow(AuthenticationError);

    expect(next).not.toHaveBeenCalled();
  });

  it("should allow unauthenticated sessions when auth not required", async () => {
    const manager = new AuthManagerImpl({
      required: false,
      authenticators: [new NoAuthAuthenticator()],
    });

    const middleware = authMiddleware(manager);
    const next = vi.fn().mockResolvedValue({ result: "ok" });

    const session = createSession(); // No principal
    const ctx = createContext(session);

    const result = await middleware("map/agents/list", {}, ctx, next);

    expect(next).toHaveBeenCalled();
    expect(result).toEqual({ result: "ok" });
  });

  it("should support custom exempt methods", async () => {
    const manager = new AuthManagerImpl({
      required: true,
      authenticators: [new NoAuthAuthenticator()],
    });

    const middleware = authMiddleware(manager, {
      exemptMethods: ["map/connect", "map/authenticate", "custom/public"],
    });

    const next = vi.fn().mockResolvedValue({ result: "ok" });
    const session = createSession(); // No principal
    const ctx = createContext(session);

    // Custom exempt method should be allowed
    const result = await middleware("custom/public", {}, ctx, next);

    expect(next).toHaveBeenCalled();
    expect(result).toEqual({ result: "ok" });
  });
});
