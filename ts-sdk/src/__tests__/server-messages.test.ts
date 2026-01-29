/**
 * Tests for server MessageRouter and InMemoryMessageQueueStore
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InMemoryMessageQueueStore,
  MessageRouterImpl,
  type ServerMessage,
  type QueuedMessage,
} from "../server/messages";
import { EventBusImpl } from "../server/events";
import { AgentRegistryImpl } from "../server/agents";
import { ScopeManagerImpl } from "../server/scopes";

describe("InMemoryMessageQueueStore", () => {
  let store: InMemoryMessageQueueStore;

  beforeEach(() => {
    store = new InMemoryMessageQueueStore();
  });

  const createQueuedMessage = (
    overrides: Partial<QueuedMessage> = {}
  ): QueuedMessage => ({
    message: {
      id: `msg-${Math.random().toString(36).slice(2)}`,
      from: "agent-sender",
      to: "agent-target",
      payload: { text: "hello" },
      timestamp: Date.now(),
    },
    targetAgentId: "agent-target",
    queuedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    attempts: 0,
    ...overrides,
  });

  describe("enqueue and dequeue", () => {
    it("should enqueue and dequeue messages", () => {
      const msg = createQueuedMessage();
      store.enqueue(msg);

      const dequeued = store.dequeue("agent-target");
      expect(dequeued).toHaveLength(1);
      expect(dequeued[0].message.id).toBe(msg.message.id);
    });

    it("should return empty array for unknown agent", () => {
      expect(store.dequeue("unknown")).toEqual([]);
    });

    it("should respect limit parameter", () => {
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));

      const dequeued = store.dequeue("agent-1", 2);
      expect(dequeued).toHaveLength(2);
      expect(store.getQueueSize("agent-1")).toBe(1);
    });

    it("should maintain FIFO order for same priority", () => {
      const msg1 = createQueuedMessage({
        targetAgentId: "agent-1",
        queuedAt: 1000,
      });
      const msg2 = createQueuedMessage({
        targetAgentId: "agent-1",
        queuedAt: 2000,
      });
      const msg3 = createQueuedMessage({
        targetAgentId: "agent-1",
        queuedAt: 3000,
      });

      store.enqueue(msg1);
      store.enqueue(msg2);
      store.enqueue(msg3);

      const dequeued = store.dequeue("agent-1");
      expect(dequeued[0].message.id).toBe(msg1.message.id);
      expect(dequeued[1].message.id).toBe(msg2.message.id);
      expect(dequeued[2].message.id).toBe(msg3.message.id);
    });

    it("should order by priority (lower number = higher priority)", () => {
      const lowPriority = createQueuedMessage({
        targetAgentId: "agent-1",
        message: {
          id: "low",
          from: "sender",
          to: "agent-1",
          payload: {},
          timestamp: Date.now(),
          priority: 10,
        },
      });
      const highPriority = createQueuedMessage({
        targetAgentId: "agent-1",
        message: {
          id: "high",
          from: "sender",
          to: "agent-1",
          payload: {},
          timestamp: Date.now(),
          priority: 1,
        },
      });
      const medPriority = createQueuedMessage({
        targetAgentId: "agent-1",
        message: {
          id: "med",
          from: "sender",
          to: "agent-1",
          payload: {},
          timestamp: Date.now(),
          priority: 5,
        },
      });

      store.enqueue(lowPriority);
      store.enqueue(highPriority);
      store.enqueue(medPriority);

      const dequeued = store.dequeue("agent-1");
      expect(dequeued[0].message.id).toBe("high");
      expect(dequeued[1].message.id).toBe("med");
      expect(dequeued[2].message.id).toBe("low");
    });
  });

  describe("peek", () => {
    it("should return messages without removing them", () => {
      const msg = createQueuedMessage();
      store.enqueue(msg);

      const peeked = store.peek("agent-target");
      expect(peeked).toHaveLength(1);
      expect(store.getQueueSize("agent-target")).toBe(1);
    });

    it("should respect limit parameter", () => {
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));

      const peeked = store.peek("agent-1", 2);
      expect(peeked).toHaveLength(2);
      expect(store.getQueueSize("agent-1")).toBe(3);
    });
  });

  describe("remove", () => {
    it("should remove a specific message", () => {
      const msg = createQueuedMessage();
      store.enqueue(msg);

      expect(store.remove(msg.message.id)).toBe(true);
      expect(store.getQueueSize("agent-target")).toBe(0);
    });

    it("should return false for unknown message", () => {
      expect(store.remove("unknown")).toBe(false);
    });
  });

  describe("getQueueSize and getTotalSize", () => {
    it("should return correct sizes", () => {
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-2" }));

      expect(store.getQueueSize("agent-1")).toBe(2);
      expect(store.getQueueSize("agent-2")).toBe(1);
      expect(store.getTotalSize()).toBe(3);
    });
  });

  describe("expireOld", () => {
    it("should remove expired messages", () => {
      const expired = createQueuedMessage({
        targetAgentId: "agent-1",
        expiresAt: Date.now() - 1000,
      });
      const valid = createQueuedMessage({
        targetAgentId: "agent-1",
        expiresAt: Date.now() + 60000,
      });

      store.enqueue(expired);
      store.enqueue(valid);

      const expiredCount = store.expireOld();
      expect(expiredCount).toBe(1);
      expect(store.getTotalSize()).toBe(1);
    });
  });

  describe("clear", () => {
    it("should remove all messages", () => {
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-1" }));
      store.enqueue(createQueuedMessage({ targetAgentId: "agent-2" }));

      store.clear();
      expect(store.getTotalSize()).toBe(0);
    });
  });
});

describe("MessageRouterImpl", () => {
  let eventBus: EventBusImpl;
  let agents: AgentRegistryImpl;
  let scopes: ScopeManagerImpl;
  let router: MessageRouterImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    agents = new AgentRegistryImpl({ eventBus });
    scopes = new ScopeManagerImpl({ eventBus });
    router = new MessageRouterImpl({
      eventBus,
      agents,
      scopes,
    });
  });

  describe("sendToAgent", () => {
    it("should create message with ULID", () => {
      const message = router.sendToAgent({
        from: "sender",
        to: "receiver",
        payload: { text: "hello" },
      });

      expect(message.id).toBeDefined();
      expect(message.id.length).toBe(26);
      expect(message.from).toBe("sender");
      expect(message.to).toBe("receiver");
      expect(message.payload).toEqual({ text: "hello" });
    });

    it("should emit message.sent event", () => {
      const handler = vi.fn();
      eventBus.on("message.sent", handler);

      router.sendToAgent({
        from: "sender",
        to: "receiver",
        payload: {},
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "message.sent",
          data: expect.objectContaining({
            message: expect.objectContaining({
              from: "sender",
              to: "receiver",
            }),
          }),
        })
      );
    });

    it("should deliver to online agent via handler", () => {
      const deliveryHandler = vi.fn();
      router.onDeliver(deliveryHandler);

      // Register an online agent
      const agent = agents.register({
        name: "Receiver",
        sessionId: "session-1",
      });

      router.sendToAgent({
        from: "sender",
        to: agent.id,
        payload: { text: "hello" },
      });

      expect(deliveryHandler).toHaveBeenCalledWith(
        agent.id,
        expect.objectContaining({
          from: "sender",
          payload: { text: "hello" },
        })
      );
    });

    it("should emit message.delivered for online agent", () => {
      const handler = vi.fn();
      eventBus.on("message.delivered", handler);
      router.onDeliver(() => {});

      const agent = agents.register({
        name: "Receiver",
        sessionId: "session-1",
      });

      router.sendToAgent({
        from: "sender",
        to: agent.id,
        payload: {},
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "message.delivered",
          data: expect.objectContaining({
            agentId: agent.id,
          }),
        })
      );
    });

    it("should queue message for offline agent", () => {
      const deliveryHandler = vi.fn();
      router.onDeliver(deliveryHandler);

      const queuedHandler = vi.fn();
      eventBus.on("message.queued", queuedHandler);

      // Send to non-existent agent
      router.sendToAgent({
        from: "sender",
        to: "offline-agent",
        payload: {},
      });

      expect(deliveryHandler).not.toHaveBeenCalled();
      expect(queuedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "message.queued",
          data: expect.objectContaining({
            agentId: "offline-agent",
          }),
        })
      );
    });

    it("should include optional fields", () => {
      const message = router.sendToAgent({
        from: "sender",
        to: "receiver",
        payload: {},
        replyTo: "original-msg-id",
        priority: 1,
        ttlMs: 30000,
      });

      expect(message.replyTo).toBe("original-msg-id");
      expect(message.priority).toBe(1);
      expect(message.ttlMs).toBe(30000);
    });

    it("should include messageType when provided", () => {
      const message = router.sendToAgent({
        from: "sender",
        to: "receiver",
        payload: { data: "test" },
        messageType: "request",
      });

      expect(message.messageType).toBe("request");
    });

    it("should emit message with messageType in event", () => {
      const handler = vi.fn();
      eventBus.on("message.sent", handler);

      router.sendToAgent({
        from: "sender",
        to: "receiver",
        payload: {},
        messageType: "command",
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: expect.objectContaining({
              messageType: "command",
            }),
          }),
        })
      );
    });

    it("should not include messageType when not provided", () => {
      const message = router.sendToAgent({
        from: "sender",
        to: "receiver",
        payload: {},
      });

      expect(message.messageType).toBeUndefined();
    });
  });

  describe("sendToScope", () => {
    it("should broadcast to all scope members", () => {
      const scope = scopes.create({ name: "Test Scope" });
      const agent1 = agents.register({ name: "Agent 1", sessionId: "s1" });
      const agent2 = agents.register({ name: "Agent 2", sessionId: "s2" });

      scopes.join(scope.id, agent1.id);
      scopes.join(scope.id, agent2.id);

      const deliveryHandler = vi.fn();
      router.onDeliver(deliveryHandler);

      router.sendToScope({
        from: "external-sender",
        scopeId: scope.id,
        payload: { announcement: "hello all" },
      });

      expect(deliveryHandler).toHaveBeenCalledTimes(2);
      expect(deliveryHandler).toHaveBeenCalledWith(agent1.id, expect.anything());
      expect(deliveryHandler).toHaveBeenCalledWith(agent2.id, expect.anything());
    });

    it("should exclude sender when requested", () => {
      const scope = scopes.create({ name: "Test Scope" });
      const sender = agents.register({ name: "Sender", sessionId: "s1" });
      const receiver = agents.register({ name: "Receiver", sessionId: "s2" });

      scopes.join(scope.id, sender.id);
      scopes.join(scope.id, receiver.id);

      const deliveryHandler = vi.fn();
      router.onDeliver(deliveryHandler);

      router.sendToScope({
        from: sender.id,
        scopeId: scope.id,
        payload: {},
        excludeSender: true,
      });

      expect(deliveryHandler).toHaveBeenCalledTimes(1);
      expect(deliveryHandler).toHaveBeenCalledWith(receiver.id, expect.anything());
    });

    it("should include descendants when requested", () => {
      const parentScope = scopes.create({ name: "Parent" });
      const childScope = scopes.create({ name: "Child", parentId: parentScope.id });

      const parentAgent = agents.register({ name: "Parent Agent", sessionId: "s1" });
      const childAgent = agents.register({ name: "Child Agent", sessionId: "s2" });

      scopes.join(parentScope.id, parentAgent.id);
      scopes.join(childScope.id, childAgent.id);

      const deliveryHandler = vi.fn();
      router.onDeliver(deliveryHandler);

      router.sendToScope({
        from: "external",
        scopeId: parentScope.id,
        payload: {},
        includeDescendants: true,
      });

      expect(deliveryHandler).toHaveBeenCalledTimes(2);
    });

    it("should not include descendants by default", () => {
      const parentScope = scopes.create({ name: "Parent" });
      const childScope = scopes.create({ name: "Child", parentId: parentScope.id });

      const parentAgent = agents.register({ name: "Parent Agent", sessionId: "s1" });
      const childAgent = agents.register({ name: "Child Agent", sessionId: "s2" });

      scopes.join(parentScope.id, parentAgent.id);
      scopes.join(childScope.id, childAgent.id);

      const deliveryHandler = vi.fn();
      router.onDeliver(deliveryHandler);

      router.sendToScope({
        from: "external",
        scopeId: parentScope.id,
        payload: {},
      });

      expect(deliveryHandler).toHaveBeenCalledTimes(1);
      expect(deliveryHandler).toHaveBeenCalledWith(parentAgent.id, expect.anything());
    });

    it("should include messageType when provided", () => {
      const scope = scopes.create({ name: "Test Scope" });

      const message = router.sendToScope({
        from: "sender",
        scopeId: scope.id,
        payload: { text: "broadcast" },
        messageType: "announcement",
      });

      expect(message.messageType).toBe("announcement");
    });
  });

  describe("flushQueue", () => {
    it("should deliver queued messages when agent comes online", () => {
      // Send messages to offline agent
      router.sendToAgent({ from: "sender", to: "agent-1", payload: { n: 1 } });
      router.sendToAgent({ from: "sender", to: "agent-1", payload: { n: 2 } });

      // Set up delivery handler
      const deliveryHandler = vi.fn();
      router.onDeliver(deliveryHandler);

      // Flush the queue
      const delivered = router.flushQueue("agent-1");

      expect(delivered).toBe(2);
      expect(deliveryHandler).toHaveBeenCalledTimes(2);
    });

    it("should emit message.delivered events", () => {
      router.sendToAgent({ from: "sender", to: "agent-1", payload: {} });

      const handler = vi.fn();
      eventBus.on("message.delivered", handler);

      router.onDeliver(() => {});
      router.flushQueue("agent-1");

      expect(handler).toHaveBeenCalled();
    });

    it("should skip expired messages", async () => {
      // Create router with short TTL
      const shortTtlRouter = new MessageRouterImpl({
        eventBus,
        agents,
        scopes,
        queue: { defaultTtlMs: 10 },
      });

      shortTtlRouter.sendToAgent({ from: "sender", to: "agent-1", payload: {} });

      // Wait for message to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      const deliveryHandler = vi.fn();
      shortTtlRouter.onDeliver(deliveryHandler);

      const expiredHandler = vi.fn();
      eventBus.on("message.expired", expiredHandler);

      const delivered = shortTtlRouter.flushQueue("agent-1");

      expect(delivered).toBe(0);
      expect(deliveryHandler).not.toHaveBeenCalled();
      expect(expiredHandler).toHaveBeenCalled();
    });

    it("should return 0 when queuing is disabled", () => {
      const noQueueRouter = new MessageRouterImpl({
        eventBus,
        agents,
        scopes,
        queue: { enabled: false },
      });

      noQueueRouter.sendToAgent({ from: "sender", to: "agent-1", payload: {} });
      noQueueRouter.onDeliver(() => {});

      const delivered = noQueueRouter.flushQueue("agent-1");
      expect(delivered).toBe(0);
    });
  });

  describe("getQueueStats", () => {
    it("should return queue statistics", () => {
      router.sendToAgent({ from: "sender", to: "agent-1", payload: {} });
      router.sendToAgent({ from: "sender", to: "agent-1", payload: {} });
      router.sendToAgent({ from: "sender", to: "agent-2", payload: {} });

      const stats = router.getQueueStats();

      expect(stats.total).toBe(3);
      expect(stats.byAgent["agent-1"]).toBe(2);
      expect(stats.byAgent["agent-2"]).toBe(1);
    });
  });

  describe("queue limits", () => {
    it("should respect maxPerAgent limit", () => {
      const limitedRouter = new MessageRouterImpl({
        eventBus,
        agents,
        scopes,
        queue: { maxPerAgent: 2 },
      });

      limitedRouter.sendToAgent({ from: "sender", to: "agent-1", payload: { n: 1 } });
      limitedRouter.sendToAgent({ from: "sender", to: "agent-1", payload: { n: 2 } });
      limitedRouter.sendToAgent({ from: "sender", to: "agent-1", payload: { n: 3 } });

      const stats = limitedRouter.getQueueStats();
      expect(stats.byAgent["agent-1"]).toBe(2);
    });

    it("should respect maxTotal limit", () => {
      const limitedRouter = new MessageRouterImpl({
        eventBus,
        agents,
        scopes,
        queue: { maxTotal: 3 },
      });

      limitedRouter.sendToAgent({ from: "sender", to: "agent-1", payload: {} });
      limitedRouter.sendToAgent({ from: "sender", to: "agent-2", payload: {} });
      limitedRouter.sendToAgent({ from: "sender", to: "agent-3", payload: {} });
      limitedRouter.sendToAgent({ from: "sender", to: "agent-4", payload: {} });

      const stats = limitedRouter.getQueueStats();
      expect(stats.total).toBe(3);
    });
  });

  describe("priority delivery", () => {
    it("should deliver high priority messages first when flushing", () => {
      router.sendToAgent({
        from: "sender",
        to: "agent-1",
        payload: { order: "low" },
        priority: 10,
      });
      router.sendToAgent({
        from: "sender",
        to: "agent-1",
        payload: { order: "high" },
        priority: 1,
      });
      router.sendToAgent({
        from: "sender",
        to: "agent-1",
        payload: { order: "med" },
        priority: 5,
      });

      const deliveredMessages: ServerMessage[] = [];
      router.onDeliver((_, msg) => {
        deliveredMessages.push(msg);
      });

      router.flushQueue("agent-1");

      expect(deliveredMessages[0].payload).toEqual({ order: "high" });
      expect(deliveredMessages[1].payload).toEqual({ order: "med" });
      expect(deliveredMessages[2].payload).toEqual({ order: "low" });
    });
  });

  describe("expireMessages", () => {
    it("should expire old messages", async () => {
      const shortTtlRouter = new MessageRouterImpl({
        eventBus,
        agents,
        scopes,
        queue: { defaultTtlMs: 10 },
      });

      shortTtlRouter.sendToAgent({ from: "sender", to: "agent-1", payload: {} });

      await new Promise((resolve) => setTimeout(resolve, 20));

      const expiredHandler = vi.fn();
      eventBus.on("message.expired", expiredHandler);

      const expired = (shortTtlRouter as any).expireMessages();

      expect(expired).toBe(1);
      expect(expiredHandler).toHaveBeenCalled();
    });
  });
});
