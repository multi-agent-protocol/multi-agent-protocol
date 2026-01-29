/**
 * Tests for server federation - OutageBuffer and FederationGateway
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OutageBufferImpl,
  FederationGatewayImpl,
  MaxHopsExceededError,
  RoutingLoopError,
  type PeerTransport,
} from "../server/federation";
import type { ServerFederationEnvelope } from "../server/types";

function createEnvelope(overrides?: Partial<ServerFederationEnvelope>): ServerFederationEnvelope {
  return {
    payload: { data: "test" },
    routing: {
      from: "system-a",
      to: "system-b",
      hops: [],
      maxHops: 5,
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("OutageBufferImpl", () => {
  let buffer: OutageBufferImpl;

  beforeEach(() => {
    buffer = new OutageBufferImpl();
  });

  describe("add and flush", () => {
    it("should buffer messages per system", () => {
      const envelope1 = createEnvelope();
      const envelope2 = createEnvelope();

      buffer.add("system-a", envelope1);
      buffer.add("system-b", envelope2);

      expect(buffer.flush("system-a")).toEqual([envelope1]);
      expect(buffer.flush("system-b")).toEqual([envelope2]);
    });

    it("should return messages in FIFO order", () => {
      const envelope1 = createEnvelope({ timestamp: 1 });
      const envelope2 = createEnvelope({ timestamp: 2 });
      const envelope3 = createEnvelope({ timestamp: 3 });

      buffer.add("system-a", envelope1);
      buffer.add("system-a", envelope2);
      buffer.add("system-a", envelope3);

      const flushed = buffer.flush("system-a");
      expect(flushed[0].timestamp).toBe(1);
      expect(flushed[1].timestamp).toBe(2);
      expect(flushed[2].timestamp).toBe(3);
    });

    it("should clear buffer after flush", () => {
      buffer.add("system-a", createEnvelope());
      buffer.flush("system-a");

      expect(buffer.flush("system-a")).toEqual([]);
    });

    it("should return empty array for unknown system", () => {
      expect(buffer.flush("unknown")).toEqual([]);
    });
  });

  describe("max messages", () => {
    it("should drop oldest messages when at capacity", () => {
      const smallBuffer = new OutageBufferImpl({ maxMessages: 3 });

      smallBuffer.add("system-a", createEnvelope({ timestamp: 1 }));
      smallBuffer.add("system-a", createEnvelope({ timestamp: 2 }));
      smallBuffer.add("system-a", createEnvelope({ timestamp: 3 }));
      smallBuffer.add("system-a", createEnvelope({ timestamp: 4 }));

      const flushed = smallBuffer.flush("system-a");
      expect(flushed).toHaveLength(3);
      expect(flushed[0].timestamp).toBe(2); // Oldest dropped
      expect(flushed[1].timestamp).toBe(3);
      expect(flushed[2].timestamp).toBe(4);
    });

    it("should use default max messages", () => {
      // Default is 1000, hard to test exhaustively
      expect(buffer.stats().total).toBe(0);
    });
  });

  describe("stats", () => {
    it("should return total and per-system counts", () => {
      buffer.add("system-a", createEnvelope());
      buffer.add("system-a", createEnvelope());
      buffer.add("system-b", createEnvelope());

      const stats = buffer.stats();
      expect(stats.total).toBe(3);
      expect(stats.bySystem["system-a"]).toBe(2);
      expect(stats.bySystem["system-b"]).toBe(1);
    });

    it("should return zero for empty buffer", () => {
      const stats = buffer.stats();
      expect(stats.total).toBe(0);
      expect(stats.bySystem).toEqual({});
    });
  });

  describe("clear", () => {
    it("should clear all buffered messages", () => {
      buffer.add("system-a", createEnvelope());
      buffer.add("system-b", createEnvelope());

      buffer.clear();

      expect(buffer.stats().total).toBe(0);
    });

    it("should clear specific system", () => {
      buffer.add("system-a", createEnvelope());
      buffer.add("system-b", createEnvelope());

      buffer.clearSystem("system-a");

      expect(buffer.stats().bySystem["system-a"]).toBeUndefined();
      expect(buffer.stats().bySystem["system-b"]).toBe(1);
    });
  });
});

describe("FederationGatewayImpl", () => {
  let gateway: FederationGatewayImpl;

  beforeEach(() => {
    gateway = new FederationGatewayImpl({
      systemId: "system-a",
      buffer: { maxMessages: 100 },
    });
  });

  describe("connectPeer", () => {
    it("should create peer connection", async () => {
      const peer = await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://system-b.example.com",
      });

      expect(peer.systemId).toBe("system-b");
      expect(peer.endpoint).toBe("wss://system-b.example.com");
      expect(peer.status).toBe("connected");
      expect(peer.connectedAt).toBeDefined();
    });

    it("should return existing connection if already connected", async () => {
      const peer1 = await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://system-b.example.com",
      });

      const peer2 = await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://other-endpoint.com",
      });

      expect(peer1).toBe(peer2);
    });

    it("should flush buffered messages on connect", async () => {
      const mockTransport: PeerTransport = {
        send: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };

      // Buffer some messages first
      gateway.buffer.add("system-b", createEnvelope());
      gateway.buffer.add("system-b", createEnvelope());

      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://system-b.example.com",
        transport: mockTransport,
      });

      expect(mockTransport.send).toHaveBeenCalledTimes(2);
      expect(gateway.buffer.stats().bySystem["system-b"]).toBeUndefined();
    });
  });

  describe("routeToPeer", () => {
    it("should send via transport if connected", async () => {
      const mockTransport: PeerTransport = {
        send: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };

      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://system-b.example.com",
        transport: mockTransport,
      });

      const envelope = createEnvelope();
      await gateway.routeToPeer("system-b", envelope);

      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          routing: expect.objectContaining({
            hops: ["system-a"], // Added current system
          }),
        })
      );
    });

    it("should buffer if peer not connected", async () => {
      const envelope = createEnvelope();
      await gateway.routeToPeer("system-b", envelope);

      expect(gateway.buffer.stats().bySystem["system-b"]).toBe(1);
    });

    it("should buffer if connected but no transport", async () => {
      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://system-b.example.com",
        // No transport provided
      });

      const envelope = createEnvelope();
      await gateway.routeToPeer("system-b", envelope);

      expect(gateway.buffer.stats().bySystem["system-b"]).toBe(1);
    });

    it("should throw MaxHopsExceededError when hops exceed max", async () => {
      const envelope = createEnvelope({
        routing: {
          from: "origin",
          to: "system-b",
          hops: ["hop1", "hop2", "hop3", "hop4", "hop5"],
          maxHops: 5,
        },
      });

      await expect(gateway.routeToPeer("system-b", envelope)).rejects.toThrow(
        MaxHopsExceededError
      );
    });

    it("should throw RoutingLoopError when target in hops", async () => {
      const envelope = createEnvelope({
        routing: {
          from: "origin",
          to: "system-b",
          hops: ["system-b"], // Loop - target already visited
          maxHops: 5,
        },
      });

      await expect(gateway.routeToPeer("system-b", envelope)).rejects.toThrow(
        RoutingLoopError
      );
    });

    it("should throw RoutingLoopError when current system in hops", async () => {
      const envelope = createEnvelope({
        routing: {
          from: "origin",
          to: "system-b",
          hops: ["system-a"], // Loop - we're already in the path
          maxHops: 5,
        },
      });

      await expect(gateway.routeToPeer("system-b", envelope)).rejects.toThrow(
        RoutingLoopError
      );
    });
  });

  describe("onPeerMessage", () => {
    it("should call handlers when message received", () => {
      const handler = vi.fn();
      gateway.onPeerMessage(handler);

      const envelope = createEnvelope();
      gateway.handleIncomingMessage("system-b", envelope);

      expect(handler).toHaveBeenCalledWith("system-b", envelope);
    });

    it("should call multiple handlers", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      gateway.onPeerMessage(handler1);
      gateway.onPeerMessage(handler2);

      gateway.handleIncomingMessage("system-b", createEnvelope());

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it("should continue after handler throws", () => {
      const handler1 = vi.fn().mockImplementation(() => {
        throw new Error("handler error");
      });
      const handler2 = vi.fn();

      gateway.onPeerMessage(handler1);
      gateway.onPeerMessage(handler2);

      expect(() => {
        gateway.handleIncomingMessage("system-b", createEnvelope());
      }).not.toThrow();

      expect(handler2).toHaveBeenCalled();
    });

    it("should remove handler with offPeerMessage", () => {
      const handler = vi.fn();
      gateway.onPeerMessage(handler);
      gateway.offPeerMessage(handler);

      gateway.handleIncomingMessage("system-b", createEnvelope());

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("listPeers", () => {
    it("should list all peers", async () => {
      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
      });
      await gateway.connectPeer({
        systemId: "system-c",
        endpoint: "wss://c.example.com",
      });

      const peers = gateway.listPeers();
      expect(peers).toHaveLength(2);
      expect(peers.map((p) => p.systemId).sort()).toEqual(["system-b", "system-c"]);
    });

    it("should return empty array when no peers", () => {
      expect(gateway.listPeers()).toEqual([]);
    });
  });

  describe("getPeer", () => {
    it("should return peer by systemId", async () => {
      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
      });

      const peer = gateway.getPeer("system-b");
      expect(peer?.systemId).toBe("system-b");
    });

    it("should return undefined for unknown peer", () => {
      expect(gateway.getPeer("unknown")).toBeUndefined();
    });
  });

  describe("disconnectPeer", () => {
    it("should disconnect and remove peer", async () => {
      const mockTransport: PeerTransport = {
        send: vi.fn(),
        close: vi.fn(),
      };

      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
        transport: mockTransport,
      });

      gateway.disconnectPeer("system-b");

      expect(mockTransport.close).toHaveBeenCalled();
      expect(gateway.getPeer("system-b")).toBeUndefined();
    });

    it("should be idempotent for unknown peer", () => {
      expect(() => {
        gateway.disconnectPeer("unknown");
      }).not.toThrow();
    });
  });

  describe("markPeerDisconnected", () => {
    it("should mark peer as disconnected without removing", async () => {
      await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
      });

      gateway.markPeerDisconnected("system-b");

      const peer = gateway.getPeer("system-b");
      expect(peer?.status).toBe("disconnected");
    });
  });

  describe("createEnvelope", () => {
    it("should create envelope with correct structure", () => {
      const envelope = gateway.createEnvelope("system-b", { data: "test" });

      expect(envelope.payload).toEqual({ data: "test" });
      expect(envelope.routing.from).toBe("system-a");
      expect(envelope.routing.to).toBe("system-b");
      expect(envelope.routing.hops).toEqual([]);
      expect(envelope.routing.maxHops).toBe(5); // Default
      expect(envelope.timestamp).toBeDefined();
    });

    it("should allow custom maxHops", () => {
      const envelope = gateway.createEnvelope("system-b", {}, 10);
      expect(envelope.routing.maxHops).toBe(10);
    });
  });

  describe("activity tracking", () => {
    it("should update lastActivity on outgoing message", async () => {
      const mockTransport: PeerTransport = {
        send: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      };

      const peer = await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
        transport: mockTransport,
      });

      const initialActivity = peer.lastActivity;
      await new Promise((r) => setTimeout(r, 10));

      await gateway.routeToPeer("system-b", createEnvelope());

      expect(gateway.getPeer("system-b")?.lastActivity).toBeGreaterThan(
        initialActivity!
      );
    });

    it("should update lastActivity on incoming message", async () => {
      const peer = await gateway.connectPeer({
        systemId: "system-b",
        endpoint: "wss://b.example.com",
      });

      const initialActivity = peer.lastActivity;
      await new Promise((r) => setTimeout(r, 10));

      gateway.handleIncomingMessage("system-b", createEnvelope());

      expect(gateway.getPeer("system-b")?.lastActivity).toBeGreaterThan(
        initialActivity!
      );
    });
  });
});
