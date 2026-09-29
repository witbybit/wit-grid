import { HeaderMenuController } from './headerMenuController.js';
import { ScrollEngine } from './scrollEngine.js';
import { ColumnInteractionController } from './columnInteractionController.js';
import { FillDragController, type OverlayBox } from './fillDragController.js';
import { createCellKey } from '../ids.js';
import { GeometryController } from './geometryController.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type {
	GridCellContentMount,
	GridCellContentUnmount,
	GridRowContentMount,
	GridRowContentUnmount,
	IGridRenderer,
	GridHeaderMenuMount,
	GridHeaderMenuUnmount,
} from './IGridRenderer.js';
import { DefaultFrameCoordinator } from './frameCoordinator.js';
import { PortalMountManager } from './portalMountManager.js';
import { ViewportRenderer } from './viewportRenderer.js';
import { RowRenderer } from './rowRenderer.js';
import { CellRenderer } from './cellRenderer.js';
import { HeaderRenderer } from './headerRenderer.js';
import { OverlayRenderer } from './overlayRenderer.js';
import { LayoutTransitionController } from './layoutTransitionController.js';
import { GroupPanelRenderer } from './groupPanelRenderer.js';
import { FilterChipBarRenderer } from './filterChipBarRenderer.js';
import { FloatingFilterRenderer } from './floatingFilterRenderer.js';
import { StatusBarRenderer } from './statusBarRenderer.js';
import { PaginationBarRenderer } from './paginationBarRenderer.js';
import { StickyGroupRenderer } from './stickyGroupRenderer.js';
import { ValidationTooltipController } from './ValidationTooltipController.js';
import { collectRenderStats, createRenderRuntimeStats, resetRenderTelemetry, type RenderStats } from './renderTelemetry.js';
import { RenderPaintPipeline } from './renderPaintPipeline.js';
import { RenderScrollPipeline } from './renderScrollPipeline.js';
import { RenderViewportCoordinator } from './renderViewportCoordinator.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { ColumnInstanceId } from '../columnDef.js';
import type { GridApi, InternalGridApi } from '../api/GridApi.js';
import { RowDragController } from '../features/RowDragController.js';
import { RenderRuntimeState } from './renderRuntimeState.js';
import { defaultGridScheduler } from './gridScheduler.js';
import type { GridInteractionHandle } from '../interaction/GridInteractionController.js';
import { createGridViewportInteractionRouter } from '../interaction/GridViewportInteractionRouter.js';

/**
 * Owns the grid DOM, coordinating ViewportRenderer, RowRenderer, and other sub-renderers.
 */
export class RenderEngine<TRowData = unknown> implements IGridRenderer<TRowData> {
	private readonly engine: GridEngine<TRowData>;
	private readonly api?: InternalGridApi<TRowData>;

	private validationTooltip: ValidationTooltipController | null = null;

	private readonly geometryController: GeometryController<TRowData>;
	private readonly scrollEngine: ScrollEngine<TRowData>;
	private readonly columnInteractions: ColumnInteractionController<TRowData>;
	private readonly fillDrag: FillDragController<TRowData>;
	// Frame pipeline: the frame coordinator decides when frames run; the paint and scroll
	// pipelines own what each kind of frame does; the viewport coordinator is the layout step
	// both share.
	private readonly frameCoordinator: DefaultFrameCoordinator;
	private readonly paintPipeline: RenderPaintPipeline<TRowData>;
	private readonly scrollPipeline: RenderScrollPipeline<TRowData>;
	private readonly viewportCoordinator: RenderViewportCoordinator<TRowData>;

