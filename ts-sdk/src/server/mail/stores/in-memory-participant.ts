/**
 * In-memory ParticipantStore implementation
 *
 * Maintains bidirectional indexes for efficient lookup:
 * - conversation → participants
 * - participant → conversations
 */

import type {
  ServerParticipant,
  ParticipantFilter,
  ParticipantStore,
} from "../../types";

/**
 * In-memory implementation of ParticipantStore.
 */
export class InMemoryParticipantStore implements ParticipantStore {
  /** Primary storage: "conversationId:participantId" → participant */
  private readonly participants: Map<string, ServerParticipant> = new Map();
  /** Index: conversationId → participant IDs */
  private readonly byConversation: Map<string, Set<string>> = new Map();
  /** Index: participantId → conversation IDs */
  private readonly byParticipant: Map<string, Set<string>> = new Map();

  private key(conversationId: string, participantId: string): string {
    return `${conversationId}:${participantId}`;
  }

  /**
   * Save a participant (create or update).
   */
  save(participant: ServerParticipant): void {
    const k = this.key(participant.conversationId, participant.id);
    this.participants.set(k, {
      ...participant,
      permissions: { ...participant.permissions },
      agentInfo: participant.agentInfo ? { ...participant.agentInfo } : undefined,
    });

    // Maintain conversation index
    let convSet = this.byConversation.get(participant.conversationId);
    if (!convSet) {
      convSet = new Set();
      this.byConversation.set(participant.conversationId, convSet);
    }
    convSet.add(participant.id);

    // Maintain participant index
    let partSet = this.byParticipant.get(participant.id);
    if (!partSet) {
      partSet = new Set();
      this.byParticipant.set(participant.id, partSet);
    }
    partSet.add(participant.conversationId);
  }

  /**
   * Get a specific participant in a conversation.
   */
  get(conversationId: string, participantId: string): ServerParticipant | undefined {
    const participant = this.participants.get(this.key(conversationId, participantId));
    return participant ? this.copy(participant) : undefined;
  }

  /**
   * List participants matching filter criteria.
   */
  list(filter: ParticipantFilter): ServerParticipant[] {
    let candidates: Iterable<ServerParticipant>;

    if (filter.conversationId && filter.participantId) {
      // Exact lookup
      const p = this.participants.get(this.key(filter.conversationId, filter.participantId));
      candidates = p ? [p] : [];
    } else if (filter.conversationId) {
      // All participants in a conversation
      const ids = this.byConversation.get(filter.conversationId);
      candidates = ids
        ? this.iterateByConversation(filter.conversationId, ids)
        : [];
    } else if (filter.participantId) {
      // All conversations for a participant
      const convIds = this.byParticipant.get(filter.participantId);
      candidates = convIds
        ? this.iterateByParticipant(filter.participantId, convIds)
        : [];
    } else {
      candidates = this.participants.values();
    }

    const results: ServerParticipant[] = [];

    for (const participant of candidates) {
      // Filter by role
      if (filter.role !== undefined && participant.role !== filter.role) continue;

      // Filter by active (not left)
      if (filter.active === true && participant.leftAt !== undefined) continue;
      if (filter.active === false && participant.leftAt === undefined) continue;

      results.push(this.copy(participant));
    }

    return results;
  }

  /**
   * Remove a participant from a conversation.
   */
  delete(conversationId: string, participantId: string): boolean {
    const k = this.key(conversationId, participantId);
    if (!this.participants.has(k)) return false;

    this.participants.delete(k);
    this.byConversation.get(conversationId)?.delete(participantId);
    this.byParticipant.get(participantId)?.delete(conversationId);

    return true;
  }

  /**
   * Delete all participants for a conversation.
   */
  deleteByConversation(conversationId: string): number {
    const ids = this.byConversation.get(conversationId);
    if (!ids) return 0;

    const count = ids.size;
    for (const participantId of ids) {
      this.participants.delete(this.key(conversationId, participantId));
      this.byParticipant.get(participantId)?.delete(conversationId);
    }
    this.byConversation.delete(conversationId);

    return count;
  }

  /**
   * Get all conversation IDs a participant belongs to.
   */
  getConversationsForParticipant(participantId: string, active?: boolean): string[] {
    const convIds = this.byParticipant.get(participantId);
    if (!convIds) return [];

    if (active === undefined) return Array.from(convIds);

    const results: string[] = [];
    for (const convId of convIds) {
      const p = this.participants.get(this.key(convId, participantId));
      if (!p) continue;

      if (active && p.leftAt === undefined) results.push(convId);
      else if (!active && p.leftAt !== undefined) results.push(convId);
    }
    return results;
  }

  /**
   * Clear all participants.
   */
  clear(): void {
    this.participants.clear();
    this.byConversation.clear();
    this.byParticipant.clear();
  }

  /**
   * Get the number of stored participant records.
   */
  get size(): number {
    return this.participants.size;
  }

  private copy(participant: ServerParticipant): ServerParticipant {
    return {
      ...participant,
      permissions: { ...participant.permissions },
      agentInfo: participant.agentInfo ? { ...participant.agentInfo } : undefined,
    };
  }

  private *iterateByConversation(
    conversationId: string,
    ids: Set<string>
  ): Iterable<ServerParticipant> {
    for (const id of ids) {
      const p = this.participants.get(this.key(conversationId, id));
      if (p) yield p;
    }
  }

  private *iterateByParticipant(
    participantId: string,
    convIds: Set<string>
  ): Iterable<ServerParticipant> {
    for (const convId of convIds) {
      const p = this.participants.get(this.key(convId, participantId));
      if (p) yield p;
    }
  }
}
