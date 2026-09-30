import type { ColumnDef } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import { isHierarchyColumn } from '../rows/hierarchyColumn.js';
export interface CsvExportOptions {
	/** Downloaded file name. Default: 'export.csv' */
	fileName?: string;
	/** Column delimiter. Default: ',' */
	delimiter?: string;
	/** Include header row. Default: true */
	includeHeader?: boolean;
	/** Restrict export to these column fields (in order). Defaults to all displayed columns. */
	columns?: string[];
	/** Export only selected rows. Default: false */
	onlySelected?: boolean;
	/** Export only rows with these IDs (in order). Takes precedence over onlySelected. */
	rowIds?: string[];
	/**
	 * Grouped / tree grids: export the hierarchy — every group expanded, in row order — with group
	 * rows (label and count in the hierarchy column, formatted aggregates under their columns).
	 * Default: true. Ignored with `rowIds` / `onlySelected`, which export data rows only.
	 */
	includeGroups?: boolean;
	/** Total rows (as `grouping.totals` places them). Default: true. */
	includeTotals?: boolean;
	/** How the hierarchy column reads: indented by level, or the full path (`EMEA > Cloud`). Default: 'indent'. */
	hierarchyText?: 'indent' | 'path';
}

// Minimal duck-typed interface — avoids a circular import with store.ts
interface Exportable<TRowData> {
	getDisplayedColumns(): Array<{
		field: string;
		header: string;
		valueFormatter?: (params: { value: unknown; rowData: TRowData; colDef: any; rowId: string }) => string;
	}>;
	rows(): { getAll(): TRowData[]; getSelected(): TRowData[]; getById(id: string): TRowData | null };
	getRowId(row: TRowData): string;
	getCellValue(rowId: string, field: string): unknown;
	/** Grouped / tree grids: every row of the hierarchy, all groups expanded (no detail rows). */
	getHierarchyExportRows?(): VisualRow<TRowData>[] | null;
	hierarchyCellText?(row: VisualRow<TRowData>, col: ColumnDef<TRowData>, options?: { withCount?: boolean; indent?: string }): string;
}

export function exportToCsv<TRowData>(api: Exportable<TRowData>, options: CsvExportOptions = {}): void {
	// UTF-8 BOM makes Excel open the file correctly without re-encoding
	const blob = new Blob(['\uFEFF' + toCsv(api, options)], { type: 'text/csv;charset=utf-8;' });
	triggerDownload(blob, options.fileName ?? 'export.csv');
}

/** The CSV text `exportToCsv` downloads. */
export function toCsv<TRowData>(api: Exportable<TRowData>, options: CsvExportOptions = {}): string {
	const { delimiter = ',', includeHeader = true, columns: colFilter, onlySelected = false, rowIds } = options;

	const cols = api.getDisplayedColumns().filter((col) => !colFilter || colFilter.includes(col.field));

	const lines: string[] = [];

	if (includeHeader) {
		lines.push(cols.map((col) => escapeCell(col.header || col.field, delimiter)).join(delimiter));
	}

	const hierarchyRows = !rowIds && !onlySelected ? (api.getHierarchyExportRows?.() ?? null) : null;
	if (hierarchyRows && api.hierarchyCellText) {
		writeHierarchyRows(lines, hierarchyRows, cols as unknown as ColumnDef<TRowData>[], api, options);
		return lines.join('\n');
	}

	const allRows = api.rows().getAll();
	// By id, in the given order — rows inside collapsed groups included.
	const dataRows = rowIds
		? rowIds.map((id) => api.rows().getById(id)).filter((row): row is TRowData => row != null)
		: onlySelected
			? api.rows().getSelected()
			: allRows;

	for (const row of dataRows) {
		const rowId = api.getRowId(row);
		lines.push(
			cols
				.map((col) => {
					const value = api.getCellValue(rowId, col.field);
					const text = col.valueFormatter ? col.valueFormatter({ value, rowData: row, colDef: col, rowId }) : fmt(value);
					return escapeCell(text, delimiter);
				})
				.join(delimiter)
		);
	}

	return lines.join('\n');
}

function writeHierarchyRows<TRowData>(
	lines: string[],
	rows: VisualRow<TRowData>[],
	cols: ColumnDef<TRowData>[],
	api: Exportable<TRowData>,
	options: CsvExportOptions
): void {
	const { delimiter = ',', includeGroups = true, includeTotals = true, hierarchyText = 'indent' } = options;
	const text = api.hierarchyCellText!;
	// Path mode: the labels of the current row's ancestors, by level.
	const path: string[] = [];
	for (const row of rows) {
		if (row.kind !== 'data' && row.kind !== 'group' && row.kind !== 'total') continue;
		if (row.kind === 'group' && !includeGroups) continue;
		if (row.kind === 'total' && !includeTotals) continue;
		const level = row.hierarchy.level;
		const cells = cols.map((col) => {
			if (isHierarchyColumn(col)) {
				const label = text(row, col);
				if (hierarchyText === 'path') {
					path.length = level;
					if (row.kind !== 'total') path[level] = label;
					return escapeCell([...path.slice(0, level), label].filter(Boolean).join(' > '), delimiter);
				}
				const withCount = row.kind === 'group' ? text(row, col, { withCount: true }) : label;
				return escapeCell('  '.repeat(level) + withCount, delimiter);
			}
			if (row.kind !== 'data') return escapeCell(text(row, col), delimiter);
			const rowId = row.rowId;
			const value = api.getCellValue(rowId, col.field);
			return escapeCell(col.valueFormatter ? col.valueFormatter({ value, rowData: row.node.data, colDef: col, rowId }) : fmt(value), delimiter);
		});
		lines.push(cells.join(delimiter));
	}
}

function fmt(value: unknown): string {
	if (value == null) return '';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return String(value);
}

function escapeCell(value: string, delimiter: string): string {
	if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
		return '"' + value.replace(/"/g, '""') + '"';
	}
	return value;
}

function triggerDownload(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
