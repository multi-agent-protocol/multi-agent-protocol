---
title: Client Integration
parent: Guides
grand_parent: SDK
nav_order: 2
description: "Build clients that observe and interact with MAP systems"
---

# Client Integration
{: .no_toc }

Build clients that observe agent activity and send messages.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## When to Use ClientConnection

Use `ClientConnection` when building:
- Dashboards that monitor agent activity
- Control panels that manage agents
- Applications that send work to agents
- Tools that aggregate events from agents

---

## Basic Usage

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";

// Create connection
const client = new ClientConnection(stream, {
  name: "Dashboard",
});

// Connect to server
const result = await client.connect();
console.log(`Connected to ${result.systemInfo?.name}`);
console.log(`Session ID: ${result.sessionId}`);

// Disconnect when done
await client.disconnect();
```

---

## Connection Options

```typescript
const client = new ClientConnection(stream, {
  name: "MyClient",              // Client name shown in server
  reconnect: {
    enabled: true,               // Auto-reconnect on disconnect
    maxAttempts: 10,             // Maximum reconnection attempts
    baseDelayMs: 1000,           // Initial delay between attempts
    maxDelayMs: 30000,           // Maximum delay (exponential backoff)
  },
});
```

---

## Querying Agents

### List All Agents

```typescript
const { agents } = await client.listAgents();

agents.forEach((agent) => {
  console.log(`${agent.name} (${agent.id})`);
  console.log(`  Role: ${agent.role}`);
  console.log(`  State: ${agent.state}`);
});
```

### Filter Agents

```typescript
// By role
const { agents: workers } = await client.listAgents({
  role: "worker",
});

// By state
const { agents: active } = await client.listAgents({
  state: "running",
});

// By scope membership
const { agents: inScope } = await client.listAgents({
  scopeId: "scope-123",
});
```

### Get Single Agent

```typescript
const { agent } = await client.getAgent("agent-id");
if (agent) {
  console.log(`Agent ${agent.name} is ${agent.state}`);
}
```

---

## Event Subscriptions

### Subscribe to Events

```typescript
// Subscribe to specific event types
const subscription = await client.subscribe({
  eventTypes: ["agent.registered", "agent.unregistered"],
});

// Process events
for await (const event of subscription) {
  console.log(`Event: ${event.type}`);
  console.log(`Data:`, event.data);
}
```

### Event Type Patterns

```typescript
// All agent events
const subscription = await client.subscribe({
  eventTypes: ["agent.*"],
});

// All events
const subscription = await client.subscribe({
  eventTypes: ["*"],
});

// Multiple specific types
const subscription = await client.subscribe({
  eventTypes: [
    "agent.registered",
    "agent.unregistered",
    "scope.created",
    "message.sent",
  ],
});
```

### Scope-Filtered Events

```typescript
// Only events from specific scopes
const subscription = await client.subscribe({
  eventTypes: ["message.*"],
  scopeIds: ["scope-123", "scope-456"],
});
```

### Managing Subscriptions

```typescript
const subscription = await client.subscribe({ eventTypes: ["*"] });

// Pause event delivery
await subscription.pause();

// Resume
await subscription.resume();

// Unsubscribe
await subscription.unsubscribe();
```

---

## Sending Messages

### Send to Agent

```typescript
await client.send({
  to: { agentId: "agent-123" },
  payload: {
    type: "task",
    data: { action: "process", item: "item-456" },
  },
});
```

### Send to Scope

```typescript
// Message all agents in scope
await client.send({
  to: { scopeId: "scope-123" },
  payload: {
    type: "announcement",
    message: "System maintenance in 5 minutes",
  },
});
```

---

## Event Replay

Replay events you may have missed:

```typescript
// Replay from specific event
const events = await client.replay({
  afterEventId: "event-123",
  limit: 100,
});

events.forEach((event) => {
  console.log(`Missed event: ${event.type}`);
});

// Replay with filter
const agentEvents = await client.replay({
  afterEventId: "event-123",
  eventTypes: ["agent.*"],
  limit: 50,
});
```

---

## Session Resume

Resume a disconnected session:

```typescript
// First connection
const client = new ClientConnection(stream, { name: "Dashboard" });
const { resumeToken } = await client.connect();

// Store resumeToken somewhere safe
saveToken(resumeToken);

// Later, resume the session
const client2 = new ClientConnection(newStream, { name: "Dashboard" });
const result = await client2.connect({
  resumeToken: loadToken(),
});

if (result.resumed) {
  console.log("Session resumed successfully");
  // Subscriptions are automatically restored
}
```

---

## Connection State

Monitor connection state:

```typescript
client.onStateChange((state) => {
  console.log(`Connection state: ${state}`);
  // States: "initial", "connecting", "connected", "reconnecting", "closed"
});

// Check current state
if (client.state === "connected") {
  // Safe to make requests
}
```

---

## Complete Example: Dashboard

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";

async function createDashboard(stream: Stream) {
  const client = new ClientConnection(stream, {
    name: "Dashboard",
    reconnect: { enabled: true },
  });

  // Connect
  const { sessionId, systemInfo } = await client.connect();
  console.log(`Connected to ${systemInfo?.name} (session: ${sessionId})`);

  // Load initial state
  const { agents } = await client.listAgents();
  const { scopes } = await client.listScopes();

  console.log(`Found ${agents.length} agents and ${scopes.length} scopes`);

  // Subscribe to changes
  const subscription = await client.subscribe({
    eventTypes: [
      "agent.registered",
      "agent.unregistered",
      "agent.updated",
      "scope.created",
      "scope.deleted",
    ],
  });

  // Process events
  console.log("Watching for changes...");
  for await (const event of subscription) {
    switch (event.type) {
      case "agent.registered":
        console.log(`+ Agent joined: ${event.data.agent.name}`);
        break;
      case "agent.unregistered":
        console.log(`- Agent left: ${event.data.agentId}`);
        break;
      case "agent.updated":
        console.log(`~ Agent updated: ${event.data.agent.name}`);
        break;
      case "scope.created":
        console.log(`+ Scope created: ${event.data.scope.name}`);
        break;
      case "scope.deleted":
        console.log(`- Scope deleted: ${event.data.scopeId}`);
        break;
    }
  }
}
```

---

## Best Practices

1. **Handle reconnection** - Enable auto-reconnect for production clients
2. **Use event replay** - After reconnection, replay missed events
3. **Filter subscriptions** - Subscribe only to needed event types
4. **Store resume tokens** - Persist tokens for session continuity
5. **Handle state changes** - React to connection state transitions

---

## Next Steps

- [Agent Integration](./agent.html) - Build agents that process work
- [Transports](./transports.html) - Connect via different transports
- [Testing](./testing.html) - Test client integrations
