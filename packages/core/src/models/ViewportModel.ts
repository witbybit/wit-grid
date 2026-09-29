import type { GridEngine } from '../engine/GridEngine.js';
import type { ViewportRange } from '../viewportController.js';

export class ViewportModel<TRowData = unknown> {
	private engine!: GridEngine<TRowData>;

	public scrollTop = 0;
	public scrollLeft = 0;
	public viewportWidth = 0;
	public viewportHeight = 0;
	public scrollViewportClientWidth = 0;

	// Pinned configuration (Columns and Rows)
	public pinLeftColumns = 0;
	public pinRightColumns = 0;
	public pinTopRows = 0;
	public pinBottomRows = 0;

	// Scroll velocity tracking
	private lastTimestamp = 0;
	private velocityY = 0; // px/ms
	private velocityX = 0; // px/ms

	// Centralized velocity threshold for high-performance optimizations (px/ms)
	private readonly FAST_SCROLL_THRESHOLD = 5;

	// Adaptive overscan state. Raw velocity fluctuates on every scroll event; feeding it
	// straight into the buffer bounds shifts the render window almost every frame, which
	// defeats the sameRenderedWindow() bailout exactly when scrolling fastest. We quantize
	// the adaptive expansion to coarse buckets and only let it SHRINK after it has wanted a
	// smaller value for ADAPTIVE_SHRINK_MS (hysteresis), so the window stays stable.
	//
	// The held values advance only on scroll input (setScrollPosition) and are measured in
	// time rather than calls, so range queries stay pure no matter how many callers ask per
	// frame, and the hold behaves the same at 60, 120 and 240Hz.
	private static readonly ADAPTIVE_ROW_QUANTUM_PX = 200;
	private static readonly ADAPTIVE_COL_QUANTUM = 5;
	private static readonly ADAPTIVE_SHRINK_MS = 200;
	/** Uncapped, quantized leading-edge row expansion; the rowOverscanPx-relative cap is applied at query time. */
	private adaptiveTopPx = 0;
	private adaptiveBottomPx = 0;
	private adaptiveLeftCols = 0;
	private adaptiveRightCols = 0;
	/** Timestamp at which each held value first wanted to shrink, or -1 when not shrinking. */
	private shrinkSinceTop = -1;
	private shrinkSinceBottom = -1;
	private shrinkSinceLeft = -1;
	private shrinkSinceRight = -1;

	// Scratch out-param for the hold helper (avoids per-frame closures/objects).
	private heldShrinkSince = -1;

	/** Sign of the most recent horizontal scroll movement: 1 right (default), -1 left. */
	private lastScrollDirX = 1;

	/** Pending scroll-anchor correction for the renderer, keyed to the scrollTop it was computed at. */
	private scrollAnchorDelta = 0;
	private scrollAnchorAtTop = -1;

	/**
	 * Quantize-and-hold: grow immediately to the bucketed target, shrink only once the
	 * target has stayed smaller for ADAPTIVE_SHRINK_MS. Returns the held value; the updated
	 * shrink-start timestamp is left in this.heldShrinkSince.
	 */
	private holdAdaptive(current: number, target: number, shrinkSince: number, now: number): number {
		if (target >= current) {
			this.heldShrinkSince = -1;
			return target;
		}
		if (shrinkSince < 0) {
			this.heldShrinkSince = now;
			return current;
		}
		if (now - shrinkSince >= ViewportModel.ADAPTIVE_SHRINK_MS) {
			this.heldShrinkSince = -1;
			return target;
		}
		this.heldShrinkSince = shrinkSince;
		return current;
	}

