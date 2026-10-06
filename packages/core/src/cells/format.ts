/** Value parsing and display formatting shared by the built-in cell renderers, editors and formatters. */

export interface NumberCellOptions {
	/** Intl style: plain number, currency or percent (0.25 → 25%). */
	format?: 'number' | 'currency' | 'percent';
	/** ISO currency code for format 'currency'. Default 'USD'. */
	currency?: string;
	/** Fixed fraction digits. Omit for up to 2 (0 for plain integers). */
	decimals?: number;
	/** BCP 47 locale; defaults to the browser's. */
	locale?: string;
	/** Text before / after the formatted number (e.g. ' yrs'). */
	prefix?: string;
	suffix?: string;
	/** Thousands separators. Default true. */
	grouping?: boolean;
	/** Colour negative numbers with the danger colour. Default false. */
	colorNegative?: boolean;
	/** Editor bounds and stepper increment. */
	min?: number;
	max?: number;
	step?: number;
}

/** A number from a cell value, or null for empty / non-numeric. */
export function parseCellNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (value == null || value === '') return null;
	const n = Number(String(value).replace(/[,\s]/g, ''));
	return Number.isFinite(n) ? n : null;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(options: NumberCellOptions): Intl.NumberFormat {
	const key = `${options.locale ?? ''}|${options.format ?? ''}|${options.currency ?? ''}|${options.decimals ?? ''}|${options.grouping ?? ''}`;
	let format = numberFormats.get(key);
	if (!format) {
		const style = options.format === 'currency' ? 'currency' : options.format === 'percent' ? 'percent' : 'decimal';
		const intl: Intl.NumberFormatOptions = { style, useGrouping: options.grouping ?? true };
		if (style === 'currency') intl.currency = options.currency ?? 'USD';
		if (options.decimals !== undefined) {
			intl.minimumFractionDigits = options.decimals;
			intl.maximumFractionDigits = options.decimals;
		} else if (style === 'decimal') {
			intl.maximumFractionDigits = 2;
		}
		format = new Intl.NumberFormat(options.locale, intl);
		numberFormats.set(key, format);
	}
	return format;
}

/** Display text for a number cell, or null when the value is empty / not a number. */
export function formatCellNumber(value: unknown, options: NumberCellOptions = {}): string | null {
	const n = parseCellNumber(value);
	if (n === null) return null;
	return `${options.prefix ?? ''}${numberFormat(options).format(n)}${options.suffix ?? ''}`;
}

export interface DateCellOptions {
	/** Intl date style. Default 'medium' (e.g. “Mar 4, 2026”). */
	dateStyle?: 'short' | 'medium' | 'long' | 'full';
	/** Also show the time ('datetime' columns). */
	withTime?: boolean;
	locale?: string;
	/** First day of the week in the picker: 0 Sunday … 6 Saturday. Default 1 (Monday). */
	weekStartsOn?: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A Date from a cell value: Date, epoch ms, or an ISO string. A bare YYYY-MM-DD is a calendar day in
 * local time (not UTC midnight, which shows the previous day west of Greenwich).
 */
export function parseCellDate(value: unknown): Date | null {
	if (value == null || value === '') return null;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
	if (typeof value === 'number') return new Date(value);
	const text = String(value).trim();
	const day = ISO_DATE.exec(text);
	if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
	const date = new Date(text);
	return Number.isNaN(date.getTime()) ? null : date;
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** YYYY-MM-DD for a local calendar day: the value date editors write. */
export function toIsoDay(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** HH:MM for a local time. */
export function toIsoTime(date: Date): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** Display text for a date cell, or null when empty / unparseable. */
export function formatCellDate(value: unknown, options: DateCellOptions = {}): string | null {
	const date = parseCellDate(value);
	if (!date) return null;
	const key = `${options.locale ?? ''}|${options.dateStyle ?? ''}|${options.withTime ? 1 : 0}`;
	let format = dateFormats.get(key);
	if (!format) {
		format = new Intl.DateTimeFormat(options.locale, {
			dateStyle: options.dateStyle ?? 'medium',
			timeStyle: options.withTime ? 'short' : undefined,
		});
		dateFormats.set(key, format);
	}
	return format.format(date);
}

/** A string list from an array or a comma-separated string. */
export function parseMultiValue(value: unknown): string[] {
	if (value == null || value === '') return [];
	if (Array.isArray(value)) return value.filter((v) => v != null && v !== '').map(String);
	return String(value)
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Writes a list back in the shape the cell held: an array stays an array, else a comma-separated string. */
export function writeMultiValue(previous: unknown, values: string[]): string[] | string {
	return Array.isArray(previous) ? values : values.join(',');
}

export function isCheckedCellValue(value: unknown): boolean {
	return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes';
}

/** The toggled value, in the shape the cell held (boolean, 'true'/'false', 1/0). */
export function toggleCheckedValue(value: unknown): unknown {
	const next = !isCheckedCellValue(value);
	if (typeof value === 'string') return value === 'yes' || value === 'no' ? (next ? 'yes' : 'no') : String(next);
	if (typeof value === 'number') return next ? 1 : 0;
	return next;
}

/** Up to two initials for a name or e-mail address. */
export function initialsOf(name: string): string {
	const base = name.includes('@') ? name.slice(0, name.indexOf('@')).replace(/[._-]+/g, ' ') : name;
	const parts = base.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	const first = parts[0][0] ?? '';
	const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '');
	return (first + last).toUpperCase();
}
