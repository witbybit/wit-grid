/**
 * Adversarial row-model capability tests.
 *
 * Verifies:
 * - Each row model reports correct capabilities
 * - Unsupported public API operations throw UnsupportedRowModelOperationError
 * - Server page loading state is published immediately on fetch start
 * - Infinite block reload clears stale row IDs before inserting new ones
 * - Fast scroll defers visible block loading; scroll settle flushes pending load
 */
import { describe, it, expect, vi } from 'vitest';
import { GridStore } from './store.js';
import { createClientGrid, createInfiniteGrid, createServerSideGrid } from './createGrid.js';
import { UnsupportedRowModelOperationError } from './rowModel.js';
import { InfiniteRowModelController, type InfiniteDatasource } from './infiniteRowModel.js';
import type { ServerSideDatasource } from './serverSideRowModel.js';
import type { ColumnDef } from './columnDef.js';

// ── Shared types ──────────────────────────────────────────────────────────────

interface TestRow {
	id: string;
	name: string;
	amount: number;
}

const COLUMNS: ColumnDef<TestRow>[] = [
	{ field: 'id', header: 'ID' },
	{ field: 'name', header: 'Name' },
	{ field: 'amount', header: 'Amount' },
];

// ── Capability correctness ────────────────────────────────────────────────────

