---
title: Protocol
nav_order: 3
has_children: true
description: "MAP Protocol Specification"
permalink: /protocol/
---

# Protocol Specification

The complete specification for the Multi-Agent Protocol.
{: .fs-6 .fw-300 }

---

## Overview

MAP is a JSON-RPC 2.0 based protocol designed for **observing, coordinating, and routing messages within multi-agent AI systems**. Unlike protocols designed for single-agent interaction (ACP) or peer-to-peer agent delegation (A2A), MAP provides a **window into** a multi-agent system with visibility into its internal structure, agent relationships, and message flows.

---

## Core Sections

| Section | Description |
|:--------|:------------|
| [Design](./design.html) | Core architecture, philosophy, and participant model |
| [Wire Protocol](./wire-protocol.html) | JSON-RPC message format and transport bindings |
| [Streaming](./streaming.html) | Event subscriptions, filtering, and replay |
| [Connection Model](./connection-model.html) | Connection lifecycle and client patterns |
| [Error Handling](./error-handling.html) | Error taxonomy and recovery mechanisms |
| [Authentication](./authentication.html) | Authentication methods and flows |
| [Permissions](./permissions.html) | 4-layer visibility and permission model |
| [Federation](./federation.html) | System-to-system communication |

---

## Protocol Methods

The protocol defines **27 methods** across three tiers:

### Core (Required)

These methods MUST be implemented by all MAP-compliant servers:

| Method | Description |
|:-------|:------------|
| `map/connect` | Establish connection and negotiate capabilities |
| `map/disconnect` | Clean shutdown with optional cascade |
| `map/send` | Send message to agents, scopes, or roles |
| `map/subscribe` | Subscribe to event streams with filtering |
| `map/unsubscribe` | Cancel active subscriptions |
| `map/agents/list` | List registered agents |
| `map/agents/get` | Get details for specific agent |

### Structure (Recommended)

These methods enable full agent lifecycle and scope management:

**Agent Lifecycle:**
- `map/agents/register` - Register a new agent
- `map/agents/spawn` - Create child agent
- `map/agents/unregister` - Remove agent from system
- `map/agents/update` - Update agent metadata
- `map/agents/stop` - Request agent termination
- `map/agents/suspend` - Pause agent processing
- `map/agents/resume` - Resume suspended agent

**Scope Management:**
- `map/scopes/create` - Create new scope
- `map/scopes/join` - Join a scope
- `map/scopes/leave` - Leave a scope
- `map/scopes/list` - List available scopes

### Extensions (Optional)

**Federation:**
- `map/federation/connect` - Establish peer connection
- `map/federation/route` - Route to remote system

**Session Management:**
- `map/sessions/list` - List active sessions
- `map/sessions/get` - Get session details

**Steering:**
- `map/inject` - Inject context into agent

---

## Design Principles

1. **Topology is configuration, not protocol** - Same protocol supports hierarchical orchestration and peer collaboration
2. **Unified messaging with metadata** - One message type with metadata that specializes behavior
3. **Visibility is first-class** - Agents and scopes have explicit visibility settings
4. **Lifecycle is descriptive, not prescriptive** - Protocol records lifecycle metadata; implementations decide enforcement
5. **Extensibility at every layer** - States, lifecycle patterns, visibility levels are all extensible
6. **Unified participant model** - Agents and clients speak the same protocol

---

## Quick Reference

### Message Types

```typescript
// Request (expects response)
{ jsonrpc: "2.0", id: string, method: string, params?: unknown }

// Response
{ jsonrpc: "2.0", id: string, result?: unknown, error?: MAPError }

// Notification (no response)
{ jsonrpc: "2.0", method: string, params?: unknown }
```

### Participant Types

| Type | Role | Capabilities |
|:-----|:-----|:-------------|
| **Agent** | Worker | Register, send/receive, join scopes, spawn children |
| **Client** | Observer | Subscribe, query, send messages (with permission) |
| **Gateway** | Bridge | Route between federated systems |

### Transport Bindings

| Transport | Use Case | Framing |
|:----------|:---------|:--------|
| WebSocket | Remote clients, federation | JSON messages |
| stdio | Subprocess agents | NDJSON (newline-delimited) |
| In-process | Co-located agents | Direct object passing |
| HTTP + SSE | Stateless clients | POST + Server-Sent Events |
