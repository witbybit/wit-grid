import type { VisualRow } from '../visualRow.js';
import { isHierarchyColumn } from '../rows/hierarchyColumn.js';
import type { CanonicalGridCellPointer, GridCellPointer } from '../api/GridApi.js';
import type { GridPluginRuntime, ScrollToCellOptions, ScrollToRowOptions } from '../api/GridApiSurfaces.js';
import type { GridSelectionSource, RowSelectionChangeResult, RowSelectionGesture } from '../api/GridApi.js';
import { areCanonicalCellPointersEqual, findColumnByCellPointer, findColumnIndexByCellPointer, resolveCanonicalCellPointer } from './cellPointer.js';
import { readInteractionState } from './interactionState.js';
import { getColumnInstanceIdentity, type ColumnDef } from '../columnDef.js';

export interface GridNavigationOptions {
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

/** Rows focus can rest on: data rows, and group / total rows (cell rows of the hierarchy). */
function isCellRow<TRowData>(row: VisualRow<TRowData> | null | undefined): row is Extract<VisualRow<TRowData>, { kind: 'data' | 'group' | 'total' }> {
	return row?.kind === 'data' || row?.kind === 'group' || row?.kind === 'total';
}

export interface GridInteractionCommandPort {
	selectCell(pointer: GridCellPointer | null, source?: GridSelectionSource): void;
	selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource): void;
	applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null;
	selectRows(rowIds: string[], options?: { mode?: 'add' | 'replace' }): void;
	deselectRows(rowIds: string[]): void;
	copySelectedRange(): Promise<void>;
	pasteFromClipboard(): Promise<void>;
	scrollToCell(rowId: string, colField: string): void;
	scrollToRow(rowId: string): void;
	startEditing(rowId: string, colFieldOrInstanceId: string, source?: 'keyboard' | 'mouse' | 'api'): void;
	updateEditDraft(rowId: string, colFieldOrInstanceId: string, value: unknown): void;
	stopEditing(cancel?: boolean): void;
	commitEdit(rowId: string, colFieldOrInstanceId: string, value: unknown): Promise<boolean>;
	setCellValue(rowId: string, colField: string, value: unknown): void;
}

export type GridInteractionInputCommand =
	| { kind: 'key-down'; event: KeyboardEvent }
	| { kind: 'mouse-down-cell'; pointer: GridCellPointer; event: MouseEvent }
	| { kind: 'cell-click'; pointer: GridCellPointer; event: MouseEvent }
	| { kind: 'cell-enter'; pointer: GridCellPointer }
	| { kind: 'mouse-up' }
	| { kind: 'set-cell-editing'; rowId: string; colFieldOrInstanceId: string; isEditing: boolean; source?: 'keyboard' | 'mouse' | 'api' }
	| { kind: 'row-checkbox-click'; rowId: string; checked: boolean; event: MouseEvent }
	| { kind: 'data-row-click'; pointer: GridCellPointer; event: MouseEvent }
	| { kind: 'viewport-mouse-down'; event: MouseEvent };

export interface GridInteractionHandle {
	dispatchInput(command: GridInteractionInputCommand): void;
	isEditingCell(pointer: GridCellPointer): boolean;
	isRowSelectionIgnoredTarget(el: Element | null): boolean;
	updateOptions(options: GridNavigationOptions): void;
	dispose(): void;
}

export class GridInteractionController<TRowData = unknown> implements GridInteractionHandle {
	private isSelecting = false;
	private rowSelectionAnchorId: string | null = null;
	private editNavigationIntent = 0;
	private editNavigationInFlight = false;
	private pendingEditNavigation: {
		intent: number;
		active: GridCellPointer;
		target: { row: number; col: number };
		startEditing: boolean;
	} | null = null;
	private options: GridNavigationOptions;
	private readonly commands: GridInteractionCommandPort;

