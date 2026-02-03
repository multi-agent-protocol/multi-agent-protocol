---
title: Design Gaps
parent: Advanced
nav_order: 1
description: "Implementation roadmap and gap analysis"
---

# Design Gaps
{: .no_toc }

Gap analysis between the protocol specification and SDK implementation.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

This document tracks the gaps between the MAP protocol specification and the TypeScript SDK implementation. It serves as a roadmap for future development.

---

## Gap Summary

| Category | Spec Alignment | Priority | Status |
|:---------|:---------------|:---------|:-------|
| Core Protocol | 90% | P0 | Mostly Complete |
| Streaming & Events | 75% | P0 | In Progress |
| Permissions | 60% | P1 | Partial |
| Federation | 30% | P2 | Planned |
| Wire Protocol | 85% | P0 | Mostly Complete |
| Error Handling | 70% | P1 | In Progress |

---

## Priority Definitions

| Priority | Description |
|:---------|:------------|
| **P0** | Critical for MVP, blocks adoption |
| **P1** | Important for production use |
| **P2** | Nice to have, enhances functionality |
| **P3** | Future consideration |

---

## Category: Streaming & Events

### GAP-S1: Backpressure Implementation
{: .text-yellow-300 }

**Priority:** P0
**Status:** Partial

The spec defines client-side acknowledgment for flow control:

```typescript
// Spec defines this, not yet implemented
{
  "method": "map/subscribe.ack",
  "params": {
    "subscriptionId": "sub_001",
    "upToSequence": 100
  }
}
```

**Current state:** Basic subscription works, but backpressure signals are not implemented.

**Plan:** Implement in SDK v0.1.0

---

### GAP-S2: Event Replay API
{: .text-yellow-300 }

**Priority:** P1
**Status:** Partial

Replay API is defined in spec but not fully implemented:

- Time-based replay: Not implemented
- Event-based replay: Partial (afterEventId works)
- Snapshots: Not implemented

**Plan:** Implement in SDK v0.2.0

---

### GAP-S3: Ordering Guarantees
{: .text-green-200 }

**Priority:** P1
**Status:** Complete

Per-agent ordering is implemented. Causal and total ordering are available via configuration.

---

## Category: Permissions

### GAP-P1: 4-Layer Permission Model
{: .text-red-300 }

**Priority:** P1
**Status:** Partial

The spec defines a 4-layer permission model:
1. System configuration ✓
2. Client permissions - Partial
3. Scope permissions - Not implemented
4. Agent permissions - Partial

**Plan:** Implement layers 2-4 in SDK v0.2.0

---

### GAP-P2: Dynamic Permission Updates
{: .text-red-300 }

**Priority:** P2
**Status:** Not Started

Runtime permission changes via `map/permissions/update` not implemented.

---

## Category: Federation

### GAP-F1: Gateway Agent Pattern
{: .text-red-300 }

**Priority:** P2
**Status:** Planned

The spec defines gateway agents for federation. Current SDK has `GatewayConnection` class but:
- Peer connection not implemented
- Cross-system routing not implemented
- Exposure policies not implemented

**Plan:** Implement in SDK v0.3.0

---

### GAP-F2: Federated Addressing
{: .text-red-300 }

**Priority:** P2
**Status:** Not Started

Address formats like `{ system: "beta", agent: "agent_x" }` not supported.

---

## Category: Wire Protocol

### GAP-W1: ACP Compatibility Mode
{: .text-yellow-300 }

**Priority:** P1
**Status:** Partial

ACP-over-MAP tunneling exists but feature degradation table not fully implemented.

---

### GAP-W2: HTTP/SSE Transport
{: .text-yellow-300 }

**Priority:** P2
**Status:** Not Started

Only WebSocket and stdio transports are implemented. HTTP+SSE for stateless clients is not available.

---

## Category: Error Handling

### GAP-E1: Circuit Breakers
{: .text-yellow-300 }

**Priority:** P1
**Status:** Partial

Per-agent circuit breakers defined in spec. Basic implementation exists but:
- Half-open state not implemented
- Configurable thresholds not exposed

---

### GAP-E2: Distributed Tracing
{: .text-red-300 }

**Priority:** P2
**Status:** Not Started

TraceId propagation defined in spec but not implemented.

---

## Implementation Roadmap

### Phase 1: Core Stability (v0.1.0)

- Complete backpressure implementation
- Full error code support
- Connection state machine refinements

### Phase 2: Production Ready (v0.2.0)

- 4-layer permission model
- Event replay API
- HTTP/SSE transport
- Circuit breaker improvements

### Phase 3: Federation (v0.3.0)

- Gateway agent implementation
- Federated addressing
- Cross-system routing

### Phase 4: Enterprise (v0.4.0)

- Distributed tracing
- Advanced monitoring
- Performance optimizations

---

## Contributing

To help close these gaps:

1. Check the [GitHub issues](https://github.com/multi-agent-protocol/multi-agent-protocol/issues) for related tasks
2. Review the relevant spec section
3. Implement with tests
4. Update this document when complete
