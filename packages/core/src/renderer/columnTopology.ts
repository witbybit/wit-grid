import type { ColumnInstanceId, CompiledGridPlan, InternalColumnDef } from '../columnDef.js';

// ── Public interfaces ──────────────────────────────────────────────────────────

/**
 * Compiled placement for a single column: its lane, lane-relative offset, and
 * absolute content position.  Consumers must prefer `laneOffset` for positioning
 * elements inside their lane container, and `absoluteLeft` only when content-space
 * coordinates are required (e.g. body rows that place cells in the full-width row).
 */
export interface ColumnPlacement {
	/** Renderer/topology lifecycle identity — see ColumnInstanceId. Stable across pin/unpin/reorder
	 *  of an equivalent column; changes only when the column at this field is semantically replaced. */
	readonly columnId: ColumnInstanceId;
	/** Logical field name — for consumers that need the display/DOM name (headers, floating filters). */
	readonly field: string;
	readonly lane: 'left' | 'center' | 'right';
	readonly laneIndex: number;
	readonly absoluteIndex: number;
	/** Absolute content-space left (colLefts[c]). */
	readonly absoluteLeft: number;
	/** Lane-relative left offset. Left lane: same as absoluteLeft. Center: absoluteLeft - pinLeftWidth. Right: absoluteLeft - pinRightBaseLeft. */
	readonly laneOffset: number;
	readonly width: number;
}

/**
 * One group-header span that lies entirely within a single lane. Groups crossing
 * lane boundaries are split into one segment per lane by the compiler.
 */
export interface GroupHeaderSegment {
	/** Stable identity: "grp:{depth}:{lane}:{firstColumnId}:{lastColumnId}" — lane-aware so split segments get distinct keys. */
	readonly id: string;
	readonly label: string;
	readonly depth: number;
	readonly lane: 'left' | 'center' | 'right';
	readonly firstColumnId: string;
	readonly lastColumnId: string;
	/** Lane-relative left offset. */
	readonly laneOffset: number;
	readonly width: number;
	readonly colStart: number;
	readonly colEnd: number;
}

/**
 * The single authoritative column topology consumed by headers, body cells,
 * floating filters, and column overlays. One version describes lane membership,
 * order, offsets, and widths for every column-oriented renderer.
 */
export interface CompiledColumnTopology {
	/** Same as CompiledGridPlan.version — increments on every topology-relevant change. */
	readonly version: number;
	/** All placements in display order. */
	readonly placements: readonly ColumnPlacement[];
	/** O(1) lookup by column instance id. */
	readonly byColumnId: ReadonlyMap<ColumnInstanceId, ColumnPlacement>;
	readonly left: readonly ColumnPlacement[];
	readonly center: readonly ColumnPlacement[];
	readonly right: readonly ColumnPlacement[];
	/** Group header segments, outer array indexed by depth (0 = shallowest). */
	readonly groupSegments: ReadonlyArray<readonly GroupHeaderSegment[]>;
	readonly pinLeftWidth: number;
	readonly pinRightWidth: number;
	readonly pinRightBaseLeft: number;
	readonly totalContentWidth: number;
}

/** Describes how topology changed between two versions. */
export interface ColumnTopologyDiff {
	readonly prevVersion: number;
	readonly nextVersion: number;
	/** Columns present in both versions (may have changed lane or offset). */
	readonly retained: ReadonlyArray<{ readonly prev: ColumnPlacement; readonly next: ColumnPlacement }>;
	/** Columns that changed lane (a subset of retained). */
	readonly relocated: ReadonlyArray<{ readonly prev: ColumnPlacement; readonly next: ColumnPlacement }>;
	/** Columns added in the next topology. */
	readonly entered: readonly ColumnPlacement[];
	/** Columns removed from the next topology. */
	readonly exited: readonly ColumnPlacement[];
}

// ── Compiler ──────────────────────────────────────────────────────────────────

