import type { GridEngine } from '../engine/GridEngine.js';
import type { CellRendererPhase, ColumnDef, ColumnInstanceId, InternalColumnDef } from '../columnDef.js';
import { getColumnInstanceIdentity } from '../columnDef.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import { CellSlot, isDirectTextColumn, recordCellSlotMountedVisualVersions } from './cellSlot.js';
import { applyHierarchyCellFocus, bindHierarchyCell } from './hierarchyCellBinder.js';
import type { GroupVisualRow, TotalVisualRow } from '../visualRow.js';
import { isHierarchyColumn } from '../rows/hierarchyColumn.js';
import { bindCellDuringScroll, bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import type { RowSlot } from './rowSlot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { CompiledColumnTopology } from './columnTopology.js';
import type { ViewportPlan } from './viewportPlanner.js';
import { GridMetric, type GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import { collectCellDecorationSnapshotMetadata, createCellDisplaySnapshot } from './cellDisplaySnapshot.js';
import { applyCellSlotRetentionPolicy, stampNewCellSlotForRetention, takeRecycledCell } from './cellSlotRetention.js';
import {
	resolveWarmVisibleCellStatus,
	type WarmVisibleCellStatus,
	type WarmVisibleCellStatusContext,
	type WarmVisibleCellStatusDeps,
} from './warmCellStatus.js';
import { createRowCtrl, type RowCtrl } from './controllers/RowCtrl.js';
import { applyCellTitlesAndValidation, buildCellPinClass, isOverscanLiveCell, markCellForPostScrollRepair } from './binders/binderShared.js';
import { PostScrollRepairReason } from './cellPresentationStateMachine.js';
import { reportRendererFault } from './rendererFaults.js';
import { clearSelectionCheckbox, syncSelectionCheckbox } from './binders/checkboxCellBinder.js';

/** Minimal mutable sink for cell-slot retention counters — see renderTelemetry.ts RenderRuntimeStats. */
export interface CellSlotRetentionTelemetrySink {
	cellSlotsRetained: number;
	cellSlotsEvictedDuringTopology: number;
	cellSlotsCreatedDuringTopology: number;
	cellSlotsReusedDuringTopology: number;
	maxCellsByColumnIdPerRowSlot: number;
}

export interface RowCellLaneFullBindRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	slotId: string;
	slotGeneration: number;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	pinRightBaseLeft: number;
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	state: InternalGridState<TRowData>;
	isScrollFrameActive: boolean;
	ctx?: ScrollRenderContext<TRowData>;
	phase?: CellRendererPhase;
}

export interface RowCellLaneScrollBindRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	ctx: ScrollRenderContext<TRowData>;
	pooledRowId: string;
	pooledRowGeneration: number;
	left: number;
	right: number;
	width: number;
	isRowRebind: boolean;
	isRowLoading: boolean;
}

export interface RowCellBindingLaneDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	initCell: (el: HTMLDivElement) => void;
	releaseCellFn: (cell: CellSlot<TRowData>) => void;
	ensurePinnedContainer: (slot: RowSlot<TRowData>, side: 'left' | 'right', width: number) => HTMLDivElement | null;
	cellBinderDeps: RowCellBinderDeps<TRowData>;
	markCellDirtyAfterScroll: (cell: HTMLDivElement) => void;
	releaseCellPortal: (cell: HTMLDivElement, forceDeferred?: boolean, reason?: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated') => void;
	ensureLoadingSkeleton: (cell: HTMLDivElement) => void;
	onScrollCellVisited: () => void;
	onScrollCellPatched: () => void;
	onScrollCellWritten: () => void;
	retentionStats?: CellSlotRetentionTelemetrySink;
	/** Rendered row-slot count this frame — sizes the display-snapshot working set. Omitted = unknown. */
	getRenderedRowCount?: () => number;
}

export interface BindAllDataCellsRequest<TRowData = unknown> {
	slot: RowSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	centerColStart: number;
	centerColCount: number;
	columns: ColumnDef<TRowData>[];
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	/** Authoritative column topology for lane membership and lane-relative offsets. */
	columnTopology: CompiledColumnTopology;
	isScrollFrameActive: boolean;
	ctx?: ScrollRenderContext<TRowData>;
	state: InternalGridState<TRowData>;
	isRowRebind: boolean;
	forceCellRefresh: boolean;
	isRowVisible: boolean;
	refreshVisibleColumns?: ReadonlySet<number> | null;
	viewportPlan?: ViewportPlan | null;
}

export interface BindAllHierarchyRowCellsRequest<TRowData = unknown> {
	slot: RowSlot<TRowData>;
	row: GroupVisualRow<TRowData> | TotalVisualRow<TRowData>;
	rowIndex: number;
	centerColStart: number;
	centerColCount: number;
	columns: ColumnDef<TRowData>[];
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	columnTopology: CompiledColumnTopology;
	isScrollFrameActive: boolean;
	state: InternalGridState<TRowData>;
	/** The row is the stuck copy of a sticky group header (what `GroupRenderContext.isStuck` reports). */
	isStuck?: boolean;
}

export interface BindAllLoadingCellsRequest<TRowData = unknown> {
	slot: RowSlot<TRowData>;
	rowIndex: number;
	centerColStart: number;
	centerColCount: number;
	columns: ColumnDef<TRowData>[];
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	/** Authoritative column topology for lane membership and lane-relative offsets. */
	columnTopology: CompiledColumnTopology;
	isScrollFrameActive: boolean;
}

