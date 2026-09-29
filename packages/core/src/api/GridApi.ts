import type { FilterModel, SortModel } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import type { ColumnDef, CellRendererPhase, ColumnInstanceId } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import type { ViewportRange } from '../viewportController.js';
import type { RuntimeFault } from '../diagnostics/RuntimeFaultReporter.js';
import type { ColumnState, GridCellRangeBounds } from '../state/GridState.js';
import type { BuiltInThemeName } from '../renderer/themes.js';
import type { GridIntegrityIssue } from '../features/dataIntegrity/integrityTypes.js';
import type { GridApi as PublicGridApi, GridPluginRuntime as PublicGridPluginRuntime } from './GridApiSurfaces.js';
import type { GridRowNode } from '../publicRowNode.js';
import type { RowNodeTransaction } from '../rowTransactions.js';
import type { AggregationConfig, DetailConfig, GroupingConfig, TreeDataConfig } from '../rows/hierarchyConfig.js';

export type {
	GridDataApi,
	GridSelectionEditingApi,
	GridStructureApi,
	GridRuntimeSubscriptionApi,
	GridPersistenceWorkspaceApi,
	GridDiagnosticsCapabilityApi,
	GridApi,
	GridPluginRuntime,
	GridPluginController,
	GridRendererApi,
	GridHostRuntime,
	GridCompositionRuntime,
	InternalGridApi,
	ScrollToRowOptions,
	ScrollToCellOptions,
} from './GridApiSurfaces.js';

export type { CsvExportOptions } from '../export/csvExport.js';
export type { RuntimeFault };
export type { RowModelCapability, RowModelCapabilities } from '../rowModel.js';
export { UnsupportedRowModelOperationError } from '../rowModel.js';

// Integrity types (re-exported for convenience)
export type {
	GridIntegrityApi,
	GridIntegrityIssue,
	GridIntegrityIssueSource,
	GridIntegrityIssueType,
	GridIntegritySeverity,
	GridIntegrityIssueFilter,
	GridIntegritySummary,
	GridIntegrityScope,
	GridIntegrityRunOptions,
	GridIntegrityRunResult,
	GridDataIntegrityConfig,
	GridValidationIntegrityOptions,
	GridQualityIntegrityOptions,
	GridDiffIntegrityOptions,
	GridLiveStreamIntegrityOptions,
	GridConflictIntegrityOptions,
	GridCellIntegrityRule,
	GridRowIntegrityRule,
	GridIntegrityRuleResult,
	GridDataQualityRule,
	GridDataQualityRuleContext,
	GridDiffModel,
	GridDiffResult,
	GridCellDiff,
	GridDiffAcceptResult,
	GridCellConflict,
	ResolveConflictOptions,
	ConflictResolutionResult,
	ServerIntegrityReport,
	GridTransactionStreamHandle,
	GridTransactionStreamState,
	GridLiveStreamOptions,
	GridLiveStreamUpdate,
	GridCellStreamUpdate,
	GridRowStreamUpdate,
} from '../features/dataIntegrity/integrityTypes.js';

export interface CellSubscription {
	rowId: string;
	colField: string;
	onStoreChange: () => void;
}

export interface GridCellPointer {
	rowId: string;
	colField: string;
	columnInstanceId?: ColumnInstanceId;
	colId?: string;
}

export type CanonicalGridCellPointer = GridCellPointer & {
	columnInstanceId: ColumnInstanceId;
	colId: string;
};

export interface ActiveEditState extends GridCellPointer {
	columnInstanceId: ColumnInstanceId;
	colId: string;
	validationError?: string | null;
	draftValue?: unknown;
	originalValue?: unknown;
	startedBy?: 'keyboard' | 'mouse' | 'api';
	version?: number;
}

export interface CellPointer {
	rowId: string;
	colId: string;
}

export interface BatchCellValueUpdate {
	rowId: string;
	colField: string;
	value: unknown;
}

export interface GridWriteRejection {
	readonly mutationKind: string;
	readonly reason: string;
	readonly index?: number;
}