	public readonly portalMountManager: PortalMountManager<TRowData>;
	public readonly viewportRenderer: ViewportRenderer<TRowData>;
	public readonly rowRenderer: RowRenderer<TRowData>;
	public readonly cellRenderer: CellRenderer;
	public readonly headerRenderer: HeaderRenderer<TRowData>;
	public readonly overlayRenderer: OverlayRenderer<TRowData>;
	public readonly groupPanelRenderer: GroupPanelRenderer<TRowData>;
	public readonly filterChipBarRenderer: FilterChipBarRenderer<TRowData>;
	public readonly floatingFilterRenderer: FloatingFilterRenderer<TRowData>;
	public readonly statusBarRenderer: StatusBarRenderer<TRowData>;
	public readonly paginationBarRenderer: PaginationBarRenderer<TRowData>;
	public readonly stickyGroupRenderer: StickyGroupRenderer<TRowData>;
	private readonly headerMenu: HeaderMenuController<TRowData>;
	private readonly viewportInteractionRouter: ReturnType<typeof createGridViewportInteractionRouter>;

	private readonly layoutTransition: LayoutTransitionController<TRowData>;
	private readonly rowDrag: RowDragController<TRowData>;
	private readonly interactionController: GridInteractionHandle | null;

	// Authoritative render lifecycle phase. Initialized first in constructor.
	private runtimeState!: RenderRuntimeState;

	private autoRowHeightEnabled = false;
	/** Auto-height: row id → row version it was last measured at (bounded; cleared on layout change). */
	private readonly measuredRowVersions = new Map<string, number>();
	private measuredRowPlan: unknown = null;
	private measuredRowColWindowKey = '';
	private static readonly MAX_MEASURED_ROW_STAMPS = 20_000;

	private renderStats = createRenderRuntimeStats();

	public get onMountCellContent(): ((mount: GridCellContentMount<TRowData>) => void) | undefined {
		return this.portalMountManager.onMountCellContent;
	}

	public set onMountCellContent(callback: ((mount: GridCellContentMount<TRowData>) => void) | undefined) {
		this.portalMountManager.onMountCellContent = callback;
	}

	public get onUnmountCellContent(): ((unmount: GridCellContentUnmount) => void) | undefined {
		return this.portalMountManager.onUnmountCellContent;
	}

	public set onUnmountCellContent(callback: ((unmount: GridCellContentUnmount) => void) | undefined) {
		this.portalMountManager.onUnmountCellContent = callback;
	}

	public get onMountRowContent(): ((mount: GridRowContentMount<TRowData>) => void) | undefined {
		return this.portalMountManager.onMountRowContent;
	}

	public set onMountRowContent(callback: ((mount: GridRowContentMount<TRowData>) => void) | undefined) {
		this.portalMountManager.onMountRowContent = callback;
	}

	public get onUnmountRowContent(): ((unmount: GridRowContentUnmount) => void) | undefined {
		return this.portalMountManager.onUnmountRowContent;
	}

	public set onUnmountRowContent(callback: ((unmount: GridRowContentUnmount) => void) | undefined) {
		this.portalMountManager.onUnmountRowContent = callback;
	}

	public get onMountHeaderMenu(): ((mount: GridHeaderMenuMount<TRowData>) => void) | undefined {
		return this.portalMountManager.onMountHeaderMenu;
	}

	public set onMountHeaderMenu(callback: ((mount: GridHeaderMenuMount<TRowData>) => void) | undefined) {
		this.portalMountManager.onMountHeaderMenu = callback;
	}

	public get onUnmountHeaderMenu(): ((unmount: GridHeaderMenuUnmount) => void) | undefined {
		return this.portalMountManager.onUnmountHeaderMenu;
	}

	public set onUnmountHeaderMenu(callback: ((unmount: GridHeaderMenuUnmount) => void) | undefined) {
		this.portalMountManager.onUnmountHeaderMenu = callback;
	}

