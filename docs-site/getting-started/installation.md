---
title: Installation
parent: Getting Started
nav_order: 3
description: "Install and configure the MAP SDK"
---

# Installation

Install the Multi-Agent Protocol SDK in your project.
{: .fs-6 .fw-300 }

---

## Requirements

- **Node.js 18+** - The SDK uses modern JavaScript features
- **TypeScript 5.0+** (recommended) - Full type support included

---

## Package Installation

### npm

```bash
npm install @multi-agent-protocol/sdk
```

### yarn

```bash
yarn add @multi-agent-protocol/sdk
```

### pnpm

```bash
pnpm add @multi-agent-protocol/sdk
```

---

## Package Exports

The SDK provides multiple entry points:

```typescript
// Main exports (connections, types)
import {
  ClientConnection,
  AgentConnection,
  GatewayConnection
} from "@multi-agent-protocol/sdk";

// Server components
import { MAPServer } from "@multi-agent-protocol/sdk/server";

// Building blocks for custom servers
import {
  EventBusImpl,
  AgentRegistryImpl,
  ScopeManagerImpl,
  SubscriptionManagerImpl,
} from "@multi-agent-protocol/sdk/server";

// Type definitions
import type {
  Agent,
  Message,
  Event,
  Subscription,
} from "@multi-agent-protocol/sdk";
```

---

## TypeScript Configuration

For the best experience, use these TypeScript settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

---

## Transport Dependencies

The SDK is transport-agnostic. Install additional packages based on your needs:

### WebSocket (Browser & Node.js)

```bash
npm install ws
```

```typescript
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");
const stream = websocketToStream(ws);
```

### HTTP + Server-Sent Events

For HTTP-based transports, no additional dependencies are needed:

```typescript
// Use fetch + EventSource for HTTP transport
const stream = httpToStream("http://localhost:8080/map");
```

### Node.js Streams (stdio)

For stdio-based communication (CLI tools, child processes):

```typescript
import { stdioToStream } from "@multi-agent-protocol/sdk";

const stream = stdioToStream(process.stdin, process.stdout);
```

---

## Peer Dependencies

### Optional: agentic-mesh

For mesh networking and peer-to-peer connectivity:

```bash
npm install agentic-mesh
```

```typescript
import { MeshTransport } from "@multi-agent-protocol/sdk/mesh";

const transport = new MeshTransport({
  networkId: "my-mesh-network"
});
```

---

## Environment Configuration

### Server Configuration

```typescript
const server = new MAPServer({
  // Server identity
  name: "MyMAPServer",
  version: "1.0.0",

  // Optional: custom configuration
  maxConnections: 1000,
  heartbeatInterval: 30000,
});
```

### Connection Configuration

```typescript
const client = new ClientConnection(stream, {
  // Client identity
  name: "Dashboard",

  // Optional: reconnection settings
  reconnect: true,
  reconnectMaxAttempts: 5,
  reconnectBaseDelay: 1000,
});
```

---

## Verifying Installation

Create a simple test file to verify everything works:

```typescript
// test-install.ts
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { ClientConnection, AgentConnection } from "@multi-agent-protocol/sdk";

console.log("MAP SDK imported successfully!");

// Create a server instance
const server = new MAPServer({ name: "TestServer" });
console.log("Server created:", server);

console.log("Installation verified!");
```

Run it:

```bash
npx ts-node test-install.ts
```

---

## Next Steps

Now that you have the SDK installed:

1. **[Quickstart](./quickstart.html)** - Build your first MAP application
2. **[Server Guide](/multi-agent-protocol/sdk/guides/server.html)** - Configure your server
3. **[Examples](/multi-agent-protocol/examples/)** - See complete working examples
