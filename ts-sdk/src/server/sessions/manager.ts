/**
 * SessionManager implementation
 *
 * Manages session lifecycle with resume support.
 */

import type {
  ServerSession,
  SessionRole,
  SessionStatus,
  SessionStore,
  SessionManager,
  SessionManagerOptions,
  ResumeResult,
  EventBus,
} from "../types";
import { ulid } from "../../utils/ulid";
import { InMemorySessionStore } from "./stores/in-memory";

/** Default resume window: 5 minutes */
const DEFAULT_RESUME_WINDOW_MS = 5 * 60 * 1000;

/**
 * Generate a secure-ish resume token.
 * In production, you might want to use crypto.randomUUID() or similar.
 */
function generateResumeToken(): string {
  return `resume_${ulid()}`;
}

/**
 * SessionManager implementation.
 *
 * Manages session lifecycle:
 * - Creation with role and metadata
 * - Disconnect with resume token generation
 * - Resume using token
 * - Permanent close
 * - Stale session expiration
 * - Agent and subscription tracking
 *
 * Events emitted:
 * - session.connected
 * - session.disconnected
 * - session.resumed
 * - session.expired
 */
export class SessionManagerImpl implements SessionManager {
  private readonly eventBus: EventBus;
  private readonly store: SessionStore;
  private readonly resumeWindowMs: number;

  constructor(options: SessionManagerOptions) {
    this.eventBus = options.eventBus;
    this.store = options.store ?? new InMemorySessionStore();
    this.resumeWindowMs = options.resumeWindowMs ?? DEFAULT_RESUME_WINDOW_MS;
  }

  /**
   * Create a new session.
   */
  create(params: {
    role: SessionRole;
    name?: string;
    metadata?: Record<string, unknown>;
  }): ServerSession {
    const now = Date.now();
    const session: ServerSession = {
      id: ulid(),
      role: params.role,
      name: params.name,
      status: "connected",
      connectedAt: now,
      lastActivity: now,
      metadata: params.metadata ?? {},
      agentIds: [],
      subscriptionIds: [],
    };

    this.store.save(session);

    this.eventBus.emit({
      type: "session.connected",
      data: { session },
      source: { sessionId: session.id },
    });

    return session;
  }

  /**
   * Get session by ID.
   */
  get(id: string): ServerSession | undefined {
    return this.store.get(id);
  }

  /**
   * List sessions matching filter criteria.
   */
  list(filter?: { role?: SessionRole; status?: SessionStatus }): ServerSession[] {
    return this.store.list(filter);
  }

  /**
   * Mark session as disconnected (but resumable).
   * @returns Resume token for reconnection
   */
  disconnect(id: string): string | undefined {
    const session = this.store.get(id);
    if (!session) {
      return undefined;
    }

    // Already disconnected or expired
    if (session.status !== "connected") {
      return session.resumeToken;
    }

    const resumeToken = generateResumeToken();
    const updatedSession: ServerSession = {
      ...session,
      status: "disconnected",
      disconnectedAt: Date.now(),
      resumeToken,
    };

    this.store.save(updatedSession);

    this.eventBus.emit({
      type: "session.disconnected",
      data: { sessionId: id, resumeToken },
      source: { sessionId: id },
    });

    return resumeToken;
  }

  /**
   * Resume a disconnected session.
   */
  resume(resumeToken: string): ResumeResult {
    const session = this.store.getByResumeToken(resumeToken);

    if (!session) {
      return { success: false, reason: "not_found" };
    }

    if (session.status === "expired") {
      return { success: false, reason: "expired" };
    }

    if (session.status === "connected") {
      // Already connected, just return it
      return { success: true, session };
    }

    // Check if session has expired due to time
    const disconnectedAt = session.disconnectedAt ?? 0;
    if (Date.now() - disconnectedAt > this.resumeWindowMs) {
      // Mark as expired
      const expiredSession: ServerSession = {
        ...session,
        status: "expired",
        resumeToken: undefined,
      };
      this.store.save(expiredSession);

      this.eventBus.emit({
        type: "session.expired",
        data: { sessionId: session.id },
        source: { sessionId: session.id },
      });

      return { success: false, reason: "expired" };
    }

    // Resume the session
    const now = Date.now();
    const resumedSession: ServerSession = {
      ...session,
      status: "connected",
      lastActivity: now,
      disconnectedAt: undefined,
      resumeToken: undefined,
    };

    this.store.save(resumedSession);

    this.eventBus.emit({
      type: "session.resumed",
      data: { session: resumedSession },
      source: { sessionId: session.id },
    });

    return { success: true, session: resumedSession };
  }

  /**
   * Permanently close a session (not resumable).
   * @returns Session for cleanup
   */
  close(id: string): ServerSession | undefined {
    const session = this.store.get(id);
    if (!session) {
      return undefined;
    }

    this.store.delete(id);
    return session;
  }

  /**
   * Expire sessions that have been disconnected too long.
   * @returns Expired session IDs
   */
  expireStale(maxDisconnectMs: number): string[] {
    const now = Date.now();
    const disconnected = this.store.list({ status: "disconnected" });
    const expiredIds: string[] = [];

    for (const session of disconnected) {
      const disconnectedAt = session.disconnectedAt ?? 0;
      if (now - disconnectedAt > maxDisconnectMs) {
        const expiredSession: ServerSession = {
          ...session,
          status: "expired",
          resumeToken: undefined,
        };
        this.store.save(expiredSession);

        this.eventBus.emit({
          type: "session.expired",
          data: { sessionId: session.id },
          source: { sessionId: session.id },
        });

        expiredIds.push(session.id);
      }
    }

    return expiredIds;
  }

  /**
   * Track agent registration.
   */
  addAgent(sessionId: string, agentId: string): void {
    const session = this.store.get(sessionId);
    if (!session) {
      return;
    }

    if (!session.agentIds.includes(agentId)) {
      const updatedSession: ServerSession = {
        ...session,
        agentIds: [...session.agentIds, agentId],
      };
      this.store.save(updatedSession);
    }
  }

  /**
   * Remove agent tracking.
   */
  removeAgent(sessionId: string, agentId: string): void {
    const session = this.store.get(sessionId);
    if (!session) {
      return;
    }

    const updatedSession: ServerSession = {
      ...session,
      agentIds: session.agentIds.filter((id) => id !== agentId),
    };
    this.store.save(updatedSession);
  }

  /**
   * Track subscription.
   */
  addSubscription(sessionId: string, subscriptionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) {
      return;
    }

    if (!session.subscriptionIds.includes(subscriptionId)) {
      const updatedSession: ServerSession = {
        ...session,
        subscriptionIds: [...session.subscriptionIds, subscriptionId],
      };
      this.store.save(updatedSession);
    }
  }

  /**
   * Remove subscription tracking.
   */
  removeSubscription(sessionId: string, subscriptionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) {
      return;
    }

    const updatedSession: ServerSession = {
      ...session,
      subscriptionIds: session.subscriptionIds.filter((id) => id !== subscriptionId),
    };
    this.store.save(updatedSession);
  }

  /**
   * Update last activity timestamp.
   */
  touch(id: string): void {
    const session = this.store.get(id);
    if (!session) {
      return;
    }

    const updatedSession: ServerSession = {
      ...session,
      lastActivity: Date.now(),
    };
    this.store.save(updatedSession);
  }
}