	constructor(engine: GridEngine<TRowData>, api?: InternalGridApi<TRowData>, interactionController: GridInteractionHandle | null = null) {
		this.engine = engine;
		this.api = api;
		this.interactionController =
			interactionController ??
			(api as (InternalGridApi<TRowData> & { interactionController?: GridInteractionHandle | null }) | undefined)?.interactionController ??
			null;
		// Initialize first — other renderer components query it during construction.
		this.runtimeState = new RenderRuntimeState((msg) =>
			engine.runtimeFaults.report({ source: 'renderer', operation: 'runtime-phase-transition', error: new Error(msg) })
		);
		this.portalMountManager = new PortalMountManager<TRowData>(engine);
		this.headerMenu = new HeaderMenuController<TRowData>(
			engine,
			this.portalMountManager,
			() => (this.api || this.engine.stateManager) as unknown as GridApi<TRowData>
		);
		this.geometryController = new GeometryController(engine);
		this.scrollEngine = new ScrollEngine<TRowData>(engine);
		this.frameCoordinator = new DefaultFrameCoordinator({
			onScrollFrame: () => this.flushScrollFrame(),
			onPaintFrame: (changeIds) => {
				const frameToken = engine.flightRecorder.beginExecutingFrame(changeIds);
				try {
					this.flushPaint();
				} finally {
					engine.flightRecorder.finishExecutingFrame(frameToken, 'full');
				}
			},
			onPostScrollWork: (changeIds) => {
				const frameToken = engine.flightRecorder.beginExecutingFrame(changeIds);
				try {
					this.flushPaint();
				} finally {
					engine.flightRecorder.finishExecutingFrame(frameToken, 'post-scroll');
				}
			},
			onScrollEnd: () => {
				this.scrollEngine.settleVelocity();
				this.scrollPipeline.finishScrolling();
				// Rows bound by scroll frames were never measured (no reads mid-scroll): measure
				// the newly bound ones once, now that the runtime is idle.
				this.measureAndUpdateRowHeights(true);
			},
			onFault: (msg) => engine.runtimeFaults.report({ source: 'renderer', operation: 'frame-reentry', error: new Error(msg) }),
			runtimeState: this.runtimeState,
			gridScheduler: defaultGridScheduler,
			// Time-based fallback for browsers without native scrollend: a fixed frame count
			// ends the gesture after ~12ms on 240Hz displays, i.e. mid-gesture.
			scrollEndQuietMs: 100,
		});

		this.viewportRenderer = new ViewportRenderer<TRowData>(engine, this.geometryController);
		this.cellRenderer = new CellRenderer((frame) => this.rowRenderer.repaintInvalidatedRowsAndCells(frame));
		this.rowRenderer = new RowRenderer<TRowData>(
			engine,
			this.geometryController,
			this.portalMountManager,
			this.cellRenderer,
			this.viewportRenderer
		);
		this.rowRenderer.renderStats = this.renderStats;
		// Wire runtime state into the engine (as computed getters) and renderer consumers.
		engine.setScrollStateProvider(this.runtimeState);
		this.rowRenderer.runtimeState = this.runtimeState;
		this.portalMountManager.setRuntimeState(this.runtimeState);
		this.portalMountManager.setRuntimeStats(this.renderStats);
		this.portalMountManager.setPhysicalRowSlotIdResolver((rowIndex) => this.rowRenderer.activeRows.get(rowIndex)?.id);
		this.layoutTransition = new LayoutTransitionController(() => this.rowRenderer.activeRows, {
			getExitLayer: () => this.viewportRenderer.getLayer('exiting'),
			// A visual row that vanished from the model truly left (e.g. a collapsed group's
			// children) → fade it out; one that merely scrolled out of the window stays live.
			isRowIdLive: (visualRowId) => {
				const model = this.engine.getRowModel();
				return model ? model.getVisualIndexById(visualRowId) >= 0 : false;
			},
			// Grid root for semantic column-pin effects.
			getGridRoot: () => this.viewportRenderer.container,
		});

		this.headerRenderer = new HeaderRenderer<TRowData>(
			engine,
			() => this.columnInteractions,
			(cell, colField) => this.headerMenu.show(cell, colField)
		);
		this.overlayRenderer = new OverlayRenderer<TRowData>(
			engine,
			this.viewportRenderer,
			() => this.columnInteractions,
			() => this.fillDrag
		);
		this.overlayRenderer.renderStats = this.renderStats;

		this.columnInteractions = new ColumnInteractionController<TRowData>({
			engine,
			getOverlayLayer: () => this.viewportRenderer.overlayLayer,
			getScrollViewport: () => this.viewportRenderer.scrollViewport,
			getLayoutPlan: () => this.viewportRenderer.getLayoutPlan(),
			// Live reorder preview must move the body lanes immediately with the header insertion
			// change; routing through the normal scheduler can defer the row rebind and leave only
			// the dragged header ghost moving until drop. This path is already bounded to discrete
			// insertion-index changes during a drag, not every pointer pixel.
			schedulePaint: () => this.fullPaint(),
			gridScheduler: defaultGridScheduler,
		});
		// Feed the live column-reorder preview offset into the body bind path.
		this.rowRenderer.columnShiftSource = (colIndex) => this.columnInteractions.getColumnShift(colIndex);
		this.fillDrag = new FillDragController<TRowData>({
			engine,
			getOverlayLayer: () => this.viewportRenderer.overlayLayer,
			getScrollViewport: () => this.viewportRenderer.scrollViewport,
			getOverlayBox: (minRow, maxRow, minCol, maxCol) => this.overlayRenderer.getClampedOverlayBox(minRow, maxRow, minCol, maxCol),
			scrollTo: (scrollTop, scrollLeft) => this.scrollEngine.scrollTo(scrollTop, scrollLeft),
			schedulePaint: () => this.scheduleOverlayPaint('fill drag'),
			getLayoutPlan: () => this.viewportRenderer.getLayoutPlan(),
		});

		// Group panel renderer — mounts when showGroupPanel is true
		this.groupPanelRenderer = new GroupPanelRenderer<TRowData>(engine);
		this.filterChipBarRenderer = new FilterChipBarRenderer<TRowData>(engine, this.headerMenu);
		this.floatingFilterRenderer = new FloatingFilterRenderer<TRowData>(engine);
		this.statusBarRenderer = new StatusBarRenderer<TRowData>(engine);
		this.paginationBarRenderer = new PaginationBarRenderer<TRowData>(engine);
		this.stickyGroupRenderer = new StickyGroupRenderer<TRowData>(engine, this.portalMountManager);
		this.rowDrag = new RowDragController<TRowData>(engine);
		this.viewportCoordinator = new RenderViewportCoordinator<TRowData>({
			engine,
			viewportRenderer: this.viewportRenderer,
			rowRenderer: this.rowRenderer,
			scrollEngine: this.scrollEngine,
			renderStats: this.renderStats,
			// Programmatic scroll (scrollCellIntoView/scrollRowIntoView) opens a scroll session like a
			// user scroll does, so the owed frame never runs from idle.
			requestScrollFrame: () => {
				this.scrollPipeline.markScrolling();
				this.frameCoordinator.requestScrollFrame();
			},
		});
		this.scrollPipeline = new RenderScrollPipeline<TRowData>({
			engine,
			viewportRenderer: this.viewportRenderer,
			rowRenderer: this.rowRenderer,
			headerRenderer: this.headerRenderer,
			floatingFilterRenderer: this.floatingFilterRenderer,
			overlayRenderer: this.overlayRenderer,
			stickyGroupRenderer: this.stickyGroupRenderer,
			portalMountManager: this.portalMountManager,
			frameCoordinator: this.frameCoordinator,
			gridScheduler: defaultGridScheduler,
			requestScrollFrame: () => this.frameCoordinator.requestScrollFrame(),
			layoutTransition: this.layoutTransition,
			renderStats: this.renderStats,
			runtimeState: this.runtimeState,
			viewportLayout: this.viewportCoordinator,
		});
		this.paintPipeline = new RenderPaintPipeline<TRowData>({
			engine,
			runtimeState: this.runtimeState,
			renderStats: this.renderStats,
			frameCoordinator: this.frameCoordinator,
			geometryController: this.geometryController,
			portalMountManager: this.portalMountManager,
			layoutTransition: this.layoutTransition,
			viewportRenderer: this.viewportRenderer,
			rowRenderer: this.rowRenderer,
			headerRenderer: this.headerRenderer,
			floatingFilterRenderer: this.floatingFilterRenderer,
			overlayRenderer: this.overlayRenderer,
			stickyGroupRenderer: this.stickyGroupRenderer,
			viewportLayout: this.viewportCoordinator,
			scrollLane: this.scrollPipeline,
			resetScroll: () => this.scrollEngine.scrollTo(0, this.engine.viewport.scrollLeft),
			onAfterViewportPaint: () => this.measureAndUpdateRowHeights(),
			onAfterIncrementalPaint: () => this.measureAndUpdateRowHeights(true),
		});
		this.viewportInteractionRouter = createGridViewportInteractionRouter({
			getInteraction: () => this.interactionController,
			resolveCellPointer: (target) => this.resolveViewportInteractionPointer(target),
		});
	}

