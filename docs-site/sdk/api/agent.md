---
title: Agent API
parent: API Reference
grand_parent: SDK
nav_order: 3
description: "AgentConnection methods and properties"
---

# Agent API
{: .no_toc }

AgentConnection class for building MAP agents.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## AgentConnection

### Constructor

```typescript
const agent = new AgentConnection(stream: Stream, options: AgentOptions);

interface AgentOptions {
  name: string;
  role?: string;
  metadata?: Record<string, unknown>;
  auth?: AuthCredentials;
  reconnect?: ReconnectOptions;
}
```

---

## Properties

| Property | Type | Description |
|:---------|:-----|:------------|
| `state` | `ConnectionState` | Current connection state |
| `id` | `string \| undefined` | Registered agent ID |
| `sessionId` | `string \| undefined` | Current session ID |
| `resumeToken` | `string \| undefined` | Token for session resume |

---

## Connection Methods

### connect()

Connect and register the agent:

```typescript
const result = await agent.connect(options?: ConnectOptions): Promise<AgentConnectResult>;

interface ConnectOptions {
  resumeToken?: string;
}

interface AgentConnectResult {
  agent: RegisteredAgent;
  connection: {
    sessionId: string;
    resumed: boolean;
  };
}
```

### disconnect()

Gracefully disconnect and unregister:

```typescript
await agent.disconnect(): Promise<void>;
```

---

## Message Handling

### onMessage()

Register a message handler:

```typescript
agent.onMessage(handler: MessageHandler): void;

type MessageHandler = (message: IncomingMessage) => void | Promise<void>;

interface IncomingMessage {
  id: string;
  from: string;
  payload: unknown;
  meta?: MessageMeta;
  timestamp: number;
}
```

Multiple handlers can be registered and are called in order:

```typescript
agent.onMessage((message) => {
  console.log(`Received: ${message.id}`);
});

agent.onMessage(async (message) => {
  if (message.payload.type === "task") {
    await processTask(message.payload);
  }
});
```

---

## Messaging Methods

### send()

Send a message to another agent or scope:

```typescript
const result = await agent.send(params: SendParams): Promise<SendResult>;

interface SendParams {
  to: Address;
  payload: unknown;
  meta?: {
    priority?: "low" | "normal" | "high" | "urgent";
    ttl?: number;
    requireAck?: boolean;
  };
}

type Address =
  | { agentId: string }
  | { scopeId: string }
  | { role: string }
  | { parent: true }
  | { children: true };

interface SendResult {
  messageId: string;
  delivered: number;
}
```

---

## Agent State Methods

### update()

Update agent state or metadata:

```typescript
await agent.update(updates: AgentUpdates): Promise<RegisteredAgent>;

interface AgentUpdates {
  state?: "running" | "busy" | "suspended";
  metadata?: Record<string, unknown>;
}
```

---

## Scope Methods

### createScope()

Create a new scope:

```typescript
const scope = await agent.createScope(params: CreateScopeParams): Promise<Scope>;

interface CreateScopeParams {
  name: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}
```

### joinScope()

Join an existing scope:

```typescript
await agent.joinScope(scopeId: string): Promise<void>;
```

### leaveScope()

Leave a scope:

```typescript
await agent.leaveScope(scopeId: string): Promise<void>;
```

### listScopes()

List available scopes:

```typescript
const { scopes } = await agent.listScopes(): Promise<ListScopesResult>;
```

---

## Query Methods

### listAgents()

List other agents:

```typescript
const { agents } = await agent.listAgents(filter?: AgentFilter): Promise<ListAgentsResult>;

interface AgentFilter {
  role?: string;
  state?: string;
  scopeId?: string;
}
```

### getAgent()

Get details for a specific agent:

```typescript
const { agent: otherAgent } = await agent.getAgent(agentId: string): Promise<GetAgentResult>;
```

---

## Subscription Methods

### subscribe()

Subscribe to system events:

```typescript
const subscription = await agent.subscribe(params: SubscribeParams): Promise<Subscription>;

interface SubscribeParams {
  eventTypes: string[];
  scopeIds?: string[];
}
```

---

## State Management

### onStateChange()

Listen for connection state changes:

```typescript
agent.onStateChange(handler: (state: ConnectionState) => void): void;
```

---

## Event Handlers

### onError()

Handle errors:

```typescript
agent.onError(handler: (error: Error) => void): void;
```

### onReconnecting()

Handle reconnection attempts:

```typescript
agent.onReconnecting(handler: (attempt: number) => void): void;
```

### onReconnected()

Handle successful reconnection:

```typescript
agent.onReconnected(handler: () => void): void;
```

---

## Types

### RegisteredAgent

```typescript
interface RegisteredAgent {
  id: string;
  name: string;
  role?: string;
  state: AgentState;
  parentId?: string;
  scopeIds: string[];
  metadata?: Record<string, unknown>;
  registeredAt: number;
}

type AgentState = "registered" | "running" | "busy" | "suspended" | "stopped";
```

---

## Example

```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

const agent = new AgentConnection(stream, {
  name: "TaskProcessor",
  role: "worker",
  metadata: {
    capabilities: ["text-analysis"],
  },
  reconnect: { enabled: true },
});

// Connect and register
const { agent: registered } = await agent.connect();
console.log(`Registered as ${registered.id}`);

// Join a scope
await agent.joinScope("task-queue");

// Handle messages
agent.onMessage(async (message) => {
  console.log(`Received task from ${message.from}`);

  await agent.update({ state: "busy" });

  try {
    const result = await processTask(message.payload);

    await agent.send({
      to: { agentId: message.from },
      payload: { type: "result", data: result },
    });
  } finally {
    await agent.update({ state: "running" });
  }
});

console.log("Ready to process tasks");
```
