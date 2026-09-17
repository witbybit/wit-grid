# Plan 009: Rendering layout architecture for AG Grid-level grouping, sticky grouping, and column grouping

> **Executor instructions**: This is an architectural umbrella plan, not a single small patch. Execute it in phases. Do not skip characterization tests. Do not add more grouping/sticky/header features on top of the current ad hoc layout offsets before completing Phase 1.
>
> **Drift check (run first)**: `git diff --stat 78e8122..HEAD -- packages/core/src/renderer packages/core/src/rows packages/core/src/rowModel.ts packages/core/src/store.ts packages/react/src/GridPortal.tsx packages/react/src/OpenGrid.tsx packages/react/src/sidebar`
>
> If any in-scope file changed since this plan was written, compare the current code against the architecture targets below before proceeding. If the current code already implements a phase, mark that phase done in this file and continue with the next phase.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: none, but should precede deeper column grouping and sticky grouping feature work
- **Category**: architecture, correctness, rendering robustness
- **Planned at**: commit `78e8122`, 2026-06-12
- **Progress**: Phases 1–5 complete. `GridLayoutPlan` owns top chrome, content dimensions, pinned widths, layout origins, header-band projection, sticky group stack, and the active render window. Sticky group rows render through `StickyGroupRenderer` / `.og-layer-sticky-groups`. `RowPipeline` now computes `GroupRowMeta` (rich per-group metadata: child range, leaf indices, visible descendant rowIds, child group IDs, parent link) and exposes it via `ClientRowModelController.getGroupMeta`/`getGroupMetaByVisualIndex`. `GridPortal.tsx` `DefaultGroupRowRenderer` uses `getGroupMeta` instead of the old O(n) visual-row scan. `HeaderRenderer` renders from `HeaderBandLayout[]` — both leaf and group bands, multi-level supported. `ColumnDef.headerGroup?: string | string[]` is the public column grouping API. Dynamic header height is driven by `totalHeaderHeight` from the layout plan; `--og-total-header-height` CSS variable is set by `viewportRenderer.syncLayoutPlan`. Dead code removed throughout all phases. Phase 6 (remove remaining legacy shortcuts) is in progress.

## Vision

Open Grid should support advanced enterprise-grid behavior with the same kind of predictability users expect from AG Grid:

- Row grouping and nested grouping behave consistently while sorting, filtering, expanding, collapsing, virtualizing, and selecting.
- Sticky group rows never jitter, freeze, overlap headers, fight row virtualization, or lose pinned-column alignment.
- Column grouping/header bands support nested groups, pinning, resizing, reordering, sorting, filtering, and future aggregation controls without special-case header code.
- Overlays, range selection, focus rings, fill handles, pinned rows, pinned columns, group panel, headers, sticky groups, and normal rows all agree on the same coordinate system.
- Rendering performance remains predictable because scroll-frame work is planned by stable layout data, not scattered DOM reads or duplicated geometry decisions.

The core design principle is:

```text
State -> Row/Column Models -> Layout Plan -> Render Plan -> Layer Renderers
```

Renderers should consume an already-computed layout contract. They should not independently invent offsets, z-indexes, sticky positions, header heights, or overlay origins.

## Problem statement

The current renderer has proven that the grid can be fast, but advanced layout features are now sharing too many conditionals:

- `packages/core/src/renderer/renderWindow.ts` computes visible ranges and sticky group stack metadata.
- `packages/core/src/renderer/rowRenderer.ts` renders normal rows, full-width rows, pinned rows, sticky group rows, checkbox selection, style hooks, scroll-frame skips, portal lifecycle, and pinned-column lane cells.
- `packages/core/src/renderer/viewportRenderer.ts` owns DOM layer creation, group panel visibility, header top offset, overlay top offset, spacer sizes, and header layer widths.
- `packages/core/src/renderer/headerRenderer.ts` renders leaf headers and special checkbox headers, but future column grouping will need multi-row header bands.
- `packages/core/src/renderer/overlayRenderer.ts` assumes a content origin that must match the header/group-panel stack.
- `packages/react/src/GridPortal.tsx` renders group/detail/footer portals and currently has to infer visible group descendants for group-selection UX.

