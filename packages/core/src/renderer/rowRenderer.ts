import type { StickyCellRowBinder } from './stickyGroupRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GeometryController } from './geometryController.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { CellRenderer } from './cellRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import { SelectionPaintManager } from './selectionPaintManager.js';
import { type ColumnDef, type GridCellClassParams } from '../columnDef.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import { RowSlot } from './rowSlot.js';
import { RowSlotPool } from './rowSlotPool.js';
import { RowRendererRuntimeBridge } from './rowRendererRuntime.js';
import { compileStyleRules } from '../styling/styleRules.js';
import { PinnedContainerManager } from './pinnedContainerManager.js';
import type { CompiledColumnTopology } from './columnTopology.js';
import { ColumnTopologyCoordinator } from './columnTopologyCoordinator.js';
import { resolveRowPresentation } from './rowPresentationResolver.js';
import {
	applyRenderWindowRuntimeLimits,
	computeRenderWindow,
	diffRenderWindow,
	createEmptyViewportDelta,
	getRowIndices,
	sameVisibleContentWindow,
	sameRenderedWindow,
	type RenderWindow,
} from './renderWindow.js';
import type { SlotRuntimeStats } from './slotRuntimeStats.js';
import { FullWidthRowRenderer } from './fullWidthRowRenderer.js';
import { computeRowWindowRetention } from './rowWindowRetention.js';
import { ViewportPlanner, type ViewportPlan } from './viewportPlanner.js';
import { LiveFrameBudget } from './liveFrameBudget.js';
import { snapToDevicePixel } from './layoutPlan.js';
import { readInteractionState } from '../interaction/interactionState.js';
import { syncRowRendererInteractionAccessibility } from './rowRendererAccessibility.js';
import type { ProgrammaticScrollTarget } from './programmaticScrollTarget.js';

