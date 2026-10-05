import type { ColumnDef } from '../columnDef.js';
import { getFieldRoot } from '../ids.js';
import type { GroupRowMeta, SortModel } from '../rowModel.js';
import type { RowNode } from '../rowNode.js';
import type { VisualRow } from '../visualRow.js';
import type { AggregationDef, GroupDef } from './hierarchyConfig.js';
import { createRowPipelineContext } from './pipelineContext.js';
import { compareSortKeys, toSortKey } from './sortKeys.js';
import { addStatsValue, createStats, mergeStats, STAT_FUNCS, type FieldStats } from './stages/aggregateStage.js';
import type { RowPipelineContext, RowTreeNode } from './stages/types.js';
import { toDataVisualRowId, toGroupVisualRowId, toTotalVisualRowId, type GroupPathItem } from './visualRowIds.js';

type GroupNode<TData> = Extract<RowTreeNode<TData>, { kind: 'group' }>;
type LeafNode<TData> = Extract<RowTreeNode<TData>, { kind: 'data' }>;

/** Above this many changed rows (or this share of all rows) a full pipeline run is cheaper. */
export const INCREMENTAL_MIN_ROW_LIMIT = 2000;
export const INCREMENTAL_ROW_SHARE_LIMIT = 0.25;
/** A group's column is recomputed exactly after this many deltas, bounding float drift. */
export const DRIFT_RECOMPUTE_EVERY = 2048;
/** More moved leaves than this are merged in one pass instead of spliced one by one. */
export const MERGE_REINSERT_MIN = 32;

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
	/** The grouping levels (carrying key creators); defaults to plain columns named by `groupByColIds`. */
	groupDefs?: GroupDef<TData>[];
	/** Whether a node passes the client filters; null when none are active. */
	matchesFilter?: ((node: RowNode<TData>) => boolean) | null;
	/** For rows that enter the flat list (heights as the flatten stage reads them). */
	defaultRowHeight?: number;
	rowHeights?: Record<string, number>;
	/** Group expansion depends on a group's leaf count: moves and filter flips change it, so they fall back. */
	countSensitiveExpansion?: boolean;
}

/**
 * The mutable row-model structures the index patches in place. Data rows have no index map here: a row
 * is found through its leaf (`leaf.row`, its place in the group) and its group row ({@link visualIndexOfRow}),
 * so a group that grows or shrinks shifts only group and total rows.
 */
export interface IncrementalTarget<TData> {
	visualRows: VisualRow<TData>[];
	visualRowIdToIndex: Map<string, number>;
	groupMeta: Map<string, GroupRowMeta>;
	groupMetaByVisualIndex: Map<number, GroupRowMeta>;
	stickyGroupMeta: Map<number, number>;
}

export interface IncrementalApplyOptions {
	/** Re-evaluate the client filter for every updated row (a filter or group key may have changed). */
	checkFilter?: boolean;
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
	/** Rows entered, left or changed group: some group's membership (counts, aggregates) changed. */
	membershipChanged: boolean;
	/** The flat list gained or lost rows or rewrote whole group spans: indices after the first change shifted. */
	listChanged: boolean;
}

type ChangedValues = Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;

interface TouchedLeaf<TData> {
	leaf: LeafNode<TData>;
	sortChanged: boolean;
	changes: Array<{ colId: string; oldValue: unknown; newValue: unknown }>;
}

/** A row that changes group, enters the filter (`from` null) or leaves it (`to` null). */
interface StructuralOp<TData> {
	node: RowNode<TData>;
	leaf: LeafNode<TData>;
	from: GroupNode<TData> | null;
	to: GroupNode<TData> | null;
	changed: Map<string, { oldValue: unknown; newValue: unknown }> | undefined;
}

interface GroupWork<TData> {
	sortMovers: LeafNode<TData>[];
	removed: StructuralOp<TData>[];
	added: StructuralOp<TData>[];
}

interface StructSpan<TData> {
	group: GroupNode<TData>;
	/** Flat index of the group's first data row. */
	base: number;
	/** Its data rows before the change. */
	oldN: number;
	work: GroupWork<TData>;
}

/** A rewritten span of the flat list: where it started (old coordinates), by how much its length changed, where it is now. */
interface SpanInfo {
	oldStart: number;
	delta: number;
	newStart: number;
	newEnd: number;
}

