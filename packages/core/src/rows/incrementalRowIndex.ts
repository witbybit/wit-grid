import type { ColumnDef } from '../columnDef.js';
import { getFieldRoot } from '../ids.js';
import type { GroupRowMeta, SortModel } from '../rowModel.js';
import type { RowNode } from '../rowNode.js';
import type { VisualRow } from '../visualRow.js';
import type { AggregationDef } from './hierarchyConfig.js';
import { createRowPipelineContext } from './pipelineContext.js';
import { compareSortKeys, toSortKey } from './sortKeys.js';
import { addStatsValue, createStats, mergeStats, STAT_FUNCS, type FieldStats } from './stages/aggregateStage.js';
import type { RowPipelineContext, RowTreeNode } from './stages/types.js';
import { toTotalVisualRowId } from './visualRowIds.js';

type GroupNode<TData> = Extract<RowTreeNode<TData>, { kind: 'group' }>;
type LeafNode<TData> = Extract<RowTreeNode<TData>, { kind: 'data' }>;

/** Above this many changed rows (or this share of all rows) a full pipeline run is cheaper. */
export const INCREMENTAL_MIN_ROW_LIMIT = 2000;
export const INCREMENTAL_ROW_SHARE_LIMIT = 0.05;
/** A group's column is recomputed exactly after this many deltas, bounding float drift. */
export const DRIFT_RECOMPUTE_EVERY = 2048;

const BUILT_IN_FUNCS = new Set<string>([...STAT_FUNCS, 'distinctCount']);
/** Key for the grand total in the distinct-value caches. */
const GRAND = Symbol('grand');

export interface IncrementalIndexConfig<TData> {
	roots: RowTreeNode<TData>[];
	columns: ColumnDef<TData>[];
	sortModel: SortModel | null;
	aggDefs: AggregationDef<TData>[];
	groupByColIds: string[];
	hasGrandTotal: boolean;
	getSourceIndex: (rowId: string) => number | undefined;
}

/** The mutable row-model structures the index patches in place. */
export interface IncrementalTarget<TData> {
	visualRows: VisualRow<TData>[];
	visualRowIdToIndex: Map<string, number>;
	rowIdToVisualIndex: Map<string, number>;
	groupMeta: Map<string, GroupRowMeta>;
}

export interface IncrementalApplyResult {
	/** Some row changed position. */
	moved: boolean;
	changedStartIndex?: number;
	changedEndIndex?: number;
	/** The rewritten spans, ascending and disjoint (the start/end above are their union). */
	changedRanges: Array<{ startIndex: number; endIndex: number }>;
	/** Visual indices of group and total rows that got new aggregates, ascending. */
	aggregateChangedIndices: number[];
}

type ChangedValues = Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;

interface TouchedLeaf<TData> {
	leaf: LeafNode<TData>;
	sortChanged: boolean;
	changes: Array<{ colId: string; oldValue: unknown; newValue: unknown }>;
}

function fieldMatches(changedField: string, key: string): boolean {
	if (changedField === key) return true;
	const changedRoot = getFieldRoot(changedField);
	const keyRoot = getFieldRoot(key);
	return changedRoot === key || changedField === keyRoot || changedRoot === keyRoot;
}

/**
 * Keeps a grouped client grid's row tree, aggregates and flat visual rows current across value updates
 * that leave every row's group and filter membership alone, at a cost proportional to the change.
 * Built from a full pipeline run's output; results equal a fresh run's. Anything it cannot absorb
 * returns `null` from `apply`, and the caller runs the full pipeline (which discards this index).
 */
