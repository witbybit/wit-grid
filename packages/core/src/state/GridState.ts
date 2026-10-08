import type { FilterModel, QuickFilterModel, SortDirection, SortModel } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import type {
	AggregationConfig,
	DetailConfig,
	ExpansionState,
	GroupingConfig,
	HierarchyColumnConfig,
	TreeDataConfig,
} from '../rows/hierarchyConfig.js';
import type { ServerSideStoreSnapshot } from '../serverSideRowModel.js';
import type { ColumnDef, GridStyleRule, GridRendererOptions } from '../columnDef.js';
import type { CanonicalGridSelectionState, GridInteractionState } from '../interaction/interactionState.js';
import type { BuiltInThemeName, ThemeTokens } from '../renderer/themes.js';
import type { ViewportRange } from '../viewportController.js';
import type { ActiveEditState, RowSelectionOptions } from '../api/GridApi.js';
import type {
	GridCellConflict,
	GridCellDiff,
	GridDiffModel,
	GridDiffResult,
	GridIntegrityIssue,
	GridIntegrityIssueSource,
	GridIntegritySummary,
	GridTransactionStreamState,
	ServerIntegrityReport,
} from './integrityStateTypes.js';

/**
 * User-configured and persisted fields.
 * Serialize this slice to localStorage / server for state restoration.
 * All fields either come from the user at construction time or are mutated
 * by explicit user actions (sort, filter, column resize, etc.).
 */
export interface GridModelState<TRowData = unknown> {
	getRowId?: (row: TRowData) => string;
	columns: ColumnDef<TRowData>[];
	defaultRowHeight: number;
	defaultColWidth: number;
	enableColumnReorder: boolean;

	rowHeights: Record<string, number>; // rowId -> height in px
	columnWidths: Record<string, number>; // colField -> width in px

	sortModel: SortModel | null;
	filterModel: FilterModel | null;
	/** Single search string matched across multiple columns — the "search box" pattern. ANDed with filterModel/queryModel. */
	quickFilterModel: QuickFilterModel | null;
	queryModel: GridQueryModel | null;
	themeName: BuiltInThemeName;
	/** Partial theme token overrides applied on top of `themeName` when the renderer mounts. */
	themeOverrides?: Partial<ThemeTokens>;

	/** Row grouping. Absent, or with no `by` levels, means rows are not grouped. */
	grouping?: GroupingConfig<TRowData>;
	/** Tree data: rows nest under the row `getParentId` names. Grouping takes precedence when both are set. */
	treeData?: TreeDataConfig<TRowData>;
	/** Aggregates shown on group, total and tree-parent rows. */
	aggregation?: AggregationConfig<TRowData>;
	/** Master-detail: rows that can open a detail row beneath them. */
	detail?: DetailConfig<TRowData>;
	/** The auto hierarchy column shown while rows are grouped or tree-shaped; `false` turns it off. */
	hierarchyColumn?: HierarchyColumnConfig<TRowData> | false;
	showGroupPanel?: boolean;
	showFilterChipBar?: boolean;
	/** A strip beside the vertical scrollbar marking selection, recent edits, issues and app marks across all rows. */
	showMinimap?: boolean;
	pinnedColumns?: { left: number; right: number };

	/** Show an always-visible inline filter row below the column headers. */
	showFloatingFilters?: boolean;
	/**
	 * 'managed': grid reorders rows automatically on drop.
	 * 'unmanaged': grid fires events but does not reorder; handle drop in onRowDragEnd.
	 * Only applies to client-side row model. Default: 'managed'.
	 */
	rowDragMode?: 'managed' | 'unmanaged';

	// Bottom chrome. Presence gates the bottom-chrome height in the layout plan.
	showStatusBar?: boolean;
	pagination?: { pageSize: number; page?: number };

	selectedRowIds: string[];
	rowSelection?: RowSelectionOptions;

	expansion: ExpansionState;

	// Render tuning config
	styleRules?: GridStyleRule<TRowData>[];
	/** Grid-wide scroll presentation policy — see columnDef.ts's GridRendererOptions. Initial-only. */
	rendererOptions?: GridRendererOptions;
	/** See GridEngineConfig.asyncTransactionWaitMs. */
	asyncTransactionWaitMs?: number;
	rowOverscanPx?: number;
	/**
	 * Number of off-screen columns to pre-render on each side of the visible range.
	 * Higher values smooth fast horizontal scrolls at the cost of extra DOM nodes.
	 * Lower values maximise DOM savings but risk blank columns during rapid swipes.
	 * Default: 2. Finance grids with narrow columns (80–120 px) benefit from at least 2.
	 */
	colBuffer?: number;
	/** Minimum pixel width of off-screen columns pre-rendered on the leading (scroll-direction) edge. */
	colOverscanPx?: number;
	runtimeLimits?: {
		maxRenderedRows?: number;
		maxRenderedCells?: number;
		suppressRenderedRangeLimit?: boolean;
		maxFilterDistinctValues?: number;
		/**
		 * Max custom-cell-renderer instances kept warm (React-mounted, hidden) after scrolling
		 * out of view, reused on re-entry instead of a full cold remount. Default: 300.
		 * Size this to at least (visible custom-renderer cells) + (a few rows of scroll-back
		 * slack) — undersizing causes cold-mount thrashing (React unmount+remount) whenever a
		 * user scrolls past more distinct custom cells than this in one direction, then reverses.
		 */
		maxWarmCustomRenderers?: number;
	};
	overscanAdaptive?: boolean;
}

