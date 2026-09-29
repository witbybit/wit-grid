import { describe, it, expect } from 'vitest';
import { RowNode } from '../../rowNode.js';
import { flattenStage } from './flattenStage.js';
import { groupStage } from './groupStage.js';
import { treeStage } from './treeStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { FlattenConfig } from './flattenStage.js';

interface Row {
	id: string;
	category: string;
	parentId?: string | null;
}

function makeNode(id: string, data: Partial<Row> = {}) {
	return new RowNode<Row>(id, { id, category: 'A', ...data });
}

function makeContext(fields = ['category']) {
	return createRowPipelineContext<Row>(
		fields.map((f) => ({ field: f, header: f })),
		{ groups: new Set(), treeRows: new Set(), details: new Set() }
	);
}

const DEFAULT_CONFIG: FlattenConfig<Row> = {
	expandedGroupIds: new Set(),
	expandedTreeRowIds: new Set(),
	expandedDetailRowIds: new Set(),
	defaultRowHeight: 38,
	rowHeightsRecord: {},
};

describe('flattenStage', () => {
	it('returns empty array for empty input', () => {
		expect(flattenStage([], DEFAULT_CONFIG)).toHaveLength(0);
	});

	it('flat data nodes (no grouping) produce same count as input', () => {
		const nodes = [makeNode('1'), makeNode('2'), makeNode('3')];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const result = flattenStage(roots, DEFAULT_CONFIG);
		expect(result).toHaveLength(3);
		result.forEach((r) => expect(r.kind).toBe('data'));
	});

	it('collapsed group produces only the group row', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'A' })];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expandedGroupIds: new Set() });
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('group');
	});

	it('expanded group produces group row followed by leaf rows', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'A' })];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		const groupId = roots[0].kind === 'group' ? roots[0].id : '';
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expandedGroupIds: new Set([groupId]) });
		expect(result).toHaveLength(3); // 1 group + 2 leaves
		expect(result[0].kind).toBe('group');
		expect(result[1].kind).toBe('data');
		expect(result[2].kind).toBe('data');
	});

	it('two-level group: outer expanded, inner collapsed → outer group + inner group row only', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'A' })];
		const ctx = makeContext(['category']);
		// Use same field twice to get two levels — label also 'A' since we only have one field
		const twoLevelCtx = createRowPipelineContext<Row>(
			[
				{ field: 'category', header: 'cat' },
				{ field: 'id', header: 'id' },
			],
			{ groups: new Set(), treeRows: new Set(), details: new Set() }
		);
		const roots = groupStage(nodes, [{ colId: 'category' }, { colId: 'id' }], twoLevelCtx);

		const outerGroupId = roots[0].kind === 'group' ? roots[0].id : '';
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expandedGroupIds: new Set([outerGroupId]) });
		// Outer group row + inner group row(s) but no leaves (inner is collapsed)
		expect(result[0].kind).toBe('group');
		expect(result.every((r) => r.kind !== 'data')).toBe(true);
	});

	it('both levels expanded shows all group rows and leaf rows', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'A' })];
		const twoLevelCtx = createRowPipelineContext<Row>(
			[
				{ field: 'category', header: 'cat' },
				{ field: 'id', header: 'id' },
			],
			{ groups: new Set(), treeRows: new Set(), details: new Set() }
		);
		const roots = groupStage(nodes, [{ colId: 'category' }, { colId: 'id' }], twoLevelCtx);

		// Collect all group ids
		const groupIds = new Set<string>();
		const collectIds = (nodes: typeof roots) => {
			for (const n of nodes) {
				if (n.kind === 'group') {
					groupIds.add(n.id);
					collectIds(n.children as typeof roots);
				}
			}
		};
		collectIds(roots);

		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expandedGroupIds: groupIds });
		const dataRows = result.filter((r) => r.kind === 'data');
		expect(dataRows).toHaveLength(2);
	});

	it('per-row height from rowHeightsRecord overrides defaultRowHeight', () => {
		const nodes = [makeNode('special')];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, rowHeightsRecord: { special: 99 } });
		expect(result[0].height).toBe(99);
	});

	it('group row uses groupRowHeight when set', () => {
		const nodes = [makeNode('1', { category: 'A' })];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, groupRowHeight: 56 });
		expect(result[0].kind).toBe('group');
		expect(result[0].height).toBe(56);
	});

	it('masterDetailEnabled with expandedDetailRowIds inserts a detail row after parent', () => {
		const nodes = [makeNode('parent')];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const result = flattenStage(roots, {
			...DEFAULT_CONFIG,
			masterDetailEnabled: true,
			expandedDetailRowIds: new Set(['parent']),
			detailRowHeight: 200,
		});
		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('data');
		expect(result[1].kind).toBe('detail');
		expect(result[1].height).toBe(200);
	});

	it('a bottom group total follows the group content', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'A' })];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		const groupId = roots[0].kind === 'group' ? roots[0].id : '';
		const result = flattenStage(roots, {
			...DEFAULT_CONFIG,
			expandedGroupIds: new Set([groupId]),
			totals: { groups: 'bottom' },
		});
		// group row + 2 data rows + total
		expect(result).toHaveLength(4);
		expect(result[3]).toMatchObject({ kind: 'total', scope: 'group', groupId, placement: 'bottom' });
		expect(result[3].hierarchy).toMatchObject({ level: 1, parentId: groupId, posInSet: 0 });
	});

	it('defaultGroupsExpanded expands all groups without explicit IDs in expandedGroupIds', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'B' })];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, defaultGroupsExpanded: true });
		// 2 groups + 1 data row each = 4
		expect(result).toHaveLength(4);
		expect(result.filter((r) => r.kind === 'data')).toHaveLength(2);
	});

	it('derives each row level and sibling position from the tree it flattens', () => {
		const [p, c1, c2] = [makeNode('p'), makeNode('c1'), makeNode('c2')];
		const roots = [
			{
				kind: 'data' as const,
				rowId: 'p',
				node: p,
				depth: 0,
				children: [
					{ kind: 'data' as const, rowId: 'c1', node: c1, depth: 1 },
					{ kind: 'data' as const, rowId: 'c2', node: c2, depth: 1 },
				],
			},
		];
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expandedTreeRowIds: new Set(['p']) });
		expect(result.map((r) => (r as any).rowId)).toEqual(['p', 'c1', 'c2']);
		expect(result[0].hierarchy).toMatchObject({
			level: 0,
			parentId: null,
			hasChildren: true,
			expanded: true,
			childCount: 2,
			leafCount: 2,
			posInSet: 1,
			setSize: 1,
		});
		expect(result[1].hierarchy).toMatchObject({ level: 1, parentId: 'row:p', hasChildren: false, posInSet: 1, setSize: 2 });
		expect(result[2].hierarchy).toMatchObject({ level: 1, parentId: 'row:p', posInSet: 2, setSize: 2 });
	});

	it('tree data expands child rows when expandedTreeRowIds contains parent id', () => {
		const nodes = [
			new RowNode<Row>('parent', { id: 'parent', category: 'A', parentId: null }),
			new RowNode<Row>('child', { id: 'child', category: 'A', parentId: 'parent' }),
		];
		const roots = treeStage(nodes, (row) => row.parentId ?? null);
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expandedTreeRowIds: new Set(['parent']) });
		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('data');
		expect((result[0] as any).rowId).toBe('parent');
		expect((result[1] as any).rowId).toBe('child');
	});

	it('collapsed tree rows show only root', () => {
		const nodes = [
			new RowNode<Row>('parent', { id: 'parent', category: 'A', parentId: null }),
			new RowNode<Row>('child', { id: 'child', category: 'A', parentId: 'parent' }),
		];
		const roots = treeStage(nodes, (row) => row.parentId ?? null);
		const result = flattenStage(roots, DEFAULT_CONFIG); // no expanded ids
		expect(result).toHaveLength(1);
		expect((result[0] as any).rowId).toBe('parent');
	});
});

