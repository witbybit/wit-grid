import { describe, expect, it } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import type { ColumnDef } from '../columnDef.js';
import { GridEventName } from '../api/GridEvents.js';

type Row = { id: string; name: string; amount: number };

function makeGrid(columns: ColumnDef<Row>[] = [{ field: 'name' }, { field: 'amount' }]) {
	const rows: Row[] = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, name: `N${i}`, amount: i }));
	const store = new GridStore<Row>({ columns, getRowId: (row) => row.id });
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	const versions = () => new Map(store.engine.rowVersions);
	const destroy = () => {
		controller.dispose();
		store.destroy();
	};
	return { store, rows, versions, destroy };
}

describe('setRows diffs against the current rows', () => {
	it('passing the same row objects again changes nothing', () => {
		const grid = makeGrid();
		const before = grid.versions();
		let updates = 0;
		grid.store.addEventListener(GridEventName.rowsUpdated, () => updates++);
		grid.store.setRows([...grid.rows]);
		expect(grid.versions()).toEqual(before);
		expect(updates).toBe(0);
		grid.destroy();
	});

	it('an edited copy of one row of 1,000 touches only that row, reporting the changed field', async () => {
		const grid = makeGrid();
		const before = grid.versions();
		const events: { changed: string[]; fields: string[] }[] = [];
		grid.store.addEventListener(GridEventName.rowsUpdated, (e) =>
			events.push({
				changed: (e.payload.changedNodes ?? []).map((n) => n.id),
				fields: [...(e.payload.changedValuesByRow?.get('r500')?.keys() ?? [])],
			})
		);
		grid.store.setRows(grid.rows.map((r) => (r.id === 'r500' ? { ...r, amount: -1 } : r)));
		await Promise.resolve();
		const after = grid.versions();
		const bumped = [...after].filter(([id, v]) => before.get(id) !== v).map(([id]) => id);
		expect(bumped).toEqual(['r500']);
		expect(events).toEqual([{ changed: ['r500'], fields: ['amount'] }]);
		expect(grid.store.getRowNode?.('r500')?.data.amount ?? grid.store.engine.data.getRawCellValue('r500', 'amount')).toBe(-1);
		grid.destroy();
	});

	it('reports removed rows (so their per-row state is swept) and added ones', () => {
		const grid = makeGrid();
		let removed: string[] = [];
		let added: string[] = [];
		grid.store.addEventListener(GridEventName.rowsUpdated, (e) => {
			removed = (e.payload.removedNodes ?? []).map((n) => n.id);
			added = (e.payload.addedNodes ?? []).map((n) => n.id);
		});
		grid.store.setRows([...grid.rows.filter((r) => r.id !== 'r3'), { id: 'new', name: 'New', amount: 5 }]);
		expect(removed).toEqual(['r3']);
		expect(added).toEqual(['new']);
		expect(grid.store.getRowOrder()).toHaveLength(1000);
		grid.destroy();
	});

	it('a getter depending on a changed field recomputes, and a sorted field re-sorts', () => {
		const grid = makeGrid([
			{ field: 'name' },
			{ field: 'amount' },
			{ field: 'double', valueGetter: ({ row }) => row.amount * 2, valueGetterDependencies: ['amount'] },
		]);
		expect(grid.store.engine.data.getCellValue('r10', 'double')).toBe(20);
		grid.store.setSortModel([{ colId: 'amount', sort: 'desc' }]);
		grid.store.setRows(grid.rows.map((r) => (r.id === 'r10' ? { ...r, amount: 5000 } : r)));
		expect(grid.store.engine.data.getCellValue('r10', 'double')).toBe(10000);
		expect(grid.store.engine.getRowModel()?.getVisualRow(0)).toMatchObject({ kind: 'data', node: { id: 'r10' } });
		grid.destroy();
	});
});
