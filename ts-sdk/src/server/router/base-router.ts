/**
 * BaseMAPRouter abstract class
 *
 * Provides default implementations of MAPRouterInterface that delegate
 * to the building blocks. Subclasses can override any method for custom behavior.
 */

import type {
  MAPRouterInterface,
  BaseMAPRouterOptions,
  HandlerContext,
  AgentRegistry,
  ScopeManager,
  SessionManager,
  SubscriptionManager,
  MessageRouter,
  EventBus,
  RegisteredAgent,
  ServerScope,
  ServerSubscription,
  ServerMessage,
  ServerAgentState,
  AgentFilter,
  ScopeFilter,
  SubscriptionFilter,
  ResumeResult,
  MAPEvent,
} from "../types";
import {
  isAddress,
  isAgentAddress,
  isScopeAddress,
  extractId,
} from "../messages/address";

/**
 * Abstract base class implementing MAPRouterInterface.
 *
 * Provides default implementations that delegate to the building blocks.
 * Subclasses can override any method to customize behavior.
 *
 * @example
 * ```typescript
 * class MyRouter extends BaseMAPRouter {
 *   async registerAgent(params, ctx) {
 *     console.log("Registering agent:", params.name);
 *     const agent = await super.registerAgent(params, ctx);
 *     console.log("Agent registered:", agent.id);
 *     return agent;
 *   }
 * }
 * ```
 */
export abstract class BaseMAPRouter implements MAPRouterInterface {
  protected readonly agents: AgentRegistry;
  protected readonly scopes: ScopeManager;
  protected readonly sessions: SessionManager;
  protected readonly subscriptions: SubscriptionManager;
  protected readonly messages: MessageRouter;
  protected readonly eventBus: EventBus;

  constructor(options: BaseMAPRouterOptions) {
    this.agents = options.agents;
    this.scopes = options.scopes;
    this.sessions = options.sessions;
    this.subscriptions = options.subscriptions;
    this.messages = options.messages;
    this.eventBus = options.eventBus;
  }

  // =========================================================================
  // Connection Methods
  // =========================================================================

  async connect(
    _params: unknown,
    ctx: HandlerContext
  ): Promise<{ sessionId: string; resumeToken?: string }> {
    return {
      sessionId: ctx.session.id,
      resumeToken: ctx.session.resumeToken,
    };
  }

  async disconnect(_params: unknown, ctx: HandlerContext): Promise<void> {
    // Disconnect session (makes it resumable)
    // NOTE: We preserve agents, subscriptions, and scope memberships for session resume.
    // They will be reclaimed when the session resumes, or cleaned up by ResourceCleaner
    // if the session expires without resuming.
    this.sessions.disconnect(ctx.session.id);
  }

  async resume(
    params: { resumeToken: string },
    _ctx: HandlerContext
  ): Promise<ResumeResult> {
    return this.sessions.resume(params.resumeToken);
  }

  async close(_params: unknown, ctx: HandlerContext): Promise<void> {
    // Permanently close the session (not resumable)
    // This does full cleanup of all resources

    // Leave all scopes first (before unregistering agents)
    for (const agentId of ctx.session.agentIds) {
      this.scopes.leaveAll(agentId);
    }

    // Unregister all agents for this session
    this.agents.unregisterBySession(ctx.session.id);

    // Cancel all subscriptions
    this.subscriptions.cancelBySession(ctx.session.id);

    // Close session permanently
    this.sessions.close(ctx.session.id);
  }

  // =========================================================================
  // Agent Methods
  // =========================================================================

  async registerAgent(
    params: { name: string; role?: string; metadata?: Record<string, unknown> },
    ctx: HandlerContext
  ): Promise<RegisteredAgent> {
    const agent = this.agents.register({
      name: params.name,
      role: params.role,
      metadata: params.metadata,
      sessionId: ctx.session.id,
    });

    ctx.session.agentIds.push(agent.id);
    return agent;
  }

  async unregisterAgent(
    params: { agentId: string },
    ctx: HandlerContext
  ): Promise<void> {
    const success = this.agents.unregister(params.agentId);
    if (!success) {
      throw new Error(`Agent not found: ${params.agentId}`);
    }

    const index = ctx.session.agentIds.indexOf(params.agentId);
    if (index !== -1) {
      ctx.session.agentIds.splice(index, 1);
    }

    // Leave all scopes
    this.scopes.leaveAll(params.agentId);
  }

  async listAgents(
    params: AgentFilter,
    _ctx: HandlerContext
  ): Promise<RegisteredAgent[]> {
    return this.agents.list(params);
  }

  async getAgent(
    params: { agentId: string },
    _ctx: HandlerContext
  ): Promise<RegisteredAgent | undefined> {
    return this.agents.get(params.agentId);
  }

  async updateAgentState(
    params: { agentId: string; state: ServerAgentState },
    _ctx: HandlerContext
  ): Promise<RegisteredAgent> {
    return this.agents.updateState(params.agentId, params.state);
  }

  async updateAgentMetadata(
    params: { agentId: string; metadata: Record<string, unknown> },
    _ctx: HandlerContext
  ): Promise<RegisteredAgent> {
    return this.agents.updateMetadata(params.agentId, params.metadata);
  }

