import type { GridCellWrite } from '../api/GridApi.js';
import { aggregateRecords, groupRecords, type GroupOrderEntry, type RecordAggregate, type RecordGroup } from './recordGroups.js';
import type { RecordReader, RecordRow } from './recordModel.js';
import { ranksBetween } from './rank.js';

export interface BoardColumn<TRowData = unknown> extends RecordGroup<TRowData> {
	/** Work-in-progress limit, when set. */
	limit?: number;
	/** More cards than the limit allows. */
	over: boolean;
	/** The summed value field (budget, points), when the board has one. */
	total: number | null;
}

export interface BoardLane<TRowData = unknown> {
	key: string;
	value: string | null;
	label: string;
	color?: string;
	/** Cards per column key, in board order. */
	cells: Map<string, RecordRow<TRowData>[]>;
	count: number;
	total: number | null;
}

export interface BoardModel<TRowData = unknown> {
	columns: BoardColumn<TRowData>[];
	/** At least one lane: a single unlabelled lane (`key` '*') when the board has no swimlanes. */
	lanes: BoardLane<TRowData>[];
	/** Records waiting on unfinished predecessors, or in a blocked status. */
	blocked: Set<string>;
	/** Where each card sits. */
	placement: Map<string, { column: string; lane: string }>;
}

export interface BoardOptions<TRowData = unknown> {
	columnField: string;
	laneField?: string;
	columnOrder?: readonly (string | GroupOrderEntry)[];
	laneOrder?: readonly (string | GroupOrderEntry)[];
	wipLimits?: Readonly<Record<string, number>>;
	/** Summed into column and lane totals. */
	valueField?: string;
	valueAggregate?: RecordAggregate;
	/** Order cards by the rank field instead of the grid's display order. */
	useRank?: boolean;
	/** Finds a record that may be filtered out (a predecessor), to tell whether it is done. */
	lookup?: (id: string) => RecordRow<TRowData> | undefined;
	/** The day blocked state is judged on. Default: today. */
	today?: number;
}

export const SINGLE_LANE = '*';

/** Cards placed in columns and swimlanes, with limits, totals and blocked state. */
export function buildBoard<T>(rows: readonly RecordRow<T>[], reader: RecordReader<T>, options: BoardOptions<T>): BoardModel<T> {
	const aggregate = options.valueAggregate ?? 'sum';
	const rankField = reader.roles.rank;
	const ordered =
		options.useRank && rankField
			? rows
					.map((row, index) => ({ row, index, rank: reader.value(row, rankField) }))
					.sort((a, b) => {
						const ra = a.rank == null || a.rank === '' ? null : String(a.rank);
						const rb = b.rank == null || b.rank === '' ? null : String(b.rank);
						if (ra === rb) return a.index - b.index;
						if (ra === null) return 1;
						if (rb === null) return -1;
						return ra < rb ? -1 : 1;
					})
					.map((entry) => entry.row)
			: rows;
	const columns: BoardColumn<T>[] = groupRecords(ordered, reader, options.columnField, { order: options.columnOrder, showEmpty: true }).map(
		(group) => {
			const limit = options.wipLimits?.[group.key];
			return {
				...group,
				limit,
				over: limit != null && group.rows.length > limit,
				total: options.valueField ? aggregateRecords(group.rows, reader, aggregate, options.valueField) : null,
			};
		}
	);
	const laneGroups: RecordGroup<T>[] = options.laneField
		? groupRecords(ordered, reader, options.laneField, { order: options.laneOrder })
		: [{ key: SINGLE_LANE, value: null, label: '', rows: [...ordered] }];
	const placement = new Map<string, { column: string; lane: string }>();
	for (const column of columns) for (const row of column.rows) placement.set(row.id, { column: column.key, lane: SINGLE_LANE });
	const lanes: BoardLane<T>[] = laneGroups.map((group) => {
		const cells = new Map<string, RecordRow<T>[]>(columns.map((column) => [column.key, []]));
		for (const row of group.rows) {
			const place = placement.get(row.id);
			if (!place) continue;
			place.lane = group.key;
			cells.get(place.column)!.push(row);
		}
		return {
			key: group.key,
			value: group.value,
			label: group.label,
			color: group.color,
			cells,
			count: group.rows.length,
			total: options.valueField ? aggregateRecords(group.rows, reader, aggregate, options.valueField) : null,
		};
	});
	const byId = new Map(rows.map((row) => [row.id, row]));
	const lookup = (id: string) => byId.get(id) ?? options.lookup?.(id);
	const blocked = new Set<string>();
	for (const row of rows) if (reader.isBlocked(row, lookup, options.today)) blocked.add(row.id);
	return { columns, lanes, blocked, placement };
}

