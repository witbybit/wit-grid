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

export interface StoreTransactionResult<T> {
	added: RowNode<T>[];
	removed: RowNode<T>[];
	updated: RowNode<T>[];
	changedFieldsByRow: Map<string, Set<string>>;
	changedValuesByRow: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
}

export interface RowDataStoreTransactionSnapshot<T> {
	readonly nodesById: ReadonlyMap<string, RowNode<T>>;
	readonly rowDataById: ReadonlyMap<string, T>;
	readonly sourceOrder: readonly string[];
}

const hasOwn = Object.prototype.hasOwnProperty;

function diffRows(prevRow: unknown, nextRow: unknown): RowDiff | null {
	const prevRecord = prevRow as Record<string, unknown>;
	const nextRecord = nextRow as Record<string, unknown>;
	let changedFields: Set<string> | null = null;
	let changedValues: Map<string, { oldValue: unknown; newValue: unknown }> | null = null;

	const recordChange = (key: string, oldValue: unknown, newValue: unknown) => {
		if (!changedFields) {
			changedFields = new Set<string>();
			changedValues = new Map<string, { oldValue: unknown; newValue: unknown }>();
		}
		changedFields.add(key);
		changedValues!.set(key, { oldValue, newValue });
	};

	for (const key of Object.keys(prevRecord)) {
		const oldValue = prevRecord[key];
		const hasNextKey = hasOwn.call(nextRecord, key);
		const newValue = nextRecord[key];
		if (!hasNextKey || oldValue !== newValue) {
			recordChange(key, oldValue, newValue);
		}
	}

	for (const key of Object.keys(nextRecord)) {
		if (!hasOwn.call(prevRecord, key)) {
			recordChange(key, undefined, nextRecord[key]);
		}
	}

	if (!changedFields || !changedValues) return null;
	return { changedFields, changedValues };
}

export class RowDataStore<T> {
	private rowsById = new Map<string, RowNode<T>>();
	private sourceOrder: string[] = [];
	private getRowId: (row: T) => string;

	constructor(getRowId: (row: T) => string) {
		this.getRowId = getRowId;
	}

	public setRows(rows: T[]): void {
		// Validate before mutating any state so a bad input is a no-op.
		const ids = rows.map((row, index) => {
			if (row == null) {
				throw new Error(`Wit Grid: row at index ${index} is null or undefined.`);
			}
			const id = this.getRowId(row);
			if (typeof id !== 'string' || id.length === 0) {
				throw new Error(`Wit Grid: getRowId() returned an invalid id for row at index ${index}.`);
			}
			return id;
		});
		validateRowIds(ids, 'setRows');

		const nextNodeMap = new Map<string, RowNode<T>>();
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			const id = ids[i];
			let node = this.rowsById.get(id);
			if (node) {
				node.setData(row);
			} else {
				node = new RowNode<T>(id, row);
			}
			nextNodeMap.set(id, node);
		}
		this.sourceOrder = ids;
		this.rowsById = nextNodeMap;
	}

	public updateRows(updater: RowUpdate<T>): RowTransactionResult<T> {
		const currentRows = this.sourceOrder.map((id) => this.rowsById.get(id)!.data);
		const nextRows = updater(currentRows);

		if (nextRows.length !== this.sourceOrder.length) {
			return {
				changedNodes: [],
				changedFieldsByRow: new Map(),
				changedValuesByRow: new Map(),
				mismatch: true,
			};
		}

		const changedNodes: RowNode<T>[] = [];
		const changedFieldsByRow = new Map<string, Set<string>>();
		const changedValuesByRow = new Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>();

		for (let i = 0; i < this.sourceOrder.length; i++) {
			const currentId = this.sourceOrder[i];
			const node = this.rowsById.get(currentId)!;
			const nextRow = nextRows[i];
			if (nextRow == null) {
				return {
					changedNodes: [],
					changedFieldsByRow: new Map(),
					changedValuesByRow: new Map(),
					mismatch: true,
				};
			}

			const nextId = this.getRowId(nextRow);
			if (node.id !== nextId) {
				return {
					changedNodes: [],
					changedFieldsByRow: new Map(),
					changedValuesByRow: new Map(),
					mismatch: true,
				};
			}

			const prevRow = node.data;
			if (prevRow !== nextRow) {
				const diff = diffRows(prevRow, nextRow);
				if (diff) {
					node.setData(nextRow);
					changedNodes.push(node);
					changedFieldsByRow.set(node.id, diff.changedFields);
					changedValuesByRow.set(node.id, diff.changedValues);
				}
			}
		}

		return {
			changedNodes,
			changedFieldsByRow,
			changedValuesByRow,
			mismatch: false,
		};
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
				const addIndex = transaction.addIndex ?? this.sourceOrder.length;
				const newIds = newNodes.map((n) => n.id);
				this.sourceOrder.splice(addIndex, 0, ...newIds);
			}
		}

		return { added, removed, updated, changedFieldsByRow, changedValuesByRow };
	}

	public getNode(rowId: string): RowNode<T> | null {
		return this.rowsById.get(rowId) ?? null;
	}

	public getAllNodes(): RowNode<T>[] {
		return this.sourceOrder.map((id) => this.rowsById.get(id)!);
	}

	public getSourceOrder(): string[] {
		return this.sourceOrder.slice();
	}

	public captureTransactionSnapshot(): RowDataStoreTransactionSnapshot<T> {
		return {
			nodesById: new Map(this.rowsById),
			rowDataById: new Map(this.sourceOrder.map((id) => [id, structuredClone(this.rowsById.get(id)!.data)])),
			sourceOrder: this.sourceOrder.slice(),
		};
	}

	public restoreTransactionSnapshot(snapshot: RowDataStoreTransactionSnapshot<T>): void {
		for (const [id, node] of snapshot.nodesById) {
			node.setData(structuredClone(snapshot.rowDataById.get(id)!));
		}
		this.rowsById = new Map(snapshot.nodesById);
		this.sourceOrder = snapshot.sourceOrder.slice();
	}

	/** Reorder rows by providing a new array of row IDs. IDs not present in the store are silently dropped. */
	public setRowOrder(rowIds: string[]): void {
		const next: string[] = [];
		for (const id of rowIds) {
			if (this.rowsById.has(id)) next.push(id);
		}
		this.sourceOrder = next;
	}
}
