import type { GridWriteResult } from '../api/GridApi.js';
import type { GridEventName } from '../api/GridEvents.js';
import { type GridEventPayloadMap } from '../api/GridEvents.js';
import { createGridRowNodeFacade, type GridRowNode } from '../publicRowNode.js';
import type { RowNode } from '../rowNode.js';
import type { InternalRowNodeTransaction, RowNodeTransaction } from '../rowTransactions.js';
import type { RowsUpdatedDispatchPayload } from './runtimePorts.js';
import type { RowLoadState } from '../rowModel.js';
import type { GridIntegrityIssue } from '../features/dataIntegrity/integrityTypes.js';

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
	writeCells(updates: ReadonlyArray<{ rowId: string; colField: string; value: unknown }>): GridWriteResult;
	setExpanded(id: string, expanded: boolean): void;
	setDetailOpen(rowId: string, open: boolean): void;
	refreshRows(): void;
	retryRowLoad(rowIndex: number | null, loadState: RowLoadState): GridWriteResult;
	getRowIssues(rowId: string): readonly GridIntegrityIssue[];
	validateRow(rowId: string): Promise<readonly GridIntegrityIssue[]>;
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

/**
 * Public row nodes for a transaction result, built on first read: a live feed that never looks at
 * `result.rows` (most callers) pays nothing for it.
 */
export function mapInternalRowNodeTransaction<TRowData>(
	deps: PublicRowNodeDispatchDeps<TRowData>,
	transaction: InternalRowNodeTransaction<TRowData>
): RowNodeTransaction<TRowData> {
	const map = (nodes: InternalRowNodeTransaction<TRowData>['add']) => nodes.map((node) => createPublicRowNodeFromInternal(deps, node));
	return lazyFields({ add: () => map(transaction.add), remove: () => map(transaction.remove), update: () => map(transaction.update) });
}

export function mapRowsUpdatedDispatchPayload<TRowData>(
	deps: PublicRowNodeDispatchDeps<TRowData>,
	payload: RowsUpdatedDispatchPayload<TRowData>
): GridEventPayloadMap<TRowData>[GridEventName.rowsUpdated] {
	const map = (nodes: RowsUpdatedDispatchPayload<TRowData>['changedNodes']) => nodes.map((node) => createPublicRowNodeFromInternal(deps, node));
	// Built on first read: listeners that only look at changedValuesByRow pay nothing for row nodes.
	return lazyFields({
		changedValuesByRow: () => payload.changedValuesByRow,
		changedNodes: () => map(payload.changedNodes),
		addedNodes: () => (payload.addedNodes ? map(payload.addedNodes) : undefined),
		removedNodes: () => (payload.removedNodes ? map(payload.removedNodes) : undefined),
	}) as GridEventPayloadMap<TRowData>[GridEventName.rowsUpdated];
}

/** An object whose fields are computed on first read and then kept (enumerable, so spreads see them). */
function lazyFields<T extends Record<string, unknown>>(factories: { [K in keyof T]: () => T[K] }): T {
	const target = {} as T;
	for (const key of Object.keys(factories) as Array<keyof T>) {
		Object.defineProperty(target, key, {
			configurable: true,
			enumerable: true,
			get() {
				const value = factories[key]();
				Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
				return value;
			},
		});
	}
	return target;
}
