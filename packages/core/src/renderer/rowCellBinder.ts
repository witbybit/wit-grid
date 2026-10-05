import { bindHierarchyCell } from './hierarchyCellBinder.js';
import { isHierarchyColumn } from '../rows/hierarchyColumn.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { createEditRendererKey, createCellInstanceRendererKey } from './identityKeys.js';
import { reportRendererFault } from './rendererFaults.js';
import type { CellRendererPhase, ColumnDef, ColumnInstanceId, GridCellClassParams, InternalColumnDef } from '../columnDef.js';
import { getColumnInstanceIdentity, getValueByPath } from '../columnDef.js';

import { normalizeCapabilityResult } from '../capabilities/capabilityTypes.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import { isCellSlotMountedFreshAt, recordCellSlotMountedVisualVersions, type CellSlot, type CellContentMode } from './cellSlot.js';
import {
	TextRendererHandle,
	FallbackRendererHandle,
	PortalRendererHandle,
	LoadingRendererHandle,
	CustomRendererHandle,
} from './cellRendererHandle.js';
import type { CellRenderer } from './cellRenderer.js';
import type { PortalMountManager } from './portalMountManager.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';
import type { ViewportPlan } from './viewportPlanner.js';
import { compileStyleRules, evaluateCellStyleRules } from '../styling/styleRules.js';
import {
	collectCellDecorationSnapshotMetadata,
	createCellDisplaySnapshot,
	mergeCellSnapshotTitle,
	type CellDisplaySnapshot,
} from './cellDisplaySnapshot.js';

import type { ScrollCellPresentationDeps, ScrollCellPresentationInput } from './scrollCellPresentation.js';
import {
	dispatchCellPresentation,
	type CellBindGeometry,
	type CellBindRuntime,
	type DispatchCellPresentationInput,
} from './binders/cellPresentationDispatcher.js';
import { buildCellPinClass, getScrollMountValue } from './binders/binderShared.js';
import { getOrCreateCellCtrl, createRowCtrl, type RowCtrl } from './controllers/RowCtrl.js';
import type { CellCtrl } from './controllers/CellCtrl.js';
import { CellCtrlStore } from './controllers/CellCtrlStore.js';
import { resolveCellCtrlPresentationState, resolveCellCtrlScrollDecisionState } from './controllers/resolveCellCtrlPresentationState.js';
import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { ProgrammaticScrollTarget } from './programmaticScrollTarget.js';
import { getProgrammaticScrollCellPointer } from './programmaticScrollTarget.js';

const fallbackCellCtrlStores = new WeakMap<object, CellCtrlStore<any>>();

function subtractNormalizedClassName(fullClassName: string, baseClassName: string): string {
	// Fast path: no state classes on top of the base (the common unfocused/unselected cell).
	if (fullClassName === baseClassName) return '';
	const fullTokens = fullClassName.trim().split(/\s+/).filter(Boolean);
	if (fullTokens.length === 0) return '';
	const baseTokenSet = new Set(baseClassName.trim().split(/\s+/).filter(Boolean));
	return fullTokens.filter((token) => !baseTokenSet.has(token)).join(' ');
}

/** The snapshot for (rowId, column) if it is visually fresh against this scroll frame — the same
 *  six-dimension predicate as isVisualFresh, compared over scalars so the per-cell path allocates
 *  no expected-freshness object. */
function getFreshCellSnapshot<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	rowId: string,
	col: ColumnDef<TRowData>,
	ctx: ScrollRenderContext<TRowData>,
	rowVersion: number
): CellDisplaySnapshot | undefined {
	const snapshotLookup = deps.engine as GridEngine<TRowData> & {
		getCellDisplaySnapshot?: (rowId: string, columnInstanceId: ColumnInstanceId | string) => CellDisplaySnapshot | undefined;
		cellDisplaySnapshots?: { get: (rowId: string, columnInstanceId: ColumnInstanceId | string) => CellDisplaySnapshot | undefined };
	};
	const snapshotKey = getColumnInstanceIdentity(col);
	const snapshot = snapshotLookup.getCellDisplaySnapshot?.(rowId, snapshotKey) ?? snapshotLookup.cellDisplaySnapshots?.get(rowId, snapshotKey);
	if (!snapshot) return undefined;
	const isFresh =
		snapshot.rowVersion === rowVersion &&
		snapshot.globalVersion === ctx.globalVersion &&
		snapshot.insightVersion === ctx.insightVersion &&
		snapshot.styleVersion === ctx.styleVersion &&
		snapshot.loadingVersion === ctx.loadingVersion &&
		snapshot.selectionVersion === ctx.selectionVersion;
	return isFresh ? snapshot : undefined;
}

export interface SnapshotVisualVersions {
	styleVersion: number;
	loadingVersion: number;
}

