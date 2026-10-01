import type { InvalidationFrame } from './invalidationManager.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { ViewportRenderer } from './viewportRenderer.js';
import type { ColumnInteractionController } from './columnInteractionController.js';
import type { FillDragController, OverlayBox } from './fillDragController.js';
import { readInteractionState } from '../interaction/interactionState.js';
import { getRightPinnedLaneScreenLeft, LEAF_HEADER_HEIGHT, snapToDevicePixel } from './layoutPlan.js';

export class OverlayRenderer<TRowData = unknown> {
	private readonly engine: GridEngine<TRowData>;
	private readonly viewportRenderer: ViewportRenderer<TRowData>;
	private readonly columnInteractionsGetter: () => ColumnInteractionController<TRowData>;
	private readonly fillDragGetter: () => FillDragController<TRowData>;

	private selectionBorder: HTMLDivElement | null = null;
	public selectionDragBounds: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null = null;
	public overlayDirtyDuringScroll = false;
	public renderStats: any = null;

	constructor(
		engine: GridEngine<TRowData>,
		viewportRenderer: ViewportRenderer<TRowData>,
		columnInteractionsGetter: () => ColumnInteractionController<TRowData>,
		fillDragGetter: () => FillDragController<TRowData>
	) {
		this.engine = engine;
		this.viewportRenderer = viewportRenderer;
		this.columnInteractionsGetter = columnInteractionsGetter;
		this.fillDragGetter = fillDragGetter;
	}

	public mount(): void {
		this.selectionDragBounds = null;
		if (this.selectionBorder) {
			this.selectionBorder.remove();
			this.selectionBorder = null;
		}
	}

	public unmount(): void {
		this.hideSelectionOverlay();
		if (this.selectionBorder) {
			this.selectionBorder.remove();
			this.selectionBorder = null;
		}
	}

	public sync(frame: InvalidationFrame): void {
		this.paintOverlay();
	}

	public repaintOverlay(): void {
		this.paintOverlay();
	}

	public syncScrollPosition(hasVisibleSelectionOverlay = this.hasVisibleSelectionOverlay()): void {
		if (hasVisibleSelectionOverlay) {
			// finishScrolling still runs the full repaint (selection changes, fill preview,
			// column overlays); this frame only moves the already-painted box with the content.
			this.overlayDirtyDuringScroll = true;
			this.repositionSelectionForScroll();
		}
	}

	/**
	 * Cheap per-scroll-frame follow for the selection border (and the fill handle inside it):
	 * recompute the clamped box for the last painted bounds and update its transform/size only.
	 * No DOM is created, reparented or reattached here.
	 */
	private repositionSelectionForScroll(): void {
		const selectionBorder = this.selectionBorder;
		const bounds = this.selectionDragBounds;
		if (!selectionBorder || !bounds || selectionBorder.parentNode !== this.viewportRenderer.overlayLayer) return;
		const box = this.getClampedOverlayBox(bounds.minRow, bounds.maxRow, bounds.minCol, bounds.maxCol);
		if (!box) {
			// Scrolled fully out of the clamped viewport: hide without dropping the painted bounds,
			// so the box reappears when it scrolls back in.
			if (selectionBorder.style.display !== 'none') selectionBorder.style.display = 'none';
			return;
		}
		this.writeSelectionBox(selectionBorder, box);
	}

	private writeSelectionBox(selectionBorder: HTMLDivElement, box: OverlayBox): void {
		const transform = `translate3d(${snapToDevicePixel(box.left)}px, ${snapToDevicePixel(box.top)}px, 0)`;
		const width = `${box.width}px`;
		const height = `${box.height}px`;
		const style = selectionBorder.style;
		if (style.transform !== transform) style.transform = transform;
		if (style.width !== width) style.width = width;
		if (style.height !== height) style.height = height;
		if (style.display !== 'block') style.display = 'block';
	}

	public syncPosition(): void {
		this.syncScrollPosition();
	}

