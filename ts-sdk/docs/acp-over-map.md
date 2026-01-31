# ACP-over-MAP Tunneling

This guide explains how to use the Agent Client Protocol (ACP) over MAP, enabling clients to interact with ACP-compatible agents within a MAP system while preserving all ACP semantics.

## Overview

ACP-over-MAP allows you to:

- **Run multiple ACP sessions** over a single MAP connection
- **Route ACP requests** to any ACP-compatible agent in the system
- **Gain observability** into ACP interactions via MAP events
- **Leverage MAP features** like federation and reconnection for ACP

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAP Client Connection                         │
│                                                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│   │ ACPStream #1 │  │ ACPStream #2 │  │ ACPStream #3 │         │
│   │ → Agent A    │  │ → Agent B    │  │ → Agent A    │         │
│   │ session: s1  │  │ session: s2  │  │ session: s3  │         │
│   └──────────────┘  └──────────────┘  └──────────────┘         │
│         │                  │                  │                  │
└─────────┼──────────────────┼──────────────────┼──────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
   ┌────────────┐    ┌────────────┐    ┌────────────┐
   │  Agent A   │    │  Agent B   │    │  Agent A   │
   │ (ACP-cap)  │    │ (ACP-cap)  │    │ (2nd sess) │
   └────────────┘    └────────────┘    └────────────┘
```

## Quick Start

### Client-Side: Using ACP Streams

```typescript
import { ClientConnection } from '@anthropic/map-sdk';

// Connect to MAP system
const client = await ClientConnection.connect('ws://localhost:8080', {
  name: 'MyClient',
});

// Find ACP-capable agents
const { agents } = await client.listAgents();
const acpAgents = agents.filter(a => a.capabilities?.protocols?.includes('acp'));

// Create an ACP stream to a specific agent
const acp = client.createACPStream({
  targetAgent: acpAgents[0].id,
  client: {
    requestPermission: async (req) => {
      // Handle permission requests from agent
      return { outcome: { outcome: 'selected', optionId: 'allow' } };
    },
    sessionUpdate: async (update) => {
      // Handle streaming updates during prompt
      console.log('Update:', update);
    },
  },
});

// Standard ACP workflow
await acp.initialize({
  protocolVersion: 20241007,
  clientInfo: { name: 'MyClient', version: '1.0.0' },
});

const { sessionId } = await acp.newSession({
  cwd: '/path/to/project',
  mcpServers: [],
});

// Prompt with streaming updates via sessionUpdate handler
const result = await acp.prompt({
  sessionId,
  prompt: [{ type: 'text', text: 'Hello, agent!' }],
});

console.log('Stop reason:', result.stopReason);

// Clean up
await acp.close();
await client.disconnect();
```

### Agent-Side: Implementing ACP Support

```typescript
import { AgentConnection, ACPAgentAdapter } from '@anthropic/map-sdk';

// Connect with ACP capability
const agent = await AgentConnection.connect('ws://localhost:8080', {
  name: 'CodingAgent',
  capabilities: {
    protocols: ['acp'],
    acp: { version: '2024-10-07' },
  },
});

// Create ACP adapter with handlers
const adapter = new ACPAgentAdapter(agent, {
  initialize: async (params, ctx) => ({
    protocolVersion: 20241007,
    agentInfo: { name: 'CodingAgent', version: '1.0.0' },
    agentCapabilities: { loadSession: true },
  }),

  newSession: async (params, ctx) => ({
    sessionId: `session-${Date.now()}`,
  }),

  prompt: async (params, ctx) => {
    // Send streaming updates
    await adapter.sendSessionUpdate(ctx.streamId, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Processing...' },
      },
    });

    // Request permission if needed
    const permission = await adapter.requestPermission(ctx.streamId, {
      sessionId: params.sessionId,
      options: [
        { id: 'allow', kind: 'allow', title: 'Allow', description: 'Allow operation' },
        { id: 'deny', kind: 'deny', title: 'Deny', description: 'Deny operation' },
      ],
    });

    return { stopReason: 'end_turn' };
  },

  cancel: async (params, ctx) => {
    // Handle cancellation
  },
});
```

---

## Client-Side API

### Creating ACP Streams

Use `ClientConnection.createACPStream()` to create a virtual ACP connection:

```typescript
const acp = client.createACPStream({
  targetAgent: 'agent-id',
  client: ACPClientHandlers,
  timeout?: number,  // Request timeout in ms (default: 30000)
});
```

### ACPStreamConnection

The stream provides the full ACP client interface:

```typescript
interface ACPStreamConnection {
  // Properties
  readonly streamId: string;
  readonly targetAgent: string;
  readonly sessionId: string | null;
  readonly initialized: boolean;
  readonly capabilities: ACPAgentCapabilities | null;

