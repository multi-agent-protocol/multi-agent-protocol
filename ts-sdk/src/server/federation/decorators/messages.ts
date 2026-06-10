/**
 * FederatedMessageRouter decorator
 *
 * Wraps a MessageRouter to add federation capabilities.
 */

import type {
  MessageRouter,
  ServerMessage,
  DeliveryHandler,
  FederatedMessageRouterOptions,
  FederationGateway,
  AgentRegistry,
} from "../../types";
import {
  formatFederatedId,
  parseFederatedId,
  isFederatedAgent,
} from "../federated-id";

/**
 * FederatedMessageRouter decorator.
 *
 * Wraps a local MessageRouter and adds federation capabilities:
 * - Routes messages to remote agents via the gateway
 * - Handles incoming messages from peers
 * - Determines if targets are local or remote
 *
 * @example
 * ```typescript
 * const local = new MessageRouterImpl({ eventBus, agents, scopes });
 * const federated = new FederatedMessageRouter({
 *   local,
 *   gateway,
 *   agents: federatedAgentRegistry, // Should be a FederatedAgentRegistry
 * });
 *
 * // Routes automatically to correct destination
 * federated.sendToAgent({
 *   from: "local-agent",
 *   to: "system-b:agent:agent-1", // Goes via gateway
 *   payload: { text: "Hello!" },
 * });
 * ```
 */
export class FederatedMessageRouter implements MessageRouter {
  private readonly local: MessageRouter;
  private readonly gateway: FederationGateway;
  private readonly agents: AgentRegistry;
  private readonly deliveryHandlers: Set<DeliveryHandler> = new Set();

  constructor(options: FederatedMessageRouterOptions) {
    this.local = options.local;
    this.gateway = options.gateway;
    this.agents = options.agents;

    // Listen for incoming peer messages
    this.gateway.onPeerMessage(this.handlePeerMessage.bind(this));

    // Forward local delivery events
    this.local.onDeliver((agentId, message) => {
      for (const handler of this.deliveryHandlers) {
        try {
          handler(agentId, message);
        } catch (error) {
          console.error("FederatedMessageRouter delivery handler error:", error);
        }
      }
    });
  }

  /**
   * Send to a specific agent.
   * Routes to remote system if target is a remote agent.
   */
  sendToAgent(params: {
    from: string;
    to: string;
    payload: unknown;
    replyTo?: string;
    priority?: number;
    ttlMs?: number;
  }): ServerMessage {
    // Check if target is remote
    if (this.isRemoteAgent(params.to)) {
      return this.sendToRemoteAgent(params);
    }

    // Local delivery
    return this.local.sendToAgent(params);
  }

  /**
   * Broadcast to all agents in a scope.
   * Only sends to local scope members.
   */
  sendToScope(params: {
    from: string;
    scopeId: string;
    payload: unknown;
    excludeSender?: boolean;
    includeDescendants?: boolean;
  }): ServerMessage {
    // For now, only local scope broadcast is supported
    // Cross-system scope membership would need additional tracking
    return this.local.sendToScope(params);
  }

  /**
   * Set delivery callback.
   */
  onDeliver(handler: DeliveryHandler): void {
    this.deliveryHandlers.add(handler);
  }

  /**
   * Remove delivery callback.
   */
  offDeliver(handler: DeliveryHandler): void {
    this.deliveryHandlers.delete(handler);
  }

  /**
   * Flush queued messages for an agent.
   */
  flushQueue(agentId: string): number {
    // Can't flush remote agent queues
    if (this.isRemoteAgent(agentId)) {
      return 0;
    }

    return this.local.flushQueue(agentId);
  }

  /**
   * Get queue stats.
   */
  getQueueStats(): { total: number; byAgent: Record<string, number> } {
    return this.local.getQueueStats();
  }

  /**
   * Check if an agent ID refers to a remote agent.
   * Uses the standardized federated ID format: {systemId}:agent:{entityId}
   */
  isRemoteAgent(agentId: string): boolean {
    return isFederatedAgent(agentId);
  }

  /**
   * Parse remote agent ID to get system and original agent ID.
   * Uses the standardized federated ID format: {systemId}:agent:{entityId}
   */
  parseRemoteAgentId(remoteId: string): { systemId: string; originalId: string } | null {
    if (!isFederatedAgent(remoteId)) {
      return null;
    }

    try {
      const parsed = parseFederatedId(remoteId);
      return {
        systemId: parsed.systemId,
        originalId: parsed.entityId,
      };
    } catch {
      return null;
    }
  }

  /**
   * Send message to a remote agent via the gateway.
   */
  private sendToRemoteAgent(params: {
    from: string;
    to: string;
    payload: unknown;
    replyTo?: string;
    priority?: number;
    ttlMs?: number;
  }): ServerMessage {
    const parsed = this.parseRemoteAgentId(params.to);
    if (!parsed) {
      throw new Error(`Invalid remote agent ID: ${params.to}`);
    }

    // Create message object
    const message: ServerMessage = {
      id: this.generateMessageId(),
      from: params.from,
      to: params.to,
      payload: params.payload,
      timestamp: Date.now(),
      replyTo: params.replyTo,
      priority: params.priority ?? 0,
    };

    // Route via gateway
    const envelope = this.gateway.createEnvelope(parsed.systemId, {
      type: "message",
      message: {
        ...message,
        // Translate the target to original ID for the remote system
        to: parsed.originalId,
      },
    });

    this.gateway.routeToPeer(parsed.systemId, envelope).catch((err) => {
      console.error(`Failed to route message to ${parsed.systemId}:`, err);
    });

    return message;
  }

  /**
   * Handle incoming peer messages.
   */
  private handlePeerMessage(
    from: string,
    envelope: { payload: unknown }
  ): void {
    const payload = envelope.payload as {
      type: string;
      message?: ServerMessage;
    };

    if (payload.type !== "message" || !payload.message) {
      return;
    }

    const message = payload.message;

    // to may be a string or string[] — normalise to string for local lookup
    const toId = Array.isArray(message.to) ? message.to[0] : message.to;

    // Check if target is a local agent
    const localAgent = this.agents.get(toId);
    if (!localAgent) {
      // Target not found locally
      console.warn(`Received federated message for unknown agent: ${toId}`);
      return;
    }

    // Update message with the federated source ID. (ServerMessage has no
    // metadata field, so federation provenance lives only in `from`.)
    const federatedMessage: ServerMessage = {
      ...message,
      from: formatFederatedId(from, "agent", message.from),
    };

    // Deliver locally
    for (const handler of this.deliveryHandlers) {
      try {
        handler(toId, federatedMessage);
      } catch (error) {
        console.error("FederatedMessageRouter delivery handler error:", error);
      }
    }
  }

  /**
   * Generate a unique message ID.
   */
  private generateMessageId(): string {
    // Simple ID generation - in production use ulid or similar
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
