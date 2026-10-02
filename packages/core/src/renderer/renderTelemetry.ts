import type { GridEngine } from '../engine/GridEngine.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { GridInvalidation } from './invalidationManager.js';
import type { RowRenderer } from './rowRenderer.js';
import { cellSlotWriteStats, resetCellSlotWriteStats } from './cellSlot.js';
import { resetRowSlotWriteStats, rowSlotWriteStats } from './rowSlot.js';

export interface RenderStats {
	rowSlotAssigns?: number;
	rowSlotMoves?: number;
	rowSlotRebinds?: number;
	cellSlotRebinds?: number;
	fullCellBinds?: number;
	geometryOnlyCellBinds?: number;
	reactMounts?: number;
	reactRefreshes?: number;
	reactUnmounts?: number;
	fullPaints: number;
	runtimeLimitsClamped?: number;
	rowPaints: number;
	cellPaints: number;
	headerPaints: number;
	overlayPaints: number;
	geometryRecomputes: number;
	viewportPaints: number;
	scrollFrames: number;
	viewportRecycles: number;
	headerPaintsDuringScroll: number;
	headerRangeSyncsDuringScroll: number;
	overlayPaintsDuringScroll: number;
	overlayCheapSyncsDuringScroll: number;
	portalFlushesDuringScroll: number;
	portalDeferredDuringScroll: number;
	portalMountsDuringScroll: number;
	portalReleasesDuringScroll: number;
	portalFlushChunks: number;
	maxPortalOpsFlushedInOneChunk: number;
	focusCallsDuringScroll: number;
	rootTextContentWritesOnPortalCells: number;
	cellTextWrites: number;
	cellClassWrites: number;
	cellTransformWrites: number;
	cellWidthWrites: number;
	cellLeftWrites: number;
	cellDomReadsAvoided: number;
	rowClassWrites: number;
	rowTransformWrites: number;
	rowHeightWrites: number;
	cellsBoundDuringScroll: number;
	rowsVisitedDuringScroll: number;
	rowsReboundDuringScroll: number;
	cellsVisitedDuringScroll: number;
	cellsWrittenDuringScroll: number;
	portalOpsDuringScroll: number;
	cellsDecoratedAfterScroll: number;
	postScrollMotionChunks?: number;
	maxMotionCellsDecoratedInOneChunk?: number;
	motionCellsDecoratedAfterScroll?: number;
	postScrollFidelityChunks?: number;
	maxFidelityCellsDecoratedInOneChunk?: number;
	fidelityCellsDecoratedAfterScroll?: number;
	rowsEnteredDuringScroll: number;
	rowsExitedDuringScroll: number;
	rowsStayedDuringScroll: number;
	colsEnteredDuringScroll: number;
	colsExitedDuringScroll: number;
	colsStayedDuringScroll: number;
	/**
	 * The 6 counters below are populated only when the column TOPOLOGY itself changes (pin/unpin/
	 * reorder/resize — plan.version bump), via `computeColumnWindowDelta`. Distinct from
	 * cols{Entered,Exited,Stayed}DuringScroll above, which track the render WINDOW shifting over a
	 * static topology (the routine horizontal-scroll case, via `diffRenderWindow`).
	 */
	columnTopologyDeltaComputations?: number;
	columnTopologyDeltaComputationsDuringScroll?: number;
	columnTopologyStayedColumns?: number;
	columnTopologyEnteredColumns?: number;
	columnTopologyExitedColumns?: number;
	columnTopologyLaneMoves?: number;
	cellsSkippedDuringScroll: number;
	sameWindowBailouts: number;
	stateReadsDuringScroll: number;
	compiledPlanVersion?: number;
	cellAccessReadsDuringScroll: number;
	cellClassComputesDuringScroll: number;
	dirtyCellsMarkedDuringScroll: number;
	postScrollDirtyCellsDecorated: number;
	reusableCellsSkippedDuringScroll: number;
	styleHookCallsDuringScroll: number;
	hotDomReleases: number;
	coldDomReleases: number;
	cellsPatchedPerScrollFrame: number[];
	rowsRecycledPerScrollFrame: number[];
	lastInvalidationReasons: string[];
	lastInvalidations: GridInvalidation[];
	portalMounts?: { cells: number; rows: number; menus: number; custom?: any };
	/** Controller-layer lifecycle counts — see renderer/controllers/RowCtrlStore.ts. Read live from
	 *  the store at snapshot time (same pattern as portalMounts above), not accumulated separately. */
	controllers?: {
		rowCtrlsCreated: number;
		rowCtrlsReused: number;
		rowCtrlsEvicted: number;
		cellCtrlsCreated: number;
		cellCtrlsReused: number;
	};
	getCellValueCallsDuringScroll?: number;
	valueGetterCallsDuringScroll?: number;
	formulaCallsDuringScroll?: number;
	customRendererMountsDuringScroll?: number;
	customRendererHydrationChunks?: number;
	customRendererWarmHits?: number;
	customRendererWarmMisses?: number;
	prewarmedDisplayValues?: number;
	prewarmPasses?: number;
	prewarmedCellSnapshots?: number;
	integrityComputesDuringScroll?: number;
	forceLiveMountsDuringScroll?: number;
	liveReactMountsDuringScroll?: number;
	liveReactOverscanMounts?: number;
	liveReactUpdatesDuringScroll?: number;
	liveReactEmergencyShellsDuringScroll?: number;
	domUpdatesDuringScroll?: number;
	domUpdatesDeferredDuringScroll?: number;
	cellSlotsRetained?: number;
	cellSlotsEvictedDuringTopology?: number;
	cellSlotsCreatedDuringTopology?: number;
	cellSlotsReusedDuringTopology?: number;
	maxCellsByColumnIdPerRowSlot?: number;
}

