import { describe, it, expect } from 'vitest';
import { RowNode } from '../../rowNode.js';
import { flattenStage } from './flattenStage.js';
import { groupStage } from './groupStage.js';
import { treeStage } from './treeStage.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import type { FlattenConfig } from './flattenStage.js';
import type { ExpansionState, GroupInfo } from '../hierarchyConfig.js';

interface Row {
	id: string;
	category: string;
	parentId?: string | null;
}

function makeNode(id: string, data: Partial<Row> = {}) {
	return new RowNode<Row>(id, { id, category: 'A', ...data });
}

function makeContext(fields = ['category']) {
	return createRowPipelineContext<Row>(fields.map((f) => ({ field: f, header: f })));
}

function expansion(rows: Record<string, boolean> = {}, details: Record<string, true> = {}, base?: boolean | number): ExpansionState {
	return base === undefined ? { rows, details } : { rows, details, base };
}

/** Every id in the list open. */
function openRows(ids: Iterable<string>): ExpansionState {
	return expansion(Object.fromEntries([...ids].map((id) => [id, true])));
}

const DEFAULT_CONFIG: FlattenConfig<Row> = {
	expansion: expansion(),
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
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expansion: expansion() });
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('group');
	});

	it('expanded group produces group row followed by leaf rows', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'A' })];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		const groupId = roots[0].kind === 'group' ? roots[0].id : '';
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expansion: openRows([groupId]) });
		expect(result).toHaveLength(3); // 1 group + 2 leaves
		expect(result[0].kind).toBe('group');
		expect(result[1].kind).toBe('data');
		expect(result[2].kind).toBe('data');
	});

	it('two-level group: outer expanded, inner collapsed → outer group + inner group row only', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'A' })];
		const ctx = makeContext(['category']);
		// Use same field twice to get two levels — label also 'A' since we only have one field
		const twoLevelCtx = createRowPipelineContext<Row>([
			{ field: 'category', header: 'cat' },
			{ field: 'id', header: 'id' },
		]);
		const roots = groupStage(nodes, [{ colId: 'category' }, { colId: 'id' }], twoLevelCtx);

		const outerGroupId = roots[0].kind === 'group' ? roots[0].id : '';
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expansion: openRows([outerGroupId]) });
		// Outer group row + inner group row(s) but no leaves (inner is collapsed)
		expect(result[0].kind).toBe('group');
		expect(result.every((r) => r.kind !== 'data')).toBe(true);
	});

	it('both levels expanded shows all group rows and leaf rows', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'A' })];
		const twoLevelCtx = createRowPipelineContext<Row>([
			{ field: 'category', header: 'cat' },
			{ field: 'id', header: 'id' },
		]);
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

		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expansion: openRows(groupIds) });
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

	it('detail config with an open detail inserts a detail row after parent', () => {
		const nodes = [makeNode('parent')];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const result = flattenStage(roots, {
			...DEFAULT_CONFIG,
			detail: { height: 200 },
			expansion: expansion({}, { parent: true }),
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
			expansion: openRows([groupId]),
			totals: { groups: 'bottom' },
		});
		// group row + 2 data rows + total
		expect(result).toHaveLength(4);
		expect(result[3]).toMatchObject({ kind: 'total', scope: 'group', groupId, placement: 'bottom' });
		expect(result[3].hierarchy).toMatchObject({ level: 1, parentId: groupId, posInSet: 0 });
	});

	it('groupDefaultExpanded expands all groups without explicit overrides', () => {
		const nodes = [makeNode('1', { category: 'A' }), makeNode('2', { category: 'B' })];
		const ctx = makeContext();
		const roots = groupStage(nodes, [{ colId: 'category' }], ctx);
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, groupDefaultExpanded: true });
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
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expansion: openRows(['row:p']) });
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

	it('tree data expands child rows when the parent row: id is open', () => {
		const nodes = [
			new RowNode<Row>('parent', { id: 'parent', category: 'A', parentId: null }),
			new RowNode<Row>('child', { id: 'child', category: 'A', parentId: 'parent' }),
		];
		const roots = treeStage(nodes, (row) => row.parentId ?? null);
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, expansion: openRows(['row:parent']) });
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
		const ctx = createRowPipelineContext<Row>([
			{ field: 'category', header: 'category' },
			{ field: 'parentId', header: 'parentId' },
		]);
		return groupStage(nodes, [{ colId: 'category' }, { colId: 'parentId' }], ctx);
	}

	it('gives groups direct child counts, leaf counts and sibling positions', () => {
		const result = flattenStage(nested(), { ...DEFAULT_CONFIG, groupDefaultExpanded: true });
		const a = result.find((r) => r.kind === 'group' && r.keyString === 'A')!;
		expect(a.hierarchy).toMatchObject({ level: 0, childCount: 2, leafCount: 2, hasChildren: true, expanded: true, posInSet: 1, setSize: 2 });
		const ax = result.find((r) => r.kind === 'group' && r.id.endsWith('/parentId=x') && r.id.includes('category=A'))!;
		expect(ax.hierarchy).toMatchObject({ level: 1, parentId: a.id, childCount: 1, leafCount: 1, posInSet: 1, setSize: 2 });
	});

	it('places totals per level, top or bottom, only inside expanded groups', () => {
		const result = flattenStage(nested(), {
			...DEFAULT_CONFIG,
			groupDefaultExpanded: true,
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
		const result = flattenStage(nested(), { ...DEFAULT_CONFIG, groupDefaultExpanded: true, totals: { groups: 'bottom' } }, meta);
		const order = [...meta.keys()];
		expect(order).toEqual([...order].sort((x, y) => x - y));
		const a = result.findIndex((r) => r.kind === 'group' && r.keyString === 'A');
		// The outer group's boundary is its last content row, before its own bottom total.
		const aTotal = result.findIndex((r) => r.kind === 'total' && r.groupId === result[a].id);
		expect(meta.get(a)).toBe(aTotal - 1);
	});
});

