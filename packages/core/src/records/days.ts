/**
 * Calendar days as integers (days since 1970-01-01, local calendar). Scheduling works in whole
 * days, and integer days are immune to DST shifts and cheap to compare, add and index.
 */
export type Day = number;

const MS = 86_400_000;

export function toDay(date: Date): Day {
	return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS);
}

export function fromDay(day: Day): Date {
	const utc = new Date(day * MS);
	return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: Day): number {
	// 1970-01-01 was a Thursday.
	return (((day + 4) % 7) + 7) % 7;
}

export function isoDay(day: Day): string {
	const date = fromDay(day);
	const m = date.getMonth() + 1;
	const d = date.getDate();
	return `${date.getFullYear()}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

export function today(): Day {
	return toDay(new Date());
}

/** An inclusive span of days. */
export interface DaySpan {
	start: Day;
	end: Day;
}
