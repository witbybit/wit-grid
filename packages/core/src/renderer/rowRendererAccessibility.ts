import type { GridEngine } from '../engine/GridEngine.js';
import type { CanonicalGridCellPointer } from '../api/GridApi.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { CellSlot } from './cellSlot.js';
import type { RowSlot } from './rowSlot.js';
import type { ViewportRenderer } from './viewportRenderer.js';

interface SyncRowRendererInteractionAccessibilityInput<TRowData> {
	engine: GridEngine<TRowData>;
	viewportRenderer: ViewportRenderer<TRowData>;
	activeRows: Map<number, RowSlot<TRowData>>;
	state: ReturnType<GridEngine<TRowData>['stateManager']['getState']>;
}

export function syncRowRendererInteractionAccessibility<TRowData>(input: SyncRowRendererInteractionAccessibilityInput<TRowData>): void {
	const { engine, viewportRenderer, activeRows, state } = input;
	const interaction = readInteractionState(state);
	const focusedCell = interaction.focus.cell;
	if (!focusedCell) {
		viewportRenderer.syncActiveDescendant(null);
		return;
	}

	const rowModel = engine.getVisualRowModel();
	const focusedRowIndex = interaction.focus.rowIndex ?? (rowModel ? rowModel.getVisualIndexByRowId(focusedCell.rowId) : null);
	if (focusedRowIndex === null || focusedRowIndex === undefined || focusedRowIndex < 0) {
		viewportRenderer.syncActiveDescendant(null);
		return;
	}

	const rowSlot = activeRows.get(focusedRowIndex);
	const columnIndex = engine.columns.getIndexMapper().idToVisualIndex(focusedCell.columnInstanceId);
	const cellSlot =
		rowSlot?.cellsByColumnInstanceId.get(focusedCell.columnInstanceId) ?? (columnIndex >= 0 ? rowSlot?.getCellForCol(columnIndex) : undefined);
	const focusedCellEl = resolveFocusedCellElement(viewportRenderer, focusedCell, cellSlot);
	if (!focusedCellEl) {
		viewportRenderer.syncActiveDescendant(null);
		return;
	}

	viewportRenderer.syncActiveDescendant(focusedCellEl);
}

function resolveFocusedCellElement<TRowData>(
	viewportRenderer: ViewportRenderer<TRowData>,
	focusedCell: CanonicalGridCellPointer,
	cellSlot: CellSlot<TRowData> | undefined
): HTMLDivElement | null {
	if (cellSlot && cellSlot.binding?.rowId === focusedCell.rowId && cellSlot.element.parentElement !== null) {
		if (!cellSlot.element.id) {
			cellSlot.element.id = `og-cell-${cellSlot.cellInstanceId}`;
		}
		return cellSlot.element;
	}

	const cells = viewportRenderer.scrollViewport?.querySelectorAll<HTMLDivElement>('.og-cell');
	if (!cells) return null;
	for (const cell of cells) {
		if (cell.dataset.rowId !== focusedCell.rowId) continue;
		if (cell.dataset.columnInstanceId === focusedCell.columnInstanceId) {
			ensureFocusedCellId(cell);
			return cell;
		}
	}
	return null;
}

function ensureFocusedCellId(cell: HTMLDivElement): void {
	if (cell.id) return;
	const cellSlot = (cell as HTMLDivElement & { __cellSlot?: { cellInstanceId?: string } }).__cellSlot;
	if (cellSlot?.cellInstanceId) cell.id = `og-cell-${cellSlot.cellInstanceId}`;
}