/** Returns a zero-value RenderStats object. Used by GridStore.getRenderStats() when no render engine is mounted. */
export function createEmptyRenderStats(): RenderStats {
	return {
		rowSlotAssigns: 0,
		rowSlotMoves: 0,
		rowSlotRebinds: 0,
		cellSlotRebinds: 0,
		fullCellBinds: 0,
		geometryOnlyCellBinds: 0,
		reactMounts: 0,
		reactRefreshes: 0,
		reactUnmounts: 0,
		fullPaints: 0,
		rowPaints: 0,
		cellPaints: 0,
		headerPaints: 0,
		overlayPaints: 0,
		geometryRecomputes: 0,
		viewportPaints: 0,
		scrollFrames: 0,
		viewportRecycles: 0,
		headerPaintsDuringScroll: 0,
		headerRangeSyncsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		overlayCheapSyncsDuringScroll: 0,
		portalFlushesDuringScroll: 0,
		portalDeferredDuringScroll: 0,
		portalMountsDuringScroll: 0,
		portalReleasesDuringScroll: 0,
		portalFlushChunks: 0,
		maxPortalOpsFlushedInOneChunk: 0,
		focusCallsDuringScroll: 0,
		rootTextContentWritesOnPortalCells: 0,
		cellTextWrites: 0,
		cellClassWrites: 0,
		cellTransformWrites: 0,
		cellWidthWrites: 0,
		cellLeftWrites: 0,
		cellDomReadsAvoided: 0,
		rowClassWrites: 0,
		rowTransformWrites: 0,
		rowHeightWrites: 0,
		cellsBoundDuringScroll: 0,
		rowsVisitedDuringScroll: 0,
		rowsReboundDuringScroll: 0,
		cellsVisitedDuringScroll: 0,
		cellsWrittenDuringScroll: 0,
		portalOpsDuringScroll: 0,
		cellsDecoratedAfterScroll: 0,
		postScrollMotionChunks: 0,
		maxMotionCellsDecoratedInOneChunk: 0,
		motionCellsDecoratedAfterScroll: 0,
		postScrollFidelityChunks: 0,
		maxFidelityCellsDecoratedInOneChunk: 0,
		fidelityCellsDecoratedAfterScroll: 0,
		rowsEnteredDuringScroll: 0,
		rowsExitedDuringScroll: 0,
		rowsStayedDuringScroll: 0,
		colsEnteredDuringScroll: 0,
		colsExitedDuringScroll: 0,
		colsStayedDuringScroll: 0,
		columnTopologyDeltaComputations: 0,
		columnTopologyDeltaComputationsDuringScroll: 0,
		columnTopologyStayedColumns: 0,
		columnTopologyEnteredColumns: 0,
		columnTopologyExitedColumns: 0,
		columnTopologyLaneMoves: 0,
		cellsSkippedDuringScroll: 0,
		sameWindowBailouts: 0,
		stateReadsDuringScroll: 0,
		compiledPlanVersion: 0,
		hotDomReleases: 0,
		coldDomReleases: 0,
		cellsPatchedPerScrollFrame: [],
		rowsRecycledPerScrollFrame: [],
		lastInvalidationReasons: [],
		lastInvalidations: [],
		portalMounts: { cells: 0, rows: 0, menus: 0, custom: { active: 0, warm: 0, cold: 0, hydrationQueue: 0, completedChunks: 0 } },
		controllers: {
			rowCtrlsCreated: 0,
			rowCtrlsReused: 0,
			rowCtrlsEvicted: 0,
			cellCtrlsCreated: 0,
			cellCtrlsReused: 0,
		},
		getCellValueCallsDuringScroll: 0,
		valueGetterCallsDuringScroll: 0,
		formulaCallsDuringScroll: 0,
		customRendererMountsDuringScroll: 0,
		customRendererHydrationChunks: 0,
		customRendererWarmHits: 0,
		customRendererWarmMisses: 0,
		prewarmedDisplayValues: 0,
		prewarmPasses: 0,
		prewarmedCellSnapshots: 0,
		cellAccessReadsDuringScroll: 0,
		cellClassComputesDuringScroll: 0,
		dirtyCellsMarkedDuringScroll: 0,
		postScrollDirtyCellsDecorated: 0,
		reusableCellsSkippedDuringScroll: 0,
		styleHookCallsDuringScroll: 0,
		integrityComputesDuringScroll: 0,
		forceLiveMountsDuringScroll: 0,
		liveReactMountsDuringScroll: 0,
		liveReactOverscanMounts: 0,
		liveReactUpdatesDuringScroll: 0,
		liveReactEmergencyShellsDuringScroll: 0,
		domUpdatesDuringScroll: 0,
		domUpdatesDeferredDuringScroll: 0,
		cellSlotsRetained: 0,
		cellSlotsEvictedDuringTopology: 0,
		cellSlotsCreatedDuringTopology: 0,
		cellSlotsReusedDuringTopology: 0,
		maxCellsByColumnIdPerRowSlot: 0,
	};
}

