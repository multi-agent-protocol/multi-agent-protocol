# Remaining Improvements Plan

This document details the remaining items from the codebase review with design decisions and recommendations.

---

## Part 1: Testing Gaps (Section 3.3)

### 1.1 Concurrency Tests

**What's Missing:**
- Rapid connect/disconnect cycles with active subscriptions
- Concurrent auth token refresh and message sending
- Scope membership changes during active subscriptions

**Test Scenarios to Add:**

```typescript
// Example: Rapid connect/disconnect
describe("Concurrency: Connection Lifecycle", () => {
  it("handles rapid connect/disconnect cycles without leaks", async () => {
    for (let i = 0; i < 100; i++) {
      const client = new ClientConnection(stream);
      await client.connect();
      await client.subscribe({ eventTypes: ["*"] });
      await client.disconnect();
    }
    // Assert: no memory leaks, no orphaned subscriptions
  });

  it("handles concurrent auth refresh during message send", async () => {
    const sendPromise = client.send("agent-1", { data: "test" });
    const refreshPromise = client.refreshAuth({ method: "api-key", credential: "new-key" });

    const results = await Promise.allSettled([sendPromise, refreshPromise]);
    // Assert: both complete without corruption
  });
});
```

**Files to Create:**
- `ts-sdk/src/__tests__/concurrency.test.ts`

**Estimated Effort:** 3-4 hours

---

### 1.2 Error Scenario Tests

**What's Missing:**
- JWKS fetch failures (network errors, invalid JSON)
- Token expiration mid-request
- Certificate validation failures

**Test Scenarios to Add:**

```typescript
describe("Error Scenarios: JWT Authentication", () => {
  it("handles JWKS network timeout gracefully", async () => {
    const authenticator = new JWTAuthenticator({
      jwksUrl: "https://unreachable.example.com/jwks",
    });

    const result = await authenticator.authenticate(
      { method: "bearer", credential: "token" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("invalid_credentials");
  });

  it("handles token expiration during long-running request", async () => {
    // Token expires 100ms from now
    const shortLivedToken = createToken({ exp: Date.now() + 100 });

    await client.connect({ auth: { method: "bearer", credential: shortLivedToken } });

    // Start long operation
    await delay(150); // Token now expired

    const result = await client.listAgents();
    // Assert: appropriate error or auto-refresh triggered
  });
});
```

**Files to Create:**
- `ts-sdk/src/__tests__/error-scenarios.test.ts`

**Estimated Effort:** 2-3 hours

---

### 1.3 Edge Case Tests

**What's Missing:**
- Circular scope hierarchies (A→B→A parent chains)
- Very large payloads (>10MB messages)
- 10K+ concurrent subscriptions

**Test Scenarios to Add:**

```typescript
describe("Edge Cases: Scope Hierarchies", () => {
  it("detects and rejects circular parent references", async () => {
    const scopeA = await server.createScope({ id: "scope-a" });
    const scopeB = await server.createScope({ id: "scope-b", parentId: "scope-a" });

    // Attempt to create circular reference
    await expect(
      server.updateScope("scope-a", { parentId: "scope-b" })
    ).rejects.toThrow(/circular/i);
  });

  it("handles very large message payloads", async () => {
    const largePayload = { data: "x".repeat(10 * 1024 * 1024) }; // 10MB

    const result = await client.send("agent-1", largePayload);
    // Assert: either succeeds or returns appropriate size limit error
  });
});

describe("Edge Cases: Scale", () => {
  it("handles 10K concurrent subscriptions", async () => {
    const subscriptions = await Promise.all(
      Array.from({ length: 10000 }, (_, i) =>
        client.subscribe({ eventTypes: [`event-type-${i}`] })
      )
    );

    expect(subscriptions).toHaveLength(10000);

    // Cleanup
    await Promise.all(subscriptions.map(s => client.unsubscribe(s.id)));
  });
});
```

**Files to Create:**
- `ts-sdk/src/__tests__/edge-cases.test.ts`

**Estimated Effort:** 3-4 hours

---

### 1.4 Stress Tests

**What's Missing:**
- Large message queue accumulation
- High-frequency event delivery
- Memory growth monitoring

**Recommendation:** These are better suited for a separate performance test suite that runs outside normal CI due to resource requirements.

**Files to Create:**
- `ts-sdk/src/__tests__/stress/queue-stress.test.ts`
- `ts-sdk/src/__tests__/stress/event-delivery-stress.test.ts`

**Estimated Effort:** 4-6 hours (including infrastructure for measuring memory)

---

## Part 2: Streamlining Opportunities (Section 4)

### 4.2 Input Validation

