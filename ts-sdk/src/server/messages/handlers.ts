/**
 * Message handler factories
 *
 * Creates JSON-RPC handlers for message-related methods.
 */

import type {
  MessageRouter,
  ScopeManager,
  AgentRegistry,
  TurnManager,
  HandlerContext,
  HandlerRegistry,
} from "../types";
import {
  isAddress,
  isScopeAddress,
  extractId,
} from "./address";

// ── Address resolution ─────────────────────────────────────────────────────

/**
 * Resolve the Address union to a routing action.
 *
 * The client SDK's send() method passes the full Address type — a union of
 * string and structured objects (DirectAddress, ScopeAddress, MultiAddress,
 * etc.). The server handler needs to determine the routing target from any
 * variant.
 *
 * Returns a routing action:
 * - { type: 'agent', id: string } — send to single agent
 * - { type: 'agents', ids: string[] } — send to multiple agents
 * - { type: 'scope', id: string } — send to all agents in scope
 * - { type: 'broadcast' } — send to all agents
 * - { type: 'string', value: string } — bare string, needs legacy resolution
 *
 * @see Address type in types/index.ts
 */
type RouteTarget =
  | { type: 'agent'; id: string }
  | { type: 'agents'; ids: string[] }
  | { type: 'scope'; id: string }
  | { type: 'broadcast' }
  | { type: 'string'; value: string };

function resolveRouteTarget(to: unknown): RouteTarget | RouteTarget[] {
  // String address — legacy format, needs further parsing
  if (typeof to === 'string') {
    return { type: 'string', value: to };
  }

  // Array of addresses — resolve each individually
  if (Array.isArray(to)) {
    return to.map(item => resolveRouteTarget(item) as RouteTarget);
  }

  if (to && typeof to === 'object') {
    const obj = to as Record<string, unknown>;

    // DirectAddress: { agent: AgentId }
    if (typeof obj.agent === 'string' && !obj.system) {
      return { type: 'agent', id: obj.agent };
    }

    // MultiAddress: { agents: AgentId[] }
    if (Array.isArray(obj.agents)) {
      return { type: 'agents', ids: obj.agents as string[] };
    }

    // ScopeAddress: { scope: ScopeId }
    if (typeof obj.scope === 'string') {
      return { type: 'scope', id: obj.scope };
    }

    // BroadcastAddress: { broadcast: true }
    if (obj.broadcast === true) {
      return { type: 'broadcast' };
    }

    // RoleAddress: { role: string, within?: ScopeId }
    // Route to the scope if within is specified, otherwise treat as broadcast
    if (typeof obj.role === 'string') {
      if (typeof obj.within === 'string') {
        return { type: 'scope', id: obj.within };
      }
      return { type: 'broadcast' };
    }

    // SystemAddress: { system: true } — route to system/router
    if (obj.system === true) {
      return { type: 'broadcast' };
    }

    // FederatedAddress: { system: string, agent: AgentId }
    if (typeof obj.system === 'string' && typeof obj.agent === 'string') {
      return { type: 'agent', id: obj.agent };
    }

    // ParticipantAddress: { participant?: id, participants?: "all" | "agents" | "clients" }
    if (typeof obj.participant === 'string') {
      return { type: 'agent', id: obj.participant };
    }
    if (obj.participants === 'all' || obj.participants === 'agents') {
      return { type: 'broadcast' };
    }

    // HierarchicalAddress: { parent?, children?, ... }
    // These need session context to resolve — treat as broadcast for now
    if (obj.parent || obj.children || obj.ancestors || obj.descendants || obj.siblings) {
      return { type: 'broadcast' };
    }
  }

  // Fallback — treat unknown as bare string
  return { type: 'string', value: String(to) };
}

// ── Handler options ────────────────────────────────────────────────────────

/**
 * Options for creating message handlers.
 */
export interface MessageHandlerOptions {
  messages: MessageRouter;
  scopes: ScopeManager;
  /**
   * AgentRegistry for validating addresses.
   */
  agents?: AgentRegistry;
  /**
   * Turn manager for mail metadata interception
   */
  turns?: TurnManager;
}

/**
 * Params for the map/send handler (internal).
 */
interface SendParams {
  to: unknown;
  payload?: unknown;
  replyTo?: string;
  priority?: number;
  ttlMs?: number;
  messageType?: string;
  meta?: Record<string, unknown>;
}

