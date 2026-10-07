/**
 * Filter matching: one implementation for every place filters apply (the filter model, the query
 * builder's conditions, “filter by value”). A condition is prepared once (values parsed, sets
 * built) and then matched per row.
 */
import { parseCascadeValue } from '../cells/cascade.js';
import { parseDateRange } from '../cells/dateRange.js';
import { isCheckedCellValue, parseCellDate, parseMultiValue } from '../cells/format.js';
import type { ColumnFilter, FilterCondition } from '../filterModel.js';
import type { ColumnFilterDef } from './filterDef.js';
import { relativeDateRange } from './relativeDates.js';

/** Matches one cell value (plus its row, for custom filters). */
export type PreparedFilterMatcher = (value: unknown, row: unknown) => boolean;

function isBlank(value: unknown): boolean {
	return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function day(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function prepareCondition(condition: FilterCondition, def: ColumnFilterDef<any> | null): PreparedFilterMatcher | null {
	switch (condition.type) {
		case 'text': {
			const op = condition.operator;
			if (op === 'blank') return (v) => isBlank(v);
			if (op === 'notBlank') return (v) => !isBlank(v);
			const needle = String(condition.value ?? '').toLowerCase();
			const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')).toLowerCase();
			switch (op) {
				case 'equals':
					return (v) => text(v) === needle;
				case 'notEquals':
					return (v) => text(v) !== needle;
				case 'startsWith':
					return (v) => text(v).startsWith(needle);
				case 'endsWith':
					return (v) => text(v).endsWith(needle);
				case 'notContains':
					return (v) => !text(v).includes(needle);
				default:
					return (v) => text(v).includes(needle);
			}
		}
		case 'number': {
			const op = condition.operator;
			if (op === 'blank') return (v) => isBlank(v);
			if (op === 'notBlank') return (v) => !isBlank(v);
			const a = Number(condition.value);
			const b = condition.valueTo === undefined ? undefined : Number(condition.valueTo);
			if (Number.isNaN(a)) return null;
			const num = (v: unknown) => (isBlank(v) ? NaN : Number(v));
			switch (op) {
				case 'equals':
					return (v) => num(v) === a;
				case 'notEquals':
					return (v) => !isBlank(v) && num(v) !== a;
				case 'gt':
					return (v) => num(v) > a;
				case 'gte':
					return (v) => num(v) >= a;
				case 'lt':
					return (v) => num(v) < a;
				case 'lte':
					return (v) => num(v) <= a;
				case 'inRange':
					return (v) => {
						const n = num(v);
						return n >= a && (b === undefined || Number.isNaN(b) || n <= b);
					};
			}
			return null;
		}
		case 'date': {
			const op = condition.operator;
			if (op === 'blank') return (v) => isBlank(v);
			if (op === 'notBlank') return (v) => !isBlank(v);
			if (op === 'inLast' || op === 'inNext' || op === 'period') {
				// Resolved against today each time the filter is prepared.
				const range = relativeDateRange(condition, new Date(), def?.weekStartsOn ?? 1);
				if (!range) return null;
				const lo = day(range.from);
				const hi = day(range.to);
				return (v) => {
					const d = parseCellDate(v);
					const n = d ? day(d) : NaN;
					return n >= lo && n <= hi;
				};
			}
			const from = parseCellDate(condition.dateFrom);
			if (!from) return null;
			const to = condition.dateTo ? parseCellDate(condition.dateTo) : null;
			const f = day(from);
			const t = to ? day(to) : null;
			// Days are compared as local calendar days, whatever time a cell carries.
			const cellDay = (v: unknown) => {
				const d = parseCellDate(v);
				return d ? day(d) : NaN;
			};
			switch (op) {
				case 'equals':
					return (v) => cellDay(v) === f;
				case 'before':
					return (v) => cellDay(v) < f;
				case 'after':
					return (v) => cellDay(v) > f;
				case 'inRange':
					return (v) => {
						const d = cellDay(v);
						return d >= f && (t === null || d <= t);
					};
			}
			return null;
		}
		case 'select': {
			const wantsBlank = condition.values.includes(null);
			const chosen = new Set(condition.values.filter((v) => v !== null).map((v) => String(v).toLowerCase()));
			const mode = condition.matchMode ?? 'any';
			const listCells = !!def?.listValues;
			return (v) => {
				const items =
					listCells || Array.isArray(v) ? parseMultiValue(v).map((x) => x.toLowerCase()) : isBlank(v) ? [] : [String(v).toLowerCase()];
				if (items.length === 0) return mode === 'none' ? !wantsBlank : wantsBlank;
				if (mode === 'none') return !items.some((x) => chosen.has(x));
				if (mode === 'all') return chosen.size > 0 && [...chosen].every((c) => items.includes(c));
				return items.some((x) => chosen.has(x));
			};
		}
		case 'boolean': {
			const want = condition.value;
			return (v) => isCheckedCellValue(v) === want;
		}
		case 'dateRange': {
			const from = parseCellDate(condition.dateFrom);
			if (!from) return null;
			const f = day(from);
			const toDate = condition.dateTo ? parseCellDate(condition.dateTo) : null;
			const t = toDate ? day(toDate) : f;
			return (v) => {
				const range = parseDateRange(v);
				if (!range) return false;
				const s = day(range.start);
				const e = day(range.end);
				if (condition.operator === 'contains') return s <= f && f <= e;
				if (condition.operator === 'within') return s >= f && e <= t;
				return s <= t && e >= f;
			};
		}
		case 'path': {
			const cascade = def?.cascade;
			const separator = cascade && 'config' in cascade ? cascade.config.valueSeparator : cascade?.valueSeparator;
			const paths = condition.paths.filter((p) => p.length > 0);
			if (paths.length === 0) return null;
			return (v) => {
				const cell = parseCascadeValue(v, separator);
				return paths.some((p) => p.length <= cell.length && p.every((segment, i) => segment === cell[i]));
			};
		}
		case 'custom': {
			const matches = def?.matches;
			// Without client-side matching a custom filter is the server's business: let rows through.
			if (!matches) return () => true;
			return (v, row) => matches(v, condition, row);
		}
	}
	return null;
}

/**
 * A row matcher for a column filter (a condition, or two joined by AND / OR). Null when the
 * filter cannot apply (an unparseable date…): callers treat that as no filter.
 */
export function prepareColumnFilter(filter: ColumnFilter, def: ColumnFilterDef<any> | null): PreparedFilterMatcher | null {
	if (filter.type === 'compound') {
		const [a, b] = filter.conditions;
		const left = prepareCondition(a, def);
		const right = prepareCondition(b, def);
		if (!left || !right) return left ?? right;
		return filter.operator === 'AND' ? (v, r) => left(v, r) && right(v, r) : (v, r) => left(v, r) || right(v, r);
	}
	return prepareCondition(filter, def);
}
