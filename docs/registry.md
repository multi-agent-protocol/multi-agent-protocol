# MAP Extension Registry

| | |
|---|---|
| **Status** | Phase 0 Track A inventory (source of truth for stability + ownership) |
| **Format** | [`map-ext.md`](./map-ext.md) |
| **Counts** | Generated into the README by `scripts/method-counts.mjs` |

The single inventory of every extension: its namespace, capability URI, error range, stability, owning repo, and known consumers. Stability labels here are mirrored in `schema/meta.json` (`stability` field, added Phase 0). When an extension is externally owned, the schema lives in the owner repo and this table is the pointer.

## Core (not an extension)

The 23-method machinery core (target of the consolidation recut): connection/auth envelope incl. `sessionId`, `map/send` (ephemeral transport — see [`send-semantics.md`](./send-semantics.md)), subscribe/events, agent registry + lifecycle, scopes, `structure/graph`. Required of every conformant implementation. Today these carry `tier: core` / `tier: structure` and `stability: stable` in `meta.json`.

## Extensions

| Extension | Namespace | Capability URI | Errors | Stability | Owner | Consumers (independent) |
|---|---|---|---|---|---|---|
| **mail** | `mail/` (13) | `urn:map:ext:mail:1` | 10000–10999 | **stable** | → **agent-inbox** *(inversion: Phase 1)* | agent-inbox, openhive |
| **trajectory** | `trajectory/` | `urn:map:ext:trajectory:1` | 13000–13999 | **stable** nucleus + **staging** query surface | multi-agent-protocol | `checkpoint`: claude-code-swarm (+ openhive serve/receive). `list`/`get`/`content`: **0** (federation-gated, [plan §Appendix C](./14-consolidation-plan.md)) |
| **acp-tunnel** | payload `protocol: "acp"` | `urn:map:ext:acp-tunnel:1` | in-band | **staging** | multi-agent-protocol | openhive (Threads/web chat) |
| **sessions** | `map/session/` (3) | `urn:map:ext:sessions:1` | 16000–16999 *(reserve)* | **staging** | multi-agent-protocol | **0** explicit-method callers; resume solved at app layer |
| **tasks** | `map/tasks/` (4) | `urn:map:ext:tasks:1` | 14000–14999 | **staging** | multi-agent-protocol *(offer → opentasks)* | opentasks (optional bridge); openhive rolls its own |
| **workspace** | `workspace/` (3) | `urn:map:ext:workspace:1` | 12000–12999 | **staging** | multi-agent-protocol | ~1 |
| **credentials** | `cred/` (3) | `urn:map:ext:credentials:1` | 11000–11999 | **staging** | multi-agent-protocol *(offer → agent-iam)* | openhive uses agent-iam tokens directly, not `cred/*` |
| **resources** | `map/resources/` (2) | `urn:map:ext:resources:1` | 15000–15999 *(reserve)* | **staging** | multi-agent-protocol | openhive |
| **federation** | `map/federation/` (2) | `urn:map:ext:federation:1` | 5000–5999 | **staging** | multi-agent-protocol | **0** uses of `federation/route`; 2 independent transport replacements exist (see Profiles) |
| **steering** | `map/inject` (1) | `urn:map:ext:steering:1` | — | **staging** | multi-agent-protocol | **0** (grep hits were Fastify `app.inject()`) |
| **identity** | (capability + `IdentityVerifier` hook) | `urn:map:ext:identity:1` | — | **staging** | multi-agent-protocol | openhive uses HMAC tokens, not DID/SPIFFE. `persistentId` stays opaque-in-core |

Counts: 58 methods total — 37 stable (23 core + 13 mail + `trajectory/checkpoint`), 21 staging.

## Profiles

| Profile | Contents | Purpose |
|---|---|---|
| **MAP Core** | the 23-method core | minimum conformant implementation |
| **MAP Observability** | Core + trajectory + steering | the "transparent window" thesis, complete |

## Federation transport profiles (not the `federation/*` methods)

`federation/route` has no observed consumers; real cross-system transport is done by these, documented as profiles in Phase 4:

- **agentic-mesh** — P2P / CRDT over Nebula/Tailscale (`references/agentic-mesh`).
- **openhive-sync** — hub JSON-RPC mesh at `/sync/v1` (openhive).

## Mail divergences (Phase 1 reconciliation input)

agent-inbox implements a **superset** of MAP's mail spec; these deltas must be reconciled into the agent-inbox-owned mail v1.1 (Phase 1). Enumerated from `agent-inbox/src/jsonrpc/mail-server.ts` vs `docs/10-mail-protocol.md`:

| agent-inbox has | MAP spec has | Resolution (Phase 1) |
|---|---|---|
| `mail/presence` | — | adopt into v1.1 |
| `mail/reopen` | `mail/close` only | adopt into v1.1 |
| participant management (`mail/join`/`leave`/`invite` + extras) | `join`/`leave`/`invite` | reconcile extras into v1.1 |
| `mail/replay` (router semantics) | `mail/replay` | verify semantics match |

Since we own agent-inbox with write access, reconciliation is an internal decision, not a cross-party negotiation (consolidation plan §8, risk downgraded to Low).

## Findings

- **Core-surface gap — RESOLVED (Phase 1).** The default `MAPServer` was missing handlers for 4 of the 23 core methods (`agents/stop`·`suspend`·`resume`, `structure/graph`). Resolved by implementing them (kept core); see consolidation plan §9 item 4.

## Ambiguities / findings (Phase 0 steering)

- **resources vs. workspace** overlap — both are file/resource discovery surfaces; worth asking in Phase 4 whether they're one extension. Recorded, not resolved.
- **identity** is half-hook, half-capability rather than a method set — its manifest shape (no `methodPrefix`, no `payloadProtocol`, just a capability + server hook) is a third manifest variant to validate against the format. Flag for `map-ext.md` §3.
