# Multi-Agent Protocol (MAP) Design Specification

## Overview

MAP (Multi-Agent Protocol) is a communication protocol for **observing, coordinating, and routing messages within multi-agent AI systems**. Unlike protocols designed for single-agent interaction (ACP) or peer-to-peer agent delegation (A2A), MAP provides a **window into** a multi-agent system with visibility into its internal structure, agent relationships, and message flows.

### Design Philosophy

**Primary Abstraction**: The agent and its relationships to other agents, followed by the messages that flow between them.

**Core Principle**: MAP treats the multi-agent system as a **transparent, observable entity** rather than an opaque black box. Clients connecting via MAP can see (with appropriate permissions) the internal structure and activity of the system.

**Key Design Principles**:
1. **Topology is configuration, not protocol** - The same protocol supports hierarchical orchestration (like Claude Code's Task agents) and peer collaboration (like macro-agent workers)
2. **Unified messaging with metadata** - One message type with metadata that specializes behavior (task delegation, peer messaging, broadcast)
3. **Visibility is first-class** - Agents and scopes have explicit visibility settings; "parent-only" visibility enables hidden sub-agents
4. **Lifecycle is descriptive, not prescriptive** - Protocol records lifecycle metadata; implementations decide how to enforce it
5. **Extensibility at every layer** - States, lifecycle patterns, visibility levels, and message metadata are all extensible
6. **Unified participant model** - Agents and clients speak the same protocol; difference is in capabilities and visibility, not in the wire format

### What MAP Is NOT

- **Not ACP**: ACP is client ↔ single agent. MAP is client ↔ multi-agent system.
- **Not A2A**: A2A is peer agent ↔ peer agent (opaque). MAP is for internal systems with visibility.
- **Not a replacement**: MAP complements ACP/A2A. Agents can use ACP for client interaction, A2A for external peers, and MAP for internal coordination.

### Reference Implementation: Claude Code as Multi-Agent System

Claude Code demonstrates the "orchestration pattern" - a multi-agent system where:
- User interacts with one main agent
- Sub-agents (Task tool) are spawned for specific work
- Sub-agents are invisible to the user
- Communication is hierarchical (parent ↔ child)
- Agents are task-scoped (ephemeral)

MAP should support this pattern as naturally as it supports the full-visibility "collaboration pattern" of macro-agent.

---

## Protocol Landscape & Relationships

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

                              Human/Client
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                   ACP            MAP          (direct)
                    │              │              │
                    ▼              ▼              ▼
              ┌─────────┐   ┌───────────────────────────┐
              │  Single │   │    Multi-Agent System     │
              │  Agent  │   │  ┌─────┐       ┌─────┐   │
              └─────────┘   │  │Agent│◄─MAP─►│Agent│   │
                            │  └──┬──┘       └──┬──┘   │
                            │     │     MAP     │      │
                            │     └──────┬──────┘      │
                            │            │             │
                            │      ┌─────▼─────┐       │
                            │      │   Agent   │       │──── A2A ────► External
                            │      └───────────┘       │               Peers
                            └───────────────────────────┘
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

### Participants

```typescript
// PARTICIPANT: The base abstraction for all MAP entities
// Both agents and clients are participants in the protocol
interface MAPParticipant {
  id: string;
  type: "agent" | "client" | "system" | "gateway";

  // What this participant can see (determined by role, scope, grants)
  visibility: MAPParticipantVisibility;

  // What this participant can do
  capabilities: MAPParticipantCapabilities;

  // How this participant is connected
  transport: MAPTransport;

  // Session information
  session?: MAPSession;
}

interface MAPParticipantCapabilities {
  // Observation
  canObserve: boolean;              // Can subscribe to events
  canQuery: boolean;                // Can query agents/structure

  // Messaging
  canSend: boolean;                 // Can send messages
  canReceive: boolean;              // Can receive messages addressed to it
  canBroadcast: boolean;            // Can send to scopes/roles

  // Agent management
  canSpawn: boolean;                // Can create child agents
  canRegister: boolean;             // Can register agents (not as children)
  canUnregister: boolean;           // Can remove agents

  // Control
  canSteer: boolean;                // Can inject context/control agents
  canStop: boolean;                 // Can request agent termination

  // Scope management
  canCreateScopes: boolean;
  canManageScopes: boolean;
}
```

### Capability Matrix

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Capability Matrix                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Capability        │ Client   │ Agent    │ System   │ Gateway              │
│                    │ (observer)│ (worker) │          │ (federation)         │
│  ──────────────────┼──────────┼──────────┼──────────┼────────────────────── │
│  canObserve        │ ✓        │ ✓*       │ ✓        │ ✓*                   │
│  canQuery          │ ✓        │ ✓*       │ ✓        │ ✓*                   │
│  canSend           │ ✓*       │ ✓        │ ✓        │ ✓                    │
│  canReceive        │ ✗        │ ✓        │ ✓        │ ✓                    │
│  canBroadcast      │ ✗        │ ✓*       │ ✓        │ ✗                    │
│  canSpawn          │ ✗        │ ✓        │ ✓        │ ✗                    │
│  canRegister       │ ✗        │ ✓*       │ ✓        │ ✗                    │
│  canUnregister     │ ✗        │ ✓*       │ ✓        │ ✗                    │
│  canSteer          │ ✓*       │ ✓*       │ ✓        │ ✗                    │
│  canStop           │ ✓*       │ ✓*       │ ✓        │ ✗                    │
│  canCreateScopes   │ ✗        │ ✓*       │ ✓        │ ✗                    │
│  canManageScopes   │ ✗        │ ✓*       │ ✓        │ ✗                    │
│                                                                             │
│  ✓ = default yes   ✗ = default no   * = depends on role/permissions        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Hierarchical Composition

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

### Transport Bindings

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
|-----------|----------|---------|
| WebSocket | Remote clients, federation | JSON messages |
| stdio | Subprocess agents (Claude Code) | NDJSON (newline-delimited) |
| In-process | Co-located agents | Direct object passing |
| HTTP + SSE | Stateless clients | POST + Server-Sent Events |

---

## Core Objects

```typescript
// AGENT: The fundamental unit in the system
interface MAPAgent {
  id: string;
  name?: string;

  // Relationships
  parent?: string;                    // Hierarchical parent
  relationships?: MAPRelationship[];  // Other connections (peers, custom)

  // State (extensible - implementations can add custom states)
  state: MAPAgentState;

  // Classification
  role?: string;                      // Role identifier
  scopes: string[];                   // Scope memberships

  // Visibility (who can see/address this agent)
  visibility?: MAPVisibility;

  // Lifecycle (descriptive, not prescriptive)
  lifecycle?: MAPAgentLifecycle;

  // Metadata
  metadata?: Record<string, unknown>;
}

// Agent states - extensible for implementations
type MAPAgentState =
  | "registered"    // Known to system, not yet active
  | "active"        // Running and responsive
  | "busy"          // Active but processing
  | "idle"          // Active but waiting
  | "suspended"     // Paused, can be resumed
  | "stopping"      // Shutting down gracefully
  | "stopped"       // Terminated, may have result
  | "failed"        // Terminated abnormally
  | string;         // Extensible for custom states

// MESSAGE: Unified communication with metadata specialization
interface MAPMessage {
  id: string;
  from: string;                       // Sender (agent, client, system)
  to: MAPAddress;                     // Target address

  // Payload - flexible structure
  payload: unknown;

  meta: {
    timestamp: number;
    relationship?: "parent-to-child" | "child-to-parent" | "peer" | "broadcast";
    expectsResponse?: boolean;
    correlationId?: string;
    isResult?: boolean;
    priority?: "urgent" | "high" | "normal" | "low";
    delivery?: "fire-and-forget" | "acknowledged" | "guaranteed";
  };
}
```

### Addressing Model

```typescript
// Flexible addressing for any topology
type MAPAddress =
  // Direct addressing
  | string                                    // Shorthand: agent ID
  | { agent: string }                         // Single agent
  | { agents: string[] }                      // Multiple agents

  // Structural addressing
  | { scope: string }                         // All in scope
  | { role: string; within?: string }         // Role, optionally scoped

  // Hierarchical addressing (relative to sender)
  | { parent: true }                          // Sender's parent
  | { children: true; depth?: number }        // Sender's children
  | { ancestors: true; depth?: number }       // Up the tree
  | { descendants: true; depth?: number }     // Down the tree
  | { siblings: true }                        // Same parent

  // Special
  | { broadcast: true }                       // All agents in system
  | { system: true }                          // The system/router itself
  | { participant: string }                   // Any participant by ID
  | { participants: "all" | "agents" | "clients" };  // Categories
```

---

## Protocol Methods

### Tier 1: Core (Required)

```typescript
// SYSTEM
"map/connect"           // Connect to system, negotiate capabilities
"map/disconnect"        // Graceful disconnect

// SESSION
"map/session/list"      // List participant's sessions
"map/session/load"      // Load/reconnect to existing session
"map/session/close"     // Explicitly end session

// AGENTS (read)
"map/agents/list"       // List agents with filters (server-filtered)
"map/agents/get"        // Get single agent details

// MESSAGING
"map/send"              // Send message to address

// STREAMING
"map/subscribe"         // Subscribe to event streams
"map/unsubscribe"       // Unsubscribe from streams

// AUTH
"map/auth/refresh"      // In-band token refresh
```

### Tier 2: Structure (Recommended)

```typescript
// AGENTS (write)
"map/agents/register"   // Add agent to system
"map/agents/spawn"      // Register + initial task (atomic)
"map/agents/unregister" // Remove agent
"map/agents/update"     // Update agent state/metadata

// LIFECYCLE CONTROL
"map/agents/stop"       // Request graceful stop
"map/agents/suspend"    // Pause agent
"map/agents/resume"     // Resume suspended agent

// STRUCTURE
"map/structure/graph"   // Get relationship graph

// SCOPES
"map/scopes/list"       // List scopes
"map/scopes/create"     // Create scope
"map/scopes/delete"     // Delete scope
"map/scopes/join"       // Agent joins scope
"map/scopes/leave"      // Agent leaves scope
```

### Tier 3: Extensions (Optional)

```typescript
// TASKS
"map/tasks/create"      // Create task
"map/tasks/assign"      // Assign to agent
"map/tasks/update"      // Update status
"map/tasks/list"        // List tasks

// STEERING
"map/inject"            // Context injection with delivery semantics

// FEDERATION
"map/federation/connect"    // Connect to peer MAP system
"map/federation/route"      // Route message to peer system
```

---

## Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary abstraction | Agent + relationships, then messages | Matches mental model of multi-agent systems |
| Topology | Configuration, not protocol | Same protocol supports orchestration (tree) and collaboration (mesh) |
| Participant model | Unified - agents and clients same protocol | Consistent semantics, transport optimization, natural federation |
| Transport | Pluggable (WebSocket, stdio, in-process, HTTP) | Same protocol, optimized for different deployment contexts |
| Messaging | Unified with metadata specialization | One message type; metadata determines behavior |
| Lifecycle | Descriptive, not prescriptive | Protocol records metadata; implementation decides enforcement |
| Visibility | First-class on agents and scopes | Configurable per-agent and per-scope |
| Wire format | JSON-RPC 2.0 | Consistent with ACP, A2A, MCP |

---

## Related Specs

- [01-open-questions.md](01-open-questions.md): Open Questions & Design Decisions
- [02-wire-protocol.md](02-wire-protocol.md): Wire Protocol & ACP Compatibility Layer
- [03-streaming-semantics.md](03-streaming-semantics.md): Streaming Semantics
- [04-error-handling.md](04-error-handling.md): Error Handling & Failure Modes
- [05-connection-model.md](05-connection-model.md): Connection Model & Client Patterns
- [06-visibility-permissions.md](06-visibility-permissions.md): Visibility & Permission Model
- [07-federation.md](07-federation.md): Federation & System-to-System Communication
- [08-macro-agent-migration.md](08-macro-agent-migration.md): macro-agent Migration Example

---

## References

- ACP: [Agent Client Protocol](https://agentclientprotocol.com)
- A2A: [Agent-to-Agent Protocol](https://a2a-protocol.org/latest/)
- MCP: [Model Context Protocol](https://modelcontextprotocol.io)
