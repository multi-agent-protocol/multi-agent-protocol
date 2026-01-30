# Getting Started with MAP SDK

Get a MAP server and connected agent running in 5 minutes.

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

```bash
npm install @multi-agent-protocol/sdk
```

## Step 1: Create a Server

The `MAPServer` class provides a complete MAP-compliant server with sensible defaults.

```typescript
// server.ts
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";

// Create the MAP server
const server = new MAPServer({
  name: "MyMAPServer",
  version: "1.0.0",
});

// Create WebSocket server
const wss = new WebSocketServer({ port: 8080 });

// Accept connections
wss.on("connection", (ws) => {
  console.log("New connection");

  // Convert WebSocket to a bidirectional stream
  const stream = websocketToStream(ws);

  // Accept and start processing
  const router = server.accept(stream);
  router.start();
});

console.log("MAP Server listening on ws://localhost:8080");

// Helper to convert WebSocket to stream
function websocketToStream(ws: WebSocket) {
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

## Step 2: Create an Agent

Agents are workers that register with the server and process messages.

```typescript
// agent.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

async function main() {
  // Connect to server
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const stream = websocketToStream(ws);

  // Create agent connection
  const agent = new AgentConnection(stream, {
    name: "WorkerAgent",
    role: "processor",
  });

  // Connect and register
  const { agent: registered } = await agent.connect();
  console.log(`Agent registered: ${registered.id}`);

  // Handle incoming messages
  agent.onMessage((message) => {
    console.log(`Received message from ${message.from}:`);
    console.log(message.payload);
  });

  // Keep running
  console.log("Agent running. Press Ctrl+C to exit.");
}

main().catch(console.error);
```

## Step 3: Create a Client

Clients observe the system and can send messages to agents.

```typescript
// client.ts
import { ClientConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

async function main() {
  // Connect to server
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const stream = websocketToStream(ws);

  // Create client connection
  const client = new ClientConnection(stream, {
    name: "Dashboard",
  });

  // Connect
  const result = await client.connect();
  console.log(`Connected to ${result.systemInfo?.name}`);

  // List all agents
  const { agents } = await client.listAgents();
  console.log(`Found ${agents.length} agents:`);
  agents.forEach((a) => console.log(`  - ${a.name} (${a.id})`));

  // Subscribe to agent events
  const subscription = await client.subscribe({
    eventTypes: ["agent.registered", "agent.unregistered"],
  });

  console.log("Watching for agent events...");

  for await (const event of subscription) {
    console.log(`Event: ${event.type}`);
  }
}

main().catch(console.error);
```

## Step 4: Run It

Start each component in a separate terminal:

```bash
# Terminal 1: Start server
npx ts-node server.ts

# Terminal 2: Start agent
npx ts-node agent.ts

# Terminal 3: Start client
npx ts-node client.ts
```

You should see:
1. Server starts and listens on port 8080
2. Agent connects and registers
3. Client connects, lists the agent, and receives the registration event

## What Just Happened?

1. **Server** created building blocks (EventBus, AgentRegistry, etc.) and wired them together
2. **Agent** connected, sent `map/connect`, then `map/agents/register`
3. **Server** registered the agent and emitted `agent.registered` event
4. **Client** connected, queried agents with `map/agents/list`, subscribed to events
5. **EventBus** delivered the registration event to the client's subscription

## Next Steps

- **[Server Quickstart](./guides/server-quickstart.md)** - Learn MAPServer configuration options
- **[Agent Integration](./guides/agent-integration.md)** - Build more sophisticated agents
- **[Client Integration](./guides/client-integration.md)** - Build observability dashboards
- **[Transports](./guides/transports.md)** - Use different transports (stdio, HTTP, custom)

## Common Issues

### "Connection refused"

Make sure the server is running before starting agents or clients.

### "Method not found"

Check that you're using the correct SDK version on both server and client.

### Events not received

Verify your subscription filter matches the event types being emitted. Use `eventTypes: ["*"]` to receive all events during debugging.

### Agent not appearing in list

The agent must call `connect()` which automatically registers it. Check for connection errors.
