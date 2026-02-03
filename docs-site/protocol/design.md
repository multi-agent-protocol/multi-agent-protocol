---
title: Design
parent: Protocol
nav_order: 1
description: "MAP protocol design philosophy and architecture"
---

# Protocol Design
{: .no_toc }

Core architecture, design philosophy, and the unified participant model.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Design Philosophy

**Primary Abstraction**: The agent and its relationships to other agents, followed by the messages that flow between them.

**Core Principle**: MAP treats the multi-agent system as a **transparent, observable entity** rather than an opaque black box. Clients connecting via MAP can see (with appropriate permissions) the internal structure and activity of the system.

### Key Design Principles

1. **Topology is configuration, not protocol** - The same protocol supports hierarchical orchestration (like Claude Code's Task agents) and peer collaboration
2. **Unified messaging with metadata** - One message type with metadata that specializes behavior (task delegation, peer messaging, broadcast)
3. **Visibility is first-class** - Agents and scopes have explicit visibility settings; "parent-only" visibility enables hidden sub-agents
4. **Lifecycle is descriptive, not prescriptive** - Protocol records lifecycle metadata; implementations decide how to enforce it
5. **Extensibility at every layer** - States, lifecycle patterns, visibility levels, and message metadata are all extensible
6. **Unified participant model** - Agents and clients speak the same protocol; difference is in capabilities and visibility, not in the wire format

---

## What MAP Is NOT

- **Not ACP**: ACP is client ↔ single agent. MAP is client ↔ multi-agent system.
- **Not A2A**: A2A is peer agent ↔ peer agent (opaque). MAP is for internal systems with visibility.
- **Not a replacement**: MAP complements ACP/A2A. Agents can use ACP for client interaction, A2A for external peers, and MAP for internal coordination.

---

## Protocol Landscape

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Agent Protocol Ecosystem                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Protocol    Relationship           Visibility    Primary Use              │
│   ────────    ────────────           ──────────    ───────────              │
│   MCP         Agent → Tool           N/A           Tool invocation          │
│   ACP         Client → Agent         Opaque        Single-agent sessions    │
│   A2A         Agent → Agent (peer)   Opaque        Cross-org delegation     │
│   MAP         Client → System        Transparent   Internal orchestration   │
│               Agent → Agent (internal)                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Integration Patterns

**Pattern 1: MAP + ACP (Hybrid Client)**
```
Client uses ACP for single-agent focus, MAP for system awareness.
The MAP SDK can convert MAP streams into ACP-compatible sessions.
```

**Pattern 2: MAP + A2A (Federated Systems)**
```
Internal coordination via MAP.
External peer communication via A2A.
Individual agents can participate in both.
```

**Pattern 3: MAP-to-MAP (System Federation)**
```
Two MAP systems can communicate via their exposed message channels.
Each system remains internally transparent, externally opaque.
```

---

## Unified Participant Model

A core design principle of MAP is that **agents and clients speak the same protocol**. The difference is not in the wire format, but in:

- **Capabilities**: What actions they can perform
- **Visibility**: What they can see
- **Transport**: How they connect

This enables:
- Consistent semantics across all participants
- Federation as a natural extension (remote agents are just participants)
- Hierarchical composition (agents can be servers to their children)
- Transport optimization without protocol changes

### Participant Types

```typescript
interface MAPParticipant {
  id: string;
  type: "agent" | "client" | "system" | "gateway";

  // What this participant can see
  visibility: MAPParticipantVisibility;

  // What this participant can do
  capabilities: MAPParticipantCapabilities;

  // How this participant is connected
  transport: MAPTransport;

  // Session information
  session?: MAPSession;
}
```

### Capability Matrix

| Capability | Client | Agent | System | Gateway |
|:-----------|:-------|:------|:-------|:--------|
| canObserve | ✓ | ✓* | ✓ | ✓* |
| canQuery | ✓ | ✓* | ✓ | ✓* |
| canSend | ✓* | ✓ | ✓ | ✓ |
| canReceive | ✗ | ✓ | ✓ | ✓ |
| canBroadcast | ✗ | ✓* | ✓ | ✗ |
| canSpawn | ✗ | ✓ | ✓ | ✗ |
| canRegister | ✗ | ✓* | ✓ | ✗ |
| canSteer | ✓* | ✓* | ✓ | ✗ |
| canCreateScopes | ✗ | ✓* | ✓ | ✗ |

✓ = default yes, ✗ = default no, * = depends on permissions
{: .fs-2 }

---

## Core Objects

### Agent

The fundamental unit in the system:

```typescript
interface MAPAgent {
  id: string;
  name?: string;

  // Relationships
  parent?: string;                    // Hierarchical parent
  relationships?: MAPRelationship[];  // Other connections

  // State (extensible)
  state: MAPAgentState;

  // Classification
  role?: string;
  scopes: string[];

  // Visibility
  visibility?: MAPVisibility;

  // Lifecycle
  lifecycle?: MAPAgentLifecycle;

  // Metadata
  metadata?: Record<string, unknown>;
}

type MAPAgentState =
  | "registered"    // Known to system, not yet active
  | "active"        // Running and responsive
  | "busy"          // Active but processing
  | "idle"          // Active but waiting
  | "suspended"     // Paused, can be resumed
  | "stopping"      // Shutting down gracefully
  | "stopped"       // Terminated
  | "failed";       // Error state
```

### Message

Messages flow between agents:

```typescript
interface MAPMessage {
  id: string;
  from: string;
  to: MAPAddress;
  payload: unknown;
  meta?: {
    priority?: "low" | "normal" | "high" | "urgent";
    delivery?: "inject" | "interrupt" | "queue" | "best-effort";
    ttl?: number;
    requireAck?: boolean;
  };
  timestamp: number;
}
```

### Scope

Logical groupings for agents:

```typescript
interface MAPScope {
  id: string;
  name?: string;
  type: "room" | "topic" | "project" | "custom";
  members: string[];
  visibility?: MAPVisibility;
  permissions?: MAPScopePermissions;
}
```

---

## Hierarchical Composition

Agents can be both clients (to their parent/system) and servers (to their children):

```
┌─────────────────────────────────────────────────────────────────┐
│                  Hierarchical Composition                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  External Client (dashboard)                                    │
│       │                                                         │
│       │ MAP (websocket)                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Coordinator                                             │   │
│  │  - Is a participant (receives from client)               │   │
│  │  - Acts as MAP router for children                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                     │                                   │
│       │ MAP (inprocess)     │ MAP (inprocess)                   │
│       ▼                     ▼                                   │
│  ┌──────────────┐     ┌──────────────┐                         │
│  │  Worker A    │     │  Worker B    │                         │
│  │  - Participant│     │  - Participant│                        │
│  │  - Has children│    └──────────────┘                         │
│  └──────────────┘                                               │
│       │                                                         │
│       │ MAP (stdio)                                             │
│       ▼                                                         │
│  ┌──────────────┐                                               │
│  │  Sub-agent   │  (Claude Code pattern)                        │
│  │  - Leaf node │                                               │
│  └──────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Transport Layer

MAP is transport-agnostic. The protocol defines message format and semantics; the transport layer handles delivery.

### Transport Interface

```typescript
interface MAPTransport {
  type: string;

  // Send a message or request
  send(frame: MAPFrame): Promise<void>;

  // Receive messages/events
  receive(): AsyncIterable<MAPFrame>;

  // Connection lifecycle
  close(): Promise<void>;

  // Connection state
  state: "connecting" | "connected" | "disconnected" | "error";
}
```

### Built-in Transport Bindings

| Transport | Use Case | Framing |
|:----------|:---------|:--------|
| WebSocket | Remote clients, federation | JSON messages |
| stdio | Subprocess agents (Claude Code) | NDJSON (newline-delimited) |
| In-process | Co-located agents | Direct object passing |
| HTTP + SSE | Stateless clients | POST + Server-Sent Events |

---

## Next Steps

- [Wire Protocol](./wire-protocol.html) - JSON-RPC message format
- [Streaming](./streaming.html) - Event subscriptions and filtering
- [Permissions](./permissions.html) - 4-layer visibility model