export interface BoardMove {
	/** Cards to move, in the order they should land. */
	ids: readonly string[];
	column: string;
	/** Target lane key (boards with swimlanes). Default: each card keeps its lane. */
	lane?: string;
	/** The card the moved cards land before; null = end of the cell. */
	beforeId?: string | null;
}

export interface BoardMovePlan {
	writes: GridCellWrite[];
	/** Why the move cannot happen (a hard WIP limit). */
	rejected?: string;
	/** Soft warnings (WIP limit exceeded). */
	warnings: string[];
}

/**
 * The cell writes that move cards: their column (and lane) value, and — when the board has a rank
 * field — ranks placing them between their new neighbours. One transaction, one undo step.
 */
export function planBoardMove<T>(
	board: BoardModel<T>,
	reader: RecordReader<T>,
	options: BoardOptions<T>,
	move: BoardMove,
	policy: { wip?: 'warn' | 'block' } = {}
): BoardMovePlan {
	const column = board.columns.find((candidate) => candidate.key === move.column);
	const warnings: string[] = [];
	if (!column) return { writes: [], rejected: 'That column no longer exists.', warnings };
	const moving = new Set(move.ids);
	const arriving = move.ids.filter((id) => board.placement.get(id)?.column !== column.key).length;
	if (column.limit != null && column.rows.length + arriving > column.limit) {
		const message = `${column.label} is limited to ${column.limit} cards.`;
		if (policy.wip === 'block') return { writes: [], rejected: message, warnings };
		warnings.push(message);
	}
	const lane = move.lane !== undefined ? board.lanes.find((candidate) => candidate.key === move.lane) : undefined;
	const writes: GridCellWrite[] = [];
	for (const id of move.ids) {
		const place = board.placement.get(id);
		if (!place) continue;
		if (place.column !== column.key) writes.push({ rowId: id, colField: options.columnField, value: column.value });
		if (lane && options.laneField && place.lane !== lane.key && lane.key !== SINGLE_LANE)
			writes.push({ rowId: id, colField: options.laneField, value: lane.value });
	}
	const rankField = reader.roles.rank;
	if (rankField && options.useRank) {
		const laneKey = lane?.key ?? board.placement.get(move.ids[0])?.lane ?? SINGLE_LANE;
		const cell = (board.lanes.find((candidate) => candidate.key === laneKey)?.cells.get(column.key) ?? []).filter((row) => !moving.has(row.id));
		let at = move.beforeId ? cell.findIndex((row) => row.id === move.beforeId) : -1;
		if (at < 0) at = cell.length;
		const rankOf = (row: RecordRow<T> | undefined) => {
			const value = row ? reader.value(row, rankField) : null;
			return value == null || value === '' ? null : String(value);
		};
		// Neighbours without ranks get ranked first, in their current order, so the order holds.
		if (cell.some((row) => rankOf(row) == null)) {
			const ranks = ranksBetween(null, null, cell.length + move.ids.length);
			const sequence = [...cell.slice(0, at).map((row) => row.id), ...move.ids, ...cell.slice(at).map((row) => row.id)];
			sequence.forEach((id, i) => writes.push({ rowId: id, colField: rankField, value: ranks[i] }));
		} else {
			const ranks = ranksBetween(rankOf(cell[at - 1]), rankOf(cell[at]), move.ids.length);
			move.ids.forEach((id, i) => writes.push({ rowId: id, colField: rankField, value: ranks[i] }));
		}
	}
	return { writes, warnings };
}
