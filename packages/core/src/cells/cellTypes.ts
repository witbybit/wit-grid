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
	type SelectEditorOptions,
} from './editors.js';
import { formatCellDate, formatCellNumber, parseMultiValue, type DateCellOptions, type NumberCellOptions } from './format.js';
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
	createSelectRenderer,
	type LinkCellOptions,
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

function filterOption(option: CellOption) {
	return { value: option.value, label: optionLabel(option), group: option.group, description: option.description };
}

/** The column's filter list: the options, or pages from the same loader the editor uses. */
function selectFilter(store: CellOptionsStore): ColumnTypeDefinition['filterDef'] {
	const fetch = store.fetch;
	if (!fetch) return { type: 'multi-select', options: store.options.map(filterOption) };
	return {
		type: 'infinite-multi-select',
		pageSize: store.pageSize,
		getOptionLabel: (value) => {
			const option = store.get(String(value));
			return option ? optionLabel(option) : String(value);
		},
		fetchPage: async (params, signal) => {
			const page = await fetch({ search: params.query, offset: params.page * params.pageSize, limit: params.pageSize, signal });
			return { options: page.options.map(filterOption), hasMore: !!page.hasMore, totalCount: page.total };
		},
	};
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
		// The checkbox toggles on press; there is nothing to type.
		cellEditor: undefined,
	};
}

export function numberColumnType(options: NumberCellOptions = {}): ColumnTypeDefinition<any> {
	return {
		renderer: { kind: 'dom', renderer: createNumberRenderer(options) },
		cellEditor: { kind: 'dom', editor: createNumberEditor(options) },
		valueFormatter: ({ value }) => formatCellNumber(value, options) ?? '',
		filterDef: { type: 'number' },
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
		filterDef: { type: 'number' },
	};
}

export function progressColumnType(options: ProgressCellOptions = {}): ColumnTypeDefinition<any> {
	const max = options.max ?? 100;
	return {
		renderer: { kind: 'dom', renderer: createProgressRenderer(options) },
		cellEditor: { kind: 'dom', editor: createNumberEditor({ min: 0, max, step: max / 20 }) },
		filterDef: { type: 'number' },
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
