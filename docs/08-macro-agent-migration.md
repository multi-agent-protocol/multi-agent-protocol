# macro-agent Migration to MAP

> **Status note.** This is an illustrative migration sketch, not a current-API reference. Method names here (e.g. `map/agent.register`, `map/hierarchy.get`, `map/broadcast`) predate the consolidation and are not the canonical core surface. For the current 23-method core and extension model, see [`14-consolidation-plan.md`](./14-consolidation-plan.md) and [`registry.md`](./registry.md).

This spec provides a concrete example of how the existing macro-agent implementation would migrate to use MAP, demonstrating the protocol's practical application.

## Current Architecture Recap

```
┌─────────────────────────────────────────────────────────────┐
│                   macro-agent Today                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  External Layer                                             │
│  • ACP (via MacroAgent class)                              │
│  • REST API (Express server)                               │
│  • WebSocket server                                         │
│                                                             │
│  Communication Layers (3 separate systems)                  │
│  1. ACP Extensions (_macro/*)                              │
│  2. MessageRouter (6 channel types)                        │
│  3. PeerManager (cross-instance)                           │
│                                                             │
│  Core Components                                            │
│  • AgentManager (lifecycle)                                │
│  • EventStore (persistence)                                │
│  • TaskManager / TaskBackend                               │
│  • WorkspaceManager (git worktrees)                        │
│  • MergeQueue                                              │
│  • RoleRegistry                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Migration Strategy

### Phase 1: Protocol Adapter Layer

Add MAP as an alternative protocol layer without changing internals.

### Phase 2: Unified Communication

Replace MessageRouter + PeerManager with MAP-native implementation.

### Phase 3: Full MAP Native

All components use MAP primitives.

---

## Component Mapping

| macro-agent Component | MAP Equivalent |
|----------------------|----------------|
| `AgentManager.spawn()` | `map/agent.register` |
| `AgentManager.getHierarchy()` | `map/hierarchy.get` |
| `MessageRouter.send()` | `map/send` |
| `MessageRouter.subscribe()` | `map/subscribe` |
| `Broadcast channels` | `map/broadcast` + Scopes |
| `Role channels` | Role-based addressing |
| `PeerManager.sendMessage()` | `map/send` to federated address |
| `injectContext()` | `map/inject` |

---

## Code Examples

### Before: Spawning an Agent (ACP Extension)

```typescript
// Current: src/acp/macro-agent.ts
async handleSpawnAgent(params, sessionId) {
  const mapping = this.sessionMapper.getMapping(sessionId);
  const parentId = params.parentId ?? mapping?.agentId;

  // Check role capability
  if (params.role) {
    const capability = `agent.spawn.${params.role}`;
    if (!this.roleRegistry.hasCapability(parentAgent.role, capability)) {
      throw new ACPError("Cannot spawn this role", "CAPABILITY_DENIED");
    }
  }

  const result = await this.agentManager.spawn({ ... });
  return { agentId: result.agentId, taskId: result.taskId };
}
```

### After: Spawning an Agent (MAP)

```typescript
// New: src/map/handlers/agent.ts
async handleAgentRegister(params, context) {
  // Role capability check is now protocol-level

  const agent = await this.registry.registerAgent({
    id: generateAgentId(),
    name: params.name,
    role: params.role,
    parent: params.parent ?? context.agentId,
  });

  const process = await this.processManager.spawn({
    agentId: agent.id,
    role: params.role,
  });

  await this.events.emit({ type: "agent.registered", agent });

  return { agentId: agent.id, registered: true };
}
```

### Before: Sending a Message

```typescript
// Current: MessageRouter
async send(from, channel, message) {
  const recipients = await this.resolveChannel(channel, from);
  const wakeAction = this.determineWakeAction(message.priority);

  for (const recipientId of recipients) {
    // Complex wake/inject/queue logic
  }

  await this.eventStore.emit({ type: "message_sent", ... });
}
```

### After: Sending a Message (MAP)

```typescript
// New: Using MAP SDK
await this.map.send({
  to: { role: "worker", within: "scope_active" },
  payload: { type: "task_assignment", task: { id: "task_001" } },
  meta: { priority: "high", delivery: "inject" }
});
```

### Before: Context Injection

```typescript
// Current: src/steering/inject.ts
export async function injectContext(agentId, content, deps) {
  const session = await deps.agentManager.getSession(agentId);

  // Try inject → interrupt → message fallback
  if (session.inject) { ... }
  if (session.interruptWith) { ... }
  await deps.messageRouter.send(...);
}
```

### After: Context Injection (MAP)

```typescript
// MAP inject with explicit semantics
await this.map.inject({
  to: { agent: agentId },
  payload: { content },
  meta: {
    delivery: "best-effort",  // Try inject → interrupt → queue
    priority: "high"
  }
});
```

---

## Subscription Migration

### Before: Multiple subscription points

```typescript
// 1. MessageRouter subscription
await messageRouter.subscribe(agentId, { type: "subtree", rootId: parentId });

// 2. EventStore subscription
eventStore.on("task_completed", (event) => { ... });

// 3. PeerManager inbox polling
const messages = await peerManager.getInbox(agentId);

// 4. Session update callbacks
session.onUpdate((update) => { ... });
```

### After: Unified Subscription (MAP)

```typescript
const subscription = await this.map.subscribe({
  streams: ["messages", "tasks", "state"],
  filter: {
    subtree: myAgentId,
    eventTypes: ["message", "task.completed", "agent.state"]
  }
});

for await (const event of subscription.events) {
  switch (event.type) {
    case "message": handleMessage(event.envelope); break;
    case "task.completed": handleTaskComplete(event.task); break;
    case "agent.state": handleStateChange(event.agentId, event.current); break;
  }
}
```

---

## Migration Checklist

### Phase 1: Adapter Layer
- [ ] Add MAP SDK dependency
- [ ] Create MAPAdapter class wrapping existing components
- [ ] Implement MAP server alongside existing ACP server
- [ ] Add feature flag for MAP mode
- [ ] Write integration tests comparing ACP vs MAP behavior

### Phase 2: Unified Communication
- [ ] Migrate MessageRouter to use MAP addressing
- [ ] Migrate PeerManager to MAP federation
- [ ] Consolidate event subscriptions
- [ ] Remove duplicate event emission
- [ ] Update agent spawn to use MAP registration

### Phase 3: Full Native
- [ ] Migrate TaskManager to MAP tasks (optional)
- [ ] Migrate RoleRegistry to MAP roles
- [ ] Remove legacy communication code
- [ ] Update all clients to MAP
- [ ] Deprecate ACP extensions (keep compat layer)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing ACP clients | ACP-compat mode as fallback |
| Performance regression | Benchmark at each phase |
| Feature parity gaps | Feature flag for gradual rollout |
| State migration | Snapshot + replay for existing sessions |
| Federation complexity | Phase federation last |

---

## Open Questions

1. **Task backend**: Keep as separate abstraction or fully integrate?
2. **Workspace/git**: Should environment concept include workspace management?
3. **MCP tools**: Should MAP define standard tools or leave to implementation?
4. **Session persistence**: How to migrate existing ACP sessions to MAP?
