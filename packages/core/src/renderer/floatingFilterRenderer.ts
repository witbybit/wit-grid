/**
 * The floating filter row: under each header, the column's filter editor in its compact form (the
 * same editor the header funnel, menu and sidebar show, from the column's filter definition).
 * Typed values filter inline; lists, trees and ranges show a summary chip opening the full editor.
 */
import type { GridEngine } from '../engine/GridEngine.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { computeGridLayoutPlan } from './layoutPlan.js';
import { GridMetric } from '../diagnostics/GridInstrumentation.js';
import type { ColumnFilter, FilterModel } from '../filterModel.js';
import type { InternalColumnDef } from '../columnDef.js';
import type { DomFilterEditorHandle } from '../filters/filterDef.js';
import type { FilterPopoverController } from './filterPopoverController.js';

interface FloatingFilterView {
	handle: DomFilterEditorHandle | null;
	/** The filter the editor last showed or applied: a different one in the model came from elsewhere. */
	filter: ColumnFilter | null;
}

export class FloatingFilterRenderer<TRowData = unknown> {
	private filterLayer: HTMLDivElement | null = null;
	private filterLeftLayer: HTMLDivElement | null = null;
	private filterRightLayer: HTMLDivElement | null = null;

	// Cell elements keyed by column field (survives reorder)
	private cells = new Map<string, HTMLDivElement>();
	private views = new Map<string, FloatingFilterView>();
	private lastFilterModel: FilterModel | null = null;
	private lastVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1 };
	private lastTopologyVersion = -1;
	private unsubscribers: (() => void)[] = [];

	constructor(
		private readonly engine: GridEngine<TRowData>,
		private readonly filters: FilterPopoverController<TRowData>
	) {}

	public mount(filterLayer: HTMLDivElement, filterLeftLayer: HTMLDivElement, filterRightLayer: HTMLDivElement): void {
		this.filterLayer = filterLayer;
		this.filterLeftLayer = filterLeftLayer;
		this.filterRightLayer = filterRightLayer;
		this.clearCells();
		this.unsubscribers.push(
			this.engine.stateManager.subscribeToKey('filterModel', () => this.repaint()),
			// New column definitions may filter differently: rebuild the editors.
			this.engine.stateManager.subscribeToKey('columns', () => {
				this.clearCells();
				this.repaint();
			})
		);
	}

	public unmount(): void {
		this.unsubscribers.forEach((u) => u());
		this.unsubscribers = [];
		this.clearCells();
		this.filterLayer = null;
		this.filterLeftLayer = null;
		this.filterRightLayer = null;
	}

	public repaint(layoutPlan?: GridLayoutPlan): void {
		this.syncVisibleFilters(true, layoutPlan ?? computeGridLayoutPlan(this.engine));
	}

	public syncScrollLeft(layoutPlan: GridLayoutPlan): void {
		// Pin lanes use position: sticky; editor popovers follow their anchors on their own.
		// Columns scrolled into view get their editors (a no-op while the column window holds).
		this.syncVisibleFilters(false, layoutPlan);
	}

	private syncVisibleFilters(force: boolean, plan: GridLayoutPlan): void {
		if (!this.filterLayer || !this.filterLeftLayer || !this.filterRightLayer) return;
		if (plan.chrome.floatingFilterHeight === 0) return;

		const columnPlan = this.engine.columns.getCompiledPlan();
		const columns = columnPlan.displayedColumns as InternalColumnDef<TRowData>[];
		const colWidths = columnPlan.colWidths;
		const topology = plan.columnTopology;
		const colStart = plan.columns.colStart;
		const colEnd = plan.columns.colEnd;
		const filterModel = this.engine.stateManager.getState().filterModel;

		const rangeKey = `${colStart}:${colEnd}:${plan.columns.pinLeftCount}:${plan.columns.pinRightCount}`;
		const filterChanged = filterModel !== this.lastFilterModel;
		const topologyChanged = topology.version !== this.lastTopologyVersion;
		if (
			!force &&
			rangeKey ===
				`${this.lastVisibleRange.startIdx}:${this.lastVisibleRange.endIdx}:${this.lastVisibleRange.pinLeft}:${this.lastVisibleRange.pinRight}` &&
			!filterChanged &&
			!topologyChanged
		) {
			return;
		}
		this.lastFilterModel = filterModel;
		if (topologyChanged) this.engine.instrumentation.increment(GridMetric.TOPOLOGY_VERSION_CHANGED);
		this.lastTopologyVersion = topology.version;
		this.lastVisibleRange = { startIdx: colStart, endIdx: colEnd, pinLeft: plan.columns.pinLeftCount, pinRight: plan.columns.pinRightCount };

		const colCount = columns.length;
		const seen = new Set<string>();
		// The last cell placed in each lane: cells keep display order, moved only when out of it
		// (moving a node blurs the input inside it).
		const lastInLane = new Map<HTMLElement, HTMLDivElement>();

		for (let c = 0; c < colCount; c++) {
			const col = columns[c];
			const placement = topology.byColumnId.get(col.instanceId);
			if (!placement) continue;

			const isPinLeft = placement.lane === 'left';
			const isPinRight = placement.lane === 'right';
			const isCenter = placement.lane === 'center';

			if (isCenter && (c < colStart || c > colEnd)) continue;

			seen.add(col.field);

			// laneOffset is already lane-relative for all three lanes.
			const left = placement.laneOffset;
			const width = colWidths[c] ?? this.engine.stateManager.getState().defaultColWidth;
			const currentFilter = (filterModel?.[col.field] ?? null) as ColumnFilter | null;

			const targetParent = isPinLeft ? this.filterLeftLayer : isPinRight ? this.filterRightLayer : this.filterLayer;
			let cell = this.cells.get(col.field);
			if (!cell) {
				cell = this.createCell(c, col, left, width, currentFilter, isPinLeft, isPinRight);
			} else {
				// Update position if column widths changed
				cell.style.left = `${left}px`;
				cell.style.width = `${width}px`;
				// Reparent if lane changed (pin/unpin relocation — move, do not destroy/recreate).
				if (cell.parentNode !== targetParent) this.engine.instrumentation.increment(GridMetric.FLOATING_FILTER_VIEW_RELOCATED);
				// A filter set elsewhere (another surface, the api): show it.
				this.syncCellFilter(col.field, currentFilter);
			}
			const prev = lastInLane.get(targetParent) ?? null;
			const inPlace =
				cell.parentNode === targetParent && (prev ? cell.previousElementSibling === prev : cell === targetParent.firstElementChild);
			if (!inPlace) {
				if (prev) prev.after(cell);
				else targetParent.prepend(cell);
			}
			lastInLane.set(targetParent, cell);
		}

		// Remove cells that are no longer in the visible range
		for (const [field, cell] of this.cells) {
			if (!seen.has(field)) {
				this.views.get(field)?.handle?.destroy?.();
				this.views.delete(field);
				cell.remove();
				this.cells.delete(field);
			}
		}
	}

	private createCell(
		colIndex: number,
		col: InternalColumnDef<TRowData>,
		left: number,
		width: number,
		currentFilter: ColumnFilter | null,
		isPinLeft: boolean,
		isPinRight: boolean
	): HTMLDivElement {
		const cell = document.createElement('div');
		cell.className = 'og-floating-filter-cell';
		cell.dataset.colField = col.field;
		cell.dataset.colIndex = String(colIndex);
		cell.style.left = `${left}px`;
		cell.style.width = `${width}px`;
		const parent = isPinLeft ? this.filterLeftLayer : isPinRight ? this.filterRightLayer : this.filterLayer;
		parent?.appendChild(cell);
		this.cells.set(col.field, cell);
		this.mountView(col.field, currentFilter);
		return cell;
	}

	private mountView(field: string, filter: ColumnFilter | null): void {
		const cell = this.cells.get(field);
		if (!cell) return;
		this.views.get(field)?.handle?.destroy?.();
		cell.textContent = '';
		const view: FloatingFilterView = { handle: null, filter };
		this.views.set(field, view);
		view.handle = this.filters.mountEditor(cell, field, 'floating', undefined, (applied) => (view.filter = applied));
	}

	private syncCellFilter(field: string, filter: ColumnFilter | null): void {
		const view = this.views.get(field);
		if (!view || view.filter === filter) return;
		this.mountView(field, filter);
	}

	private clearCells(): void {
		for (const view of this.views.values()) view.handle?.destroy?.();
		this.views.clear();
		for (const cell of this.cells.values()) cell.remove();
		this.cells.clear();
		this.lastVisibleRange = { startIdx: -1, endIdx: -1, pinLeft: -1, pinRight: -1 };
		this.lastFilterModel = null;
		this.lastTopologyVersion = -1;
	}
}
