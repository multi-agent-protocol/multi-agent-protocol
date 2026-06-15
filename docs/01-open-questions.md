# MAP Open Questions & Design Decisions

> **Status (2026-06):** Point-in-time design record (decisions dated Jan 2026). Predates the consolidation recut into a 23-method core + separately-versioned extensions. Specific method names and shapes here (e.g. `map/session/*`, `map/subscribe/resume`, `map/health`, `map/batch`) may not match the current protocol — see [14-consolidation-plan.md](14-consolidation-plan.md) and [registry.md](registry.md) for current state. Retained as a historical record of how decisions were reached.

This spec consolidates all open questions and unresolved design decisions across the MAP specification. Use this as the focal point for iterating on the protocol design.

## How to Use This Document

1. **Discuss & Decide**: Pick a question, discuss options, make a decision
2. **Document**: Record the decision with rationale in this spec
3. **Update**: Propagate the decision to the relevant child specs
4. **Close**: Mark the question as resolved

---

## Question Status Legend

- 🔴 **Blocking**: Must resolve before implementation
- 🟡 **Important**: Should resolve before v1.0
- 🟢 **Deferrable**: Can resolve in later versions
- ✅ **Resolved**: Decision made (kept for reference)

---

## Category 1: Protocol Fundamentals

These questions affect the core protocol design and are hard to change later.

### Q1.1: Message Acknowledgment ✅ RESOLVED

**Question**: Should the protocol require delivery confirmation for messages?

**Decision**: **Unified messaging with per-message delivery semantics via `meta.delivery`**

No separate ACK mechanism. Instead:
- `expectsResponse: true` → sender waits for response (implicit ACK)
- `delivery: "acknowledged"` → receiver sends explicit ACK
- `delivery: "fire-and-forget"` → no ACK
- `delivery: "guaranteed"` → retry until delivered

The pattern (task delegation vs peer messaging) determines the appropriate setting.

**Rationale**: Unifies the message model. Task delegation is naturally request-response. Peer messaging can opt-in to acknowledgment. Keeps the protocol simple while supporting all patterns.

**Decided**: 2026-01-24

---

### Q1.2: Ordering Guarantees ✅ RESOLVED

**Question**: What ordering is guaranteed for events?

**Decision**: **Per-agent ordering guaranteed + causal metadata included**