/**
 * Params for the map/send/scope handler (internal).
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
  const { messages, scopes, agents, turns } = options;

  /** Send a message to a single agent. */
  function sendToAgent(from: string, to: string, params: SendParams) {
    return messages.sendToAgent({
      from,
      to,
      payload: params.payload,
      replyTo: params.replyTo,
      priority: params.priority,
      ttlMs: params.ttlMs,
      messageType: params.messageType,
    });
  }

  /** Send a message to all agents in a scope. */
  function sendToScope(from: string, scopeId: string, params: SendParams) {
    return messages.sendToScope({
      from,
      scopeId,
      payload: params.payload,
      excludeSender: true,
      messageType: params.messageType,
    });
  }

  /** Resolve a bare string address to either scope or agent. */
  function resolveStringAddress(
    from: string,
    to: string,
    params: SendParams,
  ): { messageId: string } {
    // Check for prefixed addresses (e.g., "agent:abc", "scope:room")
    if (isAddress(to)) {
      if (isScopeAddress(to)) {
        const message = sendToScope(from, extractId(to), params);
        return { messageId: message.id };
      } else {
        const message = sendToAgent(from, extractId(to), params);
        return { messageId: message.id };
      }
    }

    // Bare string — check for ambiguous addresses
    const scope = scopes.get(to);
    const agent = agents?.get(to);

    if (scope && agent) {
      throw new Error(
        `Ambiguous address "${to}" matches both an agent and a scope. ` +
        `Use "agent:${to}" or "scope:${to}" to disambiguate.`
      );
    }

    if (scope) {
      const message = sendToScope(from, to, params);
      return { messageId: message.id };
    }

    // Default: send to agent
    const message = sendToAgent(from, to, params);
    return { messageId: message.id };
  }

  return {
    "map/send": async (params: unknown, ctx: HandlerContext) => {
      const sendParams = params as SendParams;
      const { to: rawTo, meta } = sendParams;

      // Determine sender
      const from = ctx.session.agentIds[0] ?? ctx.session.id;

      // Resolve the Address union to routing targets
      const target = resolveRouteTarget(rawTo);

      let result: { messageId: string; delivered?: string[] };

      // Handle array of targets (from MultiAddress or array of addresses)
      if (Array.isArray(target)) {
        const results: string[] = [];
        for (const t of target) {
          const { messageId } = routeSingle(from, t, sendParams);
          results.push(messageId);
        }
        result = { messageId: results[0], delivered: results };
      } else {
        result = routeSingle(from, target, sendParams);
      }

      // Mail meta interception: record turn if mail metadata present
      if (turns && (meta as any)?.mail?.conversationId) {
        try {
          turns.recordInterceptedTurn({
            conversationId: (meta as any).mail.conversationId,
            participant: from,
            contentType: "data",
            content: sendParams.payload,
            messageId: result.messageId,
            threadId: (meta as any).mail.threadId,
            inReplyTo: (meta as any).mail.inReplyTo,
            visibility: (meta as any).mail.visibility,
          });
        } catch {
          // Non-blocking: turn recording failure does not affect message delivery
        }
      }

      return result;
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

      return { messageId: message.id };
    },
  };

  /** Route a single resolved target to the appropriate send method. */
  function routeSingle(
    from: string,
    target: RouteTarget,
    params: SendParams,
  ): { messageId: string } {
    switch (target.type) {
      case 'agent': {
        const message = sendToAgent(from, target.id, params);
        return { messageId: message.id };
      }
      case 'agents': {
        // Send to each agent individually
        const results: string[] = [];
        for (const agentId of target.ids) {
          const message = sendToAgent(from, agentId, params);
          results.push(message.id);
        }
        return { messageId: results[0] };
      }
      case 'scope': {
        const message = sendToScope(from, target.id, params);
        return { messageId: message.id };
      }
      case 'broadcast': {
        // Broadcast to all scopes the sender is a member of
        // (or use a special broadcast scope if available)
        const message = messages.sendToAgent({
          from,
          to: '*',
          payload: params.payload,
          messageType: params.messageType,
        });
        return { messageId: message.id };
      }
      case 'string': {
        return resolveStringAddress(from, target.value, params);
      }
    }
  }
}
