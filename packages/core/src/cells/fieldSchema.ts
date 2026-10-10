import type { CellOptionsStore } from './optionsStore.js';
import type { NumberCellOptions } from './format.js';

/**
 * What kind of value a column holds. Column types set it, so every surface that is not a cell
 * (record inspector, Kanban columns, Gantt bars, gallery cards, bulk edit) can read and write the
 * value the way the cell does without being configured again.
 */
export type ColumnValueKind =
	| 'text'
	| 'longText'
	| 'number'
	| 'currency'
	| 'percent'
	| 'progress'
	| 'rating'
	| 'checkbox'
	| 'date'
	| 'datetime'
	| 'dateRange'
	| 'select'
	| 'multiSelect'
	| 'person'
	| 'linkedRecord'
	| 'tags'
	| 'url'
	| 'email'
	| 'color'
	| 'path'
	| 'sparkline';

export interface ColumnSchema {
	kind: ColumnValueKind;
	/** The column's options (select, multi-select, people, records, tags): the same store its cells use. */
	options?: CellOptionsStore;
	/** A cell holds several values (multi-select, several people, linked records). */
	multiple?: boolean;
	/** Number display (currency code, decimals) for number-like kinds. */
	number?: NumberCellOptions;
	/** Largest value: `progress` (100 or 1) and `rating` (stars). */
	max?: number;
}
