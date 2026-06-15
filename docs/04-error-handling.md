# MAP Error Handling & Failure Modes

> **Status (2026-06):** The error *taxonomy*, failure modes, recovery, and retry semantics here are current, but the numeric **Error Codes** block below predates the consolidation recut. Per-extension error ranges are now allocated by the registry — mail 10000–10999, credentials 11000–11999, workspace 12000–12999, trajectory 13000–13999, tasks 14000–14999, resources 15000–15999, sessions 16000–16999, federation 5000–5999 — with JSON-RPC standard codes unchanged. The 1xxx/2xxx/3xxx/4xxx ranges below are superseded. See [map-ext.md](map-ext.md) §4 and [registry.md](registry.md).

This spec details how MAP handles errors, failures, and recovery across single-node and federated deployments.

## Design Goals

1. **Graceful degradation** - Partial failures don't cascade to total failure
2. **Clear error taxonomy** - Distinct error types with actionable codes
3. **Recovery semantics** - Well-defined reconnection and replay behavior
4. **Federation resilience** - Cross-system failures handled gracefully
5. **Observability** - Errors are traceable and debuggable

---

## Error Taxonomy

### Error Categories

```typescript
type MAPErrorCategory =
  | "protocol"      // Wire protocol violations
  | "auth"          // Authentication/authorization
  | "routing"       // Message delivery failures
  | "agent"         // Agent lifecycle errors
  | "resource"      // Resource exhaustion
  | "federation"    // Cross-system errors
  | "internal";     // Server internal errors
```

### Error Structure

```typescript
interface MAPError {
  code: number;                  // Numeric code
  category: MAPErrorCategory;
  message: string;               // Human-readable

  details?: {
    agentId?: string;
    messageId?: string;
    method?: string;
    retryable?: boolean;
    retryAfter?: number;
    recoveryHint?: string;
  };

  traceId?: string;
  timestamp?: number;
}
```

### Error Codes

```typescript
// Protocol errors (-32xxx range, JSON-RPC compatible)
PARSE_ERROR: -32700,
INVALID_REQUEST: -32600,
METHOD_NOT_FOUND: -32601,
INVALID_PARAMS: -32602,
INTERNAL_ERROR: -32603,

// Authentication errors (1xxx)
AUTH_REQUIRED: 1000,
AUTH_FAILED: 1001,
AUTH_EXPIRED: 1002,
PERMISSION_DENIED: 1003,

// Routing errors (2xxx)
AGENT_NOT_FOUND: 2000,
AGENT_STOPPED: 2001,
AGENT_BUSY: 2002,
DELIVERY_FAILED: 2006,
DELIVERY_TIMEOUT: 2007,

// Agent lifecycle errors (3xxx)
AGENT_EXISTS: 3000,
INVALID_PARENT: 3001,
HIERARCHY_CYCLE: 3002,
MAX_AGENTS_EXCEEDED: 3003,

// Resource errors (4xxx)
RATE_LIMITED: 4000,
QUOTA_EXCEEDED: 4001,
BUFFER_OVERFLOW: 4002,

// Federation errors (5xxx)
PEER_UNREACHABLE: 5000,
PEER_TIMEOUT: 5001,
PEER_REJECTED: 5002,
```

---

## Agent Failure Modes

```
1. Graceful Shutdown
   Agent: sends shutdown intent
   Server: drains queue, notifies parent, cleans up
   Recovery: None needed (intentional)

2. Crash (Unexpected Termination)
   Detection: Heartbeat timeout, process exit
   Server: Marks stopped, notifies parent, orphan handling
   Recovery: Restart with same ID or spawn replacement

3. Hang (Unresponsive)
   Detection: Request timeout, no heartbeat
   Server: Marks blocked, notifies parent
   Recovery: Force restart or manual intervention

4. Error Loop (Repeated Failures)
   Detection: Error rate threshold exceeded
   Server: Circuit breaker, reduce routing
   Recovery: Exponential backoff restart
```

### Orphan Handling Policy

```typescript
interface OrphanPolicy {
  tasks: "reassign" | "return_to_parent" | "fail" | "hold";
  children: "cascade_stop" | "reparent" | "orphan";
  messages: "drop" | "bounce" | "redirect";
}
```

---

## Connection Failures

### Reconnection Protocol

```
Client                                    Server
   │                                         │
   │◄─────── Connection Lost ───────────────│
   │                                         │
   │         (backoff: 1s, 2s, 4s, 8s...)   │
   │                                         │
   │─────── Reconnect Attempt ─────────────►│
   │                                         │
   │◄────── Connection Accept ──────────────│
   │                                         │
   │─────── map/reconnect ─────────────────►│
   │         { lastEventId, subscriptions } │
   │                                         │
   │◄────── Reconnect Response ─────────────│
   │         { missedEvents, newState }     │
```

---

## Circuit Breakers

### Per-Agent Circuit Breaker

```typescript
interface CircuitBreakerState {
  agentId: string;
  state: "closed" | "open" | "half-open";

  failureThreshold: number;
  successThreshold: number;
  timeout: number;

  failureCount: number;
  successCount: number;
  lastFailure: number;
  lastStateChange: number;
}
```

---

## Retry Policies

```typescript
interface RetryPolicy {
  maxAttempts: number;
  backoff: {
    type: "exponential" | "linear" | "constant";
    initial: number;
    max: number;
    multiplier?: number;
  };
  retryableErrors: number[];
  nonRetryableErrors: number[];
}

// Default policy
const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  backoff: {
    type: "exponential",
    initial: 1000,
    max: 30000,
    multiplier: 2
  },
  retryableErrors: [2002, 2007, 4000, 5001],
  nonRetryableErrors: [2000, 2001, 1003]
};
```

---

## Error Reporting & Observability

### Distributed Tracing Integration

```typescript
interface MAPTraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;

  // W3C Trace Context compatible
  traceparent?: string;
  tracestate?: string;
}
```

---

## Open Questions

1. **Dead letter queue**: Should undeliverable messages go to a DLQ?
2. **Error aggregation**: How to prevent error storms from overwhelming monitoring?
3. **Automatic recovery**: How much should the protocol auto-heal vs require intervention?
4. **Consistency model**: What consistency guarantees during partition recovery?
5. **Error budget**: Should there be SLO-style error budgets in the protocol?