	/**
	 * Mount the rendering engine inside a host DOM container.
	 */
	public mount(container: HTMLElement): void {
		this.viewportRenderer.mount(container);

		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (scrollViewport) {
			scrollViewport.addEventListener('mouseover', this.onRowMouseOver);
			scrollViewport.addEventListener('mouseleave', this.onRowMouseLeave);
			scrollViewport.addEventListener('click', this.onViewportInteractionClick);
			scrollViewport.addEventListener('mousedown', this.onViewportInteractionMouseDown);
			this.scrollEngine.bind(scrollViewport, this.onScroll, this.onNativeScrollEnd);
		}

		if (this.viewportRenderer.headerLayer && this.viewportRenderer.headerLeftLayer && this.viewportRenderer.headerRightLayer) {
			this.headerRenderer.mount(
				this.viewportRenderer.headerLayer,
				this.viewportRenderer.headerLeftLayer,
				this.viewportRenderer.headerRightLayer
			);
		}
		if (this.viewportRenderer.stickyGroupLayer) {
			this.stickyGroupRenderer.mount(this.viewportRenderer.stickyGroupLayer);
		}

		// Group panel: mount if showGroupPanel is already true at mount time
		if (this.viewportRenderer.groupPanel) {
			this.groupPanelRenderer.mount(this.viewportRenderer.groupPanel);
			this.viewportCoordinator.syncLayoutPlan();
			this.columnInteractions.setGroupPanel(this.groupPanelRenderer);
		}

		// Filter chip bar — always mounted; shown/hidden reactively by filterModel changes
		if (this.viewportRenderer.filterChipBar) {
			this.filterChipBarRenderer.mount(this.viewportRenderer.filterChipBar);
		}

		// Floating filter row — always mounted; layer visibility toggled via showFloatingFilters state
		if (
			this.viewportRenderer.floatingFilterLayer &&
			this.viewportRenderer.floatingFilterLeftLayer &&
			this.viewportRenderer.floatingFilterRightLayer
		) {
			this.floatingFilterRenderer.mount(
				this.viewportRenderer.floatingFilterLayer,
				this.viewportRenderer.floatingFilterLeftLayer,
				this.viewportRenderer.floatingFilterRightLayer
			);
		}

		// Bottom chrome: status bar + pagination. The layers always exist (the registry
		// builds them); their `apply()` hides them with display:none until configured, so
		// mounting the content unconditionally is safe and lets config toggle at runtime.
		const statusBarLayer = this.viewportRenderer.getLayer('status-bar');
		if (statusBarLayer) this.statusBarRenderer.mount(statusBarLayer);
		const paginationLayer = this.viewportRenderer.getLayer('pagination');
		if (paginationLayer) this.paginationBarRenderer.mount(paginationLayer);

		this.overlayRenderer.mount();

		// Row drag-and-drop
		if (scrollViewport) {
			this.rowDrag.mount(container, scrollViewport);
		}

		// Pre-warm DOM recycling pools
		const rect = container.getBoundingClientRect();
		const estRows = Math.ceil((rect.height || 500) / 40) + 15;
		this.rowRenderer.mount(estRows);

		// Set viewport dimensions in model
		this.engine.viewport.setViewportSize(rect.width || 800, rect.height || 500);

		this.validationTooltip = new ValidationTooltipController(container);

		this.paintPipeline.bind();

		// Prime the max-scroll cache so the first scroll events don't see a stale 0
		this.updateCachedGeometryBounds();

		// Run first layout calculation and repaint
		this.engine.invalidation.consume();
		this.fullPaint();
	}

