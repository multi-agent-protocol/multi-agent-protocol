# MAP Federation & System-to-System Communication

This spec details how multiple MAP systems can communicate with each other, enabling distributed multi-agent architectures while maintaining internal transparency.

## Design Principles

1. **Internal transparency, external opacity**: Each system is transparent internally but appears as a single entity externally
2. **MAP-native federation**: Systems communicate via MAP protocol, not A2A
3. **Gateway pattern**: Dedicated agents handle inter-system routing
4. **Selective exposure**: Each system controls what's visible to peers

---

## Federation Model

### Conceptual View

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

### Why MAP for Federation (not A2A)?

| Aspect | A2A | MAP Federation |
|--------|-----|----------------|
| Visibility | Opaque peers | Configurable exposure |
| Streaming | Task-focused | Full event streams |
| Structure | Flat | Can expose partial hierarchy |
| Discovery | Agent Cards | Direct connection |
| Use case | Cross-org | Same-org distributed |

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
1. Handles connections from peer systems
2. Routes messages between internal agents and peers
3. Enforces exposure policies
4. Translates addresses

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
```

### Cross-System Messaging

```typescript
{
  "method": "map/federation/send",
  "params": {
    "peerId": "beta",
    "message": {
      "from": "agent_a",
      "to": { "agent": "agent_x" },
      "payload": {
        "type": "task_request",
        "data": { ... }
      }
    }
  }
}
```

---

## Addressing in Federation

```typescript
type MAPFederatedAddress =
  | { system: string; agent: string }
  | { system: string; scope: string }
  | { system: string; role: string }
  | { federation: true }
  | { federation: true; systems: string[] }
  | { gateway: string; target: MAPAddress };
```

---

## Use Cases

### Use Case 1: Distributed Workload

Alpha handles task coordination, Beta handles execution.

### Use Case 2: Regional Distribution

Each region has its own MAP system, federated for global coordination.

### Use Case 3: Secure Computation

Sensitive computation isolated in secure system, federated for I/O.

---

## Federation vs A2A: When to Use Which

| Scenario | Use | Reason |
|----------|-----|--------|
| Internal distributed system | MAP Federation | Need visibility, trust exists |
| External partner integration | A2A | Opaque peers, no visibility needed |
| Multi-cloud same org | MAP Federation | Control over both systems |
| Third-party service | A2A | Don't control peer system |
| Hierarchical multi-region | MAP Federation | Want structure visibility |
| Ad-hoc collaboration | A2A | Dynamic peer discovery |

---

## Single-Request Federation Auth

Federation connection can be completed in a single round-trip by including auth credentials in the initial `map/federation/connect` request. When the server can validate the credentials immediately, it returns a fully authenticated response — reducing setup from 2 RTT to 1 RTT.

### Flow: Single-Request Auth (Optimized)

```
System A                                      System B
   │                                              │
   │──── map/federation/connect ─────────────────►│
   │     { systemId, endpoint, auth: { ... } }    │
   │                                              │ ← Validates auth inline
   │◄─── response ────────────────────────────────│
   │     { connected: true, sessionId, principal } │
   │                                              │
```

### Flow: Auth Negotiation Fallback

If no credentials are provided, or validation fails recoverably, the server returns auth requirements:

```
System A                                      System B
   │                                              │
   │──── map/federation/connect ─────────────────►│
   │     { systemId, endpoint }                   │
   │                                              │
   │◄─── response ────────────────────────────────│
   │     { connected: false,                      │
   │       authRequired: { methods, challenge } } │
   │                                              │
   │──── map/federation/connect ─────────────────►│
   │     { systemId, endpoint, auth: { ... },     │
   │       authContext: { challenge } }            │
   │                                              │
   │◄─── response ────────────────────────────────│
   │     { connected: true, sessionId, principal } │
   │                                              │
```

---

## Security Considerations

### Authentication

```typescript
type FederationAuthMethod =
  | "bearer" | "api-key" | "mtls" | "none"
  | "did:wba" | "oauth2" | `x-${string}`;

type MAPFederationAuth =
  | { method: FederationAuthMethod; credentials?: string; metadata?: Record<string, unknown> }
  | DIDWBACredentials;

interface DIDWBACredentials {
  method: "did:wba";
  metadata: { did: string; proof: DIDWBAProof };
}
```

#### `did:wba` — Decentralized Identity for Federation

The `did:wba` method enables domain-anchored decentralized identity for federation. An identity like `did:wba:agents.example.com:gateway` resolves to a DID document at `https://agents.example.com/gateway/did.json` containing public keys and MAP service endpoints.

**Authentication flow:**
1. Connecting system provides its DID and a cryptographic proof (ECDSA P-256 over challenge nonce)
2. Receiving system resolves the DID document via HTTPS
3. Receiving system verifies the proof against the public key in the DID document
4. On success, the connecting system is authenticated as the DID principal

```json
{
  "method": "did:wba",
  "metadata": {
    "did": "did:wba:agents.example.com:gateway",
    "proof": {
      "type": "JsonWebSignature2020",
      "created": "2026-02-10T12:00:00.000Z",
      "challenge": "map_chal_01ABCDEFGHJ0123456789AB",
      "jws": "eyJhbGciOi..."
    }
  }
}
```

See `docs/09-authentication.md` for full details on all auth methods including `did:wba`, and `docs/11-anp-inspired-improvements.md` Proposal 1 for the design rationale.

### Message Signing

```typescript
interface MAPFederationEnvelope {
  message: MAPMessage;
  federation: {
    sourceSystem: string;
    targetSystem: string;
    hopCount: number;
    timestamp: number;
    signature?: string;
  };
}
```

---

## Failure Handling

### Message Queue During Outage

```typescript
interface MAPFederationQueueConfig {
  queueOnDisconnect: boolean;
  maxQueueDuration: number;
  maxQueueSize: number;
  overflowPolicy: "drop-oldest" | "drop-newest" | "reject-new";
}
```

---

## Open Questions

1. **Transitive federation**: If A↔B and B↔C, can A route to C via B?
2. ~~**Federation discovery**: Should there be a discovery mechanism for finding peers?~~ — Partially addressed by `did:wba` (DID document service endpoints) and proposed `.well-known` discovery (see `docs/11-anp-inspired-improvements.md` Proposal 2).
3. **Consistency**: How to handle concurrent updates across federated systems?
4. **Schema versioning**: What if peers have different protocol versions?
5. **Audit requirements**: What federation activity must be logged?
