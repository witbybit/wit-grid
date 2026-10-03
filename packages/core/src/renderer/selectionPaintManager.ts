import type { GridEngine } from '../engine/GridEngine.js';

import type { GridRowClassParams } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import type { RowSlot } from './rowSlot.js';
import { readInteractionState } from '../interaction/interactionState.js';
import { reportRendererFault } from './rendererFaults.js';
import { compileStyleRules, evaluateRowStyleRules } from '../styling/styleRules.js';

/**
 * Owns all row-selection UI state and row class painting logic.
 * Extracted from RowRenderer to give it a clear single responsibility.
 *
 * Covers:
 *  - `selectedRowIdSet` — O(1) checked-row lookup rebuilt each frame
 *  - `hoveredRowIndex` — current hovered row for og-row-hovered class
 *  - `updateRowClassNameSlot` — computes full row className outside scroll frames
 */
export class SelectionPaintManager<TRowData> {
	public hoveredRowIndex: number | null = null;
	public selectedRowIdSet: Set<string> | null = null;
	private lastSelectedRowIdsRef: readonly string[] | null = null;

	private readonly rowClassScratch: GridRowClassParams<TRowData> = {
		row: null as unknown as TRowData,
		rowId: '',
		rowIndex: 0,
		isFocused: false,
		isSelected: false,
		isLoading: false,
		selection: null as unknown,
	} as GridRowClassParams<TRowData>;

	constructor(private readonly engine: GridEngine<TRowData>) {}

	public rebuildSelection(selectedRowIds: readonly string[]): void {
		if (this.lastSelectedRowIdsRef === selectedRowIds) {
			return;
		}
		this.lastSelectedRowIdsRef = selectedRowIds;
		this.selectedRowIdSet = selectedRowIds.length > 0 ? new Set(selectedRowIds) : null;
	}

	public getSelectedRowIdSet(selectedRowIds?: readonly string[]): Set<string> | null {
		if (selectedRowIds) {
			this.rebuildSelection(selectedRowIds);
		}
		return this.selectedRowIdSet;
	}

	public updateRowClassNameSlot(
		slot: RowSlot<TRowData>,
		node: RowNode<TRowData>,
		rowIndex: number,
		state = this.engine.stateManager.getState()
	): void {
		const interaction = readInteractionState(state);
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;

		const { focus, cellSelection } = interaction;
		const bounds = cellSelection.selection.bounds;
		const focusedRowId = focus.cell?.rowId ?? null;
		const isFocusedRow = focusedRowId === node.id;
		const isSelectedRow = !!bounds && rowIndex >= bounds.minRow && rowIndex <= bounds.maxRow;
		const isLoadingRow = this.engine.data.isRowLoading(node.id);
		let rowClassName = 'og-row';
		if (rowIndex < pinTopRows) {
			rowClassName += ' og-row-pinned-top';
		} else if (rowIndex >= rowCount - pinBottomRows) {
			rowClassName += ' og-row-pinned-bottom';
		}
		if (this.hoveredRowIndex === rowIndex) {
			rowClassName += ' og-row-hovered';
		}
		if (isSelectedRow || isFocusedRow) {
			rowClassName += ' og-row-selected';
		}
		if (isFocusedRow) {
			rowClassName += ' og-row-focused';
		}
		if (this.selectedRowIdSet?.has(node.id)) {
			rowClassName += ' og-row-node-selected';
		}
		if (isLoadingRow) {
			rowClassName += ' og-row-loading';
		}
		const compiledStyleRules = compileStyleRules(state.styleRules);
		if (compiledStyleRules.hasRowRules && node.data) {
			try {
				const rs = this.rowClassScratch;
				rs.row = node.data;
				rs.rowId = node.id;
				rs.rowIndex = rowIndex;
				rs.isFocused = isFocusedRow;
				rs.isSelected = isSelectedRow || isFocusedRow;
				rs.isLoading = isLoadingRow;
				rs.selection = cellSelection.selection;
				const customRowClass = evaluateRowStyleRules(compiledStyleRules, node.data, rs);
				if (customRowClass) {
					rowClassName += ' ' + customRowClass;
				}
			} catch (e) {
				reportRendererFault(this.engine, 'row-style-class', e, { rowId: node.id, rowIndex });
			}
		}

		// Insight layer row decorations — read-only overlay; must not mutate row data.
		const rowDecorations = this.engine.insights.getRowDecorations(node.id);
		for (const d of rowDecorations) {
			if (d.className) rowClassName += ' ' + d.className;
		}

		slot.update(rowIndex, slot.visualRowId, 'data', slot.rowTop, slot.rowHeight, rowClassName);
	}

	/** Returns the pre-allocated rowClassScratch for use in the hot scroll path (recycleViewport). */
	public get rowClassScratchRef(): GridRowClassParams<TRowData> {
		return this.rowClassScratch;
	}
}
