import type {
	GridCellContentMount,
	GridCellContentUnmount,
	GridHeaderMenuMount,
	GridHeaderMenuUnmount,
	GridRowContentMount,
	GridRowContentUnmount,
} from './IGridRenderer.js';
import type { InternalColumnDef, DomCellRenderer } from '../columnDef.js';
import { getColumnInstanceIdentity, isDomCellRenderer } from '../columnDef.js';
import type { VisualRow } from '../visualRow.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';
import { CustomRendererManager, type ReleaseReason } from './customRendererManager.js';
import { DomCellRendererManager } from './domCellRendererManager.js';
import { reportRendererFault } from './rendererFaults.js';
import {
	createEditRendererKey,
	createSlotRendererKey,
	createIndexRendererKey,
	createDomSlotRendererKey,
	createDomIndexRendererKey,
	createCellInstanceRendererKey,
} from './identityKeys.js';
import { GridMetric } from '../diagnostics/GridInstrumentation.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';
import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';
import { readInteractionState } from '../interaction/interactionState.js';

function isVisualRowEqual<TRowData>(a: VisualRow<TRowData> | undefined, b: VisualRow<TRowData> | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (a.kind !== b.kind) return false;
	if (a.id !== b.id) return false;

	if (a.kind === 'group' && b.kind === 'group') {
		return a.field === b.field && a.key === b.key && a.expanded === b.expanded && a.depth === b.depth && a.childCount === b.childCount;
	}
	if (a.kind === 'detail' && b.kind === 'detail') {
		return a.parentId === b.parentId && a.parentRowId === b.parentRowId && a.height === b.height;
	}
	if (a.kind === 'loading' && b.kind === 'loading') {
		return a.rowIndex === b.rowIndex;
	}
	if (a.kind === 'failed' && b.kind === 'failed') {
		return a.rowIndex === b.rowIndex && a.error === b.error && a.retryable === b.retryable;
	}
	if (a.kind === 'placeholder' && b.kind === 'placeholder') {
		return a.rowIndex === b.rowIndex && a.reason === b.reason;
	}
	if (a.kind === 'data' && b.kind === 'data') {
		return a.rowId === b.rowId && a.node === b.node && a.depth === b.depth;
	}
	if (a.kind === 'footer' && b.kind === 'footer') {
		return a.parentGroupId === b.parentGroupId && a.depth === b.depth;
	}
	return false;
}

export interface DeferredPortalFlushOptions {
	maxItems?: number;
	reason?: string;
	flushSync?: boolean;
	/**
	 * Idle deadline — when provided, the flush stops early once timeRemaining() hits 0
	 * (after at least one op, to guarantee progress). When the idle callback fired via
	 * its timeout (didTimeout), the deadline is ignored: we are already late, so the
	 * full op budget is used to drain faster.
	 */
	deadline?: { timeRemaining(): number; readonly didTimeout: boolean };
}

/** Flush budget check — module-level so flushDeferred allocates no closure per call. */
function isFlushOutOfBudget(budgetUsed: number, maxItems: number, deadline: DeferredPortalFlushOptions['deadline'], processed: number): boolean {
	return budgetUsed >= maxItems || (deadline !== undefined && processed > 0 && deadline.timeRemaining() <= 0);
}

export interface DeferredPortalFlushResult {
	processed: number;
	remaining: number;
}

/** Full physical identity record for a mounted cell portal. Stored in activeIdentityByKey. */
interface CellPortalPhysicalIdentity {
	cellInstanceId: string;
	portalHostId: string;
	rowSlotId: string;
	slotGeneration: number;
	cellRowBindingGeneration: number;
}

export class PortalMountManager<TRowData = unknown> {
	public onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	public onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;
	public onFlushCellContent?: (flush: { flushSync?: boolean }) => void;
	public onMountRowContent?: (mount: GridRowContentMount<TRowData>) => void;
	public onUnmountRowContent?: (unmount: GridRowContentUnmount) => void;
	public onMountHeaderMenu?: (mount: GridHeaderMenuMount<TRowData>) => void;
	public onUnmountHeaderMenu?: (unmount: GridHeaderMenuUnmount) => void;

