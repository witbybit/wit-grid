import { describe, it, expect, vi } from 'vitest';
import { GridStore, GridEventName, validateColumns, validateRowIds } from './store.js';
import { ClientRowModelController } from './rowModel.js';
import { InfiniteRowModelController, type InfiniteDatasource } from './infiniteRowModel.js';
import { ServerSideRowModelController } from './serverSideRowModel.js';
import type { ServerSideDatasource, ServerSideRefreshOptions, ServerSideStoreSnapshot } from './serverSideRowModel.js';
import { GRID_STATE_SCHEMA_VERSION } from './persistence/statePersistence.js';
import type { ActiveEditState, ColumnDef } from './api/GridApi.js';
import type { GridQueryModel } from './query/GridQueryModel.js';
import { createMinimalRowModel } from './testUtils/createMinimalRowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

describe('GridStore generic row-store functionality', () => {
	it('should initialize with standard default states', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const state = store.getState();
		const rowModel = store.getRowModel()!;

		expect(store.getVisualRowCount()).toBe(2);
		expect(state.columns).toHaveLength(2);
		expect(state.selection.focus).toBeNull();
		expect(state.selection.range).toBeNull();

		controller.dispose();
	});

	it('should expose targeted subscriptions for viewport, selection, editing, cells, rows, columns, and headers', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const viewport = vi.fn();
		const selection = vi.fn();
		const editing = vi.fn();
		const cell = vi.fn();
		const row = vi.fn();
		const column = vi.fn();
		const headers = vi.fn();

		const unsubscribers = [
			store.subscribeToViewport(viewport),
			store.subscribeToSelection(selection),
			store.subscribeToEditingCell(editing),
			store.subscribeToCell('1', 'name', cell),
			store.subscribeToRow('1', row),
			store.subscribeToColumn('name', column),
			store.subscribeToHeaders(headers),
		];

		store.selectCell({ rowId: '1', colField: 'name' });
		store.startEditing('1', 'name');
		store.setCellValue('1', 'name', 'Product A+');
		store.flushCellUpdatesSync();
		store.setColumnWidth('name', 180);
		store.setRowHeight('row:1', 60);
		store.setViewportSize(20, 20);
		store.updateVisibleRanges();

		expect(selection).toHaveBeenCalled();
		expect(editing).toHaveBeenCalled();
		expect(cell).toHaveBeenCalled();
		expect(row).toHaveBeenCalled();
		expect(column).toHaveBeenCalled();
		expect(headers).toHaveBeenCalled();
		expect(viewport).toHaveBeenCalled();

		unsubscribers.forEach((unsubscribe) => unsubscribe());
		controller.dispose();
		store.destroy();
	});

	it('tracks focusOrigin and increments selection version as focus moves', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name' }, 'keyboard');
		const first = store.getState().selection;
		store.selectCell({ rowId: '2', colField: 'name' }, 'pointer');
		const second = store.getState().selection;

		expect(first.focusOrigin).toBe('keyboard');
		expect(first.version).toBeGreaterThan(0);
		expect(second.focusOrigin).toBe('pointer');
		expect(second.version ?? 0).toBeGreaterThan(first.version ?? 0);

		controller.dispose();
		store.destroy();
	});

	it('keeps internal interaction state synchronized with focus, edit, and row selection', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			getRowId: (row) => row.id,
			rowSelection: { mode: 'multiple' },
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name' }, 'keyboard');
		store.startEditing('1', 'name');
		store.selectRows(['1']);

		const state = store.getState();
		expect(state.interaction?.focus.cell).toEqual(state.selection.focus);
		expect(state.interaction?.focus.rowIndex).toBe(0);
		expect(state.interaction?.focus.origin).toBe('keyboard');
		expect(state.interaction?.focus.version).toBe(state.selection.version ?? 0);
		expect(state.interaction?.cellSelection.selection.focus).toEqual(state.selection.focus);
		expect(state.interaction?.activeEdit.active).toBe(state.activeEdit);
		expect(state.interaction?.rowSelection.selectedRowIds).toBe(state.selectedRowIds);

		controller.dispose();
		store.destroy();
	});

	it('keeps interaction focus rowIndex synchronized after structural row reordering', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Bravo', price: 10 },
				{ id: '2', name: 'Alpha', price: 20 },
			],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name' }, 'keyboard');
		expect(store.getState().interaction?.focus.rowIndex).toBe(0);

		store.setSortModel([{ colId: 'name', sort: 'asc' }]);

		expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: '1', colField: 'name' }));
		expect(store.getState().interaction?.focus.rowIndex).toBe(1);

		controller.dispose();
		store.destroy();
	});

	it('canonicalizes interaction focus identity for duplicate-field runtime selection', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name A', width: 150, colId: 'name-a' },
				{ field: 'name', header: 'Name B', width: 150, colId: 'name-b' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name', colId: 'name-b' }, 'api');

		expect(store.getState().interaction?.focus.cell).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: expect.any(String),
			})
		);

		controller.dispose();
		store.destroy();
	});

	it('suppresses unrelated selector wakeups for row, column, and integrity subscriptions', () => {
		const store = new GridStore<TestRow>(
			{
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{ field: 'name', header: 'Name', width: 150 },
				],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						cellRules: [{ id: 'required-name', field: 'name', validate: ({ value }) => (value ? null : { message: 'required' }) }],
					},
				},
			}
		);
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const row = vi.fn();
		const column = vi.fn();
		const headers = vi.fn();
		const integrity = vi.fn();
		const selector = vi.fn();

		const unsubscribers = [
			store.subscribeToRow('1', row),
			store.subscribeToColumn('name', column),
			store.subscribeToHeaders(headers),
			store.subscribeToIntegrity(integrity),
			store.subscribeToSnapshotSelector(['selection'], (snapshot) => snapshot.selection.focus?.rowId ?? null, selector),
		];

		store.setCellValue('2', 'name', 'Product B+');
		store.flushCellUpdatesSync();
		store.setRowHeight('row:2', 60);
		store.setColumnWidth('id', 80);
		store.selectCell({ rowId: '1', colField: 'name' });

		expect(row).not.toHaveBeenCalled();
		expect(column).not.toHaveBeenCalled();
		expect(headers).toHaveBeenCalledTimes(1);
		expect(integrity).not.toHaveBeenCalled();
		expect(selector).toHaveBeenCalledTimes(1);

		store.integrity.publishIssues('system', [
			{
				id: 'integrity:system:1',
				source: 'system',
				type: 'custom',
				severity: 'warning',
				message: 'review',
				createdAt: Date.now(),
			},
		]);

		expect(integrity).toHaveBeenCalledTimes(1);

		unsubscribers.forEach((unsubscribe) => unsubscribe());
		controller.dispose();
		store.destroy();
	});

	it("notifies a row subscription only for that row's committed cell changes", () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const firstRow = vi.fn();
		const secondRow = vi.fn();
		const unsubscribeFirst = store.subscribeToRow('1', firstRow);
		const unsubscribeSecond = store.subscribeToRow('2', secondRow);

		store.setCellValue('1', 'name', 'Product A+');
		store.flushCellUpdatesSync();

		expect(firstRow).toHaveBeenCalledTimes(1);
		expect(secondRow).not.toHaveBeenCalled();

		unsubscribeFirst();
		unsubscribeSecond();
		controller.dispose();
		store.destroy();
	});

	it('executes a sync valueSetter exactly once for a direct cell write', () => {
		const valueSetter = vi.fn(({ row, value }) => {
			row.name = `${String(value)} accepted`;
			return true;
		});
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150, valueSetter },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const result = store.setCellValue('1', 'name', 'Product Updated');
		store.flushCellUpdatesSync();

		expect(result.status).toBe('applied');
		expect(valueSetter).toHaveBeenCalledTimes(1);
		expect((store as any).engine.getRawCellValue('1', 'name')).toBe('Product Updated accepted');

		controller.dispose();
		store.destroy();
	});

	it('rejects a sync valueSetter write without mutating data or history', () => {
		const valueSetter = vi.fn(() => false);
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150, valueSetter },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const result = store.setCellValue('1', 'name', 'Rejected');
		store.flushCellUpdatesSync();

		expect(result).toEqual({
			status: 'rejected',
			reason: 'value setter rejected change',
			rejections: [{ mutationKind: 'cell-value', reason: 'value setter rejected change', index: undefined }],
		});
		expect(valueSetter).toHaveBeenCalledTimes(1);
		expect((store as any).engine.getRawCellValue('1', 'name')).toBe('Product A');
		expect(store.canUndo()).toBe(false);

		controller.dispose();
		store.destroy();
	});

	it('returns noop for unchanged direct writes', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const result = store.setCellValue('1', 'name', 'Product A');

		expect(result).toEqual({ status: 'noop' });
		expect(store.canUndo()).toBe(false);

		controller.dispose();
		store.destroy();
	});

	it('surfaces failed-before-commit writes as failed results', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});
		const applySpy = vi.spyOn(store.engine.dataMutation, 'applyCellValueChange').mockImplementation(() => {
			throw new Error('boom');
		});

		const result = store.setCellValue('1', 'name', 'Broken');

		expect(result.status).toBe('failed');
		expect(result.error.message).toBe('boom');
		expect(store.getCellValue('1', 'name')).toBe('Product A');

		applySpy.mockRestore();
		controller.dispose();
		store.destroy();
	});

	it('setCellValue returns validationFailed for blocking sync proposal rules', () => {
		const store = new GridStore<TestRow>(
			{
				columns: [{ field: 'name', header: 'Name', width: 150 }],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						validateOnSubmit: true,
						cellRules: [
							{ id: 'required-name', field: 'name', validate: ({ value }) => (value ? null : { message: 'Name is required' }) },
						],
					},
				},
			}
		);
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const result = store.setCellValue('1', 'name', '');

		expect(result.status).toBe('validationFailed');
		if (result.status === 'validationFailed') {
			expect(result.reason).toBe('Name is required');
			expect(result.issues).toHaveLength(1);
		}
		expect(store.getCellValue('1', 'name')).toBe('Product A');
		expect(store.canUndo()).toBe(false);

		controller.dispose();
		store.destroy();
	});

	it('async cell transaction awaits async proposal validation before committing', async () => {
		const store = new GridStore<TestRow>(
			{
				columns: [{ field: 'name', header: 'Name', width: 150 }],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						validateOnSubmit: true,
						cellRules: [
							{
								id: 'server-name-check',
								field: 'name',
								validate: async ({ value }) => (value === 'Blocked' ? { message: 'Blocked by async validator' } : null),
							},
						],
					},
				},
			}
		);
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const blocked = await store.transaction({ cells: [{ rowId: '1', colField: 'name', value: 'Blocked' }] }, { async: true });
		expect(blocked.status).toBe('validationFailed');
		expect(store.getCellValue('1', 'name')).toBe('Product A');

		const allowed = await store.transaction({ cells: [{ rowId: '1', colField: 'name', value: 'Allowed' }] }, { async: true });
		expect(allowed.status).toBe('applied');
		expect(store.getCellValue('1', 'name')).toBe('Allowed');

		controller.dispose();
		store.destroy();
	});

	it('async cell transaction rejects atomically when async proposal validation blocks one update', async () => {
		const store = new GridStore<TestRow>(
			{
				columns: [
					{ field: 'name', header: 'Name', width: 150 },
					{ field: 'price', header: 'Price', width: 100 },
				],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						validateOnSubmit: true,
						cellRules: [
							{
								id: 'blocked-name',
								field: 'name',
								validate: async ({ value }) => (value === 'Blocked' ? { message: 'Blocked by async validator' } : null),
							},
						],
					},
				},
			}
		);
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const result = await store.transaction(
			{
				cells: [
					{ rowId: '1', colField: 'name', value: 'Blocked' },
					{ rowId: '1', colField: 'price', value: 25 },
				],
			},
			{ async: true }
		);

		expect(result.status).toBe('validationFailed');
		expect(store.getCellValue('1', 'name')).toBe('Product A');
		expect(store.getCellValue('1', 'price')).toBe(10);
		expect(store.canUndo()).toBe(false);

		controller.dispose();
		store.destroy();
	});

	it('getStateSnapshot returns immutable defensive copies of public state', () => {
		const queryModel: GridQueryModel = {
			version: 1,
			root: {
				kind: 'group',
				id: 'root',
				operator: 'and',
				children: [{ kind: 'condition', id: 'c1', columnId: 'name', operator: 'contains', value: 'A' }],
			},
		};
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			sortModel: [{ colId: 'name', sort: 'asc' }],
			filterModel: { name: { type: 'text', operator: 'contains', value: 'A' } },
			queryModel,
			selectedRowIds: ['1'],
			pagination: { pageSize: 25, page: 2 },
			grouping: { by: ['name'] },
		});
		const nameColumn = store.engine.columns.getDisplayedColumns()[1] as { field: string; colId?: string; instanceId?: string };
		store.engine.stateManager.setState({
			activeEdit: {
				rowId: '1',
				colField: nameColumn.field,
				colId: nameColumn.colId ?? nameColumn.field,
				columnInstanceId: nameColumn.instanceId as any,
				validationError: 'Required',
			},
		});
		const snapshot = store.getStateSnapshot();
		const liveBefore = store.getState();

		expect(() => {
			(snapshot.columns as ColumnDef<TestRow>[])[0]!.header = 'Mutated';
		}).toThrow();
		expect(() => {
			(snapshot.sortModel as NonNullable<typeof snapshot.sortModel>)![0]!.sort = 'desc';
		}).toThrow();
		expect(() => {
			(snapshot.filterModel as Record<string, any>).name.value = 'Changed';
		}).toThrow();
		expect(() => {
			((snapshot.queryModel as GridQueryModel).root.children as Array<{ value?: unknown }>)[0]!.value = 'Mutated';
		}).toThrow();
		expect(() => {
			(snapshot.selection as any).focus = { rowId: 'x', colField: 'y' };
		}).toThrow();
		expect(() => {
			(snapshot.selectedRowIds as string[]).push('2');
		}).toThrow();
		expect(() => {
			(snapshot.activeEdit as ActiveEditState).validationError = null;
		}).toThrow();
		expect(() => {
			(snapshot.pagination as { pageSize: number; page?: number }).page = 99;
		}).toThrow();
		expect(() => {
			(snapshot.grouping!.by as string[]).push('id');
		}).toThrow();

		const liveAfter = store.getState();
		const freshSnapshot = store.getStateSnapshot();

		expect(liveAfter.columns[0]?.header).toBe(liveBefore.columns[0]?.header);
		expect(liveAfter.sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
		expect(liveAfter.filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'A' } });
		expect(liveAfter.queryModel).toEqual(queryModel);
		expect(liveAfter.selection.focus).toBeNull();
		expect(liveAfter.selectedRowIds).toEqual(['1']);
		expect(liveAfter.activeEdit?.validationError).toBe('Required');
		expect(liveAfter.pagination?.page).toBe(2);
		expect(liveAfter.grouping?.by).toEqual(['name']);
		// Grouped: the first column is the hierarchy column; its header survived the mutation attempt.
		expect(freshSnapshot.columns[0]?.header).toBe('Group');
		expect(freshSnapshot.sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);
		expect(freshSnapshot.filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'A' } });
		expect(freshSnapshot.queryModel).toEqual(queryModel);
		expect(freshSnapshot.selectedRowIds).toEqual(['1']);
		expect(freshSnapshot.activeEdit?.validationError).toBe('Required');
		expect(freshSnapshot.pagination?.page).toBe(2);
		expect(freshSnapshot.grouping?.by).toEqual(['name']);

		store.destroy();
	});

	it('getStateSnapshot is referentially stable until state changes', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});

		const first = store.getStateSnapshot();
		const second = store.getStateSnapshot();
		expect(second).toBe(first);

		store.setShowFilterChipBar(true);

		const third = store.getStateSnapshot();
		const fourth = store.getStateSnapshot();
		expect(third).not.toBe(first);
		expect(fourth).toBe(third);

		store.destroy();
	});

	it('should expose precise selection change invalidation results', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const listener = vi.fn();
		store.addEventListener(GridEventName.selectionChanged, listener);

		store.selectCell({ rowId: '1', colField: 'name' });
		store.selectCell({ rowId: '2', colField: 'name' });

		expect(listener).toHaveBeenLastCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					result: expect.objectContaining({
						invalidatedCells: expect.arrayContaining([
							expect.objectContaining({ rowId: '1', colField: 'name', columnInstanceId: expect.any(String) }),
							expect.objectContaining({ rowId: '2', colField: 'name', columnInstanceId: expect.any(String) }),
						]),
						invalidatedRows: ['1', '2'],
						overlayChanged: true,
					}),
				}),
			})
		);

		controller.dispose();
		store.destroy();
	});

	it('applies one deterministic invalidation plan for a logical selection mutation', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name' });
		const firstSelectionColumnInstanceId = store.getState().selection.focus?.columnInstanceId;
		void store.engine.invalidation.consume();

		store.selectCell({ rowId: '2', colField: 'name' });
		const secondSelectionColumnInstanceId = store.getState().selection.focus?.columnInstanceId;
		const frame = store.engine.invalidation.consume();

		expect(frame.headers).toBe(true);
		expect(frame.overlay).toBe(true);
		expect(frame.cellsByRowId.get('1')).toEqual(new Set([firstSelectionColumnInstanceId]));
		expect(frame.cellsByRowId.get('2')).toEqual(new Set([secondSelectionColumnInstanceId]));
		expect(frame.rows).toEqual(new Set(['1', '2']));
		expect(frame.invalidations.filter((entry) => entry.kind === 'cell')).toHaveLength(2);
		expect(frame.invalidations.filter((entry) => entry.kind === 'row')).toHaveLength(2);

		controller.dispose();
		store.destroy();
	});

	it('should preserve initial style rules in grid state', () => {
		const rowClass = { kind: 'row' as const, when: (row: TestRow) => row.price > 10, rowClass: 'expensive' };
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
			styleRules: [rowClass],
		});

		expect(store.getState().styleRules).toEqual([rowClass]);
	});

	it('should notify targeted key-subscribers only when that specific key is mutated', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const cellValueListener = vi.fn();
		const focusListener = vi.fn();

		store.registerCellSubscription({ rowId: '1', colField: 'name', onStoreChange: cellValueListener });
		store.subscribeToKey('selection', focusListener);

		// Act 1: Set focused cell
		store.selectCell({ rowId: '1', colField: 'name' });

		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(cellValueListener).toHaveBeenCalledTimes(1);

		// Act 2: Change cell value
		store.setCellValue('1', 'name', 'Product Updated');
		store.flushCellUpdatesSync();

		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(cellValueListener).toHaveBeenCalledTimes(2);

		controller.dispose();
	});

	it('should precompute selection range bounds reactively inside selection state', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(store.getState().selection.bounds).toBeNull();

		// Act 1: Select range from row 1, col 'id' to row 2, col 'name'
		store.selectRange({ rowId: '1', colField: 'id' }, { rowId: '2', colField: 'name' });

		const bounds = store.getState().selection.bounds;
		expect(bounds).not.toBeNull();
		expect(bounds?.minRow).toBe(0);
		expect(bounds?.maxRow).toBe(1);
		expect(bounds?.minCol).toBe(0);
		expect(bounds?.maxCol).toBe(1);

		controller.dispose();
	});

	it('should recompute selection bounds after sort reorders rows', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Bravo', price: 10 },
				{ id: '2', name: 'Alpha', price: 20 },
				{ id: '3', name: 'Charlie', price: 30 },
			],
			columns: store.getState().columns,
		});

		// id='1'(Bravo) at idx=0, id='2'(Alpha) at idx=1
		store.selectRange({ rowId: '1', colField: 'id' }, { rowId: '2', colField: 'id' });
		expect(store.getState().selection.bounds?.minRow).toBe(0);
		expect(store.getState().selection.bounds?.maxRow).toBe(1);

		// Sort asc by name: Alpha(id=2)→0, Bravo(id=1)→1, Charlie(id=3)→2
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);

		// Both ids still in range; new positions: id=2 at 0, id=1 at 1 — bounds unchanged in extent
		const bounds = store.getState().selection.bounds;
		expect(bounds?.minRow).toBe(0);
		expect(bounds?.maxRow).toBe(1);

		// Now select only id='3' (Charlie, always last) — then sort desc: Charlie→0
		store.selectRange({ rowId: '3', colField: 'id' }, { rowId: '3', colField: 'id' });
		store.setSortModel([{ colId: 'name', sort: 'desc' }]);

		// After desc sort: Charlie(id=3)→0, Bravo(id=1)→1, Alpha(id=2)→2
		// id='3' moved from idx=2 to idx=0 — bounds must update
		expect(store.getState().selection.bounds?.minRow).toBe(0);
		expect(store.getState().selection.bounds?.maxRow).toBe(0);

		controller.dispose();
	});

	it('should recompute selection bounds after filter shifts row indices', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'remove', price: 10 },
				{ id: '2', name: 'keep-first', price: 20 },
				{ id: '3', name: 'keep-second', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Select id='2'(idx=1) and id='3'(idx=2)
		store.selectRange({ rowId: '2', colField: 'id' }, { rowId: '3', colField: 'id' });
		expect(store.getState().selection.bounds?.minRow).toBe(1);
		expect(store.getState().selection.bounds?.maxRow).toBe(2);

		// Filter to rows containing 'keep' — removes id='1', shifts id='2'→0, id='3'→1
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'keep' } });

		const bounds = store.getState().selection.bounds;
		expect(bounds?.minRow).toBe(0);
		expect(bounds?.maxRow).toBe(1);

		controller.dispose();
	});

	it('should recompute selection bounds to null when selected rows are hidden by group collapse', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			grouping: { by: ['name'] },
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'GroupA', price: 10 },
				{ id: '2', name: 'GroupB', price: 20 },
			],
			columns: store.getState().columns,
		});

		// Find the group ID for GroupA by inspecting the visual rows
		const groupARow = controller.getVisualRow(0);
		expect(groupARow?.kind).toBe('group');
		const groupAId = groupARow?.kind === 'group' ? groupARow.groupId : null;
		expect(groupAId).not.toBeNull();

		// Expand group A — data row id='1' becomes visible
		store.toggleExpanded(groupAId!);
		// Visual layout: [group:GroupA(0), data:1(1), group:GroupB(2)]
		expect(controller.getVisualIndexByRowId('1')).toBe(1);

		// Select the data row inside group A
		store.selectRange({ rowId: '1', colField: 'id' }, { rowId: '1', colField: 'id' });
		expect(store.getState().selection.bounds?.minRow).toBe(1);

		// Collapse group A — id='1' is now hidden, getVisualIndexByRowId returns -1
		store.toggleExpanded(groupAId!);
		expect(controller.getVisualIndexByRowId('1')).toBe(-1);

		// Bounds must be null since the selected row is no longer visible
		expect(store.getState().selection.bounds).toBeNull();

		controller.dispose();
	});

	it('should support valueGetter dynamically', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'price', header: 'Price', width: 100 },
				{
					field: 'price_display',
					header: 'Price Tag',
					width: 100,
					valueGetter: ({ row }) => `$${row.price}.00`,
				},
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Keyboard', price: 45 }],
			columns: store.getState().columns,
		});

		// 1. Initial dynamic check
		const val1 = store.getCellValue('1', 'price_display');
		expect(val1).toBe('$45.00');

		// 2. Reactive check after setting underlying cell value
		store.setCellValue('1', 'price', 90);
		const val2 = store.getCellValue('1', 'price_display');
		expect(val2).toBe('$90.00');

		controller.dispose();
	});

	it('should cache declared valueGetter results and invalidate only dependencies', () => {
		let getterCalls = 0;
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name', width: 100 },
				{ field: 'price', header: 'Price', width: 100 },
				{
					field: 'price_display',
					header: 'Price Tag',
					width: 100,
					valueGetterDependencies: ['price'],
					valueGetter: ({ row }) => {
						getterCalls++;
						return `$${row.price}.00`;
					},
				},
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Keyboard', price: 45 }],
			columns: store.getState().columns,
		});

		expect(store.getCellValue('1', 'price_display')).toBe('$45.00');
		expect(store.getCellValue('1', 'price_display')).toBe('$45.00');
		expect(getterCalls).toBe(1);

		store.setCellValue('1', 'name', 'Mouse');
		expect(store.getCellValue('1', 'price_display')).toBe('$45.00');
		expect(getterCalls).toBe(1);

		store.setCellValue('1', 'price', 90);
		expect(store.getCellValue('1', 'price_display')).toBe('$90.00');
		expect(getterCalls).toBe(2);

		controller.dispose();
	});

	it('should no-op repeated edits to valueGetter columns using the stored source value', () => {
		type StatusRow = TestRow & { status: string };
		const store = new GridStore<StatusRow>({
			columns: [
				{
					field: 'status',
					header: 'Status',
					valueGetter: ({ row }) => {
						if (row.status === 'Inactive') return 'HIGH';
						if (row.status === 'Pending') return 'MEDIUM';
						return 'LOW';
					},
				},
			],
		});
		const controller = new ClientRowModelController<StatusRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10, status: 'Active' }],
			columns: store.getState().columns,
		});
		const listener = vi.fn();
		store.addEventListener(GridEventName.cellValueChanged, listener);

		store.setCellValue('1', 'status', 'Inactive');
		store.setCellValue('1', 'status', 'Inactive');

		expect(store.getCellValue('1', 'status')).toBe('HIGH');
		expect(store.getDataRowAtVisualIndex(0)).toMatchObject({ status: 'Inactive' });
		expect(listener).toHaveBeenCalledTimes(1);

		controller.dispose();
	});

	it('should expose selection state, cell access, and visual column mapping from one source of truth', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		store.selectRange({ rowId: '1', colField: 'name' }, { rowId: '2', colField: 'price' }, 'keyboard');

		expect(store.getState().selection).toMatchObject({
			focus: { rowId: '2', colField: 'price' },
			anchor: { rowId: '1', colField: 'name' },
			source: 'keyboard',
			bounds: { minRow: 0, maxRow: 1, minCol: 1, maxCol: 2 },
		});

		const access = store.getCellAccess('2', 'price');
		expect(access).toMatchObject({
			rowId: '2',
			rowIndex: 1,
			colField: 'price',
			colIndex: 2,
			value: 20,
			rawValue: 20,
			isFocused: true,
			isSelected: true,
			isRowSelected: true,
		});
		expect(access?.node).toMatchObject({
			id: '2',
			data: { id: '2', name: 'Product B', price: 20 },
			rowIndex: 1,
		});
		expect(access?.node).not.toBe(store.getRowNodeById('2'));
		expect(access?.node?.getValue('price')).toBe(20);
		expect(store.getColumnField(1)).toBe('name');

		controller.dispose();
	});

	it('resolves cell access by pointer identity for duplicate-field columns', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name A', width: 150, colId: 'name-a' },
				{ field: 'name', header: 'Name B', width: 150, colId: 'name-b' },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});
		const duplicateNameColumn = store.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };

		const access = store.getCellAccessByPointer({
			rowId: '1',
			colField: duplicateNameColumn.field,
			colId: duplicateNameColumn.colId,
			columnInstanceId: duplicateNameColumn.instanceId,
		});

		expect(access).toMatchObject({
			rowId: '1',
			colField: 'name',
			colIndex: 2,
		});
		expect(access?.column).toMatchObject({
			field: 'name',
			colId: 'name-b',
		});

		controller.dispose();
	});

	it('resolves cell state by pointer identity for duplicate-field columns', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name A', width: 150, colId: 'name-a' },
				{ field: 'name', header: 'Name B', width: 150, colId: 'name-b' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});
		const firstNameColumn = store.engine.columns.getDisplayedColumns()[1] as { field: string; colId?: string; instanceId?: string };
		const duplicateNameColumn = store.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };
		store.engine.stateManager.setState({
			activeEdit: {
				rowId: '1',
				colField: duplicateNameColumn.field,
				colId: duplicateNameColumn.colId,
				columnInstanceId: duplicateNameColumn.instanceId,
				draftValue: 'Draft B',
				originalValue: 'Product A',
				startedBy: 'api',
				version: 1,
			},
		});

		const activeState = store.getCellStateByPointer({
			rowId: '1',
			colField: duplicateNameColumn.field,
			colId: duplicateNameColumn.colId,
			columnInstanceId: duplicateNameColumn.instanceId,
		});
		const inactiveState = store.getCellStateByPointer({
			rowId: '1',
			colField: firstNameColumn.field,
			colId: firstNameColumn.colId,
			columnInstanceId: firstNameColumn.instanceId,
		});

		expect(activeState).toMatchObject({
			value: 'Product A',
			computedValue: 'Product A',
			isEditing: true,
		});
		expect(inactiveState).toMatchObject({
			value: 'Product A',
			computedValue: 'Product A',
			isEditing: false,
		});

		controller.dispose();
	});

	it('preserves duplicate-field editing identity on loaded async row models', async () => {
		const columns = [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name A', width: 150, colId: 'name-a' },
			{ field: 'name', header: 'Name B', width: 150, colId: 'name-b' },
		] satisfies ColumnDef<TestRow>[];

		const infiniteStore = new GridStore<TestRow>({
			columns,
			getRowId: (row) => row.id,
		});
		const infiniteController = new InfiniteRowModelController<TestRow>(infiniteStore.getInfiniteRowModelRuntime(), {
			columns: infiniteStore.getState().columns,
			getRowId: (row) => row.id,
			blockSize: 25,
			datasource: {
				getRows: vi.fn().mockResolvedValue({
					rows: [{ id: '1', name: 'Alpha', price: 10 }],
					totalCount: 1,
				}),
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const infiniteNameA = infiniteStore.engine.columns.getDisplayedColumns()[1] as { field: string; colId?: string; instanceId?: string };
		const infiniteNameB = infiniteStore.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };
		infiniteStore.startEditing('1', infiniteNameB.instanceId!, 'api');

		const infiniteActive = infiniteStore.getCellStateByPointer({
			rowId: '1',
			colField: infiniteNameB.field,
			colId: infiniteNameB.colId,
			columnInstanceId: infiniteNameB.instanceId,
		});
		const infiniteInactive = infiniteStore.getCellStateByPointer({
			rowId: '1',
			colField: infiniteNameA.field,
			colId: infiniteNameA.colId,
			columnInstanceId: infiniteNameA.instanceId,
		});

		expect(infiniteActive?.isEditing).toBe(true);
		expect(infiniteInactive?.isEditing).toBe(false);
		expect(infiniteStore.getState().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colId: 'name-b',
				columnInstanceId: infiniteNameB.instanceId,
			})
		);

		const serverStore = new GridStore<TestRow>({
			columns,
			getRowId: (row) => row.id,
		});
		const serverController = new ServerSideRowModelController<TestRow>(serverStore.getServerSideRowModelRuntime(), {
			columns: serverStore.getState().columns,
			getRowId: (row) => row.id,
			blockSize: 10,
			datasource: {
				getRows: vi.fn().mockResolvedValue({
					rows: [{ id: '2', name: 'Beta', price: 20 }],
					rowCount: 1,
				}),
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		const serverNameA = serverStore.engine.columns.getDisplayedColumns()[1] as { field: string; colId?: string; instanceId?: string };
		const serverNameB = serverStore.engine.columns.getDisplayedColumns()[2] as { field: string; colId?: string; instanceId?: string };
		serverStore.startEditing('2', serverNameB.instanceId!, 'api');

		const serverActive = serverStore.getCellStateByPointer({
			rowId: '2',
			colField: serverNameB.field,
			colId: serverNameB.colId,
			columnInstanceId: serverNameB.instanceId,
		});
		const serverInactive = serverStore.getCellStateByPointer({
			rowId: '2',
			colField: serverNameA.field,
			colId: serverNameA.colId,
			columnInstanceId: serverNameA.instanceId,
		});

		expect(serverActive?.isEditing).toBe(true);
		expect(serverInactive?.isEditing).toBe(false);
		expect(serverStore.getState().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '2',
				colId: 'name-b',
				columnInstanceId: serverNameB.instanceId,
			})
		);

		infiniteController.dispose();
		infiniteStore.destroy();
		serverController.dispose();
		serverStore.destroy();
	});

	it('normalizes duplicate-field selection by colId when columnInstanceId is absent', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name A', width: 150, colId: 'name-a' },
				{ field: 'name', header: 'Name B', width: 150, colId: 'name-b' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name', colId: 'name-b' }, 'api');

		expect(store.getState().selection.focus).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: expect.any(String),
			})
		);
		expect(store.getState().selection.anchor).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: expect.any(String),
			})
		);

		controller.dispose();
	});

	it('clears focus honestly when the focused column disappears from the displayed set', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name' }, 'keyboard');
		expect(store.getState().interaction?.focus.cell).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				columnInstanceId: expect.any(String),
			})
		);

		store.setColumnsVisible(['name'], false);

		expect(store.getState().selection.focus).toBeNull();
		expect(store.getState().selection.anchor).toBeNull();
		expect(store.getState().selection.range).toBeNull();
		expect(store.getState().interaction?.focus.cell).toBeNull();
		expect(store.getState().interaction?.focus.rowIndex).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('clears active edit honestly when the edited column disappears from the displayed set', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150, editable: true },
				{ field: 'price', header: 'Price', width: 100 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		store.startEditing('1', 'name', 'keyboard');
		expect(store.getState().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				columnInstanceId: expect.any(String),
			})
		);

		store.setColumnsVisible(['name'], false);

		expect(store.getState().activeEdit).toBeNull();
		expect(store.getState().interaction?.activeEdit.active).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('restores logical focus to the edited cell when edit is cancelled', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150, editable: true },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name' }, 'keyboard');
		const focusedBeforeEdit = store.getState().selection.focus;

		store.startEditing('1', 'name', 'keyboard');
		store.stopEditing(true);

		expect(store.getState().activeEdit).toBeNull();
		expect(store.getState().selection.focus).toEqual(focusedBeforeEdit);
		expect(store.getState().interaction?.focus.cell).toEqual(focusedBeforeEdit);

		controller.dispose();
		store.destroy();
	});

	it('clears focus honestly when the focused row disappears from the visual row model', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'drop', price: 10 },
				{ id: '2', name: 'keep', price: 20 },
			],
			columns: store.getState().columns,
		});

		store.selectCell({ rowId: '1', colField: 'name' }, 'keyboard');
		expect(store.getState().interaction?.focus.cell).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				columnInstanceId: expect.any(String),
			})
		);

		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'keep' } });

		expect(store.getVisualIndexByRowId('1')).toBeNull();
		expect(store.getState().selection.focus).toBeNull();
		expect(store.getState().selection.anchor).toBeNull();
		expect(store.getState().selection.range).toBeNull();
		expect(store.getState().interaction?.focus.cell).toBeNull();
		expect(store.getState().interaction?.focus.rowIndex).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('rowsUpdated event exposes public row-node facades instead of internal mutable row nodes', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const listener = vi.fn();
		store.addEventListener(GridEventName.rowsUpdated, listener);

		store.transaction({
			rows: {
				update: [{ id: '1', name: 'Product A+', price: 10 }],
			},
		});

		const payload = listener.mock.calls.at(-1)?.[0]?.payload;
		expect(payload.changedNodes).toHaveLength(1);
		expect(payload.changedNodes[0]).toMatchObject({
			id: '1',
			kind: 'data',
			rowIndex: 0,
		});
		expect(payload.changedNodes[0]).not.toBe(store.getRowNodeById('1'));
		expect(payload.changedNodes[0].getValue('name')).toBe('Product A+');

		controller.dispose();
	});

	it('transaction returns public row-node facades instead of internal mutable row nodes', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		const result = store.transaction({
			rows: {
				update: [{ id: '1', name: 'Product A+', price: 10 }],
			},
		});

		expect(result.rows.update).toHaveLength(1);
		expect(result.rows.update[0]).toMatchObject({
			id: '1',
			kind: 'data',
			rowIndex: 0,
		});
		expect(result.rows.update[0]).not.toBe(store.getRowNodeById('1'));
		expect(result.rows.update[0].getValue('name')).toBe('Product A+');
		expect('setCellValue' in (result.rows.update[0] as Record<string, unknown>)).toBe(false);

		controller.dispose();
	});

	it('valueGetter params expose a lightweight public row ref instead of the internal row node', () => {
		let seenNode: unknown;
		const store = new GridStore<TestRow>({
			columns: [
				{
					field: 'display',
					header: 'Display',
					valueGetter: ({ node, row }) => {
						seenNode = node;
						return `${node.id}:${row.name}:${node.getValue('name')}`;
					},
				},
			] as ColumnDef<TestRow>[],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		expect(store.getCellValue('1', 'display')).toBe('1:Product A:Product A');
		expect(seenNode).toMatchObject({ id: '1', data: { id: '1', name: 'Product A', price: 10 } });
		expect(seenNode).not.toBe(store.getRowNodeById('1'));
		expect(typeof (seenNode as { getValue?: unknown }).getValue).toBe('function');
		expect('setCellValue' in (seenNode as Record<string, unknown>)).toBe(false);

		controller.dispose();
	});

	it('selection change events publish projection-owned bounds from committed state', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const listener = vi.fn();
		store.addEventListener(GridEventName.selectionChanged, listener);

		store.selectRange({ rowId: '1', colField: 'name' }, { rowId: '2', colField: 'price' }, 'keyboard');

		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					selection: expect.objectContaining({
						bounds: { minRow: 0, maxRow: 1, minCol: 1, maxCol: 2 },
					}),
				}),
			})
		);

		controller.dispose();
	});

	it('setCellValue preserves formula string and recomputes on dependency change', () => {
		const store = new GridStore<{ id: string; val: number; formula: unknown }>({
			columns: [
				{ field: 'val', header: 'Val' },
				{ field: 'formula', header: 'Formula' },
			],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', val: 10, formula: '' }],
			columns: store.getState().columns,
		});

		store.setCellValue('r1', 'formula', '=[r1:val]*2');

		expect(store.getCellState('r1', 'formula').value).toBe('=[r1:val]*2');
		expect(store.getCellValue('r1', 'formula')).toBe(20);

		store.setCellValue('r1', 'val', 30);
		expect(store.getCellValue('r1', 'formula')).toBe(60);

		controller.dispose();
	});

	it('transaction keeps formula registration and recomputes dependent cells', () => {
		const store = new GridStore<{ id: string; val: number; formula: unknown }>({
			columns: [
				{ field: 'val', header: 'Val' },
				{ field: 'formula', header: 'Formula' },
			],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', val: 10, formula: '' }],
			columns: store.getState().columns,
		});

		store.transaction({ rows: { update: [{ id: 'r1', val: 10, formula: '=[r1:val]*2' }] } });
		expect(store.getCellState('r1', 'formula').value).toBe('=[r1:val]*2');
		expect(store.getCellValue('r1', 'formula')).toBe(20);

		store.transaction({ rows: { update: [{ id: 'r1', val: 30, formula: '=[r1:val]*2' }] } });
		expect(store.getCellValue('r1', 'formula')).toBe(60);

		controller.dispose();
	});

	it('setRows invalidates declared valueGetter dependencies through the same write pipeline', () => {
		let getterCalls = 0;
		const store = new GridStore<{ id: string; price: number; name: string }>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
				{
					field: 'price_display',
					header: 'Price Tag',
					valueGetterDependencies: ['price'],
					valueGetter: ({ row }) => {
						getterCalls++;
						return `$${row.price}.00`;
					},
				},
			],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', name: 'Alpha', price: 10 }],
			columns: store.getState().columns,
		});

		expect(store.getCellValue('r1', 'price_display')).toBe('$10.00');
		expect(store.getCellValue('r1', 'price_display')).toBe('$10.00');
		expect(getterCalls).toBe(1);

		store.setRows(
			store
				.rows()
				.getAll()
				.map((row) => (row.id === 'r1' ? { ...row, price: 25 } : row))
		);
		expect(store.getCellValue('r1', 'price_display')).toBe('$25.00');
		expect(getterCalls).toBe(2);

		controller.dispose();
	});

	it('getCellState returns raw formula string in .value and computed value in .computedValue', () => {
		const store = new GridStore<{ id: string; val: number; formula: unknown }>({
			columns: [
				{ field: 'val', header: 'Val' },
				{ field: 'formula', header: 'Formula' },
			],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', val: 5, formula: '' }],
			columns: store.getState().columns,
		});

		store.setCellValue('r1', 'formula', '=[r1:val]*3');

		const state = store.getCellState('r1', 'formula');
		expect(state.value).toBe('=[r1:val]*3');
		expect(state.computedValue).toBe(15);
		expect(store.getCellValue('r1', 'formula')).toBe(15);

		controller.dispose();
	});

	it('replacing a formula cell with a raw value clears formula registration', () => {
		const store = new GridStore<{ id: string; val: number; formula: unknown }>({
			columns: [
				{ field: 'val', header: 'Val' },
				{ field: 'formula', header: 'Formula' },
			],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', val: 10, formula: '' }],
			columns: store.getState().columns,
		});

		store.setCellValue('r1', 'formula', '=[r1:val]*2');
		expect(store.getCellValue('r1', 'formula')).toBe(20);

		store.setCellValue('r1', 'formula', 99);
		expect(store.getCellState('r1', 'formula').value).toBe(99);
		expect(store.getCellValue('r1', 'formula')).toBe(99);
		expect(store.engine.hasFormula('r1', 'formula')).toBe(false);

		controller.dispose();
	});

	it('should allow replacing a formula with its computed literal value', () => {
		const store = new GridStore<{ id: string; a: number; b: string | number }>({
			columns: [
				{ field: 'a', header: 'A' },
				{ field: 'b', header: 'B' },
			],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', a: 5, b: '=[1:a]*2' }],
			columns: store.getState().columns,
		});

		expect(store.getCellValue('1', 'b')).toBe(10);

		store.setCellValue('1', 'b', 10);

		expect(store.getCellState('1', 'b').value).toBe(10);
		expect(store.getCellValue('1', 'b')).toBe(10);
		expect(store.engine.hasFormula('1', 'b')).toBe(false);

		controller.dispose();
	});

	it('should route stopEditing through kernel-owned cancel/commit semantics', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Keyboard', price: 45 }],
			columns: store.getState().columns,
		});

		store.startEditing('1', 'name', 'keyboard');
		store.updateEditDraft('1', 'name', 'Cancelled Keyboard');
		store.stopEditing(true);
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Keyboard');

		store.startEditing('1', 'name', 'keyboard');
		store.updateEditDraft('1', 'name', 'Premium Keyboard');
		store.stopEditing(false);
		await Promise.resolve();
		expect(store.getState().activeEdit).toBeNull();
		expect(store.getCellValue('1', 'name')).toBe('Premium Keyboard');

		controller.dispose();
	});

	it('should support explicit feature registration without mutating the store API', () => {
		const store = new GridStore<TestRow>();

		const initSpy = vi.fn();
		const destroySpy = vi.fn();

		const customFeature = {
			name: 'customService',
			onInit: initSpy,
			onDestroy: destroySpy,
			customApiCall: (arg: string) => `Handled: ${arg}`,
		};

		store.registerPlugin(customFeature);

		expect(initSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				getStateSnapshot: expect.any(Function),
				getRowModel: expect.any(Function),
				getVisualRow: expect.any(Function),
				getCellState: expect.any(Function),
			})
		);
		expect(initSpy).not.toHaveBeenCalledWith(store);
		expect(store.getPlugin<typeof customFeature>('customService')).toBe(customFeature);
		expect((store as unknown as Record<string, unknown>).customService).toBeUndefined();
		expect((store as unknown as Record<string, unknown>).customApiCall).toBeUndefined();
		expect(customFeature.customApiCall('test')).toBe('Handled: test');

		store.destroy();
		expect(destroySpy).toHaveBeenCalled();
	});

	it('should handle column resizing', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const resizeListener = vi.fn();
		store.addEventListener(GridEventName.columnResized, resizeListener);

		store.setColumnWidth('name', 250);

		expect(store.getState().columnWidths['name']).toBe(250);
		expect(resizeListener).toHaveBeenCalledTimes(1);
		expect(resizeListener).toHaveBeenCalledWith({
			type: 'columnResized',
			payload: { colField: 'name', width: 250 },
		});
	});

	it('should support column reordering through the public store API', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});

		const reorderListener = vi.fn();
		store.addEventListener(GridEventName.columnOrderChanged, reorderListener);

		store.moveColumn('price', 0);

		expect(store.getState().columns.map((column) => column.field)).toEqual(['price', 'id', 'name']);
		expect(store.getColumnIndex('price')).toBe(0);
		expect(reorderListener).toHaveBeenCalledWith({
			type: 'columnOrderChanged',
			payload: {
				columns: store.getState().columns,
				columnFields: ['price', 'id', 'name'],
			},
		});

		store.setColumnOrder(['name', 'price']);

		expect(store.getState().columns.map((column) => column.field)).toEqual(['name', 'price', 'id']);
		expect(store.getColumnIndex('id')).toBe(2);
	});

	it('should move columns by displayed index without counting hidden columns', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'hidden', header: 'Hidden', width: 100, hide: true },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});

		store.moveColumn('price', 1);

		expect(store.getDisplayedColumns().map((column) => column.field)).toEqual(['id', 'price', 'name']);
		expect(store.getColumnIndex('price')).toBe(1);
		expect(store.getColumnIndex('hidden')).toBe(-1);
	});

	it('should expose displayed column controls through the public store API', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150, hide: true },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});

		expect(store.getColumns().map((column) => column.field)).toEqual(['id', 'name', 'price']);
		expect(store.getDisplayedColumns().map((column) => column.field)).toEqual(['id', 'price']);
		expect(store.getColumnIndex('price')).toBe(1);
		expect(store.getColumnIndex('name')).toBe(-1);

		store.setColumnVisible('name', true);
		expect(store.getDisplayedColumns().map((column) => column.field)).toEqual(['id', 'name', 'price']);

		store.setColumnsVisible(['id', 'price'], false);
		expect(store.getDisplayedColumns().map((column) => column.field)).toEqual(['name']);

		store.setPinnedColumns({ left: 1, right: 2 });
		expect(store.getPinnedColumns()).toEqual({ left: 1, right: 2 });
	});

	it('should recompute detail row geometry when sorting moves expanded details', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			defaultRowHeight: 40,
			detail: { height: 220 },
			expansion: {
				rows: {},
				details: { '1': true },
			},
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Apex', price: 10 },
				{ id: '2', name: 'Beta', price: 20 },
				{ id: '3', name: 'Cyberdyne', price: 30 },
			],
			columns: store.getState().columns,
		});

		expect(Array.from(store.engine.geometry.rowHeights)).toEqual([40, 220, 40, 40]);

		store.setSortModel([{ colId: 'name', sort: 'desc' }]);

		expect(store.getVisualRow(3)?.id).toBe('detail:1');
		expect(Array.from(store.engine.geometry.rowHeights)).toEqual([40, 40, 40, 220]);

		controller.dispose();
	});

	it('should toggle column reorder state through the public store API', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const toggleListener = vi.fn();
		store.addEventListener(GridEventName.columnReorderToggled, toggleListener);

		expect(store.getState().enableColumnReorder).toBe(true);

		store.setColumnReorderEnabled(false);

		expect(store.getState().enableColumnReorder).toBe(false);
		expect(toggleListener).toHaveBeenCalledWith({
			type: 'columnReorderToggled',
			payload: { enabled: false },
		});
	});
});

