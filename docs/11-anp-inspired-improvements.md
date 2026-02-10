# MAP Improvements Inspired by the AI Agent Protocol (ANP)

This spec proposes six improvements to MAP inspired by the W3C Community Group [Agent Network Protocol (ANP)](https://github.com/w3c-cg/ai-agent-protocol). ANP aims to be the "HTTP of the Agentic Web" — a decentralized protocol for AI agents to discover, authenticate, and interact across the open internet. While MAP and ANP occupy different niches (internal orchestration vs. open-internet identity), several ANP ideas strengthen MAP's federation, discovery, and privacy stories.

## Context: MAP vs ANP

| Dimension | MAP | ANP |
|-----------|-----|-----|
| **Primary concern** | Internal multi-agent orchestration & observability | Internet-scale agent identity & discovery |
| **Identity model** | Server-assigned participant IDs | Decentralized DIDs (`did:wba`) anchored to DNS/HTTPS |
| **Discovery** | Runtime queries (`agents/list`, subscriptions) | `.well-known` endpoints + web crawling |
| **Transport** | Transport-agnostic (WebSocket, stdio, in-process, HTTP/SSE) | HTTP/HTTPS only |
| **Wire format** | JSON-RPC 2.0 | HTTP + JSON-LD (meta-protocol negotiation) |

These proposals are scoped to MAP's federation and cross-system layers. They do not change how MAP works for internal, single-system deployments.

---

## Proposal 1: Decentralized Identity via `did:wba` for Federation

### Status: 🟡 Important — Should resolve before v1.0

### Problem

MAP federation currently uses server-assigned IDs and pre-configured peer credentials (`mutual-tls`, `bearer`, `api-key`). This requires:
- Manual allowlist maintenance on every federated server
- No globally-unique, stable agent identities across system boundaries
- Trust establishment requires out-of-band credential exchange

For federations with more than a handful of peers, this doesn't scale.

### Proposal

Add `did:wba` as a federation authentication method. `did:wba` (Web-Based Agent DID) anchors identity to domain ownership via HTTPS. An identity like `did:wba:agents.example.com:worker-alpha` resolves to a DID document at `https://agents.example.com/worker-alpha/did.json`.

#### DID Document Resolution

```
did:wba:agents.example.com:worker-alpha
    → GET https://agents.example.com/worker-alpha/did.json
    → Returns DID Document with:
       - Public keys for verification
       - Service endpoints (MAP WebSocket URL)
       - MAP-specific metadata (capabilities, protocol version)
```

#### Extended Auth Method

Add `did:wba` to the existing authentication methods in `docs/09-authentication.md`:

| Method | Description | Use Case |
|--------|-------------|----------|
| `none` | No authentication | Local subprocess, development |
| `bearer` | Bearer token (JWT or opaque) | OAuth2, IdP, M2M tokens |
| `api-key` | Simple API key | Simple integrations |
| `mtls` | Mutual TLS | High-security service-to-service |
| **`did:wba`** | **DID-based, domain-anchored** | **Cross-org federation, open discovery** |

#### Authentication Flow

```
Peer System A                                      Peer System B
    │                                                    │
    │── map/federation/connect ─────────────────────────►│
    │   { auth: {                                        │
    │       method: "did:wba",                           │
    │       did: "did:wba:alpha.example.com:gateway",    │
    │       proof: {                                     │
    │         type: "JsonWebSignature2020",              │
    │         created: "2026-02-10T...",                 │
    │         challenge: "<server-provided-nonce>",      │
    │         jws: "eyJ..."                              │
    │       }                                            │
    │     }                                              │
    │   }                                                │
    │                                                    │
    │   [Server B resolves DID document via HTTPS]       │
    │   [Server B verifies proof against public key]     │
    │   [Server B checks domain matches expected peer]   │
    │                                                    │
    │◄── connect response ──────────────────────────────│
    │   { principal: {                                   │
    │       id: "did:wba:alpha.example.com:gateway",     │
    │       issuer: "https://alpha.example.com",         │
    │       claims: { ... }                              │
    │     }                                              │
    │   }                                                │
```

#### Wire Protocol Types

```typescript
// New auth credential variant
interface DIDWBACredentials {
  method: "did:wba";

  /** The DID of the connecting system/agent */
  did: string;

  /** Cryptographic proof of DID ownership */
  proof: {
    /** Proof type (e.g., "JsonWebSignature2020", "Ed25519Signature2020") */
    type: string;

    /** ISO 8601 timestamp */
    created: string;

    /** Server-provided nonce (prevents replay) */
    challenge: string;

    /** The signature over (challenge + did + created) */
    jws: string;
  };
}

// Extended federation auth
type MAPFederationAuth =
  | { method: "mutual-tls"; certificate: string }
  | { method: "bearer"; token: string }
  | { method: "api-key"; key: string }
  | { method: "oauth2"; config: OAuth2Config }
  | DIDWBACredentials;
```

#### DID Document with MAP Service Endpoint

```json
{
  "@context": ["https://www.w3.org/ns/did/v1", "https://map-protocol.org/ns/v1"],
  "id": "did:wba:alpha.example.com:gateway",
  "verificationMethod": [{
    "id": "did:wba:alpha.example.com:gateway#key-1",
    "type": "JsonWebKey2020",
    "controller": "did:wba:alpha.example.com:gateway",
    "publicKeyJwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
  }],
  "authentication": ["did:wba:alpha.example.com:gateway#key-1"],
  "service": [{
    "id": "did:wba:alpha.example.com:gateway#map",
    "type": "MAPFederationEndpoint",
    "serviceEndpoint": "wss://alpha.example.com/map/federation",
    "mapProtocolVersion": 1,
    "mapCapabilities": {
      "streaming": true,
      "federation": true
    }
  }]
}
```

### Trust Model

DID resolution provides **domain-verified identity** — if you trust the domain, you trust the DID. This is weaker than mutual TLS (no CA chain) but stronger than bearer tokens (domain ownership is cryptographically verifiable without pre-shared secrets).

Trust levels in MAP federation:

| Auth Method | Trust Basis | Setup Overhead | Scalability |
|-------------|-------------|----------------|-------------|
| `mtls` | Certificate authority chain | High (cert management) | Medium |
| `bearer` | Pre-shared token/JWKS | Medium (token distribution) | Medium |
| `api-key` | Pre-shared secret | Low | Low |
| `did:wba` | Domain ownership via DNS/HTTPS | Low (publish DID doc) | High |

### Relationship to Existing Auth

`did:wba` is additive. It does not replace existing methods. Systems can support multiple auth methods and negotiate during `map/federation/connect`. A practical deployment might use `did:wba` for initial discovery and identity verification, then upgrade to `bearer` tokens (JWT signed by the verified DID key) for ongoing session authentication.

### Impacts

- **`docs/09-authentication.md`**: Add `did:wba` method, resolution flow, proof format
- **`docs/07-federation.md`**: Add `did:wba` to `MAPFederationAuth`, document trust model
- **`ts-sdk`**: Add DID resolution utility, proof generation/verification
- **`schema/schema.json`**: Extend auth credential union type

### Open Questions

1. **DID document caching**: How long should resolved DID documents be cached? Should the protocol mandate a TTL or leave it to implementations?
2. **Key rotation**: When a peer rotates keys, should there be a grace period where both old and new keys are valid?
3. **Revocation**: DID documents can be updated to remove keys, but there's no revocation list. Is this sufficient for MAP's trust model?

---

## Proposal 2: `.well-known` Federation Discovery Endpoint

### Status: 🟢 Deferrable — Can resolve in later versions

### Problem

MAP federation requires explicit peer configuration (`MAPPeerConfig[]` in `MAPFederationConfig`). This means:
- Every peer must be manually added to every other peer's configuration
- There's no standard way to discover what MAP systems exist at a domain
- No machine-readable advertisement of federation capabilities

This is identified as an open question in `docs/07-federation.md`:
> **Q: Federation Discovery** — Should there be a discovery mechanism for finding peers?

And in `docs/01-open-questions.md` as Q6.2 (pending).

### Proposal

Define a `/.well-known/map-federation` endpoint (per [RFC 8615](https://tools.ietf.org/html/rfc8615)) that MAP systems can serve to advertise their federation capabilities.

#### Discovery Document

```
GET https://example.com/.well-known/map-federation
Content-Type: application/json
```

```typescript
interface MAPFederationDiscovery {
  /** Schema version for this discovery document */
  version: 1;

  /** System identifier (matches MAPFederationConfig.systemId) */
  systemId: string;

  /** Human-readable system name */
  name: string;

  /** System description */
  description?: string;

  /** MAP protocol version(s) supported */
  protocolVersions: number[];

  /** Federation connection endpoints */
  endpoints: MAPFederationEndpoint[];

  /** Supported authentication methods (in preference order) */
  authMethods: AuthMethod[];

  /** What this system exposes to federation peers */
  exposure: {
    /** Whether the system accepts new federation peers */
    acceptsPeers: boolean;

    /** High-level description of exposed capabilities */
    capabilities: string[];

    /** Agent roles available to federation peers */
    exposedRoles?: string[];

    /** Scope tags available to federation peers */
    exposedScopeTags?: string[];
  };

  /** DID for this system's gateway (if did:wba auth supported) */
  did?: string;

  /** Contact/governance information */
  contact?: {
    url?: string;
    email?: string;
  };

  /** When this document was last updated (ISO 8601) */
  updatedAt: string;
}

interface MAPFederationEndpoint {
  /** Transport type */
  transport: "websocket" | "http-sse";

  /** Connection URL */
  url: string;

  /** Geographic region hint (for latency-aware peer selection) */
  region?: string;
}
```

#### Example Discovery Document

```json
{
  "version": 1,
  "systemId": "alpha-prod",
  "name": "Alpha AI System",
  "description": "Multi-agent orchestration for document processing",
  "protocolVersions": [1],
  "endpoints": [
    {
      "transport": "websocket",
      "url": "wss://alpha.example.com/map/federation",
      "region": "us-east-1"
    }
  ],
  "authMethods": ["did:wba", "bearer", "mtls"],
  "exposure": {
    "acceptsPeers": true,
    "capabilities": ["document-processing", "ocr", "summarization"],
    "exposedRoles": ["processor", "summarizer"],
    "exposedScopeTags": ["federation"]
  },
  "did": "did:wba:alpha.example.com:gateway",
  "contact": {
    "url": "https://alpha.example.com/federation-docs"
  },
  "updatedAt": "2026-02-10T00:00:00Z"
}
```

#### Discovery Flow

```
System B wants to federate with alpha.example.com:

1. GET https://alpha.example.com/.well-known/map-federation
   → Receives discovery document

2. Inspect authMethods, endpoints, exposure
   → Determines compatibility

3. Resolve DID (if did:wba supported)
   GET https://alpha.example.com/gateway/did.json
   → Gets public key for authentication

4. Connect to federation endpoint
   → map/federation/connect with appropriate auth
```

#### Auto-Discovery (Optional Extension)

For environments that want automatic peer discovery, systems can optionally publish DNS TXT records:

```
_map-federation.example.com.  TXT  "v=MAP1; endpoint=https://example.com/.well-known/map-federation"
```

This enables DNS-based service discovery without requiring prior knowledge of specific URLs. This is strictly optional — most deployments will use direct URL configuration.

### Security Considerations

1. **The discovery document is public information.** It should not contain secrets, internal topology, or sensitive agent details. It advertises only what the system is willing to expose to potential federation peers.
2. **Connection still requires authentication.** Discovery is read-only. The actual federation connection goes through the full auth flow (`map/federation/connect`).
3. **Rate limiting.** The `.well-known` endpoint should be rate-limited to prevent scraping.
4. **HTTPS required.** The discovery endpoint MUST be served over HTTPS to prevent MITM attacks on the discovery document.

### Relationship to Open Questions

This proposal resolves **Q6.2: Federation Discovery** from `docs/01-open-questions.md`:
- **Decision**: Option D — DNS-based + well-known endpoint
- **Rationale**: Leverages existing web infrastructure (HTTPS, DNS). Low setup overhead. No central registry required. Compatible with `did:wba` identity. Discovery is read-only and safe.

### Impacts

- **`docs/07-federation.md`**: Add discovery section, reference `.well-known` format
- **`docs/01-open-questions.md`**: Resolve Q6.2
- **`ts-sdk`**: Add discovery client utility (`fetchFederationDiscovery(domain)`)
- **New**: Register `map-federation` with IANA well-known URI registry (when protocol matures)

---

## Proposal 3: Linked Capability Documents for Agent Discovery

### Status: 🟡 Important — Should resolve before v1.0

### Problem

MAP agents currently describe themselves with minimal metadata:
- `role?: string` — a single string
- `metadata?: Record<string, unknown>` — unstructured bag of key-values
- `environment?: AgentEnvironment` — compute environment info

This is insufficient for dynamic orchestration scenarios where:
- An orchestrator needs to discover which agents can handle a given task type
- A federation peer needs to understand what capabilities a remote system exposes
- A dashboard needs to display meaningful information about what agents do

ANP addresses this by making every agent serve a structured **Agent Description Document** that links to detailed capability declarations, forming a navigable web of capabilities.

### Proposal

Introduce an optional, structured **Agent Capability Descriptor** that agents can publish at registration time. The descriptor follows a linked-data model: top-level capabilities link to detailed interface specifications, which can link to schema definitions.

#### Capability Descriptor Schema

```typescript
/**
 * Structured capability descriptor for an agent.
 * Published at registration time via the `capabilities` field on MAPAgent.
 * Optional — agents without descriptors still work via role/metadata.
 */
interface MAPAgentCapabilityDescriptor {
  /** Schema version */
  version: 1;

  /** Human-readable summary of what this agent does */
  description: string;

  /** Capability categories this agent supports */
  capabilities: MAPCapabilityDeclaration[];

  /** Input types this agent can accept */
  accepts?: MAPInterfaceSpec[];

  /** Output types this agent can produce */
  produces?: MAPInterfaceSpec[];

  /** Link to full documentation (external URL) */
  documentationUrl?: string;

  /** Semantic tags for discovery (searchable) */
  tags?: string[];
}

interface MAPCapabilityDeclaration {
  /** Machine-readable capability identifier (namespaced) */
  id: string;

  /** Human-readable capability name */
  name: string;

  /** What this capability does */
  description: string;

  /** Link to detailed interface spec (URL or inline) */
  interfaceRef?: string;

  /** Inline interface specification (alternative to interfaceRef) */
  interface?: MAPInterfaceSpec;
}

interface MAPInterfaceSpec {
  /** Content type (e.g., "application/json", "text/plain") */
  contentType: string;

  /** JSON Schema for the expected payload structure */
  schema?: Record<string, unknown>;

  /** Link to external schema definition */
  schemaRef?: string;

  /** Example payload */
  example?: unknown;
}
```

#### Registration with Capabilities

```typescript
// Agent registers with capability descriptor
{
  "method": "map/agents/register",
  "params": {
    "name": "document-processor",
    "role": "processor",
    "capabilities": {
      "version": 1,
      "description": "Processes documents: extracts text, generates summaries, identifies entities",
      "capabilities": [
        {
          "id": "doc:extract-text",
          "name": "Text Extraction",
          "description": "Extracts text content from PDF, DOCX, and image files",
          "interface": {
            "contentType": "application/json",
            "schema": {
              "type": "object",
              "properties": {
                "documentUrl": { "type": "string", "format": "uri" },
                "format": { "enum": ["pdf", "docx", "png", "jpg"] }
              },
              "required": ["documentUrl"]
            }
          }
        },
        {
          "id": "doc:summarize",
          "name": "Document Summarization",
          "description": "Generates concise summaries of text documents",
          "interface": {
            "contentType": "application/json",
            "schema": {
              "type": "object",
              "properties": {
                "text": { "type": "string" },
                "maxLength": { "type": "integer" },
                "style": { "enum": ["bullet-points", "paragraph", "executive"] }
              },
              "required": ["text"]
            }
          }
        }
      ],
      "tags": ["document-processing", "nlp", "extraction", "summarization"]
    }
  }
}
```

#### Capability-Based Queries

Extend `map/agents/list` to support filtering by capability:

```typescript
// Find agents that can summarize documents
{
  "method": "map/agents/list",
  "params": {
    "filter": {
      "capabilityId": "doc:summarize"
    }
  }
}

// Find agents by semantic tag
{
  "method": "map/agents/list",
  "params": {
    "filter": {
      "tags": ["document-processing"]
    }
  }
}

// Find agents that accept a specific content type
{
  "method": "map/agents/list",
  "params": {
    "filter": {
      "accepts": "application/pdf"
    }
  }
}
```

#### Linked Navigation (for Federation)

In federation scenarios, exposed agents can reference external capability documents:

```typescript
{
  "id": "doc:summarize",
  "name": "Document Summarization",
  "description": "Generates concise summaries",
  // Link to detailed spec hosted by the federated system
  "interfaceRef": "https://alpha.example.com/capabilities/doc-summarize.json"
}
```

This allows federated systems to serve detailed capability specifications without bloating the federation protocol messages. Peers fetch detailed specs only when needed.

### Relationship to Existing Structures

This extends (not replaces) the existing agent model:

| Current | With Capability Descriptor |
|---------|---------------------------|
| `role: "processor"` | Still works — quick filtering |
| `metadata: { ... }` | Still works — unstructured extensions |
| — | `capabilities: { ... }` — structured, queryable, linked |

Agents that don't publish capability descriptors are fully backwards-compatible. The descriptor is optional.

### Impacts

- **`docs/00-design-specification.md`**: Add capability descriptor to agent model
- **`ts-sdk/src/types/index.ts`**: Add `MAPAgentCapabilityDescriptor` types
- **`ts-sdk/src/server/agents/`**: Extend registry to index capabilities for querying
- **`schema/schema.json`**: Add capability descriptor schema, extend agent list filters

### Open Questions

1. **Capability namespacing**: Should capability IDs use a formal namespace (e.g., `urn:map:capability:doc:summarize`) or informal prefixes (`doc:summarize`)?
2. **Schema format**: JSON Schema is proposed here. Should we also support other schema formats (e.g., TypeBox, Zod references)?
3. **Capability inheritance**: If a parent agent has capabilities, do spawned children inherit them?

---

## Proposal 4: Meta-Protocol Negotiation for Federation

### Status: 🟢 Deferrable — Can resolve in later versions

### Problem

MAP federation currently assumes both sides speak MAP. But in practice, a MAP system may need to federate with:
- An A2A-based system (Google's Agent-to-Agent protocol)
- An ACP-based system (single-agent systems that want to expose themselves)
- A future protocol not yet designed

Currently, if System A speaks MAP and System B speaks A2A, there's no standard way for them to negotiate which protocol to use. The gateway must be hardcoded for each protocol.

ANP addresses this with a "Layer 2" meta-protocol where agents negotiate *which application protocol* to use for a given interaction.

### Proposal

Add an optional meta-protocol negotiation step to `map/federation/connect`. Before committing to MAP as the federation protocol, peers exchange their supported protocols and agree on one.

#### Negotiation Flow

```
System A                                           System B
   │                                                   │
   │── map/federation/connect ────────────────────────►│
   │   { protocols: [                                  │
   │       { id: "map", version: 1, priority: 1 },    │
   │       { id: "a2a", version: "2025-05-01",         │
   │         priority: 2 }                             │
   │     ],                                            │
   │     preferredProtocol: "map"                      │
   │   }                                               │
   │                                                   │
   │◄── connect response ─────────────────────────────│
   │   { selectedProtocol: {                           │
   │       id: "map",                                  │
   │       version: 1                                  │
   │     },                                            │
   │     fallbackAvailable: ["a2a"]                    │
   │   }                                               │
   │                                                   │
   │   [Proceeds with MAP federation protocol]         │
```

If neither side supports a common protocol, the connection is rejected with a clear error.

#### Wire Protocol Types

```typescript
interface MAPProtocolOption {
  /** Protocol identifier */
  id: "map" | "a2a" | "acp" | string;

  /** Protocol version */
  version: string | number;

  /** Priority (1 = highest) */
  priority: number;

  /** Protocol-specific connection parameters */
  params?: Record<string, unknown>;
}

// Extended federation connect params
interface MAPFederationConnectParams {
  // ... existing fields ...

  /**
   * Optional: Supported protocols in preference order.
   * If omitted, only MAP is assumed (backwards-compatible).
   */
  protocols?: MAPProtocolOption[];

  /** Explicitly preferred protocol (shorthand when only one option) */
  preferredProtocol?: string;
}

// Extended federation connect response
interface MAPFederationConnectResult {
  // ... existing fields ...

  /** The protocol selected for this federation link */
  selectedProtocol: {
    id: string;
    version: string | number;
  };

  /** Other protocols available if the primary fails */
  fallbackAvailable?: string[];
}
```

#### Gateway Protocol Adapters

The gateway agent pattern from `docs/07-federation.md` naturally supports this. Each gateway can have protocol adapters:

```
┌─────────────────────────────────────────────────────────┐
│                    MAP Gateway Agent                      │
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Protocol Adapter Layer                │   │
│  │                                                    │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐          │   │
│  │  │   MAP   │  │   A2A   │  │   ACP   │  ...      │   │
│  │  │ Adapter │  │ Adapter │  │ Adapter │          │   │
│  │  └────┬────┘  └────┬────┘  └────┬────┘          │   │
│  │       └─────────────┼───────────┘                │   │
│  │                     │                             │   │
│  │            Unified Internal Model                 │   │
│  └──────────────────────────────────────────────────┘   │
│                        │                                  │
│                   Internal MAP                            │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

Each adapter translates between MAP's internal message model and the external protocol:
- **MAP adapter**: Pass-through (native)
- **A2A adapter**: Translates MAP messages ↔ A2A Tasks, MAP agents ↔ A2A Agent Cards
- **ACP adapter**: Translates MAP messages ↔ ACP sessions/events

### Backwards Compatibility

If `protocols` is omitted from `map/federation/connect`, the server assumes MAP-only (current behavior). This makes the feature fully backwards-compatible.

### Scope Limitation

This proposal defines the **negotiation mechanism** only. The actual protocol adapters (A2A ↔ MAP translation, ACP ↔ MAP translation) are implementation concerns, not protocol spec. The spec only needs to define:
1. How protocols are advertised during connection
2. How a protocol is selected
3. Error handling when no common protocol exists

### Impacts

- **`docs/07-federation.md`**: Add meta-protocol negotiation section
- **`docs/02-wire-protocol.md`**: Document `protocols` field in federation connect
- **`ts-sdk/src/federation/`**: Add protocol negotiation logic
- **`ts-sdk/src/server/federation/`**: Extensible adapter pattern in gateway

### Open Questions

1. **Adapter specification**: Should the protocol define any normative mappings (e.g., how MAP messages map to A2A tasks)?
2. **Runtime protocol switching**: Can peers switch protocols mid-federation, or is it fixed at connection time?
3. **Protocol capability intersection**: If two protocols are supported but with different capability subsets, how is this communicated?

---

## Proposal 5: Privacy Through Multi-Identity for Federation

### Status: 🟢 Deferrable — Can resolve in later versions

### Problem

MAP agents currently have a single, system-wide `id`. When interacting with multiple federated systems, this creates privacy concerns:
- A federated peer can correlate agent activity across interactions
- Internal agent identifiers leak organizational structure
- There's no way for an agent to present different identities to different peers

ANP addresses this by supporting agents with **multiple DIDs** for different interaction contexts, with periodic rotation.

### Proposal

Introduce **federation aliases**: context-specific identities that agents can present to different federated peers. Internally, the system maintains the mapping; externally, each peer sees only the alias assigned to them.

#### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    MAP System (Internal)                        │
│                                                                │
│   agent_worker_01  ─────────────────────────────────          │
│   (internal id)    │                               │          │
│                    │         Alias Registry          │          │
│                    │                               │          │
│                    ├─► peer-alpha: "proc-7f3a"     │          │
│                    ├─► peer-beta:  "handler-9e1c"  │          │
│                    └─► peer-gamma: "agent-2b8d"    │          │
│                                                                │
│   Gateway translates internal IDs ↔ aliases per peer          │
└───────────────────────────────────────────────────────────────┘
```

#### Wire Protocol Types

```typescript
interface MAPFederationAliasConfig {
  /** Enable context-specific identities for federation */
  aliasing: {
    enabled: boolean;

    /** Strategy for generating aliases */
    strategy: "random" | "deterministic" | "manual";

    /** How often to rotate aliases (0 = never) */
    rotationIntervalMs?: number;

    /** Alias format template (e.g., "agent-{random}") */
    format?: string;

    /** Per-peer alias overrides */
    peerOverrides?: Record<string, {
      /** Explicit alias for this peer */
      alias?: string;

      /** Use real ID for this peer (trusted peer) */
      transparent?: boolean;
    }>;
  };
}
```

#### Extended Federation Exposure

```typescript
interface MAPFederationExposure {
  agents: {
    expose: "none" | "gateway" | "tagged" | "all";
    tags?: string[];

    /** NEW: Identity presentation strategy */
    identity: "real" | "alias" | "per-peer-alias";
  };
  // ... existing fields ...
}
```

#### Gateway Alias Translation

The gateway agent (already responsible for federation routing per `docs/07-federation.md`) handles alias translation transparently:

```
Outbound (internal → federated):
  message.from: "agent_worker_01" → "proc-7f3a" (alias for peer-alpha)

Inbound (federated → internal):
  message.to: "proc-7f3a" → "agent_worker_01" (resolve alias)
```

#### Alias Rotation

When aliases rotate, the gateway:
1. Generates new alias
2. Starts accepting both old and new alias (grace period)
3. Uses new alias for outbound messages
4. After grace period, stops accepting old alias

```typescript
interface MAPAliasRotationEvent {
  /** Peer this rotation applies to */
  peerId: string;

  /** Agent being rotated */
  agentId: string;

  /** Previous alias (will expire after grace period) */
  previousAlias: string;

  /** New alias (now active) */
  newAlias: string;

  /** When the previous alias stops being accepted */
  previousAliasExpiresAt: number;
}
```

### Security Properties

| Property | Without Aliases | With Aliases |
|----------|----------------|--------------|
| Cross-peer correlation | Trivial (same ID) | Prevented (different alias per peer) |
| Internal structure leakage | Possible (ID patterns) | Prevented (random aliases) |
| Activity tracking across rotation | Continuous | Broken at rotation boundaries |
| Trusted peer exception | N/A | Configurable per-peer |

### Relationship to DID Identity (Proposal 1)

When using `did:wba` authentication (Proposal 1), aliases can be implemented as **derived DIDs** — sub-identities under the system's DID that can be independently verified but can't be correlated to each other without the system's cooperation.

### Impacts

- **`docs/07-federation.md`**: Add alias configuration to federation model
- **`docs/06-visibility-permissions.md`**: Document alias as a visibility layer
- **`ts-sdk/src/federation/`**: Add alias registry, translation in envelope handling
- **`ts-sdk/src/server/federation/`**: Gateway alias management

### Open Questions

1. **Alias persistence**: Should aliases survive system restarts? (Probably yes, to maintain peer relationships.)
2. **Correlation resistance**: Should the system actively prevent timing-based correlation (e.g., jittering message delivery)?
3. **Alias in events**: When a federated peer subscribes to events, do events use aliases? (Yes — gateway translates.)

---

## Proposal 6: Single-Request Federation Authentication

### Status: 🟡 Important — Should resolve before v1.0

### Problem

MAP's current federation authentication can require multiple round trips:
1. `map/federation/connect` → server returns `authRequired` with supported methods
2. `map/authenticate` → client provides credentials
3. Server verifies → returns session

For federation connections that traverse the internet (potentially high latency), this multi-round-trip flow adds significant connection setup time. When federating across many peers or re-establishing connections after outages, this compounds.

ANP's `did:wba` auth completes in a single HTTP request: the client sends DID + cryptographic proof in the initial request headers, and the server resolves and verifies in one step.

### Proposal

Optimize MAP's federation connect to support **single-request authentication** — the peer provides all credentials in the initial `map/federation/connect` request, and the server completes auth without requiring a separate `map/authenticate` step.

#### Current Flow (Multi-Round-Trip)

```
Peer A                                 Peer B
  │                                       │
  │── federation/connect ────────────────►│  RTT 1
  │◄── authRequired { methods } ─────────│
  │                                       │
  │── authenticate { credential } ───────►│  RTT 2
  │◄── { success, session } ─────────────│
  │                                       │
  │── subscribe / send ──────────────────►│  RTT 3
  │                                       │
```

#### Proposed Flow (Single-Request)

```
Peer A                                 Peer B
  │                                       │
  │── federation/connect ────────────────►│  RTT 1
  │   { systemId, auth, exposure, ... }   │
  │                                       │
  │◄── { session, principal, ... } ───────│
  │                                       │
  │── subscribe / send ──────────────────►│  RTT 2
  │                                       │
```

#### Wire Protocol Changes

The `map/federation/connect` request already supports an `auth` field (see `docs/07-federation.md` line 135). The change is to make the server:
1. **Attempt authentication immediately** if `auth` is provided in `connect`
2. **Only fall back to negotiation** if `auth` is absent or fails with a recoverable error

```typescript
// Federation connect - enhanced auth handling
interface MAPFederationConnectParams {
  systemId: string;
  systemInfo: { name: string; version: string; endpoint: string };
  protocolVersion: string;

  /**
   * Authentication credentials.
   * If provided, server SHOULD attempt auth immediately (single-request flow).
   * If omitted, server returns authRequired (negotiation flow).
   */
  auth?: MAPFederationAuth;

  /**
   * NEW: Pre-fetched server auth requirements.
   * Client can include this to signal it already knows the server's
   * requirements (e.g., from .well-known discovery document).
   */
  authContext?: {
    /** How the client learned the server's auth requirements */
    source: "well-known" | "cached" | "configured";

    /** The server's nonce/challenge (if pre-fetched) */
    challenge?: string;
  };

  exposure: MAPFederationExposure;
}
```

#### Response Variants

```typescript
// Success (single-request auth completed)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "fed_session_01ABC",
    "principal": {
      "id": "did:wba:alpha.example.com:gateway",
      "claims": { ... }
    },
    "capabilities": { ... }
  }
}

// Auth required (fallback to negotiation)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "authRequired": {
      "methods": ["did:wba", "bearer", "mtls"],
      "challenge": "nonce_abc123",  // For did:wba proof
      "required": true
    }
  }
}

// Auth failed (non-recoverable)
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Authentication failed",
    "data": {
      "authError": { "code": "invalid_credentials", "message": "..." }
    }
  }
}
```

#### Challenge Pre-Fetch via Discovery

The `.well-known/map-federation` endpoint (Proposal 2) can include a challenge endpoint:

```json
{
  "systemId": "beta-prod",
  "authMethods": ["did:wba", "bearer"],
  "challengeEndpoint": "https://beta.example.com/map/federation/challenge"
}
```

A peer can pre-fetch a challenge nonce before connecting, enabling `did:wba` single-request auth:

```
1. GET /.well-known/map-federation → learn auth methods
2. GET /map/federation/challenge → get nonce
3. Connect with auth { did, proof: sign(nonce) } → single RTT
```

### Backwards Compatibility

This is fully backwards-compatible:
- If `auth` is omitted from `connect`, the existing negotiation flow is used
- If a server doesn't support single-request auth, it can ignore `auth` and return `authRequired`
- The `authContext` field is optional and informational

### Performance Impact

| Scenario | Current | Proposed |
|----------|---------|----------|
| Federation connect (known auth) | 2 RTT | 1 RTT |
| Federation connect (unknown auth) | 2 RTT | 2 RTT (unchanged) |
| Reconnection after outage | 2 RTT | 1 RTT |
| Bulk federation (10 peers) | 20 RTT | 10 RTT |

For cross-region federation (e.g., 100ms RTT), saving 1 RTT per connection saves 1 second across 10 peers.

### Impacts

- **`docs/07-federation.md`**: Document single-request auth flow
- **`docs/09-authentication.md`**: Add federation-specific single-request pattern
- **`ts-sdk/src/federation/`**: Update connection logic to attempt auth in connect
- **`ts-sdk/src/server/federation/`**: Handle auth in connect handler

---

## Implementation Priority

| # | Proposal | Status | Effort | Value |
|---|----------|--------|--------|-------|
| 6 | Single-Request Federation Auth | 🟡 Important | Low | High — immediate perf win, backwards-compatible |
| 1 | `did:wba` Decentralized Identity | 🟡 Important | High | High — unlocks scalable federation |
| 3 | Linked Capability Documents | 🟡 Important | Medium | High — enables dynamic orchestration |
| 2 | `.well-known` Discovery | 🟢 Deferrable | Low | Medium — zero-config federation |
| 5 | Multi-Identity Privacy | 🟢 Deferrable | Medium | Medium — important for cross-org scenarios |
| 4 | Meta-Protocol Negotiation | 🟢 Deferrable | Medium | Low-Medium — future-proofing |

### Recommended Approach

**Phase 1** (v1.0): Proposals 6 and 3
- Single-request auth is a small, backwards-compatible optimization
- Capability descriptors improve the existing agent model without changing wire protocol

**Phase 2** (v1.x): Proposals 1 and 2
- `did:wba` and `.well-known` discovery work together as a federation identity stack
- Requires more design work and dependency on W3C DID standards

**Phase 3** (v2.0 consideration): Proposals 4 and 5
- Meta-protocol negotiation and multi-identity are forward-looking
- May benefit from real-world federation deployment experience before finalizing

---

## References

- [W3C CG AI Agent Protocol (ANP)](https://github.com/w3c-cg/ai-agent-protocol) — Source of inspiration
- [DID Core Specification](https://www.w3.org/TR/did-core/) — W3C standard for Decentralized Identifiers
- [did:wba Method Specification](https://github.com/anthropics/anp-spec) — Web-Based Agent DID method
- [RFC 8615](https://tools.ietf.org/html/rfc8615) — Well-Known URIs
- MAP Specs:
  - `docs/07-federation.md` — Current federation design
  - `docs/09-authentication.md` — Current auth design
  - `docs/06-visibility-permissions.md` — Visibility/permission model
  - `docs/01-open-questions.md` — Open questions (Q6.2 addressed here)
