import { validateRowIds } from '../ids.js';
import { RowNode } from '../rowNode.js';

export type RowUpdate<T> = (rows: T[]) => T[];

interface RowDiff {
	changedFields: Set<string>;
	changedValues: Map<string, { oldValue: unknown; newValue: unknown }>;
}

export interface RowTransactionResult<T> {
	changedNodes: RowNode<T>[];
	changedFieldsByRow: Map<string, Set<string>>;
	changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
	mismatch: boolean;
}

/** What replaceRows changed: rows kept in the same order are diffed field by field. */
export interface RowReplaceResult<T> {
	/** Same ids in the same order: only `changedNodes` (and their fields) changed. */
	sameOrder: boolean;
	changedNodes: RowNode<T>[];
	changedFieldsByRow: Map<string, Set<string>>;
	changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
	added: RowNode<T>[];
	removed: RowNode<T>[];
}

export interface StoreTransactionResult<T> {
	added: RowNode<T>[];
	removed: RowNode<T>[];
	updated: RowNode<T>[];
	changedFieldsByRow: Map<string, Set<string>>;
	changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
}

/**
 * Inverse (delta) snapshot of a transaction: only the rows the transaction can touch.
 * Rows are replaced immutably (`RowNode.setData` swaps the reference), so the captured
 * data reference already *is* the pre-transaction value — nothing is cloned.
 */
export interface RowDataStoreTransactionSnapshot<T> {
	/** Touched row id → the node it resolved to before the write (null = absent) and that node's data. */
	readonly entries: ReadonlyMap<string, { readonly node: RowNode<T> | null; readonly data: T | undefined }>;
	/** Pre-write source order; only captured when the write can change membership/order (add/remove). */
	readonly sourceOrder: readonly string[] | null;
	/** True when captured without a scope: `entries` then covers every row that existed. */
	readonly complete?: boolean;
}

/** The rows a transaction may touch — used to scope `captureTransactionSnapshot`. */
export interface RowDataStoreTransactionScope<T> {
	add?: readonly T[];
	remove?: readonly T[];
	update?: readonly T[];
}

const hasOwn = Object.prototype.hasOwnProperty;

function diffRows(prevRow: unknown, nextRow: unknown): RowDiff | null {
	const prevRecord = prevRow as Record<string, unknown>;
	const nextRecord = nextRow as Record<string, unknown>;
	let changedFields: Set<string> | null = null;
	let changedValues: Map<string, { oldValue: unknown; newValue: unknown }> | null = null;

	// One pass over the old row (for-in walks a cached key list; no Object.keys arrays per row), then a
	// count of the new row's keys: only a new row with keys the old one lacks needs a second look.
	let shared = 0;
	for (const key in prevRecord) {
		if (!hasOwn.call(prevRecord, key)) continue;
		const oldValue = prevRecord[key];
		const hasNextKey = hasOwn.call(nextRecord, key);
		if (hasNextKey) shared++;
		const newValue = nextRecord[key];
		if (hasNextKey && oldValue === newValue) continue;
		changedFields ??= new Set<string>();
		changedValues ??= new Map<string, { oldValue: unknown; newValue: unknown }>();
		changedFields.add(key);
		changedValues.set(key, { oldValue, newValue });
	}
	let nextKeys = 0;
	for (const key in nextRecord) if (hasOwn.call(nextRecord, key)) nextKeys++;
	if (nextKeys !== shared) {
		for (const key in nextRecord) {
			if (!hasOwn.call(nextRecord, key) || hasOwn.call(prevRecord, key)) continue;
			changedFields ??= new Set<string>();
			changedValues ??= new Map<string, { oldValue: unknown; newValue: unknown }>();
			changedFields.add(key);
			changedValues.set(key, { oldValue: undefined, newValue: nextRecord[key] });
		}
	}

	if (!changedFields || !changedValues) return null;
	return { changedFields, changedValues };
}

export class RowDataStore<T> {
	private rowsById = new Map<string, RowNode<T>>();
	private sourceOrder: string[] = [];
	/** Lazily built rowId → source position; null when stale. See getSourceIndex(). */
	private sourceIndexById: Map<string, number> | null = null;
	private getRowId: (row: T) => string;

	constructor(getRowId: (row: T) => string) {
		this.getRowId = getRowId;
	}

	public setRows(rows: T[]): void {
		this.replaceRows(rows);
	}