describe('ClientRowModelController sorting and filtering', () => {
	it('should apply client sort and filter correctly', () => {
		const store = new GridStore<TestRow>();
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'c', name: 'Cherry', price: 5 },
				{ id: 'a', name: 'Apple', price: 15 },
				{ id: 'b', name: 'Banana', price: 10 },
			],
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 100 },
			],
		});

		const rowModel = store.getRowModel()!;

		// Check initial rows load
		expect(store.getVisualRowCount()).toBe(3);

		// Apply sort by name Ascending
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		expect(store.getDataRowAtVisualIndex(0)?.name).toBe('Apple');
		expect(store.getDataRowAtVisualIndex(1)?.name).toBe('Banana');
		expect(store.getDataRowAtVisualIndex(2)?.name).toBe('Cherry');

		// Apply sorting descending
		store.setSortModel([{ colId: 'name', sort: 'desc' }]);
		expect(store.getDataRowAtVisualIndex(0)?.name).toBe('Cherry');

		// Apply filter by name contains 'an'
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'an' } });
		expect(store.getVisualRowCount()).toBe(1);
		expect(store.getDataRowAtVisualIndex(0)?.name).toBe('Banana');

		controller.dispose();
	});

	it('should support benchmark sorting and selection maps in O(1) time', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 150 }],
		});
		const largeRows = Array.from({ length: 1000000 }, (_, i) => ({
			id: String(i),
			name: `Product ${i}`,
			price: i,
		}));
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: largeRows,
			columns: store.getState().columns,
		});

		const t0 = performance.now();
		const idx = store.getVisualIndexByRowId('999999');
		const t1 = performance.now();

		expect(idx).toBe(999999);
		expect(t1 - t0).toBeLessThan(5.0); // Under 5ms (typically <0.1ms) demonstrating O(1) hash map speed!

		controller.dispose();
	}, 10_000);
});

