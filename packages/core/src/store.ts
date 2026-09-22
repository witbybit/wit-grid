import type {
	FilterModel,
	QuickFilterModel,
	SortModel,
	RowModel,
	ClientStructuralRowModel,
	InfiniteControllableRowModel,
	ServerSideControllableRowModel,
	RowExpansionStateReadableModel,
	RowModelCapability,
	RowModelCapabilities,
	RowLoadState,
} from './rowModel.js';
import type { GridQueryModel } from './query/GridQueryModel.js';
import { evaluateQueryModel, createQueryEvaluationContext } from './query/evaluateQueryModel.js';
import {
	asClientStructuralRowModel,
	asRowExpansionStateReadableModel,
	asInfiniteControllableRowModel,
	asServerSideControllableRowModel,
	asCapableRowModel,
	UnsupportedRowModelOperationError,
} from './rowModel.js';
import type { GridDomainVersions } from './state/GridDomainVersions.js';
export type { RowModel, RowRefreshReason, RowModelRefreshResult } from './rowModel.js';
import type { InfiniteDatasource } from './infiniteRowModel.js';
import type { ServerSideDatasource, ServerSideRefreshOptions, ServerSideStoreSnapshot } from './serverSideRowModel.js';
import { ViewportController, type ViewportRange } from './viewportController.js';
import { GridEngine } from './engine/GridEngine.js';
import type { ClientRowModelRuntime, InfiniteRowModelRuntime, ServerSideRowModelRuntime } from './engine/runtimePorts.js';
import { createClientRowModelRuntime, createInfiniteRowModelRuntime, createServerSideRowModelRuntime } from './engine/createRowModelRuntimes.js';
import type { GridRuntimePorts, RuntimePortBinding, RuntimePortBindResult } from './engine/rendererPorts.js';
import { HEADLESS_PORTS } from './engine/rendererPorts.js';
import { type GridInstrumentation, NOOP_INSTRUMENTATION } from './diagnostics/GridInstrumentation.js';
import type { RenderStats } from './renderer/renderOrchestrator.js';
import type { GridRowNode } from './publicRowNode.js';
import type { AggregationDef } from './rows/stages/aggregateStage.js';
import { exportToCsv, type CsvExportOptions } from './export/csvExport.js';
import type { PersistenceStatus, PersistedGridState } from './persistence/statePersistence.js';
import type { GridViewDefinition, GridWorkspaceState, SaveViewOptions } from './workspace/workspaceTypes.js';
import { extractPersistedState, preparePersistedGridStateRestore, areRowHeightsEqual } from './persistence/statePersistence.js';
import { BUILT_IN_THEME_ORDER, getBuiltInTheme, isBuiltInThemeName, type BuiltInThemeName, type ThemeTokens } from './renderer/themes.js';

// ── Focused sub-modules — re-export so callers of store.ts continue to work ──
export { RowNode } from './rowNode.js';
export type { GridInsightLayer, GridInsightLayerId, GridInsightSeverity, GridCellDecoration, GridRowDecoration } from './insights/insightTypes.js';
export { GridInsightRegistry } from './insights/GridInsightRegistry.js';

export { isDomCellRenderer, getValueByPath, setValueByPath, compilePathGetter, validateColumns } from './columnDef.js';
export { compileStyleRules } from './styling/styleRules.js';
export type {
	CellCopyParams,
	CellPasteParams,
	ValueGetterParams,
	ValueSetterParams,
	CellRendererPhase,
	CellRendererCapabilities,
	ImperativeCellHandle,
	DomCellRendererParams,
	DomCellRendererHandle,
	DomCellRenderer,
	ColumnRendererSpec,
	ColumnRenderMode,
	ColumnRenderPlan,
	CompiledGridPlan,
	ColumnDef,
	InternalColumnDef,
	GridRowClassParams,
	GridCellClassParams,
	RowStyleRule,
	GroupRowStyleRule,
	DetailRowStyleRule,
	CellStyleRule,
	HeaderCellStyleRule,
	GridStyleRule,
} from './columnDef.js';
export type { FloatingFilterRendererParams } from './renderer/floatingFilterRenderer.js';

export {
	isDataVisualRow,
	isFullWidthVisualRow,
	isSelectableVisualRow,
	isEditableVisualRow,
	canEditCell,
	canFocusVisualRow,
	isDataCellSelectable,
} from './visualRow.js';
export type { DataVisualRow, GroupVisualRow, DetailVisualRow, FooterVisualRow, LoadingVisualRow, VisualRow } from './visualRow.js';

export type { PersistenceStatus };
export type { PersistedGridState as SerializableGridState } from './persistence/statePersistence.js';

// ── Extracted modules — re-export for backward compat ────────────────────────
export * from './api/GridApi.js';
export * from './api/GridEvents.js';
export type { GridInitialState, ColumnState, GridCellRangeBounds } from './state/GridState.js';
// ── Internal imports (for use by definitions in this file) ───────────────────
import { RowNode } from './rowNode.js';
import type { ColumnDef, ColumnInstanceId, GridStyleRule } from './columnDef.js';
import { validateColumns } from './columnDef.js';
import type { VisualRow } from './visualRow.js';
import type {
	CellSubscription,
	ActiveEditState,
	GridCellPointer,
	GridSelectionSource,
	GridCellAccess,
	CellState,
	GridPlugin,
	GridPluginController,
	GridPluginRuntime,
	GridRowsAccessor,
	GridWriteResult,
	RowDataTransaction,
	RowNodeTransaction,
	GridTransaction,
	RowSelectionGesture,
	RowSelectionChangeResult,
	SelectRowsOptions,
	SelectAllRowsOptions,
	InternalGridApi,
	GridApi,
	ScrollToCellOptions,
	ScrollToRowOptions,
	GridSnapshotKeyListener,
	GridSnapshotSelector,
	GridSnapshotSelectorEquality,
	GridSnapshotListener,
	GridStateSnapshot,
} from './api/GridApi.js';
import { createGridStateSnapshot } from './api/createGridStateSnapshot.js';
import type { InternalGridState, GridInitialState, ColumnState, RowModelType } from './state/GridState.js';
import type { GridEventPayloadMap, GridEventListener } from './api/GridEvents.js';
import { GridEventName } from './api/GridEvents.js';
import { GridPluginRegistry } from './plugins/GridPluginRegistry.js';
import { createGridPluginRuntime } from './plugins/createGridPluginRuntime.js';
import type { AutoSizeColumnOptions, AutoSizeAllColumnsOptions } from './features/ColumnAutoSizeController.js';
import { makeNoopIntegrityApi } from './features/dataIntegrity/noopIntegrityApi.js';
import { createGridStoreSubscriptions, type GridStoreSubscriptionsFacade } from './store/GridStoreSubscriptions.js';
import { createGridStoreHostFacade, type GridStoreHostFacade } from './store/GridStoreHostFacade.js';
import { createGridStoreRowFacade, type GridStoreRowFacade } from './store/GridStoreRowFacade.js';
import { GridInteractionController } from './interaction/GridInteractionController.js';
import { doesCanonicalCellPointerMatchColumn } from './interaction/cellPointer.js';
import { readInteractionState } from './interaction/interactionState.js';

export { validateRowIds } from './ids.js';

