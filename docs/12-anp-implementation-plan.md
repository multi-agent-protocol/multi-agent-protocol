# Implementation Plan: ANP-Inspired MAP Improvements

## Proposals Covered

| # | Proposal | Effort | Depends On |
|---|----------|--------|------------|
| **P6** | Single-Request Federation Auth | Low | — |
| **P3** | Linked Capability Documents | Medium | — |
| **P1** | `did:wba` Decentralized Identity | High | P6 |

Implementation order: **P6 → P3 → P1** (P3 and P6 are independent; P1 builds on P6).

### Backwards Compatibility

MAP is pre-release (v0.0.8). All changes are treated as non-breaking for semver purposes. However, for consumer awareness:

- **P6**: Fully additive — only optional fields added to existing interfaces.
- **P3**: Fully additive — only optional fields added to `Agent`, `AgentsListFilter`, register/spawn params.
- **P1**: Widens `FederationAuth.method` from `"bearer" | "api-key" | "mtls"` to `FederationAuthMethod` (includes `"did:wba"`, `"none"`, `"oauth2"`, `x-${string}`). Existing exhaustive switch statements on `method` will need a `default` case. Acceptable for pre-release.

---

## Phase 1: Single-Request Federation Auth (P6)

### Goal

When `auth` credentials are provided in the initial `map/federation/connect` request, the server authenticates immediately in the same round trip — reducing federation connection setup from 2 RTT to 1 RTT.

### Step 1.1: Widen Federation Auth Types

**File**: `ts-sdk/src/types/index.ts`

**Change A** — Widen `FederationAuth` (~line 1193):

```typescript
// BEFORE
export interface FederationAuth {
  method: "bearer" | "api-key" | "mtls";
  credentials?: string;
}

// AFTER
export type FederationAuthMethod = "bearer" | "api-key" | "mtls" | "none" | "oauth2" | `x-${string}`;

export interface FederationAuth {
  method: FederationAuthMethod;
  credentials?: string;
  /** Method-specific additional data */
  metadata?: Record<string, unknown>;
}
```

**Change B** — Extend `FederationConnectRequestParams` (~line 2152):

Add:
```typescript
/** Pre-fetched server auth context (e.g., from .well-known discovery) */
authContext?: {
  source: "well-known" | "cached" | "configured";
  challenge?: string;
};
/** System info about the connecting peer */
systemInfo?: { name: string; version: string; endpoint: string };
/** MAP protocol version */
protocolVersion?: string;
/** What this peer exposes to the other side */
exposure?: Record<string, unknown>;
```

**Change C** — Extend `FederationConnectResponseResult` (~line 2164):

Add:
```typescript
/** Federation session ID */
sessionId?: string;
/** Authenticated principal (when single-request auth succeeds) */
principal?: { id: string; issuer?: string; claims?: Record<string, unknown> };
/** Auth negotiation fallback (when auth not provided or failed recoverably) */
authRequired?: {
  methods: string[];
  challenge?: string;
  required: boolean;
};
```

### Step 1.2: Update JSON Schema

**File**: `schema/schema.json`

- Extend `FederationConnectRequest` params (~line 1824) with `authContext`, `systemInfo`, `protocolVersion`, `exposure`
- Extend `FederationConnectResponse` result (~line 1859) with `sessionId`, `principal`, `authRequired`
- Widen `auth.method` enum to include `"none"`, `"oauth2"`, and `x-` pattern

### Step 1.3: Extend Server Peer Connection Type

**File**: `ts-sdk/src/server/types.ts`

Extend `PeerConnection` (~line 1076) with:
```typescript
principal?: { id: string; issuer?: string; claims?: Record<string, unknown> };
sessionId?: string;
```

### Step 1.4: Implement Single-Request Auth in Federation Handler

**File**: `ts-sdk/src/server/federation/handlers.ts`

Modify the `"map/federation/connect"` handler (~line 74):

1. Accept optional `authManager` in `FederationHandlerOptions`:
   ```typescript
   export interface FederationHandlerOptions {
     gateway: FederationGateway;
     authManager?: AuthManager;
   }
   ```

