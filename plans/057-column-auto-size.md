# Plan 057: Column Auto-Size

> Auto-size fits a column's width to its content by measuring the rendered text. It is a high-visibility DX feature — every spreadsheet and data grid in the market has it. The implementation measures a hidden scratch canvas (no DOM reflow), respects `minWidth`/`maxWidth`, and optionally includes the header label in the measurement.

## Status

- **Priority**: P1 — high-visibility DX, self-contained
- **Effort**: M
- **Risk**: MEDIUM — column width changes trigger geometry repaint; must not cause visible jank
- **Depends on**: 056 (valueFormatter) for correct formatted value measurement
- **Category**: feature, column model, UX
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## What to add

### GridApi methods

```ts
// GridApi.ts

/**
 * Resize column to fit its content width.
 * @param colId - Field name or column index
 * @param options.includeHeader - Include header label in measurement (default: true)
 * @param options.maxRows - Maximum rows to sample (default: 500, cap to avoid perf cliff)
 */
autoSizeColumn(colId: string, options?: AutoSizeColumnOptions): void;

/**
 * Resize all visible columns to fit their content.
 * @param options.skipPinned - Skip pinned columns (default: false)
 */
autoSizeAllColumns(options?: AutoSizeAllColumnsOptions): void;

export interface AutoSizeColumnOptions {
  includeHeader?: boolean; // default true
  maxRows?: number;        // default 500
  padding?: number;        // extra px per side, default 8
}

export interface AutoSizeAllColumnsOptions extends AutoSizeColumnOptions {
  skipPinned?: boolean;    // default false
}
```

### Measurement approach

Use an **offscreen `<canvas>` with `measureText()`** — no DOM insertion, no reflow, O(N) over sampled rows.

```ts
// packages/core/src/features/ColumnAutoSizeController.ts (new file)

function measureTextWidth(ctx: CanvasRenderingContext2D, text: string): number {
	return ctx.measureText(text).width;
}

export function computeAutoSizeWidth(
	ctx: CanvasRenderingContext2D,
	colDef: InternalColumnDef,
	rows: VisualRow[],
	options: ResolvedAutoSizeOptions
): number {
	let max = 0;

	if (options.includeHeader) {
		max = measureTextWidth(ctx, colDef.header ?? colDef.field);
	}

	const sample = rows.slice(0, options.maxRows);
	for (const row of sample) {
		if (row.kind !== 'data') continue;
		const raw = getCellRawValue(row.rowData, colDef);
		const text = getFormattedCellValue(raw, colDef, row.rowData, row.rowId);
		const w = measureTextWidth(ctx, text);
		if (w > max) max = w;
	}

	return Math.min(Math.max(max + options.padding * 2, colDef.minWidth ?? 40), colDef.maxWidth ?? 2000);
}
```

The canvas font must match the grid's computed cell font. Read it from the active theme token (`--og-cell-font-size` + `--og-cell-font-family`) once per auto-size call.

### ColumnFeatureController integration

Add `autoSizeColumn(colId, options)` to `ColumnFeatureController`. It:

1. Gets the canvas context (creates a 1×1 canvas once, cached on controller)
2. Sets the font from theme
3. Reads all visual rows from the row model
4. Calls `computeAutoSizeWidth`
5. Calls `store.setColumnWidth(colId, width)` which triggers the normal geometry repaint

`autoSizeAllColumns` iterates over `store.getDisplayedColumns()` and calls `autoSizeColumn` for each. Batch the width changes into a single geometry repaint using the existing `batchCellValues` pattern.

## Phases

### Phase 1 — `ColumnAutoSizeController` + measurement logic

- New file: `packages/core/src/features/ColumnAutoSizeController.ts`
- `computeAutoSizeWidth()` function with canvas measurement
- Unit tests: verify measurement respects `minWidth`, `maxWidth`, `padding`, `includeHeader`

### Phase 2 — `GridApi` surface

- Add `autoSizeColumn()` and `autoSizeAllColumns()` to `GridApi.ts`
- Wire through `store.ts`, `createGrid.ts`, `createGridPluginRuntime.ts`
- `ColumnFeatureController` delegates to `ColumnAutoSizeController`

### Phase 3 — Theme font extraction

- Read cell font from active theme tokens at auto-size time
- Fallback to `14px sans-serif` if theme is not mounted
- Cache the `CanvasRenderingContext2D` on the controller (one per grid instance)

### Phase 4 — Demo integration

- Add "Auto-Size Columns" button to the WideGridDemo toolbar
- Add to the main data grid demo (BasicDemo or ColumnGroupHeaderDemo once Plan 054 ships)
- Double-click on column resize handle → auto-size that column (wire to the column interaction controller's double-click event)

### Phase 5 — Tests

```ts
it('autoSizeColumn sets width to longest cell value', () => { ... });
it('autoSizeColumn respects minWidth', () => { ... });
it('autoSizeColumn respects maxWidth', () => { ... });
it('autoSizeAllColumns skips hidden columns', () => { ... });
it('autoSizeColumn uses valueFormatter output for measurement', () => { ... });
```

## STOP conditions

- Do not measure by inserting hidden DOM elements — canvas measureText is sufficient and avoids reflow.
- Do not auto-size on every scroll — only on explicit API call or double-click of resize handle.
- Do not sample more than `maxRows` rows (default 500) — 100k-row grids would be unusably slow.
- Do not auto-size group columns in this plan (they have variable content based on group label).

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build && pnpm -F @eregister/wit-grid-react test
```

`autoSizeColumn('price')` on a price column with `valueFormatter: v => '$' + v.toFixed(2)` produces a width wider than the raw number string. Double-click on resize handle fires auto-size. No DOM reflow jank.
