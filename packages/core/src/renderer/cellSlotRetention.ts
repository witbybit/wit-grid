import { GridMetric, type GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import type { ColumnInstanceId } from '../columnDef.js';
import type { CellSlot } from './cellSlot.js';
import type { RowSlot } from './rowSlot.js';

/**
 * Bounds how many cell slots a single row slot's `cellsByColumnInstanceId` map may retain once
 * columns scroll out of the visible+approach-band window. Without this, `reconcileCellTopologyForScroll`
 * (which deliberately never evicts, to keep the scroll hot path free of teardown work) lets the
 * map grow to one entry per distinct column ever visited — unbounded on a wide grid.
 *
 * Not exposed publicly — internal tuning only.
 */
export const CELL_SLOT_RETENTION_CONFIG = {
	/** Safety ceiling folded into the total budget alongside the LRU tail below. Chosen well above
	 *  any realistic visible+approach-band window so it never binds in practice — it exists so a
	 *  pathologically large approach-band configuration can't silently defeat the LRU bound. */
	maxRetainedCenterCellsPerRowSlot: 64,
	/** How many additional exited-column cell slots may be kept warm beyond the always-kept set
	 *  (visible + approach-band + pinned + focused), oldest-touched evicted first. */
	maxRecentlyExitedColumnsPerRowSlot: 32,
	/** Among equally-old eviction candidates, release portal-mode cells (heavier: portal host,
	 *  possible React-owned content) before plain text/empty cells. */
	preferEvictPortalCells: true,
};

/** Monotonic recency counter shared by all row slots — a larger stamp means touched more recently. */
let retentionTouchCounter = 0;

export interface CellSlotRetentionResult {
	retainedAfter: number;
	evicted: number;
}

/**
 * Enforces the retention policy on one row slot's `cellsByColumnInstanceId` map.
 *
 * `keepInstanceIds` must contain every column instance this frame's render window requires to stay
 * correct right now — visible columns, horizontal approach-band columns, pinned-left/right
 * columns, and the currently focused/edited column. Every entry in `keepInstanceIds` is guaranteed
 * to survive this call unconditionally; eviction only ever touches columns outside that set.
 *
 * Deterministic and safe to call every scroll frame: it never removes a column that is still
 * needed, and evicted cells are plain CellSlot objects with no snapshot/version references left
 * dangling — recreating them on re-entry produces a fresh cell with no residual identity.
 */
export function applyCellSlotRetentionPolicy<TRowData>(
	slot: RowSlot<TRowData>,
	keepInstanceIds: ReadonlySet<ColumnInstanceId>,
	releaseFn: (cell: CellSlot<TRowData>) => void,
	instrumentation?: GridInstrumentation
): CellSlotRetentionResult {
	const cells = slot.cellsByColumnInstanceId;

	// Touch every kept instance by stamping it with an increasing recency counter (in keep-set
	// iteration order). This reproduces exactly the LRU order the previous Map delete+set re-insertion
	// produced, but as a field write per kept cell instead of two Map mutations; the ordering is only
	// materialized below, and only when the map is actually over budget.
	for (const instanceId of keepInstanceIds) {
		const cell = cells.get(instanceId);
		if (cell) cell.retentionStamp = ++retentionTouchCounter;
	}

	const totalBudget =
		Math.max(CELL_SLOT_RETENTION_CONFIG.maxRetainedCenterCellsPerRowSlot, keepInstanceIds.size) +
		CELL_SLOT_RETENTION_CONFIG.maxRecentlyExitedColumnsPerRowSlot;

	let evicted = 0;
	if (cells.size > totalBudget) {
		const overBudget = cells.size - totalBudget;
		const evictable: ColumnInstanceId[] = [];
		for (const instanceId of cells.keys()) {
			if (!keepInstanceIds.has(instanceId)) evictable.push(instanceId);
		}
		// Oldest-touched first. Never-touched cells keep stamp 0 and their map (insertion) order,
		// matching the prior behaviour where untouched entries aged toward the front; Array sort is
		// stable, so equal stamps keep map order.
		evictable.sort((a, b) => cells.get(a)!.retentionStamp - cells.get(b)!.retentionStamp);

		const ordered = CELL_SLOT_RETENTION_CONFIG.preferEvictPortalCells ? stablePartitionPortalFirst(evictable, cells) : evictable;

		for (let i = 0; i < overBudget && i < ordered.length; i++) {
			const instanceId = ordered[i];
			const cell = cells.get(instanceId);
			if (!cell) continue;
			releaseFn(cell);
			if (cell.element.parentNode) cell.element.remove();
			cells.delete(instanceId);
			instrumentation?.increment(GridMetric.CELL_VIEW_DESTROYED);
			evicted++;
		}
	}

	return { retainedAfter: cells.size, evicted };
}

/** Stamps a newly created cell slot as the most recently touched — the equivalent of its Map
 *  insertion position under the previous delete+set LRU ordering. */
export function stampNewCellSlotForRetention<TRowData>(cell: CellSlot<TRowData>): void {
	cell.retentionStamp = ++retentionTouchCounter;
}

/** Stable partition: portal-mode cells first (in their original relative order), then the rest. */

function stablePartitionPortalFirst<TRowData>(
	instanceIds: ColumnInstanceId[],
	cells: ReadonlyMap<ColumnInstanceId, CellSlot<TRowData>>
): ColumnInstanceId[] {
	const portalIds: ColumnInstanceId[] = [];
	const otherIds: ColumnInstanceId[] = [];
	for (const instanceId of instanceIds) {
		const cell = cells.get(instanceId);
		if (cell?.lastContentMode === 'portal') portalIds.push(instanceId);
		else otherIds.push(instanceId);
	}
	return [...portalIds, ...otherIds];
}
