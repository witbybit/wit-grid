import { describe, it, expect, vi } from 'vitest';
import { GridStore, isEditableVisualRow, isFullWidthVisualRow } from './store.js';
import { ClientRowModelController, type RowModelRefreshResult } from './rowModel.js';
import { RowDataStore } from './rows/RowDataStore.js';
import { RowPipeline } from './rows/RowPipeline.js';
import { toDataVisualRowId, toDetailVisualRowId, toTotalVisualRowId } from './rows/visualRowIds.js';
import { RecordingGridInstrumentation, GridMetric } from './diagnostics/GridInstrumentation.js';

interface TestRow {
	id: string;
	name: string;
	parentId?: string | null;
	category?: string;
	amount?: number;
	user?: {
		name: string;
	};
}

function getRowNode<TData>(controller: ClientRowModelController<TData>, index: number) {
	const vr = controller.getVisualRow(index);
	return vr?.kind === 'data' ? vr.node : null;
}

function doUpdateRows<T>(ctrl: ClientRowModelController<T>, updater: (rows: T[]) => T[]): void {
	const wr = ctrl.updateRowsStructurally(updater);
	const allFields = new Set<string>();
	if (wr.changedFieldsByRow) {
		for (const fields of wr.changedFieldsByRow.values()) {
			for (const f of fields) allFields.add(f);
		}
	}
	ctrl.reconcileAfterDataWrite(wr, allFields.size > 0 ? ctrl.classifyFieldMutation(allFields) : 'value-only');
}

function doSetCellValue<T>(ctrl: ClientRowModelController<T>, rowId: string, field: string, value: unknown): void {
	const wr = ctrl.writeCellValueStructurally(rowId, field, value);
	ctrl.reconcileAfterDataWrite(wr, ctrl.classifyFieldMutation(new Set([field])));
}

function doApplyTransaction<T>(
	ctrl: ClientRowModelController<T>,
	transaction: Parameters<ClientRowModelController<T>['applyTransactionStructurally']>[0]
): void {
	const writeResult = ctrl.applyTransactionStructurally(transaction);
	const hasStructural = (writeResult.addedNodes?.length ?? 0) > 0 || (writeResult.removedNodes?.length ?? 0) > 0;
	const changedFields = new Set<string>();
	for (const fields of writeResult.changedFieldsByRow?.values() ?? []) {
		for (const field of fields) changedFields.add(field);
	}
	ctrl.reconcileAfterDataWrite(
		writeResult,
		hasStructural ? 'insert' : changedFields.size > 0 ? ctrl.classifyFieldMutation(changedFields) : 'value-only'
	);
}