This makes each new feature a cross-file patch. Sticky grouping in particular becomes fragile because a virtualized row slot is also acting as a sticky row, while normal row recycling, z-index, pin lanes, and full-width portals continue to operate on it.

## Target architecture

### 1. First-class `GridLayoutPlan`

Create a layout-plan module that is the only source of truth for structural geometry.

Suggested file:

- `packages/core/src/renderer/layoutPlan.ts`

Suggested public/internal types:

```ts
export interface GridLayoutPlan {
	viewport: {
		width: number;
		height: number;
		scrollTop: number;
		scrollLeft: number;
	};
	dimensions: {
		totalRowsHeight: number;
		totalColumnsWidth: number;
		contentWidth: number;
		contentHeight: number;
	};
	chrome: {
		groupPanelHeight: number;
		columnGroupHeaderHeight: number;
		leafHeaderHeight: number;
		totalHeaderHeight: number;
		topChromeHeight: number;
	};
	rows: {
		rowStart: number;
		rowEnd: number;
		pinnedTopCount: number;
		pinnedBottomCount: number;
		pinnedTopHeight: number;
		pinnedBottomHeight: number;
		visibleTop: number;
		visibleBottom: number;
		bufferTopPx: number;
		bufferBottomPx: number;
	};
	columns: {
		colStart: number;
		colEnd: number;
		pinLeftCount: number;
		pinRightCount: number;
		pinLeftWidth: number;
		pinRightWidth: number;
		centerWidth: number;
	};
	origins: {
		headerTop: number;
		rowLayerTop: number;
		stickyGroupLayerTop: number;
		overlayTop: number;
	};
	stickyGroups: StickyGroupLayoutItem[];
	headerBands: HeaderBandLayout[];
}
```

This type can evolve, but all renderers should converge on consuming it instead of recomputing layout locally.

### 2. Dedicated layer model

Formalize DOM layers and their responsibilities:

```text
.og-scroll-viewport
  .og-layer-group-panel
  .og-layer-header-bands
    .og-layer-header-band[data-depth="0"]
    .og-layer-header-band[data-depth="1"]
    .og-layer-header-leaf
  .og-layer-sticky-groups
  .og-rows-container
  .og-layer-pinned-top-rows
  .og-layer-pinned-bottom-rows

.og-layer-overlay
```

Important rules:

- Normal data/group/detail/footer rows remain in the normal row layer at their natural positions.
- Sticky group rows render in `.og-layer-sticky-groups`, not as ordinary row slots with special position logic.
- Column group headers render in header bands, not as special cases inside the current leaf header renderer.
- Overlay origin is derived from the layout plan, not hard-coded CSS or local arithmetic.

### 3. Sticky group rows as a separate renderer

Introduce a dedicated sticky group renderer.

Suggested file:

- `packages/core/src/renderer/stickyGroupRenderer.ts`

Responsibilities:

- Render only the sticky group stack from `GridLayoutPlan.stickyGroups`.
- Reuse the same group row portal rendering path where possible, but mount it into sticky-layer hosts.
- Align sticky rows with pinned-left, center, and pinned-right columns.
- Support nested stack depth and boundary push-off without relying on row slot recycling.
- Avoid duplicating normal group row state. The natural group row remains in `rowsContainer`.

This removes sticky group lifecycle from `RowRenderer`.

### 4. Header bands for future column grouping

Create a header layout tree that supports both current leaf headers and future grouped headers.

Suggested files:

- `packages/core/src/columns/headerTree.ts`
- `packages/core/src/renderer/headerLayout.ts`
- `packages/core/src/renderer/headerBandRenderer.ts`

Column definition shape can be introduced later, but the renderer architecture should support:

```ts
export interface HeaderCellLayout {
	id: string;
	depth: number;
	colStart: number;
	colEnd: number;
	left: number;
	width: number;
	height: number;
	top: number;
	pinned: 'left' | 'center' | 'right';
	isLeaf: boolean;
	label: string;
	resizable: boolean;
	movable: boolean;
}

export interface HeaderBandLayout {
	depth: number;
	top: number;
	height: number;
	cells: HeaderCellLayout[];
}
```

The current `HeaderRenderer` can become the leaf-band renderer first. Column grouping can then add parent bands without rewriting the whole header stack again.

### 5. First-class group metadata

Extend the row pipeline output so renderers and React portals do not scan visual rows to understand group descendants.

Suggested model:

```ts
export interface GroupRowMeta {
	groupId: string;
	visualIndex: number;
	depth: number;
	parentGroupId: string | null;
	firstChildIndex: number;
	lastChildIndex: number;
	firstLeafIndex: number;
	lastLeafIndex: number;
	descendantRowIds: string[];
	visibleDescendantRowIds: string[];
	childGroupIds: string[];
	leafCount: number;
	childCount: number;
	expanded: boolean;
	aggregateValues?: Record<string, unknown>;
}
```

Expose this through `RowModel`, for example:

```ts
getGroupMeta?(groupId: string): GroupRowMeta | null;
getGroupMetaByVisualIndex?(visualIndex: number): GroupRowMeta | null;
```

Consumers:

- sticky group renderer
- group row selection
- group footers
- aggregation displays
- future group path/breadcrumb UI

## Execution phases

### Phase 0: Characterization baseline

Before refactoring layout, add tests that capture current behavior and desired invariants.

Add/extend tests in:

- `packages/core/src/renderer/renderWindow.test.ts`
- `packages/core/src/renderer/viewportRenderer.test.ts` if a suitable test harness exists, otherwise create one
- `packages/core/src/rows/stages/flattenStage.test.ts`
- `packages/react/src/index.test.tsx` for group row selection and header/group renderer behavior

Required coverage:

- Group panel visible shifts header and overlay by the same top chrome height.
- Sticky group stack top changes as `scrollTop` changes.
- Sticky group stack push-off changes before a group subtree boundary.
- Nested sticky groups stack by depth.
- Pinned top rows and sticky groups do not share the same pixel origin.
- Checkbox selection range does not select group/footer/detail/loading rows.
- Group row selection selects visible data descendants only until first non-descendant row.
- Header rendering continues to work with no column groups.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
```

Expected result: exit 0.

### Phase 1: Introduce `GridLayoutPlan` without changing DOM structure

Add `layoutPlan.ts` and compute the same values currently scattered across renderers.

Migration targets:

- `renderWindow.ts` should either produce row/column range parts used by `GridLayoutPlan`, or be absorbed behind `computeGridLayoutPlan`.
- `viewportRenderer.ts` should read group panel/header/overlay offsets from the plan.
- `overlayRenderer.ts` should consume `layoutPlan.origins.overlayTop` or equivalent.
- `rowRenderer.ts` should consume sticky group positions from the plan, even before sticky groups move to a separate layer.

Rules:

- No behavior changes beyond replacing duplicated calculations with plan reads.
- Remove hard-coded chrome heights such as `40`, `42`, and `82` from renderers where they represent header/group-panel structure.
- Keep old renderers operational.

Done criteria:

- `GridLayoutPlan` exists and is used by viewport/header/overlay/row rendering paths.
- Header/group panel/overlay offsets come from one plan.
- Existing tests pass.
- New tests prove group-panel/header/overlay alignment.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react build
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm --filter demo-app build
```

### Phase 2: Split sticky group rendering into its own layer

Add a sticky group layer to `ViewportRenderer` and a `StickyGroupRenderer`.

Implementation outline:

1. `ViewportRenderer.mount` creates `.og-layer-sticky-groups`.
2. `GridLayoutPlan.stickyGroups` contains every sticky group with `top`, `height`, `depth`, `pushed`, `groupId`, and `visualIndex`.
3. `RowRenderer` stops rendering sticky group rows specially. It renders natural rows only.
4. `StickyGroupRenderer` mounts sticky row hosts keyed by `groupId`.
5. React portal manager receives sticky group row portal mounts separately from normal full-width row mounts, or the existing row portal store gains a lane/scope key.
6. Sticky group rows align with pinned lanes and center width from the layout plan.

Hard boundary:

- Do not delete natural group rows from the normal row layer.
- Do not make sticky rows mutate normal row slot identity.

Done criteria:

- Sticky group rows no longer depend on `RowSlot.isStickyGroup`.
- `RowRenderer` has no sticky-group z-index/depth/pushed class logic.
- Sticky group push-off is handled entirely by layout plan + sticky renderer.
- Nested sticky group demos scroll without row recycling artifacts.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/renderWindow.test.ts src/renderer/renderEngine.test.ts
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm --filter demo-app build
```

### Phase 3: Add row pipeline group metadata

Extend grouped pipeline stages so they produce stable metadata for each group.

Likely files:

- `packages/core/src/rows/stages/groupStage.ts`
- `packages/core/src/rows/stages/flattenStage.ts`
- `packages/core/src/rows/RowPipeline.ts`
- `packages/core/src/rowModel.ts`
- `packages/core/src/store.ts`

Implementation requirements:

- Metadata must be rebuilt on group/sort/filter/expansion refresh.
- Metadata must map `groupId -> GroupRowMeta`.
- Metadata must map `visualIndex -> GroupRowMeta` where appropriate.
- `visibleDescendantRowIds` must reflect the current expanded/filtered visual model.
- Tests must cover nested groups, collapsed groups, filtered groups, footers, and leaf groups.

Consumers to migrate:

- Default group row selection in `packages/react/src/GridPortal.tsx`.
- Sticky group boundary calculations in `renderWindow.ts` or the new layout plan.
- Group footer/aggregation display if practical.

Done criteria:

- No React renderer scans visual rows to find group descendants.
- Sticky grouping uses group metadata for boundaries.
- Group row selection uses `visibleDescendantRowIds`.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/rows/stages/groupStage.test.ts src/rows/stages/flattenStage.test.ts src/rowModel.test.ts
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
```

### Phase 4: Header band architecture

Introduce header bands while keeping current leaf header behavior.

Implementation outline:

1. Add a header tree model that converts column definitions into one or more header bands.
2. For the first migration, produce a single leaf band matching current behavior.
3. Move leaf header geometry into `HeaderCellLayout`.
4. Update `HeaderRenderer` to render a band layout instead of directly iterating displayed leaf columns.
5. Preserve checkbox header, sort indicator, menu button, resize handles, column reorder, and pinned header layers.

Done criteria:

