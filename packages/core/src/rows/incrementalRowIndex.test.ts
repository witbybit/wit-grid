import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '../columnDef.js';
import { RowNode } from '../rowNode.js';
import type { VisualRow } from '../visualRow.js';
import type { AggregationDef, TotalsConfig } from './hierarchyConfig.js';
import { IncrementalRowIndex, type IncrementalTarget } from './incrementalRowIndex.js';
import { RowPipeline, type RowPipelineInput, type RowPipelineOutput } from './RowPipeline.js';

interface Row {
	id: string;
	region: string;
	sector: string;
	team: string;
	a: number;
	b: number;
	s: number;
	d: number;
	cat: string;
}

const COLUMNS: ColumnDef<Row>[] = ['id', 'region', 'sector', 'team', 'a', 'b', 's', 'd', 'cat'].map(
	(field) => ({ field, header: field }) as ColumnDef<Row>
);

function rng(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

interface Scenario {
	name: string;
	by: string[];
	aggs: AggregationDef<Row>[];
	sort: Array<{ colId: string; sort: 'asc' | 'desc' }> | null;
	totals?: TotalsConfig;
	collapse: number;
	/** Largest update batch (default 50); large batches move many leaves per group (the merge path). */
	maxBatch?: number;
}

const ALL_AGGS: AggregationDef<Row>[] = [
	{ colId: 'a', aggFunc: 'sum' },
	{ colId: 'b', aggFunc: 'avg' },
	{ colId: 'a', aggFunc: 'count' },
	{ colId: 's', aggFunc: 'min' },
	{ colId: 'b', aggFunc: 'max' },
	{ colId: 'd', aggFunc: 'distinctCount' },
	{ colId: 'cat', aggFunc: 'first' },
	{ colId: 's', aggFunc: 'last' },
];

const SCENARIOS: Scenario[] = [
	{
		name: '1 level, large batches: many moved leaves per group are merged',
		by: ['region'],
		aggs: ALL_AGGS,
		sort: [{ colId: 'a', sort: 'desc' }],
		totals: { grand: 'bottom' },
		collapse: 0,
		maxBatch: 300,
	},
	{
		name: '1 level, sort desc with ties, grand total',
		by: ['region'],
		aggs: ALL_AGGS,
		sort: [{ colId: 's', sort: 'desc' }],
		totals: { grand: 'bottom' },
		collapse: 0,
	},
	{
		name: '2 levels, two sort keys, totals, some collapsed',
		by: ['region', 'sector'],
		aggs: ALL_AGGS,
		sort: [
			{ colId: 's', sort: 'asc' },
			{ colId: 'a', sort: 'desc' },
		],
		totals: { groups: 'bottom', grand: 'top' },
		collapse: 3,
	},
	{
		name: '3 levels, sort on aggregate input, top totals',
		by: ['region', 'sector', 'team'],
		aggs: [
			{ colId: 'a', aggFunc: 'sum' },
			{ colId: 'a', aggFunc: 'max' },
			{ colId: 'a', aggFunc: 'min' },
			{ colId: 'd', aggFunc: 'distinctCount' },
		],
		sort: [{ colId: 'a', sort: 'desc' }],
		totals: { groups: 'top', grand: 'bottom' },
		collapse: 6,
	},
	{ name: '2 levels, no sort, aggregates only', by: ['region', 'sector'], aggs: ALL_AGGS, sort: null, collapse: 2 },
	{ name: '2 levels, sort without aggregates', by: ['region', 'sector'], aggs: [], sort: [{ colId: 's', sort: 'desc' }], collapse: 2 },
];

function makeRows(random: () => number, count: number): Row[] {
	const regions = ['N', 'S', 'E'];
	return Array.from({ length: count }, (_, i) => ({
		id: `r${i}`,
		region: regions[Math.floor(random() * regions.length)],
		sector: `s${Math.floor(random() * 3)}`,
		team: `t${Math.floor(random() * 3)}`,
		a: Math.round(random() * 10000) / 100,
		b: Math.floor(random() * 50) * 2,
		s: Math.floor(random() * 6),
		d: Math.floor(random() * 8),
		cat: `c${Math.floor(random() * 5)}`,
	}));
}

function pipelineInput(nodes: RowNode<Row>[], sc: Scenario, expansion: RowPipelineInput<Row>['expansion']): RowPipelineInput<Row> {
	return {
		nodes,
		columns: COLUMNS,
		sortModel: sc.sort,
		filterModel: null,
		grouping: { by: sc.by, totals: sc.totals, defaultExpanded: true },
		aggregation: { defs: sc.aggs },
		expansion,
		defaultRowHeight: 28,
		rowHeightsRecord: {},
	};
}

function project(rows: VisualRow<Row>[]): unknown[] {
	return rows.map((row) => {
		const { node, ...rest } = row as VisualRow<Row> & { node?: RowNode<Row> };
		return { ...rest, nodeId: node?.id };
	});
}

function expectEqualOutputs(actual: RowPipelineOutput<Row>, expected: RowPipelineOutput<Row>): void {
	expect(actual.visualRows.map((r) => r.id)).toEqual(expected.visualRows.map((r) => r.id));
	expect(approx(project(actual.visualRows))).toEqual(approx(project(expected.visualRows)));
	expect(actual.visualRowIdToIndex).toEqual(expected.visualRowIdToIndex);
	expect(actual.rowIdToVisualIndex).toEqual(expected.rowIdToVisualIndex);
	expect(actual.rowIdToVisualRowId).toEqual(expected.rowIdToVisualRowId);
	expect(approx(actual.groupMeta)).toEqual(approx(expected.groupMeta));
	expect(approx(actual.groupMetaByVisualIndex)).toEqual(approx(expected.groupMetaByVisualIndex));
	expect(actual.stickyGroupMeta).toEqual(expected.stickyGroupMeta);
}

function setup(sc: Scenario, seed: number, rowCount = 300) {
	const random = rng(seed);
	const rows = makeRows(random, rowCount);
	const nodes = rows.map((row) => new RowNode<Row>(row.id, row));
	const sourceIndex = new Map(rows.map((row, i) => [row.id, i]));
	const pipeline = new RowPipeline<Row>();
	let expansion: RowPipelineInput<Row>['expansion'] = { rows: {}, details: {} };
	let output = pipeline.run(pipelineInput(nodes, sc, expansion));
	// Collapse a few groups at random.
	const groupIds = output.visualRows.flatMap((r) => (r.kind === 'group' ? [r.id] : []));
	const explicit: Record<string, boolean> = {};
	for (let i = 0; i < sc.collapse && groupIds.length > 0; i++) explicit[groupIds[Math.floor(random() * groupIds.length)]] = false;
	expansion = { rows: explicit, details: {} };
	output = pipeline.run(pipelineInput(nodes, sc, expansion));
	const index = IncrementalRowIndex.create<Row>({
		roots: output.roots!,
		columns: COLUMNS,
		sortModel: sc.sort,
		aggDefs: sc.aggs,
		groupByColIds: sc.by,
		hasGrandTotal: !!sc.totals?.grand,
		getSourceIndex: (id) => sourceIndex.get(id),
	});
	const target: IncrementalTarget<Row> = {
		visualRows: output.visualRows,
		visualRowIdToIndex: output.visualRowIdToIndex,
		rowIdToVisualIndex: output.rowIdToVisualIndex,
		groupMeta: output.groupMeta,
	};
	return { random, rows, nodes, pipeline, expansion, output, index, target };
}

/**
 * Aggregates move by delta, so float sums may differ from a fresh left-to-right sum in the last
 * digits; compare numbers to 12 significant digits (everything else exactly).
 */
function approx<T>(value: T): T {
	if (typeof value === 'number') return (Number.isFinite(value) ? Number(value.toPrecision(12)) : value) as T;
	if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, approx(v)])) as T;
	if (Array.isArray(value)) return value.map((v) => approx(v)) as T;
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, approx(v)])) as T;
	return value;
}

