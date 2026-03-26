# MAP Trajectory Protocol

## Overview

The Trajectory Protocol is an **optional extension** to MAP that adds agent work trajectory tracking. While MAP's core protocol tracks agent lifecycle and state, and Mail tracks conversations between agents, Trajectory tracks **what agents actually do** — checkpoints of work with extensible metadata.

### Design Rationale

Multi-agent systems need observability not just into agent state (active, idle, stopped) and communication (messages, conversations), but into the **substance of agent work**:

- **Progress visibility**: What was accomplished at each milestone?
- **Cost tracking**: How many resources did an agent consume?
- **Session continuity**: What happened in previous work sessions?
- **Auditability**: A structured log of agent activity over time

Trajectory addresses these needs without changing the core agent lifecycle model. It records checkpoints — snapshots of agent work at meaningful points (task completions, session boundaries, or any agent-defined milestone).

### Design Philosophy

Trajectory is intentionally **minimal and agent-agnostic**. The core checkpoint type carries only universal fields (id, agentId, timestamp, label, sessionId). All domain-specific data — token usage, file lists, AI summaries, VCS info, attribution — goes into a freeform `metadata` bag.

This means:
- A coding agent can store `filesTouched`, `branch`, `commitHash` in metadata
- An LLM agent can store `tokenUsage` with whatever fields its provider uses
- A research agent can store `sourcesConsulted`, `documentsGenerated`
- Any agent can attach whatever makes sense for its workflow

### Relationship to Mail

Mail and Trajectory are **complementary**:

| Aspect | Mail | Trajectory |
|--------|------|-----------|
| **Tracks** | Conversations between participants | Individual agent work output |
| **Unit** | Turn (a message in a conversation) | Checkpoint (a snapshot of work) |
| **Content** | Text, data, events, references | Named artifacts (freeform) |
| **Trigger** | Explicit or intercepted messages | Agent-reported at meaningful milestones |
| **Primary audience** | Other agents, coordinators | Dashboards, auditors, developers |

An agent working on a task might participate in Mail conversations (coordinating with other agents) while also reporting Trajectory checkpoints (recording what work was done).

---

## Concepts

### Checkpoint

A **checkpoint** is the atomic unit of trajectory tracking. It records a snapshot of agent work at a meaningful point:

- **Identity**: Which agent created it (`agentId`)
- **Timing**: When it was created (`timestamp`)
- **Label**: Human-readable description of the milestone (`label`)
- **Session**: Which work session it belongs to (`sessionId`)
- **Metadata**: Extensible key-value bag for agent-specific data (`metadata`)

Checkpoints are reported by agents via `trajectory/checkpoint` and stored server-side for querying.

### Content

Each checkpoint may have associated **content artifacts** — named blobs of data such as session transcripts, logs, prompts, or any other agent-specific content. Artifacts are served on-demand via `trajectory/content` with support for streaming large payloads.

Artifact names are freeform strings. Well-known names include:
- `metadata` — Structured checkpoint metadata
- `transcript` — Session transcript (may be large)
- `prompts` — User prompts
- `context` — Session context

Agents may define their own artifact names as needed.

### Content Streaming

For large artifacts, the response to `trajectory/content` indicates streaming mode:

```
Client                    Server
  |                          |
  |--- trajectory/content -->|  (request with id)
  |                          |
  |<-- response (streaming) -|  (small artifacts inline, streamId, streamInfo)
  |                          |
  |<-- content.chunk [0] ----|  (base64-encoded chunk)
  |<-- content.chunk [1] ----|
  |<-- content.chunk [N] ----|  (final=true, checksum)
```

Small artifacts are returned inline in the response. One large artifact per request can be streamed via chunks.

---

## Methods

### trajectory/checkpoint

**Report a trajectory checkpoint.** Called by agents when they reach a meaningful milestone.

- **Tier**: Extension
- **Callable by**: Agent
- **Capability**: `trajectory.canReport`

```typescript
// Request
{
  method: "trajectory/checkpoint",
  params: {
    checkpoint: {
      id: "a1b2c3d4e5f6",
      agentId: "agent-1",
      label: "Implement JWT authentication middleware",
      sessionId: "sess-abc",
      metadata: {
        agent: "Claude Code",
        branch: "feature/auth",
        commitHash: "abc123def",
        filesTouched: ["src/auth.ts", "src/middleware.ts"],
        tokenUsage: {
          inputTokens: 50000,
          outputTokens: 12000
        }
      }
    }
  }
}

// Response
{
  result: {
    checkpoint: { /* stored checkpoint with server timestamp */ }
  }
}
```

### trajectory/list

**List trajectory checkpoints** with optional filtering and pagination.

- **Tier**: Extension
- **Callable by**: Client, Agent
- **Capability**: `trajectory.canQuery`

```typescript
// Request
{
  method: "trajectory/list",
  params: {
    filter: {
      agentId: "agent-1",
      afterTimestamp: 1706120000000
    },
    limit: 20
  }
}

// Response
{
  result: {
    checkpoints: [ /* ... */ ],
    hasMore: true,
    nextCursor: "ckpt-xyz"
  }
}
```

### trajectory/get

**Get a specific checkpoint** by ID.