	constructor(
		private readonly runtime: GridPluginRuntime<TRowData>,
		options: GridNavigationOptions = {},
		commands?: GridInteractionCommandPort
	) {
		this.options = options;
		this.commands = commands ?? {
			selectCell: (pointer, source) => this.runtime.selectCell(pointer, source),
			selectRange: (start, end, source) => this.runtime.selectRange(start, end, source),
			applyRowSelectionGesture: (gesture) => this.runtime.applyRowSelectionGesture(gesture),
			selectRows: (rowIds, rowOptions) => this.runtime.selectRows(rowIds, rowOptions),
			deselectRows: (rowIds) => this.runtime.deselectRows(rowIds),
			copySelectedRange: () => this.runtime.copySelectedRange(),
			pasteFromClipboard: () => this.runtime.pasteFromClipboard(),
			scrollToCell: (rowId, colField) => this.runtime.scrollToCell(rowId, colField),
			scrollToRow: (rowId) => this.runtime.scrollToRow(rowId),
			startEditing: (rowId, colFieldOrInstanceId, source) => this.runtime.startEditing(rowId, colFieldOrInstanceId, source),
			updateEditDraft: (rowId, colFieldOrInstanceId, value) => this.runtime.updateEditDraft(rowId, colFieldOrInstanceId, value),
			stopEditing: (cancel) => this.runtime.stopEditing(cancel),
			commitEdit: (rowId, colFieldOrInstanceId, value) => this.runtime.commitEdit(rowId, colFieldOrInstanceId, value),
			setCellValue: (rowId, colField, value) => this.runtime.setCellValue(rowId, colField, value),
		};
	}

	public updateOptions(options: GridNavigationOptions): void {
		this.options = options;
	}

	public dispose(): void {}

	public dispatchInput(command: GridInteractionInputCommand): void {
		switch (command.kind) {
			case 'key-down':
				this.handleKeyDown(command.event);
				return;
			case 'mouse-down-cell':
				this.handleMouseDown(command.pointer, command.event);
				return;
			case 'cell-click':
				this.handleClick(command.pointer);
				return;
			case 'cell-enter':
				this.handleMouseEnter(command.pointer);
				return;
			case 'mouse-up':
				this.handleMouseUp();
				return;
			case 'set-cell-editing':
				this.setCellEditing(command.rowId, command.colFieldOrInstanceId, command.isEditing, command.source);
				return;
			case 'row-checkbox-click':
				this.handleRowCheckboxClick(command.rowId, command.checked, command.event);
				return;
			case 'data-row-click':
				this.handleDataRowClick(command.pointer, command.event);
				return;
			case 'viewport-mouse-down':
				this.handleViewportMouseDown(command.event);
				return;
		}
	}

	private getDisplayedColumnAtIndex(colIdx: number): ColumnDef<TRowData> | undefined {
		return this.runtime.getDisplayedColumns()[colIdx];
	}

	private resolvePointerColumn(pointer: GridCellPointer): ColumnDef<TRowData> | undefined {
		const explicitColumn = findColumnByCellPointer(this.runtime.getDisplayedColumns(), pointer);
		if (explicitColumn && (pointer.columnInstanceId || pointer.colId)) return explicitColumn;
		const access = this.runtime.getCellAccessByPointer(pointer);
		if (access) return access.column;
		return explicitColumn;
	}

	private getPointerFromCoords(rowIdx: number, colIdx: number): CanonicalGridCellPointer | null {
		const visualRow = this.runtime.getVisualRow(rowIdx);
		const col = this.getDisplayedColumnAtIndex(colIdx);
		if (!visualRow || !col || !isCellRow(visualRow)) return null;
		const colField = col.field;
		return {
			// Group and total rows are addressed by their visual row id.
			rowId: visualRow.kind === 'data' ? visualRow.rowId : visualRow.id,
			colField,
			columnInstanceId: getColumnInstanceIdentity(col),
			colId: col?.colId ?? colField,
		};
	}

	private getCoordsFromPointer(pointer: GridCellPointer | null): { rowIdx: number; colIdx: number } | null {
		if (!pointer) return null;
		const rowIdx = this.runtime.getVisualIndexByRowId(pointer.rowId) ?? -1;
		const colIdx = findColumnIndexByCellPointer(this.runtime.getDisplayedColumns(), pointer);
		if (rowIdx !== -1 && colIdx !== -1 && (pointer.columnInstanceId || pointer.colId)) {
			return { rowIdx, colIdx };
		}
		const access = this.runtime.getCellAccessByPointer(pointer);
		if (access) return { rowIdx: access.rowIndex, colIdx: access.colIndex };
		if (rowIdx === -1 || colIdx === -1) return null;
		return { rowIdx, colIdx };
	}