/**
 * Reconciles the three lane arrays on a RowSlot to match a new column topology without
 * destroying cells for columns that merely changed lanes (pin/unpin relocation).
 *
 * Algorithm:
 *  1. Destroy cells for columns that have left the rendered set entirely.
 *  2. For each column in the new topology — create a cell if new, otherwise reuse the
 *     existing cell. If the cell is in the wrong DOM container, relocate it (move the
 *     element) without touching its portal host or renderer state.
 *  3. Rebuild the leftCells / centerCells / rightCells arrays in column order.
 */
function reconcileTopology<TRowData>(
	slot: RowSlot<TRowData>,
	topology: CompiledColumnTopology,
	pinLeftContainer: HTMLDivElement | null,
	centerColStart: number,
	centerColCount: number,
	pinRightContainer: HTMLDivElement | null,
	columns: readonly ColumnDef<TRowData>[],
	initFn: (el: HTMLDivElement) => void,
	releaseFn: (cell: CellSlot<TRowData>) => void,
	instrumentation?: GridInstrumentation,
	retentionStats?: CellSlotRetentionTelemetrySink
): void {
	// Build the set of column instance ids in the new rendered topology.
	const newInstanceIds = new Set<ColumnInstanceId>();
	for (const p of topology.left) if (p.columnId) newInstanceIds.add(p.columnId);
	for (const p of topology.center) {
		if (p.absoluteIndex >= centerColStart && p.absoluteIndex < centerColStart + centerColCount) {
			if (p.columnId) newInstanceIds.add(p.columnId);
		}
	}
	for (const p of topology.right) if (p.columnId) newInstanceIds.add(p.columnId);

	// Step 1 — destroy cells for columns that exited the rendered set. This path already evicts
	// everything outside newInstanceIds unconditionally, so no bounded-retention policy is needed
	// here — only the same telemetry counters as the scroll-frame path, for a consistent picture.
	for (const [instanceId, cell] of slot.cellsByColumnInstanceId) {
		if (!newInstanceIds.has(instanceId)) {
			releaseFn(cell);
			cell.destroy();
			if (cell.element.parentNode) cell.element.remove();
			slot.cellsByColumnInstanceId.delete(instanceId);
			instrumentation?.increment(GridMetric.CELL_VIEW_DESTROYED);
			if (retentionStats) retentionStats.cellSlotsEvictedDuringTopology++;
		}
	}

	// columnInstanceId is set at construction time — the cell's permanent column identity.
	// colField mirrors the display name and is guarded-written by update() in the bind loop.
	function ensureCell(instanceId: ColumnInstanceId, col: ColumnDef<TRowData>): CellSlot<TRowData> {
		let cell = slot.cellsByColumnInstanceId.get(instanceId);
		if (!cell) {
			const el = document.createElement('div');
			if (isDirectTextColumn(col)) el.dataset.textCell = '';
			initFn(el);
			cell = CellSlot.fromElement<TRowData>(el);
			cell.columnInstanceId = instanceId;
			slot.cellsByColumnInstanceId.set(instanceId, cell);
			stampNewCellSlotForRetention(cell);
			instrumentation?.increment(GridMetric.CELL_VIEW_CREATED);
			if (retentionStats) retentionStats.cellSlotsCreatedDuringTopology++;
		} else if (retentionStats) {
			retentionStats.cellSlotsReusedDuringTopology++;
		}
		return cell;
	}

	// Step 2 & 3 — rebuild lane arrays from topology, creating or relocating cells as needed.
	slot.leftCells.length = 0;
	if (pinLeftContainer) {
		for (const p of topology.left) {
			const col = columns[p.absoluteIndex];
			if (!col?.field || !p.columnId) continue;
			const cell = ensureCell(p.columnId, col);
			if (cell.element.parentNode !== pinLeftContainer) {
				pinLeftContainer.appendChild(cell.element);
				instrumentation?.increment(GridMetric.CELL_VIEW_RELOCATED);
			}
			slot.leftCells.push(cell);
		}
	}

	slot.centerCells.length = 0;
	for (const p of topology.center) {
		const c = p.absoluteIndex;
		if (c < centerColStart || c >= centerColStart + centerColCount) continue;
		const col = columns[c];
		if (!col?.field || !p.columnId) continue;
		const cell = ensureCell(p.columnId, col);
		if (cell.element.parentNode !== slot.element) {
			slot.element.appendChild(cell.element);
			instrumentation?.increment(GridMetric.CELL_VIEW_RELOCATED);
		}
		slot.centerCells.push(cell);
	}

	slot.rightCells.length = 0;
	if (pinRightContainer) {
		for (const p of topology.right) {
			const col = columns[p.absoluteIndex];
			if (!col?.field || !p.columnId) continue;
			const cell = ensureCell(p.columnId, col);
			if (cell.element.parentNode !== pinRightContainer) {
				pinRightContainer.appendChild(cell.element);
				instrumentation?.increment(GridMetric.CELL_VIEW_RELOCATED);
			}
			slot.rightCells.push(cell);
		}
	}

	slot.centerColStart = centerColStart;
	slot.pinLeftCount = topology.left.length;
	slot.pinRightStart = topology.left.length + topology.center.length;
}

/**
 * Topology-owned scroll reconciliation: updates lane arrays to match the new center
 * window WITHOUT calling releaseFn for any cell. Columns that leave the center window
 * remain in `cellsByColumnInstanceId` and are reused when they scroll back into view.
 *
 * Invariant: `cellsByColumnInstanceId` is authoritative at all times — no drift is possible
 * because this path never allocates by count or recycles cells to different columns.
 */
