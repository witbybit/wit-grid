import type { GridEngine } from '../engine/GridEngine.js';
import { computeRenderWindow, type RenderWindow, type StickySection } from './renderWindow.js';
import type { InternalColumnDef } from '../columnDef.js';
import { getMemoizedColumnTopology, type CompiledColumnTopology } from './columnTopology.js';
import { normalizeCapabilityResult } from '../capabilities/capabilityTypes.js';
import { summarizeAnalysisState } from '../analysis/analysisState.js';
import type { InternalGridState } from '../state/GridState.js';

export const LEAF_HEADER_HEIGHT = 40;
export const GROUP_PANEL_HEIGHT = 42;
export const FILTER_CHIP_BAR_HEIGHT = 32;
export const GROUP_BAND_HEIGHT = 32;
export const STATUS_BAR_HEIGHT = 32;
export const PAGINATION_HEIGHT = 44;
export const FLOATING_FILTER_HEIGHT = 36;

export interface HeaderCellLayout {
	id: string;
	field: string;
	label: string;
	depth: number;
	colStart: number;
	colEnd: number;
	left: number;
	width: number;
	top: number;
	height: number;
	pinned: 'left' | 'center' | 'right';
	isLeaf: boolean;
	movable: boolean;
	resizable: boolean;
	sortable: boolean;
	checkboxSelection: boolean;
}

export interface HeaderBandLayout {
	depth: number;
	top: number;
	height: number;
	cells: HeaderCellLayout[];
}

/**
 * One horizontal pin lane. `baseLeft` is the absolute X (in content coordinates) where
 * the lane's columns begin — the single value used to convert an absolute `colLefts[c]`
 * into a lane-relative offset. Header and body both read this so they cannot drift, and
 * a pin/unpin animation has one geometry to interpolate.
 */
export interface ColumnLane {
	width: number;
	baseLeft: number;
	/** First/last displayed column index in this lane, or -1 when the lane is empty. */
	colStart: number;
	colEnd: number;
}

export interface ColumnLanes {
	left: ColumnLane;
	center: ColumnLane;
	right: ColumnLane;
}

export interface GridLayoutPlan {
	viewport: {
		width: number;
		clientWidth: number;
		height: number;
		scrollTop: number;
		scrollLeft: number;
	};
	dimensions: {
		totalRowsHeight: number;
		totalColumnsWidth: number;
		contentWidth: number;
		contentHeight: number;
	};
	chrome: {
		groupPanelHeight: number;
		filterChipBarHeight: number;
		columnGroupHeaderHeight: number;
		leafHeaderHeight: number;
		totalHeaderHeight: number;
		/** Height of the floating filter row in px. 0 when showFloatingFilters is false. */
		floatingFilterHeight: number;
		topChromeHeight: number;
		// Bottom chrome — fixed bars docked below the scroll viewport. Default 0 when
		// no status bar / pagination is configured (no layout change vs. top-only era).
		statusBarHeight: number;
		paginationHeight: number;
		bottomChromeHeight: number;
	};
	rows: {
		rowStart: number;
		rowEnd: number;
		pinnedTopCount: number;
		pinnedBottomCount: number;
		pinnedTopHeight: number;
		pinnedBottomHeight: number;
		visibleTop: number;
		visibleBottom: number;
		bufferTopPx: number;
		bufferBottomPx: number;
	};
	columns: {
		colStart: number;
		colEnd: number;
		pinLeftCount: number;
		pinRightCount: number;
		pinLeftWidth: number;
		pinRightWidth: number;
		centerWidth: number;
		lanes: ColumnLanes;
	};
	origins: {
		headerTop: number;
		rowLayerTop: number;
		stickyGroupLayerTop: number;
		overlayTop: number;
		// Bottom chrome origins, measured from the top of the grid container.
		// bottomChromeTop = viewport.height - bottomChromeHeight.
		bottomChromeTop: number;
		statusBarTop: number;
		paginationTop: number;
	};
	headerBands: HeaderBandLayout[];
	stickySections: StickySection[];
	renderWindow: RenderWindow;
	/** Authoritative column topology: lane membership, lane-relative offsets, group segments. */
	columnTopology: CompiledColumnTopology;
}

