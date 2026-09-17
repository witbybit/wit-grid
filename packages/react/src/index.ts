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
export { useGridApi, useGridSelector, useGridKeySelector } from './hooks.js';
export type { BuiltinSidebarPanelId, GridSidebarConfig, SidebarPanelDef } from './sidebar/GridSidebar.js';
export {
	BUILT_IN_THEMES,
	BUILT_IN_THEME_ORDER,
	BUILT_IN_THEME_METADATA,
	getBuiltInTheme,
	isBuiltInThemeName,
	themeToCSSVariables,
} from '@eregister/open-grid-core';

// ─── Built-in cell renderers & editors ───────────────────────────────────────
export {
	// Checkbox
	CheckboxCellRenderer,
	// Multi-select
	MultiSelectCellRenderer,
	createMultiSelectCellRenderer,
	createMultiSelectCellEditor,
	// Date
	DateCellRenderer,
	DateCellEditor,
	// Dropdown / enum badge
	createDropdownCellRenderer,
	createDropdownCellEditor,
	// Number
	createNumberCellRenderer,
	createNumberCellEditor,
	// Utilities
	parseMultiValue,
	TagsCellRenderer,
	// Column type registry
	BUILTIN_COLUMN_TYPES,
	// Column type helpers
	numberColumnType,
	multiSelectColumnType,
	dropdownColumnType,
} from './renderers/CellTypes.js';
export type {
	DropdownOption,
	DropdownOptionColor,
	NumberCellRendererOptions,
	NumberCellEditorOptions,
	ColumnTypeDefinition,
} from './renderers/CellTypes.js';

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
} from '@eregister/open-grid-core';
export { resolveColumnFilterDef } from '@eregister/open-grid-core';

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
	FooterVisualRow,
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
} from '@eregister/open-grid-core';
export { normalizeCapabilityResult, CAPABILITY_ALLOWED } from '@eregister/open-grid-core';

export type {
	GridContextMenuOptions,
	GridContextMenuItem,
	GridCellPointer,
	HeaderMenuRendererProps,
	TooltipParams,
	AutoSizeColumnOptions,
	AutoSizeAllColumnsOptions,
	FloatingFilterRendererParams,
} from '@eregister/open-grid-core';

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
} from '@eregister/open-grid-core';
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
} from '@eregister/open-grid-core';