	/**
	 * Replaces the rows, reporting exactly what changed: rows are matched by id, a row passed as the
	 * same object is untouched, a new object for a known id is diffed field by field, and ids that
	 * appear or disappear are reported as added / removed.
	 */
	public replaceRows(rows: T[]): RowReplaceResult<T> {
		const changedNodes: RowNode<T>[] = [];
		const changedFieldsByRow = new Map<string, Set<string>>();
		const changedValuesByRow = new Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>();
		const previousOrder = this.sourceOrder;
		// Immutable-state updates pass mostly the same objects: a row that is the same object at the
		// same position keeps its id without calling getRowId, and while every id matches the previous
		// (unique) order nothing needs revalidating or re-indexing.
		const ids: string[] = new Array(rows.length);
		let sameOrder = rows.length === previousOrder.length;
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			const previousId = sameOrder ? previousOrder[i] : undefined;
			const previousNode = previousId === undefined ? undefined : this.rowsById.get(previousId);
			if (previousNode && previousNode.data === row) {
				ids[i] = previousId!;
				continue;
			}
			const id = this.readRowId(row, i);
			ids[i] = id;
			if (sameOrder && id !== previousId) sameOrder = false;
		}
		if (sameOrder) {
			for (let i = 0; i < rows.length; i++) {
				const node = this.rowsById.get(ids[i])!;
				const row = rows[i];
				if (node.data === row) continue;
				const diff = diffRows(node.data, row);
				node.setData(row);
				if (diff) {
					changedNodes.push(node);
					changedFieldsByRow.set(node.id, diff.changedFields);
					changedValuesByRow.set(node.id, diff.changedValues);
				}
			}
			return { sameOrder, changedNodes, changedFieldsByRow, changedValuesByRow, added: [], removed: [] };
		}

