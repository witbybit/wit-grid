import type { GridEngine } from './engine/GridEngine.js';

export interface ViewportRange {
	startIdx: number;
	endIdx: number;
}

export class ViewportController<TRowData = unknown> {
	constructor(private readonly engine: GridEngine<TRowData>) {}

	public get scrollTop(): number {
		return this.engine.viewport.scrollTop;
	}
	public set scrollTop(val: number) {
		this.engine.viewport.scrollTop = val;
	}

	public get scrollLeft(): number {
		return this.engine.viewport.scrollLeft;
	}
	public set scrollLeft(val: number) {
		this.engine.viewport.scrollLeft = val;
	}

	public get viewportWidth(): number {
		return this.engine.viewport.viewportWidth;
	}
	public set viewportWidth(val: number) {
		this.engine.viewport.viewportWidth = val;
	}

	public get viewportHeight(): number {
		return this.engine.viewport.viewportHeight;
	}
	public set viewportHeight(val: number) {
		this.engine.viewport.viewportHeight = val;
	}

	public get pinLeftColumns(): number {
		return this.engine.viewport.pinLeftColumns;
	}
	public set pinLeftColumns(val: number) {
		this.engine.viewport.pinLeftColumns = val;
	}

	public get pinRightColumns(): number {
		return this.engine.viewport.pinRightColumns;
	}
	public set pinRightColumns(val: number) {
		this.engine.viewport.pinRightColumns = val;
	}

	public get pinTopRows(): number {
		return this.engine.viewport.pinTopRows;
	}
	public set pinTopRows(val: number) {
		this.engine.viewport.pinTopRows = val;
	}

	public get pinBottomRows(): number {
		return this.engine.viewport.pinBottomRows;
	}
	public set pinBottomRows(val: number) {
		this.engine.viewport.pinBottomRows = val;
	}

	/**
	 * Update viewport dimensions.
	 * Returns true if the dimensions actually changed.
	 */
	public setViewportSize(width: number, height: number): boolean {
		return this.engine.viewport.setViewportSize(width, height);
	}

	/**
	 * Update scroll positions and calculate velocity vector components.
	 * Returns true if the scroll positions actually changed.
	 */
	public setScrollPosition(scrollTop: number, scrollLeft: number, timestamp: number = performance.now()): boolean {
		return this.engine.viewport.setScrollPosition(scrollTop, scrollLeft, timestamp);
	}

	/**
	 * Retrieve scroll velocity metrics.
	 */
	public getVelocity(): { vx: number; vy: number } {
		return this.engine.viewport.getVelocity();
	}

	/**
	 * Evaluates if the viewport is currently scrolling fast.
	 */
	public get isScrollingFast(): boolean {
		return this.engine.viewport.isScrollingFast;
	}

	/**
	 * Resets viewport scroll velocity to zero.
	 */
	public resetVelocity(): void {
		this.engine.viewport.resetVelocity();
	}

	/**
	 * Returns the range of active scrollable row indices within the viewport,
	 * incorporating top/bottom pinned offsets and predictive overscan.
	 */
	public getVisibleRowRange(): ViewportRange {
		return this.engine.viewport.getVisibleRowRange(this.engine.getRowModel()?.getVisualRowCount() ?? 0);
	}

	/**
	 * Returns the range of active scrollable column indices within the viewport,
	 * incorporating left/right pinned offsets and predictive overscan.
	 */
	public getVisibleColumnRange(): ViewportRange {
		// Displayed (visible, ordered) columns: hidden columns have no geometry, so counting
		// state.columns over-extends the range past the last displayed column.
		return this.engine.viewport.getVisibleColumnRange(this.engine.columns.getDisplayedColumnCount());
	}

	/**
	 * Recalculate visible ranges and update store state if they have changed.
	 * Returns true if the visible ranges actually changed.
	 */
	public updateVisibleRanges(): boolean {
		const rowRange = this.getVisibleRowRange();
		const colRange = this.getVisibleColumnRange();
		const currState = this.engine.stateManager.getState();
		const rowChanged =
			!currState.visibleRowRange ||
			currState.visibleRowRange.startIdx !== rowRange.startIdx ||
			currState.visibleRowRange.endIdx !== rowRange.endIdx;
		const colChanged =
			!currState.visibleColRange ||
			currState.visibleColRange.startIdx !== colRange.startIdx ||
			currState.visibleColRange.endIdx !== colRange.endIdx;

		if (rowChanged || colChanged) {
			this.engine.setVisibleRanges(rowRange, colRange);
			return true;
		}
		return false;
	}
}