  // Lifecycle
  initialize(params: ACPInitializeRequest): Promise<ACPInitializeResponse>;
  authenticate(params: ACPAuthenticateRequest): Promise<ACPAuthenticateResponse>;

  // Session
  newSession(params: ACPNewSessionRequest): Promise<ACPNewSessionResponse>;
  loadSession(params: ACPLoadSessionRequest): Promise<ACPLoadSessionResponse>;
  setSessionMode(params: ACPSetSessionModeRequest): Promise<ACPSetSessionModeResponse>;

  // Prompt
  prompt(params: ACPPromptRequest): Promise<ACPPromptResponse>;
  cancel(params?: Partial<ACPCancelNotification>): Promise<void>;

  // Lifecycle
  close(): Promise<void>;

  // Events
  on(event: 'sessionLost', handler: (info: { sessionId: string; reason: string }) => void): void;
  on(event: 'reconnecting', handler: () => void): void;
  on(event: 'reconnected', handler: () => void): void;
  on(event: 'close', handler: () => void): void;
}
```

### Client Handlers

You must provide handlers for agent-to-client requests:

```typescript
interface ACPClientHandlers {
  // Required
  requestPermission(params: ACPRequestPermissionRequest): Promise<ACPRequestPermissionResponse>;
  sessionUpdate(params: ACPSessionNotification): Promise<void>;

  // Optional (based on advertised capabilities)
  readTextFile?(params: ACPReadTextFileRequest): Promise<ACPReadTextFileResponse>;
  writeTextFile?(params: ACPWriteTextFileRequest): Promise<ACPWriteTextFileResponse>;
  createTerminal?(params: ACPCreateTerminalRequest): Promise<ACPCreateTerminalResponse>;
  terminalOutput?(params: ACPTerminalOutputRequest): Promise<ACPTerminalOutputResponse>;
  releaseTerminal?(params: ACPReleaseTerminalRequest): Promise<ACPReleaseTerminalResponse>;
  waitForTerminalExit?(params: ACPWaitForTerminalExitRequest): Promise<ACPWaitForTerminalExitResponse>;
  killTerminal?(params: ACPKillTerminalCommandRequest): Promise<ACPKillTerminalCommandResponse>;
}
```

### Multiple Concurrent Streams

You can create multiple ACP streams over a single MAP connection:

```typescript
// Stream to agent A
const acp1 = client.createACPStream({
  targetAgent: 'agent-a',
  client: handlers,
});

// Stream to agent B (different agent)
const acp2 = client.createACPStream({
  targetAgent: 'agent-b',
  client: handlers,
});

// Another stream to agent A (different session)
const acp3 = client.createACPStream({
  targetAgent: 'agent-a',
  client: handlers,
});

// All streams share the same MAP connection
await Promise.all([
  acp1.initialize({ protocolVersion: 20241007 }),
  acp2.initialize({ protocolVersion: 20241007 }),
  acp3.initialize({ protocolVersion: 20241007 }),
]);
```

### Managing Streams

```typescript
// Get a stream by ID
const stream = client.getACPStream('stream-id');

// List all active streams
for (const [id, stream] of client.acpStreams) {
  console.log(`Stream ${id} → ${stream.targetAgent}`);
}

// Streams are automatically cleaned up on disconnect
await client.disconnect();  // Closes all ACP streams
```

---

## Agent-Side API

### Capability Advertisement

Agents must advertise ACP support during registration:

```typescript
const agent = await AgentConnection.connect('ws://localhost:8080', {
  name: 'MyAgent',
  capabilities: {
    protocols: ['acp'],
    acp: {
      version: '2024-10-07',
      features: ['loadSession', 'modes'],  // Optional feature flags
    },
  },
});
```

### ACPAgentAdapter

The adapter handles ACP envelope parsing and routing:

```typescript
const adapter = new ACPAgentAdapter(agentConnection, handler, options?);
```

**Options:**
- `clientRequestTimeout?: number` - Timeout for agent→client requests (default: 30000ms)

### Agent Handler Interface

```typescript
interface ACPAgentHandler {
  // Required
  initialize(params: ACPInitializeRequest, ctx: ACPAgentContext): Promise<ACPInitializeResponse>;
  newSession(params: ACPNewSessionRequest, ctx: ACPAgentContext): Promise<ACPNewSessionResponse>;
  prompt(params: ACPPromptRequest, ctx: ACPAgentContext): Promise<ACPPromptResponse>;
  cancel(params: ACPCancelNotification, ctx: ACPAgentContext): Promise<void>;