export interface RowCellBinderDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	cellRenderer: CellRenderer;
	portalMountManager: PortalMountManager<TRowData>;
	selectionPaint: SelectionPaintManager<TRowData>;
	cellClassScratch: GridCellClassParams<TRowData>;
	getViewportContainer: () => HTMLElement | null | undefined;
	getIsScrolling: () => boolean;
	getIsScrollFrameActive: () => boolean;
	programmaticScrollCell: ProgrammaticScrollTarget | null;
	clearProgrammaticScrollCell: () => void;
	setDeferredFocusCell: (cell: HTMLDivElement) => void;
	applyFocus: (cell: HTMLDivElement) => void;
	isEditorInteractiveElement: (el: Element | null) => boolean;
	ensureCellPortalHost: (cell: HTMLDivElement) => HTMLDivElement;
	getCellPortalHost: (cell: HTMLDivElement) => HTMLDivElement | null;
	markCellDirtyAfterScroll: (cell: HTMLDivElement) => void;
	releaseCellPortal: (
		cell: HTMLDivElement,
		forceDeferred?: boolean,
		reason?: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated',
		portalKey?: string
	) => void;
	incrementStyleHookCallsDuringScroll: () => void;
	incrementCurrentScrollCellsWritten: () => void;
	incrementFullCellBinds?: () => void;
	incrementGeometryOnlyCellBinds?: () => void;
	incrementCellSlotRebinds?: () => void;
	incrementIntegrityComputesDuringScroll?: () => void;
	incrementForceLiveMountsDuringScroll?: () => void;
	/** `scroll: 'live'` fresh portal mounts during scroll — distinct from the rare
	 *  forceLiveMountsDuringScroll interactive exception (see scrollCellPresentation.ts), and from
	 *  incrementLiveReactUpdatesDuringScroll (re-renders of an already-mounted live cell). */
	incrementLiveReactMountsDuringScroll?: () => void;
	/** A live cell already mounted (React re-render, not a fresh portal mount) — budgeted separately
	 *  from incrementLiveReactMountsDuringScroll by liveFrameBudget.ts. */
	incrementLiveReactUpdatesDuringScroll?: () => void;
	incrementLiveReactOverscanMountsDuringScroll?: () => void;
	/** A live-mount was deferred to a stand-in placeholder because the frame's mount budget was
	 *  exhausted (see liveFrameBudget.ts, GridRendererOptions.live). */
	incrementLiveReactStandInsDuringScroll?: () => void;
	/** Returns false when this frame's live-mode budget for `kind` is exhausted. Omitted (or a
	 *  caller-side default of always-true) means unlimited — see liveFrameBudget.ts. */
	tryConsumeLiveBudget?: (kind: 'mount' | 'update') => boolean;
	/** Admits one in-frame DOM renderer update (`scroll: 'live'` on a DOM renderer) against the frame's DOM-work budget. */
	tryConsumeDomUpdateBudget?: () => boolean;
	/** Computes (and caches) a getter/formula cell's display text within the frame's budget; undefined when over it. */
	primeDisplayValueInFrame?: (rowId: string, colField: string) => string | undefined;
	/** Ends the admitted update, charging its duration to the frame's DOM-work budget. */
	endDomUpdate?: () => void;
	/** A DOM renderer cell updated in place during scroll. */
	incrementDomUpdatesDuringScroll?: () => void;
	/** A DOM renderer cell the frame budget refused (shown as a stand-in until scroll settles). */
	incrementDomUpdatesDeferredDuringScroll?: () => void;
	getSnapshotVisualVersions: () => SnapshotVisualVersions;
	/** Live column-reorder preview offset (px) for a displayed column index.
	 *  0 outside an active header drag. Only consulted on the full-bind path. */
	getColumnShift?: (colIndex: number) => number;
	/** Called once per cell whose resolved presentation this frame was 'live-mount' — lets the
	 *  caller's ViewportPlan.liveRows/liveCenterColumns (see viewportPlanner.ts) reflect what the
	 *  resolver actually decided, without this binder needing to know about ViewportPlan itself. */
}

export interface BindCellFullRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	slotId: string;
	/** Physical slot generation — incremented on each row rebind. Required for stale-mount detection. */
	slotGeneration: number;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	pinRightBaseLeft: number;
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	state: InternalGridState<TRowData>;
	ctx?: ScrollRenderContext<TRowData>;
	phase?: CellRendererPhase;
	/** Attached RowCtrl for this row, when the caller already resolved one this frame (bindAllDataCells
	 *  resolves it once per row, not once per cell). Falls back to engine.rowCtrls.getOrCreate(node.id)
	 *  when omitted — kept optional so existing direct callers/tests are unaffected. */
	rowCtrl?: RowCtrl<TRowData>;
}

export interface BindCellDuringScrollRequest<TRowData = unknown> {
	cellSlot: CellSlot<TRowData>;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	ctx: ScrollRenderContext<TRowData>;
	pooledRowId: string;
	/** Physical slot generation — required for stale-mount detection in deferred flush. */
	pooledRowGeneration: number;
	left: number;
	right: number;
	width: number;
	isRowRebind: boolean;
	isRowLoading: boolean;
	isInVisibleContent: boolean;
	viewportPlan?: ViewportPlan | null;
	/** Attached RowCtrl for this row, when the caller already resolved one this frame. Falls back to
	 *  engine.rowCtrls.getOrCreate(node.id) when omitted. */
	rowCtrl?: RowCtrl<TRowData>;
}

function applyValueFormatter<TRowData>(col: ColumnDef<TRowData>, value: unknown, node: RowNode<TRowData>): string {
	if (col.valueFormatter) {
		return col.valueFormatter({ value, rowData: node.data as TRowData, colDef: col, rowId: node.id });
	}
	if (value == null) return '';
	return String(value);
}

