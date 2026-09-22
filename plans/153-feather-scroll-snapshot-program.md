# Plan 153: Feather Scroll Snapshot Program

> This is a **convergence plan**, not a tweak plan. It is complete only when active scroll is governed by one authoritative visual-snapshot pipeline, the old scroll-time semantic wake-up paths are reduced to compatibility edges or deleted, and correctness, polish, and perceptual smoothness are measured together. More hot-path branching without architectural deletion is failure.
>
> **Reconciled by Plan 160 (2026-07-27):** Do not restore the removed Cartesian snapshot-prewarm sweeps or treat hidden warm DOM as snapshot authority. Plan 159's current snapshot/impostor and motion/fidelity contracts are the baseline. Any new prewarm work must consume Plan 160's bounded ownership gauges and retain its documented cache and queue caps.

## Mission

Make Wit Grid feel like feather-light paper under trackpad scroll:

- 60 FPS-class glide in the dominant path
- no blank cells
- no stale values waking late
- no decoration loss
- no pinned-lane jitter
- no “interaction wakes it up” correctness leaks

The goal is not to be “as fast as AG Grid.” The goal is to feel calmer, lighter, and more polished than AG Grid under real enterprise feature load.

## Why this changes the project

We have already extracted substantial local wins from slot reuse, targeted invalidation, deferred portal work, and topology ownership. That work was necessary, but it has hit diminishing returns because the core scroll loop still wakes too much live semantics:

- row-model reads
- value/getter resolution
- style/decor/integrity recomputation
- portal identity and wake-up choreography
- hidden warm-state preservation rules

That is enough to produce numbers, but not enough to produce the “weightless paper” feel. The next leap is architectural: scrolling must consume prepared display snapshots instead of consulting live systems on the critical gesture path.

## Status

- **Priority**: P0 — flagship differentiator
- **Effort**: XL
- **Risk**: HIGH — renderer core, memory profile, composition behavior
- **Depends on**: Plans 091, 099, 111, 118, 119, 126, 144, 160
- **Category**: rendering, performance, scroll, architecture, polish
- **Planned at**: 2026-06-29

## Current state to replace

Phase A progress note:
The feather-scroll perceptual contract is now explicitly defined in `docs/architecture/plan-153-feather-scroll-contract.md`, and executable scenario evidence lives in `packages/core/src/renderer/serverRuntimePerformance.test.ts`. The portal-heavy visible blanking characterization and the integrity-heavy visible decoration-loss characterization are now both closed in automated coverage. That means the contract-definition phase is established and measurable, and the remaining work is architectural convergence around snapshot authority, motion/fidelity separation, impostors, and deterministic fidelity upgrades rather than unresolved baseline-characterization debt.

Phase B progress note:
The cell display snapshot has been upgraded from a flat `className + text` cache into a canonical payload with explicit base/state/decoration class segments, canonical tokenization, and an explicit `contentKind`. Full-bind paints, prewarm snapshot production, and loading-row binds now all write through that shared snapshot builder. Snapshot freshness now includes `insightVersion`, `styleVersion`, `loadingVersion`, and `selectionVersion`, and prewarmed snapshots now carry focused/selected/read-only/style-rule/tooltip state when those visuals matter for horizontal or vertical re-entry. The approach-band prewarm path is also now budgeted in priority order, but it has materially converged: display-value priming for formula/valueGetter cells now mints the authoritative snapshot immediately in that same pass, both for plain primitive cells and for richer primitive cells that also need integrity/style/read-only/tooltip state, and the former fallback plain-primitive snapshot sweep has been folded into the richer snapshot pass with freshness guards instead of remaining a separate full approach-band scan. Visible primitive scroll binds no longer consult cached display values live when no snapshot exists; they now follow `fresh snapshot -> warm coherent visible fallback -> explicit dirty placeholder`, which removes another direct semantic read from the hot path and makes snapshot authority the normal route for newly visible primitive cells. More importantly, the scroll path no longer promotes hidden warm DOM state into canonical truth: insight-heavy primitive cells without a fresh snapshot are marked dirty instead of synthesizing new decoration snapshots during scroll, visible portal freeze now requires a fresh portal snapshot plus a non-empty live host, and offscreen buffered cells preserve portal/text state only when an authoritative snapshot already exists. Buffered primitive or portal DOM memory is no longer snapshotted opportunistically during scroll just to keep a slot looking warm. Portal snapshot authority is stricter too: a portal snapshot is only allowed to freeze the cell when the slot still has a real live host subtree, which closes the blank-cell failure mode where horizontally buffered or pinned custom cells could preserve `portal` mode after their host had already gone empty. Cell slots now also track the exact visual versions they last rendered, which makes visibility-boundary refresh more honest: the runtime can distinguish truly fresh warm visuals from merely same-row same-column reuse, and warm visible cells are no longer marked dirty after scroll just because insight or style churn exists elsewhere in the grid. That mounted-version contract is now centralized in shared `cellSlot` helpers rather than open-coded separately in the binder and lane logic, and the full mounted-freshness predicate now lives there too so row/global identity freshness and visual-version freshness cannot silently diverge between scroll binder and visibility-boundary logic. Phase B is complete under the current architecture: active scroll consumes authoritative snapshots, while any remaining warm-state compatibility edge is confined to already-visible primitive continuity rather than hidden DOM truth.

