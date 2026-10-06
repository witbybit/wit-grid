import { isGroupingActive } from '../rows/hierarchyConfig.js';
import { hierarchyCellInputsFor } from '../rows/hierarchyCellModel.js';
import type { ColumnDef } from '../columnDef.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { InternalGridState } from '../state/GridState.js';
import type { VisualRow } from '../visualRow.js';
import type { CellSlot } from './cellSlot.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { RowCellBinderDeps } from './rowCellBinder.js';
import { buildCellPinClass } from './binders/binderShared.js';
import { resolveHierarchyCellModel, writeHierarchyCell, type HierarchyCellDeps, type HierarchyCellModel } from './hierarchyCell.js';
import { reportRendererFault } from './rendererFaults.js';
import type { GridApi } from '../api/GridApiSurfaces.js';
import type { GroupRendererSpec } from '../rows/hierarchyConfig.js';
import { createGroupRenderContext, isSameGroupRenderContext } from './groupRenderContext.js';

export interface BindHierarchyCellRequest<TRowData> {
	cellSlot: CellSlot<TRowData>;
	row: VisualRow<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	left: number;
	width: number;
	state: InternalGridState<TRowData>;
	isScrollFrameActive: boolean;
	/** The row is the stuck copy of a sticky group header. */
	isStuck?: boolean;
}

/** Per-call selection set, rebuilt only when the selection array changes. */
let selectedSetFor: readonly string[] | null = null;
let selectedSet: ReadonlySet<string> = new Set();

/** The narrow slice of binder deps the hierarchy cell needs (both lane and cell binder deps fit). */
export interface HierarchyCellBinderDeps<TRowData> {
	engine: GridEngine<TRowData>;
	releaseCellPortal: (cell: HTMLDivElement) => void;
	onScrollCellVisited?: () => void;
	onScrollCellWritten?: () => void;
	/** The cell binder's focus plumbing (DOM focus, deferral while scrolling). */
	cellBinderDeps?: RowCellBinderDeps<TRowData>;
}

/**
 * Focus and selection for cells of the hierarchy (the hierarchy cell, aggregate cells): the same
 * ARIA / tabindex state, focused class and DOM focus move as data cells get from their controller.
 * Returns the class names to add.
 */
export function applyHierarchyCellFocus<TRowData>(
	deps: HierarchyCellBinderDeps<TRowData>,
	cellSlot: CellSlot<TRowData>,
	rowId: string,
	rowIndex: number,
	colIndex: number,
	col: ColumnDef<TRowData>,
	state: InternalGridState<TRowData>
): string {
	const selection = readInteractionState(state).cellSelection.selection;
	const focus = selection.focus;
	const focused = !!focus && focus.rowId === rowId && focus.colField === col.field;
	const bounds = selection.bounds;
	const selected = !!bounds && rowIndex >= bounds.minRow && rowIndex <= bounds.maxRow && colIndex >= bounds.minCol && colIndex <= bounds.maxCol;
	cellSlot.syncAccessibilityState({ focused, selected, readOnly: true, invalid: false });
	if (!focused) return '';
	const binder = deps.cellBinderDeps;
	const active = typeof document !== 'undefined' ? document.activeElement : null;
	const viewport = binder?.getViewportContainer();
	if (
		binder &&
		active &&
		active !== cellSlot.element &&
		(active === document.body || (viewport?.contains(active) && !binder.isEditorInteractiveElement(active)))
	) {
		binder.applyFocus(cellSlot.element);
	}
	return ' og-cell-focused';
}

/** The reads the hierarchy model needs, bound to the engine and one state snapshot. */
export function createHierarchyDeps<TRowData>(engine: GridEngine<TRowData>, state: InternalGridState<TRowData>): HierarchyCellDeps<TRowData> {
	return {
		getColumn: (field) => engine.columns.getColumnByFieldOrInstanceId(field),
		getCellValue: (rowId, field) => engine.data.getCellValue(rowId, field),
		isRowSelected: (rowId) => {
			const ids = readInteractionState(state).rowSelection.selectedRowIds;
			if (ids !== selectedSetFor) {
				selectedSetFor = ids;
				selectedSet = new Set(ids);
			}
			return selectedSet.has(rowId);
		},
		getDescendantSelection: (id) => engine.groupingFeature.getDescendantSelection(id).state,
	};
}

/**
 * Binds the hierarchy column's cell for a group, total or data row. It never mounts a renderer:
 * the parts are written directly (and diffed), so the cell is current on every scroll frame —
 * a recycled row never shows another row's label, and nothing waits for scroll to settle.
 */
/** The portal row key a React `hierarchyColumn.renderer` is mounted under for this physical cell. */
export function hierarchyCellRowKey(cellSlot: CellSlot<any>): string {
	return `hierarchy-cell:${cellSlot.cellInstanceId}`;
}