function mutate(nodes: RowNode<Row>[], random: () => number, count: number) {
	const updated: RowNode<Row>[] = [];
	const changedValuesByRow = new Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>();
	const picked = new Set<number>();
	while (picked.size < count) picked.add(Math.floor(random() * nodes.length));
	for (const i of picked) {
		const node = nodes[i];
		const prev = node.data;
		const next: Row = { ...prev };
		const changes = new Map<string, { oldValue: unknown; newValue: unknown }>();
		const set = <K extends 'a' | 'b' | 's' | 'd' | 'cat'>(key: K, value: Row[K]) => {
			if (next[key] !== value) {
				changes.set(key, { oldValue: prev[key], newValue: value });
				next[key] = value;
			}
		};
		if (random() < 0.7) set('s', Math.floor(random() * 6));
		if (random() < 0.7) set('a', Math.round(random() * 10000) / 100);
		if (random() < 0.5) set('b', Math.floor(random() * 50) * 2);
		if (random() < 0.3) set('d', Math.floor(random() * 8));
		if (random() < 0.3) set('cat', `c${Math.floor(random() * 5)}`);
		if (changes.size === 0) continue;
		node.setData(next);
		updated.push(node);
		changedValuesByRow.set(node.id, changes);
	}
	return { updated, changedValuesByRow };
}

