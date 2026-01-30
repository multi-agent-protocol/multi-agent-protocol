# MAP TypeScript SDK Documentation

The Multi-Agent Protocol (MAP) TypeScript SDK provides everything you need to build observable, coordinated multi-agent systems.

## Who This Is For

- **Agent Developers**: Build agents that register with MAP servers, receive messages, and collaborate with other agents
- **Platform Developers**: Build MAP-compliant servers that orchestrate agents and expose them to clients
- **Client Developers**: Build applications that observe and interact with multi-agent systems

## Quick Navigation

### Getting Started

- **[Getting Started](./getting-started.md)** - 5-minute quickstart to get a server and client running

### Guides

| Guide | Description |
|-------|-------------|
| [Server Quickstart](./guides/server-quickstart.md) | Set up a MAP server with MAPServer (recommended) |
| [Server Advanced](./guides/server-advanced.md) | Use building blocks for custom server implementations |
| [Client Integration](./guides/client-integration.md) | Connect clients that observe and send messages |
| [Agent Integration](./guides/agent-integration.md) | Build agents that register and process work |
| [Transports](./guides/transports.md) | WebSocket, Node.js streams, and custom transport adapters |
| [Testing](./guides/testing.md) | Test your MAP integrations |

### Examples

| Example | Description |
|---------|-------------|
| [Simple Chat](./examples/simple-chat.md) | Basic agent-to-agent messaging |
| [Task Queue](./examples/task-queue.md) | Work distribution with scopes |
| [Full Integration](./examples/full-integration.md) | Complete end-to-end application |

### API Reference

- [Server API](./api-reference/server.md) - MAPServer and building blocks
- [Client API](./api-reference/client.md) - ClientConnection methods
- [Agent API](./api-reference/agent.md) - AgentConnection methods
- [Types](./api-reference/types.md) - TypeScript type definitions

## Core Concepts

### The MAP Architecture

MAP provides a **transparent, observable** layer for multi-agent systems:

```
┌─────────────────────────────────────────────────────────┐
│                      MAP Server                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   EventBus  │  │   Agents    │  │   Scopes    │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Sessions   │  │ Subscriptions│ │  Messages   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────┘
        │                   │                    │
    ┌───┴───┐          ┌────┴────┐          ┌───┴───┐
    │ Agent │          │ Client  │          │ Agent │
    └───────┘          └─────────┘          └───────┘
```

### Three Participant Types

| Type | Role | Capabilities |
|------|------|--------------|
| **Agent** | Worker that processes tasks | Register, join scopes, send/receive messages |
| **Client** | Observer and requester | Subscribe to events, query state, send messages |
| **Gateway** | Federation bridge | Route between MAP systems |

### Key Components

- **EventBus**: Central event dispatcher for all system events
- **AgentRegistry**: Tracks registered agents and their state
- **ScopeManager**: Manages logical groupings (rooms, topics, projects)
- **SessionManager**: Handles connections and reconnection
- **SubscriptionManager**: Event filtering and delivery
- **MessageRouter**: Routes messages to agents and scopes

## Installation

```bash
npm install @multi-agent-protocol/sdk
```

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

const agent = new AgentConnection(stream, { name: "Worker", role: "processor" });
const { agent: registered } = await agent.connect();

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
const subscription = await client.subscribe({ eventTypes: ["agent.*"] });
for await (const event of subscription) {
  console.log("Event:", event.type);
}
```

## Progressive Disclosure

The SDK follows a **progressive disclosure** pattern:

1. **Simple things simple**: `MAPServer` wires everything together with sensible defaults
2. **Complex things possible**: Access individual building blocks for custom behavior
3. **Full control available**: Implement your own storage, middleware, and handlers

```typescript
// Level 1: Just works
const server = new MAPServer();

// Level 2: Customize behavior
const server = new MAPServer({
  middleware: [loggingMiddleware, authMiddleware],
  additionalHandlers: { "custom/method": myHandler },
});

// Level 3: Full control
const eventBus = new EventBusImpl({ store: new RedisEventStore() });
const agents = new AgentRegistryImpl({ eventBus, store: new PostgresAgentStore() });
// ... compose your own server
```

## Next Steps

1. **[Getting Started](./getting-started.md)** - Run your first MAP server
2. **[Server Quickstart](./guides/server-quickstart.md)** - Understand MAPServer options
3. **[Agent Integration](./guides/agent-integration.md)** - Build your first agent
