import type { GridEngine } from '../engine/GridEngine.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';
import type { GridCellClassParams } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import type { CellRenderer } from './cellRenderer.js';
import { CellSlot } from './cellSlot.js';
import { PortalRendererHandle } from './cellRendererHandle.js';
import type { FullWidthRowRenderer } from './fullWidthRowRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type { PortalMountManager } from './portalMountManager.js';
import { bindCellFull, type RowCellBinderDeps } from './rowCellBinder.js';
import {
	bindAllDataCells,
	bindAllLoadingCells,
	reconcileTopology,
	type BindAllDataCellsRequest,
	type BindAllLoadingCellsRequest,
	type RowCellBindingLaneDeps,
} from './rowCellBindingLanes.js';
import type { CompiledColumnTopology } from './columnTopology.js';
import {
	decorateDirtyCellsAfterScroll as decorateDirtyCellsAfterScrollMaintenance,
	repaintInvalidatedCells as repaintInvalidatedCellsMaintenance,
	repaintInvalidatedRows as repaintInvalidatedRowsMaintenance,
	repaintInvalidatedRowsAndCells as repaintInvalidatedRowsAndCellsMaintenance,
	type DecorateDirtyCellsAfterScrollResult,
	type PostScrollRepairLane,
	type RowCellBindRequest,
	type RowRenderMaintenanceDeps,
} from './rowRenderMaintenance.js';
import type { RowSlot } from './rowSlot.js';
import type { RenderWindow } from './renderWindow.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';
import { reportRendererFault } from './rendererFaults.js';
import type { ViewportPlan } from './viewportPlanner.js';
import type { LiveFrameBudget } from './liveFrameBudget.js';
import type { ProgrammaticScrollTarget } from './programmaticScrollTarget.js';

export interface RowRendererRuntimeArgs<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	cellRenderer: CellRenderer;
	portalMountManager: PortalMountManager<TRowData>;
	viewportContainer: HTMLElement | null | undefined;
	selectionPaint: SelectionPaintManager<TRowData>;
	cellClassScratch: GridCellClassParams<TRowData>;
	fullWidthRenderer: FullWidthRowRenderer<TRowData>;
	currentWindow: RenderWindow | null;
	dirtyCellsAfterScroll: Set<HTMLDivElement>;
	dirtyRowsAfterScroll: Set<number>;
	dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]];
	activeRows: Map<number, RowSlot<TRowData>>;
	initCell: (el: HTMLDivElement) => void;
	releaseCellFn: (cell: CellSlot<TRowData>) => void;
	ensurePinnedContainer: (slot: RowSlot<TRowData>, side: 'left' | 'right', width: number) => HTMLDivElement | null;
	releaseRowPortal: (slot: RowSlot<TRowData>) => boolean;
	ensureCellPortalHost: (cell: HTMLDivElement) => HTMLDivElement;
	getCellPortalHost: (cell: HTMLDivElement) => HTMLDivElement | null;
	markCellDirtyAfterScroll: (cell: HTMLDivElement) => void;
	releaseCellPortal: (
		cell: HTMLDivElement,
		forceDeferred?: boolean,
		reason?: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated',
		portalKey?: string
	) => void;
	applyFocus: (cell: HTMLDivElement) => void;
	isEditorInteractiveElement: (el: Element | null) => boolean;
	isScrolling: boolean;
	isScrollFrameActive: boolean;
	renderStats: any;
	programmaticScrollCell: ProgrammaticScrollTarget | null;
	clearProgrammaticScrollCell: () => void;
	setDeferredFocusCell: (cell: HTMLDivElement) => void;
	incrementStyleHookCallsDuringScroll: () => void;
	incrementCurrentScrollCellsVisited: () => void;
	incrementCurrentScrollCellsPatched: () => void;
	incrementCurrentScrollCellsWritten: () => void;
	incrementPostScrollDirtyCellsDecorated: () => void;
	getColumnShift?: (colIndex: number) => number;
}