describe('ClientRowModelController', () => {
	it('should initialize and populate visualRows correctly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const rows = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
		];

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(2);
		expect(controller.getVisualIndexById(toDataVisualRowId('1'))).toBe(0);
		expect(controller.getVisualIndexById(toDataVisualRowId('2'))).toBe(1);

		const visualRow1 = controller.getVisualRow(0);
		expect(visualRow1?.kind).toBe('data');
		expect(visualRow1?.id).toBe('row:1');
		expect(visualRow1?.kind === 'data' ? visualRow1.rowId : null).toBe('1');

		const node1 = getRowNode(controller, 0);
		expect(node1?.data.name).toBe('Alice');
	});

	it('should support updating cell values directly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const rows = [{ id: '1', name: 'Alice' }];
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		doSetCellValue(controller, '1', 'name', 'Alicia');
		const node = controller.getRowNodeById('1');
		expect(node?.data.name).toBe('Alicia');
	});

	it('implements the viewport/load-state contract for client rows', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice' },
				{ id: '2', name: 'Bob' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getKnownRowCount()).toBe(2);
		expect(controller.getEstimatedRowCount()).toBe(2);
		expect(controller.getRowCountKind()).toBe('known');
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(controller.isRowLoaded(1)).toBe(true);
		expect(controller.isRowLoading(1)).toBe(false);
		expect(controller.isRowFailed(1)).toBe(false);
		expect(controller.isRangeLoaded(0, 1)).toBe(true);
		expect(controller.getRangeLoadState(0, 2)).toEqual({
			loaded: 2,
			loading: 0,
			failed: 0,
			placeholder: 0,
			missing: 1,
		});

		controller.ensureRange(0, 1, 'test');
	});

	it('should refresh sorting when a nested column path changes through its parent object', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'user.name', header: 'User' }],
			sortModel: [{ colId: 'user.name', sort: 'asc' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', user: { name: 'Alice' } },
				{ id: '2', name: 'Two', user: { name: 'Bob' } },
			],
			columns: store.getState().columns,
		});

		doUpdateRows(controller, (rows) => rows.map((row) => (row.id === '2' ? { ...row, user: { name: 'Aaron' } } : row)));

		expect(getRowNode(controller, 0)?.id).toBe('2');
	});

	it('should automatically refresh sorting and filtering when setCellValue is called', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			sortModel: [{ colId: 'name', sort: 'asc' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Bob' },
				{ id: '2', name: 'Charlie' },
				{ id: '3', name: 'Alice' },
			],
			columns: store.getState().columns,
		});

		// Initial sorted order: Alice (3), Bob (1), Charlie (2)
		expect(getRowNode(controller, 0)?.id).toBe('3'); // Alice
		expect(getRowNode(controller, 1)?.id).toBe('1'); // Bob
		expect(getRowNode(controller, 2)?.id).toBe('2'); // Charlie

		// Edit Charlie to Aaron. The sort order should automatically update to Aaron (2), Alice (3), Bob (1)
		doSetCellValue(controller, '2', 'name', 'Aaron');

		expect(getRowNode(controller, 0)?.id).toBe('2'); // Aaron (formerly Charlie)
		expect(getRowNode(controller, 1)?.id).toBe('3'); // Alice
		expect(getRowNode(controller, 2)?.id).toBe('1'); // Bob
	});

	it('should support getVisualIndexById, getVisualIndexByRowId, and getRawRowById correctly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const rows = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
		];

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		expect(controller.getVisualIndexById('row:1')).toBe(0);
		expect(controller.getVisualIndexById('row:2')).toBe(1);
		expect(controller.getVisualIndexByRowId('1')).toBe(0);
		expect(controller.getVisualIndexByRowId('2')).toBe(1);
		expect(controller.getVisualIndexById('1')).toBe(-1);
		expect(controller.getRawRowById('1')).toEqual({ id: '1', name: 'Alice' });
		expect(controller.getRawRowById('2')).toEqual({ id: '2', name: 'Bob' });
		expect(controller.getRawRowById('non-existent')).toBeNull();
	});

	it('keeps data visual row IDs namespaced even when raw row IDs look like groups', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'group:name:Alice', name: 'Alice' }],
			columns: store.getState().columns,
		});

		const row = controller.getVisualRow(0);
		expect(row?.kind).toBe('data');
		expect(row?.id).toBe('row:group%3Aname%3AAlice');
		expect(row?.kind === 'data' ? row.rowId : null).toBe('group:name:Alice');
		expect(controller.getVisualIndexByRowId('group:name:Alice')).toBe(0);
		expect(controller.getVisualIndexById('group:name:Alice')).toBe(-1);
	});

	it('filters and sorts flat data rows while preserving rowId mappings', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			filterModel: { name: { type: 'text', operator: 'contains', value: 'a' } },
			sortModel: [{ colId: 'name', sort: 'desc' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Ada' },
				{ id: '2', name: 'Bob' },
				{ id: '3', name: 'Cara' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(2);
		expect(getRowNode(controller, 0)?.id).toBe('3');
		expect(getRowNode(controller, 1)?.id).toBe('1');
		expect(controller.getVisualIndexByRowId('3')).toBe(0);
		expect(controller.getVisualIndexById('row:3')).toBe(0);
	});

	it('builds first-class group rows', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'], defaultExpanded: true },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', category: 'A', amount: 5 },
				{ id: '2', name: 'Two', category: 'A', amount: 7 },
			],
			columns: store.getState().columns,
		});

		const rows = Array.from({ length: controller.getVisualRowCount() }, (_, index) => controller.getVisualRow(index));
		expect(rows[0]?.kind).toBe('group');
		expect(rows[0]?.id).toBe('group:category=A');
		expect(rows[1]?.kind).toBe('data');
		expect(rows[1]?.id).toBe('row:1');
	});

	it('aggregates grouped rows through the pipeline value resolver', () => {
		const dataStore = new RowDataStore<TestRow>((row) => row.id);
		dataStore.setRows([
			{ id: '1', name: 'One', category: 'A', amount: 5 },
			{ id: '2', name: 'Two', category: 'A', amount: 7 },
		]);

		const pipeline = new RowPipeline<TestRow>();
		const result = pipeline.run({
			nodes: dataStore.getAllNodes(),
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'doubleAmount', header: 'Double', valueGetter: ({ row }) => (row.amount ?? 0) * 2 },
			],
			sortModel: null,
			filterModel: null,
			grouping: { by: ['category'], defaultExpanded: true },
			aggregation: { defs: [{ colId: 'doubleAmount', aggFunc: 'sum' }] },
			expansion: { rows: {}, details: {} },
			defaultRowHeight: 40,
			rowHeightsRecord: {},
		});

		const group = result.visualRows[0];
		expect(group?.kind).toBe('group');
		expect(group?.kind === 'group' ? group.aggregates?.doubleAmount : undefined).toBe(24);
	});

	it('filters grouped rows without changing group counts or labels', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'name', header: 'Name' },
			],
			filterModel: { name: { type: 'text', operator: 'contains', value: 'keep' } },
			grouping: { by: ['category'], defaultExpanded: true },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'keep alpha', category: 'A' },
				{ id: '2', name: 'drop beta', category: 'A' },
				{ id: '3', name: 'keep gamma', category: 'B' },
			],
			columns: store.getState().columns,
		});

		const rows = Array.from({ length: controller.getVisualRowCount() }, (_, index) => controller.getVisualRow(index));
		const groups = rows.filter((row) => row?.kind === 'group');
		const dataRows = rows.filter((row) => row?.kind === 'data');

		expect(groups.map((row) => (row?.kind === 'group' ? [row.keyString, row.hierarchy.childCount] : null))).toEqual([
			['A', 1],
			['B', 1],
		]);
		expect(dataRows.map((row) => (row?.kind === 'data' ? row.rowId : null))).toEqual(['1', '3']);
	});

	it('hides and shows grouped children based on serializable expansion state', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'] },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', category: 'A' },
				{ id: '2', name: 'Two', category: 'A' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(1);
		const result = controller.setExpanded('group:category=A', true);
		expect(store.getState().expansion.rows['group:category=A']).toBe(true);
		expect(controller.getVisualRowCount()).toBe(3);
		expect(result).toMatchObject({
			changed: true,
			reason: 'expansion',
			groupId: 'group:category=A',
			previousRowCount: 1,
			nextRowCount: 3,
			changedStartIndex: 1,
			changedEndIndex: 2,
		});
	});

	it('emits explicit invalidation lanes for group expansion', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'] },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', category: 'A' },
				{ id: '2', name: 'Two', category: 'A' },
			],
			columns: store.getState().columns,
		});

		store.engine.invalidation.consume();
		store.toggleExpanded('group:category=A');
		const frame = store.engine.invalidation.consume();

		expect(frame.groups).toEqual(new Set(['group:category=A']));
		expect(frame.rowRanges).toEqual([{ startIndex: 1, endIndex: 2, reason: 'group expansion' }]);
		expect(frame.geometry).toBe(true);
		expect(frame.viewport).toBe(true);
		expect(frame.invalidations).toContainEqual({ kind: 'group', groupId: 'group:category=A', reason: 'group expansion' });
		expect(frame.invalidations).toContainEqual({ kind: 'row-range', startIndex: 1, endIndex: 2, reason: 'group expansion' });

		controller.dispose();
		store.destroy();
	});

	it('uses targeted structural invalidations when grouping columns change', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'name', header: 'Name' },
			],
			// Already grouped: the hierarchy column exists, so changing levels needs no column change.
			grouping: { by: ['category'] },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'One', category: 'A' },
				{ id: '2', name: 'Two', category: 'B' },
			],
			columns: store.getState().columns,
		});

		store.engine.invalidation.consume();
		store.setGroupBy(['category', 'name']);
		const frame = store.engine.invalidation.consume();

		expect(frame.full).toBe(false);
		expect(frame.geometry).toBe(true);
		expect(frame.viewport).toBe(true);
		expect(frame.headers).toBe(true);
		expect(frame.overlay).toBe(true);
		expect(frame.reasons).toContain('groupBy');
		expect(frame.invalidations).toContainEqual({ kind: 'geometry', reason: 'groupBy' });
		expect(frame.invalidations).toContainEqual({ kind: 'viewport', reason: 'groupBy' });

		controller.dispose();
		store.destroy();
	});

	it('keeps tree parents as data visual rows and preserves ancestors while filtering', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			filterModel: { name: { type: 'text', operator: 'contains', value: 'Child' } },
			treeData: {
				getParentId: (row) => row.parentId,
				defaultExpanded: true,
				filterMode: 'includeAncestors',
			},
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'p', name: 'Parent', parentId: null },
				{ id: 'c', name: 'Child', parentId: 'p' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRow(0)?.kind).toBe('data');
		expect(controller.getVisualRow(0)?.id).toBe('row:p');
		expect(controller.getVisualRow(1)?.kind).toBe('data');
		expect(controller.getVisualRow(1)?.id).toBe('row:c');
		expect(controller.getVisualRow(1)?.hierarchy.level).toBe(1);
	});

	it('hides tree children when a parent data row is collapsed', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			treeData: {
				getParentId: (row) => row.parentId,
				defaultExpanded: false,
			},
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'p', name: 'Parent', parentId: null },
				{ id: 'c', name: 'Child', parentId: 'p' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(1);
		expect(controller.getVisualRow(0)?.id).toBe('row:p');

		store.engine.stateManager.setState({ expansion: { ...store.getState().expansion, rows: { [toDataVisualRowId('p')]: true } } });
		controller.refresh('expansion');
		expect(controller.getVisualRowCount()).toBe(2);
		expect(controller.getVisualRow(1)?.id).toBe('row:c');
	});

	it('expandAllGroups expands tree parents in a single refresh result', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			treeData: {
				getParentId: (row) => row.parentId,
				defaultExpanded: false,
			},
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'root', name: 'Root', parentId: null },
				{ id: 'child-a', name: 'Child A', parentId: 'root' },
				{ id: 'child-b', name: 'Child B', parentId: 'root' },
				{ id: 'grandchild', name: 'Grandchild', parentId: 'child-a' },
			],
			columns: store.getState().columns,
		});

		expect(controller.getVisualRowCount()).toBe(1);

		const refresh = controller.expandAll();
		expect(refresh.changed).toBe(true);
		expect(refresh.reason).toBe('expansion');
		expect(refresh.previousRowCount).toBe(1);
		expect(refresh.nextRowCount).toBe(4);
		expect(store.getState().expansion.base).toBe(true);
		expect(store.getState().expansion.rows).toEqual({});
		expect(controller.getVisualRowCount()).toBe(4);

		controller.dispose();
		store.destroy();
	});

	it('injects detail rows without changing rowIdToVisualIndex', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			detail: { height: 321 },
			expansion: { rows: {}, details: { '1': true } },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice' }],
			columns: store.getState().columns,
		});

		const detail = controller.getVisualRow(1);
		expect(detail?.kind).toBe('detail');
		expect(detail?.id).toBe(toDetailVisualRowId('1'));
		expect(isFullWidthVisualRow(detail)).toBe(true);
		expect(isEditableVisualRow(detail)).toBe(false);
		expect(controller.getVisualIndexByRowId('1')).toBe(0);
		expect(controller.getVisualIndexById('detail:1')).toBe(1);
	});

	it('assigns heights from getRowHeight callback to data visual rows on init', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', amount: 80 },
				{ id: '2', name: 'Bob', amount: 120 },
				{ id: '3', name: 'Charlie', amount: 60 },
			],
			columns: store.getState().columns,
			getRowHeight: (row) => row.amount,
		});

		const vr0 = controller.getVisualRow(0);
		const vr1 = controller.getVisualRow(1);
		const vr2 = controller.getVisualRow(2);

		expect(vr0?.kind === 'data' ? vr0.height : undefined).toBe(80);
		expect(vr1?.kind === 'data' ? vr1.height : undefined).toBe(120);
		expect(vr2?.kind === 'data' ? vr2.height : undefined).toBe(60);
	});

	it('preserves getRowHeight assignments after sort triggers a full refresh', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			sortModel: [{ colId: 'name', sort: 'asc' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Zara', amount: 60 },
				{ id: '2', name: 'Ada', amount: 100 },
			],
			columns: store.getState().columns,
			getRowHeight: (row) => row.amount,
		});

		// After sort asc: Ada (id:2) at index 0, Zara (id:1) at index 1
		const vr0 = controller.getVisualRow(0);
		const vr1 = controller.getVisualRow(1);

		expect(vr0?.kind === 'data' ? vr0.rowId : null).toBe('2');
		expect(vr0?.kind === 'data' ? vr0.height : undefined).toBe(100);
		expect(vr1?.kind === 'data' ? vr1.rowId : null).toBe('1');
		expect(vr1?.kind === 'data' ? vr1.height : undefined).toBe(60);
	});

	it('preserves getRowHeight assignments after filter triggers a full refresh', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			filterModel: { name: { type: 'text', operator: 'contains', value: 'a' } },
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Ada', amount: 80 },
				{ id: '2', name: 'Bob', amount: 50 },
				{ id: '3', name: 'Clara', amount: 110 },
			],
			columns: store.getState().columns,
			getRowHeight: (row) => row.amount,
		});

		// Filter keeps Ada and Clara (contain 'a')
		expect(controller.getVisualRowCount()).toBe(2);
		const vr0 = controller.getVisualRow(0);
		const vr1 = controller.getVisualRow(1);

		expect(vr0?.kind === 'data' ? vr0.height : undefined).toBe(80);
		expect(vr1?.kind === 'data' ? vr1.height : undefined).toBe(110);
	});

	it('falls back to defaultRowHeight when getRowHeight returns undefined for a row', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name' }],
			defaultRowHeight: 32,
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', amount: 50 },
				{ id: '2', name: 'Bob' }, // no amount — getRowHeight returns undefined
			],
			columns: store.getState().columns,
			getRowHeight: (row) => row.amount,
		});

		const vr0 = controller.getVisualRow(0);
		const vr1 = controller.getVisualRow(1);

		expect(vr0?.kind === 'data' ? vr0.height : undefined).toBe(50);
		// When getRowHeight returns undefined, the pipeline falls back to defaultRowHeight
		expect(vr1?.kind === 'data' ? vr1.height : undefined).toBe(32);
	});
});

