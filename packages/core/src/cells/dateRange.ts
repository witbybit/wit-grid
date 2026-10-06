/** Date ranges: “Mar 4 – 18, 2026” in the cell, a two-month range calendar with presets to edit. */
import type { DomCellEditor, DomCellRenderer } from '../columnDef.js';
import { editSession, editorShell } from './editors.js';
import { cellIconSvg, createCellIcon } from './icons.js';
import { parseCellDate, toIsoDay } from './format.js';
import { openCellPopover } from './popover.js';
import { valueRenderer } from './renderers.js';

export interface DateRange {
	start: Date;
	end: Date;
}

export interface DateRangePreset {
	label: string;
	/** The range, worked out when picked (relative to today). */
	range: () => DateRange;
}

export interface DateRangeCellOptions {
	locale?: string;
	/** 0 Sunday … 6 Saturday. Default 1. */
	weekStartsOn?: number;
	/** Months side by side in the picker. Default 2 (1 on narrow screens). */
	months?: 1 | 2;
	/** Quick ranges beside the calendar; `false` hides them. Default: common ranges. */
	presets?: readonly DateRangePreset[] | false;
	/** Show the range's length (e.g. “15d”) after the dates. Default true. */
	showLength?: boolean;
}

const DAY = 86_400_000;

function day(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number): Date {
	return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function same(a: Date | null, b: Date | null): boolean {
	return !!a && !!b && a.getTime() === b.getTime();
}

/** Days in a range, both ends counted. */
export function dateRangeLength(range: DateRange): number {
	return Math.round((day(range.end).getTime() - day(range.start).getTime()) / DAY) + 1;
}

/** A range from `{ start, end }`, `[start, end]` or an ISO interval string `start/end`; null otherwise. */
export function parseDateRange(value: unknown): DateRange | null {
	let start: unknown;
	let end: unknown;
	if (Array.isArray(value)) [start, end] = value;
	else if (value && typeof value === 'object') ({ start, end } = value as { start?: unknown; end?: unknown });
	else if (typeof value === 'string' && value.includes('/')) [start, end] = value.split('/');
	else return null;
	const a = parseCellDate(start);
	const b = parseCellDate(end);
	if (!a || !b) return null;
	return a <= b ? { start: day(a), end: day(b) } : { start: day(b), end: day(a) };
}

/** Writes a range in the shape the cell held: object (default), array or ISO interval string. */
export function writeDateRange(previous: unknown, range: DateRange | null): unknown {
	if (!range) return null;
	const start = toIsoDay(range.start);
	const end = toIsoDay(range.end);
	if (Array.isArray(previous)) return [start, end];
	if (typeof previous === 'string') return `${start}/${end}`;
	return { start, end };
}

const rangeFormats = new Map<string, Intl.DateTimeFormat>();

export function formatDateRange(range: DateRange, locale?: string): string {
	const key = locale ?? '';
	let format = rangeFormats.get(key);
	if (!format) {
		format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
		rangeFormats.set(key, format);
	}
	const withRange = format as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
	return withRange.formatRange ? withRange.formatRange(range.start, range.end) : `${format.format(range.start)} – ${format.format(range.end)}`;
}

function startOfWeek(date: Date, weekStartsOn: number): Date {
	return addDays(day(date), -((date.getDay() - weekStartsOn + 7) % 7));
}

/** Common quick ranges, relative to today. */
export function defaultDateRangePresets(weekStartsOn = 1): DateRangePreset[] {
	const today = () => day(new Date());
	return [
		{ label: 'Today', range: () => ({ start: today(), end: today() }) },
		{ label: 'Last 7 days', range: () => ({ start: addDays(today(), -6), end: today() }) },
		{ label: 'Last 30 days', range: () => ({ start: addDays(today(), -29), end: today() }) },
		{
			label: 'This week',
			range: () => {
				const start = startOfWeek(today(), weekStartsOn);
				return { start, end: addDays(start, 6) };
			},
		},
		{
			label: 'This month',
			range: () => {
				const t = today();
				return { start: new Date(t.getFullYear(), t.getMonth(), 1), end: new Date(t.getFullYear(), t.getMonth() + 1, 0) };
			},
		},
		{
			label: 'Last month',
			range: () => {
				const t = today();
				return { start: new Date(t.getFullYear(), t.getMonth() - 1, 1), end: new Date(t.getFullYear(), t.getMonth(), 0) };
			},
		},
		{
			label: 'This quarter',
			range: () => {
				const t = today();
				const q = Math.floor(t.getMonth() / 3) * 3;
				return { start: new Date(t.getFullYear(), q, 1), end: new Date(t.getFullYear(), q + 3, 0) };
			},
		},
		{ label: 'Next 30 days', range: () => ({ start: today(), end: addDays(today(), 29) }) },
		{ label: 'Year to date', range: () => ({ start: new Date(today().getFullYear(), 0, 1), end: today() }) },
	];
}

export function createDateRangeRenderer(options: DateRangeCellOptions = {}): DomCellRenderer<any> {
	const showLength = options.showLength ?? true;
	return valueRenderer((root) => {
		const icon = createCellIcon('calendar', 13);
		const label = document.createElement('span');
		label.className = 'og-ct-text';
		const length = document.createElement('span');
		length.className = 'og-ct-range-length';
		root.append(icon, label, length);
		return (value) => {
			const range = parseDateRange(value);
			icon.style.visibility = range ? '' : 'hidden';
			label.textContent = range ? formatDateRange(range, options.locale) : '';
			length.textContent = range && showLength ? `${dateRangeLength(range)}d` : '';
		};
	});
}

/**
 * Picks a range on a two-month calendar: the first click starts it, the second ends it (hovering
 * previews), Apply saves. Presets save at once. Arrow keys move a day / week, PageUp / PageDown a
 * month, Enter picks.
 */
export function createDateRangeEditor(options: DateRangeCellOptions = {}): DomCellEditor<any> {
	const weekStartsOn = options.weekStartsOn ?? 1;
	const presets = options.presets === false ? [] : (options.presets ?? defaultDateRangePresets(weekStartsOn));
	return {
		mount(container, params) {
			const root = editorShell(container);
			const end = editSession(params, container);
			const initial = parseDateRange(params.value);
			root.appendChild(createCellIcon('calendar', 13));
			const cellText = document.createElement('span');
			cellText.className = 'og-ct-text';
			root.appendChild(cellText);

			let start: Date | null = initial?.start ?? null;
			let finish: Date | null = initial?.end ?? null;
			let hover: Date | null = null;
			let cursor = day(initial?.start ?? new Date());
			let view = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
			const monthCount = options.months ?? (window.innerWidth < 640 ? 1 : 2);

			const panel = document.createElement('div');
			panel.className = 'og-ct-range-panel';
			if (presets.length > 0) {
				const side = document.createElement('div');
				side.className = 'og-ct-range-presets';
				for (const preset of presets) {
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'og-ct-range-preset';
					button.textContent = preset.label;
					button.addEventListener('mousedown', (event) => event.preventDefault());
					button.addEventListener('click', () => end.commit(writeDateRange(params.value, preset.range())));
					side.appendChild(button);
				}
				panel.appendChild(side);
			}
			const main = document.createElement('div');
			main.className = 'og-ct-range-main';
			const months = document.createElement('div');
			months.className = 'og-ct-range-months';
			months.tabIndex = 0;
			months.setAttribute('role', 'application');
			months.setAttribute('aria-label', 'Choose a date range');
			const foot = document.createElement('div');
			foot.className = 'og-ct-cal-foot';
			const summary = document.createElement('span');
			summary.className = 'og-ct-range-summary';
			const actions = document.createElement('span');
			actions.className = 'og-ct-range-actions';
			const button = (label: string, onClick: () => void, kind?: 'ghost' | 'primary') => {
				const b = document.createElement('button');
				b.type = 'button';
				b.className = 'og-ct-btn';
				if (kind) b.setAttribute(`data-${kind}`, '');
				b.textContent = label;
				b.addEventListener('mousedown', (event) => event.preventDefault());
				b.addEventListener('click', onClick);
				return b;
			};
			const apply = button('Apply', () => commitRange(), 'primary');
			actions.append(
				button('Clear', () => end.commit(null), 'ghost'),
				button('Cancel', () => end.cancel()),
				apply
			);
			foot.append(summary, actions);
			main.append(months, foot);
			panel.appendChild(main);

			const monthTitle = new Intl.DateTimeFormat(options.locale, { month: 'long', year: 'numeric' });
			const dayLabel = new Intl.DateTimeFormat(options.locale, { dateStyle: 'full' });
			const weekday = new Intl.DateTimeFormat(options.locale, { weekday: 'short' });

			const complete = (): DateRange | null => (start && finish ? { start, end: finish } : null);
			const commitRange = () => {
				const range = complete();
				if (range) end.commit(writeDateRange(params.value, range));
			};

			function pick(date: Date) {
				if (!start || finish) {
					start = date;
					finish = null;
				} else if (date < start) {
					finish = start;
					start = date;
				} else {
					finish = date;
				}
				cursor = date;
				const range = complete();
				params.onChange(range ? writeDateRange(params.value, range) : params.value);
				render();
			}

			function render() {
				months.textContent = '';
				// While choosing the end, the hovered (or keyboard) day previews it.
				const previewEnd = start && !finish ? (hover ?? cursor) : finish;
				const lo = start && previewEnd ? (previewEnd < start ? previewEnd : start) : start;
				const hi = start && previewEnd ? (previewEnd < start ? start : previewEnd) : start;
				for (let m = 0; m < monthCount; m++) {
					const month = addMonths(view, m);
					const block = document.createElement('div');
					block.className = 'og-ct-calendar';
					const head = document.createElement('div');
					head.className = 'og-ct-cal-head';
					const prev = document.createElement('button');
					prev.type = 'button';
					prev.className = 'og-ct-cal-nav';
					prev.innerHTML = cellIconSvg('chevronLeft', 15);
					prev.setAttribute('aria-label', 'Previous month');
					const next = document.createElement('button');
					next.type = 'button';
					next.className = 'og-ct-cal-nav';
					next.innerHTML = cellIconSvg('chevronRight', 15);
					next.setAttribute('aria-label', 'Next month');
					for (const nav of [prev, next]) nav.addEventListener('mousedown', (event) => event.preventDefault());
					prev.addEventListener('click', () => {
						view = addMonths(view, -1);
						render();
					});
					next.addEventListener('click', () => {
						view = addMonths(view, 1);
						render();
					});
					// Only the outer edges carry navigation.
					if (m > 0) prev.style.visibility = 'hidden';
					if (m < monthCount - 1) next.style.visibility = 'hidden';
					const title = document.createElement('div');
					title.textContent = monthTitle.format(month);
					head.append(prev, title, next);
					const grid = document.createElement('div');
					grid.className = 'og-ct-cal-grid';
					for (let i = 0; i < 7; i++) {
						const dow = document.createElement('div');
						dow.className = 'og-ct-cal-dow';
						dow.textContent = weekday.format(new Date(2024, 0, 7 + ((weekStartsOn + i) % 7))).slice(0, 2);
						grid.appendChild(dow);
					}
					const first = startOfWeek(month, weekStartsOn);
					const today = day(new Date());
					for (let i = 0; i < 42; i++) {
						const date = addDays(first, i);
						const cell = document.createElement('button');
						cell.type = 'button';
						cell.tabIndex = -1;
						cell.className = 'og-ct-cal-day';
						if (date.getMonth() !== month.getMonth()) {
							// Days of the neighbouring months stay blank in a range picker.
							cell.style.visibility = 'hidden';
							grid.appendChild(cell);
							continue;
						}
						cell.textContent = String(date.getDate());
						cell.setAttribute('aria-label', dayLabel.format(date));
						const edge = same(date, lo) || same(date, hi);
						cell.setAttribute('aria-selected', String(edge));
						if (same(date, lo)) cell.setAttribute('data-range-start', '');
						if (same(date, hi)) cell.setAttribute('data-range-end', '');
						if (lo && hi && date > lo && date < hi) cell.setAttribute('data-in-range', '');
						if (same(date, today)) cell.setAttribute('data-today', '');
						if (same(date, cursor) && document.activeElement === months) cell.setAttribute('data-active', '');
						cell.addEventListener('mousedown', (event) => event.preventDefault());
						cell.addEventListener('click', () => pick(date));
						cell.addEventListener('mouseenter', () => {
							if (start && !finish && !same(hover, date)) {
								hover = date;
								render();
							}
						});
						grid.appendChild(cell);
					}
					block.append(head, grid);
					months.appendChild(block);
				}
				const range = complete();
				summary.textContent = range
					? `${formatDateRange(range, options.locale)} · ${dateRangeLength(range)} days`
					: start
						? 'Pick an end date'
						: 'Pick a start date';
				cellText.textContent = range ? formatDateRange(range, options.locale) : '';
				apply.disabled = !range;
			}

			months.addEventListener('keydown', (event) => {
				const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
				let next: Date | null = null;
				if (event.key in moves) next = addDays(cursor, moves[event.key]);
				else if (event.key === 'PageUp' || event.key === 'PageDown') {
					const delta = event.key === 'PageUp' ? -1 : 1;
					next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, Math.min(cursor.getDate(), 28));
				} else if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					// Enter saves a complete range; otherwise (and Space, always) it picks the day.
					if (event.key === 'Enter' && complete()) commitRange();
					else pick(cursor);
					return;
				} else return;
				event.preventDefault();
				cursor = next;
				hover = null;
				const last = addMonths(view, monthCount - 1);
				if (cursor < view) view = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
				else if (cursor > new Date(last.getFullYear(), last.getMonth() + 1, 0))
					view = addMonths(new Date(cursor.getFullYear(), cursor.getMonth(), 1), -(monthCount - 1));
				render();
			});
			months.addEventListener('focus', render);
			months.addEventListener('mouseleave', () => {
				if (hover) {
					hover = null;
					render();
				}
			});

			const popover = openCellPopover({
				anchor: root,
				content: panel,
				className: 'og-ct-popover-wide',
				label: 'Choose a date range',
				// Clicking away keeps a complete range; Escape (or an unfinished one) leaves the cell as it was.
				onDismiss: (reason) => {
					const range = complete();
					if (reason === 'outside' && range) end.commit(writeDateRange(params.value, range), true);
					else end.cancel(reason === 'outside');
				},
			});
			render();
			end.hold(() => months.focus({ preventScroll: true }));
			return {
				destroy() {
					end.release();
					popover.close();
				},
			};
		},
	};
}