export interface RenderRuntimeStats {
	/** Paint dispatch (RenderPaintPipeline): frames that took each path. */
	fullPaints: number;
	viewportPaints: number;
	rowPaints: number;
	cellPaints: number;
	headerPaints: number;
	overlayPaints: number;
	geometryRecomputes: number;
	lastInvalidationReasons: string[];
	lastInvalidations: GridInvalidation[];
	rowSlotAssigns: number;
	rowSlotMoves: number;
	rowSlotRebinds: number;
	cellSlotRebinds: number;
	fullCellBinds: number;
	geometryOnlyCellBinds: number;
	reactMounts: number;
	reactRefreshes: number;
	reactUnmounts: number;
	scrollFrames: number;
	viewportRecycles: number;
	headerPaintsDuringScroll: number;
	headerRangeSyncsDuringScroll: number;
	overlayPaintsDuringScroll: number;
	overlayCheapSyncsDuringScroll: number;
	cellsPatchedPerScrollFrame: number[];
	rowsRecycledPerScrollFrame: number[];
	stateReadsDuringScroll: number;
	focusCallsDuringScroll: number;
	rootTextContentWritesOnPortalCells: number;
	cellAccessReadsDuringScroll: number;
	cellClassComputesDuringScroll: number;
	reusableCellsSkippedDuringScroll: number;
	styleHookCallsDuringScroll: number;
	integrityComputesDuringScroll: number;
	forceLiveMountsDuringScroll: number;
	/** `scroll: 'live'` mounts/updates during scroll — see renderer/rowCellBinder.ts. */
	liveReactMountsDuringScroll: number;
	/** Live-mode work admitted for cells that were in the overscan band rather than the visible
	 *  viewport. Counted when the scroll-time live path actually executes for an overscan cell. */
	liveReactOverscanMounts: number;
	/** Same cellKey already mounted — a React re-render, not a fresh portal mount. Budgeted
	 *  separately from liveReactMountsDuringScroll by liveFrameBudget.ts. */
	liveReactUpdatesDuringScroll: number;
	/** A live-mount was deferred to a shell/pending placeholder because maxMountsPerFrame was
	 *  exhausted this frame (see liveFrameBudget.ts, GridRendererOptions.live). */
	liveReactEmergencyShellsDuringScroll: number;
	/** DOM renderer cells updated in place during scroll (`scroll: 'live'` on a DOM renderer). */
	domUpdatesDuringScroll: number;
	/** DOM renderer cells the frame's DOM-update budget refused (stand-in until scroll settles). */
	domUpdatesDeferredDuringScroll: number;
	cellSlotsRetained: number;
	cellSlotsEvictedDuringTopology: number;
	cellSlotsCreatedDuringTopology: number;
	cellSlotsReusedDuringTopology: number;
	maxCellsByColumnIdPerRowSlot: number;
	cellsDecoratedAfterScroll: number;
	postScrollMotionChunks: number;
	maxMotionCellsDecoratedInOneChunk: number;
	motionCellsDecoratedAfterScroll: number;
	postScrollFidelityChunks: number;
	maxFidelityCellsDecoratedInOneChunk: number;
	fidelityCellsDecoratedAfterScroll: number;
	rowsEnteredDuringScroll: number;
	rowsExitedDuringScroll: number;
	rowsStayedDuringScroll: number;
	colsEnteredDuringScroll: number;
	colsExitedDuringScroll: number;
	colsStayedDuringScroll: number;
	columnTopologyDeltaComputations: number;
	columnTopologyDeltaComputationsDuringScroll: number;
	columnTopologyStayedColumns: number;
	columnTopologyEnteredColumns: number;
	columnTopologyExitedColumns: number;
	columnTopologyLaneMoves: number;
	cellsSkippedDuringScroll: number;
	sameWindowBailouts: number;
	runtimeLimitsClamped?: number;
	prewarmedDisplayValues: number;
	prewarmPasses: number;
	prewarmedCellSnapshots: number;
}

