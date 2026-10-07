import type { RowNode } from './rowNode.js';

export interface GridDistinctValueSummary {
	readonly values: readonly (string | number | null)[];
	/** Rows holding each value, parallel to `values`. */
	readonly counts: readonly number[];
	readonly truncated: boolean;
	readonly limit: number | null;
}

export interface DistinctValueComputationOptions {
	readonly maxValues?: number;
	/** Reads a node's value (the column's getter); default the field of its data. */
	readonly getter?: (node: RowNode<any>) => unknown;
}

/**
 * The distinct values of a column with how many rows hold each, sorted (blank first). A list cell
 * (an array: multi-select, tags, people) counts once for each value it holds.
 */
export function computeDistinctValueSummary<TRowData>(
	nodes: readonly RowNode<TRowData>[],
	colField: string,
	options?: DistinctValueComputationOptions
): GridDistinctValueSummary {
	const rawLimit = options?.maxValues;
	const limit = rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : null;
	const read =
		options?.getter ?? ((node: RowNode<TRowData>) => node.getCellValue(colField, (d: unknown) => (d as Record<string, unknown>)[colField]));
	const counts = new Map<string, { value: string | number | null; count: number }>();
	let truncated = false;

	const add = (raw: unknown) => {
		const blank = raw == null || raw === '';
		const key = blank ? '\0null' : String(raw);
		const entry = counts.get(key);
		if (entry) {
			entry.count++;
			return;
		}
		if (limit !== null && counts.size >= limit) {
			truncated = true;
			return;
		}
		counts.set(key, { value: blank ? null : typeof raw === 'number' ? raw : String(raw), count: 1 });
	};
	for (const node of nodes) {
		const raw = read(node);
		if (Array.isArray(raw)) {
			if (raw.length === 0) add(null);
			for (const item of raw) add(item);
		} else add(raw);
	}

	const entries = [...counts.values()].sort((a, b) => {
		if (a.value === null) return -1;
		if (b.value === null) return 1;
		if (typeof a.value === 'number' && typeof b.value === 'number') return a.value - b.value;
		return String(a.value).localeCompare(String(b.value));
	});
	return { values: entries.map((e) => e.value), counts: entries.map((e) => e.count), truncated, limit };
}
