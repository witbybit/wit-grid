// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef, DomCellRenderer } from '../../columnDef.js';
import { createCalendarView, readCalendarRange, shiftCalendarValue } from './calendarView.js';
import { createGalleryView } from './galleryView.js';
import type { GridViewContext, ViewRow } from './viewContext.js';

interface Task {
	task: string;
	status: string;
	plan: unknown;
}

function context(rows: ViewRow<Task>[], columns: ColumnDef<Task>[]) {
	const setCellValue = vi.fn();
	const openInTable = vi.fn();
	const ctx: GridViewContext<Task> = {
		api: { setCellValue } as unknown as GridViewContext<Task>['api'],
		rows: () => rows,
		columns: () => columns,
		openInTable,
	};
	return { ctx, setCellValue, openInTable };
}

const sized = (el: HTMLElement, width: number, height: number) => {
	Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
	Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
};

afterEach(() => {
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('calendar values', () => {
	it('reads single dates and ranges as day ranges', () => {
		expect(readCalendarRange('2026-03-04')!.end.getDate()).toBe(4);
		const range = readCalendarRange({ start: '2026-03-04', end: '2026-03-09' })!;
		expect([range.start.getDate(), range.end.getDate()]).toEqual([4, 9]);
		expect(readCalendarRange('soon')).toBeNull();
	});

	it('shifts by whole days, keeping the shape the cell held', () => {
		expect(shiftCalendarValue('2026-03-30', 3)).toBe('2026-04-02');
		expect(shiftCalendarValue('2026-03-30T09:15', 1)).toBe('2026-03-31T09:15');
		expect(shiftCalendarValue({ start: '2026-03-01', end: '2026-03-03' }, 7)).toEqual({ start: '2026-03-08', end: '2026-03-10' });
		expect(shiftCalendarValue(['2026-03-01', '2026-03-03'], -1)).toEqual(['2026-02-28', '2026-03-02']);
		expect(shiftCalendarValue(1_000, 1)).toBe(1_000 + 86_400_000);
		expect((shiftCalendarValue(new Date(2026, 2, 1), 2) as Date).getDate()).toBe(3);
	});
});

describe('calendar view', () => {
	const columns: ColumnDef<Task>[] = [{ field: 'task' }, { field: 'status' }];

	function mount(rows: ViewRow<Task>[], dayHeight = 200) {
		const host = document.createElement('div');
		document.body.appendChild(host);
		const { ctx, setCellValue, openInTable } = context(rows, columns);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(dayHeight);
		const view = createCalendarView(host, ctx, { kind: 'calendar', dateField: 'plan', initialDate: '2026-03-01' });
		view.render();
		const day = (date: string) => host.querySelector<HTMLElement>(`.og-view-cal-day[data-date="${date}"]`)!;
		return { host, view, day, setCellValue, openInTable };
	}

	it('shows the month in six weeks from the week start, ranges spanning their days', () => {
		const { host, day } = mount([
			{ id: 'a', data: { task: 'Launch', status: 'todo', plan: '2026-03-10' } },
			{ id: 'b', data: { task: 'Sprint', status: 'todo', plan: { start: '2026-03-12', end: '2026-03-17' } } },
		]);
		expect(host.querySelector('.og-view-cal-label')!.textContent).toMatch(/March/);
		// March 2026 starts on a Sunday: a Monday-first grid opens on Feb 23.
		expect(host.querySelector<HTMLElement>('.og-view-cal-day')!.dataset.date).toBe('2026-02-23');
		expect(day('2026-03-10').textContent).toContain('Launch');
		const spans = host.querySelectorAll('.og-view-cal-entry[data-row-id="b"]');
		expect(spans).toHaveLength(6);
		expect(day('2026-03-12').querySelector('[data-start]')).not.toBeNull();
		expect(day('2026-03-17').querySelector('[data-end]')).not.toBeNull();
		// Monday the 16th starts a new week: the label repeats there.
		expect(day('2026-03-16').querySelector('[data-week-start]')).not.toBeNull();
	});

	it('collapses a crowded day into "+N more", always keeping one entry', () => {
		const rows = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, data: { task: `T${i}`, status: 'todo', plan: '2026-03-10' } }));
		const { day } = mount(rows, 64);
		expect(day('2026-03-10').querySelectorAll('.og-view-cal-entry')).toHaveLength(1);
		expect(day('2026-03-10').querySelector('.og-view-cal-more')!.textContent).toBe('+5 more');
	});

	it('moves an entry by the days it is dragged, and opens it in the table on double-click', () => {
		const { host, day, setCellValue, openInTable } = mount([
			{ id: 'b', data: { task: 'Sprint', status: 'todo', plan: { start: '2026-03-12', end: '2026-03-13' } } },
		]);
		const entry = day('2026-03-12').querySelector<HTMLElement>('.og-view-cal-entry')!;
		const grid = host.querySelector<HTMLElement>('.og-view-cal-grid')!;
		document.elementFromPoint = vi.fn(() => day('2026-03-19'));
		entry.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 10, clientY: 10 }));
		// Under the drag threshold: still a click, nothing lights up.
		grid.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 12, clientY: 11 }));
		expect(host.querySelector('[data-drop-span]')).toBeNull();
		grid.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 60, clientY: 80 }));
		// The days it would cover light up, the original dims, and the ghost says where it goes.
		expect(day('2026-03-19').hasAttribute('data-drop-first')).toBe(true);
		expect(day('2026-03-20').hasAttribute('data-drop-last')).toBe(true);
		expect(entry.hasAttribute('data-drag-source')).toBe(true);
		const ghost = host.querySelector<HTMLElement>('.og-view-cal-ghost')!;
		expect(ghost.hidden).toBe(false);
		expect(ghost.textContent).toContain('+7 days');
		grid.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 60, clientY: 80 }));
		expect(setCellValue).toHaveBeenCalledWith('b', 'plan', { start: '2026-03-19', end: '2026-03-20' });
		expect(ghost.hidden).toBe(true);
		expect(host.querySelector('[data-drop-span]')).toBeNull();

		entry.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		expect(openInTable).toHaveBeenCalledWith('b');
	});

	it('cancels a drag with Escape, and holds live redraws until the drop', () => {
		const rows = [{ id: 'b', data: { task: 'Sprint', status: 'todo', plan: { start: '2026-03-12', end: '2026-03-13' } as unknown } }];
		const { host, view, day, setCellValue } = mount(rows);
		const entry = day('2026-03-12').querySelector<HTMLElement>('.og-view-cal-entry')!;
		const grid = host.querySelector<HTMLElement>('.og-view-cal-grid')!;
		document.elementFromPoint = vi.fn(() => day('2026-03-19'));
		entry.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 10, clientY: 10 }));
		grid.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 60, clientY: 80 }));
		// A live update mid-drag does not rebuild the entries under the pointer.
		rows[0].data.plan = { start: '2026-03-02', end: '2026-03-02' };
		view.render();
		expect(day('2026-03-12').querySelector('.og-view-cal-entry')).toBe(entry);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(host.querySelector('[data-drop-span]')).toBeNull();
		// The held redraw runs on cancel.
		expect(day('2026-03-02').textContent).toContain('Sprint');
		grid.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
		expect(setCellValue).not.toHaveBeenCalled();
	});

	it('opens a card on click with dates, fields and actions that nudge the entry', () => {
		const rows = [{ id: 'b', data: { task: 'Sprint', status: 'todo', plan: { start: '2026-03-12', end: '2026-03-13' } as unknown } }];
		const { host, day, setCellValue, openInTable } = mount(rows);
		const entry = day('2026-03-12').querySelector<HTMLElement>('.og-view-cal-entry')!;
		entry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		const popover = host.querySelector<HTMLElement>('.og-view-cal-popover')!;
		expect(popover.querySelector('strong')!.textContent).toBe('Sprint');
		expect(popover.querySelector('.og-view-pop-dates')!.textContent).toMatch(/2 days/);
		// The default fields: the displayed columns other than the title and the date field.
		expect([...popover.querySelectorAll('.og-view-field-label')].map((l) => l.textContent)).toEqual(['status']);
		popover.querySelector<HTMLElement>('[data-move="7"]')!.click();
		expect(setCellValue).toHaveBeenCalledWith('b', 'plan', { start: '2026-03-19', end: '2026-03-20' });
		// A nudge keeps the card open; a click elsewhere closes it.
		expect(host.querySelector('.og-view-cal-popover')).not.toBeNull();
		day('2026-03-02').dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(host.querySelector('.og-view-cal-popover')).toBeNull();

		entry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		host.querySelector<HTMLElement>('[data-pop="open"]')!.click();
		expect(openInTable).toHaveBeenCalledWith('b');
		expect(host.querySelector('.og-view-cal-popover')).toBeNull();
	});

	it('steps between months', () => {
		const { host } = mount([]);
		host.querySelector<HTMLElement>('[data-action="next"]')!.click();
		expect(host.querySelector('.og-view-cal-label')!.textContent).toMatch(/April/);
		host.querySelector<HTMLElement>('[data-action="prev"]')!.click();
		host.querySelector<HTMLElement>('[data-action="prev"]')!.click();
		expect(host.querySelector('.og-view-cal-label')!.textContent).toMatch(/February/);
	});
});

