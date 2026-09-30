import type { GridStateUpdater, InternalGridState } from '../state/GridState.js';
import type { RowModel } from '../rowModel.js';
import { asCapableRowModel, asSelectableDataRowModel } from '../rowModel.js';
import type { StateCommitPhase } from '../state/StateManager.js';
import type { DataModel } from '../models/DataModel.js';
import type { ColumnModel } from '../models/ColumnModel.js';
import type { GeometryModel } from '../models/GeometryModel.js';
import type { ViewportModel } from '../models/ViewportModel.js';
import type { SelectionModel } from '../models/SelectionModel.js';
import type { CellNotificationController } from './CellNotificationController.js';
import type { CanonicalGridCellPointer } from '../api/GridApi.js';
import type { GridCellPointer } from '../api/GridApi.js';
import { areCanonicalCellPointersEqual, findColumnByCanonicalCellPointer, findColumnByCellPointer } from '../interaction/cellPointer.js';
import { buildInteractionState, isInteractionStateCurrent, type CanonicalGridSelectionState } from '../interaction/interactionState.js';
import { getColumnInstanceIdentity } from '../columnDef.js';

interface RangeBounds {
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}

export interface GridProjectionPipelineDeps<TRowData = unknown> {
	data: DataModel<TRowData>;
	columns: ColumnModel<TRowData>;
	geometry: GeometryModel;
	viewport: ViewportModel<TRowData>;
	selection: SelectionModel;
	cellNotifications: CellNotificationController<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	/** Syncs row geometry in place; returns the first changed row index, or -1 when unchanged. */
	syncRowGeometry: (rowModel: RowModel<TRowData>, rowHeightsRecord: Record<string, number>, defaultRowHeight: number) => number;
	notifyCellChange: (rowId: string, colField: string, includeRenderInvalidation?: boolean, renderColId?: string) => void;
}

export interface GridProjectionRunInput<TRowData = unknown> {
	phase: StateCommitPhase<TRowData>;
}

export class GridProjectionPipeline<TRowData = unknown> {
	constructor(private readonly deps: GridProjectionPipelineDeps<TRowData>) {}

	private pendingStructuralBoundsUpdate = false;

	private resolvePointerColumn(pointer: GridCellPointer | null | undefined) {
		if (!pointer) return undefined;
		if (pointer.columnInstanceId) {
			const canonicalColumn = findColumnByCanonicalCellPointer(this.deps.columns.getDisplayedColumns(), {
				columnInstanceId: pointer.columnInstanceId,
			});
			if (canonicalColumn) return canonicalColumn;
		}
		return findColumnByCellPointer(this.deps.columns.getDisplayedColumns(), pointer);
	}

	/** First visible scrollable row index, or -1 when anchoring should not apply (scrollTop 0). */
	private captureScrollAnchor(): number {
		if (this.deps.viewport.scrollTop <= 0 || this.deps.geometry.getRowCount() === 0) return -1;
		return this.deps.viewport.getScrollAnchorRowIndex();
	}