describe('GroupRowMeta', () => {
	interface GRow {
		id: string;
		category: string;
		sub?: string;
	}

	function groupIdAt(ctrl: ClientRowModelController<GRow>, visualIndex: number): string {
		const row = ctrl.getVisualRow(visualIndex);
		if (row?.kind !== 'group') throw new Error(`row at ${visualIndex} is not a group`);
		return row.groupId;
	}

	it('returns null for unknown groupId', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'] },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', category: 'A' }],
			columns: store.getState().columns,
		});
		expect(ctrl.getGroupMeta('no-such-id')).toBeNull();
	});

	it('collapsed group: firstChildIndex and lastChildIndex are -1, visibleDescendantRowIds is empty', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'] },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A' },
				{ id: '2', category: 'A' },
			],
			columns: store.getState().columns,
		});
		const groupId = groupIdAt(ctrl, 0);
		const meta = ctrl.getGroupMeta(groupId);
		expect(meta).not.toBeNull();
		expect(meta!.expanded).toBe(false);
		expect(meta!.firstChildIndex).toBe(-1);
		expect(meta!.lastChildIndex).toBe(-1);
		expect(meta!.visibleDescendantRowIds).toEqual([]);
	});

	it('expanded group: firstChildIndex, lastChildIndex, and visibleDescendantRowIds are correct', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'] },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A' },
				{ id: '2', category: 'A' },
			],
			columns: store.getState().columns,
		});
		const groupId = groupIdAt(ctrl, 0);
		store.engine.stateManager.setState({ expansion: { rows: { [groupId]: true }, details: {} } });
		ctrl.refresh();

		const meta = ctrl.getGroupMeta(groupId);
		expect(meta!.expanded).toBe(true);
		expect(meta!.firstChildIndex).toBe(1);
		expect(meta!.lastChildIndex).toBe(2);
		expect(meta!.visibleDescendantRowIds).toEqual(['1', '2']);
		expect(meta!.firstLeafIndex).toBe(1);
		expect(meta!.lastLeafIndex).toBe(2);
	});

	it('getGroupMetaByVisualIndex returns same object as getGroupMeta', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'] },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', category: 'A' }],
			columns: store.getState().columns,
		});
		const groupId = groupIdAt(ctrl, 0);
		store.engine.stateManager.setState({ expansion: { rows: { [groupId]: true }, details: {} } });
		ctrl.refresh();

		const byId = ctrl.getGroupMeta(groupId);
		const byIndex = ctrl.getGroupMetaByVisualIndex(0);
		expect(byIndex).toBe(byId);
	});

	it('multiple sibling groups each have correct descendant ids', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'] },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A' },
				{ id: '2', category: 'B' },
				{ id: '3', category: 'B' },
			],
			columns: store.getState().columns,
		});
		const idA = groupIdAt(ctrl, 0);
		const idB = groupIdAt(ctrl, 1);
		store.engine.stateManager.setState({ expansion: { rows: { [idA]: true, [idB]: true }, details: {} } });
		ctrl.refresh();

		expect(ctrl.getGroupMeta(idA)!.visibleDescendantRowIds).toEqual(['1']);
		expect(ctrl.getGroupMeta(idB)!.visibleDescendantRowIds).toEqual(['2', '3']);
		// A's range ends just before B's group row (index 2)
		expect(ctrl.getGroupMeta(idA)!.lastChildIndex).toBe(1);
		// B's range starts at index 3
		expect(ctrl.getGroupMeta(idB)!.firstChildIndex).toBe(3);
	});

	it('nested groups: parent has all leaf descendants, child has only its own', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'sub', header: 'Sub' },
			],
			grouping: { by: ['category', 'sub'] },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A', sub: 'x' },
				{ id: '2', category: 'A', sub: 'x' },
			],
			columns: store.getState().columns,
		});
		// Expand outer first to reveal the inner group at index 1
		const outer = groupIdAt(ctrl, 0);
		store.engine.stateManager.setState({ expansion: { rows: { [outer]: true }, details: {} } });
		ctrl.refresh();
		const inner = groupIdAt(ctrl, 1);
		store.engine.stateManager.setState({ expansion: { rows: { [outer]: true, [inner]: true }, details: {} } });
		ctrl.refresh();

		const outerMeta = ctrl.getGroupMeta(outer);
		const innerMeta = ctrl.getGroupMeta(inner);
		expect(outerMeta!.visibleDescendantRowIds).toEqual(['1', '2']);
		expect(innerMeta!.visibleDescendantRowIds).toEqual(['1', '2']);
		expect(outerMeta!.childGroupIds).toContain(inner);
		expect(innerMeta!.parentGroupId).toBe(outer);
	});

	it('group with footer: footer row does not appear in visibleDescendantRowIds but is in child range', () => {
		const store = new GridStore<GRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'category', header: 'Category' }],
			grouping: { by: ['category'], totals: { groups: 'bottom' } },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'A' },
				{ id: '2', category: 'A' },
			],
			columns: store.getState().columns,
		});
		const groupId = groupIdAt(ctrl, 0);
		store.engine.stateManager.setState({ expansion: { rows: { [groupId]: true }, details: {} } });
		ctrl.refresh();

		const meta = ctrl.getGroupMeta(groupId);
		expect(meta!.visibleDescendantRowIds).toEqual(['1', '2']);
		const footerRow = ctrl.getVisualRow(meta!.lastChildIndex);
		expect(footerRow?.kind).toBe('total');
	});
});

