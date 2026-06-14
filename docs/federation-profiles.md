# MAP Federation Transport Profiles

| | |
|---|---|
| **Status** | Phase 4 — documents the real federation transports |
| **Relates to** | `map/federation/connect`, `map/federation/route` (staging — see below) |

## Why this exists

The `map/federation/*` methods (`connect`, `route`) are **staging** and have **zero observed consumers**. Real cross-system federation in the MAP ecosystem is done by two concrete transports, each a *profile* — a documented way to carry MAP traffic across a boundary — rather than via the built-in `federation/route`. This page blesses them as the supported options and explains when to reach for each.

This mirrors how mature protocols handle transport: the core defines messages; transports are separate, swappable profiles (cf. JMAP over HTTP, Matrix over federation APIs). MAP's `federation/*` methods stay specced and staging for the in-protocol routing case, but the ecosystem's actual federation runs on these profiles.

## Profile A — agentic-mesh (P2P / encrypted mesh)

[agentic-mesh](https://github.com/alexngai/agentic-mesh) is the P2P transport layer for MAP clients, agents, and peers. Use it for **peer-to-peer federation without a central hub**.

- **Connectivity**: encrypted mesh over pluggable backends (Nebula, Tailscale, Headscale) via a unified `TransportAdapter`; Nebula PKI lifecycle + lighthouse management.
- **Messaging**: typed pub/sub and RPC channels with offline queuing; MAP rides a named channel (`proto:agent-inbox` for agent-inbox).
- **Extras**: `git-remote-mesh://` for repository sync over the encrypted tunnel.
- **MAP integration**: `MeshPeer` registers as an agent on a MapServer; `FederationGateway` does cross-mesh routing with envelope wrapping, hop counting, and loop detection (see agent-inbox's `mesh/` Phase-2 integration).
- **Reference consumer**: agent-inbox (mesh federation transport), which runs real two-inbox e2e federation over agentic-mesh MeshPeers.

**Reach for it when**: agents/peers federate directly, no central authority, encrypted NAT-traversing transport is wanted, or you need git-over-mesh.

## Profile B — openhive-sync (hub-to-hub JSON-RPC mesh)

openhive exposes a JSON-RPC **sync protocol at `/sync/v1`** (a Fastify route) for **hub-to-hub federation**. Use it for **server/hub federation across organizations or instances**.

- **Endpoint**: each instance advertises a publicly reachable sync URL (e.g. `https://myhive.example.com/sync/v1`).
- **Mechanism**: a `SyncService` with pluggable providers, auto-pull, and resource/trajectory sync over peer connections; hubs pull state from connected peers.
- **Auth**: agent-iam HMAC tokens (per the audit), not DID/SPIFFE.
- **Reference consumer**: openhive (its cross-instance sync mesh).

**Reach for it when**: federating coordination *hubs* (not individual agents), over standard HTTP/JSON-RPC, with hub-managed auth and pull-based state sync.

## Relationship to `map/federation/*`

| | `map/federation/*` | agentic-mesh | openhive-sync |
|---|---|---|---|
| Status | staging, **0 consumers** | profile, in production (agent-inbox) | profile, in production (openhive) |
| Shape | in-protocol method | separate P2P transport | separate hub JSON-RPC mesh |
| Boundary | client↔system within MAP | agent↔agent across mesh | hub↔hub across instances |

`map/federation/connect`/`route` remain specced and staging: they're the *in-protocol* federation primitive, kept for the case a deployment wants MAP itself to carry the cross-system hop. But the recommended path today is to pick a profile above. If `federation/route` gains a real consumer, it graduates per the MAP-EXT ladder; until then it is staging and these profiles are the supported answer.
