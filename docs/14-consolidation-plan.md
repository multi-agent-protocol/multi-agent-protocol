# MAP Consolidation & Hardening Plan

| | |
|---|---|
| **Status** | Draft v0.2 — v0.1 open questions resolved (§9); trajectory & ACP audit evidence folded in |
| **Date** | 2026-06-11 |
| **Scope** | `multi-agent-protocol` (spec + ts-sdk) and its first-party ecosystem: openhive, agent-inbox, opentasks, swarm-dispatch, git-cascade, agent-iam, agentic-mesh |

## 1. Summary

MAP set out to be a messaging/coordination protocol for multi-agent systems. Five first-party projects later, the ecosystem has ratified a different (and more valuable) identity: **the machinery** — connection/identity envelope, scoped eventing, agent registry/lifecycle, and extension mounting — while consistently routing around the bundled domains (messaging, federation, identity standards, tasks).

This doc proposes recutting the spec around the validated machinery core (23 methods), moving domain functionality into **separately-versioned, capability-scoped extensions** with explicit stability tiers and ownership, and modularizing the SDK to match — **without breaking the wire protocol** for existing clients.

The one-line test for what belongs in core, borrowed from LSP's decision to ship DAP as a separate protocol rather than `debug/*` methods: *"Is this a `textDocument/hover`, or is this a DAP?"* Mail, tasks, workspace, credentials, and resources are DAPs.

## 2. Background

### 2.1 Origin and thesis

From `00-design-specification.md`:

> MAP treats the multi-agent system as a **transparent, observable entity** rather than an opaque black box.

The differentiated position in the protocol landscape (vs. MCP/ACP/A2A, which are all opaque at the system level) is the **window into the system**: topology, relationships, message flows, trajectories. This thesis is still unoccupied territory and is the thing to protect.

### 2.2 Current state (audited 2026-06-11)

- README claims **27 methods**; `schema/meta.json` defines **58**: 11 core, 15 structure, **32 extension**.
- Extension breakdown: mail (13), tasks (4), trajectory (4), workspace (3), cred (3), resources (2), federation (2), inject (1). The extension tier is 55% of the protocol.
- **11 error-code domains** baked into the core schema (protocol, auth, routing, agent, resource limits, federation, mail, credentials, workspace, trajectory, tasks).
- ts-sdk: ~80k lines of TS. `src/types/index.ts` alone is 4,246 lines; `server/types.ts` 1,889; `connection/client.ts` 1,802; `connection/agent.ts` 1,731. `schema/schema.json` is 3,412 lines.
- The SDK also contains an ACP bridging layer (`src/acp/`, ~2.2k lines) whose spec status is undocumented.
- Git history shows steady domain absorption: workspace → trajectory → tasks → mail → persistent identity (DID/SPIFFE) → resources. Each landed directly in the core schema with no staging step.

### 2.3 Ecosystem usage audit

