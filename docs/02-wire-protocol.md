# MAP Wire Protocol & ACP Compatibility Layer

> **Status (2026-06):** Predates the consolidation recut and uses an older method vocabulary. The current protocol uses `map/connect` / `map/disconnect` (not `map/initialize` / `map/shutdown`), `map/agents/*` / `map/scopes/*` (not `map/agent.*` / `map/scope.*`), and a 23-method core + separately-versioned extensions. ACP interop is now the `acp-tunnel` extension (payload `protocol: "acp"` over `map/send`), not the `_map/` compat namespace described here. See [14-consolidation-plan.md](14-consolidation-plan.md), [map-ext.md](map-ext.md), and [registry.md](registry.md).

This spec details the wire protocol format for MAP and how it maintains compatibility with ACP.

## Design Goals

1. **JSON-RPC 2.0 base** - Same foundation as ACP for tooling compatibility
2. **Bidirectional streaming** - Native support, not bolted on
3. **ACP downgrade path** - Graceful degradation to ACP-only clients
4. **Transport agnostic** - WebSocket, stdio, HTTP/SSE all viable

---

## Wire Protocol Format

### Message Types

MAP uses four message types over JSON-RPC:

```typescript
// 1. Request (expects response)
interface MAPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

// 2. Response (to a request)
interface MAPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: MAPError;
}

// 3. Notification (no response expected)
interface MAPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  // Note: no 'id' field
}

// 4. Batch (multiple messages)
type MAPBatch = Array<MAPRequest | MAPNotification>;
```

### Method Namespacing

```
map/                    # Full MAP mode methods
  ├── initialize
  ├── agent.*
  ├── hierarchy.*
  ├── scope.*
  ├── send
  ├── request
  ├── broadcast
  ├── inject
  ├── subscribe
  ├── task.*
  ├── role.*
  ├── env.*
  └── user.*

_map/                   # ACP-compat mode (via extMethod)
  ├── agent.list
  ├── hierarchy.get
  ├── scope.list
  ├── send
  ├── broadcast
  ├── task.list
  └── subscribe
```

---

## Protocol Phases

### Phase 1: Connection Establishment

```
Client                                    Server
   │                                         │
   │─────── Transport Connect ──────────────►│
   │                                         │
   │◄────── Transport Accept ───────────────│
   │                                         │
```

### Phase 2: Protocol Negotiation

```typescript
// Client sends initialize request
{
  "jsonrpc": "2.0",
  "id": "req_001",
  "method": "map/initialize",
  "params": {
    "protocolVersion": "2025-01-01",
    "mode": "full",                    // or "acp-compat"
    "clientInfo": {
      "name": "macro-agent",
      "version": "1.0.0"
    },
    "capabilities": {
      "streaming": true,
      "scopes": true,
      "tasks": true,
      "roles": true,
      "environments": true,
      "federation": false
    }
  }
}

// Server responds with negotiated capabilities
{
  "jsonrpc": "2.0",
  "id": "req_001",
  "result": {
    "protocolVersion": "2025-01-01",
    "mode": "full",
    "serverInfo": {
      "name": "map-server",
      "version": "1.0.0"
    },
    "capabilities": {
      "streaming": true,
      "scopes": true,
      "tasks": true,
      "roles": true,
      "environments": true,
      "federation": true,
      "replay": true,
      "deliverySemantics": ["inject", "interrupt", "queue", "best-effort"],
      "maxSubscriptions": 100,
      "maxMessageSize": 1048576
    },
    "agentId": "agent_root_001"
  }
}
```

### Phase 3: Graceful Shutdown

```typescript
// Client initiates shutdown
{
  "jsonrpc": "2.0",
  "id": "req_final",
  "method": "map/shutdown",
  "params": {
    "reason": "user_requested",
    "timeout": 5000,
    "cascade": true
  }
}
```

---

## Messaging Wire Format

### Send Message

```typescript
// Request
{
  "jsonrpc": "2.0",
  "id": "msg_001",
  "method": "map/send",
  "params": {
    "to": { "type": "agent", "id": "agent_worker_001" },
    "payload": {
      "type": "task_assignment",
      "task": {
        "id": "task_001",
        "description": "Review PR #123"
      }
    },
    "meta": {
      "priority": "high",
      "delivery": "inject",
      "ttl": 60000,
      "requireAck": true
    }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": "msg_001",
  "result": {
    "messageId": "envelope_a1b2c3",
    "delivered": 1,
    "receipts": [
      {
        "agentId": "agent_worker_001",
        "status": "delivered",
        "semantic": "inject",
        "timestamp": 1706123456789
      }
    ]
  }
}
```

---

## ACP Compatibility Layer

### Mode Detection

```typescript
function detectMode(request: MAPInitializeRequest): "full" | "acp-compat" {
  if (request.mode === "acp-compat") return "acp-compat";
  if (!request.capabilities?.streaming) return "acp-compat";
  if (!request.mode && request.clientCapabilities) return "acp-compat";
  return "full";
}
```

### Feature Degradation Table

| Feature | Full MAP | ACP-compat |
|---------|----------|------------|
| Multi-agent context | Native | Session-per-agent |
| Streaming | Native bidirectional | Via sessionUpdate |
| Hierarchy queries | Full tree ops | Flat list only |
| Scopes | Full CRUD | Read-only listing |
| Delivery semantics | All 4 modes | Best-effort only |
| Federation | Supported | Not available |
| Subscriptions | Multiple concurrent | Single per session |

---

## Transport Bindings

### WebSocket

```typescript
// Primary transport for bidirectional streaming
// WebSocket frame format: NDJSON (newline-delimited JSON)
// Each message is a single line of JSON followed by \n
```

### Stdio (for subprocess agents)

```typescript
// Same NDJSON format over stdin/stdout
interface StdioTransport {
  stdin: WritableStream<MAPMessage>;
  stdout: ReadableStream<MAPMessage>;
  stderr: ReadableStream<string>;
}
```

### HTTP/SSE (for stateless clients)

```typescript
// Endpoints:
// POST /map/rpc          - Single RPC call
// GET  /map/events       - SSE event stream
// POST /map/batch        - Batch RPC calls
```

---

## Protocol Extensions

### Custom Methods

```typescript
// Vendor-specific extension
{
  "jsonrpc": "2.0",
  "id": "ext_001",
  "method": "macro/workspace.sync",
  "params": {
    "worktree": "/path/to/worktree",
    "remote": "origin/main"
  }
}
```

---

## Open Questions

1. **Compression**: Should we support message compression (gzip, brotli)?
2. **Batching**: Should batch responses preserve order or allow reordering?
3. **Heartbeat**: Explicit ping/pong or rely on transport-level?
4. **Message size limits**: Hard protocol limit or capability-negotiated?
