import { createGridRowDataRef, type GridRowDataRef } from '../../publicRowRef.js';
import type { RowNode } from '../../store.js';
import type { AggregateContext, AggregationDef } from '../hierarchyConfig.js';
import type { RowPipelineContext, RowTreeNode } from './types.js';

export type { AggregationDef } from '../hierarchyConfig.js';

export interface AggregateStageOptions {
	/** Tree parents get the aggregate of their descendants. Default: true. */
	aggregateTreeParents?: boolean;
}

/**
 * Computes aggregates for every group and every tree parent, and returns the grand total (the
 * aggregates of all rows). Only leaf data rows contribute values: a group's or tree parent's
 * aggregate covers its descendants, not the parent row's own data — the parent's value is the
 * aggregate, as in a folder whose size is the sum of what it holds.
 */
export function aggregateStage<TData>(
	roots: RowTreeNode<TData>[],
	aggDefs: AggregationDef<TData>[],
	context: RowPipelineContext<TData>,
	options: AggregateStageOptions = {}
): Record<string, unknown> {
	if (aggDefs.length === 0) return {};

	const run: AggregationRun<TData> = {
		aggDefs,
		context,
		// Values are gathered once per column, however many built-in definitions read it.
		statFields: [...new Set(aggDefs.filter((def) => STAT_FUNCS.has(def.aggFunc as string)).map((def) => def.colId))],
		// One shared DFS-ordered accumulator: a subtree's leaves are a contiguous tail of it.
		leaves: aggDefs.some((def) => !STAT_FUNCS.has(def.aggFunc as string)) ? [] : null,
		aggregateTreeParents: options.aggregateTreeParents ?? true,
	};
	const grandStats = new Map<string, FieldStats>();
	for (const root of roots) aggregateNodeRecursively(root, run, grandStats);
	return computeAggregates(run, grandStats, 0, { scope: 'grand', level: -1 });
}

/** Built-ins computed from running per-column stats; the rest need the leaf rows. */
export const STAT_FUNCS = new Set<string>(['sum', 'avg', 'min', 'max', 'count', 'first', 'last']);

interface AggregationRun<TData> {
	aggDefs: AggregationDef<TData>[];
	context: RowPipelineContext<TData>;
	statFields: string[];
	leaves: RowNode<TData>[] | null;
	aggregateTreeParents: boolean;
}

export interface FieldStats {
	totalCount: number;
	first: unknown;
	last: unknown;
	numericCount: number;
	sum: number;
	min: number;
	max: number;
}

export function createStats(): FieldStats {
	return {
		totalCount: 0,
		first: undefined,
		last: undefined,
		numericCount: 0,
		sum: 0,
		min: Infinity,
		max: -Infinity,
	};
}

function addNodeValue<TData>(stats: FieldStats, node: RowNode<TData>, colId: string, context: RowPipelineContext<TData>): void {
	addStatsValue(stats, context.getValue(node, colId));
}

/** Folds one leaf value into `stats`, in leaf order. */
export function addStatsValue(stats: FieldStats, value: unknown): void {
	if (stats.totalCount === 0) stats.first = value;
	stats.last = value;
	stats.totalCount++;
	if (typeof value === 'number' && !isNaN(value)) {
		stats.numericCount++;
		stats.sum += value;
		if (value < stats.min) stats.min = value;
		if (value > stats.max) stats.max = value;
	}
}

export function mergeStats(target: FieldStats, source: FieldStats): void {
	if (source.totalCount === 0) return;
	if (target.totalCount === 0) target.first = source.first;
	target.last = source.last;
	target.totalCount += source.totalCount;
	target.numericCount += source.numericCount;
	target.sum += source.sum;
	if (source.min < target.min) target.min = source.min;
	if (source.max > target.max) target.max = source.max;
}

function getStats(statsByField: Map<string, FieldStats>, field: string): FieldStats {
	let stats = statsByField.get(field);
	if (!stats) {
		stats = createStats();
		statsByField.set(field, stats);
	}
	return stats;
}

/**
 * Folds `node`'s subtree into `parentStats`. Plain leaves add straight into the parent's stats —
 * only nodes with children allocate their own stats map — and leaves are appended to the shared
 * DFS accumulator (no per-level array copies or argument spreads).
 */
function aggregateNodeRecursively<TData>(node: RowTreeNode<TData>, run: AggregationRun<TData>, parentStats: Map<string, FieldStats>): void {
	const children = node.children;
	const isLeaf = node.kind === 'data' && (children === undefined || children.length === 0);

	if (isLeaf) {
		run.leaves?.push(node.node);
		for (const colId of run.statFields) addNodeValue(getStats(parentStats, colId), node.node, colId, run.context);
		return;
	}

	const leafStart = run.leaves ? run.leaves.length : 0;
	const statsByField = new Map<string, FieldStats>();
	for (const child of children ?? []) aggregateNodeRecursively(child, run, statsByField);
	for (const [colId, stats] of statsByField) mergeStats(getStats(parentStats, colId), stats);

	if (node.kind === 'group') {
		node.aggregates = computeAggregates(run, statsByField, leafStart, { scope: 'group', level: node.depth, key: node.key });
	} else if (run.aggregateTreeParents) {
		node.aggregates = computeAggregates(run, statsByField, leafStart, { scope: 'tree', level: node.depth });
	}
}

function computeAggregates<TData>(
	run: AggregationRun<TData>,
	statsByField: Map<string, FieldStats>,
	leafStart: number,
	where: Pick<AggregateContext<TData>, 'scope' | 'level' | 'key'>
): Record<string, unknown> {
	const { aggDefs, context } = run;
	const leaves = run.leaves ? run.leaves.slice(leafStart) : [];
	let rows: GridRowDataRef<TData>[] | undefined;
	const aggregates: Record<string, unknown> = {};
	for (const def of aggDefs) {
		const { colId, aggFunc } = def;

		if (typeof aggFunc === 'function') {
			rows ??= leaves.map((leaf) => createGridRowDataRef(leaf.id, leaf.data));
			try {
				aggregates[colId] = aggFunc({ colId, values: leaves.map((leaf) => context.getValue(leaf, colId)), rows, ...where });
			} catch (e) {
				context.reportFault?.('custom-aggregation', e, { colId });
				aggregates[colId] = undefined;
			}
			continue;
		}

		if (aggFunc === 'distinctCount') {
			const distinct = new Set<unknown>();
			for (const leaf of leaves) distinct.add(context.getValue(leaf, colId));
			aggregates[colId] = distinct.size;
			continue;
		}

		const stats = statsByField.get(colId);
		if (aggFunc === 'count') {
			aggregates[colId] = stats?.totalCount ?? 0;
			continue;
		}
		if (aggFunc === 'first' || aggFunc === 'last') {
			aggregates[colId] = stats ? (aggFunc === 'first' ? stats.first : stats.last) : undefined;
			continue;
		}
		if (!stats || stats.numericCount === 0) {
			aggregates[colId] = undefined;
			continue;
		}

		switch (aggFunc) {
			case 'sum':
				aggregates[colId] = stats.sum;
				break;
			case 'avg':
				aggregates[colId] = stats.sum / stats.numericCount;
				break;
			case 'min':
				aggregates[colId] = stats.min;
				break;
			case 'max':
				aggregates[colId] = stats.max;
				break;
		}
	}
	return aggregates;
}