describe('InfiniteRowModelController lazily populated row-patching', () => {
	it('should fetch rows block on demand', async () => {
		const store = new GridStore<TestRow>();
		const mockDatasource: InfiniteDatasource<TestRow> = {
			getRows: async () => ({
				rows: [
					{ id: '10', name: 'Server A', price: 100 },
					{ id: '11', name: 'Server B', price: 200 },
				],
				totalCount: 100,
			}),
		};

		const controller = new InfiniteRowModelController<TestRow>(store.getInfiniteRowModelRuntime(), {
			datasource: mockDatasource,
			blockSize: 2,
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 100 },
			],
		});

		// Access row at index 0, should return null initially and trigger fetching
		const initial = store.getDataRowAtVisualIndex(0);
		expect(initial).toBeNull();

		// Wait for mock datasource promise to resolve and state to update
		await vi.waitFor(() => {
			return store.getDataRowAtVisualIndex(0) !== null;
		});

		const loaded = store.getDataRowAtVisualIndex(0);
		expect(loaded?.name).toBe('Server A');

		controller.dispose();
	});
});

describe('RowNode path getters and state batching', () => {
	it('should support RowNode properties and cellular caching', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const node = store.getDataRowNodeAtVisualIndex(0)!;

		expect(node).toBeDefined();
		expect(node.id).toBe('1');
		expect(node.data.name).toBe('Product A');

		// Cell caching test
		let callCount = 0;
		const customGetter = (data: TestRow) => {
			callCount++;
			return data.name.toUpperCase();
		};

		const val1 = node.getCellValue('name', customGetter);
		expect(val1).toBe('PRODUCT A');
		expect(callCount).toBe(1);

		// Subsequent call must fetch from cache
		const val2 = node.getCellValue('name', customGetter);
		expect(val2).toBe('PRODUCT A');
		expect(callCount).toBe(1); // Call count remains 1 due to cache!

		// Clear value cache
		node.clearValueCache();
		const val3 = node.getCellValue('name', customGetter);
		expect(val3).toBe('PRODUCT A');
		expect(callCount).toBe(2); // Invalidation works!

		controller.dispose();
	});

	it('should defer state notifications during internal state transactions', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name' }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const listener = vi.fn();
		store.subscribe(listener);

		store.engine.stateManager.startTransaction();
		store.selectCell({ rowId: '1', colField: 'name' });
		store.engine.stateManager.setState({ defaultRowHeight: 50 });
		store.engine.stateManager.setState({ defaultColWidth: 120 });

		// Listeners must not be notified during a transaction
		expect(listener).toHaveBeenCalledTimes(0);
		expect(store.getState().selection.focus?.rowId).toBe('1');
		expect(store.getState().defaultRowHeight).toBe(50);
		expect(store.getState().defaultColWidth).toBe(120);

		// End transaction
		store.engine.stateManager.endTransaction();
		// Listeners notified exactly once at the end!
		expect(listener).toHaveBeenCalledTimes(1);

		controller.dispose();
	});
});

