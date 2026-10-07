import { describe, expect, it } from 'vitest';
import { buildFilterByValue, restoreFilterModel, summarizeFilter } from '../filterOperations.js';
import type { ColumnFilter } from '../filterModel.js';
import type { ColumnFilterDef } from './filterDef.js';
import { prepareColumnFilter } from './matchFilter.js';

function matches(filter: ColumnFilter, values: unknown[], def: ColumnFilterDef | null = null): boolean[] {
	const match = prepareColumnFilter(filter, def)!;
	return values.map((v) => match(v, {}));
}

describe('shared filter matching', () => {
	it('select on list cells: any, all and none of the chosen values', () => {
		const cells = [['bug', 'perf'], ['docs'], 'bug,docs', []];
		const list: ColumnFilterDef = { type: 'select', listValues: true };
		expect(matches({ type: 'select', values: ['bug'] }, cells, list)).toEqual([true, false, true, false]);
		expect(matches({ type: 'select', values: ['bug', 'docs'], matchMode: 'all' }, cells, list)).toEqual([false, false, true, false]);
		expect(matches({ type: 'select', values: ['bug'], matchMode: 'none' }, cells, list)).toEqual([false, true, false, true]);
		expect(matches({ type: 'select', values: [null] }, cells, list)).toEqual([false, false, false, true]);
	});

	it('boolean, in the value’s own shapes', () => {
		expect(matches({ type: 'boolean', value: true }, [true, 'true', 1, false, null])).toEqual([true, true, true, false, false]);
		expect(matches({ type: 'boolean', value: false }, [true, false, '', null])).toEqual([false, true, true, true]);
	});

	it('date ranges: overlaps, within, contains', () => {
		const cells = [{ start: '2026-03-01', end: '2026-03-10' }, ['2026-03-20', '2026-03-25'], '2026-02-01/2026-02-05', null];
		expect(matches({ type: 'dateRange', operator: 'overlaps', dateFrom: '2026-03-05', dateTo: '2026-03-21' }, cells)).toEqual([
			true,
			true,
			false,
			false,
		]);
		expect(matches({ type: 'dateRange', operator: 'within', dateFrom: '2026-03-01', dateTo: '2026-03-31' }, cells)).toEqual([
			true,
			true,
			false,
			false,
		]);
		expect(matches({ type: 'dateRange', operator: 'contains', dateFrom: '2026-03-22' }, cells)).toEqual([false, true, false, false]);
	});

	it('paths: a chosen node matches everything under it', () => {
		const cells = [['in', 'ka', 'blr'], ['in', 'mh', 'bom'], 'us/ca/sf', null];
		expect(matches({ type: 'path', paths: [['in', 'ka']] }, cells)).toEqual([true, false, false, false]);
		expect(matches({ type: 'path', paths: [['in'], ['us', 'ca', 'sf']] }, cells)).toEqual([true, true, true, false]);
	});

	it('dates compare as local calendar days', () => {
		expect(matches({ type: 'date', operator: 'equals', dateFrom: '2026-03-04' }, ['2026-03-04', '2026-03-04T23:30', '2026-03-05'])).toEqual([
			true,
			true,
			false,
		]);
	});

	it('custom filters match through the definition; compound joins two conditions', () => {
		const def: ColumnFilterDef = { type: 'custom', matches: (value, filter) => Number(value) % (filter as { value: number }).value === 0 };
		expect(matches({ type: 'custom', value: 3 }, [3, 4, 9], def)).toEqual([true, false, true]);
		const either: ColumnFilter = {
			type: 'compound',
			operator: 'OR',
			conditions: [
				{ type: 'number', operator: 'lt', value: 10 },
				{ type: 'number', operator: 'gt', value: 100 },
			],
		};
		expect(matches(either, [5, 50, 500, null])).toEqual([true, false, true, false]);
	});
});

describe('filter model helpers', () => {
	it('filter by value follows the column’s filter type', () => {
		const status = { field: 'status', filterDef: { type: 'select' } as ColumnFilterDef };
		const once = buildFilterByValue(status, 'Done', false, null);
		expect(once).toEqual({ status: { type: 'select', values: ['Done'], matchMode: 'any' } });
		expect(buildFilterByValue(status, 'Open', false, once)).toEqual({ status: { type: 'select', values: ['Done', 'Open'], matchMode: 'any' } });
		expect(buildFilterByValue({ field: 'ok', filterDef: { type: 'boolean' } }, 'true', true, null)).toEqual({
			ok: { type: 'boolean', value: false },
		});
	});

	it('summarizes filters for chips', () => {
		expect(summarizeFilter({ type: 'select', values: ['a', 'b', 'c'], labels: ['A', 'B', 'C'], matchMode: 'none' })).toBe('not A, B +1');
		expect(summarizeFilter({ type: 'number', operator: 'gte', value: 3 }, { type: 'number', stars: 5 })).toBe('★★★ or more');
		expect(summarizeFilter({ type: 'boolean', value: true })).toBe('Yes');
	});

	it('restoring drops filters on missing columns and malformed ones', () => {
		const restored = restoreFilterModel(
			{ a: { type: 'text', operator: 'contains', value: 'x' }, gone: { type: 'text', operator: 'contains', value: 'y' }, b: { type: 'nope' } },
			new Set(['a', 'b'])
		);
		expect(restored).toEqual({ a: { type: 'text', operator: 'contains', value: 'x' } });
	});
});
