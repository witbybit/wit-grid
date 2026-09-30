import type { RowNode } from './rowNode.js';
import type { ColumnDef } from './columnDef.js';
import { normalizeCapabilityResult } from './capabilities/capabilityTypes.js';
import type { GroupPathItem } from './rows/visualRowIds.js';

/**
 * A row's place in the hierarchy (row groups, tree data, totals, detail rows). Every visual row
 * carries one, so renderers, keyboard, selection and ARIA read the hierarchy instead of
 * reconstructing it. Flat rows share FLAT_HIERARCHY.
 */
export interface RowHierarchy {
	/** 0 for top-level rows. Rows inside a group are one level deeper than the group. */
	readonly level: number;
	/** Visual id of the parent group or tree row; null at the top level. */
	readonly parentId: string | null;
	/** True for groups and for tree rows with children. */
	readonly hasChildren: boolean;
	/** Whether the children are shown; always false when there are none. */
	readonly expanded: boolean;
	/** Direct children. */
	readonly childCount: number;
	/** Data rows beneath, all of them (not only the visible ones). */
	readonly leafCount: number;
	/** 1-based position among siblings (aria-posinset); 0 for rows outside the sibling set (totals). */
	readonly posInSet: number;
	/** Number of siblings (aria-setsize); 0 for rows outside the sibling set. */
	readonly setSize: number;
}

export const FLAT_HIERARCHY: RowHierarchy = Object.freeze({
	level: 0,
	parentId: null,
	hasChildren: false,
	expanded: false,
	childCount: 0,
	leafCount: 0,
	posInSet: 0,
	setSize: 0,
});

export interface DataVisualRow<T> {
	kind: 'data';
	id: string;
	rowId: string;
	node: RowNode<T>;
	hierarchy: RowHierarchy;
	/** Tree parents with aggregation configured: the aggregate of their descendants, by column id. */
	aggregates?: Record<string, unknown>;
	height?: number;
	selectable?: true;
	editable?: true;
}

export interface GroupVisualRow<T> {
	kind: 'group';
	id: string;
	groupId: string;
	field: string;
	key: unknown;
	keyString: string;
	path: GroupPathItem[];
	hierarchy: RowHierarchy;
	aggregates: Record<string, unknown>;
	height?: number;
	selectable?: boolean;
	editable?: false;
}

export interface DetailVisualRow<T> {
	kind: 'detail';
	id: string;
	parentId: string;
	parentRowId?: string;
	hierarchy: RowHierarchy;
	height: number;
	render: unknown;
	selectable?: false;
	editable?: false;
}

export type TotalPlacement = 'top' | 'bottom';

/** A total row: the aggregates of one group (scope 'group') or of every row (scope 'grand'). */
export interface TotalVisualRow<T> {
	kind: 'total';
	id: string;
	scope: 'group' | 'grand';
	/** The group this totals; null for the grand total. */
	groupId: string | null;
	placement: TotalPlacement;
	hierarchy: RowHierarchy;
	aggregates: Record<string, unknown>;
	height?: number;
	selectable?: false;
	editable?: false;
}

export interface LoadingVisualRow {
	kind: 'loading';
	id: string;
	rowIndex: number;
	hierarchy: RowHierarchy;
	height?: number;
	editable?: false;
}

export interface FailedVisualRow {
	kind: 'failed';
	id: string;
	rowIndex: number;
	error: string;
	retryable: boolean;
	hierarchy: RowHierarchy;
	height?: number;
	editable?: false;
}

export interface PlaceholderVisualRow {
	kind: 'placeholder';
	id: string;
	rowIndex: number;
	reason?: string;
	hierarchy: RowHierarchy;
	height?: number;
	editable?: false;
}

export type VisualRow<TRowData = unknown> =
	| DataVisualRow<TRowData>
	| GroupVisualRow<TRowData>
	| DetailVisualRow<TRowData>
	| TotalVisualRow<TRowData>
	| LoadingVisualRow
	| FailedVisualRow
	| PlaceholderVisualRow;

export function isDataVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): row is DataVisualRow<TRowData> {
	return row?.kind === 'data';
}

export function isFullWidthVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return row?.kind === 'detail' || row?.kind === 'failed' || row?.kind === 'placeholder';
}

export function isSelectableVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	if (row?.kind === 'data') return true;
	if (row?.kind === 'group') return row.selectable !== false;
	return false;
}

export function isEditableVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return row?.kind === 'data';
}

export function canEditCell<TRowData>(row: VisualRow<TRowData> | null | undefined, column: ColumnDef<TRowData> | null | undefined): boolean {
	if (row?.kind !== 'data' || !column) return false;
	if (!column.canEdit) return true;
	return normalizeCapabilityResult(column.canEdit({ action: 'edit', row: row.node.data as TRowData, rowId: row.rowId, colField: column.field }))
		.allowed;
}

export function canFocusVisualRow<TRowData>(row: VisualRow<TRowData> | null | undefined): boolean {
	return !!row && row.kind !== 'loading' && row.kind !== 'failed' && row.kind !== 'placeholder';
}

/** Cells focus and range selection can rest on: data rows and the hierarchy's group / total rows. */
export function isCellSelectable<TRowData>(row: VisualRow<TRowData> | null | undefined, column: ColumnDef<TRowData> | null | undefined): boolean {
	return (row?.kind === 'data' || row?.kind === 'group' || row?.kind === 'total') && !!column;
}

export function isDataCellSelectable<TRowData>(row: VisualRow<TRowData> | null | undefined, column: ColumnDef<TRowData> | null | undefined): boolean {
	return row?.kind === 'data' && !!column;
}
