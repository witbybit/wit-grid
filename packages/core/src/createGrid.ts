import { ClientRowModelController, type ClientRowModelOptions } from './rowModel.js';
import { InfiniteRowModelController, type InfiniteRowModelOptions } from './infiniteRowModel.js';
import { ServerSideRowModelController, type ServerSideRowModelOptions } from './serverSideRowModel.js';
import { GridStore as GridRuntime } from './store.js';
import type { GridApi, RowSelectionMode, RowSelectionOptions } from './api/GridApi.js';
import type { ColumnDef } from './columnDef.js';
import type { GridInitialState } from './state/GridState.js';
import {
	type GridPersistenceAdapter,
	type PersistedGridState,
	type PersistenceController,
	PERSISTED_STATE_KEYS,
	createLocalStorageAdapter,
	createPersistenceSubscription,
} from './persistence/statePersistence.js';
import { defaultGridScheduler, type GridScheduler } from './renderer/gridScheduler.js';
import { createGridRuntimeComposition } from './internal/createGridRuntimeComposition.js';
import type { GridWorkspaceAdapter } from './workspace/workspaceTypes.js';
import { type GridWorkspaceController, createWorkspaceController } from './workspace/GridWorkspaceController.js';
import type { GridCapabilitiesConfig } from './capabilities/capabilityTypes.js';
import type { GridDataIntegrityConfig } from './features/dataIntegrity/integrityTypes.js';

export type { GridPersistenceAdapter, PersistedGridState };
export { createLocalStorageAdapter };
export type { GridWorkspaceAdapter };
export { createWorkspaceController };

export interface ClientGridOptions<TRowData> extends ClientRowModelOptions<TRowData> {
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridInitialState<TRowData>>;
	/**
	 * Enable first-class row selection. When set to `'multiple'`, a built-in checkbox
	 * column is automatically prepended and pinned to the left — no need to add a
	 * `checkboxSelection: true` column manually. Works like AG Grid's `rowSelection` prop.
	 *
	 * @example
	 * useClientGrid({ rows, columns, rowSelection: 'multiple' })
	 */
	rowSelection?: RowSelectionMode | RowSelectionOptions;
	/**
	 * Persistence adapter. Pass `createLocalStorageAdapter(key)` for the built-in
	 * localStorage implementation, or supply your own for remote/API-backed storage.
	 */
	persistence?: string | GridPersistenceAdapter;
	workspace?: GridWorkspaceAdapter;
	/** Grid-level capability rules. Control which actions are allowed per cell, column, or row. */
	capabilities?: GridCapabilitiesConfig<TRowData>;
	/** Unified Data Integrity pipeline — validation, quality, diff, live stream, conflict resolution. */
	dataIntegrity?: GridDataIntegrityConfig<TRowData>;
}

/** Options for creating an infinite (block/range loading) grid. */
export interface InfiniteGridOptions<TRowData> extends InfiniteRowModelOptions<TRowData> {
	initialState?: Partial<GridInitialState<TRowData>>;
	rowSelection?: RowSelectionMode | RowSelectionOptions;
	persistence?: string | GridPersistenceAdapter;
	workspace?: GridWorkspaceAdapter;
	capabilities?: GridCapabilitiesConfig<TRowData>;
	/** Unified Data Integrity pipeline — validation, quality, diff, live stream, conflict resolution. */
	dataIntegrity?: GridDataIntegrityConfig<TRowData>;
}

/** Options for creating a real server-side row model (SSRM) grid. */
export interface ServerSideGridOptions<TRowData> extends ServerSideRowModelOptions<TRowData> {
	readonly columns: Array<ColumnDef<TRowData>>;
	readonly initialState?: Partial<GridInitialState<TRowData>>;
	readonly rowSelection?: RowSelectionMode | RowSelectionOptions;
	readonly persistence?: string | GridPersistenceAdapter;
	readonly workspace?: GridWorkspaceAdapter;
	readonly capabilities?: GridCapabilitiesConfig<TRowData>;
	/** Unified Data Integrity pipeline — validation, quality, diff, live stream, conflict resolution. */
	readonly dataIntegrity?: GridDataIntegrityConfig<TRowData>;
}

function buildColumnWidths<TRowData>(columns: Array<ColumnDef<TRowData>>): Record<string, number> {
	return columns.reduce<Record<string, number>>((acc, column) => {
		if (column.width !== undefined) acc[column.field] = column.width;
		return acc;
	}, {});
}

