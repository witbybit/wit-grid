# Plan 063: Row Drag-and-Drop

> Row drag-and-drop allows users to reorder rows by dragging a handle. It is required for task management, priority queuing, kanban-adjacent grids, and any UI where row order has semantic meaning. AG Grid has three drag modes: managed (grid reorders automatically), unmanaged (custom drop handler), and drag-to-external (drag rows to another element). This plan implements managed in-grid reorder and unmanaged external-drop. It intentionally excludes tree-node re-parenting (too complex for this plan).

## Status

- **Priority**: P2 — enables task management / reorder use cases, independent of filter/export work
- **Effort**: L
- **Risk**: MEDIUM — drag state interacts with row virtualization, scroll-during-drag, and the row pipeline; must not corrupt row order
- **Depends on**: nothing
- **Category**: feature, interaction, UX
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## What to add

### Column definition

```ts
// columnDef.ts

export interface ColumnDef<TRowData = unknown> {
	// ...

	/**
	 * Show a drag handle in this column's cells. Dragging the handle initiates row drag.
	 * Typically used on the first column.
	 */
	rowDrag?: boolean | ((params: { rowData: TRowData; rowId: string }) => boolean);
}
```

### GridOptions (GridState)

```ts
// GridState.ts

/**
 * 'managed': grid automatically reorders rows when dropped.
 * 'unmanaged': grid does not reorder; use onRowDragEnd to handle drop yourself.
 * Default: 'managed' when rowDrag is set on any column.
 */
rowDragMode?: 'managed' | 'unmanaged';

/**
 * Allow dragging rows outside the grid to an external drop target.
 * Default: false.
 */
rowDragEntireRow?: boolean;
```

### GridApi events

```ts
// GridEvents.ts

'rowDragStart': {
  rowId: string;
  rowData: unknown;
  rowIndex: number;
  event: DragEvent;
}

'rowDragMove': {
  rowId: string;
  overRowId: string | null; // row currently hovered
  overRowIndex: number | null;
  event: DragEvent;
}

'rowDragEnd': {
  rowId: string;
  overRowId: string | null;
  overRowIndex: number | null;
  event: DragEvent;
}

'rowDragCancelled': {
  rowId: string;
  event: DragEvent;
}

'rowOrderChanged': {
  rowIds: string[]; // new full row order (managed mode only)
}
```

### GridApi methods

```ts
// GridApi.ts

/**
 * Get the current row order as an array of row IDs.
 * Only meaningful when managed row drag has been used to reorder rows.
 */
getRowOrder(): string[];

/**
 * Set row order programmatically. All provided IDs must exist.
 */
setRowOrder(rowIds: string[]): void;
```

## Architecture

### RowDragController (new)

```ts
// packages/core/src/features/RowDragController.ts
```

Owned by the feature layer. Responsible for:

1. Tracking drag state: which row is being dragged, which row is the drop target
2. In managed mode: computing the new row order and calling `store.setRowOrder()`
3. Firing all row drag events
4. Managing the drag ghost element (a clone of the dragged row with reduced opacity)

### Drag handle in row rendering

When `column.rowDrag === true`, `cellRenderer.ts` renders a drag handle icon (⠿ gripper) in that cell. The handle has `draggable="true"`. Drag events are attached to the handle element.

The handle is only shown when the row is hovered (`hover-drag-handle` CSS class via row renderer), keeping the UI clean.

### Scroll during drag

When the user drags near the top or bottom edge of the grid viewport (within 40px), the grid auto-scrolls. The scroll rate increases the closer to the edge. This is handled in `RowDragController` via a `requestAnimationFrame` loop that runs while the drag is active.

### Drop indicator

A 2px horizontal line shows between rows at the current drop position. It tracks the `dragover` event. Rendered by the overlay renderer as a simple absolutely-positioned div.

### Managed reorder

In managed mode, `rowDragEnd` triggers:

1. Remove dragged row from its current position
2. Insert before the drop target row
3. Call `store.applyTransaction({ update: [] })` — no, this changes data. Instead: `store.setRowOrder(newOrder)` which reorders the underlying data array in `RowDataStore` and triggers a pipeline refresh.

`setRowOrder()` is a new method on `RowDataStore` that reindexes rows without mutating their data.

### Unmanaged mode

In unmanaged mode, the grid fires `rowDragEnd` but does not reorder. The application handles the drop in `onRowDragEnd`. The drag ghost and drop indicator still appear (can be suppressed via option).

### Drag-to-external

When `rowDragEntireRow` is true, entire rows are draggable (not just the handle). The `DragEvent.dataTransfer` is populated with:

- `text/plain`: formatted row values as TSV
- `application/json`: raw row data as JSON string

An external drop zone (outside the grid) receives `DragEvent` and can read row data from `dataTransfer`.

## Phases

### Phase 1 — Column def + drag handle rendering

- Add `rowDrag` to `ColumnDef`
- Render drag handle icon in `cellRenderer.ts` when `rowDrag` is true
- Show handle on row hover only (CSS hover class on row slot)
- No drag behavior yet — just the visual

### Phase 2 — `RowDragController` + drag state

- New file: `packages/core/src/features/RowDragController.ts`
- `dragstart`, `dragover`, `dragend`, `dragcancel` handlers
- Fire `rowDragStart`, `rowDragMove`, `rowDragEnd`, `rowDragCancelled` events
- Drop indicator line via overlay renderer

### Phase 3 — Managed reorder

- `setRowOrder()` on `RowDataStore`
- `applyRowOrder()` in `GridApi.ts`
- In managed mode, `rowDragEnd` calls `setRowOrder` and fires `rowOrderChanged`
- Unit tests: drag row 3 before row 1 → correct order; drag to same position → no-op

### Phase 4 — Auto-scroll during drag

- Edge detection (40px from top/bottom viewport edge)
- `requestAnimationFrame` scroll loop during drag
- Scroll rate proportional to edge proximity

### Phase 5 — Unmanaged mode + external drag

- `rowDragMode: 'unmanaged'` — events fire, grid does not reorder
- `rowDragEntireRow`: whole row draggable, `dataTransfer` populated
- `getRowOrder()`, `setRowOrder()` on GridApi

### Phase 6 — Tests

```ts
it('drag row 5 to position 2 reorders correctly', ...);
it('drag to same position is a no-op', ...);
it('unmanaged mode fires events but does not reorder', ...);
it('rowDragCancelled fires on Escape', ...);
it('rowDrag=false hides handle for that column', ...);
```

### Phase 7 — Demo

- New demo page `RowDragDemo.tsx`
- Managed mode: drag to reorder a task list
- Unmanaged mode with external drop zone: drag row to a "trash" zone

## STOP conditions

- Do not implement tree-node re-parenting (drag row into a group to change its parent) — too complex for this plan.
- Do not implement multi-row drag (dragging a selection of rows simultaneously) in this plan.
- Do not support drag-and-drop between two separate grid instances in this plan.
- Do not reorder rows in server-side row model in this plan — managed reorder is client-row-model only.

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build
```

Dragging a row reorders it in managed mode. Drop indicator appears at correct position. Auto-scroll activates near viewport edges. `rowOrderChanged` event fires with correct new order. Escape key cancels drag and restores original order.