export class IncrementalRowIndex<TData> {
	private readonly roots: RowTreeNode<TData>[];
	private readonly levels: number;
	private readonly context: RowPipelineContext<TData>;
	private readonly sortModel: SortModel;
	private readonly aggDefs: AggregationDef<TData>[];
	private readonly statCols: string[];
	private readonly distinctCols: string[];
	private readonly minMaxCols: Set<string>;
	private readonly firstLastCols: Set<string>;
	private readonly aggCols: string[];
	private readonly groupCols: string[];
	private readonly hasGrandTotal: boolean;
	private readonly getSourceIndex: (rowId: string) => number | undefined;
	private readonly leafOf = new Map<string, { leaf: LeafNode<TData>; parent: GroupNode<TData> }>();
	private readonly parentOf = new Map<GroupNode<TData>, GroupNode<TData> | null>();
	private readonly statsCache = new Map<GroupNode<TData>, Map<string, FieldStats>>();
	/** Deltas applied per group and column since its last exact recompute. */
	private readonly deltaCounts = new Map<GroupNode<TData>, Map<string, number>>();
	private readonly distinctCache = new Map<GroupNode<TData> | typeof GRAND, Map<string, Map<unknown, number>>>();

	private constructor(config: IncrementalIndexConfig<TData>) {
		this.roots = config.roots;
		this.levels = config.groupByColIds.length;
		this.context = createRowPipelineContext(config.columns);
		this.sortModel = config.sortModel ?? [];
		this.aggDefs = config.aggDefs;
		this.groupCols = config.groupByColIds;
		this.hasGrandTotal = config.hasGrandTotal;
		this.getSourceIndex = config.getSourceIndex;
		this.statCols = [...new Set(config.aggDefs.filter((d) => STAT_FUNCS.has(d.aggFunc as string)).map((d) => d.colId))];
		this.distinctCols = [...new Set(config.aggDefs.filter((d) => d.aggFunc === 'distinctCount').map((d) => d.colId))];
		this.minMaxCols = new Set(config.aggDefs.filter((d) => d.aggFunc === 'min' || d.aggFunc === 'max').map((d) => d.colId));
		this.firstLastCols = new Set(config.aggDefs.filter((d) => d.aggFunc === 'first' || d.aggFunc === 'last').map((d) => d.colId));
		this.aggCols = [...new Set([...this.statCols, ...this.distinctCols])];
		this.index();
	}

	/** Null when the grid shape is outside what the index handles. */
	static create<TData>(config: IncrementalIndexConfig<TData>): IncrementalRowIndex<TData> | null {
		if (config.groupByColIds.length === 0 || config.roots.length === 0) return null;
		if (config.roots.some((root) => root.kind !== 'group')) return null;
		if (config.aggDefs.some((def) => typeof def.aggFunc !== 'string' || !BUILT_IN_FUNCS.has(def.aggFunc))) return null;
		const byField = new Map(config.columns.map((c) => [c.field, c]));
		const colIds = [...config.aggDefs.map((d) => d.colId), ...(config.sortModel ?? []).map((s) => s.colId)];
		if (colIds.some((id) => byField.get(id)?.valueGetter)) return null;
		return new IncrementalRowIndex(config);
	}

	private index(): void {
		const stack: Array<{ group: GroupNode<TData>; parent: GroupNode<TData> | null }> = [];
		for (const root of this.roots) if (root.kind === 'group') stack.push({ group: root, parent: null });
		while (stack.length > 0) {
			const { group, parent } = stack.pop()!;
			this.parentOf.set(group, parent);
			const lowest = group.depth === this.levels - 1;
			for (const child of group.children) {
				if (child.kind === 'group') stack.push({ group: child, parent: group });
				else if (lowest) this.leafOf.set(child.rowId, { leaf: child, parent: group });
			}
		}
	}

	public get leafCount(): number {
		return this.leafOf.size;
	}

