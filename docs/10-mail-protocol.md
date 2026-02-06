# MAP Mail Protocol

## Overview

The Mail Protocol is an **optional extension** to MAP that adds persistent conversation tracking on top of the ephemeral messaging layer. While `map/send` routes messages between agents in real-time, Mail records these interactions as **turns** within **conversations**, creating a queryable history of multi-agent coordination.

### Design Rationale

MAP's core messaging (`map/send`) is ephemeral: messages are routed and delivered, but the system does not retain them. This is sufficient for simple request-response patterns, but multi-agent orchestration often needs:

- **Auditability**: What happened during a complex multi-agent task?
- **Context sharing**: A new agent joining mid-conversation needs history.
- **Observability**: Dashboards and UIs need to display interaction timelines.
- **Trajectory tracking**: Recording an agent's internal tool calls and reasoning steps.

Mail addresses these needs without changing the core messaging model. It is a **persistence layer**, not a separate communication channel.

### Relationship to `map/send`

```
┌─────────────────────────────────────────────────────────────┐
│                    map/send (Transport Layer)                 │
│                                                               │
│   Routes messages between agents in real-time.               │
│   Ephemeral - not retained after delivery.                   │
│                                                               │
│   When meta.mail is present:                                 │
│   ├── Message is routed normally (unchanged behavior)        │
│   └── Turn is automatically recorded in the conversation     │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│                  mail/* (Persistence Layer)                   │
│                                                               │
│   Manages conversations, participants, turns, threads.       │
│   Queryable - history available via mail/turns/list.         │
│   Observable - mail.* events emitted for subscriptions.      │
│                                                               │
│   Two ways to record turns:                                  │
│   ├── Explicit: mail/turn (direct API call)                  │
│   └── Intercepted: map/send with meta.mail (automatic)       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Relationship to A2A Conversations

MAP deliberately avoids A2A's conversation/artifact split (see [01-open-questions.md](01-open-questions.md), Q7.5). Mail takes a different approach:

| A2A | MAP Mail |
|-----|----------|
| Conversations are the transport | `map/send` is the transport; conversations are an overlay |
| Messages and Artifacts are separate | Turns are the unified record (content type distinguishes) |
| Every interaction requires a Task | Conversations are optional; agents work without them |
| Conversation is required for communication | Communication works without mail; mail adds persistence |

---

## Concepts

### Conversation

A **conversation** is a container for tracking related interactions between participants. It has a lifecycle (active → completed/failed/archived), a type that describes its purpose, and optional hierarchical relationships to other conversations.

**Types**:
- `user-session` - A session initiated by a user
- `agent-task` - An agent working on a specific task
- `multi-agent` - Coordination between multiple agents
- `mixed` - General purpose

**Status**: `active` | `paused` | `completed` | `failed` | `archived`

### Turn

A **turn** is the atomic unit of conversation. It records what a participant intentionally communicates, along with metadata about how it was created.

**Content types** (well-known):
- `text` - Text content (`{ text: string }`)
- `data` - Structured data (any JSON)
- `event` - Status/lifecycle events (`{ event: string, ... }`)
- `reference` - Reference to external content (`{ uri: string, ... }`)
- `x-*` - Custom types (e.g., `x-tool-call`, `x-reasoning-step`)

**Source tracking**:
- `explicit` - Created directly via `mail/turn`
- `intercepted` - Auto-recorded from `map/send` with `meta.mail`

### Thread

A **thread** is a focused sub-discussion within a conversation, rooted at a specific turn. Threads can be nested (a thread within a thread).

### Participant

A conversation **participant** has a role and permissions that control what they can do within the conversation.

**Roles**: `initiator` | `assistant` | `worker` | `observer` | `moderator`

**Permissions**: `canSend`, `canObserve`, `canInvite`, `canRemove`, `canCreateThreads`, `historyAccess` (`none` | `from-join` | `full`), `canSeeInternal`

### Turn Visibility

Individual turns can have visibility restrictions:
- `all` - All participants can see
- `participants` - Only specified participant IDs
- `role` - Only participants with specified roles
- `private` - Only the author

---

## Capability Negotiation

Mail support is advertised in the `map/connect` response via `capabilities.mail`:

```typescript
// Connect request (client declares desired capabilities)
{
  method: "map/connect",
  params: {
    capabilities: {
      mail: { canCreate: true, canViewHistory: true }
    }
  }
}

