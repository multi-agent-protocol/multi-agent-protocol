---
title: Migration Guide
parent: Advanced
nav_order: 2
description: "Migrate from macro-agent to MAP"
---

# Migration Guide
{: .no_toc }

Migrate from macro-agent to the Multi-Agent Protocol.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

This guide helps teams migrate from macro-agent to MAP. The migration can be done incrementally, allowing both systems to coexist during transition.

---

## Migration Strategy

We recommend a 3-phase approach:

### Phase 1: Adapter Layer

Run macro-agent on top of MAP:
- MAP server handles communication
- Adapter translates macro-agent messages to MAP
- Existing code continues to work

### Phase 2: Unified Communication

Migrate internal communication to MAP:
- Agents use MAP SDK directly
- Keep macro-agent patterns (scopes, messaging)
- Remove adapter layer

### Phase 3: Full Native

Complete MAP adoption:
- Use MAP idioms natively
- Leverage full MAP feature set
- Remove macro-agent dependencies

---

## Component Mapping

| macro-agent | MAP | Notes |
|:------------|:----|:------|
| `Agent` | `AgentConnection` | Direct equivalent |
| `Orchestrator` | `MAPServer` | Server-side coordinator |
| `Channel` | `Scope` | Logical grouping |
| `Task` | Message with metadata | Task is a message pattern |
| `Worker` | Agent with `role: "worker"` | Role-based classification |

---

## Code Migration Examples

### Agent Registration

**Before (macro-agent):**
```typescript
import { Agent } from "macro-agent";

const agent = new Agent({
  name: "MyWorker",
  type: "worker",
  channels: ["tasks"],
});

await agent.connect(orchestrator);
```

**After (MAP):**
```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

const agent = new AgentConnection(stream, {
  name: "MyWorker",
  role: "worker",
});

await agent.connect();
await agent.joinScope("tasks");
```

---

### Sending Messages

**Before (macro-agent):**
```typescript
await agent.send("other-agent", {
  type: "task",
  payload: { data: "..." },
});
```

**After (MAP):**
```typescript
await agent.send({
  to: { agentId: "other-agent" },
  payload: {
    type: "task",
    data: "...",
  },
});
```

---

### Channel/Scope Broadcast

**Before (macro-agent):**
```typescript
await agent.broadcast("tasks", {
  type: "available",
  capacity: 5,
});
```

**After (MAP):**
```typescript
await agent.send({
  to: { scopeId: "tasks" },
  payload: {
    type: "available",
    capacity: 5,
  },
});
```

---

### Event Subscription

**Before (macro-agent):**
```typescript
orchestrator.on("agent:joined", (agent) => {
  console.log(`Agent joined: ${agent.name}`);
});
```

**After (MAP):**
```typescript
const sub = await client.subscribe({
  eventTypes: ["agent.registered"],
});

for await (const event of sub) {
  console.log(`Agent joined: ${event.data.agent.name}`);
}
```

---

## Adapter Implementation

For Phase 1, create an adapter that bridges macro-agent to MAP:

```typescript
// macro-agent-adapter.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import { Agent as MacroAgent } from "macro-agent";

export class MacroAgentAdapter {
  private mapAgent: AgentConnection;
  private macroAgent: MacroAgent;

  constructor(macroAgent: MacroAgent, stream: Stream) {
    this.macroAgent = macroAgent;
    this.mapAgent = new AgentConnection(stream, {
      name: macroAgent.name,
      role: macroAgent.type,
      metadata: macroAgent.metadata,
    });
  }

  async connect() {
    await this.mapAgent.connect();

    // Join channels as scopes
    for (const channel of this.macroAgent.channels) {
      await this.mapAgent.joinScope(channel);
    }

    // Forward MAP messages to macro-agent
    this.mapAgent.onMessage((message) => {
      this.macroAgent.emit("message", {
        from: message.from,
        ...message.payload,
      });
    });

    // Forward macro-agent sends to MAP
    this.macroAgent.on("send", async (target, payload) => {
      await this.mapAgent.send({
        to: { agentId: target },
        payload,
      });
    });
  }
}
```

---

## Migration Checklist

### Preparation

- [ ] Inventory all macro-agent components
- [ ] Map channels to scopes
- [ ] Identify custom message types
- [ ] Plan rollback strategy

### Phase 1: Adapter

- [ ] Deploy MAP server alongside orchestrator
- [ ] Implement adapter for each agent type
- [ ] Test with subset of agents
- [ ] Monitor for issues
- [ ] Gradually migrate all agents to adapter

### Phase 2: Unified Communication

- [ ] Update agents to use MAP SDK directly
- [ ] Migrate message handlers
- [ ] Update event subscriptions
- [ ] Remove adapter layer
- [ ] Validate functionality

### Phase 3: Full Native

- [ ] Adopt MAP patterns (permissions, federation)
- [ ] Remove macro-agent dependencies
- [ ] Update documentation
- [ ] Train team on MAP

---

## Common Issues

### Issue: Message format differences

**Problem:** macro-agent messages have different structure than MAP.

**Solution:** Use adapter to transform message format during Phase 1. Update handlers during Phase 2.

### Issue: Channel vs Scope semantics

**Problem:** macro-agent channels have different membership rules.

**Solution:** Configure scope permissions to match channel behavior. MAP scopes are more flexible.

### Issue: Missing orchestrator features

**Problem:** macro-agent orchestrator has features not in MAP server.

**Solution:** Implement as custom handlers or middleware in MAPServer.

---

## Rollback Plan

If issues arise during migration:

1. **Phase 1 rollback:** Remove adapter, restore direct macro-agent connections
2. **Phase 2 rollback:** Revert to adapter layer, keep MAP server
3. **Phase 3 rollback:** Restore macro-agent dependencies, hybrid operation

---

## Support

For migration assistance:
- Open an issue on [GitHub](https://github.com/multi-agent-protocol/multi-agent-protocol/issues)
- Review existing migration examples in the repository
