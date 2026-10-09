/** What a chart plots, read from the grid: the selected cells, or a column aggregated per category. */
import type { GridApi } from '../api/GridApi.js';
import type { ColumnDef } from '../columnDef.js';
import type { ColumnFilter, FilterModel } from '../filterModel.js';
import { resolveColumnFilterDef } from '../filters/filterDef.js';
import { prepareColumnFilter } from '../filters/matchFilter.js';
import { resolveGridRuntimeComposition } from '../internal/apiInternalBridge.js';
import type { ChartAggregate, ChartData, ChartSource } from './chartTypes.js';

/**
 * Reads a column's value of a row: straight from the row data when the column has no valueGetter
 * and no formulas (ten times faster over large grids), else through the grid.
 */
function fieldReader(api: GridApi<any>, columns: readonly ColumnDef<any>[], field: string): FieldReader {
	const col = columns.find((c) => c.field === field);
	let direct = false;
	try {
		direct = !!col && !col.valueGetter && !resolveGridRuntimeComposition(api).host.engine.fieldHasFormulas(field);
	} catch {
		direct = false;
	}
	const read: FieldReader = direct
		? (_rowId, data) => (data as Record<string, unknown> | undefined)?.[field]
		: (rowId) => api.getCellValue(rowId, field);
	read.direct = direct;
	return read;
}

type FieldReader = ((rowId: string, data: unknown) => unknown) & { direct?: boolean };

const toNumber = (value: unknown): number | null => {
	if (value == null || value === '' || typeof value === 'boolean') return null;
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : null;
};

function columnLabel(col: ColumnDef<any> | undefined, field: string): string {
	return col ? String(col.header || col.field) : field;
}

/** The selected cells: the first text column names the categories, number columns are the series. */
function rangeData(api: GridApi<any>, transposed: boolean, colors: (i: number) => string): ChartData {
	const empty: ChartData = { categories: [], series: [], categoryField: null, categoryValues: [] };
	const bounds = api.getStateSnapshot().selection?.bounds;
	if (!bounds) return empty;
	const shown = api.getDisplayedColumns();
	const rows: { id: string; label: string }[] = [];
	for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
		const row = api.getDataRowAtVisualIndex(r);
		if (row) rows.push({ id: api.getRowId(row), label: `Row ${r + 1}` });
	}
	const cols = shown.slice(bounds.minCol, bounds.maxCol + 1).filter((c) => !c.field.startsWith('__'));
	if (rows.length === 0 || cols.length === 0) return empty;
	const text = (col: ColumnDef<any>, id: string) => {
		const value = api.getCellValue(id, col.field);
		return col.valueFormatter ? col.valueFormatter({ value, colDef: col, rowId: id, rowData: undefined } as never) : String(value ?? '');
	};
	const isText = (col: ColumnDef<any>) =>
		rows.some((row) => {
			const value = api.getCellValue(row.id, col.field);
			return value != null && value !== '' && toNumber(value) === null;
		});
	const first = cols[0];
	const categoryCol = cols.length > 1 && isText(first) ? first : null;
	const dataCols = categoryCol ? cols.slice(1) : cols;
	const labels = categoryCol ? rows.map((row) => text(categoryCol, row.id)) : rows.map((row) => row.label);
	const value = (col: ColumnDef<any>, id: string) => toNumber(api.getCellValue(id, col.field)) ?? 0;
	if (!transposed) {
		return {
			categories: labels,
			series: dataCols.map((col, i) => ({
				name: columnLabel(col, col.field),
				values: rows.map((row) => value(col, row.id)),
				color: colors(i),
			})),
			categoryField: categoryCol?.field ?? null,
			categoryValues: categoryCol
				? rows.map((row) => api.getCellValue(row.id, categoryCol.field) as string | number | null)
				: rows.map(() => null),
		};
	}
	return {
		categories: dataCols.map((col) => columnLabel(col, col.field)),
		series: rows.map((row, i) => ({ name: labels[i] || row.label, values: dataCols.map((col) => value(col, row.id)), color: colors(i) })),
		categoryField: null,
		categoryValues: dataCols.map(() => null),
	};
}

interface Bucket {
	value: string | number | null;
	label: string;
	acc: { sum: number; count: number; min: number; max: number }[];
}

/**
 * A column aggregated per category, over the rows the grid shows. A chart that cross-filters
 * by its own category leaves that one filter out, so the other categories stay in view.
 */