function normalizeHeaderGroups(headerGroup: string | string[] | undefined): string[] {
	if (!headerGroup) return [];
	return Array.isArray(headerGroup) ? headerGroup : [headerGroup];
}

function buildGroupSegments<TRowData>(
	columns: readonly InternalColumnDef<TRowData>[],
	placements: readonly ColumnPlacement[],
	colLefts: ArrayLike<number>,
	totalWidth: number
): ReadonlyArray<readonly GroupHeaderSegment[]> {
	const colCount = columns.length;
	if (colCount === 0) return [];

	let maxDepth = 0;
	for (let c = 0; c < colCount; c++) {
		const depth = normalizeHeaderGroups(columns[c].headerGroup).length;
		if (depth > maxDepth) maxDepth = depth;
	}
	if (maxDepth === 0) return [];

	const result: GroupHeaderSegment[][] = [];

	for (let d = 0; d < maxDepth; d++) {
		const segments: GroupHeaderSegment[] = [];
		let i = 0;

		while (i < colCount) {
			const groups = normalizeHeaderGroups(columns[i].headerGroup);
			const groupName = groups[d];
			if (!groupName) {
				i++;
				continue;
			}

			const lane = placements[i].lane;

			// Extend the span as long as: same group name, same lane, column has a group at this depth.
			let j = i + 1;
			while (j < colCount) {
				const nextGroups = normalizeHeaderGroups(columns[j].headerGroup);
				if (nextGroups[d] !== groupName || placements[j].lane !== lane) break;
				j++;
			}

			const absoluteLeft = colLefts[i] ?? 0;
			const rightEdge = j < colCount ? (colLefts[j] ?? totalWidth) : totalWidth;
			const width = rightEdge - absoluteLeft;

			segments.push({
				id: `grp:${d}:${lane}:${columns[i].field}:${columns[j - 1].field}`,
				label: groupName,
				depth: d,
				lane,
				firstColumnId: columns[i].field,
				lastColumnId: columns[j - 1].field,
				laneOffset: placements[i].laneOffset,
				width,
				colStart: i,
				colEnd: j - 1,
			});

			i = j;
		}

		result.push(segments);
	}

	return result;
}

/**
 * Pure compiler: produces the authoritative column topology from the compiled grid plan.
 * All column-oriented renderers must consume this topology rather than independently
 * deriving lane membership from pin counts.
 */
export function compileColumnTopology<TRowData>(plan: CompiledGridPlan<TRowData>): CompiledColumnTopology {
	const { displayedColumns, colLefts, colWidths, pinLeftCount, pinRightStart, pinLeftWidth, pinRightWidth, pinRightBaseLeft, totalWidth, version } =
		plan;

	const placements: ColumnPlacement[] = [];
	const byColumnId = new Map<ColumnInstanceId, ColumnPlacement>();
	const leftPlacements: ColumnPlacement[] = [];
	const centerPlacements: ColumnPlacement[] = [];
	const rightPlacements: ColumnPlacement[] = [];

	let leftIdx = 0;
	let centerIdx = 0;
	let rightIdx = 0;

	for (let i = 0; i < displayedColumns.length; i++) {
		const col = displayedColumns[i];
		const absoluteLeft = (colLefts[i] as number | undefined) ?? 0;
		const width = (colWidths[i] as number | undefined) ?? 0;

		let lane: 'left' | 'center' | 'right';
		let laneIndex: number;
		let laneOffset: number;

		if (i < pinLeftCount) {
			lane = 'left';
			laneIndex = leftIdx++;
			laneOffset = absoluteLeft; // left lane baseLeft = 0
		} else if (i >= pinRightStart) {
			lane = 'right';
			laneIndex = rightIdx++;
			laneOffset = absoluteLeft - pinRightBaseLeft;
		} else {
			lane = 'center';
			laneIndex = centerIdx++;
			laneOffset = absoluteLeft - pinLeftWidth;
		}

		const placement: ColumnPlacement = {
			columnId: col.instanceId,
			field: col.field,
			lane,
			laneIndex,
			absoluteIndex: i,
			absoluteLeft,
			laneOffset,
			width,
		};

		placements.push(placement);
		byColumnId.set(col.instanceId, placement);
		if (lane === 'left') leftPlacements.push(placement);
		else if (lane === 'center') centerPlacements.push(placement);
		else rightPlacements.push(placement);
	}

	const groupSegments = buildGroupSegments(displayedColumns, placements, colLefts, totalWidth);

	return {
		version,
		placements,
		byColumnId,
		left: leftPlacements,
		center: centerPlacements,
		right: rightPlacements,
		groupSegments,
		pinLeftWidth,
		pinRightWidth,
		pinRightBaseLeft,
		totalContentWidth: totalWidth,
	};
}

