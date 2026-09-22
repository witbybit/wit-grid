# Plan 141: Finish Write-Pipeline Convergence and Make Targeted Invalidations Real

## Mission

Finish the last mile of canonical write convergence so every production write source shares one post-write contract, then replace blunt full paints with refresh-result-driven invalidation plans wherever the row model can already describe a narrower impact.

## Why now

Plans 131, 138, and 140 moved the grid much closer to one source of truth, but two core risks still remain:

1. some write sources still over-upgrade to `full` invalidation after otherwise canonical commits
2. the invalidation model already tracks `row-range` and `group` scopes, but the renderer barely consumes them

That means the architecture is more correct than it is fast. Before advanced features like pivoting, aggregation-heavy views, and larger feature stacks, the grid needs both canonical write semantics and invalidation honesty.

## Goals

- every production write source reaches one shared post-write contract
- row-model refresh results drive invalidation scope instead of collapsing to `full` by default
- `row-range` and `group` invalidations become real renderer signals, not bookkeeping with no effect
- the renderer stays deterministic: commit declares scope, renderer consumes scope, no feature-local repaint guessing

## In scope

- `packages/core/src/engine/GridDomainMutation.ts`
- `packages/core/src/engine/GridChangeApplier.ts`
- `packages/core/src/features/DataMutationController.ts`
- `packages/core/src/renderer/renderOrchestrator.ts`
- `packages/core/src/renderer/renderEngine.ts`
- `packages/core/src/renderer/rowRenderMaintenance.ts`
- `packages/core/src/renderer/invalidationManager.ts`
- focused regression tests under `packages/core/src/store.test.ts`, `packages/core/src/renderer/`, and `packages/core/src/engine/`

## Target end state

- value-only writes stay cell/row-targeted
- sort/filter refreshes emit viewport/range invalidations derived from `RowModelRefreshResult`
- structural row changes emit geometry plus the narrowest repaint the row model can justify
- row-range and group invalidations cause meaningful renderer work
- no canonical row-write executor falls back to `full` unless the write truly invalidates the whole physical view

## Workstreams

### 1. Canonical write post-processing

- inventory every production write source and confirm it flows through commit-kernel semantics
- remove any remaining executor-local “special case” invalidation logic that is not derived from the shared write result + refresh result contract
- keep write result semantics (`applied` / `noop` / `rejected` / `failed`) identical across direct writes, batch writes, fill, paste, and integrity writes

### 2. Refresh-result invalidation planning

- introduce a shared helper that converts `RowModelRefreshResult` into invalidation lanes
- use `changedStartIndex` / `changedEndIndex` when available
- preserve geometry invalidation when row count or row topology changed
- preserve cell-change publication separately from visual-row invalidation

### 3. Renderer consumption hardening

- make `RenderOrchestrator` treat `row-range` and `group` invalidations as first-class repaint scopes
- ensure viewport/overlay sync rules still hold when invalidation is narrow but structural
- add tests that prove these lanes are no longer ignored

## Done criteria

- no row-write executor uses `full` invalidation as the default answer for non-full writes
- row-range and group invalidations trigger observable renderer work
- focused invalidation and write-path regression suites pass
- full `@eregister/wit-grid-core` test suite passes