describe('flattenStage — totals and hierarchy', () => {
	function nested() {
		const nodes = [
			makeNode('1', { category: 'A', parentId: 'x' }),
			makeNode('2', { category: 'A', parentId: 'y' }),
			makeNode('3', { category: 'B', parentId: 'x' }),
		];
		const ctx = createRowPipelineContext<Row>(
			[
				{ field: 'category', header: 'category' },
				{ field: 'parentId', header: 'parentId' },
			],
			{ groups: new Set(), treeRows: new Set(), details: new Set() }
		);
		return groupStage(nodes, [{ colId: 'category' }, { colId: 'parentId' }], ctx);
	}

	it('gives groups direct child counts, leaf counts and sibling positions', () => {
		const result = flattenStage(nested(), { ...DEFAULT_CONFIG, defaultGroupsExpanded: true });
		const a = result.find((r) => r.kind === 'group' && r.keyString === 'A')!;
		expect(a.hierarchy).toMatchObject({ level: 0, childCount: 2, leafCount: 2, hasChildren: true, expanded: true, posInSet: 1, setSize: 2 });
		const ax = result.find((r) => r.kind === 'group' && r.id.endsWith('/parentId=x') && r.id.includes('category=A'))!;
		expect(ax.hierarchy).toMatchObject({ level: 1, parentId: a.id, childCount: 1, leafCount: 1, posInSet: 1, setSize: 2 });
	});

	it('places totals per level, top or bottom, only inside expanded groups', () => {
		const result = flattenStage(nested(), {
			...DEFAULT_CONFIG,
			defaultGroupsExpanded: true,
			totals: { groups: (level) => (level === 0 ? 'top' : 'bottom') },
		});
		const a = result.findIndex((r) => r.kind === 'group' && r.keyString === 'A');
		expect(result[a + 1]).toMatchObject({ kind: 'total', placement: 'top', groupId: result[a].id });
		const innerTotals = result.filter((r) => r.kind === 'total' && r.placement === 'bottom');
		expect(innerTotals.length).toBe(3); // one per level-1 group

		const collapsed = flattenStage(nested(), { ...DEFAULT_CONFIG, totals: { groups: 'bottom' } });
		expect(collapsed.some((r) => r.kind === 'total')).toBe(false); // collapsed groups show their aggregates themselves
	});

	it('adds a grand total at the top or bottom', () => {
		const top = flattenStage(nested(), { ...DEFAULT_CONFIG, totals: { grand: 'top' }, grandAggregates: { amount: 3 } });
		expect(top[0]).toMatchObject({ kind: 'total', scope: 'grand', groupId: null, placement: 'top', aggregates: { amount: 3 } });
		const bottom = flattenStage(nested(), { ...DEFAULT_CONFIG, totals: { grand: 'bottom' } });
		expect(bottom[bottom.length - 1]).toMatchObject({ kind: 'total', scope: 'grand', placement: 'bottom' });
	});

	it('records sticky candidates in row order, outer group first', () => {
		const meta = new Map<number, number>();
		const result = flattenStage(nested(), { ...DEFAULT_CONFIG, defaultGroupsExpanded: true, totals: { groups: 'bottom' } }, meta);
		const order = [...meta.keys()];
		expect(order).toEqual([...order].sort((x, y) => x - y));
		const a = result.findIndex((r) => r.kind === 'group' && r.keyString === 'A');
		// The outer group's boundary is its last content row, before its own bottom total.
		const aTotal = result.findIndex((r) => r.kind === 'total' && r.groupId === result[a].id);
		expect(meta.get(a)).toBe(aTotal - 1);
	});
});
