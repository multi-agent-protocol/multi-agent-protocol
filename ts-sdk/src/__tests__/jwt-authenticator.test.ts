/**
 * Tests for JWTAuthenticator
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JWTAuthenticator } from "../server/auth/authenticators/jwt";
import type { AuthContext } from "../server/auth/types";

// Mock jose module
vi.mock("jose", () => {
  const mockJwtVerify = vi.fn();
  const mockCreateRemoteJWKSet = vi.fn();
  const mockCreateLocalJWKSet = vi.fn();

  return {
    jwtVerify: mockJwtVerify,
    createRemoteJWKSet: mockCreateRemoteJWKSet,
    createLocalJWKSet: mockCreateLocalJWKSet,
    // Export the mocks for test access
    __mocks: {
      jwtVerify: mockJwtVerify,
      createRemoteJWKSet: mockCreateRemoteJWKSet,
      createLocalJWKSet: mockCreateLocalJWKSet,
    },
  };
});

// Get mock references
async function getJoseMocks() {
  const jose = await import("jose");
  return (jose as unknown as { __mocks: {
    jwtVerify: ReturnType<typeof vi.fn>;
    createRemoteJWKSet: ReturnType<typeof vi.fn>;
    createLocalJWKSet: ReturnType<typeof vi.fn>;
  } }).__mocks;
}

describe("JWTAuthenticator", () => {
  const defaultContext: AuthContext = {
    transportType: "websocket",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const mocks = await getJoseMocks();
    // Reset mock implementations
    mocks.jwtVerify.mockReset();
    mocks.createRemoteJWKSet.mockReset();
    mocks.createLocalJWKSet.mockReset();
  });

  describe("constructor", () => {
    it("should throw if no key source is provided", () => {
      expect(() => {
        new JWTAuthenticator({});
      }).toThrow("JWTAuthenticator requires one of: jwksUrl, jwks, or secret");
    });

    it("should accept jwksUrl option", () => {
      const authenticator = new JWTAuthenticator({
        jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      });
      expect(authenticator.methods).toEqual(["bearer"]);
    });

    it("should accept jwks option", () => {
      const authenticator = new JWTAuthenticator({
        jwks: { keys: [] },
      });
      expect(authenticator.methods).toEqual(["bearer"]);
    });

    it("should accept secret option", () => {
      const authenticator = new JWTAuthenticator({
        secret: "test-secret-key-256-bits-long!",
      });
      expect(authenticator.methods).toEqual(["bearer"]);
    });

    it("should expose bearer method", () => {
      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
      });
      expect(authenticator.methods).toContain("bearer");
    });
  });

  describe("authenticate", () => {
    it("should reject missing token", async () => {
      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
      });

      const result = await authenticator.authenticate(
        { method: "bearer" },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("invalid_credentials");
      expect(result.error?.message).toContain("Bearer token is required");
    });

    it("should reject empty token", async () => {
      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
      });

      const result = await authenticator.authenticate(
        { method: "bearer", credential: "" },
        defaultContext
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("invalid_credentials");
    });

    it("should authenticate valid token with secret", async () => {
      const mocks = await getJoseMocks();
      mocks.jwtVerify.mockResolvedValue({
        payload: {
          sub: "user-123",
          iss: "test-issuer",
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        },
      });

      const authenticator = new JWTAuthenticator({
        secret: "test-secret-key-256-bits-long!",
      });

      const result = await authenticator.authenticate(
        { method: "bearer", credential: "valid.jwt.token" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.principal?.id).toBe("user-123");
      expect(result.principal?.issuer).toBe("test-issuer");
    });

    it("should authenticate valid token with static JWKS", async () => {
      const mocks = await getJoseMocks();
      const mockKeySet = vi.fn();
      mocks.createLocalJWKSet.mockReturnValue(mockKeySet);
      mocks.jwtVerify.mockResolvedValue({
        payload: {
          sub: "user-456",
          iss: "jwks-issuer",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      const authenticator = new JWTAuthenticator({
        jwks: {
          keys: [
            {
              kty: "RSA",
              n: "test-n",
              e: "AQAB",
              kid: "key-1",
            },
          ],
        },
      });

      const result = await authenticator.authenticate(
        { method: "bearer", credential: "valid.jwt.token" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.principal?.id).toBe("user-456");
      expect(mocks.createLocalJWKSet).toHaveBeenCalled();
    });

    it("should authenticate valid token with remote JWKS", async () => {
      const mocks = await getJoseMocks();
      const mockRemoteKeySet = vi.fn();
      mocks.createRemoteJWKSet.mockReturnValue(mockRemoteKeySet);
      mocks.jwtVerify.mockResolvedValue({
        payload: {
          sub: "user-789",
          iss: "https://auth.example.com",
        },
      });

      const authenticator = new JWTAuthenticator({
        jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      });

      const result = await authenticator.authenticate(
        { method: "bearer", credential: "valid.jwt.token" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.principal?.id).toBe("user-789");
      expect(mocks.createRemoteJWKSet).toHaveBeenCalled();
    });

    it("should pass issuer and audience to jwtVerify", async () => {
      const mocks = await getJoseMocks();
      mocks.jwtVerify.mockResolvedValue({
        payload: { sub: "user-1" },
      });

      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
        issuer: "https://auth.example.com",
        audience: "my-api",
      });

      await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        defaultContext
      );

      expect(mocks.jwtVerify).toHaveBeenCalledWith(
        "token",
        expect.anything(),
        expect.objectContaining({
          issuer: "https://auth.example.com",
          audience: "my-api",
        })
      );
    });

    it("should include exp claim as expiresAt in principal", async () => {
      const mocks = await getJoseMocks();
      const expTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      mocks.jwtVerify.mockResolvedValue({
        payload: {
          sub: "user-1",
          exp: expTimestamp,
        },
      });

      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
      });

      const result = await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.principal?.expiresAt).toBe(expTimestamp * 1000); // converted to ms
    });

    it("should use 'unknown' as principal ID when sub is missing", async () => {
      const mocks = await getJoseMocks();
      mocks.jwtVerify.mockResolvedValue({
        payload: {
          iss: "test-issuer",
          // no sub claim
        },
      });

      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
      });

      const result = await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        defaultContext
      );

      expect(result.success).toBe(true);
      expect(result.principal?.id).toBe("unknown");
    });

    describe("custom claims validation", () => {
      it("should call validateClaims when provided", async () => {
        const mocks = await getJoseMocks();
        mocks.jwtVerify.mockResolvedValue({
          payload: {
            sub: "user-1",
            scope: "read write",
          },
        });

        const validateClaims = vi.fn().mockReturnValue(true);

        const authenticator = new JWTAuthenticator({
          secret: "test-secret",
          validateClaims,
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "token" },
          defaultContext
        );

        expect(result.success).toBe(true);
        expect(validateClaims).toHaveBeenCalledWith(
          expect.objectContaining({
            sub: "user-1",
            scope: "read write",
          })
        );
      });

      it("should reject when validateClaims returns false", async () => {
        const mocks = await getJoseMocks();
        mocks.jwtVerify.mockResolvedValue({
          payload: {
            sub: "user-1",
            scope: "read",
          },
        });

        const authenticator = new JWTAuthenticator({
          secret: "test-secret",
          validateClaims: (claims) => {
            // Require write scope
            const scopes = (claims.scope as string)?.split(" ") ?? [];
            return scopes.includes("write");
          },
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "token" },
          defaultContext
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("insufficient_scope");
        expect(result.error?.message).toContain("claims validation failed");
      });

      it("should support async validateClaims", async () => {
        const mocks = await getJoseMocks();
        mocks.jwtVerify.mockResolvedValue({
          payload: { sub: "user-1" },
        });

        const authenticator = new JWTAuthenticator({
          secret: "test-secret",
          validateClaims: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return true;
          },
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "token" },
          defaultContext
        );

        expect(result.success).toBe(true);
      });
    });

    describe("custom claimsToPrincipal", () => {
      it("should use custom claimsToPrincipal when provided", async () => {
        const mocks = await getJoseMocks();
        mocks.jwtVerify.mockResolvedValue({
          payload: {
            sub: "user-1",
            email: "user@example.com",
            custom_id: "custom-123",
          },
        });

        const authenticator = new JWTAuthenticator({
          secret: "test-secret",
          claimsToPrincipal: (claims) => ({
            id: claims.custom_id as string,
            issuer: "custom-issuer",
            claims: { email: claims.email },
          }),
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "token" },
          defaultContext
        );

        expect(result.success).toBe(true);
        expect(result.principal?.id).toBe("custom-123");
        expect(result.principal?.issuer).toBe("custom-issuer");
        expect(result.principal?.claims).toEqual({ email: "user@example.com" });
      });
    });

    describe("error handling", () => {
      it("should handle JWTExpired error", async () => {
        const mocks = await getJoseMocks();
        const expiredError = new Error("jwt expired");
        expiredError.name = "JWTExpired";
        mocks.jwtVerify.mockRejectedValue(expiredError);

        const authenticator = new JWTAuthenticator({
          secret: "test-secret",
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "expired.token" },
          defaultContext
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("expired");
        expect(result.error?.message).toContain("expired");
      });

      it("should handle JWTClaimValidationFailed error", async () => {
        const mocks = await getJoseMocks();
        const claimError = new Error("claim aud validation failed");
        claimError.name = "JWTClaimValidationFailed";
        mocks.jwtVerify.mockRejectedValue(claimError);

        const authenticator = new JWTAuthenticator({
          secret: "test-secret",
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "invalid.claims.token" },
          defaultContext
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("invalid_credentials");
        expect(result.error?.message).toContain("Claim validation failed");
      });

      it("should handle JWSSignatureVerificationFailed error", async () => {
        const mocks = await getJoseMocks();
        const sigError = new Error("signature verification failed");
        sigError.name = "JWSSignatureVerificationFailed";
        mocks.jwtVerify.mockRejectedValue(sigError);

        const authenticator = new JWTAuthenticator({
          secret: "test-secret",
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "bad.signature.token" },
          defaultContext
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("invalid_credentials");
        expect(result.error?.message).toContain("signature verification failed");
      });

      it("should handle JWKSNoMatchingKey error", async () => {
        const mocks = await getJoseMocks();
        const keyError = new Error("no applicable key found");
        keyError.name = "JWKSNoMatchingKey";
        mocks.createLocalJWKSet.mockReturnValue(vi.fn());
        mocks.jwtVerify.mockRejectedValue(keyError);

        const authenticator = new JWTAuthenticator({
          jwks: { keys: [] },
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "unknown.key.token" },
          defaultContext
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("invalid_credentials");
        expect(result.error?.message).toContain("No matching key");
      });

      it("should handle generic errors", async () => {
        const mocks = await getJoseMocks();
        mocks.jwtVerify.mockRejectedValue(new Error("Something went wrong"));

        const authenticator = new JWTAuthenticator({
          secret: "test-secret",
        });

        const result = await authenticator.authenticate(
          { method: "bearer", credential: "bad.token" },
          defaultContext
        );

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("invalid_credentials");
        expect(result.error?.message).toBe("Something went wrong");
      });
    });
  });

  describe("initialize", () => {
    it("should pre-fetch JWKS when jwksUrl is provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: [] }),
      });
      global.fetch = mockFetch;

      const authenticator = new JWTAuthenticator({
        jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      });

      await authenticator.initialize();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://auth.example.com/.well-known/jwks.json"
      );
    });

    it("should handle JWKS fetch failure gracefully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      global.fetch = mockFetch;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const authenticator = new JWTAuthenticator({
        jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      });

      // Should not throw
      await authenticator.initialize();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("should handle network errors during JWKS fetch", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = mockFetch;

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const authenticator = new JWTAuthenticator({
        jwksUrl: "https://auth.example.com/.well-known/jwks.json",
      });

      // Should not throw
      await authenticator.initialize();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("should not fetch when using static jwks", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const authenticator = new JWTAuthenticator({
        jwks: { keys: [] },
      });

      await authenticator.initialize();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not fetch when using secret", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
      });

      await authenticator.initialize();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("algorithms", () => {
    it("should use default asymmetric algorithms", async () => {
      const mocks = await getJoseMocks();
      mocks.jwtVerify.mockResolvedValue({ payload: { sub: "user" } });

      const authenticator = new JWTAuthenticator({
        jwks: { keys: [] },
      });

      mocks.createLocalJWKSet.mockReturnValue(vi.fn());

      await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        defaultContext
      );

      expect(mocks.jwtVerify).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
        })
      );
    });

    it("should include HS256 when secret is provided", async () => {
      const mocks = await getJoseMocks();
      mocks.jwtVerify.mockResolvedValue({ payload: { sub: "user" } });

      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
      });

      await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        defaultContext
      );

      expect(mocks.jwtVerify).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          algorithms: expect.arrayContaining(["HS256"]),
        })
      );
    });

    it("should allow custom algorithms", async () => {
      const mocks = await getJoseMocks();
      mocks.jwtVerify.mockResolvedValue({ payload: { sub: "user" } });

      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
        algorithms: ["HS512"],
      });

      await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        defaultContext
      );

      expect(mocks.jwtVerify).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          algorithms: expect.arrayContaining(["HS256", "HS512"]),
        })
      );
    });
  });

  describe("clock tolerance", () => {
    it("should use default clock tolerance", async () => {
      const mocks = await getJoseMocks();
      mocks.jwtVerify.mockResolvedValue({ payload: { sub: "user" } });

      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
      });

      await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        defaultContext
      );

      expect(mocks.jwtVerify).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          clockTolerance: 60,
        })
      );
    });

    it("should allow custom clock tolerance", async () => {
      const mocks = await getJoseMocks();
      mocks.jwtVerify.mockResolvedValue({ payload: { sub: "user" } });

      const authenticator = new JWTAuthenticator({
        secret: "test-secret",
        clockTolerance: 120,
      });

      await authenticator.authenticate(
        { method: "bearer", credential: "token" },
        defaultContext
      );

      expect(mocks.jwtVerify).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          clockTolerance: 120,
        })
      );
    });
  });
});
