# MAP SDK - Claude Context

This document provides context for Claude when working on the Multi-Agent Protocol (MAP) TypeScript SDK.

## Project Overview

The MAP SDK is a TypeScript implementation of the Multi-Agent Protocol - a JSON-RPC based protocol for observing, coordinating, and routing messages within multi-agent AI systems.

### What MAP Is (vs Other Protocols)

| Protocol | Relationship | Visibility | Primary Use |
|----------|--------------|------------|-------------|
| MCP | Agent → Tool | N/A | Tool invocation |
| ACP | Client → Agent | Opaque | Single-agent sessions |
| A2A | Agent → Agent (peer) | Opaque | Cross-org delegation |
| **MAP** | Client → System | **Transparent** | Internal orchestration |

**Key difference**: MAP treats the multi-agent system as a **transparent, observable entity** rather than an opaque black box. Clients can see internal structure and activity with appropriate permissions.

### Three Participant Types

1. **Clients** - External observers that subscribe to events and send messages
2. **Agents** - Workers that register, process messages, form hierarchies
3. **Gateways** - Federation bridges that route between MAP systems

The SDK provides connection classes, streaming subscriptions, permissions, and federation support.

## Architecture

```
ts-sdk/
├── src/
│   ├── connection/       # Connection classes (base, client, agent, gateway)
│   ├── subscription/     # Event subscription with streaming support
│   ├── federation/       # Federation envelope and buffering
│   ├── permissions/      # 4-layer permission system
│   ├── protocol/         # Method registry and response builders
│   ├── utils/            # Causal buffer, retry, ULID generation
│   ├── stream/           # Bidirectional stream abstraction
│   ├── types/            # TypeScript type definitions
│   ├── schema/           # Zod validators (auto-generated from JSON schema)
│   ├── testing/          # TestServer for integration tests
│   └── __tests__/        # Test files
├── docs/                 # SDK-specific docs (gap analysis)
└── package.json
```

## Key Components

### Connection Layer (`src/connection/`)

- **BaseConnection**: Low-level JSON-RPC over bidirectional streams
  - Request/response correlation with unique IDs
  - State machine: `initial` → `connecting` → `connected` → `reconnecting` → `closed`
  - Notification and request handlers

- **ClientConnection**: For external clients
  - Subscribe to events, query agents/scopes, send messages
  - Auto-reconnection with exponential backoff
  - Subscription restoration on reconnect with event replay

- **AgentConnection**: For agent participants
  - Agent registration and state management
  - Scope membership with restoration on reconnect
  - Message handling via `onMessage()`
  - Custom notification handling via `onNotification(method, handler)` for server-to-agent notifications
  - Raw notification sending via `sendNotification(method, params)` for agent-to-server notifications

- **GatewayConnection**: For federation
  - Route messages between MAP systems
  - Outage buffering during disconnection
  - Event replay from peers on reconnect

### Subscription System (`src/subscription/`)

- Async iterable event stream
- Configurable buffer with overflow handling
- Pause/resume for backpressure control
- Backpressure acknowledgments (`ack()`)
- Event deduplication by eventId
- Sequence number tracking for gap detection

### Permission System (`src/permissions/`)

4-layer permission resolution:
1. **System exposure** - What's visible to external systems
2. **Participant capabilities** - What operations a participant can perform
3. **Scope permissions** - Access rules within scopes
4. **Agent permissions** - Per-agent visibility and messaging rules

Key functions:
- `canSeeAgent()`, `canMessageAgent()`, `canControlAgent()`
- `canSeeScope()`, `canSendToScope()`, `canJoinScope()`
- `filterVisibleAgents()`, `filterVisibleScopes()`, `filterVisibleEvents()`
- `resolveAgentPermissions()` - Hybrid role-based + agent-level overrides

### Federation (`src/federation/`)

- **Envelope**: Wraps messages with routing metadata (source/target system, hop count, path)
- **Buffer**: Queues messages during peer outages with overflow strategies
- **Validation**: Loop detection, max hop enforcement, allowlist checking

### Causal Ordering (`src/utils/causal-buffer.ts`)

- Buffers events and releases in dependency order based on `causedBy`
- Timeout-based force release for stuck dependencies
- Overflow handling when buffer is full

### Persistent Identity (`src/types/index.ts`, `src/server/agents/`)

Agents can carry stable identities across sessions, using industry-standard formats:

- **Identity types**: `keypair` (DID:key), `attested` (SPIFFE), `decentralized` (DID:web), `platform`, `x-*` custom
- **Identity format**: `AgentPersistentIdentity` with `persistentId`, `identityType`, optional `publicKeyJwk` (JWK RFC 7517), `proof` (challenge/signature), and `endorsements` (W3C VC or legacy)
- **Verification**: `IdentityVerificationStatus` — `"verified"` | `"auth-derived"` | `"self-declared"` | `"unverified"`
- **Resumption**: `resumePersistentIdentity` flag in `map/agents/register` to resume orphaned agents by `persistentId`
- **Server hooks**: `IdentityVerifier` interface for pluggable cryptographic verification; `uniqueIdentity` server config
- **Auth integration**: `AgentIAMProvider` extracts persistent identity from agent-iam tokens
- **Credential audit**: `credential.issued` / `credential.denied` events include `persistentId`

