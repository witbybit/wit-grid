import { GridEventName } from '../api/GridEvents.js';
import type { CanonicalGridCellPointer } from '../api/GridApi.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { FloatingFilterRenderer } from './floatingFilterRenderer.js';
import type { FrameCoordinator } from './frameCoordinator.js';
import type { GeometryController } from './geometryController.js';
import type { HeaderRenderer } from './headerRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import type { LayoutTransitionController } from './layoutTransitionController.js';
import type { OverlayRenderer } from './overlayRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';
import type { RenderWindow } from './renderWindow.js';
import type { RowRenderer } from './rowRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { StickyGroupRenderer } from './stickyGroupRenderer.js';
import type { ViewportRenderer } from './viewportRenderer.js';

/** The viewport-layout step both pipelines share (RenderViewportCoordinator). */
export interface PaintViewportLayout<TRowData = unknown> {
	syncLayoutPlan(renderWindow?: RenderWindow): GridLayoutPlan;
	recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow): void;
	scrollCellPointerIntoView(pointer: CanonicalGridCellPointer): void;
}

/** What the paint pipeline needs from the scroll pipeline. */
export interface PaintScrollLane {
	/** A paint requested mid-scroll runs once the scroll settles (post-scroll work). */
	markFlushPendingAfterScroll(changeIds: readonly number[]): void;
	/** Scroll clamps and total extents, refreshed by every full paint. */
	updateGeometryBounds(defaultColWidth: number, defaultRowHeight: number): void;
}

export interface RenderPaintPipelineDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	runtimeState: RenderRuntimeState;
	renderStats: RenderRuntimeStats;
	frameCoordinator: FrameCoordinator;
	geometryController: GeometryController<TRowData>;
	portalMountManager: PortalMountManager<TRowData>;
	layoutTransition: LayoutTransitionController<TRowData>;
	viewportRenderer: ViewportRenderer<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	headerRenderer: HeaderRenderer<TRowData>;
	floatingFilterRenderer: FloatingFilterRenderer<TRowData>;
	overlayRenderer: OverlayRenderer<TRowData>;
	stickyGroupRenderer: StickyGroupRenderer<TRowData>;
	viewportLayout: PaintViewportLayout<TRowData>;
	scrollLane: PaintScrollLane;
	/** Scroll back to the top (client pagination page change). */
	resetScroll: () => void;
	/** Runs after a full paint: measure every bound row (auto row height). */
	onAfterViewportPaint?: () => void;
	/** Runs after a non-full paint flush: measure only newly bound, not-yet-measured rows. */
	onAfterIncrementalPaint?: () => void;
}

/**
 * The paint lane, end to end: what changed (engine events and schedule*Paint requests become
 * invalidations and a paint-frame request), the flush (consume the invalidation frame once per
 * paint frame), and the dispatch (which renderers the frame's invalidations reach). Scroll frames
 * are the scroll pipeline's; frame timing is the FrameCoordinator's.
 */
export class RenderPaintPipeline<TRowData = unknown> {
	private unsubscribers: Array<() => void> = [];
	/** A layout transition armed by a structural change, played once rows hold their new positions. */
	private pendingTransition = false;
	private lastStyleRules: unknown = undefined;
	private lastLoading: unknown = undefined;

	constructor(private readonly deps: RenderPaintPipelineDeps<TRowData>) {}

	// ── What changed ─────────────────────────────────────────────────────────

	public bind(): void {
		if (this.unsubscribers.length > 0) return;
		const { engine, layoutTransition } = this.deps;

		this.unsubscribers.push(engine.eventBus.addEventListener(GridEventName.sortChanged, () => layoutTransition.captureSnapshot('sort')));
		this.unsubscribers.push(
			engine.eventBus.addEventListener(GridEventName.layoutTransitionCaptureRequested, (event) =>
				layoutTransition.captureSnapshot(event.payload.reason)
			)
		);
		// Expansion (group, tree, and master-detail all mutate state.expansion) needs the
		// pre-toggle row positions so the subsequent viewport flush can animate from the old layout.
		this.unsubscribers.push(engine.stateManager.subscribeToKey('expansion', () => layoutTransition.captureSnapshot('expansion')));
		// Client pagination page change: reset scroll to the top of the new page while the row
		// model re-runs the pipeline for the new window on the same event.
		this.unsubscribers.push(engine.eventBus.addEventListener(GridEventName.paginationChanged, () => this.deps.resetScroll()));
		this.unsubscribers.push(
			engine.eventBus.addEventListener(GridEventName.selectionChanged, () => {
				const interaction = readInteractionState(this.deps.engine.stateManager.getState());
				const selection = interaction.cellSelection.selection;
				if (selection.focus && selection.source !== 'pointer') this.deps.viewportLayout.scrollCellPointerIntoView(selection.focus);
			})
		);
		this.unsubscribers.push(
			engine.eventBus.addEventListener(GridEventName.columnResized, (event) => {
				this.deps.geometryController.invalidateColumns([event.payload.colField]);
			})
		);
		// No rowResized listener: every rowResized is emitted by a rowHeights commit, and the
		// projection pipeline already syncs row geometry in that same commit. Re-deriving it
		// here on the next paint was a second full O(rows) rebuild per resize.
		this.unsubscribers.push(
			engine.eventBus.addEventListener(GridEventName.renderInvalidated, (event) => {
				this.requestPaint(engine.takePendingRenderChangeIds());
			})
		);
	}

