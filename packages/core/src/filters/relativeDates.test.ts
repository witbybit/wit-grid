// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnFilter } from '../filterModel.js';
import { restoreColumnFilter, summarizeFilter } from '../filterOperations.js';
import { createFilterEditor } from './filterEditors.js';
import { prepareColumnFilter } from './matchFilter.js';
import { relativeDateRange } from './relativeDates.js';

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const span = (range: { from: Date; to: Date } | null) => (range ? `${iso(range.from)}..${iso(range.to)}` : null);

// Wednesday 2026-03-04, mid-afternoon.
const NOW = new Date(2026, 2, 4, 15, 30);

afterEach(() => {
	vi.useRealTimers();
	document.body.textContent = '';
});

describe('relativeDateRange', () => {
	it('in the last / next N units include today', () => {
		expect(span(relativeDateRange({ operator: 'inLast', amount: 7, unit: 'day' }, NOW))).toBe('2026-02-26..2026-03-04');
		expect(span(relativeDateRange({ operator: 'inNext', amount: 2, unit: 'week' }, NOW))).toBe('2026-03-04..2026-03-17');
		expect(span(relativeDateRange({ operator: 'inLast', amount: 1, unit: 'month' }, NOW))).toBe('2026-02-05..2026-03-04');
		expect(span(relativeDateRange({ operator: 'inLast', amount: 1, unit: 'year' }, NOW))).toBe('2025-03-05..2026-03-04');
	});

	it('periods: days, weeks (from weekStartsOn), months, quarters, years', () => {
		const p = (period: string, weekStartsOn = 1) => span(relativeDateRange({ operator: 'period', period: period as never }, NOW, weekStartsOn));
		expect(p('today')).toBe('2026-03-04..2026-03-04');
		expect(p('yesterday')).toBe('2026-03-03..2026-03-03');
		expect(p('thisWeek')).toBe('2026-03-02..2026-03-08');
		expect(p('thisWeek', 0)).toBe('2026-03-01..2026-03-07');
		expect(p('lastWeek')).toBe('2026-02-23..2026-03-01');
		expect(p('nextWeek')).toBe('2026-03-09..2026-03-15');
		expect(p('thisMonth')).toBe('2026-03-01..2026-03-31');
		expect(p('lastMonth')).toBe('2026-02-01..2026-02-28');
		expect(p('thisQuarter')).toBe('2026-01-01..2026-03-31');
		expect(p('lastQuarter')).toBe('2025-10-01..2025-12-31');
		expect(p('lastYear')).toBe('2025-01-01..2025-12-31');
	});

	it('incomplete specs are not ranges', () => {
		expect(relativeDateRange({ operator: 'inLast', amount: 0, unit: 'day' }, NOW)).toBeNull();
		expect(relativeDateRange({ operator: 'inLast', amount: 3 }, NOW)).toBeNull();
		expect(relativeDateRange({ operator: 'period' }, NOW)).toBeNull();
	});
});

describe('relative date filters', () => {
	it('match cells by local day, rolling with today', () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const match = prepareColumnFilter({ type: 'date', operator: 'inLast', dateFrom: '', amount: 7, unit: 'day' }, { type: 'date' })!;
		expect(match('2026-02-26')).toBe(true);
		expect(match('2026-03-04T23:59')).toBe(true);
		expect(match('2026-02-25')).toBe(false);
		expect(match('2026-03-05')).toBe(false);
		expect(match(null)).toBe(false);
		const thisWeek = prepareColumnFilter({ type: 'date', operator: 'period', dateFrom: '', period: 'thisWeek' }, { type: 'date', weekStartsOn: 0 })!;
		expect(thisWeek('2026-03-01')).toBe(true);
		expect(thisWeek('2026-03-08')).toBe(false);
	});

	it('summarize and restore', () => {
		const last: ColumnFilter = { type: 'date', operator: 'inLast', dateFrom: '', amount: 30, unit: 'day' };
		expect(summarizeFilter(last)).toBe('in the last 30 days');
		expect(summarizeFilter({ type: 'date', operator: 'inNext', dateFrom: '', amount: 1, unit: 'week' })).toBe('in the next week');
		expect(summarizeFilter({ type: 'date', operator: 'period', dateFrom: '', period: 'thisMonth' })).toBe('this month');
		expect(restoreColumnFilter(last)).toEqual(last);
		expect(restoreColumnFilter({ ...last, unit: 'fortnight' })).toBeNull();
		expect(restoreColumnFilter({ type: 'date', operator: 'period', dateFrom: '', period: 'someday' })).toBeNull();
	});

	it('the date editor: In the last N units, and period chips', () => {
		const container = document.body.appendChild(document.createElement('div'));
		const onChange = vi.fn();
		createFilterEditor({ type: 'date' }, 'popover').mount(container, {
			colField: 'due',
			filterDef: { type: 'date' },
			filter: { type: 'date', operator: 'inLast', dateFrom: '', amount: 14, unit: 'day' },
			surface: 'popover',
			onChange,
		});
		const [amount, unit] = container.querySelectorAll<HTMLInputElement & HTMLSelectElement>('.og-flt-input');
		expect(amount.value).toBe('14');
		unit.value = 'week';
		unit.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onChange).toHaveBeenLastCalledWith({ type: 'date', operator: 'inLast', dateFrom: '', amount: 14, unit: 'week' });

		document.body.textContent = '';
		const periodHost = document.body.appendChild(document.createElement('div'));
		createFilterEditor({ type: 'date' }, 'popover').mount(periodHost, {
			colField: 'due',
			filterDef: { type: 'date' },
			filter: { type: 'date', operator: 'period', dateFrom: '', period: 'today' },
			surface: 'popover',
			onChange,
		});
		const chips = [...periodHost.querySelectorAll<HTMLElement>('.og-flt-period')];
		expect(chips.find((c) => c.getAttribute('aria-checked') === 'true')!.textContent).toBe('Today');
		chips.find((c) => c.textContent === 'Last month')!.click();
		expect(onChange).toHaveBeenLastCalledWith({ type: 'date', operator: 'period', dateFrom: '', period: 'lastMonth' });
	});
});
