/**
 * A node wrapping a single row datum, owned by the row data store.
 * Caches computed cell values until row data changes.
 */
export class RowNode<TRowData = unknown> {
	public id!: string;
	public data!: TRowData;
	/**
	 * Internal: the client row model's index of this row's data row. Only meaningful while that visual
	 * row holds this node (the model checks); kept as a field so reorders write numbers, not Map entries.
	 */
	public visualIndex = -1;

	private cellValueCache = new Map<string, unknown>();

	constructor(id: string, data: TRowData) {
		this.id = id;
		this.data = data;
	}

	public setData(data: TRowData): void {
		if (this.data !== data) {
			this.data = data;
			this.clearValueCache();
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