	public destroy(): void {
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		this.unsubscribers = [];
	}

	public scheduleFullPaint(reason = 'api'): void {
		this.deps.engine.invalidation.invalidateFull(reason);
		this.requestPaint();
	}

	public scheduleViewportPaint(reason = 'viewport'): void {
		this.deps.engine.invalidation.invalidateViewport(reason);
		this.requestPaint();
	}

	public scheduleHeaderPaint(reason = 'headers'): void {
		this.deps.engine.invalidation.invalidateHeaders(reason);
		this.requestPaint();
	}

	public scheduleOverlayPaint(reason = 'overlay'): void {
		this.deps.engine.invalidation.invalidateOverlay(reason);
		this.requestPaint();
	}

	public scheduleCellPaint(rowId: string, colId: string, reason = 'cell'): void {
		this.deps.engine.invalidation.invalidateCell(rowId, colId, reason);
		this.requestPaint();
	}

	public scheduleRowPaint(rowId: string, reason = 'row'): void {
		this.deps.engine.invalidation.invalidateRow(rowId, reason);
		this.requestPaint();
	}

	public scheduleColumnPaint(colId: string, reason = 'column'): void {
		this.deps.engine.invalidation.invalidateColumn(colId, reason);
		this.requestPaint();
	}

	public scheduleGeometryPaint(reason = 'geometry'): void {
		this.deps.geometryController.invalidateAll();
		this.deps.engine.invalidation.invalidateGeometry(reason);
		this.deps.engine.invalidation.invalidateViewport(reason);
		this.deps.engine.invalidation.invalidateHeaders(reason);
		this.requestPaint();
	}

	/** Mid-scroll, paint work waits for the scroll to settle; otherwise it takes the next paint frame. */
	private requestPaint(changeIds: readonly number[] = []): void {
		if (this.deps.runtimeState.isScrolling()) {
			this.deps.scrollLane.markFlushPendingAfterScroll(changeIds);
			return;
		}
		this.deps.frameCoordinator.requestPaintFrame(changeIds);
	}

	// ── Flush ────────────────────────────────────────────────────────────────

	/** One paint frame: consume the accumulated invalidations and dispatch them. */
	public flushPaint(): void {
		this.refreshRendererEpochs();
		const frame = this.deps.engine.invalidation.consume();
		// Arm a layout transition for discrete structural changes only — never while
		// scrolling. Sort reorders rows; that same reason also covers live sort-key
		// reorders emitted from data writes. Group/tree expansion ('group expansion') and
		// master-detail ('detail') reveal/hide them. All animate via the
		// LayoutTransitionController; scroll/data-tick frames are excluded so the hot path
		// never sets an animation.
		const notScrolling = !this.deps.runtimeState.isScrolling();
		if (notScrolling && (frame.reasons.includes('sort') || frame.reasons.includes('group expansion') || frame.reasons.includes('detail'))) {
			this.pendingTransition = true;
		}
		this.applyPendingScrollAnchor(notScrolling);
		this.deps.portalMountManager.beginCellReleaseTransaction();
		try {
			this.dispatch(frame);
		} finally {
			this.deps.portalMountManager.endCellReleaseTransaction();
		}
		this.deps.rowRenderer.syncInteractionAccessibility();
		// A full frame already measured inside fullPaintInternal. All DOM writes for this
		// flush are done, so the measurement reads below batch after them (one layout).
		if (!frame.full) this.deps.onAfterIncrementalPaint?.();
		// Play the armed transition once the slots hold their NEW positions. A `full` frame
		// (e.g. sort) is handled inside `fullPaintInternal`, which consumes the flag — so this
		// only fires for the `viewport` path (group/tree/detail expansion → invalidateViewport),
		// where the viewport sync repositioned the rows but nothing called beginAnimation.
		if (this.pendingTransition) {
			this.pendingTransition = false;
			this.deps.layoutTransition.beginAnimation();
		}
	}

	public fullPaint(): void {
		this.deps.portalMountManager.beginCellReleaseTransaction();
		try {
			this.fullPaintInternal();
		} finally {
			this.deps.portalMountManager.endCellReleaseTransaction();
		}
	}

	public refreshRendererEpochs(): void {
		const state = this.deps.engine.stateManager.getState();
		if (this.lastStyleRules !== state.styleRules) {
			this.lastStyleRules = state.styleRules;
			this.deps.rowRenderer.styleVersion++;
		}
		if (this.lastLoading !== state.loading) {
			this.lastLoading = state.loading;
			this.deps.rowRenderer.loadingVersion++;
		}
	}

