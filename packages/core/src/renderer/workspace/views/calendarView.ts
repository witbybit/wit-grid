import { parseCellDate } from '../../../cells/format.js';
import { fromDay, isoDay, toDay, today, weekday, type Day, type DaySpan } from '../../../records/days.js';
import type { RecordReader, RecordRow } from '../../../records/recordModel.js';
import type { CalendarViewConfig } from '../../../views.js';
import { icon } from '../icons.js';
import { spanWrites } from '../recordWrites.js';
import { button, formatDay, h, openPanel } from '../ui.js';
import type { ViewSettingsSection, WorkspaceCommand, WorkspaceView, WorkspaceViewContext, WorkspaceViewModule } from '../viewTypes.js';
import { addViewStyles } from '../workspaceStyles.js';

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

/**
 * Where days sit when some are hidden (weekends off): each shown day's column, and the span of a
 * bar clipped to shown days. Null when a bar covers only hidden days.
 */
export function dayColumns(weekStartsOn: number, showWeekends: boolean) {
	const shown: number[] = [];
	for (let i = 0; i < 7; i++) {
		const day = (weekStartsOn + i) % 7;
		if (showWeekends || (day !== 0 && day !== 6)) shown.push(i);
	}
	const column = (index: number) => shown.indexOf(index);
	const clip = (from: number, to: number): [number, number] | null => {
		const inside = shown.filter((index) => index >= from && index <= to);
		return inside.length ? [column(inside[0]), column(inside[inside.length - 1])] : null;
	};
	return { shown, count: shown.length, clip };
}