	/**
	 * Absorbs updates to rows that keep their group and filter membership. Returns null (the caller
	 * must run the full pipeline) when it cannot; a null after a partial mutation is still safe since
	 * a full run rebuilds everything.
	 */
	public apply(
		updatedNodes: readonly RowNode<TData>[],
		changedValuesByRow: ChangedValues | undefined,
		target: IncrementalTarget<TData>
	): IncrementalApplyResult | null {
		if (!changedValuesByRow) return null;
		if (updatedNodes.length > Math.max(INCREMENTAL_MIN_ROW_LIMIT, this.leafOf.size * INCREMENTAL_ROW_SHARE_LIMIT)) return null;

		// Validate and collect before mutating anything.
		const touched = new Map<GroupNode<TData>, Map<string, TouchedLeaf<TData>>>();
		for (const node of updatedNodes) {
			const entry = this.leafOf.get(node.id);
			if (!entry) continue; // filtered out: stays filtered (a filter-key write never reaches here)
			const changed = changedValuesByRow.get(node.id);
			if (!changed) return null;
			const item: TouchedLeaf<TData> = { leaf: entry.leaf, sortChanged: false, changes: [] };
			for (const key of changed.keys()) {
				for (const groupCol of this.groupCols) if (fieldMatches(key, groupCol)) return null;
				for (const sort of this.sortModel) if (fieldMatches(key, sort.colId)) item.sortChanged = true;
			}
			for (const colId of this.aggCols) {
				for (const [key, change] of changed) {
					if (!fieldMatches(key, colId)) continue;
					if (key !== colId || colId.includes('.')) return null;
					item.changes.push({ colId, oldValue: change.oldValue, newValue: change.newValue });
				}
			}
			let byRow = touched.get(entry.parent);
			if (!byRow) touched.set(entry.parent, (byRow = new Map()));
			byRow.set(node.id, item);
		}
		if (touched.size === 0) return { moved: false, changedRanges: [], aggregateChangedIndices: [] };

		try {
			return this.applyValidated(touched, target);
		} catch {
			return null;
		}
	}

