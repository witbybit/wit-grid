import { describe, it, expect, vi } from 'vitest';
import { RowNode } from '../../rowNode.js';
import { aggregateStage } from './aggregateStage.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { AggregationDef } from './aggregateStage.js';
import type { AggregateContext } from '../hierarchyConfig.js';
import type { RowTreeNode } from './types.js';

interface Row {
	id: string;
	category: string;
	amount: number;
	label: string;
}

function makeNode(id: string, data: Partial<Row> = {}) {
	return new RowNode<Row>(id, { id, category: 'A', amount: 0, label: '', ...data });
}

function makeContext(fields: string[] = ['category', 'amount', 'label']) {
	return createRowPipelineContext<Row>(fields.map((f) => ({ field: f, header: f })));
}

function buildGroups(nodes: RowNode<Row>[], groupField = 'category') {
	const ctx = makeContext();
	return { roots: groupStage(nodes, [{ colId: groupField }], ctx), ctx };
}

describe('aggregateStage', () => {
	it('empty aggDefs is a no-op — aggregates stays empty', () => {
		const nodes = [makeNode('1', { amount: 100 }), makeNode('2', { amount: 200 })];
		const { roots } = buildGroups(nodes);
		aggregateStage(roots, [], makeContext());
		roots.forEach((r) => {
			if (r.kind === 'group') {
				expect(r.aggregates).toEqual({});
			}
		});
	});

	it('sum aggregation totals leaf values correctly per group', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'A', amount: 20 }),
			makeNode('3', { category: 'B', amount: 5 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		const aggDefs: AggregationDef<Row>[] = [{ colId: 'amount', aggFunc: 'sum' }];
		aggregateStage(roots, aggDefs, ctx);

		const groupA = roots.find((r) => r.kind === 'group' && r.keyString === 'A');
		const groupB = roots.find((r) => r.kind === 'group' && r.keyString === 'B');
		expect(groupA?.kind === 'group' && groupA.aggregates['amount']).toBe(30);
		expect(groupB?.kind === 'group' && groupB.aggregates['amount']).toBe(5);
	});

	it('count aggregation counts leaf nodes per group', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 1 }),
			makeNode('2', { category: 'A', amount: 2 }),
			makeNode('3', { category: 'A', amount: 3 }),
			makeNode('4', { category: 'B', amount: 4 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		const aggDefs: AggregationDef<Row>[] = [{ colId: 'amount', aggFunc: 'count' }];
		aggregateStage(roots, aggDefs, ctx);

		const groupA = roots.find((r) => r.kind === 'group' && r.keyString === 'A');
		const groupB = roots.find((r) => r.kind === 'group' && r.keyString === 'B');
		expect(groupA?.kind === 'group' && groupA.aggregates['amount']).toBe(3);
		expect(groupB?.kind === 'group' && groupB.aggregates['amount']).toBe(1);
	});

	it('avg aggregation computes the mean', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'A', amount: 20 }),
			makeNode('3', { category: 'A', amount: 30 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ colId: 'amount', aggFunc: 'avg' }], ctx);
		const groupA = roots[0];
		expect(groupA.kind === 'group' && groupA.aggregates['amount']).toBe(20);
	});

	it('min picks the smallest value', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 50 }),
			makeNode('2', { category: 'A', amount: 3 }),
			makeNode('3', { category: 'A', amount: 20 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ colId: 'amount', aggFunc: 'min' }], ctx);
		expect((roots[0] as any).aggregates['amount']).toBe(3);
	});

	it('max picks the largest value', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 50 }),
			makeNode('2', { category: 'A', amount: 3 }),
			makeNode('3', { category: 'A', amount: 20 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ colId: 'amount', aggFunc: 'max' }], ctx);
		expect((roots[0] as any).aggregates['amount']).toBe(50);
	});

	it('non-numeric values are excluded from sum/avg/min/max, leaving undefined when all are non-numeric', () => {
		const nodes = [
			new RowNode<any>('1', { id: '1', category: 'A', amount: 'not-a-number' }),
			new RowNode<any>('2', { id: '2', category: 'A', amount: 'also-not' }),
		];
		const ctx = createRowPipelineContext<any>([
			{ field: 'category', header: 'cat' },
			{ field: 'amount', header: 'amt' },
		]);
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		aggregateStage(roots, [{ colId: 'amount', aggFunc: 'sum' }], ctx);
		expect((roots[0] as any).aggregates['amount']).toBeUndefined();
	});

	it('custom function aggregation receives leaf row refs (ctx.rows) and returns its value', () => {
		const nodes = [makeNode('1', { category: 'A', amount: 10 }), makeNode('2', { category: 'A', amount: 20 })];
		const { roots, ctx } = buildGroups(nodes);
		let seenLeafNodes: unknown[] = [];
		aggregateStage(
			roots,
			[
				{
					colId: 'amount',
					aggFunc: ({ rows }) => {
						seenLeafNodes = rows;
						return rows.length * 100;
					},
				},
			],
			ctx
		);
		expect((roots[0] as any).aggregates['amount']).toBe(200);
		expect(seenLeafNodes[0]).not.toBeInstanceOf(RowNode);
		expect(seenLeafNodes[0]).toMatchObject({ id: '1', data: { id: '1', category: 'A', amount: 10, label: '' } });
		expect(typeof (seenLeafNodes[0] as { getValue?: unknown }).getValue).toBe('function');
	});

	it('computes multiple built-in aggregations in one pass', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'A', amount: 20 }),
			makeNode('3', { category: 'A', amount: 5 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(
			roots,
			[
				{ colId: 'amount', aggFunc: 'sum' },
				{ colId: 'amountAvg', aggFunc: 'avg' },
				{ colId: 'amountMin', aggFunc: 'min' },
				{ colId: 'amountMax', aggFunc: 'max' },
				{ colId: 'amountCount', aggFunc: 'count' },
			],
			createRowPipelineContext<Row>([
				{ field: 'category', header: 'category' },
				{ field: 'amount', header: 'amount' },
				{ field: 'amountAvg', header: 'amountAvg', valueGetter: ({ row }) => row.amount },
				{ field: 'amountMin', header: 'amountMin', valueGetter: ({ row }) => row.amount },
				{ field: 'amountMax', header: 'amountMax', valueGetter: ({ row }) => row.amount },
				{ field: 'amountCount', header: 'amountCount', valueGetter: ({ row }) => row.amount },
			])
		);

		const values = (roots[0] as any).aggregates;
		expect(values.amount).toBe(35);
		expect(values.amountAvg).toBe(35 / 3);
		expect(values.amountMin).toBe(5);
		expect(values.amountMax).toBe(20);
		expect(values.amountCount).toBe(3);
	});

	it('preserves custom aggregation leaf node order alongside built-ins', () => {
		const nodes = [makeNode('1', { category: 'A', amount: 10, label: 'first' }), makeNode('2', { category: 'A', amount: 20, label: 'second' })];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(
			roots,
			[
				{ colId: 'amount', aggFunc: 'sum' },
				{ colId: 'label', aggFunc: ({ rows }) => rows.map((node) => node.id).join(',') },
			],
			ctx
		);

		const values = (roots[0] as any).aggregates;
		expect(values.amount).toBe(30);
		expect(values.label).toBe('1,2');
	});

	it('custom function that throws is caught and sets value to undefined', () => {
		const nodes = [makeNode('1', { category: 'A', amount: 10 })];
		const { roots, ctx } = buildGroups(nodes);
		const reportFault = vi.fn();
		ctx.reportFault = reportFault;
		const error = new Error('boom');
		aggregateStage(
			roots,
			[
				{
					colId: 'amount',
					aggFunc: () => {
						throw error;
					},
				},
			],
			ctx
		);
		expect((roots[0] as any).aggregates['amount']).toBeUndefined();
		expect(reportFault).toHaveBeenCalledWith('custom-aggregation', error, { colId: 'amount' });
	});

	it('nested groups propagate aggregates up — outer group sums inner sums', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'A', amount: 20 }),
			makeNode('3', { category: 'B', amount: 5 }),
			makeNode('4', { category: 'B', amount: 15 }),
		];
		const ctx = makeContext();
		// Two-level grouping: first by category, then by label (all same → one inner group each)
		const roots = groupStage(nodes, [{ colId: 'category' }, { colId: 'label' }], ctx);
		aggregateStage(roots, [{ colId: 'amount', aggFunc: 'sum' }], ctx);

		const groupA = roots.find((r) => r.kind === 'group' && r.keyString === 'A');
		const groupB = roots.find((r) => r.kind === 'group' && r.keyString === 'B');
		// Outer groups should aggregate all descendants
		expect(groupA?.kind === 'group' && groupA.aggregates['amount']).toBe(30);
		expect(groupB?.kind === 'group' && groupB.aggregates['amount']).toBe(20);
	});
});

