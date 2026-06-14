# Extension Graduation Checklist

Use this as the PR description when promoting (or demoting) a MAP extension on the stability ladder ([`map-ext.md`](./map-ext.md) §6). Tick every box; an unchecked box blocks the change. This is a **discipline** artifact, not governance — the single-maintainer caveat in the consolidation plan §8 stands; revisit when third-party consumers appear.

## experimental → staging
- [ ] Written spec exists (manifest + extension doc); namespace + capability URI allocated
- [ ] Error range allocated from the registry table (or `null` for payload-protocol / capability-only)
- [ ] **≥ 1 real consumer** uses it
- [ ] Registered in [`registry.md`](./registry.md) with owner + flagship implementer
- [ ] No core schema change required — registry PR only

## staging → stable
- [ ] **≥ 2 independent consumers** (one author's two repos do not count as two)
- [ ] **Conformance pack** exists, published at `@multi-agent-protocol/sdk/ext/<name>/conformance`
- [ ] Conformance passes against **≥ 2 implementations** (or 1 flagship + the SDK default)
- [ ] Contract is MAP-owned and follows MAP conventions (camelCase, `…Id` naming, allocated error range)
- [ ] **1 stable release cycle** with no breaking change
- [ ] `registry.md` stability updated to `stable`

## stable → staging (demotion, symmetric)
- [ ] A stable extension that loses its 2nd independent consumer returns to staging — this checklist in reverse.

---

## Applied (2026-06) — current ladder positions

Running the checklist against today's extensions:

| Extension | Position | Verdict |
|---|---|---|
| **mail** | **stable** ✅ | 2 implementations (SDK default + agent-inbox, both 9/9 conformance); 2 consumers (agent-inbox, openhive); MAP-owned v1.1 contract; conformance published. **Passes.** |
| **trajectory** (`checkpoint`) | **stable nucleus** | Conformance pack exists (SDK default passes); consumers: claude-code-swarm (reports) + openhive (serves/receives). Borderline on "2 *independent* implementations" — currently 1 flagship reporter + SDK default. Held at stable-nucleus; promote fully when a 2nd independent server implements it. |
| trajectory `list`/`get`/`content` | **staging** | 0 consumers (federation-gated, Appendix C). Stays staging. |
| acp-tunnel | **staging** | 1 consumer (openhive Threads). Stays staging until a 2nd. |
| sessions, tasks, workspace, resources, cred, federation, steering, identity | **staging** | ≤ 1 consumer each; no conformance pack. Stay staging. tasks/cred have flagships (opentasks/agent-iam) but not a 2nd independent consumer. |

**Net:** one extension (mail) is genuinely stable by the bar; trajectory-checkpoint is the next closest. Everything else correctly sits at staging — the ladder isn't being gamed, which is the point.
