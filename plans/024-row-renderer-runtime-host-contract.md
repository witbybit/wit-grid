# Plan 024: Stabilize the row renderer runtime host contract

> **Executor instructions**: Follow this plan step by step. Keep the renderer
> shell thin, but do not invent new render-pipeline abstractions. If the live
> code no longer matches the current-state excerpts, stop and report rather
> than improvising.
>
> **Drift check (run first)**:
> `git diff --stat 05f3eed..HEAD -- packages/core/src/renderer/rowRenderer.ts packages/core/src/renderer/rowRendererRuntime.ts packages/core/src/renderer/rowCellBinder.ts packages/core/src/engine/architectureGuards.test.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/023-row-renderer-runtime-adapter-boundary.md`
- **Category**: architecture, rendering
- **Planned at**: commit `05f3eed`, 2026-06-12

## Why this matters

Plan 023 got the row renderer to delegate runtime assembly into
`rowRendererRuntime.ts`, but the adapter still has to line up precisely with
real `RowRenderer` state. If the runtime host surface drifts, the shell becomes
fragile again: either it leaks missing-method casts or it pulls hot-path
assembly back into `rowRenderer.ts`.

This slice makes the runtime contract honest and keeps the shell focused on
viewport ownership, while preserving the current rendering behavior and size
budget.

## Current state

- `packages/core/src/renderer/rowRenderer.ts` delegates row/data lane binding,
  full-width binding, invalidation repaint, and scroll-idle decoration through
  `createRowRendererRuntimeArgs(...)`.
- `packages/core/src/renderer/rowRendererRuntime.ts` owns the runtime assembly
  for those helpers, plus the lane and maintenance dependency bridges.
- `packages/core/src/renderer/rowCellBinder.ts` still asks for a programmatic
  scroll cell through `getProgrammaticScrollCell()`, so the runtime bridge must
  provide that value without assuming a missing host method.
- `packages/core/src/engine/architectureGuards.test.ts` still guards the old
  `this.getRowRendererRuntimeArgs()` string and needs to match the new runtime
  factory call sites.

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

- `packages/core/src/renderer/rowRenderer.ts`
- `packages/core/src/renderer/rowRendererRuntime.ts`
- `packages/core/src/renderer/rowCellBinder.ts`
- `packages/core/src/engine/architectureGuards.test.ts`

**Out of scope**:

- renderer pipeline redesign
- row-slot pool rewrites
- portal-mount manager changes
- any visual behavior change

## Steps

### Step 1: Make the runtime host contract reflect real state

Ensure the runtime helper reads the existing `programmaticScrollCell` property
instead of expecting a non-existent getter on `RowRenderer`.

**Verify**: `corepack pnpm --filter @eregister/open-grid-core build` -> exit 0.

### Step 2: Reduce binder churn around programmatic scroll checks

Update `rowCellBinder.ts` so the programmatic-scroll pointer is read once per
bind path and reused, instead of calling the getter repeatedly.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/renderEngine.test.ts src/engine/architectureGuards.test.ts`
-> exit 0.

### Step 3: Keep the architecture guard aligned with the runtime factory

Make the row-renderer boundary test assert the `createRowRendererRuntimeArgs(`
delegate shape, not the retired `getRowRendererRuntimeArgs()` path.

**Verify**: the focused vitest command above stays green.

### Step 4: Confirm the renderer shell stays under budget

Check `rowRenderer.ts` remains under the intermediate size guard and that the
runtime helper owns the adapter code.

**Verify**:
`corepack pnpm --filter @eregister/open-grid-core test`
-> exit 0 and `rowRenderer.ts` stays below the 800-line guard.

## Test plan

- Keep using the existing `renderEngine.test.ts` regression coverage as the
  safety net for scroll and binding behavior.
- Keep `architectureGuards.test.ts` as the structural boundary check for the
  renderer shell.

## Done criteria

- [x] `rowRendererRuntime.ts` consumes the live programmatic-scroll state
      without a missing host method.
- [x] `rowCellBinder.ts` reuses the programmatic scroll pointer within the bind
      path.
- [x] `architectureGuards.test.ts` matches the new runtime factory call sites.
- [x] `corepack pnpm --filter @eregister/open-grid-core build` exits 0.
- [x] `corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/renderEngine.test.ts src/engine/architectureGuards.test.ts` exits 0.
- [x] `corepack pnpm --filter @eregister/open-grid-core test` exits 0.
- [x] `corepack pnpm --filter @eregister/open-grid-react build` exits 0.
- [x] `corepack pnpm --filter @eregister/open-grid-react test` exits 0.
- [x] `corepack pnpm --filter demo-app build` exits 0.
- [x] `rowRenderer.ts` remains below the 800-line intermediate budget.

## Maintenance notes

Future renderer slices should keep pushing policy out of `rowRenderer.ts`, but
new helpers should consume explicit host state rather than assuming more
renderer methods will appear. If the host surface grows again, that is a sign
the next slice should move another piece of policy out of the shell, not add
another adapter method here.