	/**
	 * The next row focus can move to. `withHierarchyRows`: group and total rows too (navigation);
	 * without it data rows only (edit navigation — hierarchy rows are never edited).
	 */
	private getNextDataRowIndex(currentIndex: number, direction: 'up' | 'down', withHierarchyRows = false): number {
		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return -1;
		const rowCount = rowModel.getVisualRowCount();
		let idx = currentIndex + (direction === 'down' ? 1 : -1);
		while (idx >= 0 && idx < rowCount) {
			const row = rowModel.getVisualRow(idx);
			if (row?.kind === 'data' || (withHierarchyRows && isCellRow(row))) return idx;
			idx += direction === 'down' ? 1 : -1;
		}
		return -1;
	}

	private getTabTarget(row: number, col: number, maxCol: number, forward: boolean, withHierarchyRows = false): { row: number; col: number } | null {
		if (forward) {
			if (col < maxCol) return { row, col: col + 1 };
			const nextRow = this.getNextDataRowIndex(row, 'down', withHierarchyRows);
			return nextRow === -1 ? null : { row: nextRow, col: 0 };
		}
		if (col > 0) return { row, col: col - 1 };
		const prevRow = this.getNextDataRowIndex(row, 'up', withHierarchyRows);
		return prevRow === -1 ? null : { row: prevRow, col: maxCol };
	}

	private clampToDataRow(idx: number, preferDir: 'up' | 'down'): number {
		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return idx;
		const count = rowModel.getVisualRowCount();
		if (count === 0) return idx;
		const clamped = Math.max(0, Math.min(count - 1, idx));
		if (isCellRow(rowModel.getVisualRow(clamped))) return clamped;
		const near = this.getNextDataRowIndex(clamped, preferDir, true);
		if (near !== -1) return near;
		const far = this.getNextDataRowIndex(clamped, preferDir === 'up' ? 'down' : 'up', true);
		return far !== -1 ? far : clamped;
	}

	private getViewportPageStep(): number {
		const visibleRange = this.runtime.getVisibleRowRange();
		const visibleCount = visibleRange.endIdx - visibleRange.startIdx + 1;
		return Math.max(1, visibleCount);
	}

	private getEditTargetColumnIdentity(pointer: GridCellPointer): string {
		if (pointer.columnInstanceId) return pointer.columnInstanceId;
		const column = this.resolvePointerColumn(pointer);
		return column ? getColumnInstanceIdentity(column) : pointer.colField;
	}

	private canonicalizePointer(pointer: GridCellPointer | null | undefined): CanonicalGridCellPointer | null {
		if (pointer?.columnInstanceId && pointer.colId) {
			return pointer as CanonicalGridCellPointer;
		}
		return resolveCanonicalCellPointer(this.runtime.getDisplayedColumns(), pointer ?? null);
	}

	private isEditingPointer(pointer: GridCellPointer | null, activeEdit: GridCellPointer | null | undefined): boolean {
		const canonicalPointer = this.canonicalizePointer(pointer);
		const canonicalActiveEdit = this.canonicalizePointer(activeEdit ?? null);
		return areCanonicalCellPointersEqual(canonicalPointer, canonicalActiveEdit);
	}

	private getSelectionAnchor(): CanonicalGridCellPointer | null {
		const selection = readInteractionState(this.runtime.getStateSnapshot()).cellSelection.selection;
		return selection.anchor ?? selection.focus ?? null;
	}

	private getDataRowIdsBetween(anchorRowId: string, targetRowId: string): string[] {
		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return [];
		const anchorIndex = rowModel.getVisualIndexByRowId(anchorRowId);
		const targetIndex = rowModel.getVisualIndexByRowId(targetRowId);
		if (anchorIndex < 0 || targetIndex < 0) return [];
		const start = Math.min(anchorIndex, targetIndex);
		const end = Math.max(anchorIndex, targetIndex);
		const rowIds: string[] = [];
		for (let i = start; i <= end; i++) {
			const row = rowModel.getVisualRow(i);
			if (row?.kind === 'data') rowIds.push(row.rowId);
		}
		return rowIds;
	}

	private isMultipleRowSelectionEnabled(): boolean {
		const internalState = (
			this.runtime as GridPluginRuntime<TRowData> & {
				getState?: () => { rowSelection?: { mode?: 'single' | 'multiple' } | undefined };
			}
		).getState?.();
		return internalState?.rowSelection?.mode !== 'single';
	}

	public isRowSelectionIgnoredTarget(el: Element | null): boolean {
		if (!el) return false;
		return (
			el.closest('button, input, select, textarea, a, [role="button"], [contenteditable="true"]') !== null ||
			el.closest('.og-cell-editor') !== null ||
			el.closest('.og-context-menu') !== null
		);
	}

