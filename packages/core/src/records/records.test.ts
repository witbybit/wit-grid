import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '../columnDef.js';
import {
	currencyColumnType,
	personColumnType,
	progressColumnType,
	selectColumnType,
	dateRangeColumnType,
	dateColumnType,
} from '../cells/cellTypes.js';
import { buildBoard, planBoardMove, SINGLE_LANE } from './board.js';
import { fromDay, isoDay, toDay, weekday } from './days.js';
import { aggregateRecords, groupRecords } from './recordGroups.js';
import { parseDependencies, RecordReader, resolveRecordRoles, writeDependencies, type RecordRow } from './recordModel.js';
import { rankBetween, ranksBetween } from './rank.js';

interface Task {
	name: string;
	status: string | null;
	team?: string;
	owner?: string;
	budget?: number;
	progress?: number;
	plan?: { start: string; end: string };
	due?: string;
	deps?: unknown;
	rank?: string;
}

const STATUS = [
	{ value: 'todo', label: 'To do', color: 'gray' },
	{ value: 'doing', label: 'In progress', color: 'blue' },
	{ value: 'blocked', label: 'Blocked', color: 'red' },
	{ value: 'done', label: 'Done', color: 'green' },
];

const columns: ColumnDef<Task>[] = [
	{ field: 'name', header: 'Task' },
	{ field: 'status', header: 'Status', ...selectColumnType(STATUS) },
	{ field: 'team', header: 'Team', ...selectColumnType(['FE', 'BE']) },
	{ field: 'owner', header: 'Owner', ...personColumnType({ people: [{ value: 'ava', label: 'Ava' }] }) },
	{ field: 'budget', header: 'Budget', ...currencyColumnType() },
	{ field: 'progress', header: 'Progress', ...progressColumnType() },
	{ field: 'plan', header: 'Plan', ...dateRangeColumnType() },
	{ field: 'due', header: 'Due', ...dateColumnType() },
	{ field: 'deps', header: 'Depends on' },
	{ field: 'rank', header: 'Rank' },
];

const rows: RecordRow<Task>[] = [
	{ id: 'a', data: { name: 'Alpha', status: 'todo', team: 'FE', budget: 100, progress: 0 } },
	{ id: 'b', data: { name: 'Beta', status: 'doing', team: 'BE', budget: 250, progress: 50, deps: ['a'] } },
	{ id: 'c', data: { name: 'Gamma', status: 'done', team: 'FE', budget: 50, progress: 100 } },
	{ id: 'd', data: { name: 'Delta', status: 'doing', team: 'FE', deps: 'c' } },
	{ id: 'e', data: { name: 'Eps', status: null } },
];

describe('days', () => {
	it('round-trips days and knows weekdays', () => {
		const day = toDay(new Date(2026, 9, 10));
		expect(isoDay(day)).toBe('2026-10-10');
		expect(fromDay(day).getDate()).toBe(10);
		expect(weekday(day)).toBe(6); // Saturday
	});
});

describe('record roles', () => {
	it('infers roles from the column schema and names', () => {
		const roles = resolveRecordRoles(columns);
		expect(roles).toMatchObject({
			title: 'name',
			status: 'status',
			team: 'team',
			owner: 'owner',
			value: 'budget',
			progress: 'progress',
			schedule: 'plan',
			due: 'due',
			dependencies: 'deps',
			rank: 'rank',
		});
		expect(roles.doneValues).toEqual(['done']);
		expect(roles.blockedValues).toEqual(['blocked']);
	});

	it('honours configuration and ignores missing fields', () => {
		const roles = resolveRecordRoles(columns, { title: 'missing', status: 'team', doneValues: ['BE'] });
		expect(roles.title).toBeUndefined();
		expect(roles.status).toBe('team');
		expect(roles.doneValues).toEqual(['BE']);
	});

	it('reads options, progress, spans and dependencies', () => {
		const reader = new RecordReader(columns, resolveRecordRoles(columns));
		expect(reader.option('status', 'doing')?.label).toBe('In progress');
		expect(reader.progress(rows[1])).toBe(0.5);
		expect(reader.isDone(rows[2])).toBe(true);
		const span = reader.span({ id: 'x', data: { name: 'x', status: null, plan: { start: '2026-03-02', end: '2026-03-06' } } })!;
		expect(span.end - span.start).toBe(4);
		expect(reader.span({ id: 'x', data: { name: 'x', status: null, due: '2026-03-02' } })).toEqual({
			start: toDay(new Date(2026, 2, 2)),
			end: toDay(new Date(2026, 2, 2)),
		});
		expect(reader.dependencies(rows[1])).toEqual([{ from: 'a', to: 'b', type: 'FS', lag: 0 }]);
	});
});

