# Plan 083: Large-Model Incremental Index Maintenance

> **Why this is the next performance gate**: The row pipeline now avoids full sorting and full visual-model reconstruction for several mutations, but the incremental paths still clone the visual array and rebuild multiple full maps. For very large models, one-row changes remain O(n) with high allocation pressure. The index structures must become incremental before the fast paths can be called scalable.

## Status

- **Priority**: P1 — large-model performance
- **Effort**: L
- **Risk**: HIGH — core visual row indexing
- **Depends on**: Plan 082
- **Category**: rows, performance, data structures
- **Planned at**: 2026-06-17, branch `rendering-architecture-v2-wip-3`

## Problem

Incremental sort relocation and insert/remove currently may still:

- clone `visualRows`
- splice an O(n) array
- recreate `visualRowIdToIndex`
- recreate `rowIdToVisualIndex`
- recreate `rowIdToVisualRowId`
- scan the entire visual model

A transaction-size threshold alone is insufficient because the dominant cost depends on total model size and changed position.

## What to add

### 1. Cost-aware mutation planner

```ts
interface IncrementalMutationCost {
	changedRows: number;
	totalVisualRows: number;
	earliestChangedIndex: number;
	estimatedShiftCount: number;
}
```

Select the strategy from estimated cost, not only transaction count.

### 2. Incremental map maintenance

For the first implementation:

- preserve existing maps
- delete removed identities directly
- update inserted identities directly
- rewrite indices only from `earliestChangedIndex`
- avoid recreating map objects

### 3. Batch relocation algorithm

Sort changed rows once, remove them in descending index order, and reinsert them with bounded searches. Reindex only affected ranges.

### 4. Large-model storage evaluation

Benchmark and document whether arrays remain viable at target scale. If they do not, introduce one of:

- chunked visual row blocks
- paged vectors
- balanced sequence structure
- lazy offset/index segments

Do not introduce a complex structure without benchmark evidence.

### 5. Strategy telemetry

Record which mutation strategy ran and its cost in development/performance instrumentation.

## Phases

### Phase 1 — Preserve and update maps

- Remove unconditional map recreation
- Reindex from earliest changed position

### Phase 2 — Cost model

- Include total size and shift distance
- Choose incremental versus full rebuild from measured thresholds

### Phase 3 — Large-model benchmarks

Benchmark 10k, 100k, and 1m rows for:

- one update
- one insertion near start/middle/end
- one removal
- 50 updates
- sorted relocation

### Phase 4 — Optional storage upgrade

Only if arrays miss the documented target, introduce a chunked representation behind the row-model interface.

## STOP conditions

- Do not claim O(k log n) while rebuilding O(n) maps.
- Do not optimize only transaction size and ignore total model size.
- Do not expose the internal storage structure through public APIs.
- Do not introduce a tree/rope structure before benchmark thresholds and target workloads are written down.

## Verification gate

```text
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-core test -- performance
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

Add correctness tests for map identity preservation, earliest-index reindexing, batch relocation, inserts/removes at all positions, and performance tests across 10k/100k/1m row models.
