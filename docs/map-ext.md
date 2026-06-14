# MAP Extensions (MAP-EXT)

| | |
|---|---|
| **Status** | Draft v0.1 (Phase 0 Track B artifact — pins the format Phase 1 applies) |
| **Defines** | How any capability outside the MAP machinery core is named, versioned, negotiated, errored, and graduated |
| **Consumes** | `schema/meta.json` stability labels (Phase 0 Track A) |
| **Consumed by** | The schema split (Phase 1), the SDK extension API (`docs/sdk-extension-api.md`), the fit-test spike (Phase 0 Track C) |

This is the one-page contract behind D2/D3/D4/D9/D11 of the [consolidation plan](./14-consolidation-plan.md). The core protocol standardizes the *machinery*; an extension standardizes a *domain* on top of that machinery. The goal is that adding a domain never requires editing the core schema — the most-validated thing in the ecosystem is that consumers mount their own methods (openhive mounts 41), so this makes the implicit contract explicit.

## 1. What an extension is

An extension is a named, versioned bundle of protocol surface that an implementation advertises and a peer may use. It comes in two forms:

- **Method-prefix extension** — adds JSON-RPC methods under a namespace (`mail/*`, `trajectory/*`, `tasks/*`). The common case.
- **Payload-protocol extension** — adds *no* methods; it rides core `map/send` with a payload discriminator (`acp-tunnel`, which sets `protocol: "acp"` and carries an `ACPEnvelope`). The exception, but a first-class one.

Both are described by the same manifest (§3); a payload-protocol extension sets `payloadProtocol` instead of `methodPrefix`.

## 2. The six things every extension declares

| Field | Rule |
|---|---|
| **Name** | kebab-case, unique in the registry (`mail`, `acp-tunnel`). |
| **Capability URI** | `urn:map:ext:<name>:<major>` (e.g. `urn:map:ext:mail:1`). Advertised in `ConnectResponse.capabilities.extensions`. Major version in the URI; minor/patch in the manifest. |
| **Namespace** | a `methodPrefix` **or** a `payloadProtocol` string **or** `"capability-only"` (for hook/flag extensions like `identity` — no wire methods). Exactly one. Method-family prefixes end with `/`; a single-method extension (`steering` → `map/inject`) uses the full method name as its prefix. Experimental work uses the `x-` prefix and is never advertised as a `urn:map:ext:` URI. |
| **Error range** | a contiguous block from the registry table (§4). Experimental extensions use ≥ 90000. |
| **Events** | event types this extension emits, named per §5. Routed through core scopes/subscriptions — extensions do not invent their own event transport. |
| **Stability** | `experimental` \| `staging` \| `stable` (§6). |
| **Owner** | the repo that is the source of truth for this extension's schema. May be a repo *other than* MAP core (e.g. mail → agent-inbox). |

## 3. Manifest format

One `manifest.json` per extension, at `schema/ext/<name>/manifest.json` (or in the owning repo, with a registry pointer). This is the machine-readable form the SDK codegen and the registry consume.

```jsonc
// schema/ext/trajectory/manifest.json — method-prefix example
{
  "name": "trajectory",
  "uri": "urn:map:ext:trajectory:1",
  "version": "1.0.0",
  "stability": "stable",
  "owner": "multi-agent-protocol",
  "methodPrefix": "trajectory/",
  "errorRange": [13000, 13999],
  "methods": ["trajectory/checkpoint", "trajectory/list", "trajectory/get", "trajectory/content"],
  "events": ["trajectory.checkpoint.created"],
  "notifications": ["trajectory/content.chunk"],
  "schema": "./schema.json",
  "capabilityFlags": { "canReport": true, "canQuery": true, "canRequestContent": true, "canServeContent": true }
}
```

```jsonc
// schema/ext/acp-tunnel/manifest.json — payload-protocol example (no methods)
{
  "name": "acp-tunnel",
  "uri": "urn:map:ext:acp-tunnel:1",
  "version": "1.0.0",
  "stability": "staging",
  "owner": "multi-agent-protocol",
  "payloadProtocol": "acp",          // rides map/send; discriminator in message metadata
  "errorRange": null,                 // ACP errors travel in-band (see 15-acp-tunnel-extension.md)
  "methods": [],
  "events": [],
  "schema": "./schema.json"
}
```

**Round-trip form.** In the split repo layout, a method-prefix manifest embeds its methods' full metadata (the `meta.json` entries — `tier`, `stability`, `callableBy`, `capabilities`, `description`, request/response types), not just method names, so `scripts/build-meta.mjs` can reconstruct a merged `schema/meta.json` byte-equivalent (modulo key ordering) to the pre-split file. `methods` is then a name→metadata map; the array form in the example above is the human-facing summary. Notifications and the extension's `errorCodes` group travel in the manifest the same way.

