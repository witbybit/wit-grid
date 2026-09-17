# Plan 025: Move scroll-frame orchestration out of RenderEngine

> **Executor instructions**: Follow this plan step by step. Keep the renderer
> behavior stable and preserve the current scroll/render stats. If any current
> state excerpt no longer matches the live code, stop and report rather than
> inventing a new orchestration shape.
>
> **Drift check (run first)**:
> `git diff --stat 05f3eed..HEAD -- packages/core/src/renderer/renderEngine.ts packages/core/src/renderer/RenderInvalidationCoordinator.ts packages/core/src/renderer/renderTelemetry.ts packages/core/src/renderer/rowRenderer.ts packages/core/src/renderer/rowRendererRuntime.ts packages/core/src/engine/architectureGuards.test.ts`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/024-row-renderer-runtime-host-contract.md`
- **Category**: architecture, rendering
- **Planned at**: commit `05f3eed`, 2026-06-12

## Why this matters

`RenderEngine` is still carrying the scroll-frame coordinator logic that decides
when to compute render windows, when to take the cheap same-window path, when
to update cached geometry, and when to fan out to row, header, overlay, and
sticky-group updates. That is now the next largest orchestration knot in the
renderer stack.

Pulling scroll-frame orchestration into a dedicated coordinator will make
`renderEngine.ts` behave more like a composition root and less like a policy
hub. That gives the renderer pipeline a cleaner boundary before we cut deeper
into lower-level render flow.

## Current state

- `packages/core/src/renderer/renderEngine.ts` still owns:
    - the scroll hot path (`onScroll`)
    - scroll-end scheduling and quiet-frame detection
    - `flushScrollFrame`, including render-window computation, cheap scroll-only
      sync, and the main row/header/overlay fan-out
    - `syncCheapScrollOnly`, which updates pinned rows, header scroll state,
      selection overlay, and sticky groups without a full row repaint
- `packages/core/src/renderer/RenderInvalidationCoordinator.ts` already owns
  invalidation subscription wiring, so the next extraction should follow that
  precedent and target scroll orchestration only.
- `packages/core/src/renderer/renderTelemetry.ts` already owns render stat
  snapshot/reset behavior, so this plan should not move telemetry back into
  `RenderEngine`.
- `packages/core/src/renderer/rowRenderer.ts` is already a thin(er) shell at
  744 lines and should stay out of scope except for any required call-site
  wiring.

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
- new render-engine scroll coordinator module(s)
- `packages/core/src/engine/architectureGuards.test.ts`
- any focused renderer test updates needed to keep behavior stable

**Out of scope**:

- row renderer policy extraction
- portal mount manager redesign
- viewport DOM structure changes
- visual behavior changes

## Steps

### Step 1: Extract scroll-frame state and scheduling into a coordinator

Move the scroll-end ticker, scroll flush flow, and same-window cheap-path
decisioning into a dedicated scroll coordinator helper. Keep the helper fed by
explicit callbacks for row/header/overlay/sticky-group actions instead of
reaching back into `RenderEngine` internals.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 2: Keep `RenderEngine` as the composition root for rendering

Leave the renderer construction and mount/unmount wiring in `RenderEngine`, but
route scroll-frame work through the new coordinator so `renderEngine.ts`
retains ownership of setup, not policy.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/renderEngine.test.ts src/engine/architectureGuards.test.ts`
-> exit 0.

### Step 3: Preserve cheap same-window behavior and telemetry

Make sure the cheap scroll-only path still updates the header, overlay, pinned
rows, sticky groups, and current window values, and that render stats continue
to report the same counters as before.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core test`
-> exit 0.

### Step 4: Tighten the architecture guard

Add or update guardrail coverage so `renderEngine.ts` no longer owns the scroll
orchestration policy directly, while the new coordinator module does.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core exec vitest run src/engine/architectureGuards.test.ts`
-> exit 0.

## Test plan

- Keep the existing `renderEngine.test.ts` coverage as the main regression net
  for scroll/render behavior.
- Add any focused assertions needed to prove the cheap scroll-only path still
  updates pinned rows and sticky groups without a full row recycle.
- Keep the architecture guard as the structural boundary check.

## Done criteria

- [ ] Scroll-end scheduling and same-window cheap-path logic live outside
      `renderEngine.ts`.
- [ ] `RenderEngine` still owns composition and wiring, but not the scroll
      orchestration policy.
- [ ] Focused renderer tests and full core/react/demo verification pass.
- [ ] `renderEngine.ts` is measurably thinner than the current baseline.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back if:

- the cheap same-window scroll path starts missing pinned-row or sticky-group
  updates after extraction,
- the new coordinator needs direct access to a large fraction of `RenderEngine`
  private state, or
- behavior changes in `renderEngine.test.ts` require widening the plan scope to
  include row renderer changes.

## Maintenance notes

Future renderer work should keep following the same pattern: extract one
coordinator concern at a time, keep callbacks explicit, and do not let
`RenderEngine` become the place where cross-cutting policy accumulates again.
The next likely cuts after this plan are cheaper if the scroll frame lifecycle
is already isolated.