function create<T>(host: HTMLElement, context: WorkspaceViewContext<T>, initial: CalendarViewConfig<T>): WorkspaceView {
	addViewStyles(host.ownerDocument, 'calendar', CALENDAR_STYLES);
	let config = initial;
	const motion = context.motion;
	const start = config.initialDate ? parseCellDate(config.initialDate) : null;
	/** The day the calendar is about: its month (month mode) or week (week mode). */
	let anchor: Day = toDay(context.memory<Date>('anchor', start ?? new Date()));
	const root = h('div', 'og-ws-cal');
	const weekdays = h('div', 'og-ws-cal-weekdays');
	const grid = h('div', 'og-ws-cal-grid', { role: 'grid' });
	root.append(weekdays, grid);
	host.append(root);
	let reader: RecordReader<T> = context.reader();
	let order: string[] = [];
	let first: Day = 0;
	let painted = false;
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
	const names = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
	let label: HTMLElement | null = null;

	const weekStartsOn = () => config.weekStartsOn ?? 1;
	const weekMode = () => config.mode === 'week';
	const weeks = () => (weekMode() ? 1 : 6);
	const columns = () => dayColumns(weekStartsOn(), config.showWeekends !== false);
	const weekStartOf = (day: Day) => day - ((weekday(day) - weekStartsOn() + 7) % 7);

	const firstShown = () => {
		if (weekMode()) return weekStartOf(anchor);
		const date = fromDay(anchor);
		return weekStartOf(toDay(new Date(date.getFullYear(), date.getMonth(), 1)));
	};

	const title = () => {
		if (!weekMode()) return monthLabel.format(fromDay(anchor));
		const from = firstShown();
		return `${formatDay(fromDay(from))} – ${formatDay(fromDay(from + 6), true)}`;
	};

	const dayAt = (clientX: number, clientY: number): Day | null => {
		const rect = grid.getBoundingClientRect();
		if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
		const cols = columns();
		const col = Math.min(cols.count - 1, Math.floor(((clientX - rect.left) / rect.width) * cols.count));
		const row = Math.min(weeks() - 1, Math.floor(((clientY - rect.top) / rect.height) * weeks()));
		return first + row * 7 + cols.shown[col];
	};

	const render = (glide = false) => {
		if (drag?.moved) return;
		reader = context.reader();
		first = firstShown();
		const last = first + weeks() * 7 - 1;
		const cols = columns();
		if (label) label.textContent = title();
		root.dataset.mode = weekMode() ? 'week' : 'month';
		grid.style.setProperty('--og-ws-cal-cols', String(cols.count));
		grid.style.setProperty('--og-ws-cal-weeks', String(weeks()));
		weekdays.style.setProperty('--og-ws-cal-cols', String(cols.count));
		weekdays.replaceChildren(...cols.shown.map((i) => h('span', null, null, names.format(new Date(2024, 0, 7 + ((weekStartsOn() + i) % 7))))));
		const now = today();
		const entries: { row: RecordRow<T>; span: DaySpan }[] = [];
		for (const row of context.rows() as RecordRow<T>[]) {
			const span = reader.span(row);
			if (span && span.end >= first && span.start <= last) entries.push({ row, span });
		}
		order = entries.sort((a, b) => a.span.start - b.span.start).map((entry) => entry.row.id);
		const previous = new Set(entryEls.keys());
		grid.replaceChildren();
		entryEls.clear();
		const rowHeight = grid.clientHeight ? grid.clientHeight / weeks() : weekMode() ? 480 : 124;
		const fits = Math.max(1, Math.floor((rowHeight - HEAD_H - 4) / LANE_H));
		const selected = context.selected();
		const focused = context.focused();
		const editable = config.editable !== false;
		const percent = (index: number) => (index / cols.count) * 100;
		let entering = 0;
		for (let w = 0; w < weeks(); w++) {
			const weekStart = first + w * 7;
			const week = h('div', 'og-ws-cal-week', { role: 'row' });
			for (const index of cols.shown) {
				const day = weekStart + index;
				const date = fromDay(day);
				const cell = h('div', 'og-ws-cal-day', { role: 'gridcell', 'data-day': isoDay(day), 'aria-label': formatDay(date, true) });
				cell.toggleAttribute('data-outside', !weekMode() && date.getMonth() !== fromDay(anchor).getMonth());
				cell.toggleAttribute('data-today', day === now);
				cell.toggleAttribute('data-weekend', weekday(day) === 0 || weekday(day) === 6);
				const number = h(
					'span',
					'og-ws-cal-date',
					null,
					weekMode()
						? `${names.format(date)} ${date.getDate()}`
						: date.getDate() === 1
							? `${date.toLocaleString(undefined, { month: 'short' })} 1`
							: String(date.getDate())
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
						const { schedule, due, start: startField, end } = reader.roles;
						if (schedule) values[schedule] = { start: isoDay(day), end: isoDay(day) };
						else if (startField || end) {
							if (startField) values[startField] = isoDay(day);
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
			const overflow = placed.some((other) => other.lane >= fits);
			const hidden = new Map<number, Placed<T>[]>();
			for (const item of placed) {
				const clipped = cols.clip(item.from, item.to);
				if (!clipped) continue;
				const [from, to] = clipped;
				if (item.lane >= fits - (overflow ? 1 : 0)) {
					for (let c = from; c <= to; c++) hidden.set(c, [...(hidden.get(c) ?? []), item]);
					continue;
				}
				const el = h('div', 'og-ws-cal-entry', { 'data-record-id': item.row.id, role: 'button', tabindex: focused === item.row.id ? 0 : -1 });
				el.style.left = `calc(${percent(from)}% + 3px)`;
				el.style.width = `calc(${percent(to - from + 1)}% - 6px)`;
				el.style.top = `${HEAD_H + item.lane * LANE_H}px`;
				el.style.setProperty('--og-ws-accent', context.accent(item.row) ?? 'var(--og-focus-ring)');
				el.toggleAttribute('data-continues-before', item.span.start < weekStart + cols.shown[0]);
				el.toggleAttribute('data-continues-after', item.span.end > weekStart + cols.shown[cols.count - 1]);
				el.toggleAttribute('data-done', reader.isDone(item.row));
				el.toggleAttribute('data-selected', selected.has(item.row.id));
				el.toggleAttribute('data-focused', focused === item.row.id);
				const fieldsWritable =
					editable &&
					[reader.roles.schedule, reader.roles.start, reader.roles.end, reader.roles.due]
						.filter(Boolean)
						.every((field) => context.canEdit(item.row.id, field!));
				el.toggleAttribute('data-draggable', fieldsWritable);
				const name = reader.title(item.row);
				el.title = `${name} · ${formatDay(fromDay(item.span.start))}${item.span.end !== item.span.start ? ` – ${formatDay(fromDay(item.span.end))}` : ''}`;
				el.append(h('span', 'og-ws-cal-dot'), h('span', 'og-ws-cal-title', null, name));
				week.append(el);
				// Entries new to the calendar (added, filtered in, moved here) settle in.
				if (glide && painted && !previous.has(item.row.id)) motion.enter(el, Math.min(entering++, 10) * 20);
				const list = entryEls.get(item.row.id) ?? [];
				list.push(el);
				entryEls.set(item.row.id, list);
			}
			for (const [c, items] of hidden) {
				const more = h('button', 'og-ws-cal-more', { type: 'button', 'data-no-select': '' }, `+${items.length} more`);
				more.style.left = `calc(${percent(c)}% + 3px)`;
				more.style.width = `calc(${percent(1)}% - 6px)`;
				more.style.top = `${HEAD_H + (fits - 1) * LANE_H}px`;
				const day = weekStart + cols.shown[c];
				more.addEventListener('click', () => {
					const list = h(
						'div',
						'og-ws-cal-list',
						null,
						h('div', 'og-ws-panel-head', null, h('strong', null, null, formatDay(fromDay(day), true)))
					);
					const all = placed.filter((item) => item.from <= day - weekStart && item.to >= day - weekStart).sort((a, b) => a.lane - b.lane);
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
		painted = true;
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
		const from = drag.span.start + drag.delta;
		const to = drag.span.end + drag.delta;
		drag.ghost!.dataset.dates = `${formatDay(fromDay(from))}${to !== from ? ` – ${formatDay(fromDay(to))}` : ''}`;
		for (const cell of grid.querySelectorAll<HTMLElement>('.og-ws-cal-day')) {
			const day = toDay(parseCellDate(cell.dataset.day!)!);
			cell.toggleAttribute('data-drop', day >= from && day <= to);
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

	/** Steps a month (or a week) and slides the new one in from that side. */
	const go = (step: number | 'today') => {
		const before = anchor;
		if (step === 'today') anchor = today();
		else if (weekMode()) anchor += step * 7;
		else {
			const date = fromDay(anchor);
			anchor = toDay(new Date(date.getFullYear(), date.getMonth() + step, 1));
		}
		context.remember('anchor', fromDay(anchor));
		render();
		const direction = anchor > before ? 1 : anchor < before ? -1 : 0;
		if (direction) motion.slideIn(grid, direction, 40);
	};

	const toolbar = () => {
		label = h('strong', 'og-ws-cal-label', null, title());
		const modeButton = button({ icon: 'calendar', label: weekMode() ? 'Week' : 'Month', title: 'Month or week' }, () =>
			context.updateView({ mode: weekMode() ? 'month' : 'week' })
		);
		modeButton.classList.add('og-ws-cal-mode');
		return h(
			'div',
			'og-ws-group',
			null,
			button({ icon: 'today', label: 'Today' }, () => go('today')),
			button({ icon: 'chevronLeft', title: weekMode() ? 'Previous week' : 'Previous month' }, () => go(-1)),
			button({ icon: 'chevronRight', title: weekMode() ? 'Next week' : 'Next month' }, () => go(1)),
			label,
			modeButton
		);
	};

	const settings = (): ViewSettingsSection[] => {
		const dateFields = context.columns().filter((col) => col.schema && ['date', 'datetime', 'dateRange'].includes(col.schema.kind));
		const placedBy = config.records?.schedule ?? config.records?.due ?? reader.roles.schedule ?? reader.roles.due ?? '';
		return [
			{
				title: 'Calendar',
				settings: [
					{
						kind: 'segmented',
						id: 'mode',
						label: 'Show',
						value: weekMode() ? 'week' : 'month',
						options: [
							{ value: 'month', label: 'Month' },
							{ value: 'week', label: 'Week' },
						],
						onChange: (value) => context.updateView({ mode: value as 'month' }),
					},
					{
						kind: 'select',
						id: 'dateField',
						label: 'Place records by',
						value: placedBy,
						options: dateFields.map((col) => ({ value: col.field, label: col.header ?? col.field })),
						onChange: (value) => {
							const kind = reader.column(value)?.schema?.kind;
							// '' turns the schedule role off (undefined would infer the range column again).
							context.updateView({
								records: {
									...config.records,
									schedule: kind === 'dateRange' ? value : '',
									due: kind === 'dateRange' ? undefined : value,
								},
							});
						},
					},
					{
						kind: 'segmented',
						id: 'weekStartsOn',
						label: 'Weeks start on',
						value: String(weekStartsOn()),
						options: [
							{ value: '1', label: 'Monday' },
							{ value: '0', label: 'Sunday' },
							{ value: '6', label: 'Saturday' },
						],
						onChange: (value) => context.updateView({ weekStartsOn: Number(value) }),
					},
					{
						kind: 'toggle',
						id: 'weekends',
						label: 'Show weekends',
						value: config.showWeekends !== false,
						onChange: (value) => context.updateView({ showWeekends: value }),
					},
				],
			},
		];
	};

	const commands = (): WorkspaceCommand[] => [
		{
			id: 'calendar:today',
			label: weekMode() ? 'Go to this week' : 'Go to this month',
			group: 'Calendar',
			icon: 'today',
			run: () => go('today'),
		},
		{ id: 'calendar:prev', label: weekMode() ? 'Previous week' : 'Previous month', group: 'Calendar', icon: 'chevronLeft', run: () => go(-1) },
		{ id: 'calendar:next', label: weekMode() ? 'Next week' : 'Next month', group: 'Calendar', icon: 'chevronRight', run: () => go(1) },
		{
			id: 'calendar:mode',
			label: `Show a ${weekMode() ? 'month' : 'week'}`,
			group: 'Calendar',
			icon: 'calendar',
			run: () => context.updateView({ mode: weekMode() ? 'month' : 'week' }),
		},
		{
			id: 'calendar:weekends',
			label: `${config.showWeekends === false ? 'Show' : 'Hide'} weekends`,
			group: 'Calendar',
			icon: 'calendar',
			run: () => context.updateView({ showWeekends: config.showWeekends === false }),
		},
	];

	return {
		render: () => render(true),
		update(next) {
			const before = config;
			config = next as CalendarViewConfig<T>;
			render(false);
			if (before.mode !== config.mode || before.showWeekends !== config.showWeekends || before.weekStartsOn !== config.weekStartsOn)
				motion.slideIn(grid, 0, 0);
			const mode = root.parentElement?.querySelector<HTMLElement>('.og-ws-cal-mode .og-ws-btn-label');
			if (mode) mode.textContent = weekMode() ? 'Week' : 'Month';
		},
		settings,
		order: () => order,
		reveal(id) {
			const els = entryEls.get(id);
			if (els?.length) return els[0];
			// Off this month or week: go to the record's.
			const row = context.lookup(id);
			const span = row ? reader.span(row) : null;
			if (!span) return null;
			anchor = span.start;
			context.remember('anchor', fromDay(anchor));
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
.og-ws-cal-weekdays { flex: none; display: grid; grid-template-columns: repeat(var(--og-ws-cal-cols, 7), 1fr); }
.og-ws-cal-weekdays span { padding: 10px 8px 8px; color: var(--og-ws-muted); font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
.og-ws-cal-grid { flex: 1 0 auto; display: grid; grid-template-rows: repeat(var(--og-ws-cal-weeks, 6), minmax(124px, 1fr)); border: 1px solid var(--og-ws-line); border-radius: var(--og-ws-radius); overflow: hidden; }
.og-ws-cal[data-mode='week'] .og-ws-cal-grid { grid-template-rows: minmax(420px, 1fr); }
.og-ws-cal-week { position: relative; display: grid; grid-template-columns: repeat(var(--og-ws-cal-cols, 7), 1fr); min-height: 0; }
.og-ws-cal-week + .og-ws-cal-week { border-top: 1px solid var(--og-ws-line); }
.og-ws-cal-day { position: relative; min-width: 0; padding: 6px 8px; transition: background-color .15s ease; }
.og-ws-cal-day + .og-ws-cal-day { border-left: 1px solid var(--og-ws-line); }
.og-ws-cal-day[data-weekend] { background: color-mix(in srgb, var(--og-text-color) 2%, transparent); }
.og-ws-cal-day[data-outside] .og-ws-cal-date { color: var(--og-ws-faint); }
.og-ws-cal-day[data-drop] { background: color-mix(in srgb, var(--og-focus-ring) 12%, transparent); }
.og-ws-cal-date { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--og-ws-muted); }
.og-ws-cal-day[data-today] .og-ws-cal-date { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; margin: -3px 0 0 -5px; border-radius: 99px; background: #ef4444; color: #fff; }
.og-ws-cal-add { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; display: grid; place-items: center; border: 0; border-radius: 6px; background: var(--og-ws-hover); color: var(--og-ws-muted); cursor: pointer; opacity: 0; transform: scale(.8); transition: opacity .12s ease, transform .15s cubic-bezier(.34,1.3,.5,1); }
.og-ws-cal-day:hover .og-ws-cal-add, .og-ws-cal-add:focus-visible { opacity: 1; transform: none; }
.og-ws-cal-entry { position: absolute; height: ${LANE_H - 3}px; display: flex; align-items: center; gap: 6px; padding: 0 7px; border-radius: 5px; font-size: 11.5px; font-weight: 550; color: var(--og-ws-text); background: color-mix(in srgb, var(--og-ws-accent) 22%, var(--og-ws-bg)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--og-ws-accent) 40%, transparent); cursor: pointer; overflow: hidden; white-space: nowrap; z-index: 1; outline: none; transition: filter .15s ease, box-shadow .15s ease; }
.og-ws-cal-entry:hover { filter: brightness(1.15); }
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
