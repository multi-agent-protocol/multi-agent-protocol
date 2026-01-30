# Example: Task Queue

A work distribution example showing how to use scopes to manage task assignment and completion.

## Overview

This example demonstrates:
- Work distribution across multiple agents
- Using scopes for task organization
- Tracking task state with agent metadata
- Event-driven task completion tracking

## Architecture

```
┌─────────────────────────────────────────────┐
│              Task Queue Server               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│  │ Scope:  │  │ Scope:  │  │ Scope:  │     │
│  │ pending │  │  active │  │completed│     │
│  └─────────┘  └─────────┘  └─────────┘     │
└─────────────────────────────────────────────┘
        │              │              │
    ┌───┴───┐     ┌────┴────┐    ┌───┴───┐
    │Submit │     │ Worker  │    │Monitor│
    │ Client│     │ Agents  │    │ Client│
    └───────┘     └─────────┘    └───────┘
```

## Server

```typescript
// server.ts
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";

const server = new MAPServer({
  name: "TaskQueueServer",
  version: "1.0.0",
});

// Create task scopes on startup
server.scopes.create({ name: "pending", metadata: { type: "task-queue" } });
server.scopes.create({ name: "active", metadata: { type: "task-queue" } });
server.scopes.create({ name: "completed", metadata: { type: "task-queue" } });

console.log("Task scopes created");

// Log task events
server.on("message.sent", (event) => {
  const msg = event.data.message;
  if (msg.payload.type === "task") {
    console.log(`Task ${msg.payload.taskId}: submitted`);
  } else if (msg.payload.type === "task-claimed") {
    console.log(`Task ${msg.payload.taskId}: claimed by ${msg.payload.workerId}`);
  } else if (msg.payload.type === "task-completed") {
    console.log(`Task ${msg.payload.taskId}: completed`);
  }
});

// WebSocket server
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  const stream = websocketToStream(ws);
  server.accept(stream).start();
});

console.log("Task queue server running on ws://localhost:8080");

function websocketToStream(ws: any) {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.on("message", (data: Buffer) => controller.enqueue(JSON.parse(data.toString())));
        ws.on("close", () => controller.close());
      },
    }),
    writable: new WritableStream({
      write(message) { ws.send(JSON.stringify(message)); },
    }),
  };
}
```

## Worker Agent

```typescript
// worker.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

const workerId = process.argv[2] || `worker-${Date.now()}`;

async function main() {
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const stream = websocketToStream(ws);
  const agent = new AgentConnection(stream, {
    name: workerId,
    role: "worker",
    metadata: { status: "idle", tasksCompleted: 0 },
  });

  const { agent: registered } = await agent.connect();
  console.log(`Worker ${workerId} registered`);

  // Find scopes
  const { scopes } = await agent.listScopes();
  const pendingScope = scopes.find((s) => s.name === "pending")!;
  const activeScope = scopes.find((s) => s.name === "active")!;
  const completedScope = scopes.find((s) => s.name === "completed")!;

  // Join pending scope to receive tasks
  await agent.joinScope(pendingScope.id);
  console.log("Listening for tasks...");

  // Handle incoming tasks
  agent.onMessage(async (message) => {
    if (message.payload.type !== "task") return;

    const { taskId, data } = message.payload;
    console.log(`\nReceived task ${taskId}`);

    // Claim the task
    await agent.leaveScope(pendingScope.id);
    await agent.joinScope(activeScope.id);
    await agent.update({
      state: "busy",
      metadata: { status: "processing", currentTask: taskId },
    });

    // Notify task claimed
    await agent.send({
      to: { scopeId: activeScope.id },
      payload: { type: "task-claimed", taskId, workerId },
    });

    // Process the task (simulate work)
    console.log(`Processing task ${taskId}...`);
    const result = await processTask(data);
    console.log(`Completed task ${taskId}`);

    // Move to completed
    await agent.leaveScope(activeScope.id);
    await agent.joinScope(completedScope.id);

    // Notify completion
    await agent.send({
      to: { scopeId: completedScope.id },
      payload: { type: "task-completed", taskId, workerId, result },
    });

    // Update status and go back to pending
    const completed = (registered.metadata?.tasksCompleted as number || 0) + 1;
    await agent.update({
      state: "running",
      metadata: { status: "idle", tasksCompleted: completed, currentTask: null },
    });

    await agent.leaveScope(completedScope.id);
    await agent.joinScope(pendingScope.id);
    console.log("Ready for next task");
  });
}

async function processTask(data: any): Promise<any> {
  // Simulate processing time
  await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));

  // Return result based on task type
  if (data.operation === "sum") {
    return { sum: data.numbers.reduce((a: number, b: number) => a + b, 0) };
  }
  if (data.operation === "multiply") {
    return { product: data.numbers.reduce((a: number, b: number) => a * b, 1) };
  }
  return { echo: data };
}

function websocketToStream(ws: any) {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.on("message", (data: Buffer) => controller.enqueue(JSON.parse(data.toString())));
        ws.on("close", () => controller.close());
      },
    }),
    writable: new WritableStream({
      write(message) { ws.send(JSON.stringify(message)); },
    }),
  };
}

main().catch(console.error);
```

