import { describe, it, expect, beforeEach } from 'vitest';
import { classifyMutation, RowDependencyRegistry, type RowDependencyConfig } from './rowMutationClassifier.js';
import type { ColumnDef } from '../columnDef.js';

function makeCol(field: string, opts: Partial<ColumnDef> = {}): ColumnDef {
	return { field, header: field, ...opts } as ColumnDef;
}

function makeRegistry(config: Partial<RowDependencyConfig>): RowDependencyRegistry {
	const reg = new RowDependencyRegistry();
	reg.update({
		columns: config.columns ?? [],
		sortModel: config.sortModel ?? null,
		filterModel: config.filterModel ?? null,
		groupBy: config.groupBy,
		aggDefs: config.aggDefs,
		hasTreeParent: config.hasTreeParent ?? false,
		treeParentDependencies: config.treeParentDependencies,
	});
	return reg;
}

function fields(...names: string[]): ReadonlySet<string> {
	return new Set(names);
}

describe('RowDependencyRegistry.update()', () => {
	it('populates sortKeys from sort model', () => {
		const reg = makeRegistry({
			sortModel: [
				{ colId: 'price', sort: 'asc' },
				{ colId: 'name', sort: 'desc' },
			],
		});
		expect(reg.sortKeys).toEqual(new Set(['price', 'name']));
	});

	it('populates filterKeys from filter model keys', () => {
		const reg = makeRegistry({ filterModel: { status: { type: 'text', conditions: [] }, amount: { type: 'number', conditions: [] } } });
		expect(reg.filterKeys).toEqual(new Set(['status', 'amount']));
	});

	it('populates groupKeys from groupBy array', () => {
		const reg = makeRegistry({ groupBy: ['region', 'category'] });
		expect(reg.groupKeys).toEqual(new Set(['region', 'category']));
	});

	it('populates formulaFields from columns with valueGetter', () => {
		const reg = makeRegistry({
			columns: [makeCol('price', { valueGetter: () => 0 }), makeCol('name'), makeCol('margin', { valueGetter: () => 0 })],
		});
		expect(reg.formulaFields).toEqual(new Set(['price', 'margin']));
	});

	it('sets hasTreeParent', () => {
		const reg = makeRegistry({ hasTreeParent: true });
		expect(reg.hasTreeParent).toBe(true);
	});

	it('clears previous state on re-update', () => {
		const reg = makeRegistry({ sortModel: [{ colId: 'price', sort: 'asc' }] });
		expect(reg.sortKeys.size).toBe(1);
		reg.update({ columns: [], sortModel: null, filterModel: null, groupBy: undefined, aggDefs: undefined, hasTreeParent: false });
		expect(reg.sortKeys.size).toBe(0);
	});

	it('empty config produces empty dependency sets', () => {
		const reg = makeRegistry({});
		expect(reg.sortKeys.size).toBe(0);
		expect(reg.filterKeys.size).toBe(0);
		expect(reg.groupKeys.size).toBe(0);
		expect(reg.formulaFields.size).toBe(0);
		expect(reg.hasTreeParent).toBe(false);
	});
});

