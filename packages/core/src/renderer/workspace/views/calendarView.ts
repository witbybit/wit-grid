import { parseCellDate } from '../../../cells/format.js';
import { fromDay, isoDay, toDay, today, weekday, type Day, type DaySpan } from '../../../records/days.js';
import type { RecordReader, RecordRow } from '../../../records/recordModel.js';
import type { CalendarViewConfig } from '../../../views.js';
import { icon } from '../icons.js';
import { spanWrites } from '../recordWrites.js';
import { button, formatDay, h, openPanel } from '../ui.js';
import type { WorkspaceCommand, WorkspaceView, WorkspaceViewContext, WorkspaceViewModule } from '../viewTypes.js';
import { addViewStyles } from '../workspaceStyles.js';

const WEEKS = 6;
const HEAD_H = 28;
const LANE_H = 24;

interface Placed<T> {
	row: RecordRow<T>;
	span: DaySpan;
	/** First and last day index in its week (0–6). */
	from: number;
	to: number;
	lane: number;
}

/** Packs a week's entries into lanes, longest first, so multi-day bars stay on one line. */
export function packWeek<T>(entries: { row: RecordRow<T>; span: DaySpan }[], weekStart: Day): Placed<T>[] {
	const placed: Placed<T>[] = [];
	const lanes: number[][] = [];
	const sorted = [...entries].sort((a, b) => a.span.start - b.span.start || b.span.end - b.span.start - (a.span.end - a.span.start));
	for (const entry of sorted) {
		const from = Math.max(0, entry.span.start - weekStart);
		const to = Math.min(6, entry.span.end - weekStart);
		let lane = 0;
		while ((lanes[lane] ?? []).some((day) => day >= from && day <= to)) lane++;
		(lanes[lane] ??= []).push(...Array.from({ length: to - from + 1 }, (_, i) => from + i));
		placed.push({ row: entry.row, span: entry.span, from, to, lane });
	}
	return placed;
}