export type GridWriteResult =
	| {
			readonly status: 'applied';
			readonly changeId: number;
			readonly faults: readonly RuntimeFault[];
			readonly rejections?: readonly GridWriteRejection[];
	  }
	| { readonly status: 'noop' }
	| {
			readonly status: 'rejected';
			readonly reason: string;
			readonly rejections?: readonly GridWriteRejection[];
	  }
	| {
			readonly status: 'capabilityDenied';
			readonly reason: string;
	  }
	| {
			readonly status: 'validationFailed';
			readonly reason: string;
			readonly issues: readonly GridIntegrityIssue[];
	  }
	| {
			readonly status: 'failed';
			readonly error: RuntimeFault;
	  };

export interface VisualRowPointer {
	visualRowId: string;
}

export interface SelectionChangeResult {
	invalidatedCells: GridCellPointer[];
	invalidatedRows: string[];
	overlayChanged: boolean;
}

export type RowSelectionGestureSource = 'api' | 'checkbox' | 'headerCheckbox' | 'pointer' | 'keyboard';
export type RowSelectionGestureKind = 'replace' | 'select' | 'deselect' | 'toggle' | 'selectAll' | 'clear';
export type RowSelectionMode = 'single' | 'multiple';
export type RowSelectionScope = 'page' | 'loaded' | 'filtered' | 'all';

export interface RowSelectionOptions {
	mode: RowSelectionMode;
	selectAllScope?: RowSelectionScope;
}

export interface SelectRowsOptions {
	mode?: 'add' | 'replace';
}

export interface SelectAllRowsOptions {
	scope?: RowSelectionScope;
	mode?: 'add' | 'replace';
}

export interface RowSelectionGesture {
	kind: RowSelectionGestureKind;
	rowIds?: string[];
	source?: RowSelectionGestureSource;
	scope?: RowSelectionScope;
	mode?: 'add' | 'replace';
}

export interface RowSelectionChangeResult {
	selectedRowIds: string[];
	changedRowIds: string[];
	addedRowIds: string[];
	removedRowIds: string[];
	source: RowSelectionGestureSource;
}

export interface GridCellCoordinates {
	rowIndex: number;
	colIndex: number;
}

export type GridSelectionSource = 'api' | 'keyboard' | 'pointer' | 'fill' | 'program';

export interface GridCellRange {
	start: GridCellPointer;
	end: GridCellPointer;
}

export interface GridSelectionState {
	focus: GridCellPointer | null;
	anchor: GridCellPointer | null;
	range: GridCellRange | null;
	bounds: GridCellRangeBounds | null;
	source: GridSelectionSource;
	focusOrigin?: GridSelectionSource | null;
	version?: number;
}

export interface GridStateSnapshot<TRowData = unknown> {
	readonly columns: readonly ColumnDef<TRowData>[];
	readonly sortModel: SortModel | null;
	readonly filterModel: FilterModel | null;
	readonly queryModel?: GridQueryModel | null;
	readonly selection: GridSelectionState;
	readonly selectedRowIds: readonly string[];
	readonly activeEdit: ActiveEditState | null;
	readonly loading?: boolean;
	readonly pagination?: { pageSize: number; page?: number };
	readonly enableColumnReorder: boolean;
	readonly themeName?: BuiltInThemeName;
	readonly sidebarOpenPanel?: string | null;
	readonly chartOpen?: boolean;
	readonly grouping?: Readonly<GroupingConfig<TRowData>>;
	readonly treeData?: Readonly<TreeDataConfig<TRowData>>;
	readonly aggregation?: Readonly<AggregationConfig<TRowData>>;
	readonly detail?: Readonly<DetailConfig<TRowData>>;
	readonly globalVersion: number;
}

export type GridSnapshotListener<TRowData = unknown> = (snapshot: GridStateSnapshot<TRowData>) => void;
export type GridSnapshotKeyListener<TRowData = unknown, K extends keyof GridStateSnapshot<TRowData> = keyof GridStateSnapshot<TRowData>> = (
	value: GridStateSnapshot<TRowData>[K]
) => void;
export type GridSnapshotSelector<TRowData = unknown, TValue = unknown> = (snapshot: GridStateSnapshot<TRowData>) => TValue;
export type GridSnapshotSelectorListener<TValue = unknown> = (value: TValue) => void;
export type GridSnapshotSelectorEquality<TValue = unknown> = (left: TValue, right: TValue) => boolean;

