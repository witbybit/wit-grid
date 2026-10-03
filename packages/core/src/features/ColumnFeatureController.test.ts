import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ColumnFeatureController } from './ColumnFeatureController.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

interface TestRow {
	id: string;
	name: string;
	price: number;
}

function makeStore(): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'price', header: 'Price', width: 100 },
		],
		getRowId: (row) => row.id,
	});
}

function makeController(store: GridStore<TestRow>): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: [
			{ id: '1', name: 'Product A', price: 10 },
			{ id: '2', name: 'Product B', price: 20 },
		],
		columns: store.getState().columns,
	});
}

function getFeatureContext(store: GridStore<TestRow>): GridFeatureContext<TestRow> {
	const engine = (store as any).engine;
	return {
		columns: engine.columns,
		getState: () => engine.stateManager.getState(),
		applyChange: (change) => engine.changeApplier.apply(change),
	};
}

describe('ColumnFeatureController', () => {
	describe('resizeColumn', () => {
		it('changes columnWidths in state', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new ColumnFeatureController(getFeatureContext(store));

			feature.resizeColumn('name', 999);
			expect(store.getState().columnWidths['name']).toBe(999);

			ctrl.dispose();
			store.destroy();
		});

		it('dispatches columnResized event', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new ColumnFeatureController(getFeatureContext(store));
			const listener = vi.fn();
			store.addEventListener(GridEventName.columnResized, listener);

			feature.resizeColumn('name', 200);

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
			const feature = new ColumnFeatureController(getFeatureContext(store));

			const spyApply = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');

			feature.resizeColumn('name', 200);

			expect(spyApply).toHaveBeenCalled();
			const plan = spyApply.mock.calls[0][0];
			expect(plan.geometry).toBe(true);
			expect(plan.headers).toBe(true);
			expect(plan.viewport).toBe(true);

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('moveColumn', () => {
		it('changes column order', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new ColumnFeatureController(getFeatureContext(store));

			const beforeFields = store.getDisplayedColumns().map((c) => c.field);
			feature.moveColumn('name', 0); // move 'name' to first displayed position

			const afterFields = store.getDisplayedColumns().map((c) => c.field);
			expect(afterFields).not.toEqual(beforeFields);
			expect(afterFields[0]).toBe('name');

			ctrl.dispose();
			store.destroy();
		});

		it('dispatches columnOrderChanged event', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const feature = new ColumnFeatureController(getFeatureContext(store));
			const listener = vi.fn();
			store.addEventListener(GridEventName.columnOrderChanged, listener);

			feature.moveColumn('price', 0);

			expect(listener).toHaveBeenCalledOnce();

			ctrl.dispose();
			store.destroy();
		});
	});

	describe('setColumnReorderEnabled', () => {
		it('dispatches columnReorderToggled and invalidates headers', () => {
			const store = makeStore();
			const engine = (store as any).engine;
			const feature = new ColumnFeatureController(getFeatureContext(store));
			const listener = vi.fn();
			store.addEventListener(GridEventName.columnReorderToggled, listener);
			const spyApply = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');

			feature.setColumnReorderEnabled(false);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { enabled: false } }));
			expect(spyApply).toHaveBeenCalled();
			expect(spyApply.mock.calls[0][0].headers).toBe(true);

			store.destroy();
		});
	});

	describe('getColumnState', () => {
		it('returns snapshot of column widths and visibility', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));

			// Set some widths
			store.setColumnWidth('id', 80);
			store.setColumnWidth('name', 200);

			const state = feature.getColumnState();
			expect(state).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ field: 'id', width: 80 }),
					expect.objectContaining({ field: 'name', width: 200 }),
					expect.objectContaining({ field: 'price' }),
				])
			);

			store.destroy();
		});

		it('captures left-pinned columns', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));
			store.setPinnedColumns({ left: 1 });

			const state = feature.getColumnState();
			expect(state.find((c) => c.field === 'id')?.pinned).toBe('left');
			expect(state.find((c) => c.field === 'name')?.pinned).toBe(false);
			expect(state.find((c) => c.field === 'price')?.pinned).toBe(false);

			store.destroy();
		});

		it('captures right-pinned columns', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));
			store.setPinnedColumns({ right: 1 });

			const state = feature.getColumnState();
			expect(state.find((c) => c.field === 'price')?.pinned).toBe('right');
			expect(state.find((c) => c.field === 'id')?.pinned).toBe(false);

			store.destroy();
		});

		it('omits pinned for hidden columns', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));
			store.setColumnVisible('name', false);

			const state = feature.getColumnState();
			const nameState = state.find((c) => c.field === 'name');
			expect(nameState?.hide).toBe(true);
			expect(nameState?.pinned).toBeUndefined();

			store.destroy();
		});

		it('captures sort direction and sortIndex', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));
			store.setSortModel([
				{ colId: 'price', sort: 'desc' },
				{ colId: 'name', sort: 'asc' },
			]);

			const state = feature.getColumnState();
			expect(state.find((c) => c.field === 'price')).toMatchObject({ sort: 'desc', sortIndex: 0 });
			expect(state.find((c) => c.field === 'name')).toMatchObject({ sort: 'asc', sortIndex: 1 });
			expect(state.find((c) => c.field === 'id')?.sort).toBeUndefined();

			store.destroy();
		});
	});

	describe('applyColumnState', () => {
		it('applies width changes', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));

			feature.applyColumnState([{ field: 'name', width: 300 }]);

			expect(store.getState().columnWidths['name']).toBe(300);
			store.destroy();
		});

		it('applies visibility changes', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));

			feature.applyColumnState([{ field: 'price', hide: true }]);

			const col = store.getState().columns.find((c) => c.field === 'price');
			expect(col?.hide).toBe(true);
			store.destroy();
		});

		it('reorders columns when applyOrder is true', () => {
			const store = makeStore();
			const feature = new ColumnFeatureController(getFeatureContext(store));

			feature.applyColumnState([{ field: 'price' }, { field: 'name' }, { field: 'id' }], { applyOrder: true });

			const fields = store.getState().columns.map((c) => c.field);
			expect(fields.slice(0, 3)).toEqual(['price', 'name', 'id']);
			store.destroy();
		});

		it('restores pinning via store.applyColumnState', () => {
			const store = makeStore();

			store.applyColumnState([
				{ field: 'id', pinned: 'left' },
				{ field: 'name', pinned: false },
				{ field: 'price', pinned: false },
			]);

			expect(store.getState().pinnedColumns?.left).toBe(1);
			expect(store.getState().pinnedColumns?.right).toBe(0);
			store.destroy();
		});

		it('restores sort model via store.applyColumnState', () => {
			const store = makeStore();

			store.applyColumnState([{ field: 'price', sort: 'desc', sortIndex: 0 }, { field: 'name', sort: 'asc', sortIndex: 1 }, { field: 'id' }]);

			expect(store.getState().sortModel).toEqual([
				{ colId: 'price', sort: 'desc' },
				{ colId: 'name', sort: 'asc' },
			]);
			store.destroy();
		});

		it('clears sort model when all sort fields are null', () => {
			const store = makeStore();
			store.setSortModel([{ colId: 'price', sort: 'asc' }]);

			store.applyColumnState([{ field: 'price', sort: null }]);

			expect(store.getState().sortModel).toBeNull();
			store.destroy();
		});

		it('round-trips getColumnState → applyColumnState', () => {
			const store = makeStore();
			store.setPinnedColumns({ left: 1 });
			store.setSortModel([{ colId: 'price', sort: 'desc' }]);
			store.setColumnWidth('name', 250);

			const snapshot = store.getColumnState();

			// Mutate state
			store.setPinnedColumns({ left: 0 });
			store.setSortModel(null);
			store.setColumnWidth('name', 100);

			// Restore
			store.applyColumnState(snapshot, { applyOrder: true });
			const restored = store.getColumnState();

			expect(restored.find((c) => c.field === 'id')?.pinned).toBe('left');
			expect(restored.find((c) => c.field === 'price')?.sort).toBe('desc');
			expect(restored.find((c) => c.field === 'name')?.width).toBe(250);
			store.destroy();
		});
	});
});