- Per-agent ordering is always guaranteed (Agent A's events always in order)
- Causal metadata (`causedBy` field) included in events
- Clients that need causal ordering can reconstruct from metadata
- Total ordering not required at protocol level

**Rationale**: Per-agent ordering is achievable without coordination overhead. Causal metadata enables reconstruction without mandating it. Total ordering would create a bottleneck and isn't needed for most use cases.

**Decided**: 2026-01-24

---

### Q1.3: Protocol Versioning ✅ RESOLVED

**Question**: How do we handle protocol evolution?

**Decision**: **Option D - Hybrid (capability negotiation within major version, breaking across)**

- Major versions may be incompatible (v1 vs v2)
- Within a major version, features are capability-negotiated
- Additive evolution preferred within major versions
- Breaking changes bump major version

**Rationale**: Follows ACP's approach. Provides stability within major versions while allowing evolution. Capability negotiation handles feature differences gracefully.

**Decided**: 2026-01-24

---

### Q1.4: Wire Format Requirements 🟡

**Question**: Should we support message compression?

**Options**:
- A. No compression (simplicity) ← **Leaning toward for v1**
- B. Optional gzip/brotli (negotiated)
- C. Always compress large messages (threshold-based)

**Related**: Message size limits - hard protocol limit or capability-negotiated?

**Current thinking**: Rely on transport-level compression (WebSocket permessage-deflate) for v1. Revisit if bandwidth becomes an issue.

**Decision**: *Pending final confirmation*

---

### Q1.5: Heartbeat Mechanism 🟡

**Question**: Explicit ping/pong or rely on transport-level keepalive?

**Options**:
- A. Transport-level only (WebSocket ping/pong)
- B. Protocol-level heartbeat (MAP-specific)
- C. Both (transport + protocol health check) ← **Leaning toward**

**Current thinking**: Transport-level for basic keepalive. Protocol-level `map/health` for connections that need it (federation, monitoring), capability-negotiated.

**Decision**: *Pending final confirmation*

---

### Q1.6: Participant Model ✅ RESOLVED

**Question**: Should agents and clients use the same protocol, or different protocols?

**Decision**: **Unified participant model - agents and clients speak the same protocol**

All participants (agents, clients, system, gateways) use the same MAP protocol. The differences are:
- **Capabilities**: What actions they can perform
- **Visibility**: What they can see
- **Transport**: How they connect (WebSocket, stdio, in-process, HTTP)

```typescript
interface MAPParticipant {
  id: string;
  type: "agent" | "client" | "system" | "gateway";
  visibility: MAPParticipantVisibility;
  capabilities: MAPParticipantCapabilities;
  transport: MAPTransport;
}
```

**Key implications**:
1. Agents connect to the system the same way clients do
2. Agents can be both clients (to their parent) and servers (to their children)
3. Federation is natural (remote agents are just participants over WebSocket)
4. Testing is simpler (mock agents are just MAP participants)

**Rationale**: Consistent semantics across all participants. Transport optimization without protocol changes. Natural support for hierarchical composition (Claude Code pattern where parent is server to children). Federation becomes a transport concern, not a protocol concern.

**Decided**: 2026-01-27

---

### Q1.7: Transport Layer ✅ RESOLVED

**Question**: Should the protocol be tied to a specific transport (WebSocket), or transport-agnostic?

**Decision**: **Transport-agnostic with pluggable bindings**

MAP defines message format and semantics. Transport is pluggable:

| Transport | Use Case | Framing |
|-----------|----------|---------|
| WebSocket | Remote clients, federation | JSON messages |
| stdio | Subprocess agents (Claude Code) | NDJSON (newline-delimited) |
| In-process | Co-located agents | Direct object passing |
| HTTP + SSE | Stateless clients | POST + Server-Sent Events |

```typescript
interface MAPTransport {
  type: string;
  send(frame: MAPFrame): Promise<void>;
  receive(): AsyncIterable<MAPFrame>;
  close(): Promise<void>;
  state: "connecting" | "connected" | "disconnected" | "error";
}
```

**Key implications**:
1. Spawn can specify transport: `transport: "stdio"` for subprocess agents
2. Same protocol over different wires
3. In-process transport avoids serialization overhead for co-located agents
4. HTTP+SSE enables browser clients without WebSocket

**Rationale**: Different deployment contexts need different transports. Subprocess agents (Claude Code pattern) use stdio naturally. Co-located agents shouldn't pay serialization cost. Remote clients need WebSocket. Protocol consistency matters more than transport uniformity.

**Decided**: 2026-01-27

---

## Category 2: Connection & Session Management

These affect how clients connect and maintain state.

### Q2.1: Connection Handshake Capabilities ✅ RESOLVED

**Question**: What capabilities are negotiated at connect time?

**Decision**: **Minimal capability set for v1, graceful degradation, fixed for session lifetime**

```typescript
interface MAPCapabilities {
  // Core
  protocolVersion: string;          // e.g., "2025-01-01"

  // Streaming
  streaming: boolean;
  replay: boolean;
  replayWindow?: number;            // How far back (ms)

  // Features
  federation: boolean;
  namedSubscriptions: boolean;      // Support for named/resumable subscriptions

  // Delivery
  deliverySemantics: string[];      // ["fire-and-forget", "acknowledged", "guaranteed"]

  // Limits (optional - implementation-specific)
  maxMessageSize?: number;
  maxSubscriptions?: number;        // If implementation enforces
}
```

**Key points**:
- Keep list minimal for v1, extend via capability negotiation
- Incompatible required capabilities = fail connection with clear error
- Missing optional capabilities = graceful degradation
- Capabilities fixed for session lifetime (no mid-session changes)

**Decided**: 2026-01-24

---

### Q2.2: Session Affinity ✅ RESOLVED

**Question**: Should subscriptions be tied to connection or transferable?

**Decision**: **Session-bound (like ACP) + optional named subscriptions**

Sessions are first-class entities that survive connection drops:

```typescript
interface MAPSession {
  sessionId: string;                // Unique identifier
  participantId: string;            // Owning participant
  participantType: "agent" | "client" | "gateway";
  subscriptions: MAPSubscription[]; // All subscriptions
  createdAt: number;
  lastActivity: number;
  expiresAfter?: number;            // TTL after disconnect (implementation-defined)
}

interface MAPSubscription {
  subscriptionId: string;           // Auto-generated
  name?: string;                    // Optional name for explicit resume
  filter: MAPSubscriptionFilter;
  streams: string[];
}
```

**Session lifecycle**:
1. `map/connect` creates new session or resumes existing (with `sessionId`)
2. Subscriptions belong to session, not connection
3. On reconnect with `sessionId`, subscriptions auto-restore + missed events replayed
4. Named subscriptions can be explicitly resumed even in new sessions

**Protocol methods**:
```typescript
"map/connect"
  params: { sessionId?: string }    // Omit for new, provide to resume

"map/subscribe"
  params: { name?: string, ... }    // Optional name

"map/subscribe/resume"
  params: { name: string, fromEventId?: string }
```

**Rationale**: Follows ACP's session model. Sessions provide resilience across connection drops. Named subscriptions add flexibility for explicit control when needed.

**Decided**: 2026-01-24

---

### Q2.3: Resource Limits ✅ RESOLVED

**Question**: Should the protocol mandate subscription limits?

**Decision**: **No - limits are implementation concern, not protocol requirement**

The protocol does not mandate resource limits. Implementations may enforce limits on:
- Number of concurrent subscriptions
- Message rates
- Connection counts
- etc.

If an implementation enforces limits:
- Advertise via capabilities in connection handshake
- Return clear errors when limits are reached
- Per-session tracking makes sense (since sessions are the unit of state)

```typescript
// Example: Implementation that enforces limits
interface MAPCapabilities {
  // Optional - only present if implementation enforces
  maxSubscriptions?: number;
  maxMessagesPerSecond?: number;
}
```

**Rationale**:
- Visibility already controls what clients can access
- Clients should subscribe to what they need
- Rate limiting and backpressure handle load concerns
- Keeps protocol flexible; operational concerns left to implementations

**Decided**: 2026-01-24

---

### Q2.4: Auth Token Refresh ✅ RESOLVED

**Question**: How to handle token expiration during long-lived connections?

**Decision**: **In-band refresh + reconnection fallback (complementary)**

Two mechanisms that work together:

**1. In-band refresh (primary, for smooth UX)**:
```typescript
"map/auth/refresh"
  params: { token: string }         // New token
  result: { expiresAt: number }     // New expiry time
```

**2. Reconnection fallback (when in-band fails)**:
```typescript
"map/connect"
  params: {
    sessionId: string,              // Resume session
    auth: { token: "new_token" }    // With fresh token
  }
```

**Flow**:
```
Normal operation:
  Token valid → Connection active → In-band refresh before expiry

Fallback (network blip, missed refresh window):
  Connection drops → Get new token externally → Reconnect with sessionId
  → Session restored with new auth
```

**Rationale**: In-band refresh provides smooth UX for dashboards and long-running connections. Reconnection fallback ensures no session state is lost even if refresh fails.

**Decided**: 2026-01-24

---

### Q2.5: Partial Visibility Queries ✅ RESOLVED

**Question**: Can a client request "all agents I can see" without knowing IDs upfront?

**Decision**: **Yes - server filters based on permissions (empty filter = all visible)**

```typescript
// Empty filter = "everything I'm allowed to see"
await map.subscribe({ filter: {}, streams: ["messages", "state"] });

// Server applies visibility rules:
// 1. System-level exposure (what's exposed at all)
// 2. Client permissions (what this client can see)
// 3. Scope visibility (what scopes allow)
// 4. Agent visibility (what agents expose)

// Same for queries
await map.agents.list({});          // Returns all visible agents
await map.scopes.list({});          // Returns all visible scopes
```

**Rationale**: Most ergonomic for clients. Dashboards don't need to know agent IDs upfront. Server already enforces visibility rules, so filtering is natural. Client implementations can further filter client-side if needed.

**Decided**: 2026-01-24

---

## Category 3: Streaming & Events

These affect the event streaming subsystem.

### Q3.0: Stream Ordering ✅ RESOLVED

**Question**: How should event streams preserve and enable ordering reconstruction?

**Decision**: **Multi-layered ordering with per-subscription sequences + global event IDs + causal metadata**

```typescript
interface MAPStreamEvent {
  subscriptionId: string;     // Which subscription
  seq: number;                // Monotonic within subscription (gap detection)
  event: MAPEventWithMeta;
}

interface MAPEventWithMeta extends MAPEvent {
  eventId: string;            // Globally unique, sortable (ULID)
  timestamp: number;          // Server timestamp
  causedBy?: string[];        // Causal chain (event IDs)
  agentId?: string;           // Source agent
}
```

**Ordering guarantees**:
- Per-subscription `seq` for gap detection
- Per-agent ordering (events from same agent always ordered)
- Global `eventId` (ULID) for cross-stream correlation
- `causedBy` for causal ordering reconstruction

**Replay positions**: `fromEventId`, `fromSeq`, or `fromTimestamp`

**Rationale**: Layered approach lets clients choose their reconstruction strategy (timestamp, ULID, causal DAG) based on their needs. Gap detection via seq numbers enables reliable reconnection.

**Decided**: 2026-01-27

---

### Q3.1: Event Retention ✅ RESOLVED

**Question**: How long should servers retain events for replay?

**Decision**: **Implementation concern - advertise via capabilities**

Protocol requires:
- Capability advertisement of retention window (`replayWindow` in capabilities)
- Clear error when replay request exceeds retention

No minimum mandated. Implementations decide based on their constraints.

**Rationale**: A dashboard might retain 24 hours. A debugging session might retain 5 minutes. Protocol shouldn't dictate operational concerns.

**Decided**: 2026-01-27

---

### Q3.2: Snapshot Frequency ✅ RESOLVED

**Question**: How often should state snapshots be created for replay?

**Decision**: **Implementation detail, not protocol concern**

Snapshots are an internal optimization. The protocol only needs:
- `map/subscribe` with `fromEventId`, `fromSeq`, or `fromTimestamp`
- Server handles replay however it wants internally

**Rationale**: Protocol shouldn't mandate internal architecture. Some implementations use event sourcing with snapshots, others keep events in memory.

**Decided**: 2026-01-27

---

### Q3.3: Fan-out Limits ✅ RESOLVED

**Question**: Max subscribers per event type?

**Decision**: **Implementation concern + backpressure signaling**

Protocol provides:
- Simple pause/resume backpressure mechanism
- Stream warning/termination events for slow consumers
- Optional capability advertisement of limits

No hard limits mandated by protocol.

**Decided**: 2026-01-27

---

### Q3.4: Batch Response Ordering ✅ RESOLVED

**Question**: Should batch responses preserve order or allow reordering?

**Decision**: **Preserve order by default, allow opt-out**

```typescript
{
  method: "map/batch",
  params: {
    requests: [...],
    ordered: true  // default: true, set false for perf
  }
}
```

**Rationale**: Ordering is the safe, predictable default. Clients that want performance can opt-out.

**Decided**: 2026-01-27

---

## Category 4: Error Handling & Recovery

These affect system resilience.

### Q4.1: Reconnection State Recovery 🔴

**Question**: What state is recovered on reconnection?

**Options**:
- A. None: Fresh start on reconnect
- B. Subscriptions only: Resume subscriptions, replay missed events
- C. Full session: Subscriptions + pending requests + agent registrations
- D. Configurable per-resource

**Decision**: *Pending*

---

### Q4.2: Dead Letter Queue 🟡

**Question**: Should undeliverable messages go to a DLQ?

**Options**:
- A. No DLQ: Messages are dropped
- B. System DLQ: All undeliverable messages go to system queue
- C. Sender DLQ: Messages returned to sender
- D. Configurable per-message

**Decision**: *Pending*

---

### Q4.3: Error Storm Prevention 🟡

**Question**: How to prevent error storms from overwhelming monitoring?

**Options**:
- A. Error sampling (log 1 in N)
- B. Error aggregation (batch similar errors)
- C. Circuit breaker (stop error events after threshold)
- D. Severity filtering (only propagate severe errors)

**Decision**: *Pending*

---

### Q4.4: Automatic Recovery Scope 🟡

**Question**: How much should the protocol auto-heal vs require intervention?

**Options**:
- A. Minimal: Only retry connection, everything else manual
- B. Moderate: Auto-retry messages, resubscribe, but not re-register agents
- C. Aggressive: Auto-recover everything possible
- D. Configurable: Policy-driven recovery

**Decision**: *Pending*

---

### Q4.5: Partition Consistency Model 🟢

**Question**: What consistency guarantees during partition recovery?

**Options**:
- A. Last-write-wins (eventual consistency)
- B. Conflict detection (notify on conflict)
- C. Conflict resolution rules (configurable)
- D. Strong consistency (block until consensus)

**Context**: Primarily relevant for federation scenarios.

**Decision**: *Pending*

---

## Category 5: Permissions & Security

These affect the visibility and permission system.

### Q5.1: Permission Inheritance 🟡

**Question**: Should agent permissions inherit from parent by default?

**Options**:
- A. No inheritance: Each agent explicit
- B. Full inheritance: Child gets parent's permissions
- C. Restrictive inheritance: Child can only be more restricted
- D. Configurable: `inheritPermissions: true/false`

**Decision**: *Pending*

---

### Q5.2: Temporary Permission Grants 🟢

**Question**: Should there be time-limited permission grants?

**Options**:
- A. No: All permissions are permanent until revoked
- B. Yes: TTL on permission grants
- C. Scoped: TTL only for specific permission types

**Use case**: Temporary elevated access for debugging.

**Decision**: *Pending*

---

### Q5.3: Permission Delegation 🟢

**Question**: Can agents delegate their permissions to others?

**Options**:
- A. No delegation: Only system/operator grants
- B. Full delegation: Agent can grant any of its permissions
- C. Marked delegable: Only permissions marked as delegable
- D. Hierarchy only: Can only delegate to children

**Decision**: *Pending*

---

### Q5.4: Client Permission Groups 🟢

**Question**: Should there be permission groups/roles for clients?

**Options**:
- A. No groups: Each client has explicit permissions
- B. Named roles: `operator`, `observer`, `agent`, etc.
- C. Custom groups: Configurable permission sets

**Decision**: *Pending*

---

### Q5.5: Permission Revocation Timing 🟢

**Question**: Immediate revocation or graceful wind-down?

**Options**:
- A. Immediate: Permission denied instantly
- B. Graceful: In-flight operations complete, new ones denied
- C. Timed: Grace period before enforcement
- D. Hybrid: Immediate for security, graceful for operational

**Decision**: *Pending*

---

## Category 6: Federation

These affect multi-system communication.

### Q6.1: Transitive Federation 🟡

**Question**: If A↔B and B↔C, can A route to C via B?

**Options**:
- A. No: Only direct peers can communicate
- B. Yes, explicit: A must configure C as reachable via B
- C. Yes, automatic: Routing discovered automatically
- D. Yes, with limits: Hop count, TTL restrictions

**Decision**: *Pending*

---

### Q6.2: Federation Discovery 🟢

**Question**: Should there be a discovery mechanism for finding peers?

**Options**:
- A. No discovery: Manual peer configuration only
- B. Registry-based: Central federation registry
- C. Gossip-based: Peers share peer lists
- D. DNS-based: SRV records for peer discovery

**Decision**: *Pending*

---

### Q6.3: Cross-System Event Streaming 🟡

**Question**: How do events propagate across federated systems?

**Options**:
- A. No streaming: Request-response only across systems
- B. Filtered streaming: Peers subscribe with filters
- C. Replicated streaming: Full event replication
- D. Aggregated streaming: Summary events only

**Decision**: *Pending*

---

### Q6.4: Federation Schema Versioning 🟡

**Question**: What if peers have different protocol versions?

**Options**:
- A. Must match: Reject incompatible peers
- B. Negotiate: Use lowest common version
- C. Translate: Gateway handles version differences
- D. Envelope: Include version in each message

**Decision**: *Pending*

---

### Q6.5: Federation Audit Requirements 🟢

**Question**: What federation activity must be logged?

**Options**:
- A. Minimal: Connection events only
- B. Messages: All cross-system messages
- C. Full: Messages + events + errors
- D. Configurable: Per-peer audit level

**Decision**: *Pending*

---

## Category 7: Agent Lifecycle

These affect how agents are created, managed, and terminated.

### Q7.1: Agent State Model ✅ RESOLVED

**Question**: What states can agents be in?

**Decision**: **Extensible state model with standard states**

Standard states:
- `registered` - Known to system, not yet active
- `active` - Running and responsive
- `busy` - Active but processing (can't accept new work)
- `idle` - Active but waiting for work
- `suspended` - Paused, can be resumed
- `stopping` - Shutting down gracefully
- `stopped` - Terminated, may have result
- `failed` - Terminated abnormally

Implementations can add custom states (extensible via string type).

**Rationale**: Standard states cover common patterns. Extensibility allows implementations to add domain-specific states without protocol changes.

**Decided**: 2026-01-24

---

### Q7.2: Lifecycle Metadata ✅ RESOLVED

**Question**: Should lifecycle be prescriptive (enforced) or descriptive (metadata)?

**Decision**: **Descriptive - protocol records lifecycle metadata; implementation decides enforcement**

Lifecycle patterns are documented conventions, not protocol-enforced rules:
- `persistent` - Long-lived, explicit termination
- `task` - Lives for a task, returns result (Claude Code pattern)
- `session` - Lives for spawner's session
- `ephemeral` - Very short-lived

Implementations decide:
- When to terminate task-bound agents
- How to handle orphaned children
- Resource cleanup timing

**Rationale**: Keeps the protocol flexible. Different implementations have different constraints (subprocess vs container vs external service). Protocol provides the vocabulary; implementation provides the semantics.

**Decided**: 2026-01-24

---

### Q7.3: Agent Registration Patterns ✅ RESOLVED

**Question**: How are agents registered? Explicit only or implicit?

**Decision**: **Multiple patterns supported**

1. **Explicit registration**: `map/agents/register` - agent registered, then receives messages
2. **Spawn with task**: `map/agents/spawn` - atomic register + initial task (Claude Code pattern)
3. **Implicit registration**: `map/send` with `createAgent` param - message creates agent if missing

**Rationale**: Different use cases need different patterns. Claude Code needs atomic spawn+task. Persistent workers need explicit registration. Some systems want on-demand agent creation.

**Decided**: 2026-01-24

---

### Q7.4: Orphan Handling 🟢

**Question**: When a parent agent dies, what happens to children?

**Decision**: **Implementation decides; protocol provides options via `lifecycle.onEnd.children`**

Options expressed in lifecycle metadata:
- `cascade` - Stop all children
- `orphan` - Keep running, mark as orphaned
- `reparent` - Move to grandparent

Implementation decides the actual behavior and timing.

**Rationale**: Different systems have different needs. Task agents should cascade. Persistent workers might reparent. Protocol records intent; implementation enforces.

**Decided**: 2026-01-24

---

### Q7.5: Result Handling ✅ RESOLVED

**Question**: Should there be first-class support for agent results, or handle via messaging?

**Decision**: **Hybrid - Messages with optional structured result extension**

Results are delivered via the unified message model, with optional extensions for structured outputs:

```typescript
// Result message - uses standard message structure
const resultMessage: MAPMessage = {
  from: "task-agent",
  to: { parent: true },
  payload: {
    // Simple result (always present for task completion)
    result: "Found 15 TypeScript files in src/",

    // Optional: structured parts for typed content
    parts: [
      { type: "text", content: "Found 15 TypeScript files in src/" },
      { type: "data", content: { files: ["src/index.ts", ...] }, schema: "file-list" }
    ]
  },
  meta: {
    relationship: "child-to-parent",
    correlationId: "task_001",       // Links to original task
    isResult: true                    // Indicates this is THE result
  }
};
```

**Key Points**:

1. **Messages remain primary** - Results flow via messages, not a separate channel
2. **Payload structure is flexible** - Simple `result` field for basic cases
3. **Optional `parts` array** - For structured/typed outputs (text, data, file-reference)
4. **Metadata flags** - `isResult: true` and `correlationId` identify result messages
5. **Events reflect results** - `agent.task.completed` events include the result for observability

**Parts Structure (optional, for complex outputs)**:

```typescript
type MAPPart =
  | { type: "text"; content: string; mimeType?: string }
  | { type: "data"; content: unknown; schema?: string }
  | { type: "file"; uri: string; name?: string; mimeType?: string }
  | { type: string; content: unknown; [key: string]: unknown };  // Extensible
```

**Why This Approach**:

- **Keeps protocol streamlined** - One message type handles all communication
- **Simple cases stay simple** - Just put result in payload
- **Complex cases are supported** - Parts allow typed, structured outputs
- **Consistent with A2A concepts** - Parts model borrowed, but integrated into messages
- **No conversation/artifact split** - For MAP's use cases (task agents, workers), this distinction adds complexity without benefit

**Comparison to A2A**:

| A2A | MAP |
|-----|-----|
| Messages (conversation) + Artifacts (deliverables) | Messages with optional parts (unified) |
| Separate history and artifacts on Task | Result flows via message, captured in events |
| Parts on both Messages and Artifacts | Parts only in message payload |

**Rationale**: MAP's primary use cases (Claude Code task agents, macro-agent workers) don't have rich conversations separate from results. The A2A distinction between messages and artifacts adds complexity that doesn't pay off for these patterns. Keeping results as messages with optional structure is simpler and more flexible.

**Decided**: 2026-01-24

---

## Resolved Decisions

*Summary of all resolved decisions for quick reference.*

### ✅ Primary Abstraction

**Decision**: Agent + relationships, then messages

**Rationale**: Matches mental model of multi-agent systems.

**Decided**: 2026-01-24

---

### ✅ Topology Model

**Decision**: Topology is configuration, not protocol

**Rationale**: Same protocol supports orchestration (tree, like Claude Code) and collaboration (mesh, like macro-agent). Relationships determine topology.

**Decided**: 2026-01-24

---

### ✅ Unified Messaging

**Decision**: One message type with metadata specialization

**Rationale**: `meta.relationship` and `meta.expectsResponse` determine message semantics. Task delegation, peer messaging, and broadcast are all the same message type with different metadata.

**Decided**: 2026-01-24

---

### ✅ Unified Participant Model

**Decision**: Agents and clients speak the same protocol

**Rationale**: Consistent semantics across all participants. Transport can be optimized per deployment context. Federation is natural (remote agents are just participants). Hierarchical composition supported (agents can be servers to children).

**Decided**: 2026-01-27

---

### ✅ Pluggable Transport

**Decision**: Transport-agnostic with pluggable bindings (WebSocket, stdio, in-process, HTTP+SSE)

**Rationale**: Different deployment contexts need different transports. Subprocess agents use stdio. Co-located agents avoid serialization. Remote clients use WebSocket. Same protocol semantics regardless of transport.

**Decided**: 2026-01-27

---

### ✅ Visibility Model

**Decision**: First-class visibility on agents and scopes

**Rationale**: Enables Claude Code pattern (sub-agents invisible to user) and macro-agent pattern (full visibility). Levels: `parent`, `hierarchy`, `scoped`, `public`. Configurable per-scope.

**Decided**: 2026-01-24

---

### ✅ Agent Lifecycle

**Decision**: Descriptive lifecycle metadata, not prescriptive enforcement

**Rationale**: Protocol records intent (`pattern: "task"`). Implementation decides enforcement. Keeps protocol flexible for different runtime environments.

**Decided**: 2026-01-24

---

### ✅ Result Handling

**Decision**: Messages with optional structured parts

**Rationale**: Results flow via the unified message model. Simple cases use `payload.result`. Complex outputs use optional `parts` array with typed content (text, data, file). Keeps protocol streamlined while supporting rich outputs when needed. Avoids A2A's message/artifact split which adds complexity without benefit for MAP's use cases.

**Decided**: 2026-01-24

---

### ✅ Session Model

**Decision**: Session-bound state (like ACP) + optional named subscriptions

**Rationale**: Sessions are first-class entities with IDs. Subscriptions belong to sessions and survive connection drops. Named subscriptions allow explicit resume across sessions. Follows ACP's proven model.

**Decided**: 2026-01-24

---

### ✅ Capability Negotiation

**Decision**: Minimal capability set, graceful degradation, fixed for session lifetime

**Rationale**: Keep v1 simple. Required capabilities must match or connection fails. Optional capabilities degrade gracefully. No mid-session capability changes (simplifies implementation).

**Decided**: 2026-01-24

---

### ✅ Resource Limits

**Decision**: Implementation concern, not protocol requirement

**Rationale**: Protocol doesn't mandate limits. Implementations may enforce and advertise via capabilities. Visibility already controls access; rate limiting handles load.

**Decided**: 2026-01-24

---

### ✅ Auth Refresh

**Decision**: In-band refresh + reconnection fallback (complementary)

**Rationale**: In-band `map/auth/refresh` for smooth UX. Reconnection with sessionId as fallback. Both mechanisms work together for resilience.

**Decided**: 2026-01-24

---

### ✅ Visibility Queries

**Decision**: Server-filtered; empty filter = "all I can see"

**Rationale**: Most ergonomic for clients. Server already enforces visibility rules. Dashboards don't need to know IDs upfront.

**Decided**: 2026-01-24

---

### ✅ Stream Ordering

**Decision**: Multi-layered ordering with per-subscription sequences + global event IDs + causal metadata

**Rationale**: Per-subscription `seq` for gap detection, global `eventId` (ULID) for cross-stream correlation, `causedBy` for causal ordering. Clients choose reconstruction strategy based on needs.

**Decided**: 2026-01-27

---

### ✅ Streaming Implementation Details

**Decision**: Retention, snapshots, fan-out limits are implementation concerns, not protocol requirements

**Rationale**: Protocol specifies semantics (ordering, replay positions, backpressure signaling). Operational details left to implementations. Advertise constraints via capabilities.

**Decided**: 2026-01-27

---

## Decision Process

For each open question:

1. **Understand the question**: Why does this matter? What does it affect?
2. **Enumerate options**: What are the realistic choices?
3. **Evaluate trade-offs**: Pros/cons of each option
4. **Consider precedent**: How do ACP, A2A, MCP handle this?
5. **Make a decision**: Pick an option with clear rationale
6. **Document**: Update this spec and propagate to child specs
7. **Mark resolved**: Move to Resolved section

---

## References

Child specs where these questions originated:
- Main MAP Design Specification (00-design-specification.md)
- Wire Protocol & ACP Compatibility Layer (02-wire-protocol.md)
- Streaming Semantics (03-streaming-semantics.md)
- Error Handling & Failure Modes (04-error-handling.md)
- Connection Model & Client Patterns (05-connection-model.md)
- Visibility & Permission Model (06-visibility-permissions.md)
- Federation & System-to-System Communication (07-federation.md)