Phase C progress note:
The post-scroll repair path is now explicitly split into a motion lane and a fidelity lane. Primitive and loading-shell repairs drain through the motion budget first, while custom-renderer / portal / other richer dirty cells are left in the queue and drained afterward through a separate fidelity budget instead of sharing the same generic decoration chunk. Phase C has also now taken its first real bite out of active-scroll rich work: `custom-live` cells can consume fallback/impostor snapshots during scroll instead of forcing an immediate live portal mount when a fresh snapshot already exists, and full-bind / prewarm snapshot writers now tag those motion-safe fallbacks explicitly as `impostor` content rather than plain primitive text. The approach-band prewarm ring now also includes `custom-live` columns even when they are not formula- or valueGetter-driven, which closes the horizontal wake-up hole where offscreen rich cells could remain blank until a later vertical scroll or direct interaction. Fidelity-lane starvation is now closed: when the motion pass exhausts, the first fidelity batch runs in the same idle slice rather than scheduling a separate idle callback, eliminating the one-idle-gap where visible rich cells could remain as impostors after motion completes. Pinned-lane impostor parity is now proven by dedicated tests: pinned-left and pinned-right `custom-live` columns follow exactly the same impostor path as center columns, with no lane-dependent branching in the scroll binder. The approach-band prewarm ring is also now a true ring: in addition to the horizontal band (visible rows × approach columns) and vertical band (approach rows × visible columns), diagonal corner cells (approach rows × approach columns) are now prewarmed, so diagonal trackpad scroll no longer arrives at cold snapshots. Live `mountCellImmediately` calls during scroll are now eliminated for all `custom-live` cells that lack existing live portal content: when a `custom-live` cell enters the viewport with no frozen portal and no prewarm snapshot, the scroll frame synthesizes a cheap text impostor (from the display value cache or the last warm text) instead of mounting the portal synchronously. Cells that already have live content in their portal host still freeze in place; all others are deferred to the post-scroll fidelity lane. Widening impostors to the broader deferred `custom` lane is still intentionally not done because it regressed a server perf contract in prior exploration.

## Reconciliation record (2026-07-28)

Plan 160's bounded working-set rules are authoritative. The remaining implementation work was deliberately limited to proven gaps; no hybrid/canvas Phase G spike is justified because the DOM motion contracts continue to pass.