	/**
	 * Scroll anchoring: when rows above the first visible row changed height, the projection
	 * pipeline recorded the resulting shift. Apply it to scrollTop before this flush paints the
	 * new row positions, so visible content stays put within the same frame. The scroll
	 * extent is synced first so the browser does not clamp the corrected position. Stale
	 * corrections (the user scrolled since) are dropped by consumeScrollAnchor.
	 */
	private applyPendingScrollAnchor(notScrolling: boolean): void {
		const scrollViewport = this.deps.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;
		const currentTop = scrollViewport.scrollTop;
		const delta = this.deps.engine.viewport.consumeScrollAnchor(currentTop);
		if (!notScrolling || delta === 0 || currentTop <= 0) return;
		this.deps.viewportLayout.syncLayoutPlan();
		scrollViewport.scrollTop = Math.max(0, currentTop + delta);
		// Read back: the browser may clamp. Keep the engine in step without faking scroll velocity.
		this.deps.engine.viewport.applyAnchoredScrollTop(scrollViewport.scrollTop);
	}

	// ── Dispatch ─────────────────────────────────────────────────────────────

	/** Routes one invalidation frame to the renderers it reaches, counting each path taken. */
	public dispatch(frame: InvalidationFrame): void {
		const stats = this.deps.renderStats;
		stats.lastInvalidationReasons = frame.reasons;
		stats.lastInvalidations = frame.invalidations;

		if (frame.full) {
			stats.fullPaints++;
			this.fullPaint();
			return;
		}

		const rowRangeCount = countRowRanges(frame.rowRanges);
		const hasStructuralViewportWork = frame.rowRanges.length > 0 || frame.groups.size > 0;

		if (frame.geometry) {
			stats.geometryRecomputes++;
			this.deps.geometryController.recomputeIfNeeded();
		}

		if (frame.viewport || hasStructuralViewportWork) {
			stats.viewportPaints++;
			this.syncViewport();
		}

		if (frame.rows.size > 0) {
			stats.rowPaints += frame.rows.size;
			this.deps.rowRenderer.repaintInvalidatedRows(frame);
		} else if (rowRangeCount > 0) {
			stats.rowPaints += rowRangeCount;
		}

		const cellCount = countCells(frame.cellsByRowId);
		if (cellCount > 0 || frame.columns.size > 0) {
			stats.cellPaints += cellCount;
			this.deps.rowRenderer.repaintInvalidatedCells(frame);
		}

		if (frame.headers) {
			stats.headerPaints++;
			this.deps.headerRenderer.sync(frame);
		}

		if (frame.overlay || frame.viewport || hasStructuralViewportWork || cellCount > 0 || frame.rows.size > 0) {
			stats.overlayPaints++;
			this.deps.overlayRenderer.sync(frame);
		}
	}

	private syncViewport(): void {
		// Sync DOM-measured scroll viewport width before computing layout — ensures
		// scrollViewportClientWidth is fresh after container resizes (e.g. sidebar open/close)
		// without needing a full paint cycle.
		this.deps.viewportRenderer.syncViewportScrollFromDom();
		const layoutPlan = this.deps.viewportLayout.syncLayoutPlan();
		this.deps.viewportLayout.recycleViewport(false, undefined, layoutPlan.renderWindow);
		this.deps.stickyGroupRenderer.sync(layoutPlan);
	}

	private fullPaintInternal(): void {
		this.deps.viewportRenderer.syncViewportScrollFromDom();

		const state = this.deps.engine.stateManager.getState();

		// Keep scroll clamps and total extents in sync after any full repaint
		// (handles column adds/removes and viewport resizes funneled through full paint).
		this.deps.scrollLane.updateGeometryBounds(state.defaultColWidth, state.defaultRowHeight);

		const layoutPlan = this.deps.viewportLayout.syncLayoutPlan();
		this.deps.viewportLayout.recycleViewport(false, undefined, layoutPlan.renderWindow);
		this.deps.stickyGroupRenderer.sync(layoutPlan);
		if (this.pendingTransition) {
			this.pendingTransition = false;
			this.deps.layoutTransition.beginAnimation();
		}
		this.deps.headerRenderer.repaintHeaders(layoutPlan);
		this.deps.floatingFilterRenderer.repaint(layoutPlan);
		this.deps.overlayRenderer.repaintOverlay();
		this.deps.rowRenderer.syncInteractionAccessibility(state);
		this.deps.onAfterViewportPaint?.();
	}
}

function countCells(cellsByRowId: Map<string, Set<string>>): number {
	let count = 0;
	for (const colIds of cellsByRowId.values()) count += colIds.size;
	return count;
}

function countRowRanges(rowRanges: readonly { startIndex: number; endIndex: number }[]): number {
	let count = 0;
	for (const range of rowRanges) count += Math.max(0, range.endIndex - range.startIndex + 1);
	return count;
}