function getCheapCellText<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	cellSlot?: CellSlot<TRowData>,
	ctx?: ScrollRenderContext<TRowData>,
	versions?: { rowVersion: number; globalVersion: number }
): string {
	const isScrolling = ctx ? ctx.isScrolling : deps.getIsScrollFrameActive() || deps.engine.isScrolling;
	if (isScrolling) {
		const cachedVal = deps.engine.data.getCachedDisplayValue(node.id, col.field);
		if (cachedVal !== undefined) {
			if (!col.valueFormatter) return cachedVal;
			// The formatter must see the raw value, exactly as the non-scroll path below hands it —
			// not the cache's String() of it.
			const rawForFormatter =
				col.valueGetter || deps.engine.hasFormula(node.id, col.field)
					? (deps.engine.data.getCachedCellValue?.(node.id, col.field) ?? cachedVal)
					: node.data
						? (node.data as Record<string, unknown>)[col.field]
						: cachedVal;
			return applyValueFormatter(col, rawForFormatter, node);
		}
		// Warm DOM may accelerate only when it still belongs to this exact row/column — otherwise
		// it's a different row's leftover text and must not be shown as a stand-in for this one.
		const isSameIdentity = !!cellSlot && cellSlot.rowId === node.id && cellSlot.colField === col.field;
		return isSameIdentity ? (cellSlot!.lastFormattedValue ?? '') : '';
	}
	if (col.valueGetter || deps.engine.hasFormula(node.id, col.field)) {
		const val = deps.engine.data.getCellValue(node.id, col.field);
		return applyValueFormatter(col, val, node);
	}
	const raw = node.data ? (node.data as Record<string, unknown>)[col.field] : undefined;
	// Plain field + formatter: memoize the formatter output per (row, column), keyed on the row/global
	// versions plus the raw value and row object, so an unchanged cell doesn't re-run it on every
	// full bind. Formula strings ('=...') never reach here — hasFormula() is checked above.
	const data = deps.engine.data;
	if (col.valueFormatter && versions && data.getCachedFormattedValue && !(typeof raw === 'string' && raw.startsWith('='))) {
		const columnKey = getColumnInstanceIdentity(col);
		const cached = data.getCachedFormattedValue(node.id, columnKey, versions.rowVersion, versions.globalVersion, raw, node.data);
		if (cached !== undefined) return cached;
		const text = applyValueFormatter(col, raw, node);
		data.setCachedFormattedValue(node.id, columnKey, versions.rowVersion, versions.globalVersion, raw, node.data, text);
		return text;
	}
	return applyValueFormatter(col, raw, node);
}

/**
 * WS2: Assign the appropriate CellRendererHandle based on the resolved content mode.
 * Destroys the previous handle when the renderer kind changes or the portal key rotates.
 * Text/fallback handles are updated in-place to avoid allocation when kind is stable.
 */
function assignRendererHandle<TRowData>(cellSlot: CellSlot<TRowData>, contentMode: CellContentMode, formattedValue: string, portalKey: string): void {
	const existing = cellSlot.renderer;

	if (contentMode === 'text') {
		if (existing instanceof TextRendererHandle) {
			existing.formattedValue = formattedValue;
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new TextRendererHandle<TRowData>(formattedValue);
		}
	} else if (contentMode === 'fallback') {
		if (existing instanceof FallbackRendererHandle) {
			existing.formattedValue = formattedValue;
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new FallbackRendererHandle<TRowData>(formattedValue);
		}
	} else if (contentMode === 'portal') {
		if (existing instanceof PortalRendererHandle && existing.portalKey === portalKey) {
			// Same portal key — renderer is still active; no structural change.
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new PortalRendererHandle<TRowData>(portalKey);
		}
	} else if (contentMode === 'loading') {
		if (existing instanceof LoadingRendererHandle) {
			// Already loading — no change.
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new LoadingRendererHandle<TRowData>();
		}
	} else if (contentMode === 'custom') {
		if (existing instanceof CustomRendererHandle) {
			// Custom content owner manages its own lifecycle.
		} else {
			if (existing !== null) existing.destroy();
			cellSlot.renderer = new CustomRendererHandle<TRowData>();
		}
	} else {
		// 'empty' | 'pending' — no active renderer
		if (existing !== null) {
			existing.destroy();
			cellSlot.renderer = null;
		}
	}
}

/**
 * Attaches/reuses the CellCtrl for this (rowId, columnInstanceId), stamping only attachment and
 * focus/edit bookkeeping. Semantic presentation state is resolved separately and written onto
 * CellCtrl before any binder mutates the physical CellSlot.
 */
function attachCellCtrl<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: {
		cellSlot: CellSlot<TRowData>;
		node: RowNode<TRowData>;
		col: ColumnDef<TRowData>;
		rowCtrl?: RowCtrl<TRowData>;
		rowIndex?: number;
		colIndex?: number;
	},
	isEditing: boolean,
	isFocused: boolean,
	rowCtrl: RowCtrl<TRowData>
): CellCtrl {
	const { cellSlot, node, col } = request;
	const rowCtrlStore = deps.engine.rowCtrls;
	const instanceId = getColumnInstanceIdentity(col);
	let cellCtrl: CellCtrl;
	const bound = cellSlot.boundCellCtrl;
	if (rowCtrlStore && bound && !bound.lifecycle.destroyed && bound.rowId === node.id && bound.columnInstanceId === instanceId) {
		// Fast path: the slot already presents this exact (row, column) controller — the common
		// warm rebind during scroll. Same bookkeeping getOrCreate's reuse branch performs, without
		// rebuilding the controller key or the metadata/input objects.
		cellCtrl = bound;
		if (request.rowIndex !== undefined) cellCtrl.rowIndex = request.rowIndex;
		cellCtrl.rowCtrlKey = rowCtrl.rowId;
		if (request.colIndex !== undefined) cellCtrl.colIndex = request.colIndex;
		if (rowCtrl.cellKeysByColumnInstanceId.get(instanceId) !== cellCtrl.key) rowCtrl.cellKeysByColumnInstanceId.set(instanceId, cellCtrl.key);
		rowCtrlStore.stats.cellCtrlsReused++;
	} else {
		// Defensive fallback for lightweight test doubles that construct a partial `engine` mock without
		// a real RowCtrlStore — a real GridEngine always has `rowCtrls` (see GridEngine.ts), so this only
		// ever triggers in tests, producing a throwaway, unshared store rather than crashing.
		let cellCtrlStore = rowCtrlStore?.cellCtrls ?? fallbackCellCtrlStores.get(rowCtrl as object);
		if (!cellCtrlStore) {
			cellCtrlStore = new CellCtrlStore<TRowData>();
			fallbackCellCtrlStores.set(rowCtrl as object, cellCtrlStore);
		}
		const metadata = {
			rowIndex: request.rowIndex,
			rowCtrlKey: rowCtrl.rowId,
			colId: col.colId ?? col.field,
			colField: col.field,
			colIndex: request.colIndex,
		};
		// A slot recycled to another row: hand its controller over rather than releasing it and
		// allocating a new one (only where the release would have happened anyway).
		if (
			rowCtrlStore &&
			bound &&
			bound.columnInstanceId === instanceId &&
			rowCtrlStore.rekeyDetachedCellCtrl(bound, cellSlot.cellInstanceId, { ...metadata, rowId: rowCtrl.rowId, columnInstanceId: instanceId })
		) {
			cellCtrl = bound;
			rowCtrl.cellKeysByColumnInstanceId.set(instanceId, cellCtrl.key);
		} else {
			const result = getOrCreateCellCtrl(rowCtrl, cellCtrlStore, instanceId, metadata);
			cellCtrl = result.cellCtrl;
			if (rowCtrlStore) {
				if (result.created) rowCtrlStore.stats.cellCtrlsCreated++;
				else rowCtrlStore.stats.cellCtrlsReused++;
			}
		}
	}
	// Hand the previously presented controller (another row's) back to its store — this is what
	// bounds CellCtrl lifetime to the physical slot pool rather than to every row ever visited.
	cellSlot.attachCellCtrl(cellCtrl, rowCtrlStore ?? null);
	cellCtrl.lifecycle.attachedSlotInstanceId = cellSlot.cellInstanceId;
	cellCtrl.visualState.editing = isEditing;
	cellCtrl.visualState.focused = isFocused;
	if (isEditing) rowCtrl.isEditing = true;
	if (isFocused) rowCtrl.isFocused = true;
	return cellCtrl;
}

