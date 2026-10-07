/**
 * Filter metadata and model helpers shared by every filter surface: operator tables, the text of
 * filter chips, “filter by value”, and filter model edits. All read the column's `filterDef`.
 */
import { parseCascadeValue } from './cells/cascade.js';
import { optionLabel, type CellOption } from './cells/listbox.js';
import { formatCellNumber, isCheckedCellValue, parseMultiValue } from './cells/format.js';
import { isCellOptionsStore } from './cells/optionsStore.js';
import type { ColumnFilter, FilterCondition, FilterModel } from './filterModel.js';
import { resolveColumnFilterDef, type ColumnFilterDef, type FilterConfigColumn } from './filters/filterDef.js';
import { describeRelativeDate, isDatePeriod, isRelativeDateUnit } from './filters/relativeDates.js';

// ── Operators ────────────────────────────────────────────────────────────────

export interface OpOption {
	/** Operator value used in the filter model (e.g. 'contains', 'gt'). */
	value: string;
	/** Full label shown in operator pickers. */
	label: string;
	/** Compact symbol for the floating filter row. */
	symbol: string;
	/** Short label for filter chips; falls back to symbol. */
	chipLabel?: string;
	/** No value needed (blank / not blank). */
	noValue?: boolean;
	/** Two values needed (between). */
	range?: boolean;
	/** A relative date: an amount of units, or a named period. */
	relative?: 'amount' | 'period';
}

export const TEXT_OPS: OpOption[] = [
	{ value: 'contains', label: 'Contains', symbol: '~', chipLabel: 'contains' },
	{ value: 'notContains', label: 'Does not contain', symbol: '!~', chipLabel: 'not contains' },
	{ value: 'equals', label: 'Is', symbol: '=', chipLabel: '=' },
	{ value: 'notEquals', label: 'Is not', symbol: '≠', chipLabel: '≠' },
	{ value: 'startsWith', label: 'Starts with', symbol: '^', chipLabel: 'starts with' },
	{ value: 'endsWith', label: 'Ends with', symbol: '$', chipLabel: 'ends with' },
	{ value: 'blank', label: 'Is empty', symbol: '∅', chipLabel: 'is empty', noValue: true },
	{ value: 'notBlank', label: 'Is not empty', symbol: '!∅', chipLabel: 'not empty', noValue: true },
];

export const NUMBER_OPS: OpOption[] = [
	{ value: 'equals', label: 'Equals', symbol: '=', chipLabel: '=' },
	{ value: 'notEquals', label: 'Does not equal', symbol: '≠', chipLabel: '≠' },
	{ value: 'gt', label: 'Greater than', symbol: '>', chipLabel: '>' },
	{ value: 'gte', label: 'At least', symbol: '≥', chipLabel: '≥' },
	{ value: 'lt', label: 'Less than', symbol: '<', chipLabel: '<' },
	{ value: 'lte', label: 'At most', symbol: '≤', chipLabel: '≤' },
	{ value: 'inRange', label: 'Between', symbol: '↔', chipLabel: 'between', range: true },
	{ value: 'blank', label: 'Is empty', symbol: '∅', chipLabel: 'is empty', noValue: true },
	{ value: 'notBlank', label: 'Is not empty', symbol: '!∅', chipLabel: 'not empty', noValue: true },
];

export const DATE_OPS: OpOption[] = [
	{ value: 'equals', label: 'On', symbol: '=', chipLabel: 'on' },
	{ value: 'before', label: 'Before', symbol: '<', chipLabel: 'before' },
	{ value: 'after', label: 'After', symbol: '>', chipLabel: 'after' },
	{ value: 'inRange', label: 'Between', symbol: '↔', chipLabel: 'between', range: true },
	{ value: 'period', label: 'In period', symbol: '◷', chipLabel: '', relative: 'period' },
	{ value: 'inLast', label: 'In the last', symbol: '≤', chipLabel: 'in the last', relative: 'amount' },
	{ value: 'inNext', label: 'In the next', symbol: '≥', chipLabel: 'in the next', relative: 'amount' },
	{ value: 'blank', label: 'Is empty', symbol: '∅', chipLabel: 'is empty', noValue: true },
	{ value: 'notBlank', label: 'Is not empty', symbol: '!∅', chipLabel: 'not empty', noValue: true },
];

