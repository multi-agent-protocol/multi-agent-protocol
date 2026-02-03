---
title: Types
parent: API Reference
grand_parent: SDK
nav_order: 4
description: "TypeScript type definitions"
---

# Types
{: .no_toc }

TypeScript type definitions for the MAP SDK.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Core Types

### Stream

Bidirectional communication stream:

```typescript
interface Stream {
  readable: ReadableStream<JSONRPCMessage>;
  writable: WritableStream<JSONRPCMessage>;
}
```

### JSONRPCMessage

JSON-RPC 2.0 message types:

```typescript
type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: JSONRPCError;
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}
```

---

## Entity Types

### Agent

```typescript
interface Agent {
  id: string;
  name: string;
  role?: string;
  state: AgentState;
  parentId?: string;
  scopeIds: string[];
  metadata?: Record<string, unknown>;
}

type AgentState =
  | "registered"
  | "running"
  | "busy"
  | "idle"
  | "suspended"
  | "stopping"
  | "stopped"
  | "failed";
```

### RegisteredAgent

Extended agent with registration details:

```typescript
interface RegisteredAgent extends Agent {
  sessionId: string;
  registeredAt: number;
  updatedAt: number;
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

### Session

```typescript
interface Session {
  id: string;
  participantType: ParticipantType;
  name?: string;
  state: SessionState;
  agentId?: string;
  resumeToken?: string;
  principal?: Principal;
  connectedAt: number;
  lastActivityAt: number;
}

type ParticipantType = "client" | "agent" | "gateway";

type SessionState = "connecting" | "connected" | "disconnected" | "closed";
```

---

## Message Types

### Message

```typescript
interface Message {
  id: string;
  from: string;
  to: Address;
  payload: unknown;
  meta?: MessageMeta;
  timestamp: number;
}

interface MessageMeta {
  priority?: Priority;
  delivery?: DeliveryMode;
  ttl?: number;
  requireAck?: boolean;
  correlationId?: string;
}

type Priority = "low" | "normal" | "high" | "urgent";
type DeliveryMode = "inject" | "interrupt" | "queue" | "best-effort";
```

### Address

```typescript
type Address =
  | { agentId: string }
  | { scopeId: string }
  | { role: string }
  | { agentIds: string[] }
  | { parent: true }
  | { children: true };
```

### IncomingMessage

Message received by an agent:

```typescript
interface IncomingMessage {
  id: string;
  from: string;
  payload: unknown;
  meta?: MessageMeta;
  timestamp: number;
}
```

---

## Event Types

### Event

```typescript
interface Event {
  id: string;
  type: string;
  data: unknown;
  timestamp: number;
  agentId?: string;
  scopeId?: string;
  causedBy?: string[];
}
```

### Event Type Strings

```typescript
// Agent events
type AgentEventType =
  | "agent.registered"
  | "agent.unregistered"
  | "agent.updated"
  | "agent.state";

// Scope events
type ScopeEventType =
  | "scope.created"
  | "scope.deleted"
  | "scope.joined"
  | "scope.left";

// Message events
type MessageEventType =
  | "message.sent"
  | "message.delivered"
  | "message.failed";

// System events
type SystemEventType =
  | "system.heartbeat"
  | "system.capacity";
```

---

## Subscription Types

### Subscription

```typescript
interface Subscription {
  id: string;
  sessionId: string;
  eventTypes: string[];
  scopeIds?: string[];
  state: SubscriptionState;
  createdAt: number;

  // Async iterator
  [Symbol.asyncIterator](): AsyncIterator<Event>;

  // Methods
  pause(): Promise<void>;
  resume(): Promise<void>;
  unsubscribe(): Promise<void>;
  ack(eventId: string): Promise<void>;
}

type SubscriptionState = "active" | "paused" | "closed";
```

### SubscribeParams

```typescript
interface SubscribeParams {
  eventTypes: string[];
  scopeIds?: string[];
  options?: SubscriptionOptions;
}

interface SubscriptionOptions {
  bufferSize?: number;
  overflowStrategy?: "drop" | "error" | "block";
  ordering?: "none" | "per-agent" | "causal" | "total";
  includeHistory?: boolean;
}
```

---

## Authentication Types

### AuthCredentials

```typescript
interface AuthCredentials {
  method: AuthMethod;
  credential?: string;
  metadata?: Record<string, unknown>;
}

type AuthMethod = "none" | "bearer" | "api-key" | "mtls" | string;
```

### Principal

```typescript
interface Principal {
  id: string;
  issuer?: string;
  claims?: Record<string, unknown>;
}
```

### AuthResult

```typescript
interface AuthResult {
  success: boolean;
  principal?: Principal;
  expiresAt?: number;
  error?: {
    code: AuthErrorCode;
    message: string;
  };
}

type AuthErrorCode =
  | "invalid_credentials"
  | "expired"
  | "insufficient_scope"
  | "method_not_supported"
  | "auth_required";
```

---

## Connection Types

### ConnectionState

```typescript
type ConnectionState =
  | "initial"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";
```

### ReconnectOptions

```typescript
interface ReconnectOptions {
  enabled: boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}
```

---

## Server Types

### ServerCapabilities

```typescript
interface ServerCapabilities {
  streaming?: {
    backpressure?: boolean;
    maxSubscriptions?: number;
  };
  federation?: boolean;
  replay?: boolean;
  scopes?: boolean;
  maxMessageSize?: number;
}
```

### Handler

```typescript
type Handler = (
  params: unknown,
  context: HandlerContext
) => Promise<unknown>;

interface HandlerContext {
  session: Session;
  requestId: string;
}
```

### Middleware

```typescript
type Middleware = (
  method: string,
  params: unknown,
  context: HandlerContext,
  next: () => Promise<unknown>
) => Promise<unknown>;
```

---

## Error Types

### MAPError

```typescript
interface MAPError extends Error {
  code: number;
  category: ErrorCategory;
  data?: {
    retryable?: boolean;
    retryAfter?: number;
    details?: unknown;
  };
}

type ErrorCategory =
  | "protocol"
  | "auth"
  | "routing"
  | "agent"
  | "resource"
  | "federation"
  | "internal";
```

### Error Codes

```typescript
// Protocol errors (JSON-RPC)
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// Auth errors
const AUTH_REQUIRED = 1000;
const AUTH_FAILED = 1001;
const AUTH_EXPIRED = 1002;
const PERMISSION_DENIED = 1003;

// Routing errors
const AGENT_NOT_FOUND = 2000;
const AGENT_STOPPED = 2001;
const DELIVERY_FAILED = 2006;
const DELIVERY_TIMEOUT = 2007;

// Agent errors
const AGENT_EXISTS = 3000;
const INVALID_PARENT = 3001;
const MAX_AGENTS_EXCEEDED = 3003;

// Resource errors
const RATE_LIMITED = 4000;
const QUOTA_EXCEEDED = 4001;
const BUFFER_OVERFLOW = 4002;

// Federation errors
const PEER_UNREACHABLE = 5000;
const PEER_TIMEOUT = 5001;
```
