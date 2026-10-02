import type { RowModel, RowModelKind, RowModelRefreshResult } from '../rowModel.js';
import type { VisualRow } from '../visualRow.js';
import type { RowNode } from '../rowNode.js';

export interface MinimalRowModelOptions<TRowData> {
	visualRows: VisualRow<TRowData>[];
	getRowNodeById?: (rowId: string) => RowNode<TRowData> | null;
	getRawRowById?: (rowId: string) => TRowData | null;
}

export function createMinimalRowModel<TRowData>(options: MinimalRowModelOptions<TRowData>): RowModel<TRowData> {
	const getRowLoadState = (index: number) => {
		const row = options.visualRows[index];
		if (!row) return { kind: 'missing' } as const;
		if (row.kind === 'data') return { kind: 'loaded', rowId: row.rowId } as const;
		if (row.kind === 'loading') return { kind: 'loading' } as const;
		if (row.kind === 'failed') return { kind: 'failed', error: row.error, retryable: row.retryable } as const;
		if (row.kind === 'placeholder') return { kind: 'placeholder', reason: row.reason } as const;
		return { kind: 'loaded', rowId: row.id } as const;
	};

	return {
		// A viewport-only test double: no row model kind's capabilities, so it matches no capability probe.
		kind: 'minimal' as unknown as RowModelKind,
		getVisualRow: (index) => options.visualRows[index] ?? null,
		getVisualRowCount: () => options.visualRows.length,
		getKnownRowCount: () => options.visualRows.length,
		getEstimatedRowCount: () => options.visualRows.length,
		getRowCountKind: () => 'known',
		getVisualIndexById: (id) => options.visualRows.findIndex((row) => row.id === id),
		getVisualIndexByRowId: (id) => options.visualRows.findIndex((row) => row.kind === 'data' && row.rowId === id),
		getRowNodeById: options.getRowNodeById ?? (() => null),
		getRawRowById: options.getRawRowById ?? (() => null),
		getRowLoadState,
		isRowLoaded: (index) => getRowLoadState(index).kind === 'loaded',
		isRowLoading: (index) => getRowLoadState(index).kind === 'loading',
		isRowFailed: (index) => getRowLoadState(index).kind === 'failed',
		isRangeLoaded: (startRow, endRow) => {
			for (let index = startRow; index <= endRow; index++) {
				if (getRowLoadState(index).kind !== 'loaded') return false;
			}
			return true;
		},
		getRangeLoadState: (startRow, endRow) => {
			const state = { loaded: 0, loading: 0, failed: 0, placeholder: 0, missing: 0 };
			for (let index = startRow; index <= endRow; index++) {
				const rowState = getRowLoadState(index);
				state[rowState.kind]++;
			}
			return state;
		},
		ensureRange: () => {},
		refresh: (): RowModelRefreshResult => ({ changed: false }),
	};
}
