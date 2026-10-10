import type { RecordReader, RecordRow } from './recordModel.js';

/** Records sharing a field value: a board column, a swimlane, a gallery section. */
export interface RecordGroup<TRowData = unknown> {
	/** Stable key ('' for records without a value). */
	key: string;
	/** The value written to put a record here (null clears the field). */
	value: string | null;
	label: string;
	/** Palette name or CSS colour (the option's). */
	color?: string;
	rows: RecordRow<TRowData>[];
}

export interface GroupOrderEntry {
	value: string;
	label?: string;
	color?: string;
}

export interface GroupRecordsOptions {
	/** Groups in this order first; values not listed follow. Default: the field's option order. */
	order?: readonly (string | GroupOrderEntry)[];
	/** Show every option even without records (board columns). Default false. */
	showEmpty?: boolean;
	/** Label for records without a value. Default `No <header>`. */
	emptyLabel?: string;
}

/**
 * Records grouped by a field, in a stable order: the given order, then the field's options, then
 * values as first seen, records without a value last. Multi-value cells group by their first value.
 */
export function groupRecords<T>(
	rows: readonly RecordRow<T>[],
	reader: RecordReader<T>,
	field: string,
	options: GroupRecordsOptions = {}
): RecordGroup<T>[] {
	const groups = new Map<string, RecordGroup<T>>();
	const col = reader.column(field);
	const ensure = (value: string, label?: string, color?: string) => {
		let group = groups.get(value);
		if (!group) {
			const option = reader.option(field, value);
			group = { key: value, value, label: label ?? option?.label ?? value, color: color ?? option?.color, rows: [] };
			groups.set(value, group);
		}
		return group;
	};
	for (const entry of options.order ?? []) {
		const item = typeof entry === 'string' ? { value: entry } : entry;
		ensure(item.value, item.label, item.color);
	}
	if (options.showEmpty || !options.order) for (const option of reader.options(field)) if (options.showEmpty) ensure(option.value);
	let empty: RecordGroup<T> | null = null;
	for (const row of rows) {
		const first = reader.values(row, field)[0];
		if (first == null || first === '') {
			empty ??= { key: '', value: null, label: options.emptyLabel ?? `No ${(col?.header ?? field).toLowerCase()}`, rows: [] };
			empty.rows.push(row);
			continue;
		}
		ensure(first).rows.push(row);
	}
	const listed = new Set((options.order ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.value)));
	const result = [...groups.values()].filter((group) => listed.has(group.key) || options.showEmpty || group.rows.length > 0);
	// Unlisted values: option order, then first seen.
	const position = (group: RecordGroup<T>) => (listed.has(group.key) ? -1 : reader.optionRank(field, group.key));
	result.sort((a, b) => {
		if (listed.has(a.key) || listed.has(b.key)) return 0;
		return position(a) - position(b);
	});
	if (empty) result.push(empty);
	return result;
}

export type RecordAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'filled' | 'empty' | 'done' | 'progress';

/** One number summarising a group: totals, averages, counts, completion. Null when nothing to summarise. */
export function aggregateRecords<T>(rows: readonly RecordRow<T>[], reader: RecordReader<T>, fn: RecordAggregate, field?: string): number | null {
	switch (fn) {
		case 'count':
			return rows.length;
		case 'done':
			return rows.filter((row) => reader.isDone(row)).length;
		case 'progress': {
			let total = 0;
			let counted = 0;
			for (const row of rows) {
				const progress = reader.isDone(row) ? 1 : reader.progress(row);
				if (progress == null) continue;
				total += progress;
				counted++;
			}
			return counted ? total / counted : null;
		}
		case 'filled':
		case 'empty': {
			const filled = rows.filter((row) => {
				const value = reader.value(row, field);
				return value != null && value !== '' && !(Array.isArray(value) && !value.length);
			}).length;
			return fn === 'filled' ? filled : rows.length - filled;
		}
	}
	let result: number | null = null;
	let counted = 0;
	for (const row of rows) {
		const value = reader.number(row, field);
		if (value == null) continue;
		counted++;
		if (result == null) result = value;
		else if (fn === 'sum' || fn === 'avg') result += value;
		else if (fn === 'min') result = Math.min(result, value);
		else if (fn === 'max') result = Math.max(result, value);
	}
	return fn === 'avg' && result != null ? result / counted : result;
}