function reconcileCellTopologyForScroll<TRowData>(
	slot: RowSlot<TRowData>,
	topology: CompiledColumnTopology,
	pinLeftContainer: HTMLDivElement | null,
	centerColStart: number,
	centerColCount: number,
	pinRightContainer: HTMLDivElement | null,
	columns: readonly ColumnDef<TRowData>[],
	initFn: (el: HTMLDivElement) => void,
	releaseFn?: (cell: CellSlot<TRowData>) => void,
	focusedColumnInstanceId?: ColumnInstanceId,
	instrumentation?: GridInstrumentation,
	retentionStats?: CellSlotRetentionTelemetrySink
): void {
	// Compute the set of column instance ids visible in this frame. The Set is a reused scratch —
	// applyCellSlotRetentionPolicy only reads it during the call and never retains it.
	const scratchInUse = visibleInstanceIdsScratchInUse;
	const visibleInstanceIds = scratchInUse ? new Set<ColumnInstanceId>() : visibleInstanceIdsScratch;
	visibleInstanceIds.clear();
	visibleInstanceIdsScratchInUse = true;
	try {
		if (pinLeftContainer) {
			for (const p of topology.left) {
				if (columns[p.absoluteIndex]?.field && p.columnId) visibleInstanceIds.add(p.columnId);
			}
		}
		for (const p of topology.center) {
			const c = p.absoluteIndex;
			if (c >= centerColStart && c < centerColStart + centerColCount) {
				if (columns[c]?.field && p.columnId) visibleInstanceIds.add(p.columnId);
			}
		}
		if (pinRightContainer) {
			for (const p of topology.right) {
				if (columns[p.absoluteIndex]?.field && p.columnId) visibleInstanceIds.add(p.columnId);
			}
		}
		// The currently focused/edited column must survive retention even if a horizontal scroll has
		// carried it outside the rendered window (e.g. mid-edit elsewhere in a wide grid).
		if (focusedColumnInstanceId) visibleInstanceIds.add(focusedColumnInstanceId);

		// Detach DOM elements for cells that left the visible window. The CellSlot itself
		// stays in cellsByColumnInstanceId so it can be reused when the column scrolls back in —
		// no releaseFn call, no portal teardown. Only last frame's lane cells can still be attached
		// (every reconcile path appends exactly the lane cells and detaches the rest), so scanning the
		// lane arrays is equivalent to scanning the whole retained map, at a fraction of the size.
		detachCellsOutside(slot.leftCells, visibleInstanceIds);
		detachCellsOutside(slot.centerCells, visibleInstanceIds);
		detachCellsOutside(slot.rightCells, visibleInstanceIds);

		function ensureCell(instanceId: ColumnInstanceId, col: ColumnDef<TRowData>): CellSlot<TRowData> {
			let cell = slot.cellsByColumnInstanceId.get(instanceId);
			if (!cell) {
				const directText = isDirectTextColumn(col);
				const recycled = takeRecycledCell(slot, directText);
				if (recycled) {
					cell = recycled;
					if (retentionStats) retentionStats.cellSlotsReusedDuringTopology++;
				} else {
					const el = document.createElement('div');
					if (directText) el.dataset.textCell = '';
					initFn(el);
					cell = CellSlot.fromElement<TRowData>(el);
					instrumentation?.increment(GridMetric.CELL_VIEW_CREATED);
					if (retentionStats) retentionStats.cellSlotsCreatedDuringTopology++;
				}
				cell.columnInstanceId = instanceId;
				slot.cellsByColumnInstanceId.set(instanceId, cell);
				stampNewCellSlotForRetention(cell);
			} else if (retentionStats) {
				retentionStats.cellSlotsReusedDuringTopology++;
			}
			return cell;
		}

		slot.leftCells.length = 0;
		if (pinLeftContainer) {
			for (const p of topology.left) {
				const col = columns[p.absoluteIndex];
				if (!col?.field || !p.columnId) continue;
				const cell = ensureCell(p.columnId, col);
				if (cell.element.parentNode !== pinLeftContainer) pinLeftContainer.appendChild(cell.element);
				slot.leftCells.push(cell);
			}
		}

		slot.centerCells.length = 0;
		for (const p of topology.center) {
			const c = p.absoluteIndex;
			if (c < centerColStart || c >= centerColStart + centerColCount) continue;
			const col = columns[c];
			if (!col?.field || !p.columnId) continue;
			const cell = ensureCell(p.columnId, col);
			if (cell.element.parentNode !== slot.element) slot.element.appendChild(cell.element);
			slot.centerCells.push(cell);
		}

		slot.rightCells.length = 0;
		if (pinRightContainer) {
			for (const p of topology.right) {
				const col = columns[p.absoluteIndex];
				if (!col?.field || !p.columnId) continue;
				const cell = ensureCell(p.columnId, col);
				if (cell.element.parentNode !== pinRightContainer) pinRightContainer.appendChild(cell.element);
				slot.rightCells.push(cell);
			}
		}

		slot.centerColStart = centerColStart;
		slot.pinLeftCount = topology.left.length;
		slot.pinRightStart = topology.left.length + topology.center.length;

		// Bounded retention: cellsByColumnInstanceId must never grow unbounded just because scroll-frame
		// reconciliation never evicts on its own. Runs AFTER this frame's cells are ensured (not
		// before) so newly-entered columns are already accounted for in the budget check — otherwise
		// eviction would trim to budget using the OLD visible set and then this frame's newly-entered
		// columns would push it back over on every window shift.
		if (releaseFn) {
			const { retainedAfter, evicted } = applyCellSlotRetentionPolicy(slot, visibleInstanceIds, releaseFn, instrumentation);
			if (retentionStats) {
				retentionStats.cellSlotsEvictedDuringTopology += evicted;
				retentionStats.cellSlotsRetained += retainedAfter;
				if (retainedAfter > retentionStats.maxCellsByColumnIdPerRowSlot) {
					retentionStats.maxCellsByColumnIdPerRowSlot = retainedAfter;
				}
			}
		}
	} finally {
		if (!scratchInUse) {
			visibleInstanceIdsScratchInUse = false;
			visibleInstanceIdsScratch.clear();
		}
	}
}