// Each property test runs 200 full pipeline rebuilds to compare against: generous under suite load.
describe('IncrementalRowIndex', { timeout: 30_000 }, () => {
	for (const [n, sc] of SCENARIOS.entries()) {
		it(`matches a fresh pipeline run after 200 random update batches: ${sc.name}`, () => {
			const ctx = setup(sc, 1000 + n);
			expect(ctx.index).not.toBeNull();
			for (let batch = 0; batch < 200; batch++) {
				const count = 1 + Math.floor(ctx.random() * (sc.maxBatch ?? 50));
				const { updated, changedValuesByRow } = mutate(ctx.nodes, ctx.random, count);
				const result = ctx.index!.apply(updated, changedValuesByRow, ctx.target);
				expect(result).not.toBeNull();
				const fresh = new RowPipeline<Row>().run(pipelineInput(ctx.nodes, sc, ctx.expansion));
				expectEqualOutputs(ctx.output, fresh);
			}
		});
	}

	it('reports moved ranges and aggregate-changed rows', () => {
		const sc = SCENARIOS[1];
		const ctx = setup(sc, 7);
		const { updated, changedValuesByRow } = mutate(ctx.nodes, ctx.random, 40);
		const before = ctx.output.visualRows.slice();
		const result = ctx.index!.apply(updated, changedValuesByRow, ctx.target)!;
		expect(result.aggregateChangedIndices).toEqual([...result.aggregateChangedIndices].sort((x, y) => x - y));
		for (const i of result.aggregateChangedIndices) expect(ctx.output.visualRows[i]).not.toBe(before[i]);
		if (result.changedStartIndex !== undefined) {
			expect(result.moved).toBe(true);
			for (let i = 0; i < before.length; i++) {
				if (before[i] !== ctx.output.visualRows[i] && !result.aggregateChangedIndices.includes(i)) {
					expect(i).toBeGreaterThanOrEqual(result.changedStartIndex);
					expect(i).toBeLessThanOrEqual(result.changedEndIndex!);
				}
			}
		}
	});

	it('a no-op update changes nothing', () => {
		const ctx = setup(SCENARIOS[1], 3);
		const before = ctx.output.visualRows.slice();
		expect(ctx.index!.apply([], new Map(), ctx.target)).toEqual({ moved: false, changedRanges: [], aggregateChangedIndices: [] });
		const node = ctx.nodes[0];
		const result = ctx.index!.apply([node], new Map([[node.id, new Map()]]), ctx.target)!;
		expect(result.moved).toBe(false);
		expect(result.aggregateChangedIndices).toEqual([]);
		expect(ctx.output.visualRows).toEqual(before);
	});

	it('refuses a changed group key', () => {
		const ctx = setup(SCENARIOS[0], 5);
		const node = ctx.nodes[0];
		const next = { ...node.data, region: 'W' };
		node.setData(next);
		expect(ctx.index!.apply([node], new Map([[node.id, new Map([['region', { oldValue: 'N', newValue: 'W' }]])]]), ctx.target)).toBeNull();
	});

	it('falls back to the full run above max(2000, 5% of rows) changed rows', () => {
		const sc = SCENARIOS[0];
		const ctx = setup(sc, 11, 2100);
		const touch = (count: number) => {
			const nodes = ctx.nodes.slice(0, count);
			const changed = new Map(nodes.map((n) => [n.id, new Map([['a', { oldValue: n.data.a, newValue: n.data.a }]])]));
			return { nodes, changed };
		};
		const over = touch(2101);
		expect(ctx.index!.apply(over.nodes, over.changed, ctx.target)).toBeNull();
		const within = touch(2000);
		expect(ctx.index!.apply(within.nodes, within.changed, ctx.target)).not.toBeNull();
	});

	it('is not built for shapes it does not handle', () => {
		const sc = SCENARIOS[0];
		const ctx = setup(sc, 13);
		const base = {
			roots: ctx.output.roots!,
			columns: COLUMNS,
			sortModel: sc.sort,
			aggDefs: sc.aggs,
			groupByColIds: sc.by,
			hasGrandTotal: false,
			getSourceIndex: () => 0,
		};
		expect(IncrementalRowIndex.create({ ...base, groupByColIds: [] })).toBeNull();
		expect(IncrementalRowIndex.create({ ...base, aggDefs: [{ colId: 'a', aggFunc: () => 1 }] })).toBeNull();
		expect(
			IncrementalRowIndex.create({ ...base, columns: COLUMNS.map((c) => (c.field === 's' ? { ...c, valueGetter: () => 1 } : c)) })
		).toBeNull();
	});
});