	private applyValidated(
		touched: Map<GroupNode<TData>, Map<string, TouchedLeaf<TData>>>,
		target: IncrementalTarget<TData>
	): IncrementalApplyResult | null {
		const { visualRows, visualRowIdToIndex, rowIdToVisualIndex, groupMeta } = target;
		let moved = false;
		let start = Infinity;
		let end = -1;
		const changedRanges: Array<{ startIndex: number; endIndex: number }> = [];

		// 1. In-group order. The moved span (lo..hi in the group's children) comes from the moved
		// leaves' old and new positions; a group that is not on screen only reorders its children.
		const moves: Array<{ group: GroupNode<TData>; base: number; moving: LeafNode<TData>[]; lo: number; hi: number }> = [];
		const reordered = new Set<GroupNode<TData>>();
		if (this.sortModel.length > 0) {
			for (const [group, leaves] of touched) {
				const moving: LeafNode<TData>[] = [];
				for (const item of leaves.values()) if (item.sortChanged) moving.push(item.leaf);
				if (moving.length === 0) continue;
				const gi = visualRowIdToIndex.get(group.id);
				const groupRow = gi === undefined ? undefined : visualRows[gi];
				const onScreen = groupRow?.kind === 'group' && groupRow.hierarchy.expanded;
				const base = onScreen ? gi! + 1 + (visualRows[gi! + 1]?.kind === 'total' ? 1 : 0) : -1;
				let lo = Infinity;
				let hi = -1;
				if (onScreen) {
					for (const leaf of moving) {
						const at = rowIdToVisualIndex.get(leaf.rowId);
						if (at === undefined) throw new Error('incremental index out of step');
						lo = Math.min(lo, at - base);
						hi = Math.max(hi, at - base);
					}
				}
				const inserted = this.reinsert(group.children, moving);
				for (const at of inserted) {
					lo = Math.min(lo, at);
					hi = Math.max(hi, at);
				}
				reordered.add(group);
				if (onScreen && hi >= lo) moves.push({ group, base, moving, lo, hi });
			}
		}

		// 2. Stats of the lowest groups. sum/avg/count/min/max move by delta; a column is recomputed
		// from the group's leaves when a delta cannot be exact (the removed value was the min/max,
		// first/last after an edit or reorder) and every DRIFT_RECOMPUTE_EVERY deltas, so float error
		// from deltas stays bounded (~1e-15 relative) instead of accumulating.
		const dirty = new Set<GroupNode<TData>>();
		for (const [group, leaves] of touched) {
			dirty.add(group);
			const cached = this.statsCache.get(group);
			if (!cached) continue;
			for (const colId of this.statCols) {
				const stats = cached.get(colId);
				if (!stats) continue;
				let recompute = this.firstLastCols.has(colId) && reordered.has(group);
				let deltas = 0;
				for (const item of leaves.values()) {
					for (const change of item.changes) {
						if (change.colId !== colId) continue;
						deltas++;
						if (this.firstLastCols.has(colId)) recompute = true;
						const { oldValue, newValue } = change;
						if (typeof oldValue === 'number' && !isNaN(oldValue)) {
							stats.numericCount--;
							stats.sum -= oldValue;
							if (this.minMaxCols.has(colId) && (oldValue === stats.min || oldValue === stats.max)) recompute = true;
						}
						if (typeof newValue === 'number' && !isNaN(newValue)) {
							stats.numericCount++;
							stats.sum += newValue;
							if (newValue < stats.min) stats.min = newValue;
							if (newValue > stats.max) stats.max = newValue;
						}
					}
				}
				if (deltas > 0) {
					const key = colId;
					const counts = this.deltaCounts.get(group) ?? new Map<string, number>();
					this.deltaCounts.set(group, counts);
					const total = (counts.get(key) ?? 0) + deltas;
					if (total >= DRIFT_RECOMPUTE_EVERY) recompute = true;
					counts.set(key, recompute ? 0 : total);
				}
				if (recompute) cached.set(colId, this.statsFromLeaves(group, colId));
				else if (stats.numericCount === 0) {
					stats.sum = 0;
					stats.min = Infinity;
					stats.max = -Infinity;
				}
			}
		}

		// 3. Ancestors: stats are re-merged from their (current) children.
		for (const group of touched.keys()) {
			let up = this.parentOf.get(group) ?? null;
			while (up) {
				dirty.add(up);
				this.statsCache.delete(up);
				up = this.parentOf.get(up) ?? null;
			}
		}

		// 4. Distinct-value counts: deltas through every cached map on the chain.
		for (const [group, leaves] of touched) {
			for (const item of leaves.values()) {
				for (const change of item.changes) {
					if (!this.distinctCols.includes(change.colId)) continue;
					let node: GroupNode<TData> | null = group;
					while (node) {
						this.bumpDistinct(node, change.colId, change.oldValue, change.newValue);
						node = this.parentOf.get(node) ?? null;
					}
					this.bumpDistinct(GRAND, change.colId, change.oldValue, change.newValue);
				}
			}
		}

		// 5. New aggregates, deepest group first so parents merge current children.
		const changedGroups: GroupNode<TData>[] = [];
		if (this.aggDefs.length > 0) {
			const ordered = [...dirty].sort((a, b) => b.depth - a.depth);
			for (const group of ordered) {
				const next = this.aggregatesOf(this.statsOf(group), (colId) => this.distinctOf(group, colId));
				if (!sameAggregates(group.aggregates, next)) {
					group.aggregates = next;
					changedGroups.push(group);
				}
			}
		}
		let grandAggregates: Record<string, unknown> | undefined;
		if (this.hasGrandTotal && this.aggDefs.length > 0) {
			const stats = new Map<string, FieldStats>();
			for (const colId of this.statCols) {
				const total = createStats();
				for (const root of this.roots) if (root.kind === 'group') mergeStats(total, this.statsOf(root).get(colId)!);
				stats.set(colId, total);
			}
			grandAggregates = this.aggregatesOf(stats, (colId) => this.distinctOf(GRAND, colId));
		}

		// 6. The flat list: rewrite only the moved spans.
		for (const { group, base, moving, lo, hi } of moves) {
			const slice = visualRows.slice(base + lo, base + hi + 1);
			const movedRows = new Map<RowTreeNode<TData>, VisualRow<TData>>();
			const movedSlots = new Set<number>();
			for (const leaf of moving) {
				const at = rowIdToVisualIndex.get(leaf.rowId);
				if (at === undefined) throw new Error('incremental index out of step');
				if (at < base + lo || at > base + hi) continue; // landed where it was
				const row = visualRows[at];
				if (row.kind !== 'data') throw new Error('incremental index out of step');
				movedRows.set(leaf, row);
				movedSlots.add(at - base - lo);
			}
			let cursor = 0;
			let changed = false;
			for (let i = lo; i <= hi; i++) {
				const child = group.children[i];
				let row = movedRows.get(child);
				if (!row) {
					while (movedSlots.has(cursor)) cursor++;
					row = slice[cursor++];
				}
				const index = base + i;
				// Rows are this model's own objects: posInSet follows the row's new place in the group.
				(row.hierarchy as { posInSet: number }).posInSet = i + 1;
				if (visualRows[index] === row) continue;
				changed = true;
				visualRows[index] = row;
				visualRowIdToIndex.set(row.id, index);
				if (row.kind === 'data') rowIdToVisualIndex.set(row.rowId, index);
			}
			if (!changed) continue;
			moved = true;
			changedRanges.push({ startIndex: base + lo, endIndex: base + hi });
			start = Math.min(start, base + lo);
			end = Math.max(end, base + hi);
		}

		// 7. Group and total rows with new aggregates.
		const aggregateIndices: number[] = [];
		const replaceAggregates = (index: number | undefined, aggregates: Record<string, unknown>): void => {
			if (index === undefined) return;
			const row = visualRows[index];
			if (row.kind !== 'group' && row.kind !== 'total') return;
			visualRows[index] = { ...row, aggregates };
			aggregateIndices.push(index);
		};
		for (const group of changedGroups) {
			const index = visualRowIdToIndex.get(group.id);
			replaceAggregates(index, group.aggregates);
			const meta = groupMeta.get(group.id);
			if (meta && index !== undefined) meta.aggregates = group.aggregates;
			replaceAggregates(visualRowIdToIndex.get(toTotalVisualRowId(group.id)), group.aggregates);
		}
		if (grandAggregates) {
			const index = visualRowIdToIndex.get(toTotalVisualRowId(null));
			const row = index === undefined ? undefined : visualRows[index];
			if (row && row.kind === 'total' && !sameAggregates(row.aggregates, grandAggregates)) replaceAggregates(index, grandAggregates);
		}
		aggregateIndices.sort((a, b) => a - b);
		changedRanges.sort((a, b) => a.startIndex - b.startIndex);

		return {
			moved,
			changedStartIndex: end >= 0 ? start : undefined,
			changedEndIndex: end >= 0 ? end : undefined,
			changedRanges,
			aggregateChangedIndices: aggregateIndices,
		};
	}

