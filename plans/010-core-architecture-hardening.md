# Plan 010: Core Architecture Hardening

> **Executor instructions**: Execute in phases, in order. Each phase has hard done criteria and a verification block. Do not merge phases. Remove dead code continuously. No backward-compatible shims — fix it properly.
>
> **Drift check (run first)**: `git diff --stat HEAD -- packages/core/src packages/react/src`
>
> If any in-scope file changed since this plan was written, compare current code against phase targets before proceeding.

## Status

- **Priority**: P0 / P1
- **Effort**: XL
- **Risk**: HIGH (phases 2–4 touch hot paths)
- **Depends on**: Plan 009 phases 1–6 (complete ✅)
- **Category**: correctness, performance, architecture
- **Planned at**: 2026-06-12
- **Progress**: Phases 0–5 complete ✅

## Problem statement

Six structural deficiencies that compound as the grid approaches enterprise complexity:

1. **Global `dataVersion` dirty bit** — one counter for the entire dataset. Any mutation thaws all frozen portals. A 1000-row grid with 10 updates/second = 10,000 unnecessary cell re-renders/second.

2. **`GridState` is a god object** — 75+ fields in one flat interface mixing user config, runtime state, derived state, and transient UI. No separation means: (a) every subscriber re-evaluates on any change, (b) you can't tell which fields to persist, (c) incremental rendering is impossible.

3. **`rowRenderer.ts` is 1851 lines** — normal rows, pinned rows, cell binding, keyboard nav, selection painting, portals, drag-and-drop, column lanes all in one class. Every new feature degrades the already-complex binding loop.

4. **Cell editing has no async lifecycle** — `EditModel` is fire-and-forget. No `valueSetter`, no `valueValidator`, no rollback on server rejection. Unusable for real data-entry workflows.

5. **No column state persistence API** — no `getColumnState()`/`applyColumnState()` in core. Column order, widths, groupBy, sort/filter, expansion — all lost on page reload. Every app re-implements this by hand.

6. **Client/server row models share zero pipeline code** — every pipeline feature (grouping, tree, aggregation, formula) is wired only to the client model. Server model is a dead end.

## Architecture targets

### Per-row version map (replaces `dataVersion`)

```ts
// Before (store.ts)
dataVersion: number; // global increment

// After
rowVersions: Map<string, number>; // rowId -> version, incremented per row
globalVersion: number; // for non-row changes (column, sort, filter)
```

Cell freeze check becomes: `cellSlot.lastRowVersion === rowVersions.get(rowId)` instead of `cellSlot.lastMountedDataVersion === dataVersion`.

### `GridState` split into three interfaces

```ts
// Persisted, user-configured — serialize this to localStorage / server
export interface GridModelState<TRowData> {
	columns: ColumnDef<TRowData>[];
	sortModel: SortModel | null;
	filterModel: FilterModel | null;
	groupBy?: string[];
	aggDefs?: AggregationDef<TRowData>[];
	pinnedColumns?: { left: number; right: number };
	columnWidths: Record<string, number>;
	columnOrder?: string[]; // NEW — explicit column order for persistence
	expansion: ExpansionState;
	selectedRowIds: string[];
	rowHeights: Record<string, number>;
}

// Derived, ephemeral — never persist this
export interface GridRuntimeState<TRowData> {
	rowVersions: Map<string, number>; // replaces dataVersion
	globalVersion: number;
	selection: GridSelectionState;
	visibleRowRange: ViewportRange;
	visibleColRange: ViewportRange;
}

// Transient UI — session-only, possibly persist per preference
export interface GridUIState {
	loading?: boolean;
	loadingSkeletonCount?: number;
	activeEdit: GridCellPointer | null;
	sidebarOpenPanel?: string | null;
	chartOpen?: boolean;
}
```

`GridState` becomes `GridModelState & GridRuntimeState & GridUIState` for backward compat during migration; eventually the three are accessed as separate slices.

### `rowRenderer.ts` decomposition

Extract into focused files:

```
packages/core/src/renderer/
  rowRenderer.ts           — thin coordinator (~300 lines)
  cellRenderer.ts          — cell binding, full vs cheap-scroll path
  keyboardNavManager.ts    — focus, arrow keys, tab, page up/down
  selectionPaintManager.ts — row/cell highlight, ARIA selection attributes
```

Each extracted class receives a `GridEngine` reference and a callback to request a render frame. `RowRenderer` delegates to them.

### Cell editing lifecycle

