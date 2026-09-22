import type { GridEngine } from '../engine/GridEngine.js';

import { asStickyGroupMetaCapableVisualRowModel } from '../rowModel.js';

export interface StickyGroupStackItem {
	groupId: string;
	visualIndex: number;
	depth: number;
	top: number;
	height: number;
	lastDescendantIndex: number;
	boundaryBottom: number;
	pushed: boolean;
}

export interface RenderWindow {
	rowStart: number;
	rowEnd: number;
	colStart: number;
	colEnd: number;
	pinLeftCols: number;
	pinRightCols: number;
	pinTopRows: number;
	pinBottomRows: number;
	rowCount: number;
	colCount: number;
	scrollTop: number;
	scrollLeft: number;
	viewportWidth: number;
	viewportHeight: number;
	geometryVersion?: number;
	rowModelVersion?: number;
	columnVersion?: number;
	// Pixel-first windowing fields
	/** Top pixel of the visible (non-pinned) area, accounting for pinned top rows. */
	visibleTop?: number;
	/** Bottom pixel of the visible area, accounting for pinned bottom rows. */
	visibleBottom?: number;
	/** Top pixel of the fully-buffered render region (includes overscan above visible). */
	bufferTopPx?: number;
	/** Bottom pixel of the fully-buffered render region (includes overscan below visible). */
	bufferBottomPx?: number;
	/** First non-pinned row index whose pixels overlap the visible viewport band. */
	visibleRowStart?: number;
	/** Last non-pinned row index whose pixels overlap the visible viewport band. */
	visibleRowEnd?: number;
	/** First non-pinned displayed column index whose pixels overlap the visible viewport band. */
	visibleColStart?: number;
	/** Last non-pinned displayed column index whose pixels overlap the visible viewport band. */
	visibleColEnd?: number;
	// Sticky group rows — group rows that have scrolled above the viewport but whose
	// descendants are still visible. Rendered at the top of the viewport, stacked by depth.
	// Each entry contains the visual index, pixel position, and boundary metadata.
	stickyGroupStack?: StickyGroupStackItem[];
}

export interface ViewportDelta {
	rowsEntered: number[];
	rowsExited: number[];
	rowsStayed: number[];
	colsEntered: number[];
	colsExited: number[];
	colsStayed: number[];
	hasChanges: boolean;
}

function getStickyGroupMeta(rowModel: import('../rowModel.js').VisualRowModel<unknown> | null): Map<number, number> | null {
	return asStickyGroupMetaCapableVisualRowModel(rowModel)?.getStickyGroupMeta() ?? null;
}

/** Element-wise equality for sticky stack membership/state; pixel movement is handled by the sticky layer. */
function sameStickyStack(a: StickyGroupStackItem[] | undefined, b: StickyGroupStackItem[] | undefined): boolean {
	const an = a ? a.length : 0;
	const bn = b ? b.length : 0;
	if (an !== bn) return false;
	for (let i = 0; i < an; i++) {
		if (a![i].visualIndex !== b![i].visualIndex) return false;
		if (a![i].height !== b![i].height) return false;
		if (a![i].depth !== b![i].depth) return false;
		if (a![i].pushed !== b![i].pushed) return false;
	}
	return true;
}

export function sameRenderedWindow(a: RenderWindow | null, b: RenderWindow | null): boolean {
	if (!a || !b) return false;
	return (
		a.rowStart === b.rowStart &&
		a.rowEnd === b.rowEnd &&
		a.colStart === b.colStart &&
		a.colEnd === b.colEnd &&
		a.pinLeftCols === b.pinLeftCols &&
		a.pinRightCols === b.pinRightCols &&
		a.pinTopRows === b.pinTopRows &&
		a.pinBottomRows === b.pinBottomRows &&
		a.rowCount === b.rowCount &&
		a.colCount === b.colCount &&
		(a.geometryVersion ?? 0) === (b.geometryVersion ?? 0) &&
		(a.rowModelVersion ?? 0) === (b.rowModelVersion ?? 0) &&
		(a.columnVersion ?? 0) === (b.columnVersion ?? 0) &&
		sameStickyStack(a.stickyGroupStack, b.stickyGroupStack)
	);
}

