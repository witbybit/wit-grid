import type { ColumnDef } from '../../columnDef.js';
import type { CalendarViewConfig } from '../../views.js';
import { parseDateRange, writeDateRange, type DateRange } from '../../cells/dateRange.js';
import { parseCellDate, toIsoDay } from '../../cells/format.js';
import { defaultGridScheduler } from '../gridScheduler.js';
import { fieldText, viewColour, ViewField, type GridViewContext, type GridViewInstance, type ViewRow } from './viewContext.js';

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
export function createCalendarView<TRowData>(
	host: HTMLElement,
	context: GridViewContext<TRowData>,
	config: CalendarViewConfig<TRowData>
): GridViewInstance {
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
		// Mid-drag the entries stay put (the dragged one is dimmed in place); redraw on drop.
		if (drag) {
			pendingDraw = true;
			return;
		}
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
				if (row.id === landedRowId) {
					entry.setAttribute('data-landed', '');
					if (!landedShown) {
						landedShown = true;
						const landed = landedRowId;
						defaultGridScheduler.timeout(() => {
							if (landedRowId === landed) landedRowId = null;
						}, LANDED_MS);
					}
				}
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
		refreshPopover();
	};

	/*
	 * Drag an entry onto another day. While dragging, a ghost follows the pointer with the new dates,
	 * the days the entry will cover light up and the original dims; on drop the value shifts by the
	 * days moved (written once) and the entry lands with a pop. Escape cancels. Redraws wait for the
	 * drop, and the pointer is captured on the grid, so a live update mid-drag cannot lose it.
	 */
	const DRAG_THRESHOLD = 4;
	const LANDED_MS = 1200;
	interface DragState {
		rowId: string;
		from: string;
		range: DateRange;
		title: string;
		x: number;
		y: number;
		moved: boolean;
		shift: number | null;
		pointerId: number;
	}
	let drag: DragState | null = null;
	let pendingDraw = false;
	let landedRowId: string | null = null;
	/** The landing has been drawn; it clears LANDED_MS after that draw, not after the drop. */
	let landedShown = false;
	const ghost = document.createElement('div');
	ghost.className = 'og-view-cal-ghost';
	ghost.hidden = true;
	root.appendChild(ghost);
	const shortDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

	const dayAt = (event: PointerEvent) =>
		(document.elementFromPoint(event.clientX, event.clientY) as Element | null)?.closest<HTMLElement>('.og-view-cal-day') ?? null;
	const entriesOf = (rowId: string) => [...grid.querySelectorAll<HTMLElement>('.og-view-cal-entry')].filter((e) => e.dataset.rowId === rowId);

	/** Lights the days the entry would cover after shifting by `shift` days (null clears). */
	const paintDropSpan = (shift: number | null) => {
		const start = drag && shift !== null ? toIsoDay(addDays(drag.range.start, shift)) : null;
		const end = drag && shift !== null ? toIsoDay(addDays(drag.range.end, shift)) : null;
		for (const { element } of days) {
			const date = element.dataset.date!;
			const inside = start !== null && end !== null && date >= start && date <= end;
			element.toggleAttribute('data-drop-span', inside);
			element.toggleAttribute('data-drop-first', inside && date === start);
			element.toggleAttribute('data-drop-last', inside && date === end);
		}
	};

	const describeGhost = (state: DragState) => {
		const shift = state.shift ?? 0;
		const start = addDays(state.range.start, shift);
		const end = addDays(state.range.end, shift);
		const dates = start.getTime() === end.getTime() ? shortDay.format(start) : `${shortDay.format(start)} – ${shortDay.format(end)}`;
		const delta = shift === 0 ? 'not moved' : `${shift > 0 ? '+' : '−'}${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'}`;
		ghost.replaceChildren();
		const title = document.createElement('strong');
		title.textContent = state.title;
		const detail = document.createElement('span');
		detail.textContent = `${dates} · ${delta}`;
		ghost.append(title, detail);
	};

	const endDrag = () => {
		if (!drag) return;
		if (grid.hasPointerCapture?.(drag.pointerId)) grid.releasePointerCapture(drag.pointerId);
		drag = null;
		ghost.hidden = true;
		root.removeAttribute('data-dragging');
		for (const entry of grid.querySelectorAll<HTMLElement>('[data-drag-source]')) entry.removeAttribute('data-drag-source');
		paintDropSpan(null);
		document.removeEventListener('keydown', onKeyDown, true);
	};

	const flushDraw = () => {
		if (!pendingDraw) return;
		pendingDraw = false;
		draw();
	};

	const onPointerDown = (event: PointerEvent) => {
		const entry = (event.target as Element).closest<HTMLElement>('.og-view-cal-entry[data-editable]');
		if (!entry || event.button !== 0) return;
		const row = context.rows().find((r) => r.id === entry.dataset.rowId);
		const range = row ? rangeOf(row) : null;
		const day = entry.closest<HTMLElement>('.og-view-cal-day');
		if (!row || !range || !day) return;
		event.preventDefault();
		drag = {
			rowId: row.id,
			from: day.dataset.date!,
			range,
			title: fieldText(titleCol, row),
			x: event.clientX,
			y: event.clientY,
			moved: false,
			shift: null,
			pointerId: event.pointerId,
		};
		root.style.setProperty('--og-view-drag', viewColour(config.color?.(row.data)) ?? 'var(--og-focus-ring)');
		document.addEventListener('keydown', onKeyDown, true);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (!drag) return;
		if (!drag.moved) {
			// A press without movement stays a click (double-click opens the row).
			if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
			drag.moved = true;
			// Capture only now: a captured press retargets its click to the grid, and a plain click
			// on an entry must reach the entry (it opens the entry's card).
			try {
				grid.setPointerCapture(event.pointerId);
			} catch {
				// The pointer is already gone (or synthetic): the drag still follows grid events.
			}
			root.setAttribute('data-dragging', '');
			for (const entry of entriesOf(drag.rowId)) entry.setAttribute('data-drag-source', '');
			ghost.hidden = false;
		}
		const bounds = root.getBoundingClientRect();
		ghost.style.transform = `translate(${Math.round(event.clientX - bounds.left + 14)}px, ${Math.round(event.clientY - bounds.top + 12)}px)`;
		const target = dayAt(event)?.dataset.date;
		const shift = target ? daysBetween(new Date(`${drag.from}T00:00:00`), new Date(`${target}T00:00:00`)) : null;
		if (shift !== drag.shift || ghost.childElementCount === 0) {
			drag.shift = shift;
			paintDropSpan(shift);
			describeGhost(drag);
		}
	};

	const onPointerUp = () => {
		if (!drag) return;
		const { rowId, moved, shift } = drag;
		endDrag();
		// The click that follows a drag is not a click on an entry.
		justDragged = moved;
		if (moved) closePopover();
		const row = moved && shift ? context.rows().find((r) => r.id === rowId) : undefined;
		if (row && shift) {
			// The next draw (from the write) shows the entry landing in its new place.
			landedRowId = rowId;
			landedShown = false;
			const value = (row.data as Record<string, unknown> | null)?.[config.dateField];
			context.api.setCellValue(rowId, config.dateField, shiftCalendarValue(value, shift));
		}
		flushDraw();
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape' || !drag) return;
		event.preventDefault();
		event.stopPropagation();
		endDrag();
		flushDraw();
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

	/*
	 * Click an entry: a card with its dates, length and a few fields (drawn by their columns' own
	 * renderers), and what can be done with it — nudge it a day or a week, or open its row. It stays
	 * open while nudging, so the entry can be watched moving; Escape or a click elsewhere closes it.
	 */
	const POPOVER_WIDTH = 280;
	const popFields = (
		config.fields ??
		columns
			.filter((c) => c !== titleCol && c.field !== config.dateField)
			.slice(0, 3)
			.map((c) => c.field)
	)
		.map((field) => columns.find((c) => c.field === field))
		.filter((c): c is ColumnDef<TRowData> => !!c);
	let popover: {
		rowId: string;
		element: HTMLElement;
		title: HTMLElement;
		dates: HTMLElement;
		band: HTMLElement;
		fields: ViewField<TRowData>[];
	} | null = null;
	let justDragged = false;

	const closePopover = () => {
		if (!popover) return;
		for (const field of popover.fields) field.destroy();
		popover.element.remove();
		popover = null;
		document.removeEventListener('keydown', onPopoverKey, true);
	};

	const refreshPopover = () => {
		if (!popover) return;
		const row = context.rows().find((r) => r.id === popover!.rowId);
		const range = row ? rangeOf(row) : null;
		// Filtered out or cleared by a live update: nothing left to describe.
		if (!row || !range) return closePopover();
		popover.title.textContent = fieldText(titleCol, row);
		const days = daysBetween(range.start, range.end) + 1;
		popover.dates.textContent =
			days === 1 ? shortDay.format(range.start) : `${shortDay.format(range.start)} – ${shortDay.format(range.end)} · ${days} days`;
		const colour = viewColour(config.color?.(row.data));
		popover.band.style.background = colour ?? 'var(--og-focus-ring)';
		for (const field of popover.fields) field.show(row);
	};

	const openPopover = (entry: HTMLElement) => {
		closePopover();
		const rowId = entry.dataset.rowId!;
		const element = document.createElement('div');
		element.className = 'og-view-cal-popover';
		element.setAttribute('role', 'dialog');
		const band = document.createElement('div');
		band.className = 'og-view-pop-band';
		const head = document.createElement('div');
		head.className = 'og-view-pop-head';
		const title = document.createElement('strong');
		const close = document.createElement('button');
		close.type = 'button';
		close.className = 'og-view-pop-close';
		close.dataset.pop = 'close';
		close.setAttribute('aria-label', 'Close');
		close.textContent = '×';
		head.append(title, close);
		const dates = document.createElement('div');
		dates.className = 'og-view-pop-dates';
		const list = document.createElement('div');
		list.className = 'og-view-pop-fields';
		const fields = popFields.map((col) => {
			const line = document.createElement('div');
			line.className = 'og-view-field';
			const label = document.createElement('span');
			label.className = 'og-view-field-label';
			label.textContent = col.header ?? col.field;
			const field = new ViewField(col, context.api);
			line.append(label, field.element);
			list.appendChild(line);
			return field;
		});
		const actions = document.createElement('div');
		actions.className = 'og-view-pop-actions';
		const action = (text: string, data: Record<string, string>, title?: string) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'og-view-cal-button';
			b.textContent = text;
			if (title) b.title = title;
			Object.assign(b.dataset, data);
			actions.appendChild(b);
		};
		if (editable) {
			action('−1 day', { move: '-1' }, 'One day earlier');
			action('+1 day', { move: '1' }, 'One day later');
			action('+1 week', { move: '7' }, 'One week later');
		}
		action('Open in table', { pop: 'open' }, 'Show this row in the table');
		const tip = document.createElement('div');
		tip.className = 'og-view-pop-tip';
		tip.textContent = editable
			? 'Drag an entry to another day to move it · double-click to open it'
			: 'Double-click an entry to open it in the table';
		element.append(band, head, dates, list, actions, tip);
		root.appendChild(element);
		popover = { rowId, element, title, dates, band, fields };
		refreshPopover();
		if (!popover) return;
		// Below the entry, kept inside the calendar; above it when there is no room below.
		const bounds = root.getBoundingClientRect();
		const anchor = entry.getBoundingClientRect();
		const left = Math.min(Math.max(8, anchor.left - bounds.left), Math.max(8, bounds.width - POPOVER_WIDTH - 8));
		const below = anchor.bottom - bounds.top + 6;
		const height = element.offsetHeight;
		const top = below + height > bounds.height - 8 ? Math.max(8, anchor.top - bounds.top - height - 6) : below;
		element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
		document.addEventListener('keydown', onPopoverKey, true);
	};

	const onPopoverKey = (event: KeyboardEvent) => {
		if (event.key !== 'Escape' || drag) return;
		event.stopPropagation();
		closePopover();
	};

	const onRootClick = (event: MouseEvent) => {
		const target = event.target as Element;
		const inPopover = popover && popover.element.contains(target);
		if (inPopover) {
			const button = target.closest<HTMLElement>('button');
			if (!button || !popover) return;
			const rowId = popover.rowId;
			if (button.dataset.pop === 'close') return closePopover();
			if (button.dataset.pop === 'open') {
				closePopover();
				return context.openInTable(rowId);
			}
			const shift = Number(button.dataset.move);
			const row = context.rows().find((r) => r.id === rowId);
			if (!shift || !row) return;
			landedRowId = rowId;
			landedShown = false;
			const value = (row.data as Record<string, unknown> | null)?.[config.dateField];
			context.api.setCellValue(rowId, config.dateField, shiftCalendarValue(value, shift));
			return;
		}
		if (justDragged) {
			justDragged = false;
			return;
		}
		const entry = target.closest<HTMLElement>('.og-view-cal-entry');
		if (entry && popover?.rowId !== entry.dataset.rowId) openPopover(entry);
		else closePopover();
	};

	grid.addEventListener('pointerdown', onPointerDown);
	grid.addEventListener('pointermove', onPointerMove);
	grid.addEventListener('pointerup', onPointerUp);
	grid.addEventListener('pointercancel', onPointerUp);
	grid.addEventListener('dblclick', onDoubleClick);
	toolbar.addEventListener('click', onClick);
	root.addEventListener('click', onRootClick);

	return {
		render: draw,
		destroy() {
			endDrag();
			grid.removeEventListener('pointerdown', onPointerDown);
			grid.removeEventListener('pointermove', onPointerMove);
			grid.removeEventListener('pointerup', onPointerUp);
			grid.removeEventListener('pointercancel', onPointerUp);
			grid.removeEventListener('dblclick', onDoubleClick);
			toolbar.removeEventListener('click', onClick);
			root.removeEventListener('click', onRootClick);
			closePopover();
			root.remove();
		},
	};
}