export class RowRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly geometryController: GeometryController<TRowData>;
	/** @internal — public for test access only; treat as private in production code. */
	public readonly portalMountManager: PortalMountManager<TRowData>;
	private readonly cellRenderer: CellRenderer;
	private readonly viewportRenderer: ViewportRenderer<TRowData>;
	/** Full-width row renderer (group/detail/footer/loading-fw). */
	private fullWidthRenderer!: FullWidthRowRenderer<TRowData>;

	// ── Stable slot pool ──────────────────────────────────────────────────────────────
	public rowSlotPool!: RowSlotPool<TRowData>;

	/**
	 * Lookup: visualRowIndex → RowSlot.
	 * Derived from slot bindings — rebuilt at the end of every recycleViewport call.
	 * This is NOT the primary lifecycle owner; rowSlotPool is.
	 */
	public activeRows = new Map<number, RowSlot<TRowData>>();
	/** Alias for activeRows — the spec name for the derived lookup map. */
	public get visualIndexToSlot(): Map<number, RowSlot<TRowData>> {
		return this.activeRows;
	}
	public get cellClassScratch(): GridCellClassParams<TRowData> {
		return this._cellClassScratch;
	}
	public get dirtyBuckets(): [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]] {
		return this._dirtyBuckets;
	}
	public currentWindow: RenderWindow | null = null;

	public dirtyCellsAfterScroll = new Set<HTMLDivElement>();
	public dirtyRowsAfterScroll = new Set<number>();

	public styleVersion = 0;
	public selectionVersion = 0;
	public loadingVersion = 0;
	public scrollStartStyleVersion = 0;
	public scrollStartSelectionVersion = 0;
	public scrollStartLoadingVersion = 0;
	public scrollStartGlobalVersion = 0;
	/** Forwarded to SelectionPaintManager — renderEngine.ts accesses this directly. */
	public get hoveredRowIndex(): number | null {
		return this.selectionPaint.hoveredRowIndex;
	}
	public set hoveredRowIndex(v: number | null) {
		this.selectionPaint.hoveredRowIndex = v;
	}
	public deferredFocusCell: HTMLDivElement | null = null;
	public programmaticScrollCell: ProgrammaticScrollTarget | null = null;
	public renderStats: any = null;

	public currentScrollCellsPatched = 0;
	public currentScrollRowsRecycled = 0;
	public currentScrollRowsVisited = 0;
	public currentScrollRowsRebound = 0;
	public currentScrollCellsVisited = 0;
	public currentScrollCellsWritten = 0;
	public currentScrollPortalOps = 0;
	public runtimeState!: import('./renderRuntimeState.js').RenderRuntimeState;
	public dirtyCellsMarkedDuringScroll = 0;

	/** Current viewport-owned resources; cumulative paint telemetry remains in RenderStats. */
	public getOwnershipSnapshot(): Readonly<{
		rowSlotCount: number;
		cellSlotCount: number;
		activeRowCount: number;
		dirtyCellCount: number;
		dirtyRowCount: number;
	}> {
		return Object.freeze({
			rowSlotCount: this.slotStats.rowSlotCount,
			cellSlotCount: this.slotStats.cellSlotCount,
			activeRowCount: this.activeRows.size,
			dirtyCellCount: this.dirtyCellsAfterScroll.size,
			dirtyRowCount: this.dirtyRowsAfterScroll.size,
		});
	}

	// Stable-slot virtualization counters — reset per scroll frame by RenderScrollPipeline.
	public slotStats: SlotRuntimeStats = {
		rowSlotCount: 0,
		cellSlotCount: 0,
		rowSlotBindsDuringScroll: 0,
		cellSlotBindsDuringScroll: 0,
		rowDomAppendsDuringScroll: 0,
		rowDomRemovesDuringScroll: 0,
		cellDomAppendsDuringScroll: 0,
		cellDomRemovesDuringScroll: 0,
		sameWindowBailouts: 0,
		fullWidthModeSwitchesDuringScroll: 0,
		customRebindsDuringScroll: 0,
		customWarmMovesDeferredDuringScroll: 0,
		customWarmMovesFlushedAfterScroll: 0,
		customColdMountsDuringScroll: 0,
		rowSlotAppendsTotal: 0,
		rowSlotRemovesTotal: 0,
		fullRebindFrames: 0,
		enteredOnlyFrames: 0,
	};

	public postScrollDirtyCellsDecorated = 0;

	// Pre-allocated priority buckets for decorateDirtyCellsAfterScroll — zero allocation per scroll idle pass.
	// Bucket layout: [0] active-edit, [1] focused cell, [2] visible range, [3] off-screen / unknown.
	private readonly _dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]] = [[], [], [], []];
	// Reusable scratch for getRowIndices() — avoids an O(visibleRows) array per frame.
	private readonly _rowIndicesScratch: number[] = [];
	// Reusable scratch for diffRenderWindow() — avoids six array allocations per frame.
	private readonly _deltaScratch = createEmptyViewportDelta();
	// Per-frame scratch sets (cleared, never reallocated) for entered visible columns / live overscan rows.
	private readonly _enteredVisibleColsScratch = new Set<number>();
	private readonly _liveOverscanRowsScratch = new Set<number>();
	// Pre-allocated scratch object for cell styleSlot callbacks — mutated in place before each call
	// to eliminate per-cell object literal allocation during decoration passes.
	// Row class scratch is owned by SelectionPaintManager.
	private readonly _cellClassScratch: GridCellClassParams<TRowData> = {
		row: null as unknown as TRowData,
		rowId: '',
		rowIndex: 0,
		col: null as unknown as ColumnDef<TRowData>,
		colField: '',
		colIndex: 0,
		isFocused: false,
		isRowFocused: false,
		isRowSelected: false,
		isSelected: false,
		isEditing: false,
		value: undefined,
		rawValue: undefined,
		isLoading: false,
		selection: null as unknown,
	} as GridCellClassParams<TRowData>;

	private rowPortalHosts = new WeakMap<HTMLElement, HTMLElement>();
	private readonly runtime: RowRendererRuntimeBridge<TRowData>;
	private readonly pinnedContainers = new PinnedContainerManager<TRowData>();
	private readonly columnTopologyCoordinator = new ColumnTopologyCoordinator<TRowData>();
	private readonly viewportPlanner = new ViewportPlanner<TRowData>();
	/** This frame's ViewportPlan, computed before the bind loop and read by binders/telemetry during
	 *  scroll execution. Null before the first recycleViewport call. */
	public currentViewportPlan: ViewportPlan | null = null;
	/** Per-frame live-mode mount/update budget (see liveFrameBudget.ts), read by
	 *  RowCellBinderDeps.tryConsumeLiveBudget/allowLiveEmergencyShell via stateHost: this. Reset each
	 *  recycleViewport call; reconfigured whenever GridRendererOptions.liveReact may have changed. */
	public readonly liveFrameBudget = new LiveFrameBudget();
	/** Live column-reorder preview source, wired by RenderEngine to the
	 *  ColumnInteractionController. Returns 0 outside an active header drag. */
	public columnShiftSource: ((colIndex: number) => number) | null = null;

	/** Manages row selection paint state, row class building, and row click handling. */
	public readonly selectionPaint: SelectionPaintManager<TRowData>;

	constructor(
		engine: GridEngine<TRowData>,
		geometryController: GeometryController<TRowData>,
		portalMountManager: PortalMountManager<TRowData>,
		cellRenderer: CellRenderer,
		viewportRenderer: ViewportRenderer<TRowData>
	) {
		this.engine = engine;
		this.geometryController = geometryController;
		this.portalMountManager = portalMountManager;
		this.cellRenderer = cellRenderer;
		this.viewportRenderer = viewportRenderer;
		this.selectionPaint = new SelectionPaintManager<TRowData>(engine);
		this.runtime = new RowRendererRuntimeBridge<TRowData>({
			engine: this.engine,
			cellRenderer: this.cellRenderer,
			portalMountManager: this.portalMountManager,
			getViewportContainer: () => this.viewportRenderer.container,
			selectionPaint: this.selectionPaint,
			getFullWidthRenderer: () => this.fullWidthRenderer,
			stateHost: this,
			initCell: (el) => {
				this.cellRenderer.initializeCell(el);
			},
			releaseCellFn: (cell) => {
				if (cell.lastPortalKey) this.runtime.releaseCellPortal(cell.element, false, 'destroyed');
				cell.unbindCold();
			},
			ensurePinnedContainer: (slot, side, width) => this.ensurePinnedContainer(slot, side, width),
			releaseRowPortal: (slot) => this.releaseRowPortal(slot),
			getColumnShift: (colIndex) => (this.columnShiftSource ? this.columnShiftSource(colIndex) : 0),
		});
	}

	public mount(_estRows: number): void {
		this.rowSlotPool = new RowSlotPool<TRowData>(this.viewportRenderer.rowsContainer!);
		this.fullWidthRenderer = new FullWidthRowRenderer<TRowData>(this.portalMountManager, this.rowPortalHosts, this.engine);
	}

	public unmount(): void {
		this.clearActiveRows();
		this.dirtyCellsAfterScroll.clear();
		this.dirtyRowsAfterScroll.clear();
		this.deferredFocusCell = null;
		this.programmaticScrollCell = null;
		this.currentWindow = null;
		this.viewportRenderer.syncActiveDescendant(null);
	}

	public sync(_frame: InvalidationFrame): void {
		// Hook for Orchestrator — intentionally empty
	}

	public clearActiveRows(): void {
		// Release portals for all slots, then destroy the pool.
		for (const slot of this.rowSlotPool?.getSlots() ?? []) {
			this.releaseRowPortal(slot);
			slot.forEachCell((cell) => {
				if (cell.lastPortalKey) this.runtime.releaseCellPortal(cell.element, false, 'destroyed');
			});
		}
		this.rowSlotPool?.destroy();
		// Re-create pool and fullWidthRenderer (mount might not be re-called).
		if (this.viewportRenderer.rowsContainer) {
			this.rowSlotPool = new RowSlotPool<TRowData>(this.viewportRenderer.rowsContainer);
		}
		if (!this.fullWidthRenderer) {
			this.fullWidthRenderer = new FullWidthRowRenderer<TRowData>(this.portalMountManager, this.rowPortalHosts, this.engine);
		}
		this.activeRows.clear();
		this.viewportRenderer.syncActiveDescendant(null);
	}

	/** Binds group rows into slots outside the pool (the sticky header layer) through the cell-row path. */
	public readonly detachedRowBinder: StickyCellRowBinder<TRowData> = {
		bind: (request) => this.runtime.bindAllHierarchyRowCells(request),
		release: (slot) => this.runtime.releaseDetachedSlot(slot),
	};

	// ── Pinned container management ──────────────────────────────────────────────────

	private ensurePinnedContainer(slot: RowSlot<TRowData>, side: 'left' | 'right', width: number): HTMLDivElement | null {
		return this.pinnedContainers.ensure(slot, side, width);
	}

	private rotateViewportSlots(nextWindow: RenderWindow): void {
		const previous = this.currentWindow;
		if (!previous) return;
		if (
			previous.pinTopRows !== nextWindow.pinTopRows ||
			previous.pinBottomRows !== nextWindow.pinBottomRows ||
			previous.rowCount !== nextWindow.rowCount
		) {
			return;
		}

		const previousCenterCount = Math.max(0, previous.rowEnd - previous.rowStart + 1);
		const nextCenterCount = Math.max(0, nextWindow.rowEnd - nextWindow.rowStart + 1);
		if (previousCenterCount !== nextCenterCount || previousCenterCount <= 1) {
			return;
		}

		const delta = nextWindow.rowStart - previous.rowStart;
		if (delta === 0 || Math.abs(delta) >= previousCenterCount) {
			return;
		}

		const topCount = nextWindow.pinTopRows;
		const normalizedRotation = delta > 0 ? delta : previousCenterCount + delta;
		const result = this.rowSlotPool.rotateRange(topCount, previousCenterCount, normalizedRotation);
		if (this.renderStats) {
			this.renderStats.rowSlotMoves += result.moved;
		}
	}

	private getCompiledColumnTopology(
		plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>,
		isScrollFrameActive: boolean
	): CompiledColumnTopology {
		return this.columnTopologyCoordinator.getCompiledTopology(plan, isScrollFrameActive, this.renderStats);
	}

	private getRenderedRowTop(
		rowIndex: number,
		rowTops: ArrayLike<number>,
		scrollTop: number,
		pinTopRows: number,
		rowCount: number,
		pinBottomRows: number,
		viewportHeight: number,
		totalHeight: number
	): number {
		// Pinned rows track scrollTop every frame: snap to device pixels.
		if (rowIndex < pinTopRows) {
			return snapToDevicePixel(rowTops[rowIndex] + scrollTop);
		}
		if (rowIndex >= rowCount - pinBottomRows) {
			return snapToDevicePixel(scrollTop + viewportHeight - (totalHeight - rowTops[rowIndex]));
		}
		return rowTops[rowIndex];
	}

	// ── Slot-based viewport virtualization core ─────────────────────────────────────
	//
	// Row slot contract:
	//   rowSlots[i] always represents viewport position i.
	//   slot[0] → allRows[0], slot[1] → allRows[1], ...
	//   When the render window shifts, slots rebind to new visual rows.
	//   The slot DOM element never moves; only the binding changes.
	//   activeRows (visualIndexToSlot) is maintained incrementally during recycleViewport.

	public recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow): void {
		const state = ctx?.state ?? this.engine.stateManager.getState();
		this.selectionPaint.rebuildSelection(readInteractionState(state).rowSelection.selectedRowIds);
		const nextWindow =
			precomputedWindow ??
			applyRenderWindowRuntimeLimits(computeRenderWindow(this.engine), state.runtimeLimits, () => {
				if (this.renderStats) {
					this.renderStats.runtimeLimitsClamped = (this.renderStats.runtimeLimitsClamped || 0) + 1;
				}
			});

		// ── Same-window bailout ───────────────────────────────────────────────────────
		// If everything is unchanged (rowStart, rowEnd, colStart, colEnd, scroll geometry),
		// skip all row slot binding, cell slot binding, and custom renderer work.
		if (isScrollFrameActive && sameRenderedWindow(this.currentWindow, nextWindow) && sameVisibleContentWindow(this.currentWindow, nextWindow)) {
			this.slotStats.sameWindowBailouts++;
			return;
		}

		// Compute delta — needed for column layout change detection and stats.
		// Uses the reusable scratch delta (valid until the next recycleViewport call).
		const delta = diffRenderWindow(this.currentWindow, nextWindow, this._deltaScratch);

		if (isScrollFrameActive && this.renderStats) {
			this.renderStats.rowsEnteredDuringScroll = (this.renderStats.rowsEnteredDuringScroll || 0) + delta.rowsEntered.length;
			this.renderStats.rowsExitedDuringScroll = (this.renderStats.rowsExitedDuringScroll || 0) + delta.rowsExited.length;
			this.renderStats.rowsStayedDuringScroll = (this.renderStats.rowsStayedDuringScroll || 0) + delta.rowsStayed.length;
			this.renderStats.colsEnteredDuringScroll = (this.renderStats.colsEnteredDuringScroll || 0) + delta.colsEntered.length;
			this.renderStats.colsExitedDuringScroll = (this.renderStats.colsExitedDuringScroll || 0) + delta.colsExited.length;
			this.renderStats.colsStayedDuringScroll = (this.renderStats.colsStayedDuringScroll || 0) + delta.colsStayed.length;
		}

		// Row loading goes through the shared viewport/load contract, never row-model-specific APIs.
		this.engine.getRowModel()?.ensureRange(nextWindow.rowStart, nextWindow.rowEnd, 'viewport-render');
		// Renderer-facing visual row access uses the stable VisualRowModel contract.
		const rowModel = this.engine.getVisualRowModel();

		const plan = ctx?.plan ?? this.engine.columns.getCompiledPlan();
		const columnTopology = this.getCompiledColumnTopology(plan, isScrollFrameActive);
		const columns = plan.displayedColumns;

		// ── Vertical focus/edit row retention ─────────────────────────────────────────
		// Mirrors the existing horizontal focused-column guard (reconcileCellTopologyForScroll) —
		// a focused/editing row must never be virtualized fully out of the row-slot pool.
		const interaction = readInteractionState(state);
		const focusedCellPointer = ctx?.focusedCell ?? interaction.focus.cell;
		const activeEditCell = ctx?.activeEdit ?? interaction.activeEdit.active;
		const focusedRowIndex =
			ctx?.focusedCell || interaction.focus.rowIndex === null || interaction.focus.rowIndex === undefined
				? focusedCellPointer && rowModel
					? rowModel.getVisualIndexByRowId(focusedCellPointer.rowId)
					: undefined
				: interaction.focus.rowIndex;
		const editingRowIndex = activeEditCell && rowModel ? rowModel.getVisualIndexByRowId(activeEditCell.rowId) : undefined;
		const { retainedRowIndices } = computeRowWindowRetention({ renderWindow: nextWindow, focusedRowIndex, editingRowIndex });

		// ── Viewport plan ──────────────────────────────────────────────────────────────
		// Computed before the bind loop so scroll binders operate against an executable live window:
		// live overscan cells are guaranteed to be a subset of the rendered row/column window rather
		// than inferred later by mutating the plan after binding.
		this.currentViewportPlan = this.viewportPlanner.computePlan(
			nextWindow,
			columnTopology,
			retainedRowIndices,
			plan,
			this.engine.rendererOptions
		);
		const columnWindowDelta = this.currentViewportPlan.columnWindowDelta;

		// ── Live-mode frame budget ────────────────────────────────────────────────────
		// rendererOptions is immutable; reconfiguring every frame is redundant but cheap.
		this.liveFrameBudget.configure(this.engine.rendererOptions?.liveReact, this.engine.rendererOptions?.domUpdate);
		this.liveFrameBudget.resetFrame();

		// ── Slot count management ─────────────────────────────────────────────────────
		const sortedRows = getRowIndices(nextWindow, this._rowIndicesScratch, retainedRowIndices);
		const totalSlots = sortedRows.length;

		this.rowSlotPool.resetScrollStats();

		// Pre-evacuate portals for slots being destroyed (only runs when pool shrinks).
		const prevSlotCount = this.rowSlotPool.count;
		if (prevSlotCount > totalSlots) {
			for (let i = totalSlots; i < prevSlotCount; i++) {
				const slot = this.rowSlotPool.getSlot(i);
				if (!slot) continue;
				// Incremental index: remove excess slots before they are destroyed.
				if (slot.visualIndex >= 0) this.activeRows.delete(slot.visualIndex);
				this.releaseRowPortal(slot);
				slot.forEachCell((cell) => {
					if (cell.lastPortalKey) {
						this.runtime.releaseCellPortal(cell.element, undefined, 'scrolled-out');
						cell.lastPortalKey = undefined;
						delete cell.element.dataset['cellKey'];
					}
				});
			}
		}

		this.rowSlotPool.ensureSlotCount(totalSlots, isScrollFrameActive);
		this.rotateViewportSlots(nextWindow);
		const allRows = sortedRows;
		if (this.renderStats) {
			this.renderStats.rowSlotAssigns += allRows.length;
		}

		if (isScrollFrameActive) {
			this.slotStats.rowSlotAppendsTotal += this.rowSlotPool.slotAppendCount;
			this.slotStats.rowSlotRemovesTotal += this.rowSlotPool.slotRemoveCount;
		}

		// ── Column layout constants ───────────────────────────────────────────────────
		const centerColStart = nextWindow.colStart;
		const centerColEnd = nextWindow.colEnd;
		const centerColCount = Math.max(0, centerColEnd - centerColStart + 1);

		// Column instance-id delta — used for full vs partial cell rebind, slot retention, and
		// visible-column refresh decisions. Structural deltas (pin/unpin/reorder) are distinct from
		// routine horizontal window shifts over a stable topology.
		const columnLayoutChanged =
			!!columnWindowDelta &&
			(columnWindowDelta.enteredCenterColumns.length > 0 ||
				columnWindowDelta.exitedCenterColumns.length > 0 ||
				columnWindowDelta.enteredPinnedLeftColumns.length > 0 ||
				columnWindowDelta.exitedPinnedLeftColumns.length > 0 ||
				columnWindowDelta.enteredPinnedRightColumns.length > 0 ||
				columnWindowDelta.exitedPinnedRightColumns.length > 0 ||
				columnWindowDelta.laneMoves.length > 0);

		if (isScrollFrameActive) {
			if (columnLayoutChanged) this.slotStats.fullRebindFrames++;
			else this.slotStats.enteredOnlyFrames++;
		}

		// Hoisted loop-invariant constants — read once before the slot loop, not per row.
		const hoistedTotalHeight = nextWindow.pinBottomRows > 0 ? this.engine.geometry.getTotalHeight(state.defaultRowHeight) : 0;
		const pinTopRows = nextWindow.pinTopRows;
		const pinBottomRows = nextWindow.pinBottomRows;
		const scrollTop = this.engine.viewport.scrollTop;
		const viewportHeight = this.engine.viewport.viewportHeight;
		const rowTops = this.engine.geometry.rowTops;
		const rowHeights = this.engine.geometry.rowHeights;
		const prevVisibleRowStart = this.currentWindow?.visibleRowStart ?? -1;
		const prevVisibleRowEnd = this.currentWindow?.visibleRowEnd ?? -1;
		const prevVisibleColStart = this.currentWindow?.visibleColStart ?? -1;
		const prevVisibleColEnd = this.currentWindow?.visibleColEnd ?? -1;
		const nextVisibleRowStart = nextWindow.visibleRowStart ?? nextWindow.rowStart;
		const nextVisibleRowEnd = nextWindow.visibleRowEnd ?? nextWindow.rowEnd;
		const nextVisibleColStart = nextWindow.visibleColStart ?? nextWindow.colStart;
		const nextVisibleColEnd = nextWindow.visibleColEnd ?? nextWindow.colEnd;
		const visibleColumnsChanged = prevVisibleColStart !== nextVisibleColStart || prevVisibleColEnd !== nextVisibleColEnd;
		// Entered center columns inside the visible band (placement.absoluteIndex is the display index).
		const enteredVisibleCols = this._enteredVisibleColsScratch;
		enteredVisibleCols.clear();
		if (isScrollFrameActive && visibleColumnsChanged) {
			for (const id of columnWindowDelta?.enteredCenterColumns ?? []) {
				const c = columnTopology.byColumnId.get(id)?.absoluteIndex ?? -1;
				if (c >= nextVisibleColStart && c <= nextVisibleColEnd && columns[c]?.instanceId === id) enteredVisibleCols.add(c);
			}
		}
		const refreshVisibleColumns = enteredVisibleCols.size > 0 ? enteredVisibleCols : null;
		const canTrustStableIdentity =
			!!this.currentWindow &&
			(this.currentWindow.rowModelVersion ?? 0) === (nextWindow.rowModelVersion ?? 0) &&
			(this.currentWindow.columnVersion ?? 0) === (nextWindow.columnVersion ?? 0);

		const compiledStyleRules = compileStyleRules(state.styleRules);
		const hasRowClassHook = compiledStyleRules.hasRowRules;
		const hasInsightDecorations = this.engine.insights.size > 0;
		const shouldDeferWarmRowVisualRefresh =
			!!ctx &&
			(ctx.selectionChangedDuringScroll ||
				ctx.loadingChangedDuringScroll ||
				hasInsightDecorations ||
				(hasRowClassHook && ctx.styleChangedDuringScroll));
		const liveOverscanRows = this._liveOverscanRowsScratch;
		liveOverscanRows.clear();
		for (const cell of this.currentViewportPlan.liveCells.overscan) liveOverscanRows.add(cell.rowIndex);

		// ── Slot binding loop ─────────────────────────────────────────────────────────
		// Each slot[i] binds to allRows[i], where slot index is the viewport-position contract.
		// Contiguous scrolling rotates the center slice ahead of time so staying rows keep their
		// physical slot and only true entered/exited rows rebind.
		for (let slotIdx = 0; slotIdx < allRows.length; slotIdx++) {
			const r = allRows[slotIdx];
			const slot = this.rowSlotPool.getSlot(slotIdx);
			if (!slot) continue;

			if (isScrollFrameActive) this.currentScrollRowsVisited++;

			const isPinnedVisibleRow = r < pinTopRows || r >= nextWindow.rowCount - pinBottomRows;
			const isRowVisible = isPinnedVisibleRow || (r >= nextVisibleRowStart && r <= nextVisibleRowEnd);
			const wasPinnedVisibleRow =
				r < pinTopRows || (this.currentWindow ? r >= this.currentWindow.rowCount - this.currentWindow.pinBottomRows : false);
			const wasRowVisible = wasPinnedVisibleRow || (r >= prevVisibleRowStart && r <= prevVisibleRowEnd);
			const rowEnteredVisibleContent = isRowVisible && !wasRowVisible;
			const rowHasLiveOverscanWork = isScrollFrameActive && liveOverscanRows.has(r);
			// A row crossing the visible-content band should not force a cell refresh during
			// active vertical scroll if the row identity and column window stayed stable.
			// Warm slots already retain their text/portal/custom content; post-scroll repaint
			// will reconcile deferred styling and selection state.
			const rowNeedsContentRefresh =
				isScrollFrameActive &&
				(rowEnteredVisibleContent || rowHasLiveOverscanWork || (isRowVisible && !!refreshVisibleColumns && refreshVisibleColumns.size > 0));

			if (
				isScrollFrameActive &&
				canTrustStableIdentity &&
				(!columnLayoutChanged || !isRowVisible) &&
				!rowHasLiveOverscanWork &&
				!rowNeedsContentRefresh &&
				slot.visualIndex === r &&
				slot.rowKind !== '' &&
				slot.rowKind !== 'loading'
			) {
				const top = this.getRenderedRowTop(
					r,
					rowTops,
					scrollTop,
					pinTopRows,
					nextWindow.rowCount,
					pinBottomRows,
					viewportHeight,
					hoistedTotalHeight
				);
				slot.updatePosition(top);
				if (shouldDeferWarmRowVisualRefresh && slot.rowKind === 'data') {
					this.dirtyRowsAfterScroll.add(r);
				}
				continue;
			}

			// Resolve the visual row early — needed for identity-based rebind check.
			let visualRow = rowModel ? rowModel.getVisualRow(r) : null;
			if (!visualRow) {
				const prevUnbind = slot.visualIndex;
				this.releaseRowPortal(slot);
				slot.unbindHot();
				if (prevUnbind >= 0) this.activeRows.delete(prevUnbind);
				continue;
			}

			// Detect slot rebind — slot is transitioning to a different visual row.
			// Check both position index AND row identity: a slot that stays at the same
			// visual index but now holds a different row (e.g. a detail row collapses and
			// the row below slides up to fill its position) must still release its portal.
			const isRowRebind = slot.visualIndex >= 0 && (slot.visualIndex !== r || slot.lastVisualRowId !== visualRow.id);
			if (isRowRebind && this.renderStats) {
				this.renderStats.rowSlotRebinds++;
			}

			// ── Staying-row cheap path ───────────────────────────────────────────────
			// During a scroll frame, a slot keeping its visual row with an unchanged column layout
			// needs only a position refresh: class, cells and portals are still valid. Data/selection/
			// hover changes are gated during scroll and repainted post-scroll. Excluded: loading rows
			// (kind may flip when a block lands).
			if (
				isScrollFrameActive &&
				!isRowRebind &&
				(!columnLayoutChanged || !isRowVisible) &&
				!rowHasLiveOverscanWork &&
				!rowNeedsContentRefresh &&
				slot.visualIndex === r &&
				slot.rowKind !== '' &&
				slot.rowKind !== 'loading'
			) {
				const top = this.getRenderedRowTop(
					r,
					rowTops,
					scrollTop,
					pinTopRows,
					nextWindow.rowCount,
					pinBottomRows,
					viewportHeight,
					hoistedTotalHeight
				);
				slot.updatePosition(top);
				if (shouldDeferWarmRowVisualRefresh && slot.rowKind === 'data') {
					this.dirtyRowsAfterScroll.add(r);
				}
				continue;
			}

			if (isRowRebind) {
				// Release the row portal only (for full-width rows: group/detail/footer content).
				// Cell portals are intentionally NOT pre-evacuated here. Releasing all portals
				// for every rebinding slot would flood the warm cache (size-bounded) with O(allSlots)
				// entries simultaneously, causing warm cache evictions and cold remounts. Instead,
				// each cell's binding code handles its own portal lifecycle: stable slots (same key)
				// are updated in-place via rebindInstance; new slots mount immediately with full content.
				this.releaseRowPortal(slot);
				if (isScrollFrameActive) this.currentScrollRowsRecycled++;
			}

			// ── Position calculation ──────────────────────────────────────────────────
			let rowTop = rowTops[r];
			const rowHeight = rowHeights[r];

			rowTop = this.getRenderedRowTop(
				r,
				rowTops,
				scrollTop,
				pinTopRows,
				nextWindow.rowCount,
				pinBottomRows,
				viewportHeight,
				hoistedTotalHeight
			);

			// ── Row class name ────────────────────────────────────────────────────────
			const rowPresentation = resolveRowPresentation(
				{ engine: this.engine, selectionPaint: this.selectionPaint },
				{
					visualRow,
					rowIndex: r,
					state,
					compiledStyleRules,
					isScrollFrameActive,
					isRowRebind,
					slotLastVisualRowId: slot.lastVisualRowId,
					slotRowKind: slot.rowKind,
					slotLastClassName: slot.lastClassName,
					pinTopRows,
					pinBottomRows,
					rowCount: nextWindow.rowCount,
					shouldDeferWarmRowVisualRefresh,
				}
			);
			const rowClassName = rowPresentation.className;
			if (rowPresentation.markDirtyAfterScroll) this.dirtyRowsAfterScroll.add(r);

			const prevSlotIdx = slot.visualIndex;
			const rowUpdated = slot.update(r, visualRow.id, visualRow.kind as any, rowTop, rowHeight, rowClassName);
			// Incremental index: update map only when the binding changes.
			if (prevSlotIdx !== r) {
				if (prevSlotIdx >= 0) this.activeRows.delete(prevSlotIdx);
				this.activeRows.set(r, slot);
			}
			if (slot.element.style.zIndex !== '') slot.element.style.zIndex = '';
			if (isScrollFrameActive && rowUpdated) this.currentScrollRowsRebound++;

			// ── Bind cells based on row kind ──────────────────────────────────────────
			const lanes = { slot, rowIndex: r, centerColStart, centerColCount, columns, plan, columnTopology, isScrollFrameActive };
			if (visualRow.kind === 'loading') {
				this.releaseRowPortal(slot);
				this.runtime.bindAllLoadingCells(lanes);
			} else if (visualRow.kind === 'data') {
				this.releaseRowPortal(slot);
				this.runtime.bindAllDataCells({
					...lanes,
					node: visualRow.node,
					ctx,
					state,
					isRowRebind,
					forceCellRefresh: rowEnteredVisibleContent,
					isRowVisible,
					refreshVisibleColumns,
					viewportPlan: this.currentViewportPlan,
				});
			} else if ((visualRow.kind === 'group' || visualRow.kind === 'total') && (state.grouping?.display ?? 'column') === 'column') {
				// Group and total rows are cell rows: hierarchy cell + aggregate cells in every lane.
				this.releaseRowPortal(slot);
				this.runtime.bindAllHierarchyRowCells({ ...lanes, row: visualRow, state });
			} else {
				// Full-width row (detail / failed / placeholder; group and total rows in `display: 'row'`)
				this.runtime.bindFullWidthRow(slot, visualRow);
			}
		}

		// Reconcile the incremental index without Map churn; rebuild only if stale keys remain.
		let boundSlots = 0;
		for (const slot of this.rowSlotPool.getSlots()) {
			if (slot.visualIndex < 0) continue;
			boundSlots++;
			if (this.activeRows.get(slot.visualIndex) !== slot) this.activeRows.set(slot.visualIndex, slot);
		}
		if (this.activeRows.size !== boundSlots) {
			this.activeRows.clear();
			for (const slot of this.rowSlotPool.getSlots()) if (slot.visualIndex >= 0) this.activeRows.set(slot.visualIndex, slot);
		}

		this.currentWindow = nextWindow;
		this.syncInteractionAccessibility(state);
	}

	// ── Lane cell binding helpers ────────────────────────────────────────────────────

	// Arrow properties so these can be passed directly as callbacks without wrapping
	// in a new closure on every row bind — the hot path calls these once per lane per row.
	// ── Repaint helpers ──────────────────────────────────────────────────────────────

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		this.runtime.repaintInvalidatedRowsAndCells(frame);
	}

	public repaintInvalidatedRows(frame: InvalidationFrame): void {
		this.runtime.repaintInvalidatedRows(frame);
	}

	public repaintInvalidatedCells(frame: InvalidationFrame): void {
		this.runtime.repaintInvalidatedCells(frame);
	}

	// ── Misc helpers ─────────────────────────────────────────────────────────────────

	private releaseRowPortal(slot: RowSlot<TRowData>): boolean {
		// Delegate to FullWidthRowRenderer which owns the portal host lifecycle.
		// Falls back to direct cleanup if fullWidthRenderer not yet initialized (clearActiveRows on unmount).
		if (this.fullWidthRenderer) {
			return this.fullWidthRenderer.release(slot);
		}
		const rowKey = slot.lastPortalRowKey;
		if (!rowKey) return false;
		const host = this.rowPortalHosts.get(slot.element);
		if (!host) {
			slot.lastPortalRowKey = undefined;
			delete slot.element.dataset.rowKey;
			return false;
		}
		this.portalMountManager.releaseRow({ rowKey, container: host });
		host.hidden = true;
		delete host.dataset.rowKey;
		host.remove();
		slot.lastPortalRowKey = undefined;
		delete slot.element.dataset.rowKey;
		return true;
	}

	// ── Post-scroll decoration ────────────────────────────────────────────────────────

	public decorateDirtyCellsAfterScroll(options?: { maxCells?: number; lane?: 'motion' | 'fidelity' | 'all' }): {
		remaining: number;
		processed: number;
		remainingMotion: number;
		remainingFidelity: number;
	} {
		return this.runtime.decorateDirtyCellsAfterScroll(options);
	}

	public applyFocus(cell: HTMLDivElement): void {
		this.runtime.applyFocus(cell);
	}

	public syncInteractionAccessibility(state?: ReturnType<GridEngine<TRowData>['stateManager']['getState']>): void {
		syncRowRendererInteractionAccessibility({
			engine: this.engine,
			viewportRenderer: this.viewportRenderer,
			activeRows: this.activeRows,
			state: state ?? this.engine.stateManager.getState(),
		});
	}
}
