---
title: Federation
parent: Protocol
nav_order: 8
description: "System-to-system communication and distributed architectures"
---

# Federation
{: .no_toc }

Multi-system communication enabling distributed multi-agent architectures.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Design Principles

1. **Internal transparency, external opacity** - Each system is transparent internally but appears as a single entity externally
2. **MAP-native federation** - Systems communicate via MAP protocol, not A2A
3. **Gateway pattern** - Dedicated agents handle inter-system routing
4. **Selective exposure** - Each system controls what's visible to peers

---

## Federation Model

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Federation                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────┐         ┌─────────────────────────┐        │
│  │   MAP System "Alpha"    │         │   MAP System "Beta"     │        │
│  │                         │         │                         │        │
│  │  Internal agents:       │         │  Internal agents:       │        │
│  │  ┌───┐ ┌───┐ ┌───┐     │   MAP   │  ┌───┐ ┌───┐ ┌───┐     │        │
│  │  │ A │ │ B │ │ C │     │ ◄─────► │  │ X │ │ Y │ │ Z │     │        │
│  │  └─┬─┘ └─┬─┘ └─┬─┘     │         │  └─┬─┘ └─┬─┘ └─┬─┘     │        │
│  │    └─────┼─────┘       │         │    └─────┼─────┘       │        │
│  │          │             │         │          │             │        │
│  │    ┌─────▼─────┐       │         │    ┌─────▼─────┐       │        │
│  │    │  Gateway  │───────┼─────────┼────│  Gateway  │       │        │
│  │    └───────────┘       │         │    └───────────┘       │        │
│  │                         │         │                         │        │
│  └─────────────────────────┘         └─────────────────────────┘        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Why MAP for Federation (not A2A)?

| Aspect | A2A | MAP Federation |
|:-------|:----|:---------------|
| Visibility | Opaque peers | Configurable exposure |
| Streaming | Task-focused | Full event streams |
| Structure | Flat | Can expose partial hierarchy |
| Discovery | Agent Cards | Direct connection |
| Use case | Cross-org | Same-org distributed |

{: .highlight }
MAP federation is for **systems that trust each other** and want shared visibility.

---

## Federation Configuration

```typescript
interface MAPFederationConfig {
  enabled: boolean;
  systemId: string;

  systemInfo: {
    name: string;
    version: string;
    endpoint: string;
  };

  peers: MAPPeerConfig[];
  exposure: MAPFederationExposure;
  security: MAPFederationSecurity;
}

interface MAPPeerConfig {
  systemId: string;
  endpoint: string;

  connection: {
    autoConnect: boolean;
    reconnect: boolean;
    healthCheckInterval: number;
  };

  accepts: {
    messageTypes: string[];
    maxMessagesPerMinute: number;
  };

  auth: {
    method: "mutual-tls" | "bearer" | "api-key";
    credentials: unknown;
  };
}

interface MAPFederationExposure {
  agents: {
    expose: "none" | "gateway" | "tagged" | "all";
    tags?: string[];
  };
  scopes: {
    expose: "none" | "tagged" | "all";
    tags?: string[];
  };
  events: {
    expose: string[];
  };
  structure: boolean;
}
```

---

## Gateway Agent Pattern

Each system has a gateway agent that:

1. **Handles connections** from peer systems
2. **Routes messages** between internal agents and peers
3. **Enforces exposure policies**
4. **Translates addresses** between systems

```typescript
interface GatewayAgent {
  id: string;
  role: "gateway";

  // Connected peers
  peers: Map<string, PeerConnection>;

  // Exposure rules
  exposure: MAPFederationExposure;

  // Message routing
  routeToRemote(message: MAPMessage, peerId: string): Promise<void>;
  routeFromRemote(message: MAPMessage, peerId: string): Promise<void>;
}
```

---

## Federation Protocol

### Connection Establishment

```typescript
{
  "method": "map/federation/connect",
  "params": {
    "systemId": "alpha",
    "systemInfo": {
      "name": "Alpha System",
      "version": "1.0.0",
      "endpoint": "wss://alpha.example.com/map"
    },
    "protocolVersion": "2025-01-01",
    "auth": {
      "method": "mutual-tls",
      "certificate": "..."
    },
    "exposure": {
      "agents": { "expose": "tagged", "tags": ["public"] },
      "scopes": { "expose": "tagged", "tags": ["federation"] },
      "events": { "expose": ["message.sent", "agent.state"] }
    }
  }
}

// Response
{
  "result": {
    "accepted": true,
    "peerId": "peer_alpha_001",
    "peerExposure": {
      "agents": { "expose": "tagged", "tags": ["public"] },
      "scopes": { "expose": "tagged", "tags": ["shared"] },
      "events": { "expose": ["message.sent"] }
    }
  }
}
```

