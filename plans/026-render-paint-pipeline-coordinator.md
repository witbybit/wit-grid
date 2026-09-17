# Plan 026: Move paint-pipeline orchestration out of RenderEngine

> **Executor instructions**: Follow this plan step by step. Keep the renderer
> behavior stable and preserve the existing render stats. If any current-state
> excerpt no longer matches the live code, stop and report rather than
> improvising a new paint pipeline shape.
>
> **Drift check (run first)**:
> `git diff --stat 05f3eed..HEAD -- packages/core/src/renderer/renderEngine.ts packages/core/src/renderer/renderScrollCoordinator.ts packages/core/src/renderer/renderPaintCoordinator.ts packages/core/src/renderer/renderOrchestrator.ts packages/core/src/engine/architectureGuards.test.ts`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/025-render-engine-scroll-frame-coordinator.md`
- **Category**: architecture, rendering
- **Planned at**: commit `05f3eed`, 2026-06-12

## Why this matters

The scroll path is now isolated, but `RenderEngine` still owns the paint-pipeline
policy: it refreshes renderer epochs, consumes invalidation frames, decides when
sort animation should start, and fans out full-paint work across viewport,
rows, headers, overlay, and sticky-group updates.

That is the next meaningful orchestration knot. Pulling it into a dedicated
paint coordinator will make `renderEngine.ts` a narrower composition root and
leave the paint lifecycle in one place that can be tested and evolved without
dragging the whole renderer shell with it.

## Current state

- `packages/core/src/renderer/renderEngine.ts` still owns:
    - `flushPaint()`
    - `refreshRendererEpochs()`
    - `fullPaintInternal()`
    - the `pendingSortAnimation` state flag
- `packages/core/src/renderer/renderOrchestrator.ts` already owns the invalidation
  fan-out for geometry, viewport, rows, cells, headers, and overlay, so this
  plan should build on that rather than replacing it.
- `packages/core/src/renderer/renderScrollCoordinator.ts` already owns the scroll
  lifecycle and exposes `getIsScrolling()`, which the paint pipeline should use
  for gating sort animation.
- `packages/core/src/renderer/renderTelemetry.ts` already owns render stat
  collection/reset, so the paint coordinator should continue to feed that data
  rather than duplicating telemetry logic.

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
- new render paint coordinator module(s)
- `packages/core/src/engine/architectureGuards.test.ts`
- any focused renderer test updates needed to keep behavior stable

**Out of scope**:

- row-renderer policy extraction
- scroll coordinator changes beyond its public getter usage
- portal mount manager redesign
- visual behavior changes

## Steps

### Step 1: Extract the paint lifecycle into a dedicated coordinator

Move the render-epoch refresh, flush-paint orchestration, and full-paint fan-out
into a new coordinator module. Keep the public `RenderEngine` methods as thin
delegates.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 2: Preserve sort-animation and telemetry behavior

Make sure the new coordinator still starts sort animation only after a
non-scrolling sort invalidation and that render stats continue to collect
through the existing orchestrator and telemetry helpers.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/renderEngine.test.ts src/engine/architectureGuards.test.ts`
-> exit 0.

### Step 3: Keep `RenderEngine` as the composition root

Leave renderer construction, wiring, and public API entry points in
`RenderEngine`, but ensure the paint-policy code itself lives in the new
coordinator.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core test`
-> exit 0.

### Step 4: Tighten the architecture guard

Add guardrail coverage so `renderEngine.ts` no longer inlines the flush/full
paint lifecycle and the new coordinator owns that policy.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts`
-> exit 0.

## Test plan

- Keep `renderEngine.test.ts` as the regression suite for paint behavior.
- Add a structural guard assertion for the new paint coordinator boundary.

## Done criteria

- [ ] `flushPaint()`, `refreshRendererEpochs()`, and `fullPaintInternal()` live
      outside `renderEngine.ts`.
- [ ] `RenderEngine` delegates paint lifecycle work to the new coordinator.
- [ ] Focused renderer tests and full core/react/demo verification pass.
- [ ] `renderEngine.ts` is measurably thinner than the current baseline.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:

- the sort-animation start timing changes,
- the full-paint path starts duplicating viewport or sticky-group work, or
- the coordinator needs to reach through a large amount of `RenderEngine`
  private state to function.

## Maintenance notes

Future renderer work should keep the paint lifecycle, scroll lifecycle, and
invalidation fan-out in separate coordinators. That gives the next pipeline cut
room to focus on layout-plan or viewport-surface refinement instead of
re-teaching `RenderEngine` about orchestration.
