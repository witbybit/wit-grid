import { type GridIdleDeadline, type GridScheduler } from './gridScheduler.js';
import {
	applyRenderWindowRuntimeLimits,
	computeRenderWindowInto,
	sameRenderedWindow,
	sameVisibleContentWindow,
	type RenderWindow,
} from './renderWindow.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { GridMetric } from '../diagnostics/GridInstrumentation.js';
import { snapToDevicePixel, type GridLayoutPlan } from './layoutPlan.js';
import type { OverlayRenderer } from './overlayRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { FrameCoordinator } from './frameCoordinator.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';
import type { RowRenderer } from './rowRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { HeaderRenderer } from './headerRenderer.js';
import type { FloatingFilterRenderer } from './floatingFilterRenderer.js';
import type { StickyGroupRenderer } from './stickyGroupRenderer.js';
import { isVisualFresh } from './visualFreshness.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { LayoutTransitionController } from './layoutTransitionController.js';
import { compileStyleRules, evaluateCellStyleRules } from '../styling/styleRules.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';
import { normalizeCapabilityResult } from '../capabilities/capabilityTypes.js';
import { collectCellDecorationSnapshotMetadata, createCellDisplaySnapshot, mergeCellSnapshotTitle } from './cellDisplaySnapshot.js';
import type { CanonicalGridCellPointer, GridCellRangeBounds } from '../api/GridApi.js';
import { getColumnInstanceIdentity, type ColumnDef, type ColumnInstanceId } from '../columnDef.js';
import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';
import { readInteractionState } from '../interaction/interactionState.js';
import { asCapableRowModel } from '../rowModel.js';
import type { RowNode } from '../rowNode.js';

/** Headroom left in an idle slice before deadline-aware repair stops starting new batches. */
const POST_SCROLL_DEADLINE_MARGIN_MS = 2;
/** Upper bound on extra deadline-driven batches per idle slice (on top of the fixed-count floor). */
const POST_SCROLL_MAX_EXTRA_BATCHES = 8;

/**
 * Mirrors rowCellBinder's (module-private) applyValueFormatter, with the same params shape, for
 * idle prewarm snapshots of columns that declare a valueFormatter.
 */
function formatPrewarmValue<TRowData>(col: ColumnDef<TRowData>, value: unknown, node: RowNode<TRowData>): string {
	return col.valueFormatter!({ value, rowData: node.data as TRowData, colDef: col, rowId: node.id });
}

function isCellSelected(rowIndex: number, colIndex: number, selectionBounds: GridCellRangeBounds | null | undefined): boolean {
	return (
		!!selectionBounds &&
		rowIndex >= selectionBounds.minRow &&
		rowIndex <= selectionBounds.maxRow &&
		colIndex >= selectionBounds.minCol &&
		colIndex <= selectionBounds.maxCol
	);
}

function isCellFocused<TRowData>(
	rowId: string,
	column: Pick<ColumnDef<TRowData>, 'field'> & { instanceId?: ColumnInstanceId },
	focusedCell: CanonicalGridCellPointer | null | undefined
): boolean {
	return doesCanonicalCellPointerMatchColumn(focusedCell, rowId, column);
}

export interface RenderScrollCoordinatorState<TRowData = unknown> {
	viewportDirtyAfterScroll: boolean;
	flushPendingAfterScroll: boolean;
	needsPostScrollPortalFlush: boolean;
	portalFlushScheduled: boolean;
	prewarmScheduled: boolean;
	prewarmTimer: number | null;
	prewarmRequest: { visibleRowStart: number; visibleRowEnd: number; visibleColStart: number; visibleColEnd: number } | null;
	lastPrewarmRequest: { visibleRowStart: number; visibleRowEnd: number; visibleColStart: number; visibleColEnd: number } | null;
	postScrollDecorationScheduled: boolean;
	postScrollDecorationTimer: number | null;
	/** Monotonic identity for motion callbacks; invalidates a callback that escaped cancellation. */
	postScrollDecorationGeneration: number;
	postScrollFidelityScheduled: boolean;
	postScrollFidelityTimer: number | null;
	/** Monotonic identity for fidelity callbacks; invalidates a callback that escaped cancellation. */
	postScrollFidelityGeneration: number;
	/** scrollEpoch captured when scheduleBudgetedFidelityDecoration was last called. */
	fidelityEpoch: number;
	cachedMaxScrollLeft: number;
	cachedTotalWidth: number;
	cachedTotalHeight: number;
	cachedDefaultRowHeight: number;
	cachedHasSelectionOverlay: boolean;
	scrollCtx: ScrollRenderContext<TRowData>;
	renderWindowBufs: [RenderWindow, RenderWindow];
	activeRenderWindowBufIdx: number;
	portalFlushBudget: number;
	postScrollDecorationBudget: number;
	postScrollFidelityBudget: number;
	scrollPrewarmBudget: number;
	scrollPrewarmRowPadding: number;
	scrollPrewarmColPadding: number;
}

export interface RenderScrollCoordinatorDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	viewportRenderer: ViewportRenderer<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	headerRenderer: HeaderRenderer<TRowData>;
	floatingFilterRenderer: FloatingFilterRenderer<TRowData>;
	overlayRenderer: OverlayRenderer<TRowData>;
	stickyGroupRenderer: StickyGroupRenderer<TRowData>;
	portalMountManager: PortalMountManager<TRowData>;
	frameCoordinator: FrameCoordinator;
	gridScheduler: GridScheduler;
	requestScrollFrame: () => void;
	layoutTransition: LayoutTransitionController<TRowData>;
	renderStats: RenderRuntimeStats;
	runtimeState: RenderRuntimeState;
	recycleViewport: (isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow) => void;
	syncLayoutPlan: (renderWindow?: RenderWindow) => GridLayoutPlan;
}

export class RenderScrollCoordinator<TRowData = unknown> {
	private readonly pendingPaintChangeIds = new Set<number>();
	constructor(
		private readonly deps: RenderScrollCoordinatorDeps<TRowData>,
		private readonly state: RenderScrollCoordinatorState<TRowData>
	) {}

	public getIsScrolling(): boolean {
		return this.deps.runtimeState.isScrolling();
	}

	public getIsScrollFrameActive(): boolean {
		return this.deps.runtimeState.phase === 'scroll-frame';
	}

	public markFlushPendingAfterScroll(changeIds: readonly number[] = []): void {
		this.state.flushPendingAfterScroll = true;
		for (const changeId of changeIds) this.pendingPaintChangeIds.add(changeId);
	}

	public markViewportDirtyAfterScroll(): void {
		this.state.viewportDirtyAfterScroll = true;
	}

	public onScroll = (scrollTop: number, scrollLeft: number, timestamp?: number): void => {
		const clampedScrollLeft = Math.max(0, Math.min(this.state.cachedMaxScrollLeft, scrollLeft));
		if (clampedScrollLeft !== scrollLeft && this.deps.viewportRenderer.scrollViewport) {
			this.deps.viewportRenderer.scrollViewport.scrollLeft = clampedScrollLeft;
		}
		const changed = this.deps.engine.viewport.setScrollPosition(scrollTop, clampedScrollLeft, timestamp);
		if (!changed) return;
		this.markScrolling();
		this.deps.requestScrollFrame();
		// Scroll-end detection is now owned by FrameCoordinator (single RAF loop).
	};

	public updateCachedGeometryBoundsFromState(defaultColWidth: number, defaultRowHeight: number): void {
		this.state.cachedTotalWidth = this.deps.engine.geometry.getTotalWidth(defaultColWidth);
		this.state.cachedTotalHeight = this.deps.engine.geometry.getTotalHeight(defaultRowHeight);
		this.state.cachedDefaultRowHeight = defaultRowHeight ?? 40;
		const viewportWidth = this.deps.engine.viewport.scrollViewportClientWidth || this.deps.engine.viewport.viewportWidth;
		this.state.cachedMaxScrollLeft = Math.max(0, this.state.cachedTotalWidth - viewportWidth);
	}

	public flushScrollFrame = (): void => {
		const scrollViewport = this.deps.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;
		this.deps.viewportRenderer.syncViewportScrollFromDom();

		const state = this.deps.engine.stateManager.getState();
		const interaction = readInteractionState(state);
		this.state.cachedHasSelectionOverlay = !!interaction.cellSelection.selection.bounds && !!this.deps.engine.getRowModel();
		this.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);

		const candidateIdx = 1 - this.state.activeRenderWindowBufIdx;
		const candidateBuf = this.state.renderWindowBufs[candidateIdx];
		computeRenderWindowInto(this.deps.engine, candidateBuf);
		const nextWindow = applyRenderWindowRuntimeLimits(candidateBuf, state.runtimeLimits);
		const layoutPlan = this.deps.syncLayoutPlan(nextWindow);

		if (
			sameRenderedWindow(this.deps.rowRenderer.currentWindow, nextWindow) &&
			sameVisibleContentWindow(this.deps.rowRenderer.currentWindow, nextWindow)
		) {
			const rowModel = this.deps.engine.getRowModel();
			if (asCapableRowModel(rowModel)?.getCapabilities().fullDataset === false && this.deps.engine.viewport.isScrollingFast) {
				this.state.flushPendingAfterScroll = true;
				this.deps.engine.invalidation.invalidateViewport('scroll-idle');
			}
			this.deps.renderStats.scrollFrames++;
			this.deps.renderStats.sameWindowBailouts = (this.deps.renderStats.sameWindowBailouts || 0) + 1;
			// Phase is already scroll-frame (set by FrameCoordinator before calling this callback).
			// FrameCoordinator will transition to post-scroll in the finally block after we return.
			this.syncCheapScrollOnly(layoutPlan);
			return;
		}

		if (nextWindow === candidateBuf) {
			this.state.activeRenderWindowBufIdx = candidateIdx;
		}