describe('Phase 2 Engine Scalability Subsystems', () => {
	it('should cache cumulative geometry and map offsets using binary search in O(log N) time', async () => {
		const { GeometryModel } = await import('./models/GeometryModel.js');
		const geometry = new GeometryModel();

		const widths = [100, 150, 200, 80]; // Cumulative offsets: 0, 100, 250, 450
		geometry.updateColumns(widths, 100);

		expect(geometry.colLefts[0]).toBe(0);
		expect(geometry.colLefts[1]).toBe(100);
		expect(geometry.colLefts[2]).toBe(250);
		expect(geometry.colLefts[3]).toBe(450);

		// Binary search index mappings at offsets
		expect(geometry.getColIndexAtOffset(50)).toBe(0);
		expect(geometry.getColIndexAtOffset(150)).toBe(1);
		expect(geometry.getColIndexAtOffset(300)).toBe(2);
		expect(geometry.getColIndexAtOffset(500)).toBe(3);
	});

	it('should pool and dispatch cell subscriptions using packed 32-bit composite binary keys with stable numeric IDs', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'row-a', name: 'Product A', price: 10 },
				{ id: 'row-b', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		const valueListener = vi.fn();
		const focusListener = vi.fn();

		// Subscribe using standard cell key pattern
		store.registerCellSubscription({ rowId: 'row-a', colField: 'name', onStoreChange: valueListener });
		store.registerCellSubscription({ rowId: 'row-b', colField: 'name', onStoreChange: focusListener });

		// Act 1: Focus row-b:name
		store.selectCell({ rowId: 'row-b', colField: 'name' });
		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(valueListener).toHaveBeenCalledTimes(0);

		// Act 2: Mutate row-a:name value
		store.setCellValue('row-a', 'name', 'Product Custom');
		store.flushCellUpdatesSync();
		expect(focusListener).toHaveBeenCalledTimes(1);
		expect(valueListener).toHaveBeenCalledTimes(1);

		controller.dispose();
	});
});