/**
 * Rounds a translate offset to the nearest device pixel so per-frame repositioned chrome
 * (selection overlay, pinned rows, sticky group rows) does not shimmer across sub-pixel
 * positions while scrolling. Falls back to CSS pixels when there is no window.
 */
export function snapToDevicePixel(value: number): number {
	const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
	return Math.round(value * dpr) / dpr;
}

export function getRightPinnedLaneScreenLeft(layoutPlan: GridLayoutPlan): number {
	return layoutPlan.viewport.clientWidth - layoutPlan.columns.lanes.right.width;
}

/**
 * Builds HeaderBandLayout[] from the compiled column topology (WS10).
 * All `left` values are lane-relative offsets — the renderer uses them directly
 * without any per-lane subtraction.
 */
function buildHeaderBands<TRowData>(
	topology: CompiledColumnTopology,
	columns: readonly InternalColumnDef<TRowData>[],
	leafHeaderHeight: number,
	enableColumnReorder: boolean,
	defaultColWidth: number
): HeaderBandLayout[] {
	const maxGroupDepth = topology.groupSegments.length;
	const groupBandsHeight = maxGroupDepth * GROUP_BAND_HEIGHT;
	const leafBandTop = groupBandsHeight;

	// Leaf band — laneOffset is already lane-relative for all three lanes.
	const leafCells: HeaderCellLayout[] = topology.placements.map((placement) => {
		const col = columns[placement.absoluteIndex];
		return {
			id: placement.columnId,
			field: placement.field,
			label: col.header ?? col.field,
			depth: maxGroupDepth,
			colStart: placement.absoluteIndex,
			colEnd: placement.absoluteIndex,
			left: placement.laneOffset,
			width: placement.width || defaultColWidth,
			top: leafBandTop,
			height: leafHeaderHeight,
			pinned: placement.lane,
			isLeaf: true,
			movable:
				enableColumnReorder &&
				!col.checkboxSelection &&
				(col.canMoveColumn === undefined ||
					normalizeCapabilityResult(col.canMoveColumn({ action: 'moveColumn', colField: col.field })).allowed),
			resizable: true,
			sortable: col.sortable !== false && !col.checkboxSelection,
			checkboxSelection: !!col.checkboxSelection,
		};
	});

	if (maxGroupDepth === 0) {
		return [{ depth: 0, top: 0, height: leafHeaderHeight, cells: leafCells }];
	}

	const bands: HeaderBandLayout[] = [];

	// Group bands from pre-computed topology segments (also lane-relative).
	for (let d = 0; d < maxGroupDepth; d++) {
		const bandTop = d * GROUP_BAND_HEIGHT;
		const segments = topology.groupSegments[d];
		if (!segments || segments.length === 0) continue;

		const cells: HeaderCellLayout[] = segments.map((seg) => ({
			id: seg.id,
			field: '',
			label: seg.label,
			depth: d,
			colStart: seg.colStart,
			colEnd: seg.colEnd,
			left: seg.laneOffset,
			width: seg.width,
			top: bandTop,
			height: GROUP_BAND_HEIGHT,
			pinned: seg.lane,
			isLeaf: false,
			movable: false,
			resizable: false,
			sortable: false,
			checkboxSelection: false,
		}));

		bands.push({ depth: d, top: bandTop, height: GROUP_BAND_HEIGHT, cells });
	}

	bands.push({ depth: maxGroupDepth, top: leafBandTop, height: leafHeaderHeight, cells: leafCells });

	return bands;
}

/**
 * Structural (scroll-invariant) half of the layout plan: topology, header bands and the header
 * heights derived from them. Rebuilding it costs O(columns) plus one `canMoveColumn` call per
 * column, so it is memoized per compiled plan and only rebuilt when the plan, the grid state
 * object (immutable; replaced on every commit) or the leaf header height changes. Scroll frames
 * change none of these, so they reuse the cached bands and topology by reference.
 */
interface StaticLayoutEntry {
	state: object;
	leafHeaderHeight: number;
	columnTopology: CompiledColumnTopology;
	headerBands: HeaderBandLayout[];
}

const staticLayoutCache = new WeakMap<object, StaticLayoutEntry>();

