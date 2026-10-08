import type { GridEngine } from '../engine/GridEngine.js';
import type { GroupPanelRenderer } from './groupPanelRenderer.js';
import type { GridLayoutPlan } from './layoutPlan.js';
import { normalizeCapabilityResult } from '../capabilities/capabilityTypes.js';
import { afterNextPaint, type GridScheduler } from './gridScheduler.js';
import { paintSortIndicator } from './headerRenderer.js';

/**
 * Compute the per-column horizontal shift (px) that previews a reorder of `fromIndex`
 * to the insertion gap `gapIndex`, while a header drag is in progress.
 *
 * The returned `shifts[i]` is the delta from column i's CURRENT left to the left it
 * will occupy AFTER the move. Renderers add it to the column's positioning so every
 * displaced column slides aside under the cursor — and, crucially, the previewed
 * position is exactly the post-`moveColumn` position. That makes the drop seamless:
 * when the drag ends the shifts go to 0 and the reorder repaint writes the same pixel
 * positions, so nothing jumps and no FLIP pass is needed.
 *
 * Only center-lane (non-pinned) columns are previewed. If the dragged column or the
 * insertion target falls outside the center lane the function returns all-zero shifts
 * (reorder still happens on drop, just without the live preview).
 */
export function computeColumnReorderShifts(
	colWidths: ArrayLike<number>,
	fromIndex: number,
	gapIndex: number,
	pinLeftCount: number,
	pinRightCount: number
): number[] {
	const n = colWidths.length;
	const shifts = new Array<number>(n).fill(0);
	if (n === 0) return shifts;

	const centerStart = pinLeftCount;
	const centerEnd = n - pinRightCount; // exclusive
	if (fromIndex < centerStart || fromIndex >= centerEnd) return shifts;

	// Clamp the insertion gap into the center lane and mirror the drop's gap→index rule.
	let gap = gapIndex;
	if (gap < centerStart) gap = centerStart;
	if (gap > centerEnd) gap = centerEnd;
	const toIndex = gap > fromIndex ? gap - 1 : gap;
	if (toIndex === fromIndex) return shifts;

	// Current center order and the order after moving `fromIndex` to `toIndex`.
	const order: number[] = [];
	for (let i = centerStart; i < centerEnd; i++) order.push(i);
	const newOrder = order.slice();
	const [moved] = newOrder.splice(fromIndex - centerStart, 1);
	newOrder.splice(toIndex - centerStart, 0, moved);

	// Relative lefts (the center lane base cancels out in the delta).
	const curLeft = new Map<number, number>();
	let acc = 0;
	for (const ci of order) {
		curLeft.set(ci, acc);
		acc += colWidths[ci];
	}
	acc = 0;
	for (const ci of newOrder) {
		shifts[ci] = acc - (curLeft.get(ci) ?? 0);
		acc += colWidths[ci];
	}
	return shifts;
}

export interface ColumnInteractionControllerOptions<TRowData> {
	engine: GridEngine<TRowData>;
	getOverlayLayer: () => HTMLDivElement | null;
	getScrollViewport: () => HTMLDivElement | null;
	getLayoutPlan: () => GridLayoutPlan | null;
	schedulePaint: () => void;
	gridScheduler: GridScheduler;
	/** Dragging a column out of the grid hides it (default true). */
	dragOutHides?: () => boolean;
	/** Hides a column (the api's setColumnVisible). */
	hideColumn?: (colField: string) => void;
}

/** How far past the grid's edge a column is dragged before letting go hides it. */
const DRAG_OUT_HIDE_PX = 36;

const COLUMN_DRAG_SCROLL_EDGE_PX = 50;
const COLUMN_DRAG_SCROLL_MAX_PX = 14;

