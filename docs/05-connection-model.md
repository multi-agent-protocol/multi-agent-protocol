# MAP Connection Model & Client Patterns

This spec details how clients connect to MAP systems, the flexibility of subscription patterns, and how the protocol supports various usage modes.

## Design Principles

1. **Single protocol, multiple patterns**: Same wire protocol supports ACP-like single-agent focus through full system observation
2. **Subscription-driven visibility**: What you see depends on what you subscribe to
3. **SDK, not protocol, handles conversion**: Protocol stays simple; SDK provides utilities for common patterns
4. **Multi-agent system is the endpoint**: Clients connect to the system, not individual agents

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
      "token": "..."
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

### Observer Client

Read-only visibility into the system.

**Typical permissions:**
- Full or scoped visibility
- Cannot send messages
- Cannot modify agents or scopes
- Useful for dashboards, monitoring

### Agent Client

An agent connecting to participate in the system.

**Typical permissions:**
- Visibility scoped to hierarchy/relationships
- Can send messages to permitted agents
- Receives messages addressed to itself
- Cannot see full system structure (unless permitted)

---

## Subscription Patterns

### Pattern 1: Single-Agent Focus (ACP-like)

```typescript
await map.subscribe({
  filter: { agents: ["agent_001"] },
  streams: ["messages", "state"]
});
```

### Pattern 2: Multi-Agent Dashboard

```typescript
await map.subscribe({
  filter: { agents: ["worker_001", "worker_002", "coordinator"] },
  streams: ["messages", "state"]
});
```

### Pattern 3: Role-Based Observation

```typescript
await map.subscribe({
  filter: { roles: ["worker"] },
  streams: ["messages", "state"]
});
```

### Pattern 4: Full System Observation

```typescript
await map.subscribe({
  filter: {},  // Empty filter = no filtering
  streams: ["messages", "state", "structure"]
});
```

### Pattern 5: Multiple Subscriptions

```typescript
// Subscription 1: High-priority messages only
const urgentSub = await map.subscribe({
  filter: { messagePriorities: ["urgent", "high"] },
  streams: ["messages"]
});

// Subscription 2: All state changes
const stateSub = await map.subscribe({
  filter: {},
  streams: ["state"]
});
```

---

## SDK Utilities

### ACP Session Adapter

```typescript
// Create ACP-compatible session from MAP connection
const session = mapSdk.createACPSession(connection, "agent_001");

// Now use ACP-like API
await session.prompt("Hello, world");
```

### Stream Aggregator

```typescript
// Combine multiple subscriptions into one stream
const aggregated = mapSdk.aggregateStreams([sub1, sub2, sub3]);

for await (const event of aggregated) {
  console.log(event.subscriptionId, event.event);
}
```

### Agent Proxy

```typescript
// Create a proxy object for an agent
const agent = mapSdk.createAgentProxy(connection, "agent_001");

// Direct method calls become messages
await agent.send({ type: "task", data: "..." });

// State is automatically updated
console.log(agent.state);  // "busy"
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

---

## Capability Negotiation

### Client Capabilities

```typescript
interface MAPClientCapabilities {
  streaming: boolean;
  maxConcurrentStreams?: number;
  maxSubscriptions?: number;
  maxMessageSize?: number;
  supportedEncodings?: string[];
  federation?: boolean;
  replay?: boolean;
}
```

### System Capabilities

```typescript
interface MAPSystemCapabilities {
  protocolVersions: string[];
  streaming: boolean;
  federation: boolean;
  replay: boolean;
  replayWindow?: number;
  maxSubscriptions: number;
  maxMessageSize: number;
  maxConcurrentConnections: number;
  extensions?: string[];
}
```

---

## Open Questions

1. **Session affinity**: Should subscriptions be tied to connection or transferable?
2. **Subscription limits**: Per-connection or per-client (across reconnects)?
3. **Capability versioning**: How to handle capability changes across protocol versions?
4. **Auth refresh**: How to handle token expiration during long-lived connections?
5. **Partial visibility**: Can a client request "all agents I can see" without knowing IDs upfront?
