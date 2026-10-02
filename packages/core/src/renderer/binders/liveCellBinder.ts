import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { PortalRendererHandle } from '../cellRendererHandle.js';
import { recordCellSlotMountedVisualVersions } from '../cellSlot.js';
import type { ControllerWorkToken } from '../controllers/CellCtrl.js';
import type { CellRendererLifecycle } from '../lifecycle/cellRendererLifecycle.js';
import {
	applyCellAccessibilityState,
	applyCellTitlesAndValidation,
	recordDispatchWrite,
	stampMountedVersions,
	getCellRendererLifecycle,
	isOverscanLiveCell,
} from './binderShared.js';

/**
 * Scroll binds never run assignRendererHandle, so a portal mounted here must be recorded on the
 * slot directly; otherwise the next non-portal bind finds no handle, releases nothing, and the
 * portal (e.g. an editor kept live through scroll) leaks.
 */
function recordHeldPortal<TRowData>(cellSlot: DispatchCellPresentationInput<TRowData>['cellSlot'], portalKey: string): void {
	const held = cellSlot.renderer;
	if (held instanceof PortalRendererHandle && held.portalKey === portalKey) return;
	cellSlot.renderer = new PortalRendererHandle<TRowData>(portalKey);
}

function isOverscanLiveExecution<TRowData>(input: DispatchCellPresentationInput<TRowData>): boolean {
	if (input.phase !== 'scroll' || !input.viewportPlan) return false;
	return isOverscanLiveCell(input.viewportPlan.liveCells.overscan, input.geometry.rowIndex, input.cellCtrl.columnInstanceId);
}

/** Renders the over-budget emergency shell for a live cell that couldn't be granted this frame's
 * budget: the cell's text, as the default stand-in shows, rather than a blank cell. */
function applyLiveMountEmergencyShell<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const standIn = deps.engine.getCheapDisplayValue?.(cellCtrl.rowId, cellCtrl.field) ?? '';
	deps.incrementLiveReactEmergencyShellsDuringScroll?.();
	if (input.phase === 'scroll') deps.markCellDirtyAfterScroll(cellSlot.element);
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
		standIn !== '' ? 'fallback' : 'pending',
		undefined,
		standIn,
		undefined,
		0
	);
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
	recordDispatchWrite(input, didWrite);
}
type DomUpdateMount<TRowData> = Parameters<CellRendererLifecycle<TRowData>['updateLive']>[0]['mount'];
const domUpdateTokenScratch: ControllerWorkToken = {
	epoch: 0,
	cellControllerKey: '' as ControllerWorkToken['cellControllerKey'],
	rowId: '',
	columnInstanceId: '' as ControllerWorkToken['columnInstanceId'],
	freshness: undefined as unknown as ControllerWorkToken['freshness'],
};
const domUpdateMountScratch = {} as DomUpdateMount<unknown>;

/**
 * `dom-update`: a DOM renderer cell updated in place during scroll. The frame's DOM-update budget
 * admits it; the renderer's update() (or, for a slot's first use, mount()) runs now, and the cell is
 * recorded fresh with no dirty mark, so scroll-end has nothing to redo. A refused cell shows its
 * stand-in text and is marked for the post-scroll repaint instead.
 */
function applyDomUpdateCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const mountRuntime = runtime.mount;
	if (!mountRuntime) throw new Error('DOM update presentation requires mount runtime.');
	applyCellTitlesAndValidation(cellSlot, presentation.title ?? null, '', presentation.validationError);
	applyCellAccessibilityState(cellSlot, cellCtrl);

	if (!(deps.tryConsumeDomUpdateBudget?.() ?? true)) {
		deps.incrementDomUpdatesDeferredDuringScroll?.();
		deps.markCellDirtyAfterScroll(cellSlot.element);
		const didWrite = cellSlot.update(
			geometry.colIndex,
			cellCtrl.field,
			geometry.rowIndex,
			cellCtrl.rowId,
			geometry.left,
			geometry.right,
			geometry.width,
			presentation.className,
			presentation.formattedValue ? 'fallback' : 'empty',
			undefined,
			presentation.formattedValue ?? '',
			undefined,
			geometry.dragShift
		);
		recordDispatchWrite(input, didWrite);
		return;
	}

	deps.incrementDomUpdatesDuringScroll?.();
	const lifecycle = getCellRendererLifecycle(deps);
	const host = deps.ensureCellPortalHost(cellSlot.element);
	// Scratch, refilled per cell: the lifecycle checks the token and copies the mount fields before
	// any renderer code runs, and keeps neither, so one pair serves every DOM update.
	const token = domUpdateTokenScratch;
	token.epoch = runtime.globalVersion;
	token.cellControllerKey = cellCtrl.key;
	token.rowId = cellCtrl.rowId;
	token.columnInstanceId = cellCtrl.columnInstanceId;
	token.freshness = cellCtrl.freshness!;
	const mount = domUpdateMountScratch as DomUpdateMount<TRowData>;
	mount.cellKey = presentation.portalKey!;
	mount.value = mountRuntime.value;
	mount.node = mountRuntime.node;
	mount.col = mountRuntime.col;
	mount.rowIndex = geometry.rowIndex;
	mount.colIndex = geometry.colIndex;
	mount.rowSlotId = runtime.rowSlotId;
	mount.slotGeneration = runtime.slotGeneration;
	mount.cellRowBindingGeneration = cellSlot.rowBindingGeneration;
	mount.cellInstanceId = cellSlot.cellInstanceId;
	mount.portalHostId = cellSlot.portalHostId;
	mount.isEditing = false;
	mount.isLoading = mountRuntime.isLoading;
	mount.isFocused = cellCtrl.visualState.focused;
	mount.isSelected = mountRuntime.isSelected;
	try {
		if (deps.portalMountManager.isCellMounted(mount.cellKey)) lifecycle.updateLive({ cellCtrl, host, reason: 'scroll-live', token, mount });
		else lifecycle.mountLive({ cellCtrl, host, reason: 'scroll-live', token, mount });
	} finally {
		deps.endDomUpdate?.();
	}
	recordHeldPortal(cellSlot, mount.cellKey);
	deps.cellRenderer.showPortalContent(cellSlot.element);

	// Final as drawn: record it fresh so the post-scroll repaint skips it.
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
	const versions = presentation.recordVersions;
	if (versions && 'rowId' in versions) stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, versions);
	else if (versions) recordCellSlotMountedVisualVersions(cellSlot, versions);

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
		mount.cellKey,
		geometry.dragShift
	);
	recordDispatchWrite(input, didWrite);
}

