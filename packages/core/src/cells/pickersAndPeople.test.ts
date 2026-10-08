// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomCellEditor, DomCellRenderer } from '../columnDef.js';
import { createCellCalendar } from './calendar.js';
import { createPersonEditor } from './editors.js';
import { createDateRenderer, createPersonRenderer, createProgressRenderer, createRatingRenderer, type PersonOption } from './renderers.js';

function mountRenderer(renderer: DomCellRenderer<any>, value: unknown) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const api = { selectCell: vi.fn(), setCellValue: vi.fn() };
	const params = (v: unknown) =>
		({ container, value: v, node: { id: 'r1', data: {} }, col: { field: 'f', header: 'F' }, api, isEditing: false, phase: 'live' }) as any;
	const handle = renderer.mount(container, params(value));
	return { container, api, update: (v: unknown) => handle.update(params(v)) };
}

function mountEditor(editor: DomCellEditor<any>, value: unknown) {
	const container = document.createElement('div');
	document.body.appendChild(container);
	const onCommit = vi.fn();
	const handle = editor.mount(container, {
		rowId: 'r1',
		colField: 'f',
		value,
		onChange: vi.fn(),
		onCommit,
		onCancel: vi.fn(),
		api: {} as any,
		col: { field: 'f', header: 'Owner' },
	});
	return { container, onCommit, handle, popover: document.querySelector<HTMLElement>('.og-ct-popover') };
}

const key = (target: Element, k: string, shiftKey = false) =>
	target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));

afterEach(() => {
	document.body.textContent = '';
});

describe('calendar', () => {
	const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

	it('keys move by day, week, month and year, Home / End go to the week ends, Enter picks', () => {
		const onSelect = vi.fn();
		// Wednesday 2026-03-04; weeks start on Monday.
		const calendar = createCellCalendar({ value: new Date(2026, 2, 4), onSelect });
		document.body.appendChild(calendar.element);
		const grid = calendar.element.querySelector('.og-ct-cal-grid')!;
		const pick = (...keys: [string, boolean?][]) => {
			for (const [k, shift] of keys) key(grid, k, shift);
			key(grid, 'Enter');
			return iso(onSelect.mock.calls.at(-1)![0]);
		};
		expect(pick(['ArrowRight'])).toBe('2026-03-05');
		expect(pick(['ArrowDown'])).toBe('2026-03-12');
		expect(pick(['ArrowLeft'], ['ArrowUp'])).toBe('2026-03-04');
		expect(pick(['Home'])).toBe('2026-03-02');
		expect(pick(['End'])).toBe('2026-03-08');
		expect(pick(['PageDown'])).toBe('2026-04-08');
		expect(pick(['PageDown', true])).toBe('2027-04-08');
	});

	it('a month on from the 31st lands on the last day of a shorter month', () => {
		const onSelect = vi.fn();
		const calendar = createCellCalendar({ value: new Date(2026, 0, 31), onSelect });
		document.body.appendChild(calendar.element);
		const grid = calendar.element.querySelector('.og-ct-cal-grid')!;
		key(grid, 'PageDown');
		key(grid, 'Enter');
		expect(iso(onSelect.mock.calls[0][0])).toBe('2026-02-28');
	});

	it('the month buttons page the grid; Today and Clear', () => {
		const onSelect = vi.fn();
		const onClear = vi.fn();
		const calendar = createCellCalendar({ value: new Date(2026, 0, 31), onSelect, onClear });
		document.body.appendChild(calendar.element);
		const title = () => calendar.element.querySelector('[aria-live]')!.textContent;
		const before = title();
		calendar.element.querySelector<HTMLElement>('.og-ct-cal-nav:last-of-type')!.click();
		expect(title()).not.toBe(before);
		const buttons = [...calendar.element.querySelectorAll<HTMLElement>('.og-ct-cal-foot .og-ct-btn')];
		buttons.find((b) => /today/i.test(b.textContent ?? ''))!.click();
		expect(iso(onSelect.mock.calls[0][0])).toBe(iso(new Date()));
		buttons.find((b) => /clear/i.test(b.textContent ?? ''))!.click();
		expect(onClear).toHaveBeenCalled();
	});

	it('setValue shows and selects a typed date', () => {
		const calendar = createCellCalendar({ value: null, onSelect: vi.fn() });
		document.body.appendChild(calendar.element);
		calendar.setValue(new Date(2025, 6, 9));
		expect(calendar.element.querySelector('[aria-selected=true]')!.textContent).toBe('9');
	});
});

