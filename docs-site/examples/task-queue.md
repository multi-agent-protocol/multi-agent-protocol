---
title: Task Queue
parent: Examples
nav_order: 2
description: "Work distribution with scopes"
---

# Task Queue
{: .no_toc }

Distribute work to agents using scopes.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

This example demonstrates:
- Creating scopes for work distribution
- Coordinator pattern for task assignment
- Worker agents processing tasks
- Client submitting and monitoring work

---

## Architecture

```
        ┌────────────────────────────┐
        │         Client             │
        │   (submits tasks)          │
        └─────────────┬──────────────┘
                      │
        ┌─────────────▼──────────────┐
        │       Coordinator          │
        │   (assigns to workers)     │
        └─────────────┬──────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
    ┌─────▼─────┐┌────▼────┐┌────▼────┐
    │  Worker 1 ││ Worker 2 ││ Worker 3│
    │  (scope)  ││ (scope)  ││ (scope) │
    └───────────┘└──────────┘└─────────┘
```

---

## Server

```typescript
// server.ts
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";

const server = new MAPServer({
  name: "TaskQueueServer",
  version: "1.0.0",
});

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  server.accept(websocketToStream(ws)).start();
});

console.log("Task queue server running on ws://localhost:8080");
```

---

## Coordinator

```typescript
// coordinator.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

async function main() {
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const agent = new AgentConnection(websocketToStream(ws), {
    name: "Coordinator",
    role: "coordinator",
  });

  const { agent: registered } = await agent.connect();
  console.log(`Coordinator registered: ${registered.id}`);

  // Create task queue scope
  const taskQueue = await agent.createScope({
    name: "task-queue",
    metadata: { type: "work-distribution" },
  });
  console.log(`Created task queue scope: ${taskQueue.id}`);

  // Track workers and their state
  const workers = new Map<string, { agentId: string; busy: boolean }>();
  const pendingTasks: any[] = [];

  // Subscribe to worker events
  const subscription = await agent.subscribe({
    eventTypes: ["scope.joined", "scope.left", "agent.unregistered"],
  });

  // Process events in background
  (async () => {
    for await (const event of subscription) {
      if (event.type === "scope.joined" && event.data.scopeId === taskQueue.id) {
        const { agentId } = event.data;
        if (agentId !== registered.id) {
          workers.set(agentId, { agentId, busy: false });
          console.log(`Worker joined: ${agentId}`);
          // Try to assign pending tasks
          assignPendingTasks();
        }
      }

      if (event.type === "scope.left" && event.data.scopeId === taskQueue.id) {
        workers.delete(event.data.agentId);
        console.log(`Worker left: ${event.data.agentId}`);
      }

      if (event.type === "agent.unregistered") {
        workers.delete(event.data.agentId);
      }
    }
  })();

  // Handle incoming messages
  agent.onMessage(async (message) => {
    const { type } = message.payload;

    if (type === "submit-task") {
      const task = {
        id: `task-${Date.now()}`,
        ...message.payload.task,
        submitter: message.from,
      };

      console.log(`Received task: ${task.id}`);

      // Find available worker
      const available = [...workers.values()].find((w) => !w.busy);

      if (available) {
        assignTask(task, available.agentId);
      } else {
        pendingTasks.push(task);
        console.log(`Task ${task.id} queued (${pendingTasks.length} pending)`);
      }
    }

    if (type === "task-complete") {
      const { taskId, result, success } = message.payload;
      const worker = workers.get(message.from);

      if (worker) {
        worker.busy = false;
      }

      console.log(`Task ${taskId} completed: ${success ? "success" : "failed"}`);

      // Notify submitter
      // ... forward result to original submitter

      // Assign pending tasks
      assignPendingTasks();
    }
  });

  async function assignTask(task: any, workerId: string) {
    const worker = workers.get(workerId);
    if (worker) {
      worker.busy = true;
    }

    await agent.send({
      to: { agentId: workerId },
      payload: {
        type: "task",
        task,
      },
    });

    console.log(`Assigned task ${task.id} to ${workerId}`);
  }

  function assignPendingTasks() {
    while (pendingTasks.length > 0) {
      const available = [...workers.values()].find((w) => !w.busy);
      if (!available) break;

      const task = pendingTasks.shift()!;
      assignTask(task, available.agentId);
    }
  }

  console.log("Coordinator ready. Waiting for workers and tasks...");
}

main().catch(console.error);
```