  // Optional
  authenticate?(params: ACPAuthenticateRequest, ctx: ACPAgentContext): Promise<ACPAuthenticateResponse>;
  loadSession?(params: ACPLoadSessionRequest, ctx: ACPAgentContext): Promise<ACPLoadSessionResponse>;
  setSessionMode?(params: ACPSetSessionModeRequest, ctx: ACPAgentContext): Promise<ACPSetSessionModeResponse>;
}

interface ACPAgentContext {
  streamId: string;           // Unique stream identifier
  sessionId: string | null;   // ACP session ID (null before newSession)
  clientParticipantId: string; // MAP participant ID of the client
}
```

### Agent-to-Client Communication

The adapter provides methods to communicate back to the client:

```typescript
// Send streaming updates (notifications)
await adapter.sendSessionUpdate(ctx.streamId, {
  sessionId: params.sessionId,
  update: {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Hello!' },
  },
});

// Request permission (waits for response)
const permission = await adapter.requestPermission(ctx.streamId, {
  sessionId: params.sessionId,
  options: [
    { id: 'allow', kind: 'allow', title: 'Allow', description: 'Allow operation' },
    { id: 'deny', kind: 'deny', title: 'Deny', description: 'Deny operation' },
  ],
});

// File system operations
const content = await adapter.readTextFile(ctx.streamId, {
  sessionId: params.sessionId,
  path: '/path/to/file.txt',
});

await adapter.writeTextFile(ctx.streamId, {
  sessionId: params.sessionId,
  path: '/path/to/file.txt',
  content: 'Hello, world!',
});

// Terminal operations
const terminal = await adapter.createTerminal(ctx.streamId, {
  sessionId: params.sessionId,
  command: 'npm test',
});

const output = await adapter.terminalOutput(ctx.streamId, {
  sessionId: params.sessionId,
  terminalId: terminal.terminalId,
});
```

### Stream Context Management

```typescript
// Check if a stream is active
if (adapter.hasStream(streamId)) {
  // ...
}

// Get session ID for a stream
const sessionId = adapter.getSessionId(streamId);

// Get client participant ID
const clientId = adapter.getClientParticipantId(streamId);

// Remove stream context (e.g., on client disconnect)
adapter.removeStream(streamId);
```

---

## Reconnection Handling

ACP streams automatically handle MAP reconnection:

```typescript
const acp = client.createACPStream({
  targetAgent: 'agent-id',
  client: handlers,
});

// Listen for reconnection events
acp.on('reconnecting', () => {
  console.log('Connection lost, reconnecting...');
});

acp.on('reconnected', () => {
  console.log('Reconnected successfully');
});

// Handle session loss (agent may have restarted)
acp.on('sessionLost', ({ sessionId, reason }) => {
  console.log(`Session ${sessionId} lost: ${reason}`);
  // Attempt to reload the session
  await acp.loadSession({ sessionId });
});
```

---

## Error Handling

### ACP Errors

ACP errors are passed through unchanged:

```typescript
import { ACPError } from '@anthropic/map-sdk';

try {
  await acp.newSession({ cwd: '/invalid', mcpServers: [] });
} catch (e) {
  if (e instanceof ACPError) {
    console.log('ACP error:', e.code, e.message);
    // Handle specific error codes
    if (e.code === -32000) {
      // Authentication required
    }
  }
}
```

### Stream Errors

```typescript
// Request timeout
try {
  await acp.prompt({ sessionId, prompt: [...] });
} catch (e) {
  if (e.message.includes('timed out')) {
    // Request timed out
  }
}

