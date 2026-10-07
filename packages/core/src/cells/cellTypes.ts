/**
 * Ready-made column types: renderer, editor, display formatter (export, tooltips) and filter for
 * each kind of value. Use one by name (`type: 'currency'`) or call a factory for options:
 *
 * ```ts
 * columnTypes: {
 *   status: selectColumnType([{ value: 'todo', label: 'To do', color: 'gray' }, { value: 'done', label: 'Done', color: 'green' }]),
 *   price: currencyColumnType({ currency: 'EUR' }),
 * }
 * ```
 */
import type { ColumnDef } from '../columnDef.js';
import {
	createDateEditor,
	createMultiSelectEditor,
	createNumberEditor,
	createPersonEditor,
	createSelectEditor,
	createToggleEditor,
	type SelectEditorOptions,
} from './editors.js';
import { createCascadeEditor, createCascadeRenderer, createCascadeStore, parseCascadeValue, type CascadeCellOptions } from './cascade.js';
import { createColorEditor, createColorRenderer, normalizeHexColor, type ColorCellOptions } from './color.js';
import { createDateRangeEditor, createDateRangeRenderer, formatDateRange, parseDateRange, type DateRangeCellOptions } from './dateRange.js';
import { createLongTextEditor, createLongTextRenderer, type LongTextCellOptions } from './longText.js';
import { createSparklineRenderer, parseSparklineValues, type SparklineCellOptions } from './sparkline.js';
import { formatCellDate, formatCellNumber, isCheckedCellValue, parseMultiValue, type DateCellOptions, type NumberCellOptions } from './format.js';
import { optionLabel, type CellOption } from './listbox.js';
import { createCellOptionsStore, type CellOptionsSourceConfig, type CellOptionsStore } from './optionsStore.js';
import {
	createCheckboxRenderer,
	createDateRenderer,
	createLinkRenderer,
	createMultiSelectRenderer,
	createNumberRenderer,
	createPersonRenderer,
	createProgressRenderer,
	createRatingRenderer,
	createSegmentedRenderer,
	createSelectRenderer,
	createSwitchRenderer,
	type LinkCellOptions,
	type SegmentedCellOptions,
	type SwitchCellOptions,
	type MultiSelectRendererOptions,
	type PersonCellOptions,
	type PersonOption,
	type ProgressCellOptions,
	type RatingCellOptions,
	type SelectRendererOptions,
} from './renderers.js';

/** The column settings a type supplies; the column's own settings win over them. */
export type ColumnTypeDefinition<TRowData = unknown> = Partial<Pick<ColumnDef<TRowData>, 'renderer' | 'cellEditor' | 'valueFormatter' | 'filterDef'>>;

/** Options as objects or bare values. */
export type CellOptionInput = CellOption | string;

function toOptions(input: readonly CellOptionInput[]): CellOption[] {
	return input.map((option) => (typeof option === 'string' ? { value: option } : option));
}

/** A select filter over the column's options (static or loaded): the same store its cells use. */
function selectFilter(store: CellOptionsStore, listValues = false): ColumnTypeDefinition['filterDef'] {
	return { type: 'select', options: store, listValues };
}

function labelOf(store: CellOptionsStore, value: string): string {
	const option = store.get(value);
	return option ? optionLabel(option) : value;
}

/**
 * Options for a column: the given ones, plus `loadOptions` / `resolveOptions` for options that live
 * on a server (paged and searched there, labels looked up for values drawn before any list opened).
 */
function optionsStoreFor(input: readonly CellOptionInput[], config: CellOptionsSourceConfig): CellOptionsStore {
	return createCellOptionsStore(toOptions(input), config);
}

export function checkboxColumnType(): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createCheckboxRenderer() },
		// Toggles on press; Enter / F2 toggles too, with nothing to type.
		cellEditor: { kind: 'dom', editor: createToggleEditor() },
		valueFormatter: ({ value }) => (isCheckedCellValue(value) ? 'Yes' : 'No'),
		filterDef: { type: 'boolean' },
	};
}

