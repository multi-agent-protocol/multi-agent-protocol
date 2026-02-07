/**
 * TurnManager implementation
 *
 * Manages turn recording, querying, and content type validation.
 */

import type {
  ServerTurn,
  TurnFilter,
  TurnManager,
  TurnManagerOptions,
  TurnStore,
  ConversationManager,
  EventBus,
} from "../types";
import type { TurnStatus, TurnVisibility } from "../../types";
import { ulid } from "../../utils/ulid";
import { InMemoryTurnStore } from "./stores/in-memory-turn";

/** Well-known content types */
const WELL_KNOWN_CONTENT_TYPES = new Set(["text", "data", "event", "reference"]);

/**
 * Error thrown when a conversation is not found.
 */
export class TurnConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "TurnConversationNotFoundError";
  }
}

/**
 * Error thrown when a turn is not found.
 */
export class TurnNotFoundError extends Error {
  constructor(turnId: string) {
    super(`Turn not found: ${turnId}`);
    this.name = "TurnNotFoundError";
  }
}

/**
 * Error thrown for invalid content types.
 */
export class InvalidContentTypeError extends Error {
  constructor(contentType: string) {
    super(
      `Invalid content type "${contentType}": must be a well-known type (text, data, event, reference) or start with "x-"`
    );
    this.name = "InvalidContentTypeError";
  }
}

/**
 * Validate a content type.
 * Well-known types: text, data, event, reference
 * Custom types must start with "x-"
 */
export function validateContentType(contentType: string): void {
  if (WELL_KNOWN_CONTENT_TYPES.has(contentType)) return;
  if (contentType.startsWith("x-") && contentType.length > 2) return;
  throw new InvalidContentTypeError(contentType);
}

/**
 * TurnManager implementation.
 *
 * Records turns from two sources:
 * - Explicit: direct mail/turn calls
 * - Intercepted: map/send with mail metadata
 *
 * Validates content types and emits events.
 */
export class TurnManagerImpl implements TurnManager {
  private readonly eventBus: EventBus;
  private readonly store: TurnStore;
  private readonly conversations: ConversationManager;

  constructor(options: TurnManagerOptions) {
    this.eventBus = options.eventBus;
    this.store = options.store ?? new InMemoryTurnStore();
    this.conversations = options.conversations;
  }

  /**
   * Record a turn (explicit via mail/turn).
   */
  recordTurn(params: {
    conversationId: string;
    participant: string;
    contentType: string;
    content: unknown;
    threadId?: string;
    inReplyTo?: string;
    visibility?: TurnVisibility;
    status?: TurnStatus;
    metadata?: Record<string, unknown>;
  }): ServerTurn {
    this.validateConversation(params.conversationId);
    validateContentType(params.contentType);

    const turn: ServerTurn = {
      id: `turn-${ulid()}`,
      conversationId: params.conversationId,
      participant: params.participant,
      timestamp: Date.now(),
      contentType: params.contentType,
      content: params.content,
      threadId: params.threadId,
      inReplyTo: params.inReplyTo,
      source: { type: "explicit", method: "mail/turn" },
      visibility: params.visibility,
      status: params.status ?? "complete",
      metadata: params.metadata ?? {},
    };

    this.store.append(turn);

    this.eventBus.emit({
      type: "mail.turn.added",
      data: {
        conversationId: params.conversationId,
        turn,
      },
    });

    return turn;
  }

  /**
   * Record an intercepted turn (from map/send with mail meta).
   */
  recordInterceptedTurn(params: {
    conversationId: string;
    participant: string;
    contentType: string;
    content: unknown;
    messageId: string;
    threadId?: string;
    inReplyTo?: string;
    visibility?: TurnVisibility;
    metadata?: Record<string, unknown>;
  }): ServerTurn {
    this.validateConversation(params.conversationId);
    validateContentType(params.contentType);

    const turn: ServerTurn = {
      id: `turn-${ulid()}`,
      conversationId: params.conversationId,
      participant: params.participant,
      timestamp: Date.now(),
      contentType: params.contentType,
      content: params.content,
      threadId: params.threadId,
      inReplyTo: params.inReplyTo,
      source: { type: "intercepted", messageId: params.messageId },
      visibility: params.visibility,
      status: "complete",
      metadata: params.metadata ?? {},
    };

    this.store.append(turn);

    this.eventBus.emit({
      type: "mail.turn.added",
      data: {
        conversationId: params.conversationId,
        turn,
      },
    });

    return turn;
  }

  /**
   * Get a turn by ID.
   */
  get(id: string): ServerTurn | undefined {
    return this.store.get(id);
  }

  /**
   * List turns with filtering and pagination.
   */
  list(filter: TurnFilter): ServerTurn[] {
    return this.store.list(filter);
  }

  /**
   * Update turn status (e.g., streaming → complete).
   */
  updateStatus(id: string, status: TurnStatus): ServerTurn {
    const turn = this.store.get(id);
    if (!turn) {
      throw new TurnNotFoundError(id);
    }

    const updated: ServerTurn = {
      ...turn,
      status,
    };

    // Delete and re-append to update in store
    this.store.delete(id);
    this.store.append(updated);

    this.eventBus.emit({
      type: "mail.turn.updated",
      data: {
        conversationId: turn.conversationId,
        turnId: id,
        status,
      },
    });

    return updated;
  }

  /**
   * Count turns in a conversation.
   */
  count(conversationId: string, threadId?: string): number {
    return this.store.count(conversationId, threadId);
  }

  /**
   * Validate that a conversation exists and is active.
   */
  private validateConversation(conversationId: string): void {
    const result = this.conversations.get(conversationId);
    if (!result) {
      throw new TurnConversationNotFoundError(conversationId);
    }
  }
}
