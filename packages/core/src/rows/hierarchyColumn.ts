import type { ColumnDef } from '../columnDef.js';
import { isGroupingActive, type GroupingConfig, type HierarchyColumnConfig, type TreeDataConfig } from './hierarchyConfig.js';

/** Field of the auto hierarchy column. */
export const HIERARCHY_COLUMN_FIELD = '__hierarchy__';

export function isHierarchyColumn(column: { field: string } | null | undefined): boolean {
	return column?.field === HIERARCHY_COLUMN_FIELD;
}

export interface HierarchyColumnInputs<TData> {
	columns: ColumnDef<TData>[];
	pinnedColumns?: { left: number; right: number };
	grouping?: GroupingConfig<TData>;
	treeData?: TreeDataConfig<TData>;
	hierarchyColumn?: HierarchyColumnConfig<TData> | false;
}

/** Whether the hierarchy column should exist for this configuration. */
export function wantsHierarchyColumn<TData>(inputs: Omit<HierarchyColumnInputs<TData>, 'columns' | 'pinnedColumns'>): boolean {
	if (inputs.hierarchyColumn === false) return false;
	if (isGroupingActive(inputs.grouping)) return (inputs.grouping.display ?? 'column') === 'column';
	return !!inputs.treeData;
}

function createHierarchyColumn<TData>(inputs: HierarchyColumnInputs<TData>, existing: ColumnDef<TData> | undefined): ColumnDef<TData> {
	const config = inputs.hierarchyColumn || undefined;
	return {
		field: HIERARCHY_COLUMN_FIELD,
		header: config?.header ?? (isGroupingActive(inputs.grouping) ? 'Group' : 'Name'),
		width: config?.width ?? existing?.width ?? 240,
		...(config?.minWidth !== undefined ? { minWidth: config.minWidth } : {}),
		sortable: false,
		filterType: 'none',
		enableRowGroup: false,
		suppressHeaderMenu: true,
		canEdit: () => false,
		canMoveColumn: () => false,
		canGroup: () => false,
	};
}

/**
 * Adds, updates or removes the hierarchy column in `columns` so it matches the configuration, and
 * keeps the pinned-left count in step. Pinned: placed after any leading row-selection column;
 * unpinned: first unpinned column. Returns the inputs unchanged (same references) when nothing moves.
 */
export function syncHierarchyColumn<TData>(inputs: HierarchyColumnInputs<TData>): {
	columns: ColumnDef<TData>[];
	pinnedColumns?: { left: number; right: number };
	changed: boolean;
} {
	const { columns } = inputs;
	const pins = inputs.pinnedColumns ?? { left: 0, right: 0 };
	const index = columns.findIndex(isHierarchyColumn);
	const wanted = wantsHierarchyColumn(inputs);

	if (!wanted) {
		if (index === -1) return { columns, pinnedColumns: inputs.pinnedColumns, changed: false };
		const next = columns.filter((_, i) => i !== index);
		return { columns: next, pinnedColumns: index < pins.left ? { ...pins, left: pins.left - 1 } : inputs.pinnedColumns, changed: true };
	}

	const pinned = (inputs.hierarchyColumn || undefined)?.pinned ?? true;
	const column = createHierarchyColumn(inputs, index === -1 ? undefined : columns[index]);
	const without = index === -1 ? columns : columns.filter((_, i) => i !== index);
	const leftWithout = index !== -1 && index < pins.left ? pins.left - 1 : pins.left;
	let insertAt: number;
	if (pinned) {
		insertAt = 0;
		while (insertAt < leftWithout && without[insertAt]?.checkboxSelection) insertAt++;
	} else {
		insertAt = leftWithout;
	}
	const next = [...without.slice(0, insertAt), column, ...without.slice(insertAt)];
	const nextPins = { ...pins, left: pinned ? leftWithout + 1 : leftWithout };
	const unchanged = index === insertAt && nextPins.left === pins.left && sameColumnConfig(columns[index], column);
	if (unchanged) return { columns, pinnedColumns: inputs.pinnedColumns, changed: false };
	return { columns: next, pinnedColumns: nextPins, changed: true };
}

function sameColumnConfig<TData>(a: ColumnDef<TData>, b: ColumnDef<TData>): boolean {
	return a.header === b.header && a.width === b.width && a.minWidth === b.minWidth;
}

/**
 * Normalizes a caller-provided column list before it replaces `state.columns`: the hierarchy column
 * is the grid's, not the caller's, so it is stripped and re-synced from the configuration — kept
 * in its pinned place with the pinned count adjusted. Every full column-list write goes through this.
 */
export function withHierarchyColumnFor<TData>(
	nextColumns: ColumnDef<TData>[],
	state: Omit<HierarchyColumnInputs<TData>, 'columns'> & { columns: ColumnDef<TData>[] }
): { columns: ColumnDef<TData>[]; pinnedColumns?: { left: number; right: number } } {
	const currentIndex = state.columns.findIndex(isHierarchyColumn);
	const pins = state.pinnedColumns;
	// Pin counts exclude the column while it is stripped; the sync puts it (and its pin) back.
	const pinsWithout = pins && currentIndex !== -1 && currentIndex < pins.left ? { ...pins, left: pins.left - 1 } : pins;
	const synced = syncHierarchyColumn({ ...state, columns: nextColumns.filter((column) => !isHierarchyColumn(column)), pinnedColumns: pinsWithout });
	const nextPins = synced.pinnedColumns;
	const pinsChanged = !!nextPins && (nextPins.left !== pins?.left || nextPins.right !== pins?.right);
	return pinsChanged ? { columns: synced.columns, pinnedColumns: nextPins } : { columns: synced.columns };
}
