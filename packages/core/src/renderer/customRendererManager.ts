import { getColumnInstanceIdentity, type ColumnDef, type CellRendererPhase } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import type { GridCellContentMount, GridCellContentUnmount, RendererLifecycleOperation } from './IGridRenderer.js';
import type { GridEngine } from '../engine/GridEngine.js';
import { createEditRendererKey, createSlotRendererKey, createIndexRendererKey } from './identityKeys.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';

export interface RendererInstance<TRowData = unknown> {
	rendererKey: string;
	cellKey: string;
	rowSlotId: string;
	slotGeneration: number;
	cellRowBindingGeneration: number;
	/**
	 * Physical CellSlot identity last sent to the adapter. Forwarded on every mount, update and
	 * unmount so the adapter's strict identity check (React portal store) matches — an unmount
	 * without it is silently rejected, leaking the React subtree in a detached container.
	 */
	cellInstanceId?: string;
	portalHostId?: string;
	container: HTMLDivElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase: CellRendererPhase;
	isScrolling: boolean;
	isFocused: boolean;
	isSelected: boolean;
	lastAccessTime: number;
}

export interface AcquireRendererParams<TRowData = unknown> {
	rendererKey: string;
	cellKey: string;
	rowSlotId: string;
	slotGeneration: number;
	cellRowBindingGeneration: number;
	cellInstanceId?: string;
	portalHostId?: string;
	parentContainer: HTMLElement;
	value: unknown;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isLoading: boolean;
	phase: CellRendererPhase;
	isScrolling: boolean;
	isFocused: boolean;
	isSelected: boolean;
}

export type ReleaseReason = 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated';

export interface CustomRendererStats {
	activeCount: number;
	warmCount: number;
	pendingWarmMoveCount: number;
	totalAcquires: number;
	warmHits: number;
	warmMisses: number;
	evictions: number;
	// hydration budget tracking
	hydrationChunks: number;
	maxHydratedInOneChunk: number;
	// warm DOM move tracking
	warmMovesDeferred: number;
	warmMovesFlushed: number;
}

export class CustomRendererManager<TRowData = unknown> {
	public onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	public onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;

	private activeRenderersByCellKey = new Map<string, RendererInstance<TRowData>>();
	private activeRenderersByRendererKey = new Map<string, RendererInstance<TRowData>>();
	private activeRendererKeyByParentContainer = new Map<HTMLElement, string>();
	/** Warm cache in LRU order: Map insertion order, touched via delete+set, evicted from the front. */
	private warmRenderersByRendererKey = new Map<string, RendererInstance<TRowData>>();
	private lruCounter = 0;

	// Limits
	/** Explicit override set via setLimits(); takes precedence over the live runtimeLimits config. */
	private maxWarmOverride: number | null = null;
	private ttlMs = 30000; // 30s TTL

	/**
	 * Live-read from runtimeLimits so a config change takes effect immediately without needing
	 * an explicit setLimits() call. Falls back to 300 if unset/no engine (e.g. in isolated tests).
	 * Undersizing this relative to how many distinct custom-renderer cells a user scrolls past
	 * before reversing direction causes cold-mount thrashing — see customRendererManager.test.ts.
	 */
	private get maxWarm(): number {
		if (this.maxWarmOverride !== null) return this.maxWarmOverride;
		const configured = this.engine?.stateManager.getState().runtimeLimits?.maxWarmCustomRenderers;
		return typeof configured === 'number' && configured > 0 ? configured : 300;
	}

	// Stats
	private stats: CustomRendererStats = {
		activeCount: 0,
		warmCount: 0,
		pendingWarmMoveCount: 0,
		totalAcquires: 0,
		warmHits: 0,
		warmMisses: 0,
		evictions: 0,
		hydrationChunks: 0,
		maxHydratedInOneChunk: 0,
		warmMovesDeferred: 0,
		warmMovesFlushed: 0,
	};

	// Warm DOM moves deferred during scroll — flushed in budgeted chunks after scroll idle.
	// Only the count matters (containers already moved in releaseInstance) — a counter avoids
	// retaining released instances and the per-flush splice() array allocation.
	private pendingWarmMoves = 0;
	private runtimeStats: RenderRuntimeStats | null = null;

	private hiddenContainer: HTMLDivElement | null = null;