describe('dependencies', () => {
	it('parses ids, typed links with lag and objects', () => {
		expect(parseDependencies('T-12, T-13SS+2d, T-14FF-1', 'x')).toEqual([
			{ from: 'T-12', to: 'x', type: 'FS', lag: 0 },
			{ from: 'T-13', to: 'x', type: 'SS', lag: 2 },
			{ from: 'T-14', to: 'x', type: 'FF', lag: -1 },
		]);
		expect(parseDependencies([{ id: 7, type: 'sf', lag: 3 }], 'x')).toEqual([{ from: '7', to: 'x', type: 'SF', lag: 3 }]);
		expect(parseDependencies(['x'], 'x')).toEqual([]);
	});

	it('writes links back in the shape the cell held', () => {
		const links = parseDependencies('a, bSS+2d', 'x');
		expect(writeDependencies('', links)).toBe('a, bSS+2d');
		expect(writeDependencies([], links)).toEqual(['a', 'bSS+2d']);
		expect(writeDependencies([{ id: 'q' }], links)).toEqual([
			{ id: 'a', type: 'FS', lag: 0 },
			{ id: 'b', type: 'SS', lag: 2 },
		]);
	});
});

describe('grouping', () => {
	const reader = new RecordReader(columns, resolveRecordRoles(columns));

	it('orders groups by option order with empty values last', () => {
		const groups = groupRecords(rows, reader, 'status');
		expect(groups.map((group) => group.key)).toEqual(['todo', 'doing', 'done', '']);
		expect(groups[1].label).toBe('In progress');
		expect(groups[3].value).toBeNull();
	});

	it('shows every option when asked, in a given order first', () => {
		const groups = groupRecords(rows, reader, 'status', { showEmpty: true, order: ['done'] });
		expect(groups.map((group) => group.key)).toEqual(['done', 'todo', 'doing', 'blocked', '']);
	});

	it('aggregates', () => {
		expect(aggregateRecords(rows, reader, 'sum', 'budget')).toBe(400);
		expect(aggregateRecords(rows, reader, 'avg', 'budget')).toBeCloseTo(133.33, 1);
		expect(aggregateRecords(rows, reader, 'done')).toBe(1);
		expect(aggregateRecords(rows, reader, 'progress')).toBe(0.5);
		expect(aggregateRecords(rows, reader, 'filled', 'team')).toBe(4);
	});
});

describe('ranks', () => {
	it('always sorts between its neighbours', () => {
		let low: string | null = null;
		let high: string | null = null;
		const seen: string[] = [];
		for (let i = 0; i < 200; i++) {
			const rank = rankBetween(low, high);
			if (low !== null) expect(rank > low).toBe(true);
			if (high !== null) expect(rank < high).toBe(true);
			seen.push(rank);
			if (i % 2) low = rank;
			else high = rank;
		}
		expect(new Set(seen).size).toBe(200);
	});

	it('spreads several ranks evenly and keeps them short', () => {
		const ranks = ranksBetween(null, null, 100);
		expect([...ranks].sort()).toEqual(ranks);
		expect(Math.max(...ranks.map((rank) => rank.length))).toBeLessThanOrEqual(3);
		expect(rankBetween('h', 'i') > 'h').toBe(true);
		expect(rankBetween('h', 'i') < 'i').toBe(true);
	});
});

