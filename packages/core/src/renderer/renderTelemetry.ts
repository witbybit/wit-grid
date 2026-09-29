import type { GridEngine } from '../engine/GridEngine.js';
import type { PortalMountManager } from './portalMountManager.js';
import { type RenderOrchestrator, type RenderStats } from './renderOrchestrator.js';
import type { RowRenderer } from './rowRenderer.js';
import { cellSlotWriteStats, resetCellSlotWriteStats } from './cellSlot.js';
import { resetRowSlotWriteStats, rowSlotWriteStats } from './rowSlot.js';

export interface RenderRuntimeStats {
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
	cellTextWrites: number;
	cellClassWrites: number;
	cellTransformWrites: number;
	cellWidthWrites: number;
	cellLeftWrites: number;
	cellDomReadsAvoided: number;
	rowClassWrites: number;
	rowTransformWrites: number;
	rowHeightWrites: number;
	rowsVisitedDuringScroll: number;
	rowsReboundDuringScroll: number;
	cellsVisitedDuringScroll: number;
	cellsWrittenDuringScroll: number;
	portalOpsDuringScroll: number;
	cellAccessReadsDuringScroll: number;
	cellClassComputesDuringScroll: number;
	reusableCellsSkippedDuringScroll: number;
	styleHookCallsDuringScroll: number;
	integrityComputesDuringScroll: number;
	forceLiveMountsDuringScroll: number;
	/** scrollPresentation:'live' mounts/updates during scroll — see renderer/rowCellBinder.ts. */
	liveReactMountsDuringScroll: number;
	/** Live-mode work admitted for cells that were in the overscan band rather than the visible
	 *  viewport. Counted when the scroll-time live path actually executes for an overscan cell. */
	liveReactOverscanMounts: number;
	/** Same cellKey already mounted — a React re-render, not a fresh portal mount. Budgeted
	 *  separately from liveReactMountsDuringScroll by liveFrameBudget.ts. */
	liveReactUpdatesDuringScroll: number;
	/** A live-mount was deferred to a shell/pending placeholder because maxMountsPerFrame was
	 *  exhausted this frame (see liveFrameBudget.ts, GridRendererOptions.liveReact). */
	liveReactEmergencyShellsDuringScroll: number;
	/** DOM renderer cells updated in place during scroll (`scrollPresentation: 'update'`). */
	domUpdatesDuringScroll: number;
	/** DOM renderer cells the frame's DOM-update budget refused (stand-in until scroll settles). */
	domUpdatesDeferredDuringScroll: number;
	htmlSnapshotHitsDuringScroll: number;
	htmlSnapshotMissesDuringScroll: number;
	textImpostorUsesDuringScroll: number;
	cellSlotsRetained: number;
	cellSlotsEvictedDuringTopology: number;
	cellSlotsCreatedDuringTopology: number;
	cellSlotsReusedDuringTopology: number;
	maxCellsByColumnIdPerRowSlot: number;
	portalFlushChunks: number;
	maxPortalOpsFlushedInOneChunk: number;
	postScrollDecorationChunks: number;
	maxCellsDecoratedInOneChunk: number;
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
	cellsBoundDuringScroll: number;
	runtimeLimitsClamped?: number;
	prewarmedDisplayValues: number;
	prewarmPasses: number;
	prewarmedCellSnapshots: number;
}

export function createRenderRuntimeStats(): RenderRuntimeStats {
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
		cellTextWrites: 0,
		cellClassWrites: 0,
		cellTransformWrites: 0,
		cellWidthWrites: 0,
		cellLeftWrites: 0,
		cellDomReadsAvoided: 0,
		rowClassWrites: 0,
		rowTransformWrites: 0,
		rowHeightWrites: 0,
		rowsVisitedDuringScroll: 0,
		rowsReboundDuringScroll: 0,
		cellsVisitedDuringScroll: 0,
		cellsWrittenDuringScroll: 0,
		portalOpsDuringScroll: 0,
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
		htmlSnapshotHitsDuringScroll: 0,
		htmlSnapshotMissesDuringScroll: 0,
		textImpostorUsesDuringScroll: 0,
		cellSlotsRetained: 0,
		cellSlotsEvictedDuringTopology: 0,
		cellSlotsCreatedDuringTopology: 0,
		cellSlotsReusedDuringTopology: 0,
		maxCellsByColumnIdPerRowSlot: 0,
		portalFlushChunks: 0,
		maxPortalOpsFlushedInOneChunk: 0,
		postScrollDecorationChunks: 0,
		maxCellsDecoratedInOneChunk: 0,
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
		cellsBoundDuringScroll: 0,
		prewarmedDisplayValues: 0,
		prewarmPasses: 0,
		prewarmedCellSnapshots: 0,
	};
}

export interface RenderTelemetrySnapshotDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	orchestrator: RenderOrchestrator;
	portalMountManager: PortalMountManager<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	runtimeStats: RenderRuntimeStats;
}