// Stream closed during operation
try {
  await acp.prompt({ sessionId, prompt: [...] });
} catch (e) {
  if (e.message === 'ACP stream closed') {
    // Stream was closed while request was pending
  }
}
```

---

## Testing

### TestACPAgent for Unit Testing

Use `TestACPAgent` for lightweight unit tests without a full MAP server:

```typescript
import { TestACPAgent } from '@anthropic/map-sdk/testing';

const mockAgent = new TestACPAgent({
  handlers: {
    prompt: async (params) => {
      return { stopReason: 'end_turn' };
    },
  },
  defaultDelay: 10,  // Simulate network latency
});

// Create a mock stream for testing
const stream = mockAgent.createMockStream('test-client');

// Test the ACP flow
await stream.initialize({ protocolVersion: 20241007 });
const { sessionId } = await stream.newSession({ cwd: '/test', mcpServers: [] });
const result = await stream.prompt({ sessionId, prompt: [...] });

// Verify requests received
expect(mockAgent.receivedRequests).toHaveLength(3);
expect(mockAgent.receivedRequests[2].method).toBe('session/prompt');
```

### Error Injection

```typescript
const errorAgent = new TestACPAgent({
  errorOnMethod: {
    'session/new': { code: -32001, message: 'Session limit reached' },
  },
});

const stream = errorAgent.createMockStream('client');
await stream.initialize({ protocolVersion: 20241007 });

await expect(stream.newSession({ cwd: '/test', mcpServers: [] }))
  .rejects.toMatchObject({ code: -32001 });
```

### Agent-to-Client Testing

```typescript
const mockAgent = new TestACPAgent();
const stream = mockAgent.createMockStream('client');

// Set up client-side handler for agent requests
stream.on('agentRequest', (req) => {
  if (req.method === 'request_permission') {
    stream.respondToAgent(req.requestId, {
      outcome: { outcome: 'selected', optionId: 'allow' },
    });
  }
});

// Agent sends permission request
const response = await mockAgent.requestPermission(stream.streamId, {
  sessionId: 'session-1',
  options: [...],
});

expect(response.outcome.outcome).toBe('selected');
```

### Integration Testing with TestServer

Use `createACPTestAgent` for full integration tests:

```typescript
import { TestServer, TestClient, createACPTestAgent } from '@anthropic/map-sdk/testing';

const server = new TestServer({ name: 'Test' });

// Create an ACP-capable test agent
const { agent, adapter } = await createACPTestAgent(server, {
  name: 'TestAgent',
  handler: {
    initialize: async () => ({
      protocolVersion: 20241007,
      agentInfo: { name: 'TestAgent', version: '1.0' },
    }),
    newSession: async () => ({ sessionId: 'session-1' }),
    prompt: async (params, ctx) => {
      // Send updates during prompt
      await adapter.sendSessionUpdate(ctx.streamId, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi!' } },
      });
      return { stopReason: 'end_turn' };
    },
    cancel: async () => {},
  },
});

// Create a test client
const client = await TestClient.create(server);

// Create ACP stream to the test agent
const acp = client.connection.createACPStream({
  targetAgent: agent.id!,
  client: {
    requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'allow' } }),
    sessionUpdate: async (update) => { /* handle updates */ },
  },
});

// Full round-trip test
await acp.initialize({ protocolVersion: 20241007 });
const { sessionId } = await acp.newSession({ cwd: '/test', mcpServers: [] });
const result = await acp.prompt({ sessionId, prompt: [{ type: 'text', text: 'Hello' }] });

expect(result.stopReason).toBe('end_turn');

await acp.close();
await client.disconnect();
```

---

## ACP Type Reference

### Core Types

```typescript
// Session ID (branded string)
type ACPSessionId = string & { readonly __brand: 'ACPSessionId' };

// Protocol version
const ACP_PROTOCOL_VERSION = 20241007;

