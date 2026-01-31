# ACP-over-MAP Examples

This directory contains end-to-end examples demonstrating how to use the ACP (Agent Communication Protocol) over MAP (Multi-Agent Protocol) transport layer.

## Overview

ACP-over-MAP allows ACP clients and agents to communicate through a MAP server, enabling:

- **Transparent Observability**: MAP provides visibility into agent activities
- **Multi-Tenancy**: Multiple ACP streams can coexist on a single MAP connection
- **Federation**: Agents can span multiple MAP servers
- **Unified Transport**: One connection for both MAP operations and ACP sessions

## Files

| File | Description |
|------|-------------|
| `main.ts` | Complete end-to-end example showing full ACP flow |
| `client-example.ts` | Focused example of implementing an ACP client |
| `agent-example.ts` | Focused example of implementing an ACP agent |

## Running the Examples

### Prerequisites

1. Clone the repository
2. Install dependencies:
   ```bash
   cd ts-sdk
   npm install
   ```

### Run the Main Example

```bash
npx tsx examples/acp-over-map/main.ts
```

This demonstrates:
- Creating a MAP server
- Registering an ACP-enabled agent
- Connecting a client via MAP
- Full ACP lifecycle (initialize → newSession → prompt)
- Streaming session updates
- Agent→client requests (permissions, file operations)
- Error handling

### Run the Client Example

```bash
npx tsx examples/acp-over-map/client-example.ts
```

This demonstrates:
- Creating an ACP client wrapper class
- Handling streaming updates
- Implementing client-side handlers (permissions, files, terminals)

### Run the Agent Example

```bash
npx tsx examples/acp-over-map/agent-example.ts
```

This demonstrates:
- Creating an ACP agent using ACPAgentAdapter
- Session management
- Sending streaming responses
- Making agent→client requests

## Key Concepts

### Client Side

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";
import { ACP_PROTOCOL_VERSION } from "@multi-agent-protocol/sdk";

// Create ACP stream from MAP client
const acp = mapClient.createACPStream({
  targetAgent: "agent-id",
  client: {
    // Handle permission requests from agent
    requestPermission: async (request) => {
      // Show UI, get user decision
      return { outcome: { outcome: "selected", optionId: "allow" } };
    },

    // Handle streaming updates
    sessionUpdate: async (update) => {
      if (update.update.sessionUpdate === "agent_message_chunk") {
        console.log(update.update.content.text);
      }
    },

    // Handle file operations
    readTextFile: async (request) => {
      return { content: fs.readFileSync(request.path, "utf-8") };
    },
  },
});

// Use the ACP stream
await acp.initialize({ protocolVersion: ACP_PROTOCOL_VERSION });
await acp.newSession({ cwd: "/project", mcpServers: [] });
await acp.prompt({
  sessionId: acp.sessionId,
  prompt: [{ type: "text", text: "Hello!" }],
});
```

### Agent Side

```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";
import { ACPAgentAdapter, ACP_PROTOCOL_VERSION } from "@multi-agent-protocol/sdk";

// Create ACP adapter from MAP agent
const adapter = new ACPAgentAdapter(mapAgent, {
  initialize: async (params, ctx) => ({
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentInfo: { name: "MyAgent", version: "1.0" },
    agentCapabilities: { streaming: true },
  }),

  newSession: async (params, ctx) => ({
    sessionId: generateId(),
  }),

  prompt: async (params, ctx) => {
    // Send streaming response
    await adapter.sendSessionUpdate(ctx.streamId, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello!" },
      },
    });

    // Request permission for file access
    const permission = await adapter.requestPermission(ctx.streamId, {
      sessionId: params.sessionId,
      options: [
        { id: "allow", kind: "allow", title: "Allow" },
        { id: "deny", kind: "deny", title: "Deny" },
      ],
    });

    // Read file from client
    if (permission.outcome.optionId === "allow") {
      const file = await adapter.readTextFile(ctx.streamId, {
        sessionId: params.sessionId,
        path: "/project/file.txt",
      });
    }

    return { stopReason: "end_turn" };
  },

  cancel: async (params, ctx) => {
    // Handle cancellation
  },
});
```

## ACP Flow Diagram

```
┌─────────┐                    ┌─────────────┐                    ┌─────────┐
│  Client │                    │  MAP Server │                    │  Agent  │
└────┬────┘                    └──────┬──────┘                    └────┬────┘
     │                                │                                 │
     │─────── MAP connect ───────────>│                                 │
     │<────── session ───────────────│                                 │
     │                                │                                 │
     │                                │<────── MAP register ───────────│
     │                                │─────── agent registered ──────>│
     │                                │                                 │
     │─── subscribe(agent) ──────────>│                                 │
     │                                │                                 │
     │                                │                                 │
     │====== ACP over MAP ============│================================│
     │                                │                                 │
     │── ACP initialize ─────────────>│── forward ────────────────────>│
     │<─ ACP init response ──────────│<─ response ─────────────────────│
     │                                │                                 │
     │── ACP newSession ─────────────>│── forward ────────────────────>│
     │<─ ACP session response ───────│<─ response ─────────────────────│
     │                                │                                 │
     │── ACP prompt ─────────────────>│── forward ────────────────────>│
     │                                │                                 │
     │<─ ACP sessionUpdate ──────────│<─ streaming update ─────────────│
     │<─ ACP sessionUpdate ──────────│<─ streaming update ─────────────│
     │                                │                                 │
     │                                │<── ACP requestPermission ──────│
     │<─ permission request ─────────│                                 │
     │── permission response ────────>│── forward response ───────────>│
     │                                │                                 │
     │<─ ACP prompt response ────────│<─ prompt response ──────────────│
     │                                │                                 │
```

## Error Handling

```typescript
import { ACPError } from "@multi-agent-protocol/sdk";

try {
  await acp.newSession({ cwd: "/project", mcpServers: [] });
} catch (error) {
  if (error instanceof ACPError) {
    console.log(`ACP Error ${error.code}: ${error.message}`);
  }
}
```

## Reconnection Handling

The ACP stream automatically handles MAP reconnection:

```typescript
acp.on("reconnecting", () => {
  console.log("Connection lost, reconnecting...");
});

acp.on("reconnected", () => {
  console.log("Reconnected successfully");
});

acp.on("sessionLost", ({ sessionId, reason }) => {
  console.log(`Session ${sessionId} lost: ${reason}`);
  // Need to create a new session
});
```

## See Also

- [ACP-over-MAP Documentation](../../docs/acp-over-map.md)
- [MAP SDK Documentation](../../README.md)
- [ACP Types Reference](../../src/acp/types.ts)