	public customRendererManager: CustomRendererManager<TRowData>;
	public domCellRendererManager: DomCellRendererManager<TRowData>;
	private getPhysicalRowSlotId?: (rowIndex: number) => string | undefined;

	constructor(private engine?: GridEngine<TRowData>) {
		this.customRendererManager = new CustomRendererManager<TRowData>(engine);
		this.customRendererManager.onMountCellContent = (mount) => {
			this.onMountCellContent?.(mount);
		};
		this.customRendererManager.onUnmountCellContent = (unmount) => {
			this.onUnmountCellContent?.(unmount);
		};
		this.domCellRendererManager = new DomCellRendererManager<TRowData>(engine);
	}

	public setPhysicalRowSlotIdResolver(resolver: (rowIndex: number) => string | undefined): void {
		this.getPhysicalRowSlotId = resolver;
	}

	private mountedCells = new Map<string, HTMLElement | undefined>();
	private mountedRows = new Map<string, HTMLElement | undefined>();
	// Pre-allocated priority buckets for flushDeferred — zero allocation per flush.
	// Bucket layout: [0] active-edit (≥1000), [1] focused (≥900), [2] everything else.
	private readonly _mountBuckets: [GridCellContentMount<TRowData>[], GridCellContentMount<TRowData>[], GridCellContentMount<TRowData>[]] = [
		[],
		[],
		[],
	];
	private mountedRowVisualRows = new Map<string, GridRowContentMount<TRowData>['visualRow']>();
	private mountedMenus = new Map<string, HTMLElement | undefined>();
	private cellReleaseTransactionDepth = 0;
	private pendingCellReleases = new Map<string, GridCellContentUnmount>();
	private deferredCellMounts = new Map<string, GridCellContentMount<TRowData>>();
	private deferredCellReleases = new Map<string, GridCellContentUnmount>();
	/** Tracks the current physical identity for each mounted cellKey. */
	private activeIdentityByKey = new Map<string, CellPortalPhysicalIdentity>();
	private deferredNewCellMounts = new Set<string>();
	private deferredRowMounts = new Map<string, GridRowContentMount<TRowData>>();
	private deferredRowReleases = new Map<string, GridRowContentUnmount>();
	private runtimeState: RenderRuntimeState | null = null;

	public setRuntimeState(state: RenderRuntimeState): void {
		this.runtimeState = state;
	}

	public setRuntimeStats(stats: RenderRuntimeStats): void {
		this.customRendererManager.setRuntimeStats(stats);
	}

	private get scrolling(): boolean {
		return this.runtimeState?.isScrolling() ?? false;
	}
	private stats = {
		flushesDuringScroll: 0,
		mountsDuringScroll: 0,
		releasesDuringScroll: 0,
		deferredDuringScroll: 0,
		flushChunks: 0,
		maxOpsFlushedInOneChunk: 0,
	};

	/** Returns the active slot generation for a cell key, or undefined if not mounted. */
	public getActiveGeneration(cellKey: string): number | undefined {
		return this.activeIdentityByKey.get(cellKey)?.slotGeneration;
	}

	public getActiveIdentity(cellKey: string): CellPortalPhysicalIdentity | undefined {
		return this.activeIdentityByKey.get(cellKey);
	}

	private reportMissingPooledIdentity(operation: string, cellKey: string): void {
		if (!this.engine) return;
		reportRendererFault(this.engine, operation, new Error(`Missing pooled portal identity for ${cellKey}`), { cellKey });
	}

	private isSamePhysicalIdentity(
		active: CellPortalPhysicalIdentity,
		op: { cellInstanceId?: string; portalHostId?: string; rowSlotId: string; slotGeneration: number; cellRowBindingGeneration?: number }
	): boolean {
		if (active.rowSlotId !== op.rowSlotId) return false;
		if (active.slotGeneration !== op.slotGeneration) return false;
		if (op.cellRowBindingGeneration !== undefined && active.cellRowBindingGeneration !== op.cellRowBindingGeneration) return false;
		if (op.cellInstanceId !== undefined && active.cellInstanceId !== op.cellInstanceId) return false;
		if (op.portalHostId !== undefined && op.portalHostId !== '' && active.portalHostId !== op.portalHostId) return false;
		return true;
	}