function create<T>(host: HTMLElement, context: WorkspaceViewContext<T>, config: CalendarViewConfig<T>): WorkspaceView {
	addViewStyles(host.ownerDocument, 'calendar', CALENDAR_STYLES);
	const weekStartsOn = config.weekStartsOn ?? 1;
	const initial = config.initialDate ? parseCellDate(config.initialDate) : null;
	let month: Date = context.memory('month', initial ?? new Date());
	month = new Date(month.getFullYear(), month.getMonth(), 1);
	const root = h('div', 'og-ws-cal');
	const weekdays = h('div', 'og-ws-cal-weekdays');
	const names = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
	for (let i = 0; i < 7; i++) weekdays.append(h('span', null, null, names.format(new Date(2024, 0, 7 + ((weekStartsOn + i) % 7)))));
	const grid = h('div', 'og-ws-cal-grid', { role: 'grid' });
	root.append(weekdays, grid);
	host.append(root);
	let reader: RecordReader<T> = context.reader();
	let order: string[] = [];
	let first: Day = 0;
	const entryEls = new Map<string, HTMLElement[]>();
	let drag: {
		id: string;
		span: DaySpan;
		pointerId: number;
		x: number;
		y: number;
		moved: boolean;
		offset: number;
		delta: number;
		ghost: HTMLElement | null;
	} | null = null;
	const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
	let label: HTMLElement | null = null;

	const firstShown = () => {
		const start = toDay(month);
		return start - ((weekday(start) - weekStartsOn + 7) % 7);
	};

	const dayAt = (clientX: number, clientY: number): Day | null => {
		const rect = grid.getBoundingClientRect();
		if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
		const col = Math.min(6, Math.floor(((clientX - rect.left) / rect.width) * 7));
		const row = Math.min(WEEKS - 1, Math.floor(((clientY - rect.top) / rect.height) * WEEKS));
		return first + row * 7 + col;
	};

	const render = () => {
		if (drag?.moved) return;
		reader = context.reader();
		first = firstShown();
		const last = first + WEEKS * 7 - 1;
		if (label) label.textContent = monthLabel.format(month);
		const now = today();
		const entries: { row: RecordRow<T>; span: DaySpan }[] = [];
		for (const row of context.rows() as RecordRow<T>[]) {
			const span = reader.span(row);
			if (span && span.end >= first && span.start <= last) entries.push({ row, span });
		}
		order = entries.sort((a, b) => a.span.start - b.span.start).map((entry) => entry.row.id);
		grid.replaceChildren();
		entryEls.clear();
		const rowHeight = grid.clientHeight ? grid.clientHeight / WEEKS : 120;
		const fits = Math.max(1, Math.floor((rowHeight - HEAD_H - 4) / LANE_H));
		const selected = context.selected();
		const focused = context.focused();
		const editable = config.editable !== false;
		for (let w = 0; w < WEEKS; w++) {
			const weekStart = first + w * 7;
			const week = h('div', 'og-ws-cal-week', { role: 'row' });
			for (let d = 0; d < 7; d++) {
				const day = weekStart + d;
				const date = fromDay(day);
				const cell = h('div', 'og-ws-cal-day', { role: 'gridcell', 'data-day': isoDay(day), 'aria-label': formatDay(date, true) });
				cell.toggleAttribute('data-outside', date.getMonth() !== month.getMonth());
				cell.toggleAttribute('data-today', day === now);
				cell.toggleAttribute('data-weekend', weekday(day) === 0 || weekday(day) === 6);
				const number = h(
					'span',
					'og-ws-cal-date',
					null,
					date.getDate() === 1 ? `${date.toLocaleString(undefined, { month: 'short' })} 1` : String(date.getDate())
				);
				cell.append(number);
				if (context.create && editable) {
					const add = h(
						'button',
						'og-ws-cal-add',
						{ type: 'button', title: `Add on ${formatDay(date)}`, 'data-no-select': '' },
						icon('plus', 13)
					);
					add.addEventListener('click', () => {
						const values: Record<string, unknown> = {};
						const { schedule, due, start, end } = reader.roles;
						if (schedule) values[schedule] = { start: isoDay(day), end: isoDay(day) };
						else if (start || end) {
							if (start) values[start] = isoDay(day);
							if (end) values[end] = isoDay(day);
						} else if (due) values[due] = isoDay(day);
						void context.create?.(values);
					});
					cell.append(add);
				}
				week.append(cell);
			}
			const inWeek = entries.filter((entry) => entry.span.end >= weekStart && entry.span.start <= weekStart + 6);
			const placed = packWeek(inWeek, weekStart);
			const hidden = new Map<number, Placed<T>[]>();
			for (const item of placed) {
				if (item.lane >= fits - (placed.some((other) => other.lane >= fits) ? 1 : 0)) {
					for (let d = item.from; d <= item.to; d++) hidden.set(d, [...(hidden.get(d) ?? []), item]);
					continue;
				}
				const el = h('div', 'og-ws-cal-entry', { 'data-record-id': item.row.id, role: 'button', tabindex: focused === item.row.id ? 0 : -1 });
				el.style.left = `calc(${(item.from / 7) * 100}% + 3px)`;
				el.style.width = `calc(${((item.to - item.from + 1) / 7) * 100}% - 6px)`;
				el.style.top = `${HEAD_H + item.lane * LANE_H}px`;
				el.style.setProperty('--og-ws-accent', context.accent(item.row) ?? 'var(--og-focus-ring)');
				el.toggleAttribute('data-continues-before', item.span.start < weekStart);
				el.toggleAttribute('data-continues-after', item.span.end > weekStart + 6);
				el.toggleAttribute('data-done', reader.isDone(item.row));
				el.toggleAttribute('data-selected', selected.has(item.row.id));
				el.toggleAttribute('data-focused', focused === item.row.id);
				const fieldsWritable =
					editable &&
					[reader.roles.schedule, reader.roles.start, reader.roles.end, reader.roles.due]
						.filter(Boolean)
						.every((field) => context.canEdit(item.row.id, field!));
				el.toggleAttribute('data-draggable', fieldsWritable);
				const title = reader.title(item.row);
				el.title = `${title} · ${formatDay(fromDay(item.span.start))}${item.span.end !== item.span.start ? ` – ${formatDay(fromDay(item.span.end))}` : ''}`;
				el.append(h('span', 'og-ws-cal-dot'), h('span', 'og-ws-cal-title', null, title));
				week.append(el);
				const list = entryEls.get(item.row.id) ?? [];
				list.push(el);
				entryEls.set(item.row.id, list);
			}
			for (const [d, items] of hidden) {
				const more = h('button', 'og-ws-cal-more', { type: 'button', 'data-no-select': '' }, `+${items.length} more`);
				more.style.left = `calc(${(d / 7) * 100}% + 3px)`;
				more.style.width = `calc(${100 / 7}% - 6px)`;
				more.style.top = `${HEAD_H + (fits - 1) * LANE_H}px`;
				more.addEventListener('click', () => {
					const list = h(
						'div',
						'og-ws-cal-list',
						null,
						h('div', 'og-ws-panel-head', null, h('strong', null, null, formatDay(fromDay(weekStart + d), true)))
					);
					const all = placed.filter((item) => item.from <= d && item.to >= d).sort((a, b) => a.lane - b.lane);
					for (const item of all) {
						const entry = h(
							'button',
							'og-ws-list-item',
							{ type: 'button' },
							h('span', 'og-ws-dot'),
							h('span', 'og-ws-list-label', null, reader.title(item.row))
						);
						(entry.firstChild as HTMLElement).style.background = context.accent(item.row) ?? '';
						entry.addEventListener('click', () => {
							popover.close();
							context.focus(item.row.id, { inspect: true });
						});
						list.append(entry);
					}
					const popover = openPanel(more, list, 'Records on this day');
				});
				week.append(more);
			}
			grid.append(week);
		}
	};

	// ─── Drag to another day ─────────────────────────────────────────────

	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0 || config.editable === false) return;
		const el = (event.target as Element).closest<HTMLElement>('.og-ws-cal-entry[data-draggable]');
		if (!el) return;
		const row = context.lookup(el.dataset.recordId!);
		const span = row ? reader.span(row) : null;
		const at = dayAt(event.clientX, event.clientY);
		if (!row || !span || at == null) return;
		drag = {
			id: row.id,
			span,
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			moved: false,
			offset: at - span.start,
			delta: 0,
			ghost: null,
		};
	};

	const onPointerMove = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!drag.moved) {
			if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
			drag.moved = true;
			try {
				grid.setPointerCapture(event.pointerId);
			} catch {
				/* synthetic pointer */
			}
			root.setAttribute('data-dragging', '');
			for (const el of entryEls.get(drag.id) ?? []) el.setAttribute('data-drag-source', '');
			const row = context.lookup(drag.id)!;
			drag.ghost = h('div', 'og-ws-cal-ghost', null, reader.title(row));
			root.append(drag.ghost);
		}
		const at = dayAt(event.clientX, event.clientY);
		const rect = root.getBoundingClientRect();
		drag.ghost!.style.transform = `translate(${event.clientX - rect.left + 10}px, ${event.clientY - rect.top + 8}px)`;
		if (at == null) return;
		drag.delta = at - drag.offset - drag.span.start;
		const start = drag.span.start + drag.delta;
		const end = drag.span.end + drag.delta;
		drag.ghost!.dataset.dates = `${formatDay(fromDay(start))}${end !== start ? ` – ${formatDay(fromDay(end))}` : ''}`;
		for (const cell of grid.querySelectorAll<HTMLElement>('.og-ws-cal-day')) {
			const day = toDay(parseCellDate(cell.dataset.day!)!);
			cell.toggleAttribute('data-drop', day >= start && day <= end);
		}
	};

	const endDrag = () => {
		if (!drag) return;
		drag.ghost?.remove();
		root.removeAttribute('data-dragging');
		for (const cell of grid.querySelectorAll('[data-drop]')) cell.removeAttribute('data-drop');
		for (const el of entryEls.get(drag.id) ?? []) el.removeAttribute('data-drag-source');
		if (grid.hasPointerCapture?.(drag.pointerId)) grid.releasePointerCapture(drag.pointerId);
		drag = null;
	};

	const onPointerUp = (event: PointerEvent) => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const state = drag;
		if (state.moved) for (const el of entryEls.get(state.id) ?? []) el.setAttribute('data-drag-suppress-click', '');
		endDrag();
		if (!state.moved || !state.delta) {
			render();
			return;
		}
		const row = context.lookup(state.id)!;
		const span = { start: state.span.start + state.delta, end: state.span.end + state.delta };
		context.write(spanWrites(reader, row, span), `Moved “${reader.title(row)}” to ${formatDay(fromDay(span.start))}`);
	};

	grid.addEventListener('pointerdown', onPointerDown);
	grid.addEventListener('pointermove', onPointerMove);
	grid.addEventListener('pointerup', onPointerUp);
	grid.addEventListener('pointercancel', () => {
		endDrag();
		render();
	});
	const onEscape = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && drag?.moved) {
			event.stopPropagation();
			endDrag();
			render();
		}
	};
	host.ownerDocument.addEventListener('keydown', onEscape, true);

	const go = (months: number | 'today') => {
		month =
			months === 'today'
				? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
				: new Date(month.getFullYear(), month.getMonth() + months, 1);
		context.remember('month', month);
		render();
	};

	const toolbar = () => {
		label = h('strong', 'og-ws-cal-label', null, monthLabel.format(month));
		return h(
			'div',
			'og-ws-group',
			null,
			button({ icon: 'today', label: 'Today' }, () => go('today')),
			button({ icon: 'chevronLeft', title: 'Previous month' }, () => go(-1)),
			button({ icon: 'chevronRight', title: 'Next month' }, () => go(1)),
			label
		);
	};

	const commands = (): WorkspaceCommand[] => [
		{ id: 'calendar:today', label: 'Go to this month', group: 'Calendar', icon: 'today', run: () => go('today') },
		{ id: 'calendar:prev', label: 'Previous month', group: 'Calendar', icon: 'chevronLeft', run: () => go(-1) },
		{ id: 'calendar:next', label: 'Next month', group: 'Calendar', icon: 'chevronRight', run: () => go(1) },
	];

	return {
		render,
		order: () => order,
		reveal(id) {
			const els = entryEls.get(id);
			if (els?.length) return els[0];
			// Off this month: go to the record's month.
			const row = context.lookup(id);
			const span = row ? reader.span(row) : null;
			if (!span) return null;
			const date = fromDay(span.start);
			month = new Date(date.getFullYear(), date.getMonth(), 1);
			context.remember('month', month);
			render();
			return entryEls.get(id)?.[0] ?? null;
		},
		onKey(event, id) {
			if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
			const row = context.lookup(id);
			const span = row ? reader.span(row) : null;
			if (!row || !span) return false;
			const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : 7;
			context.write(spanWrites(reader, row, { start: span.start + delta, end: span.end + delta }));
			return true;
		},
		toolbar,
		commands,
		destroy() {
			endDrag();
			host.ownerDocument.removeEventListener('keydown', onEscape, true);
			root.remove();
		},
	};
}

