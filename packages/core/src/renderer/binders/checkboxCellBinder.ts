import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { applyCellAccessibilityState, markCellForPostScrollRepair, recordDispatchWrite } from './binderShared.js';
import { PostScrollRepairReason } from '../cellPresentationStateMachine.js';

/** The `checkbox` render state: the row-selection checkbox column. */
export function applyCheckboxCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;

	if (input.phase === 'scroll' && presentation.needsPostScrollRepair) {
		markCellForPostScrollRepair(deps, cellSlot, PostScrollRepairReason.Presentation);
	}
	if (input.phase === 'full-bind' && runtime.checkbox) {
		// Cached on the slot; the parent check re-queries only if something replaced it.
		let checkbox = cellSlot.rowCheckbox;
		if (!checkbox || checkbox.parentNode !== cellSlot.contentElement) {
			checkbox = cellSlot.contentElement.querySelector<HTMLInputElement>('input[type="checkbox"].og-row-checkbox');
		}
		if (!checkbox) {
			checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.className = 'og-row-checkbox';
			cellSlot.contentElement.textContent = '';
			cellSlot.contentElement.appendChild(checkbox);
		}
		cellSlot.rowCheckbox = checkbox;
		checkbox.dataset.rowId = cellCtrl.rowId;
		checkbox.setAttribute('aria-label', runtime.checkbox.ariaLabel);
		checkbox.title = runtime.checkbox.title;
		if (checkbox.checked !== runtime.checkbox.checked) checkbox.checked = runtime.checkbox.checked;
	}
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
