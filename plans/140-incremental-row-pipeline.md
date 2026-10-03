# 140 — Incremental row pipeline

Branch `incremental-pipeline`. Goal: a grouped, aggregated, sorted 100k-row grid absorbs live updates at a
cost proportional to the change, not the data set, and its full runs (load, sort/filter/group change) get
much faster. Results must be identical to a full rebuild.

## Baseline (bench `grouped-feed-10` / `grouped-feed-1000`, Chrome)

100,000 rows grouped region (8) › sector (96), aggregates sum(c5) / avg(c6) / count(c7), sorted by c5 desc;
each 16 ms tick updates N random rows (c5, c6) with `transaction({ rows: { update } })`.

|                     | p50 ms / transaction |
| ------------------- | -------------------- |
| 10 rows per tick    | ~180 (p95 264)       |
| 1,000 rows per tick | ~203                 |

Every update ends in `ClientRowModelController.reconcileAfterDataWrite` → `refresh('bulk')` →
`RowPipeline.run` (impacts `aggregation-input`, `group-key`; `sort-key` with hierarchy rows also refreshes).

Full `RowPipeline.run`, 100k grouped rows (Node, compiled): ~323 ms. Self time per run:
index maps after flatten (`RowPipeline.run` visualRows.forEach, 3 Maps) ~93 ms · `flattenNode` (allocates every
VisualRow) ~73 ms · `RowNode.getCellValue` (per-node Map cache; values read for group key, sort and aggregate)
~60 ms · GC ~28 ms · groupRecursively ~26 · aggregateNodeRecursively ~26 · sort ~30 · compilePathGetter lookups ~9.

## Facts the design relies on

- `RowTreeNode` (rows/stages/types.ts): group nodes hold `children`, `childCount`, `leafCount`, `aggregates`,
  `path`, `keyString`; the full tree is kept in `RowPipelineOutput.roots`.
- Group siblings are ordered by key (`keyString` or `GroupDef.comparator`), never by aggregates, and precede
  leaves. Leaf siblings follow the sort model; ties fall back to original sibling position = source order.
- Write results carry `changedValuesByRow: Map<rowId, Map<field, { oldValue, newValue }>>` and `updatedNodes`.
- The renderer consumes `visualRows`, `visualRowIdToIndex`, `rowIdToVisualIndex`, `rowIdToVisualRowId`,
  `groupMeta(+ByVisualIndex)`, `stickyGroupMeta` and a `RowModelRefreshResult` with
  `changedStartIndex/EndIndex`, `aggregateChangedIndices`, `layoutTransitionHint: 'live-reorder'`.

## Design

`IncrementalRowIndex` (new, rows/): built from a full run's output, owned by the client row model, discarded on
any structural change (columns, sort model, filter model, grouping, aggregation config, tree data, pagination,
row add/remove beyond the threshold) and rebuilt from the next full run.

- `leafOf: Map<rowId, { leaf, parent: GroupNode | null }>`, `groupById: Map<groupId, GroupNode>`, parent links.
- Per group, per aggregate column, an accumulator: `sum`/`avg` (sum, count of numeric values), `count`,
  `min`/`max` (value; recompute the group from its leaves when the removed value equals the extreme),
  `distinctCount` (value → occurrences), `first`/`last`/custom functions (recompute the group). Values written
  back into `group.aggregates` and the group's visual row exactly as `aggregateStage` would produce them.
- Source order: a `sourceIndex` per row id (the data store's order) for sort tie-breaks.

`applyChanges(updatedNodes, changedValuesByRow)` per changed row:

1. Filter membership (p5): if it flips, remove or insert the leaf.
2. Group path: same path → aggregate deltas up the ancestor chain; changed path → remove from the old group
   (delete emptied groups), add to the new one (create missing groups exactly as `groupStage` would).
3. In-group order: when a sort-key value changed, remove the leaf from `parent.children` and binary-insert it by
   the sort model, tie-break by sourceIndex.
4. Flat list: for each affected lowest group, re-flatten only its span in `visualRows` (it is contiguous) and
   splice; update group visual rows (aggregates) in place by index; update the index maps for the rewritten span;
   when a span's length changes, shift the maps after it. groupMeta / stickyGroupMeta: same-length → patch the
   changed groups; length change → rebuild them (O(groups)).
5. Return a refresh result: changed range, `aggregateChangedIndices`, `layoutTransitionHint: 'live-reorder'` when
   rows moved (live sort animation), `changed: false` when nothing visible changed.

Cost model: if the changed row count exceeds a threshold (start at 5% of rows or 2,000) or any group would be
created/destroyed in bulk, fall back to the full run.

Correctness: a seeded property test applies random update batches (sort-key, aggregate-input, group-key and
filter-key changes, ties, empty groups, collapsed groups, totals rows, detail rows) and requires the incremental
output to equal a fresh full run: same visual row ids and order, kinds, depths, aggregates, leaf counts, index
maps and group meta.

## Phases

- p1 — `IncrementalRowIndex` + same-path updates (aggregate deltas + in-group re-sort) + flat span splice +
  property test. Covers `grouped-feed-*`. Target: < 2 ms p50 for 10 rows, < 30 ms for 1,000.
  **DONE (core only).** `rows/incrementalRowIndex.ts` + hook in `ClientRowModelController.reconcileAfterDataWrite` (impacts aggregation-input / sort-key on grouped grids). Bench tx p50/p95/max: grouped-feed-10 180.3/263.9/324.9 -> 8.1/12.8/95.9 ms (first tick builds the index, ~100 ms); grouped-feed-1000 202.9/268.0/327.3 -> 44.8/134.2/249.3 ms. Targets (<2 / <30 ms) not met: what is left is the O(span) rewrite of the flat list + two id->index Map.set per shifted row (a leaf moving p->q shifts every row between), which p4 (cheaper index maps) must attack. Also added: bounded geometry sync (GeometryModel.syncRows toIndex, refresh result changedRanges + heightsUnchanged), no globalVersion bump for in-place aggregate changes. Falls back to the full run for: group-key/filter-key/insert/remove, detail, tree, pagination, getRowHeight, queryModel, custom (function) aggregations, valueGetter sort/aggregate columns, any config-ref change since the last full run, >max(2000, 5%) changed rows. Float sums use deltas (last-bit drift vs a fresh run is possible for non-integer data).
- p2 — group-key changes (move between groups, create/delete groups).
- p3 — filter-key changes (enter/leave), flat sorted grids through the same index (replacing relocateSortedRows).
- p4 — full-run speedups: per-column accessors instead of per-node Map caches for plain fields, reuse VisualRow
  objects for unchanged rows, cheaper index maps; target < 120 ms for 100k grouped.
- p5 — tree data (getParentId) through the same index where practical.
