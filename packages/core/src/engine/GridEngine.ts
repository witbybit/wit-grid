import type { RowAnimationOptions } from '../renderer/rowAnimation.js';
import { canEditCell, isCellSelectable } from '../visualRow.js';
import { AsyncTransactionQueue } from './AsyncTransactionQueue.js';
import { GridEventName } from '../api/GridEvents.js';
import type { GridEventListener, GridEventPayloadMap } from '../api/GridEvents.js';
import type {
	CanonicalGridCellPointer,
	CellSubscription,
	GridCellPointer,
	GridCellRange,
	GridSelectionSource,
	GridWriteRejection,
	GridWriteResult,
	GridTransactionResult,
	RowDataTransaction,
	RowNodeTransaction,
	RowSelectionChangeResult,
	RowSelectionGesture,
	RowSelectionGestureSource,
	RowSelectionScope,
} from '../api/GridApi.js';
import {
	areCanonicalCellPointersEqual,
	findColumnByCanonicalCellPointer,
	findColumnByCellPointer,
	resolveCanonicalCellPointer,
} from '../interaction/cellPointer.js';
import { buildInteractionState } from '../interaction/interactionState.js';
import { getColumnInstanceIdentity, type ColumnDef, type GridRendererOptions } from '../columnDef.js';
import type { GridIntegrityState, InternalGridState, Listener } from '../state/GridState.js';
import {
	asAllDataNodesCapableRowModel,
	asInfiniteControllableRowModel,
	asRowOrderCapableModel,
	asRowExpansionStateReadableModel,
	asServerSideControllableRowModel,
	type RowModel,
	type RowModelRefreshResult,
	type VisualRowModel,
} from '../rowModel.js';
import type { RowNode } from '../rowNode.js';
import { StateManager } from '../state/StateManager.js';
import { CommandHistory } from '../commands/CommandHistory.js';
import { EventBus } from '../events/EventBus.js';
import { DataModel } from '../models/DataModel.js';
import { ColumnModel } from '../models/ColumnModel.js';
import { ViewportModel } from '../models/ViewportModel.js';
import { GeometryModel } from '../models/GeometryModel.js';
import { SelectionModel } from '../models/SelectionModel.js';
import { CellAccessModel } from '../models/CellAccess.js';
import { mapInternalRowNodeTransaction } from './publicRowNodeDispatch.js';
import type { InternalRowNodeTransaction } from '../rowTransactions.js';
import { DagEngine, type FormulaCellCoordinate } from '../calculations/dagEngine.js';
import { SpreadsheetFillEngine } from '../spreadsheet/fillRange.js';
import type { GridEngineConfig } from './GridEngineConfig.js';
import type { SortModel, FilterModel, QuickFilterModel } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import { InvalidationManager, type GridInvalidationReason } from '../renderer/invalidationManager.js';
import { GridCommitKernel } from './GridChangeApplier.js';
import type { GridCommitEvent } from './GridChangeApplier.js';
import { ColumnFeatureController } from '../features/ColumnFeatureController.js';
import { GroupingFeatureController } from '../features/GroupingFeatureController.js';
import { EditingFeatureController } from '../features/EditingFeatureController.js';
import { RowSelectionFeatureController } from '../features/RowSelectionFeatureController.js';
import { DataMutationController } from '../features/DataMutationController.js';
import { GridStateFeatureController } from '../features/GridStateFeatureController.js';
import { CellNotificationController } from './CellNotificationController.js';
import { createDefaultGridDomainMutationExecutorRegistry } from './GridDomainMutation.js';
import { GridProjectionPipeline } from './GridProjectionPipeline.js';
import { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import { ColumnAutoSizeController } from '../features/ColumnAutoSizeController.js';
import type { AutoSizeColumnOptions, AutoSizeAllColumnsOptions } from '../features/ColumnAutoSizeController.js';
import { ClipboardController } from '../features/ClipboardController.js';
import type { GridDistinctValueSummary } from '../distinctValues.js';
import { computeDistinctValueSummary } from '../distinctValues.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import { type GridInstrumentation, NOOP_INSTRUMENTATION } from '../diagnostics/GridInstrumentation.js';
import { GridCapabilityManager } from '../capabilities/GridCapabilityManager.js';

import { GridInsightRegistry } from '../insights/GridInsightRegistry.js';
import { GridDataIntegrityManager } from '../features/dataIntegrity/GridDataIntegrityManager.js';
import { createGridIntegrityRowProvider, type GridIntegrityRowModelKind } from '../features/dataIntegrity/GridIntegrityRowProvider.js';
import { defaultGridScheduler } from '../renderer/gridScheduler.js';
import type { LayoutTransitionReason } from '../renderer/layoutTransitionController.js';
import type { GridMutationRejection } from './GridDomainMutation.js';
import type { GridCommitResult as InternalGridCommitResult } from './GridChangeApplier.js';
import { GridDomainSubscriptionHub } from './GridDomainSubscriptionHub.js';
import { normalizeInitialActiveEdit, normalizeInitialSelection } from './normalizeInitialInteractionState.js';
import { CellDisplaySnapshotStore, type CellDisplaySnapshot } from '../renderer/cellDisplaySnapshot.js';
import { RowCtrlStore } from '../renderer/controllers/RowCtrlStore.js';
import type { RowsUpdatedDispatchPayload } from './runtimePorts.js';
import { mapRowsUpdatedDispatchPayload, type PublicRowNodeDispatchDeps } from './publicRowNodeDispatch.js';
import { GridFlightRecorder } from '../diagnostics/GridFlightRecorder.js';
import { withHierarchyColumnFor } from '../rows/hierarchyColumn.js';
import { createHierarchyTextResolver } from '../rows/hierarchyText.js';
import {
	freezeAggregationConfig,
	freezeDetailConfig,
	freezeGroupingConfig,
	freezeTreeDataConfig,
	isGroupingActive,
} from '../rows/hierarchyConfig.js';
import { RenderRequestCoordinator } from './RenderRequestCoordinator.js';
import type { GridApi, GridCellWrite } from '../api/GridApi.js';
import type { GridCommit } from './GridChangeApplier.js';
import type { AppliedDomainMutation, GridDomainMutation } from './GridDomainMutation.js';
import type { GroupDef } from '../rows/hierarchyConfig.js';
import type { CellValueChangeResult } from '../features/DataMutationController.js';
import type { GridIntegrityIssue } from '../features/dataIntegrity/integrityTypes.js';

export type ManagedRowDragBlockReason =
	| 'unsupported-row-model'
	| 'sort-active'
	| 'filter-active'
	| 'group-active'
	| 'tree-active'
	| 'pagination-active';

export type ManagedRowDragPolicyResult =
	| { allowed: true }
	| {
			allowed: false;
			reason: ManagedRowDragBlockReason;
			message: string;
	  };

/** Next frame by default (through the grid scheduler); a fixed delay when waitMs is set. */
function scheduleAsyncTransactionFlush(flush: () => void, waitMs: number | undefined): () => void {
	if (waitMs === undefined) {
		const id = defaultGridScheduler.raf(flush);
		return () => defaultGridScheduler.cancelRaf(id);
	}
	const id = defaultGridScheduler.timeout(flush, waitMs);
	return () => defaultGridScheduler.clearTimeout(id);
}

export class GridEngine<TRowData = unknown> {
	public readonly data: DataModel<TRowData>;
	public readonly columns: ColumnModel<TRowData>;
	public readonly viewport: ViewportModel<TRowData>;
	public readonly geometry: GeometryModel;
	public readonly selection: SelectionModel;
	public readonly cellAccess: CellAccessModel<TRowData>;
	public readonly stateManager: StateManager<TRowData>;
	public readonly commandHistory: CommandHistory;
	public readonly eventBus: EventBus<TRowData>;
	public readonly runtimeFaults: RuntimeFaultReporter<TRowData>;
	public readonly flightRecorder = new GridFlightRecorder();
	public readonly invalidation: InvalidationManager;
	public readonly changeApplier: GridCommitKernel<TRowData>;
	public readonly columnFeature: ColumnFeatureController<TRowData>;
	public readonly columnAutoSize: ColumnAutoSizeController<TRowData>;
	public readonly clipboard: ClipboardController<TRowData>;
	public readonly groupingFeature: GroupingFeatureController<TRowData>;
	public readonly editingFeature: EditingFeatureController<TRowData>;
	public readonly rowSelectionFeature: RowSelectionFeatureController<TRowData>;
	public readonly dataMutation: DataMutationController<TRowData>;
	public readonly stateFeature: GridStateFeatureController<TRowData>;
	private readonly formulas: DagEngine;
	private readonly spreadsheetFill: SpreadsheetFillEngine<TRowData>;
	private readonly projectionPipeline: GridProjectionPipeline<TRowData>;
	public readonly capabilityManager: GridCapabilityManager<TRowData>;
	public readonly insights: GridInsightRegistry;
	public dataIntegrity: GridDataIntegrityManager<TRowData> | null = null;

	// Lazy api ref — set by store after api object is created
	private _apiRef: GridApi<TRowData> | null = null;
	public setApiRef(api: GridApi<TRowData>): void {
		this._apiRef = api;
	}
	/** The grid's public api, handed to DOM cell renderers. Throws before the api exists. */
	public getApiRef(): GridApi<TRowData> {
		if (!this._apiRef) throw new Error('Grid api is not available yet');
		return this._apiRef;
	}
	private getDistinctValueSourceNodes(): RowNode<TRowData>[] {
		return asAllDataNodesCapableRowModel(this.rowModel)?.getAllDataNodes() ?? [];
	}

	private rowModel: RowModel<TRowData> | null = null;

	public geometryVersion = 0;
	public rowModelVersion = 0;
	public columnVersion = 0;
	public selectionVersion = 0;
	public editingVersion = 0;
	public filteringVersion = 0;
	public sortingVersion = 0;

	/** Active instrumentation sink. Defaults to noop; call setInstrumentation() to swap in a recording sink. */
	public instrumentation: GridInstrumentation = NOOP_INSTRUMENTATION;

	public setInstrumentation(inst: GridInstrumentation): void {
		this.instrumentation = inst;
		this.stateManager.instrumentation = inst;
	}

	private readonly domainSubscriptions: GridDomainSubscriptionHub;

	/** Returns a snapshot of all formal domain version counters. */
	public getDomainVersions(): GridDomainVersions {
		return {
			columns: this.columnVersion,
			rows: this.rowModelVersion,
			geometry: this.geometryVersion,
			selection: this.selectionVersion,
			editing: this.editingVersion,
			filtering: this.filteringVersion,
			sorting: this.sortingVersion,
			styling: 0,
		};
	}

	/** Subscribes to domain version changes. Returns an unsubscribe function. */
	public subscribeToDomainVersions(listener: (v: GridDomainVersions) => void): () => void {
		return this.domainSubscriptions.subscribeToDomainVersions(listener);
	}

	/** Subscribes to version increments for a single domain. Returns an unsubscribe function. */
	public subscribeDomain(domain: keyof GridDomainVersions, listener: (version: number) => void): () => void {
		return this.domainSubscriptions.subscribeDomain(domain, listener);
	}

	private notifyDomainVersionListeners(domains?: readonly (keyof GridDomainVersions)[]): void {
		if (domains) this.domainSubscriptions.publish(domains);
	}

	public incrementDomain(domain: keyof GridDomainVersions): void {
		this.publishDomains([domain]);
	}

	public publishDomains(domains: readonly (keyof GridDomainVersions)[]): void {
		if (domains.length === 0) return;
		const uniqueDomains = Array.from(new Set(domains));
		for (const domain of uniqueDomains) {
			switch (domain) {
				case 'columns':
					this.columnVersion++;
					break;
				case 'rows':
					this.rowModelVersion++;
					break;
				case 'geometry':
					this.geometryVersion++;
					break;
				case 'selection':
					this.selectionVersion++;
					break;
				case 'editing':
					this.editingVersion++;
					break;
				case 'filtering':
					this.filteringVersion++;
					break;
				case 'sorting':
					this.sortingVersion++;
					break;
				case 'styling':
					break;
			}
		}
		this.notifyDomainVersionListeners(uniqueDomains);
	}

	// Per-row version map for zero-allocation mutation tracking.
	public readonly rowVersions = new Map<string, number>();
	public readonly cellDisplaySnapshots = new CellDisplaySnapshotStore();
	/** Owns RowCtrl/CellCtrl semantic identity — see controllers/RowCtrlStore.ts. */
	public readonly rowCtrls = new RowCtrlStore<TRowData>();
	/** Grid-wide scroll presentation policy — see columnDef.ts's GridRendererOptions. */
	public readonly rendererOptions: GridRendererOptions | undefined;
	/** Current row animation options; read when an animation starts, so a change applies to the next one. */
	public rowAnimation: RowAnimationOptions | undefined;

	private _scrollStateProvider: { isScrolling(): boolean; phase: string } | null = null;

	/** Set once by the renderer during initialization; headless grids return false. */
	public setScrollStateProvider(provider: { isScrolling(): boolean; phase: string }): void {
		this._scrollStateProvider = provider;
	}

	public get isScrolling(): boolean {
		return this._scrollStateProvider?.isScrolling() ?? false;
	}

	public get isScrollFrameActive(): boolean {
		return this._scrollStateProvider?.phase === 'scroll-frame';
	}

	public getCellValueCallsDuringScroll = 0;
	public valueGetterCallsDuringScroll = 0;
	public formulaCallsDuringScroll = 0;
	public customRendererMountsDuringScroll = 0;
	public customRendererHydrationChunks = 0;
	public customRendererWarmHits = 0;
	public customRendererWarmMisses = 0;

	private readonly cellNotifications: CellNotificationController<TRowData>;
	private readonly renderRequests: RenderRequestCoordinator<TRowData>;

	private readonly getContainerElement: () => HTMLElement | null;

	constructor(config: GridEngineConfig<TRowData>) {
		this.getContainerElement = config.getContainerElement ?? (() => null);
		this.rendererOptions = config.rendererOptions;
		this.rowAnimation = config.rendererOptions?.rowAnimation;
		this.asyncTransactionWaitMs = config.asyncTransactionWaitMs;
		this.eventBus = new EventBus<TRowData>();
		this.renderRequests = new RenderRequestCoordinator(this.eventBus);
		// Sweep RowCtrl/CellCtrl identity, rowVersions and valueGetter cache entries for rows
		// permanently removed by a transaction or by setRows (RowDataStore.replaceRows reports the
		// ids that disappeared). cellDisplaySnapshots are not swept here.
		this.eventBus.addEventListener(GridEventName.rowsUpdated, (event) => {
			const removedNodes = event.payload.removedNodes;
			if (!removedNodes || removedNodes.length === 0) return;
			for (const node of removedNodes) {
				this.rowCtrls.delete(node.id);
				// Per-row caches keyed by id would otherwise grow without bound under add/remove
				// churn; a re-added row with the same id also must not see stale valueGetter results.
				this.rowVersions.delete(node.id);
				this.data.clearValueGetterCache(node.id);
			}
		});
		// Data integrity follows every row-level write (setRows, sync and async transactions, their
		// undo): changed and added rows are re-validated after commit, removed rows lose their issues.
		this.eventBus.addEventListener(GridEventName.rowsUpdated, (event) => {
			if (!this.dataIntegrity) return;
			const changed = event.payload.changedNodes ?? [];
			const added = event.payload.addedNodes ?? [];
			const removed = event.payload.removedNodes ?? [];
			// Populating an empty grid (its first rows arriving) is data loading, not a write to re-validate.
			const isInitialLoad =
				changed.length === 0 &&
				removed.length === 0 &&
				added.length > 0 &&
				asRowOrderCapableModel(this.rowModel)?.getSourceRowCount?.() === added.length;
			const rowIds = isInitialLoad ? [] : [...changed, ...added].map((node) => node.id);
			const removedRowIds = removed.map((node) => node.id);
			if (rowIds.length === 0 && removedRowIds.length === 0) return;
			void this.dataIntegrity.validateRowsAfterWrite(rowIds, removedRowIds).catch((error) => {
				this.runtimeFaults.report({
					source: 'grid-change',
					operation: 'auto-validate-row-writes',
					error,
					context: { changed: rowIds.length, removed: removedRowIds.length },
				});
			});
		});
		this.runtimeFaults = new RuntimeFaultReporter<TRowData>({
			emit: (fault) => this.eventBus.dispatchEvent(GridEventName.runtimeFault, fault),
			observe: (fault) =>
				this.flightRecorder.record(() => ({
					type: 'fault',
					source: fault.source,
					operation: fault.operation,
					message: fault.message,
				})),
		});
		this.eventBus.setRuntimeFaultReporter(this.runtimeFaults);
		this.commandHistory = new CommandHistory(this.runtimeFaults);
		this.invalidation = new InvalidationManager();
		this.insights = new GridInsightRegistry();
		this.domainSubscriptions = new GridDomainSubscriptionHub({ getDomainVersions: () => this.getDomainVersions() });
		this.formulas = new DagEngine();
		this.spreadsheetFill = new SpreadsheetFillEngine(this);

		this.geometry = new GeometryModel();
		this.data = new DataModel<TRowData>({
			getState: () => this.stateManager.getState(),
			getRowModel: () => this.rowModel,
			getColumnDef: (colField) => this.columns.getColumnDef(colField),
			hasFormula: (rowId, colField) => this.hasFormula(rowId, colField),
			getFormula: (rowId, colField) => this.getFormula(rowId, colField),
			getCachedFormulaValue: (rowId, colField) => this.getCachedFormulaValue(rowId, colField),
			evaluateFormulaCell: (rowId, colField, getRawValue) => this.evaluateFormulaCell(rowId, colField, getRawValue),
			syncFormulaForCell: (rowId, colField, value) => this.syncFormulaForCell(rowId, colField, value),
			isScrolling: () => this.isScrolling,
			isScrollFrameActive: () => this.isScrollFrameActive,
			recordGetCellValueDuringScroll: () => {
				this.getCellValueCallsDuringScroll++;
			},
			recordValueGetterDuringScroll: () => {
				this.valueGetterCallsDuringScroll++;
			},
			recordFormulaDuringScroll: () => {
				this.formulaCallsDuringScroll++;
			},
		});
		this.columns = new ColumnModel<TRowData>({
			geometry: this.geometry,
			updateCompiledGetters: (columns) => this.data.updateCompiledGetters(columns),
			getPinnedColumnCounts: () => ({
				left: this.viewport.pinLeftColumns,
				right: this.viewport.pinRightColumns,
			}),
			getGeometryVersion: () => this.geometryVersion,
		});
		this.viewport = new ViewportModel<TRowData>();
		this.selection = new SelectionModel();
		this.cellAccess = new CellAccessModel<TRowData>({
			getRowModel: () => this.rowModel,
			getRowId: (row) => this.data.getRowId(row),
			getRawRowById: (rowId) => this.rowModel?.getRawRowById(rowId) ?? null,
			getColumnIndex: (colField) => this.columns.getColumnIndex(colField),
			getColumnDef: (colField) => this.columns.getColumnDef(colField),
			getColumnIndexByFieldOrInstanceId: (fieldOrInstanceId) => {
				const column = this.columns.getColumnByFieldOrInstanceId(fieldOrInstanceId);
				return column ? this.columns.getIndexMapper().idToVisualIndex(column.instanceId) : -1;
			},
			getColumnByFieldOrInstanceId: (fieldOrInstanceId) => this.columns.getColumnByFieldOrInstanceId(fieldOrInstanceId),
			getCellValue: (rowId, colField) => this.data.getCellValue(rowId, colField),
			getRawCellValue: (rowId, colField) => this.data.getRawCellValue(rowId, colField),
			getState: () => this.stateManager.getState(),
			isRowSelected: (rowIndex) => this.selection.isRowSelected(rowIndex),
			isRowLoading: (rowId) => this.data.isRowLoading(rowId),
			isDetailOpen: (rowId) => asRowExpansionStateReadableModel(this.rowModel)?.isDetailOpen(rowId) ?? false,
			selectRows: (rowIds, options) => {
				if (options?.mode === 'replace') this.replaceRowIds(rowIds, 'api');
				else this.selectRowIds(rowIds, 'api');
			},
			deselectRows: (rowIds) => this.deselectRowIds(rowIds, 'api'),
			scrollToRow: () => {},
			setCellValue: (rowId, field, value) => this.setCellValue(rowId, field, value),
			refreshRows: () => this.rowModel?.refresh(),
			getRowModelType: () =>
				asServerSideControllableRowModel(this.rowModel) ? 'server' : asInfiniteControllableRowModel(this.rowModel) ? 'infinite' : 'client',
		});
		this.cellNotifications = new CellNotificationController<TRowData>({
			data: this.data,
			eventBus: this.eventBus,
			invalidation: this.invalidation,
			requestRender: (reason) => this.requestRender(reason),
			rowVersions: this.rowVersions,
			faultReporter: this.runtimeFaults,
		});
		this.projectionPipeline = new GridProjectionPipeline<TRowData>({
			data: this.data,
			columns: this.columns,
			geometry: this.geometry,
			viewport: this.viewport,
			selection: this.selection,
			cellNotifications: this.cellNotifications,
			getRowModel: () => this.rowModel,
			syncRowGeometry: (rowModel, rowHeightsRecord, defaultRowHeight) => this.syncRowGeometryFrom(rowModel, rowHeightsRecord, defaultRowHeight),
			notifyCellChange: (rowId, colField, includeRenderInvalidation, renderColId) =>
				this.notifyCellChange(rowId, colField, includeRenderInvalidation, renderColId),
		});

		const initialSelection = normalizeInitialSelection(
			config.selection ?? null,
			config.columns,
			(pointer, columns) => this.resolveCanonicalCellPointer(pointer, columns),
			() => this.selection.createCellSelection(null, 'program'),
			(pointer, source) => this.selection.createCellSelection(pointer, source),
			(start, end, source) => this.selection.createSelectionRange(start, end, source)
		);
		const initialActiveEdit = normalizeInitialActiveEdit(config.activeEdit ?? null, config.columns, (pointer, columns) =>
			this.resolveCanonicalCellPointer(pointer, columns)
		);

		// Set initial state
		const initialState: InternalGridState<TRowData> = {
			columns: config.columns || [],
			selection: initialSelection,
			selectedRowIds: config.selectedRowIds ?? [],
			rowSelection: config.rowSelection,
			rowHeights: config.rowHeights || {},
			columnWidths: config.columnWidths || {},
			defaultRowHeight: config.defaultRowHeight || 40,
			defaultColWidth: config.defaultColWidth || 100,
			enableColumnReorder: config.enableColumnReorder ?? true,
			activeEdit: initialActiveEdit,
			sortModel: config.sortModel || null,
			filterModel: config.filterModel || null,
			quickFilterModel: config.quickFilterModel || null,
			queryModel: config.queryModel || null,
			themeName: config.themeName ?? 'dark',
			themeOverrides: config.themeOverrides,
			globalVersion: 0,
			visibleRowRange: { startIdx: 0, endIdx: 0 },
			visibleColRange: { startIdx: 0, endIdx: 0 },
			getRowId: config.getRowId,
			loading: config.loading,
			loadingSkeletonCount: config.loadingSkeletonCount,
			styleRules: config.styleRules,

			// Tree / Grouping / Master-Detail State
			grouping: freezeGroupingConfig(config.grouping),
			treeData: freezeTreeDataConfig(config.treeData),
			aggregation: freezeAggregationConfig(config.aggregation),
			detail: freezeDetailConfig(config.detail),
			hierarchyColumn: config.hierarchyColumn,
			pinnedColumns: config.pinnedColumns,
			showGroupPanel: config.showGroupPanel,
			showFilterChipBar: config.showFilterChipBar,
			showFloatingFilters: config.showFloatingFilters,
			showStatusBar: config.showStatusBar,
			pagination: config.pagination,
			expansion: config.expansion ?? { rows: {}, details: {} },
			rowOverscanPx: config.rowOverscanPx ?? 400,
			colBuffer: config.colBuffer ?? 2,
			colOverscanPx: config.colOverscanPx,
			runtimeLimits: config.runtimeLimits,
			overscanAdaptive: config.overscanAdaptive,
			interaction: buildInteractionState({
				selection: initialSelection,
				activeEdit: initialActiveEdit,
				selectedRowIds: config.selectedRowIds ?? [],
			}),
			integrity: _createEmptyIntegrityState<TRowData>(),
		};

		this.stateManager = new StateManager<TRowData>(initialState, undefined, this.runtimeFaults, this.instrumentation);
		const capCfg = config.capabilities ?? (config.canPerformAction ? { canPerformAction: config.canPerformAction } : {});
		this.capabilityManager = new GridCapabilityManager<TRowData>(
			capCfg,
			() => this.stateManager.getState().columns,
			(rowId) => this.rowModel?.getRawRowById(rowId) ?? null
		);

		this.changeApplier = new GridCommitKernel<TRowData>({
			beforeCommit: () => this.asyncTransactions.flush(),
			stateManager: this.stateManager,
			invalidation: this.invalidation,
			eventBus: this.eventBus,
			dispatchEvent: (type, payload) => {
				if (type === GridEventName.rowsUpdated) {
					this.dispatchRowsUpdated(payload as RowsUpdatedDispatchPayload<TRowData>);
					return;
				}
				this.dispatchEvent(type, payload as GridEventPayloadMap<TRowData>[typeof type]);
			},
			commandHistory: this.commandHistory,
			requestRender: (reason, changeId) => this.requestRender(reason, changeId),
			commitContext: {
				getState: () => this.stateManager.getState(),
				getRowModel: () => this.rowModel,
				getCellValue: (rowId, colField) => this.data.getCellValue(rowId, colField),
				getRawCellValue: (rowId, colField) => this.data.getRawCellValue(rowId, colField),
				getStoredCellValue: (rowId, colField) => this.data.getStoredCellValue(rowId, colField),
				getColumnDef: (colField) => this.columns.getColumnDef(colField),
				applyCellValueChange: (rowId, colField, value, options) => this.dataMutation.applyCellValueChange(rowId, colField, value, options),
				applyStructuralWriteEffects: (writeResult) => this.dataMutation.applyStructuralWriteEffects(writeResult),
				publishCommittedCellChanges: (changes) => this.publishCommittedCellChanges(changes),
				requestLayoutTransitionCapture: (reason) => this.requestLayoutTransitionCapture(reason),
				syncRowGeometryFrom: (startIndex) => {
					this.syncRowGeometry(startIndex);
				},
			},
			domainMutationExecutorRegistry: createDefaultGridDomainMutationExecutorRegistry<TRowData>(),
			publishDomains: (domains) => this.publishDomains(domains),
			projectStateChange: (phase) => this.projectionPipeline.run({ phase }),
			faultReporter: this.runtimeFaults,
			flightRecorder: this.flightRecorder,
		});

		const featureContext = {
			columns: this.columns,
			getState: () => this.stateManager.getState(),
			applyChange: (change: GridCommit<TRowData>) => this.changeApplier.commit(change),
		};
		this.columnFeature = new ColumnFeatureController<TRowData>(featureContext);
		this.columnAutoSize = new ColumnAutoSizeController<TRowData>({
			getState: () => this.stateManager.getState(),
			columns: this.columns,
			data: this.data,
			columnFeature: this.columnFeature,
			getRowModel: () => this.rowModel,
			getContainerElement: () => this.getContainerElement(),
		});
		this.clipboard = new ClipboardController<TRowData>({
			getState: () => this.stateManager.getState(),
			getDisplayedColumns: () => this.columns.getDisplayedColumns(),
			getVisualRow: (idx) => this.rowModel?.getVisualRow(idx) ?? null,
			getVisualIndexByRowId: (id) => this.rowModel?.getVisualIndexByRowId(id) ?? null,
			getCellValue: (rowId, colField) => this.data.getCellValue(rowId, colField),
			getCheapDisplayValue: (rowId, colField) => this.data.getCheapDisplayValue(rowId, colField),
			getRawRowById: (rowId) => this.rowModel?.getRawRowById(rowId) ?? null,
			writeCells: (updates, source) => this.transaction({ cells: updates, source }),
			dispatchEvent: (type, payload) => this.eventBus.dispatchEvent(type, payload),
			validateWriteProposal: (updates, source) => this.dataIntegrity?.validateWriteProposal(updates, source) ?? Promise.resolve([]),
			checkCapability: (action, p) => this.capabilityManager.can(action, p),
			recordRejectedWrite: (reason, cell) => this.flightRecorder.recordRejectedWrite(reason, cell),
			hierarchyCellText: createHierarchyTextResolver<TRowData>({
				getState: () => this.stateManager.getState(),
				getColumn: (field) => this.columns.getColumnByFieldOrInstanceId(field),
				getCellValue: (rowId, field) => this.data.getCellValue(rowId, field),
			}),
		});
		this.groupingFeature = new GroupingFeatureController<TRowData>({
			ctx: featureContext,
			getRowModel: () => this.rowModel,
			invalidation: this.invalidation,
			requestRender: (reason) => this.requestRender(reason),
			checkCapability: (action, p) => this.capabilityManager.can(action, p),
		});
		this.editingFeature = new EditingFeatureController<TRowData>({
			ctx: featureContext,
			getRowModel: () => this.rowModel,
			data: this.data,
			notifyCellChange: (rowId, colField, includeRenderInvalidation, renderColId) =>
				this.notifyCellChange(rowId, colField, includeRenderInvalidation, renderColId),
			validateCommittedCells: (cells, source) => this.dataIntegrity?.validateCommittedCells(cells, source) ?? Promise.resolve(),
			validateWriteProposal: (updates, source) => this.dataIntegrity?.validateWriteProposal(updates, source) ?? Promise.resolve([]),
			checkCapability: (action, p) => this.capabilityManager.can(action, p),
			dispatchEvent: (type, payload) => this.eventBus.dispatchEvent(type, payload),
			recordRejectedWrite: (reason, cell) => this.flightRecorder.recordRejectedWrite(reason, cell),
		});
		this.rowSelectionFeature = new RowSelectionFeatureController<TRowData>(featureContext, () => this.rowModel);
		this.stateFeature = new GridStateFeatureController<TRowData>({
			stateManager: this.stateManager,
			applyChange: (change) => this.changeApplier.commit(change),
			getRowModel: () => this.rowModel,
			checkCapability: (action, p) => this.capabilityManager.can(action, p),
		});
		this.dataMutation = new DataMutationController<TRowData>({
			data: this.data,
			columns: this.columns,
			getRowModel: () => this.rowModel,
			syncFormulaForCell: (rowId, colField, value) => this.syncFormulaForCell(rowId, colField, value),
			invalidateFormulaCell: (rowId, colField) => this.invalidateFormulaCell(rowId, colField),
		});

		if (config.dataIntegrity) {
			const diFeatureCtx = {
				columns: this.columns,
				getState: () => this.stateManager.getState(),
				applyChange: (change: GridCommit<TRowData>) => this.changeApplier.commit(change),
			};
			// The provider refines this from the attached row model's capabilities.
			const modelType: GridIntegrityRowModelKind = 'client';
			const rowProvider = createGridIntegrityRowProvider<TRowData>({
				getRowModel: () => this.rowModel,
				getState: () => this.stateManager.getState(),
				rowModelKind: modelType,
			});

			this.dataIntegrity = new GridDataIntegrityManager<TRowData>(config.dataIntegrity, {
				ctx: diFeatureCtx,
				data: this.data,
				getRowModel: () => this.rowModel,
				getApi: () => this._apiRef!,
				scheduler: defaultGridScheduler,
				rowProvider,
				capabilityManager: this.capabilityManager,
				commitCells: (updates) => this.transaction({ cells: updates as GridCellWrite[] }),
				applyRowPatch: (rowId, patch) => {
					const row = this.rowModel?.getRawRowById(rowId);
					if (!row) {
						return {
							status: 'rejected',
							reason: 'row unavailable in current row-model scope',
						} as const;
					}
					const updated = { ...row, ...patch };
					return this.toGridWriteResult(
						this.changeApplier.commit({
							reason: 'rows:apply-transaction',
							domainMutations: [{ kind: 'row-transaction', transaction: { update: [updated] } }],
						})
					);
				},
				requestIntegrityRepaint: (request) => {
					if (request.cells && request.cells.length > 0) {
						for (const { rowId, colField } of request.cells) {
							this.notifyCellChange(rowId, colField);
						}
					} else {
						this.requestInsightRepaint();
					}
				},
			});
			this.insights.register(this.dataIntegrity);
		}

		this.viewport.init(this);
		this.geometry.init();
		this.selection.init();

		if (config.columns) {
			this.columns.updateColumns(config.columns, config.columnWidths || {}, config.defaultColWidth);
		}
	}

	public setData(payload: { columns?: ColumnDef<TRowData>[]; defaultColWidth?: number; defaultRowHeight?: number }): void {
		const domains: Array<keyof GridDomainVersions> = [];
		if (payload.columns !== undefined || payload.defaultColWidth !== undefined) domains.push('columns');
		if (payload.defaultRowHeight !== undefined) domains.push('geometry');
		this.changeApplier.apply({
			reason: 'columns:set-data',
			state: (state) => ({ ...state, ...payload, ...(payload.columns ? withHierarchyColumnFor(payload.columns, state) : {}) }),
			invalidations: [{ kind: 'full', reason: 'set data' }],
			domains,
			requestRender: true,
		});
		this.commandHistory.clear();
	}

	public getState(): InternalGridState<TRowData> {
		return this.stateManager.getState();
	}

	public initializeRowModelState(model: {
		columns?: InternalGridState<TRowData>['columns'];
		getRowId?: ((row: TRowData) => string) | undefined;
	}): void {
		const nextState: Partial<InternalGridState<TRowData>> = {};
		if (model.columns) Object.assign(nextState, withHierarchyColumnFor(model.columns, this.stateManager.getState()));
		if (model.getRowId !== undefined) nextState.getRowId = model.getRowId;
		if (Object.keys(nextState).length === 0) return;
		this.changeApplier.apply({
			reason: 'rows:initialize-model',
			state: nextState,
			requestRender: false,
		});
	}

	public bumpRowModelGlobalVersion(): void {
		this.changeApplier.apply({
			reason: 'rows:bump-global-version',
			state: (state) => ({ globalVersion: state.globalVersion + 1 }),
			domains: ['rows'],
			requestRender: false,
		});
	}

	public applyRowModelRefreshInvalidation(
		refreshResult: RowModelRefreshResult | void,
		options: {
			invalidationReason: GridInvalidationReason;
			requestRenderReason?: string;
			includeHeaders?: boolean;
			includeOverlay?: boolean;
			groupId?: string;
		}
	): void {
		const changed = refreshResult?.changed === true;
		if (!changed && !options.includeHeaders && !options.includeOverlay) return;

		const reason = refreshResult?.layoutTransitionHint === 'live-reorder' ? 'sort' : options.invalidationReason;
		const targetGroupId = refreshResult?.groupId ?? options.groupId;
		if (targetGroupId) {
			this.invalidation.invalidateGroup(targetGroupId, reason);
		}
		if (refreshResult?.changedStartIndex !== undefined && refreshResult.changedEndIndex !== undefined) {
			this.invalidation.invalidateRowRange(refreshResult.changedStartIndex, refreshResult.changedEndIndex, reason);
		}
		for (const index of refreshResult?.aggregateChangedIndices ?? []) this.invalidation.invalidateRowRange(index, index, reason);
		if (refreshResult && refreshResult.previousRowCount !== refreshResult.nextRowCount) {
			this.invalidation.invalidateGeometry(reason);
		}
		if (changed) {
			this.invalidation.invalidateViewport(reason);
		}
		if (options.includeHeaders) {
			this.invalidation.invalidateHeaders(reason);
		}
		if (options.includeOverlay) {
			this.invalidation.invalidateOverlay(reason);
		}
		this.requestRender(options.requestRenderReason ?? String(reason));
	}

	public requestLayoutTransitionCapture(reason: LayoutTransitionReason): void {
		this.eventBus.dispatchEvent(GridEventName.layoutTransitionCaptureRequested, { reason });
	}

	public getManagedRowDragPolicy(): ManagedRowDragPolicyResult {
		const state = this.stateManager.getState();
		if (!asRowOrderCapableModel(this.rowModel)) {
			return {
				allowed: false,
				reason: 'unsupported-row-model',
				message: 'Managed row drag requires a client row model with row-order support.',
			};
		}
		if (state.sortModel && state.sortModel.length > 0) {
			return {
				allowed: false,
				reason: 'sort-active',
				message: 'Managed row drag is blocked while sort is active.',
			};
		}
		if (state.filterModel && Object.keys(state.filterModel).length > 0) {
			return {
				allowed: false,
				reason: 'filter-active',
				message: 'Managed row drag is blocked while filters are active.',
			};
		}
		if (isGroupingActive(state.grouping)) {
			return {
				allowed: false,
				reason: 'group-active',
				message: 'Managed row drag is blocked while grouping is active.',
			};
		}
		if (state.treeData) {
			return {
				allowed: false,
				reason: 'tree-active',
				message: 'Managed row drag is blocked while tree data is active.',
			};
		}
		if (state.pagination) {
			return {
				allowed: false,
				reason: 'pagination-active',
				message: 'Managed row drag is blocked while pagination is active.',
			};
		}
		return { allowed: true };
	}

	public setRowOrder(rowIds: string[], emitEvent = true, reason: 'rows:set-order' | 'rows:drag-reorder' = 'rows:set-order'): GridWriteResult {
		return this.toGridWriteResult(
			this.changeApplier.commit({
				reason,
				domainMutations: [{ kind: 'row-order', rowIds, emitEvent, reason }],
			})
		);
	}

	/** Queued async transactions; flushed before any other commit, so writes land in call order. */
	private readonly asyncTransactions = new AsyncTransactionQueue<TRowData>({
		apply: (item) => this.applyQueuedTransaction(item),
		getRowId: (row) => this.getRowId(row),
		schedule: (flush) => scheduleAsyncTransactionFlush(flush, this.asyncTransactionWaitMs),
	});
	private asyncTransactionWaitMs: number | undefined;

	/**
	 * The one data write: row deltas and cell writes commit atomically as one change (one undo entry,
	 * one repaint of what changed). Cell writes are validated first (preflight policy) and go through
	 * each column's value setter and formulas; rows are validated after commit (data integrity).
	 */
	public transaction(transaction: GridEngineTransaction<TRowData>): GridTransactionResult<TRowData> {
		return this.commitTransaction(transaction, true);
	}

	/**
	 * Async transaction: awaits async validation of its cell writes, then queues it to commit before
	 * the next frame, merged with other queued row-only transactions into one commit and one render.
	 * Resolves once committed (or rejected by validation).
	 */
	public async transactionAsync(transaction: GridEngineTransaction<TRowData>): Promise<GridTransactionResult<TRowData>> {
		const cells = transaction.cells ?? [];
		if (cells.length > 0) {
			const failure = await this.validateWriteProposalAsync(toWriteProposals(cells), transaction.source ?? 'api');
			if (failure) return withNoTransactionChanges<TRowData>(failure, cells, failure.status === 'rejected' ? failure.reason : 'rejected');
		}
		return new Promise((resolve) => this.asyncTransactions.enqueue(transaction, resolve));
	}

	/** Commits queued async transactions now. */
	public flushTransactions(): void {
		this.asyncTransactions.flush();
	}

	private applyQueuedTransaction(transaction: GridEngineTransaction<TRowData>): GridTransactionResult<TRowData> {
		if (!transaction.applyState) return this.commitTransaction(transaction, false);
		let result: GridTransactionResult<TRowData> | undefined;
		this.batch(() => {
			transaction.applyState!();
			result = this.commitTransaction(transaction, false);
		});
		return result!;
	}

	private commitTransaction(transaction: GridEngineTransaction<TRowData>, preflight: boolean): GridTransactionResult<TRowData> {
		const source = transaction.source ?? 'api';
		const cells = transaction.cells ?? [];
		const rows = transaction.rows;
		const hasRows = !!rows && !!(rows.add?.length || rows.update?.length || rows.remove?.length);
		if (preflight && cells.length > 0) {
			const failure = this.validateWriteProposalSync(toWriteProposals(cells), source);
			if (failure) return withNoTransactionChanges<TRowData>(failure, cells, failure.status === 'rejected' ? failure.reason : 'rejected');
		}
		if (!hasRows && cells.length === 0) return withNoTransactionChanges<TRowData>({ status: 'noop' }, [], '');
		const domainMutations: GridDomainMutation<TRowData>[] = [];
		if (hasRows) domainMutations.push({ kind: 'row-transaction', transaction: rows! });
		if (cells.length > 0) domainMutations.push({ kind: 'batch-cell', updates: [...cells], undoable: true, source });
		const execution = this.changeApplier.commitDetailed({
			reason: hasRows && cells.length > 0 ? 'data:transaction' : hasRows ? 'rows:apply-transaction' : 'data:batch-cell-values',
			domainMutations,
		});
		this.scheduleAutoValidationForCommittedWrites(this.collectCommittedWriteCells(execution.appliedMutations), source);

		const rowsResult = hasRows ? (execution.appliedMutations[0]?.result as InternalRowNodeTransaction<TRowData> | undefined) : undefined;
		const cellsResult =
			cells.length > 0 ? (execution.appliedMutations[hasRows ? 1 : 0]?.result as BatchCellCommitSummary | undefined) : undefined;
		return {
			...this.toGridWriteResult(execution.result),
			rows: rowsResult ? mapInternalRowNodeTransaction(this.getPublicRowNodeDispatchDeps(), rowsResult) : EMPTY_ROW_NODE_TRANSACTION,
			cells: {
				committed: (cellsResult?.committed ?? []).map((change) => ({
					rowId: change.rowId,
					colField: change.colField,
					value: change.newRawValue,
				})),
				rejected: (cellsResult?.rejected ?? []).map((entry) => ({ cell: entry.update, reason: entry.reason })),
			},
		} as GridTransactionResult<TRowData>;
	}

	public replaceRows(rows: readonly TRowData[]): GridWriteResult {
		return this.toGridWriteResult(this.changeApplier.commit({ reason: 'rows:replace', domainMutations: [{ kind: 'replace-rows', rows }] }));
	}

	public updateExpansionState(updater: (expansion: InternalGridState<TRowData>['expansion']) => InternalGridState<TRowData>['expansion']): void {
		this.changeApplier.apply({
			reason: 'rows:update-expansion',
			state: (state) => ({ expansion: updater(state.expansion) }),
			requestRender: false,
		});
	}

	public setRowModelLoadingState(loading: boolean): void {
		this.changeApplier.apply({
			reason: 'rows:set-loading-state',
			state: (state) => ({ loading, globalVersion: state.globalVersion + 1 }),
			invalidations: [{ kind: 'viewport', reason: 'loading' }],
			domains: ['rows', 'geometry'],
			requestRender: true,
		});
	}

	public setServerPaginationState(payload: NonNullable<InternalGridState<TRowData>['serverPagination']>): void {
		this.changeApplier.apply({
			reason: 'rows:set-server-pagination',
			state: { serverPagination: payload },
			requestRender: false,
		});
	}

	public setServerSideState(state: NonNullable<InternalGridState<TRowData>['serverSide']>): void {
		this.changeApplier.apply({
			reason: 'rows:set-server-side',
			state: { serverSide: state },
			requestRender: false,
		});
	}
	public publishServerSideState(state: NonNullable<InternalGridState<TRowData>['serverSide']>): void {
		this.setServerSideState(state);
		this.eventBus.dispatchEvent(GridEventName.serverSideStateChanged, state);
	}

	public setVisibleRanges(
		visibleRowRange: InternalGridState<TRowData>['visibleRowRange'],
		visibleColRange: InternalGridState<TRowData>['visibleColRange']
	): void {
		this.changeApplier.apply({
			reason: 'viewport:set-visible-ranges',
			state: { visibleRowRange, visibleColRange },
			invalidations: [{ kind: 'viewport', reason: 'viewport' }],
			requestRender: true,
		});
	}

	public subscribe(listener: Listener<TRowData>): () => void {
		return this.stateManager.subscribe(listener);
	}
	public subscribeToKey(key: string, listener: Listener<TRowData>): () => void {
		return this.stateManager.subscribeToKey(key, listener);
	}
	public subscribeToSelector<TValue>(
		keys: readonly string[],
		selector: (state: InternalGridState<TRowData>) => TValue,
		listener: (value: TValue) => void,
		isEqual?: (left: TValue, right: TValue) => boolean
	): () => void {
		return this.stateManager.subscribeToSelector(keys, selector, listener, isEqual);
	}

	public addEventListener<K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	): () => void {
		return this.eventBus.addEventListener(type, callback);
	}

	public dispatchEvent<K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void {
		this.eventBus.dispatchEvent(type, payload);
	}

	private getPublicRowNodeDispatchDeps(): PublicRowNodeDispatchDeps<TRowData> {
		return {
			getRowId: (row) => this.getRowId(row),
			getRawRowById: (targetRowId) => this.rowModel?.getRawRowById(targetRowId) ?? null,
			getCellValue: (targetRowId, field) => this.data.getCellValue(targetRowId, field),
			getVisualIndexByRowId: (targetRowId) => this.rowModel?.getVisualIndexByRowId(targetRowId) ?? null,
			getVisualRowCount: () => this.rowModel?.getVisualRowCount() ?? 0,
			getSelectedRowIds: () => this.stateManager.getState().selectedRowIds,
			isExpanded: (id) => asRowExpansionStateReadableModel(this.rowModel)?.isExpanded(id) ?? false,
			isDetailOpen: (targetRowId) => asRowExpansionStateReadableModel(this.rowModel)?.isDetailOpen(targetRowId) ?? false,
			selectRows: (rowIds, options) => (options?.mode === 'replace' ? this.replaceRowIds(rowIds, 'api') : this.selectRowIds(rowIds, 'api')),
			deselectRows: (rowIds) => this.deselectRowIds(rowIds, 'api'),
			scrollToRow: () => {},
			setCellValue: (targetRowId, field, value) => this.setCellValue(targetRowId, field, value),
			writeCells: (updates) => this.transaction({ cells: updates as GridCellWrite[] }),
			setExpanded: (id, expanded) => this.groupingFeature.setExpanded(id, expanded),
			setDetailOpen: (rowId, open) => this.groupingFeature.setDetailOpen(rowId, open),
			refreshRows: () => this.rowModel?.refresh(),
			retryRowLoad: (rowIndex, loadState) => {
				if (loadState.kind !== 'failed' || rowIndex == null || !this.rowModel) {
					return { status: 'rejected', reason: 'Row retry is not available for this row.' } as const;
				}
				this.rowModel.ensureRange(rowIndex, rowIndex, 'row-node-retry-load');
				return { status: 'applied', changeId: Date.now(), faults: [] } as const;
			},
			getRowIssues: (rowId) => this.dataIntegrity?.buildApi().getRowIssues(rowId) ?? [],
			validateRow: (rowId) => this.dataIntegrity?.buildApi().validateRow(rowId) ?? Promise.resolve([]),
			getRowModelType: () =>
				asServerSideControllableRowModel(this.rowModel) ? 'server' : asInfiniteControllableRowModel(this.rowModel) ? 'infinite' : 'client',
		};
	}

	public dispatchRowsUpdated(payload: RowsUpdatedDispatchPayload<TRowData>): void {
		this.eventBus.dispatchEvent(GridEventName.rowsUpdated, mapRowsUpdatedDispatchPayload(this.getPublicRowNodeDispatchDeps(), payload));
	}

	public getRowId(row: TRowData): string {
		return this.data.getRowId(row);
	}
	public isRowLoading(rowId: string): boolean {
		return this.data.isRowLoading(rowId);
	}
	public getCellDisplayValue(rowId: string, colField: string): unknown {
		return this.data.getCellValue(rowId, colField);
	}
	public getCachedDisplayValue(rowId: string, colField: string): string | undefined {
		return this.data.getCachedDisplayValue(rowId, colField);
	}
	public primeDisplayValue(rowId: string, colField: string): string | undefined {
		return this.data.primeDisplayValue(rowId, colField);
	}
	public getCellDisplaySnapshot(rowId: string, colFieldOrInstanceId: string): CellDisplaySnapshot | undefined {
		const column = this.columns.getColumnByFieldOrInstanceId(colFieldOrInstanceId);
		return this.cellDisplaySnapshots.get(rowId, column?.instanceId ?? colFieldOrInstanceId);
	}
	public getCheapDisplayValue(rowId: string, colField: string): string {
		return this.data.getCheapDisplayValue(rowId, colField);
	}
	public getComputedCellValue(rowId: string, colField: string): unknown {
		return this.data.getComputedCellValue(rowId, colField);
	}
	public getRawCellValue(rowId: string, colField: string): unknown {
		return this.data.getRawCellValue(rowId, colField);
	}
	public getDisplayedColumns(): ColumnDef<TRowData>[] {
		return this.columns.getDisplayedColumns().slice();
	}
	public getPinnedColumns(): { left: number; right: number } {
		return { left: this.viewport.pinLeftColumns, right: this.viewport.pinRightColumns };
	}
	public getColumnIndex(colField: string): number {
		return this.columns.getColumnIndex(colField);
	}
	public getColumnField(colIndex: number): string | null {
		return this.columns.getColumnField(colIndex);
	}
	public getColumnDef(colField: string): ColumnDef<TRowData> | undefined {
		return this.columns.getColumnDef(colField);
	}
	public getValueGetterDependents(colField: string): string[] {
		return this.columns.getValueGetterDependents(colField);
	}
	public hasValueGetter(colField: string): boolean {
		return this.columns.hasValueGetter(colField);
	}
	public getCompiledPlanVersion(): number {
		return this.columns.getCompiledPlanVersion();
	}
	public isScrollingFast(): boolean {
		return this.viewport.isScrollingFast;
	}
	public getScrollVelocity(): { vx: number; vy: number } {
		return this.viewport.getVelocity();
	}
	public getRowOverscanPx(): number {
		return this.stateFeature.getRowOverscanPx();
	}
	public setRowOverscanPx(px: number): void {
		this.stateFeature.setRowOverscanPx(px);
	}
	public getColBuffer(): number {
		return this.stateFeature.getColBuffer();
	}
	public setColBuffer(colBuffer: number): void {
		this.stateFeature.setColBuffer(colBuffer);
	}

	public selectRange(start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'api'): void {
		this.applySelectionRange(start, end, source);
	}

	public selectCell(pointer: GridCellPointer | null, source: GridSelectionSource = 'api'): void {
		this.applySelectionRange(pointer, pointer, source);
	}

	public resizeColumn(colField: string, width: number, undoable = true): void {
		this.columnFeature.resizeColumn(colField, width, undoable);
	}
	public autoSizeColumn(colField: string, opts?: AutoSizeColumnOptions): void {
		this.columnAutoSize.autoSizeColumn(colField, opts);
	}
	public autoSizeAllColumns(opts?: AutoSizeAllColumnsOptions): void {
		this.columnAutoSize.autoSizeAllColumns(opts);
	}
	public copySelectedRange(): Promise<void> {
		return this.clipboard.copySelectedRange();
	}
	public pasteFromClipboard(): Promise<void> {
		return this.clipboard.pasteFromClipboard();
	}
	public copyRange(minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void> {
		return this.clipboard.copyRange(minRow, maxRow, minCol, maxCol);
	}
	public getColumnDistinctValues(colField: string): (string | number | null)[] {
		return [...this.getColumnDistinctValueSummary(colField).values];
	}
	public getColumnDistinctValueSummary(colField: string): GridDistinctValueSummary {
		return computeDistinctValueSummary(this.getDistinctValueSourceNodes(), colField, {
			maxValues: this.stateManager.getState().runtimeLimits?.maxFilterDistinctValues,
		});
	}
	public moveColumn(colField: string, toIndex: number): void {
		this.columnFeature.moveColumn(colField, toIndex);
	}
	public setColumnOrderByFields(colFields: string[]): void {
		this.columnFeature.setColumnOrderByFields(colFields);
	}
	public setColumnReorderEnabled(enabled: boolean): void {
		this.columnFeature.setColumnReorderEnabled(enabled);
	}
	public setStyleRules(styleRules: InternalGridState<TRowData>['styleRules']): void {
		this.stateFeature.setStyleRules(styleRules);
	}
	public setRowAnimation(options: RowAnimationOptions | undefined): void {
		this.rowAnimation = options;
	}

	public setShowFloatingFilters(enabled: boolean): void {
		this.stateFeature.setShowFloatingFilters(enabled);
	}
	public setShowFilterChipBar(enabled: boolean): void {
		this.stateFeature.setShowFilterChipBar(enabled);
	}
	public setSidebarOpenPanel(panelId: string | null): void {
		this.stateFeature.setSidebarOpenPanel(panelId);
	}
	public setChartOpen(chartOpen: boolean): void {
		this.stateFeature.setChartOpen(chartOpen);
	}
	public setThemeName(themeName: InternalGridState<TRowData>['themeName']): void {
		this.stateFeature.setThemeName(themeName);
	}
	public resizeRow(rowId: string, height: number, undoable = true): void {
		this.stateFeature.resizeRow(rowId, height, undoable);
	}
	/** Internal renderer path for a single delivery of DOM row-height measurements. */
	public applyAutoRowHeightBatch(measuredHeights: ReadonlyMap<string, number>, baseline?: (rowId: string) => number | undefined): void {
		this.stateFeature.applyAutoRowHeightBatch(measuredHeights, baseline);
	}
	public setRowHeights(rowHeights: Record<string, number>): void {
		this.stateFeature.setRowHeights(rowHeights);
	}
	public setDefaultRowHeight(defaultRowHeight: number): void {
		this.stateFeature.setDefaultRowHeight(defaultRowHeight);
	}
	public setSortModel(sortModel: SortModel | null, undoable = true): void {
		this.stateFeature.setSortModel(sortModel, undoable);
	}
	public setFilterModel(filterModel: FilterModel | null, undoable = true): void {
		this.stateFeature.setFilterModel(filterModel, undoable);
	}
	public setQuickFilterModel(quickFilterModel: QuickFilterModel | null): void {
		this.stateFeature.setQuickFilterModel(quickFilterModel);
	}
	public setQueryModel(queryModel: GridQueryModel | null): void {
		this.stateFeature.setQueryModel(queryModel);
	}
	public setPaginationPage(page: number, metrics?: { pageCount: number; totalRows: number }): void {
		this.stateFeature.setPaginationPage(page, metrics);
	}
	public setPinnedColumnsState(left: number, right: number): void {
		this.changeApplier.apply({
			reason: 'columns:set-pinned-counts',
			state: { pinnedColumns: { left, right } },
			invalidations: [
				{ kind: 'geometry', reason: 'pin' },
				{ kind: 'viewport', reason: 'pin' },
				{ kind: 'headers', reason: 'pin' },
			],
			domains: ['columns', 'geometry'],
			requestRender: true,
		});
	}

	public setGroupBy(by: ReadonlyArray<string | GroupDef<TRowData>>): void {
		this.groupingFeature.setGroupBy(by);
	}
	public addGroupBy(colId: string, atIndex?: number): void {
		this.groupingFeature.addGroupBy(colId, atIndex);
	}
	public removeGroupBy(colId: string): void {
		this.groupingFeature.removeGroupBy(colId);
	}
	public moveGroupBy(colId: string, toIndex: number): void {
		this.groupingFeature.moveGroupBy(colId, toIndex);
	}
	public setShowGroupPanel(enabled: boolean): void {
		this.groupingFeature.setShowGroupPanel(enabled);
	}
	public setCellValue(rowId: string, colField: string, value: unknown, undoable = true): GridWriteResult {
		const validationFailure = this.validateWriteProposalSync([{ rowId, colField, proposedValue: value }], 'api');
		if (validationFailure) return validationFailure;

		const execution = this.changeApplier.commitDetailed({
			reason: 'data:set-cell-value',
			domainMutations: [{ kind: 'cell-value', rowId, colField, value, undoable, source: 'api' }],
		});
		this.scheduleAutoValidationForCommittedWrites(this.collectCommittedWriteCells(execution.appliedMutations), 'api');
		return this.toGridWriteResult(execution.result);
	}

	public batchStreamCells(updates: readonly { rowId: string; colField: string; value: unknown }[]): void {
		if (!updates.length) return;
		this.changeApplier.commit({
			reason: 'data:stream-cells',
			domainMutations: [
				{ kind: 'batch-cell', updates: updates as { rowId: string; colField: string; value: unknown }[], undoable: false, source: 'api' },
			],
			historyPolicy: 'suppress',
		});
	}

	public startEdit(rowId: string, colFieldOrInstanceId: string, source: 'keyboard' | 'mouse' | 'api' = 'api'): void {
		this.editingFeature.startEdit(rowId, colFieldOrInstanceId, source);
	}

	public updateEditDraft(rowId: string, colFieldOrInstanceId: string, value: unknown): void {
		this.editingFeature.updateEditDraft(rowId, colFieldOrInstanceId, value);
	}

	public stopEdit(cancel = false): void {
		this.editingFeature.stopEdit(cancel);
	}

	public commitEdit(rowId: string, colFieldOrInstanceId: string, value: unknown): Promise<boolean> {
		return this.editingFeature.commitEdit(rowId, colFieldOrInstanceId, value);
	}

	public registerRowModel(rowModel: RowModel<TRowData>): void {
		this.rowModel = rowModel;
		// Refresh coordinates
		const state = this.stateManager.getState();
		this.syncRowGeometryFrom(rowModel, state.rowHeights, state.defaultRowHeight);
		this.changeApplier.apply({
			reason: 'rows:register-model',
			state: { globalVersion: state.globalVersion + 1 },
			invalidations: [
				{ kind: 'geometry', reason: 'row model registered' },
				{ kind: 'full', reason: 'row model registered' },
			],
			domains: ['rows', 'geometry'],
			requestRender: true,
		});
	}

	public getRowModel(): RowModel<TRowData> | null {
		return this.rowModel;
	}

	/** Renderer-facing row model contract. Renderer paths must use this, not getRowModel(). */
	public getVisualRowModel(): VisualRowModel<TRowData> | null {
		return this.rowModel;
	}

	public clearFormulas(): void {
		this.formulas.clearAll();
	}

	public hasFormula(rowId: string, colField: string): boolean {
		return this.formulas.hasFormula(rowId, colField);
	}

	public getFormula(rowId: string, colField: string): string | undefined {
		return this.formulas.getFormula(rowId, colField);
	}

	public syncFormulaForCell(rowId: string, colField: string, value: unknown): void {
		if (typeof value === 'string' && value.startsWith('=')) {
			this.formulas.registerFormula(rowId, colField, value);
			return;
		}
		this.formulas.clearFormula(rowId, colField);
	}

	public evaluateFormulaCell(rowId: string, colField: string, getRawValue: (rId: string, cField: string) => unknown): unknown {
		return this.formulas.getCellValue(rowId, colField, getRawValue);
	}

	public invalidateFormulaCell(rowId: string, colField: string): FormulaCellCoordinate[] {
		return this.formulas.invalidateCell(rowId, colField);
	}

	public getCachedFormulaValue(rowId: string, colField: string): { hasCached: boolean; value: unknown } {
		return this.formulas.getCachedFormulaValue(rowId, colField);
	}

	/**
	 * Syncs row geometry from the row model straight into the GeometryModel typed arrays
	 * (no intermediate height list). Only rows whose height differs are written, and prefix
	 * sums are recomputed from the first changed index.
	 *
	 * A data row's `state.rowHeights` entry wins over the height baked into its visual row:
	 * the row pipeline snapshots heights when it flattens, so an `api.setRowHeight()` or an
	 * auto-height measurement that lands without a re-flatten must still take effect.
	 * Non-data rows keep their baked height (group/detail/footer heights are pipeline-owned).
	 *
	 * Returns the first changed row index, or -1 when geometry was already current.
	 */
	public syncRowGeometry(fromIndex = 0): number {
		const rowModel = this.rowModel;
		if (!rowModel) return -1;
		const state = this.stateManager.getState();
		return this.syncRowGeometryFrom(rowModel, state.rowHeights, state.defaultRowHeight, fromIndex);
	}

	private syncRowGeometryFrom(
		rowModel: RowModel<TRowData>,
		rowHeightsRecord: Record<string, number>,
		defaultRowHeight: number,
		fromIndex = 0
	): number {
		const state = this.stateManager.getState();
		let count = rowModel.getVisualRowCount();
		if (state.loading && count === 0) {
			count = state.loadingSkeletonCount ?? 15;
		}
		return this.geometry.syncRows(
			count,
			(i) => {
				const row = rowModel.getVisualRow(i);
				if (!row) return defaultRowHeight;
				if (row.kind === 'data') {
					const recorded = rowHeightsRecord[row.rowId];
					if (recorded !== undefined) return recorded;
				} else if (row.kind === 'detail') {
					// A measured `detail.height: 'auto'` row, recorded under its visual id.
					const recorded = rowHeightsRecord[row.id];
					if (recorded !== undefined) return recorded;
				}
				const explicitHeight = row.height ?? rowHeightsRecord[row.id];
				return explicitHeight !== undefined ? explicitHeight : defaultRowHeight;
			},
			fromIndex
		);
	}

	public get batchedUpdates(): boolean {
		return this.cellNotifications.batchedUpdates;
	}

	public set batchedUpdates(enabled: boolean) {
		this.cellNotifications.batchedUpdates = enabled;
	}

	public batch = (callback: () => void): void => {
		this.beginRenderTransaction();
		this.stateManager.startTransaction();
		try {
			callback();
		} finally {
			this.stateManager.endTransaction();
			this.cellNotifications.flushCellUpdatesSync();
			this.endRenderTransaction();
		}
	};

	public scheduleBatchFlush(): void {
		this.cellNotifications.scheduleBatchFlush();
	}

	public flushCellUpdates(): void {
		this.cellNotifications.flushCellUpdates();
	}

	public enqueueCellUpdate(rowId: string, colField: string): void {
		this.cellNotifications.enqueueCellUpdate(rowId, colField);
	}

	public flushCellUpdatesSync(): void {
		this.cellNotifications.flushCellUpdatesSync();
	}

	public notifyBulkCellChange(changes: Map<string, Set<string>>): void {
		this.cellNotifications.notifyBulkCellChange(changes);
	}

	public publishCommittedCellChanges(changes: Map<string, Set<string>>): void {
		if (this.cellNotifications.batchedUpdates) {
			for (const [rowId, fields] of changes) {
				for (const colField of fields) {
					this.cellNotifications.enqueueCellUpdate(rowId, colField);
				}
			}
			this.cellNotifications.scheduleBatchFlush();
			return;
		}
		this.cellNotifications.publishCommittedCellChanges(changes);
	}

	public notifyCellChange(rowId: string, colField: string, includeRenderInvalidation = true, renderColId?: string): void {
		this.cellNotifications.notifyCellChange(rowId, colField, includeRenderInvalidation, renderColId);
	}

	public registerCellSubscription = (sub: CellSubscription): void => {
		this.cellNotifications.registerCellSubscription(sub);
	};

	public unregisterCellSubscription = (sub: CellSubscription): void => {
		this.cellNotifications.unregisterCellSubscription(sub);
	};

	public subscribeToRow = (rowId: string, listener: () => void): (() => void) => {
		return this.cellNotifications.subscribeToRow(rowId, listener);
	};

	public updateCellSubscription = (sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void => {
		this.cellNotifications.updateCellSubscription(sub, oldRowId, oldColField, newRowId, newColField);
	};

	// ── Row node selection ─────────────────────────────────────────────────────

	public applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
		return this.rowSelectionFeature.applyRowSelectionGesture(gesture);
	}

	public selectRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.selectRowIds(rowIds, source);
	}

	public replaceRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.replaceRowIds(rowIds, source);
	}

	public deselectRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.deselectRowIds(rowIds, source);
	}

	public toggleRowId(rowId: string, source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.toggleRowId(rowId, source);
	}

	public selectAllDataRows(source: RowSelectionGestureSource = 'api', scope?: RowSelectionScope, mode?: 'add' | 'replace'): void {
		this.rowSelectionFeature.selectAllDataRows(source, scope, mode);
	}

	public clearRowSelection(source: RowSelectionGestureSource = 'api'): void {
		this.rowSelectionFeature.clearRowSelection(source);
	}

	private applySelectionRange = (start: GridCellPointer | null, end: GridCellPointer | null, source: GridSelectionSource = 'program'): void => {
		const prevSelection = this.stateManager.getState().selection;
		const resolvedStart = this.resolveCanonicalCellPointer(start);
		const resolvedEnd = this.resolveCanonicalCellPointer(end);
		const validStart = this.isDataCellSelectable(resolvedStart) ? resolvedStart : null;
		const validEnd = this.isDataCellSelectable(resolvedEnd) ? resolvedEnd : null;
		const committedSelection = this.selection.createSelectionRange(validStart, validEnd, source);
		const previewSelection = {
			...committedSelection,
			bounds: this.selection.calculateRangeBounds(
				committedSelection.range,
				(id) => this.rowModel?.getVisualIndexByRowId(id) ?? -1,
				(pointer) => {
					if (!pointer.columnInstanceId) return -1;
					const column = findColumnByCanonicalCellPointer(this.columns.getDisplayedColumns(), {
						columnInstanceId: pointer.columnInstanceId,
					});
					return column ? this.columns.getIndexMapper().idToVisualIndex(pointer.columnInstanceId) : -1;
				}
			),
		};
		const events: GridCommitEvent<TRowData>[] = [];
		if (
			!areCanonicalCellPointersEqual(
				this.resolveCanonicalCellPointer(prevSelection.focus),
				this.resolveCanonicalCellPointer(previewSelection.focus)
			)
		) {
			events.push({
				type: GridEventName.focusChanged,
				payload: (state) => ({ focus: state.selection.focus, selection: state.selection }),
			});
		}
		const selectionChange = this.selection.describeChange(prevSelection, previewSelection, this.rowModel, this.columns.getDisplayedColumns());
		const invalidatedCells = selectionChange.invalidatedCells.flatMap((cell) => {
			const column = findColumnByCellPointer(this.columns.getDisplayedColumns(), cell);
			const renderColId = column ? getColumnInstanceIdentity(column) : null;
			return renderColId
				? [
						{
							kind: 'cell' as const,
							rowId: cell.rowId,
							colId: renderColId,
							reason: 'selection' as const,
						},
					]
				: [];
		});
		events.push({
			type: GridEventName.selectionChanged,
			payload: (state) => ({
				selection: state.selection,
				result: selectionChange,
			}),
		});
		const invalidations = [
			...invalidatedCells,
			...selectionChange.invalidatedRows.map((rowId) => ({ kind: 'row' as const, rowId, reason: 'selection' as const })),
			...(selectionChange.overlayChanged ? ([{ kind: 'overlay' as const, reason: 'selection' as const }] as const) : []),
			{ kind: 'headers' as const, reason: 'selection' as const },
		];
		this.changeApplier.apply({
			reason: 'selection:set-range',
			state: { selection: committedSelection },
			invalidations,
			domains: ['selection'],
			events,
		});
	};

	private canEditCell(rowId: string, colField: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return canEditCell(visualRow, this.columns.getColumnDef(colField));
	}

	private isDataCellSelectable(pointer: CanonicalGridCellPointer | null): pointer is CanonicalGridCellPointer {
		if (!pointer) return false;
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(pointer.rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return isCellSelectable(
			visualRow,
			findColumnByCanonicalCellPointer(this.columns.getDisplayedColumns(), { columnInstanceId: pointer.columnInstanceId })
		);
	}

	private resolveCellPointer(pointer: GridCellPointer | null): GridCellPointer | null {
		return this.resolveCanonicalCellPointer(pointer);
	}

	private resolveCanonicalCellPointer(
		pointer: GridCellPointer | null,
		columns: readonly ColumnDef<TRowData>[] = this.columns.getDisplayedColumns()
	): CanonicalGridCellPointer | null {
		return resolveCanonicalCellPointer(columns, pointer);
	}

	public setColumns(columns: ColumnDef<TRowData>[], undoable = false): void {
		this.columnFeature.setColumns(columns, undoable);
	}

	private requestRender(reason: string, changeId?: number): void {
		this.renderRequests.request(reason, changeId);
	}

	public takePendingRenderChangeIds(): readonly number[] {
		return this.renderRequests.takeChangeIds();
	}

	private beginRenderTransaction(): void {
		this.renderRequests.begin();
	}

	private endRenderTransaction(): void {
		this.renderRequests.end();
	}

	public undo(): void {
		this.commandHistory.undo();
	}
	public redo(): void {
		this.commandHistory.redo();
	}
	public fillRange(source: GridCellRange, target: GridCellRange): void {
		this.spreadsheetFill.fillRange(source, target);
	}
	public fillRangeAsync(source: GridCellRange, target: GridCellRange): Promise<GridWriteResult> {
		return this.spreadsheetFill.fillRangeAsync(source, target);
	}
	/** Request a full repaint triggered by an insight layer decoration change. */
	public requestInsightRepaint(): void {
		this.invalidation.invalidateFull('insight-decorations');
		this.eventBus.dispatchEvent(GridEventName.renderInvalidated, { reason: 'insight-decorations' });
	}

	public destroy(): void {
		this.asyncTransactions.destroy();
		this.flightRecorder.destroy();
		this.insights.clear();
		this.cellNotifications.clear();
		this.eventBus.clear();
		this.stateManager.destroy();
		this.domainSubscriptions.clear();
	}

	private toGridWriteResult(result: InternalGridCommitResult): GridWriteResult {
		switch (result.status) {
			case 'committed':
				return {
					status: 'applied',
					changeId: result.changeId,
					faults: result.faults,
					rejections: this.toGridWriteRejections(result.rejectedMutations),
				};
			case 'noop':
				return { status: 'noop' };
			case 'rejected':
				return {
					status: 'rejected',
					reason: result.reason,
					rejections: this.toGridWriteRejections(result.rejections),
				};
			case 'failed-before-commit':
				return { status: 'failed', error: result.fault };
		}
	}

	private toGridWriteRejections(rejections: readonly GridMutationRejection[] | undefined): readonly GridWriteRejection[] | undefined {
		if (!rejections || rejections.length === 0) return undefined;
		return rejections.map((rejection) => ({
			mutationKind: rejection.mutationKind,
			reason: rejection.reason,
			index: rejection.index,
		}));
	}

	private collectCommittedWriteCells(appliedMutations: readonly AppliedDomainMutation<TRowData>[]): GridCellPointer[] {
		const cells: GridCellPointer[] = [];
		for (const mutation of appliedMutations) {
			const result = mutation.result as CellValueChangeResult | { committed?: readonly CellValueChangeResult[] } | undefined;
			if (!result) continue;
			if ('applied' in result) {
				if (result.applied) cells.push({ rowId: result.rowId, colField: result.colField });
				continue;
			}
			for (const committed of result.committed ?? []) {
				if (committed.applied) cells.push({ rowId: committed.rowId, colField: committed.colField });
			}
		}
		return cells;
	}

	private scheduleAutoValidationForCommittedWrites(
		cells: readonly GridCellPointer[],
		source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo'
	): void {
		if (!this.dataIntegrity || cells.length === 0 || !this.dataIntegrity.shouldAutoValidateWrite(source)) return;
		void this.dataIntegrity.validateCommittedCells(cells, source).catch((error) => {
			this.runtimeFaults.report({
				source: 'grid-change',
				operation: 'auto-validate-committed-writes',
				error,
				context: { source, cellCount: cells.length },
			});
		});
	}

	private validateWriteProposalSync(
		updates: readonly { rowId: string; colField: string; proposedValue: unknown }[],
		source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo'
	): GridWriteResult | null {
		if (!this.dataIntegrity || !this.dataIntegrity.shouldPreflightWriteSync(source)) return null;
		const issues = this.dataIntegrity.validateWriteProposalSync(updates, source);
		return issues.length > 0 ? this.toValidationFailedWriteResult(issues) : null;
	}

	private async validateWriteProposalAsync(
		updates: readonly { rowId: string; colField: string; proposedValue: unknown }[],
		source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo'
	): Promise<GridWriteResult | null> {
		if (!this.dataIntegrity || !this.dataIntegrity.shouldPreflightWrite(source)) return null;
		const issues = await this.dataIntegrity.validateWriteProposal(updates, source);
		return issues.length > 0 ? this.toValidationFailedWriteResult(issues) : null;
	}

	private toValidationFailedWriteResult(issues: readonly GridIntegrityIssue[]): GridWriteResult {
		return {
			status: 'validationFailed',
			reason: issues[0]?.message ?? 'blocking validation failed',
			issues,
		};
	}
}