describe('ClientRowModelController grouped live updates', () => {
	it('absorbs sort-key and aggregate updates without a full run, matching what one would produce', async () => {
		const { GridStore } = await import('../store.js');
		const { ClientRowModelController } = await import('../rowModel.js');
		const random = rng(99);
		const rows = makeRows(random, 400);
		const store = new GridStore<Row>({ columns: COLUMNS, getRowId: (r) => r.id });
		const controller = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
		store.setGrouping({ by: ['region', 'sector'], defaultExpanded: true, totals: { grand: 'bottom' } });
		store.setAggregation({
			defs: [
				{ colId: 'a', aggFunc: 'sum' },
				{ colId: 'b', aggFunc: 'avg' },
				{ colId: 'd', aggFunc: 'distinctCount' },
			],
		});
		store.setSortModel([{ colId: 's', sort: 'desc' }] as never);
		const snapshot = () => {
			const out: unknown[] = [];
			for (let i = 0; i < controller.getVisualRowCount(); i++) {
				const row = controller.getVisualRow(i)!;
				out.push([row.id, row.hierarchy, 'aggregates' in row ? row.aggregates : null]);
			}
			return out;
		};
		const runFull = vi.spyOn(RowPipeline.prototype, 'run');
		for (let batch = 0; batch < 20; batch++) {
			const update = Array.from({ length: 1 + Math.floor(random() * 20) }, () => {
				const i = Math.floor(random() * rows.length);
				rows[i] = { ...rows[i], a: Math.round(random() * 10000) / 100, s: Math.floor(random() * 6), d: Math.floor(random() * 8) };
				return rows[i];
			});
			const before = runFull.mock.calls.length;
			store.transaction({ rows: { update } });
			if (batch > 0) expect(runFull.mock.calls.length).toBe(before);
			const incremental = snapshot();
			controller.refresh('bulk');
			expect(incremental).toEqual(snapshot());
		}
		runFull.mockRestore();
		store.destroy();
	});
});