describe('GridStore auto-batching and dirty cell fanout', () => {
	it('should auto-batch multiple setCellValue calls and flush once on demand', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const listener = vi.fn();
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: listener });

		store.setCellValue('1', 'price', 15);
		store.setCellValue('1', 'price', 20);
		// Listener is not notified synchronously — auto-batching defers via microtask
		expect(listener).toHaveBeenCalledTimes(0);

		// flushCellUpdatesSync() forces an immediate synchronous flush
		store.flushCellUpdatesSync();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getCellValue('1', 'price')).toBe(20);

		controller.dispose();
	});

	it('should have batchedUpdates always true by default', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const listener = vi.fn();
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: listener });

		// batchedUpdates is true by default — all setCellValue calls are auto-batched
		expect(store.batchedUpdates).toBe(true);

		store.setCellValue('1', 'price', 15);
		store.setCellValue('1', 'price', 20);
		expect(listener).toHaveBeenCalledTimes(0);

		// Disabling batchedUpdates triggers an immediate flush (escape hatch)
		store.batchedUpdates = false;
		expect(store.batchedUpdates).toBe(false);
		expect(listener).toHaveBeenCalledTimes(1);

		// Re-enabling works
		store.batchedUpdates = true;
		expect(store.batchedUpdates).toBe(true);

		controller.dispose();
	});

	it('should flush pending updates even when an error occurs mid-batch', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const listener = vi.fn();
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: listener });

		// setCellValue enqueues the update even if subsequent code throws
		store.setCellValue('1', 'price', 15);
		expect(() => {
			throw new Error('Test Error');
		}).toThrow('Test Error');

		// Flush explicitly — the queued update is still applied
		store.flushCellUpdatesSync();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getCellValue('1', 'price')).toBe(15);

		controller.dispose();
	});

	it('closes engine transaction brackets and flushes queued notifications when a batch callback throws', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});
		const listener = vi.fn();
		const renderInvalidated = vi.fn();
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: listener });
		store.addEventListener(GridEventName.renderInvalidated, renderInvalidated);

		expect(() =>
			store.engine.batch(() => {
				store.setCellValue('1', 'price', 15);
				throw new Error('batch failure');
			})
		).toThrow('batch failure');

		expect(listener).toHaveBeenCalledTimes(1);
		expect(renderInvalidated).toHaveBeenCalledTimes(1);

		store.engine.batch(() => {
			store.setCellValue('1', 'price', 20);
		});

		expect(listener).toHaveBeenCalledTimes(2);
		expect(renderInvalidated).toHaveBeenCalledTimes(2);
		controller.dispose();
	});

	it('should only notify subscribers of edited and dependent cells, not all columns on the row', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		const nameListener = vi.fn();
		const priceListener = vi.fn();

		store.registerCellSubscription({ rowId: '1', colField: 'name', onStoreChange: nameListener });
		store.registerCellSubscription({ rowId: '1', colField: 'price', onStoreChange: priceListener });

		store.setCellValue('1', 'price', 15);
		store.flushCellUpdatesSync();

		// The price cell listener should be notified exactly once
		expect(priceListener).toHaveBeenCalledTimes(1);
		// The name cell listener should NOT be notified at all since it has no dependency on price
		expect(nameListener).toHaveBeenCalledTimes(0);

		controller.dispose();
	});

	it('should bound selection cell notifications to the visible viewport', () => {
		const columns = Array.from({ length: 50 }, (_, i) => ({ field: `c${i}`, header: `C${i}` }));
		const rows = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, price: i }));
		type WideRow = { id: string; name: string; price: number; [key: string]: string | number };
		const store = new GridStore<WideRow>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
		});
		const controller = new ClientRowModelController<WideRow>(store.getClientRowModelRuntime(), {
			rows,
			columns,
		});

		store.setViewportSize(300, 160);
		store.setScrollPosition(0, 0);
		store.updateVisibleRanges();

		const visibleListener = vi.fn();
		const offscreenListener = vi.fn();
		store.registerCellSubscription({ rowId: 'r0', colField: 'c0', onStoreChange: visibleListener });
		store.registerCellSubscription({ rowId: 'r400', colField: 'c40', onStoreChange: offscreenListener });

		store.selectRange({ rowId: 'r0', colField: 'c0' }, { rowId: 'r499', colField: 'c49' });

		expect(visibleListener).toHaveBeenCalledTimes(1);
		expect(offscreenListener).toHaveBeenCalledTimes(0);

		controller.dispose();
	});
});

describe('Fix 6 regression — setCellValue on sort-key field triggers visual reorder', () => {
	it('api.setCellValue on a sort-key field moves the row to its correct sorted position', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'B', price: 20 },
				{ id: '3', name: 'C', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Initial order: 1 (10), 2 (20), 3 (30)
		expect(ctrl.getVisualIndexByRowId('1')).toBe(0);

		// Raise row 1's price via public API — executor must trigger sort reconciliation
		store.setCellValue('1', 'price', 25);
		ctrl.refresh();

		expect(ctrl.getVisualIndexByRowId('2')).toBe(0); // 20
		expect(ctrl.getVisualIndexByRowId('1')).toBe(1); // 25 (moved)
		expect(ctrl.getVisualIndexByRowId('3')).toBe(2); // 30

		ctrl.dispose();
	});
});

describe('Fix 7 regression — transaction update path uses sort/filter reconciliation', () => {
	it('api.transaction({ rows: { update } }) on a sort-key field relocates the row', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'B', price: 20 },
				{ id: '3', name: 'C', price: 30 },
			],
			columns: store.getState().columns,
		});

		// Initial order: 1 (10), 2 (20), 3 (30)
		expect(ctrl.getVisualIndexByRowId('1')).toBe(0);

		// Update via transaction — must go through same sort reconciliation as setRows
		store.transaction({ rows: { update: [{ id: '1', name: 'A', price: 25 }] } });
		ctrl.refresh();

		expect(ctrl.getVisualIndexByRowId('2')).toBe(0); // 20
		expect(ctrl.getVisualIndexByRowId('1')).toBe(1); // 25 (moved)
		expect(ctrl.getVisualIndexByRowId('3')).toBe(2); // 30

		ctrl.dispose();
	});
});

describe('Plan 141 regression â€” targeted invalidations for canonical row writes', () => {
	it('sort-key transaction updates emit viewport/range invalidations instead of forcing a full repaint', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'B', price: 20 },
				{ id: '3', name: 'C', price: 30 },
			],
			columns: store.getState().columns,
		});

		void store.engine.invalidation.consume();
		store.transaction({ rows: { update: [{ id: '1', name: 'A', price: 25 }] } });
		const frame = store.engine.invalidation.consume();

		expect(frame.full).toBe(false);
		expect(frame.viewport).toBe(true);

		ctrl.dispose();
		store.destroy();
	});

	it('sort-key cell writes emit viewport/range invalidations instead of forcing a full repaint', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'B', price: 20 },
				{ id: '3', name: 'C', price: 30 },
			],
			columns: store.getState().columns,
		});

		void store.engine.invalidation.consume();
		store.setCellValue('1', 'price', 25);
		const frame = store.engine.invalidation.consume();

		expect(frame.full).toBe(false);
		expect(frame.viewport).toBe(true);

		ctrl.dispose();
		store.destroy();
	});

	it('grouped sort-model changes emit targeted viewport/header invalidations instead of a full repaint', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name', enableRowGroup: true },
				{ field: 'price', header: 'Price' },
			],
			grouping: { by: ['name'] },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'A', price: 20 },
				{ id: '3', name: 'B', price: 30 },
			],
			columns: store.getState().columns,
		});
		const groupAId = ctrl.getVisualRow(0)?.kind === 'group' ? ctrl.getVisualRow(0)?.groupId : null;
		expect(groupAId).not.toBeNull();
		store.toggleExpanded(groupAId!);
		void store.engine.invalidation.consume();

		store.setSortModel([{ colId: 'price', sort: 'desc' }]);
		const frame = store.engine.invalidation.consume();

		expect(frame.full).toBe(false);
		expect(frame.viewport).toBe(true);
		expect(frame.headers).toBe(true);

		ctrl.dispose();
		store.destroy();
	});

	it('grouped filter-model changes emit targeted viewport/overlay invalidations instead of a full repaint', () => {
		const store = new GridStore<TestRow>({
			getRowId: (r) => r.id,
			columns: [
				{ field: 'name', header: 'Name', enableRowGroup: true },
				{ field: 'price', header: 'Price' },
			],
			grouping: { by: ['name'] },
		});
		const ctrl = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'A', price: 20 },
				{ id: '3', name: 'B', price: 30 },
			],
			columns: store.getState().columns,
		});
		const groupAId = ctrl.getVisualRow(0)?.kind === 'group' ? ctrl.getVisualRow(0)?.groupId : null;
		expect(groupAId).not.toBeNull();
		store.toggleExpanded(groupAId!);
		void store.engine.invalidation.consume();

		store.setFilterModel({ price: { type: 'number', operator: 'gt', value: 15 } });
		const frame = store.engine.invalidation.consume();

		expect(frame.full).toBe(false);
		expect(frame.viewport).toBe(true);
		expect(frame.overlay).toBe(true);

		ctrl.dispose();
		store.destroy();
	});
});

