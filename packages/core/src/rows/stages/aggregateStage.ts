import { createGridRowDataRef, type GridRowDataRef } from '../../publicRowRef.js';
import { RowNode } from '../../store.js';
import type { RowPipelineContext, RowTreeNode } from './types.js';

export interface AggregationDef<TData = unknown> {
	field: string;
	aggFunc: 'sum' | 'avg' | 'min' | 'max' | 'count' | ((nodes: GridRowDataRef<TData>[]) => unknown);
}

export function aggregateStage<TData>(roots: RowTreeNode<TData>[], aggDefs: AggregationDef<TData>[], context: RowPipelineContext<TData>): void {
	if (aggDefs.length === 0) return;

	const needsLeafNodes = aggDefs.some((def) => typeof def.aggFunc === 'function');
	// One shared DFS-ordered accumulator: a subtree's leaves are a contiguous tail of it.
	const leafAccumulator: GridRowDataRef<TData>[] | null = needsLeafNodes ? [] : null;
	for (const root of roots) {
		aggregateNodeRecursively(root, aggDefs, context, null, leafAccumulator);
		if (leafAccumulator) leafAccumulator.length = 0;
	}
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
 * Folds `node`'s subtree into `parentStats` (null at a root). Plain leaves add straight into the
 * parent's stats — only nodes with children allocate their own stats map — and leaf refs are
 * appended to the shared DFS accumulator (no per-level array copies or argument spreads).
 */
function aggregateNodeRecursively<TData>(
	node: RowTreeNode<TData>,
	aggDefs: AggregationDef<TData>[],
	context: RowPipelineContext<TData>,
	parentStats: Map<string, NumericStats> | null,
	leafAccumulator: GridRowDataRef<TData>[] | null
): void {
	const children = node.children;
	const hasChildren = node.kind === 'group' || (children !== undefined && children.length > 0);

	if (node.kind === 'data') {
		if (leafAccumulator) leafAccumulator.push(createGridRowDataRef(node.node.id, node.node.data));
		if (!hasChildren) {
			if (parentStats) {
				for (const def of aggDefs) {
					if (typeof def.aggFunc !== 'function') {
						addNodeValue(getStats(parentStats, def.field), node.node, def.field, context);
					}
				}
			}
			return;
		}
	}

	const leafStart = leafAccumulator ? leafAccumulator.length - (node.kind === 'data' ? 1 : 0) : 0;
	const statsByField = new Map<string, NumericStats>();
	if (node.kind === 'data') {
		for (const def of aggDefs) {
			if (typeof def.aggFunc !== 'function') {
				addNodeValue(getStats(statsByField, def.field), node.node, def.field, context);
			}
		}
	}

	for (const child of children ?? []) {
		aggregateNodeRecursively(child, aggDefs, context, statsByField, leafAccumulator);
	}

	if (parentStats) {
		for (const [field, stats] of statsByField) {
			mergeStats(getStats(parentStats, field), stats);
		}
	}

	if (node.kind === 'data') return;

	const leafNodes = leafAccumulator ? leafAccumulator.slice(leafStart) : undefined;
	const aggregateValues: Record<string, unknown> = {};

	for (const def of aggDefs) {
		const { field, aggFunc } = def;

		if (typeof aggFunc === 'function') {
			try {
				aggregateValues[field] = aggFunc(leafNodes ?? []);
			} catch (e) {
				context.reportFault?.('custom-aggregation', e, { field });
				aggregateValues[field] = undefined;
			}
			continue;
		}

		if (aggFunc === 'count') {
			aggregateValues[field] = statsByField.get(field)?.totalCount ?? 0;
			continue;
		}

		const stats = statsByField.get(field);
		if (!stats || stats.numericCount === 0) {
			aggregateValues[field] = undefined;
			continue;
		}

		switch (aggFunc) {
			case 'sum':
				aggregateValues[field] = stats.sum;
				break;
			case 'avg':
				aggregateValues[field] = stats.sum / stats.numericCount;
				break;
			case 'min':
				aggregateValues[field] = stats.min;
				break;
			case 'max':
				aggregateValues[field] = stats.max;
				break;
		}
	}

	node.aggregateValues = aggregateValues;
}