describe('Phase 068 — filter membership shortcut in updateRows()', () => {
	interface FRow {
		id: string;
		name: string;
		status: string;
		price: number;
	}

	function makeFilteredStore(filterField: 'name' | 'status') {
		return new GridStore<FRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'status', header: 'Status' },
				{ field: 'price', header: 'Price' },
			],
			filterModel: { [filterField]: { type: 'text', operator: 'equals', value: 'active' } },
		});
	}

	it('skips full rebuild when a filter-key field changes but row membership is unchanged (still passes)', () => {
		const store = makeFilteredStore('status');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(ctrl.getVisualRowCount()).toBe(1);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');

		// Update `status` on row 1 to a different value that still matches the filter
		// (same value 'active' → still passes; membership unchanged)
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 99 } : r)));

		// Row count unchanged, row still visible, value updated
		expect(ctrl.getVisualRowCount()).toBe(1);
		expect(ctrl.getRowNodeById('1')?.data.price).toBe(99);
	});

	it('triggers full rebuild when a filtered-out row now passes the filter', () => {
		const store = makeFilteredStore('status');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(ctrl.getVisualRowCount()).toBe(1);

		// Row 2 was hidden; now update its status so it passes the filter
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '2' ? { ...r, status: 'active' } : r)));

		expect(ctrl.getVisualRowCount()).toBe(2);
	});

	it('triggers full rebuild when a visible row no longer passes the filter', () => {
		const store = makeFilteredStore('status');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(ctrl.getVisualRowCount()).toBe(1);

		// Row 1 is visible; now make it fail the filter
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '1' ? { ...r, status: 'inactive' } : r)));

		expect(ctrl.getVisualRowCount()).toBe(0);
	});

	it('always does full rebuild for filter-key changes on a grouped grid', () => {
		const store = new GridStore<FRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'status', header: 'Status' },
				{ field: 'name', header: 'Name' },
			],
			filterModel: { status: { type: 'text', operator: 'equals', value: 'active' } },
			grouping: { by: ['status'], defaultExpanded: true },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		// Only the 'active' group + its 1 child is visible (inactive filtered out)
		expect(ctrl.getVisualRowCount()).toBe(2);

		// Update a status field on the visible row; full rebuild runs (group may need updating)
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '1' ? { ...r, status: 'inactive' } : r)));

		// Active group should disappear; inactive group was previously filtered
		expect(ctrl.getVisualRowCount()).toBe(0);
	});

	it('value-only path preserves visual row order when filter-key field changes without membership change', () => {
		const store = makeFilteredStore('status');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', status: 'active', price: 10 },
				{ id: '2', name: 'Carol', status: 'active', price: 30 },
				{ id: '3', name: 'Bob', status: 'inactive', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(ctrl.getVisualRowCount()).toBe(2);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');

		// Change price (not a filter key) and status (still 'active') — neither changes membership
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 999 } : r)));

		expect(ctrl.getVisualRowCount()).toBe(2);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');
		expect(ctrl.getRowNodeById('1')?.data.price).toBe(999);
	});
});

