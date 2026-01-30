# Example: Simple Chat

A minimal example showing agent-to-agent messaging through a MAP server.

## Overview

This example demonstrates:
- Setting up a MAP server
- Connecting multiple agents
- Sending messages between agents
- Receiving and responding to messages

## Server

```typescript
// server.ts
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";

const server = new MAPServer({
  name: "ChatServer",
  version: "1.0.0",
});

// Log agent activity
server.on("agent.registered", (event) => {
  console.log(`Agent joined: ${event.data.agent.name}`);
});

server.on("agent.unregistered", (event) => {
  console.log(`Agent left: ${event.data.agentId}`);
});

// Start WebSocket server
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  const stream = websocketToStream(ws);
  server.accept(stream).start();
});

console.log("Chat server running on ws://localhost:8080");

// Helper function
function websocketToStream(ws: any) {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.on("message", (data: Buffer) => {
          controller.enqueue(JSON.parse(data.toString()));
        });
        ws.on("close", () => controller.close());
      },
    }),
    writable: new WritableStream({
      write(message) {
        ws.send(JSON.stringify(message));
      },
    }),
  };
}
```

## Chat Agent

```typescript
// chat-agent.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";
import readline from "readline";

const agentName = process.argv[2] || "User";

async function main() {
  // Connect to server
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const stream = websocketToStream(ws);
  const agent = new AgentConnection(stream, {
    name: agentName,
    role: "chat-user",
  });

  const { agent: registered } = await agent.connect();
  console.log(`Connected as ${registered.name} (${registered.id})`);

  // Handle incoming messages
  agent.onMessage((message) => {
    console.log(`\n[${message.payload.from}]: ${message.payload.text}`);
    rl.prompt();
  });

  // List other agents
  const { agents } = await agent.listAgents();
  const others = agents.filter((a) => a.id !== registered.id);
  console.log(`\nOnline users: ${others.map((a) => a.name).join(", ") || "none"}`);

  // Set up readline for input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\nCommands:");
  console.log("  /list - Show online users");
  console.log("  /msg <name> <message> - Send direct message");
  console.log("  /quit - Exit\n");

  rl.prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();

    if (trimmed === "/list") {
      const { agents } = await agent.listAgents();
      const others = agents.filter((a) => a.id !== registered.id);
      console.log(`Online: ${others.map((a) => a.name).join(", ") || "none"}`);
    } else if (trimmed.startsWith("/msg ")) {
      const parts = trimmed.slice(5).split(" ");
      const targetName = parts[0];
      const text = parts.slice(1).join(" ");

      const { agents } = await agent.listAgents();
      const target = agents.find((a) => a.name === targetName);

      if (target) {
        await agent.send({
          to: { agentId: target.id },
          payload: { from: agentName, text },
        });
        console.log(`Sent to ${targetName}`);
      } else {
        console.log(`User not found: ${targetName}`);
      }
    } else if (trimmed === "/quit") {
      await agent.disconnect();
      process.exit(0);
    } else if (trimmed) {
      console.log("Unknown command. Use /msg <name> <message>");
    }

    rl.prompt();
  });
}

function websocketToStream(ws: any) {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.on("message", (data: Buffer) => {
          controller.enqueue(JSON.parse(data.toString()));
        });
        ws.on("close", () => controller.close());
      },
    }),
    writable: new WritableStream({
      write(message) {
        ws.send(JSON.stringify(message));
      },
    }),
  };
}

main().catch(console.error);
```

## Running the Example

Terminal 1 - Start server:
```bash
npx ts-node server.ts
```

Terminal 2 - First user:
```bash
npx ts-node chat-agent.ts Alice
```

Terminal 3 - Second user:
```bash
npx ts-node chat-agent.ts Bob
```

Now Alice and Bob can chat:
```
# In Alice's terminal
/msg Bob Hello!

# In Bob's terminal
[Alice]: Hello!
/msg Alice Hi there!
```

## Adding a Chat Room (Scopes)

Extend the example to support group chat:

```typescript
// Extended chat agent with room support
async function main() {
  // ... connection setup ...

  // Join or create a room
  const roomName = process.argv[3] || "general";
  let room;

  const { scopes } = await agent.listScopes();
  room = scopes.find((s) => s.name === roomName);

  if (!room) {
    room = await agent.createScope({ name: roomName });
    console.log(`Created room: ${roomName}`);
  }

  await agent.joinScope(room.id);
  console.log(`Joined room: ${roomName}`);

  // Handle room messages
  agent.onMessage((message) => {
    if (message.payload.room === roomName) {
      console.log(`\n[${roomName}] ${message.payload.from}: ${message.payload.text}`);
    } else {
      console.log(`\n[DM] ${message.payload.from}: ${message.payload.text}`);
    }
    rl.prompt();
  });

  // Send to room with /say command
  rl.on("line", async (input) => {
    const trimmed = input.trim();

    if (trimmed.startsWith("/say ")) {
      const text = trimmed.slice(5);
      await agent.send({
        to: { scopeId: room.id },
        payload: { room: roomName, from: agentName, text },
      });
    }
    // ... other commands ...
  });
}
```

## Key Concepts Demonstrated

| Concept | Implementation |
|---------|---------------|
| Agent registration | `agent.connect()` |
| Message handling | `agent.onMessage()` |
| Agent discovery | `agent.listAgents()` |
| Direct messaging | `agent.send({ to: { agentId } })` |
| Group messaging | `agent.send({ to: { scopeId } })` |
| Scope management | `createScope()`, `joinScope()` |

## Next Steps

- **[Task Queue Example](./task-queue.md)** - Distribute work across agents
- **[Full Integration Example](./full-integration.md)** - Complete application
