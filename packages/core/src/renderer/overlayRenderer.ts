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

	/**
	 * The selection box lives in the scrolled content (rows container and the pinned bands), in
	 * content coordinates, so the compositor scrolls it with the cells and nothing is written per
	 * scroll frame. A range crossing pin zones is split into one piece per (row zone x column zone),
	 * each parented where its cells live; internal split edges carry no border.
	 */
	private readonly selectionPieces = new Map<string, HTMLDivElement>();
	private readonly laneLayers = new Map<string, HTMLDivElement>();
	private fillHandle: HTMLDivElement | null = null;
	/** Painted center-column pieces with pinned columns present: content-space extent, clipped to the center area. */
	private readonly clippedPieces = new Map<HTMLDivElement, { left: number; width: number }>();
	private lastClipScrollLeft = Number.NaN;
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
		this.disposeSelectionDom();
	}

	public unmount(): void {
		this.hideSelectionOverlay();
		this.disposeSelectionDom();
	}

	private disposeSelectionDom(): void {
		for (const el of this.selectionPieces.values()) el.remove();
		for (const el of this.laneLayers.values()) el.remove();
		this.selectionPieces.clear();
		this.clippedPieces.clear();
		this.laneLayers.clear();
		this.fillHandle?.remove();
		this.fillHandle = null;
	}

	public sync(frame: InvalidationFrame): void {
		this.paintOverlay();
	}

	public repaintOverlay(): void {
		this.paintOverlay();
	}

	public syncScrollPosition(hasVisibleSelectionOverlay = this.hasVisibleSelectionOverlay()): void {
		// The selection box scrolls with the content, so a scroll frame writes nothing; only the
		// post-scroll repaint (selection changes, fill preview) is scheduled.
		if (hasVisibleSelectionOverlay) {
			this.overlayDirtyDuringScroll = true;
			// Only horizontal scroll can move a center piece under a pinned lane; vertical scroll writes nothing.
			if (this.clippedPieces.size > 0 && this.engine.viewport.scrollLeft !== this.lastClipScrollLeft) {
				if (this.renderStats) this.renderStats.scrollLinkedPositionWrites++;
				this.applyCenterClip();
			}
		}
	}

	/**
	 * Rows are transform stacking contexts, so pinned lanes (z 40) cannot paint over the box (z 19).
	 * Center pieces are therefore clipped to the center area; sides with nothing to clip stay open so
	 * the fill handle is not cut.
	 */
	private applyCenterClip(): void {
		const scrollLeft = this.engine.viewport.scrollLeft;
		this.lastClipScrollLeft = scrollLeft;
		const plan = this.viewportRenderer.getLayoutPlan();
		const pinLeft = plan?.columns.pinLeftWidth ?? 0;
		const pinRight = plan?.columns.pinRightWidth ?? 0;
		const clientWidth = plan?.viewport.clientWidth ?? this.engine.viewport.viewportWidth;
		const visibleLeft = scrollLeft + pinLeft;
		const visibleRight = scrollLeft + clientWidth - pinRight;
		for (const [piece, { left, width }] of this.clippedPieces) {
			const l = visibleLeft - left;
			const r = left + width - visibleRight;
			const value = `inset(-10px ${r > 0 ? r : -10}px -10px ${l > 0 ? l : -10}px)`;
			if (piece.style.clipPath !== value) piece.style.clipPath = value;
		}
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

		if (!this.writeSelectionPieces(minRow, maxRow, minCol, maxCol)) {
			this.hideSelectionOverlay();
			return;
		}
		this.selectionDragBounds = { minRow, maxRow, minCol, maxCol };

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

	private getLaneLayer(host: HTMLElement, side: 'left' | 'right'): HTMLDivElement {
		const key = `${host.className}|${side}`;
		let lane = this.laneLayers.get(key);
		if (!lane) {
			lane = document.createElement('div');
			lane.className = `og-selection-lane og-selection-lane-${side}`;
			this.laneLayers.set(key, lane);
		}
		if (lane.parentNode !== host) host.appendChild(lane);
		return lane;
	}

	private getPiece(key: string): HTMLDivElement {
		let piece = this.selectionPieces.get(key);
		if (!piece) {
			piece = document.createElement('div');
			piece.className = 'og-selection-border';
			this.selectionPieces.set(key, piece);
		}
		return piece;
	}

	private ensureFillHandle(): HTMLDivElement {
		if (!this.fillHandle) {
			const handle = document.createElement('div');
			handle.className = 'og-selection-fill-handle';
			handle.addEventListener('mousedown', this.onSelectionFillHandleMouseDown);
			this.fillHandle = handle;
		}
		return this.fillHandle;
	}

	/** Paints the (possibly split) selection box in content coordinates. False when nothing is visible. */
	private writeSelectionPieces(minRow: number, maxRow: number, minCol: number, maxCol: number): boolean {
		const rowModel = this.engine.getRowModel();
		const rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
		const colCount = this.engine.columns.getDisplayedColumnCount();
		if (rowCount === 0 || colCount === 0 || minRow < 0 || minCol < 0 || maxRow >= rowCount || maxCol >= colCount) return false;

		const viewport = this.engine.viewport;
		const geometry = this.engine.geometry;
		const pinTop = Math.min(viewport.pinTopRows, rowCount);
		const pinBottom = Math.min(viewport.pinBottomRows, rowCount);
		const pinLeft = Math.min(viewport.pinLeftColumns, colCount);
		const pinRight = Math.min(viewport.pinRightColumns, colCount);
		const rowZones: Array<{ id: string; host: HTMLElement | null; min: number; max: number }> = [
			{ id: 'top', host: this.viewportRenderer.pinnedTopLayer, min: 0, max: pinTop - 1 },
			{ id: 'mid', host: this.viewportRenderer.rowsContainer, min: pinTop, max: rowCount - pinBottom - 1 },
			{ id: 'bottom', host: this.viewportRenderer.pinnedBottomLayer, min: rowCount - pinBottom, max: rowCount - 1 },
		];
		const colZones: Array<{ id: 'left' | 'mid' | 'right'; min: number; max: number }> = [
			{ id: 'left', min: 0, max: pinLeft - 1 },
			{ id: 'mid', min: pinLeft, max: colCount - pinRight - 1 },
			{ id: 'right', min: colCount - pinRight, max: colCount - 1 },
		];
		const totalHeight = pinBottom > 0 ? geometry.getTotalHeight(this.engine.stateManager.getState().defaultRowHeight) : 0;
		const firstRightColLeft = pinRight > 0 ? geometry.colLefts[colCount - pinRight] || 0 : 0;

		const handle = this.ensureFillHandle();
		let handleHost: HTMLDivElement | null = null;
		let any = false;
		const used = new Set<string>();
		this.clippedPieces.clear();

		for (const rz of rowZones) {
			const r0 = Math.max(minRow, rz.min);
			const r1 = Math.min(maxRow, rz.max);
			if (r0 > r1 || !rz.host) continue;
			const rowShift = rz.id === 'bottom' ? totalHeight : 0;
			for (const cz of colZones) {
				const c0 = Math.max(minCol, cz.min);
				const c1 = Math.min(maxCol, cz.max);
				if (c0 > c1) continue;

				const top = (geometry.rowTops[r0] || 0) - rowShift;
				const bottom = (geometry.rowTops[r1] || 0) + (geometry.rowHeights[r1] || 0) - rowShift;
				const left = geometry.colLefts[c0] || 0;
				const right = (geometry.colLefts[c1] || 0) + (geometry.colWidths[c1] || 0);
				const width = right - left;
				const height = bottom - top;
				if (width <= 0 || height <= 0) continue;

				const key = `${rz.id}:${cz.id}`;
				used.add(key);
				const piece = this.getPiece(key);
				const parent = cz.id === 'mid' ? rz.host : this.getLaneLayer(rz.host, cz.id);
				if (piece.parentNode !== parent) parent.appendChild(piece);
				const localLeft = cz.id === 'right' ? left - firstRightColLeft : left;
				const style = piece.style;
				const transform = `translate3d(${snapToDevicePixel(localLeft)}px, ${snapToDevicePixel(top)}px, 0)`;
				if (style.transform !== transform) style.transform = transform;
				if (style.width !== `${width}px`) style.width = `${width}px`;
				if (style.height !== `${height}px`) style.height = `${height}px`;
				if (style.display !== 'block') style.display = 'block';
				// Edges shared with a neighbouring piece are not part of the box outline.
				const edge = (drawn: boolean) => (drawn ? '' : '0px');
				style.borderTopWidth = edge(r0 === minRow);
				style.borderBottomWidth = edge(r1 === maxRow);
				style.borderLeftWidth = edge(c0 === minCol);
				style.borderRightWidth = edge(c1 === maxCol);
				if (r1 === maxRow && c1 === maxCol) handleHost = piece;
				if (cz.id === 'mid' && (pinLeft > 0 || pinRight > 0)) this.clippedPieces.set(piece, { left, width });
				else if (style.clipPath) style.clipPath = '';
				any = true;
			}
		}

		for (const [key, piece] of this.selectionPieces) {
			if (!used.has(key) && piece.style.display !== 'none') piece.style.display = 'none';
		}
		if (handleHost) {
			if (handle.parentNode !== handleHost) handleHost.appendChild(handle);
		} else {
			handle.remove();
		}
		this.syncLaneWidths();
		if (this.clippedPieces.size > 0) this.applyCenterClip();
		return any;
	}

	private syncLaneWidths(): void {
		const columns = this.viewportRenderer.getLayoutPlan()?.columns;
		for (const [key, lane] of this.laneLayers) {
			const width = key.endsWith('left') ? columns?.pinLeftWidth : columns?.pinRightWidth;
			const px = `${width ?? 0}px`;
			if (lane.style.width !== px) lane.style.width = px;
		}
	}

	public hideSelectionOverlay(): void {
		this.selectionDragBounds = null;
		this.clippedPieces.clear();
		for (const piece of this.selectionPieces.values()) {
			if (piece.style.display !== 'none') piece.style.display = 'none';
		}
		this.fillHandle?.remove();
	}

	private onSelectionFillHandleMouseDown = (e: MouseEvent): void => {
		if (!this.selectionDragBounds) return;
		e.preventDefault();
		e.stopPropagation();
		const { minRow, maxRow, minCol, maxCol } = this.selectionDragBounds;
		this.fillDragGetter().start(e, minRow, maxRow, minCol, maxCol);
	};
}
