/**
 * Mail handler factories
 *
 * Creates JSON-RPC handlers for all mail/* protocol methods.
 */

import type {
  ConversationManager,
  TurnManager,
  ThreadManager,
  HandlerContext,
  HandlerRegistry,
} from "../types";
import type {
  MailCreateRequestParams,
  MailGetRequestParams,
  MailListRequestParams,
  MailCloseRequestParams,
  MailJoinRequestParams,
  MailLeaveRequestParams,
  MailInviteRequestParams,
  MailTurnRequestParams,
  MailTurnsListRequestParams,
  MailThreadCreateRequestParams,
  MailThreadListRequestParams,
  MailSummaryRequestParams,
  MailReplayRequestParams,
} from "../../types";
import { MAIL_ERROR_CODES } from "../../types";
import { MAPRequestError } from "../../errors";
import {
  ConversationNotFoundError,
  ConversationClosedError,
  ParticipantAlreadyJoinedError,
  ParticipantNotFoundError,
} from "./conversation-manager";
import {
  TurnNotFoundError,
  TurnConversationNotFoundError,
  InvalidContentTypeError,
} from "./turn-manager";
import {
  ThreadNotFoundError,
  RootTurnNotFoundError,
  RootTurnConversationMismatchError,
  ParentThreadNotFoundError,
} from "./thread-manager";

/**
 * Options for creating mail handlers.
 */
export interface MailHandlerOptions {
  conversations: ConversationManager;
  turns: TurnManager;
  threads: ThreadManager;
}

/**
 * Derive participant ID from handler context.
 * Uses first registered agent, or session ID as fallback.
 */
function getParticipantId(ctx: HandlerContext): string {
  return ctx.session.agentIds[0] ?? ctx.session.id;
}

/**
 * Map manager errors to MAPRequestError with mail error codes.
 */
function mapMailError(error: unknown): never {
  if (
    error instanceof ConversationNotFoundError ||
    error instanceof TurnConversationNotFoundError ||
    error instanceof RootTurnConversationMismatchError
  ) {
    throw new MAPRequestError(
      MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND,
      (error as Error).message,
      { category: "mail" }
    );
  }
  if (error instanceof ConversationClosedError) {
    throw new MAPRequestError(
      MAIL_ERROR_CODES.MAIL_CONVERSATION_CLOSED,
      (error as Error).message,
      { category: "mail" }
    );
  }
  if (error instanceof ParticipantNotFoundError) {
    throw new MAPRequestError(
      MAIL_ERROR_CODES.MAIL_NOT_A_PARTICIPANT,
      (error as Error).message,
      { category: "mail" }
    );
  }
  if (error instanceof ParticipantAlreadyJoinedError) {
    throw new MAPRequestError(
      MAIL_ERROR_CODES.MAIL_PARTICIPANT_ALREADY_JOINED,
      (error as Error).message,
      { category: "mail" }
    );
  }
  if (error instanceof TurnNotFoundError || error instanceof RootTurnNotFoundError) {
    throw new MAPRequestError(
      MAIL_ERROR_CODES.MAIL_TURN_NOT_FOUND,
      (error as Error).message,
      { category: "mail" }
    );
  }
  if (error instanceof InvalidContentTypeError) {
    throw new MAPRequestError(
      MAIL_ERROR_CODES.MAIL_INVALID_TURN_CONTENT,
      (error as Error).message,
      { category: "mail" }
    );
  }
  if (error instanceof ThreadNotFoundError || error instanceof ParentThreadNotFoundError) {
    throw new MAPRequestError(
      MAIL_ERROR_CODES.MAIL_THREAD_NOT_FOUND,
      (error as Error).message,
      { category: "mail" }
    );
  }
  throw error;
}

/**
 * Create handlers for mail/* protocol methods.
 *
 * Methods:
 * - `mail/create` - Create a conversation
 * - `mail/get` - Get conversation details
 * - `mail/list` - List conversations
 * - `mail/close` - Close a conversation
 * - `mail/join` - Join a conversation
 * - `mail/leave` - Leave a conversation
 * - `mail/invite` - Invite a participant
 * - `mail/turn` - Record a turn
 * - `mail/turns/list` - List turns
 * - `mail/thread/create` - Create a thread
 * - `mail/thread/list` - List threads
 * - `mail/summary` - Get conversation summary
 * - `mail/replay` - Replay turns
 */
