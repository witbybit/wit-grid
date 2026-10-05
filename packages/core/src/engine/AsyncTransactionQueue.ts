import type { GridTransactionResult } from '../api/GridApi.js';
import type { RowNodeTransaction } from '../rowTransactions.js';
import type { GridEngineTransaction } from './GridEngine.js';

export type AsyncTransactionCallback<TRowData> = (result: GridTransactionResult<TRowData>) => void;

export interface AsyncTransactionQueueDeps<TRowData> {
	/** Applies one (possibly combined) transaction synchronously. */
	apply: (transaction: GridEngineTransaction<TRowData>) => GridTransactionResult<TRowData>;
	getRowId: (row: TRowData) => string;
	/** Schedules `flush` once; returns a cancel function. */
	schedule: (flush: () => void) => () => void;
}

interface QueuedTransaction<TRowData> {
	transaction: GridEngineTransaction<TRowData>;
	callback?: AsyncTransactionCallback<TRowData>;
}

/**
 * Queues row transactions and applies them together at the next flush, in order.
 *
 * Consecutive transactions are combined into one applied transaction while they are independent:
 * they touch disjoint row ids and none uses `addIndex`. Applying independent transactions as one
 * gives exactly the result of applying them one after another (updates and removes of different
 * rows commute, and plain adds keep their order), so combining never changes the outcome. A
 * transaction that touches a row an earlier one in the group touched, or that uses `addIndex`,
 * starts a new group, so every intermediate change still happens. A stream of updates to many
 * different rows becomes one commit, one row-model pass and one render per flush.
 */
export class AsyncTransactionQueue<TRowData> {
	private queue: QueuedTransaction<TRowData>[] = [];
	private cancelScheduled: (() => void) | null = null;
	private destroyed = false;

	constructor(private readonly deps: AsyncTransactionQueueDeps<TRowData>) {}

	public get pendingCount(): number {
		return this.queue.length;
	}

	public enqueue(transaction: GridEngineTransaction<TRowData>, callback?: AsyncTransactionCallback<TRowData>): void {
		if (this.destroyed) return;
		this.queue.push({ transaction, callback });
		if (!this.cancelScheduled) this.cancelScheduled = this.deps.schedule(() => this.flush());
	}

	/** Applies everything queued now, in order. Safe to call re-entrantly and when empty. */
	public flush(): void {
		this.cancelScheduled?.();
		this.cancelScheduled = null;
		if (this.queue.length === 0) return;
		// Take the queue first: applying commits, and a commit flushes pending async work first.
		const queued = this.queue;
		this.queue = [];
		for (const group of this.group(queued)) this.applyGroup(group);
	}

	/** Drops pending transactions without applying them; their callbacks are not called. */
	public destroy(): void {
		this.destroyed = true;
		this.cancelScheduled?.();
		this.cancelScheduled = null;
		this.queue = [];
	}

	private rowIdsOf(transaction: GridEngineTransaction<TRowData>): string[] {
		const ids: string[] = [];
		const rows = transaction.rows;
		if (!rows) return ids;
		for (const list of [rows.add, rows.update, rows.remove]) {
			if (list) for (const row of list) ids.push(this.deps.getRowId(row));
		}
		return ids;
	}

	private group(queued: QueuedTransaction<TRowData>[]): QueuedTransaction<TRowData>[][] {
		const groups: QueuedTransaction<TRowData>[][] = [];
		let current: QueuedTransaction<TRowData>[] = [];
		let touched = new Set<string>();
		for (const entry of queued) {
			const ids = this.rowIdsOf(entry.transaction);
			// Only row-only transactions merge: cell writes and grid state apply on their own, as do
			// positional inserts (combined, every add would land at the index).
			const positional =
				entry.transaction.rows?.addIndex !== undefined || (entry.transaction.cells?.length ?? 0) > 0 || !!entry.transaction.applyState;
			const conflicts = positional || ids.some((id) => touched.has(id)) || new Set(ids).size !== ids.length;
			if (current.length > 0 && conflicts) {
				groups.push(current);
				current = [];
				touched = new Set();
			}
			current.push(entry);
			for (const id of ids) touched.add(id);
			if (positional) {
				groups.push(current);
				current = [];
				touched = new Set();
			}
		}
		if (current.length > 0) groups.push(current);
		return groups;
	}

	private applyGroup(group: QueuedTransaction<TRowData>[]): void {
		if (group.length === 1) {
			const [only] = group;
			// Apply first: `callback?.(apply())` would skip the apply itself when there is no callback.
			const result = this.deps.apply(only.transaction);
			only.callback?.(result);
			return;
		}
		const combined = { add: [] as TRowData[], update: [] as TRowData[], remove: [] as TRowData[] };
		for (const { transaction } of group) {
			const rows = transaction.rows!;
			if (rows.add) combined.add.push(...rows.add);
			if (rows.update) combined.update.push(...rows.update);
			if (rows.remove) combined.remove.push(...rows.remove);
		}
		const result = this.deps.apply({ rows: combined });
		if (!group.some((entry) => entry.callback)) return;
		// Hand each transaction its own part of the combined result (row ids are disjoint).
		const byId = (nodes: RowNodeTransaction<TRowData>['add']) => new Map(nodes.map((node) => [node.id, node]));
		const added = byId(result.rows.add);
		const updated = byId(result.rows.update);
		const removed = byId(result.rows.remove);
		const pick = (rows: TRowData[] | undefined, index: Map<string, RowNodeTransaction<TRowData>['add'][number]>) =>
			(rows ?? []).map((row) => index.get(this.deps.getRowId(row))).filter((node): node is NonNullable<typeof node> => node !== undefined);
		for (const { transaction, callback } of group) {
			if (!callback) continue;
			const rows = transaction.rows!;
			callback({ ...result, rows: { add: pick(rows.add, added), update: pick(rows.update, updated), remove: pick(rows.remove, removed) } });
		}
	}
}