  // =========================================================================
  // Scope Methods
  // =========================================================================

  async createScope(
    params: {
      name: string;
      metadata?: Record<string, unknown>;
      parentId?: string;
    },
    ctx: HandlerContext
  ): Promise<ServerScope> {
    return this.scopes.create({
      name: params.name,
      metadata: params.metadata,
      parentId: params.parentId,
      createdBy: ctx.session.id,
    });
  }

  async deleteScope(
    params: { scopeId: string; deleteDescendants?: boolean },
    _ctx: HandlerContext
  ): Promise<void> {
    const success = this.scopes.delete(params.scopeId, {
      deleteDescendants: params.deleteDescendants,
    });
    if (!success) {
      throw new Error(`Scope not found: ${params.scopeId}`);
    }
  }

  async listScopes(
    params: ScopeFilter,
    _ctx: HandlerContext
  ): Promise<ServerScope[]> {
    return this.scopes.list(params);
  }

  async getScope(
    params: { scopeId: string },
    _ctx: HandlerContext
  ): Promise<ServerScope | undefined> {
    return this.scopes.get(params.scopeId);
  }

  async joinScope(
    params: { scopeId: string; agentId: string },
    _ctx: HandlerContext
  ): Promise<void> {
    this.scopes.join(params.scopeId, params.agentId);
  }

  async leaveScope(
    params: { scopeId: string; agentId: string },
    _ctx: HandlerContext
  ): Promise<void> {
    this.scopes.leave(params.scopeId, params.agentId);
  }

  // =========================================================================
  // Message Methods
  // =========================================================================

  async send(
    params: {
      to: string | string[];
      payload: unknown;
      replyTo?: string;
      priority?: number;
    },
    ctx: HandlerContext
  ): Promise<ServerMessage> {
    const from = ctx.session.agentIds[0] ?? ctx.session.id;

    // Handle single recipient
    if (typeof params.to === "string") {
      // Check for prefixed addresses first
      if (isAddress(params.to)) {
        if (isScopeAddress(params.to)) {
          const scopeId = extractId(params.to);
          return this.messages.sendToScope({
            from,
            scopeId,
            payload: params.payload,
            excludeSender: true,
          });
        } else {
          const agentId = extractId(params.to);
          return this.messages.sendToAgent({
            from,
            to: agentId,
            payload: params.payload,
            replyTo: params.replyTo,
            priority: params.priority,
          });
        }
      }

      // Backward compatibility: unprefixed address
      // Check if 'to' is a scope ID by trying to get it
      const scope = this.scopes.get(params.to);
      if (scope) {
        return this.messages.sendToScope({
          from,
          scopeId: params.to,
          payload: params.payload,
          excludeSender: true,
        });
      }

      // Send to agent (unprefixed)
      return this.messages.sendToAgent({
        from,
        to: params.to,
        payload: params.payload,
        replyTo: params.replyTo,
        priority: params.priority,
      });
    }

    // Handle array of recipients
    const firstTo = params.to[0];
    if (!firstTo) {
      throw new Error("No recipients specified");
    }

    // Process first recipient (simplified - could be enhanced to return multiple)
    if (isScopeAddress(firstTo)) {
      const scopeId = extractId(firstTo);
      return this.messages.sendToScope({
        from,
        scopeId,
        payload: params.payload,
        excludeSender: true,
      });
    }

    const agentId = isAgentAddress(firstTo) ? extractId(firstTo) : firstTo;
    return this.messages.sendToAgent({
      from,
      to: agentId,
      payload: params.payload,
      replyTo: params.replyTo,
      priority: params.priority,
    });
  }

  // =========================================================================
  // Subscription Methods
  // =========================================================================

  async subscribe(
    params: { filter: SubscriptionFilter; startAfter?: string },
    ctx: HandlerContext
  ): Promise<ServerSubscription> {
    const subscription = this.subscriptions.create({
      sessionId: ctx.session.id,
      filter: params.filter,
      startAfter: params.startAfter,
    });

    ctx.session.subscriptionIds.push(subscription.id);
    return subscription;
  }

  async unsubscribe(
    params: { subscriptionId: string },
    ctx: HandlerContext
  ): Promise<void> {
    const success = this.subscriptions.cancel(params.subscriptionId);
    if (!success) {
      throw new Error(`Subscription not found: ${params.subscriptionId}`);
    }

    const index = ctx.session.subscriptionIds.indexOf(params.subscriptionId);
    if (index !== -1) {
      ctx.session.subscriptionIds.splice(index, 1);
    }
  }

  async replay(
    params: { subscriptionId: string; since?: string; until?: string },
    _ctx: HandlerContext
  ): Promise<MAPEvent[]> {
    const subscription = this.subscriptions.get(params.subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${params.subscriptionId}`);
    }

    return this.eventBus.getEvents({
      types: subscription.filter.eventTypes,
      since: params.since,
      until: params.until,
      limit: 100,
    });
  }
}

/**
 * A concrete implementation of BaseMAPRouter that can be instantiated directly.
 *
 * Use this when you don't need to customize any behavior.
 */
export class DefaultMAPRouter extends BaseMAPRouter {
  // All default implementations from BaseMAPRouter
}
