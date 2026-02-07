/**
 * ThreadManager implementation
 *
 * Manages conversation threads with event emission.
 */

import type {
  ServerThread,
  ThreadManager,
  ThreadManagerOptions,
  ThreadStore,
  TurnStore,
  EventBus,
} from "../types";
import { ulid } from "../../utils/ulid";
import { InMemoryThreadStore } from "./stores/in-memory-thread";

/**
 * Error thrown when a thread is not found.
 */
export class ThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`Thread not found: ${threadId}`);
    this.name = "ThreadNotFoundError";
  }
}

/**
 * Error thrown when a root turn is not found.
 */
export class RootTurnNotFoundError extends Error {
  constructor(turnId: string) {
    super(`Root turn not found: ${turnId}`);
    this.name = "RootTurnNotFoundError";
  }
}

/**
 * Error thrown when a root turn doesn't belong to the conversation.
 */
export class RootTurnConversationMismatchError extends Error {
  constructor(turnId: string, conversationId: string) {
    super(`Turn ${turnId} does not belong to conversation ${conversationId}`);
    this.name = "RootTurnConversationMismatchError";
  }
}

/**
 * Error thrown when a parent thread is not found.
 */
export class ParentThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`Parent thread not found: ${threadId}`);
    this.name = "ParentThreadNotFoundError";
  }
}

/**
 * ThreadManager implementation.
 *
 * Manages conversation threads:
 * - Creation with rootTurn validation
 * - Nested threads via parentThreadId
 * - Turn count and participant count tracking
 */
export class ThreadManagerImpl implements ThreadManager {
  private readonly eventBus: EventBus;
  private readonly store: ThreadStore;
  private readonly turnStore: TurnStore;

  constructor(options: ThreadManagerOptions) {
    this.eventBus = options.eventBus;
    this.store = options.store ?? new InMemoryThreadStore();
    this.turnStore = options.turnStore;
  }

  /**
   * Create a thread rooted at a specific turn.
   */
  create(params: {
    conversationId: string;
    rootTurnId: string;
    subject?: string;
    parentThreadId?: string;
    createdBy: string;
  }): ServerThread {
    // Validate root turn exists
    const rootTurn = this.turnStore.get(params.rootTurnId);
    if (!rootTurn) {
      throw new RootTurnNotFoundError(params.rootTurnId);
    }

    // Validate root turn belongs to the conversation
    if (rootTurn.conversationId !== params.conversationId) {
      throw new RootTurnConversationMismatchError(params.rootTurnId, params.conversationId);
    }

    // Validate parent thread exists if specified
    if (params.parentThreadId) {
      const parent = this.store.get(params.parentThreadId);
      if (!parent) {
        throw new ParentThreadNotFoundError(params.parentThreadId);
      }
    }

    const now = Date.now();
    const thread: ServerThread = {
      id: `thread-${ulid()}`,
      conversationId: params.conversationId,
      parentThreadId: params.parentThreadId,
      subject: params.subject,
      rootTurnId: params.rootTurnId,
      turnCount: 0,
      participantCount: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy,
    };

    this.store.save(thread);

    this.eventBus.emit({
      type: "mail.thread.created",
      data: {
        conversationId: params.conversationId,
        thread,
      },
    });

    return thread;
  }

  /**
   * Get a thread by ID.
   */
  get(id: string): ServerThread | undefined {
    return this.store.get(id);
  }

  /**
   * List threads in a conversation.
   */
  list(conversationId: string, parentThreadId?: string): ServerThread[] {
    return this.store.list({ conversationId, parentThreadId });
  }

  /**
   * Increment turn count for a thread.
   */
  incrementTurnCount(threadId: string): void {
    const thread = this.store.get(threadId);
    if (!thread) {
      throw new ThreadNotFoundError(threadId);
    }

    this.store.save({
      ...thread,
      turnCount: thread.turnCount + 1,
      updatedAt: Date.now(),
    });
  }

  /**
   * Increment participant count for a thread.
   */
  incrementParticipantCount(threadId: string): void {
    const thread = this.store.get(threadId);
    if (!thread) {
      throw new ThreadNotFoundError(threadId);
    }

    this.store.save({
      ...thread,
      participantCount: thread.participantCount + 1,
      updatedAt: Date.now(),
    });
  }
}
