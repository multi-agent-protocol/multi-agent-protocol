# Agent Mail System Design

## Motivation

MAP already has a mail protocol (`mail/*` methods) that provides persistent conversation tracking on top of ephemeral `map/send` messaging. However, the current design is server-centric — the server manages conversations, turns, and threads, and agents interact with this system through raw RPC calls.

What's missing is a higher-level **agent-side mail abstraction** that makes it natural for agents to use mail as a coordination primitive. Projects like [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail) demonstrate that agents benefit from familiar metaphors: inboxes, outboxes, addressable identities, and file reservations — not just raw conversation CRUD.

This document explores what a first-class agent mail system should look like on the agent interface side.

---

## Current State

### What MAP Mail Already Provides (Server-Side)

| Capability | Status |
|-----------|--------|
| Conversation lifecycle (create/close/join/leave) | Implemented |
| Turn recording (explicit + intercepted via `meta.mail`) | Implemented |
| Thread management | Implemented |
| Participant roles and permissions | Implemented |
| Mail events (`mail.turn.added`, etc.) | Implemented |
| Subscription filtering for mail events | Implemented |
| Progressive adoption levels (0-4) | Designed |
| `sendWithMail()` convenience on AgentConnection | Implemented |

### What's Missing (Agent-Side)

The current `AgentConnection` exposes mail as **13 individual RPC methods**. This is the right foundation, but agents need higher-level patterns built on top:

1. **No inbox/outbox abstraction** — Agents must poll `mail/turns/list` manually
2. **No reactive mail handling** — No `onMail()` callback pattern like `onMessage()`
3. **No conversation context management** — Agents must manually track conversation IDs
4. **No file coordination** — No way to signal intent to edit files (a key feature of mcp_agent_mail)
5. **No agent directory/discovery** — Agents can't look up peers by capability
6. **No delivery receipts or acknowledgments** — No read/ack tracking
7. **No priority/urgency signaling** — Messages are all treated equally
8. **No macro workflows** — Common multi-step patterns aren't bundled

---

## Interface and Delivery Mechanism

This is the central design question: how does mail actually reach agents, and what does the agent interact with?

### Current Delivery Path

Today MAP has **two separate delivery channels** that operate independently:

```
Channel 1: Ephemeral Messages (map/send → notification/message)
─────────────────────────────────────────────────────────────
Agent A                    MAP Server                    Agent B
   │                          │                            │
   │─── map/send ────────────►│                            │
   │   { to: { agent: B },   │                            │
   │     payload: {...},      │                            │
   │     meta: { mail: {      │                            │
   │       conversationId } } │                            │
   │   }                      │                            │
   │                          │── notification/message ───►│
   │                          │  { message: {              │
   │                          │    id, from, to, payload,  │
   │                          │    meta: { mail: {...} }   │
   │                          │  } }                       │
   │                          │                            │
   │                          │ (server also records       │
   │                          │  an intercepted Turn)      │

Channel 2: Event Subscriptions (mail.* events)
─────────────────────────────────────────────────────────────
Agent B (or Client)        MAP Server
   │                          │
   │─── map/subscribe ───────►│
   │   { filter: {            │
   │     eventTypes:           │
   │       ["mail.turn.added"],│
   │     mail: {               │
   │       conversationId }    │
   │   } }                    │
   │                          │
   │◄── notification/event ───│  (when any turn is added)
   │   { event: {             │
   │     type: "mail.turn.added",
   │     data: {              │
   │       conversationId,    │
   │       turn: { id, participant, contentType, content, ... }
   │     }                    │
   │   } }                    │
```

**The problem:** These two channels are disconnected at the agent interface level. An agent gets messages through `onMessage()` and events through `subscribe()`, but there's no unified "mail arrived" signal. The agent must mentally correlate: "this `notification/message` I received also has a `meta.mail` field, so it's part of a conversation" or "this `mail.turn.added` event corresponds to a turn someone recorded explicitly."

### Proposed Delivery: Unified Mail Handler

The `Mailbox` provides a **single delivery interface** that unifies both channels:

```
                          MAP Server
                              │
                    ┌─────────┴─────────┐
                    │                   │
           notification/message   notification/event
           (has meta.mail)       (mail.turn.added)
                    │                   │
                    └─────────┬─────────┘
                              │
                     ┌────────┴────────┐
                     │  AgentMailManager │  (client-side)
                     │                  │
                     │  Deduplicates    │  ← Same turn can arrive via
                     │  by turn ID     │    both channels simultaneously
                     │                  │
                     │  Enriches with   │  ← Attaches conversation context
                     │  conversation    │    from local cache
                     │  context         │
                     │                  │
                     │  Provides reply  │  ← Wraps turn with .reply(),
                     │  affordances     │    .acknowledge(), .thread()
                     └────────┬─────────┘
                              │
                      MailTurn object
                              │
                    ┌─────────┴──────────┐
                    │                    │
              mailbox.onMail()     mailbox.inbox()
              (push/reactive)      (pull/query)
```

### How Delivery Actually Works

#### Step 1: Agent Opts In

When an agent accesses `agent.mailbox`, the `AgentMailManager` lazily initializes:

```typescript
// Internal: what happens when agent.mailbox is first accessed
class AgentMailManager {
  #subscription: Subscription | null = null;
  #mailHandlers: Set<MailHandler> = new Set();
  #conversationCache: Map<ConversationId, Conversation> = new Map();
  #seenTurnIds: Set<TurnId> = new Set();  // dedup window

  async initialize(connection: AgentConnection) {
    // 1. Subscribe to all mail events for this agent's conversations
    this.#subscription = await connection.subscribe({
      eventTypes: [
        "mail.turn.added",
        "mail.participant.joined",
        "mail.participant.left",
        "mail.created",
        "mail.closed",
      ],
      // Filter to conversations this agent participates in
      // (server enforces this based on session identity)
    });

    // 2. Intercept incoming messages that have meta.mail
    connection.onMessage((message) => {
      if (message.meta?.mail) {
        this.#handleMailMessage(message);
      }
    });

    // 3. Consume event subscription
    this.#consumeEvents();
  }
}
```

#### Step 2: Turn Arrives via Either Channel

A turn can arrive two ways, and the agent sees **exactly one delivery** regardless:

**Path A — Intercepted turn (agent sends via `sendWithMail()`):**

1. Agent A calls `sendWithMail(to, payload, conversationId)`
2. Server routes message to Agent B via `notification/message`
3. Server records intercepted turn, emits `mail.turn.added` event
4. Agent B's `AgentMailManager` receives the message (fast path)
5. It extracts `meta.mail`, creates a `MailTurn` object, delivers to `onMail()` handlers
6. When the `mail.turn.added` event arrives moments later, the turn ID is already in `#seenTurnIds` → deduplicated

**Path B — Explicit turn (agent records via `mail/turn`):**

1. Agent A calls `recordTurn({ conversationId, contentType, content })`
2. Server records turn, emits `mail.turn.added` event
3. Agent B's `AgentMailManager` receives the event via subscription
4. It creates a `MailTurn` object, delivers to `onMail()` handlers
5. No corresponding `notification/message` exists (this was a pure mail operation)

**Path C — Agent not subscribed (fallback to pull):**

1. Agent B never accessed `agent.mailbox` (Level 0/1 agent)
2. Messages still arrive via `onMessage()` as normal
3. Mail events are not received (no subscription)
4. Agent can still call `mailbox.inbox()` later to poll — this calls `mail/turns/list` under the hood

#### Step 3: What the Agent Receives

The `MailTurn` object wraps a raw `Turn` with contextual affordances:

```typescript
interface MailTurn {
  // === Data from the Turn ===
  readonly id: TurnId;
  readonly conversationId: ConversationId;
  readonly participant: ParticipantId;
  readonly contentType: string;
  readonly content: unknown;
  readonly threadId?: ThreadId;
  readonly inReplyTo?: TurnId;
  readonly timestamp: Timestamp;
  readonly source: TurnSource;
  readonly visibility?: TurnVisibility;
  readonly metadata?: Record<string, unknown>;

  // === Contextual Data (enriched by AgentMailManager) ===
  /** The conversation this turn belongs to (from cache or fetched) */
  readonly conversation: Conversation;
  /** The original message, if this turn was intercepted from map/send */
  readonly originalMessage?: Message;

  // === Actions ===
  /** Reply within the same conversation and thread */
  reply(params: {
    contentType: string;
    content: unknown;
    visibility?: TurnVisibility;
  }): Promise<MailTurn>;

  /** Acknowledge receipt (records an x-ack turn) */
  acknowledge(params?: {
    status?: "accepted" | "rejected";
    reason?: string;
  }): Promise<void>;

  /** Create a thread branching from this turn */
  thread(subject?: string): Promise<ConversationContext>;

  /** Forward this turn's content to another conversation */
  forward(conversationId: ConversationId): Promise<MailTurn>;
}
```

### The `onMail()` Handler Contract

```typescript
type MailHandler = (
  turn: MailTurn,
  conversation: Conversation
) => void | Promise<void>;
```