		// Phase is already scroll-frame (set by FrameCoordinator before calling this callback).
		this.deps.rowRenderer.currentScrollCellsPatched = 0;
		this.deps.rowRenderer.currentScrollRowsRecycled = 0;
		this.deps.rowRenderer.currentScrollRowsVisited = 0;
		this.deps.rowRenderer.currentScrollRowsRebound = 0;
		this.deps.rowRenderer.currentScrollCellsVisited = 0;
		this.deps.rowRenderer.currentScrollCellsWritten = 0;
		this.deps.rowRenderer.currentScrollPortalOps = 0;
		this.deps.renderStats.scrollFrames++;
		const startStateReads = this.deps.engine.instrumentation.get(GridMetric.STATE_READS);
		try {
			const plan = this.deps.engine.columns.getCompiledPlan();
			const scrollCtx = this.state.scrollCtx;
			scrollCtx.state = state;
			scrollCtx.rowVersions = this.deps.engine.rowVersions;
			scrollCtx.globalVersion = state.globalVersion;
			scrollCtx.insightVersion = this.deps.engine.insights.getVersion();
			scrollCtx.styleVersion = this.deps.rowRenderer.styleVersion;
			scrollCtx.loadingVersion = this.deps.rowRenderer.loadingVersion;
			scrollCtx.selectionVersion = this.deps.engine.selectionVersion;
			scrollCtx.styleChangedDuringScroll = this.deps.rowRenderer.styleVersion !== this.deps.rowRenderer.scrollStartStyleVersion;
			scrollCtx.loadingChangedDuringScroll = this.deps.rowRenderer.loadingVersion !== this.deps.rowRenderer.scrollStartLoadingVersion;
			scrollCtx.selectionChangedDuringScroll = this.deps.engine.selectionVersion !== this.deps.rowRenderer.scrollStartSelectionVersion;
			scrollCtx.globalChangedDuringScroll = state.globalVersion !== this.deps.rowRenderer.scrollStartGlobalVersion;
			scrollCtx.activeEdit = interaction.activeEdit.active;
			scrollCtx.hasDeferredCellStyleRules = compileStyleRules(state.styleRules).hasCellRules;
			scrollCtx.hasCustomRenderers = plan.hasCustomRenderers;
			scrollCtx.hasInsightDecorations = this.deps.engine.insights.size > 0;
			scrollCtx.plan = plan;
			scrollCtx.visibleRowRange.startIdx = nextWindow.visibleRowStart ?? nextWindow.rowStart;
			scrollCtx.visibleRowRange.endIdx = nextWindow.visibleRowEnd ?? nextWindow.rowEnd;
			scrollCtx.visibleColRange.startIdx = nextWindow.visibleColStart ?? nextWindow.colStart;
			scrollCtx.visibleColRange.endIdx = nextWindow.visibleColEnd ?? nextWindow.colEnd;
			const visibleColRange = scrollCtx.visibleColRange;
			scrollCtx.focusedCell = interaction.focus.cell;
			scrollCtx.selectionBounds = interaction.cellSelection.selection.bounds ?? undefined;

			this.deps.recycleViewport(true, scrollCtx, nextWindow);
			this.scheduleApproachBandPrewarm(nextWindow);
			this.deps.stickyGroupRenderer.sync(layoutPlan);

			this.deps.floatingFilterRenderer.syncScrollLeft(layoutPlan);
			const didSyncRange = this.deps.headerRenderer.syncVisibleColumnRange(layoutPlan, visibleColRange);
			if (didSyncRange) {
				this.deps.renderStats.headerRangeSyncsDuringScroll++;
			}
			this.deps.renderStats.overlayCheapSyncsDuringScroll++;
			this.deps.overlayRenderer.syncScrollPosition(this.state.cachedHasSelectionOverlay);
		} finally {
			const stateReadsInFrame = this.deps.engine.instrumentation.get(GridMetric.STATE_READS) - startStateReads;
			this.deps.renderStats.stateReadsDuringScroll += stateReadsInFrame;
			if (this.deps.renderStats.cellsPatchedPerScrollFrame.length >= 1024) {
				this.deps.renderStats.cellsPatchedPerScrollFrame.length = 0;
			}
			if (this.deps.renderStats.rowsRecycledPerScrollFrame.length >= 1024) {
				this.deps.renderStats.rowsRecycledPerScrollFrame.length = 0;
			}
			this.deps.renderStats.cellsPatchedPerScrollFrame.push(this.deps.rowRenderer.currentScrollCellsPatched);
			this.deps.renderStats.rowsRecycledPerScrollFrame.push(this.deps.rowRenderer.currentScrollRowsRecycled);
			// FrameCoordinator transitions to post-scroll in its finally block after this callback returns.
		}
	};

	public markScrolling(): void {
		const wasScrolling = this.deps.runtimeState.isScrolling();
		const phase = this.deps.runtimeState.phase;
		if (!wasScrolling) {
			const state = this.deps.engine.stateManager.getState();
			this.deps.rowRenderer.scrollStartStyleVersion = this.deps.rowRenderer.styleVersion;
			this.deps.rowRenderer.scrollStartLoadingVersion = this.deps.rowRenderer.loadingVersion;
			this.deps.rowRenderer.scrollStartSelectionVersion = this.deps.engine.selectionVersion;
			this.deps.rowRenderer.scrollStartGlobalVersion = state.globalVersion;
			this.deps.viewportRenderer.setScrollingClass(true);
			this.deps.runtimeState.transitionTo('scroll-pending');
		} else if (phase === 'post-scroll') {
			// New scroll event during post-scroll window: re-enter scroll-pending (increments scrollEpoch).
			const state = this.deps.engine.stateManager.getState();
			this.deps.rowRenderer.scrollStartStyleVersion = this.deps.rowRenderer.styleVersion;
			this.deps.rowRenderer.scrollStartLoadingVersion = this.deps.rowRenderer.loadingVersion;
			this.deps.rowRenderer.scrollStartSelectionVersion = this.deps.engine.selectionVersion;
			this.deps.rowRenderer.scrollStartGlobalVersion = state.globalVersion;
			this.deps.runtimeState.transitionTo('scroll-pending');
		}
		this.clearPostScrollDecorationTimer();
		this.deps.layoutTransition.cancel();
		this.deps.rowRenderer.hoveredRowIndex = null;
	}

	public finishScrolling(): void {
		// FrameCoordinator has already transitioned to idle before calling this.
		this.deps.viewportRenderer.setScrollingClass(false);
		this.deps.rowRenderer.programmaticScrollCell = null;
		this.state.needsPostScrollPortalFlush = this.state.needsPostScrollPortalFlush || this.deps.portalMountManager.getDeferredCount() > 0;
		if (this.state.needsPostScrollPortalFlush) {
			this.scheduleBudgetedPortalFlush();
		}
		this.restoreDeferredFocus();
		if (this.state.flushPendingAfterScroll) {
			this.state.flushPendingAfterScroll = false;
			const changeIds = [...this.pendingPaintChangeIds];
			this.pendingPaintChangeIds.clear();
			this.deps.frameCoordinator.requestPostScrollWork(changeIds);
		}
		if (
			this.state.viewportDirtyAfterScroll ||
			this.deps.rowRenderer.dirtyCellsAfterScroll.size > 0 ||
			this.deps.rowRenderer.dirtyRowsAfterScroll.size > 0
		) {
			this.state.viewportDirtyAfterScroll = false;
			this.scheduleBudgetedDecoration();
		}
		if (this.deps.overlayRenderer.overlayDirtyDuringScroll) {
			this.deps.overlayRenderer.overlayDirtyDuringScroll = false;
			this.deps.overlayRenderer.repaintOverlay();
		}
	}

	public scheduleBudgetedPortalFlush(): void {
		if (this.state.portalFlushScheduled) return;
		this.state.portalFlushScheduled = true;
		this.deps.gridScheduler.idle((deadline) => {
			this.state.portalFlushScheduled = false;
			if (this.deps.runtimeState.isScrolling()) {
				this.state.needsPostScrollPortalFlush = true;
				return;
			}
			const result = this.deps.portalMountManager.flushDeferred({
				maxItems: this.state.portalFlushBudget,
				reason: 'scroll-idle',
				flushSync: false,
				deadline,
			});
			this.state.needsPostScrollPortalFlush = result.remaining > 0;
			if (result.remaining > 0) {
				this.scheduleBudgetedPortalFlush();
			}
		});
	}

	public clearPostScrollDecorationTimer(): void {
		// `cancelIdle` is advisory in some host shims. Advance both generations so a
		// callback that has already escaped cancellation cannot mutate current-epoch state.
		this.state.postScrollDecorationGeneration++;
		this.state.postScrollFidelityGeneration++;
		if (this.state.postScrollDecorationTimer !== null) {
			this.deps.gridScheduler.cancelIdle(this.state.postScrollDecorationTimer);
			this.state.postScrollDecorationTimer = null;
		}
		this.state.postScrollDecorationScheduled = false;
		if (this.state.postScrollFidelityTimer !== null) {
			this.deps.gridScheduler.cancelIdle(this.state.postScrollFidelityTimer);
			this.state.postScrollFidelityTimer = null;
		}
		this.state.postScrollFidelityScheduled = false;
	}

	private scheduleApproachBandPrewarm(nextWindow: RenderWindow): void {
		if (!this.deps.gridScheduler.supportsIdle()) return;
		this.state.prewarmRequest = {
			visibleRowStart: nextWindow.visibleRowStart ?? nextWindow.rowStart,
			visibleRowEnd: nextWindow.visibleRowEnd ?? nextWindow.rowEnd,
			visibleColStart: nextWindow.visibleColStart ?? nextWindow.colStart,
			visibleColEnd: nextWindow.visibleColEnd ?? nextWindow.colEnd,
		};
		if (this.state.prewarmScheduled) return;
		this.state.prewarmScheduled = true;
		this.state.prewarmTimer = this.deps.gridScheduler.idle((deadline) => {
			this.state.prewarmTimer = null;
			this.state.prewarmScheduled = false;
			this.deps.renderStats.prewarmPasses++;
			this.runApproachBandPrewarm(deadline);
		});
	}

	private runApproachBandPrewarm(deadline?: { timeRemaining(): number }): void {
		const request = this.state.prewarmRequest;
		if (!request) return;
		const rowModel = this.deps.engine.getVisualRowModel();
		if (!rowModel) return;
		const state = this.deps.engine.stateManager.getState();
		const interaction = readInteractionState(state);
		const compiledPlan = this.deps.engine.columns.getCompiledPlan();
		const focusedCell = interaction.focus.cell;
		const selectionBounds = interaction.cellSelection.selection.bounds;
		const compiledStyleRules = compileStyleRules(state.styleRules);

		const columns = this.deps.engine.columns.getDisplayedColumns();
		const rowCount = rowModel.getVisualRowCount();
		const colCount = columns.length;
		if (rowCount === 0 || colCount === 0) return;

		// Bias the prewarm ring toward the direction of travel so fast scroll arrives at
		// prewarmed snapshots. The leading edge gets 2× the base padding; the trailing edge gets 1×.
		const base = this.state.scrollPrewarmRowPadding;
		const baseCol = this.state.scrollPrewarmColPadding;
		const prev = this.state.lastPrewarmRequest;
		const rowDelta = prev ? request.visibleRowStart - prev.visibleRowStart : 0;
		const colDelta = prev ? request.visibleColStart - prev.visibleColStart : 0;
		const rowBefore = rowDelta > 0 ? base : rowDelta < 0 ? base * 2 : base;
		const rowAfter = rowDelta > 0 ? base * 2 : rowDelta < 0 ? base : base;
		const colBefore = colDelta > 0 ? baseCol : colDelta < 0 ? baseCol * 2 : baseCol;
		const colAfter = colDelta > 0 ? baseCol * 2 : colDelta < 0 ? baseCol : baseCol;
		this.state.lastPrewarmRequest = { ...request };

		const leftColStart = Math.max(0, request.visibleColStart - colBefore);
		const leftColEnd = Math.max(-1, request.visibleColStart - 1);
		const rightColStart = Math.min(colCount, request.visibleColEnd + 1);
		const rightColEnd = Math.min(colCount - 1, request.visibleColEnd + colAfter);
		const topRowStart = Math.max(0, request.visibleRowStart - rowBefore);
		const topRowEnd = Math.max(-1, request.visibleRowStart - 1);
		const bottomRowStart = Math.min(rowCount, request.visibleRowEnd + 1);
		const bottomRowEnd = Math.min(rowCount - 1, request.visibleRowEnd + rowAfter);

		let workDone = 0;
		const budget = this.state.scrollPrewarmBudget;
		const canContinue = (): boolean => {
			if (workDone >= budget) return false;
			if (!deadline) return true;
			return workDone === 0 || deadline.timeRemaining() > 1;
		};
		const recordWork = (): void => {
			workDone++;
		};
		const hasFreshSnapshot = (rowId: string, colField: string): boolean => {
			const snapshot = this.deps.engine.getCellDisplaySnapshot(rowId, colField);
			return isVisualFresh(snapshot, {
				rowVersion: this.deps.engine.rowVersions.get(rowId) ?? -1,
				globalVersion: state.globalVersion,
				insightVersion: this.deps.engine.insights.getVersion(),
				styleVersion: this.deps.rowRenderer.styleVersion,
				loadingVersion: this.deps.rowRenderer.loadingVersion,
				selectionVersion: this.deps.engine.selectionVersion,
			});
		};
		const visitApproachBand = (visit: (rowIndex: number, colIndex: number) => boolean): void => {
			for (let row = request.visibleRowStart; row <= request.visibleRowEnd && canContinue(); row++) {
				for (let col = leftColStart; col <= leftColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
				for (let col = rightColStart; col <= rightColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}

			for (let row = topRowStart; row <= topRowEnd && canContinue(); row++) {
				for (let col = request.visibleColStart; col <= request.visibleColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}

			for (let row = bottomRowStart; row <= bottomRowEnd && canContinue(); row++) {
				for (let col = request.visibleColStart; col <= request.visibleColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}

			// Corner cells: approach rows × approach columns — needed for diagonal scroll entry.
			for (let row = topRowStart; row <= topRowEnd && canContinue(); row++) {
				for (let col = leftColStart; col <= leftColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
				for (let col = rightColStart; col <= rightColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}
			for (let row = bottomRowStart; row <= bottomRowEnd && canContinue(); row++) {
				for (let col = leftColStart; col <= leftColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
				for (let col = rightColStart; col <= rightColEnd && canContinue(); col++) {
					if (!visit(row, col)) return;
				}
			}
		};

		visitApproachBand((rowIndex, colIndex) => {
			if (!canContinue()) return false;
			const visualRow = rowModel.getVisualRow(rowIndex);
			if (visualRow?.kind !== 'data') return true;
			const col = columns[colIndex];
			if (!col) return true;
			const isImpostorEligible = compiledPlan.columnPlans[colIndex]?.mode === 'custom';
			const rowId = visualRow.node.id;
			if (hasFreshSnapshot(rowId, col.field)) return true;
			const rawValue = col.valueGetter ? undefined : this.deps.engine.getRawCellValue(rowId, col.field);
			const shouldPrimeFormula = typeof rawValue === 'string' && rawValue.startsWith('=');
			const hasRegisteredFormula = this.deps.engine.hasFormula(rowId, col.field);
			const shouldPrimeDisplayValue = col.valueGetter || shouldPrimeFormula || hasRegisteredFormula || isImpostorEligible;
			const cellDecorations = this.deps.engine.insights.getCellDecorations(rowId, col.field);
			const isFocused = isCellFocused(rowId, col, focusedCell);
			const isSelected = isCellSelected(rowIndex, colIndex, selectionBounds);
			const needsReadonlyEvaluation = col.canEdit !== undefined && visualRow.node.data !== null;
			const needsTooltipSnapshot = col.tooltip !== undefined && visualRow.node.data !== null;
			const needsStyleSnapshot = compiledStyleRules.hasCellRules && visualRow.node.data !== null;
			const cachedValue = this.deps.engine.getCachedDisplayValue(rowId, col.field);
			const primedValue = shouldPrimeDisplayValue
				? (col.valueGetter || hasRegisteredFormula) && cachedValue !== undefined
					? cachedValue
					: this.deps.engine.primeDisplayValue(rowId, col.field)
				: undefined;
			const displayValue = primedValue ?? cachedValue ?? this.deps.engine.getCheapDisplayValue(rowId, col.field);
			if (shouldPrimeDisplayValue && primedValue !== undefined) {
				this.deps.renderStats.prewarmedDisplayValues++;
			}
			recordWork();
			const decorationMetadata = collectCellDecorationSnapshotMetadata(cellDecorations);
			let stateClassName = '';
			if (isFocused) {
				stateClassName += stateClassName ? ' og-cell-focused' : 'og-cell-focused';
			}
			if (isSelected) {
				stateClassName += stateClassName ? ' og-cell-selected' : 'og-cell-selected';
			}
			if (needsReadonlyEvaluation) {
				const isEditable = normalizeCapabilityResult(
					col.canEdit!({ action: 'edit', row: visualRow.node.data, rowId, colField: col.field })
				).allowed;
				if (!isEditable) {
					stateClassName += stateClassName ? ' og-cell-readonly' : 'og-cell-readonly';
				}
			}
			if (needsStyleSnapshot) {
				const styleScratch = this.deps.rowRenderer.cellClassScratch;
				styleScratch.row = visualRow.node.data;
				styleScratch.rowId = rowId;
				styleScratch.rowIndex = rowIndex;
				styleScratch.col = col;
				styleScratch.colField = col.field;
				styleScratch.colIndex = colIndex;
				styleScratch.isFocused = isFocused;
				styleScratch.isRowFocused = focusedCell?.rowId === rowId;
				styleScratch.isRowSelected = isSelected;
				styleScratch.isSelected = isSelected;
				styleScratch.isEditing = false;
				styleScratch.value = displayValue;
				styleScratch.rawValue = rawValue ?? displayValue;
				styleScratch.isLoading = false;
				styleScratch.selection = interaction.cellSelection.selection;
				const customCellClass = evaluateCellStyleRules(compiledStyleRules, col, visualRow.node.data, styleScratch);
				if (customCellClass) stateClassName += stateClassName ? ` ${customCellClass}` : customCellClass;
			}
			const tooltipText =
				col.tooltip !== undefined && visualRow.node.data !== null
					? typeof col.tooltip === 'string'
						? col.tooltip
						: col.tooltip({
								row: visualRow.node.data,
								rowId,
								colField: col.field,
								value: rawValue ?? displayValue,
							})
					: null;
			// The snapshot's text is painted verbatim during scroll, so it must be the formatted text a
			// full bind would store — otherwise formatted columns flash raw values ("1234.5") until
			// post-scroll repair lands ("$1,234.50"). Plain fields format the raw value (the idle full
			// bind path); getter/formula fields format the cached display value (the scroll bind path).
			// A getter/formula value that is not cached yet stays unformatted, as in the scroll bind path.
			const formatterInput = shouldPrimeDisplayValue ? (primedValue ?? cachedValue) : rawValue;
			const snapshotText =
				col.valueFormatter && !isImpostorEligible && visualRow.node.data !== null && (!shouldPrimeDisplayValue || formatterInput !== undefined)
					? formatPrewarmValue(col, formatterInput, visualRow.node)
					: displayValue;
			const snapshotContentKind = isImpostorEligible && snapshotText !== '' ? 'impostor' : snapshotText !== '' ? 'text' : 'empty';
			const snapshotContentMode = isImpostorEligible && snapshotText !== '' ? 'fallback' : snapshotText !== '' ? 'text' : 'empty';
			this.deps.engine.cellDisplaySnapshots.set(
				createCellDisplaySnapshot({
					rowId,
					columnInstanceId: getColumnInstanceIdentity(col),
					colField: col.field,
					rowVersion: this.deps.engine.rowVersions.get(rowId) ?? -1,
					globalVersion: state.globalVersion,
					insightVersion: this.deps.engine.insights.getVersion(),
					styleVersion: this.deps.rowRenderer.styleVersion,
					loadingVersion: this.deps.rowRenderer.loadingVersion,
					selectionVersion: this.deps.engine.selectionVersion,
					baseClassName: 'og-cell',
					stateClassName,
					decorationClassName: decorationMetadata.classNameSuffix,
					contentKind: snapshotContentKind,
					contentMode: snapshotContentMode,
					formattedValue: snapshotText,
					title: mergeCellSnapshotTitle(tooltipText, decorationMetadata.insightTitle),
					validationError: decorationMetadata.validationError,
				})
			);
			this.deps.renderStats.prewarmedCellSnapshots++;
			return canContinue();
		});

		if (workDone >= budget && !this.state.prewarmScheduled && this.deps.gridScheduler.supportsIdle()) {
			this.state.prewarmScheduled = true;
			this.state.prewarmTimer = this.deps.gridScheduler.idle((nextDeadline) => {
				this.state.prewarmTimer = null;
				this.state.prewarmScheduled = false;
				this.deps.renderStats.prewarmPasses++;
				this.runApproachBandPrewarm(nextDeadline);
			});
		}
	}

	/**
	 * Runs one lane of post-scroll repair inside an idle slice. The configured budget is the floor:
	 * one batch always runs, exactly as before. When the scheduler hands us a real idle deadline
	 * (not a timeout-forced run), further batches run while the slice still has time left, so a
	 * quiet page settles in far fewer idle round-trips while a busy one keeps the fixed cap.
	 */
	private decorateLaneWithinDeadline(
		lane: 'motion' | 'fidelity',
		budget: number,
		deadline?: GridIdleDeadline
	): { remaining: number; processed: number; remainingMotion: number; remainingFidelity: number } {
		this.deps.portalMountManager.beginCellReleaseTransaction();
		try {
			let result = this.deps.rowRenderer.decorateDirtyCellsAfterScroll({ maxCells: budget, lane });
			let processed = result.processed;
			let laneRemaining = lane === 'motion' ? result.remainingMotion : result.remainingFidelity;
			// Bounded: at most POST_SCROLL_MAX_EXTRA_BATCHES extra batches, and only while the lane's
			// backlog strictly shrinks (a bind that re-dirties cells must not spin the slice).
			for (
				let extra = 0;
				extra < POST_SCROLL_MAX_EXTRA_BATCHES &&
				deadline &&
				!deadline.didTimeout &&
				result.processed > 0 &&
				laneRemaining > 0 &&
				deadline.timeRemaining() > POST_SCROLL_DEADLINE_MARGIN_MS;
				extra++
			) {
				result = this.deps.rowRenderer.decorateDirtyCellsAfterScroll({ maxCells: budget, lane });
				processed += result.processed;
				const nextRemaining = lane === 'motion' ? result.remainingMotion : result.remainingFidelity;
				if (nextRemaining >= laneRemaining) break;
				laneRemaining = nextRemaining;
			}
			return processed === result.processed ? result : { ...result, processed };
		} finally {
			this.deps.portalMountManager.endCellReleaseTransaction();
		}
	}

	public scheduleBudgetedDecoration(): void {
		if (this.state.postScrollDecorationScheduled) return;
		this.state.postScrollDecorationScheduled = true;
		const generation = ++this.state.postScrollDecorationGeneration;
		const scrollEpoch = this.deps.runtimeState.scrollEpoch;
		this.state.postScrollDecorationTimer = this.deps.gridScheduler.idle((deadline) => {
			if (this.state.postScrollDecorationGeneration !== generation || !this.deps.runtimeState.isScrollEpochCurrent(scrollEpoch)) {
				return;
			}
			this.state.postScrollDecorationTimer = null;
			this.state.postScrollDecorationScheduled = false;
			if (!this.deps.runtimeState.canRunDecoration()) {
				return;
			}
			this.deps.renderStats.postScrollDecorationChunks++;
			this.deps.renderStats.postScrollMotionChunks++;
			const result = this.decorateLaneWithinDeadline('motion', this.state.postScrollDecorationBudget, deadline);
			if (result.processed > this.deps.renderStats.maxCellsDecoratedInOneChunk) {
				this.deps.renderStats.maxCellsDecoratedInOneChunk = result.processed;
			}
			if (result.processed > this.deps.renderStats.maxMotionCellsDecoratedInOneChunk) {
				this.deps.renderStats.maxMotionCellsDecoratedInOneChunk = result.processed;
			}
			this.deps.renderStats.cellsDecoratedAfterScroll += result.processed;
			this.deps.renderStats.motionCellsDecoratedAfterScroll += result.processed;
			if (result.remainingMotion > 0) {
				this.scheduleBudgetedDecoration();
				return;
			}
			if (result.remainingFidelity > 0) {
				// Run the first fidelity batch in this same idle slice so visible rich cells
				// do not remain as impostors for an extra idle-to-idle gap.
				this.deps.renderStats.postScrollDecorationChunks++;
				this.deps.renderStats.postScrollFidelityChunks++;
				const fidelityResult = this.decorateLaneWithinDeadline('fidelity', this.state.postScrollFidelityBudget, deadline);
				if (fidelityResult.processed > this.deps.renderStats.maxCellsDecoratedInOneChunk) {
					this.deps.renderStats.maxCellsDecoratedInOneChunk = fidelityResult.processed;
				}
				if (fidelityResult.processed > this.deps.renderStats.maxFidelityCellsDecoratedInOneChunk) {
					this.deps.renderStats.maxFidelityCellsDecoratedInOneChunk = fidelityResult.processed;
				}
				this.deps.renderStats.cellsDecoratedAfterScroll += fidelityResult.processed;
				this.deps.renderStats.fidelityCellsDecoratedAfterScroll += fidelityResult.processed;
				if (fidelityResult.remainingFidelity > 0) {
					this.scheduleBudgetedFidelityDecoration();
				}
			}
		});
	}

	public scheduleBudgetedFidelityDecoration(): void {
		if (this.state.postScrollFidelityScheduled) return;
		this.state.postScrollFidelityScheduled = true;
		const generation = ++this.state.postScrollFidelityGeneration;
		const scrollEpoch = this.deps.runtimeState.scrollEpoch;
		this.state.fidelityEpoch = scrollEpoch;
		this.state.postScrollFidelityTimer = this.deps.gridScheduler.idle((deadline) => {
			if (this.state.postScrollFidelityGeneration !== generation || !this.deps.runtimeState.isScrollEpochCurrent(scrollEpoch)) {
				return;
			}
			this.state.postScrollFidelityTimer = null;
			this.state.postScrollFidelityScheduled = false;
			if (!this.deps.runtimeState.canRunDecoration()) {
				// finishScrolling() owns the fresh-epoch reschedule; retaining the dirty set
				// here prevents stale work from racing the next gesture.
				return;
			}
			this.deps.renderStats.postScrollDecorationChunks++;
			this.deps.renderStats.postScrollFidelityChunks++;
			const result = this.decorateLaneWithinDeadline('fidelity', this.state.postScrollFidelityBudget, deadline);
			if (result.processed > this.deps.renderStats.maxCellsDecoratedInOneChunk) {
				this.deps.renderStats.maxCellsDecoratedInOneChunk = result.processed;
			}
			if (result.processed > this.deps.renderStats.maxFidelityCellsDecoratedInOneChunk) {
				this.deps.renderStats.maxFidelityCellsDecoratedInOneChunk = result.processed;
			}
			this.deps.renderStats.cellsDecoratedAfterScroll += result.processed;
			this.deps.renderStats.fidelityCellsDecoratedAfterScroll += result.processed;
			if (result.remainingFidelity > 0) {
				this.scheduleBudgetedFidelityDecoration();
			}
		});
	}

	public restoreDeferredFocus(): void {
		const cell = this.deps.rowRenderer.deferredFocusCell;
		this.deps.rowRenderer.deferredFocusCell = null;
		if (!cell || !cell.isConnected) return;
		this.deps.rowRenderer.applyFocus(cell);
	}

	public syncCheapScrollOnly(layoutPlan: GridLayoutPlan): void {
		const window = layoutPlan.renderWindow;
		const scrollTop = layoutPlan.viewport.scrollTop;
		const scrollLeft = layoutPlan.viewport.scrollLeft;

		this.deps.floatingFilterRenderer.syncScrollLeft(layoutPlan);
		this.deps.renderStats.overlayCheapSyncsDuringScroll++;
		this.deps.overlayRenderer.syncScrollPosition(this.state.cachedHasSelectionOverlay);

		const pinTopRows = window.pinTopRows;
		const pinBottomRows = window.pinBottomRows;
		if (pinTopRows > 0 || pinBottomRows > 0) {
			const viewportHeight = this.deps.engine.viewport.viewportHeight;
			const totalHeight = this.state.cachedTotalHeight;
			const rowTops = this.deps.engine.geometry.rowTops;

			for (let r = 0; r < pinTopRows && r < window.rowCount; r++) {
				const slot = this.deps.rowRenderer.activeRows.get(r);
				if (slot) {
					slot.updatePosition(snapToDevicePixel(rowTops[r] + scrollTop));
				}
			}

			for (let r = window.rowCount - pinBottomRows; r < window.rowCount; r++) {
				if (r >= pinTopRows) {
					const slot = this.deps.rowRenderer.activeRows.get(r);
					if (slot) {
						slot.updatePosition(snapToDevicePixel(scrollTop + viewportHeight - (totalHeight - rowTops[r])));
					}
				}
			}
		}

		this.deps.stickyGroupRenderer.sync(layoutPlan);
		if (this.deps.rowRenderer.currentWindow) {
			this.deps.rowRenderer.currentWindow.scrollTop = scrollTop;
			this.deps.rowRenderer.currentWindow.scrollLeft = scrollLeft;
		}
	}
}