| Requirement                                        | Current evidence and disposition                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase A perceptual contract and scenario matrix    | Complete before this execution in `docs/architecture/plan-153-feather-scroll-contract.md` and `serverRuntimePerformance.test.ts`.                                                                                                                                                |
| Canonical snapshot authority / no hidden-DOM truth | Complete before this execution; `cellDisplaySnapshot.ts`, `rowCellBinder.ts`, `scrollCellPresentation.ts`, and their focused tests enforce freshness and identity.                                                                                                               |
| Directional prewarm-on-approach                    | Completed here: `renderScrollCoordinator.ts` now uses one freshness-gated, bounded directional ring traversal, including diagonal corners. The redundant fallback sweep was removed.                                                                                             |
| Snapshot/prewarm cache ownership                   | Completed here: `CellDisplaySnapshotStore` is FIFO-bounded to 1,024 entries; scroll reads do not mutate recency; deterministic 10,000-cell plateau evidence is in `longSessionResilience.test.ts`.                                                                               |
| Expensive-cell impostors                           | Complete within reviewed contracts: snapshot-capable custom renderers use text/HTML impostors; an explicit live presentation remains an intentional opt-in. Cold DOM renderer cells use a non-mounting shell, never a gesture-time mount.                                        |
| Fidelity repair fairness and epoch safety          | Completed here: motion/fidelity budgets remain separate; repairs are sorted by urgency then physical identity; idle callbacks carry both a generation and scroll epoch and cannot run after cancellation/new scroll.                                                             |
| Mandatory demolition                               | The duplicate prewarm path is deleted; no visible cell relies on later repair for its initial snapshot/impostor coherence; hidden portal reuse stays identity/freshness-gated; active-scroll semantic-read and mount counters are covered by `serverRuntimePerformance.test.ts`. |
| Optional hybrid surface                            | Not started. The deterministic DOM evidence does not meet Phase G's trigger condition.                                                                                                                                                                                           |

The completion record below is valid only after the focused, full-core, React, build, package, and long-session gates recorded in this plan's final verification entry pass.

### Final verification (2026-07-28)

All gates passed against the reconciled implementation:

- Focused snapshot, prewarm, impostor, epoch, fairness, server-performance, and long-session coverage: 103 tests across 6 core files.
- Core typecheck and build; formatting; lint; full core suite: 117 files / 1,948 tests.
- Architecture: 316 core tests plus 5 React boundary tests. Adversarial: 20 core plus 8 React tests.
- API and package-consumer checks passed.
- Complete React suite: 7 files / 99 tests.
- `bench:long-session`: 5 core resilience tests plus 8 React portal ownership tests.
- Workspace package and demo build passed.

**Status: DONE.** The optional hybrid-surface spike remains intentionally unstarted: no deterministic DOM evidence met its trigger condition.

Wit Grid already has:

- stable slot ownership
- topology-aware row/cell reuse
- deferred post-scroll repair
- targeted invalidation and version stamps
- measured hot-path budgets

But active scroll is still partially semantic:

- horizontally or vertically newly visible cells can still depend on binder wake-up
- buffered hidden cells can retain stale visual identity from prior rows or columns
- rich cells and integrity decorators still influence scroll-time policy too directly
- correctness and perceptual smoothness are still too entangled

This creates exactly the failure modes that destroy enterprise polish:

- blanks
- stale content
- decoration dropouts
- pinned-lane inconsistency
- delayed wake-up only after click or later scroll

## Target end state

Scrolling becomes a **camera move over a precomputed visual scene**, not a semantic render event.

The authoritative runtime becomes a two-layer model:

1. **Scroll snapshot layer**
    - cheap, display-ready visual state per visible/prewarmed cell
    - consumable without row-model, integrity, or style-system queries during active scroll
    - authoritative for active scroll presentation

2. **Interactive fidelity layer**
    - editors, portals, full decorators, tooltips, tree affordances, rich live renderers
    - reconciled after scroll or on direct interaction/focus/edit
    - never required just to avoid blanks during scroll

The user-visible result should be:

- scroll frames are geometry-driven and compositor-friendly
- visible cells reveal immediately with coherent content
- richer fidelity settles without popping in the foveal area
- decorations remain visually coherent through motion
- pinned lanes, body lanes, and active overlays feel like one surface

## Non-negotiable invariants

