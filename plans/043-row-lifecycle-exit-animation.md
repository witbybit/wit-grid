# Plan 043: Row lifecycle animation — slot exit pool + detail-row height

> **Executor instructions**: This completes Plan 039 Phase 3. It is hot-path-adjacent (touches the slot pool + portal release) — keep all exit work behind the discrete-change transition gate; never retain or animate slots on a scroll/data-tick frame. Build on the existing WAAPI `LayoutTransitionController`; do not introduce a second animation mechanism.
>
> Part of Plan 040 (north-star).

## Status

- **Priority**: P2 (animation polish; completes expand/collapse)
- **Effort**: M
- **Risk**: MEDIUM–HIGH (slot pool + full-width portal lifecycle)
- **Depends on**: Plan 039 Phase 2 (`LayoutTransitionController` move+enter), Phase 3 (expand/collapse arming)
- **Category**: rendering, animation
- **Planned at**: 2026-06-14
- **Status**: **DONE (2026-06-14, branch rendering-architecture-v2-wip-3)**. Phases 1–2 landed as below; Phase 3 (detail height) landed in Plan 045 and 043 was reconciled to DONE — see "Phase 3 reconciliation" below. core 590/590, react 70/70, demo build clean.
    - **Approach chosen — clone-ghost (not a slot-pool exit lane).** Touching the slot recycle path was avoided entirely. At `captureSnapshot` the controller deep-clones each visible row (cheap, discrete-action only); at `beginAnimation` it fades out (WAAPI opacity 1→0) the clones of rows that left, into a dedicated `.og-layer-exiting` overlay. This sidesteps the Phase-2 STOP risk: full-width/portal rows fade as static ghosts too, with no portal-manager changes.
    - **True-exit gate**: a captured row ghosts only if it's no longer rendered AND no longer in the model (`isRowIdLive` → `RowModel.getVisualIndexById(visualRowId) >= 0`). Rows that merely scrolled out of the window are not faded. Pagination/sort don't trigger exits (capture is wired to sort+expansion; collapse is the producer).
    - **Files**: `layoutTransitionController.ts` (clone snapshot + `playExits` + ghost teardown in `cancel`), `LayoutTransitionOptions` ({getExitLayer, isRowIdLive}); `layerRegistry.ts` (`exiting` static overlay layer, child of `rows`); `styles.ts` (`.og-layer-exiting`); `renderEngine.ts` wires the options. Guard test updated for the static overlay.
    - **Hot-path**: ghosts only exist during a discrete fade; `cancel()` (scroll start) removes them all — none survive a scroll frame. Stable-slot DOM invariant preserved (the overlay is a non-slot sibling; tests count slot children via `slotDomCount`).
    - Tests: 4 exit cases in `layoutTransitionController.test.ts` (fade on true exit; no fade on scroll-out; cancel removes ghosts; no-op without exit layer).
    - **Deferred — Phase 3**: detail-row/group height grow/shrink animation (needs an inner content wrapper). Separate, lower-priority polish.

## Expand/collapse animation FIX (2026-06-14) — was silently broken

A follow-up review found group/tree/master-detail expand-collapse **did not animate at
all** (only sort did), despite the move/enter/exit/detail-height machinery being present.
Root cause: `beginAnimation()` was only called inside `fullPaintInternal`. Sort uses
`invalidateFull` (→ full-paint path → fires), but expand/collapse use
`invalidateViewport('group expansion'|'detail')` (GroupingFeatureController) → the
orchestrator routes a non-full frame to `syncViewport`, which repositioned rows but
never called `beginAnimation`. `captureSnapshot` _was_ firing (toggle → `store.setState({expansion})`
→ `subscribeToKey('expansion')`), so a snapshot existed but was never played.

Fix: `renderPaintCoordinator.flushPaint` now plays the armed transition after
`orchestrator.flush` when `pendingTransition` is still set — i.e. the viewport path.
The full-paint path consumes the flag inside `fullPaintInternal` first, so no
double-animation. Covered by `renderPaintCoordinator.test.ts` (viewport-frame fires
beginAnimation; order: flush→beginAnimation) and an end-to-end `renderEngine.test.ts`
test that toggles a real group and asserts WAAPI `animate()` is invoked. core 592/592.

## Phase 3 reconciliation (2026-06-14) — 043 closed as DONE

Phase 3's substantive goal — detail-row height grow/shrink that does not fight the
row's `translateY` positioning — was delivered by **Plan 045**:

- `LayoutTransitionController` grows an entering detail row `0 → h` (enter branch,
  `kind === 'detail'`) and shrinks an exiting detail ghost `h → 0` (`playExits`), both
  via WAAPI on `height` with `overflow: hidden`. Animating `height` (not `transform`)
  satisfies the plan's core constraint — it does not fight the `translateY` transform.
- Covered by 2 tests in `layoutTransitionController.test.ts`
  ("grows an entering detail row…", "shrinks an exiting detail row ghost…").
- Demo coverage: `demo/src/pages/NestedTablesGrouping.tsx` exercises nested/detail
  expand-collapse.

Remaining literal plan items were judged not worth pursuing:

- **Inner content wrapper** — a _suggested mechanism_, not a separate requirement. The
  shipped approach animates the row element's own `height` with `overflow: hidden`,
  which already meets the goal without fighting `transform`. Full-width rows already
  carry an inner `.og-row-portal-host` element if a dedicated clip wrapper is ever
  needed. Rewriting onto an inner wrapper would churn the MEDIUM–HIGH-risk portal-backed
  full-width path for negligible visible benefit.
- **Group height animation** — group rows are fixed-height header rows; expanding a
  group reveals child data rows that already animate via the enter/move path. There is
  no group-row height to grow/shrink, so this case does not apply.

## Problem

Expand/collapse currently animates **move** (displaced rows slide) and **enter** (revealed rows fade), but not **exit**: on collapse, the removed rows vanish instantly while the rows below slide up, because `RowSlotPool.ensureSlotCount` recycles a removed slot's DOM immediately (`renderer/rowSlotPool.ts:66-72`). Master-detail rows also pop in/out at full height instead of growing/shrinking. The transition system is half-complete.

## Target architecture

### A. Slot exit-retention lane

Generalize the slot pool so a removed-but-animating row's element persists until its exit animation finishes, then is released — without re-entering the active pool or scroll recycling.

- Add an **exit lane**: a small holding set (`renderer/rowExitLane.ts` or a field on the pool) of `{ element, lastTop, portalKey? }` captured at the moment a discrete change removes visible rows _with a transition armed_.
- The paint coordinator, when `pendingTransition` is set and the new render window drops rows that were present, moves those slots' elements into the exit lane (kept positioned at their old `translateY`), hands them to `LayoutTransitionController.beginExit(...)`, and releases them (DOM + portal) on `animation.finished` / `cancel()`.
- **Hard invariants**: exit-lane elements never re-enter the active pool; never participate in scroll recycling; are force-released on `cancel()` (scroll start) so none survive into a scroll frame. Exit lane is empty during steady-state scroll (assert in a perf characterization test).

### B. `LayoutTransitionController.beginExit`

Add an exit primitive alongside move/enter: WAAPI `opacity 1→0` (+ optional small `translateY`), `onfinish`/`oncancel` → release callback. Capture set already exists (`captureSnapshot` records pre-change rowIds+tops); the controller can compute the exit set as `snapshot rowIds − new rendered rowIds`. Feature-detected (reduced-motion/jsdom → release immediately, no animation).

### C. Detail-row (and group) height animation

Master-detail/group rows change the displayed height on toggle. Animate the **row's height**, not just opacity:

- Wrap full-width row content in an inner element so the row's outer height can animate (`0 → h` on enter, `h → 0` on exit) via WAAPI while the displaced rows below `move` in lockstep. Document this inner wrapper as the one justified extra element (per Plan 039 target architecture).
- Container total height is set to the final value instantly (scrollbar correctness); rows animate into place. The growing/shrinking detail row uses height/clip animation so it doesn't fight the `translateY` positioning.

## Execution phases

### Phase 0 — characterization

Lock current move+enter behavior; add a test asserting the exit lane is empty during scroll. Verify green.

### Phase 1 — exit lane + `beginExit` (opacity)

Add the exit-retention lane + `beginExit`; collapsed/filtered-out **data** rows fade out then release. Unit tests for the controller exit set; integration test that a collapsed group's child rows persist for the animation then are released (slot count returns to steady state).

### Phase 2 — full-width portal exit

Extend to group/detail full-width rows (portal-backed). This is the **STOP-risk** area (Plan 039 STOP #1): if the portal manager cannot keep a portal mounted on an exiting element without key collisions, ship Phase 1 (data-row exit) only and record the portal limitation.

### Phase 3 — detail/group height animation

Inner wrapper + height/clip WAAPI on enter/exit; displaced rows `move` in lockstep. Demo page exercises master-detail + nested group collapse/expand.

## Verification

```sh
corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/renderer/layoutTransitionController.test.ts src/renderer/rowSlotPool.test.ts
corepack pnpm --filter @eregister/wit-grid-core test
corepack pnpm --filter @eregister/wit-grid-react test
corepack pnpm --filter demo-app build
```

## Scope

In: `renderer/layoutTransitionController.ts`, `renderer/rowSlotPool.ts` (+ exit lane), `renderer/renderPaintCoordinator.ts`, full-width/portal release path, `styles.ts`. Out: pinning animation (044), pagination (041).

## Review checklist — reject if it:

- Retains or animates any slot on a scroll/data-tick frame.
- Lets an exit-lane element re-enter the active pool or scroll recycling.
- Skips force-release on `cancel()` (scroll start) — exiting rows must not survive into a scroll frame.
- Adds a second animation mechanism instead of extending `LayoutTransitionController`.
- Animates detail height by fighting the `translateY` transform instead of an inner wrapper.

## STOP conditions

- Full-width portal exit needs a portal-manager rewrite larger than expected → ship data-row exit (Phase 1) only, flag portal exit as follow-up.
- Height animation visibly fights pinned-column sticky inside full-width rows → animate an inner content wrapper, keep the row element's transform untouched.
