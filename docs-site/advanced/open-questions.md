---
title: Open Questions
parent: Advanced
nav_order: 3
description: "Design decisions and open questions"
---

# Open Questions
{: .no_toc }

Design decisions, resolved questions, and open discussion topics.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Question Status Legend

| Status | Meaning |
|:-------|:--------|
| 🔴 Blocking | Critical, blocks implementation |
| 🟡 Important | Should resolve soon |
| 🟢 Deferrable | Can proceed without resolution |
| ✅ Resolved | Decision made |

---

## Protocol Fundamentals

### Q1: Should MAP support request-response messaging? ✅
{: .text-green-200 }

**Decision:** Yes, via correlation IDs.

Messages can include a `correlationId` in metadata. Replies include the same ID, allowing request-response patterns without protocol-level support.

```typescript
// Request
await agent.send({
  to: { agentId: "helper" },
  payload: { type: "query", question: "..." },
  meta: { correlationId: "req-123" }
});

// Response (from helper)
await agent.send({
  to: { agentId: requester },
  payload: { type: "answer", result: "..." },
  meta: { correlationId: "req-123" }
});
```

---

### Q2: How should agent IDs be generated? ✅
{: .text-green-200 }

**Decision:** Server-generated ULIDs.

- Server generates IDs on registration
- ULIDs provide sortability and uniqueness
- Agents cannot choose their own IDs
- IDs are stable across reconnection (via resume token)

---

### Q3: Should events be persistent? 🟡
{: .text-yellow-300 }

**Current thinking:** Implementation-dependent.

The protocol defines replay capabilities but doesn't mandate persistence. Implementations can choose:
- In-memory (development)
- Redis (short-term persistence)
- PostgreSQL/Kafka (long-term persistence)

**Open:** Should the protocol define minimum retention requirements?

---

## Connection & Session

### Q4: How long should sessions be resumable? ✅
{: .text-green-200 }

**Decision:** Configurable, default 5 minutes.

```typescript
const server = new MAPServer({
  resumeWindowMs: 5 * 60 * 1000, // 5 minutes
});
```

After the window expires, clients must reconnect fresh.

---

### Q5: Should disconnected agents keep their registrations? 🟡
{: .text-yellow-300 }

**Current thinking:** Yes, within the resume window.

- Agent remains registered but marked as `disconnected`
- Messages queue for delivery on reconnect
- After resume window expires, agent is unregistered
- Orphan policy determines handling of children/tasks

**Open:** Should there be a separate "persistent agent" mode?

---

## Streaming & Events

### Q6: What's the maximum subscription count per client? ✅
{: .text-green-200 }

**Decision:** Server-configurable, default 100.

```typescript
const server = new MAPServer({
  capabilities: {
    subscriptions: { maxActive: 100 }
  }
});
```

Clients can query this via server capabilities.

---

### Q7: How should event ordering work across federated systems? 🔴
{: .text-red-300 }

**Open question.**

Options:
1. **No cross-system ordering** - Events from different systems may interleave arbitrarily
2. **Logical clocks** - Use vector clocks for cross-system ordering
3. **Timestamp-based** - Rely on synchronized clocks (problematic)

**Discussion:** Option 1 is simplest but may cause consistency issues. Option 2 adds complexity. Need real-world federation use cases to decide.

---

## Error Handling

### Q8: Should failed message delivery retry automatically? ✅
{: .text-green-200 }

**Decision:** Configurable per-message.

```typescript
await agent.send({
  to: { agentId: "target" },
  payload: { ... },
  meta: {
    delivery: "queue",     // Queue for retry
    ttl: 60000,            // Give up after 60s
  }
});
```

Delivery modes:
- `inject` - Immediate, fail if unavailable
- `queue` - Queue and retry
- `best-effort` - Try once, don't fail

---

### Q9: How should orphaned children be handled? ✅
{: .text-green-200 }

**Decision:** Configurable policy.

```typescript
interface OrphanPolicy {
  children: "cascade_stop" | "reparent" | "orphan";
  tasks: "reassign" | "return_to_parent" | "fail" | "hold";
  messages: "drop" | "bounce" | "redirect";
}
```

Default: `cascade_stop` children, `return_to_parent` tasks, `bounce` messages.

---

## Permissions

### Q10: Should permissions be inherited through scope hierarchy? 🟡
{: .text-yellow-300 }

**Current thinking:** Optional inheritance.

Scopes can specify `inheritFrom` to inherit parent permissions:

```typescript
const childScope = await agent.createScope({
  name: "sub-team",
  parentId: parentScope.id,
  permissions: {
    inheritFrom: parentScope.id,
    // Override specific permissions
    sendPolicy: "members"
  }
});
```

**Open:** What happens when parent permissions change?

---

### Q11: Can agents grant permissions to other agents? 🟢
{: .text-green-200 }

**Deferrable.**

Current model: Permissions come from server/client level. Agent-to-agent permission grants would add complexity.

**Future consideration:** Delegation tokens that agents can issue.

---

## Federation

### Q12: Should federation support transitive routing? 🔴
{: .text-red-300 }

**Open question.**

Scenario: System A connects to B, B connects to C. Can A send to C?

Options:
1. **No transitive routing** - A can only reach B directly
2. **Explicit forwarding** - B can choose to forward A's messages to C
3. **Full mesh** - All connected systems can reach each other

**Discussion:** Security implications are significant. Option 2 seems like a good middle ground.

---

### Q13: How should federated systems discover each other? 🟡
{: .text-yellow-300 }

**Current thinking:** Manual configuration.

```typescript
const server = new MAPServer({
  federation: {
    peers: [
      { systemId: "beta", endpoint: "wss://beta.example.com/map" }
    ]
  }
});
```

**Future consideration:** Discovery protocol or registry service.

---

## Agent Lifecycle

### Q14: Should agents be able to suspend themselves? ✅
{: .text-green-200 }

**Decision:** Yes.

```typescript
await agent.update({ state: "suspended" });
// Later
await agent.update({ state: "running" });
```

Suspended agents:
- Remain registered
- Don't receive new messages (queued)
- Can still query state
- Can resume at any time

---

### Q15: Should there be agent "capabilities" beyond roles? 🟢
{: .text-green-200 }

**Deferrable.**

Current: Agents have `role` and `metadata`. Capabilities can be stored in metadata.

**Future consideration:** First-class capability system for matching agents to work.

---

## Contributing to Decisions

To participate in resolving open questions:

1. Review the relevant protocol spec section
2. Consider implementation implications
3. Open a GitHub discussion or issue
4. Propose with rationale and examples

Decisions are made based on:
- Technical merit
- Implementation complexity
- Real-world use cases
- Community feedback
