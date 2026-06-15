# ACP Tunneling Extension (acp-tunnel)

| | |
|---|---|
| **Name** | `acp-tunnel` |
| **Capability URI** | `urn:map:ext:acp-tunnel:1` |
| **Stability** | staging |
| **Owner** | multi-agent-protocol |
| **Method prefix** | *none* — this is a **payload-protocol extension** (see §2) |
| **Payload protocol** | `acp` (declared via message metadata `protocol: "acp"`) |
| **Error range** | none allocated — ACP errors travel in-band inside the envelope |
| **Spec status** | Extracted from the existing implementation (`ts-sdk/src/acp/`), 2026-06-11 |

## 1. Motivation

MAP's core gives a client a *window into* a multi-agent system: topology, lifecycle, events. It deliberately does not define how to hold a rich, session-based conversation with an individual agent — that is ACP's job (<https://agentclientprotocol.com/>).

This extension tunnels **unmodified ACP JSON-RPC messages** through MAP's transport, so a client connected to a MAP system can converse with any ACP-capable agent *inside* it — preserving all ACP semantics (sessions, prompts, tool calls, permission requests, streaming updates) without inventing a parallel conversation protocol.

The window lets you watch the system; the tunnel lets you talk to an agent within it. It is also MAP's interop bridge to the broader ACP ecosystem: any ACP-speaking agent becomes reachable through a MAP deployment without modification to its ACP layer.

**Known consumers:** openhive's Threads / web chat (live agent conversations, `acp.session.update` fan-out, `loadSession` replay). One consumer → staging, per the graduation gate in `docs/14-consolidation-plan.md` §D4.

## 2. Design: a payload-protocol extension

Unlike method-prefix extensions (`mail/*`, `trajectory/*`), acp-tunnel defines **no new MAP methods**. It rides entirely on core `map/send` + `map/message` delivery, discriminated at the payload layer:

```
┌────────────────────────────────────────────────┐
│ map/send → map/message        (MAP core)       │   transport & routing
├────────────────────────────────────────────────┤
│ metadata: { protocol: "acp", correlationId }   │   discriminator & correlation
├────────────────────────────────────────────────┤
│ payload: ACPEnvelope { acp, acpContext }       │   unmodified ACP JSON-RPC
└────────────────────────────────────────────────┘
```

Consequence for the MAP-EXT shape spec: the extension manifest format MUST support payload-protocol extensions (a `payloadProtocol` field) in addition to method-prefix extensions. acp-tunnel is the reference case.

## 3. Capability negotiation

An agent that accepts tunneled ACP declares, at registration:

```jsonc
{
  "capabilities": {
    "protocols": ["acp"],
    "acp": { "version": "2024-10-07" }   // ACP protocol version supported
  }
}
```

Clients SHOULD check the target agent's capabilities (via `map/agents/get`) before opening a tunnel. Sending an ACP envelope to an agent that does not declare `protocols: ["acp"]` is undefined behavior; implementations SHOULD ignore non-conforming payloads silently (see §6).

Systems advertise extension support via `capabilities.extensions: [{ "uri": "urn:map:ext:acp-tunnel:1" }]` in `ConnectResponse` once Phase 1 of the consolidation plan lands. Absence implies legacy behavior (payloads pass through untyped — tunneling still works because core `map/send` is opaque to payload contents).

## 4. Wire format

### 4.1 Envelope

Every tunneled message is a `map/send` whose payload is an **ACPEnvelope**:

```typescript
interface ACPEnvelope {
  /** The original ACP JSON-RPC message, unmodified. */
  acp: {
    jsonrpc: "2.0";
    id?: string | number | null;   // present on requests & responses
    method?: string;               // present on requests & notifications
    params?: unknown;
    result?: unknown;
    error?: ACPErrorObject;
  };
  /** ACP-specific routing context. */
  acpContext: {
    streamId: string;              // identifies the logical client↔agent stream
    sessionId?: string;            // ACP session, once established
  };
}
```

A payload is recognized as an envelope iff both `acp` and `acpContext` are non-null objects (reference guard: `isACPEnvelope`, `ts-sdk/src/acp/types.ts:1366`). Payloads failing the guard MUST be treated as ordinary MAP messages, not tunnel traffic.

### 4.2 Message metadata

The carrying `map/send` sets:

| Field | Value | Purpose |
|---|---|---|
| `protocol` | `"acp"` | Marks the message as tunnel traffic without inspecting the payload |
| `correlationId` | unique per request | Pairs responses with pending requests across the async transport |

### 4.3 Message classification

Receivers classify the inner `acp` object by shape (standard JSON-RPC rules):

| Shape | Classification |
|---|---|
| `id` present, no `method` | **Response** → resolve/reject the pending request matching `correlationId` (reject with `ACPError` if `error` is set) |
| `method` present, `id` present | **Request** (agent→client or client→agent) → route to handler; reply with a response envelope carrying the same `correlationId` and `acpContext` |
| `method` present, no `id` | **Notification** → route to handler; no reply |

### 4.4 Stream context

`streamId` identifies a logical conversation stream and is generated by the client when it opens the tunnel. The agent side maintains a map `streamId → { from: <MAP address>, sessionId? }` so that:

- agent-initiated requests (e.g. ACP permission prompts) and session-update notifications route back to the correct client address;
- `sessionId` is attached to the stream context as soon as ACP session establishment (`session/new` / `session/load`) completes.

One MAP client connection MAY hold multiple streams to the same or different agents; streams are independent.

## 5. Lifecycle

A typical tunnel session, all over `map/send`:

```
Client                                    Agent (ACP-capable)
  │  initialize {protocolVersion, clientInfo}   │
  │ ───────────────────────────────────────────►│
  │ ◄─────────────────────────── result          │
  │  session/new {cwd, mcpServers}              │
  │ ───────────────────────────────────────────►│
  │ ◄──────────────────── result {sessionId}     │
  │  session/prompt {sessionId, prompt[]}       │
  │ ───────────────────────────────────────────►│
  │ ◄░░░ session/update notifications ░░░░░░░░░░│   (streaming)
  │ ◄──────────────────── result {stopReason}    │
```

- **Timeouts** are a client concern: pending requests carry a timeout; on expiry the pending entry is cleaned up and the caller receives an error. The spec does not mandate a value (reference implementation defaults apply).
- **ACP extension methods** (underscore-prefixed, per ACP convention — e.g. `_macro/spawnAgent`) pass through the tunnel unchanged via the same envelope; the tunnel is transparent to them.
- **Teardown**: no explicit tunnel-close message exists. Streams die with the MAP connection or the agent. (Open item §8.)

## 6. Error handling

Two layers, kept strictly separate:

1. **ACP-level errors** travel in-band: `envelope.acp.error` on a response. The tunnel MUST deliver them unmodified (reference: `ACPError.fromResponse`).
2. **MAP transport errors** (agent not found, delivery failed, permission denied) surface as ordinary `map/send` errors (routing error codes 2000–2004) to the sender. They indicate the tunnel itself failed, not the ACP operation.

Non-envelope payloads arriving on a connection that also carries tunnel traffic MUST be ignored by the tunnel layer (passed to normal message handling), and vice versa — the `isACPEnvelope` guard plus `protocol: "acp"` metadata make the two traffic classes non-interfering.

## 7. Permissions & security

- Tunneling requires only core capabilities: `messaging.canSend` (client→agent) and message delivery (agent→client). No new permission surface is introduced.
- A tunnel grants *conversational* access to an agent — systems SHOULD treat `protocols: ["acp"]` agents' visibility settings as the access-control boundary: a client that cannot see an agent (per scope/visibility rules, `docs/06-visibility-permissions.md`) cannot address it and therefore cannot tunnel to it.
- Systems MAY filter `protocol: "acp"` traffic in middleware (rate limiting, audit) without parsing ACP payloads, using metadata alone. Payload contents (prompts, file contents in tool results) are as sensitive as any agent conversation; persistence/logging policies are out of scope here and belong to the deployment.

## 8. Open items (to resolve before stable)

1. **Tunnel lifecycle events** — should stream open/close emit MAP events (`acp.stream.opened` / `.closed`) so observers see conversations start/stop in the window? (openhive currently bridges `acp.session.update` into its own channels — evidence this is wanted.)
2. **Explicit teardown** — a `tunnel close` notification vs. relying on connection lifetime.
3. **Backpressure** — ACP streaming updates over a slow MAP client; interaction with core subscription backpressure semantics.
4. **Version negotiation** — ACP protocol version mismatch handling (currently: client sends `protocolVersion` in `initialize`, agent may reject; no MAP-level pre-check).

## 9. Conformance checklist (staging)

An implementation conforms if it:

- [ ] Declares/checks `protocols: ["acp"]` capability before tunneling
- [ ] Wraps every ACP message in `ACPEnvelope` with `streamId`; sets `protocol: "acp"` + `correlationId` metadata
- [ ] Classifies inbound envelopes per §4.3 and correlates responses by `correlationId`
- [ ] Routes agent-initiated traffic back via tracked stream context (§4.4)
- [ ] Keeps ACP errors in-band and MAP transport errors out-of-band (§6)
- [ ] Ignores non-envelope payloads at the tunnel layer (§6)

Reference implementation: `ts-sdk/src/acp/` — `ACPStreamConnection` (client), `ACPAgentAdapter` (agent), `types.ts` (envelope + guards). These move to `ts-sdk/src/ext/acp/` in Phase 2 of the consolidation plan.