describe('rating', () => {
	it('shows N of max; a press rates, pressing the current star clears', () => {
		const { container, api, update } = mountRenderer(createRatingRenderer({ max: 5 }), 3);
		const stars = container.querySelectorAll<HTMLElement>('.og-ct-star');
		expect(container.querySelector('.og-ct-stars')!.getAttribute('aria-label')).toBe('3 of 5');
		expect(container.querySelectorAll('.og-ct-star[data-on]')).toHaveLength(3);
		stars[3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
		expect(api.setCellValue).toHaveBeenLastCalledWith('r1', 'f', 4);
		stars[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
		expect(api.setCellValue).toHaveBeenLastCalledWith('r1', 'f', 0);
		update(9);
		expect(container.querySelectorAll('.og-ct-star[data-on]')).toHaveLength(5);
	});

	it('read-only ratings ignore presses', () => {
		const { container, api } = mountRenderer(createRatingRenderer({ interactive: false }), 2);
		container.querySelector('.og-ct-star')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
		expect(api.setCellValue).not.toHaveBeenCalled();
	});
});

describe('progress', () => {
	it('fills to the value over max, labels the percent, clamps', () => {
		const { container, update } = mountRenderer(createProgressRenderer(), 40);
		const bar = container.querySelector<HTMLElement>('.og-ct-progress > i')!;
		expect(bar.style.width).toBe('40%');
		expect(container.querySelector('.og-ct-progress-label')!.textContent).toBe('40%');
		update(250);
		expect(bar.style.width).toBe('100%');
		update(null);
		expect(container.querySelector('.og-ct-progress-label')!.textContent).toBe('');
	});

	it('fractions with max 1; traffic colours by fill', () => {
		const { container, update } = mountRenderer(createProgressRenderer({ max: 1, traffic: true }), 0.2);
		const bar = container.querySelector<HTMLElement>('.og-ct-progress > i')!;
		expect(bar.style.width).toBe('20%');
		expect(bar.style.background).toContain('--og-ct-danger');
		update(0.9);
		expect(container.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('90');
		expect(bar.style.background).not.toContain('--og-ct-danger');
	});
});

describe('people', () => {
	const PEOPLE: PersonOption[] = [
		{ value: 'ava', label: 'Ava Chen', description: 'Engineering' },
		{ value: 'liam', label: 'Liam Novak' },
		{ value: 'noah', label: 'Noah Patel' },
		{ value: 'mia', label: 'Mia Rossi' },
	];

	it('one person: avatar initials and name; several: an avatar stack and +N', () => {
		const one = mountRenderer(createPersonRenderer({ people: PEOPLE }), 'ava');
		expect(one.container.querySelector('.og-ct-avatar')!.textContent).toBe('AC');
		expect(one.container.textContent).toContain('Ava Chen');
		const many = mountRenderer(createPersonRenderer({ people: PEOPLE, multiple: true, maxVisible: 2 }), 'ava, liam, noah, mia');
		expect(many.container.querySelectorAll('.og-ct-avatars .og-ct-avatar')).toHaveLength(2);
		expect(many.container.querySelector('.og-ct-more')!.textContent).toBe('+2');
		// Someone not in the list still shows, by their value.
		const unknown = mountRenderer(createPersonRenderer({ people: PEOPLE }), 'zoe');
		expect(unknown.container.textContent).toContain('zoe');
	});

	it('the editor lists people with their role and commits the pick', () => {
		const { popover, onCommit } = mountEditor(createPersonEditor(PEOPLE), 'liam');
		const options = [...popover!.querySelectorAll<HTMLElement>('.og-ct-option')];
		expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Engineering')]));
		const ava = options.find((o) => o.textContent?.includes('Ava Chen'))!;
		ava.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		ava.click();
		expect(onCommit).toHaveBeenCalledWith('ava');
	});
});

describe('dates', () => {
	it('a date reads as a local day; date-times get the clock icon', () => {
		const date = mountRenderer(createDateRenderer(), '2026-03-04');
		expect(date.container.textContent).toMatch(/2026/);
		expect(date.container.textContent).toMatch(/4/);
		const time = mountRenderer(createDateRenderer({ withTime: true }), '2026-03-04T09:30');
		expect(time.container.querySelector('.og-ct-icon svg')).toBeTruthy();
		expect(time.container.textContent).toMatch(/9|09/);
		const empty = mountRenderer(createDateRenderer(), '');
		expect(empty.container.textContent).toBe('');
	});
});
