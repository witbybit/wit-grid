import type { GridCellContentMount, GridCellContentUnmount } from './IGridRenderer.js';

/** Physical identity of a cell portal that has really mounted (set when the mount runs, not when queued). */
export interface CellPortalPhysicalIdentity {
	cellInstanceId: string;
	portalHostId: string;
	rowSlotId: string;
	slotGeneration: number;
	cellRowBindingGeneration: number;
}

/**
 * Where a release waits:
 *  - `deferred`: scroll-time queue, drained by PortalMountManager.flushDeferred().
 *  - `transaction`: batched inside a cell release transaction, drained when it ends.
 */
export type CellPortalReleaseQueue = 'deferred' | 'transaction';

/**
 * The single record for one cell portal key. Every question about a portal — is it wanted, where,
 * has it really mounted, is a mount or release waiting — is answered from this record, so there is
 * no second structure to drift out of sync with it.
 */
export interface CellPortalRecord<TRowData = unknown> {
	readonly cellKey: string;
	/** A slot currently wants this portal (the former `mountedCells` entry), in `container`. */
	wanted: boolean;
	container: HTMLElement | undefined;
	/** Set only once the mount has really run; cleared when the release really runs. */
	identity: CellPortalPhysicalIdentity | undefined;
	/** The mounted portal is an editor. Editing is single-cell, so at most one may be live. */
	isEdit: boolean;
	/** A mount waiting in the scroll-time queue. */
	pendingMount: GridCellContentMount<TRowData> | undefined;
	/** The queued mount creates a brand-new renderer (weighted heavier in flush budgets). */
	coldMount: boolean;
	pendingRelease: { unmount: GridCellContentUnmount; queue: CellPortalReleaseQueue } | undefined;
}

/**
 * Owns the lifecycle state of every cell portal. All transitions go through these methods, which
 * keep three rules structural rather than per-call-site:
 *
 *  1. Wanting a key again cancels any release of it still waiting (in either queue): a release
 *     queued by a previous owner must never run after the new owner's mount.
 *  2. A record with nothing left (not wanted, not mounted, nothing pending) is deleted, so there is
 *     no half-state to drift.
 *  3. The host element → key index answers "which portal is in this cell" exactly, instead of
 *     guessing from slot bookkeeping that can outlive the portal.
 *
 * Queue indexes (`pendingMountKeys`, `pendingReleaseKeys`) are derived views maintained only here,
 * so flushes iterate just the waiting work.
 */
export class CellPortalRegistry<TRowData = unknown> {
	private readonly records = new Map<string, CellPortalRecord<TRowData>>();
	private readonly keyByContainer = new Map<HTMLElement, string>();
	private readonly pendingMountKeys = new Set<string>();
	private readonly deferredReleaseKeys = new Set<string>();
	private readonly transactionReleaseKeys = new Set<string>();
	private readonly editKeys = new Set<string>();
	private wantedCount = 0;

	public get(cellKey: string): CellPortalRecord<TRowData> | undefined {
		return this.records.get(cellKey);
	}

	public isWanted(cellKey: string): boolean {
		return this.records.get(cellKey)?.wanted ?? false;
	}

	public getContainer(cellKey: string): HTMLElement | undefined {
		const record = this.records.get(cellKey);
		return record?.wanted ? record.container : undefined;
	}

	public getIdentity(cellKey: string): CellPortalPhysicalIdentity | undefined {
		return this.records.get(cellKey)?.identity;
	}

	/** The key currently wanted in `container` (a cell's portal host), if any. */
	public getKeyForContainer(container: HTMLElement): string | undefined {
		return this.keyByContainer.get(container);
	}

	// ─── wanted ────────────────────────────────────────────────────────────────

	/** A slot wants this portal in `container`. Cancels any waiting release (rule 1). */
	public markWanted(cellKey: string, container: HTMLElement | undefined): CellPortalRecord<TRowData> {
		const record = this.ensure(cellKey);
		if (!record.wanted) {
			record.wanted = true;
			this.wantedCount++;
		}
		if (record.container !== container) {
			this.unindexContainer(record);
			record.container = container;
		}
		if (container) {
			// The host now holds this key; any other key recorded for it is superseded.
			const previous = this.keyByContainer.get(container);
			if (previous !== undefined && previous !== cellKey) {
				const other = this.records.get(previous);
				if (other && other.container === container) other.container = undefined;
			}
			this.keyByContainer.set(container, cellKey);
		}
		this.clearPendingRelease(record);
		return record;
	}