const visibleInstanceIdsScratch = new Set<ColumnInstanceId>();
let visibleInstanceIdsScratchInUse = false;

function detachCellsOutside<TRowData>(cells: readonly CellSlot<TRowData>[], keep: ReadonlySet<ColumnInstanceId>): void {
	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i];
		if (cell.element.parentNode && !keep.has(cell.columnInstanceId as ColumnInstanceId)) cell.element.remove();
	}
}

export { reconcileTopology, reconcileCellTopologyForScroll };

const LOADING_CELL_BASE_CLASS = 'og-cell og-cell-loading';

/** Syncs a loading cell's insight title/validation attributes and returns its decoration class
 *  suffix (leading space per class, '' when none) to append to LOADING_CELL_BASE_CLASS. */
function applyLoadingInsightState<TRowData>(
	deps: RowCellBindingLaneDeps<TRowData>,
	cellSlot: CellSlot<TRowData>,
	rowId: string,
	colField: string
): string {
	if (deps.engine.insights.size === 0) {
		applyCellTitlesAndValidation(cellSlot, null, '', undefined);
		return '';
	}

	const decorationMetadata = collectCellDecorationSnapshotMetadata(deps.engine.insights.getCellDecorations(rowId, colField));
	applyCellTitlesAndValidation(cellSlot, null, decorationMetadata.insightTitle, decorationMetadata.validationError);
	return decorationMetadata.classNameSuffix;
}

const NO_WARM_REFRESH: WarmVisibleCellStatus = { needsImmediateWake: false, needsDeferredRefresh: false };
const WARM_CELL_UNTRACKED: WarmVisibleCellStatus = { needsImmediateWake: true, needsDeferredRefresh: true };

const warmStatusDepsByLaneDeps = new WeakMap<object, WarmVisibleCellStatusDeps>();

function getWarmStatusDeps<TRowData>(deps: RowCellBindingLaneDeps<TRowData>): WarmVisibleCellStatusDeps {
	let warmDeps = warmStatusDepsByLaneDeps.get(deps);
	if (!warmDeps) {
		warmDeps = {
			getCellPortalHost: (cell) => deps.cellBinderDeps.getCellPortalHost(cell),
			isCellMounted: (key) => deps.cellBinderDeps.portalMountManager.isCellMounted(key),
		};
		warmStatusDepsByLaneDeps.set(deps, warmDeps);
	}
	return warmDeps;
}

/**
 * Per-row state for the lane bind loops — one object per row instead of the three closures (and
 * the per-cell deps/context objects inside them) the loop used to allocate.
 */
interface DataRowBindState<TRowData> {
	deps: RowCellBindingLaneDeps<TRowData>;
	request: BindAllDataCellsRequest<TRowData>;
	rowCtrl: RowCtrl<TRowData>;
	isRowLoading: boolean;
	/** Reused per cell — resolveWarmVisibleCellStatus reads it synchronously and never retains it. */
	warmContext: WarmVisibleCellStatusContext | null;
}

/** Warm-cell status for one cell, computed at most once per cell per frame. */
function getWarmVisibleCellStatus<TRowData>(row: DataRowBindState<TRowData>, cellSlot: CellSlot<TRowData>): WarmVisibleCellStatus {
	const warmContext = row.warmContext;
	if (!warmContext) return NO_WARM_REFRESH;
	// The slot's bound controller is the store's for this (row, column) while it is alive — the
	// store never replaces a live controller under its key — so skip the key build + map lookup.
	const bound = cellSlot.boundCellCtrl;
	const cellCtrl =
		cellSlot.columnInstanceId === ''
			? undefined
			: bound && !bound.lifecycle.destroyed && bound.rowId === row.request.node.id && bound.columnInstanceId === cellSlot.columnInstanceId
				? bound
				: row.deps.engine.rowCtrls?.cellCtrls.getByRowAndColumn(row.request.node.id, cellSlot.columnInstanceId);
	if (!cellCtrl) return WARM_CELL_UNTRACKED;
	warmContext.cellCtrl = cellCtrl;
	return resolveWarmVisibleCellStatus(getWarmStatusDeps(row.deps), cellSlot, warmContext);
}

/**
 * A row entering the viewport from the overscan band normally re-binds every cell (its buffered
 * content may be a placeholder). A plain primitive cell the buffered bind filled with its final
 * text, still fresh for every version and neither focused nor edited, already shows exactly what
 * the visible bind would write — keep it instead of binding it a second time.
 */
function canKeepCellEnteringView<TRowData>(
	row: DataRowBindState<TRowData>,
	cellSlot: CellSlot<TRowData>,
	colIndex: number,
	warmStatus: WarmVisibleCellStatus
): boolean {
	const ctx = row.request.ctx;
	if (!ctx || !row.warmContext || warmStatus.needsDeferredRefresh) return false;
	if (cellSlot.lastContentMode !== 'text' || cellSlot.lastFormattedValue === '...' || cellSlot.lastMountedRowVersion === -1) return false;
	if (ctx.plan.columnPlans[colIndex]?.mode !== 'primitive') return false;
	const rowId = row.request.node.id;
	return ctx.focusedCell?.rowId !== rowId && ctx.activeEdit?.rowId !== rowId;
}

