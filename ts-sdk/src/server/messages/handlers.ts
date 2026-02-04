/**
 * Message handler factories
 *
 * Creates JSON-RPC handlers for message-related methods.
 */

import type {
  MessageRouter,
  ScopeManager,
  AgentRegistry,
  HandlerContext,
  HandlerRegistry,
} from "../types";
import {
  isAddress,
  isAgentAddress,
  isScopeAddress,
  extractId,
} from "./address";

/**
 * Options for creating message handlers.
 */
export interface MessageHandlerOptions {
  messages: MessageRouter;
  scopes: ScopeManager;
  /**
   * AgentRegistry for validating addresses.
   * When provided, ambiguous addresses (valid as both agent and scope) will throw an error.
   */
  agents?: AgentRegistry;
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
  const { messages, scopes, agents } = options;

  return {
    "map/send": async (params: unknown, ctx: HandlerContext) => {
      const { to, payload, replyTo, priority, ttlMs, messageType } = params as SendParams;

      // Determine sender - use first agent from session, or session ID
      const from = ctx.session.agentIds[0] ?? ctx.session.id;

      // Handle array of recipients
      if (Array.isArray(to)) {
        const results = [];
        for (const recipient of to) {
          // Check if recipient has address prefix
          if (isScopeAddress(recipient)) {
            const scopeId = extractId(recipient);
            const message = messages.sendToScope({
              from,
              scopeId,
              payload,
              excludeSender: true,
              messageType,
            });
            results.push(message.id);
          } else {
            // Agent address (with or without prefix)
            const agentId = isAgentAddress(recipient) ? extractId(recipient) : recipient;
            const message = messages.sendToAgent({
              from,
              to: agentId,
              payload,
              replyTo,
              priority,
              ttlMs,
              messageType,
            });
            results.push(message.id);
          }
        }
        // Return protocol-compliant response
        return { messageId: results[0], delivered: results };
      }

      // Handle prefixed addresses
      if (isAddress(to)) {
        if (isScopeAddress(to)) {
          // Prefixed scope address: "scope:room-1"
          const scopeId = extractId(to);
          const message = messages.sendToScope({
            from,
            scopeId,
            payload,
            excludeSender: true,
            messageType,
          });
          return { messageId: message.id };
        } else {
          // Prefixed agent address: "agent:abc123"
          const agentId = extractId(to);
          const message = messages.sendToAgent({
            from,
            to: agentId,
            payload,
            replyTo,
            priority,
            ttlMs,
            messageType,
          });
          return { messageId: message.id };
        }
      }

      // Backward compatibility: unprefixed address
      // Check for ambiguous addresses (valid as both scope and agent)
      const scope = scopes.get(to);
      const agent = agents?.get(to);

      if (scope && agent) {
        // Ambiguous address - throw error requiring explicit prefix
        throw new Error(
          `Ambiguous address "${to}" matches both an agent and a scope. ` +
          `Use "agent:${to}" or "scope:${to}" to disambiguate.`
        );
      }

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

      // Send to single agent (unprefixed)
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
