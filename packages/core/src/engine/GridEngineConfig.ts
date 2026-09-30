import type {
	AggregationConfig,
	DetailConfig,
	ExpansionState,
	GroupingConfig,
	HierarchyColumnConfig,
	TreeDataConfig,
} from '../rows/hierarchyConfig.js';
import type { ColumnDef, GridStyleRule, GridRendererOptions } from '../columnDef.js';
import type { ActiveEditState, GridCellPointer, GridSelectionState, RowSelectionOptions } from '../api/GridApi.js';
import type { BuiltInThemeName, ThemeTokens } from '../renderer/themes.js';
import type { SortModel, FilterModel, QuickFilterModel } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import type { GridCapabilitiesConfig } from '../capabilities/capabilityTypes.js';
import type { GridDataIntegrityConfig } from '../features/dataIntegrity/integrityTypes.js';

export interface GridEngineConfig<TRowData = unknown> {
	columns: ColumnDef<TRowData>[];
	/** Enables first-class row node selection and configures built-in checkbox behavior. */
	rowSelection?: RowSelectionOptions;
	getRowId?: (row: TRowData) => string;
	rowHeights?: Record<string, number>;
	columnWidths?: Record<string, number>;
	defaultRowHeight?: number;
	defaultColWidth?: number;
	enableColumnReorder?: boolean;
	selection?: GridSelectionState;
	selectedRowIds?: string[];
	sortModel?: SortModel | null;
	filterModel?: FilterModel | null;
	quickFilterModel?: QuickFilterModel | null;
	queryModel?: GridQueryModel | null;
	capabilities?: GridCapabilitiesConfig<TRowData>;
	canPerformAction?: GridCapabilitiesConfig<TRowData>['canPerformAction'];
	themeName?: BuiltInThemeName;
	/**
	 * Partial theme token overrides applied on top of `themeName` (or the default theme) when the
	 * renderer mounts. Resolved atomically with the base theme, before first paint — no separate
	 * imperative call needed. For changes after mount, use `GridApi.setTheme()`/`mergeTheme()`.
	 */
	themeOverrides?: Partial<ThemeTokens>;
	activeEdit?: GridCellPointer | ActiveEditState | null;
	loadingSkeletonCount?: number;
	styleRules?: GridStyleRule<TRowData>[];
	loading?: boolean;
	/** Unified Data Integrity pipeline configuration. */
	dataIntegrity?: GridDataIntegrityConfig<TRowData>;

	// Hierarchy: grouping, tree data, aggregation, master-detail
	grouping?: GroupingConfig<TRowData>;
	treeData?: TreeDataConfig<TRowData>;
	aggregation?: AggregationConfig<TRowData>;
	detail?: DetailConfig<TRowData>;
	hierarchyColumn?: HierarchyColumnConfig<TRowData> | false;
	pinnedColumns?: { left: number; right: number };
	showGroupPanel?: boolean;
	showFilterChipBar?: boolean;
	showFloatingFilters?: boolean;
	showStatusBar?: boolean;
	pagination?: { pageSize: number; page?: number };
	expansion?: ExpansionState;
	/**
	 * Pixel height of the pre-render buffer above and below the visible viewport.
	 * The grid renders all rows that overlap [visibleTop - rowOverscanPx, visibleBottom + rowOverscanPx],
	 * so the buffer is always a fixed pixel amount regardless of individual row heights.
	 * Default: 400px (roughly 10 rows at the default 40px row height).
	 */
	rowOverscanPx?: number;
	colBuffer?: number;
	/**
	 * Pixel-based horizontal overscan applied on the leading (scroll-direction) edge. The
	 * effective column buffer on that edge is max(colBuffer, columns covering this many px),
	 * so grids with many narrow columns keep a real pixel margin during horizontal swipes.
	 * The rendered-cell runtime limits still apply. Default: 0 (count-based colBuffer only).
	 */
	colOverscanPx?: number;
	runtimeLimits?: {
		maxRenderedRows?: number;
		maxRenderedCells?: number;
		suppressRenderedRangeLimit?: boolean;
		maxFilterDistinctValues?: number;
	};
	/**
	 * When true, the overscan buffer automatically expands in the scroll direction proportional
	 * to scroll velocity, reducing blank-band flashes during fast scrolling.
	 * Default: false.
	 */
	overscanAdaptive?: boolean;
	/** Returns the host container element. Used by auto-size and any feature that needs DOM measurements. */
	getContainerElement?: () => HTMLElement | null;
	/** Grid-wide scroll presentation policy — live-mode overscan/budgets, html-snapshot cache limits
	 *  and missing-capture defaults, text-impostor defaults. See columnDef.ts's GridRendererOptions. */
	rendererOptions?: GridRendererOptions;
	/**
	 * How long `applyTransactionAsync` waits before applying queued transactions, in ms. When unset,
	 * they are applied on the next animation frame.
	 */
	asyncTransactionWaitMs?: number;
}
