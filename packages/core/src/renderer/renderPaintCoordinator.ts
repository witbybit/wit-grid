import type { GridEngine } from '../engine/GridEngine.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import type { OverlayRenderer } from './overlayRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { RenderOrchestrator } from './renderOrchestrator.js';
import type { RowRenderer } from './rowRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { HeaderRenderer } from './headerRenderer.js';
import type { FloatingFilterRenderer } from './floatingFilterRenderer.js';
import type { StickyGroupRenderer } from './stickyGroupRenderer.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { RenderWindow } from './renderWindow.js';
import type { LayoutTransitionController } from './layoutTransitionController.js';

export interface RenderPaintCoordinatorState {
	pendingTransition: boolean;
	lastStyleRules: unknown;
	lastLoading: unknown;
}

export interface RenderPaintCoordinatorDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	viewportRenderer: ViewportRenderer<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	headerRenderer: HeaderRenderer<TRowData>;
	floatingFilterRenderer: FloatingFilterRenderer<TRowData>;
	overlayRenderer: OverlayRenderer<TRowData>;
	stickyGroupRenderer: StickyGroupRenderer<TRowData>;
	portalMountManager: PortalMountManager<TRowData>;
	orchestrator: RenderOrchestrator;
	scrollCoordinator: ScrollCoordinatorLike;
	layoutTransition: LayoutTransitionController<TRowData>;
	recycleViewport: (isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow) => void;
	syncLayoutPlan: (renderWindow?: RenderWindow) => GridLayoutPlan;
	updateCachedGeometryBoundsFromState: (defaultColWidth: number, defaultRowHeight: number) => void;
	/** Runs after a full paint: measure every bound row (auto row height). */
	onAfterViewportPaint?: () => void;
	/** Runs after a non-full paint flush: measure only newly bound, not-yet-measured rows. */
	onAfterIncrementalPaint?: () => void;
}

export class RenderPaintCoordinator<TRowData = unknown> {
	constructor(
		private readonly deps: RenderPaintCoordinatorDeps<TRowData>,
		private readonly state: RenderPaintCoordinatorState
	) {}

	public flushPaint = (): void => {
		this.refreshRendererEpochs();
		const frame = this.deps.engine.invalidation.consume();
		// Arm a layout transition for discrete structural changes only — never while
		// scrolling. Sort reorders rows; that same reason also covers live sort-key
		// reorders emitted from data writes. Group/tree expansion ('group expansion') and
		// master-detail ('detail') reveal/hide them. All animate via the
		// LayoutTransitionController; scroll/data-tick frames are excluded so the hot path
		// never sets an animation.
		const notScrolling = !this.deps.scrollCoordinator.getIsScrolling();
		if (notScrolling && (frame.reasons.includes('sort') || frame.reasons.includes('group expansion') || frame.reasons.includes('detail'))) {
			this.state.pendingTransition = true;
		}
		this.applyPendingScrollAnchor(notScrolling);
		this.deps.portalMountManager.beginCellReleaseTransaction();
		try {
			this.deps.orchestrator.flush(frame);
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
		// where `syncViewport` repositioned the rows but nothing called beginAnimation. Guarded
		// by the flag so a full-paint flush does not double-animate.
		if (this.state.pendingTransition) {
			this.state.pendingTransition = false;
			this.deps.layoutTransition.beginAnimation();
		}
	};

	public fullPaint = (): void => {
		this.deps.portalMountManager.beginCellReleaseTransaction();
		try {
			this.fullPaintInternal();
		} finally {
			this.deps.portalMountManager.endCellReleaseTransaction();
		}
	};

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
		this.deps.syncLayoutPlan();
		scrollViewport.scrollTop = Math.max(0, currentTop + delta);
		// Read back: the browser may clamp. Keep the engine in step without faking scroll velocity.
		this.deps.engine.viewport.applyAnchoredScrollTop(scrollViewport.scrollTop);
	}

	public refreshRendererEpochs(): void {
		const state = this.deps.engine.stateManager.getState();
		if (this.state.lastStyleRules !== state.styleRules) {
			this.state.lastStyleRules = state.styleRules;
			this.deps.rowRenderer.styleVersion++;
		}
		if (this.state.lastLoading !== state.loading) {
			this.state.lastLoading = state.loading;
			this.deps.rowRenderer.loadingVersion++;
		}
	}

	private fullPaintInternal(): void {
		this.deps.viewportRenderer.syncViewportScrollFromDom();

		const state = this.deps.engine.stateManager.getState();

		// Keep scroll clamps and total extents in sync after any full repaint
		// (handles column adds/removes and viewport resizes funneled through full paint).
		this.deps.updateCachedGeometryBoundsFromState(state.defaultColWidth, state.defaultRowHeight);

		const layoutPlan = this.deps.syncLayoutPlan();
		this.deps.recycleViewport(false, undefined, layoutPlan.renderWindow);
		this.deps.stickyGroupRenderer.sync(layoutPlan);
		if (this.state.pendingTransition) {
			this.state.pendingTransition = false;
			this.deps.layoutTransition.beginAnimation();
		}
		this.deps.headerRenderer.repaintHeaders(layoutPlan);
		this.deps.floatingFilterRenderer.repaint(layoutPlan);
		this.deps.overlayRenderer.repaintOverlay();
		this.deps.rowRenderer.syncInteractionAccessibility(state);
		this.deps.onAfterViewportPaint?.();
	}
}

export interface ScrollCoordinatorLike {
	getIsScrolling(): boolean;
}