function recordCellCtrlPhysicalBinding<TRowData>(cellCtrl: CellCtrl, cellSlot: CellSlot<TRowData>): void {
	cellCtrl.lifecycle.attachedSlotInstanceId = cellSlot.cellInstanceId;
}

/**
 * Per-binder-deps adapter onto the resolver's narrow ScrollCellPresentationDeps. Built once per
 * deps object (not once per cell). The resolver never retains its deps, so sharing one adapter is safe.
 */
const scrollDepsByBinderDeps = new WeakMap<object, ScrollCellPresentationDeps>();

function getScrollDecisionDeps<TRowData>(deps: RowCellBinderDeps<TRowData>): ScrollCellPresentationDeps {
	let adapter = scrollDepsByBinderDeps.get(deps);
	if (!adapter) {
		adapter = {
			getCellPortalHost: (cell) => deps.getCellPortalHost(cell),
			getCheapDisplayValue: (rowId, colField) => deps.engine.getCheapDisplayValue?.(rowId, colField),
			primeDisplayValue: (rowId, colField) => deps.primeDisplayValueInFrame?.(rowId, colField),
			getCachedCellValue: (rowId, colField) => deps.engine.data?.getCachedCellValue?.(rowId, colField),
			hasFormula: (rowId, colField) => deps.engine.hasFormula?.(rowId, colField) ?? true,
		};
		scrollDepsByBinderDeps.set(deps, adapter);
	}
	return adapter;
}

/**
 * Scratch objects for the per-cell scroll bind. None of the callees retain them (the resolver and
 * the binders copy what they keep), so one set is reused per cell instead of allocating ~5 objects.
 * The in-use flag makes a re-entrant bind (user renderer code synchronously triggering another
 * bind) fall back to fresh objects rather than clobbering the outer bind's inputs.
 */
let scrollScratchInUse = false;
const scrollInputScratch = {} as ScrollCellPresentationInput<any>;
const scrollGeometryScratch: CellBindGeometry = { rowIndex: 0, colIndex: 0, left: 0, right: 0, width: 0, dragShift: 0, lane: 'center' };
const scrollRuntimeScratch: CellBindRuntime<any> = { globalVersion: 0, rowSlotId: '', slotGeneration: 0 };
const scrollDispatchScratch = {
	phase: 'scroll',
	viewportPlan: null,
	rowVersion: -1,
	geometry: scrollGeometryScratch,
	runtime: scrollRuntimeScratch,
} as unknown as DispatchCellPresentationInput<any>;

function fillScrollDispatchInput<TRowData>(
	target: DispatchCellPresentationInput<TRowData>,
	deps: RowCellBinderDeps<TRowData>,
	request: BindCellDuringScrollRequest<TRowData>,
	cellCtrl: CellCtrl,
	rowCtrl: RowCtrl<TRowData>,
	rowVersion: number,
	mountValue?: unknown
): DispatchCellPresentationInput<TRowData> {
	target.deps = deps;
	target.cellCtrl = cellCtrl;
	target.rowCtrl = rowCtrl;
	target.cellSlot = request.cellSlot;
	target.viewportPlan = request.viewportPlan ?? null;
	target.phase = 'scroll';
	target.rowVersion = rowVersion;
	const geometry = target.geometry;
	geometry.rowIndex = request.rowIndex;
	geometry.colIndex = request.colIndex;
	geometry.left = request.left;
	geometry.right = request.right;
	geometry.width = request.width;
	geometry.dragShift = deps.getColumnShift ? deps.getColumnShift(request.colIndex) : 0;
	geometry.lane = request.lane;
	const runtime = target.runtime;
	runtime.globalVersion = request.ctx.globalVersion;
	runtime.rowSlotId = request.pooledRowId;
	runtime.slotGeneration = request.pooledRowGeneration;
	runtime.rowHeight = deps.engine.geometry?.rowHeights?.[request.rowIndex];
	runtime.colWidth = request.ctx.plan?.colWidths?.[request.colIndex];
	runtime.checkbox = undefined;
	runtime.mount =
		mountValue === undefined
			? undefined
			: {
					node: request.node,
					col: request.col,
					value: mountValue,
					isLoading: request.isRowLoading,
					isSelected: false,
					renderPhase: 'scroll' as const,
				};
	return target;
}

