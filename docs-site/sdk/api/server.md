---
title: Server API
parent: API Reference
grand_parent: SDK
nav_order: 1
description: "MAPServer class and building blocks API"
---

# Server API
{: .no_toc }

MAPServer class and building block APIs.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## MAPServer

The main server class that wires together all building blocks.

### Constructor

```typescript
const server = new MAPServer(options?: MAPServerOptions);
```

### Options

```typescript
interface MAPServerOptions {
  // Server identity
  name?: string;
  version?: string;

  // Capabilities advertised to clients
  capabilities?: ServerCapabilities;

  // Custom protocol handlers
  additionalHandlers?: Record<string, Handler>;

  // Request middleware
  middleware?: Middleware[];

  // Event delivery configuration
  eventDelivery?: {
    enabled?: boolean;
    filter?: (event: Event, subscription: Subscription) => boolean;
  };

  // Session configuration
  resumeWindowMs?: number;

  // Custom stores
  stores?: {
    events?: EventStore;
    agents?: AgentStore;
    sessions?: SessionStore;
    scopes?: ScopeStore;
    subscriptions?: SubscriptionStore;
    messages?: MessageStore;
  };

  // Custom building blocks
  eventBus?: EventBus;
  agents?: AgentRegistry;
  sessions?: SessionManager;
  scopes?: ScopeManager;
  subscriptions?: SubscriptionManager;
  messages?: MessageRouter;

  // Authentication
  auth?: AuthConfig;
}
```

### Properties

| Property | Type | Description |
|:---------|:-----|:------------|
| `agents` | `AgentRegistry` | Agent registry instance |
| `sessions` | `SessionManager` | Session manager instance |
| `scopes` | `ScopeManager` | Scope manager instance |
| `subscriptions` | `SubscriptionManager` | Subscription manager instance |
| `messages` | `MessageRouter` | Message router instance |
| `connections` | `Map<string, Router>` | Active connections |

### Methods

#### accept()

Accept an incoming connection:

```typescript
const router = server.accept(stream: Stream, options?: AcceptOptions): Router;

interface AcceptOptions {
  role?: "client" | "agent" | "gateway";
  name?: string;
  resumeToken?: string;
}
```

#### emit()

Emit an event to the event bus:

```typescript
server.emit(event: { type: string; data: unknown }): void;
```

#### on()

Listen for events:

```typescript
server.on(eventType: string, handler: (event: Event) => void): void;
server.on("agent.registered", (event) => { ... });
server.on("*", (event) => { ... }); // All events
```

#### close()

Gracefully shut down the server:

```typescript
await server.close(options?: CloseOptions): Promise<void>;

interface CloseOptions {
  timeout?: number;  // Default: 5000ms
  force?: boolean;   // Skip graceful shutdown
}
```

---

## AgentRegistry

Manages registered agents.

### Methods

#### register()

```typescript
const agent = agents.register(params: RegisterParams): RegisteredAgent;

interface RegisterParams {
  name: string;
  sessionId: string;
  role?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}
```

#### unregister()

```typescript
const success = agents.unregister(agentId: string): boolean;
```

#### get()

```typescript
const agent = agents.get(agentId: string): RegisteredAgent | undefined;
```

#### list()

```typescript
const agentList = agents.list(filter?: AgentFilter): RegisteredAgent[];

interface AgentFilter {
  role?: string;
  state?: string;
  scopeId?: string;
  parentId?: string;
}
```

#### update()

```typescript
const agent = agents.update(agentId: string, updates: AgentUpdates): RegisteredAgent;

interface AgentUpdates {
  state?: string;
  metadata?: Record<string, unknown>;
}
```

---

## ScopeManager

Manages scopes (logical groupings).

### Methods

#### create()

```typescript
const scope = scopes.create(params: CreateScopeParams): Scope;

interface CreateScopeParams {
  name: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}
```

#### delete()

```typescript
const success = scopes.delete(scopeId: string): boolean;
```

#### get()

```typescript
const scope = scopes.get(scopeId: string): Scope | undefined;
```

#### list()

```typescript
const scopeList = scopes.list(filter?: ScopeFilter): Scope[];
```

#### join()

```typescript
scopes.join(scopeId: string, agentId: string): void;
```

#### leave()

```typescript
scopes.leave(scopeId: string, agentId: string): void;
```

#### getMembers()

```typescript
const memberIds = scopes.getMembers(scopeId: string): string[];
```

---

## SessionManager

Manages connection sessions.

### Methods

#### create()

```typescript
const session = sessions.create(params: CreateSessionParams): Session;
```

#### get()

```typescript
const session = sessions.get(sessionId: string): Session | undefined;
```

#### list()

```typescript
const sessionList = sessions.list(filter?: SessionFilter): Session[];
```

#### close()

```typescript
sessions.close(sessionId: string): void;
```

#### canResume()

```typescript
const resumable = sessions.canResume(resumeToken: string): boolean;
```

#### resume()

```typescript
const session = sessions.resume(resumeToken: string): Session | undefined;
```

---

## EventBus

Central event dispatcher.

### Methods

#### emit()

```typescript
eventBus.emit(event: Event): void;
```

#### on()

```typescript
eventBus.on(eventType: string, handler: EventHandler): void;
```

#### off()

```typescript
eventBus.off(eventType: string, handler: EventHandler): void;
```

#### getHistory()

```typescript
const events = eventBus.getHistory(afterId?: string, limit?: number): Event[];
```

---

## SubscriptionManager

Manages event subscriptions.

### Methods

#### create()

```typescript
const subscription = subscriptions.create(params: CreateSubscriptionParams): Subscription;

interface CreateSubscriptionParams {
  sessionId: string;
  eventTypes: string[];
  scopeIds?: string[];
  options?: SubscriptionOptions;
}
```

#### get()

```typescript
const subscription = subscriptions.get(subscriptionId: string): Subscription | undefined;
```

#### delete()

```typescript
subscriptions.delete(subscriptionId: string): void;
```

#### getForSession()

```typescript
const subs = subscriptions.getForSession(sessionId: string): Subscription[];
```

---

## MessageRouter

Routes messages between participants.

### Methods

#### send()

```typescript
const result = await messages.send(params: SendParams): SendResult;

interface SendParams {
  from?: string;
  to: Address;
  payload: unknown;
  meta?: MessageMeta;
}

interface SendResult {
  messageId: string;
  delivered: number;
  receipts: DeliveryReceipt[];
}
```

#### getQueue()

```typescript
const queue = messages.getQueue(agentId: string): Message[];
```

---

## Types

### RegisteredAgent

```typescript
interface RegisteredAgent {
  id: string;
  name: string;
  sessionId: string;
  role?: string;
  state: AgentState;
  parentId?: string;
  scopeIds: string[];
  metadata?: Record<string, unknown>;
  registeredAt: number;
  updatedAt: number;
}

type AgentState = "registered" | "running" | "busy" | "suspended" | "stopped";
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

### Session

```typescript
interface Session {
  id: string;
  participantType: "client" | "agent" | "gateway";
  name?: string;
  state: SessionState;
  agentId?: string;
  resumeToken?: string;
  principal?: Principal;
  connectedAt: number;
  lastActivityAt: number;
}

type SessionState = "connecting" | "connected" | "disconnected" | "closed";
```
