/**
 * Timeline cells: a date range drawn as a bar on a time scale shared by the whole column (a Gantt
 * column). Drag the bar to move it, its ends to resize it; the range is written back in the shape the
 * cell held, like the date range type.
 */
import type { DomCellRenderer, DomCellRendererParams } from '../columnDef.js';
import { parseCellDate } from './format.js';
import { parseDateRange, writeDateRange, type DateRange } from './dateRange.js';
import { resolveCellColor, type CellColor } from './palette.js';
import { cell, writeValue } from './renderers.js';
import { defaultGridScheduler, type GridScheduler } from '../renderer/gridScheduler.js';

export interface TimelineCellOptions {
	/** The span the column shows. Default: the column's earliest start to latest end, padded to whole weeks. */
	range?: { start: string | Date; end: string | Date };
	/** The bar colour, or a colour per row. Default: the theme accent. */
	color?: CellColor | ((row: any) => CellColor | undefined);
	/** Drag to move and resize. Default true. */
	editable?: boolean;
	/** A line at today. Default true. */
	showToday?: boolean;
	locale?: string;
}

type Params = DomCellRendererParams<any>;

const DAY_MS = 86_400_000;
const EDGE_PX = 7;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);

/** The column's time scale, shared by its cells; they redraw together when it widens or the day turns. */
class TimelineScale {
	start: Date;
	end: Date;
	/** Month starts, drawn dashed (quarter starts in their own colour). */
	ticks = '';
	/** Today, drawn solid. */
	today = '';
	private readonly cells = new Set<() => void>();
	private midnight: ReturnType<GridScheduler['timeout']> | null = null;

	constructor(
		start: Date,
		end: Date,
		private readonly fixed: boolean,
		private readonly showToday: boolean,
		private readonly scheduler: GridScheduler = defaultGridScheduler
	) {
		this.start = start;
		this.end = end;
		this.buildTicks();
	}

	get days(): number {
		return Math.max(1, daysBetween(this.start, this.end));
	}

	/** Fraction of the scale at `date` (0 = start, 1 = end). */
	at(date: Date): number {
		return daysBetween(this.start, date) / this.days;
	}

	/** The day at `fraction` of the scale. */
	dateAt(fraction: number): Date {
		return addDays(this.start, Math.floor(Math.min(1, Math.max(0, fraction)) * this.days));
	}

	/** Widens to include `range` (unless fixed); every mounted cell redraws. */
	include(range: DateRange): void {
		if (this.fixed || (range.start >= this.start && range.end <= this.end)) return;
		const [start, end] = padToWeeks(range.start < this.start ? range.start : this.start, range.end > this.end ? range.end : this.end);
		this.start = start;
		this.end = end;
		this.rebuild();
	}

	/** While any cell is mounted, the today line steps to the next day at midnight. */
	register(redraw: () => void): () => void {
		this.cells.add(redraw);
		if (this.showToday && this.midnight === null) this.scheduleMidnight();
		return () => {
			this.cells.delete(redraw);
			if (this.cells.size === 0 && this.midnight !== null) {
				this.scheduler.clearTimeout(this.midnight);
				this.midnight = null;
			}
		};
	}

	private scheduleMidnight(): void {
		const now = new Date();
		const next = addDays(startOfDay(now), 1);
		this.midnight = this.scheduler.timeout(() => {
			this.midnight = null;
			this.rebuild();
			if (this.cells.size > 0) this.scheduleMidnight();
		}, next.getTime() - now.getTime() + 1000);
	}

	private rebuild(): void {
		this.buildTicks();
		for (const redraw of this.cells) redraw();
	}

