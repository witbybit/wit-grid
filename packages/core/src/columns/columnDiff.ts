import type { ColumnDef } from '../columnDef.js';

/** Column props whose functions draw a cell's whole content: a new one needs the cell rebound, not just repainted. */
const RENDERER_KEYS = new Set(['renderer', 'cellRenderer', 'editor', 'cellEditor', 'headerRenderer', 'headerComponent']);

/**
 * A re-declared column list that differs from the previous one only in function identities (a React app
 * writing `valueFormatter: (p) => …` inline gets a new function every render). Returns the fields whose
 * functions changed when every function is display-level, `null` when anything else differs (data, order,
 * a renderer or editor spec, or a function the row pipeline reads): the caller then re-applies in full.
 */
export function displayOnlyFunctionChanges<TData>(prev: readonly ColumnDef<TData>[] | null, next: readonly ColumnDef<TData>[]): Set<string> | null {
	if (!prev || prev.length !== next.length) return null;
	const changed = new Set<string>();
	for (let i = 0; i < next.length; i++) {
		const a = prev[i] as unknown as Record<string, unknown>;
		const b = next[i] as unknown as Record<string, unknown>;
		if (a === b) continue;
		if (a.field !== b.field) return null;
		const result = compareColumn(a, b);
		if (result === 'different') return null;
		if (result === 'functions') changed.add(b.field as string);
	}
	return changed;
}

/**
 * Whether two column lists read the same values for the row pipeline (filter, sort, group, aggregate):
 * the same fields in the same order with the same value getters, types and filter settings. Display-only props
 * (headers, widths, formatters, renderers) may differ.
 */
export function samePipelineColumns<TData>(a: readonly ColumnDef<TData>[], b: readonly ColumnDef<TData>[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (x === y) continue;
		if (x.field !== y.field || x.valueGetter !== y.valueGetter || x.type !== y.type || x.filterType !== y.filterType) return false;
		if (!samePlain(x.valueGetterDependencies, y.valueGetterDependencies) || !samePlain(x.filterValues, y.filterValues)) return false;
		if (!samePlain(x.filterDef, y.filterDef)) return false;
	}
	return true;
}

/** 'same' (identical content), 'functions' (only display-level function identities differ) or 'different'. */
function compareColumn(a: Record<string, unknown>, b: Record<string, unknown>): 'same' | 'functions' | 'different' {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return 'different';
	let functions = false;
	for (const key of keys) {
		if (!Object.prototype.hasOwnProperty.call(b, key)) return 'different';
		const x = a[key];
		const y = b[key];
		if (x === y) continue;
		if (typeof x === 'function' && typeof y === 'function') {
			// The pipeline reads valueGetter: a new one changes what is filtered, sorted and aggregated.
			if (key === 'valueGetter') return 'different';
			functions = true;
			continue;
		}
		if (RENDERER_KEYS.has(key)) return 'different';
		if (!samePlain(x, y)) return 'different';
	}
	return functions ? 'functions' : 'same';
}

/** Plain data by value (arrays and plain objects deeply), functions and class instances by identity. */
function samePlain(a: unknown, b: unknown, depth = 0): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || depth > 8) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const protoA = Object.getPrototypeOf(a);
	if (!Array.isArray(a) && protoA !== Object.prototype && protoA !== null) return false;
	if (protoA !== Object.getPrototypeOf(b)) return false;
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	for (const key of keys) {
		if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
		if (!samePlain((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth + 1)) return false;
	}
	return true;
}