2. In the handler body:
   - If `params.auth` provided AND `authManager` exists → attempt immediate auth via `authManager.authenticate()`
   - On success → return `{ connected: true, sessionId, principal, systemInfo }`
   - On recoverable failure → return `{ connected: false, authRequired: { methods, challenge } }`
   - If no auth provided AND `authManager.config.required` → return `authRequired`
   - If no auth required → proceed with existing behavior (backwards-compatible)

### Step 1.5: Update Gateway Client Connection

**File**: `ts-sdk/src/connection/gateway.ts`

Modify `connectToSystem` (~line 257):
- Accept `authContext` in options
- Pass `authContext` through in request params
- Handle `authRequired` response variant (don't add to `#connectedSystems` if not connected)
- Widen `#lastConnectOptions.auth` type to `FederationAuth`

### Step 1.6: Add Challenge Nonce Utility

**New file**: `ts-sdk/src/federation/challenge.ts`

```typescript
export function generateFederationChallenge(): string;
export function validateChallengeAge(challenge: string, maxAgeMs: number): boolean;
```

Simple utility — generates cryptographically random nonce with embedded timestamp for age validation.

### Step 1.7: Tests

**New file**: `ts-sdk/src/__tests__/federation-single-request-auth.test.ts`

| Test Case | What It Verifies |
|-----------|-----------------|
| Auth provided in connect → immediate success | Single-RTT happy path |
| Auth required but not provided → authRequired response | Negotiation fallback |
| Auth provided but fails → authRequired with challenge | Recoverable failure |
| Auth provided, hard failure → error thrown | Non-recoverable failure |
| No auth required, no auth provided → connects | Backwards compatibility |

### Step 1.8: Documentation

- `docs/07-federation.md`: Add "Single-Request Authentication" section after "Connection Establishment"
- `docs/09-authentication.md`: Add "Federation Authentication Optimization" section
- `schema/meta.json`: Update `map/federation/connect` description

---

## Phase 2: Linked Capability Documents (P3)

### Goal

Add an optional `MAPAgentCapabilityDescriptor` that agents publish at registration time, and extend `map/agents/list` to filter by capability ID, tags, and content type.

### Step 2.1: Define Capability Descriptor Types

**File**: `ts-sdk/src/types/index.ts`

Add after `AgentEnvironment` (~line 131):

```typescript
export interface MAPAgentCapabilityDescriptor {
  version: 1;
  description: string;
  capabilities: MAPCapabilityDeclaration[];
  accepts?: MAPInterfaceSpec[];
  produces?: MAPInterfaceSpec[];
  documentationUrl?: string;
  tags?: string[];
}

export interface MAPCapabilityDeclaration {
  id: string;         // e.g., "doc:summarize"
  name: string;       // e.g., "Document Summarization"
  description: string;
  interfaceRef?: string;           // URL to detailed spec
  interface?: MAPInterfaceSpec;    // Inline spec
}

export interface MAPInterfaceSpec {
  contentType: string;                // e.g., "application/json"
  schema?: Record<string, unknown>;   // JSON Schema
  schemaRef?: string;                 // URL to external schema
  example?: unknown;
}
```

### Step 2.2: Extend Agent Model

**File**: `ts-sdk/src/types/index.ts`

Add to `Agent` interface (~line 352, after `environment`):
```typescript
capabilityDescriptor?: MAPAgentCapabilityDescriptor;
```

Add to `AgentsRegisterRequestParams` (~line 1391):
```typescript
capabilityDescriptor?: MAPAgentCapabilityDescriptor;
```

Add to `AgentsSpawnRequestParams` (~line 1458):
```typescript
capabilityDescriptor?: MAPAgentCapabilityDescriptor;
```

### Step 2.3: Extend List Filters

**File**: `ts-sdk/src/types/index.ts`

Add to `AgentsListFilter` (~line 1333):
```typescript
capabilityId?: string;   // Filter by capability declaration ID
tags?: string[];          // Filter by semantic tags
accepts?: string;         // Filter by accepted content type
```

### Step 2.4: Extend Server Types

**File**: `ts-sdk/src/server/types.ts`

Add to `RegisteredAgent` (~line 142):
```typescript
capabilityDescriptor?: import('../types').MAPAgentCapabilityDescriptor;
```

Add to `AgentFilter` (~line 170):
```typescript
capabilityId?: string;
tag?: string;
accepts?: string;
```

Extend `AgentRegistry.register()` signature (~line 211) to accept `capabilityDescriptor`.

### Step 2.5: Implement Storage Filtering

**File**: `ts-sdk/src/server/agents/stores/in-memory.ts`

Extend `list()` method (~line 36) with three new filter branches:

```typescript
// After existing role/state/scope filters:

if (filter?.capabilityId) {
  const match = agent.capabilityDescriptor?.capabilities?.some(
    (cap) => cap.id === filter.capabilityId
  );
  if (!match) continue;
}

if (filter?.tag) {
  if (!agent.capabilityDescriptor?.tags?.includes(filter.tag)) continue;
}

if (filter?.accepts) {
  const match = agent.capabilityDescriptor?.accepts?.some(
    (spec) => spec.contentType === filter.accepts
  );
  if (!match) continue;
}
```

### Step 2.6: Implement Handler Changes

**File**: `ts-sdk/src/server/agents/handlers.ts`

**A.** Extend `RegisterParams` (~line 45) with `capabilityDescriptor`

**B.** Modify `"map/agents/register"` handler (~line 139):
- Pass `capabilityDescriptor` to `agents.register()`
- Include `capabilityDescriptor` in response

**C.** Extend `ListParams` (~line 70) with `capabilityId`, `tags`, `accepts`

**D.** Modify `"map/agents/list"` handler (~line 194):
- Map new filter params to `AgentFilter`
- Include `capabilityDescriptor` in response objects

**E.** Modify `"map/agents/get"` handler (~line 212):
- Include `capabilityDescriptor` in response

### Step 2.7: Update Agent Registry

**File**: `ts-sdk/src/server/agents/registry.ts`

Modify `register()` (~line 215):
- Accept `capabilityDescriptor` in params
- Store it on the `RegisteredAgent` object

### Step 2.8: Update Federation Agent Decorator

**File**: `ts-sdk/src/server/federation/decorators/agents.ts`

- Update `register()` (~line 75) to accept and pass through `capabilityDescriptor`
- Update `broadcastAgentEvent()` (~line 228) to include `capabilityDescriptor` in broadcast payload

### Step 2.9: Update JSON Schema

**File**: `schema/schema.json`

**A.** Add to `$defs`:
- `MAPAgentCapabilityDescriptor` (required: `version`, `description`, `capabilities`)
- `MAPCapabilityDeclaration` (required: `id`, `name`, `description`)
- `MAPInterfaceSpec` (required: `contentType`)

**B.** Add `capabilityDescriptor` property to:
- `Agent` definition (~line 408)
- `AgentsRegisterRequest` params (~line 1252)
- `AgentsSpawnRequest` params (~line 1292)

**C.** Add filter properties to `AgentsListRequest` params (~line 1040):
- `capabilityId`: string
- `tags`: array of strings
- `accepts`: string

### Step 2.10: Tests

**New file**: `ts-sdk/src/__tests__/capability-descriptor.test.ts`

| Test Case | What It Verifies |
|-----------|-----------------|
| Register agent with capabilityDescriptor | Stored and returned correctly |
| Get agent includes capabilityDescriptor | Field appears in get response |
| List filter by capabilityId | Only matching agents returned |
| List filter by tag | Only matching agents returned |
| List filter by accepts content type | Only matching agents returned |
| Combined filters (capabilityId + role) | Intersection semantics |
| Agent without capabilityDescriptor | Still registers and lists normally |
| Spawn with capabilityDescriptor | Descriptor propagated to spawned agent |

**Modify**: `ts-sdk/src/__tests__/server-agents.test.ts` — add cases for new filter fields in `InMemoryAgentStore.list()`

### Step 2.11: Documentation

- `docs/00-design-specification.md`: Add capability descriptor to Agent model section, show example registration
- Reference the design spec (`docs/11-anp-inspired-improvements.md`) for the full rationale

---

## Phase 3: `did:wba` Decentralized Identity (P1)

### Goal

Add `did:wba` as a federation authentication method. DID resolution via HTTPS provides domain-verified identity without pre-shared secrets.

### Step 3.1: Add `did:wba` to Auth Types

**File**: `ts-sdk/src/types/index.ts`

**A.** Extend `StandardAuthMethod` (~line 1108):
```typescript
export type StandardAuthMethod = "bearer" | "api-key" | "mtls" | "none" | "did:wba";
```

**B.** Add after `FederationAuth` (~line 1196):
```typescript
export interface DIDWBACredentials {
  method: "did:wba";
  did: string;
  proof: DIDWBAProof;
}

export interface DIDWBAProof {
  type: string;       // e.g., "JsonWebSignature2020"
  created: string;    // ISO 8601
  challenge: string;  // Server-provided nonce
  jws: string;        // Signature over (challenge + did + created)
}

export interface DIDDocument {
  "@context": string[];
  id: string;
  verificationMethod?: DIDVerificationMethod[];
  authentication?: string[];
  service?: DIDService[];
}

export interface DIDVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyJwk?: Record<string, unknown>;
}

export interface DIDService {
  id: string;
  type: string;
  serviceEndpoint: string;
  mapProtocolVersion?: number;
  mapCapabilities?: Record<string, boolean>;
}
```

**C.** Create union type:
```typescript
export type MAPFederationAuth = FederationAuth | DIDWBACredentials;
```

Update `FederationConnectRequestParams.auth` type from `FederationAuth` to `MAPFederationAuth`.

**D.** Add error codes to `FEDERATION_ERROR_CODES` (~line 3093):
```typescript
FEDERATION_DID_RESOLUTION_FAILED: 5004,
FEDERATION_DID_PROOF_INVALID: 5005,
```

### Step 3.2: Create DID Resolver Module

**New file**: `ts-sdk/src/federation/did-wba/resolver.ts`

```
Class: DIDWBAResolver
  - constructor(options?: { cacheTtlMs?, timeoutMs?, fetch? })
  - resolve(did: string): Promise<DIDDocument>
  - extractMAPEndpoint(doc: DIDDocument): string | undefined
  - extractVerificationKeys(doc: DIDDocument): DIDVerificationMethod[]
  - clearCache(): void

Functions:
  - parseDIDWBA(did) → { domain, path }
  - didToUrl(did) → HTTPS URL for DID document
```

Resolution logic:
```
did:wba:agents.example.com:worker-alpha
  → parse → domain: "agents.example.com", path: "worker-alpha"
  → construct → https://agents.example.com/worker-alpha/did.json
  → fetch → DIDDocument
  → cache with TTL
```

### Step 3.3: Create Proof Generation/Verification Module

**New file**: `ts-sdk/src/federation/did-wba/proof.ts`

```
Functions:
  - generateDIDWBAProof({ did, challenge, privateKey, proofType? }) → DIDWBAProof
  - verifyDIDWBAProof({ did, proof, publicKey, maxAgeMs? }) → Promise<boolean>
```

Proof generation:
1. Construct payload: `JSON.stringify({ did, challenge, created })`
2. Sign with private key (JWS compact serialization)
3. Return `{ type, created, challenge, jws }`

Proof verification:
1. Check proof age (`created` within `maxAgeMs`)
2. Reconstruct payload from proof fields
3. Verify JWS against public key
4. Return boolean

### Step 3.4: Create Module Index

**New file**: `ts-sdk/src/federation/did-wba/index.ts`

Re-exports `DIDWBAResolver`, `parseDIDWBA`, `didToUrl`, `generateDIDWBAProof`, `verifyDIDWBAProof`.

### Step 3.5: Create Server-Side Authenticator

**New file**: `ts-sdk/src/server/auth/did-wba-authenticator.ts`

```
Class: DIDWBAAuthenticator implements Authenticator
  - methods: ['did:wba']
  - constructor(options?: { resolver?, trustedDomains?, challengeTtlMs? })
  - authenticate(credentials, context): Promise<AuthResult>
  - generateChallenge(): string
  - isTrustedDomain(did): boolean
```

Authentication flow:
1. Parse DID from credentials
2. Validate DID matches trusted domain patterns (if configured)
3. Resolve DID document via `DIDWBAResolver`
4. Extract verification key matching `authentication` relationship
5. Verify proof via `verifyDIDWBAProof()`
6. Return `AuthResult` with principal `{ id: did, issuer: domain }`

### Step 3.6: Wire Up Exports

**File**: `ts-sdk/src/server/auth/index.ts`
- Export `DIDWBAAuthenticator` and `DIDWBAAuthenticatorOptions`

**File**: `ts-sdk/src/federation/index.ts`
- Export `DIDWBAResolver`, `parseDIDWBA`, `didToUrl`, `generateDIDWBAProof`, `verifyDIDWBAProof`

### Step 3.7: Extend Auth Context

**File**: `ts-sdk/src/server/auth/types.ts`

Add to `AuthContext` (~line 20):
```typescript
didInfo?: { did: string; domain: string };
```

### Step 3.8: Update JSON Schema

**File**: `schema/schema.json`

**A.** Add `DIDWBACredentials` definition:
```json
{
  "type": "object",
  "properties": {
    "method": { "const": "did:wba" },
    "did": { "type": "string", "pattern": "^did:wba:" },
    "proof": {
      "type": "object",
      "properties": {
        "type": { "type": "string" },
        "created": { "type": "string", "format": "date-time" },
        "challenge": { "type": "string" },
        "jws": { "type": "string" }
      },
      "required": ["type", "created", "challenge", "jws"]
    }
  },
  "required": ["method", "did", "proof"]
}
```

**B.** Update `FederationConnectRequest.params.auth` to `oneOf` including existing auth + `DIDWBACredentials`

**C.** Add error codes 5004, 5005 to error definitions

**File**: `schema/meta.json`
- Add `DID_RESOLUTION_FAILED` (5004) and `DID_PROOF_INVALID` (5005) to federation errors

### Step 3.9: Tests

**New file**: `ts-sdk/src/__tests__/did-wba-resolver.test.ts`

| Test Case | What It Verifies |
|-----------|-----------------|
| Parse valid `did:wba` string | Extracts domain + path correctly |
| Parse multi-segment path | `did:wba:example.com:agents:worker` works |
| Convert DID to URL | Correct HTTPS URL constructed |
| Resolve DID document (mocked fetch) | Document returned, cache populated |
| Cache hit on second resolve | No second fetch |
| Cache expiry | Fetches again after TTL |
| Invalid DID format → error | Throws on `did:key:...` |
| Network failure → error | Throws descriptive error |
| Extract MAP service endpoint | Finds `MAPFederationEndpoint` service |
| Extract verification keys | Returns keys from `authentication` relationship |

**New file**: `ts-sdk/src/__tests__/did-wba-proof.test.ts`

| Test Case | What It Verifies |
|-----------|-----------------|
| Generate proof with EC P-256 key | Valid JWS produced |
| Verify valid proof | Returns true |
| Reject expired proof (old `created`) | Returns false |
| Reject wrong challenge | Returns false |
| Reject wrong signing key | Returns false |
| Reject tampered payload | Returns false |

**New file**: `ts-sdk/src/__tests__/did-wba-authenticator.test.ts`

| Test Case | What It Verifies |
|-----------|-----------------|
| Full happy path (resolve → verify → principal) | End-to-end auth works |
| Trusted domain filtering | Rejects untrusted domains |
| Challenge nonce generation | Unique, time-embedded |
| Stale challenge rejection | Rejects old challenges |
| DID resolution failure → AuthResult.success=false | Graceful failure |
| Proof verification failure → AuthResult.success=false | Graceful failure |
| Integration with AuthManager | Works when registered as authenticator |

### Step 3.10: Documentation

- `docs/09-authentication.md`:
  - Add `did:wba` row to methods table
  - Add "DID:WBA Authentication" section with resolution flow, proof format, trust model
  - Add DID Document example with MAP service endpoint
  - Add "Trust Model Comparison" table (mtls vs bearer vs api-key vs did:wba)

- `docs/07-federation.md`:
  - Add `did:wba` to `MAPFederationAuth` type
  - Add "DID-Based Federation Identity" section
  - Add example federation connect with `did:wba` credentials

---

## File Change Summary

### New Files (7)

| File | Phase | Purpose |
|------|-------|---------|
| `ts-sdk/src/federation/challenge.ts` | P6 | Challenge nonce utility |
| `ts-sdk/src/federation/did-wba/index.ts` | P1 | Module re-exports |
| `ts-sdk/src/federation/did-wba/resolver.ts` | P1 | DID document resolution + cache |
| `ts-sdk/src/federation/did-wba/proof.ts` | P1 | Proof generation + verification |
| `ts-sdk/src/server/auth/did-wba-authenticator.ts` | P1 | Server-side DID authenticator |
| `ts-sdk/src/__tests__/federation-single-request-auth.test.ts` | P6 | Single-request auth tests |
| `ts-sdk/src/__tests__/capability-descriptor.test.ts` | P3 | Capability descriptor tests |
| `ts-sdk/src/__tests__/did-wba-resolver.test.ts` | P1 | DID resolver tests |
| `ts-sdk/src/__tests__/did-wba-proof.test.ts` | P1 | Proof gen/verify tests |
| `ts-sdk/src/__tests__/did-wba-authenticator.test.ts` | P1 | Authenticator integration tests |

### Modified Files (15)

| File | Phases | Changes |
|------|--------|---------|
| `ts-sdk/src/types/index.ts` | P6, P3, P1 | Widen `FederationAuth`, add capability descriptor types, add DID types, extend agent/filter/register interfaces |
| `ts-sdk/src/server/types.ts` | P6, P3 | Extend `PeerConnection`, `RegisteredAgent`, `AgentFilter`, `AgentRegistry` |
| `ts-sdk/src/server/federation/handlers.ts` | P6 | Add `authManager` option, single-request auth logic |
| `ts-sdk/src/server/federation/gateway.ts` | P6 | Store principal/session on peer connections |
| `ts-sdk/src/connection/gateway.ts` | P6 | Handle `authContext`, `authRequired` response |
| `ts-sdk/src/server/agents/registry.ts` | P3 | Accept/store `capabilityDescriptor` |
| `ts-sdk/src/server/agents/stores/in-memory.ts` | P3 | Filter by capabilityId, tag, accepts |
| `ts-sdk/src/server/agents/handlers.ts` | P3 | Pass through descriptor in register/list/get |
| `ts-sdk/src/server/federation/decorators/agents.ts` | P3 | Include descriptor in federation broadcasts |
| `ts-sdk/src/server/auth/index.ts` | P1 | Export `DIDWBAAuthenticator` |
| `ts-sdk/src/server/auth/types.ts` | P1 | Add `didInfo` to `AuthContext` |
| `ts-sdk/src/federation/index.ts` | P1 | Re-export DID utilities |
| `schema/schema.json` | P6, P3, P1 | Federation auth schemas, capability descriptor schemas, DID credential schema |
| `schema/meta.json` | P6, P1 | Update federation/connect description, add DID error codes |
| `docs/07-federation.md` | P6, P1 | Single-request auth section, DID federation section |
| `docs/09-authentication.md` | P6, P1 | Federation auth optimization, did:wba method |
| `docs/00-design-specification.md` | P3 | Capability descriptor in agent model |
