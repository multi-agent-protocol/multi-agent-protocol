# Multi-Agent Protocol (MAP) Codebase Review

## Executive Summary

This document provides a comprehensive analysis of the MAP codebase, identifying issues across four main categories:

1. **User Story Coherence Issues** - API design inconsistencies and user experience gaps
2. **Bugs** - Code defects including concurrency issues, missing validation, and error handling gaps
3. **Testing Gaps** - Untested modules and missing test scenarios
4. **Streamlining Opportunities** - Areas where the codebase needs cleanup and consolidation

---

## 1. User Story Coherence Issues

### 1.1 Connection Flow Inconsistencies

**Issue**: The client connection workflow has multiple paths that aren't clearly documented or consistently implemented.

| Flow | Expected | Actual |
|------|----------|--------|
| Initial connect | `connect()` → `connected` | Works |
| Reconnect with token | `connect(resumeToken)` → restore | `resumeToken` in response but token usage undocumented |
| Auth required flow | `connect()` → `authRequired` → `authenticate()` | Handler exists but not in ClientConnection |

**Files Affected**:
- `ts-sdk/src/connection/client.ts`
- `ts-sdk/src/server/sessions/manager.ts`

**Recommendation**: Add `authenticate()` method to ClientConnection and document the auth flow.

---

### 1.2 Inconsistent Response Shapes

**Issue**: Some methods return the entity directly while others wrap it. This creates an inconsistent developer experience.

```typescript
// Pattern 1: Entity in response
AgentsRegisterResponse: { agent: Agent }
ScopesCreateResponse: { scope: Scope }

// Pattern 2: Direct metadata only
SendResponse: { messageId: MessageId }
SubscribeResponse: { subscriptionId: SubscriptionId }
```

**Impact**: Developers must learn different patterns for different methods.

---

### 1.3 Missing Client Methods for Protocol Methods

**Issue**: Several protocol methods defined in `meta.json` have no corresponding ClientConnection methods:

| Protocol Method | ClientConnection Method | Status |
|-----------------|-------------------------|--------|
| `map/session/list` | - | Missing |
| `map/session/load` | - | Missing |
| `map/session/close` | - | Missing |
| `map/structure/graph` | - | Missing |
| `map/inject` | - | Missing |
| `map/scopes/get` | - | Missing |
| `map/scopes/members` | `getMembersOf()` | Present |
| `map/authenticate` | - | Missing |

**Files Affected**: `ts-sdk/src/connection/client.ts`

---

### 1.4 Deprecated API Surface in Exports

**Issue**: The public API exports deprecated types without clear migration paths:

```typescript
// In types/index.ts
/** @deprecated Use AuthCredentials instead */
export interface AuthParams { ... }

// In SubscriptionFilter
/** @deprecated Use `fromAgents` for clearer semantics */
agents?: AgentId[];
```

**Recommendation**: Create a migration guide and consider removing deprecated exports in next major version.

---

### 1.5 Server SDK vs Client SDK Asymmetry

**Issue**: The server SDK exports many building blocks but the relationship between them isn't clear to users.

```
Server SDK exports:
- MAPServer (convenience wrapper)
- AgentRegistry, ScopeManager, SessionManager, etc. (building blocks)
- Handlers (pre-built request handlers)
- Types (interfaces for everything)

User question: "How do I build a simple MAP server?"
```

The README shows `TestServer` usage but not `MAPServer` or how to compose building blocks.

**Files Affected**:
- `ts-sdk/src/server/index.ts`
- `ts-sdk/README.md`

---

## 2. Bugs

### 2.1 High Severity

#### 2.1.1 Session Agent Tracking Inconsistency

**File**: `ts-sdk/src/server/agents/handlers.ts:111`

**Bug**: Handler directly mutates `ctx.session.agentIds` before returning. If the handler fails after this mutation, the session tracks an agent that was never successfully registered.

```typescript
// Line 111 - Direct mutation
ctx.session.agentIds.push(registeredAgent.id);
```

**Impact**: Orphaned agent references in session, memory leaks, incorrect cleanup.

**Fix**: Use SessionManager.addAgent() and only call it after successful registration.

---

#### 2.1.2 Race Condition in Subscription State Updates

**File**: `ts-sdk/src/server/subscriptions/manager.ts:445-461`

**Bug**: The `deliverEvent` method reads, modifies, and saves subscription state without synchronization. Concurrent calls (from event delivery and replay) can overwrite each other's updates.