function normalizeRowSelection(rowSelection?: RowSelectionMode | RowSelectionOptions): RowSelectionOptions | undefined {
	if (!rowSelection) return undefined;
	return typeof rowSelection === 'string' ? { mode: rowSelection, selectAllScope: 'page' } : { selectAllScope: 'page', ...rowSelection };
}

function withRowSelectionColumn<TRowData>(
	columns: Array<ColumnDef<TRowData>>,
	initialState: Partial<GridInitialState<TRowData>>,
	rowSelection?: RowSelectionMode | RowSelectionOptions
): { columns: Array<ColumnDef<TRowData>>; initialState: Partial<GridInitialState<TRowData>> } {
	const normalized = normalizeRowSelection(rowSelection);
	if (!normalized) return { columns, initialState };
	let nextColumns = columns;
	let nextInitial: Partial<GridInitialState<TRowData>> = { ...initialState, rowSelection: normalized };
	if (normalized.mode === 'multiple' && !columns.some((column) => column.checkboxSelection)) {
		const checkboxCol = {
			field: '__rowSelect__',
			header: '',
			width: 40,
			checkboxSelection: true,
			sortable: false,
			canMoveColumn: () => false,
		} as unknown as ColumnDef<TRowData>;
		nextColumns = [checkboxCol, ...columns];
		nextInitial = {
			...nextInitial,
			pinnedColumns: { left: (nextInitial.pinnedColumns?.left ?? 0) + 1, right: nextInitial.pinnedColumns?.right ?? 0 },
		};
	}
	if (normalized.mode === 'multiple') nextInitial = { ...nextInitial, columns: nextColumns };
	return { columns: nextColumns, initialState: nextInitial };
}

function wireGridWorkspace<TRowData>(
	options: { workspace?: GridWorkspaceAdapter },
	runtime: GridRuntime<TRowData>
): GridWorkspaceController | undefined {
	if (!options.workspace) return undefined;
	const controller = createWorkspaceController(options.workspace, (operation, error) =>
		runtime.reportRuntimeFault({ source: 'persistence', operation: `workspace: ${operation}`, error })
	);
	// Whether the grid still matches the active view, checked after changes settle.
	let timer: ReturnType<GridScheduler['timeout']> | null = null;
	const sync = () => {
		if (timer !== null) defaultGridScheduler.clearTimeout(timer);
		timer = defaultGridScheduler.timeout(() => {
			timer = null;
			if (controller.getState().activeViewId) controller.syncCurrentState(runtime.getGridState());
		}, 120);
	};
	const unsubscribe = PERSISTED_STATE_KEYS.map((key) => runtime.engine.subscribeToKey(key, sync));
	const destroy = controller.destroy;
	controller.destroy = () => {
		if (timer !== null) defaultGridScheduler.clearTimeout(timer);
		unsubscribe.forEach((off) => off());
		destroy();
	};
	return controller;
}

function wireGridPersistence<TRowData>(
	options: { persistence?: string | GridPersistenceAdapter },
	runtime: GridRuntime<TRowData>
): PersistenceController | undefined {
	const adapter = typeof options.persistence === 'string' ? createLocalStorageAdapter(options.persistence) : options.persistence;
	if (!adapter) return undefined;
	return createPersistenceSubscription(
		adapter,
		(key, cb) => runtime.engine.subscribeToKey(key, () => cb()),
		() => runtime.getGridState(),
		adapter.debounceMs ?? 500
	);
}

interface GridBootstrapOptions<TRowData> {
	columns: Array<ColumnDef<TRowData>>;
	getRowId?: (row: TRowData) => string;
	initialState?: Partial<GridInitialState<TRowData>>;
	rowSelection?: RowSelectionMode | RowSelectionOptions;
	persistence?: string | GridPersistenceAdapter;
	workspace?: GridWorkspaceAdapter;
	capabilities?: GridCapabilitiesConfig<TRowData>;
	dataIntegrity?: GridDataIntegrityConfig<TRowData>;
}

interface DisposableGridController {
	dispose(): void;
}

