import type { GridEngine } from '../engine/GridEngine.js';
import type { VisualRow } from '../visualRow.js';
import type { CompiledColumnTopology } from './columnTopology.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import type { PortalMountManager } from './portalMountManager.js';
import { RowSlot } from './rowSlot.js';
import { FullWidthRowRenderer } from './fullWidthRowRenderer.js';
import type { BindAllHierarchyRowCellsRequest } from './rowCellBindingLanes.js';
import { resolveStickyHeaders } from '../rows/hierarchyConfig.js';
import type { StickySection } from './renderWindow.js';

/** Binds sticky headers through the body's cell-row path (see RowRenderer.detachedRowBinder). */
export interface StickyCellRowBinder<TRowData> {
	bind(request: BindAllHierarchyRowCellsRequest<TRowData>): void;
	release(slot: RowSlot<TRowData>): void;
}

const STICKY_ROW_KEY_PREFIX = 'sticky-group:';

interface StickySectionHost<TRowData> {
	/** The group's whole extent in content coordinates (`og-sticky-section`, scrolls with the rows). */
	section: HTMLDivElement;
	/** The header copy: `position: sticky` inside the section, so the browser sticks and pushes it. */
	header: HTMLDivElement;
	groupId: string;
	/** The header is stuck (scroll-derived; what the stuck class and `GroupRenderContext.isStuck` follow). */
	stuck: boolean;
	/** Marks the host as used by the current sync pass. */
	seen: number;
	/** The header's cells / content must be (re)written on this sync. */
	needsBind: boolean;
	// Last written presentation — sync() runs every scroll frame, so writes are diffed against these.
	rowKey: string;
	rowIndex: number;
	rowId: string;
	className: string;
	zIndex: number;
	headerWidth: number;
	headerHeight: number;
	stickyTop: number;
	sectionTop: number;
	sectionHeight: number;
	sectionWidth: number;
	/** Cell-row display: the header is a real row slot with cells in every lane. */
	slot: RowSlot<TRowData> | null;
	/** `display: 'row'`: the pinned `og-row-portal-host` wrapper the full-width content is drawn into. */
	content: HTMLDivElement | null;
}

/**
 * Sticky group headers as native CSS sticky: one section per expanded group overlapping the rendered
 * rows, positioned in the rows container's content space and holding a `position: sticky` header
 * copy. The browser sticks the header, pushes it up where its section ends and releases it, all on
 * the compositor; this renderer only runs when membership, geometry or bound data changes, and
 * writes the one stuck class when a header flips (a class write, never a position write).
 */