describe('GridStore undo and redo functionality', () => {
	it('should support undo and redo for cell value modifications', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		expect(store.canUndo()).toBe(false);
		expect(store.canRedo()).toBe(false);

		// Act 1: Set value
		store.setCellValue('1', 'price', 25);
		expect(store.getCellValue('1', 'price')).toBe(25);
		expect(store.canUndo()).toBe(true);
		expect(store.canRedo()).toBe(false);

		// Act 2: Undo
		store.undo();
		expect(store.getCellValue('1', 'price')).toBe(10);
		expect(store.canUndo()).toBe(false);
		expect(store.canRedo()).toBe(true);

		// Act 3: Redo
		store.redo();
		expect(store.getCellValue('1', 'price')).toBe(25);
		expect(store.canUndo()).toBe(true);
		expect(store.canRedo()).toBe(false);

		controller.dispose();
	});

	it('should support undo and redo for column width and row height resizing', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});

		// 1. Column Width Undo/Redo
		store.setColumnWidth('name', 200);
		expect(store.getState().columnWidths['name']).toBe(200);
		expect(store.canUndo()).toBe(true);

		store.undo();
		expect(store.getState().columnWidths['name']).toBe(100);

		store.redo();
		expect(store.getState().columnWidths['name']).toBe(200);

		// 2. Row Height Undo/Redo
		store.setRowHeight('1', 80);
		expect(store.getState().rowHeights['1']).toBe(80);

		store.undo();
		expect(store.getState().rowHeights['1']).toBe(40);

		store.redo();
		expect(store.getState().rowHeights['1']).toBe(80);

		controller.dispose();
	});

	it('setRowOrder publishes row order changes through the engine commit path', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name' }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alpha', price: 10 },
				{ id: '2', name: 'Beta', price: 20 },
				{ id: '3', name: 'Gamma', price: 30 },
			],
			columns: store.getState().columns,
		});
		const listener = vi.fn();
		store.addEventListener(GridEventName.rowOrderChanged, listener);

		const result = store.setRowOrder(['3', '1', '2']);

		expect(result.status).toBe('applied');
		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { rowIds: ['3', '1', '2'] } }));
		expect((store as any).engine.getRowModel()?.getRowOrder()).toEqual(['3', '1', '2']);

		controller.dispose();
		store.destroy();
	});

	it('setRowOrder supports undo and redo through domain-mutation history', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name' }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alpha', price: 10 },
				{ id: '2', name: 'Beta', price: 20 },
				{ id: '3', name: 'Gamma', price: 30 },
			],
			columns: store.getState().columns,
		});

		const result = store.setRowOrder(['3', '1', '2']);
		expect(result.status).toBe('applied');
		expect(store.getRowOrder()).toEqual(['3', '1', '2']);
		expect(store.canUndo()).toBe(true);

		store.undo();
		expect(store.getRowOrder()).toEqual(['1', '2', '3']);

		store.redo();
		expect(store.getRowOrder()).toEqual(['3', '1', '2']);

		controller.dispose();
		store.destroy();
	});

	it('managed row drag policy blocks reorder while sort is active instead of clearing sort implicitly', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name' }],
			sortModel: [{ colId: 'name', sort: 'asc' }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alpha', price: 10 },
				{ id: '2', name: 'Beta', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(store.engine.getManagedRowDragPolicy()).toEqual({
			allowed: false,
			reason: 'sort-active',
			message: 'Managed row drag is blocked while sort is active.',
		});
		expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);

		controller.dispose();
		store.destroy();
	});

	it('should support undo and redo for sort and filter models', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name' }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Banana', price: 10 },
				{ id: '2', name: 'Apple', price: 20 },
			],
			columns: store.getState().columns,
		});

		// 1. Sort Model Undo/Redo
		store.setSortModel([{ colId: 'name', sort: 'asc' }]);
		expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);

		store.undo();
		expect(store.getState().sortModel).toBeNull();

		store.redo();
		expect(store.getState().sortModel).toEqual([{ colId: 'name', sort: 'asc' }]);

		// 2. Filter Model Undo/Redo
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'App' } });
		expect(store.getState().filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'App' } });

		store.undo();
		expect(store.getState().filterModel).toBeNull();

		store.redo();
		expect(store.getState().filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'App' } });

		controller.dispose();
	});

	it('should enforce the history capacity limit (max 100 entries)', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		// We resize the column 105 times (widths 101 to 205)
		// The original width is 100.
		// The 1st action sets it to 101 (reverts to 100).
		// The 5th action sets it to 105 (reverts to 104).
		// The 6th action sets it to 106 (reverts to 105).
		// If capacity is 100, the first 5 actions (which resize to 101, 102, 103, 104, 105) will be evicted from the undo stack.
		// The oldest remaining entry in the undo stack is the 6th action (resize to 106, undo should revert to 105).
		// Therefore, if we undo all the way (100 times), the width should end up at 105, NOT 100.
		for (let i = 1; i <= 105; i++) {
			store.setColumnWidth('name', 100 + i);
		}

		expect(store.getState().columnWidths['name']).toBe(205);

		// Undo all the way
		while (store.canUndo()) {
			store.undo();
		}
		// The width should be 105 because the oldest undoable action was setting it to 106 (which reverted to 105)
		expect(store.getState().columnWidths['name']).toBe(105);
	});

	it('should support GridStore facade methods getVisualIndexById, getVisualIndexByRowId, getRowNodeById, getRowNode, and getRawRowById correctly', () => {
		const store = new GridStore<TestRow>({
			getRowId: (row) => row.id,
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});

		expect(store.getVisualIndexById('row:1')).toBe(0);
		expect(store.getVisualIndexById('row:2')).toBe(1);
		expect(store.getVisualIndexById('1')).toBeNull();
		expect(store.getVisualIndexByRowId('1')).toBe(0);
		expect(store.getVisualIndexByRowId('2')).toBe(1);
		expect(store.getRowNodeById('1')?.data.name).toBe('Product A');
		expect(store.getRowLoadState(0)).toEqual({ kind: 'loaded', rowId: '1' });
		expect(store.getRawRowById('1')).toEqual({ id: '1', name: 'Product A', price: 10 });
		expect(store.getRawRowById('non-existent')).toBeNull();
		expect(store.getRowIndexById('1')).toBe(0);
		expect(store.getRowIndexById('missing')).toBeUndefined();

		const publicNode = store.getRowNode('1');
		expect(publicNode).toBeDefined();
		expect(publicNode).not.toBe(store.getRowNodeById('1'));
		expect(publicNode?.id).toBe('1');
		expect(publicNode?.kind).toBe('data');
		expect(publicNode?.rowIndex).toBe(0);
		expect(publicNode?.loaded).toBe(true);
		expect(publicNode?.getValue('name')).toBe('Product A');
		expect(publicNode?.getDisplayValue('name')).toBe('Product A');

		const displayedNode = store.getDisplayedRowAtIndex(0);
		expect(displayedNode?.id).toBe('1');
		expect(displayedNode?.kind).toBe('data');

		const seenAllNodeIds: string[] = [];
		store.forEachNode((node) => {
			seenAllNodeIds.push(node.id);
		});
		expect(seenAllNodeIds).toEqual(['1', '2']);

		const seenDisplayedNodeIds: string[] = [];
		store.forEachDisplayedNode((node) => {
			seenDisplayedNodeIds.push(node.id);
		});
		expect(seenDisplayedNodeIds).toEqual(['1', '2']);

		expect(publicNode?.setDataValue('name', 'Product A+').status).toBe('applied');
		expect(store.getRawRowById('1')?.name).toBe('Product A+');

		// Test the luxury row collection APIs
		expect(store.rows().getAll()).toEqual([
			{ id: '1', name: 'Product A+', price: 10 },
			{ id: '2', name: 'Product B', price: 20 },
		]);

		const processed: any[] = [];
		store.rows().forEach((row, index) => {
			processed.push({ ...row, index });
		});
		expect(processed).toEqual([
			{ id: '1', name: 'Product A+', price: 10, index: 0 },
			{ id: '2', name: 'Product B', price: 20, index: 1 },
		]);

		// Selection bounds test
		expect(store.rows().getSelected()).toEqual([]);
		expect(store.rows().getSelectedIds()).toEqual([]);

		store.selectRange({ rowId: '1', colField: 'name' }, { rowId: '2', colField: 'name' });
		expect(store.rows().getSelected()).toEqual([
			{ id: '1', name: 'Product A+', price: 10 },
			{ id: '2', name: 'Product B', price: 20 },
		]);
		expect(store.rows().getSelectedIds()).toEqual(['1', '2']);

		// Getters & Count
		expect(store.rows().getCount()).toBe(2);
		expect(store.rows().getById('1')).toEqual({ id: '1', name: 'Product A+', price: 10 });
		expect(store.rows().getNodeById('2')?.data?.name).toBe('Product B');
		expect(store.rows().getVisualRowById('1')?.kind).toBe('data');

		// Range testing
		const range = { start: { rowId: '1', colField: 'name' }, end: { rowId: '2', colField: 'name' } };
		expect(store.rows().inRange(range).getIds()).toEqual(['1', '2']);
		expect(store.rows().inRange(range).getData()).toEqual([
			{ id: '1', name: 'Product A+', price: 10 },
			{ id: '2', name: 'Product B', price: 20 },
		]);

		const rangeProcessed: string[] = [];
		store
			.rows()
			.inRange(range)
			.forEach((id, idx) => {
				rangeProcessed.push(`${id}-${idx}`);
			});
		expect(rangeProcessed).toEqual(['1-0', '2-1']);

		controller.dispose();
	});

	it('delegates getRowLoadState to the row model instead of re-deriving from getVisualRow', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		store.registerRowModel({
			getVisualRow: () =>
				({
					kind: 'data',
					id: 'row:1',
					rowId: '1',
					node: { id: '1', data: { id: '1', name: 'Visible Row', price: 1 } },
					depth: 0,
				}) as any,
			getVisualRowCount: () => 1,
			getKnownRowCount: () => 1,
			getEstimatedRowCount: () => 1,
			getRowCountKind: () => 'known',
			getVisualIndexById: () => 0,
			getVisualIndexByRowId: () => 0,
			getRowNodeById: () => null,
			getRawRowById: () => null,
			getRowLoadState: () => ({ kind: 'failed', error: 'authoritative row-model state', retryable: true }) as const,
			isRowLoaded: () => false,
			isRowLoading: () => false,
			isRowFailed: () => true,
			isRangeLoaded: () => false,
			getRangeLoadState: () => ({ loaded: 0, loading: 0, failed: 1, placeholder: 0, missing: 0 }),
			ensureRange: () => {},
			refresh: () => ({ changed: false }),
		} as any);

		expect(store.getRowLoadState(0)).toEqual({
			kind: 'failed',
			error: 'authoritative row-model state',
			retryable: true,
		});

		store.destroy();
	});

	it('routes public row-node updateData and setData through the loaded-row write path on infinite and server-side models', async () => {
		const infiniteStore = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name', width: 100 },
				{ field: 'price', header: 'Price', width: 100 },
			],
			getRowId: (row) => row.id,
		});
		const infiniteController = new InfiniteRowModelController<TestRow>(infiniteStore.getInfiniteRowModelRuntime(), {
			columns: infiniteStore.getState().columns,
			getRowId: (row) => row.id,
			blockSize: 25,
			datasource: {
				getRows: vi.fn().mockResolvedValue({
					rows: [{ id: '1', name: 'Alpha', price: 10 }],
					totalCount: 1,
				}),
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		const infiniteNode = infiniteStore.getRowNode('1');
		expect(infiniteNode?.updateData({ name: 'Alpha+' }).status).toBe('applied');
		expect(infiniteStore.getRawRowById('1')).toEqual({ id: '1', name: 'Alpha+', price: 10 });

		const serverStore = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name', width: 100 },
				{ field: 'price', header: 'Price', width: 100 },
			],
			getRowId: (row) => row.id,
		});
		const serverController = new ServerSideRowModelController<TestRow>(serverStore.getServerSideRowModelRuntime(), {
			columns: serverStore.getState().columns,
			getRowId: (row) => row.id,
			blockSize: 10,
			datasource: {
				getRows: vi.fn().mockResolvedValue({
					rows: [{ id: '2', name: 'Beta', price: 20 }],
					rowCount: 1,
				}),
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		const serverNode = serverStore.getRowNode('2');
		expect(serverNode?.setData({ id: '2', name: 'Beta+', price: 25 }).status).toBe('applied');
		expect(serverStore.getRawRowById('2')).toEqual({ id: '2', name: 'Beta+', price: 25 });

		infiniteController.dispose();
		infiniteStore.destroy();
		serverController.dispose();
		serverStore.destroy();
	});

	it('exposes public row-node validation and integrity helpers through the authoritative integrity api', async () => {
		const store = new GridStore<TestRow>(
			{
				columns: [{ field: 'name', header: 'Name', width: 100 }],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						rowRules: [
							{
								id: 'name-required',
								validate: ({ row }) => (!row.name ? { message: 'Name is required' } : null),
							},
						],
					},
				},
			}
		);
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: '', price: 10 }],
			columns: store.getState().columns,
		});

		const node = store.getRowNode('1');
		const validationResult = await node?.validate?.();
		expect(validationResult).toEqual(
			expect.objectContaining({
				status: 'validationFailed',
				reason: 'Name is required',
			})
		);
		expect(node?.getValidationState?.()).toEqual(
			expect.objectContaining({
				valid: false,
				issues: expect.arrayContaining([expect.objectContaining({ rowId: '1', message: 'Name is required' })]),
			})
		);
		expect(node?.getIntegrityIssues?.()).toEqual(expect.arrayContaining([expect.objectContaining({ rowId: '1', message: 'Name is required' })]));
		expect(await node?.refreshIntegrity?.()).toEqual(expect.objectContaining({ status: 'validationFailed', reason: 'Name is required' }));

		controller.dispose();
		store.destroy();
	});

	it('exposes failed displayed rows as public failed row-node facades', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		store.registerRowModel(
			createMinimalRowModel({
				visualRows: [{ kind: 'failed', id: 'failed:0', rowIndex: 0, error: 'load failed', retryable: true }],
			})
		);

		expect(store.getRowLoadState(0)).toEqual({ kind: 'failed', error: 'load failed', retryable: true });
		const displayedNode = store.getDisplayedRowAtIndex(0);
		expect(displayedNode?.id).toBe('failed:0');
		expect(displayedNode?.kind).toBe('failed');
		expect(displayedNode?.failed).toBe(true);
		expect(displayedNode?.editable).toBe(false);
	});

	it('retries failed displayed rows through the row-model authority path', async () => {
		let callCount = 0;
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			getRowId: (row) => row.id,
		});
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			getRowId: (row) => row.id,
			blockSize: 5,
			datasource: {
				getRows: vi.fn().mockImplementation(() => {
					callCount++;
					if (callCount === 1) return Promise.reject(new Error('block failed'));
					return Promise.resolve({
						rows: [{ id: '1', name: 'Recovered', price: 1 }],
						rowCount: 1,
					});
				}),
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		const failedNode = store.getDisplayedRowAtIndex(0);
		expect(failedNode?.kind).toBe('failed');
		expect(failedNode?.retryLoad().status).toBe('applied');

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(store.getDisplayedRowAtIndex(0)?.kind).toBe('data');
		expect(store.getRawRowById('1')?.name).toBe('Recovered');

		controller.dispose();
		store.destroy();
	});

	it('compiles immutable grid plans and rebuilds them only for column geometry or pin changes', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});

		const first = store.engine.columns.getCompiledPlan();
		const second = store.engine.columns.getCompiledPlan();
		expect(second).toBe(first);
		expect(first.displayedColumns.map((column) => column.field)).toEqual(['id', 'name', 'price']);
		expect(first.totalWidth).toBe(300);

		store.setColumnWidth('name', 200);
		const afterWidth = store.engine.columns.getCompiledPlan();
		expect(afterWidth).not.toBe(first);
		expect(afterWidth.version).toBeGreaterThan(first.version);
		expect(afterWidth.colWidths[1]).toBe(200);

		const stable = store.engine.columns.getCompiledPlan();
		expect(stable).toBe(afterWidth);

		store.setPinnedColumns({ left: 1, right: 1 });
		const afterPins = store.engine.columns.getCompiledPlan();
		expect(afterPins).not.toBe(afterWidth);
		expect(afterPins.pinLeftWidth).toBe(50);
		expect(afterPins.pinRightStart).toBe(2);
		expect(afterPins.pinRightWidth).toBe(100);
	});

	it('normalizes explicit renderer tiers into compiled column plans', () => {
		const domRenderer = {
			mount: (container: HTMLElement) => {
				container.textContent = 'dom';
				return { update: () => {} };
			},
		};
		const reactRenderer = () => null;
		const imperativeRenderer = () => null;
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', renderer: { kind: 'text' } },
				{ field: 'name', header: 'Name', renderer: { kind: 'dom', renderer: domRenderer } },
				{ field: 'price', header: 'Price', renderer: { kind: 'react', component: reactRenderer } },
				{ field: 'tier', header: 'Tier', renderer: { kind: 'imperativeReact', component: imperativeRenderer } } as any,
			],
		});

		const plan = store.engine.columns.getCompiledPlan();
		expect(plan.columnPlans.map((columnPlan) => columnPlan.mode)).toEqual(['primitive', 'custom-dom', 'custom', 'custom-imperative']);
		expect(plan.displayedColumns[1].cellRenderer).toBe(domRenderer);
		expect(plan.displayedColumns[1].cellRendererCapabilities?.scroll).toBe('live');
		expect(plan.displayedColumns[2].cellRendererCapabilities?.scroll).toBe('text');
		expect(plan.displayedColumns[3].cellRendererCapabilities?.scroll).toBe('live');
		expect(plan.displayedColumns[3].cellRendererCapabilities?.imperative).toBe(true);
		expect(plan.hasCustomRenderers).toBe(true);
		expect(plan.hasDomRenderers).toBe(true);
	});

	it('coalesces api.transaction render invalidations into one render request', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Product A', price: 10 },
				{ id: '2', name: 'Product B', price: 20 },
			],
			columns: store.getState().columns,
		});
		const renderInvalidated = vi.fn();
		store.addEventListener(GridEventName.renderInvalidated, renderInvalidated);

		store.transaction({
			columns: [
				{ field: 'id', header: 'ID', width: 70 },
				{ field: 'name', header: 'Name', width: 180 },
				{ field: 'price', header: 'Price', width: 100 },
			],
			rows: { update: [{ id: '2', name: 'Product B+', price: 22 }] },
			filterModel: { name: { type: 'text', operator: 'contains', value: 'Product' } },
			pins: { left: 1, right: 1 },
		});

		expect(renderInvalidated).toHaveBeenCalledTimes(1);
		expect(store.getPinnedColumns()).toEqual({ left: 1, right: 1 });
		expect(store.getState().filterModel).toEqual({ name: { type: 'text', operator: 'contains', value: 'Product' } });

		controller.dispose();
	});

	it('setFilterModel keeps state, domain versions, history, events, and render requests coherent', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
				{ field: 'price', header: 'Price', width: 100 },
			],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alpha', price: 10 },
				{ id: '2', name: 'Beta', price: 20 },
				{ id: '3', name: 'Gamma', price: 30 },
			],
			columns: store.getState().columns,
		});
		const renderInvalidated = vi.fn();
		const filterChanged = vi.fn();
		const rowsDomain = vi.fn();
		const filteringDomain = vi.fn();
		const domainSnapshots: Array<{ rows: number; filtering: number }> = [];
		const initialVersions = {
			rows: store.engine.getDomainVersions().rows,
			filtering: store.engine.getDomainVersions().filtering,
		};

		store.addEventListener(GridEventName.renderInvalidated, renderInvalidated);
		store.addEventListener(GridEventName.filterChanged, filterChanged);
		store.subscribeDomain('rows', rowsDomain);
		store.subscribeDomain('filtering', filteringDomain);
		store.subscribeToDomainVersions((versions) => {
			domainSnapshots.push({ rows: versions.rows, filtering: versions.filtering });
		});
		const initialRowsDomainCalls = rowsDomain.mock.calls.length;
		const initialFilteringDomainCalls = filteringDomain.mock.calls.length;

		const filterModel = { name: { type: 'text', operator: 'contains', value: 'a' } } as const;

		store.setFilterModel(filterModel);

		expect(store.getState().filterModel).toEqual(filterModel);
		expect(renderInvalidated).toHaveBeenCalledTimes(1);
		expect(renderInvalidated).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { reason: 'rows:set-filter-model' } }));
		expect(filterChanged).toHaveBeenCalledTimes(1);
		expect(filterChanged).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { filterModel } }));
		expect(rowsDomain.mock.calls.length - initialRowsDomainCalls).toBe(2);
		expect(filteringDomain.mock.calls.length - initialFilteringDomainCalls).toBe(1);
		expect(store.engine.getDomainVersions()).toMatchObject({
			rows: initialVersions.rows + 2,
			filtering: initialVersions.filtering + 1,
		});
		expect(domainSnapshots.at(-1)).toMatchObject({
			rows: initialVersions.rows + 2,
			filtering: initialVersions.filtering + 1,
		});
		expect(store.canUndo()).toBe(true);

		store.undo();

		expect(store.getState().filterModel).toBeNull();
		expect(renderInvalidated).toHaveBeenCalledTimes(2);
		expect(filterChanged).toHaveBeenCalledTimes(2);
		expect(filterChanged).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { filterModel: null } }));
		expect(rowsDomain.mock.calls.length - initialRowsDomainCalls).toBe(4);
		expect(filteringDomain.mock.calls.length - initialFilteringDomainCalls).toBe(2);
		expect(store.engine.getDomainVersions()).toMatchObject({
			rows: initialVersions.rows + 4,
			filtering: initialVersions.filtering + 2,
		});
		expect(domainSnapshots.at(-1)).toMatchObject({
			rows: initialVersions.rows + 4,
			filtering: initialVersions.filtering + 2,
		});

		controller.dispose();
	});

	it('captures event-listener faults as runtime diagnostics instead of throwing through the bus', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A', price: 10 }],
			columns: store.getState().columns,
		});
		const runtimeFault = vi.fn();
		store.addEventListener(GridEventName.runtimeFault, runtimeFault);
		store.addEventListener(GridEventName.selectionChanged, () => {
			throw new Error('selection listener exploded');
		});

		expect(() => store.selectCell({ rowId: '1', colField: 'name' })).not.toThrow();

		expect(runtimeFault).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					source: 'event-bus',
					operation: GridEventName.selectionChanged,
					message: 'selection listener exploded',
				}),
			})
		);
		expect(store.getRuntimeFaults()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: 'event-bus',
					operation: GridEventName.selectionChanged,
				}),
			])
		);

		store.clearRuntimeFaults();
		expect(store.getRuntimeFaults()).toEqual([]);

		controller.dispose();
		store.destroy();
	});

	it('captures plugin lifecycle faults through the runtime fault reporter', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const runtimeFault = vi.fn();
		store.addEventListener(GridEventName.runtimeFault, runtimeFault);

		store.registerPlugin({
			name: 'broken-plugin',
			onInit() {
				throw new Error('plugin init failed');
			},
		});

		expect(runtimeFault).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					source: 'plugin-registry',
					operation: 'onInit',
					message: 'plugin init failed',
					context: { pluginName: 'broken-plugin' },
				}),
			})
		);
	});

	it('integrity rejects unsupported allRows scans on infinite grids without pretending completeness', async () => {
		const store = new GridStore<TestRow>(
			{
				columns: [{ field: 'name', header: 'Name', width: 100 }],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: true,
				},
			}
		);
		const controller = new InfiniteRowModelController<TestRow>(store.getInfiniteRowModelRuntime(), {
			columns: store.getState().columns,
			getRowId: (row) => row.id,
			datasource: {
				getRows: async () => ({
					rows: [{ id: '1', name: 'Alpha', price: 10 }],
					totalCount: 1,
				}),
			},
			blockSize: 25,
		});

		const result = await store.integrity.run({ scope: 'allRows' });

		expect(result).toMatchObject({
			status: 'unsupported',
			scope: 'allRows',
			reason: 'Infinite row model cannot authoritatively scan allRows without a serverProvided report.',
		});

		controller.dispose();
		store.destroy();
	});

	it('integrity reports loadedRows as an explicit partial server-side scope', async () => {
		const store = new GridStore<TestRow>(
			{
				columns: [{ field: 'name', header: 'Name', width: 100 }],
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: true,
				},
			}
		);
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			getRowId: (row) => row.id,
			blockSize: 10,
			datasource: {
				getRows: async () => ({
					rows: [{ id: '1', name: 'Alpha', price: 10 }],
					rowCount: 1,
				}),
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		const result = await store.integrity.run({ scope: 'loadedRows' });

		expect(result).toMatchObject({
			status: 'completed',
			scope: 'loadedRows',
			complete: false,
			capability: {
				level: 'partial',
			},
		});

		controller.dispose();
		store.destroy();
	});

	it('publishes server-side store state through the engine without reusing legacy page state', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		store.engine.setServerSideState({
			loading: true,
			error: null,
			storeStates: [
				{
					storeId: 'root',
					route: [],
					level: 0,
					rowCountState: { kind: 'unknown' },
					blockCount: 0,
					loadingBlockCount: 1,
					failedBlockCount: 0,
					childStoreCount: 0,
				},
			],
		});

		expect(store.getState().serverSide).toEqual({
			loading: true,
			error: null,
			storeStates: [
				{
					storeId: 'root',
					route: [],
					level: 0,
					rowCountState: { kind: 'unknown' },
					blockCount: 0,
					loadingBlockCount: 1,
					failedBlockCount: 0,
					childStoreCount: 0,
				},
			],
		});
		expect(store.getServerSideStoreState()).toEqual([
			{
				storeId: 'root',
				route: [],
				level: 0,
				rowCountState: { kind: 'unknown' },
				blockCount: 0,
				loadingBlockCount: 1,
				failedBlockCount: 0,
				childStoreCount: 0,
			},
		]);
	});

	it('publishServerSideState updates state and emits a server-side state event together', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const listener = vi.fn();
		store.addEventListener(GridEventName.serverSideStateChanged, listener);

		store.engine.publishServerSideState({
			loading: false,
			error: 'boom',
			storeStates: [
				{
					storeId: 'root',
					route: [],
					level: 0,
					rowCountState: { kind: 'known', count: 3 },
					blockCount: 1,
					loadingBlockCount: 0,
					failedBlockCount: 1,
					childStoreCount: 0,
				},
			],
		});

		expect(store.getState().serverSide).toEqual({
			loading: false,
			error: 'boom',
			storeStates: [
				{
					storeId: 'root',
					route: [],
					level: 0,
					rowCountState: { kind: 'known', count: 3 },
					blockCount: 1,
					loadingBlockCount: 0,
					failedBlockCount: 1,
					childStoreCount: 0,
				},
			],
		});
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: {
					loading: false,
					error: 'boom',
					storeStates: [
						{
							storeId: 'root',
							route: [],
							level: 0,
							rowCountState: { kind: 'known', count: 3 },
							blockCount: 1,
							loadingBlockCount: 0,
							failedBlockCount: 1,
							childStoreCount: 0,
						},
					],
				},
			})
		);
	});

	it('delegates SSRM public API calls to a server-side controllable row model', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const datasource: ServerSideDatasource<TestRow> = {
			getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
		};
		const storeState: ServerSideStoreSnapshot[] = [
			{
				storeId: '',
				route: [],
				level: 0,
				rowCountState: { kind: 'known', count: 0 },
				blockCount: 0,
				loadingBlockCount: 0,
				failedBlockCount: 0,
				childStoreCount: 0,
			},
		];
		const setServerSideDatasource = vi.fn();
		const refreshServerSide = vi.fn();
		const purgeServerSide = vi.fn();
		const getServerSideStoreState = vi.fn(() => storeState);
		const rowModel = {
			...createMinimalRowModel<TestRow>({ visualRows: [] }),
			setServerSideDatasource,
			refreshServerSide,
			purgeServerSide,
			getServerSideStoreState,
		};

		store.registerRowModel(rowModel);

		const refreshOptions: ServerSideRefreshOptions = { route: ['region', 'EMEA'] };
		const purgeOptions = { route: ['region'] };
		store.setServerSideDatasource(datasource);
		store.refreshServerSide(refreshOptions);
		store.purgeServerSide(purgeOptions);

		expect(store.getRowModelType()).toBe('server');
		expect(setServerSideDatasource).toHaveBeenCalledWith(datasource);
		expect(refreshServerSide).toHaveBeenCalledWith(refreshOptions);
		expect(purgeServerSide).toHaveBeenCalledWith(purgeOptions);
		expect(store.getServerSideStoreState()).toBe(storeState);

		store.destroy();
	});

	it('avoids redundant state updates and geometry version increments on setRowHeights and setDefaultRowHeight', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
			rowHeights: { '1': 60 },
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Product A' }],
			columns: store.getState().columns,
		});

		const initialPlan = store.engine.columns.getCompiledPlan();
		const initialPlanVersion = initialPlan.version;
		const initialGeometryVersion = store.engine.geometryVersion;

		// Call setRowHeights with identical content but a new object reference
		store.setRowHeights({ '1': 60 });
		expect(store.engine.columns.getCompiledPlan().version).toBe(initialPlanVersion);
		expect(store.engine.geometryVersion).toBe(initialGeometryVersion);

		// Call setDefaultRowHeight with identical value
		store.setDefaultRowHeight(40);
		expect(store.engine.columns.getCompiledPlan().version).toBe(initialPlanVersion);
		expect(store.engine.geometryVersion).toBe(initialGeometryVersion);

		// Verify updates still apply when different
		store.setRowHeights({ '1': 80 });
		expect(store.engine.columns.getCompiledPlan().version).toBeGreaterThan(initialPlanVersion);
		expect(store.engine.geometryVersion).toBeGreaterThan(initialGeometryVersion);

		controller.dispose();
	});

	it('cell transaction — single undo entry restores all cells atomically', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name' },
				{ field: 'price', header: 'Price' },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'Alpha', price: 10 },
				{ id: '2', name: 'Beta', price: 20 },
			],
			columns: store.getState().columns,
		});

		store.transaction({
			cells: [
				{ rowId: '1', colField: 'name', value: 'Alpha Updated' },
				{ rowId: '1', colField: 'price', value: 99 },
				{ rowId: '2', colField: 'name', value: 'Beta Updated' },
			],
		});

		expect(store.getCellValue('1', 'name')).toBe('Alpha Updated');
		expect(store.getCellValue('1', 'price')).toBe(99);
		expect(store.getCellValue('2', 'name')).toBe('Beta Updated');
		expect(store.canUndo()).toBe(true);

		// One undo call restores all three cells — not just the last one
		store.undo();
		expect(store.getCellValue('1', 'name')).toBe('Alpha');
		expect(store.getCellValue('1', 'price')).toBe(10);
		expect(store.getCellValue('2', 'name')).toBe('Beta');
		expect(store.canUndo()).toBe(false);

		// Redo reapplies all three cells at once
		store.redo();
		expect(store.getCellValue('1', 'name')).toBe('Alpha Updated');
		expect(store.getCellValue('1', 'price')).toBe(99);
		expect(store.getCellValue('2', 'name')).toBe('Beta Updated');

		controller.dispose();
	});

	it('cell transaction — no-ops when no values change', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name' }],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alpha', price: 10 }],
			columns: store.getState().columns,
		});

		store.transaction({ cells: [{ rowId: '1', colField: 'name', value: 'Alpha' }] });
		expect(store.canUndo()).toBe(false);

		controller.dispose();
	});
	it('applyGridState restores persisted state without leaving undo history', () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'name', header: 'Name', width: 100 },
				{ field: 'price', header: 'Price', width: 100 },
			],
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alpha', price: 10 }],
			columns: store.getState().columns,
		});
		const subscriber = vi.fn();
		store.subscribe(subscriber);

		store.applyGridState({
			v: GRID_STATE_SCHEMA_VERSION,
			state: {
				columnWidths: { name: 180 },
				columnOrder: ['price', 'name'],
			},
		});

		expect(store.getState().columnWidths.name).toBe(180);
		expect(store.getState().columns.map((column) => column.field)).toEqual(['price', 'name']);
		expect(store.canUndo()).toBe(false);
		expect(subscriber).toHaveBeenCalledTimes(1);

		controller.dispose();
		store.destroy();
	});
});

