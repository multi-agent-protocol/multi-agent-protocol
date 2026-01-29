# MAP Server SDK

Composable building blocks for implementing MAP-compliant servers.

## Overview

The MAP Server SDK provides a modular architecture where each component is independent, injectable, and composable. This allows you to build MAP servers ranging from simple in-memory test servers to distributed production systems.

## Quick Start

```typescript
import {
  EventBusImpl,
  AgentRegistryImpl,
  ScopeManagerImpl,
  SessionManagerImpl,
  SubscriptionManagerImpl,
  MessageRouterImpl,
  RouterConnectionImpl,
  createConnectionHandlers,
  createAgentHandlers,
  createScopeHandlers,
  createMessageHandlers,
  createSubscriptionHandlers,
  combineHandlers,
} from "@anthropic/multi-agent-protocol/server";

// 1. Create building blocks
const eventBus = new EventBusImpl();
const sessions = new SessionManagerImpl({ eventBus });
const agents = new AgentRegistryImpl({ eventBus });
const scopes = new ScopeManagerImpl({ eventBus });
const subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });
const messages = new MessageRouterImpl({ eventBus, agents, scopes });

// 2. Combine handlers
const handlers = combineHandlers(
  createConnectionHandlers({ sessions }),
  createAgentHandlers({ agents, eventBus }),
  createScopeHandlers({ scopes, eventBus }),
  createMessageHandlers({ messages }),
  createSubscriptionHandlers({ subscriptions, eventBus })
);

// 3. Handle incoming connections
function handleConnection(stream: BidirectionalStream) {
  const connection = new RouterConnectionImpl({
    stream,
    handlers,
    sessions,
    role: "agent",
  });
  connection.start();
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     RouterConnection                         │
│  (JSON-RPC routing, middleware chain, session resume)        │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  AgentRegistry  │  │  ScopeManager   │  │  SessionManager │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │    EventBus     │
                    └────────┬────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Subscriptions   │  │  MessageRouter  │  │ ResourceCleaner │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Building Blocks

### EventBus

Central event dispatcher. All building blocks emit events through this.

```typescript
const eventBus = new EventBusImpl();

// Subscribe to specific events
eventBus.on("agent.registered", (event) => {
  console.log(`Agent registered: ${event.data.agent.name}`);
});

// Subscribe to all events
eventBus.on("*", (event) => {
  console.log(`Event: ${event.type}`);
});

// Query historical events
const recentEvents = eventBus.getEvents({
  types: ["agent.registered"],
  limit: 10
});
```

### AgentRegistry

Manages agent lifecycle and state.

```typescript
const agents = new AgentRegistryImpl({ eventBus });

// Register an agent
const agent = agents.register({
  name: "MyAgent",
  role: "worker",
  sessionId: "session-123",
  metadata: { version: "1.0" },
});

// Update state
agents.updateState(agent.id, "busy");

// List by filter
const busyAgents = agents.list({ state: "busy" });
```

### ScopeManager

Manages scopes with hierarchy support.

```typescript
const scopes = new ScopeManagerImpl({ eventBus });

// Create nested scopes
const company = scopes.create({ name: "Acme Corp" });
const engineering = scopes.create({ name: "Engineering", parentId: company.id });
const frontend = scopes.create({ name: "Frontend", parentId: engineering.id });

// Join agents to scopes
scopes.join(frontend.id, agent.id);

// Query hierarchy
const ancestors = scopes.getAncestors(frontend.id); // [engineering, company]
const descendants = scopes.getDescendants(company.id); // [engineering, frontend]

// Get members including descendants
const allMembers = scopes.getMembers(company.id, { includeDescendants: true });
```

### SessionManager

Tracks connections with resume support.

```typescript
const sessions = new SessionManagerImpl({ eventBus });

// Create session
const session = sessions.create({ role: "agent", name: "Agent Session" });

// Disconnect (generates resume token)
const resumeToken = sessions.disconnect(session.id);

// Resume later
const result = sessions.resume(resumeToken);
if (result.success) {
  console.log(`Resumed session: ${result.session.id}`);
}
```

### SubscriptionManager

Event subscriptions with causal ordering.

```typescript
const subscriptions = new SubscriptionManagerImpl({ eventBus, scopes });

// Create subscription
const sub = subscriptions.create({
  sessionId: session.id,
  filter: {
    eventTypes: ["agent.registered", "agent.state.changed"],
    scopes: [scope.id],
  },
});

// Async iteration over events
for await (const event of subscriptions.getEventStream(sub.id)) {
  console.log(`Event: ${event.type}`);
}
```

### MessageRouter

Routes messages with offline queuing.

```typescript
const messages = new MessageRouterImpl({ eventBus, agents, scopes });

// Set delivery handler
messages.onDeliver((agentId, message) => {
  // Deliver to agent's connection
  connections.get(agentId)?.send(message);
});

// Send to specific agent
messages.sendToAgent({
  from: senderAgent.id,
  to: receiverAgent.id,
  payload: { text: "Hello!" },
});

// Broadcast to scope
messages.sendToScope({
  from: senderAgent.id,
  scopeId: scope.id,
  payload: { text: "Hello everyone!" },
  excludeSender: true,
});

// Flush queued messages when agent reconnects
messages.flushQueue(agentId);
```

## Handler Pattern

The SDK uses a handler pattern where each protocol method maps to a handler function:

```typescript
// Handler signature
type Handler<TParams, TResult> = (
  params: TParams,
  ctx: HandlerContext
) => Promise<TResult>;

