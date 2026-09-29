import { createGridRowDataRef, type GridRowDataRef } from '../../publicRowRef.js';
import { RowNode } from '../../store.js';
import type { RowPipelineContext, RowTreeNode } from './types.js';

export interface AggregationDef<TData = unknown> {
	field: string;
	aggFunc: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((nodes: GridRowDataRef<TData>[]) => unknown);
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
	context: RowPipelineContext<TData>
): Record<string, unknown> {
	if (aggDefs.length === 0) return {};

	const needsLeafNodes = aggDefs.some((def) => typeof def.aggFunc === 'function');
	// Values are gathered once per field, however many built-in definitions read that field.
	const statFields = [...new Set(aggDefs.filter((def) => typeof def.aggFunc !== 'function').map((def) => def.field))];
	// One shared DFS-ordered accumulator: a subtree's leaves are a contiguous tail of it.
	const leafAccumulator: GridRowDataRef<TData>[] | null = needsLeafNodes ? [] : null;
	const grandStats = new Map<string, NumericStats>();
	for (const root of roots) aggregateNodeRecursively(root, aggDefs, statFields, context, grandStats, leafAccumulator);
	return computeAggregates(aggDefs, grandStats, leafAccumulator ?? undefined, context);
}

interface NumericStats {
	totalCount: number;
	numericCount: number;
	sum: number;
	min: number;
	max: number;
}

function createStats(): NumericStats {
	return {
		totalCount: 0,
		numericCount: 0,
		sum: 0,
		min: Infinity,
		max: -Infinity,
	};
}

function addNodeValue<TData>(stats: NumericStats, node: RowNode<TData>, field: string, context: RowPipelineContext<TData>): void {
	stats.totalCount++;
	const value = context.getValue(node, field);
	if (typeof value === 'number' && !isNaN(value)) {
		stats.numericCount++;
		stats.sum += value;
		if (value < stats.min) stats.min = value;
		if (value > stats.max) stats.max = value;
	}
}

function mergeStats(target: NumericStats, source: NumericStats): void {
	target.totalCount += source.totalCount;
	target.numericCount += source.numericCount;
	target.sum += source.sum;
	if (source.min < target.min) target.min = source.min;
	if (source.max > target.max) target.max = source.max;
}

function getStats(statsByField: Map<string, NumericStats>, field: string): NumericStats {
	let stats = statsByField.get(field);
	if (!stats) {
		stats = createStats();
		statsByField.set(field, stats);
	}
	return stats;
}

/**
 * Folds `node`'s subtree into `parentStats`. Plain leaves add straight into the parent's stats —
 * only nodes with children allocate their own stats map — and leaf refs are appended to the shared
 * DFS accumulator (no per-level array copies or argument spreads).
 */
function aggregateNodeRecursively<TData>(
	node: RowTreeNode<TData>,
	aggDefs: AggregationDef<TData>[],
	statFields: string[],
	context: RowPipelineContext<TData>,
	parentStats: Map<string, NumericStats>,
	leafAccumulator: GridRowDataRef<TData>[] | null
): void {
	const children = node.children;
	const isLeaf = node.kind === 'data' && (children === undefined || children.length === 0);

	if (isLeaf) {
		if (leafAccumulator) leafAccumulator.push(createGridRowDataRef(node.node.id, node.node.data));
		for (const field of statFields) addNodeValue(getStats(parentStats, field), node.node, field, context);
		return;
	}

	const leafStart = leafAccumulator ? leafAccumulator.length : 0;
	const statsByField = new Map<string, NumericStats>();
	for (const child of children ?? []) {
		aggregateNodeRecursively(child, aggDefs, statFields, context, statsByField, leafAccumulator);
	}
	for (const [field, stats] of statsByField) mergeStats(getStats(parentStats, field), stats);

	node.aggregates = computeAggregates(aggDefs, statsByField, leafAccumulator ? leafAccumulator.slice(leafStart) : undefined, context);
}

function computeAggregates<TData>(
	aggDefs: AggregationDef<TData>[],
	statsByField: Map<string, NumericStats>,
	leafNodes: GridRowDataRef<TData>[] | undefined,
	context: RowPipelineContext<TData>
): Record<string, unknown> {
	const aggregates: Record<string, unknown> = {};
	for (const def of aggDefs) {
		const { field, aggFunc } = def;

		if (typeof aggFunc === 'function') {
			try {
				aggregates[field] = aggFunc(leafNodes ?? []);
			} catch (e) {
				context.reportFault?.('custom-aggregation', e, { field });
				aggregates[field] = undefined;
			}
			continue;
		}

		if (aggFunc === 'count') {
			aggregates[field] = statsByField.get(field)?.totalCount ?? 0;
			continue;
		}

		const stats = statsByField.get(field);
		if (!stats || stats.numericCount === 0) {
			aggregates[field] = undefined;
			continue;
		}

		switch (aggFunc) {
			case 'sum':
				aggregates[field] = stats.sum;
				break;
			case 'avg':
				aggregates[field] = stats.sum / stats.numericCount;
				break;
			case 'min':
				aggregates[field] = stats.min;
				break;
			case 'max':
				aggregates[field] = stats.max;
				break;
		}
	}
	return aggregates;
}