	public paintOverlay(): void {
		const isScrolling = this.renderStats && this.renderStats.isScrolling;
		if (isScrolling && this.renderStats) {
			this.renderStats.overlayPaintsDuringScroll++;
		}
		if (!this.viewportRenderer.overlayLayer) return;

		this.columnInteractionsGetter().reattachOverlays();

		const state = this.engine.stateManager.getState();
		const bounds = readInteractionState(state).cellSelection.selection.bounds;

		if (!bounds || !this.engine.getRowModel()) {
			this.hideSelectionOverlay();
			return;
		}

		const rowModel = this.engine.getRowModel()!;
		const rowCount = rowModel.getVisualRowCount();
		const colCount = this.engine.columns.getDisplayedColumnCount();

		const minRow = Math.max(0, bounds.minRow);
		const maxRow = Math.min(rowCount - 1, bounds.maxRow);
		const minCol = Math.max(0, bounds.minCol);
		const maxCol = Math.min(colCount - 1, bounds.maxCol);

		if (minRow > maxRow || minCol > maxCol) {
			this.hideSelectionOverlay();
			return;
		}

		const box = this.getClampedOverlayBox(minRow, maxRow, minCol, maxCol);
		if (!box) {
			this.hideSelectionOverlay();
			return;
		}

		const selectionBorder = this.ensureSelectionBorder();
		this.selectionDragBounds = { minRow, maxRow, minCol, maxCol };

		this.writeSelectionBox(selectionBorder, box);

		if (selectionBorder.parentNode !== this.viewportRenderer.overlayLayer) {
			this.viewportRenderer.overlayLayer.appendChild(selectionBorder);
		}

		this.fillDragGetter().reattachPreview();
	}

	public hasVisibleSelectionOverlay(): boolean {
		const state = this.engine.stateManager.getState();
		return !!readInteractionState(state).cellSelection.selection.bounds && !!this.engine.getRowModel();
	}