// prettier-ignore
const _FALLBACK_CAPS: Record<RowModelType, RowModelCapabilities> = {
	infinite: { fullDataset: false, loadedDataset: true, pagedDataset: false, clientMutation: false, loadedRowMutation: true, pageRowMutation: false, transactions: false, rowOrder: false, blockLoading: true, serverPagination: false, clientSort: false, clientFilter: false, serverSort: true, serverFilter: true, clientGrouping: false, clientTree: false, aggregation: false, masterDetail: false, allRowSelection: false, loadedRowSelection: true, pageRowSelection: false },
	server:   { fullDataset: false, loadedDataset: true, pagedDataset: false, clientMutation: false, loadedRowMutation: true, pageRowMutation: false, transactions: false, rowOrder: false, blockLoading: true, serverPagination: false, clientSort: false, clientFilter: false, serverSort: true, serverFilter: true, clientGrouping: false, clientTree: false, aggregation: false, masterDetail: false, allRowSelection: false, loadedRowSelection: true, pageRowSelection: false },
	client:   { fullDataset: true, loadedDataset: false, pagedDataset: false, clientMutation: true, loadedRowMutation: false, pageRowMutation: false, transactions: true, rowOrder: true, blockLoading: false, serverPagination: false, clientSort: true, clientFilter: true, serverSort: false, serverFilter: false, clientGrouping: true, clientTree: true, aggregation: true, masterDetail: true, allRowSelection: true, loadedRowSelection: false, pageRowSelection: false },
};

const _EMPTY_WS_STATE: GridWorkspaceState = {
	views: [],
	activeViewId: null,
	defaultViewId: null,
	autoSaveEnabled: true,
	dirty: false,
	lastSavedAt: null,
	lastError: null,
	loading: false,
};

/**
 * Internal runtime composition root.
 *
 * This class is used by core implementation wiring and test fixtures.
 * The supported external surface is the frozen GridApi returned by createGrid().
 */
export class GridStore<TRowData = unknown> implements InternalGridApi<TRowData> {
	public engine: GridEngine<TRowData>;
	public readonly interactionController: GridInteractionController<TRowData>;

	private readonly viewportController: ViewportController<TRowData>;
	private readonly pluginRuntime: GridPluginRuntime<TRowData>;
	private readonly pluginRegistry: GridPluginRegistry<TRowData>;

	private containerElement: HTMLElement | null = null;
	private rendererPorts: GridRuntimePorts = HEADLESS_PORTS;
	private instrumentation: GridInstrumentation = NOOP_INSTRUMENTATION;
	private portBindingGeneration = 0;
	private activeBindingGeneration: number | null = null;
	private storeDestroyed = false;
	private cachedStateSnapshotState: InternalGridState<TRowData> | null = null;
	private cachedStateSnapshot: GridStateSnapshot<TRowData> | null = null;
	private readonly subscriptionsFacade: GridStoreSubscriptionsFacade<TRowData>;
	private readonly hostFacade: GridStoreHostFacade;
	private readonly rowFacade: GridStoreRowFacade<TRowData>;

