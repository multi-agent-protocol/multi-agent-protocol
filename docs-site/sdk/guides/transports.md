---
title: Transports
parent: Guides
grand_parent: SDK
nav_order: 4
description: "WebSocket, stdio, and custom transport adapters"
---

# Transports
{: .no_toc }

Connect via WebSocket, stdio, or custom transports.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

MAP is transport-agnostic. The SDK provides adapters for common transports and interfaces for building custom ones.

---

## Stream Interface

All transports implement the bidirectional stream interface:

```typescript
interface Stream {
  readable: ReadableStream<JSONRPCMessage>;
  writable: WritableStream<JSONRPCMessage>;
}
```

---

## WebSocket Transport

The most common transport for remote connections.

### Server Side

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";

const server = new MAPServer({ name: "MyServer" });
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws) => {
  const stream = websocketToStream(ws);
  server.accept(stream).start();
});

function websocketToStream(ws: WebSocket): Stream {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.on("message", (data) => {
          controller.enqueue(JSON.parse(data.toString()));
        });
        ws.on("close", () => controller.close());
        ws.on("error", (err) => controller.error(err));
      },
    }),
    writable: new WritableStream({
      write(message) {
        ws.send(JSON.stringify(message));
      },
      close() {
        ws.close();
      },
    }),
  };
}
```

### Client Side

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080");
await new Promise((resolve) => ws.on("open", resolve));

const stream = websocketToStream(ws);
const client = new ClientConnection(stream, { name: "Dashboard" });
await client.connect();
```

---

## Stdio Transport

For subprocess agents (like Claude Code's Task tool pattern).

### Parent Process (Server)

```typescript
import { spawn } from "child_process";
import { MAPServer } from "@multi-agent-protocol/sdk/server";

const server = new MAPServer({ name: "ParentServer" });

// Spawn child agent process
const child = spawn("node", ["agent.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

const stream = stdioToStream(child.stdin, child.stdout);
server.accept(stream).start();

function stdioToStream(stdin: Writable, stdout: Readable): Stream {
  let buffer = "";

  return {
    readable: new ReadableStream({
      start(controller) {
        stdout.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim()) {
              controller.enqueue(JSON.parse(line));
            }
          }
        });
        stdout.on("end", () => controller.close());
        stdout.on("error", (err) => controller.error(err));
      },
    }),
    writable: new WritableStream({
      write(message) {
        stdin.write(JSON.stringify(message) + "\n");
      },
      close() {
        stdin.end();
      },
    }),
  };
}
```

### Child Process (Agent)

```typescript
// agent.js
import { AgentConnection } from "@multi-agent-protocol/sdk";

const stream = stdioToStream(process.stdin, process.stdout);
const agent = new AgentConnection(stream, {
  name: "ChildAgent",
  role: "worker",
});

await agent.connect();

agent.onMessage((message) => {
  // Process messages from parent
});
```

---

## In-Process Transport

For testing or co-located components.

```typescript
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { ClientConnection } from "@multi-agent-protocol/sdk";

// Create a connected pair of streams
const [clientStream, serverStream] = createStreamPair();

// Server uses one end
const server = new MAPServer({ name: "TestServer" });
server.accept(serverStream).start();

// Client uses the other end
const client = new ClientConnection(clientStream, { name: "TestClient" });
await client.connect();
```

---

## HTTP + SSE Transport

For stateless clients and environments that don't support WebSockets.

### Server Side

```typescript
import express from "express";
import { MAPServer } from "@multi-agent-protocol/sdk/server";

const app = express();
const server = new MAPServer({ name: "HTTPServer" });

// Store active SSE connections
const sseConnections = new Map<string, Response>();

// RPC endpoint
app.post("/map/rpc", express.json(), async (req, res) => {
  const sessionId = req.headers["x-session-id"] as string;
  const result = await server.handleRequest(req.body, sessionId);
  res.json(result);
});

// SSE endpoint for events
app.get("/map/events", (req, res) => {
  const sessionId = req.query.sessionId as string;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  sseConnections.set(sessionId, res);

  req.on("close", () => {
    sseConnections.delete(sessionId);
  });
});

// Deliver events via SSE
server.on("*", (event) => {
  for (const [sessionId, res] of sseConnections) {
    res.write(`event: map.event\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
});

app.listen(8080);
```

### Client Side

```typescript
function httpToStream(baseUrl: string, sessionId: string): Stream {
  const eventSource = new EventSource(
    `${baseUrl}/map/events?sessionId=${sessionId}`
  );

  return {
    readable: new ReadableStream({
      start(controller) {
        eventSource.addEventListener("map.event", (e) => {
          controller.enqueue(JSON.parse(e.data));
        });
        eventSource.onerror = () => controller.close();
      },
    }),
    writable: new WritableStream({
      async write(message) {
        await fetch(`${baseUrl}/map/rpc`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Id": sessionId,
          },
          body: JSON.stringify(message),
        });
      },
    }),
  };
}
```

---

## Custom Transports

Implement any transport by providing a Stream:

```typescript
interface CustomTransportOptions {
  // Your transport-specific options
}

function createCustomTransport(options: CustomTransportOptions): Stream {
  return {
    readable: new ReadableStream({
      start(controller) {
        // Set up your transport's incoming message handling
        // Call controller.enqueue(message) for each message
        // Call controller.close() when connection ends
        // Call controller.error(err) on errors
      },
    }),
    writable: new WritableStream({
      write(message) {
        // Send message over your transport
      },
      close() {
        // Clean up your transport
      },
    }),
  };
}
```

### Example: Redis Pub/Sub Transport

```typescript
import Redis from "ioredis";

function redisToStream(channelIn: string, channelOut: string): Stream {
  const subscriber = new Redis();
  const publisher = new Redis();

  return {
    readable: new ReadableStream({
      async start(controller) {
        await subscriber.subscribe(channelIn);
        subscriber.on("message", (channel, data) => {
          if (channel === channelIn) {
            controller.enqueue(JSON.parse(data));
          }
        });
      },
      cancel() {
        subscriber.unsubscribe(channelIn);
        subscriber.quit();
      },
    }),
    writable: new WritableStream({
      write(message) {
        publisher.publish(channelOut, JSON.stringify(message));
      },
      close() {
        publisher.quit();
      },
    }),
  };
}
```

---

## Transport Selection Guide

| Transport | Use Case | Pros | Cons |
|:----------|:---------|:-----|:-----|
| **WebSocket** | Remote clients, browsers | Bidirectional, real-time | Requires WS support |
| **stdio** | Subprocess agents | Simple, no network | Local only |
| **In-process** | Testing, co-located | Zero latency | Same process only |
| **HTTP + SSE** | Serverless, restricted envs | Works everywhere | Higher latency |

---

## Next Steps

- [Server Setup](./server.html) - Configure your server
- [Testing](./testing.html) - Use in-process transport for tests
