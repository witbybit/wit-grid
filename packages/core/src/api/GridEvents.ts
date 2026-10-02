import type { AggregationDef, DetailConfig, GroupingConfig, HierarchyColumnConfig, TreeDataConfig } from '../rows/hierarchyConfig.js';
import type { FilterModel, QuickFilterModel, SortModel } from '../rowModel.js';
import type { GridCellPointer, GridSelectionState, SelectionChangeResult, RowSelectionChangeResult, GridCellClickParams } from './GridApi.js';
import type { ColumnDef } from '../columnDef.js';
import type { RuntimeFault } from '../diagnostics/RuntimeFaultReporter.js';
import type { GridViewDefinition, GridWorkspaceState } from '../workspace/workspaceTypes.js';
import type { GridIntegrityIssue } from '../features/dataIntegrity/integrityTypes.js';
import type { GridRowNode } from '../publicRowNode.js';
import type { ServerSideStoreSnapshot } from '../serverSideRowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';

export interface GridEvent<T = unknown> {
	type: string;
	payload: T;
}

export type GridEventListener<T = unknown> = (event: GridEvent<T>) => void;

export enum GridEventName {
	aggregationChanged = 'aggregationChanged',
	cellClicked = 'cellClicked',
	cellInvalidated = 'cellInvalidated',
	cellsCopied = 'cellsCopied',
	cellsPasted = 'cellsPasted',
	cellValueChanged = 'cellValueChanged',
	writeBlocked = 'writeBlocked',
	columnOrderChanged = 'columnOrderChanged',
	columnReorderToggled = 'columnReorderToggled',
	columnResized = 'columnResized',
	columnsChanged = 'columnsChanged',
	editStarted = 'editStarted',
	editStopped = 'editStopped',
	detailChanged = 'detailChanged',
	expansionChanged = 'expansionChanged',
	filterChanged = 'filterChanged',
	quickFilterChanged = 'quickFilterChanged',
	focusChanged = 'focusChanged',
	groupByChanged = 'groupByChanged',
	groupingChanged = 'groupingChanged',
	hierarchyColumnChanged = 'hierarchyColumnChanged',
	groupColumnAdded = 'groupColumnAdded',
	groupColumnRemoved = 'groupColumnRemoved',
	groupColumnMoved = 'groupColumnMoved',
	layoutTransitionCaptureRequested = 'layoutTransitionCaptureRequested',
	renderInvalidated = 'renderInvalidated',
	rowResized = 'rowResized',
	rowSelectionChanged = 'rowSelectionChanged',
	rowsUpdated = 'rowsUpdated',
	runtimeFault = 'runtimeFault',
	selectionChanged = 'selectionChanged',
	paginationChanged = 'paginationChanged',
	// ── Infinite (block/range) row model events ───────────────────────────────
	infiniteBlockLoaded = 'infiniteBlockLoaded',
	infiniteBlockLoadFailed = 'infiniteBlockLoadFailed',
	// ── Server-page row model events ──────────────────────────────────────────
	serverSideStateChanged = 'serverSideStateChanged',
	sortChanged = 'sortChanged',
	treeDataChanged = 'treeDataChanged',
	cellValidationChanged = 'cellValidationChanged',
	gridValidated = 'gridValidated',
	rowDragStart = 'rowDragStart',
	rowDragMove = 'rowDragMove',
	rowDragEnd = 'rowDragEnd',
	rowDragCancelled = 'rowDragCancelled',
	rowOrderChanged = 'rowOrderChanged',
	// ── Query model events ────────────────────────────────────────────────────────
	queryModelChanged = 'queryModelChanged',
	// ── Workspace events ──────────────────────────────────────────────────────────
	viewSaved = 'viewSaved',
	viewApplied = 'viewApplied',
	viewDeleted = 'viewDeleted',
	viewRenamed = 'viewRenamed',
	workspaceStateChanged = 'workspaceStateChanged',
}

export type GridWriteBlockedSource = 'edit' | 'paste' | 'fill';
export type GridWriteBlockedStatus = 'validationFailed' | 'capabilityDenied' | 'rejected';
type LayoutTransitionCaptureReason = 'sort' | 'expansion' | 'detail' | 'live-reorder' | 'other';

export interface GridWriteBlockedEventPayload {
	source: GridWriteBlockedSource;
	status: GridWriteBlockedStatus;
	reason: string;
	cells: ReadonlyArray<{ rowId: string; colField: string }>;
	rowCount: number;
	colCount: number;
	issues?: readonly GridIntegrityIssue[];
}

