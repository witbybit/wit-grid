# Hierarchy rendering v2 — groups, tree data, totals, master-detail

Status: design, 2026-09-30. Replaces the current design outright; there is no compatibility layer.

## Why

Today the grid computes hierarchy properly (grouping, aggregation, tree building, expansion, detail rows) and then
renders none of it. Every non-data row is one full-width box handed to an adapter (`onMountRowContent`); React
draws whatever component it was given. Consequences found while mapping the code:

- No group column, no tree cell (users write their own indent and chevron), aggregates not under their columns,
  subtotals that ignore column formatters (`margin: 35.78443113772455`), a placeholder detail renderer.
- Full-width rows are content-width inside the horizontal scroller, so labels slide off; they are React-only and
  their mounts are deferred during scroll, so they paint blank; the sticky stack walk assumes group entries in row
  order while flatten records them post-order, so nested sticky headers break.
- Behaviour lives in React components or nowhere: group selection is a React checkbox over _visible_ rows only;
  no keyboard expand/collapse; group, total and detail rows can never take focus; no `treegrid`, `aria-level` or
  `aria-expanded`; copy and CSV skip hierarchy rows; footers are not row nodes.
- Model gaps: tree parents never get aggregates; `defaultExpanded` groups cannot be collapsed; tree rows are
  toggled through `toggleGroupExpanded` by id-prefix routing; aggregate-only changes never repaint group rows;
  configuration is split between flat state keys and a second `rowModelConfig` shape that silently ignore each
  other; server-side child stores are loaded but never spliced into the visual list.

## Principles

1. **The hierarchy is data.** Every visual row states its place in the hierarchy (level, parent, children,
   expansion, position among siblings). Renderers read it; they never reconstruct it.
2. **Core owns behaviour.** Expansion, selection cascade, focus, keyboard, ARIA, copy and export are core
   features, identical with or without React.
3. **One rendering path.** Group and total rows are real cell rows through the same binders, lanes and scroll
   presentations as data rows. The hierarchy column is a real column. Only rows that are genuinely one block
   (detail, a full-width group row by choice) use a full-width renderer, and that has a core contract too.
4. **Every part is replaceable** with the same renderer specs cells already use (`text`, `dom`, `react`), and the
   defaults are good enough to ship without replacing anything.

## Model

### Configuration (one shape)

```ts
initialState: {
	grouping?: {
		by: Array<string | GroupDef>;                    // GroupDef { colId, keyCreator?, comparator? }
		display?: 'column' | 'columns' | 'row';          // default 'column' (see Rendering)
		defaultExpanded?: boolean | number | ((group: GroupInfo) => boolean); // number = levels open
		totals?: { groups?: TotalPlacement | ((level: number) => TotalPlacement); grand?: TotalPlacement };
		stickyHeaders?: boolean;
		rowHeight?: number;
		selectDescendants?: boolean;                     // default true: selecting a group selects its rows
		sortGroupsByAggregate?: boolean;                 // default true
	};
	treeData?: {
		getParentId: (row) => string | null | undefined;
		column: string;                                  // field shown in the hierarchy column
		defaultExpanded?: boolean | number | ((row: TreeRowInfo) => boolean);
		filterMode?: 'strict' | 'includeAncestors' | 'includeDescendants';
		aggregateParents?: boolean;                      // default true when aggregation is configured
		selectDescendants?: boolean;                     // default false
	};
	aggregation?: { defs: AggregationDef[] };
	detail?: {
		isMaster?: (row) => boolean;                     // default: every row can open a detail
		height?: number | 'auto' | ((row) => number);    // 'auto' measures the rendered content
		renderer: RowRendererSpec;
	};
	hierarchyColumn?: HierarchyColumnConfig;           // header, width, pinning, cell parts (see Rendering)
}
type TotalPlacement = 'top' | 'bottom' | false;
```

`groupBy`, `showGroupFooter`, `getParentId`, `masterDetailEnabled`, `groupRowHeight`, `detailRowHeight`,
`detailRenderer`, `enableStickyGroupRows` and `rowModelConfig` are removed.