export class StickyGroupRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private container: HTMLDivElement | null = null;
	private readonly active = new Map<string, StickySectionHost<TRowData>>();
	private readonly free: StickySectionHost<TRowData>[] = [];
	/** Set by the render engine once the row renderer exists. */
	public cellRowBinder: StickyCellRowBinder<TRowData> | null = null;
	private pass = 0;

	// What the headers' cells were last bound against; a change in any of it rebinds them all.
	private boundState: unknown = null;
	private boundTopology: CompiledColumnTopology | null = null;
	private boundColStart = -1;
	private boundColEnd = -1;
	private boundClientWidth = -1;
	private boundRowModelVersion = -1;
	private boundColumnVersion = -1;
	private dirty = true;

	/** `display: 'row'` headers: the same full-width content path as body rows (DOM specs included). */
	private readonly fullWidth: FullWidthRowRenderer<TRowData>;

	constructor(engine: GridEngine<TRowData>, portalMountManager: PortalMountManager<TRowData>) {
		this.engine = engine;
		this.portalMountManager = portalMountManager;
		this.fullWidth = new FullWidthRowRenderer<TRowData>(portalMountManager, new WeakMap(), engine);
	}

	/** `container` is the rows container: sections live in content coordinates and scroll with the rows. */
	public mount(container: HTMLDivElement): void {
		this.container = container;
		this.dirty = true;
	}

	/** Bound data changed outside a scroll (cell, row or selection repaint): rewrite the headers on the next sync. */
	public refresh(plan: GridLayoutPlan): void {
		this.dirty = true;
		this.sync(plan);
	}

	public sync(plan: GridLayoutPlan): void {
		const container = this.container;
		if (!container) return;

		const state = this.engine.stateManager.getState();
		const resolved = resolveStickyHeaders(state.grouping?.stickyHeaders);
		const sections = plan.stickySections;
		const rowModel = this.engine.getRowModel();
		const window = plan.renderWindow;

		let rebind = this.dirty;
		if (
			this.boundState !== state ||
			this.boundTopology !== plan.columnTopology ||
			this.boundColStart !== plan.columns.colStart ||
			this.boundColEnd !== plan.columns.colEnd ||
			this.boundClientWidth !== plan.viewport.clientWidth ||
			this.boundRowModelVersion !== (window.rowModelVersion ?? 0) ||
			this.boundColumnVersion !== (window.columnVersion ?? 0)
		) {
			rebind = true;
		}
		if (rebind) {
			this.dirty = false;
			this.boundState = state;
			this.boundTopology = plan.columnTopology;
			this.boundColStart = plan.columns.colStart;
			this.boundColEnd = plan.columns.colEnd;
			this.boundClientWidth = plan.viewport.clientWidth;
			this.boundRowModelVersion = window.rowModelVersion ?? 0;
			this.boundColumnVersion = window.columnVersion ?? 0;
		}

		const pass = ++this.pass;
		const scrollTop = plan.viewport.scrollTop;
		const layerTop = plan.origins.stickyGroupLayerTop;
		let used = 0;
		if (rowModel && resolved) {
			for (let i = 0; i < sections.length; i++) {
				const item = sections[i];
				const visualRow = rowModel.getVisualRow(item.visualIndex);
				if (visualRow?.kind !== 'group') continue;
				let host = this.active.get(item.groupId);
				if (!host) {
					host = this.acquireHost(item.groupId);
					this.active.set(item.groupId, host);
					container.appendChild(host.section);
				}
				host.seen = pass;
				used++;
				if (rebind) host.needsBind = true;
				this.syncHost(host, item, visualRow as VisualRow<TRowData>, plan, scrollTop, layerTop, resolved.shadow);
			}
		}
		if (this.active.size !== used) this.releaseUnseen(pass);
	}

	public unmount(): void {
		for (const host of this.active.values()) {
			this.releaseHost(host);
			host.section.remove();
		}
		this.active.clear();
		for (const host of this.free) host.section.remove();
		this.free.length = 0;
		this.container = null;
	}

	private syncHost(
		host: StickySectionHost<TRowData>,
		item: StickySection,
		visualRow: VisualRow<TRowData>,
		plan: GridLayoutPlan,
		scrollTop: number,
		layerTop: number,
		shadow: boolean
	): void {
		const section = host.section.style;
		const el = host.header;
		const cellRows = this.cellRowBinder !== null && this.engine.stateManager.getState().grouping?.display !== 'row';
		// Switching to full-width content drops the cell row first: releasing it resets the element.
		if (!cellRows && host.slot) this.releaseSlot(host);
		const width = plan.dimensions.contentWidth;
		if (host.sectionTop !== item.top) {
			host.sectionTop = item.top;
			section.top = `${item.top}px`;
		}
		if (host.sectionHeight !== item.sectionHeight) {
			host.sectionHeight = item.sectionHeight;
			section.height = `${item.sectionHeight}px`;
		}
		if (host.sectionWidth !== width) {
			host.sectionWidth = width;
			section.width = `${width}px`;
		}

		const rowKey = `${STICKY_ROW_KEY_PREFIX}${visualRow.id}`;
		if (host.rowKey !== rowKey) {
			// A different group takes this host: drop the previous group's full-width content now, so
			// nothing of it can show. Cell-row cells are rewritten by the bind below, in this same call.
			if (host.content && host.rowKey) this.fullWidth.releaseContent(host.content, host.rowKey);
			host.rowKey = rowKey;
			el.dataset.rowKey = rowKey;
			host.needsBind = true;
		}
		if (host.rowIndex !== item.visualIndex) {
			host.rowIndex = item.visualIndex;
			el.dataset.rowIndex = String(item.visualIndex);
			host.needsBind = true;
		}
		if (host.rowId !== visualRow.id) {
			host.rowId = visualRow.id;
			el.dataset.rowId = visualRow.id;
		}
		// Stuck: the header's natural top is above where it sticks. Scroll-derived, written only when it flips.
		const stuck = item.top < scrollTop + item.stickyOffset;
		const className = this.getHostClassName(item.depth, shadow, stuck);
		// Custom renderers draw the stuck state themselves (`GroupRenderContext.isStuck`): a flip rebinds the header.
		if (host.stuck !== stuck) {
			host.stuck = stuck;
			if (this.rendersStuckState()) host.needsBind = true;
		}
		if (host.className !== className) {
			host.className = className;
			el.className = className;
		}
		if (host.headerWidth !== width) {
			host.headerWidth = width;
			el.style.width = `${width}px`;
		}
		if (host.headerHeight !== item.height) {
			host.headerHeight = item.height;
			el.style.height = `${item.height}px`;
		}
		const stickyTop = layerTop + item.stickyOffset;
		if (host.stickyTop !== stickyTop) {
			host.stickyTop = stickyTop;
			el.style.top = `${stickyTop}px`;
		}
		// Outer levels stack above inner ones: a header pushed up by the next sibling slides under its
		// parent instead of being drawn over it.
		// Above body rows and their focused/validation cells (z 20), below the pinned row bands (25)
		// and the column header (30), so a pushed-up header slides under them. Outer levels on top.
		const zIndex = 24 - Math.min(item.depth, 3);
		if (host.zIndex !== zIndex) {
			host.zIndex = zIndex;
			el.style.zIndex = String(zIndex);
		}
		if (!host.needsBind) return;
		host.needsBind = false;

		const binder = this.cellRowBinder;
		if (binder && cellRows) {
			// The same cells as the body's group row: the hierarchy cell in the pinned-left lane,
			// aggregates scrolling horizontally with the content. Every cell write carries the row id
			// and index, so a host that changes group is fully rewritten here, in the same call.
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
				isStuck: host.stuck,
			});
		} else {
			el.dataset.rowKey = rowKey;
			// The body's pinned full-width wrapper (`og-row-portal-host`: sticky left, viewport wide), so
			// the content stays put during horizontal scroll exactly like a body full-width row.
			if (!host.content) {
				host.content = document.createElement('div');
				host.content.className = 'og-row-portal-host';
			}
			if (host.content.parentElement !== el) el.appendChild(host.content);
			host.content.dataset.rowKey = rowKey;
			this.fullWidth.mountContent(host.content, rowKey, visualRow, host.stuck);
			this.portalMountManager.flushDeferredRowMount(rowKey);
		}
	}

	/** Whether a configured renderer can draw differently while stuck: only then does a flip cost a rebind. */
	private rendersStuckState(): boolean {
		const state = this.engine.stateManager.getState();
		return state.grouping?.display === 'row' ? !!state.grouping.rowRenderer : !!(state.hierarchyColumn && state.hierarchyColumn.renderer);
	}

	private acquireHost(groupId: string): StickySectionHost<TRowData> {
		const reused = this.free.pop();
		const host = reused ?? this.createHost();
		host.groupId = groupId;
		host.needsBind = true;
		return host;
	}

	private createHost(): StickySectionHost<TRowData> {
		const section = document.createElement('div');
		section.className = 'og-sticky-section';
		// The body row holds the semantics and focus; this copy only repeats it while the row is stuck.
		section.setAttribute('aria-hidden', 'true');
		const header = document.createElement('div');
		section.appendChild(header);
		return {
			section,
			header,
			groupId: '',
			stuck: false,
			seen: 0,
			needsBind: true,
			rowKey: '',
			rowIndex: -1,
			rowId: '',
			className: '',
			zIndex: -1,
			headerWidth: -1,
			headerHeight: -1,
			stickyTop: Number.NaN,
			sectionTop: Number.NaN,
			sectionHeight: -1,
			sectionWidth: -1,
			slot: null,
			content: null,
		};
	}

	/** Hosts whose group left the sticky sections: emptied and detached, kept for reuse. */
	private releaseUnseen(pass: number): void {
		for (const [groupId, host] of this.active) {
			if (host.seen === pass) continue;
			this.active.delete(groupId);
			this.releaseHost(host);
			host.section.remove();
			host.groupId = '';
			this.free.push(host);
		}
	}

	private releaseHost(host: StickySectionHost<TRowData>): void {
		this.releaseSlot(host);
		this.releaseContent(host);
		host.rowKey = '';
		delete host.header.dataset.rowKey;
		delete host.header.dataset.rowId;
		delete host.header.dataset.rowIndex;
		host.rowIndex = -1;
		host.rowId = '';
		host.className = '';
		host.header.className = '';
		// A recycled host is rewritten in full before it is shown again.
		host.sectionTop = Number.NaN;
		host.sectionHeight = -1;
		host.sectionWidth = -1;
		host.section.removeAttribute('style');
		host.headerWidth = -1;
		host.headerHeight = -1;
		host.stickyTop = Number.NaN;
		host.zIndex = -1;
		host.header.removeAttribute('style');
	}

	private releaseContent(host: StickySectionHost<TRowData>): void {
		if (!host.content) return;
		if (host.rowKey) this.fullWidth.releaseContent(host.content, host.rowKey);
		host.content.remove();
		host.content = null;
	}

	private releaseSlot(host: StickySectionHost<TRowData>): void {
		if (!host.slot) return;
		this.cellRowBinder?.release(host.slot);
		host.slot = null;
		// destroyCold resets the element; the host re-applies its presentation on the next sync.
		host.className = '';
		host.headerWidth = -1;
		host.headerHeight = -1;
		host.stickyTop = Number.NaN;
		host.zIndex = -1;
		host.rowIndex = -1;
		host.rowId = '';
		host.needsBind = true;
	}

	private getHostClassName(depth: number, shadow: boolean, stuck: boolean): string {
		let className = `og-sticky-group-row-host og-row og-row-group og-row-group-sticky og-row-group-sticky-depth-${Math.min(depth, 4)}`;
		if (shadow) className += ' og-row-group-sticky-shadow';
		if (stuck) className += ' og-row-group-stuck';
		return className;
	}
}
