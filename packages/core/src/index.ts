export { createClientGrid, createInfiniteGrid, createServerSideGrid, createLocalStorageAdapter } from './createGrid.js';
export type {
	ClientGridOptions,
	InfiniteGridOptions,
	ServerSideGridOptions,
	GridPersistenceAdapter,
	PersistedGridState,
	GridWorkspaceAdapter,
} from './createGrid.js';
export type { GridViewDefinition, GridWorkspaceState, SaveViewOptions } from './workspace/workspaceTypes.js';
export { createLocalStorageWorkspaceAdapter } from './workspace/localStorageWorkspaceAdapter.js';
export { createWorkspaceController } from './workspace/GridWorkspaceController.js';
export type { GridWorkspaceController } from './workspace/GridWorkspaceController.js';
export type {
	GridQueryModel,
	GridQueryGroup,
	GridQueryCondition,
	GridQueryNode,
	QueryDiagnostics,
	QueryConditionDiagnostic,
} from './query/GridQueryModel.js';
export { createEmptyQueryModel, isQueryModelActive, countQueryNodes } from './query/GridQueryModel.js';
export type { GridAnalysisStateSummary } from './analysis/analysisState.js';
export { summarizeAnalysisState } from './analysis/analysisState.js';
export type { GridDistinctValueSummary } from './distinctValues.js';
export { evaluateQueryModel, applyQueryModelFilter, createQueryEvaluationContext } from './query/evaluateQueryModel.js';
export type { QueryEvaluationContext } from './query/evaluateQueryModel.js';
export type {
	GridCapabilityAction,
	GridCapabilityParams,
	GridCapabilityResult,
	GridCapabilityCallback,
	GridCapabilitiesConfig,
	CapabilityDiagnostics,
} from './capabilities/capabilityTypes.js';
export { normalizeCapabilityResult, CAPABILITY_ALLOWED } from './capabilities/capabilityTypes.js';
export type { InfiniteDatasource, InfiniteGetRowsParams, InfiniteGetRowsResult, InfiniteRowModelOptions } from './infiniteRowModel.js';
export type {
	CreateServerSideGetRowsRequestInput,
	NormalizedServerSideGetRowsResult,
	NormalizeServerSideGetRowsResultInput,
	ResolveServerSideRowCountStateInput,
	ServerSideBlockSnapshot,
	ServerSideBlockState,
	ServerSideDatasource,
	ServerSideGetRowsRequest,
	ServerSideGetRowsResult,
	ServerSideGroupMetadata,
	ServerSideRefreshOptions,
	ServerSideRoute,
	ServerSideRowCountState,
	ServerSideRowGroupColumn,
	ServerSideRowModelOptions,
	ServerSideStoreSnapshot,
	ServerSideValueColumn,
} from './serverSideRowModel.js';
export { createServerSideGetRowsRequest, normalizeServerSideGetRowsResult, resolveServerSideRowCountState } from './serverSideRowModel.js';
export { areServerSideRoutesEqual, createServerSideRouteKey, isRootServerSideRoute, normalizeServerSideRoute } from './serverSideRoute.js';
export type { RowModelType } from './state/GridState.js';
export type { GridRowNode, GridRowNodeValidationState, RowNodeSelectionOptions } from './publicRowNode.js';
export type { GridRowDataRef } from './publicRowRef.js';
export type { PersistenceStatus, PersistenceSaveStatus } from './persistence/statePersistence.js';
export { GRID_STATE_SCHEMA_VERSION, validateSchemaVersion } from './persistence/statePersistence.js';