/**
 * Draws a cell through `hierarchyColumn.renderer`: a DOM renderer is mounted here and updated in
 * place; a React component is mounted by the adapter into the cell's content element, keyed by the
 * cell (so a recycled cell updates its component instead of remounting). Returns false when the
 * adapter is missing for a React spec, so the built-in cell is drawn instead.
 */
function bindCustomHierarchyCell<TRowData>(
	deps: HierarchyCellBinderDeps<TRowData>,
	cellSlot: CellSlot<TRowData>,
	spec: GroupRendererSpec<TRowData>,
	row: VisualRow<TRowData>,
	model: HierarchyCellModel<TRowData>,
	isStuck: boolean
): boolean {
	const portals = deps.cellBinderDeps?.portalMountManager;
	if (spec.kind === 'react' && !portals) return false;
	const ctx = createGroupRenderContext(deps.engine.getApiRef() as GridApi<TRowData>, row, model, isStuck);
	const key = spec.kind === 'dom' ? spec.renderer : spec.component;
	const mounted = cellSlot.contentMount;
	if (mounted && mounted.renderer === key) {
		const previous = mounted.context as typeof ctx | undefined;
		if (previous && isSameGroupRenderContext(previous, ctx)) return true;
		if (mounted.handle.update) {
			mounted.context = ctx;
			mounted.handle.update(ctx as never);
			return true;
		}
	}
	cellSlot.releaseContentMount();
	cellSlot.hierarchyParts = null;
	cellSlot.contentElement.textContent = '';
	let handle: { update?(ctx: never): void; destroy?(): void };
	if (spec.kind === 'dom') {
		handle = spec.renderer.mount(cellSlot.contentElement, ctx) ?? {};
	} else {
		const rowKey = hierarchyCellRowKey(cellSlot);
		// React owns everything inside its own host element. Core may clear the content element (a
		// rebind to the built-in cell, a remount): that detaches the host whole, so React's later
		// unmount still finds its nodes where it left them.
		const container = document.createElement('div');
		container.className = 'og-hierarchy-cell-host';
		cellSlot.contentElement.appendChild(container);
		const draw = (next: typeof ctx) => portals!.mountRow({ rowKey, container, visualRow: next.row, renderer: spec, context: next });
		draw(ctx);
		handle = { update: draw, destroy: () => portals!.releaseRow({ rowKey, container }) };
	}
	cellSlot.contentMount = { renderer: key, handle, rowId: row.id, value: undefined, context: ctx };
	return true;
}

export function bindHierarchyCell<TRowData>(deps: HierarchyCellBinderDeps<TRowData>, request: BindHierarchyCellRequest<TRowData>): void {
	const { cellSlot, row, rowIndex, colIndex, col, lane, left, width, state, isScrollFrameActive } = request;
	const baseClass = buildCellPinClass(lane);
	if (isScrollFrameActive) deps.onScrollCellVisited?.();
	if (cellSlot.lastPortalKey) deps.releaseCellPortal(cellSlot.element);

	const model = resolveHierarchyCellModel(row, hierarchyCellInputsFor(state, col), createHierarchyDeps(deps.engine, state));
	const rowId = row.kind === 'data' ? row.rowId : row.id;
	if (!model) {
		cellSlot.releaseContentMount();
		if (cellSlot.hierarchyParts) {
			cellSlot.contentElement.textContent = '';
			cellSlot.hierarchyParts = null;
		}
		cellSlot.update(colIndex, col.field, rowIndex, rowId, left, -1, width, `${baseClass} og-cell-hierarchy`, 'empty', undefined, '', undefined);
		return;
	}
	// The renderer draws groups, totals and tree rows. A grouped grid's leaf rows are not groups: they
	// keep the built-in cell (indent only), which also keeps React work during scroll to group rows.
	const spec = state.hierarchyColumn && !(row.kind === 'data' && isGroupingActive(state.grouping)) ? state.hierarchyColumn.renderer : undefined;
	let custom = false;
	if (spec) {
		try {
			custom = bindCustomHierarchyCell(deps, cellSlot, spec, row, model, request.isStuck === true);
		} catch (error) {
			reportRendererFault(deps.engine, 'hierarchy-cell-renderer', error, { rowId, rowIndex, colField: col.field, colIndex });
			cellSlot.releaseContentMount();
		}
	}
	if (!custom) {
		cellSlot.releaseContentMount();
		cellSlot.hierarchyParts = writeHierarchyCell(cellSlot.contentElement, cellSlot.hierarchyParts, model);
	}
	const focusClass = applyHierarchyCellFocus(deps, cellSlot, rowId, rowIndex, colIndex, col, state);
	const didWrite = cellSlot.update(
		colIndex,
		col.field,
		rowIndex,
		rowId,
		left,
		-1,
		width,
		`${baseClass} ${model.cellClass}${focusClass}`,
		'custom',
		undefined,
		'',
		undefined
	);
	if (isScrollFrameActive && didWrite) deps.onScrollCellWritten?.();
}
