import type { FilterModel, QuickFilterModel, SortModel, AggregationDef, RowModelCapability, RowModelCapabilities } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { RuntimePortBinding, RuntimePortBindResult, GridRuntimePorts } from '../engine/rendererPorts.js';
import type { InfiniteDatasource } from '../infiniteRowModel.js';
import type { ServerSideDatasource, ServerSideRefreshOptions, ServerSideStoreSnapshot } from '../serverSideRowModel.js';
import type { RowModelType, ColumnState, GridIntegrityState } from '../state/GridState.js';
import type { ColumnDef, GridStyleRule } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import type { GridRowNode } from '../publicRowNode.js';
import type { RowLoadState } from '../rowModel.js';
import type { RenderStats } from '../renderer/renderTelemetry.js';
import type { PersistenceStatus, PersistedGridState } from '../persistence/statePersistence.js';
import type { GridViewDefinition, GridWorkspaceState, SaveViewOptions } from '../workspace/workspaceTypes.js';
import type { CsvExportOptions } from '../export/csvExport.js';
import type { GridDistinctValueSummary } from '../distinctValues.js';
import type { GridEventPayloadMap, GridEventListener } from './GridEvents.js';
import type { RuntimeFault, RuntimeFaultInput } from '../diagnostics/RuntimeFaultReporter.js';
import type { GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import type { BuiltInThemeName, ThemeTokens } from '../renderer/themes.js';
import type { GridCapabilityAction, GridCapabilityParams, GridCapabilityResult } from '../capabilities/capabilityTypes.js';
import type { GridIntegrityApi } from '../features/dataIntegrity/integrityTypes.js';
import type {
	ActiveEditState,
	AutoSizeAllColumnsOptions,
	AutoSizeColumnOptions,
	BatchCellValueUpdate,
	CellState,
	CellSubscription,
	GridCellAccess,
	GridCellPointer,
	GridPlugin,
	GridRowsAccessor,
	GridSelectionSource,
	GridSnapshotKeyListener,
	GridSnapshotListener,
	GridSnapshotSelector,
	GridSnapshotSelectorEquality,
	GridSnapshotSelectorListener,
	GridStateSnapshot,
	GridWriteResult,
	RowDataTransaction,
	RowSelectionChangeResult,
	RowSelectionGesture,
	SelectAllRowsOptions,
	SelectRowsOptions,
} from './GridApi.js';
import type { RowNodeTransaction } from '../rowTransactions.js';

export interface GridDataApi<TRowData = unknown> {
	getStateSnapshot(): GridStateSnapshot<TRowData>;
	getRowId(row: TRowData): string;
	isRowLoading(rowId: string): boolean;
	getDataRowAtVisualIndex(index: number): TRowData | null;
	setRows(rows: TRowData[]): GridWriteResult;
	updateRows(updater: (rows: TRowData[]) => TRowData[]): GridWriteResult;
	applyTransaction(transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData> | null;
	/**
	 * Queues a transaction to apply with others before the next frame, in call order. Independent
	 * transactions are applied together as one commit and one render, which suits high-frequency
	 * feeds. The callback receives this transaction's own result. Any synchronous write (including
	 * applyTransaction) applies the queue first, so writes always land in the order they were made.
	 */
	applyTransactionAsync(transaction: RowDataTransaction<TRowData>, callback?: (result: RowNodeTransaction<TRowData> | null) => void): void;
	/** Applies queued applyTransactionAsync transactions immediately. */
	flushAsyncTransactions(): void;
	getRowOrder(): string[];
	setRowOrder(rowIds: string[]): GridWriteResult;
	refreshRows(): void;
	setRowHeights: (rowHeights: Record<string, number> | undefined) => void;
	setDefaultRowHeight: (defaultRowHeight?: number | undefined) => void;
	getRowModelType(): RowModelType;
	getRowModelCapabilities(): RowModelCapabilities;
	supportsRowModelCapability(capability: RowModelCapability): boolean;
	purgeCache(): void;
	setInfiniteDatasource(datasource: InfiniteDatasource<TRowData>, blockSize?: number): void;
	setServerSideDatasource(datasource: ServerSideDatasource<TRowData>): void;
	refreshServerSide(options?: ServerSideRefreshOptions): void;
	purgeServerSide(options?: Omit<ServerSideRefreshOptions, 'purge'>): void;
	getServerSideStoreState(): readonly ServerSideStoreSnapshot[];
	getCellValue(rowId: string, colField: string): unknown;
	getFormula(rowId: string, colField: string): string | undefined;
	hasFormula(rowId: string, colField: string): boolean;
	setFormula(rowId: string, colField: string, formula: string): void;
	clearFormula(rowId: string, colField: string): void;
	setCellValue(rowId: string, colField: string, value: unknown): GridWriteResult;
	setCellValueAsync(rowId: string, colField: string, value: unknown): Promise<GridWriteResult>;
	batchCellValues(updates: BatchCellValueUpdate[], source?: 'paste' | 'api' | 'fill'): GridWriteResult;
	batchCellValuesAsync(updates: BatchCellValueUpdate[], source?: 'paste' | 'api' | 'fill'): Promise<GridWriteResult>;
	getRowNode(rowId: string): GridRowNode<TRowData> | undefined;
	getDisplayedRowAtIndex(index: number): GridRowNode<TRowData> | undefined;
	getRowIndexById(rowId: string): number | undefined;
	forEachNode(callback: (node: GridRowNode<TRowData>, index: number) => void): void;
	forEachDisplayedNode(callback: (node: GridRowNode<TRowData>, index: number) => void): void;
	getRowLoadState(index: number): RowLoadState;
	getRawRowById(rowId: string): TRowData | null;
	rows(): GridRowsAccessor<TRowData>;
}

export interface GridSelectionEditingApi<TRowData = unknown> {
	selectCell(pointer: GridCellPointer | null, source?: GridSelectionSource): void;
	selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource): void;
	extendSelection(end: GridCellPointer, source?: GridSelectionSource): void;
	applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null;
	selectRows(rowIds: string[], options?: SelectRowsOptions): void;
	deselectRows(rowIds: string[]): void;
	toggleRowSelection(rowId: string): void;
	selectAllRows(options?: SelectAllRowsOptions): void;
	clearRowSelection(): void;
	getSelectedRowIds(): string[];
	isRowNodeSelected(rowId: string): boolean;
	getSelectedRowCount(): number;
	startEditing(rowId: string, colFieldOrInstanceId: string, source?: 'keyboard' | 'mouse' | 'api'): void;
	updateEditDraft(rowId: string, colFieldOrInstanceId: string, value: unknown): void;
	stopEditing(cancel?: boolean): void;
	commitEdit(rowId: string, colFieldOrInstanceId: string, value: unknown): Promise<boolean>;
}

export interface GridStructureApi<TRowData = unknown> {
	setColumns(columns: ColumnDef<TRowData>[]): void;
	setColumnWidth(colField: string, width: number): void;
	autoSizeColumn(colField: string, options?: AutoSizeColumnOptions): void;
	autoSizeAllColumns(options?: AutoSizeAllColumnsOptions): void;
	copySelectedRange(): Promise<void>;
	pasteFromClipboard(): Promise<void>;
	copyRange(minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void>;
	setColumnVisible(colField: string, visible: boolean): void;
	setColumnsVisible(colFields: string[], visible: boolean): void;
	getColumns(): ColumnDef<TRowData>[];
	getDisplayedColumns(): ColumnDef<TRowData>[];
	setPinnedColumns(pins: { left?: number; right?: number }): void;
	getPinnedColumns(): { left: number; right: number };
	moveColumn(colField: string, toIndex: number): void;
	setColumnOrder(colFields: string[]): void;
	setColumnReorderEnabled(enabled: boolean): void;
	setRowHeight(rowId: string, height: number): void;
	setSortModel(sortModel: SortModel | null): void;
	setFilterModel(filterModel: FilterModel | null): void;
	getQuickFilter(): QuickFilterModel | null;
	/** Search a single string across multiple columns (or every column). See `QuickFilterModel`. */
	setQuickFilter(text: string, columnIds?: string[]): void;
	getQueryModel(): GridQueryModel | null;
	setQueryModel(model: GridQueryModel | null): void;
	clearQueryModel(): void;
	evaluateQueryForRow(rowId: string): boolean;
	getColumnDistinctValues(colField: string): (string | number | null)[];
	getColumnDistinctValueSummary(colField: string): GridDistinctValueSummary;
	setStyleRules(styleRules: GridStyleRule<TRowData>[] | undefined): void;
	setGroupBy(colIds: string[]): void;
	getGroupBy(): string[];
	addGroupBy(colId: string, atIndex?: number): void;
	removeGroupBy(colId: string): void;
	moveGroupBy(colId: string, toIndex: number): void;
	setAggDefs(defs: AggregationDef<TRowData>[]): void;
	getAggDefs(): AggregationDef<TRowData>[];
	expandAllGroups(): void;
	collapseAllGroups(): void;
	setShowGroupFooter(enabled: boolean): void;
	setStickyGroupRows(enabled: boolean): void;
	setShowGroupPanel(enabled: boolean): void;
	setShowFloatingFilters(enabled: boolean): void;
	setShowFilterChipBar(enabled: boolean): void;
	toggleGroupExpanded(groupId: string): void;
	toggleDetailExpanded(rowId: string): void;
	isGroupExpanded(groupId: string): boolean;
	isDetailExpanded(rowId: string): boolean;
	getVisibleColumnRange(): { colStart: number; colEnd: number; total: number };
	getColumnState(): ColumnState[];
	applyColumnState(states: ColumnState[], opts?: { applyOrder?: boolean }): void;
	getGridState(): PersistedGridState;
	applyGridState(state: PersistedGridState): void;
	getColumnIndex(colField: string): number;
	getColumnField(colIndex: number): string | null;
	getColumnDef(colField: string): ColumnDef<TRowData> | undefined;
	scrollToRow(rowId: string, options?: ScrollToRowOptions): void;
	scrollToCell(rowId: string, colField: string, options?: ScrollToCellOptions): void;
}

export interface ScrollToRowOptions {
	/** Select the row in the row-selection model after scrolling. No-op if row selection is not configured. */
	select?: boolean;
}

export interface ScrollToCellOptions {
	/** Set the cell as the active selection after scrolling. */
	select?: boolean;
	/** Open the cell editor after scrolling. Implies `select`. */
	edit?: boolean;
}

export interface GridRuntimeSubscriptionApi<TRowData = unknown> {
	addEventListener<K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	): () => void;
	dispatchEvent<K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void;
	subscribe(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToKey<K extends keyof GridStateSnapshot<TRowData>>(key: K, listener: GridSnapshotKeyListener<TRowData, K>): () => void;
	subscribeToSnapshotSelector<K extends keyof GridStateSnapshot<TRowData>, TValue>(
		keys: readonly K[],
		selector: GridSnapshotSelector<TRowData, TValue>,
		listener: GridSnapshotSelectorListener<TValue>,
		isEqual?: GridSnapshotSelectorEquality<TValue>
	): () => void;
	subscribeToIntegrity(listener: (integrity: GridIntegrityState<TRowData>) => void): () => void;
	subscribeToCell(rowId: string, colField: string, listener: () => void): () => void;
	subscribeToDomainVersions(listener: (v: GridDomainVersions) => void): () => void;
	subscribeDomain(domain: keyof GridDomainVersions, listener: (version: number) => void): () => void;
	getRuntimeFaults(): RuntimeFault[];
	clearRuntimeFaults(): void;
	flushCellUpdatesSync(): void;
	getInstrumentation(): GridInstrumentation;
	setInstrumentation(inst: GridInstrumentation): void;
	getTheme(): ThemeTokens;
	getThemeName(): BuiltInThemeName | null;
	getAvailableThemes(): BuiltInThemeName[];
	switchTheme(themeName: string): void;
	mergeTheme(partial: Partial<ThemeTokens>): void;
	/** Apply a full, self-composed theme (e.g. `{ ...getBuiltInTheme('light'), focusRing: '#...' }`). */
	setTheme(theme: ThemeTokens): void;
	onThemeChange(listener: (theme: ThemeTokens) => void): () => void;
	getContainer(): HTMLElement | null;
	getInsightDiagnostics(): Record<string, unknown>;
}

export interface GridPersistenceWorkspaceApi {
	hasPersistence(): boolean;
	clearPersistedState(): void | Promise<void>;
	setAutoSave(enabled: boolean): void;
	isAutoSaveEnabled(): boolean;
	getPersistenceStatus(): PersistenceStatus;
	subscribeToPersistenceStatus(listener: (status: PersistenceStatus) => void): () => void;
	saveNow(): void;
	hasWorkspace(): boolean;
	getWorkspaceState(): GridWorkspaceState;
	subscribeToWorkspaceState(listener: (state: GridWorkspaceState) => void): () => void;
	listViews(): Promise<readonly GridViewDefinition[]>;
	saveView(name: string, options?: SaveViewOptions): Promise<GridViewDefinition>;
	updateView(id: string, state?: PersistedGridState): Promise<void>;
	applyView(id: string): Promise<void>;
	deleteView(id: string): Promise<void>;
	duplicateView(id: string, name: string): Promise<GridViewDefinition>;
	renameView(id: string, name: string): Promise<void>;
	setDefaultView(id: string | null): Promise<void>;
}

export interface GridDiagnosticsCapabilityApi<TRowData = unknown> {
	integrity: GridIntegrityApi<TRowData>;
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	openPanel(panelId: string): void;
	closePanel(): void;
	togglePanel(panelId: string): void;
	getOpenPanel(): string | null;
	openChart(): void;
	closeChart(): void;
	toggleChart(): void;
	isChartOpen(): boolean;
	exportCsv(options?: CsvExportOptions): void;
	can(action: GridCapabilityAction, params?: Partial<GridCapabilityParams<TRowData>>): GridCapabilityResult;
	canEdit(rowId: string, colField: string): boolean;
	canCopy(rowId?: string, colField?: string): boolean;
	canPaste(rowId?: string, colField?: string): boolean;
	canExport(colField?: string): boolean;
	destroy(): void;
}

export interface GridApi<TRowData = unknown>
	extends
		GridDataApi<TRowData>,
		GridSelectionEditingApi<TRowData>,
		GridStructureApi<TRowData>,
		GridRuntimeSubscriptionApi<TRowData>,
		GridPersistenceWorkspaceApi,
		GridDiagnosticsCapabilityApi<TRowData> {}

export interface GridPluginRuntime<TRowData = unknown> extends GridApi<TRowData> {
	getCellState(rowId: string, colField: string): CellState;
	getCellAccessByPointer(pointer: GridCellPointer): GridCellAccess<TRowData> | null;
	getCheapDisplayValue(rowId: string, colField: string): string;
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualIndexByRowId(rowId: string): number | null;
	getVisibleRowRange(): { startIdx: number; endIdx: number };
	getColumnIndex(colField: string): number;
	getColumnField(colIndex: number): string | null;
	getRowModel(): import('../rowModel.js').RowModel<TRowData> | null;
	reportRuntimeFault(fault: RuntimeFaultInput): RuntimeFault;
}

export interface GridPluginController<TRowData = unknown> {
	registerPlugin(plugin: GridPlugin<TRowData>): void;
	getPlugin<T = unknown>(name: string): T | null;
	unregisterPlugin(name: string): void;
}

export interface GridRendererApi<TRowData = unknown> extends GridApi<TRowData> {
	getCachedDisplayValue(rowId: string, colField: string): string | undefined;
	getCheapDisplayValue(rowId: string, colField: string): string;
	getComputedCellValue(rowId: string, colField: string): unknown;
	getCellState(rowId: string, colField: string): CellState;
	getCellStateByPointer(pointer: GridCellPointer): CellState | null;
	getCellAccess(rowId: string, colField: string): GridCellAccess<TRowData> | null;
	getCellAccessByPointer(pointer: GridCellPointer): GridCellAccess<TRowData> | null;
	getRowOverscanPx(): number;
	setRowOverscanPx(px: number): void;
	getVisualRow(index: number): VisualRow<TRowData> | null;
	getVisualRowCount(): number;
	getVisualIndexById(visualRowId: string): number | null;
	getVisualIndexByRowId(rowId: string): number | null;
	subscribeToViewport(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToSelection(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToFocusedCell(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToEditingCell(listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToCell(rowId: string, colField: string, listener: () => void): () => void;
	subscribeToRow(rowId: string, listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToColumn(colField: string, listener: GridSnapshotListener<TRowData>): () => void;
	subscribeToHeaders(listener: GridSnapshotListener<TRowData>): () => void;
}

export interface GridHostRuntime<TRowData = unknown> {
	getRenderStats(): RenderStats;
	resetRenderStats(): void;
	setViewportPins(pins: { left?: number; right?: number; top?: number; bottom?: number }): void;
	setViewportSize(width: number, height: number): boolean;
	updateVisibleRanges(): boolean;
	bindRuntimePorts(ports: GridRuntimePorts): RuntimePortBindResult;
	unbindRuntimePorts(binding: RuntimePortBinding): void;
	isBindingCurrent(binding: RuntimePortBinding): boolean;
}

export interface GridCompositionRuntime<TRowData = unknown> {
	registerRowModel(rowModel: import('../rowModel.js').RowModel<TRowData>): void;
	getRowModel(): import('../rowModel.js').RowModel<TRowData> | null;
	triggerCellNotifications(rowId: string): void;
	batchedUpdates: boolean;
	registerCellSubscription(sub: CellSubscription): void;
	unregisterCellSubscription(sub: CellSubscription): void;
	updateCellSubscription(sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void;
	flushCellUpdatesSync(): void;
}

export interface InternalGridApi<TRowData = unknown> extends GridRendererApi<TRowData>, GridHostRuntime<TRowData>, GridCompositionRuntime<TRowData> {}
