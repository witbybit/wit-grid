import { FLAT_HIERARCHY } from './visualRow.js';
import { describe, expect, it, vi } from 'vitest';
import {
	createServerSideGetRowsRequest,
	normalizeServerSideGetRowsResult,
	resolveServerSideRowCountState,
	ServerSideRowModelController,
} from './serverSideRowModel.js';
import type { ServerSideRowGroupColumn, ServerSideValueColumn } from './serverSideRowModel.js';
import { createServerSideGrid } from './createGrid.js';
import { GridStore } from './store.js';
import { GridEventName } from './api/GridEvents.js';

interface TestRow {
	id: string;
	name: string;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('serverSideRowModel request factory', () => {
	it('creates immutable root request defaults', () => {
		const request = createServerSideGetRowsRequest({
			startRow: 0,
			endRow: 100,
		});

		expect(request).toEqual({
			startRow: 0,
			endRow: 100,
			route: [],
			groupKeys: [],
			rowGroupColumns: [],
			valueColumns: [],
			sortModel: null,
			filterModel: null,
			quickFilterModel: null,
			queryModel: null,
		});
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.route)).toBe(true);
		expect(Object.isFrozen(request.groupKeys)).toBe(true);
		expect(Object.isFrozen(request.rowGroupColumns)).toBe(true);
		expect(Object.isFrozen(request.valueColumns)).toBe(true);
		expect(() => (request.route as string[]).push('region')).toThrow();
	});

	it('clones route, group keys, and column metadata before datasource ownership', () => {
		const route = ['emea'];
		const groupKeys = ['emea'];
		const rowGroupColumns: ServerSideRowGroupColumn[] = [{ colId: 'region', field: 'region' }];
		const valueColumns: ServerSideValueColumn[] = [{ colId: 'amount', field: 'amount', aggFunc: 'sum' }];

		const request = createServerSideGetRowsRequest({
			startRow: 25,
			endRow: 50,
			route,
			groupKeys,
			rowGroupColumns,
			valueColumns,
		});

		route.push('mutated');
		groupKeys.push('mutated');
		rowGroupColumns[0] = { colId: 'customer' };
		valueColumns[0] = { colId: 'quantity' };

		expect(request.route).toEqual(['emea']);
		expect(request.groupKeys).toEqual(['emea']);
		expect(request.rowGroupColumns).toEqual([{ colId: 'region', field: 'region' }]);
		expect(request.valueColumns).toEqual([{ colId: 'amount', field: 'amount', aggFunc: 'sum' }]);
		expect(Object.isFrozen(request.rowGroupColumns[0])).toBe(true);
		expect(Object.isFrozen(request.valueColumns[0])).toBe(true);
		expect(() => ((request.rowGroupColumns[0] as { colId: string }).colId = 'mutated')).toThrow();
	});

	it('uses the route as default group keys for child-store requests', () => {
		const request = createServerSideGetRowsRequest({
			startRow: 0,
			endRow: 10,
			route: ['region', 'EMEA'],
		});

		expect(request.route).toEqual(['region', 'EMEA']);
		expect(request.groupKeys).toEqual(['region', 'EMEA']);
		expect(request.groupKeys).not.toBe(request.route);
	});

	it('rejects invalid block ranges', () => {
		expect(() => createServerSideGetRowsRequest({ startRow: -1, endRow: 10 })).toThrow('Invalid server-side request startRow: -1');
		expect(() => createServerSideGetRowsRequest({ startRow: 10.5, endRow: 20 })).toThrow('Invalid server-side request startRow: 10.5');
		expect(() => createServerSideGetRowsRequest({ startRow: 20, endRow: 10 })).toThrow('Invalid server-side request endRow: 10');
		expect(() => createServerSideGetRowsRequest({ startRow: 0, endRow: 10.5 })).toThrow('Invalid server-side request endRow: 10.5');
	});
});