export { GridEventName } from './api/GridEvents.js';
export type { RowDataTransaction } from './api/GridApi.js';
export type { RowNodeTransaction } from './rowTransactions.js';
export type { AutoSizeColumnOptions, AutoSizeAllColumnsOptions } from './api/GridApi.js';
export type { GridEventPayloadMap, GridWriteBlockedEventPayload, GridWriteBlockedSource, GridWriteBlockedStatus } from './api/GridEvents.js';
export type {
	CellEditorProps,
	CellPointer,
	CellRendererProps,
	CellState,
	ColumnState,
	GridApi,
	GridSnapshotKeyListener,
	GridSnapshotListener,
	GridStateSnapshot,
	GridCellAccess,
	GridCellClickParams,
	ActiveEditState,
	GridCellPointer,
	GridCellRange,
	GridCellRangeBounds,
	GridRowsAccessor,
	GridSelectionSource,
	GridSelectionState,
	HeaderMenuRendererProps,
	RowSelectionMode,
	RowSelectionOptions,
	RowSelectionScope,
	SelectRowsOptions,
	SelectAllRowsOptions,
	SelectionChangeResult,
	VisualRowPointer,
} from './api/GridApi.js';
export type { GridEvent, GridEventListener } from './api/GridEvents.js';
export type {
	CellCopyParams,
	CellPasteParams,
	CellRendererCapabilities,
	CellScrollPresentation,
	GridRendererOptions,
	CellRendererPhase,
	ColumnDef,
	ColumnRendererSpec,
	DomCellRenderer,
	DomCellRendererHandle,
	DomAggregateRenderer,
	AggregateRendererParams,
	DomCellRendererParams,
	DomCellRendererRowRef,
	DomCellEditor,
	DomCellEditorHandle,
	DomCellEditorParams,
	ColumnCellEditorSpec,
	ImperativeCellHandle,
	RowStyleRule,
	GroupRowStyleRule,
	DetailRowStyleRule,
	CellStyleRule,
	HeaderCellStyleRule,
	ColorScaleRule,
	DataBarRule,
	IconSetRule,
	ValueScaleRule,
	GridStyleRule,
	ValueGetterParams,
} from './columnDef.js';
export type { GridInitialState } from './state/GridState.js';
export type { GridPresencePeer, GridPresenceCell, GridCellFlash } from './presence.js';
export type { GridMinimapMark } from './minimap.js';
export type {
	GridViewConfig,
	GridViewKind,
	GalleryViewConfig,
	CalendarViewConfig,
	KanbanViewConfig,
	GanttViewConfig,
	ViewAggregate,
	GridWorkspaceOptions,
	GridWorkspaceTab,
	RecordCollaboration,
	RecordComment,
	RecordFile,
	RecordLink,
	RecordPerson,
	RecordCounts,
	RecordActivityEntry,
} from './views.js';
export { isWorkspaceAdapter } from './views.js';
// The record kernel: what fields mean, and the projections every view is built on (usable headless).
export { resolveRecordRoles, RecordReader, parseDependencies, writeDependencies } from './records/recordModel.js';
export type { RecordRolesConfig, RecordRoles, RecordRole, RecordRow, DependencyLink, DependencyType } from './records/recordModel.js';
export { groupRecords, aggregateRecords } from './records/recordGroups.js';
export type { RecordGroup, RecordAggregate, GroupRecordsOptions } from './records/recordGroups.js';
export { buildBoard, planBoardMove } from './records/board.js';
export type { BoardModel, BoardColumn, BoardLane, BoardOptions, BoardMove, BoardMovePlan } from './records/board.js';
export { rankBetween, ranksBetween } from './records/rank.js';
export { ScheduleModel } from './records/schedule/scheduleModel.js';
export type { ScheduleTask, ScheduleChange, DependencyViolation, AutoScheduleOptions, AutoScheduleResult } from './records/schedule/scheduleModel.js';
export { WorkCalendar } from './records/schedule/workCalendar.js';
export type { WorkCalendarConfig } from './records/schedule/workCalendar.js';
export { TimeScale } from './records/schedule/timeScale.js';
export type { TimeZoom, TimeTick } from './records/schedule/timeScale.js';
export { resourceLoad } from './records/schedule/resources.js';
export type { ResourceLoad } from './records/schedule/resources.js';
export type { Day, DaySpan } from './records/days.js';
export type {
	VisualRowModel,
	RowModelViewportAccess,
	InternalRowModelKind,
	RowNodeKind,
	RowLoadState,
	RowRangeLoadState,
	RowCountKind,
	AllDataNodesCapableRowModel,
	FilteredDataNodesCapableRowModel,
	CurrentPageDataNodesCapableRowModel,
	ServerSideControllableRowModel,
} from './rowModel.js';
export type {
	VisualRow,
	DataVisualRow,
	GroupVisualRow,
	DetailVisualRow,
	TotalVisualRow,
	TotalPlacement,
	RowHierarchy,
	LoadingVisualRow,
	FailedVisualRow,
	PlaceholderVisualRow,
} from './visualRow.js';
export type {
	GroupingConfig,
	StickyHeadersOptions,
	GroupInfo,
	TreeDataConfig,
	TreeRowInfo,
	DefaultExpanded,
	TotalsConfig,
	AggregationConfig,
	AggregateContext,
	BuiltInAggFunc,
	DetailConfig,
	ExpansionState,
	HierarchyColumnConfig,
	HierarchyCellContext,
	GroupRenderContext,
	GroupRendererSpec,
	GroupRendererHandle,
	DomGroupRenderer,
	RowRendererSpec,
	DomRowRenderer,
	DomRowRendererHandle,
	RowRendererParams,
} from './rows/hierarchyConfig.js';
export { HIERARCHY_COLUMN_FIELD, isHierarchyColumn, hierarchyColumnGroupColId } from './rows/hierarchyColumn.js';
export type { DescendantSelection, DescendantSelectionState } from './rows/hierarchyIndex.js';
export type { ExpandAllOptions } from './rowModel.js';
export { renderGroupToggle } from './renderer/hierarchyCell.js';