Handlers fire for:
- Turns in conversations this agent participates in
- Both intercepted turns (from `map/send` with `meta.mail`) and explicit turns (from `mail/turn`)
- Turns from **other** participants only (agent doesn't get notified of its own turns)

Handlers do NOT fire for:
- Turns with visibility that excludes this agent
- Turns the agent itself recorded
- Conversations the agent hasn't joined

### Delivery Guarantees

| Property | Guarantee |
|----------|-----------|
| **At-most-once per turn** | Deduplication by turn ID across both channels |
| **Ordering** | Turns delivered in causal order within a conversation (uses MAP's causal buffer) |
| **Offline delivery** | Turns recorded while agent is disconnected are available via `inbox()` after reconnect. `onMail()` fires for turns that arrive during active session only. |
| **Reconnect behavior** | On reconnect, `AgentMailManager` re-subscribes to mail events. It does NOT replay missed turns automatically — agent calls `inbox({ since: lastSeenTimestamp })` to catch up. |
| **Backpressure** | Uses MAP subscription backpressure (`pause()`/`resume()`/`ack()`). If agent is slow, events buffer on server. |

### ConversationContext: Scoped Send Interface

When an agent is actively working within a conversation, `ConversationContext` provides a scoped interface that eliminates ID threading:

```typescript
interface ConversationContext {
  readonly conversationId: ConversationId;
  readonly conversation: Conversation;
  readonly currentThreadId?: ThreadId;

  /** Send a message AND record it as a turn (uses sendWithMail internally) */
  send(
    to: Address,
    payload: unknown,
    meta?: Omit<MessageMeta, "mail">
  ): Promise<{ sendResult: SendResponseResult; turn: Turn }>;

  /** Record a turn without sending a message (pure mail, no routing) */
  record(params: {
    contentType: string;
    content: unknown;
    visibility?: TurnVisibility;
  }): Promise<Turn>;

  /** Sugar for record() with contentType "event" and private visibility */
  log(text: string): Promise<Turn>;

  /** Sugar for record() with contentType "x-tool-call" */
  recordToolCall(
    tool: string,
    input: unknown,
    output: unknown,
    metadata?: Record<string, unknown>
  ): Promise<Turn>;

  /** Create a sub-thread within this conversation */
  thread(rootTurnId: TurnId, subject?: string): Promise<ConversationContext>;

  /** Listen for turns in this specific conversation */
  onTurn(handler: MailHandler): () => void;

  /** Get turn history */
  history(params?: { limit?: number; before?: TurnId }): Promise<Turn[]>;

  /** Invite another participant */
  invite(participantId: ParticipantId, role?: ParticipantRole): Promise<void>;

  /** Hand off to another agent (invite + record handoff turn + optionally leave) */
  handoff(params: {
    to: ParticipantId;
    role?: ParticipantRole;
    reason?: string;
    leave?: boolean;
  }): Promise<void>;

  /** Close the conversation */
  close(reason?: string): Promise<void>;
}
```

**Key implementation detail:** `ctx.send()` calls `agent.sendWithMail()` (which does `map/send` with `meta.mail`), so the message is both **routed to the target** and **recorded as a turn**. This is the dual-channel write path:

```
ctx.send(to, payload)
    │
    ├──► map/send with meta.mail.conversationId
    │        │
    │        ├──► Server routes message to target (Channel 1)
    │        └──► Server records intercepted turn (Channel 2)
    │
    └──► Returns both SendResponseResult and the recorded Turn
```

`ctx.record()` is for turns that don't need routing — internal observations, status updates, tool call logs. These only go through `mail/turn` (Channel 2).

### Where Each Piece Lives

```
┌─────────────────────────────────────────────────────────────────┐
│                       New Files (Agent-Side)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ts-sdk/src/mail/                                                │
│  ├── mailbox.ts           # Mailbox class (inbox/outbox/onMail)  │
│  ├── mail-manager.ts      # AgentMailManager (subscription       │
│  │                        #   management, dedup, dispatch)       │
│  ├── mail-turn.ts         # MailTurn wrapper with reply/ack      │
│  ├── conversation-context.ts  # Scoped send/record interface     │
│  └── index.ts             # Public exports                       │
│                                                                   │
│  ts-sdk/src/connection/agent.ts                                  │
│  └── get mailbox(): Mailbox  # Lazy accessor, new property       │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                     Unchanged (Server-Side)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ts-sdk/src/server/mail/   # No changes needed                   │
│  ts-sdk/src/types/         # No changes needed (Turn, etc.)      │
│  schema/schema.json        # No changes needed                   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

The entire mail interface is **client-side only**. No protocol changes, no new RPC methods, no schema modifications. It's a convenience layer that composes existing primitives.

---

## Design Proposal

### 1. Agent Mailbox Abstraction

Wrap the raw mail RPC calls in a `Mailbox` object that provides inbox/outbox semantics:

```typescript
// Created automatically when agent connects with mail capabilities
const mailbox = agent.mailbox;

// Reactive: get notified of new turns addressed to this agent
mailbox.onMail((turn, conversation) => {
  console.log(`New ${turn.contentType} in ${conversation.subject}`);

  // Reply in-context (conversation and thread tracked automatically)
  turn.reply({
    contentType: "text",
    content: { text: "Acknowledged, working on it." },
  });
});

// Inbox: query turns addressed to this agent
const unread = await mailbox.inbox({ unread: true, limit: 10 });
const fromAgent = await mailbox.inbox({ from: "agent-researcher" });

// Outbox: query turns sent by this agent
const sent = await mailbox.outbox({ since: Date.now() - 3600_000 });

// Active conversations this agent participates in
const active = await mailbox.conversations({ status: "active" });
```

**Key design decisions:**

- `Mailbox` is a **client-side convenience layer**, not a protocol change. It uses existing `mail/*` methods and `mail.*` event subscriptions underneath.
- The `onMail()` handler receives turns filtered to those relevant to this agent (by participant membership + visibility rules).
- `turn.reply()` is sugar for `recordTurn()` with `conversationId`, `threadId`, and `inReplyTo` pre-filled from the incoming turn.

### 2. Conversation Context Manager

Agents working on multi-turn tasks need to maintain conversation context without manually threading IDs through every call:

```typescript
// Start a scoped conversation context
const ctx = await agent.mail.startConversation({
  type: "agent-task",
  subject: "Analyze Q3 revenue data",
  participants: [
    { id: "agent-data-fetcher", role: "worker" },
    { id: "agent-analyst", role: "worker" },
  ],
});

// All sends within this context are auto-tracked as turns
await ctx.send({ agent: "agent-data-fetcher" }, {
  task: "fetch",
  query: "SELECT revenue FROM q3_data",
});

// Record internal observations (not sent to anyone, just logged)
await ctx.log("Data fetcher is responding slowly, may need to retry");

// Record a tool call as a turn
await ctx.recordToolCall("sql_query", { query: "..." }, { rows: 150 });

// Close when done
await ctx.close({ reason: "Analysis complete" });
```

**Implementation:** `ConversationContext` wraps a `conversationId` and automatically:
- Attaches `meta.mail` to all `send()` calls
- Provides `log()` as syntactic sugar for `mail/turn` with `contentType: "event"` and `visibility: { type: "private" }`
- Provides `recordToolCall()` for `contentType: "x-tool-call"` turns
- Tracks the current thread and supports `ctx.thread("subtopic")` to create sub-threads

### 3. Agent Directory and Discovery

Agents need to find peers. MAP already has `agents/list` and `agents/get`, but the mail system needs a higher-level directory that maps capabilities to identities:

```typescript
// Find agents that can help with a task
const analysts = await agent.mail.directory.find({
  role: "worker",
  capabilities: ["data-analysis"],
  status: "idle",
});

// Send a request-for-help to matching agents
const conversation = await agent.mail.requestHelp({
  subject: "Need Q3 data analysis",
  capabilities: ["data-analysis"],
  content: { text: "Please analyze the attached dataset" },
  // Auto-discovers and invites matching agents
});
```

**Implementation:** This builds on `agents/list` with capability-based filtering, then uses `mail/create` + `mail/invite` to set up the conversation. The `requestHelp()` pattern is a macro that combines discovery + conversation creation + invitation.

### 4. File Coordination (Inspired by mcp_agent_mail)

One of mcp_agent_mail's standout features is advisory file reservations. This prevents agents from stepping on each other's work during parallel editing. MAP can adopt this as a mail content type:

```typescript
// Reserve files before editing
const reservation = await agent.mail.reserveFiles({
  patterns: ["src/components/Header.tsx", "src/styles/header.css"],
  exclusive: true,
  ttlSeconds: 300,
  reason: "Refactoring header component",
});

// Check if files are available before starting work
const available = await agent.mail.checkFiles([
  "src/utils/format.ts",
  "src/utils/validate.ts",
]);
// Returns: [{ path: "src/utils/format.ts", available: true },
//           { path: "src/utils/validate.ts", available: false,
//             reservedBy: "agent-linter", until: 1709900000000 }]

// Release when done
await reservation.release();
```

**Protocol extension:** File reservations can be modeled as a special conversation type or as a new content type within mail turns:

```typescript
// Option A: Dedicated content type within mail
contentType: "x-file-reservation"
content: {
  action: "reserve" | "release" | "check",
  patterns: string[],
  exclusive: boolean,
  ttlSeconds: number,
}

// Option B: Scope-based (using MAP scopes as coordination groups)
// Agents in a "file-coordination" scope broadcast reservations as events
```

**Recommendation:** Option A (content type) is simpler and keeps file coordination within the mail system. A dedicated server-side store for active reservations (similar to mcp_agent_mail's SQLite approach) would support efficient conflict checking.

### 5. Delivery Receipts and Acknowledgments

For coordination-critical workflows, agents need to know their messages were received and acted upon:

```typescript
// Send with delivery tracking
const receipt = await ctx.send(
  { agent: "agent-deployer" },
  { action: "deploy", version: "1.2.3" },
  { requireAck: true, ackTimeout: 30_000 }
);

// Wait for acknowledgment
const ack = await receipt.waitForAck();
// { acknowledged: true, by: "agent-deployer", at: 1709900000 }

// On the receiver side:
agent.mailbox.onMail((turn, conversation) => {
  if (turn.requiresAck) {
    // Process the request...
    turn.acknowledge({ status: "accepted" });
    // or: turn.acknowledge({ status: "rejected", reason: "..." });
  }
});
```

**Protocol extension:** Acknowledgments can be modeled as reply turns with `contentType: "x-ack"`, keeping it within the existing turn system. The `requireAck` flag would be added to turn metadata.

### 6. Priority and Urgency

```typescript
// Send urgent mail
await ctx.send(
  { agent: "agent-reviewer" },
  { task: "review", pr: 1234 },
  { priority: "urgent" }
);

// Filter inbox by priority
const urgent = await mailbox.inbox({
  priority: "urgent",
  unread: true,
});
```

**Implementation:** MAP's `map/send` already supports a `priority` field. The mail layer surfaces this in turn metadata and enables filtering on it.

### 7. Macro Workflows

Bundle common multi-step patterns (inspired by mcp_agent_mail's macro tools):

```typescript
// Start session: register, check inbox, announce presence
const session = await agent.mail.startSession({
  greeting: "Online and ready for tasks",
  checkInbox: true,
});
// Returns: { unread: Turn[], activeConversations: Conversation[] }

// Handoff: transfer a conversation to another agent
await ctx.handoff({
  to: "agent-specialist",
  reason: "Needs domain expertise",
  includeHistory: true,
});
// Internally: invites new agent, records handoff turn, optionally leaves

// Broadcast to a scope
await agent.mail.broadcast({
  scope: "backend-team",
  subject: "Breaking API change",
  content: { text: "The /users endpoint now requires auth" },
  priority: "high",
});
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Application                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────┐  ┌────────────────┐  ┌─────────────────────┐  │
│  │ Mailbox  │  │ Conversation   │  │ File Coordination   │  │
│  │          │  │ Context        │  │                     │  │
│  │ .onMail()│  │                │  │ .reserveFiles()     │  │
│  │ .inbox() │  │ .send()        │  │ .checkFiles()       │  │
│  │ .outbox()│  │ .log()         │  │ .release()          │  │
│  │          │  │ .recordTool()  │  │                     │  │
│  └────┬─────┘  └──────┬─────────┘  └──────────┬──────────┘  │
│       │               │                       │              │
│  ┌────┴───────────────┴───────────────────────┴──────────┐  │
│  │              Agent Mail Manager                        │  │
│  │                                                        │  │
│  │  - Subscribes to mail.* events for reactive inbox      │  │
│  │  - Tracks active conversations + threads               │  │
│  │  - Manages file reservation state                      │  │
│  │  - Provides directory/discovery helpers                 │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │                                   │
├───────────────────────────┼───────────────────────────────────┤
│                     AgentConnection                           │
│                           │                                   │
│  ┌────────────────────────┼───────────────────────────────┐  │
│  │  Existing mail/* RPC   │   Existing map/send           │  │
│  │  methods (13 methods)  │   with meta.mail              │  │
│  └────────────────────────┴───────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                      MAP Server
```

### Key Principles

1. **No protocol changes for core features.** Mailbox, ConversationContext, and macros are purely client-side sugar over existing `mail/*` methods and `mail.*` events.

2. **Protocol extensions are minimal.** File coordination and acknowledgments need new content types (`x-file-reservation`, `x-ack`) but no new methods — they're expressed as turns within conversations.

3. **Progressive adoption still works.** An agent that doesn't use the Mailbox abstraction can still participate in conversations via raw RPC. The Mailbox is opt-in sugar.

4. **Server storage for file reservations.** While most features are client-side, file reservation conflict checking needs server-side state for correctness. This could be a new optional building block (like mail itself) or a well-known scope with special semantics.

---

## Comparison with mcp_agent_mail

| Feature | mcp_agent_mail | MAP Agent Mail (Proposed) |
|---------|---------------|---------------------------|
| Agent identity | Auto-generated adjective+noun names | MAP agent IDs (already exist) |
| Message persistence | Git repo + SQLite FTS5 | Server-side stores (pluggable) |
| Inbox/Outbox | Dedicated MCP tools | `Mailbox` abstraction on AgentConnection |
| File reservations | First-class with pre-commit guard | Content type `x-file-reservation` |
| Search | SQLite FTS5 | Turn listing with filters (extensible) |
| Threading | Subject-based + thread IDs | First-class threads rooted at turns |
| Web UI | Built-in at `/mail` | Out of scope (client responsibility) |
| Transport | HTTP-only FastMCP server | Bidirectional streams (WebSocket, etc.) |
| Acknowledgments | Explicit ack tool | `x-ack` content type turns |
| Macro workflows | `macro_start_session`, etc. | `mail.startSession()`, `ctx.handoff()` |
| Multi-repo support | Project keys + contact handshake | Federation (MAP already supports this) |

### What MAP Can Learn from mcp_agent_mail

1. **File reservations are essential for parallel agent work.** mcp_agent_mail's exclusive/non-exclusive lease model with TTL is battle-tested and worth adopting.

2. **Macro tools reduce boilerplate.** Agents shouldn't need 5 RPC calls to start a session. `startSession()` and `handoff()` macros make the common case easy.

3. **Git-backed audit trail is powerful.** MAP's pluggable store interface could support a git-backed store that writes turns as markdown files, giving the same auditability benefits.

4. **Human-readable artifacts matter.** Even if the primary interface is JSON-RPC, being able to browse conversations as markdown files is valuable for debugging and compliance.

### Where MAP Already Exceeds mcp_agent_mail

1. **Real-time streaming.** MAP has bidirectional streams with causal ordering. mcp_agent_mail is poll-based HTTP.

2. **Permission model.** MAP's 4-layer permission system with per-participant conversation permissions is far more granular.

3. **Federation.** MAP can route mail across MAP systems. mcp_agent_mail coordinates only within a single server.

4. **Turn interception.** The `meta.mail` pattern for zero-effort recording has no equivalent in mcp_agent_mail.

5. **Thread hierarchy.** MAP supports nested threads rooted at specific turns. mcp_agent_mail uses flat subject-based threading.

---

## Implementation Priorities

### Phase 1: Client-Side Sugar (No Protocol Changes)

These can be built today on top of existing `mail/*` methods:

| Feature | Effort | Impact |
|---------|--------|--------|
| `Mailbox` abstraction with `onMail()` | Medium | High — makes mail reactive instead of poll-based |
| `ConversationContext` with auto-tracking | Medium | High — eliminates manual ID threading |
| `startSession()` / `handoff()` macros | Small | Medium — reduces boilerplate |
| Agent directory `find()` helper | Small | Medium — wraps existing `agents/list` |

### Phase 2: Content Type Conventions

Define well-known `x-*` content types and helper methods:

| Content Type | Purpose |
|-------------|---------|
| `x-ack` | Delivery acknowledgment |
| `x-tool-call` | Tool invocation record |
| `x-tool-result` | Tool result record |
| `x-status-update` | Agent status change |
| `x-handoff` | Conversation handoff |
| `x-file-reservation` | File coordination |

### Phase 3: Server-Side File Coordination

If file reservations prove important (they will for coding agents), add a lightweight server-side building block:

- `FileReservationManager` with `InMemoryFileReservationStore`
- Methods: `reserve()`, `release()`, `check()`, `listActive()`
- Events: `mail.file.reserved`, `mail.file.released`, `mail.file.conflict`
- Optional: `mail/files/reserve`, `mail/files/check` protocol methods (or keep as turn-based)

### Phase 4: Full-Text Search

For large conversation histories, add search capabilities:

- `mail/search` method with query syntax (inspired by mcp_agent_mail's FTS5)
- Filterable by conversation, participant, content type, date range
- Pluggable search backends (in-memory for dev, SQLite/Elasticsearch for production)

---

## Open Questions

1. **Should file reservations be a mail feature or a separate building block?** They're conceptually different from conversations (coordination vs communication), but keeping them in mail reduces surface area.

2. **Should `Mailbox.onMail()` use event subscriptions or message interception?** Subscriptions to `mail.turn.added` are cleaner but add latency. Intercepting incoming `map/send` messages with `meta.mail` is faster but requires the sender to include mail context.

3. **How should unread tracking work?** Server-side per-participant read cursors, or client-side tracking? Server-side is more reliable but adds storage; client-side is simpler but loses state on disconnect.

4. **Should `ConversationContext` auto-create conversations, or require explicit creation?** Auto-creation is convenient but may lead to orphaned conversations. Explicit creation is safer but more verbose.

5. **Git-backed store: worth building?** mcp_agent_mail's approach of writing turns as dated markdown files is compelling for auditability. Should MAP provide a `GitTurnStore` implementation?