export function createRenderRuntimeStats(): RenderRuntimeStats {
	return {
		fullPaints: 0,
		viewportPaints: 0,
		rowPaints: 0,
		cellPaints: 0,
		headerPaints: 0,
		overlayPaints: 0,
		geometryRecomputes: 0,
		lastInvalidationReasons: [],
		lastInvalidations: [],
		rowSlotAssigns: 0,
		rowSlotMoves: 0,
		rowSlotRebinds: 0,
		cellSlotRebinds: 0,
		fullCellBinds: 0,
		geometryOnlyCellBinds: 0,
		reactMounts: 0,
		reactRefreshes: 0,
		reactUnmounts: 0,
		scrollFrames: 0,
		viewportRecycles: 0,
		headerPaintsDuringScroll: 0,
		headerRangeSyncsDuringScroll: 0,
		overlayPaintsDuringScroll: 0,
		overlayCheapSyncsDuringScroll: 0,
		cellsPatchedPerScrollFrame: [],
		rowsRecycledPerScrollFrame: [],
		stateReadsDuringScroll: 0,
		focusCallsDuringScroll: 0,
		rootTextContentWritesOnPortalCells: 0,
		cellAccessReadsDuringScroll: 0,
		cellClassComputesDuringScroll: 0,
		reusableCellsSkippedDuringScroll: 0,
		styleHookCallsDuringScroll: 0,
		integrityComputesDuringScroll: 0,
		forceLiveMountsDuringScroll: 0,
		liveReactMountsDuringScroll: 0,
		liveReactOverscanMounts: 0,
		liveReactUpdatesDuringScroll: 0,
		liveReactEmergencyShellsDuringScroll: 0,
		domUpdatesDuringScroll: 0,
		domUpdatesDeferredDuringScroll: 0,
		cellSlotsRetained: 0,
		cellSlotsEvictedDuringTopology: 0,
		cellSlotsCreatedDuringTopology: 0,
		cellSlotsReusedDuringTopology: 0,
		maxCellsByColumnIdPerRowSlot: 0,
		cellsDecoratedAfterScroll: 0,
		postScrollMotionChunks: 0,
		maxMotionCellsDecoratedInOneChunk: 0,
		motionCellsDecoratedAfterScroll: 0,
		postScrollFidelityChunks: 0,
		maxFidelityCellsDecoratedInOneChunk: 0,
		fidelityCellsDecoratedAfterScroll: 0,
		rowsEnteredDuringScroll: 0,
		rowsExitedDuringScroll: 0,
		rowsStayedDuringScroll: 0,
		colsEnteredDuringScroll: 0,
		colsExitedDuringScroll: 0,
		colsStayedDuringScroll: 0,
		columnTopologyDeltaComputations: 0,
		columnTopologyDeltaComputationsDuringScroll: 0,
		columnTopologyStayedColumns: 0,
		columnTopologyEnteredColumns: 0,
		columnTopologyExitedColumns: 0,
		columnTopologyLaneMoves: 0,
		cellsSkippedDuringScroll: 0,
		sameWindowBailouts: 0,
		prewarmedDisplayValues: 0,
		prewarmPasses: 0,
		prewarmedCellSnapshots: 0,
	};
}

export interface RenderTelemetrySnapshotDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	portalMountManager: PortalMountManager<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	runtimeStats: RenderRuntimeStats;
}

// Every runtime counter must be reportable: a counter added to RenderRuntimeStats but missing from
// RenderStats fails to compile here instead of being silently dropped from getRenderStats().
type UnreportedRuntimeCounters = Exclude<keyof RenderRuntimeStats, keyof RenderStats>;
const everyRuntimeCounterIsReported: [UnreportedRuntimeCounters] extends [never] ? true : UnreportedRuntimeCounters = true;
void everyRuntimeCounterIsReported;

/**
 * One snapshot of every render counter. Runtime counters are spread wholesale, so there is no
 * per-field copy list to fall out of date; values other owners keep (slot write counters, the
 * row renderer's per-frame scroll counters, portal and controller stats) are added on top.
 */
export function collectRenderStats<TRowData>(deps: RenderTelemetrySnapshotDeps<TRowData>): RenderStats {
	const runtime = deps.runtimeStats;
	const portalScrollStats = deps.portalMountManager.getScrollStats();
	return {
		...runtime,
		cellsPatchedPerScrollFrame: runtime.cellsPatchedPerScrollFrame.slice(),
		rowsRecycledPerScrollFrame: runtime.rowsRecycledPerScrollFrame.slice(),
		lastInvalidationReasons: runtime.lastInvalidationReasons.slice(),
		lastInvalidations: runtime.lastInvalidations.slice(),
		...cellSlotWriteStats,
		...rowSlotWriteStats,
		// Per-frame scroll counters: the most recent changed-window scroll frame.
		cellsBoundDuringScroll: deps.rowRenderer.currentScrollCellsPatched,
		rowsVisitedDuringScroll: deps.rowRenderer.currentScrollRowsVisited,
		rowsReboundDuringScroll: deps.rowRenderer.currentScrollRowsRebound,
		cellsVisitedDuringScroll: deps.rowRenderer.currentScrollCellsVisited,
		cellsWrittenDuringScroll: deps.rowRenderer.currentScrollCellsWritten,
		portalOpsDuringScroll:
			deps.rowRenderer.currentScrollPortalOps + portalScrollStats.portalMountsDuringScroll + portalScrollStats.portalReleasesDuringScroll,
		dirtyCellsMarkedDuringScroll: deps.rowRenderer.dirtyCellsMarkedDuringScroll,
		postScrollDirtyCellsDecorated: deps.rowRenderer.postScrollDirtyCellsDecorated,
		compiledPlanVersion: deps.engine.columns.getCompiledPlanVersion(),
		getCellValueCallsDuringScroll: deps.engine.getCellValueCallsDuringScroll,
		valueGetterCallsDuringScroll: deps.engine.valueGetterCallsDuringScroll,
		formulaCallsDuringScroll: deps.engine.formulaCallsDuringScroll,
		customRendererMountsDuringScroll: deps.engine.customRendererMountsDuringScroll,
		customRendererHydrationChunks: deps.engine.customRendererHydrationChunks,
		customRendererWarmHits: deps.engine.customRendererWarmHits,
		customRendererWarmMisses: deps.engine.customRendererWarmMisses,
		// portalMountsDuringScroll arrives here: the regression tripwire for scroll-time portal
		// mounts. Should be 0 for any normal (non force-live-exception) scroll frame.
		...portalScrollStats,
		hotDomReleases: runtime.rowsRecycledPerScrollFrame.reduce((a: number, b: number) => a + b, 0),
		coldDomReleases: 0,
		portalMounts: {
			...deps.portalMountManager.getStats(),
			custom: deps.portalMountManager.customRendererManager.getStats(),
		},
		controllers: {
			rowCtrlsCreated: deps.engine.rowCtrls.stats.created,
			rowCtrlsReused: deps.engine.rowCtrls.stats.reused,
			rowCtrlsEvicted: deps.engine.rowCtrls.stats.evicted,
			cellCtrlsCreated: deps.engine.rowCtrls.stats.cellCtrlsCreated,
			cellCtrlsReused: deps.engine.rowCtrls.stats.cellCtrlsReused,
		},
	};
}

