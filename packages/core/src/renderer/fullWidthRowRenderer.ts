import type { VisualRow } from '../visualRow.js';
import type { RowSlot } from './rowSlot.js';
import { isVisualRowEqual, type PortalMountManager } from './portalMountManager.js';
import { getDefaultRowRenderer } from './defaultRowRenderers.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { GridApi } from '../api/GridApiSurfaces.js';
import type {
	DomGroupRenderer,
	DomRowRenderer,
	GroupRenderContext,
	GroupRendererSpec,
	RowRendererParams,
	RowRendererSpec,
} from '../rows/hierarchyConfig.js';
import { createGroupRenderContext, resolveFullWidthGroupModel } from './groupRenderContext.js';

type AnyDomRenderer<TRowData> = DomRowRenderer<TRowData> | DomGroupRenderer<TRowData>;
interface AnyDomHandle {
	update?(arg: never): void;
	destroy?(): void;
}

function isGroupRow(row: VisualRow<unknown>): boolean {
	return row.kind === 'group' || row.kind === 'total';
}

interface DomRowMount<TRowData> {
	rowKey: string;
	renderer: AnyDomRenderer<TRowData>;
	handle: AnyDomHandle;
	row: VisualRow<TRowData>;
	/** Group rows: drawn as the stuck copy of a sticky header. */
	isStuck: boolean;
}

/**
 * Full-width row renderer.
 *
 * Owns full-width row host management for group, detail, footer, and loading full-width
 * rows. RowSlot delegates to this when the row kind is not 'data'.
 *
 * Responsibilities:
 *  - Manage the row portal host inside the slot element.
 *  - Mount / update the row portal via PortalMountManager.
 *  - Release the row portal when the slot rebinds or is destroyed.
 *  - Support mode transitions: cells → full-width and full-width → cells without
 *    replacing the row shell DOM element.
 */
export class FullWidthRowRenderer<TRowData = unknown> {
	private readonly portalMountManager: PortalMountManager<TRowData>;
	private readonly rowPortalHosts: WeakMap<HTMLElement, HTMLElement>;
	private readonly engine: GridEngine<TRowData> | null;
	/** DOM row renderers core mounted itself, by row host. */
	private readonly domRows = new Map<HTMLElement, DomRowMount<TRowData>>();

	constructor(portalMountManager: PortalMountManager<TRowData>, rowPortalHosts: WeakMap<HTMLElement, HTMLElement>, engine?: GridEngine<TRowData>) {
		this.portalMountManager = portalMountManager;
		this.rowPortalHosts = rowPortalHosts;
		this.engine = engine ?? null;
	}

	/** The configured renderer for a full-width row: `detail.renderer`, or `grouping.rowRenderer` for group / total rows. */
	private resolveSpec(row: VisualRow<TRowData>): RowRendererSpec<TRowData> | GroupRendererSpec<TRowData> | undefined {
		const state = this.engine?.stateManager.getState();
		if (row.kind === 'detail') return state?.detail?.renderer;
		if (row.kind === 'group' || row.kind === 'total') return state?.grouping?.rowRenderer;
		return undefined;
	}

	/**
	 * Bind a slot to a full-width visual row (group / detail / footer / loading-fw).
	 * Collapses all cell lanes to zero (releasing any cell portals via the provided
	 * release callbacks), then mounts the row portal.
	 *
	 * The row shell DOM element (slot.element) is NOT replaced — only the content changes.
	 */
	public bind(
		slot: RowSlot<TRowData>,
		visualRow: VisualRow<TRowData>,
		onCollapseLanes: (slot: RowSlot<TRowData>) => void,
		onReleaseRowPortal: (slot: RowSlot<TRowData>) => void
	): void {
		// Collapse all lanes — any previously mounted cell portals are released by the caller.
		onCollapseLanes(slot);

		const rowKey = visualRow.id;
		if (slot.lastPortalRowKey !== rowKey) {
			// A DOM renderer that can `update` is retargeted to the new row in place (see bindDomRow).
			if (!this.canRetarget(this.rowPortalHosts.get(slot.element), visualRow)) onReleaseRowPortal(slot);
			slot.lastPortalRowKey = rowKey;
			slot.element.dataset.rowKey = rowKey;
		}

		const host = this.ensureRowPortalHost(slot.element);
		host.hidden = false;
		host.dataset.rowKey = rowKey;
		this.mountContent(host, rowKey, visualRow);
	}