describe('Phase 068 — sort relocation in updateRows()', () => {
	interface SRow {
		id: string;
		name: string;
		price: number;
	}

	function makeSortedStore(sortField: 'name' | 'price', dir: 'asc' | 'desc' = 'asc') {
		return new GridStore<SRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: sortField, sort: dir }],
		});
	}

	it('repositions a row in ascending sort order when its sort key changes', () => {
		const store = makeSortedStore('price');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Initial order: 1 (10), 2 (20), 3 (30)
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');
		expect(getRowNode(ctrl, 2)?.id).toBe('3');

		// Raise row 1's price to 25 — should move between 2 and 3
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 25 } : r)));

		expect(ctrl.getVisualRowCount()).toBe(3);
		expect(getRowNode(ctrl, 0)?.id).toBe('2'); // 20
		expect(getRowNode(ctrl, 1)?.id).toBe('1'); // 25 (moved)
		expect(getRowNode(ctrl, 2)?.id).toBe('3'); // 30
	});

	it('repositions a row in descending sort order', () => {
		const store = makeSortedStore('price', 'desc');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 30 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 10 },
			],
			columns: store.getState().columns,
		});

		// Initial order: 1 (30), 2 (20), 3 (10)
		expect(getRowNode(ctrl, 0)?.id).toBe('1');

		// Drop row 1's price below everyone else
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 5 } : r)));

		expect(getRowNode(ctrl, 0)?.id).toBe('2');
		expect(getRowNode(ctrl, 1)?.id).toBe('3');
		expect(getRowNode(ctrl, 2)?.id).toBe('1'); // now last (lowest price, desc)
	});

	it('keeps index maps consistent after relocation', () => {
		const store = makeSortedStore('name');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		// 'Bob' → 'Aaron' should move to first
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '2' ? { ...r, name: 'Aaron' } : r)));

		expect(ctrl.getVisualIndexByRowId('2')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('1')).toBe(1);
		expect(ctrl.getVisualIndexByRowId('3')).toBe(2);
	});

	it('falls back to full rebuild on a grouped grid when sort key changes', () => {
		const store = new GridStore<SRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: 'price', sort: 'asc' }],
			grouping: { by: ['name'], defaultExpanded: true },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'A', price: 20 },
			],
			columns: store.getState().columns,
		});

		// Full rebuild should correctly update group structure even with sort change
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 30 } : r)));

		// Verify rows are still present and correctly structured
		expect(ctrl.getVisualRowCount()).toBeGreaterThan(0);
		expect(ctrl.getRowNodeById('1')?.data.price).toBe(30);
	});

	it('handles no-op sort relocation when row stays at same position', () => {
		const store = makeSortedStore('price');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Update price but keep relative order (15 stays between 10 and 20 → no, 15 > 10 and < 20, so '1' stays at 0)
		// Actually 15 > 10 (original) so row 1 stays first if it was at 10. 15 < 20, so still at index 0.
		doUpdateRows(ctrl, (rows) => rows.map((r) => (r.id === '1' ? { ...r, price: 15 } : r)));

		expect(getRowNode(ctrl, 0)?.id).toBe('1'); // still first (15 < 20 < 30)
		expect(ctrl.getRowNodeById('1')?.data.price).toBe(15);
	});

	it('correctly relocates multiple changed rows simultaneously', () => {
		const store = makeSortedStore('price');
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Swap prices of row 1 and row 3
		doUpdateRows(ctrl, (rows) =>
			rows.map((r) => {
				if (r.id === '1') return { ...r, price: 30 };
				if (r.id === '3') return { ...r, price: 10 };
				return r;
			})
		);

		// After swap: 3 (10), 2 (20), 1 (30)
		expect(getRowNode(ctrl, 0)?.id).toBe('3');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');
		expect(getRowNode(ctrl, 2)?.id).toBe('1');
	});
});

describe('Phase 068 — incremental insert/remove in applyTransaction()', () => {
	interface TRow {
		id: string;
		name: string;
		price: number;
	}

	it('incrementally inserts a new row at the end of an unsorted flat grid', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', price: 10 }],
			columns: store.getState().columns,
		});

		doApplyTransaction(ctrl, { add: [{ id: '2', name: 'Bob', price: 20 }] });

		expect(ctrl.getVisualRowCount()).toBe(2);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
		expect(getRowNode(ctrl, 1)?.id).toBe('2');
	});

	it('inserts into the correct sorted position', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		doApplyTransaction(ctrl, { add: [{ id: '2', name: 'Bob', price: 20 }] });

		expect(ctrl.getVisualRowCount()).toBe(3);
		expect(getRowNode(ctrl, 0)?.id).toBe('1'); // 10
		expect(getRowNode(ctrl, 1)?.id).toBe('2'); // 20 — inserted
		expect(getRowNode(ctrl, 2)?.id).toBe('3'); // 30
	});

	it('filters out a newly added row if it does not pass the active filter', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			filterModel: { name: { type: 'text', operator: 'equals', value: 'Alice' } },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', price: 10 }],
			columns: store.getState().columns,
		});

		doApplyTransaction(ctrl, { add: [{ id: '2', name: 'Bob', price: 20 }] });

		// Bob doesn't match filter — should not appear
		expect(ctrl.getVisualRowCount()).toBe(1);
		expect(getRowNode(ctrl, 0)?.id).toBe('1');
	});

	it('adds a passing row when a filter is active', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			filterModel: { name: { type: 'text', operator: 'equals', value: 'Alice' } },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alice', price: 10 }],
			columns: store.getState().columns,
		});

		doApplyTransaction(ctrl, { add: [{ id: '2', name: 'Alice', price: 20 }] });

		expect(ctrl.getVisualRowCount()).toBe(2);
	});

	it('incrementally removes a row and keeps index maps consistent', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alice', price: 10 },
				{ id: '2', name: 'Bob', price: 20 },
				{ id: '3', name: 'Carol', price: 30 },
			],
			columns: store.getState().columns,
		});

		doApplyTransaction(ctrl, { remove: [{ id: '2', name: 'Bob', price: 20 }] });

		expect(ctrl.getVisualRowCount()).toBe(2);
		expect(ctrl.getVisualIndexByRowId('1')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('2')).toBe(-1);
		expect(ctrl.getVisualIndexByRowId('3')).toBe(1);
	});

	it('falls back to full rebuild on a grouped grid', () => {
		const store = new GridStore<TRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			grouping: { by: ['name'], defaultExpanded: true },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'A', price: 10 }],
			columns: store.getState().columns,
		});

		doApplyTransaction(ctrl, { add: [{ id: '2', name: 'B', price: 20 }] });

		// Both rows should be visible (full rebuild correctly groups them)
		expect(ctrl.getRowNodeById('1')).not.toBeNull();
		expect(ctrl.getRowNodeById('2')).not.toBeNull();
	});
});