/**
 * Binds one data cell of a lane, or skips it when it is stable this scroll frame. Behaviour is the
 * former per-lane loop body verbatim; the warm status is shared between the refresh and skip checks.
 */
function bindDataCell<TRowData>(
	row: DataRowBindState<TRowData>,
	cellSlot: CellSlot<TRowData>,
	col: ColumnDef<TRowData>,
	colIndex: number,
	lane: 'left' | 'center' | 'right',
	left: number,
	isVisibleContent: boolean
): void {
	const { deps, request, rowCtrl } = row;
	const { node, rowIndex, isScrollFrameActive, forceCellRefresh, isRowRebind, refreshVisibleColumns, viewportPlan, ctx } = request;
	if (isHierarchyColumn(col)) {
		const visualRow = deps.engine.getVisualRowModel()?.getVisualRow(rowIndex);
		if (visualRow) {
			bindHierarchyCell(deps, {
				cellSlot,
				row: visualRow,
				rowIndex,
				colIndex,
				col,
				lane,
				left,
				width: request.plan.colWidths[colIndex],
				state: request.state,
				isScrollFrameActive,
			});
			return;
		}
	}
	let warmStatus: WarmVisibleCellStatus | undefined;

	// shouldRefreshWarmVisibleCell
	let needsVisibleRefresh = false;
	if (isScrollFrameActive && isVisibleContent && ctx) {
		if (refreshVisibleColumns?.has(colIndex)) needsVisibleRefresh = true;
		else needsVisibleRefresh = (warmStatus = getWarmVisibleCellStatus(row, cellSlot)).needsDeferredRefresh;
	}

	// shouldSkipStableCellDuringScroll
	let skip = false;
	if (isScrollFrameActive && !isRowRebind && (!forceCellRefresh || isVisibleContent)) {
		if (cellSlot.colIndex === colIndex && cellSlot.rowId === node.id && cellSlot.rowIndex === rowIndex) {
			if (!isVisibleContent) {
				const instanceId = (request.columns[colIndex] as InternalColumnDef<TRowData> | undefined)?.instanceId;
				skip = !(instanceId && viewportPlan && isOverscanLiveCell(viewportPlan.liveCells.overscan, rowIndex, instanceId));
			} else {
				warmStatus ??= getWarmVisibleCellStatus(row, cellSlot);
				skip =
					!warmStatus.needsImmediateWake &&
					!refreshVisibleColumns?.has(colIndex) &&
					(!forceCellRefresh || canKeepCellEnteringView(row, cellSlot, colIndex, warmStatus));
			}
		}
	}
	if (skip) {
		if (needsVisibleRefresh) {
			markCellForPostScrollRepair(deps.cellBinderDeps, cellSlot, PostScrollRepairReason.WarmCell);
		}
		return;
	}

	const cellWidth = request.plan.colWidths[colIndex];
	if (isScrollFrameActive) {
		deps.onScrollCellVisited();
		deps.onScrollCellPatched();
		bindCellDuringScroll(deps.cellBinderDeps, {
			cellSlot,
			node,
			rowIndex,
			colIndex,
			col,
			lane,
			ctx: ctx!,
			pooledRowId: request.slot.id,
			pooledRowGeneration: request.slot.generation,
			left,
			right: -1,
			width: cellWidth,
			isRowRebind,
			isRowLoading: row.isRowLoading,
			isInVisibleContent: isVisibleContent,
			viewportPlan,
			rowCtrl,
		});
	} else {
		bindCellFull(deps.cellBinderDeps, {
			cellSlot,
			slotId: request.slot.id,
			slotGeneration: request.slot.generation,
			node,
			rowIndex,
			colIndex,
			col,
			lane,
			pinRightBaseLeft: request.plan.pinRightBaseLeft,
			plan: request.plan,
			state: request.state,
			ctx,
			rowCtrl,
		});
	}
}

