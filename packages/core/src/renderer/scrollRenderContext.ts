import type { CompiledGridPlan } from '../columnDef.js';
import type { ActiveEditState, CanonicalGridCellPointer, GridCellRangeBounds } from '../api/GridApi.js';
import type { InternalGridState } from '../state/GridState.js';
import type { CompiledStyleRules } from '../styling/styleRules.js';

export interface ScrollRenderContext<TRowData = unknown> {
	isScrolling: boolean;

	state?: InternalGridState<TRowData>;
	stateVersion: number;
	// Per-row version map: rowId → version bumped on each row data mutation.
	// Used by the freeze check to thaw only cells whose row actually changed.
	rowVersions: ReadonlyMap<string, number>;
	// Bumped on any structural change (sort, filter, group, row add/remove).
	// When this changes all frozen portals must thaw.
	globalVersion: number;
	insightVersion: number;
	styleVersion: number;
	loadingVersion: number;
	selectionVersion: number;
	styleChangedDuringScroll: boolean;
	loadingChangedDuringScroll: boolean;
	selectionChangedDuringScroll: boolean;
	globalChangedDuringScroll: boolean;

	activeEdit: ActiveEditState | null;

	hasDeferredCellStyleRules: boolean;
	/** The grid's compiled style rules, for cell rules evaluated as cells enter view during scroll. */
	compiledStyleRules?: CompiledStyleRules<TRowData>;
	hasCustomRenderers: boolean;
	hasInsightDecorations: boolean;

	plan: CompiledGridPlan<TRowData>;
	visibleRowRange: { startIdx: number; endIdx: number };
	visibleColRange: { startIdx: number; endIdx: number };

	focusedCell: CanonicalGridCellPointer | null;
	selectionBounds?: GridCellRangeBounds;

	canUseCachedDisplayValues: boolean;
}
