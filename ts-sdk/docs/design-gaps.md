# MAP SDK Design Gaps Tracking

This document tracks gaps between the MAP SDK implementation and the design specifications. Generated from a comprehensive review on 2026-01-28.

## Summary

| Category | Aligned | Gaps | Priority Items |
|----------|---------|------|----------------|
| Core Design | 90% | 2 | Task methods (optional) |
| Wire Protocol | 75% | 7 | Method naming, delivery semantics |
| Streaming | 60% | 9 | Replay, pause/resume, causal metadata |
| Error Handling | 80% | 6 | Error code alignment |
| Connection Model | 75% | 5 | Auto-reconnect, state machine |
| Visibility/Permissions | 40% | 8 | Permission enforcement |
| Federation | 35% | 12 | Exposure policies, envelope |

---

## Gap Categories

### Legend
- **Priority**: P0 (Critical), P1 (High), P2 (Medium), P3 (Low)
- **Status**: `open`, `in-progress`, `resolved`, `wont-fix`, `deferred`
- **Type**: `missing`, `divergent`, `incomplete`

---

## 1. Streaming Semantics Gaps

Spec: `docs/03-streaming-semantics.md`

| ID | Gap | Type | Priority | Status | Notes |
|----|-----|------|----------|--------|-------|
| STREAM-001 | No `map/replay` method | missing | P0 | open | Clients cannot catch up after disconnects. Spec lines 140-171 define full replay API. |
| STREAM-002 | Missing `eventId` in event envelope | missing | P0 | open | Cannot deduplicate events. Spec line 76. |
| STREAM-003 | Missing `causedBy` in event envelope | missing | P0 | open | Cannot enforce causal ordering. Spec line 77. |
| STREAM-004 | No pause/resume subscription states | missing | P1 | open | Spec lines 44-60 define paused state. Only active/closed implemented. |
| STREAM-005 | No overflow notifications | missing | P1 | open | Events silently dropped. Spec lines 229-242 define `subscription.overflow` event. |
| STREAM-006 | No `map/subscribe.ack` backpressure | missing | P1 | open | Server cannot implement flow control. Spec lines 217-227. |
| STREAM-007 | No ordering mode configuration | missing | P2 | open | Spec defines `ordering: "none" | "per-agent" | "causal" | "total"`. Lines 199-208. |
| STREAM-008 | Missing hierarchy filters | missing | P2 | open | No `descendants`, `ancestors`, `subtree` in SubscriptionFilter. Spec lines 131-134. |
| STREAM-009 | Missing timestamp at envelope level | divergent | P3 | open | Spec line 72 has timestamp in envelope, not just in event. |

### Implementation Notes - Streaming

**STREAM-001 (Replay)**:
- Add `ClientConnection.replay()` method
- Define `ReplayRequestParams` with `from`, `to`, `afterEventId`, `filter`, `options`
- Define `ReplayResponseResult` with event stream

**STREAM-002/003 (Event Envelope)**:
- Update `EventNotificationParams` in `types/index.ts:1300-1305`
- Add `eventId: string` (ULID format)
- Add `causedBy?: string[]` (array of eventIds)
- Update `Subscription._pushEvent()` to track/validate

**STREAM-004 (Pause/Resume)**:
- Add `pause()` and `resume()` methods to `Subscription` class
- Add `paused` state to subscription lifecycle
- Buffer events during pause or define pause semantics

---

## 2. Visibility & Permissions Gaps

Spec: `docs/06-visibility-permissions.md`

| ID | Gap | Type | Priority | Status | Notes |
|----|-----|------|----------|--------|-------|
| PERM-001 | No permission resolution algorithm | missing | P0 | open | No `canPerformAction()` function. Spec lines 160-184 define 4-layer resolution. |
| PERM-002 | No system-level exposure config | missing | P0 | open | `MAPSystemConfig` with exposure rules not implemented. Spec lines 50-75. |
| PERM-003 | No visibility enforcement on queries | missing | P0 | open | Results not filtered by caller's visibility permissions. |
| PERM-004 | No agent-level permissions structure | missing | P1 | open | Missing `canSee`, `canMessage`, `acceptsFrom` fields. Spec lines 129-154. |
| PERM-005 | No dynamic permission updates | missing | P1 | open | No `map/permissions/update` method. Spec lines 189-205. |
| PERM-006 | No permission event types | missing | P2 | open | Missing `permissions.client.updated`, `permissions.denied`. Spec lines 211-217. |
| PERM-007 | Scope permissions structure differs | divergent | P2 | open | Missing `inheritFrom`, `owner-invite` option. Spec lines 115-123. |
| PERM-008 | No permission inheritance for agents | missing | P3 | open | Open question from spec line 239. |

### Implementation Notes - Permissions

**PERM-001 (Resolution Algorithm)**:
- Create `src/permissions/index.ts` module
- Implement `canPerformAction(participant, action, target)` function
- Check 4 layers: system → client → scope → agent