/** An on / off switch: toggles on press, or Enter. Optional labels beside it ('Active' / 'Paused'). */
export function switchColumnType(options: SwitchCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createSwitchRenderer(options) },
		cellEditor: { kind: 'dom', editor: createToggleEditor() },
		valueFormatter: ({ value }) => (isCheckedCellValue(value) ? (options.onLabel ?? 'On') : (options.offLabel ?? 'Off')),
		filterDef: { type: 'boolean' },
	};
}

/** Two to four options inline as a segmented control: one press picks. Enter opens them as a list. */
export function segmentedColumnType(input: readonly CellOptionInput[], config: SegmentedCellOptions = {}): ColumnTypeDefinition<any> {
	const store = optionsStoreFor(input, {});
	return {
		renderer: { kind: 'dom', renderer: createSegmentedRenderer(store.options, config) },
		cellEditor: { kind: 'dom', editor: createSelectEditor(store) },
		valueFormatter: ({ value }) => (value == null ? '' : labelOf(store, String(value))),
		filterDef: selectFilter(store),
	};
}

/** A colour: swatch and hex code; the editor offers a palette, a hex field and the system picker. */
export function colorColumnType(options: ColorCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createColorRenderer(options) },
		cellEditor: { kind: 'dom', editor: createColorEditor(options) },
		valueFormatter: ({ value }) => normalizeHexColor(value)?.toUpperCase() ?? '',
		filterDef: { type: 'select', swatches: true },
	};
}

/** Notes and descriptions: a clamped preview, edited in a textarea popover (Ctrl / ⌘ + Enter saves). */
export function longTextColumnType(options: LongTextCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createLongTextRenderer(options) },
		cellEditor: { kind: 'dom', editor: createLongTextEditor(options) },
	};
}

/** A start and end date: “Mar 4 – 18, 2026”, picked on a two-month calendar with presets. */
export function dateRangeColumnType(options: DateRangeCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createDateRangeRenderer(options) },
		cellEditor: { kind: 'dom', editor: createDateRangeEditor(options) },
		valueFormatter: ({ value }) => {
			const range = parseDateRange(value);
			return range ? formatDateRange(range, options.locale) : '';
		},
		filterDef: { type: 'dateRange' },
	};
}

/**
 * A path through a tree (Country → State → City): shown as a breadcrumb, picked one column per
 * level. Give the tree as `options`, or load levels with `loadChildren`.
 */
export function cascadeColumnType(options: CascadeCellOptions): ColumnTypeDefinition<any> {
	const store = createCascadeStore(options);
	return {
		renderer: { kind: 'dom', renderer: createCascadeRenderer(store) },
		cellEditor: { kind: 'dom', editor: createCascadeEditor(store) },
		valueFormatter: ({ value }) => {
			const path = parseCascadeValue(value, options.valueSeparator);
			return path
				.map((v, i) => {
					const node = store.node(path.slice(0, i + 1));
					return node ? optionLabel(node) : v;
				})
				.join(options.separator ?? ' › ');
		},
		filterDef: { type: 'path', cascade: store },
	};
}

/** A small chart of the cell's numbers: line, area, bar or win / loss. Display only. */
export function sparklineColumnType(options: SparklineCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createSparklineRenderer(options) },
		valueFormatter: ({ value }) => parseSparklineValues(value).join(', '),
		filterDef: { type: 'none' },
	};
}

export function numberColumnType(options: NumberCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createNumberRenderer(options) },
		cellEditor: { kind: 'dom', editor: createNumberEditor(options) },
		valueFormatter: ({ value }) => formatCellNumber(value, options) ?? '',
		filterDef: { type: 'number', format: options, min: options.min, max: options.max, step: options.step },
	};
}

export function currencyColumnType(options: NumberCellOptions = {}): ColumnTypeDefinition<any> {
	return numberColumnType({ format: 'currency', decimals: 2, step: 1, ...options });
}

/** Fractions shown as percentages (0.25 → 25%). */
export function percentColumnType(options: NumberCellOptions = {}): ColumnTypeDefinition<any> {
	return numberColumnType({ format: 'percent', decimals: 0, step: 0.01, ...options });
}