	/**
	 * Unmount and clean up all DOM resources and subscriptions.
	 */
	public unmount(): void {
		this.headerMenu.hide();

		this.validationTooltip?.destroy();
		this.validationTooltip = null;

		this.paintPipeline.destroy();
		this.scrollEngine.unbind();
		const scrollViewport = this.viewportRenderer.scrollViewport;
		if (scrollViewport) {
			scrollViewport.removeEventListener('mouseover', this.onRowMouseOver);
			scrollViewport.removeEventListener('mouseleave', this.onRowMouseLeave);
			scrollViewport.removeEventListener('click', this.onViewportInteractionClick);
			scrollViewport.removeEventListener('mousedown', this.onViewportInteractionMouseDown);
		}
		this.columnInteractions.cleanup();
		this.columnInteractions.setGroupPanel(null);
		this.fillDrag.cleanup();
		this.rowDrag.unmount();
		this.groupPanelRenderer.unmount();
		this.filterChipBarRenderer.unmount();
		this.floatingFilterRenderer.unmount();
		this.statusBarRenderer.unmount();
		this.paginationBarRenderer.unmount();
		this.stickyGroupRenderer.unmount();
		this.layoutTransition.destroy();
		this.frameCoordinator.destroy();
		this.clearPostScrollDecorationTimer();

		// Unmount renderers first so they can properly release portal identities
		// before releaseAll() clears activeIdentityByKey.
		this.rowRenderer.unmount();
		this.headerRenderer.unmount();
		this.overlayRenderer.unmount();

		this.portalMountManager.releaseAll();

		this.viewportRenderer.unmount();
	}

