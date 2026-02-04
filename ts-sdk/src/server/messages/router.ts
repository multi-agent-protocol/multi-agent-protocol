/**
 * MessageRouter implementation
 *
 * Routes messages between agents with queuing support for offline delivery.
 */

import type {
  ServerMessage,
  QueuedMessage,
  DeliveryHandler,
  MessageQueueStore,
  MessageRouter,
  MessageRouterOptions,
  EventBus,
  AgentRegistry,
  ScopeManager,
  MessageQueueOptions,
} from "../types";
import { ulid } from "../../utils/ulid";
import { InMemoryMessageQueueStore } from "./stores/in-memory";

/**
 * Default queue options.
 */
const DEFAULT_QUEUE_OPTIONS: Required<MessageQueueOptions> = {
  enabled: true,
  maxPerAgent: 100,
  defaultTtlMs: 60000,
  maxTotal: 10000,
};

/**
 * MessageRouter implementation.
 *
 * Routes messages between agents with:
 * - Direct agent-to-agent messaging
 * - Scope broadcast with optional descendant inclusion
 * - Queuing for offline agents
 * - Priority-based delivery
 * - TTL-based message expiration
 *
 * Events emitted:
 * - message.sent - When a message is created
 * - message.delivered - When a message is delivered to an agent
 * - message.queued - When a message is queued for offline agent
 * - message.expired - When a queued message expires
 */
export class MessageRouterImpl implements MessageRouter {
  private readonly eventBus: EventBus;
  private readonly agents: AgentRegistry;
  private readonly scopes: ScopeManager;
  private readonly queueStore: MessageQueueStore;
  private readonly queueOptions: Required<MessageQueueOptions>;
  private deliveryHandler?: DeliveryHandler;

  constructor(options: MessageRouterOptions) {
    this.eventBus = options.eventBus;
    this.agents = options.agents;
    this.scopes = options.scopes;
    this.queueStore = options.queueStore ?? new InMemoryMessageQueueStore();
    this.queueOptions = {
      ...DEFAULT_QUEUE_OPTIONS,
      ...options.queue,
    };
  }

  /**
   * Send message to a specific agent.
   * @throws Error if validation is enabled and target agent does not exist
   */
  sendToAgent(params: {
    from: string;
    to: string;
    payload: unknown;
    replyTo?: string;
    priority?: number;
    ttlMs?: number;
    /** Optional message type for routing/filtering */
    messageType?: string;
    /** Validate that target agent exists before sending */
    validateTarget?: boolean;
  }): ServerMessage {
    // Validate target agent exists if validation is explicitly enabled
    if (params.validateTarget) {
      const targetAgent = this.agents.get(params.to);
      if (!targetAgent) {
        throw new Error(`Target agent not found: ${params.to}`);
      }
    }

    const message: ServerMessage = {
      id: ulid(),
      from: params.from,
      to: params.to,
      payload: params.payload,
      timestamp: Date.now(),
      replyTo: params.replyTo,
      priority: params.priority,
      ttlMs: params.ttlMs,
      messageType: params.messageType,
    };

    // Emit message.sent event
    this.eventBus.emit({
      type: "message.sent",
      data: { message },
      source: { agentId: params.from },
    });

    // Try to deliver to the target agent
    this.deliverToAgent(params.to, message);

    return message;
  }

  /**
   * Broadcast message to all agents in a scope.
   */
  sendToScope(params: {
    from: string;
    scopeId: string;
    payload: unknown;
    excludeSender?: boolean;
    includeDescendants?: boolean;
    /** Optional message type for routing/filtering */
    messageType?: string;
  }): ServerMessage {
    const message: ServerMessage = {
      id: ulid(),
      from: params.from,
      to: params.scopeId,
      payload: params.payload,
      timestamp: Date.now(),
      messageType: params.messageType,
    };

    // Emit message.sent event
    this.eventBus.emit({
      type: "message.sent",
      data: { message, scopeId: params.scopeId },
      source: { agentId: params.from, scopeId: params.scopeId },
    });

    // Get all members in the scope
    const members = this.scopes.getMembers(params.scopeId, {
      includeDescendants: params.includeDescendants ?? false,
    });

    // Deliver to each member
    for (const agentId of members) {
      // Skip sender if requested
      if (params.excludeSender && agentId === params.from) {
        continue;
      }

      this.deliverToAgent(agentId, message);
    }

    return message;
  }