describe('board', () => {
	const roles = resolveRecordRoles(columns);
	const reader = new RecordReader(columns, roles);
	const options = { columnField: 'status', laneField: 'team', valueField: 'budget', wipLimits: { doing: 2 }, today: toDay(new Date(2026, 0, 1)) };

	it('places cards in columns and lanes with totals, limits and blocked state', () => {
		const board = buildBoard(rows, reader, options);
		expect(board.columns.map((column) => [column.key, column.rows.length])).toEqual([
			['todo', 1],
			['doing', 2],
			['blocked', 0],
			['done', 1],
			['', 1],
		]);
		expect(board.columns[0].total).toBe(100);
		expect(board.columns[1].limit).toBe(2);
		expect(board.lanes.map((lane) => lane.key)).toEqual(['FE', 'BE', '']);
		expect(board.lanes[0].cells.get('doing')!.map((row) => row.id)).toEqual(['d']);
		// b (in progress) waits on a (to do); d waits on c (done).
		expect([...board.blocked]).toEqual(['b']);
	});

	it('counts waiting work as blocked only once it should be under way', () => {
		const dated = (start: string) => ({ start, end: start });
		const plan: RecordRow<Task>[] = [
			{ id: 'p', data: { name: 'Pre', status: 'doing' } },
			{ id: 'late', data: { name: 'Late', status: 'todo', plan: dated('2025-12-01'), deps: ['p'] } },
			{ id: 'later', data: { name: 'Later', status: 'todo', plan: dated('2026-02-01'), deps: ['p'] } },
			{ id: 'undated', data: { name: 'Undated', status: 'todo', deps: ['p'] } },
			{ id: 'queued', data: { name: 'Queued', status: 'todo', deps: ['p'] } },
		];
		const board = buildBoard(plan, reader, { columnField: 'status', today: toDay(new Date(2026, 0, 1)) });
		// Undated records count as under way once past the first status (to do is first here).
		expect([...board.blocked].sort()).toEqual(['late']);
		expect(reader.blockers(plan[1], (id) => plan.find((row) => row.id === id))).toEqual(['p']);
	});

	it('plans a move as cell writes, and blocks over a hard limit', () => {
		const board = buildBoard(rows, reader, options);
		const plan = planBoardMove(board, reader, options, { ids: ['a'], column: 'done', lane: 'BE' });
		expect(plan.writes).toEqual([
			{ rowId: 'a', colField: 'status', value: 'done' },
			{ rowId: 'a', colField: 'team', value: 'BE' },
		]);
		expect(planBoardMove(board, reader, options, { ids: ['a'], column: 'doing' }, { wip: 'block' }).rejected).toMatch(/limited to 2/);
		expect(planBoardMove(board, reader, options, { ids: ['a'], column: 'doing' }).warnings).toHaveLength(1);
		expect(planBoardMove(board, reader, options, { ids: ['e'], column: '' }).writes).toEqual([]);
	});

	it('ranks dropped cards between their neighbours', () => {
		const ranked = rows.slice(0, 4).map((row, i) => ({ ...row, data: { ...row.data, status: 'todo', rank: ['b', 'd', 'f', 'h'][i] } }));
		const rankOptions = { columnField: 'status', useRank: true };
		const board = buildBoard([...ranked].reverse(), reader, rankOptions);
		expect(board.lanes[0].key).toBe(SINGLE_LANE);
		expect(board.columns[0].rows.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
		const plan = planBoardMove(board, reader, rankOptions, { ids: ['d'], column: 'todo', beforeId: 'b' });
		expect(plan.writes).toHaveLength(1);
		const rank = plan.writes[0].value as string;
		expect(rank > 'b' && rank < 'd').toBe(true);
	});

	it('ranks a whole cell once when its cards have no ranks yet', () => {
		const board = buildBoard(rows, reader, { columnField: 'status', useRank: true });
		const plan = planBoardMove(board, reader, { columnField: 'status', useRank: true }, { ids: ['a'], column: 'doing', beforeId: 'd' });
		const ranks = plan.writes.filter((write) => write.colField === 'rank');
		expect(ranks.map((write) => write.rowId)).toEqual(['b', 'a', 'd']);
		const values = ranks.map((write) => write.value as string);
		expect([...values].sort()).toEqual(values);
	});
});
