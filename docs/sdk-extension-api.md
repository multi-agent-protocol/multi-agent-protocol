# SDK Extension API (design sketch)

| | |
|---|---|
| **Status** | Draft v0.1 (Phase 0 Track B artifact — paper design to prototype against) |
| **Pairs with** | [`map-ext.md`](./map-ext.md) (the manifest format this consumes) |
| **Validated by** | Phase 0 Track C fit-test spike |
| **Implements** | D7 / D11 of the [consolidation plan](./14-consolidation-plan.md) |

This pins the SDK surface enough to run the spike and to implement Phase 2 without re-deciding the shape mid-flight. It is deliberately thin: it wraps the seams the SDK *already has* rather than inventing a parallel mechanism.

## 1. What already exists (the seams we build on)

From the current SDK (verified against `ts-sdk/src/server/server.ts`, `src/server/CLAUDE.md`, `src/connection/*.ts`):

- **Server mount seam:** `MAPServerOptions.additionalHandlers?: HandlerRegistry` where `HandlerRegistry = Record<string, (params, ctx: HandlerContext) => Promise<unknown>>`. Built-in domains (mail, agents, scopes) use the same `createXHandlers()` → handler-map pattern, composed via `combineHandlers(...)`. **This is the mount point; we do not replace it.**
- **Server capability seam:** `MAPServerOptions.capabilities?: ParticipantCapabilities`. The resources extension already advertises `capabilities.resources = { enabled, kinds }` through this.
- **Client/agent call seam:** `callExtension<TParams, TResult>(method, params)` exists on both `ClientConnection` (`client.ts:1245`) and `AgentConnection` (`agent.ts:1490`) — the untyped way to call a non-core method today.
- **Agent inbound seam (partial):** `AgentConnection` exposes `onMessage(handler)` and `onNotification(method, handler)` (server→agent notifications) and `sendNotification(method, params)`. It does **not** expose request/response handler registration for inbound *requests* — this is the swarm-dispatch friction.

## 2. `defineExtension()` — the core addition

`defineExtension(manifest, impl)` turns a MAP-EXT manifest plus handler implementations into (a) a `HandlerRegistry` for `additionalHandlers`, (b) a capability fragment for `capabilities`, and (c) a typed client accessor. It is a thin adapter over the existing seams — **not** a new runtime.

```ts
// Part 1a — typed accessors + packaging (build regardless of the fit-test)
interface ExtensionDef<M extends Manifest, Methods> {
  manifest: M;
  /** Mergeable into MAPServerOptions.additionalHandlers */
  handlers(impl: HandlerImpl<Methods>): HandlerRegistry;
  /** Mergeable into MAPServerOptions.capabilities */
  capabilityFragment(): Partial<ParticipantCapabilities>;
  /** Typed client-side accessor over callExtension */
  client(conn: ClientConnection | AgentConnection): TypedClient<Methods>;
}

function defineExtension<...>(manifest, methodTypes): ExtensionDef<...>;
```

Usage on the server — the hub closes over its own context inside the handler, so there is **no bypass**:

```ts
import { trajectoryExt } from '@multi-agent-protocol/sdk/ext/trajectory';

const ext = trajectoryExt.handlers({
  'trajectory/checkpoint': async (params, ctx) => hub.recordCheckpoint(params, ctx), // closes over hub
});

const server = new MAPServer({
  additionalHandlers: combineHandlers(ext),              // existing seam
  capabilities: { ...trajectoryExt.capabilityFragment() } // existing seam
});
```

Usage on the client — typed instead of stringly:

```ts
const traj = trajectoryExt.client(conn);
await traj.checkpoint({ label: 'step-3' });   // typed wrapper over callExtension('trajectory/checkpoint', …)
```

**1a vs 1b split (consolidation plan §6.0):**
- **1a — typed accessors + packaging:** `manifest`, `client()`, `capabilityFragment()`, and per-extension subpath packages. Pure types + thin wrappers over `callExtension`/`additionalHandlers`. Build regardless.
- **1b — `handlers()` mount framework:** the part that generates a `HandlerRegistry` from a manifest. Gated by the Track C spike. If the spike needs bypass code, ship 1a only and let hubs keep hand-writing the handler map (they already do — `additionalHandlers` stays the public seam either way).

The key property making 1b low-risk: it emits the *same* `HandlerRegistry` shape openhive already hand-writes. It can't be less expressive than the status quo because the status quo is its output type.

## 3. `AgentConnection` request-handler seam (the swarm-dispatch fix)

Add inbound request/response handling to `AgentConnection`, mirroring `onNotification` but with a return value:

```ts
// new on AgentConnection — symmetric with the existing onNotification(method, handler)
onRequest(method: string, handler: (params, ctx) => Promise<unknown>): this;
```

This lets an agent answer extension requests (what swarm-dispatch worked around). It reuses `BaseConnection`'s existing request/response correlation — the testing server already calls `connection.setRequestHandler(...)` internally (`testing/server.ts:186`), so the plumbing exists; this exposes it on `AgentConnection`'s public surface.

## 4. `capabilities.extensions` (advertise-only)

Add to `ParticipantCapabilities` / `ConnectResponseResult`:

```ts
interface ParticipantCapabilities {
  // ...existing flags (observation, messaging, lifecycle, trajectory, resources, mail, …)
  extensions?: Array<{ uri: string; version?: string }>;
}
```

Phase 1 ships **advertise-only** — servers populate it from mounted manifests; clients may read it but the SDK enforces nothing. Runtime negotiation/enforcement is deferred (consolidation plan §6.0).

## 5. Packaging

- Root `@multi-agent-protocol/sdk` — core (connection, events, registry, scopes, structure) + `defineExtension` + `combineHandlers`.
- Subpaths `@multi-agent-protocol/sdk/ext/<name>` — per-extension `ExtensionDef` + types. Tree-shakeable; a core-only consumer pulls no mail/acp/trajectory types.
- Externally-owned extensions (mail → agent-inbox) publish their own `ExtensionDef` package; the MAP registry points there.

## 6. What the spike must prove (Track C exit gate)

1. A manifest + a handler closing over a hub context produces a `HandlerRegistry` that mounts via `additionalHandlers` **with no bypass**.
2. The capability fragment merges into `capabilities` and appears in the connect response.
3. A typed client accessor round-trips a call to that method.

If all three hold → **build** (1b proceeds). If (1) needs hacks → **descope to 1a**, keep manual mounting.