	public run({ phase }: GridProjectionRunInput<TRowData>): void {
		let currState = phase.getState();
		const updatedSet = new Set(phase.getChangedKeys());
		const prevState = phase.prevState;

		// Pinned lanes follow state, so a commit that adds a pinned column (the hierarchy column) moves
		// the lane boundary with it.
		if (updatedSet.has('pinnedColumns')) {
			const pins = currState.pinnedColumns;
			this.deps.viewport.pinLeftColumns = pins?.left ?? 0;
			this.deps.viewport.pinRightColumns = pins?.right ?? 0;
		}

		if (updatedSet.has('columns') || updatedSet.has('columnWidths') || updatedSet.has('defaultColWidth')) {
			this.deps.columns.updateColumns(currState.columns, currState.columnWidths, currState.defaultColWidth);
		}

		if (updatedSet.has('globalVersion')) {
			this.deps.data.clearValueGetterCache();
		}

		if (
			updatedSet.has('sortModel') ||
			updatedSet.has('filterModel') ||
			updatedSet.has('grouping') ||
			updatedSet.has('treeData') ||
			updatedSet.has('expansion')
		) {
			this.pendingStructuralBoundsUpdate = true;
		}

		const rowModel = this.deps.getRowModel();
		const rowCountChanged = rowModel ? rowModel.getVisualRowCount() !== this.deps.geometry.getRowCount() : false;
		if (
			rowModel &&
			(updatedSet.has('rowHeights') ||
				updatedSet.has('defaultRowHeight') ||
				updatedSet.has('loading') ||
				updatedSet.has('globalVersion') ||
				rowCountChanged)
		) {
			// Scroll anchoring applies only to pure row-height edits (setRowHeight / auto-height):
			// a sort, filter, transaction or load reorders rows, so an index anchor means nothing.
			const heightOnlyChange =
				updatedSet.has('rowHeights') &&
				!updatedSet.has('defaultRowHeight') &&
				!updatedSet.has('loading') &&
				!updatedSet.has('globalVersion') &&
				!rowCountChanged;
			const anchor = heightOnlyChange ? this.captureScrollAnchor() : -1;
			const anchorTopBefore = anchor >= 0 ? this.deps.geometry.rowTops[anchor] : 0;
			const firstChanged = this.deps.syncRowGeometry(rowModel, currState.rowHeights, currState.defaultRowHeight);
			if (anchor >= 0 && firstChanged >= this.deps.viewport.pinTopRows && firstChanged < anchor) {
				this.deps.viewport.requestScrollAnchor(this.deps.geometry.rowTops[anchor] - anchorTopBefore);
			}
		}

		if (rowModel) {
			const normalizedSelection = this.normalizeSelectionState(currState.selection, rowModel);
			const normalizedActiveEdit = this.normalizeActiveEdit(currState.activeEdit, rowModel);
			const normalizedSelectedRowIds = this.normalizeSelectedRowIds(currState.selectedRowIds, rowModel);
			const derivedState: Partial<InternalGridState<TRowData>> = {};

			if (normalizedSelection !== currState.selection) {
				derivedState.selection = normalizedSelection;
			}
			if (normalizedActiveEdit !== currState.activeEdit) {
				derivedState.activeEdit = normalizedActiveEdit;
			}
			if (normalizedSelectedRowIds !== currState.selectedRowIds) {
				derivedState.selectedRowIds = normalizedSelectedRowIds;
			}

			if (Object.keys(derivedState).length > 0) {
				const affectedKeys = phase.setDerivedState(derivedState);
				for (const key of affectedKeys) updatedSet.add(key);
				currState = phase.getState();
			}
		}

		if (updatedSet.has('selection') || updatedSet.has('columns') || (updatedSet.has('globalVersion') && this.pendingStructuralBoundsUpdate)) {
			if (updatedSet.has('globalVersion')) this.pendingStructuralBoundsUpdate = false;
			const rangeBounds = this.deps.selection.calculateRangeBounds(
				currState.selection.range,
				(id) => this.deps.getRowModel()?.getVisualIndexByRowId(id) ?? -1,
				(pointer) => {
					if (!pointer.columnInstanceId) return -1;
					const column = findColumnByCanonicalCellPointer(this.deps.columns.getDisplayedColumns(), {
						columnInstanceId: pointer.columnInstanceId,
					});
					return column ? this.deps.columns.getIndexMapper().idToVisualIndex(pointer.columnInstanceId) : -1;
				}
			);
			const nextBounds = this.areRangeBoundsEqual(currState.selection.bounds, rangeBounds) ? currState.selection.bounds : rangeBounds;
			const selection = this.deps.selection.setSelection({
				...currState.selection,
				bounds: nextBounds,
			});
			if (currState.selection !== selection) {
				const affectedKeys = phase.setDerivedState({ selection });
				for (const key of affectedKeys) updatedSet.add(key);
				currState = phase.getState();
			}
		}

		if (updatedSet.has('selection')) {
			this.deps.selection.setSelection(currState.selection);
		}

		if (
			(updatedSet.has('selection') || updatedSet.has('activeEdit') || updatedSet.has('selectedRowIds') || updatedSet.has('globalVersion')) &&
			!isInteractionStateCurrent(currState, { getRowIndexByRowId: (rowId) => rowModel?.getVisualIndexByRowId(rowId) ?? null })
		) {
			const interaction = buildInteractionState({
				selection: currState.selection,
				activeEdit: currState.activeEdit,
				selectedRowIds: currState.selectedRowIds,
				getRowIndexByRowId: (rowId) => rowModel?.getVisualIndexByRowId(rowId) ?? null,
			});
			const affectedKeys = phase.setDerivedState({ interaction });
			for (const key of affectedKeys) updatedSet.add(key);
			currState = phase.getState();
		}

		const needsRangeUpdate =
			updatedSet.has('columns') ||
			updatedSet.has('columnWidths') ||
			updatedSet.has('rowHeights') ||
			updatedSet.has('globalVersion') ||
			updatedSet.has('defaultRowHeight') ||
			updatedSet.has('defaultColWidth') ||
			updatedSet.has('loading') ||
			updatedSet.has('rowOverscanPx');

		if (needsRangeUpdate) {
			const activeRowModel = this.deps.getRowModel();
			const nextRowRange = this.deps.viewport.getVisibleRowRange(activeRowModel ? activeRowModel.getVisualRowCount() : 0);
			const nextColRange = this.deps.viewport.getVisibleColumnRange(this.deps.columns.getDisplayedColumnCount());

			const rowRangeChanged =
				!currState.visibleRowRange ||
				currState.visibleRowRange.startIdx !== nextRowRange.startIdx ||
				currState.visibleRowRange.endIdx !== nextRowRange.endIdx;
			const colRangeChanged =
				!currState.visibleColRange ||
				currState.visibleColRange.startIdx !== nextColRange.startIdx ||
				currState.visibleColRange.endIdx !== nextColRange.endIdx;

			if (rowRangeChanged || colRangeChanged) {
				const affectedKeys = phase.setDerivedState({
					visibleRowRange: nextRowRange,
					visibleColRange: nextColRange,
				} satisfies GridStateUpdater<TRowData>);
				for (const key of affectedKeys) updatedSet.add(key);
				currState = phase.getState();
			}
		}

		this.publishTargetedNotifications(prevState, currState, updatedSet);
	}

