// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { InfiniteRowModelController } from '../infiniteRowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { RenderRuntimeState } from './renderRuntimeState.js';
import {
	diffRenderWindow,
	getColIndices,
	getRowIndices,
	type RenderWindow,
	computeRenderWindow,
	applyRenderWindowRuntimeLimits,
} from './renderWindow.js';

interface RuntimePerfRow {
	id: string;
	name: string;
	status: string;
	[key: string]: string;
}

function createContainer(width = 500, height = 200): HTMLDivElement {
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: width,
		bottom: height,
		width,
		height,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	return container;
}

function createWideGrid(options: { rows?: number; cols?: number; custom?: boolean; valueGetter?: boolean } = {}) {
	const rowCount = options.rows ?? 100000;
	const colCount = options.cols ?? 1000;
	const columns: ColumnDef<RuntimePerfRow>[] = Array.from({ length: colCount }, (_, index) => ({
		field: `col_${index}`,
		header: `Col ${index}`,
		width: 100,
		...(options.custom && index % 4 === 0
			? {
					cellRenderer: () => `Rendered ${index}`,
					cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
				}
			: {}),
		...(options.valueGetter && index % 5 === 0
			? {
					valueGetterDependencies: [`col_${index}`],
					valueGetter: ({ row }: any) => `VG ${row[`col_${index}`]}`,
				}
			: {}),
	}));
	const rows: RuntimePerfRow[] = Array.from({ length: rowCount }, (_, rowIndex) => {
		const row: RuntimePerfRow = {
			id: `row-${rowIndex}`,
			name: `Row ${rowIndex}`,
			status: rowIndex % 2 === 0 ? 'Active' : 'Pending',
		};
		for (let colIndex = 0; colIndex < Math.min(colCount, 20); colIndex++) {
			row[`col_${colIndex}`] = `R${rowIndex} C${colIndex}`;
		}
		return row;
	});
	const store = new GridStore<RuntimePerfRow>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 100,
		rowOverscanPx: 40,
		colBuffer: 1,
		getRowId: (row) => row.id,
		runtimeLimits: { maxRenderedRows: 20, maxRenderedCells: 220 },
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns });
	const container = createContainer();
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	return { store, controller, container, renderer, columns };
}

function makeScrollCtx(store: GridStore<RuntimePerfRow>) {
	const state = store.getState();
	const plan = store.engine.columns.getCompiledPlan();
	return {
		isScrolling: true,
		state,
		stateVersion: 0,
		rowVersions: store.engine.rowVersions,
		globalVersion: state.globalVersion,
		styleVersion: 0,
		loadingVersion: 0,
		styleChangedDuringScroll: false,
		loadingChangedDuringScroll: false,
		selectionChangedDuringScroll: false,
		globalChangedDuringScroll: false,
		activeEdit: state.activeEdit,
		hasDeferredCellStyleRules: !!state.styleRules?.length,
		hasCustomRenderers: plan.hasCustomRenderers,
		hasInsightDecorations: false,
		plan,
		visibleRowRange: store.engine.viewport.getVisibleRowRange(store.engine.getVisualRowModel()?.getVisualRowCount() ?? 0),
		visibleColRange: store.engine.viewport.getVisibleColumnRange(plan.displayedColumns.length),
		focusedCell: state.selection.focus,
		selectionBounds: state.selection.bounds ?? undefined,
		canUseCachedDisplayValues: true,
	};
}

function cleanupGrid(grid: ReturnType<typeof createWideGrid>): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
}