describe('Row model capabilities', () => {
	it('client grid reports correct capabilities', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		const caps = api.getRowModelCapabilities();

		expect(caps.fullDataset).toBe(true);
		expect(caps.clientMutation).toBe(true);
		expect(caps.transactions).toBe(true);
		expect(caps.rowOrder).toBe(true);
		expect(caps.clientSort).toBe(true);
		expect(caps.clientFilter).toBe(true);
		expect(caps.clientGrouping).toBe(true);
		expect(caps.allRowSelection).toBe(true);

		expect(caps.blockLoading).toBe(false);
		expect(caps.serverPagination).toBe(false);
		expect(caps.loadedDataset).toBe(false);
		expect(caps.pagedDataset).toBe(false);
		expect(caps.serverSort).toBe(false);
		expect(caps.serverFilter).toBe(false);

		expect(api.supportsRowModelCapability('clientMutation')).toBe(true);
		expect(api.supportsRowModelCapability('blockLoading')).toBe(false);
		expect(api.supportsRowModelCapability('serverPagination')).toBe(false);

		api.destroy();
	});

	it('infinite grid reports correct capabilities', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		const caps = api.getRowModelCapabilities();

		expect(caps.blockLoading).toBe(true);
		expect(caps.loadedDataset).toBe(true);
		expect(caps.loadedRowSelection).toBe(true);
		expect(caps.serverSort).toBe(true);
		expect(caps.serverFilter).toBe(true);

		expect(caps.fullDataset).toBe(false);
		expect(caps.clientMutation).toBe(false);
		expect(caps.transactions).toBe(false);
		expect(caps.serverPagination).toBe(false);
		expect(caps.allRowSelection).toBe(false);
		expect(caps.pagedDataset).toBe(false);

		expect(api.supportsRowModelCapability('blockLoading')).toBe(true);
		expect(api.supportsRowModelCapability('transactions')).toBe(false);
		expect(api.supportsRowModelCapability('serverPagination')).toBe(false);

		api.destroy();
	});

	it('server grid reports correct capabilities', () => {
		const api = createServerSideGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
			blockSize: 10,
		});
		const caps = api.getRowModelCapabilities();

		expect(caps.blockLoading).toBe(true);
		expect(caps.loadedDataset).toBe(true);
		expect(caps.loadedRowSelection).toBe(true);
		expect(caps.serverSort).toBe(true);
		expect(caps.serverFilter).toBe(true);

		expect(caps.fullDataset).toBe(false);
		expect(caps.clientMutation).toBe(false);
		expect(caps.transactions).toBe(false);
		expect(caps.serverPagination).toBe(false);
		expect(caps.allRowSelection).toBe(false);
		expect(caps.pagedDataset).toBe(false);

		expect(api.supportsRowModelCapability('serverPagination')).toBe(false);
		expect(api.supportsRowModelCapability('blockLoading')).toBe(true);
		expect(api.supportsRowModelCapability('clientMutation')).toBe(false);

		api.destroy();
	});

	it('supportsRowModelCapability is consistent with getRowModelCapabilities', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		const caps = api.getRowModelCapabilities();
		for (const [key, val] of Object.entries(caps)) {
			expect(api.supportsRowModelCapability(key as Parameters<typeof api.supportsRowModelCapability>[0])).toBe(val);
		}
		api.destroy();
	});

	it('client integrity capabilities are authoritative for dataset-backed scopes', () => {
		const api = createClientGrid({
			rows: [{ id: '1', name: 'Alpha', amount: 1 }],
			columns: COLUMNS,
			getRowId: (r) => r.id,
			dataIntegrity: { validation: true },
		});

		expect(api.integrity.getScopeCapability('allRows')).toMatchObject({ level: 'authoritative', complete: true });
		expect(api.integrity.getScopeCapability('filteredRows')).toMatchObject({ level: 'authoritative', complete: true });
		expect(api.integrity.getScopeCapability('visibleRows')).toMatchObject({ level: 'partial', complete: false });

		api.destroy();
	});

	it('infinite integrity capabilities reject dishonest full-dataset scopes', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
			dataIntegrity: { validation: true },
		});

		expect(api.integrity.getScopeCapability('allRows')).toMatchObject({ level: 'unsupported' });
		expect(api.integrity.getScopeCapability('filteredRows')).toMatchObject({ level: 'unsupported' });
		expect(api.integrity.getScopeCapability('loadedRows')).toMatchObject({ level: 'partial', complete: false });

		api.destroy();
	});

	it('server integrity capabilities make loaded rows explicit and partial', () => {
		const api = createServerSideGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
			blockSize: 10,
			dataIntegrity: { validation: true },
		});

		expect(api.integrity.getScopeCapability('loadedRows')).toMatchObject({ level: 'partial', complete: false });
		expect(api.integrity.getScopeCapability('currentPage')).toMatchObject({ level: 'unsupported' });
		expect(api.integrity.getScopeCapability('allRows')).toMatchObject({ level: 'unsupported' });
		expect(api.integrity.getScopeCapability('filteredRows')).toMatchObject({ level: 'unsupported' });

		api.destroy();
	});

	it('infinite row selection scopes are honest about loaded-only selection', async () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			rowSelection: { mode: 'multiple', selectAllScope: 'page' },
			datasource: {
				getRows: vi.fn().mockResolvedValue({
					rows: Array.from({ length: 20 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alpha' : index === 1 ? 'Beta' : `Row ${index + 1}`,
						amount: index + 1,
					})),
					totalCount: 20,
				}),
			},
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		api.selectAllRows({ scope: 'page' });
		expect(api.rows().getCheckedIds()).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));

		api.clearRowSelection();
		api.selectAllRows({ scope: 'loaded' });
		expect(api.rows().getCheckedIds()).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));

		api.clearRowSelection();
		api.selectAllRows({ scope: 'all' });
		expect(api.rows().getCheckedIds()).toEqual([]);

		api.selectAllRows({ scope: 'filtered' });
		expect(api.rows().getCheckedIds()).toEqual([]);

		api.destroy();
	});

	it('server row selection scopes are honest about loaded-cache-only selection', async () => {
		const api = createServerSideGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			rowSelection: { mode: 'multiple', selectAllScope: 'page' },
			datasource: {
				getRows: vi.fn().mockResolvedValue({
					rows: Array.from({ length: 10 }, (_, index) => ({
						id: String(index + 1),
						name: index === 0 ? 'Alpha' : index === 1 ? 'Beta' : `Row ${index + 1}`,
						amount: index + 1,
					})),
					rowCount: 20,
				}),
			},
			blockSize: 10,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		api.selectAllRows({ scope: 'page' });
		expect(api.rows().getCheckedIds()).toEqual(Array.from({ length: 10 }, (_, index) => String(index + 1)));

		api.clearRowSelection();
		api.selectAllRows({ scope: 'loaded' });
		expect(api.rows().getCheckedIds()).toEqual(Array.from({ length: 10 }, (_, index) => String(index + 1)));

		api.clearRowSelection();
		api.selectAllRows({ scope: 'all' });
		expect(api.rows().getCheckedIds()).toEqual([]);

		api.selectAllRows({ scope: 'filtered' });
		expect(api.rows().getCheckedIds()).toEqual([]);

		api.destroy();
	});
});

// ── Unsupported operation errors ──────────────────────────────────────────────