	constructor(private engine?: GridEngine<TRowData>) {}

	public setRuntimeStats(stats: RenderRuntimeStats): void {
		this.runtimeStats = stats;
	}

	private ensureHiddenContainer(): HTMLDivElement | null {
		if (!this.hiddenContainer && typeof document !== 'undefined') {
			this.hiddenContainer = document.createElement('div');
			this.hiddenContainer.className = 'og-hidden-renderer-container';
			this.hiddenContainer.style.display = 'none';
			document.body.appendChild(this.hiddenContainer);
		}
		return this.hiddenContainer;
	}

	public getStats(): CustomRendererStats {
		this.stats.activeCount = this.activeRenderersByRendererKey.size;
		this.stats.warmCount = this.warmRenderersByRendererKey.size;
		this.stats.pendingWarmMoveCount = this.pendingWarmMoves;
		return { ...this.stats };
	}

	public resetStats(): void {
		this.stats = {
			activeCount: this.activeRenderersByRendererKey.size,
			warmCount: this.warmRenderersByRendererKey.size,
			pendingWarmMoveCount: this.pendingWarmMoves,
			totalAcquires: 0,
			warmHits: 0,
			warmMisses: 0,
			evictions: 0,
			hydrationChunks: 0,
			maxHydratedInOneChunk: 0,
			warmMovesDeferred: 0,
			warmMovesFlushed: 0,
		};
	}

	public setLimits(maxWarm: number, ttlMs: number): void {
		this.maxWarmOverride = maxWarm;
		this.ttlMs = ttlMs;
		this.pruneWarmCache();
	}

	public getRendererKey(col: ColumnDef<TRowData>, rowId: string, rowIndex: number, colIndex: number, isEditing: boolean): string {
		const columnInstanceId = getColumnInstanceIdentity(col);
		if (isEditing) {
			return createEditRendererKey(rowId, columnInstanceId);
		}
		const pooledRow = (this.engine as any)?.rowRenderer?.activeRows.get(rowIndex);
		if (pooledRow?.id) {
			return createSlotRendererKey(pooledRow.id, columnInstanceId);
		}
		return createIndexRendererKey(rowIndex, colIndex, columnInstanceId);
	}

	public acquire(params: AcquireRendererParams<TRowData>): RendererInstance<TRowData> {
		this.stats.totalAcquires++;
		// The force-live-interactive-exception phase is the ONE mount deliberately permitted during
		// active scroll (editing/focus mid-gesture) — it is counted separately via
		// forceLiveMountsDuringScroll (see rowCellBinder.ts), never folded into this generic counter,
		// so a regression that makes ordinary cells mount here stays visible.
		if (params.isScrolling && params.phase !== 'scroll-force-live' && this.engine) {
			this.engine.customRendererMountsDuringScroll++;
		}
		if (!params.isScrolling && !this.engine?.isScrolling) {
			this.pruneWarmCache();
		}

		// 1. Check if already active
		let instance = this.activeRenderersByRendererKey.get(params.rendererKey);
		if (!instance) {
			const logicalInstance = this.activeRenderersByCellKey.get(params.cellKey);
			if (logicalInstance?.rendererKey === params.rendererKey) {
				instance = logicalInstance;
			}
		}
		if (instance) {
			this.rebindInstance(instance, params, 'update');
			return instance;
		}

		// 2. Check if in warm cache
		instance = this.warmRenderersByRendererKey.get(params.rendererKey);
		if (instance) {
			this.stats.warmHits++;
			if (this.engine) {
				this.engine.customRendererWarmHits++;
			}
			this.warmRenderersByRendererKey.delete(params.rendererKey);
			this.rebindInstance(instance, params, 'restore');
			return instance;
		}

		// 3. Warm Miss: Create a new container element and trigger React portal mount
		this.stats.warmMisses++;
		if (this.engine) {
			this.engine.customRendererWarmMisses++;
		}
		const container = document.createElement('div');
		container.className = 'og-custom-renderer-container';
		container.dataset.rendererKey = params.rendererKey;
		container.dataset.cellKey = params.cellKey;
		params.parentContainer.appendChild(container);

		const newInstance: RendererInstance<TRowData> = {
			rendererKey: params.rendererKey,
			cellKey: params.cellKey,
			rowSlotId: params.rowSlotId,
			slotGeneration: params.slotGeneration,
			cellRowBindingGeneration: params.cellRowBindingGeneration,
			cellInstanceId: params.cellInstanceId,
			portalHostId: params.portalHostId,
			container,
			value: params.value,
			node: params.node,
			col: params.col,
			isEditing: params.isEditing,
			isLoading: params.isLoading,
			phase: params.phase,
			isScrolling: params.isScrolling,
			isFocused: params.isFocused,
			isSelected: params.isSelected,
			lastAccessTime: ++this.lruCounter,
		};

		this.removeSiblingContainers(newInstance.rendererKey, params.parentContainer, newInstance.container);
		this.registerActive(newInstance);
		if (this.runtimeStats) {
			this.runtimeStats.reactMounts++;
		}

		this.onMountCellContent?.({
			cellKey: params.cellKey,
			rowSlotId: params.rowSlotId,
			slotGeneration: params.slotGeneration,
			cellRowBindingGeneration: params.cellRowBindingGeneration,
			cellInstanceId: params.cellInstanceId,
			portalHostId: params.portalHostId,
			container,
			value: params.value,
			node: params.node,
			col: params.col,
			isEditing: params.isEditing,
			isLoading: params.isLoading,
			phase: params.phase,
			isScrolling: params.isScrolling,
			isFocused: params.isFocused,
			isSelected: params.isSelected,
			lifecycleOperation: 'mount',
		});

		return newInstance;
	}