describe('Column and row validation', () => {
	describe('validateColumns()', () => {
		it('throws on empty field', () => {
			expect(() => validateColumns([{ field: '' }])).toThrow('non-empty field');
		});

		it('allows duplicate fields when renderer identity is carried by distinct column instances', () => {
			expect(() => validateColumns([{ field: 'id' }, { field: 'name' }, { field: 'id' }])).not.toThrow();
		});

		it('throws on zero width', () => {
			expect(() => validateColumns([{ field: 'id', width: 0 }])).toThrow('invalid width');
		});

		it('throws on negative width', () => {
			expect(() => validateColumns([{ field: 'id', width: -10 }])).toThrow('invalid width');
		});

		it('throws on Infinity width', () => {
			expect(() => validateColumns([{ field: 'id', width: Infinity }])).toThrow('invalid width');
		});

		it('passes for valid columns', () => {
			expect(() =>
				validateColumns([
					{ field: 'id', width: 80 },
					{ field: 'name', width: 200 },
				])
			).not.toThrow();
		});

		it('passes for columns with no width', () => {
			expect(() => validateColumns([{ field: 'id' }, { field: 'name' }])).not.toThrow();
		});
	});

	describe('validateRowIds()', () => {
		it('throws on empty row ID', () => {
			expect(() => validateRowIds(['a', '', 'b'])).toThrow('empty string');
		});

		it('throws on duplicate row ID', () => {
			expect(() => validateRowIds(['a', 'b', 'a'])).toThrow('duplicate row ID "a"');
		});

		it('passes for valid IDs', () => {
			expect(() => validateRowIds(['a', 'b', 'c'])).not.toThrow();
		});
	});

	describe('GridStore validation integration', () => {
		it('allows construction with duplicate column fields', () => {
			expect(
				() =>
					new GridStore({
						columns: [{ field: 'id' }, { field: 'id' }],
					})
			).not.toThrow();
		});

		it('allows setColumns() with duplicate fields', () => {
			const store = new GridStore({ columns: [{ field: 'id' }] });
			expect(() => store.setColumns([{ field: 'name' }, { field: 'name' }])).not.toThrow();
		});

		it('accepts valid column updates via setColumns()', () => {
			const store = new GridStore({ columns: [{ field: 'id' }] });
			expect(() =>
				store.setColumns([
					{ field: 'id', width: 100 },
					{ field: 'name', width: 200 },
				])
			).not.toThrow();
		});
	});
});

