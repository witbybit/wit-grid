# 140 — Incremental row pipeline

**Status: closed (2026-10-04).** Leftovers parked in tracker r14 (incremental group create/delete, flat filter flips and bulk insert/remove, tree data). Follow-up program: the flagship markets desk (tracker group "Flagship desk: flawless").

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
- p2 — group-key changes. **DONE (core).** A row whose group key changes moves between EXISTING lowest groups (old group stays non-empty): leaf removed/inserted at its sorted place (tie by source order), leaf/child counts up both chains, aggregates of both chains (sum/avg/count/min/max by delta with recompute when the extreme leaves, first/last recomputed, distinct counts by delta), group rows' hierarchy counts, groupMeta (counts, indices, first/last leaf), stickyGroupMeta. Falls back (null before any mutation) when a group would be created or emptied, a group level has a key creator or valueGetter, the grid has no sort model (group order is then first-appearance and a membership change can reorder it), `defaultExpanded` is a function of leaf count, or a row's raw key differs from its group's key by Object.is.
- p3 — filter-key changes. **DONE for grouped grids (core).** Client/quick-filter membership is decided by the same predicate as the full run (`createClientFilterPredicate`, factored out of `applyClientFilterOnly`): a row entering/leaving inserts/removes its leaf in an existing group that stays non-empty. Query model, valueGetter columns with an active filter, tree, detail, pagination still use the full run. Flat sorted grids through the same index (replacing relocateSortedRows) NOT done.
  Flat list for p2/p3: a group that gains or loses on-screen rows is rewritten whole in one pass over the list after the first such group; index maps shift in that pass (O(rows after)), groupMeta/groupMetaByVisualIndex/stickyGroupMeta are patched in O(groups) (shift outside rewritten spans, first/last leaf re-read for groups containing one). Refresh result: previous/nextRowCount, one changed range, global version bump (geometry resyncs fully); collapsed groups only change tree, aggregates and group row hierarchy counts (reported via aggregateChangedIndices).
- p2/p3 follow-up — positions. **DONE.** (a) Uniform-height grids resize geometry instead of re-reading every row (GeometryModel.resizeUniformRows, model getUniformRowHeight). (b) Grouped rows are located through their group: the index keeps no rowId->index map; a data row's index is its group row's index + its place in the group (`leaf.row`, set by flatten), so a group that grows shifts only group/total rows. (c) The client row model keeps data-row positions on `RowNode.visualIndex` (checked against the visual row on read), no rowId->index Map; stale after grouped incremental moves (lookups go through the index, re-stamped lazily for flat paths). grouped-feed-moves tx p50 44 -> 7.9 ms.
- Flat sorted live feeds. **DONE (without the index).** Profiling showed the flat path's cost was geometry (a live reorder re-read every row height) and Map re-indexing, not the algorithm, so it stays on relocateSortedRows: reorders of uniform-height rows report heightsUnchanged, positions are RowNode fields, >16 movers merge in one pass, repeated rows in a batch move once. Bench flat-feed-10 / flat-feed-1000 tx p50: 54 -> 5.7 ms, 80 -> 16.7 ms (p95 248 -> 30). Not done: flat filter flips and insert/remove beyond INCREMENTAL_TX_LIMIT still run the full pipeline.
- p4 — full-run speedups: per-column accessors instead of per-node Map caches for plain fields, reuse VisualRow
  objects for unchanged rows, cheaper index maps; target < 120 ms for 100k grouped.
  **DONE (target met).** Grouping: one reader + one Map lookup per row. Flatten: no object spread, visual ids cached on RowNode (`dataVisualId`), no height-record lookups when empty. Pipeline builds `rowIdToVisualIndex` lazily (the model never reads it). Data store caches its node list. Aggregation: stats/readers resolved once per leaf group (row-major; column-major was slower: cache misses on 200k rows). Sort: per-column readers, numeric single-column fast path (tree and flat). Node, 100k rows (bench/\_fullrun.mjs): grouped 2-3 levels ~350-400 -> ~105-130 ms; flat sort ~200 -> ~50 ms per run. Browser, markets desk 200k regroup script 1.1-1.5 s -> 350-480 ms. Not done: reusing VisualRow objects across runs.
- p5 — tree data (getParentId) through the same index where practical.
