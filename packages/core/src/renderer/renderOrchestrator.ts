import type { GridInvalidation, InvalidationFrame } from './invalidationManager.js';

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
	htmlSnapshotHitsDuringScroll?: number;
	htmlSnapshotMissesDuringScroll?: number;
	textImpostorUsesDuringScroll?: number;
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
		htmlSnapshotHitsDuringScroll: 0,
		htmlSnapshotMissesDuringScroll: 0,
		textImpostorUsesDuringScroll: 0,
		cellSlotsRetained: 0,
		cellSlotsEvictedDuringTopology: 0,
		cellSlotsCreatedDuringTopology: 0,
		cellSlotsReusedDuringTopology: 0,
		maxCellsByColumnIdPerRowSlot: 0,
	};
}

export interface RenderOrchestratorTargets {
	recomputeGeometry(): void;
	syncViewport(frame: InvalidationFrame): void;
	syncHeaders(frame: InvalidationFrame): void;
	syncOverlay(frame: InvalidationFrame): void;
	syncRows(frame: InvalidationFrame): void;
	syncCells(frame: InvalidationFrame): void;
	fullPaint(frame: InvalidationFrame): void;
}

export class RenderOrchestrator {
	private readonly targets: RenderOrchestratorTargets;
	private readonly stats: RenderStats = {
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
		runtimeLimitsClamped: 0,
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
		htmlSnapshotHitsDuringScroll: 0,
		htmlSnapshotMissesDuringScroll: 0,
		textImpostorUsesDuringScroll: 0,
		cellSlotsRetained: 0,
		cellSlotsEvictedDuringTopology: 0,
		cellSlotsCreatedDuringTopology: 0,
		cellSlotsReusedDuringTopology: 0,
		maxCellsByColumnIdPerRowSlot: 0,
		hotDomReleases: 0,
		coldDomReleases: 0,
		cellsPatchedPerScrollFrame: [],
		rowsRecycledPerScrollFrame: [],
		lastInvalidationReasons: [],
		lastInvalidations: [],
	};

	constructor(targets: RenderOrchestratorTargets) {
		this.targets = targets;
	}

	public flush(frame: InvalidationFrame): void {
		this.stats.lastInvalidationReasons = frame.reasons;
		this.stats.lastInvalidations = frame.invalidations;

		if (frame.full) {
			this.stats.fullPaints++;
			this.targets.fullPaint(frame);
			return;
		}

		const rowRangeCount = this.countRowRanges(frame.rowRanges);
		const hasStructuralViewportWork = frame.rowRanges.length > 0 || frame.groups.size > 0;

		if (frame.geometry) {
			this.stats.geometryRecomputes++;
			this.targets.recomputeGeometry();
		}

		if (frame.viewport || hasStructuralViewportWork) {
			this.stats.viewportPaints++;
			this.targets.syncViewport(frame);
		}

		if (frame.rows.size > 0) {
			this.stats.rowPaints += frame.rows.size;
			this.targets.syncRows(frame);
		} else if (rowRangeCount > 0) {
			this.stats.rowPaints += rowRangeCount;
		}

		const cellCount = this.countCells(frame.cellsByRowId);
		if (cellCount > 0 || frame.columns.size > 0) {
			this.stats.cellPaints += cellCount;
			this.targets.syncCells(frame);
		}

		if (frame.headers) {
			this.stats.headerPaints++;
			this.targets.syncHeaders(frame);
		}

		if (frame.overlay || frame.viewport || hasStructuralViewportWork || cellCount > 0 || frame.rows.size > 0) {
			this.stats.overlayPaints++;
			this.targets.syncOverlay(frame);
		}
	}

	private countCells(cellsByRowId: Map<string, Set<string>>): number {
		let count = 0;
		for (const colIds of cellsByRowId.values()) {
			count += colIds.size;
		}
		return count;
	}

	private countRowRanges(rowRanges: readonly { startIndex: number; endIndex: number }[]): number {
		let count = 0;
		for (const range of rowRanges) {
			count += Math.max(0, range.endIndex - range.startIndex + 1);
		}
		return count;
	}

	public getStats(): RenderStats {
		return {
			...this.stats,
			cellsPatchedPerScrollFrame: this.stats.cellsPatchedPerScrollFrame.slice(),
			rowsRecycledPerScrollFrame: this.stats.rowsRecycledPerScrollFrame.slice(),
			lastInvalidationReasons: this.stats.lastInvalidationReasons.slice(),
			lastInvalidations: this.stats.lastInvalidations.slice(),
		};
	}