	constructor(
		initialState: Partial<GridInitialState<TRowData>> = {},
		engineOptions?: {
			capabilities?: import('./capabilities/capabilityTypes.js').GridCapabilitiesConfig<TRowData>;
			dataIntegrity?: import('./features/dataIntegrity/integrityTypes.js').GridDataIntegrityConfig<TRowData>;
		}
	) {
		validateColumns(initialState.columns || []);
		this.engine = new GridEngine<TRowData>({
			capabilities: engineOptions?.capabilities,
			dataIntegrity: engineOptions?.dataIntegrity,
			columns: initialState.columns || [],
			selection: initialState.selection,
			selectedRowIds: initialState.selectedRowIds ?? [],
			rowSelection: initialState.rowSelection,
			rowHeights: initialState.rowHeights || {},
			columnWidths: initialState.columnWidths || {},
			defaultRowHeight: initialState.defaultRowHeight || 40,
			defaultColWidth: initialState.defaultColWidth || 100,
			enableColumnReorder: initialState.enableColumnReorder ?? true,
			activeEdit: initialState.activeEdit || null,
			sortModel: initialState.sortModel || null,
			filterModel: initialState.filterModel || null,
			quickFilterModel: initialState.quickFilterModel || null,
			queryModel: initialState.queryModel || null,
			getRowId: initialState.getRowId,
			loading: initialState.loading,
			loadingSkeletonCount: initialState.loadingSkeletonCount,
			styleRules: initialState.styleRules,
			groupBy: initialState.groupBy,
			getParentId: initialState.getParentId,
			masterDetailEnabled: initialState.masterDetailEnabled,
			groupRowHeight: initialState.groupRowHeight,
			detailRowHeight: initialState.detailRowHeight,
			detailRenderer: initialState.detailRenderer,
			rowModelConfig: initialState.rowModelConfig,
			showGroupFooter: initialState.showGroupFooter,
			enableStickyGroupRows: initialState.enableStickyGroupRows,
			showGroupPanel: initialState.showGroupPanel,
			showFilterChipBar: initialState.showFilterChipBar,
			showFloatingFilters: initialState.showFloatingFilters,
			showStatusBar: initialState.showStatusBar,
			pagination: initialState.pagination,
			expansion: initialState.expansion,
			themeName: initialState.themeName,
			themeOverrides: initialState.themeOverrides,
			rowOverscanPx: initialState.rowOverscanPx ?? 400,
			colBuffer: initialState.colBuffer ?? 2,
			rendererOptions: initialState.rendererOptions,
			// Always normalize runtimeLimits so all callers can assume it exists.
			runtimeLimits: {
				maxRenderedRows: 500,
				maxRenderedCells: 20_000,
				suppressRenderedRangeLimit: false,
				maxFilterDistinctValues: 500,
				maxWarmCustomRenderers: 300,
				...initialState.runtimeLimits,
			},
			overscanAdaptive: initialState.overscanAdaptive,
			getContainerElement: () => this.containerElement,
		});
		this.viewportController = new ViewportController<TRowData>(this.engine);
		this.pluginRuntime = createGridPluginRuntime(this as unknown as GridPluginRuntime<TRowData>);
		this.pluginRegistry = new GridPluginRegistry<TRowData>(this.pluginRuntime, this.engine.runtimeFaults);
		this.interactionController = new GridInteractionController<TRowData>(
			this as unknown as GridPluginRuntime<TRowData>,
			{},
			{
				selectCell: (pointer, source) => this.engine.selectCell(pointer, source),
				selectRange: (start, end, source) => this.engine.selectRange(start, end, source),
				applyRowSelectionGesture: (gesture) => this.engine.applyRowSelectionGesture(gesture),
				selectRows: (rowIds, options) =>
					options?.mode === 'replace' ? this.engine.replaceRowIds(rowIds, 'api') : this.engine.selectRowIds(rowIds, 'api'),
				deselectRows: (rowIds) => this.engine.deselectRowIds(rowIds, 'api'),
				copySelectedRange: () => this.engine.copySelectedRange(),
				pasteFromClipboard: () => this.engine.pasteFromClipboard(),
				scrollToCell: (rowId, colField) => this.hostFacade.scrollCellIntoView(rowId, colField),
				scrollToRow: (rowId) => this.hostFacade.scrollRowIntoView(rowId),
				startEditing: (rowId, colFieldOrInstanceId, source) => this.engine.startEdit(rowId, colFieldOrInstanceId, source),
				updateEditDraft: (rowId, colFieldOrInstanceId, value) => this.engine.updateEditDraft(rowId, colFieldOrInstanceId, value),
				stopEditing: (cancel) => this.engine.stopEdit(cancel),
				commitEdit: (rowId, colFieldOrInstanceId, value) => this.engine.commitEdit(rowId, colFieldOrInstanceId, value),
				setCellValue: (rowId, colField, value) => {
					this.engine.setCellValue(rowId, colField, value);
				},
			}
		);
		this.rowFacade = createGridStoreRowFacade<TRowData>({
			getRowModel: () => this.engine.getRowModel(),
			getRowId: (data) => this.engine.getRowId(data),
			getCellValue: (rowId, colField) => this.getCellValue(rowId, colField),
			getSelectedRowIds: () => this.getSelectedRowIds(),
			isRowNodeSelected: (rowId) => this.isRowNodeSelected(rowId),
			isGroupExpanded: (groupId) => this.isGroupExpanded(groupId),
			isDetailExpanded: (rowId) => this.isDetailExpanded(rowId),
			selectRows: (rowIds, options) => this.selectRows(rowIds, options),
			deselectRows: (rowIds) => this.deselectRows(rowIds),
			scrollToRow: (rowId, options) => this.scrollToRow(rowId, options),
			setCellValue: (rowId, colField, value) => this.setCellValue(rowId, colField, value),
			batchCellValues: (updates, source) => this.engine.batchCellValues(updates, source),
			toggleGroupExpanded: (groupId) => this.toggleGroupExpanded(groupId),
			toggleDetailExpanded: (rowId) => this.toggleDetailExpanded(rowId),
			refreshRows: () => this.refreshRows(),
			retryRowLoad: (rowIndex, loadState) => {
				if (loadState.kind !== 'failed') return { status: 'rejected', reason: 'Row retry is only available for failed rows.' };
				if (rowIndex == null || rowIndex < 0) return { status: 'rejected', reason: 'Row retry requires a visible failed row index.' };
				const rowModel = this.engine.getRowModel();
				if (!rowModel) return { status: 'rejected', reason: 'row model unavailable' };
				rowModel.ensureRange(rowIndex, rowIndex, 'row-node-retry-load');
				return { status: 'applied', changeId: Date.now(), faults: [] };
			},
			getRowIssues: (rowId) => this.integrity.getRowIssues(rowId),
			validateRow: (rowId) => this.integrity.validateRow(rowId),
			getRowModelType: () => this.getRowModelType(),
			getState: () => this.state,
		});
		this.subscriptionsFacade = createGridStoreSubscriptions<TRowData>({
			subscribe: (listener) => this.engine.subscribe(listener),
			subscribeToKey: (key, listener) => this.engine.subscribeToKey(key, listener),
			subscribeToSelector: (keys, selector, listener, isEqual) => this.engine.subscribeToSelector(keys, selector, listener, isEqual),
			subscribeDomain: (domain, listener) => this.engine.subscribeDomain(domain, listener),
			getState: () => this.state,
			getStateSnapshot: () => this.getStateSnapshot(),
			getVisualIndexByRowId: (rowId) => this.getVisualIndexByRowId(rowId),
			getVisualRow: (index) => this.getVisualRow(index),
			registerCellSubscription: (sub) => this.registerCellSubscription(sub),
			unregisterCellSubscription: (sub) => this.unregisterCellSubscription(sub),
			subscribeToRowChanges: (rowId, listener) => this.engine.subscribeToRow(rowId, listener),
			rowVersions: this.engine.rowVersions,
		});
		this.hostFacade = createGridStoreHostFacade({
			isDestroyed: () => this.storeDestroyed,
			getActiveBindingGeneration: () => this.activeBindingGeneration,
			setActiveBindingGeneration: (generation) => {
				this.activeBindingGeneration = generation;
			},
			nextBindingGeneration: () => {
				this.portBindingGeneration++;
				return this.portBindingGeneration;
			},
			setRuntimePortsState: (ports) => {
				this.rendererPorts = ports;
			},
			getRuntimePortsState: () => this.rendererPorts,
			getFallbackRendererPorts: () => HEADLESS_PORTS,
			setInstrumentationState: (inst) => {
				this.instrumentation = inst;
			},
			getInstrumentationState: () => this.instrumentation,
			setContainerElementState: (container) => {
				this.containerElement = container;
			},
			getStateThemeName: () => this.state.themeName,
			isBuiltInThemeName,
			getBuiltInThemeOrder: () => BUILT_IN_THEME_ORDER,
			setThemeName: (themeName) => this.engine.setThemeName(themeName),
			getCompiledPlanVersion: () => this.engine.getCompiledPlanVersion(),
			reportRuntimeFault: (fault) => this.engine.runtimeFaults.report(fault),
			getRuntimeFaults: () => this.engine.runtimeFaults.snapshot(),
			clearRuntimeFaults: () => this.engine.runtimeFaults.clear(),
			setEngineInstrumentation: (inst) => this.engine.setInstrumentation(inst),
			getInsightDiagnostics: () => this.engine.insights.getDiagnostics(),
		});

		// Wire up the lazy api ref so integrity modules can call GridApi methods in rules
		this.engine.setApiRef(this as unknown as import('./api/GridApi.js').GridApi<TRowData>);
		this.integrity = this.engine.dataIntegrity?.buildApi() ?? makeNoopIntegrityApi<TRowData>();

		// Apply persisted pin counts at construction time before any renders occur
		if (initialState.pinnedColumns) {
			this.viewportController.pinLeftColumns = initialState.pinnedColumns.left ?? 0;
			this.viewportController.pinRightColumns = initialState.pinnedColumns.right ?? 0;
		}

		// Notify plugins of viewport shifts
		this.engine.subscribeToKey('visibleRowRange', () => {
			const range = this.state.visibleRowRange;
			this.pluginRegistry.notifyViewportChange(range);
		});
	}

	private get state(): InternalGridState<TRowData> {
		return this.engine.getState();
	}

	public getPluginController = (): GridPluginController<TRowData> => this.pluginRegistry;
	public getState = (): InternalGridState<TRowData> => this.engine.getState();

	public getStateSnapshot = (): GridStateSnapshot<TRowData> => {
		const currentState = this.state;
		if (this.cachedStateSnapshotState === currentState && this.cachedStateSnapshot) {
			return this.cachedStateSnapshot;
		}
		const snapshot = createGridStateSnapshot(currentState);
		this.cachedStateSnapshotState = currentState;
		this.cachedStateSnapshot = snapshot;
		return snapshot;
	};

	public getRowId = (row: TRowData): string => this.engine.getRowId(row);

	public isRowLoading = (rowId: string): boolean => this.engine.isRowLoading(rowId);

	public getCellValue = (rowId: string, colField: string): unknown => this.engine.getCellDisplayValue(rowId, colField);

	public getFormula = (rowId: string, colField: string): string | undefined => this.engine.getFormula(rowId, colField);
	public hasFormula = (rowId: string, colField: string): boolean => this.engine.hasFormula(rowId, colField);
	public setFormula = (rowId: string, colField: string, formula: string): void => {
		this.engine.setCellValue(rowId, colField, formula);
	};
	public clearFormula = (rowId: string, colField: string): void =>
		this.engine.syncFormulaForCell(rowId, colField, this.engine.getRawCellValue(rowId, colField));

