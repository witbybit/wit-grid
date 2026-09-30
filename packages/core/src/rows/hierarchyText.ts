import type { ColumnDef } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import { hierarchyCellInputsFor, hierarchyRowCellText } from './hierarchyCellModel.js';
import { isHierarchyColumn } from './hierarchyColumn.js';
import { type GroupingConfig, type HierarchyColumnConfig, type TreeDataConfig } from './hierarchyConfig.js';

export interface HierarchyTextSource<TData> {
	getState(): { grouping?: GroupingConfig<TData>; treeData?: TreeDataConfig<TData>; hierarchyColumn?: HierarchyColumnConfig<TData> | false };
	getColumn(field: string): ColumnDef<TData> | undefined;
	getCellValue(rowId: string, field: string): unknown;
}

export type HierarchyTextResolver<TData> = (
	row: VisualRow<TData>,
	col: ColumnDef<TData>,
	options?: { withCount?: boolean; indent?: string }
) => string;

/**
 * Text for cells of the hierarchy (the hierarchy column on any row, every column on group and
 * total rows) — the same label and formatted aggregate the grid draws, for copy and export.
 */
export function createHierarchyTextResolver<TData>(source: HierarchyTextSource<TData>): HierarchyTextResolver<TData> {
	return (row, col, options) => {
		const state = source.getState();
		return hierarchyRowCellText(
			row,
			col,
			isHierarchyColumn(col),
			hierarchyCellInputsFor(state, col),
			{ getColumn: source.getColumn, getCellValue: source.getCellValue, isRowSelected: () => false, getDescendantSelection: () => 'none' },
			options
		);
	};
}