function createScrollDispatchInput<TRowData>(): DispatchCellPresentationInput<TRowData> {
	return {
		phase: 'scroll',
		viewportPlan: null,
		rowVersion: -1,
		geometry: { rowIndex: 0, colIndex: 0, left: 0, right: 0, width: 0, dragShift: 0, lane: 'center' },
		runtime: { globalVersion: 0, rowSlotId: '', slotGeneration: 0 },
	} as unknown as DispatchCellPresentationInput<TRowData>;
}

function isCellSelectedInBounds(selectionBounds: ScrollRenderContext['selectionBounds'], rowIndex: number, colIndex: number): boolean {
	return (
		!!selectionBounds &&
		rowIndex >= selectionBounds.minRow &&
		rowIndex <= selectionBounds.maxRow &&
		colIndex >= selectionBounds.minCol &&
		colIndex <= selectionBounds.maxCol
	);
}

export function bindCellFull<TRowData>(deps: RowCellBinderDeps<TRowData>, request: BindCellFullRequest<TRowData>): void {
	if (isHierarchyColumn(request.col)) {
		const cellLeft = request.plan.colLefts[request.colIndex];
		const left = request.lane === 'right' ? cellLeft - request.pinRightBaseLeft : cellLeft;
		if (bindHierarchyCellFor(deps, request, left, request.plan.colWidths[request.colIndex], false)) return;
	}
	clearAggregateText(request.cellSlot);
	deps.incrementFullCellBinds?.();
	deps.incrementCellSlotRebinds?.();
	const { cellSlot, slotId, node, rowIndex, colIndex, col, lane, pinRightBaseLeft, plan, state, ctx, phase = 'initial' } = request;
	const access = deps.engine.cellAccess.get(node.id, rowIndex, node, node.data, colIndex, col, undefined, state);
	const rowVersion = deps.engine.rowVersions.get(node.id) ?? -1;
	const snapshotVisualVersions = deps.getSnapshotVisualVersions();
	const currentVisualVersions = {
		insightVersion: deps.engine.insights.getVersion(),
		styleVersion: snapshotVisualVersions.styleVersion,
		loadingVersion: snapshotVisualVersions.loadingVersion,
		selectionVersion: deps.engine.selectionVersion,
	};
	const interaction = readInteractionState(state);
	const rowCtrl = request.rowCtrl ?? deps.engine.rowCtrls?.getOrCreate(node.id) ?? createRowCtrl(node.id);
	const cellCtrl = attachCellCtrl(deps, request, access.isEditing, access.isFocused, rowCtrl);
	cellCtrl.visualState.selected = access.isSelected;

	const baseCellClassName = buildCellPinClass(lane);
	let cellClassName = baseCellClassName;
	if (access.isFocused) {
		cellClassName += ' og-cell-focused';
		const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
		if (
			activeEl &&
			(activeEl === document.body ||
				(deps.getViewportContainer() &&
					deps.getViewportContainer()!.contains(activeEl) &&
					activeEl !== cellSlot.element &&
					!cellSlot.element.contains(activeEl) &&
					!deps.isEditorInteractiveElement(activeEl)))
		) {
			// applyFocus decides whether the move waits for scroll end.
			deps.applyFocus(cellSlot.element);
		}
	}

	if (access.isSelected) cellClassName += ' og-cell-selected';
	if (access.isLoading) cellClassName += ' og-cell-loading';

	// Readonly visual indicator
	if (col.canEdit !== undefined && node.data !== null) {
		const isEditable = normalizeCapabilityResult(
			col.canEdit({ action: 'edit', row: node.data as TRowData, rowId: node.id, colField: col.field })
		).allowed;
		if (!isEditable) cellClassName += ' og-cell-readonly';
	}

	// Insight layer decorations — read-only overlay; must not mutate row data or DOM directly.
	// This is the integrity/insights compute site. It must never fire on the scroll hot path
	// (bindCellDuringScroll never calls it) — the counter proves that contract holds.
	if (deps.getIsScrolling()) deps.incrementIntegrityComputesDuringScroll?.();
	const cellDecorations = deps.engine.insights.getCellDecorations(node.id, col.field);
	const decorationMetadata = collectCellDecorationSnapshotMetadata(cellDecorations);
	cellClassName += decorationMetadata.classNameSuffix;
	const insightTitle = decorationMetadata.insightTitle;
	const validationDecTitle = decorationMetadata.validationError;

	// Sync data-validation-error for ValidationTooltipController (hover tooltip).
	const compiledStyleRules = compileStyleRules(state.styleRules);
	if (compiledStyleRules.hasCellRules && node.data) {
		try {
			const s = deps.cellClassScratch;
			s.row = node.data;
			s.rowId = node.id;
			s.rowIndex = rowIndex;
			s.col = col;
			s.colField = col.field;
			s.colIndex = colIndex;
			s.isFocused = access.isFocused;
			s.isRowFocused = access.isRowFocused;
			s.isRowSelected = access.isRowSelected || access.isRowFocused;
			s.isSelected = access.isSelected;
			s.isEditing = access.isEditing;
			s.value = access.value;
			s.rawValue = access.rawValue;
			s.isLoading = access.isLoading;
			s.selection = interaction.cellSelection.selection;
			const customCellClass = evaluateCellStyleRules(compiledStyleRules, col, node.data, s);
			if (customCellClass) cellClassName += ' ' + customCellClass;
		} catch (e) {
			reportRendererFault(deps.engine, 'cell-class', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
		}
	}

	const cellLeft = plan.colLefts[colIndex];
	const leftArg = lane === 'right' ? cellLeft - pinRightBaseLeft : cellLeft;
	const cellWidth = plan.colWidths[colIndex];
	const dragShift = deps.getColumnShift ? deps.getColumnShift(colIndex) : 0;
	const stableKey = access.isEditing
		? createEditRendererKey(node.id, getColumnInstanceIdentity(col))
		: createCellInstanceRendererKey(cellSlot.cellInstanceId, getColumnInstanceIdentity(col));
	const scrollMode = plan.columnPlans[colIndex]?.mode;
	let contentMode: CellContentMode = 'empty';
	let formattedValue = '';
	let portalStandInValue = '';

	if (col.checkboxSelection) {
		const rowId = node.id;
		const isChecked = !!deps.selectionPaint.getSelectedRowIdSet(interaction.rowSelection.selectedRowIds)?.has(rowId);
		cellClassName += ' og-cell-row-selector';
		resolveCellCtrlPresentationState({
			cellCtrl,
			rowCtrl,
			viewportPlan: null,
			phase: 'full-bind',
			context: {
				fullBind: {
					className: cellClassName,
					title: null,
					contentMode: 'custom',
					presentationKind: 'checkbox-selector',
					formattedValue: '',
					freshness: { rowVersion, globalVersion: state.globalVersion, ...currentVisualVersions },
					value: access.rawValue,
				},
			},
		});
		dispatchCellPresentation({
			deps,
			cellCtrl,
			rowCtrl,
			cellSlot,
			viewportPlan: null,
			geometry: { rowIndex, colIndex, left: leftArg, right: -1, width: cellWidth, dragShift, lane },
			runtime: {
				globalVersion: state.globalVersion,
				rowSlotId: slotId,
				slotGeneration: request.slotGeneration,
				rowHeight: deps.engine.geometry?.rowHeights?.[rowIndex],
				colWidth: cellWidth,
				checkbox: {
					checked: isChecked,
					ariaLabel: isChecked ? `Deselect row ${rowIndex + 1}` : `Select row ${rowIndex + 1}`,
					title: 'Select row. Shift-click selects a range.',
				},
			},
			phase: 'full-bind',
			rowVersion,
		});
		assignRendererHandle(cellSlot, 'custom', '', stableKey);
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = state.globalVersion;
		recordCellSlotMountedVisualVersions(cellSlot, currentVisualVersions);
		recordCellCtrlPhysicalBinding(cellCtrl, cellSlot);
		return;
	}

	if (((col as InternalColumnDef<TRowData>).cellRenderer || access.isEditing) && !access.isLoading) {
		contentMode = 'portal';
		const formattedForStandIn =
			access.value != null && col.valueFormatter
				? col.valueFormatter({ value: access.value, rowData: node.data as TRowData, colDef: col, rowId: node.id })
				: access.value != null
					? String(access.value)
					: deps.engine.getCheapDisplayValue(node.id, col.field);
		const scrollText = (col as InternalColumnDef<TRowData>).cellRendererCapabilities?.scrollText;
		portalStandInValue =
			scrollText != null
				? scrollText({ value: access.value, formattedValue: formattedForStandIn }) || formattedForStandIn
				: formattedForStandIn;
	} else {
		if (access.isLoading) {
			contentMode = 'loading';
		} else {
			formattedValue = getCheapCellText(deps, node, col, cellSlot, ctx, { rowVersion, globalVersion: state.globalVersion });
			contentMode = formattedValue === '' ? 'empty' : 'text';
		}
	}

	// Cell tooltip (title attribute) — only for data rows with tooltip defined
	let tooltipText: string | null = null;
	if (col.tooltip !== undefined && node.data !== null) {
		tooltipText =
			typeof col.tooltip === 'string'
				? col.tooltip
				: col.tooltip({ row: node.data as TRowData, rowId: node.id, colField: col.field, value: access.rawValue });
	}
	const mergedTitle = mergeCellSnapshotTitle(tooltipText, insightTitle);
	resolveCellCtrlPresentationState({
		cellCtrl,
		rowCtrl,
		viewportPlan: null,
		phase: 'full-bind',
		context: {
			fullBind: {
				className: cellClassName,
				title: mergedTitle,
				validationError: validationDecTitle,
				contentMode,
				formattedValue: contentMode === 'portal' ? portalStandInValue : formattedValue,
				portalKey: contentMode === 'portal' ? stableKey : undefined,
				freshness: { rowVersion, globalVersion: state.globalVersion, ...currentVisualVersions },
				value: access.rawValue,
			},
		},
	});
	dispatchCellPresentation({
		deps,
		cellCtrl,
		rowCtrl,
		cellSlot,
		viewportPlan: null,
		geometry: { rowIndex, colIndex, left: leftArg, right: -1, width: cellWidth, dragShift, lane },
		runtime: {
			globalVersion: state.globalVersion,
			rowSlotId: slotId,
			slotGeneration: request.slotGeneration,
			rowHeight: deps.engine.geometry?.rowHeights?.[rowIndex],
			colWidth: cellWidth,
			mount:
				contentMode === 'portal'
					? {
							node,
							col,
							value: access.value,
							isLoading: access.isLoading,
							isSelected: access.isSelected,
							renderPhase: (access.isEditing ? 'edit' : phase) as CellRendererPhase,
						}
					: undefined,
		},
		phase: 'full-bind',
		rowVersion,
	});

	// WS2: assign the renderer handle based on the resolved content mode.
	// Destroy the previous handle when the renderer kind or portal key changes.
	assignRendererHandle(cellSlot, contentMode, formattedValue, stableKey);
	const fullBindHasStandInCapability = scrollMode === 'custom-live' || scrollMode === 'custom-imperative' || scrollMode === 'custom';
	const snapshotContentKind =
		contentMode === 'portal'
			? !access.isEditing && fullBindHasStandInCapability && portalStandInValue !== ''
				? 'stand-in'
				: 'portal-live'
			: contentMode;
	const snapshotContentMode = contentMode === 'portal' && snapshotContentKind === 'stand-in' ? ('fallback' as const) : contentMode;
	if (snapshotContentMode === 'fallback' && deps.engine.flightRecorder?.isActive()) {
		deps.engine.flightRecorder.recordObservedFallback('cell-renderer', 'stand-in-content');
	}
	const snapshotFormattedValue = contentMode === 'portal' && snapshotContentKind === 'stand-in' ? portalStandInValue : formattedValue;
	deps.engine.cellDisplaySnapshots.set(
		createCellDisplaySnapshot({
			rowId: node.id,
			columnInstanceId: getColumnInstanceIdentity(col),
			colField: col.field,
			rowVersion,
			globalVersion: state.globalVersion,
			insightVersion: currentVisualVersions.insightVersion,
			styleVersion: currentVisualVersions.styleVersion,
			loadingVersion: currentVisualVersions.loadingVersion,
			selectionVersion: currentVisualVersions.selectionVersion,
			baseClassName: baseCellClassName,
			stateClassName: subtractNormalizedClassName(cellClassName, baseCellClassName + decorationMetadata.classNameSuffix),
			decorationClassName: decorationMetadata.classNameSuffix,
			contentKind: snapshotContentKind,
			contentMode: snapshotContentMode,
			formattedValue: snapshotFormattedValue,
			title: cellSlot.element.title,
			validationError: validationDecTitle,
		})
	);

	// Drag handle — injected when col.canDrag is defined (opt-in). Stored on the element to avoid re-querying.
	const el = cellSlot.element as HTMLDivElement & { _dragHandle?: HTMLDivElement };
	const shouldDrag =
		col.canDrag !== undefined &&
		normalizeCapabilityResult(col.canDrag({ action: 'drag', row: node.data as TRowData, rowId: node.id, colField: col.field })).allowed;
	if (shouldDrag) {
		let handle = el._dragHandle;
		if (!handle) {
			handle = document.createElement('div');
			handle.className = 'og-drag-handle';
			handle.innerHTML =
				'<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.4"/><circle cx="11" cy="4" r="1.4"/><circle cx="5" cy="8" r="1.4"/><circle cx="11" cy="8" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="11" cy="12" r="1.4"/></svg>';
			// Pointer events handle drag; the viewport's delegated mousedown listener
			// (SelectionPaintManager.onViewportMouseDown) stops propagation for .og-drag-handle
			// targets to prevent range selection.
			el.appendChild(handle);
			el._dragHandle = handle;
		}
		handle.dataset.dragRowId = node.id;
	} else if (el._dragHandle) {
		el._dragHandle.remove();
		delete el._dragHandle;
	}
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = state.globalVersion;
	recordCellSlotMountedVisualVersions(cellSlot, currentVisualVersions);
	recordCellCtrlPhysicalBinding(cellCtrl, cellSlot);
}

/** A data bind never inherits a group / total row's aggregate text (see CellSlot.hasAggregateText). */
function clearAggregateText<TRowData>(cellSlot: CellSlot<TRowData>): void {
	cellSlot.releaseContentMount();
	if (!cellSlot.hasAggregateText) return;
	cellSlot.hasAggregateText = false;
	cellSlot.clearText();
}

/** Every bind path draws the hierarchy column the same way (see hierarchyCellBinder.ts). */
function bindHierarchyCellFor<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	request: { cellSlot: CellSlot<TRowData>; rowIndex: number; colIndex: number; col: ColumnDef<TRowData>; lane: 'left' | 'center' | 'right' },
	left: number,
	width: number,
	isScrollFrameActive: boolean
): boolean {
	const row = deps.engine.getVisualRowModel()?.getVisualRow(request.rowIndex);
	if (!row) return false;
	bindHierarchyCell(
		{ engine: deps.engine, releaseCellPortal: (cell) => deps.releaseCellPortal(cell), cellBinderDeps: deps },
		{ ...request, row, left, width, state: deps.engine.stateManager.getState(), isScrollFrameActive }
	);
	return true;
}