- Current headers render from `HeaderBandLayout`.
- No public column grouping API is required yet.
- Existing header popover, sorting, resizing, and reordering tests pass.
- Layout plan includes total header height from header bands.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/headerPopover.test.ts src/renderer/renderEngine.test.ts
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm --filter demo-app build
```

### Phase 5: Column grouping API and renderer

Only after Phase 4, introduce public column grouping.

Possible `ColumnDef` extension:

```ts
export interface ColumnGroupDef<TRowData = unknown> {
	groupId: string;
	headerName: string;
	children: Array<ColumnGroupDef<TRowData> | ColumnDef<TRowData>>;
	marryChildren?: boolean;
	openByDefault?: boolean;
}
```

Or support a lighter first step:

```ts
interface ColumnDef {
	headerGroup?: string | string[];
}
```

Choose deliberately. Nested enterprise column grouping likely needs explicit group defs eventually.

Requirements:

- Pinned columns split groups correctly across left/center/right zones.
- Resizing a group distributes width or resizes child leaf columns according to a clear rule.
- Reordering respects group constraints when `marryChildren` is enabled.
- Header height grows with group depth.
- Overlay and row layer origins continue to come from `GridLayoutPlan`.

Done criteria:

- Column groups support at least two header levels.
- Leaf column features continue to work.
- Group header cells align exactly over child leaf columns.
- Pinning columns does not visually tear group headers.

Verification:

```sh
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
corepack pnpm --filter demo-app build
```

### Phase 6: Remove legacy layout shortcuts

After the new architecture is stable, remove compatibility paths and duplicated layout math.

Targets:

- Hard-coded header/group-panel/overlay heights.
- Sticky group flags on `RowSlot`.
- Sticky group row positioning in `RowRenderer`.
- Visual-row scans in React group row renderers.
- Header geometry loops that duplicate layout-plan output.

Done criteria:

- `RowRenderer` only renders normal row slots and cell lanes.
- Sticky rendering is isolated.
- Header rendering is band-based.
- Overlay positioning is plan-based.
- Tests document the major layout invariants.

## Test strategy

Add tests at three levels:

1. **Pure layout tests**
    - Given viewport, row model metadata, column plan, and chrome config, assert exact layout plan values.
    - These should be fast and deterministic.

2. **Renderer characterization tests**
    - Assert DOM layer existence, transform/top values, sticky group mount/unmount behavior, and header band alignment.

3. **React integration tests**
    - Assert group row selection, sticky group portal rendering, and column panel/header UI state.

The pure layout tests are the most important. AG Grid-level reliability comes from being able to prove geometry before the DOM gets involved.

## Commands you will need

| Purpose     | Command                                                   | Expected on success |
| ----------- | --------------------------------------------------------- | ------------------- |
| Core tests  | `corepack pnpm --filter @eregister/open-grid-core test`   | exit 0              |
| Core build  | `corepack pnpm --filter @eregister/open-grid-core build`  | exit 0              |
| React tests | `corepack pnpm --filter @eregister/open-grid-react test`  | exit 0              |
| React build | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0              |
| Demo build  | `corepack pnpm --filter demo-app build`                   | exit 0              |
| Formatting  | `corepack pnpm exec prettier --check <touched files>`     | exit 0              |

## Scope

In scope:

- `packages/core/src/renderer/*`
- `packages/core/src/rows/*`
- `packages/core/src/rowModel.ts`
- `packages/core/src/store.ts`
- `packages/core/src/columnDef.ts`
- `packages/core/src/models/ColumnModel.ts`
- `packages/react/src/GridPortal.tsx`
- `packages/react/src/OpenGrid.tsx`
- Demo pages that exercise grouping/sticky grouping/column grouping

Out of scope until later:

- Server-side enterprise grouping semantics beyond preserving current server model behavior.
- Pivot mode.
- Tree-data redesign unless it blocks group metadata.
- Large visual redesign of demo pages.
- New charting behavior.

## Review checklist

Reviewers should reject implementations that:

- Add new magic pixel constants for header/group-panel/overlay offsets.
- Make sticky group rows depend on normal row slot recycling.
- Implement column grouping directly inside the old leaf header loop.
- Add visual-row descendant scans in React renderers when group metadata is available.
- Change public behavior without characterization tests.
- Couple layout correctness to CSS-only sticky behavior where JS layout needs exact coordinates.

## STOP conditions

Stop and report instead of improvising if:

- Moving sticky groups to a separate layer requires a portal manager rewrite larger than expected.
- Existing full-width row portal lifecycle cannot support a second sticky lane without key collisions.
- Header band rendering breaks sort/menu/resize/reorder interactions in a way that cannot be isolated.
- Group metadata cannot preserve filtered/collapsed/expanded semantics cleanly.
- Server row model cannot provide enough information for the proposed metadata contract; define a reduced server contract instead of guessing.

## Maintenance notes

Once this architecture lands, new layout-affecting features must begin by extending `GridLayoutPlan` and its tests. Renderers should not independently calculate structural offsets.

Future features that should build on this plan:

- Column grouping.
- Sticky group row customization.
- Group selection cascade policies.
- Group footers pinned below sticky groups.
- Tree-data sticky parents.
- Header row auto-height.
- Pivot-like column group generation.
