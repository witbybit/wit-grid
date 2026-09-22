# Plan 023: Split row renderer runtime adapters from RowRenderer

> **Executor instructions**: Execute this plan completely. Keep row rendering
> behavior stable while narrowing architecture. Run all verification commands.
>
> **Drift check (run first)**:
> `git diff --stat bb60b76..HEAD -- packages/core/src/renderer/rowRenderer.ts packages/core/src/renderer/rowRendererRuntime.ts packages/core/src/renderer packages/core/src/engine/architectureGuards.test.ts`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/022-row-cell-binder-boundary.md`
- **Category**: architecture, rendering
- **Planned at**: working tree, 2026-06-12

## Why this matters

After Plan 022, the row renderer had already lost the old hot-path wrappers, but
it still owned the runtime wiring for three separate renderer concerns:

- full-width row orchestration,
- post-scroll decoration coordination,
- lane / binder dependency assembly.

Those adapters are not the viewport shell itself. Moving them into a dedicated
runtime module keeps `rowRenderer.ts` closer to its real job: slot ownership,
viewport iteration, and delegation.

## Scope

**In scope**:

- `packages/core/src/renderer/rowRenderer.ts`
- new renderer runtime adapter module(s)
- renderer architecture guards
- renderer tests needed to prove behavior stability

**Out of scope**:

- row-slot pool redesign
- portal manager redesign
- full renderer pipeline rewrites
- visual behavior changes

## Steps

### Step 1: Move runtime adapters out of RowRenderer

Extract the maintenance, lane-binding, and full-width orchestration adapters
into a dedicated renderer runtime helper module.

### Step 2: Keep RowRenderer as shell and coordinator

`RowRenderer` should keep viewport slot ownership and the main recycle loop, but
delegate the runtime adapter construction to the helper module.

### Step 3: Tighten guardrails

Add checks that:

- `rowRenderer.ts` stays below the new intermediate size budget,
- the new runtime helper owns full-width and post-scroll coordination,
- lane binding still routes through the extracted runtime surface.

### Step 4: Verify renderer stability

Run focused renderer tests plus full core/React/demo verification.

## Verification

1. `corepack pnpm --filter @eregister/wit-grid-core build`
2. `corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/renderer/renderEngine.test.ts src/engine/architectureGuards.test.ts`
3. `corepack pnpm --filter @eregister/wit-grid-core test`
4. `corepack pnpm --filter @eregister/wit-grid-react build`
5. `corepack pnpm --filter @eregister/wit-grid-react test`
6. `corepack pnpm --filter demo-app build`

## Done criteria

- [x] `RowRenderer` delegates full-width orchestration and post-scroll coordination through the runtime helper.
- [x] `rowRenderer.ts` drops below the new intermediate size target.
- [x] Renderer architecture guards cover the runtime adapter boundary.
- [x] Focused renderer tests and full verification pass.
