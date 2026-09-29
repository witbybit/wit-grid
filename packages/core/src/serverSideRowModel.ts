import { type ColumnDef, setValueByPath } from './columnDef.js';
import type { ServerSideRowModelRuntime } from './engine/runtimePorts.js';
import type {
	AggregationDef,
	FilterModel,
	QuickFilterModel,
	RowCountKind,
	RowLoadState,
	RowModel,
	RowModelCapabilities,
	RowModelRefreshResult,
	RowModelWriteResult,
	RowRangeLoadState,
	RowExpansionCapableModel,
	RowExpansionStateReadableModel,
	ServerSideControllableRowModel,
	SortModel,
} from './rowModel.js';
import type { GridQueryModel } from './query/GridQueryModel.js';
import { GridEventName } from './api/GridEvents.js';
import type { RowSelectionScope } from './api/GridApi.js';
import { RowNode } from './rowNode.js';
import { toDataVisualRowId, toFailedVisualRowId, toGroupVisualRowId, toLoadingVisualRowId, type GroupPathItem } from './rows/visualRowIds.js';
import type { VisualRow } from './visualRow.js';
import { createServerSideRouteKey, isRootServerSideRoute, normalizeServerSideRoute } from './serverSideRoute.js';

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error.length > 0) return error;
	return 'Unknown server-side block load failure';
}

/**
 * Canonical immutable store route identity for the real server-side row model.
 * The empty route represents the root store.
 */
export type ServerSideRoute = readonly string[];

export interface ServerSideRowGroupColumn {
	readonly colId: string;
	readonly field?: string;
}

export interface ServerSideValueColumn {
	readonly colId: string;
	readonly field?: string;
	readonly aggFunc?: AggregationDef<unknown>['aggFunc'];
}

export interface ServerSideGroupMetadata {
	readonly rowId: string;
	readonly route: ServerSideRoute;
	readonly groupKey: string;
	readonly expandable: boolean;
}

export interface ServerSideGetRowsRequest {
	readonly startRow: number;
	readonly endRow: number;
	readonly route: ServerSideRoute;
	readonly groupKeys: readonly string[];
	readonly rowGroupColumns: readonly ServerSideRowGroupColumn[];
	readonly valueColumns: readonly ServerSideValueColumn[];
	readonly sortModel: SortModel | null;
	readonly filterModel: FilterModel | null;
	readonly quickFilterModel: QuickFilterModel | null;
	readonly queryModel: GridQueryModel | null;
}

export interface CreateServerSideGetRowsRequestInput {
	readonly startRow: number;
	readonly endRow: number;
	readonly route?: ServerSideRoute | null;
	readonly groupKeys?: readonly string[] | null;
	readonly rowGroupColumns?: readonly ServerSideRowGroupColumn[] | null;
	readonly valueColumns?: readonly ServerSideValueColumn[] | null;
	readonly sortModel?: SortModel | null;
	readonly filterModel?: FilterModel | null;
	readonly quickFilterModel?: QuickFilterModel | null;
	readonly queryModel?: GridQueryModel | null;
}

function freezeColumnMetadata<TColumn extends object>(columns?: readonly TColumn[] | null): readonly TColumn[] {
	return Object.freeze((columns ?? []).map((column) => Object.freeze({ ...column }) as TColumn));
}

function freezeStrings(values?: readonly string[] | null): readonly string[] {
	return values && values.length > 0 ? Object.freeze([...values]) : Object.freeze([]);
}

export function createServerSideGetRowsRequest(input: CreateServerSideGetRowsRequestInput): ServerSideGetRowsRequest {
	if (!Number.isInteger(input.startRow) || input.startRow < 0) {
		throw new Error(`Invalid server-side request startRow: ${input.startRow}`);
	}
	if (!Number.isInteger(input.endRow) || input.endRow < input.startRow) {
		throw new Error(`Invalid server-side request endRow: ${input.endRow}`);
	}

	const route = normalizeServerSideRoute(input.route);
	const groupKeys = freezeStrings(input.groupKeys ?? route);

	return Object.freeze({
		startRow: input.startRow,
		endRow: input.endRow,
		route,
		groupKeys,
		rowGroupColumns: freezeColumnMetadata(input.rowGroupColumns),
		valueColumns: freezeColumnMetadata(input.valueColumns),
		sortModel: input.sortModel ?? null,
		filterModel: input.filterModel ?? null,
		quickFilterModel: input.quickFilterModel ?? null,
		queryModel: input.queryModel ?? null,
	});
}

export interface ServerSideGetRowsResult<TRowData> {
	readonly rows: readonly TRowData[];
	readonly rowCount?: number;
	readonly lastRow?: number;
	readonly hasMore?: boolean;
	readonly aggregateData?: Readonly<Record<string, unknown>>;
	readonly groupMetadata?: readonly ServerSideGroupMetadata[];
}

export interface NormalizedServerSideGetRowsResult<TRowData> {
	readonly rows: readonly TRowData[];
	readonly rowCountState: ServerSideRowCountState;
	readonly aggregateData?: Readonly<Record<string, unknown>>;
	readonly groupMetadata: readonly ServerSideGroupMetadata[];
}

export interface NormalizeServerSideGetRowsResultInput<TRowData> {
	readonly request: Pick<ServerSideGetRowsRequest, 'startRow' | 'endRow'>;
	readonly result: ServerSideGetRowsResult<TRowData>;
	readonly getRowId?: (row: TRowData) => string;
}

export type ServerSideRowCountState =
	| { readonly kind: 'unknown' }
	| { readonly kind: 'estimated'; readonly count: number }
	| { readonly kind: 'known'; readonly count: number };

export interface ResolveServerSideRowCountStateInput {
	readonly startRow: number;
	readonly endRow: number;
	readonly returnedRowCount: number;
	readonly rowCount?: number;
	readonly lastRow?: number;
	readonly hasMore?: boolean;
}

function assertNonNegativeInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`Server-side datasource returned invalid ${label} ${value}`);
	}
}

export function resolveServerSideRowCountState(input: ResolveServerSideRowCountStateInput): ServerSideRowCountState {
	if (!Number.isInteger(input.startRow) || input.startRow < 0) {
		throw new Error(`Invalid server-side request startRow: ${input.startRow}`);
	}
	if (!Number.isInteger(input.endRow) || input.endRow < input.startRow) {
		throw new Error(`Invalid server-side request endRow: ${input.endRow}`);
	}
	if (!Number.isInteger(input.returnedRowCount) || input.returnedRowCount < 0) {
		throw new Error(`Server-side datasource returned invalid row count ${input.returnedRowCount}`);
	}

	const requestedRowCount = input.endRow - input.startRow;
	if (input.returnedRowCount > requestedRowCount) {
		throw new Error(`Server-side datasource returned ${input.returnedRowCount} rows for requested range ${input.startRow}-${input.endRow - 1}`);
	}

	const minimumReachableCount = input.startRow + input.returnedRowCount;

	if (typeof input.rowCount === 'number') {
		assertNonNegativeInteger(input.rowCount, 'rowCount');
		if (input.rowCount < minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned rowCount ${input.rowCount}, which is smaller than the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (typeof input.lastRow === 'number') {
		assertNonNegativeInteger(input.lastRow, 'lastRow');
		if (input.lastRow < minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned lastRow ${input.lastRow}, which is smaller than the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (typeof input.rowCount === 'number' && typeof input.lastRow === 'number' && input.rowCount !== input.lastRow) {
		throw new Error(`Server-side datasource returned conflicting rowCount ${input.rowCount} and lastRow ${input.lastRow}`);
	}

	if (input.hasMore === false) {
		if (typeof input.rowCount === 'number' && input.rowCount !== minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned hasMore false but rowCount ${input.rowCount} does not match the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
		if (typeof input.lastRow === 'number' && input.lastRow !== minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned hasMore false but lastRow ${input.lastRow} does not match the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
		return Object.freeze({ kind: 'known', count: minimumReachableCount });
	}

	if (input.hasMore === true) {
		if (typeof input.rowCount === 'number' && input.rowCount <= minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned hasMore true but rowCount ${input.rowCount} leaves no rows beyond the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
		if (typeof input.lastRow === 'number' && input.lastRow <= minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned hasMore true but lastRow ${input.lastRow} leaves no rows beyond the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}

	if (input.returnedRowCount < requestedRowCount) {
		if (typeof input.rowCount === 'number' && input.rowCount > minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned ${input.returnedRowCount} rows for range ${input.startRow}-${input.endRow - 1} but rowCount ${input.rowCount} still requires rows within that range`
			);
		}
		if (typeof input.lastRow === 'number' && input.lastRow > minimumReachableCount) {
			throw new Error(
				`Server-side datasource returned ${input.returnedRowCount} rows for range ${input.startRow}-${input.endRow - 1} but lastRow ${input.lastRow} still requires rows within that range`
			);
		}
		if (input.hasMore === true) {
			throw new Error(
				`Server-side datasource returned ${input.returnedRowCount} rows for range ${input.startRow}-${input.endRow - 1} but hasMore true still requires rows within that range`
			);
		}
		return Object.freeze({ kind: 'known', count: minimumReachableCount });
	}

	if (typeof input.rowCount === 'number') return Object.freeze({ kind: 'known', count: input.rowCount });
	if (typeof input.lastRow === 'number') return Object.freeze({ kind: 'known', count: input.lastRow });
	if (input.hasMore === true) return Object.freeze({ kind: 'estimated', count: minimumReachableCount + 1 });
	if (minimumReachableCount > 0) return Object.freeze({ kind: 'estimated', count: minimumReachableCount });
	return Object.freeze({ kind: 'unknown' });
}

export function normalizeServerSideGetRowsResult<TRowData>(
	input: NormalizeServerSideGetRowsResultInput<TRowData>
): NormalizedServerSideGetRowsResult<TRowData> {
	const rows = Object.freeze([...input.result.rows]);
	const rowCountState = resolveServerSideRowCountState({
		startRow: input.request.startRow,
		endRow: input.request.endRow,
		returnedRowCount: rows.length,
		rowCount: input.result.rowCount,
		lastRow: input.result.lastRow,
		hasMore: input.result.hasMore,
	});

	if (input.getRowId) {
		const seenRowIds = new Set<string>();
		for (const row of rows) {
			const rowId = input.getRowId(row);
			if (seenRowIds.has(rowId)) {
				throw new Error(`Server-side datasource returned duplicate row id "${rowId}" within one block`);
			}
			seenRowIds.add(rowId);
		}
	}

	const aggregateData = input.result.aggregateData === undefined ? undefined : Object.freeze({ ...input.result.aggregateData });
	const groupMetadata = Object.freeze(
		(input.result.groupMetadata ?? []).map((metadata) =>
			Object.freeze({
				...metadata,
				route: normalizeServerSideRoute(metadata.route),
			})
		)
	);

	return Object.freeze({
		rows,
		rowCountState,
		aggregateData,
		groupMetadata,
	});
}

export interface ServerSideDatasource<TRowData = unknown> {
	getRows(
		request: ServerSideGetRowsRequest,
		context: {
			signal?: AbortSignal;
		}
	): Promise<ServerSideGetRowsResult<TRowData>>;
}

export type ServerSideBlockState = 'absent' | 'queued' | 'loadingInitial' | 'loaded' | 'refreshing' | 'failedInitial' | 'failedRefresh' | 'stale';

export interface ServerSideRefreshOptions {
	readonly route?: ServerSideRoute;
	readonly purge?: boolean;
}

export interface ServerSideStoreSnapshot {
	readonly storeId: string;
	readonly route: ServerSideRoute;
	readonly level: number;
	readonly rowCountState: ServerSideRowCountState;
	readonly blockCount: number;
	readonly loadingBlockCount: number;
	readonly failedBlockCount: number;
	readonly childStoreCount: number;
}

export interface ServerSideBlockSnapshot {
	readonly storeId: string;
	readonly blockIndex: number;
	readonly startRow: number;
	readonly endRow: number;
	readonly state: ServerSideBlockState;
	readonly committedRowCount: number;
	readonly requestId?: number;
	readonly queryGeneration: number;
	readonly lastAccessedAt: number;
	readonly error?: string;
}

export interface ServerSideRowModelOptions<TRowData = unknown> {
	readonly datasource: ServerSideDatasource<TRowData>;
	readonly columns?: readonly ColumnDef<TRowData>[];
	readonly getRowId?: (row: TRowData) => string;
	readonly blockSize?: number;
	readonly maxBlocksInCache?: number;
	readonly maxConcurrentRequests?: number;
	readonly prefetchBlockCount?: number;
}

const SERVER_SIDE_CAPABILITIES: RowModelCapabilities = {
	fullDataset: false,
	loadedDataset: true,
	pagedDataset: false,
	clientMutation: false,
	loadedRowMutation: true,
	pageRowMutation: false,
	transactions: false,
	rowOrder: false,
	blockLoading: true,
	serverPagination: false,
	clientSort: false,
	clientFilter: false,
	serverSort: true,
	serverFilter: true,
	clientGrouping: false,
	clientTree: false,
	aggregation: false,
	masterDetail: false,
	allRowSelection: false,
	loadedRowSelection: true,
	pageRowSelection: false,
};

type ServerSideLoadedBlock<TRowData> = {
	readonly storeId: string;
	readonly route: ServerSideRoute;
	readonly blockIndex: number;
	readonly startRow: number;
	readonly endRow: number;
	state: ServerSideBlockState;
	rows: readonly RowNode<TRowData>[];
	groupMetadata?: readonly ServerSideGroupMetadata[];
	requestId?: number;
	queryGeneration: number;
	lastAccessedAt: number;
	error?: string;
	abortController?: AbortController;
};

type ServerSideRuntimeStore<TRowData> = {
	readonly storeId: string;
	readonly route: ServerSideRoute;
	rowCountState: ServerSideRowCountState;
	readonly blocks: Map<number, ServerSideLoadedBlock<TRowData>>;
};

export class ServerSideRowModelController<TRowData = unknown>
	implements RowModel<TRowData>, ServerSideControllableRowModel<TRowData>, RowExpansionCapableModel<TRowData>, RowExpansionStateReadableModel
{
	private datasource: ServerSideDatasource<TRowData>;
	private readonly getRowId: (row: TRowData) => string;
	private blockSize: number;
	private readonly maxBlocksInCache: number | null;
	private readonly maxConcurrentRequests: number;
	private disposed = false;
	private queryGeneration = 0;
	private requestSequence = 0;
	private activeRequestCount = 0;
	private rowCountState: ServerSideRowCountState = Object.freeze({ kind: 'unknown' });
	private readonly blocks = new Map<number, ServerSideLoadedBlock<TRowData>>();
	private readonly childStores = new Map<string, ServerSideRuntimeStore<TRowData>>();
	private readonly groupMetadataByRowId = new Map<string, ServerSideGroupMetadata>();
	private readonly groupMetadataByGroupId = new Map<string, ServerSideGroupMetadata>();
	private readonly expandedGroupIds = new Set<string>();
	private readonly rowIdToIndex = new Map<string, number>();
	private readonly visualRowIdToIndex = new Map<string, number>();
	private readonly unsubscribers: Array<() => void> = [];

	constructor(
		private readonly runtime: ServerSideRowModelRuntime<TRowData>,
		options: ServerSideRowModelOptions<TRowData>
	) {
		this.datasource = options.datasource;
		this.getRowId = options.getRowId ?? runtime.getRowId;
		this.blockSize = Math.max(1, options.blockSize ?? 100);
		this.maxBlocksInCache =
			typeof options.maxBlocksInCache === 'number' && options.maxBlocksInCache > 0 ? Math.floor(options.maxBlocksInCache) : null;
		this.maxConcurrentRequests =
			typeof options.maxConcurrentRequests === 'number' && options.maxConcurrentRequests > 0 ? Math.floor(options.maxConcurrentRequests) : 2;
		this.runtime.initializeModel({ columns: options.columns ? [...options.columns] : undefined, getRowId: options.getRowId });
		this.runtime.registerRowModel(this);
		this.unsubscribers.push(
			this.runtime.addEventListener(GridEventName.sortChanged, () => this.purgeServerSide()),
			this.runtime.addEventListener(GridEventName.filterChanged, () => this.purgeServerSide()),
			this.runtime.addEventListener(GridEventName.quickFilterChanged, () => this.purgeServerSide()),
			this.runtime.addEventListener(GridEventName.queryModelChanged, () => this.purgeServerSide())
		);
		this.publishServerSideState();
		this.ensureRange(0, this.blockSize - 1, 'initial-load');
	}

	public dispose(): void {
		this.disposed = true;
		this.queryGeneration++;
		this.activeRequestCount = 0;
		for (const block of this.blocks.values()) {
			block.abortController?.abort();
		}
		for (const store of this.childStores.values()) {
			for (const block of store.blocks.values()) {
				block.abortController?.abort();
			}
		}
		this.blocks.clear();
		this.childStores.clear();
		this.groupMetadataByRowId.clear();
		this.groupMetadataByGroupId.clear();
		this.expandedGroupIds.clear();
		this.rowIdToIndex.clear();
		this.visualRowIdToIndex.clear();
		this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
	}

	public getCapabilities(): RowModelCapabilities {
		return SERVER_SIDE_CAPABILITIES;
	}

	/** Read-only, current ownership gauges used by deterministic long-session tests. */
	public getOwnershipSnapshot(): Readonly<{
		rootStoreCount: number;
		childStoreCount: number;
		blockCount: number;
		loadingBlockCount: number;
		queuedBlockCount: number;
		activeRequestCount: number;
		nodeIndexCount: number;
		visualIndexCount: number;
	}> {
		let blockCount = 0;
		let loadingBlockCount = 0;
		let queuedBlockCount = 0;
		for (const block of this.getAllBlocks()) {
			blockCount++;
			if (block.state === 'loadingInitial' || block.state === 'refreshing') loadingBlockCount++;
			if (block.state === 'queued') queuedBlockCount++;
		}
		return Object.freeze({
			rootStoreCount: 1,
			childStoreCount: this.childStores.size,
			blockCount,
			loadingBlockCount,
			queuedBlockCount,
			activeRequestCount: this.activeRequestCount,
			nodeIndexCount: this.rowIdToIndex.size,
			visualIndexCount: this.visualRowIdToIndex.size,
		});
	}

	public setServerSideDatasource(datasource: ServerSideDatasource<TRowData>): void {
		this.datasource = datasource;
		this.purgeServerSide();
	}

	public refreshServerSide(options?: ServerSideRefreshOptions): void {
		const route = normalizeServerSideRoute(options?.route);
		if (!isRootServerSideRoute(route)) {
			const store = this.getOrCreateChildStore(route);
			const currentBlocks = [...store.blocks.keys()];
			for (const blockIndex of currentBlocks) {
				this.loadChildBlock(store, blockIndex, true);
			}
			if (currentBlocks.length === 0) {
				this.loadChildBlock(store, 0, false);
			}
			return;
		}
		const currentBlocks = [...this.blocks.keys()];
		for (const blockIndex of currentBlocks) {
			this.loadBlock(blockIndex, true);
		}
		if (currentBlocks.length === 0) {
			this.ensureRange(0, this.blockSize - 1, 'refresh');
		}
	}

	public purgeServerSide(options?: Omit<ServerSideRefreshOptions, 'purge'>): void {
		const route = normalizeServerSideRoute(options?.route);
		if (!isRootServerSideRoute(route)) {
			this.purgeChildStore(route);
			return;
		}
		this.queryGeneration++;
		this.activeRequestCount = 0;
		for (const block of this.blocks.values()) {
			block.abortController?.abort();
		}
		for (const store of this.childStores.values()) {
			for (const block of store.blocks.values()) {
				block.abortController?.abort();
			}
		}
		this.blocks.clear();
		this.childStores.clear();
		this.groupMetadataByRowId.clear();
		this.groupMetadataByGroupId.clear();
		this.expandedGroupIds.clear();
		this.rowIdToIndex.clear();
		this.visualRowIdToIndex.clear();
		this.rowCountState = Object.freeze({ kind: 'unknown' });
		this.publishServerSideState();
		this.ensureRange(0, this.blockSize - 1, 'purge');
	}

	public getServerSideStoreState(): readonly ServerSideStoreSnapshot[] {
		return this.createStoreSnapshots();
	}

	public getBlockSnapshots(): readonly ServerSideBlockSnapshot[] {
		return [...this.getAllBlocks()]
			.sort((a, b) => a.storeId.localeCompare(b.storeId) || a.blockIndex - b.blockIndex)
			.map((block) =>
				Object.freeze({
					storeId: block.storeId,
					blockIndex: block.blockIndex,
					startRow: block.startRow,
					endRow: block.endRow,
					state: block.state,
					committedRowCount: block.rows.length,
					requestId: block.requestId,
					queryGeneration: block.queryGeneration,
					lastAccessedAt: block.lastAccessedAt,
					error: block.error,
				})
			);
	}

	public refresh(_reason?: string): RowModelRefreshResult {
		this.refreshServerSide();
		return { changed: true, reason: 'refresh' };
	}

	public getVisualRow(index: number): VisualRow<TRowData> | null {
		const node = this.getCommittedNode(index);
		if (node) {
			const groupMetadata = this.groupMetadataByRowId.get(node.id);
			if (groupMetadata) {
				const path = this.toGroupPath(groupMetadata);
				const groupId = toGroupVisualRowId(path);
				return {
					kind: 'group',
					id: groupId,
					groupId,
					field: path[path.length - 1]?.field ?? 'serverSide',
					key: groupMetadata.groupKey,
					keyString: groupMetadata.groupKey,
					path,
					depth: path.length,
					expanded: this.expandedGroupIds.has(groupId),
					childCount: this.getKnownChildStoreRowCount(groupMetadata.route),
					leafCount: this.getKnownChildStoreRowCount(groupMetadata.route),
					selectable: true,
					editable: false,
				};
			}
			return {
				kind: 'data',
				id: toDataVisualRowId(node.id),
				rowId: node.id,
				node,
				depth: 0,
			};
		}
		const state = this.getRowLoadState(index);
		if (state.kind === 'loading') return { kind: 'loading', id: toLoadingVisualRowId(index), rowIndex: index, editable: false };
		if (state.kind === 'failed') {
			return {
				kind: 'failed',
				id: toFailedVisualRowId(index),
				rowIndex: index,
				error: state.error,
				retryable: state.retryable,
				editable: false,
			};
		}
		return null;
	}

	public toggleGroupExpanded(groupId: string): RowModelRefreshResult {
		const metadata = this.groupMetadataByGroupId.get(groupId) ?? this.groupMetadataByRowId.get(groupId);
		if (!metadata?.expandable) return { changed: false };
		const actualGroupId = this.groupMetadataByGroupId.has(groupId) ? groupId : toGroupVisualRowId(this.toGroupPath(metadata));
		const previousRowCount = this.getVisualRowCount();
		if (this.expandedGroupIds.has(actualGroupId)) {
			this.expandedGroupIds.delete(actualGroupId);
			this.publishServerSideState();
			return { changed: true, reason: 'expansion', previousRowCount, nextRowCount: this.getVisualRowCount(), groupId: actualGroupId };
		}
		this.expandedGroupIds.add(actualGroupId);
		const store = this.getOrCreateChildStore(metadata.route);
		this.loadChildBlock(store, 0, false);
		this.publishServerSideState();
		return { changed: true, reason: 'expansion', previousRowCount, nextRowCount: this.getVisualRowCount(), groupId: actualGroupId };
	}

	public expandAllGroups(): RowModelRefreshResult {
		const previousRowCount = this.getVisualRowCount();
		let changed = false;
		for (const [groupId, metadata] of this.groupMetadataByGroupId) {
			if (!metadata.expandable || this.expandedGroupIds.has(groupId)) continue;
			this.expandedGroupIds.add(groupId);
			this.loadChildBlock(this.getOrCreateChildStore(metadata.route), 0, false);
			changed = true;
		}
		if (changed) this.publishServerSideState();
		return { changed, reason: 'expansion', previousRowCount, nextRowCount: this.getVisualRowCount() };
	}

	public collapseAllGroups(): RowModelRefreshResult {
		if (this.expandedGroupIds.size === 0) return { changed: false };
		const previousRowCount = this.getVisualRowCount();
		this.expandedGroupIds.clear();
		this.publishServerSideState();
		return { changed: true, reason: 'expansion', previousRowCount, nextRowCount: this.getVisualRowCount() };
	}

	public toggleDetailExpanded(_rowId: string): RowModelRefreshResult {
		return { changed: false };
	}

	public isGroupExpanded(groupId: string): boolean {
		const metadata = this.groupMetadataByGroupId.get(groupId) ?? this.groupMetadataByRowId.get(groupId);
		const actualGroupId = metadata && !this.groupMetadataByGroupId.has(groupId) ? toGroupVisualRowId(this.toGroupPath(metadata)) : groupId;
		return this.expandedGroupIds.has(actualGroupId);
	}

	public isDetailExpanded(_rowId: string): boolean {
		return false;
	}

	public getVisualRowCount(): number {
		if (this.rowCountState.kind === 'known' || this.rowCountState.kind === 'estimated') return this.rowCountState.count;
		// Loop instead of Math.max(...spread): no per-call arrays, no argument-count limit.
		let count = 0;
		for (const block of this.blocks.values()) {
			if (block.endRow + 1 > count) count = block.endRow + 1;
		}
		return count;
	}

	public getVisualIndexById(visualRowId: string): number {
		return this.visualRowIdToIndex.get(visualRowId) ?? -1;
	}

	public getVisualIndexByRowId(rowId: string): number {
		return this.rowIdToIndex.get(rowId) ?? -1;
	}

	public getRowNodeById(rowId: string): RowNode<TRowData> | null {
		const index = this.rowIdToIndex.get(rowId);
		return index === undefined ? null : this.getCommittedNode(index);
	}

	public getRawRowById(rowId: string): TRowData | null {
		return this.getRowNodeById(rowId)?.data ?? null;
	}

	public getSelectableDataRowIds(scope: RowSelectionScope = 'loaded'): string[] {
		if (scope === 'all' || scope === 'filtered') return [];
		return [...this.blocks.values()]
			.filter((block) => block.state === 'loaded' || block.state === 'refreshing' || block.state === 'failedRefresh')
			.sort((a, b) => a.blockIndex - b.blockIndex)
			.flatMap((block) => block.rows.map((node) => node.id));
	}

	public writeCellValueStructurally = (
		rowId: string,
		colField: string,
		value: unknown,
		options?: { bypassValueSetter?: boolean }
	): RowModelWriteResult<TRowData> => {
		const node = this.getRowNodeById(rowId);
		if (!node) return { visualChange: 'none' };

		const col = this.runtime.getColumnDef(colField);
		const oldValue = this.runtime.getCellValue(rowId, colField);
		const updatedRow = { ...(node.data as object) } as TRowData;

		if (!options?.bypassValueSetter && col?.valueSetter) {
			const result = col.valueSetter({ value, oldValue, row: updatedRow, colField, abort: () => {} });
			if (!(result instanceof Promise) && !result) return { visualChange: 'none' };
		} else {
			setValueByPath(updatedRow as Record<string, unknown>, colField, value);
		}

		node.setData(updatedRow);

		const state = this.runtime.getState();
		const affectsServerOrder =
			(state.sortModel?.some((sort) => sort.colId === colField) ?? false) || (state.filterModel != null && colField in state.filterModel);
		if (affectsServerOrder) this.purgeServerSide();

		return {
			updatedNodes: [node],
			changedFieldsByRow: new Map([[rowId, new Set([colField])]]),
			changedValuesByRow: new Map([[rowId, new Map([[colField, { oldValue, newValue: value }]])]]),
			visualChange: 'none',
		};
	};

	public getKnownRowCount(): number | null {
		return this.rowCountState.kind === 'known' ? this.rowCountState.count : null;
	}

	public getEstimatedRowCount(): number {
		return this.rowCountState.kind === 'unknown' ? this.getVisualRowCount() : this.rowCountState.count;
	}

	public getRowCountKind(): RowCountKind {
		return this.rowCountState.kind;
	}

	public getRowLoadState(index: number): RowLoadState {
		if (index < 0 || index >= this.getVisualRowCount()) return { kind: 'missing' };
		const block = this.getBlockForRow(index);
		if (!block) return { kind: 'loading', reason: 'server-side-block' };
		if (block.state === 'failedInitial' || block.state === 'failedRefresh') {
			return { kind: 'failed', error: block.error ?? 'Unknown server-side block load failure', retryable: true };
		}
		const node = block.rows[index - block.startRow];
		if (node) return { kind: 'loaded', rowId: node.id };
		if (block.state === 'loadingInitial' || block.state === 'refreshing' || block.state === 'queued') {
			return { kind: 'loading', reason: 'server-side-block' };
		}
		return { kind: 'missing' };
	}

	public isRowLoaded(index: number): boolean {
		return this.getRowLoadState(index).kind === 'loaded';
	}

	public isRowLoading(index: number): boolean {
		return this.getRowLoadState(index).kind === 'loading';
	}

	public isRowFailed(index: number): boolean {
		return this.getRowLoadState(index).kind === 'failed';
	}

	public isRangeLoaded(startRow: number, endRow: number): boolean {
		for (let index = startRow; index <= endRow; index++) {
			if (!this.isRowLoaded(index)) return false;
		}
		return true;
	}

	public getRangeLoadState(startRow: number, endRow: number): RowRangeLoadState {
		const state = { loaded: 0, loading: 0, failed: 0, placeholder: 0, missing: 0 };
		for (let index = startRow; index <= endRow; index++) {
			const loadState = this.getRowLoadState(index);
			state[loadState.kind]++;
		}
		return state;
	}

	public ensureRange(startRow: number, endRow: number, reason?: string): void {
		if (this.disposed || startRow > endRow) return;
		const shouldRetryFailedInitial = reason === 'row-node-retry-load' || reason === 'retry' || reason === 'force-reload';
		const firstBlock = Math.floor(Math.max(0, startRow) / this.blockSize);
		const lastBlock = Math.floor(Math.max(0, endRow) / this.blockSize);
		for (let blockIndex = firstBlock; blockIndex <= lastBlock; blockIndex++) {
			const block = this.blocks.get(blockIndex);
			if (block?.state === 'queued') {
				block.lastAccessedAt = Date.now();
			}
			// Viewport rendering may call ensureRange on every paint. Keep failed
			// initial blocks visible until an explicit retry asks to replace them.
			if (!block || (shouldRetryFailedInitial && block.state === 'failedInitial')) this.loadBlock(blockIndex, false);
		}
	}

	private getCommittedNode(index: number): RowNode<TRowData> | null {
		const block = this.getBlockForRow(index);
		if (!block || (block.state !== 'loaded' && block.state !== 'refreshing' && block.state !== 'failedRefresh')) return null;
		block.lastAccessedAt = Date.now();
		return block.rows[index - block.startRow] ?? null;
	}

	private getBlockForRow(index: number): ServerSideLoadedBlock<TRowData> | undefined {
		return this.blocks.get(Math.floor(index / this.blockSize));
	}

	private loadBlock(blockIndex: number, forceReload: boolean): void {
		if (this.disposed) return;
		const existing = this.blocks.get(blockIndex);
		if (existing && !forceReload && (existing.state === 'loadingInitial' || existing.state === 'refreshing' || existing.state === 'loaded'))
			return;
		if (this.activeRequestCount >= this.maxConcurrentRequests) {
			this.markQueuedBlock(blockIndex, existing);
			return;
		}
		this.startBlockRequest(blockIndex);
	}

	private markQueuedBlock(blockIndex: number, existing: ServerSideLoadedBlock<TRowData> | undefined): void {
		const startRow = blockIndex * this.blockSize;
		const endRow = startRow + this.blockSize;
		existing?.abortController?.abort();
		this.blocks.set(blockIndex, {
			storeId: createServerSideRouteKey(),
			route: normalizeServerSideRoute(),
			blockIndex,
			startRow,
			endRow: endRow - 1,
			state: 'queued',
			rows: existing?.rows ?? [],
			queryGeneration: this.queryGeneration,
			lastAccessedAt: Date.now(),
		});
		this.publishServerSideState();
	}

	private startBlockRequest(blockIndex: number): void {
		this.startStoreBlockRequest(this.getRootStore(), blockIndex);
	}

	private startStoreBlockRequest(store: ServerSideRuntimeStore<TRowData>, blockIndex: number): void {
		if (this.disposed) return;
		const existing = store.blocks.get(blockIndex);
		const startRow = blockIndex * this.blockSize;
		const endRow = startRow + this.blockSize;
		const requestId = ++this.requestSequence;
		const queryGeneration = this.queryGeneration;
		const abortController = new AbortController();
		existing?.abortController?.abort();
		const block: ServerSideLoadedBlock<TRowData> = {
			storeId: store.storeId,
			route: store.route,
			blockIndex,
			startRow,
			endRow: endRow - 1,
			state: existing && existing.rows.length > 0 ? 'refreshing' : 'loadingInitial',
			rows: existing?.rows ?? [],
			requestId,
			queryGeneration,
			lastAccessedAt: Date.now(),
			abortController,
		};
		store.blocks.set(blockIndex, block);
		this.activeRequestCount++;
		this.publishServerSideState();

		const state = this.runtime.getState();
		const request = createServerSideGetRowsRequest({
			startRow,
			endRow,
			route: store.route,
			sortModel: state.sortModel,
			filterModel: state.filterModel,
			quickFilterModel: state.quickFilterModel,
			queryModel: state.queryModel,
		});

		void this.datasource
			.getRows(request, { signal: abortController.signal })
			.then((result) => {
				if (this.disposed || !this.isStoreActive(store) || block.requestId !== requestId || block.queryGeneration !== this.queryGeneration) {
					this.finishBlockRequest(queryGeneration);
					return;
				}
				const normalized = normalizeServerSideGetRowsResult({
					request,
					result,
					getRowId: this.getRowId,
				});
				const nodes = normalized.rows.map((row) => new RowNode<TRowData>(this.getRowId(row), row));
				block.rows = Object.freeze(nodes);
				block.groupMetadata = normalized.groupMetadata;
				block.state = 'loaded';
				block.error = undefined;
				block.abortController = undefined;
				store.rowCountState = normalized.rowCountState;
				if (isRootServerSideRoute(store.route)) {
					this.rowCountState = normalized.rowCountState;
				}
				this.evictBlocksIfNeeded(store, blockIndex);
				this.rebuildIndexes();
				this.publishServerSideState();
				this.runtime.publishAsyncRowModelUpdate({
					refreshResult: {
						changed: true,
						reason: 'refresh',
						previousRowCount: undefined,
						nextRowCount: this.getVisualRowCount(),
						changedStartIndex: startRow,
						changedEndIndex: Math.max(startRow, startRow + nodes.length - 1),
					},
					invalidationReason: 'row-model',
					requestRenderReason: 'server-side-block-loaded',
					includeOverlay: true,
				});
				this.finishBlockRequest(queryGeneration);
			})
			.catch((error) => {
				if (
					abortController.signal.aborted ||
					this.disposed ||
					!this.isStoreActive(store) ||
					block.requestId !== requestId ||
					block.queryGeneration !== this.queryGeneration
				) {
					this.finishBlockRequest(queryGeneration);
					return;
				}
				block.state = block.rows.length > 0 ? 'failedRefresh' : 'failedInitial';
				block.error = toErrorMessage(error);
				block.abortController = undefined;
				this.publishServerSideState();
				this.runtime.publishAsyncRowModelUpdate({
					refreshResult: { changed: true, reason: 'refresh', changedStartIndex: startRow, changedEndIndex: endRow - 1 },
					invalidationReason: 'row-model',
					requestRenderReason: 'server-side-block-failed',
					includeOverlay: true,
				});
				this.finishBlockRequest(queryGeneration);
			});
	}

	private finishBlockRequest(requestGeneration: number): void {
		if (requestGeneration !== this.queryGeneration) return;
		this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
		this.drainQueuedBlocks();
	}

	private drainQueuedBlocks(): void {
		if (this.disposed) return;
		while (this.activeRequestCount < this.maxConcurrentRequests) {
			// Single pass for the best queued block (same ordering the old filter+sort()[0] used):
			// most recently accessed first, then storeId, then blockIndex.
			let nextQueuedBlock: ServerSideLoadedBlock<TRowData> | null = null;
			nextQueuedBlock = this.pickQueuedBlock(this.blocks, nextQueuedBlock);
			for (const store of this.childStores.values()) nextQueuedBlock = this.pickQueuedBlock(store.blocks, nextQueuedBlock);
			if (!nextQueuedBlock) return;
			this.startStoreBlockRequest(this.getStoreById(nextQueuedBlock.storeId), nextQueuedBlock.blockIndex);
		}
	}

	private pickQueuedBlock(
		blocks: ReadonlyMap<number, ServerSideLoadedBlock<TRowData>>,
		best: ServerSideLoadedBlock<TRowData> | null
	): ServerSideLoadedBlock<TRowData> | null {
		for (const block of blocks.values()) {
			if (block.state !== 'queued' || block.queryGeneration !== this.queryGeneration) continue;
			if (
				!best ||
				(block.lastAccessedAt - best.lastAccessedAt || best.storeId.localeCompare(block.storeId) || best.blockIndex - block.blockIndex) > 0
			) {
				best = block;
			}
		}
		return best;
	}

	private rebuildIndexes(): void {
		this.rowIdToIndex.clear();
		this.visualRowIdToIndex.clear();
		this.groupMetadataByRowId.clear();
		this.groupMetadataByGroupId.clear();
		for (const block of this.blocks.values()) {
			for (const metadata of block.groupMetadata ?? []) {
				this.groupMetadataByRowId.set(metadata.rowId, metadata);
				this.groupMetadataByGroupId.set(toGroupVisualRowId(this.toGroupPath(metadata)), metadata);
			}
		}
		for (const block of this.blocks.values()) {
			for (let offset = 0; offset < block.rows.length; offset++) {
				const visualIndex = block.startRow + offset;
				const node = block.rows[offset];
				if (!node) continue;
				this.rowIdToIndex.set(node.id, visualIndex);
				const groupMetadata = this.groupMetadataByRowId.get(node.id);
				this.visualRowIdToIndex.set(
					groupMetadata ? toGroupVisualRowId(this.toGroupPath(groupMetadata)) : toDataVisualRowId(node.id),
					visualIndex
				);
			}
		}
	}

	private evictBlocksIfNeeded(store: ServerSideRuntimeStore<TRowData>, protectedBlockIndex: number): void {
		if (this.maxBlocksInCache === null) return;
		const evictableStates = new Set<ServerSideBlockState>(['loaded', 'failedInitial', 'failedRefresh']);
		while (store.blocks.size > this.maxBlocksInCache) {
			let evictableBlock: ServerSideLoadedBlock<TRowData> | null = null;
			for (const block of store.blocks.values()) {
				if (block.blockIndex === protectedBlockIndex) continue;
				if (!evictableStates.has(block.state)) continue;
				if (!evictableBlock || block.lastAccessedAt < evictableBlock.lastAccessedAt) {
					evictableBlock = block;
				}
			}
			if (!evictableBlock) return;
			evictableBlock.abortController?.abort();
			store.blocks.delete(evictableBlock.blockIndex);
		}
	}

	private createRootStoreSnapshot(): ServerSideStoreSnapshot {
		return this.createStoreSnapshot(this.getRootStore(), this.childStores.size);
	}

	private createStoreSnapshot(store: ServerSideRuntimeStore<TRowData>, childStoreCount: number): ServerSideStoreSnapshot {
		let loadingBlockCount = 0;
		let failedBlockCount = 0;
		for (const block of store.blocks.values()) {
			if (block.state === 'loadingInitial' || block.state === 'refreshing' || block.state === 'queued') loadingBlockCount++;
			if (block.state === 'failedInitial' || block.state === 'failedRefresh') failedBlockCount++;
		}
		return Object.freeze({
			storeId: store.storeId,
			route: store.route,
			level: store.route.length,
			rowCountState: store.rowCountState,
			blockCount: store.blocks.size,
			loadingBlockCount,
			failedBlockCount,
			childStoreCount,
		});
	}

	private createStoreSnapshots(): readonly ServerSideStoreSnapshot[] {
		return Object.freeze([
			this.createRootStoreSnapshot(),
			...[...this.childStores.values()].sort((a, b) => a.storeId.localeCompare(b.storeId)).map((store) => this.createStoreSnapshot(store, 0)),
		]);
	}

	private publishServerSideState(): void {
		const snapshots = this.createStoreSnapshots();
		this.runtime.publishServerSideState({
			loading: snapshots.some((snapshot) => snapshot.loadingBlockCount > 0),
			error: [...this.getAllBlocks()].find((block) => block.error)?.error ?? null,
			storeStates: snapshots,
		});
	}

	private getRootStore(): ServerSideRuntimeStore<TRowData> {
		return {
			storeId: createServerSideRouteKey(),
			route: normalizeServerSideRoute(),
			rowCountState: this.rowCountState,
			blocks: this.blocks,
		};
	}

	private getStoreById(storeId: string): ServerSideRuntimeStore<TRowData> {
		if (storeId === createServerSideRouteKey()) return this.getRootStore();
		const store = this.childStores.get(storeId);
		if (!store) throw new Error(`Missing server-side store "${storeId}"`);
		return store;
	}

	private isStoreActive(store: ServerSideRuntimeStore<TRowData>): boolean {
		if (store.storeId === createServerSideRouteKey()) return true;
		return this.childStores.get(store.storeId) === store;
	}

	private getChildStore(route: ServerSideRoute): ServerSideRuntimeStore<TRowData> | null {
		return this.childStores.get(createServerSideRouteKey(route)) ?? null;
	}

	private getKnownChildStoreRowCount(route: ServerSideRoute): number {
		const rowCountState = this.getChildStore(route)?.rowCountState;
		return rowCountState?.kind === 'known' ? rowCountState.count : 0;
	}

	private getOrCreateChildStore(route: ServerSideRoute): ServerSideRuntimeStore<TRowData> {
		const normalized = normalizeServerSideRoute(route);
		const storeId = createServerSideRouteKey(normalized);
		const existing = this.childStores.get(storeId);
		if (existing) return existing;
		const store: ServerSideRuntimeStore<TRowData> = {
			storeId,
			route: normalized,
			rowCountState: Object.freeze({ kind: 'unknown' }),
			blocks: new Map(),
		};
		this.childStores.set(storeId, store);
		return store;
	}

	private loadChildBlock(store: ServerSideRuntimeStore<TRowData>, blockIndex: number, forceReload: boolean): void {
		const existing = store.blocks.get(blockIndex);
		if (existing && !forceReload && (existing.state === 'loadingInitial' || existing.state === 'refreshing' || existing.state === 'loaded'))
			return;
		if (this.activeRequestCount >= this.maxConcurrentRequests) {
			this.markQueuedChildBlock(store, blockIndex, existing);
			return;
		}
		this.startStoreBlockRequest(store, blockIndex);
	}

	private markQueuedChildBlock(
		store: ServerSideRuntimeStore<TRowData>,
		blockIndex: number,
		existing: ServerSideLoadedBlock<TRowData> | undefined
	): void {
		const startRow = blockIndex * this.blockSize;
		const endRow = startRow + this.blockSize;
		existing?.abortController?.abort();
		store.blocks.set(blockIndex, {
			storeId: store.storeId,
			route: store.route,
			blockIndex,
			startRow,
			endRow: endRow - 1,
			state: 'queued',
			rows: existing?.rows ?? [],
			queryGeneration: this.queryGeneration,
			lastAccessedAt: Date.now(),
		});
		this.publishServerSideState();
	}

	private purgeChildStore(route: ServerSideRoute): void {
		const normalizedRoute = normalizeServerSideRoute(route);
		let changed = false;
		for (const [storeId, store] of this.childStores) {
			if (!this.isRouteInSubtree(store.route, normalizedRoute)) continue;
			for (const block of store.blocks.values()) {
				block.abortController?.abort();
			}
			this.childStores.delete(storeId);
			changed = true;
		}
		for (const [groupId, metadata] of this.groupMetadataByGroupId) {
			if (this.isRouteInSubtree(metadata.route, normalizedRoute)) {
				this.expandedGroupIds.delete(groupId);
				changed = true;
			}
		}
		if (changed) this.publishServerSideState();
	}

	private getAllBlocks(): readonly ServerSideLoadedBlock<TRowData>[] {
		return [this.blocks, ...[...this.childStores.values()].map((store) => store.blocks)].flatMap((blocks) => [...blocks.values()]);
	}

	private isRouteInSubtree(candidate: ServerSideRoute, ancestor: ServerSideRoute): boolean {
		const normalizedCandidate = normalizeServerSideRoute(candidate);
		const normalizedAncestor = normalizeServerSideRoute(ancestor);
		if (normalizedCandidate.length < normalizedAncestor.length) return false;
		for (let index = 0; index < normalizedAncestor.length; index++) {
			if (normalizedCandidate[index] !== normalizedAncestor[index]) return false;
		}
		return true;
	}

	private toGroupPath(metadata: ServerSideGroupMetadata): GroupPathItem[] {
		const route = normalizeServerSideRoute(metadata.route);
		if (route.length === 0) return [{ field: 'serverSide', key: metadata.groupKey, keyString: metadata.groupKey }];
		const path: GroupPathItem[] = [];
		for (let index = 0; index < route.length; index += 2) {
			const field = route[index] ?? `level-${index}`;
			const key = route[index + 1] ?? metadata.groupKey;
			path.push({ field, key, keyString: String(key) });
		}
		return path;
	}
}