describe('classifyMutation()', () => {
	describe('value-only', () => {
		it('returns value-only when no dependencies match', () => {
			const reg = makeRegistry({ sortModel: [{ colId: 'name', sort: 'asc' }] });
			expect(classifyMutation(fields('price'), reg)).toBe('value-only');
		});

		it('returns value-only with empty registry', () => {
			const reg = makeRegistry({});
			expect(classifyMutation(fields('price', 'name'), reg)).toBe('value-only');
		});

		it('returns value-only with empty changed fields', () => {
			const reg = makeRegistry({ sortModel: [{ colId: 'price', sort: 'asc' }] });
			expect(classifyMutation(new Set(), reg)).toBe('value-only');
		});
	});

	describe('formula-dependent', () => {
		it('returns formula-dependent when a changed field has a valueGetter', () => {
			const reg = makeRegistry({ columns: [makeCol('margin', { valueGetter: () => 0 })] });
			expect(classifyMutation(fields('margin'), reg)).toBe('formula-dependent');
		});
	});

	describe('sort-key', () => {
		it('returns sort-key when a changed field is in the sort model', () => {
			const reg = makeRegistry({ sortModel: [{ colId: 'price', sort: 'asc' }] });
			expect(classifyMutation(fields('price'), reg)).toBe('sort-key');
		});

		it('sort-key takes priority over formula-dependent', () => {
			const reg = makeRegistry({
				columns: [makeCol('price', { valueGetter: () => 0 })],
				sortModel: [{ colId: 'price', sort: 'asc' }],
			});
			expect(classifyMutation(fields('price'), reg)).toBe('sort-key');
		});
	});

	describe('filter-key', () => {
		it('returns filter-key when a changed field is in the filter model', () => {
			const reg = makeRegistry({ filterModel: { status: { type: 'text', conditions: [] } } });
			expect(classifyMutation(fields('status'), reg)).toBe('filter-key');
		});

		it('filter-key takes priority over sort-key', () => {
			const reg = makeRegistry({
				sortModel: [{ colId: 'price', sort: 'asc' }],
				filterModel: { price: { type: 'number', conditions: [] } },
			});
			expect(classifyMutation(fields('price'), reg)).toBe('filter-key');
		});
	});

	describe('group-key', () => {
		it('returns group-key when a changed field is in the groupBy list', () => {
			const reg = makeRegistry({ groupBy: ['region'] });
			expect(classifyMutation(fields('region'), reg)).toBe('group-key');
		});

		it('group-key takes priority over filter-key', () => {
			const reg = makeRegistry({
				groupBy: ['category'],
				filterModel: { category: { type: 'text', conditions: [] } },
			});
			expect(classifyMutation(fields('category'), reg)).toBe('group-key');
		});

		it('group-key takes priority over sort-key and formula', () => {
			const reg = makeRegistry({
				columns: [makeCol('region', { valueGetter: () => '' })],
				sortModel: [{ colId: 'region', sort: 'asc' }],
				filterModel: { region: { type: 'text', conditions: [] } },
				groupBy: ['region'],
			});
			expect(classifyMutation(fields('region'), reg)).toBe('group-key');
		});
	});

	describe('tree-parent', () => {
		it('returns tree-parent when hasTreeParent is true and field changes', () => {
			const reg = makeRegistry({ hasTreeParent: true });
			expect(classifyMutation(fields('parentId'), reg)).toBe('tree-parent');
		});

		it('group-key takes priority over tree-parent', () => {
			const reg = makeRegistry({ hasTreeParent: true, groupBy: ['category'] });
			expect(classifyMutation(fields('category'), reg)).toBe('group-key');
		});
	});

	describe('dotted-path matching', () => {
		it('matches changed field root against sort colId', () => {
			// 'address.city' should match sort colId 'address'
			const reg = makeRegistry({ sortModel: [{ colId: 'address', sort: 'asc' }] });
			expect(classifyMutation(fields('address.city'), reg)).toBe('sort-key');
		});

		it('matches changed field against dotted sort colId root', () => {
			// colId 'price.base' → root 'price'; changed field 'price' should match
			const reg = makeRegistry({ sortModel: [{ colId: 'price.base', sort: 'asc' }] });
			expect(classifyMutation(fields('price'), reg)).toBe('sort-key');
		});

		it('does not cross-match unrelated dotted paths', () => {
			const reg = makeRegistry({ sortModel: [{ colId: 'meta.status', sort: 'asc' }] });
			// 'name.status' shares suffix but not root — should NOT match
			expect(classifyMutation(fields('name.status'), reg)).toBe('value-only');
		});
	});

	describe('multiple changed fields', () => {
		it('returns highest-impact category when multiple fields are changed', () => {
			const reg = makeRegistry({
				sortModel: [{ colId: 'name', sort: 'asc' }],
				groupBy: ['region'],
			});
			// 'name' → sort-key, 'region' → group-key → group-key wins
			expect(classifyMutation(fields('name', 'region'), reg)).toBe('group-key');
		});

		it('returns sort-key when one of many fields matches sort', () => {
			const reg = makeRegistry({ sortModel: [{ colId: 'price', sort: 'asc' }] });
			expect(classifyMutation(fields('description', 'price', 'quantity'), reg)).toBe('sort-key');
		});
	});
});