/**
 * Cell style-rule classes for a cell entering view during scroll, or undefined when they cannot be
 * evaluated without a semantic read (a getter or formula column) and stay deferred to settle.
 * Returns '' when no rule matches: the class is then known, not deferred.
 */
function evaluateScrollStyleRuleClass<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	ctx: ScrollRenderContext<TRowData>,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	rowIndex: number,
	colIndex: number,
	isFocused: boolean,
	isEditing: boolean
): string | undefined {
	const rules = ctx.compiledStyleRules;
	if (!rules?.hasCellRules || !node.data || col.valueGetter || deps.engine.hasFormula(node.id, col.field)) return undefined;
	try {
		const value = getValueByPath(node.data, col.field);
		const s = deps.cellClassScratch;
		s.row = node.data;
		s.rowId = node.id;
		s.rowIndex = rowIndex;
		s.col = col;
		s.colField = col.field;
		s.colIndex = colIndex;
		s.isFocused = isFocused;
		s.isRowFocused = !!ctx.focusedCell && ctx.focusedCell.rowId === node.id;
		s.isRowSelected = false;
		s.isSelected = isCellSelectedInBounds(ctx.selectionBounds, rowIndex, colIndex);
		s.isEditing = isEditing;
		s.value = value;
		s.rawValue = value;
		s.isLoading = false;
		deps.incrementStyleHookCallsDuringScroll();
		return evaluateCellStyleRules(rules, col, node.data, s);
	} catch (e) {
		reportRendererFault(deps.engine, 'cell-class', e, { rowId: node.id, rowIndex, colField: col.field, colIndex });
		return undefined;
	}
}

