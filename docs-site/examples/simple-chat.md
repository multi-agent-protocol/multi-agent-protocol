---
title: Simple Chat
parent: Examples
nav_order: 1
description: "Basic agent-to-agent messaging example"
---

# Simple Chat
{: .no_toc }

A minimal example of agent-to-agent messaging.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

This example demonstrates:
- Setting up a MAP server
- Creating chat agents
- Sending messages between agents
- Subscribing to events

---

## Server

```typescript
// server.ts
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";

const server = new MAPServer({
  name: "ChatServer",
  version: "1.0.0",
});

// Log events
server.on("agent.registered", (event) => {
  console.log(`[Server] Agent joined: ${event.data.agent.name}`);
});

server.on("agent.unregistered", (event) => {
  console.log(`[Server] Agent left: ${event.data.agentId}`);
});

server.on("message.sent", (event) => {
  console.log(`[Server] Message from ${event.data.from} to ${event.data.to}`);
});

// WebSocket server
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  const stream = websocketToStream(ws);
  server.accept(stream).start();
});

console.log("Chat server running on ws://localhost:8080");

// Helper function
function websocketToStream(ws) {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.on("message", (data) => {
          controller.enqueue(JSON.parse(data.toString()));
        });
        ws.on("close", () => controller.close());
        ws.on("error", (err) => controller.error(err));
      },
    }),
    writable: new WritableStream({
      write(message) {
        ws.send(JSON.stringify(message));
      },
      close() {
        ws.close();
      },
    }),
  };
}
```

---

## Chat Agent

```typescript
// chat-agent.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";
import * as readline from "readline";

async function main() {
  const agentName = process.argv[2] || "Agent";

  // Connect to server
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const stream = websocketToStream(ws);

  // Create agent
  const agent = new AgentConnection(stream, {
    name: agentName,
    role: "chatter",
  });

  // Handle incoming messages
  agent.onMessage((message) => {
    console.log(`\n[${message.from}]: ${message.payload.text}`);
    rl.prompt();
  });

  // Connect
  const { agent: registered } = await agent.connect();
  console.log(`Connected as ${registered.name} (${registered.id})`);

  // List other agents
  const { agents } = await agent.listAgents();
  const others = agents.filter((a) => a.id !== registered.id);

  if (others.length > 0) {
    console.log("Other agents online:");
    others.forEach((a) => console.log(`  - ${a.name} (${a.id})`));
  } else {
    console.log("No other agents online yet.");
  }

  // Set up readline for input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\nType messages to send. Use "@name message" to send to specific agent.');
  console.log('Type "list" to see online agents, "quit" to exit.\n');

  rl.prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();

    if (trimmed === "quit") {
      await agent.disconnect();
      process.exit(0);
    }

    if (trimmed === "list") {
      const { agents } = await agent.listAgents();
      const others = agents.filter((a) => a.id !== registered.id);
      console.log("Agents online:");
      others.forEach((a) => console.log(`  - ${a.name} (${a.id})`));
      rl.prompt();
      return;
    }

    // Parse @name message format
    const match = trimmed.match(/^@(\S+)\s+(.+)$/);
    if (match) {
      const [, targetName, text] = match;

      // Find agent by name
      const { agents } = await agent.listAgents();
      const target = agents.find(
        (a) => a.name.toLowerCase() === targetName.toLowerCase()
      );

      if (target) {
        await agent.send({
          to: { agentId: target.id },
          payload: { text },
        });
        console.log(`[You → ${target.name}]: ${text}`);
      } else {
        console.log(`Agent "${targetName}" not found.`);
      }
    } else if (trimmed) {
      // Broadcast to all agents
      const { agents } = await agent.listAgents();
      const others = agents.filter((a) => a.id !== registered.id);

      for (const other of others) {
        await agent.send({
          to: { agentId: other.id },
          payload: { text: trimmed },
        });
      }
      console.log(`[You → all]: ${trimmed}`);
    }

    rl.prompt();
  });
}

main().catch(console.error);
```

---

## Running the Example

1. Start the server:

```bash
npx ts-node server.ts
```

2. In separate terminals, start multiple chat agents:

```bash
# Terminal 2
npx ts-node chat-agent.ts Alice

# Terminal 3
npx ts-node chat-agent.ts Bob
```

3. Type messages in each terminal:

```
# Alice's terminal
> Hello everyone!
[You → all]: Hello everyone!

# Bob's terminal
[Alice]: Hello everyone!
> @Alice Hi Alice!
[You → Alice]: Hi Alice!
```

---

## Key Concepts Demonstrated

### Agent Registration

```typescript
const agent = new AgentConnection(stream, {
  name: agentName,
  role: "chatter",
});

await agent.connect();
```

### Message Handling

```typescript
agent.onMessage((message) => {
  console.log(`[${message.from}]: ${message.payload.text}`);
});
```

### Agent Discovery

```typescript
const { agents } = await agent.listAgents();
```

### Direct Messaging

```typescript
await agent.send({
  to: { agentId: target.id },
  payload: { text: "Hello!" },
});
```

---

## Next Steps

- [Task Queue](./task-queue.html) - Work distribution with scopes
- [Full Integration](./full-integration.html) - Complete application