describe('RowDependencyRegistry – source dependency expansion (Plan 082)', () => {
	describe('sort source fields via valueGetterDependencies', () => {
		it('adds valueGetterDependencies of a sorted computed column to sortKeys', () => {
			const reg = makeRegistry({
				columns: [makeCol('total', { valueGetter: () => 0, valueGetterDependencies: ['price', 'quantity'] })],
				sortModel: [{ colId: 'total', sort: 'asc' }],
			});
			expect(reg.sortKeys).toContain('total');
			expect(reg.sortKeys).toContain('price');
			expect(reg.sortKeys).toContain('quantity');
		});

		it('classifies a source dependency change as sort-key', () => {
			const reg = makeRegistry({
				columns: [makeCol('total', { valueGetter: () => 0, valueGetterDependencies: ['price', 'quantity'] })],
				sortModel: [{ colId: 'total', sort: 'asc' }],
			});
			expect(classifyMutation(fields('price'), reg)).toBe('sort-key');
			expect(classifyMutation(fields('quantity'), reg)).toBe('sort-key');
		});

		it('does not expand sort keys for a computed column not in the sort model', () => {
			const reg = makeRegistry({
				columns: [makeCol('margin', { valueGetter: () => 0, valueGetterDependencies: ['revenue', 'cost'] })],
				sortModel: [{ colId: 'name', sort: 'asc' }],
			});
			expect(reg.sortKeys).not.toContain('revenue');
		});
	});

	describe('filter source fields via valueGetterDependencies', () => {
		it('adds valueGetterDependencies of a filtered computed column to filterKeys', () => {
			const reg = makeRegistry({
				columns: [makeCol('fullName', { valueGetter: () => '', valueGetterDependencies: ['firstName', 'lastName'] })],
				filterModel: { fullName: { type: 'text', conditions: [] } },
			});
			expect(reg.filterKeys).toContain('firstName');
			expect(reg.filterKeys).toContain('lastName');
		});

		it('classifies a filter source dependency change as filter-key', () => {
			const reg = makeRegistry({
				columns: [makeCol('fullName', { valueGetter: () => '', valueGetterDependencies: ['firstName', 'lastName'] })],
				filterModel: { fullName: { type: 'text', conditions: [] } },
			});
			expect(classifyMutation(fields('firstName'), reg)).toBe('filter-key');
		});
	});

	describe('group source fields via valueGetterDependencies', () => {
		it('adds valueGetterDependencies of a group-by computed column to groupKeys', () => {
			const reg = makeRegistry({
				columns: [makeCol('region', { valueGetter: () => '', valueGetterDependencies: ['country', 'zone'] })],
				groupBy: ['region'],
			});
			expect(reg.groupKeys).toContain('country');
			expect(reg.groupKeys).toContain('zone');
		});

		it('classifies a group source dependency change as group-key', () => {
			const reg = makeRegistry({
				columns: [makeCol('region', { valueGetter: () => '', valueGetterDependencies: ['country', 'zone'] })],
				groupBy: ['region'],
			});
			expect(classifyMutation(fields('country'), reg)).toBe('group-key');
		});
	});

	describe('opaque computed columns (no valueGetterDependencies)', () => {
		it('sets opaqueStructuralDependency when active sort column has valueGetter without dependencies', () => {
			const reg = makeRegistry({
				columns: [makeCol('computed', { valueGetter: () => 0 })],
				sortModel: [{ colId: 'computed', sort: 'asc' }],
			});
			expect(reg.opaqueStructuralDependency).toBe(true);
		});

		it('conservatively returns sort-key for unmatched field when active sort is opaque', () => {
			const reg = makeRegistry({
				columns: [makeCol('computed', { valueGetter: () => 0 })],
				sortModel: [{ colId: 'computed', sort: 'asc' }],
			});
			// 'unrelated' is not in sortKeys, but computed is opaque → conservative
			expect(classifyMutation(fields('unrelated'), reg)).toBe('sort-key');
		});

		it('does not set opaqueStructuralDependency when all active computed columns declare dependencies', () => {
			const reg = makeRegistry({
				columns: [makeCol('total', { valueGetter: () => 0, valueGetterDependencies: ['price', 'qty'] })],
				sortModel: [{ colId: 'total', sort: 'asc' }],
			});
			expect(reg.opaqueStructuralDependency).toBe(false);
		});

		it('conservatively returns group-key when group column is opaque (highest priority)', () => {
			const reg = makeRegistry({
				columns: [makeCol('grp', { valueGetter: () => '' }), makeCol('srt', { valueGetter: () => 0 })],
				groupBy: ['grp'],
				sortModel: [{ colId: 'srt', sort: 'asc' }],
			});
			expect(classifyMutation(fields('unrelated'), reg)).toBe('group-key');
		});
	});

	describe('aggregation-input', () => {
		it('returns aggregation-input when changed field feeds an aggregation def', () => {
			const reg = makeRegistry({ aggDefs: [{ colId: 'salary', aggFunc: 'sum' }] });
			expect(classifyMutation(fields('salary'), reg)).toBe('aggregation-input');
		});

		it('returns aggregation-input for avg aggregation', () => {
			const reg = makeRegistry({ aggDefs: [{ colId: 'score', aggFunc: 'avg' }] });
			expect(classifyMutation(fields('score'), reg)).toBe('aggregation-input');
		});

		it('returns aggregation-input for custom aggregation function', () => {
			const reg = makeRegistry({ aggDefs: [{ colId: 'revenue', aggFunc: () => 0 }] });
			expect(classifyMutation(fields('revenue'), reg)).toBe('aggregation-input');
		});

		it('returns value-only when changed field does not match any aggregation def', () => {
			const reg = makeRegistry({ aggDefs: [{ colId: 'salary', aggFunc: 'sum' }] });
			expect(classifyMutation(fields('name'), reg)).toBe('value-only');
		});

		it('returns value-only when no aggregation defs are present', () => {
			const reg = makeRegistry({});
			expect(classifyMutation(fields('salary'), reg)).toBe('value-only');
		});

		it('handles dotted-path aggregation field: root match', () => {
			const reg = makeRegistry({ aggDefs: [{ colId: 'stats.revenue', aggFunc: 'sum' }] });
			expect(classifyMutation(fields('stats.revenue'), reg)).toBe('aggregation-input');
		});

		it('group-key takes priority over aggregation-input when both match', () => {
			const reg = makeRegistry({
				groupBy: ['salary'],
				aggDefs: [{ colId: 'salary', aggFunc: 'sum' }],
			});
			expect(classifyMutation(fields('salary'), reg)).toBe('group-key');
		});

		it('returns aggregation-input when multiple agg fields and one matches', () => {
			const reg = makeRegistry({
				aggDefs: [
					{ colId: 'salary', aggFunc: 'sum' },
					{ colId: 'bonus', aggFunc: 'avg' },
				],
			});
			expect(classifyMutation(fields('bonus'), reg)).toBe('aggregation-input');
		});
	});

	describe('tree-parent source dependencies', () => {
		it('populates treeParentSourceFields from treeParentDependencies', () => {
			const reg = makeRegistry({ hasTreeParent: true, treeParentDependencies: ['parentId'] });
			expect(reg.treeParentSourceFields).toEqual(new Set(['parentId']));
		});

		it('returns tree-parent only for declared source fields when treeParentDependencies provided', () => {
			const reg = makeRegistry({ hasTreeParent: true, treeParentDependencies: ['parentId'] });
			expect(classifyMutation(fields('parentId'), reg)).toBe('tree-parent');
			// 'name' is not a tree-parent source — should be value-only
			expect(classifyMutation(fields('name'), reg)).toBe('value-only');
		});

		it('conservatively returns tree-parent for any field when no dependencies declared', () => {
			const reg = makeRegistry({ hasTreeParent: true });
			expect(classifyMutation(fields('name'), reg)).toBe('tree-parent');
			expect(classifyMutation(fields('unrelated'), reg)).toBe('tree-parent');
		});

		it('treeParentSourceFields is empty when no dependencies declared', () => {
			const reg = makeRegistry({ hasTreeParent: true });
			expect(reg.treeParentSourceFields.size).toBe(0);
		});
	});
});