export function collectRenderStats<TRowData>(deps: RenderTelemetrySnapshotDeps<TRowData>): RenderStats {
	const stats = deps.orchestrator.getStats();
	const portalScrollStats = deps.portalMountManager.getScrollStats();
	return {
		...stats,
		rowSlotAssigns: deps.runtimeStats.rowSlotAssigns,
		rowSlotMoves: deps.runtimeStats.rowSlotMoves,
		rowSlotRebinds: deps.runtimeStats.rowSlotRebinds,
		cellSlotRebinds: deps.runtimeStats.cellSlotRebinds,
		fullCellBinds: deps.runtimeStats.fullCellBinds,
		geometryOnlyCellBinds: deps.runtimeStats.geometryOnlyCellBinds,
		reactMounts: deps.runtimeStats.reactMounts,
		reactRefreshes: deps.runtimeStats.reactRefreshes,
		reactUnmounts: deps.runtimeStats.reactUnmounts,
		scrollFrames: deps.runtimeStats.scrollFrames,
		viewportRecycles: deps.runtimeStats.viewportRecycles,
		headerPaintsDuringScroll: deps.runtimeStats.headerPaintsDuringScroll,
		headerRangeSyncsDuringScroll: deps.runtimeStats.headerRangeSyncsDuringScroll,
		overlayPaintsDuringScroll: deps.runtimeStats.overlayPaintsDuringScroll,
		overlayCheapSyncsDuringScroll: deps.runtimeStats.overlayCheapSyncsDuringScroll,
		focusCallsDuringScroll: deps.runtimeStats.focusCallsDuringScroll,
		rootTextContentWritesOnPortalCells: deps.runtimeStats.rootTextContentWritesOnPortalCells,
		cellTextWrites: cellSlotWriteStats.cellTextWrites,
		cellClassWrites: cellSlotWriteStats.cellClassWrites,
		cellTransformWrites: cellSlotWriteStats.cellTransformWrites,
		cellWidthWrites: cellSlotWriteStats.cellWidthWrites,
		cellLeftWrites: cellSlotWriteStats.cellLeftWrites,
		cellDomReadsAvoided: cellSlotWriteStats.cellDomReadsAvoided,
		rowClassWrites: rowSlotWriteStats.rowClassWrites,
		rowTransformWrites: rowSlotWriteStats.rowTransformWrites,
		rowHeightWrites: rowSlotWriteStats.rowHeightWrites,
		cellsBoundDuringScroll: deps.rowRenderer.currentScrollCellsPatched,
		rowsVisitedDuringScroll: deps.rowRenderer.currentScrollRowsVisited,
		rowsReboundDuringScroll: deps.rowRenderer.currentScrollRowsRebound,
		cellsVisitedDuringScroll: deps.rowRenderer.currentScrollCellsVisited,
		cellsWrittenDuringScroll: deps.rowRenderer.currentScrollCellsWritten,
		portalOpsDuringScroll:
			deps.rowRenderer.currentScrollPortalOps + portalScrollStats.portalMountsDuringScroll + portalScrollStats.portalReleasesDuringScroll,
		// portalMountsDuringScroll itself already flows through via the `...portalScrollStats` spread
		// below — it's the top-level regression tripwire for the scroll-time-portal-mount blocker.
		// Should be 0 for any normal (non force-live-exception) scroll frame; the fix is proven by the
		// impostor-fallback tests, not by this counter alone, but a non-zero value outside the
		// exception path means the bug is back.
		cellsDecoratedAfterScroll: deps.runtimeStats.cellsDecoratedAfterScroll,
		postScrollMotionChunks: deps.runtimeStats.postScrollMotionChunks,
		maxMotionCellsDecoratedInOneChunk: deps.runtimeStats.maxMotionCellsDecoratedInOneChunk,
		motionCellsDecoratedAfterScroll: deps.runtimeStats.motionCellsDecoratedAfterScroll,
		postScrollFidelityChunks: deps.runtimeStats.postScrollFidelityChunks,
		maxFidelityCellsDecoratedInOneChunk: deps.runtimeStats.maxFidelityCellsDecoratedInOneChunk,
		fidelityCellsDecoratedAfterScroll: deps.runtimeStats.fidelityCellsDecoratedAfterScroll,
		cellAccessReadsDuringScroll: deps.runtimeStats.cellAccessReadsDuringScroll,
		cellClassComputesDuringScroll: deps.runtimeStats.cellClassComputesDuringScroll,
		dirtyCellsMarkedDuringScroll: deps.rowRenderer.dirtyCellsMarkedDuringScroll,
		postScrollDirtyCellsDecorated: deps.rowRenderer.postScrollDirtyCellsDecorated,
		reusableCellsSkippedDuringScroll: deps.runtimeStats.reusableCellsSkippedDuringScroll,
		styleHookCallsDuringScroll: deps.runtimeStats.styleHookCallsDuringScroll,
		integrityComputesDuringScroll: deps.runtimeStats.integrityComputesDuringScroll,
		forceLiveMountsDuringScroll: deps.runtimeStats.forceLiveMountsDuringScroll,
		liveReactMountsDuringScroll: deps.runtimeStats.liveReactMountsDuringScroll,
		liveReactOverscanMounts: deps.runtimeStats.liveReactOverscanMounts,
		liveReactUpdatesDuringScroll: deps.runtimeStats.liveReactUpdatesDuringScroll,
		liveReactEmergencyShellsDuringScroll: deps.runtimeStats.liveReactEmergencyShellsDuringScroll,
		domUpdatesDuringScroll: deps.runtimeStats.domUpdatesDuringScroll,
		domUpdatesDeferredDuringScroll: deps.runtimeStats.domUpdatesDeferredDuringScroll,
		htmlSnapshotHitsDuringScroll: deps.runtimeStats.htmlSnapshotHitsDuringScroll,
		htmlSnapshotMissesDuringScroll: deps.runtimeStats.htmlSnapshotMissesDuringScroll,
		textImpostorUsesDuringScroll: deps.runtimeStats.textImpostorUsesDuringScroll,
		cellSlotsRetained: deps.runtimeStats.cellSlotsRetained,
		cellSlotsEvictedDuringTopology: deps.runtimeStats.cellSlotsEvictedDuringTopology,
		cellSlotsCreatedDuringTopology: deps.runtimeStats.cellSlotsCreatedDuringTopology,
		cellSlotsReusedDuringTopology: deps.runtimeStats.cellSlotsReusedDuringTopology,
		maxCellsByColumnIdPerRowSlot: deps.runtimeStats.maxCellsByColumnIdPerRowSlot,
		rowsEnteredDuringScroll: deps.runtimeStats.rowsEnteredDuringScroll,
		rowsExitedDuringScroll: deps.runtimeStats.rowsExitedDuringScroll,
		rowsStayedDuringScroll: deps.runtimeStats.rowsStayedDuringScroll,
		colsEnteredDuringScroll: deps.runtimeStats.colsEnteredDuringScroll,
		colsExitedDuringScroll: deps.runtimeStats.colsExitedDuringScroll,
		colsStayedDuringScroll: deps.runtimeStats.colsStayedDuringScroll,
		columnTopologyDeltaComputations: deps.runtimeStats.columnTopologyDeltaComputations,
		columnTopologyDeltaComputationsDuringScroll: deps.runtimeStats.columnTopologyDeltaComputationsDuringScroll,
		columnTopologyStayedColumns: deps.runtimeStats.columnTopologyStayedColumns,
		columnTopologyEnteredColumns: deps.runtimeStats.columnTopologyEnteredColumns,
		columnTopologyExitedColumns: deps.runtimeStats.columnTopologyExitedColumns,
		columnTopologyLaneMoves: deps.runtimeStats.columnTopologyLaneMoves,
		cellsSkippedDuringScroll: deps.runtimeStats.cellsSkippedDuringScroll,
		sameWindowBailouts: deps.runtimeStats.sameWindowBailouts,
		stateReadsDuringScroll: deps.runtimeStats.stateReadsDuringScroll,
		compiledPlanVersion: deps.engine.columns.getCompiledPlanVersion(),
		getCellValueCallsDuringScroll: deps.engine.getCellValueCallsDuringScroll,
		valueGetterCallsDuringScroll: deps.engine.valueGetterCallsDuringScroll,
		formulaCallsDuringScroll: deps.engine.formulaCallsDuringScroll,
		customRendererMountsDuringScroll: deps.engine.customRendererMountsDuringScroll,
		customRendererHydrationChunks: deps.engine.customRendererHydrationChunks,
		customRendererWarmHits: deps.engine.customRendererWarmHits,
		customRendererWarmMisses: deps.engine.customRendererWarmMisses,
		prewarmedDisplayValues: deps.runtimeStats.prewarmedDisplayValues,
		prewarmPasses: deps.runtimeStats.prewarmPasses,
		prewarmedCellSnapshots: deps.runtimeStats.prewarmedCellSnapshots,
		...portalScrollStats,
		hotDomReleases: deps.runtimeStats.rowsRecycledPerScrollFrame.reduce((a: number, b: number) => a + b, 0),
		coldDomReleases: 0,
		cellsPatchedPerScrollFrame: deps.runtimeStats.cellsPatchedPerScrollFrame.slice(),
		rowsRecycledPerScrollFrame: deps.runtimeStats.rowsRecycledPerScrollFrame.slice(),
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
	orchestrator: RenderOrchestrator,
	portalMountManager: PortalMountManager<TRowData>,
	rowRenderer: RowRenderer<TRowData>,
	runtimeStats: RenderRuntimeStats
): void {
	orchestrator.resetStats();
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
