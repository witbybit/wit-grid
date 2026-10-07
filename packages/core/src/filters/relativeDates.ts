/**
 * Relative date filters: "in the last 7 days", "this month". They are stored relative, so a saved
 * filter (views, persistence) keeps rolling; matching turns them into local calendar days.
 */

export type RelativeDateUnit = 'day' | 'week' | 'month' | 'year';

export type DatePeriod =
	| 'today'
	| 'yesterday'
	| 'tomorrow'
	| 'thisWeek'
	| 'lastWeek'
	| 'nextWeek'
	| 'thisMonth'
	| 'lastMonth'
	| 'nextMonth'
	| 'thisQuarter'
	| 'lastQuarter'
	| 'thisYear'
	| 'lastYear';

export const DATE_PERIODS: readonly { value: DatePeriod; label: string }[] = [
	{ value: 'today', label: 'Today' },
	{ value: 'yesterday', label: 'Yesterday' },
	{ value: 'tomorrow', label: 'Tomorrow' },
	{ value: 'thisWeek', label: 'This week' },
	{ value: 'lastWeek', label: 'Last week' },
	{ value: 'nextWeek', label: 'Next week' },
	{ value: 'thisMonth', label: 'This month' },
	{ value: 'lastMonth', label: 'Last month' },
	{ value: 'nextMonth', label: 'Next month' },
	{ value: 'thisQuarter', label: 'This quarter' },
	{ value: 'lastQuarter', label: 'Last quarter' },
	{ value: 'thisYear', label: 'This year' },
	{ value: 'lastYear', label: 'Last year' },
];

export const RELATIVE_DATE_UNITS: readonly { value: RelativeDateUnit; label: string; plural: string }[] = [
	{ value: 'day', label: 'day', plural: 'days' },
	{ value: 'week', label: 'week', plural: 'weeks' },
	{ value: 'month', label: 'month', plural: 'months' },
	{ value: 'year', label: 'year', plural: 'years' },
];

const PERIOD_SET = new Set<string>(DATE_PERIODS.map((p) => p.value));
const UNIT_SET = new Set<string>(RELATIVE_DATE_UNITS.map((u) => u.value));

export function isDatePeriod(value: unknown): value is DatePeriod {
	return typeof value === 'string' && PERIOD_SET.has(value);
}

export function isRelativeDateUnit(value: unknown): value is RelativeDateUnit {
	return typeof value === 'string' && UNIT_SET.has(value);
}

export interface RelativeDateSpec {
	operator: string;
	amount?: number;
	unit?: RelativeDateUnit;
	period?: DatePeriod;
}

const at = (y: number, m: number, d: number) => new Date(y, m, d);

function shift(date: Date, unit: RelativeDateUnit, amount: number): Date {
	const y = date.getFullYear();
	const m = date.getMonth();
	const d = date.getDate();
	if (unit === 'day') return at(y, m, d + amount);
	if (unit === 'week') return at(y, m, d + amount * 7);
	// Same day in another month or year, clamped to that month's length.
	const target = unit === 'month' ? at(y, m + amount, 1) : at(y + amount, m, 1);
	const last = at(target.getFullYear(), target.getMonth() + 1, 0).getDate();
	return at(target.getFullYear(), target.getMonth(), Math.min(d, last));
}

function periodRange(period: DatePeriod, today: Date, weekStartsOn: number): { from: Date; to: Date } {
	const y = today.getFullYear();
	const m = today.getMonth();
	const d = today.getDate();
	const weekStart = at(y, m, d - ((today.getDay() - weekStartsOn + 7) % 7));
	const week = (offset: number) => ({ from: shift(weekStart, 'week', offset), to: at(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset * 7 + 6) });
	const month = (offset: number) => ({ from: at(y, m + offset, 1), to: at(y, m + offset + 1, 0) });
	const quarter = (offset: number) => {
		const first = Math.floor(m / 3) * 3 + offset * 3;
		return { from: at(y, first, 1), to: at(y, first + 3, 0) };
	};
	switch (period) {
		case 'today':
			return { from: today, to: today };
		case 'yesterday':
			return { from: at(y, m, d - 1), to: at(y, m, d - 1) };
		case 'tomorrow':
			return { from: at(y, m, d + 1), to: at(y, m, d + 1) };
		case 'thisWeek':
			return week(0);
		case 'lastWeek':
			return week(-1);
		case 'nextWeek':
			return week(1);
		case 'thisMonth':
			return month(0);
		case 'lastMonth':
			return month(-1);
		case 'nextMonth':
			return month(1);
		case 'thisQuarter':
			return quarter(0);
		case 'lastQuarter':
			return quarter(-1);
		case 'thisYear':
			return { from: at(y, 0, 1), to: at(y, 11, 31) };
		case 'lastYear':
			return { from: at(y - 1, 0, 1), to: at(y - 1, 11, 31) };
	}
}

/**
 * The local calendar days a relative condition covers, both ends included; null when it is not
 * relative or is incomplete. "In the last 7 days" is today and the six days before it.
 */
export function relativeDateRange(spec: RelativeDateSpec, now: Date = new Date(), weekStartsOn = 1): { from: Date; to: Date } | null {
	const today = at(now.getFullYear(), now.getMonth(), now.getDate());
	if (spec.operator === 'period') return isDatePeriod(spec.period) ? periodRange(spec.period, today, weekStartsOn) : null;
	if (spec.operator !== 'inLast' && spec.operator !== 'inNext') return null;
	const amount = spec.amount;
	if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 1 || !isRelativeDateUnit(spec.unit)) return null;
	if (spec.operator === 'inLast') return { from: shift(shift(today, spec.unit, -amount), 'day', 1), to: today };
	return { from: today, to: shift(shift(today, spec.unit, amount), 'day', -1) };
}

/** "in the last 7 days", "this month". */
export function describeRelativeDate(spec: RelativeDateSpec): string {
	if (spec.operator === 'period') return DATE_PERIODS.find((p) => p.value === spec.period)?.label.toLowerCase() ?? '';
	const unit = RELATIVE_DATE_UNITS.find((u) => u.value === spec.unit);
	if (!unit || !spec.amount) return '';
	const span = spec.amount === 1 ? unit.label : `${spec.amount} ${unit.plural}`;
	return `${spec.operator === 'inLast' ? 'in the last' : 'in the next'} ${span}`;
}