	private publishTargetedNotifications(
		prevState: InternalGridState<TRowData>,
		currState: InternalGridState<TRowData>,
		updatedSet: ReadonlySet<string>
	): void {
		const notifiedCells = new Set<string>();
		const notifyCellOnce = (cell: GridCellPointer): void => {
			const column = this.resolvePointerColumn(cell);
			const renderColId = column ? getColumnInstanceIdentity(column) : null;
			if (!renderColId) return;
			const key = `${cell.rowId}:${renderColId}`;
			if (notifiedCells.has(key)) return;
			notifiedCells.add(key);
			this.deps.notifyCellChange(cell.rowId, cell.colField, false, renderColId);
		};

		if (updatedSet.has('selection')) {
			if (prevState.selection.focus) notifyCellOnce(prevState.selection.focus);
			if (currState.selection.focus) notifyCellOnce(currState.selection.focus);
		}

		if (updatedSet.has('activeEdit')) {
			if (prevState.activeEdit) notifyCellOnce(prevState.activeEdit);
			if (currState.activeEdit) notifyCellOnce(currState.activeEdit);
		}

		if (updatedSet.has('selection')) {
			const activeRowModel = this.deps.getRowModel();
			if (activeRowModel) {
				const viewport = this.getSelectionNotificationViewport(currState, activeRowModel);
				const displayedColumns = this.deps.columns.getDisplayedColumns();
				this.deps.selection.forEachDirtyCoordinateInViewport(
					prevState.selection.bounds,
					currState.selection.bounds,
					viewport,
					(rowIdx, colIdx) => {
						const visualRow = activeRowModel.getVisualRow(rowIdx);
						const col = displayedColumns[colIdx];
						if (visualRow?.kind === 'data' && col) {
							notifyCellOnce({
								rowId: visualRow.rowId,
								colField: col.field,
								colId: col.colId ?? col.field,
								columnInstanceId: getColumnInstanceIdentity(col),
							});
						}
					}
				);
			}
		}

		if (updatedSet.has('columnWidths')) {
			const prevWidths = prevState.columnWidths;
			const currWidths = currState.columnWidths;
			const allCols = new Set([...Object.keys(prevWidths), ...Object.keys(currWidths)]);
			for (const colField of allCols) {
				if (prevWidths[colField] !== currWidths[colField]) {
					this.deps.cellNotifications.notifyColumnSubscribers(colField);
				}
			}
		}

		if (updatedSet.has('globalVersion')) {
			this.deps.cellNotifications.notifyAllCellSubscribers();
		}
	}

	private normalizeSelectionState(selection: CanonicalGridSelectionState, rowModel: RowModel<TRowData>): CanonicalGridSelectionState {
		const enrichPointer = (pointer: GridCellPointer | null): CanonicalGridCellPointer | null => {
			if (!pointer) return null;
			if (rowModel.getVisualIndexByRowId(pointer.rowId) < 0) return null;
			const column = this.resolvePointerColumn(pointer);
			if (!column) return null;
			const columnInstanceId = getColumnInstanceIdentity(column);
			if (!columnInstanceId || this.deps.columns.getIndexMapper().idToVisualIndex(columnInstanceId) < 0) return null;
			return {
				rowId: pointer.rowId,
				colField: column.field,
				colId: pointer.colId ?? column.colId ?? column.field,
				columnInstanceId,
			};
		};

		if (!selection.focus) return selection;

		const focus = enrichPointer(selection.focus);
		if (!focus) {
			return {
				focus: null,
				anchor: null,
				range: null,
				bounds: null,
				source: selection.source,
				focusOrigin: null,
				version: selection.version,
			};
		}

		const anchor = enrichPointer(selection.anchor);
		const rangeStart = enrichPointer(selection.range?.start ?? null);
		const rangeEnd = enrichPointer(selection.range?.end ?? null);

		if (
			areCanonicalCellPointersEqual(focus, selection.focus as CanonicalGridCellPointer | null) &&
			areCanonicalCellPointersEqual(anchor, selection.anchor as CanonicalGridCellPointer | null) &&
			areCanonicalCellPointersEqual(rangeStart, (selection.range?.start ?? null) as CanonicalGridCellPointer | null) &&
			areCanonicalCellPointersEqual(rangeEnd, (selection.range?.end ?? null) as CanonicalGridCellPointer | null)
		) {
			return selection;
		}

		if (anchor && rangeStart && rangeEnd) {
			return {
				...selection,
				focus,
				anchor,
				range: { start: rangeStart, end: rangeEnd },
			};
		}

		return this.deps.selection.createCellSelection(focus, selection.source);
	}