describe('Unsupported row model operations — client grid', () => {
	it('purgeCache throws UnsupportedRowModelOperationError', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.purgeCache()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('setServerSideDatasource throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		const ds: ServerSideDatasource<TestRow> = { getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
		expect(() => api.setServerSideDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('refreshServerSide throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.refreshServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('purgeServerSide throws', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.purgeServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('getServerSideStoreState returns an empty SSRM snapshot list', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(api.getServerSideStoreState()).toEqual([]);
		api.destroy();
	});

	it('setRows on client succeeds (baseline)', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		expect(() => api.setRows([{ id: '1', name: 'Alice', amount: 1 }])).not.toThrow();
		api.destroy();
	});
});

describe('Unsupported row model operations — infinite grid', () => {
	it('setServerSideDatasource throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		const ds: ServerSideDatasource<TestRow> = { getRows: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
		expect(() => api.setServerSideDatasource(ds)).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('refreshServerSide throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.refreshServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('purgeServerSide throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.purgeServerSide()).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('getServerSideStoreState returns an empty SSRM snapshot list', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(api.getServerSideStoreState()).toEqual([]);
		api.destroy();
	});

	it('setRows throws', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.setRows([{ id: '1', name: 'x', amount: 0 }])).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});

	it('row transactions throw', () => {
		const api = createInfiniteGrid({
			columns: COLUMNS,
			getRowId: (r) => r.id,
			datasource: { getRows: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }) },
		});
		expect(() => api.transaction({ rows: { add: [{ id: '1', name: 'x', amount: 0 }] } })).toThrowError(UnsupportedRowModelOperationError);
		api.destroy();
	});
});