export function sameVisibleContentWindow(a: RenderWindow | null, b: RenderWindow | null): boolean {
	if (!a || !b) return false;
	return (
		(a.visibleRowStart ?? -1) === (b.visibleRowStart ?? -1) &&
		(a.visibleRowEnd ?? -1) === (b.visibleRowEnd ?? -1) &&
		(a.visibleColStart ?? -1) === (b.visibleColStart ?? -1) &&
		(a.visibleColEnd ?? -1) === (b.visibleColEnd ?? -1)
	);
}

// Dev warning latch — the clamp warning fires once per session instead of per frame.
let clampWarned = false;

export interface RenderWindowRuntimeLimits {
	maxRenderedRows?: number;
	maxRenderedCells?: number;
	suppressRenderedRangeLimit?: boolean;
}

// Cached array form of the sticky-group meta Map. A new Map instance is built on every
// row-model refresh, so Map identity doubles as the version key. Arrays let the per-frame
// sticky walk binary-search instead of iterating Map entries.
const stickyMetaArraysCache = new WeakMap<Map<number, number>, { idx: number[]; last: number[] }>();

function getStickyMetaArrays(meta: Map<number, number>): { idx: number[]; last: number[] } {
	let arrays = stickyMetaArraysCache.get(meta);
	if (!arrays) {
		const idx = new Array<number>(meta.size);
		const last = new Array<number>(meta.size);
		let i = 0;
		for (const [groupIdx, lastDescIdx] of meta) {
			idx[i] = groupIdx;
			last[i] = lastDescIdx;
			i++;
		}
		arrays = { idx, last };
		stickyMetaArraysCache.set(meta, arrays);
	}
	return arrays;
}

/** First index in `sorted` (ascending) whose value is > `value`, searching from `lo`. */
function firstIndexAfter(sorted: number[], value: number, lo: number): number {
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] <= value) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function countPinnedLeading(count: number, total: number): number {
	return Math.max(0, Math.min(count, total));
}

function countPinnedTrailing(count: number, total: number, leading: number): number {
	return Math.max(0, Math.min(count, Math.max(0, total - leading)));
}

/**
 * Row indices rendered for this window. Pass `out` to reuse a scratch array on hot
 * paths (it is cleared and refilled; valid until the next call with the same array).
 */
/**
 * `extraRowIndices` — additional row indices to force into the result beyond the normal
 * pinned/rowStart..rowEnd/pinned ranges (see rowWindowRetention.ts's vertical focus/edit
 * retention). Purely additive: every existing zero-arg call site is unaffected. Merged in
 * ascending order alongside the rest of the array — callers historically treat the result as
 * sorted (it drives 1:1 slot-index assignment), so this preserves that invariant rather than
 * just appending at the end.
 */
export function getRowIndices(w: RenderWindow, out?: number[], extraRowIndices?: ReadonlySet<number>): number[] {
	const pinTop = Math.min(w.pinTopRows, w.rowCount);
	const pinBottomStart = Math.max(pinTop, w.rowCount - w.pinBottomRows);

	const indices: number[] = out ?? [];
	indices.length = 0;

	for (let r = 0; r < pinTop; r++) indices.push(r);
	if (extraRowIndices && extraRowIndices.size > 0) {
		// Merge extras that fall before rowStart, in ascending order, ahead of the center range.
		const before = [...extraRowIndices].filter((r) => r < w.rowStart && r >= pinTop).sort((a, b) => a - b);
		for (const r of before) indices.push(r);
	}
	for (let r = w.rowStart; r <= w.rowEnd; r++) {
		if (r >= pinTop && r < pinBottomStart) indices.push(r);
	}
	if (extraRowIndices && extraRowIndices.size > 0) {
		const after = [...extraRowIndices].filter((r) => r > w.rowEnd && r < pinBottomStart).sort((a, b) => a - b);
		for (const r of after) indices.push(r);
	}
	for (let r = pinBottomStart; r < w.rowCount; r++) indices.push(r);
	return indices;
}

export function getColIndices(w: RenderWindow): number[] {
	const pinLeft = Math.min(w.pinLeftCols, w.colCount);
	const pinRightStart = Math.max(pinLeft, w.colCount - w.pinRightCols);
	const indices: number[] = [];
	// Pinned left
	for (let c = 0; c < pinLeft; c++) indices.push(c);
	// Center scrollable
	for (let c = w.colStart; c <= w.colEnd; c++) {
		if (c >= pinLeft && c < pinRightStart) indices.push(c);
	}
	// Pinned right
	for (let c = pinRightStart; c < w.colCount; c++) indices.push(c);
	return indices;
}