```typescript
private deliverEvent(state: SubscriptionState, event: MAPEvent): void {
  const subscription = this.store.get(state.subscription.id);  // READ
  if (subscription) {
    subscription.lastEventId = event.id;  // MODIFY
    this.store.save(subscription);  // SAVE - race window
  }
}
```

**Impact**: Lost event tracking, replay progress corruption.

---

#### 2.1.3 Silent Message Drop on Queue Overflow

**File**: `ts-sdk/src/server/messages/router.ts:231-248`

**Bug**: Messages are silently dropped when queues are full with no notification to sender or event emission.

```typescript
if (this.queueStore.getTotalSize() >= this.queueOptions.maxTotal) {
  this.queueStore.expireOld();
  if (this.queueStore.getTotalSize() >= this.queueOptions.maxTotal) {
    return;  // SILENT DROP - no event, no error
  }
}
```

**Impact**: Messages lost without notification, breaks request/response patterns.

**Fix**: Emit `message.dropped` event and optionally return error to caller.

---

### 2.2 Medium Severity

#### 2.2.1 Resume Token Not Invalidated After Use

**File**: `ts-sdk/src/server/sessions/manager.ts:210-265`

**Bug**: Resume tokens can be reused multiple times. Once a session is resumed, the old token should be invalidated.

**Impact**: Session hijacking vulnerability - multiple clients can resume the same session.

---

#### 2.2.2 Lost Updates in Session Agent Tracking

**File**: `ts-sdk/src/server/sessions/manager.ts:316-345`

**Bug**: The `addAgent()` and `removeAgent()` methods have race conditions - concurrent calls can overwrite each other's changes.

```typescript
addAgent(sessionId: string, agentId: string): void {
  const session = this.store.get(sessionId);  // FETCH
  // ... concurrent call fetches same session
  this.store.save(updatedSession);  // SAVE - overwrites concurrent change
}
```

---

#### 2.2.3 Missing Agent Validation in Message Router

**File**: `ts-sdk/src/server/messages/router.ts:70-102`

**Bug**: `sendToAgent()` doesn't validate that the target agent exists before queuing the message.

```typescript
sendToAgent(params: {
  from: string;
  to: string;  // No validation that this agent exists
  // ...
}): ServerMessage {
  // Silently queues to nonexistent agent
}
```

---

#### 2.2.4 Ambiguous Address Resolution

**File**: `ts-sdk/src/server/messages/handlers.ts:133-147`

**Bug**: If an agent ID and scope ID have the same string value, the scope wins with no error.

```typescript
// Backward compatibility: unprefixed address
const scope = scopes.get(to);
if (scope) {
  // Send to scope - but what if 'to' was meant to be an agent?
}
```

---

#### 2.2.5 $or/$and Filter Conflict

**File**: `ts-sdk/src/server/subscriptions/manager.ts:486-492`

**Bug**: If both `$or` and `$and` are specified in a subscription filter, `$and` is silently ignored.

```typescript
if (filter.$or && filter.$or.length > 0) {
  return filter.$or.some(...);  // Returns here - $and never checked
}
```

---

### 2.3 Low Severity

#### 2.3.1 Error Translation Missing in Legacy Handler

**File**: `ts-sdk/src/server/agents/handlers.ts:216-218`

**Bug**: The legacy `map/agents/update/state` handler throws internal errors instead of MAP error responses.

---

#### 2.3.2 Missing Error Handling in Scope Lookup

**File**: `ts-sdk/src/server/subscriptions/manager.ts:574-579`

**Bug**: `getDescendants()` call has no try-catch - invalid scope IDs cause unhandled exceptions.

---

## 3. Testing Gaps

### 3.1 Test Suite Health

**Current Status**: 20/46 test files fail to load

```
 Test Files  20 failed | 26 passed (46)
      Tests  890 passed (890)
```

**Root Cause**: The optional peer dependency `agentic-mesh` is not installed, causing import failures in:
- All connection tests (client, agent, gateway, base)
- Integration tests
- Stream tests
- Mesh peer tests

**Fix**: Add `agentic-mesh` to devDependencies or configure dynamic imports.

---

### 3.2 Untested Modules (Critical)

