import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import {
	applyCellAccessibilityState,
	applyCellTitlesAndValidation,
	recordDispatchWrite,
	stampMountedVersions,
	getCellRendererLifecycle,
	isOverscanLiveCell,
} from './binderShared.js';

function isOverscanLiveExecution<TRowData>(input: DispatchCellPresentationInput<TRowData>): boolean {
	if (input.phase !== 'scroll' || !input.viewportPlan) return false;
	return isOverscanLiveCell(input.viewportPlan.liveCells.overscan, input.geometry.rowIndex, input.cellCtrl.columnInstanceId);
}

/** Renders the over-budget emergency shell for a fresh live mount that couldn't be granted this
 * frame's mount budget. */
function applyLiveMountEmergencyShell<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	deps.incrementLiveReactEmergencyShellsDuringScroll?.();
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
		0
	);
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
	recordDispatchWrite(input, didWrite);
}
export function applyLiveCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { deps, cellCtrl, cellSlot, geometry, runtime, rowVersion } = input;
	const presentation = cellCtrl.presentationState;
	const lifecycle = getCellRendererLifecycle(deps);
	const mountRuntime = runtime.mount;
	if (!mountRuntime) throw new Error('Live cell presentation requires mount runtime.');

	if (presentation.forceLiveInteractive) {
		if (input.phase === 'scroll') deps.incrementForceLiveMountsDuringScroll?.();
		if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'scrolled-out', cellElement: cellSlot.element });
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
		cellSlot.lastMountedRowVersion = rowVersion;
		cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
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
		if (!isFreshMount) return;
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
	if (presentation.releaseStalePortal) lifecycle.release({ cellCtrl, reason: 'scrolled-out', cellElement: cellSlot.element });
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
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = runtime.globalVersion;
	if (input.phase === 'full-bind' && cellCtrl.scrollPresentation === 'html-snapshot') {
		lifecycle.captureHtml({
			cellCtrl,
			host: ensuredPortalHost,
			reason: 'full-bind',
			token,
			cellSlot,
			colField: cellCtrl.field,
			rowHeight: runtime.rowHeight,
			colWidth: runtime.colWidth,
		});
	}
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
