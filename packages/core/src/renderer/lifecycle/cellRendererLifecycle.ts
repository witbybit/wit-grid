import type { ColumnDef } from '../../columnDef.js';
import type { RowNode } from '../../rowNode.js';
import type { CellCtrl, ControllerWorkToken } from '../controllers/CellCtrl.js';
import { isControllerWorkStillValid } from '../controllers/CellCtrl.js';
import type { RowCellBinderDeps } from '../rowCellBinder.js';
import type { CellSlot } from '../cellSlot.js';

export type RendererMountReason = 'scroll-live' | 'scroll-force-live' | 'full-bind';
export type RendererUpdateReason = 'scroll-live' | 'full-bind' | 'fidelity';
export type RendererReleaseReason = 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated';
export type HtmlCaptureReason = 'freeze' | 'full-bind';

export interface CellRendererLifecycle<TRowData = unknown> {
	mountLive(input: {
		cellCtrl: CellCtrl;
		host: HTMLElement;
		reason: RendererMountReason;
		token: ControllerWorkToken;
		mount: {
			cellKey: string;
			value: unknown;
			node: RowNode<TRowData>;
			col: ColumnDef<TRowData>;
			rowIndex: number;
			colIndex: number;
			rowSlotId: string;
			slotGeneration: number;
			cellRowBindingGeneration: number;
			cellInstanceId: string;
			portalHostId: string;
			isEditing: boolean;
			isLoading: boolean;
			isFocused: boolean;
			isSelected: boolean;
		};
	}): void;
	updateLive(input: {
		cellCtrl: CellCtrl;
		host: HTMLElement;
		reason: RendererUpdateReason;
		token: ControllerWorkToken;
		mount: {
			cellKey: string;
			value: unknown;
			node: RowNode<TRowData>;
			col: ColumnDef<TRowData>;
			rowIndex: number;
			colIndex: number;
			rowSlotId: string;
			slotGeneration: number;
			cellRowBindingGeneration: number;
			cellInstanceId: string;
			portalHostId: string;
			isEditing: boolean;
			isLoading: boolean;
			isFocused: boolean;
			isSelected: boolean;
		};
	}): void;
	/** `portalKey` names the portal to release when it differs from the cell's current binding key. */
	release(input: { reason: RendererReleaseReason; cellElement?: HTMLDivElement; portalKey?: string }): void;
	captureHtml(input: {
		cellCtrl: CellCtrl;
		host: HTMLElement;
		reason: HtmlCaptureReason;
		token: ControllerWorkToken;
		/** The host's already-serialized innerHTML, when the caller just read it — avoids a second
		 *  full-subtree serialization. Omitted means read `host.innerHTML` here. */
		html?: string;
		colField: string;
		rowHeight?: number;
		colWidth?: number;
	}): void;
}

export function createCellRendererLifecycle<TRowData>(deps: RowCellBinderDeps<TRowData>): CellRendererLifecycle<TRowData> {
	function phaseForMountReason(reason: RendererMountReason): 'scroll-live' | 'scroll-force-live' | 'initial' {
		return reason === 'full-bind' ? 'initial' : reason;
	}

	function mountImmediately(args: Record<string, unknown>): void {
		const manager = deps.portalMountManager as typeof deps.portalMountManager & {
			mountCellImmediately?: (input: Record<string, unknown>) => void;
			mountCell?: (input: Record<string, unknown>) => void;
		};
		if (manager.mountCellImmediately) manager.mountCellImmediately(args);
		else manager.mountCell?.(args);
	}

	return {
		mountLive({ cellCtrl, host, reason, token, mount }) {
			if (!isControllerWorkStillValid({ token, cellCtrl, attachedSlotInstanceId: cellCtrl.lifecycle.attachedSlotInstanceId })) return;
			mountImmediately({
				cellKey: mount.cellKey,
				container: host,
				value: mount.value,
				node: mount.node,
				col: mount.col,
				rowIndex: mount.rowIndex,
				colIndex: mount.colIndex,
				rowSlotId: mount.rowSlotId,
				slotGeneration: mount.slotGeneration,
				cellRowBindingGeneration: mount.cellRowBindingGeneration,
				cellInstanceId: mount.cellInstanceId,
				portalHostId: mount.portalHostId,
				isEditing: mount.isEditing,
				isLoading: mount.isLoading,
				phase: phaseForMountReason(reason),
				isScrolling: reason !== 'full-bind',
				isFocused: mount.isFocused,
				isSelected: mount.isSelected,
			});
		},
		updateLive({ cellCtrl, host, reason, token, mount }) {
			if (!isControllerWorkStillValid({ token, cellCtrl, attachedSlotInstanceId: cellCtrl.lifecycle.attachedSlotInstanceId })) return;
			mountImmediately({
				cellKey: mount.cellKey,
				container: host,
				value: mount.value,
				node: mount.node,
				col: mount.col,
				rowIndex: mount.rowIndex,
				colIndex: mount.colIndex,
				rowSlotId: mount.rowSlotId,
				slotGeneration: mount.slotGeneration,
				cellRowBindingGeneration: mount.cellRowBindingGeneration,
				cellInstanceId: mount.cellInstanceId,
				portalHostId: mount.portalHostId,
				isEditing: mount.isEditing,
				isLoading: mount.isLoading,
				phase: reason === 'fidelity' ? 'scroll-idle' : 'scroll-live',
				isScrolling: reason !== 'full-bind',
				isFocused: mount.isFocused,
				isSelected: mount.isSelected,
			});
		},
		release({ reason, cellElement, portalKey }) {
			if (cellElement) deps.releaseCellPortal(cellElement, false, reason, portalKey);
		},
		captureHtml({ cellCtrl, host, token, colField, rowHeight, colWidth, html: serializedHtml }) {
			if (!isControllerWorkStillValid({ token, cellCtrl, attachedSlotInstanceId: cellCtrl.lifecycle.attachedSlotInstanceId })) return;
			const html = serializedHtml ?? host.innerHTML;

			if (!html) return;
			if (deps.engine.htmlScrollSnapshots.createSnapshot) {
				deps.engine.htmlScrollSnapshots.set(
					deps.engine.htmlScrollSnapshots.createSnapshot({
						rowId: cellCtrl.rowId,
						columnInstanceId: cellCtrl.columnInstanceId,
						colField,
						html,
						freshness: token.freshness,
						rowHeight,
						colWidth,
					})
				);
			} else {
				deps.engine.htmlScrollSnapshots.set(cellCtrl.rowId, cellCtrl.columnInstanceId, html, token.freshness, rowHeight, colWidth);
			}
		},
	};
}
