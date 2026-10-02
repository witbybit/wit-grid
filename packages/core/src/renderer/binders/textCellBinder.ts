import { recordCellSlotMountedVisualVersions, type CellContentMode } from '../cellSlot.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { applyCellAccessibilityState, applyCellTitlesAndValidation, recordDispatchWrite, stampMountedVersions } from './binderShared.js';

/**
 * The `text` render state: every outcome that writes a string (or a placeholder mode) into the
 * cell and holds no portal — plain primitive text, buffered off-screen content, loading skeletons
 * and stand-in text. They differ only in the content mode written, whether the cell is
 * marked dirty for the post-scroll repaint, and how mounted versions are recorded; the write itself
 * is shared. Releasing a previously held portal is the dispatcher's job.
 */
export function applyTextCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const isScroll = input.phase === 'scroll';

	let contentMode: CellContentMode;
	let text = presentation.formattedValue ?? '';
	let value: unknown = undefined;
	let portalKey: string | undefined = undefined;
	let markDirty: boolean;
	/** stamp: versions from a snapshot/freshness; mounted: record this bind as the mounted version. */
	let versions: 'stamp' | 'mounted' | 'none';

	switch (presentation.kind) {
		case 'buffered':
			contentMode = presentation.contentMode ?? 'empty';
			portalKey = presentation.portalKey;
			markDirty = false;
			versions = 'stamp';
			break;
		case 'primitive':
			contentMode = presentation.contentMode ?? 'text';
			markDirty = !!presentation.markDirty;
			versions = 'stamp';
			break;
		case 'loading':
			deps.cellRenderer.ensureLoadingSkeleton(cellSlot.element);
			contentMode = 'loading';
			value = cellCtrl.valueState.value;
			markDirty = false;
			versions = 'none';
			break;
		case 'stand-in':
			contentMode = presentation.contentMode ?? 'fallback';
			markDirty = true;
			versions = 'mounted';
			break;
		default:
			throw new Error(`applyTextCellPresentation: '${presentation.kind}' is not a text render state`);
	}

	if (isScroll && markDirty) deps.markCellDirtyAfterScroll(cellSlot.element);
	applyCellTitlesAndValidation(cellSlot, presentation.title ?? null, '', presentation.validationError);
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
		contentMode,
		value,
		text,
		portalKey,
		geometry.dragShift
	);
	if (versions === 'stamp') {
		if (presentation.recordVersions) stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
	} else if (versions === 'mounted') {
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
		if (presentation.recordVersions && !('rowId' in presentation.recordVersions)) {
			recordCellSlotMountedVisualVersions(cellSlot, presentation.recordVersions);
		}
	}
	recordDispatchWrite(input, didWrite);
}
