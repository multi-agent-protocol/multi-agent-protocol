---
title: Connection Model
parent: Protocol
nav_order: 4
description: "Connection lifecycle and client patterns"
---

# Connection Model
{: .no_toc }

How clients connect to MAP systems and the flexibility of subscription patterns.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Design Principles

1. **Single protocol, multiple patterns** - Same wire protocol supports ACP-like single-agent focus through full system observation
2. **Subscription-driven visibility** - What you see depends on what you subscribe to
3. **SDK, not protocol, handles conversion** - Protocol stays simple; SDK provides utilities for common patterns
4. **Multi-agent system is the endpoint** - Clients connect to the system, not individual agents

---

## Connection Lifecycle

### Phase 1: Transport Connection

```
Client                                    MAP System
   │                                          │
   │─────── Transport Connect ───────────────►│
   │        (WebSocket, stdio, etc.)          │
   │                                          │
   │◄────── Transport Accept ────────────────│
   │                                          │
```

### Phase 2: MAP Handshake

```typescript
// Client sends connect request
{
  "method": "map/connect",
  "params": {
    "clientId": "client_001",
    "clientInfo": {
      "name": "my-dashboard",
      "version": "1.0.0"
    },
    "protocolVersion": "2025-01-01",
    "requestedCapabilities": {
      "streaming": true,
      "maxSubscriptions": 10,
      "federation": false
    },
    "auth": {
      "method": "bearer",
      "credential": "..."
    }
  }
}

// Server responds
{
  "result": {
    "sessionId": "session_abc123",
    "participantId": "client_001",
    "serverCapabilities": {
      "streaming": true,
      "maxSubscriptions": 100,
      "federation": true,
      "replay": true
    },
    "systemInfo": {
      "name": "MAP Server",
      "version": "1.0.0",
      "agents": 15
    }
  }
}
```

---

## Client Types

### Operator Client

Full control over the system.

**Typical permissions:**
- Full visibility to all agents, scopes, events
- Can send messages to any agent
- Can register/unregister agents
- Can steer agents (inject context)
- Can create/delete scopes

```typescript
const client = new ClientConnection(stream, {
  name: "operator-console",
  permissions: "operator"
});
```

### Observer Client

Read-only visibility into the system.

**Typical permissions:**
- Full or scoped visibility
- Cannot send messages
- Cannot modify agents or scopes
- Useful for dashboards, monitoring

```typescript
const client = new ClientConnection(stream, {
  name: "monitoring-dashboard",
  permissions: "observer"
});
```

### Agent Client

An agent connecting to participate in the system.

**Typical permissions:**
- Visibility scoped to hierarchy/relationships
- Can send messages to permitted agents
- Receives messages addressed to itself
- Cannot see full system structure (unless permitted)

```typescript
const agent = new AgentConnection(stream, {
  name: "worker-agent",
  role: "processor"
});
```

---

## Subscription Patterns

### Pattern 1: Single-Agent Focus (ACP-like)

Observe only one agent:

```typescript
await client.subscribe({
  filter: { agents: ["agent_001"] },
  streams: ["messages", "state"]
});
```

### Pattern 2: Multi-Agent Dashboard

Observe specific agents:

```typescript
await client.subscribe({
  filter: {
    agents: ["worker_001", "worker_002", "coordinator"]
  },
  streams: ["messages", "state"]
});
```

### Pattern 3: Role-Based Observation

Observe all agents with specific roles:

```typescript
await client.subscribe({
  filter: { roles: ["worker"] },
  streams: ["messages", "state"]
});
```

### Pattern 4: Full System Observation

See everything:

```typescript
await client.subscribe({
  filter: {},  // Empty filter = no filtering
  streams: ["messages", "state", "structure"]
});
```

### Pattern 5: Hierarchical Observation

Observe an agent and all its descendants:

```typescript
await client.subscribe({
  filter: { subtree: "coordinator_001" },
  streams: ["messages", "state", "tasks"]
});
```