	/** Draws a full-width row into `host`: a DOM row renderer in place, else through the adapter. */
	public mountContent(host: HTMLElement, rowKey: string, visualRow: VisualRow<TRowData>, isStuck = false): void {
		this.syncAutoHeight(host, visualRow);
		const spec = this.resolveSpec(visualRow);
		const domRenderer = this.resolveDomRenderer(spec, visualRow);
		if (domRenderer) {
			this.bindDomRow(host, rowKey, visualRow, domRenderer, isStuck);
			return;
		}
		this.destroyDomRow(host);
		const context = isGroupRow(visualRow) ? this.createGroupContext(visualRow, isStuck) : null;
		this.portalMountManager.mountRow({
			rowKey,
			container: host,
			visualRow,
			...(spec ? { renderer: spec } : {}),
			...(context ? { context } : {}),
		});
	}

	// A DOM spec, else the adapter when it draws this row (a React spec, or its own renderer for
	// the kind), else core's built-in renderer: adapters carry no hierarchy logic of their own.
	private resolveDomRenderer(
		spec: RowRendererSpec<TRowData> | GroupRendererSpec<TRowData> | undefined,
		visualRow: VisualRow<TRowData>
	): AnyDomRenderer<TRowData> | undefined {
		if (spec?.kind === 'dom') return spec.renderer;
		return spec?.kind === 'react' || this.portalMountManager.adapterRendersRow(visualRow) ? undefined : getDefaultRowRenderer(visualRow);
	}

	/** True when `host` holds a DOM row whose renderer can take `row` through `update` instead of a remount. */
	private canRetarget(host: HTMLElement | undefined, row: VisualRow<TRowData>): boolean {
		const existing = host && this.domRows.get(host);
		if (!existing || !existing.handle.update) return false;
		return existing.renderer === this.resolveDomRenderer(this.resolveSpec(row), row);
	}

	/** Releases what `mountContent` drew into `host`. */
	public releaseContent(host: HTMLElement, rowKey: string): void {
		this.stopAutoHeight(host);
		if (this.domRows.has(host)) this.destroyDomRow(host);
		else this.portalMountManager.releaseRow({ rowKey, container: host });
	}

	/**
	 * DOM row renderers are mounted here, synchronously: no adapter, no scroll deferral. The same row
	 * drawn again with changed content, or a recycled host handed another row, gets `update` when the
	 * renderer has one; otherwise (or for a different renderer) it remounts.
	 */
	private bindDomRow(host: HTMLElement, rowKey: string, row: VisualRow<TRowData>, renderer: AnyDomRenderer<TRowData>, isStuck: boolean): void {
		const existing = this.domRows.get(host);
		if (existing && existing.renderer === renderer && (existing.rowKey === rowKey || existing.handle.update)) {
			if (existing.rowKey !== rowKey || existing.isStuck !== isStuck || !isVisualRowEqual(existing.row, row)) {
				existing.rowKey = rowKey;
				existing.row = row;
				existing.isStuck = isStuck;
				const arg = this.createRendererArg(row, isStuck);
				if (arg) existing.handle.update?.(arg as never);
			}
			return;
		}
		this.destroyDomRow(host);
		host.textContent = '';
		const arg = this.createRendererArg(row, isStuck);
		if (!arg) return;
		const handle = (renderer as { mount(container: HTMLElement, arg: unknown): AnyDomHandle | void }).mount(host, arg) ?? {};
		this.domRows.set(host, { rowKey, renderer, handle, row, isStuck });
	}

	private destroyDomRow(host: HTMLElement): void {
		const mounted = this.domRows.get(host);
		if (!mounted) return;
		this.domRows.delete(host);
		try {
			mounted.handle.destroy?.();
		} finally {
			host.textContent = '';
		}
	}

	// ── detail.height: 'auto' ─────────────────────────────────────────────────

