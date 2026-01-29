/**
 * Tests for server PermissionChecker and middleware
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PermissionCheckerImpl,
  createDefaultPermissionChecker,
  permissionMiddleware,
  permissionLoggingMiddleware,
  selectivePermissionMiddleware,
  PermissionDeniedError,
} from "../server/permissions";
import type { ServerSession, PermissionRule, HandlerContext } from "../server/types";

describe("PermissionCheckerImpl", () => {
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

  describe("canCallMethod", () => {
    it("should allow method with matching role", () => {
      const checker = new PermissionCheckerImpl({
        rules: [{ method: "test/method", roles: ["client"] }],
      });

      const session = createSession({ role: "client" });
      const result = checker.canCallMethod(session, "test/method");

      expect(result.allowed).toBe(true);
    });

    it("should deny method with non-matching role", () => {
      const checker = new PermissionCheckerImpl({
        rules: [{ method: "test/method", roles: ["agent"] }],
      });

      const session = createSession({ role: "client" });
      const result = checker.canCallMethod(session, "test/method");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("client");
    });

    it("should support glob patterns with *", () => {
      const checker = new PermissionCheckerImpl({
        rules: [{ method: "map/agents/*", roles: ["client"] }],
      });

      const session = createSession({ role: "client" });

      expect(checker.canCallMethod(session, "map/agents/list").allowed).toBe(true);
      expect(checker.canCallMethod(session, "map/agents/get").allowed).toBe(true);
      expect(checker.canCallMethod(session, "map/agents/nested/path").allowed).toBe(
        false
      );
    });

    it("should support glob patterns with **", () => {
      const checker = new PermissionCheckerImpl({
        rules: [{ method: "map/**", roles: ["client"] }],
      });

      const session = createSession({ role: "client" });

      expect(checker.canCallMethod(session, "map/agents/list").allowed).toBe(true);
      expect(checker.canCallMethod(session, "map/agents/nested/path").allowed).toBe(
        true
      );
      expect(checker.canCallMethod(session, "other/method").allowed).toBe(false);
    });

    it("should use custom check function", () => {
      const checker = new PermissionCheckerImpl({
        rules: [
          {
            method: "test/method",
            check: (session) => ({
              allowed: session.metadata.isAdmin === true,
              reason: "Admin required",
            }),
          },
        ],
      });

      const adminSession = createSession({ metadata: { isAdmin: true } });
      const normalSession = createSession({ metadata: { isAdmin: false } });

      expect(checker.canCallMethod(adminSession, "test/method").allowed).toBe(true);
      expect(checker.canCallMethod(normalSession, "test/method").allowed).toBe(
        false
      );
    });

    it("should use defaultAllow when no rule matches", () => {
      const allowChecker = new PermissionCheckerImpl({
        rules: [],
        defaultAllow: true,
      });
      const denyChecker = new PermissionCheckerImpl({
        rules: [],
        defaultAllow: false,
      });

      const session = createSession();

      expect(allowChecker.canCallMethod(session, "unknown/method").allowed).toBe(
        true
      );
      expect(denyChecker.canCallMethod(session, "unknown/method").allowed).toBe(
        false
      );
    });

    it("should try multiple rules until one allows", () => {
      const checker = new PermissionCheckerImpl({
        rules: [
          { method: "test/method", roles: ["admin"] },
          { method: "test/method", roles: ["client"] },
        ],
      });

      const session = createSession({ role: "client" });
      const result = checker.canCallMethod(session, "test/method");

      expect(result.allowed).toBe(true);
    });

    it("should combine role and custom check", () => {
      const checker = new PermissionCheckerImpl({
        rules: [
          {
            method: "test/method",
            roles: ["client"],
            check: (session) => ({
              allowed: session.metadata.verified === true,
            }),
          },
        ],
      });

      const verifiedClient = createSession({
        role: "client",
        metadata: { verified: true },
      });
      const unverifiedClient = createSession({
        role: "client",
        metadata: { verified: false },
      });
      const verifiedAgent = createSession({
        role: "agent",
        metadata: { verified: true },
      });

      expect(checker.canCallMethod(verifiedClient, "test/method").allowed).toBe(
        true
      );
      expect(checker.canCallMethod(unverifiedClient, "test/method").allowed).toBe(
        false
      );
      expect(checker.canCallMethod(verifiedAgent, "test/method").allowed).toBe(
        false
      ); // Wrong role
    });
  });

  describe("canAccessScope", () => {
    it("should check scope access with pattern", () => {
      const checker = new PermissionCheckerImpl({
        rules: [{ method: "scope/*/read", roles: ["client"] }],
      });

      const session = createSession({ role: "client" });

      expect(
        checker.canAccessScope(session, "scope-123", "read").allowed
      ).toBe(true);
      expect(
        checker.canAccessScope(session, "scope-123", "write").allowed
      ).toBe(false);
    });

    it("should support custom check for scope access", () => {
      const checker = new PermissionCheckerImpl({
        rules: [
          {
            method: "scope/**",
            check: (session, params: any) => ({
              allowed: params?.action !== "delete",
              reason: "Cannot delete scopes",
            }),
          },
        ],
      });

      const session = createSession();

      expect(checker.canAccessScope(session, "scope-1", "read").allowed).toBe(
        true
      );
      expect(checker.canAccessScope(session, "scope-1", "delete").allowed).toBe(
        false
      );
    });
  });

  describe("canAgentPerform", () => {
    it("should check agent-to-agent permissions", () => {
      const checker = new PermissionCheckerImpl({
        rules: [{ method: "agent/message" }],
      });

      expect(
        checker.canAgentPerform("agent-1", "message", "agent-2").allowed
      ).toBe(true);
      expect(
        checker.canAgentPerform("agent-1", "control", "agent-2").allowed
      ).toBe(false);
    });

    it("should support custom check for agent permissions", () => {
      const checker = new PermissionCheckerImpl({
        rules: [
          {
            method: "agent/*",
            check: (session, params: any) => ({
              allowed: params?.agentId !== params?.targetId,
              reason: "Cannot perform action on self",
            }),
          },
        ],
      });

      expect(
        checker.canAgentPerform("agent-1", "message", "agent-2").allowed
      ).toBe(true);
      expect(
        checker.canAgentPerform("agent-1", "message", "agent-1").allowed
      ).toBe(false);
    });
  });
});

