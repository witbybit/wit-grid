# Plan 044: Semantic column pinning effect

> **Executor instructions**: Pin/unpin is a discrete layout change. The real grid layout
> must commit instantly from the existing pin geometry (`columns.lanes`); animation may
> only decorate the committed state. Do not hide real cells, clone cells, capture DOM
> rects, or run per-cell FLIP logic.
>
> Part of Plan 040 (north-star).

## Status

- **Priority**: P2 (polish; correctness owned by Plans 039/050)
- **Effort**: S-M
- **Risk**: LOW-MEDIUM (CSS effect on a discrete pin frame)
- **Depends on**: Plan 050 rendering/layout hardening
- **Category**: rendering, animation
- **Planned at**: 2026-06-14
- **Status**: IMPLEMENTED 2026-06-14 - replaced the earlier clone-and-swap FLIP with a subtle semantic pin effect.

## Decision

The original clone-and-swap column pinning animation was removed. It was too complex for
the value it provided and fought the recycler/sticky layout model:

- It cloned visible cells and hid the real cells during animation.
- It depended on DOM rect capture across a reparenting layout change.
- It introduced failure modes where real cells could remain hidden or visually overlap.

The replacement is intentionally simpler and more organic:

1. Pinning updates the real column layout immediately through the normal geometry,
   viewport, and header invalidation path.
2. After the committed pin frame paints, `LayoutTransitionController.playColumnPinEffect()`
   briefly adds `og-pin-transition` to the grid root.
3. CSS applies a short themed settle/highlight to pinned lanes, pinned cells, and pinned
   headers using existing selection/focus theme tokens.
4. Scroll start / cancel / destroy removes the transient class.

## Architecture

- `RenderInvalidationCoordinator` treats `pinnedColumns` as geometry + viewport + header
  invalidation. It does not snapshot cells.
- `RenderPaintCoordinator` arms a pin effect for non-scroll `pin` frames and plays it
  after `orchestrator.flush(frame)` has committed the real layout.
- `LayoutTransitionController` owns only the transient root class lifecycle.
- CSS owns the visual effect through `og-pin-transition`.

## Guardrails

- No real cell `visibility` changes.
- No cloned cells or overlay layer.
- No DOM rect reads.
- No per-cell JavaScript animation.
- No animation work during scroll frames.
- Reduced-motion / no-WAAPI environments apply the layout instantly with no effect.

## Verification

```sh
corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/renderer/layoutTransitionController.test.ts src/renderer/renderPaintCoordinator.test.ts src/renderer/renderEngine.test.ts
corepack pnpm --filter @eregister/wit-grid-core test
corepack pnpm --filter demo-app build
```