export function applyRenderWindowRuntimeLimits(window: RenderWindow, limits?: RenderWindowRuntimeLimits, onClamp?: () => void): RenderWindow {
	if (limits?.suppressRenderedRangeLimit) return window;

	const maxRenderedRows = limits?.maxRenderedRows ?? 500;
	const maxRenderedCells = limits?.maxRenderedCells ?? 20000;

	// Quick-exit: approximate bounds check before any object allocation.
	// This is the common path — most frames are within limits.
	const approxCenterRows = Math.max(0, window.rowEnd - window.rowStart + 1);
	const approxCenterCols = Math.max(0, window.colEnd - window.colStart + 1);
	const approxTotalRows = window.pinTopRows + approxCenterRows + window.pinBottomRows;
	const approxTotalCols = window.pinLeftCols + approxCenterCols + window.pinRightCols;
	if (approxTotalRows <= maxRenderedRows && approxTotalRows * approxTotalCols <= maxRenderedCells) {
		return window;
	}

	const next = { ...window };
	// The stickyGroupStack on `window` is per-double-buffer scratch reused every frame —
	// the clamped window outlives the frame, so it needs its own deep copy.
	next.stickyGroupStack = window.stickyGroupStack ? window.stickyGroupStack.map((item) => ({ ...item })) : undefined;
	let clamped = false;

	const pinTopRows = countPinnedLeading(next.pinTopRows, next.rowCount);
	const pinBottomRows = countPinnedTrailing(next.pinBottomRows, next.rowCount, pinTopRows);
	const centerRowMin = pinTopRows;
	const centerRowMax = next.rowCount - pinBottomRows - 1;

	if (centerRowMax >= centerRowMin) {
		next.rowStart = Math.max(centerRowMin, Math.min(next.rowStart, centerRowMax));
		next.rowEnd = Math.max(next.rowStart, Math.min(next.rowEnd, centerRowMax));

		if (maxRenderedRows > 0) {
			const pinnedRows = pinTopRows + pinBottomRows;
			const centerBudget = Math.max(1, maxRenderedRows - pinnedRows);
			const expectedRowEnd = Math.max(next.rowStart, Math.min(next.rowEnd, next.rowStart + centerBudget - 1));
			if (expectedRowEnd < next.rowEnd) {
				next.rowEnd = expectedRowEnd;
				clamped = true;
			}
		}
	} else {
		next.rowStart = 0;
		next.rowEnd = 0;
	}

	const pinLeftCols = countPinnedLeading(next.pinLeftCols, next.colCount);
	const pinRightCols = countPinnedTrailing(next.pinRightCols, next.colCount, pinLeftCols);
	const centerColMin = pinLeftCols;
	const centerColMax = next.colCount - pinRightCols - 1;

	if (centerColMax >= centerColMin) {
		next.colStart = Math.max(centerColMin, Math.min(next.colStart, centerColMax));
		next.colEnd = Math.max(next.colStart, Math.min(next.colEnd, centerColMax));

		if (maxRenderedCells > 0) {
			const renderedRows = Math.max(1, getRowIndices(next).length);
			const pinnedCols = pinLeftCols + pinRightCols;
			const totalColsBudget = Math.max(1, Math.floor(maxRenderedCells / renderedRows));
			const centerBudget = Math.max(1, totalColsBudget - pinnedCols);
			const expectedColEnd = Math.max(next.colStart, Math.min(next.colEnd, next.colStart + centerBudget - 1));
			if (expectedColEnd < next.colEnd) {
				next.colEnd = expectedColEnd;
				clamped = true;
			}
		}
	} else {
		next.colStart = 0;
		next.colEnd = 0;
	}

	if (clamped) {
		// Warn once per session, not per frame — while clamped, every scroll frame hits
		// this path and the template literal alone evaluates getRow/ColIndices four times.
		if (!clampWarned && (typeof (globalThis as any).process === 'undefined' || (globalThis as any).process?.env?.NODE_ENV !== 'production')) {
			clampWarned = true;
			console.warn(
				`[WitGrid] Render limits exceeded. Clamped rendering window: rows=${getRowIndices(next).length}/${getRowIndices(window).length}, cells=${getRowIndices(next).length * getColIndices(next).length}/${getRowIndices(window).length * getColIndices(window).length}.`
			);
		}
		if (onClamp) {
			onClamp();
		}
	}

	return next;
}