	public markUnwanted(cellKey: string): void {
		const record = this.records.get(cellKey);
		if (!record || !record.wanted) return;
		record.wanted = false;
		this.wantedCount--;
		this.unindexContainer(record);
		record.container = undefined;
		this.settle(record);
	}

	// ─── mounts ────────────────────────────────────────────────────────────────

	public queueMount(mount: GridCellContentMount<TRowData>, cold: boolean): void {
		const record = this.ensure(mount.cellKey);
		record.pendingMount = mount;
		record.coldMount = record.coldMount || cold;
		this.pendingMountKeys.add(mount.cellKey);
	}

	/** Drops a queued mount. Returns whether one was queued and whether it was a cold mount. */
	public cancelMount(cellKey: string): { canceled: boolean; cold: boolean } {
		const record = this.records.get(cellKey);
		if (!record || record.pendingMount === undefined) return { canceled: false, cold: false };
		const cold = record.coldMount;
		record.pendingMount = undefined;
		record.coldMount = false;
		this.pendingMountKeys.delete(cellKey);
		this.settle(record);
		return { canceled: true, cold };
	}

	public pendingMounts(): Iterable<GridCellContentMount<TRowData>> {
		return this.iteratePendingMounts();
	}

	private *iteratePendingMounts(): Generator<GridCellContentMount<TRowData>> {
		for (const key of this.pendingMountKeys) {
			const mount = this.records.get(key)?.pendingMount;
			if (mount) yield mount;
		}
	}

	public isColdMount(cellKey: string): boolean {
		return this.records.get(cellKey)?.coldMount ?? false;
	}

	/** The mount really ran: the portal now exists with this identity. */
	public recordMounted(cellKey: string, identity: CellPortalPhysicalIdentity, isEdit: boolean): void {
		const record = this.ensure(cellKey);
		record.identity = identity;
		record.pendingMount = undefined;
		record.coldMount = false;
		this.pendingMountKeys.delete(cellKey);
		this.setEdit(record, isEdit || record.isEdit);
	}

	/** The release really ran: forget the portal. Returns the identity it had. */
	public recordReleased(cellKey: string): CellPortalPhysicalIdentity | undefined {
		const record = this.records.get(cellKey);
		if (!record) return undefined;
		const identity = record.identity;
		record.identity = undefined;
		this.setEdit(record, false);
		this.settle(record);
		return identity;
	}

	/** Mounted edit portals other than `keepKey`. */
	public editKeysExcept(keepKey: string): string[] {
		if (this.editKeys.size === 0 || (this.editKeys.size === 1 && this.editKeys.has(keepKey))) return [];
		const result: string[] = [];
		for (const key of this.editKeys) if (key !== keepKey) result.push(key);
		return result;
	}

	// ─── releases ──────────────────────────────────────────────────────────────

	public queueRelease(cellKey: string, unmount: GridCellContentUnmount, queue: CellPortalReleaseQueue): void {
		const record = this.ensure(cellKey);
		this.clearPendingRelease(record);
		record.pendingRelease = { unmount, queue };
		(queue === 'deferred' ? this.deferredReleaseKeys : this.transactionReleaseKeys).add(cellKey);
	}

	public cancelRelease(cellKey: string): void {
		const record = this.records.get(cellKey);
		if (!record) return;
		this.clearPendingRelease(record);
		this.settle(record);
	}

	/** Snapshot of the releases waiting in `queue` (safe to mutate the registry while iterating). */
	public pendingReleases(queue: CellPortalReleaseQueue): Array<{ cellKey: string; unmount: GridCellContentUnmount }> {
		const keys = queue === 'deferred' ? this.deferredReleaseKeys : this.transactionReleaseKeys;
		const result: Array<{ cellKey: string; unmount: GridCellContentUnmount }> = [];
		for (const key of keys) {
			const pending = this.records.get(key)?.pendingRelease;
			if (pending && pending.queue === queue) result.push({ cellKey: key, unmount: pending.unmount });
		}
		return result;
	}

	public pendingReleaseCount(queue: CellPortalReleaseQueue): number {
		return (queue === 'deferred' ? this.deferredReleaseKeys : this.transactionReleaseKeys).size;
	}

