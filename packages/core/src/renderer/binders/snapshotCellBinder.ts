import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import {
	applyCellAccessibilityState,
	applyCellTitlesAndValidation,
	recordDispatchWrite,
	stampMountedVersions,
	getCellRendererLifecycle,
} from './binderShared.js';

/**
 * The `snapshot` render state: the cell shows its last rendered custom content without a live
 * update this frame.
 *  - `frozen-portal`: the portal already mounted in this cell stays in place, frozen (freeze mode),
 *    optionally capturing its committed DOM as an html snapshot for later replay.
 *  - `html-snapshot`: an inert HTML clone of the last fidelity render is replayed into the portal
 *    host (html-snapshot mode); the fidelity lane swaps the live portal back in after scroll.
 * Releasing a previously held portal (html-snapshot replaces it) is the dispatcher's job.
 */
export function applySnapshotCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const lifecycle = getCellRendererLifecycle(deps);

	if (presentation.kind === 'frozen-portal') {
		deps.cellRenderer.showPortalContent(cellSlot.element);
		const portalHost = deps.getCellPortalHost(cellSlot.element);
		applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
		applyCellAccessibilityState(cellSlot, cellCtrl);
		if (input.phase === 'scroll' && presentation.markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);

		// Serialize the host once — innerHTML is a full subtree serialization per read.
		const hostHtml = presentation.captureFrozenHtml && portalHost ? portalHost.innerHTML : '';
		if (presentation.captureFrozenHtml && presentation.recordVersions && 'rowId' in presentation.recordVersions && hostHtml) {
			const snapshot = presentation.recordVersions;
			const existing = deps.engine.htmlScrollSnapshots.getFresh
				? deps.engine.htmlScrollSnapshots.getFresh({
						rowId: snapshot.rowId,
						columnInstanceId: cellCtrl.columnInstanceId,
						expectedFreshness: snapshot,
						policy: 'visual',
					})
				: deps.engine.htmlScrollSnapshots.get?.(snapshot.rowId, cellCtrl.columnInstanceId, snapshot, { mode: 'visual' });
			if (hostHtml !== existing?.html) {
				lifecycle.captureHtml({
					cellCtrl,
					host: portalHost!,
					html: hostHtml,
					reason: 'freeze',
					token: {
						epoch: runtime.globalVersion,
						cellControllerKey: cellCtrl.key,
						rowId: cellCtrl.rowId,
						columnInstanceId: cellCtrl.columnInstanceId,
						freshness: cellCtrl.freshness ?? snapshot,
					},
					colField: cellCtrl.field,
					rowHeight: runtime.rowHeight,
					colWidth: runtime.colWidth,
				});
			}
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
		return;
	}

	if (presentation.kind !== 'html-snapshot') {
		throw new Error(`applySnapshotCellPresentation: '${presentation.kind}' is not a snapshot render state`);
	}
	if (input.phase === 'scroll') deps.incrementHtmlSnapshotHitsDuringScroll?.();
	if (input.phase === 'scroll') deps.markCellDirtyAfterScroll(cellSlot.element);
	applyCellTitlesAndValidation(cellSlot.element, presentation.title ?? null, '', presentation.validationError);
	applyCellAccessibilityState(cellSlot, cellCtrl);
	// Inject the static clone of the last fidelity render into the portal host so the cell looks
	// identical to its settled state during scroll. The host is inert — no React fiber, no event
	// handlers — and the fidelity lane replaces it with the live portal on the next post-scroll pass.
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
