# 001 — Row Multi-Select

**Commit:** `3d32692`  
**Package manager:** pnpm  
**Build:** `pnpm -F @eregister/wit-grid-core build`  
**Test:** `pnpm -F @eregister/wit-grid-core test`  
**Typecheck:** `pnpm -F @eregister/wit-grid-core typecheck` (or `tsc --noEmit` from `packages/core`)

---

## Why it matters

Wit Grid currently has only cell-range selection (anchor → focus rectangle). There is no way to select arbitrary rows for bulk operations. Users expect checkboxes and `Ctrl/Cmd+Click` to check rows independently of the cell cursor.

---

## What already exists (do NOT re-implement)

- Cell range selection (`GridSelectionState.focus / anchor / range / bounds`) — leave untouched.
- `api.rows().getSelected()` and `api.rows().getSelectedIds()` — these return rows inside the cell-range bounds. Leave them untouched; we add separate `getChecked()` / `getCheckedIds()` methods alongside them.
- `invalidation.invalidateRow(rowId, reason)` — already exists in `GridEngine`.
- CSS class `.og-row-selected` — means "row is in the cell selection range". Leave it alone.

---

## Files in scope

| File                                        | Change                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/store.ts`                | Add `selectedRowIds` to `GridState`, default init, `GridRowsAccessor` interface additions, new `GridApi` methods, `GridStore` implementations                                        |
| `packages/core/src/engine/GridEngine.ts`    | Add `applyRowSelection()` private method, public `selectRowIds`, `deselectRowIds`, `toggleRowId`, `selectAllDataRows`, `clearRowSelection` methods, wire `rowSelectionChanged` event |
| `packages/core/src/columnDef.ts`            | Add `checkboxSelection?: boolean` to `ColumnDef`                                                                                                                                     |
| `packages/core/src/renderer/rowRenderer.ts` | Apply `.og-row-node-selected` class; render checkbox cell for checkbox columns; render select-all checkbox in header                                                                 |
| `packages/core/src/renderer/styles.ts`      | Add `.og-row-node-selected` CSS                                                                                                                                                      |
| `packages/core/src/navigation.ts`           | Intercept `Ctrl/Cmd+Click` in `handleMouseDown` to toggle row selection                                                                                                              |

**Out of scope:**

- `packages/react/` — the React package auto-exposes new API methods through existing hooks; no changes needed.
- `SelectionModel.ts` — row node selection lives in `GridState`, not `GridSelectionState`; `SelectionModel` is not touched.
- `serverRowModel.ts` — server-side "select all" is complex; skip it (clear selection instead).

---

## Step-by-step implementation

### Step 1 — Add `selectedRowIds` to `GridState`

**File:** `packages/core/src/store.ts`

**1a. Add field to `GridState` interface** (around line 268, after the `selection` field):

```typescript
// Row-level multi-select (independent of cell range selection)
selectedRowIds: string[];
```

**1b. Initialize in `GridStore` constructor** (around line 608–643, inside the `new GridEngine<TRowData>({...})` call — but `GridEngine` takes an `Partial<GridState>`, so you also need to add the default at the point where `initialState` values are applied):

Find the block starting at line 606:

```typescript
constructor(initialState: Partial<GridState<TRowData>> = {}) {
    validateColumns(initialState.columns || []);
    this.engine = new GridEngine<TRowData>({
        columns: initialState.columns || [],
        selection: initialState.selection,
        ...
```

Add alongside the other `initialState.xxx || default` entries:

```typescript
selectedRowIds: initialState.selectedRowIds ?? [],
```

**Verification:** `pnpm -F @eregister/wit-grid-core typecheck` should pass with no new errors.

---

### Step 2 — Add row selection methods to `GridEngine`

**File:** `packages/core/src/engine/GridEngine.ts`

Add a private helper and five public methods. Place them near the existing selection methods (search for `applySelectionRange` to find the right region).

```typescript
// ── Row node selection ─────────────────────────────────────────────────────

private applyRowSelection(
    op: 'select' | 'deselect' | 'toggle' | 'selectAll' | 'clear',
    rowIds?: string[]
): void {
    const current = this.stateManager.getState();
    const currentSet = new Set(current.selectedRowIds);
    let newIds: string[];

    switch (op) {
        case 'select': {
            const toAdd = rowIds ?? [];
            toAdd.forEach(id => currentSet.add(id));
            newIds = [...currentSet];
            break;
        }
        case 'deselect': {
            const toRemove = new Set(rowIds ?? []);
            newIds = current.selectedRowIds.filter(id => !toRemove.has(id));
            break;
        }
        case 'toggle': {
            const id = rowIds?.[0];
            if (!id) return;
            if (currentSet.has(id)) currentSet.delete(id);
            else currentSet.add(id);
            newIds = [...currentSet];
            break;
        }
        case 'selectAll': {
            // Collect all data row IDs from the active row model
            const allIds: string[] = [];
            this.rowModel?.forEach?.((node) => allIds.push(node.id));
            newIds = allIds;
            break;
        }
        case 'clear': {
            newIds = [];
            break;
        }
    }

    const prevSet = new Set(current.selectedRowIds);
    const changed = newIds
        .filter(id => !prevSet.has(id))
        .concat(current.selectedRowIds.filter(id => !new Set(newIds).has(id)));

    this.stateManager.setState({ selectedRowIds: newIds });
    changed.forEach(id => this.invalidation.invalidateRow(id, 'row selection'));
    this.eventBus.dispatchEvent('rowSelectionChanged', {
        selectedRowIds: newIds,
        changedRowIds: changed,
    });
    this.requestRender('row selection');
}

public selectRowIds(rowIds: string[]): void {
    this.applyRowSelection('select', rowIds);
}

public deselectRowIds(rowIds: string[]): void {
    this.applyRowSelection('deselect', rowIds);
}

public toggleRowId(rowId: string): void {
    this.applyRowSelection('toggle', [rowId]);
}

public selectAllDataRows(): void {
    this.applyRowSelection('selectAll');
}

public clearRowSelection(): void {
    this.applyRowSelection('clear');
}
```

**Note on `this.rowModel`:** Look for how `this.rowModel` or equivalent is referenced in `GridEngine.ts` (search for `rowModel` property). The row model should have a `forEach` method or equivalent to iterate all nodes. If the property name differs (e.g., `this.rows`, `this.clientRowModel`), adjust accordingly. The key is to iterate all data RowNodes and collect their `.id` fields. If no clean iteration method exists, use `this.stateManager.getState()` and get row IDs from the viewport rows accessor — look for how `applyTransaction` or `setData` iterates rows and follow that pattern.

**Verification:** `pnpm -F @eregister/wit-grid-core typecheck`

---

### Step 3 — Expose new methods on `GridApi` in `store.ts`

**File:** `packages/core/src/store.ts`

**3a. Extend `GridApi` interface** (around line 446). Add after `extendSelection`:

```typescript
// Row node multi-select
selectRows(rowIds: string[]): void;
deselectRows(rowIds: string[]): void;
toggleRowSelection(rowId: string): void;
selectAllRows(): void;
clearRowSelection(): void;
isRowNodeSelected(rowId: string): boolean;
```

**3b. Extend `GridRowsAccessor` interface** (around line 345). Add after `getSelectedIds()`:

```typescript
/** Get data rows that have been row-selected (checkbox/Ctrl+Click) */
getChecked(): TRowData[];
/** Get IDs of row-selected rows */
getCheckedIds(): string[];
```

**3c. Implement in `GridStore` class.** Find where `selectCell`, `selectRange`, `extendSelection` are implemented (search for `public selectCell`). Add alongside them:

```typescript
public selectRows = (rowIds: string[]): void => {
    this.engine.selectRowIds(rowIds);
};

public deselectRows = (rowIds: string[]): void => {
    this.engine.deselectRowIds(rowIds);
};

public toggleRowSelection = (rowId: string): void => {
    this.engine.toggleRowId(rowId);
};

public selectAllRows = (): void => {
    this.engine.selectAllDataRows();
};

public clearRowSelection = (): void => {
    this.engine.clearRowSelection();
};

public isRowNodeSelected = (rowId: string): boolean => {
    return this.state.selectedRowIds.includes(rowId);
};
```

**3d. Implement `getChecked` and `getCheckedIds` in the `rows()` accessor.** Find the `rows()` method that returns the `GridRowsAccessor` implementation (lines ~980–1078). Inside that returned object, add:

```typescript
getChecked: (): TRowData[] => {
    const checkedSet = new Set(this.state.selectedRowIds);
    const result: TRowData[] = [];
    this.engine.rowModel?.forEach?.((node) => {
        if (checkedSet.has(node.id)) result.push(node.data);
    });
    return result;
},
getCheckedIds: (): string[] => {
    return [...this.state.selectedRowIds];
},
```

**Verification:** `pnpm -F @eregister/wit-grid-core typecheck`

---

### Step 4 — Add `checkboxSelection` to `ColumnDef`

**File:** `packages/core/src/columnDef.ts`

Find the `ColumnDef` interface (it has fields like `field`, `header`, `width`, `renderer`). Add:

```typescript
/** When true, renders a checkbox in this column for row multi-select */
checkboxSelection?: boolean;
```

---

### Step 5 — Render `.og-row-node-selected` CSS class

**File:** `packages/core/src/renderer/rowRenderer.ts`

Find where `.og-row-selected` is applied (search for `og-row-selected`). Near that code, read the `rowId` (already available in the row render context) and check if it's in `selectedRowIds`.

You need access to `state.selectedRowIds` as a `Set` for O(1) lookup. Look for how `state` or `engine.stateManager.getState()` is accessed in the renderer. Then:

```typescript
// Near where og-row-selected is applied, also apply og-row-node-selected:
const isNodeSelected = selectedRowIdsSet.has(rowId); // build Set once per render pass
if (isNodeSelected) {
	rowEl.classList.add('og-row-node-selected');
} else {
	rowEl.classList.remove('og-row-node-selected');
}
```

The `selectedRowIdsSet` should be built once at the start of each render pass (not per-cell) from `state.selectedRowIds` to avoid O(n) per row. Look for where the render pass starts and build it there.

**File:** `packages/core/src/renderer/styles.ts`

Find where `.og-row-selected` is defined (search for `og-row-selected`). Add a similar rule:

```css
.og-row-node-selected {
	background-color: var(--og-row-selected-bg, rgba(59, 130, 246, 0.08));
}
.og-row-node-selected .og-cell {
	background-color: inherit;
}
```

Match the existing style pattern (CSS-in-JS template string or similar format used in that file).

---

### Step 6 — Render checkbox cells

**File:** `packages/core/src/renderer/rowRenderer.ts`

When rendering a cell whose column has `checkboxSelection: true`, render a checkbox input instead of the normal cell content.

Find where cells are rendered for data rows. The renderer reads `col.renderer` to decide how to paint the cell. For checkbox columns:

```typescript
if (colDef.checkboxSelection) {
	// Create or reuse a checkbox input element
	let checkbox = cellEl.querySelector<HTMLInputElement>('input[type="checkbox"].og-row-checkbox');
	if (!checkbox) {
		checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'og-row-checkbox';
		checkbox.style.cssText = 'pointer-events:auto;cursor:pointer;margin:0';
		checkbox.addEventListener('change', (e) => {
			e.stopPropagation();
			// Access the engine via closure or the engine reference available in the renderer
			engine.toggleRowId(rowId);
		});
		cellEl.innerHTML = '';
		cellEl.appendChild(checkbox);
	}
	checkbox.checked = selectedRowIdsSet.has(rowId);
	return; // skip normal cell rendering
}
```

The `engine` reference is available in the renderer — find how other DOM mutations call back to the engine (search for `engine.` in the renderer file) and follow that pattern.

---

### Step 7 — Render select-all checkbox in column header

**File:** `packages/core/src/renderer/headerRenderer.ts` (or `packages/core/src/renderer/rowRenderer.ts` — headers may be in either file)

Find where header cells are rendered. For a column with `checkboxSelection: true`:

```typescript
if (colDef.checkboxSelection) {
    let checkbox = headerCellEl.querySelector<HTMLInputElement>('input[type="checkbox"].og-header-checkbox');
    if (!checkbox) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'og-header-checkbox';
        checkbox.style.cssText = 'pointer-events:auto;cursor:pointer;margin:0';
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            if ((e.target as HTMLInputElement).checked) {
                engine.selectAllDataRows();
            } else {
                engine.clearRowSelection();
            }
        });
        headerCellEl.innerHTML = '';
        headerCellEl.appendChild(checkbox);
    }
    // Compute checked/indeterminate state
    const totalDataRows = /* get total data row count from engine or rowModel */;
    const selectedCount = engine.stateManager.getState().selectedRowIds.length;
    checkbox.checked = selectedCount > 0 && selectedCount >= totalDataRows;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < totalDataRows;
    return;
}
```

For `totalDataRows`: look for how the row renderer or header renderer accesses the row count. In `GridEngine` there may be a `getRowCount()` or you can use `this.rowModel.getRowCount()`.

---

### Step 8 — Ctrl/Cmd+Click toggles row in navigation

**File:** `packages/core/src/navigation.ts`

In `handleMouseDown` (line 356), at the very top after the `event.button !== 0` check, add:

```typescript
// Ctrl/Cmd+Click: toggle row selection without moving cell focus
if (event.ctrlKey || event.metaKey) {
	this.store.toggleRowSelection(rowId);
	return; // do not move cell focus
}
```

This intercepts the modifier-click before any cell focus logic runs, so the cell cursor stays in place while the row checkbox state toggles.

**Verification:** `pnpm -F @eregister/wit-grid-core typecheck`

---

### Step 9 — Export new public types

**File:** `packages/core/src/store.ts`

Confirm `GridRowsAccessor` (with the new methods) and the new `GridApi` methods are exported. They are already part of the exported interfaces so no additional export lines should be needed. However, verify the public `index.ts` re-exports `GridApi` and `GridRowsAccessor`:

**File:** `packages/core/src/index.ts`

Search for `GridApi` and `GridRowsAccessor` exports. If either is missing, add:

```typescript
export type { GridRowsAccessor } from './store.js';
```

---

### Step 10 — Tests

**File:** `packages/core/src/store.test.ts` (1000+ lines — follow existing patterns)

Test pattern (from existing tests):

```typescript
const store = new GridStore<TestRow>({ columns: [...], getRowId: (r) => r.id });
const controller = new ClientRowModelController(store, { rows: [...], columns: [...] });
store.updateVisibleRanges(); // if needed
```

Add a `describe('row multi-select', () => {` block with the following tests:

1. **selectRows adds to selectedRowIds**

    ```typescript
    store.selectRows(['row-1', 'row-2']);
    expect(store.getState().selectedRowIds).toEqual(['row-1', 'row-2']);
    ```

2. **deselectRows removes from selectedRowIds**

    ```typescript
    store.selectRows(['row-1', 'row-2']);
    store.deselectRows(['row-1']);
    expect(store.getState().selectedRowIds).toEqual(['row-2']);
    ```

3. **toggleRowSelection adds when not selected**

    ```typescript
    store.toggleRowSelection('row-1');
    expect(store.getState().selectedRowIds).toContain('row-1');
    ```

4. **toggleRowSelection removes when already selected**

    ```typescript
    store.selectRows(['row-1']);
    store.toggleRowSelection('row-1');
    expect(store.getState().selectedRowIds).not.toContain('row-1');
    ```

5. **clearRowSelection empties the list**

    ```typescript
    store.selectRows(['row-1', 'row-2']);
    store.clearRowSelection();
    expect(store.getState().selectedRowIds).toEqual([]);
    ```

6. **isRowNodeSelected returns correct boolean**

    ```typescript
    store.selectRows(['row-1']);
    expect(store.isRowNodeSelected('row-1')).toBe(true);
    expect(store.isRowNodeSelected('row-2')).toBe(false);
    ```

7. **getCheckedIds returns selected row IDs**

    ```typescript
    store.selectRows(['row-1']);
    expect(store.rows().getCheckedIds()).toEqual(['row-1']);
    ```

8. **getChecked returns selected row data**

    ```typescript
    store.selectRows(['row-1']);
    const checked = store.rows().getChecked();
    expect(checked).toHaveLength(1);
    expect(checked[0]).toMatchObject({ id: 'row-1' });
    ```

9. **rowSelectionChanged event fires on toggle**

    ```typescript
    const handler = vi.fn();
    store.addEventListener('rowSelectionChanged', handler);
    store.toggleRowSelection('row-1');
    expect(handler).toHaveBeenCalledWith(
    	expect.objectContaining({
    		payload: expect.objectContaining({ selectedRowIds: ['row-1'], changedRowIds: ['row-1'] }),
    	})
    );
    ```

10. **selectRows is idempotent** (selecting already-selected row does not duplicate)
    ```typescript
    store.selectRows(['row-1']);
    store.selectRows(['row-1']);
    expect(store.getState().selectedRowIds).toEqual(['row-1']);
    ```

**Run tests:** `pnpm -F @eregister/wit-grid-core test`

---

## Done criteria

All of the following must pass:

```bash
# Typecheck
pnpm -F @eregister/wit-grid-core typecheck

# Tests (all existing + new row multi-select tests pass)
pnpm -F @eregister/wit-grid-core test

# Build succeeds
pnpm -F @eregister/wit-grid-core build
```

Additionally verify manually:

- `store.getState().selectedRowIds` exists and is `[]` by default on a fresh grid
- `store.selectRows(['x'])` → `store.getState().selectedRowIds === ['x']`
- `store.toggleRowSelection('x')` twice → back to `[]`

---

## Escape hatches

- **`this.rowModel` does not have a `forEach` method:** Search `GridEngine.ts` for how `applyTransaction` iterates rows and use the same accessor. If no direct iteration is available, use `this.stateManager.getState()` and find an accessor that exposes all row IDs (check `this.rows` property or any row store).
- **`rowRenderer.ts` does not have a single "render cell" function:** Look for where `og-cell-selected` class is applied — that is where per-cell rendering decisions are made.
- **Header renderer is in a different file than expected:** Search codebase for `og-header-cell` to find the correct file.
- **`checkbox.checked` causes re-render loops:** Only set `checkbox.checked` when the value actually differs from the current DOM value (add a guard: `if (checkbox.checked !== newVal) checkbox.checked = newVal`).
- **Ctrl+Click causes cell focus to move despite early return:** Ensure the `return` statement is before any `this.store.selectCell(...)` call.

---

## Maintenance note

`selectedRowIds` is part of `GridState` and is included in the persistence adapter serialization automatically (if the user uses the persistence feature). If a user saves grid state with selected rows and restores it, the rows will still appear selected even if the data has changed. This is acceptable behavior — clearing selection on `setRows` is a future concern.
