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
import type { RowHierarchy, VisualRow } from '../visualRow.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';
import { CustomRendererManager, type ReleaseReason } from './customRendererManager.js';
import { DomCellRendererManager } from './domCellRendererManager.js';
import { reportRendererFault } from './rendererFaults.js';
import {
	createEditRendererKey,
	createSlotRendererKey,
	createDomSlotRendererKey,
	createDomIndexRendererKey,
	createCellInstanceRendererKey,
} from './identityKeys.js';
import { GridMetric } from '../diagnostics/GridInstrumentation.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';
import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';
import { readInteractionState } from '../interaction/interactionState.js';
import { CellPortalRegistry, type CellPortalPhysicalIdentity } from './cellPortalRegistry.js';

function isSameHierarchy(a: RowHierarchy, b: RowHierarchy): boolean {
	return (
		a === b ||
		(a.level === b.level &&
			a.parentId === b.parentId &&
			a.hasChildren === b.hasChildren &&
			a.expanded === b.expanded &&
			a.childCount === b.childCount &&
			a.leafCount === b.leafCount &&
			a.posInSet === b.posInSet &&
			a.setSize === b.setSize)
	);
}

/** Aggregates are rebuilt on every pipeline run, so compare by value (shallowly). */
function isSameAggregates(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	for (const key of keys) if (!Object.is(a[key], b[key])) return false;
	return true;
}

