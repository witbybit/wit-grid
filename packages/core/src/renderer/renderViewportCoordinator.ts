import { computeScrollTarget } from './scrollIntoView.js';
import { computeGridLayoutPlan, type GridLayoutPlan } from './layoutPlan.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { CanonicalGridCellPointer, GridCellPointer } from '../api/GridApi.js';
import { resolveCanonicalCellPointer } from '../interaction/cellPointer.js';
import type { RenderRuntimeStats } from './renderTelemetry.js';
import type { RenderWindow } from './renderWindow.js';
import type { RowRenderer } from './rowRenderer.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { ScrollEngine } from './scrollEngine.js';
import type { ViewportRenderer } from './viewportRenderer.js';

export interface RenderViewportCoordinatorDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	viewportRenderer: ViewportRenderer<TRowData>;
	rowRenderer: RowRenderer<TRowData>;
	scrollEngine: ScrollEngine<TRowData>;
	renderStats: RenderRuntimeStats;
	requestScrollFrame: () => void;
}

export class RenderViewportCoordinator<TRowData = unknown> {
	// Theme header height is a CSS length string; parse it once per distinct value rather than
	// on every scroll frame.
	private lastThemeLeafHeaderHeight: string | undefined = undefined;
	private lastLeafHeaderHeightPx: number | undefined = undefined;

	constructor(private readonly deps: RenderViewportCoordinatorDeps<TRowData>) {}

	public syncLayoutPlan(renderWindow?: RenderWindow): GridLayoutPlan {
		const theme = this.deps.viewportRenderer.getTheme();
		const themeLeafHeaderHeight = theme?.leafHeaderHeight;
		if (themeLeafHeaderHeight !== this.lastThemeLeafHeaderHeight) {
			this.lastThemeLeafHeaderHeight = themeLeafHeaderHeight;
			const themeLhh = themeLeafHeaderHeight ? parseFloat(themeLeafHeaderHeight) : undefined;
			this.lastLeafHeaderHeightPx = themeLhh && themeLhh > 0 ? themeLhh : undefined;
		}
		const layoutPlan = computeGridLayoutPlan(this.deps.engine, renderWindow, this.lastLeafHeaderHeightPx);
		this.deps.viewportRenderer.syncLayoutPlan(layoutPlan);
		return layoutPlan;
	}

	public recycleViewport(isScrollFrameActive: boolean, ctx?: ScrollRenderContext<TRowData>, precomputedWindow?: RenderWindow): void {
		this.deps.renderStats.viewportRecycles++;
		this.deps.rowRenderer.recycleViewport(isScrollFrameActive, ctx, precomputedWindow);
	}

	public scrollCellIntoView(rowId: string, colField: string): void {
		this.scrollCellPointerIntoView({ rowId, colField });
	}

	public scrollCellPointerIntoView(pointer: GridCellPointer): void {
		const resolvedPointer = this.resolveProgrammaticScrollPointer(pointer);
		if (!resolvedPointer) return;
		this.deps.rowRenderer.programmaticScrollCell = { kind: 'cell', pointer: resolvedPointer };
		const scrollViewport = this.deps.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;

		const rowModel = this.deps.engine.getRowModel();
		if (!rowModel) return;

		const rowIndex = rowModel.getVisualIndexByRowId(resolvedPointer.rowId);
		const colIndex = this.deps.engine.columns.getIndexMapper().idToVisualIndex(resolvedPointer.columnInstanceId);
		if (rowIndex === null || rowIndex === -1 || colIndex === -1) return;

		this.scrollToIndex(scrollViewport, rowModel.getVisualRowCount(), rowIndex, colIndex);
	}

	private resolveProgrammaticScrollPointer(pointer: GridCellPointer): CanonicalGridCellPointer | null {
		return resolveCanonicalCellPointer(this.deps.engine.columns.getDisplayedColumns(), pointer);
	}

	public scrollRowIntoView(rowId: string): void {
		this.deps.rowRenderer.programmaticScrollCell = { kind: 'row', rowId };
		const scrollViewport = this.deps.viewportRenderer.scrollViewport;
		if (!scrollViewport) return;

		const rowModel = this.deps.engine.getRowModel();
		if (!rowModel) return;

		const rowIndex = rowModel.getVisualIndexByRowId(rowId);
		if (rowIndex === null || rowIndex === -1) return;

		this.scrollToIndex(scrollViewport, rowModel.getVisualRowCount(), rowIndex, -1);
	}

	/** Scrolls the minimum distance that brings a row (and column, unless colIndex is -1) into view. */
	private scrollToIndex(scrollViewport: HTMLElement, rowCount: number, rowIndex: number, colIndex: number): void {
		const { engine } = this.deps;
		const viewport = engine.viewport;
		const layoutPlan = this.deps.viewportRenderer.getLayoutPlan() ?? this.syncLayoutPlan();
		const target = computeScrollTarget({
			rowIndex,
			colIndex,
			rowCount,
			colCount: engine.columns.getDisplayedColumnCount(),
			pinLeftColumns: viewport.pinLeftColumns,
			pinRightColumns: viewport.pinRightColumns,
			pinTopRows: viewport.pinTopRows,
			pinBottomRows: viewport.pinBottomRows,
			scrollTop: viewport.scrollTop,
			scrollLeft: viewport.scrollLeft,
			viewportHeight: viewport.viewportHeight,
			viewportWidth: viewport.scrollViewportClientWidth || viewport.viewportWidth,
			topChromeHeight: layoutPlan.chrome.topChromeHeight,
			rowTops: engine.geometry.rowTops,
			rowHeights: engine.geometry.rowHeights,
			colLefts: engine.geometry.colLefts,
			colWidths: engine.geometry.colWidths,
			scrollViewportScrollHeight: scrollViewport.scrollHeight,
			scrollViewportScrollWidth: scrollViewport.scrollWidth,
			scrollViewportClientHeight: scrollViewport.clientHeight,
			scrollViewportClientWidth: scrollViewport.clientWidth,
		});
		if (!target) return;
		this.deps.scrollEngine.scrollTo(target.top, target.left);
		this.deps.requestScrollFrame();
	}
}