		validateRowIds(ids, 'setRows');
		const added: RowNode<T>[] = [];
		const nextNodeMap = new Map<string, RowNode<T>>();
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			const id = ids[i];
			let node = this.rowsById.get(id);
			if (!node) {
				node = new RowNode<T>(id, row);
				added.push(node);
			} else if (node.data !== row) {
				const diff = diffRows(node.data, row);
				node.setData(row);
				if (diff) {
					changedNodes.push(node);
					changedFieldsByRow.set(id, diff.changedFields);
					changedValuesByRow.set(id, diff.changedValues);
				}
			}
			nextNodeMap.set(id, node);
		}
		const removed: RowNode<T>[] = [];
		for (const [id, node] of this.rowsById) if (!nextNodeMap.has(id)) removed.push(node);
		this.sourceOrder = ids;
		this.sourceIndexById = null;
		this.rowsById = nextNodeMap;
		return { sameOrder, changedNodes, changedFieldsByRow, changedValuesByRow, added, removed };
	}

	private readRowId(row: T, index: number): string {
		if (row == null) {
			throw new Error(`Wit Grid: row at index ${index} is null or undefined.`);
		}
		const id = this.getRowId(row);
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error(`Wit Grid: getRowId() returned an invalid id for row at index ${index}.`);
		}
		return id;
	}

	public applyTransaction(transaction: { add?: T[]; addIndex?: number; remove?: T[]; update?: T[] }): StoreTransactionResult<T> {
		const added: RowNode<T>[] = [];
		const removed: RowNode<T>[] = [];
		const updated: RowNode<T>[] = [];
		const changedFieldsByRow = new Map<string, Set<string>>();
		const changedValuesByRow = new Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>();

		if (transaction.remove) {
			for (const row of transaction.remove) {
				const id = this.getRowId(row);
				const node = this.rowsById.get(id);
				if (node) {
					removed.push(node);
					this.rowsById.delete(id);
				}
			}
			if (removed.length > 0) {
				const removedIds = new Set(removed.map((n) => n.id));
				this.sourceOrder = this.sourceOrder.filter((id) => !removedIds.has(id));
				this.sourceIndexById = null;
			}
		}

		if (transaction.update) {
			for (const row of transaction.update) {
				const id = this.getRowId(row);
				const node = this.rowsById.get(id);
				if (!node) continue;

				const prevRow = node.data;
				if (prevRow === row) continue;

				const diff = diffRows(prevRow, row);
				if (diff) {
					node.setData(row);
					updated.push(node);
					changedFieldsByRow.set(id, diff.changedFields);
					changedValuesByRow.set(id, diff.changedValues);
				}
			}
		}

		if (transaction.add && transaction.add.length > 0) {
			const newNodes: RowNode<T>[] = [];
			for (const row of transaction.add) {
				const id = this.getRowId(row);
				if (this.rowsById.has(id)) continue;
				const node = new RowNode<T>(id, row);
				this.rowsById.set(id, node);
				newNodes.push(node);
				added.push(node);
			}

			if (newNodes.length > 0) {
				const length = this.sourceOrder.length;
				// Same start normalization as Array.prototype.splice, without spreading newIds into
				// call arguments (which throws RangeError for very large adds).
				const requested = Math.trunc(transaction.addIndex ?? length) || 0;
				const start = requested < 0 ? Math.max(length + requested, 0) : Math.min(requested, length);
				if (start === length) {
					const index = this.sourceIndexById;
					for (const node of newNodes) {
						index?.set(node.id, this.sourceOrder.length);
						this.sourceOrder.push(node.id);
					}
				} else {
					const newIds = newNodes.map((n) => n.id);
					this.sourceOrder = this.sourceOrder.slice(0, start).concat(newIds, this.sourceOrder.slice(start));
					this.sourceIndexById = null;
				}
			}
		}

		return { added, removed, updated, changedFieldsByRow, changedValuesByRow };
	}

	public getNode(rowId: string): RowNode<T> | null {
		return this.rowsById.get(rowId) ?? null;
	}

	/** Nodes in source order, cached until the order or membership changes. Callers must not mutate it. */
	private nodesInOrder: RowNode<T>[] | null = null;
	private orderSeen: readonly string[] | null = null;
	private nodesSeen: Map<string, RowNode<T>> | null = null;

	public getAllNodes(): RowNode<T>[] {
		// Every order change assigns a new array or pushes onto it (length), membership edits replace
		// or edit rowsById (size): cheap identity checks instead of hooks in every mutation path.
		if (
			this.nodesInOrder &&
			this.orderSeen === this.sourceOrder &&
			this.nodesInOrder.length === this.sourceOrder.length &&
			this.nodesSeen === this.rowsById &&
			this.rowsById.size === this.nodesInOrder.length
		)
			return this.nodesInOrder;
		this.orderSeen = this.sourceOrder;
		this.nodesSeen = this.rowsById;
		return (this.nodesInOrder = this.computeAllNodes());
	}

	private computeAllNodes(): RowNode<T>[] {
		return this.sourceOrder.map((id) => this.rowsById.get(id)!);
	}

	/** Number of rows in the store, without copying the order. */
	public getRowCount(): number {
		return this.sourceOrder.length;
	}

	public getSourceOrder(): string[] {
		return this.sourceOrder.slice();
	}

	/**
	 * Source-order position of `rowId`, served from a lazily built index that survives
	 * value-only writes and is invalidated (or extended, for appends) on order changes.
	 */
	public getSourceIndex(rowId: string): number | undefined {
		let index = this.sourceIndexById;
		if (!index) {
			index = new Map<string, number>();
			for (let i = 0; i < this.sourceOrder.length; i++) index.set(this.sourceOrder[i], i);
			this.sourceIndexById = index;
		}
		return index.get(rowId);
	}

	/**
	 * Captures the inverse of `scope` (the rows it adds/removes/updates) so
	 * `restoreTransactionSnapshot` can undo it. Omitting `scope` captures every row —
	 * still by reference, never cloned. Cost is O(touched rows), plus an O(n) id-array
	 * copy of the source order only when the scope adds or removes rows.
	 */
	public captureTransactionSnapshot(scope?: RowDataStoreTransactionScope<T>): RowDataStoreTransactionSnapshot<T> {
		const entries = new Map<string, { node: RowNode<T> | null; data: T | undefined }>();
		const capture = (id: string): void => {
			if (entries.has(id)) return;
			const node = this.rowsById.get(id) ?? null;
			entries.set(id, { node, data: node?.data });
		};
		if (!scope) {
			for (const id of this.sourceOrder) capture(id);
			return { entries, sourceOrder: this.sourceOrder.slice(), complete: true };
		}
		const captureRows = (rows: readonly T[] | undefined): void => {
			if (!rows) return;
			for (const row of rows) {
				if (row != null) capture(this.getRowId(row));
			}
		};
		captureRows(scope.remove);
		captureRows(scope.update);
		captureRows(scope.add);
		const structural = (scope.add?.length ?? 0) > 0 || (scope.remove?.length ?? 0) > 0;
		return { entries, sourceOrder: structural ? this.sourceOrder.slice() : null };
	}

	public restoreTransactionSnapshot(snapshot: RowDataStoreTransactionSnapshot<T>): void {
		// A complete snapshot owns the whole id space: rows added after capture are dropped.
		if (snapshot.complete) this.rowsById = new Map();
		for (const [id, entry] of snapshot.entries) {
			if (entry.node) {
				entry.node.setData(entry.data as T);
				this.rowsById.set(id, entry.node);
			} else {
				this.rowsById.delete(id);
			}
		}
		if (snapshot.sourceOrder) {
			this.sourceOrder = snapshot.sourceOrder.slice();
			this.sourceIndexById = null;
		}
	}

	/** Reorder rows by providing a new array of row IDs. IDs not present in the store are silently dropped. */
	public setRowOrder(rowIds: string[]): void {
		const next: string[] = [];
		for (const id of rowIds) {
			if (this.rowsById.has(id)) next.push(id);
		}
		this.sourceOrder = next;
		this.sourceIndexById = null;
	}
}
