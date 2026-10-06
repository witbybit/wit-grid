import { recordCellSlotMountedVisualVersions, type CellSlot } from '../cellSlot.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { applyCellAccessibilityState, markCellForPostScrollRepair, recordDispatchWrite } from './binderShared.js';
import { PostScrollRepairReason } from '../cellPresentationStateMachine.js';

const ROW_CHECKBOX_CLASS = 'og-row-checkbox';
const GROUP_CHECKBOX_CLASS = 'og-row-checkbox og-group-select-checkbox';

export type SelectionCheckboxState = 'all' | 'some' | 'none';

/**
 * The one selection checkbox a checkbox-column cell owns, for a data row or a group row. The input
 * is reused across rebinds (row ⇄ group included) and carries no row identity: a click resolves its
 * row from the cell's authoritative CellSlot binding, so a recycled checkbox can never toggle the
 * row it showed before.
 */
export function syncSelectionCheckbox(cellSlot: CellSlot<any>, kind: 'row' | 'group', state: SelectionCheckboxState, rowIndex: number): void {
	let checkbox = cellSlot.rowCheckbox;
	if (!checkbox || checkbox.parentNode !== cellSlot.contentElement) {
		checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.title = 'Select row. Shift-click selects a range.';
		cellSlot.contentElement.textContent = '';
		cellSlot.contentElement.appendChild(checkbox);
		cellSlot.rowCheckbox = checkbox;
		cellSlot.rowCheckboxLabelKey = -1;
	}
	const className = kind === 'row' ? ROW_CHECKBOX_CLASS : GROUP_CHECKBOX_CLASS;
	if (checkbox.className !== className) checkbox.className = className;
	const checked = state === 'all';
	const indeterminate = state === 'some';
	if (checkbox.checked !== checked) checkbox.checked = checked;
	if (checkbox.indeterminate !== indeterminate) checkbox.indeterminate = indeterminate;
	const labelKey = rowIndex * 4 + (kind === 'group' ? 2 : 0) + (checked ? 1 : 0);
	if (cellSlot.rowCheckboxLabelKey !== labelKey) {
		cellSlot.rowCheckboxLabelKey = labelKey;
		const subject = kind === 'group' ? `group at row ${rowIndex + 1}` : `row ${rowIndex + 1}`;
		checkbox.setAttribute('aria-label', checked ? `Deselect ${subject}` : `Select ${subject}`);
	}
}

/** Removes the selection checkbox when a checkbox-column cell shows something else (loading, totals). */
export function clearSelectionCheckbox(cellSlot: CellSlot<any>): void {
	const checkbox = cellSlot.rowCheckbox;
	if (!checkbox) return;
	if (checkbox.parentNode === cellSlot.contentElement) checkbox.remove();
	cellSlot.rowCheckbox = null;
	cellSlot.rowCheckboxLabelKey = -1;
}

/** The `checkbox` render state: the row-selection checkbox column. */
export function applyCheckboxCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;

	if (input.phase === 'scroll' && presentation.needsPostScrollRepair) {
		markCellForPostScrollRepair(deps, cellSlot, PostScrollRepairReason.Presentation);
	}
	// Written on every phase, scroll included: a recycled slot must never show the previous row's
	// checked state. It is one cached-set lookup and property writes only when something changed.
	if (runtime.checkbox) syncSelectionCheckbox(cellSlot, 'row', runtime.checkbox.checked ? 'all' : 'none', geometry.rowIndex);
	applyCellAccessibilityState(cellSlot, cellCtrl);
	const didWrite = cellSlot.update(
		geometry.colIndex,
		cellCtrl.field,
		geometry.rowIndex,
		cellCtrl.rowId,
		geometry.left,
		geometry.right,
		geometry.width,
		presentation.className,
		'custom',
		undefined,
		'',
		undefined,
		geometry.dragShift
	);
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
	recordCellSlotMountedVisualVersions(cellSlot, {
		insightVersion: cellCtrl.freshness?.insightVersion ?? -1,
		styleVersion: cellCtrl.freshness?.styleVersion ?? -1,
		loadingVersion: cellCtrl.freshness?.loadingVersion ?? -1,
		selectionVersion: cellCtrl.freshness?.selectionVersion ?? -1,
	});
	recordDispatchWrite(input, didWrite);
}
