import type { GridCellFlash, GridPresenceCell, GridPresencePeer, PresenceStore } from '../presence.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { defaultGridScheduler, type GridScheduler } from './gridScheduler.js';

/** What the layer needs to place a cell: the visual row index, row tops and column lefts. */
export interface PresenceGeometry {
	getVisualIndexByRowId(rowId: string): number;
	getVisualRowCount(): number;
	getColumnIndex(field: string): number;
	rowTops: ArrayLike<number>;
	rowHeights: ArrayLike<number>;
	colLefts: ArrayLike<number>;
	colWidths: ArrayLike<number>;
}

type Band = 'rows' | 'top' | 'bottom';

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
	/** Which layer draws it: the rows, or the sticky pinned-top / pinned-bottom band. */
	band: Band;
}

/** Hosts for cursors on pinned rows, which draw above the rows container. */
export interface PresencePinnedHosts {
	top: HTMLElement | null;
	bottom: HTMLElement | null;
}

interface Cursor {
	element: HTMLDivElement;
	tag: HTMLSpanElement;
	key: string;
}

const FLASH_MS = 900;

/**
 * Peers' cell cursors and cell flashes, drawn in the rows container's content coordinates so they
 * scroll natively with the cells; DOM writes happen only when a cursor moves or changes.
 */
export class PresenceLayer {
	private readonly cursors = new Map<string, Cursor>();
	/** Lazily made overlay bands inside the pinned row layers. */
	private readonly bands = new Map<Band, HTMLDivElement>();
	private plan: GridLayoutPlan | null = null;
	private readonly unsubscribe: () => void;

	constructor(
		private readonly store: PresenceStore,
		private readonly geometry: () => PresenceGeometry,
		/** The registry's `presence` layer inside the rows container. */
		private readonly element: HTMLDivElement,
		private readonly pinned: PresencePinnedHosts = { top: null, bottom: null },
		private readonly scheduler: GridScheduler = defaultGridScheduler
	) {
		this.element.setAttribute('aria-hidden', 'true');
		this.unsubscribe = store.subscribe(() => this.render());
	}

	public dispose(): void {
		this.unsubscribe();
		this.element.replaceChildren();
		for (const band of this.bands.values()) band.remove();
		this.bands.clear();
		this.cursors.clear();
	}

	/**
	 * Each layout pass: rows may have moved (sort, filter, resize) or a pinned lane scrolled. With
	 * peers this is a few lookups and a key compare per peer; DOM writes happen only on change.
	 */
	public sync(plan: GridLayoutPlan): void {
		this.plan = plan;
		if (this.store.peers.length === 0 && this.cursors.size === 0) return;
		this.render();
	}

	private render(): void {
		if (!this.plan) return;
		const geometry = this.geometry();
		const seen = new Set<string>();
		for (const peer of this.store.peers) {
			seen.add(peer.id);
			const rect = peer.cell ? this.rectFor(peer.cell, geometry) : null;
			this.drawCursor(peer, rect);
		}
		for (const [id, cursor] of this.cursors) {
			if (seen.has(id)) continue;
			cursor.element.remove();
			this.cursors.delete(id);
		}
		for (const flash of this.store.takeFlashes()) this.drawFlash(flash, geometry);
	}

