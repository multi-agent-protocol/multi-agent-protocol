---
title: Testing
parent: Guides
grand_parent: SDK
nav_order: 6
description: "Test your MAP integrations"
---

# Testing
{: .no_toc }

Test your MAP integrations effectively.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

The SDK provides utilities for testing MAP integrations without network overhead.

---

## In-Memory Testing

Use `createStreamPair()` to create connected streams for testing:

```typescript
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { ClientConnection, AgentConnection } from "@multi-agent-protocol/sdk";

describe("MAP Integration", () => {
  let server: MAPServer;

  beforeEach(() => {
    server = new MAPServer({ name: "TestServer" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("should connect a client", async () => {
    const [clientStream, serverStream] = createStreamPair();
    server.accept(serverStream).start();

    const client = new ClientConnection(clientStream, { name: "TestClient" });
    const result = await client.connect();

    expect(result.sessionId).toBeDefined();
    expect(result.systemInfo?.name).toBe("TestServer");

    await client.disconnect();
  });
});
```

---

## Testing Agents

```typescript
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { AgentConnection } from "@multi-agent-protocol/sdk";

describe("Agent", () => {
  let server: MAPServer;

  beforeEach(() => {
    server = new MAPServer({ name: "TestServer" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("should register an agent", async () => {
    const [agentStream, serverStream] = createStreamPair();
    server.accept(serverStream).start();

    const agent = new AgentConnection(agentStream, {
      name: "TestAgent",
      role: "worker",
    });

    const { agent: registered } = await agent.connect();

    expect(registered.id).toBeDefined();
    expect(registered.name).toBe("TestAgent");
    expect(registered.role).toBe("worker");

    // Verify agent is in registry
    const agents = server.agents.list();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("TestAgent");

    await agent.disconnect();
  });

  it("should handle messages", async () => {
    const [agentStream, serverStream] = createStreamPair();
    server.accept(serverStream).start();

    const agent = new AgentConnection(agentStream, {
      name: "TestAgent",
      role: "worker",
    });

    const receivedMessages: any[] = [];
    agent.onMessage((message) => {
      receivedMessages.push(message);
    });

    await agent.connect();

    // Send message directly through server
    server.messages.send({
      to: { agentId: agent.id },
      payload: { type: "test", data: "hello" },
    });

    // Wait for message delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].payload.type).toBe("test");

    await agent.disconnect();
  });
});
```

---

## Testing Client Subscriptions

```typescript
describe("Client Subscriptions", () => {
  let server: MAPServer;

  beforeEach(() => {
    server = new MAPServer({ name: "TestServer" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("should receive events", async () => {
    const [clientStream, serverStream] = createStreamPair();
    server.accept(serverStream).start();

    const client = new ClientConnection(clientStream, { name: "TestClient" });
    await client.connect();

    // Subscribe to agent events
    const subscription = await client.subscribe({
      eventTypes: ["agent.registered"],
    });

    // Collect events
    const events: any[] = [];
    const eventPromise = (async () => {
      for await (const event of subscription) {
        events.push(event);
        if (events.length >= 1) break;
      }
    })();

    // Register an agent
    const [agentStream, agentServerStream] = createStreamPair();
    server.accept(agentServerStream).start();
    const agent = new AgentConnection(agentStream, { name: "NewAgent" });
    await agent.connect();

    // Wait for event
    await eventPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("agent.registered");
    expect(events[0].data.agent.name).toBe("NewAgent");

    await subscription.unsubscribe();
    await agent.disconnect();
    await client.disconnect();
  });
});
```

---

## Testing Agent-to-Agent Messaging

```typescript
describe("Agent Messaging", () => {
  let server: MAPServer;

  beforeEach(() => {
    server = new MAPServer({ name: "TestServer" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("should send messages between agents", async () => {
    // Create two agents
    const [stream1, serverStream1] = createStreamPair();
    const [stream2, serverStream2] = createStreamPair();
    server.accept(serverStream1).start();
    server.accept(serverStream2).start();

    const agent1 = new AgentConnection(stream1, { name: "Agent1" });
    const agent2 = new AgentConnection(stream2, { name: "Agent2" });

    const agent2Messages: any[] = [];
    agent2.onMessage((message) => {
      agent2Messages.push(message);
    });

    const { agent: registered1 } = await agent1.connect();
    const { agent: registered2 } = await agent2.connect();

    // Agent1 sends to Agent2
    await agent1.send({
      to: { agentId: registered2.id },
      payload: { type: "greeting", message: "Hello from Agent1" },
    });

    // Wait for delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(agent2Messages).toHaveLength(1);
    expect(agent2Messages[0].payload.message).toBe("Hello from Agent1");
    expect(agent2Messages[0].from).toBe(registered1.id);

    await agent1.disconnect();
    await agent2.disconnect();
  });
});
```

