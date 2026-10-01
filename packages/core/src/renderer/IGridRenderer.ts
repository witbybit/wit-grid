import type { CellRendererPhase, ColumnDef } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import type { VisualRow } from '../visualRow.js';

/**
 * Explicit renderer lifecycle operation type.
 * Adapters can use this to distinguish first mount from updates, rebinds, and warm restores.
 *
 *   mount   — first render of this renderer for this slot
 *   update  — same renderer, same slot, different props (value/focus/selection changed)
 *   rebind  — same renderer key, but slot was recycled to a new row; props entirely new
 *   restore — renderer was warm (scrolled out) and is being scrolled back into view
 *   unmount — renderer is leaving the viewport (not destroyed, may warm-cache)
 *   destroy — renderer is being permanently destroyed and removed
 */
export type RendererLifecycleOperation = 'mount' | 'update' | 'rebind' | 'restore' | 'unmount' | 'destroy';

/**
 * Physical slot identity for a mounted cell renderer.
 * `generation` increments each time the physical slot is rebound to a
 * different visual row, allowing consumers to detect stale async work.
 * `lane` and `laneIndex` locate the slot within the virtualised column lanes.
 */
export interface CellMountIdentity {
	slotId: string;
	generation: number;
	columnId: string;
	lane: 'left' | 'center' | 'right';
	laneIndex: number;
}

/** Logical row/column identity, independent of the physical slot binding. */
export interface CellPayloadIdentity {
	rowId: string;
	columnId: string;
}

export interface GridCellContentMount<TRowData = unknown> {
	cellKey: string;
	container: HTMLElement;
	value: unknown;
	/**
	 * The formatted string produced by the column's `valueFormatter`, or `String(value)` if none is set.
	 * Custom React cell renderers can display this instead of formatting the raw value themselves.
	 * Undefined when the mount is triggered by internal re-mount paths that don't have access to the value.
	 */
	formattedValue?: string;
	node: RowNode<TRowData>;
	col: ColumnDef<TRowData>;
	rowIndex?: number;
	colIndex?: number;
	/** Stable physical slot ID — bypasses the stale activeRows resolver during the binding loop. */
	rowSlotId: string;
	/** Generation counter from the physical slot — incremented on each row rebind. Required for stale-mount detection. */
	slotGeneration: number;
	/**
	 * Per-cell row-binding generation (from CellSlot.rowBindingGeneration).
	 * Increments on each unbindHot() of this specific cell — more granular than slotGeneration
	 * (which is shared by all cells in a row slot). Optional for back-compat with call sites
	 * that do not have access to the CellSlot directly.
	 */
	cellRowBindingGeneration?: number;
	/**
	 * Stable identity of the physical CellSlot that owns this portal host (CellSlot.cellInstanceId).
	 * When present, PortalMountManager uses this to reject mounts/releases from a different
	 * CellSlot instance that happens to share the same rowSlotId and generation.
	 */
	cellInstanceId?: string;
	/** Stable host-element identifier matching CellSlot.portalHostId. */
	portalHostId?: string;
	isEditing: boolean;
	isLoading: boolean;
	phase?: CellRendererPhase;
	isScrolling?: boolean;
	isFocused?: boolean;
	isSelected?: boolean;
	/** Explicit lifecycle operation so adapters skip reconciliation when not needed. */
	lifecycleOperation?: RendererLifecycleOperation;
}

export interface GridCellContentUnmount {
	cellKey: string;
	container?: HTMLElement;
	flushSync?: boolean;
	reason?: 'scrolled-out' | 'destroyed' | 'edited' | 'invalidated';
	rowSlotId: string;
	/** Generation at the time this release was requested — used to reject stale releases. */
	slotGeneration: number;
	/**
	 * Per-cell row-binding generation at the time the release was requested.
	 * When provided, flushDeferred rejects the release if the active identity has
	 * a newer generation (the cell was rebound before the deferred release flushed).
	 */
	cellRowBindingGeneration?: number;
	/** Physical CellSlot identity at the time this release was requested. */
	cellInstanceId?: string;
	/** Stable portal host ID at the time this release was requested. */
	portalHostId?: string;
}

export interface GridCellContentFlush {
	flushSync?: boolean;
}

export interface GridRowContentMount<TRowData = unknown> {
	rowKey: string;
	container: HTMLElement;
	visualRow: VisualRow<TRowData>;
	/** The configured renderer for this row (`detail.renderer` / `grouping.rowRenderer`), when not a DOM one core mounts itself. */
	renderer?: import('../rows/hierarchyConfig.js').RowRendererSpec<TRowData>;
}

export interface GridRowContentUnmount {
	rowKey: string;
	container?: HTMLElement;
}

/**
 * Contract for the component that owns physical grid rendering.
 */
export interface IGridRenderer<TRowData = unknown> {
	/**
	 * Mounts the physical representation of the grid into a host container.
	 */
	mount(container: HTMLElement): void;

	/**
	 * Unmounts the grid and cleans up all rendering resources.
	 */
	unmount(): void;

	/**
	 * Requests an asynchronous paint during the next animation frame.
	 */
	schedulePaint(): void;

	scheduleFullPaint(reason?: string): void;
	scheduleViewportPaint(reason?: string): void;
	scheduleHeaderPaint(reason?: string): void;
	scheduleOverlayPaint(reason?: string): void;
	scheduleCellPaint(rowId: string, colId: string, reason?: string): void;
	scheduleRowPaint(rowId: string, reason?: string): void;
	scheduleColumnPaint(colId: string, reason?: string): void;
	scheduleGeometryPaint(reason?: string): void;

	/**
	 * Requests a synchronous, immediate full paint of the grid viewport.
	 */
	fullPaint(): void;

	/**
	 * Optional hook for framework adapters to mount custom cell content.
	 */
	onMountCellContent?: (mount: GridCellContentMount<TRowData>) => void;

	/**
	 * Optional hook for framework adapters to unmount custom cell content.
	 */
	onUnmountCellContent?: (unmount: GridCellContentUnmount) => void;

	/**
	 * Optional hook for framework adapters to mount custom row content.
	 */
	onMountRowContent?: (mount: GridRowContentMount<TRowData>) => void;

	/**
	 * Optional hook for framework adapters to unmount custom row content.
	 */
	onUnmountRowContent?: (unmount: GridRowContentUnmount) => void;

	/**
	 * Optional hook for framework adapters to mount custom header menu popovers.
	 */
	onMountHeaderMenu?: (mount: GridHeaderMenuMount<TRowData>) => void;

	/**
	 * Optional hook for framework adapters to unmount custom header menu popovers.
	 */
	onUnmountHeaderMenu?: (unmount: GridHeaderMenuUnmount) => void;
}

export interface GridHeaderMenuMount<TRowData = unknown> {
	colField: string;
	container: HTMLElement;
	column: ColumnDef<TRowData>;
	close: () => void;
}

export interface GridHeaderMenuUnmount {
	colField: string;
	container?: HTMLElement;
}
