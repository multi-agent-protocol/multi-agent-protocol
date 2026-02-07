/**
 * Tests for capability intersection logic
 */

import { describe, it, expect } from "vitest";
import {
  and,
  intersectCapabilities,
  intersectAgentPermissions,
} from "../server/auth/capabilities";
import type { ParticipantCapabilities, AgentPermissions } from "../types";

// =============================================================================
// and() Tests
// =============================================================================

describe("and()", () => {
  it("should return false if either is false", () => {
    expect(and(false, true)).toBe(false);
    expect(and(true, false)).toBe(false);
    expect(and(false, false)).toBe(false);
    expect(and(false, undefined)).toBe(false);
    expect(and(undefined, false)).toBe(false);
  });

  it("should return true if both are true", () => {
    expect(and(true, true)).toBe(true);
  });

  it("should return true if one is true and other undefined", () => {
    expect(and(true, undefined)).toBe(true);
    expect(and(undefined, true)).toBe(true);
  });

  it("should return undefined if both undefined", () => {
    expect(and(undefined, undefined)).toBeUndefined();
  });

  it("should be commutative", () => {
    // and(a, b) should equal and(b, a) for all combos
    const vals: (boolean | undefined)[] = [true, false, undefined];
    for (const a of vals) {
      for (const b of vals) {
        expect(and(a, b)).toBe(and(b, a));
      }
    }
  });
});

// =============================================================================
// intersectCapabilities() Tests
// =============================================================================