describe('aggregateStage — grand total and tree parents', () => {
	it('returns the grand total: the aggregate of every leaf row', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'B', amount: 20 }),
			makeNode('3', { category: 'B', amount: 30 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		const grand = aggregateStage(roots, [{ colId: 'amount', aggFunc: 'sum' }, { colId: 'amount', aggFunc: 'count' } as AggregationDef<Row>], ctx);
		expect(grand.amount).toBe(3); // the later 'count' def wins for the same field
		const sumOnly = aggregateStage(roots, [{ colId: 'amount', aggFunc: 'sum' }], ctx);
		expect(sumOnly.amount).toBe(60);
	});

	it('aggregates a tree parent over its descendants, not its own value', () => {
		const parent = makeNode('p', { amount: 1000 });
		const child = makeNode('c', { amount: 5 });
		const grandchild = makeNode('g', { amount: 7 });
		const roots = [
			{
				kind: 'data' as const,
				rowId: 'p',
				node: parent,
				depth: 0,
				children: [
					{
						kind: 'data' as const,
						rowId: 'c',
						node: child,
						depth: 1,
						children: [{ kind: 'data' as const, rowId: 'g', node: grandchild, depth: 2 }],
					},
				],
			},
		];
		const grand = aggregateStage(roots, [{ colId: 'amount', aggFunc: 'sum' }], makeContext());
		expect(roots[0].aggregates).toEqual({ amount: 7 }); // only the leaf beneath contributes
		expect(roots[0].children[0].aggregates).toEqual({ amount: 7 });
		expect(grand).toEqual({ amount: 7 });
	});
});