	private mountCellReal(mount: GridCellContentMount<TRowData>): void {
		this.activeIdentityByKey.set(mount.cellKey, {
			cellInstanceId: mount.cellInstanceId ?? '',
			portalHostId: mount.portalHostId ?? '',
			rowSlotId: mount.rowSlotId,
			slotGeneration: mount.slotGeneration,
			cellRowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
		});
		const col = mount.col as InternalColumnDef<TRowData>;
		const columnInstanceId = getColumnInstanceIdentity(col);
		const isCustom = !!(col.cellRenderer || mount.isEditing);

		this.engine?.instrumentation.increment(GridMetric.CELL_RENDERER_MOUNTED);

		if (!isCustom) {
			this.onMountCellContent?.(mount);
			return;
		}

		const node = mount.node;
		const rowIndex = mount.rowIndex ?? this.engine?.getRowModel()?.getVisualIndexByRowId(node.id) ?? -1;
		const colIndex = mount.colIndex ?? (this.engine ? this.engine.columns.getColumnIndex(col.field) : -1);
		const rowSlotId = mount.rowSlotId ?? this.getPhysicalRowSlotId?.(rowIndex);

		// DOM renderer — zero React overhead, direct DOM manipulation
		if (!mount.isEditing && isDomCellRenderer(col.cellRenderer)) {
			const rendererKey = rowSlotId
				? createDomSlotRendererKey(rowSlotId, columnInstanceId)
				: createDomIndexRendererKey(rowIndex, colIndex, columnInstanceId);

			this.domCellRendererManager.acquire({
				rendererKey,
				cellKey: mount.cellKey,
				parentContainer: mount.container,
				renderer: col.cellRenderer as DomCellRenderer<TRowData>,
				value: mount.value,
				node,
				col,
				isEditing: mount.isEditing,
				phase: mount.phase ?? 'initial',
				isScrolling: mount.isScrolling ?? false,
				isFocused: mount.isFocused ?? false,
				isSelected: mount.isSelected ?? false,
			});
			return;
		}

		// React renderer — goes through portal store
		const rendererKey = mount.isEditing
			? createEditRendererKey(node.id, columnInstanceId)
			: mount.cellInstanceId
				? createCellInstanceRendererKey(mount.cellInstanceId, columnInstanceId)
				: rowSlotId
					? createSlotRendererKey(rowSlotId, columnInstanceId)
					: this.customRendererManager.getRendererKey(col, node.id, rowIndex, colIndex, mount.isEditing);

		this.customRendererManager.acquire({
			rendererKey,
			cellKey: mount.cellKey,
			rowSlotId: mount.rowSlotId,
			slotGeneration: mount.slotGeneration,
			cellRowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
			cellInstanceId: mount.cellInstanceId,
			portalHostId: mount.portalHostId,
			parentContainer: mount.container,
			value: mount.value,
			node: mount.node,
			col: mount.col,
			isEditing: mount.isEditing,
			isLoading: mount.isLoading,
			phase: mount.phase ?? 'initial',
			isScrolling: mount.isScrolling ?? false,
			isFocused: mount.isFocused ?? false,
			isSelected: mount.isSelected ?? false,
		});
	}

