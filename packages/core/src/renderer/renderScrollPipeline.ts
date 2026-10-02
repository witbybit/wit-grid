import { type GridIdleDeadline, type GridScheduler } from './gridScheduler.js';
import {
	applyRenderWindowRuntimeLimits,
	computeRenderWindowInto,
	createEmptyRenderWindow,
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

import type { ViewportRenderer } from './viewportRenderer.js';
import type { LayoutTransitionController } from './layoutTransitionController.js';
import { compileStyleRules } from '../styling/styleRules.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';

import { readInteractionState } from '../interaction/interactionState.js';
import { asCapableRowModel } from '../rowModel.js';

import { ApproachBandPrewarmer, type ApproachBandPrewarmerOptions } from './approachBandPrewarm.js';
import type { PaintViewportLayout } from './renderPaintPipeline.js';

/** Headroom left in an idle slice before deadline-aware repair stops starting new batches. */
const POST_SCROLL_DEADLINE_MARGIN_MS = 2;
/** Upper bound on extra deadline-driven batches per idle slice (on top of the fixed-count floor). */
const POST_SCROLL_MAX_EXTRA_BATCHES = 8;

export interface RenderScrollPipelineDeps<TRowData = unknown> {
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
	viewportLayout: PaintViewportLayout<TRowData>;
}

export interface RenderScrollPipelineOptions {
	/** Deferred portal mounts flushed per idle slice after scroll. */
	portalFlushBudget?: number;
	/** Cells repaired per idle batch in the motion (text/decoration) lane. */
	postScrollDecorationBudget?: number;
	/** Cells repaired per idle batch in the fidelity (rich renderer) lane. */
	postScrollFidelityBudget?: number;
	prewarm?: ApproachBandPrewarmerOptions;
}

/**
 * The scroll lane, end to end: scroll input (clamping, opening a scroll session), the scroll
 * frame (render window, row recycling, the cheap same-window path), and the scroll session's
 * idle follow-up once it settles (deferred portal mounts, the motion and fidelity repair lanes,
 * deferred focus). Paint frames are the paint pipeline's; frame timing is the FrameCoordinator's.
 */
export class RenderScrollPipeline<TRowData = unknown> {
	private readonly pendingPaintChangeIds = new Set<number>();
	private viewportDirtyAfterScroll = false;
	private flushPendingAfterScroll = false;
	private needsPostScrollPortalFlush = false;
	private portalFlushScheduled = false;
	private postScrollDecorationScheduled = false;
	private postScrollDecorationTimer: number | null = null;
	/** Monotonic identity for motion callbacks; invalidates a callback that escaped cancellation. */
	private postScrollDecorationGeneration = 0;
	private postScrollFidelityScheduled = false;
	private postScrollFidelityTimer: number | null = null;
	/** Monotonic identity for fidelity callbacks; invalidates a callback that escaped cancellation. */
	private postScrollFidelityGeneration = 0;
	/** scrollEpoch captured when scheduleBudgetedFidelityDecoration was last called. */
	private fidelityEpoch = 0;

	// Cached geometry so the raw DOM scroll handler (120/sec on high-refresh displays) and the
	// same-window fast path never need to call getState() or geometry.
	private cachedMaxScrollLeft = 0;
	private cachedTotalWidth = 0;
	private cachedTotalHeight = 0;
	private cachedDefaultRowHeight = 40;
	private cachedHasSelectionOverlay = false;

	/** Reused and updated in place each scroll frame (no per-frame allocation). */
	private readonly scrollCtx: ScrollRenderContext<TRowData>;
	/**
	 * Double-buffered render window, alternated each frame to avoid per-frame allocation.
	 * activeRenderWindowBufIdx points at the buffer stored as the row renderer's currentWindow;
	 * the candidate (next) window is always computed into the other one.
	 */
	private readonly renderWindowBufs: [RenderWindow, RenderWindow] = [createEmptyRenderWindow(), createEmptyRenderWindow()];
	private activeRenderWindowBufIdx = 0;

	private readonly portalFlushBudget: number;
	private readonly postScrollDecorationBudget: number;
	private readonly postScrollFidelityBudget: number;
	private readonly prewarmer: ApproachBandPrewarmer<TRowData>;

	constructor(
		private readonly deps: RenderScrollPipelineDeps<TRowData>,
		options: RenderScrollPipelineOptions = {}
	) {
		this.portalFlushBudget = options.portalFlushBudget ?? 24;
		this.postScrollDecorationBudget = options.postScrollDecorationBudget ?? 32;
		this.postScrollFidelityBudget = options.postScrollFidelityBudget ?? 12;
		this.prewarmer = new ApproachBandPrewarmer<TRowData>(deps, options.prewarm);
		this.scrollCtx = {
			isScrolling: true,
			stateVersion: 0,
			rowVersions: deps.engine.rowVersions,
			globalVersion: 0,
			insightVersion: 0,
			styleVersion: 0,
			loadingVersion: 0,
			selectionVersion: 0,
			styleChangedDuringScroll: false,
			loadingChangedDuringScroll: false,
			selectionChangedDuringScroll: false,
			globalChangedDuringScroll: false,
			activeEdit: null,
			hasDeferredCellStyleRules: false,
			hasCustomRenderers: false,
			hasInsightDecorations: false,
			plan: deps.engine.columns.getCompiledPlan(),
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			focusedCell: null,
			selectionBounds: undefined,
			canUseCachedDisplayValues: true,
		};
	}

	/** Whether a fidelity-lane repair batch is waiting for idle time. */
	public get fidelityDecorationScheduled(): boolean {
		return this.postScrollFidelityScheduled;
	}

	public getIsScrolling(): boolean {
		return this.deps.runtimeState.isScrolling();
	}

	public getIsScrollFrameActive(): boolean {
		return this.deps.runtimeState.phase === 'scroll-frame';
	}

	public markFlushPendingAfterScroll(changeIds: readonly number[] = []): void {
		this.flushPendingAfterScroll = true;
		for (const changeId of changeIds) this.pendingPaintChangeIds.add(changeId);
	}

	public markViewportDirtyAfterScroll(): void {
		this.viewportDirtyAfterScroll = true;
	}

	public onScroll = (scrollTop: number, scrollLeft: number, timestamp?: number): void => {
		const clampedScrollLeft = Math.max(0, Math.min(this.cachedMaxScrollLeft, scrollLeft));
		if (clampedScrollLeft !== scrollLeft && this.deps.viewportRenderer.scrollViewport) {
			this.deps.viewportRenderer.scrollViewport.scrollLeft = clampedScrollLeft;
		}
		const changed = this.deps.engine.viewport.setScrollPosition(scrollTop, clampedScrollLeft, timestamp);
		if (!changed) return;
		this.markScrolling();
		this.deps.requestScrollFrame();
		// Scroll-end detection is now owned by FrameCoordinator (single RAF loop).
	};

	public updateGeometryBounds(defaultColWidth: number, defaultRowHeight: number): void {
		this.cachedTotalWidth = this.deps.engine.geometry.getTotalWidth(defaultColWidth);
		this.cachedTotalHeight = this.deps.engine.geometry.getTotalHeight(defaultRowHeight);
		this.cachedDefaultRowHeight = defaultRowHeight ?? 40;
		const viewportWidth = this.deps.engine.viewport.scrollViewportClientWidth || this.deps.engine.viewport.viewportWidth;
		this.cachedMaxScrollLeft = Math.max(0, this.cachedTotalWidth - viewportWidth);
	}

	public flushScrollFrame = (): void => {
		const scrollViewport = this.deps.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;
		this.deps.viewportRenderer.syncViewportScrollFromDom();

		const state = this.deps.engine.stateManager.getState();
		const interaction = readInteractionState(state);
		this.cachedHasSelectionOverlay = !!interaction.cellSelection.selection.bounds && !!this.deps.engine.getRowModel();
		this.updateGeometryBounds(state.defaultColWidth, state.defaultRowHeight);

		const candidateIdx = 1 - this.activeRenderWindowBufIdx;
		const candidateBuf = this.renderWindowBufs[candidateIdx];
		computeRenderWindowInto(this.deps.engine, candidateBuf);
		const nextWindow = applyRenderWindowRuntimeLimits(candidateBuf, state.runtimeLimits);
		const layoutPlan = this.deps.viewportLayout.syncLayoutPlan(nextWindow);

		if (
			sameRenderedWindow(this.deps.rowRenderer.currentWindow, nextWindow) &&
			sameVisibleContentWindow(this.deps.rowRenderer.currentWindow, nextWindow)
		) {
			const rowModel = this.deps.engine.getRowModel();
			if (asCapableRowModel(rowModel)?.getCapabilities().fullDataset === false && this.deps.engine.viewport.isScrollingFast) {
				this.flushPendingAfterScroll = true;
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
			this.activeRenderWindowBufIdx = candidateIdx;
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
			const scrollCtx = this.scrollCtx;
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
			scrollCtx.compiledStyleRules = compileStyleRules(state.styleRules);
			scrollCtx.hasDeferredCellStyleRules = scrollCtx.compiledStyleRules.hasCellRules;
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

			this.deps.viewportLayout.recycleViewport(true, scrollCtx, nextWindow);
			this.prewarmer.schedule(nextWindow);
			this.deps.stickyGroupRenderer.sync(layoutPlan);

			this.deps.floatingFilterRenderer.syncScrollLeft(layoutPlan);
			const didSyncRange = this.deps.headerRenderer.syncVisibleColumnRange(layoutPlan, visibleColRange);
			if (didSyncRange) {
				this.deps.renderStats.headerRangeSyncsDuringScroll++;
			}
			this.deps.renderStats.overlayCheapSyncsDuringScroll++;
			this.deps.overlayRenderer.syncScrollPosition(this.cachedHasSelectionOverlay);
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
		this.needsPostScrollPortalFlush = this.needsPostScrollPortalFlush || this.deps.portalMountManager.getDeferredCount() > 0;
		if (this.needsPostScrollPortalFlush) {
			this.scheduleBudgetedPortalFlush();
		}
		this.restoreDeferredFocus();
		if (this.flushPendingAfterScroll) {
			this.flushPendingAfterScroll = false;
			const changeIds = [...this.pendingPaintChangeIds];
			this.pendingPaintChangeIds.clear();
			this.deps.frameCoordinator.requestPostScrollWork(changeIds);
		}
		if (
			this.viewportDirtyAfterScroll ||
			this.deps.rowRenderer.dirtyCellsAfterScroll.size > 0 ||
			this.deps.rowRenderer.dirtyRowsAfterScroll.size > 0
		) {
			this.viewportDirtyAfterScroll = false;
			this.scheduleBudgetedDecoration();
		}
		if (this.deps.overlayRenderer.overlayDirtyDuringScroll) {
			this.deps.overlayRenderer.overlayDirtyDuringScroll = false;
			this.deps.overlayRenderer.repaintOverlay();
		}
	}

	public scheduleBudgetedPortalFlush(): void {
		if (this.portalFlushScheduled) return;
		this.portalFlushScheduled = true;
		this.deps.gridScheduler.idle((deadline) => {
			this.portalFlushScheduled = false;
			if (this.deps.runtimeState.isScrolling()) {
				this.needsPostScrollPortalFlush = true;
				return;
			}
			const result = this.deps.portalMountManager.flushDeferred({
				maxItems: this.portalFlushBudget,
				reason: 'scroll-idle',
				flushSync: false,
				deadline,
			});
			this.needsPostScrollPortalFlush = result.remaining > 0;
			if (result.remaining > 0) {
				this.scheduleBudgetedPortalFlush();
			}
		});
	}

	public clearPostScrollDecorationTimer(): void {
		// `cancelIdle` is advisory in some host shims. Advance both generations so a
		// callback that has already escaped cancellation cannot mutate current-epoch state.
		this.postScrollDecorationGeneration++;
		this.postScrollFidelityGeneration++;
		if (this.postScrollDecorationTimer !== null) {
			this.deps.gridScheduler.cancelIdle(this.postScrollDecorationTimer);
			this.postScrollDecorationTimer = null;
		}
		this.postScrollDecorationScheduled = false;
		if (this.postScrollFidelityTimer !== null) {
			this.deps.gridScheduler.cancelIdle(this.postScrollFidelityTimer);
			this.postScrollFidelityTimer = null;
		}
		this.postScrollFidelityScheduled = false;
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
		if (this.postScrollDecorationScheduled) return;
		this.postScrollDecorationScheduled = true;
		const generation = ++this.postScrollDecorationGeneration;
		const scrollEpoch = this.deps.runtimeState.scrollEpoch;
		this.postScrollDecorationTimer = this.deps.gridScheduler.idle((deadline) => {
			if (this.postScrollDecorationGeneration !== generation || !this.deps.runtimeState.isScrollEpochCurrent(scrollEpoch)) {
				return;
			}
			this.postScrollDecorationTimer = null;
			this.postScrollDecorationScheduled = false;
			if (!this.deps.runtimeState.canRunDecoration()) {
				return;
			}
			this.deps.renderStats.postScrollMotionChunks++;
			const result = this.decorateLaneWithinDeadline('motion', this.postScrollDecorationBudget, deadline);
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
				// do not remain as stand-ins for an extra idle-to-idle gap.
				this.deps.renderStats.postScrollFidelityChunks++;
				const fidelityResult = this.decorateLaneWithinDeadline('fidelity', this.postScrollFidelityBudget, deadline);
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
		if (this.postScrollFidelityScheduled) return;
		this.postScrollFidelityScheduled = true;
		const generation = ++this.postScrollFidelityGeneration;
		const scrollEpoch = this.deps.runtimeState.scrollEpoch;
		this.fidelityEpoch = scrollEpoch;
		this.postScrollFidelityTimer = this.deps.gridScheduler.idle((deadline) => {
			if (this.postScrollFidelityGeneration !== generation || !this.deps.runtimeState.isScrollEpochCurrent(scrollEpoch)) {
				return;
			}
			this.postScrollFidelityTimer = null;
			this.postScrollFidelityScheduled = false;
			if (!this.deps.runtimeState.canRunDecoration()) {
				// finishScrolling() owns the fresh-epoch reschedule; retaining the dirty set
				// here prevents stale work from racing the next gesture.
				return;
			}
			this.deps.renderStats.postScrollFidelityChunks++;
			const result = this.decorateLaneWithinDeadline('fidelity', this.postScrollFidelityBudget, deadline);
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
		this.deps.overlayRenderer.syncScrollPosition(this.cachedHasSelectionOverlay);

		const pinTopRows = window.pinTopRows;
		const pinBottomRows = window.pinBottomRows;
		if (pinTopRows > 0 || pinBottomRows > 0) {
			const viewportHeight = this.deps.engine.viewport.viewportHeight;
			const totalHeight = this.cachedTotalHeight;
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
