import type { ColumnDef } from '../columnDef.js';
import { groupByColIds, isGroupingActive, type GroupingConfig, type HierarchyColumnConfig, type TreeDataConfig } from './hierarchyConfig.js';

/** Field of the auto hierarchy column; `display: 'columns'` adds one per level as `__hierarchy__:<colId>`. */
export const HIERARCHY_COLUMN_FIELD = '__hierarchy__';
const LEVEL_PREFIX = `${HIERARCHY_COLUMN_FIELD}:`;

export function isHierarchyColumn(column: { field: string } | null | undefined): boolean {
	const field = column?.field;
	return field === HIERARCHY_COLUMN_FIELD || (!!field && field.startsWith(LEVEL_PREFIX));
}

/** `display: 'columns'`: the grouped column a level column shows; null for the single hierarchy column. */
export function hierarchyColumnGroupColId(column: { field: string } | null | undefined): string | null {
	const field = column?.field;
	return field && field.startsWith(LEVEL_PREFIX) ? field.slice(LEVEL_PREFIX.length) : null;
}

export interface HierarchyColumnInputs<TData> {
	columns: ColumnDef<TData>[];
	pinnedColumns?: { left: number; right: number };
	grouping?: GroupingConfig<TData>;
	treeData?: TreeDataConfig<TData>;
	hierarchyColumn?: HierarchyColumnConfig<TData> | false;
}

/** Whether hierarchy columns should exist for this configuration. */
export function wantsHierarchyColumn<TData>(inputs: Omit<HierarchyColumnInputs<TData>, 'columns' | 'pinnedColumns'>): boolean {
	if (inputs.hierarchyColumn === false) return false;
	if (isGroupingActive(inputs.grouping)) return (inputs.grouping.display ?? 'column') !== 'row';
	return !!inputs.treeData;
}

function createHierarchyColumn<TData>(
	field: string,
	header: string,
	width: number,
	config: HierarchyColumnConfig<TData> | undefined
): ColumnDef<TData> {
	return {
		field,
		header,
		width,
		...(config?.minWidth !== undefined ? { minWidth: config.minWidth } : {}),
		sortable: false,
		filterDef: { type: 'none' },
		enableRowGroup: false,
		suppressHeaderMenu: true,
		canEdit: () => false,
		canMoveColumn: () => false,
		canGroup: () => false,
	};
}

/** The hierarchy columns this configuration wants, reusing widths of existing ones (user resizes). */
function wantedHierarchyColumns<TData>(inputs: HierarchyColumnInputs<TData>, existing: ReadonlyMap<string, ColumnDef<TData>>): ColumnDef<TData>[] {
	if (!wantsHierarchyColumn(inputs)) return [];
	const config = inputs.hierarchyColumn || undefined;
	if (isGroupingActive(inputs.grouping) && inputs.grouping.display === 'columns') {
		const columnsByField = new Map(inputs.columns.map((column) => [column.field, column]));
		return groupByColIds(inputs.grouping).map((colId) => {
			const field = `${LEVEL_PREFIX}${colId}`;
			return createHierarchyColumn(
				field,
				columnsByField.get(colId)?.header ?? colId,
				config?.width ?? existing.get(field)?.width ?? 180,
				config
			);
		});
	}
	const header = config?.header ?? (isGroupingActive(inputs.grouping) ? 'Group' : 'Name');
	return [createHierarchyColumn(HIERARCHY_COLUMN_FIELD, header, config?.width ?? existing.get(HIERARCHY_COLUMN_FIELD)?.width ?? 240, config)];
}

/**
 * Adds, updates or removes the hierarchy column(s) in `columns` so they match the configuration, and
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
	const existing = new Map<string, ColumnDef<TData>>();
	let pinnedExisting = 0;
	columns.forEach((column, i) => {
		if (!isHierarchyColumn(column)) return;
		existing.set(column.field, column);
		if (i < pins.left) pinnedExisting++;
	});
	const wanted = wantedHierarchyColumns(inputs, existing);
	if (wanted.length === 0 && existing.size === 0) return { columns, pinnedColumns: inputs.pinnedColumns, changed: false };

	const without = existing.size === 0 ? columns : columns.filter((column) => !isHierarchyColumn(column));
	const leftWithout = pins.left - pinnedExisting;
	const pinned = (inputs.hierarchyColumn || undefined)?.pinned ?? true;
	let insertAt = leftWithout;
	if (pinned) {
		insertAt = 0;
		while (insertAt < leftWithout && without[insertAt]?.checkboxSelection) insertAt++;
	}
	const next = [...without.slice(0, insertAt), ...wanted, ...without.slice(insertAt)];
	const nextPins = { ...pins, left: pinned && wanted.length > 0 ? leftWithout + wanted.length : leftWithout };
	const unchanged =
		nextPins.left === pins.left &&
		next.length === columns.length &&
		next.every((column, i) => column.field === columns[i].field && (!isHierarchyColumn(column) || sameColumnConfig(columns[i], column)));
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
	const pins = state.pinnedColumns;
	// Pin counts exclude the hierarchy columns while they are stripped; the sync puts them (and their pins) back.
	const pinnedHierarchy = pins ? state.columns.filter((column, i) => i < pins.left && isHierarchyColumn(column)).length : 0;
	const pinsWithout = pins && pinnedHierarchy > 0 ? { ...pins, left: pins.left - pinnedHierarchy } : pins;
	const synced = syncHierarchyColumn({ ...state, columns: nextColumns.filter((column) => !isHierarchyColumn(column)), pinnedColumns: pinsWithout });
	const nextPins = synced.pinnedColumns;
	const pinsChanged = !!nextPins && (nextPins.left !== pins?.left || nextPins.right !== pins?.right);
	return pinsChanged ? { columns: synced.columns, pinnedColumns: nextPins } : { columns: synced.columns };
}
