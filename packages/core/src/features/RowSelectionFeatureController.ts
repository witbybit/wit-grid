import { toDataVisualRowId } from '../rows/visualRowIds.js';
import type { RowSelectionGesture, RowSelectionGestureSource, RowSelectionChangeResult, RowSelectionScope } from '../api/GridApi.js';
import { GridEventName } from '../api/GridEvents.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import { asRowHierarchyReadableModel, asSelectableDataRowModel, type RowModel } from '../rowModel.js';
import { isDataCellSelectable } from '../visualRow.js';

export class RowSelectionFeatureController<TRowData = unknown> {
	constructor(
		private readonly ctx: GridFeatureContext<TRowData>,
		private readonly getRowModel: () => RowModel<TRowData> | null
	) {}

	private getAllSelectableDataRowIds(scope?: RowSelectionScope): string[] {
		const allIds: string[] = [];
		const rowModel = this.getRowModel();
		if (!rowModel) return allIds;
		const selectableRowModel = asSelectableDataRowModel(rowModel);
		if (selectableRowModel)
			return selectableRowModel.getSelectableDataRowIds(scope ?? this.ctx.getState().rowSelection?.selectAllScope ?? 'page');
		const count = rowModel.getVisualRowCount();
		for (let i = 0; i < count; i++) {
			const vr = rowModel.getVisualRow(i);
			if (vr?.kind === 'data') allIds.push(vr.rowId);
		}
		return allIds;
	}

	private isDataCellSelectable(rowId: string, colField: string): boolean {
		const rowModel = this.getRowModel();
		const rowIndex = rowModel ? rowModel.getVisualIndexByRowId(rowId) : -1;
		const visualRow = rowIndex >= 0 && rowModel ? rowModel.getVisualRow(rowIndex) : null;
		return isDataCellSelectable(visualRow, this.ctx.columns.getColumnDef(colField));
	}

	private normalizeIdsForMode(rowIds: string[]): string[] {
		const deduped = [...new Set(rowIds)];
		return this.ctx.getState().rowSelection?.mode === 'single' ? deduped.slice(0, 1) : deduped;
	}

	private reduceRowSelection(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
		const current = this.ctx.getState();
		const currentSet = new Set(current.selectedRowIds);
		const rowIds = this.normalizeIdsForMode(gesture.rowIds ?? []);
		const isSingle = current.rowSelection?.mode === 'single';
		let newIds: string[];

		switch (gesture.kind) {
			case 'replace': {
				newIds = rowIds;
				break;
			}
			case 'select': {
				if (isSingle) {
					newIds = rowIds.length > 0 ? [rowIds[0]] : current.selectedRowIds.slice(0, 1);
				} else if (gesture.mode === 'replace') {
					newIds = rowIds;
				} else {
					rowIds.forEach((id) => currentSet.add(id));
					newIds = [...currentSet];
				}
				break;
			}
			case 'deselect': {
				const toRemove = new Set(rowIds);
				newIds = current.selectedRowIds.filter((id) => !toRemove.has(id));
				break;
			}
			case 'toggle': {
				const id = rowIds[0];
				if (!id) return null;
				if (currentSet.has(id)) currentSet.delete(id);
				else {
					if (isSingle) currentSet.clear();
					currentSet.add(id);
				}
				newIds = [...currentSet];
				break;
			}
			case 'selectAll': {
				if (isSingle) return null;
				const scopedIds = this.getAllSelectableDataRowIds(gesture.scope);
				if (gesture.mode === 'add') {
					scopedIds.forEach((id) => currentSet.add(id));
					newIds = [...currentSet];
				} else {
					newIds = scopedIds;
				}
				break;
			}
			case 'clear': {
				newIds = [];
				break;
			}
			default:
				return null;
		}

		newIds = this.cascadeToDescendants(current.selectedRowIds, newIds);
		const prevSet = new Set(current.selectedRowIds);
		const newSet = new Set(newIds);
		const addedRowIds = newIds.filter((id) => !prevSet.has(id));
		const removedRowIds = current.selectedRowIds.filter((id) => !newSet.has(id));
		const changedRowIds = addedRowIds.concat(removedRowIds);
		if (changedRowIds.length === 0) return null;

		return {
			selectedRowIds: newIds,
			changedRowIds,
			addedRowIds,
			removedRowIds,
			source: gesture.source ?? 'api',
		};
	}

	/**
	 * `treeData.selectDescendants`: a row that became selected brings every row beneath it (collapsed
	 * ones included), and one that became deselected takes them with it.
	 */
	private cascadeToDescendants(previous: readonly string[], next: string[]): string[] {
		const state = this.ctx.getState();
		if (!state.treeData?.selectDescendants || state.rowSelection?.mode === 'single') return next;
		const index = asRowHierarchyReadableModel(this.getRowModel())?.getHierarchyIndex();
		if (!index) return next;
		const prevSet = new Set(previous);
		const nextSet = new Set(next);
		const result = new Set(next);
		for (const id of nextSet) {
			if (!prevSet.has(id)) for (const descendant of index.getDescendantRowIds(toDataVisualRowId(id))) result.add(descendant);
		}
		for (const id of prevSet) {
			if (!nextSet.has(id)) for (const descendant of index.getDescendantRowIds(toDataVisualRowId(id))) result.delete(descendant);
		}
		return result.size === next.length && next.every((id) => result.has(id)) ? next : [...result];
	}

	public applyRowSelectionGesture(gesture: RowSelectionGesture): RowSelectionChangeResult | null {
		const result = this.reduceRowSelection(gesture);
		if (!result) return null;

		this.ctx.applyChange({
			reason: 'selection:rows',
			state: { selectedRowIds: result.selectedRowIds },
			invalidations: [
				...result.changedRowIds.map((rowId) => ({ kind: 'row' as const, rowId, reason: 'selection' })),
				{ kind: 'headers', reason: 'selection' },
			],
			domains: ['selection'],
			events: [{ type: GridEventName.rowSelectionChanged, payload: result }],
		});
		return result;
	}

	public selectRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'select', rowIds, source });
	}

	public replaceRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'replace', rowIds, source });
	}

	public deselectRowIds(rowIds: string[], source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'deselect', rowIds, source });
	}

	public toggleRowId(rowId: string, source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'toggle', rowIds: [rowId], source });
	}

	public selectAllDataRows(source: RowSelectionGestureSource = 'api', scope?: RowSelectionScope, mode?: 'add' | 'replace'): void {
		this.applyRowSelectionGesture({ kind: 'selectAll', source, scope, mode });
	}

	public clearRowSelection(source: RowSelectionGestureSource = 'api'): void {
		this.applyRowSelectionGesture({ kind: 'clear', source });
	}
}
