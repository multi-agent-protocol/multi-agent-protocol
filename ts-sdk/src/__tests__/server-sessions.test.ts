/**
 * Tests for server SessionManager and InMemorySessionStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemorySessionStore,
  SessionManagerImpl,
  type ServerSession,
} from "../server/sessions";
import { EventBusImpl } from "../server/events";

describe("InMemorySessionStore", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  const createSession = (overrides: Partial<ServerSession> = {}): ServerSession => ({
    id: "session-1",
    role: "agent",
    status: "connected",
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    metadata: {},
    agentIds: [],
    subscriptionIds: [],
    ...overrides,
  });

  describe("save and get", () => {
    it("should store and retrieve a session", () => {
      const session = createSession();
      store.save(session);

      expect(store.get(session.id)).toEqual(session);
    });

    it("should return undefined for unknown ID", () => {
      expect(store.get("unknown")).toBeUndefined();
    });
  });

  describe("getByResumeToken", () => {
    it("should find session by resume token", () => {
      const session = createSession({ resumeToken: "token-123" });
      store.save(session);

      expect(store.getByResumeToken("token-123")).toEqual(session);
    });

    it("should return undefined for unknown token", () => {
      expect(store.getByResumeToken("unknown")).toBeUndefined();
    });

    it("should update token index when session is updated", () => {
      const session = createSession({ resumeToken: "token-old" });
      store.save(session);

      const updated = { ...session, resumeToken: "token-new" };
      store.save(updated);

      expect(store.getByResumeToken("token-old")).toBeUndefined();
      expect(store.getByResumeToken("token-new")).toEqual(updated);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      store.save(createSession({ id: "s1", role: "agent", status: "connected" }));
      store.save(createSession({ id: "s2", role: "client", status: "connected" }));
      store.save(createSession({ id: "s3", role: "agent", status: "disconnected" }));
    });

    it("should return all sessions with no filter", () => {
      expect(store.list()).toHaveLength(3);
    });

    it("should filter by role", () => {
      const agents = store.list({ role: "agent" });
      expect(agents).toHaveLength(2);
    });

    it("should filter by status", () => {
      const connected = store.list({ status: "connected" });
      expect(connected).toHaveLength(2);
    });

    it("should combine filters", () => {
      const result = store.list({ role: "agent", status: "connected" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("s1");
    });
  });

  describe("delete", () => {
    it("should remove session and clean up token index", () => {
      const session = createSession({ resumeToken: "token-123" });
      store.save(session);

      expect(store.delete(session.id)).toBe(true);
      expect(store.get(session.id)).toBeUndefined();
      expect(store.getByResumeToken("token-123")).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("should remove all sessions", () => {
      store.save(createSession({ id: "s1", resumeToken: "t1" }));
      store.save(createSession({ id: "s2", resumeToken: "t2" }));

      store.clear();

      expect(store.size).toBe(0);
      expect(store.getByResumeToken("t1")).toBeUndefined();
    });
  });
});

describe("SessionManagerImpl", () => {
  let eventBus: EventBusImpl;
  let manager: SessionManagerImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    manager = new SessionManagerImpl({ eventBus });
  });

  describe("create", () => {
    it("should create session with ULID", () => {
      const session = manager.create({ role: "agent" });

      expect(session.id).toBeDefined();
      expect(session.id.length).toBe(26);
      expect(session.role).toBe("agent");
      expect(session.status).toBe("connected");
    });

    it("should set optional fields", () => {
      const session = manager.create({
        role: "client",
        name: "Test Client",
        metadata: { foo: "bar" },
      });

      expect(session.name).toBe("Test Client");
      expect(session.metadata).toEqual({ foo: "bar" });
    });

    it("should emit session.connected event", () => {
      const handler = vi.fn();
      eventBus.on("session.connected", handler);

      const session = manager.create({ role: "agent" });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.connected",
          data: { session },
        })
      );
    });

    it("should initialize arrays empty", () => {
      const session = manager.create({ role: "agent" });

      expect(session.agentIds).toEqual([]);
      expect(session.subscriptionIds).toEqual([]);
    });
  });

  describe("disconnect", () => {
    it("should mark session as disconnected", () => {
      const session = manager.create({ role: "agent" });
      manager.disconnect(session.id);

      const updated = manager.get(session.id);
      expect(updated?.status).toBe("disconnected");
      expect(updated?.disconnectedAt).toBeDefined();
    });

    it("should return resume token", () => {
      const session = manager.create({ role: "agent" });
      const token = manager.disconnect(session.id);

      expect(token).toBeDefined();
      expect(token).toMatch(/^resume_/);
    });

    it("should emit session.disconnected event", () => {
      const handler = vi.fn();
      eventBus.on("session.disconnected", handler);

      const session = manager.create({ role: "agent" });
      const token = manager.disconnect(session.id);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.disconnected",
          data: { sessionId: session.id, resumeToken: token },
        })
      );
    });

    it("should return existing token if already disconnected", () => {
      const session = manager.create({ role: "agent" });
      const token1 = manager.disconnect(session.id);
      const token2 = manager.disconnect(session.id);

      expect(token2).toBe(token1);
    });

    it("should return undefined for unknown session", () => {
      expect(manager.disconnect("unknown")).toBeUndefined();
    });
  });

  describe("resume", () => {
    it("should resume disconnected session", () => {
      const session = manager.create({ role: "agent" });
      const token = manager.disconnect(session.id)!;

      const result = manager.resume(token);

      expect(result.success).toBe(true);
      expect(result.session?.status).toBe("connected");
      expect(result.session?.resumeToken).toBeUndefined();
    });

    it("should emit session.resumed event", () => {
      const handler = vi.fn();
      eventBus.on("session.resumed", handler);

      const session = manager.create({ role: "agent" });
      const token = manager.disconnect(session.id)!;
      manager.resume(token);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "session.resumed",
          data: expect.objectContaining({
            session: expect.objectContaining({ id: session.id }),
          }),
        })
      );
    });

    it("should fail for unknown token", () => {
      const result = manager.resume("unknown-token");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_found");
    });

    it("should fail for expired session", () => {
      // Create manager with very short resume window
      const shortManager = new SessionManagerImpl({
        eventBus,
        resumeWindowMs: 1,
      });

      const session = shortManager.create({ role: "agent" });
      const token = shortManager.disconnect(session.id)!;

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = shortManager.resume(token);
          expect(result.success).toBe(false);
          expect(result.reason).toBe("expired");
          resolve();
        }, 10);
      });
    });

    it("should return session if already connected", () => {
      const session = manager.create({ role: "agent" });
      const token = manager.disconnect(session.id)!;
      manager.resume(token);

      // Store the session with the token again for testing
      // (In practice this won't happen, but we test the edge case)
      const result = manager.resume(token);

      // Token was cleared, so should fail
      expect(result.success).toBe(false);
    });
  });

  describe("close", () => {
    it("should remove session permanently", () => {
      const session = manager.create({ role: "agent" });
      const closed = manager.close(session.id);

      expect(closed).toEqual(session);
      expect(manager.get(session.id)).toBeUndefined();
    });

    it("should return undefined for unknown session", () => {
      expect(manager.close("unknown")).toBeUndefined();
    });
  });

  describe("expireStale", () => {
    it("should expire disconnected sessions past threshold", async () => {
      const handler = vi.fn();
      eventBus.on("session.expired", handler);

      const session = manager.create({ role: "agent" });
      manager.disconnect(session.id);

      // Small delay to ensure disconnectedAt is in the past
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Expire with very short threshold
      const expired = manager.expireStale(1);

      expect(expired).toContain(session.id);
      expect(manager.get(session.id)?.status).toBe("expired");
      expect(handler).toHaveBeenCalled();
    });

    it("should not expire sessions within threshold", () => {
      const session = manager.create({ role: "agent" });
      manager.disconnect(session.id);

      // Very long threshold
      const expired = manager.expireStale(999999999);

      expect(expired).toHaveLength(0);
      expect(manager.get(session.id)?.status).toBe("disconnected");
    });

    it("should not affect connected sessions", () => {
      const session = manager.create({ role: "agent" });

      const expired = manager.expireStale(0);

      expect(expired).toHaveLength(0);
      expect(manager.get(session.id)?.status).toBe("connected");
    });
  });

  describe("agent tracking", () => {
    it("should add agent to session", () => {
      const session = manager.create({ role: "agent" });
      manager.addAgent(session.id, "agent-1");

      expect(manager.get(session.id)?.agentIds).toContain("agent-1");
    });

    it("should not duplicate agents", () => {
      const session = manager.create({ role: "agent" });
      manager.addAgent(session.id, "agent-1");
      manager.addAgent(session.id, "agent-1");

      expect(manager.get(session.id)?.agentIds).toHaveLength(1);
    });

    it("should remove agent from session", () => {
      const session = manager.create({ role: "agent" });
      manager.addAgent(session.id, "agent-1");
      manager.addAgent(session.id, "agent-2");
      manager.removeAgent(session.id, "agent-1");

      const updated = manager.get(session.id);
      expect(updated?.agentIds).not.toContain("agent-1");
      expect(updated?.agentIds).toContain("agent-2");
    });
  });

  describe("subscription tracking", () => {
    it("should add subscription to session", () => {
      const session = manager.create({ role: "client" });
      manager.addSubscription(session.id, "sub-1");

      expect(manager.get(session.id)?.subscriptionIds).toContain("sub-1");
    });

    it("should remove subscription from session", () => {
      const session = manager.create({ role: "client" });
      manager.addSubscription(session.id, "sub-1");
      manager.removeSubscription(session.id, "sub-1");

      expect(manager.get(session.id)?.subscriptionIds).not.toContain("sub-1");
    });
  });

  describe("touch", () => {
    it("should update lastActivity timestamp", () => {
      const session = manager.create({ role: "agent" });
      const originalActivity = session.lastActivity;

      // Wait a bit to ensure different timestamp
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          manager.touch(session.id);
          const updated = manager.get(session.id);
          expect(updated?.lastActivity).toBeGreaterThan(originalActivity);
          resolve();
        }, 10);
      });
    });

    it("should do nothing for unknown session", () => {
      expect(() => manager.touch("unknown")).not.toThrow();
    });
  });
});