export function dateColumnType(options: DateCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createDateRenderer(options) },
		cellEditor: { kind: 'dom', editor: createDateEditor(options) },
		valueFormatter: ({ value }) => formatCellDate(value, options) ?? '',
		filterDef: { type: 'date' },
	};
}

export function dateTimeColumnType(options: DateCellOptions = {}): ColumnTypeDefinition<any> {
	return dateColumnType({ withTime: true, dateStyle: 'medium', ...options });
}

/**
 * One option per cell, drawn as a badge; the editor is a searchable, grouped list. For options on
 * a server pass `loadOptions` (pages, searched there) and `resolveOptions` (labels for values in
 * cells): `selectColumnType([], { loadOptions, resolveOptions })`.
 */
export function selectColumnType(
	input: readonly CellOptionInput[],
	config: SelectRendererOptions & SelectEditorOptions & CellOptionsSourceConfig = {}
): ColumnTypeDefinition<any> {
	const store = optionsStoreFor(input, config);
	return {
		renderer: { kind: 'dom', renderer: createSelectRenderer(store, config) },
		cellEditor: { kind: 'dom', editor: createSelectEditor(store, config) },
		valueFormatter: ({ value }) => (value == null ? '' : labelOf(store, String(value))),
		filterDef: selectFilter(store),
	};
}

/**
 * A select for long or grouped lists: search on, values shown as text with their dot / icon.
 * Give options a `group` to list them under headings.
 */
export function comboboxColumnType(
	input: readonly CellOptionInput[],
	config: SelectRendererOptions & SelectEditorOptions & CellOptionsSourceConfig = {}
): ColumnTypeDefinition<any> {
	return selectColumnType(input, { variant: 'plain', searchable: true, ...config });
}

/** Several options (or free tags with `creatable`) per cell: chips, with “+N” past `maxVisible`. */
export function multiSelectColumnType(
	input: readonly CellOptionInput[],
	config: MultiSelectRendererOptions & SelectEditorOptions & CellOptionsSourceConfig = {}
): ColumnTypeDefinition<any> {
	const store = optionsStoreFor(input, config);
	return {
		renderer: { kind: 'dom', renderer: createMultiSelectRenderer(store, config) },
		cellEditor: { kind: 'dom', editor: createMultiSelectEditor(store, config) },
		valueFormatter: ({ value }) =>
			parseMultiValue(value)
				.map((v) => labelOf(store, v))
				.join(', '),
		filterDef: selectFilter(store, true),
	};
}

export interface LinkedRecordOptions extends SelectEditorOptions, CellOptionsSourceConfig {
	/** Several records per cell (default) or one. */
	multiple?: boolean;
	/** Record chips shown before “+N”. Default 2. */
	maxVisible?: number;
	/** A chip was pressed: open that record (navigate, show a drawer…). */
	onOpen?: MultiSelectRendererOptions['onOpen'];
}

/**
 * Links to records of another table (Airtable-style link fields): record chips in the cell, a
 * searchable record picker, usually over `loadOptions` / `resolveOptions` from that table's API.
 */
export function linkedRecordColumnType(input: readonly CellOptionInput[], config: LinkedRecordOptions = {}): ColumnTypeDefinition<any> {
	const store = optionsStoreFor(input, config);
	const multiple = config.multiple ?? true;
	const editorConfig: SelectEditorOptions = { searchable: true, searchPlaceholder: 'Find a record\u2026', ...config, variant: 'record' };
	return {
		renderer: {
			kind: 'dom',
			renderer: createMultiSelectRenderer(store, {
				variant: 'record',
				maxVisible: multiple ? (config.maxVisible ?? 2) : 1,
				onOpen: config.onOpen,
			}),
		},
		cellEditor: { kind: 'dom', editor: multiple ? createMultiSelectEditor(store, editorConfig) : createSelectEditor(store, editorConfig) },
		valueFormatter: ({ value }) =>
			parseMultiValue(value)
				.map((v) => labelOf(store, v))
				.join(', '),
		filterDef: selectFilter(store, multiple),
	};
}