describe('serverSideRowModel row-count state', () => {
	it('returns known empty when the datasource returns a zero-row short block', () => {
		expect(resolveServerSideRowCountState({ startRow: 0, endRow: 100, returnedRowCount: 0 })).toEqual({
			kind: 'known',
			count: 0,
		});
	});

	it('returns estimated while full blocks imply more rows may exist', () => {
		expect(resolveServerSideRowCountState({ startRow: 0, endRow: 100, returnedRowCount: 100 })).toEqual({
			kind: 'estimated',
			count: 100,
		});
		expect(resolveServerSideRowCountState({ startRow: 100, endRow: 200, returnedRowCount: 100, hasMore: true })).toEqual({
			kind: 'estimated',
			count: 201,
		});
	});

	it('returns known counts from rowCount, lastRow, hasMore false, and short blocks', () => {
		expect(resolveServerSideRowCountState({ startRow: 0, endRow: 100, returnedRowCount: 100, rowCount: 350 })).toEqual({
			kind: 'known',
			count: 350,
		});
		expect(resolveServerSideRowCountState({ startRow: 100, endRow: 200, returnedRowCount: 100, lastRow: 225 })).toEqual({
			kind: 'known',
			count: 225,
		});
		expect(resolveServerSideRowCountState({ startRow: 200, endRow: 300, returnedRowCount: 25, hasMore: false })).toEqual({
			kind: 'known',
			count: 225,
		});
		expect(resolveServerSideRowCountState({ startRow: 200, endRow: 300, returnedRowCount: 25 })).toEqual({
			kind: 'known',
			count: 225,
		});
	});

	it('rejects contradictory terminal metadata', () => {
		expect(() => resolveServerSideRowCountState({ startRow: 0, endRow: 100, returnedRowCount: 100, rowCount: 150, lastRow: 151 })).toThrow(
			'Server-side datasource returned conflicting rowCount 150 and lastRow 151'
		);
		expect(() => resolveServerSideRowCountState({ startRow: 200, endRow: 300, returnedRowCount: 25, hasMore: false, rowCount: 300 })).toThrow(
			'Server-side datasource returned hasMore false but rowCount 300 does not match the loaded range ending at 224'
		);
		expect(() => resolveServerSideRowCountState({ startRow: 200, endRow: 300, returnedRowCount: 25, hasMore: true })).toThrow(
			'Server-side datasource returned 25 rows for range 200-299 but hasMore true still requires rows within that range'
		);
	});

	it('rejects impossible ranges and counts', () => {
		expect(() => resolveServerSideRowCountState({ startRow: -1, endRow: 100, returnedRowCount: 10 })).toThrow(
			'Invalid server-side request startRow: -1'
		);
		expect(() => resolveServerSideRowCountState({ startRow: 100, endRow: 99, returnedRowCount: 0 })).toThrow(
			'Invalid server-side request endRow: 99'
		);
		expect(() => resolveServerSideRowCountState({ startRow: 0, endRow: 10, returnedRowCount: 11 })).toThrow(
			'Server-side datasource returned 11 rows for requested range 0-9'
		);
		expect(() => resolveServerSideRowCountState({ startRow: 10, endRow: 20, returnedRowCount: 5, rowCount: 14 })).toThrow(
			'Server-side datasource returned rowCount 14, which is smaller than the loaded range ending at 14'
		);
	});
});

describe('serverSideRowModel result normalization', () => {
	it('normalizes row-count state and clones mutable result containers', () => {
		const rows = [{ id: 'a' }, { id: 'b' }];
		const groupMetadata = [
			{
				rowId: 'group-emea',
				route: ['region', 'EMEA'],
				groupKey: 'EMEA',
				expandable: true,
			},
		];
		const aggregateData = { amount: 42 };

		const normalized = normalizeServerSideGetRowsResult({
			request: { startRow: 0, endRow: 10 },
			result: {
				rows,
				hasMore: false,
				groupMetadata,
				aggregateData,
			},
		});

		rows.push({ id: 'c' });
		groupMetadata[0] = {
			rowId: 'group-amer',
			route: ['region', 'AMER'],
			groupKey: 'AMER',
			expandable: true,
		};
		aggregateData.amount = 100;

		expect(normalized.rows).toEqual([{ id: 'a' }, { id: 'b' }]);
		expect(normalized.rowCountState).toEqual({ kind: 'known', count: 2 });
		expect(normalized.groupMetadata).toEqual([
			{
				rowId: 'group-emea',
				route: ['region', 'EMEA'],
				groupKey: 'EMEA',
				expandable: true,
			},
		]);
		expect(normalized.aggregateData).toEqual({ amount: 42 });
		expect(Object.isFrozen(normalized)).toBe(true);
		expect(Object.isFrozen(normalized.rows)).toBe(true);
		expect(Object.isFrozen(normalized.groupMetadata)).toBe(true);
		expect(Object.isFrozen(normalized.groupMetadata[0])).toBe(true);
		expect(Object.isFrozen(normalized.groupMetadata[0]?.route)).toBe(true);
		expect(Object.isFrozen(normalized.aggregateData)).toBe(true);
	});

	it('rejects duplicate row ids within a normalized block', () => {
		expect(() =>
			normalizeServerSideGetRowsResult({
				request: { startRow: 0, endRow: 10 },
				result: {
					rows: [{ id: 'dup' }, { id: 'dup' }],
				},
				getRowId: (row) => row.id,
			})
		).toThrow('Server-side datasource returned duplicate row id "dup" within one block');
	});

	it('reuses terminal validation for impossible normalized results', () => {
		expect(() =>
			normalizeServerSideGetRowsResult({
				request: { startRow: 0, endRow: 2 },
				result: {
					rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
				},
			})
		).toThrow('Server-side datasource returned 3 rows for requested range 0-1');
	});
});