/** Create a zeroed RenderWindow for use as a pre-allocated double-buffer slot. */
export function createEmptyRenderWindow(): RenderWindow {
	return {
		rowStart: 0,
		rowEnd: 0,
		colStart: 0,
		colEnd: 0,
		pinLeftCols: 0,
		pinRightCols: 0,
		pinTopRows: 0,
		pinBottomRows: 0,
		rowCount: 0,
		colCount: 0,
		scrollTop: 0,
		scrollLeft: 0,
		viewportWidth: 0,
		viewportHeight: 0,
		geometryVersion: 0,
		rowModelVersion: 0,
		columnVersion: 0,
		visibleTop: 0,
		visibleBottom: 0,
		bufferTopPx: 0,
		bufferBottomPx: 0,
		visibleRowStart: -1,
		visibleRowEnd: -1,
		visibleColStart: -1,
		visibleColEnd: -1,
	};
}

/**
 * Fill `target` with the current render window values in-place.
 * Used by the double-buffer hot path in RenderEngine to avoid per-frame allocation.
 * Callers must NOT store a reference to `target` across calls — its fields are
 * overwritten every frame.
 */
export function computeRenderWindowInto<TRowData>(engine: GridEngine<TRowData>, target: RenderWindow): void {
	const rowModel = engine.getVisualRowModel();
	let rowCount = rowModel ? rowModel.getVisualRowCount() : 0;
	const state = engine.stateManager.getState();
	if (state.loading && rowCount === 0) {
		rowCount = state.loadingSkeletonCount ?? 15;
	}
	const colCount = engine.columns.getDisplayedColumnCount();

	const pinLeftCols = engine.viewport.pinLeftColumns;
	const pinRightCols = engine.viewport.pinRightColumns;
	const pinTopRows = engine.viewport.pinTopRows;
	const pinBottomRows = engine.viewport.pinBottomRows;

	const newRowRange = engine.viewport.getVisibleRowRange(rowCount);
	const newColRange = engine.viewport.getVisibleColumnRange(colCount);

	// Pixel annotations for the rendered window — used by downstream systems (e.g. overlay positioning).
	const defaultRowHeight = state.defaultRowHeight ?? 40;
	let pinnedTopHeight = 0;
	for (let i = 0; i < pinTopRows && i < rowCount; i++) {
		pinnedTopHeight += engine.geometry.getRowHeight(i, defaultRowHeight);
	}
	let pinnedBottomHeight = 0;
	for (let i = 0; i < pinBottomRows && i < rowCount; i++) {
		pinnedBottomHeight += engine.geometry.getRowHeight(rowCount - 1 - i, defaultRowHeight);
	}
	const scrollTop = engine.viewport.scrollTop;
	const viewportHeight = engine.viewport.viewportHeight;
	const visibleTop = scrollTop + pinnedTopHeight;
	const visibleBottom = scrollTop + viewportHeight - pinnedBottomHeight;
	const visibleRowStart = rowCount > pinTopRows + pinBottomRows ? Math.max(pinTopRows, engine.geometry.getRowIndexAtOffset(visibleTop)) : -1;
	const visibleRowEnd =
		rowCount > pinTopRows + pinBottomRows
			? Math.min(rowCount - 1 - pinBottomRows, engine.geometry.getRowIndexAtOffset(Math.max(visibleTop, visibleBottom - 1)))
			: -1;

	// Buffer pixel bounds: the actual pixel span of the first/last rendered rows.
	const bufferTopPx = newRowRange.startIdx >= 0 ? engine.geometry.getRowTop(newRowRange.startIdx, defaultRowHeight) : visibleTop;
	const lastRenderedBottom = newRowRange.endIdx >= 0 ? engine.geometry.getRowBottom(newRowRange.endIdx, defaultRowHeight) : visibleBottom;
	const centerViewportLeft = engine.viewport.scrollLeft;
	const centerViewportRight = engine.viewport.scrollLeft + engine.viewport.viewportWidth;
	const visibleColStart =
		colCount > pinLeftCols + pinRightCols ? Math.max(pinLeftCols, engine.geometry.getColIndexAtOffset(centerViewportLeft)) : -1;
	const visibleColEnd =
		colCount > pinLeftCols + pinRightCols
			? Math.min(colCount - 1 - pinRightCols, engine.geometry.getColIndexAtOffset(Math.max(centerViewportLeft, centerViewportRight - 1)))
			: -1;

	// Sticky group rows: groups whose natural top is above visibleTop but whose last
	// descendant is still at or below visibleTop — they "stick" to the viewport top.
	// Reuse the target array across frames (zero per-frame allocation); it is
	// per-double-buffer so mutation never aliases the currently-rendered window.
	const stickyGroupStack = target.stickyGroupStack ?? (target.stickyGroupStack = []);
	stickyGroupStack.length = 0;

	if (state.enableStickyGroupRows && rowCount > 0) {
		const stickyMeta = getStickyGroupMeta(rowModel);
		if (stickyMeta && stickyMeta.size > 0) {
			// stickyMeta is built during the DFS flatten, so group indices — and therefore
			// group tops — ascend in iteration order. That allows two cuts vs scanning every
			// group per frame: break once groupTop >= visibleTop (no later group can be
			// sticky), and when a subtree ends above the viewport, binary-search past all
			// groups inside it instead of visiting them.
			const meta = getStickyMetaArrays(stickyMeta);
			const groupIdxs = meta.idx;
			const lastIdxs = meta.last;
			let stickyOffset = 0;
			let i = 0;
			const n = groupIdxs.length;
			while (i < n) {
				const groupIdx = groupIdxs[i];
				if (groupIdx >= rowCount) break; // ascending — all later are out of range too
				const groupTop = engine.geometry.getRowTop(groupIdx, defaultRowHeight);
				if (groupTop >= visibleTop) break; // ascending tops — nothing later can be sticky
				const lastDescIdx = lastIdxs[i];
				if (lastDescIdx >= rowCount) {
					i++;
					continue;
				}
				const boundaryBottom = engine.geometry.getRowBottom(lastDescIdx, defaultRowHeight);
				if (boundaryBottom > visibleTop) {
					// Sticky: descend into this subtree (its children follow in DFS order).
					const desiredTop = visibleTop + stickyOffset;
					const rowHeight = engine.geometry.getRowHeight(groupIdx, defaultRowHeight);
					const stickyTop = Math.min(desiredTop, boundaryBottom - rowHeight);
					const visualRow = rowModel?.getVisualRow(groupIdx);
					if (visualRow?.kind === 'group') {
						stickyGroupStack.push({
							groupId: visualRow.groupId,
							visualIndex: groupIdx,
							depth: visualRow.depth,
							top: stickyTop,
							height: rowHeight,
							lastDescendantIndex: lastDescIdx,
							boundaryBottom,
							pushed: stickyTop < desiredTop,
						});
					}
					stickyOffset += rowHeight;
					i++;
				} else {
					// Whole subtree ends above the viewport — skip every group inside it.
					i = firstIndexAfter(groupIdxs, lastDescIdx, i + 1);
				}
			}
		}
	}

	target.rowStart = newRowRange.startIdx;
	target.rowEnd = newRowRange.endIdx;
	target.colStart = newColRange.startIdx;
	target.colEnd = newColRange.endIdx;
	target.pinLeftCols = pinLeftCols;
	target.pinRightCols = pinRightCols;
	target.pinTopRows = pinTopRows;
	target.pinBottomRows = pinBottomRows;
	target.rowCount = rowCount;
	target.colCount = colCount;
	target.scrollTop = scrollTop;
	target.scrollLeft = engine.viewport.scrollLeft;
	target.viewportWidth = engine.viewport.viewportWidth;
	target.viewportHeight = viewportHeight;
	target.geometryVersion = (engine as any).geometryVersion ?? 0;
	target.rowModelVersion = (engine as any).rowModelVersion ?? 0;
	target.columnVersion = (engine as any).columnVersion ?? 0;
	target.visibleTop = visibleTop;
	target.visibleBottom = visibleBottom;
	target.bufferTopPx = bufferTopPx;
	target.bufferBottomPx = lastRenderedBottom;
	target.visibleRowStart = visibleRowStart;
	target.visibleRowEnd = visibleRowEnd;
	target.visibleColStart = visibleColStart;
	target.visibleColEnd = visibleColEnd;
}