Implemented in phase 1 (`rows/hierarchyConfig.ts`): `grouping.{by, defaultExpanded, totals, stickyHeaders,
rowHeight}`, `treeData.{getParentId, getParentIdDependencies, defaultExpanded, filterMode, aggregateParents}`,
`aggregation.defs`, `detail.{isMaster, height, renderer}`. The rest land with the phase that renders them:
`display` and `hierarchyColumn` (2–3), `detail.height: 'auto'` and `RowRendererSpec` (4), `selectDescendants` (6),
`sortGroupsByAggregate` (later). Configs enter state as frozen copies, so the state snapshot shares them by
reference without exposing writable grid state. Grouping wins when both `grouping.by` and `treeData` are set.
Persistence stores `grouping: { by, totals, stickyHeaders }` (schema v3) and restores it over the configured
grouping, keeping configured `GroupDef`s.

### Visual rows

Every row carries a `hierarchy` block:

```ts
interface RowHierarchy {
	level: number; // 0 = top level, for all kinds
	parentId: string | null; // visual id of the parent group / tree row
	hasChildren: boolean;
	expanded: boolean; // false when !hasChildren
	childCount: number; // direct children
	leafCount: number; // data rows beneath (all, not only visible)
	posInSet: number; // 1-based position among siblings (aria-posinset)
	setSize: number; // sibling count (aria-setsize)
}
```

Kinds: `data` (tree nodes included), `group`, `total` (`scope: 'group' | 'grand'`, `groupId`, `placement`),
`detail`, `loading`, `failed`, `placeholder`. `footer` is gone; totals replace it at every level, top or bottom,
plus a grand total. Group and total rows carry `aggregates: Record<colId, unknown>`.

### Aggregation

`AggregationDef { colId, aggFunc: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinctCount' | 'first' | 'last' |
((ctx: AggregateContext) => unknown) }`. Values are read through the column's value getter everywhere; only leaf
rows contribute, so a parent's aggregate covers its descendants. Tree parents aggregate their subtree
(`aggregateParents`). Custom functions get `{ colId, values, rows, scope: 'group' | 'tree' | 'grand', level, key }`
(`level` -1 for the grand total). `first` / `last` follow row order after sorting.

### Expansion

One source of truth: explicit per-row overrides on top of a default.
`state.expansion = { rows: Record<visualRowId, boolean>, details: Record<rowId, true>, base?: boolean | number }`.
A missing id uses `base` when set, otherwise `defaultExpanded`, so a default-open group can be closed.
`expandAll({ maxLevel })` / `collapseAll()` set `base` and clear `rows` — O(1) however large the tree. Tree rows
are keyed by their data visual id (`row:…`), groups by `group:…`. Changing grouping levels drops only `group:`
overrides. `expansionChanged { target, id, expanded }` reports every change.

API: `setExpanded(id, open)`, `toggleExpanded(id)`, `isExpanded(id)`, `expandAll(options?)`, `collapseAll()`,
`setDetailOpen(rowId, open)`, `isDetailOpen(rowId)`. Works for groups and tree rows alike.

### Sticky metadata

Flatten emits `stickyCandidates` in row order (pre-order): `{ index, lastDescendantIndex, level }[]`. The
render-window walk keeps its early break and binary search, which are then correct.

### Selection

Core computes, for every group and tree parent, `all | some | none` over its descendants (all of them, collapsed
or not). `selectDescendants` makes selecting a group or tree parent select its rows. The header checkbox and the
hierarchy cell checkbox both read this; neither computes it.

Implemented in phase 1: a `HierarchyIndex` built lazily per pipeline run (data row ids in pre-order plus a
`[start, end)` slice per group / tree parent, O(rows) memory) backs `getDescendantRowIds(id)`,
`getDescendantSelection(id) → { state, selected, total }` (cached per selection state) and
`setDescendantsSelected(id, selected)`. Descendants include collapsed and off-page rows and exclude filtered-out
ones. The `selectDescendants` cascade (selecting the group or tree-parent row itself) lands with phase 6.

## Rendering

### Group display

- **`column`** (default): one auto hierarchy column shows every level (indent, chevron, key, count). Group rows
  are cell rows: the hierarchy cell plus one aggregate cell per aggregated column. Total rows likewise.
