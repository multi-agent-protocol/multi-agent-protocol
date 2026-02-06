/**
 * Tests for AgentIAMProvider and AgentIAMCapabilityMapper
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentIAMProvider,
  AgentIAMCapabilityMapper,
} from "../server/auth/providers";
import type {
  TokenServiceLike,
  AgentIAMToken,
  MappableToken,
} from "../server/auth/providers";
import { AuthManagerImpl as AuthManagerImplClass } from "../server/auth/manager";

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
    serialize: vi.fn().mockReturnValue("serialized-token"),
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
// AgentIAMCapabilityMapper Tests
// =============================================================================

describe("AgentIAMCapabilityMapper", () => {
  const mapper = new AgentIAMCapabilityMapper();

  describe("mapToParticipantCapabilities()", () => {
    describe("agentCapabilities direct mapping", () => {
      it("should map all agentCapabilities fields", () => {
        const token: MappableToken = {
          scopes: [],
          agentCapabilities: {
            canSpawn: true,
            canMessage: true,
            canReceive: true,
            canObserve: true,
            canFederate: false,
            canCreateScopes: true,
          },
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.lifecycle?.canSpawn).toBe(true);
        expect(caps.lifecycle?.canRegister).toBe(true); // always true
        expect(caps.messaging?.canSend).toBe(true);
        expect(caps.messaging?.canReceive).toBe(true);
        expect(caps.messaging?.canBroadcast).toBe(true); // derived from canMessage
        expect(caps.observation?.canObserve).toBe(true);
        expect(caps.observation?.canQuery).toBe(true); // derived from canObserve
        expect(caps.federation?.canFederate).toBe(false);
        expect(caps.scopes?.canCreateScopes).toBe(true);
      });

      it("should map canQuery from canObserve", () => {
        const token: MappableToken = {
          scopes: [],
          agentCapabilities: { canObserve: false },
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.observation?.canObserve).toBe(false);
        expect(caps.observation?.canQuery).toBe(false);
      });

      it("should map canBroadcast from canMessage", () => {
        const token: MappableToken = {
          scopes: [],
          agentCapabilities: { canMessage: false },
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.messaging?.canSend).toBe(false);
        expect(caps.messaging?.canBroadcast).toBe(false);
      });

      it("should always set canRegister to true when agentCapabilities present", () => {
        const token: MappableToken = {
          scopes: [],
          agentCapabilities: {},
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.lifecycle?.canRegister).toBe(true);
      });

      it("should handle partially defined agentCapabilities", () => {
        const token: MappableToken = {
          scopes: [],
          agentCapabilities: {
            canSpawn: true,
            // others undefined
          },
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.lifecycle?.canSpawn).toBe(true);
        expect(caps.messaging?.canSend).toBeUndefined();
        expect(caps.observation?.canObserve).toBeUndefined();
        expect(caps.federation?.canFederate).toBeUndefined();
        expect(caps.scopes?.canCreateScopes).toBeUndefined();
      });

      it("should prefer agentCapabilities over scopes", () => {
        const token: MappableToken = {
          scopes: ["map:*"], // wildcards would grant everything
          agentCapabilities: {
            canSpawn: false,
            canMessage: false,
          },
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        // agentCapabilities takes priority, not scopes
        expect(caps.lifecycle?.canSpawn).toBe(false);
        expect(caps.messaging?.canSend).toBe(false);
      });
    });

    describe("scope-based inference", () => {
      it("should infer from wildcard scope map:*", () => {
        const token: MappableToken = { scopes: ["map:*"] };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.observation?.canObserve).toBe(true);
        expect(caps.observation?.canQuery).toBe(true);
        expect(caps.messaging?.canSend).toBe(true);
        expect(caps.messaging?.canReceive).toBe(true);
        expect(caps.messaging?.canBroadcast).toBe(true);
        expect(caps.lifecycle?.canSpawn).toBe(true);
        expect(caps.lifecycle?.canRegister).toBe(true);
        expect(caps.scopes?.canCreateScopes).toBe(true);
        expect(caps.scopes?.canManageScopes).toBe(true);
        expect(caps.federation?.canFederate).toBe(true);
      });

      it("should infer from * wildcard", () => {
        const token: MappableToken = { scopes: ["*"] };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.lifecycle?.canSpawn).toBe(true);
        expect(caps.federation?.canFederate).toBe(true);
        expect(caps.messaging?.canSend).toBe(true);
      });

      it("should infer map:observe", () => {
        const token: MappableToken = { scopes: ["map:observe"] };
        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.observation?.canObserve).toBe(true);
        expect(caps.observation?.canQuery).toBe(true);
      });

      it("should infer map:send", () => {
        const token: MappableToken = { scopes: ["map:send"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.messaging?.canSend).toBe(true);
      });

      it("should infer map:message as canSend", () => {
        const token: MappableToken = { scopes: ["map:message"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.messaging?.canSend).toBe(true);
      });

      it("should infer map:receive", () => {
        const token: MappableToken = { scopes: ["map:receive"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.messaging?.canReceive).toBe(true);
      });

      it("should infer map:broadcast", () => {
        const token: MappableToken = { scopes: ["map:broadcast"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.messaging?.canBroadcast).toBe(true);
      });

      it("should infer map:spawn", () => {
        const token: MappableToken = { scopes: ["map:spawn"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.lifecycle?.canSpawn).toBe(true);
      });

      it("should infer map:register", () => {
        const token: MappableToken = { scopes: ["map:register"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.lifecycle?.canRegister).toBe(true);
      });

      it("should infer map:scope:create", () => {
        const token: MappableToken = { scopes: ["map:scope:create"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.scopes?.canCreateScopes).toBe(true);
        expect(caps.scopes?.canManageScopes).toBeUndefined();
      });

      it("should infer map:scope:manage", () => {
        const token: MappableToken = { scopes: ["map:scope:manage"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.scopes?.canManageScopes).toBe(true);
      });

      it("should infer map:federate", () => {
        const token: MappableToken = { scopes: ["map:federate"] };
        const caps = mapper.mapToParticipantCapabilities(token);
        expect(caps.federation?.canFederate).toBe(true);
      });

      it("should combine multiple scopes", () => {
        const token: MappableToken = {
          scopes: ["map:observe", "map:send", "map:receive", "map:spawn"],
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.observation?.canObserve).toBe(true);
        expect(caps.messaging?.canSend).toBe(true);
        expect(caps.messaging?.canReceive).toBe(true);
        expect(caps.lifecycle?.canSpawn).toBe(true);
        // Not granted
        expect(caps.messaging?.canBroadcast).toBeUndefined();
        expect(caps.federation).toBeUndefined();
        expect(caps.scopes).toBeUndefined();
      });

      it("should return empty caps for non-map scopes", () => {
        const token: MappableToken = {
          scopes: ["github:repo:read", "aws:s3:write"],
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.observation).toBeUndefined();
        expect(caps.messaging).toBeUndefined();
        expect(caps.lifecycle).toBeUndefined();
        expect(caps.federation).toBeUndefined();
        expect(caps.scopes).toBeUndefined();
      });

      it("should handle mixed map and non-map scopes", () => {
        const token: MappableToken = {
          scopes: ["github:repo:read", "map:observe", "aws:s3:write"],
        };

        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.observation?.canObserve).toBe(true);
        expect(caps.messaging).toBeUndefined();
      });

      it("should handle empty scopes array", () => {
        const token: MappableToken = { scopes: [] };
        const caps = mapper.mapToParticipantCapabilities(token);

        expect(caps.observation).toBeUndefined();
        expect(caps.messaging).toBeUndefined();
        expect(caps.lifecycle).toBeUndefined();
      });

      it("should handle scopes with prefix matching (map:observe:events)", () => {
        const token: MappableToken = { scopes: ["map:observe:events"] };
        const caps = mapper.mapToParticipantCapabilities(token);

        // startsWith("map:observe") should match
        expect(caps.observation?.canObserve).toBe(true);
      });
    });
  });

  describe("mapToAgentPermissions()", () => {
    it("should return undefined when no agentCapabilities", () => {
      const token: MappableToken = { scopes: ["map:*"] };
      const perms = mapper.mapToAgentPermissions(token);
      expect(perms).toBeUndefined();
    });

    it("should map visibility 'public' to agents 'all'", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { visibility: "public", canObserve: true, canMessage: true, canReceive: true },
      };
      const perms = mapper.mapToAgentPermissions(token);
      expect(perms?.canSee?.agents).toBe("all");
    });

    it("should map visibility 'scope' to agents 'scoped'", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { visibility: "scope" },
      };
      const perms = mapper.mapToAgentPermissions(token);
      expect(perms?.canSee?.agents).toBe("scoped");
    });

    it("should map visibility 'parent-only' to agents 'hierarchy'", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { visibility: "parent-only", canObserve: false, canMessage: false, canReceive: false },
      };
      const perms = mapper.mapToAgentPermissions(token);
      expect(perms?.canSee?.agents).toBe("hierarchy");
    });

    it("should map visibility 'system' to agents 'direct'", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { visibility: "system" },
      };
      const perms = mapper.mapToAgentPermissions(token);
      expect(perms?.canSee?.agents).toBe("direct");
    });

    it("should map canObserve to scopes visibility", () => {
      const tokenObserve: MappableToken = {
        scopes: [],
        agentCapabilities: { canObserve: true },
      };
      expect(mapper.mapToAgentPermissions(tokenObserve)?.canSee?.scopes).toBe("all");

      const tokenNoObserve: MappableToken = {
        scopes: [],
        agentCapabilities: { canObserve: false },
      };
      expect(mapper.mapToAgentPermissions(tokenNoObserve)?.canSee?.scopes).toBe("member");
    });

    it("should map canMessage to canMessage.agents", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { canMessage: true },
      };
      expect(mapper.mapToAgentPermissions(token)?.canMessage?.agents).toBe("all");
    });

    it("should set canMessage.agents to undefined when canMessage is false", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { canMessage: false },
      };
      expect(mapper.mapToAgentPermissions(token)?.canMessage?.agents).toBeUndefined();
    });

    it("should map canReceive true to acceptsFrom.agents 'all'", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { canReceive: true },
      };
      expect(mapper.mapToAgentPermissions(token)?.acceptsFrom?.agents).toBe("all");
    });

    it("should map canReceive false to acceptsFrom.agents empty include list", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { canReceive: false },
      };
      expect(mapper.mapToAgentPermissions(token)?.acceptsFrom?.agents).toEqual({ include: [] });
    });

    it("should handle no visibility set (undefined)", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: { canMessage: true },
      };
      const perms = mapper.mapToAgentPermissions(token);
      expect(perms?.canSee?.agents).toBeUndefined();
    });
  });

  describe("map()", () => {
    it("should return both participantCapabilities and defaultAgentPermissions", () => {
      const token: MappableToken = {
        scopes: [],
        agentCapabilities: {
          canSpawn: true,
          canMessage: true,
          canReceive: true,
          canObserve: true,
          visibility: "scope",
        },
      };

      const mapping = mapper.map(token);

      expect(mapping.participantCapabilities).toBeDefined();
      expect(mapping.participantCapabilities.lifecycle?.canSpawn).toBe(true);
      expect(mapping.defaultAgentPermissions).toBeDefined();
      expect(mapping.defaultAgentPermissions?.canSee?.agents).toBe("scoped");
    });

    it("should omit defaultAgentPermissions when no agentCapabilities", () => {
      const token: MappableToken = { scopes: ["map:observe"] };
      const mapping = mapper.map(token);

      expect(mapping.participantCapabilities).toBeDefined();
      expect(mapping.defaultAgentPermissions).toBeUndefined();
    });

    it("should include defaultAgentPermissions when agentCapabilities is empty object", () => {
      const token: MappableToken = { scopes: [], agentCapabilities: {} };
      const mapping = mapper.map(token);

      // Empty agentCapabilities still triggers permission mapping
      expect(mapping.defaultAgentPermissions).toBeDefined();
    });
  });
});

// =============================================================================
// AgentIAMProvider Tests
// =============================================================================

describe("AgentIAMProvider", () => {
  let tokenService: TokenServiceLike;
  let provider: AgentIAMProvider;

  beforeEach(() => {
    tokenService = createMockTokenService();
    provider = new AgentIAMProvider({ tokenService });
  });

  it("should have correct methods and providerId", () => {
    expect(provider.methods).toEqual(["x-agent-iam"]);
    expect(provider.providerId).toBe("agent-iam");
  });

  describe("authenticate()", () => {
    it("should authenticate a valid token", async () => {
      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "valid-serialized-token" },
        {}
      );

      expect(result.success).toBe(true);
      expect(result.principal?.id).toBe("agent-001");
      expect(result.providerData).toBeDefined();
      expect(tokenService.deserialize).toHaveBeenCalledWith("valid-serialized-token");
      expect(tokenService.verify).toHaveBeenCalled();
    });

    it("should return providerData as the deserialized token", async () => {
      const token = createMockToken({ agentId: "special-agent" });
      (tokenService.deserialize as any).mockReturnValue(token);

      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.providerData).toBe(token);
    });

    it("should include scopes and delegatable in principal claims", async () => {
      const token = createMockToken({
        scopes: ["map:observe", "map:send"],
        delegatable: true,
        currentDepth: 2,
      });
      (tokenService.deserialize as any).mockReturnValue(token);

      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.principal?.claims?.scopes).toEqual(["map:observe", "map:send"]);
      expect(result.principal?.claims?.delegatable).toBe(true);
      expect(result.principal?.claims?.currentDepth).toBe(2);
    });

    it("should use 'agent-iam' as default issuer when no identity", async () => {
      const token = createMockToken(); // no identity field
      (tokenService.deserialize as any).mockReturnValue(token);

      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.principal?.issuer).toBe("agent-iam");
    });

    it("should fail for empty string credential", async () => {
      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("invalid_credentials");
      expect(result.error?.message).toContain("Missing");
    });

    it("should fail for non-string credential", async () => {
      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: 12345 as any },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("invalid_credentials");
    });

    it("should fail for undefined credential", async () => {
      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: undefined as any },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("invalid_credentials");
    });

    it("should fail for invalid token (deserialize error)", async () => {
      (tokenService.deserialize as any).mockImplementation(() => {
        throw new Error("bad base64");
      });

      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "garbage" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("deserialize");
    });

    it("should fail for expired/bad signature token", async () => {
      (tokenService.verify as any).mockReturnValue({
        valid: false,
        error: "Token expired",
      });

      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "expired-token" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("expired");
    });

    it("should use fallback message when verify returns no error string", async () => {
      (tokenService.verify as any).mockReturnValue({
        valid: false,
        // no error field
      });

      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "bad-token" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("verification failed");
    });

    it("should fail for wrong systemId", async () => {
      const token = createMockToken({
        identity: { systemId: "other-system", principalId: "user-1" },
      });
      (tokenService.deserialize as any).mockReturnValue(token);

      const strictProvider = new AgentIAMProvider({
        tokenService,
        systemId: "my-system",
      });

      const result = await strictProvider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("systemId");
      expect(result.error?.message).toContain("other-system");
      expect(result.error?.message).toContain("my-system");
    });

    it("should pass when token systemId matches configured systemId", async () => {
      const token = createMockToken({
        identity: { systemId: "my-system" },
      });
      (tokenService.deserialize as any).mockReturnValue(token);

      const strictProvider = new AgentIAMProvider({
        tokenService,
        systemId: "my-system",
      });

      const result = await strictProvider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.success).toBe(true);
    });

    it("should pass when token has no identity but systemId is configured", async () => {
      const token = createMockToken(); // no identity
      (tokenService.deserialize as any).mockReturnValue(token);

      const strictProvider = new AgentIAMProvider({
        tokenService,
        systemId: "my-system",
      });

      const result = await strictProvider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      // No identity.systemId to mismatch, so it passes
      expect(result.success).toBe(true);
    });

    it("should fail for wrong tenantId", async () => {
      const token = createMockToken({
        identity: { systemId: "my-system", tenantId: "other-tenant" },
      });
      (tokenService.deserialize as any).mockReturnValue(token);

      const strictProvider = new AgentIAMProvider({
        tokenService,
        tenantId: "my-tenant",
      });

      const result = await strictProvider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("tenantId");
    });

    it("should pass when token tenantId matches configured tenantId", async () => {
      const token = createMockToken({
        identity: { systemId: "sys", tenantId: "my-tenant" },
      });
      (tokenService.deserialize as any).mockReturnValue(token);

      const strictProvider = new AgentIAMProvider({
        tokenService,
        tenantId: "my-tenant",
      });

      const result = await strictProvider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.success).toBe(true);
    });

    it("should pass when token has no tenantId but tenantId is configured", async () => {
      const token = createMockToken({
        identity: { systemId: "sys" }, // no tenantId
      });
      (tokenService.deserialize as any).mockReturnValue(token);

      const strictProvider = new AgentIAMProvider({
        tokenService,
        tenantId: "my-tenant",
      });

      const result = await strictProvider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.success).toBe(true);
    });

    it("should include identity claims in principal", async () => {
      const token = createMockToken({
        identity: {
          systemId: "test-system",
          principalId: "human-user",
          principalType: "human",
          organizationId: "acme-corp",
        },
      });
      (tokenService.deserialize as any).mockReturnValue(token);

      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.success).toBe(true);
      expect(result.principal?.issuer).toBe("test-system");
      expect(result.principal?.claims?.principalId).toBe("human-user");
      expect(result.principal?.claims?.principalType).toBe("human");
      expect(result.principal?.claims?.organizationId).toBe("acme-corp");
    });

    it("should not include absent identity fields in claims", async () => {
      const token = createMockToken({
        identity: { systemId: "sys" }, // no principalId, principalType, organizationId
      });
      (tokenService.deserialize as any).mockReturnValue(token);

      const result = await provider.authenticate(
        { method: "x-agent-iam", credential: "token" },
        {}
      );

      expect(result.principal?.claims).not.toHaveProperty("principalId");
      expect(result.principal?.claims).not.toHaveProperty("principalType");
      expect(result.principal?.claims).not.toHaveProperty("organizationId");
    });
  });

  describe("mapCapabilities()", () => {
    it("should delegate to mapper with agentCapabilities", () => {
      const token = createMockToken({
        agentCapabilities: {
          canSpawn: true,
          canMessage: true,
          canReceive: true,
          canObserve: true,
        },
      });

      const mapping = provider.mapCapabilities({ id: "agent-001" }, token);

      expect(mapping.participantCapabilities).toBeDefined();
      expect(mapping.participantCapabilities.lifecycle?.canSpawn).toBe(true);
      expect(mapping.participantCapabilities.messaging?.canSend).toBe(true);
      expect(mapping.participantCapabilities.observation?.canObserve).toBe(true);
    });

    it("should delegate to mapper with scope inference", () => {
      const token = createMockToken({
        scopes: ["map:observe", "map:federate"],
      });
      // Remove agentCapabilities to trigger scope inference
      delete (token as any).agentCapabilities;

      const mapping = provider.mapCapabilities({ id: "agent-001" }, token);

      expect(mapping.participantCapabilities.observation?.canObserve).toBe(true);
      expect(mapping.participantCapabilities.federation?.canFederate).toBe(true);
    });
  });

  describe("delegateForSpawn()", () => {
    it("should delegate token and return credentials", async () => {
      const parentToken = createMockToken();

      const result = await provider.delegateForSpawn(
        { id: "agent-001" },
        parentToken,
        {
          childAgentId: "child-001",
          requestedScopes: ["map:observe", "map:send"],
          ttlMinutes: 60,
        }
      );

      expect(result.method).toBe("x-agent-iam");
      expect(result.credentials.token).toBe("serialized-token");
      expect(result.env?.AGENT_TOKEN).toBe("serialized-token");
      expect(tokenService.delegate).toHaveBeenCalledWith(
        parentToken,
        expect.objectContaining({
          agentId: "child-001",
          requestedScopes: ["map:observe", "map:send"],
          ttlMinutes: 60,
          delegatable: true,
          inheritIdentity: true,
        })
      );
    });

    it("should use parent scopes when none requested", async () => {
      const parentToken = createMockToken({
        scopes: ["map:observe", "map:send"],
      });

      await provider.delegateForSpawn(
        { id: "agent-001" },
        parentToken,
        { childAgentId: "child-002" }
      );

      expect(tokenService.delegate).toHaveBeenCalledWith(
        parentToken,
        expect.objectContaining({
          requestedScopes: ["map:observe", "map:send"],
        })
      );
    });

    it("should default inheritIdentity to true", async () => {
      const parentToken = createMockToken();

      await provider.delegateForSpawn(
        { id: "agent-001" },
        parentToken,
        { childAgentId: "child-003" }
      );

      expect(tokenService.delegate).toHaveBeenCalledWith(
        parentToken,
        expect.objectContaining({ inheritIdentity: true })
      );
    });

    it("should pass explicit inheritIdentity=false", async () => {
      const parentToken = createMockToken();

      await provider.delegateForSpawn(
        { id: "agent-001" },
        parentToken,
        { childAgentId: "child-004", inheritIdentity: false }
      );

      expect(tokenService.delegate).toHaveBeenCalledWith(
        parentToken,
        expect.objectContaining({ inheritIdentity: false })
      );
    });

    it("should call serialize on the delegated token", async () => {
      const parentToken = createMockToken();

      await provider.delegateForSpawn(
        { id: "agent-001" },
        parentToken,
        { childAgentId: "child-005" }
      );

      expect(tokenService.serialize).toHaveBeenCalled();
    });
  });

  describe("federation stubs", () => {
    it("handleFederatedToken should return not allowed", async () => {
      const result = await provider.handleFederatedToken(
        "remote-system",
        "token",
        { localSystemId: "local" }
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not yet implemented");
    });

    it("prepareFederatedToken should return not allowed", async () => {
      const result = await provider.prepareFederatedToken(
        { id: "agent-001" },
        {},
        "remote-system"
      );

      expect(result.allowed).toBe(false);
      expect(result.token).toBe("");
      expect(result.reason).toContain("not yet implemented");
    });
  });
});

// =============================================================================
// AuthManagerImpl Provider Integration
// =============================================================================

describe("AuthManagerImpl with providers", () => {
  it("should register provider and look up by providerId", () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    const manager = new AuthManagerImplClass({ providers: [provider] });

    expect(manager.getProvider("agent-iam")).toBe(provider);
  });

  it("should look up provider by method", () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    const manager = new AuthManagerImplClass({ providers: [provider] });

    expect(manager.getProvider("x-agent-iam")).toBe(provider);
  });

  it("should return undefined for unknown provider", () => {
    const manager = new AuthManagerImplClass({});

    expect(manager.getProvider("nonexistent")).toBeUndefined();
  });

  it("should include provider methods in supportedMethods", () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    const manager = new AuthManagerImplClass({ providers: [provider] });

    expect(manager.supportedMethods).toContain("x-agent-iam");
  });

  it("should include provider methods in getCapabilities()", () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    const manager = new AuthManagerImplClass({ providers: [provider] });
    const caps = manager.getCapabilities();

    expect(caps.methods).toContain("x-agent-iam");
  });

  it("should authenticate via provider through manager", async () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    const manager = new AuthManagerImplClass({ providers: [provider] });

    const result = await manager.authenticate(
      { method: "x-agent-iam", credential: "some-token" },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.principal?.id).toBe("agent-001");
    expect(result.providerData).toBeDefined();
  });

  it("should get capability mapping via getCapabilityMapping", () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    const manager = new AuthManagerImplClass({ providers: [provider] });

    const token = createMockToken({
      agentCapabilities: { canSpawn: true, canMessage: true },
    });

    const mapping = manager.getCapabilityMapping(
      "x-agent-iam",
      { id: "agent-001" },
      token
    );

    expect(mapping).toBeDefined();
    expect(mapping?.participantCapabilities.lifecycle?.canSpawn).toBe(true);
    expect(mapping?.participantCapabilities.messaging?.canSend).toBe(true);
  });

  it("should return undefined for non-provider method", () => {
    const manager = new AuthManagerImplClass({});

    const mapping = manager.getCapabilityMapping("bearer", { id: "test" }, {});

    expect(mapping).toBeUndefined();
  });

  it("should auto-detect providers in authenticators array", () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    // Pass provider in authenticators (not providers) array
    const manager = new AuthManagerImplClass({
      authenticators: [provider],
    });

    expect(manager.getProvider("agent-iam")).toBe(provider);
    expect(manager.getProvider("x-agent-iam")).toBe(provider);
  });

  it("should delegate for spawn via session providers", async () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    const manager = new AuthManagerImplClass({ providers: [provider] });

    const parentToken = createMockToken();
    const session = {
      id: "session-1",
      role: "agent",
      status: "connected",
      connectedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      agentIds: ["agent-001"],
      subscriptionIds: [],
      providers: {
        "agent-iam": {
          principal: { id: "agent-001" },
          providerData: parentToken,
        },
      },
    } as any;

    const result = await manager.delegateForSpawn(session, {
      childAgentId: "child-001",
    });

    expect(result).toBeDefined();
    expect(result?.method).toBe("x-agent-iam");
    expect(result?.credentials.token).toBe("serialized-token");
    expect(result?.env?.AGENT_TOKEN).toBe("serialized-token");
  });

  it("should return undefined for spawn when no providers on session", async () => {
    const manager = new AuthManagerImplClass({});

    const session = {
      id: "session-1",
      agentIds: [],
      subscriptionIds: [],
    } as any;

    const result = await manager.delegateForSpawn(session, {
      childAgentId: "child-001",
    });

    expect(result).toBeUndefined();
  });

  it("should return undefined for spawn when session.providers is empty", async () => {
    const tokenService = createMockTokenService();
    const provider = new AgentIAMProvider({ tokenService });

    const manager = new AuthManagerImplClass({ providers: [provider] });

    const session = {
      id: "session-1",
      agentIds: [],
      subscriptionIds: [],
      providers: {},
    } as any;

    const result = await manager.delegateForSpawn(session, {
      childAgentId: "child-001",
    });

    expect(result).toBeUndefined();
  });

  it("should return undefined for spawn when provider has no delegateForSpawn", async () => {
    // Create a provider-like object without delegateForSpawn
    const minimalProvider = {
      methods: ["x-custom" as const],
      providerId: "custom",
      authenticate: vi.fn().mockResolvedValue({ success: true }),
    };

    const manager = new AuthManagerImplClass({
      providers: [minimalProvider as any],
    });

    const session = {
      id: "session-1",
      providers: {
        custom: { principal: { id: "a" }, providerData: {} },
      },
    } as any;

    const result = await manager.delegateForSpawn(session, {
      childAgentId: "child-001",
    });

    expect(result).toBeUndefined();
  });
});
