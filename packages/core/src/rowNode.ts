/**
 * A node wrapping a single row datum, owned by the row data store.
 * Caches computed cell values until row data changes.
 */
import type { VisualRow } from './visualRow.js';

export class RowNode<TRowData = unknown> {
	public id!: string;
	public data!: TRowData;
	/**
	 * Internal: the client row model's index of this row's data row. Only meaningful while that visual
	 * row holds this node (the model checks); kept as a field so reorders write numbers, not Map entries.
	 */
	public visualIndex = -1;
	/** Internal: this row's data visual id (`row:…`), built once instead of on every pipeline run. */
	public dataVisualId: string | undefined = undefined;
	/**
	 * Internal: the quick filter's lowercased search text for the column set `quickTextSignature`.
	 * Fields rather than a WeakMap: a keystroke reads it for every row. Cleared when data changes.
	 */
	public quickText: string | undefined = undefined;
	public quickTextSignature: string | undefined = undefined;
	/** Internal: the flat grid's last visual row for this node, reused while it would be drawn the same. */
	public flatRow: VisualRow<TRowData> | undefined = undefined;

	private cellValueCache = new Map<string, unknown>();

	constructor(id: string, data: TRowData) {
		this.id = id;
		this.data = data;
	}

	public setData(data: TRowData): void {
		if (this.data !== data) {
			this.data = data;
			this.clearValueCache();
			this.quickText = undefined;
		}
	}

	public getCellValue(colField: string, compiledGetter: (data: TRowData) => unknown): unknown {
		if (this.cellValueCache.has(colField)) {
			return this.cellValueCache.get(colField);
		}
		const val = compiledGetter(this.data);
		this.cellValueCache.set(colField, val);
		return val;
	}

	public clearValueCache(): void {
		this.cellValueCache.clear();
	}
}
