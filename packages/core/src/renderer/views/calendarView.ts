import type { ColumnDef } from '../../columnDef.js';
import type { CalendarViewConfig } from '../../views.js';
import { parseDateRange, writeDateRange, type DateRange } from '../../cells/dateRange.js';
import { parseCellDate, toIsoDay } from '../../cells/format.js';
import { fieldText, viewColour, type GridViewContext, type GridViewInstance, type ViewRow } from './viewContext.js';

const DAY_MS = 86_400_000;
const WEEKS = 6;
const ENTRY_H = 20;
const DAY_HEADER_H = 24;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);

/** A date or range value as a range (a single date is a one-day range). */
export function readCalendarRange(value: unknown): DateRange | null {
	const range = parseDateRange(value);
	if (range) return range;
	const date = parseCellDate(value);
	return date ? { start: startOfDay(date), end: startOfDay(date) } : null;
}

/** Shifts a date or range value by whole days, written in the shape the cell held. */
export function shiftCalendarValue(value: unknown, days: number): unknown {
	const range = parseDateRange(value);
	if (range) return writeDateRange(value, { start: addDays(range.start, days), end: addDays(range.end, days) });
	if (value instanceof Date) return new Date(value.getTime() + days * DAY_MS);
	if (typeof value === 'number') return value + days * DAY_MS;
	const date = parseCellDate(value);
	if (!date) return value;
	const shifted = toIsoDay(addDays(date, days));
	// Keep a time of day if the value had one.
	return typeof value === 'string' && value.length > 10 ? shifted + value.slice(10) : shifted;
}

interface Entry<TRowData> {
	row: ViewRow<TRowData>;
	range: DateRange;
}

/**
 * The displayed rows on a month calendar, placed by a date or date-range field: ranges span their
 * days, crowded days show "+N more". Drag an entry to another day to move it; double-click to open
 * its row in the table.
 */
