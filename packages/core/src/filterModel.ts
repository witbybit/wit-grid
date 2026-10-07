import { computeDistinctValueSummary, type DistinctValueComputationOptions } from './distinctValues.js';

// V2 discriminated-union filter model.

export type TextFilterOperator = 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'blank' | 'notBlank';

export type NumberFilterOperator = 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'inRange' | 'blank' | 'notBlank';

export type DateFilterOperator = 'equals' | 'before' | 'after' | 'inRange' | 'blank' | 'notBlank';

export interface TextFilterCondition {
	type: 'text';
	operator: TextFilterOperator;
	value: string;
}

export interface NumberFilterCondition {
	type: 'number';
	operator: NumberFilterOperator;
	/** Primary filter value. Ignored for blank/notBlank. */
	value: number;
	/** Upper bound for inRange operator. */
	valueTo?: number;
}

export interface DateFilterCondition {
	type: 'date';
	operator: DateFilterOperator;
	/** ISO 8601 date string (e.g. "2024-01-15"). */
	dateFrom: string;
	/** Upper bound for inRange operator (ISO 8601). */
	dateTo?: string;
}

/**
 * One or more chosen values (select, combobox, multi-select, tags, people, linked records).
 * Plain cells match when their value is chosen. List cells (arrays, or comma-separated) match by
 * `matchMode`: any chosen value present (default), all of them present, or none of them present.
 */
export interface SelectFilterCondition {
	type: 'select';
	/** Chosen values; null stands for blank cells. */
	values: (string | number | null)[];
	/** Display labels parallel to `values`, kept for filter chips when options load from a server. */
	labels?: string[];
	matchMode?: 'any' | 'all' | 'none';
}

/** Checkbox and switch cells: true or false (blank counts as false). */
export interface BooleanFilterCondition {
	type: 'boolean';
	value: boolean;
}

/**
 * Date-range cells against a range: `overlaps` (shares any day), `within` (lies inside it) or
 * `contains` (covers the single date `dateFrom`).
 */
export interface DateRangeFilterCondition {
	type: 'dateRange';
	operator: 'overlaps' | 'within' | 'contains';
	/** ISO date (YYYY-MM-DD). */
	dateFrom: string;
	/** ISO date; not used by `contains`. */
	dateTo?: string;
}

/**
 * Cascading-select cells: a cell matches when its path starts with any chosen path, so choosing
 * a country matches every city in it.
 */
export interface PathFilterCondition {
	type: 'path';
	paths: string[][];
	/** Display labels for the chosen paths, for filter chips. */
	labels?: string[];
}

/** A filter with its own editor and matching (`filterDef.type: 'custom'`); `value` is its own data. */
export interface CustomFilterCondition {
	type: 'custom';
	value: unknown;
	/** Chip text. */
	label?: string;
}

export type FilterCondition =
	| TextFilterCondition
	| NumberFilterCondition
	| DateFilterCondition
	| SelectFilterCondition
	| BooleanFilterCondition
	| DateRangeFilterCondition
	| PathFilterCondition
	| CustomFilterCondition;

export interface CompoundFilterCondition {
	type: 'compound';
	operator: 'AND' | 'OR';
	/** Exactly two leaf conditions. */
	conditions: [FilterCondition, FilterCondition];
}

export type ColumnFilter = FilterCondition | CompoundFilterCondition;

export type FilterModel = Record<string, ColumnFilter>;

/**
 * A single search string matched (case-insensitively, via substring containment) against
 * multiple columns at once — the "search box" pattern, as distinct from FilterModel's
 * per-column conditions. A row passes if ANY targeted column's display value contains the
 * search text; combined with any active FilterModel/GridQueryModel entries via AND.
 */
export interface QuickFilterModel {
	/** Search text. Empty/whitespace-only text matches every row. */
	text: string;
	/** Column fields to search. Omit or leave empty to search every displayed column. */
	columnIds?: string[];
}

/**
 * Compute distinct cell values from an array of row nodes for a given column field.
 * Used by getColumnDistinctValues on GridEngine. Extracted here to keep GridEngine lean.
 */
export function computeDistinctValues(
	nodes: Array<{ getCellValue(field: string, getter: (d: unknown) => unknown): unknown }>,
	colField: string,
	options?: DistinctValueComputationOptions
): (string | number | null)[] {
	return [...computeDistinctValueSummary(nodes as never, colField, options).values];
}