	public getCachedDisplayValue = (rowId: string, colField: string): string | undefined => this.engine.getCachedDisplayValue(rowId, colField);

	public getCheapDisplayValue = (rowId: string, colField: string): string => this.engine.getCheapDisplayValue(rowId, colField);

	public getComputedCellValue = (rowId: string, colField: string): unknown => this.engine.getComputedCellValue(rowId, colField);

	public getRowOverscanPx = (): number => {
		return this.state.rowOverscanPx ?? 400;
	};

	public setRowOverscanPx = (px: number): void => {
		this.engine.setRowOverscanPx(px);
	};

	/**
	 * Updates a single cell value. Triggers valueSetter, undo history, and formula recalculation.
	 *
	 * For bulk mutations prefer `updateRows` (functional mapper) or `applyTransaction`
	 * (structured add/remove/update). Calling this in a loop fires O(N) individual
	 * invalidations instead of one coalesced batch.
	 */
	public setCellValue = (rowId: string, colField: string, value: unknown): GridWriteResult => this.engine.setCellValue(rowId, colField, value);

	public setCellValueAsync = (rowId: string, colField: string, value: unknown): Promise<GridWriteResult> =>
		this.engine.setCellValueAsync(rowId, colField, value);

	/**
	 * Applies multiple cell value writes as a single atomic operation.
	 * valueSetter runs per-cell, but notifications, cellValueChanged events, and undo
	 * are coalesced — one RAF flush and one undo entry for the entire batch.
	 * Use this instead of looping setCellValue for paste, clear, and programmatic bulk edits.
	 */
	public batchCellValues = (
		updates: { rowId: string; colField: string; value: unknown }[],
		source: 'paste' | 'api' | 'fill' = 'api'
	): GridWriteResult => this.engine.batchCellValues(updates, source);

	public batchCellValuesAsync = (
		updates: { rowId: string; colField: string; value: unknown }[],
		source: 'paste' | 'api' | 'fill' = 'api'
	): Promise<GridWriteResult> => this.engine.batchCellValuesAsync(updates, source);

	public getCellState = (rowId: string, colField: string): CellState => {
		const column = this.engine.columns.getColumnDef(colField);
		return this.buildCellState(rowId, colField, column);
	};

	public getCellStateByPointer = (pointer: GridCellPointer): CellState | null => {
		const access = this.getCellAccessByPointer(pointer);
		if (!access) return null;
		return this.buildCellState(access.rowId, access.colField, access.column);
	};

	public selectCell = (pointer: GridCellPointer | null, source: GridSelectionSource = 'api'): void => {
		this.interactionController.selectCell(pointer, source);
	};

	public selectRange = (start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'api'): void => {
		this.interactionController.selectRange(start, end, source);
	};

	public extendSelection = (end: GridCellPointer, source: GridSelectionSource = 'api'): void => {
		this.interactionController.extendSelection(end, source);
	};

	public applyRowSelectionGesture = (gesture: RowSelectionGesture): RowSelectionChangeResult | null => {
		return this.interactionController.applyRowSelectionGesture(gesture);
	};

	public selectRows = (rowIds: string[], options?: SelectRowsOptions): void =>
		options?.mode === 'replace' ? this.engine.replaceRowIds(rowIds, 'api') : this.engine.selectRowIds(rowIds, 'api');

	public deselectRows = (rowIds: string[]): void => this.engine.deselectRowIds(rowIds, 'api');

	public toggleRowSelection = (rowId: string): void => this.engine.toggleRowId(rowId, 'api');

	public selectAllRows = (options?: SelectAllRowsOptions): void => this.engine.selectAllDataRows('api', options?.scope, options?.mode);

	public clearRowSelection = (): void => this.engine.clearRowSelection('api');

	public isRowNodeSelected = (rowId: string): boolean => readInteractionState(this.state).rowSelection.selectedRowIds.includes(rowId);

	public getSelectedRowCount = (): number => readInteractionState(this.state).rowSelection.selectedRowIds.length;

	public getSelectedRowIds = (): string[] => readInteractionState(this.state).rowSelection.selectedRowIds.slice();