export function bindCellDuringScroll<TRowData>(deps: RowCellBinderDeps<TRowData>, request: BindCellDuringScrollRequest<TRowData>): void {
	if (isHierarchyColumn(request.col) && bindHierarchyCellFor(deps, request, request.left, request.width, true)) return;
	clearAggregateText(request.cellSlot);
	deps.incrementGeometryOnlyCellBinds?.();
	deps.incrementCellSlotRebinds?.();
	const { cellSlot, node, rowIndex, colIndex, col, lane, ctx, isRowRebind, isRowLoading, isInVisibleContent } = request;
	const rowCtrl = request.rowCtrl ?? deps.engine.rowCtrls?.getOrCreate(node.id) ?? createRowCtrl<TRowData>(node.id);

	// 1. Geometry / warm-state precomputation shared by every presentation kind.
	const canPreserveWarmVisuals = !isRowRebind && cellSlot.rowId === node.id && cellSlot.colField === col.field && !isRowLoading;
	const rowVersion = ctx.rowVersions?.get(node.id) ?? -1;
	const isWarmBindingVersionFresh = canPreserveWarmVisuals && isCellSlotMountedFreshAt(cellSlot, rowVersion, ctx);
	const cellKey = cellSlot.getRendererKey(getColumnInstanceIdentity(col));
	const snapshot = getFreshCellSnapshot(deps, node.id, col, ctx, rowVersion);
	const isFocused = doesCanonicalCellPointerMatchColumn(ctx.focusedCell, node.id, col);
	const isEditing = doesCanonicalCellPointerMatchColumn(ctx.activeEdit, node.id, col);
	const cellCtrl = attachCellCtrl(deps, request, isEditing, isFocused, rowCtrl);
	cellCtrl.visualState.selected = isCellSelectedInBounds(ctx.selectionBounds, rowIndex, colIndex);

	// Focus tab-index bookkeeping is independent of which presentation gets resolved below —
	// it applies whenever this cell is the focused cell, regardless of content.
	if (isFocused) {
		const programmaticScrollCell = getProgrammaticScrollCellPointer(deps.programmaticScrollCell);
		const isProgrammatic = doesCanonicalCellPointerMatchColumn(programmaticScrollCell, node.id, col);
		// Keyboard navigation keeps DOM focus through its own scroll; applyFocus defers otherwise.
		deps.applyFocus(cellSlot.element);
		if (isProgrammatic) deps.clearProgrammaticScrollCell();
	}

	// Cell style rules (conditional formatting) are drawn as the cell enters view, like its text:
	// evaluated on the row when there is no fresh snapshot or warm class to reuse. A column whose
	// value needs a getter or formula keeps the deferred refresh (its value is a semantic read).
	const styleRuleClass =
		ctx.hasDeferredCellStyleRules && !snapshot && !(isWarmBindingVersionFresh && cellSlot.lastClassName) && !isRowLoading
			? evaluateScrollStyleRuleClass(deps, ctx, node, col, rowIndex, colIndex, isFocused, isEditing)
			: undefined;

	// Likewise, deferring a style refresh to the fidelity lane is a decision independent of the
	// content presentation itself.
	const shouldDeferCellStyleRefresh =
		isInVisibleContent &&
		((ctx.hasInsightDecorations && !snapshot) ||
			(ctx.hasDeferredCellStyleRules &&
				!snapshot &&
				styleRuleClass === undefined &&
				(ctx.selectionChangedDuringScroll || !isWarmBindingVersionFresh || ctx.styleChangedDuringScroll || ctx.loadingChangedDuringScroll)));
	if (shouldDeferCellStyleRefresh) {
		deps.markCellDirtyAfterScroll(cellSlot.element);
		deps.incrementStyleHookCallsDuringScroll();
	}

	const useScratch = !scrollScratchInUse;
	scrollScratchInUse = true;
	try {
		// 2. Resolve what to show — the only place that decides, never mutates. Deliberately adapted
		// down to the resolver's narrow ScrollCellPresentationDeps here, not the full binder deps bag —
		// see the type comment on ScrollCellPresentationDeps for why.
		const input = useScratch ? (scrollInputScratch as ScrollCellPresentationInput<TRowData>) : ({} as ScrollCellPresentationInput<TRowData>);
		input.cellSlot = cellSlot;
		input.node = node;
		input.rowIndex = rowIndex;
		input.colIndex = colIndex;
		input.col = col;
		input.lane = lane;
		input.ctx = ctx;
		input.isRowRebind = isRowRebind;
		input.isRowLoading = isRowLoading;
		input.isInVisibleContent = isInVisibleContent;
		input.snapshot = snapshot;
		input.isWarmBindingVersionFresh = isWarmBindingVersionFresh;
		input.rowVersion = rowVersion;
		input.cellKey = cellKey;
		input.styleRuleClass = styleRuleClass;
		resolveCellCtrlScrollDecisionState(cellCtrl, getScrollDecisionDeps(deps), input);

		// 3. Dispatch to the mode-specific binder — enqueues fidelity work, updates mounted slot bookkeeping.
		dispatchCellPresentation(
			fillScrollDispatchInput(
				useScratch ? (scrollDispatchScratch as DispatchCellPresentationInput<TRowData>) : createScrollDispatchInput<TRowData>(),
				deps,
				request,
				cellCtrl,
				rowCtrl,
				rowVersion,
				cellCtrl.presentationState.kind === 'live-renderer' || cellCtrl.presentationState.kind === 'dom-update'
					? getScrollMountValue(deps, request.node, request.col, request.cellSlot, request.isRowLoading)
					: undefined
			)
		);
	} finally {
		if (useScratch) scrollScratchInUse = false;
	}
	recordCellCtrlPhysicalBinding(cellCtrl, cellSlot);
}