	/** Advances the adaptive-overscan hold once per scroll input. Cheap math only, no state reads. */
	private advanceAdaptiveOverscan(now: number): void {
		const rowQuantum = ViewportModel.ADAPTIVE_ROW_QUANTUM_PX;
		const vy = this.velocityY;
		const wantBottom = vy > 0.2 ? Math.ceil((vy * 600) / rowQuantum) * rowQuantum : 0;
		const wantTop = vy < -0.2 ? Math.ceil((-vy * 600) / rowQuantum) * rowQuantum : 0;
		this.adaptiveBottomPx = this.holdAdaptive(this.adaptiveBottomPx, wantBottom, this.shrinkSinceBottom, now);
		this.shrinkSinceBottom = this.heldShrinkSince;
		this.adaptiveTopPx = this.holdAdaptive(this.adaptiveTopPx, wantTop, this.shrinkSinceTop, now);
		this.shrinkSinceTop = this.heldShrinkSince;

		const colQuantum = ViewportModel.ADAPTIVE_COL_QUANTUM;
		const vx = this.velocityX;
		const wantRight = vx > 0.2 ? Math.ceil(Math.min(15, Math.floor(vx * 10)) / colQuantum) * colQuantum : 0;
		const wantLeft = vx < -0.2 ? Math.ceil(Math.min(15, Math.floor(-vx * 10)) / colQuantum) * colQuantum : 0;
		this.adaptiveRightCols = this.holdAdaptive(this.adaptiveRightCols, wantRight, this.shrinkSinceRight, now);
		this.shrinkSinceRight = this.heldShrinkSince;
		this.adaptiveLeftCols = this.holdAdaptive(this.adaptiveLeftCols, wantLeft, this.shrinkSinceLeft, now);
		this.shrinkSinceLeft = this.heldShrinkSince;
	}

	// After this many ms with no scroll event, velocity is considered decayed to zero.
	private static readonly SCROLL_SETTLE_MS = 200;

	/**
	 * Evaluates if the grid is currently scrolling faster than the fluid performance threshold.
	 * Returns false if no scroll event has arrived in the last SCROLL_SETTLE_MS milliseconds,
	 * so the infinite row model correctly detects scroll-settle without relying on timers.
	 */
	public get isScrollingFast(): boolean {
		if (this.lastTimestamp === 0) return false;
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if (now - this.lastTimestamp > ViewportModel.SCROLL_SETTLE_MS) return false;
		return Math.abs(this.velocityY) > this.FAST_SCROLL_THRESHOLD || Math.abs(this.velocityX) > this.FAST_SCROLL_THRESHOLD;
	}

	/**
	 * Resets scroll velocity tracking back to rest (0).
	 */
	public resetVelocity(): void {
		this.velocityY = 0;
		this.velocityX = 0;
		// At rest there is no leading edge to protect: collapse the adaptive expansion.
		this.adaptiveTopPx = 0;
		this.adaptiveBottomPx = 0;
		this.adaptiveLeftCols = 0;
		this.adaptiveRightCols = 0;
		this.shrinkSinceTop = -1;
		this.shrinkSinceBottom = -1;
		this.shrinkSinceLeft = -1;
		this.shrinkSinceRight = -1;
	}

	public init(engine: GridEngine<TRowData>): void {
		this.engine = engine;
	}

	public setViewportSize(width: number, height: number): boolean {
		if (this.viewportWidth === width && this.viewportHeight === height) {
			return false;
		}
		this.viewportWidth = width;
		this.viewportHeight = height;
		return true;
	}

	public setScrollViewportClientWidth(width: number): boolean {
		if (this.scrollViewportClientWidth === width) {
			return false;
		}
		this.scrollViewportClientWidth = width;
		return true;
	}

	public setScrollPosition(scrollTop: number, scrollLeft: number, timestamp: number = performance.now()): boolean {
		if (this.scrollTop === scrollTop && this.scrollLeft === scrollLeft) {
			return false;
		}

		const timeDelta = timestamp - this.lastTimestamp;
		if (timeDelta > 0 && this.lastTimestamp > 0) {
			this.velocityY = (scrollTop - this.scrollTop) / timeDelta;
			this.velocityX = (scrollLeft - this.scrollLeft) / timeDelta;
		} else {
			this.velocityY = 0;
			this.velocityX = 0;
		}

		if (scrollLeft !== this.scrollLeft) this.lastScrollDirX = scrollLeft > this.scrollLeft ? 1 : -1;
		this.scrollTop = scrollTop;
		this.scrollLeft = scrollLeft;
		this.lastTimestamp = timestamp;
		this.advanceAdaptiveOverscan(timestamp);

		return true;
	}