	public handleViewportMouseDown(event: MouseEvent): void {
		const handle = (event.target as HTMLElement | null)?.closest('.og-drag-handle');
		if (handle) event.stopPropagation();
	}

	public handleRowCheckboxClick(rowId: string, checked: boolean, event: MouseEvent): void {
		const isMultiple = this.isMultipleRowSelectionEnabled();
		if (isMultiple && event.shiftKey && this.rowSelectionAnchorId) {
			const rangeIds = this.getDataRowIdsBetween(this.rowSelectionAnchorId, rowId);
			if (rangeIds.length > 0) {
				if (checked) this.commands.selectRows(rangeIds, { mode: 'add' });
				else this.commands.deselectRows(rangeIds);
			}
		} else if (!isMultiple && checked) {
			this.commands.applyRowSelectionGesture({ kind: 'replace', rowIds: [rowId], source: 'checkbox' });
		} else {
			this.commands.applyRowSelectionGesture({ kind: 'toggle', rowIds: [rowId], source: 'checkbox' });
		}
		this.rowSelectionAnchorId = rowId;
	}

	public handleDataRowClick(pointer: GridCellPointer, event: MouseEvent): void {
		if (!this.runtime.getDisplayedColumns().some((col) => col.checkboxSelection)) return;
		const col = this.resolvePointerColumn(pointer);
		if (col?.checkboxSelection) return;
		const rowIndex = this.runtime.getVisualIndexByRowId(pointer.rowId) ?? -1;
		const row = rowIndex >= 0 ? this.runtime.getVisualRow(rowIndex) : null;
		if (row?.kind !== 'data') return;
		const isMultiple = this.isMultipleRowSelectionEnabled();
		if (isMultiple && event.shiftKey && this.rowSelectionAnchorId) {
			const rangeIds = this.getDataRowIdsBetween(this.rowSelectionAnchorId, pointer.rowId);
			if (rangeIds.length > 0) {
				this.commands.applyRowSelectionGesture({ kind: 'select', rowIds: rangeIds, source: 'pointer' });
				event.preventDefault();
				this.rowSelectionAnchorId = pointer.rowId;
				return;
			}
		}
		if (isMultiple && (event.ctrlKey || event.metaKey)) {
			this.commands.applyRowSelectionGesture({ kind: 'toggle', rowIds: [pointer.rowId], source: 'pointer' });
		} else {
			this.commands.applyRowSelectionGesture({ kind: 'replace', rowIds: [pointer.rowId], source: 'pointer' });
		}
		this.rowSelectionAnchorId = pointer.rowId;
	}

	/**
	 * Keys on the hierarchy cell (grouped and tree grids). ArrowRight opens a closed row, or steps into
	 * an open one's first child; ArrowLeft closes an open row, or steps out to its parent; Enter
	 * toggles. Leaves fall through to ordinary navigation. Returns whether the key was handled.
	 */
	private handleHierarchyKey(event: KeyboardEvent, rowIdx: number, colIdx: number): boolean {
		if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Enter') return false;
		if (!isHierarchyColumn(this.getDisplayedColumnAtIndex(colIdx))) return false;
		const row = this.runtime.getVisualRow(rowIdx);
		if (!row || !isCellRow(row)) return false;
		const { hasChildren, expanded, parentId } = row.hierarchy;
		const focusRow = (targetIdx: number) => {
			const pointer = this.getPointerFromCoords(targetIdx, colIdx);
			if (pointer) this.commands.selectCell(pointer, 'keyboard');
		};
		if (event.key === 'Enter') {
			if (!hasChildren) return row.kind !== 'data'; // group / total rows never start an edit
			this.runtime.setExpanded(row.id, !expanded);
		} else if (event.key === 'ArrowRight') {
			if (!hasChildren) return false;
			if (!expanded) this.runtime.setExpanded(row.id, true);
			else focusRow(rowIdx + 1);
		} else {
			if (hasChildren && expanded) this.runtime.setExpanded(row.id, false);
			else if (parentId) {
				const parentIdx = this.runtime.getRowModel()?.getVisualIndexById(parentId) ?? -1;
				if (parentIdx < 0) return false;
				focusRow(parentIdx);
			} else return false;
		}
		event.preventDefault();
		return true;
	}