export const DATE_RANGE_OPS: OpOption[] = [
	{ value: 'overlaps', label: 'Overlaps', symbol: '∩', chipLabel: 'overlaps', range: true },
	{ value: 'within', label: 'Within', symbol: '⊂', chipLabel: 'within', range: true },
	{ value: 'contains', label: 'Includes date', symbol: '∋', chipLabel: 'includes' },
];

/** The operators of a filter type, limited to `def.operators` when given. */
export function getOpsForType(type: string, def?: Pick<ColumnFilterDef, 'operators'> | null): OpOption[] {
	const all = type === 'number' ? NUMBER_OPS : type === 'date' ? DATE_OPS : type === 'dateRange' ? DATE_RANGE_OPS : TEXT_OPS;
	const allowed = def?.operators;
	return allowed ? all.filter((op) => allowed.includes(op.value)) : all;
}

export function getOpMeta(type: string, operator: string): OpOption {
	return getOpsForType(type).find((o) => o.value === operator) ?? { value: operator, label: operator, symbol: '~' };
}

export function defaultOpForType(type: string, def?: Pick<ColumnFilterDef, 'operators'> | null): string {
	return getOpsForType(type, def)[0]?.value ?? (type === 'number' || type === 'date' ? 'equals' : type === 'dateRange' ? 'overlaps' : 'contains');
}

/** True when the column filters at all (its filterDef is not `none`). */
export function isFilterableColumn(col: FilterConfigColumn): boolean {
	return resolveColumnFilterDef(col) !== null;
}

// ── Model edits ──────────────────────────────────────────────────────────────

/**
 * A new filter model with `filter` set for `colField` (null clears it). Null when the model ends
 * up empty.
 */
export function applyFilterToModel(colField: string, filter: ColumnFilter | null, currentModel: FilterModel | null): FilterModel | null {
	const next = { ...(currentModel ?? {}) };
	if (filter === null) delete next[colField];
	else next[colField] = filter;
	return Object.keys(next).length > 0 ? next : null;
}

/**
 * “Filter by value” / “Exclude value” from a cell (context menu): a condition of the column's
 * filter type, merged into the model. Select filters add the value to (or exclude it with) the
 * current choice.
 */
export function buildFilterByValue(
	col: FilterConfigColumn,
	rawValue: unknown,
	exclude: boolean,
	currentModel: FilterModel | null
): FilterModel | null {
	const def = resolveColumnFilterDef(col);
	if (!def) return currentModel;
	const filter = filterFromValue(def, rawValue, exclude, currentModel?.[col.field] ?? null);
	return filter ? applyFilterToModel(col.field, filter, currentModel) : currentModel;
}

function filterFromValue(def: ColumnFilterDef, raw: unknown, exclude: boolean, current: ColumnFilter | null): ColumnFilter | null {
	switch (def.type) {
		case 'select': {
			const values = def.listValues || Array.isArray(raw) ? parseMultiValue(raw) : raw == null || raw === '' ? [null] : [String(raw)];
			const mode = exclude ? 'none' : 'any';
			const prior = current?.type === 'select' && (current.matchMode ?? 'any') === mode ? current.values : [];
			return { type: 'select', values: [...new Set([...prior, ...values])], matchMode: mode };
		}
		case 'boolean':
			return { type: 'boolean', value: exclude ? !isCheckedCellValue(raw) : isCheckedCellValue(raw) };
		case 'number': {
			const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
			if (Number.isNaN(n)) return null;
			return { type: 'number', operator: exclude ? 'notEquals' : 'equals', value: n };
		}
		case 'date': {
			const day = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw ?? '').slice(0, 10);
			if (!day) return null;
			return exclude ? { type: 'date', operator: 'after', dateFrom: day } : { type: 'date', operator: 'equals', dateFrom: day };
		}
		case 'path': {
			const cascade = def.cascade;
			const path = parseCascadeValue(raw, cascade && 'config' in cascade ? cascade.config.valueSeparator : cascade?.valueSeparator);
			return path.length > 0 && !exclude ? { type: 'path', paths: [path] } : null;
		}
		case 'text': {
			const text = raw == null ? '' : String(raw);
			return { type: 'text', operator: exclude ? 'notEquals' : 'equals', value: text };
		}
		default:
			return null;
	}
}