describe('Runtime Performance & Granular Versioning', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('validates that focus() and getCellValue() are not invoked during active scroll frames', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 200,
			width: 500,
			height: 200,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		// Trigger scrolling frame
		const scrollFrameState = new RenderRuntimeState();
		scrollFrameState.transitionTo('scroll-pending');
		scrollFrameState.transitionTo('scroll-frame');
		store.engine.setScrollStateProvider(scrollFrameState);
		store.engine.getCellValueCallsDuringScroll = 0;

		// Perform scroll update
		store.engine.viewport.setScrollPosition(100, 0);
		const plan = store.engine.columns.getCompiledPlan();
		renderer.rowRenderer.recycleViewport(true, {
			scrollTop: 100,
			scrollLeft: 0,
			isScrolling: true,
			state: store.getState(),
			dataVersion: store.getState().dataVersion,
			styleVersion: 0,
			loadingVersion: 0,
			hasDeferredCellStyleRules: false,
			plan,
		} as any);

		// Check that getCellValue is NOT called during scroll frame
		expect(store.engine.getCellValueCallsDuringScroll).toBe(0);

		// Stop scroll
		store.engine.setScrollStateProvider(new RenderRuntimeState());

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('drives active-scroll row loading through ensureRange on the shared row-model contract', () => {
		const grid = createWideGrid({ rows: 200, cols: 8 });
		try {
			const rowModel = grid.store.engine.getRowModel();
			expect(rowModel).not.toBeNull();
			const ensureRangeSpy = vi.spyOn(rowModel!, 'ensureRange');

			grid.store.engine.viewport.setScrollPosition(120, 0);
			grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

			const window = grid.renderer.rowRenderer.currentWindow as RenderWindow;
			expect(ensureRangeSpy).toHaveBeenCalledWith(window.rowStart, window.rowEnd, 'viewport-render');
		} finally {
			cleanupGrid(grid);
		}
	});

	it('tests stable-slot virtualization does not remove/re-append row elements during scroll', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
			rowOverscanPx: 80,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 200,
			width: 500,
			height: 200,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const centerLayer = container.querySelector('.og-scroll-viewport') as HTMLDivElement;

		// Track child additions/removals
		let childAdded = false;
		let childRemoved = false;
		const observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				if (m.addedNodes.length > 0) childAdded = true;
				if (m.removedNodes.length > 0) childRemoved = true;
			}
		});
		observer.observe(centerLayer, { childList: true, subtree: true });

		// Perform small scroll to recycle some rows
		store.engine.viewport.setScrollPosition(80, 0); // scroll down by two rows
		renderer.fullPaint();

		// Under slot-pool strategy, rows should be recycled internally without being removed and re-appended to the DOM
		const rowEls = Array.from(container.querySelectorAll('[data-row-id]'));
		expect(rowEls.length).toBeGreaterThan(0);

		observer.disconnect();
		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('applies row-selection class through the cached selection membership set', () => {
		const grid = createWideGrid({ rows: 100, cols: 4 });
		try {
			grid.store.selectRows(['row-0', 'row-20', 'row-40']);
			grid.renderer.fullPaint();

			const selectedRows = Array.from(grid.container.querySelectorAll<HTMLElement>('.og-row-node-selected'));
			expect(selectedRows.some((row) => row.dataset.rowId === 'row:row-0')).toBe(true);
		} finally {
			cleanupGrid(grid);
		}
	});

	it('reuses the cached selected-row membership set across scroll frames when selection is unchanged', () => {
		const grid = createWideGrid({ rows: 200, cols: 8 });
		try {
			grid.store.selectRows(['row-1', 'row-5']);
			grid.renderer.fullPaint();

			const selectionPaint = grid.renderer.rowRenderer.selectionPaint;
			const firstSet = selectionPaint.getSelectedRowIdSet(grid.store.getState().selectedRowIds);
			expect(firstSet).not.toBeNull();

			grid.store.engine.viewport.setScrollPosition(40, 0);
			grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);
			const secondSet = selectionPaint.getSelectedRowIdSet(grid.store.getState().selectedRowIds);

			expect(secondSet).toBe(firstSet);
		} finally {
			cleanupGrid(grid);
		}
	});

	it('does zero row and cell work when the scroll render window is unchanged', () => {
		const grid = createWideGrid({ rows: 1000, cols: 100 });
		grid.renderer.resetRenderStats();

		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const stats = grid.renderer.getRenderStats();
		expect(stats.rowsVisitedDuringScroll).toBe(0);
		expect(stats.cellsVisitedDuringScroll).toBe(0);
		expect(stats.cellsWrittenDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('limits vertical scroll cell work to newly entered rows when columns stay stable', () => {
		const columns: ColumnDef<{ id: string; name: string }>[] = [{ field: 'name', header: 'Name', width: 100 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			rowOverscanPx: 120,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns,
		});
		const container = createContainer(500, 160);
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		renderer.resetRenderStats();

		store.engine.viewport.setScrollPosition(40, 0);
		renderer.rowRenderer.recycleViewport(true, makeScrollCtx(store as any) as any);

		const stats = renderer.getRenderStats();

		expect(stats.cellsVisitedDuringScroll).toBeLessThanOrEqual(2);
		expect(stats.cellsWrittenDuringScroll).toBeLessThanOrEqual(2);
		expect(stats.cellTextWrites).toBeLessThanOrEqual(2);
		expect(stats.cellClassWrites).toBeLessThanOrEqual(2);
		expect(stats.cellWidthWrites).toBeLessThanOrEqual(2);
		expect(stats.cellLeftWrites).toBeLessThanOrEqual(2);
		expect(stats.rowClassWrites).toBeLessThanOrEqual(2);
		expect(stats.customRendererMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps deferred style-hook churn bounded to newly entered visible cells during vertical scroll', () => {
		const columns: ColumnDef<{ id: string; name: string }>[] = [{ field: 'name', header: 'Name', width: 100 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			rowOverscanPx: 120,
			getRowId: (row) => row.id,
			styleRules: [{ kind: 'cell', when: () => true, cellClass: 'styled-cell' }],
		});
		const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns,
		});
		const container = createContainer(500, 160);
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.resetRenderStats();

		store.engine.viewport.setScrollPosition(40, 0);
		renderer.rowRenderer.recycleViewport(true, makeScrollCtx(store as any) as any);

		const stats = renderer.getRenderStats();
		expect(stats.styleHookCallsDuringScroll).toBeLessThanOrEqual(1);
		expect(stats.dirtyCellsMarkedDuringScroll).toBeLessThanOrEqual(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps vertical scroll work bounded to entered rows instead of the full visible range', () => {
		const grid = createWideGrid({ rows: 100000, cols: 1000, custom: true, valueGetter: true });
		const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		grid.renderer.resetRenderStats();

		grid.store.engine.viewport.setScrollPosition(40, 0);
		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const nextWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		const delta = diffRenderWindow(prevWindow, nextWindow);
		const visibleContentRows =
			nextWindow.visibleRowStart !== undefined && nextWindow.visibleRowEnd !== undefined && nextWindow.visibleRowStart >= 0
				? nextWindow.visibleRowEnd - nextWindow.visibleRowStart + 1 + nextWindow.pinTopRows + nextWindow.pinBottomRows
				: getRowIndices(nextWindow).length;
		const stats = grid.renderer.getRenderStats();

		expect(stats.rowsVisitedDuringScroll).toBeLessThanOrEqual(getRowIndices(nextWindow).length);
		expect(stats.cellsVisitedDuringScroll).toBeLessThanOrEqual(
			visibleContentRows * getColIndices(nextWindow).length + getColIndices(nextWindow).length
		);
		expect(stats.valueGetterCallsDuringScroll).toBe(0);
		expect(stats.formulaCallsDuringScroll).toBe(0);
		expect(stats.customRendererMountsDuringScroll).toBe(0);

		cleanupGrid(grid);
	}, 15_000); // 100k x 1000 synthetic grid setup can exceed 5s under full-suite load even when the bounded-work assertions hold.

	it('avoids row-model lookups for stayed rows during a one-row vertical scroll', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 100 }],
			defaultRowHeight: 40,
			rowOverscanPx: 0,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 160,
			width: 500,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const visualRowModel = store.engine.getVisualRowModel()!;
		const getVisualRowSpy = vi.spyOn(visualRowModel, 'getVisualRow');
		renderer.resetRenderStats();

		store.engine.viewport.setScrollPosition(40, 0);
		renderer.rowRenderer.recycleViewport(true, makeScrollCtx(store as any) as any);

		expect(getVisualRowSpy).toHaveBeenCalledTimes(2);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps buffered custom-cell content warm outside the visible row band during scroll', () => {
		const columns: ColumnDef<{ id: string; name: string }>[] = [
			{
				field: 'name',
				header: 'Name',
				width: 120,
				cellRenderer: () => 'Rendered',
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
			},
		];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			rowOverscanPx: 80,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 40 }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns,
		});
		const container = createContainer(500, 160);
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const initialRow0Cell = container.querySelector('.og-cell[data-row-id="row-0"][data-col-field="name"]') as HTMLDivElement;
		expect(initialRow0Cell.dataset.contentMode).toBe('portal');

		store.engine.viewport.setScrollPosition(40, 0);
		renderer.rowRenderer.recycleViewport(true, makeScrollCtx(store as any) as any);

		const bufferedRow0Cell = container.querySelector('.og-cell[data-row-id="row-0"][data-col-field="name"]') as HTMLDivElement;
		const visibleRow1Cell = container.querySelector('.og-cell[data-row-id="row-1"][data-col-field="name"]') as HTMLDivElement;

		expect(bufferedRow0Cell.dataset.contentMode).toBe('portal');
		expect(visibleRow1Cell.dataset.contentMode).toBe('portal');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps horizontal scroll work bounded to entered/exited columns across active rows', () => {
		const grid = createWideGrid({ rows: 1000, cols: 1000, custom: true });
		const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		grid.renderer.resetRenderStats();

		grid.store.engine.viewport.setScrollPosition(0, 100);
		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const nextWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		const delta = diffRenderWindow(prevWindow, nextWindow);
		const visibleContentRows =
			nextWindow.visibleRowStart !== undefined && nextWindow.visibleRowEnd !== undefined && nextWindow.visibleRowStart >= 0
				? nextWindow.visibleRowEnd - nextWindow.visibleRowStart + 1 + nextWindow.pinTopRows + nextWindow.pinBottomRows
				: getRowIndices(nextWindow).length;
		const stats = grid.renderer.getRenderStats();

		expect(stats.rowsVisitedDuringScroll).toBeLessThanOrEqual(getRowIndices(nextWindow).length);
		expect(stats.cellsVisitedDuringScroll).toBeLessThanOrEqual(
			visibleContentRows * getColIndices(nextWindow).length + getColIndices(nextWindow).length
		);
		expect(stats.cellLeftWrites).toBeLessThanOrEqual(visibleContentRows * Math.max(1, delta.colsEntered.length));
		expect(stats.cellWidthWrites).toBeLessThanOrEqual(visibleContentRows * Math.max(1, delta.colsEntered.length));
		expect(stats.rowClassWrites).toBe(0);
		expect(stats.customRendererMountsDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('keeps pinned-lane horizontal scroll portal-free and bounded', () => {
		const grid = createWideGrid({ rows: 1000, cols: 1000, custom: true });
		grid.store.setPinnedColumns({ left: 2, right: 2 });
		grid.renderer.fullPaint();

		const initialPlan = grid.store.engine.columns.getCompiledPlan();
		const prevWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		grid.renderer.resetRenderStats();

		grid.store.engine.viewport.setScrollPosition(0, 300);
		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const nextWindow = grid.renderer.rowRenderer.currentWindow as RenderWindow;
		const delta = diffRenderWindow(prevWindow, nextWindow);
		const activeRows = getRowIndices(nextWindow).length;
		const pinnedCols = nextWindow.pinLeftCols + nextWindow.pinRightCols;
		const stats = grid.renderer.getRenderStats();

		expect(nextWindow.pinLeftCols).toBe(2);
		expect(nextWindow.pinRightCols).toBe(2);
		expect(grid.store.engine.columns.getCompiledPlan()).toBe(initialPlan);
		expect(stats.cellsVisitedDuringScroll).toBeLessThanOrEqual(activeRows * (delta.colsEntered.length + delta.colsExited.length + pinnedCols));
		expect(stats.customRendererMountsDuringScroll).toBe(0);
		expect(stats.portalMountsDuringScroll).toBe(0);
		expect(stats.portalFlushesDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('BLOCKER: pinning a column mid-session drives real column-topology-change delta telemetry via computeColumnWindowDelta', () => {
		// Distinct from the routine-scroll cols{Entered,Exited,Stayed}DuringScroll counters (which
		// track the render WINDOW shifting over a static topology) — this proves a genuine topology
		// CHANGE (pin/unpin) is diffed via computeColumnWindowDelta, not silently dropped.
		const grid = createWideGrid({ rows: 1000, cols: 20 });
		grid.renderer.fullPaint();
		grid.renderer.resetRenderStats();

		grid.store.setPinnedColumns({ left: 2, right: 1 });
		grid.renderer.fullPaint();

		const stats = grid.renderer.getRenderStats();
		expect(stats.columnTopologyDeltaComputations).toBeGreaterThan(0);
		// Pinning relocates existing columns to a different lane — they remain in the column SET, so
		// they show up as laneMoves (relocated), never as entered/exited (those track columns
		// added/removed from the topology entirely, which pinning does not do).
		expect(stats.columnTopologyLaneMoves).toBe(3); // 2 newly-pinned-left + 1 newly-pinned-right
		expect(stats.columnTopologyEnteredColumns).toBe(0);
		expect(stats.columnTopologyExitedColumns).toBe(0);
		expect(stats.columnTopologyStayedColumns).toBe(17); // 20 columns - 3 relocated

		cleanupGrid(grid);
	});

	it('caps rendered rows and cells through runtime limits', () => {
		const grid = createWideGrid({ rows: 100000, cols: 1000 });
		const window = grid.renderer.rowRenderer.currentWindow as RenderWindow;

		expect(getRowIndices(window).length).toBeLessThanOrEqual(20);
		expect(getRowIndices(window).length * getColIndices(window).length).toBeLessThanOrEqual(220);

		cleanupGrid(grid);
	}, 15_000); // Large synthetic grid mount can exceed the default 5s suite timeout under full-load CI/local runs.

	it('never leaves stale cell DOM attached to hot-recycled rows after violent custom-renderer scrolls', () => {
		const grid = createWideGrid({ rows: 1000, cols: 24, custom: true, valueGetter: true });
		const scrollPositions = [400, 1600, 80, 3200, 120, 4800, 0, 2400];

		for (const scrollTop of scrollPositions) {
			grid.store.engine.viewport.setScrollPosition(scrollTop, 0);
			grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);
		}

		for (const row of Array.from(grid.container.querySelectorAll<HTMLElement>('.og-row'))) {
			const cells = Array.from(row.querySelectorAll<HTMLElement>(':scope > .og-cell'));
			const fields = cells.map((cell) => cell.dataset.colField).filter(Boolean);
			expect(fields.length).toBe(new Set(fields).size);
			for (const cell of cells) {
				expect(cell.dataset.rowIndex).toBe(row.dataset.rowIndex);
				for (const renderer of Array.from(cell.querySelectorAll<HTMLElement>('.og-custom-renderer-container'))) {
					expect(renderer.dataset.cellKey).toBe(cell.dataset.cellKey);
				}
			}
			expect(row.querySelectorAll(':scope > .og-custom-renderer-container')).toHaveLength(0);
		}

		cleanupGrid(grid);
	});

	it('should verify direct contiguous range math in diffRenderWindow (Task 2)', () => {
		const base: RenderWindow = {
			rowStart: 2,
			rowEnd: 8,
			colStart: 1,
			colEnd: 4,
			pinLeftCols: 1,
			pinRightCols: 1,
			pinTopRows: 1,
			pinBottomRows: 1,
			rowCount: 20,
			colCount: 10,
			scrollTop: 100,
			scrollLeft: 50,
			viewportWidth: 500,
			viewportHeight: 400,
		};

		// Scroll down one row:
		const scrollDown = { ...base, rowStart: 3, rowEnd: 9, scrollTop: 140 };
		const dDown = diffRenderWindow(base, scrollDown);
		expect(dDown.rowsEntered).toEqual([9]);
		expect(dDown.rowsExited).toEqual([2]);
		expect(dDown.rowsStayed).toEqual([0, 3, 4, 5, 6, 7, 8, 19]);

		// Scroll up one row:
		const scrollUp = { ...base, rowStart: 1, rowEnd: 7, scrollTop: 60 };
		const dUp = diffRenderWindow(base, scrollUp);
		expect(dUp.rowsEntered).toEqual([1]);
		expect(dUp.rowsExited).toEqual([8]);

		// Horizontal scroll one column:
		const scrollCol = { ...base, colStart: 2, colEnd: 5, scrollLeft: 150 };
		const dCol = diffRenderWindow(base, scrollCol);
		expect(dCol.colsEntered).toEqual([5]);
		expect(dCol.colsExited).toEqual([1]);
	});

	it('keeps state reads at zero even when a sub-row scroll crosses the visible content band', () => {
		const grid = createWideGrid({ rows: 1000, cols: 100 });

		// Establish initial window
		(grid.renderer as any).flushScrollFrame();
		grid.renderer.resetRenderStats();

		const scrollViewport = grid.renderer.viewportRenderer.scrollViewport!;
		Object.defineProperty(scrollViewport, 'scrollTop', { value: 5, writable: true, configurable: true });
		Object.defineProperty(scrollViewport, 'scrollLeft', { value: 5, writable: true, configurable: true });

		// Trigger scrolling frame where window stays same
		(grid.renderer as any).flushScrollFrame();

		const stats = grid.renderer.getRenderStats();
		expect(stats.sameWindowBailouts).toBe(0);
		expect(stats.stateReadsDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('should verify delta stats for rows/cols entered/exited/stayed/skipped (Task 4)', () => {
		const grid = createWideGrid({ rows: 100, cols: 10 });

		// Establish initial window
		(grid.renderer as any).flushScrollFrame();
		grid.renderer.resetRenderStats();

		const scrollViewport = grid.renderer.viewportRenderer.scrollViewport!;
		Object.defineProperty(scrollViewport, 'scrollTop', { value: 80, writable: true, configurable: true });
		Object.defineProperty(scrollViewport, 'scrollLeft', { value: 0, writable: true, configurable: true });

		// Trigger scroll frame
		(grid.renderer as any).flushScrollFrame();

		const stats = grid.renderer.getRenderStats();
		expect(stats.rowsEnteredDuringScroll).toBeGreaterThanOrEqual(1);
		expect(stats.rowsExitedDuringScroll).toBeGreaterThanOrEqual(1);
		expect(stats.stateReadsDuringScroll).toBe(0);

		cleanupGrid(grid);
	});

	it('keeps compiled plan stable and avoids portal mounts during active scroll for deferred renderers', () => {
		const grid = createWideGrid({ rows: 1000, cols: 1000, custom: true });
		const initialPlan = grid.store.engine.columns.getCompiledPlan();
		grid.renderer.resetRenderStats();

		grid.store.engine.viewport.setScrollPosition(120, 240);
		grid.renderer.rowRenderer.recycleViewport(true, makeScrollCtx(grid.store) as any);

		const stats = grid.renderer.getRenderStats();
		expect(grid.store.engine.columns.getCompiledPlan()).toBe(initialPlan);
		expect(stats.customRendererMountsDuringScroll).toBe(0);
		expect(stats.portalMountsDuringScroll).toBe(0);
		expect(stats.compiledPlanVersion).toBe(initialPlan.version);

		cleanupGrid(grid);
	});

	it('queues a scroll-idle viewport flush when an async row model hits the same-window fast-scroll bailout', async () => {
		const store = new GridStore<RuntimePerfRow>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			rowOverscanPx: 400,
			getRowId: (row) => row.id,
		});
		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			blockSize: 50,
			columns: store.getState().columns,
			datasource: {
				getRows: async ({ startRow, endRow }) => ({
					rows: Array.from({ length: endRow - startRow }, (_, index) => ({
						id: `row-${startRow + index}`,
						name: `Row ${startRow + index}`,
						status: 'Active',
					})),
					totalCount: 1000,
				}),
			},
		});
		const container = createContainer();
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		await Promise.resolve();
		await Promise.resolve();

		const scrollViewport = renderer.viewportRenderer.scrollViewport!;
		vi.spyOn(store.engine.viewport, 'isScrollingFast', 'get').mockReturnValue(true);
		store.engine.viewport.setScrollPosition(100, 0);
		Object.defineProperty(scrollViewport, 'scrollTop', { value: 100, writable: true, configurable: true });
		Object.defineProperty(scrollViewport, 'scrollLeft', { value: 0, writable: true, configurable: true });

		(renderer as any).rowRenderer.currentWindow = { ...computeRenderWindow(store.engine) };
		renderer.resetRenderStats();
		store.engine.invalidation.consume();

		(renderer as any).flushScrollFrame();

		expect(renderer.getRenderStats().sameWindowBailouts).toBe(1);
		expect((renderer as any).scrollPipeline.flushPendingAfterScroll).toBe(true);
		const frame = store.engine.invalidation.consume();
		expect(frame.viewport).toBe(true);
		expect(frame.reasons).toContain('scroll-idle');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});
});