/**
 * Derived, ephemeral runtime state.
 * Never persist this slice — it is recomputed on every render cycle.
 */
export interface GridRuntimeState {
	// Incremented on any change that restructures the visual row set (sort, filter, group, row add/remove).
	globalVersion: number;
	// 2D recycled viewport range states
	visibleRowRange: ViewportRange;
	visibleColRange: ViewportRange;
	// Cell range selection (focus, anchor, range, bounds)
	selection: CanonicalGridSelectionState;
}

/**
 * Public row-model type surface. `'server'` is the server-side row model (SSRM).
 */
export type RowModelType = 'client' | 'infinite' | 'server';

/**
 * Transient UI state — session-only, not persisted by default.
 * Controls loading indicators, open panels, active editor, etc.
 */
export interface GridUIState {
	loading?: boolean;
	loadingSkeletonCount?: number;
	activeEdit: ActiveEditState | null;
	sidebarOpenPanel?: string | null;
	chartOpen?: boolean;
	/** Populated by the infinite row model when server pagination metadata is known. */
	serverPagination?: {
		page: number;
		pageCount: number;
		totalRows: number;
		pageSize: number;
	};
	/** Populated by the server-side row model (SSRM). */
	serverSide?: {
		loading: boolean;
		error: string | null;
		storeStates: readonly ServerSideStoreSnapshot[];
	};
}

export interface GridIntegrityValidationState {
	issues: readonly GridIntegrityIssue[];
	cellErrorIndex: Record<string, GridIntegrityIssue>;
}

export interface GridIntegrityQualityState {
	issues: readonly GridIntegrityIssue[];
}

export interface GridIntegrityDiffState<TRowData = unknown> {
	model: GridDiffModel<TRowData> | null;
	result: GridDiffResult | null;
	cellDiffIndex: Record<string, GridCellDiff>;
}

export interface GridIntegrityConflictState {
	conflicts: readonly GridCellConflict[];
	cellConflictIndex: Record<string, string>;
	resolvedConflicts: number;
	lastConflictAt: number | null;
}

export interface GridIntegrityLiveStreamState {
	issues: readonly GridIntegrityIssue[];
	session: GridTransactionStreamState | null;
}

export interface GridIntegrityState<TRowData = unknown> {
	validation: GridIntegrityValidationState;
	quality: GridIntegrityQualityState;
	diff: GridIntegrityDiffState<TRowData>;
	conflicts: GridIntegrityConflictState;
	liveStream: GridIntegrityLiveStreamState;
	publishedIssues: Partial<Record<GridIntegrityIssueSource, readonly GridIntegrityIssue[]>>;
	serverReport: ServerIntegrityReport | null;
	summary: GridIntegritySummary;
}

/**
 * Full internal grid state: intersection of model, runtime, and UI slices.
 * This is an implementation detail used inside the core runtime, not a stable
 * public snapshot contract.
 */
export type InternalGridState<TRowData = unknown> = GridModelState<TRowData> &
	GridRuntimeState &
	GridUIState & {
		interaction?: GridInteractionState;
		integrity: GridIntegrityState<TRowData>;
	};

export type GridInitialState<TRowData = unknown> = GridModelState<TRowData> & Omit<GridUIState, never> & Partial<Pick<GridRuntimeState, 'selection'>>;

/** Serializable snapshot of a single column's user-configurable state. */
export interface ColumnState {
	field: string;
	width?: number;
	hide?: boolean;
	/** Pin lane. Omitted for hidden columns. `false` means explicitly unpinned. */
	pinned?: 'left' | 'right' | false;
	/** Sort direction. `null` means explicitly no sort on this column. */
	sort?: SortDirection | null;
	/** Zero-based position in the multi-column sort order. */
	sortIndex?: number;
}

export interface GridCellRangeBounds {
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}

export type GridStateUpdater<TRowData = unknown> =
	| Partial<InternalGridState<TRowData>>
	| ((state: InternalGridState<TRowData>) => Partial<InternalGridState<TRowData>>);

export type Listener<TRowData = unknown> = (state: InternalGridState<TRowData>) => void;
