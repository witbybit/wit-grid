# Plan 027: Move viewport/layout orchestration out of RenderEngine

> **Executor instructions**: Follow this plan step by step. Keep renderer
> behavior stable and preserve the existing scroll/render stats. If any
> current-state excerpt no longer matches the live code, stop and report rather
> than improvising a new viewport shape.
>
> **Drift check (run first)**:
> `git diff --stat 05f3eed..HEAD -- packages/core/src/renderer/renderEngine.ts packages/core/src/renderer/renderViewportCoordinator.ts packages/core/src/renderer/renderScrollCoordinator.ts packages/core/src/renderer/renderPaintCoordinator.ts packages/core/src/engine/architectureGuards.test.ts`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/026-render-paint-pipeline-coordinator.md`
- **Category**: architecture, rendering
- **Planned at**: commit `05f3eed`, 2026-06-13

## Why this matters

`RenderEngine` is still carrying the viewport/layout bridge: it computes the
grid layout plan, recycles the viewport on paint and scroll paths, and owns
scroll-into-view targeting. That is the last obvious cross-cutting slice in the
renderer shell after scroll orchestration and paint orchestration moved out.

Pulling that bridge into a dedicated viewport coordinator will make
`renderEngine.ts` closer to a pure composition root and leave the next render
pipeline cuts focused on deeper row/viewport policy instead of top-level
delegation glue.

## Current state

- `packages/core/src/renderer/renderEngine.ts` still owns:
    - `syncLayoutPlan()`
    - `recycleViewport()`
    - `scrollCellIntoView()`
- `packages/core/src/renderer/renderScrollCoordinator.ts` already owns the
  scroll lifecycle and depends on a layout-plan callback for cheap-path work.
- `packages/core/src/renderer/renderPaintCoordinator.ts` already owns the paint
  lifecycle and depends on a layout-plan callback for full-paint work.
- `packages/core/src/renderer/renderOrchestrator.ts` already owns invalidation
  fan-out, so this plan should target viewport/layout orchestration only.

## Commands you will need

| Purpose     | Command                                                                                                                                    | Expected on success |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Build       | `corepack pnpm --filter @eregister/open-grid-core build`                                                                                   | exit 0              |
| Focused     | `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/renderEngine.test.ts src/engine/architectureGuards.test.ts` | exit 0              |
| Core test   | `corepack pnpm --filter @eregister/open-grid-core test`                                                                                    | exit 0              |
| React build | `corepack pnpm --filter @eregister/open-grid-react build`                                                                                  | exit 0              |
| React test  | `corepack pnpm --filter @eregister/open-grid-react test`                                                                                   | exit 0              |
| Demo build  | `corepack pnpm --filter demo-app build`                                                                                                    | exit 0              |

## Scope

**In scope**:

- `packages/core/src/renderer/renderEngine.ts`
- new render viewport/layout coordinator module(s)
- `packages/core/src/engine/architectureGuards.test.ts`
- any focused renderer test updates needed to keep behavior stable

**Out of scope**:

- row-renderer policy extraction
- scroll coordinator changes beyond its public layout-plan dependency
- paint coordinator changes beyond its public layout-plan dependency
- visual behavior changes

## Steps

### Step 1: Extract viewport/layout orchestration into a coordinator

Move `syncLayoutPlan`, `recycleViewport`, and `scrollCellIntoView` into a
dedicated viewport coordinator. Keep the helper fed by explicit dependencies for
layout computation, viewport syncing, row recycling, scroll targeting, and
render stats.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 2: Keep `RenderEngine` as the composition root

Leave renderer construction and mount/unmount wiring in `RenderEngine`, but
route the layout-plan and scroll-into-view work through the new coordinator so
`renderEngine.ts` keeps shrinking.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/renderEngine.test.ts src/engine/architectureGuards.test.ts`
-> exit 0.

### Step 3: Preserve scroll and paint behavior

Make sure the scroll coordinator and paint coordinator still receive the layout
plan callback they need, and that render stats continue to count viewport
recycles and scroll-into-view behavior the same way.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core test`
-> exit 0.

### Step 4: Tighten the architecture guard

Add or update guardrail coverage so `renderEngine.ts` no longer owns the
viewport/layout policy directly, while the new coordinator module does.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts`
-> exit 0.

## Test plan

- Keep `renderEngine.test.ts` as the regression suite for viewport behavior.
- Add a structural guard assertion for the new viewport/layout coordinator
  boundary.

## Done criteria

- [ ] `syncLayoutPlan()`, `recycleViewport()`, and `scrollCellIntoView()` live
      outside `renderEngine.ts`.
- [ ] `RenderEngine` delegates viewport/layout orchestration to the new
      coordinator.
- [ ] Focused renderer tests and full core/react/demo verification pass.
- [ ] `renderEngine.ts` is measurably thinner than the current baseline.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:

- `scrollCellIntoView` starts missing pinned-column behavior or target
  selection,
- the new coordinator needs a large amount of `RenderEngine` private state to
  function, or
- behavior changes in `renderEngine.test.ts` suggest this should be split into
  a smaller viewport-only and scroll-targeting pass.

## Maintenance notes

Future renderer work should keep the viewport/layout bridge separate from the
scroll lifecycle and paint lifecycle. That keeps the next render-pipeline cuts
focused on the actual row/cell pipeline instead of on top-level renderer glue.