export function bindAllDataCells<TRowData>(deps: RowCellBindingLaneDeps<TRowData>, request: BindAllDataCellsRequest<TRowData>): void {
	const { slot, node, centerColStart, centerColCount, columns, plan, columnTopology, isScrollFrameActive, ctx, isRowVisible } = request;
	const pinLeftWidth = plan.pinLeftWidth;
	const pinRightWidth = plan.pinRightWidth;
	const isRowLoading = ctx ? ctx.loadingVersion > 0 && deps.engine.data.isRowLoading(node.id) : false;
	const visibleColStart = ctx?.visibleColRange?.startIdx ?? centerColStart;
	const visibleColEnd = ctx?.visibleColRange?.endIdx ?? centerColStart + centerColCount - 1;
	const currentRowVersion = ctx?.rowVersions?.get(node.id);
	// Attach/reuse this row's RowCtrl once per row (not once per cell) — CellCtrl attach happens
	// per cell inside bindCellFull/bindCellDuringScroll via the rowCtrl passed down below.
	// isEditing/isFocused reset to false here and are rolled back to true by whichever cell (if any)
	// is the active edit/focus target this frame — see attachCellCtrl in rowCellBinder.ts.
	const rowCtrl = deps.engine.rowCtrls?.getOrCreate(node.id) ?? createRowCtrl<TRowData>(node.id);
	rowCtrl.attachedSlotId = slot.id;
	rowCtrl.attachedGeneration = slot.generation;
	if (currentRowVersion !== undefined) rowCtrl.rowVersion = currentRowVersion;
	rowCtrl.isEditing = false;
	rowCtrl.isFocused = false;
	const row: DataRowBindState<TRowData> = {
		deps,
		request,
		rowCtrl,
		isRowLoading,
		warmContext: ctx
			? {
					currentRowVersion,
					globalVersion: ctx.globalVersion,
					globalChangedDuringScroll: ctx.globalChangedDuringScroll,
					insightVersion: ctx.insightVersion,
					styleVersion: ctx.styleVersion,
					loadingVersion: ctx.loadingVersion,
					selectionVersion: ctx.selectionVersion,
					hasInsightDecorations: ctx.hasInsightDecorations,
					hasDeferredCellStyleRules: ctx.hasDeferredCellStyleRules,
					loadingChangedDuringScroll: ctx.loadingChangedDuringScroll,
					selectionChangedDuringScroll: ctx.selectionChangedDuringScroll,
					cellCtrl: undefined as unknown as WarmVisibleCellStatusContext['cellCtrl'],
				}
			: null,
	};

	const pinLeftContainer = deps.ensurePinnedContainer(slot, 'left', pinLeftWidth);
	const pinRightContainer = deps.ensurePinnedContainer(slot, 'right', pinRightWidth);

	if (!isScrollFrameActive) {
		// Full paint: topology-aware reconciliation — retains cells across lane changes.
		// cellsByColumnInstanceId is authoritative; no drift repair needed.
		reconcileTopology(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn,
			deps.engine.instrumentation,
			deps.retentionStats
		);
	} else {
		// Scroll frame: topology-owned reconciliation — bounded retention, no full releaseFn sweep.
		// cellsByColumnInstanceId stays authoritative; cells leaving the visible+approach-band window
		// are retained as a small LRU (cellSlotRetention.ts) and reused when they scroll back into view.
		const focusedColumnInstanceId = ctx?.focusedCell?.columnInstanceId;
		reconcileCellTopologyForScroll(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn,
			focusedColumnInstanceId,
			deps.engine.instrumentation,
			deps.retentionStats
		);
	}

	for (let i = 0; i < columnTopology.left.length; i++) {
		const placement = columnTopology.left[i];
		const col = columns[placement.absoluteIndex];
		const cellSlot = slot.leftCells[i];
		if (!col || !cellSlot) continue;
		bindDataCell(row, cellSlot, col, placement.absoluteIndex, 'left', placement.laneOffset, isRowVisible);
	}

	for (let i = 0; i < centerColCount; i++) {
		const c = centerColStart + i;
		const col = columns[c];
		const cellSlot = slot.centerCells[i];
		if (!col || !cellSlot) continue;
		bindDataCell(row, cellSlot, col, c, 'center', plan.colLefts[c], isRowVisible && c >= visibleColStart && c <= visibleColEnd);
	}

	for (let i = 0; i < columnTopology.right.length; i++) {
		const placement = columnTopology.right[i];
		const col = columns[placement.absoluteIndex];
		const cellSlot = slot.rightCells[i];
		if (!col || !cellSlot) continue;
		// Use topology laneOffset for right cells (= absoluteLeft - pinRightBaseLeft).
		bindDataCell(row, cellSlot, col, placement.absoluteIndex, 'right', placement.laneOffset, isRowVisible);
	}

	// Keep the display-snapshot working set at least as large as what is rendered (with headroom
	// for prewarm rings) — a fixed 1024 is smaller than a 40x30 viewport plus overscan.
	const renderedRows = deps.getRenderedRowCount?.() ?? 0;
	if (renderedRows > 0) deps.engine.cellDisplaySnapshots.ensureCapacity?.(3 * renderedRows * slot.cellCount);
}

export function bindAllLoadingCells<TRowData>(deps: RowCellBindingLaneDeps<TRowData>, request: BindAllLoadingCellsRequest<TRowData>): void {
	const { slot, rowIndex, centerColStart, centerColCount, columns, plan, columnTopology, isScrollFrameActive } = request;
	const pinLeftWidth = plan.pinLeftWidth;
	const pinRightWidth = plan.pinRightWidth;
	const globalVersion = deps.engine.stateManager.getState().globalVersion;
	const snapshotVisualVersions = deps.cellBinderDeps.getSnapshotVisualVersions();

	const pinLeftContainer = deps.ensurePinnedContainer(slot, 'left', pinLeftWidth);
	const pinRightContainer = deps.ensurePinnedContainer(slot, 'right', pinRightWidth);

	if (!isScrollFrameActive) {
		reconcileTopology(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn
		);
	} else {
		reconcileCellTopologyForScroll(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn,
			undefined,
			deps.engine.instrumentation,
			deps.retentionStats
		);
	}

	// Everything below is identical for every cell of this loading row — computed once per row
	// rather than once per cell.
	const loadingRow: LoadingRowBindState<TRowData> = {
		deps,
		request,
		rowId: `loading:${rowIndex}`,
		globalVersion,
		visualVersions: {
			insightVersion: deps.engine.insights.getVersion(),
			styleVersion: snapshotVisualVersions.styleVersion,
			loadingVersion: snapshotVisualVersions.loadingVersion,
			selectionVersion: deps.engine.selectionVersion,
		},
	};

	for (let i = 0; i < columnTopology.left.length; i++) {
		bindLoadingCell(loadingRow, slot.leftCells[i], columnTopology.left[i].absoluteIndex, columnTopology.left[i].laneOffset);
	}
	for (let i = 0; i < centerColCount; i++) bindLoadingCell(loadingRow, slot.centerCells[i], centerColStart + i, plan.colLefts[centerColStart + i]);
	for (let i = 0; i < columnTopology.right.length; i++) {
		bindLoadingCell(loadingRow, slot.rightCells[i], columnTopology.right[i].absoluteIndex, columnTopology.right[i].laneOffset);
	}
}

