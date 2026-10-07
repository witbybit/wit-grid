import type { CellRendererPhase, ColumnDef } from '../../columnDef.js';
import { PortalRendererHandle } from '../cellRendererHandle.js';
import type { CellCtrl } from '../controllers/CellCtrl.js';
import type { RowCtrl } from '../controllers/RowCtrl.js';
import type { RowCellBinderDeps } from '../rowCellBinder.js';
import type { RowNode } from '../../rowNode.js';
import type { ViewportPlan } from '../viewportPlanner.js';
import type { CellSlot } from '../cellSlot.js';
import { applyTextCellPresentation } from './textCellBinder.js';
import { applyLiveCellPresentation } from './liveCellBinder.js';
import { applySnapshotCellPresentation } from './snapshotCellBinder.js';
import { applyCheckboxCellPresentation } from './checkboxCellBinder.js';
import { getCellRendererLifecycle } from './binderShared.js';
import { createCellPresentationTransition, planCellPresentationTransitionInto } from '../cellPresentationStateMachine.js';
import { reportRendererFault } from '../rendererFaults.js';

export interface CellBindGeometry {
	rowIndex: number;
	colIndex: number;
	left: number;
	right: number;
	width: number;
	dragShift: number;
	lane: 'left' | 'center' | 'right';
}

export interface CellBindRuntime<TRowData> {
	globalVersion: number;
	rowSlotId: string;
	slotGeneration: number;
	rowHeight?: number;
	colWidth?: number;
	mount?: {
		node: RowNode<TRowData>;
		col: ColumnDef<TRowData>;
		value: unknown;
		isLoading: boolean;
		isSelected: boolean;
		renderPhase: CellRendererPhase;
	};
	/** Present for checkbox-selection columns on every bind phase, scroll included. */
	checkbox?: {
		checked: boolean;
	};
}

export interface DispatchCellPresentationInput<TRowData> {
	deps: RowCellBinderDeps<TRowData>;
	cellCtrl: CellCtrl;
	rowCtrl: RowCtrl<TRowData>;
	cellSlot: CellSlot<TRowData>;
	viewportPlan: ViewportPlan | null;
	geometry: CellBindGeometry;
	runtime: CellBindRuntime<TRowData>;
	phase: 'scroll' | 'full-bind' | 'prewarm' | 'fidelity';
	rowVersion: number;
}

// Dispatch is synchronous and consumes this record before invoking renderer code. Reusing it keeps
// the per-cell transition decision allocation-free in scroll and realtime update paths.
const transitionScratch = createCellPresentationTransition();

/**
 * Dispatch only. Presentation authority lives on CellCtrl; binders receive the controller and apply
 * its already-resolved state onto the physical CellSlot.
 *
 * Owns the one render-state transition that can leak: leaving a portal. Whatever portal the cell
 * really holds (the portal registry's view of its host, else the slot's own record) is released
 * exactly once here unless the next presentation keeps that same portal; binders never release.
 */
export function dispatchCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { cellSlot, cellCtrl, deps } = input;
	const nextPresentation = cellCtrl.presentationState;

	const host = deps.getCellPortalHost(cellSlot.element);
	const existing = cellSlot.renderer;
	const heldPortalKey =
		(host ? deps.portalMountManager.getMountedKeyForContainer?.(host) : undefined) ??
		(existing instanceof PortalRendererHandle ? existing.portalKey : undefined) ??
		cellSlot.lastPortalKey;
	const transition = transitionScratch;
	planCellPresentationTransitionInto(transition, heldPortalKey, nextPresentation);
	// A resolver bug must not abort the frame: report it and render the presentation with only the
	// portal ownership it is allowed (the planner already dropped a disallowed key).
	if (transition.violation) {
		reportRendererFault(deps.engine, 'cell-presentation-invariant', new Error(transition.violation), {
			kind: nextPresentation.kind,
			rowId: cellCtrl.rowId,
			field: cellCtrl.field,
		});
	}
	// Release may cross an adapter boundary. Capture the decision before that call so a re-entrant
	// dispatch cannot overwrite the shared scratch record before this dispatch reaches its binder.
	const nextRoute = transition.nextRoute;
	if (transition.releasePortalKey) {
		getCellRendererLifecycle(deps).release({
			reason: 'invalidated',
			cellElement: cellSlot.element,
			portalKey: transition.releasePortalKey,
		});
		// Scroll binds never reassign the handle; a stale one would re-request this release later.
		if (existing instanceof PortalRendererHandle) cellSlot.renderer = null;
	}

	switch (nextRoute) {
		case 'text':
			applyTextCellPresentation(input);
			break;
		case 'live':
			applyLiveCellPresentation(input);
			break;
		case 'snapshot':
			applySnapshotCellPresentation(input);
			break;
		case 'checkbox':
			applyCheckboxCellPresentation(input);
			break;
	}
	cellSlot.commitBinding(
		input.runtime.rowSlotId,
		cellCtrl.rowId,
		input.geometry.rowIndex,
		cellCtrl.colId,
		input.geometry.colIndex,
		cellCtrl.key,
		cellSlot.lastContentMode
	);
}
