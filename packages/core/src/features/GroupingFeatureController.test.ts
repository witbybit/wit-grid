import { describe, it, expect, vi } from 'vitest';
import { GroupingFeatureController } from './GroupingFeatureController.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController, type RowModel } from '../rowModel.js';
import type { GroupDef } from '../rows/hierarchyConfig.js';

interface TestRow {
	id: string;
	name: string;
	category: string;
}

function makeStore(): GridStore<TestRow> {
	return new GridStore<TestRow>({
		columns: [
			{ field: 'id', header: 'ID', width: 50 },
			{ field: 'name', header: 'Name', width: 150 },
			{ field: 'category', header: 'Category', width: 100 },
		],
		getRowId: (row) => row.id,
	});
}

function makeController(store: GridStore<TestRow>): ClientRowModelController<TestRow> {
	return new ClientRowModelController<TestRow>(store.getClientRowModelRuntime(), {
		rows: [
			{ id: '1', name: 'Product A', category: 'Fruit' },
			{ id: '2', name: 'Product B', category: 'Veggie' },
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

function makeFeature(
	store: GridStore<TestRow>,
	getRowModel: () => RowModel<TestRow> | null = () => store.getRowModel()
): GroupingFeatureController<TestRow> {
	return new GroupingFeatureController<TestRow>({
		ctx: getFeatureContext(store),
		getRowModel,
		invalidation: (store as any).engine.invalidation,
	});
}

function seedExpansion(store: GridStore<TestRow>, rows: Record<string, boolean>, details: Record<string, true> = {}): void {
	store.engine.stateManager.setState((s) => ({ ...s, expansion: { rows, details } }));
}

/** A row model that only implements the expansion surface, returning the given `changed` flag. */
function makeFakeExpansionModel(changed: boolean) {
	const result = () => ({ changed });
	return {
		setExpanded: vi.fn(result),
		expandAll: vi.fn(result),
		collapseAll: vi.fn(result),
		setDetailOpen: vi.fn(result),
		isExpanded: vi.fn((_id: string) => false),
		isDetailOpen: vi.fn((_rowId: string) => false),
	};
}

describe('GroupingFeatureController', () => {
	describe('setGroupBy', () => {
		it('clears group expansion overrides', () => {
			const store = makeStore();
			seedExpansion(store, { 'group:1': true });
			const feature = makeFeature(store);

			feature.setGroupBy(['name']);

			expect(store.getState().expansion.rows).toEqual({});
			store.destroy();
		});

		it('updates grouping.by in state', () => {
			const store = makeStore();
			const feature = makeFeature(store);

			feature.setGroupBy(['category']);

			expect(store.getState().grouping?.by).toEqual(['category']);
			expect(feature.getGroupBy()).toEqual(['category']);
			store.destroy();
		});

		it('invalidates geometry, viewport, headers, overlay', () => {
			const store = makeStore();
			const engine = (store as any).engine;
			const feature = makeFeature(store);

			// The first grouping adds the hierarchy column: a column change repaints everything.
			const first = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');
			feature.setGroupBy(['category']);
			expect((first.mock.calls[0][0] as any).full).toBe(true);
			first.mockRestore();

			// Regrouping with the column already present is targeted.
			const spyApply = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');
			feature.setGroupBy(['category', 'name']);

			expect(spyApply).toHaveBeenCalled();
			const plan = spyApply.mock.calls[0][0] as any;
			expect(plan.full).toBe(false);
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
			const feature = makeFeature(store);

			feature.setGroupBy(['category']);

			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ groupBy: ['category'] }) }));
			store.destroy();
		});

		it('keeps an existing GroupDef (keyCreator) when given a bare colId', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			const keyCreator = (p: { value: unknown }) => String(p.value).toUpperCase();
			const def: GroupDef<TestRow> = { colId: 'category', keyCreator };
			feature.setGrouping({ by: [def] });

			feature.setGroupBy(['name', 'category']);

			const by = store.getState().grouping?.by ?? [];
			expect(by).toHaveLength(2);
			expect(by[0]).toBe('name');
			// Stored as a frozen copy: same definition, same functions, no write-through to the caller's object.
			expect(by[1]).toEqual(def);
			expect((by[1] as GroupDef<TestRow>).keyCreator).toBe(keyCreator);
			expect(Object.isFrozen(by[1])).toBe(true);
			expect(feature.getGroupBy()).toEqual(['name', 'category']);
			store.destroy();
		});
	});

	describe('addGroupBy', () => {
		it('inserts colId and dispatches groupColumnAdded', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.groupColumnAdded, listener);
			const feature = makeFeature(store);

			feature.addGroupBy('name');

			expect(feature.getGroupBy()).toContain('name');
			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ colId: 'name' }) }));
			store.destroy();
		});

		it('does not duplicate already-added colId', () => {
			const store = makeStore();
			const feature = makeFeature(store);

			feature.addGroupBy('name');
			feature.addGroupBy('name');

			expect(feature.getGroupBy().filter((id) => id === 'name')).toHaveLength(1);
			store.destroy();
		});
	});

	describe('removeGroupBy', () => {
		it('removes colId and dispatches groupColumnRemoved', () => {
			const store = makeStore();
			const listener = vi.fn();
			store.addEventListener(GridEventName.groupColumnRemoved, listener);
			const feature = makeFeature(store);

			feature.addGroupBy('name');
			listener.mockClear();
			feature.removeGroupBy('name');

			expect(feature.getGroupBy()).not.toContain('name');
			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ colId: 'name' }) }));
			store.destroy();
		});
	});

	describe('setGrouping / updateGrouping', () => {
		it('setGrouping stores the config and emits groupingChanged and groupByChanged when levels change', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			const groupingListener = vi.fn();
			const groupByListener = vi.fn();
			store.addEventListener(GridEventName.groupingChanged, groupingListener);
			store.addEventListener(GridEventName.groupByChanged, groupByListener);

			const grouping = { by: ['category'], stickyHeaders: true };
			feature.setGrouping(grouping);

			expect(feature.getGrouping()).toEqual(grouping);
			expect(groupingListener).toHaveBeenCalledOnce();
			expect(groupingListener).toHaveBeenCalledWith(expect.objectContaining({ payload: { grouping } }));
			expect(groupByListener).toHaveBeenCalledOnce();
			expect(groupByListener).toHaveBeenCalledWith(expect.objectContaining({ payload: { groupBy: ['category'] } }));
			store.destroy();
		});

		it('updateGrouping without a level change emits groupingChanged only', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			feature.setGrouping({ by: ['category'] });
			const groupingListener = vi.fn();
			const groupByListener = vi.fn();
			store.addEventListener(GridEventName.groupingChanged, groupingListener);
			store.addEventListener(GridEventName.groupByChanged, groupByListener);

			feature.updateGrouping({ totals: { groups: 'bottom' } });

			expect(feature.getGrouping()).toEqual({ by: ['category'], totals: { groups: 'bottom' } });
			expect(groupingListener).toHaveBeenCalledOnce();
			expect(groupByListener).not.toHaveBeenCalled();
			store.destroy();
		});

		it('updateGrouping with no prior grouping starts from empty levels', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			const groupByListener = vi.fn();
			store.addEventListener(GridEventName.groupByChanged, groupByListener);

			feature.updateGrouping({ stickyHeaders: true });

			expect(feature.getGrouping()).toEqual({ by: [], stickyHeaders: true });
			expect(groupByListener).not.toHaveBeenCalled();
			store.destroy();
		});

		it('a level change clears only group: overrides and keeps row: overrides', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			feature.setGrouping({ by: ['category'] });
			seedExpansion(store, { 'group:a': true, 'row:p1': true, 'row:p2': false }, { '1': true });

			feature.setGrouping({ by: ['name'] });

			expect(store.getState().expansion.rows).toEqual({ 'row:p1': true, 'row:p2': false });
			expect(store.getState().expansion.details).toEqual({ '1': true });
			store.destroy();
		});

		it('a non-level change keeps group: overrides', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			feature.setGrouping({ by: ['category'] });
			seedExpansion(store, { 'group:a': true, 'row:p1': true });

			feature.updateGrouping({ stickyHeaders: true });

			expect(store.getState().expansion.rows).toEqual({ 'group:a': true, 'row:p1': true });
			store.destroy();
		});

		it('setGrouping(undefined) clears grouping and emits groupByChanged', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			feature.setGrouping({ by: ['category'] });
			const groupByListener = vi.fn();
			store.addEventListener(GridEventName.groupByChanged, groupByListener);

			feature.setGrouping(undefined);

			expect(feature.getGrouping()).toBeUndefined();
			expect(feature.getGroupBy()).toEqual([]);
			expect(groupByListener).toHaveBeenCalledWith(expect.objectContaining({ payload: { groupBy: [] } }));
			store.destroy();
		});
	});

	describe('setAggregation', () => {
		it('invalidates structurally (geometry, viewport, headers, overlay), emits aggregationChanged', () => {
			const store = makeStore();
			const ctrl = makeController(store);
			const engine = (store as any).engine;
			const feature = makeFeature(store);
			const listener = vi.fn();
			store.addEventListener(GridEventName.aggregationChanged, listener);

			const spyApply = vi.spyOn(engine.invalidation, 'applyNormalizedPlan');

			feature.setAggregation([]);

			expect(spyApply).toHaveBeenCalled();
			const plan = spyApply.mock.calls[0][0] as any;
			expect(plan.geometry).toBe(true);
			expect(plan.viewport).toBe(true);
			expect(plan.headers).toBe(true);
			expect(plan.overlay).toBe(true);
			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { defs: [] } }));

			ctrl.dispose();
			store.destroy();
		});

		it('updates aggregation in state; empty defs clear it', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			const defs = [{ colId: 'id', aggFunc: 'count' as const }];

			feature.setAggregation(defs);

			expect(store.getState().aggregation).toEqual({ defs });
			expect(feature.getAggregation()).toEqual(defs);

			feature.setAggregation([]);
			expect(store.getState().aggregation).toBeUndefined();
			expect(feature.getAggregation()).toEqual([]);
			store.destroy();
		});
	});

	describe('setTreeData', () => {
		it('stores the config, resets row overrides and base, keeps details, emits treeDataChanged', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			store.engine.stateManager.setState((s) => ({ ...s, expansion: { base: true, rows: { 'row:p1': true }, details: { '1': true } } }));
			const listener = vi.fn();
			store.addEventListener(GridEventName.treeDataChanged, listener);
			const treeData = { getParentId: (row: TestRow) => (row.id === '1' ? null : '1') };

			feature.setTreeData(treeData);

			expect(feature.getTreeData()).toEqual(treeData);
			expect(store.getState().treeData?.getParentId).toBe(treeData.getParentId);
			expect(Object.isFrozen(store.getState().treeData)).toBe(true);
			expect(store.getState().expansion.rows).toEqual({});
			expect(store.getState().expansion.base).toBeUndefined();
			expect(store.getState().expansion.details).toEqual({ '1': true });
			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { treeData } }));
			store.destroy();
		});
	});

	describe('setDetail', () => {
		it('stores the config and emits detailChanged, keeping open details', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			seedExpansion(store, {}, { '1': true });
			const listener = vi.fn();
			store.addEventListener(GridEventName.detailChanged, listener);
			const detail = { height: 120 };

			feature.setDetail(detail);

			expect(feature.getDetail()).toEqual(detail);
			expect(Object.isFrozen(feature.getDetail())).toBe(true);
			expect(store.getState().expansion.details).toEqual({ '1': true });
			expect(listener).toHaveBeenCalledOnce();
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { detail } }));
			store.destroy();
		});

		it('setDetail(undefined) clears open details', () => {
			const store = makeStore();
			const feature = makeFeature(store);
			feature.setDetail({ height: 120 });
			seedExpansion(store, { 'row:p1': true }, { '1': true });
			const listener = vi.fn();
			store.addEventListener(GridEventName.detailChanged, listener);

			feature.setDetail(undefined);

			expect(feature.getDetail()).toBeUndefined();
			expect(store.getState().expansion.details).toEqual({});
			expect(store.getState().expansion.rows).toEqual({ 'row:p1': true });
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ payload: { detail: undefined } }));
			store.destroy();
		});
	});

	describe('expansion', () => {
		it('delegates to the row model and emits expansionChanged when it reports a change', () => {
			const store = makeStore();
			const model = makeFakeExpansionModel(true);
			const feature = makeFeature(store, () => model as unknown as RowModel<TestRow>);
			const listener = vi.fn();
			store.addEventListener(GridEventName.expansionChanged, listener);

			feature.setExpanded('group:a', true);
			feature.expandAll({ maxLevel: 1 });
			feature.collapseAll();
			feature.setDetailOpen('1', true);

			expect(model.setExpanded).toHaveBeenCalledWith('group:a', true, undefined);
			expect(model.expandAll).toHaveBeenCalledWith({ maxLevel: 1 });
			expect(model.collapseAll).toHaveBeenCalledOnce();
			expect(model.setDetailOpen).toHaveBeenCalledWith('1', true);
			expect(listener.mock.calls.map((c) => c[0].payload)).toEqual([
				{ target: 'row', id: 'group:a', expanded: true },
				{ target: 'all', id: null, expanded: true, maxLevel: 1 },
				{ target: 'all', id: null, expanded: false },
				{ target: 'detail', id: '1', expanded: true },
			]);
			store.destroy();
		});

		it('toggles read the row model state and flip it', () => {
			const store = makeStore();
			const model = makeFakeExpansionModel(true);
			model.isExpanded.mockReturnValue(true);
			model.isDetailOpen.mockReturnValue(false);
			const feature = makeFeature(store, () => model as unknown as RowModel<TestRow>);

			feature.toggleExpanded('row:p1');
			feature.toggleDetailOpen('1');

			expect(model.isExpanded).toHaveBeenCalledWith('row:p1');
			expect(model.setExpanded).toHaveBeenCalledWith('row:p1', false, undefined);
			expect(model.isDetailOpen).toHaveBeenCalledWith('1');
			expect(model.setDetailOpen).toHaveBeenCalledWith('1', true);
			expect(feature.isExpanded('row:p1')).toBe(true);
			expect(feature.isDetailOpen('1')).toBe(false);
			store.destroy();
		});

		it('does not emit expansionChanged when the row model reports no change', () => {
			const store = makeStore();
			const model = makeFakeExpansionModel(false);
			const feature = makeFeature(store, () => model as unknown as RowModel<TestRow>);
			const listener = vi.fn();
			store.addEventListener(GridEventName.expansionChanged, listener);

			feature.setExpanded('group:a', true);
			feature.expandAll();
			feature.collapseAll();
			feature.setDetailOpen('1', true);

			expect(model.setExpanded).toHaveBeenCalledOnce();
			expect(model.expandAll).toHaveBeenCalledOnce();
			expect(model.collapseAll).toHaveBeenCalledOnce();
			expect(model.setDetailOpen).toHaveBeenCalledOnce();
			expect(listener).not.toHaveBeenCalled();
			store.destroy();
		});

		it('is a no-op without an expansion-capable row model', () => {
			const store = makeStore();
			const feature = makeFeature(store, () => null);
			const listener = vi.fn();
			store.addEventListener(GridEventName.expansionChanged, listener);

			feature.setExpanded('group:a', true);
			feature.expandAll();
			feature.setDetailOpen('1', true);

			expect(feature.isExpanded('group:a')).toBe(false);
			expect(feature.isDetailOpen('1')).toBe(false);
			expect(listener).not.toHaveBeenCalled();
			store.destroy();
		});
	});
});
