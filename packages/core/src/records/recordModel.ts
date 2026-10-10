import type { ColumnDef } from '../columnDef.js';
import type { ColumnValueKind } from '../cells/fieldSchema.js';
import type { CellOption } from '../cells/listbox.js';
import { parseDateRange } from '../cells/dateRange.js';
import { isCheckedCellValue, parseCellDate, parseMultiValue } from '../cells/format.js';
import { createGridRowDataRef } from '../publicRowRef.js';
import { toDay, type DaySpan } from './days.js';

/** A displayed record: a data row and its id. */
export interface RecordRow<TRowData = unknown> {
	id: string;
	data: TRowData;
}

/**
 * What the fields of a record mean. Set once on the grid (`records`); every projection reads it, so
 * switching from the table to a board or a schedule needs no configuring. Anything left out is
 * inferred from the columns' schema and names.
 */
export interface RecordRolesConfig {
	/** The record's name. Default: the first text column. */
	title?: string;
	/** A short identifier shown beside the title (T-1172). Default: the row id. */
	key?: string;
	description?: string;
	/** Workflow state: board columns, the done / blocked state. Default: a select column named status / stage / state. */
	status?: string;
	priority?: string;
	/** The responsible person (or people). Default: a person column. */
	owner?: string;
	/** A team, area or squad: the natural swimlane. */
	team?: string;
	labels?: string;
	/** The planned span, a date range field. */
	schedule?: string;
	/** Separate start and end date fields, when there is no range field. */
	start?: string;
	end?: string;
	/** A single date (due, deadline). */
	due?: string;
	/** Completion 0–100 (or 0–1 for a progress column whose max is 1). */
	progress?: string;
	/** Work estimate (days, hours, points). */
	estimate?: string;
	/** A money value summed by boards and groups (budget, deal size). */
	value?: string;
	/** The parent record's id: an outline of summary tasks. */
	parent?: string;
	/** Predecessor record ids, optionally typed with lag: `T-12`, `T-12SS+2d`, `{ id, type, lag }`. */
	dependencies?: string;
	/** The planned span the schedule is compared with (a date range field). */
	baseline?: string;
	/** A milestone flag (checkbox). Zero-length tasks are milestones too. */
	milestone?: string;
	/** An image URL drawn as a card cover. */
	cover?: string;
	/** Manual order within a board column (fractional rank strings). */
	rank?: string;
	/** Status values meaning done. Default: the last status option. */
	doneValues?: readonly string[];
	/** Status values meaning blocked. Default: options labelled blocked / on hold. */
	blockedValues?: readonly string[];
}

export type RecordRole = Exclude<keyof RecordRolesConfig, 'doneValues' | 'blockedValues'>;

/** The roles resolved against the grid's columns: each a field that exists, or undefined. */
export type RecordRoles = { readonly [K in RecordRole]?: string } & {
	readonly doneValues: readonly string[];
	readonly blockedValues: readonly string[];
};

const kindOf = (col: ColumnDef<any>): ColumnValueKind | undefined => col.schema?.kind;
const named = (col: ColumnDef<any>, pattern: RegExp) => pattern.test(col.field) || pattern.test(col.header ?? '');