	public releaseByCellKey(cellKey: string, reason: ReleaseReason): boolean {
		const instance = this.activeRenderersByCellKey.get(cellKey);
		if (!instance) return false;
		return this.releaseInstance(instance, reason);
	}

	public releaseByParentContainer(parentContainer: HTMLElement, reason: ReleaseReason): boolean {
		const rendererKey = this.activeRendererKeyByParentContainer.get(parentContainer);
		if (!rendererKey) return false;
		const instance = this.activeRenderersByRendererKey.get(rendererKey);
		if (!instance) {
			this.activeRendererKeyByParentContainer.delete(parentContainer);
			return false;
		}
		return this.releaseInstance(instance, reason);
	}

	private releaseInstance(instance: RendererInstance<TRowData>, reason: ReleaseReason): boolean {
		this.unregisterActive(instance);

		// If reason is scrolled-out, cache it in warm cache instead of destroying
		if (reason === 'scrolled-out' && this.maxWarm > 0) {
			instance.lastAccessTime = ++this.lruCounter;
			this.touchWarm(instance);

			// Move renderer to hiddenContainer immediately so it's out of the cell DOM.
			// Deferring this move would leave the renderer physically inside the cell, making
			// DOM integrity checks fail (renderer.dataset.cellKey ≠ cell.dataset.cellKey).
			const hiddenContainer = this.ensureHiddenContainer();
			if (hiddenContainer && instance.container.parentElement !== hiddenContainer) {
				hiddenContainer.appendChild(instance.container);
			}
			if (this.engine?.isScrolling) {
				// During scroll, defer pruneWarmCache (LRU eviction work) to avoid extra
				// style recalculations caused by destroying instances mid-scroll.
				this.pendingWarmMoves++;
				this.stats.warmMovesDeferred++;
			} else {
				this.pruneWarmCache();
			}
			return true;
		}

		// Otherwise, destroy immediately
		if (this.runtimeStats) {
			this.runtimeStats.reactUnmounts++;
		}
		this.destroyInstance(instance);
		return true;
	}

	/**
	 * Flush deferred warm DOM moves in budgeted chunks after scroll idle.
	 * Returns the number of moves performed.
	 */
	public flushPendingWarmMoves(maxItems = 16): number {
		// Containers were already moved to hiddenContainer in releaseInstance.
		// This flush just runs the deferred pruneWarmCache (LRU eviction) work.
		if (this.pendingWarmMoves === 0) return 0;
		const count = Math.min(maxItems, this.pendingWarmMoves);
		this.pendingWarmMoves -= count;
		this.stats.warmMovesFlushed += count;
		if (!this.engine?.isScrolling) {
			this.pruneWarmCache();
		}
		return count;
	}