**PERM-002 (System Config)**:
- Define `MAPSystemConfig` interface with `exposure` rules
- Add to `MAPRouterConfig` in `router/interface.ts`

**PERM-003 (Visibility Enforcement)**:
- Router must filter `agents/list`, `scopes/list` results
- Add visibility check before returning data

---

## 3. Federation Gaps

Spec: `docs/07-federation.md`

| ID | Gap | Type | Priority | Status | Notes |
|----|-----|------|----------|--------|-------|
| FED-001 | No federation envelope | missing | P1 | open | Missing `sourceSystem`, `targetSystem`, `hopCount`, `signature`. Spec lines 224-233. |
| FED-002 | No exposure policies | missing | P1 | open | Cannot control which agents/scopes exposed to peers. Spec lines 89-102. |
| FED-003 | No message queuing during outages | missing | P1 | open | Messages lost on disconnect. Spec lines 242-248. |
| FED-004 | No auto-reconnect for federation | missing | P1 | open | Manual reconnection only. Spec lines 74-78. |
| FED-005 | No health checks | missing | P2 | open | No liveness detection for federated peers. Spec line 77. |
| FED-006 | No hop count tracking | missing | P2 | open | Risk of infinite loops in transitive federation. |
| FED-007 | No per-peer rate limiting | missing | P2 | open | No abuse prevention. Spec `maxMessagesPerMinute`. |
| FED-008 | Method name divergence | divergent | P3 | open | SDK uses `map/federation/route`, spec uses `map/federation/send`. |
| FED-009 | No federation config management | missing | P2 | open | No `MAPFederationConfig` interface. Spec lines 58-87. |
| FED-010 | No transitive federation support | missing | P3 | open | Cannot route via intermediaries. Open question #1. |
| FED-011 | No federation discovery | missing | P3 | deferred | No peer discovery mechanism. |
| FED-012 | No federation audit logging | missing | P3 | deferred | Open question #5. |

### Implementation Notes - Federation

**FED-001 (Envelope)**:
- Define `FederationEnvelope` interface
- Wrap messages in `GatewayConnection.routeToSystem()`
- Track/validate hop count

**FED-002 (Exposure Policies)**:
- Add `exposure` field to `MAPRouterConfig`
- Filter agents/scopes before federation response

---

## 4. Connection Model Gaps

Spec: `docs/05-connection-model.md`

| ID | Gap | Type | Priority | Status | Notes |
|----|-----|------|----------|--------|-------|
| CONN-001 | No automatic reconnection | missing | P0 | open | No exponential backoff retry. Spec lines 185-200 show RECONNECT state. |
| CONN-002 | Binary connection state only | incomplete | P1 | open | Only `isConnected` boolean. Need full state machine (INITIAL→CONNECTING→ACTIVE→RECONNECT→CLOSED). |
| CONN-003 | No connection state events | missing | P1 | open | Cannot observe CONNECTING, auth failures, reconnect transitions. |
| CONN-004 | No request handler for agents | missing | P2 | open | Agents can't receive requests, only notifications. |
| CONN-005 | No token refresh during connection | missing | P2 | open | Auth only at connect time. Spec open question #4. |

### Implementation Notes - Connection

**CONN-001 (Auto-Reconnect)**:
- Add `ReconnectionPolicy` option to connection classes
- Implement exponential backoff with jitter
- Add `maxRetries`, `baseDelayMs`, `maxDelayMs` options

**CONN-002 (State Machine)**:
- Define `ConnectionState` enum
- Add `state` property to `BaseConnection`
- Emit state change events

---

## 5. Wire Protocol Gaps

Spec: `docs/02-wire-protocol.md`

| ID | Gap | Type | Priority | Status | Notes |
|----|-----|------|----------|--------|-------|
| WIRE-001 | Method name: `map/connect` vs `map/initialize` | divergent | P2 | open | Spec uses `map/initialize` for protocol negotiation. Intentional? |
| WIRE-002 | Different delivery semantics model | divergent | P2 | open | SDK: reliability (fire-and-forget/guaranteed). Spec: operational (inject/queue). |
| WIRE-003 | No ACP compatibility mode | missing | P2 | deferred | No `_map/` prefixed methods, no mode detection. Spec lines 213-237. |
| WIRE-004 | No HTTP/SSE transport | missing | P2 | deferred | Only WebSocket and NDJSON. Spec lines 261-268. |
| WIRE-005 | No batch message support | missing | P3 | deferred | No `MAPBatch` type. Spec lines 45-46. |
| WIRE-006 | No compression support | missing | P3 | deferred | Spec open question. |
| WIRE-007 | Disconnect method params differ | divergent | P3 | open | SDK missing `timeout`, `cascade` params. Spec lines 146-160. |

### Implementation Notes - Wire Protocol

**WIRE-001/002 (Intentional Divergences?)**:
- Document rationale if intentional
- Or align with spec method names

**WIRE-003 (ACP Compatibility)**:
- Lower priority - for legacy client migration
- Would need `_map/` method aliases

