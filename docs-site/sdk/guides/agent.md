---
title: Agent Integration
parent: Guides
grand_parent: SDK
nav_order: 3
description: "Build agents that register and process work"
---

# Agent Integration
{: .no_toc }

Build agents that register with MAP servers and collaborate with other agents.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## When to Use AgentConnection

Use `AgentConnection` when building:
- AI agents that process tasks
- Workers that handle background jobs
- Services that collaborate with other agents
- Bots that respond to events

---

## Basic Usage

```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

// Create connection
const agent = new AgentConnection(stream, {
  name: "WorkerAgent",
  role: "processor",
});

// Connect (automatically registers the agent)
const { agent: registered, connection } = await agent.connect();
console.log(`Registered as ${registered.id}`);

// Handle messages
agent.onMessage((message) => {
  console.log(`Received from ${message.from}:`, message.payload);
});

// Disconnect when done
await agent.disconnect();
```

---

## Connection Options

```typescript
const agent = new AgentConnection(stream, {
  name: "WorkerAgent",           // Agent name (required)
  role: "processor",             // Agent role
  metadata: {                    // Custom metadata
    version: "1.0.0",
    capabilities: ["text", "image"],
  },
  reconnect: {
    enabled: true,               // Auto-reconnect
    maxAttempts: 10,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
});
```

---

## Message Handling

### Basic Handler

```typescript
agent.onMessage((message) => {
  const { type, data } = message.payload;

  switch (type) {
    case "task":
      processTask(data);
      break;
    case "query":
      handleQuery(data);
      break;
    default:
      console.log(`Unknown message type: ${type}`);
  }
});
```

### Async Handler

```typescript
agent.onMessage(async (message) => {
  const result = await processAsync(message.payload);

  // Reply to sender
  await agent.send({
    to: { agentId: message.from },
    payload: { type: "result", data: result },
  });
});
```

---

## Sending Messages

### Send to Another Agent

```typescript
await agent.send({
  to: { agentId: "other-agent-id" },
  payload: {
    type: "request",
    data: { action: "help", context: {} },
  },
});
```

### Send to Scope

```typescript
// Message all agents in the scope
await agent.send({
  to: { scopeId: "team-scope" },
  payload: {
    type: "broadcast",
    message: "Task completed",
  },
});
```

---

## Working with Scopes

Scopes are logical groupings for collaboration.

### Create a Scope

```typescript
const scope = await agent.createScope({
  name: "project-alpha",
  metadata: {
    description: "Agents working on project alpha",
  },
});
console.log(`Created scope: ${scope.id}`);
```

### Join a Scope

```typescript
await agent.joinScope("scope-id");
console.log("Joined scope");

// Now receives messages sent to that scope
```

### Leave a Scope

```typescript
await agent.leaveScope("scope-id");
```

---

## Updating Agent State

### Update Metadata

```typescript
await agent.update({
  metadata: {
    currentTask: "task-123",
    progress: 0.5,
  },
});
```

### Update State

```typescript
// Set busy state
await agent.update({ state: "busy" });

// Set running state
await agent.update({ state: "running" });
```

---

## Querying Other Agents

### List Agents

```typescript
const { agents } = await agent.listAgents();
agents.forEach((a) => {
  console.log(`${a.name} (${a.role}): ${a.state}`);
});
```

### Find Specific Agents

```typescript
// Find by role
const { agents: processors } = await agent.listAgents({
  role: "processor",
});

// Find by state
const { agents: available } = await agent.listAgents({
  state: "running",
});

// Find in scope
const { agents: teammates } = await agent.listAgents({
  scopeId: "team-scope",
});
```

---

## Event Subscriptions

Agents can subscribe to system events:

```typescript
const subscription = await agent.subscribe({
  eventTypes: [
    "agent.registered",     // New agents
    "scope.joined",         // Agents joining scopes
    "message.sent",         // Messages in scopes we're in
  ],
});

for await (const event of subscription) {
  switch (event.type) {
    case "agent.registered":
      console.log(`New agent: ${event.data.agent.name}`);
      break;
    case "scope.joined":
      if (event.data.scopeId === myScope.id) {
        console.log(`${event.data.agentId} joined our scope`);
      }
      break;
  }
}
```

---

## Complete Example: Task Processor

```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

async function createTaskProcessor(stream: Stream) {
  const agent = new AgentConnection(stream, {
    name: "TaskProcessor",
    role: "worker",
    metadata: {
      capabilities: ["text-analysis", "summarization"],
    },
    reconnect: { enabled: true },
  });

  // Connect
  const { agent: registered } = await agent.connect();
  console.log(`Registered as ${registered.id}`);

  // Join task queue scope
  await agent.joinScope("task-queue");
  console.log("Joined task queue");

  // Set up message handler
  agent.onMessage(async (message) => {
    const { taskId, type, data } = message.payload;
    console.log(`Processing task ${taskId} (${type})`);

    // Update state
    await agent.update({
      state: "busy",
      metadata: { currentTask: taskId },
    });

    try {
      // Process the task
      let result;
      switch (type) {
        case "analyze":
          result = await analyzeText(data);
          break;
        case "summarize":
          result = await summarizeText(data);
          break;
        default:
          throw new Error(`Unknown task type: ${type}`);
      }

      // Send result back
      await agent.send({
        to: { agentId: message.from },
        payload: {
          type: "task-result",
          taskId,
          success: true,
          result,
        },
      });

      console.log(`Completed task ${taskId}`);
    } catch (error) {
      // Send error back
      await agent.send({
        to: { agentId: message.from },
        payload: {
          type: "task-result",
          taskId,
          success: false,
          error: error.message,
        },
      });

      console.error(`Failed task ${taskId}:`, error);
    } finally {
      // Update state back to running
      await agent.update({
        state: "running",
        metadata: { currentTask: null },
      });
    }
  });

  console.log("Ready to process tasks");

  // Handle shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    await agent.leaveScope("task-queue");
    await agent.disconnect();
  });
}
```

---

## Best Practices

1. **Handle reconnection** - Store resume token for session continuity
2. **Update state** - Keep agent state current (running/busy/etc.)
3. **Use scopes** - Group related agents for easier messaging
4. **Handle errors** - Send error responses for failed tasks
5. **Clean up** - Leave scopes and disconnect gracefully
6. **Use metadata** - Store agent capabilities and current work

---

## Next Steps

- [Client Integration](./client.html) - Build monitoring dashboards
- [Transports](./transports.html) - Connect via different transports
- [Testing](./testing.html) - Test agent integrations
