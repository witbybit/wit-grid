import type { GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import { registerGridRuntimeComposition } from './apiInternalBridge.js';
import { PUBLIC_ENGINE_FORWARD_NAMES } from './engineForwards.js';
import { pickMembers } from './memberNames.js';
import { exportToCsv, toCsv, type CsvExportOptions } from '../export/csvExport.js';
import { exportToXlsx, toXlsxBlob, type ExcelExportOptions } from '../export/xlsxExport.js';
import type { GridStore as GridRuntime } from '../store.js';
import { EMPTY_WORKSPACE_STATE, type GridWorkspaceController } from '../workspace/GridWorkspaceController.js';
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
	RowSelectionGesture,
	SelectAllRowsOptions,
	SelectRowsOptions,
	ScrollToRowOptions,
	ScrollToCellOptions,
} from '../api/GridApi.js';

import type { ColumnDef } from '../columnDef.js';
import type { RowModelCapability } from '../rowModel.js';
import type { ColumnState } from '../state/GridState.js';
import {
	validatePersistedGridState,
	type GridPersistenceAdapter,
	type PersistenceController,
	type PersistenceStatus,
	type PersistedGridState,
} from '../persistence/statePersistence.js';

interface GridRuntimeCompositionOptions<TRowData> {
	runtime: GridRuntime<TRowData>;
	destroy: () => void;
	persistenceAdapter?: GridPersistenceAdapter;
	persistenceController?: PersistenceController;
	workspaceController?: GridWorkspaceController;
}

