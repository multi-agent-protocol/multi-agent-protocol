# Server Quickstart: MAPServer

`MAPServer` is the recommended way to create MAP-compliant servers. It wires together all building blocks with sensible defaults while providing access to everything for advanced use cases.

## Basic Usage

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";

const server = new MAPServer({
  name: "MyServer",
  version: "1.0.0",
});
```

That's it! The server now has:
- EventBus for event dispatching
- AgentRegistry for agent lifecycle
- SessionManager for connection tracking
- ScopeManager for logical groupings
- SubscriptionManager for event filtering
- MessageRouter for message delivery
- All standard protocol handlers

## Accepting Connections

Use `accept()` to handle incoming connections:

```typescript
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";

// For testing with in-memory streams
const [clientStream, serverStream] = createStreamPair();
const router = server.accept(serverStream);
router.start();

// For WebSocket
wss.on("connection", (ws) => {
  const stream = websocketToStream(ws);
  const router = server.accept(stream);
  router.start();
});

// With options
server.accept(stream, {
  role: "agent",        // "client" | "agent" | "gateway"
  name: "WorkerAgent",  // Session name
  resumeToken: token,   // For reconnection
});
```

## Configuration Options

### Server Identity

```typescript
const server = new MAPServer({
  name: "ProductionServer",     // Shown in connect response
  version: "2.1.0",             // Shown in connect response
  capabilities: {               // Advertised capabilities
    subscriptions: { maxActive: 100 },
    streaming: { backpressure: true },
  },
});
```

### Custom Handlers

Add your own protocol methods:

```typescript
const server = new MAPServer({
  additionalHandlers: {
    "custom/echo": async (params, ctx) => {
      return { echo: params };
    },
    "custom/stats": async (params, ctx) => {
      return {
        agents: server.agents.list().length,
        sessions: server.sessions.list().length,
      };
    },
  },
});
```

### Middleware

Add request/response middleware:

```typescript
const server = new MAPServer({
  middleware: [
    // Logging middleware
    async (method, params, ctx, next) => {
      console.log(`[${ctx.requestId}] ${method}`);
      const start = Date.now();
      const result = await next();
      console.log(`[${ctx.requestId}] ${method} took ${Date.now() - start}ms`);
      return result;
    },

    // Auth middleware
    async (method, params, ctx, next) => {
      if (method.startsWith("admin/") && ctx.session.role !== "admin") {
        throw new Error("Unauthorized");
      }
      return next();
    },
  ],
});
```

### Event Delivery

Configure how events are delivered to subscriptions:

```typescript
const server = new MAPServer({
  eventDelivery: {
    enabled: true,  // Default: true

    // Custom filter for event delivery
    filter: (event, subscription) => {
      // Don't deliver internal events to clients
      if (event.type.startsWith("internal.")) {
        return false;
      }
      return true;
    },
  },
});
```

### Session Configuration

```typescript
const server = new MAPServer({
  resumeWindowMs: 5 * 60 * 1000,  // 5 minutes (default)
});
```

## Accessing Building Blocks

All building blocks are accessible for direct manipulation:

```typescript
// Direct agent registration (bypassing protocol)
const agent = server.agents.register({
  name: "SystemAgent",
  sessionId: "internal",
  role: "system",
});

// Direct scope creation
const scope = server.scopes.create({
  name: "global",
  metadata: { description: "Global announcement channel" },
});

// Direct session management
const sessions = server.sessions.list({ status: "connected" });

// Direct event emission
server.emit({
  type: "system.started",
  data: { timestamp: Date.now() },
});

// Event subscription
server.on("agent.registered", (event) => {
  console.log(`New agent: ${event.data.agent.name}`);
});
```

## Connection Tracking

Track active connections:

```typescript
// Get all active connections
console.log(`Active connections: ${server.connections.size}`);

// Iterate connections
for (const [id, router] of server.connections) {
  console.log(`Connection ${id}: ${router.session.role}`);
}
```

## Graceful Shutdown

```typescript
// Graceful shutdown (default 5s timeout)
await server.close();

// Custom timeout
await server.close({ timeout: 10000 });

// Force close (no waiting)
await server.close({ force: true });
```

## Custom Storage

Use custom stores for persistence:

```typescript
import { MAPServer, InMemoryEventStore } from "@multi-agent-protocol/sdk/server";

const server = new MAPServer({
  stores: {
    events: new RedisEventStore(redis),
    agents: new PostgresAgentStore(db),
    sessions: new RedisSessionStore(redis),
    scopes: new PostgresScopeStore(db),
    subscriptions: new InMemorySubscriptionStore(), // Default
    messages: new RabbitMQMessageStore(channel),
  },
});
```

Each store interface is defined in the server types:

```typescript
interface EventStore {
  append(event: MAPEvent): void;
  getAfter(afterId: string, limit?: number): MAPEvent[];
  getByType(type: string, limit?: number): MAPEvent[];
  clear(): void;
}

interface AgentStore {
  save(agent: RegisteredAgent): void;
  get(id: string): RegisteredAgent | undefined;
  list(filter?: AgentFilter): RegisteredAgent[];
  delete(id: string): boolean;
  clear(): void;
}
```

## Replacing Building Blocks

For full control, replace entire building blocks:

```typescript
import {
  MAPServer,
  EventBusImpl,
  AgentRegistryImpl,
} from "@multi-agent-protocol/sdk/server";

// Custom EventBus with special behavior
const customEventBus = new EventBusImpl({
  store: new RedisEventStore(redis),
});

// Custom AgentRegistry
const customAgents = new AgentRegistryImpl({
  eventBus: customEventBus,
  store: new PostgresAgentStore(db),
});

const server = new MAPServer({
  eventBus: customEventBus,
  agents: customAgents,
  // Other blocks will use the custom eventBus
});
```

## Complete Example

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";

// Create server with common configuration
const server = new MAPServer({
  name: "ProductionServer",
  version: "1.0.0",

  // Add custom methods
  additionalHandlers: {
    "stats/overview": async () => ({
      agents: server.agents.list().length,
      scopes: server.scopes.list().length,
      connections: server.connections.size,
    }),
  },

  // Add logging
  middleware: [
    async (method, params, ctx, next) => {
      console.log(`${ctx.session.id} -> ${method}`);
      return next();
    },
  ],

  // Configure event delivery
  eventDelivery: {
    filter: (event) => !event.type.startsWith("internal."),
  },
});

// Listen for system events
server.on("agent.registered", (event) => {
  console.log(`Agent registered: ${event.data.agent.name}`);
});

server.on("session.connected", (event) => {
  console.log(`Session connected: ${event.data.session.id}`);
});

// WebSocket server
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws, req) => {
  const stream = websocketToStream(ws);
  const router = server.accept(stream);
  router.start();

  ws.on("close", () => {
    console.log("Connection closed");
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await server.close();
  wss.close();
  process.exit(0);
});

console.log("Server listening on ws://localhost:8080");
```

## Next Steps

- **[Server Advanced](./server-advanced.md)** - Use building blocks directly for custom implementations
- **[Transports](./transports.md)** - Use different transports beyond WebSocket
- **[Testing](./testing.md)** - Test your server implementation