---

## Connection State Management

```
┌──────────┐  connect   ┌────────────┐  ready    ┌─────────┐
│ INITIAL  │ ─────────► │ CONNECTING │ ────────► │ ACTIVE  │
└──────────┘            └────────────┘           └────┬────┘
                                                      │
     ┌────────────────────────────────────────────────┤
     │                                                │
     │  disconnect                            error   │
     ▼                                                ▼
┌──────────┐                                 ┌────────────┐
│ CLOSED   │ ◄─────────────────────────────  │ RECONNECT  │
└──────────┘        max retries              └────────────┘
                    exceeded
```

### State Transitions

| From | Event | To |
|:-----|:------|:---|
| INITIAL | `connect()` | CONNECTING |
| CONNECTING | handshake success | ACTIVE |
| CONNECTING | handshake failure | CLOSED |
| ACTIVE | connection lost | RECONNECT |
| ACTIVE | `disconnect()` | CLOSED |
| RECONNECT | reconnect success | ACTIVE |
| RECONNECT | max retries | CLOSED |

---

## Reconnection

### Automatic Reconnection

```typescript
const client = new ClientConnection(stream, {
  name: "my-client",
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  }
});
```

### Reconnection Protocol

```
Client                                    Server
   │                                         │
   │◄─────── Connection Lost ───────────────│
   │                                         │
   │         (backoff: 1s, 2s, 4s, 8s...)   │
   │                                         │
   │─────── Reconnect Attempt ─────────────►│
   │                                         │
   │◄────── Connection Accept ──────────────│
   │                                         │
   │─────── map/reconnect ─────────────────►│
   │         { sessionId, lastEventId }     │
   │                                         │
   │◄────── Reconnect Response ─────────────│
   │         { restored, missedEvents }     │
```

### Session Restoration

```typescript
{
  "method": "map/reconnect",
  "params": {
    "sessionId": "session_abc123",
    "lastEventId": "evt_xyz789",
    "subscriptions": ["sub_001", "sub_002"]
  }
}

// Response
{
  "result": {
    "restored": true,
    "sessionId": "session_abc123",
    "subscriptions": {
      "sub_001": { "restored": true, "missedEvents": 15 },
      "sub_002": { "restored": true, "missedEvents": 3 }
    },
    "replayAvailable": true
  }
}
```

---

## SDK Utilities

### ACP Session Adapter

Convert MAP connection to ACP-compatible session:

```typescript
// Create ACP-compatible session from MAP connection
const session = client.createACPSession("agent_001");

// Now use ACP-like API
await session.prompt("Hello, world");
for await (const chunk of session.stream()) {
  console.log(chunk);
}
```

### Stream Aggregator

Combine multiple subscriptions:

```typescript
const aggregated = client.aggregateStreams([sub1, sub2, sub3]);

for await (const event of aggregated) {
  console.log(event.subscriptionId, event.event);
}
```

### Agent Proxy

Create a proxy object for an agent:

```typescript
const agent = client.createAgentProxy("agent_001");

// Direct method calls become messages
await agent.send({ type: "task", data: "..." });

// State is automatically updated
console.log(agent.state);  // "busy"

// Events are surfaced
agent.on("stateChange", (prev, curr) => {
  console.log(`State: ${prev} → ${curr}`);
});
```

---

## Capability Negotiation

Clients and servers negotiate capabilities during connection:

```typescript
interface CapabilityNegotiation {
  // Client requests
  requested: {
    streaming: boolean;
    maxSubscriptions: number;
    federation: boolean;
    replay: boolean;
  };

  // Server grants (may be less than requested)
  granted: {
    streaming: boolean;
    maxSubscriptions: number;
    federation: boolean;
    replay: boolean;
  };
}
```

---

## Next Steps

- [Error Handling](./error-handling.html) - Handling connection failures
- [Authentication](./authentication.html) - Authentication flows