export function resetRenderTelemetry<TRowData>(
	engine: GridEngine<TRowData>,
	portalMountManager: PortalMountManager<TRowData>,
	rowRenderer: RowRenderer<TRowData>,
	runtimeStats: RenderRuntimeStats
): void {
	portalMountManager.resetStats();
	rowRenderer.dirtyCellsMarkedDuringScroll = 0;
	rowRenderer.postScrollDirtyCellsDecorated = 0;
	rowRenderer.currentScrollCellsPatched = 0;
	rowRenderer.currentScrollRowsRecycled = 0;
	rowRenderer.currentScrollRowsVisited = 0;
	rowRenderer.currentScrollRowsRebound = 0;
	rowRenderer.currentScrollCellsVisited = 0;
	rowRenderer.currentScrollCellsWritten = 0;
	rowRenderer.currentScrollPortalOps = 0;
	Object.assign(runtimeStats, createRenderRuntimeStats());
	engine.getCellValueCallsDuringScroll = 0;
	engine.valueGetterCallsDuringScroll = 0;
	engine.formulaCallsDuringScroll = 0;
	engine.customRendererMountsDuringScroll = 0;
	engine.customRendererHydrationChunks = 0;
	engine.customRendererWarmHits = 0;
	engine.customRendererWarmMisses = 0;
	engine.rowCtrls.resetStats();
	resetCellSlotWriteStats();
	resetRowSlotWriteStats();
}