	public setColumnWidth = (colField: string, width: number): void => this.engine.resizeColumn(colField, width);
	public autoSizeColumn = (colField: string, options?: AutoSizeColumnOptions): void => this.engine.autoSizeColumn(colField, options);
	public autoSizeAllColumns = (options?: AutoSizeAllColumnsOptions): void => this.engine.autoSizeAllColumns(options);
	public getColumnDistinctValues = (colField: string): (string | number | null)[] => this.engine.getColumnDistinctValues(colField);
	public getColumnDistinctValueSummary = (colField: string) => this.engine.getColumnDistinctValueSummary(colField);
	public copySelectedRange = (): Promise<void> => this.interactionController.copySelectedRange();
	public pasteFromClipboard = (): Promise<void> => this.interactionController.pasteFromClipboard();
	public copyRange = (minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void> =>
		this.engine.copyRange(minRow, maxRow, minCol, maxCol);
	public setColumnVisible = (colField: string, visible: boolean): void => this.setColumnsVisible([colField], visible);

	public setColumnsVisible = (colFields: string[], visible: boolean): void => {
		const fieldSet = new Set(colFields);
		if (fieldSet.size === 0) return;
		let changed = false;
		const columns = this.state.columns.map((column) => {
			if (!fieldSet.has(column.field) || column.hide === !visible) return column;
			changed = true;
			return { ...column, hide: !visible };
		});
		if (changed) {
			this.engine.setColumns(columns, false);
			// Clear filters for columns being hidden so stale filter state doesn't accumulate
			if (!visible && this.state.filterModel) {
				const newModel = { ...this.state.filterModel };
				let filterChanged = false;
				for (const field of fieldSet) {
					if (field in newModel) {
						delete newModel[field];
						filterChanged = true;
					}
				}
				if (filterChanged) {
					this.engine.setFilterModel(Object.keys(newModel).length > 0 ? newModel : null, false);
				}
			}
		}
	};

	public getColumns = (): ColumnDef<TRowData>[] => {
		return this.state.columns.slice();
	};

	public getDisplayedColumns = (): ColumnDef<TRowData>[] => this.engine.getDisplayedColumns();
	public setPinnedColumns = (pins: { left?: number; right?: number }): void => this.setViewportPins(pins);
	public getPinnedColumns = (): { left: number; right: number } => this.engine.getPinnedColumns();
	public moveColumn = (colField: string, toIndex: number): void => this.engine.moveColumn(colField, toIndex);
	public setColumnOrder = (colFields: string[]): void => this.engine.setColumnOrderByFields(colFields);
	public setColumnReorderEnabled = (enabled: boolean): void => this.engine.setColumnReorderEnabled(enabled);
	public setRowHeight = (rowId: string, height: number): void => this.engine.resizeRow(rowId, height);

	public setSortModel = (sortModel: SortModel | null): void => {
		this.engine.setSortModel(sortModel);
	};

	public setFilterModel = (filterModel: FilterModel | null): void => {
		this.engine.setFilterModel(filterModel);
	};

	public getQuickFilter = (): QuickFilterModel | null => {
		return this.state.quickFilterModel ?? null;
	};

	/**
	 * Search a single string across multiple columns at once — the "search box" pattern.
	 * A row passes if ANY targeted column's display value contains `text` (case-insensitive).
	 * Combines with any active `filterModel`/`queryModel` via AND. Pass an empty/whitespace-only
	 * string (or omit it) to clear the quick filter.
	 *
	 * @param columnIds Column fields to search. Omit to search every displayed column.
	 */
	public setQuickFilter = (text: string, columnIds?: string[]): void => {
		const trimmed = text.trim();
		this.engine.setQuickFilterModel(trimmed ? { text: trimmed, columnIds } : null);
	};

	public getQueryModel = (): GridQueryModel | null => {
		return this.state.queryModel ?? null;
	};

	public setQueryModel = (model: GridQueryModel | null): void => {
		this.engine.setQueryModel(model);
	};

	public clearQueryModel = (): void => {
		this.engine.setQueryModel(null);
	};

	public evaluateQueryForRow = (rowId: string): boolean => {
		const queryModel = this.state.queryModel;
		if (!queryModel) return true;
		const node = this.getRowNodeById(rowId);
		if (!node) return false;
		const ctx = createQueryEvaluationContext(this.state.columns);
		return evaluateQueryModel(queryModel, node, ctx);
	};

	public setGroupBy = (colIds: string[]): void => {
		this.engine.setGroupBy(colIds);
	};

	public getGroupBy = (): string[] => {
		return this.state.groupBy ?? [];
	};

	public addGroupBy = (colId: string, atIndex?: number): void => {
		this.engine.addGroupBy(colId, atIndex);
	};

	public removeGroupBy = (colId: string): void => {
		this.engine.removeGroupBy(colId);
	};

	public moveGroupBy = (colId: string, toIndex: number): void => {
		this.engine.moveGroupBy(colId, toIndex);
	};

	public setAggDefs = (defs: AggregationDef<TRowData>[]): void => {
		this.engine.setAggDefs(defs);
	};

	public getAggDefs = (): AggregationDef<TRowData>[] => {
		return this.state.aggDefs ?? [];
	};

	public expandAllGroups = (): void => {
		this.engine.groupingFeature.expandAllGroups();
	};

	public collapseAllGroups = (): void => {
		this.engine.groupingFeature.collapseAllGroups();
	};

	public setShowGroupFooter = (enabled: boolean): void => {
		this.engine.setShowGroupFooter(enabled);
	};

	public setStickyGroupRows = (enabled: boolean): void => {
		this.engine.setStickyGroupRows(enabled);
	};

	public setShowGroupPanel = (enabled: boolean): void => {
		this.engine.setShowGroupPanel(enabled);
	};

	public setShowFloatingFilters = (enabled: boolean): void => {
		this.engine.setShowFloatingFilters(enabled);
	};

	public setShowFilterChipBar = (enabled: boolean): void => {
		this.engine.setShowFilterChipBar(enabled);
	};

	public exportCsv = (options?: CsvExportOptions): void => {
		exportToCsv(this, options);
	};

	// All persistence methods are overridden by the private runtime composition root when an adapter is configured.
	public hasPersistence = (): boolean => false;
	public clearPersistedState = (): void => {};
	public setAutoSave = (_enabled: boolean): void => {};
	public isAutoSaveEnabled = (): boolean => true;
	public getPersistenceStatus = (): PersistenceStatus => ({ status: 'idle', autoSave: true });
	public subscribeToPersistenceStatus =
		(_listener: (status: PersistenceStatus) => void): (() => void) =>
		() => {};
	public saveNow = (): void => {};

	// All workspace methods are overridden by the composition root when a workspace adapter is configured.
	public hasWorkspace = (): boolean => false;
	public getWorkspaceState = (): GridWorkspaceState => _EMPTY_WS_STATE;
	public subscribeToWorkspaceState =
		(_listener: (state: GridWorkspaceState) => void): (() => void) =>
		() => {};
	public listViews = (): Promise<readonly GridViewDefinition[]> => Promise.resolve([]);
	public saveView = (_name: string, _options?: SaveViewOptions): Promise<GridViewDefinition> =>
		Promise.reject(new Error('[wit-grid] No workspace adapter configured'));
	public updateView = (_id: string, _state?: PersistedGridState): Promise<void> => Promise.resolve();
	public applyView = (_id: string): Promise<void> => Promise.resolve();
	public deleteView = (_id: string): Promise<void> => Promise.resolve();
	public duplicateView = (_id: string, _name: string): Promise<GridViewDefinition> =>
		Promise.reject(new Error('[wit-grid] No workspace adapter configured'));
	public renameView = (_id: string, _name: string): Promise<void> => Promise.resolve();
	public setDefaultView = (_id: string | null): Promise<void> => Promise.resolve();

	public openPanel = (panelId: string): void => {
		this.engine.setSidebarOpenPanel(panelId);
	};

	public closePanel = (): void => {
		this.engine.setSidebarOpenPanel(null);
	};

	public togglePanel = (panelId: string): void => {
		const current = this.state.sidebarOpenPanel;
		this.engine.setSidebarOpenPanel(current === panelId ? null : panelId);
	};

	public getOpenPanel = (): string | null => {
		return this.state.sidebarOpenPanel ?? null;
	};

	public openChart = (): void => {
		this.engine.setChartOpen(true);
	};

	public closeChart = (): void => {
		this.engine.setChartOpen(false);
	};

	public toggleChart = (): void => {
		this.engine.setChartOpen(!this.state.chartOpen);
	};

	public isChartOpen = (): boolean => {
		return this.state.chartOpen ?? false;
	};

	public setStyleRules = (styleRules: GridStyleRule<TRowData>[] | undefined): void => {
		this.engine.setStyleRules(styleRules);
	};

	public toggleGroupExpanded = (groupId: string): void => {
		this.engine.groupingFeature.toggleGroupExpanded(groupId);
	};

	public toggleDetailExpanded = (rowId: string): void => {
		this.engine.groupingFeature.toggleDetailExpanded(rowId);
	};

	public isGroupExpanded = (groupId: string): boolean => {
		return this.getExpansionStateReadableRowModel()?.isGroupExpanded(groupId) ?? false;
	};

	public isDetailExpanded = (rowId: string): boolean => {
		return this.getExpansionStateReadableRowModel()?.isDetailExpanded(rowId) ?? false;
	};

	public getVisualRow = (index: number): VisualRow<TRowData> | null => {
		return this.rowFacade.getVisualRow(index);
	};

	public getVisualRowCount = (): number => {
		return this.rowFacade.getVisualRowCount();
	};

	public getVisualIndexById = (visualRowId: string): number | null => {
		return this.rowFacade.getVisualIndexById(visualRowId);
	};

	public getVisualIndexByRowId = (rowId: string): number | null => {
		return this.rowFacade.getVisualIndexByRowId(rowId);
	};

	public getRowLoadState = (index: number): RowLoadState => {
		return this.rowFacade.getRowLoadState(index);
	};

	public getRowNode = (rowId: string): GridRowNode<TRowData> | undefined => {
		return this.rowFacade.getRowNode(rowId);
	};

	public getDisplayedRowAtIndex = (index: number): GridRowNode<TRowData> | undefined => {
		return this.rowFacade.getDisplayedRowAtIndex(index);
	};

	public getRowIndexById = (rowId: string): number | undefined => {
		return this.rowFacade.getRowIndexById(rowId);
	};

	public forEachNode = (callback: (node: GridRowNode<TRowData>, index: number) => void): void => {
		this.rowFacade.forEachNode(callback);
	};

	public forEachDisplayedNode = (callback: (node: GridRowNode<TRowData>, index: number) => void): void => {
		this.rowFacade.forEachDisplayedNode(callback);
	};

	public getRowNodeById = (rowId: string): RowNode<TRowData> | null => {
		return this.rowFacade.getRowNodeById(rowId);
	};

	public getRawRowById = (rowId: string): TRowData | null => {
		return this.rowFacade.getRawRowById(rowId);
	};

	public addEventListener = <K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	): (() => void) => {
		return this.engine.addEventListener(type, callback);
	};

