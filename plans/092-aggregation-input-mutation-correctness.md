# Plan 092: Aggregation Input Mutation Correctness

> **Why this must land first**: `RowDependencyRegistry` records aggregation fields, but mutation classification never consumes them. A row update to an aggregated field can therefore be treated as value-only while group totals remain stale. This is a direct data-correctness bug and must be closed before further incremental row-model optimization.

## Status

- **Priority**: P0 — data correctness
- **Effort**: M
- **Risk**: MEDIUM — touches row mutation classification and grouped aggregates
- **Depends on**: Plans 089–091
- **Category**: row model, aggregation, correctness
- **Planned at**: 2026-06-18, branch `rendering-architecture-v2-wip-3`

## Problem

`RowDependencyRegistry` records aggregation inputs:

```ts
readonly aggregationFields = new Set<string>();
```

but `classifyMutation()` does not inspect them. In a grouped grid, updating an aggregated field such as `salary` may be classified as `value-only`, causing the leaf cell to update while parent group aggregates remain stale.

The failure is silent and can affect sum, average, count-derived state, custom aggregators, and sorting/filtering that depends on aggregate output.

## What to add

### 1. Explicit aggregation mutation impact

```ts
export type RowMutationImpact =
	| 'value-only'
	| 'formula-dependent'
	| 'aggregation-input'
	| 'sort-key'
	| 'filter-key'
	| 'group-key'
	| 'tree-parent'
	| 'structural';
```

Classify aggregation inputs before value-only fallback:

```ts
if (matchesAny(changedFields, registry.aggregationSourceFields)) {
	return 'aggregation-input';
}
```

### 2. Correct fallback behavior

For the first implementation, `aggregation-input` may trigger a full grouped-model refresh. Correctness is the gate.

```ts
const requiresStructuralRefresh = impact === 'aggregation-input' || impact === 'group-key' || impact === 'tree-parent' || impact === 'structural';
```

### 3. Incremental aggregate recomputation contract

Add a narrow internal API for a later optimization:

```ts
recomputeAggregatesForRows(rowIds: readonly string[]): AggregateRecomputeResult;
```

The implementation may walk affected group ancestors and recompute only those nodes, but this optimization must not delay the correctness fix.

### 4. Aggregate-dependent sort/filter invalidation

When sorting or filtering uses aggregate output, the refresh must also rebuild the affected visible ordering or inclusion state.

## Phases

### Phase 1 — Classification correctness

- Add `aggregation-input`
- Resolve aggregation source fields
- Route aggregation mutations through structural refresh

### Phase 2 — Test coverage

- Sum changes after leaf update
- Average changes after leaf update
- Multiple nested groups update all ancestors
- Dotted-path aggregation field
- Custom aggregator
- Aggregate sort/filter remains correct

### Phase 3 — Optional incremental recomputation

- Recompute affected ancestor aggregates only
- Compare against full rebuild output
- Retain full refresh as fallback for opaque/custom cases

## STOP conditions

- Do not treat aggregation fields as value-only.
- Do not update only the rendered group cell; the row model must own aggregate truth.
- Do not assume custom aggregators are associative or incrementally reversible.
- Do not optimize before full-refresh correctness tests pass.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add grouped row-model tests proving aggregate values and aggregate-dependent ordering remain correct after updates.
