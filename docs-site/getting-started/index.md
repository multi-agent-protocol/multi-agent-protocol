---
title: Getting Started
nav_order: 2
has_children: true
description: "Get started with the Multi-Agent Protocol SDK"
---

# Getting Started

Get a MAP server and connected agents running in minutes.
{: .fs-6 .fw-300 }

---

## What You'll Learn

1. **[Overview](./overview.html)** - Understand what MAP is and when to use it
2. **[Quickstart](./quickstart.html)** - Run a server, agent, and client in 5 minutes
3. **[Installation](./installation.html)** - Install and configure the SDK

---

## Prerequisites

- **Node.js 18+** - MAP SDK requires Node.js 18 or later
- **npm or yarn** - For package management
- **TypeScript** (recommended) - The SDK is written in TypeScript with full type support

---

## Quick Installation

```bash
npm install @multi-agent-protocol/sdk
```

---

## Minimal Example

Here's the simplest possible MAP setup:

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

console.log("MAP Server running on ws://localhost:8080");
```

**Agent:**
```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

const agent = new AgentConnection(stream, {
  name: "Worker",
  role: "processor"
});

const { agent: registered } = await agent.connect();
console.log(`Agent registered: ${registered.id}`);

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
console.log(`Found ${agents.length} agents`);

// Subscribe to events
const subscription = await client.subscribe({ eventTypes: ["agent.*"] });
for await (const event of subscription) {
  console.log("Event:", event.type);
}
```

---

## Next Steps

Ready to dive deeper? Start with the [Quickstart Guide](./quickstart.html) to build a complete working example.