| Client | SDK dep | What it uses | What it bypasses |
|---|---|---|---|
| **openhive** | ^0.1.12, required (`MAPServer`) | Registry, scoped events (per-task + `map:swarm:{id}` channels), extension mounting (**41+ custom methods**: cascade ×16, schedules ×7, specs, dispatches, sync), trajectory ×3, resources ×2 | `map/send` (uses agent-inbox), `map/federation/*` (built own JSON-RPC mesh at `/sync/v1`), DID/SPIFFE (uses agent-iam HMAC tokens) |
| **agent-inbox** | optional peer dep | `conn.send`/`onMessage` as federation transport, `callExtension("mail/recent")`; implements `mail/*` independently as a router, **with extensions the MAP spec lacks** (presence, reopen) | `map/send` as primary messaging (explicitly, per its DESIGN.md §7.3: ephemeral transport ≠ durable delivery) |
| **opentasks** | ^0.1.9, optional (dynamic import) | `AgentConnection`, 4 task methods + send/onMessage (~18 call sites), 6 custom event types into a flat scope | A2A messaging, identity, federation, credentials |
| **swarm-dispatch** | minimal (~4 call sites) | Connection + self-invented `x-` prefixed custom methods | Most of the protocol; works around `AgentConnection` not exposing request-handler registration; carries legacy `map/dispatch/message` |
| **git-cascade** | **none** | Reaches MAP only via openhive's mounted cascade methods | Everything (and that's the extension pattern working correctly) |
| **claude-code-swarm** | ^0.1.9, required | Connection, capability declaration, `trajectory/checkpoint` (×2 call sites — the protocol's *only* trajectory caller) | Spec's chunked content streaming (ships custom `trajectory/content.request`/`.response` notifications); invents broadcast fallback + `resource_id` caching |
| **sessionlog** | **none** (by design) | — (exports wire types openhive imports; data plane is git: checkpoints as tree objects on `sessionlog/checkpoints/v1`) | All of MAP; trajectory data never touches the protocol |

**Ratified by all consumers:** connect/auth envelope, subscribe + scoped events, registry/lifecycle, extension mounting.
**Specced in core but rejected in practice:** `map/send` as messaging, `federation/*`, DID:key/SPIFFE, `map/tasks/*` (the actual task system only optionally bridges to it), the trajectory query/content surface (`list`/`get`/`content` have zero callers anywhere), and the explicit `map/session/*` methods (zero callers; resume is solved at the application layer).

### 2.4 Problem statement

1. **Spec drift** — README vs. meta.json (27 vs. 58); documentation lags reality.
2. **Diluted opinion** — domain CRUD (mail/turn, tasks/update, resources/get) makes MAP read as "namespaced JSON-RPC" rather than the observability protocol it is.
3. **Dual sources of truth** — MAP's mail spec and agent-inbox's implementation are diverging (agent-inbox is "subset + extensions").
4. **Unowned conventions** — swarm-dispatch invented `x-` prefixes; openhive invented its own error/bypass patterns; nothing blesses or standardizes them.
5. **Compliance ambiguity** — "implements MAP" has no precise meaning when extensions live in the same schema and version stream as core.
6. **SDK weight** — a consumer who wants the event bus pays for mail, ACP, trajectory, and credential types.

## 3. Prior art: how mature protocols contain the kitchen sink

| Mechanism | Exemplar | Lesson for MAP |
|---|---|---|
| Per-feature capability negotiation; tiny mandatory core | LSP, JMAP | Gate every feature at connect; a server implementing only registry+events is conformant |
| Domains shipped as separately-versioned specs | JMAP (RFC 8620 core + 8621 mail), LSP→DAP split | Core standardizes machinery and the *shape* of a domain; domains are separate documents |
| Standardized extension shape (naming, errors, lifecycle) | JMAP `Foo/get`·`Foo/set`·`Foo/changes`, K8s API machinery + CRDs | openhive's 41 custom methods are CRDs; make that first-class |
| Stability ladder + graduation gate | Wayland (unstable `z` prefix → staging → stable), Matrix MSCs, LSP "proposed" | Nothing lands in core directly; promotion requires independent consumers |
| Blessed experimental namespace | LSP vendor methods, Matrix `org.x.*` | Bless `x-` (already in the wild) |

Cautionary tales: **Matrix** (extraction without gates → spec became flagship vendor's changelog; "implements Matrix" lost meaning) and **X11** (frozen-but-bloated core became dead weight while life moved to extensions). MAP is currently on the Matrix trajectory.

## 4. Design decisions

### D1 — Recut the spec to the ratified machinery core

**Decision:** Core = connection/auth envelope (including `sessionId`), `map/send` (explicitly relabeled *ephemeral transport*), subscribe/events, agent registry/lifecycle, scopes, `structure/graph`: **23 methods + 2 core notifications**. The explicit `map/session/*` methods move to a staging extension — see D10.

**Rationale:** This is precisely the subset every consumer uses. It also realigns the protocol with its thesis (observable system structure).

**Alternatives considered:**
- *Status quo with better docs* — doesn't fix dual sources of truth or compliance ambiguity.
- *LSP-style: keep monolithic spec, rely purely on capability gating* — contains the wire but not the document; spec keeps growing; rejected.
- *Full unbundling into independent protocols (no shared core)* — loses the shared machinery that is MAP's actual value; rejected.

**Consequences:** `map/send` semantics must be documented as fire-and-forget transport with durable messaging explicitly delegated to the mail extension. Trajectory's placement is the one genuinely contestable call (see Open Questions — it is on-thesis).

### D2 — Extensions become separately-versioned, capability-scoped specs

**Decision:** Each domain (mail, tasks, trajectory, workspace, cred, resources, federation) moves to its own schema file and spec document with its own version, declared via a capability URI (e.g., `urn:map:ext:mail:1`) negotiated at `map/connect`.

**Rationale:** JMAP's model, which the ecosystem has already de facto adopted (agent-inbox ships mail independently; openhive mounts its own domains).

**Consequences:** `schema/schema.json` and `meta.json` split into `schema/core/` + `schema/ext/<name>/`. Wire format unchanged; only spec packaging and capability advertisement change.

### D3 — Standardize the extension *shape* (the MAP-EXT spec)

**Decision:** A one-page normative spec defining what any extension must declare:
- **Namespace**: method prefix (`mail/`, `tasks/`, …) **or** a payload-protocol discriminator for extensions that define no methods and ride on `map/send` payloads (`payloadProtocol: "acp"` — see `15-acp-tunnel-extension.md`, the reference case); experimental extensions use `x-`.
- **Capability URI** + version, advertised in `ConnectResponse.capabilities`.
- **Error-code range**: allocated from a registry (mail already squats 10000–10010 — formalize the allocator; experimental range reserved, e.g. ≥ 90000).
- **Event-type naming**: `<ns>.<noun>.<verb>` (e.g., `mail.turn.created`), routed through core scopes.
- **Stability label**: experimental / staging / stable.
- **Owner**: the repo that is the source of truth for the extension's schema.

**Rationale:** The core's most-validated feature is extension mounting; this makes the implicit contract explicit so extensions inherit semantics instead of reinventing them (the JMAP/K8s lesson).

### D4 — Stability ladder with a graduation gate

**Decision:** Three tiers with promotion rules:
- **experimental** (`x-` prefix, error codes ≥ 90000): anyone, no review; never advertised as MAP.
- **staging** (namespaced, registered URI, schema in `schema/ext/`): requires a written spec + one real consumer.
- **stable**: requires **≥ 2 independent consumers**, conformance tests, and no breaking changes for one release cycle. Prefix/URI version locks at graduation.

**Retroactive audit under this rule:**
- **mail** → stable (consumers: agent-inbox, openhive) — but ownership inverts (D5).
- **trajectory/checkpoint** → stable nucleus (claude-code-swarm reports it; openhive serves/receives) — the query/content surface demotes; see D12.
- **acp-tunnel** → staging (consumer: openhive Threads) — promoted from undocumented SDK code to a written spec; see D11.
- **tasks, workspace, resources, cred, federation, inject (→ "steering", D9), sessions (D10), trajectory query/content (D12), identity-standards matrix** → **staging** (≤1 real consumer each).

**Rationale:** Wayland's pipeline; prevents the Matrix failure mode. The audit isn't punitive — staging extensions remain fully usable; they just stop inflating the core compliance surface.

### D5 — Invert domain ownership

**Decision:** The source of truth for a stable extension lives with its primary implementation:
- **mail** → agent-inbox repo owns the spec; MAP references it. Divergences (presence, reopen, participant management) get reconciled *into* the owned spec rather than treated as drift.
- **tasks** → candidate transfer to opentasks (decision point in Phase 4 — opentasks may decline; then tasks stays a MAP-staging extension).
- **cred** → candidate transfer to agent-iam.
- **trajectory** stays MAP-owned (on-thesis).

**Rationale:** The de facto implementations already lead the specs. Authority should follow reality or the divergence becomes a permanent fork.

**Consequences:** MAP core repo keeps a *registry* (name, URI, owner, stability, schema location) rather than the schemas themselves for externally-owned extensions.

### D6 — Demote federation and the identity standards matrix

**Decision:**
- `federation/connect|route` → staging. Bless **transport profiles** instead: agentic-mesh (P2P/CRDT) and openhive-sync (hub JSON-RPC mesh) become documented profiles, not competitors to a core feature nobody uses.
- Identity: keep `persistentId` as an **opaque string** plus the existing `IdentityVerifier` hook in core. DID:key/SPIFFE/DID:web become an optional staging extension; remove the standards matrix from the core pitch/README.

**Rationale:** Zero observed uses of `federation/route`; openhive ships HMAC tokens, not DIDs. The hook architecture is right; the standards commitment is aspirational surface area.

### D7 — Modularize the SDK to mirror the spec

**Decision:**
- `@multi-agent-protocol/sdk` (core): connection, auth, events/subscriptions, registry, scopes, structure — plus the extension framework (`defineExtension()`, `server.mount()`, client `callExtension()` with typed manifests).
- Subpath exports per extension: `@multi-agent-protocol/sdk/ext/trajectory`, `/ext/tasks`, etc. Externally-owned extensions ship their own packages (e.g., agent-inbox publishes the mail client/server types).
- Fix known integration friction as part of the framework: expose request-handler registration on `AgentConnection` (removes swarm-dispatch's workaround), document the mounting pattern openhive currently does by hand.
- Decide the fate of `src/acp/` (see Open Questions).

**Rationale:** Consumers of the event bus shouldn't pay for mail/ACP/cred types; 4.2k-line type barrels are a symptom of the same accretion as the schema.

### D8 — Wire compatibility and versioning policy

**Decision:** `protocolVersion` stays 1; no wire-breaking changes in this program. All restructuring is at the spec-packaging, capability-advertisement, and SDK-packaging layers.
- SDK: 0.1.x → **0.2.0** (deprecations + subpath exports; old import paths re-export with `@deprecated`) → **0.3.0** (removals after all first-party clients migrate).
- Deprecation window: one minor version with both paths working; CI grep across first-party repos gates removal.
- `map/connect` response gains `capabilities.extensions: [{uri, version}]`; absence implies legacy server (clients treat all methods as potentially present — current behavior).

### D9 — Profiles: named bundles of core + extensions

**Decision:** Introduce **profiles** in the MAP-EXT spec (one paragraph): a profile is a named, versioned bundle of core + specific extensions targeting a use case. First profile: **"MAP Observability"** = core + trajectory (checkpoint nucleus, D12) + steering.

**Rationale:** Resolves the "thesis vs. small core" tension (v0.1 OQ1/OQ4) without raising the conformance floor: a toy system implements core in an afternoon; a serious deployment advertises Observability-complete. Precedent: BLE profiles, A2A companion specs.

**Consequences:** Profiles are conformance + marketing surface, not wire features; the conformance suite (Phase 5) gains per-profile packs.

### D10 — Session split: identity in core, management to staging

**Decision:** `sessionId` and reconnect semantics remain core — they live in the connect envelope and are implemented in `connection/gateway.ts` and `connection/agent.ts`. The explicit `map/session/list·load·close` methods demote to a staging **"sessions"** extension. Core shrinks 26 → 23 methods.

**Rationale:** Zero downstream callers of the explicit methods, while resume is solved at the application layer in every real deployment: agent-inbox replays via `mail/recent`; openhive resumes via ACP `loadSession`. The ecosystem's verdict: *connection identity is core; resume-state is an application concern.*

**Consequences:** The graduation gate applies to core too — this is it working in reverse. If a real session-management consumer appears, the extension graduates back on evidence.

### D11 — Promote ACP tunneling to a first-class staging extension

**Decision:** The undocumented `ts-sdk/src/acp/` layer (~2.2k lines) becomes the **acp-tunnel** staging extension with a written spec: `15-acp-tunnel-extension.md` (`urn:map:ext:acp-tunnel:1`). SDK code moves to `src/ext/acp/` in Phase 2.

**Rationale:** It is load-bearing (openhive's entire Threads/web-chat experience) but had zero spec presence — a protocol feature that existed only as implementation. It also completes the thesis: the window lets you *watch* the system; the tunnel lets you *converse with* an agent inside it. And it is MAP's interop bridge to the broader ACP ecosystem.

**Consequences:** acp-tunnel is a **payload-protocol extension** — no methods; it rides `map/send` with `protocol: "acp"` message metadata and an `ACPEnvelope` payload. The manifest format must therefore support `payloadProtocol` alongside `methodPrefix` (folded into D3 / Phase 1). One consumer → staging per D4's gate.

### D12 — Trajectory recut: stable checkpoint nucleus, staging query surface

**Decision (scheduled now):** Trajectory stays an extension (v0.1 OQ1 closed) and is recut to match observed reality. This is a documentation/labeling change only — no new mechanism:

- `trajectory/checkpoint` → **stable nucleus**. claude-code-swarm reports it (the protocol's only trajectory caller, 2 sites); openhive serves/receives.
- The spec adopts what the implementation shipped: the **broadcast fallback** (degrade to a message broadcast when the extension is unsupported) and the **`resource_id` response linkage** (checkpoints reference the resources extension).
- `trajectory/list`/`get`/`content` + chunked `content.chunk` streaming → **staging, federation-gated** within the extension: zero callers *because the topology that needs them isn't deployed*, not because they're unwanted (see below). They are NOT removal candidates.

**Why list/get/content are not dead spec:** they are the **cross-boundary retrieval path**. Within a trust/access boundary (openhive + sessionlog today) every participant can `git fetch` the `sessionlog/checkpoints/v1` branch directly — git is the data plane and MAP only needs to signal "a checkpoint happened," so the query methods are redundant. Across a **federation boundary**, a consumer cannot `git fetch` a remote system's private sessionlog repo (no route, no credentials, maybe no shared host); MAP-mediated retrieval over `federation/route` is then the only path. The methods are provisioning for a topology that exists in the design but not yet in deployment.

**Rationale:** The near-term recut is mail-redux labeling — implementation leads spec. The federated-retrieval *machinery* (provider port, content locators, transport profiles) is real and worth designing, but has zero current consumers and no deployed topology to exercise it, so building it now would be the exact speculative accretion this whole effort reverses. It is therefore **design-only and deferred** — captured in Appendix C, not sequenced into the build phases.

**Consequences:** The Observability profile (D9) carries the thesis instead of core membership. The canonical-checkpoint-schema question (was: "adopt sessionlog's `SessionSyncCheckpoint`?") is **reframed by the multi-provider design** — if there is to be more than one trajectory provider, the canonical wire shape must be minimal and provider-neutral, not sessionlog's rich type (Appendix C, §C.4). Decision deferred with that framing.

## 5. Target architecture

### 5.1 Core surface (23 methods + 2 notifications)

```
Connection   map/connect · map/disconnect · map/auth/refresh
                                           (sessionId lives in the connect envelope — D10)
Transport    map/send                      (ephemeral; durable delivery = mail ext)
Events       map/subscribe · map/unsubscribe          [notif: map/event, map/message]
Registry     map/agents/list · get · register · spawn · unregister · update
Lifecycle    map/agents/stop · suspend · resume
Structure    map/structure/graph
Scopes       map/scopes/list · get · create · delete · join · leave · members
```

### 5.2 Extension manifest (example)

```jsonc
// schema/ext/trajectory/manifest.json
{
  "name": "trajectory",
  "uri": "urn:map:ext:trajectory:1",
  "stability": "stable",
  "owner": "multi-agent-protocol",
  "methodPrefix": "trajectory/",
  "errorRange": [13000, 13999],
  "events": ["trajectory.checkpoint.created"],
  "notifications": ["trajectory/content.chunk"],
  "schema": "./schema.json"
}
```

### 5.3 Repo layout (after Phase 1)

```
multi-agent-protocol/
├── docs/
│   ├── core/                  # recut core spec
│   ├── map-ext.md             # the extension-shape spec (D3)
│   └── registry.md            # extension registry incl. externally-owned
├── schema/
│   ├── core/{schema,meta}.json
│   └── ext/{trajectory,acp-tunnel,steering,sessions,tasks,workspace,cred,resources,federation,identity}/
└── ts-sdk/
    ├── src/{connection,events,registry,scopes,extension}/   # core
    └── src/ext/<name>/        # one module per MAP-owned extension
# mail schema+spec live in agent-inbox (registry entry points there)
```

## 6. Phased implementation plan

> Each phase ships independently and is wire-compatible. **Steering signals** are observations that validate or refute the phase's design assumption — check them before starting the next phase. **Kill/adjust criteria** are explicit off-ramps.

**Sequence at a glance** (revised after the §6.0 + dependency review — the fit-test moved to the front, mail split logically, conformance pulled forward):

| Phase | What | Long pole | Exit gate |
|---|---|---|---|
| **0 Groundwork** | truth/inventory ‖ design the 2 artifacts ‖ **fit-test spike** | the spike + design | **fit-test verdict** (build vs. descope) recorded |
| **1 Spec** | apply `map-ext.md`; schema split *(if "build")*; core conformance net; **mail spec-inversion starts** | — | conformance green on current SDK |
| **2 SDK** | implement chosen path; validate vs. openhive; **publish 0.2.0 last** | the one-way door | validation + conformance green |
| **3 Mechanics** | mail types/conformance; trajectory recut (labeling) | — | divergence = 0 |
| **4 Migration** | demotions; 0.2→0.3 across 5 repos; **P5 overlaps the wait** | 5-repo bandwidth (calendar) | CI grep clean |
| **5 Conformance** | generalize packs; graduation checklist | — | core+mail packs pass |

The program is **calendar-bound, not coordination-bound** — since we own every repo (incl. agent-inbox), the only true long pole is the 0.2→0.3 migration window across the 5 SDK consumers; everything else is keyboard time gated by the Phase 0 verdict.

### 6.0 Confidence triage

Every item below is classified by whether a consumer or concrete friction exists **in today's code** (build now) vs. whether it provisions for a future third party / undeployed topology (defer). The goal is that everything *scheduled* is evidence-backed; everything speculative is captured but parked. Same discipline that moved federated-trajectory retrieval to Appendix C.

- ✅ **Backed** — a real consumer or friction exists now; build as written.
- ◑ **Backed-minimal** — the need is real but the item as written over-builds; do the minimal version now, defer the rest.
- ⏸ **Deferred** — design-only / ahead of demand; capture, don't schedule.

| Phase · item | Class | Note |
|---|---|---|
| **P0** all (README fix, stability labels, registry, send/message diagram) | ✅ | Pure truth-telling; documents what exists. Highest-confidence phase. |
| P1.1 map-ext: namespace, URI, stability ladder, graduation rule | ✅ | Documents conventions already in use (`x-`, error ranges). |
| P1.1 map-ext: error-range **allocator** | ◑ | Ship a **table** of allocated ranges now; build allocation *tooling* only when a third party needs a range. |
| P1.1 map-ext: **profiles** (D9) | ◑ | Define the concept + name "MAP Observability." No profile *catalog* or *enforcement* yet. |
| P1.2 schema split (`core/`+`ext/`) + merged-artifact build | ◑ | **The infrastructure bet** — only strictly needed to feed P2.1 codegen. Couple its go/no-go to P2.1 (below). P0.3 registry already delivers the *conceptual* split. |
| P1.3 `capabilities.extensions` on ConnectResponse | ◑ | **Advertise only.** Defer any client-side enforcement/consumption — no client checks capabilities today. |
| P1.4 bless `x-` namespace | ✅ | swarm-dispatch already ships `x-` methods. |
| P2.1a typed accessors + packaging from manifests | ✅ | Concrete: kills the 4.2k-line barrel and bundle weight. |
| P2.1b `defineExtension()` **mount framework** | ◑ | Gate on the openhive fit-test (existing Phase 2 kill/adjust). If it can't express hub-driven mounting, descope to typing-only. |
| P2.2 subpath exports + deprecated re-exports | ✅ | Bundle weight is measured friction. |
| P2.3 `AgentConnection` request-handler registration | ✅ | Deletes swarm-dispatch's actual workaround. High value, concrete. |
| P2.4 split `types/index.ts` | ✅ | Addresses the 4,246-line barrel directly. |
| **P3** all (mail inversion + trajectory recut) | ✅ | Mail = strongest evidence (2 consumers + live divergence). Trajectory already reduced to labeling-only. |
| **P4** all (demotions, ownership offers, migration, federation **profile docs**) | ✅ | Labeling + decisions + client migration. The federation work here *documents existing systems* (agentic-mesh, openhive-sync) — it does **not** build `federation/route`. |
| P5.1 conformance: **core + mail** packs | ✅ | Both have ≥2 implementations today (core: openhive + SDK testing server; mail: agent-inbox + openhive). |
| P5.1 conformance: other per-extension packs + published `npx` CLI | ⏸ | Per-staging-extension packs wait for graduation; ship an **in-repo harness** now, not a standalone published CLI for third parties who don't exist yet. |
| P5.2 graduation checklist (PR template) | ✅ | Cheap; value is **discipline**, not governance (single-maintainer gate is acknowledged theater in §8). |
| P5.3 run core pack vs. 2 servers | ✅ | Both servers exist today. |

**The one coupled bet.** P1.2 (physical schema split) and P2.1b (mount framework) are a single infrastructure wager: the split exists mainly to feed the codegen, and the codegen is what justifies the split. Everything else in the plan — truth-telling, friction fixes, mail inversion, demotions — delivers its value **independently of whether that bet ever pays off**. The go/no-go is now decided up front by the **Phase 0 fit-test spike** (Track C), *before* the schema split it gates: if the spike can't mount one openhive method cleanly, descope *both* to "manifests-as-typed-docs" and keep the conceptual split from P0 Track A's registry. The infrastructure never becomes load-bearing before the spike clears it. **(Resolved 2026-06-11: spike passed → BUILD. See Phase 0 exit gate.)**

**Cross-cutting deferrals** (the "for future third parties" pattern, consolidated): capability-negotiation *enforcement* (advertise yes, enforce no); registry/error-range *tooling* and a published runtime JSON registry (markdown tables now — consistent with OQ6); profile *catalog/enforcement* (concept + one name now); published conformance *CLI* (in-repo harness now); all federated-trajectory machinery (Appendix C). None are scheduled; each has a named trigger that would pull it in.

### Phase 0 — Groundwork (≈1 week)

**Goal:** Documentation matches reality, the two design artifacts are pinned, and **the coupled-bet go/no-go is decided before any schema work begins** (§6.0). Nothing structural starts until this phase's exit gate clears.

**Track A — Truth & inventory (≈1–2 days, the original Phase 0):**
1. Fix README method count and feature claims (remove DID/SPIFFE/federation from the headline pitch; mark as staging).
2. Add `stability` field to every method in `meta.json` (values per the D4 retroactive audit) — additive, non-breaking.
3. Write `docs/registry.md`: full inventory of extensions, consumers, and de facto owners (Appendix A of this doc is the seed). Enumerate agent-inbox's mail divergences (presence, reopen, participant mgmt) here — this is the input Phase 1's mail spec-inversion consumes.
4. Document `map/send` delivery semantics as ephemeral transport, with a directionality diagram covering `map/send` (participant→system request) vs `map/message` (system→participant delivery notification) — closes v0.1 OQ3, which evidence dissolved (the server accepts no inbound `map/message`; there is no duality, only directionality).

**Track B — Design the two gating artifacts (parallel):**
5. Pin the **extension manifest format** + the normative `map-ext.md` shape — including the `payloadProtocol` variant acp-tunnel needs (D11), the error-range table (not tooling), event-naming grammar, stability ladder, graduation rule, profiles concept (D9). Output is a written spec Phase 1 *applies*, not invents.
6. Pin the **SDK extension API** on paper: `defineExtension()` shape (1a accessors / 1b mount) and the `AgentConnection` request-handler seam — enough to prototype against.

**Track C — Fit-test spike (the exit gate):**
7. Throwaway spike: mount **one** openhive cascade method through a candidate manifest + `defineExtension`, validated via the `references/` symlink. This is the coupled-bet decision (§6.0) pulled to the front, *before* the expensive schema split it's supposed to gate.

**Exit gate (blocks Phase 1):**
- **Fit-test verdict recorded:** spike mounts the openhive method with no bypass code → **build the framework** (P1.2 split + P2.1b proceed); spike needs bypass/hacks → **descope to typing-only** (manifests as typed docs; skip the physical split; keep the conceptual split from `registry.md`). Either outcome is acceptable; what's not acceptable is splitting the schema before this is answered.

> **VERDICT (2026-06-11): BUILD.** The spike (`ts-sdk/src/__tests__/phase0-fit-test-spike.test.ts`, 2/2 green) confirmed a prototype `defineExtension()` over the existing `MAPServerOptions.additionalHandlers` seam mounts a hub-closing cascade method **with no bypass code**, merges a capability fragment, and round-trips through a typed client accessor. The manifest prefix invariant is load-bearing (rejects escaping methods). SDK suite stays green (74 files / 2224 tests). → P1.2 schema split and P2.1b mount framework proceed. Spike is throwaway but may seed the Phase 2 framework test.

**Acceptance criteria:**
- README method count generated from `meta.json` (script in CI, not prose).
- Every method has a stability label; zero unlabeled.
- `registry.md` complete incl. enumerated mail divergences.
- `map-ext.md` + the SDK API sketch exist and are concrete enough to implement against.
- Fit-test spike run and verdict recorded.

**Steering signals:**
- Writing the registry should be mechanical. **If any extension's owner/consumer set is ambiguous, that's a finding** — record it as an open question rather than guessing.
- **The spike is the cheapest possible version of the bet.** If it's *almost* clean (one awkward seam), that's signal to adjust the API now, not to force the verdict — iterate the sketch and re-spike before committing.

### Phase 1 — Extension architecture in the spec (≈1 week)

**Goal:** D2 + D3 land in spec form; schemas split *(only if the Phase 0 verdict said "build")*; wire format untouched. `map-ext.md` was *pinned* in Phase 0 Track B; this phase *applies* it.

Work items:
1. Finalize `docs/map-ext.md` from the Phase 0 Track B draft (any spike-driven adjustments folded in).
2. **Gated on the Phase 0 verdict:** if "build" — split `schema/schema.json`/`meta.json` into `schema/core/` + `schema/ext/<name>/` with manifests (§5.2), plus a build step emitting a merged artifact identical to today's. If "descope" — skip the physical split; manifests live as typed docs alongside the existing schema. The split is now an *informed* step, not a blind bet.
3. Add `capabilities.extensions` to `ConnectResponse` schema (optional field, **advertise-only** — no client-side enforcement, §6.0).
4. Bless `x-` as the experimental namespace; reserve experimental error range.
5. **Stand up the core conformance pack here** (pulled forward from Phase 5): it needs nothing from later phases and becomes the **wire-compatibility regression net** guarding the P2 SDK split — directly enforcing the D8 promise during the riskiest refactor.
6. **Start mail spec-inversion (parallel, the spec half of the logical split):** move the mail schema + spec doc into agent-inbox and reconcile divergences into mail v1.1. Pure doc/ownership work, zero SDK dependency — runs alongside the SDK track. The *mechanics* (types publishing, conformance) land in Phase 3.

**Acceptance criteria:**
- Merged-schema artifact is byte-equivalent (modulo ordering) to the pre-split schema — CI check.
- The mail extension's full surface (13 methods, error codes 10000–10010, events) AND acp-tunnel's payload-protocol surface (zero methods, `protocol: "acp"` discriminator) are both expressible in the manifest format with no special cases.
- swarm-dispatch's `x-` methods are *already conformant* with map-ext.md without code changes.

**Steering signals:**
- **If mail or acp-tunnel can't be cleanly expressed in the manifest shape, the shape is wrong** — fix the shape, don't special-case them (mail is the most demanding method-prefix extension; acp-tunnel is the only payload-protocol one; everything else is simpler).
- If the core/ext split forces `$ref`s from core into any extension schema, the core cut is wrong (core must not depend on extensions).

**Kill/adjust:** If the split requires wire-visible changes, stop and redesign — this program promises wire compatibility.

### Phase 2 — SDK modularization + friction fixes (≈1–2 weeks)

**Goal:** D7. The SDK's packaging mirrors the spec; known integration workarounds become unnecessary.

Work items:
1. Extension framework, per the Phase 0 verdict: **(1a)** typed client accessors + per-extension packaging generated from manifests — build regardless; **(1b)** the `defineExtension(manifest)` server-mount framework — build only if Phase 0 said "build" (else ship 1a-only). The descope decision was already made in Phase 0; this phase implements the chosen path rather than discovering it.
2. Subpath exports `@multi-agent-protocol/sdk/ext/*`; root export re-exports with `@deprecated` (removal in 0.3).
3. Expose request-handler registration on `AgentConnection` (swarm-dispatch friction).
4. Split `types/index.ts` along core/ext lines.
5. **Publish 0.2.0 last, and only after the publish gate clears** (below). This is the one-way door — the deprecated-re-export surface is committed once published.

**Acceptance criteria (the publish gate — all must hold before 0.2.0 ships):**
- Core conformance pack (stood up in Phase 1) is **green** against the modularized SDK — the wire-compat regression net catches any D8 violation introduced by the split.
- Core-only consumer bundles without mail/ACP/cred/trajectory types (verify via bundle analysis).
- openhive's real adoption (not the throwaway spike) mounts cascade methods with no bypass code, validated via the `references/` symlink workflow **before** publishing.
- swarm-dispatch deletes its notification-RPC workaround in a branch using the pre-publish build.
- All existing tests green; opentasks' dynamic import works unchanged.

**Steering signals:**
- **Migration cost is the signal.** Target: openhive's upgrade is imports-only (≤1 day). If it requires touching method-registration logic beyond imports, the framework abstraction is wrong — fix before publishing (the door hasn't closed yet).
- Watch whether openhive *voluntarily* migrates more of its 41 custom methods to `defineExtension()` than required. Enthusiastic adoption = the abstraction earns its keep; grudging compliance = revisit ergonomics (still pre-publish, still cheap to change).

**Kill/adjust:** The framework go/no-go already happened in Phase 0. If real-adoption validation here contradicts the spike (passed the one-method spike but fails at scale), treat that as the door still being open: descope to 1a-only and republish the plan, do **not** ship 0.2.0 with an API you'll have to break.

### Phase 3 — Domain mechanics: mail types/conformance + trajectory recut (≈1–2 weeks)

**Goal:** Land the *mechanics* of D5 for mail (the spec-inversion half was done in Phase 1) and D12 for trajectory. The logical split keeps the human-latency-bound spec work early and the SDK-dependent mechanics here, after 0.2.0.

Work items:
1. MAP registry entry points at agent-inbox (mail spec already moved in Phase 1); `schema/ext/mail/` becomes a pinned mirror or is deleted (decide via steering signal below).
2. agent-inbox publishes mail types (own package or contributed `/ext/mail` subpath) — needs the 0.2.0 packaging from Phase 2.
3. Replace ts-sdk's ~4k lines of mail tests (`server-mail-*`, `mail-protocol`) with a mail conformance pack that runs against agent-inbox's implementation.
4. Recut the trajectory spec (D12) — **labeling only, no new mechanism**: `trajectory/checkpoint` becomes the stable nucleus; spec the broadcast fallback and `resource_id` response linkage that claude-code-swarm shipped; mark `list`/`get`/`content` (+ chunked streaming) as **staging, federation-gated** with a pointer to Appendix C. *Not in scope for this phase:* the provider port, content locators, and federated-retrieval machinery — those stay design-only (Appendix C) until a federated topology exists to drive them.

**Acceptance criteria:**
- Divergent-method count between spec and implementation: **0** (reconciled in Phase 1; verified green here by the mail conformance pack).
- openhive consumes mail types from the new location.
- MAP core repo contains no mail method definitions (registry pointer only).
- claude-code-swarm's two `trajectory/checkpoint` call sites are spec-conformant with zero code changes (fallback + `resource_id` now documented).
- The trajectory spec contains no *stable* surface with zero consumers (`list`/`get`/`content` clearly marked staging).

**Steering signals:**
- **Does the divergence converge or grow once the spec is owned in agent-inbox?** Converging = inversion correct. If agent-inbox starts speccing things that belong in core (e.g., delivery semantics on `map/send`), the core/ext boundary needs adjusting — that's signal, not noise.
- *Dual-home fallback is now optional, not a hedge.* Because we own agent-inbox with write access (no cross-party negotiation), reconciliation is an internal decision made in Phase 1, not a stall risk. Freezing MAP mail v1.0 while agent-inbox owns v1.1+ remains available as a *sequencing* convenience, but the ">2-week stall" trigger from the cross-party version of this plan no longer applies.
- After the trajectory recut: does openhive start *querying* checkpoints over MAP (`list`/`get`), or keep reading sessionlog's git branches directly? Direct-git winning is the expected, healthy outcome within a single boundary — it confirms git as the data plane and MAP as the notification plane. **The signal that would pull Appendix C from design into build is a second MAP system needing checkpoint content across a federation boundary** — until that exists, the deferral holds.

### Phase 4 — Demotions & client migrations (≈2 weeks elapsed, mostly waiting)

**Goal:** D6 + remaining D5. Staging extensions clearly labeled; clients on 0.2.x; ownership decision points resolved.

Work items:
1. Demote tasks/workspace/resources/cred/federation/inject/identity-matrix to staging in all docs and the registry (already labeled in meta since Phase 0; this is the spec-document recut, D1).
2. **Decision point — tasks ownership:** offer transfer to opentasks. If accepted: opentasks owns the spec, MAP registry points there. If declined: tasks remains MAP-staging.
3. **Decision point — cred ownership:** same offer to agent-iam.
4. Write the two federation transport profiles (agentic-mesh, openhive-sync) as short profile docs; mark `federation/*` methods staging with pointers.
5. Migrate the five SDK-consuming repos (openhive, agent-inbox, opentasks, swarm-dispatch, claude-code-swarm) to 0.2.x imports; remove deprecated-path usage. The other documented repos (git-cascade, sessionlog, agent-iam, agentic-mesh) carry no SDK dependency and are untouched here — see §7.2.
6. Publish 0.3.0 (remove deprecated re-exports) once the CI grep across first-party repos shows zero old-path imports.

**Acceptance criteria:**
- All first-party repos on 0.2.x+ with zero deprecated-path imports (CI grep).
- Core spec document contains only the 23-method surface; staging/stable extensions live in their own docs.
- Both ownership decision points have a recorded decision (either outcome is acceptable).

**Steering signals:**
- **Post-demotion usage of staging extensions** (grep across repos / openhive telemetry if available): if a staging extension picks up a second independent consumer, that's the graduation signal — promote it via the D4 gate, which proves the ladder works in both directions.
- If any demotion breaks a consumer you didn't know about, the Phase 0 registry was incomplete — fix the registry process, not just the breakage.

### Phase 5 — Conformance & governance (overlaps Phase 4's migration wait; first cut ≈1 week)

**Goal:** "Implements MAP" means something testable; the graduation pipeline is self-service. The **core pack already exists** (stood up in Phase 1 as the P2 regression net) and the **mail pack** landed in Phase 3 — this phase generalizes and governs rather than starting from zero. It runs during Phase 4's calendar-bound migration wait, not after it.

Work items:
1. Generalize the in-repo conformance harness to **core + per-stable-extension packs** (mail exists; trajectory-checkpoint next). Per-*staging*-extension packs wait for graduation (§6.0). The standalone published `npx` CLI stays deferred — in-repo harness only until a third-party implementer exists.
2. Graduation checklist as a PR template in the registry (spec doc + 2 consumers + conformance pack + 1 stable release cycle) — value is **discipline**, not governance (the single-maintainer caveat in §8 stands).
3. Run the core pack against openhive's MAPServer and the SDK's testing server; publish results in the registry.

**Acceptance criteria:**
- Core conformance pack passes against ≥2 server implementations (openhive `MAPServer` + SDK testing server).
- Mail conformance pack (from Phase 3) passes against agent-inbox.
- A new extension can go experimental → staging without touching the MAP core repo (registry PR only).

**Steering signals:**
- **The real success metric for the whole program:** the next new project (or next openhive subsystem) ships its domain as a conformant extension *without anyone proposing core schema changes*. If new domains still gravitate toward core, the extension path isn't cheap enough — fix ergonomics, not policy.

## 7. Blast radius: external changes by repo

### 7.1 The invariant

Because of D8, **no external repo experiences a wire-breaking change** — no running system stops talking to another at any point in the sequence. Every external change is one of: a package version bump (import paths), a spec-ownership transfer, code that gets *deleted*, or nothing. Crucially, the **forced moment is never 0.2.0** — that release ships deprecated re-exports so old and new import paths both work; the only hard cutover is "before 0.3.0 publishes," and even that is gated by a CI grep across the repos rather than a flag day. A repo can sit on 0.2.x indefinitely and keep working.

### 7.2 Per-repo sequence

Ordered by how much actually changes. "Forced" = required to keep working; "optional" = adopt for benefit.

| Repo | Dep today | Forced changes (when) | Optional / ownership | Net effect |
|---|---|---|---|---|
| **agent-inbox** | optional peer dep | Imports-only bump (P2). **Host the mail spec + schema; reconcile its divergences into mail v1.1; publish mail types; be the mail conformance target (P3)** | — | The only repo that gains real new work — authorship, not migration. Ends chasing an upstream spec it already diverged from |
| **openhive** | `^0.1.12`, required (`MAPServer`) | Imports-only bump (P2, ≤1 day target); mail types now sourced from agent-inbox; trajectory/resources imports → `/ext/*` subpaths; drop deprecated-path imports before 0.3.0 (P4) | Register its 41 custom methods (cascade/schedules/specs/dispatches) as staging extensions via `defineExtension` — *contingent on the coupled bet clearing (§6.0)*. Core-conformance target (P5) may surface small fixes | Many small import edits, one optional adoption, **no behavior change** |
| **swarm-dispatch** | minimal (~4 sites) | Imports-only bump (P2) | **Delete** its notification-RPC workaround once `AgentConnection` exposes request-handler registration (P2); drop the legacy `map/dispatch/message` alias via the deprecation window; optionally register its dispatch extension as staging (P4) | Ends with **less code**; its `x-` methods become retroactively spec-conformant (P1, no edit) |
| **claude-code-swarm** | `^0.1.9`, required | Imports-only bump (P2) | — | Zero forced edits beyond the bump. The trajectory recut documents what it already ships (broadcast fallback + `resource_id`), so its 2 `trajectory/checkpoint` sites become conformant with no change; its `content.request`/`.response` pattern feeds deferred Appendix C |
| **opentasks** | `^0.1.9`, optional (dynamic import) | None — dynamic import keeps working against 0.2.0 | **Decision point (P4):** accept ownership of the tasks extension spec, or decline and keep consuming MAP-staging `tasks`. No code change either way | The model citizen; only open question is whether it wants the spec |
| **agent-iam** | referenced (HMAC tokens) | None | **Decision point (P4):** accept ownership of the `cred` extension spec, or decline (cred stays MAP-staging). openhive already uses its tokens directly, not `cred/*` | A yes/no; no code change |
| **agentic-mesh** | referenced (transport) | None | Documented as a blessed federation **transport profile** (P4) — a doc *about* it, no change *to* it | A mention in the profile docs |
| **git-cascade** | **none** | None | None | Zero. Reaches MAP only through openhive's mounted cascade methods; labeling those as an extension is openhive's doing, invisible here |
| **sessionlog** | **none** (by design) | None | None | Zero now, **protected by design later**: if Appendix C is ever built, MAP wiring lives in a *separate adapter* (§C.2), never added to sessionlog |

### 7.3 Blast-radius shape

| Change type | Repos | Forced? |
|---|---|---|
| Gains ownership / new work | **agent-inbox** (mail) | yes (P3) |
| Imports-only bump + optional adoption | **openhive**, **claude-code-swarm** | bump yes, adoption no |
| Code *deletion* / cleanup | **swarm-dispatch** | no (it's relief) |
| Decision only (ownership offer) | **opentasks** (tasks), **agent-iam** (cred) | no |
| Doc-only / zero | **agentic-mesh**, **git-cascade**, **sessionlog** | no |

**The external cost is concentrated in exactly one repo — agent-inbox — and that's where ownership should sit anyway.** Everywhere else it's a version bump, a code deletion, a yes/no, or nothing. That asymmetry is itself evidence the cuts are aimed right: a consolidation that forced churn across all nine repos would be reorganizing, not consolidating.

### 7.4 Contingencies

1. **Coupled-bet dependency:** openhive's *optional* "register your 41 methods as extensions" path only exists if the Phase 0 fit-test spike clears (§6.0). If descoped, openhive keeps hand-mounting — no harm, just no upgrade.
2. **Conformance fix-list:** the Phase 5 core pack is the one thing that could hand openhive a small *new* fix-list, though it already implements core since it runs `MAPServer`.

### 7.5 Standing migration mechanics

- First-party repos test against the local SDK via a `node_modules` symlink to the submodule before each publish (per the multi-repo workflow).
- Version ladder: **0.2.0** ships deprecations (both import paths live) → repos migrate at leisure → **0.3.0** removes old paths.
- Every removal is gated by a **CI grep across all first-party repos** showing zero old-path imports — no removal lands while any consumer still references it.
- Minimum one minor version of dual-path support.

## 8. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Spec churn burns goodwill with downstream (all currently first-party, but still real cost) | Med | Wire compatibility guarantee (D8); imports-only migrations; phases ship value independently |
| Mail reconciliation stalls; permanent fork | **Low** | We own agent-inbox with write access — reconciliation is an internal decision in Phase 1, not a cross-party negotiation. Dual-home fallback remains available as a sequencing convenience, not a stall hedge |
| `defineExtension()` over-abstracts and nobody uses it | **Low** (spike passed 2026-06-11) | **Phase 0 fit-test spike** decided BUILD — it emits the same `HandlerRegistry` openhive already hand-writes, so it can't be less expressive than the status quo. Door still open through Phase 2's pre-publish validation |
| Demoted extensions read as "abandoned" | Low | Staging ≠ deprecated; registry states support status; promotion path is documented and bidirectional |
| Single-maintainer graduation gate is theater (you control all "independent" consumers) | Med | Acknowledge it: the gate's value now is *discipline*, not governance; revisit if third-party consumers appear |
| Conformance suite rots | Med | Run it in MAP CI against the testing server + openhive nightly |

## 9. Decision log & remaining open items

All seven v0.1 open questions were resolved on 2026-06-11 (discussion + targeted code audit of sessionlog, claude-code-swarm, and the SDK):

| # | Question | Resolution |
|---|---|---|
| OQ1 | Trajectory: core or extension? | **Extension, recut** (D12). Evidence killed the core option: only `trajectory/checkpoint` has callers (claude-code-swarm ×2); `list`/`get`/`content` are dead spec; sessionlog keeps the data plane in git with zero MAP dependency. The thesis is carried by the **Observability profile** (D9) instead of core membership. |
| OQ2 | `src/acp/` status | **Promoted to staging extension** with a written spec — `15-acp-tunnel-extension.md` (D11). Load-bearing for openhive Threads. |
| OQ3 | `map/message` vs `map/send` | **Dissolved** — no duality: `map/send` is the participant→system request, `map/message` the system→participant delivery notification; the server accepts no inbound `map/message`. Action: directionality diagram (Phase 0, item 4). |
| OQ4 | `map/inject` with trajectory? | **Own staging extension ("steering")** — zero consumers found (the grep hits were Fastify's `app.inject()` test helper). Bundled with trajectory narratively via the Observability profile, not inside its stable surface. |
| OQ5 | Sessions in core | **Split** (D10): `sessionId` stays in the core connect envelope (live machinery in `gateway.ts`/`agent.ts`); the never-called `map/session/list·load·close` methods demote to a staging "sessions" extension. Core: 26 → 23 methods. |
| OQ6 | Registry hosting | **Manifests as machine-readable source of truth**, `registry.md` generated in CI. Published runtime JSON registry deferred; revisit trigger: first third-party extension author. |
| OQ7 | Naming | **No rebrand.** The recut spec document is titled "MAP Core 1.0" (JMAP precedent); package and repo names unchanged. |

Remaining open items:

1. **Federated trajectory retrieval** — *deferred to design-only*, captured in Appendix C (provider port, content locators, transport profiles). Not scheduled; build gate is a deployed cross-boundary topology. The current chunked-streaming spec stays staging/unexercised pending that.
2. **Canonical checkpoint schema** — reframed by the multi-provider design (Appendix C §C.4): keep the canonical wire shape **minimal and provider-neutral** (`CheckpointMeta`) so sessionlog is *one* provider rather than *the* schema; sessionlog's rich fields ride in an opaque `providerData` bag. Reverses last revision's "adopt `SessionSyncCheckpoint`" lean. Decision deferred but with this constraint fixed.
3. **acp-tunnel pre-stable items**: tunnel lifecycle events, explicit teardown, backpressure, ACP version negotiation (`15-acp-tunnel-extension.md` §8).
4. **Core-surface gap (Phase 1 finding) — RESOLVED 2026-06-11.** A default `MAPServer` registered only **19 of 23** core methods (`agents/stop`·`suspend`·`resume`, `structure/graph` absent). **Decision: implement, keep core** — reclassifying `structure/graph` out of core would gut the "transparent window" thesis, and the lifecycle trio maps onto the registry's existing state machine. Implemented `createStructureHandlers` (`ts-sdk/src/server/structure/`) serving the agent graph from the registry, and `agents/stop`·`suspend`·`resume` as thin state-transition wrappers (spec-faithful per the "lifecycle is descriptive, not prescriptive" principle — record the transition + emit; the hub enforces). All 23 core methods now register by default; conformance pack asserts it (7/7) with behavioral coverage of the new methods.

## Appendix A — Method disposition (all 58)

| Methods | Count | Disposition | Owner | Evidence |
|---|---|---|---|---|
| `map/connect`, `disconnect`, `auth/refresh` | 3 | **core** | MAP | Universal |
| `map/session/list·load·close` | 3 | **staging ext** ("sessions", D10) | MAP | Zero downstream callers; resume solved at app layer (`mail/recent` replay, ACP `loadSession`); `sessionId` itself stays in the core connect envelope |
| `map/send` | 1 | **core**, relabeled ephemeral transport | MAP | agent-inbox uses as transport only |
| `map/subscribe·unsubscribe` (+ `map/event`, `map/message` notifs) | 2 | **core** | MAP | Universal |
| `map/agents/list·get·register·spawn·unregister·update·stop·suspend·resume` | 9 | **core** | MAP | openhive registry, opentasks, sidecars |
| `map/structure/graph` | 1 | **core** (on-thesis) | MAP | — |
| `map/scopes/list·get·create·delete·join·leave·members` | 7 | **core** | MAP | Per-task/per-swarm channels (openhive), flat scope (opentasks) |
| `mail/*` | 13 | **stable ext** | **→ agent-inbox** | 2 consumers; impl leads spec |
| `trajectory/checkpoint` | 1 | **stable ext** (nucleus, D12) | MAP | claude-code-swarm reports (2 sites); openhive serves/receives; on-thesis |
| `trajectory/list·get·content` (+ `content.chunk` notif) | 3 | **staging** (within trajectory ext, D12) | MAP | Zero callers; claude-code-swarm ships custom `content.request`/`.response` instead |
| ACP tunneling (payload protocol — no methods) | 0 | **staging ext** ("acp-tunnel", D11) — spec: `15-acp-tunnel-extension.md` | MAP | openhive Threads; was undocumented SDK code (`src/acp/`, ~2.2k lines) |
| `map/tasks/*` | 4 | **staging** | → opentasks (offer) | opentasks optional-bridges; openhive rolls its own |
| `workspace/*` | 3 | **staging** | MAP | ~1 consumer |
| `cred/*` | 3 | **staging** | → agent-iam (offer) | openhive uses agent-iam directly, not cred/* |
| `map/resources/*` | 2 | **staging** | MAP | openhive only |
| `map/federation/*` | 2 | **staging** + transport profiles | MAP | 0 observed uses; 2 independent replacements exist |
| `map/inject` | 1 | **staging ext** ("steering", D9/OQ4) | MAP | Zero consumers (grep hits were Fastify's `app.inject()` test helper) |
| Identity standards matrix (DID:key/SPIFFE/DID:web) | — | **staging ext**; `persistentId` stays opaque-in-core + `IdentityVerifier` hook | MAP | openhive uses HMAC tokens |

**Resulting core: 23 methods, 2 notifications.**

## Appendix B — Evidence index

- Method/tier counts, error ranges: `schema/meta.json`
- Design thesis: `docs/00-design-specification.md` (Design Philosophy, "What MAP Is NOT")
- Mail layering intent: `docs/10-mail-protocol.md` (transport vs. persistence diagram)
- agent-inbox rationale for displacing `map/send`: `agent-inbox/docs/DESIGN.md` §7.3, §10
- agent-inbox mail divergence: `agent-inbox/src/jsonrpc/mail-server.ts` (presence, reopen vs. MAP spec)
- openhive per-task channels: `openhive/src/.../task-broadcast.ts:54` ; custom method mounting: `openhive/src/map/` (38 files)
- openhive federation bypass: `/sync/v1` JSON-RPC mesh; auth: agent-iam HMAC tokens
- opentasks optional integration: `opentasks/src/providers/map.ts`, `map-client-factory.ts`, `map-event-bridge.ts`
- swarm-dispatch friction + `x-` convention: `swarm-dispatch/src/client/methods.ts` (header comment, `LEGACY_MAP_DISPATCH_MESSAGE_METHOD`)
- SDK weight: `ts-sdk/src/types/index.ts` (4,246 lines), `src/acp/` (~2.2k lines)
- Accretion timeline: `git log` — workspace (37d8bda) → trajectory (9eac682, 23071f6) → tasks (01339f8) → mail (test suite) → persistent identity (b3f3aeb…) → resources (cbd7d0e)
- Trajectory reality: `claude-code-swarm/src/map-connection.mjs:148` and `src/sidecar-server.mjs:301` (the only `trajectory/checkpoint` callers; broadcast fallback; `resource_id` caching); `claude-code-swarm/src/scripts/map-sidecar.mjs` (custom `content.request`/`.response`); `sessionlog/src/wire-types.ts` (SessionSyncCheckpoint, zero MAP dep, "External systems (e.g., OpenHive hub) import these"); `openhive/src/swarmkit/sessionlog-repo-status.ts` (reads sessionlog git branches directly)
- Sessions evidence: `ts-sdk/src/connection/gateway.ts:129,179` and `connection/agent.ts:268,550` (`sessionId` in connect envelope); zero `map/session/*` callers in any downstream repo
- ACP tunnel: `ts-sdk/src/acp/types.ts:1103` (`ACPEnvelope`), `:1366` (`isACPEnvelope` guard); `acp/stream.ts:582` (`protocol: "acp"` + `correlationId` send metadata); `acp/adapter.ts:140-181` (stream-context tracking)

## Appendix C — Deferred design: federated trajectory retrieval & multiple providers

> **Status: DESIGN-ONLY. NOT SCHEDULED.** This appendix is captured so the design isn't lost, not because it is queued for build. It does not appear in the Phase plan (§6). The build gate is a **deployed cross-boundary federation topology that needs to pull checkpoint content** — until that exists, none of this is implemented. The near-term trajectory work (D12, Phase 3 item 5) is labeling only and does **not** depend on anything here.
>
> The point of writing it down now: it converts `trajectory/list`/`get`/`content` from "looks like dead spec" into "provisioning for a known, designed topology," which is why those methods are *staging* rather than *removal candidates*.

### C.1 Problem this solves

Within a single trust/access boundary, git is the trajectory data plane: every participant can `git fetch` sessionlog's `sessionlog/checkpoints/v1` branch and read checkpoints directly, so MAP only needs to *notify* that a checkpoint exists. Across a **federation boundary**, a consumer in System A cannot `git fetch` System B's private sessionlog repo (no network route, no credentials, possibly no shared git host). The trajectory content must then travel over the MAP link itself — which is the entire reason `trajectory/list`/`get`/`content` exist.

### C.2 Provider port (keeps sessionlog independent)

Define a provider port **owned by MAP's trajectory extension**, implemented by *adapters*, so no two components couple directly:

```
TrajectoryProvider:
  list(filter)    -> CheckpointMeta[]       // index, cheap
  get(id)         -> CheckpointMeta | null  // index, cheap
  getContent(id)  -> ReadableStream | null  // bulk, lazy
```

- The MAP server gains a `registerTrajectoryProvider(provider)` seam (absent today — `ts-sdk/src/server/trajectory/handlers.ts` resolves against a built-in store with no pluggability). `trajectory/list|get|content` become the wire projection of this port.
- **sessionlog stays a zero-MAP-dependency library.** It already satisfies the port shape: `listCheckpoints` → `list`, `getCheckpointDetail` → `get`, `getCheckpointTranscript` → `getContent`. The coupling lives in a **separate adapter** (`@sessionlog/map-provider` or glue inside openhive) that imports both sides. *sessionlog never imports MAP; MAP never imports git.* They meet only at the port.
- Multiple providers register the same way (sessionlog, a SQLite store, an in-memory test store, a hosted trajectory service). Consumers calling `trajectory/content` don't know which backend answered.

### C.3 Content locators & transport profiles

The keystone that makes "git when you can, MAP when you can't" a *consumer choice* rather than a protocol fork: the `trajectory/checkpoint` notification and `get` response carry **both** fetch paths.

```jsonc
{
  "id": "a1b2c3d4e5f6",
  "agentId": "...",
  "locators": [
    { "kind": "git", "remote": "git@host:swarm/sessionlog.git",
      "ref": "sessionlog/checkpoints/v1", "path": "a1/b2c3..." },
    { "kind": "map", "agent": "swarm-b-sidecar", "resourceId": "res_..." }
  ]
}
```

- **Direct profile** — consumer inside the boundary uses the `git` locator → fetches direct, zero hub load.
- **Mediated profile** — consumer across federation can't reach the git remote → uses the `map` locator → `trajectory/content` → `federation/route` to the owning system → its registered provider reads its own git and streams back.
- The locator choice also selects the **auth regime** (git credentials vs. MAP federation auth / the cred extension), keeping that concern out of core.

### C.4 Canonical schema must be minimal (multi-provider constraint)

If there is to be more than one provider, the canonical *wire* schema cannot be sessionlog's rich `SessionSyncCheckpoint` — that would force every provider to conform to one provider's shape. Instead:

- MAP's trajectory extension owns a **minimal, provider-neutral `CheckpointMeta`**: `{ id, agentId, timestamp, label?, locators[], providerData? }`.
- sessionlog's richer fields (`filesTouched`, `tokenUsage`, `planEntries`, `skillsUsed`, …) ride in the opaque `providerData` bag — fully usable by consumers that understand sessionlog, ignored by those that don't.

This **reverses** the earlier "adopt `SessionSyncCheckpoint` as canonical" lean; the multi-provider goal makes minimal-canonical the correct call.

### C.5 If/when this is built

Validation criteria, in order: (a) the `registerTrajectoryProvider` seam lands in the SDK; (b) sessionlog is wired behind it via an external adapter with **no new sessionlog→MAP dependency**; (c) a federated topology actually pulls content across a boundary using the `map` locator. Do not build the federation-pull machinery before a second MAP system exists to exercise it — spec on demand, not ahead of it.