function getStaticLayout<TRowData>(
	columnPlan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>,
	state: InternalGridState<TRowData>,
	leafHeaderHeight: number
): StaticLayoutEntry {
	const cached = staticLayoutCache.get(columnPlan);
	if (cached && cached.state === state && cached.leafHeaderHeight === leafHeaderHeight && cached.columnTopology.version === columnPlan.version) {
		return cached;
	}
	const columnTopology = getMemoizedColumnTopology(columnPlan);
	const headerBands = buildHeaderBands(
		columnTopology,
		columnPlan.displayedColumns,
		leafHeaderHeight,
		state.enableColumnReorder ?? true,
		state.defaultColWidth
	);
	const entry: StaticLayoutEntry = { state, leafHeaderHeight, columnTopology, headerBands };
	staticLayoutCache.set(columnPlan, entry);
	return entry;
}

// Single-entry cache: the analysis summary walks the query tree, and filter/query models are
// immutable references, so identity equality is an exact hit test.
const UNSET_ANALYSIS_MODEL = {};
let lastAnalysisFilterModel: unknown = UNSET_ANALYSIS_MODEL;
let lastAnalysisQueryModel: unknown = UNSET_ANALYSIS_MODEL;
let lastAnalysisActiveItems = 0;

function getActiveAnalysisItemCount(state: InternalGridState<unknown>): number {
	if (state.filterModel !== lastAnalysisFilterModel || state.queryModel !== lastAnalysisQueryModel) {
		lastAnalysisFilterModel = state.filterModel;
		lastAnalysisQueryModel = state.queryModel;
		lastAnalysisActiveItems = summarizeAnalysisState(state.filterModel, state.queryModel).totalActiveItems;
	}
	return lastAnalysisActiveItems;
}