describe('row multi-select', () => {
	const makeStore = () => {
		const store = new GridStore<TestRow>({
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 150 },
			],
			getRowId: (r) => r.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'row-1', name: 'Alice', price: 10 },
				{ id: 'row-2', name: 'Bob', price: 20 },
				{ id: 'row-3', name: 'Charlie', price: 30 },
			],
			columns: store.getState().columns,
		});
		return { store, controller };
	};

	it('selectedRowIds is empty by default', () => {
		const { store, controller } = makeStore();
		expect(store.getState().selectedRowIds).toEqual([]);
		controller.dispose();
	});

	it('selectRows adds to selectedRowIds', () => {
		const { store, controller } = makeStore();
		store.selectRows(['row-1', 'row-2']);
		expect(store.getState().selectedRowIds).toEqual(['row-1', 'row-2']);
		controller.dispose();
	});

	it('deselectRows removes from selectedRowIds', () => {
		const { store, controller } = makeStore();
		store.selectRows(['row-1', 'row-2']);
		store.deselectRows(['row-1']);
		expect(store.getState().selectedRowIds).toEqual(['row-2']);
		controller.dispose();
	});

	it('toggleRowSelection adds when not selected', () => {
		const { store, controller } = makeStore();
		store.toggleRowSelection('row-1');
		expect(store.getState().selectedRowIds).toContain('row-1');
		controller.dispose();
	});

	it('toggleRowSelection removes when already selected', () => {
		const { store, controller } = makeStore();
		store.selectRows(['row-1']);
		store.toggleRowSelection('row-1');
		expect(store.getState().selectedRowIds).not.toContain('row-1');
		controller.dispose();
	});

	it('clearRowSelection empties the list', () => {
		const { store, controller } = makeStore();
		store.selectRows(['row-1', 'row-2']);
		store.clearRowSelection();
		expect(store.getState().selectedRowIds).toEqual([]);
		controller.dispose();
	});

	it('isRowNodeSelected returns correct boolean', () => {
		const { store, controller } = makeStore();
		store.selectRows(['row-1']);
		expect(store.isRowNodeSelected('row-1')).toBe(true);
		expect(store.isRowNodeSelected('row-2')).toBe(false);
		controller.dispose();
	});

	it('getCheckedIds returns selected row IDs', () => {
		const { store, controller } = makeStore();
		store.selectRows(['row-1']);
		expect(store.rows().getCheckedIds()).toEqual(['row-1']);
		controller.dispose();
	});

	it('getChecked returns selected row data', () => {
		const { store, controller } = makeStore();
		store.selectRows(['row-1']);
		const checked = store.rows().getChecked();
		expect(checked).toHaveLength(1);
		expect(checked[0]).toMatchObject({ id: 'row-1' });
		controller.dispose();
	});

	it('rowSelectionChanged event fires on toggle', () => {
		const { store, controller } = makeStore();
		const handler = vi.fn();
		store.addEventListener(GridEventName.rowSelectionChanged, handler);
		store.toggleRowSelection('row-1');
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					selectedRowIds: ['row-1'],
					changedRowIds: ['row-1'],
					addedRowIds: ['row-1'],
					removedRowIds: [],
					source: 'api',
				}),
			})
		);
		controller.dispose();
	});

	it('row selection gestures include source metadata and targeted invalidations', () => {
		const { store, controller } = makeStore();
		const handler = vi.fn();
		store.addEventListener(GridEventName.rowSelectionChanged, handler);
		store.engine.invalidation.consume();

		const result = store.applyRowSelectionGesture({ kind: 'toggle', rowIds: ['row-1'], source: 'checkbox' });
		const frame = store.engine.invalidation.consume();

		expect(result).toEqual({
			selectedRowIds: ['row-1'],
			changedRowIds: ['row-1'],
			addedRowIds: ['row-1'],
			removedRowIds: [],
			source: 'checkbox',
		});
		expect(handler).toHaveBeenCalledWith(expect.objectContaining({ payload: result }));
		expect(frame.full).toBe(false);
		expect(frame.viewport).toBe(false);
		expect(frame.rows).toEqual(new Set(['row-1']));
		expect(frame.headers).toBe(true);
		expect(frame.invalidations).toContainEqual({ kind: 'row', rowId: 'row-1', reason: 'selection' });
		expect(frame.invalidations).toContainEqual({ kind: 'headers', reason: 'selection' });
		controller.dispose();
	});

	it('selectRows is idempotent', () => {
		const { store, controller } = makeStore();
		const handler = vi.fn();
		store.addEventListener(GridEventName.rowSelectionChanged, handler);
		store.selectRows(['row-1']);
		store.engine.invalidation.consume();
		store.selectRows(['row-1']);
		expect(store.getState().selectedRowIds).toEqual(['row-1']);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(store.engine.invalidation.consume().invalidations).toEqual([]);
		controller.dispose();
	});
});

describe('groupBy mutation API', () => {
	const makeGroupStore = () =>
		new GridStore<{ id: string; region: string; country: string; category: string }>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'region', header: 'Region', enableRowGroup: true },
				{ field: 'country', header: 'Country', enableRowGroup: true },
				{ field: 'category', header: 'Category', enableRowGroup: true },
			],
		});

	it('addGroupBy appends a column to an empty groupBy', () => {
		const store = makeGroupStore();
		store.addGroupBy('region');
		expect(store.getGroupBy()).toEqual(['region']);
		store.destroy();
	});

	it('addGroupBy inserts at specified index', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region', 'category']);
		store.addGroupBy('country', 1);
		expect(store.getGroupBy()).toEqual(['region', 'country', 'category']);
		store.destroy();
	});

	it('addGroupBy appends when index > length', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region']);
		store.addGroupBy('country', 99);
		expect(store.getGroupBy()).toEqual(['region', 'country']);
		store.destroy();
	});

	it('addGroupBy is idempotent — ignores duplicates', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region', 'country']);
		store.addGroupBy('region');
		expect(store.getGroupBy()).toEqual(['region', 'country']);
		store.destroy();
	});

	it('removeGroupBy removes an existing column', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region', 'country', 'category']);
		store.removeGroupBy('country');
		expect(store.getGroupBy()).toEqual(['region', 'category']);
		store.destroy();
	});

	it('removeGroupBy is a no-op for unknown column', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region']);
		store.removeGroupBy('country');
		expect(store.getGroupBy()).toEqual(['region']);
		store.destroy();
	});

	it('moveGroupBy reorders an existing column', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region', 'country', 'category']);
		store.moveGroupBy('region', 2);
		expect(store.getGroupBy()).toEqual(['country', 'category', 'region']);
		store.destroy();
	});

	it('moveGroupBy is a no-op when target is same position', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region', 'country']);
		const handler = vi.fn();
		store.addEventListener(GridEventName.groupColumnMoved, handler);
		store.moveGroupBy('region', 0);
		expect(handler).not.toHaveBeenCalled();
		store.destroy();
	});

	it('moveGroupBy is a no-op for unknown column', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region']);
		const handler = vi.fn();
		store.addEventListener(GridEventName.groupColumnMoved, handler);
		store.moveGroupBy('category', 0);
		expect(handler).not.toHaveBeenCalled();
		store.destroy();
	});

	it('addGroupBy fires groupColumnAdded event with correct payload', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region']);
		const handler = vi.fn();
		store.addEventListener(GridEventName.groupColumnAdded, handler);
		store.addGroupBy('country', 1);
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: { colId: 'country', index: 1, groupBy: ['region', 'country'] },
			})
		);
		store.destroy();
	});

	it('removeGroupBy fires groupColumnRemoved event', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region', 'country']);
		const handler = vi.fn();
		store.addEventListener(GridEventName.groupColumnRemoved, handler);
		store.removeGroupBy('region');
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: { colId: 'region', groupBy: ['country'] },
			})
		);
		store.destroy();
	});

	it('moveGroupBy fires groupColumnMoved event with fromIndex and toIndex', () => {
		const store = makeGroupStore();
		store.setGroupBy(['region', 'country', 'category']);
		const handler = vi.fn();
		store.addEventListener(GridEventName.groupColumnMoved, handler);
		store.moveGroupBy('region', 2);
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: { colId: 'region', fromIndex: 0, toIndex: 2, groupBy: ['country', 'category', 'region'] },
			})
		);
		store.destroy();
	});

	it('addGroupBy repaints fully when the first group adds the hierarchy column, then targets later levels', () => {
		const store = makeGroupStore();
		store.engine.invalidation.consume();
		store.addGroupBy('region');
		expect(store.engine.invalidation.consume().full).toBe(true);

		const next = store.getState().columns.find((column) => column.field !== 'region' && !column.field.startsWith('__'))!.field;
		store.addGroupBy(next);
		const frame = store.engine.invalidation.consume();
		expect(frame.full).toBe(false);
		expect(frame.geometry).toBe(true);
		expect(frame.viewport).toBe(true);
		store.destroy();
	});

	it('setShowGroupPanel toggles showGroupPanel state', () => {
		const store = makeGroupStore();
		expect(store.getState().showGroupPanel).toBeUndefined();
		store.setShowGroupPanel(true);
		expect(store.getState().showGroupPanel).toBe(true);
		store.setShowGroupPanel(false);
		expect(store.getState().showGroupPanel).toBe(false);
		store.destroy();
	});

	it('setShowFilterChipBar toggles showFilterChipBar state', () => {
		const store = makeGroupStore();
		expect(store.getState().showFilterChipBar).toBeUndefined();
		store.setShowFilterChipBar(true);
		expect(store.getState().showFilterChipBar).toBe(true);
		store.setShowFilterChipBar(false);
		expect(store.getState().showFilterChipBar).toBe(false);
		store.destroy();
	});
});

describe('Quick filter (search across columns)', () => {
	it('setQuickFilter updates state and emits quickFilterChanged, but is not undoable', () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
			rows: [{ id: '1', name: 'Alpha', price: 10 }],
			columns: store.getState().columns,
		});

		const quickFilterChanged = vi.fn();
		store.addEventListener(GridEventName.quickFilterChanged, quickFilterChanged);

		store.setQuickFilter('alp');

		expect(store.getState().quickFilterModel).toEqual({ text: 'alp', columnIds: undefined });
		expect(store.getQuickFilter()).toEqual({ text: 'alp', columnIds: undefined });
		expect(quickFilterChanged).toHaveBeenCalledTimes(1);
		expect(quickFilterChanged).toHaveBeenLastCalledWith(
			expect.objectContaining({ payload: { quickFilterModel: { text: 'alp', columnIds: undefined } } })
		);

		// Search-box text should not pollute the undo stack.
		expect(store.canUndo()).toBe(false);

		store.setQuickFilter('');
		expect(store.getState().quickFilterModel).toBeNull();
		expect(quickFilterChanged).toHaveBeenCalledTimes(2);
		expect(quickFilterChanged).toHaveBeenLastCalledWith(expect.objectContaining({ payload: { quickFilterModel: null } }));

		controller.dispose();
		store.destroy();
	});

	it('passes quickFilterModel through to the infinite datasource and purges the cache on change', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			getRowId: (row) => row.id,
		});
		const getRows = vi.fn(
			async (): Promise<{ rows: TestRow[]; totalCount: number }> => ({
				rows: [{ id: '1', name: 'Alpha', price: 10 }],
				totalCount: 1,
			})
		);
		const controller = new InfiniteRowModelController<TestRow>(store.getInfiniteRowModelRuntime(), {
			columns: store.getState().columns,
			getRowId: (row) => row.id,
			datasource: { getRows },
			blockSize: 25,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		const callsBefore = getRows.mock.calls.length;

		store.setQuickFilter('alp', ['name']);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows.mock.calls.length).toBeGreaterThan(callsBefore);
		const lastCallParams = getRows.mock.calls.at(-1)?.[0];
		expect(lastCallParams?.quickFilterModel).toEqual({ text: 'alp', columnIds: ['name'] });

		controller.dispose();
		store.destroy();
	});

	it('passes quickFilterModel through to the server-side datasource and refetches on change', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			getRowId: (row) => row.id,
		});
		const getRows = vi.fn(
			async (): Promise<{ rows: TestRow[]; rowCount: number }> => ({
				rows: [{ id: '1', name: 'Alpha', price: 10 }],
				rowCount: 1,
			})
		);
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			getRowId: (row) => row.id,
			blockSize: 10,
			datasource: { getRows },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		const callsBefore = getRows.mock.calls.length;

		store.setQuickFilter('alp');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getRows.mock.calls.length).toBeGreaterThan(callsBefore);
		const lastCallParams = getRows.mock.calls.at(-1)?.[0];
		expect(lastCallParams?.quickFilterModel).toEqual({ text: 'alp', columnIds: undefined });

		controller.dispose();
		store.destroy();
	});
});
