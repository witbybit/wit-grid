import type { GridWriteResult } from '../api/GridApi.js';
import type { GridIntegrityIssue } from '../features/dataIntegrity/integrityTypes.js';
import type { GridRowsAccessor } from '../api/GridApi.js';
import type { RowModel, RowLoadState } from '../rowModel.js';
import { asAllDataNodesCapableRowModel } from '../rowModel.js';
import type { RowNode } from '../rowNode.js';
import { createGridRowNodeFacade, type GridRowNode, type GridRowNodeFacadeSource } from '../publicRowNode.js';
import { createRowsAccessor } from '../rowsAccessor.js';
import type { InternalGridState } from '../state/GridState.js';
import type { VisualRow } from '../visualRow.js';

/**
 * Public row access belongs to this facade rather than the store composition root.
 *
 * The facade receives only the row/query and command ports it needs. It deliberately
 * does not import or retain a GridStore reference, so adding a row-model API cannot
 * recover the store as a general-purpose implementation bucket.
 */
export interface GridStoreRowFacadeDeps<TRowData = unknown> {
	getRowModel(): RowModel<TRowData> | null;
	getRowId(data: TRowData): string;
	getCellValue(rowId: string, colField: string): unknown;
	getSelectedRowIds(): string[];
	isRowNodeSelected(rowId: string): boolean;
	isExpanded(id: string): boolean;
	isDetailOpen(rowId: string): boolean;
	selectRows(rowIds: string[], options?: { mode?: 'add' | 'replace' }): void;
	deselectRows(rowIds: string[]): void;
	scrollToRow(rowId: string, options?: { select?: boolean }): void;
	setCellValue(rowId: string, colField: string, value: unknown): GridWriteResult;
	/** Several cells as one transaction (row node data writes). */
	writeCells(updates: Array<{ rowId: string; colField: string; value: unknown }>): GridWriteResult;
	setExpanded(id: string, expanded: boolean): void;
	setDetailOpen(rowId: string, open: boolean): void;
	refreshRows(): void;
	retryRowLoad(rowIndex: number | null, loadState: RowLoadState): GridWriteResult;
	getRowIssues(rowId: string): readonly GridIntegrityIssue[];
	validateRow(rowId: string): Promise<readonly GridIntegrityIssue[]>;
	getRowModelType(): 'client' | 'infinite' | 'server';
	getState(): InternalGridState<TRowData>;
}

export interface GridStoreRowFacade<TRowData = unknown> {
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualIndexById(visualRowId: string): number | null;
	getVisualIndexByRowId(rowId: string): number | null;
	getRowLoadState(index: number): RowLoadState;
	getRowNode(rowId: string): GridRowNode<TRowData> | undefined;
	getDisplayedRowAtIndex(index: number): GridRowNode<TRowData> | undefined;
	getRowIndexById(rowId: string): number | undefined;
	forEachNode(callback: (node: GridRowNode<TRowData>, index: number) => void): void;
	forEachDisplayedNode(callback: (node: GridRowNode<TRowData>, index: number) => void): void;
	getRowNodeById(rowId: string): RowNode<TRowData> | null;
	getRawRowById(rowId: string): TRowData | null;
	getDataRowAtVisualIndex(index: number): TRowData | null;
	getDataRowNodeAtVisualIndex(index: number): RowNode<TRowData> | null;
	rows(): GridRowsAccessor<TRowData>;
}

