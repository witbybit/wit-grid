# Plan 041: Client pagination as a core row-pipeline page-window

> **Executor instructions**: Pure-model first. Land the page-window in `RowPipeline` with exhaustive unit tests BEFORE wiring the bar or touching geometry. Do not slice in the renderer, the geometry layer, or the React adapter — slice once, in the pipeline, and let every derived map/meta/geometry fall out consistently. Keep server pagination untouched.
>
> Part of Plan 040 (north-star). **Prerequisite for Plan 042** (React pagination teardown).

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH (data-layer; index maps, geometry, sticky/group meta, selection all read the visual-row view)
- **Depends on**: Plan 039 Phase 5 (core pagination bar + `state.pagination`), Plan 011 (feature controllers)
- **Category**: data model, feature correctness, architecture
- **Planned at**: 2026-06-14
- **Status**: **DONE (2026-06-14, branch rendering-architecture-v2-wip-3)**. core 576/576, react 100/100, demo build clean.
    - Phase 1: `rows/pageModel.ts` `computePageWindow` + `pageModel.test.ts` (9).
    - Phase 2: `RowPipelineInput.pagination` + post-flatten/pre-index-map slice; `pageWindow` on output; `rebuildStickyGroupMeta` rebuilds page-relative sticky indices (faithful to flattenStage: last descendant before footer, via a depth-stack). `RowPipeline.pagination.test.ts` (8: flat/middle/partial/clamp/empty + page-relative maps + grouped sticky-meta bounds).
    - Phase 3: `ClientRowModelController.refresh()` passes `state.pagination`; subscribes to `paginationChanged` → refresh; `getPageWindow()` added to `RowModel`. Scroll-to-top on page change wired via `RenderInvalidationCoordinator` (`resetScroll` dep → `scrollEngine.scrollTo(0, scrollLeft)`).
    - Phase 4: `paginationBarRenderer.getModel()` reads `getPageWindow()` (authoritative post-filter/group total) with a local fallback.
    - Phase 5: `rowModel.pagination.test.ts` (4) — end-to-end: `getVisualRowCount()`/`getVisualRow()`/`getPageWindow()` reflect the page, proving geometry/window/sticky/selection see the sliced view (they read those). Cross-page semantics documented in `pageModel.ts`.
    - Server pagination untouched (this is the client controller path only).
    - **Unblocks Plan 042** (React pagination teardown — core now owns client slicing).

## Problem (the quoted gap)

> The core pagination bar (039 Phase 5) drives page state + the `paginationChanged` event, but **does not slice the rendered client rows**. Slicing must thread a page window through the row pipeline so the visual-row index maps, geometry, and group/sticky metadata all stay consistent. It has broad blast radius and undefined cross-page semantics under grouping/tree/detail.

Client slicing exists today only in the **wrong layer**: `Grid.tsx` slices `rows` before passing them to core (`packages/react/src/Grid.tsx:98-114`). This plan moves slicing into core so it composes with sort/filter/group/tree/detail and the core bar becomes truly functional. (After this lands, Plan 042 deletes the React slicing.)

## Why the pipeline is the only correct slice point

`pipeline.run()` returns `visualRows` **plus** every derived structure built from it: `visualRowIdToIndex`, `rowIdToVisualIndex`, `rowIdToVisualRowId`, `rowIdToVisualRowIds`, `stickyGroupMeta`, `groupMeta`, `groupMetaByVisualIndex`, `stats` (`rows/RowPipeline.ts:68-88,197-229`). Geometry then iterates `getVisualRowCount()`/`getVisualRow(i)` to build `rowTops` (`renderer/geometryController.ts:48-56`), and the render window, sticky stack, and selection all index `0..rowCount-1` as the visual view (`renderWindow.ts:297,368`; `RowSelectionFeatureController.ts:15`).

Therefore: if we slice `visualRows` to a page **after the final `flattenStage` and before the index-map build loop** (`RowPipeline.ts:177→197`), every map and meta is rebuilt from the sliced array in the existing loop, and **all downstream consumers see a consistent page-relative view for free**. Slicing anywhere downstream (geometry/renderer/React) forces dual global+page indexing and breaks the `0..rowCount` contiguity assumption — explicitly rejected.

## Target architecture

### A. `PageModel` — the page-window contract

A small pure module (`rows/pageModel.ts`) computing the slice bounds, with no DOM/state deps:

```ts
export interface PageWindow {
	page: number;
	pageSize: number;
	startIndex: number;
	endIndex: number;
	pageCount: number;
	totalRows: number;
}
export function computePageWindow(totalVisualRows: number, pageSize: number, page: number): PageWindow;
```

- `pageCount = max(1, ceil(total / pageSize))`; `page` clamped to `[0, pageCount-1]`.
- `startIndex = page*pageSize`, `endIndex = min(total, start+pageSize)`.
- Unit-tested independently (empty, single page, last partial page, out-of-range clamp).

### B. Page-window step in `RowPipeline`

Add an optional `pagination?: { pageSize: number; page: number }` to `RowPipelineInput`. After `flattenStage` produces the full `visualRows`:

1. Compute `PageWindow` over `visualRows.length` (this is the **post-group/post-filter** count — the user-visible total, which is the correct denominator).
2. If pagination active, `visualRows = visualRows.slice(startIndex, endIndex)` **before** the index-map/meta build loop, so all maps/`stickyGroupMeta`/`groupMeta`/`groupMetaByVisualIndex` are built page-relative.
3. Emit the window in `RowPipelineOutput` (e.g. `output.pageWindow`) so the controller/bar/event read one authoritative page math — no recompute in the renderer.

### C. Cross-page semantics (decide explicitly — review checklist enforces)

- **Grouping/tree**: pagination slices the **flattened visual rows** (AG-Grid behaviour: groups + their visible children are paginated together; a group spanning a page boundary simply continues on the next page). Document this; do **not** try to keep whole groups on one page in v1.
- **Sticky groups**: within a page, the sticky stack is computed from the page-relative `stickyGroupMeta` (already consistent because it's rebuilt post-slice). A group whose header is on the previous page does not stick on the current page in v1 — acceptable; note it.
- **Master-detail**: a detail row is adjacent to its parent in `visualRows`; if a page boundary splits them, the detail flows to the next page (same rule as groups). Acceptable in v1.
- **Selection**: selection is by `rowId` and persists across pages (rows on other pages are simply not rendered). Range/checkbox selection operates within the current page's visual rows. Document.
- **Empty/zero rows**: `pageCount` floors at 1; bar shows `0–0 of 0`.

### D. Controller + state wiring

- `ClientRowModelController.refresh()` passes `state.pagination` (when set) into `pipeline.run`. `getVisualRowCount()`/`getVisualRow()` then return the page view unchanged — geometry, render window, sticky, selection all work with no edits (the whole point).
- Page changes (`state.pagination.page`) must trigger a refresh (re-run pipeline with new window) + reset `scrollTop` to 0 + dispatch `paginationChanged` with `output.pageWindow`. Route this through a **feature controller** (e.g. extend `GroupingFeatureController` or add a small `PaginationFeatureController`) per Plan 011 — not ad-hoc in the renderer.
- The core `paginationBarRenderer` (039) stops computing its own totals and reads `output.pageWindow`/the controller; its existing buttons now drive real slicing.

### E. Server pagination is untouched

Server row model already paginates via block loading + `serverPagination` state (`createRowModelRuntimes.ts:67-70`). This plan only adds the **client** page-window. Guard: server path must not run the client slice.

## Execution phases

### Phase 0 — characterization

Capture current behavior: with no `pagination`, pipeline output and counts are unchanged. Add `rows/pageModel.test.ts` (pure). Verify core green.

### Phase 1 — `PageModel` (pure)

Add `rows/pageModel.ts` + tests. No wiring.

### Phase 2 — pipeline page-window

Thread `pagination` through `RowPipelineInput`; slice post-flatten/pre-maps; emit `pageWindow`. Tests in `RowPipeline`/`flattenStage` covering flat, grouped, tree, detail, last-partial-page, empty, and **map/meta consistency** (every map indexes only the sliced rows; `groupMetaByVisualIndex` keys are page-relative). No renderer change yet.

### Phase 3 — controller + refresh + scroll reset

`refresh()` consumes `state.pagination`; page change triggers refresh + `scrollTop=0` + event via a feature controller. Geometry/render-window/sticky/selection verified consistent (existing suites + new integration test: set pageSize, assert `getVisualRowCount()` == page size, `getVisualRow(0)` is the page's first row, `rowTops[0]==0`).

### Phase 4 — bar reads authoritative page math

`paginationBarRenderer` reads `pageWindow` from the model/controller; navigation slices for real. Status bar's "Rows" continues to show the **total** (pre-page) count; add a "Showing X–Y" if desired. Update `paginationBarRenderer.test.ts`.

### Phase 5 — guard + docs

Guard test: client slicing happens in the pipeline only (no slice in renderer/geometry). Document cross-page semantics (C) in the plan's "Decisions" and a short doc comment in `pageModel.ts`.

## Verification

```sh
corepack pnpm --filter @eregister/wit-grid-core exec vitest run src/rows
corepack pnpm --filter @eregister/wit-grid-core test
corepack pnpm --filter @eregister/wit-grid-react test
corepack pnpm --filter demo-app build
```

## Scope

In: `packages/core/src/rows/*`, `rowModel.ts`, a pagination feature controller, `renderer/paginationBarRenderer.ts` (+ status bar count source). Out: server pagination semantics; React layer (that's Plan 042); whole-group-per-page packing; pivot.

## Review checklist — reject if it:

- Slices rows anywhere except the single pipeline page-window step.
- Leaves any index map / `groupMeta` / `stickyGroupMeta` indexed against the unsliced array.
- Recomputes page math in the renderer instead of reading `pageWindow`.
- Forgets to reset `scrollTop` on page change.
- Changes server pagination behavior.
- Ships without explicit, documented cross-page semantics for grouping/tree/detail/selection.

## STOP conditions

- If the flatten stage cannot expose a clean post-flatten hook without entangling sticky-meta construction, build the slice as a dedicated final stage (`pageStage`) that takes the flattened rows + meta and returns the windowed set + rebuilt meta, rather than inlining into `RowPipeline.run`.
- If grouped pagination produces confusing UX (e.g. a lone child with no visible parent header), record the finding and propose v2 "sticky parent on paginated pages" rather than improvising.