---

## 6. Error Handling Gaps

Spec: `docs/04-error-handling.md`

| ID | Gap | Type | Priority | Status | Notes |
|----|-----|------|----------|--------|-------|
| ERR-001 | Routing error codes reassigned | divergent | P2 | open | AGENT_STOPPED (2001), AGENT_BUSY (2002), DELIVERY_TIMEOUT (2007) missing. Codes shifted. |
| ERR-002 | Agent error codes reassigned | divergent | P2 | open | INVALID_PARENT (3001), HIERARCHY_CYCLE (3002), MAX_AGENTS_EXCEEDED (3003) missing. |
| ERR-003 | Resource error codes shifted | divergent | P2 | open | RATE_LIMITED should be 4000 (is 4001). BUFFER_OVERFLOW (4002) missing. |
| ERR-004 | Federation PEER_TIMEOUT missing | divergent | P3 | open | 5001 used for FEDERATION_SYSTEM_NOT_FOUND instead. |
| ERR-005 | Error data structure simplified | divergent | P3 | open | Generic `details` object instead of typed fields. |
| ERR-006 | AUTH_EXPIRED vs TOKEN_EXPIRED naming | divergent | P3 | open | Semantically equivalent but different names. |

### Implementation Notes - Errors

**ERR-001/002/003 (Code Alignment)**:
- Option A: Restore spec codes, relocate SDK additions
- Option B: Document as intentional divergence
- Decision needed on backward compatibility

---

## 7. Core Design Gaps

Spec: `docs/00-design-specification.md`

| ID | Gap | Type | Priority | Status | Notes |
|----|-----|------|----------|--------|-------|
| CORE-001 | No task methods | missing | P3 | deferred | Tier 3 optional: `map/tasks/create`, `map/tasks/assign`, etc. Spec lines 412-416. |
| CORE-002 | No ACP session adapter | missing | P3 | deferred | Conversion utility for ACP-compatible sessions. Spec line 82. |

---

## 8. Open Questions Still Pending

From `docs/01-open-questions.md`:

| ID | Question | Category | Status | Notes |
|----|----------|----------|--------|-------|
| OQ-001 | Heartbeat mechanism | Protocol | open | No health check methods. |
| OQ-002 | Reconnection state recovery | Error | open | Foundation exists, policies pending. |
| OQ-003 | Dead letter queue | Error | open | No DLQ mechanism. |
| OQ-004 | Error storm prevention | Error | open | No sampling/circuit breaker. |
| OQ-005 | Automatic recovery scope | Error | open | Manual reconnection only. |
| OQ-006 | Permission inheritance | Security | open | No inheritance logic. |
| OQ-007 | Temporary permission grants | Security | deferred | No TTL on capabilities. |
| OQ-008 | Permission delegation | Security | deferred | No delegation mechanism. |
| OQ-009 | Client permission groups | Security | deferred | No role/group abstraction. |
| OQ-010 | Transitive federation | Federation | open | No routing via intermediaries. |
| OQ-011 | Cross-system event streaming | Federation | open | No federation-aware subscriptions. |
| OQ-012 | Federation schema versioning | Federation | open | No version negotiation. |

---

## Priority Roadmap

### Phase 1: Critical (P0) - Data Integrity & Core Functionality
1. STREAM-001: Replay capability
2. STREAM-002: Event ID in envelope
3. STREAM-003: Causal metadata (`causedBy`)
4. PERM-001: Permission resolution algorithm
5. PERM-002: System exposure config
6. PERM-003: Visibility enforcement
7. CONN-001: Auto-reconnection

### Phase 2: High (P1) - Production Readiness
1. STREAM-004: Pause/resume subscriptions
2. STREAM-005: Overflow notifications
3. STREAM-006: Backpressure acknowledgment
4. PERM-004: Agent-level permissions
5. PERM-005: Dynamic permission updates
6. FED-001: Federation envelope
7. FED-002: Exposure policies
8. FED-003: Message queuing
9. FED-004: Federation auto-reconnect
10. CONN-002: Full state machine
11. CONN-003: State change events

### Phase 3: Medium (P2) - Feature Completeness
1. STREAM-007: Ordering modes
2. STREAM-008: Hierarchy filters
3. PERM-006: Permission events
4. PERM-007: Scope permission alignment
5. FED-005: Health checks
6. FED-006: Hop count tracking
7. FED-007: Rate limiting
8. FED-009: Federation config
9. CONN-004: Agent request handlers
10. CONN-005: Token refresh
11. WIRE-001/002: Document or align divergences
12. ERR-001/002/003: Error code alignment

### Phase 4: Low (P3) - Nice to Have
- WIRE-003/004/005: ACP compat, HTTP/SSE, batch
- FED-010/011/012: Transitive, discovery, audit
- CORE-001/002: Task methods, ACP adapter
- Remaining open questions

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-01-28 | Initial gap analysis from design review | Claude |