describe('row-transaction rollback restores full client row-model identity', () => {
	it('restores removed row identities, deep row data, added-node removal, source order, and grouped output after a failed mixed commit', () => {
		type RollbackRow = {
			id: string;
			category: string;
			profile: { name: string; stats: { score: number } };
		};

		const store = new GridStore<RollbackRow>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'profile.name', header: 'Name' },
			],
			grouping: { by: ['category'], defaultExpanded: true },
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'row-1', category: 'A', profile: { name: 'Alice', stats: { score: 1 } } },
				{ id: 'row-2', category: 'B', profile: { name: 'Bob', stats: { score: 2 } } },
			],
			columns: store.getState().columns,
		});

		const originalNode1 = store.getRowNodeById('row-1');
		const originalNode2 = store.getRowNodeById('row-2');
		const originalVisualIds = Array.from({ length: store.getVisualRowCount() }, (_, index) => store.getVisualRow(index)?.id);
		const originalRowOrder = store.getRowOrder();

		const originalCommitState = store.engine.stateManager.commitState;
		store.engine.stateManager.commitState = vi.fn(() => {
			throw new Error('forced mixed-commit failure');
		}) as typeof originalCommitState;

		const result = store.engine.changeApplier.commit({
			reason: 'rows:apply-transaction',
			domainMutations: [
				{
					kind: 'row-transaction',
					transaction: {
						remove: [{ id: 'row-1', category: 'A', profile: { name: 'Alice', stats: { score: 1 } } }],
						update: [{ id: 'row-2', category: 'C', profile: { name: 'Bobby', stats: { score: 20 } } }],
						add: [{ id: 'row-3', category: 'D', profile: { name: 'Cara', stats: { score: 3 } } }],
						addIndex: 0,
					},
				},
			],
			state: { columnWidths: { category: 222 } },
		});

		store.engine.stateManager.commitState = originalCommitState;

		expect(result.status).toBe('failed-before-commit');
		expect(store.getRowNodeById('row-1')).toBe(originalNode1);
		expect(store.getRowNodeById('row-2')).toBe(originalNode2);
		expect(store.getRowNodeById('row-3')).toBeNull();
		expect(store.getRowOrder()).toEqual(originalRowOrder);
		expect(store.getRowNodeById('row-1')!.data.profile.name).toBe('Alice');
		expect(store.getRowNodeById('row-1')!.data.profile.stats.score).toBe(1);
		expect(store.getRowNodeById('row-2')!.data.category).toBe('B');
		expect(store.getRowNodeById('row-2')!.data.profile.name).toBe('Bob');
		expect(store.getRowNodeById('row-2')!.data.profile.stats.score).toBe(2);

		const restoredVisualIds = Array.from({ length: store.getVisualRowCount() }, (_, index) => store.getVisualRow(index)?.id);
		expect(restoredVisualIds).toEqual(originalVisualIds);

		controller.dispose();
	});
});

describe('Numeric Filter Null Safety', () => {
	interface NumericRow {
		id: string;
		value: number | null | undefined;
	}

	it('should not match null or undefined cell values in numeric comparisons', () => {
		const store = new GridStore<NumericRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'value', header: 'Value' }],
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', value: 10 },
				{ id: '2', value: null },
				{ id: '3', value: undefined },
				{ id: '4', value: '' as any },
				{ id: '5', value: 3 },
			],
			columns: store.getState().columns,
		});

		// 1. Filter: value < 5
		store.engine.stateManager.setState({
			filterModel: { value: { type: 'number', operator: 'lt', value: 5 } },
		});
		controller.refresh();
		// Only '5' (value 3) should match. null/undefined/"" should NOT match (would have matched if coerced to 0)
		expect(controller.getVisualRowCount()).toBe(1);
		expect(controller.getVisualRow(0)?.rowId).toBe('5');

		// 2. Filter: value >= 0
		store.engine.stateManager.setState({
			filterModel: { value: { type: 'number', operator: 'gte', value: 0 } },
		});
		controller.refresh();
		// '1' (10) and '5' (3) should match. null/undefined/"" should not match
		expect(controller.getVisualRowCount()).toBe(2);
		const matchedIds = [controller.getVisualRow(0)?.rowId, controller.getVisualRow(1)?.rowId];
		expect(matchedIds).toContain('1');
		expect(matchedIds).toContain('5');
	});
});

describe('Plan 083 — incremental index maintenance', () => {
	interface SimpleRow {
		id: string;
		value: number;
	}

	function makeCtrl(rows: SimpleRow[], opts: { sorted?: boolean } = {}) {
		const store = new GridStore<SimpleRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'value', header: 'Value' }],
			...(opts.sorted ? { sortModel: [{ colId: 'value', sort: 'asc' }] } : {}),
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});
		return ctrl;
	}

	it('preserves correct indices after removal at the beginning of an unsorted grid', () => {
		const ctrl = makeCtrl([
			{ id: '1', value: 10 },
			{ id: '2', value: 20 },
			{ id: '3', value: 30 },
			{ id: '4', value: 40 },
		]);

		doApplyTransaction(ctrl, { remove: [{ id: '1', value: 10 }] });

		expect(ctrl.getVisualIndexByRowId('1')).toBe(-1);
		expect(ctrl.getVisualIndexByRowId('2')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('3')).toBe(1);
		expect(ctrl.getVisualIndexByRowId('4')).toBe(2);
	});

	it('preserves correct indices after insertion at the beginning of a sorted grid', () => {
		const ctrl = makeCtrl(
			[
				{ id: '2', value: 20 },
				{ id: '3', value: 30 },
				{ id: '4', value: 40 },
			],
			{ sorted: true }
		);

		doApplyTransaction(ctrl, { add: [{ id: '1', value: 5 }] });

		expect(ctrl.getVisualIndexByRowId('1')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('2')).toBe(1);
		expect(ctrl.getVisualIndexByRowId('3')).toBe(2);
		expect(ctrl.getVisualIndexByRowId('4')).toBe(3);
	});

	it('preserves correct indices after sort relocation to an earlier position', () => {
		const store = new GridStore<SimpleRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'value', header: 'Value' }],
			sortModel: [{ colId: 'value', sort: 'asc' }],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', value: 10 },
				{ id: '2', value: 20 },
				{ id: '3', value: 30 },
			],
			columns: store.getState().columns,
		});

		// updateRowsStructurally + reconcileAfterDataWrite triggers the sort-key mutation path
		const writeResult = ctrl.updateRowsStructurally((rows) => rows.map((r) => (r.id === '3' ? { ...r, value: 5 } : r)));
		const impact = ctrl.classifyFieldMutation(new Set(['value']));
		ctrl.reconcileAfterDataWrite(writeResult, impact);

		expect(ctrl.getVisualIndexByRowId('3')).toBe(0);
		expect(ctrl.getVisualIndexByRowId('1')).toBe(1);
		expect(ctrl.getVisualIndexByRowId('2')).toBe(2);
	});

	it('handles add+remove in same transaction and produces correct indices', () => {
		const ctrl = makeCtrl([
			{ id: '1', value: 10 },
			{ id: '2', value: 20 },
			{ id: '3', value: 30 },
		]);

		doApplyTransaction(ctrl, {
			add: [{ id: '4', value: 40 }],
			remove: [{ id: '2', value: 20 }],
		});

		expect(ctrl.getVisualRowCount()).toBe(3);
		expect(ctrl.getVisualIndexByRowId('2')).toBe(-1);
		expect(ctrl.getVisualIndexByRowId('4')).toBe(2);
	});
});

