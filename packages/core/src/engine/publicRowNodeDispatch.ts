import type { GridWriteResult } from '../api/GridApi.js';
import { GridEventName, type GridEventPayloadMap } from '../api/GridEvents.js';
import { createGridRowNodeFacade, type GridRowNode } from '../publicRowNode.js';
import type { RowNode } from '../rowNode.js';
import type { InternalRowNodeTransaction, RowNodeTransaction } from '../rowTransactions.js';
import type { RowsUpdatedDispatchPayload } from './runtimePorts.js';

export interface PublicRowNodeDispatchDeps<TRowData = unknown> {
	getRowId(row: TRowData): string;
	getRawRowById(rowId: string): TRowData | null;
	getCellValue(rowId: string, field: string): unknown;
	getVisualIndexByRowId(rowId: string): number | null;
	getVisualRowCount(): number;
	getSelectedRowIds(): string[];
	isExpanded(id: string): boolean;
	isDetailOpen(rowId: string): boolean;
	selectRows(rowIds: string[], options?: { mode?: 'add' | 'replace' }): void;
	deselectRows(rowIds: string[]): void;
	scrollToRow(rowId: string, options?: { select?: boolean }): void;
	setCellValue(rowId: string, field: string, value: unknown): GridWriteResult;
	batchCellValues(updates: ReadonlyArray<{ rowId: string; colField: string; value: unknown }>): GridWriteResult;
	setExpanded(id: string, expanded: boolean): void;
	setDetailOpen(rowId: string, open: boolean): void;
	refreshRows(): void;
	retryRowLoad(rowIndex: number | null, loadState: import('../rowModel.js').RowLoadState): GridWriteResult;
	getRowIssues(rowId: string): readonly import('../features/dataIntegrity/integrityTypes.js').GridIntegrityIssue[];
	validateRow(rowId: string): Promise<readonly import('../features/dataIntegrity/integrityTypes.js').GridIntegrityIssue[]>;
	getRowModelType(): 'client' | 'infinite' | 'server';
}

export function createPublicRowNodeFromInternal<TRowData>(deps: PublicRowNodeDispatchDeps<TRowData>, node: RowNode<TRowData>): GridRowNode<TRowData> {
	const rowId = node.id;
	return createGridRowNodeFacade(deps, {
		id: rowId,
		kind: 'data',
		rowIndex: deps.getVisualIndexByRowId(rowId),
		loadState: { kind: 'loaded', rowId },
		data: node.data,
		selectable: true,
		selected: deps.getSelectedRowIds().includes(rowId),
		expandable: false,
		expanded: deps.isDetailOpen(rowId),
		editable: true,
	});
}

export function mapInternalRowNodeTransaction<TRowData>(
	deps: PublicRowNodeDispatchDeps<TRowData>,
	transaction: InternalRowNodeTransaction<TRowData>
): RowNodeTransaction<TRowData> {
	return {
		add: transaction.add.map((node) => createPublicRowNodeFromInternal(deps, node)),
		remove: transaction.remove.map((node) => createPublicRowNodeFromInternal(deps, node)),
		update: transaction.update.map((node) => createPublicRowNodeFromInternal(deps, node)),
	};
}

export function mapRowsUpdatedDispatchPayload<TRowData>(
	deps: PublicRowNodeDispatchDeps<TRowData>,
	payload: RowsUpdatedDispatchPayload<TRowData>
): GridEventPayloadMap<TRowData>[GridEventName.rowsUpdated] {
	return {
		changedValuesByRow: payload.changedValuesByRow,
		changedNodes: payload.changedNodes.map((node) => createPublicRowNodeFromInternal(deps, node)),
		addedNodes: payload.addedNodes?.map((node) => createPublicRowNodeFromInternal(deps, node)),
		removedNodes: payload.removedNodes?.map((node) => createPublicRowNodeFromInternal(deps, node)),
	};
}