describe("intersectCapabilities()", () => {
  const fullBase: ParticipantCapabilities = {
    observation: { canObserve: true, canQuery: true },
    messaging: { canSend: true, canReceive: true, canBroadcast: true },
    lifecycle: { canSpawn: true, canRegister: true },
    scopes: { canCreateScopes: true, canManageScopes: true },
    federation: { canFederate: true },
  };

  it("should pass through base unchanged when overlay is empty", () => {
    const result = intersectCapabilities(fullBase, {});

    expect(result.observation?.canObserve).toBe(true);
    expect(result.observation?.canQuery).toBe(true);
    expect(result.messaging?.canSend).toBe(true);
    expect(result.messaging?.canReceive).toBe(true);
    expect(result.messaging?.canBroadcast).toBe(true);
    expect(result.lifecycle?.canSpawn).toBe(true);
    expect(result.lifecycle?.canRegister).toBe(true);
    expect(result.scopes?.canCreateScopes).toBe(true);
    expect(result.scopes?.canManageScopes).toBe(true);
    expect(result.federation?.canFederate).toBe(true);
  });

  it("should deny capabilities when overlay denies them", () => {
    const overlay = {
      messaging: { canSend: false, canReceive: true },
      lifecycle: { canSpawn: false },
    };

    const result = intersectCapabilities(fullBase, overlay);

    expect(result.messaging?.canSend).toBe(false);
    expect(result.messaging?.canReceive).toBe(true);
    expect(result.messaging?.canBroadcast).toBe(true);
    expect(result.lifecycle?.canSpawn).toBe(false);
    expect(result.lifecycle?.canRegister).toBe(true);
    // Unaffected capabilities pass through
    expect(result.observation?.canObserve).toBe(true);
    expect(result.federation?.canFederate).toBe(true);
  });

  it("should deny capabilities when base denies them even if overlay allows", () => {
    const restrictedBase: ParticipantCapabilities = {
      ...fullBase,
      messaging: { canSend: false, canReceive: true },
    };
    const overlay = {
      messaging: { canSend: true, canReceive: true },
    };

    const result = intersectCapabilities(restrictedBase, overlay);

    expect(result.messaging?.canSend).toBe(false);
    expect(result.messaging?.canReceive).toBe(true);
  });

  it("should preserve server-config capabilities (mail, streaming, protocols, acp)", () => {
    const baseWithExtras: ParticipantCapabilities = {
      ...fullBase,
      mail: { enabled: true, canCreate: true },
      streaming: { enabled: true },
      protocols: { supported: ["mcp"] },
      acp: { version: "1.0" },
    };

    const result = intersectCapabilities(baseWithExtras, {
      messaging: { canSend: false },
    });

    expect(result.mail).toEqual({ enabled: true, canCreate: true });
    expect(result.streaming).toEqual({ enabled: true });
    expect(result.protocols).toEqual({ supported: ["mcp"] });
    expect(result.acp).toEqual({ version: "1.0" });
  });

  it("should handle both undefined for a capability group", () => {
    const minimalBase: ParticipantCapabilities = {
      messaging: { canSend: true },
    };
    const result = intersectCapabilities(minimalBase, {});

    expect(result.federation).toBeUndefined();
    expect(result.scopes).toBeUndefined();
    expect(result.observation).toBeUndefined();
    expect(result.lifecycle).toBeUndefined();
  });

  it("should create group when overlay introduces it but base has none", () => {
    const minimalBase: ParticipantCapabilities = {
      messaging: { canSend: true },
    };
    const overlay = {
      federation: { canFederate: true },
    };

    const result = intersectCapabilities(minimalBase, overlay);

    // Federation should appear because overlay has it
    expect(result.federation?.canFederate).toBe(true);
  });

  it("should intersect all lifecycle fields", () => {
    const base: ParticipantCapabilities = {
      lifecycle: {
        canSpawn: true,
        canRegister: true,
        canUnregister: true,
        canSteer: true,
        canStop: true,
      },
    };
    const overlay = {
      lifecycle: {
        canSpawn: false,
        canRegister: true,
        canUnregister: false,
        canSteer: undefined,
        canStop: true,
      },
    };

    const result = intersectCapabilities(base, overlay);

    expect(result.lifecycle?.canSpawn).toBe(false);
    expect(result.lifecycle?.canRegister).toBe(true);
    expect(result.lifecycle?.canUnregister).toBe(false);
    expect(result.lifecycle?.canSteer).toBe(true); // true AND undefined => true
    expect(result.lifecycle?.canStop).toBe(true);
  });

  it("should deny everything when overlay is fully restrictive", () => {
    const overlay = {
      observation: { canObserve: false, canQuery: false },
      messaging: { canSend: false, canReceive: false, canBroadcast: false },
      lifecycle: { canSpawn: false, canRegister: false },
      scopes: { canCreateScopes: false, canManageScopes: false },
      federation: { canFederate: false },
    };

    const result = intersectCapabilities(fullBase, overlay);

    expect(result.observation?.canObserve).toBe(false);
    expect(result.observation?.canQuery).toBe(false);
    expect(result.messaging?.canSend).toBe(false);
    expect(result.messaging?.canReceive).toBe(false);
    expect(result.messaging?.canBroadcast).toBe(false);
    expect(result.lifecycle?.canSpawn).toBe(false);
    expect(result.lifecycle?.canRegister).toBe(false);
    expect(result.scopes?.canCreateScopes).toBe(false);
    expect(result.scopes?.canManageScopes).toBe(false);
    expect(result.federation?.canFederate).toBe(false);
  });

  it("should handle partial overlay groups (undefined fields)", () => {
    const overlay = {
      messaging: { canSend: false },
      // canReceive and canBroadcast are undefined in overlay
    };

    const result = intersectCapabilities(fullBase, overlay);

    expect(result.messaging?.canSend).toBe(false);
    expect(result.messaging?.canReceive).toBe(true);
    expect(result.messaging?.canBroadcast).toBe(true);
  });
});

// =============================================================================
// intersectAgentPermissions() Tests
// =============================================================================

