import { GridEventName } from '../api/GridEvents.js';
import type { CellSubscription } from '../api/GridApi.js';
import type { DataModel } from '../models/DataModel.js';
import type { RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import type { EventBus } from '../events/EventBus.js';
import type { InvalidationManager } from '../renderer/invalidationManager.js';
import { defaultGridScheduler } from '../renderer/gridScheduler.js';

export interface CellNotificationControllerDeps<TRowData = unknown> {
	data: DataModel<TRowData>;
	eventBus: EventBus<TRowData>;
	invalidation: InvalidationManager;
	requestRender: (reason: string) => void;
	rowVersions: Map<string, number>;
	faultReporter?: RuntimeFaultReporter<TRowData>;
}

let rowVersionClock = 0;

export class CellNotificationController<TRowData = unknown> {
	private readonly cellSubscriptions = new Map<string, Set<CellSubscription>>();
	private readonly colSubscriptions = new Map<string, Set<CellSubscription>>();
	private readonly rowSubscriptions = new Map<string, Set<() => void>>();
	private readonly cellUpdateBatch = new Map<string, Set<string>>();
	private batchFlushScheduled = false;
	private batched = true;

	constructor(private readonly deps: CellNotificationControllerDeps<TRowData>) {}

	public get batchedUpdates(): boolean {
		return this.batched;
	}

	public set batchedUpdates(enabled: boolean) {
		this.batched = enabled;
		if (!enabled && this.cellUpdateBatch.size > 0) {
			this.flushCellUpdates();
		}
	}

	public registerCellSubscription(sub: CellSubscription): void {
		const cellKey = `${sub.rowId}:${sub.colField}`;
		if (!this.cellSubscriptions.has(cellKey)) {
			this.cellSubscriptions.set(cellKey, new Set());
		}
		this.cellSubscriptions.get(cellKey)!.add(sub);

		if (!this.colSubscriptions.has(sub.colField)) {
			this.colSubscriptions.set(sub.colField, new Set());
		}
		this.colSubscriptions.get(sub.colField)!.add(sub);
	}

	public unregisterCellSubscription(sub: CellSubscription): void {
		const cellKey = `${sub.rowId}:${sub.colField}`;
		const cellSet = this.cellSubscriptions.get(cellKey);
		if (cellSet) {
			cellSet.delete(sub);
			if (cellSet.size === 0) {
				this.cellSubscriptions.delete(cellKey);
			}
		}

		const colSet = this.colSubscriptions.get(sub.colField);
		if (colSet) {
			colSet.delete(sub);
			if (colSet.size === 0) {
				this.colSubscriptions.delete(sub.colField);
			}
		}
	}

	public subscribeToRow(rowId: string, listener: () => void): () => void {
		let subscribers = this.rowSubscriptions.get(rowId);
		if (!subscribers) {
			subscribers = new Set();
			this.rowSubscriptions.set(rowId, subscribers);
		}
		subscribers.add(listener);
		return () => {
			const current = this.rowSubscriptions.get(rowId);
			if (!current) return;
			current.delete(listener);
			if (current.size === 0) this.rowSubscriptions.delete(rowId);
		};
	}

	public updateCellSubscription(sub: CellSubscription, oldRowId: string, oldColField: string, newRowId: string, newColField: string): void {
		const oldCellKey = `${oldRowId}:${oldColField}`;
		const oldCellSet = this.cellSubscriptions.get(oldCellKey);
		if (oldCellSet) {
			oldCellSet.delete(sub);
			if (oldCellSet.size === 0) {
				this.cellSubscriptions.delete(oldCellKey);
			}
		}

		const newCellKey = `${newRowId}:${newColField}`;
		if (!this.cellSubscriptions.has(newCellKey)) {
			this.cellSubscriptions.set(newCellKey, new Set());
		}
		this.cellSubscriptions.get(newCellKey)!.add(sub);

		if (oldColField !== newColField) {
			const oldColSet = this.colSubscriptions.get(oldColField);
			if (oldColSet) {
				oldColSet.delete(sub);
				if (oldColSet.size === 0) {
					this.colSubscriptions.delete(oldColField);
				}
			}

			if (!this.colSubscriptions.has(newColField)) {
				this.colSubscriptions.set(newColField, new Set());
			}
			this.colSubscriptions.get(newColField)!.add(sub);
		}
	}

	public enqueueCellUpdate(rowId: string, colField: string): void {
		let fields = this.cellUpdateBatch.get(rowId);
		if (!fields) {
			fields = new Set<string>();
			this.cellUpdateBatch.set(rowId, fields);
		}
		fields.add(colField);
	}

	public scheduleBatchFlush(): void {
		if (this.batchFlushScheduled) return;
		this.batchFlushScheduled = true;
		defaultGridScheduler.microtask(() => this.flushCellUpdates());
	}

	public flushCellUpdates(): void {
		if (this.cellUpdateBatch.size === 0) {
			this.batchFlushScheduled = false;
			return;
		}
		const batch = new Map(this.cellUpdateBatch);
		this.cellUpdateBatch.clear();
		this.batchFlushScheduled = false;
		this.notifyBulkCellChange(batch);
	}

	public flushCellUpdatesSync(): void {
		if (this.cellUpdateBatch.size > 0) {
			this.flushCellUpdates();
		}
	}

	public notifyBulkCellChange(changes: Map<string, Set<string>>): void {
		this.publishCommittedCellChanges(changes);

		const hasRenderConsumer =
			this.deps.eventBus.hasListeners(GridEventName.cellInvalidated) || this.deps.eventBus.hasListeners(GridEventName.renderInvalidated);
		if (!hasRenderConsumer) return;

		for (const [rowId, fields] of changes) {
			for (const colField of fields) {
				this.deps.invalidation.invalidateCell(rowId, colField, 'cell');
			}
			this.deps.invalidation.invalidateRow(rowId, 'cell');
		}
		this.deps.requestRender('bulk-cell-change');
	}

	/**
	 * Row versions come from one monotonic counter rather than per-row increments, so a row id
	 * whose entry was swept on removal and later re-added can never reproduce a version a
	 * recycled slot or display snapshot still remembers.
	 */
	private bumpRowVersion(rowId: string): void {
		this.deps.rowVersions.set(rowId, ++rowVersionClock);
	}

	/**
	 * A row's UI state changed without its data (its detail opened or closed): a new row version makes
	 * its cells, renderer cells included, draw again with the new state.
	 */
	public notifyRowStateChanged(rowId: string): void {
		this.bumpRowVersion(rowId);
		this.notifyRowSubscribers(rowId);
	}

	public publishCommittedCellChanges(changes: Map<string, Set<string>>): void {
		for (const rowId of changes.keys()) {
			this.bumpRowVersion(rowId);
			this.notifyRowSubscribers(rowId);
		}

		// One cache clear per changed row (clearing a row's other fields too is safe: they recompute),
		// and per-cell subscribers only when anyone subscribed to a cell.
		const hasCellSubscribers = this.cellSubscriptions.size > 0;
		for (const [rowId, fields] of changes) {
			this.deps.data.clearValueGetterCache(rowId);
			if (!hasCellSubscribers) continue;
			for (const colField of fields) this.notifyCellSubscribers(rowId, colField);
		}
	}

	public notifyCellChange(rowId: string, colField: string, includeRenderInvalidation = true, renderColId?: string): void {
		// Projection-only cell invalidations (focus/edit overlays) do not mutate the row.
		if (includeRenderInvalidation) {
			this.bumpRowVersion(rowId);
			this.notifyRowSubscribers(rowId);
		}
		this.deps.data.clearValueGetterCache(rowId, colField);
		this.notifyCellSubscribers(rowId, colField);
		if (!includeRenderInvalidation) return;

		const hasRenderConsumer =
			this.deps.eventBus.hasListeners(GridEventName.cellInvalidated) || this.deps.eventBus.hasListeners(GridEventName.renderInvalidated);
		if (!hasRenderConsumer) return;

		this.deps.invalidation.invalidateCell(rowId, renderColId ?? colField, 'cell');
		this.deps.invalidation.invalidateRow(rowId, 'cell');
		this.deps.eventBus.dispatchEvent(GridEventName.cellInvalidated, { rowId, colField });
		this.deps.requestRender('cell-change');
	}

	public notifyColumnSubscribers(colField: string): void {
		this.notifySubscribers(this.colSubscriptions.get(colField), `GridEngine: Error in column subscription notification`);
	}

	public notifyAllCellSubscribers(): void {
		this.cellSubscriptions.forEach((subs) => {
			this.notifySubscribers(subs, `GridEngine: Error in data refresh subscription notification`);
		});
	}

	public clear(): void {
		this.cellSubscriptions.clear();
		this.colSubscriptions.clear();
		this.rowSubscriptions.clear();
		this.cellUpdateBatch.clear();
		this.batchFlushScheduled = false;
	}

	private notifyCellSubscribers(rowId: string, colField: string): void {
		const cellKey = `${rowId}:${colField}`;
		this.notifySubscribers(this.cellSubscriptions.get(cellKey), `GridEngine: Error in cell subscription notification`);
	}

	private notifyRowSubscribers(rowId: string): void {
		const subscribers = this.rowSubscriptions.get(rowId);
		if (!subscribers) return;
		subscribers.forEach((listener) => {
			try {
				listener();
			} catch (error) {
				this.deps.faultReporter?.report({ source: 'cell-notifications', operation: 'row subscription notification', error });
			}
		});
	}

	private notifySubscribers(subs: Set<CellSubscription> | undefined, errorMessage: string): void {
		if (!subs) return;
		subs.forEach((sub) => {
			try {
				sub.onStoreChange();
			} catch (e) {
				this.deps.faultReporter?.report({ source: 'cell-notifications', operation: errorMessage, error: e });
			}
		});
	}
}