---

## Testing Scopes

```typescript
describe("Scopes", () => {
  let server: MAPServer;

  beforeEach(() => {
    server = new MAPServer({ name: "TestServer" });
  });

  afterEach(async () => {
    await server.close();
  });

  it("should broadcast to scope members", async () => {
    // Create three agents
    const connections = await Promise.all([
      createAgent(server, "Agent1"),
      createAgent(server, "Agent2"),
      createAgent(server, "Agent3"),
    ]);

    const [agent1, agent2, agent3] = connections;

    // Collect messages for agents 2 and 3
    const messages2: any[] = [];
    const messages3: any[] = [];
    agent2.conn.onMessage((m) => messages2.push(m));
    agent3.conn.onMessage((m) => messages3.push(m));

    // Agent1 creates scope
    const scope = await agent1.conn.createScope({ name: "team" });

    // Agent2 joins, Agent3 doesn't
    await agent2.conn.joinScope(scope.id);

    // Agent1 broadcasts to scope
    await agent1.conn.send({
      to: { scopeId: scope.id },
      payload: { type: "announcement", text: "Team meeting!" },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Only Agent2 (scope member) receives the message
    expect(messages2).toHaveLength(1);
    expect(messages3).toHaveLength(0);

    // Cleanup
    for (const { conn } of connections) {
      await conn.disconnect();
    }
  });
});

async function createAgent(server: MAPServer, name: string) {
  const [stream, serverStream] = createStreamPair();
  server.accept(serverStream).start();
  const conn = new AgentConnection(stream, { name });
  const { agent } = await conn.connect();
  return { conn, agent };
}
```

---

## Test Utilities

### Helper for Multiple Connections

```typescript
class TestHarness {
  server: MAPServer;
  connections: Array<{
    stream: Stream;
    client?: ClientConnection;
    agent?: AgentConnection;
  }> = [];

  constructor() {
    this.server = new MAPServer({ name: "TestServer" });
  }

  async createClient(name: string): Promise<ClientConnection> {
    const [clientStream, serverStream] = createStreamPair();
    this.server.accept(serverStream).start();

    const client = new ClientConnection(clientStream, { name });
    await client.connect();

    this.connections.push({ stream: clientStream, client });
    return client;
  }

  async createAgent(name: string, role?: string): Promise<AgentConnection> {
    const [agentStream, serverStream] = createStreamPair();
    this.server.accept(serverStream).start();

    const agent = new AgentConnection(agentStream, { name, role });
    await agent.connect();

    this.connections.push({ stream: agentStream, agent });
    return agent;
  }

  async cleanup() {
    for (const { client, agent } of this.connections) {
      if (client) await client.disconnect().catch(() => {});
      if (agent) await agent.disconnect().catch(() => {});
    }
    await this.server.close();
  }
}

// Usage
describe("With TestHarness", () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = new TestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("should work", async () => {
    const client = await harness.createClient("TestClient");
    const agent = await harness.createAgent("TestAgent", "worker");

    const { agents } = await client.listAgents();
    expect(agents).toHaveLength(1);
  });
});
```

---

## Mocking

### Mock Event Emission

```typescript
it("should handle events", async () => {
  const harness = new TestHarness();
  const client = await harness.createClient("TestClient");

  const subscription = await client.subscribe({
    eventTypes: ["custom.event"],
  });

  const events: any[] = [];
  const eventPromise = collectEvents(subscription, events, 1);

  // Emit custom event directly
  harness.server.emit({
    type: "custom.event",
    data: { foo: "bar" },
  });

  await eventPromise;
  expect(events[0].data.foo).toBe("bar");

  await harness.cleanup();
});

async function collectEvents(
  subscription: Subscription,
  events: any[],
  count: number
) {
  for await (const event of subscription) {
    events.push(event);
    if (events.length >= count) break;
  }
}
```

---

## Best Practices

1. **Use in-memory streams** - Avoid network in unit tests
2. **Clean up connections** - Always disconnect and close server
3. **Use timeouts wisely** - Allow time for async message delivery
4. **Test error cases** - Verify error handling works correctly
5. **Isolate tests** - Fresh server instance per test
6. **Use helpers** - Create utilities for common patterns

---

## Next Steps

- [Server Setup](./server.html) - Configure test servers
- [Transports](./transports.html) - Understand transport options