	public resetStats(): void {
		this.stats.fullPaints = 0;
		this.stats.rowPaints = 0;
		this.stats.cellPaints = 0;
		this.stats.headerPaints = 0;
		this.stats.overlayPaints = 0;
		this.stats.geometryRecomputes = 0;
		this.stats.viewportPaints = 0;
		this.stats.scrollFrames = 0;
		this.stats.viewportRecycles = 0;
		this.stats.headerPaintsDuringScroll = 0;
		this.stats.headerRangeSyncsDuringScroll = 0;
		this.stats.overlayPaintsDuringScroll = 0;
		this.stats.overlayCheapSyncsDuringScroll = 0;
		this.stats.portalFlushesDuringScroll = 0;
		this.stats.portalDeferredDuringScroll = 0;
		this.stats.portalMountsDuringScroll = 0;
		this.stats.portalReleasesDuringScroll = 0;
		this.stats.portalFlushChunks = 0;
		this.stats.maxPortalOpsFlushedInOneChunk = 0;
		this.stats.focusCallsDuringScroll = 0;
		this.stats.rootTextContentWritesOnPortalCells = 0;
		this.stats.cellsBoundDuringScroll = 0;
		this.stats.rowsVisitedDuringScroll = 0;
		this.stats.rowsReboundDuringScroll = 0;
		this.stats.cellsVisitedDuringScroll = 0;
		this.stats.cellsWrittenDuringScroll = 0;
		this.stats.portalOpsDuringScroll = 0;
		this.stats.cellsDecoratedAfterScroll = 0;
		this.stats.postScrollMotionChunks = 0;
		this.stats.maxMotionCellsDecoratedInOneChunk = 0;
		this.stats.motionCellsDecoratedAfterScroll = 0;
		this.stats.postScrollFidelityChunks = 0;
		this.stats.maxFidelityCellsDecoratedInOneChunk = 0;
		this.stats.fidelityCellsDecoratedAfterScroll = 0;
		this.stats.rowsEnteredDuringScroll = 0;
		this.stats.rowsExitedDuringScroll = 0;
		this.stats.rowsStayedDuringScroll = 0;
		this.stats.colsEnteredDuringScroll = 0;
		this.stats.colsExitedDuringScroll = 0;
		this.stats.colsStayedDuringScroll = 0;
		this.stats.columnTopologyDeltaComputations = 0;
		this.stats.columnTopologyDeltaComputationsDuringScroll = 0;
		this.stats.columnTopologyStayedColumns = 0;
		this.stats.columnTopologyEnteredColumns = 0;
		this.stats.columnTopologyExitedColumns = 0;
		this.stats.columnTopologyLaneMoves = 0;
		this.stats.cellsSkippedDuringScroll = 0;
		this.stats.sameWindowBailouts = 0;
		this.stats.cellAccessReadsDuringScroll = 0;
		this.stats.cellClassComputesDuringScroll = 0;
		this.stats.dirtyCellsMarkedDuringScroll = 0;
		this.stats.postScrollDirtyCellsDecorated = 0;
		this.stats.reusableCellsSkippedDuringScroll = 0;
		this.stats.styleHookCallsDuringScroll = 0;
		this.stats.integrityComputesDuringScroll = 0;
		this.stats.forceLiveMountsDuringScroll = 0;
		this.stats.liveReactMountsDuringScroll = 0;
		this.stats.liveReactOverscanMounts = 0;
		this.stats.liveReactUpdatesDuringScroll = 0;
		this.stats.liveReactEmergencyShellsDuringScroll = 0;
		this.stats.domUpdatesDuringScroll = 0;
		this.stats.domUpdatesDeferredDuringScroll = 0;
		this.stats.htmlSnapshotHitsDuringScroll = 0;
		this.stats.htmlSnapshotMissesDuringScroll = 0;
		this.stats.textImpostorUsesDuringScroll = 0;
		this.stats.cellSlotsRetained = 0;
		this.stats.cellSlotsEvictedDuringTopology = 0;
		this.stats.cellSlotsCreatedDuringTopology = 0;
		this.stats.cellSlotsReusedDuringTopology = 0;
		this.stats.maxCellsByColumnIdPerRowSlot = 0;
		this.stats.hotDomReleases = 0;
		this.stats.coldDomReleases = 0;
		this.stats.cellsPatchedPerScrollFrame = [];
		this.stats.rowsRecycledPerScrollFrame = [];
		this.stats.lastInvalidationReasons = [];
		this.stats.lastInvalidations = [];
	}
}
