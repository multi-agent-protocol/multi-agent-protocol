---
title: Guides
parent: SDK
nav_order: 1
has_children: true
description: "SDK integration guides"
permalink: /sdk/guides/
---

# SDK Guides

Step-by-step guides for integrating with the MAP SDK.
{: .fs-6 .fw-300 }

---

## Available Guides

| Guide | Description |
|:------|:------------|
| [Server Setup](./server.html) | Create and configure a MAP server |
| [Client Integration](./client.html) | Build clients that observe and interact |
| [Agent Integration](./agent.html) | Build agents that process work |
| [Transports](./transports.html) | WebSocket, stdio, and custom transports |
| [Authentication](./authentication.html) | Configure authentication methods |
| [Testing](./testing.html) | Test your MAP integrations |

---

## Quick Start

### 1. Install the SDK

```bash
npm install @multi-agent-protocol/sdk
```

### 2. Create a Server

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";

const server = new MAPServer({ name: "MyServer" });
```

### 3. Accept Connections

```typescript
import { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });
wss.on("connection", (ws) => {
  const stream = websocketToStream(ws);
  server.accept(stream).start();
});
```

### 4. Connect an Agent

```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

const agent = new AgentConnection(stream, {
  name: "Worker",
  role: "processor"
});
await agent.connect();
```

### 5. Connect a Client

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";

const client = new ClientConnection(stream, { name: "Dashboard" });
await client.connect();
```

---

## Choosing the Right Guide

| I want to... | Start with... |
|:-------------|:--------------|
| Build a MAP server | [Server Setup](./server.html) |
| Monitor agent activity | [Client Integration](./client.html) |
| Create an AI agent | [Agent Integration](./agent.html) |
| Use stdio or HTTP | [Transports](./transports.html) |
| Add authentication | [Authentication](./authentication.html) |
| Write tests | [Testing](./testing.html) |