- **Tier**: Extension
- **Callable by**: Client, Agent
- **Capability**: `trajectory.canQuery`

### trajectory/content

**Request content artifacts** for a checkpoint. May return inline or initiate streaming.

- **Tier**: Extension
- **Callable by**: Client, Agent
- **Capability**: `trajectory.canRequestContent`

```typescript
// Request
{
  method: "trajectory/content",
  params: {
    checkpointId: "a1b2c3d4e5f6",
    include: ["metadata", "transcript"]
  }
}

// Response (inline — all artifacts fit in a single message)
{
  result: {
    content: {
      streaming: false,
      checkpointId: "a1b2c3d4e5f6",
      artifacts: {
        metadata: { /* structured metadata */ },
        transcript: "{ ... }\n{ ... }\n"
      }
    }
  }
}

// Response (streaming — one large artifact will arrive as chunks)
{
  result: {
    content: {
      streaming: true,
      checkpointId: "a1b2c3d4e5f6",
      streamId: "stream-123",
      artifacts: {
        metadata: { /* inline — small */ },
        prompts: "..."
      },
      streamArtifact: "transcript",
      streamInfo: {
        totalBytes: 2048000,
        totalChunks: 4,
        encoding: "base64"
      }
    }
  }
}
```

### trajectory/content.chunk (notification)

**Content chunk** sent after a streaming content response. Not a request — no response expected.

```typescript
{
  method: "trajectory/content.chunk",
  params: {
    streamId: "stream-123",
    index: 0,
    data: "eyJ0eXBlIjoi...",  // base64-encoded chunk
    final: false
  }
}
```

The final chunk includes `final: true` and a `checksum` (SHA-256 of the full content).

---

## Events

### trajectory.checkpoint

Emitted when an agent reports a checkpoint. Subscribe to track agent work in real-time.

```typescript
{
  type: "trajectory.checkpoint",
  data: {
    checkpoint: { /* TrajectoryCheckpoint */ }
  },
  source: { agentId: "agent-1" }
}
```

### trajectory.content.available

Emitted when full content for a checkpoint becomes available (e.g., after caching from a remote agent).

---

## Capabilities

Add `trajectory` to `ParticipantCapabilities`:

```typescript
trajectory?: {
  enabled?: boolean;           // Server supports trajectory
  canReport?: boolean;         // Can report checkpoints
  canQuery?: boolean;          // Can list/get checkpoints
  canRequestContent?: boolean; // Can request full content from server
  canServeContent?: boolean;   // Can serve content on demand (agent-side)
}
```

Advertised in `map/connect` response when the server supports trajectory tracking.

### Agent Content Serving

When an agent declares `canServeContent: true`, the server may send `trajectory/content.request` notifications to request content on demand. The agent handles the notification and responds with a `trajectory/content.response` notification containing the requested artifacts.

This uses the SDK's **custom notification** mechanism (see below) — the server sends a notification to the agent, and the agent responds with a notification back.

---

## Custom Notifications

The MAP SDK supports custom (non-standard) notifications between servers and agents. This is the mechanism used for on-demand content serving and can be extended for other server-to-agent communication patterns.

### AgentConnection API

```typescript
// Register a handler for a specific notification method
agent.onNotification('trajectory/content.request', async (params) => {
  const { request_id, checkpoint_id } = params;
  // ... read content ...
  agent.sendNotification('trajectory/content.response', {
    request_id,
    transcript: '...',
    metadata: { ... },
  });
});

// Remove a handler
agent.offNotification('trajectory/content.request', handler);

// Send a raw JSON-RPC notification to the server
agent.sendNotification(method, params);
```

### Design Notes

- **Non-breaking**: Agents that don't register handlers see no change (unknown notifications are silently ignored)
- **Fire-and-forget**: Notifications have no built-in request/response correlation. The `request_id` pattern is an application-level convention
- **Capability-gated**: Servers should check agent capabilities before sending custom notifications (e.g., `canServeContent` before sending `trajectory/content.request`)
- **Not a replacement for callExtension**: `onNotification` handles server-to-agent notifications. For agent-to-server requests, use `callExtension()` as before

### Content Request/Response Flow

```
Server                         Agent (canServeContent: true)
  |                               |
  |-- trajectory/content.request -->|  (notification: request_id, checkpoint_id)
  |                               |
  |                               |  (agent reads content from local store)
  |                               |
  |<-- trajectory/content.response -|  (notification: request_id, transcript, metadata)
  |                               |
```

The server initiates by sending a `trajectory/content.request` notification to the agent's WebSocket. The agent's `onNotification` handler fires, reads the content, and sends a `trajectory/content.response` notification back via `sendNotification()`.

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 13000 | TRAJECTORY_NOT_ENABLED | Server does not support trajectory extension |
| 13001 | TRAJECTORY_CHECKPOINT_NOT_FOUND | Checkpoint ID not found |
| 13002 | TRAJECTORY_CONTENT_UNAVAILABLE | Content provider not configured or content not available |
| 13003 | TRAJECTORY_STREAM_FAILED | Streaming content transfer failed |
| 13004 | TRAJECTORY_PERMISSION_DENIED | Insufficient permissions for trajectory operation |
