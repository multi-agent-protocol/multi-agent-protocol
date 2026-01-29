/**
 * Tests for server ResourceCleaner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResourceCleanerImpl } from "../server/cleanup";
import { EventBusImpl } from "../server/events";
import { AgentRegistryImpl } from "../server/agents";
import { SessionManagerImpl } from "../server/sessions";
import { SubscriptionManagerImpl } from "../server/subscriptions";
import { ScopeManagerImpl } from "../server/scopes";
import { MessageRouterImpl } from "../server/messages";

describe("ResourceCleanerImpl", () => {
  let eventBus: EventBusImpl;
  let agents: AgentRegistryImpl;
  let sessions: SessionManagerImpl;
  let subscriptions: SubscriptionManagerImpl;
  let scopes: ScopeManagerImpl;
  let messages: MessageRouterImpl;
  let cleaner: ResourceCleanerImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    agents = new AgentRegistryImpl({ eventBus });
    sessions = new SessionManagerImpl({ eventBus });
    scopes = new ScopeManagerImpl({ eventBus });
    subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
    messages = new MessageRouterImpl({ eventBus, agents, scopes });

    cleaner = new ResourceCleanerImpl({
      sessions,
      agents,
      subscriptions,
      messages,
      thresholds: {
        sessionDisconnectMs: 100, // Short for testing
        sessionInactiveMs: 1000,
        intervalMs: 0, // Manual only
      },
    });
  });

  afterEach(() => {
    cleaner.stop();
  });

  describe("run", () => {
    it("should expire stale disconnected sessions", async () => {
      // Create and disconnect a session
      const session = sessions.create({ role: "client" });
      sessions.disconnect(session.id);

      // Wait for session to become stale
      await new Promise((r) => setTimeout(r, 150));

      const stats = await cleaner.run();

      expect(stats.sessionsExpired).toBe(1);
      expect(sessions.get(session.id)?.status).toBe("expired");
    });

    it("should unregister orphaned agents", async () => {
      const session = sessions.create({ role: "agent" });
      const agent = agents.register({ name: "Test Agent", sessionId: session.id });

      sessions.disconnect(session.id);
      await new Promise((r) => setTimeout(r, 150));

      const stats = await cleaner.run();

      expect(stats.agentsUnregistered).toBe(1);
      expect(agents.get(agent.id)).toBeUndefined();
    });

    it("should cancel orphaned subscriptions", async () => {
      const session = sessions.create({ role: "client" });
      const sub = subscriptions.create({
        sessionId: session.id,
        filter: {},
      });

      sessions.disconnect(session.id);
      await new Promise((r) => setTimeout(r, 150));

      const stats = await cleaner.run();

      expect(stats.subscriptionsCancelled).toBe(1);
      expect(subscriptions.get(sub.id)).toBeUndefined();
    });

    it("should expire old queued messages", async () => {
      // Create router with short TTL
      const shortTtlMessages = new MessageRouterImpl({
        eventBus,
        agents,
        scopes,
        queue: { defaultTtlMs: 10 },
      });

      const shortTtlCleaner = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages: shortTtlMessages,
        thresholds: { intervalMs: 0 },
      });

      // Queue a message
      shortTtlMessages.sendToAgent({
        from: "sender",
        to: "offline-agent",
        payload: {},
      });

      // Wait for message to expire
      await new Promise((r) => setTimeout(r, 50));

      const stats = await shortTtlCleaner.run();

      expect(stats.messagesExpired).toBe(1);
    });

    it("should return zero stats when nothing to clean", async () => {
      const stats = await cleaner.run();

      expect(stats.sessionsExpired).toBe(0);
      expect(stats.agentsUnregistered).toBe(0);
      expect(stats.subscriptionsCancelled).toBe(0);
      expect(stats.messagesExpired).toBe(0);
    });
  });

  describe("strategy callbacks", () => {
    it("should call onStaleSession for each expired session", async () => {
      const onStaleSession = vi.fn();
      const strategyClener = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages,
        thresholds: { sessionDisconnectMs: 10, intervalMs: 0 },
        strategy: { onStaleSession },
      });

      const session = sessions.create({ role: "client" });
      sessions.disconnect(session.id);
      await new Promise((r) => setTimeout(r, 50));

      await strategyClener.run();

      expect(onStaleSession).toHaveBeenCalled();
    });

    it("should call onOrphanedAgent for each unregistered agent", async () => {
      const onOrphanedAgent = vi.fn();
      const strategyClener = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages,
        thresholds: { sessionDisconnectMs: 10, intervalMs: 0 },
        strategy: { onOrphanedAgent },
      });

      const session = sessions.create({ role: "agent" });
      agents.register({ name: "Agent", sessionId: session.id });
      sessions.disconnect(session.id);
      await new Promise((r) => setTimeout(r, 50));

      await strategyClener.run();

      expect(onOrphanedAgent).toHaveBeenCalled();
    });

    it("should call onOrphanedSubscription for each cancelled subscription", async () => {
      const onOrphanedSubscription = vi.fn();
      const strategyClener = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages,
        thresholds: { sessionDisconnectMs: 10, intervalMs: 0 },
        strategy: { onOrphanedSubscription },
      });

      const session = sessions.create({ role: "client" });
      subscriptions.create({ sessionId: session.id, filter: {} });
      sessions.disconnect(session.id);
      await new Promise((r) => setTimeout(r, 50));

      await strategyClener.run();

      expect(onOrphanedSubscription).toHaveBeenCalled();
    });

    it("should call onExpiredMessages with count", async () => {
      const onExpiredMessages = vi.fn();
      const shortTtlMessages = new MessageRouterImpl({
        eventBus,
        agents,
        scopes,
        queue: { defaultTtlMs: 10 },
      });

      const strategyClener = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages: shortTtlMessages,
        thresholds: { intervalMs: 0 },
        strategy: { onExpiredMessages },
      });

      shortTtlMessages.sendToAgent({
        from: "sender",
        to: "offline-agent",
        payload: {},
      });
      await new Promise((r) => setTimeout(r, 50));

      await strategyClener.run();

      expect(onExpiredMessages).toHaveBeenCalledWith(1);
    });
  });

  describe("start and stop", () => {
    it("should start automatic cleanup interval", async () => {
      const intervalCleaner = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages,
        thresholds: { intervalMs: 50 },
      });

      expect(intervalCleaner.running).toBe(false);

      intervalCleaner.start();

      expect(intervalCleaner.running).toBe(true);

      intervalCleaner.stop();

      expect(intervalCleaner.running).toBe(false);
    });

    it("should not start if intervalMs is 0", () => {
      cleaner.start();

      expect(cleaner.running).toBe(false);
    });

    it("should run cleanup on interval", async () => {
      const runSpy = vi.spyOn(
        ResourceCleanerImpl.prototype,
        "run"
      );

      const intervalCleaner = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages,
        thresholds: { intervalMs: 30 },
      });

      intervalCleaner.start();

      await new Promise((r) => setTimeout(r, 100));

      intervalCleaner.stop();

      // Should have run at least once
      expect(runSpy).toHaveBeenCalled();

      runSpy.mockRestore();
    });

    it("should be idempotent for start/stop", () => {
      const intervalCleaner = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages,
        thresholds: { intervalMs: 100 },
      });

      intervalCleaner.start();
      intervalCleaner.start(); // Should not throw

      intervalCleaner.stop();
      intervalCleaner.stop(); // Should not throw
    });
  });

  describe("default thresholds", () => {
    it("should use default values when not specified", () => {
      const defaultCleaner = new ResourceCleanerImpl({
        sessions,
        agents,
        subscriptions,
        messages,
      });

      // Create a session, disconnect, and verify it's not immediately expired
      const session = sessions.create({ role: "client" });
      sessions.disconnect(session.id);

      // Run immediately - should not expire with default 5 minute threshold
      defaultCleaner.run();

      expect(sessions.get(session.id)?.status).toBe("disconnected");
    });
  });
});