## Task Submitter Client

```typescript
// submitter.ts
import { ClientConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

async function main() {
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const stream = websocketToStream(ws);
  const client = new ClientConnection(stream, { name: "TaskSubmitter" });
  await client.connect();

  // Find pending scope
  const { scopes } = await client.listScopes();
  const pendingScope = scopes.find((s) => s.name === "pending")!;
  const completedScope = scopes.find((s) => s.name === "completed")!;

  // Subscribe to completions
  const subscription = await client.subscribe({
    eventTypes: ["message.sent"],
    scopeIds: [completedScope.id],
  });

  // Track pending tasks
  const pending = new Map<string, { resolve: Function }>();

  // Process completion events in background
  (async () => {
    for await (const event of subscription) {
      const msg = event.data.message;
      if (msg.payload.type === "task-completed") {
        const { taskId, result } = msg.payload;
        const task = pending.get(taskId);
        if (task) {
          task.resolve(result);
          pending.delete(taskId);
        }
      }
    }
  })();

  // Submit tasks
  console.log("Submitting tasks...\n");

  const tasks = [
    { operation: "sum", numbers: [1, 2, 3, 4, 5] },
    { operation: "multiply", numbers: [2, 3, 4] },
    { operation: "sum", numbers: [10, 20, 30] },
  ];

  const results = await Promise.all(
    tasks.map((data, i) => {
      const taskId = `task-${Date.now()}-${i}`;
      return submitTask(client, pendingScope.id, taskId, data, pending);
    })
  );

  console.log("\nResults:");
  results.forEach((result, i) => {
    console.log(`  Task ${i + 1}:`, result);
  });

  await client.disconnect();
}

async function submitTask(
  client: ClientConnection,
  scopeId: string,
  taskId: string,
  data: any,
  pending: Map<string, { resolve: Function }>
): Promise<any> {
  const promise = new Promise((resolve) => {
    pending.set(taskId, { resolve });
  });

  await client.send({
    to: { scopeId },
    payload: { type: "task", taskId, data },
  });

  console.log(`Submitted: ${taskId}`);
  return promise;
}

function websocketToStream(ws: any) {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.on("message", (data: Buffer) => controller.enqueue(JSON.parse(data.toString())));
        ws.on("close", () => controller.close());
      },
    }),
    writable: new WritableStream({
      write(message) { ws.send(JSON.stringify(message)); },
    }),
  };
}

main().catch(console.error);
```

## Monitor Client