	public getClampedOverlayBox(minRow: number, maxRow: number, minCol: number, maxCol: number): OverlayBox | null {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const colCount = this.engine.columns.getDisplayedColumnCount();

		if (rowCount === 0 || colCount === 0 || minRow < 0 || minCol < 0 || maxRow >= rowCount || maxCol >= colCount) {
			return null;
		}

		const pinLeftColumns = this.engine.viewport.pinLeftColumns;
		const pinRightColumns = this.engine.viewport.pinRightColumns;
		const pinTopRows = this.engine.viewport.pinTopRows;
		const pinBottomRows = this.engine.viewport.pinBottomRows;
		const scrollTop = this.engine.viewport.scrollTop;
		const scrollLeft = this.engine.viewport.scrollLeft;
		const viewportHeight = this.engine.viewport.viewportHeight;
		const layoutPlan = this.viewportRenderer.getLayoutPlan();
		const viewportWidth =
			layoutPlan?.viewport.clientWidth ?? (this.engine.viewport.scrollViewportClientWidth || this.engine.viewport.viewportWidth);
		const topChromeHeight = layoutPlan?.chrome.topChromeHeight ?? LEAF_HEADER_HEIGHT;
		const overlayViewportHeight = Math.max(0, viewportHeight - topChromeHeight);

		let pinnedLeftWidth = 0;
		for (let i = 0; i < pinLeftColumns && i < colCount; i++) {
			pinnedLeftWidth += this.engine.geometry.colWidths[i] || 0;
		}

		let pinnedRightWidth = 0;
		for (let i = 0; i < pinRightColumns && i < colCount; i++) {
			pinnedRightWidth += this.engine.geometry.colWidths[colCount - 1 - i] || 0;
		}

		let pinnedTopHeight = 0;
		for (let i = 0; i < pinTopRows && i < rowCount; i++) {
			pinnedTopHeight += this.engine.geometry.rowHeights[i] || 0;
		}

		let pinnedBottomHeight = 0;
		for (let i = 0; i < pinBottomRows && i < rowCount; i++) {
			pinnedBottomHeight += this.engine.geometry.rowHeights[rowCount - 1 - i] || 0;
		}

		const getClampedX = (c: number): { left: number; right: number } => {
			const cellLeft = this.engine.geometry.colLefts[c] || 0;
			const cellWidth = this.engine.geometry.colWidths[c] || 0;

			if (c < pinLeftColumns) {
				return { left: cellLeft, right: cellLeft + cellWidth };
			}
			if (c >= colCount - pinRightColumns) {
				const firstRightPinColIdx = colCount - pinRightColumns;
				const firstRightPinColLeft = this.engine.geometry.colLefts[firstRightPinColIdx] || 0;
				const rightLaneLeft = layoutPlan ? getRightPinnedLaneScreenLeft(layoutPlan) : viewportWidth - pinnedRightWidth;
				const left = rightLaneLeft + (cellLeft - firstRightPinColLeft);
				return { left, right: left + cellWidth };
			}

			const unclippedLeft = cellLeft - scrollLeft;
			const unclippedRight = unclippedLeft + cellWidth;
			const left = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedLeft));
			const right = Math.max(pinnedLeftWidth, Math.min(viewportWidth - pinnedRightWidth, unclippedRight));
			return { left, right };
		};

		const getClampedY = (r: number): { top: number; bottom: number } => {
			const rowTop = this.engine.geometry.rowTops[r] || 0;
			const rowHeight = this.engine.geometry.rowHeights[r] || 0;

			if (r < pinTopRows) {
				return { top: rowTop, bottom: rowTop + rowHeight };
			}
			if (r >= rowCount - pinBottomRows) {
				// State is read only for pinned-bottom rows, keeping the per-scroll-frame reposition
				// free of state reads in the common case.
				const totalHeight = this.engine.geometry.getTotalHeight(this.engine.stateManager.getState().defaultRowHeight);
				const bottomOffset = totalHeight - rowTop;
				const top = overlayViewportHeight - bottomOffset;
				return { top, bottom: top + rowHeight };
			}

			const unclippedTop = rowTop - scrollTop;
			const unclippedBottom = unclippedTop + rowHeight;
			const top = Math.max(pinnedTopHeight, Math.min(overlayViewportHeight - pinnedBottomHeight, unclippedTop));
			const bottom = Math.max(pinnedTopHeight, Math.min(overlayViewportHeight - pinnedBottomHeight, unclippedBottom));
			return { top, bottom };
		};

		const xRangeMin = getClampedX(minCol);
		const xRangeMax = getClampedX(maxCol);
		const yRangeMin = getClampedY(minRow);
		const yRangeMax = getClampedY(maxRow);
		const width = xRangeMax.right - xRangeMin.left;
		const height = yRangeMax.bottom - yRangeMin.top;

		if (width <= 0 || height <= 0) {
			return null;
		}

		return { left: xRangeMin.left, top: yRangeMin.top, width, height };
	}

	public ensureSelectionBorder(): HTMLDivElement {
		if (!this.selectionBorder) {
			this.selectionBorder = document.createElement('div');
			this.selectionBorder.className = 'og-selection-border';

			const fillHandle = document.createElement('div');
			fillHandle.className = 'og-selection-fill-handle';
			fillHandle.addEventListener('mousedown', this.onSelectionFillHandleMouseDown);
			this.selectionBorder.appendChild(fillHandle);
		}

		return this.selectionBorder;
	}

	public hideSelectionOverlay(): void {
		this.selectionDragBounds = null;
		if (this.selectionBorder) {
			this.selectionBorder.style.display = 'none';
		}
	}

	private onSelectionFillHandleMouseDown = (e: MouseEvent): void => {
		if (!this.selectionDragBounds) return;
		e.preventDefault();
		e.stopPropagation();
		const { minRow, maxRow, minCol, maxCol } = this.selectionDragBounds;
		this.fillDragGetter().start(e, minRow, maxRow, minCol, maxCol);
	};
}