describe("createDefaultPermissionChecker", () => {
  const createSession = (role: string): ServerSession => ({
    id: "session-1",
    role: role as any,
    status: "connected",
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    metadata: {},
    agentIds: [],
    subscriptionIds: [],
  });

  it("should allow connection methods for all roles", () => {
    const checker = createDefaultPermissionChecker();

    expect(
      checker.canCallMethod(createSession("client"), "map/connect").allowed
    ).toBe(true);
    expect(
      checker.canCallMethod(createSession("agent"), "map/connect").allowed
    ).toBe(true);
    expect(
      checker.canCallMethod(createSession("gateway"), "map/connect").allowed
    ).toBe(true);
  });

  it("should only allow agents to register", () => {
    const checker = createDefaultPermissionChecker();

    expect(
      checker.canCallMethod(createSession("agent"), "map/agents/register")
        .allowed
    ).toBe(true);
    expect(
      checker.canCallMethod(createSession("client"), "map/agents/register")
        .allowed
    ).toBe(false);
  });

  it("should allow clients to observe agents", () => {
    const checker = createDefaultPermissionChecker();

    expect(
      checker.canCallMethod(createSession("client"), "map/agents/list").allowed
    ).toBe(true);
    expect(
      checker.canCallMethod(createSession("client"), "map/agents/get").allowed
    ).toBe(true);
  });

  it("should allow override rules", () => {
    const checker = createDefaultPermissionChecker({
      rules: [
        {
          method: "map/agents/register",
          roles: ["client"], // Override to allow clients
        },
      ],
    });

    expect(
      checker.canCallMethod(createSession("client"), "map/agents/register")
        .allowed
    ).toBe(true);
  });
});

