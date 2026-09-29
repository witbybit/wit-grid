import type { GridEngine } from '../engine/GridEngine.js';

/**
 * Renderer-side geometry refresh. Row geometry is owned by the projection pipeline, which
 * syncs it in the same commit as every row-height/row-model change (including rowResized),
 * so row geometry is only re-synced here for an explicit full geometry invalidation
 * (container resize, api geometry paint). That re-sync is incremental and writes nothing
 * when heights are already current.
 */
export class GeometryController<TRowData = unknown> {
	private allInvalid = false;
	private invalidColumns = new Set<string>();
	private readonly engine: GridEngine<TRowData>;

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

	public invalidateAll(): void {
		this.allInvalid = true;
	}

	public invalidateColumns(colIds: string[]): void {
		for (const colId of colIds) {
			this.invalidColumns.add(colId);
		}
	}

	public recomputeIfNeeded(): void {
		if (!this.allInvalid && this.invalidColumns.size === 0) return;

		const state = this.engine.stateManager.getState();
		this.engine.columns.updateColumns(state.columns, state.columnWidths, state.defaultColWidth);
		if (this.allInvalid && this.engine.getVisualRowModel()) {
			this.engine.syncRowGeometry();
		}

		this.allInvalid = false;
		this.invalidColumns.clear();
	}
}