	/**
	 * Index of the first scrollable row at the top of the viewport (below any pinned-top
	 * band). Pure query. Used as the anchor for scroll anchoring across row-height edits.
	 */
	public getScrollAnchorRowIndex(): number {
		const geometry = this.engine.geometry;
		const rowCount = geometry.getRowCount();
		if (rowCount === 0) return -1;
		let pinnedTopHeight = 0;
		for (let i = 0; i < this.pinTopRows && i < rowCount; i++) {
			pinnedTopHeight += geometry.rowHeights[i];
		}
		return geometry.getRowIndexAtOffset(this.scrollTop + pinnedTopHeight);
	}

	/**
	 * Records a scroll-anchor correction: rows above the visible start changed height by
	 * `delta` px, so the renderer should move scrollTop by `delta` in the same paint to keep
	 * visible content still. Corrections recorded at the same scrollTop accumulate; one
	 * recorded at a different scrollTop replaces the stale one.
	 */
	public requestScrollAnchor(delta: number): void {
		if (delta === 0) return;
		if (this.scrollAnchorAtTop !== this.scrollTop) {
			this.scrollAnchorAtTop = this.scrollTop;
			this.scrollAnchorDelta = 0;
		}
		this.scrollAnchorDelta += delta;
	}

	/**
	 * Takes the pending scroll-anchor correction. Returns 0 when there is none or when the
	 * scroll position has moved since it was recorded (the user scrolled; the anchor is stale).
	 */
	/**
	 * Moves scrollTop for an applied scroll-anchor correction. Not user scroll input, so it
	 * leaves velocity and the adaptive-overscan hold untouched.
	 */
	public applyAnchoredScrollTop(scrollTop: number): void {
		this.scrollTop = scrollTop;
	}

	public consumeScrollAnchor(currentScrollTop: number): number {
		const delta = this.scrollAnchorAtTop === currentScrollTop ? this.scrollAnchorDelta : 0;
		this.scrollAnchorDelta = 0;
		this.scrollAnchorAtTop = -1;
		return delta;
	}

	public getVelocity(): { vx: number; vy: number } {
		return { vx: this.velocityX, vy: this.velocityY };
	}