export interface GridPlugin<TRowData = unknown> {
	readonly name: string;
	onInit?(api: PublicGridPluginRuntime<TRowData>): void;
	onMount?(): void;
	onDestroy?(): void;
	onViewportChange?(range: ViewportRange): void;
}

export interface GridCellClickParams<TRowData = unknown> {
	rowId: string;
	rowIndex: number;
	row: TRowData | null;
	node: GridRowNode<TRowData> | null;
	colField: string;
	colIndex: number;
	column: ColumnDef<TRowData>;
	value: unknown;
	api: PublicGridApi<TRowData>;
	event: MouseEvent;
}

export interface GridCellAccess<TRowData = unknown> {
	rowId: string;
	rowIndex: number;
	row: TRowData | null;
	node: GridRowNode<TRowData> | null;
	colField: string;
	colIndex: number;
	column: ColumnDef<TRowData>;
	value: unknown;
	rawValue: unknown;
	isFocused: boolean;
	isRowFocused: boolean;
	isSelected: boolean;
	isRowSelected: boolean;
	isEditing: boolean;
	isLoading: boolean;
	event?: Event;
}

export interface CellState {
	value: unknown;
	computedValue?: unknown;
	isEditing?: boolean;
}

export interface GridRowsAccessor<TRowData = unknown> {
	forEach(callback: (row: TRowData, index: number) => void): void;
	getAll(): TRowData[];
	getSelected(): TRowData[];
	getSelectedIds(): string[];
	getById(id: string): TRowData | null;
	getNodeById(id: string): GridRowNode<TRowData> | undefined;
	getCount(): number;
	getVisualRowById(id: string): VisualRow<TRowData> | null;
	inRange(range: GridCellRange): {
		forEach(callback: (rowId: string, index: number) => void): void;
		getIds(): string[];
		getData(): TRowData[];
	};
	getChecked(): TRowData[];
	getCheckedIds(): string[];
}

export interface AutoSizeColumnOptions {
	includeHeader?: boolean;
	maxRows?: number;
	padding?: number;
}

export interface AutoSizeAllColumnsOptions extends AutoSizeColumnOptions {
	skipPinned?: boolean;
}

export interface RowDataTransaction<TData = unknown> {
	add?: TData[];
	addIndex?: number;
	remove?: TData[];
	update?: TData[];
}

export type { RowNodeTransaction } from '../rowTransactions.js';

export interface GridTransaction<TRowData = unknown> {
	columns?: ColumnDef<TRowData>[];
	rows?: TRowData[];
	rowTransaction?: RowDataTransaction<TRowData>;
	sortModel?: SortModel | null;
	filterModel?: FilterModel | null;
	pins?: { left?: number; right?: number; top?: number; bottom?: number };
}

export type { ColumnState, GridCellRangeBounds };

export interface CellRendererProps<TRowData = unknown, TValue = unknown> {
	value: TValue;
	computedValue: TValue;
	/**
	 * Display text for `value`: the column's `valueFormatter` output, otherwise `String(value)`
	 * (`''` for null/undefined). Provided by the React adapter.
	 */
	formattedValue?: string;
	row: TRowData;
	rowId: string;
	colField: string;
	colId?: string;
	columnInstanceId?: ColumnInstanceId;
	isScrolling?: boolean;
	phase?: CellRendererPhase;
	isFocused?: boolean;
	isEditing?: boolean;
	isSelected?: boolean;
	api: PublicGridApi<TRowData>;
}

export interface CellEditorProps<TRowData = unknown, TValue = unknown> {
	rowId: string;
	colField: string;
	colId?: string;
	columnInstanceId?: ColumnInstanceId;
	value: TValue;
	onChange: (value: TValue) => void;
	api: PublicGridApi<TRowData>;
	onCommit: (finalValue?: TValue) => void;
	onCancel: () => void;
}

export interface HeaderMenuRendererProps<TRowData = unknown> {
	colField: string;
	column: ColumnDef<TRowData>;
	api: PublicGridApi<TRowData>;
	close: () => void;
	container: HTMLDivElement;
}
