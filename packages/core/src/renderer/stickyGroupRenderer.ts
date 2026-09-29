import type { GridEngine } from '../engine/GridEngine.js';
import type { VisualRow } from '../visualRow.js';
import { snapToDevicePixel, type GridLayoutPlan } from './layoutPlan.js';
import type { PortalMountManager } from './portalMountManager.js';

const STICKY_ROW_KEY_PREFIX = 'sticky-group:';

interface StickyGroupHost {
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
}

export class StickyGroupRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private layer: HTMLDivElement | null = null;
	private readonly hosts = new Map<string, StickyGroupHost>();
	private readonly nextKeysScratch = new Set<string>();
	private lastLayerWidth = -1;
	private lastLayerTop = Number.NaN;

	constructor(engine: GridEngine<TRowData>, portalMountManager: PortalMountManager<TRowData>) {
		this.engine = engine;
		this.portalMountManager = portalMountManager;
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
			layer.style.transform = `translate3d(0, ${plan.origins.stickyGroupLayerTop}px, 0)`;
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
			this.portalMountManager.mountRow({ rowKey, container: host.element, visualRow: visualRow as VisualRow<TRowData> });
			this.portalMountManager.flushDeferredRowMount(rowKey);
		}

		this.releaseMissing(nextKeys);
	}

	public unmount(): void {
		this.nextKeysScratch.clear();
		this.releaseMissing(this.nextKeysScratch);
		this.layer = null;
	}

	private ensureHost(rowKey: string): StickyGroupHost {
		const existing = this.hosts.get(rowKey);
		if (existing) return existing;
		const element = document.createElement('div');
		element.dataset.rowKey = rowKey;
		const host: StickyGroupHost = { element, rowKey, rowIndex: -1, rowId: '', className: '', width: -1, height: -1, top: Number.NaN, zIndex: -1 };
		this.hosts.set(rowKey, host);
		this.layer?.appendChild(element);
		return host;
	}

	private releaseMissing(nextKeys: ReadonlySet<string>): void {
		for (const [rowKey, host] of this.hosts) {
			if (nextKeys.has(rowKey)) continue;
			this.portalMountManager.releaseRow({ rowKey, container: host.element });
			host.element.remove();
			this.hosts.delete(rowKey);
		}
	}

	private getHostClassName(depth: number, pushed: boolean): string {
		let className = `og-sticky-group-row-host og-row og-row-group og-row-group-sticky og-row-group-sticky-depth-${Math.min(depth, 4)}`;
		if (pushed) className += ' og-row-group-sticky-pushed';
		return className;
	}
}