```typescript
// monitor.ts
import { ClientConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

async function main() {
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const stream = websocketToStream(ws);
  const client = new ClientConnection(stream, { name: "Monitor" });
  await client.connect();

  // Subscribe to all task-related events
  const subscription = await client.subscribe({
    eventTypes: ["agent.registered", "agent.unregistered", "agent.updated", "message.sent"],
  });

  console.log("Task Queue Monitor");
  console.log("==================\n");

  // Initial status
  await showStatus(client);

  // Watch for changes
  for await (const event of subscription) {
    console.log(`\n[${new Date().toISOString()}] ${event.type}`);

    if (event.type === "agent.registered") {
      console.log(`  + Worker joined: ${event.data.agent.name}`);
    } else if (event.type === "agent.unregistered") {
      console.log(`  - Worker left: ${event.data.agentId}`);
    } else if (event.type === "agent.updated") {
      const agent = event.data.agent;
      console.log(`  ~ ${agent.name}: ${agent.metadata?.status} (${agent.metadata?.tasksCompleted} completed)`);
    } else if (event.type === "message.sent") {
      const msg = event.data.message;
      if (msg.payload.type === "task") {
        console.log(`  📥 Task submitted: ${msg.payload.taskId}`);
      } else if (msg.payload.type === "task-claimed") {
        console.log(`  🔄 Task claimed: ${msg.payload.taskId} by ${msg.payload.workerId}`);
      } else if (msg.payload.type === "task-completed") {
        console.log(`  ✅ Task completed: ${msg.payload.taskId}`);
      }
    }
  }
}

async function showStatus(client: ClientConnection) {
  const { agents } = await client.listAgents();
  const workers = agents.filter((a) => a.role === "worker");

  console.log(`Workers: ${workers.length}`);
  workers.forEach((w) => {
    console.log(`  ${w.name}: ${w.metadata?.status} (${w.metadata?.tasksCompleted || 0} completed)`);
  });
}

function websocketToStream(ws: any) {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.on("message", (data: Buffer) => controller.enqueue(JSON.parse(data.toString())));
        ws.on("close", () => controller.close());
      },
    }),
    writable: new WritableStream({
      write(message) { ws.send(JSON.stringify(message)); },
    }),
  };
}

main().catch(console.error);
```

## Running the Example

Terminal 1 - Server:
```bash
npx ts-node server.ts
```

Terminal 2 - Worker 1:
```bash
npx ts-node worker.ts worker-1
```

Terminal 3 - Worker 2:
```bash
npx ts-node worker.ts worker-2
```

Terminal 4 - Monitor:
```bash
npx ts-node monitor.ts
```

Terminal 5 - Submit tasks:
```bash
npx ts-node submitter.ts
```

## Output

Monitor output:
```
Task Queue Monitor
==================

Workers: 2
  worker-1: idle (0 completed)
  worker-2: idle (0 completed)

[2024-01-15T10:00:01.000Z] message.sent
  📥 Task submitted: task-1705312801000-0

[2024-01-15T10:00:01.001Z] message.sent
  📥 Task submitted: task-1705312801000-1

[2024-01-15T10:00:01.050Z] agent.updated
  ~ worker-1: processing (0 completed)

[2024-01-15T10:00:01.051Z] message.sent
  🔄 Task claimed: task-1705312801000-0 by worker-1

[2024-01-15T10:00:03.200Z] message.sent
  ✅ Task completed: task-1705312801000-0

[2024-01-15T10:00:03.201Z] agent.updated
  ~ worker-1: idle (1 completed)
```

## Key Concepts Demonstrated

| Concept | Implementation |
|---------|---------------|
| Scope-based routing | Tasks go to `pending` scope |
| State machine | pending → active → completed |
| Agent metadata | Track status, current task, completed count |
| Event subscriptions | Monitor watches all task events |
| Request-response over events | Submit waits for completion event |

## Next Steps

- **[Simple Chat Example](./simple-chat.md)** - Basic messaging
- **[Full Integration Example](./full-integration.md)** - Complete application