	private normalizeActiveEdit(
		activeEdit: InternalGridState<TRowData>['activeEdit'],
		rowModel: RowModel<TRowData>
	): InternalGridState<TRowData>['activeEdit'] {
		if (!activeEdit) return activeEdit;
		if (rowModel.getVisualIndexByRowId(activeEdit.rowId) < 0) return null;
		const column = this.resolvePointerColumn(activeEdit);
		if (!column) return null;
		const columnInstanceId = getColumnInstanceIdentity(column);
		if (this.deps.columns.getIndexMapper().idToVisualIndex(columnInstanceId) < 0) return null;
		if (activeEdit.columnInstanceId === columnInstanceId) {
			return activeEdit;
		}
		return {
			...activeEdit,
			colField: column.field,
			colId: column.colId ?? column.field,
			columnInstanceId,
		};
	}

	private normalizeSelectedRowIds(selectedRowIds: string[], rowModel: RowModel<TRowData>): string[] {
		if (selectedRowIds.length === 0) return selectedRowIds;

		const capabilities = asCapableRowModel(rowModel)?.getCapabilities();
		if (!capabilities || capabilities.allRowSelection) return selectedRowIds;
		if (!capabilities.loadedRowSelection && !capabilities.pageRowSelection) return selectedRowIds;

		const selectableRowModel = asSelectableDataRowModel(rowModel);
		if (!selectableRowModel) return selectedRowIds;

		const allowedIds = new Set(selectableRowModel.getSelectableDataRowIds(capabilities.pageRowSelection ? 'page' : 'loaded'));
		if (allowedIds.size === 0) return [];

		const nextIds = selectedRowIds.filter((rowId) => allowedIds.has(rowId));
		return nextIds.length === selectedRowIds.length ? selectedRowIds : nextIds;
	}

	private areRangeBoundsEqual(left: RangeBounds | null, right: RangeBounds | null): boolean {
		return (
			left === right ||
			(!!left &&
				!!right &&
				left.minRow === right.minRow &&
				left.maxRow === right.maxRow &&
				left.minCol === right.minCol &&
				left.maxCol === right.maxCol)
		);
	}

	private getSelectionNotificationViewport(
		state: InternalGridState<TRowData>,
		rowModel: RowModel<TRowData>
	): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
		const rowCount = rowModel.getVisualRowCount();
		const colCount = this.deps.columns.getDisplayedColumnCount();

		if (rowCount === 0 || colCount === 0) {
			return { minRow: 1, maxRow: 0, minCol: 1, maxCol: 0 };
		}

		const rowStart = Math.max(0, Math.min(state.visibleRowRange.startIdx, rowCount - 1));
		const rowEnd = Math.max(rowStart, Math.min(state.visibleRowRange.endIdx, rowCount - 1));
		const colStart = Math.max(0, Math.min(state.visibleColRange.startIdx, colCount - 1));
		const colEnd = Math.max(colStart, Math.min(state.visibleColRange.endIdx, colCount - 1));
		const topEnd = this.deps.viewport.pinTopRows > 0 ? Math.min(rowCount - 1, this.deps.viewport.pinTopRows - 1) : rowStart;
		const bottomStart = this.deps.viewport.pinBottomRows > 0 ? Math.max(0, rowCount - this.deps.viewport.pinBottomRows) : rowEnd;
		const leftEnd = this.deps.viewport.pinLeftColumns > 0 ? Math.min(colCount - 1, this.deps.viewport.pinLeftColumns - 1) : colStart;
		const rightStart = this.deps.viewport.pinRightColumns > 0 ? Math.max(0, colCount - this.deps.viewport.pinRightColumns) : colEnd;

		return {
			minRow: Math.min(rowStart, topEnd, bottomStart),
			maxRow: Math.max(rowEnd, topEnd, bottomStart),
			minCol: Math.min(colStart, leftEnd, rightStart),
			maxCol: Math.max(colEnd, leftEnd, rightStart),
		};
	}
}