function loadPersistedGridState(persistence?: string | GridPersistenceAdapter): {
	adapter?: GridPersistenceAdapter;
	loadedState: PersistedGridState | null;
	asyncLoad?: Promise<PersistedGridState | null>;
} {
	const adapter = typeof persistence === 'string' ? createLocalStorageAdapter(persistence) : persistence;
	if (!adapter) return { adapter, loadedState: null };
	const loaded = adapter.load();
	return loaded instanceof Promise ? { adapter, loadedState: null, asyncLoad: loaded } : { adapter, loadedState: loaded ?? null };
}

function prepareGridBootstrap<TRowData>(options: GridBootstrapOptions<TRowData>, selectionColumns: Array<ColumnDef<TRowData>>) {
	const selected = withRowSelectionColumn(selectionColumns, options.initialState ?? {}, options.rowSelection);
	let columns = selected.initialState.columns ?? selected.columns;
	let initialState = selected.initialState;
	if (!initialState.pinnedColumns) {
		const left = columns.filter((column) => column.pinned === 'left');
		const right = columns.filter((column) => column.pinned === 'right');
		if (left.length || right.length) {
			columns = [...left, ...columns.filter((column) => !column.pinned), ...right];
			initialState = { ...initialState, pinnedColumns: { left: left.length, right: right.length } };
		}
	}
	return { columns, initialState };
}

function createGridBootstrap<TRowData>(
	options: GridBootstrapOptions<TRowData>,
	selectionColumns: Array<ColumnDef<TRowData>>,
	createController: (runtime: GridRuntime<TRowData>, columns: Array<ColumnDef<TRowData>>) => DisposableGridController
): GridApi<TRowData> {
	const { adapter, loadedState, asyncLoad } = loadPersistedGridState(options.persistence);
	const { columns, initialState } = prepareGridBootstrap(options, selectionColumns);
	const runtime = new GridRuntime<TRowData>(
		{ columns, getRowId: options.getRowId, columnWidths: buildColumnWidths(columns), ...initialState },
		{ capabilities: options.capabilities, dataIntegrity: options.dataIntegrity }
	);
	const controller = createController(runtime, columns);
	const persistenceController = wireGridPersistence({ persistence: adapter }, runtime);
	const workspaceController = wireGridWorkspace(options, runtime);
	let destroyed = false;
	const api = createGridRuntimeComposition({
		runtime,
		destroy: () => {
			destroyed = true;
			persistenceController?.destroy();
			workspaceController?.destroy();
			controller.dispose();
			runtime.destroy();
		},
		persistenceAdapter: adapter,
		persistenceController,
		workspaceController,
	});
	if (loadedState) api.applyGridState(loadedState);
	const session = (asyncLoad ?? Promise.resolve(loadedState)).then(
		(saved) => {
			if (asyncLoad && !destroyed && saved) api.applyGridState(saved);
			return saved;
		},
		(error: unknown) => {
			// The grid keeps its default state.
			runtime.reportRuntimeFault({ source: 'persistence', operation: 'load saved state', error });
			return null;
		}
	);
	// The default view opens the grid when there is no saved session to restore.
	if (workspaceController) {
		const views = workspaceController.init().then(
			() => true,
			() => false
		);
		void Promise.all([views, session]).then(([loaded, saved]) => {
			const id = workspaceController.getState().defaultViewId;
			if (destroyed || !loaded || saved || !id || !workspaceController.getState().views.some((v) => v.id === id)) return;
			api.applyView(id).catch((error: unknown) =>
				runtime.reportRuntimeFault({ source: 'persistence', operation: 'workspace: apply default view', error })
			);
		});
	}
	return api;
}

export function createClientGrid<TRowData>(options: ClientGridOptions<TRowData>): GridApi<TRowData> {
	return createGridBootstrap(
		options,
		options.initialState?.columns ?? options.columns,
		(runtime, columns) => new ClientRowModelController(runtime.getClientRowModelRuntime(), { ...options, columns })
	);
}

export function createInfiniteGrid<TRowData>(options: InfiniteGridOptions<TRowData>): GridApi<TRowData> {
	return createGridBootstrap(
		options,
		options.columns,
		(runtime, columns) => new InfiniteRowModelController(runtime.getInfiniteRowModelRuntime(), { ...options, columns })
	);
}

export function createServerSideGrid<TRowData>(options: ServerSideGridOptions<TRowData>): GridApi<TRowData> {
	return createGridBootstrap(
		options,
		options.columns,
		(runtime, columns) => new ServerSideRowModelController(runtime.getServerSideRowModelRuntime(), { ...options, columns })
	);
}
