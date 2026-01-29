# Multi-Agent Protocol (MAP)

A JSON-RPC based protocol for observing, coordinating, and routing messages within multi-agent AI systems.

## Overview

Unlike protocols designed for single-agent interaction (ACP) or peer-to-peer agent delegation (A2A), MAP provides a **window into** a multi-agent system with visibility into its internal structure, agent relationships, and message flows.

MAP provides a standardized way for:
- **Clients** to observe and interact with agent systems (with configurable visibility)
- **Agents** to communicate, form hierarchies, and join scopes
- **Systems** to federate and route messages across boundaries

### Protocol Landscape

| Protocol | Relationship | Visibility | Primary Use |
|----------|--------------|------------|-------------|
| MCP | Agent → Tool | N/A | Tool invocation |
| ACP | Client → Agent | Opaque | Single-agent sessions |
| A2A | Agent → Agent (peer) | Opaque | Cross-org delegation |
| **MAP** | Client → System | Transparent | Internal orchestration |

## Packages

| Package | Description |
|---------|-------------|
| [@anthropic/map-sdk](./ts-sdk) | TypeScript SDK for MAP |

## Quick Start

```bash
npm install @anthropic/map-sdk
```

```typescript
import { ClientConnection, createStreamPair } from '@anthropic/map-sdk';

// Connect to a MAP server
const client = new ClientConnection(stream, { name: 'My Client' });
await client.connect();

// Subscribe to events
const subscription = await client.subscribe({
  eventTypes: ['agent.registered', 'agent.state.changed'],
});

for await (const event of subscription) {
  console.log(event.type, event.data);
}
```

## Features

- **Real-time streaming** - Subscribe to events with backpressure support
- **Auto-reconnection** - Exponential backoff with subscription restoration
- **Permission system** - 4-layer access control (system, participant, scope, agent)
- **Federation** - Connect multiple MAP systems with envelope-based routing
- **Causal ordering** - Events released in dependency order

## Documentation

### Schema

The protocol schema is defined in [`schema/`](./schema/):
- [`schema.json`](./schema/schema.json) - Complete JSON Schema for all MAP message types
- [`meta.json`](./schema/meta.json) - Method metadata, tiers, and error codes

## Repository Structure

```
multi-agent-protocol/
├── docs/                   # Design specifications
├── schema/                 # JSON Schema and metadata
│   ├── schema.json         # Protocol message schemas
│   └── meta.json           # Method tiers and error codes
├── ts-sdk/                 # TypeScript SDK implementation
│   ├── src/                # Source code
│   └── docs/               # SDK-specific docs (gap analysis)
└── references/             # Reference implementations
    ├── agent-client-protocol/  # ACP reference
    ├── macro-agent/            # Multi-agent orchestration reference
    └── typescript-sdk/         # Additional TS reference
```

## Development

```bash
# Install dependencies
npm install

# Build SDK
npm run build -w ts-sdk

# Run tests
npm test -w ts-sdk

# Type check
npm run typecheck -w ts-sdk
```

## Protocol Methods

The protocol defines 27 methods across three tiers:

**Core (Required):** `map/connect`, `map/disconnect`, `map/send`, `map/subscribe`, `map/unsubscribe`, `map/agents/list`, `map/agents/get`

**Structure (Recommended):** Agent lifecycle (`register`, `spawn`, `unregister`, `update`, `stop`, `suspend`, `resume`), scope management (`scopes/create`, `join`, `leave`), and structure queries

**Extensions (Optional):** Federation (`federation/connect`, `federation/route`), session management, and steering (`map/inject`)

## License

MIT