	/**
	 * Flush warm move budget — move deferred scroll-out containers to the hidden
	 * container in budgeted chunks.
	 */
	public flushWarmMoveBudget(options: { maxItems?: number; deadlineMs?: number } = {}): { warmMovesFlushed: number } {
		const maxItems = options.maxItems ?? 16;
		const moved = this.flushPendingWarmMoves(maxItems);
		if (moved > 0) {
			this.stats.hydrationChunks++;
			this.stats.maxHydratedInOneChunk = Math.max(this.stats.maxHydratedInOneChunk, moved);
		}
		return { warmMovesFlushed: moved };
	}

	/** Number of scroll-time warm releases whose deferred pruneWarmCache work has not flushed yet. */
	public getPendingWarmMoveCount(): number {
		return this.pendingWarmMoves;
	}

	public hasActiveRenderer(cellKey: string): boolean {
		return this.activeRenderersByCellKey.has(cellKey);
	}

	public releaseAll(): void {
		this.pendingWarmMoves = 0;
		for (const instance of this.activeRenderersByRendererKey.values()) {
			this.destroyInstance(instance);
		}
		this.activeRenderersByCellKey.clear();
		this.activeRenderersByRendererKey.clear();
		this.activeRendererKeyByParentContainer.clear();

		for (const instance of this.warmRenderersByRendererKey.values()) {
			this.destroyInstance(instance);
		}
		this.warmRenderersByRendererKey.clear();
		this.lruCounter = 0;
		this.hiddenContainer?.remove();
		this.hiddenContainer = null;
	}

	private registerActive(instance: RendererInstance<TRowData>): void {
		this.activeRenderersByCellKey.set(instance.cellKey, instance);
		this.activeRenderersByRendererKey.set(instance.rendererKey, instance);
		const parent = instance.container.parentElement;
		if (parent) {
			this.activeRendererKeyByParentContainer.set(parent, instance.rendererKey);
		}
	}

	private unregisterActive(instance: RendererInstance<TRowData>): void {
		this.activeRenderersByCellKey.delete(instance.cellKey);
		this.activeRenderersByRendererKey.delete(instance.rendererKey);
		const parent = instance.container.parentElement;
		if (parent && this.activeRendererKeyByParentContainer.get(parent) === instance.rendererKey) {
			this.activeRendererKeyByParentContainer.delete(parent);
		}
	}

	private rebindInstance(
		instance: RendererInstance<TRowData>,
		params: AcquireRendererParams<TRowData>,
		operation: RendererLifecycleOperation = 'update'
	): void {
		// Detect whether any props the renderer cares about actually changed before
		// notifying React — avoids a reconciliation round trip on stayed cells.
		const needsUpdate =
			instance.value !== params.value ||
			instance.node !== params.node ||
			instance.col !== params.col ||
			instance.isEditing !== params.isEditing ||
			instance.isLoading !== params.isLoading ||
			instance.isFocused !== params.isFocused ||
			instance.isSelected !== params.isSelected ||
			instance.phase !== params.phase ||
			instance.isScrolling !== params.isScrolling ||
			instance.rendererKey !== params.rendererKey ||
			instance.cellKey !== params.cellKey ||
			instance.cellRowBindingGeneration !== params.cellRowBindingGeneration ||
			// Physical identity changes must reach the adapter too: it rejects any later update or
			// unmount whose identity differs from the one it last stored.
			instance.rowSlotId !== params.rowSlotId ||
			instance.slotGeneration !== params.slotGeneration ||
			instance.cellInstanceId !== params.cellInstanceId ||
			instance.portalHostId !== params.portalHostId;

		this.unregisterActive(instance);
		const keysChanged = instance.rendererKey !== params.rendererKey || instance.cellKey !== params.cellKey;
		instance.rendererKey = params.rendererKey;
		instance.cellKey = params.cellKey;
		instance.rowSlotId = params.rowSlotId;
		instance.slotGeneration = params.slotGeneration;
		instance.cellRowBindingGeneration = params.cellRowBindingGeneration;
		instance.cellInstanceId = params.cellInstanceId;
		instance.portalHostId = params.portalHostId;
		instance.value = params.value;
		instance.node = params.node;
		instance.col = params.col;
		instance.isEditing = params.isEditing;
		instance.isLoading = params.isLoading;
		instance.phase = params.phase;
		instance.isScrolling = params.isScrolling;
		instance.isFocused = params.isFocused;
		instance.isSelected = params.isSelected;
		instance.lastAccessTime = Date.now();
		// Attribute writes are DOM mutations even with an unchanged value; skip them on a same-key rebind.
		if (keysChanged) {
			instance.container.dataset.rendererKey = params.rendererKey;
			instance.container.dataset.cellKey = params.cellKey;
		}

		if (instance.container.parentElement !== params.parentContainer) {
			params.parentContainer.appendChild(instance.container);
		}
		this.removeSiblingContainers(instance.rendererKey, params.parentContainer, instance.container);
		this.registerActive(instance);

		if (needsUpdate) {
			if (this.runtimeStats) {
				this.runtimeStats.reactRefreshes++;
			}
			this.onMountCellContent?.({
				cellKey: params.cellKey,
				rowSlotId: params.rowSlotId,
				slotGeneration: params.slotGeneration,
				cellRowBindingGeneration: params.cellRowBindingGeneration,
				cellInstanceId: params.cellInstanceId,
				portalHostId: params.portalHostId,
				container: instance.container,
				value: params.value,
				node: params.node,
				col: params.col,
				isEditing: params.isEditing,
				isLoading: params.isLoading,
				phase: params.phase,
				isScrolling: params.isScrolling,
				isFocused: params.isFocused,
				isSelected: params.isSelected,
				lifecycleOperation: operation,
			});
		}
	}

