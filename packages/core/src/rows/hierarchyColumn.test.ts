import { describe, expect, it } from 'vitest';
import { GridStore } from '../store.js';
import type { ColumnDef } from '../columnDef.js';
import { HIERARCHY_COLUMN_FIELD, syncHierarchyColumn } from './hierarchyColumn.js';

interface Row {
	id: string;
	region: string;
	amount: number;
	parentId?: string;
}

const COLUMNS: ColumnDef<Row>[] = [
	{ field: 'region', header: 'Region' },
	{ field: 'amount', header: 'Amount' },
];
const SELECT = { field: '__rowSelect__', header: '', checkboxSelection: true } as ColumnDef<Row>;
const fields = (columns: ColumnDef<Row>[]) => columns.map((column) => column.field);

describe('syncHierarchyColumn', () => {
	it('adds a pinned hierarchy column first while grouped, and bumps the pinned count', () => {
		const out = syncHierarchyColumn<Row>({ columns: COLUMNS, pinnedColumns: { left: 0, right: 0 }, grouping: { by: ['region'] } });
		expect(fields(out.columns)).toEqual([HIERARCHY_COLUMN_FIELD, 'region', 'amount']);
		expect(out.pinnedColumns).toEqual({ left: 1, right: 0 });
	});

	it('goes after a leading row-selection column', () => {
		const out = syncHierarchyColumn<Row>({ columns: [SELECT, ...COLUMNS], pinnedColumns: { left: 1, right: 0 }, grouping: { by: ['region'] } });
		expect(fields(out.columns)).toEqual(['__rowSelect__', HIERARCHY_COLUMN_FIELD, 'region', 'amount']);
		expect(out.pinnedColumns).toEqual({ left: 2, right: 0 });
	});

	it('unpinned: becomes the first unpinned column without touching the pinned count', () => {
		const out = syncHierarchyColumn<Row>({
			columns: COLUMNS,
			pinnedColumns: { left: 1, right: 0 },
			grouping: { by: ['amount'] },
			hierarchyColumn: { pinned: false },
		});
		expect(fields(out.columns)).toEqual(['region', HIERARCHY_COLUMN_FIELD, 'amount']);
		expect(out.pinnedColumns).toEqual({ left: 1, right: 0 });
	});

	it('removes it (and unpins it) when grouping ends, and is a no-op when already in sync', () => {
		const added = syncHierarchyColumn<Row>({ columns: COLUMNS, pinnedColumns: { left: 0, right: 0 }, grouping: { by: ['region'] } });
		const again = syncHierarchyColumn<Row>({ columns: added.columns, pinnedColumns: added.pinnedColumns, grouping: { by: ['region'] } });
		expect(again.changed).toBe(false);
		expect(again.columns).toBe(added.columns);

		const removed = syncHierarchyColumn<Row>({ columns: added.columns, pinnedColumns: added.pinnedColumns, grouping: { by: [] } });
		expect(fields(removed.columns)).toEqual(['region', 'amount']);
		expect(removed.pinnedColumns).toEqual({ left: 0, right: 0 });
	});

	it('exists for tree data, not for full-width group rows or when turned off', () => {
		expect(fields(syncHierarchyColumn<Row>({ columns: COLUMNS, treeData: { getParentId: (row) => row.parentId } }).columns)).toContain(
			HIERARCHY_COLUMN_FIELD
		);
		expect(syncHierarchyColumn<Row>({ columns: COLUMNS, grouping: { by: ['region'], display: 'row' } }).changed).toBe(false);
		expect(syncHierarchyColumn<Row>({ columns: COLUMNS, grouping: { by: ['region'] }, hierarchyColumn: false }).changed).toBe(false);
	});

	it('keeps a user-resized width and picks up header / width config', () => {
		const added = syncHierarchyColumn<Row>({
			columns: COLUMNS,
			grouping: { by: ['region'] },
			hierarchyColumn: { header: 'Territory', width: 300 },
		});
		expect(added.columns[0]).toMatchObject({ header: 'Territory', width: 300 });
	});
});

describe('hierarchy column at runtime', () => {
	function makeStore(initial: Partial<ConstructorParameters<typeof GridStore<Row>>[0]> = {}) {
		return new GridStore<Row>({ getRowId: (row) => row.id, columns: COLUMNS, ...initial });
	}

	it('is present from construction when grouped, with the pinned lane including it', () => {
		const store = makeStore({ grouping: { by: ['region'] } });
		expect(fields(store.getState().columns)).toEqual([HIERARCHY_COLUMN_FIELD, 'region', 'amount']);
		expect(store.engine.viewport.pinLeftColumns).toBe(1);
		store.destroy();
	});

	it('appears and disappears with grouping changes, moving the pinned lane with it', () => {
		const store = makeStore();
		store.setGroupBy(['region']);
		expect(fields(store.getState().columns)[0]).toBe(HIERARCHY_COLUMN_FIELD);
		expect(store.engine.viewport.pinLeftColumns).toBe(1);
		expect(store.engine.columns.getDisplayedColumns()[0].field).toBe(HIERARCHY_COLUMN_FIELD);

		store.setGroupBy([]);
		expect(fields(store.getState().columns)).toEqual(['region', 'amount']);
		expect(store.engine.viewport.pinLeftColumns).toBe(0);
		store.destroy();
	});

	it('survives setColumns and follows setHierarchyColumn / setTreeData', () => {
		const store = makeStore({ grouping: { by: ['region'] } });
		store.setColumns([
			{ field: 'amount', header: 'Amount' },
			{ field: 'region', header: 'Region' },
		]);
		expect(fields(store.getState().columns)).toEqual([HIERARCHY_COLUMN_FIELD, 'amount', 'region']);

		store.setHierarchyColumn({ header: 'Territory' });
		expect(store.getState().columns[0].header).toBe('Territory');
		store.setHierarchyColumn(false);
		expect(fields(store.getState().columns)).toEqual(['amount', 'region']);
		expect(store.engine.viewport.pinLeftColumns).toBe(0);

		store.setHierarchyColumn(undefined);
		store.setGrouping(undefined);
		expect(fields(store.getState().columns)).toEqual(['amount', 'region']);
		store.setTreeData({ getParentId: (row) => row.parentId });
		expect(fields(store.getState().columns)[0]).toBe(HIERARCHY_COLUMN_FIELD);
		store.destroy();
	});
});

describe('hierarchy column through the public bootstrap', () => {
	it('survives row-model initialisation (createClientGrid hands the controller the user columns)', async () => {
		const { createClientGrid } = await import('../createGrid.js');
		const api = createClientGrid<Row>({
			rows: [{ id: '1', region: 'EMEA', amount: 1 }],
			columns: COLUMNS,
			getRowId: (row) => row.id,
			initialState: { grouping: { by: ['region'] } },
		});
		expect(api.getColumns().map((column) => column.field)).toEqual([HIERARCHY_COLUMN_FIELD, 'region', 'amount']);
		expect(api.getPinnedColumns()).toEqual({ left: 1, right: 0 });
		api.destroy();
	});

	it('keeps its pinned place when the column order is set without it', () => {
		const store = new GridStore<Row>({ getRowId: (row) => row.id, columns: COLUMNS, grouping: { by: ['region'] } });
		store.setColumnOrder(['amount', 'region']);
		expect(fields(store.getState().columns)).toEqual([HIERARCHY_COLUMN_FIELD, 'amount', 'region']);
		expect(store.engine.viewport.pinLeftColumns).toBe(1);
		store.destroy();
	});
});