describe('ServerSideRowModelController', () => {
	it('loads the root store block and publishes committed rows through SSRM state', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const getRows = vi.fn(async () => ({
			rows: [
				{ id: 'a', name: 'Alpha' },
				{ id: 'b', name: 'Beta' },
			],
			rowCount: 2,
		}));

		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows },
			blockSize: 5,
			getRowId: (row) => row.id,
		});

		expect(getRows).toHaveBeenCalledTimes(1);
		expect(controller.getVisualRowCount()).toBe(5);
		expect(controller.getVisualRow(0)?.kind).toBe('loading');
		expect(store.getState().serverSide?.loading).toBe(true);

		await flushAsync();

		expect(controller.getVisualRowCount()).toBe(2);
		expect(controller.getRowCountKind()).toBe('known');
		expect(controller.getVisualRow(0)).toMatchObject({ kind: 'data', rowId: 'a' });
		expect(controller.getVisualRow(1)).toMatchObject({ kind: 'data', rowId: 'b' });
		expect(store.getServerSideStoreState()).toEqual([
			{
				storeId: '',
				route: [],
				level: 0,
				rowCountState: { kind: 'known', count: 2 },
				blockCount: 1,
				loadingBlockCount: 0,
				failedBlockCount: 0,
				childStoreCount: 0,
			},
		]);
		expect(controller.getBlockSnapshots()).toEqual([
			expect.objectContaining({
				storeId: '',
				blockIndex: 0,
				startRow: 0,
				endRow: 4,
				state: 'loaded',
				committedRowCount: 2,
			}),
		]);

		controller.dispose();
		store.destroy();
	});

	it('is constructed by createServerSideGrid and exposes the server row-model type', async () => {
		const getRows = vi.fn(async () => ({
			rows: [{ id: 'a', name: 'Alpha' }],
			rowCount: 1,
		}));
		const api = createServerSideGrid<TestRow>({
			columns: [{ field: 'name' }],
			datasource: { getRows },
			blockSize: 5,
			getRowId: (row) => row.id,
		});

		expect(api.getRowModelType()).toBe('server');
		expect(getRows).toHaveBeenCalledTimes(1);

		await flushAsync();

		expect(api.getDataRowAtVisualIndex(0)).toEqual({ id: 'a', name: 'Alpha' });
		expect(api.getServerSideStoreState()).toEqual([
			expect.objectContaining({
				storeId: '',
				rowCountState: { kind: 'known', count: 1 },
				blockCount: 1,
			}),
		]);

		api.destroy();
	});

	it('creates and loads a child store when an expandable server-side group row is expanded', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const getRows = vi.fn(async (request) => {
			if (request.route.length === 0) {
				return {
					rows: [{ id: 'group-emea', name: 'EMEA' }],
					rowCount: 1,
					groupMetadata: [
						{
							rowId: 'group-emea',
							route: ['region', 'EMEA'],
							groupKey: 'EMEA',
							expandable: true,
						},
					],
				};
			}
			expect(request.route).toEqual(['region', 'EMEA']);
			expect(request.groupKeys).toEqual(['region', 'EMEA']);
			return {
				rows: [
					{ id: 'emea-1', name: 'Berlin' },
					{ id: 'emea-2', name: 'Paris' },
				],
				rowCount: 2,
			};
		});
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows },
			blockSize: 5,
			getRowId: (row) => row.id,
		});

		await flushAsync();

		expect(controller.getVisualRow(0)).toMatchObject({
			kind: 'group',
			id: 'group:region=EMEA',
			groupId: 'group:region=EMEA',
			keyString: 'EMEA',
			hierarchy: { level: 0, parentId: null, hasChildren: true, expanded: false },
		});

		const refresh = controller.toggleGroupExpanded('group:region=EMEA');
		expect(refresh).toMatchObject({ changed: true, reason: 'expansion', groupId: 'group:region=EMEA' });
		expect(controller.isGroupExpanded('group:region=EMEA')).toBe(true);
		expect(getRows).toHaveBeenCalledTimes(2);

		await flushAsync();

		expect(store.getServerSideStoreState()).toEqual([
			expect.objectContaining({
				storeId: '',
				route: [],
				rowCountState: { kind: 'known', count: 1 },
				childStoreCount: 1,
			}),
			expect.objectContaining({
				storeId: '["region","EMEA"]',
				route: ['region', 'EMEA'],
				level: 2,
				rowCountState: { kind: 'known', count: 2 },
				blockCount: 1,
			}),
		]);
		expect(controller.getBlockSnapshots()).toEqual([
			expect.objectContaining({ storeId: '', blockIndex: 0, state: 'loaded', committedRowCount: 1 }),
			expect.objectContaining({ storeId: '["region","EMEA"]', blockIndex: 0, state: 'loaded', committedRowCount: 2 }),
		]);

		controller.dispose();
		store.destroy();
	});

	it('refreshes and purges child stores by route without purging the root store', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const getRows = vi.fn(async (request) => {
			if (request.route.length === 0) {
				return {
					rows: [{ id: 'group-emea', name: 'EMEA' }],
					rowCount: 1,
					groupMetadata: [
						{
							rowId: 'group-emea',
							route: ['region', 'EMEA'],
							groupKey: 'EMEA',
							expandable: true,
						},
					],
				};
			}
			return {
				rows: [{ id: `child-${getRows.mock.calls.length}`, name: 'Child' }],
				rowCount: 1,
			};
		});
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows },
			blockSize: 5,
			getRowId: (row) => row.id,
		});

		await flushAsync();
		controller.toggleGroupExpanded('group:region=EMEA');
		await flushAsync();

		controller.refreshServerSide({ route: ['region', 'EMEA'] });
		expect(getRows).toHaveBeenLastCalledWith(
			expect.objectContaining({ route: ['region', 'EMEA'], startRow: 0, endRow: 5 }),
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		expect(controller.getBlockSnapshots().filter((snapshot) => snapshot.storeId === '').length).toBe(1);

		await flushAsync();
		controller.purgeServerSide({ route: ['region', 'EMEA'] });

		expect(store.getServerSideStoreState()).toEqual([
			expect.objectContaining({
				storeId: '',
				childStoreCount: 0,
				rowCountState: { kind: 'known', count: 1 },
			}),
		]);
		expect(controller.getBlockSnapshots()).toEqual([expect.objectContaining({ storeId: '', blockIndex: 0, state: 'loaded' })]);
		expect(controller.isGroupExpanded('group:region=EMEA')).toBe(false);

		controller.dispose();
		store.destroy();
	});

	it('rejects child-store responses after the child route is purged', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const childResponse = deferred<{ rows: TestRow[]; rowCount: number }>();
		const getRows = vi.fn((request) => {
			if (request.route.length === 0) {
				return Promise.resolve({
					rows: [{ id: 'group-emea', name: 'EMEA' }],
					rowCount: 1,
					groupMetadata: [
						{
							rowId: 'group-emea',
							route: ['region', 'EMEA'],
							groupKey: 'EMEA',
							expandable: true,
						},
					],
				});
			}
			return childResponse.promise;
		});
		const stateEvents: unknown[] = [];
		store.addEventListener(GridEventName.serverSideStateChanged, (event) => {
			stateEvents.push(event);
		});
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows },
			blockSize: 5,
			getRowId: (row) => row.id,
		});

		await flushAsync();
		controller.toggleGroupExpanded('group:region=EMEA');
		expect(getRows).toHaveBeenCalledTimes(2);

		controller.purgeServerSide({ route: ['region', 'EMEA'] });
		const eventCountAfterPurge = stateEvents.length;

		childResponse.resolve({ rows: [{ id: 'stale-child', name: 'Stale' }], rowCount: 1 });
		await flushAsync();

		expect(stateEvents).toHaveLength(eventCountAfterPurge);
		expect(store.getServerSideStoreState()).toEqual([
			expect.objectContaining({
				storeId: '',
				childStoreCount: 0,
				rowCountState: { kind: 'known', count: 1 },
			}),
		]);
		expect(controller.getBlockSnapshots()).toEqual([expect.objectContaining({ storeId: '', blockIndex: 0, state: 'loaded' })]);
		expect(controller.getRawRowById('stale-child')).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('purges descendant child stores when a parent route is purged', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const getRows = vi.fn(async (request) => {
			if (request.route.length === 0) {
				return {
					rows: [{ id: 'group-emea', name: 'EMEA' }],
					rowCount: 1,
					groupMetadata: [
						{
							rowId: 'group-emea',
							route: ['region', 'EMEA'],
							groupKey: 'EMEA',
							expandable: true,
						},
					],
				};
			}
			return {
				rows: [{ id: `row-${request.route.join('-')}`, name: request.route.join('/') }],
				rowCount: 1,
			};
		});
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows },
			blockSize: 5,
			getRowId: (row) => row.id,
		});

		await flushAsync();
		controller.toggleGroupExpanded('group:region=EMEA');
		controller.refreshServerSide({ route: ['region', 'EMEA', 'country', 'DE'] });
		await flushAsync();

		expect(store.getServerSideStoreState().map((snapshot) => snapshot.storeId)).toEqual([
			'',
			'["region","EMEA","country","DE"]',
			'["region","EMEA"]',
		]);

		controller.purgeServerSide({ route: ['region', 'EMEA'] });

		expect(store.getServerSideStoreState()).toEqual([
			expect.objectContaining({
				storeId: '',
				childStoreCount: 0,
				rowCountState: { kind: 'known', count: 1 },
			}),
		]);
		expect(controller.getBlockSnapshots()).toEqual([expect.objectContaining({ storeId: '', blockIndex: 0, state: 'loaded' })]);
		expect(controller.isGroupExpanded('group:region=EMEA')).toBe(false);

		controller.dispose();
		store.destroy();
	});

	it('rejects stale root-store responses after sort changes and forwards the winning query snapshot', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const first = deferred<{ rows: TestRow[]; rowCount: number }>();
		const second = deferred<{ rows: TestRow[]; rowCount: number }>();
		const getRows = vi.fn((request) => {
			if (getRows.mock.calls.length === 1) return first.promise;
			expect(request.sortModel).toEqual([{ colId: 'name', sort: 'desc' }]);
			return second.promise;
		});

		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows },
			blockSize: 5,
			getRowId: (row) => row.id,
		});

		store.setSortModel([{ colId: 'name', sort: 'desc' }]);
		expect(getRows).toHaveBeenCalledTimes(2);

		first.resolve({ rows: [{ id: 'old', name: 'Old' }], rowCount: 1 });
		await flushAsync();
		expect(controller.getVisualRow(0)?.kind).toBe('loading');

		second.resolve({ rows: [{ id: 'new', name: 'New' }], rowCount: 1 });
		await flushAsync();

		expect(controller.getVisualRow(0)).toMatchObject({ kind: 'data', rowId: 'new' });
		expect(controller.getRawRowById('old')).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('evicts least-recent root blocks when maxBlocksInCache is exceeded without producing blank represented rows', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const getRows = vi.fn(async ({ startRow, endRow }: { startRow: number; endRow: number }) => ({
			rows: Array.from({ length: endRow - startRow }, (_, offset) => ({
				id: `row-${startRow + offset}`,
				name: `Row ${startRow + offset}`,
			})),
			rowCount: 15,
		}));
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows },
			blockSize: 5,
			maxBlocksInCache: 2,
			getRowId: (row) => row.id,
		});

		await flushAsync();
		controller.ensureRange(5, 9, 'test-load-second-block');
		await flushAsync();
		controller.ensureRange(10, 14, 'test-load-third-block');
		await flushAsync();

		expect(controller.getBlockSnapshots().map((snapshot) => snapshot.blockIndex)).toEqual([1, 2]);
		expect(controller.getVisualRowCount()).toBe(15);
		expect(controller.getVisualRow(0)).toEqual({
			kind: 'loading',
			id: 'loading:0',
			rowIndex: 0,
			hierarchy: FLAT_HIERARCHY,
			editable: false,
		});
		expect(controller.getRowLoadState(0)).toEqual({ kind: 'loading', reason: 'server-side-block' });
		expect(controller.getVisualRow(10)).toMatchObject({ kind: 'data', rowId: 'row-10' });
		expect(controller.getRawRowById('row-0')).toBeNull();

		controller.dispose();
		store.destroy();
	});

	it('queues root block requests when maxConcurrentRequests is reached and drains after settlement', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const first = deferred<{ rows: TestRow[]; rowCount: number }>();
		const second = deferred<{ rows: TestRow[]; rowCount: number }>();
		const getRows = vi.fn(({ startRow }: { startRow: number }) => {
			if (startRow === 0) return first.promise;
			if (startRow === 5) return second.promise;
			throw new Error(`Unexpected startRow ${startRow}`);
		});
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows },
			blockSize: 5,
			maxConcurrentRequests: 1,
			getRowId: (row) => row.id,
		});

		controller.ensureRange(5, 9, 'test-queue-second-block');

		expect(getRows).toHaveBeenCalledTimes(1);
		expect(controller.getBlockSnapshots().map((snapshot) => [snapshot.blockIndex, snapshot.state])).toEqual([
			[0, 'loadingInitial'],
			[1, 'queued'],
		]);
		expect(controller.getVisualRow(5)).toEqual({
			kind: 'loading',
			id: 'loading:5',
			rowIndex: 5,
			hierarchy: FLAT_HIERARCHY,
			editable: false,
		});

		first.resolve({
			rows: Array.from({ length: 5 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			rowCount: 10,
		});
		await flushAsync();

		expect(getRows).toHaveBeenCalledTimes(2);
		expect(controller.getBlockSnapshots().map((snapshot) => [snapshot.blockIndex, snapshot.state])).toEqual([
			[0, 'loaded'],
			[1, 'loadingInitial'],
		]);

		second.resolve({
			rows: Array.from({ length: 5 }, (_, index) => ({ id: `row-${index + 5}`, name: `Row ${index + 5}` })),
			rowCount: 10,
		});
		await flushAsync();

		expect(controller.getBlockSnapshots().map((snapshot) => [snapshot.blockIndex, snapshot.state])).toEqual([
			[0, 'loaded'],
			[1, 'loaded'],
		]);
		expect(controller.getVisualRow(5)).toMatchObject({ kind: 'data', rowId: 'row-5' });

		controller.dispose();
		store.destroy();
	});

	it('releases current-generation request slots when the datasource is replaced', async () => {
		const store = new GridStore<TestRow>({
			columns: [{ field: 'name' }],
			getRowId: (row) => row.id,
		});
		const oldResponse = deferred<{ rows: TestRow[]; rowCount: number }>();
		const newResponse = deferred<{ rows: TestRow[]; rowCount: number }>();
		const oldGetRows = vi.fn(() => oldResponse.promise);
		const newGetRows = vi.fn(() => newResponse.promise);
		const controller = new ServerSideRowModelController<TestRow>(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			datasource: { getRows: oldGetRows },
			blockSize: 5,
			maxConcurrentRequests: 1,
			getRowId: (row) => row.id,
		});

		expect(oldGetRows).toHaveBeenCalledTimes(1);

		controller.setServerSideDatasource({ getRows: newGetRows });

		expect(newGetRows).toHaveBeenCalledTimes(1);

		oldResponse.resolve({ rows: [{ id: 'old', name: 'Old' }], rowCount: 1 });
		await flushAsync();
		expect(controller.getRawRowById('old')).toBeNull();
		expect(controller.getVisualRow(0)?.kind).toBe('loading');

		newResponse.resolve({ rows: [{ id: 'new', name: 'New' }], rowCount: 1 });
		await flushAsync();

		expect(controller.getVisualRow(0)).toMatchObject({ kind: 'data', rowId: 'new' });
		expect(controller.getRawRowById('old')).toBeNull();

		controller.dispose();
		store.destroy();
	});
});