Key types:
- `AgentPersistentIdentity`, `IdentityType`, `IdentityVerificationStatus`
- `AgentPublicKeyJwk`, `AgentIdentityProof`, `AgentEndorsement`, `AgentVerifiableCredential`
- `Endorsement` (union of legacy and W3C VC formats)
- `IdentityVerifier`, `IdentityVerificationContext` (server types)

## Protocol Methods

All methods are registered in `src/protocol/index.ts`:

| Category | Methods |
|----------|---------|
| Core | `connect`, `disconnect`, `send`, `subscribe`, `unsubscribe`, `replay` |
| Observation | `agents/list`, `agents/get`, `scopes/list`, `scopes/get`, `structure/graph` |
| Lifecycle | `agents/register`, `agents/unregister`, `agents/spawn` |
| State | `agents/update`, `agents/stop`, `agents/suspend`, `agents/resume` |
| Scope | `scopes/create`, `scopes/join`, `scopes/leave` |
| Federation | `federation/connect`, `federation/route` |
| Permissions | `permissions/update` |

## Type System

Core types in `src/types/index.ts`:
- Branded ID types: `AgentId`, `ScopeId`, `SessionId`, `SubscriptionId`, `MessageId`
- `Agent`, `Scope`, `Message`, `Event`
- `AgentPermissions`, `ParticipantCapabilities`
- `AgentPersistentIdentity`, `IdentityType`, `IdentityVerificationStatus`, `AgentPublicKeyJwk`
- `AgentEndorsement`, `AgentVerifiableCredential`, `Endorsement` (union)
- `FederationEnvelope`, `FederationRoutingConfig`
- Request/response types for all protocol methods (including `resumePersistentIdentity` on register)

## Testing

- **TestServer** (`src/testing/server.ts`): In-memory MAP server for tests
- **createStreamPair()**: Creates connected bidirectional streams
- Tests in `src/__tests__/` cover all major functionality

Run tests:
```bash
npm test                    # Watch mode
npm run test:run           # Single run
npm test -- <pattern>      # Filter by name
```

## Build

```bash
npm run build              # Build with tsup
npm run typecheck          # TypeScript check
npm run lint               # ESLint
```

## Design Documents

**Protocol specifications** are in the repository root `../docs/`:
- `00-design-specification.md` - Overall architecture and design philosophy
- `01-open-questions.md` - Outstanding design decisions
- `02-wire-protocol.md` - JSON-RPC wire format and transports
- `03-streaming-semantics.md` - Event streaming, ordering, backpressure
- `04-error-handling.md` - Error codes and handling
- `05-connection-model.md` - Connection lifecycle and state machines
- `06-visibility-permissions.md` - 4-layer permission model
- `07-federation.md` - MAP-to-MAP federation design
- `08-macro-agent-migration.md` - Migration from macro-agent

**SDK-specific docs** are in `./docs/`:
- `design-gaps.md` - Gap analysis between spec and SDK implementation

**Schema files** are in the repository root `../schema/`:
- `schema.json` - Complete JSON Schema for all MAP message types
- `meta.json` - Method metadata, tiers, and error codes

## Implementation Status

**Completed (P0/P1):**
- ✅ JSON-RPC connection with state machine
- ✅ Auto-reconnection with exponential backoff
- ✅ Event subscriptions with async iteration
- ✅ Pause/resume and backpressure acks
- ✅ Event replay with pagination
- ✅ 4-layer permission system
- ✅ Visibility filtering
- ✅ Federation envelope with routing validation
- ✅ Outage buffering for federation
- ✅ Causal event ordering
- ✅ Permission update events
- ✅ Persistent agent identity (DID:key, SPIFFE, DID:web, W3C VC, JWK)
- ✅ Agent resumption via persistentId
- ✅ Identity verification hooks
- ✅ Credential audit with persistentId

**Deferred (P2/P3):**
- Ordering modes (none/per-agent/causal/total)
- Hierarchy subscription filters
- Health checks
- Rate limiting
- ACP compatibility mode
- HTTP/SSE transport
- Batch messages

## Common Tasks

**Adding a new protocol method:**
1. Add types to `src/types/index.ts`
2. Add to `METHOD_REGISTRY` in `src/protocol/index.ts`
3. Add handler in relevant connection class
4. Add to TestServer if needed
5. Write tests

**Adding a new event type:**
1. Add to `EVENT_TYPES` constant in `src/types/index.ts`
2. Add event data interface
3. Update TestServer to emit the event
4. Update permission filters if needed

**Handling custom notifications (server → agent):**
1. Register handler: `agent.onNotification('my/method', async (params) => { ... })`
2. Respond: `agent.sendNotification('my/method.response', { ... })`
3. Declare capability so server knows to send: `capabilities: { my: { canHandle: true } }`
4. Server checks capability before sending notification to agent

**Debugging connections:**
- Check `connection.state` for current state
- Use `onStateChange()` to observe transitions
- TestServer logs to stderr for unhandled methods
