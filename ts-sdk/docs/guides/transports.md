# Transports Guide

MAP SDK uses a stream abstraction that works with any bidirectional transport. This guide covers WebSocket, Node.js streams, and custom transport adapters.

## Stream Interface

All MAP connections use this interface:

```typescript
interface Stream {
  readable: ReadableStream<AnyMessage>;
  writable: WritableStream<AnyMessage>;
}
```

Messages are JSON objects. The transport handles serialization/deserialization.

## WebSocket Transport

The most common transport for web applications and network communication.

### Server-Side (Node.js with ws)

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer, WebSocket } from "ws";

const server = new MAPServer({ name: "WSServer" });
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
          try {
            const message = JSON.parse(data.toString());
            controller.enqueue(message);
          } catch (err) {
            controller.error(err);
          }
        });
        ws.on("close", () => controller.close());
        ws.on("error", (err) => controller.error(err));
      },
    }),
    writable: new WritableStream({
      write(message) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      },
      close() {
        ws.close();
      },
    }),
  };
}
```

### Client-Side (Browser)

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";

async function connectBrowser() {
  const ws = new WebSocket("ws://localhost:8080");

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = reject;
  });

  const stream = browserWebsocketToStream(ws);
  const client = new ClientConnection(stream, { name: "BrowserClient" });
  await client.connect();

  return client;
}

function browserWebsocketToStream(ws: WebSocket): Stream {
  return {
    readable: new ReadableStream({
      start(controller) {
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            controller.enqueue(message);
          } catch (err) {
            controller.error(err);
          }
        };
        ws.onclose = () => controller.close();
        ws.onerror = (err) => controller.error(err);
      },
    }),
    writable: new WritableStream({
      write(message) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      },
      close() {
        ws.close();
      },
    }),
  };
}
```

### Client-Side (Node.js)

```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";
import WebSocket from "ws";

async function connectNode() {
  const ws = new WebSocket("ws://localhost:8080");

  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  const stream = websocketToStream(ws);
  const agent = new AgentConnection(stream, {
    name: "NodeAgent",
    role: "worker",
  });

  await agent.connect();
  return agent;
}
```

## Node.js Streams (stdio)

Use stdio for subprocess communication, CLI tools, or pipe-based IPC.

### Parent Process (Server)

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { spawn } from "child_process";

const server = new MAPServer({ name: "ParentServer" });

