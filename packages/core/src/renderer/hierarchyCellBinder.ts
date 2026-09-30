import { hierarchyCellInputsFor } from '../rows/hierarchyCellModel.js';
import type { ColumnDef } from '../columnDef.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { InternalGridState } from '../state/GridState.js';
import type { VisualRow } from '../visualRow.js';
import type { CellSlot } from './cellSlot.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { RowCellBinderDeps } from './rowCellBinder.js';
import { buildCellPinClass } from './binders/binderShared.js';
import { resolveHierarchyCellModel, writeHierarchyCell, type HierarchyCellDeps } from './hierarchyCell.js';

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
		if (binder.getIsScrolling()) binder.setDeferredFocusCell(cellSlot.element);
		else binder.applyFocus(cellSlot.element);
	}
	return ' og-cell-focused';
}

function createDeps<TRowData>(deps: HierarchyCellBinderDeps<TRowData>, state: InternalGridState<TRowData>): HierarchyCellDeps<TRowData> {
	const engine = deps.engine;
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
export function bindHierarchyCell<TRowData>(deps: HierarchyCellBinderDeps<TRowData>, request: BindHierarchyCellRequest<TRowData>): void {
	const { cellSlot, row, rowIndex, colIndex, col, lane, left, width, state, isScrollFrameActive } = request;
	const baseClass = buildCellPinClass(lane);
	if (isScrollFrameActive) deps.onScrollCellVisited?.();
	if (cellSlot.lastPortalKey) deps.releaseCellPortal(cellSlot.element);

	const model = resolveHierarchyCellModel(row, hierarchyCellInputsFor(state, col), createDeps(deps, state));
	const rowId = row.kind === 'data' ? row.rowId : row.id;
	if (!model) {
		if (cellSlot.hierarchyParts) {
			cellSlot.contentElement.textContent = '';
			cellSlot.hierarchyParts = null;
		}
		cellSlot.update(colIndex, col.field, rowIndex, rowId, left, -1, width, `${baseClass} og-cell-hierarchy`, 'empty', undefined, '', undefined);
		return;
	}
	cellSlot.hierarchyParts = writeHierarchyCell(cellSlot.contentElement, cellSlot.hierarchyParts, model);
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