/** The role fields for a set of columns: the configured ones that exist, the rest inferred. */
export function resolveRecordRoles<T>(columns: readonly ColumnDef<T>[], config: RecordRolesConfig = {}): RecordRoles {
	const byField = new Map(columns.map((col) => [col.field, col]));
	const roles: Record<string, string | undefined> = {};
	const taken = new Set<string>();
	const pick = (role: RecordRole, match: (col: ColumnDef<T>) => boolean) => {
		const configured = config[role];
		if (configured !== undefined) {
			roles[role] = byField.has(configured) ? configured : undefined;
		} else {
			roles[role] = columns.find((col) => !taken.has(col.field) && match(col))?.field;
		}
		if (roles[role]) taken.add(roles[role]!);
	};
	const textual = (col: ColumnDef<T>) => !kindOf(col) || kindOf(col) === 'text';
	pick('status', (col) => kindOf(col) === 'select' && named(col, /status|stage|state|phase/i));
	if (!roles.status && config.status === undefined)
		roles.status = columns.find((col) => kindOf(col) === 'select' && !named(col, /priority|severity|team|squad/i))?.field;
	if (roles.status) taken.add(roles.status);
	pick('priority', (col) => kindOf(col) === 'select' && named(col, /priority|severity|urgency/i));
	pick('owner', (col) => kindOf(col) === 'person' && named(col, /owner|assignee|lead|responsible/i));
	if (!roles.owner && config.owner === undefined) {
		roles.owner = columns.find((col) => kindOf(col) === 'person' && !taken.has(col.field))?.field;
		if (roles.owner) taken.add(roles.owner);
	}
	pick('team', (col) => (kindOf(col) === 'select' || textual(col)) && named(col, /team|squad|area|department|group/i));
	pick('baseline', (col) => kindOf(col) === 'dateRange' && named(col, /baseline|planned|original/i));
	pick('schedule', (col) => kindOf(col) === 'dateRange');
	pick('start', (col) => (kindOf(col) === 'date' || kindOf(col) === 'datetime') && named(col, /start|begin/i));
	pick('end', (col) => (kindOf(col) === 'date' || kindOf(col) === 'datetime') && named(col, /^end|finish|end date/i));
	pick('due', (col) => (kindOf(col) === 'date' || kindOf(col) === 'datetime') && named(col, /due|deadline|target/i));
	if (!roles.due && config.due === undefined) {
		roles.due = columns.find((col) => (kindOf(col) === 'date' || kindOf(col) === 'datetime') && !taken.has(col.field))?.field;
		if (roles.due) taken.add(roles.due);
	}
	pick('progress', (col) => kindOf(col) === 'progress' || named(col, /progress|complete|done %/i));
	pick('estimate', (col) => named(col, /estimate|effort|points|hours|duration/i) && kindOf(col) !== 'select');
	pick('value', (col) => kindOf(col) === 'currency' || named(col, /budget|value|amount|revenue|cost/i));
	pick('parent', (col) => named(col, /^parent|parentid|parent_id/i));
	pick('dependencies', (col) => named(col, /depend|predecessor|blocked.?by/i));
	pick('milestone', (col) => kindOf(col) === 'checkbox' && named(col, /milestone/i));
	pick('cover', (col) => (kindOf(col) === 'url' || textual(col)) && named(col, /cover|image|thumbnail|photo|picture/i));
	pick('labels', (col) => kindOf(col) === 'tags' || (kindOf(col) === 'multiSelect' && named(col, /label|tag/i)));
	pick('description', (col) => kindOf(col) === 'longText' || named(col, /description|notes|summary/i));
	pick('key', (col) => named(col, /^key$|^code$|^ticket|^ref$/i));
	pick('rank', (col) => named(col, /^rank$|^order$|lexorank/i));
	pick('title', (col) => textual(col) && !named(col, /^id$/i));
	if (!roles.title && config.title === undefined) roles.title = columns.find((col) => !taken.has(col.field))?.field ?? columns[0]?.field;

	const statusCol = roles.status ? byField.get(roles.status) : undefined;
	const statusOptions = statusCol?.schema?.options?.options ?? [];
	const doneValues =
		config.doneValues ??
		(() => {
			const explicit = statusOptions.filter((option) =>
				/^(done|complete|completed|closed|shipped|resolved)$/i.test(option.label ?? option.value)
			);
			if (explicit.length) return explicit.map((option) => option.value);
			return statusOptions.length > 1 ? [statusOptions[statusOptions.length - 1].value] : [];
		})();
	const blockedValues =
		config.blockedValues ??
		statusOptions.filter((option) => /block|on hold|stuck/i.test(option.label ?? option.value)).map((option) => option.value);
	return { ...roles, doneValues, blockedValues } as RecordRoles;
}

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

/** One predecessor link: `to` waits on `from`. Lag in working days (negative = lead). */
export interface DependencyLink {
	from: string;
	to: string;
	type: DependencyType;
	lag: number;
}

const DEPENDENCY = /^(.+?)(FS|SS|FF|SF)([+-]\d+)?d?$/i;