// Compiled plans are immutable per version (ColumnModel builds a new object whenever the
// version bumps), so a weak cache keyed by the plan object shares one topology between every
// per-frame consumer without pinning retired plans in memory. The version check guards
// against a caller mutating a plan object in place.
const memoizedTopologies = new WeakMap<object, CompiledColumnTopology>();

/**
 * Memoized {@link compileColumnTopology}: returns the same topology object for the same compiled
 * plan, recompiling only for a new plan object or version. Hot paths (layout plan per scroll
 * frame, post-scroll repair per idle chunk) must use this instead of the O(columns) compiler.
 */
export function getMemoizedColumnTopology<TRowData>(plan: CompiledGridPlan<TRowData>): CompiledColumnTopology {
	const cached = memoizedTopologies.get(plan);
	if (cached && cached.version === plan.version) return cached;
	const topology = compileColumnTopology(plan);
	memoizedTopologies.set(plan, topology);
	return topology;
}

// ── Diff (WS8) ────────────────────────────────────────────────────────────────

/**
 * Computes the difference between two topology versions.
 * Use this to drive incremental reconciliation: relocated views are retained/moved,
 * entered views are created, exited views are destroyed.
 */
export function diffColumnTopologies(prev: CompiledColumnTopology, next: CompiledColumnTopology): ColumnTopologyDiff {
	const retained: { prev: ColumnPlacement; next: ColumnPlacement }[] = [];
	const relocated: { prev: ColumnPlacement; next: ColumnPlacement }[] = [];
	const entered: ColumnPlacement[] = [];
	const exited: ColumnPlacement[] = [];

	for (const nextPlacement of next.placements) {
		const prevPlacement = prev.byColumnId.get(nextPlacement.columnId);
		if (!prevPlacement) {
			entered.push(nextPlacement);
		} else {
			retained.push({ prev: prevPlacement, next: nextPlacement });
			if (prevPlacement.lane !== nextPlacement.lane) {
				relocated.push({ prev: prevPlacement, next: nextPlacement });
			}
		}
	}

	for (const prevPlacement of prev.placements) {
		if (!next.byColumnId.has(prevPlacement.columnId)) {
			exited.push(prevPlacement);
		}
	}

	return { prevVersion: prev.version, nextVersion: next.version, retained, relocated, entered, exited };
}

// ── Lane-segmented window delta ──────────────────────────────────────────────────

/** Column field lists, segmented by lane, plus cross-lane moves — for scroll/resize-driven reconciliation. */
export interface ColumnWindowDelta {
	readonly enteredCenterColumns: readonly ColumnInstanceId[];
	readonly exitedCenterColumns: readonly ColumnInstanceId[];
	readonly stayedCenterColumns: readonly ColumnInstanceId[];
	readonly enteredPinnedLeftColumns: readonly ColumnInstanceId[];
	readonly exitedPinnedLeftColumns: readonly ColumnInstanceId[];
	readonly enteredPinnedRightColumns: readonly ColumnInstanceId[];
	readonly exitedPinnedRightColumns: readonly ColumnInstanceId[];
	readonly laneMoves: ReadonlyArray<{
		readonly columnInstanceId: ColumnInstanceId;
		readonly from: 'left' | 'center' | 'right';
		readonly to: 'left' | 'center' | 'right';
	}>;
	readonly structural: boolean;
}

