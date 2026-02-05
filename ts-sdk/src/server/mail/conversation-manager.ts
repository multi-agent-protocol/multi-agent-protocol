/**
 * ConversationManager implementation
 *
 * Manages conversation lifecycle and participants with event emission.
 */

import type {
  ServerConversation,
  ServerParticipant,
  ConversationFilter,
  ConversationManager,
  ConversationManagerOptions,
  ConversationGetResult,
  ConversationStore,
  ParticipantStore,
  DefaultParticipantPermissions,
  EventBus,
} from "../types";
import type { ConversationType, ParticipantRole } from "../../types";
import { ulid } from "../../utils/ulid";
import { InMemoryConversationStore } from "./stores/in-memory-conversation";
import { InMemoryParticipantStore } from "./stores/in-memory-participant";

/**
 * Error thrown when a conversation is not found.
 */
export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

/**
 * Error thrown when a conversation is not in a valid state for the operation.
 */
export class ConversationClosedError extends Error {
  constructor(conversationId: string) {
    super(`Conversation is closed: ${conversationId}`);
    this.name = "ConversationClosedError";
  }
}

/**
 * Error thrown when a participant is already in the conversation.
 */
export class ParticipantAlreadyJoinedError extends Error {
  constructor(conversationId: string, participantId: string) {
    super(`Participant ${participantId} already in conversation ${conversationId}`);
    this.name = "ParticipantAlreadyJoinedError";
  }
}

/**
 * Error thrown when a participant is not found in the conversation.
 */
export class ParticipantNotFoundError extends Error {
  constructor(conversationId: string, participantId: string) {
    super(`Participant ${participantId} not found in conversation ${conversationId}`);
    this.name = "ParticipantNotFoundError";
  }
}

const DEFAULT_PERMISSIONS: Required<DefaultParticipantPermissions> = {
  canSend: true,
  canObserve: true,
  canInvite: false,
  canRemove: false,
  canCreateThreads: true,
  historyAccess: "full",
  canSeeInternal: false,
};

/**
 * ConversationManager implementation.
 *
 * Manages conversation lifecycle:
 * - Creation with auto-join
 * - Participant join/leave/invite
 * - Closing with status update
 * - Listing with filtering
 */
export class ConversationManagerImpl implements ConversationManager {
  private readonly eventBus: EventBus;
  private readonly store: ConversationStore;
  private readonly participantStore: ParticipantStore;

  constructor(options: ConversationManagerOptions) {
    this.eventBus = options.eventBus;
    this.participantStore = options.participantStore ?? new InMemoryParticipantStore();
    this.store =
      options.store ??
      new InMemoryConversationStore({ participantStore: this.participantStore });
  }

  /**
   * Create a new conversation. Creator auto-joins as initiator.
   */
  create(params: {
    type?: ConversationType;
    subject?: string;
    createdBy: string;
    parentConversationId?: string;
    parentTurnId?: string;
    metadata?: Record<string, unknown>;
    initialParticipants?: Array<{
      id: string;
      type?: "user" | "agent" | "system";
      role?: ParticipantRole;
      permissions?: DefaultParticipantPermissions;
      agentInfo?: { agentId: string; name?: string; role?: string };
    }>;
  }): { conversation: ServerConversation; participant: ServerParticipant } {
    // Validate parent exists if specified
    if (params.parentConversationId) {
      const parent = this.store.get(params.parentConversationId);
      if (!parent) {
        throw new ConversationNotFoundError(params.parentConversationId);
      }
    }

    const now = Date.now();
    const conversation: ServerConversation = {
      id: `conv-${ulid()}`,
      type: params.type ?? "multi-agent",
      status: "active",
      subject: params.subject,
      participantCount: 0,
      parentConversationId: params.parentConversationId,
      parentTurnId: params.parentTurnId,
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy,
      metadata: params.metadata ?? {},
    };

    this.store.save(conversation);

    // Auto-join creator as initiator
    const creator = this.addParticipant(conversation.id, {
      id: params.createdBy,
      type: "user",
      role: "initiator",
      permissions: DEFAULT_PERMISSIONS,
    });

    // Add initial participants
    if (params.initialParticipants) {
      for (const p of params.initialParticipants) {
        this.addParticipant(conversation.id, {
          id: p.id,
          type: p.type ?? "agent",
          role: p.role ?? "assistant",
          permissions: { ...DEFAULT_PERMISSIONS, ...p.permissions },
          agentInfo: p.agentInfo,
        });
      }
    }

    // Re-read to get updated participantCount
    const saved = this.store.get(conversation.id)!;

    this.eventBus.emit({
      type: "mail.created",
      data: {
        conversationId: saved.id,
        type: saved.type,
        subject: saved.subject,
        createdBy: params.createdBy,
      },
    });

    return { conversation: saved, participant: creator };
  }

  /**
   * Get conversation by ID with optional includes.
   */
  get(
    id: string,
    include?: {
      participants?: boolean;
      threads?: boolean;
      recentTurns?: number;
      stats?: boolean;
    }
  ): ConversationGetResult | undefined {
    const conversation = this.store.get(id);
    if (!conversation) return undefined;

    const result: ConversationGetResult = { conversation };

    if (include?.participants) {
      result.participants = this.participantStore.list({
        conversationId: id,
      });
    }

    // threads and recentTurns/stats require TurnStore/ThreadStore
    // which are not owned by this manager — handled at handler level

    return result;
  }

  /**
   * List conversations with filtering.
   */
  list(filter?: ConversationFilter): ServerConversation[] {
    return this.store.list(filter);
  }