/** Maps an old flat index outside every rewritten span to its new one. */
function makeShift(spans: SpanInfo[]): (index: number) => number {
	const cumulative: number[] = [];
	let sum = 0;
	for (const span of spans) cumulative.push((sum += span.delta));
	return (index) => {
		let lo = 0;
		let hi = spans.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (spans[mid].oldStart <= index) lo = mid + 1;
			else hi = mid;
		}
		return lo === 0 ? index : index + cumulative[lo - 1];
	};
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
	private readonly groupColSet: Set<string>;
	private readonly sortColSet: Set<string>;
	private readonly aggColSet: Set<string>;
	/** No grouped, sorted or aggregated column is a dotted path: changes match by plain set lookups. */
	private readonly plainFields: boolean;
	private readonly hasGrandTotal: boolean;
	private readonly getSourceIndex: (rowId: string) => number | undefined;
	private readonly groupDefs: GroupDef<TData>[];
	private readonly matchesFilter: ((node: RowNode<TData>) => boolean) | null;
	private readonly defaultRowHeight: number;
	private readonly rowHeights: Record<string, number>;
	/** Rows can change group / enter / leave the filter: needs plain group columns without key creators. */
	private readonly structuralOk: boolean;
	private readonly groupById = new Map<string, GroupNode<TData>>();
	private readonly leafOf = new Map<string, { leaf: LeafNode<TData>; parent: GroupNode<TData> }>();
	private readonly parentOf = new Map<GroupNode<TData>, GroupNode<TData> | null>();
	private readonly statsCache = new Map<GroupNode<TData>, Map<string, FieldStats>>();
	private readonly sortEntries = new Map<RowNode<TData>, { keys: ReturnType<typeof toSortKey>[]; source: number }>();
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
		this.groupDefs = config.groupDefs ?? config.groupByColIds.map((colId) => ({ colId }));
		this.matchesFilter = config.matchesFilter ?? null;
		this.defaultRowHeight = config.defaultRowHeight ?? 28;
		this.rowHeights = config.rowHeights ?? {};
		const byField = new Map(config.columns.map((c) => [c.field, c]));
		// Without a sort model a group level without a comparator keeps first-appearance order, which a
		// membership change can alter; only sorted levels are order-stable.
		const groupOrderStable = this.sortModel.length > 0 || this.groupDefs.every((def) => !!def.comparator);
		this.structuralOk =
			!config.countSensitiveExpansion &&
			groupOrderStable &&
			this.groupDefs.length === this.levels &&
			this.groupDefs.every((def) => !def.keyCreator && !def.colId.includes('.') && !byField.get(def.colId)?.valueGetter);
		this.statCols = [...new Set(config.aggDefs.filter((d) => STAT_FUNCS.has(d.aggFunc as string)).map((d) => d.colId))];
		this.distinctCols = [...new Set(config.aggDefs.filter((d) => d.aggFunc === 'distinctCount').map((d) => d.colId))];
		this.minMaxCols = new Set(config.aggDefs.filter((d) => d.aggFunc === 'min' || d.aggFunc === 'max').map((d) => d.colId));
		this.firstLastCols = new Set(config.aggDefs.filter((d) => d.aggFunc === 'first' || d.aggFunc === 'last').map((d) => d.colId));
		this.aggCols = [...new Set([...this.statCols, ...this.distinctCols])];
		this.groupColSet = new Set(this.groupCols);
		this.sortColSet = new Set(this.sortModel.map((s) => s.colId));
		this.aggColSet = new Set(this.aggCols);
		this.plainFields = ![...this.groupColSet, ...this.sortColSet, ...this.aggColSet].some((id) => id.includes('.'));
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
			this.groupById.set(group.id, group);
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
	 * Absorbs updates: value changes, and rows that change group (between existing groups) or enter /
	 * leave the client filter (into / out of an existing group that stays non-empty). Returns null (the
	 * caller must run the full pipeline) when it cannot; a null after a partial mutation is still safe
	 * since a full run rebuilds everything.
	 */
	public apply(
		updatedNodes: readonly RowNode<TData>[],
		changedValuesByRow: ChangedValues | undefined,
		target: IncrementalTarget<TData>,
		options?: IncrementalApplyOptions
	): IncrementalApplyResult | null {
		if (!changedValuesByRow) return null;
		if (updatedNodes.length > Math.max(INCREMENTAL_MIN_ROW_LIMIT, this.leafOf.size * INCREMENTAL_ROW_SHARE_LIMIT)) return null;
		const matches = options?.checkFilter ? this.matchesFilter : null;

		// Validate and collect before mutating anything.
		const touched = new Map<GroupNode<TData>, Map<string, TouchedLeaf<TData>>>();
		const structural: StructuralOp<TData>[] = [];
		const structuralIds = new Set<string>();
		for (const node of updatedNodes) {
			const entry = this.leafOf.get(node.id);
			const changed = changedValuesByRow.get(node.id);
			if (!entry) {
				// Filtered out. It stays out unless the filter now passes it.
				if (!matches || !matches(node)) continue;
				if (!this.structuralOk || !this.plainFields || structuralIds.has(node.id)) return null;
				const chain = this.resolveChain(node);
				if (!chain || !this.keysMatch(chain, node, changed, false)) return null;
				structuralIds.add(node.id);
				structural.push({
					node,
					leaf: { kind: 'data', rowId: node.id, node, depth: this.levels },
					from: null,
					to: chain[this.levels - 1],
					changed,
				});
				continue;
			}
			if (!changed) return null;
			if (matches && !matches(node)) {
				if (!this.structuralOk || !this.plainFields || structuralIds.has(node.id)) return null;
				if (!this.keysMatch(this.chainOf(entry.parent), node, changed, true)) return null;
				structuralIds.add(node.id);
				structural.push({ node, leaf: entry.leaf, from: entry.parent, to: null, changed });
				continue;
			}
			const item: TouchedLeaf<TData> = { leaf: entry.leaf, sortChanged: false, changes: [] };
			let groupChanged = false;
			if (this.plainFields) {
				// No dotted paths anywhere: one pass of set lookups (the live-feed hot path).
				for (const [key, change] of changed) {
					if (key.includes('.')) return null;
					if (this.groupColSet.has(key)) groupChanged = true;
					if (this.sortColSet.has(key)) item.sortChanged = true;
					if (this.aggColSet.has(key)) item.changes.push({ colId: key, oldValue: change.oldValue, newValue: change.newValue });
				}
				if (groupChanged) {
					if (!this.structuralOk) return null;
					const chain = this.resolveChain(node);
					if (!chain) return null;
					if (chain[this.levels - 1] !== entry.parent) {
						const old = this.chainOf(entry.parent);
						for (let level = 0; level < this.levels; level++) {
							if (old[level] === chain[level]) continue;
							const colId = this.groupDefs[level].colId;
							if (!Object.is(this.context.getValue(node, colId), chain[level].key)) return null;
							if (!Object.is(this.rawKey(node, colId, changed, true), old[level].key)) return null;
						}
						if (structuralIds.has(node.id)) return null;
						structuralIds.add(node.id);
						structural.push({ node, leaf: entry.leaf, from: entry.parent, to: chain[this.levels - 1], changed });
						continue;
					}
				}
				let byRow = touched.get(entry.parent);
				if (!byRow) touched.set(entry.parent, (byRow = new Map()));
				byRow.set(node.id, item);
				continue;
			}
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
		if (touched.size === 0 && structural.length === 0) {
			return { moved: false, changedRanges: [], aggregateChangedIndices: [], membershipChanged: false, listChanged: false };
		}
		if (structural.length > 0) {
			// A group that would be emptied is dropped by a full run (and one that is created needs one).
			const net = new Map<GroupNode<TData>, number>();
			for (const op of structural) {
				if (op.from) net.set(op.from, (net.get(op.from) ?? 0) - 1);
				if (op.to) net.set(op.to, (net.get(op.to) ?? 0) + 1);
			}
			for (const [group, n] of net) if (group.children.length + n < 1) return null;
		}

		try {
			return this.applyValidated(touched, structural, target);
		} catch {
			return null;
		}
	}

	/** The existing group of every level a row belongs to, or null when one of them does not exist yet. */
	private resolveChain(node: RowNode<TData>): GroupNode<TData>[] | null {
		const path: GroupPathItem[] = [];
		const chain: GroupNode<TData>[] = [];
		for (let level = 0; level < this.levels; level++) {
			const def = this.groupDefs[level];
			const { key, keyString } = this.context.getGroupKey(node, def);
			path.push({ field: def.colId, key, keyString });
			const group = this.groupById.get(toGroupVisualRowId(path));
			if (!group) return null;
			chain.push(group);
		}
		return chain;
	}

	/** The groups from the outermost down to `lowest`, by level. */
	private chainOf(lowest: GroupNode<TData>): GroupNode<TData>[] {
		const chain: GroupNode<TData>[] = new Array(lowest.depth + 1);
		for (let group: GroupNode<TData> | null = lowest; group; group = this.parentOf.get(group) ?? null) chain[group.depth] = group;
		return chain;
	}

	/** A row's raw group value for a column: before the write (`old`) or now. */
	private rawKey(
		node: RowNode<TData>,
		colId: string,
		changed: Map<string, { oldValue: unknown; newValue: unknown }> | undefined,
		old: boolean
	): unknown {
		const change = old ? changed?.get(colId) : undefined;
		return change ? change.oldValue : this.context.getValue(node, colId);
	}

	/**
	 * Whether every group of `chain` carries the row's own raw key value. A fresh run names a group by its
	 * first row's value, so a row that merely shares the key string (1 vs '1') could rename it.
	 */
	private keysMatch(
		chain: GroupNode<TData>[],
		node: RowNode<TData>,
		changed: Map<string, { oldValue: unknown; newValue: unknown }> | undefined,
		old: boolean
	): boolean {
		for (let level = 0; level < this.levels; level++) {
			if (!Object.is(this.rawKey(node, this.groupDefs[level].colId, changed, old), chain[level].key)) return false;
		}
		return true;
	}

	private makeDataRow(leaf: LeafNode<TData>, group: GroupNode<TData>, posInSet: number, setSize: number): VisualRow<TData> {
		const explicitHeight = this.rowHeights[leaf.rowId];
		return (leaf.row = {
			kind: 'data',
			id: toDataVisualRowId(leaf.rowId),
			rowId: leaf.rowId,
			node: leaf.node,
			hierarchy: {
				level: group.depth + 1,
				parentId: group.id,
				hasChildren: false,
				expanded: false,
				childCount: 0,
				leafCount: 0,
				posInSet,
				setSize,
			},
			height: explicitHeight !== undefined ? explicitHeight : this.defaultRowHeight,
			selectable: true,
			editable: true,
		});
	}

	/** A data row's flat index, or undefined when it is filtered out or under a collapsed group. */
	public visualIndexOfRow(
		rowId: string,
		visualRows: readonly VisualRow<TData>[],
		visualRowIdToIndex: ReadonlyMap<string, number>
	): number | undefined {
		const entry = this.leafOf.get(rowId);
		const row = entry?.leaf.row;
		if (!entry || !row) return undefined;
		const gi = visualRowIdToIndex.get(entry.parent.id);
		const groupRow = gi === undefined ? undefined : visualRows[gi];
		if (groupRow?.kind !== 'group' || !groupRow.hierarchy.expanded) return undefined;
		const at = gi! + (visualRows[gi! + 1]?.kind === 'total' ? 1 : 0) + row.hierarchy.posInSet;
		return visualRows[at] === row ? at : undefined;
	}

	private applyValidated(
		touched: Map<GroupNode<TData>, Map<string, TouchedLeaf<TData>>>,
		structural: StructuralOp<TData>[],
		target: IncrementalTarget<TData>
	): IncrementalApplyResult | null {
		const { visualRows, visualRowIdToIndex, groupMeta } = target;
		// A leaf's current visual row, checked against the flat list at its recorded place in the group.
		const rowOf = (leaf: LeafNode<TData>, base: number): VisualRow<TData> => {
			const row = leaf.row;
			if (!row || visualRows[base + row.hierarchy.posInSet - 1] !== row) throw new Error('incremental index out of step');
			return row;
		};
		let moved = false;
		let start = Infinity;
		let end = -1;
		let changedRanges: Array<{ startIndex: number; endIndex: number }> = [];

		// 0. What happens in each lowest group.
		const work = new Map<GroupNode<TData>, GroupWork<TData>>();
		const workOf = (group: GroupNode<TData>): GroupWork<TData> => {
			let entry = work.get(group);
			if (!entry) work.set(group, (entry = { sortMovers: [], removed: [], added: [] }));
			return entry;
		};
		if (this.sortModel.length > 0) {
			for (const [group, leaves] of touched) {
				for (const item of leaves.values()) if (item.sortChanged) workOf(group).sortMovers.push(item.leaf);
			}
		}
		for (const op of structural) {
			if (op.from) workOf(op.from).removed.push(op);
			if (op.to) workOf(op.to).added.push(op);
		}

		// 1. In-group order, and the tree's membership. A group whose rows only change order rewrites just
		// the spans each moved leaf shifts (overlapping spans merged); a group that gains or loses rows
		// is rewritten whole below, in one pass over the flat list.
		const moves: Array<{ group: GroupNode<TData>; base: number; spans: Array<[number, number]> }> = [];
		const structSpans: StructSpan<TData>[] = [];
		const reordered = new Set<GroupNode<TData>>();
		for (const [group, w] of work) {
			const gi = visualRowIdToIndex.get(group.id);
			const groupRow = gi === undefined ? undefined : visualRows[gi];
			const onScreen = groupRow?.kind === 'group' && groupRow.hierarchy.expanded;
			const base = onScreen ? gi! + 1 + (visualRows[gi! + 1]?.kind === 'total' ? 1 : 0) : -1;
			const structuralGroup = w.removed.length > 0 || w.added.length > 0;
			const removing = [...w.sortMovers, ...w.removed.map((op) => op.leaf)];
			const inserting = [...w.sortMovers, ...w.added.map((op) => op.leaf)];
			const oldN = group.children.length;
			let oldPositions: number[] | null = null;
			if (onScreen) {
				oldPositions = [];
				for (const leaf of removing) oldPositions.push(rowOf(leaf, base).hierarchy.posInSet - 1);
			}
			const newPositions = this.reinsert(group.children, removing, inserting, oldPositions);
			reordered.add(group);
			if (!onScreen || !oldPositions) continue;
			if (structuralGroup) {
				structSpans.push({ group, base, oldN, work: w });
				continue;
			}
			const moving = w.sortMovers;
			const spans: Array<[number, number]> = [];
			for (let i = 0; i < moving.length; i++) {
				const from = oldPositions[i];
				const to = newPositions.get(moving[i])!;
				if (from !== to) spans.push(from < to ? [from, to] : [to, from]);
			}
			if (spans.length === 0) continue;
			spans.sort((x, y) => x[0] - y[0]);
			const merged: Array<[number, number]> = [spans[0]];
			for (let i = 1; i < spans.length; i++) {
				const last = merged[merged.length - 1];
				if (spans[i][0] <= last[1]) last[1] = Math.max(last[1], spans[i][1]);
				else merged.push(spans[i]);
			}
			moves.push({ group, base, spans: merged });
		}
		for (const op of structural) {
			if (op.to) this.leafOf.set(op.node.id, { leaf: op.leaf, parent: op.to });
			else this.leafOf.delete(op.node.id);
		}

		// Leaf counts up the chains, and the lowest groups' child counts.
		const countChanged = new Set<GroupNode<TData>>();
		if (structural.length > 0) {
			const leafDelta = new Map<GroupNode<TData>, number>();
			const bump = (lowest: GroupNode<TData>, d: number) => {
				for (let group: GroupNode<TData> | null = lowest; group; group = this.parentOf.get(group) ?? null) {
					leafDelta.set(group, (leafDelta.get(group) ?? 0) + d);
				}
			};
			for (const op of structural) {
				if (op.from) bump(op.from, -1);
				if (op.to) bump(op.to, 1);
			}
			for (const [group, d] of leafDelta) {
				if (d === 0) continue;
				group.leafCount += d;
				countChanged.add(group);
			}
			for (const [group, w] of work) {
				if (w.removed.length === 0 && w.added.length === 0) continue;
				if (group.childCount !== group.children.length) {
					group.childCount = group.children.length;
					countChanged.add(group);
				}
			}
		}

		// 2. Stats of the lowest groups. sum/avg/count/min/max move by delta; a column is recomputed
		// from the group's leaves when a delta cannot be exact (the removed value was the min/max,
		// first/last after an edit or reorder) and after as many deltas as the group has leaves (at least
		// DRIFT_RECOMPUTE_EVERY): float error from deltas stays bounded (~1e-12 relative) instead of
		// accumulating, at O(1) amortized per delta however large the group.
		const dirty = new Set<GroupNode<TData>>();
		const statGroups = new Set<GroupNode<TData>>(touched.keys());
		for (const [group, w] of work) if (w.removed.length > 0 || w.added.length > 0) statGroups.add(group);
		for (const group of statGroups) {
			dirty.add(group);
			const cached = this.statsCache.get(group);
			if (!cached) continue;
			const leaves = touched.get(group);
			const w = work.get(group);
			for (const colId of this.statCols) {
				const stats = cached.get(colId);
				if (!stats) continue;
				let recompute = this.firstLastCols.has(colId) && reordered.has(group);
				let deltas = 0;
				const trackMinMax = this.minMaxCols.has(colId);
				if (leaves) {
					for (const item of leaves.values()) {
						for (const change of item.changes) {
							if (change.colId !== colId) continue;
							deltas++;
							if (this.firstLastCols.has(colId)) recompute = true;
							const { oldValue, newValue } = change;
							if (typeof oldValue === 'number' && !isNaN(oldValue)) {
								stats.numericCount--;
								stats.sum -= oldValue;
								if (trackMinMax && (oldValue === stats.min || oldValue === stats.max)) recompute = true;
							}
							if (typeof newValue === 'number' && !isNaN(newValue)) {
								stats.numericCount++;
								stats.sum += newValue;
								if (newValue < stats.min) stats.min = newValue;
								if (newValue > stats.max) stats.max = newValue;
							}
						}
					}
				}
				if (w) {
					for (const op of w.removed) {
						deltas++;
						const value = this.oldValueOf(op, colId);
						stats.totalCount--;
						if (typeof value === 'number' && !isNaN(value)) {
							stats.numericCount--;
							stats.sum -= value;
							if (trackMinMax && (value === stats.min || value === stats.max)) recompute = true;
						}
						if (this.firstLastCols.has(colId)) recompute = true;
					}
					for (const op of w.added) {
						deltas++;
						const value = this.context.getValue(op.node, colId);
						stats.totalCount++;
						if (typeof value === 'number' && !isNaN(value)) {
							stats.numericCount++;
							stats.sum += value;
							if (value < stats.min) stats.min = value;
							if (value > stats.max) stats.max = value;
						}
						if (this.firstLastCols.has(colId)) recompute = true;
					}
				}
				if (deltas > 0) {
					const key = colId;
					const counts = this.deltaCounts.get(group) ?? new Map<string, number>();
					this.deltaCounts.set(group, counts);
					const total = (counts.get(key) ?? 0) + deltas;
					if (total >= Math.max(DRIFT_RECOMPUTE_EVERY, group.leafCount)) recompute = true;
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
		for (const group of statGroups) {
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
		for (const op of structural) {
			for (const colId of this.distinctCols) {
				if (op.from) {
					const value = this.oldValueOf(op, colId);
					for (let node: GroupNode<TData> | null = op.from; node; node = this.parentOf.get(node) ?? null)
						this.addDistinct(node, colId, value, -1);
					this.addDistinct(GRAND, colId, value, -1);
				}
				if (op.to) {
					const value = this.context.getValue(op.node, colId);
					for (let node: GroupNode<TData> | null = op.to; node; node = this.parentOf.get(node) ?? null)
						this.addDistinct(node, colId, value, 1);
					this.addDistinct(GRAND, colId, value, 1);
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

		// 6. The flat list: rewrite each moved span. A span holds the same rows before and after (only
		// their order changed), so its rows are found among the span's old rows.
		for (const { group, base, spans } of moves) {
			for (const [lo, hi] of spans) {
				// Every leaf of the span is checked before any row is written (positions are the old ones).
				const rows: VisualRow<TData>[] = [];
				for (let i = lo; i <= hi; i++) rows.push(rowOf(group.children[i] as LeafNode<TData>, base));
				let changed = false;
				for (let i = lo; i <= hi; i++) {
					const row = rows[i - lo];
					const index = base + i;
					// Rows are this model's own objects: posInSet follows the row's new place in the group.
					(row.hierarchy as { posInSet: number }).posInSet = i + 1;
					if (visualRows[index] === row) continue;
					changed = true;
					visualRows[index] = row;
				}
				if (!changed) continue;
				moved = true;
				changedRanges.push({ startIndex: base + lo, endIndex: base + hi });
			}
		}

		// 6b. Groups that gained or lost rows: each is rewritten whole, in one pass over the list after
		// the first of them, with the index maps, group meta and sticky meta following the shifts.
		let listChanged = false;
		if (structSpans.length > 0) {
			listChanged = true;
			structSpans.sort((a, b) => a.base - b.base);
			const built = structSpans.map(({ group, base, oldN, work: w }) => {
				if (visualRows[base + oldN - 1]?.kind !== 'data' || visualRows[base + oldN]?.kind === 'data')
					throw new Error('incremental index out of step');
				const added = new Set<RowTreeNode<TData>>(w.added.map((op) => op.leaf));
				const size = group.children.length;
				const rows: VisualRow<TData>[] = new Array(size);
				for (let i = 0; i < size; i++) {
					const leaf = group.children[i] as LeafNode<TData>;
					let row: VisualRow<TData> | undefined;
					if (added.has(leaf)) row = this.makeDataRow(leaf, group, i + 1, size);
					else {
						row = rowOf(leaf, base);
						(row.hierarchy as { posInSet: number; setSize: number }).posInSet = i + 1;
						(row.hierarchy as { posInSet: number; setSize: number }).setSize = size;
					}
					rows[i] = row;
				}
				return rows;
			});
			let totalDelta = 0;
			for (let k = 0; k < structSpans.length; k++) totalDelta += built[k].length - structSpans[k].oldN;
			const first = structSpans[0].base;
			const lastSpan = structSpans[structSpans.length - 1];
			// With no net length change the rows after the last span keep their places.
			const oldTail = visualRows.slice(first, totalDelta === 0 ? lastSpan.base + lastSpan.oldN : undefined);
			let out = first;
			let src = 0;
			const copyUntil = (stop: number) => {
				for (; src < stop; src++, out++) {
					const row = oldTail[src];
					visualRows[out] = row;
					if (out !== first + src && row.kind !== 'data') visualRowIdToIndex.set(row.id, out);
				}
			};
			const infos: SpanInfo[] = [];
			for (let k = 0; k < structSpans.length; k++) {
				const span = structSpans[k];
				copyUntil(span.base - first);
				const newStart = out;
				for (const row of built[k]) {
					visualRows[out] = row;
					out++;
				}
				src += span.oldN;
				infos.push({ oldStart: span.base, delta: built[k].length - span.oldN, newStart, newEnd: out - 1 });
			}
			copyUntil(oldTail.length);
			if (totalDelta !== 0) visualRows.length = out;
			this.patchMeta(target, infos);
			// Moved spans from step 6 were recorded in the old coordinates.
			const shift = makeShift(infos);
			changedRanges = changedRanges.map((r) => ({ startIndex: shift(r.startIndex), endIndex: shift(r.endIndex) }));
			for (const info of infos) changedRanges.push({ startIndex: info.newStart, endIndex: info.newEnd });
			changedRanges.sort((a, b) => a.startIndex - b.startIndex);
			// Rows between the spans (and after the last) moved too: one range from the first change on.
			const lastEnd = Math.max(...changedRanges.map((r) => r.endIndex));
			changedRanges = [{ startIndex: changedRanges[0].startIndex, endIndex: totalDelta === 0 ? lastEnd : Math.max(lastEnd, out - 1) }];
		}
		if (changedRanges.length > 0) {
			moved = true;
			for (const r of changedRanges) {
				start = Math.min(start, r.startIndex);
				end = Math.max(end, r.endIndex);
			}
		}

		// 7. Group and total rows with new aggregates, and group rows with new counts.
		const aggregateIndices: number[] = [];
		const replaceAggregates = (index: number | undefined, aggregates: Record<string, unknown>): void => {
			if (index === undefined) return;
			const row = visualRows[index];
			if (row.kind !== 'group' && row.kind !== 'total') return;
			visualRows[index] = { ...row, aggregates };
			aggregateIndices.push(index);
		};
		const replaced = new Set<GroupNode<TData>>();
		for (const group of changedGroups) {
			replaced.add(group);
			const index = visualRowIdToIndex.get(group.id);
			const row = index === undefined ? undefined : visualRows[index];
			if (index !== undefined && row?.kind === 'group') {
				visualRows[index] = {
					...row,
					aggregates: group.aggregates,
					hierarchy: countChanged.has(group)
						? { ...row.hierarchy, leafCount: group.leafCount, childCount: group.childCount }
						: row.hierarchy,
				};
				aggregateIndices.push(index);
			}
			const meta = groupMeta.get(group.id);
			if (meta && index !== undefined) {
				meta.aggregates = group.aggregates;
				if (countChanged.has(group)) {
					meta.leafCount = group.leafCount;
					meta.childCount = group.childCount;
				}
			}
			replaceAggregates(visualRowIdToIndex.get(toTotalVisualRowId(group.id)), group.aggregates);
		}
		for (const group of countChanged) {
			if (replaced.has(group)) continue;
			const index = visualRowIdToIndex.get(group.id);
			const row = index === undefined ? undefined : visualRows[index];
			if (index !== undefined && row?.kind === 'group') {
				visualRows[index] = { ...row, hierarchy: { ...row.hierarchy, leafCount: group.leafCount, childCount: group.childCount } };
				aggregateIndices.push(index);
			}
			const meta = groupMeta.get(group.id);
			if (meta) {
				meta.leafCount = group.leafCount;
				meta.childCount = group.childCount;
			}
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
			membershipChanged: structural.length > 0,
			listChanged,
		};
	}

	/** A row's value of `colId` before the write that is being absorbed. */
	private oldValueOf(op: StructuralOp<TData>, colId: string): unknown {
		const change = op.changed?.get(colId);
		return change ? change.oldValue : this.context.getValue(op.node, colId);
	}

	/**
	 * After whole group spans were rewritten (`spans`, ascending, in old coordinates): moves the group
	 * meta and sticky meta to the new indices. A position outside every span shifts by the length change
	 * of the spans before it; a group that contains a span re-reads its first and last data row.
	 */
	private patchMeta(target: IncrementalTarget<TData>, spans: SpanInfo[]): void {
		const { groupMeta, groupMetaByVisualIndex, stickyGroupMeta, visualRows } = target;
		const shift = makeShift(spans);
		const countAtOrBefore = (x: number): number => {
			let lo = 0;
			let hi = spans.length;
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				if (spans[mid].oldStart <= x) lo = mid + 1;
				else hi = mid;
			}
			return lo;
		};
		for (const meta of groupMeta.values()) {
			const oldIndex = meta.visualIndex;
			const oldLast = meta.lastChildIndex;
			meta.visualIndex = shift(oldIndex);
			if (!meta.expanded) continue;
			meta.firstChildIndex = meta.visualIndex + 1;
			meta.lastChildIndex = shift(oldLast);
			if (countAtOrBefore(oldLast) > countAtOrBefore(oldIndex)) {
				let first = -1;
				for (let i = meta.firstChildIndex; i <= meta.lastChildIndex; i++) {
					if (visualRows[i].kind === 'data') {
						first = i;
						break;
					}
				}
				let last = -1;
				if (first !== -1) {
					for (let i = meta.lastChildIndex; i >= first; i--) {
						if (visualRows[i].kind === 'data') {
							last = i;
							break;
						}
					}
				}
				meta.firstLeafIndex = first;
				meta.lastLeafIndex = last;
			} else {
				if (meta.firstLeafIndex !== -1) meta.firstLeafIndex = shift(meta.firstLeafIndex);
				if (meta.lastLeafIndex !== -1) meta.lastLeafIndex = shift(meta.lastLeafIndex);
			}
		}
		groupMetaByVisualIndex.clear();
		for (const meta of groupMeta.values()) groupMetaByVisualIndex.set(meta.visualIndex, meta);
		// Keys keep their (row) order: the shift is monotonic.
		const entries = [...stickyGroupMeta];
		stickyGroupMeta.clear();
		for (const [index, last] of entries) stickyGroupMeta.set(shift(index), shift(last));
	}

	// ── ordering ────────────────────────────────────────────────────────────────

	/**
	 * Removes `leaves` from the sorted `children` and puts each at its sorted place; returns their
	 * final positions. A few moved leaves are spliced in by binary search; many are sorted among
	 * themselves and merged with the rest in one pass (O(n + m log m) rather than a splice per leaf).
	 */
	private reinsert(
		children: RowTreeNode<TData>[],
		remove: LeafNode<TData>[],
		insert: LeafNode<TData>[],
		oldPositions: number[] | null
	): Map<LeafNode<TData>, number> {
		// Fresh keys for the inserted leaves (their sort values may have changed, or they are new here).
		const entries = insert.map((leaf) => ({ leaf, ...this.sortEntryOf(leaf.node, true) }));
		// Splices are native memmoves (cheap for a few leaves); a merge reads every row's cached key.
		// k splices move ~k·n elements, a merge compares ~n cached keys: the break-even k is about
		// constant, whatever the group size (an n/16 term let 10k-leaf groups splice hundreds of times).
		if (Math.max(remove.length, insert.length) > MERGE_REINSERT_MIN) return this.mergeReinsert(children, remove, entries);
		if (oldPositions && oldPositions.every((at, i) => children[at] === remove[i])) {
			// Known positions (the group is on screen): splice them out, highest first.
			for (const at of [...oldPositions].sort((a, b) => b - a)) children.splice(at, 1);
		} else if (remove.length > 0) {
			const leaving = new Set<RowTreeNode<TData>>(remove);
			let kept = 0;
			for (const child of children) if (!leaving.has(child)) children[kept++] = child;
			children.length = kept;
		}
		// In sorted order each leaf lands after the previous one: placed leaves never shift, and each
		// search starts past the last insert.
		entries.sort((x, y) => this.compareEntries(x.keys, x.source, y.keys, y.source));
		const positions = new Map<LeafNode<TData>, number>();
		let from = 0;
		for (const { leaf, keys, source } of entries) {
			let lo = from;
			let hi = children.length;
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				if (this.compare(keys, source, (children[mid] as LeafNode<TData>).node) < 0) hi = mid;
				else lo = mid + 1;
			}
			children.splice(lo, 0, leaf);
			positions.set(leaf, lo);
			from = lo + 1;
		}
		return positions;
	}

	private mergeReinsert(
		children: RowTreeNode<TData>[],
		remove: LeafNode<TData>[],
		moving: Array<{ leaf: LeafNode<TData>; keys: ReturnType<typeof toSortKey>[]; source: number }>
	): Map<LeafNode<TData>, number> {
		const leaving = new Set<RowTreeNode<TData>>(remove);
		const rest: RowTreeNode<TData>[] = [];
		for (const child of children) if (!leaving.has(child)) rest.push(child);
		moving.sort((a, b) => this.compareEntries(a.keys, a.source, b.keys, b.source));
		// Each moved leaf binary-searches its place among the staying ones (same rule as a binary insert:
		// after every leaf it does not sort before; places ascend with the sorted movers), then one plain
		// copy writes the group: k log n comparisons instead of one per staying leaf.
		const places: number[] = new Array(moving.length);
		let from = 0;
		for (let m = 0; m < moving.length; m++) {
			const { keys, source } = moving[m];
			let lo = from;
			let hi = rest.length;
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				if (this.compare(keys, source, (rest[mid] as LeafNode<TData>).node) < 0) hi = mid;
				else lo = mid + 1;
			}
			places[m] = from = lo;
		}
		const positions = new Map<LeafNode<TData>, number>();
		let r = 0;
		let out = 0;
		for (let m = 0; m < moving.length; m++) {
			while (r < places[m]) children[out++] = rest[r++];
			const leaf = moving[m].leaf;
			children[out] = leaf;
			positions.set(leaf, out++);
		}
		while (r < rest.length) children[out++] = rest[r++];
		children.length = out;
		return positions;
	}

	private compareEntries(aKeys: ReturnType<typeof toSortKey>[], aSource: number, bKeys: ReturnType<typeof toSortKey>[], bSource: number): number {
		for (let i = 0; i < this.sortModel.length; i++) {
			const c = compareSortKeys(aKeys[i], bKeys[i]);
			if (c !== 0) {
				const signed = this.sortModel[i].sort === 'desc' ? -c : c;
				return Number.isNaN(signed) ? aSource - bSource : signed;
			}
		}
		return aSource - bSource;
	}

	private compare(keys: ReturnType<typeof toSortKey>[], source: number, other: RowNode<TData>): number {
		const entry = this.sortEntryOf(other, false);
		for (let i = 0; i < this.sortModel.length; i++) {
			const c = compareSortKeys(keys[i], entry.keys[i]);
			if (c !== 0) {
				const signed = this.sortModel[i].sort === 'desc' ? -c : c;
				return Number.isNaN(signed) ? source - entry.source : signed;
			}
		}
		return source - entry.source;
	}

	/**
	 * A row's sort keys and source position, cached per row node: a binary insert compares against
	 * ~log(n) rows per moved row, so reading their values each time dominated live feeds. A row's
	 * entry is refreshed when its own sort value changes (`refresh`); others keep theirs.
	 */
	private sortEntryOf(node: RowNode<TData>, refresh: boolean): { keys: ReturnType<typeof toSortKey>[]; source: number } {
		let entry = refresh ? undefined : this.sortEntries.get(node);
		if (!entry) {
			entry = {
				keys: this.sortModel.map((s) => toSortKey(this.context.getValue(node, s.colId))),
				source: this.getSourceIndex(node.id) ?? 0,
			};
			this.sortEntries.set(node, entry);
		}
		return entry;
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

	private addDistinct(owner: GroupNode<TData> | typeof GRAND, colId: string, value: unknown, sign: 1 | -1): void {
		const counts = this.distinctCache.get(owner)?.get(colId);
		if (!counts) return;
		const had = counts.get(value) ?? 0;
		if (sign > 0) counts.set(value, had + 1);
		else if (had === 0) throw new Error('incremental index out of step');
		else if (had === 1) counts.delete(value);
		else counts.set(value, had - 1);
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
