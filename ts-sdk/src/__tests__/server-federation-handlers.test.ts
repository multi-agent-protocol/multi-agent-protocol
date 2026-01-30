/**
 * Tests for federation handlers
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  FederationGatewayImpl,
  createFederationHandlers,
  FederationError,
  FederationPermissionError,
  type PeerTransport,
} from "../server/federation";
import type { HandlerContext, ServerSession } from "../server/types";

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

describe("createFederationHandlers", () => {
  let gateway: FederationGatewayImpl;
  let handlers: ReturnType<typeof createFederationHandlers>;

  beforeEach(() => {
    gateway = new FederationGatewayImpl({
      systemId: "system-a",
      buffer: { maxMessages: 100 },
    });
    handlers = createFederationHandlers({ gateway });
  });

  describe("map/federation/connect", () => {
    it("should connect to peer system", async () => {
      const ctx = createMockContext("gateway");
      const result = await handlers["map/federation/connect"](
        { systemId: "system-b", endpoint: "wss://b.example.com" },
        ctx
      );

      expect(result.systemId).toBe("system-b");
      expect(result.endpoint).toBe("wss://b.example.com");
      expect(result.status).toBe("connected");
    });

    it("should require gateway role", async () => {
      const ctx = createMockContext("client");

      await expect(
        handlers["map/federation/connect"](
          { systemId: "system-b", endpoint: "wss://b.example.com" },
          ctx
        )
      ).rejects.toThrow(FederationPermissionError);
    });

    it("should require systemId", async () => {
      const ctx = createMockContext("gateway");

      await expect(
        handlers["map/federation/connect"](
          { systemId: "", endpoint: "wss://b.example.com" },
          ctx
        )
      ).rejects.toThrow("systemId is required");
    });

    it("should require endpoint", async () => {
      const ctx = createMockContext("gateway");

      await expect(
        handlers["map/federation/connect"](
          { systemId: "system-b", endpoint: "" },
          ctx
        )
      ).rejects.toThrow("endpoint is required");
    });
  });

  describe("map/federation/disconnect", () => {
    it("should disconnect from peer", async () => {
      const ctx = createMockContext("gateway");

      // First connect
      await handlers["map/federation/connect"](
        { systemId: "system-b", endpoint: "wss://b.example.com" },
        ctx
      );

      // Then disconnect
      await handlers["map/federation/disconnect"](
        { systemId: "system-b" },
        ctx
      );

      const peers = await handlers["map/federation/list"]({}, ctx);
      expect(peers).toHaveLength(0);
    });

    it("should require gateway role", async () => {
      const ctx = createMockContext("agent");

      await expect(
        handlers["map/federation/disconnect"]({ systemId: "system-b" }, ctx)
      ).rejects.toThrow(FederationPermissionError);
    });

    it("should require systemId", async () => {
      const ctx = createMockContext("gateway");

      await expect(
        handlers["map/federation/disconnect"]({ systemId: "" }, ctx)
      ).rejects.toThrow("systemId is required");
    });
  });

  describe("map/federation/list", () => {
    it("should list connected peers", async () => {
      const ctx = createMockContext("gateway");

      await handlers["map/federation/connect"](
        { systemId: "system-b", endpoint: "wss://b.example.com" },
        ctx
      );
      await handlers["map/federation/connect"](
        { systemId: "system-c", endpoint: "wss://c.example.com" },
        ctx
      );

      const peers = await handlers["map/federation/list"]({}, ctx);

      expect(peers).toHaveLength(2);
      expect(peers.map((p: any) => p.systemId).sort()).toEqual(["system-b", "system-c"]);
    });

    it("should require gateway role", async () => {
      const ctx = createMockContext("client");

      await expect(
        handlers["map/federation/list"]({}, ctx)
      ).rejects.toThrow(FederationPermissionError);
    });
  });

  describe("map/federation/route", () => {
    it("should route message to connected peer", async () => {
      const mockTransport: PeerTransport = {
        send: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };

      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
        transport: mockTransport,
      });

      const ctx = createMockContext("gateway");
      const result = await handlers["map/federation/route"](
        { systemId: "system-b", payload: { type: "test" } },
        ctx
      );

      expect(result.queued).toBe(false);
      expect(mockTransport.send).toHaveBeenCalled();
    });

    it("should queue message if peer not connected", async () => {
      const ctx = createMockContext("gateway");
      const result = await handlers["map/federation/route"](
        { systemId: "system-b", payload: { type: "test" } },
        ctx
      );

      expect(result.queued).toBe(true);

      const stats = await handlers["map/federation/buffer/stats"]({}, ctx);
      expect(stats.bySystem["system-b"]).toBe(1);
    });

    it("should require gateway role", async () => {
      const ctx = createMockContext("agent");

      await expect(
        handlers["map/federation/route"](
          { systemId: "system-b", payload: {} },
          ctx
        )
      ).rejects.toThrow(FederationPermissionError);
    });

    it("should require systemId", async () => {
      const ctx = createMockContext("gateway");

      await expect(
        handlers["map/federation/route"](
          { systemId: "", payload: {} },
          ctx
        )
      ).rejects.toThrow("systemId is required");
    });

    it("should require payload", async () => {
      const ctx = createMockContext("gateway");

      await expect(
        handlers["map/federation/route"](
          { systemId: "system-b", payload: undefined },
          ctx
        )
      ).rejects.toThrow("payload is required");
    });
  });

  describe("map/federation/buffer/stats", () => {
    it("should return buffer statistics", async () => {
      const ctx = createMockContext("gateway");

      // Queue some messages
      await handlers["map/federation/route"](
        { systemId: "system-b", payload: { msg: 1 } },
        ctx
      );
      await handlers["map/federation/route"](
        { systemId: "system-b", payload: { msg: 2 } },
        ctx
      );
      await handlers["map/federation/route"](
        { systemId: "system-c", payload: { msg: 3 } },
        ctx
      );

      const stats = await handlers["map/federation/buffer/stats"]({}, ctx);

      expect(stats.total).toBe(3);
      expect(stats.bySystem["system-b"]).toBe(2);
      expect(stats.bySystem["system-c"]).toBe(1);
    });

    it("should require gateway role", async () => {
      const ctx = createMockContext("client");

      await expect(
        handlers["map/federation/buffer/stats"]({}, ctx)
      ).rejects.toThrow(FederationPermissionError);
    });
  });

  describe("map/federation/buffer/flush", () => {
    it("should flush buffered messages", async () => {
      const ctx = createMockContext("gateway");

      // Queue some messages
      await handlers["map/federation/route"](
        { systemId: "system-b", payload: { msg: 1 } },
        ctx
      );
      await handlers["map/federation/route"](
        { systemId: "system-b", payload: { msg: 2 } },
        ctx
      );

      const result = await handlers["map/federation/buffer/flush"](
        { systemId: "system-b" },
        ctx
      );

      expect(result.count).toBe(2);

      // Buffer should be empty now
      const stats = await handlers["map/federation/buffer/stats"]({}, ctx);
      expect(stats.bySystem["system-b"]).toBeUndefined();
    });

    it("should require gateway role", async () => {
      const ctx = createMockContext("agent");

      await expect(
        handlers["map/federation/buffer/flush"]({ systemId: "system-b" }, ctx)
      ).rejects.toThrow(FederationPermissionError);
    });

    it("should require systemId", async () => {
      const ctx = createMockContext("gateway");

      await expect(
        handlers["map/federation/buffer/flush"]({ systemId: "" }, ctx)
      ).rejects.toThrow("systemId is required");
    });
  });

  describe("error handling", () => {
    it("FederationError should have correct code", () => {
      const error = new FederationError("test error", -32001);
      expect(error.message).toBe("test error");
      expect(error.code).toBe(-32001);
      expect(error.name).toBe("FederationError");
    });

    it("FederationPermissionError should have correct code", () => {
      const error = new FederationPermissionError();
      expect(error.code).toBe(-32003);
      expect(error.name).toBe("FederationPermissionError");
    });
  });
});