export function isVisualRowEqual<TRowData>(a: VisualRow<TRowData> | undefined, b: VisualRow<TRowData> | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (a.kind !== b.kind) return false;
	if (a.id !== b.id) return false;
	if (!isSameHierarchy(a.hierarchy, b.hierarchy)) return false;

	if (a.kind === 'group' && b.kind === 'group') {
		return a.field === b.field && a.key === b.key && isSameAggregates(a.aggregates, b.aggregates);
	}
	if (a.kind === 'total' && b.kind === 'total') {
		return a.scope === b.scope && a.groupId === b.groupId && a.placement === b.placement && isSameAggregates(a.aggregates, b.aggregates);
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
		return a.rowId === b.rowId && a.node === b.node && isSameAggregates(a.aggregates, b.aggregates);
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

export class PortalMountManager<TRowData = unknown> {
	public onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;
	public onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;
	public onFlushCellContent?: (flush: { flushSync?: boolean }) => void;
	public onMountRowContent?: (mount: GridRowContentMount<TRowData>) => void;
	/** Which full-width rows the adapter draws itself; unset means every row it is handed. */
	public rendersRow?: (row: VisualRow<TRowData>) => boolean;

	/** Whether a full-width row goes to the adapter (else core draws it). */
	public adapterRendersRow(row: VisualRow<TRowData>): boolean {
		return !!this.onMountRowContent && (this.rendersRow ? this.rendersRow(row) : true);
	}
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
		const forgetRetired = (cellKey: string) => this.cells.forgetRetired(cellKey);
		this.customRendererManager.onCellKeyRetired = forgetRetired;
		this.domCellRendererManager.onCellKeyRetired = forgetRetired;
	}

	public setPhysicalRowSlotIdResolver(resolver: (rowIndex: number) => string | undefined): void {
		this.getPhysicalRowSlotId = resolver;
	}

	/** Single source of truth for every cell portal's lifecycle (see CellPortalRegistry). */
	private readonly cells = new CellPortalRegistry<TRowData>();
	private mountedRows = new Map<string, HTMLElement | undefined>();
	// Pre-allocated priority buckets for flushDeferred — zero allocation per flush.
	// Bucket layout: [0] active-edit (≥1000), [1] focused (≥900), [2] everything else.
	private readonly _mountBuckets: [GridCellContentMount<TRowData>[], GridCellContentMount<TRowData>[], GridCellContentMount<TRowData>[]] = [
		[],
		[],
		[],
	];
	private mountedRowVisualRows = new Map<string, GridRowContentMount<TRowData>['visualRow']>();
	/** Whether each mounted group row was drawn stuck: the row alone does not change when its header sticks. */
	private mountedRowStuck = new Map<string, boolean>();
	private mountedMenus = new Map<string, HTMLElement | undefined>();
	private cellReleaseTransactionDepth = 0;
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
		return this.cells.getIdentity(cellKey)?.slotGeneration;
	}

	public getActiveIdentity(cellKey: string): CellPortalPhysicalIdentity | undefined {
		return this.cells.getIdentity(cellKey);
	}

	/** The cell portal key currently wanted in `container` (a cell's portal host), if any. */
	public getMountedKeyForContainer(container: HTMLElement): string | undefined {
		return this.cells.getKeyForContainer(container);
	}

	/** Registry self-check for tests and the composition gauntlet; empty means consistent. */
	public checkCellPortalInvariants(): string[] {
		return this.cells.checkInvariants();
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
		if (mount.isEditing) this.releaseSupersededEditPortals(mount.cellKey);
		this.cells.recordMounted(
			mount.cellKey,
			{
				cellInstanceId: mount.cellInstanceId ?? '',
				portalHostId: mount.portalHostId ?? '',
				rowSlotId: mount.rowSlotId,
				slotGeneration: mount.slotGeneration,
				cellRowBindingGeneration: mount.cellRowBindingGeneration ?? 0,
			},
			!!mount.isEditing
		);
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
			rowVersion: mount.rowVersion,
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

	/** Unmounts every live edit portal except `keepKey`: a newly mounted editor supersedes them. */
	private releaseSupersededEditPortals(keepKey: string): void {
		for (const key of this.cells.editKeysExcept(keepKey)) {
			this.cells.markUnwanted(key);
			this.cells.cancelMount(key);
			this.cells.cancelRelease(key);
			this.engine?.instrumentation.increment(GridMetric.STALE_CELL_OPERATION_REJECTED);
			this.releaseCellReal(key, 'edited');
		}
	}

	private releaseCellReal(cellKey: string, reason: ReleaseReason, originalUnmount?: GridCellContentUnmount): void {
		const container = this.cells.getContainer(cellKey);
		const activeIdentity = this.cells.recordReleased(cellKey);
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
		const wasMounted = this.cells.isWanted(mount.cellKey);
		// Wanting the key cancels any release of it still waiting: a release queued by the previous
		// owner (row-anchored edit keys move between slots when a row re-sorts) must never run later.
		this.cells.markWanted(mount.cellKey, mount.container);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
			this.stats.deferredDuringScroll++;
			this.cells.queueMount(mount, !wasMounted);
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
		if (this.cells.getIdentity(cellKey) || !this.cells.cancelMount(cellKey).canceled) return false;
		this.cells.markUnwanted(cellKey);
		return true;
	}

	public mountCellImmediately(mount: GridCellContentMount<TRowData>): void {
		this.cells.markWanted(mount.cellKey, mount.container);
		this.cells.cancelMount(mount.cellKey);
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
		}
		this.mountCellReal(mount);
	}

	/** A release naming a different container than the one the key is wanted in belongs to a stale owner. */
	private isForeignContainer(unmount: GridCellContentUnmount): boolean {
		const existingContainer = this.cells.getContainer(unmount.cellKey);
		return !!unmount.container && !!existingContainer && existingContainer !== unmount.container;
	}

	public releaseCell(unmount: GridCellContentUnmount): void {
		if (!this.cells.isWanted(unmount.cellKey)) return;
		if (this.isForeignContainer(unmount)) return;
		if (this.scrolling) {
			this.stats.releasesDuringScroll++;
			this.stats.deferredDuringScroll++;
			const { canceled, cold } = this.cells.cancelMount(unmount.cellKey);
			this.cells.markUnwanted(unmount.cellKey);
			if (canceled && cold) return;
			this.cells.queueRelease(unmount.cellKey, { ...unmount, flushSync: false }, 'deferred');
			return;
		}
		if (this.cellReleaseTransactionDepth > 0) {
			this.cells.markUnwanted(unmount.cellKey);
			this.cells.queueRelease(unmount.cellKey, { ...unmount, flushSync: false }, 'transaction');
			return;
		}
		this.releaseCellReal(unmount.cellKey, unmount.reason ?? 'destroyed', unmount);
		this.cells.markUnwanted(unmount.cellKey);
	}

	public releaseCellForScroll(unmount: GridCellContentUnmount): void {
		if (this.isForeignContainer(unmount)) return;
		const { canceled, cold } = this.cells.cancelMount(unmount.cellKey);
		this.cells.cancelRelease(unmount.cellKey);
		this.cells.markUnwanted(unmount.cellKey);
		if (canceled && cold) return;

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
		this.cells.queueRelease(unmount.cellKey, { ...unmount, flushSync: false }, 'deferred');
	}

	public releaseCells(unmounts: GridCellContentUnmount[], flushSync = false): void {
		if (unmounts.length === 0) return;
		for (const unmount of unmounts) {
			if (this.isForeignContainer(unmount)) continue;
			if (this.scrolling) {
				this.stats.releasesDuringScroll++;
				this.stats.deferredDuringScroll++;
				const { canceled, cold } = this.cells.cancelMount(unmount.cellKey);
				this.cells.markUnwanted(unmount.cellKey);
				if (canceled && cold) continue;
				this.cells.queueRelease(unmount.cellKey, { ...unmount, flushSync: false }, 'deferred');
				continue;
			}
			this.releaseCellReal(unmount.cellKey, unmount.reason ?? 'destroyed', unmount);
			this.cells.markUnwanted(unmount.cellKey);
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
		if (this.cells.pendingReleaseCount('transaction') === 0) return;
		const releases = this.cells.pendingReleases('transaction');
		if (this.scrolling) {
			for (const { cellKey, unmount } of releases) {
				this.stats.releasesDuringScroll++;
				this.stats.deferredDuringScroll++;
				this.cells.queueRelease(cellKey, unmount, 'deferred');
			}
			return;
		}
		for (const { cellKey, unmount } of releases) {
			this.cells.cancelRelease(cellKey);
			// Same stale-owner guard as the deferred flush: the key was remounted by another slot.
			const activeIdentity = this.cells.getIdentity(cellKey);
			if (activeIdentity !== undefined && !this.isSamePhysicalIdentity(activeIdentity, unmount)) {
				this.engine?.instrumentation.increment(GridMetric.STALE_CELL_OPERATION_REJECTED);
				continue;
			}
			this.releaseCellReal(cellKey, 'destroyed', unmount);
		}
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
		for (const { cellKey, unmount } of this.cells.pendingReleases('deferred')) {
			if (isFlushOutOfBudget(budgetUsed, maxItems, deadline, processed)) break;
			this.cells.cancelRelease(cellKey);
			const activeIdentity = this.cells.getIdentity(cellKey);
			if (activeIdentity !== undefined && !this.isSamePhysicalIdentity(activeIdentity, unmount)) {
				this.engine?.instrumentation.increment(GridMetric.STALE_CELL_OPERATION_REJECTED);
				continue;
			}
			this.releaseCellReal(cellKey, 'scrolled-out', unmount);
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
		for (const mount of this.cells.pendingMounts()) {
			const p = this.getDeferredMountPriority(mount, activeEdit, focusedCell, rowModel, rowCenter, colCenter);
			if (p >= 1000) mb0.push(mount);
			else if (p >= 900) mb1.push(mount);
			else mb2.push(mount);
		}
		for (let bi = 0; bi < 3 && !isFlushOutOfBudget(budgetUsed, maxItems, deadline, processed); bi++) {
			const bucket = this._mountBuckets[bi];
			for (let i = 0; i < bucket.length && !isFlushOutOfBudget(budgetUsed, maxItems, deadline, processed); i++) {
				const mount = bucket[i];
				const isColdMount = this.cells.isColdMount(mount.cellKey);
				const activeIdentity = this.cells.getIdentity(mount.cellKey);
				if (activeIdentity !== undefined && !this.isSamePhysicalIdentity(activeIdentity, mount)) {
					this.cells.cancelMount(mount.cellKey);
					this.engine?.instrumentation.increment(GridMetric.STALE_CELL_OPERATION_REJECTED);
					continue;
				}
				this.mountCellReal(mount);
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
			clearRowContentPending(mount.container);
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
		const stuck = mount.context?.isStuck === true;
		if (
			existingContainer === mount.container &&
			isVisualRowEqual(existingVisualRow, mount.visualRow) &&
			(this.mountedRowStuck.get(mount.rowKey) ?? false) === stuck
		)
			return;
		this.mountedRows.set(mount.rowKey, mount.container);
		this.mountedRowStuck.set(mount.rowKey, stuck);
		this.mountedRowVisualRows.set(mount.rowKey, mount.visualRow);
		// Full-width rows are few per frame, so they mount during scroll too (bounded per frame)
		// rather than sitting blank until scroll settles.
		if (this.scrolling && this.takeScrollRowMount()) {
			this.stats.mountsDuringScroll++;
			this.deferredRowMounts.delete(mount.rowKey);
			this.deferredRowReleases.delete(mount.rowKey);
			this.onMountRowContent?.(mount);
			return;
		}
		if (this.scrolling) {
			this.stats.mountsDuringScroll++;
			this.stats.deferredDuringScroll++;
			this.deferredRowReleases.delete(mount.rowKey);
			this.deferredRowMounts.set(mount.rowKey, mount);
			// Until this mount is applied the container is either empty (a new host) or still shows the
			// previous row's content: show the new row's label instead of a blank or a wrong row (CSS
			// only, so the adapter's DOM is untouched).
			if (existingContainer !== mount.container || !existingVisualRow || existingVisualRow.id !== mount.visualRow.id)
				markRowContentPending(mount.container, mount.context?.label ?? '');
			return;
		}
		this.onMountRowContent?.(mount);
	}

	public releaseRow(unmount: GridRowContentUnmount): void {
		const existingContainer = this.mountedRows.get(unmount.rowKey);
		if (unmount.container && existingContainer && existingContainer !== unmount.container) return;
		this.mountedRows.delete(unmount.rowKey);
		this.mountedRowVisualRows.delete(unmount.rowKey);
		this.mountedRowStuck.delete(unmount.rowKey);
		if (this.scrolling) {
			this.stats.releasesDuringScroll++;
			this.stats.deferredDuringScroll++;
			if (this.deferredRowMounts.delete(unmount.rowKey)) return;
			this.deferredRowReleases.set(unmount.rowKey, unmount);
			return;
		}
		this.onUnmountRowContent?.(unmount);
	}

	/** Adapter row mounts allowed per scroll frame (`rendererOptions.fullWidth.maxMountsPerScrollFrame`). */
	public maxRowMountsPerScrollFrame = 4;
	private scrollRowMountEpoch = -1;
	private scrollRowMountsThisFrame = 0;

	private takeScrollRowMount(): boolean {
		const epoch = this.runtimeState?.frameEpoch ?? -1;
		if (epoch !== this.scrollRowMountEpoch) {
			this.scrollRowMountEpoch = epoch;
			this.scrollRowMountsThisFrame = 0;
		}
		if (this.scrollRowMountsThisFrame >= this.maxRowMountsPerScrollFrame) return false;
		this.scrollRowMountsThisFrame++;
		return true;
	}

	/** Immediately flush a deferred row mount (bypasses the scrolling-deferred queue). */
	public flushDeferredRowMount(rowKey: string): void {
		const mount = this.deferredRowMounts.get(rowKey);
		if (mount) {
			this.deferredRowMounts.delete(rowKey);
			clearRowContentPending(mount.container);
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
		this.cells.clearQueues();
		this.deferredRowMounts.clear();
		this.deferredRowReleases.clear();

		for (const cellKey of this.cells.wantedKeys()) {
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
		this.cells.clear();
		this.mountedRows.clear();
		this.mountedRowVisualRows.clear();
		this.mountedRowStuck.clear();
		this.mountedMenus.clear();
	}

	public isCellMounted(cellKey: string): boolean {
		return this.cells.isWanted(cellKey);
	}

	public getStats(): { cells: number; rows: number; menus: number } {
		return {
			cells: this.cells.getWantedCount(),
			rows: this.mountedRows.size,
			menus: this.mountedMenus.size,
		};
	}

	public getDeferredCount(): number {
		return (
			this.cells.pendingReleaseCount('deferred') +
			this.cells.getPendingMountCount() +
			this.deferredRowReleases.size +
			this.deferredRowMounts.size
		);
	}

	/** Live ownership gauges for deterministic long-session diagnostics. */
	public getOwnershipSnapshot(): Readonly<{
		activeCells: number;
		/** Every cell portal record, wanted or not (a warm-parked renderer's key included). */
		trackedCellPortals: number;
		activeRows: number;
		activeMenus: number;
		deferredCellMounts: number;
		deferredCellReleases: number;
		deferredRowMounts: number;
		deferredRowReleases: number;
	}> {
		return Object.freeze({
			activeCells: this.cells.getWantedCount(),
			trackedCellPortals: this.cells.getRecordCount(),
			activeRows: this.mountedRows.size,
			activeMenus: this.mountedMenus.size,
			deferredCellMounts: this.cells.getPendingMountCount(),
			deferredCellReleases: this.cells.pendingReleaseCount('deferred'),
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

const ROW_CONTENT_PENDING_CLASS = 'og-row-content-pending';

function markRowContentPending(container: HTMLElement, standIn: string): void {
	container.classList.add(ROW_CONTENT_PENDING_CLASS);
	container.setAttribute('data-stand-in', standIn);
}

function clearRowContentPending(container: HTMLElement): void {
	if (!container.classList.contains(ROW_CONTENT_PENDING_CLASS)) return;
	container.classList.remove(ROW_CONTENT_PENDING_CLASS);
	container.removeAttribute('data-stand-in');
}
