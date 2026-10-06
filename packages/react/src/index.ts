export { Grid } from './Grid.js';
export type { GridProps, GridClientProps, GridInfiniteProps, GridServerSideProps, GridPaginationConfig } from './Grid.js';
export type {
	RowModelType,
	InfiniteDatasource,
	ServerSideDatasource,
	ServerSideGetRowsRequest,
	ServerSideGetRowsResult,
	ServerSideStoreSnapshot,
} from './types.js';
export { GroupToggle, GroupCount } from './GroupParts.js';
export { useGridApi, useGridSelector, useGridKeySelector } from './hooks.js';
export type { BuiltinSidebarPanelId, GridSidebarConfig, SidebarPanelDef } from './sidebar/GridSidebar.js';
export {
	BUILT_IN_THEMES,
	BUILT_IN_THEME_ORDER,
	BUILT_IN_THEME_METADATA,
	getBuiltInTheme,
	isBuiltInThemeName,
	themeToCSSVariables,
} from '@eregister/wit-grid-core';

// ─── Built-in cell types (core, DOM-based) ───────────────────────────────────
export {
	BUILTIN_COLUMN_TYPES,
	CELL_HUES,
	checkboxColumnType,
	numberColumnType,
	currencyColumnType,
	percentColumnType,
	dateColumnType,
	dateTimeColumnType,
	selectColumnType,
	comboboxColumnType,
	multiSelectColumnType,
	tagsColumnType,
	ratingColumnType,
	progressColumnType,
	urlColumnType,
	emailColumnType,
	personColumnType,
	createCheckboxRenderer,
	createNumberRenderer,
	createDateRenderer,
	createSelectRenderer,
	createMultiSelectRenderer,
	createNumberEditor,
	createDateEditor,
	createSelectEditor,
	createMultiSelectEditor,
	parseMultiValue,
} from '@eregister/wit-grid-core';
export type {
	CellOption,
	CellOptionInput,
	ColumnTypeDefinition,
	CellColor,
	NumberCellOptions,
	DateCellOptions,
	SelectEditorOptions,
	SelectRendererOptions,
	MultiSelectRendererOptions,
	RatingCellOptions,
	ProgressCellOptions,
	PersonOption,
	PersonCellOptions,
	DomCellEditor,
	DomCellEditorParams,
} from '@eregister/wit-grid-core';

// ─── Advanced filter API ──────────────────────────────────────────────────────
export type {
	ColumnFilterDef,
	ColumnFilterType,
	FilterSelectOption,
	FilterFetchParams,
	FilterFetchResult,
	FilterPageParams,
	FilterPageResult,
	CustomFilterRendererParams,
	FilterSurface,
	SelectFilterCondition,
} from '@eregister/wit-grid-core';
export type { GroupRenderContext, GroupRendererSpec, GroupRendererHandle, DomGroupRenderer } from '@eregister/wit-grid-core';
export type { RowAnimationOptions, StickyHeadersOptions } from '@eregister/wit-grid-core';
export { resolveColumnFilterDef } from '@eregister/wit-grid-core';

export { isDomCellRenderer, createLocalStorageAdapter, GridEventName } from './types.js';
export type { GridEventPayloadMap, GridPersistenceAdapter, PersistedGridState, PersistenceStatus, PersistenceSaveStatus } from './types.js';
export type { GridWriteBlockedEventPayload } from './types.js';
export type { GridWorkspaceAdapter, GridViewDefinition, GridWorkspaceState, SaveViewOptions } from './types.js';
export { createLocalStorageWorkspaceAdapter } from './types.js';
export type { StyleRule, RowStyleRule, GroupRowStyleRule, DetailRowStyleRule, CellStyleRule, HeaderCellStyleRule } from './types.js';
export type {
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
	FilterModel,
	QuickFilterModel,
	SortModel,
	GridApi,
	GridCellClickParams,
	GridStateSnapshot,
	VisualRow,
	DataVisualRow,
	GroupVisualRow,
	DetailVisualRow,
	TotalVisualRow,
	LoadingVisualRow,
	FailedVisualRow,
	PlaceholderVisualRow,
	GroupDef,
	AggregationDef,
	CsvExportOptions,
	CellRendererCapabilities,
	CellRendererPhase,
	DomCellRenderer,
	DomCellRendererHandle,
	DomCellRendererParams,
	DomCellRendererRowRef,
	GridRowDataRef,
	ImperativeCellHandle,
	GridReadyEvent,
	GridInitialState,
	BuiltInThemeName,
	ThemeTokens,
	RowSelectionMode,
	RowSelectionOptions,
	RowSelectionScope,
	SelectRowsOptions,
	SelectAllRowsOptions,
} from './types.js';

export type {
	GridCapabilityAction,
	GridCapabilityParams,
	GridCapabilityResult,
	GridCapabilityCallback,
	GridCapabilitiesConfig,
	CapabilityDiagnostics,
} from '@eregister/wit-grid-core';
export { normalizeCapabilityResult, CAPABILITY_ALLOWED } from '@eregister/wit-grid-core';

export type {
	GridContextMenuOptions,
	GridContextMenuItem,
	GridCellPointer,
	HeaderMenuRendererProps,
	TooltipParams,
	AutoSizeColumnOptions,
	AutoSizeAllColumnsOptions,
	FloatingFilterRendererParams,
} from '@eregister/wit-grid-core';

// ── Data Integrity Pipeline types ─────────────────────────────────────────────
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
	GridDiffModel,
	GridCellDiff,
	GridDiffResult,
	GridDiffAcceptResult,
	GridCellConflict,
	ResolveConflictOptions,
	ConflictResolutionResult,
	ServerIntegrityReport,
	GridTransactionStreamHandle,
	GridTransactionStreamState,
} from '@eregister/wit-grid-core';
export {
	duplicateValueRule,
	missingRequiredRule,
	required,
	email,
	min,
	max,
	number,
	date,
	oneOf,
	regex,
	customCellRule,
} from '@eregister/wit-grid-core';