	/** Month starts and today as background lines, one layer each. */
	private buildTicks(): void {
		const line = (fraction: number, colour: string, width: number) => {
			const at = `${(fraction * 100).toFixed(3)}%`;
			return `linear-gradient(to right, transparent calc(${at} - ${width / 2}px), ${colour} calc(${at} - ${width / 2}px), ${colour} calc(${at} + ${width / 2}px), transparent calc(${at} + ${width / 2}px))`;
		};
		const months: string[] = [];
		const month = new Date(this.start.getFullYear(), this.start.getMonth() + 1, 1);
		for (; month < this.end; month.setMonth(month.getMonth() + 1)) {
			const colour = month.getMonth() % 3 === 0 ? 'var(--og-ct-timeline-quarter)' : 'var(--og-ct-timeline-tick)';
			months.push(line(this.at(month), colour, 1));
		}
		this.ticks = months.join(', ') || 'none';
		const today = startOfDay(new Date());
		this.today = this.showToday && today > this.start && today < this.end ? line(this.at(today), 'var(--og-ct-timeline-today)', 2) : 'none';
	}
}

/** Pads a span to whole weeks (Monday to Monday) with a few days' margin. */
function padToWeeks(start: Date, end: Date): [Date, Date] {
	const from = addDays(start, -3);
	const to = addDays(end, 4);
	const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
	return [monday(from), addDays(monday(to), 7)];
}

function resolveColor(option: TimelineCellOptions['color'], row: unknown): string | undefined {
	const colour = typeof option === 'function' ? option(row) : option;
	return resolveCellColor(colour);
}