export function createGridRuntimeComposition<TRowData>({
	runtime,
	destroy,
	persistenceAdapter,
	persistenceController,
	workspaceController,
}: GridRuntimeCompositionOptions<TRowData>): GridApi<TRowData> {
	// Members that are a plain call into the engine are bound once on the runtime; the api shares them.
	const engineForwards: Pick<GridApi<TRowData>, (typeof PUBLIC_ENGINE_FORWARD_NAMES)[number]> = pickMembers(runtime, PUBLIC_ENGINE_FORWARD_NAMES);
	// Excel export carries column widths and the conditional formats.
	const sheetContext = () => {
		const state = runtime.engine.getState();
		return { widths: state.columnWidths, styleRules: state.styleRules };
	};
	const api = {
		...engineForwards,
		getStateSnapshot: () => runtime.getStateSnapshot(),
		getDataRowAtVisualIndex: (index: number) => runtime.getDataRowAtVisualIndex(index),
		setRows: (rows: TRowData[]) => runtime.setRows(rows),
		transaction: runtime.transaction,
		getRowOrder: () => runtime.getRowOrder(),
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
		setFormula: (rowId: string, colField: string, formula: string) => runtime.setFormula(rowId, colField, formula),
		clearFormula: (rowId: string, colField: string) => runtime.clearFormula(rowId, colField),
		selectCell: (pointer: GridCellPointer | null, source?: GridSelectionSource) => runtime.selectCell(pointer, source),
		selectRange: (start: GridCellPointer | null, end: GridCellPointer | null, source?: GridSelectionSource) =>
			runtime.selectRange(start, end, source),
		extendSelection: (end: GridCellPointer, source?: GridSelectionSource) => runtime.extendSelection(end, source),
		setColumns: (columns: ColumnDef<TRowData>[]) => runtime.setColumns(columns),
		copySelectedRange: () => runtime.copySelectedRange(),
		pasteFromClipboard: () => runtime.pasteFromClipboard(),
		setColumnVisible: (colField: string, visible: boolean) => runtime.setColumnVisible(colField, visible),
		setColumnsVisible: (colFields: string[], visible: boolean) => runtime.setColumnsVisible(colFields, visible),
		getColumns: () => runtime.getColumns(),
		setPinnedColumns: (pins: { left?: number; right?: number }) => runtime.setPinnedColumns(pins),
		getQuickFilter: () => runtime.getQuickFilter(),
		setQuickFilter: (text: string, columnIds?: string[]) => runtime.setQuickFilter(text, columnIds),
		setDescendantsSelected: (id: string, selected: boolean) => runtime.setDescendantsSelected(id, selected),
		exportCsv: (options?: CsvExportOptions) => exportToCsv(runtime, options),
		getCsv: (options?: CsvExportOptions) => toCsv(runtime, options),
		exportExcel: (options?: ExcelExportOptions) => exportToXlsx(runtime, sheetContext(), options),
		getExcel: (options?: ExcelExportOptions) => toXlsxBlob(runtime, sheetContext(), options),
		startEditing: (rowId: string, colFieldOrInstanceId: string, source?: 'keyboard' | 'mouse' | 'api') =>
			runtime.startEditing(rowId, colFieldOrInstanceId, source),
		updateEditDraft: (rowId: string, colFieldOrInstanceId: string, value: unknown) => runtime.updateEditDraft(rowId, colFieldOrInstanceId, value),
		stopEditing: (cancel?: boolean) => runtime.stopEditing(cancel),
		commitEdit: (rowId: string, colFieldOrInstanceId: string, value: unknown) => runtime.commitEdit(rowId, colFieldOrInstanceId, value),
		integrity: runtime.integrity,
		getVisibleColumnRange: () => runtime.getVisibleColumnRange(),
		getVisibleRowRange: () => runtime.getVisibleRowRange(),
		applyColumnState: (states: ColumnState[], opts?: { applyOrder?: boolean }) => runtime.applyColumnState(states, opts),
		getGridState: () => runtime.getGridState(),
		applyGridState: (state: PersistedGridState) =>
			persistenceController ? persistenceController.suspendAutoSave(() => runtime.applyGridState(state)) : runtime.applyGridState(state),
		getRawRowById: (rowId: string) => runtime.getRawRowById(rowId),
		// Bound members of the runtime, shared as they are.
		getRowNode: runtime.getRowNode,
		getDisplayedRowAtIndex: runtime.getDisplayedRowAtIndex,
		getRowIndexById: runtime.getRowIndexById,
		getRowLoadState: runtime.getRowLoadState,
		forEachDisplayedNode: runtime.forEachDisplayedNode,
		getSelectedRowCount: runtime.getSelectedRowCount,
		isRowNodeSelected: runtime.isRowNodeSelected,
		evaluateQueryForRow: runtime.evaluateQueryForRow,
		can: runtime.can,
		canEdit: runtime.canEdit,
		canCopy: runtime.canCopy,
		canPaste: runtime.canPaste,
		canExport: runtime.canExport,
		forEachNode: (callback: Parameters<typeof runtime.forEachNode>[0]) => runtime.forEachNode(callback),
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
		closePanel: () => runtime.closePanel(),
		togglePanel: (panelId: string) => runtime.togglePanel(panelId),
		getOpenPanel: () => runtime.getOpenPanel(),
		isChartOpen: () => runtime.isChartOpen(),
		openChart: () => runtime.openChart(),
		closeChart: () => runtime.closeChart(),
		toggleChart: () => runtime.toggleChart(),
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
		getWorkspaceState: (): GridWorkspaceState => workspaceController?.getState() ?? EMPTY_WORKSPACE_STATE,
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
			// A view this grid cannot restore (another schema version, malformed): not applied, not active.
			const invalid = validatePersistedGridState(view.state);
			if (invalid) {
				const error = new Error(`View "${view.name}" could not be applied: ${invalid}`);
				workspaceController.fail('apply view', error);
				throw error;
			}
			if (persistenceController) {
				persistenceController.suspendAutoSave(() => runtime.applyGridState(view.state));
			} else {
				runtime.applyGridState(view.state);
			}
			workspaceController.setActiveView(id, runtime.getGridState());
			runtime.dispatchEvent(GridEventName.viewApplied, { view });
			runtime.dispatchEvent(GridEventName.workspaceStateChanged, { state: workspaceController.getState() });
		},
		revertView: async (): Promise<void> => {
			const baseline = workspaceController?.getBaseline();
			const id = workspaceController?.getState().activeViewId;
			if (!workspaceController || !baseline || !id) return;
			if (persistenceController) persistenceController.suspendAutoSave(() => runtime.applyGridState(baseline));
			else runtime.applyGridState(baseline);
			workspaceController.setActiveView(id, runtime.getGridState());
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
	// Renderers get the public api, not the runtime behind it: DOM cells see what React cells see.
	runtime.engine.setApiRef(frozen);
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
