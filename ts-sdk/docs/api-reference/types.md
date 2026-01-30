# Types Reference

Complete TypeScript type definitions for the MAP SDK.

## Core Types

### Stream

Bidirectional message stream interface.

```typescript
interface Stream {
  readable: ReadableStream<AnyMessage>;
  writable: WritableStream<AnyMessage>;
}

type AnyMessage = MAPRequest | MAPResponse | MAPNotification;
```

### MAPRequest

JSON-RPC request.

```typescript
interface MAPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}
```

### MAPResponse

JSON-RPC response.

```typescript
interface MAPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: MAPError;
}
```

### MAPError

JSON-RPC error.

```typescript
interface MAPError {
  code: number;
  message: string;
  data?: unknown;
}
```

### MAPNotification

JSON-RPC notification (no response expected).

```typescript
interface MAPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
```

---

## Entity Types

### Agent

Agent information returned by queries.

```typescript
interface Agent {
  id: string;
  name: string;
  role?: string;
  state: AgentState;
  metadata?: Record<string, unknown>;
  parentId?: string;
  createdAt: number;
}

type AgentState = "running" | "busy" | "suspended" | "stopped";
```

### RegisteredAgent (Server)

Full agent record on the server.

```typescript
interface RegisteredAgent extends Agent {
  sessionId: string;
}
```

### Scope

Scope information.

```typescript
interface Scope {
  id: string;
  name: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}
```

### ServerScope (Server)

Server-side scope with internal tracking.

```typescript
interface ServerScope extends Scope {
  // Members tracked separately via ScopeStore
}
```

### Session

Session information.

```typescript
interface Session {
  id: string;
  role: SessionRole;
  status: SessionStatus;
  name?: string;
  createdAt: number;
  lastActivityAt: number;
}

type SessionRole = "client" | "agent" | "gateway";
type SessionStatus = "connected" | "disconnected" | "expired";
```

### ServerSession (Server)

Server-side session with additional tracking.

```typescript
interface ServerSession extends Session {
  resumeToken?: string;
  agentIds?: string[];
  subscriptionIds?: string[];
}
```

### Message

Message sent between agents.

```typescript
interface Message {
  id: string;
  from: string;
  to: MessageTarget;
  payload: unknown;
  timestamp: number;
  causedBy?: string;
}

interface MessageTarget {
  agentId?: string;
  scopeId?: string;
}
```

### ServerMessage (Server)

Server-side message with status.

```typescript
interface ServerMessage extends Message {
  status: "pending" | "delivered" | "failed";
  deliveredAt?: number;
}
```

---

## Event Types

### MAPEvent

Event in the MAP system.

```typescript
interface MAPEvent {
  id: string;
  type: string;
  timestamp: number;
  data: unknown;
  source?: EventSource;
  causedBy?: string;
}

interface EventSource {
  agentId?: string;
  scopeId?: string;
  sessionId?: string;
}
```

### Common Event Data

```typescript
// agent.registered
interface AgentRegisteredData {
  agent: Agent;
}

// agent.unregistered
interface AgentUnregisteredData {
  agentId: string;
}

// agent.updated
interface AgentUpdatedData {
  agent: Agent;
  changes: Partial<Agent>;
}

// scope.created
interface ScopeCreatedData {
  scope: Scope;
}

// scope.deleted
interface ScopeDeletedData {
  scopeId: string;
}

// scope.joined
interface ScopeJoinedData {
  scopeId: string;
  agentId: string;
}

// scope.left
interface ScopeLeftData {
  scopeId: string;
  agentId: string;
}

// message.sent
interface MessageSentData {
  message: Message;
}

// session.connected
interface SessionConnectedData {
  session: Session;
}

// session.disconnected
interface SessionDisconnectedData {
  sessionId: string;
  reason?: string;
}
```

---

## Subscription Types

### Subscription

Client-side subscription.

```typescript
interface Subscription extends AsyncIterable<MAPEvent> {
  id: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  unsubscribe(): Promise<void>;
  ack(eventId: string): Promise<void>;
}
```

### ServerSubscription (Server)

Server-side subscription record.

```typescript
interface ServerSubscription {
  id: string;
  sessionId: string;
  filter: SubscriptionFilter;
  paused: boolean;
  createdAt: number;
}
```

### SubscriptionFilter

Event filter for subscriptions.

```typescript
interface SubscriptionFilter {
  eventTypes: string[];
  scopeIds?: string[];
  agentIds?: string[];
}
```

---

## Handler Types (Server)

### Handler

Request handler function.

```typescript
type Handler = (params: unknown, ctx: HandlerContext) => Promise<unknown>;
```

### HandlerContext

Context passed to handlers.

```typescript
interface HandlerContext {
  session: ServerSession;
  requestId: string;
  signal: AbortSignal;
}
```

### HandlerRegistry

Map of method names to handlers.

```typescript
type HandlerRegistry = Record<string, Handler>;
```

### Middleware

Request middleware function.

```typescript
type Middleware = (
  method: string,
  params: unknown,
  ctx: HandlerContext,
  next: () => Promise<unknown>
) => Promise<unknown>;
```

---

## Store Types (Server)

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

interface AgentFilter {
  role?: string;
  state?: AgentState;
  scopeId?: string;
  sessionId?: string;
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

interface SessionFilter {
  role?: SessionRole;
  status?: SessionStatus;
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
  getChildren(scopeId: string): ServerScope[];
  clear(): void;
}
```

### SubscriptionStore

```typescript
interface SubscriptionStore {
  save(subscription: ServerSubscription): void;
  get(id: string): ServerSubscription | undefined;
  list(): ServerSubscription[];
  listBySession(sessionId: string): ServerSubscription[];
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
  ack(messageId: string): void;
  clear(): void;
}

interface QueueStats {
  pending: number;
  delivered: number;
  failed: number;
}
```

---

## Capability Types

### ParticipantCapabilities

Capabilities advertised by server or participant.

```typescript
interface ParticipantCapabilities {
  subscriptions?: {
    maxActive?: number;
    maxEventTypes?: number;
    backpressure?: boolean;
  };
  streaming?: {
    backpressure?: boolean;
    pauseResume?: boolean;
  };
  messaging?: {
    maxPayloadSize?: number;
    supportsScopes?: boolean;
  };
  agents?: {
    maxPerSession?: number;
    supportsHierarchy?: boolean;
  };
}
```

---

## Connection Types

### ConnectOptions

```typescript
interface ConnectOptions {
  resumeToken?: string;
}
```

### ConnectResult

```typescript
interface ConnectResult {
  sessionId: string;
  resumeToken?: string;
  resumed?: boolean;
  systemInfo?: {
    name: string;
    version: string;
  };
  capabilities?: ParticipantCapabilities;
}
```

### ReconnectOptions

```typescript
interface ReconnectOptions {
  enabled?: boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}
```

### ConnectionState

```typescript
type ConnectionState =
  | "initial"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";
```

---

## Utility Functions

### createStreamPair

Create connected in-memory streams for testing.

```typescript
function createStreamPair(): [Stream, Stream];
```