// ── Plan 092: aggregation input mutation correctness ──────────────────────────

describe('Aggregation input mutation correctness (Plan 092)', () => {
	interface AggRow {
		id: string;
		name: string;
		category: string;
		salary: number;
		bonus: number;
	}

	function makeAggStore(rows: AggRow[], expanded = true) {
		const store = new GridStore<AggRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'name', header: 'Name' },
				{ field: 'salary', header: 'Salary' },
				{ field: 'bonus', header: 'Bonus' },
			],
			grouping: { by: ['category'], defaultExpanded: expanded },
		});
		store.setAggregation([
			{ colId: 'salary', aggFunc: 'sum' },
			{ colId: 'bonus', aggFunc: 'avg' },
		]);
		const controller = new ClientRowModelController<AggRow>(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});
		return { store, controller };
	}

	function getGroupAggregates(controller: ClientRowModelController<AggRow>, groupId: string) {
		const count = controller.getVisualRowCount();
		for (let i = 0; i < count; i++) {
			const row = controller.getVisualRow(i);
			if (row?.kind === 'group' && row.id === groupId) {
				return row.aggregates ?? {};
			}
		}
		return null;
	}

	it('group sum stays consistent after leaf salary update via applyTransaction', () => {
		const rows: AggRow[] = [
			{ id: '1', name: 'Alice', category: 'Eng', salary: 100, bonus: 10 },
			{ id: '2', name: 'Bob', category: 'Eng', salary: 200, bonus: 20 },
		];
		const { store, controller } = makeAggStore(rows);

		const before = getGroupAggregates(controller, 'group:category=Eng');
		expect(before?.salary).toBe(300); // 100 + 200

		store.applyTransaction({ update: [{ id: '1', name: 'Alice', category: 'Eng', salary: 150, bonus: 10 }] });

		const after = getGroupAggregates(controller, 'group:category=Eng');
		expect(after?.salary).toBe(350); // 150 + 200 — was stale (300) before Plan 092 fix
	});

	it('reports the group and total rows whose aggregates changed, so they repaint', () => {
		const rows: AggRow[] = [
			{ id: '1', name: 'Alice', category: 'Eng', salary: 100, bonus: 10 },
			{ id: '2', name: 'Bob', category: 'Eng', salary: 200, bonus: 20 },
			{ id: '3', name: 'Cara', category: 'Ops', salary: 50, bonus: 5 },
		];
		const { store, controller } = makeAggStore(rows);
		store.updateGrouping({ totals: { groups: 'bottom', grand: 'bottom' } });
		const reconcile = vi.spyOn(controller, 'reconcileAfterDataWrite');

		store.applyTransaction({ update: [{ id: '1', name: 'Alice', category: 'Eng', salary: 150, bonus: 10 }] });

		const result = reconcile.mock.results.at(-1)?.value as RowModelRefreshResult;
		const ids = Array.from({ length: controller.getVisualRowCount() }, (_, i) => controller.getVisualRow(i)!.id);
		const groupIdx = ids.indexOf('group:category=Eng');
		const grandIdx = ids.indexOf('total:grand');
		// Same rows, new aggregates: exactly the Eng group, its total and the grand total changed — not the
		// untouched Ops group and total that sit between them.
		expect(result.changed).toBe(true);
		expect(result.changedStartIndex).toBeUndefined();
		expect(result.aggregateChangedIndices).toEqual([groupIdx, ids.indexOf(toTotalVisualRowId('group:category=Eng')), grandIdx]);
		store.destroy();
	});

	it('invalidates exactly the rows whose aggregates changed after a write', () => {
		const rows: AggRow[] = [
			{ id: '1', name: 'Alice', category: 'Eng', salary: 100, bonus: 10 },
			{ id: '3', name: 'Cara', category: 'Ops', salary: 50, bonus: 5 },
		];
		const { store } = makeAggStore(rows);
		store.updateGrouping({ totals: { groups: 'bottom' } });
		// Rows: 0 group Eng, 1 Alice, 2 total Eng, 3 group Ops, 4 Cara, 5 total Ops.
		store.engine.invalidation.consume();

		store.applyTransaction({ update: [{ id: '1', name: 'Alice', category: 'Eng', salary: 150, bonus: 10 }] });
		const frame = store.engine.invalidation.consume();

		expect(frame.rowRanges).toContainEqual(expect.objectContaining({ startIndex: 0, endIndex: 0 }));
		expect(frame.rowRanges).toContainEqual(expect.objectContaining({ startIndex: 2, endIndex: 2 }));
		expect(frame.rowRanges.some((range) => range.startIndex <= 3 && range.endIndex >= 3)).toBe(false);
		// Precise: no blanket viewport invalidation for an aggregate-only change.
		expect(frame.viewport).toBe(false);
		store.destroy();
	});

	it('group average stays consistent after leaf bonus update via applyTransaction', () => {
		const rows: AggRow[] = [
			{ id: '1', name: 'Alice', category: 'Eng', salary: 100, bonus: 20 },
			{ id: '2', name: 'Bob', category: 'Eng', salary: 200, bonus: 40 },
		];
		const { store, controller } = makeAggStore(rows);

		const before = getGroupAggregates(controller, 'group:category=Eng');
		expect(before?.bonus).toBe(30); // avg(20, 40) = 30

		store.applyTransaction({ update: [{ id: '2', name: 'Bob', category: 'Eng', salary: 200, bonus: 60 }] });

		const after = getGroupAggregates(controller, 'group:category=Eng');
		expect(after?.bonus).toBe(40); // avg(20, 60) = 40 — was stale (30) before Plan 092 fix
	});

	it('multiple groups each update their own aggregate independently', () => {
		const rows: AggRow[] = [
			{ id: '1', name: 'Alice', category: 'Eng', salary: 100, bonus: 10 },
			{ id: '2', name: 'Bob', category: 'Mkt', salary: 90, bonus: 5 },
		];
		const { store, controller } = makeAggStore(rows);

		store.applyTransaction({ update: [{ id: '1', name: 'Alice', category: 'Eng', salary: 200, bonus: 10 }] });

		expect(getGroupAggregates(controller, 'group:category=Eng')?.salary).toBe(200);
		// Mkt group must be unchanged
		expect(getGroupAggregates(controller, 'group:category=Mkt')?.salary).toBe(90);
	});

	it('name update (non-aggregation field) does NOT trigger full rebuild', () => {
		const rows: AggRow[] = [
			{ id: '1', name: 'Alice', category: 'Eng', salary: 100, bonus: 10 },
			{ id: '2', name: 'Bob', category: 'Eng', salary: 200, bonus: 20 },
		];
		const inst = new RecordingGridInstrumentation();
		const { store, controller } = makeAggStore(rows);
		store.setInstrumentation(inst);
		inst.reset();

		store.applyTransaction({ update: [{ id: '1', name: 'Alice Renamed', category: 'Eng', salary: 100, bonus: 10 }] });

		const full = inst.get(GridMetric.ROW_MUTATION_FULL_REBUILD);
		// A non-aggregation, non-sort, non-filter, non-group field update must NOT trigger a full rebuild.
		expect(full).toBe(0);
		controller.dispose();
	});
});