/** Predecessors held in a cell: ids, typed ids (`T-12SS+2d`), `{ id, type, lag }` objects, arrays or comma lists. */
export function parseDependencies(value: unknown, to: string): DependencyLink[] {
	if (value == null || value === '') return [];
	const items: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,;]/) : [value];
	const links: DependencyLink[] = [];
	for (const item of items) {
		if (item && typeof item === 'object') {
			const raw = item as { id?: unknown; from?: unknown; type?: unknown; lag?: unknown };
			const from = raw.id ?? raw.from;
			if (from == null || from === '') continue;
			const type = String(raw.type ?? 'FS').toUpperCase();
			links.push({
				from: String(from),
				to,
				type: (['FS', 'SS', 'FF', 'SF'].includes(type) ? type : 'FS') as DependencyType,
				lag: Number(raw.lag) || 0,
			});
			continue;
		}
		const text = String(item).trim();
		if (!text) continue;
		const typed = DEPENDENCY.exec(text);
		if (typed) links.push({ from: typed[1].trim(), to, type: typed[2].toUpperCase() as DependencyType, lag: Number(typed[3] ?? 0) });
		else links.push({ from: text, to, type: 'FS', lag: 0 });
	}
	return links.filter((link) => link.from !== to);
}

/** Predecessors written back in the shape the cell held (array of ids/objects, or a comma list). */
export function writeDependencies(previous: unknown, links: readonly DependencyLink[]): unknown {
	const objects = Array.isArray(previous) && previous.some((item) => item && typeof item === 'object');
	if (objects) return links.map((link) => ({ id: link.from, type: link.type, lag: link.lag }));
	const texts = links.map((link) =>
		link.type === 'FS' && !link.lag ? link.from : `${link.from}${link.type}${link.lag ? (link.lag > 0 ? `+${link.lag}` : link.lag) + 'd' : ''}`
	);
	if (typeof previous === 'string') return texts.join(', ');
	return texts;
}

/** A field's value made readable: options, people, numbers, dates and spans. */
export class RecordReader<TRowData = unknown> {
	private readonly byField: Map<string, ColumnDef<TRowData>>;
	private optionIndex = new Map<string, Map<string, number>>();

	constructor(
		readonly columns: readonly ColumnDef<TRowData>[],
		readonly roles: RecordRoles
	) {
		this.byField = new Map(columns.map((col) => [col.field, col]));
	}

	column(field: string | undefined): ColumnDef<TRowData> | undefined {
		return field ? this.byField.get(field) : undefined;
	}

	value(row: RecordRow<TRowData>, field: string | undefined): unknown {
		if (!field) return undefined;
		const data = row.data as Record<string, unknown> | null;
		const col = this.byField.get(field);
		if (col?.valueGetter) return col.valueGetter({ node: createGridRowDataRef(row.id, row.data), row: row.data, colField: field });
		return data?.[field];
	}

	/** Display text, through the column's formatter. */
	text(row: RecordRow<TRowData>, field: string | undefined): string {
		if (!field) return '';
		const value = this.value(row, field);
		if (value == null) return '';
		const col = this.byField.get(field);
		return col?.valueFormatter ? col.valueFormatter({ value, rowData: row.data, colDef: col, rowId: row.id }) : String(value);
	}

	title(row: RecordRow<TRowData>): string {
		return this.text(row, this.roles.title) || row.id;
	}

	key(row: RecordRow<TRowData>): string {
		return this.roles.key ? this.text(row, this.roles.key) || row.id : row.id;
	}

	/** The options a field offers, in their listed order. */
	options(field: string | undefined): readonly CellOption[] {
		return this.column(field)?.schema?.options?.options ?? [];
	}

	option(field: string | undefined, value: unknown): CellOption | undefined {
		if (value == null || value === '') return undefined;
		return this.column(field)?.schema?.options?.get(String(value));
	}

	/** Position of a value among the field's options (unknown values after them). */
	optionRank(field: string | undefined, value: unknown): number {
		if (!field) return 0;
		let index = this.optionIndex.get(field);
		const options = this.options(field);
		if (!index || index.size !== options.length) {
			index = new Map(options.map((option, i) => [option.value, i]));
			this.optionIndex.set(field, index);
		}
		return value == null ? options.length + 1 : (index.get(String(value)) ?? options.length);
	}

	/** Every value in a multi-value cell (people, tags, linked records). */
	values(row: RecordRow<TRowData>, field: string | undefined): string[] {
		const value = this.value(row, field);
		if (value == null || value === '') return [];
		return Array.isArray(value) ? value.map(String) : parseMultiValue(value);
	}

	number(row: RecordRow<TRowData>, field: string | undefined): number | null {
		const value = this.value(row, field);
		if (value == null || value === '') return null;
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}

