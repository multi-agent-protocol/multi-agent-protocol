# Server API Reference

## MAPServer

The main convenience class for creating MAP-compliant servers.

### Constructor

```typescript
new MAPServer(options?: MAPServerOptions)
```

### MAPServerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `"MAPServer"` | Server name in connect responses |
| `version` | `string` | `"1.0.0"` | Server version in connect responses |
| `capabilities` | `ParticipantCapabilities` | - | Advertised capabilities |
| `eventBus` | `EventBus` | - | Replace EventBus building block |
| `agents` | `AgentRegistry` | - | Replace AgentRegistry building block |
| `scopes` | `ScopeManager` | - | Replace ScopeManager building block |
| `sessions` | `SessionManager` | - | Replace SessionManager building block |
| `subscriptions` | `SubscriptionManager` | - | Replace SubscriptionManager building block |
| `messages` | `MessageRouter` | - | Replace MessageRouter building block |
| `stores` | `object` | - | Custom storage implementations |
| `stores.events` | `EventStore` | - | Event storage |
| `stores.agents` | `AgentStore` | - | Agent storage |
| `stores.sessions` | `SessionStore` | - | Session storage |
| `stores.scopes` | `ScopeStore` | - | Scope storage |
| `stores.subscriptions` | `SubscriptionStore` | - | Subscription storage |
| `stores.messages` | `MessageQueueStore` | - | Message queue storage |
| `handlers` | `HandlerRegistry` | - | Replace all handlers |
| `additionalHandlers` | `HandlerRegistry` | - | Add handlers to defaults |
| `middleware` | `Middleware[]` | - | Request middleware chain |
| `eventDelivery` | `object` | - | Event delivery config |
| `eventDelivery.enabled` | `boolean` | `true` | Enable event delivery |
| `eventDelivery.filter` | `function` | - | Custom event filter |
| `resumeWindowMs` | `number` | `300000` | Session resume window (5 min) |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `eventBus` | `EventBus` | Event dispatcher |
| `agents` | `AgentRegistry` | Agent lifecycle |
| `scopes` | `ScopeManager` | Scope management |
| `sessions` | `SessionManager` | Session tracking |
| `subscriptions` | `SubscriptionManager` | Event subscriptions |
| `messages` | `MessageRouter` | Message routing |
| `handlers` | `HandlerRegistry` | Protocol handlers |
| `connections` | `ReadonlyMap<string, RouterConnection>` | Active connections |

### Methods

#### accept(stream, options?)

Accept a new connection.

```typescript
accept(stream: Stream, options?: AcceptOptions): RouterConnection
```

**AcceptOptions:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `role` | `"client" \| "agent" \| "gateway"` | `"agent"` | Connection role |
| `name` | `string` | - | Session name |
| `resumeToken` | `string` | - | Token for session resume |

**Returns:** `RouterConnection` - Must call `.start()` to begin processing.

#### close(options?)

Close the server and all connections.

```typescript
close(options?: CloseOptions): Promise<void>
```

**CloseOptions:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | `5000` | Graceful shutdown timeout (ms) |
| `force` | `boolean` | `false` | Force close without waiting |

#### on(type, handler)

Subscribe to events.

```typescript
on(type: string | string[], handler: (event: MAPEvent) => void): () => void
```

**Returns:** Unsubscribe function.

#### emit(event)

Emit an event.

```typescript
emit(event: Omit<MAPEvent, "id" | "timestamp">): MAPEvent
```

**Returns:** Complete event with id and timestamp.

---

## Building Blocks

### EventBus

Central event dispatcher.

```typescript
interface EventBus {
  emit(event: Omit<MAPEvent, "id" | "timestamp">): MAPEvent;
  on(type: string | string[], handler: (event: MAPEvent) => void): () => void;
  getAfter(afterId: string, limit?: number): MAPEvent[];
  getByType(type: string, limit?: number): MAPEvent[];
}
```

#### EventBusImpl

```typescript
new EventBusImpl(options?: { store?: EventStore })
```

### AgentRegistry

Agent lifecycle management.

```typescript
interface AgentRegistry {
  register(params: RegisterAgentParams): RegisteredAgent;
  unregister(agentId: string): boolean;
  get(agentId: string): RegisteredAgent | undefined;
  list(filter?: AgentFilter): RegisteredAgent[];
  update(agentId: string, updates: Partial<RegisteredAgent>): RegisteredAgent;
}
```

