/**
 * Phase 0: Characterization tests — lock down side-effects of representative mutations.
 * These tests exercise the CURRENT implementation and must stay green as we refactor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

function makeStore(extra?: Partial<Parameters<typeof GridStore>[0]>): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'price', header: 'Price', width: 100 },
		],
		getRowId: (row) => row.id,
		...extra,
	});
}

function makeController(store: GridStore<TestRow>): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: [
			{ id: '1', name: 'Product A', price: 10 },
			{ id: '2', name: 'Product B', price: 20 },
			{ id: '3', name: 'Product C', price: 30 },
		],
		columns: store.getState().columns,
	});
}

describe('Phase 0: gridFeatureEffects characterization', () => {
	describe('setColumnWidth', () => {
		it('changes columnWidths in state', () => {
			const store = makeStore();
			const ctrl = makeController(store);

			store.setColumnWidth('name', 999);
			expect(store.getState().columnWidths['name']).toBe(999);

			ctrl.dispose();
			store.destroy();
		});

		it('dispatches columnResized event', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const listener = vi.fn();
			store.addEventListener(GridEventName.columnResized, listener);

			store.setColumnWidth('name', 200);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					payload: { colField: 'name', width: 200 },
				})
			);

			ctrl.dispose();
			store.destroy();
		});

		it('invalidates geometry, headers, and viewport', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const engine = (store as any).engine;

			const spyApply = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');

			store.setColumnWidth('name', 200);

			expect(spyApply).toHaveBeenCalled();
			const plan = spyApply.mock.calls[0][0];
			expect(plan.geometry).toBe(true);
			expect(plan.headers).toBe(true);
			expect(plan.viewport).toBe(true);

			ctrl.dispose();
			store.destroy();
		});

		it('triggers one renderInvalidated event', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const listener = vi.fn();
			store.addEventListener(GridEventName.renderInvalidated, listener);

			store.setColumnWidth('name', 250);

			expect(listener).toHaveBeenCalledOnce();

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('setGroupBy', () => {
		it('clears group expansion overrides', () => {
			const store = makeStore();
			// Set some initial expansion state
			store.engine.stateManager.setState((s) => ({
				...s,
				expansion: { rows: { 'group:1': true }, details: {} },
			}));

			store.setGroupBy(['name']);
			expect(store.getState().expansion.rows).toEqual({});

			store.destroy();
		});

		it('invalidates geometry, viewport, headers, overlay', () => {
			const store = makeStore();
			const engine = (store as any).engine;

			const spyApply = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');

			store.setGroupBy(['name']);

			expect(spyApply).toHaveBeenCalled();
			const plan = spyApply.mock.calls[0][0];
			expect(plan.geometry).toBe(true);
			expect(plan.viewport).toBe(true);
			expect(plan.headers).toBe(true);
			expect(plan.overlay).toBe(true);

			store.destroy();
		});

		it('emits groupByChanged event', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.groupByChanged, listener);

			store.setGroupBy(['price']);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					payload: expect.objectContaining({ groupBy: ['price'] }),
				})
			);

			store.destroy();
		});
	});

	describe('setAggregation', () => {
		it('updates aggregation in state', () => {
			const store = makeStore();
			const ctrl = makeController(store);

			const defs = [{ colId: 'price', aggFunc: 'sum' as const }];
			store.setAggregation(defs);
			expect(store.getState().aggregation).toEqual({ defs });

			ctrl.dispose();
			store.destroy();
		});

		// setAggregation is structural by design (was viewport + overlay only for setAggDefs).
		it('invalidates geometry, viewport, headers and overlay', () => {
			const store = makeStore();
			const engine = (store as any).engine;

			const spyApply = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');

			store.setAggregation([]);

			expect(spyApply).toHaveBeenCalled();
			const plan = spyApply.mock.calls[0][0];
			expect(plan.geometry).toBe(true);
			expect(plan.viewport).toBe(true);
			expect(plan.headers).toBe(true);
			expect(plan.overlay).toBe(true);

			store.destroy();
		});

		it('emits aggregationChanged event', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.aggregationChanged, listener);

			store.setAggregation([]);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { defs: [] } }));

			store.destroy();
		});
	});

	describe('startEditing and commitEdit', () => {
		it('startEditing sets activeEdit in state', () => {
			const store = makeStore();
			const ctrl = makeController(store);

			store.startEditing('1', 'name');
			expect(store.getState().activeEdit).toEqual(
				expect.objectContaining({
					rowId: '1',
					colField: 'name',
					startedBy: 'api',
				})
			);

			ctrl.dispose();
			store.destroy();
		});

		it('commitEdit with async valueSetter returning false returns false and rolls back', async () => {
			const store = makeStore({
				columns: [
					{ field: 'id', header: 'ID', width: 50 },
					{
						field: 'name',
						header: 'Name',
						width: 150,
						// valueSetter returning false triggers rollback
						valueSetter: async () => false,
					},
					{ field: 'price', header: 'Price', width: 100 },
				],
			});
			const ctrl = makeController(store);

			store.startEditing('1', 'name');
			const originalValue = store.getState().columns.find((c) => c.field === 'name');
			void originalValue; // just to reference it
			const result = await store.commitEdit('1', 'name', 'New Value');

			expect(result).toBe(false);
			expect(store.canUndo()).toBe(false);

			ctrl.dispose();
			store.destroy();
		});

		it('commitEdit success returns true and closes editor (activeEdit becomes null)', async () => {
			const store = makeStore();
			const ctrl = makeController(store);

			store.startEditing('1', 'name');
			const result = await store.commitEdit('1', 'name', 'Updated Name');

			expect(result).toBe(true);
			expect(store.getState().activeEdit).toBeNull();
			expect(store.canUndo()).toBe(true);

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('applyRowSelectionGesture', () => {
		it('updates selectedRowIds for replace gesture', () => {
			const store = makeStore();
			const ctrl = makeController(store);

			store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1', '2'] });
			expect(store.getState().selectedRowIds).toEqual(['1', '2']);

			ctrl.dispose();
			store.destroy();
		});

		it('invalidates changed rows and headers', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const engine = (store as any).engine;

			const spyApply = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');

			store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1', '3'] });

			expect(spyApply).toHaveBeenCalled();
			const plan = spyApply.mock.calls[0][0];
			expect(plan.rows.has('1')).toBe(true);
			expect(plan.rows.has('3')).toBe(true);
			expect(plan.headers).toBe(true);

			ctrl.dispose();
			store.destroy();
		});

		it('emits rowSelectionChanged event with correct payload', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const listener = vi.fn();
			store.addEventListener(GridEventName.rowSelectionChanged, listener);

			store.applyRowSelectionGesture({ kind: 'select', rowIds: ['2'], source: 'api' });

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					payload: expect.objectContaining({
						selectedRowIds: ['2'],
						addedRowIds: ['2'],
						removedRowIds: [],
						source: 'api',
					}),
				})
			);

			ctrl.dispose();
			store.destroy();
		});

		it('returns null and emits no event when no rows change', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			// Select '1' first
			store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1'] });

			const listener = vi.fn();
			store.addEventListener(GridEventName.rowSelectionChanged, listener);

			// Replace with same set — no change
			const result = store.applyRowSelectionGesture({ kind: 'replace', rowIds: ['1'] });
			expect(result).toBeNull();
			expect(listener).not.toHaveBeenCalled();

			ctrl.dispose();
			store.destroy();
		});
	});
});