export function applyLiveCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	if (presentation.kind === 'dom-update') return applyDomUpdateCellPresentation(input);
	const lifecycle = getCellRendererLifecycle(deps);
	const mountRuntime = runtime.mount;
	if (!mountRuntime) throw new Error('Live cell presentation requires mount runtime.');

	if (presentation.forceLiveInteractive) {
		if (input.phase === 'scroll') deps.incrementForceLiveMountsDuringScroll?.();
		if (input.phase === 'scroll') deps.markCellDirtyAfterScroll(cellSlot.element);
		const ensuredPortalHost = deps.ensureCellPortalHost(cellSlot.element);
		lifecycle.mountLive({
			cellCtrl,
			host: ensuredPortalHost,
			reason: input.phase === 'full-bind' ? 'full-bind' : 'scroll-force-live',
			token: {
				epoch: runtime.globalVersion,
				cellControllerKey: cellCtrl.key,
				rowId: cellCtrl.rowId,
				columnInstanceId: cellCtrl.columnInstanceId,
				freshness: cellCtrl.freshness!,
			},
			mount: {
				cellKey: presentation.portalKey!,
				value: mountRuntime.value,
				node: mountRuntime.node,
				col: mountRuntime.col,
				rowIndex: geometry.rowIndex,
				colIndex: geometry.colIndex,
				rowSlotId: runtime.rowSlotId,
				slotGeneration: runtime.slotGeneration,
				cellRowBindingGeneration: cellSlot.rowBindingGeneration,
				cellInstanceId: cellSlot.cellInstanceId,
				portalHostId: cellSlot.portalHostId,
				isEditing: cellCtrl.visualState.editing,
				isLoading: mountRuntime.isLoading,
				isFocused: cellCtrl.visualState.focused,
				isSelected: mountRuntime.isSelected,
			},
		});
		recordHeldPortal(cellSlot, presentation.portalKey!);
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
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
			'portal',
			undefined,
			'',
			presentation.portalKey,
			geometry.dragShift
		);
		if (presentation.recordVersions && 'rowId' in presentation.recordVersions)
			stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
		recordDispatchWrite(input, didWrite);
		return;
	}

	const isFreshMount = !deps.portalMountManager.isCellMounted(presentation.portalKey!);
	const withinBudget = deps.tryConsumeLiveBudget?.(isFreshMount ? 'mount' : 'update') ?? true;
	if (!withinBudget) {
		// An over-budget update keeps the mounted content, unless the slot was just recycled to
		// another row: that content is the previous row's, so it must not stay visible.
		if (!isFreshMount && cellSlot.rowId === cellCtrl.rowId) return;
		if (deps.allowLiveEmergencyShell?.() ?? true) {
			applyLiveMountEmergencyShell(input);
			return;
		}
	}
	if (input.phase === 'scroll') {
		if (isFreshMount) deps.incrementLiveReactMountsDuringScroll?.();
		else deps.incrementLiveReactUpdatesDuringScroll?.();
		if (isOverscanLiveExecution(input)) deps.incrementLiveReactOverscanMountsDuringScroll?.();
	}
	if (input.phase === 'scroll') deps.markCellDirtyAfterScroll(cellSlot.element);
	const ensuredPortalHost = deps.ensureCellPortalHost(cellSlot.element);
	const token = {
		epoch: runtime.globalVersion,
		cellControllerKey: cellCtrl.key,
		rowId: cellCtrl.rowId,
		columnInstanceId: cellCtrl.columnInstanceId,
		freshness: cellCtrl.freshness!,
	};
	const mount = {
		cellKey: presentation.portalKey!,
		value: mountRuntime.value,
		node: mountRuntime.node,
		col: mountRuntime.col,
		rowIndex: geometry.rowIndex,
		colIndex: geometry.colIndex,
		rowSlotId: runtime.rowSlotId,
		slotGeneration: runtime.slotGeneration,
		cellRowBindingGeneration: cellSlot.rowBindingGeneration,
		cellInstanceId: cellSlot.cellInstanceId,
		portalHostId: cellSlot.portalHostId,
		isEditing: cellCtrl.visualState.editing,
		isLoading: mountRuntime.isLoading,
		isFocused: cellCtrl.visualState.focused,
		isSelected: mountRuntime.isSelected,
	};
	if (isFreshMount)
		lifecycle.mountLive({ cellCtrl, host: ensuredPortalHost, reason: input.phase === 'full-bind' ? 'full-bind' : 'scroll-live', token, mount });
	else lifecycle.updateLive({ cellCtrl, host: ensuredPortalHost, reason: input.phase === 'full-bind' ? 'full-bind' : 'scroll-live', token, mount });
	recordHeldPortal(cellSlot, presentation.portalKey!);
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
	if (input.phase === 'full-bind' && cellCtrl.scrollPresentation === 'html-snapshot') {
		lifecycle.captureHtml({
			cellCtrl,
			host: ensuredPortalHost,
			reason: 'full-bind',
			token,
			colField: cellCtrl.field,
			rowHeight: runtime.rowHeight,
			colWidth: runtime.colWidth,
		});
	}
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
		'portal',
		undefined,
		'',
		presentation.portalKey,
		geometry.dragShift
	);
	if (presentation.recordVersions && 'rowId' in presentation.recordVersions)
		stampMountedVersions(cellSlot, rowVersion, runtime.globalVersion, presentation.recordVersions);
	recordDispatchWrite(input, didWrite);
}