---

## Worker

```typescript
// worker.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

async function main() {
  const workerId = process.argv[2] || `Worker-${Math.random().toString(36).slice(2, 6)}`;

  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const agent = new AgentConnection(websocketToStream(ws), {
    name: workerId,
    role: "worker",
  });

  const { agent: registered } = await agent.connect();
  console.log(`Worker registered: ${registered.id}`);

  // Find and join task queue
  const { scopes } = await agent.listScopes();
  const taskQueue = scopes.find((s) => s.name === "task-queue");

  if (taskQueue) {
    await agent.joinScope(taskQueue.id);
    console.log("Joined task queue");
  } else {
    console.log("Task queue not found. Waiting for coordinator...");

    // Subscribe to scope creation
    const sub = await agent.subscribe({ eventTypes: ["scope.created"] });
    for await (const event of sub) {
      if (event.data.scope.name === "task-queue") {
        await agent.joinScope(event.data.scope.id);
        console.log("Joined task queue");
        await sub.unsubscribe();
        break;
      }
    }
  }

  // Handle tasks
  agent.onMessage(async (message) => {
    if (message.payload.type === "task") {
      const { task } = message.payload;
      console.log(`Processing task: ${task.id}`);

      await agent.update({ state: "busy" });

      try {
        // Simulate work
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));

        // Send result
        await agent.send({
          to: { agentId: message.from },
          payload: {
            type: "task-complete",
            taskId: task.id,
            success: true,
            result: { processed: true },
          },
        });

        console.log(`Completed task: ${task.id}`);
      } catch (error) {
        await agent.send({
          to: { agentId: message.from },
          payload: {
            type: "task-complete",
            taskId: task.id,
            success: false,
            error: error.message,
          },
        });
      }

      await agent.update({ state: "running" });
    }
  });

  console.log("Worker ready. Waiting for tasks...");
}

main().catch(console.error);
```

---

## Client

```typescript
// client.ts
import { ClientConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

async function main() {
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.on("open", resolve));

  const client = new ClientConnection(websocketToStream(ws), {
    name: "TaskSubmitter",
  });

  await client.connect();
  console.log("Connected to task queue server");

  // Find coordinator
  const { agents } = await client.listAgents({ role: "coordinator" });

  if (agents.length === 0) {
    console.log("No coordinator found. Please start the coordinator first.");
    return;
  }

  const coordinator = agents[0];
  console.log(`Found coordinator: ${coordinator.id}`);

  // Submit some tasks
  for (let i = 1; i <= 5; i++) {
    await client.send({
      to: { agentId: coordinator.id },
      payload: {
        type: "submit-task",
        task: {
          name: `Task ${i}`,
          data: { value: i * 10 },
        },
      },
    });

    console.log(`Submitted task ${i}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("All tasks submitted. Monitoring...");

  // Subscribe to events
  const subscription = await client.subscribe({
    eventTypes: ["agent.*"],
  });

  for await (const event of subscription) {
    console.log(`Event: ${event.type}`);
  }
}

main().catch(console.error);
```

---

## Running the Example

1. Start the server:
```bash
npx ts-node server.ts
```

2. Start the coordinator:
```bash
npx ts-node coordinator.ts
```

3. Start some workers:
```bash
npx ts-node worker.ts Worker1
npx ts-node worker.ts Worker2
```

4. Submit tasks:
```bash
npx ts-node client.ts
```

---

## Key Concepts Demonstrated

- **Scopes** for grouping related agents
- **Coordinator pattern** for task distribution
- **Worker pool** with busy/available tracking
- **Message passing** for task assignment and completion

---

## Next Steps

- [Full Integration](./full-integration.html) - Complete application with all concepts