export interface RowRendererRuntimeStateHost<TRowData = unknown> {
	cellClassScratch: GridCellClassParams<TRowData>;
	currentWindow: RenderWindow | null;
	dirtyCellsAfterScroll: Set<HTMLDivElement>;
	dirtyRowsAfterScroll: Set<number>;
	dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]];
	activeRows: Map<number, RowSlot<TRowData>>;
	programmaticScrollCell: ProgrammaticScrollTarget | null;
	deferredFocusCell: HTMLDivElement | null;
	runtimeState: RenderRuntimeState;
	renderStats: any;
	currentScrollCellsVisited: number;
	currentScrollCellsPatched: number;
	currentScrollCellsWritten: number;
	currentScrollPortalOps: number;
	postScrollDirtyCellsDecorated: number;
	dirtyCellsMarkedDuringScroll: number;
	/** This frame's ViewportPlan (see viewportPlanner.ts), populated by RowRenderer.recycleViewport
	 *  before the bind loop runs. Null before the first frame. */
	currentViewportPlan?: ViewportPlan | null;
	/** Per-frame live-mode mount/update budget (see liveFrameBudget.ts), configured from
	 *  GridRendererOptions.liveReact and reset by RowRenderer.recycleViewport each frame. */
	liveFrameBudget?: LiveFrameBudget | null;
}

export interface RowRendererRuntimeBridgeDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	cellRenderer: CellRenderer;
	portalMountManager: PortalMountManager<TRowData>;
	getViewportContainer: () => HTMLElement | null | undefined;
	selectionPaint: SelectionPaintManager<TRowData>;
	getFullWidthRenderer: () => FullWidthRowRenderer<TRowData>;
	stateHost: RowRendererRuntimeStateHost<TRowData>;
	initCell: (el: HTMLDivElement) => void;
	releaseCellFn: (cell: CellSlot<TRowData>) => void;
	ensurePinnedContainer: (slot: RowSlot<TRowData>, side: 'left' | 'right', width: number) => HTMLDivElement | null;
	releaseRowPortal: (slot: RowSlot<TRowData>) => boolean;
	getColumnShift?: (colIndex: number) => number;
}

export class RowRendererRuntimeBridge<TRowData = unknown> {
	private readonly runtimeArgs: RowRendererRuntimeArgs<TRowData>;
	private readonly rowCellBinderDeps: RowCellBinderDeps<TRowData>;
	private readonly rowCellBindingLaneDeps: RowCellBindingLaneDeps<TRowData>;
	private readonly rowRenderMaintenanceDeps: RowRenderMaintenanceDeps<TRowData>;