- No blank visible cells during or after scroll.
- No stale cell text or renderer content from a previous row/column identity.
- No validation, diff, conflict, or quality decoration disappearing permanently due to motion.
- No pinned-column behavior diverging from center-lane behavior.
- Active scroll must not depend on direct row-model/value-getter/style-rule/integrity reads except for tightly reviewed edge cases.
- Gesture smoothness must improve without introducing delayed pop-in, shimmer, or class jitter in the viewport center.
- Any trick used for motion must preserve enterprise trust: correctness first, then polish, then peak speed.

## Mandatory demolition

This plan is not done until these are removed, demoted, or isolated behind explicit compatibility shells:

- Scroll-time binder branches that preserve warm content by consulting stale DOM-side state rather than authoritative snapshots.
- “Newly visible” correctness relying on `post-scroll` repair as the first time a user-visible cell becomes coherent.
- Hidden-cell portal/text preservation rules that can carry prior-row or prior-column identity into new bindings.
- Scroll-path decisions based on live integrity/style systems when a display snapshot could answer the question.
- Performance assumptions that measure only binder counts and ignore visual corruption, wake lag, or jitter.

## Architectural strategy

### Phase A — Define the perceptual contract

Establish a benchmark and review language for “feather scroll”:

- zero blank visible cells
- zero wrong-value visible cells
- zero permanent decoration loss
- low style churn in the viewport center
- bounded wake-up latency for rich fidelity outside the gesture-critical path
- stable pinned/center lane coherence

Add scenario evidence for:

- vertical-only scroll
- horizontal-only scroll
- mixed diagonal trackpad scroll
- wide-grid buffered reveal
- integrity-heavy grids
- custom-renderer-heavy grids
- server-backed grids with loading churn

### Phase B — Introduce the canonical cell display snapshot

Create an authoritative per-cell snapshot model designed for scroll consumption.

Minimum snapshot payload:

- row identity / column identity
- display text or primitive display token
- content kind (`text`, `empty`, `loading`, `impostor`, `portal-live`, `portal-frozen`)
- base class token set
- decoration token set
- selection/focus/read-only token subset
- freshness/version stamp

Rules:

- snapshots are updated by invalidation and targeted writes, not by scroll
- scroll path consumes snapshots without waking feature subsystems
- hidden warm DOM state is no longer a truth source

### Phase C — Split the renderer into motion and fidelity lanes

Active scroll should render through a motion-safe layer:

- primitive text
- stable pills/badges/impostors
- loading shells
- minimal decoration overlays

Richer features move to a fidelity lane:

- editors
- complex React portals
- fully interactive custom renderers
- non-critical tooltip/controller behavior
- expensive tree/detail affordances

The fidelity lane may lag behind motion, but the motion lane must already be visually correct enough that the user never sees blanks or nonsense.

### Phase D — Replace wake-up-on-visibility with prewarm-on-approach

Newly visible columns/rows should not “wake up” from scratch.

Instead:

- maintain a prewarm ring around the viewport
- populate snapshots ahead of reveal
- treat viewport entry as a cheap bind of already-prepared visual state
- reserve post-scroll work for fidelity upgrades, not first correctness

This is where horizontal reveal quality is won or lost.

### Phase E — Add impostor mode for expensive cells

For complex renderers, scrolling should use an impostor contract:

- snapshot text or condensed badge
- static tree glyph / summary chip / measured thumbnail if needed
- zero heavy React wake-up during gesture

Only focused, edited, hovered, or settled cells must pay for full interactivity.

### Phase F — Unify repair, overlays, and decoration reconciliation

Post-scroll work must become a reviewed, budgeted fidelity-upgrade pipeline:

- portal wake budget
- decoration upgrade budget
- style-class reconcile budget
- offscreen cleanup budget

This queue must be:

- epoch-safe
- deterministic
- lane-consistent
- incapable of leaving visible cells half-upgraded indefinitely

### Phase G — Optional hybrid surface spike

If DOM-only motion still cannot reach the target feel for dense primitive grids, run a bounded spike for a hybrid body layer:

- canvas or atlas-like primitive body layer
- DOM for active cell, selection, editors, overlays, pinned chrome