describe('setColumns keeps the user column order across equivalent declarations', () => {
	const declare = () => [
		{ field: 'id', header: 'ID', width: 50 },
		{ field: 'name', header: 'Name', width: 150 },
		{ field: 'price', header: 'Price', width: 100 },
	];
	const order = (store: GridStore<TestRow>) => store.getState().columns.map((column) => column.field);

	it('a new but equivalent columns array (a React re-render) keeps a moved column where the user put it', () => {
		const store = makeStore();
		store.moveColumn('price', 0);
		expect(order(store)).toEqual(['price', 'id', 'name']);
		store.setColumns(declare());
		expect(order(store)).toEqual(['price', 'id', 'name']);
		store.setColumns(declare());
		expect(order(store)).toEqual(['price', 'id', 'name']);
		store.destroy();
	});

	it('a changed declaration (reordered, added or removed by the app) is applied as declared', () => {
		const store = makeStore();
		store.moveColumn('price', 0);
		const [id, name, price] = declare();
		store.setColumns([name, id, price]);
		expect(order(store)).toEqual(['name', 'id', 'price']);
		store.setColumns([name, id, price, { field: 'extra' as keyof TestRow & string, header: 'Extra' }]);
		expect(order(store)).toEqual(['name', 'id', 'price', 'extra']);
		store.destroy();
	});
});