/**
 * Lane-segmented view of `diffColumnTopologies`, for callers that reconcile each lane
 * independently (the normal horizontal-scroll case: only the center window shifts, pinned
 * lanes are untouched). Column pin/unpin/reorder naturally shows up here as `laneMoves` —
 * callers that need to handle that structurally are free to fall back to full reconciliation
 * for those events (see `reconcileTopology` vs `reconcileCellTopologyForScroll` in
 * `rowCellBindingLanes.ts`); this helper does not make that choice for them.
 */
export function computeColumnWindowDelta(prev: CompiledColumnTopology, next: CompiledColumnTopology): ColumnWindowDelta {
	const diff = diffColumnTopologies(prev, next);

	const enteredCenterColumns: ColumnInstanceId[] = [];
	const enteredPinnedLeftColumns: ColumnInstanceId[] = [];
	const enteredPinnedRightColumns: ColumnInstanceId[] = [];
	for (const placement of diff.entered) {
		if (placement.lane === 'left') enteredPinnedLeftColumns.push(placement.columnId);
		else if (placement.lane === 'right') enteredPinnedRightColumns.push(placement.columnId);
		else enteredCenterColumns.push(placement.columnId);
	}

	const exitedCenterColumns: ColumnInstanceId[] = [];
	const exitedPinnedLeftColumns: ColumnInstanceId[] = [];
	const exitedPinnedRightColumns: ColumnInstanceId[] = [];
	for (const placement of diff.exited) {
		if (placement.lane === 'left') exitedPinnedLeftColumns.push(placement.columnId);
		else if (placement.lane === 'right') exitedPinnedRightColumns.push(placement.columnId);
		else exitedCenterColumns.push(placement.columnId);
	}

	const stayedCenterColumns: ColumnInstanceId[] = [];
	const relocatedIds = new Set(diff.relocated.map((r) => r.next.columnId));
	for (const { next: nextPlacement } of diff.retained) {
		if (nextPlacement.lane === 'center' && !relocatedIds.has(nextPlacement.columnId)) {
			stayedCenterColumns.push(nextPlacement.columnId);
		}
	}

	const laneMoves = diff.relocated.map((r) => ({ columnInstanceId: r.next.columnId, from: r.prev.lane, to: r.next.lane }));

	return {
		enteredCenterColumns,
		exitedCenterColumns,
		stayedCenterColumns,
		enteredPinnedLeftColumns,
		exitedPinnedLeftColumns,
		enteredPinnedRightColumns,
		exitedPinnedRightColumns,
		laneMoves,
		structural: true,
	};
}

export function computeRoutineColumnWindowDelta(
	prevRenderedCenterColumns: readonly ColumnInstanceId[],
	nextRenderedCenterColumns: readonly ColumnInstanceId[]
): ColumnWindowDelta {
	const prevSet = new Set(prevRenderedCenterColumns);
	const nextSet = new Set(nextRenderedCenterColumns);

	const enteredCenterColumns = nextRenderedCenterColumns.filter((id) => !prevSet.has(id));
	const exitedCenterColumns = prevRenderedCenterColumns.filter((id) => !nextSet.has(id));
	const stayedCenterColumns = nextRenderedCenterColumns.filter((id) => prevSet.has(id));

	return {
		enteredCenterColumns,
		exitedCenterColumns,
		stayedCenterColumns,
		enteredPinnedLeftColumns: [],
		exitedPinnedLeftColumns: [],
		enteredPinnedRightColumns: [],
		exitedPinnedRightColumns: [],
		laneMoves: [],
		structural: false,
	};
}