export const calendarView: WorkspaceViewModule<CalendarViewConfig<any>> = { kind: 'calendar', label: 'Calendar', icon: 'calendar', create };

const CALENDAR_STYLES = `
.og-ws-cal { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0 14px 14px; overflow: auto; }
.og-ws-cal-weekdays { flex: none; display: grid; grid-template-columns: repeat(7, 1fr); }
.og-ws-cal-weekdays span { padding: 10px 8px 8px; color: var(--og-ws-muted); font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
.og-ws-cal-grid { flex: 1 0 auto; display: grid; grid-template-rows: repeat(${WEEKS}, minmax(124px, 1fr)); border: 1px solid var(--og-ws-line); border-radius: var(--og-ws-radius); overflow: hidden; }
.og-ws-cal-week { position: relative; display: grid; grid-template-columns: repeat(7, 1fr); min-height: 0; }
.og-ws-cal-week + .og-ws-cal-week { border-top: 1px solid var(--og-ws-line); }
.og-ws-cal-day { position: relative; min-width: 0; padding: 6px 8px; }
.og-ws-cal-day + .og-ws-cal-day { border-left: 1px solid var(--og-ws-line); }
.og-ws-cal-day[data-weekend] { background: color-mix(in srgb, var(--og-text-color) 2%, transparent); }
.og-ws-cal-day[data-outside] .og-ws-cal-date { color: var(--og-ws-faint); }
.og-ws-cal-day[data-drop] { background: color-mix(in srgb, var(--og-focus-ring) 12%, transparent); }
.og-ws-cal-date { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--og-ws-muted); }
.og-ws-cal-day[data-today] .og-ws-cal-date { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 5px; margin: -3px 0 0 -5px; border-radius: 99px; background: #ef4444; color: #fff; }
.og-ws-cal-add { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; display: grid; place-items: center; border: 0; border-radius: 6px; background: var(--og-ws-hover); color: var(--og-ws-muted); cursor: pointer; opacity: 0; transition: opacity .12s ease; }
.og-ws-cal-day:hover .og-ws-cal-add, .og-ws-cal-add:focus-visible { opacity: 1; }
.og-ws-cal-entry { position: absolute; height: ${LANE_H - 3}px; display: flex; align-items: center; gap: 6px; padding: 0 7px; border-radius: 5px; font-size: 11.5px; font-weight: 550; color: var(--og-ws-text); background: color-mix(in srgb, var(--og-ws-accent) 22%, var(--og-ws-bg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-ws-accent) 40%, transparent); cursor: pointer; overflow: hidden; white-space: nowrap; z-index: 1; outline: none; }
.og-ws-cal-entry[data-draggable] { cursor: grab; }
.og-ws-cal-entry[data-continues-before] { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.og-ws-cal-entry[data-continues-after] { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.og-ws-cal-entry[data-done] { opacity: .65; }
.og-ws-cal-entry[data-done] .og-ws-cal-title { text-decoration: line-through; }
.og-ws-cal-entry[data-selected] { box-shadow: inset 0 0 0 1px var(--og-ws-accent), 0 0 0 2px var(--og-focus-ring); }
.og-ws-cal-entry:focus-visible { box-shadow: 0 0 0 2px var(--og-focus-ring); }
.og-ws-cal-entry[data-drag-source] { opacity: .35; }
.og-ws-cal-dot { width: 7px; height: 7px; border-radius: 99px; background: var(--og-ws-accent); flex: none; }
.og-ws-cal-title { overflow: hidden; text-overflow: ellipsis; }
.og-ws-cal-more { position: absolute; height: ${LANE_H - 3}px; z-index: 1; border: 0; border-radius: 5px; background: none; color: var(--og-ws-muted); font: 600 11px var(--og-font-family, inherit); text-align: left; padding: 0 7px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.og-ws-cal-more:hover { background: var(--og-ws-hover); color: var(--og-ws-text); }
.og-ws-cal-ghost { position: absolute; left: 0; top: 0; z-index: 10; padding: 5px 10px; border-radius: 7px; background: var(--og-text-color); color: var(--og-bg-color); font-size: 12px; font-weight: 600; pointer-events: none; box-shadow: var(--og-ws-shadow-lg); white-space: nowrap; }
.og-ws-cal-ghost::after { content: attr(data-dates); display: block; font-weight: 500; opacity: .75; font-size: 11px; }
.og-ws-cal-label { font-size: 14px; margin-left: 6px; white-space: nowrap; }
.og-ws-cal-list { min-width: 240px; }
`;
