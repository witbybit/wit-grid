import type { GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import { registerGridRuntimeComposition } from './apiInternalBridge.js';
import { exportToCsv, type CsvExportOptions } from '../export/csvExport.js';
import type { GridStore as GridRuntime } from '../store.js';
import type { GridWorkspaceController } from '../workspace/GridWorkspaceController.js';
import type { GridViewDefinition, GridWorkspaceState, SaveViewOptions } from '../workspace/workspaceTypes.js';
import { GridEventName } from '../api/GridEvents.js';
import type { InfiniteDatasource } from '../infiniteRowModel.js';
import type { ServerSideDatasource, ServerSideRefreshOptions } from '../serverSideRowModel.js';
import type { ThemeTokens } from '../renderer/themes.js';
import type {
	GridApi,
	GridCellPointer,
	GridSelectionSource,
	GridSnapshotKeyListener,
	GridSnapshotListener,
	GridSnapshotSelector,
	GridSnapshotSelectorEquality,
	GridStateSnapshot,
	RowDataTransaction,
	RowSelectionGesture,
	SelectAllRowsOptions,
	SelectRowsOptions,
	ScrollToRowOptions,
	ScrollToCellOptions,
} from '../api/GridApi.js';
import type { RowNodeTransaction } from '../rowTransactions.js';
import type { ColumnDef } from '../columnDef.js';
import type { FilterModel, SortModel, RowModelCapability } from '../rowModel.js';
import type { ColumnState, GridInitialState } from '../state/GridState.js';
import type { GridPersistenceAdapter, PersistenceController, PersistenceStatus, PersistedGridState } from '../persistence/statePersistence.js';

interface GridRuntimeCompositionOptions<TRowData> {
	runtime: GridRuntime<TRowData>;
	destroy: () => void;
	persistenceAdapter?: GridPersistenceAdapter;
	persistenceController?: PersistenceController;
	workspaceController?: GridWorkspaceController;
}

const _EMPTY_WORKSPACE_STATE: GridWorkspaceState = {
	views: [],
	activeViewId: null,
	defaultViewId: null,
	autoSaveEnabled: true,
	dirty: false,
	lastSavedAt: null,
	lastError: null,
	loading: false,
};

export function createGridRuntimeComposition<TRowData>({
	runtime,
	destroy,
	persistenceAdapter,
	persistenceController,
	workspaceController,
}: GridRuntimeCompositionOptions<TRowData>): GridApi<TRowData> {
	const api = {
		getStateSnapshot: () => runtime.getStateSnapshot(),
		getRowId: (row: TRowData) => runtime.getRowId(row),
		isRowLoading: (rowId: string) => runtime.isRowLoading(rowId),
		getDataRowAtVisualIndex: (index: number) => runtime.getDataRowAtVisualIndex(index),
		setRows: (rows: TRowData[]) => runtime.setRows(rows),
		updateRows: (updater: (rows: TRowData[]) => TRowData[]) => runtime.updateRows(updater),
		applyTransaction: (transaction: RowDataTransaction<TRowData>): RowNodeTransaction<TRowData> | null => runtime.applyTransaction(transaction),
		getRowOrder: () => runtime.getRowOrder(),
		setRowOrder: (rowIds: string[]) => runtime.setRowOrder(rowIds),
		refreshRows: () => runtime.refreshRows(),
		setRowHeights: (rowHeights: Record<string, number> | undefined) => runtime.setRowHeights(rowHeights),
		setDefaultRowHeight: (defaultRowHeight?: number | undefined) => runtime.setDefaultRowHeight(defaultRowHeight),
		getRowModelType: () => runtime.getRowModelType(),
		getRowModelCapabilities: () => runtime.getRowModelCapabilities(),
		supportsRowModelCapability: (capability: RowModelCapability) => runtime.supportsRowModelCapability(capability),
		purgeCache: () => runtime.purgeCache(),
		setInfiniteDatasource: (datasource: InfiniteDatasource<TRowData>, blockSize?: number) => runtime.setInfiniteDatasource(datasource, blockSize),
		setServerSideDatasource: (datasource: ServerSideDatasource<TRowData>) => runtime.setServerSideDatasource(datasource),
		refreshServerSide: (options?: ServerSideRefreshOptions) => runtime.refreshServerSide(options),
		purgeServerSide: (options?: Omit<ServerSideRefreshOptions, 'purge'>) => runtime.purgeServerSide(options),
		getServerSideStoreState: () => runtime.getServerSideStoreState(),
		getCellValue: (rowId: string, colField: string) => runtime.getCellValue(rowId, colField),
		getFormula: (rowId: string, colField: string) => runtime.getFormula(rowId, colField),
		hasFormula: (rowId: string, colField: string) => runtime.hasFormula(rowId, colField),
		setFormula: (rowId: string, colField: string, formula: string) => runtime.setFormula(rowId, colField, formula),
		clearFormula: (rowId: string, colField: string) => runtime.clearFormula(rowId, colField),
		setCellValue: (rowId: string, colField: string, value: unknown) => runtime.setCellValue(rowId, colField, value),
		setCellValueAsync: (rowId: string, colField: string, value: unknown) => runtime.setCellValueAsync(rowId, colField, value),
		batchCellValues: (updates: { rowId: string; colField: string; value: unknown }[], source?: 'paste' | 'api' | 'fill') =>
			runtime.batchCellValues(updates, source),
		batchCellValuesAsync: (updates: { rowId: string; colField: string; value: unknown }[], source?: 'paste' | 'api' | 'fill') =>
			runtime.batchCellValuesAsync(updates, source),
		selectCell: (pointer: GridCellPointer | null, source?: GridSelectionSource) => runtime.selectCell(pointer, source),
		selectRange: (start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource) =>
			runtime.selectRange(start, end, source),
		extendSelection: (end: GridCellPointer, source?: GridSelectionSource) => runtime.extendSelection(end, source),
		setColumns: (columns: ColumnDef<TRowData>[]) => runtime.setColumns(columns),
		setColumnWidth: (colField: string, width: number) => runtime.setColumnWidth(colField, width),
		autoSizeColumn: (colField: string, options?: Parameters<typeof runtime.autoSizeColumn>[1]) => runtime.autoSizeColumn(colField, options),
		autoSizeAllColumns: (options?: Parameters<typeof runtime.autoSizeAllColumns>[0]) => runtime.autoSizeAllColumns(options),
		getColumnDistinctValues: (colField: string) => runtime.getColumnDistinctValues(colField),
		getColumnDistinctValueSummary: (colField: string) => runtime.getColumnDistinctValueSummary(colField),
		copySelectedRange: () => runtime.copySelectedRange(),
		pasteFromClipboard: () => runtime.pasteFromClipboard(),
		copyRange: (minRow: number, maxRow: number, minCol: number, maxCol: number) => runtime.copyRange(minRow, maxRow, minCol, maxCol),
		setColumnVisible: (colField: string, visible: boolean) => runtime.setColumnVisible(colField, visible),
		setColumnsVisible: (colFields: string[], visible: boolean) => runtime.setColumnsVisible(colFields, visible),
		getColumns: () => runtime.getColumns(),
		getDisplayedColumns: () => runtime.getDisplayedColumns(),
		setPinnedColumns: (pins: { left?: number; right?: number }) => runtime.setPinnedColumns(pins),
		getPinnedColumns: () => runtime.getPinnedColumns(),
		moveColumn: (colField: string, toIndex: number) => runtime.moveColumn(colField, toIndex),
		setColumnOrder: (colFields: string[]) => runtime.setColumnOrder(colFields),
		setColumnReorderEnabled: (enabled: boolean) => runtime.setColumnReorderEnabled(enabled),
		setRowHeight: (rowId: string, height: number) => runtime.setRowHeight(rowId, height),
		setSortModel: (sortModel: SortModel | null) => runtime.setSortModel(sortModel),
		setFilterModel: (filterModel: FilterModel | null) => runtime.setFilterModel(filterModel),
		getQuickFilter: () => runtime.getQuickFilter(),
		setQuickFilter: (text: string, columnIds?: string[]) => runtime.setQuickFilter(text, columnIds),
		setGroupBy: (colIds: string[]) => runtime.setGroupBy(colIds),
		getGroupBy: () => runtime.getGroupBy(),
		addGroupBy: (colId: string, atIndex?: number) => runtime.addGroupBy(colId, atIndex),
		removeGroupBy: (colId: string) => runtime.removeGroupBy(colId),
		moveGroupBy: (colId: string, toIndex: number) => runtime.moveGroupBy(colId, toIndex),
		setAggDefs: (defs: Parameters<typeof runtime.setAggDefs>[0]) => runtime.setAggDefs(defs),
		getAggDefs: () => runtime.getAggDefs(),
		expandAllGroups: () => runtime.expandAllGroups(),
		collapseAllGroups: () => runtime.collapseAllGroups(),
		setShowGroupFooter: (enabled: boolean) => runtime.setShowGroupFooter(enabled),
		setStickyGroupRows: (enabled: boolean) => runtime.setStickyGroupRows(enabled),
		setShowGroupPanel: (enabled: boolean) => runtime.setShowGroupPanel(enabled),
		setShowFloatingFilters: (enabled: boolean) => runtime.setShowFloatingFilters(enabled),
		setShowFilterChipBar: (enabled: boolean) => runtime.setShowFilterChipBar(enabled),
		exportCsv: (options?: CsvExportOptions) => exportToCsv(runtime, options),
		setStyleRules: (styleRules: GridInitialState<TRowData>['styleRules']) => runtime.setStyleRules(styleRules),
		addEventListener: runtime.addEventListener,
		dispatchEvent: runtime.dispatchEvent,
		startEditing: (rowId: string, colFieldOrInstanceId: string, source?: 'keyboard' | 'mouse' | 'api') =>
			runtime.startEditing(rowId, colFieldOrInstanceId, source),
		updateEditDraft: (rowId: string, colFieldOrInstanceId: string, value: unknown) => runtime.updateEditDraft(rowId, colFieldOrInstanceId, value),
		stopEditing: (cancel?: boolean) => runtime.stopEditing(cancel),
		commitEdit: (rowId: string, colFieldOrInstanceId: string, value: unknown) => runtime.commitEdit(rowId, colFieldOrInstanceId, value),
		integrity: runtime.integrity,
		getVisibleColumnRange: () => runtime.getVisibleColumnRange(),
		getColumnState: () => runtime.getColumnState(),
		applyColumnState: (states: ColumnState[], opts?: { applyOrder?: boolean }) => runtime.applyColumnState(states, opts),
		getGridState: () => runtime.getGridState(),
		applyGridState: (state: PersistedGridState) =>
			persistenceController ? persistenceController.suspendAutoSave(() => runtime.applyGridState(state)) : runtime.applyGridState(state),
		toggleGroupExpanded: (groupId: string) => runtime.toggleGroupExpanded(groupId),
		toggleDetailExpanded: (rowId: string) => runtime.toggleDetailExpanded(rowId),
		isGroupExpanded: (groupId: string) => runtime.isGroupExpanded(groupId),
		isDetailExpanded: (rowId: string) => runtime.isDetailExpanded(rowId),
		getRawRowById: (rowId: string) => runtime.getRawRowById(rowId),
		applyRowSelectionGesture: (gesture: RowSelectionGesture) => runtime.applyRowSelectionGesture(gesture),
		selectRows: (rowIds: string[], options?: SelectRowsOptions) => runtime.selectRows(rowIds, options),
		deselectRows: (rowIds: string[]) => runtime.deselectRows(rowIds),
		toggleRowSelection: (rowId: string) => runtime.toggleRowSelection(rowId),
		selectAllRows: (options?: SelectAllRowsOptions) => runtime.selectAllRows(options),
		clearRowSelection: () => runtime.clearRowSelection(),
		getSelectedRowIds: () => runtime.getSelectedRowIds(),
		rows: () => runtime.rows(),
		subscribe: (listener: GridSnapshotListener<TRowData>) => runtime.subscribe(listener),
		subscribeToKey: <K extends keyof GridStateSnapshot<TRowData>>(key: K, listener: GridSnapshotKeyListener<TRowData, K>) =>
			runtime.subscribeToKey(key, listener),
		subscribeToSnapshotSelector: <K extends keyof GridStateSnapshot<TRowData>, TValue>(
			keys: readonly K[],
			selector: GridSnapshotSelector<TRowData, TValue>,
			listener: (value: TValue) => void,
			isEqual?: GridSnapshotSelectorEquality<TValue>
		) => runtime.subscribeToSnapshotSelector(keys, selector, listener, isEqual),
		subscribeToIntegrity: (listener: Parameters<typeof runtime.subscribeToIntegrity>[0]) => runtime.subscribeToIntegrity(listener),
		subscribeToCell: (rowId: string, colField: string, listener: () => void) => runtime.subscribeToCell(rowId, colField, listener),
		subscribeToDomainVersions: (listener: Parameters<typeof runtime.subscribeToDomainVersions>[0]) => runtime.subscribeToDomainVersions(listener),
		subscribeDomain: (domain: Parameters<typeof runtime.subscribeDomain>[0], listener: Parameters<typeof runtime.subscribeDomain>[1]) =>
			runtime.subscribeDomain(domain, listener),
		getColumnIndex: (colField: string) => runtime.getColumnIndex(colField),
		getColumnField: (colIndex: number) => runtime.getColumnField(colIndex),
		getColumnDef: (colField: string) => runtime.getColumnDef(colField),
		openPanel: (panelId: string) => runtime.openPanel(panelId),
		closePanel: () => runtime.closePanel(),
		togglePanel: (panelId: string) => runtime.togglePanel(panelId),
		getOpenPanel: () => runtime.getOpenPanel(),
		isChartOpen: () => runtime.isChartOpen(),
		openChart: () => runtime.openChart(),
		closeChart: () => runtime.closeChart(),
		toggleChart: () => runtime.toggleChart(),
		undo: () => runtime.undo(),
		redo: () => runtime.redo(),
		canUndo: () => runtime.canUndo(),
		canRedo: () => runtime.canRedo(),
		hasPersistence: (): boolean => persistenceAdapter !== undefined,
		clearPersistedState: (): void | Promise<void> => persistenceAdapter?.clear?.(),
		setAutoSave: (enabled: boolean): void => persistenceController?.setAutoSave(enabled),
		isAutoSaveEnabled: (): boolean => persistenceController?.isAutoSaveEnabled() ?? true,
		getPersistenceStatus: (): PersistenceStatus => persistenceController?.getStatus() ?? { status: 'idle', autoSave: true },
		subscribeToPersistenceStatus: (listener: (status: PersistenceStatus) => void): (() => void) =>
			persistenceController?.onStatusChange(listener) ?? (() => {}),
		saveNow: (): void => persistenceController?.saveNow(),

		// ── Workspace / named views ───────────────────────────────────────────────
		hasWorkspace: (): boolean => workspaceController !== undefined,
		getWorkspaceState: (): GridWorkspaceState => workspaceController?.getState() ?? _EMPTY_WORKSPACE_STATE,
		subscribeToWorkspaceState: (listener: (state: GridWorkspaceState) => void): (() => void) =>
			workspaceController?.onStateChange(listener) ?? (() => {}),
		listViews: (): Promise<readonly GridViewDefinition[]> => Promise.resolve(workspaceController?.getState().views ?? []),
		saveView: async (name: string, options?: SaveViewOptions): Promise<GridViewDefinition> => {
			if (!workspaceController) throw new Error('[wit-grid] No workspace adapter configured');
			const view = await workspaceController.saveView(name, runtime.getGridState(), options);
			runtime.dispatchEvent(GridEventName.viewSaved, { view });
			runtime.dispatchEvent(GridEventName.workspaceStateChanged, { state: workspaceController.getState() });
			return view;
		},
		updateView: async (id: string, state?: PersistedGridState): Promise<void> => {
			if (!workspaceController) return;
			await workspaceController.updateView(id, state ?? runtime.getGridState());
			runtime.dispatchEvent(GridEventName.workspaceStateChanged, { state: workspaceController.getState() });
		},
		applyView: async (id: string): Promise<void> => {
			if (!workspaceController) return;
			const view = await workspaceController.getView(id);
			if (!view) throw new Error(`[wit-grid] workspace: view "${id}" not found`);
			if (persistenceController) {
				persistenceController.suspendAutoSave(() => runtime.applyGridState(view.state));
			} else {
				runtime.applyGridState(view.state);
			}
			workspaceController.setActiveViewId(id);
			runtime.dispatchEvent(GridEventName.viewApplied, { view });
			runtime.dispatchEvent(GridEventName.workspaceStateChanged, { state: workspaceController.getState() });
		},
		deleteView: async (id: string): Promise<void> => {
			if (!workspaceController) return;
			await workspaceController.deleteView(id);
			runtime.dispatchEvent(GridEventName.viewDeleted, { id });
			runtime.dispatchEvent(GridEventName.workspaceStateChanged, { state: workspaceController.getState() });
		},
		duplicateView: async (id: string, name: string): Promise<GridViewDefinition> => {
			if (!workspaceController) throw new Error('[wit-grid] No workspace adapter configured');
			const view = await workspaceController.duplicateView(id, name);
			runtime.dispatchEvent(GridEventName.workspaceStateChanged, { state: workspaceController.getState() });
			return view;
		},
		renameView: async (id: string, name: string): Promise<void> => {
			if (!workspaceController) return;
			await workspaceController.renameView(id, name);
			runtime.dispatchEvent(GridEventName.viewRenamed, { id, name });
			runtime.dispatchEvent(GridEventName.workspaceStateChanged, { state: workspaceController.getState() });
		},
		setDefaultView: async (id: string | null): Promise<void> => {
			if (!workspaceController) return;
			await workspaceController.setDefaultView(id);
			runtime.dispatchEvent(GridEventName.workspaceStateChanged, { state: workspaceController.getState() });
		},

		getRuntimeFaults: () => runtime.getRuntimeFaults(),
		clearRuntimeFaults: () => runtime.clearRuntimeFaults(),
		getInstrumentation: () => runtime.getInstrumentation(),
		setInstrumentation: (inst: GridInstrumentation) => runtime.setInstrumentation(inst),
		flushCellUpdatesSync: () => runtime.flushCellUpdatesSync(),
		getTheme: () => runtime.getTheme(),
		getThemeName: () => runtime.getThemeName(),
		getAvailableThemes: () => runtime.getAvailableThemes(),
		switchTheme: (themeName: string) => runtime.switchTheme(themeName),
		mergeTheme: (partial: Partial<ThemeTokens>) => runtime.mergeTheme(partial),
		setTheme: (theme: ThemeTokens) => runtime.setTheme(theme),
		onThemeChange: (listener: (theme: ThemeTokens) => void) => runtime.onThemeChange(listener),
		getContainer: () => runtime.getContainerElement(),
		scrollToRow: (rowId: string, options?: ScrollToRowOptions) => runtime.scrollToRow(rowId, options),
		scrollToCell: (rowId: string, colField: string, options?: ScrollToCellOptions) => runtime.scrollToCell(rowId, colField, options),
		getInsightDiagnostics: () => runtime.getInsightDiagnostics(),
		destroy,
	};

	const frozen = Object.freeze(api) as GridApi<TRowData>;
	registerGridRuntimeComposition(frozen, {
		host: {
			engine: runtime.engine,
			api: runtime,
			setContainerElement: (container) => runtime.setContainerElement(container),
		},
		pluginController: runtime.getPluginController(),
		interactionController: runtime.interactionController,
	});
	return frozen;
}