// HandlerContext provides session and request info
interface HandlerContext {
  session: ServerSession;
  requestId: string;
  signal: AbortSignal;
}
```

### Creating Custom Handlers

```typescript
const customHandlers = {
  "custom/myMethod": async (params: { value: string }, ctx: HandlerContext) => {
    // Access session
    console.log(`Called by session: ${ctx.session.id}`);

    // Your logic here
    return { result: params.value.toUpperCase() };
  },
};

const handlers = combineHandlers(
  createAgentHandlers({ agents, eventBus }),
  customHandlers
);
```

## OOP Interface

For those who prefer class-based implementations:

```typescript
import { BaseMAPRouter, routerToHandlers } from "@anthropic/multi-agent-protocol/server";

class MyRouter extends BaseMAPRouter {
  async registerAgent(params, ctx) {
    // Custom pre-registration logic
    console.log(`Registering: ${params.name}`);

    // Call parent implementation
    const agent = await super.registerAgent(params, ctx);

    // Custom post-registration logic
    await this.notifyAdmins(agent);

    return agent;
  }
}

const router = new MyRouter({ agents, scopes, sessions, subscriptions, messages, eventBus });
const handlers = routerToHandlers(router);
```

## Permissions

Role-based access control with glob pattern matching:

```typescript
import { PermissionCheckerImpl, permissionMiddleware } from "@anthropic/multi-agent-protocol/server";

const permissions = new PermissionCheckerImpl({
  rules: [
    { method: "map/agents/register", roles: ["agent"], allow: true },
    { method: "map/agents/list", roles: ["client", "agent"], allow: true },
    { method: "map/scopes/*", roles: ["agent"], allow: true },
    { method: "map/send", roles: ["agent", "client"], allow: true },
  ],
  defaultAllow: false,
});

const connection = new RouterConnectionImpl({
  stream,
  handlers,
  sessions,
  role: "agent",
  middleware: [permissionMiddleware(permissions)],
});
```

## Resource Cleanup

Automatic cleanup of stale resources:

```typescript
import { ResourceCleanerImpl } from "@anthropic/multi-agent-protocol/server";

const cleaner = new ResourceCleanerImpl({
  sessions,
  agents,
  subscriptions,
  messages,
  thresholds: {
    sessionDisconnectMs: 5 * 60 * 1000, // 5 minutes
    intervalMs: 60 * 1000, // Run every minute
  },
});

// Start automatic cleanup
cleaner.start();

// Or run manually
const stats = await cleaner.run();
console.log(`Cleaned: ${stats.sessionsExpired} sessions`);
```

## Federation

Connect multiple MAP systems:

```typescript
import {
  FederationGatewayImpl,
  FederatedAgentRegistry,
  FederatedMessageRouter,
} from "@anthropic/multi-agent-protocol/server";

const gateway = new FederationGatewayImpl({
  systemId: "system-east",
});

// Wrap building blocks
const federatedAgents = new FederatedAgentRegistry({
  local: agents,
  gateway,
  sync: { onRegister: true, includeRemote: true },
});

const federatedMessages = new FederatedMessageRouter({
  local: messages,
  gateway,
  agents: federatedAgents,
});

// Connect to peer
await gateway.connectPeer({
  systemId: "system-west",
  endpoint: "wss://west.example.com/federation",
  transport: myTransport,
});

// Remote agents have prefixed IDs: "remote:system-west:agent-123"
```

## Custom Storage

Each building block accepts a custom store for persistence:

```typescript
// Implement the store interface
class RedisEventStore implements EventStore {
  append(event: MAPEvent): void { /* ... */ }
  query(filter: EventFilter): MAPEvent[] { /* ... */ }
  getById(id: string): MAPEvent | undefined { /* ... */ }
  clear(): void { /* ... */ }
}

// Inject into building block
const eventBus = new EventBusImpl({
  store: new RedisEventStore({ url: process.env.REDIS_URL }),
});
```

Available store interfaces:
- `EventStore` - Event persistence
- `AgentStore` - Agent state
- `ScopeStore` - Scope hierarchy and membership
- `SessionStore` - Session state
- `SubscriptionStore` - Subscription tracking
- `MessageQueueStore` - Offline message queue

## Protocol Methods

The SDK implements these MAP protocol methods:

| Category | Methods |
|----------|---------|
| Connection | `map/connect`, `map/disconnect` |
| Agents | `map/agents/register`, `map/agents/unregister`, `map/agents/list`, `map/agents/get`, `map/agents/update` |
| Scopes | `map/scopes/create`, `map/scopes/delete`, `map/scopes/list`, `map/scopes/get`, `map/scopes/join`, `map/scopes/leave` |
| Messages | `map/send` |
| Subscriptions | `map/subscribe`, `map/unsubscribe`, `map/replay` |
| Federation | `map/federation/connect`, `map/federation/disconnect`, `map/federation/list`, `map/federation/route` |

## Events Emitted

Building blocks emit these events via EventBus:

| Building Block | Events |
|----------------|--------|
| AgentRegistry | `agent.registered`, `agent.unregistered`, `agent.state.changed`, `agent.metadata.changed` |
| ScopeManager | `scope.created`, `scope.deleted`, `scope.agent.joined`, `scope.agent.left` |
| SessionManager | `session.connected`, `session.disconnected`, `session.resumed`, `session.expired` |
| MessageRouter | `message.sent`, `message.delivered`, `message.queued`, `message.expired` |
| SubscriptionManager | `subscription.created`, `subscription.cancelled` |

## Testing

The SDK includes comprehensive tests. Run with:

```bash
npm test -- --run
```

For integration test examples, see `src/__tests__/server-sdk-integration.test.ts`.