// ── Chip text ────────────────────────────────────────────────────────────────

/** The label of a select value, from the filter's stored labels or the column's options. */
function selectLabel(def: ColumnFilterDef | null | undefined, value: string | number | null, stored: string | undefined): string {
	if (value === null) return '(Blanks)';
	if (stored) return stored;
	const options = def?.options;
	const key = String(value);
	const option: CellOption | undefined = isCellOptionsStore(options) ? options.get(key) : options?.find((o) => o.value === key);
	return option ? optionLabel(option) : key;
}

function list(labels: string[], max = 2): string {
	if (labels.length === 0) return '(none)';
	const extra = labels.length > max ? ` +${labels.length - max}` : '';
	return labels.slice(0, max).join(', ') + extra;
}

function summarizeCondition(filter: FilterCondition, def: ColumnFilterDef | null | undefined): string {
	switch (filter.type) {
		case 'text': {
			const op = getOpMeta('text', filter.operator);
			const label = op.chipLabel ?? op.symbol;
			return op.noValue ? label : `${label} “${filter.value}”`;
		}
		case 'number': {
			const op = getOpMeta('number', filter.operator);
			const label = op.chipLabel ?? op.symbol;
			const fmt = (n: number | undefined) => (n === undefined ? '…' : (formatCellNumber(n, def?.format) ?? String(n)));
			if (op.noValue) return label;
			if (def?.stars && filter.operator === 'gte') return `${'★'.repeat(filter.value)} or more`;
			return op.range ? `${fmt(filter.value)} – ${fmt(filter.valueTo)}` : `${label} ${fmt(filter.value)}`;
		}
		case 'date': {
			const op = getOpMeta('date', filter.operator);
			if (op.relative) return describeRelativeDate(filter);
			const label = op.chipLabel ?? op.symbol;
			if (op.noValue) return label;
			return op.range ? `${filter.dateFrom} – ${filter.dateTo ?? '…'}` : `${label} ${filter.dateFrom}`;
		}
		case 'select': {
			const labels = filter.values.map((v, i) => selectLabel(def, v, filter.labels?.[i]));
			const mode = filter.matchMode ?? 'any';
			const prefix = mode === 'none' ? 'not ' : mode === 'all' && filter.values.length > 1 ? 'all of ' : '';
			return prefix + list(labels);
		}
		case 'boolean':
			return filter.value ? 'Yes' : 'No';
		case 'dateRange': {
			const op = getOpMeta('dateRange', filter.operator);
			return op.range ? `${op.chipLabel} ${filter.dateFrom} – ${filter.dateTo ?? '…'}` : `${op.chipLabel} ${filter.dateFrom}`;
		}
		case 'path': {
			const labels = filter.labels ?? filter.paths.map((p) => p[p.length - 1] ?? '');
			return list(labels);
		}
		case 'custom':
			return filter.label ?? 'custom';
	}
}

/** The text of a column's filter chip, e.g. `contains “Atlas”`, `≥ 100`, `Done, Blocked +1`. */
export function summarizeFilter(filter: ColumnFilter, def?: ColumnFilterDef | null): string {
	if (def?.summarize) return def.summarize(filter);
	if (filter.type === 'compound') {
		const [a, b] = filter.conditions;
		return `${summarizeCondition(a, def)} ${filter.operator.toLowerCase()} ${summarizeCondition(b, def)}`;
	}
	return summarizeCondition(filter, def);
}

