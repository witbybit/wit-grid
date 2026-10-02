import type { GridEngine } from '../engine/GridEngine.js';
import type { VisualRow } from '../visualRow.js';
import { snapToDevicePixel, type GridLayoutPlan } from './layoutPlan.js';
import type { PortalMountManager } from './portalMountManager.js';
import { RowSlot } from './rowSlot.js';
import { FullWidthRowRenderer } from './fullWidthRowRenderer.js';
import type { BindAllHierarchyRowCellsRequest } from './rowCellBindingLanes.js';

/** Binds sticky headers through the body's cell-row path (see RowRenderer.bindDetachedHierarchyRow). */
export interface StickyCellRowBinder<TRowData> {
	bind(request: BindAllHierarchyRowCellsRequest<TRowData>): void;
	release(slot: RowSlot<TRowData>): void;
}

const STICKY_ROW_KEY_PREFIX = 'sticky-group:';

interface StickyGroupHost<TRowData> {
	element: HTMLDivElement;
	/** Row key of the group currently bound to this slot ('' = none). */
	rowKey: string;
	// Last written presentation — sync() runs every scroll frame, so writes are diffed against these.
	rowIndex: number;
	rowId: string;
	className: string;
	width: number;
	height: number;
	top: number;
	zIndex: number;
	hidden: boolean;
	/** Cell-row display: the header is a real row slot with cells in every lane. */
	slot: RowSlot<TRowData> | null;
	/** `display: 'row'`: the pinned `og-row-portal-host` wrapper the full-width content is drawn into. */
	content: HTMLDivElement | null;
}

/**
 * One host element per stack depth slot, re-bound to whichever group occupies that slot, so a
 * different group becoming stuck never creates or destroys an element in the scroll frame.
 */
