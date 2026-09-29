import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import {
	applyCellAccessibilityState,
	applyCellTitlesAndValidation,
	recordDispatchWrite,
	stampMountedVersions,
	getCellRendererLifecycle,
} from './binderShared.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';

/**
 * scrollPresentation: 'html-snapshot' — replays a captured inert HTML clone during scroll
 * ('impostor-html'). When no fresh capture is available and text fallback isn't explicitly allowed,
 * shows a stable shell/pending placeholder instead of raw text ('html-snapshot-pending').
 */
export function applyHtmlSnapshotCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const lifecycle = getCellRendererLifecycle(deps);

	if (presentation.kind === 'html-pending') {
		if (input.phase === 'scroll') deps.incrementHtmlSnapshotMissesDuringScroll?.();
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
			'pending',
			undefined,
			'',
			undefined,
			geometry.dragShift
		);
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
		if (presentation.recordVersions && !('rowId' in presentation.recordVersions)) {
			recordCellSlotMountedVisualVersions(cellSlot, presentation.recordVersions);
		}
		recordDispatchWrite(input, didWrite);
		return;
	}

	// Html snapshot path.
	if (input.phase === 'scroll') deps.incrementHtmlSnapshotHitsDuringScroll?.();
	if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'invalidated', cellElement: cellSlot.element });
	if (input.phase === 'scroll') deps.markCellDirtyAfterScroll(cellSlot.element);
	applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
	applyCellAccessibilityState(cellSlot, cellCtrl);
	// HTML snapshot path: inject the static clone of the last fidelity render into the
	// portal host so the cell looks identical to its settled state during scroll. The host
	// is inert — no React fiber, no event handlers — and the fidelity lane will replace it
	// with the live portal on the next post-scroll pass.
	const portalHost = deps.ensureCellPortalHost(cellSlot.element);
	const html = presentation.html ?? '';
	// Skip the (parse + subtree replace) write when this host still holds exactly what we wrote last
	// time — see CellSlot.lastSnapshotHtml for why the boundary-node check is sufficient.
	const hostUnchanged =
		cellSlot.lastSnapshotHtml === html &&
		portalHost.firstChild === cellSlot.lastSnapshotHtmlFirst &&
		portalHost.lastChild === cellSlot.lastSnapshotHtmlLast;
	if (!hostUnchanged) {
		portalHost.innerHTML = html;
		cellSlot.lastSnapshotHtml = html;
		cellSlot.lastSnapshotHtmlFirst = portalHost.firstChild;
		cellSlot.lastSnapshotHtmlLast = portalHost.lastChild;
	}

	deps.cellRenderer.showPortalContent(cellSlot.element);
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
		undefined,
		geometry.dragShift
	);
	if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
	recordDispatchWrite(input, didWrite);
}
