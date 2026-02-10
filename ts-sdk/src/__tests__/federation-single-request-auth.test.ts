/**
 * Tests for single-request federation authentication (Proposal 6).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  FederationGatewayImpl,
  createFederationHandlers,
  FederationError,
} from "../server/federation";
import type { HandlerContext, ServerSession } from "../server/types";
import type { AuthManager, AuthConfig, AuthContext } from "../server/auth/types";
import type { AuthMethod, AuthCredentials, AuthResult, ServerAuthCapabilities } from "../types";
import { generateFederationChallenge, validateChallengeAge } from "../federation/challenge";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(role: "client" | "agent" | "gateway" = "gateway"): HandlerContext {
  return {
    session: {
      id: `session-${Date.now()}`,
      status: "connected",
      role,
      agentIds: [],
      subscriptionIds: [],
      permissions: {},
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    } as unknown as ServerSession,
    requestId: "req-1",
    signal: new AbortController().signal,
  };
}

function createMockAuthManager(overrides: {
  required?: boolean;
  methods?: AuthMethod[];
  authenticateResult?: AuthResult;
} = {}): AuthManager {
  const config: AuthConfig = {
    required: overrides.required ?? true,
    authenticators: [],
  };

  return {
    config,
    supportedMethods: overrides.methods ?? ["bearer", "api-key"],

    getCapabilities(): ServerAuthCapabilities {
      return {
        methods: this.supportedMethods,
        required: config.required,
      };
    },

    async authenticate(
      _credentials: AuthCredentials,
      _context: AuthContext
    ): Promise<AuthResult> {
      return overrides.authenticateResult ?? {
        success: true,
        principal: { id: "federated-system-a", issuer: "https://a.example.com" },
      };
    },

    shouldBypass(_context: AuthContext): boolean {
      return false;
    },

    async initialize(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

// ============================================================================
// Tests: Single-Request Federation Auth
// ============================================================================

describe("Single-request federation authentication", () => {
  let gateway: FederationGatewayImpl;

  beforeEach(() => {
    gateway = new FederationGatewayImpl({
      systemId: "system-a",
      buffer: { maxMessages: 100 },
    });
  });

  describe("auth provided in connect — single RTT", () => {
    it("should authenticate immediately when auth succeeds", async () => {
      const authManager = createMockAuthManager({
        required: true,
        authenticateResult: {
          success: true,
          principal: { id: "system-b-gateway", issuer: "https://b.example.com" },
        },
      });

      const handlers = createFederationHandlers({ gateway, authManager });
      const ctx = createMockContext("gateway");

      const result = await handlers["map/federation/connect"](
        {
          systemId: "system-b",
          endpoint: "wss://b.example.com",
          auth: { method: "bearer", credentials: "valid-token" },
        },
        ctx
      );

      expect(result.connected).toBe(true);
      expect(result.systemId).toBe("system-b");
      expect(result.principal).toEqual({
        id: "system-b-gateway",
        issuer: "https://b.example.com",
      });
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^fed_system-b_/);
    });

    it("should return authRequired when auth fails recoverably", async () => {
      const authManager = createMockAuthManager({
        required: true,
        methods: ["bearer", "api-key"],
        authenticateResult: {
          success: false,
          error: { code: "invalid_credentials", message: "bad token" },
        },
      });

      const handlers = createFederationHandlers({ gateway, authManager });
      const ctx = createMockContext("gateway");

      const result = await handlers["map/federation/connect"](
        {
          systemId: "system-b",
          endpoint: "wss://b.example.com",
          auth: { method: "bearer", credentials: "bad-token" },
        },
        ctx
      );

      expect(result.connected).toBe(false);
      expect(result.status).toBe("disconnected");
      expect(result.authRequired).toBeDefined();
      expect(result.authRequired!.methods).toEqual(["bearer", "api-key"]);
      expect(result.authRequired!.required).toBe(true);
      expect(result.authRequired!.challenge).toBeDefined();
      expect(result.authRequired!.challenge).toMatch(/^map_chal_/);
    });
  });

  describe("no auth provided — negotiation fallback", () => {
    it("should return authRequired when auth is required but not provided", async () => {
      const authManager = createMockAuthManager({
        required: true,
        methods: ["bearer", "mtls"],
      });

      const handlers = createFederationHandlers({ gateway, authManager });
      const ctx = createMockContext("gateway");

      const result = await handlers["map/federation/connect"](
        { systemId: "system-b", endpoint: "wss://b.example.com" },
        ctx
      );

      expect(result.connected).toBe(false);
      expect(result.authRequired).toBeDefined();
      expect(result.authRequired!.methods).toEqual(["bearer", "mtls"]);
      expect(result.authRequired!.required).toBe(true);
    });
  });

  describe("no auth manager — backwards compatible", () => {
    it("should connect without auth when no authManager configured", async () => {
      const handlers = createFederationHandlers({ gateway });
      const ctx = createMockContext("gateway");

      const result = await handlers["map/federation/connect"](
        { systemId: "system-b", endpoint: "wss://b.example.com" },
        ctx
      );

      expect(result.connected).toBe(true);
      expect(result.systemId).toBe("system-b");
      expect(result.principal).toBeUndefined();
      expect(result.authRequired).toBeUndefined();
    });

    it("should connect when authManager exists but auth not required", async () => {
      const authManager = createMockAuthManager({ required: false });
      const handlers = createFederationHandlers({ gateway, authManager });
      const ctx = createMockContext("gateway");

      const result = await handlers["map/federation/connect"](
        { systemId: "system-b", endpoint: "wss://b.example.com" },
        ctx
      );

      expect(result.connected).toBe(true);
      expect(result.systemId).toBe("system-b");
    });
  });

  describe("auth with extended metadata", () => {
    it("should pass through auth metadata to authenticator", async () => {
      const authenticateSpy = vi.fn().mockResolvedValue({
        success: true,
        principal: { id: "system-b" },
      });

      const authManager = createMockAuthManager({ required: true });
      authManager.authenticate = authenticateSpy;

      const handlers = createFederationHandlers({ gateway, authManager });
      const ctx = createMockContext("gateway");

      await handlers["map/federation/connect"](
        {
          systemId: "system-b",
          endpoint: "wss://b.example.com",
          auth: {
            method: "bearer",
            credentials: "token-123",
            metadata: { scope: "federation" },
          },
        },
        ctx
      );

      expect(authenticateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "bearer",
          credential: "token-123",
          metadata: { scope: "federation" },
        }),
        expect.objectContaining({
          transportType: "federation",
          metadata: expect.objectContaining({ systemId: "system-b" }),
        })
      );
    });
  });
});

// ============================================================================
// Tests: Challenge Nonce Utilities
// ============================================================================

describe("Federation challenge nonces", () => {
  describe("generateFederationChallenge", () => {
    it("should generate a challenge with map_chal_ prefix", () => {
      const challenge = generateFederationChallenge();
      expect(challenge).toMatch(/^map_chal_/);
    });

    it("should generate unique challenges", () => {
      const a = generateFederationChallenge();
      const b = generateFederationChallenge();
      expect(a).not.toBe(b);
    });
  });

  describe("validateChallengeAge", () => {
    it("should validate a fresh challenge", () => {
      const challenge = generateFederationChallenge();
      expect(validateChallengeAge(challenge)).toBe(true);
    });

    it("should reject invalid prefix", () => {
      expect(validateChallengeAge("not_a_challenge")).toBe(false);
    });

    it("should reject empty string", () => {
      expect(validateChallengeAge("")).toBe(false);
    });

    it("should reject challenge with wrong ULID length", () => {
      expect(validateChallengeAge("map_chal_tooshort")).toBe(false);
    });

    it("should validate with custom maxAge", () => {
      const challenge = generateFederationChallenge();
      // A just-generated challenge should be valid within 1 second
      expect(validateChallengeAge(challenge, 1000)).toBe(true);
    });
  });
});
