import type { CellRendererPhase, ColumnDef } from '../../columnDef.js';
import { PortalRendererHandle } from '../cellRendererHandle.js';
import type { CellCtrl } from '../controllers/CellCtrl.js';
import type { RowCtrl } from '../controllers/RowCtrl.js';
import type { RowCellBinderDeps } from '../rowCellBinder.js';
import type { RowNode } from '../../rowNode.js';
import type { ViewportPlan } from '../viewportPlanner.js';
import type { CellSlot } from '../cellSlot.js';
import { applyPrimitiveCellPresentation } from './primitiveCellBinder.js';
import { applyLiveCellPresentation } from './liveCellBinder.js';
import { applyFreezeCellPresentation } from './freezeCellBinder.js';
import { applyTextImpostorCellPresentation } from './textImpostorCellBinder.js';
import { applyHtmlSnapshotCellPresentation } from './htmlSnapshotCellBinder.js';

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
	checkbox?: {
		checked: boolean;
		ariaLabel: string;
		title: string;
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

/**
 * Dispatch only. Presentation authority lives on CellCtrl; binders receive the controller and apply
 * its already-resolved state onto the physical CellSlot.
 */
export function dispatchCellPresentation<TRowData>(input: DispatchCellPresentationInput<TRowData>): void {
	const { cellSlot, cellCtrl, deps } = input;
	const existing = cellSlot.renderer;
	const nextPresentation = cellCtrl.presentationState;

	if (existing instanceof PortalRendererHandle) {
		const nextPortalKey =
			nextPresentation.kind === 'live-renderer' || nextPresentation.kind === 'frozen-portal' ? nextPresentation.portalKey : undefined;

		if (!nextPortalKey || existing.portalKey !== nextPortalKey) {
			deps.releaseCellPortal(cellSlot.element, false, 'invalidated', existing.portalKey);
			// Scroll binds never reassign the handle, so drop it here: otherwise every later bind
			// (each scroll frame, then the settling full bind) releases the same portal again, and
			// once the deferred release has run that repeat finds no identity and reports a fault.
			cellSlot.renderer = null;
		}
	}

	switch (nextPresentation.kind) {
		case 'buffered':
		case 'primitive':
		case 'loading':
			return applyPrimitiveCellPresentation(input);

		case 'live-renderer':
			return applyLiveCellPresentation(input);

		case 'checkbox-selector':
		case 'frozen-portal':
		case 'shell':
			return applyFreezeCellPresentation(input);

		case 'text-impostor':
			return applyTextImpostorCellPresentation(input);

		case 'html-snapshot':
		case 'html-pending':
			return applyHtmlSnapshotCellPresentation(input);
	}
}
