import { describe, expect, it } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { HierarchyIndex } from './hierarchyIndex.js';
import { treeStage } from './stages/treeStage.js';
import { RowNode } from '../rowNode.js';
import { toDataVisualRowId } from './visualRowIds.js';

interface Row {
	id: string;
	region: string;
	category: string;
	parentId?: string;
}

const ROWS: Row[] = [
	{ id: '1', region: 'EMEA', category: 'Cloud' },
	{ id: '2', region: 'EMEA', category: 'Cloud' },
	{ id: '3', region: 'EMEA', category: 'Hardware' },
	{ id: '4', region: 'APAC', category: 'Cloud' },
];

function makeGroupedStore(rows: Row[] = ROWS) {
	const store = new GridStore<Row>({
		getRowId: (row) => row.id,
		columns: [
			{ field: 'region', header: 'Region' },
			{ field: 'category', header: 'Category' },
		],
		// Collapsed by default: descendants must still count.
		grouping: { by: ['region', 'category'] },
		rowSelection: { mode: 'multiple' },
	});
	const controller = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	return { store, controller };
}

describe('HierarchyIndex', () => {
	it('lists every descendant data row of a tree parent, excluding the parent itself', () => {
		const data: Row[] = [
			{ id: 'root', region: '', category: '' },
			{ id: 'a', region: '', category: '', parentId: 'root' },
			{ id: 'a1', region: '', category: '', parentId: 'a' },
			{ id: 'b', region: '', category: '', parentId: 'root' },
		];
		const roots = treeStage(
			data.map((row) => new RowNode(row.id, row)),
			(row) => row.parentId
		);
		const index = new HierarchyIndex(roots);
		expect(index.getDescendantRowIds(toDataVisualRowId('root'))).toEqual(['a', 'a1', 'b']);
		expect(index.getDescendantRowIds(toDataVisualRowId('a'))).toEqual(['a1']);
		// A leaf has no descendants.
		expect(index.getDescendantRowIds(toDataVisualRowId('b'))).toEqual([]);
		expect(index.countSelected(toDataVisualRowId('root'), new Set(['a1']))).toEqual({ state: 'some', selected: 1, total: 3 });
	});
});

describe('hierarchy selection (grid API)', () => {
	it('counts descendants of collapsed groups, at every level', () => {
		const { store, controller } = makeGroupedStore();
		// Only the two top-level groups are visible; nothing inside is rendered.
		expect(controller.getVisualRowCount()).toBe(2);
		expect(store.getDescendantRowIds('group:region=EMEA')).toEqual(['1', '2', '3']);
		expect(store.getDescendantRowIds('group:region=EMEA/category=Cloud')).toEqual(['1', '2']);
		expect(store.getDescendantSelection('group:region=EMEA')).toEqual({ state: 'none', selected: 0, total: 3 });
		controller.dispose();
		store.destroy();
	});

	it('reports all / some / none and follows selection changes', () => {
		const { store, controller } = makeGroupedStore();
		store.selectRows(['1']);
		expect(store.getDescendantSelection('group:region=EMEA')).toEqual({ state: 'some', selected: 1, total: 3 });
		expect(store.getDescendantSelection('group:region=APAC').state).toBe('none');

		store.selectRows(['2', '3']);
		expect(store.getDescendantSelection('group:region=EMEA')).toEqual({ state: 'all', selected: 3, total: 3 });
		expect(store.getDescendantSelection('group:region=EMEA/category=Cloud').state).toBe('all');

		store.deselectRows(['2']);
		expect(store.getDescendantSelection('group:region=EMEA/category=Cloud')).toEqual({ state: 'some', selected: 1, total: 2 });
		controller.dispose();
		store.destroy();
	});

	it('selects and deselects every row beneath a collapsed group', () => {
		const { store, controller } = makeGroupedStore();
		store.setDescendantsSelected('group:region=EMEA', true);
		expect(store.getSelectedRowIds().sort()).toEqual(['1', '2', '3']);

		store.setDescendantsSelected('group:region=EMEA/category=Cloud', false);
		expect(store.getSelectedRowIds()).toEqual(['3']);
		expect(store.getDescendantSelection('group:region=EMEA').state).toBe('some');
		controller.dispose();
		store.destroy();
	});

	it('excludes filtered-out rows and follows the rebuilt hierarchy', () => {
		const { store, controller } = makeGroupedStore();
		store.setFilterModel({ category: { type: 'text', operator: 'equals', value: 'Cloud' } });
		expect(store.getDescendantRowIds('group:region=EMEA')).toEqual(['1', '2']);

		store.applyTransaction({ add: [{ id: '5', region: 'EMEA', category: 'Cloud' }] });
		expect(store.getDescendantRowIds('group:region=EMEA')).toEqual(['1', '2', '5']);
		controller.dispose();
		store.destroy();
	});

	it('is empty for ids that are not groups or tree parents', () => {
		const { store, controller } = makeGroupedStore();
		expect(store.getDescendantRowIds('group:region=Nowhere')).toEqual([]);
		expect(store.getDescendantSelection(toDataVisualRowId('1'))).toEqual({ state: 'none', selected: 0, total: 0 });
		controller.dispose();
		store.destroy();
	});
});
