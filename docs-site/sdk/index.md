---
title: SDK
nav_order: 4
has_children: true
description: "MAP TypeScript SDK documentation"
---

# TypeScript SDK

The Multi-Agent Protocol TypeScript SDK provides everything you need to build observable, coordinated multi-agent systems.
{: .fs-6 .fw-300 }

---

## Who This Is For

- **Agent Developers** - Build agents that register with MAP servers, receive messages, and collaborate with other agents
- **Platform Developers** - Build MAP-compliant servers that orchestrate agents and expose them to clients
- **Client Developers** - Build applications that observe and interact with multi-agent systems

---

## Installation

```bash
npm install @multi-agent-protocol/sdk
```

---

## Quick Navigation

### Guides

| Guide | Description |
|:------|:------------|
| [Server Setup](./guides/server.html) | Set up a MAP server with MAPServer |
| [Client Integration](./guides/client.html) | Connect clients that observe and send messages |
| [Agent Integration](./guides/agent.html) | Build agents that register and process work |
| [Transports](./guides/transports.html) | WebSocket, stdio, and custom transports |
| [Authentication](./guides/authentication.html) | Configure authentication |
| [Testing](./guides/testing.html) | Test your MAP integrations |

### API Reference

| Reference | Description |
|:----------|:------------|
| [Server API](./api/server.html) | MAPServer and building blocks |
| [Client API](./api/client.html) | ClientConnection methods |
| [Agent API](./api/agent.html) | AgentConnection methods |
| [Types](./api/types.html) | TypeScript type definitions |

---

## Package Exports

```typescript
// Main exports (connections)
import {
  ClientConnection,
  AgentConnection,
  GatewayConnection
} from "@multi-agent-protocol/sdk";

// Server components
import { MAPServer } from "@multi-agent-protocol/sdk/server";

// Building blocks for custom servers
import {
  EventBusImpl,
  AgentRegistryImpl,
  ScopeManagerImpl,
  SubscriptionManagerImpl,
} from "@multi-agent-protocol/sdk/server";

// Stream utilities
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";

// Type definitions
import type {
  Agent,
  Message,
  Event,
  Subscription,
} from "@multi-agent-protocol/sdk";
```

---

## Minimal Example

**Server:**
```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";

const server = new MAPServer({ name: "MyServer" });
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  const stream = websocketToStream(ws);
  server.accept(stream).start();
});
```

**Agent:**
```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

const agent = new AgentConnection(stream, {
  name: "Worker",
  role: "processor"
});

const { agent: registered } = await agent.connect();
console.log(`Registered: ${registered.id}`);

agent.onMessage((message) => {
  console.log("Received:", message.payload);
});
```

**Client:**
```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";

const client = new ClientConnection(stream, { name: "Dashboard" });
await client.connect();

// List all agents
const { agents } = await client.listAgents();

// Subscribe to events
const subscription = await client.subscribe({
  eventTypes: ["agent.*"]
});

for await (const event of subscription) {
  console.log("Event:", event.type);
}
```

---

## Progressive Disclosure

The SDK follows a **progressive disclosure** pattern:

### Level 1: Just Works

```typescript
const server = new MAPServer();
```

### Level 2: Customize Behavior

```typescript
const server = new MAPServer({
  middleware: [loggingMiddleware, authMiddleware],
  additionalHandlers: { "custom/method": myHandler },
});
```

### Level 3: Full Control

```typescript
const eventBus = new EventBusImpl({
  store: new RedisEventStore()
});
const agents = new AgentRegistryImpl({
  eventBus,
  store: new PostgresAgentStore()
});
// ... compose your own server
```

---

## Key Concepts

### Three Participant Types

| Type | Class | Purpose |
|:-----|:------|:--------|
| **Agent** | `AgentConnection` | Worker that processes tasks |
| **Client** | `ClientConnection` | Observer that monitors and sends messages |
| **Gateway** | `GatewayConnection` | Bridge between federated systems |

### Server Building Blocks

| Component | Purpose |
|:----------|:--------|
| **EventBus** | Central event dispatcher |
| **AgentRegistry** | Tracks registered agents |
| **ScopeManager** | Manages logical groupings |
| **SessionManager** | Handles connections |
| **SubscriptionManager** | Event filtering and delivery |
| **MessageRouter** | Routes messages |

---

## Next Steps

1. **[Server Setup](./guides/server.html)** - Create your MAP server
2. **[Agent Integration](./guides/agent.html)** - Build your first agent
3. **[Client Integration](./guides/client.html)** - Build observability tools
