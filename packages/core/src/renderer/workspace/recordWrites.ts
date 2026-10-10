import type { GridCellWrite } from '../../api/GridApi.js';
import { writeDateRange } from '../../cells/dateRange.js';
import { parseCellDate } from '../../cells/format.js';
import { fromDay, isoDay, type DaySpan } from '../../records/days.js';
import { writeDependencies, type DependencyLink, type RecordReader, type RecordRow } from '../../records/recordModel.js';

/** Writes a date in the shape the cell held (ISO day, ISO with time, Date, epoch ms). */
function writeDay(previous: unknown, day: number): unknown {
	const date = fromDay(day);
	if (previous instanceof Date) return date;
	if (typeof previous === 'number') return date.getTime();
	if (typeof previous === 'string' && previous.length > 10 && parseCellDate(previous)) return isoDay(day) + previous.slice(10);
	return isoDay(day);
}

/**
 * The cell writes that give a record a new span, through whichever fields hold it: the schedule
 * range, start / end fields, or the due day. Shapes are kept (object or array range, ISO or Date).
 */
export function spanWrites<T>(reader: RecordReader<T>, row: RecordRow<T>, span: DaySpan): GridCellWrite[] {
	const { schedule, start, end, due } = reader.roles;
	const writes: GridCellWrite[] = [];
	if (schedule) {
		const previous = reader.value(row, schedule);
		const single =
			previous != null && previous !== '' && !Array.isArray(previous) && typeof previous !== 'object' && !String(previous).includes('/');
		writes.push({
			rowId: row.id,
			colField: schedule,
			value: single ? writeDay(previous, span.start) : writeDateRange(previous, { start: fromDay(span.start), end: fromDay(span.end) }),
		});
		// A due date that tracked the old end moves with it.
		if (due && due !== schedule) {
			const old = reader.span(row);
			const dueDay = reader.value(row, due);
			const dueDate = parseCellDate(dueDay);
			if (old && dueDate && Math.abs(fromDay(old.end).getTime() - dueDate.getTime()) < 86_400_000)
				writes.push({ rowId: row.id, colField: due, value: writeDay(dueDay, span.end) });
		}
		return writes;
	}
	if (start || end) {
		if (start) writes.push({ rowId: row.id, colField: start, value: writeDay(reader.value(row, start), span.start) });
		if (end) writes.push({ rowId: row.id, colField: end, value: writeDay(reader.value(row, end), span.end) });
		return writes;
	}
	if (due) writes.push({ rowId: row.id, colField: due, value: writeDay(reader.value(row, due), span.end) });
	return writes;
}

export function dependencyWrite<T>(reader: RecordReader<T>, row: RecordRow<T>, links: readonly DependencyLink[]): GridCellWrite | null {
	const field = reader.roles.dependencies;
	if (!field) return null;
	return { rowId: row.id, colField: field, value: writeDependencies(reader.value(row, field), links) };
}

/** A progress write in the column's scale (0–100, or 0–1 when its max is 1). */
export function progressWrite<T>(reader: RecordReader<T>, row: RecordRow<T>, fraction: number): GridCellWrite | null {
	const field = reader.roles.progress;
	if (!field) return null;
	const max = reader.column(field)?.schema?.max ?? 100;
	const value = Math.max(0, Math.min(1, fraction)) * max;
	return { rowId: row.id, colField: field, value: max === 1 ? Math.round(value * 100) / 100 : Math.round(value) };
}
