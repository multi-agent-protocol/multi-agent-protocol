/**
 * ResourceCleaner implementation
 *
 * Handles cleanup of stale sessions, orphaned agents, subscriptions, and expired messages.
 */

import type {
  SessionManager,
  AgentRegistry,
  SubscriptionManager,
  ScopeManager,
  CleanupStrategy,
  CleanupThresholds,
  CleanupStats,
  ResourceCleaner,
  ResourceCleanerOptions,
} from "../types";
import type { MessageRouterImpl } from "../messages/router";

/**
 * Default cleanup thresholds.
 */
const DEFAULT_THRESHOLDS: Required<CleanupThresholds> = {
  sessionDisconnectMs: 5 * 60 * 1000, // 5 minutes
  sessionInactiveMs: 30 * 60 * 1000, // 30 minutes
  intervalMs: 60 * 1000, // 1 minute
};

/**
 * ResourceCleaner implementation.
 *
 * Runs cleanup cycles to remove:
 * - Stale disconnected sessions
 * - Orphaned agents (from closed sessions)
 * - Orphaned subscriptions (from closed sessions)
 * - Expired queued messages
 */
export class ResourceCleanerImpl implements ResourceCleaner {
  private readonly sessions: SessionManager;
  private readonly agents: AgentRegistry;
  private readonly subscriptions: SubscriptionManager;
  private readonly messages: MessageRouterImpl;
  private readonly scopes?: ScopeManager;
  private readonly thresholds: Required<CleanupThresholds>;
  private readonly strategy: CleanupStrategy;

  private _running = false;
  private _intervalId?: ReturnType<typeof setInterval>;

  constructor(options: ResourceCleanerOptions) {
    this.sessions = options.sessions;
    this.agents = options.agents;
    this.subscriptions = options.subscriptions;
    this.messages = options.messages as MessageRouterImpl;
    this.scopes = options.scopes;
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...options.thresholds,
    };
    this.strategy = options.strategy ?? {};
  }

  /**
   * Whether automatic cleanup is running.
   */
  get running(): boolean {
    return this._running;
  }

  /**
   * Run one cleanup cycle.
   */
  async run(): Promise<CleanupStats> {
    const stats: CleanupStats = {
      sessionsExpired: 0,
      agentsUnregistered: 0,
      subscriptionsCancelled: 0,
      messagesExpired: 0,
    };

    // 1. Expire stale disconnected sessions
    const expiredSessionIds = this.sessions.expireStale(
      this.thresholds.sessionDisconnectMs
    );
    stats.sessionsExpired = expiredSessionIds.length;

    // Notify strategy for each expired session
    if (this.strategy.onStaleSession) {
      for (const sessionId of expiredSessionIds) {
        const session = this.sessions.get(sessionId);
        if (session) {
          this.strategy.onStaleSession(session);
        }
      }
    }

    // 2. Unregister orphaned agents (from expired sessions)
    for (const sessionId of expiredSessionIds) {
      // Get agents BEFORE unregistering for strategy callbacks
      const agentsToClean = this.agents.list({ sessionId });

      // Notify strategy BEFORE unregistering
      if (this.strategy.onOrphanedAgent) {
        for (const agent of agentsToClean) {
          this.strategy.onOrphanedAgent(agent);
        }
      }

      // Clean up scope memberships BEFORE unregistering agents
      if (this.scopes) {
        for (const agent of agentsToClean) {
          this.scopes.leaveAll(agent.id);
        }
      }

      const unregisteredIds = this.agents.unregisterBySession(sessionId);
      stats.agentsUnregistered += unregisteredIds.length;
    }

    // 3. Cancel orphaned subscriptions (from expired sessions)
    for (const sessionId of expiredSessionIds) {
      // Get subscriptions BEFORE cancelling for strategy callbacks
      // Access via store since SubscriptionManager doesn't expose list()
      const store = (this.subscriptions as any).store;
      const subsToCancel = store?.list?.({ sessionId }) ?? [];

      // Notify strategy BEFORE cancelling
      if (this.strategy.onOrphanedSubscription) {
        for (const subscription of subsToCancel) {
          this.strategy.onOrphanedSubscription(subscription);
        }
      }

      const cancelledIds = this.subscriptions.cancelBySession(sessionId);
      stats.subscriptionsCancelled += cancelledIds.length;
    }

    // 4. Expire old queued messages
    if (this.messages.expireMessages) {
      const expiredCount = this.messages.expireMessages();
      stats.messagesExpired = expiredCount;

      if (this.strategy.onExpiredMessages && expiredCount > 0) {
        this.strategy.onExpiredMessages(expiredCount);
      }
    }

    return stats;
  }

  /**
   * Start automatic cleanup interval.
   */
  start(): void {
    if (this._running) {
      return;
    }

    if (this.thresholds.intervalMs <= 0) {
      // Manual only mode
      return;
    }

    this._running = true;
    this._intervalId = setInterval(() => {
      this.run().catch((error) => {
        console.error("ResourceCleaner error:", error);
      });
    }, this.thresholds.intervalMs);
  }

  /**
   * Stop automatic cleanup.
   */
  stop(): void {
    if (!this._running) {
      return;
    }

    this._running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = undefined;
    }
  }
}
