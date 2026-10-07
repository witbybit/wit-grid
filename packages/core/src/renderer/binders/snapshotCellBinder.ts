import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import {
	applyCellAccessibilityState,
	applyCellTitlesAndValidation,
	markCellForPostScrollRepair,
	recordDispatchWrite,
	stampMountedVersions,
} from './binderShared.js';
import { PostScrollRepairReason } from '../cellPresentationStateMachine.js';

/**
 * The `snapshot` render state: the cell shows its last rendered custom content without a live
 * update this frame. `frozen-portal` — the portal already mounted in this cell stays in place,
 * frozen, until the post-scroll repaint refreshes it.
 */
export function applySnapshotCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	if (presentation.kind !== 'frozen-portal') {
		throw new Error(`applySnapshotCellPresentation: '${presentation.kind}' is not a snapshot render state`);
	}

	deps.cellRenderer.showPortalContent(cellSlot.element);
	applyCellTitlesAndValidation(cellSlot, presentation.title ?? null, '', presentation.validationError);
	applyCellAccessibilityState(cellSlot, cellCtrl);
	if (input.phase === 'scroll' && presentation.needsPostScrollRepair) {
		markCellForPostScrollRepair(deps, cellSlot, PostScrollRepairReason.Presentation);
	}

	const didWrite = cellSlot.update(
		geometry.colIndex,
		cellCtrl.field,
		geometry.rowIndex,
		cellCtrl.rowId,
		geometry.left,
		geometry.right,
		geometry.width,
		presentation.className,
		'portal',
		undefined,
		'',
		presentation.portalKey,
		geometry.dragShift
	);
	if (presentation.keepVersionFresh) {
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
	}
	if (presentation.recordVersions && 'rowId' in presentation.recordVersions) {
		stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
	}
	recordDispatchWrite(input, didWrite);
}
