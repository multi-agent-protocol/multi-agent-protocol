# MAP Server SDK - Claude Context

This document provides context for Claude when working on the MAP Server SDK.

## What This Is

The MAP Server SDK provides **composable building blocks** for implementing Multi-Agent Protocol (MAP) compliant servers. It's the server-side counterpart to the client SDK in the parent directory.

## Design Philosophy

### Core Principles

1. **Handler Pattern as Primitive** - Functions, not classes, are the core abstraction
2. **Constructor Injection** - Dependencies are explicit, no magic
3. **Pluggable Storage** - Each building block has its own store interface
4. **Federation as Decorator** - Core blocks stay simple, federation wraps them
5. **Optional OOP** - `BaseMAPRouter` for those who prefer classes

### Why These Choices

- **Handlers over classes**: MAP servers vary widely (test server vs production). Handlers compose better.
- **Explicit dependencies**: Easy to test, easy to understand, TypeScript catches errors.
- **Per-block storage**: Different data has different access patterns (events need time-range, agents need state filter).
- **Decorator federation**: Don't pay for what you don't use. Core blocks stay testable.

## Directory Structure

```
server/
├── index.ts                 # Main exports (re-exports everything)
├── types.ts                 # ALL interfaces and types (~800 lines)
│
├── events/                  # EventBus - central event dispatcher
│   ├── index.ts
│   ├── event-bus.ts         # EventBusImpl
│   └── stores/in-memory.ts  # InMemoryEventStore
│
├── agents/                  # AgentRegistry - agent lifecycle
│   ├── index.ts
│   ├── registry.ts          # AgentRegistryImpl
│   ├── handlers.ts          # createAgentHandlers()
│   └── stores/in-memory.ts  # InMemoryAgentStore
│
├── sessions/                # SessionManager - connection tracking
│   ├── index.ts
│   ├── manager.ts           # SessionManagerImpl
│   └── stores/in-memory.ts  # InMemorySessionStore
│
├── scopes/                  # ScopeManager - with hierarchy
│   ├── index.ts
│   ├── manager.ts           # ScopeManagerImpl
│   ├── handlers.ts          # createScopeHandlers()
│   └── stores/in-memory.ts  # InMemoryScopeStore
│
├── subscriptions/           # SubscriptionManager - causal ordering
│   ├── index.ts
│   ├── manager.ts           # SubscriptionManagerImpl
│   ├── handlers.ts          # createSubscriptionHandlers()
│   └── stores/in-memory.ts  # InMemorySubscriptionStore
│
├── messages/                # MessageRouter - with queuing
│   ├── index.ts
│   ├── router.ts            # MessageRouterImpl
│   ├── handlers.ts          # createMessageHandlers()
│   └── stores/in-memory.ts  # InMemoryMessageQueueStore
│
├── router/                  # RouterConnection + OOP adapter
│   ├── index.ts
│   ├── connection.ts        # RouterConnectionImpl (JSON-RPC)
│   ├── handlers.ts          # createConnectionHandlers(), combineHandlers()
│   ├── base-router.ts       # BaseMAPRouter, DefaultMAPRouter
│   └── adapter.ts           # routerToHandlers()
│
├── permissions/             # Access control
│   ├── index.ts
│   ├── checker.ts           # PermissionCheckerImpl
│   └── middleware.ts        # permissionMiddleware()
│
├── cleanup/                 # Resource cleanup
│   ├── index.ts
│   └── cleaner.ts           # ResourceCleanerImpl
│
└── federation/              # Cross-system communication
    ├── index.ts
    ├── gateway.ts           # FederationGatewayImpl
    ├── buffer.ts            # OutageBufferImpl
    ├── handlers.ts          # createFederationHandlers()
    └── decorators/
        ├── index.ts
        ├── agents.ts        # FederatedAgentRegistry
        ├── scopes.ts        # FederatedScopeManager
        └── messages.ts      # FederatedMessageRouter
```

## Key Patterns

### Building Block Pattern

Each building block follows this structure:

```typescript
// Interface in types.ts
export interface AgentRegistry {
  register(params: RegisterParams): RegisteredAgent;
  get(id: string): RegisteredAgent | undefined;
  list(filter?: AgentFilter): RegisteredAgent[];
  // ...
}

// Implementation
export class AgentRegistryImpl implements AgentRegistry {
  constructor(private opts: AgentRegistryOptions) {}
  // ...
}

// Handler factory
export function createAgentHandlers(opts: AgentHandlerOptions): HandlerRegistry {
  return {
    "map/agents/register": async (params, ctx) => { /* ... */ },
    "map/agents/list": async (params, ctx) => { /* ... */ },
  };
}
```

### Handler Composition

```typescript
const handlers = combineHandlers(
  createConnectionHandlers({ sessions }),
  createAgentHandlers({ agents, eventBus }),
  createScopeHandlers({ scopes, eventBus }),
  // ... more handlers
);
```

### Decorator Pattern (Federation)

```typescript
// Wrap local registry with federation
const federatedAgents = new FederatedAgentRegistry({
  local: agents,           // Wrapped instance
  gateway: gateway,        // Federation gateway
  sync: { onRegister: true },
});

// Same interface, added behavior
federatedAgents.register({ name: "Agent" }); // Also broadcasts to peers
```

## Common Tasks

### Adding a New Protocol Method

1. Add types to `types.ts`:
   ```typescript
   export interface MyMethodParams { /* ... */ }
   export interface MyMethodResult { /* ... */ }
   ```

2. Add to relevant handler factory:
   ```typescript
   // In agents/handlers.ts (or appropriate module)
   "map/agents/myMethod": async (params: MyMethodParams, ctx) => {
     // Implementation
     return result;
   },
   ```