describe('aggregateStage — new built-ins, context and options', () => {
	function tree(): RowTreeNode<Row>[] {
		return [
			{
				kind: 'data',
				rowId: 'p',
				node: makeNode('p', { amount: 1000, label: 'parent' }),
				depth: 0,
				children: [
					{ kind: 'data', rowId: 'c1', node: makeNode('c1', { amount: 5, label: 'x' }), depth: 1 },
					{ kind: 'data', rowId: 'c2', node: makeNode('c2', { amount: 7, label: 'y' }), depth: 1 },
				],
			},
		];
	}

	it('distinctCount counts distinct values per group and in the grand total', () => {
		const nodes = [
			makeNode('1', { category: 'A', label: 'x' }),
			makeNode('2', { category: 'A', label: 'x' }),
			makeNode('3', { category: 'A', label: 'y' }),
			makeNode('4', { category: 'B', label: 'z' }),
		];
		const { roots, ctx } = buildGroups(nodes);
		const grand = aggregateStage(roots, [{ colId: 'label', aggFunc: 'distinctCount' }], ctx);
		const groupA = roots.find((r) => r.kind === 'group' && r.keyString === 'A')!;
		const groupB = roots.find((r) => r.kind === 'group' && r.keyString === 'B')!;
		expect(groupA.aggregates).toEqual({ label: 2 });
		expect(groupB.aggregates).toEqual({ label: 1 });
		expect(grand).toEqual({ label: 3 });
	});

	it('first and last follow row order (not value order)', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 30, label: 'm' }),
			makeNode('2', { category: 'B', amount: 99, label: 'q' }),
			makeNode('3', { category: 'A', amount: 10, label: 'z' }),
			makeNode('4', { category: 'A', amount: 20, label: 'a' }),
		];
		const { roots, ctx } = buildGroups(nodes);
		const grand = aggregateStage(
			roots,
			[
				{ colId: 'amount', aggFunc: 'first' },
				{ colId: 'label', aggFunc: 'last' },
			],
			ctx
		);
		const groupA = roots.find((r) => r.kind === 'group' && r.keyString === 'A')!;
		expect(groupA.aggregates).toEqual({ amount: 30, label: 'a' });
		// The grand total walks the groups in order: A (1, 3, 4) then B (2).
		expect(grand).toEqual({ amount: 30, label: 'q' });
	});

	it('a custom function receives { colId, values, rows, scope, level, key } per group and for the grand total', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 10 }),
			makeNode('2', { category: 'A', amount: 20 }),
			makeNode('3', { category: 'B', amount: 5 }),
		];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }, { colId: 'label' }], ctx);
		const seen: AggregateContext<Row>[] = [];
		const grand = aggregateStage(
			roots,
			[
				{
					colId: 'amount',
					aggFunc: (c) => {
						seen.push(c);
						return `${c.scope}:${c.level}:${(c.values as number[]).join('+')}`;
					},
				},
			],
			ctx
		);

		const outerA = seen.find((c) => c.scope === 'group' && c.level === 0 && c.key === 'A')!;
		expect(outerA.colId).toBe('amount');
		expect(outerA.values).toEqual([10, 20]);
		expect(outerA.rows.map((r) => r.id)).toEqual(['1', '2']);
		const innerA = seen.find((c) => c.scope === 'group' && c.level === 1 && c.values.length === 2)!;
		expect(innerA.key).toBe('');
		expect(roots[0].aggregates).toEqual({ amount: 'group:0:10+20' });

		const grandCtx = seen.find((c) => c.scope === 'grand')!;
		expect(grandCtx).toMatchObject({ colId: 'amount', scope: 'grand', level: -1, values: [10, 20, 5] });
		expect(grandCtx.key).toBeUndefined();
		expect(grandCtx.rows.map((r) => r.id)).toEqual(['1', '2', '3']);
		expect(grand).toEqual({ amount: 'grand:-1:10+20+5' });
	});

	it('a custom function on a tree parent gets scope tree and the parent level', () => {
		const roots = tree();
		const seen: AggregateContext<Row>[] = [];
		aggregateStage(
			roots,
			[
				{
					colId: 'amount',
					aggFunc: (c) => {
						seen.push(c);
						return c.values.length;
					},
				},
			],
			makeContext()
		);
		const treeCtx = seen.find((c) => c.scope === 'tree')!;
		expect(treeCtx).toMatchObject({ scope: 'tree', level: 0, values: [5, 7] });
		expect(treeCtx.key).toBeUndefined();
		expect(treeCtx.rows.map((r) => r.id)).toEqual(['c1', 'c2']);
	});

	it('aggregateTreeParents: false leaves tree parents without aggregates but still returns the grand total', () => {
		const roots = tree();
		const grand = aggregateStage(roots, [{ colId: 'amount', aggFunc: 'sum' }], makeContext(), { aggregateTreeParents: false });
		expect(roots[0].aggregates).toBeUndefined();
		expect(grand).toEqual({ amount: 12 });

		const defaults = tree();
		aggregateStage(defaults, [{ colId: 'amount', aggFunc: 'sum' }], makeContext());
		expect(defaults[0].aggregates).toEqual({ amount: 12 });
	});

	it('aggregateTreeParents: false does not affect groups', () => {
		const nodes = [makeNode('1', { category: 'A', amount: 10 }), makeNode('2', { category: 'A', amount: 20 })];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ colId: 'amount', aggFunc: 'sum' }], ctx, { aggregateTreeParents: false });
		expect(roots[0].aggregates).toEqual({ amount: 30 });
	});
});