function aggregateData(api: GridApi<any>, source: Extract<ChartSource, { kind: 'aggregate' }>, colors: (i: number) => string): ChartData {
	const columns = api.getColumns();
	const categoryCol = columns.find((c) => c.field === source.category);
	const measures = source.measures.length > 0 ? source.measures : [{ aggregate: 'count' as ChartAggregate }];
	const model = (api.getStateSnapshot().filterModel as FilterModel | null) ?? null;
	const ownFilter = model?.[source.category];

	const buckets = new Map<string, Bucket>();
	const readCategory = fieldReader(api, columns, source.category);
	const readMeasure = measures.map((m) => (m.field ? fieldReader(api, columns, m.field) : null));
	const add = (rowId: string, data: unknown) => {
		const raw = readCategory(rowId, data);
		const list = Array.isArray(raw) ? raw : [raw];
		for (const item of list.length ? list : [null]) {
			const value = item === undefined || item === '' ? null : (item as string | number | null);
			const key = value === null ? '\u0000' : String(value);
			let bucket = buckets.get(key);
			if (!bucket) {
				const label =
					value === null
						? '(Blank)'
						: categoryCol?.valueFormatter
							? categoryCol.valueFormatter({ value, colDef: categoryCol, rowId, rowData: data } as never)
							: String(value);
				bucket = { value, label: label || String(value), acc: measures.map(() => ({ sum: 0, count: 0, min: Infinity, max: -Infinity })) };
				buckets.set(key, bucket);
			}
			measures.forEach((measure, i) => {
				const acc = bucket!.acc[i];
				if (measure.aggregate === 'count') {
					acc.count++;
					return;
				}
				const read = readMeasure[i];
				const n = read ? toNumber(read(rowId, data)) : null;
				if (n === null) return;
				acc.sum += n;
				acc.count++;
				if (n < acc.min) acc.min = n;
				if (n > acc.max) acc.max = n;
			});
		}
	};

	if (ownFilter) {
		// Every row through the other column filters.
		const others = Object.entries(model!)
			.filter(([field]) => field !== source.category)
			.map(([field, filter]) => {
				const col = columns.find((c) => c.field === field);
				return {
					read: fieldReader(api, columns, field),
					match: col ? prepareColumnFilter(filter as ColumnFilter, resolveColumnFilterDef(col)) : null,
				};
			});
		api.forEachNode((node) => {
			if (node.data === undefined || node.kind !== 'data') return;
			const id = node.id;
			for (const other of others) if (other.match && !other.match(other.read(id, node.data), node.data)) return;
			add(id, node.data);
		});
	} else {
		// Ids are only looked up for columns read through the grid.
		const needsId = !readCategory.direct || readMeasure.some((read) => read && !read.direct);
		for (const row of api.rows().getAll()) add(needsId ? api.getRowId(row) : '', row);
	}

	const finish = (acc: Bucket['acc'][number], aggregate: ChartAggregate) => {
		if (aggregate === 'count') return acc.count;
		if (acc.count === 0) return 0;
		if (aggregate === 'sum') return acc.sum;
		if (aggregate === 'avg') return acc.sum / acc.count;
		return aggregate === 'min' ? acc.min : acc.max;
	};
	let rows = [...buckets.values()].map((bucket) => ({ bucket, values: measures.map((m, i) => finish(bucket.acc[i], m.aggregate)) }));
	if (source.sort === 'label') rows.sort((a, b) => a.bucket.label.localeCompare(b.bucket.label, undefined, { numeric: true }));
	else rows.sort((a, b) => b.values[0] - a.values[0]);

	const limit = source.limit ?? 24;
	if (rows.length > limit) {
		// The rest fold into “Other” (sums and counts add; others take the extremes).
		const rest = rows.slice(limit - 1);
		const other = measures.map((m, i) => {
			const values = rest.map((r) => r.values[i]);
			if (m.aggregate === 'min') return Math.min(...values);
			if (m.aggregate === 'max') return Math.max(...values);
			if (m.aggregate === 'avg') return values.reduce((s, v) => s + v, 0) / values.length;
			return values.reduce((s, v) => s + v, 0);
		});
		rows = [...rows.slice(0, limit - 1), { bucket: { value: null, label: 'Other', acc: [] }, values: other }];
	}

	const measureLabel = (m: (typeof measures)[number]) => {
		if (m.label) return m.label;
		if (m.aggregate === 'count') return 'Count';
		const col = columns.find((c) => c.field === m.field);
		const name = columnLabel(col, m.field ?? '');
		return m.aggregate === 'sum' ? name : `${m.aggregate[0].toUpperCase()}${m.aggregate.slice(1)} ${name}`;
	};
	return {
		categories: rows.map((r) => r.bucket.label),
		series: measures.map((m, i) => ({ name: measureLabel(m), values: rows.map((r) => r.values[i]), color: colors(i) })),
		categoryField: source.category,
		categoryValues: rows.map((r) => (r.bucket.label === 'Other' && r.bucket.acc.length === 0 ? null : r.bucket.value)),
	};
}

export function readChartData(api: GridApi<any>, source: ChartSource, colors: (i: number) => string): ChartData {
	return source.kind === 'range' ? rangeData(api, !!source.transposed, colors) : aggregateData(api, source, colors);
}