// Error class
class ACPError extends Error {
  constructor(code: number, message: string, data?: unknown);
  readonly code: number;
  readonly data?: unknown;
  toErrorObject(): { code: number; message: string; data?: unknown };
  static fromResponse(error: { code: number; message: string; data?: unknown }): ACPError;
}
```

### Request/Response Types

All ACP method types are exported from `@anthropic/map-sdk`:

```typescript
import {
  // Initialize
  ACPInitializeRequest,
  ACPInitializeResponse,

  // Session
  ACPNewSessionRequest,
  ACPNewSessionResponse,
  ACPLoadSessionRequest,
  ACPLoadSessionResponse,
  ACPSetSessionModeRequest,
  ACPSetSessionModeResponse,

  // Prompt
  ACPPromptRequest,
  ACPPromptResponse,
  ACPCancelNotification,
  ACPSessionNotification,

  // Permissions
  ACPRequestPermissionRequest,
  ACPRequestPermissionResponse,

  // File System
  ACPReadTextFileRequest,
  ACPReadTextFileResponse,
  ACPWriteTextFileRequest,
  ACPWriteTextFileResponse,

  // Terminal
  ACPCreateTerminalRequest,
  ACPCreateTerminalResponse,
  ACPTerminalOutputRequest,
  ACPTerminalOutputResponse,
  ACPReleaseTerminalRequest,
  ACPReleaseTerminalResponse,
  ACPWaitForTerminalExitRequest,
  ACPWaitForTerminalExitResponse,
  ACPKillTerminalCommandRequest,
  ACPKillTerminalCommandResponse,
} from '@anthropic/map-sdk';
```

### Type Guards

```typescript
import {
  isACPRequest,
  isACPNotification,
  isACPResponse,
  isACPErrorResponse,
  isACPSuccessResponse,
  isACPEnvelope,
} from '@anthropic/map-sdk';

// Check if a message payload is an ACP envelope
if (isACPEnvelope(message.payload)) {
  const { acp, acpContext } = message.payload;
  // ...
}
```

---

## Migration from Direct ACP

If you're migrating from direct ACP connections to ACP-over-MAP:

### Client Changes

**Before (Direct ACP):**
```typescript
import { ACPClient } from '@anthropic/acp-sdk';

const acp = new ACPClient('wss://agent.example.com/acp');
await acp.connect();
await acp.initialize({ ... });
```

**After (ACP-over-MAP):**
```typescript
import { ClientConnection } from '@anthropic/map-sdk';

const client = await ClientConnection.connect('ws://map-server.example.com');
const acp = client.createACPStream({
  targetAgent: 'agent-id',
  client: { /* handlers */ },
});
await acp.initialize({ ... });
```

### Key Differences

| Aspect | Direct ACP | ACP-over-MAP |
|--------|-----------|--------------|
| Connection | One per agent | Single MAP connection, multiple streams |
| Discovery | Manual endpoint configuration | Query `listAgents()` |
| Session updates | WebSocket events | `sessionUpdate` handler |
| Observability | Limited | Full MAP event stream |
| Multi-agent | Multiple connections | Multiple streams |

---

## Troubleshooting

### Agent not receiving ACP messages

1. Verify agent advertises ACP capability:
   ```typescript
   capabilities: { protocols: ['acp'], acp: { version: '2024-10-07' } }
   ```

2. Verify ACPAgentAdapter is created:
   ```typescript
   const adapter = new ACPAgentAdapter(agent, handlers);
   ```

3. Check that the agent is registered before clients try to connect

### Request timeouts

1. Check the timeout configuration:
   ```typescript
   const acp = client.createACPStream({
     targetAgent: 'agent-id',
     client: handlers,
     timeout: 60000,  // Increase timeout
   });
   ```

2. Verify agent is processing requests (add logging to handlers)

### Session lost after reconnection

This happens when the agent restarts and loses session state. Handle it by:

```typescript
acp.on('sessionLost', async ({ sessionId }) => {
  // Option 1: Reload session (if agent supports it)
  try {
    await acp.loadSession({ sessionId });
  } catch {
    // Option 2: Start a new session
    await acp.newSession({ cwd: '/project', mcpServers: [] });
  }
});
```

### Multiple streams to same agent interfering

Each stream has its own streamId and session. Make sure you're using the correct stream for each operation:

```typescript
// Wrong - using wrong stream's sessionId
const result = await acp1.prompt({ sessionId: acp2.sessionId!, ... });

// Correct - use each stream's own session
const result1 = await acp1.prompt({ sessionId: acp1.sessionId!, ... });
const result2 = await acp2.prompt({ sessionId: acp2.sessionId!, ... });
```

---

## Further Reading

- [ACP Specification](https://agentclientprotocol.com/)
- [MAP Protocol Specification](../docs/00-design-specification.md)
- [ACP-over-MAP Spec](../.sudocode/specs/s-9kpn_acp_over_map_tunneling.md)