export function computeGridLayoutPlan<TRowData>(
	engine: GridEngine<TRowData>,
	renderWindow?: RenderWindow,
	leafHeaderHeightPx?: number
): GridLayoutPlan {
	const rw = renderWindow ?? computeRenderWindow(engine);
	const state = engine.stateManager.getState();
	const columnPlan = engine.columns.getCompiledPlan();
	const viewportWidth = engine.viewport.viewportWidth;
	const viewportClientWidth = engine.viewport.scrollViewportClientWidth || viewportWidth;
	const viewportHeight = engine.viewport.viewportHeight;
	const totalRowsHeight = engine.geometry.getTotalHeight(state.defaultRowHeight);
	const totalColumnsWidth = columnPlan.totalWidth;
	const contentWidth = Math.max(totalColumnsWidth, viewportWidth);
	const groupPanelHeight = state.showGroupPanel ? GROUP_PANEL_HEIGHT : 0;
	const filterChipBarHeight =
		state.showFilterChipBar && getActiveAnalysisItemCount(state as InternalGridState<unknown>) > 0 ? FILTER_CHIP_BAR_HEIGHT : 0;
	const leafHeaderHeight = leafHeaderHeightPx !== undefined && leafHeaderHeightPx > 0 ? leafHeaderHeightPx : LEAF_HEADER_HEIGHT;
	const pinLeftCount = Math.min(engine.viewport.pinLeftColumns, rw.colCount);
	const pinRightCount = Math.min(engine.viewport.pinRightColumns, Math.max(0, rw.colCount - pinLeftCount));
	const firstRightPinColIdx = Math.max(pinLeftCount, rw.colCount - pinRightCount);
	const pinLeftWidth = pinLeftCount > 0 ? engine.geometry.colLefts[pinLeftCount] || 0 : 0;
	const pinRightWidth =
		pinRightCount > 0 && firstRightPinColIdx < rw.colCount
			? totalColumnsWidth - (engine.geometry.colLefts[firstRightPinColIdx] || totalColumnsWidth)
			: 0;

	const { columnTopology, headerBands } = getStaticLayout(columnPlan, state, leafHeaderHeight);

	// totalHeaderHeight = sum of all band heights (group bands + leaf band)
	const lastBand = headerBands[headerBands.length - 1];
	const totalHeaderHeight = lastBand ? lastBand.top + lastBand.height : leafHeaderHeight;
	const columnGroupHeaderHeight = totalHeaderHeight - leafHeaderHeight;
	const floatingFilterHeight = state.showFloatingFilters ? FLOATING_FILTER_HEIGHT : 0;
	const topChromeHeight = groupPanelHeight + filterChipBarHeight + totalHeaderHeight + floatingFilterHeight;

	// Bottom chrome — status bar + pagination bar. Config-gated: when absent both heights
	// resolve to 0. Heights come from constants, never magic literals.
	const statusBarHeight = state.showStatusBar ? STATUS_BAR_HEIGHT : 0;
	const paginationHeight = state.pagination ? PAGINATION_HEIGHT : 0;
	const bottomChromeHeight = statusBarHeight + paginationHeight;
	const bottomChromeTop = Math.max(0, viewportHeight - bottomChromeHeight);
	// Pagination sits below the status bar within the bottom chrome stack.
	const statusBarTop = bottomChromeTop;
	const paginationTop = bottomChromeTop + statusBarHeight;

	let pinnedTopHeight = 0;
	for (let i = 0; i < rw.pinTopRows && i < rw.rowCount; i++) {
		pinnedTopHeight += engine.geometry.getRowHeight(i, state.defaultRowHeight);
	}
	let pinnedBottomHeight = 0;
	for (let i = 0; i < rw.pinBottomRows && i < rw.rowCount; i++) {
		pinnedBottomHeight += engine.geometry.getRowHeight(rw.rowCount - 1 - i, state.defaultRowHeight);
	}

	return {
		viewport: {
			width: viewportWidth,
			clientWidth: viewportClientWidth,
			height: viewportHeight,
			scrollTop: engine.viewport.scrollTop,
			scrollLeft: engine.viewport.scrollLeft,
		},
		dimensions: {
			totalRowsHeight,
			totalColumnsWidth,
			contentWidth,
			contentHeight: totalRowsHeight,
		},
		chrome: {
			groupPanelHeight,
			filterChipBarHeight,
			columnGroupHeaderHeight,
			leafHeaderHeight,
			totalHeaderHeight,
			floatingFilterHeight,
			topChromeHeight,
			statusBarHeight,
			paginationHeight,
			bottomChromeHeight,
		},
		rows: {
			rowStart: rw.rowStart,
			rowEnd: rw.rowEnd,
			pinnedTopCount: rw.pinTopRows,
			pinnedBottomCount: rw.pinBottomRows,
			pinnedTopHeight,
			pinnedBottomHeight,
			visibleTop: rw.visibleTop ?? engine.viewport.scrollTop + pinnedTopHeight,
			visibleBottom: rw.visibleBottom ?? engine.viewport.scrollTop + viewportHeight - pinnedBottomHeight,
			bufferTopPx: rw.bufferTopPx ?? 0,
			bufferBottomPx: rw.bufferBottomPx ?? totalRowsHeight,
		},
		columns: {
			colStart: rw.colStart,
			colEnd: rw.colEnd,
			pinLeftCount,
			pinRightCount,
			pinLeftWidth,
			pinRightWidth,
			centerWidth: Math.max(0, viewportClientWidth - pinLeftWidth - pinRightWidth),
			lanes: {
				left: {
					width: pinLeftWidth,
					baseLeft: 0,
					colStart: pinLeftCount > 0 ? 0 : -1,
					colEnd: pinLeftCount > 0 ? pinLeftCount - 1 : -1,
				},
				center: {
					width: Math.max(0, viewportClientWidth - pinLeftWidth - pinRightWidth),
					baseLeft: pinLeftWidth,
					colStart: firstRightPinColIdx > pinLeftCount ? pinLeftCount : -1,
					colEnd: firstRightPinColIdx > pinLeftCount ? firstRightPinColIdx - 1 : -1,
				},
				right: {
					width: pinRightWidth,
					// Absolute X where right-pinned columns begin. The sole source for the
					// `colLefts[c] - baseLeft` lane-relative conversion done by header + body.
					baseLeft: totalColumnsWidth - pinRightWidth,
					colStart: pinRightCount > 0 ? firstRightPinColIdx : -1,
					colEnd: pinRightCount > 0 ? rw.colCount - 1 : -1,
				},
			},
		},
		origins: {
			headerTop: groupPanelHeight + filterChipBarHeight,
			rowLayerTop: topChromeHeight,
			stickyGroupLayerTop: topChromeHeight,
			overlayTop: topChromeHeight,
			bottomChromeTop,
			statusBarTop,
			paginationTop,
		},
		headerBands,
		stickySections: rw.stickySections ?? [],
		renderWindow: rw,
		columnTopology,
	};
}
