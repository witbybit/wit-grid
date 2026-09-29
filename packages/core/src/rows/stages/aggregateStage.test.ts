import { describe, it, expect, vi } from 'vitest';
import { RowNode } from '../../rowNode.js';
import { aggregateStage } from './aggregateStage.js';
import { groupStage } from './groupStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { AggregationDef } from './aggregateStage.js';

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
	return createRowPipelineContext<Row>(
		fields.map((f) => ({ field: f, header: f })),
		{ groups: new Set(), treeRows: new Set(), details: new Set() }
	);
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
		const aggDefs: AggregationDef<Row>[] = [{ field: 'amount', aggFunc: 'sum' }];
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
		const aggDefs: AggregationDef<Row>[] = [{ field: 'amount', aggFunc: 'count' }];
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
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'avg' }], ctx);
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
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'min' }], ctx);
		expect((roots[0] as any).aggregates['amount']).toBe(3);
	});

	it('max picks the largest value', () => {
		const nodes = [
			makeNode('1', { category: 'A', amount: 50 }),
			makeNode('2', { category: 'A', amount: 3 }),
			makeNode('3', { category: 'A', amount: 20 }),
		];
		const { roots, ctx } = buildGroups(nodes);
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'max' }], ctx);
		expect((roots[0] as any).aggregates['amount']).toBe(50);
	});

	it('non-numeric values are excluded from sum/avg/min/max, leaving undefined when all are non-numeric', () => {
		const nodes = [
			new RowNode<any>('1', { id: '1', category: 'A', amount: 'not-a-number' }),
			new RowNode<any>('2', { id: '2', category: 'A', amount: 'also-not' }),
		];
		const ctx = createRowPipelineContext<any>(
			[
				{ field: 'category', header: 'cat' },
				{ field: 'amount', header: 'amt' },
			],
			{ groups: new Set(), treeRows: new Set(), details: new Set() }
		);
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'sum' }], ctx);
		expect((roots[0] as any).aggregates['amount']).toBeUndefined();
	});

	it('custom function aggregation receives leaf RowNodes and returns its value', () => {
		const nodes = [makeNode('1', { category: 'A', amount: 10 }), makeNode('2', { category: 'A', amount: 20 })];
		const { roots, ctx } = buildGroups(nodes);
		let seenLeafNodes: unknown[] = [];
		aggregateStage(
			roots,
			[
				{
					field: 'amount',
					aggFunc: (leafNodes) => {
						seenLeafNodes = leafNodes;
						return leafNodes.length * 100;
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
				{ field: 'amount', aggFunc: 'sum' },
				{ field: 'amountAvg', aggFunc: 'avg' },
				{ field: 'amountMin', aggFunc: 'min' },
				{ field: 'amountMax', aggFunc: 'max' },
				{ field: 'amountCount', aggFunc: 'count' },
			],
			createRowPipelineContext<Row>(
				[
					{ field: 'category', header: 'category' },
					{ field: 'amount', header: 'amount' },
					{ field: 'amountAvg', header: 'amountAvg', valueGetter: ({ row }) => row.amount },
					{ field: 'amountMin', header: 'amountMin', valueGetter: ({ row }) => row.amount },
					{ field: 'amountMax', header: 'amountMax', valueGetter: ({ row }) => row.amount },
					{ field: 'amountCount', header: 'amountCount', valueGetter: ({ row }) => row.amount },
				],
				ctx.expansion
			)
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
				{ field: 'amount', aggFunc: 'sum' },
				{ field: 'label', aggFunc: (leafNodes) => leafNodes.map((node) => node.id).join(',') },
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
					field: 'amount',
					aggFunc: () => {
						throw error;
					},
				},
			],
			ctx
		);
		expect((roots[0] as any).aggregates['amount']).toBeUndefined();
		expect(reportFault).toHaveBeenCalledWith('custom-aggregation', error, { field: 'amount' });
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
		aggregateStage(roots, [{ field: 'amount', aggFunc: 'sum' }], ctx);

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
		const grand = aggregateStage(roots, [{ field: 'amount', aggFunc: 'sum' }, { field: 'amount', aggFunc: 'count' } as AggregationDef<Row>], ctx);
		expect(grand.amount).toBe(3); // the later 'count' def wins for the same field
		const sumOnly = aggregateStage(roots, [{ field: 'amount', aggFunc: 'sum' }], ctx);
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
		const grand = aggregateStage(roots, [{ field: 'amount', aggFunc: 'sum' }], makeContext());
		expect(roots[0].aggregates).toEqual({ amount: 7 }); // only the leaf beneath contributes
		expect(roots[0].children[0].aggregates).toEqual({ amount: 7 });
		expect(grand).toEqual({ amount: 7 });
	});
});
