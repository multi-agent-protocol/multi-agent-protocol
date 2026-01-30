# Client API Reference

## ClientConnection

Connection class for MAP clients (observers and requesters).

### Constructor

```typescript
new ClientConnection(stream: Stream, options?: ClientConnectionOptions)
```

**ClientConnectionOptions:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | - | Client name |
| `reconnect` | `ReconnectOptions` | - | Auto-reconnect settings |
| `reconnect.enabled` | `boolean` | `false` | Enable auto-reconnect |
| `reconnect.maxAttempts` | `number` | `10` | Max reconnect attempts |
| `reconnect.baseDelayMs` | `number` | `1000` | Initial delay |
| `reconnect.maxDelayMs` | `number` | `30000` | Max delay |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `state` | `ConnectionState` | Current connection state |
| `resumeToken` | `string \| undefined` | Token for session resume |

**ConnectionState:** `"initial" | "connecting" | "connected" | "reconnecting" | "closed"`

### Methods

#### connect(options?)

Connect to the server.

```typescript
connect(options?: ConnectOptions): Promise<ConnectResult>
```

**ConnectOptions:**
| Option | Type | Description |
|--------|------|-------------|
| `resumeToken` | `string` | Token to resume previous session |

**ConnectResult:**
| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | Assigned session ID |
| `resumeToken` | `string` | Token for future resume |
| `resumed` | `boolean` | Whether session was resumed |
| `systemInfo` | `object` | Server information |
| `systemInfo.name` | `string` | Server name |
| `systemInfo.version` | `string` | Server version |

#### disconnect()

Disconnect from the server.

```typescript
disconnect(): Promise<string | undefined>
```

**Returns:** Resume token for reconnection.

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

#### listScopes()

List all scopes.

```typescript
listScopes(): Promise<{ scopes: Scope[] }>
```

#### getScope(scopeId)

Get a specific scope.

```typescript
getScope(scopeId: string): Promise<{ scope: Scope | undefined }>
```

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
| `options` | `object` | No | Buffer options |
| `options.bufferSize` | `number` | No | Max buffer size |
| `options.overflowStrategy` | `string` | No | `"drop"`, `"error"`, `"block"` |

**Returns:** `Subscription` - Async iterable of events.

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

#### replay(options)

Replay missed events.

```typescript
replay(options: ReplayOptions): Promise<MAPEvent[]>
```

**ReplayOptions:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `afterEventId` | `string` | Yes | Start after this event |
| `eventTypes` | `string[]` | No | Filter by types |
| `limit` | `number` | No | Max events to return |

#### request(method, params)

Send a custom request.

```typescript
request<T>(method: string, params?: unknown): Promise<T>
```

#### onStateChange(handler)

Subscribe to connection state changes.

```typescript
onStateChange(handler: (state: ConnectionState) => void): () => void
```

**Returns:** Unsubscribe function.

---

## Subscription

Async iterable for receiving events.

### Methods

#### pause()

Pause event delivery.

```typescript
pause(): Promise<void>
```

#### resume()

Resume event delivery.

```typescript
resume(): Promise<void>
```

#### unsubscribe()

Cancel the subscription.

```typescript
unsubscribe(): Promise<void>
```

#### ack(eventId)

Acknowledge an event (for backpressure).

```typescript
ack(eventId: string): Promise<void>
```

### Async Iteration

```typescript
for await (const event of subscription) {
  console.log(event.type, event.data);
}
```

---

## Types

### Agent

```typescript
interface Agent {
  id: string;
  name: string;
  role?: string;
  state: "running" | "busy" | "suspended" | "stopped";
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
  causedBy?: string;
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

---

## Events

Common event types:

| Event Type | Data | Description |
|------------|------|-------------|
| `agent.registered` | `{ agent: Agent }` | Agent registered |
| `agent.unregistered` | `{ agentId: string }` | Agent unregistered |
| `agent.updated` | `{ agent: Agent }` | Agent state/metadata changed |
| `scope.created` | `{ scope: Scope }` | Scope created |
| `scope.deleted` | `{ scopeId: string }` | Scope deleted |
| `scope.joined` | `{ scopeId, agentId }` | Agent joined scope |
| `scope.left` | `{ scopeId, agentId }` | Agent left scope |
| `message.sent` | `{ message: Message }` | Message sent |
| `session.connected` | `{ session }` | Session connected |
| `session.disconnected` | `{ sessionId }` | Session disconnected |

### Event Type Patterns

- `agent.*` - All agent events
- `scope.*` - All scope events
- `*` - All events

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Invalid JSON-RPC |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Invalid parameters |
| -32603 | Internal error | Server error |
| -32001 | Not found | Resource not found |
| -32002 | Already exists | Resource already exists |
| -32003 | Unauthorized | Permission denied |