describe("intersectAgentPermissions()", () => {
  it("should take more restrictive agent visibility rule", () => {
    const base: AgentPermissions = {
      canSee: { agents: "all" },
    };
    const overlay = {
      canSee: { agents: "scoped" as const },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canSee?.agents).toBe("scoped");
  });

  it("should take more restrictive scope visibility rule", () => {
    const base: AgentPermissions = {
      canSee: { scopes: "all" },
    };
    const overlay = {
      canSee: { scopes: "member" as const },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canSee?.scopes).toBe("member");
  });

  it("should prefer object (include list) rules as most restrictive", () => {
    const base: AgentPermissions = {
      canSee: { agents: "all" },
    };
    const overlay = {
      canSee: { agents: { include: ["agent-1"] } as any },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canSee?.agents).toEqual({ include: ["agent-1"] });
  });

  it("should prefer object over object — first object wins", () => {
    const base: AgentPermissions = {
      canSee: { agents: { include: ["a"] } as any },
    };
    const overlay = {
      canSee: { agents: { include: ["b"] } as any },
    };

    const result = intersectAgentPermissions(base, overlay);

    // First (base) object wins
    expect(result.canSee?.agents).toEqual({ include: ["a"] });
  });

  it("should handle undefined overlay (passthrough)", () => {
    const base: AgentPermissions = {
      canSee: { agents: "all", scopes: "all" },
      canMessage: { agents: "all" },
    };

    const result = intersectAgentPermissions(base, {});

    expect(result.canSee?.agents).toBe("all");
    expect(result.canSee?.scopes).toBe("all");
    expect(result.canMessage?.agents).toBe("all");
  });

  it("should take more restrictive messaging rule", () => {
    const base: AgentPermissions = {
      canMessage: { agents: "all" },
    };
    const overlay = {
      canMessage: { agents: "hierarchy" as const },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canMessage?.agents).toBe("hierarchy");
  });

  it("should handle structure visibility ordering", () => {
    const base: AgentPermissions = {
      canSee: { structure: "full" },
    };
    const overlay = {
      canSee: { structure: "local" as const },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canSee?.structure).toBe("local");
  });

  it("should handle 'none' → 'full' (none is most restrictive for structure)", () => {
    const base: AgentPermissions = {
      canSee: { structure: "full" },
    };
    const overlay = {
      canSee: { structure: "none" as any },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canSee?.structure).toBe("none");
  });

  it("should handle both undefined for a group", () => {
    const base: AgentPermissions = {};
    const overlay = {};

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canSee).toBeUndefined();
    expect(result.canMessage).toBeUndefined();
    expect(result.acceptsFrom).toBeUndefined();
  });

  it("should preserve same restrictiveness level", () => {
    const base: AgentPermissions = {
      canSee: { agents: "scoped" },
    };
    const overlay = {
      canSee: { agents: "scoped" as const },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canSee?.agents).toBe("scoped");
  });

  it("should intersect acceptsFrom rules", () => {
    const base: AgentPermissions = {
      acceptsFrom: {
        clients: "all",
        systems: "all",
      },
    };
    const overlay = {
      acceptsFrom: {
        clients: "none" as const,
        systems: "none" as const,
      },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.acceptsFrom?.clients).toBe("none");
    expect(result.acceptsFrom?.systems).toBe("none");
  });

  it("should take base when overlay has undefined for a rule", () => {
    const base: AgentPermissions = {
      canSee: { agents: "hierarchy" },
      canMessage: { agents: "scoped" },
    };
    const overlay = {
      canSee: {},
      // canMessage not in overlay at all
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canSee?.agents).toBe("hierarchy");
    expect(result.canMessage?.agents).toBe("scoped");
  });

  it("should handle hierarchy ordering for agent visibility (direct < hierarchy < scoped < all)", () => {
    // direct is most restrictive
    expect(
      intersectAgentPermissions(
        { canSee: { agents: "all" } },
        { canSee: { agents: "direct" as any } }
      ).canSee?.agents
    ).toBe("direct");

    expect(
      intersectAgentPermissions(
        { canSee: { agents: "scoped" } },
        { canSee: { agents: "hierarchy" as any } }
      ).canSee?.agents
    ).toBe("hierarchy");
  });

  it("should handle scope messaging ordering (member < all)", () => {
    const base: AgentPermissions = {
      canMessage: { scopes: "all" },
    };
    const overlay = {
      canMessage: { scopes: "member" as const },
    };

    const result = intersectAgentPermissions(base, overlay);

    expect(result.canMessage?.scopes).toBe("member");
  });
});