// Spawn child process
const child = spawn("node", ["agent.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

// Convert stdio to stream
const stream = stdioToStream(child.stdin!, child.stdout!);
server.accept(stream).start();

function stdioToStream(
  stdin: NodeJS.WritableStream,
  stdout: NodeJS.ReadableStream
): Stream {
  let buffer = "";

  return {
    readable: new ReadableStream({
      start(controller) {
        stdout.on("data", (chunk) => {
          buffer += chunk.toString();

          // Parse newline-delimited JSON
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim()) {
              try {
                controller.enqueue(JSON.parse(line));
              } catch (err) {
                console.error("Parse error:", err);
              }
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
  console.error("Received:", message.payload); // Log to stderr, not stdout
});

function stdioToStream(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream
): Stream {
  let buffer = "";

  return {
    readable: new ReadableStream({
      start(controller) {
        stdin.setEncoding("utf8");
        stdin.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim()) {
              controller.enqueue(JSON.parse(line));
            }
          }
        });
        stdin.on("end", () => controller.close());
      },
    }),
    writable: new WritableStream({
      write(message) {
        stdout.write(JSON.stringify(message) + "\n");
      },
    }),
  };
}
```

## In-Memory Streams (Testing)

For testing, use `createStreamPair()`:

```typescript
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { ClientConnection } from "@multi-agent-protocol/sdk";

// Create connected stream pair
const [clientStream, serverStream] = createStreamPair();

// Server side
const server = new MAPServer({ name: "TestServer" });
server.accept(serverStream).start();

// Client side
const client = new ClientConnection(clientStream, { name: "TestClient" });
await client.connect();

// Now client and server are connected in-memory
```

## Custom Transport Adapters

Create adapters for any transport.

### HTTP Long-Polling

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import express from "express";

const server = new MAPServer({ name: "HTTPServer" });
const sessions = new Map<string, {
  stream: Stream;
  pending: any[];
  waiting: ((messages: any[]) => void) | null;
}>();

const app = express();
app.use(express.json());

// Create session
app.post("/connect", (req, res) => {
  const sessionId = crypto.randomUUID();

  const state = {
    pending: [] as any[],
    waiting: null as ((messages: any[]) => void) | null,
  };

  const stream: Stream = {
    readable: new ReadableStream({
      // Messages come from POST /send
    }),
    writable: new WritableStream({
      write(message) {
        if (state.waiting) {
          state.waiting([message]);
          state.waiting = null;
        } else {
          state.pending.push(message);
        }
      },
    }),
  };

  sessions.set(sessionId, { stream, ...state });
  server.accept(stream).start();

  res.json({ sessionId });
});

// Long-poll for messages
app.get("/poll/:sessionId", async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (session.pending.length > 0) {
    const messages = session.pending.splice(0);
    return res.json({ messages });
  }

  // Wait for messages (with timeout)
  const messages = await Promise.race([
    new Promise<any[]>((resolve) => {
      session.waiting = resolve;
    }),
    new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 30000)),
  ]);

  res.json({ messages });
});

// Send message
app.post("/send/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Push message to readable stream
  // (Implementation depends on how you set up the readable side)

  res.json({ ok: true });
});

app.listen(3000);
```

### Message Queue (Redis Pub/Sub)

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import Redis from "ioredis";

const server = new MAPServer({ name: "RedisServer" });

function createRedisStream(
  publisher: Redis,
  subscriber: Redis,
  channelIn: string,
  channelOut: string
): Stream {
  return {
    readable: new ReadableStream({
      start(controller) {
        subscriber.subscribe(channelIn);
        subscriber.on("message", (channel, message) => {
          if (channel === channelIn) {
            controller.enqueue(JSON.parse(message));
          }
        });
      },
    }),
    writable: new WritableStream({
      write(message) {
        publisher.publish(channelOut, JSON.stringify(message));
      },
    }),
  };
}

// Server listens on one channel, publishes to another
const pub = new Redis();
const sub = new Redis();

const stream = createRedisStream(pub, sub, "client-to-server", "server-to-client");
server.accept(stream).start();
```

### Unix Domain Socket

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import net from "net";

const server = new MAPServer({ name: "UnixServer" });

const unixServer = net.createServer((socket) => {
  const stream = socketToStream(socket);
  server.accept(stream).start();
});

unixServer.listen("/tmp/map.sock");

function socketToStream(socket: net.Socket): Stream {
  let buffer = "";

  return {
    readable: new ReadableStream({
      start(controller) {
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim()) {
              controller.enqueue(JSON.parse(line));
            }
          }
        });
        socket.on("end", () => controller.close());
        socket.on("error", (err) => controller.error(err));
      },
    }),
    writable: new WritableStream({
      write(message) {
        socket.write(JSON.stringify(message) + "\n");
      },
      close() {
        socket.end();
      },
    }),
  };
}
```

## Transport Adapter Checklist

When creating a custom transport:

1. **Message framing**: How are JSON messages delimited? (newlines, length prefix, etc.)
2. **Error handling**: What happens on parse errors? Connection drops?
3. **Backpressure**: Can the writable signal when it's overwhelmed?
4. **Cleanup**: How are resources released on close?
5. **Reconnection**: How does the client reconnect? (May be transport-specific)

## Message Framing Options

### Newline-Delimited JSON (NDJSON)

```typescript
// Each message is one line
{"jsonrpc":"2.0","method":"map/connect","id":1}
{"jsonrpc":"2.0","result":{"sessionId":"..."},"id":1}
```

Pros: Simple, streamable, debuggable
Cons: Messages can't contain newlines (must escape)

### Length-Prefixed

```typescript
// 4-byte length prefix + JSON
[0x00, 0x00, 0x00, 0x42] + {"jsonrpc":"2.0",...}
```

Pros: Binary-safe, no escaping needed
Cons: More complex parsing

### WebSocket Frames

WebSocket handles framing automatically - each `send()` is one message.

## Best Practices

1. **Use WebSocket** for most network scenarios
2. **Use stdio** for subprocess agents
3. **Use in-memory streams** for testing
4. **Handle reconnection** at the transport level
5. **Log transport errors** for debugging
6. **Test with slow/lossy connections** for production readiness

## Next Steps

- **[Testing](./testing.md)** - Test your transport adapters
- **[Server Quickstart](./server-quickstart.md)** - Server setup
- **[Agent Integration](./agent-integration.md)** - Agent setup