	/** Completion as 0–1, or null. */
	progress(row: RecordRow<TRowData>): number | null {
		const value = this.number(row, this.roles.progress);
		if (value == null) return null;
		const max = this.column(this.roles.progress)?.schema?.max ?? (value <= 1 && value > 0 && !Number.isInteger(value) ? 1 : 100);
		return Math.max(0, Math.min(1, value / max));
	}

	/** The record's planned span: the schedule range, else start/end fields, else the due day. */
	span(row: RecordRow<TRowData>): DaySpan | null {
		const { schedule, start, end, due } = this.roles;
		if (schedule) {
			const range = parseDateRange(this.value(row, schedule));
			if (range) return { start: toDay(range.start), end: toDay(range.end) };
			const single = parseCellDate(this.value(row, schedule));
			if (single) return { start: toDay(single), end: toDay(single) };
		}
		if (start || end) {
			const a = parseCellDate(this.value(row, start));
			const b = parseCellDate(this.value(row, end));
			if (a || b) {
				const s = toDay((a ?? b)!);
				const e = toDay((b ?? a)!);
				return s <= e ? { start: s, end: e } : { start: e, end: s };
			}
		}
		if (due) {
			const date = parseCellDate(this.value(row, due));
			if (date) return { start: toDay(date), end: toDay(date) };
		}
		return null;
	}

	baseline(row: RecordRow<TRowData>): DaySpan | null {
		const range = parseDateRange(this.value(row, this.roles.baseline));
		return range ? { start: toDay(range.start), end: toDay(range.end) } : null;
	}

	due(row: RecordRow<TRowData>): number | null {
		const date = parseCellDate(this.value(row, this.roles.due));
		if (date) return toDay(date);
		return this.span(row)?.end ?? null;
	}

	parent(row: RecordRow<TRowData>): string | null {
		const value = this.value(row, this.roles.parent);
		return value == null || value === '' ? null : String(value);
	}

	dependencies(row: RecordRow<TRowData>): DependencyLink[] {
		return this.roles.dependencies ? parseDependencies(this.value(row, this.roles.dependencies), row.id) : [];
	}

	isMilestone(row: RecordRow<TRowData>): boolean {
		return !!this.roles.milestone && isCheckedCellValue(this.value(row, this.roles.milestone));
	}

	status(row: RecordRow<TRowData>): string | null {
		const value = this.value(row, this.roles.status);
		return value == null || value === '' ? null : String(value);
	}

	isDone(row: RecordRow<TRowData>): boolean {
		const status = this.status(row);
		if (status != null && this.roles.doneValues.includes(status)) return true;
		return this.roles.status ? false : (this.progress(row) ?? 0) >= 1;
	}

	isBlockedStatus(row: RecordRow<TRowData>): boolean {
		const status = this.status(row);
		return status != null && this.roles.blockedValues.includes(status);
	}

	/**
	 * The unfinished predecessors holding a record up — only once it should be under way (its planned
	 * start has come, or, without dates, it has left the first status). Work merely scheduled after
	 * other work is waiting, not blocked.
	 */
	blockers(row: RecordRow<TRowData>, lookup: (id: string) => RecordRow<TRowData> | undefined, day: number = toDay(new Date())): string[] {
		if (this.isDone(row)) return [];
		const span = this.span(row);
		const due = span ? span.start <= day : this.optionRank(this.roles.status, this.status(row)) > 0;
		if (!due) return [];
		const out: string[] = [];
		for (const link of this.dependencies(row)) {
			const predecessor = lookup(link.from);
			if (predecessor && !this.isDone(predecessor)) out.push(link.from);
		}
		return out;
	}

	/** In a blocked status, or held up by unfinished predecessors (see `blockers`). */
	isBlocked(row: RecordRow<TRowData>, lookup: (id: string) => RecordRow<TRowData> | undefined, day?: number): boolean {
		return !this.isDone(row) && (this.isBlockedStatus(row) || this.blockers(row, lookup, day).length > 0);
	}

	/** An image URL for the card cover, if the record has one. */
	cover(row: RecordRow<TRowData>): string | null {
		const value = this.value(row, this.roles.cover);
		return typeof value === 'string' && /^(https?:\/\/|data:image\/|blob:|\/)/i.test(value) ? value : null;
	}
}
