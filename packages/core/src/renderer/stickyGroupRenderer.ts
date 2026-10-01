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
	rowKey: string;
	// Last written presentation — sync() runs every scroll frame, so writes are diffed against these.
	rowIndex: number;
	rowId: string;
	className: string;
	width: number;
	height: number;
	top: number;
	zIndex: number;
	/** Cell-row display: the header is a real row slot with cells in every lane. */
	slot: RowSlot<TRowData> | null;
}

export class StickyGroupRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private layer: HTMLDivElement | null = null;
	private readonly hosts = new Map<string, StickyGroupHost<TRowData>>();
	/** Set by the render engine once the row renderer exists. */
	public cellRowBinder: StickyCellRowBinder<TRowData> | null = null;
	private readonly nextKeysScratch = new Set<string>();
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
		const nextKeys = this.nextKeysScratch;
		nextKeys.clear();
		if (!rowModel || plan.stickyGroups.length === 0) {
			this.releaseMissing(nextKeys);
			return;
		}

		for (const item of plan.stickyGroups) {
			const visualRow = rowModel.getVisualRow(item.visualIndex);
			if (visualRow?.kind !== 'group') continue;
			const rowKey = `${STICKY_ROW_KEY_PREFIX}${visualRow.id}`;
			nextKeys.add(rowKey);
			const host = this.ensureHost(rowKey);
			const top = snapToDevicePixel(item.top - plan.viewport.scrollTop);
			const el = host.element;
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
			const zIndex = 34 + Math.min(item.depth, 8);
			if (host.zIndex !== zIndex) {
				host.zIndex = zIndex;
				el.style.zIndex = String(zIndex);
			}
			const binder = this.cellRowBinder;
			if (binder && this.engine.stateManager.getState().grouping?.display !== 'row') {
				// The same cells as the body's group row: the hierarchy cell in the pinned-left lane,
				// aggregates scrolling horizontally with the content. Written every frame (a handful of
				// cells), never deferred.
				if (host.slot === null) {
					this.fullWidth.releaseContent(host.element, rowKey);
					host.slot = new RowSlot<TRowData>(rowKey, host.element);
				}
				const state = this.engine.stateManager.getState();
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
					state,
				});
			} else {
				this.releaseSlot(host);
				this.fullWidth.mountContent(host.element, rowKey, visualRow as VisualRow<TRowData>);
				this.portalMountManager.flushDeferredRowMount(rowKey);
			}
		}

		this.releaseMissing(nextKeys);
	}

	public unmount(): void {
		this.nextKeysScratch.clear();
		this.releaseMissing(this.nextKeysScratch);
		this.layer = null;
	}

	private ensureHost(rowKey: string): StickyGroupHost<TRowData> {
		const existing = this.hosts.get(rowKey);
		if (existing) return existing;
		const element = document.createElement('div');
		element.dataset.rowKey = rowKey;
		const host: StickyGroupHost<TRowData> = {
			element,
			rowKey,
			rowIndex: -1,
			rowId: '',
			className: '',
			width: -1,
			height: -1,
			top: Number.NaN,
			zIndex: -1,
			slot: null,
		};
		this.hosts.set(rowKey, host);
		this.layer?.appendChild(element);
		return host;
	}

	private releaseMissing(nextKeys: ReadonlySet<string>): void {
		for (const [rowKey, host] of this.hosts) {
			if (nextKeys.has(rowKey)) continue;
			this.releaseSlot(host);
			this.fullWidth.releaseContent(host.element, rowKey);
			host.element.remove();
			this.hosts.delete(rowKey);
		}
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