```ts
// columnDef.ts additions
interface ColumnDef<TRowData> {
	valueValidator?: (params: ValueValidatorParams<TRowData>) => string | null | Promise<string | null>;
	valueSetter?: (params: ValueSetterParams<TRowData>) => boolean | Promise<boolean>;
}

interface ValueValidatorParams<TRowData> {
	value: unknown;
	oldValue: unknown;
	row: TRowData;
	colField: string;
	api: GridApi<TRowData>;
}

interface ValueSetterParams<TRowData> extends ValueValidatorParams<TRowData> {
	abort: () => void; // call to roll back
}
```

`EditModel` becomes async: validate → if valid, call `valueSetter` → if `valueSetter` rejects, restore old value and surface error.

### Column state persistence API

```ts
// store.ts / GridApi
export interface ColumnState {
  field: string;
  width?: number;
  hidden?: boolean;
  pinned?: 'left' | 'right' | null;
  sort?: 'asc' | 'desc' | null;
  sortIndex?: number;
  filterValue?: unknown;
  groupIndex?: number;      // position in groupBy array (-1 = not grouped)
}

// GridApi additions
getColumnState(): ColumnState[];
applyColumnState(state: ColumnState[], options?: { applyOrder?: boolean }): void;
getGridState(): SerializableGridState;        // everything needed for full restore
applyGridState(state: SerializableGridState): void;
```

`SerializableGridState` contains `ColumnState[]`, `groupBy`, `expansion.groups`, `sortModel`, `filterModel`, `selectedRowIds` — the fields from `GridModelState` that are user-configured.

---

## Execution phases

### Phase 1: Per-row version map

Replace `state.dataVersion: number` with `state.rowVersions: Map<string, number>` and `state.globalVersion: number`.

**Scope:**

- `packages/core/src/store.ts` — `GridState.dataVersion` → `rowVersions` + `globalVersion`
- `packages/core/src/rowModel.ts` — `setRows`/`updateRows`/transactions increment per-row versions
- `packages/core/src/renderer/rowRenderer.ts` — cell freeze check reads per-row version
- `packages/core/src/renderer/scrollRenderContext.ts` — passes per-row version map through context
- `packages/core/src/renderer/renderEngine.ts` — propagates versions through scroll context
- All tests that reference `dataVersion`

**Implementation details:**

`GlobalStore.setState` still increments `globalVersion` (was `dataVersion`) for non-row changes (column updates, sort, filter). Row mutations (`applyRowTransaction`, `setRows`, `updateRows`) increment `rowVersions.get(rowId)` for each changed row.

The freeze check in `rowRenderer.ts:1393` becomes:

```ts
const rowVersion = ctx.rowVersions.get(visualRow.rowId) ?? 0;
const isDataStale = !isRowRebind && canFreezePortal && cellSlot.lastRowVersion !== -1 && cellSlot.lastRowVersion !== rowVersion;
```

Group rows and loading skeletons that have no `rowId` continue to use `globalVersion`.

**Done criteria:**

- `state.dataVersion` is removed (TypeScript build confirms no references)
- Updating one row only re-renders cells for that row, not all visible cells
- All existing cell render tests pass
- New perf test: 1000 rows, update 1 row, assert `bindCellFull` called for ≤ (columns in 1 row) cells

**Verification:**

```sh
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
```

---

### Phase 2: `GridState` split — model vs runtime vs UI

Split the `GridState` god object into `GridModelState`, `GridRuntimeState`, and `GridUIState`. Maintain `GridState = GridModelState & GridRuntimeState & GridUIState` as a transitional union so callers don't break immediately.

**Scope:**

- `packages/core/src/store.ts` — define three interfaces, keep union type
- `packages/core/src/engine/GridEngine.ts` — update `handleStateChanges` to use slice awareness
- No changes to callers in this phase — the union type preserves API compat

**Phase 2 only does the type split. No behavior change.**

The value is: once the interfaces are separate, Phase 5 (persistence API) can directly serialize `GridModelState`, and future incremental-render work can subscribe to specific slices instead of the whole bag.

**Done criteria:**

- `GridModelState`, `GridRuntimeState`, `GridUIState` interfaces defined and exported
- `GridState = GridModelState & GridRuntimeState & GridUIState` still compiles
- TypeScript confirms all existing code compiles
- No runtime behavior changes — all tests pass unchanged

**Verification:**

```sh
corepack pnpm --filter @eregister/open-grid-core build
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react build
corepack pnpm --filter @eregister/open-grid-react test
```

---

### Phase 3: Decompose `rowRenderer.ts`

Extract three focused classes out of `rowRenderer.ts`. `RowRenderer` becomes a thin coordinator.

**Target file sizes:**