3. If using OOP interface, add to `MAPRouterInterface` in `router/adapter.ts` and implement in `BaseMAPRouter`.

4. Add tests in `__tests__/`.

### Adding a New Event Type

1. Add to building block that emits it:
   ```typescript
   // In registry.ts
   this.eventBus.emit({
     type: "agent.myEvent",
     data: { /* ... */ },
     source: { agentId: agent.id },
   });
   ```

2. Update subscription matching if needed (in `subscriptions/manager.ts`).

### Adding a New Building Block

1. Create directory with:
   - `index.ts` - exports
   - `<name>.ts` - implementation
   - `handlers.ts` - handler factory (if protocol methods)
   - `stores/in-memory.ts` - default store

2. Add interfaces to `types.ts`.

3. Export from `server/index.ts`.

### Adding Custom Storage

Implement the store interface:

```typescript
// types.ts defines the interface
export interface AgentStore {
  save(agent: RegisteredAgent): void;
  get(id: string): RegisteredAgent | undefined;
  list(filter?: AgentFilter): RegisteredAgent[];
  delete(id: string): boolean;
  clear(): void;
}

// Your implementation
class PostgresAgentStore implements AgentStore {
  // ...
}

// Inject
const agents = new AgentRegistryImpl({
  eventBus,
  store: new PostgresAgentStore(connectionString),
});
```

## Type System

All types are in `types.ts`. Key types:

| Type | Purpose |
|------|---------|
| `MAPEvent` | Event with id, type, timestamp, data, source, causedBy |
| `RegisteredAgent` | Agent with id, name, role, state, metadata, sessionId |
| `ServerScope` | Scope with id, name, metadata, parentId |
| `ServerSession` | Session with id, role, status, agentIds, subscriptionIds |
| `ServerSubscription` | Subscription with id, sessionId, filter |
| `ServerMessage` | Message with id, from, to, payload, timestamp |
| `HandlerContext` | Context passed to handlers (session, requestId, signal) |
| `HandlerRegistry` | Record<string, Handler> |
| `Middleware` | (method, params, ctx, next) => Promise<unknown> |

## Testing

Tests are in `src/__tests__/`:

| File | Coverage |
|------|----------|
| `server-events.test.ts` | EventBus, EventStore |
| `server-agents.test.ts` | AgentRegistry, AgentStore |
| `server-scopes.test.ts` | ScopeManager, hierarchy |
| `server-sessions.test.ts` | SessionManager, resume |
| `server-subscriptions.test.ts` | SubscriptionManager, causal ordering |
| `server-messages.test.ts` | MessageRouter, queuing |
| `server-router-connection.test.ts` | RouterConnection, middleware |
| `server-map-router.test.ts` | BaseMAPRouter, routerToHandlers |
| `server-permissions.test.ts` | PermissionChecker, middleware |
| `server-cleanup.test.ts` | ResourceCleaner |
| `server-federation-gateway.test.ts` | FederationGateway, OutageBuffer |
| `server-federated-decorators.test.ts` | All federation decorators |
| `server-federation-handlers.test.ts` | Federation protocol handlers |
| `server-sdk-integration.test.ts` | Full integration tests |

Run tests:
```bash
npm test -- --run                    # All tests
npm test -- server-agents            # Filter by name
npm test -- --watch                  # Watch mode
```

## Common Gotchas

### EventBus.on() Signature

```typescript
// Correct - pass event type(s) first
eventBus.on("agent.registered", (event) => { /* ... */ });
eventBus.on("*", (event) => { /* ... */ });
eventBus.on(["agent.registered", "agent.unregistered"], (event) => { /* ... */ });

// Wrong - no type argument
eventBus.on((event) => { /* ... */ }); // ERROR
```

### Session Disconnect Returns New Object

```typescript
const session = sessions.create({ role: "agent" });
sessions.disconnect(session.id);

// Original reference is stale
session.status; // Still "connected" (stale)

// Get fresh reference
sessions.get(session.id)?.status; // "disconnected" (correct)
```

### Scope Members vs Scope Object

```typescript
const scope = scopes.create({ name: "Room" });

// Members are NOT on the scope object
scope.members; // undefined

// Use getMembers() instead
scopes.getMembers(scope.id); // ["agent-1", "agent-2"]
```

### Permission Rules Format

```typescript
// Correct - use `method` and `roles` (plural)
const rules = [
  { method: "map/agents/list", roles: ["client", "agent"], allow: true },
];

// Wrong - singular `role` and `pattern`
const rules = [
  { pattern: "map/agents/list", role: "client", allow: true }, // ERROR
];
```

### Message Delivery Handler Signature

```typescript
// Correct - (agentId, message)
messages.onDeliver((agentId, message) => {
  console.log(`Deliver to ${agentId}:`, message.payload);
});

// Wrong - just message
messages.onDeliver((message) => { /* ... */ }); // agentId is undefined
```

## Dependencies

The building blocks have this dependency graph:

```
EventBus (no dependencies)
    ↑
    ├── AgentRegistry
    ├── ScopeManager
    ├── SessionManager
    │
    └── SubscriptionManager ←── ScopeManager (for scope expansion)
    │
    └── MessageRouter ←── AgentRegistry, ScopeManager
```

When creating instances, create EventBus first, then the rest.

## Related Files

- `../types/` - Client-side types (Agent, Scope, Message without "Server" prefix)
- `../connection/` - Client connection classes
- `../utils/causal-buffer.ts` - CausalEventBuffer used by SubscriptionManager
- `../utils/ulid.ts` - ULID generation for event IDs

## Spec Reference

The implementation follows the spec in `.sudocode/specs/s-10j2_map_server_sdk_building_blocks_architecture.md`.