	public constructor(private readonly deps: RowRendererRuntimeBridgeDeps<TRowData>) {
		this.runtimeArgs = {
			engine: this.deps.engine,
			cellRenderer: this.deps.cellRenderer,
			portalMountManager: this.deps.portalMountManager,
			viewportContainer: this.deps.getViewportContainer(),
			selectionPaint: this.deps.selectionPaint,
			cellClassScratch: this.deps.stateHost.cellClassScratch,
			fullWidthRenderer: this.deps.getFullWidthRenderer(),
			currentWindow: this.deps.stateHost.currentWindow,
			dirtyCellsAfterScroll: this.deps.stateHost.dirtyCellsAfterScroll,
			dirtyRowsAfterScroll: this.deps.stateHost.dirtyRowsAfterScroll,
			dirtyBuckets: this.deps.stateHost.dirtyBuckets,
			activeRows: this.deps.stateHost.activeRows,
			initCell: this.deps.initCell,
			releaseCellFn: this.deps.releaseCellFn,
			ensurePinnedContainer: this.deps.ensurePinnedContainer,
			releaseRowPortal: this.deps.releaseRowPortal,
			ensureCellPortalHost: (cell) => this.ensureCellPortalHost(cell),
			getCellPortalHost: (cell) => this.getCellPortalHost(cell),
			markCellDirtyAfterScroll: (cell) => this.markCellDirtyAfterScroll(cell),
			releaseCellPortal: (cell, forceDeferred, reason, portalKey) => this.releaseCellPortal(cell, forceDeferred, reason, portalKey),
			applyFocus: (cell) => this.applyFocus(cell),
			isEditorInteractiveElement: (el) => this.isEditorInteractiveElement(el),
			isScrolling: false,
			isScrollFrameActive: false,
			renderStats: this.deps.stateHost.renderStats,
			programmaticScrollCell: this.deps.stateHost.programmaticScrollCell,
			clearProgrammaticScrollCell: () => {
				this.deps.stateHost.programmaticScrollCell = null;
				this.rowCellBinderDeps.programmaticScrollCell = null;
				this.runtimeArgs.programmaticScrollCell = null;
			},
			setDeferredFocusCell: (cell) => {
				this.deps.stateHost.deferredFocusCell = cell;
			},
			incrementStyleHookCallsDuringScroll: () => {
				if (this.deps.stateHost.renderStats) this.deps.stateHost.renderStats.styleHookCallsDuringScroll++;
			},
			incrementCurrentScrollCellsVisited: () => {
				this.deps.stateHost.currentScrollCellsVisited++;
			},
			incrementCurrentScrollCellsPatched: () => {
				this.deps.stateHost.currentScrollCellsPatched++;
			},
			incrementCurrentScrollCellsWritten: () => {
				this.deps.stateHost.currentScrollCellsWritten++;
			},
			incrementPostScrollDirtyCellsDecorated: () => {
				this.deps.stateHost.postScrollDirtyCellsDecorated++;
			},
			getColumnShift: this.deps.getColumnShift,
		};

		this.rowCellBinderDeps = {
			engine: this.deps.engine,
			cellRenderer: this.deps.cellRenderer,
			portalMountManager: this.deps.portalMountManager,
			selectionPaint: this.deps.selectionPaint,
			cellClassScratch: this.deps.stateHost.cellClassScratch,
			getViewportContainer: () => this.deps.getViewportContainer(),
			getIsScrolling: () => this.deps.stateHost.runtimeState.isScrolling(),
			getIsScrollFrameActive: () => this.deps.stateHost.runtimeState.phase === 'scroll-frame',
			programmaticScrollCell: this.deps.stateHost.programmaticScrollCell,
			clearProgrammaticScrollCell: this.runtimeArgs.clearProgrammaticScrollCell,
			setDeferredFocusCell: this.runtimeArgs.setDeferredFocusCell,
			applyFocus: this.runtimeArgs.applyFocus,
			isEditorInteractiveElement: this.runtimeArgs.isEditorInteractiveElement,
			ensureCellPortalHost: this.runtimeArgs.ensureCellPortalHost,
			getCellPortalHost: this.runtimeArgs.getCellPortalHost,
			markCellDirtyAfterScroll: this.runtimeArgs.markCellDirtyAfterScroll,
			releaseCellPortal: this.runtimeArgs.releaseCellPortal,
			incrementStyleHookCallsDuringScroll: this.runtimeArgs.incrementStyleHookCallsDuringScroll,
			incrementCurrentScrollCellsWritten: this.runtimeArgs.incrementCurrentScrollCellsWritten,
			incrementFullCellBinds: () => {
				if (this.deps.stateHost.renderStats) this.deps.stateHost.renderStats.fullCellBinds++;
			},
			incrementGeometryOnlyCellBinds: () => {
				if (this.deps.stateHost.renderStats) this.deps.stateHost.renderStats.geometryOnlyCellBinds++;
			},
			incrementCellSlotRebinds: () => {
				if (this.deps.stateHost.renderStats) this.deps.stateHost.renderStats.cellSlotRebinds++;
			},
			incrementIntegrityComputesDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.integrityComputesDuringScroll =
						(this.deps.stateHost.renderStats.integrityComputesDuringScroll || 0) + 1;
				}
			},
			incrementForceLiveMountsDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.forceLiveMountsDuringScroll =
						(this.deps.stateHost.renderStats.forceLiveMountsDuringScroll || 0) + 1;
				}
			},
			incrementLiveReactMountsDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.liveReactMountsDuringScroll =
						(this.deps.stateHost.renderStats.liveReactMountsDuringScroll || 0) + 1;
				}
			},
			incrementLiveReactUpdatesDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.liveReactUpdatesDuringScroll =
						(this.deps.stateHost.renderStats.liveReactUpdatesDuringScroll || 0) + 1;
				}
			},
			incrementLiveReactOverscanMountsDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.liveReactOverscanMounts = (this.deps.stateHost.renderStats.liveReactOverscanMounts || 0) + 1;
				}
			},
			incrementLiveReactEmergencyShellsDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.liveReactEmergencyShellsDuringScroll =
						(this.deps.stateHost.renderStats.liveReactEmergencyShellsDuringScroll || 0) + 1;
				}
			},
			tryConsumeLiveBudget: (kind: 'mount' | 'update') => {
				const budget = this.deps.stateHost.liveFrameBudget;
				return budget ? budget.tryConsume(kind) : true;
			},
			tryConsumeDomUpdateBudget: () => {
				const budget = this.deps.stateHost.liveFrameBudget;
				return budget ? budget.beginDomUpdate() : true;
			},
			endDomUpdate: () => {
				this.deps.stateHost.liveFrameBudget?.endDomUpdate();
			},
			incrementDomUpdatesDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.domUpdatesDuringScroll = (this.deps.stateHost.renderStats.domUpdatesDuringScroll || 0) + 1;
				}
			},
			incrementDomUpdatesDeferredDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.domUpdatesDeferredDuringScroll =
						(this.deps.stateHost.renderStats.domUpdatesDeferredDuringScroll || 0) + 1;
				}
			},
			allowLiveEmergencyShell: () => {
				const budget = this.deps.stateHost.liveFrameBudget;
				return budget ? budget.allowEmergencyShell : true;
			},
			incrementHtmlSnapshotHitsDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.htmlSnapshotHitsDuringScroll =
						(this.deps.stateHost.renderStats.htmlSnapshotHitsDuringScroll || 0) + 1;
				}
			},
			incrementHtmlSnapshotMissesDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.htmlSnapshotMissesDuringScroll =
						(this.deps.stateHost.renderStats.htmlSnapshotMissesDuringScroll || 0) + 1;
				}
			},
			incrementTextImpostorUsesDuringScroll: () => {
				if (this.deps.stateHost.renderStats) {
					this.deps.stateHost.renderStats.textImpostorUsesDuringScroll =
						(this.deps.stateHost.renderStats.textImpostorUsesDuringScroll || 0) + 1;
				}
			},
			getHtmlSnapshotDefaults: () => {
				const opts = this.deps.engine.rendererOptions?.htmlSnapshot;
				return {
					allowShellWhenMissing: opts?.allowShellWhenMissing ?? true,
					allowTextFallbackWhenMissing: opts?.allowTextFallbackWhenMissing ?? false,
				};
			},
			getSnapshotVisualVersions: () => ({
				styleVersion: (this.deps.stateHost as unknown as { styleVersion?: number }).styleVersion ?? 0,
				loadingVersion: (this.deps.stateHost as unknown as { loadingVersion?: number }).loadingVersion ?? 0,
			}),
			getColumnShift: this.deps.getColumnShift,
		};

		this.rowCellBindingLaneDeps = {
			engine: this.deps.engine,
			initCell: this.deps.initCell,
			releaseCellFn: this.deps.releaseCellFn,
			ensurePinnedContainer: this.deps.ensurePinnedContainer,
			cellBinderDeps: this.rowCellBinderDeps,
			markCellDirtyAfterScroll: this.runtimeArgs.markCellDirtyAfterScroll,
			releaseCellPortal: this.runtimeArgs.releaseCellPortal,
			ensureLoadingSkeleton: (cell: HTMLDivElement) => this.deps.cellRenderer.ensureLoadingSkeleton(cell),
			onScrollCellVisited: this.runtimeArgs.incrementCurrentScrollCellsVisited,
			onScrollCellPatched: this.runtimeArgs.incrementCurrentScrollCellsPatched,
			onScrollCellWritten: this.runtimeArgs.incrementCurrentScrollCellsWritten,
			retentionStats: this.deps.stateHost.renderStats,
			getRenderedRowCount: () => this.deps.stateHost.activeRows.size,
		};

		this.rowRenderMaintenanceDeps = {
			engine: this.deps.engine,
			selectionPaint: this.deps.selectionPaint,
			cellRenderer: this.deps.cellRenderer,
			activeRows: this.deps.stateHost.activeRows,
			getCurrentWindow: () => this.deps.stateHost.currentWindow,
			dirtyCellsAfterScroll: this.deps.stateHost.dirtyCellsAfterScroll,
			dirtyRowsAfterScroll: this.deps.stateHost.dirtyRowsAfterScroll,
			dirtyBuckets: this.deps.stateHost.dirtyBuckets,
			incrementPostScrollDirtyCellsDecorated: this.runtimeArgs.incrementPostScrollDirtyCellsDecorated,
			bindCellFull: (request: RowCellBindRequest<TRowData>) =>
				bindCellFull(this.rowCellBinderDeps, {
					cellSlot: request.cellSlot as CellSlot<TRowData>,
					slotId: request.slotId,
					slotGeneration: request.slotGeneration,
					node: request.node,
					rowIndex: request.rowIndex,
					colIndex: request.colIndex,
					col: request.col,
					lane: request.lane,
					pinRightBaseLeft: request.pinRightBaseLeft,
					plan: request.plan,
					state: request.state,
					ctx: request.ctx,
					phase: request.phase,
				}),
		};
	}

	public bindFullWidthRow(slot: RowSlot<TRowData>, visualRow: VisualRow<TRowData>): void {
		bindFullWidthRow(this.refreshRuntimeArgs(), slot, visualRow);
	}

	public repaintInvalidatedRowsAndCells(frame: InvalidationFrame): void {
		this.refreshCachedHotState();
		repaintInvalidatedRowsAndCellsMaintenance(this.rowRenderMaintenanceDeps, frame);
	}

	public repaintInvalidatedRows(frame: InvalidationFrame): void {
		this.refreshCachedHotState();
		repaintInvalidatedRowsMaintenance(this.rowRenderMaintenanceDeps, frame);
	}

	public repaintInvalidatedCells(frame: InvalidationFrame): void {
		this.refreshCachedHotState();
		repaintInvalidatedCellsMaintenance(this.rowRenderMaintenanceDeps, frame);
	}

	public decorateDirtyCellsAfterScroll(options?: { maxCells?: number; lane?: PostScrollRepairLane }): DecorateDirtyCellsAfterScrollResult {
		this.refreshCachedHotState();
		return decorateDirtyCellsAfterScrollMaintenance(this.rowRenderMaintenanceDeps, options);
	}

	public bindAllDataCells(request: BindAllDataCellsRequest<TRowData>): void {
		this.refreshCachedHotState();
		bindAllDataCells(this.rowCellBindingLaneDeps, request);
	}

	public bindAllLoadingCells(request: BindAllLoadingCellsRequest<TRowData>): void {
		this.refreshCachedHotState();
		bindAllLoadingCells(this.rowCellBindingLaneDeps, request);
	}

	public markCellDirtyAfterScroll(cell: HTMLDivElement): void {
		if (!this.deps.stateHost.dirtyCellsAfterScroll.has(cell)) {
			this.deps.stateHost.dirtyCellsAfterScroll.add(cell);
			this.deps.stateHost.dirtyCellsMarkedDuringScroll++;
		}
	}

	public releaseCellPortal(
		cell: HTMLDivElement,
		forceDeferred?: boolean,
		reason: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated' = 'scrolled-out',
		portalKey?: string
	): void {
		const cellSlot = CellSlot.fromElement(cell);
		const container = this.getCellPortalHost(cell) ?? cell;
		// Release what the cell actually holds. The portal registry knows exactly which key is wanted
		// in this host; slot bookkeeping is the fallback. The binding key comes last: an edit portal
		// is keyed by row (E…), not by the slot's current cell binding (C…), so it would miss it.
		const heldPortalKey = cellSlot.renderer instanceof PortalRendererHandle ? cellSlot.renderer.portalKey : undefined;
		const cellKey =
			portalKey ??
			this.deps.portalMountManager.getMountedKeyForContainer(container) ??
			heldPortalKey ??
			cellSlot.lastPortalKey ??
			cellSlot.binding?.cellKey ??
			cell.dataset.cellKey;
		if (!cellKey) return;
		const isDeferred = forceDeferred ?? this.deps.stateHost.runtimeState.isScrolling();
		const activeIdentity = this.deps.portalMountManager.getActiveIdentity(cellKey);
		if (!activeIdentity) {
			// Mounted during scroll but still queued: there is nothing to unmount yet, just cancel it.
			if (this.deps.portalMountManager.cancelDeferredMount(cellKey)) return;
			// Already released (or never mounted): callers re-request release from slot bookkeeping
			// that outlives the portal (lastPortalKey, a stale handle), so a repeat is a no-op. Only a
			// cell still recorded as mounted without an identity is a real inconsistency.
			if (!this.deps.portalMountManager.isCellMounted(cellKey)) return;
			reportRendererFault(
				this.deps.engine,
				'release-cell-portal-without-identity',
				new Error(`Missing pooled portal identity for ${cellKey}`),
				{
					cellKey,
					reason,
				}
			);
			return;
		}
		const rowSlotId = activeIdentity.rowSlotId;
		const slotGeneration = activeIdentity.slotGeneration;
		const cellRowBindingGeneration = activeIdentity.cellRowBindingGeneration;
		const cellInstanceId = activeIdentity.cellInstanceId;
		const portalHostId = activeIdentity.portalHostId;

		if (isDeferred) {
			this.deps.stateHost.currentScrollPortalOps++;
			this.deps.portalMountManager.releaseCellForScroll({
				cellKey,
				container,
				flushSync: false,
				rowSlotId,
				slotGeneration,
				cellRowBindingGeneration,
				cellInstanceId,
				portalHostId,
			});
		} else {
			this.deps.portalMountManager.releaseCell({
				cellKey,
				container,
				flushSync: false,
				reason,
				rowSlotId,
				slotGeneration,
				cellRowBindingGeneration,
				cellInstanceId,
				portalHostId,
			});
		}
		// The slot no longer holds this portal; a stale handle would make the next bind release it again.
		if (heldPortalKey === cellKey) cellSlot.renderer = null;
	}

	public applyFocus(cell: HTMLDivElement): void {
		if (this.deps.stateHost.runtimeState.isScrolling()) {
			this.deps.stateHost.deferredFocusCell = cell;
			const renderStats = this.deps.stateHost.renderStats;
			if (renderStats) {
				renderStats.focusCallsDuringScroll++;
			}
			return;
		}
		cell.focus({ preventScroll: true });
	}

	private refreshCachedHotState(): void {
		const stateHost = this.deps.stateHost;
		const runtimeState = stateHost.runtimeState;
		this.rowCellBinderDeps.programmaticScrollCell = stateHost.programmaticScrollCell;
		this.runtimeArgs.programmaticScrollCell = stateHost.programmaticScrollCell;
		this.runtimeArgs.viewportContainer = this.deps.getViewportContainer();
		this.runtimeArgs.currentWindow = stateHost.currentWindow;
		this.runtimeArgs.renderStats = stateHost.renderStats;
		this.runtimeArgs.isScrolling = runtimeState.isScrolling();
		this.runtimeArgs.isScrollFrameActive = runtimeState.phase === 'scroll-frame';
	}

	private refreshRuntimeArgs(): RowRendererRuntimeArgs<TRowData> {
		this.refreshCachedHotState();
		this.runtimeArgs.fullWidthRenderer = this.deps.getFullWidthRenderer();
		return this.runtimeArgs;
	}

	private ensureCellPortalHost(cell: HTMLDivElement): HTMLDivElement {
		this.deps.cellRenderer.getOrCreateCellContentLayer(cell);
		return this.deps.cellRenderer.getOrCreatePortalHost(cell) as HTMLDivElement;
	}

	private getCellPortalHost(cell: HTMLDivElement): HTMLDivElement | null {
		return this.deps.cellRenderer.getPortalHost(cell) as HTMLDivElement | null;
	}

	private isEditorInteractiveElement(el: Element | null): boolean {
		if (!el) return false;
		return el.closest('.og-cell-editor') !== null || el.closest('.og-context-menu') !== null;
	}
}

