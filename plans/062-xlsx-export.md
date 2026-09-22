# Plan 062: XLSX Export

> CSV export is already present. This plan adds XLSX (Excel) export using `exceljs` — the most capable open-source XLSX library. XLSX is a hard requirement for finance and reporting use cases: it preserves number formatting, supports cell styles, handles Unicode correctly (CSV breaks on commas in values), and is the expected interchange format for any grid that displays financial data.

## Status

- **Priority**: P2 — hard requirement for finance use cases
- **Effort**: M
- **Risk**: LOW — additive only; `exceljs` is mature and well-maintained
- **Depends on**: 056 (valueFormatter — export must use formatted cell values)
- **Category**: feature, export
- **Planned at**: 2026-06-15, branch `rendering-architecture-v2-wip-3`

## Package addition

```
pnpm -F @eregister/wit-grid-core add exceljs
```

`exceljs` is ~600KB minified. It is a peer/optional dep — only loaded when `exportXlsx()` is called (dynamic import).

## GridApi method

```ts
// GridApi.ts

/**
 * Export grid data as an XLSX file and trigger a browser download.
 */
exportXlsx(options?: XlsxExportOptions): Promise<void>;

export interface XlsxExportOptions {
  /** Default: 'export.xlsx' */
  fileName?: string;

  /** Sheet name. Default: 'Sheet1' */
  sheetName?: string;

  /** Include column header row. Default: true */
  includeHeaders?: boolean;

  /** Columns to include. Default: all visible columns */
  columns?: string[]; // field names

  /** Only export selected rows. Default: false */
  selectedRowsOnly?: boolean;

  /**
   * Override raw value with a custom export value per cell.
   * Return undefined to use the normal valueFormatter output.
   */
  processCellValue?: (params: {
    value: unknown;
    formattedValue: string;
    colDef: ColumnDef;
    rowData: unknown;
    rowId: string;
  }) => string | number | Date | undefined;

  /**
   * Apply cell styles to specific columns.
   * Key is field name, value is exceljs cell style.
   */
  columnStyles?: Record<string, Partial<ExcelJS.Style>>;

  /** Auto-fit column widths based on content. Default: true */
  autoFitColumns?: boolean;
}
```

## Implementation

```ts
// packages/core/src/export/xlsxExport.ts

export async function exportXlsx(store: GridStore, options: ResolvedXlsxExportOptions): Promise<void> {
	const { Workbook } = await import('exceljs');

	const workbook = new Workbook();
	const sheet = workbook.addWorksheet(options.sheetName);

	const columns = resolveExportColumns(store, options);

	// Header row
	if (options.includeHeaders) {
		sheet.addRow(columns.map((col) => col.header ?? col.field));
		styleHeaderRow(sheet.getRow(1));
	}

	// Data rows
	const rows = resolveExportRows(store, options);
	for (const row of rows) {
		const values = columns.map((col) => {
			const raw = getCellRawValue(row.rowData, col);
			const formatted = getFormattedCellValue(raw, col, row.rowData, row.rowId);
			if (options.processCellValue) {
				const override = options.processCellValue({
					value: raw,
					formattedValue: formatted,
					colDef: col,
					rowData: row.rowData,
					rowId: row.rowId,
				});
				if (override !== undefined) return override;
			}
			// Return typed value: numbers stay numbers, dates stay dates, strings stay strings
			return resolveXlsxCellValue(raw, col);
		});
		sheet.addRow(values);
	}

	// Column widths
	if (options.autoFitColumns) {
		autoFitColumnWidths(sheet, columns);
	}

	// Apply column styles
	applyColumnStyles(sheet, columns, options.columnStyles);

	// Download
	const buffer = await workbook.xlsx.writeBuffer();
	triggerDownload(buffer, options.fileName);
}
```

### Typed cell values

Numbers, dates, booleans, and strings are written as their native Excel types (not stringified), so Excel can sort/filter/format them natively:

```ts
function resolveXlsxCellValue(raw: unknown, col: InternalColumnDef): unknown {
	if (raw === null || raw === undefined) return '';
	if (col.filterType === 'number' && typeof raw === 'number') return raw;
	if (col.filterType === 'date') {
		const d = new Date(raw as string | number);
		if (!isNaN(d.getTime())) return d;
	}
	// Use formatter for display
	return getFormattedCellValue(raw, col, undefined as any, '');
}
```

### Group rows in export

When grouping is active, export group rows as indented rows with the group label in the first column. Group footer rows can optionally be exported with aggregation values.

```ts
export interface XlsxExportOptions {
	// ...
	/** Include group header rows. Default: true */
	includeGroupRows?: boolean;
	/** Include group footer rows. Default: false */
	includeGroupFooters?: boolean;
}
```

## Phases

### Phase 1 — Core export function

- New file: `packages/core/src/export/xlsxExport.ts`
- `exportXlsx()` with dynamic `exceljs` import
- Flat rows (no grouping) with typed cell values
- Browser download via blob URL

### Phase 2 — GridApi surface

- Add `exportXlsx(options?)` to `GridApi.ts`
- Wire through `store.ts`, `createGrid.ts`, `createGridPluginRuntime.ts`

### Phase 3 — Header row styling

- Bold header row
- Freeze the top row (`sheet.views = [{ state: 'frozen', ySplit: 1 }]`)
- Auto-fit column widths based on content length

### Phase 4 — Grouped rows

- Detect group visual rows in the pipeline
- Write group label with indent
- Optionally include footer rows

### Phase 5 — Column styles and formatting

- `columnStyles` option wires to exceljs `cell.style`
- Number format strings (e.g. `'$#,##0.00'`) applied to numeric columns that have a `valueFormatter`

### Phase 6 — Demo

- Add "Export XLSX" button alongside existing "Export CSV" in demo pages
- Demo with a price column (formatted `$1,234.56`) to show native Excel number formatting

### Phase 7 — Tests

```ts
it('exports all visible rows', ...);
it('exports formatted value for text cells', ...);
it('exports raw number for numeric columns', ...);
it('exports Date objects for date columns', ...);
it('respects selectedRowsOnly option', ...);
it('includes group rows when includeGroupRows=true', ...);
```

(Tests mock `exceljs` to avoid the dynamic import in unit tests.)

## STOP conditions

- Do not implement Excel formula export in this plan.
- Do not implement multi-sheet export (one sheet per group) in this plan.
- Do not bundle `exceljs` eagerly — always dynamic import to keep initial bundle size clean.
- Do not implement `.xls` (old binary format) — XLSX only.

## Verification gate

```
pnpm -F @eregister/wit-grid-core build && pnpm -F @eregister/wit-grid-core test
pnpm -F @eregister/wit-grid-react build
pnpm -F demo-app build
```

Click "Export XLSX" → browser downloads `export.xlsx`. File opens in Excel with typed numbers (not strings), formatted values, bold frozen header row. Price column with `valueFormatter` shows `$1,234.56` in Excel.
