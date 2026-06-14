/**
 * Mail extension (`urn:map:ext:mail:1`, v1.1).
 *
 * MAP owns this contract; the SDK ships the **default optional implementation**
 * here, and agent-inbox is the flagship standalone implementation. A
 * transport-agnostic conformance suite (./conformance) validates both.
 *
 * Server: mount the default impl with
 *   `additionalHandlers: createMailHandlers({ conversations, turns, threads })`
 * Client: `mailExtension.client(conn).create({ ... })`.
 *
 * The wire shape is the MAP convention (camelCase, `conversationId`), like the
 * rest of the protocol — see docs/map-ext.md and schema/ext/mail/.
 */
import { defineExtension } from "../define-extension";
import type {
  MailCreateRequestParams,
  MailCreateResponseResult,
  MailGetRequestParams,
  MailGetResponseResult,
  MailListRequestParams,
  MailListResponseResult,
  MailCloseRequestParams,
  MailCloseResponseResult,
  MailReopenRequestParams,
  MailReopenResponseResult,
  MailPresenceRequestParams,
  MailPresenceResponseResult,
  MailJoinRequestParams,
  MailJoinResponseResult,
  MailLeaveRequestParams,
  MailLeaveResponseResult,
  MailInviteRequestParams,
  MailInviteResponseResult,
  MailTurnRequestParams,
  MailTurnResponseResult,
  MailTurnsListRequestParams,
  MailTurnsListResponseResult,
  MailThreadCreateRequestParams,
  MailThreadCreateResponseResult,
  MailThreadListRequestParams,
  MailThreadListResponseResult,
  MailReplayRequestParams,
  MailReplayResponseResult,
} from "../../types";

/** Typed client for the 14 mail v1.1 methods (over callExtension). */
export interface MailClient {
  create(params?: MailCreateRequestParams): Promise<MailCreateResponseResult>;
  get(params: MailGetRequestParams): Promise<MailGetResponseResult>;
  list(params?: MailListRequestParams): Promise<MailListResponseResult>;
  close(params: MailCloseRequestParams): Promise<MailCloseResponseResult>;
  reopen(params: MailReopenRequestParams): Promise<MailReopenResponseResult>;
  presence(params: MailPresenceRequestParams): Promise<MailPresenceResponseResult>;
  join(params: MailJoinRequestParams): Promise<MailJoinResponseResult>;
  leave(params: MailLeaveRequestParams): Promise<MailLeaveResponseResult>;
  invite(params: MailInviteRequestParams): Promise<MailInviteResponseResult>;
  turn(params: MailTurnRequestParams): Promise<MailTurnResponseResult>;
  turnsList(params: MailTurnsListRequestParams): Promise<MailTurnsListResponseResult>;
  threadCreate(params: MailThreadCreateRequestParams): Promise<MailThreadCreateResponseResult>;
  threadList(params: MailThreadListRequestParams): Promise<MailThreadListResponseResult>;
  replay(params: MailReplayRequestParams): Promise<MailReplayResponseResult>;
}

export const mailExtension = defineExtension<MailClient>(
  {
    name: "mail",
    uri: "urn:map:ext:mail:1",
    version: "1.1.0",
    methodPrefix: "mail/",
  },
  {
    client: (call) => ({
      create: (p?: MailCreateRequestParams) => call<MailCreateResponseResult>("mail/create", p),
      get: (p: MailGetRequestParams) => call<MailGetResponseResult>("mail/get", p),
      list: (p?: MailListRequestParams) => call<MailListResponseResult>("mail/list", p),
      close: (p: MailCloseRequestParams) => call<MailCloseResponseResult>("mail/close", p),
      reopen: (p: MailReopenRequestParams) => call<MailReopenResponseResult>("mail/reopen", p),
      presence: (p: MailPresenceRequestParams) => call<MailPresenceResponseResult>("mail/presence", p),
      join: (p: MailJoinRequestParams) => call<MailJoinResponseResult>("mail/join", p),
      leave: (p: MailLeaveRequestParams) => call<MailLeaveResponseResult>("mail/leave", p),
      invite: (p: MailInviteRequestParams) => call<MailInviteResponseResult>("mail/invite", p),
      turn: (p: MailTurnRequestParams) => call<MailTurnResponseResult>("mail/turn", p),
      turnsList: (p: MailTurnsListRequestParams) => call<MailTurnsListResponseResult>("mail/turns/list", p),
      threadCreate: (p: MailThreadCreateRequestParams) => call<MailThreadCreateResponseResult>("mail/thread/create", p),
      threadList: (p: MailThreadListRequestParams) => call<MailThreadListResponseResult>("mail/thread/list", p),
      replay: (p: MailReplayRequestParams) => call<MailReplayResponseResult>("mail/replay", p),
    }),
  },
);

// The default optional implementation (managers, stores, createMailHandlers).
export * from "../../server/mail";