export class StickyGroupRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private layer: HTMLDivElement | null = null;
	private readonly hosts: StickyGroupHost<TRowData>[] = [];
	/** Set by the render engine once the row renderer exists. */
	public cellRowBinder: StickyCellRowBinder<TRowData> | null = null;
	private lastLayerWidth = -1;
	private lastLayerTop = Number.NaN;

	/** `display: 'row'` headers: the same full-width content path as body rows (DOM specs included). */
	private readonly fullWidth: FullWidthRowRenderer<TRowData>;

	constructor(engine: GridEngine<TRowData>, portalMountManager: PortalMountManager<TRowData>) {
		this.engine = engine;
		this.portalMountManager = portalMountManager;
		this.fullWidth = new FullWidthRowRenderer<TRowData>(portalMountManager, new WeakMap(), engine);
	}

	public mount(layer: HTMLDivElement): void {
		this.layer = layer;
		this.lastLayerWidth = -1;
		this.lastLayerTop = Number.NaN;
	}

	public sync(plan: GridLayoutPlan): void {
		const layer = this.layer;
		if (!layer) return;

		if (this.lastLayerWidth !== plan.dimensions.contentWidth) {
			this.lastLayerWidth = plan.dimensions.contentWidth;
			layer.style.width = `${plan.dimensions.contentWidth}px`;
		}
		if (this.lastLayerTop !== plan.origins.stickyGroupLayerTop) {
			this.lastLayerTop = plan.origins.stickyGroupLayerTop;
			layer.style.top = `${plan.origins.stickyGroupLayerTop}px`;
		}

		const rowModel = this.engine.getRowModel();
		let used = 0;
		if (rowModel) {
			for (const item of plan.stickyGroups) {
				const visualRow = rowModel.getVisualRow(item.visualIndex);
				if (visualRow?.kind !== 'group') continue;
				this.syncSlot(this.ensureHost(used), item, visualRow as VisualRow<TRowData>, plan);
				used++;
			}
		}
		this.hideFrom(used);
	}

	public unmount(): void {
		for (const host of this.hosts) {
			this.releaseHost(host);
			host.element.remove();
		}
		this.hosts.length = 0;
		this.layer = null;
	}

	private syncSlot(
		host: StickyGroupHost<TRowData>,
		item: GridLayoutPlan['stickyGroups'][number],
		visualRow: VisualRow<TRowData>,
		plan: GridLayoutPlan
	): void {
		const el = host.element;
		const rowKey = `${STICKY_ROW_KEY_PREFIX}${visualRow.id}`;
		if (host.rowKey !== rowKey) {
			// A different group takes this slot: drop the previous group's full-width content now, so
			// nothing of it can show. Cell-row cells are rewritten by the bind below, in this same call.
			if (host.content && host.rowKey) this.fullWidth.releaseContent(host.content, host.rowKey);
			host.rowKey = rowKey;
			el.dataset.rowKey = rowKey;
		}
		if (host.hidden) {
			host.hidden = false;
			el.style.display = '';
		}
		const top = snapToDevicePixel(item.top - plan.viewport.scrollTop);
		if (host.rowIndex !== item.visualIndex) {
			host.rowIndex = item.visualIndex;
			el.dataset.rowIndex = String(item.visualIndex);
		}
		if (host.rowId !== visualRow.id) {
			host.rowId = visualRow.id;
			el.dataset.rowId = visualRow.id;
		}
		const className = this.getHostClassName(item.depth, item.pushed);
		if (host.className !== className) {
			host.className = className;
			el.className = className;
		}
		if (host.width !== plan.dimensions.contentWidth) {
			host.width = plan.dimensions.contentWidth;
			el.style.width = `${plan.dimensions.contentWidth}px`;
		}
		if (host.height !== item.height) {
			host.height = item.height;
			el.style.height = `${item.height}px`;
		}
		if (host.top !== top) {
			host.top = top;
			el.style.transform = `translate3d(0, ${top}px, 0)`;
		}
		// Outer levels stack above inner ones: a header pushed up by the next sibling slides under its
		// parent instead of being drawn over it.
		const zIndex = 34 + 8 - Math.min(item.depth, 8);
		if (host.zIndex !== zIndex) {
			host.zIndex = zIndex;
			el.style.zIndex = String(zIndex);
		}
		const binder = this.cellRowBinder;
		if (binder && this.engine.stateManager.getState().grouping?.display !== 'row') {
			// The same cells as the body's group row: the hierarchy cell in the pinned-left lane,
			// aggregates scrolling horizontally with the content. Written every frame (a handful of
			// cells), never deferred. Every cell write carries the row id and index, so a slot that
			// changes group is fully rewritten here, in the same call. (Not skipped when nothing
			// changed: the cells depend on scroll columns, topology, focus and selection state, and no
			// single version covers them, so skipping is not provably safe.)
			if (host.slot === null) {
				this.releaseContent(host);
				host.slot = new RowSlot<TRowData>(rowKey, el);
				el.dataset.rowKey = rowKey;
			}
			binder.bind({
				slot: host.slot,
				row: visualRow as Extract<VisualRow<TRowData>, { kind: 'group' }>,
				rowIndex: item.visualIndex,
				centerColStart: plan.columns.colStart,
				centerColCount: Math.max(0, plan.columns.colEnd - plan.columns.colStart + 1),
				columns: this.engine.columns.getDisplayedColumns(),
				plan: this.engine.columns.getCompiledPlan(),
				columnTopology: plan.columnTopology,
				isScrollFrameActive: false,
				state: this.engine.stateManager.getState(),
			});
		} else {
			this.releaseSlot(host);
			el.dataset.rowKey = rowKey;
			// The body's pinned full-width wrapper (`og-row-portal-host`: sticky left, viewport wide), so
			// the content stays put during horizontal scroll exactly like a body full-width row.
			if (!host.content) {
				host.content = document.createElement('div');
				host.content.className = 'og-row-portal-host';
			}
			if (host.content.parentElement !== el) el.appendChild(host.content);
			host.content.dataset.rowKey = rowKey;
			this.fullWidth.mountContent(host.content, rowKey, visualRow);
			this.portalMountManager.flushDeferredRowMount(rowKey);
		}
	}

	private ensureHost(slotIndex: number): StickyGroupHost<TRowData> {
		const existing = this.hosts[slotIndex];
		if (existing) return existing;
		const element = document.createElement('div');
		const host: StickyGroupHost<TRowData> = {
			element,
			rowKey: '',
			rowIndex: -1,
			rowId: '',
			className: '',
			width: -1,
			height: -1,
			top: Number.NaN,
			zIndex: -1,
			hidden: false,
			slot: null,
			content: null,
		};
		this.hosts[slotIndex] = host;
		this.layer?.appendChild(element);
		return host;
	}

	/** Hosts at and beyond the current stack depth: emptied and hidden (kept for reuse), never visible or focusable. */
	private hideFrom(used: number): void {
		for (let i = used; i < this.hosts.length; i++) {
			const host = this.hosts[i];
			if (host.hidden) continue;
			this.releaseHost(host);
			host.hidden = true;
			host.element.style.display = 'none';
		}
	}

	private releaseHost(host: StickyGroupHost<TRowData>): void {
		this.releaseSlot(host);
		this.releaseContent(host);
		host.rowKey = '';
		delete host.element.dataset.rowKey;
		delete host.element.dataset.rowId;
		delete host.element.dataset.rowIndex;
		host.rowIndex = -1;
		host.rowId = '';
	}

	private releaseContent(host: StickyGroupHost<TRowData>): void {
		if (!host.content) return;
		if (host.rowKey) this.fullWidth.releaseContent(host.content, host.rowKey);
		host.content.remove();
		host.content = null;
	}

	private releaseSlot(host: StickyGroupHost<TRowData>): void {
		if (!host.slot) return;
		this.cellRowBinder?.release(host.slot);
		host.slot = null;
		// destroyCold resets the element; the host re-applies its presentation on the next sync.
		host.className = '';
		host.width = -1;
		host.height = -1;
		host.top = Number.NaN;
		host.zIndex = -1;
		host.rowIndex = -1;
		host.rowId = '';
	}

	private getHostClassName(depth: number, pushed: boolean): string {
		let className = `og-sticky-group-row-host og-row og-row-group og-row-group-sticky og-row-group-sticky-depth-${Math.min(depth, 4)}`;
		if (pushed) className += ' og-row-group-sticky-pushed';
		return className;
	}
}
