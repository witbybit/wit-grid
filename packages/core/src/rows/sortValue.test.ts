import { describe, expect, it } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { segmentedColumnType, selectColumnType } from '../cells/cellTypes.js';
import type { ColumnDef } from '../columnDef.js';

interface Task {
	id: string;
	status: string;
	size: string;
}

const STATUS = [
	{ value: 'backlog', label: 'Backlog' },
	{ value: 'todo', label: 'To do' },
	{ value: 'progress', label: 'In progress' },
	{ value: 'done', label: 'Done' },
];

function createGrid(rows: Task[], status: ColumnDef<Task> = { field: 'status', header: 'Status', ...selectColumnType(STATUS) }) {
	const columns: ColumnDef<Task>[] = [status, { field: 'size', header: 'Size', ...segmentedColumnType(['S', 'M', 'L']) }];
	const store = new GridStore<Task>({ columns, getRowId: (row) => row.id });
	const controller = new ClientRowModelController<Task>(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	const order = () => {
		const model = store.getRowModel()!;
		const out: string[] = [];
		for (let i = 0; i < model.getVisualRowCount(); i++) {
			const row = model.getVisualRow(i)!;
			out.push(row.kind === 'data' ? row.rowId : `[${row.kind === 'group' ? String(row.key) : row.kind}]`);
		}
		return out;
	};
	return { store, controller, order };
}

const ROWS: Task[] = [
	{ id: 'a', status: 'done', size: 'M' },
	{ id: 'b', status: 'backlog', size: 'L' },
	{ id: 'c', status: 'progress', size: 'S' },
	{ id: 'd', status: 'todo', size: 'L' },
	{ id: 'e', status: 'mystery', size: 'S' },
];

describe('option columns sort by what the user sees', () => {
	it('sorts a select column in option order, unknown values after the known ones', () => {
		const { store, controller, order } = createGrid(ROWS);
		store.setSortModel([{ colId: 'status', sort: 'asc' }]);
		expect(order()).toEqual(['b', 'd', 'c', 'a', 'e']);
		store.setSortModel([{ colId: 'status', sort: 'desc' }]);
		expect(order()).toEqual(['e', 'a', 'c', 'd', 'b']);
		controller.dispose();
	});

	it('sorts a segmented column in option order (S, M, L), not alphabetically', () => {
		const { store, controller, order } = createGrid(ROWS);
		store.setSortModel([{ colId: 'size', sort: 'asc' }]);
		expect(order()).toEqual(['c', 'e', 'a', 'b', 'd']);
		controller.dispose();
	});

	it("sorts by the label shown with sortBy: 'label', never by the stored value", () => {
		const { store, controller, order } = createGrid(ROWS, { field: 'status', header: 'Status', ...selectColumnType(STATUS, { sortBy: 'label' }) });
		store.setSortModel([{ colId: 'status', sort: 'asc' }]);
		// Backlog, Done, In progress, mystery, To do — by label ('progress' shows as "In progress").
		expect(order()).toEqual(['b', 'a', 'c', 'e', 'd']);
		controller.dispose();
	});

	it('orders group rows of the sorted column in option order too', () => {
		const { store, controller, order } = createGrid(ROWS);
		store.setGroupBy(['status']);
		store.setSortModel([{ colId: 'status', sort: 'asc' }]);
		const groups = order().filter((id) => id.startsWith('['));
		expect(groups).toEqual(['[backlog]', '[todo]', '[progress]', '[done]', '[mystery]']);
		controller.dispose();
	});

	it('re-sorts an edited row to where a full sort would put it', () => {
		const { store, controller, order } = createGrid(ROWS);
		store.setSortModel([{ colId: 'status', sort: 'asc' }]);
		store.setCellValue('a', 'status', 'todo');
		const relocated = order();
		store.setSortModel(null);
		store.setSortModel([{ colId: 'status', sort: 'asc' }]);
		expect(relocated).toEqual(order());
		expect(relocated.indexOf('a')).toBeLessThan(relocated.indexOf('c'));
		controller.dispose();
	});
});
