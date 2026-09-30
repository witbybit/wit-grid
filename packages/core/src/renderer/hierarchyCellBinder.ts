import type { ColumnDef } from '../columnDef.js';
import { readInteractionState } from '../interaction/interactionState.js';
import { isGroupingActive } from '../rows/hierarchyConfig.js';
import type { InternalGridState } from '../state/GridState.js';
import type { VisualRow } from '../visualRow.js';
import type { CellSlot } from './cellSlot.js';
import type { GridEngine } from '../engine/GridEngine.js';
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

	const model = resolveHierarchyCellModel(
		row,
		{
			config: state.hierarchyColumn || undefined,
			treeColumn: state.treeData?.column,
			isTree: !isGroupingActive(state.grouping) && !!state.treeData,
		},
		createDeps(deps, state)
	);
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
	const didWrite = cellSlot.update(
		colIndex,
		col.field,
		rowIndex,
		rowId,
		left,
		-1,
		width,
		`${baseClass} ${model.cellClass}`,
		'custom',
		undefined,
		'',
		undefined
	);
	if (isScrollFrameActive && didWrite) deps.onScrollCellWritten?.();
}
