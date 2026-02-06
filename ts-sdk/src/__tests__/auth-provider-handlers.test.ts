/**
 * Tests for auth provider integration with handlers
 *
 * Tests the spawn handler (agents/handlers.ts) and connection handler
 * provider data storage (router/handlers.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBusImpl } from "../server/events";
import { AgentRegistryImpl, createAgentHandlers } from "../server/agents";
import { SessionManagerImpl } from "../server/sessions";
import { createConnectionHandlers } from "../server/router";
import { AuthManagerImpl } from "../server/auth/manager";
import { AgentIAMProvider } from "../server/auth/providers";
import type { TokenServiceLike, AgentIAMToken } from "../server/auth/providers";
import type { HandlerContext, ServerSession } from "../server/types";

// =============================================================================
// Test helpers
// =============================================================================

function createMockToken(overrides?: Partial<AgentIAMToken>): AgentIAMToken {
  return {
    agentId: "agent-001",
    scopes: ["map:*"],
    constraints: {},
    delegatable: true,
    maxDelegationDepth: 3,
    currentDepth: 0,
    signature: "valid-sig",
    ...overrides,
  };
}

function createMockTokenService(
  overrides?: Partial<TokenServiceLike>
): TokenServiceLike {
  const defaultToken = createMockToken();
  return {
    verify: vi.fn().mockReturnValue({ valid: true }),
    serialize: vi.fn().mockReturnValue("child-serialized-token"),
    deserialize: vi.fn().mockReturnValue(defaultToken),
    delegate: vi.fn().mockReturnValue({
      ...defaultToken,
      agentId: "child-001",
      parentId: "agent-001",
      currentDepth: 1,
    }),
    ...overrides,
  };
}

// =============================================================================
// Spawn Handler Tests
// =============================================================================

describe("map/agents/spawn handler", () => {
  let eventBus: EventBusImpl;
  let agents: AgentRegistryImpl;
  let sessions: SessionManagerImpl;
  let tokenService: TokenServiceLike;
  let provider: AgentIAMProvider;
  let authManager: AuthManagerImpl;
  let session: ServerSession;
  let ctx: HandlerContext;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    agents = new AgentRegistryImpl({ eventBus });
    sessions = new SessionManagerImpl({ eventBus });

    tokenService = createMockTokenService();
    provider = new AgentIAMProvider({ tokenService });
    authManager = new AuthManagerImpl({ providers: [provider] });

    session = sessions.create({ role: "agent", name: "Test" });
    ctx = {
      session,
      requestId: "req-1",
      signal: new AbortController().signal,
    };
  });

  it("should spawn child agent with parent metadata", async () => {
    // Register a parent agent first
    const parentAgent = agents.register({
      name: "Parent Agent",
      role: "orchestrator",
      sessionId: session.id,
    });
    sessions.addAgent(session.id, parentAgent.id);

    const handlers = createAgentHandlers({ agents, sessions, authManager });

    const result = await handlers["map/agents/spawn"](
      { parent: parentAgent.id, name: "Child Agent", role: "worker" },
      ctx
    );

    expect(result.agent).toBeDefined();
    expect(result.agent.name).toBe("Child Agent");
    expect(result.agent.role).toBe("worker");
    expect(result.agent.metadata?.parentId).toBe(parentAgent.id);
  });

  it("should use default name when none provided", async () => {
    const parentAgent = agents.register({
      name: "MyParent",
      sessionId: session.id,
    });
    sessions.addAgent(session.id, parentAgent.id);

    const handlers = createAgentHandlers({ agents, sessions, authManager });

    const result = await handlers["map/agents/spawn"](
      { parent: parentAgent.id },
      ctx
    );

    expect(result.agent.name).toBe("MyParent-child");
  });

  it("should track child in session via SessionManager", async () => {
    const parentAgent = agents.register({
      name: "Parent",
      sessionId: session.id,
    });
    sessions.addAgent(session.id, parentAgent.id);

    const handlers = createAgentHandlers({ agents, sessions, authManager });

    const result = await handlers["map/agents/spawn"](
      { parent: parentAgent.id },
      ctx
    );

    // Refresh session
    const refreshed = sessions.get(session.id)!;
    expect(refreshed.agentIds).toContain(result.agent.id);
  });

  it("should return delegated credentials when session has providers", async () => {
    const parentToken = createMockToken();
    const parentAgent = agents.register({
      name: "Parent",
      sessionId: session.id,
    });
    sessions.addAgent(session.id, parentAgent.id);

    // Simulate provider data on session (as would happen after connect)
    session.providers = {
      "agent-iam": {
        principal: { id: parentAgent.id },
        providerData: parentToken,
      },
    };

    const handlers = createAgentHandlers({ agents, sessions, authManager });

    const result = await handlers["map/agents/spawn"](
      {
        parent: parentAgent.id,
        name: "Child",
        requestedScopes: ["map:observe"],
        ttlMinutes: 30,
      },
      ctx
    );

    expect(result.delegatedCredentials).toBeDefined();
    expect(result.delegatedCredentials.method).toBe("x-agent-iam");
    expect(result.delegatedCredentials.credentials.token).toBe("child-serialized-token");
    expect(result.delegatedCredentials.env.AGENT_TOKEN).toBe("child-serialized-token");
  });

  it("should not include delegatedCredentials when no providers on session", async () => {
    const parentAgent = agents.register({
      name: "Parent",
      sessionId: session.id,
    });
    sessions.addAgent(session.id, parentAgent.id);

    // No session.providers
    const handlers = createAgentHandlers({ agents, sessions, authManager });

    const result = await handlers["map/agents/spawn"](
      { parent: parentAgent.id },
      ctx
    );

    expect(result.delegatedCredentials).toBeUndefined();
  });

  it("should not include delegatedCredentials when no authManager", async () => {
    const parentAgent = agents.register({
      name: "Parent",
      sessionId: session.id,
    });
    sessions.addAgent(session.id, parentAgent.id);
    session.providers = {
      "agent-iam": {
        principal: { id: parentAgent.id },
        providerData: createMockToken(),
      },
    };

    // Create handlers WITHOUT authManager
    const handlers = createAgentHandlers({ agents, sessions });

    const result = await handlers["map/agents/spawn"](
      { parent: parentAgent.id },
      ctx
    );

    expect(result.delegatedCredentials).toBeUndefined();
  });

  it("should throw when parent agent not found", async () => {
    const handlers = createAgentHandlers({ agents, sessions, authManager });

    await expect(
      handlers["map/agents/spawn"](
        { parent: "nonexistent" },
        ctx
      )
    ).rejects.toThrow("Parent agent not found");
  });

  it("should throw when parent agent belongs to different session", async () => {
    const otherSession = sessions.create({ role: "agent", name: "Other" });
    const parentAgent = agents.register({
      name: "Parent",
      sessionId: otherSession.id,
    });

    const handlers = createAgentHandlers({ agents, sessions, authManager });

    await expect(
      handlers["map/agents/spawn"](
        { parent: parentAgent.id },
        ctx
      )
    ).rejects.toThrow("does not belong to this session");
  });

  it("should track child in session via direct mutation when no SessionManager", async () => {
    const parentAgent = agents.register({
      name: "Parent",
      sessionId: session.id,
    });
    session.agentIds.push(parentAgent.id);

    // Create handlers without sessions
    const handlers = createAgentHandlers({ agents, authManager });

    const result = await handlers["map/agents/spawn"](
      { parent: parentAgent.id },
      ctx
    );

    expect(session.agentIds).toContain(result.agent.id);
  });
});

// =============================================================================
// Connect Handler Provider Data Storage Tests
// =============================================================================

describe("map/connect handler with auth provider", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;
  let tokenService: TokenServiceLike;
  let provider: AgentIAMProvider;
  let authManager: AuthManagerImpl;
  let session: ServerSession;
  let ctx: HandlerContext;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });

    tokenService = createMockTokenService();
    provider = new AgentIAMProvider({ tokenService });
    authManager = new AuthManagerImpl({
      required: true,
      providers: [provider],
    });

    session = sessions.create({ role: "client", name: "Test" });
    ctx = {
      session,
      requestId: "req-1",
      signal: new AbortController().signal,
    };
  });

  it("should store provider data on session after successful auth", async () => {
    const handlers = createConnectionHandlers({ sessions, authManager });

    await handlers["map/connect"](
      { auth: { method: "x-agent-iam", credential: "valid-token" } },
      ctx
    );

    expect(session.providers).toBeDefined();
    expect(session.providers?.["agent-iam"]).toBeDefined();
    expect(session.providers?.["agent-iam"]?.principal.id).toBe("agent-001");
    expect(session.providers?.["agent-iam"]?.providerData).toBeDefined();
  });

  it("should store principal on session after successful auth", async () => {
    const handlers = createConnectionHandlers({ sessions, authManager });

    await handlers["map/connect"](
      { auth: { method: "x-agent-iam", credential: "valid-token" } },
      ctx
    );

    expect(session.principal).toBeDefined();
    expect(session.principal?.id).toBe("agent-001");
  });

  it("should include providerCapabilities in connect response", async () => {
    const token = createMockToken({
      agentCapabilities: {
        canSpawn: true,
        canMessage: true,
        canObserve: true,
      },
    });
    (tokenService.deserialize as any).mockReturnValue(token);

    const handlers = createConnectionHandlers({ sessions, authManager });

    const result = await handlers["map/connect"](
      { auth: { method: "x-agent-iam", credential: "valid-token" } },
      ctx
    ) as any;

    expect(result.capabilities.providerCapabilities).toBeDefined();
    expect(result.capabilities.providerCapabilities.lifecycle?.canSpawn).toBe(true);
  });

  it("should return auth required when no credentials provided", async () => {
    const handlers = createConnectionHandlers({ sessions, authManager });

    const result = await handlers["map/connect"]({}, ctx) as any;

    expect(result.authRequired).toBeDefined();
    expect(result.authRequired.methods).toContain("x-agent-iam");
  });

  it("should return auth error when authentication fails", async () => {
    (tokenService.verify as any).mockReturnValue({
      valid: false,
      error: "Invalid signature",
    });

    const handlers = createConnectionHandlers({ sessions, authManager });

    const result = await handlers["map/connect"](
      { auth: { method: "x-agent-iam", credential: "bad-token" } },
      ctx
    ) as any;

    expect(result.authRequired).toBeDefined();
    expect(result.error).toBeDefined();
  });

  it("should not store provider data when auth is not required and no creds given", async () => {
    const optionalAuthManager = new AuthManagerImpl({
      required: false,
      providers: [provider],
    });

    const handlers = createConnectionHandlers({
      sessions,
      authManager: optionalAuthManager,
    });

    const result = await handlers["map/connect"]({}, ctx) as any;

    // Should succeed without auth
    expect(result.sessionId).toBe(session.id);
    expect(session.providers).toBeUndefined();
  });
});

// =============================================================================
// map/authenticate handler with providers
// =============================================================================

describe("map/authenticate handler with auth provider", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;
  let tokenService: TokenServiceLike;
  let provider: AgentIAMProvider;
  let authManager: AuthManagerImpl;
  let session: ServerSession;
  let ctx: HandlerContext;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });
    tokenService = createMockTokenService();
    provider = new AgentIAMProvider({ tokenService });
    authManager = new AuthManagerImpl({ providers: [provider] });

    session = sessions.create({ role: "client" });
    ctx = {
      session,
      requestId: "req-2",
      signal: new AbortController().signal,
    };
  });

  it("should store provider data on session", async () => {
    const handlers = createConnectionHandlers({ sessions, authManager });

    await handlers["map/authenticate"](
      { method: "x-agent-iam", credential: "valid-token" },
      ctx
    );

    expect(session.providers?.["agent-iam"]).toBeDefined();
    expect(session.providers?.["agent-iam"]?.providerData).toBeDefined();
  });

  it("should not store provider data on failed auth", async () => {
    (tokenService.verify as any).mockReturnValue({ valid: false, error: "bad" });

    const handlers = createConnectionHandlers({ sessions, authManager });

    const result = await handlers["map/authenticate"](
      { method: "x-agent-iam", credential: "bad" },
      ctx
    ) as any;

    expect(result.success).toBe(false);
    expect(session.providers).toBeUndefined();
  });
});

// =============================================================================
// map/auth/refresh handler with providers
// =============================================================================

describe("map/auth/refresh handler with auth provider", () => {
  let eventBus: EventBusImpl;
  let sessions: SessionManagerImpl;
  let tokenService: TokenServiceLike;
  let provider: AgentIAMProvider;
  let authManager: AuthManagerImpl;
  let session: ServerSession;
  let ctx: HandlerContext;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    sessions = new SessionManagerImpl({ eventBus });
    tokenService = createMockTokenService();
    provider = new AgentIAMProvider({ tokenService });
    authManager = new AuthManagerImpl({ providers: [provider] });

    session = sessions.create({ role: "client" });
    ctx = {
      session,
      requestId: "req-3",
      signal: new AbortController().signal,
    };
  });

  it("should update provider data on session after refresh", async () => {
    // Set up initial provider data
    session.providers = {
      "agent-iam": {
        principal: { id: "old-agent" },
        providerData: createMockToken({ agentId: "old-agent" }),
      },
    };

    const handlers = createConnectionHandlers({ sessions, authManager });

    const result = await handlers["map/auth/refresh"](
      { method: "x-agent-iam", credential: "refreshed-token" },
      ctx
    ) as any;

    expect(result.success).toBe(true);
    // Provider data should be updated (new principal from the refreshed token)
    expect(session.providers?.["agent-iam"]?.principal.id).toBe("agent-001");
  });

  it("should not update provider data on failed refresh", async () => {
    session.providers = {
      "agent-iam": {
        principal: { id: "old-agent" },
        providerData: createMockToken({ agentId: "old-agent" }),
      },
    };

    (tokenService.verify as any).mockReturnValue({ valid: false, error: "expired" });

    const handlers = createConnectionHandlers({ sessions, authManager });

    const result = await handlers["map/auth/refresh"](
      { method: "x-agent-iam", credential: "expired-token" },
      ctx
    ) as any;

    expect(result.success).toBe(false);
    // Provider data should remain unchanged
    expect(session.providers?.["agent-iam"]?.principal.id).toBe("old-agent");
  });
});