describe('gallery view', () => {
	const statusRenderer: DomCellRenderer<Task> = {
		mount(container, params) {
			const pill = document.createElement('b');
			pill.className = 'pill';
			pill.textContent = String(params.value);
			container.appendChild(pill);
			return { update: (p) => void (pill.textContent = String(p.value)) };
		},
	};
	const columns: ColumnDef<Task>[] = [
		{ field: 'task', header: 'Task' },
		{ field: 'status', header: 'Status', renderer: { kind: 'dom', renderer: statusRenderer } },
		{ field: 'plan', header: 'Plan', valueFormatter: ({ value }) => `plan ${value}` },
	];
	const rows = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, data: { task: `Task ${i}`, status: i % 2 ? 'done' : 'todo', plan: i } }));

	function mount() {
		const host = document.createElement('div');
		document.body.appendChild(host);
		const { ctx, openInTable } = context(rows, columns);
		const view = createGalleryView(host, ctx, {
			kind: 'gallery',
			titleField: 'task',
			color: (row) => (row.status === 'done' ? 'green' : undefined),
		});
		const scroller = host.querySelector<HTMLElement>('.og-view-gallery')!;
		// 1000px wide: three 260px+ cards a row; 400px tall.
		sized(scroller, 1000, 400);
		view.render();
		const visible = () => [...host.querySelectorAll<HTMLElement>('.og-view-card:not([hidden])')];
		return { host, view, scroller, visible, openInTable };
	}

	it('draws only the cards in view (plus overscan), fields through their columns’ renderers', () => {
		const { visible } = mount();
		const cards = visible();
		// Card pitch 40 + 2×30 + 14 + 14 = 128px: rows 0..4 in view, +2 overscan, three a row.
		expect(cards.length).toBeLessThanOrEqual(21);
		expect(cards.length).toBeGreaterThan(9);
		expect(cards[1].querySelector('.og-view-card-title')!.textContent).toBe('Task 1');
		expect(cards[1].querySelector('.pill')!.textContent).toBe('done');
		expect(cards[1].textContent).toContain('plan 1');
		expect(cards[1].querySelector<HTMLElement>('.og-view-card-band')!.hidden).toBe(false);
		expect(cards[0].querySelector<HTMLElement>('.og-view-card-band')!.hidden).toBe(true);
	});

	it('recycles the same cards as it scrolls, and opens a card in the table on double-click', async () => {
		const { host, scroller, visible, openInTable } = mount();
		const scrollTo = async (top: number) => {
			scroller.scrollTop = top;
			scroller.dispatchEvent(new Event('scroll'));
			await new Promise((resolve) => setTimeout(resolve, 40));
		};
		// Mid-list the pool holds overscan both ways; moving further on reuses it.
		await scrollTo(128 * 20);
		const pool = host.querySelectorAll('.og-view-card').length;
		await scrollTo(128 * 30);
		expect(host.querySelectorAll('.og-view-card').length).toBe(pool);
		const first = visible()[0];
		expect(first.querySelector('.og-view-card-title')!.textContent).toBe(`Task ${28 * 3}`);
		first.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		expect(openInTable).toHaveBeenCalledWith(`r${28 * 3}`);
	});
});
