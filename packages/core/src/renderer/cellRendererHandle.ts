/**
 * Plan 118 WS2 — Unified renderer lifecycle abstraction.
 *
 * A CellRendererHandle is stored directly on a CellSlot. It identifies which
 * renderer type is currently active and carries the minimum identity state needed
 * to detect renderer-type changes and decide whether a structural mount/destroy is
 * required vs a plain data refresh.
 *
 * Each handle delegates actual rendering to the existing infrastructure
 * (portalMountManager, domCellRendererManager, contentElement.textContent).
 * The handle layer gives the CellSlot a single owned reference to its active
 * renderer without restructuring the underlying render managers.
 */

export type CellLane = 'left' | 'center' | 'right';

/**
 * Describes where a cell is placed within its row slot.
 * Lane is the pinning axis; left/right are the pixel offsets (right >= 0 means
 * pin-right; otherwise left applies). Width is the column width in px.
 */
export interface CellPlacement {
	readonly lane: CellLane;
	readonly laneIndex: number;
	readonly left: number;
	readonly right: number;
	readonly width: number;
}

/**
 * Unified lifecycle interface for a cell's active renderer.
 *
 * Implementations must be cheap to construct — they are created on each bind
 * when the renderer type changes, and compared by kind/identity to detect
 * structural changes.
 *
 *   destroy() — called when the renderer type changes (e.g. text → portal) or
 *               when the cell is cold-unbound. Implementations should release
 *               any external resources they own. The cell's contentElement and
 *               portalHostElement are cleared by the caller after destroy().
 */
export interface CellRendererHandle<TRowData = unknown> {
	readonly kind: 'text' | 'fallback' | 'portal' | 'loading' | 'custom';
	destroy(): void;
}

/**
 * Handle for primitive text content.
 * Tracks the last formatted value so callers can detect no-op refreshes without
 * touching the DOM.
 */
export class TextRendererHandle<TRowData = unknown> implements CellRendererHandle<TRowData> {
	public readonly kind = 'text' as const;

	constructor(public formattedValue: string) {}

	public destroy(): void {
		// Text content is cleared by CellSlot.releaseCold() — no external resources.
	}
}

/**
 * Handle for fallback/static text content (non-editable columns with formatted fallback).
 */
export class FallbackRendererHandle<TRowData = unknown> implements CellRendererHandle<TRowData> {
	public readonly kind = 'fallback' as const;

	constructor(public formattedValue: string) {}

	public destroy(): void {}
}

/**
 * Handle for React portal content (custom cellRenderers and editors).
 * Tracks the portal key so callers can detect key changes without querying
 * portalMountManager.
 */
export class PortalRendererHandle<TRowData = unknown> implements CellRendererHandle<TRowData> {
	public readonly kind = 'portal' as const;

	constructor(public readonly portalKey: string) {}

	public destroy(): void {
		// Portal release is handled by the caller (releaseCellPortal) before destroy() is
		// called, so no additional cleanup is needed here.
	}
}

/**
 * Handle for row-loading skeleton state.
 * Carries no identity beyond its kind.
 */
export class LoadingRendererHandle<TRowData = unknown> implements CellRendererHandle<TRowData> {
	public readonly kind = 'loading' as const;

	public destroy(): void {}
}

/**
 * Handle for externally-managed custom content (e.g. checkbox selection column).
 * The caller owns all DOM manipulation; this handle is a marker.
 */
export class CustomRendererHandle<TRowData = unknown> implements CellRendererHandle<TRowData> {
	public readonly kind = 'custom' as const;

	public destroy(): void {}
}