export function computeRenderWindow<TRowData>(engine: GridEngine<TRowData>): RenderWindow {
	const target = createEmptyRenderWindow();
	computeRenderWindowInto(engine, target);
	return target;
}

/** Create an empty ViewportDelta for use as a caller-owned reusable scratch. */
export function createEmptyViewportDelta(): ViewportDelta {
	return { rowsEntered: [], rowsExited: [], rowsStayed: [], colsEntered: [], colsExited: [], colsStayed: [], hasChanges: false };
}

/**
 * Diff two render windows. Pass `out` (a caller-owned ViewportDelta) on hot paths to
 * reuse its arrays instead of allocating six per call — the result is then valid only
 * until the next call with the same `out`.
 */
export function diffRenderWindow(prev: RenderWindow | null, next: RenderWindow, out?: ViewportDelta): ViewportDelta {
	if (!prev) {
		const nextRows = getRowIndices(next);
		const nextCols = getColIndices(next);
		return {
			rowsEntered: nextRows,
			rowsExited: [],
			rowsStayed: nextRows,
			colsEntered: nextCols,
			colsExited: [],
			colsStayed: nextCols,
			hasChanges: true,
		};
	}

	const d = out ?? createEmptyViewportDelta();
	const rowsEntered = d.rowsEntered;
	const rowsExited = d.rowsExited;
	const rowsStayed = d.rowsStayed;
	const colsEntered = d.colsEntered;
	const colsExited = d.colsExited;
	const colsStayed = d.colsStayed;
	rowsEntered.length = 0;
	rowsExited.length = 0;
	rowsStayed.length = 0;
	colsEntered.length = 0;
	colsExited.length = 0;
	colsStayed.length = 0;

	// Fast path: contiguous center ranges when geometry and pinned lanes are unchanged
	if (
		prev.pinTopRows === next.pinTopRows &&
		prev.pinBottomRows === next.pinBottomRows &&
		prev.rowCount === next.rowCount &&
		prev.pinLeftCols === next.pinLeftCols &&
		prev.pinRightCols === next.pinRightCols &&
		prev.colCount === next.colCount
	) {
		const pinTop = next.pinTopRows;
		const pinBottom = next.pinBottomRows;
		const rowCount = next.rowCount;

		// Pinned top
		for (let r = 0; r < pinTop && r < rowCount; r++) {
			rowsStayed.push(r);
		}

		// Center scrollable rows bounds
		const prevStart = Math.max(pinTop, prev.rowStart);
		const prevEnd = Math.min(rowCount - 1 - pinBottom, prev.rowEnd);
		const nextStart = Math.max(pinTop, next.rowStart);
		const nextEnd = Math.min(rowCount - 1 - pinBottom, next.rowEnd);

		if (prevStart <= prevEnd && nextStart <= nextEnd) {
			const stayedStart = Math.max(prevStart, nextStart);
			const stayedEnd = Math.min(prevEnd, nextEnd);

			if (stayedStart <= stayedEnd) {
				for (let r = stayedStart; r <= stayedEnd; r++) {
					rowsStayed.push(r);
				}
				if (nextStart < prevStart) {
					for (let r = nextStart; r < prevStart; r++) {
						rowsEntered.push(r);
					}
				}
				if (nextEnd > prevEnd) {
					for (let r = prevEnd + 1; r <= nextEnd; r++) {
						rowsEntered.push(r);
					}
				}
				if (nextStart > prevStart) {
					for (let r = prevStart; r < nextStart; r++) {
						rowsExited.push(r);
					}
				}
				if (nextEnd < prevEnd) {
					for (let r = nextEnd + 1; r <= prevEnd; r++) {
						rowsExited.push(r);
					}
				}
			} else {
				for (let r = nextStart; r <= nextEnd; r++) {
					rowsEntered.push(r);
				}
				for (let r = prevStart; r <= prevEnd; r++) {
					rowsExited.push(r);
				}
			}
		} else if (nextStart <= nextEnd) {
			for (let r = nextStart; r <= nextEnd; r++) {
				rowsEntered.push(r);
			}
		} else if (prevStart <= prevEnd) {
			for (let r = prevStart; r <= prevEnd; r++) {
				rowsExited.push(r);
			}
		}

		// Pinned bottom
		const pinBottomStart = Math.max(0, rowCount - pinBottom);
		for (let r = pinBottomStart; r < rowCount; r++) {
			if (r >= pinTop) {
				rowsStayed.push(r);
			}
		}

		// Columns
		const pinLeft = next.pinLeftCols;
		const pinRight = next.pinRightCols;
		const colCount = next.colCount;

		// Pinned left
		for (let c = 0; c < pinLeft && c < colCount; c++) {
			colsStayed.push(c);
		}

		const prevColStart = Math.max(pinLeft, prev.colStart);
		const prevColEnd = Math.min(colCount - 1 - pinRight, prev.colEnd);
		const nextColStart = Math.max(pinLeft, next.colStart);
		const nextColEnd = Math.min(colCount - 1 - pinRight, next.colEnd);

		if (prevColStart <= prevColEnd && nextColStart <= nextColEnd) {
			const stayedStart = Math.max(prevColStart, nextColStart);
			const stayedEnd = Math.min(prevColEnd, nextColEnd);

			if (stayedStart <= stayedEnd) {
				for (let c = stayedStart; c <= stayedEnd; c++) {
					colsStayed.push(c);
				}
				if (nextColStart < prevColStart) {
					for (let c = nextColStart; c < prevColStart; c++) {
						colsEntered.push(c);
					}
				}
				if (nextColEnd > prevColEnd) {
					for (let c = prevColEnd + 1; c <= nextColEnd; c++) {
						colsEntered.push(c);
					}
				}
				if (nextColStart > prevColStart) {
					for (let c = prevColStart; c < nextColStart; c++) {
						colsExited.push(c);
					}
				}
				if (nextColEnd < prevColEnd) {
					for (let c = nextColEnd + 1; c <= prevColEnd; c++) {
						colsExited.push(c);
					}
				}
			} else {
				for (let c = nextColStart; c <= nextColEnd; c++) {
					colsEntered.push(c);
				}
				for (let c = prevColStart; c <= prevColEnd; c++) {
					colsExited.push(c);
				}
			}
		} else if (nextColStart <= nextColEnd) {
			for (let c = nextColStart; c <= nextColEnd; c++) {
				colsEntered.push(c);
			}
		} else if (prevColStart <= prevColEnd) {
			for (let c = prevColStart; c <= prevColEnd; c++) {
				colsExited.push(c);
			}
		}

		// Pinned right
		const pinRightStart = Math.max(0, colCount - pinRight);
		for (let c = pinRightStart; c < colCount; c++) {
			if (c >= pinLeft) {
				colsStayed.push(c);
			}
		}

		d.hasChanges =
			rowsEntered.length > 0 ||
			rowsExited.length > 0 ||
			colsEntered.length > 0 ||
			colsExited.length > 0 ||
			((next.pinTopRows > 0 || next.pinBottomRows > 0) && prev.scrollTop !== next.scrollTop);

		return d;
	}

	const prevRows = getRowIndices(prev);
	const nextRows = getRowIndices(next);
	const prevCols = getColIndices(prev);
	const nextCols = getColIndices(next);

	// One reusable Set for membership tests — cleared between row and col phases
	const scratch = new Set<number>();

	for (const r of prevRows) scratch.add(r);
	for (const r of nextRows) (scratch.has(r) ? rowsStayed : rowsEntered).push(r);
	scratch.clear();
	for (const r of nextRows) scratch.add(r);
	for (const r of prevRows) if (!scratch.has(r)) rowsExited.push(r);

	scratch.clear();
	for (const c of prevCols) scratch.add(c);
	for (const c of nextCols) (scratch.has(c) ? colsStayed : colsEntered).push(c);
	scratch.clear();
	for (const c of nextCols) scratch.add(c);
	for (const c of prevCols) if (!scratch.has(c)) colsExited.push(c);

	d.hasChanges =
		rowsEntered.length > 0 ||
		rowsExited.length > 0 ||
		colsEntered.length > 0 ||
		colsExited.length > 0 ||
		prev.pinLeftCols !== next.pinLeftCols ||
		prev.pinRightCols !== next.pinRightCols ||
		prev.pinTopRows !== next.pinTopRows ||
		prev.pinBottomRows !== next.pinBottomRows ||
		((next.pinTopRows > 0 || next.pinBottomRows > 0) && prev.scrollTop !== next.scrollTop);

	return d;
}