export function createGridStoreRowFacade<TRowData>(deps: GridStoreRowFacadeDeps<TRowData>): GridStoreRowFacade<TRowData> {
	const getVisualRow = (index: number): VisualRow<TRowData> | null => deps.getRowModel()?.getVisualRow(index) ?? null;
	const getVisualRowCount = (): number => deps.getRowModel()?.getVisualRowCount() ?? 0;
	const getVisualIndexById = (visualRowId: string): number | null => {
		const index = deps.getRowModel()?.getVisualIndexById(visualRowId);
		return index !== undefined && index >= 0 ? index : null;
	};
	const getVisualIndexByRowId = (rowId: string): number | null => {
		const index = deps.getRowModel()?.getVisualIndexByRowId(rowId);
		return index !== undefined && index >= 0 ? index : null;
	};
	const getRowLoadState = (index: number): RowLoadState => deps.getRowModel()?.getRowLoadState(index) ?? { kind: 'missing' };
	const getRawRowById = (rowId: string): TRowData | null => deps.getRowModel()?.getRawRowById(rowId) ?? null;
	const getRowNodeById = (rowId: string): RowNode<TRowData> | null => deps.getRowModel()?.getRowNodeById(rowId) ?? null;

	const createRowNodeSource = (): GridRowNodeFacadeSource<TRowData> => ({
		getRowId: deps.getRowId,
		getRawRowById,
		getCellValue: deps.getCellValue,
		getVisualIndexByRowId,
		getVisualRowCount,
		getSelectedRowIds: deps.getSelectedRowIds,
		isExpanded: deps.isExpanded,
		isDetailOpen: deps.isDetailOpen,
		selectRows: deps.selectRows,
		deselectRows: deps.deselectRows,
		scrollToRow: deps.scrollToRow,
		setCellValue: deps.setCellValue,
		writeCells: (updates) => deps.writeCells([...updates]),
		setExpanded: deps.setExpanded,
		setDetailOpen: deps.setDetailOpen,
		refreshRows: deps.refreshRows,
		retryRowLoad: deps.retryRowLoad,
		getRowIssues: deps.getRowIssues,
		validateRow: deps.validateRow,
		getRowModelType: deps.getRowModelType,
	});

	const getRowNode = (rowId: string): GridRowNode<TRowData> | undefined => {
		const data = getRawRowById(rowId);
		if (data == null) return undefined;
		return createGridRowNodeFacade(createRowNodeSource(), {
			id: rowId,
			kind: 'data',
			rowIndex: getVisualIndexByRowId(rowId),
			loadState: { kind: 'loaded', rowId },
			data,
			selectable: true,
			selected: deps.isRowNodeSelected(rowId),
			expandable: false,
			expanded: deps.isDetailOpen(rowId),
			editable: true,
		});
	};

	const getDisplayedRowAtIndex = (index: number): GridRowNode<TRowData> | undefined => {
		const row = getVisualRow(index);
		if (!row) return undefined;
		const source = createRowNodeSource();
		switch (row.kind) {
			case 'data':
				return createGridRowNodeFacade(source, {
					id: row.rowId,
					kind: 'data',
					rowIndex: index,
					loadState: { kind: 'loaded', rowId: row.rowId },
					data: row.node.data,
					selectable: true,
					selected: deps.isRowNodeSelected(row.rowId),
					expandable: false,
					expanded: deps.isDetailOpen(row.rowId),
					editable: true,
				});
			case 'loading':
				return createGridRowNodeFacade(source, {
					id: row.id,
					kind: 'loading',
					rowIndex: index,
					loadState: { kind: 'loading' },
					selectable: false,
					editable: false,
				});
			case 'failed':
				return createGridRowNodeFacade(source, {
					id: row.id,
					kind: 'failed',
					rowIndex: index,
					loadState: { kind: 'failed', error: row.error, retryable: row.retryable },
					selectable: false,
					editable: false,
				});
			case 'placeholder':
				return createGridRowNodeFacade(source, {
					id: row.id,
					kind: 'placeholder',
					rowIndex: index,
					loadState: { kind: 'placeholder', reason: row.reason },
					selectable: false,
					editable: false,
				});
			case 'group':
				return createGridRowNodeFacade(source, {
					id: row.groupId,
					kind: 'group',
					rowIndex: index,
					loadState: { kind: 'loaded', rowId: row.groupId },
					selectable: row.selectable !== false,
					expandable: true,
					expanded: row.hierarchy.expanded,
					editable: false,
				});
			case 'detail':
				return createGridRowNodeFacade(source, {
					id: row.parentRowId ?? row.parentId,
					kind: 'detail',
					rowIndex: index,
					loadState: { kind: 'loaded', rowId: row.parentRowId ?? row.parentId },
					selectable: false,
					expandable: false,
					expanded: true,
					editable: false,
				});
			default:
				return undefined;
		}
	};

	const facade: GridStoreRowFacade<TRowData> = {
		getVisualRow,
		getVisualRowCount,
		getVisualIndexById,
		getVisualIndexByRowId,
		getRowLoadState,
		getRowNode,
		getDisplayedRowAtIndex,
		getRowIndexById: (rowId) => getVisualIndexByRowId(rowId) ?? undefined,
		forEachNode: (callback) => {
			const allNodesModel = asAllDataNodesCapableRowModel(deps.getRowModel());
			if (allNodesModel) {
				allNodesModel.getAllDataNodes().forEach((node, index) => {
					const publicNode = getRowNode(node.id);
					if (publicNode) callback(publicNode, index);
				});
				return;
			}
			let dataIndex = 0;
			for (let rowIndex = 0; rowIndex < getVisualRowCount(); rowIndex++) {
				const node = getDisplayedRowAtIndex(rowIndex);
				if (!node || node.kind !== 'data') continue;
				callback(node, dataIndex++);
			}
		},
		forEachDisplayedNode: (callback) => {
			for (let index = 0; index < getVisualRowCount(); index++) {
				const node = getDisplayedRowAtIndex(index);
				if (node) callback(node, index);
			}
		},
		getRowNodeById,
		getRawRowById,
		getDataRowAtVisualIndex: (index) => {
			const row = getVisualRow(index);
			return row?.kind === 'data' ? row.node.data : null;
		},
		getDataRowNodeAtVisualIndex: (index) => {
			const row = getVisualRow(index);
			return row?.kind === 'data' ? row.node : null;
		},
		rows: () =>
			createRowsAccessor({
				getRowModel: deps.getRowModel,
				getState: deps.getState,
				getRowNode,
				getVisualRow,
				getVisualIndexByRowId,
				getVisualRowCount,
				getDataRowAtVisualIndex: (index) => {
					const row = getVisualRow(index);
					return row?.kind === 'data' ? row.node.data : null;
				},
				getRawRowById,
			}),
	};

	return facade;
}