/** Shared, never-mutated empty topology — reconcileTopology only reads it. */
const EMPTY_TOPOLOGY: CompiledColumnTopology = Object.freeze({
	version: 0,
	placements: [],
	byColumnId: new Map(),
	left: [],
	center: [],
	right: [],
	groupSegments: [],
	pinLeftWidth: 0,
	pinRightWidth: 0,
	pinRightBaseLeft: 0,
	totalContentWidth: 0,
}) as CompiledColumnTopology;
const EMPTY_COLUMNS: never[] = [];

/** Per-args collapse/release callbacks, built once instead of two closures per full-width bind. */
interface FullWidthRowCallbacks<TRowData> {
	collapseLanes: (slot: RowSlot<TRowData>) => void;
	releaseRowPortal: (slot: RowSlot<TRowData>) => void;
}

const fullWidthCallbacksByArgs = new WeakMap<object, FullWidthRowCallbacks<any>>();

function getFullWidthRowCallbacks<TRowData>(args: RowRendererRuntimeArgs<TRowData>): FullWidthRowCallbacks<TRowData> {
	let callbacks = fullWidthCallbacksByArgs.get(args) as FullWidthRowCallbacks<TRowData> | undefined;
	if (!callbacks) {
		callbacks = {
			collapseLanes: (s) => {
				// Clear all data cells via reconcileTopology with an empty topology.
				// This properly removes cells from cellsByColumnInstanceId and calls releaseFn on each.
				const pinLeftContainer = args.ensurePinnedContainer(s, 'left', 0);
				const pinRightContainer = args.ensurePinnedContainer(s, 'right', 0);
				reconcileTopology(s, EMPTY_TOPOLOGY, pinLeftContainer, 0, 0, pinRightContainer, EMPTY_COLUMNS, args.initCell, args.releaseCellFn);
			},
			releaseRowPortal: (s) => {
				args.releaseRowPortal(s);
			},
		};
		fullWidthCallbacksByArgs.set(args, callbacks);
	}
	return callbacks;
}

export function bindFullWidthRow<TRowData>(args: RowRendererRuntimeArgs<TRowData>, slot: RowSlot<TRowData>, visualRow: VisualRow<TRowData>): void {
	const callbacks = getFullWidthRowCallbacks(args);
	args.fullWidthRenderer.bind(slot, visualRow, callbacks.collapseLanes, callbacks.releaseRowPortal);
}