	public getVisibleRowRange(rowCount: number): ViewportRange {
		if (rowCount === 0 || this.viewportHeight === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const tops = this.engine.geometry.rowTops;
		if (tops.length === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const state = this.engine.stateManager.getState();
		const defaultRowHeight = state.defaultRowHeight ?? 40;

		// Pixel heights consumed by pinned top and bottom bands.
		// Pinned rows are always rendered and excluded from the scrollable range.
		let pinnedTopHeight = 0;
		if (this.pinTopRows > 0) {
			for (let i = 0; i < this.pinTopRows && i < rowCount; i++) {
				pinnedTopHeight += this.engine.geometry.getRowHeight(i, defaultRowHeight);
			}
		}
		let pinnedBottomHeight = 0;
		if (this.pinBottomRows > 0) {
			for (let i = 0; i < this.pinBottomRows && i < rowCount; i++) {
				pinnedBottomHeight += this.engine.geometry.getRowHeight(rowCount - 1 - i, defaultRowHeight);
			}
		}

		// Pixel boundaries of the scrollable visible area (excludes pinned bands).
		const visibleTop = this.scrollTop + pinnedTopHeight;
		const visibleBottom = this.scrollTop + this.viewportHeight - pinnedBottomHeight;

		// Pixel-first overscan: fixed px budget that scales correctly with variable row heights.
		// A tall row costs proportionally more of the budget than a short one, so the number of
		// buffered rows self-adjusts — no more under/over-shoot with variable-height grids.
		const baseOverscanPx = state.rowOverscanPx ?? 400;

		let overscanTopPx = baseOverscanPx;
		let overscanBottomPx = baseOverscanPx;

		// Adaptive mode: expand the leading edge buffer proportional to scroll velocity.
		// Cap at 2× the base so very high velocity doesn't mount an unbounded number of rows.
		// Quantized to ADAPTIVE_ROW_QUANTUM_PX buckets + shrink hysteresis so the resulting
		// render window stays identical across frames (keeps the same-window bailout alive).
		// Pure read of the held expansion; it only advances in setScrollPosition.
		if (state.overscanAdaptive) {
			const quantum = ViewportModel.ADAPTIVE_ROW_QUANTUM_PX;
			// ceil(min(a, b) / q) === min(ceil(a / q), ceil(b / q)), so capping here matches capping before quantizing.
			const cap = Math.ceil((baseOverscanPx * 2) / quantum) * quantum;
			overscanBottomPx += Math.min(cap, this.adaptiveBottomPx);
			overscanTopPx += Math.min(cap, this.adaptiveTopPx);
		}

		// Pixel boundaries of the full buffered render region.
		const bufferTopPx = Math.max(0, visibleTop - overscanTopPx);
		const bufferBottomPx = visibleBottom + overscanBottomPx;

		// O(log R) binary searches to map pixel bounds → row indices.
		const startIdx = Math.max(this.pinTopRows, this.engine.geometry.getRowIndexAtOffset(bufferTopPx));
		const endIdx = Math.min(rowCount - 1 - this.pinBottomRows, this.engine.geometry.getRowIndexAtOffset(bufferBottomPx));

		return { startIdx, endIdx };
	}

	public getVisibleColumnRange(colCount: number): ViewportRange {
		if (colCount === 0 || this.viewportWidth === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const lefts = this.engine.geometry.colLefts;
		if (lefts.length === 0) {
			return { startIdx: 0, endIdx: 0 };
		}

		const state = this.engine.stateManager.getState();
		const geometry = this.engine.geometry;
		const defaultColWidth = state.defaultColWidth;

		// Calculate width occupied by pinned left and right lanes
		let pinnedLeftWidth = 0;
		for (let i = 0; i < this.pinLeftColumns && i < colCount; i++) {
			pinnedLeftWidth += geometry.getColWidth(i, defaultColWidth);
		}

		let pinnedRightWidth = 0;
		for (let i = 0; i < this.pinRightColumns && i < colCount; i++) {
			pinnedRightWidth += geometry.getColWidth(colCount - 1 - i, defaultColWidth);
		}

		const visibleLeft = this.scrollLeft + pinnedLeftWidth;
		const visibleWidth = this.scrollViewportClientWidth || this.viewportWidth;
		const visibleRight = this.scrollLeft + visibleWidth - pinnedRightWidth;

		// Perform O(log C) binary searches on GeometryModel
		const activeStartIdx = geometry.getColIndexAtOffset(visibleLeft);
		const activeEndIdx = geometry.getColIndexAtOffset(visibleRight);

		// Predictive overscan: count-based on both edges.
		const colBuffer = state.colBuffer ?? 2;
		let overscanLeft = colBuffer;
		let overscanRight = colBuffer;

		if (state.overscanAdaptive) {
			// Same quantize-and-hold as the row path (held in setScrollPosition): keeps the column window stable.
			overscanRight += this.adaptiveRightCols;
			overscanLeft += this.adaptiveLeftCols;
		}

		let startIdx = activeStartIdx - overscanLeft;
		let endIdx = activeEndIdx + overscanRight;

		// Pixel overscan on the leading edge (scroll direction): at least colOverscanPx of
		// columns beyond the visible edge, so a buffer of narrow columns is not exhausted by a
		// single wheel tick. Takes the max with the count-based buffer, never less.
		const overscanPx = state.colOverscanPx ?? 0;
		if (overscanPx > 0) {
			if (this.lastScrollDirX >= 0) {
				endIdx = Math.max(endIdx, geometry.getColIndexAtOffset(visibleRight + overscanPx));
			} else {
				startIdx = Math.min(startIdx, geometry.getColIndexAtOffset(Math.max(0, visibleLeft - overscanPx)));
			}
		}

		startIdx = Math.max(this.pinLeftColumns, startIdx);
		endIdx = Math.min(colCount - 1 - this.pinRightColumns, endIdx);

		return { startIdx, endIdx };
	}
}
