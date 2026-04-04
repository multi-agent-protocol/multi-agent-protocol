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
  fromAgents: ['agent-1', 'agent-2'],
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

### Persistent Agent Identity

Agents can carry stable identities across sessions using industry-standard identity formats:

```typescript
import { AgentConnection } from '@multi-agent-protocol/sdk';

const agent = new AgentConnection(stream, { name: 'My Agent' });
await agent.connect();

// Register with a persistent identity (DID:key, SPIFFE, or DID:web)
await agent.register({
  name: 'Translator',
  role: 'translator',
  persistentIdentity: {
    persistentId: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    identityType: 'keypair',
    publicKeyJwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'base64url-encoded-public-key',
    },
    proof: {
      challenge: 'server-nonce-123',
      signature: 'ed25519-signature-bytes',
      provenAt: new Date().toISOString(),
    },
  },
});

// Resume a previously orphaned agent by persistentId
await agent.register({
  name: 'Translator',
  persistentIdentity: {
    persistentId: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    identityType: 'keypair',
  },
  resumePersistentIdentity: true,  // Resume previous agent with this identity
});
```

**Identity types supported:**
- `keypair` - Self-certifying Ed25519 (W3C DID:key format)
- `attested` - Workload attestation (CNCF SPIFFE format)
- `decentralized` - Domain-anchored (W3C DID:web format)
- `platform` - Platform-assigned UUID
- `x-*` - Custom identity types

**Server-side identity features:**
- `IdentityVerifier` hook for pluggable cryptographic verification
- `uniqueIdentity` mode to enforce one active agent per identity
- Identity inheritance through `map/agents/spawn`
- `persistentId` in credential audit events (`credential.issued`, `credential.denied`)
- Agent discovery by `persistentId` via `map/agents/list`

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

## Server SDK

Build MAP servers using the `MAPServer` class and building blocks.

### Basic Server Setup

```typescript
import { MAPServer } from '@multi-agent-protocol/sdk/server';
import { WebSocketServer } from 'ws';

// Create a MAP server
const server = new MAPServer({
  name: 'My MAP Server',
  version: '1.0.0',
});

// Accept WebSocket connections
const wss = new WebSocketServer({ port: 8080 });
wss.on('connection', (ws) => {
  const router = server.accept(ws, { role: 'client' });
  router.start();
});

console.log('MAP server listening on ws://localhost:8080');
```

### Server with Authentication

```typescript
import {
  MAPServer,
  createSimpleAPIKeyAuthenticator,
  JWTAuthenticator,
  NoAuthAuthenticator,
} from '@multi-agent-protocol/sdk/server';

const server = new MAPServer({
  name: 'Authenticated Server',
  auth: {
    required: true,
    authenticators: [
      // API key authentication
      createSimpleAPIKeyAuthenticator({
        'api-key-1': 'user-1',
        'api-key-2': 'user-2',
      }),

      // JWT authentication
      new JWTAuthenticator({
        jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
        issuer: 'https://auth.example.com',
        audience: 'my-api',
      }),

      // Allow unauthenticated for local stdio connections
      new NoAuthAuthenticator({ defaultPrincipalId: 'local-agent' }),
    ],
    // Bypass auth for trusted transports
    bypassForTransports: { stdio: true },
  },
});
```

### Server with agent-iam Authentication and Identity Verification

```typescript
import { MAPServer, AgentIAMProvider } from '@multi-agent-protocol/sdk/server';
import { TokenService } from 'agent-iam';

const tokenService = new TokenService(secret);

const server = new MAPServer({
  name: 'Identity-Aware Server',
  auth: {
    required: true,
    authenticators: [
      new AgentIAMProvider({ tokenService, systemId: 'my-system' }),
    ],
  },
  agents: {
    // Pluggable identity verification
    identityVerifier: {
      async verify(identity, context) {
        // Implement cryptographic verification (DID:key, SPIFFE, etc.)
        if (identity.identityType === 'keypair' && identity.proof) {
          const valid = await verifyEd25519Signature(identity);
          return valid ? 'verified' : 'unverified';
        }
        return 'self-declared';
      },
    },
    // Enforce one active agent per persistent identity
    uniqueIdentity: true,
  },
});
```