describe('UnsupportedRowModelOperationError shape', () => {
	it('carries operation name, rowModelType, and supportedRowModels', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		let caught: unknown;
		try {
			api.purgeCache();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(UnsupportedRowModelOperationError);
		const err = caught as UnsupportedRowModelOperationError;
		expect(err.operation).toBe('purgeCache');
		expect(err.rowModelType).toBe('client');
		expect(Array.isArray(err.supportedRowModels)).toBe(true);
		expect(err.supportedRowModels).toContain('infinite');
		expect(err.message).toMatch(/purgeCache/);
		expect(err.message).toMatch(/client/);
		api.destroy();
	});

	it('is instanceof Error', () => {
		const api = createClientGrid({ rows: [], columns: COLUMNS, getRowId: (r) => r.id });
		let caught: unknown;
		try {
			api.purgeCache();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(Error);
		api.destroy();
	});

	describe('Infinite block reload — stale row map cleanup', () => {
		it('setDatasource clears old row IDs before inserting new ones', async () => {
			const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

			const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
				datasource: {
					getRows: vi.fn().mockResolvedValueOnce({
						rows: [
							{ id: 'A', name: 'Alice', amount: 1 },
							{ id: 'B', name: 'Bob', amount: 2 },
						],
						totalCount: 2,
					}),
				},
				blockSize: 10,
				columns: store.getState().columns,
			});

			await new Promise((res) => setTimeout(res, 0));

			expect(ctrl.getRowNodeById('A')).not.toBeNull();
			expect(ctrl.getRowNodeById('B')).not.toBeNull();
			expect(ctrl.getVisualIndexByRowId('A')).toBe(0);
			expect(ctrl.getVisualIndexByRowId('B')).toBe(1);

			// Replace datasource with different row IDs — triggers purgeCache internally
			ctrl.setDatasource({
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [
						{ id: 'C', name: 'Carol', amount: 3 },
						{ id: 'D', name: 'Dave', amount: 4 },
					],
					totalCount: 2,
				}),
			});

			await new Promise((res) => setTimeout(res, 0));

			// Stale IDs must be absent
			expect(ctrl.getRowNodeById('A')).toBeNull();
			expect(ctrl.getRowNodeById('B')).toBeNull();
			expect(ctrl.getVisualIndexByRowId('A')).toBe(-1);
			expect(ctrl.getVisualIndexByRowId('B')).toBe(-1);

			// New IDs must be present at correct indices
			expect(ctrl.getRowNodeById('C')).not.toBeNull();
			expect(ctrl.getRowNodeById('D')).not.toBeNull();
			expect(ctrl.getVisualIndexByRowId('C')).toBe(0);
			expect(ctrl.getVisualIndexByRowId('D')).toBe(1);

			ctrl.dispose();
		});

		it('reload with same row IDs does not produce duplicate entries', async () => {
			const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

			const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
				datasource: {
					getRows: vi.fn().mockResolvedValueOnce({
						rows: [
							{ id: 'X', name: 'Xavier', amount: 10 },
							{ id: 'Y', name: 'Yara', amount: 20 },
						],
						totalCount: 2,
					}),
				},
				blockSize: 10,
				columns: store.getState().columns,
			});

			await new Promise((res) => setTimeout(res, 0));

			// Reload same IDs with updated data
			ctrl.setDatasource({
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [
						{ id: 'X', name: 'Xavier Updated', amount: 10 },
						{ id: 'Y', name: 'Yara Updated', amount: 20 },
					],
					totalCount: 2,
				}),
			});

			await new Promise((res) => setTimeout(res, 0));

			// Each ID maps to exactly one canonical index
			expect(ctrl.getVisualIndexByRowId('X')).toBe(0);
			expect(ctrl.getVisualIndexByRowId('Y')).toBe(1);

			const nodeX = ctrl.getRowNodeById('X');
			expect(nodeX?.data.name).toBe('Xavier Updated');

			ctrl.dispose();
		});

		it('setDatasource clears stale focus, range, and active edit state when loaded rows disappear', async () => {
			const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

			const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
				datasource: {
					getRows: vi.fn().mockResolvedValueOnce({
						rows: [
							{ id: 'A', name: 'Alice', amount: 1 },
							{ id: 'B', name: 'Bob', amount: 2 },
						],
						totalCount: 2,
					}),
				},
				blockSize: 10,
				columns: store.getState().columns,
			});

			await new Promise((res) => setTimeout(res, 0));

			store.selectRange({ rowId: 'A', colField: 'name' }, { rowId: 'B', colField: 'amount' });
			store.startEditing('A', 'name');
			expect(store.getState().selection.focus).toEqual(expect.objectContaining({ rowId: 'B', colField: 'amount' }));
			expect(store.getState().selection.anchor).toEqual(expect.objectContaining({ rowId: 'A', colField: 'name' }));
			expect(store.getState().activeEdit).toEqual(expect.objectContaining({ rowId: 'A', colField: 'name' }));

			ctrl.setDatasource({
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [{ id: 'C', name: 'Carol', amount: 3 }],
					totalCount: 1,
				}),
			});

			expect(store.getState().selection.focus).toBeNull();
			expect(store.getState().selection.anchor).toBeNull();
			expect(store.getState().selection.range).toBeNull();
			expect(store.getState().selection.bounds).toBeNull();
			expect(store.getState().activeEdit).toBeNull();

			await new Promise((res) => setTimeout(res, 0));
			ctrl.dispose();
		});

		it('setDatasource prunes selectedRowIds to loaded-row scope immediately', async () => {
			const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

			const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
				datasource: {
					getRows: vi.fn().mockResolvedValueOnce({
						rows: [
							{ id: 'A', name: 'Alice', amount: 1 },
							{ id: 'B', name: 'Bob', amount: 2 },
						],
						totalCount: 2,
					}),
				},
				blockSize: 10,
				columns: store.getState().columns,
			});

			await new Promise((res) => setTimeout(res, 0));

			store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['A', 'B'], source: 'api' });
			expect(store.getState().selectedRowIds).toEqual(['A', 'B']);

			ctrl.setDatasource({
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [{ id: 'C', name: 'Carol', amount: 3 }],
					totalCount: 1,
				}),
			});

			expect(store.getState().selectedRowIds).toEqual([]);

			await new Promise((res) => setTimeout(res, 0));
			ctrl.dispose();
		});

		it('rejects stale infinite writes consistently after loaded rows are purged', async () => {
			const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });

			const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
				datasource: {
					getRows: vi.fn().mockResolvedValueOnce({
						rows: [{ id: 'A', name: 'Alice', amount: 1 }],
						totalCount: 1,
					}),
				},
				blockSize: 10,
				columns: store.getState().columns,
			});

			await new Promise((res) => setTimeout(res, 0));

			ctrl.setDatasource({
				getRows: vi.fn().mockResolvedValueOnce({
					rows: [{ id: 'C', name: 'Carol', amount: 3 }],
					totalCount: 1,
				}),
			});

			const single = store.setCellValue('A', 'name', 'Gone');
			expect(single).toEqual({
				status: 'rejected',
				reason: 'row unavailable',
				rejections: [{ mutationKind: 'cell-value', reason: 'row unavailable', index: undefined }],
			});

			const batch = store.transaction({
				cells: [
					{ rowId: 'A', colField: 'name', value: 'Gone' },
					{ rowId: 'B', colField: 'amount', value: 2 },
				],
			});
			expect(batch).toMatchObject({
				status: 'rejected',
				reason: 'row unavailable',
				rejections: [{ mutationKind: 'batch-cell', reason: 'row unavailable', index: 0 }],
			});

			await new Promise((res) => setTimeout(res, 0));
			ctrl.dispose();
		});
	});

	// ── Fast scroll deferred visible block loading ────────────────────────────────

	describe('Fast scroll deferred block loading', () => {
		it('does not fetch during fast scroll, fetches after scroll settles (210ms)', async () => {
			const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
			const getRows = vi.fn().mockResolvedValue({ rows: [], totalCount: 100 });
			const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
				datasource: { getRows },
				blockSize: 10,
				columns: store.getState().columns,
			});

			// Let constructor auto-fetch block 0 complete
			await new Promise((res) => setTimeout(res, 0));
			getRows.mockClear();

			// Simulate fast scroll: 600px displacement in 100ms = 6 px/ms (threshold is 5).
			// The first call must differ from the default (0,0) so it isn't a no-op; only
			// the second call computes velocity (first call has no prior timestamp).
			const t0 = performance.now();
			store.engine.viewport.setScrollPosition(100, 0, t0 - 100);
			store.engine.viewport.setScrollPosition(700, 0, t0);
			expect(store.engine.viewport.isScrollingFast).toBe(true);

			// loadVisibleBlocks during fast scroll — must defer, not fetch
			ctrl.loadVisibleBlocks(20, 29);
			await new Promise((res) => setTimeout(res, 0));
			expect(getRows).not.toHaveBeenCalled();

			// Wait for time-based velocity decay (>200ms since last scroll event)
			await new Promise((res) => setTimeout(res, 210));
			expect(store.engine.viewport.isScrollingFast).toBe(false);

			// Next loadVisibleBlocks call flushes the pending deferred range
			ctrl.loadVisibleBlocks(20, 29);
			await new Promise((res) => setTimeout(res, 0));
			expect(getRows).toHaveBeenCalledWith(
				expect.objectContaining({ startRow: 20, endRow: 30 }),
				expect.objectContaining({ signal: expect.any(Object) })
			);

			ctrl.dispose();
		});

		it('flush-time range honors the latest viewport instead of replaying stale deferred ranges', async () => {
			// pendingVisibleLoad stores only the LAST deferred range (last-write-wins during
			// fast scroll), but once scrolling settles we must load the latest authoritative
			// viewport only. Replaying older deferred ranges can surface skipped/blank bands.
			const store = new GridStore<TestRow>({ getRowId: (r) => r.id, columns: COLUMNS });
			const getRows = vi.fn().mockResolvedValue({ rows: [], totalCount: 100 });
			const ctrl = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
				datasource: { getRows },
				blockSize: 10,
				columns: store.getState().columns,
			});

			await new Promise((res) => setTimeout(res, 0));
			getRows.mockClear();

			// Fast scroll (non-zero start so first call isn't a no-op)
			const t0 = performance.now();
			store.engine.viewport.setScrollPosition(100, 0, t0 - 100);
			store.engine.viewport.setScrollPosition(700, 0, t0);

			// Defer ONE range (10–19) while fast-scrolling — this becomes pendingVisibleLoad
			ctrl.loadVisibleBlocks(10, 19);
			await new Promise((res) => setTimeout(res, 0));
			expect(getRows).not.toHaveBeenCalled();

			// Settle, then flush with the NEW viewport position (30–39)
			// effectiveStart = min(30, 10) = 10, effectiveEnd = max(39, 19) = 39
			await new Promise((res) => setTimeout(res, 210));
			ctrl.loadVisibleBlocks(30, 39);
			await new Promise((res) => setTimeout(res, 0));

			// Only the latest viewport range should be requested.
			expect(getRows).toHaveBeenCalledWith(
				expect.objectContaining({ startRow: 30, endRow: 40 }),
				expect.objectContaining({ signal: expect.any(Object) })
			);
			expect(getRows).not.toHaveBeenCalledWith(
				expect.objectContaining({ startRow: 10, endRow: 20 }),
				expect.objectContaining({ signal: expect.any(Object) })
			);

			ctrl.dispose();
		});
	});
});
