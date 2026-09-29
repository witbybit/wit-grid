import { afterEach, describe, expect, it, vi } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { RowNode } from '../rowNode.js';
import { RowPipeline } from './RowPipeline.js';
import { RowDataStore } from './RowDataStore.js';
import { aggregateStage } from './stages/aggregateStage.js';
import { treeStage } from './stages/treeStage.js';
import { sortTreeStage } from './stages/sortTreeStage.js';
import { compareSortKeys, compareSortValues, toSortKey } from './sortKeys.js';
import { createRowPipelineContext } from './pipelineContext.js';
import type { RowTreeNode } from './stages/types.js';
import { DagEngine } from '../calculations/dagEngine.js';

interface Row {
	id: string;
	name: string;
	price: number;
	onClick?: () => void;
}

const columns = [
	{ field: 'name', header: 'Name', width: 100 },
	{ field: 'price', header: 'Price', width: 100 },
];

function createGrid(rows: Row[]) {
	const store = new GridStore<Row>({ columns });
	const controller = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	return { store, controller };
}

function makeRows(count: number, withFunction = false): Row[] {
	const rows: Row[] = [];
	for (let i = 0; i < count; i++) {
		rows.push({ id: `r${i}`, name: `Item ${i}`, price: i, ...(withFunction ? { onClick: () => {} } : {}) });
	}
	return rows;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('transaction undo snapshot (delta, by reference)', () => {
	it('a one-row update on 10k rows clones nothing and works for rows holding functions', () => {
		const rows = makeRows(10_000, true);
		const { store, controller } = createGrid(rows);
		const cloneSpy = vi.spyOn(globalThis, 'structuredClone');

		const updated = { ...rows[42]!, price: -1 };
		expect(() => store.applyTransaction({ update: [updated] })).not.toThrow();
		expect(cloneSpy).not.toHaveBeenCalled();
		expect(store.getRowNodeById('r42')?.data.price).toBe(-1);

		store.undo();
		expect(store.getRowNodeById('r42')?.data).toBe(rows[42]);
		store.redo();
		expect(store.getRowNodeById('r42')?.data.price).toBe(-1);
		controller.dispose();
	});

	it('undo/redo of add + remove restores row order and node identity', () => {
		const rows = makeRows(5);
		const { store, controller } = createGrid(rows);
		const node1 = store.getRowNodeById('r1');
		store.applyTransaction({ remove: [rows[1]!], add: [{ id: 'x', name: 'X', price: 99 }], addIndex: 0 });
		expect(store.getRowOrder()).toEqual(['x', 'r0', 'r2', 'r3', 'r4']);
		store.undo();
		expect(store.getRowOrder()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
		expect(store.getRowNodeById('r1')).toBe(node1);
		expect(store.getRowNodeById('x')).toBeNull();
		store.redo();
		expect(store.getRowOrder()).toEqual(['x', 'r0', 'r2', 'r3', 'r4']);
		controller.dispose();
	});
});

describe('live re-sort with a quick filter active', () => {
	it('relocates a row whose sort key changes even though every field is also a filter key', () => {
		const rows = makeRows(10);
		const { store, controller } = createGrid(rows);
		store.setSortModel([{ colId: 'price', sort: 'asc' }]);
		store.setQuickFilter('item');
		expect(store.getVisualIndexByRowId('r0')).toBe(0);

		store.setCellValue('r0', 'price', 100);
		expect(store.getVisualIndexByRowId('r0')).toBe(9);
		expect(store.getVisualIndexByRowId('r1')).toBe(0);

		store.applyTransaction({ update: [{ id: 'r9', name: 'Item 9', price: -5 }] });
		expect(store.getVisualIndexByRowId('r9')).toBe(0);
		controller.dispose();
	});

	it('still drops a row that leaves the quick filter', () => {
		const { store, controller } = createGrid(makeRows(3));
		store.setSortModel([{ colId: 'price', sort: 'asc' }]);
		store.setQuickFilter('item');
		store.setCellValue('r1', 'name', 'zzz');
		expect(store.getVisualIndexByRowId('r1')).toBeNull();
		controller.dispose();
	});

	it('re-filters after a row changes even when the lowercased text is cached', () => {
		const { store, controller } = createGrid(makeRows(3));
		store.setQuickFilter('item');
		store.setQuickFilter('ITEM 1');
		expect(store.getVisualIndexByRowId('r1')).toBe(0);
		store.applyTransaction({ update: [{ id: 'r2', name: 'Item 1b', price: 2 }] });
		store.setQuickFilter('item 1');
		expect(store.getVisualIndexByRowId('r2')).not.toBeNull();
		controller.dispose();
	});
});

describe('incremental sort relocation', () => {
	it('does not rebuild the whole source order per relocation', () => {
		const { store, controller } = createGrid(makeRows(2_000));
		store.setSortModel([{ colId: 'price', sort: 'asc' }]);
		const allNodesSpy = vi.spyOn(RowDataStore.prototype, 'getAllNodes');
		for (let i = 0; i < 20; i++) store.setCellValue(`r${i}`, 'price', 5_000 + i);
		expect(allNodesSpy).not.toHaveBeenCalled();
		expect(store.getVisualIndexByRowId('r19')).toBe(1_999);
		expect(store.getVisualIndexByRowId('r0')).toBe(1_980);
		controller.dispose();
	});

	it('uses source order as the tiebreak after appends', () => {
		const { store, controller } = createGrid(makeRows(3));
		store.setSortModel([{ colId: 'price', sort: 'asc' }]);
		store.applyTransaction({ add: [{ id: 'n', name: 'N', price: 1 }] });
		// r1 and n tie on price 1; r1 comes first in source order.
		expect(store.getVisualIndexByRowId('r1')).toBe(1);
		expect(store.getVisualIndexByRowId('n')).toBe(2);
		controller.dispose();
	});
});

describe('filtered selectable ids', () => {
	it('matches the pipeline output without re-running it', () => {
		const { store, controller } = createGrid(makeRows(6));
		store.setQuickFilter('item 3');
		const runSpy = vi.spyOn(RowPipeline.prototype, 'run');
		expect(controller.getSelectableDataRowIds('filtered')).toEqual(['r3']);
		expect(runSpy).not.toHaveBeenCalled();
		controller.dispose();
	});
});

describe('sort keys', () => {
	it('compareSortKeys agrees with compareSortValues on mixed inputs', () => {
		const values: unknown[] = [null, undefined, 0, -1, 2.5, NaN, '10', '9', 'abc', 'ABC', '', true, false, new Date(5), [], [3], {}];
		for (const a of values) {
			for (const b of values) {
				const expected = compareSortValues(a, b);
				const actual = compareSortKeys(toSortKey(a), toSortKey(b));
				expect(Object.is(actual, expected) || (actual === 0 && expected === 0)).toBe(true);
			}
		}
	});
});

describe('tree/group stages', () => {
	it('builds a 20k-deep parent chain without overflowing the stack', () => {
		const nodes: RowNode<{ id: string; parent: string | null }>[] = [];
		for (let i = 0; i < 20_000; i++) nodes.push(new RowNode(`n${i}`, { id: `n${i}`, parent: i === 0 ? null : `n${i - 1}` }));
		const roots = treeStage(nodes, (row) => row.parent);
		expect(roots).toHaveLength(1);
		let depth = 0;
		let cursor: RowTreeNode<unknown> | undefined = roots[0];
		while (cursor?.children?.length) {
			cursor = cursor.children[0];
			depth++;
		}
		expect(depth).toBe(19_999);
		expect(cursor?.depth).toBe(19_999);
		// The sort stage walks the same chain iteratively.
		expect(() => sortTreeStage(roots, [{ colId: 'id', sort: 'asc' }], [{ field: 'id', header: 'ID' }])).not.toThrow();
	});

	it('custom aggregation over a 200k-row group does not throw RangeError', () => {
		const leafs: RowTreeNode<{ v: number }>[] = [];
		for (let i = 0; i < 200_000; i++) leafs.push({ kind: 'data', rowId: `r${i}`, node: new RowNode(`r${i}`, { v: 1 }), depth: 1 });
		const group: RowTreeNode<{ v: number }> = {
			kind: 'group',
			id: 'g',
			field: 'v',
			key: 1,
			keyString: '1',
			depth: 0,
			path: [],
			children: [
				{
					kind: 'group',
					id: 'g2',
					field: 'v',
					key: 1,
					keyString: '1',
					depth: 1,
					path: [],
					children: leafs,
					childCount: leafs.length,
					leafCount: leafs.length,
					aggregates: {},
				},
			],
			childCount: leafs.length,
			leafCount: leafs.length,
			aggregates: {},
		};
		const context = createRowPipelineContext([{ field: 'v', header: 'V' }], { groups: new Set(), treeRows: new Set(), details: new Set() });
		expect(() =>
			aggregateStage(
				[group],
				[
					{ field: 'v', aggFunc: 'sum' },
					{ field: 'count', aggFunc: (refs) => refs.length },
				],
				context
			)
		).not.toThrow();
		expect(group.aggregates).toEqual({ v: 200_000, count: 200_000 });
	});

	it('honours GroupDef.comparator and keeps the default group order without one', () => {
		const rows = ['b', 'a', 'c'].map((g, i) => new RowNode(`r${i}`, { id: `r${i}`, g }));
		const pipeline = new RowPipeline<{ id: string; g: string }>();
		const run = (comparator?: (a: unknown, b: unknown) => number) =>
			pipeline
				.run({
					nodes: rows,
					columns: [{ field: 'g', header: 'G' }],
					sortModel: null,
					filterModel: null,
					rowModelConfig: { type: 'client', grouping: { model: [{ colId: 'g', comparator }] } },
					aggDefs: [],
					expandedGroupIds: new Set(),
					expandedTreeRowIds: new Set(),
					expandedDetailRowIds: new Set(),
					defaultRowHeight: 30,
					rowHeightsRecord: {},
				})
				.visualRows.map((row) => row.id);
		const defaultOrder = run();
		expect(defaultOrder.map((id) => id.slice(-1))).toEqual(['b', 'a', 'c']);
		const reversed = run((a, b) => String(b).localeCompare(String(a)));
		expect(reversed.map((id) => id.slice(-1))).toEqual(['c', 'b', 'a']);
	});
});

describe('DagEngine fast paths', () => {
	it('answers per-cell lookups for formula-free columns and stays correct after register/clear', () => {
		const dag = new DagEngine();
		expect(dag.hasFormula('r1', 'a')).toBe(false);
		expect(dag.getCachedFormulaValue('r1', 'a').hasCached).toBe(false);
		dag.registerFormula('r1', 'a', '=1+1');
		expect(dag.hasFormula('r1', 'a')).toBe(true);
		expect(dag.hasFormula('r2', 'a')).toBe(false);
		expect(dag.getCellValue('r1', 'a', () => 0)).toBe(2);
		expect(dag.getCachedFormulaValue('r1', 'a')).toEqual({ hasCached: true, value: 2 });
		expect(dag.getCellValue('r1', 'b', () => 'raw')).toBe('raw');
		dag.registerFormula('r1', 'a', '=2+2');
		dag.clearFormula('r1', 'a');
		expect(dag.hasFormula('r1', 'a')).toBe(false);
		expect(dag.getFormula('r1', 'a')).toBeUndefined();
	});
});