	public handleKeyDown = (event: KeyboardEvent): void => {
		const state = this.runtime.getStateSnapshot();
		const interaction = readInteractionState(state);
		const active = interaction.focus.cell;
		if (!active) return;
		const coords = this.getCoordsFromPointer(active);
		if (!coords) return;
		const { rowIdx: row, colIdx: col } = coords;
		const maxCol = this.runtime.getDisplayedColumns().length - 1;
		const isEditing = this.isEditingPointer(active, interaction.activeEdit.active);

		if (!isEditing) {
			if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
				event.preventDefault();
				void this.commands.copySelectedRange();
				return;
			}
			if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
				event.preventDefault();
				void this.commands.pasteFromClipboard();
				return;
			}
			if (this.handleHierarchyKey(event, row, col)) return;
			const focusedRow = this.runtime.getVisualRow(row);
			const onHierarchyRow = focusedRow?.kind === 'group' || focusedRow?.kind === 'total';
			let nextRow = row;
			let nextCol = col;
			let handled = false;
			switch (event.key) {
				case 'ArrowUp': {
					const prevDataRowIdx = this.getNextDataRowIndex(row, 'up', true);
					if (prevDataRowIdx !== -1) nextRow = prevDataRowIdx;
					handled = true;
					break;
				}
				case 'ArrowDown': {
					const nextDataRowIdx = this.getNextDataRowIndex(row, 'down', true);
					if (nextDataRowIdx !== -1) nextRow = nextDataRowIdx;
					handled = true;
					break;
				}
				case 'ArrowLeft':
					nextCol = Math.max(0, col - 1);
					handled = true;
					break;
				case 'ArrowRight':
					nextCol = Math.min(maxCol, col + 1);
					handled = true;
					break;
				case 'Tab': {
					event.preventDefault();
					const tabDest = this.getTabTarget(row, col, maxCol, !event.shiftKey, true);
					if (tabDest) {
						const ptr = this.getPointerFromCoords(tabDest.row, tabDest.col);
						if (ptr) {
							this.commands.selectCell(ptr, 'keyboard');
						}
					}
					return;
				}
				case 'Home':
					nextCol = 0;
					if (event.ctrlKey || event.metaKey) nextRow = this.clampToDataRow(0, 'down');
					handled = true;
					break;
				case 'End':
					nextCol = maxCol;
					if (event.ctrlKey || event.metaKey) {
						const count = this.runtime.getRowModel()?.getVisualRowCount() ?? 0;
						nextRow = this.clampToDataRow(count - 1, 'up');
					}
					handled = true;
					break;
				case 'PageUp':
				case 'PageDown': {
					const page = this.getViewportPageStep();
					nextRow = event.key === 'PageUp' ? this.clampToDataRow(row - page, 'down') : this.clampToDataRow(row + page, 'up');
					handled = true;
					break;
				}
				case ' ':
					event.preventDefault();
					return;
				case 'F2':
				case 'Enter':
					event.preventDefault();
					if (onHierarchyRow) return; // group and total cells are never edited
					this.setCellEditing(active.rowId, this.getEditTargetColumnIdentity(active), true, 'keyboard');
					return;
				case 'Delete':
				case 'Backspace':
					event.preventDefault();
					if (onHierarchyRow) return;
					this.commands.setCellValue(active.rowId, active.colField, null);
					return;
				case 'Escape':
					event.preventDefault();
					this.commands.selectCell(null, 'keyboard');
					return;
				default:
					if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
						event.preventDefault();
						if (onHierarchyRow) return;
						this.setCellEditing(active.rowId, this.getEditTargetColumnIdentity(active), true, 'keyboard');
					}
					return;
			}
			if (handled) {
				event.preventDefault();
				const targetPointer = this.getPointerFromCoords(nextRow, nextCol);
				if (!targetPointer) return;
				if (event.shiftKey) {
					const start = this.getSelectionAnchor() ?? active;
					if (!areCanonicalCellPointersEqual(this.canonicalizePointer(start), this.canonicalizePointer(active))) {
						this.commands.selectRange(start, active, 'keyboard');
					}
					this.extendSelection(targetPointer, 'keyboard');
				} else {
					this.commands.selectCell(targetPointer, 'keyboard');
					if (this.options.arrowKeyNavigationEdit) {
						this.startEdit(targetPointer.rowId, this.getEditTargetColumnIdentity(targetPointer), 'keyboard');
					}
				}
			}
			return;
		}

		switch (event.key) {
			case 'ArrowUp': {
				event.preventDefault();
				const upRow = this.getNextDataRowIndex(row, 'up');
				if (upRow !== -1) {
					this.queueCommitAndMoveSelection(active, { row: upRow, col }, this.options.arrowKeyNavigationEdit);
				}
				break;
			}
			case 'ArrowDown': {
				event.preventDefault();
				const downRow = this.getNextDataRowIndex(row, 'down');
				if (downRow !== -1) {
					this.queueCommitAndMoveSelection(active, { row: downRow, col }, this.options.arrowKeyNavigationEdit);
				}
				break;
			}
			case 'ArrowLeft':
				if (this.options.arrowKeyNavigationEdit) {
					event.preventDefault();
					this.queueCommitAndMoveSelection(active, { row, col: Math.max(0, col - 1) }, true);
				}
				break;
			case 'ArrowRight':
				if (this.options.arrowKeyNavigationEdit) {
					event.preventDefault();
					this.queueCommitAndMoveSelection(active, { row, col: Math.min(maxCol, col + 1) }, true);
				}
				break;
			case 'Enter': {
				event.preventDefault();
				const nextRowIdx = this.getNextDataRowIndex(row, 'down');
				if (nextRowIdx !== -1) {
					this.queueCommitAndMoveSelection(active, { row: nextRowIdx, col }, true);
				}
				break;
			}
			case 'Tab': {
				event.preventDefault();
				const tabDest = this.getTabTarget(row, col, maxCol, !event.shiftKey);
				if (tabDest) {
					this.queueCommitAndMoveSelection(active, { row: tabDest.row, col: tabDest.col }, true);
				}
				break;
			}
			case 'Escape':
				event.preventDefault();
				this.cancelEdit();
				break;
		}
	};

	private moveEditSelection(row: number, col: number, active: GridCellPointer, startEditing = this.options.arrowKeyNavigationEdit): void {
		const target = this.getPointerFromCoords(row, col);
		if (!target) return;
		this.commands.selectCell(target, 'keyboard');
		if (startEditing && !areCanonicalCellPointersEqual(this.canonicalizePointer(target), this.canonicalizePointer(active))) {
			this.startEdit(target.rowId, this.getEditTargetColumnIdentity(target), 'keyboard');
		}
	}

	private queueCommitAndMoveSelection(
		active: GridCellPointer,
		target: { row: number; col: number },
		startEditing = this.options.arrowKeyNavigationEdit ?? false
	): void {
		const intent = ++this.editNavigationIntent;
		this.pendingEditNavigation = { intent, active, target, startEditing };
		if (this.editNavigationInFlight) return;
		void this.commitAndMoveSelection();
	}

	private invalidateEditNavigation(): void {
		this.editNavigationIntent += 1;
		this.pendingEditNavigation = null;
	}

	private async commitAndMoveSelection(): Promise<void> {
		if (!this.pendingEditNavigation) return;
		this.editNavigationInFlight = true;
		let committed = false;
		try {
			committed = await this.commitEdit();
		} catch {
			return;
		} finally {
			this.editNavigationInFlight = false;
		}
		const latestRequest = this.pendingEditNavigation;
		this.pendingEditNavigation = null;
		if (!committed || !latestRequest || latestRequest.intent !== this.editNavigationIntent) return;
		this.moveEditSelection(latestRequest.target.row, latestRequest.target.col, latestRequest.active, latestRequest.startEditing);
	}

	public handleMouseDown = (pointer: GridCellPointer, event: MouseEvent): void => {
		if (event.button !== 0) return;
		this.invalidateEditNavigation();
		if (event.ctrlKey || event.metaKey) {
			this.commands.applyRowSelectionGesture({ kind: 'toggle', rowIds: [pointer.rowId], source: 'pointer' });
			return;
		}
		const state = this.runtime.getStateSnapshot();
		const interaction = readInteractionState(state);
		const prevFocus = interaction.focus.cell;
		if (
			prevFocus &&
			!areCanonicalCellPointersEqual(prevFocus, this.canonicalizePointer(pointer)) &&
			this.isEditingPointer(prevFocus, interaction.activeEdit.active)
		) {
			this.commitEdit();
		}
		this.isSelecting = true;
		this.commands.selectCell(pointer, 'pointer');
	};

	public handleClick = (pointer: GridCellPointer): void => {
		const trigger = this.options.editTrigger ?? 'doubleClick';
		if (trigger !== 'singleClick') return;
		const state = this.runtime.getStateSnapshot();
		const range = readInteractionState(state).cellSelection.selection.range;
		const isSingleCell = !range || areCanonicalCellPointersEqual(range.start, range.end);
		if (isSingleCell) this.startEdit(pointer.rowId, this.getEditTargetColumnIdentity(pointer), 'mouse');
	};

	public handleMouseEnter = (pointer: GridCellPointer): void => {
		if (!this.isSelecting || !this.getSelectionAnchor()) return;
		this.extendSelection(pointer, 'pointer');
	};

	public handleMouseUp = (): void => {
		this.isSelecting = false;
	};

	public isEditingCell(pointer: GridCellPointer): boolean {
		return this.isEditingPointer(pointer, readInteractionState(this.runtime.getStateSnapshot()).activeEdit.active);
	}

	public selectCell(pointer: GridCellPointer | null, source: GridSelectionSource = 'api'): void {
		this.invalidateEditNavigation();
		this.commands.selectCell(this.canonicalizePointer(pointer), source);
	}

	public selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'api'): void {
		this.commands.selectRange(this.canonicalizePointer(start), this.canonicalizePointer(end), source);
	}

	public extendSelection(end: GridCellPointer, source: GridSelectionSource = 'api'): void {
		const canonicalEnd = this.canonicalizePointer(end);
		if (!canonicalEnd) return;
		const selection = readInteractionState(this.runtime.getStateSnapshot()).cellSelection.selection;
		this.commands.selectRange(selection.anchor ?? selection.focus ?? canonicalEnd, canonicalEnd, source);
	}

	public applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
		return this.commands.applyRowSelectionGesture(gesture);
	}

	public copySelectedRange(): Promise<void> {
		return this.commands.copySelectedRange();
	}

	public pasteFromClipboard(): Promise<void> {
		return this.commands.pasteFromClipboard();
	}

	public scrollToCell(rowId: string, colField: string, options?: ScrollToCellOptions): void {
		this.commands.scrollToCell(rowId, colField);
		if (options?.select || options?.edit) {
			this.commands.selectCell({ rowId, colField }, 'api');
		}
		if (options?.edit) {
			this.commands.startEditing(rowId, colField, 'api');
		}
	}

	public scrollToRow(rowId: string, options?: ScrollToRowOptions): void {
		this.commands.scrollToRow(rowId);
		if (options?.select) {
			this.commands.selectRows([rowId]);
		}
	}

	public startEdit(rowId: string, colFieldOrInstanceId: string, source: 'keyboard' | 'mouse' | 'api' = 'api'): void {
		this.invalidateEditNavigation();
		this.commands.startEditing(rowId, colFieldOrInstanceId, source);
	}

	public updateEditDraft(rowId: string, colFieldOrInstanceId: string, value: unknown): void {
		this.commands.updateEditDraft(rowId, colFieldOrInstanceId, value);
	}

	public stopEdit(cancel = false): void {
		if (!cancel) {
			const activeEdit = readInteractionState(this.runtime.getStateSnapshot()).activeEdit.active;
			if (activeEdit) {
				void this.commands.commitEdit(activeEdit.rowId, activeEdit.columnInstanceId, activeEdit.draftValue);
				return;
			}
		}
		this.commands.stopEditing(cancel);
	}

	public commitCellEdit(rowId: string, colFieldOrInstanceId: string, value: unknown): Promise<boolean> {
		return this.commands.commitEdit(rowId, colFieldOrInstanceId, value);
	}

	public setCellEditing(rowId: string, colFieldOrInstanceId: string, isEditing: boolean, source: 'keyboard' | 'mouse' | 'api' = 'api'): void {
		if (isEditing) this.startEdit(rowId, colFieldOrInstanceId, source);
		else this.stopEdit();
	}

	public async commitEdit(): Promise<boolean> {
		const activeEdit = readInteractionState(this.runtime.getStateSnapshot()).activeEdit.active;
		if (!activeEdit) {
			this.stopEdit(false);
			return true;
		}
		return this.commitCellEdit(activeEdit.rowId, activeEdit.columnInstanceId, activeEdit.draftValue);
	}

	public cancelEdit(): void {
		this.invalidateEditNavigation();
		this.stopEdit(true);
	}
}