	private drawCursor(peer: GridPresencePeer, rect: Rect | null): void {
		let cursor = this.cursors.get(peer.id);
		if (!cursor) {
			const element = document.createElement('div');
			element.className = 'og-presence';
			const tag = document.createElement('span');
			tag.className = 'og-presence-tag';
			element.appendChild(tag);
			this.element.appendChild(element);
			cursor = { element, tag, key: '' };
			this.cursors.set(peer.id, cursor);
		}
		const firstRow = rect !== null && rect.band !== 'bottom' && rect.top < 1;
		const key = rect
			? `${rect.band}:${rect.left},${rect.top},${rect.width},${rect.height}|${peer.name}|${peer.color}|${peer.editing ? 1 : 0}|${firstRow ? 1 : 0}`
			: 'hidden';
		if (cursor.key === key) return;
		const wasHidden = cursor.key === '' || cursor.key === 'hidden';
		cursor.key = key;
		const { element, tag } = cursor;
		if (!rect) {
			element.hidden = true;
			return;
		}
		// Moving into or out of a pinned band changes layer (and coordinates): jump, don't glide.
		const host = this.hostFor(rect.band);
		const changedBand = element.parentElement !== host;
		if (changedBand) host.appendChild(element);
		// Appearing (or reappearing) jumps into place; moving between cells glides.
		element.classList.toggle('og-presence-still', wasHidden || changedBand);
		element.hidden = false;
		element.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
		element.style.width = `${rect.width}px`;
		element.style.height = `${rect.height}px`;
		element.style.setProperty('--og-presence-color', peer.color);
		element.toggleAttribute('data-editing', !!peer.editing);
		// A cursor on the first row tags below the cell: above it would sit under the header.
		tag.classList.toggle('og-presence-tag-below', firstRow);
		if (tag.textContent !== peer.name) tag.textContent = peer.name;
		if (wasHidden || changedBand) {
			// Re-enable the glide after this position has been applied.
			this.scheduler.raf(() => element.classList.remove('og-presence-still'));
		}
	}

	private drawFlash(flash: GridCellFlash, geometry: PresenceGeometry): void {
		const rect = this.rectFor(flash, geometry);
		if (!rect) return;
		const element = document.createElement('div');
		element.className = 'og-cell-flash';
		element.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
		element.style.width = `${rect.width}px`;
		element.style.height = `${rect.height}px`;
		if (flash.color) element.style.setProperty('--og-flash-color', flash.color);
		this.hostFor(rect.band).appendChild(element);
		this.scheduler.timeout(() => element.remove(), FLASH_MS);
	}

	private hostFor(band: Band): HTMLElement {
		if (band === 'rows') return this.element;
		let host = this.bands.get(band);
		if (!host) {
			host = document.createElement('div');
			host.className = 'og-presence-band';
			host.setAttribute('aria-hidden', 'true');
			this.bands.set(band, host);
		}
		const parent = band === 'top' ? this.pinned.top : this.pinned.bottom;
		if (parent && host.parentElement !== parent) parent.appendChild(host);
		return host;
	}

	private rectFor(cell: GridPresenceCell, geometry: PresenceGeometry): Rect | null {
		const plan = this.plan;
		if (!plan) return null;
		const rowIndex = geometry.getVisualIndexByRowId(cell.rowId);
		const colIndex = geometry.getColumnIndex(cell.field);
		if (rowIndex < 0 || colIndex < 0) return null;
		// Pinned rows live in sticky layers of their own, with their own coordinates: the top band
		// lays rows out from 0, the bottom band upward from its bottom edge.
		let band: Band = 'rows';
		let top = geometry.rowTops[rowIndex];
		if (rowIndex < plan.rows.pinnedTopCount) {
			if (!this.pinned.top) return null;
			band = 'top';
		} else if (rowIndex >= geometry.getVisualRowCount() - plan.rows.pinnedBottomCount) {
			if (!this.pinned.bottom) return null;
			band = 'bottom';
			top = top - plan.dimensions.totalRowsHeight;
		}
		const height = geometry.rowHeights[rowIndex];
		let left = geometry.colLefts[colIndex];
		const width = geometry.colWidths[colIndex];
		if (top === undefined || left === undefined) return null;
		// Pinned lanes are sticky: their cells sit at a fixed offset from the scrolled edge.
		const { lanes } = plan.columns;
		const { scrollLeft, clientWidth } = plan.viewport;
		if (lanes.left.colStart >= 0 && colIndex >= lanes.left.colStart && colIndex <= lanes.left.colEnd) {
			left = scrollLeft + (left - lanes.left.baseLeft);
		} else if (lanes.right.colStart >= 0 && colIndex >= lanes.right.colStart && colIndex <= lanes.right.colEnd) {
			left = scrollLeft + clientWidth - lanes.right.width + (left - lanes.right.baseLeft);
		}
		return { left, top, width, height, band };
	}
}
