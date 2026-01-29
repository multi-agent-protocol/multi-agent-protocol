# @multi-agent-protocol/sdk

TypeScript SDK for the Multi-Agent Protocol (MAP) - a JSON-RPC based protocol for observing, coordinating, and routing messages within multi-agent AI systems.

## Installation

```bash
npm install @multi-agent-protocol/sdk
```

## Features

### Connection Types

The SDK provides specialized connection classes for different participant types:

- **`ClientConnection`** - For external clients observing and interacting with agents
- **`AgentConnection`** - For agents participating in the system
- **`GatewayConnection`** - For federation between MAP systems

```typescript
import { ClientConnection, AgentConnection, GatewayConnection } from '@multi-agent-protocol/sdk';
```

### Streaming & Subscriptions

Subscribe to real-time events with full backpressure support:

```typescript
const client = new ClientConnection(stream, { name: 'My Client' });
await client.connect();

// Subscribe to events
const subscription = await client.subscribe({
  eventTypes: ['agent.registered', 'agent.state.changed'],
  agents: ['agent-1', 'agent-2'],
});

// Async iteration
for await (const event of subscription) {
  console.log(event.type, event.data);
}

// Pause/resume for backpressure
subscription.pause();
// ... process batch
subscription.resume();

// Acknowledge events (if server supports)
if (subscription.supportsAck) {
  subscription.ack();
}
```

### Auto-Reconnection

Built-in reconnection with exponential backoff:

```typescript
const client = new ClientConnection(stream, {
  name: 'My Client',
  reconnection: {
    enabled: true,
    maxRetries: 10,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    jitter: true,
  },
  createStream: async () => createNewWebSocketStream(),
});

client.onReconnection((event) => {
  switch (event.type) {
    case 'disconnected':
      console.log('Connection lost');
      break;
    case 'reconnecting':
      console.log(`Reconnecting (attempt ${event.attempt})`);
      break;
    case 'reconnected':
      console.log('Reconnected successfully');
      break;
    case 'subscriptionRestored':
      console.log(`Subscription restored, replayed ${event.replayedCount} events`);
      break;
  }
});
```

### Permissions

4-layer permission system for fine-grained access control:

```typescript
import { 
  canSeeAgent, 
  canMessageAgent, 
  filterVisibleAgents,
  resolveAgentPermissions 
} from '@multi-agent-protocol/sdk';

// Check if a participant can see an agent
const canSee = canSeeAgent(systemConfig, callerAgent, targetAgent);

// Filter agents by visibility
const visibleAgents = filterVisibleAgents(allAgents, permissionContext);

// Resolve effective permissions for an agent
const permissions = resolveAgentPermissions(agent, permissionConfig);
```

### Federation

Connect multiple MAP systems with envelope-based routing:

```typescript
import { GatewayConnection, createFederationEnvelope } from '@multi-agent-protocol/sdk';

const gateway = new GatewayConnection(stream, {
  name: 'Federation Gateway',
  routing: {
    systemId: 'system-a',
    maxHops: 10,
    trackPath: true,
  },
  buffer: {
    enabled: true,
    maxMessages: 1000,
  },
});

await gateway.connect();

// Route message to another system
const message = { id: 'msg-1', to: { agent: 'remote-agent' }, payload: { ... } };
await gateway.routeToSystem('system-b', message);
```

### Causal Event Ordering

Buffer and release events in causal order:

```typescript
import { CausalEventBuffer } from '@multi-agent-protocol/sdk';

const buffer = new CausalEventBuffer({
  maxSize: 1000,
  timeoutMs: 5000,
});

// Events are released only when their dependencies are satisfied
buffer.on('ready', (event) => {
  processEvent(event);
});

buffer.add(event); // Buffered until causedBy dependencies are released
```

## Testing

The SDK includes a `TestServer` for integration testing:

```typescript
import { TestServer } from '@multi-agent-protocol/sdk/testing';
import { ClientConnection } from '@multi-agent-protocol/sdk';
import { createStreamPair } from '@multi-agent-protocol/sdk';

const server = new TestServer({ name: 'Test Server' });
const [clientStream, serverStream] = createStreamPair();

server.acceptConnection(serverStream);
const client = new ClientConnection(clientStream, { name: 'Test Client' });

await client.connect();
// ... run tests
```

## API Reference

### Connection Classes

| Class | Description |
|-------|-------------|
| `BaseConnection` | Low-level JSON-RPC connection with request/response correlation |
| `ClientConnection` | Client participant with subscribe, query, and messaging methods |
| `AgentConnection` | Agent participant with registration, scope, and message handling |
| `GatewayConnection` | Federation gateway with routing and buffering |

### Key Methods

**ClientConnection:**
- `connect()` / `disconnect()` - Lifecycle management
- `subscribe(filter?)` - Subscribe to event stream
- `replay(options)` - Replay historical events
- `send(to, payload)` - Send messages
- `listAgents()` / `getAgent(id)` - Query agents
- `listScopes()` - Query scopes

**AgentConnection:**
- `register(options)` - Register agent
- `joinScope(scopeId)` / `leaveScope(scopeId)` - Scope membership
- `onMessage(handler)` - Handle incoming messages
- `updateState(state)` - Update agent state

**Subscription:**
- `pause()` / `resume()` - Flow control
- `ack(sequenceNumber?)` - Acknowledge events
- `close()` - End subscription
- Async iterable - `for await (const event of subscription)`

### Event Types

```typescript
type EventType =
  | 'agent.registered'
  | 'agent.unregistered'
  | 'agent.state.changed'
  | 'scope.created'
  | 'scope.joined'
  | 'scope.left'
  | 'message.sent'
  | 'message.delivered'
  | 'permissions.client.updated'
  | 'permissions.agent.updated'
  // ... and more
```

## Protocol Methods

The SDK implements the full MAP wire protocol:

| Category | Methods |
|----------|---------|
| Core | `map/connect`, `map/disconnect`, `map/send`, `map/subscribe`, `map/unsubscribe`, `map/replay` |
| Observation | `map/agents/list`, `map/agents/get`, `map/scopes/list`, `map/structure/graph` |
| Lifecycle | `map/agents/register`, `map/agents/unregister`, `map/agents/spawn` |
| State | `map/agents/update`, `map/agents/stop`, `map/agents/suspend`, `map/agents/resume` |
| Scope | `map/scopes/create`, `map/scopes/join`, `map/scopes/leave` |
| Federation | `map/federation/connect`, `map/federation/route` |

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (for development)

## License

MIT
