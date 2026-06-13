# `map/send` Delivery Semantics

| | |
|---|---|
| **Status** | Phase 0 Track A — closes consolidation plan OQ3 |
| **Scope** | The core transport primitive and its relationship to the mail extension |

## 1. `map/send` is ephemeral transport

`map/send` delivers a message to an address (an agent, a scope, or a federated system). It is **fire-and-forget by default** — the core protocol guarantees routing, not durability. There is no inbox, no persistence, no retry, no read state at the `map/send` layer.

Durable, threaded, persistent messaging is **not** core. It is the **mail extension** (`mail/*`, owned by agent-inbox), which layers conversations, turns, threads, read receipts, offline delivery, and search *on top of* this transport. The two-layer split:

```
┌──────────────────────────────────────────────┐
│  mail/*  (persistence: inbox, threads, …)      │  ← extension (agent-inbox)
├──────────────────────────────────────────────┤
│  map/send → map/message  (ephemeral delivery)  │  ← core transport
└──────────────────────────────────────────────┘
```

Per-message delivery semantics are expressed via `meta.delivery` (`fire-and-forget` | `acknowledged` | `guaranteed`) and `expectsResponse` — but the *default* and the *floor* is ephemeral. An implementation that persists nothing is still core-conformant.

## 2. `map/send` vs `map/message` — directionality, not duality

A recurring confusion (OQ3): the protocol has both `map/send` and `map/message`, and commit `c2743ca` "supports both." This is **not** two ways to do the same thing. They are the two directions of one delivery flow:

```
   participant                         system                         participant
   (sender)                            (server)                       (recipient)
      │                                   │                                 │
      │   map/send (request)              │                                 │
      │ ────────────────────────────────► │                                 │
      │   { to, payload, meta }           │                                 │
      │                                   │   map/message (notification)    │
      │                                   │ ──────────────────────────────► │
      │   SendResponse (accepted)         │   { from, payload, meta }       │
      │ ◄──────────────────────────────── │                                 │
      │                                   │                                 │
```

- **`map/send`** — a **request**, participant → system. "Route this payload to this address." Returns a `SendResponse` (accepted/failed).
- **`map/message`** — a **notification**, system → participant. "Here is a payload addressed to you." Delivered to the recipient's connection.

The server accepts **no inbound `map/message`** — there is no handler for a participant *sending* a `map/message`. So there is no duality to collapse; `c2743ca`'s "both" means the SDK understands `map/send` as the outbound verb and `map/message` as the inbound delivery, which is correct and stays. No deprecation is needed.

## 3. Consequences for the consolidation

- `map/send` stays **core**, explicitly labeled ephemeral transport (done — `meta.json` description + this doc).
- The mail extension is the durable layer and inverts to agent-inbox ownership (Phase 1).
- A diagram of this directionality belongs in `02-wire-protocol.md`; this doc is the normative statement Phase 0 produces.

## 4. Resolution

OQ3 is **closed**: dissolved, not decided. There was never a `map/send`/`map/message` duality — only request/notification directionality. Recorded here; removed from the open-questions set.