/** Free-form tags: any text, coloured from the palette, new ones created by typing. */
export function tagsColumnType(
	input: readonly CellOptionInput[] = [],
	config: MultiSelectRendererOptions & SelectEditorOptions & CellOptionsSourceConfig = {}
): ColumnTypeDefinition<any> {
	return multiSelectColumnType(input, { creatable: true, searchable: true, searchPlaceholder: 'Search or create…', ...config });
}

export function ratingColumnType(options: RatingCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createRatingRenderer(options) },
		cellEditor: { kind: 'dom', editor: createNumberEditor({ min: 0, max: options.max ?? 5, step: 1, decimals: 0 }) },
		filterDef: { type: 'number', stars: options.max ?? 5, min: 0, max: options.max ?? 5, step: 1 },
	};
}

export function progressColumnType(options: ProgressCellOptions = {}): ColumnTypeDefinition<any> {
	const max = options.max ?? 100;
	return {
		renderer: { kind: 'dom', renderer: createProgressRenderer(options) },
		cellEditor: { kind: 'dom', editor: createNumberEditor({ min: 0, max, step: max / 20 }) },
		// A 0–1 bar reads as a percent; its filter takes percents too.
		filterDef: { type: 'number', min: 0, max, format: max === 1 ? { format: 'percent', decimals: 0 } : undefined },
	};
}

export function urlColumnType(options: Omit<LinkCellOptions, 'kind'> = {}): ColumnTypeDefinition<any> {
	return { renderer: { kind: 'dom', renderer: createLinkRenderer({ ...options, kind: 'url' }) } };
}

export function emailColumnType(options: Omit<LinkCellOptions, 'kind'> = {}): ColumnTypeDefinition<any> {
	return { renderer: { kind: 'dom', renderer: createLinkRenderer({ ...options, kind: 'email' }) } };
}

/**
 * People: avatar + name (stacked avatars with `multiple`), picked from a searchable list. For a
 * directory on a server, pass `loadOptions` / `resolveOptions` returning `PersonOption`s.
 */
export function personColumnType(
	config: Omit<PersonCellOptions, 'people'> & { people?: readonly PersonOption[] } & SelectEditorOptions & CellOptionsSourceConfig = {}
): ColumnTypeDefinition<any> {
	const store = createCellOptionsStore(config.people ?? [], config);
	const editable = store.options.length > 0 || !!store.fetch;
	return {
		renderer: { kind: 'dom', renderer: createPersonRenderer({ ...config, people: store }) },
		cellEditor: editable ? { kind: 'dom', editor: createPersonEditor(store, config) } : undefined,
		valueFormatter: ({ value }) =>
			parseMultiValue(value)
				.map((v) => labelOf(store, v))
				.join(', '),
		filterDef: selectFilter(store, !!config.multiple),
	};
}

/** The column types available by name without registering them. */
export const BUILTIN_COLUMN_TYPES: Readonly<Record<string, ColumnTypeDefinition<any>>> = {
	checkbox: checkboxColumnType(),
	number: numberColumnType(),
	currency: currencyColumnType(),
	percent: percentColumnType(),
	date: dateColumnType(),
	datetime: dateTimeColumnType(),
	rating: ratingColumnType(),
	progress: progressColumnType(),
	url: urlColumnType(),
	email: emailColumnType(),
	tags: tagsColumnType(),
	person: personColumnType(),
	switch: switchColumnType(),
	color: colorColumnType(),
	longText: longTextColumnType(),
	dateRange: dateRangeColumnType(),
	sparkline: sparklineColumnType(),
};

/**
 * Columns with their `type` applied: the type's settings fill in whatever the column does not set
 * itself. `userTypes` add to (or replace) the built-in types.
 */
export function resolveColumnTypes<TRowData>(
	columns: ColumnDef<TRowData>[],
	userTypes?: Record<string, ColumnTypeDefinition<TRowData>>
): ColumnDef<TRowData>[] {
	const registry: Record<string, ColumnTypeDefinition<TRowData>> = userTypes ? { ...BUILTIN_COLUMN_TYPES, ...userTypes } : BUILTIN_COLUMN_TYPES;
	return columns.map((col) => {
		if (!col.type) return col;
		const typeDef = registry[col.type];
		return typeDef ? { ...typeDef, ...col } : col;
	});
}
