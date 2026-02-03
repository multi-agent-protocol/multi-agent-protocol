---
title: Wire Protocol
parent: Protocol
nav_order: 2
description: "JSON-RPC 2.0 wire format and transport bindings"
---

# Wire Protocol
{: .no_toc }

JSON-RPC 2.0 message format, method namespacing, and transport bindings.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Design Goals

1. **JSON-RPC 2.0 base** - Same foundation as ACP for tooling compatibility
2. **Bidirectional streaming** - Native support, not bolted on
3. **ACP downgrade path** - Graceful degradation to ACP-only clients
4. **Transport agnostic** - WebSocket, stdio, HTTP/SSE all viable

---

## Message Types

MAP uses four message types over JSON-RPC:

### Request

Expects a response:

```typescript
interface MAPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}
```

### Response

Reply to a request:

```typescript
interface MAPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: MAPError;
}
```

### Notification

No response expected:

```typescript
interface MAPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  // Note: no 'id' field
}
```

### Batch

Multiple messages:

```typescript
type MAPBatch = Array<MAPRequest | MAPNotification>;
```

---

## Method Namespacing

```
map/                    # Full MAP mode methods
  ├── connect
  ├── disconnect
  ├── send
  ├── subscribe
  ├── unsubscribe
  ├── agents/*
  ├── scopes/*
  ├── federation/*
  └── ...

_map/                   # ACP-compat mode (via extMethod)
  ├── agent.list
  ├── hierarchy.get
  ├── scope.list
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
// Client sends connect request
{
  "jsonrpc": "2.0",
  "id": "req_001",
  "method": "map/connect",
  "params": {
    "protocolVersion": "2025-01-01",
    "participantType": "client",
    "clientInfo": {
      "name": "my-dashboard",
      "version": "1.0.0"
    },
    "capabilities": {
      "streaming": true,
      "scopes": true,
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
    "sessionId": "session_001",
    "serverInfo": {
      "name": "map-server",
      "version": "1.0.0"
    },
    "capabilities": {
      "streaming": true,
      "scopes": true,
      "federation": true,
      "replay": true,
      "maxSubscriptions": 100,
      "maxMessageSize": 1048576
    }
  }
}
```

### Phase 3: Graceful Shutdown

```typescript
{
  "jsonrpc": "2.0",
  "id": "req_final",
  "method": "map/disconnect",
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
    "to": { "agent": "agent_worker_001" },
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
        "timestamp": 1706123456789
      }
    ]
  }
}
```

### Addressing

```typescript
type MAPAddress =
  | { agent: string }           // Direct to agent
  | { scope: string }           // Broadcast to scope
  | { role: string }            // All agents with role
  | { agents: string[] }        // Multiple specific agents
  | { parent: true }            // Sender's parent
  | { children: true };         // Sender's children
```

---

## ACP Compatibility Layer

### Mode Detection

```typescript
function detectMode(request: MAPConnectRequest): "full" | "acp-compat" {
  if (request.mode === "acp-compat") return "acp-compat";
  if (!request.capabilities?.streaming) return "acp-compat";
  return "full";
}
```

### Feature Degradation Table

| Feature | Full MAP | ACP-compat |
|:--------|:---------|:-----------|
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

Primary transport for bidirectional streaming:

```typescript
// WebSocket frame format: JSON messages
// Each message is a complete JSON object

const ws = new WebSocket("wss://map.example.com/v1");
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};
```

### Stdio (Subprocess Agents)

NDJSON (newline-delimited JSON) format over stdin/stdout:

```typescript
interface StdioTransport {
  stdin: WritableStream<MAPMessage>;
  stdout: ReadableStream<MAPMessage>;
  stderr: ReadableStream<string>;
}

// Each line is a complete JSON message
// {"jsonrpc":"2.0","method":"map/connect",...}\n
```

### HTTP/SSE (Stateless Clients)

```typescript
// Endpoints:
// POST /map/rpc          - Single RPC call
// GET  /map/events       - SSE event stream
// POST /map/batch        - Batch RPC calls

// SSE event format
event: map.event
data: {"type":"agent.registered","agent":{...}}
```

---

## Error Format

```typescript
interface MAPError {
  code: number;
  message: string;
  data?: {
    category: string;
    retryable?: boolean;
    retryAfter?: number;
    details?: unknown;
  };
}
```

### Standard Error Codes

| Code | Category | Description |
|:-----|:---------|:------------|
| -32700 | protocol | Parse error |
| -32600 | protocol | Invalid request |
| -32601 | protocol | Method not found |
| -32602 | protocol | Invalid params |
| -32603 | protocol | Internal error |
| 1000-1999 | auth | Authentication errors |
| 2000-2999 | routing | Message delivery errors |
| 3000-3999 | agent | Agent lifecycle errors |
| 4000-4999 | resource | Resource exhaustion |
| 5000-5999 | federation | Cross-system errors |

---

## Protocol Extensions

Custom methods use vendor prefixes:

```typescript
{
  "jsonrpc": "2.0",
  "id": "ext_001",
  "method": "x-mycompany/workspace.sync",
  "params": {
    "worktree": "/path/to/worktree",
    "remote": "origin/main"
  }
}
```

---

## Next Steps

- [Streaming](./streaming.html) - Event subscriptions and filtering
- [Error Handling](./error-handling.html) - Error taxonomy and recovery