describe("permissionMiddleware", () => {
  const createContext = (role: string): HandlerContext => ({
    session: {
      id: "session-1",
      role: role as any,
      status: "connected",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      metadata: {},
      agentIds: [],
      subscriptionIds: [],
    },
    requestId: "req-1",
    signal: new AbortController().signal,
  });

  it("should allow authorized calls", async () => {
    const checker = new PermissionCheckerImpl({
      rules: [{ method: "test/method", roles: ["client"] }],
    });
    const middleware = permissionMiddleware(checker);

    const next = vi.fn().mockResolvedValue({ success: true });
    const result = await middleware(
      "test/method",
      {},
      createContext("client"),
      next
    );

    expect(next).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("should throw PermissionDeniedError for unauthorized calls", async () => {
    const checker = new PermissionCheckerImpl({
      rules: [{ method: "test/method", roles: ["admin"] }],
    });
    const middleware = permissionMiddleware(checker);

    const next = vi.fn();

    await expect(
      middleware("test/method", {}, createContext("client"), next)
    ).rejects.toThrow(PermissionDeniedError);

    expect(next).not.toHaveBeenCalled();
  });

  it("should include reason in error", async () => {
    const checker = new PermissionCheckerImpl({
      rules: [{ method: "test/method", roles: ["admin"] }],
    });
    const middleware = permissionMiddleware(checker);

    await expect(
      middleware("test/method", {}, createContext("client"), vi.fn())
    ).rejects.toThrow(/Access denied|Permission denied/);
  });
});

describe("permissionLoggingMiddleware", () => {
  const createContext = (role: string): HandlerContext => ({
    session: {
      id: "session-1",
      role: role as any,
      status: "connected",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      metadata: {},
      agentIds: [],
      subscriptionIds: [],
    },
    requestId: "req-1",
    signal: new AbortController().signal,
  });

  it("should log allowed calls", async () => {
    const checker = new PermissionCheckerImpl({
      rules: [{ method: "test/method", roles: ["client"] }],
    });
    const logger = { log: vi.fn(), warn: vi.fn() };
    const middleware = permissionLoggingMiddleware(checker, logger);

    await middleware("test/method", {}, createContext("client"), vi.fn());

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Allowed")
    );
  });

  it("should log denied calls", async () => {
    const checker = new PermissionCheckerImpl({
      rules: [{ method: "test/method", roles: ["admin"] }],
    });
    const logger = { log: vi.fn(), warn: vi.fn() };
    const middleware = permissionLoggingMiddleware(checker, logger);

    await expect(
      middleware("test/method", {}, createContext("client"), vi.fn())
    ).rejects.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Denied")
    );
  });
});

describe("selectivePermissionMiddleware", () => {
  const createContext = (role: string): HandlerContext => ({
    session: {
      id: "session-1",
      role: role as any,
      status: "connected",
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      metadata: {},
      agentIds: [],
      subscriptionIds: [],
    },
    requestId: "req-1",
    signal: new AbortController().signal,
  });

  it("should only check matching methods", async () => {
    const checker = new PermissionCheckerImpl({
      rules: [{ method: "protected/*", roles: ["admin"] }],
    });
    const middleware = selectivePermissionMiddleware(checker, ["protected/*"]);

    const next = vi.fn().mockResolvedValue({});

    // Non-protected method should pass without check
    await middleware("public/method", {}, createContext("client"), next);
    expect(next).toHaveBeenCalled();

    // Protected method should be checked
    next.mockClear();
    await expect(
      middleware("protected/resource", {}, createContext("client"), next)
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe("PermissionDeniedError", () => {
  it("should have correct properties", () => {
    const error = new PermissionDeniedError("Test message");

    expect(error.name).toBe("PermissionDeniedError");
    expect(error.message).toBe("Test message");
    expect(error.code).toBe(-32000);
  });
});
