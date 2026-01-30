# Testing Guide

This guide covers testing strategies for MAP integrations, from unit tests to full integration tests.

## Testing Tools

### createStreamPair()

Create connected in-memory streams:

```typescript
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";

const [clientStream, serverStream] = createStreamPair();
// Messages written to clientStream.writable appear on serverStream.readable
// Messages written to serverStream.writable appear on clientStream.readable
```

### Integration Test Harness

For comprehensive testing, use the integration harness pattern:

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";
import { ClientConnection } from "@multi-agent-protocol/sdk";
import { AgentConnection } from "@multi-agent-protocol/sdk";
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";

interface TestHarness {
  server: MAPServer;
  createClient(name?: string): Promise<ClientConnection>;
  createAgent(name: string, role?: string): Promise<AgentConnection>;
  cleanup(): Promise<void>;
}

function createTestHarness(): TestHarness {
  const server = new MAPServer({ name: "TestServer" });
  const connections: Array<ClientConnection | AgentConnection> = [];

  return {
    server,

    async createClient(name = "TestClient") {
      const [clientStream, serverStream] = createStreamPair();
      server.accept(serverStream, { role: "client" }).start();

      const client = new ClientConnection(clientStream, { name });
      await client.connect();
      connections.push(client);

      return client;
    },

    async createAgent(name: string, role?: string) {
      const [clientStream, serverStream] = createStreamPair();
      server.accept(serverStream, { role: "agent" }).start();

      const agent = new AgentConnection(clientStream, { name, role });
      await agent.connect();
      connections.push(agent);

      return agent;
    },

    async cleanup() {
      for (const conn of connections) {
        try {
          await conn.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
      await server.close({ force: true });
    },
  };
}
```

## Unit Testing

### Testing Handlers

```typescript
import { describe, it, expect } from "vitest";
import { createAgentHandlers, AgentRegistryImpl, EventBusImpl } from "@multi-agent-protocol/sdk/server";

describe("Agent Handlers", () => {
  it("should register an agent", async () => {
    const eventBus = new EventBusImpl();
    const agents = new AgentRegistryImpl({ eventBus });
    const handlers = createAgentHandlers({ agents });

    const ctx = {
      session: { id: "session-1", role: "agent" },
      requestId: "req-1",
      signal: new AbortController().signal,
    };

    const result = await handlers["map/agents/register"](
      { name: "TestAgent", role: "worker" },
      ctx
    );

    expect(result.agent.name).toBe("TestAgent");
    expect(result.agent.role).toBe("worker");
    expect(agents.get(result.agent.id)).toBeDefined();
  });

  it("should list agents", async () => {
    const eventBus = new EventBusImpl();
    const agents = new AgentRegistryImpl({ eventBus });
    const handlers = createAgentHandlers({ agents });

    // Register some agents directly
    agents.register({ name: "Agent1", sessionId: "s1" });
    agents.register({ name: "Agent2", sessionId: "s2" });

    const ctx = {
      session: { id: "session-1", role: "client" },
      requestId: "req-1",
      signal: new AbortController().signal,
    };

    const result = await handlers["map/agents/list"]({}, ctx);

    expect(result.agents).toHaveLength(2);
  });
});
```

### Testing Building Blocks

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  EventBusImpl,
  AgentRegistryImpl,
  ScopeManagerImpl,
} from "@multi-agent-protocol/sdk/server";

describe("AgentRegistry", () => {
  let eventBus: EventBusImpl;
  let agents: AgentRegistryImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    agents = new AgentRegistryImpl({ eventBus });
  });

  it("should register and emit event", () => {
    const events: any[] = [];
    eventBus.on("agent.registered", (e) => events.push(e));

    const agent = agents.register({
      name: "TestAgent",
      sessionId: "session-1",
    });

    expect(agent.name).toBe("TestAgent");
    expect(events).toHaveLength(1);
    expect(events[0].data.agent.id).toBe(agent.id);
  });

  it("should filter by role", () => {
    agents.register({ name: "Worker1", role: "worker", sessionId: "s1" });
    agents.register({ name: "Worker2", role: "worker", sessionId: "s2" });
    agents.register({ name: "Manager", role: "manager", sessionId: "s3" });

    const workers = agents.list({ role: "worker" });
    expect(workers).toHaveLength(2);
  });
});

describe("ScopeManager", () => {
  let eventBus: EventBusImpl;
  let scopes: ScopeManagerImpl;

  beforeEach(() => {
    eventBus = new EventBusImpl();
    scopes = new ScopeManagerImpl({ eventBus });
  });

  it("should create hierarchical scopes", () => {
    const parent = scopes.create({ name: "parent" });
    const child = scopes.create({ name: "child", parentId: parent.id });

    expect(child.parentId).toBe(parent.id);
    expect(scopes.getChildren(parent.id)).toContainEqual(
      expect.objectContaining({ id: child.id })
    );
  });

  it("should track scope membership", () => {
    const scope = scopes.create({ name: "room" });

    scopes.join(scope.id, "agent-1");
    scopes.join(scope.id, "agent-2");

    expect(scopes.getMembers(scope.id)).toEqual(["agent-1", "agent-2"]);

    scopes.leave(scope.id, "agent-1");
    expect(scopes.getMembers(scope.id)).toEqual(["agent-2"]);
  });
});
```

## Integration Testing

### Client-Server Integration

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Client-Server Integration", () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("should list registered agents", async () => {
    // Create an agent
    const agent = await harness.createAgent("Worker", "processor");

    // Create a client and list agents
    const client = await harness.createClient();
    const { agents } = await client.listAgents();

    expect(agents).toContainEqual(
      expect.objectContaining({
        name: "Worker",
        role: "processor",
      })
    );
  });

  it("should deliver events to subscribers", async () => {
    const client = await harness.createClient();

    // Subscribe to agent events
    const subscription = await client.subscribe({
      eventTypes: ["agent.registered"],
    });

    // Create an agent (triggers event)
    const agentPromise = harness.createAgent("NewAgent");

    // Wait for event
    const eventPromise = (async () => {
      for await (const event of subscription) {
        if (event.type === "agent.registered") {
          return event;
        }
      }
    })();

    const [agent, event] = await Promise.all([agentPromise, eventPromise]);

    expect(event?.data.agent.name).toBe("NewAgent");
  });

  it("should route messages between agents", async () => {
    const agent1 = await harness.createAgent("Agent1");
    const agent2 = await harness.createAgent("Agent2");

    const receivedMessages: any[] = [];
    agent2.onMessage((msg) => receivedMessages.push(msg));

    // Get agent2's ID
    const { agents } = await agent1.listAgents();
    const agent2Info = agents.find((a) => a.name === "Agent2");

    // Send message
    await agent1.send({
      to: { agentId: agent2Info!.id },
      payload: { type: "hello", data: "world" },
    });

    // Wait for delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].payload).toEqual({
      type: "hello",
      data: "world",
    });
  });
});
```

### Scope Integration

```typescript
describe("Scope Integration", () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("should broadcast messages to scope members", async () => {
    const coordinator = await harness.createAgent("Coordinator");
    const worker1 = await harness.createAgent("Worker1", "worker");
    const worker2 = await harness.createAgent("Worker2", "worker");

    // Create scope
    const scope = await coordinator.createScope({ name: "team" });

    // Workers join scope
    await worker1.joinScope(scope.id);
    await worker2.joinScope(scope.id);

    // Track received messages
    const worker1Messages: any[] = [];
    const worker2Messages: any[] = [];
    worker1.onMessage((msg) => worker1Messages.push(msg));
    worker2.onMessage((msg) => worker2Messages.push(msg));

    // Broadcast to scope
    await coordinator.send({
      to: { scopeId: scope.id },
      payload: { type: "announcement", text: "Meeting at 3pm" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(worker1Messages).toHaveLength(1);
    expect(worker2Messages).toHaveLength(1);
    expect(worker1Messages[0].payload.text).toBe("Meeting at 3pm");
  });
});
```

### Session Resume

```typescript
describe("Session Resume", () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("should resume session with token", async () => {
    // Create first connection
    const [clientStream1, serverStream1] = createStreamPair();
    harness.server.accept(serverStream1).start();

    const client1 = new ClientConnection(clientStream1, { name: "Client" });
    const result1 = await client1.connect();
    const resumeToken = result1.resumeToken;

    // Disconnect
    await client1.disconnect();

    // Resume with new connection
    const [clientStream2, serverStream2] = createStreamPair();
    harness.server.accept(serverStream2, { resumeToken }).start();

    const client2 = new ClientConnection(clientStream2, { name: "Client" });
    const result2 = await client2.connect({ resumeToken });

    expect(result2.resumed).toBe(true);
    expect(result2.sessionId).toBe(result1.sessionId);
  });
});
```

## Testing Patterns

### Waiting for Events

```typescript
async function waitForEvent(
  harness: TestHarness,
  eventType: string,
  timeoutMs = 1000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout waiting for ${eventType}`));
    }, timeoutMs);

    const unsubscribe = harness.server.on(eventType, (event) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

// Usage
it("should emit event on agent registration", async () => {
  const eventPromise = waitForEvent(harness, "agent.registered");
  await harness.createAgent("TestAgent");
  const event = await eventPromise;
  expect(event.data.agent.name).toBe("TestAgent");
});
```

### Testing Async Iteration

```typescript
async function collectEvents(
  subscription: AsyncIterable<any>,
  count: number,
  timeoutMs = 1000
): Promise<any[]> {
  const events: any[] = [];

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), timeoutMs)
  );

  const collect = (async () => {
    for await (const event of subscription) {
      events.push(event);
      if (events.length >= count) break;
    }
    return events;
  })();

  return Promise.race([collect, timeout]);
}

// Usage
it("should receive multiple events", async () => {
  const client = await harness.createClient();
  const subscription = await client.subscribe({ eventTypes: ["agent.*"] });

  // Trigger events
  setTimeout(async () => {
    await harness.createAgent("Agent1");
    await harness.createAgent("Agent2");
  }, 10);

  const events = await collectEvents(subscription, 2);
  expect(events).toHaveLength(2);
});
```

### Testing Error Cases

```typescript
describe("Error Handling", () => {
  it("should reject invalid agent ID", async () => {
    const client = await harness.createClient();

    await expect(client.getAgent("nonexistent")).rejects.toThrow();
  });

  it("should handle send to disconnected agent", async () => {
    const agent1 = await harness.createAgent("Sender");
    const agent2 = await harness.createAgent("Receiver");

    const { agents } = await agent1.listAgents();
    const receiverId = agents.find((a) => a.name === "Receiver")!.id;

    // Disconnect receiver
    await agent2.disconnect();

    // Try to send (should queue or fail depending on implementation)
    await expect(
      agent1.send({
        to: { agentId: receiverId },
        payload: { test: true },
      })
    ).rejects.toThrow();
  });
});
```

## Test Configuration

### Vitest Setup

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

### Test Utilities File

```typescript
// test-utils.ts
export { createTestHarness, type TestHarness } from "./harness";
export { waitForEvent, collectEvents, delay } from "./helpers";

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

## Best Practices

1. **Always clean up**: Use `afterEach` to close connections and servers
2. **Use timeouts**: Prevent tests from hanging on failed async operations
3. **Test error paths**: Verify error handling, not just happy paths
4. **Isolate tests**: Each test should create its own harness
5. **Test concurrency**: Verify behavior with multiple agents/clients
6. **Test reconnection**: Verify session resume works correctly

## Next Steps

- **[Server Quickstart](./server-quickstart.md)** - Set up a server to test against
- **[Transports](./transports.md)** - Test different transport adapters
