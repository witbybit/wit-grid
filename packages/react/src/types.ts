import type {
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
	FilterModel,
	QuickFilterModel,
	SortModel,
	GridApi,
	GridCellClickParams,
	GridWriteBlockedEventPayload,
	GridInitialState,
	GridStateSnapshot,
	ColumnFilter,
	FilterCondition,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
	CompoundFilterCondition,
	TextFilterOperator,
	NumberFilterOperator,
	DateFilterOperator,
	VisualRow,
	DataVisualRow,
	GroupVisualRow,
	DetailVisualRow,
	FooterVisualRow,
	LoadingVisualRow,
	FailedVisualRow,
	PlaceholderVisualRow,
	HeaderMenuRendererProps,
	CellRendererCapabilities,
	CellScrollPresentation,
	GridRendererOptions,
	CellRendererPhase,
	DomCellRenderer,
	DomCellRendererHandle,
	DomCellRendererParams,
	DomCellRendererRowRef,
	GridRowDataRef,
	ImperativeCellHandle,
	GridPersistenceAdapter,
	BuiltInThemeName,
	ThemeTokens,
	GridStyleRule,
	RowStyleRule,
	GroupRowStyleRule,
	DetailRowStyleRule,
	CellStyleRule,
	HeaderCellStyleRule,
	RowSelectionMode,
	RowSelectionOptions,
	RowSelectionScope,
	SelectRowsOptions,
	SelectAllRowsOptions,
	RowModelType,
	InfiniteDatasource,
	ServerSideDatasource,
	ServerSideGetRowsRequest,
	ServerSideGetRowsResult,
	ServerSideStoreSnapshot,
} from '@eregister/wit-grid-core';
import type { ColumnTypeDefinition } from './renderers/CellTypes.js';
export { isDomCellRenderer, createLocalStorageAdapter, GridEventName } from '@eregister/wit-grid-core';
export type { ColumnTypeDefinition } from './renderers/CellTypes.js';
export type { RowStyleRule, GroupRowStyleRule, DetailRowStyleRule, CellStyleRule, HeaderCellStyleRule } from '@eregister/wit-grid-core';
export type {
	GroupDef,
	AggregationDef,
	CsvExportOptions,
	GridEventPayloadMap,
	GridPersistenceAdapter,
	PersistedGridState,
	PersistenceStatus,
	PersistenceSaveStatus,
	GridWorkspaceAdapter,
	GridViewDefinition,
	GridWorkspaceState,
	SaveViewOptions,
} from '@eregister/wit-grid-core';
export { createLocalStorageWorkspaceAdapter } from '@eregister/wit-grid-core';

export type {
	ColumnDef,
	CellEditorProps,
	CellRendererProps,
	FilterModel,
	QuickFilterModel,
	ColumnFilter,
	FilterCondition,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
	CompoundFilterCondition,
	TextFilterOperator,
	NumberFilterOperator,
	DateFilterOperator,
	SortModel,
	GridApi,
	GridCellClickParams,
	GridWriteBlockedEventPayload,
	GridInitialState,
	GridStateSnapshot,
	VisualRow,
	DataVisualRow,
	GroupVisualRow,
	DetailVisualRow,
	FooterVisualRow,
	LoadingVisualRow,
	FailedVisualRow,
	PlaceholderVisualRow,
	HeaderMenuRendererProps,
	CellRendererCapabilities,
	CellScrollPresentation,
	GridRendererOptions,
	CellRendererPhase,
	DomCellRenderer,
	DomCellRendererHandle,
	DomCellRendererParams,
	DomCellRendererRowRef,
	GridRowDataRef,
	ImperativeCellHandle,
	BuiltInThemeName,
	ThemeTokens,
	RowSelectionMode,
	RowSelectionOptions,
	RowSelectionScope,
	SelectRowsOptions,
	SelectAllRowsOptions,
};

export type StyleRule<TRowData = unknown> = GridStyleRule<TRowData>;

export type { RowModelType, InfiniteDatasource, ServerSideDatasource, ServerSideGetRowsRequest, ServerSideGetRowsResult, ServerSideStoreSnapshot };

export type {
	GridQueryModel,
	GridQueryGroup,
	GridQueryCondition,
	GridQueryNode,
	QueryDiagnostics,
	QueryConditionDiagnostic,
	QueryEvaluationContext,
	QueryOperatorDefinition,
	GridDistinctValueSummary,
} from '@eregister/wit-grid-core';
export { createEmptyQueryModel, isQueryModelActive, countQueryNodes, getQueryOperator, getQueryOperatorsForType } from '@eregister/wit-grid-core';

export type {
	GridCapabilityAction,
	GridCapabilityParams,
	GridCapabilityResult,
	GridCapabilityCallback,
	GridCapabilitiesConfig,
	CapabilityDiagnostics,
} from '@eregister/wit-grid-core';
export { normalizeCapabilityResult, CAPABILITY_ALLOWED } from '@eregister/wit-grid-core';

/**
 * Fields from GridInitialState that can be configured as top-level props on the public
 * Grid component. Sourced from the canonical GridInitialState type so these never drift
 * out of sync with the core.
 */
type GridRenderOptions<TRowData> = Pick<
	GridInitialState<TRowData>,
	'rowOverscanPx' | 'colBuffer' | 'overscanAdaptive' | 'runtimeLimits' | 'rendererOptions'
>;

export interface GridReadyEvent<TRowData = unknown> {
	api: GridApi<TRowData>;
	rowModelType: RowModelType;
}