This is optional and must be gated by evidence. Do not jump to canvas before the snapshot split exists, because otherwise we will only move the same semantic churn behind a different renderer.

## Workstreams

### Workstream 1 — Scroll snapshot authority

- define snapshot data structure and ownership
- define snapshot invalidation/update routes
- expose narrow runtime interfaces for snapshot reads
- prove snapshot coverage across primitive, loading, selection, and integrity cases

### Workstream 2 — Motion-layer renderer

- make active scroll consume snapshot payloads only
- keep geometry writes minimal and compositor-friendly
- stop reading DOM/portal state as scroll truth
- preserve pinned-lane parity

### Workstream 3 — Fidelity upgrade scheduler

- classify upgrades by urgency
- enforce per-frame/post-scroll budgets
- prevent starvation for visible rich cells
- prove no visible correctness debt persists after scroll settle

### Workstream 4 — Rich-cell impostor system

- define impostor contract for custom renderers
- add default impostors for pills/badges/tree-like cells
- allow opt-in richer live behavior only when it stays within budget
- validate no perceptual flicker at the viewport center

### Workstream 5 — Correctness + polish evidence

- add adversarial tests for blanking, stale wake-up, and decoration loss
- add trace scenarios for visible-boundary entry and diagonal scroll
- record motion/fidelity metrics separately
- add review rubric for “feels lighter” and “feels calmer” scenarios next to raw counters

## Sequencing rules

1. Do not add more one-off warm-state heuristics before the snapshot authority exists.
2. Do not route new feature systems directly into active scroll-time binder logic.
3. Do not call the problem solved by hiding pop-in behind later idle repair if a visible cell was ever blank or wrong.
4. Do not start the hybrid rendering spike until snapshot consumption and motion/fidelity separation are measurable and stable.
5. If a phase improves metrics but worsens visual polish, stop and resolve the polish regression before proceeding.

## Forbidden end state

- A “fast” scroll path that still blanks cells or loses decorations.
- Rich cells that reveal stale content from previous identities.
- Separate pinned-lane behavior with different wake-up semantics than center lanes.
- Large new caches with no eviction/freshness discipline.
- Benchmark wins that depend on suppressing enterprise features.
- A second semantic rendering path living beside the snapshot path long-term.

## Verification program

### Correctness gates

- no blank visible cells during adversarial horizontal/vertical/mixed scroll scenarios
- no stale text/portal identity after violent row/column recycling
- integrity decorations restore deterministically through motion
- focus/edit/selection remain coherent while fidelity upgrades occur

### Motion gates

- scroll-frame work remains geometry-dominant
- low variance in frame cost across long scroll runs
- no visible class jitter in pinned or center lanes
- no sync portal flushes during active scroll

### Long-session gates

- prewarm and snapshot caches do not leak across prolonged use
- fidelity-upgrade queues do not accumulate indefinitely
- repeated scroll/edit/filter/integrity sessions keep the same feel after long uptime

## Evidence required in the PRs for this program

- before/after scenario traces for vertical, horizontal, and mixed scroll
- correctness recordings for previous blanking/wake-up regressions
- explicit statement of which live systems were removed from active scroll
- memory impact of snapshots/prewarm rings
- measured tradeoff notes for any impostor downgrade behavior

## Completion gate

This program is complete when:

- active scroll consumes authoritative visual snapshots instead of live semantic systems
- viewport entry never depends on later repair just to become coherent
- rich fidelity upgrades are budgeted and deterministic
- the grid subjectively feels lighter and calmer in demo and adversarial scenarios
- the known classes of blanking, stale wake-up, and decoration loss are closed by tests
- Wit Grid has a defensible perceptual advantage story, not just a benchmark story

## STOP conditions

- Stop if a proposed optimization introduces another long-lived scroll/render dual path.
- Stop if the plan improves hot-path counters but still produces blank or stale visible cells.
- Stop if impostor rendering degrades enterprise trust more than it improves motion.
- Stop if snapshot ownership becomes ambiguous between renderer, row model, and feature systems.
- Stop if memory growth from prewarm/snapshot caches is not explicitly bounded and tested.