	private removeSiblingContainers(rendererKey: string, parentContainer: HTMLElement, activeContainer: HTMLElement): void {
		const previousRendererKey = this.activeRendererKeyByParentContainer.get(parentContainer);
		if (previousRendererKey && previousRendererKey !== rendererKey) {
			const previousInstance = this.activeRenderersByRendererKey.get(previousRendererKey);
			if (previousInstance) {
				this.unregisterActive(previousInstance);
				this.destroyInstance(previousInstance);
			}
		}
		this.activeRendererKeyByParentContainer.set(parentContainer, rendererKey);

		const children = parentContainer.children;
		for (let i = children.length - 1; i >= 0; i--) {
			const child = children[i];
			if (child !== activeContainer && child.classList.contains('og-custom-renderer-container')) {
				child.remove();
			}
		}
	}

	private touchWarm(instance: RendererInstance<TRowData>): void {
		// delete+set moves the key to the back of the Map's insertion order (most recently used).
		this.warmRenderersByRendererKey.delete(instance.rendererKey);
		this.warmRenderersByRendererKey.set(instance.rendererKey, instance);
	}

	private destroyInstance(instance: RendererInstance<TRowData>): void {
		const activeInstance = this.activeRenderersByCellKey.get(instance.cellKey);
		if (activeInstance === undefined || activeInstance === instance) {
			this.onUnmountCellContent?.({
				cellKey: instance.cellKey,
				container: instance.container,
				flushSync: false,
				rowSlotId: instance.rowSlotId,
				slotGeneration: instance.slotGeneration,
				cellRowBindingGeneration: instance.cellRowBindingGeneration,
				cellInstanceId: instance.cellInstanceId,
				portalHostId: instance.portalHostId,
			});
		}
		delete instance.container.dataset.rendererKey;
		delete instance.container.dataset.cellKey;
		instance.container.remove();
	}

	private pruneWarmCache(): void {
		// Prune by size limit — evict the LRU entry whenever the warm cache exceeds maxWarm.
		// Note: we intentionally do NOT evict by a counter-based "TTL" here. The lruCounter
		// increments on both warm-releases and warm-misses (new instance creation), so a
		// naive staleThreshold = lruCounter - maxWarm*2 drifts ahead of warm-entry timestamps
		// during post-scroll decoration (when many new slots are created), causing legitimate
		// scroll-released entries to be falsely destroyed and firing onUnmountCellContent
		// during what should be a deferred-unmount window. Size-based LRU eviction is
		// sufficient to bound memory. The Map's first entry is the least recently used — O(1).
		while (this.warmRenderersByRendererKey.size > this.maxWarm) {
			const oldest = this.warmRenderersByRendererKey.entries().next();
			if (oldest.done) break;
			const [oldestKey, instance] = oldest.value;
			this.warmRenderersByRendererKey.delete(oldestKey);
			this.stats.evictions++;
			this.destroyInstance(instance);
		}
	}
}