	/** Scroll hot path: zero allocations, zero state reads (see RenderScrollPipeline.onScroll). */
	private onScroll = (scrollTop: number, scrollLeft: number, timestamp?: number): void => {
		this.scrollPipeline.onScroll(scrollTop, scrollLeft, timestamp);
	};

	private onNativeScrollEnd = (): void => {
		this.frameCoordinator.notifyScrollEnd();
	};

	private clearPostScrollDecorationTimer(): void {
		this.scrollPipeline.clearPostScrollDecorationTimer();
	}

	private flushScrollFrame(): void {
		this.scrollPipeline.flushScrollFrame();
	}

	private updateCachedGeometryBoundsFromState(defaultColWidth: number, defaultRowHeight: number): void {
		this.scrollPipeline.updateGeometryBounds(defaultColWidth, defaultRowHeight);
	}

	private updateCachedGeometryBounds(): void {
		const state = this.engine.stateManager.getState();
		this.scrollPipeline.updateGeometryBounds(state.defaultColWidth, state.defaultRowHeight);
	}

	public setAutoRowHeight(enabled: boolean): void {
		this.autoRowHeightEnabled = enabled;
	}

	/**
	 * Auto row height. `onlyUnmeasured` (viewport paints, scroll end) skips rows already
	 * measured at their current row version under the current column layout/window, so the
	 * per-cell scrollHeight reads stay bounded to rows that newly entered the viewport.
	 * A full paint (`onlyUnmeasured = false`) re-measures every bound row, as before.
	 * Never runs inside a scroll frame; callers invoke it after all paint writes.
	 */
	private measureAndUpdateRowHeights(onlyUnmeasured = false): void {
		if (!this.autoRowHeightEnabled) return;
		if (!this.engine.getRowModel()) return;
		if (this.runtimeState.phase === 'scroll-frame') return;

		const state = this.engine.stateManager.getState();
		const slots = this.rowRenderer.rowSlotPool?.getSlots() ?? [];
		const measuredHeights = new Map<string, number>();

		// Column layout or the rendered column window changes cell wrapping: re-measure then.
		const plan = this.engine.columns.getCompiledPlan();
		const win = this.rowRenderer.currentWindow;
		const colWindowKey = win ? `${win.colStart}:${win.colEnd}` : '';
		const stamps = this.measuredRowVersions;
		if (plan !== this.measuredRowPlan || colWindowKey !== this.measuredRowColWindowKey || stamps.size > RenderEngine.MAX_MEASURED_ROW_STAMPS) {
			stamps.clear();
			this.measuredRowPlan = plan;
			this.measuredRowColWindowKey = colWindowKey;
		}

		for (const slot of slots) {
			if (slot.rowKind !== 'data') continue;
			const visualRowId = slot.visualRowId;
			if (!visualRowId.startsWith('row:')) continue;

			const rawRowId = decodeURIComponent(visualRowId.slice(4));
			const rowVersion = this.engine.rowVersions.get(rawRowId) ?? 0;
			if (onlyUnmeasured && stamps.get(rawRowId) === rowVersion) continue;
			stamps.set(rawRowId, rowVersion);
			// Cells typically use h-full (height:100%) so the row's own scrollHeight
			// reflects only its explicit height. Instead, take the maximum scrollHeight
			// across all cells — a cell whose content overflows its h-full container will
			// report the natural content height here.
			const cells = slot.element.querySelectorAll<HTMLElement>('.og-cell');
			const measuredHeight = cells.length > 0 ? Math.max(...Array.from(cells, (c) => c.scrollHeight)) : slot.element.scrollHeight;
			if (measuredHeight <= 0) continue;

			const currentHeight = state.rowHeights[rawRowId] ?? state.defaultRowHeight;
			if (Math.abs(measuredHeight - currentHeight) > 1) {
				measuredHeights.set(rawRowId, measuredHeight);
			}
		}

		// All DOM reads above finish before the state/geometry write below. A visible
		// batch therefore yields at most one commit and one projection geometry rebuild.
		this.engine.applyAutoRowHeightBatch(measuredHeights);
	}

