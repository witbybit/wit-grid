import { parseCellDate } from '../../cells/format.js';
import { toDay, weekday, type Day, type DaySpan } from '../days.js';

export interface WorkCalendarConfig {
	/** Working weekdays, 0 = Sunday. Default Monday–Friday. */
	workingDays?: readonly number[];
	/** Non-working dates (ISO days, Dates). */
	holidays?: readonly (string | Date)[];
}

/**
 * Which days are worked: durations, lags and moves count working days, and the timeline shades the
 * rest. A calendar with no working day at all treats every day as working.
 */
export class WorkCalendar {
	private readonly working: boolean[];
	private readonly holidays: Set<Day>;

	constructor(config: WorkCalendarConfig = {}) {
		const days = config.workingDays ?? [1, 2, 3, 4, 5];
		this.working = Array.from({ length: 7 }, (_, i) => days.includes(i));
		if (!this.working.some(Boolean)) this.working.fill(true);
		this.holidays = new Set(
			(config.holidays ?? []).flatMap((value) => {
				const date = parseCellDate(value);
				return date ? [toDay(date)] : [];
			})
		);
	}

	isWorking(day: Day): boolean {
		return this.working[weekday(day)] && !this.holidays.has(day);
	}

	isHoliday(day: Day): boolean {
		return this.holidays.has(day);
	}

	/** The day itself if worked, else the next working day. */
	forward(day: Day): Day {
		for (let i = 0; i < 400 && !this.isWorking(day); i++) day++;
		return day;
	}

	/** The day itself if worked, else the previous working day. */
	backward(day: Day): Day {
		for (let i = 0; i < 400 && !this.isWorking(day); i++) day--;
		return day;
	}

	/** `count` working days after `day` (before it when negative); 0 snaps forward. */
	add(day: Day, count: number): Day {
		if (count === 0) return this.forward(day);
		const step = count > 0 ? 1 : -1;
		let remaining = Math.abs(count);
		let current = day;
		// Whole weeks first, then day by day.
		const perWeek = this.working.filter(Boolean).length;
		if (this.holidays.size === 0 && remaining > perWeek * 2) {
			const weeks = Math.floor(remaining / perWeek) - 1;
			current += step * weeks * 7;
			remaining -= weeks * perWeek;
		}
		while (remaining > 0) {
			current += step;
			if (this.isWorking(current)) remaining--;
		}
		return current;
	}

	/** Working days in `[from, to]` inclusive (0 when `to` is before `from`). */
	between(from: Day, to: Day): number {
		if (to < from) return 0;
		let count = 0;
		const span = to - from + 1;
		const perWeek = this.working.filter(Boolean).length;
		let day = from;
		if (this.holidays.size === 0 && span > 14) {
			const weeks = Math.floor(span / 7);
			count += weeks * perWeek;
			day += weeks * 7;
		}
		for (; day <= to; day++) if (this.isWorking(day)) count++;
		return count;
	}

	/** Signed working-day distance from `from` to `to` (positive when `to` is later). */
	distance(from: Day, to: Day): number {
		if (to === from) return 0;
		return to > from ? this.between(from + 1, to) : -this.between(to + 1, from);
	}

	/** A span's duration in working days (at least 1, or 0 for a milestone). */
	duration(span: DaySpan, milestone = false): number {
		if (milestone) return 0;
		return Math.max(1, this.between(span.start, span.end));
	}

	/** The span starting at `start` (snapped to a working day) lasting `duration` working days. */
	spanFrom(start: Day, duration: number): DaySpan {
		const first = this.forward(start);
		return { start: first, end: duration <= 1 ? first : this.add(first, duration - 1) };
	}

	/** The span ending at `end` (snapped back to a working day) lasting `duration` working days. */
	spanTo(end: Day, duration: number): DaySpan {
		const last = this.backward(end);
		return { start: duration <= 1 ? last : this.add(last, -(duration - 1)), end: last };
	}
}