export { isDomCellRenderer, isDomCellEditorSpec } from './columnDef.js';
export {
	areCellPointersEqual,
	areCanonicalCellPointersEqual,
	doesCanonicalCellPointerMatchColumn,
	doesCellPointerMatchColumn,
	getCellPointerColumnKey,
} from './interaction/cellPointer.js';
export type {
	FilterModel,
	QuickFilterModel,
	ColumnFilter,
	FilterCondition,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SelectFilterCondition,
	CompoundFilterCondition,
	TextFilterOperator,
	NumberFilterOperator,
	DateFilterOperator,
	GroupDef,
	SortModel,
} from './rowModel.js';
export type {
	ColumnFilterDef,
	ColumnFilterType,
	FilterSurface,
	DomFilterEditor,
	DomFilterEditorParams,
	DomFilterEditorHandle,
} from './filters/filterDef.js';
export type { BooleanFilterCondition, DateRangeFilterCondition, PathFilterCondition, CustomFilterCondition } from './filterModel.js';
export { resolveColumnFilterDef } from './filters/filterDef.js';
export type { AggregationDef } from './rowModel.js';
export type { OpOption } from './filterOperations.js';
export {
	TEXT_OPS,
	NUMBER_OPS,
	DATE_OPS,
	DATE_RANGE_OPS,
	getOpsForType,
	getOpMeta,
	defaultOpForType,
	isFilterableColumn,
	applyFilterToModel,
	buildFilterByValue,
	summarizeFilter,
	restoreFilterModel,
} from './filterOperations.js';
export type { CsvExportOptions } from './export/csvExport.js';
export type { ExcelExportOptions } from './export/xlsxExport.js';
export type { GridContextMenuItem, GridContextMenuOptions } from './contextMenu.js';
export type { GridCellWrite, GridTransaction, GridTransactionOptions, GridTransactionResult } from './api/GridApi.js';
export type {
	GridIntegrityApi,
	GridCommitResult,
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
} from './integrity.js';
export { required, email, min, max, number, date, oneOf, regex, customCellRule } from './integrity.js';
export { duplicateValueRule, missingRequiredRule } from './integrity.js';
export type { TooltipParams, ValueFormatterParams } from './columnDef.js';
export { registerGridContextMenu, type GridContextMenuHandle } from './gridPlugins.js';
export type { GridNavigationOptions } from './interaction/GridInteractionController.js';

export {
	LIGHT_THEME,
	DARK_THEME,
	GLASS_DARK_THEME,
	GLASS_LIGHT_THEME,
	BUILT_IN_THEMES,
	BUILT_IN_THEME_ORDER,
	BUILT_IN_THEME_METADATA,
	BUILT_IN_THEME_FONTS_URL,
	createTheme,
	ThemeManager,
	getBuiltInTheme,
	isBuiltInThemeName,
	themeToCSSVariables,
} from './renderer/themes.js';
export type { ThemeTokens, ThemePalette, GlassThemeOptions, BuiltInThemeName } from './renderer/themes.js';
export type { RowAnimationOptions } from './renderer/rowAnimation.js';
export type { GridDomainVersions } from './state/GridDomainVersions.js';
export type { GridInstrumentation, GridInstrumentationSnapshot, FrameMetrics, FallbackMetric } from './diagnostics/GridInstrumentation.js';
export { GridMetric } from './diagnostics/GridInstrumentation.js';

// ── Insight Layer ─────────────────────────────────────────────────────────────
export type { GridInsightLayer, GridInsightLayerId, GridInsightSeverity, GridCellDecoration, GridRowDecoration } from './insights/insightTypes.js';
export { GridInsightRegistry } from './insights/GridInsightRegistry.js';

// ── Built-in cell types ───────────────────────────────────────────────────────
export * from './cells/index.js';

// ── Filter editors (every filter surface mounts these) ───────────────────────
export { createFilterEditor } from './filters/filterEditors.js';
export type { AdapterFilterMount } from './filters/filterEditors.js';
export type {
	AdapterPanelMount,
	BuiltinSidebarPanelId,
	GridSidebarConfig,
	SidebarPanel,
	SidebarFilterEditorOptions,
	SidebarPanelContext,
	SidebarPanelDef,
	SidebarPanelHandle,
} from './sidebar/sidebarTypes.js';
export { sidebarIconSvg, type SidebarIconName } from './sidebar/sidebarIcons.js';
// ── Charts ───────────────────────────────────────────────────────────────────
export { createGridChart, type GridChartHandle } from './charts/gridChart.js';
export type { ChartAggregate, ChartData, ChartSeries, ChartSource, ChartSpec, ChartType } from './charts/chartTypes.js';
