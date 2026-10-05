import type {
	ActiveEditState,
	CanonicalGridCellPointer,
	GridCellPointer,
	GridSelectionSource,
	GridSelectionState,
	GridCellRangeBounds,
} from '../api/GridApi.js';

export interface GridFocusState {
	cell: CanonicalGridCellPointer | null;
	rowIndex: number | null;
	origin: GridSelectionSource | null;
	version: number;
}

export interface GridEditState {
	kind: 'idle' | 'editing-cell';
	active: ActiveEditState | null;
}

export interface CanonicalGridCellRange {
	start: CanonicalGridCellPointer;
	end: CanonicalGridCellPointer;
}

export interface CanonicalGridSelectionState {
	focus: CanonicalGridCellPointer | null;
	anchor: CanonicalGridCellPointer | null;
	range: CanonicalGridCellRange | null;
	bounds: GridCellRangeBounds | null;
	source: GridSelectionSource;
	focusOrigin?: GridSelectionSource | null;
	version?: number;
}

export interface GridCellSelectionDomainState {
	selection: CanonicalGridSelectionState;
}

export interface GridRowSelectionState {
	selectedRowIds: readonly string[];
}

export interface GridInteractionState {
	focus: GridFocusState;
	activeEdit: GridEditState;
	cellSelection: GridCellSelectionDomainState;
	rowSelection: GridRowSelectionState;
}

type InteractionStateReadable<TRowData> = {
	selection: GridSelectionState | CanonicalGridSelectionState;
	activeEdit: ActiveEditState | null;
	interaction?: GridInteractionState;
	selectedRowIds: readonly string[];
};

interface InteractionStateBuildOptions {
	getRowIndexByRowId?: (rowId: string) => number | null;
}

function asCanonicalCellPointer(pointer: GridCellPointer | null | undefined): CanonicalGridCellPointer | null {
	if (!pointer?.columnInstanceId || !pointer.colId) return null;
	return pointer as CanonicalGridCellPointer;
}

function normalizeSelectionState(
	selection: GridSelectionState | CanonicalGridSelectionState | undefined
): GridSelectionState | CanonicalGridSelectionState {
	return (
		selection ?? {
			focus: null,
			anchor: null,
			range: null,
			bounds: null,
			source: 'api',
			focusOrigin: null,
			version: 0,
		}
	);
}

function asCanonicalSelectionState(selection: GridSelectionState): CanonicalGridSelectionState {
	const focus = asCanonicalCellPointer(selection.focus);
	const anchor = asCanonicalCellPointer(selection.anchor);
	const rangeStart = asCanonicalCellPointer(selection.range?.start);
	const rangeEnd = asCanonicalCellPointer(selection.range?.end);

	return {
		focus,
		anchor,
		range: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null,
		bounds: selection.bounds,
		source: selection.source,
		focusOrigin: selection.focusOrigin ?? null,
		version: selection.version ?? 0,
	};
}

export function buildInteractionState(
	input: {
		selection?: GridSelectionState | CanonicalGridSelectionState;
		activeEdit: ActiveEditState | null;
		selectedRowIds: readonly string[];
	} & InteractionStateBuildOptions
): GridInteractionState {
	const selection = normalizeSelectionState(input.selection);
	const focus = asCanonicalCellPointer(selection.focus);
	return {
		focus: {
			cell: focus,
			rowIndex: focus ? (input.getRowIndexByRowId?.(focus.rowId) ?? null) : null,
			origin: selection.focusOrigin ?? selection.source ?? null,
			version: selection.version ?? 0,
		},
		activeEdit: {
			kind: input.activeEdit ? 'editing-cell' : 'idle',
			active: input.activeEdit,
		},
		cellSelection: {
			selection: asCanonicalSelectionState(selection),
		},
		rowSelection: {
			selectedRowIds: input.selectedRowIds,
		},
	};
}

export function readInteractionState<TRowData>(
	state: InteractionStateReadable<TRowData>,
	options?: InteractionStateBuildOptions
): GridInteractionState {
	if (isInteractionStateCurrent(state, options)) {
		return state.interaction!;
	}
	return buildInteractionState({
		selection: state.selection,
		activeEdit: state.activeEdit,
		selectedRowIds: state.selectedRowIds,
		...options,
	});
}

export function isInteractionStateCurrent<TRowData>(state: InteractionStateReadable<TRowData>, options?: InteractionStateBuildOptions): boolean {
	const interaction = state.interaction;
	if (!interaction) return false;
	const selection = normalizeSelectionState(state.selection);
	const focus = asCanonicalCellPointer(selection.focus);
	const expectedRowIndex = options?.getRowIndexByRowId
		? focus
			? (options.getRowIndexByRowId(focus.rowId) ?? null)
			: null
		: interaction.focus.rowIndex;
	return (
		interaction.activeEdit.kind === (state.activeEdit ? 'editing-cell' : 'idle') &&
		interaction.activeEdit.active === state.activeEdit &&
		interaction.rowSelection.selectedRowIds === state.selectedRowIds &&
		interaction.focus.cell === focus &&
		interaction.focus.rowIndex === expectedRowIndex &&
		interaction.focus.origin === (selection.focusOrigin ?? selection.source ?? null) &&
		interaction.focus.version === (selection.version ?? 0)
	);
}