	public schedulePaint(): void {
		this.paintPipeline.scheduleFullPaint('api');
	}

	public scheduleFullPaint(reason = 'api'): void {
		this.paintPipeline.scheduleFullPaint(reason);
	}

	public scheduleViewportPaint(reason = 'viewport'): void {
		this.paintPipeline.scheduleViewportPaint(reason);
	}

	public scheduleHeaderPaint(reason = 'headers'): void {
		this.paintPipeline.scheduleHeaderPaint(reason);
	}

	public scheduleOverlayPaint(reason = 'overlay'): void {
		this.paintPipeline.scheduleOverlayPaint(reason);
	}

	public scheduleCellPaint(rowId: string, colId: string, reason = 'cell'): void {
		this.paintPipeline.scheduleCellPaint(rowId, colId, reason);
	}

	public scheduleRowPaint(rowId: string, reason = 'row'): void {
		this.paintPipeline.scheduleRowPaint(rowId, reason);
	}

	public scheduleColumnPaint(colId: string, reason = 'column'): void {
		this.paintPipeline.scheduleColumnPaint(colId, reason);
	}

	public scheduleGeometryPaint(reason = 'geometry'): void {
		this.paintPipeline.scheduleGeometryPaint(reason);
	}

	private flushPaint(): void {
		this.paintPipeline.flushPaint();
	}

