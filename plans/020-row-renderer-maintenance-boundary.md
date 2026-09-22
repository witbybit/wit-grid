# Plan 020: Split RowRenderer maintenance from viewport slot binding

> **Executor instructions**: Execute this plan completely. Keep row rendering
> behavior stable while narrowing architecture. Run all verification commands.
>
> **Drift check (run first)**:
> `git diff --stat bb60b76..HEAD -- packages/core/src/renderer/rowRenderer.ts packages/core/src/renderer/renderEngine.ts packages/core/src/renderer packages/core/src/engine/architectureGuards.test.ts`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/019-render-engine-orchestration-boundary.md`
- **Category**: architecture, rendering
- **Planned at**: commit `bb60b76`, 2026-06-12

## Why this matters

After Plan 019, `RenderEngine` is a cleaner coordinator, but
`packages/core/src/renderer/rowRenderer.ts` is still a large mixed-responsibility
class. It currently owns viewport slot recycling, hot scroll-path cell binding,
invalidation repaint, and scroll-idle dirty-cell repair.

The next safe cut is to move the non-hot maintenance work out of
`RowRenderer` so the class is more clearly about viewport slot binding and cell
binding policy.

## Scope

**In scope**:

- `packages/core/src/renderer/rowRenderer.ts`
- new renderer maintenance helper(s) for invalidation repaint / post-scroll repair
- renderer architecture guards
- renderer tests needed to prove behavior stability

**Out of scope**:

- full row-slot decomposition
- cell portal lifecycle redesign
- row class / style hook semantics changes
- full-width row renderer redesign

## Steps

### Step 1: Extract row maintenance orchestration

Move invalidation repaint and scroll-idle repair logic into a dedicated renderer
maintenance module.

### Step 2: Keep RowRenderer focused

`RowRenderer` should remain the owner of slot state and hot binding methods, but
delegate the maintenance algorithms.

### Step 3: Add guardrails

Add checks that:

- `rowRenderer.ts` stays below a new intermediate size budget,
- the new maintenance helper owns repaint / post-scroll repair orchestration.

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

- [x] `RowRenderer` delegates invalidation repaint and scroll-idle dirty repair.
- [x] `rowRenderer.ts` drops below the new intermediate size target.
- [x] Renderer architecture guards cover the new maintenance boundary.
- [x] Focused renderer tests and full verification pass.