function _createEmptyIntegrityState<TRowData>(): GridIntegrityState<TRowData> {
	return {
		validation: { issues: [], cellErrorIndex: {} },
		quality: { issues: [] },
		diff: { model: null, result: null, cellDiffIndex: {} },
		conflicts: { conflicts: [], cellConflictIndex: {}, resolvedConflicts: 0, lastConflictAt: null },
		liveStream: { issues: [], session: null },
		publishedIssues: {},
		serverReport: null,
		summary: { status: 'clean', totalIssues: 0, blockingIssues: 0, warnings: 0, errors: 0, bySource: {} },
	};
}

/** What the engine commits for a transaction; `applyState` carries grid state set in the same call. */
export interface GridEngineTransaction<TRowData> {
	rows?: RowDataTransaction<TRowData>;
	cells?: readonly GridCellWrite[];
	source?: 'api' | 'paste' | 'fill';
	/** Grid state (columns, sort, filter, pins) applied in the same batch, before the data commit. */
	applyState?: () => void;
}

interface BatchCellCommitSummary {
	committed: readonly { rowId: string; colField: string; newRawValue: unknown }[];
	rejected: readonly { update: GridCellWrite; reason: string }[];
}

const EMPTY_ROW_NODE_TRANSACTION = Object.freeze({ add: [], update: [], remove: [] }) as unknown as RowNodeTransaction<never>;

function toWriteProposals(cells: readonly GridCellWrite[]) {
	return cells.map((cell) => ({ rowId: cell.rowId, colField: cell.colField, proposedValue: cell.value }));
}

function withNoTransactionChanges<TRowData>(
	result: GridWriteResult,
	cells: readonly GridCellWrite[],
	reason: string
): GridTransactionResult<TRowData> {
	return {
		...result,
		rows: EMPTY_ROW_NODE_TRANSACTION,
		cells: { committed: [], rejected: cells.map((cell) => ({ cell, reason })) },
	} as GridTransactionResult<TRowData>;
}