// ── Restoring saved models ───────────────────────────────────────────────────

const opsOf = (ops: OpOption[]) => new Set(ops.map((op) => op.value));
const TEXT_OP_SET = opsOf(TEXT_OPS);
const NUMBER_OP_SET = opsOf(NUMBER_OPS);
const DATE_OP_SET = opsOf(DATE_OPS);
const DATE_RANGE_OP_SET = opsOf(DATE_RANGE_OPS);
const isString = (value: unknown): value is string => typeof value === 'string';
const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value);

/** A saved condition, checked shape by shape; null when malformed. */
function restoreCondition(raw: unknown): FilterCondition | null {
	if (!raw || typeof raw !== 'object') return null;
	const c = raw as Record<string, unknown>;
	switch (c.type) {
		case 'text':
			return TEXT_OP_SET.has(c.operator as string) && isString(c.value) ? (raw as FilterCondition) : null;
		case 'number':
			return NUMBER_OP_SET.has(c.operator as string) && isNumber(c.value) && (c.valueTo === undefined || isNumber(c.valueTo))
				? (raw as FilterCondition)
				: null;
		case 'date': {
			if (!DATE_OP_SET.has(c.operator as string) || !isString(c.dateFrom) || !isOptionalString(c.dateTo)) return null;
			if (c.operator === 'period') return isDatePeriod(c.period) ? (raw as FilterCondition) : null;
			if (c.operator === 'inLast' || c.operator === 'inNext')
				return isNumber(c.amount) && c.amount >= 1 && isRelativeDateUnit(c.unit) ? (raw as FilterCondition) : null;
			return raw as FilterCondition;
		}
		case 'select':
			return Array.isArray(c.values) &&
				c.values.every((v) => v === null || typeof v === 'string' || typeof v === 'number') &&
				(c.matchMode === undefined || c.matchMode === 'any' || c.matchMode === 'all' || c.matchMode === 'none') &&
				(c.labels === undefined || (Array.isArray(c.labels) && c.labels.every(isString)))
				? (raw as FilterCondition)
				: null;
		case 'boolean':
			return typeof c.value === 'boolean' ? (raw as FilterCondition) : null;
		case 'dateRange':
			return DATE_RANGE_OP_SET.has(c.operator as string) && isString(c.dateFrom) && isOptionalString(c.dateTo) ? (raw as FilterCondition) : null;
		case 'path':
			return Array.isArray(c.paths) && c.paths.every((p) => Array.isArray(p) && p.every(isString)) ? (raw as FilterCondition) : null;
		case 'custom':
			// The value is the custom filter's own; only the envelope is checked.
			return 'value' in c && isOptionalString(c.label) ? (raw as FilterCondition) : null;
		default:
			return null;
	}
}

/** A saved column filter (a condition, or two joined), checked; null when malformed. */
export function restoreColumnFilter(raw: unknown): ColumnFilter | null {
	if (!raw || typeof raw !== 'object') return null;
	const filter = raw as { type?: unknown; operator?: unknown; conditions?: unknown };
	if (filter.type === 'compound') {
		if (!Array.isArray(filter.conditions) || filter.conditions.length !== 2) return null;
		const a = restoreCondition(filter.conditions[0]);
		const b = restoreCondition(filter.conditions[1]);
		if (a && b) return { type: 'compound', operator: filter.operator === 'OR' ? 'OR' : 'AND', conditions: [a, b] };
		return a ?? b;
	}
	return restoreCondition(raw);
}

/**
 * A saved filter model checked against the grid: conditions on columns that no longer exist, and
 * malformed ones, are dropped. Null when nothing is left.
 */
export function restoreFilterModel(raw: unknown, knownFields: ReadonlySet<string>): FilterModel | null {
	if (!raw || typeof raw !== 'object') return null;
	const out: FilterModel = {};
	for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!knownFields.has(field)) continue;
		const filter = restoreColumnFilter(value);
		if (filter) out[field] = filter;
	}
	return Object.keys(out).length > 0 ? out : null;
}
