/**
 * Message handler factories
 *
 * Creates JSON-RPC handlers for message-related methods.
 */

import type {
  MessageRouter,
  ScopeManager,
  HandlerContext,
  HandlerRegistry,
} from "../types";

/**
 * Options for creating message handlers.
 */
export interface MessageHandlerOptions {
  messages: MessageRouter;
  scopes: ScopeManager;
}

/**
 * Parameters for sending a message.
 */
interface SendParams {
  to: string | string[];
  payload: unknown;
  replyTo?: string;
  priority?: number;
  ttlMs?: number;
  /** Optional message type for routing/filtering */
  messageType?: string;
}

/**
 * Parameters for sending to a scope.
 */
interface SendToScopeParams {
  scopeId: string;
  payload: unknown;
  excludeSender?: boolean;
  includeDescendants?: boolean;
  /** Optional message type for routing/filtering */
  messageType?: string;
}

/**
 * Create handlers for message-related methods.
 *
 * Methods:
 * - `map/send` - Send a message to agent(s) or scope
 * - `map/send/scope` - Send to all agents in a scope
 */
export function createMessageHandlers(options: MessageHandlerOptions): HandlerRegistry {
  const { messages, scopes } = options;

  return {
    "map/send": async (params: unknown, ctx: HandlerContext) => {
      const { to, payload, replyTo, priority, ttlMs, messageType } = params as SendParams;

      // Determine sender - use first agent from session, or session ID
      const from = ctx.session.agentIds[0] ?? ctx.session.id;

      // Handle array of recipients
      if (Array.isArray(to)) {
        const results = [];
        for (const recipient of to) {
          const message = messages.sendToAgent({
            from,
            to: recipient,
            payload,
            replyTo,
            priority,
            ttlMs,
            messageType,
          });
          results.push(message.id);
        }
        // Return protocol-compliant response
        return { messageId: results[0], delivered: results };
      }

      // Check if 'to' is a scope ID by trying to get it
      const scope = scopes.get(to);
      if (scope) {
        // Send to scope
        const message = messages.sendToScope({
          from,
          scopeId: to,
          payload,
          excludeSender: true,
          messageType,
        });
        // Return protocol-compliant response
        return { messageId: message.id };
      }

      // Send to single agent
      const message = messages.sendToAgent({
        from,
        to,
        payload,
        replyTo,
        priority,
        ttlMs,
        messageType,
      });

      // Return protocol-compliant response
      return { messageId: message.id };
    },

    "map/send/scope": async (params: unknown, ctx: HandlerContext) => {
      const { scopeId, payload, excludeSender, includeDescendants, messageType } =
        params as SendToScopeParams;

      const from = ctx.session.agentIds[0] ?? ctx.session.id;

      const message = messages.sendToScope({
        from,
        scopeId,
        payload,
        excludeSender: excludeSender ?? true,
        includeDescendants,
        messageType,
      });

      // Return protocol-compliant response
      return { messageId: message.id };
    },
  };
}