interface LoadingRowBindState<TRowData> {
	deps: RowCellBindingLaneDeps<TRowData>;
	request: BindAllLoadingCellsRequest<TRowData>;
	rowId: string;
	globalVersion: number;
	visualVersions: { insightVersion: number; styleVersion: number; loadingVersion: number; selectionVersion: number };
}

function bindLoadingCell<TRowData>(row: LoadingRowBindState<TRowData>, cellSlot: CellSlot<TRowData>, c: number, leftArg: number): void {
	const { deps, request, rowId, globalVersion, visualVersions } = row;
	const { columns, plan, rowIndex, isScrollFrameActive } = request;
	const col = columns[c];
	if (!col || !cellSlot) return;
	if (isScrollFrameActive) deps.onScrollCellVisited();
	if (cellSlot.lastPortalKey) deps.releaseCellPortal(cellSlot.element);
	const cellWidth = plan.colWidths[c];
	// A loading row has nothing to select yet; a recycled slot must not keep the previous row's box.
	if (cellSlot.rowCheckbox) clearSelectionCheckbox(cellSlot);
	const decorationSuffix = applyLoadingInsightState(deps, cellSlot, rowId, col.field);
	const cellClassName = decorationSuffix ? LOADING_CELL_BASE_CLASS + decorationSuffix : LOADING_CELL_BASE_CLASS;
	if (isScrollFrameActive) {
		deps.onScrollCellPatched();
		markCellForPostScrollRepair(deps.cellBinderDeps, cellSlot, PostScrollRepairReason.Loading);
	} else {
		deps.ensureLoadingSkeleton(cellSlot.element);
	}
	const didWrite = cellSlot.update(c, col.field, rowIndex, rowId, leftArg, -1, cellWidth, cellClassName, 'loading', undefined, '', undefined);
	cellSlot.lastMountedRowVersion = -1;
	cellSlot.lastMountedGlobalVersion = globalVersion;
	recordCellSlotMountedVisualVersions(cellSlot, visualVersions);
	deps.engine.cellDisplaySnapshots.set(
		createCellDisplaySnapshot({
			rowId,
			columnInstanceId: getColumnInstanceIdentity(col),
			colField: col.field,
			rowVersion: -1,
			globalVersion,
			insightVersion: visualVersions.insightVersion,
			styleVersion: visualVersions.styleVersion,
			loadingVersion: visualVersions.loadingVersion,
			selectionVersion: visualVersions.selectionVersion,
			baseClassName: LOADING_CELL_BASE_CLASS,
			decorationClassName: decorationSuffix,
			contentKind: 'loading',
			contentMode: 'loading',
			formattedValue: '',
			title: cellSlot.element.title,
			validationError: cellSlot.element.dataset.validationError,
		})
	);
	if (isScrollFrameActive && didWrite) deps.onScrollCellWritten();
}

/**
 * Binds a group or total row as a cell row: every lane gets real cells, like a data row. The
 * hierarchy column shows the group; every other column shows `aggregates[field]` through the
 * column's value formatter, or nothing. No portals, no framework work: these cells are written
 * on every bind, scroll frames included, so group and total rows are never blank mid-scroll.
 */
export function bindAllHierarchyRowCells<TRowData>(deps: RowCellBindingLaneDeps<TRowData>, request: BindAllHierarchyRowCellsRequest<TRowData>): void {
	const { slot, centerColStart, centerColCount, columns, plan, columnTopology, isScrollFrameActive } = request;
	const pinLeftContainer = deps.ensurePinnedContainer(slot, 'left', plan.pinLeftWidth);
	const pinRightContainer = deps.ensurePinnedContainer(slot, 'right', plan.pinRightWidth);
	if (!isScrollFrameActive) {
		reconcileTopology(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn
		);
	} else {
		reconcileCellTopologyForScroll(
			slot,
			columnTopology,
			pinLeftContainer,
			centerColStart,
			centerColCount,
			pinRightContainer,
			columns,
			deps.initCell,
			deps.releaseCellFn,
			undefined,
			deps.engine.instrumentation,
			deps.retentionStats
		);
	}
	for (let i = 0; i < columnTopology.left.length; i++) {
		const placement = columnTopology.left[i];
		bindHierarchyRowCell(deps, request, slot.leftCells[i], placement.absoluteIndex, 'left', placement.laneOffset);
	}
	for (let i = 0; i < centerColCount; i++) {
		bindHierarchyRowCell(deps, request, slot.centerCells[i], centerColStart + i, 'center', plan.colLefts[centerColStart + i]);
	}
	for (let i = 0; i < columnTopology.right.length; i++) {
		const placement = columnTopology.right[i];
		bindHierarchyRowCell(deps, request, slot.rightCells[i], placement.absoluteIndex, 'right', placement.laneOffset);
	}
}

/**
 * The checkbox-selection column on a group or total row. A group row gets a tri-state checkbox over
 * every data row beneath it (nested and collapsed groups included); a click selects or deselects
 * them all. Totals, and grids in single-selection mode, show no checkbox.
 */