### Cross-System Messaging

```typescript
{
  "method": "map/federation/send",
  "params": {
    "peerId": "beta",
    "message": {
      "from": { "system": "alpha", "agent": "agent_a" },
      "to": { "system": "beta", "agent": "agent_x" },
      "payload": {
        "type": "task_request",
        "data": { ... }
      }
    },
    "meta": {
      "ttl": 30000,
      "requireAck": true
    }
  }
}
```

---

## Federated Addressing

```typescript
type MAPFederatedAddress =
  // Specific agent in specific system
  | { system: string; agent: string }

  // Scope in specific system
  | { system: string; scope: string }

  // Role in specific system
  | { system: string; role: string }

  // Broadcast to all federated systems
  | { federation: true }

  // Broadcast to specific systems
  | { federation: true; systems: string[] }

  // Route through gateway
  | { gateway: string; target: MAPAddress };
```

### Address Resolution

```typescript
// Local agent
{ agent: "agent_001" }

// Remote agent
{ system: "beta", agent: "agent_x" }

// Remote scope
{ system: "beta", scope: "shared_workspace" }

// All federation peers
{ federation: true }
```

---

## Use Cases

### Use Case 1: Distributed Workload

Alpha handles task coordination, Beta handles execution:

```
Alpha System                    Beta System
┌────────────────┐              ┌────────────────┐
│  Coordinator   │              │   Executor 1   │
│       │        │    tasks     │       │        │
│  Gateway  ─────┼──────────────┼─► Gateway      │
│       │        │   results    │       │        │
│  Dashboard ◄───┼──────────────┼───────┘        │
└────────────────┘              │   Executor 2   │
                                └────────────────┘
```

### Use Case 2: Regional Distribution

Each region has its own MAP system:

```
US Region          EU Region          Asia Region
┌──────────┐       ┌──────────┐       ┌──────────┐
│  Agents  │       │  Agents  │       │  Agents  │
│    │     │       │    │     │       │    │     │
│ Gateway ─┼───────┼─ Gateway ┼───────┼─ Gateway │
└──────────┘       └──────────┘       └──────────┘
              Global Coordination
```

### Use Case 3: Secure Computation

Sensitive work isolated in secure system:

```
Public System              Secure System (airgapped)
┌──────────────┐           ┌──────────────┐
│  User Agent  │           │  Processor   │
│      │       │  encrypt  │      │       │
│  Gateway ────┼───────────┼─► Gateway    │
│      │       │  results  │      │       │
│  Aggregator ◄┼───────────┼──────┘       │
└──────────────┘           └──────────────┘
```

---

## Security

### Authentication

```typescript
interface FederationSecurity {
  // Required auth for peer connections
  auth: {
    required: true;
    methods: ["mutual-tls", "bearer"];
  };

  // Message signing
  signing: {
    enabled: true;
    algorithm: "RS256";
    keyRotationInterval: 86400;  // 24 hours
  };

  // Rate limiting per peer
  rateLimiting: {
    messagesPerMinute: 1000;
    connectionsPerPeer: 5;
  };
}
```

### Message Signing

```typescript
interface SignedFederationMessage {
  message: MAPMessage;
  signature: {
    algorithm: string;
    keyId: string;
    value: string;
    timestamp: number;
  };
}
```

---

## Failure Handling

### Peer Unavailable

```typescript
// Queue messages for later delivery
{
  "method": "map/federation/queue",
  "params": {
    "peerId": "beta",
    "message": { ... },
    "options": {
      "maxRetries": 5,
      "retryDelay": 5000,
      "expireAfter": 3600000  // 1 hour
    }
  }
}
```

### Reconnection

```typescript
// Automatic reconnection with state sync
{
  "method": "map/federation/reconnect",
  "params": {
    "peerId": "beta",
    "lastEventId": "evt_abc123",
    "queuedMessages": 15
  }
}
```

---

## Federation vs A2A: When to Use Which

| Scenario | Use | Reason |
|:---------|:----|:-------|
| Internal distributed system | MAP Federation | Need visibility, trust exists |
| Cross-organization work | A2A | Different trust domains |
| Multi-region deployment | MAP Federation | Same org, need coordination |
| Partner integration | A2A | Maintain separation |
| Development/staging sync | MAP Federation | Full visibility needed |

---

## Next Steps

- [Design](./design.html) - Overall protocol architecture
- [Authentication](./authentication.html) - Federation auth details
