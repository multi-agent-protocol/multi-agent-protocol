/**
 * Tests for credential brokering handlers (cred/get, cred/list, cred/status)
 * and credential capability advertising in connect response.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBusImpl } from "../server/events";
import { SessionManagerImpl } from "../server/sessions";
import { createCredentialHandlers } from "../server/credentials";
import { createConnectionHandlers } from "../server/router";
import type { BrokerLike, CredentialResult } from "../server/credentials";
import type { AgentIAMToken } from "../server/auth/providers/agent-iam";
// AgentIAMToken is used only for test helpers — the handlers themselves
// use the `unknown`-typed BrokerLike interface.
import type { HandlerContext, ServerSession } from "../server/types";

// =============================================================================
// Test helpers
// =============================================================================

function createMockToken(overrides?: Partial<AgentIAMToken>): AgentIAMToken {
  return {
    agentId: "agent-001",
    scopes: ["github:repo:read", "aws:s3:write"],
    constraints: {
      "github:repo:read": { resources: ["acme-corp/*"] },
    },
    delegatable: true,
    maxDelegationDepth: 3,
    currentDepth: 0,
    signature: "valid-sig",
    expiresAt: "2026-12-31T23:59:59Z",
    ...overrides,
  };
}

function createMockBroker(overrides?: Partial<BrokerLike>): BrokerLike {
  const defaultCredential: CredentialResult = {
    credentialType: "bearer_token",
    credential: { token: "ghs_mock_token_123" },
    expiresAt: "2026-02-06T01:00:00Z",
  };

  return {
    checkPermission: vi.fn().mockReturnValue({ valid: true }),
    getCredential: vi.fn().mockResolvedValue(defaultCredential),
    getStatus: vi.fn().mockReturnValue({
      providers: ["github", "aws", "apikey"],
      mode: "standalone",
    }),
    ...overrides,
  };
}

function createSessionWithToken(
  sessions: SessionManagerImpl,
  token?: AgentIAMToken,
): { session: ServerSession; ctx: HandlerContext } {
  const session = sessions.create({ role: "agent", name: "Test" });
  if (token !== undefined) {
    session.providers = {
      "agent-iam": {
        principal: { id: token.agentId },
        providerData: token,
      },
    };
  }
  const ctx: HandlerContext = {
    session,
    requestId: "req-1",
    signal: new AbortController().signal,
  };
  return { session, ctx };
}

// =============================================================================
// cred/get tests
// =============================================================================

describe("cred/get handler", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;
  let broker: BrokerLike;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });
    broker = createMockBroker();
  });

  it("should return credential for valid token and scope", async () => {
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker, eventBus });

    const result = await handlers["cred/get"](
      { scope: "github:repo:read", resource: "acme-corp/frontend" },
      ctx,
    );

    expect(result).toBeDefined();
    expect((result as CredentialResult).credentialType).toBe("bearer_token");
    expect((result as CredentialResult).credential.token).toBe("ghs_mock_token_123");
    expect(broker.checkPermission).toHaveBeenCalledWith(
      token,
      "github:repo:read",
      "acme-corp/frontend",
    );
    expect(broker.getCredential).toHaveBeenCalledWith(
      token,
      "github:repo:read",
      "acme-corp/frontend",
    );
  });

  it("should throw when permission is denied", async () => {
    const deniedBroker = createMockBroker({
      checkPermission: vi.fn().mockReturnValue({
        valid: false,
        error: "Scope 'github:repo:write' not in token scopes",
      }),
    });
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker: deniedBroker, eventBus });

    await expect(
      handlers["cred/get"](
        { scope: "github:repo:write", resource: "acme-corp/frontend" },
        ctx,
      ),
    ).rejects.toThrow("Scope 'github:repo:write' not in token scopes");

    expect(deniedBroker.getCredential).not.toHaveBeenCalled();
  });

  it("should throw with default message when permission denied without error string", async () => {
    const deniedBroker = createMockBroker({
      checkPermission: vi.fn().mockReturnValue({ valid: false }),
    });
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker: deniedBroker, eventBus });

    await expect(
      handlers["cred/get"](
        { scope: "github:repo:write", resource: "acme-corp/frontend" },
        ctx,
      ),
    ).rejects.toThrow("Permission denied");
  });

  it("should throw when no agent-iam token on session", async () => {
    const { ctx } = createSessionWithToken(sessions);
    const handlers = createCredentialHandlers({ broker, eventBus });

    await expect(
      handlers["cred/get"](
        { scope: "github:repo:read", resource: "acme-corp/frontend" },
        ctx,
      ),
    ).rejects.toThrow("No agent-iam token on session");
  });

  it("should emit credential.issued event on success", async () => {
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker, eventBus });

    const events: unknown[] = [];
    eventBus.on("credential.issued", (event) => events.push(event));

    await handlers["cred/get"](
      { scope: "github:repo:read", resource: "acme-corp/frontend" },
      ctx,
    );

    expect(events).toHaveLength(1);
    const event = events[0] as { data: Record<string, unknown> };
    expect(event.data.agentId).toBe("agent-001");
    expect(event.data.scope).toBe("github:repo:read");
    expect(event.data.resource).toBe("acme-corp/frontend");
    expect(event.data.credentialType).toBe("bearer_token");
  });

  it("should never include credential data in audit events", async () => {
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker, eventBus });

    const events: unknown[] = [];
    eventBus.on("credential.issued", (event) => events.push(event));

    await handlers["cred/get"](
      { scope: "github:repo:read", resource: "acme-corp/frontend" },
      ctx,
    );

    const event = events[0] as { data: Record<string, unknown> };
    expect(event.data.credential).toBeUndefined();
    expect(event.data.token).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("ghs_mock_token_123");
  });

  it("should emit credential.denied event on denial", async () => {
    const deniedBroker = createMockBroker({
      checkPermission: vi.fn().mockReturnValue({
        valid: false,
        error: "Scope not allowed",
      }),
    });
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker: deniedBroker, eventBus });

    const events: unknown[] = [];
    eventBus.on("credential.denied", (event) => events.push(event));

    await handlers["cred/get"](
      { scope: "github:repo:write", resource: "acme-corp/frontend" },
      ctx,
    ).catch(() => {});

    expect(events).toHaveLength(1);
    const event = events[0] as { data: Record<string, unknown> };
    expect(event.data.agentId).toBe("agent-001");
    expect(event.data.scope).toBe("github:repo:write");
    expect(event.data.reason).toBe("Scope not allowed");
  });

  it("should not emit events when no eventBus provided", async () => {
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    // No eventBus passed
    const handlers = createCredentialHandlers({ broker });

    // Should not throw
    const result = await handlers["cred/get"](
      { scope: "github:repo:read", resource: "acme-corp/frontend" },
      ctx,
    );

    expect(result).toBeDefined();
  });

  it("should throw when scope is missing", async () => {
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker, eventBus });

    await expect(
      handlers["cred/get"]({ resource: "acme-corp/frontend" }, ctx),
    ).rejects.toThrow("Missing required parameter: scope");
  });

  it("should throw when resource is missing", async () => {
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker, eventBus });

    await expect(
      handlers["cred/get"]({ scope: "github:repo:read" }, ctx),
    ).rejects.toThrow("Missing required parameter: resource");
  });

  it("should return aws_credentials type", async () => {
    const awsBroker = createMockBroker({
      getCredential: vi.fn().mockResolvedValue({
        credentialType: "aws_credentials",
        credential: {
          accessKeyId: "AKIA...",
          secretAccessKey: "secret",
          sessionToken: "token",
        },
        expiresAt: "2026-02-06T02:00:00Z",
      }),
    });
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker: awsBroker, eventBus });

    const result = (await handlers["cred/get"](
      { scope: "aws:s3:write", resource: "my-bucket" },
      ctx,
    )) as CredentialResult;

    expect(result.credentialType).toBe("aws_credentials");
    expect(result.credential.accessKeyId).toBe("AKIA...");
  });
});

// =============================================================================
// cred/list tests
// =============================================================================

describe("cred/list handler", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;
  let broker: BrokerLike;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });
    broker = createMockBroker();
  });

  it("should return token scopes and constraints", async () => {
    const token = createMockToken();
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker });

    const result = (await handlers["cred/list"]({}, ctx)) as {
      agentId: string;
      scopes: string[];
      constraints: Record<string, unknown>;
      expiresAt?: string;
    };

    expect(result.agentId).toBe("agent-001");
    expect(result.scopes).toEqual(["github:repo:read", "aws:s3:write"]);
    expect(result.constraints).toEqual({
      "github:repo:read": { resources: ["acme-corp/*"] },
    });
    expect(result.expiresAt).toBe("2026-12-31T23:59:59Z");
  });

  it("should throw when no agent-iam token on session", async () => {
    const { ctx } = createSessionWithToken(sessions);
    const handlers = createCredentialHandlers({ broker });

    await expect(handlers["cred/list"]({}, ctx)).rejects.toThrow(
      "No agent-iam token on session",
    );
  });

  it("should handle token with no expiresAt", async () => {
    const token = createMockToken({ expiresAt: undefined });
    const { ctx } = createSessionWithToken(sessions, token);
    const handlers = createCredentialHandlers({ broker });

    const result = (await handlers["cred/list"]({}, ctx)) as {
      expiresAt?: string;
    };

    expect(result.expiresAt).toBeUndefined();
  });
});

// =============================================================================
// cred/status tests
// =============================================================================

describe("cred/status handler", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;
  let broker: BrokerLike;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });
    broker = createMockBroker();
  });

  it("should return broker providers", async () => {
    const { ctx } = createSessionWithToken(sessions, createMockToken());
    const handlers = createCredentialHandlers({ broker });

    const result = (await handlers["cred/status"]({}, ctx)) as {
      providers: string[];
    };

    expect(result.providers).toEqual(["github", "aws", "apikey"]);
  });

  it("should filter providers by allowedProviders", async () => {
    const { ctx } = createSessionWithToken(sessions, createMockToken());
    const handlers = createCredentialHandlers({
      broker,
      allowedProviders: ["github"],
    });

    const result = (await handlers["cred/status"]({}, ctx)) as {
      providers: string[];
    };

    expect(result.providers).toEqual(["github"]);
  });

  it("should return empty list when no providers match filter", async () => {
    const { ctx } = createSessionWithToken(sessions, createMockToken());
    const handlers = createCredentialHandlers({
      broker,
      allowedProviders: ["nonexistent"],
    });

    const result = (await handlers["cred/status"]({}, ctx)) as {
      providers: string[];
    };

    expect(result.providers).toEqual([]);
  });

  it("should not require a token on session", async () => {
    // cred/status doesn't need authentication
    const { ctx } = createSessionWithToken(sessions);
    const handlers = createCredentialHandlers({ broker });

    const result = (await handlers["cred/status"]({}, ctx)) as {
      providers: string[];
    };

    expect(result.providers).toEqual(["github", "aws", "apikey"]);
  });
});

// =============================================================================
// Connect response credential capability tests
// =============================================================================

describe("map/connect credential capabilities", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });
  });

  it("should include credential capabilities when enabled", async () => {
    const session = sessions.create({ role: "client", name: "Test" });
    const ctx: HandlerContext = {
      session,
      requestId: "req-1",
      signal: new AbortController().signal,
    };

    const handlers = createConnectionHandlers({
      sessions,
      credentialCapabilities: { enabled: true },
    });

    const result = (await handlers["map/connect"]({}, ctx)) as {
      capabilities: Record<string, unknown>;
    };

    expect(result.capabilities.credentials).toBeDefined();
    const creds = result.capabilities.credentials as Record<string, unknown>;
    expect(creds.enabled).toBe(true);
    expect(creds.canGet).toBe(true);
    expect(creds.canList).toBe(true);
    expect(creds.canStatus).toBe(true);
  });

  it("should not include credential capabilities when disabled", async () => {
    const session = sessions.create({ role: "client", name: "Test" });
    const ctx: HandlerContext = {
      session,
      requestId: "req-1",
      signal: new AbortController().signal,
    };

    const handlers = createConnectionHandlers({ sessions });

    const result = (await handlers["map/connect"]({}, ctx)) as {
      capabilities: Record<string, unknown>;
    };

    expect(result.capabilities.credentials).toBeUndefined();
  });

  it("should respect custom capability flags", async () => {
    const session = sessions.create({ role: "client", name: "Test" });
    const ctx: HandlerContext = {
      session,
      requestId: "req-1",
      signal: new AbortController().signal,
    };

    const handlers = createConnectionHandlers({
      sessions,
      credentialCapabilities: {
        enabled: true,
        canGet: true,
        canList: false,
        canStatus: false,
      },
    });

    const result = (await handlers["map/connect"]({}, ctx)) as {
      capabilities: Record<string, unknown>;
    };

    const creds = result.capabilities.credentials as Record<string, unknown>;
    expect(creds.canGet).toBe(true);
    expect(creds.canList).toBe(false);
    expect(creds.canStatus).toBe(false);
  });
});
