/**
 * Tests for address utilities
 */

import { describe, it, expect } from "vitest";
import {
  formatAddress,
  parseAddress,
  isAddress,
  isAgentAddress,
  isScopeAddress,
  extractId,
  extractType,
  toAgent,
  toScope,
  InvalidAddressError,
} from "../server/messages";

describe("Address Utilities", () => {
  describe("formatAddress", () => {
    it("should format agent address correctly", () => {
      const address = formatAddress("agent", "abc123");
      expect(address).toBe("agent:abc123");
    });

    it("should format scope address correctly", () => {
      const address = formatAddress("scope", "room-1");
      expect(address).toBe("scope:room-1");
    });

    it("should throw if id is empty", () => {
      expect(() => {
        formatAddress("agent", "");
      }).toThrow(InvalidAddressError);
    });

    it("should throw if id contains colon", () => {
      expect(() => {
        formatAddress("agent", "abc:123");
      }).toThrow(InvalidAddressError);
    });
  });

  describe("parseAddress", () => {
    it("should parse agent address correctly", () => {
      const result = parseAddress("agent:abc123");
      expect(result).toEqual({
        type: "agent",
        id: "abc123",
      });
    });

    it("should parse scope address correctly", () => {
      const result = parseAddress("scope:room-1");
      expect(result).toEqual({
        type: "scope",
        id: "room-1",
      });
    });

    it("should parse address with complex id", () => {
      const result = parseAddress("agent:user-123-abc");
      expect(result).toEqual({
        type: "agent",
        id: "user-123-abc",
      });
    });

    it("should throw for missing prefix", () => {
      expect(() => {
        parseAddress("abc123");
      }).toThrow(InvalidAddressError);
    });

    it("should throw for invalid type", () => {
      expect(() => {
        parseAddress("invalid:abc123");
      }).toThrow(InvalidAddressError);
    });

    it("should throw for empty id", () => {
      expect(() => {
        parseAddress("agent:");
      }).toThrow(InvalidAddressError);
    });

    it("should allow federated IDs in the id portion", () => {
      // When sending to a remote agent, the full address might be:
      // agent:system-west:agent:agent-123
      // This should parse as type=agent, id=system-west:agent:agent-123
      const result = parseAddress("agent:system-west:agent:agent-123");
      expect(result).toEqual({
        type: "agent",
        id: "system-west:agent:agent-123",
      });
    });
  });

  describe("isAddress", () => {
    it("should return true for valid agent address", () => {
      expect(isAddress("agent:abc123")).toBe(true);
    });

    it("should return true for valid scope address", () => {
      expect(isAddress("scope:room-1")).toBe(true);
    });

    it("should return false for plain ID (no prefix)", () => {
      expect(isAddress("abc123")).toBe(false);
    });

    it("should return false for invalid type", () => {
      expect(isAddress("invalid:abc123")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isAddress("")).toBe(false);
    });
  });

  describe("isAgentAddress", () => {
    it("should return true for agent address", () => {
      expect(isAgentAddress("agent:abc123")).toBe(true);
    });

    it("should return false for scope address", () => {
      expect(isAgentAddress("scope:room-1")).toBe(false);
    });

    it("should return false for plain ID", () => {
      expect(isAgentAddress("abc123")).toBe(false);
    });
  });

  describe("isScopeAddress", () => {
    it("should return true for scope address", () => {
      expect(isScopeAddress("scope:room-1")).toBe(true);
    });

    it("should return false for agent address", () => {
      expect(isScopeAddress("agent:abc123")).toBe(false);
    });

    it("should return false for plain ID", () => {
      expect(isScopeAddress("room-1")).toBe(false);
    });
  });

  describe("extractId", () => {
    it("should extract id from agent address", () => {
      expect(extractId("agent:abc123")).toBe("abc123");
    });

    it("should extract id from scope address", () => {
      expect(extractId("scope:room-1")).toBe("room-1");
    });

    it("should return original if not prefixed", () => {
      expect(extractId("plain-id")).toBe("plain-id");
    });

    it("should preserve federated ID in extracted id", () => {
      expect(extractId("agent:system-west:agent:abc123")).toBe("system-west:agent:abc123");
    });
  });

  describe("extractType", () => {
    it("should extract type from agent address", () => {
      expect(extractType("agent:abc123")).toBe("agent");
    });

    it("should extract type from scope address", () => {
      expect(extractType("scope:room-1")).toBe("scope");
    });

    it("should return undefined if not prefixed", () => {
      expect(extractType("plain-id")).toBeUndefined();
    });

    it("should return undefined for invalid type", () => {
      expect(extractType("invalid:abc123")).toBeUndefined();
    });
  });

  describe("toAgent", () => {
    it("should create agent address", () => {
      expect(toAgent("abc123")).toBe("agent:abc123");
    });

    it("should create agent address with complex id", () => {
      expect(toAgent("user-123-abc")).toBe("agent:user-123-abc");
    });
  });

  describe("toScope", () => {
    it("should create scope address", () => {
      expect(toScope("room-1")).toBe("scope:room-1");
    });

    it("should create scope address with complex id", () => {
      expect(toScope("team-a-channel-1")).toBe("scope:team-a-channel-1");
    });
  });
});