- **`columns`**: one hierarchy column per grouping level, each showing its own level.
- **`row`**: a full-width group row drawn by `grouping.rowRenderer: RowRendererSpec`, for fully custom designs.

Tree data always uses the hierarchy column, showing `treeData.column`.

### Hierarchy column

A real column (`colId: '__hierarchy__'`, pinned left by default, resizable, sortable by group key, filterable by
key). Its cell is a built-in DOM renderer in core — no React per row — made of parts:

`indent | toggle | checkbox | icon | label | count`

`HierarchyColumnConfig` sets header, width, pinning, `indentPerLevel`, which parts show, `label(ctx)` (default:
the group key or tree column value through that column's formatter), `count(ctx)`, `icon(ctx)`, and part class
names. Or replace the whole cell with `renderer: ColumnRendererSpec`; the renderer receives
`HierarchyCellParams { row, hierarchy, label, aggregates, toggle(), setSelected(), selection }`.

Implemented (phases 2–3): the column is `__hierarchy__` in `state.columns` (one index space, like the row-select
column), kept in sync by `withHierarchyColumnFor` on every full column-list write and by the grouping / tree /
`hierarchyColumn` commands in the same commit, with the pinned count adjusted; the pinned lane follows
`state.pinnedColumns`. The cell is written directly by the binder (`renderer/hierarchyCell.ts`: parts created once
per cell, then diffed) on every bind path — full, scroll, repaint — so a recycled row never shows another row's
label. Toggle and checkbox clicks are delegated at the viewport. Implemented config: `header`, `width`, `minWidth`,
`pinned`, `indentPerLevel`, `show.{toggle, checkbox, count}`, `label(ctx)`, `count(ctx)`, `cellClass`; tree rows
show `treeData.column`. Still to come: the whole-cell `renderer` override and `icon`.

### Aggregate cells

Implemented (phase 3): group and total rows bind like loading rows — real cells in every lane, no portal — via
`bindAllHierarchyRowCells`; aggregate text goes through `valueFormatter`, else the renderer's text impostor. A
cell that showed an aggregate is flagged so the next data bind clears that text (renderer cells keep text as
their scroll-time placeholder). Still to come: `aggregateRenderer` and `display: 'columns'`.

In group and total rows, a column's cell shows `aggregates[colId]` through the column's `valueFormatter`, or
through `ColumnDef.aggregateRenderer?: ColumnRendererSpec` when the column wants something else (a sparkline, a
badge). Columns without an aggregate are empty. These are ordinary cells: pinned lanes, scroll presentations,
selection, copy and style rules all apply.

### Full-width rows

`RowRendererSpec = { kind: 'dom'; renderer: DomRowRenderer } | { kind: 'react'; component }`, mirroring cell specs.
`DomRowRenderer.mount(container, params) → { update(params), destroy() }`. Used by detail rows, `row` display
groups and failed/placeholder rows.

The content container is **viewport-width and horizontally fixed** (`position: sticky; left: 0;
width: var(--og-viewport-width)`), so it stays in view during horizontal scroll. Full-width rows are few per
frame, so they render during scroll (a DOM renderer in-frame; a React one mounted in-frame for newly entering
rows, bounded by the existing live-mount budget) instead of waiting for scroll to end. `detail.height: 'auto'`
measures content with a ResizeObserver and feeds row heights through the existing batched height path.

Implemented (phase 4): `RowRendererSpec` on `detail.renderer` and `grouping.rowRenderer`. DOM specs are mounted by
`FullWidthRowRenderer` directly (synchronous, `update` when the same row changes, `destroy` on release), React specs
travel with the adapter mount. The row host is `position: sticky; left: 0; width: var(--og-viewport-width)` (the
variable is set on the rows and sticky layers from the scrollport width). During scroll, adapter row mounts run in
the frame up to `rendererOptions.fullWidth.maxMountsPerScrollFrame` (default 4); the rest settle after scroll.
`detail.height: 'auto'`: the host sizes to content, one ResizeObserver batches measurements into the auto row-height
commit under the detail visual id (starting from `estimatedHeight`), and geometry prefers the recorded height.

### Sticky group headers

Built from the corrected `stickyCandidates`. Sticky rows render through the same path as the row they copy (cells
for `column` / `columns`, the row renderer for `row`), so they carry the hierarchy cell pinned left and aggregate
cells that scroll horizontally with the content. The layer is compositor-positioned (`position: sticky`); script
only moves a header when the next group pushes it.

Implemented (phase 5): in `column` display each sticky header is a real `RowSlot` bound by the body's
`bindAllHierarchyRowCells` (hierarchy cell in the pinned-left lane, aggregates scrolling with the content), never a
portal and never deferred. The layer is `position: sticky`; a header's offset inside it changes only when the stack
changes or the next group pushes it. `display: 'row'` keeps the adapter's full-width renderer.

## Behaviour

- **Focus and keyboard:** group and total rows are cell rows, so their cells are focusable like data cells.
  Detail rows take row focus; Enter moves into a nested grid. On the hierarchy cell: ArrowRight expands (or moves
  to the first child), ArrowLeft collapses (or moves to the parent), Enter/Space toggles.
- **ARIA:** `role="treegrid"` whenever a hierarchy exists; rows get `aria-level`, `aria-expanded` (when they have
  children), `aria-posinset` and `aria-setsize`.
- **Copy and export:** ranges that include group and total rows copy their cells (hierarchy label, formatted
  aggregates). CSV export gains `includeGroups`, `includeTotals` and renders the hierarchy column as indented text
  or a path.
- **Repaint:** group and total rows are invalidated when their aggregates change, like data cells. (Phase 1: the
  refresh diff reports `aggregateChangedIndices` for rows that kept their place but changed aggregates, and an
  aggregate-only write invalidates just those rows — no blanket viewport. Until group and total rows are cell rows
  (phase 3), a row-range repaint goes through the viewport sync, where only portals whose rows changed re-render.)

## Against AG Grid

| AG Grid                                                                | v2                                                                          |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `groupDisplayType` singleColumn / multipleColumns / groupRows / custom | `display` column / columns / row, plus a custom hierarchy cell renderer     |
| `autoGroupColumnDef`                                                   | `hierarchyColumn`: same idea, with named parts instead of one renderer      |
| `groupTotalRow`, `grandTotalRow`                                       | `totals.groups` (per level, top or bottom), `totals.grand`                  |
| Tree data via `getDataPath` / parent id, auto group column             | `treeData` with the same hierarchy column                                   |
| `groupDefaultExpanded` (number)                                        | `defaultExpanded`: boolean, levels, or a predicate, and still collapsible   |
| `groupSelectsChildren`                                                 | `selectDescendants`, tri-state computed in core for groups and tree parents |
| `masterDetail`, `detailCellRenderer`, `detailRowAutoHeight`            | `detail` with `isMaster`, `height: 'auto'`, DOM or React renderer           |
| Full-width rows spanning pinned containers                             | Viewport-width, horizontally fixed full-width content                       |

Beyond AG Grid: tree parents aggregate their subtree; groups sort by the sorted column's aggregate; group and total
cells use the fast DOM cell path with no framework work per row; nested sticky headers with pinned lanes on the
compositor; the whole hierarchy behaviour works without React.

## Out of scope for v2

Server-side hierarchy (splicing child stores into the visual list) is a separate workstream: it depends on the
server-side row model, not on rendering.

## Phases

1. **Model** — `grouping` / `treeData` / `aggregation` / `detail` config; `hierarchy` on every row; totals;
   expansion overrides; `stickyCandidates` in row order; tree-parent aggregates; selection state; aggregate
   invalidation.
2. **Hierarchy column** — auto column, built-in DOM cell with parts, keyboard toggle.
3. **Group and total cell rows** — aggregate cells, `aggregateRenderer`, `columns` display.
4. **Full-width contract** — `RowRendererSpec`, viewport-width fixed container, in-frame rendering, auto height.
5. **Sticky headers** — through the shared paths, compositor-positioned.
6. **Behaviour** — ARIA treegrid, focus on hierarchy rows, selection cascade, copy and CSV.
7. **React API, docs, examples** — React specs, docs rewritten, migration notes, every example and demo moved.
8. **Acceptance** — Live Grouping painted-frame probe (no blank rows, nested sticky headers correct, labels fixed
   during horizontal scroll), bench, gauntlet.