	public dispatchEvent = <K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void => {
		this.engine.dispatchEvent(type, payload);
	};

	public startEditing = (rowId: string, colFieldOrInstanceId: string, source: 'keyboard' | 'mouse' | 'api' = 'api'): void => {
		this.interactionController.startEdit(rowId, colFieldOrInstanceId, source);
	};

	public updateEditDraft = (rowId: string, colFieldOrInstanceId: string, value: unknown): void => {
		this.interactionController.updateEditDraft(rowId, colFieldOrInstanceId, value);
	};

	public stopEditing = (cancel: boolean = false): void => {
		this.interactionController.stopEdit(cancel);
	};

	public commitEdit = async (rowId: string, colFieldOrInstanceId: string, value: unknown): Promise<boolean> => {
		return this.interactionController.commitCellEdit(rowId, colFieldOrInstanceId, value);
	};

	// ── Data Integrity API ─────────────────────────────────────────────────────
	public integrity!: import('./features/dataIntegrity/integrityTypes.js').GridIntegrityApi<TRowData>;

	public can = (
		action: import('./capabilities/capabilityTypes.js').GridCapabilityAction,
		params: Partial<import('./capabilities/capabilityTypes.js').GridCapabilityParams<TRowData>> = {}
	): import('./capabilities/capabilityTypes.js').GridCapabilityResult => this.engine.capabilityManager.can(action, params);

	public canEdit = (rowId: string, colField: string): boolean => this.engine.capabilityManager.can('edit', { rowId, colField }).allowed;

	public canCopy = (rowId?: string, colField?: string): boolean => this.engine.capabilityManager.can('copy', { rowId, colField }).allowed;

	public canPaste = (rowId?: string, colField?: string): boolean => this.engine.capabilityManager.can('paste', { rowId, colField }).allowed;

	public canExport = (colField?: string): boolean => this.engine.capabilityManager.can('export', { colField }).allowed;

	public getColumnState = (): ColumnState[] => {
		return this.engine.columnFeature.getColumnState();
	};
	public applyColumnState = (states: ColumnState[], opts?: { applyOrder?: boolean }): void => {
		this.engine.columnFeature.applyColumnState(states, opts);

		if (states.some((s) => s.sort !== undefined)) {
			const sorted = states.filter((s) => s.sort != null).sort((a, b) => (a.sortIndex ?? 999) - (b.sortIndex ?? 999));
			this.engine.setSortModel(sorted.length ? sorted.map((s) => ({ colId: s.field, sort: s.sort! })) : null);
		}

		if (states.some((s) => s.pinned !== undefined)) {
			const left = states.filter((s) => s.pinned === 'left').length;
			const right = states.filter((s) => s.pinned === 'right').length;
			this.setViewportPins({ left, right });
		}
	};
	public getGridState = (): PersistedGridState => {
		return extractPersistedState(this.engine.getState());
	};
	public applyGridState = (state: PersistedGridState): void => {
		const prepared = preparePersistedGridStateRestore(state, this.engine.getState());
		if (!prepared.ok) {
			this.reportRuntimeFault({
				source: 'persistence',
				operation: 'applyGridState',
				error: new Error(prepared.reason),
				context: { persistedStateVersion: (state as { v?: unknown }).v },
			});
			return;
		}

		const result = this.engine.changeApplier.commit({
			reason: 'persistence:restore',
			state: prepared.restore.stateMutation,
			domains: ['columns', 'rows'],
			invalidations: [{ kind: 'full', reason: 'set data' }],
			historyPolicy: 'suppress',
			requestRender: true,
		});

		if (result.status === 'committed') {
			this.engine.commandHistory.clear();
		} else if (result.status !== 'noop') {
			this.reportRuntimeFault({
				source: 'persistence',
				operation: 'applyGridState',
				error: new Error(result.status === 'rejected' ? result.reason : 'persistence restore commit failed'),
				context: { persistedStateVersion: (state as { v?: unknown }).v },
			});
		}
	};

	public registerRowModel = (rowModel: RowModel<TRowData>): void => {
		this.engine.registerRowModel(rowModel);
	};

	public getRowModel = (): RowModel<TRowData> | null => {
		return this.engine.getRowModel();
	};

	private getClientStructuralRowModel(): ClientStructuralRowModel<TRowData> | null {
		return asClientStructuralRowModel(this.getRowModel());
	}

	private getInfiniteControllableRowModel(): InfiniteControllableRowModel<TRowData> | null {
		return asInfiniteControllableRowModel(this.getRowModel());
	}

	private getServerSideControllableRowModel(): ServerSideControllableRowModel<TRowData> | null {
		return asServerSideControllableRowModel(this.getRowModel());
	}

	private getExpansionStateReadableRowModel(): RowExpansionStateReadableModel | null {
		return asRowExpansionStateReadableModel(this.getRowModel());
	}

	private assertInfiniteRowModel(op: string): InfiniteControllableRowModel<TRowData> {
		const m = this.getInfiniteControllableRowModel();
		if (!m)
			throw new UnsupportedRowModelOperationError({ operation: op, rowModelType: this.getRowModelType(), supportedRowModels: ['infinite'] });
		return m;
	}

	private assertServerSideRowModel(op: string): ServerSideControllableRowModel<TRowData> {
		const m = this.getServerSideControllableRowModel();
		if (!m)
			throw new UnsupportedRowModelOperationError({
				operation: op,
				rowModelType: this.getRowModelType(),
				supportedRowModels: ['server (SSRM)'],
			});
		return m;
	}

	private assertClientStructuralRowModel(op: string): ClientStructuralRowModel<TRowData> {
		const m = this.getClientStructuralRowModel();
		if (!m) throw new UnsupportedRowModelOperationError({ operation: op, rowModelType: this.getRowModelType(), supportedRowModels: ['client'] });
		return m;
	}

	public getClientRowModelRuntime = (): ClientRowModelRuntime<TRowData> => createClientRowModelRuntime(this);
	public getInfiniteRowModelRuntime = (): InfiniteRowModelRuntime<TRowData> => createInfiniteRowModelRuntime(this);
	public getServerSideRowModelRuntime = (): ServerSideRowModelRuntime<TRowData> => createServerSideRowModelRuntime(this);

	public getDataRowAtVisualIndex = (index: number): TRowData | null => {
		return this.rowFacade.getDataRowAtVisualIndex(index);
	};

