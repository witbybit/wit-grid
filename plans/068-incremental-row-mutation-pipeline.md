# Plan 068: Incremental Row Mutation Pipeline

> **Why this is the largest remaining performance win**: The slot renderer avoids rebuilding DOM during scroll, but ordinary data updates can still rebuild filtered rows, sorted rows, visual rows, lookup maps, grouping metadata, and geometry. Optimizing the last renderer writes while retaining full row-pipeline rebuilds leaves the dominant application workload untouched.

## Status

- **Priority**: P1 — major data-update scalability work
- **Effort**: XL
- **Risk**: HIGH — row-model correctness across grouping, filtering, sorting, and tree data
- **Depends on**: Plans 065–067
- **Category**: row model, performance, architecture
- **Planned at**: 2026-06-16, branch `rendering-architecture-v2-wip-3`

## Problem

`RowPipeline.run()` is primarily a full-rebuild pipeline. Depending on enabled features, one mutation may filter, sort, group, aggregate, flatten, paginate, allocate new `VisualRow` objects, and rebuild several lookup maps.

A value-only update that does not affect sort, filter, grouping, tree position, or height should not rebuild any of those structures.

## What to add

### 1. Mutation impact classification

```ts
export type RowMutationImpact =
	| 'value-only'
	| 'formula-dependent'
	| 'sort-key'
	| 'filter-key'
	| 'group-key'
	| 'tree-parent'
	| 'height'
	| 'insert'
	| 'remove'
	| 'full-rebuild';
```

Classify mutations from changed fields plus active feature dependencies.

### 2. Dependency indexes

Track which columns participate in:

- sort model
- filter model
- row grouping
- tree parent/path derivation
- aggregation inputs
- row-height callbacks
- formulas/value getters

Classification must not scan all column definitions per update.

### 3. Incremental update paths

Minimum v1 behavior:

- `value-only`: update row data/version and invalidate affected cells only
- `formula-dependent`: recompute dependency closure and invalidate affected cells
- `height`: update geometry from affected visual index
- `sort-key`: reposition the row when safe, otherwise fallback
- `filter-key`: insert/remove the row from filtered output when safe
- `group-key`: relocate row and recompute affected ancestors
- `insert/remove`: batch structural updates with a documented fallback threshold

### 4. Full rebuild remains explicit fallback

Every incremental handler may return `unsupported`, causing a full pipeline run. Record fallback reason through instrumentation.

### 5. Stable visual-row reuse

Reuse existing visual-row objects or records when identity and structural role are unchanged. Avoid recreating the entire `VisualRow[]` for value-only updates.

## Phases

### Phase 1 — Classifier and dependency registry

- Add mutation-impact types
- Build dependency sets whenever sort/filter/group/tree/formula configuration changes
- Add classifier unit tests

### Phase 2 — O(1) value-only path

- Update row node and row version
- Preserve visual arrays and lookup maps
- Invalidate only affected cells and formula dependents

### Phase 3 — Height and filtered membership

- Incrementally update geometry for height changes
- Add single-row filter enter/exit handling

### Phase 4 — Sort and group relocation

- Add safe row repositioning
- Recompute only affected group ancestors and aggregates
- Preserve full rebuild fallback for complex tree cases

### Phase 5 — Batched insert/remove

- Apply structural mutations in batches
- Define threshold where rebuilding is cheaper
- Add benchmark coverage

## STOP conditions

- Do not remove the full rebuild path.
- Do not claim O(1) if formula, event, or renderer work still scales with row count.
- Do not mutate public state snapshots in place.
- Do not implement grouping/tree incrementality without invariant tests for visual identity and aggregate correctness.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add benchmarks proving a non-dependent cell update allocates no new visual-row array, rebuilds no row lookup maps, and performs work independent of total row count.