| Module | File | Lines | Risk |
|--------|------|-------|------|
| Retry utilities | `src/utils/retry.ts` | ~150 | HIGH - Core reconnection logic |
| JWT Authenticator | `src/server/auth/authenticators/jwt.ts` | ~370 | HIGH - Security critical |
| MTLS Authenticator | `src/server/auth/authenticators/mtls.ts` | ~100 | HIGH - Security critical |
| No-Auth Authenticator | `src/server/auth/authenticators/no-auth.ts` | ~30 | LOW |

---

### 3.3 Missing Test Scenarios

#### Concurrency Tests
- Rapid connect/disconnect cycles with active subscriptions
- Concurrent auth token refresh and message sending
- Scope membership changes during active subscriptions

#### Error Scenarios
- JWKS fetch failures (network errors, invalid JSON)
- Token expiration mid-request
- Certificate validation failures

#### Edge Cases
- Circular scope hierarchies (A→B→A parent chains)
- Very large payloads (>10MB messages)
- Buffer overflow with different strategies
- 10K+ concurrent subscriptions

#### Stress Tests
- Large message queue accumulation
- High-frequency event delivery
- Memory growth monitoring

---

## 4. Streamlining Opportunities

### 4.1 Handler Context Mutation Pattern

**Issue**: Multiple handlers mutate `ctx.session` directly instead of using SessionManager methods.

**Files**:
- `ts-sdk/src/server/agents/handlers.ts:111` - `ctx.session.agentIds.push()`
- `ts-sdk/src/server/subscriptions/handlers.ts:90` - `ctx.session.subscriptionIds.push()`

**Fix**: All session mutations should go through SessionManager for consistency and auditability.

---

### 4.2 Input Validation

**Issue**: All handlers cast parameters without validation:

```typescript
const { name, role, metadata, capabilities } = params as RegisterParams;
// No validation of types, lengths, or required fields
```

**Recommendation**: Use Zod schemas (already generated in `src/schema/`) for runtime validation.

---

### 4.3 Event Emission Error Handling

**Issue**: Event emissions don't catch subscriber errors:

```typescript
this.eventBus.emit({
  type: "agent.registered",
  data: { agent },
});
// If any subscriber throws, entire operation fails
```

**Fix**: Wrap event emissions to prevent subscriber errors from breaking core logic.

---

### 4.4 API Naming Inconsistencies

| Area | Inconsistency |
|------|---------------|
| Event types | `agent_registered` (underscore) vs `agent.registered` in docs |
| Method names | `map/agents/list` vs `listAgents()` (verb position) |
| Response fields | `agent` vs `agents` vs `agentId` |

---

### 4.5 Documentation Drift

The following documentation doesn't match implementation:

| Doc | Says | Reality |
|-----|------|---------|
| README | `subscription.supportsAck` | Property exists but server behavior unclear |
| Design spec | Tier 1 includes session methods | Session methods are listed as core in meta.json |
| Connection model | Transport states | BaseConnection has 5 states, doc shows 4 |

---

## 5. Recommendations

### Immediate (Bug Fixes)
1. Fix session mutation in handlers - use SessionManager methods
2. Add message drop events to MessageRouter
3. Invalidate resume tokens after use
4. Add agent existence validation before message routing

### Short-term (Testing)
1. Install `agentic-mesh` as devDependency to fix 20 failing test files
2. Add tests for JWT, MTLS, and retry utilities
3. Add concurrency tests for subscription manager

### Medium-term (API Coherence)
1. Add missing ClientConnection methods for all protocol methods
2. Implement input validation using Zod schemas
3. Document auth flow with examples
4. Create migration guide for deprecated APIs

### Long-term (Architecture)
1. Refactor handler context mutation pattern
2. Add atomic operations to stores for concurrency safety
3. Standardize response shapes across all methods
4. Create integration test suite with realistic scenarios

---

## Appendix: Error Codes Alignment

The error codes in `meta.json` and `types/index.ts` are aligned:

| Category | Range | Codes |
|----------|-------|-------|
| Protocol | -327xx | Parse, Invalid request, Method not found, etc. |
| Auth | 1000-1006 | Auth required, failed, expired, etc. |
| Routing | 2000-2004 | Address/Agent/Scope not found, etc. |
| Agent | 3000-3004 | Exists, state invalid, terminated, etc. |
| Resource | 4000-4002 | Exhausted, rate limited, quota exceeded |
| Federation | 5000-5011 | Unavailable, system not found, loop detected, etc. |