	public getDataRowNodeAtVisualIndex = (index: number): RowNode<TRowData> | null => {
		return this.rowFacade.getDataRowNodeAtVisualIndex(index);
	};

	public rows = (): GridRowsAccessor<TRowData> => {
		return this.rowFacade.rows();
	};

	public setRows = (rows: TRowData[]): GridWriteResult => {
		this.assertClientStructuralRowModel('setRows');
		return this.engine.replaceRows(rows);
	};

	public getRowOrder = (): string[] => this.getClientStructuralRowModel()?.getRowOrder() ?? [];
	public setRowOrder = (rowIds: string[]): GridWriteResult => this.engine.setRowOrder(rowIds);

	public updateRows = (updater: (rows: TRowData[]) => TRowData[]): GridWriteResult => {
		this.assertClientStructuralRowModel('updateRows');
		return this.engine.updateRows(updater);
	};

	public applyTransaction = (transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData> | null => {
		return this.engine.applyTransaction(transaction);
	};

	public transaction = (transaction: GridTransaction<TRowData>): RowNodeTransaction<TRowData> | null => {
		let rowResult: RowNodeTransaction<TRowData> | null = null;
		this.engine.batch(() => {
			if (transaction.columns) {
				this.setColumns(transaction.columns);
			}
			if (transaction.rows) {
				this.setRows(transaction.rows);
			}
			if (transaction.rowTransaction) {
				rowResult = this.applyTransaction(transaction.rowTransaction);
			}
			if ('sortModel' in transaction) {
				this.setSortModel(transaction.sortModel ?? null);
			}
			if ('filterModel' in transaction) {
				this.setFilterModel(transaction.filterModel ?? null);
			}
			if (transaction.pins) {
				this.setViewportPins(transaction.pins);
			}
		});
		return rowResult;
	};

	public refreshRows = (): void => {
		this.getRowModel()?.refresh();
	};

	public setRowHeights = (rowHeights: Record<string, number> | undefined): void => {
		const current = this.state.rowHeights;
		const next = rowHeights ?? {};
		if (areRowHeightsEqual(current, next)) return;
		this.engine.setRowHeights(next);
	};

	public setDefaultRowHeight = (defaultRowHeight?: number | undefined): void => {
		if (defaultRowHeight === undefined) return;
		if (this.state.defaultRowHeight === defaultRowHeight) return;
		this.engine.setDefaultRowHeight(defaultRowHeight);
	};

	public getRowModelType = (): RowModelType => {
		const rowModel = this.getRowModel();
		if (asServerSideControllableRowModel(rowModel)) return 'server';
		if (asInfiniteControllableRowModel(rowModel)) return 'infinite';
		return 'client';
	};

	public getRowModelCapabilities = (): RowModelCapabilities => {
		const capable = asCapableRowModel(this.getRowModel());
		return capable ? capable.getCapabilities() : _FALLBACK_CAPS[this.getRowModelType()];
	};

	public supportsRowModelCapability = (capability: RowModelCapability): boolean => {
		return this.getRowModelCapabilities()[capability] === true;
	};

	public purgeCache = (): void => {
		this.assertInfiniteRowModel('purgeCache').purgeCache();
	};

	public setInfiniteDatasource = (datasource: InfiniteDatasource<TRowData>, blockSize?: number): void => {
		this.assertInfiniteRowModel('setInfiniteDatasource').setDatasource(datasource, blockSize);
	};

	public setServerSideDatasource = (datasource: ServerSideDatasource<TRowData>): void => {
		this.assertServerSideRowModel('setServerSideDatasource').setServerSideDatasource(datasource);
	};

	public refreshServerSide = (options?: ServerSideRefreshOptions): void => {
		this.assertServerSideRowModel('refreshServerSide').refreshServerSide(options);
	};

	public purgeServerSide = (options?: Omit<ServerSideRefreshOptions, 'purge'>): void => {
		this.assertServerSideRowModel('purgeServerSide').purgeServerSide(options);
	};

	public getServerSideStoreState = (): readonly ServerSideStoreSnapshot[] => {
		return this.getServerSideControllableRowModel()?.getServerSideStoreState() ?? this.getState().serverSide?.storeStates ?? [];
	};

	public setViewportPins = (pins: { left?: number; right?: number; top?: number; bottom?: number }): void => {
		if (pins.left !== undefined) this.viewportController.pinLeftColumns = pins.left;
		if (pins.right !== undefined) this.viewportController.pinRightColumns = pins.right;
		if (pins.top !== undefined) this.viewportController.pinTopRows = pins.top;
		if (pins.bottom !== undefined) this.viewportController.pinBottomRows = pins.bottom;
		// Sync column pin counts into state so they can be subscribed to and persisted
		if (pins.left !== undefined || pins.right !== undefined) {
			this.engine.setPinnedColumnsState(this.viewportController.pinLeftColumns, this.viewportController.pinRightColumns);
		}
	};

	public setViewportSize = (width: number, height: number): boolean => {
		return this.viewportController.setViewportSize(width, height);
	};

	public setScrollPosition = (scrollTop: number, scrollLeft: number, timestamp?: number): boolean => {
		return this.viewportController.setScrollPosition(scrollTop, scrollLeft, timestamp);
	};

	public getScrollVelocity = (): { vx: number; vy: number } => {
		return this.viewportController.getVelocity();
	};

	public getVisibleRowRange = (): ViewportRange => {
		return this.viewportController.getVisibleRowRange();
	};

	public getVisibleColumnRange = (): { colStart: number; colEnd: number; total: number } => {
		const r = this.viewportController.getVisibleColumnRange();
		return { colStart: r.startIdx, colEnd: r.endIdx, total: this.engine.stateManager.getState().columns.length };
	};

	public updateVisibleRanges = (): boolean => {
		return this.viewportController.updateVisibleRanges();
	};

	public subscribe = (listener: GridSnapshotListener<TRowData>): (() => void) => this.subscriptionsFacade.subscribe(listener);
	public subscribeToKey = <K extends keyof GridStateSnapshot<TRowData>>(key: K, listener: GridSnapshotKeyListener<TRowData, K>): (() => void) =>
		this.subscriptionsFacade.subscribeToKey(key, listener);
	public subscribeToSnapshotSelector = <K extends keyof GridStateSnapshot<TRowData>, TValue>(
		keys: readonly K[],
		selector: GridSnapshotSelector<TRowData, TValue>,
		listener: (value: TValue) => void,
		isEqual: GridSnapshotSelectorEquality<TValue> = Object.is
	): (() => void) => this.subscriptionsFacade.subscribeToSnapshotSelector(keys, selector, listener, isEqual);
	public subscribeToIntegrity = (listener: (integrity: InternalGridState<TRowData>['integrity']) => void): (() => void) =>
		this.subscriptionsFacade.subscribeToIntegrity(listener);

	public subscribeToDomainVersions = (listener: (v: GridDomainVersions) => void): (() => void) => {
		return this.engine.subscribeToDomainVersions(listener);
	};

	public subscribeDomain = (domain: keyof GridDomainVersions, listener: (version: number) => void): (() => void) => {
		return this.engine.subscribeDomain(domain, listener);
	};

	public subscribeToViewport = (listener: GridSnapshotListener<TRowData>): (() => void) => this.subscriptionsFacade.subscribeToViewport(listener);
	public subscribeToSelection = (listener: GridSnapshotListener<TRowData>): (() => void) => this.subscriptionsFacade.subscribeToSelection(listener);
	public subscribeToFocusedCell = (listener: GridSnapshotListener<TRowData>): (() => void) =>
		this.subscriptionsFacade.subscribeToFocusedCell(listener);
	public subscribeToEditingCell = (listener: GridSnapshotListener<TRowData>): (() => void) =>
		this.subscriptionsFacade.subscribeToEditingCell(listener);
	public subscribeToCell = (rowId: string, colField: string, listener: () => void): (() => void) =>
		this.subscriptionsFacade.subscribeToCell(rowId, colField, listener);
	public subscribeToRow = (rowId: string, listener: GridSnapshotListener<TRowData>): (() => void) =>
		this.subscriptionsFacade.subscribeToRow(rowId, listener);
	public subscribeToColumn = (colField: string, listener: GridSnapshotListener<TRowData>): (() => void) =>
		this.subscriptionsFacade.subscribeToColumn(colField, listener);
	public subscribeToHeaders = (listener: GridSnapshotListener<TRowData>): (() => void) => this.subscriptionsFacade.subscribeToHeaders(listener);

	public triggerCellNotifications = (rowId: string): void => {
		for (const col of this.state.columns) {
			this.engine.notifyCellChange(rowId, col.field);
		}
	};

	public setColumns = (columns: ColumnDef<TRowData>[]): void => {
		validateColumns(columns);
		this.engine.setColumns(columns);
	};

	public getColumnIndex = (colField: string): number => this.engine.getColumnIndex(colField);

	public getColumnField = (colIndex: number): string | null => this.engine.getColumnField(colIndex);

	public getColumnDef = (colField: string): ColumnDef<TRowData> | undefined => this.engine.getColumnDef(colField);

	public getCellAccess = (rowId: string, colField: string): GridCellAccess<TRowData> | null => this.engine.cellAccess.getByPointer(rowId, colField);

	public getCellAccessByPointer = (pointer: GridCellPointer): GridCellAccess<TRowData> | null => {
		const columnKey = pointer.columnInstanceId ?? pointer.colField;
		return this.engine.cellAccess.getByPointer(pointer.rowId, columnKey);
	};

	private buildCellState(
		rowId: string,
		colField: string,
		column: (Pick<ColumnDef<TRowData>, 'field'> & { instanceId?: ColumnInstanceId }) | undefined
	): CellState {
		const computedValue = this.getCellValue(rowId, colField);
		const interaction = readInteractionState(this.state);
		const isEditing = column ? doesCanonicalCellPointerMatchColumn(interaction.activeEdit.active, rowId, column) : false;

		let value = computedValue;
		if (this.engine.hasFormula(rowId, colField)) {
			value = this.engine.getFormula(rowId, colField);
		} else {
			value = this.engine.getRawCellValue(rowId, colField);
		}

		return {
			value,
			computedValue,
			isEditing,
		};
	}

	public registerCellSubscription = (sub: CellSubscription): void => this.engine.registerCellSubscription(sub);

	public unregisterCellSubscription = (sub: CellSubscription): void => this.engine.unregisterCellSubscription(sub);

	public updateCellSubscription = (sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void => {
		this.engine.updateCellSubscription(sub, oldRowId, oldColField, newRowId, newColField);
	};

	public get batchedUpdates(): boolean {
		return this.engine.batchedUpdates;
	}

	public set batchedUpdates(enabled: boolean) {
		this.engine.batchedUpdates = enabled;
	}

	public flushCellUpdatesSync = (): void => this.engine.flushCellUpdatesSync();
	public registerPlugin = (plugin: GridPlugin<TRowData>): void => this.pluginRegistry.registerPlugin(plugin);
	public unregisterPlugin = (name: string): void => this.pluginRegistry.unregisterPlugin(name);
	public getPlugin = <T = unknown>(name: string): T | null => this.pluginRegistry.getPlugin<T>(name);
	public undo = (): void => this.engine.undo();
	public redo = (): void => this.engine.redo();

	public canUndo = (): boolean => this.engine.commandHistory.canUndo();

	public canRedo = (): boolean => this.engine.commandHistory.canRedo();

	/** Bind live renderer and theme ports for an active host. Returns a binding token.
	 *  Rejects concurrent bindings — only one active host is allowed at a time. */
	public bindRuntimePorts = (ports: GridRuntimePorts): RuntimePortBindResult => this.hostFacade.bindRuntimePorts(ports);

	/** Unbind the active host and restore headless ports. Stale binding tokens report a fault and no-op. */
	public unbindRuntimePorts = (binding: RuntimePortBinding): void => this.hostFacade.unbindRuntimePorts(binding);

	/** Returns true if the binding token corresponds to the currently active host. */
	public isBindingCurrent = (binding: RuntimePortBinding): boolean => this.hostFacade.isBindingCurrent(binding);
	public getInstrumentation = (): GridInstrumentation => this.hostFacade.getInstrumentation();
	public setInstrumentation = (inst: GridInstrumentation): void => this.hostFacade.setInstrumentation(inst);
	public getRenderStats = (): RenderStats => this.hostFacade.getRenderStats();
	public resetRenderStats = (): void => this.hostFacade.resetRenderStats();
	public getRuntimeFaults = () => this.hostFacade.getRuntimeFaults();
	public clearRuntimeFaults = (): void => this.hostFacade.clearRuntimeFaults();
	public reportRuntimeFault = (fault: import('./diagnostics/RuntimeFaultReporter.js').RuntimeFaultInput) =>
		this.hostFacade.reportRuntimeFault(fault);
	public getTheme = (): ThemeTokens => this.hostFacade.getTheme();
	public getThemeName = (): BuiltInThemeName | null => this.hostFacade.getThemeName();
	public getAvailableThemes = (): BuiltInThemeName[] => this.hostFacade.getAvailableThemes();
	public switchTheme = (themeName: string): void => this.hostFacade.switchTheme(themeName);
	public mergeTheme = (partial: Partial<ThemeTokens>): void => this.hostFacade.mergeTheme(partial);
	public setTheme = (theme: ThemeTokens): void => this.hostFacade.setTheme(theme);
	public onThemeChange = (listener: (theme: ThemeTokens) => void): (() => void) => this.hostFacade.onThemeChange(listener);
	public setContainerElement = (c: HTMLElement): void => this.hostFacade.setContainerElement(c);
	public getContainerElement = (): HTMLElement | null => this.hostFacade.getContainerElement();
	public getContainer = (): HTMLElement | null => this.hostFacade.getContainer();
	public scrollToCell = (rowId: string, colField: string, options?: ScrollToCellOptions): void => {
		this.interactionController.scrollToCell(rowId, colField, options);
	};
	public scrollToRow = (rowId: string, options?: ScrollToRowOptions): void => {
		this.interactionController.scrollToRow(rowId, options);
	};
	public getInsightDiagnostics = (): Record<string, unknown> => this.hostFacade.getInsightDiagnostics();

	public destroy = (): void => {
		this.storeDestroyed = true;
		this.pluginRegistry.destroy();
		this.engine.destroy();
	};
}