**Current State:**
```typescript
// Handlers cast params without validation
const { name, role, metadata } = params as RegisterParams;
// No validation of types, lengths, or required fields
```

**Problem:**
- Invalid params cause cryptic errors deep in handler logic
- No protection against malformed requests
- Type safety only at compile time, not runtime

**Design Options:**

#### Option A: Handler-Level Validation
Add Zod validation at the start of each handler.

```typescript
"map/agents/register": async (params: unknown, ctx) => {
  const validated = AgentsRegisterRequestParamsSchema.parse(params);
  // ... handler logic
}
```

| Pros | Cons |
|------|------|
| Simple, explicit | Repetitive boilerplate |
| Easy to understand | Easy to forget in new handlers |
| No new infrastructure | Inconsistent error formats |

#### Option B: Validation Middleware (Recommended)
Create middleware that validates params before handlers run.

```typescript
// Middleware definition
const validationMiddleware = createValidationMiddleware({
  "map/agents/register": AgentsRegisterRequestParamsSchema,
  "map/agents/list": AgentsListRequestParamsSchema,
  // ... all methods
});

// Usage in router
const handlers = withValidation(rawHandlers, validationMiddleware);
```

| Pros | Cons |
|------|------|
| Centralized, DRY | Need schema-to-method mapping |
| Consistent error format | Slightly more complex setup |
| Auto-applied to all handlers | May need to maintain mapping |
| Can be optional per-method | |

#### Option C: Code Generation
Generate validated handler wrappers from schema definitions.

| Pros | Cons |
|------|------|
| Type-safe end-to-end | Complex build process |
| Auto-updated with schema | Harder to customize handlers |
| No manual mapping | Learning curve |

**Recommendation: Option B**

Validation middleware provides the best balance of safety and maintainability. The Zod schemas already exist in `src/schema/zod.gen.ts`, we just need to wire them up.

**Implementation Plan:**
1. Create `src/server/middleware/validation.ts`
2. Create method-to-schema mapping
3. Wrap handlers in validation middleware
4. Return standardized `INVALID_PARAMS` errors

**Estimated Effort:** 3-4 hours

---

### 4.3 Event Emission Error Handling

**Current State:**
```typescript
this.eventBus.emit({
  type: "agent.registered",
  data: { agent },
});
// If any subscriber throws, the entire operation fails
```

**Problem:**
- A buggy event subscriber can break core operations
- No isolation between subscribers
- Hard to debug which subscriber caused the failure

**Design Options:**

#### Option A: Try-Catch at Call Sites
Wrap every emit call in try-catch.

```typescript
try {
  this.eventBus.emit({ type: "agent.registered", data: { agent } });
} catch (e) {
  console.error("Event emission error:", e);
}
```

| Pros | Cons |
|------|------|
| Explicit control | Verbose, repetitive |
| Clear error handling | Easy to forget |

#### Option B: Silent Error Swallowing in EventBus
Modify EventBus to catch and log errors internally.

```typescript
class EventBus {
  emit(event: MAPEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (e) {
        console.error("Subscriber error:", e);
      }
    }
  }
}
```

| Pros | Cons |
|------|------|
| Automatic protection | Errors silently swallowed |
| Zero changes to call sites | Hard to debug |
| Subscribers isolated | No control over error handling |

#### Option C: Error Callback in EventBus (Recommended)
Add configurable error handling to EventBus.

```typescript
interface EventBusOptions {
  onSubscriberError?: (error: Error, event: MAPEvent, subscriber: string) => void;
}

class EventBus {
  constructor(private options: EventBusOptions = {}) {}

  emit(event: MAPEvent): void {
    for (const [name, handler] of this.handlers) {
      try {
        handler(event);
      } catch (e) {
        if (this.options.onSubscriberError) {
          this.options.onSubscriberError(e as Error, event, name);
        }
        // Don't rethrow - isolate subscribers
      }
    }
  }
}
```

| Pros | Cons |
|------|------|
| Centralized error handling | Slightly more complex |
| Configurable behavior | |
| Errors visible but isolated | |
| Can log, emit error events, etc. | |

**Recommendation: Option C**

This provides isolation while maintaining visibility. The error callback can:
- Log errors for debugging
- Emit `system.error` events for monitoring
- Track error rates per subscriber
- Allow testing of error handling

**Implementation Plan:**
1. Update `EventBus` interface to accept `onSubscriberError` callback
2. Wrap subscriber calls in try-catch
3. Default callback logs to console.error
4. Add subscriber names for debugging

**Estimated Effort:** 1-2 hours

---

### 4.4 API Naming Inconsistencies

**Current State:**

