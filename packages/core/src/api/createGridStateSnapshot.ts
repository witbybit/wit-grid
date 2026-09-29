import type { ColumnDef } from '../columnDef.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { FilterModel, SortModel } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import type { InternalGridState } from '../state/GridState.js';
import type { ActiveEditState, GridSelectionState, GridStateSnapshot } from './GridApi.js';

function freezeCopy<T extends object>(value: T): Readonly<T> {
	return Object.freeze({ ...value });
}

function cloneSelection(selection: GridSelectionState): GridSelectionState {
	return Object.freeze({
		focus: selection.focus ? freezeCopy(selection.focus) : null,
		anchor: selection.anchor ? freezeCopy(selection.anchor) : null,
		range: selection.range
			? Object.freeze({
					start: freezeCopy(selection.range.start),
					end: freezeCopy(selection.range.end),
				})
			: null,
		bounds: selection.bounds ? freezeCopy(selection.bounds) : null,
		source: selection.source,
		focusOrigin: selection.focusOrigin ?? null,
		version: selection.version ?? 0,
	});
}

function cloneActiveEdit(activeEdit: ActiveEditState | null): ActiveEditState | null {
	return activeEdit ? freezeCopy(activeEdit) : null;
}

function cloneSortModel(sortModel: SortModel | null): SortModel | null {
	return sortModel ? (Object.freeze(sortModel.map((entry) => freezeCopy(entry))) as unknown as SortModel) : null;
}

function cloneFilterValue<T>(value: T): T {
	if (Array.isArray(value)) {
		return Object.freeze(value.map((entry) => cloneFilterValue(entry))) as T;
	}
	if (value instanceof Date) {
		return new Date(value.getTime()) as T;
	}
	if (value && typeof value === 'object') {
		const clone: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			clone[key] = cloneFilterValue(entry);
		}
		return Object.freeze(clone) as T;
	}
	return value;
}

function cloneFilterModel(filterModel: FilterModel | null): FilterModel | null {
	return filterModel ? (cloneFilterValue(filterModel) as FilterModel) : null;
}

function cloneQueryModel(queryModel: GridQueryModel | null): GridQueryModel | null {
	return queryModel ? (cloneFilterValue(queryModel) as GridQueryModel) : null;
}

function cloneColumns<TRowData>(columns: readonly ColumnDef<TRowData>[]): readonly ColumnDef<TRowData>[] {
	return Object.freeze(columns.map((column) => freezeCopy(column)));
}

export function createGridStateSnapshot<TRowData>(state: InternalGridState<TRowData>): GridStateSnapshot<TRowData> {
	const interaction = readInteractionState(state);
	return Object.freeze({
		columns: cloneColumns(state.columns),
		sortModel: cloneSortModel(state.sortModel),
		filterModel: cloneFilterModel(state.filterModel),
		queryModel: cloneQueryModel(state.queryModel ?? null),
		selection: cloneSelection(interaction.cellSelection.selection),
		selectedRowIds: Object.freeze(interaction.rowSelection.selectedRowIds.slice()),
		activeEdit: cloneActiveEdit(interaction.activeEdit.active),
		loading: state.loading,
		pagination: state.pagination ? freezeCopy(state.pagination) : undefined,
		enableColumnReorder: state.enableColumnReorder,
		themeName: state.themeName,
		sidebarOpenPanel: state.sidebarOpenPanel,
		chartOpen: state.chartOpen,
		// Hierarchy configs are replaced, never mutated, on change: sharing the reference keeps
		// selectors over them stable across unrelated snapshot rebuilds.
		grouping: state.grouping,
		treeData: state.treeData,
		aggregation: state.aggregation,
		detail: state.detail,
		globalVersion: state.globalVersion,
	});
}