  /**
   * Set the delivery handler callback.
   */
  onDeliver(handler: DeliveryHandler): void {
    this.deliveryHandler = handler;
  }

  /**
   * Flush queued messages for an agent (call when agent reconnects).
   * @returns Number of messages delivered
   */
  flushQueue(agentId: string): number {
    if (!this.queueOptions.enabled) {
      return 0;
    }

    const queuedMessages = this.queueStore.dequeue(agentId);
    let deliveredCount = 0;

    for (const queued of queuedMessages) {
      // Check if message has expired
      if (queued.expiresAt <= Date.now()) {
        this.eventBus.emit({
          type: "message.expired",
          data: { messageId: queued.message.id, agentId },
        });
        continue;
      }

      // Deliver the message
      if (this.deliveryHandler) {
        this.deliveryHandler(agentId, queued.message);
        this.eventBus.emit({
          type: "message.delivered",
          data: { message: queued.message, agentId },
        });
        deliveredCount++;
      }
    }

    return deliveredCount;
  }

  /**
   * Get queue statistics.
   */
  getQueueStats(): {
    total: number;
    byAgent: Record<string, number>;
  } {
    const store = this.queueStore as InMemoryMessageQueueStore;
    return {
      total: this.queueStore.getTotalSize(),
      byAgent: store.getQueueSizesByAgent?.() ?? {},
    };
  }

  /**
   * Deliver a message to an agent, queuing if offline.
   */
  private deliverToAgent(agentId: string, message: ServerMessage): void {
    const agent = this.agents.get(agentId);
    const isOnline = agent && agent.state !== "stopped";

    if (isOnline && this.deliveryHandler) {
      // Agent is online - deliver immediately
      this.deliveryHandler(agentId, message);
      this.eventBus.emit({
        type: "message.delivered",
        data: { message, agentId },
      });
    } else if (this.queueOptions.enabled) {
      // Agent is offline - queue the message
      this.queueMessage(agentId, message);
    }
  }

  /**
   * Queue a message for later delivery.
   * @returns true if message was queued, false if dropped
   */
  private queueMessage(agentId: string, message: ServerMessage): boolean {
    // Check total queue limit
    if (this.queueStore.getTotalSize() >= this.queueOptions.maxTotal) {
      // Queue is full - run expiration and try again
      this.queueStore.expireOld();

      if (this.queueStore.getTotalSize() >= this.queueOptions.maxTotal) {
        // Still full after expiration - drop the message and emit event
        this.eventBus.emit({
          type: "message.dropped",
          data: {
            messageId: message.id,
            from: message.from,
            to: agentId,
            reason: "queue_full",
            queueSize: this.queueStore.getTotalSize(),
            maxTotal: this.queueOptions.maxTotal,
          },
        });
        return false;
      }
    }

    // Check per-agent limit
    if (this.queueStore.getQueueSize(agentId) >= this.queueOptions.maxPerAgent) {
      // Agent queue is full - drop the message and emit event
      this.eventBus.emit({
        type: "message.dropped",
        data: {
          messageId: message.id,
          from: message.from,
          to: agentId,
          reason: "agent_queue_full",
          agentQueueSize: this.queueStore.getQueueSize(agentId),
          maxPerAgent: this.queueOptions.maxPerAgent,
        },
      });
      return false;
    }

    const ttlMs = message.ttlMs ?? this.queueOptions.defaultTtlMs;
    const now = Date.now();

    const queuedMessage: QueuedMessage = {
      message,
      targetAgentId: agentId,
      queuedAt: now,
      expiresAt: now + ttlMs,
      attempts: 0,
    };

    this.queueStore.enqueue(queuedMessage);

    this.eventBus.emit({
      type: "message.queued",
      data: { messageId: message.id, agentId, expiresAt: queuedMessage.expiresAt },
    });

    return true;
  }

  /**
   * Expire old messages from the queue.
   * @returns Number of messages expired
   */
  expireMessages(): number {
    const expiredCount = this.queueStore.expireOld();

    if (expiredCount > 0) {
      this.eventBus.emit({
        type: "message.expired",
        data: { count: expiredCount },
      });
    }

    return expiredCount;
  }
}