- `rowRenderer.ts` → ≤ 400 lines (coordinator only)
- `cellRenderer.ts` → cell binding (full + cheap-scroll paths), currently ~600 lines in rowRenderer
- `keyboardNavManager.ts` → focus, arrow keys, tab, page up/down, currently ~200 lines in rowRenderer
- `selectionPaintManager.ts` → row/cell highlight, selection class application, currently ~100 lines in rowRenderer

**Extraction strategy:**

1. Start with `KeyboardNavManager` — it has the clearest boundary (only reads state, only calls `engine.selectRange` and `element.focus()`).
2. Then `SelectionPaintManager` — reads `state.selection.bounds` and `state.selectedRowIds`, writes class names.
3. Then `CellRenderer` — the largest extraction. Receives `ScrollRenderContext`, `PortalMountManager`, and the `engine`. Returns a `CellBindResult`.

**Interface between RowRenderer and CellRenderer:**

```ts
export class CellRenderer<TRowData> {
	constructor(engine: GridEngine<TRowData>, portalManager: PortalMountManager);
	bindCell(slot: CellSlot, cell: HeaderCellLayout, ctx: ScrollRenderContext<TRowData>, isRowRebind: boolean): void;
	bindCellCheap(slot: CellSlot, cell: HeaderCellLayout, ctx: ScrollRenderContext<TRowData>): void;
}
```

**Done criteria:**

- `rowRenderer.ts` ≤ 400 lines
- `cellRenderer.ts`, `keyboardNavManager.ts`, `selectionPaintManager.ts` created
- No behavior changes — all render engine, portal, and keyboard tests pass
- No public API surface changes

**Verification:**

```sh
corepack pnpm --filter @eregister/open-grid-core exec vitest run src/renderer/renderEngine.test.ts
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
```

---

### Phase 4: Async cell editing lifecycle

Add `valueValidator` and `valueSetter` to `ColumnDef`. Make `EditModel` await them before committing.

**Scope:**

- `packages/core/src/columnDef.ts` — add `valueValidator`, `valueSetter` fields
- `packages/core/src/models/EditModel.ts` — make commit async, call validator then setter
- `packages/core/src/store.ts` / `packages/core/src/engine/GridEngine.ts` — `setCellValue` becomes async or accepts a callback
- `packages/react/src/GridPortal.tsx` — cell editors call async commit, show validation error state

**`EditModel` commit flow:**

```
commitEdit(value) →
  1. call valueValidator(params) → if returns string, surface error, do not commit
  2. optimistically update local row data (show new value immediately)
  3. call valueSetter(params) → if returns false/throws, revert optimistic update, surface error
  4. emit cellValueChanged event
```

Error surface: `activeEdit` gains an optional `validationError: string | null` field. The cell editor wrapper in `GridPortal.tsx` reads it and renders it below the input.

**Done criteria:**

- `ColumnDef.valueValidator` and `ColumnDef.valueSetter` exist and are typed
- Sync validators work (return `string | null` directly)
- Async validators work (return `Promise<string | null>`)
- Optimistic update + rollback works: `valueSetter` returns false → old value is restored
- Existing edit tests pass
- New tests: sync validation rejection, async validation rejection, async valueSetter rollback

**Verification:**

```sh
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
```

---

### Phase 5: Column state persistence API

Add `getColumnState()`, `applyColumnState()`, `getGridState()`, and `applyGridState()` to the public `GridApi`.

**Scope:**

- `packages/core/src/store.ts` — `ColumnState`, `SerializableGridState` interfaces
- `packages/core/src/engine/GridEngine.ts` — implement `getColumnState`, `applyColumnState`, `getGridState`, `applyGridState`
- `packages/react/src/OpenGrid.tsx` / public API surface — expose through `GridApi`
- `packages/core/src/models/ColumnModel.ts` — `applyColumnState` needs to update column order (reorder displayed columns array)

**`ColumnState` interface:**

```ts
export interface ColumnState {
	field: string;
	width?: number;
	hidden?: boolean;
	pinned?: 'left' | 'right' | null;
}

export interface SerializableGridState {
	columns: ColumnState[];
	columnOrder: string[]; // ordered array of field names
	sortModel: SortModel | null;
	filterModel: FilterModel | null;
	groupBy: string[];
	expansion: {
		groups: string[]; // array of expanded groupIds (not Record<string,true>)
	};
	pinnedColumns: { left: number; right: number };
}
```

**`applyGridState` behavior:**

1. Reorder `state.columns` to match `columnOrder`
2. Apply widths from `columns[].width`
3. Apply `pinnedColumns` (pin counts, not per-column pin flags)
4. Apply `sortModel`, `filterModel`, `groupBy`
5. Reconstruct `expansion.groups` from the expanded groupIds array

