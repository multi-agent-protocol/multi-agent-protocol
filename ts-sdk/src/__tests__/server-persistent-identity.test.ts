/**
 * Tests for persistent identity features:
 * - Agent resumption via persistentId
 * - uniqueIdentity enforcement
 * - IdentityVerifier hook
 * - Credential audit with persistentId
 * - AgentRegistry.resume() method
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemoryAgentStore,
  AgentRegistryImpl,
  AgentNotFoundError,
} from "../server/agents";
import { EventBusImpl } from "../server/events";
import { createAgentHandlers } from "../server/agents/handlers";
import { createCredentialHandlers } from "../server/credentials/handlers";
import type {
  AgentRegistry,
  EventBus,
  HandlerContext,
  ServerSession,
  IdentityVerifier,
  IdentityVerificationContext,
} from "../server/types";
import type { AgentPersistentIdentity, IdentityVerificationStatus } from "../types";

// =============================================================================
// Helpers
// =============================================================================

function createSession(overrides: Partial<ServerSession> = {}): ServerSession {
  return {
    id: "session-1",
    role: "agent",
    status: "connected",
    agentIds: [],
    subscriptionIds: [],
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
    ...overrides,
  };
}

function createCtx(session?: ServerSession): HandlerContext {
  return {
    session: session ?? createSession(),
    requestId: "req-1",
    signal: new AbortController().signal,
  };
}

function createIdentity(overrides: Partial<AgentPersistentIdentity> = {}): AgentPersistentIdentity {
  return {
    persistentId: "did:key:z6MkTestKey123",
    identityType: "keypair",
    ...overrides,
  };
}

// =============================================================================
// AgentRegistry.resume()
// =============================================================================

describe("AgentRegistry.resume()", () => {
  let eventBus: EventBus;
  let registry: AgentRegistry;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
  });

  it("should resume an agent under a new session", () => {
    const agent = registry.register({
      name: "agent-1",
      sessionId: "old-session",
      persistentIdentity: createIdentity(),
    });

    const resumed = registry.resume(agent.id, "new-session");

    expect(resumed.sessionId).toBe("new-session");
    expect(resumed.state).toBe("idle");
    expect(resumed.id).toBe(agent.id); // Same ID preserved
    expect(resumed.name).toBe("agent-1");
  });

  it("should merge metadata on resume", () => {
    const agent = registry.register({
      name: "agent-1",
      sessionId: "old-session",
      metadata: { existing: true },
    });

    const resumed = registry.resume(agent.id, "new-session", { resumedAt: 12345 });

    expect(resumed.metadata).toEqual({ existing: true, resumedAt: 12345 });
  });

  it("should update persistentIdentity on resume", () => {
    const oldIdentity = createIdentity({ verificationStatus: "self-declared" });
    const agent = registry.register({
      name: "agent-1",
      sessionId: "old-session",
      persistentIdentity: oldIdentity,
    });

    const newIdentity = createIdentity({ verificationStatus: "verified" });
    const resumed = registry.resume(agent.id, "new-session", undefined, newIdentity);

    expect(resumed.persistentIdentity?.verificationStatus).toBe("verified");
  });

  it("should emit agent.resumed event", () => {
    const handler = vi.fn();
    eventBus.on("agent.resumed", handler);

    const agent = registry.register({
      name: "agent-1",
      sessionId: "old-session",
    });

    registry.resume(agent.id, "new-session");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.data.previousSessionId).toBe("old-session");
    expect(event.data.agent.sessionId).toBe("new-session");
  });

  it("should throw AgentNotFoundError for unknown agent", () => {
    expect(() => registry.resume("unknown", "new-session")).toThrow(AgentNotFoundError);
  });

  it("should reset state to idle regardless of current state", () => {
    const agent = registry.register({
      name: "agent-1",
      sessionId: "old-session",
    });
    registry.updateState(agent.id, "busy");

    const resumed = registry.resume(agent.id, "new-session");
    expect(resumed.state).toBe("idle");
  });
});

// =============================================================================
// Register handler: resumePersistentIdentity
// =============================================================================

describe("register handler: resumePersistentIdentity", () => {
  let eventBus: EventBus;
  let registry: AgentRegistry;
  let handlers: ReturnType<typeof createAgentHandlers>;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
    handlers = createAgentHandlers({ agents: registry, eventBus });
  });

  it("should resume an orphaned agent by persistentId", async () => {
    const identity = createIdentity();

    // Register original agent in old session
    const oldSession = createSession({ id: "old-session" });
    await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(oldSession),
    );

    // Resume from new session
    const newSession = createSession({ id: "new-session" });
    const result = await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity, resumePersistentIdentity: true },
      createCtx(newSession),
    ) as any;

    expect(result.resumed).toBe(true);
    expect(result.resumedFrom.previousSessionId).toBe("old-session");
    expect(result.agent.persistentIdentity.persistentId).toBe(identity.persistentId);
  });

  it("should create new agent when no orphaned agent exists", async () => {
    const identity = createIdentity();
    const session = createSession();

    const result = await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity, resumePersistentIdentity: true },
      createCtx(session),
    ) as any;

    expect(result.resumed).toBeUndefined();
    expect(result.agent.name).toBe("agent-1");
  });

  it("should resume an active agent when multiple exist", async () => {
    const identity = createIdentity();

    // Register two agents with same identity
    const session1 = createSession({ id: "session-1" });
    const firstResult = await handlers["map/agents/register"](
      { name: "agent-a", persistentIdentity: identity },
      createCtx(session1),
    ) as any;

    const session2 = createSession({ id: "session-2" });
    const secondResult = await handlers["map/agents/register"](
      { name: "agent-b", persistentIdentity: identity },
      createCtx(session2),
    ) as any;

    // Resume should pick one of the active agents
    const session3 = createSession({ id: "session-3" });
    const result = await handlers["map/agents/register"](
      { name: "resuming", persistentIdentity: identity, resumePersistentIdentity: true },
      createCtx(session3),
    ) as any;

    expect(result.resumed).toBe(true);
    // Should resume one of the two active agents
    expect([firstResult.agent.id, secondResult.agent.id]).toContain(result.agent.id);
  });

  it("should not resume stopped agents", async () => {
    const identity = createIdentity();

    // Register and stop
    const session1 = createSession({ id: "session-1" });
    const result1 = await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(session1),
    ) as any;
    registry.updateState(result1.agent.id, "stopped");

    // Resume should create new agent (no active agents to resume)
    const session2 = createSession({ id: "session-2" });
    const result = await handlers["map/agents/register"](
      { name: "agent-2", persistentIdentity: identity, resumePersistentIdentity: true },
      createCtx(session2),
    ) as any;

    expect(result.resumed).toBeUndefined();
    expect(result.agent.id).not.toBe(result1.agent.id);
  });
});

// =============================================================================
// Register handler: uniqueIdentity
// =============================================================================

describe("register handler: uniqueIdentity", () => {
  let eventBus: EventBus;
  let registry: AgentRegistry;
  let handlers: ReturnType<typeof createAgentHandlers>;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
    handlers = createAgentHandlers({ agents: registry, eventBus, uniqueIdentity: true });
  });

  it("should reject registration when active agent with same persistentId exists", async () => {
    const identity = createIdentity();

    const session1 = createSession({ id: "session-1" });
    await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(session1),
    );

    const session2 = createSession({ id: "session-2" });
    await expect(
      handlers["map/agents/register"](
        { name: "agent-2", persistentIdentity: identity },
        createCtx(session2),
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("should allow registration with resumePersistentIdentity even in uniqueIdentity mode", async () => {
    const identity = createIdentity();

    const session1 = createSession({ id: "session-1" });
    await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(session1),
    );

    const session2 = createSession({ id: "session-2" });
    const result = await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity, resumePersistentIdentity: true },
      createCtx(session2),
    ) as any;

    expect(result.resumed).toBe(true);
  });

  it("should allow registration after existing agent is stopped", async () => {
    const identity = createIdentity();

    const session1 = createSession({ id: "session-1" });
    const result1 = await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(session1),
    ) as any;

    registry.updateState(result1.agent.id, "stopped");

    const session2 = createSession({ id: "session-2" });
    const result2 = await handlers["map/agents/register"](
      { name: "agent-2", persistentIdentity: identity },
      createCtx(session2),
    ) as any;

    expect(result2.agent.name).toBe("agent-2");
  });

  it("should allow registration with different persistentId", async () => {
    const identity1 = createIdentity({ persistentId: "did:key:z6MkKey1" });
    const identity2 = createIdentity({ persistentId: "did:key:z6MkKey2" });

    const session = createSession();
    await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity1 },
      createCtx(session),
    );

    const result = await handlers["map/agents/register"](
      { name: "agent-2", persistentIdentity: identity2 },
      createCtx(session),
    ) as any;

    expect(result.agent.name).toBe("agent-2");
  });
});

// =============================================================================
// Register handler: IdentityVerifier hook
// =============================================================================

describe("register handler: IdentityVerifier", () => {
  let eventBus: EventBus;
  let registry: AgentRegistry;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
  });

  it("should call verifier with identity and context", async () => {
    const verifier: IdentityVerifier = {
      verify: vi.fn().mockResolvedValue("verified"),
    };
    const handlers = createAgentHandlers({ agents: registry, eventBus, identityVerifier: verifier });
    const identity = createIdentity();

    await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(),
    );

    expect(verifier.verify).toHaveBeenCalledTimes(1);
    const [calledIdentity, calledContext] = (verifier.verify as any).mock.calls[0];
    expect(calledIdentity.persistentId).toBe(identity.persistentId);
    expect(calledContext.agentName).toBe("agent-1");
    expect(calledContext.sessionId).toBe("session-1");
    expect(calledContext.isResumption).toBe(false);
  });

  it("should set verificationStatus from verifier result", async () => {
    const verifier: IdentityVerifier = {
      verify: vi.fn().mockResolvedValue("verified" as IdentityVerificationStatus),
    };
    const handlers = createAgentHandlers({ agents: registry, eventBus, identityVerifier: verifier });
    const identity = createIdentity();

    const result = await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(),
    ) as any;

    expect(result.agent.persistentIdentity.verificationStatus).toBe("verified");
  });

  it("should set unverified when verifier throws", async () => {
    const verifier: IdentityVerifier = {
      verify: vi.fn().mockRejectedValue(new Error("crypto failure")),
    };
    const handlers = createAgentHandlers({ agents: registry, eventBus, identityVerifier: verifier });
    const identity = createIdentity();

    const result = await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(),
    ) as any;

    expect(result.agent.persistentIdentity.verificationStatus).toBe("unverified");
  });

  it("should emit verification failure event when verifier throws", async () => {
    const verifier: IdentityVerifier = {
      verify: vi.fn().mockRejectedValue(new Error("bad signature")),
    };
    const handler = vi.fn();
    eventBus.on("agent.identity.verification.failed", handler);

    const handlers = createAgentHandlers({ agents: registry, eventBus, identityVerifier: verifier });
    const identity = createIdentity();

    await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.data.persistentId).toBe(identity.persistentId);
    expect(event.data.error).toBe("bad signature");
  });

  it("should not call verifier when no identity is present", async () => {
    const verifier: IdentityVerifier = {
      verify: vi.fn().mockResolvedValue("verified"),
    };
    const handlers = createAgentHandlers({ agents: registry, eventBus, identityVerifier: verifier });

    await handlers["map/agents/register"](
      { name: "agent-1" },
      createCtx(),
    );

    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("should skip verification when verifier returns undefined", async () => {
    const verifier: IdentityVerifier = {
      verify: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = createAgentHandlers({ agents: registry, eventBus, identityVerifier: verifier });
    const identity = createIdentity();

    const result = await handlers["map/agents/register"](
      { name: "agent-1", persistentIdentity: identity },
      createCtx(),
    ) as any;

    // verificationStatus should not be set (no override)
    expect(result.agent.persistentIdentity.verificationStatus).toBeUndefined();
  });
});

// =============================================================================
// Register handler: input validation
// =============================================================================

describe("register handler: input validation", () => {
  let eventBus: EventBus;
  let registry: AgentRegistry;
  let handlers: ReturnType<typeof createAgentHandlers>;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
    handlers = createAgentHandlers({ agents: registry, eventBus });
  });

  it("should reject registration with empty name", async () => {
    await expect(
      handlers["map/agents/register"]({ name: "" }, createCtx()),
    ).rejects.toThrow(/name is required/);
  });

  it("should reject registration with whitespace-only name", async () => {
    await expect(
      handlers["map/agents/register"]({ name: "   " }, createCtx()),
    ).rejects.toThrow(/name is required/);
  });

  it("should reject identity with empty persistentId", async () => {
    await expect(
      handlers["map/agents/register"](
        { name: "agent-1", persistentIdentity: { persistentId: "", identityType: "keypair" } },
        createCtx(),
      ),
    ).rejects.toThrow(/persistentId must be a non-empty string/);
  });

  it("should reject identity with missing identityType", async () => {
    await expect(
      handlers["map/agents/register"](
        { name: "agent-1", persistentIdentity: { persistentId: "did:key:z6Mk123" } },
        createCtx(),
      ),
    ).rejects.toThrow(/identityType is required/);
  });
});

// =============================================================================
// Register handler: auth-derived identity
// =============================================================================

describe("register handler: auth-derived identity", () => {
  let eventBus: EventBus;
  let registry: AgentRegistry;
  let handlers: ReturnType<typeof createAgentHandlers>;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    registry = new AgentRegistryImpl({ eventBus });
    handlers = createAgentHandlers({ agents: registry, eventBus });
  });

  it("should extract identity from agent-iam token when not explicit", async () => {
    const session = createSession({
      providers: {
        'agent-iam': {
          providerData: {
            persistentIdentity: {
              persistentId: "did:key:z6MkFromToken",
              identityType: "keypair",
              publicKey: "pubkey123",
            },
          },
        },
      },
    } as any);

    const result = await handlers["map/agents/register"](
      { name: "agent-1" },
      createCtx(session),
    ) as any;

    expect(result.agent.persistentIdentity.persistentId).toBe("did:key:z6MkFromToken");
    expect(result.agent.persistentIdentity.verificationStatus).toBe("auth-derived");
  });

  it("should skip auth-derived identity when fields are invalid", async () => {
    const session = createSession({
      providers: {
        'agent-iam': {
          providerData: {
            persistentIdentity: {
              // Missing persistentId — should skip
              identityType: "keypair",
            },
          },
        },
      },
    } as any);

    const result = await handlers["map/agents/register"](
      { name: "agent-1" },
      createCtx(session),
    ) as any;

    expect(result.agent.persistentIdentity).toBeUndefined();
  });

  it("should map proof and challenge from token to AgentIdentityProof", async () => {
    const session = createSession({
      providers: {
        'agent-iam': {
          providerData: {
            persistentIdentity: {
              persistentId: "did:key:z6MkProofTest",
              identityType: "keypair",
              proof: "sig-bytes-here",
              challenge: "nonce-123",
            },
          },
        },
      },
    } as any);

    const result = await handlers["map/agents/register"](
      { name: "agent-1" },
      createCtx(session),
    ) as any;

    expect(result.agent.persistentIdentity.proof).toEqual({
      challenge: "nonce-123",
      signature: "sig-bytes-here",
      provenAt: expect.any(String),
    });
  });
});

// =============================================================================
// Credential audit: persistentId
// =============================================================================

describe("credential audit: persistentId", () => {
  it("should include persistentId in credential.denied event when present", async () => {
    const eventBus = new EventBusImpl();
    const handler = vi.fn();
    eventBus.on("credential.denied", handler);

    const broker = {
      checkPermission: () => ({ valid: false, error: "not allowed" }),
      getCredential: vi.fn(),
      getStatus: () => ({ providers: [] }),
    };

    const handlers = createCredentialHandlers({ broker, eventBus });

    const session = createSession({
      providers: {
        'agent-iam': {
          providerData: {
            agentId: "agent-1",
            scopes: ["read"],
            persistentIdentity: { persistentId: "did:key:z6MkAudit" },
          },
        },
      },
    } as any);

    try {
      await handlers["cred/get"](
        { scope: "github:repo", resource: "org/repo" },
        createCtx(session),
      );
    } catch {
      // Expected: permission denied
    }

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.data.persistentId).toBe("did:key:z6MkAudit");
  });

  it("should omit persistentId when not present on token", async () => {
    const eventBus = new EventBusImpl();
    const handler = vi.fn();
    eventBus.on("credential.denied", handler);

    const broker = {
      checkPermission: () => ({ valid: false, error: "not allowed" }),
      getCredential: vi.fn(),
      getStatus: () => ({ providers: [] }),
    };

    const handlers = createCredentialHandlers({ broker, eventBus });

    const session = createSession({
      providers: {
        'agent-iam': {
          providerData: {
            agentId: "agent-1",
            scopes: ["read"],
          },
        },
      },
    } as any);

    try {
      await handlers["cred/get"](
        { scope: "github:repo", resource: "org/repo" },
        createCtx(session),
      );
    } catch {
      // Expected
    }

    const event = handler.mock.calls[0][0];
    expect(event.data.persistentId).toBeUndefined();
    expect("persistentId" in event.data).toBe(false);
  });

  it("should include persistentId in credential.issued event", async () => {
    const eventBus = new EventBusImpl();
    const handler = vi.fn();
    eventBus.on("credential.issued", handler);

    const broker = {
      checkPermission: () => ({ valid: true }),
      getCredential: vi.fn().mockResolvedValue({
        credentialType: "token",
        credential: "secret",
        expiresAt: "2030-01-01",
      }),
      getStatus: () => ({ providers: [] }),
    };

    const handlers = createCredentialHandlers({ broker, eventBus });

    const session = createSession({
      providers: {
        'agent-iam': {
          providerData: {
            agentId: "agent-1",
            scopes: ["read"],
            persistentIdentity: { persistentId: "did:key:z6MkIssue" },
          },
        },
      },
    } as any);

    await handlers["cred/get"](
      { scope: "github:repo", resource: "org/repo" },
      createCtx(session),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.data.persistentId).toBe("did:key:z6MkIssue");
  });
});

// =============================================================================
// InMemoryAgentStore: persistentId filter
// =============================================================================

describe("InMemoryAgentStore: persistentId filter", () => {
  it("should filter agents by persistentId", () => {
    const store = new InMemoryAgentStore();
    const now = Date.now();

    store.save({
      id: "a1", name: "Agent 1", state: "idle", metadata: {},
      sessionId: "s1", registeredAt: now, lastStateChange: now,
      persistentIdentity: createIdentity({ persistentId: "did:key:z6MkA" }),
    });
    store.save({
      id: "a2", name: "Agent 2", state: "idle", metadata: {},
      sessionId: "s1", registeredAt: now, lastStateChange: now,
      persistentIdentity: createIdentity({ persistentId: "did:key:z6MkB" }),
    });
    store.save({
      id: "a3", name: "Agent 3", state: "idle", metadata: {},
      sessionId: "s1", registeredAt: now, lastStateChange: now,
    });

    const results = store.list({ persistentId: "did:key:z6MkA" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a1");
  });
});