#### AgentRegistryImpl

```typescript
new AgentRegistryImpl(options: { eventBus: EventBus; store?: AgentStore })
```

**RegisterAgentParams:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Agent name |
| `sessionId` | `string` | Yes | Session ID |
| `role` | `string` | No | Agent role |
| `metadata` | `Record<string, unknown>` | No | Custom metadata |

**AgentFilter:**
| Field | Type | Description |
|-------|------|-------------|
| `role` | `string` | Filter by role |
| `state` | `string` | Filter by state |
| `scopeId` | `string` | Filter by scope membership |

### ScopeManager

Scope management with hierarchy.

```typescript
interface ScopeManager {
  create(params: CreateScopeParams): ServerScope;
  get(scopeId: string): ServerScope | undefined;
  list(): ServerScope[];
  delete(scopeId: string): boolean;
  join(scopeId: string, agentId: string): void;
  leave(scopeId: string, agentId: string): void;
  getMembers(scopeId: string): string[];
  getChildren(scopeId: string): ServerScope[];
  getHierarchy(scopeId: string): ServerScope[];
}
```

#### ScopeManagerImpl

```typescript
new ScopeManagerImpl(options: { eventBus: EventBus; store?: ScopeStore })
```

**CreateScopeParams:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Scope name |
| `parentId` | `string` | No | Parent scope ID |
| `metadata` | `Record<string, unknown>` | No | Custom metadata |

### SessionManager

Connection and session tracking.

```typescript
interface SessionManager {
  create(params: CreateSessionParams): ServerSession;
  get(sessionId: string): ServerSession | undefined;
  list(filter?: SessionFilter): ServerSession[];
  touch(sessionId: string): void;
  disconnect(sessionId: string): void;
  resume(resumeToken: string): ResumeResult;
  expireStale(maxAge: number): number;
}
```

#### SessionManagerImpl

```typescript
new SessionManagerImpl(options: {
  eventBus: EventBus;
  store?: SessionStore;
  resumeWindowMs?: number;
})
```

**CreateSessionParams:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `SessionRole` | Yes | `"client"`, `"agent"`, or `"gateway"` |
| `name` | `string` | No | Session name |

**ResumeResult:**
| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether resume succeeded |
| `session` | `ServerSession` | Resumed session (if success) |
| `reason` | `string` | Failure reason (if !success) |

### SubscriptionManager

Event subscription management.

```typescript
interface SubscriptionManager {
  create(params: CreateSubscriptionParams): ServerSubscription;
  get(subscriptionId: string): ServerSubscription | undefined;
  remove(subscriptionId: string): boolean;
  pause(subscriptionId: string): void;
  resume(subscriptionId: string): void;
  match(event: MAPEvent): string[];
  updateFilter(subscriptionId: string, filter: SubscriptionFilter): void;
}
```

#### SubscriptionManagerImpl

```typescript
new SubscriptionManagerImpl(options: {
  eventBus: EventBus;
  scopes: ScopeManager;
  store?: SubscriptionStore;
})
```

**CreateSubscriptionParams:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | Yes | Session ID |
| `filter` | `SubscriptionFilter` | Yes | Event filter |

**SubscriptionFilter:**
| Field | Type | Description |
|-------|------|-------------|
| `eventTypes` | `string[]` | Event types to match (supports `*`) |
| `scopeIds` | `string[]` | Scopes to filter by |

### MessageRouter

Message routing and delivery.

```typescript
interface MessageRouter {
  send(params: SendMessageParams): ServerMessage;
  onDeliver(handler: (agentId: string, message: ServerMessage) => void): () => void;
  getQueueStats(agentId: string): QueueStats;
  ack(messageId: string): void;
}
```

#### MessageRouterImpl

```typescript
new MessageRouterImpl(options: {
  eventBus: EventBus;
  agents: AgentRegistry;
  scopes: ScopeManager;
  queueStore?: MessageQueueStore;
})
```

**SendMessageParams:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | `string` | Yes | Sender agent ID |
| `to` | `{ agentId?: string; scopeId?: string }` | Yes | Destination |
| `payload` | `unknown` | Yes | Message content |

---

## Handler Factories

### createConnectionHandlers(options)

```typescript
createConnectionHandlers(options: {
  sessions: SessionManager;
  serverName: string;
  serverVersion: string;
}): HandlerRegistry
```

