import type { CellRendererPhase, ColumnDef } from '../../columnDef.js';
import { PortalRendererHandle } from '../cellRendererHandle.js';
import type { CellCtrl } from '../controllers/CellCtrl.js';
import type { RowCtrl } from '../controllers/RowCtrl.js';
import type { RowCellBinderDeps } from '../rowCellBinder.js';
import type { RowNode } from '../../rowNode.js';
import type { ViewportPlan } from '../viewportPlanner.js';
import type { CellSlot } from '../cellSlot.js';
import type { CellCtrlPresentationState } from '../controllers/CellCtrl.js';
import { applyTextCellPresentation } from './textCellBinder.js';
import { applyLiveCellPresentation } from './liveCellBinder.js';
import { applySnapshotCellPresentation } from './snapshotCellBinder.js';
import { applyCheckboxCellPresentation } from './checkboxCellBinder.js';
import { getCellRendererLifecycle } from './binderShared.js';

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
 * The four render states a cell can be in. Every presentation kind (a descriptive label the
 * resolver and telemetry use) belongs to exactly one:
 *  - text:     writes a string or placeholder; holds no portal.
 *  - live:     a portal (React) or DOM renderer mounted and updating.
 *  - snapshot: the last rendered content kept without a live update (frozen portal).
 *  - checkbox: the row-selection checkbox.
 */
export type CellRenderState = 'text' | 'live' | 'snapshot' | 'checkbox';

const RENDER_STATE: Record<CellCtrlPresentationState['kind'], CellRenderState> = {
	buffered: 'text',
	primitive: 'text',
	loading: 'text',
	'stand-in': 'text',
	'live-renderer': 'live',
	'dom-update': 'live',
	'frozen-portal': 'snapshot',
	'checkbox-selector': 'checkbox',
};

export function getCellRenderState(kind: CellCtrlPresentationState['kind']): CellRenderState {
	return RENDER_STATE[kind];
}

/** The portal key the next presentation keeps mounted in this cell, if any. */
function portalKeptBy(presentation: CellCtrlPresentationState): string | undefined {
	switch (presentation.kind) {
		case 'live-renderer':
		case 'dom-update':
		case 'frozen-portal':
			return presentation.portalKey;
		case 'buffered':
			// Off-screen buffered cells may preserve an already-rendered portal as-is.
			return presentation.contentMode === 'portal' ? presentation.portalKey : undefined;
		default:
			return undefined;
	}
}

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
	if (heldPortalKey && portalKeptBy(nextPresentation) !== heldPortalKey) {
		getCellRendererLifecycle(deps).release({ reason: 'invalidated', cellElement: cellSlot.element, portalKey: heldPortalKey });
		// Scroll binds never reassign the handle; a stale one would re-request this release later.
		if (existing instanceof PortalRendererHandle) cellSlot.renderer = null;
	}

	switch (RENDER_STATE[nextPresentation.kind]) {
		case 'text':
			return applyTextCellPresentation(input);
		case 'live':
			return applyLiveCellPresentation(input);
		case 'snapshot':
			return applySnapshotCellPresentation(input);
		case 'checkbox':
			return applyCheckboxCellPresentation(input);
	}
}
