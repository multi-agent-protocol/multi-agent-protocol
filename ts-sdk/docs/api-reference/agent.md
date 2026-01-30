# Agent API Reference

## AgentConnection

Connection class for MAP agents (workers and collaborators).

### Constructor

```typescript
new AgentConnection(stream: Stream, options: AgentConnectionOptions)
```

**AgentConnectionOptions:**
| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Agent name |
| `role` | `string` | No | - | Agent role |
| `metadata` | `Record<string, unknown>` | No | - | Initial metadata |
| `reconnect` | `ReconnectOptions` | No | - | Auto-reconnect settings |
| `reconnect.enabled` | `boolean` | No | `false` | Enable auto-reconnect |
| `reconnect.maxAttempts` | `number` | No | `10` | Max reconnect attempts |
| `reconnect.baseDelayMs` | `number` | No | `1000` | Initial delay |
| `reconnect.maxDelayMs` | `number` | No | `30000` | Max delay |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `state` | `ConnectionState` | Current connection state |
| `resumeToken` | `string \| undefined` | Token for session resume |
| `agentId` | `string \| undefined` | Registered agent ID |

**ConnectionState:** `"initial" | "connecting" | "connected" | "reconnecting" | "closed"`

### Methods

#### connect(options?)

Connect and register the agent.

```typescript
connect(options?: ConnectOptions): Promise<AgentConnectResult>
```

**ConnectOptions:**
| Option | Type | Description |
|--------|------|-------------|
| `resumeToken` | `string` | Token to resume previous session |

**AgentConnectResult:**
| Field | Type | Description |
|-------|------|-------------|
| `connection` | `ConnectResult` | Connection details |
| `connection.sessionId` | `string` | Session ID |
| `connection.resumed` | `boolean` | Whether resumed |
| `agent` | `Agent` | Registered agent info |

#### disconnect()

Disconnect and unregister.

```typescript
disconnect(): Promise<string | undefined>
```

**Returns:** Resume token for reconnection.

#### update(updates)

Update agent state or metadata.

```typescript
update(updates: AgentUpdates): Promise<Agent>
```

**AgentUpdates:**
| Field | Type | Description |
|-------|------|-------------|
| `state` | `AgentState` | New state |
| `metadata` | `Record<string, unknown>` | New metadata (merged) |

**AgentState:** `"running" | "busy" | "suspended" | "stopped"`

#### send(params)

Send a message.

```typescript
send(params: SendParams): Promise<{ messageId: string }>
```

**SendParams:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `{ agentId?: string; scopeId?: string }` | Yes | Destination |
| `payload` | `unknown` | Yes | Message content |

#### onMessage(handler)

Register a message handler.

```typescript
onMessage(handler: (message: Message) => void | Promise<void>): () => void
```

**Returns:** Unsubscribe function.

Multiple handlers can be registered; they're called in order.

---

## Scope Methods

#### createScope(params)

Create a new scope.

```typescript
createScope(params: CreateScopeParams): Promise<Scope>
```

**CreateScopeParams:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Scope name |
| `parentId` | `string` | No | Parent scope ID |
| `metadata` | `Record<string, unknown>` | No | Scope metadata |

#### joinScope(scopeId)

Join a scope.

```typescript
joinScope(scopeId: string): Promise<void>
```

#### leaveScope(scopeId)

Leave a scope.

```typescript
leaveScope(scopeId: string): Promise<void>
```

#### listScopes()

List all scopes.

```typescript
listScopes(): Promise<{ scopes: Scope[] }>
```

---

## Query Methods

#### listAgents(filter?)

List registered agents.

```typescript
listAgents(filter?: AgentFilter): Promise<{ agents: Agent[] }>
```

**AgentFilter:**
| Field | Type | Description |
|-------|------|-------------|
| `role` | `string` | Filter by role |
| `state` | `string` | Filter by state |
| `scopeId` | `string` | Filter by scope membership |

#### getAgent(agentId)

Get a specific agent.

```typescript
getAgent(agentId: string): Promise<{ agent: Agent | undefined }>
```

---

## Subscription Methods

#### subscribe(options)

Subscribe to events.

```typescript
subscribe(options: SubscribeOptions): Promise<Subscription>
```

**SubscribeOptions:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventTypes` | `string[]` | Yes | Event types to subscribe |
| `scopeIds` | `string[]` | No | Filter by scopes |

**Returns:** `Subscription` - Async iterable of events.

---

## Connection State

#### onStateChange(handler)

Subscribe to connection state changes.

```typescript
onStateChange(handler: (state: ConnectionState) => void): () => void
```

**Returns:** Unsubscribe function.

---

## Types

### Agent

```typescript
interface Agent {
  id: string;
  name: string;
  role?: string;
  state: AgentState;
  metadata?: Record<string, unknown>;
  createdAt: number;
}
```

### Scope

```typescript
interface Scope {
  id: string;
  name: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}
```

### Message

```typescript
interface Message {
  id: string;
  from: string;
  to: { agentId?: string; scopeId?: string };
  payload: unknown;
  timestamp: number;
}
```

### MAPEvent

```typescript
interface MAPEvent {
  id: string;
  type: string;
  timestamp: number;
  data: unknown;
  source?: {
    agentId?: string;
    scopeId?: string;
  };
}
```

---

## Typical Workflow

```typescript
// 1. Create connection
const agent = new AgentConnection(stream, {
  name: "Worker",
  role: "processor",
  metadata: { capabilities: ["ocr", "summarize"] },
});

// 2. Connect (automatically registers)
const { agent: registered } = await agent.connect();

// 3. Set up message handler
agent.onMessage(async (message) => {
  console.log(`Task: ${message.payload.type}`);
  // Process message...

  // Reply
  await agent.send({
    to: { agentId: message.from },
    payload: { type: "result", data: result },
  });
});

// 4. Join relevant scopes
await agent.joinScope("task-queue");

// 5. Update state as needed
await agent.update({ state: "busy" });
// ... do work ...
await agent.update({ state: "running" });

// 6. Disconnect when done
await agent.disconnect();
```

---

## Session Resume

```typescript
// First session
const agent1 = new AgentConnection(stream1, { name: "Worker", role: "processor" });
const { connection } = await agent1.connect();
const token = connection.resumeToken;

// Save token for later
await agent1.disconnect();

// Resume later
const agent2 = new AgentConnection(stream2, { name: "Worker", role: "processor" });
const result = await agent2.connect({ resumeToken: token });

if (result.connection.resumed) {
  console.log("Session resumed, agent still registered");
}
```

---

## Error Handling

```typescript
try {
  await agent.send({
    to: { agentId: "unknown-agent" },
    payload: { type: "test" },
  });
} catch (error) {
  if (error.code === -32001) {
    console.error("Agent not found");
  } else {
    console.error("Send failed:", error.message);
  }
}
```

| Code | Name | Description |
|------|------|-------------|
| -32001 | Not found | Agent/scope not found |
| -32002 | Already exists | Agent already registered |
| -32003 | Unauthorized | Permission denied |
| -32603 | Internal error | Server error |