// Connect response (server declares what's available)
{
  result: {
    capabilities: {
      mail: {
        enabled: true,            // Mail is available
        canCreate: true,          // This participant can create conversations
        canJoin: true,            // Can join existing conversations
        canInvite: true,          // Can invite others
        canViewHistory: true,     // Can query history
        canCreateThreads: true    // Can create threads
      }
    }
  }
}
```

If `capabilities.mail` is absent or `enabled` is false, the server does not support mail. Clients should degrade gracefully.

---

## Protocol Methods

All mail methods use the `mail/` namespace. They are Tier 3 (Extension) methods.

### mail/create

Create a new conversation. The caller automatically joins as initiator.

**Request**:
```json
{
  "method": "mail/create",
  "params": {
    "type": "multi-agent",
    "subject": "Sprint planning discussion",
    "parentConversationId": "conv-parent",
    "parentTurnId": "turn-that-spawned-this",
    "initialParticipants": [
      { "id": "agent-researcher", "role": "worker" },
      { "id": "agent-writer", "role": "worker" }
    ],
    "initialTurn": {
      "contentType": "text",
      "content": { "text": "Let's plan the sprint." }
    },
    "metadata": { "project": "map-sdk" }
  }
}
```

**Response**:
```json
{
  "result": {
    "conversation": { "id": "conv-001", "type": "multi-agent", "status": "active", ... },
    "participant": { "id": "caller-id", "role": "initiator", ... },
    "initialTurn": { "id": "turn-001", ... }
  }
}
```

### mail/get

Get conversation details with optional includes.

**Request**:
```json
{
  "method": "mail/get",
  "params": {
    "conversationId": "conv-001",
    "include": {
      "participants": true,
      "threads": true,
      "recentTurns": 10,
      "stats": true
    }
  }
}
```

### mail/list

List conversations with filtering and cursor-based pagination.

**Request**:
```json
{
  "method": "mail/list",
  "params": {
    "filter": {
      "type": ["user-session", "multi-agent"],
      "status": ["active"],
      "participantId": "agent-001"
    },
    "limit": 20,
    "cursor": "cursor-token"
  }
}
```

### mail/close

Close a conversation. Sets status to `completed`.

**Request**:
```json
{
  "method": "mail/close",
  "params": {
    "conversationId": "conv-001",
    "reason": "Task completed successfully"
  }
}
```

### mail/join

Join a conversation with optional catch-up (receive recent history).

**Request**:
```json
{
  "method": "mail/join",
  "params": {
    "conversationId": "conv-001",
    "role": "worker",
    "catchUp": {
      "from": 1706745600000,
      "limit": 50,
      "includeSummary": true
    }
  }
}
```

**Response** includes `history` (recent turns) and optionally `summary` if `includeSummary` was true.

### mail/leave

Leave a conversation.

**Request**:
```json
{
  "method": "mail/leave",
  "params": {
    "conversationId": "conv-001",
    "reason": "Work complete"
  }
}
```

### mail/invite

Invite a participant to a conversation.

**Request**:
```json
{
  "method": "mail/invite",
  "params": {
    "conversationId": "conv-001",
    "participant": {
      "id": "agent-reviewer",
      "role": "observer",
      "permissions": { "canSend": false, "historyAccess": "from-join" }
    },
    "message": "Please review the conversation so far."
  }
}
```

### mail/turn

Record a turn explicitly. The caller must be a participant.

**Request**:
```json
{
  "method": "mail/turn",
  "params": {
    "conversationId": "conv-001",
    "contentType": "text",
    "content": { "text": "Here are the research results." },
    "threadId": "thread-001",
    "inReplyTo": "turn-005",
    "visibility": { "type": "all" },
    "metadata": { "source": "research-tool" }
  }
}
```

### mail/turns/list

List turns with filtering and pagination.

**Request**:
```json
{
  "method": "mail/turns/list",
  "params": {
    "conversationId": "conv-001",
    "filter": {
      "threadId": "thread-001",
      "contentTypes": ["text", "data"],
      "participantId": "agent-001",
      "afterTimestamp": 1706745600000
    },
    "limit": 50,
    "order": "asc"
  }
}
```

### mail/thread/create

Create a thread rooted at a specific turn.

**Request**:
```json
{
  "method": "mail/thread/create",
  "params": {
    "conversationId": "conv-001",
    "rootTurnId": "turn-005",
    "subject": "Deep dive on React performance",
    "parentThreadId": "thread-001"
  }
}
```

### mail/thread/list

List threads in a conversation.

**Request**:
```json
{
  "method": "mail/thread/list",
  "params": {
    "conversationId": "conv-001",
    "parentThreadId": "thread-001"
  }
}
```

### mail/summary

Get or generate a summary for a conversation.

**Request**:
```json
{
  "method": "mail/summary",
  "params": {
    "conversationId": "conv-001",
    "scope": { "threadId": "thread-001" },
    "regenerate": false,
    "include": {
      "keyPoints": true,
      "keyDecisions": true,
      "openQuestions": true
    }
  }
}
```

### mail/replay

Replay turns from a specific point (for catch-up after reconnection).

**Request**:
```json
{
  "method": "mail/replay",
  "params": {
    "conversationId": "conv-001",
    "fromTurnId": "turn-010",
    "threadId": "thread-001",
    "limit": 100,
    "contentTypes": ["text", "data"]
  }
}
```

---

## Turn Interception via map/send

When `map/send` includes `meta.mail`, the server automatically records an intercepted turn in addition to routing the message normally. This is the primary mechanism for zero-effort turn recording.

```json
{
  "method": "map/send",
  "params": {
    "to": { "agent": "worker-1" },
    "payload": { "task": "research", "query": "MAP protocol" },
    "meta": {
      "mail": {
        "conversationId": "conv-001",
        "threadId": "thread-001",
        "inReplyTo": "turn-005",
        "visibility": { "type": "all" }
      }
    }
  }
}
```

**Behavior**:
1. Message is routed to `worker-1` normally (unchanged `map/send` behavior)
2. A turn is recorded with `source: { type: "intercepted", messageId: "<id>" }`
3. A `mail.turn.added` event is emitted
4. If turn recording fails, the message delivery is NOT affected (non-blocking)

---

## Events

Mail emits the following events (delivered via `map/event` to subscribers):

| Event Type | Data | Emitted When |
|------------|------|-------------|
| `mail.created` | `{ conversationId, type, subject?, createdBy }` | Conversation created |
| `mail.closed` | `{ conversationId, closedBy, reason? }` | Conversation closed |
| `mail.participant.joined` | `{ conversationId, participant }` | Participant joins |
| `mail.participant.left` | `{ conversationId, participantId, reason? }` | Participant leaves |
| `mail.turn.added` | `{ conversationId, turn }` | Turn recorded (explicit or intercepted) |
| `mail.turn.updated` | `{ conversationId, turnId, status? }` | Turn status updated |
| `mail.thread.created` | `{ conversationId, thread }` | Thread created |
| `mail.summary.generated` | `{ conversationId, summary }` | Summary generated |

### Mail Subscription Filtering

The `SubscriptionFilter` supports a `mail` field for filtering mail events:

```json
{
  "method": "map/subscribe",
  "params": {
    "filter": {
      "eventTypes": ["mail.turn.added", "mail.participant.joined"],
      "mail": {
        "conversationId": "conv-001",
        "threadId": "thread-001",
        "participantId": "agent-001",
        "contentType": "text"
      }
    }
  }
}
```

All mail filter fields use AND logic. Only `mail.*` events are matched.

---

## Error Codes

Mail uses error codes in the 10000 range:

| Code | Name | Description |
|------|------|-------------|
| 10000 | CONVERSATION_NOT_FOUND | Conversation ID does not exist |
| 10001 | CONVERSATION_CLOSED | Cannot modify a closed conversation |
| 10002 | NOT_A_PARTICIPANT | Caller is not a participant in the conversation |
| 10003 | MAIL_PERMISSION_DENIED | Caller lacks required mail capability |
| 10004 | PARTICIPANT_ALREADY_JOINED | Participant is already in the conversation |
| 10005 | PARTICIPANT_NOT_FOUND | Participant not found in the conversation |
| 10006 | TURN_NOT_FOUND | Turn ID does not exist |
| 10007 | THREAD_NOT_FOUND | Thread ID does not exist |
| 10008 | INVALID_CONTENT_TYPE | Content type not recognized (must be well-known or `x-` prefixed) |
| 10009 | THREAD_NESTING_LIMIT | Thread nesting depth exceeded |
| 10010 | MAIL_NOT_ENABLED | Server does not have mail enabled |

---

## Progressive Adoption

Mail is designed for incremental integration. Agents can participate in conversations with zero code changes and adopt richer features over time.

### Level 0: Unaware Agent (Zero Changes)

Agents that don't know about mail work exactly as before. If an orchestrator sends them a message with `meta.mail`, the agent receives the message normally and ignores the unknown `mail` key. The orchestrator is responsible for tracking the conversation.

### Level 1: Pass-Through Agent (One Line)

An agent forwards `meta.mail` from incoming messages to its replies. This ensures replies are recorded as turns without the agent understanding mail.

```
Incoming message has meta.mail → agent processes → reply includes meta.mail
```

### Level 2: Conversation-Aware Agent

An agent that reads `meta.mail.conversationId` and explicitly records turns via `mail/turn`. Useful for agents that want to log observations, status events, or intermediate results.

### Level 3: Orchestrator (Full Integration)

An orchestrator creates conversations, manages participants, delegates with mail context, and closes conversations when work is complete.

### Level 4: Observer Client (Dashboard/UI)

A client that subscribes to `mail.*` events and queries `mail/turns/list` to display conversation timelines. Does not participate in conversations, only watches.

---

## Server Implementation

A server that supports mail needs:

1. **Storage** for conversations, participants, turns, and threads (in-memory or persistent)
2. **Turn interception** in the `map/send` handler (record turn when `meta.mail` is present)
3. **Method handlers** for all `mail/*` methods
4. **Event emission** for `mail.*` events via the EventBus
5. **Capability advertisement** in the `map/connect` response (`capabilities.mail`)
6. **Subscription filtering** for `mail` filter fields on `mail.*` events

Mail is enabled per-server. When `mail` is not configured, `mail/*` methods return error 10010 (MAIL_NOT_ENABLED).

---

## Related Specs

- [00-design-specification.md](00-design-specification.md): Protocol overview and method tiers
- [02-wire-protocol.md](02-wire-protocol.md): JSON-RPC wire format (mail uses the same format)
- [03-streaming-semantics.md](03-streaming-semantics.md): Event streaming (mail events follow the same semantics)
- [04-error-handling.md](04-error-handling.md): Error handling patterns (mail errors use the same structure)