### Custom Handlers

Extend the server with application-specific handlers:

```typescript
import { MAPServer } from '@multi-agent-protocol/sdk/server';

const server = new MAPServer({ name: 'Custom Server' });

// Add custom handlers alongside built-in ones
const customHandlers = {
  'myapp/echo': async (params: unknown) => {
    return { echo: params };
  },

  'myapp/getStatus': async (params: unknown, ctx) => {
    // Access session context
    return {
      sessionId: ctx.session.id,
      principal: ctx.session.principal,
    };
  },
};

// Merge with server handlers when accepting connections
wss.on('connection', (ws) => {
  const router = server.accept(ws, {
    role: 'client',
    additionalHandlers: customHandlers,
  });
  router.start();
});
```

### Building Blocks

For advanced customization, use individual building blocks:

```typescript
import {
  AgentRegistryImpl,
  ScopeManagerImpl,
  SessionManagerImpl,
  SubscriptionManagerImpl,
  MessageRouterImpl,
  InMemoryAgentStore,
  InMemorySessionStore,
  InMemorySubscriptionStore,
  InMemoryScopeStore,
  createAgentHandlers,
  createSubscriptionHandlers,
  createMessageHandlers,
} from '@multi-agent-protocol/sdk/server';

// Create stores (swap with database-backed stores in production)
const agents = new AgentRegistryImpl({ store: new InMemoryAgentStore() });
const sessions = new SessionManagerImpl({ store: new InMemorySessionStore() });
const scopes = new ScopeManagerImpl({ store: new InMemoryScopeStore() });
const subscriptions = new SubscriptionManagerImpl({
  store: new InMemorySubscriptionStore(),
  scopes, // For scope hierarchy filtering
});

// Create handlers
const handlers = {
  ...createAgentHandlers({ agents, sessions }),
  ...createSubscriptionHandlers({ subscriptions, sessions }),
  ...createMessageHandlers({ agents, scopes }),
};
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

### Connection States

All connections go through these lifecycle states:

| State | Description |
|-------|-------------|
| `initial` | Connection created but not yet started |
| `connecting` | Connect handshake in progress |
| `connected` | Successfully connected and ready |
| `reconnecting` | Disconnected, attempting to reconnect |
| `closed` | Connection permanently closed |

```typescript
client.onStateChange((newState, oldState) => {
  console.log(`State changed: ${oldState} -> ${newState}`);
});
```

### Key Methods

**ClientConnection:**
- `connect()` / `disconnect()` - Lifecycle management
- `subscribe(filter?)` - Subscribe to event stream
- `replay(options)` - Replay historical events
- `send(to, payload)` - Send messages
- `listAgents()` / `getAgent(id)` - Query agents
- `listScopes()` - Query scopes
- `getResumeToken()` - Get token for session resumption
- `reconnect(token?)` - Reconnect using resume token
- `authenticate(auth)` / `refreshAuth(auth)` - Authentication

**AgentConnection:**
- `register(options)` - Register agent
- `joinScope(scopeId)` / `leaveScope(scopeId)` - Scope membership
- `onMessage(handler)` - Handle incoming messages
- `updateState(state)` - Update agent state

**Subscription:**
- `pause()` / `resume()` - Flow control
- `ack(sequenceNumber?)` - Acknowledge events (requires server support)
- `supportsAck` - Whether server advertises ack support
- `close()` - End subscription
- Async iterable - `for await (const event of subscription)`

### Event Types

Event types use dot notation (e.g., `agent.registered`). Subscription filters accept both dot notation and underscore notation for compatibility.

```typescript
type EventType =
  | 'agent.registered'
  | 'agent.unregistered'
  | 'agent.resumed'
  | 'agent.state.changed'
  | 'agent.identity.verification.failed'
  | 'credential.issued'
  | 'credential.denied'
  | 'scope.created'
  | 'scope.joined'
  | 'scope.left'
  | 'message.sent'
  | 'message.delivered'
  | 'session.started'
  | 'session.ended'
  | 'system.error'
  | 'system.shutdown'
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