	private autoHeightObserver: ResizeObserver | null = null;
	private readonly autoHeightHosts = new Set<HTMLElement>();

	/**
	 * An auto-height detail row's host sizes to its content; one ResizeObserver reports every host
	 * that changed in one delivery, which lands as one batched row-height commit (the auto row-height
	 * path, with its scroll anchoring) keyed by the detail row's visual id.
	 */
	private syncAutoHeight(host: HTMLElement, row: VisualRow<TRowData>): void {
		const detail = this.engine?.stateManager.getState().detail;
		const auto = row.kind === 'detail' && detail?.height === 'auto';
		if (!auto) {
			this.stopAutoHeight(host);
			return;
		}
		if (this.autoHeightHosts.has(host) || typeof ResizeObserver === 'undefined') return;
		host.classList.add('og-row-portal-host-auto');
		this.autoHeightHosts.add(host);
		this.autoHeightObserver ??= new ResizeObserver((entries) => this.onAutoHeightResize(entries));
		this.autoHeightObserver.observe(host);
	}

	private stopAutoHeight(host: HTMLElement): void {
		if (!this.autoHeightHosts.delete(host)) return;
		host.classList.remove('og-row-portal-host-auto');
		this.autoHeightObserver?.unobserve(host);
	}

	private onAutoHeightResize(entries: ResizeObserverEntry[]): void {
		const engine = this.engine;
		if (!engine) return;
		const heights = new Map<string, number>();
		for (const entry of entries) {
			const host = entry.target as HTMLElement;
			const rowKey = host.dataset.rowKey;
			const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? host.offsetHeight);
			if (rowKey && height > 0) heights.set(rowKey, height);
		}
		const estimate = engine.stateManager.getState().detail?.estimatedHeight ?? 200;
		engine.applyAutoRowHeightBatch(heights, () => estimate);
	}

	/** Group and total rows get a `GroupRenderContext`; every other full-width row `RowRendererParams`. */
	private createRendererArg(row: VisualRow<TRowData>, isStuck: boolean): RowRendererParams<TRowData> | GroupRenderContext<TRowData> | null {
		return isGroupRow(row) ? this.createGroupContext(row, isStuck) : this.createParams(row);
	}

	private createGroupContext(row: VisualRow<TRowData>, isStuck: boolean): GroupRenderContext<TRowData> | null {
		const engine = this.engine;
		if (!engine) return null;
		const api = engine.getApiRef() as GridApi<TRowData>;
		const model = resolveFullWidthGroupModel(api, row);
		return model ? createGroupRenderContext(api, row, model, isStuck) : null;
	}

	private createParams(row: VisualRow<TRowData>): RowRendererParams<TRowData> {
		const engine = this.engine;
		const masterData =
			row.kind === 'detail'
				? (engine?.getRowModel()?.getRowNodeById(row.parentRowId ?? row.parentId)?.data as TRowData | undefined)
				: undefined;
		return { row, masterData, api: engine?.getApiRef() as RowRendererParams<TRowData>['api'] };
	}

	/**
	 * Release the row portal for a slot transitioning away from full-width mode.
	 * Hides and removes the portal host from the slot element.
	 */
	public release(slot: RowSlot<TRowData>): boolean {
		const rowKey = slot.lastPortalRowKey;
		if (!rowKey) return false;
		const host = this.rowPortalHosts.get(slot.element);
		if (!host) {
			slot.lastPortalRowKey = undefined;
			delete slot.element.dataset.rowKey;
			return false;
		}
		this.releaseContent(host, rowKey);
		host.hidden = true;
		delete host.dataset.rowKey;
		host.remove();
		slot.lastPortalRowKey = undefined;
		delete slot.element.dataset.rowKey;
		return true;
	}

	// ── Internal ─────────────────────────────────────────────────────────────────

	private ensureRowPortalHost(row: HTMLElement): HTMLElement {
		let host = this.rowPortalHosts.get(row);
		if (!host) {
			host = document.createElement('div');
			host.className = 'og-row-portal-host';
			host.hidden = true;
			row.appendChild(host);
			this.rowPortalHosts.set(row, host);
		} else if (host.parentElement !== row) {
			row.appendChild(host);
		}
		return host;
	}
}
