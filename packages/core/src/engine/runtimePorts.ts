import type { GridEventListener, GridEventPayloadMap } from '../api/GridEvents.js';
import type { GridEventName } from '../api/GridEvents.js';
import type { ColumnDef } from '../columnDef.js';
import type { FormulaCellCoordinate } from '../calculations/dagEngine.js';
import type { GeometryModel } from '../models/GeometryModel.js';
import type { RowModel, RowModelRefreshResult } from '../rowModel.js';
import type { RowNode } from '../rowNode.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RuntimeFault, RuntimeFaultInput } from '../diagnostics/RuntimeFaultReporter.js';
import type { GridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import type { GridInvalidationReason } from '../renderer/invalidationManager.js';
import type { LayoutTransitionReason } from '../renderer/layoutTransitionController.js';
import type { GridWriteResult } from '../api/GridApi.js';
import type { GridUIState } from '../state/GridState.js';

export interface DataModelRuntime<TRowData = unknown> {
	getState: () => InternalGridState<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	getColumnDef: (colField: string) => ColumnDef<TRowData> | undefined;
	hasFormula: (rowId: string, colField: string) => boolean;
	getFormula: (rowId: string, colField: string) => string | undefined;
	getCachedFormulaValue: (rowId: string, colField: string) => { hasCached: boolean; value: unknown };
	evaluateFormulaCell: (rowId: string, colField: string, getRawValue: (rId: string, cField: string) => unknown) => unknown;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	isScrolling: () => boolean;
	isScrollFrameActive: () => boolean;
	recordGetCellValueDuringScroll: () => void;
	recordValueGetterDuringScroll: () => void;
	recordFormulaDuringScroll: () => void;
}

export interface ColumnModelRuntime<TRowData = unknown> {
	geometry: GeometryModel;
	updateCompiledGetters: (columns: ColumnDef<TRowData>[]) => void;
	getPinnedColumnCounts: () => { left: number; right: number };
	getGeometryVersion: () => number;
}

export interface CellAccessRuntime<TRowData = unknown> {
	getRowModel: () => RowModel<TRowData> | null;
	getRowId: (row: TRowData) => string;
	getRawRowById: (rowId: string) => TRowData | null;
	getColumnIndex: (colField: string) => number;
	getColumnDef: (colField: string) => ColumnDef<TRowData> | undefined;
	getColumnIndexByFieldOrInstanceId: (fieldOrInstanceId: string) => number;
	getColumnByFieldOrInstanceId: (fieldOrInstanceId: string) => ColumnDef<TRowData> | undefined;
	getCellValue: (rowId: string, colField: string) => unknown;
	getRawCellValue: (rowId: string, colField: string) => unknown;
	getState: () => InternalGridState<TRowData>;
	isRowSelected: (rowIndex: number) => boolean;
	isRowLoading: (rowId: string) => boolean;
	isDetailOpen: (rowId: string) => boolean;
	selectRows: (rowIds: string[], options?: { mode?: 'add' | 'replace' }) => void;
	deselectRows: (rowIds: string[]) => void;
	scrollToRow: (rowId: string, options?: { select?: boolean }) => void;
	setCellValue: (rowId: string, field: string, value: unknown) => GridWriteResult;
	refreshRows: () => void;
	getRowModelType: () => 'client' | 'infinite' | 'server';
}

export interface RowsUpdatedDispatchPayload<TRowData = unknown> {
	changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
	changedNodes: RowNode<TRowData>[];
	addedNodes?: RowNode<TRowData>[];
	removedNodes?: RowNode<TRowData>[];
}

export interface AsyncRowModelPublication {
	refreshResult: RowModelRefreshResult;
	invalidationReason: GridInvalidationReason;
	requestRenderReason: string;
	includeHeaders?: boolean;
	includeOverlay?: boolean;
	groupId?: string;
}

export interface RowModelRuntimeBase<TRowData = unknown> {
	getState: () => InternalGridState<TRowData>;
	initializeModel: (model: { columns?: ColumnDef<TRowData>[]; getRowId?: ((row: TRowData) => string) | undefined }) => void;
	registerRowModel: (rowModel: RowModel<TRowData>) => void;
	addEventListener: <K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	) => () => void;
	getRowId: (row: TRowData) => string;
	getColumnDef: (colField: string) => ColumnDef<TRowData> | undefined;
	getCellValue: (rowId: string, colField: string) => unknown;
	bumpGlobalVersion: () => void;
	applyRefreshInvalidation: (
		refreshResult: RowModelRefreshResult | void,
		options: {
			invalidationReason: GridInvalidationReason;
			requestRenderReason?: string;
			includeHeaders?: boolean;
			includeOverlay?: boolean;
			groupId?: string;
		}
	) => void;
	publishAsyncRowModelUpdate: (publication: AsyncRowModelPublication) => void;
	reportRowPipelineFault: (operation: string, error: unknown, context?: Record<string, unknown>) => RuntimeFault;
	requestLayoutTransitionCapture?: (reason: LayoutTransitionReason) => void;
	getInstrumentation: () => GridInstrumentation;
}

