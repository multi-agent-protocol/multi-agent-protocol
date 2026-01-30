/**
 * In-memory SessionStore implementation
 */

import type {
  ServerSession,
  SessionRole,
  SessionStatus,
  SessionStore,
} from "../../types";

/**
 * In-memory implementation of SessionStore.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions: Map<string, ServerSession> = new Map();
  private readonly resumeTokenIndex: Map<string, string> = new Map(); // token -> sessionId

  /**
   * Save a session (create or update).
   */
  save(session: ServerSession): void {
    // Remove old resume token mapping if exists
    const existing = this.sessions.get(session.id);
    if (existing?.resumeToken) {
      this.resumeTokenIndex.delete(existing.resumeToken);
    }

    // Add new resume token mapping
    if (session.resumeToken) {
      this.resumeTokenIndex.set(session.resumeToken, session.id);
    }

    this.sessions.set(session.id, { ...session });
  }

  /**
   * Get session by ID.
   */
  get(id: string): ServerSession | undefined {
    const session = this.sessions.get(id);
    return session ? { ...session } : undefined;
  }

  /**
   * Get session by resume token.
   */
  getByResumeToken(token: string): ServerSession | undefined {
    const sessionId = this.resumeTokenIndex.get(token);
    if (!sessionId) {
      return undefined;
    }
    return this.get(sessionId);
  }

  /**
   * List sessions matching filter criteria.
   */
  list(filter?: { role?: SessionRole; status?: SessionStatus }): ServerSession[] {
    const results: ServerSession[] = [];

    for (const session of this.sessions.values()) {
      if (filter?.role !== undefined && session.role !== filter.role) {
        continue;
      }
      if (filter?.status !== undefined && session.status !== filter.status) {
        continue;
      }
      results.push({ ...session });
    }

    return results;
  }

  /**
   * Delete a session by ID.
   */
  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (session?.resumeToken) {
      this.resumeTokenIndex.delete(session.resumeToken);
    }
    return this.sessions.delete(id);
  }

  /**
   * Clear all sessions.
   */
  clear(): void {
    this.sessions.clear();
    this.resumeTokenIndex.clear();
  }

  /**
   * Get the number of stored sessions.
   */
  get size(): number {
    return this.sessions.size;
  }
}
