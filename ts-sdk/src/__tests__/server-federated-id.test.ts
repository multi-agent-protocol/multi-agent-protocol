/**
 * Tests for federated ID utilities
 */

import { describe, it, expect } from "vitest";
import {
  formatFederatedId,
  parseFederatedId,
  isFederatedId,
  isFederatedAgent,
  isFederatedScope,
  isFromSystem,
  extractEntityId,
  extractSystemId,
  InvalidFederatedIdError,
} from "../server/federation";

describe("Federated ID Utilities", () => {
  describe("formatFederatedId", () => {
    it("should format agent ID correctly", () => {
      const id = formatFederatedId("system-west", "agent", "agent-123");
      expect(id).toBe("system-west:agent:agent-123");
    });

    it("should format scope ID correctly", () => {
      const id = formatFederatedId("system-east", "scope", "room-456");
      expect(id).toBe("system-east:scope:room-456");
    });

    it("should format message ID correctly", () => {
      const id = formatFederatedId("system-a", "message", "msg-789");
      expect(id).toBe("system-a:message:msg-789");
    });

    it("should throw if systemId contains colon", () => {
      expect(() => {
        formatFederatedId("system:west", "agent", "agent-123");
      }).toThrow(InvalidFederatedIdError);
    });

    it("should throw if entityId contains colon", () => {
      expect(() => {
        formatFederatedId("system-west", "agent", "agent:123");
      }).toThrow(InvalidFederatedIdError);
    });

    it("should throw if systemId is empty", () => {
      expect(() => {
        formatFederatedId("", "agent", "agent-123");
      }).toThrow(InvalidFederatedIdError);
    });

    it("should throw if entityId is empty", () => {
      expect(() => {
        formatFederatedId("system-west", "agent", "");
      }).toThrow(InvalidFederatedIdError);
    });
  });

  describe("parseFederatedId", () => {
    it("should parse agent ID correctly", () => {
      const result = parseFederatedId("system-west:agent:agent-123");
      expect(result).toEqual({
        systemId: "system-west",
        entityType: "agent",
        entityId: "agent-123",
      });
    });

    it("should parse scope ID correctly", () => {
      const result = parseFederatedId("system-east:scope:room-456");
      expect(result).toEqual({
        systemId: "system-east",
        entityType: "scope",
        entityId: "room-456",
      });
    });

    it("should parse message ID correctly", () => {
      const result = parseFederatedId("system-a:message:msg-789");
      expect(result).toEqual({
        systemId: "system-a",
        entityType: "message",
        entityId: "msg-789",
      });
    });

    it("should throw for invalid format (too few parts)", () => {
      expect(() => {
        parseFederatedId("system-west:agent");
      }).toThrow(InvalidFederatedIdError);
    });

    it("should throw for invalid format (too many parts)", () => {
      expect(() => {
        parseFederatedId("system-west:agent:id:extra");
      }).toThrow(InvalidFederatedIdError);
    });

    it("should throw for empty systemId", () => {
      expect(() => {
        parseFederatedId(":agent:agent-123");
      }).toThrow(InvalidFederatedIdError);
    });

    it("should throw for empty entityId", () => {
      expect(() => {
        parseFederatedId("system-west:agent:");
      }).toThrow(InvalidFederatedIdError);
    });

    it("should throw for invalid entityType", () => {
      expect(() => {
        parseFederatedId("system-west:invalid:agent-123");
      }).toThrow(InvalidFederatedIdError);
    });
  });

  describe("isFederatedId", () => {
    it("should return true for valid federated ID", () => {
      expect(isFederatedId("system-west:agent:agent-123")).toBe(true);
      expect(isFederatedId("system-east:scope:room-456")).toBe(true);
    });

    it("should return false for invalid federated ID", () => {
      expect(isFederatedId("local-agent-123")).toBe(false);
      expect(isFederatedId("system-west:agent")).toBe(false);
      expect(isFederatedId("")).toBe(false);
    });
  });

  describe("isFederatedAgent", () => {
    it("should return true for federated agent ID", () => {
      expect(isFederatedAgent("system-west:agent:agent-123")).toBe(true);
    });

    it("should return false for federated scope ID", () => {
      expect(isFederatedAgent("system-west:scope:room-456")).toBe(false);
    });

    it("should return false for local ID", () => {
      expect(isFederatedAgent("local-agent-123")).toBe(false);
    });
  });

  describe("isFederatedScope", () => {
    it("should return true for federated scope ID", () => {
      expect(isFederatedScope("system-west:scope:room-456")).toBe(true);
    });

    it("should return false for federated agent ID", () => {
      expect(isFederatedScope("system-west:agent:agent-123")).toBe(false);
    });

    it("should return false for local ID", () => {
      expect(isFederatedScope("local-scope-123")).toBe(false);
    });
  });

  describe("isFromSystem", () => {
    it("should return true if ID is from specified system", () => {
      expect(isFromSystem("system-west:agent:agent-123", "system-west")).toBe(true);
    });

    it("should return false if ID is from different system", () => {
      expect(isFromSystem("system-west:agent:agent-123", "system-east")).toBe(false);
    });

    it("should return false for non-federated ID", () => {
      expect(isFromSystem("local-agent-123", "system-west")).toBe(false);
    });
  });

  describe("extractEntityId", () => {
    it("should extract entityId from federated ID", () => {
      expect(extractEntityId("system-west:agent:agent-123")).toBe("agent-123");
    });

    it("should return original ID if not federated", () => {
      expect(extractEntityId("local-agent-123")).toBe("local-agent-123");
    });
  });

  describe("extractSystemId", () => {
    it("should extract systemId from federated ID", () => {
      expect(extractSystemId("system-west:agent:agent-123")).toBe("system-west");
    });

    it("should return undefined if not federated", () => {
      expect(extractSystemId("local-agent-123")).toBeUndefined();
    });
  });
});