	// ─── gauges ────────────────────────────────────────────────────────────────

	public getWantedCount(): number {
		return this.wantedCount;
	}

	public getPendingMountCount(): number {
		return this.pendingMountKeys.size;
	}

	public wantedKeys(): string[] {
		const keys: string[] = [];
		for (const record of this.records.values()) if (record.wanted) keys.push(record.cellKey);
		return keys;
	}

	/** Drops every queued mount and deferred release (used before a full teardown). */
	public clearQueues(): void {
		for (const key of [...this.pendingMountKeys]) this.cancelMount(key);
		for (const key of [...this.deferredReleaseKeys]) this.cancelRelease(key);
	}

	public clear(): void {
		this.records.clear();
		this.keyByContainer.clear();
		this.pendingMountKeys.clear();
		this.deferredReleaseKeys.clear();
		this.transactionReleaseKeys.clear();
		this.editKeys.clear();
		this.wantedCount = 0;
	}

	/**
	 * Internal-consistency check for tests and the composition gauntlet. Returns human-readable
	 * violations; an empty array means every derived index agrees with the records.
	 */
	public checkInvariants(): string[] {
		const violations: string[] = [];
		let wanted = 0;
		for (const [key, record] of this.records) {
			if (record.wanted) wanted++;
			if (!record.wanted && !record.identity && !record.pendingMount && !record.pendingRelease)
				violations.push(`${key}: empty record retained`);
			if (record.wanted && record.pendingRelease) violations.push(`${key}: wanted but a release is pending`);
			if (record.pendingMount && !this.pendingMountKeys.has(key)) violations.push(`${key}: queued mount missing from index`);
			if (record.isEdit !== this.editKeys.has(key)) violations.push(`${key}: edit index out of sync`);
			if (record.wanted && record.container && this.keyByContainer.get(record.container) !== key)
				violations.push(`${key}: container index out of sync`);
		}
		if (wanted !== this.wantedCount) violations.push(`wanted count ${this.wantedCount} != ${wanted}`);
		for (const key of this.pendingMountKeys) if (!this.records.get(key)?.pendingMount) violations.push(`${key}: stale queued-mount index`);
		for (const key of this.deferredReleaseKeys)
			if (this.records.get(key)?.pendingRelease?.queue !== 'deferred') violations.push(`${key}: stale deferred-release index`);
		for (const key of this.transactionReleaseKeys)
			if (this.records.get(key)?.pendingRelease?.queue !== 'transaction') violations.push(`${key}: stale transaction-release index`);
		for (const [container, key] of this.keyByContainer) {
			const record = this.records.get(key);
			if (!record?.wanted || record.container !== container) violations.push(`${key}: container index points at a key not wanted there`);
		}
		return violations;
	}

	// ─── internals ─────────────────────────────────────────────────────────────

	private ensure(cellKey: string): CellPortalRecord<TRowData> {
		let record = this.records.get(cellKey);
		if (!record) {
			record = {
				cellKey,
				wanted: false,
				container: undefined,
				identity: undefined,
				isEdit: false,
				pendingMount: undefined,
				coldMount: false,
				pendingRelease: undefined,
			};
			this.records.set(cellKey, record);
		}
		return record;
	}

	private clearPendingRelease(record: CellPortalRecord<TRowData>): void {
		if (!record.pendingRelease) return;
		(record.pendingRelease.queue === 'deferred' ? this.deferredReleaseKeys : this.transactionReleaseKeys).delete(record.cellKey);
		record.pendingRelease = undefined;
	}

	private setEdit(record: CellPortalRecord<TRowData>, isEdit: boolean): void {
		record.isEdit = isEdit;
		if (isEdit) this.editKeys.add(record.cellKey);
		else this.editKeys.delete(record.cellKey);
	}

	private unindexContainer(record: CellPortalRecord<TRowData>): void {
		if (record.container && this.keyByContainer.get(record.container) === record.cellKey) this.keyByContainer.delete(record.container);
	}

	/** Rule 2: forget a record that has nothing left. */
	private settle(record: CellPortalRecord<TRowData>): void {
		if (record.wanted || record.identity || record.pendingMount || record.pendingRelease) return;
		this.records.delete(record.cellKey);
	}
}