	private releaseCellReal(cellKey: string, reason: ReleaseReason, originalUnmount?: GridCellContentUnmount): void {
		const activeIdentity = this.activeIdentityByKey.get(cellKey);
		this.activeIdentityByKey.delete(cellKey);
		// DOM renderer path — no portal/React involved
		if (this.domCellRendererManager.releaseByCellKey(cellKey, reason)) return;

		const releasedCustomRenderer = this.customRendererManager.releaseByCellKey(cellKey, reason);
		if (!releasedCustomRenderer) {
			if (originalUnmount) {
				this.onUnmountCellContent?.(originalUnmount);
			} else {
				if (!activeIdentity) {
					this.reportMissingPooledIdentity('portal-unmount-without-identity', cellKey);
					return;
				}
				const container = this.mountedCells.get(cellKey);
				this.onUnmountCellContent?.({
					cellKey,
					container,
					flushSync: false,
					rowSlotId: activeIdentity.rowSlotId,
					slotGeneration: activeIdentity.slotGeneration,
					cellRowBindingGeneration: activeIdentity.cellRowBindingGeneration,
					cellInstanceId: activeIdentity.cellInstanceId,
					portalHostId: activeIdentity.portalHostId,
				});
			}
		}
	}

	public mountCell(mount: GridCellContentMount<TRowData>): void {
		const wasMounted = this.mountedCells.has(mount.cellKey);
		this.mountedCells.set(mount.cellKey, mount.container);
		// A release of this key still queued in the current release transaction belongs to the
		// previous owner (row-anchored edit keys move between slots when a row re-sorts); letting
		// it run after this mount would unmount the new owner's renderer.
		this.pendingCellReleases.delete(mount.cellKey);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
			this.stats.deferredDuringScroll++;
			this.deferredCellReleases.delete(mount.cellKey);
			this.deferredCellMounts.set(mount.cellKey, mount);
			if (!wasMounted) {
				this.deferredNewCellMounts.add(mount.cellKey);
			}
			return;
		}
		this.mountCellReal(mount);
	}

	/**
	 * Cancels a mount that was deferred during scroll and has not run yet. Such a cell has no
	 * active identity (identity is recorded when the mount really runs), so releasing it must drop
	 * the queued mount instead of unmounting — otherwise the stale mount would still land later.
	 */
	public cancelDeferredMount(cellKey: string): boolean {
		if (this.activeIdentityByKey.has(cellKey) || !this.deferredCellMounts.delete(cellKey)) return false;
		this.deferredNewCellMounts.delete(cellKey);
		this.mountedCells.delete(cellKey);
		return true;
	}

	public mountCellImmediately(mount: GridCellContentMount<TRowData>): void {
		this.mountedCells.set(mount.cellKey, mount.container);
		this.pendingCellReleases.delete(mount.cellKey);
		this.deferredCellReleases.delete(mount.cellKey);
		this.deferredCellMounts.delete(mount.cellKey);
		this.deferredNewCellMounts.delete(mount.cellKey);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
		}
		this.mountCellReal(mount);
	}

	public releaseCell(unmount: GridCellContentUnmount): void {
		if (!this.mountedCells.has(unmount.cellKey)) return;
		const existingContainer = this.mountedCells.get(unmount.cellKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedCells.delete(unmount.cellKey);
		if (this.scrolling) {
			this.stats.releasesDuringScroll++;
			this.stats.deferredDuringScroll++;
			const canceledDeferredMount = this.deferredCellMounts.delete(unmount.cellKey);
			const wasNewDeferredMount = this.deferredNewCellMounts.delete(unmount.cellKey);
			if (canceledDeferredMount && wasNewDeferredMount) return;
			this.deferredCellReleases.set(unmount.cellKey, { ...unmount, flushSync: false });
			return;
		}
		if (this.cellReleaseTransactionDepth > 0) {
			this.pendingCellReleases.set(unmount.cellKey, { ...unmount, flushSync: false });
			return;
		}
		this.releaseCellReal(unmount.cellKey, unmount.reason ?? 'destroyed', unmount);
	}

	public releaseCellForScroll(unmount: GridCellContentUnmount): void {
		const existingContainer = this.mountedCells.get(unmount.cellKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedCells.delete(unmount.cellKey);

		const canceledDeferredMount = this.deferredCellMounts.delete(unmount.cellKey);
		const wasNewDeferredMount = this.deferredNewCellMounts.delete(unmount.cellKey);
		this.deferredCellReleases.delete(unmount.cellKey);
		if (canceledDeferredMount && wasNewDeferredMount) return;

		// DOM renderer — warm cache it, no portal unmount needed
		if (unmount.container && this.domCellRendererManager.releaseByParentContainer(unmount.container, 'scrolled-out')) {
			return;
		}
		if (this.domCellRendererManager.releaseByCellKey(unmount.cellKey, 'scrolled-out')) {
			return;
		}

		if (unmount.container && this.customRendererManager.releaseByParentContainer(unmount.container, 'scrolled-out')) {
			return;
		}
		if (this.customRendererManager.releaseByCellKey(unmount.cellKey, 'scrolled-out')) {
			return;
		}

		this.stats.releasesDuringScroll++;
		this.deferredCellReleases.set(unmount.cellKey, { ...unmount, flushSync: false });
	}

	public releaseCells(unmounts: GridCellContentUnmount[], flushSync = false): void {
		if (unmounts.length === 0) return;
		for (const unmount of unmounts) {
			const existingContainer = this.mountedCells.get(unmount.cellKey);
			if (unmount.container && existingContainer && existingContainer !== unmount.container) continue;
			this.mountedCells.delete(unmount.cellKey);
			if (this.scrolling) {
				this.stats.releasesDuringScroll++;
				this.stats.deferredDuringScroll++;
				const canceledDeferredMount = this.deferredCellMounts.delete(unmount.cellKey);
				const wasNewDeferredMount = this.deferredNewCellMounts.delete(unmount.cellKey);
				if (canceledDeferredMount && wasNewDeferredMount) continue;
				this.deferredCellReleases.set(unmount.cellKey, { ...unmount, flushSync: false });
				continue;
			}
			this.releaseCellReal(unmount.cellKey, unmount.reason ?? 'destroyed', unmount);
		}
		if (flushSync) {
			if (this.scrolling) {
				return;
			}
			this.onFlushCellContent?.({ flushSync: true });
		}
	}

	public beginCellReleaseTransaction(): void {
		this.cellReleaseTransactionDepth++;
	}

	public flushCellReleaseTransaction(flushSync = true): void {
		if (this.pendingCellReleases.size === 0) return;
		if (this.scrolling) {
			for (const [cellKey, unmount] of this.pendingCellReleases) {
				this.stats.releasesDuringScroll++;
				this.stats.deferredDuringScroll++;
				this.deferredCellReleases.set(cellKey, { ...unmount, flushSync: false });
			}
			this.pendingCellReleases.clear();
			return;
		}
		for (const unmount of this.pendingCellReleases.values()) {
			// Same stale-owner guard as the deferred flush: the key was remounted by another slot.
			const activeIdentity = this.activeIdentityByKey.get(unmount.cellKey);
			if (activeIdentity !== undefined && !this.isSamePhysicalIdentity(activeIdentity, unmount)) {
				this.engine?.instrumentation.increment(GridMetric.STALE_CELL_OPERATION_REJECTED);
				continue;
			}
			this.releaseCellReal(unmount.cellKey, 'destroyed', unmount);
		}
		this.pendingCellReleases.clear();
		if (flushSync) {
			this.onFlushCellContent?.({ flushSync: true });
		}
	}

	public endCellReleaseTransaction(): void {
		if (this.cellReleaseTransactionDepth === 0) return;
		this.cellReleaseTransactionDepth--;
		if (this.cellReleaseTransactionDepth === 0) {
			this.flushCellReleaseTransaction(true);
		}
	}

	public flushDeferred(options: DeferredPortalFlushOptions | boolean = {}): DeferredPortalFlushResult {
		const normalized = typeof options === 'boolean' ? { flushSync: options } : options;
		const maxItems = normalized.maxItems ?? Number.POSITIVE_INFINITY;
		const flushSync = normalized.flushSync ?? false;
		const deadline = normalized.deadline && !normalized.deadline.didTimeout ? normalized.deadline : undefined;
		const pendingBefore = this.getDeferredCount();
		if (pendingBefore === 0 || maxItems <= 0) {
			return { processed: 0, remaining: pendingBefore };
		}

		let processed = 0;
		// Weighted op budget: a cold mount commits a brand-new React subtree (~ms), a
		// warm-hit mount or release is a cheap re-parent/bookkeeping op. Budgeting by
		// weight keeps chunk wall-time roughly constant regardless of mix.
		const COLD_MOUNT_WEIGHT = 3;
		let budgetUsed = 0;

		const flushState = this.engine?.stateManager.getState();
		const interaction = flushState ? readInteractionState(flushState) : null;
		const activeEdit = interaction?.activeEdit.active ?? null;
		const focusedCell = interaction?.focus.cell ?? null;
		const rowModel = this.engine?.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const columns = this.engine?.columns.getDisplayedColumns() ?? [];
		const colCount = columns.length;
		const rowRange = this.engine ? this.engine.viewport.getVisibleRowRange(rowCount) : { startIdx: 0, endIdx: 0 };
		const colRange = this.engine ? this.engine.viewport.getVisibleColumnRange(colCount) : { startIdx: 0, endIdx: 0 };

		const rowCenter = (rowRange.startIdx + rowRange.endIdx) / 2;
		const colCenter = (colRange.startIdx + colRange.endIdx) / 2;

		// Iterate Maps directly — deleting the current key during iteration is safe and
		// avoids an O(remaining) Array.from copy per chunk (O(N²/budget) over the drain).
		for (const [cellKey, unmount] of this.deferredCellReleases) {
			if (isFlushOutOfBudget(budgetUsed, maxItems, deadline, processed)) break;
			const activeIdentity = this.activeIdentityByKey.get(cellKey);
			if (activeIdentity !== undefined && !this.isSamePhysicalIdentity(activeIdentity, unmount)) {
				this.deferredCellReleases.delete(cellKey);
				this.engine?.instrumentation.increment(GridMetric.STALE_CELL_OPERATION_REJECTED);
				continue;
			}
			this.releaseCellReal(unmount.cellKey, 'scrolled-out', unmount);
			this.deferredCellReleases.delete(cellKey);
			processed++;
			budgetUsed++;
		}

		// Classify deferred mounts into priority buckets — O(N) with zero allocation.
		const mb0 = this._mountBuckets[0];
		mb0.length = 0;
		const mb1 = this._mountBuckets[1];
		mb1.length = 0;
		const mb2 = this._mountBuckets[2];
		mb2.length = 0;
		for (const mount of this.deferredCellMounts.values()) {
			const p = this.getDeferredMountPriority(mount, activeEdit, focusedCell, rowModel, rowCenter, colCenter);
			if (p >= 1000) mb0.push(mount);
			else if (p >= 900) mb1.push(mount);
			else mb2.push(mount);
		}
		for (let bi = 0; bi < 3 && !isFlushOutOfBudget(budgetUsed, maxItems, deadline, processed); bi++) {
			const bucket = this._mountBuckets[bi];
			for (let i = 0; i < bucket.length && !isFlushOutOfBudget(budgetUsed, maxItems, deadline, processed); i++) {
				const mount = bucket[i];
				const isColdMount = this.deferredNewCellMounts.has(mount.cellKey);
				const activeIdentity = this.activeIdentityByKey.get(mount.cellKey);
				if (activeIdentity !== undefined && !this.isSamePhysicalIdentity(activeIdentity, mount)) {
					this.deferredCellMounts.delete(mount.cellKey);
					this.deferredNewCellMounts.delete(mount.cellKey);
					this.engine?.instrumentation.increment(GridMetric.STALE_CELL_OPERATION_REJECTED);
					continue;
				}
				this.mountCellReal(mount);
				this.deferredCellMounts.delete(mount.cellKey);
				this.deferredNewCellMounts.delete(mount.cellKey);
				processed++;
				budgetUsed += isColdMount ? COLD_MOUNT_WEIGHT : 1;
			}
		}

		for (const [rowKey, unmount] of this.deferredRowReleases) {
			if (isFlushOutOfBudget(budgetUsed, maxItems, deadline, processed)) break;
			this.onUnmountRowContent?.(unmount);
			this.deferredRowReleases.delete(rowKey);
			processed++;
			budgetUsed++;
		}
		for (const [rowKey, mount] of this.deferredRowMounts) {
			if (isFlushOutOfBudget(budgetUsed, maxItems, deadline, processed)) break;
			this.onMountRowContent?.(mount);
			this.deferredRowMounts.delete(rowKey);
			processed++;
			budgetUsed += COLD_MOUNT_WEIGHT;
		}

		const remaining = this.getDeferredCount();
		if (processed > 0) {
			this.stats.flushChunks++;
			this.stats.maxOpsFlushedInOneChunk = Math.max(this.stats.maxOpsFlushedInOneChunk, processed);
		}
		// Delegate warm DOM move budget to CustomRendererManager (it owns hydration policy).
		if (processed > 0 || this.customRendererManager.getPendingWarmMoveCount() > 0) {
			this.customRendererManager.flushWarmMoveBudget({
				maxItems: maxItems === Number.POSITIVE_INFINITY ? 16 : Math.max(1, Math.floor(maxItems / 2)),
			});
		}

		if (flushSync && remaining === 0) {
			this.onFlushCellContent?.({ flushSync: true });
		}
		return { processed, remaining };
	}

	/** Flush priority for a deferred mount — a method rather than a per-flush closure. */
	private getDeferredMountPriority(
		mount: GridCellContentMount<TRowData>,
		activeEdit: Parameters<typeof doesCanonicalCellPointerMatchColumn>[0],
		focusedCell: Parameters<typeof doesCanonicalCellPointerMatchColumn>[0],
		rowModel: ReturnType<GridEngine<TRowData>['getRowModel']> | undefined,
		rowCenter: number,
		colCenter: number
	): number {
		const col = mount.col;
		const node = mount.node;
		if (doesCanonicalCellPointerMatchColumn(activeEdit, node.id, col)) return 1000;
		if (doesCanonicalCellPointerMatchColumn(focusedCell, node.id, col)) return 900;

		const rowIndex = mount.rowIndex ?? rowModel?.getVisualIndexByRowId(node.id) ?? -1;
		const colIndex = mount.colIndex ?? (this.engine ? this.engine.columns.getColumnIndex(col.field) : -1);

		if (rowIndex === -1 || colIndex === -1) return 0;

		const distRow = Math.abs(rowIndex - rowCenter);
		const distCol = Math.abs(colIndex - colCenter);
		return 500 - (distRow + distCol);
	}

	public mountRow(mount: GridRowContentMount<TRowData>): void {
		const existingContainer = this.mountedRows.get(mount.rowKey);
		const existingVisualRow = this.mountedRowVisualRows.get(mount.rowKey);
		if (existingContainer === mount.container && isVisualRowEqual(existingVisualRow, mount.visualRow)) return;
		this.mountedRows.set(mount.rowKey, mount.container);
		this.mountedRowVisualRows.set(mount.rowKey, mount.visualRow);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
			this.stats.deferredDuringScroll++;
			this.deferredRowReleases.delete(mount.rowKey);
			this.deferredRowMounts.set(mount.rowKey, mount);
			return;
		}
		this.onMountRowContent?.(mount);
	}

	public releaseRow(unmount: GridRowContentUnmount): void {
		const existingContainer = this.mountedRows.get(unmount.rowKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedRows.delete(unmount.rowKey);
		this.mountedRowVisualRows.delete(unmount.rowKey);
		if (this.scrolling) {
			this.stats.releasesDuringScroll++;
			this.stats.deferredDuringScroll++;
			if (this.deferredRowMounts.delete(unmount.rowKey)) return;
			this.deferredRowReleases.set(unmount.rowKey, unmount);
			return;
		}
		this.onUnmountRowContent?.(unmount);
	}

	/** Immediately flush a deferred row mount (bypasses the scrolling-deferred queue). */
	public flushDeferredRowMount(rowKey: string): void {
		const mount = this.deferredRowMounts.get(rowKey);
		if (mount) {
			this.deferredRowMounts.delete(rowKey);
			this.onMountRowContent?.(mount);
		}
	}

	public mountHeaderMenu(mount: GridHeaderMenuMount<TRowData>): void {
		this.mountedMenus.set(mount.colField, mount.container);
		this.onMountHeaderMenu?.(mount);
	}

	public releaseHeaderMenu(unmount: GridHeaderMenuUnmount): void {
		const existingContainer = this.mountedMenus.get(unmount.colField);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedMenus.delete(unmount.colField);
		this.onUnmountHeaderMenu?.(unmount);
	}

	public releaseAll(): void {
		this.deferredCellMounts.clear();
		this.deferredCellReleases.clear();
		this.deferredNewCellMounts.clear();
		this.deferredRowMounts.clear();
		this.deferredRowReleases.clear();

		for (const [cellKey, container] of this.mountedCells) {
			this.releaseCellReal(cellKey, 'destroyed');
		}
		this.domCellRendererManager.releaseAll();
		this.customRendererManager.releaseAll();

		for (const [rowKey, container] of this.mountedRows) {
			this.onUnmountRowContent?.({ rowKey, container });
		}
		for (const [colField, container] of this.mountedMenus) {
			this.onUnmountHeaderMenu?.({ colField, container });
		}
		this.mountedCells.clear();
		this.mountedRows.clear();
		this.mountedRowVisualRows.clear();
		this.mountedMenus.clear();
		this.activeIdentityByKey.clear();
	}

	public isCellMounted(cellKey: string): boolean {
		return this.mountedCells.has(cellKey);
	}

	public getStats(): { cells: number; rows: number; menus: number } {
		return {
			cells: this.mountedCells.size,
			rows: this.mountedRows.size,
			menus: this.mountedMenus.size,
		};
	}

	public getDeferredCount(): number {
		return this.deferredCellReleases.size + this.deferredCellMounts.size + this.deferredRowReleases.size + this.deferredRowMounts.size;
	}

	/** Live ownership gauges for deterministic long-session diagnostics. */
	public getOwnershipSnapshot(): Readonly<{
		activeCells: number;
		activeRows: number;
		activeMenus: number;
		deferredCellMounts: number;
		deferredCellReleases: number;
		deferredRowMounts: number;
		deferredRowReleases: number;
	}> {
		return Object.freeze({
			activeCells: this.mountedCells.size,
			activeRows: this.mountedRows.size,
			activeMenus: this.mountedMenus.size,
			deferredCellMounts: this.deferredCellMounts.size,
			deferredCellReleases: this.deferredCellReleases.size,
			deferredRowMounts: this.deferredRowMounts.size,
			deferredRowReleases: this.deferredRowReleases.size,
		});
	}

	public getScrollStats(): {
		portalFlushesDuringScroll: number;
		portalDeferredDuringScroll: number;
		portalMountsDuringScroll: number;
		portalReleasesDuringScroll: number;
		portalFlushChunks: number;
		maxPortalOpsFlushedInOneChunk: number;
	} {
		return {
			portalFlushesDuringScroll: this.stats.flushesDuringScroll,
			portalDeferredDuringScroll: this.stats.deferredDuringScroll,
			portalMountsDuringScroll: this.stats.mountsDuringScroll,
			portalReleasesDuringScroll: this.stats.releasesDuringScroll,
			portalFlushChunks: this.stats.flushChunks,
			maxPortalOpsFlushedInOneChunk: this.stats.maxOpsFlushedInOneChunk,
		};
	}

	public resetStats(): void {
		this.stats.flushesDuringScroll = 0;
		this.stats.mountsDuringScroll = 0;
		this.stats.releasesDuringScroll = 0;
		this.stats.deferredDuringScroll = 0;
		this.stats.flushChunks = 0;
		this.stats.maxOpsFlushedInOneChunk = 0;
	}
}