export function createTimelineRenderer(options: TimelineCellOptions = {}): DomCellRenderer<any> {
	const editable = options.editable ?? true;
	// One scale per grid and column, so every cell lines up.
	const scales = new WeakMap<object, Map<string, TimelineScale>>();

	const scaleFor = (params: Params): TimelineScale => {
		let byField = scales.get(params.api);
		if (!byField) scales.set(params.api, (byField = new Map()));
		let scale = byField.get(params.col.field);
		if (scale) return scale;
		const fixedStart = options.range ? parseCellDate(options.range.start) : null;
		const fixedEnd = options.range ? parseCellDate(options.range.end) : null;
		if (fixedStart && fixedEnd) {
			scale = new TimelineScale(startOfDay(fixedStart), startOfDay(fixedEnd), true, options.showToday ?? true);
		} else {
			let min: Date | null = null;
			let max: Date | null = null;
			params.api.forEachNode((node) => {
				const range = parseDateRange((node.data as Record<string, unknown> | undefined)?.[params.col.field]);
				if (!range) return;
				if (!min || range.start < min) min = range.start;
				if (!max || range.end > max) max = range.end;
			});
			const today = startOfDay(new Date());
			const [start, end] = padToWeeks(min ?? today, max ?? addDays(today, 28));
			scale = new TimelineScale(start, end, false, options.showToday ?? true);
		}
		byField.set(params.col.field, scale);
		return scale;
	};

	return {
		mount(container, params) {
			const root = cell(container);
			const track = document.createElement('div');
			track.className = 'og-ct-timeline';
			const bar = document.createElement('div');
			bar.className = 'og-ct-timeline-bar';
			const label = document.createElement('span');
			label.className = 'og-ct-timeline-label';
			bar.appendChild(label);
			track.appendChild(bar);
			root.appendChild(track);
			if (editable) track.setAttribute('data-editable', '');

			const scale = scaleFor(params);
			let current = params;
			let shown: DateRange | null = null;
			let preview: DateRange | null = null;
			let ticks = '';
			let today = '';
			const lengthLabel = new Intl.DateTimeFormat(options.locale, { month: 'short', day: 'numeric' });

			const draw = () => {
				if (ticks !== scale.ticks) {
					ticks = scale.ticks;
					track.style.setProperty('--og-ct-ticks', ticks);
				}
				if (today !== scale.today) {
					today = scale.today;
					track.style.backgroundImage = today;
				}
				const range = preview ?? shown;
				bar.hidden = !range;
				if (!range) return;
				const left = scale.at(range.start);
				// A range ends at the end of its last day.
				const right = scale.at(addDays(range.end, 1));
				bar.style.left = `${(left * 100).toFixed(3)}%`;
				bar.style.width = `${(Math.max(0, right - left) * 100).toFixed(3)}%`;
				const days = daysBetween(range.start, range.end) + 1;
				label.textContent = `${days}d`;
				bar.title = `${lengthLabel.format(range.start)} – ${lengthLabel.format(range.end)} (${days} days)`;
			};

			const update = (p: Params) => {
				current = p;
				const colour = resolveColor(options.color, p.node.data);
				if (colour) bar.style.setProperty('--og-ct-hue', colour);
				else bar.style.removeProperty('--og-ct-hue');
				const next = parseDateRange(p.value);
				if (next) scale.include(next);
				shown = next;
				draw();
			};
			const unregister = scale.register(draw);

			// Drag: the bar moves, its ends resize; whole days, written once on release.
			let drag: { mode: 'move' | 'start' | 'end'; x: number; width: number; from: DateRange } | null = null;
			const modeAt = (event: PointerEvent): 'move' | 'start' | 'end' => {
				const rect = bar.getBoundingClientRect();
				if (event.clientX - rect.left < EDGE_PX) return 'start';
				if (rect.right - event.clientX < EDGE_PX) return 'end';
				return 'move';
			};
			// Off the bar, the track names the day under the pointer (and today).
			const dayLabel = new Intl.DateTimeFormat(options.locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
			const onTrackHover = (event: PointerEvent) => {
				if (event.target !== track) return;
				const rect = track.getBoundingClientRect();
				if (rect.width <= 0) return;
				const day = scale.dateAt((event.clientX - rect.left) / rect.width);
				const text = daysBetween(startOfDay(new Date()), day) === 0 ? `Today, ${dayLabel.format(day)}` : dayLabel.format(day);
				if (track.title !== text) track.title = text;
			};
			track.addEventListener('pointermove', onTrackHover);
			const onHover = (event: PointerEvent) => {
				if (!drag) bar.dataset.edge = modeAt(event);
			};
			const onDown = (event: PointerEvent) => {
				if (event.button !== 0 || !shown) return;
				event.stopPropagation();
				event.preventDefault();
				drag = { mode: modeAt(event), x: event.clientX, width: track.clientWidth || 1, from: shown };
				bar.setPointerCapture?.(event.pointerId);
				bar.setAttribute('data-dragging', '');
			};
			const onMove = (event: PointerEvent) => {
				if (!drag) return;
				const delta = Math.round(((event.clientX - drag.x) / drag.width) * scale.days);
				const { start, end } = drag.from;
				if (drag.mode === 'move') preview = { start: addDays(start, delta), end: addDays(end, delta) };
				else if (drag.mode === 'start') preview = { start: addDays(start, Math.min(delta, daysBetween(start, end))), end };
				else preview = { start, end: addDays(end, Math.max(delta, -daysBetween(start, end))) };
				draw();
			};
			const onUp = (event: PointerEvent) => {
				if (!drag) return;
				bar.releasePointerCapture?.(event.pointerId);
				bar.removeAttribute('data-dragging');
				const next = preview;
				const from = drag.from;
				drag = null;
				preview = null;
				if (next && (next.start.getTime() !== from.start.getTime() || next.end.getTime() !== from.end.getTime())) {
					writeValue(current, writeDateRange(current.value, next));
				} else {
					draw();
				}
			};
			if (editable) {
				bar.addEventListener('pointermove', onHover);
				bar.addEventListener('pointerdown', onDown);
				bar.addEventListener('pointermove', onMove);
				bar.addEventListener('pointerup', onUp);
				bar.addEventListener('pointercancel', onUp);
			}

			update(params);
			return {
				update,
				destroy: () => {
					unregister();
					track.removeEventListener('pointermove', onTrackHover);
					bar.removeEventListener('pointermove', onHover);
					bar.removeEventListener('pointerdown', onDown);
					bar.removeEventListener('pointermove', onMove);
					bar.removeEventListener('pointerup', onUp);
					bar.removeEventListener('pointercancel', onUp);
				},
			};
		},
	};
}