export interface GridEventPayloadMap<TRowData = unknown> {
	[GridEventName.aggregationChanged]: { defs: AggregationDef<TRowData>[] };
	[GridEventName.cellClicked]: GridCellClickParams<TRowData>;
	[GridEventName.cellInvalidated]: { rowId: string; colField: string };
	[GridEventName.cellsCopied]: { cells: Array<{ rowId: string; colField: string }>; rowCount: number; colCount: number; text: string };
	[GridEventName.cellsPasted]: { rowCount: number; colCount: number };
	[GridEventName.cellValueChanged]: { rowId: string; colField: string; oldValue: unknown; newValue: unknown };
	[GridEventName.writeBlocked]: GridWriteBlockedEventPayload;
	[GridEventName.columnOrderChanged]: { columns: ColumnDef<TRowData>[]; columnFields: string[] };
	[GridEventName.columnReorderToggled]: { enabled: boolean };
	[GridEventName.columnResized]: { colField: string; width: number };
	[GridEventName.columnsChanged]: { columns: ColumnDef<TRowData>[]; columnFields: string[] };
	[GridEventName.editStarted]: { rowId: string; colField: string };
	[GridEventName.editStopped]: { rowId: string; colField: string; cancel: boolean };
	[GridEventName.detailChanged]: { detail: DetailConfig<TRowData> | undefined };
	/** A group, tree row or detail opened or closed; `target: 'all'` for expandAll / collapseAll. */
	[GridEventName.expansionChanged]: { target: 'row' | 'detail' | 'all'; id: string | null; expanded: boolean; maxLevel?: number };
	[GridEventName.filterChanged]: { filterModel: FilterModel | null };
	[GridEventName.quickFilterChanged]: { quickFilterModel: QuickFilterModel | null };
	[GridEventName.focusChanged]: { focus: GridCellPointer | null; selection: GridSelectionState };
	[GridEventName.groupByChanged]: { groupBy: string[] };
	[GridEventName.groupingChanged]: { grouping: GroupingConfig<TRowData> | undefined };
	[GridEventName.hierarchyColumnChanged]: { hierarchyColumn: HierarchyColumnConfig<TRowData> | false | undefined };
	[GridEventName.groupColumnAdded]: { colId: string; index: number; groupBy: string[] };
	[GridEventName.groupColumnRemoved]: { colId: string; groupBy: string[] };
	[GridEventName.groupColumnMoved]: { colId: string; fromIndex: number; toIndex: number; groupBy: string[] };
	[GridEventName.layoutTransitionCaptureRequested]: { reason: LayoutTransitionCaptureReason };
	[GridEventName.renderInvalidated]: { reason: string };
	[GridEventName.rowResized]: { rowId: string; height: number };
	[GridEventName.rowSelectionChanged]: RowSelectionChangeResult;
	[GridEventName.rowsUpdated]: {
		changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
		changedNodes: GridRowNode<TRowData>[];
		addedNodes?: GridRowNode<TRowData>[];
		removedNodes?: GridRowNode<TRowData>[];
	};
	[GridEventName.paginationChanged]: {
		page: number;
		pageCount: number;
		totalRows: number;
		pageSize: number;
	};
	[GridEventName.runtimeFault]: RuntimeFault;
	[GridEventName.selectionChanged]: { selection: GridSelectionState; result: SelectionChangeResult };
	[GridEventName.infiniteBlockLoaded]: {
		blockIndex: number;
		loadedBlockStart: number;
		loadedBlockEnd: number;
		totalRecords: number;
		durationMs: number;
	};
	[GridEventName.infiniteBlockLoadFailed]: {
		blockIndex: number;
		startRow: number;
		endRow: number;
		message: string;
	};
	[GridEventName.serverSideStateChanged]: {
		loading: boolean;
		error: string | null;
		storeStates: readonly ServerSideStoreSnapshot[];
	};
	[GridEventName.treeDataChanged]: { treeData: TreeDataConfig<TRowData> | undefined };
	[GridEventName.sortChanged]: { sortModel: SortModel | null };
	[GridEventName.cellValidationChanged]: { rowId: string; colField: string; error: string | null };
	[GridEventName.gridValidated]: { errors: Array<{ rowId: string; colField: string; error: string }>; hasErrors: boolean };
	[GridEventName.rowDragStart]: { rowId: string; rowData: unknown; visualIndex: number };
	[GridEventName.rowDragMove]: { rowId: string; overRowId: string | null; overVisualIndex: number | null };
	[GridEventName.rowDragEnd]: { rowId: string; overRowId: string | null; overVisualIndex: number | null };
	[GridEventName.rowDragCancelled]: { rowId: string };
	[GridEventName.rowOrderChanged]: { rowIds: string[] };
	[GridEventName.queryModelChanged]: { queryModel: GridQueryModel | null };
	[GridEventName.viewSaved]: { view: GridViewDefinition };
	[GridEventName.viewApplied]: { view: GridViewDefinition };
	[GridEventName.viewDeleted]: { id: string };
	[GridEventName.viewRenamed]: { id: string; name: string };
	[GridEventName.workspaceStateChanged]: { state: GridWorkspaceState };
}
