# MAP Streaming Semantics

This spec details how MAP handles system-wide event streaming, subscriptions, filtering, and replay.

## Design Goals

1. **System-wide visibility** - See all agent activity, not just one session
2. **Efficient filtering** - Subscribe only to relevant events
3. **Replay capability** - Catch up on missed events
4. **Backpressure handling** - Don't overwhelm slow consumers
5. **Ordered delivery** - Causal ordering where it matters

---

## Subscription Model

### Creating Subscriptions

```typescript
// Subscribe to multiple stream types with filtering
{
  "jsonrpc": "2.0",
  "id": "sub_001",
  "method": "map/subscribe",
  "params": {
    "streams": ["messages", "state", "tasks"],
    "filter": {
      "agents": ["agent_worker_*"],      // Glob pattern
      "roles": ["worker", "integrator"],
      "priorities": ["urgent", "high"],
      "scopes": ["scope_active"]
    },
    "options": {
      "includeHistory": false,
      "bufferSize": 1000,
      "deliveryMode": "at-least-once"
    }
  }
}
```

### Subscription Lifecycle

```
   ┌──────────┐    subscribe    ┌──────────┐
   │ inactive │ ──────────────► │  active  │
   └──────────┘                 └────┬─────┘
        ▲                            │
        │                            │ pause
        │                            ▼
        │                       ┌──────────┐
        │         resume        │  paused  │
        │ ◄──────────────────── └────┬─────┘
        │                            │
        │ unsubscribe               │ unsubscribe
        │                            ▼
        └─────────────────────► ┌──────────┐
                                │  closed  │
                                └──────────┘
```

---

## Event Delivery

### Event Envelope

```typescript
interface MAPStreamEventEnvelope {
  subscriptionId: string;
  sequence: number;              // Monotonic within subscription
  timestamp: number;             // Server timestamp
  event: MAPStreamEvent;

  // For ordering/dedup
  eventId: string;               // Globally unique
  causedBy?: string[];           // Causal predecessors
}
```

### Event Types

```typescript
type MAPStreamEvent =
  // Messaging events
  | { type: "message"; envelope: MAPEnvelope; receipts: MAPDeliveryReceipt[] }
  | { type: "message.ack"; messageId: string; agentId: string }
  | { type: "message.failed"; messageId: string; error: MAPError }

  // Agent state events
  | { type: "agent.registered"; agent: MAPAgent }
  | { type: "agent.unregistered"; agentId: string; reason: string }
  | { type: "agent.state"; agentId: string; previous: string; current: string }
  | { type: "agent.updated"; agentId: string; changes: Partial<MAPAgent> }

  // Task events
  | { type: "task.created"; task: MAPTask }
  | { type: "task.assigned"; taskId: string; agentId: string }
  | { type: "task.status"; taskId: string; previous: string; current: string }
  | { type: "task.completed"; taskId: string; result?: unknown }

  // Scope events
  | { type: "scope.created"; scope: MAPScope }
  | { type: "scope.deleted"; scopeId: string }
  | { type: "scope.member.added"; scopeId: string; agentId: string }
  | { type: "scope.member.removed"; scopeId: string; agentId: string }

  // System events
  | { type: "system.heartbeat"; timestamp: number }
  | { type: "system.capacity"; agents: number; maxAgents: number };
```

---

## Filtering

### Filter Syntax

```typescript
interface MAPStreamFilter {
  // Agent filtering (OR within, AND across fields)
  agents?: string[];              // Glob patterns
  roles?: string[];               // Role names
  scopes?: string[];              // Scope IDs
  environments?: string[];        // Environment IDs

  // Event filtering
  eventTypes?: string[];          // e.g., ["message", "task.*"]
  priorities?: MAPPriority[];     // For message events

  // Hierarchy filtering
  descendants?: string;           // All descendants of agent
  ancestors?: string;             // All ancestors of agent
  subtree?: string;               // Agent and all descendants
}
```

---

## Replay

### Replay Request

```typescript
{
  "jsonrpc": "2.0",
  "id": "replay_001",
  "method": "map/replay",
  "params": {
    // Time-based replay
    "from": 1706120000000,
    "to": 1706123456789,

    // OR event-based replay
    "afterEventId": "evt_x1y2z3",

    // Filter
    "filter": {
      "agents": ["agent_worker_*"],
      "eventTypes": ["task.*"]
    },

    // Options
    "options": {
      "limit": 1000,
      "order": "chronological",
      "includeSnapshots": true
    }
  }
}
```

---

## Ordering Guarantees

### Within-Agent Ordering

Events for a single agent are always delivered in causal order:

```
Agent A: state=idle → state=busy → state=idle
         (seq 1)      (seq 2)      (seq 3)
```

### Cross-Agent Ordering

Events across agents may be reordered unless causally related:

```
Agent A: message sent ────────────────┐
                                      ▼
Agent B:                    message received → state=busy

// The "message received" always comes after "message sent"
// But unrelated events may interleave
```

### Ordering Modes

```typescript
interface SubscriptionOptions {
  ordering:
    | "none"           // No ordering guarantee (fastest)
    | "per-agent"      // Ordered within each agent
    | "causal"         // Full causal ordering (may have latency)
    | "total";         // Total ordering (highest latency)
}
```

---

## Backpressure

### Client Flow Control

```typescript
// Client acknowledges events (enables flow control)
{
  "jsonrpc": "2.0",
  "method": "map/subscribe.ack",
  "params": {
    "subscriptionId": "sub_a1b2c3",
    "upToSequence": 100
  }
}
```

### Overflow Handling

```typescript
// Server notifies client of overflow
{
  "event": {
    "type": "subscription.overflow",
    "eventsDropped": 150,
    "oldestDropped": "evt_x1y2z3",
    "newestDropped": "evt_a4b5c6",
    "recommendation": "reduce_filter_scope"
  }
}
```

---

## Open Questions

1. **Event retention**: How long should servers retain events for replay?
2. **Compression**: Should event streams be compressible?
3. **Fan-out limits**: Max subscribers per event type?
4. **Cross-federation streaming**: How do events propagate across federated systems?
5. **Snapshot frequency**: How often should state snapshots be created?