	// ── ordering ────────────────────────────────────────────────────────────────

	/**
	 * Removes `leaves` from the sorted `children` and inserts each at its sorted place. Returns their
	 * final positions (an insert at or before an earlier one shifts it down).
	 */
	private reinsert(children: RowTreeNode<TData>[], leaves: LeafNode<TData>[]): number[] {
		const moving = new Set<RowTreeNode<TData>>(leaves);
		let kept = 0;
		for (const child of children) if (!moving.has(child)) children[kept++] = child;
		children.length = kept;
		const positions: number[] = [];
		for (const leaf of leaves) {
			const keys = this.sortModel.map((s) => toSortKey(this.context.getValue(leaf.node, s.colId)));
			const source = this.getSourceIndex(leaf.rowId) ?? 0;
			let lo = 0;
			let hi = children.length;
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				if (this.compare(keys, source, (children[mid] as LeafNode<TData>).node) < 0) hi = mid;
				else lo = mid + 1;
			}
			children.splice(lo, 0, leaf);
			for (let i = 0; i < positions.length; i++) if (positions[i] >= lo) positions[i]++;
			positions.push(lo);
		}
		return positions;
	}

	/** The tree sort's comparison: sort model in order, ties by source order. */
	private compare(keys: ReturnType<typeof toSortKey>[], source: number, other: RowNode<TData>): number {
		for (let i = 0; i < this.sortModel.length; i++) {
			const c = compareSortKeys(keys[i], toSortKey(this.context.getValue(other, this.sortModel[i].colId)));
			if (c !== 0) {
				const signed = this.sortModel[i].sort === 'desc' ? -c : c;
				return Number.isNaN(signed) ? source - (this.getSourceIndex(other.id) ?? 0) : signed;
			}
		}
		return source - (this.getSourceIndex(other.id) ?? 0);
	}

	// ── aggregates ──────────────────────────────────────────────────────────────

	private statsFromLeaves(group: GroupNode<TData>, colId: string): FieldStats {
		const stats = createStats();
		for (const child of group.children) if (child.kind === 'data') addStatsValue(stats, this.context.getValue(child.node, colId));
		return stats;
	}

	private statsOf(group: GroupNode<TData>): Map<string, FieldStats> {
		let stats = this.statsCache.get(group);
		if (stats) return stats;
		stats = new Map();
		if (group.depth === this.levels - 1) {
			for (const colId of this.statCols) stats.set(colId, this.statsFromLeaves(group, colId));
		} else {
			for (const colId of this.statCols) stats.set(colId, createStats());
			for (const child of group.children) {
				if (child.kind !== 'group') continue;
				const childStats = this.statsOf(child);
				for (const colId of this.statCols) mergeStats(stats.get(colId)!, childStats.get(colId)!);
			}
		}
		this.statsCache.set(group, stats);
		return stats;
	}

	private distinctOf(owner: GroupNode<TData> | typeof GRAND, colId: string): Map<unknown, number> {
		let byCol = this.distinctCache.get(owner);
		if (!byCol) this.distinctCache.set(owner, (byCol = new Map()));
		let counts = byCol.get(colId);
		if (counts) return counts;
		counts = new Map();
		const add = (value: unknown, n: number) => counts!.set(value, (counts!.get(value) ?? 0) + n);
		if (owner === GRAND) {
			for (const root of this.roots) if (root.kind === 'group') for (const [v, n] of this.distinctOf(root, colId)) add(v, n);
		} else if (owner.depth === this.levels - 1) {
			for (const child of owner.children) if (child.kind === 'data') add(this.context.getValue(child.node, colId), 1);
		} else {
			for (const child of owner.children) if (child.kind === 'group') for (const [v, n] of this.distinctOf(child, colId)) add(v, n);
		}
		byCol.set(colId, counts);
		return counts;
	}

	private bumpDistinct(owner: GroupNode<TData> | typeof GRAND, colId: string, oldValue: unknown, newValue: unknown): void {
		const counts = this.distinctCache.get(owner)?.get(colId);
		if (!counts) return;
		const had = counts.get(oldValue);
		if (had === undefined) throw new Error('incremental index out of step');
		if (had === 1) counts.delete(oldValue);
		else counts.set(oldValue, had - 1);
		counts.set(newValue, (counts.get(newValue) ?? 0) + 1);
	}

	/** `aggregateStage`'s computeAggregates for built-in functions. */
	private aggregatesOf(stats: Map<string, FieldStats>, distinct: (colId: string) => Map<unknown, number>): Record<string, unknown> {
		const aggregates: Record<string, unknown> = {};
		for (const { colId, aggFunc } of this.aggDefs) {
			if (aggFunc === 'distinctCount') {
				aggregates[colId] = distinct(colId).size;
				continue;
			}
			const s = stats.get(colId)!;
			if (aggFunc === 'count') aggregates[colId] = s.totalCount;
			else if (aggFunc === 'first') aggregates[colId] = s.first;
			else if (aggFunc === 'last') aggregates[colId] = s.last;
			else if (s.numericCount === 0) aggregates[colId] = undefined;
			else if (aggFunc === 'sum') aggregates[colId] = s.sum;
			else if (aggFunc === 'avg') aggregates[colId] = s.sum / s.numericCount;
			else if (aggFunc === 'min') aggregates[colId] = s.min;
			else if (aggFunc === 'max') aggregates[colId] = s.max;
		}
		return aggregates;
	}
}

function sameAggregates(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
	let count = 0;
	for (const key in a) {
		if (!Object.is(a[key], b[key])) return false;
		count++;
	}
	return count === Object.keys(b).length;
}