**Message schemas** live alongside the manifest as `schema/ext/<name>/schema.json` — a `$defs` fragment holding that extension's request/response/notification JSON Schemas (routed out of `schema/schema.json` by their `x-method` annotation). `scripts/build-schema.mjs` merges core (`schema/core/schema.json`) + all fragments back into a `schema/schema.json` byte-equivalent to the pre-split file. The aggregate unions (`MAPRequest`/`MAPResponse`/`MAPNotification`) and structural defs stay in core; only leaf extension message defs are relocated. `npm run validate:schema` enforces both round-trips (meta + schema) and the README counts in CI.

**Invariants** (CI-checkable, enforced by `scripts/build-meta.mjs --check`):
- Exactly one of `methodPrefix`, `payloadProtocol`, or `"capability-only"`.
- Every method key starts with `methodPrefix`.
- `errorRange` is disjoint from every other extension's range (§4), or `null` for payload-protocol / capability-only extensions.
- Merge of core + all manifests is byte-equivalent (modulo ordering) to the committed `schema/meta.json`.
- Core schema never `$ref`s an extension schema (dependency points one way: ext → core only).

## 4. Error-range registry

A **table, not an allocator tool** (tooling is deferred until a third-party needs a range — consolidation plan §6.0). Ranges are 1000 wide. Allocated today:

| Range | Extension | Notes |
|---|---|---|
| 10000–10999 | mail | already in use (10000–10010) |
| 11000–11999 | credentials | |
| 12000–12999 | workspace | |
| 13000–13999 | trajectory | |
| 14000–14999 | tasks | |
| 15000–15999 | resources | *(reserve; resources currently reuses generic codes)* |
| 16000–16999 | sessions | *(reserve, D10)* |
| 5000–5999 | federation | pre-existing (core-adjacent; stays as-is) |
| ≥ 90000 | experimental (`x-`) | not advertised; collisions tolerated |

New stable/staging extension → claim the next free 1000 block by editing this table in a registry PR.

## 5. Event-type naming

Grammar: `<extension>.<noun>.<verb-past>` — e.g. `mail.turn.created`, `trajectory.checkpoint.created`, `acp.stream.opened`. Lowercase, dot-separated. Events flow through core `map/subscribe` and scopes; an extension MUST NOT build a side-channel. This keeps the "transparent window" thesis intact — every extension's activity is observable through the same subscription surface as core.

## 6. Stability ladder & graduation gate

| Tier | Prefix/URI | Requirements | Advertised as MAP? |
|---|---|---|---|
| **experimental** | `x-` prefix, errors ≥ 90000 | none — anyone, no review | no |
| **staging** | namespaced, registered URI, schema in repo | written spec + **1 real consumer** | yes, as staging |
| **stable** | version-locked URI | **≥ 2 independent consumers** + conformance pack + 1 release cycle with no breaking change | yes, as stable |

Promotion is a registry PR using the [**graduation checklist**](./graduation-checklist.md) (which also records the current applied ladder positions). Demotion is symmetric: a stable extension that loses its second consumer can return to staging. The gate's present value is **discipline**, not governance (single maintainer today — consolidation plan §8); it becomes real governance when third parties appear.

Retroactive application (from the audit): **mail**, **trajectory/checkpoint** → stable; everything else → staging. See [registry.md](./registry.md).

## 7. Profiles

A **profile** is a named, versioned bundle of core + specific extensions for a use case. Profiles are conformance + marketing surface, not wire features — a server advertises a profile by advertising its constituent capabilities.

- **MAP Core** — the 23-method machinery core alone. The minimum conformant implementation.
- **MAP Observability** — Core + `trajectory` + `steering` (`map/inject`). The "transparent window" thesis, complete.

Profiles are defined here and enumerated in the registry. Authoring a *catalog* of profiles or enforcing them in code is deferred (consolidation plan §6.0) — define the concept and name these two now.

## 8. How an extension is mounted (SDK binding)

This format is designed against the real SDK seam, not in the abstract. A MAP server mounts extension methods via `MAPServerOptions.additionalHandlers` (a `HandlerRegistry = Record<string, (params, ctx) => Promise<unknown>>`) and advertises capability via `MAPServerOptions.capabilities`. The SDK's `defineExtension()` (see `docs/sdk-extension-api.md`) turns a manifest + handler implementations into exactly that pair — so an extension author writes handlers that close over their own hub context (openhive's pattern) and the framework produces the `additionalHandlers` map and the capability fragment. The Phase 0 Track C spike validates that this binding requires no bypass.

## 9. Open items

- ~~Capability-only variant~~ — **resolved (Phase 1):** the namespace is now one of three (`methodPrefix` | `payloadProtocol` | `"capability-only"`), §2/§3 updated. `identity` uses `"capability-only"`.
- Whether `version` (full semver) in the manifest should drive anything beyond the registry, or stays informational until runtime negotiation exists.
- Runtime JSON registry (machine-consumable at connect time) — deferred until a third-party implementer exists (consolidation plan OQ6).