**Done criteria:**

- `api.getColumnState()` returns serializable column metadata
- `api.applyColumnState(state)` restores column widths, order, and pinning
- `api.getGridState()` returns JSON-serializable object covering sort, filter, groupBy, expansion, column layout
- `api.applyGridState(state)` fully restores a grid from that serialized object
- Round-trip test: `applyGridState(getGridState())` leaves grid state identical
- `columnOrder` survives drag-reorder → serialize → applyGridState

**Verification:**

```sh
corepack pnpm --filter @eregister/open-grid-core test
corepack pnpm --filter @eregister/open-grid-react test
```

---

## Test strategy

### Phase 1 (per-row versions)

- Benchmark: `renderEngine.test.ts` — update 1 row in 1000-row grid, assert only that row's cells are re-rendered
- Correctness: update row A, freeze check for row B still passes; update row B, freeze check for row B fails

### Phase 2 (GridState split)

- Type-level: `tsc --noEmit` must pass. No runtime tests beyond existing suite.

### Phase 3 (rowRenderer decomposition)

- Regression: all existing `renderEngine.test.ts`, `headerPopover.test.ts`, keyboard navigation tests
- Line count assertion in test: `rowRenderer.ts` must be ≤ 400 lines (or CI check)

### Phase 4 (async editing)

- Unit tests for `EditModel`: sync validator blocks commit, async validator blocks commit, `valueSetter` false → rollback, `valueSetter` throws → rollback
- Integration: editor renders validation error state when validator fails

### Phase 5 (persistence)

- Round-trip: getGridState → JSON.stringify → JSON.parse → applyGridState → getGridState → deep equal
- Partial apply: `applyColumnState` with only widths does not change sort/filter
- Column order: drag-reorder → serialize → fresh store → applyGridState → columns in correct order

---

## Commands

| Purpose     | Command                                                   | Expected |
| ----------- | --------------------------------------------------------- | -------- |
| Core build  | `corepack pnpm --filter @eregister/open-grid-core build`  | exit 0   |
| Core tests  | `corepack pnpm --filter @eregister/open-grid-core test`   | exit 0   |
| React build | `corepack pnpm --filter @eregister/open-grid-react build` | exit 0   |
| React tests | `corepack pnpm --filter @eregister/open-grid-react test`  | exit 0   |
| Demo build  | `corepack pnpm --filter demo-app build`                   | exit 0   |
| Type check  | `corepack pnpm exec tsc --noEmit`                         | exit 0   |

## Scope

In scope:

- `packages/core/src/store.ts`
- `packages/core/src/engine/GridEngine.ts`
- `packages/core/src/models/EditModel.ts`
- `packages/core/src/models/SelectionModel.ts`
- `packages/core/src/models/ColumnModel.ts`
- `packages/core/src/renderer/rowRenderer.ts`
- `packages/core/src/renderer/renderEngine.ts`
- `packages/core/src/renderer/scrollRenderContext.ts`
- `packages/core/src/columnDef.ts`
- `packages/react/src/GridPortal.tsx`
- `packages/react/src/OpenGrid.tsx`

Out of scope for this plan:

- ARIA / accessibility (warrants its own plan — needs grid role model, not just label attributes)
- Server row model pipeline unification (separate plan — requires RowModelAdapter interface design)
- Formula engine integration with server rows
- Undo/redo for selection changes

## Review checklist

Reject implementations that:

- Keep a single `dataVersion` counter shared across all rows
- Add fields to `GridState` without assigning them to one of the three state slices
- Make `rowRenderer.ts` longer as part of any phase
- Implement `valueSetter` as fire-and-forget without await
- Implement `getColumnState()` only in the React layer (must be in core)
- Serialize `expansion.groups` as a `Record<string, true>` (use a plain string array — JSON-friendlier)

## STOP conditions

- Phase 1: per-row version map causes visible frame-rate regression in benchmark → investigate Map lookup cost vs array approach
- Phase 3: extracting `CellRenderer` requires touching `PortalMountManager` internals in ways that affect React portal lifecycle → scope `CellRenderer` to DOM-only cells first; portal binding stays in `RowRenderer` until a separate portal extraction plan
- Phase 4: `valueSetter` async introduces race conditions in rapid-edit scenarios (user edits cell A before cell B's `valueSetter` resolves) → queue commits per-cell, not per-grid

## Maintenance notes

Once this plan lands, the rule is: new state goes into the correct slice (`GridModelState`, `GridRuntimeState`, or `GridUIState`). Anything that touches a row must increment `rowVersions.get(rowId)`. Any renderer that needs a cell value reads the per-row version, not `globalVersion`.