function bindGroupSelectionCell<TRowData>(
	deps: RowCellBindingLaneDeps<TRowData>,
	request: BindAllHierarchyRowCellsRequest<TRowData>,
	cellSlot: CellSlot<TRowData>,
	colIndex: number,
	lane: 'left' | 'center' | 'right',
	left: number,
	width: number
): void {
	const { row, rowIndex, columns, state, isScrollFrameActive } = request;
	const col = columns[colIndex];
	cellSlot.releaseContentMount();
	cellSlot.hasAggregateText = false;
	const selectable = row.kind === 'group' && state.rowSelection?.mode === 'multiple';
	if (selectable) {
		syncSelectionCheckbox(cellSlot, 'group', deps.engine.groupingFeature.getDescendantSelection(row.id).state, rowIndex);
	} else {
		clearSelectionCheckbox(cellSlot);
	}
	const focusClass = applyHierarchyCellFocus(deps, cellSlot, row.id, rowIndex, colIndex, col, state);
	const className = `${buildCellPinClass(lane)} og-cell-row-selector og-cell-group-selector${focusClass}`;
	const didWrite = cellSlot.update(colIndex, col.field, rowIndex, row.id, left, -1, width, className, 'custom', undefined, '', undefined);
	cellSlot.lastMountedRowVersion = -1;
	if (isScrollFrameActive && didWrite) deps.onScrollCellWritten();
}

function bindHierarchyRowCell<TRowData>(
	deps: RowCellBindingLaneDeps<TRowData>,
	request: BindAllHierarchyRowCellsRequest<TRowData>,
	cellSlot: CellSlot<TRowData> | undefined,
	colIndex: number,
	lane: 'left' | 'center' | 'right',
	left: number
): void {
	const { row, rowIndex, columns, plan, state, isScrollFrameActive } = request;
	const col = columns[colIndex];
	if (!col || !cellSlot) return;
	const width = plan.colWidths[colIndex];
	if (isHierarchyColumn(col)) {
		bindHierarchyCell(deps, { cellSlot, row, rowIndex, colIndex, col, lane, left, width, state, isScrollFrameActive, isStuck: request.isStuck });
		return;
	}
	if (isScrollFrameActive) deps.onScrollCellVisited();
	if (cellSlot.lastPortalKey) deps.releaseCellPortal(cellSlot.element);
	if (col.checkboxSelection) {
		bindGroupSelectionCell(deps, request, cellSlot, colIndex, lane, left, width);
		return;
	}
	const value = row.aggregates[col.field];
	let text = '';
	if (value !== undefined && !col.checkboxSelection) {
		try {
			// The column's formatter, else its scrollText (the renderer's cheap text form), else raw.
			const scrollText = (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.scrollText;
			if (col.valueFormatter) text = col.valueFormatter({ value, rowData: undefined as TRowData, colDef: col, rowId: row.id });
			else if (value === null) text = '';
			else text = (scrollText && scrollText({ value, formattedValue: String(value) })) || String(value);
		} catch (error) {
			reportRendererFault(deps.engine, 'aggregate-format', error, { rowId: row.id, rowIndex, colField: col.field, colIndex });
			text = String(value);
		}
	}
	const focusClass = applyHierarchyCellFocus(deps, cellSlot, row.id, rowIndex, colIndex, col, state);
	const spec = col.aggregateRenderer;
	if (spec && value != null && !cellSlot.directText) {
		// The column draws its aggregate itself: mounted here, updated in place, destroyed when the
		// cell shows anything else (see CellSlot.releaseContentMount).
		const params = { value, formattedValue: text, row, col };
		const mounted = cellSlot.contentMount;
		if (mounted && mounted.renderer === spec.renderer && mounted.handle.update) {
			if (mounted.rowId !== row.id || !Object.is(mounted.value, value)) mounted.handle.update(params as never);
			mounted.rowId = row.id;
			mounted.value = value;
		} else if (!mounted || mounted.renderer !== spec.renderer || mounted.rowId !== row.id || !Object.is(mounted.value, value)) {
			cellSlot.releaseContentMount();
			cellSlot.clearText();
			cellSlot.contentElement.textContent = '';
			try {
				const handle = spec.renderer.mount(cellSlot.contentElement, params) ?? {};
				cellSlot.contentMount = {
					renderer: spec.renderer,
					handle: handle as { update?(params: never): void; destroy?(): void },
					rowId: row.id,
					value,
				};
			} catch (error) {
				reportRendererFault(deps.engine, 'aggregate-renderer', error, { rowId: row.id, rowIndex, colField: col.field, colIndex });
			}
		}
		cellSlot.hasAggregateText = false;
		const className = `${buildCellPinClass(lane)} og-cell-aggregate og-cell-aggregate-value${focusClass}`;
		const didWrite = cellSlot.update(colIndex, col.field, rowIndex, row.id, left, -1, width, className, 'custom', value, '', undefined);
		cellSlot.lastMountedRowVersion = -1;
		if (isScrollFrameActive && didWrite) deps.onScrollCellWritten();
		return;
	}
	cellSlot.releaseContentMount();
	const className = `${buildCellPinClass(lane)} og-cell-aggregate${text === '' ? '' : ' og-cell-aggregate-value'}${focusClass}`;
	const didWrite = cellSlot.update(
		colIndex,
		col.field,
		rowIndex,
		row.id,
		left,
		-1,
		width,
		className,
		text === '' ? 'empty' : 'text',
		value,
		text,
		undefined
	);
	cellSlot.hasAggregateText = text !== '';
	cellSlot.lastMountedRowVersion = -1;
	if (isScrollFrameActive && didWrite) deps.onScrollCellWritten();
}
