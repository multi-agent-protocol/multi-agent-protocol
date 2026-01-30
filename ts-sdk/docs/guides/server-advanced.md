# Server Advanced: Building Blocks

For maximum control, use the building blocks directly instead of `MAPServer`. This is useful when you need:

- Custom composition of components
- Partial MAP implementation
- Integration with existing systems
- Non-standard behavior

## Building Block Overview

| Block | Purpose | Dependencies |
|-------|---------|--------------|
| `EventBus` | Central event dispatcher | None |
| `SessionManager` | Connection tracking, resume | EventBus |
| `AgentRegistry` | Agent lifecycle | EventBus |
| `ScopeManager` | Logical groupings | EventBus |
| `SubscriptionManager` | Event filtering | EventBus, ScopeManager |
| `MessageRouter` | Message delivery | EventBus, AgentRegistry, ScopeManager |

## Dependency Graph

```
EventBus (foundation)
    │
    ├── SessionManager
    │
    ├── AgentRegistry
    │
    ├── ScopeManager
    │       │
    │       └── SubscriptionManager
    │
    └── MessageRouter ← AgentRegistry, ScopeManager
```

## Creating Building Blocks

### EventBus

The foundation for all other blocks:

```typescript
import { EventBusImpl, InMemoryEventStore } from "@multi-agent-protocol/sdk/server";

const eventBus = new EventBusImpl({
  store: new InMemoryEventStore(), // Optional, defaults to in-memory
});

// Emit events
const event = eventBus.emit({
  type: "custom.event",
  data: { value: 42 },
});

// Subscribe to events
const unsubscribe = eventBus.on("custom.event", (event) => {
  console.log(event.data.value);
});

// Subscribe to all events
eventBus.on("*", (event) => console.log(event.type));

// Subscribe to multiple types
eventBus.on(["agent.registered", "agent.unregistered"], handler);

// Get historical events
const recent = eventBus.getAfter(lastEventId, 100);
```

### SessionManager

Tracks connections and handles resume:

```typescript
import { SessionManagerImpl } from "@multi-agent-protocol/sdk/server";

const sessions = new SessionManagerImpl({
  eventBus,
  resumeWindowMs: 5 * 60 * 1000, // 5 minutes
});

// Create session
const session = sessions.create({
  role: "agent",
  name: "Worker",
});

// Track activity
sessions.touch(session.id);

// Disconnect (marks as resumable)
sessions.disconnect(session.id);

// Resume session
const result = sessions.resume(resumeToken);
if (result.success) {
  console.log("Resumed:", result.session.id);
}

// Query sessions
const connected = sessions.list({ status: "connected" });
const agents = sessions.list({ role: "agent" });

// Cleanup stale sessions
sessions.expireStale(5 * 60 * 1000);
```

### AgentRegistry

Manages agent lifecycle:

```typescript
import { AgentRegistryImpl } from "@multi-agent-protocol/sdk/server";

const agents = new AgentRegistryImpl({
  eventBus,
  store: new InMemoryAgentStore(),
});

// Register agent
const agent = agents.register({
  name: "Worker",
  role: "processor",
  sessionId: session.id,
  metadata: { version: "1.0" },
});

// Update agent
agents.update(agent.id, {
  state: "busy",
  metadata: { currentTask: "task-123" },
});

// Query agents
const all = agents.list();
const workers = agents.list({ role: "processor" });
const active = agents.list({ state: "running" });

// Unregister
agents.unregister(agent.id);
```

### ScopeManager

Manages logical groupings with hierarchy:

```typescript
import { ScopeManagerImpl } from "@multi-agent-protocol/sdk/server";

const scopes = new ScopeManagerImpl({
  eventBus,
});

// Create scope
const scope = scopes.create({
  name: "project-alpha",
  metadata: { owner: "team-a" },
});

// Create child scope
const subScope = scopes.create({
  name: "task-queue",
  parentId: scope.id,
});

// Join/leave scope
scopes.join(scope.id, agent.id);
scopes.leave(scope.id, agent.id);

// Query members
const members = scopes.getMembers(scope.id);

// Get children
const children = scopes.getChildren(scope.id);

// Get hierarchy
const hierarchy = scopes.getHierarchy(scope.id); // Includes ancestors
```

### SubscriptionManager

Handles event filtering and delivery:

```typescript
import { SubscriptionManagerImpl } from "@multi-agent-protocol/sdk/server";

const subscriptions = new SubscriptionManagerImpl({
  eventBus,
  scopes,
});

// Create subscription
const subscription = subscriptions.create({
  sessionId: session.id,
  filter: {
    eventTypes: ["agent.*", "scope.joined"],
    scopeIds: [scope.id],
  },
});

// Find matching subscriptions for an event
const matchingIds = subscriptions.match(event);

// Pause/resume
subscriptions.pause(subscription.id);
subscriptions.resume(subscription.id);

// Update filter
subscriptions.updateFilter(subscription.id, {
  eventTypes: ["*"],
});

// Remove
subscriptions.remove(subscription.id);
```

### MessageRouter

Routes messages to agents and scopes:

```typescript
import { MessageRouterImpl } from "@multi-agent-protocol/sdk/server";

const messages = new MessageRouterImpl({
  eventBus,
  agents,
  scopes,
  queueStore: new InMemoryMessageQueueStore(),
});

// Send to agent
messages.send({
  from: sourceAgentId,
  to: { agentId: targetAgentId },
  payload: { action: "process", data: {} },
});

// Send to scope (all members)
messages.send({
  from: sourceAgentId,
  to: { scopeId: scope.id },
  payload: { type: "announcement" },
});

// Register delivery handler
messages.onDeliver((agentId, message) => {
  // Forward to agent's connection
  const router = findRouterForAgent(agentId);
  router?.notify("map/message", message);
});

// Queue management
const stats = messages.getQueueStats(agentId);
messages.ack(messageId);
```

## Composing Handlers

Create handlers from building blocks:

```typescript
import {
  createConnectionHandlers,
  createAgentHandlers,
  createScopeHandlers,
  createMessageHandlers,
  createSubscriptionHandlers,
  combineHandlers,
} from "@multi-agent-protocol/sdk/server";

const handlers = combineHandlers(
  createConnectionHandlers({
    sessions,
    serverName: "CustomServer",
    serverVersion: "1.0.0",
  }),
  createAgentHandlers({ agents }),
  createScopeHandlers({ scopes }),
  createMessageHandlers({ messages, scopes }),
  createSubscriptionHandlers({ subscriptions, eventBus }),
);
```

## Creating a RouterConnection

Wire up a connection manually:

```typescript
import { RouterConnectionImpl } from "@multi-agent-protocol/sdk/server";

const router = new RouterConnectionImpl({
  stream,
  handlers,
  sessions,
  middleware: [],
  role: "agent",
});

router.start();

// Send notifications
await router.notify("custom/event", { data: "value" });

// Access session
console.log(router.session.id);

// Wait for close
await router.closed;
```

## Custom Building Block

Create your own building block:

```typescript
interface TaskQueue {
  enqueue(task: Task): void;
  dequeue(): Task | undefined;
  assign(taskId: string, agentId: string): void;
}

class TaskQueueImpl implements TaskQueue {
  constructor(private opts: { eventBus: EventBus }) {}

  enqueue(task: Task): void {
    this.store.add(task);
    this.opts.eventBus.emit({
      type: "task.enqueued",
      data: { task },
    });
  }

  assign(taskId: string, agentId: string): void {
    const task = this.store.get(taskId);
    task.assignedTo = agentId;
    this.opts.eventBus.emit({
      type: "task.assigned",
      data: { taskId, agentId },
    });
  }
}

// Create handlers
function createTaskHandlers(opts: { tasks: TaskQueue }): HandlerRegistry {
  return {
    "tasks/enqueue": async (params, ctx) => {
      opts.tasks.enqueue(params.task);
      return { success: true };
    },
    "tasks/claim": async (params, ctx) => {
      const task = opts.tasks.dequeue();
      if (task) {
        opts.tasks.assign(task.id, ctx.session.agentId);
      }
      return { task };
    },
  };
}
```