export class ColumnInteractionController<TRowData = unknown> {
	private engine: GridEngine<TRowData>;
	private getOverlayLayer: () => HTMLDivElement | null;
	private getScrollViewport: () => HTMLDivElement | null;
	private getLayoutPlan: () => GridLayoutPlan | null;
	private schedulePaint: () => void;
	private gridScheduler: GridScheduler;
	private isColumnReordering = false;
	private columnDragStartX = 0;
	private columnDragStartY = 0;
	private columnDragFromIndex = -1;
	private columnDragField: string | null = null;
	private columnDropInsertionIndex = -1;
	private columnDropIndicator: HTMLDivElement | null = null;
	private indicatorShown = false;
	private columnDragGhost: HTMLDivElement | null = null;
	// Live-reorder preview: per-column shift (px) for the current insertion
	// point. Null when no preview is active. Recomputed only when the insertion index
	// changes, then read by the header + body renderers via getColumnShift().
	private dragShifts: number[] | null = null;
	private shiftInsertionIndex = -2;

	// Group panel reference — set by RenderEngine when panel is mounted.
	private groupPanel: GroupPanelRenderer<TRowData> | null = null;
	// Whether the current column drag is over the group panel.
	private columnDragOverGroupPanel = false;
	private cachedViewportRect: DOMRect | null = null;
	private autoScrollFrame: number | null = null;
	private autoScrollRateX = 0;
	private lastDragClientX: number | null = null;
	private lastDragClientY: number | null = null;
	/** The column is dragged out of the grid: letting go hides it. */
	private columnDragHides = false;
	private readonly dragOutHides: () => boolean;
	private readonly hideColumn: ((colField: string) => void) | undefined;

	constructor(options: ColumnInteractionControllerOptions<TRowData>) {
		this.engine = options.engine;
		this.getOverlayLayer = options.getOverlayLayer;
		this.getScrollViewport = options.getScrollViewport;
		this.getLayoutPlan = options.getLayoutPlan;
		this.schedulePaint = options.schedulePaint;
		this.gridScheduler = options.gridScheduler;
		this.dragOutHides = options.dragOutHides ?? (() => true);
		this.hideColumn = options.hideColumn;
	}

