/**
 * A column's filter: the one config every filter surface reads (header funnel and menu, floating
 * filter row, sidebar panel, query builder), and the filter model and matching it implies.
 *
 * Column types supply a default (`selectColumnType` filters as a select of its options, a
 * date-range column by overlap…); a column's own `filterDef` wins. Without either a column
 * filters as text.
 */
import type { CascadeCellOptions, CascadeStore } from '../cells/cascade.js';
import type { NumberCellOptions } from '../cells/format.js';
import type { CellOption } from '../cells/listbox.js';
import type { CellOptionsLoader, CellOptionsResolver, CellOptionsStore } from '../cells/optionsStore.js';
import type { ColumnFilter, FilterCondition } from '../filterModel.js';

export type ColumnFilterType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'dateRange' | 'path' | 'custom' | 'none';

/** Where a filter editor is shown: it adapts its layout (compact in the floating row). */
export type FilterSurface = 'popover' | 'menu' | 'floating' | 'sidebar' | 'query';

export interface DomFilterEditorParams {
	/** The column's field. */
	colField: string;
	/** The resolved definition (column type default merged with the column's own). */
	filterDef: ColumnFilterDef<any>;
	/** The column's current filter, if any. */
	filter: ColumnFilter | null;
	/** Apply a filter (null clears). Editors call it as the user picks, or on Enter / Apply for typed values. */
	onChange: (filter: ColumnFilter | null) => void;
	/** The user is done (Enter on a list, Apply): popovers close on it. */
	onClose?: () => void;
	surface: FilterSurface;
	/** Distinct values of the column with row counts (client-side models). */
	distinctValues?: () => { values: readonly (string | number | null)[]; counts?: readonly number[] };
}

export interface DomFilterEditorHandle {
	focus?(): void;
	destroy?(): void;
}

/** A filter editor written against the DOM: core's built-in editors and custom ones alike. */
export interface DomFilterEditor {
	mount(container: HTMLElement, params: DomFilterEditorParams): DomFilterEditorHandle;
}

export interface ColumnFilterDef<TRowData = unknown> {
	type: ColumnFilterType;

	// ── Text, number, date ─────────────────────────────────────────────────────
	/** Operators offered (by value); default all of the type's operators. */
	operators?: readonly string[];
	/** Number display in chips and inputs. */
	format?: NumberCellOptions;
	/** Date filters: the first day of a week for "this week" (0 Sunday … 6 Saturday). Default 1. */
	weekStartsOn?: number;
	/** Number inputs: bounds and step. */
	min?: number;
	max?: number;
	step?: number;
	/** Number filter shown as a star picker (“at least ★★★”), up to this many stars. */
	stars?: number;

	// ── Select ─────────────────────────────────────────────────────────────────
	/** Several values may be chosen. Default true. */
	multiple?: boolean;
	/** Cells hold lists (multi-select, tags, people): offer Any / All / None of. */
	listValues?: boolean;
	/** The choices: options, or a column type's store; default the column's distinct values. */
	options?: readonly CellOption[] | CellOptionsStore;
	/** Choices from a server, paged and searched there (as cell editors load them). */
	loadOptions?: CellOptionsLoader;
	resolveOptions?: CellOptionsResolver;
	pageSize?: number;
	/** Wait this long after typing before searching a server. Default 250 (0 for local options). */
	debounceMs?: number;
	/** Search a server only once this many characters are typed. Default 0. */
	minQueryLength?: number;
	/** Row counts beside options (client-side models). Default true. */
	showCounts?: boolean;
	/** Show colour swatches instead of a list (colour columns). */
	swatches?: boolean;
	searchable?: boolean;
	placeholder?: string;
	emptyText?: string;

	// ── Path (cascading select) ────────────────────────────────────────────────
	/** The tree to choose from: cascade options, or the column type's tree store (shares loaded levels). */
	cascade?: CascadeCellOptions | CascadeStore;

	// ── Custom ─────────────────────────────────────────────────────────────────
	/** A DOM editor producing `{ type: 'custom', value }` (or any built-in condition). */
	editor?: DomFilterEditor;
	/** An adapter component (React) rendering the editor; adapters host it on every surface. */
	renderFilter?(params: DomFilterEditorParams): unknown;
	/** Client-side matching of a custom condition. */
	matches?(value: unknown, filter: FilterCondition, row: TRowData): boolean;

	// ── Chips ──────────────────────────────────────────────────────────────────
	/** Chip text for this column's filter. */
	summarize?(filter: ColumnFilter): string;
}

/** The parts of a column the filter config is read from. */
export interface FilterConfigColumn<TRowData = unknown> {
	field: string;
	filterDef?: ColumnFilterDef<TRowData>;
}

/** A column's filter definition: its own, else text. Null when the column does not filter. */
export function resolveColumnFilterDef<TRowData>(column: FilterConfigColumn<TRowData>): ColumnFilterDef<TRowData> | null {
	const def = column.filterDef ?? { type: 'text' };
	return def.type === 'none' ? null : def;
}