describe('flattenStage — expansion resolution', () => {
	function twoLevels() {
		const nodes = [makeNode('1', { category: 'A', parentId: 'x' }), makeNode('2', { category: 'B', parentId: 'y' })];
		const ctx = createRowPipelineContext<Row>([
			{ field: 'category', header: 'category' },
			{ field: 'parentId', header: 'parentId' },
		]);
		return groupStage(nodes, [{ colId: 'category' }, { colId: 'parentId' }], ctx);
	}
	const groupRows = (rows: ReturnType<typeof flattenStage<Row>>) => rows.filter((r) => r.kind === 'group');

	it('an override rows[id]=false closes a group that is open by default', () => {
		const roots = twoLevels();
		const a = roots[0].kind === 'group' ? roots[0].id : '';
		const result = flattenStage(roots, { ...DEFAULT_CONFIG, groupDefaultExpanded: true, expansion: expansion({ [a]: false }) });
		const aRow = result.find((r) => r.id === a)!;
		expect(aRow.hierarchy.expanded).toBe(false);
		// A's subtree is hidden; B stays open with its inner group and leaf.
		const aIdx = result.indexOf(aRow);
		expect(result[aIdx + 1]).toMatchObject({ kind: 'group', keyString: 'B' });
		expect(result.filter((r) => r.kind === 'data').map((r) => (r as { rowId: string }).rowId)).toEqual(['2']);
	});

	it('groupDefaultExpanded: 1 opens only level 0', () => {
		const result = flattenStage(twoLevels(), { ...DEFAULT_CONFIG, groupDefaultExpanded: 1 });
		const groups = groupRows(result);
		expect(groups.filter((g) => g.hierarchy.level === 0).every((g) => g.hierarchy.expanded)).toBe(true);
		const inner = groups.filter((g) => g.hierarchy.level === 1);
		expect(inner).toHaveLength(2);
		expect(inner.every((g) => !g.hierarchy.expanded)).toBe(true);
		expect(result.some((r) => r.kind === 'data')).toBe(false);
	});

	it('expansion.base beats the configured default, and an override beats base', () => {
		const roots = twoLevels();
		const collapsedByBase = flattenStage(roots, { ...DEFAULT_CONFIG, groupDefaultExpanded: true, expansion: expansion({}, {}, false) });
		expect(groupRows(collapsedByBase).every((g) => !g.hierarchy.expanded)).toBe(true);
		expect(collapsedByBase).toHaveLength(2);

		const a = roots[0].kind === 'group' ? roots[0].id : '';
		const overridden = flattenStage(roots, { ...DEFAULT_CONFIG, groupDefaultExpanded: true, expansion: expansion({ [a]: true }, {}, false) });
		expect(overridden.find((r) => r.id === a)!.hierarchy.expanded).toBe(true);
		expect(overridden.find((r) => r.kind === 'group' && r.keyString === 'B')!.hierarchy.expanded).toBe(false);

		const openedByBase = flattenStage(roots, { ...DEFAULT_CONFIG, expansion: expansion({}, {}, 1) });
		expect(groupRows(openedByBase).map((g) => g.hierarchy.expanded)).toEqual([true, false, true, false]);
	});

	it('a predicate default receives GroupInfo', () => {
		const roots = twoLevels();
		const seen: GroupInfo[] = [];
		const result = flattenStage(roots, {
			...DEFAULT_CONFIG,
			groupDefaultExpanded: (info) => {
				seen.push(info);
				return info.keyString === 'A' || info.level > 0;
			},
		});
		const a = roots[0].kind === 'group' ? roots[0] : null;
		expect(seen.find((info) => info.id === a!.id)).toEqual({
			id: a!.id,
			level: 0,
			field: 'category',
			key: 'A',
			keyString: 'A',
			path: a!.path,
			leafCount: 1,
		});
		const inner = seen.find((info) => info.level === 1)!;
		expect(inner).toMatchObject({ field: 'parentId', key: 'x', keyString: 'x', leafCount: 1 });
		expect(inner.path.map((p) => p.keyString)).toEqual(['A', 'x']);
		// B is closed by the predicate, so its inner group is never flattened (or asked about).
		expect(result.find((r) => r.kind === 'group' && r.keyString === 'B')!.hierarchy.expanded).toBe(false);
		expect(seen.some((info) => info.path.some((p) => p.keyString === 'y'))).toBe(false);
	});

	it('keys tree rows by their row: visual id, not the raw row id', () => {
		const nodes = [
			new RowNode<Row>('parent', { id: 'parent', category: 'A', parentId: null }),
			new RowNode<Row>('child', { id: 'child', category: 'A', parentId: 'parent' }),
		];
		const roots = treeStage(nodes, (row) => row.parentId ?? null);
		expect(flattenStage(roots, { ...DEFAULT_CONFIG, expansion: openRows(['parent']) })).toHaveLength(1);
		expect(flattenStage(roots, { ...DEFAULT_CONFIG, expansion: openRows(['row:parent']) })).toHaveLength(2);
		// An override closes a tree row that the tree default opens.
		const closed = flattenStage(roots, { ...DEFAULT_CONFIG, treeDefaultExpanded: true, expansion: expansion({ 'row:parent': false }) });
		expect(closed).toHaveLength(1);
		expect(closed[0].hierarchy.expanded).toBe(false);
	});

	it('detail.isMaster returning false suppresses a detail row that is marked open', () => {
		const nodes = [makeNode('m1'), makeNode('m2')];
		const roots = nodes.map((n) => ({ kind: 'data' as const, rowId: n.id, node: n, depth: 0 }));
		const result = flattenStage(roots, {
			...DEFAULT_CONFIG,
			detail: { isMaster: (_row, rowId) => rowId !== 'm2', height: ({ rowId }) => (rowId === 'm1' ? 120 : 80) },
			expansion: expansion({}, { m1: true, m2: true }),
		});
		expect(result.map((r) => r.id)).toEqual(['row:m1', 'detail:m1', 'row:m2']);
		expect(result[1].height).toBe(120);
	});
});