	public getRenderStats(): RenderStats {
		return collectRenderStats({
			engine: this.engine,
			portalMountManager: this.portalMountManager,
			rowRenderer: this.rowRenderer,
			runtimeStats: this.renderStats,
		});
	}

	public resetRenderStats(): void {
		resetRenderTelemetry(this.engine, this.portalMountManager, this.rowRenderer, this.renderStats);
	}

	public fullPaint(): void {
		this.paintPipeline.fullPaint();
	}

	public scrollCellIntoView(rowId: string, colField: string): void {
		this.viewportCoordinator.scrollCellIntoView(rowId, colField);
	}

	public scrollRowIntoView(rowId: string): void {
		this.viewportCoordinator.scrollRowIntoView(rowId);
	}

	private onRowMouseOver = (event: MouseEvent): void => {
		// During scroll the viewport is moving — hover state would flicker across every
		// row the pointer passes over and trigger className writes + style recalcs on each.
		// Suppress until scrolling stops; finishScrolling clears the hovered row anyway.
		if (this.scrollPipeline.getIsScrolling()) return;

		const rowEl = (event.target as HTMLElement).closest('.og-row') as HTMLElement | null;
		const rowIndexText = rowEl?.dataset.rowIndex;
		if (rowIndexText === undefined) {
			this.setHoveredRowIndex(null);
			return;
		}

		const rowIndex = Number(rowIndexText);
		this.setHoveredRowIndex(Number.isFinite(rowIndex) ? rowIndex : null);
	};

	private onRowMouseLeave = (): void => {
		this.setHoveredRowIndex(null);
	};

	private onViewportInteractionMouseDown = (event: MouseEvent): void => {
		this.viewportInteractionRouter.handleViewportMouseDown(event);
	};

	private onViewportInteractionClick = (event: MouseEvent): void => {
		this.viewportInteractionRouter.handleViewportClick(event);
	};

	private resolveViewportInteractionPointer(target: Element): {
		rowId: string;
		colField: string;
		columnInstanceId?: ColumnInstanceId;
		colId?: string;
	} | null {
		const cellEl = target.closest<HTMLDivElement>('.og-cell');
		if (!cellEl) return null;
		const cellSlot = (
			cellEl as HTMLDivElement & {
				__cellSlot?: {
					binding?: { rowId: string; colId: string } | null;
					colField?: string;
					columnInstanceId?: ColumnInstanceId;
				};
			}
		).__cellSlot;
		const rowId = cellSlot?.binding?.rowId ?? cellEl.dataset.rowId;
		const colField = cellSlot?.colField ?? cellEl.dataset.colField;
		if (!rowId || !colField) return null;
		return {
			rowId,
			colField,
			columnInstanceId: cellSlot?.columnInstanceId,
			colId: cellSlot?.binding?.colId ?? colField,
		};
	}

	private setHoveredRowIndex(rowIndex: number | null): void {
		if (this.rowRenderer.hoveredRowIndex === rowIndex) return;

		if (this.rowRenderer.hoveredRowIndex !== null) {
			this.setPooledRowHoverClass(this.rowRenderer.hoveredRowIndex, false);
		}

		this.rowRenderer.hoveredRowIndex = rowIndex;

		if (rowIndex !== null) {
			this.setPooledRowHoverClass(rowIndex, true);
		}
	}

	private setPooledRowHoverClass(rowIndex: number, hovered: boolean): void {
		const pooledRow = this.rowRenderer.activeRows.get(rowIndex);
		if (!pooledRow) return;

		pooledRow.element.classList.toggle('og-row-hovered', hovered);
	}
}
