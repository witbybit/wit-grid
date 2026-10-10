import { fromDay, toDay, weekday, type Day } from '../days.js';

export type TimeZoom = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const TIME_ZOOMS: readonly TimeZoom[] = ['day', 'week', 'month', 'quarter', 'year'];

/** Pixels per day at each zoom. */
export const ZOOM_DAY_WIDTH: Record<TimeZoom, number> = { day: 44, week: 20, month: 5.5, quarter: 1.9, year: 0.62 };

export interface TimeTick {
	start: Day;
	/** Exclusive. */
	end: Day;
	label: string;
	/** Short secondary text (a week's dates). */
	detail?: string;
	x: number;
	width: number;
	/** A weekend day (day zoom), drawn quieter. */
	quiet?: boolean;
}

/** ISO 8601 week number. */
export function isoWeek(day: Day): number {
	const date = fromDay(day);
	const thursday = toDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 3 - ((date.getDay() + 6) % 7)));
	const yearStart = toDay(new Date(fromDay(thursday).getFullYear(), 0, 1));
	return Math.floor((thursday - yearStart) / 7) + 1;
}

const startOfMonth = (day: Day) => {
	const date = fromDay(day);
	return toDay(new Date(date.getFullYear(), date.getMonth(), 1));
};
const addMonths = (day: Day, months: number) => {
	const date = fromDay(day);
	return toDay(new Date(date.getFullYear(), date.getMonth() + months, 1));
};

/**
 * Days to pixels and back for one zoom level, and the two header tiers (major, minor) the timeline
 * draws over a range of days.
 */
export class TimeScale {
	readonly dayWidth: number;
	private readonly formats: Record<string, Intl.DateTimeFormat>;

	constructor(
		readonly origin: Day,
		readonly zoom: TimeZoom,
		dayWidth?: number,
		locale?: string
	) {
		this.dayWidth = dayWidth ?? ZOOM_DAY_WIDTH[zoom];
		this.formats = {
			month: new Intl.DateTimeFormat(locale, { month: 'short' }),
			monthYear: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
			shortMonthYear: new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }),
			dayMonth: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
			weekday: new Intl.DateTimeFormat(locale, { weekday: 'narrow' }),
		};
	}

	x(day: Day): number {
		return (day - this.origin) * this.dayWidth;
	}

	/** The day under a pixel offset. */
	dayAt(x: number): Day {
		return this.origin + Math.floor(x / this.dayWidth);
	}

	/** The two header tiers over `[from, to)`. */
	ticks(from: Day, to: Day): { major: TimeTick[]; minor: TimeTick[] } {
		const tick = (start: Day, end: Day, label: string, detail?: string, quiet?: boolean): TimeTick => ({
			start,
			end,
			label,
			detail,
			x: this.x(start),
			width: (end - start) * this.dayWidth,
			quiet,
		});
		const weeks = (): TimeTick[] => {
			const out: TimeTick[] = [];
			let start = from - ((weekday(from) + 6) % 7);
			for (; start < to; start += 7) {
				const label = `W${isoWeek(start)}`;
				const detail = `${this.formats.dayMonth.format(fromDay(start))} – ${this.formats.dayMonth.format(fromDay(start + 6))}`;
				out.push(tick(start, start + 7, label, detail));
			}
			return out;
		};
		const months = (format: Intl.DateTimeFormat): TimeTick[] => {
			const out: TimeTick[] = [];
			for (let start = startOfMonth(from); start < to; start = addMonths(start, 1))
				out.push(tick(start, addMonths(start, 1), format.format(fromDay(start))));
			return out;
		};
		const quarters = (withYear: boolean): TimeTick[] => {
			const out: TimeTick[] = [];
			const first = fromDay(from);
			let start = toDay(new Date(first.getFullYear(), Math.floor(first.getMonth() / 3) * 3, 1));
			for (; start < to; start = addMonths(start, 3)) {
				const date = fromDay(start);
				out.push(tick(start, addMonths(start, 3), `Q${Math.floor(date.getMonth() / 3) + 1}${withYear ? ` ${date.getFullYear()}` : ''}`));
			}
			return out;
		};
		const years = (): TimeTick[] => {
			const out: TimeTick[] = [];
			for (let year = fromDay(from).getFullYear(); toDay(new Date(year, 0, 1)) < to; year++)
				out.push(tick(toDay(new Date(year, 0, 1)), toDay(new Date(year + 1, 0, 1)), String(year)));
			return out;
		};
		switch (this.zoom) {
			case 'day': {
				const minor: TimeTick[] = [];
				for (let day = from; day < to; day++) {
					const date = fromDay(day);
					const w = weekday(day);
					minor.push(tick(day, day + 1, `${this.formats.weekday.format(date)} ${date.getDate()}`, undefined, w === 0 || w === 6));
				}
				return { major: weeks(), minor };
			}
			case 'week':
				return { major: months(this.formats.monthYear), minor: weeks() };
			case 'month':
				return { major: quarters(true), minor: months(this.formats.month) };
			case 'quarter':
				return { major: years(), minor: months(this.formats.month) };
			case 'year':
				return { major: years(), minor: quarters(false) };
		}
	}
}
