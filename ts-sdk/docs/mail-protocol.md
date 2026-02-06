# Mail Protocol Guide

The Mail Protocol adds **persistence and structure** to MAP's existing message routing. It provides conversations as containers for tracking interactions, making them queryable, replayable, and observable.

Mail is purely additive - it doesn't replace or duplicate `map/send`. It layers on top.

## Overview

MAP has two orthogonal layers:

| Layer | What it does | Primitive |
|-------|-------------|-----------|
| **Transport** (`map/send`) | Routes messages between agents | Messages (ephemeral) |
| **Persistence** (`mail/*`) | Records communication history | Turns (persistent) |

The three operations:

```
map/send                    Route a message (transport only)
map/send + mail meta        Route AND record (both layers)
mail/turn                   Record a turn only (persistence only)
```

## Server Setup

### Enabling Mail

Mail is disabled by default. Enable it in `MAPServer` configuration:

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";

const server = new MAPServer({
  name: "MyServer",
  version: "1.0.0",
  mail: {
    enabled: true,
  },
});
```

When enabled, the server automatically:
- Creates `ConversationManager`, `TurnManager`, and `ThreadManager` instances
- Registers all 13 `mail/*` protocol handlers
- Advertises mail capabilities in `map/connect` responses
- Intercepts `map/send` calls with `mail` meta to record turns

### Capability Overrides

Control what mail operations participants can perform:

```typescript
const server = new MAPServer({
  mail: {
    enabled: true,
    capabilities: {
      canCreate: true,       // Create conversations (default: true)
      canJoin: true,         // Join conversations (default: true)
      canInvite: false,      // Invite participants (default: true)
      canViewHistory: true,  // View conversation history (default: true)
      canCreateThreads: true, // Create threads (default: true)
    },
  },
});
```

### Custom Storage

By default, all mail data is stored in memory. For production, provide custom stores:

```typescript
const server = new MAPServer({
  mail: {
    enabled: true,
    stores: {
      conversations: new PostgresConversationStore(db),
      turns: new PostgresTurnStore(db),
      threads: new PostgresThreadStore(db),
      participants: new PostgresParticipantStore(db),
    },
  },
});
```

Each store interface is defined in `server/types.ts`:
- `ConversationStore` - CRUD + filtering by type, status, time range, parent
- `TurnStore` - Append/list with cursor pagination, content type and participant filtering
- `ThreadStore` - CRUD + filtering by conversation and parent thread
- `ParticipantStore` - CRUD with bidirectional lookup (by conversation or by participant)

### Custom Managers

For complete control, replace entire managers:

```typescript
const server = new MAPServer({
  mail: {
    enabled: true,
    conversations: new MyConversationManager(),
    turns: new MyTurnManager(),
    threads: new MyThreadManager(),
  },
});
```

### Accessing Mail Managers

When mail is enabled, managers are available on the server instance:

```typescript
if (server.conversations) {
  const result = server.conversations.get("conv-123");
}

// Managers are null when mail is disabled
server.conversations; // ConversationManager | null
server.turns;         // TurnManager | null
server.threads;       // ThreadManager | null
```

## Agent Usage

Agents are the primary mail users. They create conversations, send messages, and record turns.

### Creating a Conversation

```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

const agent = new AgentConnection(stream, { name: "Orchestrator" });
await agent.connect();

// Create a new conversation
const { conversation, participant } = await agent.createConversation({
  type: "multi-agent",
  subject: "Plan Q4 roadmap",
  metadata: { priority: "high" },
});

console.log(`Created ${conversation.id}, joined as ${participant.role}`);
```

### Recording Turns

Use `recordTurn()` to record messages that don't need routing:

```typescript
// Record a user message
await agent.recordTurn({
  conversationId: conversation.id,
  contentType: "text",
  content: "What were our Q3 results?",
});

// Record structured data
await agent.recordTurn({
  conversationId: conversation.id,
  contentType: "data",
  content: { quarter: "Q3", revenue: 1500000, growth: "15%" },
});

// Record a system event
await agent.recordTurn({
  conversationId: conversation.id,
  contentType: "event",
  content: { event: "task.assigned", data: { agent: "analyst-1" } },
});
```

### Sending Messages with Mail Context

Use `sendWithMail()` to route a message AND record it as a turn:

```typescript
// Send to another agent and record in conversation
await agent.sendWithMail(
  { agent: "analyst-1" },
  { text: "Please analyze Q3 data" },
  conversation.id
);

// With thread context
await agent.sendWithMail(
  { agent: "analyst-1" },
  { text: "Focus on revenue trends" },
  conversation.id,
  { threadId: thread.id }
);
```

This is equivalent to calling `send()` with `meta.mail`:

```typescript
await agent.send(
  { agent: "analyst-1" },
  { text: "Please analyze Q3 data" },
  { mail: { conversationId: conversation.id } }
);
```

### Joining and Leaving Conversations

```typescript
// Join an existing conversation
const { conversation, participant, history } = await agent.joinConversation({
  conversationId: "conv-123",
  role: "worker",
  catchUp: { from: "recent", limit: 50, includeSummary: true },
});

// Leave when done
await agent.leaveConversation(conversation.id, "Task complete");
```

### Inviting Participants

```typescript
await agent.inviteToConversation({
  conversationId: conversation.id,
  participant: {
    id: "agent-reviewer",
    role: "observer",
    permissions: { canSend: false, canObserve: true },
  },
  message: "Please review the discussion",
});
```

### Listing and Querying

```typescript
// List conversations this agent participates in
const { conversations } = await agent.listConversations({
  filter: { status: ["active"], type: ["multi-agent"] },
  limit: 20,
});

// Get full conversation details
const details = await agent.getConversation(conversation.id, {
  participants: true,
  recentTurns: 10,
  threads: true,
  stats: true,
});

console.log(`${details.stats.totalTurns} turns, ${details.stats.activeParticipants} active`);

// List turns with filters
const { turns } = await agent.listTurns({
  conversationId: conversation.id,
  filter: { contentTypes: ["text", "data"], participantId: "analyst-1" },
  limit: 50,
  order: "desc",
});
```

### Threading

```typescript
// Create a thread from a turn
const { thread } = await agent.createThread({
  conversationId: conversation.id,
  rootTurnId: turnId,
  subject: "Revenue analysis",
});

// Record a turn in the thread
await agent.recordTurn({
  conversationId: conversation.id,
  contentType: "text",
  content: "Revenue was up 15% QoQ",
  threadId: thread.id,
});

// List threads
const { threads } = await agent.listThreads({
  conversationId: conversation.id,
});
```

### Conversation Summary and Replay

```typescript
// Get a summary
const summary = await agent.getConversationSummary({
  conversationId: conversation.id,
  include: { keyPoints: true, keyDecisions: true },
});

// Replay turns from a specific point
const { turns, hasMore } = await agent.replayConversation({
  conversationId: conversation.id,
  fromTurnId: lastSeenTurnId,
  limit: 100,
});
```

## Client Usage

Clients use the same mail methods as agents. `ClientConnection` provides the identical API surface:

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";

const client = new ClientConnection(stream);
await client.connect();

// All the same methods are available
const { conversation } = await client.createConversation({
  type: "user-session",
  subject: "Customer support request",
});

await client.recordTurn({
  conversationId: conversation.id,
  contentType: "text",
  content: "How do I reset my password?",
});

const { turns } = await client.listTurns({
  conversationId: conversation.id,
});

await client.closeConversation(conversation.id, "Resolved");
```

## Content Types

### Well-Known Types

The protocol defines four well-known content types:

| contentType | content shape | Purpose |
|-------------|--------------|---------|
| `text` | `string` or `{ text: string }` | Human-readable messages |
| `data` | `Record<string, unknown>` | Structured JSON payloads |
| `event` | `{ event: string, data?: unknown }` | Lifecycle/system events |
| `reference` | `{ type: string, id: string, uri?: string }` | Pointers to other entities |

### Custom Types

Custom content types use the `x-` prefix:

```typescript
// Agent framework tool calls
await agent.recordTurn({
  conversationId: conversation.id,
  contentType: "x-tool-call",
  content: { tool: "web-search", input: { query: "Q3 revenue" }, status: "running" },
});

// Agent framework tool results
await agent.recordTurn({
  conversationId: conversation.id,
  contentType: "x-tool-result",
  content: { output: { revenue: 1500000 }, durationMs: 450 },
});
```

Invalid content types (not well-known and not `x-` prefixed) are rejected with an `INVALID_TURN_CONTENT` error.

## Common Patterns

### User Session

Track a user interacting with an agent system:

```typescript
// Orchestrator creates session for user
const { conversation } = await agent.createConversation({
  type: "user-session",
  subject: "Customer support",
  initialParticipants: [
    { id: "support-agent", role: "assistant" },
  ],
});

// Record user messages
await agent.recordTurn({
  conversationId: conversation.id,
  contentType: "text",
  content: "I need help with my account",
});

// Agent responds via routed message
await agent.sendWithMail(
  { agent: "support-agent" },
  { text: "How can I help?" },
  conversation.id
);
```

### Agent Trajectory Tracking

Track an agent's internal work in a child conversation:

```typescript
// Parent: inter-agent communication
const parent = await agent.createConversation({
  type: "multi-agent",
  subject: "Research Q4 sales",
});

// Child: agent's detailed work log
const trajectory = await agent.createConversation({
  type: "agent-task",
  subject: "Agent-A work log",
  parentConversationId: parent.conversation.id,
});

// Record tool calls in the trajectory
await agent.recordTurn({
  conversationId: trajectory.conversation.id,
  contentType: "x-tool-call",
  content: { tool: "database-query", input: { sql: "SELECT * FROM sales WHERE quarter='Q4'" } },
});

await agent.recordTurn({
  conversationId: trajectory.conversation.id,
  contentType: "x-tool-result",
  content: { rows: 150, total_revenue: 2100000 },
});

// Share results back in the parent conversation
await agent.sendWithMail(
  { parent: true },
  { results: { revenue: 2100000 } },
  parent.conversation.id
);
```

### Multi-Agent Collaboration

Coordinate multiple agents in a shared conversation:

```typescript
const { conversation } = await orchestrator.createConversation({
  type: "multi-agent",
  subject: "Sprint planning",
  initialParticipants: [
    { id: "planner-agent", role: "worker" },
    { id: "reviewer-agent", role: "observer", permissions: { canSend: false } },
  ],
});

// Planner works in a thread
const { thread } = await orchestrator.createThread({
  conversationId: conversation.id,
  rootTurnId: kickoffTurnId,
  subject: "Task breakdown",
});

// Agents communicate within the thread
await plannerAgent.sendWithMail(
  { agent: orchestrator.agentId },
  { tasks: ["Design API", "Write tests", "Deploy"] },
  conversation.id,
  { threadId: thread.id }
);
```

## Event Subscriptions

Mail events integrate with `map/subscribe`. Subscribe to mail events using the `mail` filter:

```typescript
// Subscribe to all turns in a conversation
const subscription = await client.subscribe({
  eventTypes: ["mail.turn.added"],
  mail: { conversationId: "conv-123" },
});

for await (const event of subscription) {
  const { conversationId, turn } = event.data;
  console.log(`${turn.participant}: [${turn.contentType}] ${turn.content}`);
}
```

### Available Events

| Event | Description | Key data fields |
|-------|-------------|----------------|
| `mail.created` | Conversation created | `conversationId`, `conversation` |
| `mail.closed` | Conversation closed | `conversationId`, `reason` |
| `mail.participant.joined` | Participant joined | `conversationId`, `participantId` |
| `mail.participant.left` | Participant left | `conversationId`, `participantId` |
| `mail.turn.added` | Turn recorded | `conversationId`, `turn` |
| `mail.turn.updated` | Turn status changed | `conversationId`, `turnId`, `status` |
| `mail.thread.created` | Thread created | `conversationId`, `thread` |
| `mail.summary.generated` | Summary generated | `conversationId` |

### Mail Subscription Filters

The `mail` filter supports AND-logic filtering:

```typescript
// Turns by a specific participant in a thread
await client.subscribe({
  eventTypes: ["mail.turn.added"],
  mail: {
    conversationId: "conv-123",
    threadId: "thread-456",
    participantId: "agent-a",
    contentType: "text",
  },
});

// All mail events for a conversation
await client.subscribe({
  eventTypes: [
    "mail.created", "mail.closed",
    "mail.turn.added", "mail.participant.joined",
  ],
  mail: { conversationId: "conv-123" },
});
```

## `map/send` vs `mail/turn`

Understanding when to use each:

| Scenario | Method | Why |
|----------|--------|-----|
| Agent sends work result to another agent | `sendWithMail()` | Routes message AND records turn |
| User types a message | `recordTurn()` | No routing needed, just persistence |
| System lifecycle event | `recordTurn()` | Record-only, no delivery target |
| Agent internal tool call | `recordTurn()` in child conversation | Trajectory tracking, not communication |
| Agent message outside any conversation | `send()` | No mail involvement |

Key rules:
- `map/send` without `mail` meta: pure routing, no turn recorded
- `map/send` with `mail` meta: routes AND records (turn recording is non-blocking - failures don't affect delivery)
- `mail/turn`: records only, no routing

## API Reference

### AgentConnection / ClientConnection Methods

| Method | Protocol Method | Description |
|--------|----------------|-------------|
| `createConversation(params?)` | `mail/create` | Create a new conversation |
| `getConversation(id, include?)` | `mail/get` | Get conversation with optional includes |
| `listConversations(params?)` | `mail/list` | List conversations with filters |
| `closeConversation(id, reason?)` | `mail/close` | Close a conversation |
| `joinConversation(params)` | `mail/join` | Join with optional catch-up |
| `leaveConversation(id, reason?)` | `mail/leave` | Leave a conversation |
| `inviteToConversation(params)` | `mail/invite` | Invite a participant |
| `recordTurn(params)` | `mail/turn` | Record a turn (no routing) |
| `listTurns(params)` | `mail/turns/list` | List turns with filters |
| `createThread(params)` | `mail/thread/create` | Create a thread |
| `listThreads(params)` | `mail/thread/list` | List threads |
| `getConversationSummary(params)` | `mail/summary` | Get conversation summary |
| `replayConversation(params)` | `mail/replay` | Replay turns from a point |
| `sendWithMail(to, payload, convId, opts?)` | `map/send` + `mail` meta | Route and record |

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| 10000 | `CONVERSATION_NOT_FOUND` | Conversation ID doesn't exist |
| 10001 | `CONVERSATION_CLOSED` | Cannot modify a closed conversation |
| 10002 | `NOT_A_PARTICIPANT` | Caller is not a participant |
| 10003 | `MAIL_PERMISSION_DENIED` | Lacks required permission |
| 10004 | `TURN_NOT_FOUND` | Turn ID doesn't exist |
| 10005 | `THREAD_NOT_FOUND` | Thread ID doesn't exist |
| 10006 | `INVALID_TURN_CONTENT` | Content type validation failed |
| 10007 | `PARTICIPANT_ALREADY_JOINED` | Already a participant |
| 10008 | `INVITATION_REQUIRED` | Cannot join without invitation |
| 10009 | `HISTORY_ACCESS_DENIED` | Cannot access requested history |
| 10010 | `PARENT_CONVERSATION_NOT_FOUND` | Parent conversation doesn't exist |

## Troubleshooting

### Mail methods return "method not found"

Mail is disabled by default. Ensure `mail.enabled` is `true` in server config:

```typescript
const server = new MAPServer({
  mail: { enabled: true },
});
```

### Turns not recorded from `map/send`

The `mail` meta must be present on the send call:

```typescript
// This does NOT record a turn
await agent.send({ agent: "target" }, payload);

// This DOES record a turn
await agent.send({ agent: "target" }, payload, {
  mail: { conversationId: "conv-123" },
});

// Or use the convenience method
await agent.sendWithMail({ agent: "target" }, payload, "conv-123");
```

### Mail capabilities not in connect response

Check that the server has mail enabled. The `capabilities.mail` field is only included when `mail.enabled` is `true`:

```typescript
const result = await agent.connect();
if (result.capabilities?.mail?.enabled) {
  // Mail is available
}
```

### Content type rejected

Only well-known types (`text`, `data`, `event`, `reference`) and custom types with `x-` prefix are accepted. The `x-` prefix must be followed by at least one character:

```typescript
// Valid
"text", "data", "event", "reference", "x-tool-call", "x-my-type"

// Invalid
"custom", "tool-call", "x-"
```

### Turn recording fails silently on `map/send`

Turn recording from `map/send` interception is non-blocking by design. If recording fails (e.g., conversation not found), the message is still delivered. Check server logs for recording errors.
