import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import { isHtmlSnapshotPresentation } from '../scrollPresentationMode.js';
import {
	applyCellAccessibilityState,
	applyCellTitlesAndValidation,
	recordDispatchWrite,
	stampMountedVersions,
	getCellRendererLifecycle,
} from './binderShared.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';

/**
 * scrollPresentation: 'text-impostor' — the explicit, always-on text/chip stand-in via
 * capabilities.textImpostor.render ('text-impostor' kind). Also handles 'impostor-text', the
 * implicit text fallback used by 'freeze' mode (from a snapshot that demanded impostor) and by
 * 'html-snapshot' mode when allowTextFallbackWhenMissing is set — both share the identical apply
 * shape, differing only in which telemetry counter increments.
 */
export function applyTextImpostorCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const lifecycle = getCellRendererLifecycle(deps);

	if (presentation.textImpostorSource === 'fallback') {
		if (runtime.mount && isHtmlSnapshotPresentation(runtime.mount.col)) deps.incrementHtmlSnapshotMissesDuringScroll?.();
		if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'invalidated', cellElement: cellSlot.element });
		if (input.phase === 'scroll') deps.markCellDirtyAfterScroll(cellSlot.element);
		applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
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
			presentation.contentMode ?? 'fallback',
			undefined,
			presentation.formattedValue ?? '',
			undefined,
			geometry.dragShift
		);
		if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
		recordDispatchWrite(input, didWrite);
		return;
	}

	// Explicit text-impostor mode.
	if (input.phase === 'scroll') deps.incrementTextImpostorUsesDuringScroll?.();
	if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'invalidated', cellElement: cellSlot.element });
	if (input.phase === 'scroll') deps.markCellDirtyAfterScroll(cellSlot.element);
	applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
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
		presentation.contentMode ?? 'fallback',
		undefined,
		presentation.formattedValue ?? '',
		undefined,
		geometry.dragShift
	);
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
	if (presentation.recordVersions && !('rowId' in presentation.recordVersions)) {
		recordCellSlotMountedVisualVersions(cellSlot, presentation.recordVersions);
	}
	recordDispatchWrite(input, didWrite);
}
