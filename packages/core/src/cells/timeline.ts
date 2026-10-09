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

/** The column's time scale, shared by its cells; they redraw together when it widens. */
class TimelineScale {
	start: Date;
	end: Date;
	ticks = '';
	private readonly cells = new Set<() => void>();

	constructor(
		start: Date,
		end: Date,
		private readonly fixed: boolean,
		private readonly showToday: boolean
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

	/** Widens to include `range` (unless fixed); every mounted cell redraws. */
	include(range: DateRange): void {
		if (this.fixed || (range.start >= this.start && range.end <= this.end)) return;
		const [start, end] = padToWeeks(range.start < this.start ? range.start : this.start, range.end > this.end ? range.end : this.end);
		this.start = start;
		this.end = end;
		this.buildTicks();
		for (const redraw of this.cells) redraw();
	}

	register(redraw: () => void): () => void {
		this.cells.add(redraw);
		return () => this.cells.delete(redraw);
	}

	/** Month starts (and today) as 1px background lines, one layer each. */
	private buildTicks(): void {
		const layers: string[] = [];
		const line = (fraction: number, colour: string, width: number) => {
			const at = `${(fraction * 100).toFixed(3)}%`;
			layers.push(
				`linear-gradient(to right, transparent calc(${at} - ${width / 2}px), ${colour} calc(${at} - ${width / 2}px), ${colour} calc(${at} + ${width / 2}px), transparent calc(${at} + ${width / 2}px))`
			);
		};
		const month = new Date(this.start.getFullYear(), this.start.getMonth() + 1, 1);
		for (; month < this.end; month.setMonth(month.getMonth() + 1)) line(this.at(month), 'var(--og-ct-timeline-tick)', 1);
		const today = startOfDay(new Date());
		if (this.showToday && today > this.start && today < this.end) line(this.at(today), 'var(--og-ct-timeline-today)', 2);
		this.ticks = layers.join(', ');
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
			const lengthLabel = new Intl.DateTimeFormat(options.locale, { month: 'short', day: 'numeric' });

			const draw = () => {
				if (ticks !== scale.ticks) {
					ticks = scale.ticks;
					track.style.backgroundImage = ticks;
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