| Area | Inconsistency |
|------|---------------|
| Event types | `agent_registered` (underscore) vs `agent.registered` (dot) |
| Method names | `map/agents/list` (slash) vs `listAgents()` (camelCase) |
| Response fields | `agent` vs `agents` vs `agentId` |

**Analysis:**

1. **Event Types:** The codebase uses dot notation (`agent.registered`) in most places, but some documentation or older code may use underscores. This is confusing for subscription filters.

2. **Method Names:** Protocol uses slashes (`map/agents/list`), SDK uses camelCase (`listAgents()`). This is actually fine - SDK methods should be idiomatic for the language.

3. **Response Fields:** Singular vs plural is context-dependent (single item vs list). `agentId` vs `agent` depends on whether returning the full entity or just a reference.

**Design Options:**

#### Option A: Standardize on Dot Notation (Breaking)
Change all event types to use dots.

| Pros | Cons |
|------|------|
| Consistent | Breaking change |
| Clear hierarchy | Need migration |

#### Option B: Accept Both, Emit Dot (Recommended)
Normalize incoming filters to accept both, always emit with dots.

```typescript
// In subscription filter matching
function normalizeEventType(type: string): string {
  return type.replace(/_/g, '.');
}

// Always emit with dots
this.eventBus.emit({ type: "agent.registered", ... });
```

| Pros | Cons |
|------|------|
| Backward compatible | Slightly more complex matching |
| Gradual migration | Two valid formats |
| No breaking changes | |

#### Option C: Document Only
Just document the convention, don't change code.

| Pros | Cons |
|------|------|
| No code changes | Inconsistency remains |
| No risk | Confusing for users |

**Recommendation: Option B for events, document for others**

- Event types: Accept both underscore and dot in filters, emit with dots
- Method names: Document that protocol uses slashes, SDK uses camelCase (this is standard)
- Response fields: Document the pattern (singular for create, plural for list)

**Implementation Plan:**
1. Add normalization in subscription filter matching
2. Audit event emissions to ensure dots
3. Document conventions in README

**Estimated Effort:** 2 hours

---

### 4.5 Documentation Drift

**Current State:**

| Doc | Says | Reality |
|-----|------|---------|
| README | `subscription.supportsAck` | Property exists but server behavior unclear |
| Design spec | Tier 1 includes session methods | Session methods listed as core in meta.json |
| Connection model | Transport states | BaseConnection has 5 states, doc shows 4 |

**Design Options:**

#### Option A: Update Docs to Match Code (Recommended)
The code is the source of truth for an unreleased protocol.

#### Option B: Update Code to Match Docs
Risk: May break working functionality.

#### Option C: Audit Each Case
Decide case-by-case which is correct.

**Recommendation: Option A**

For an unreleased protocol, the code is authoritative. Documentation should be updated to match implementation.

**Implementation Plan:**
1. Audit `subscription.supportsAck` behavior
   - Either document it properly or remove it
2. Update tier definitions to match meta.json
3. Document all 5 BaseConnection states
4. Review README examples against current API

**Estimated Effort:** 2-3 hours

---

## Summary: Prioritized Work Items

### High Priority (Should Do)
| Item | Effort | Impact |
|------|--------|--------|
| 4.2 Input Validation Middleware | 3-4h | High - prevents crashes from bad input |
| 4.3 Event Emission Error Handling | 1-2h | High - prevents subscriber bugs breaking core |
| 4.5 Documentation Drift | 2-3h | Medium - improves developer experience |

### Medium Priority (Nice to Have)
| Item | Effort | Impact |
|------|--------|--------|
| 4.4 API Naming Consistency | 2h | Low - cosmetic improvement |
| 1.1 Concurrency Tests | 3-4h | Medium - catches race conditions |
| 1.2 Error Scenario Tests | 2-3h | Medium - validates error handling |

### Lower Priority (Future Work)
| Item | Effort | Impact |
|------|--------|--------|
| 1.3 Edge Case Tests | 3-4h | Low - validates extreme scenarios |
| 1.4 Stress Tests | 4-6h | Low - performance baseline |

---

## Recommended Implementation Order

1. **Event Emission Error Handling** (1-2h) - Quick win, high impact
2. **Input Validation Middleware** (3-4h) - Important for API stability
3. **Documentation Drift** (2-3h) - Improves onboarding
4. **API Naming Consistency** (2h) - Polish
5. **Concurrency Tests** (3-4h) - Confidence building
6. **Error Scenario Tests** (2-3h) - Robustness
7. **Edge Case Tests** (3-4h) - Completeness
8. **Stress Tests** (4-6h) - Performance baseline

**Total Estimated Effort:** ~20-28 hours
