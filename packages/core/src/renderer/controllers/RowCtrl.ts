import type { ColumnInstanceId } from '../../columnDef.js';
import type { VisualFreshness } from '../visualFreshness.js';
import type { CellControllerKey, CellCtrl } from './CellCtrl.js';
import type { CellCtrlStore } from './CellCtrlStore.js';

export interface RowCtrl<TRowData = unknown> {
	readonly rowId: string;
	rowVersion: number;
	attachedSlotId: string | undefined;
	attachedGeneration: number;
	cellKeysByColumnInstanceId: Map<ColumnInstanceId, CellControllerKey>;
	isEditing: boolean;
	isFocused: boolean;
}

export interface CellCtrlMetadata {
	rowIndex?: number;
	rowCtrlKey?: string;
	colId?: string;
	colField: string;
	colIndex?: number;
	freshness?: VisualFreshness;
}

export function createRowCtrl<TRowData = unknown>(rowId: string): RowCtrl<TRowData> {
	return {
		rowId,
		rowVersion: -1,
		attachedSlotId: undefined,
		attachedGeneration: -1,
		cellKeysByColumnInstanceId: new Map(),
		isEditing: false,
		isFocused: false,
	};
}

export function getOrCreateCellCtrl<TRowData>(
	rowCtrl: RowCtrl<TRowData>,
	cellCtrls: CellCtrlStore<TRowData>,
	columnInstanceId: ColumnInstanceId,
	metadata: CellCtrlMetadata
): { cellCtrl: CellCtrl; created: boolean } {
	const result = cellCtrls.getOrCreate({
		rowId: rowCtrl.rowId,
		rowIndex: metadata.rowIndex,
		rowCtrlKey: metadata.rowCtrlKey ?? rowCtrl.rowId,
		columnInstanceId,
		colId: metadata.colId,
		colField: metadata.colField,
		colIndex: metadata.colIndex,
		freshness: metadata.freshness,
	});
	rowCtrl.cellKeysByColumnInstanceId.set(columnInstanceId, result.cellCtrl.key);
	return result;
}