export interface RowModelMutationRuntime<TRowData = unknown> {
	clearFormulas: () => void;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	invalidateFormulaCell: (rowId: string, colField: string) => FormulaCellCoordinate[];
	getValueGetterDependents: (colField: string) => string[];
	hasValueGetter: (colField: string) => boolean;
	notifyBulkCellChange: (changes: Map<string, Set<string>>) => void;
	dispatchRowsUpdated: (payload: RowsUpdatedDispatchPayload<TRowData>) => void;
}

export interface ClientRowModelRuntime<TRowData = unknown> extends RowModelRuntimeBase<TRowData>, RowModelMutationRuntime<TRowData> {
	updateExpansion: (updater: (expansion: InternalGridState<TRowData>['expansion']) => InternalGridState<TRowData>['expansion']) => void;
}

/** Runtime for the infinite (block/range) row model. */
export interface InfiniteRowModelRuntime<TRowData = unknown> extends RowModelRuntimeBase<TRowData> {
	clearFormulas: () => void;
	isScrollingFast: () => boolean;
	getScrollVelocity: () => { vx: number; vy: number };
	setLoadingState: (loading: boolean) => void;
	dispatchInfiniteBlockLoaded: (payload: GridEventPayloadMap<TRowData>[GridEventName.infiniteBlockLoaded]) => void;
	dispatchInfiniteBlockLoadFailed: (payload: GridEventPayloadMap<TRowData>[GridEventName.infiniteBlockLoadFailed]) => void;
	dispatchPaginationChanged: (payload: GridEventPayloadMap<TRowData>[GridEventName.paginationChanged]) => void;
	reportBlockLoadFailure: (blockIndex: number, error: unknown) => void;
}

/** Runtime for the real server-side row model (SSRM). */
export interface ServerSideRowModelRuntime<TRowData = unknown> extends RowModelRuntimeBase<TRowData> {
	clearFormulas: () => void;
	setLoadingState: (loading: boolean) => void;
	setServerSideState: (state: NonNullable<GridUIState['serverSide']>) => void;
	publishServerSideState: (state: NonNullable<GridUIState['serverSide']>) => void;
}

export interface RowModelRuntimeEngineBridge<TRowData = unknown> {
	initializeRowModelState: (model: { columns?: ColumnDef<TRowData>[]; getRowId?: ((row: TRowData) => string) | undefined }) => void;
	bumpRowModelGlobalVersion: () => void;
	requestLayoutTransitionCapture: (reason: LayoutTransitionReason) => void;
	applyRowModelRefreshInvalidation: (
		refreshResult: RowModelRefreshResult | void,
		options: {
			invalidationReason: GridInvalidationReason;
			requestRenderReason?: string;
			includeHeaders?: boolean;
			includeOverlay?: boolean;
			groupId?: string;
		}
	) => void;
	updateExpansionState: (updater: (expansion: InternalGridState<TRowData>['expansion']) => InternalGridState<TRowData>['expansion']) => void;
	clearFormulas: () => void;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	invalidateFormulaCell: (rowId: string, colField: string) => FormulaCellCoordinate[];
	getValueGetterDependents: (colField: string) => string[];
	hasValueGetter: (colField: string) => boolean;
	notifyBulkCellChange: (changes: Map<string, Set<string>>) => void;
	dispatchRowsUpdated: (payload: RowsUpdatedDispatchPayload<TRowData>) => void;
	isScrollingFast: () => boolean;
	getScrollVelocity: () => { vx: number; vy: number };
	setRowModelLoadingState: (loading: boolean) => void;
	setServerPaginationState: (payload: GridEventPayloadMap<TRowData>[GridEventName.paginationChanged]) => void;
	setServerSideState: (state: NonNullable<GridUIState['serverSide']>) => void;
	publishServerSideState: (state: NonNullable<GridUIState['serverSide']>) => void;
}

export interface RowModelRuntimeStoreBridge<TRowData = unknown> {
	engine: RowModelRuntimeEngineBridge<TRowData>;
	getState: () => InternalGridState<TRowData>;
	registerRowModel: (rowModel: RowModel<TRowData>) => void;
	addEventListener: <K extends keyof GridEventPayloadMap<TRowData>>(
		type: K,
		callback: GridEventListener<GridEventPayloadMap<TRowData>[K]>
	) => () => void;
	getRowId: (row: TRowData) => string;
	getColumnDef: (colField: string) => ColumnDef<TRowData> | undefined;
	getCellValue: (rowId: string, colField: string) => unknown;
	dispatchEvent: <K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]) => void;
	reportRuntimeFault: (fault: RuntimeFaultInput) => RuntimeFault;
	getInstrumentation: () => GridInstrumentation;
}