export function createCalendarView<TRowData>(host: HTMLElement, context: GridViewContext<TRowData>, config: CalendarViewConfig<TRowData>): GridViewInstance {
	const weekStartsOn = config.weekStartsOn ?? 1;
	const editable = config.editable ?? true;
	const columns = context.columns();
	const titleCol: ColumnDef<TRowData> | undefined = columns.find((c) => c.field === config.titleField) ?? columns[0];
	const initial = config.initialDate ? parseCellDate(config.initialDate) : null;
	let month = new Date((initial ?? new Date()).getFullYear(), (initial ?? new Date()).getMonth(), 1);

	const root = document.createElement('div');
	root.className = 'og-view-calendar';
	const toolbar = document.createElement('div');
	toolbar.className = 'og-view-cal-toolbar';
	const button = (label: string, action: string, title: string) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'og-view-cal-button';
		b.textContent = label;
		b.dataset.action = action;
		b.title = title;
		return b;
	};
	const label = document.createElement('span');
	label.className = 'og-view-cal-label';
	toolbar.append(button('‹', 'prev', 'Previous month'), button('Today', 'today', 'This month'), button('›', 'next', 'Next month'), label);
	const weekdays = document.createElement('div');
	weekdays.className = 'og-view-cal-weekdays';
	const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
	for (let i = 0; i < 7; i++) {
		const cell = document.createElement('span');
		cell.textContent = weekdayFormat.format(new Date(2024, 0, 7 + ((weekStartsOn + i) % 7)));
		weekdays.appendChild(cell);
	}
	const grid = document.createElement('div');
	grid.className = 'og-view-cal-grid';
	const days: { element: HTMLElement; number: HTMLElement; entries: HTMLElement }[] = [];
	for (let i = 0; i < WEEKS * 7; i++) {
		const element = document.createElement('div');
		element.className = 'og-view-cal-day';
		const number = document.createElement('span');
		number.className = 'og-view-cal-date';
		const entries = document.createElement('div');
		entries.className = 'og-view-cal-entries';
		element.append(number, entries);
		grid.appendChild(element);
		days.push({ element, number, entries });
	}
	root.append(toolbar, weekdays, grid);
	host.appendChild(root);

	const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
	const parsed = new WeakMap<object, { value: unknown; range: DateRange | null }>();
	const rangeOf = (row: ViewRow<TRowData>): DateRange | null => {
		const value = (row.data as Record<string, unknown> | null)?.[config.dateField];
		const key = row.data as unknown as object;
		const cached = key && typeof key === 'object' ? parsed.get(key) : undefined;
		if (cached && cached.value === value) return cached.range;
		const range = readCalendarRange(value);
		if (key && typeof key === 'object') parsed.set(key, { value, range });
		return range;
	};

	const firstShown = () => addDays(month, -((month.getDay() - weekStartsOn + 7) % 7));

	const draw = () => {
		const first = firstShown();
		const last = addDays(first, WEEKS * 7 - 1);
		const today = startOfDay(new Date());
		label.textContent = monthFormat.format(month);

		// Each entry on every shown day it covers, in display order.
		const byDay: Entry<TRowData>[][] = days.map(() => []);
		for (const row of context.rows()) {
			const range = rangeOf(row);
			if (!range || range.end < first || range.start > last) continue;
			const from = Math.max(0, daysBetween(first, range.start));
			const to = Math.min(days.length - 1, daysBetween(first, range.end));
			for (let d = from; d <= to; d++) byDay[d].push({ row, range });
		}

		const dayHeight = days[0].element.clientHeight;
		const fits = dayHeight > 0 ? Math.max(1, Math.floor((dayHeight - DAY_HEADER_H) / ENTRY_H)) : 3;
		days.forEach((day, i) => {
			const date = addDays(first, i);
			day.element.dataset.date = toIsoDay(date);
			day.element.toggleAttribute('data-outside', date.getMonth() !== month.getMonth());
			day.element.toggleAttribute('data-today', date.getTime() === today.getTime());
			day.number.textContent = String(date.getDate());
			const list = byDay[i];
			// On overflow the last slot becomes "+N more", but a day always shows at least one entry.
			const shown = list.length > fits ? Math.max(1, fits - 1) : list.length;
			const nodes: HTMLElement[] = [];
			for (let k = 0; k < shown; k++) {
				const { row, range } = list[k];
				const entry = document.createElement('div');
				entry.className = 'og-view-cal-entry';
				entry.dataset.rowId = row.id;
				entry.toggleAttribute('data-start', range.start.getTime() === date.getTime());
				entry.toggleAttribute('data-end', range.end.getTime() === date.getTime());
				// A range wrapping into a new week repeats its label there.
				entry.toggleAttribute('data-week-start', i % 7 === 0);
				const colour = viewColour(config.color?.(row.data));
				if (colour) entry.style.setProperty('--og-view-entry', colour);
				entry.textContent = fieldText(titleCol, row);
				entry.title = entry.textContent;
				if (editable) entry.setAttribute('data-editable', '');
				nodes.push(entry);
			}
			if (list.length > shown) {
				const more = document.createElement('div');
				more.className = 'og-view-cal-more';
				more.textContent = `+${list.length - shown} more`;
				nodes.push(more);
			}
			day.entries.replaceChildren(...nodes);
		});
	};

	// Drag an entry onto another day: the value shifts by the days moved, written once on drop.
	let drag: { rowId: string; from: string; over: HTMLElement | null } | null = null;
	const dayAt = (event: PointerEvent) => (document.elementFromPoint(event.clientX, event.clientY) as Element | null)?.closest<HTMLElement>('.og-view-cal-day') ?? null;
	const onPointerDown = (event: PointerEvent) => {
		const entry = (event.target as Element).closest<HTMLElement>('.og-view-cal-entry[data-editable]');
		const day = entry?.closest<HTMLElement>('.og-view-cal-day');
		if (!entry || !day || event.button !== 0) return;
		event.preventDefault();
		drag = { rowId: entry.dataset.rowId!, from: day.dataset.date!, over: null };
		entry.setPointerCapture?.(event.pointerId);
		root.setAttribute('data-dragging', '');
	};
	const onPointerMove = (event: PointerEvent) => {
		if (!drag) return;
		const day = dayAt(event);
		if (day === drag.over) return;
		drag.over?.removeAttribute('data-drop');
		drag.over = day;
		day?.setAttribute('data-drop', '');
	};
	const onPointerUp = (event: PointerEvent) => {
		if (!drag) return;
		const { rowId, from } = drag;
		const target = dayAt(event)?.dataset.date;
		drag.over?.removeAttribute('data-drop');
		drag = null;
		root.removeAttribute('data-dragging');
		if (!target || target === from) return;
		const shift = daysBetween(new Date(`${from}T00:00:00`), new Date(`${target}T00:00:00`));
		const row = context.rows().find((r) => r.id === rowId);
		if (!row) return;
		const value = (row.data as Record<string, unknown> | null)?.[config.dateField];
		context.api.setCellValue(rowId, config.dateField, shiftCalendarValue(value, shift));
	};
	const onClick = (event: MouseEvent) => {
		const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
		if (!action) return;
		if (action === 'today') month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
		else month = new Date(month.getFullYear(), month.getMonth() + (action === 'next' ? 1 : -1), 1);
		draw();
	};
	const onDoubleClick = (event: MouseEvent) => {
		const entry = (event.target as Element).closest<HTMLElement>('.og-view-cal-entry');
		if (entry?.dataset.rowId) context.openInTable(entry.dataset.rowId);
	};
	grid.addEventListener('pointerdown', onPointerDown);
	grid.addEventListener('pointermove', onPointerMove);
	grid.addEventListener('pointerup', onPointerUp);
	grid.addEventListener('pointercancel', onPointerUp);
	grid.addEventListener('dblclick', onDoubleClick);
	toolbar.addEventListener('click', onClick);

	return {
		render: draw,
		destroy() {
			grid.removeEventListener('pointerdown', onPointerDown);
			grid.removeEventListener('pointermove', onPointerMove);
			grid.removeEventListener('pointerup', onPointerUp);
			grid.removeEventListener('pointercancel', onPointerUp);
			grid.removeEventListener('dblclick', onDoubleClick);
			toolbar.removeEventListener('click', onClick);
			root.remove();
		},
	};
}