Handlers: `map/connect`, `map/disconnect`

### createAgentHandlers(options)

```typescript
createAgentHandlers(options: {
  agents: AgentRegistry;
}): HandlerRegistry
```

Handlers: `map/agents/register`, `map/agents/unregister`, `map/agents/list`, `map/agents/get`, `map/agents/update`

### createScopeHandlers(options)

```typescript
createScopeHandlers(options: {
  scopes: ScopeManager;
}): HandlerRegistry
```

Handlers: `map/scopes/create`, `map/scopes/list`, `map/scopes/get`, `map/scopes/join`, `map/scopes/leave`

### createMessageHandlers(options)

```typescript
createMessageHandlers(options: {
  messages: MessageRouter;
  scopes: ScopeManager;
}): HandlerRegistry
```

Handlers: `map/send`

### createSubscriptionHandlers(options)

```typescript
createSubscriptionHandlers(options: {
  subscriptions: SubscriptionManager;
  eventBus: EventBus;
}): HandlerRegistry
```

Handlers: `map/subscribe`, `map/unsubscribe`, `map/replay`

### combineHandlers(...handlers)

```typescript
combineHandlers(...handlers: HandlerRegistry[]): HandlerRegistry
```

Merge multiple handler registries (later handlers override earlier).

---

## Router

### RouterConnection

Handles JSON-RPC message routing.

```typescript
interface RouterConnection {
  readonly session: ServerSession;
  readonly closed: Promise<void>;
  start(): Promise<void>;
  close(): Promise<void>;
  notify(method: string, params: unknown): Promise<void>;
}
```

### RouterConnectionImpl

```typescript
new RouterConnectionImpl(options: RouterConnectionOptions)
```

**RouterConnectionOptions:**
| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `stream` | `Stream` | Yes | Bidirectional stream |
| `handlers` | `HandlerRegistry` | Yes | Protocol handlers |
| `sessions` | `SessionManager` | Yes | Session manager |
| `middleware` | `Middleware[]` | No | Middleware chain |
| `role` | `SessionRole` | Yes | Connection role |
| `name` | `string` | No | Session name |
| `resumeToken` | `string` | No | Resume token |

---

## Middleware

```typescript
type Middleware = (
  method: string,
  params: unknown,
  ctx: HandlerContext,
  next: () => Promise<unknown>
) => Promise<unknown>;
```

**HandlerContext:**
| Field | Type | Description |
|-------|------|-------------|
| `session` | `ServerSession` | Current session |
| `requestId` | `string` | Request ID |
| `signal` | `AbortSignal` | Abort signal |

---

## Store Interfaces

### EventStore

```typescript
interface EventStore {
  append(event: MAPEvent): void;
  getAfter(afterId: string, limit?: number): MAPEvent[];
  getByType(type: string, limit?: number): MAPEvent[];
  clear(): void;
}
```

### AgentStore

```typescript
interface AgentStore {
  save(agent: RegisteredAgent): void;
  get(id: string): RegisteredAgent | undefined;
  list(filter?: AgentFilter): RegisteredAgent[];
  delete(id: string): boolean;
  clear(): void;
}
```

### SessionStore

```typescript
interface SessionStore {
  save(session: ServerSession): void;
  get(id: string): ServerSession | undefined;
  getByResumeToken(token: string): ServerSession | undefined;
  list(filter?: SessionFilter): ServerSession[];
  delete(id: string): boolean;
  clear(): void;
}
```

### ScopeStore

```typescript
interface ScopeStore {
  save(scope: ServerScope): void;
  get(id: string): ServerScope | undefined;
  list(): ServerScope[];
  delete(id: string): boolean;
  getMembers(scopeId: string): string[];
  addMember(scopeId: string, agentId: string): void;
  removeMember(scopeId: string, agentId: string): void;
  clear(): void;
}
```

### SubscriptionStore

```typescript
interface SubscriptionStore {
  save(subscription: ServerSubscription): void;
  get(id: string): ServerSubscription | undefined;
  list(): ServerSubscription[];
  delete(id: string): boolean;
  clear(): void;
}
```

### MessageQueueStore

```typescript
interface MessageQueueStore {
  enqueue(agentId: string, message: ServerMessage): void;
  dequeue(agentId: string): ServerMessage | undefined;
  peek(agentId: string): ServerMessage | undefined;
  getStats(agentId: string): QueueStats;
  clear(): void;
}
```