  /**
   * Close a conversation.
   */
  close(id: string, closedBy: string, reason?: string): ServerConversation {
    const conversation = this.store.get(id);
    if (!conversation) {
      throw new ConversationNotFoundError(id);
    }

    if (conversation.status === "completed" || conversation.status === "archived") {
      throw new ConversationClosedError(id);
    }

    const now = Date.now();
    const updated: ServerConversation = {
      ...conversation,
      status: "completed",
      closedAt: now,
      updatedAt: now,
    };

    this.store.save(updated);

    this.eventBus.emit({
      type: "mail.closed",
      data: {
        conversationId: id,
        closedBy,
        reason,
      },
    });

    return updated;
  }

  /**
   * Join a conversation.
   */
  join(params: {
    conversationId: string;
    participantId: string;
    type?: "user" | "agent" | "system";
    role?: ParticipantRole;
    permissions?: DefaultParticipantPermissions;
    agentInfo?: { agentId: string; name?: string; role?: string };
  }): { conversation: ServerConversation; participant: ServerParticipant } {
    const conversation = this.store.get(params.conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(params.conversationId);
    }

    if (conversation.status !== "active") {
      throw new ConversationClosedError(params.conversationId);
    }

    // Check if already joined
    const existing = this.participantStore.get(params.conversationId, params.participantId);
    if (existing && !existing.leftAt) {
      throw new ParticipantAlreadyJoinedError(params.conversationId, params.participantId);
    }

    const participant = this.addParticipant(params.conversationId, {
      id: params.participantId,
      type: params.type ?? "user",
      role: params.role ?? "assistant",
      permissions: { ...DEFAULT_PERMISSIONS, ...params.permissions },
      agentInfo: params.agentInfo,
    });

    const updated = this.store.get(params.conversationId)!;

    return { conversation: updated, participant };
  }

  /**
   * Leave a conversation.
   */
  leave(conversationId: string, participantId: string, reason?: string): void {
    const conversation = this.store.get(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }

    const participant = this.participantStore.get(conversationId, participantId);
    if (!participant || participant.leftAt) {
      throw new ParticipantNotFoundError(conversationId, participantId);
    }

    const now = Date.now();
    const updated: ServerParticipant = {
      ...participant,
      leftAt: now,
    };

    this.participantStore.save(updated);

    // Decrement participant count
    const conv = this.store.get(conversationId)!;
    this.store.save({
      ...conv,
      participantCount: Math.max(0, conv.participantCount - 1),
      updatedAt: now,
    });

    this.eventBus.emit({
      type: "mail.participant.left",
      data: {
        conversationId,
        participantId,
        reason,
      },
    });
  }

  /**
   * Invite a participant to a conversation.
   * Same as join but semantically different (another participant initiated it).
   */
  invite(params: {
    conversationId: string;
    participant: {
      id: string;
      type?: "user" | "agent" | "system";
      role?: ParticipantRole;
      permissions?: DefaultParticipantPermissions;
      agentInfo?: { agentId: string; name?: string; role?: string };
    };
  }): ServerParticipant {
    const conversation = this.store.get(params.conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(params.conversationId);
    }

    if (conversation.status !== "active") {
      throw new ConversationClosedError(params.conversationId);
    }

    const existing = this.participantStore.get(params.conversationId, params.participant.id);
    if (existing && !existing.leftAt) {
      throw new ParticipantAlreadyJoinedError(params.conversationId, params.participant.id);
    }

    return this.addParticipant(params.conversationId, {
      id: params.participant.id,
      type: params.participant.type ?? "agent",
      role: params.participant.role ?? "assistant",
      permissions: { ...DEFAULT_PERMISSIONS, ...params.participant.permissions },
      agentInfo: params.participant.agentInfo,
    });
  }

  /**
   * Get a participant in a conversation.
   */
  getParticipant(conversationId: string, participantId: string): ServerParticipant | undefined {
    return this.participantStore.get(conversationId, participantId);
  }

  /**
   * List participants in a conversation.
   */
  listParticipants(conversationId: string, active?: boolean): ServerParticipant[] {
    return this.participantStore.list({ conversationId, active });
  }

  /**
   * Internal: add a participant and update conversation count.
   */
  private addParticipant(
    conversationId: string,
    params: {
      id: string;
      type: "user" | "agent" | "system";
      role: ParticipantRole;
      permissions: Required<DefaultParticipantPermissions>;
      agentInfo?: { agentId: string; name?: string; role?: string };
    }
  ): ServerParticipant {
    const now = Date.now();
    const participant: ServerParticipant = {
      id: params.id,
      conversationId,
      type: params.type,
      role: params.role,
      joinedAt: now,
      permissions: {
        canSend: params.permissions.canSend,
        canObserve: params.permissions.canObserve,
        canInvite: params.permissions.canInvite,
        canRemove: params.permissions.canRemove,
        canCreateThreads: params.permissions.canCreateThreads,
        historyAccess: params.permissions.historyAccess,
        canSeeInternal: params.permissions.canSeeInternal,
      },
      agentInfo: params.agentInfo,
    };

    this.participantStore.save(participant);

    // Increment participant count
    const conv = this.store.get(conversationId)!;
    this.store.save({
      ...conv,
      participantCount: conv.participantCount + 1,
      updatedAt: now,
    });

    this.eventBus.emit({
      type: "mail.participant.joined",
      data: {
        conversationId,
        participant,
      },
    });

    return participant;
  }
}
