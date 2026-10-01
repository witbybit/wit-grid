import { type ColumnDef, setValueByPath } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { InfiniteRowModelRuntime } from './engine/runtimePorts.js';
import type {
	DataRowCountModel,
	RowModel,
	RowRefreshReason,
	RowModelRefreshResult,
	RowModelWriteResult,
	SelectableDataRowModel,
	InfiniteControllableRowModel,
	AnyModelCellWritable,
	VisibleBlockLoadCapableRowModel,
	CapableRowModel,
	RowModelCapabilities,
	RowCountKind,
	RowLoadState,
	RowRangeLoadState,
	RowModelRequestToken,
	RowModelQueryState,
} from './rowModel.js';
import type { RowSelectionScope } from './api/GridApi.js';
import { RowNode } from './rowNode.js';
import { toDataVisualRowId, toFailedVisualRowId, toLoadingVisualRowId } from './rows/visualRowIds.js';
import { FLAT_HIERARCHY, type VisualRow } from './visualRow.js';
import { createAsyncRowModelQuerySnapshot } from './asyncRowModelQuerySnapshot.js';
import { createInfiniteBlockScopeId } from './asyncRowModelRequestIdentity.js';

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error.length > 0) return error;
	return 'Unknown infinite block load failure';
}

function validateInfiniteBlockResponse<TRowData>(
	rows: readonly TRowData[],
	blockSize: number,
	getRowId: (row: TRowData) => string,
	options?: { totalCount?: number; lastRow?: number; hasMore?: boolean; blockStartRow?: number }
): void {
	if (rows.length > blockSize) {
		throw new Error(`Infinite datasource returned ${rows.length} rows for block size ${blockSize}`);
	}

	const blockStartRow = options?.blockStartRow ?? 0;
	const minimumReachableCount = blockStartRow + rows.length;

	if (typeof options?.totalCount === 'number') {
		if (options.totalCount < 0) {
			throw new Error(`Infinite datasource returned negative totalCount ${options.totalCount}`);
		}
		if (options.totalCount < minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned totalCount ${options.totalCount}, which is smaller than the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (typeof options?.lastRow === 'number') {
		if (options.lastRow < 0) {
			throw new Error(`Infinite datasource returned negative lastRow ${options.lastRow}`);
		}
		if (options.lastRow < minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned lastRow ${options.lastRow}, which is smaller than the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (typeof options?.totalCount === 'number' && typeof options?.lastRow === 'number' && options.totalCount !== options.lastRow) {
		throw new Error(`Infinite datasource returned conflicting totalCount ${options.totalCount} and lastRow ${options.lastRow}`);
	}
	if (options?.hasMore === false) {
		if (typeof options.totalCount === 'number' && options.totalCount !== minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned hasMore false but totalCount ${options.totalCount} does not match the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
		if (typeof options.lastRow === 'number' && options.lastRow !== minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned hasMore false but lastRow ${options.lastRow} does not match the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (options?.hasMore === true) {
		if (typeof options.totalCount === 'number' && options.totalCount <= minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned hasMore true but totalCount ${options.totalCount} leaves no rows beyond the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
		if (typeof options.lastRow === 'number' && options.lastRow <= minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned hasMore true but lastRow ${options.lastRow} leaves no rows beyond the loaded range ending at ${minimumReachableCount - 1}`
			);
		}
	}
	if (rows.length < blockSize) {
		if (typeof options?.totalCount === 'number' && options.totalCount > minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned ${rows.length} rows for block ${blockStartRow}-${blockStartRow + blockSize - 1} but totalCount ${options.totalCount} still requires rows within that block`
			);
		}
		if (typeof options?.lastRow === 'number' && options.lastRow > minimumReachableCount) {
			throw new Error(
				`Infinite datasource returned ${rows.length} rows for block ${blockStartRow}-${blockStartRow + blockSize - 1} but lastRow ${options.lastRow} still requires rows within that block`
			);
		}
		if (options?.hasMore === true) {
			throw new Error(
				`Infinite datasource returned ${rows.length} rows for block ${blockStartRow}-${blockStartRow + blockSize - 1} but hasMore true still requires rows within that block`
			);
		}
	}

	const seenRowIds = new Set<string>();
	for (const row of rows) {
		const rowId = getRowId(row);
		if (seenRowIds.has(rowId)) {
			throw new Error(`Infinite datasource returned duplicate row id "${rowId}" within one block`);
		}
		seenRowIds.add(rowId);
	}
}

function resolveInfiniteTerminalCount(options: {
	totalCount?: number;
	lastRow?: number;
	hasMore?: boolean;
	blockStartRow: number;
	returnedRowCount: number;
}): number | undefined {
	if (typeof options.totalCount === 'number') return options.totalCount;
	if (typeof options.lastRow === 'number') return options.lastRow;
	if (options.hasMore === false) return options.blockStartRow + options.returnedRowCount;
	return undefined;
}

export interface InfiniteGetRowsParams {
	readonly startRow: number;
	readonly endRow: number;
	readonly sortModel: unknown;
	readonly filterModel: unknown;
	/** QuickFilterModel | null — a single search string to match across multiple columns server-side. */
	readonly quickFilterModel: unknown;
	readonly queryModel: unknown;
}

export interface InfiniteGetRowsResult<TRowData = unknown> {
	rows: TRowData[];
	totalCount?: number;
	lastRow?: number;
	hasMore?: boolean;
}

export interface InfiniteDatasource<TRowData = unknown> {
	getRows(params: InfiniteGetRowsParams, context: { signal?: AbortSignal }): Promise<InfiniteGetRowsResult<TRowData>>;
}

export interface InfiniteBlockSnapshot {
	readonly blockIndex: number;
	readonly startRow: number;
	readonly endRow: number;
	readonly state: InfiniteBlockStatus;
	readonly committedRowCount: number;
	readonly requestId?: number;
	readonly queryGeneration: number;
	readonly lastAccessedAt: number;
	readonly error?: string;
}

export interface InfiniteRowModelOptions<TData = unknown> {
	blockSize?: number;
	maxBlocksInCache?: number;
	maxConcurrentRequests?: number;
	prefetchBlockCount?: number;
	datasource: InfiniteDatasource<TData>;
	columns: Array<ColumnDef<TData>>;
	getRowId?: (row: TData) => string;
}

const INFINITE_CAPABILITIES: RowModelCapabilities = {
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

type InfiniteBlockStatus = 'absent' | 'queued' | 'loadingInitial' | 'loaded' | 'refreshing' | 'failedInitial' | 'failedRefresh' | 'stale';

interface QueuedInfiniteBlockLoad {
	blockIndex: number;
	priority: number;
	sequence: number;
	forceReload: boolean;
}

class InfiniteBlock<TData = unknown> {
	public readonly blockIndex: number;
	public readonly startRow: number;
	public readonly endRow: number;
	public status: InfiniteBlockStatus = 'absent';
	public rows: Array<RowNode<TData> | null>;
	public error: string | null = null;
	public requestId = 0;
	public queryVersion = 0;
	public loadedAt: number | null = null;
	public lastAccessedAt: number;

	constructor(blockIndex: number, blockSize: number) {
		this.blockIndex = blockIndex;
		this.startRow = blockIndex * blockSize;
		this.endRow = this.startRow + blockSize - 1;
		this.rows = Array.from({ length: blockSize }, () => null);
		this.lastAccessedAt = InfiniteBlockCache.now();
	}
}

class InfiniteBlockCache<TData = unknown> {
	private readonly blocks = new Map<number, InfiniteBlock<TData>>();
	private knownRowCount: number | null = null;
	private estimatedRowCount = 0;

	public static now(): number {
		return typeof performance !== 'undefined' ? performance.now() : Date.now();
	}

	public reset(estimatedRowCount: number = 0): void {
		this.blocks.clear();
		this.knownRowCount = null;
		this.estimatedRowCount = Math.max(0, estimatedRowCount);
	}

	public getBlock(blockIndex: number): InfiniteBlock<TData> | null {
		const block = this.blocks.get(blockIndex) ?? null;
		if (block) block.lastAccessedAt = InfiniteBlockCache.now();
		return block;
	}

	public getBlockForRow(rowIndex: number, blockSize: number): InfiniteBlock<TData> | null {
		if (rowIndex < 0) return null;
		return this.getBlock(Math.floor(rowIndex / blockSize));
	}

	public dropQueuedBlock(blockIndex: number): void {
		const block = this.blocks.get(blockIndex);
		if (!block || block.status !== 'queued' || this.hasCommittedRows(block)) return;
		this.blocks.delete(blockIndex);
	}

	public markQueued(blockIndex: number, blockSize: number): InfiniteBlock<TData> {
		const block = this.ensureBlock(blockIndex, blockSize);
		if (!this.hasCommittedRows(block) && block.status !== 'loadingInitial') {
			block.status = 'queued';
			block.error = null;
			block.loadedAt = null;
		}
		block.lastAccessedAt = InfiniteBlockCache.now();
		return block;
	}

	public beginLoad(blockIndex: number, blockSize: number, requestId: number, queryVersion: number): InfiniteBlock<TData> {
		const block = this.ensureBlock(blockIndex, blockSize);
		const hasCommittedRows = this.hasCommittedRows(block);
		if (block.status === 'loaded' || block.status === 'failedRefresh') {
			block.status = 'stale';
		}
		block.status = hasCommittedRows ? 'refreshing' : 'loadingInitial';
		block.error = null;
		block.requestId = requestId;
		block.queryVersion = queryVersion;
		block.loadedAt = null;
		if (!hasCommittedRows) {
			block.rows = Array.from({ length: block.rows.length }, () => null);
		}
		block.lastAccessedAt = InfiniteBlockCache.now();
		return block;
	}

	public markLoaded(
		blockIndex: number,
		blockSize: number,
		requestId: number,
		queryVersion: number,
		rows: Array<RowNode<TData> | null>,
		returnedRowCount: number,
		totalCount?: number,
		options?: { canInferTerminalFromShortBlock?: boolean }
	): InfiniteBlock<TData> {
		const block = this.ensureBlock(blockIndex, blockSize);
		block.status = 'loaded';
		block.error = null;
		block.requestId = requestId;
		block.queryVersion = queryVersion;
		block.rows = rows;
		block.loadedAt = InfiniteBlockCache.now();
		block.lastAccessedAt = block.loadedAt;
		if (typeof totalCount === 'number') {
			this.knownRowCount = Math.max(0, totalCount);
			this.estimatedRowCount = Math.max(this.estimatedRowCount, this.knownRowCount);
			this.trimCommittedRowsToKnownCount();
		} else if (returnedRowCount < blockSize && options?.canInferTerminalFromShortBlock !== false) {
			this.knownRowCount = Math.max(0, block.startRow + returnedRowCount);
			this.estimatedRowCount = Math.max(this.estimatedRowCount, this.knownRowCount);
			this.trimCommittedRowsToKnownCount();
		} else {
			const provisionalReachableCount = block.startRow + returnedRowCount + blockSize;
			this.estimatedRowCount = Math.max(this.estimatedRowCount, provisionalReachableCount);
		}
		return block;
	}

	public markFailed(blockIndex: number, blockSize: number, requestId: number, queryVersion: number, error: string): InfiniteBlock<TData> {
		const block = this.ensureBlock(blockIndex, blockSize);
		const hasCommittedRows = this.hasCommittedRows(block);
		block.status = hasCommittedRows ? 'failedRefresh' : 'failedInitial';
		block.error = error;
		block.requestId = requestId;
		block.queryVersion = queryVersion;
		if (!hasCommittedRows) {
			block.rows = Array.from({ length: block.rows.length }, () => null);
		}
		block.loadedAt = null;
		block.lastAccessedAt = InfiniteBlockCache.now();
		return block;
	}

	public isBlockLoaded(blockIndex: number): boolean {
		return this.blocks.get(blockIndex)?.status === 'loaded';
	}

	public isBlockLoading(blockIndex: number): boolean {
		const status = this.blocks.get(blockIndex)?.status;
		return status === 'loadingInitial' || status === 'refreshing';
	}

	public getLoadingBlockCount(): number {
		let count = 0;
		for (const block of this.blocks.values()) {
			if (block.status === 'loadingInitial' || block.status === 'refreshing') count++;
		}
		return count;
	}

	public evictOverflow(maxBlocksInCache: number, protectedBlockIndexes: ReadonlySet<number>): boolean {
		if (maxBlocksInCache < 1 || this.blocks.size <= maxBlocksInCache) return false;

		let changed = false;
		const candidates = Array.from(this.blocks.values())
			.filter(
				(block) =>
					block.status !== 'loadingInitial' &&
					block.status !== 'refreshing' &&
					block.status !== 'queued' &&
					!protectedBlockIndexes.has(block.blockIndex)
			)
			.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);

		for (const candidate of candidates) {
			if (this.blocks.size <= maxBlocksInCache) break;
			changed = this.blocks.delete(candidate.blockIndex) || changed;
		}

		return changed;
	}

	public getKnownRowCount(): number | null {
		return this.knownRowCount;
	}

	public getEstimatedRowCount(): number {
		return this.knownRowCount ?? this.estimatedRowCount;
	}

	public getRowCountKind(): RowCountKind {
		if (this.knownRowCount !== null) return 'known';
		return this.estimatedRowCount > 0 ? 'estimated' : 'unknown';
	}

	public getVisualRowCount(): number {
		return this.knownRowCount ?? this.estimatedRowCount;
	}

	public getSelectableRowNodes(): RowNode<TData>[] {
		const nodes: RowNode<TData>[] = [];
		const orderedBlocks = Array.from(this.blocks.values()).sort((a, b) => a.blockIndex - b.blockIndex);
		for (const block of orderedBlocks) {
			if (!this.hasCommittedRows(block)) continue;
			for (const node of block.rows) {
				if (node) nodes.push(node);
			}
		}
		return nodes;
	}

	/** Blocks holding at least one committed row, by ascending block index. Does not touch LRU. */
	public getCommittedBlocksInOrder(): InfiniteBlock<TData>[] {
		return Array.from(this.blocks.values())
			.filter((block) => this.hasCommittedRows(block))
			.sort((a, b) => a.blockIndex - b.blockIndex);
	}

	/** Refreshes `lastAccessedAt` of every cached block starting at or before `rowIndex`, in block order. */
	public touchBlocksThrough(rowIndex: number): void {
		if (rowIndex < 0) return;
		const touched = Array.from(this.blocks.values())
			.filter((block) => block.startRow <= rowIndex)
			.sort((a, b) => a.blockIndex - b.blockIndex);
		for (const block of touched) block.lastAccessedAt = InfiniteBlockCache.now();
	}

	public getSnapshots(): readonly InfiniteBlockSnapshot[] {
		return Array.from(this.blocks.values())
			.sort((a, b) => a.blockIndex - b.blockIndex)
			.map((block) => ({
				blockIndex: block.blockIndex,
				startRow: block.startRow,
				endRow: block.endRow,
				state: block.status,
				committedRowCount: block.rows.reduce((count, row) => count + (row ? 1 : 0), 0),
				requestId: block.requestId > 0 ? block.requestId : undefined,
				queryGeneration: block.queryVersion,
				lastAccessedAt: block.lastAccessedAt,
				error: block.error ?? undefined,
			}));
	}

	public getCommittedRow(index: number, blockSize: number): RowNode<TData> | null {
		const block = this.getBlockForRow(index, blockSize);
		if (!block) return null;
		return block.rows[index - block.startRow] ?? null;
	}

	public resolveRowLoadState(index: number, blockSize: number): RowLoadState {
		if (index < 0) return { kind: 'missing' };
		const block = this.getBlockForRow(index, blockSize);
		if (!block) {
			return index < this.getVisualRowCount() ? { kind: 'loading', reason: 'infinite-block' } : { kind: 'missing' };
		}
		const localIndex = index - block.startRow;
		const committedNode = block.rows[localIndex];
		if (committedNode) {
			return { kind: 'loaded', rowId: committedNode.id };
		}
		switch (block.status) {
			case 'queued':
			case 'loadingInitial':
			case 'refreshing':
			case 'stale':
			case 'absent':
				return index < this.getVisualRowCount() ? { kind: 'loading', reason: 'infinite-block' } : { kind: 'missing' };
			case 'failedInitial':
			case 'failedRefresh':
				return { kind: 'failed', error: block.error ?? 'Unknown infinite block load failure', retryable: true };
			case 'loaded':
				return index < this.getVisualRowCount() ? { kind: 'loading', reason: 'infinite-block' } : { kind: 'missing' };
		}
	}

	private hasCommittedRows(block: InfiniteBlock<TData>): boolean {
		return block.rows.some((node) => node !== null);
	}

	private trimCommittedRowsToKnownCount(): void {
		if (this.knownRowCount === null) return;

		for (const [blockIndex, block] of this.blocks.entries()) {
			if (block.startRow >= this.knownRowCount) {
				this.blocks.delete(blockIndex);
				continue;
			}
			if (block.endRow < this.knownRowCount) continue;
			const firstOutOfRangeIndex = Math.max(0, this.knownRowCount - block.startRow);
			for (let localIndex = firstOutOfRangeIndex; localIndex < block.rows.length; localIndex++) {
				block.rows[localIndex] = null;
			}
		}
	}

	private ensureBlock(blockIndex: number, blockSize: number): InfiniteBlock<TData> {
		const existing = this.blocks.get(blockIndex);
		if (existing) return existing;
		const created = new InfiniteBlock<TData>(blockIndex, blockSize);
		this.blocks.set(blockIndex, created);
		return created;
	}
}

export class InfiniteRowModelController<TData = unknown>
	implements
		RowModel<TData>,
		DataRowCountModel,
		SelectableDataRowModel,
		InfiniteControllableRowModel<TData>,
		AnyModelCellWritable<TData>,
		VisibleBlockLoadCapableRowModel,
		CapableRowModel
{
	private readonly runtime: InfiniteRowModelRuntime<TData>;
	private datasource: InfiniteDatasource<TData>;
	private blockSize: number;
	private readonly maxBlocksInCache: number | null;
	private readonly maxConcurrentRequests: number;
	private readonly prefetchBlockCount: number;
	private nodeMap = new Map<string, RowNode<TData>>();
	private visualRowIdToIndex = new Map<string, number>();
	private rowIdToVisualIndex = new Map<string, number>();
	private readonly blockCache = new InfiniteBlockCache<TData>();
	private readonly activeAbortControllers = new Map<number, AbortController>();
	private readonly pendingBlockLoads = new Map<number, QueuedInfiniteBlockLoad>();
	private unsubscribers: Array<() => void> = [];
	private disposed = false;
	private datasourceGeneration = 0;
	private queryVersion = 0;
	private nextRequestId = 1;
	private nextQueueSequence = 1;
	private pendingVisibleLoad: { startRow: number; endRow: number } | null = null;
	private latestVisibleBlocks = new Set<number>();

	constructor(runtime: InfiniteRowModelRuntime<TData>, options: InfiniteRowModelOptions<TData>) {
		this.runtime = runtime;
		this.datasource = options.datasource;
		this.blockSize = options.blockSize ?? 100;
		this.maxBlocksInCache = options.maxBlocksInCache ?? null;
		this.maxConcurrentRequests =
			Number.isFinite(options.maxConcurrentRequests) && (options.maxConcurrentRequests ?? 0) > 0
				? Math.max(1, Math.floor(options.maxConcurrentRequests!))
				: Number.POSITIVE_INFINITY;
		this.prefetchBlockCount = Math.max(0, Math.floor(options.prefetchBlockCount ?? 2));

		this.runtime.initializeModel({
			columns: options.columns,
			getRowId: options.getRowId,
		});

		this.runtime.registerRowModel(this);

		this.unsubscribers.push(
			this.runtime.addEventListener(GridEventName.sortChanged, () => this.invalidateQueryCache()),
			this.runtime.addEventListener(GridEventName.filterChanged, () => this.invalidateQueryCache()),
			this.runtime.addEventListener(GridEventName.quickFilterChanged, () => this.invalidateQueryCache()),
			this.runtime.addEventListener(GridEventName.queryModelChanged, () => this.invalidateQueryCache())
		);

		this.queueBlockLoad(0, 0, false);
		this.pumpBlockLoadQueue();
	}

	public setDatasource(datasource: InfiniteDatasource<TData>, blockSize: number = this.blockSize): void {
		this.datasource = datasource;
		this.blockSize = blockSize;
		this.bumpDatasourceGeneration();
		this.resetCacheAndRefetch();
	}

	public dispose(): void {
		this.disposed = true;
		this.bumpDatasourceGeneration();
		this.abortAllInflightRequests();
		this.blockCache.reset();
		this.pendingBlockLoads.clear();
		this.pendingVisibleLoad = null;
		this.latestVisibleBlocks.clear();
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	public getCapabilities(): RowModelCapabilities {
		return INFINITE_CAPABILITIES;
	}

	/**
	 * Read-only live ownership gauges for deterministic resilience tests. These are
	 * intentionally separate from block snapshots and cumulative telemetry.
	 */
	public getOwnershipSnapshot(): Readonly<{
		cacheBlockCount: number;
		loadingBlockCount: number;
		pendingBlockLoadCount: number;
		activeAbortControllerCount: number;
		pendingVisibleLoadCount: number;
		visibleBlockCount: number;
		nodeCount: number;
		visualIndexCount: number;
	}> {
		return Object.freeze({
			cacheBlockCount: this.blockCache.getSnapshots().length,
			loadingBlockCount: this.blockCache.getLoadingBlockCount(),
			pendingBlockLoadCount: this.pendingBlockLoads.size,
			activeAbortControllerCount: this.activeAbortControllers.size,
			pendingVisibleLoadCount: this.pendingVisibleLoad === null ? 0 : 1,
			visibleBlockCount: this.latestVisibleBlocks.size,
			nodeCount: this.nodeMap.size,
			visualIndexCount: this.visualRowIdToIndex.size + this.rowIdToVisualIndex.size,
		});
	}

	public getVisualRow = (rowIndex: number): VisualRow<TData> | null => {
		const committedNode = this.blockCache.getCommittedRow(rowIndex, this.blockSize);
		if (committedNode) {
			return {
				kind: 'data',
				id: toDataVisualRowId(committedNode.id),
				rowId: committedNode.id,
				node: committedNode,
				hierarchy: FLAT_HIERARCHY,
			};
		}
		const state = this.getRowLoadState(rowIndex);
		if (state.kind === 'loaded') {
			const block = this.blockCache.getBlockForRow(rowIndex, this.blockSize);
			const node = block?.rows[rowIndex - (block?.startRow ?? 0)] ?? null;
			if (!node) return null;
			return {
				kind: 'data',
				id: toDataVisualRowId(node.id),
				rowId: node.id,
				node,
				hierarchy: FLAT_HIERARCHY,
			};
		}
		if (state.kind === 'failed') {
			return {
				kind: 'failed',
				id: toFailedVisualRowId(rowIndex),
				rowIndex,
				error: state.error,
				retryable: state.retryable,
				hierarchy: FLAT_HIERARCHY,
				editable: false,
			};
		}
		if (state.kind === 'loading') {
			return {
				kind: 'loading',
				id: toLoadingVisualRowId(rowIndex),
				rowIndex,
				hierarchy: FLAT_HIERARCHY,
				editable: false,
			};
		}
		return null;
	};

	public loadVisibleBlocks = (startRow: number, endRow: number): void => {
		this.loadBlockRange(startRow, endRow, false);
	};

	private loadBlockRange(startRow: number, endRow: number, forceReload: boolean): void {
		if (startRow > endRow) return;

		if (this.runtime.isScrollingFast()) {
			this.pendingVisibleLoad = { startRow, endRow };
			return;
		}

		// Once scrolling settles, the latest authoritative viewport wins. Older deferred
		// ranges crossed during fast scroll should not force intervening block loads.
		const effectiveStart = startRow;
		const effectiveEnd = endRow;
		this.pendingVisibleLoad = null;

		const minRow = Math.max(0, effectiveStart);
		const maxRepresentedRow = this.getVisualRowCount() > 0 ? Math.max(0, this.getVisualRowCount() - 1) : Math.max(0, effectiveEnd);
		const maxRow = Math.min(Math.max(0, effectiveEnd), maxRepresentedRow);
		if (minRow > maxRow) return;

		const visibleBlocks = new Set<number>();
		const minBlock = Math.floor(minRow / this.blockSize);
		const maxBlock = Math.floor(maxRow / this.blockSize);
		for (let blockIdx = minBlock; blockIdx <= maxBlock; blockIdx++) {
			visibleBlocks.add(blockIdx);
		}
		this.latestVisibleBlocks = new Set(visibleBlocks);

		const velocity = this.runtime.getScrollVelocity();
		const vy = velocity.vy;
		const totalBlocks = Math.ceil(this.getVisualRowCount() / this.blockSize);
		const requestedBlocks = new Set(visibleBlocks);

		const prefetchBlocks: number[] = [];
		if (vy > 0.1) {
			for (let offset = 1; offset <= this.prefetchBlockCount; offset++) {
				const ahead = maxBlock + offset;
				if (ahead < totalBlocks) prefetchBlocks.push(ahead);
			}
		} else if (vy < -0.1) {
			for (let offset = 1; offset <= this.prefetchBlockCount; offset++) {
				const ahead = minBlock - offset;
				if (ahead >= 0) prefetchBlocks.push(ahead);
			}
		}

		const shouldQueueBlock = (blockIdx: number): boolean => {
			const block = this.blockCache.getBlock(blockIdx);
			if (!forceReload && block) {
				// A viewport paint must preserve a failed initial block as a visible,
				// retryable failure. Retrying it here turns every render frame into an
				// implicit retry and makes the failed slot impossible to interact with.
				if (
					block.status === 'queued' ||
					block.status === 'loadingInitial' ||
					block.status === 'refreshing' ||
					block.status === 'failedInitial'
				) {
					return false;
				}
				if (block.status === 'loaded' && !this.blockHasRepresentedGap(block)) return false;
			}
			return true;
		};

		const desiredQueuedBlocks = new Set<number>(requestedBlocks);
		prefetchBlocks.forEach((blockIdx) => desiredQueuedBlocks.add(blockIdx));
		this.dropStaleQueuedLoads(desiredQueuedBlocks);

		requestedBlocks.forEach((blockIdx) => {
			if (!shouldQueueBlock(blockIdx)) return;
			this.queueBlockLoad(blockIdx, 0, forceReload);
		});
		prefetchBlocks.forEach((blockIdx) => {
			if (requestedBlocks.has(blockIdx)) return;
			if (!shouldQueueBlock(blockIdx)) return;
			this.queueBlockLoad(blockIdx, 1, forceReload);
		});
		this.pumpBlockLoadQueue();
	}

	public getRowNodeById = (rowId: string): RowNode<TData> | null => {
		return this.nodeMap.get(rowId) ?? null;
	};

	public getVisualRowCount = (): number => {
		return this.blockCache.getVisualRowCount();
	};

	public getKnownRowCount = (): number | null => {
		return this.blockCache.getKnownRowCount();
	};

	public getEstimatedRowCount = (): number => {
		return this.blockCache.getEstimatedRowCount();
	};

	public getRowCountKind = (): RowCountKind => {
		return this.blockCache.getRowCountKind();
	};

	public getDataRowCount = (): number => {
		return this.blockCache.getVisualRowCount();
	};

	public getVisualIndexById = (visualRowId: string): number => {
		const idx = this.visualRowIdToIndex.get(visualRowId);
		return idx !== undefined ? idx : -1;
	};

	public getVisualIndexByRowId = (rowId: string): number => {
		const idx = this.rowIdToVisualIndex.get(rowId);
		return idx !== undefined ? idx : -1;
	};

	public getRawRowById = (rowId: string): TData | null => {
		return this.nodeMap.get(rowId)?.data ?? null;
	};

	public getRowLoadState = (index: number): RowLoadState => {
		return this.blockCache.resolveRowLoadState(index, this.blockSize);
	};

	public isRowLoaded = (index: number): boolean => {
		return this.getRowLoadState(index).kind === 'loaded';
	};

	public isRowLoading = (index: number): boolean => {
		return this.getRowLoadState(index).kind === 'loading';
	};

	public isRowFailed = (index: number): boolean => {
		return this.getRowLoadState(index).kind === 'failed';
	};

	public isRangeLoaded = (startRow: number, endRow: number): boolean => {
		if (startRow > endRow) return true;
		for (let index = startRow; index <= endRow; index++) {
			if (!this.isRowLoaded(index)) return false;
		}
		return true;
	};

	public getRangeLoadState = (startRow: number, endRow: number): RowRangeLoadState => {
		const state: RowRangeLoadState = { loaded: 0, loading: 0, failed: 0, placeholder: 0, missing: 0 };
		if (startRow > endRow) return state;
		for (let index = startRow; index <= endRow; index++) {
			const rowState = this.getRowLoadState(index);
			state[rowState.kind]++;
		}
		return state;
	};

	public ensureRange = (startRow: number, endRow: number, reason?: string): void => {
		this.loadBlockRange(startRow, endRow, this.isRetryReason(reason));
	};

	public getSelectableDataRowIds = (scope: RowSelectionScope = 'loaded'): string[] => {
		if (scope === 'all' || scope === 'filtered') return [];
		// Infinite rows have no page concept. Treat `page` as the currently loaded cache window.
		return this.blockCache.getSelectableRowNodes().map((node) => node.id);
	};

	public writeCellValueStructurally = (
		rowId: string,
		colField: string,
		value: unknown,
		options?: { bypassValueSetter?: boolean }
	): RowModelWriteResult<TData> => {
		const node = this.nodeMap.get(rowId);
		if (!node) return { visualChange: 'none' };

		const col = this.runtime.getColumnDef(colField);
		const oldValue = this.runtime.getCellValue(rowId, colField);
		const updatedRow = { ...node.data };

		if (!options?.bypassValueSetter && col?.valueSetter) {
			const result = col.valueSetter({ value, oldValue, row: updatedRow, colField, abort: () => {} });
			if (!(result instanceof Promise) && !result) return { visualChange: 'none' };
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.setData(updatedRow);

		// Purge server cache if the edited field is part of server sort or filter —
		// the loaded blocks reflect a sort/filter order that is now stale.
		const state = this.runtime.getState();
		const affectsServerOrder =
			(state.sortModel?.some((s) => s.colId === colField) ?? false) || (state.filterModel != null && colField in state.filterModel);
		if (affectsServerOrder) this.purgeCache();

		const changedFieldsByRow = new Map<string, Set<string>>();
		changedFieldsByRow.set(rowId, new Set([colField]));
		return { updatedNodes: [node], changedFieldsByRow, visualChange: 'none' };
	};

	private fetchBlock = async (blockIndex: number): Promise<void> => {
		if (this.disposed) return;
		const requestId = this.nextRequestId++;
		const queryState = this.getQueryState();
		const existingBlock = this.blockCache.getBlock(blockIndex);
		if (existingBlock && this.blockCache.isBlockLoading(blockIndex)) {
			this.abortRequest(existingBlock.requestId);
		}
		const block = this.blockCache.beginLoad(blockIndex, this.blockSize, requestId, queryState.queryVersion);
		const requestStartedAt = InfiniteBlockCache.now();
		const previousRowCount = this.blockCache.getVisualRowCount();
		const abortController = new AbortController();
		this.activeAbortControllers.set(requestId, abortController);

		if (blockIndex === 0) this.runtime.setLoadingState(true);

		const startRow = block.startRow;
		const endRow = block.endRow + 1;
		const requestToken = this.createBlockRequestToken(blockIndex, startRow, endRow, requestId);

		const state = this.runtime.getState();
		const querySnapshot = createAsyncRowModelQuerySnapshot(state);

		try {
			const response = await this.datasource.getRows(
				{
					startRow,
					endRow,
					sortModel: querySnapshot.sortModel,
					filterModel: querySnapshot.filterModel,
					quickFilterModel: querySnapshot.quickFilterModel,
					queryModel: querySnapshot.queryModel,
				},
				{ signal: abortController.signal }
			);

			if (!this.isRequestTokenCurrent(requestToken)) return;
			validateInfiniteBlockResponse(response.rows, this.blockSize, (row) => this.runtime.getRowId(row as TData), {
				totalCount: response.totalCount,
				lastRow: response.lastRow,
				hasMore: response.hasMore,
				blockStartRow: startRow,
			});
			this.validateInfiniteBlockPlacement(response.rows, block.startRow, block.endRow);
			const terminalCount = resolveInfiniteTerminalCount({
				totalCount: response.totalCount,
				lastRow: response.lastRow,
				hasMore: response.hasMore,
				blockStartRow: startRow,
				returnedRowCount: response.rows.length,
			});
			const canInferTerminalFromShortBlock = response.hasMore !== true;

			const blockRows = Array.from({ length: this.blockSize }, () => null as RowNode<TData> | null);
			response.rows.forEach((row, idx) => {
				const typedRow = row as TData;
				if (!typedRow) return;
				const id = this.runtime.getRowId(typedRow);
				const existing = this.nodeMap.get(id);
				if (existing) {
					existing.setData(typedRow);
					blockRows[idx] = existing;
					return;
				}
				blockRows[idx] = new RowNode<TData>(id, typedRow);
			});

			this.blockCache.markLoaded(
				blockIndex,
				this.blockSize,
				requestToken.requestId,
				requestToken.queryVersion,
				blockRows,
				response.rows.length,
				terminalCount,
				{ canInferTerminalFromShortBlock }
			);
			this.evictOverflowBlocks();
			this.rebuildBlockDerivedIndexes();
			this.publishBlockRefresh(block, previousRowCount, 'rows:infinite-block-loaded');

			this.runtime.clearFormulas();
			this.runtime.setLoadingState(this.blockCache.getLoadingBlockCount() > 0);

			const requestFinishedAt = InfiniteBlockCache.now();
			this.runtime.dispatchInfiniteBlockLoaded({
				blockIndex,
				loadedBlockStart: startRow,
				loadedBlockEnd: startRow + response.rows.length - 1,
				totalRecords: terminalCount ?? this.blockCache.getVisualRowCount(),
				durationMs: requestFinishedAt - requestStartedAt,
			});
		} catch (error) {
			if (!this.isRequestTokenCurrent(requestToken)) return;
			const message = toErrorMessage(error);
			this.blockCache.markFailed(blockIndex, this.blockSize, requestToken.requestId, requestToken.queryVersion, message);
			this.evictOverflowBlocks();
			this.rebuildBlockDerivedIndexes();
			this.publishBlockRefresh(block, previousRowCount, 'rows:infinite-block-load-failed');
			this.runtime.dispatchInfiniteBlockLoadFailed({
				blockIndex,
				startRow,
				endRow: endRow - 1,
				message,
			});
			this.runtime.reportBlockLoadFailure(blockIndex, error);
			this.runtime.setLoadingState(this.blockCache.getLoadingBlockCount() > 0);
		} finally {
			this.activeAbortControllers.delete(requestId);
			this.pumpBlockLoadQueue();
		}
	};

	public purgeCache = (): void => {
		this.invalidateQueryCache();
	};

	public getBlockSnapshots = (): readonly InfiniteBlockSnapshot[] => {
		return this.blockCache.getSnapshots();
	};

	public refresh(_reason?: RowRefreshReason): RowModelRefreshResult {
		this.purgeCache();
		return { changed: true };
	}

	private getQueryState(): RowModelQueryState {
		return {
			datasourceGeneration: this.datasourceGeneration,
			queryVersion: this.queryVersion,
		};
	}

	private createBlockRequestToken(blockIndex: number, startRow: number, endRow: number, requestId: number): RowModelRequestToken {
		const queryState = this.getQueryState();
		return {
			kind: 'infinite-block',
			datasourceGeneration: queryState.datasourceGeneration,
			queryVersion: queryState.queryVersion,
			requestId,
			scopeId: createInfiniteBlockScopeId(blockIndex),
			blockIndex,
			startRow,
			endRow,
		};
	}

	private isRequestTokenCurrent(token: RowModelRequestToken): boolean {
		if (this.disposed) return false;
		if (token.kind !== 'infinite-block') return false;
		const block = this.blockCache.getBlock(token.blockIndex ?? -1);
		if (!block) return false;
		return (
			token.datasourceGeneration === this.datasourceGeneration &&
			token.queryVersion === this.queryVersion &&
			token.scopeId === createInfiniteBlockScopeId(block.blockIndex) &&
			token.requestId === block.requestId &&
			token.queryVersion === block.queryVersion
		);
	}

	private bumpDatasourceGeneration(): void {
		this.datasourceGeneration++;
	}

	private invalidateQueryCache(): void {
		this.queryVersion++;
		this.resetCacheAndRefetch();
	}

	private resetCacheAndRefetch(): void {
		if (this.disposed) return;
		this.abortAllInflightRequests();
		const previousVisualRowCount = this.blockCache.getVisualRowCount();
		this.blockCache.reset(previousVisualRowCount);
		this.pendingBlockLoads.clear();
		this.nodeMap.clear();
		this.visualRowIdToIndex.clear();
		this.rowIdToVisualIndex.clear();
		this.pendingVisibleLoad = null;
		this.latestVisibleBlocks.clear();
		this.runtime.clearFormulas();
		this.runtime.setLoadingState(true);
		this.queueBlockLoad(0, 0, false);
		this.pumpBlockLoadQueue();
	}

	private evictOverflowBlocks(): void {
		if (this.maxBlocksInCache === null) return;
		this.blockCache.evictOverflow(this.maxBlocksInCache, this.latestVisibleBlocks);
	}

	private abortRequest(requestId: number): void {
		const controller = this.activeAbortControllers.get(requestId);
		if (!controller) return;
		controller.abort();
		this.activeAbortControllers.delete(requestId);
	}

	private abortAllInflightRequests(): void {
		for (const requestId of this.activeAbortControllers.keys()) {
			this.abortRequest(requestId);
		}
	}

	private queueBlockLoad(blockIndex: number, priority: number, forceReload: boolean): void {
		if (this.disposed) return;
		const existingBlock = this.blockCache.getBlock(blockIndex);
		if (forceReload && existingBlock && this.blockCache.isBlockLoading(blockIndex)) {
			this.abortRequest(existingBlock.requestId);
		}
		const existing = this.pendingBlockLoads.get(blockIndex);
		if (existing) {
			existing.priority = Math.min(existing.priority, priority);
			existing.forceReload = existing.forceReload || forceReload;
			return;
		}
		this.blockCache.markQueued(blockIndex, this.blockSize);
		this.pendingBlockLoads.set(blockIndex, {
			blockIndex,
			priority,
			sequence: this.nextQueueSequence++,
			forceReload,
		});
	}

	private pumpBlockLoadQueue(): void {
		if (this.disposed) return;
		while (this.activeAbortControllers.size < this.maxConcurrentRequests) {
			const nextQueued = this.dequeueNextBlockLoad();
			if (!nextQueued) return;
			const existingBlock = this.blockCache.getBlock(nextQueued.blockIndex);
			if (existingBlock && this.blockCache.isBlockLoading(nextQueued.blockIndex) && this.activeAbortControllers.has(existingBlock.requestId))
				continue;
			void this.fetchBlock(nextQueued.blockIndex);
		}
	}

	private dropStaleQueuedLoads(retainedBlockIndexes: ReadonlySet<number>): void {
		for (const [blockIndex, queued] of this.pendingBlockLoads.entries()) {
			if (!retainedBlockIndexes.has(blockIndex)) {
				this.pendingBlockLoads.delete(blockIndex);
				this.blockCache.dropQueuedBlock(queued.blockIndex);
			}
		}
	}

	private dequeueNextBlockLoad(): QueuedInfiniteBlockLoad | null {
		if (this.pendingBlockLoads.size === 0) return null;
		let best: QueuedInfiniteBlockLoad | null = null;
		for (const queued of this.pendingBlockLoads.values()) {
			if (best === null || queued.priority < best.priority || (queued.priority === best.priority && queued.sequence < best.sequence)) {
				best = queued;
			}
		}
		if (!best) return null;
		this.pendingBlockLoads.delete(best.blockIndex);
		return best;
	}

	/**
	 * Rebuilds the id → visual index maps in O(committed rows) by walking the blocks in order and
	 * using `block.startRow + offset` (the SSRM approach). Previously each node scanned from row 0,
	 * which was quadratic in the loaded row count. Semantics are unchanged: a row id maps to its
	 * first in-range occurrence, and `nodeMap` keeps the last committed node for that id.
	 */
	private rebuildBlockDerivedIndexes(): void {
		this.nodeMap.clear();
		this.visualRowIdToIndex.clear();
		this.rowIdToVisualIndex.clear();
		const rowCount = this.blockCache.getVisualRowCount();
		const committedBlocks = this.blockCache.getCommittedBlocksInOrder();
		let hasNodes = false;
		let unresolvedNode = false;
		let maxResolvedIndex = -1;
		for (const block of committedBlocks) {
			const limit = Math.min(block.rows.length, this.blockSize, rowCount - block.startRow);
			for (let offset = 0; offset < limit; offset++) {
				const node = block.rows[offset];
				if (!node || this.rowIdToVisualIndex.has(node.id)) continue;
				const visualIndex = block.startRow + offset;
				this.rowIdToVisualIndex.set(node.id, visualIndex);
				this.visualRowIdToIndex.set(toDataVisualRowId(node.id), visualIndex);
			}
		}
		for (const block of committedBlocks) {
			for (const node of block.rows) {
				if (!node) continue;
				hasNodes = true;
				const visualIndex = this.rowIdToVisualIndex.get(node.id);
				if (visualIndex === undefined) {
					unresolvedNode = true;
					continue;
				}
				if (visualIndex > maxResolvedIndex) maxResolvedIndex = visualIndex;
				this.nodeMap.set(node.id, node);
			}
		}
		// The old per-node scan read every block up to the furthest row it looked at, refreshing
		// their LRU timestamps in block order. Keep that eviction ordering without the scan.
		if (hasNodes) this.blockCache.touchBlocksThrough(unresolvedNode ? rowCount - 1 : maxResolvedIndex);
	}

	private isRetryReason(reason?: string): boolean {
		return reason === 'row-node-retry-load' || reason === 'retry' || reason === 'force-reload';
	}

	private blockHasRepresentedGap(block: InfiniteBlock<TData>): boolean {
		const lastRepresentedIndex = Math.min(block.endRow, this.blockCache.getVisualRowCount() - 1);
		if (lastRepresentedIndex < block.startRow) return false;
		for (let index = block.startRow; index <= lastRepresentedIndex; index++) {
			if (!block.rows[index - block.startRow]) return true;
		}
		return false;
	}

	private validateInfiniteBlockPlacement(rows: readonly TData[], blockStartRow: number, blockEndRow: number): void {
		rows.forEach((row, index) => {
			const rowId = this.runtime.getRowId(row);
			const existingVisualIndex = this.rowIdToVisualIndex.get(rowId);
			const nextVisualIndex = blockStartRow + index;
			if (
				existingVisualIndex !== undefined &&
				existingVisualIndex !== nextVisualIndex &&
				(existingVisualIndex < blockStartRow || existingVisualIndex > blockEndRow)
			) {
				throw new Error(
					`Infinite datasource returned row id "${rowId}" for visual index ${nextVisualIndex}, but that row id is already committed at visual index ${existingVisualIndex}`
				);
			}
		});
	}

	private publishBlockRefresh(
		block: InfiniteBlock<TData>,
		previousRowCount: number,
		requestRenderReason: 'rows:infinite-block-loaded' | 'rows:infinite-block-load-failed'
	): void {
		const nextRowCount = this.blockCache.getVisualRowCount();
		const maxVisibleIndex = nextRowCount > 0 ? nextRowCount - 1 : block.endRow;
		this.runtime.publishAsyncRowModelUpdate({
			refreshResult: {
				changed: true,
				reason: 'refresh',
				previousRowCount,
				nextRowCount,
				changedStartIndex: block.startRow,
				changedEndIndex: Math.max(block.startRow, Math.min(block.endRow, maxVisibleIndex)),
			},
			invalidationReason: 'viewport',
			requestRenderReason,
		});
	}
}