## Complete Custom Server Example

```typescript
import {
  EventBusImpl,
  SessionManagerImpl,
  AgentRegistryImpl,
  ScopeManagerImpl,
  SubscriptionManagerImpl,
  MessageRouterImpl,
  RouterConnectionImpl,
  createConnectionHandlers,
  createAgentHandlers,
  createScopeHandlers,
  createMessageHandlers,
  createSubscriptionHandlers,
  combineHandlers,
} from "@multi-agent-protocol/sdk/server";

// Create building blocks
const eventBus = new EventBusImpl();
const sessions = new SessionManagerImpl({ eventBus });
const agents = new AgentRegistryImpl({ eventBus });
const scopes = new ScopeManagerImpl({ eventBus });
const subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
const messages = new MessageRouterImpl({ eventBus, agents, scopes });

// Compose handlers
const handlers = combineHandlers(
  createConnectionHandlers({ sessions, serverName: "Custom", serverVersion: "1.0" }),
  createAgentHandlers({ agents }),
  createScopeHandlers({ scopes }),
  createMessageHandlers({ messages, scopes }),
  createSubscriptionHandlers({ subscriptions, eventBus }),
  {
    // Custom handlers
    "custom/ping": async () => ({ pong: Date.now() }),
  }
);

// Middleware
const middleware = [
  async (method, params, ctx, next) => {
    console.log(`[${method}] ${ctx.session.id}`);
    return next();
  },
];

// Track routers
const routers = new Map<string, RouterConnectionImpl>();

// Accept connections
function accept(stream: Stream): RouterConnectionImpl {
  const router = new RouterConnectionImpl({
    stream,
    handlers,
    sessions,
    middleware,
    role: "agent",
  });

  const id = crypto.randomUUID();
  routers.set(id, router);

  router.closed.then(() => {
    routers.delete(id);
  });

  return router;
}

// Wire message delivery
messages.onDeliver((agentId, message) => {
  // Find router for agent
  for (const router of routers.values()) {
    try {
      const agentIds = router.session.agentIds ?? [];
      if (agentIds.includes(agentId)) {
        router.notify("map/message", message);
        break;
      }
    } catch {
      // Session not ready
    }
  }
});

// Wire event delivery
eventBus.on("*", (event) => {
  const matchingSubIds = subscriptions.match(event);
  for (const subId of matchingSubIds) {
    const sub = subscriptions.get(subId);
    if (!sub || sub.paused) continue;

    // Find router for subscription's session
    for (const router of routers.values()) {
      try {
        if (router.session.id === sub.sessionId) {
          router.notify("map/event", { event });
          break;
        }
      } catch {
        // Session not ready
      }
    }
  }
});

export { accept, eventBus, agents, scopes, sessions, messages };
```

## When to Use Building Blocks

| Scenario | Approach |
|----------|----------|
| Standard MAP server | Use `MAPServer` |
| Custom storage only | Use `MAPServer` with `stores` option |
| Custom handlers | Use `MAPServer` with `additionalHandlers` |
| Non-standard event delivery | Use building blocks |
| Partial MAP implementation | Use building blocks |
| Embedded in existing server | Use building blocks |
| Custom message routing | Use building blocks |

## Next Steps

- **[Server Quickstart](./server-quickstart.md)** - Use MAPServer for simpler cases
- **[Transports](./transports.md)** - Connect different transport layers
- **[Testing](./testing.md)** - Test building blocks in isolation
