import { createRowCtrl, type RowCtrl } from './RowCtrl.js';
import { CellCtrlStore } from './CellCtrlStore.js';
import type { CellCtrl, CreateCellCtrlInput } from './CellCtrl.js';

export interface RowCtrlStoreStats {
	created: number;
	reused: number;
	evicted: number;
	/** CellCtrl attach/reuse counts — incremented by rowCellBinder.ts's attachCellCtrl, which owns
	 *  the getOrCreateCellCtrl() call and therefore knows whether it created or reused. Tracked here
	 *  rather than on a separate store since CellCtrl lifecycle is entirely a function of RowCtrl. */
	cellCtrlsCreated: number;
	cellCtrlsReused: number;
	/** Controllers handed from a slot's previous row to its new one (rekeyDetachedCellCtrl). */
	cellCtrlsRekeyed: number;
}

/**
 * Owns RowCtrl lifecycle. Controllers live as long as a physical CellSlot holds them: when a
 * CellSlot rebinds to another row, or is destroyed, it hands its previous CellCtrl back through
 * `releaseDetachedCellCtrl`, and a RowCtrl left with no CellCtrls is dropped with it. That keeps
 * both stores bounded to roughly the rendered window instead of every (row, column) ever visited.
 *
 * Focused/editing controllers are the exception — they are never released on detach. This is what
 * makes vertical focus/edit row retention possible: the controller for a focused/editing row
 * survives virtualization even when its physical RowSlot doesn't, so re-entering the render window
 * re-attaches to the SAME RowCtrl/CellCtrl rather than fabricating a fresh one with no memory of
 * edit state. Every other piece of CellCtrl state is re-derived on the next bind.
 *
 * Known scope limitation (documented, not silently skipped): there is currently no row-removal
 * event this store is wired into automatically, matching the existing codebase's own convention for
 * per-rowId maps (GridEngine.rowVersions and cellDisplaySnapshots are likewise never swept on row
 * removal today). `delete()`/`sweep()` are exposed so a caller with visibility into row removal can
 * invoke them; wiring that up automatically is left as documented follow-up work.
 */
export class RowCtrlStore<TRowData = unknown> {
	private readonly byRowId = new Map<string, RowCtrl<TRowData>>();
	public readonly cellCtrls = new CellCtrlStore<TRowData>();
	public stats: RowCtrlStoreStats = { created: 0, reused: 0, evicted: 0, cellCtrlsCreated: 0, cellCtrlsReused: 0, cellCtrlsRekeyed: 0 };

	/** Resets all counters to zero — mirrors resetRenderTelemetry()'s Object.assign(stats,
	 *  createXStats()) convention used for RenderRuntimeStats elsewhere in the renderer. */
	public resetStats(): void {
		this.stats = { created: 0, reused: 0, evicted: 0, cellCtrlsCreated: 0, cellCtrlsReused: 0, cellCtrlsRekeyed: 0 };
	}

	public getOrCreate(rowId: string): RowCtrl<TRowData> {
		let ctrl = this.byRowId.get(rowId);
		if (!ctrl) {
			ctrl = createRowCtrl<TRowData>(rowId);
			this.byRowId.set(rowId, ctrl);
			this.stats.created++;
		} else {
			this.stats.reused++;
		}
		return ctrl;
	}

	public get(rowId: string): RowCtrl<TRowData> | undefined {
		return this.byRowId.get(rowId);
	}

	/**
	 * Called by a CellSlot that stops holding `cellCtrl` (rebinds to another row, or is destroyed).
	 * Releases the controller unless it has since been attached to a different slot, or it is the
	 * focused/editing cell. Drops the owning RowCtrl once it has no controllers left and is itself
	 * neither focused nor editing. Returns true when the controller was released.
	 */
	public releaseDetachedCellCtrl(cellCtrl: CellCtrl, slotInstanceId: string): boolean {
		if (cellCtrl.lifecycle.destroyed) return false;
		if (cellCtrl.lifecycle.attachedSlotInstanceId !== slotInstanceId) return false;
		if (cellCtrl.visualState.focused || cellCtrl.visualState.editing) return false;
		if (!this.cellCtrls.release(cellCtrl)) return false;
		const rowCtrl = this.byRowId.get(cellCtrl.rowId);
		if (!rowCtrl) return true;
		if (rowCtrl.cellKeysByColumnInstanceId.get(cellCtrl.columnInstanceId) === cellCtrl.key) {
			rowCtrl.cellKeysByColumnInstanceId.delete(cellCtrl.columnInstanceId);
		}
		if (!rowCtrl.isFocused && !rowCtrl.isEditing && this.cellCtrls.sizeForRow(rowCtrl.rowId) === 0) {
			this.byRowId.delete(rowCtrl.rowId);
		}
		return true;
	}

	/**
	 * A slot recycled to another row hands its controller to the new row instead of releasing it and
	 * allocating another — allowed exactly when releaseDetachedCellCtrl would release it (attached to
	 * this slot, not focused or editing) and the new row has no controller for the column yet.
	 */
	public rekeyDetachedCellCtrl(cellCtrl: CellCtrl, slotInstanceId: string, input: CreateCellCtrlInput): boolean {
		if (cellCtrl.lifecycle.destroyed) return false;
		if (cellCtrl.lifecycle.attachedSlotInstanceId !== slotInstanceId) return false;
		if (cellCtrl.visualState.focused || cellCtrl.visualState.editing) return false;
		const previousRowCtrl = this.byRowId.get(cellCtrl.rowId);
		const previousKey = cellCtrl.key;
		if (!this.cellCtrls.rekey(cellCtrl, input)) return false;
		if (previousRowCtrl) {
			if (previousRowCtrl.cellKeysByColumnInstanceId.get(cellCtrl.columnInstanceId) === previousKey) {
				previousRowCtrl.cellKeysByColumnInstanceId.delete(cellCtrl.columnInstanceId);
			}
			if (!previousRowCtrl.isFocused && !previousRowCtrl.isEditing && this.cellCtrls.sizeForRow(previousRowCtrl.rowId) === 0) {
				this.byRowId.delete(previousRowCtrl.rowId);
			}
		}
		this.stats.cellCtrlsRekeyed++;
		return true;
	}

	/** Called when a row is permanently gone from the row model (deleted, filtered out) — NOT when
	 *  merely virtualized out of the render window (those stay warm; see class doc above). */
	public delete(rowId: string): boolean {
		const removed = this.byRowId.delete(rowId);
		if (removed) this.cellCtrls.destroyRow(rowId);
		if (removed) this.stats.evicted++;
		return removed;
	}

	/** Removes every RowCtrl whose rowId is not present in `liveRowIds`. Intended for callers that
	 *  have the authoritative current row-id set (e.g. after a bulk row-model replace) and want to
	 *  sweep everything else in one pass, rather than calling delete() per removed row. */
	public sweep(liveRowIds: ReadonlySet<string>): number {
		let evicted = 0;
		for (const rowId of this.byRowId.keys()) {
			if (!liveRowIds.has(rowId)) {
				this.byRowId.delete(rowId);
				this.cellCtrls.destroyRow(rowId);
				evicted++;
			}
		}
		this.stats.evicted += evicted;
		return evicted;
	}

	public size(): number {
		return this.byRowId.size;
	}

	public clear(): void {
		this.byRowId.clear();
		this.cellCtrls.clear();
	}
}