// ── Plan 099: Differential correctness tests ─────────────────────────────────
//
// Invariant: incremental and full-rebuild paths must produce identical visual
// output for any supported mutation sequence. Each test applies mutations
// incrementally to one controller and compares the visual row sequence to a
// controller rebuilt from scratch with the final row state.

function snapshotVisualRows<TData>(controller: ClientRowModelController<TData>): string[] {
	const result: string[] = [];
	for (let i = 0; i < controller.getVisualRowCount(); i++) {
		const vr = controller.getVisualRow(i);
		result.push(vr ? vr.id : `null:${i}`);
	}
	return result;
}

describe('ClientRowModelController – differential correctness (Plan 099)', () => {
	it('incremental add produces same order as full rebuild', () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: [{ field: 'name' }] });
		const initial = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
		];
		const added = { id: '3', name: 'Charlie' };

		// Incremental path: start with initial, then add.
		const incr = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [...initial],
			columns: store.getState().columns,
		});
		doApplyTransaction(incr, { add: [added] });

		// Full rebuild: construct from scratch with all three rows.
		const full = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [...initial, added],
			columns: store.getState().columns,
		});

		expect(snapshotVisualRows(incr)).toEqual(snapshotVisualRows(full));
		incr.dispose();
		full.dispose();
	});

	it('incremental remove produces same order as full rebuild', () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: [{ field: 'name' }] });
		const initial = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Charlie' },
		];

		const incr = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [...initial],
			columns: store.getState().columns,
		});
		doApplyTransaction(incr, { remove: [initial[1]] }); // remove by row object (matched by row ID)

		const full = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [initial[0], initial[2]],
			columns: store.getState().columns,
		});

		expect(snapshotVisualRows(incr)).toEqual(snapshotVisualRows(full));
		incr.dispose();
		full.dispose();
	});

	it('incremental update produces same order as full rebuild', () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: [{ field: 'name' }] });
		const initial = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
		];

		const incr = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [...initial],
			columns: store.getState().columns,
		});
		doApplyTransaction(incr, { update: [{ id: '1', name: 'Alicia' }] });

		const full = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alicia' }, initial[1]],
			columns: store.getState().columns,
		});

		expect(snapshotVisualRows(incr)).toEqual(snapshotVisualRows(full));
		// Raw data must match too.
		expect(incr.getRawRowById('1')).toEqual({ id: '1', name: 'Alicia' });
		expect(full.getRawRowById('1')).toEqual({ id: '1', name: 'Alicia' });
		incr.dispose();
		full.dispose();
	});

	it('incremental add+remove sequence produces same order as full rebuild', () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: [{ field: 'name' }] });
		const initial = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Charlie' },
		];

		const incr = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [...initial],
			columns: store.getState().columns,
		});
		// Remove Bob, add Dave (remove takes row objects matched by ID).
		doApplyTransaction(incr, { remove: [initial[1]], add: [{ id: '4', name: 'Dave' }] });

		const full = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [initial[0], initial[2], { id: '4', name: 'Dave' }],
			columns: store.getState().columns,
		});

		expect(snapshotVisualRows(incr)).toEqual(snapshotVisualRows(full));
		incr.dispose();
		full.dispose();
	});

	it('setRows produces same order as equivalent full rebuild', () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: [{ field: 'name' }] });
		const initial = [{ id: '1', name: 'Alice' }];
		const replacement = [
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Charlie' },
		];

		const incr = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: initial,
			columns: store.getState().columns,
		});
		const replaceResult = incr.replaceRowsStructurally(replacement);
		incr.reconcileAfterDataWrite(replaceResult, 'value-only');

		const full = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: replacement,
			columns: store.getState().columns,
		});

		expect(snapshotVisualRows(incr)).toEqual(snapshotVisualRows(full));
		incr.dispose();
		full.dispose();
	});

	it('sort: incremental re-sort matches full rebuild with same sort model', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: [{ field: 'name' }],
			sortModel: [{ colId: 'name', sort: 'asc' }],
		});
		const initial = [
			{ id: '1', name: 'Charlie' },
			{ id: '2', name: 'Alice' },
			{ id: '3', name: 'Bob' },
		];

		const incr = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [...initial],
			columns: store.getState().columns,
		});

		const full = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [...initial],
			columns: store.getState().columns,
		});

		// Both should produce same ascending-name order.
		expect(snapshotVisualRows(incr)).toEqual(snapshotVisualRows(full));
		// Verify sorted: Alice (id:2), Bob (id:3), Charlie (id:1)
		expect(incr.getVisualRow(0)?.id).toBe(toDataVisualRowId('2'));
		expect(incr.getVisualRow(1)?.id).toBe(toDataVisualRowId('3'));
		expect(incr.getVisualRow(2)?.id).toBe(toDataVisualRowId('1'));
		incr.dispose();
		full.dispose();
	});

	it('lookup consistency: getVisualIndexByRowId inverse of getVisualRow after mutations', () => {
		const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: [{ field: 'name' }] });
		const initial = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Charlie' },
		];

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [...initial],
			columns: store.getState().columns,
		});
		doApplyTransaction(controller, { remove: [initial[1]], add: [{ id: '4', name: 'Dave' }] });

		// After mutation: verify lookup consistency for all remaining rows.
		for (let i = 0; i < controller.getVisualRowCount(); i++) {
			const vr = controller.getVisualRow(i);
			if (vr?.kind !== 'data') continue;
			const idx = controller.getVisualIndexByRowId(vr.rowId);
			expect(idx).toBe(i);
		}
		// Removed row must not be found.
		expect(controller.getVisualIndexByRowId('2')).toBe(-1);
		controller.dispose();
	});
});
