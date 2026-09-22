# Plan 019: Split RenderEngine orchestration from invalidation wiring

> **Executor instructions**: Execute this plan completely. Keep the renderer
> behavior stable while narrowing architecture. Run all verification commands.
>
> **Drift check (run first)**:
> `git diff --stat bb60b76..HEAD -- packages/core/src/renderer/renderEngine.ts packages/core/src/renderer/renderEngine.test.ts packages/core/src/renderer packages/core/src/engine/architectureGuards.test.ts demo/vite.config.ts`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/018-runtime-fault-diagnostics-boundary.md`
- **Category**: architecture, rendering
- **Planned at**: commit `bb60b76`, 2026-06-12

## Why this matters

The renderer architecture is already moving in the right direction: layout plan,
sticky group layer, header bands, portal manager, row-slot pooling. But
`renderEngine.ts` is still too much of a god object. Its heaviest non-row-render
responsibility is invalidation wiring and gated paint scheduling.

Before cutting deeper into row-slot/cell-slot decomposition, `RenderEngine`
should become a coordinator that composes dedicated collaborators instead of
owning every subscription and paint-trigger rule inline.

## Scope

**In scope**:

- `packages/core/src/renderer/renderEngine.ts`
- new renderer orchestration helper(s) for invalidation binding / gated paint scheduling
- renderer architecture guards
- renderer tests needed to prove behavior stability

**Out of scope**:

- `rowRenderer.ts` decomposition itself
- sticky-group behavior changes
- header-band behavior changes
- portal manager redesign

## Steps

### Step 1: Extract invalidation orchestration

Move the following concerns out of `RenderEngine` into a dedicated renderer
orchestration module:

- state/event subscriptions,
- scroll-aware flush gating,
- public schedule\* paint helpers,
- viewport-dirty / flush-pending bookkeeping hooks.

### Step 2: Keep RenderEngine as coordinator

`RenderEngine` should compose the helper and delegate to it. It may still own
the mutable renderer session flags, but not the subscription policy itself.

### Step 3: Add guardrails

Add checks that:

- `renderEngine.ts` stays below a new intermediate size budget,
- renderer subscription wiring is no longer inlined there,
- the new orchestration helper owns that responsibility.

### Step 4: Verify full renderer stability

Run focused renderer tests plus full core/React/demo verification.

## Verification

1. `corepack pnpm --filter @eregister/wit-grid-core build`
2. `corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/renderer/renderEngine.test.ts src/engine/architectureGuards.test.ts`
3. `corepack pnpm --filter @eregister/wit-grid-core test`
4. `corepack pnpm --filter @eregister/wit-grid-react build`
5. `corepack pnpm --filter @eregister/wit-grid-react test`
6. `corepack pnpm --filter demo-app build`

## Done criteria

- [x] `RenderEngine` no longer owns inline invalidation subscription wiring.
- [x] Public `schedule*Paint` helpers route through the extracted orchestration boundary.
- [x] `renderEngine.ts` drops below the new intermediate size target.
- [x] Focused renderer tests and full verification pass.