	public onHeaderResizeMouseDown = (e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();

		const headerCell = (e.currentTarget as HTMLElement).closest('.og-header-cell') as HTMLElement | null;
		const colField = headerCell?.dataset.colField;
		const colIndex = Number(headerCell?.dataset.colIndex);
		if (!colField || !Number.isFinite(colIndex)) return;

		const startX = e.clientX;
		const startWidth = this.engine.geometry.getColWidth(colIndex, this.engine.stateManager.getState().defaultColWidth);
		let currentWidth = startWidth;

		const onMouseMove = (moveEvent: MouseEvent) => {
			const deltaX = moveEvent.clientX - startX;
			currentWidth = Math.max(30, startWidth + deltaX);
			this.engine.resizeColumn(colField, currentWidth, false);
		};

		const onMouseUp = () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
			this.schedulePaint();
		};

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	};

	public onHeaderCellMouseDown = (e: MouseEvent): void => {
		if (
			e.button !== 0 ||
			(e.target as HTMLElement).closest('.og-header-resize-handle') ||
			(e.target as HTMLElement).closest('.og-header-menu-button')
		)
			return;

		const state = this.engine.stateManager.getState();
		if (!state.enableColumnReorder) return;

		const headerCell = e.currentTarget as HTMLElement;
		const colField = headerCell.dataset.colField;
		const colIndex = Number(headerCell.dataset.colIndex);
		const column = colField ? state.columns[colIndex] : null;
		if (!colField || !Number.isFinite(colIndex)) return;
		if (column?.canMoveColumn !== undefined && !normalizeCapabilityResult(column.canMoveColumn({ action: 'moveColumn', colField })).allowed)
			return;

		this.columnDragStartX = e.clientX;
		this.columnDragStartY = e.clientY;
		this.columnDragFromIndex = colIndex;
		this.columnDragField = colField;
		this.columnDropInsertionIndex = colIndex;
		this.cachedViewportRect = this.getScrollViewport()?.getBoundingClientRect() ?? null;
		this.lastDragClientX = e.clientX;
		this.lastDragClientY = e.clientY;

		window.addEventListener('mousemove', this.onHeaderColumnDragMove);
		window.addEventListener('mouseup', this.onHeaderColumnDragMouseUp);
		window.addEventListener('blur', this.cancelColumnDrag);
		window.addEventListener('keydown', this.onColumnDragKeyDown, true);
	};

	/** Escape, or the window losing focus, drops the drag without moving or hiding anything. */
	private cancelColumnDrag = (): void => {
		if (this.groupPanel?.isHeaderDragActive()) this.groupPanel.onHeaderDragEnd(false);
		this.cleanup();
		this.schedulePaint();
	};

	private onColumnDragKeyDown = (e: KeyboardEvent): void => {
		if (e.key !== 'Escape' || !this.isColumnReordering) return;
		e.preventDefault();
		e.stopPropagation();
		this.cancelColumnDrag();
	};

	/** The pointer is far enough outside the grid that letting go hides the column. */
	private isOutsideGrid(e: MouseEvent): boolean {
		if (!this.hideColumn || !this.dragOutHides()) return false;
		const container = this.getScrollViewport()?.closest('.og-grid-container');
		if (!container) return false;
		const state = this.engine.stateManager.getState();
		// The last shown column stays.
		if (state.columns.filter((c) => !c.hide).length <= 1) return false;
		const r = container.getBoundingClientRect();
		return e.clientX < r.left - DRAG_OUT_HIDE_PX || e.clientX > r.right + DRAG_OUT_HIDE_PX || e.clientY < r.top - DRAG_OUT_HIDE_PX || e.clientY > r.bottom + DRAG_OUT_HIDE_PX;
	}

	/** Called by RenderEngine to wire up the group panel for drag-to-group support. */
	public setGroupPanel(panel: GroupPanelRenderer<TRowData> | null): void {
		this.groupPanel = panel;
	}

	public cleanup(): void {
		window.removeEventListener('mousemove', this.onHeaderColumnDragMove);
		window.removeEventListener('mouseup', this.onHeaderColumnDragMouseUp);
		window.removeEventListener('blur', this.cancelColumnDrag);
		window.removeEventListener('keydown', this.onColumnDragKeyDown, true);
		this.columnDragHides = false;

		if (this.columnDragOverGroupPanel && this.groupPanel) {
			this.groupPanel.onHeaderDragLeave();
		}
		this.columnDragOverGroupPanel = false;
		this.isColumnReordering = false;
		this.columnDragFromIndex = -1;
		this.columnDragField = null;
		this.columnDropInsertionIndex = -1;
		this.dragShifts = null;
		this.shiftInsertionIndex = -2;
		this.cachedViewportRect = null;
		this.lastDragClientX = null;
		this.lastDragClientY = null;
		this.stopAutoScroll();
		this.removeColumnDropIndicator();
		this.removeColumnDragGhost();
		this.getScrollViewport()?.closest('.og-grid-container')?.classList.remove('og-col-reordering');
	}

	/**
	 * Live-reorder preview shift (px) for a displayed column index — added to the
	 * column's positioning by the header and body renderers during a drag so columns
	 * slide aside under the cursor. 0 when no drag/preview is active. See
	 * {@link computeColumnReorderShifts}.
	 */
	public getColumnShift(colIndex: number): number {
		return this.dragShifts ? (this.dragShifts[colIndex] ?? 0) : 0;
	}

	public reattachOverlays(): void {
		const overlayLayer = this.getOverlayLayer();
		if (this.isColumnReordering && this.columnDropIndicator && overlayLayer && this.columnDropIndicator.parentNode !== overlayLayer) {
			overlayLayer.appendChild(this.columnDropIndicator);
		}
	}

	public isDraggingColumn(colField: string): boolean {
		return this.isColumnReordering && this.columnDragField === colField;
	}

	private onHeaderColumnDragMove = (e: MouseEvent): void => {
		const dragDistance = Math.max(Math.abs(e.clientX - this.columnDragStartX), Math.abs(e.clientY - this.columnDragStartY));
		if (!this.isColumnReordering) {
			if (dragDistance < 4) return;
			this.isColumnReordering = true;
			this.ensureColumnDropIndicator();
			this.ensureColumnDragGhost();
			this.getScrollViewport()?.closest('.og-grid-container')?.classList.add('og-col-reordering');
			this.schedulePaint();
		}

		e.preventDefault();
		this.lastDragClientX = e.clientX;
		this.lastDragClientY = e.clientY;
		this.updateColumnDragGhost(e);

		// Route to group panel when the dragged column supports grouping and the
		// pointer is over the panel.  Hide the column drop indicator while over it.
		const colField = this.columnDragField;
		if (colField && this.groupPanel) {
			const state = this.engine.stateManager.getState();
			const col = state.columns.find((c) => c.field === colField);
			// Full capability chain (column.canGroup, column.enableRowGroup, grid-level canGroup),
			// not just the enableRowGroup boolean, so canGroup: () => false blocks the drag too.
			const isGroupable = !!col && this.engine.capabilityManager.can('group', { colField }).allowed;
			const overPanel = isGroupable && this.groupPanel.containsPoint(e.clientX, e.clientY);

			if (overPanel !== this.columnDragOverGroupPanel) {
				this.columnDragOverGroupPanel = overPanel;
				if (overPanel) {
					this.groupPanel.onHeaderDragEnter(colField);
					if (this.columnDropIndicator) this.columnDropIndicator.style.display = 'none';
					// Drop the live-reorder preview while over the panel; recompute on return.
					this.dragShifts = null;
					this.shiftInsertionIndex = -2;
					this.stopAutoScroll();
					this.schedulePaint();
				} else {
					this.groupPanel.onHeaderDragLeave();
					if (this.columnDropIndicator) this.columnDropIndicator.style.display = '';
				}
			}
			if (overPanel) {
				this.groupPanel.onHeaderDragMove(e);
				return;
			}
		}

		// Out of the grid: letting go hides the column (the ghost says so); back in, it moves again.
		const hides = this.isOutsideGrid(e);
		if (hides !== this.columnDragHides) {
			this.columnDragHides = hides;
			this.columnDragGhost?.toggleAttribute('data-hide', hides);
			if (this.columnDropIndicator) this.columnDropIndicator.style.display = hides ? 'none' : '';
			if (hides) {
				this.dragShifts = null;
				this.shiftInsertionIndex = -2;
				this.stopAutoScroll();
				this.schedulePaint();
			}
		}
		if (hides) return;

		this.updateHorizontalAutoScroll(e.clientX);
		this.updateColumnDropTarget(e);
	};
	private findHeaderCell(colField: string): HTMLElement | null {
		const root = this.getScrollViewport()?.closest('.og-grid-container') ?? null;
		if (!root) return null;
		for (const cell of root.querySelectorAll<HTMLElement>('[role="columnheader"]')) if (cell.dataset.colField === colField) return cell;
		return null;
	}

	private onHeaderColumnDragMouseUp = (): void => {
		const wasReordering = this.isColumnReordering;
		const fromIndex = this.columnDragFromIndex;
		const insertionIndex = this.columnDropInsertionIndex;
		const colField = this.columnDragField;
		const wasOverGroupPanel = this.columnDragOverGroupPanel;
		const wasHiding = this.columnDragHides;

		// Finalise group-panel drop before cleanup() clears drag state
		if (wasOverGroupPanel && this.groupPanel) {
			this.groupPanel.onHeaderDragEnd(true);
		} else if (this.groupPanel?.isHeaderDragActive()) {
			this.groupPanel.onHeaderDragEnd(false);
		}

		this.cleanup();

		if (!wasReordering && colField) {
			// Handle column header click sorting!
			const state = this.engine.stateManager.getState();
			const column = state.columns.find((c) => c.field === colField);
			if (column && column.sortable !== false) {
				const currentSort = state.sortModel?.find((s) => s.colId === colField);
				const next = !currentSort ? 'asc' : currentSort.sort === 'asc' ? 'desc' : null;
				// The header shows the new sort now; the sort (a full rebuild on large grids) runs after the
				// browser paints it, so the click answers at once.
				const headerCell = this.findHeaderCell(colField);
				if (headerCell) paintSortIndicator(headerCell, next, true);
				afterNextPaint(() => {
					// A sort applied meanwhile (another click, the api) wins.
					if (this.engine.stateManager.getState().sortModel !== state.sortModel) return;
					this.engine.setSortModel(next ? [{ colId: colField, sort: next }] : null);
				}, this.gridScheduler);
			}
			return;
		}

		// Group panel drop was handled above — don't also reorder columns.
		if (wasOverGroupPanel) return;

		if (wasReordering && wasHiding && colField) {
			this.hideColumn?.(colField);
			return;
		}

		if (!wasReordering || !colField || fromIndex < 0 || insertionIndex < 0) {
			this.schedulePaint();
			return;
		}

		const state = this.engine.stateManager.getState();
		const toIndex = Math.max(0, Math.min(state.columns.length - 1, insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex));
		if (toIndex !== fromIndex) {
			this.engine.moveColumn(colField, toIndex);
		} else {
			this.schedulePaint();
		}
	};

	private ensureColumnDropIndicator(): void {
		const overlayLayer = this.getOverlayLayer();
		if (this.columnDropIndicator || !overlayLayer) return;

		this.columnDropIndicator = document.createElement('div');
		this.columnDropIndicator.className = 'og-column-drop-indicator';
		overlayLayer.appendChild(this.columnDropIndicator);
	}

	private removeColumnDropIndicator(): void {
		this.columnDropIndicator?.remove();
		this.columnDropIndicator = null;
		this.indicatorShown = false;
	}

	private ensureColumnDragGhost(): void {
		if (this.columnDragGhost) return;

		const state = this.engine.stateManager.getState();
		const draggedColumn = state.columns.find((col) => col.field === this.columnDragField);
		const label = draggedColumn?.header || draggedColumn?.field || '';

		this.columnDragGhost = document.createElement('div');
		this.columnDragGhost.className = 'og-column-drag-ghost';
		// 6-dot drag-handle SVG + column label (textContent avoids XSS)
		this.columnDragGhost.innerHTML =
			'<svg class="og-drag-ghost-icon" viewBox="0 0 10 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">' +
			'<circle cx="3" cy="3.5" r="1.3"/><circle cx="7" cy="3.5" r="1.3"/>' +
			'<circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>' +
			'<circle cx="3" cy="12.5" r="1.3"/><circle cx="7" cy="12.5" r="1.3"/>' +
			'</svg>';
		const labelSpan = document.createElement('span');
		labelSpan.textContent = label;
		this.columnDragGhost.appendChild(labelSpan);
		// Shown while the column is out of the grid: letting go hides it.
		const hideHint = document.createElement('span');
		hideHint.className = 'og-drag-ghost-hide';
		hideHint.innerHTML =
			'<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
		hideHint.appendChild(document.createTextNode('Hide'));
		this.columnDragGhost.appendChild(hideHint);

		const scrollViewport = this.getScrollViewport();
		const container = scrollViewport?.closest('.og-grid-container') as HTMLElement | null;
		if (container && container.dataset.ogThemeScope) {
			this.columnDragGhost.dataset.ogThemeScope = container.dataset.ogThemeScope;
		}

		document.body.appendChild(this.columnDragGhost);
	}

	private updateColumnDragGhost(e: MouseEvent): void {
		if (!this.columnDragGhost) return;

		this.columnDragGhost.style.transform = `translate3d(${e.clientX + 12}px, ${e.clientY + 12}px, 0)`;
	}

	private removeColumnDragGhost(): void {
		this.columnDragGhost?.remove();
		this.columnDragGhost = null;
	}

	private updateColumnDropTarget(e: MouseEvent): void {
		const scrollViewport = this.getScrollViewport();
		if (!scrollViewport || !this.columnDropIndicator) return;

		const state = this.engine.stateManager.getState();
		if (state.columns.length === 0) return;

		const scrollRect = this.cachedViewportRect ?? scrollViewport.getBoundingClientRect();
		const contentX = e.clientX - scrollRect.left + scrollViewport.scrollLeft;
		const targetCol = Math.max(0, Math.min(state.columns.length - 1, this.engine.geometry.getColIndexAtOffset(contentX)));
		const targetLeft = this.engine.geometry.colLefts[targetCol] || 0;
		const targetWidth = this.engine.geometry.colWidths[targetCol] || state.defaultColWidth;
		const insertAfterTarget = contentX > targetLeft + targetWidth / 2;
		const insertionIndex = Math.max(0, Math.min(state.columns.length, targetCol + (insertAfterTarget ? 1 : 0)));

		this.columnDropInsertionIndex = insertionIndex;

		// Recompute the live-reorder preview only when the insertion point actually
		// changes, then force a full repaint so the header + body slide to the previewed
		// positions. (schedulePaint is wired to a full paint during reorder.)
		if (insertionIndex !== this.shiftInsertionIndex) {
			this.shiftInsertionIndex = insertionIndex;
			const layoutPlan = this.getLayoutPlan();
			this.dragShifts = computeColumnReorderShifts(
				this.engine.geometry.colWidths,
				this.columnDragFromIndex,
				insertionIndex,
				layoutPlan?.columns.pinLeftCount ?? 0,
				layoutPlan?.columns.pinRightCount ?? 0
			);
			this.schedulePaint();
		}

		const indicatorContentLeft =
			insertionIndex >= state.columns.length
				? this.engine.geometry.getTotalWidth(state.defaultColWidth)
				: this.engine.geometry.colLefts[insertionIndex] || 0;
		const indicatorViewportLeft = indicatorContentLeft - scrollViewport.scrollLeft;

		this.columnDropIndicator.style.display = 'block';
		const topChromeHeight = this.getLayoutPlan()?.chrome.topChromeHeight ?? 0;
		this.columnDropIndicator.style.height = `${Math.max(0, this.engine.viewport.viewportHeight - topChromeHeight)}px`;

		const transform = `translate3d(${indicatorViewportLeft}px, 0, 0)`;
		if (!this.indicatorShown) {
			// First placement: position instantly (no fly-in from the left edge), then enable
			// the CSS glide + fade so it slides smoothly between insertion points afterwards.
			this.indicatorShown = true;
			this.columnDropIndicator.style.transition = 'none';
			this.columnDropIndicator.style.transform = transform;
			void this.columnDropIndicator.offsetWidth; // commit position before transitions run
			this.columnDropIndicator.style.transition = '';
			this.columnDropIndicator.classList.add('og-indicator-ready');
		} else {
			this.columnDropIndicator.style.transform = transform; // glides via CSS transition
		}
	}

	private updateHorizontalAutoScroll(clientX: number): void {
		const scrollViewport = this.getScrollViewport();
		if (!scrollViewport) return;
		const scrollRect = this.cachedViewportRect ?? scrollViewport.getBoundingClientRect();
		const distFromLeft = clientX - scrollRect.left;
		const distFromRight = scrollRect.right - clientX;

		if (distFromRight < COLUMN_DRAG_SCROLL_EDGE_PX) {
			this.startAutoScroll(COLUMN_DRAG_SCROLL_MAX_PX * (1 - distFromRight / COLUMN_DRAG_SCROLL_EDGE_PX));
		} else if (distFromLeft < COLUMN_DRAG_SCROLL_EDGE_PX) {
			this.startAutoScroll(-COLUMN_DRAG_SCROLL_MAX_PX * (1 - distFromLeft / COLUMN_DRAG_SCROLL_EDGE_PX));
		} else {
			this.stopAutoScroll();
		}
	}

	private startAutoScroll(rate: number): void {
		this.autoScrollRateX = rate;
		if (this.autoScrollFrame !== null) return;

		const tick = (): void => {
			if (!this.isColumnReordering) {
				this.autoScrollFrame = null;
				return;
			}

			const scrollViewport = this.getScrollViewport();
			if (!scrollViewport) {
				this.autoScrollFrame = null;
				return;
			}

			const maxScrollLeft = Math.max(0, scrollViewport.scrollWidth - scrollViewport.clientWidth);
			const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, scrollViewport.scrollLeft + this.autoScrollRateX));
			if (nextScrollLeft === scrollViewport.scrollLeft) {
				this.stopAutoScroll();
				return;
			}

			scrollViewport.scrollLeft = nextScrollLeft;
			this.engine.viewport.setScrollPosition(this.engine.viewport.scrollTop, nextScrollLeft);
			if (this.lastDragClientX !== null) {
				this.updateColumnDropTarget({ clientX: this.lastDragClientX } as MouseEvent);
			}
			this.schedulePaint();
			this.autoScrollFrame = this.gridScheduler.raf(tick);
		};

		this.autoScrollFrame = this.gridScheduler.raf(tick);
	}

	private stopAutoScroll(): void {
		this.autoScrollRateX = 0;
		if (this.autoScrollFrame !== null) {
			this.gridScheduler.cancelRaf(this.autoScrollFrame);
			this.autoScrollFrame = null;
		}
	}
}