export function createMailHandlers(options: MailHandlerOptions): HandlerRegistry {
  const { conversations, turns, threads } = options;

  return {
    // =========================================================================
    // Conversation lifecycle
    // =========================================================================

    "mail/create": async (params: unknown, ctx: HandlerContext) => {
      const p = params as MailCreateRequestParams;
      const participantId = getParticipantId(ctx);

      try {
        const { conversation, participant } = conversations.create({
          type: p.type,
          subject: p.subject,
          createdBy: participantId,
          parentConversationId: p.parentConversationId,
          parentTurnId: p.parentTurnId,
          initialParticipants: p.initialParticipants?.map((ip) => ({
            id: ip.id,
            role: ip.role,
            permissions: ip.permissions,
          })),
          metadata: p.metadata,
        });

        let initialTurn;
        if (p.initialTurn) {
          initialTurn = turns.recordTurn({
            conversationId: conversation.id,
            participant: participantId,
            contentType: p.initialTurn.contentType,
            content: p.initialTurn.content,
            visibility: p.initialTurn.visibility,
          });
        }

        return { conversation, participant, initialTurn };
      } catch (error) {
        mapMailError(error);
      }
    },

    "mail/get": async (params: unknown) => {
      const p = params as MailGetRequestParams;

      const result = conversations.get(p.conversationId, {
        participants: p.include?.participants,
      });

      if (!result) {
        throw new MAPRequestError(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND,
          `Conversation not found: ${p.conversationId}`,
          { category: "mail" }
        );
      }

      const response: Record<string, unknown> = {
        conversation: result.conversation,
      };

      if (result.participants) {
        response.participants = result.participants;
      }

      if (p.include?.threads) {
        response.threads = threads.list(p.conversationId);
      }

      if (p.include?.recentTurns) {
        response.recentTurns = turns.list({
          conversationId: p.conversationId,
          limit: p.include.recentTurns,
          order: "desc",
        });
      }

      if (p.include?.stats) {
        const totalTurns = turns.count(p.conversationId);
        const allThreads = threads.list(p.conversationId);
        const activeParticipants = conversations.listParticipants(p.conversationId, true);

        // Count turns by content type
        const allTurns = turns.list({ conversationId: p.conversationId });
        const turnsByContentType: Record<string, number> = {};
        for (const t of allTurns) {
          turnsByContentType[t.contentType] = (turnsByContentType[t.contentType] ?? 0) + 1;
        }

        response.stats = {
          totalTurns,
          turnsByContentType,
          activeParticipants: activeParticipants.length,
          threadCount: allThreads.length,
        };
      }

      return response;
    },

    "mail/list": async (params: unknown) => {
      const p = (params ?? {}) as MailListRequestParams;
      const limit = p.limit ?? 50;

      const allConversations = conversations.list(p.filter);

      // Cursor-based pagination: cursor is the last conversation ID seen
      let startIndex = 0;
      if (p.cursor) {
        const cursorIndex = allConversations.findIndex((c) => c.id === p.cursor);
        if (cursorIndex >= 0) {
          startIndex = cursorIndex + 1;
        }
      }

      const page = allConversations.slice(startIndex, startIndex + limit + 1);
      const hasMore = page.length > limit;
      const items = hasMore ? page.slice(0, limit) : page;

      return {
        conversations: items,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].id : undefined,
      };
    },

    "mail/close": async (params: unknown, ctx: HandlerContext) => {
      const p = params as MailCloseRequestParams;
      const participantId = getParticipantId(ctx);

      try {
        const conversation = conversations.close(p.conversationId, participantId, p.reason);
        return { conversation };
      } catch (error) {
        mapMailError(error);
      }
    },

    // =========================================================================
    // Participants
    // =========================================================================

    "mail/join": async (params: unknown, ctx: HandlerContext) => {
      const p = params as MailJoinRequestParams;
      const participantId = getParticipantId(ctx);

      try {
        const { conversation, participant } = conversations.join({
          conversationId: p.conversationId,
          participantId,
          role: p.role,
        });

        const response: Record<string, unknown> = { conversation, participant };

        if (p.catchUp) {
          const catchUpLimit = p.catchUp.limit ?? 50;

          // catchUp.from can be a turn ID (string) or timestamp (number)
          const afterTurnId = typeof p.catchUp.from === "string" ? p.catchUp.from : undefined;
          const afterTimestamp = typeof p.catchUp.from === "number" ? p.catchUp.from : undefined;

          const history = turns.list({
            conversationId: p.conversationId,
            afterTurnId,
            afterTimestamp,
            limit: catchUpLimit + 1,
            order: "asc",
          });
          const hasMore = history.length > catchUpLimit;
          const items = hasMore ? history.slice(0, catchUpLimit) : history;

          response.history = items;
          if (hasMore) {
            response.historyCursor = items[items.length - 1].id;
          }
        }

        return response;
      } catch (error) {
        mapMailError(error);
      }
    },

    "mail/leave": async (params: unknown, ctx: HandlerContext) => {
      const p = params as MailLeaveRequestParams;
      const participantId = getParticipantId(ctx);

      try {
        conversations.leave(p.conversationId, participantId, p.reason);
        return { success: true, leftAt: Date.now() };
      } catch (error) {
        mapMailError(error);
      }
    },

    "mail/invite": async (params: unknown) => {
      const p = params as MailInviteRequestParams;

      try {
        const participant = conversations.invite({
          conversationId: p.conversationId,
          participant: {
            id: p.participant.id,
            role: p.participant.role,
            permissions: p.participant.permissions,
          },
        });

        return { invited: true, participant };
      } catch (error) {
        mapMailError(error);
      }
    },

    // =========================================================================
    // Turns
    // =========================================================================

    "mail/turn": async (params: unknown, ctx: HandlerContext) => {
      const p = params as MailTurnRequestParams;
      const participantId = getParticipantId(ctx);

      try {
        const turn = turns.recordTurn({
          conversationId: p.conversationId,
          participant: participantId,
          contentType: p.contentType,
          content: p.content,
          threadId: p.threadId,
          inReplyTo: p.inReplyTo,
          visibility: p.visibility,
          metadata: p.metadata,
        });

        // Increment thread turn count (non-fatal)
        if (p.threadId) {
          try {
            threads.incrementTurnCount(p.threadId);
          } catch {
            // Thread increment failure is non-fatal
          }
        }

        return { turn };
      } catch (error) {
        mapMailError(error);
      }
    },

    "mail/turns/list": async (params: unknown) => {
      const p = params as MailTurnsListRequestParams;
      const limit = p.limit ?? 50;

      // Validate conversation exists
      const conv = conversations.get(p.conversationId);
      if (!conv) {
        throw new MAPRequestError(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND,
          `Conversation not found: ${p.conversationId}`,
          { category: "mail" }
        );
      }

      const results = turns.list({
        conversationId: p.conversationId,
        threadId: p.filter?.threadId,
        contentTypes: p.filter?.contentTypes,
        participantId: p.filter?.participantId,
        afterTurnId: p.filter?.afterTurnId,
        beforeTurnId: p.filter?.beforeTurnId,
        afterTimestamp: p.filter?.afterTimestamp,
        beforeTimestamp: p.filter?.beforeTimestamp,
        limit: limit + 1,
        order: p.order,
      });

      const hasMore = results.length > limit;
      const items = hasMore ? results.slice(0, limit) : results;

      return {
        turns: items,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].id : undefined,
      };
    },

    // =========================================================================
    // Threads
    // =========================================================================

    "mail/thread/create": async (params: unknown, ctx: HandlerContext) => {
      const p = params as MailThreadCreateRequestParams;
      const participantId = getParticipantId(ctx);

      try {
        const thread = threads.create({
          conversationId: p.conversationId,
          rootTurnId: p.rootTurnId,
          subject: p.subject,
          parentThreadId: p.parentThreadId,
          createdBy: participantId,
        });

        return { thread };
      } catch (error) {
        mapMailError(error);
      }
    },

    "mail/thread/list": async (params: unknown) => {
      const p = (params ?? {}) as MailThreadListRequestParams;
      const limit = p.limit ?? 50;

      const allThreads = threads.list(p.conversationId, p.parentThreadId);

      // Cursor-based pagination
      let startIndex = 0;
      if (p.cursor) {
        const cursorIndex = allThreads.findIndex((t) => t.id === p.cursor);
        if (cursorIndex >= 0) {
          startIndex = cursorIndex + 1;
        }
      }

      const page = allThreads.slice(startIndex, startIndex + limit + 1);
      const hasMore = page.length > limit;
      const items = hasMore ? page.slice(0, limit) : page;

      return {
        threads: items,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].id : undefined,
      };
    },

    // =========================================================================
    // Summary & Replay
    // =========================================================================

    "mail/summary": async (params: unknown) => {
      const p = params as MailSummaryRequestParams;

      // Validate conversation exists
      const conv = conversations.get(p.conversationId);
      if (!conv) {
        throw new MAPRequestError(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND,
          `Conversation not found: ${p.conversationId}`,
          { category: "mail" }
        );
      }

      // Placeholder implementation - full AI summarization is optional/future
      return { summary: "", generated: false };
    },

    "mail/replay": async (params: unknown) => {
      const p = params as MailReplayRequestParams;
      const limit = p.limit ?? 50;

      // Validate conversation exists
      const conv = conversations.get(p.conversationId);
      if (!conv) {
        throw new MAPRequestError(
          MAIL_ERROR_CODES.MAIL_CONVERSATION_NOT_FOUND,
          `Conversation not found: ${p.conversationId}`,
          { category: "mail" }
        );
      }

      const results = turns.list({
        conversationId: p.conversationId,
        threadId: p.threadId,
        contentTypes: p.contentTypes,
        afterTurnId: p.fromTurnId,
        afterTimestamp: p.fromTimestamp,
        limit: limit + 1,
        order: "asc",
      });

      const hasMore = results.length > limit;
      const items = hasMore ? results.slice(0, limit) : results;

      return {
        turns: items,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].id : undefined,
        missedCount: 0,
      };
    },
  };
}
