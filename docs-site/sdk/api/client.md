---
title: Client API
parent: API Reference
grand_parent: SDK
nav_order: 2
description: "ClientConnection methods and properties"
---

# Client API
{: .no_toc }

ClientConnection class for observing MAP systems.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## ClientConnection

### Constructor

```typescript
const client = new ClientConnection(stream: Stream, options: ClientOptions);

interface ClientOptions {
  name: string;
  auth?: AuthCredentials;
  reconnect?: ReconnectOptions;
}

interface AuthCredentials {
  method: "bearer" | "api-key" | "none";
  credential?: string;
}

interface ReconnectOptions {
  enabled: boolean;
  maxAttempts?: number;     // Default: 5
  baseDelayMs?: number;     // Default: 1000
  maxDelayMs?: number;      // Default: 30000
}
```

---

## Properties

| Property | Type | Description |
|:---------|:-----|:------------|
| `state` | `ConnectionState` | Current connection state |
| `sessionId` | `string \| undefined` | Current session ID |
| `resumeToken` | `string \| undefined` | Token for session resume |

```typescript
type ConnectionState = "initial" | "connecting" | "connected" | "reconnecting" | "closed";
```

---

## Connection Methods

### connect()

Establish connection to the server:

```typescript
const result = await client.connect(options?: ConnectOptions): Promise<ConnectResult>;

interface ConnectOptions {
  resumeToken?: string;  // Resume previous session
}

interface ConnectResult {
  sessionId: string;
  participantId: string;
  systemInfo?: {
    name: string;
    version: string;
  };
  serverCapabilities: ServerCapabilities;
  principal?: Principal;
  resumed?: boolean;
}
```

### disconnect()

Gracefully disconnect:

```typescript
await client.disconnect(): Promise<void>;
```

### updateAuth()

Update authentication credentials:

```typescript
client.updateAuth(credentials: AuthCredentials): void;
```

---

## Query Methods

### listAgents()

List registered agents:

```typescript
const { agents } = await client.listAgents(filter?: AgentFilter): Promise<ListAgentsResult>;

interface AgentFilter {
  role?: string;
  state?: string;
  scopeId?: string;
}

interface ListAgentsResult {
  agents: Agent[];
}
```

### getAgent()

Get a specific agent:

```typescript
const { agent } = await client.getAgent(agentId: string): Promise<GetAgentResult>;

interface GetAgentResult {
  agent: Agent | null;
}
```

### listScopes()

List available scopes:

```typescript
const { scopes } = await client.listScopes(filter?: ScopeFilter): Promise<ListScopesResult>;

interface ListScopesResult {
  scopes: Scope[];
}
```

### getScope()

Get a specific scope:

```typescript
const { scope } = await client.getScope(scopeId: string): Promise<GetScopeResult>;

interface GetScopeResult {
  scope: Scope | null;
}
```

---

## Subscription Methods

### subscribe()

Subscribe to events:

```typescript
const subscription = await client.subscribe(params: SubscribeParams): Promise<Subscription>;

interface SubscribeParams {
  eventTypes: string[];      // e.g., ["agent.*", "message.sent"]
  scopeIds?: string[];       // Filter by scopes
  options?: {
    bufferSize?: number;
    overflowStrategy?: "drop" | "error" | "block";
  };
}
```

### Subscription Object

```typescript
interface Subscription {
  id: string;

  // Async iterator for events
  [Symbol.asyncIterator](): AsyncIterator<Event>;

  // Control methods
  pause(): Promise<void>;
  resume(): Promise<void>;
  unsubscribe(): Promise<void>;

  // Backpressure
  ack(eventId: string): Promise<void>;
}

// Usage
for await (const event of subscription) {
  console.log(event.type, event.data);
}
```

---

## Messaging Methods

### send()

Send a message:

```typescript
const result = await client.send(params: SendParams): Promise<SendResult>;

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
  | { role: string };

interface SendResult {
  messageId: string;
  delivered: number;
}
```

---

## Replay Methods

### replay()

Replay missed events:

```typescript
const events = await client.replay(params: ReplayParams): Promise<Event[]>;

interface ReplayParams {
  afterEventId?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  eventTypes?: string[];
  limit?: number;
}
```

---

## State Management

### onStateChange()

Listen for connection state changes:

```typescript
client.onStateChange(handler: (state: ConnectionState) => void): void;
```

### Current State

```typescript
if (client.state === "connected") {
  // Safe to make requests
}
```

---

## Event Handlers

### onError()

Handle connection errors:

```typescript
client.onError(handler: (error: Error) => void): void;
```

### onReconnecting()

Handle reconnection attempts:

```typescript
client.onReconnecting(handler: (attempt: number) => void): void;
```

### onReconnected()

Handle successful reconnection:

```typescript
client.onReconnected(handler: () => void): void;
```

---

## Types

### Agent

```typescript
interface Agent {
  id: string;
  name: string;
  role?: string;
  state: string;
  parentId?: string;
  scopeIds: string[];
  metadata?: Record<string, unknown>;
}
```

### Scope

```typescript
interface Scope {
  id: string;
  name: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}
```

### Event

```typescript
interface Event {
  id: string;
  type: string;
  data: unknown;
  timestamp: number;
  agentId?: string;
  scopeId?: string;
}
```

---

## Example

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";

const client = new ClientConnection(stream, {
  name: "Dashboard",
  reconnect: { enabled: true },
});

// Connect
const { sessionId, systemInfo } = await client.connect();
console.log(`Connected to ${systemInfo?.name}`);

// Query agents
const { agents } = await client.listAgents({ role: "worker" });
console.log(`Found ${agents.length} workers`);

// Subscribe to events
const subscription = await client.subscribe({
  eventTypes: ["agent.*"],
});

for await (const event of subscription) {
  console.log(`${event.type}: ${JSON.stringify(event.data)}`);
}
```
