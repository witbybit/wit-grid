// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	applyRenderWindowRuntimeLimits,
	getRowIndices,
	getColIndices,
	diffRenderWindow,
	computeRenderWindow,
	sameRenderedWindow,
	type RenderWindow,
} from './renderWindow.js';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

describe('RenderWindow & ViewportDelta calculations', () => {
	const baseWindow: RenderWindow = {
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

	it('should return correct row indices representing pinned and scrollable rows', () => {
		const rows = getRowIndices(baseWindow);
		// pinTopRows = 1: index 0
		// rowStart=2 to rowEnd=8: indices 2,3,4,5,6,7,8 (excluding index 19 since pinBottomRows=1, rowCount=20 -> bottom row is 19)
		// pinBottomRows = 1: index 19 (since rowCount=20)
		expect(rows).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 19]);
	});

	it('should return correct col indices representing pinned and scrollable columns', () => {
		const cols = getColIndices(baseWindow);
		// pinLeftCols = 1: index 0
		// colStart=1 to colEnd=4: indices 1,2,3,4 (excluding 9 since pinRightCols=1, colCount=10 -> right col is 9)
		// pinRightCols = 1: index 9 (since colCount=10)
		expect(cols).toEqual([0, 1, 2, 3, 4, 9]);
	});

	it('should diff RenderWindows and return entered/exited/stayed rows and columns', () => {
		const nextWindow: RenderWindow = {
			...baseWindow,
			rowStart: 3,
			rowEnd: 9,
			colStart: 2,
			colEnd: 5,
		};

		const delta = diffRenderWindow(baseWindow, nextWindow);

		// baseWindow rows: [0, 2, 3, 4, 5, 6, 7, 8, 19]
		// nextWindow rows: [0, 3, 4, 5, 6, 7, 8, 9, 19] (since rowStart=3, rowEnd=9, pinTopRows=1, pinBottomRows=1, rowCount=20)
		// Entered: 9
		// Exited: 2
		// Stayed: 0, 3, 4, 5, 6, 7, 8, 19
		expect(delta.rowsEntered).toEqual([9]);
		expect(delta.rowsExited).toEqual([2]);
		expect(delta.rowsStayed).toEqual([0, 3, 4, 5, 6, 7, 8, 19]);

		// baseWindow cols: [0, 1, 2, 3, 4, 9]
		// nextWindow cols: [0, 2, 3, 4, 5, 9] (since colStart=2, colEnd=5, pinLeft=1, pinRight=1, colCount=10)
		// Entered: 5
		// Exited: 1
		// Stayed: 0, 2, 3, 4, 9
		expect(delta.colsEntered).toEqual([5]);
		expect(delta.colsExited).toEqual([1]);
		expect(delta.colsStayed).toEqual([0, 2, 3, 4, 9]);

		expect(delta.hasChanges).toBe(true);
	});

	it('should ignore data updates when the geometry render window is unchanged', () => {
		const delta = diffRenderWindow(baseWindow, { ...baseWindow });

		expect(delta.rowsEntered).toEqual([]);
		expect(delta.rowsExited).toEqual([]);
		expect(delta.colsEntered).toEqual([]);
		expect(delta.colsExited).toEqual([]);
		expect(delta.hasChanges).toBe(false);
	});

	it('treats pinned row scroll offset changes as geometry changes', () => {
		const delta = diffRenderWindow(baseWindow, { ...baseWindow, scrollTop: baseWindow.scrollTop + 20 });

		expect(delta.rowsEntered).toEqual([]);
		expect(delta.rowsExited).toEqual([]);
		expect(delta.hasChanges).toBe(true);
	});

	it('preserves pinned rows when max rendered rows clamps the center range', () => {
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				rowStart: 2,
				rowEnd: 12,
				pinTopRows: 2,
				pinBottomRows: 2,
			},
			{ maxRenderedRows: 6 }
		);

		expect(limited.rowStart).toBe(2);
		expect(limited.rowEnd).toBe(3);
		expect(getRowIndices(limited)).toEqual([0, 1, 2, 3, 18, 19]);
	});

	it('never drops visible rows to meet the row budget: overscan gives way first', () => {
		// Scrolling down: 8 overscan rows above the visible 20..34, 2 below. Budget 20.
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				pinTopRows: 0,
				pinBottomRows: 0,
				pinLeftCols: 0,
				pinRightCols: 0,
				rowCount: 100,
				rowStart: 12,
				rowEnd: 36,
				visibleRowStart: 20,
				visibleRowEnd: 34,
			},
			{ maxRenderedRows: 20 }
		);
		expect(limited.rowStart).toBeLessThanOrEqual(20);
		expect(limited.rowEnd).toBeGreaterThanOrEqual(34);
		expect(limited.rowEnd - limited.rowStart + 1).toBe(20);
		// 5 spare rows: 2 below (all there is), the other 3 above.
		expect([limited.rowStart, limited.rowEnd]).toEqual([17, 36]);
	});

	it('never drops visible columns to meet the cell budget', () => {
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				pinTopRows: 0,
				pinBottomRows: 0,
				pinLeftCols: 0,
				pinRightCols: 0,
				rowStart: 0,
				rowEnd: 1,
				colCount: 60,
				colStart: 5,
				colEnd: 40,
				visibleColStart: 20,
				visibleColEnd: 30,
			},
			{ maxRenderedCells: 30 }
		);
		expect(limited.colStart).toBeLessThanOrEqual(20);
		expect(limited.colEnd).toBeGreaterThanOrEqual(30);
		expect(limited.colEnd - limited.colStart + 1).toBe(15);
		expect([limited.colStart, limited.colEnd]).toEqual([18, 32]);
	});

	it('keeps the start when the visible range alone exceeds the budget', () => {
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				pinTopRows: 0,
				pinBottomRows: 0,
				pinLeftCols: 0,
				pinRightCols: 0,
				rowCount: 100,
				rowStart: 10,
				rowEnd: 60,
				visibleRowStart: 15,
				visibleRowEnd: 55,
			},
			{ maxRenderedRows: 10 }
		);
		expect([limited.rowStart, limited.rowEnd]).toEqual([15, 24]);
	});

	it('clamps max rendered cells by reducing center columns only', () => {
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				rowStart: 2,
				rowEnd: 3,
				colStart: 1,
				colEnd: 7,
				pinLeftCols: 1,
				pinRightCols: 1,
			},
			{ maxRenderedCells: 12 }
		);

		expect(limited.colStart).toBe(1);
		expect(limited.colEnd).toBe(1);
		expect(getColIndices(limited)).toEqual([0, 1, 9]);
	});

	it('keeps clamped ranges valid when limits are smaller than pinned rows and columns', () => {
		const limited = applyRenderWindowRuntimeLimits(
			{
				...baseWindow,
				rowStart: 2,
				rowEnd: 8,
				colStart: 2,
				colEnd: 8,
				pinTopRows: 3,
				pinBottomRows: 3,
				pinLeftCols: 2,
				pinRightCols: 2,
			},
			{ maxRenderedRows: 2, maxRenderedCells: 2 }
		);

		expect(limited.rowEnd).toBeGreaterThanOrEqual(limited.rowStart);
		expect(limited.colEnd).toBeGreaterThanOrEqual(limited.colStart);
		expect(getRowIndices(limited)).toEqual([0, 1, 2, 3, 17, 18, 19]);
		expect(getColIndices(limited)).toEqual([0, 1, 2, 8, 9]);
	});

	it('anchors sticky group rows below pinned top rows', () => {
		const store = new GridStore<{ id: string; category: string; product: string }>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'product', header: 'Product' },
			],
			defaultRowHeight: 40,
			grouping: { by: ['category', 'product'], defaultExpanded: true, stickyHeaders: true, rowHeight: 40 },
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'Hardware', product: 'Workstation' },
				{ id: '2', category: 'Hardware', product: 'Workstation' },
				{ id: '3', category: 'Hardware', product: 'Laptop' },
			],
			columns: store.getState().columns,
		});

		store.setViewportPins({ top: 1 });
		store.setViewportSize(500, 160);
		store.setScrollPosition(80, 0);

		const window = computeRenderWindow(store.engine);
		expect(window.stickyGroupStack?.map((s) => s.visualIndex)).toContain(1);
		const stickyItem = window.stickyGroupStack?.find((s) => s.visualIndex === 1);
		expect(stickyItem?.top).toBe(120);
		expect(window.stickyGroupStack).toEqual([
			{
				groupId: 'group:category=Hardware/product=Workstation',
				visualIndex: 1,
				depth: 1,
				top: 120,
				height: 40,
				lastDescendantIndex: 3,
				boundaryBottom: 160,
				pushed: false,
			},
		]);

		controller.dispose();
		store.destroy();
	});

	it('does not invalidate the row window for sticky group pixel movement only', () => {
		const base = {
			rowStart: 10,
			rowEnd: 20,
			colStart: 0,
			colEnd: 3,
			pinLeftCols: 0,
			pinRightCols: 0,
			pinTopRows: 0,
			pinBottomRows: 0,
			rowCount: 100,
			colCount: 4,
			scrollTop: 120,
			scrollLeft: 0,
			viewportWidth: 500,
			viewportHeight: 300,
			stickyGroupStack: [
				{
					groupId: 'category:Hardware',
					visualIndex: 4,
					depth: 0,
					top: 120,
					height: 40,
					lastDescendantIndex: 30,
					boundaryBottom: 1240,
					pushed: false,
				},
			],
		};

		expect(
			sameRenderedWindow(base, {
				...base,
				scrollTop: 160,
				stickyGroupStack: [{ ...base.stickyGroupStack[0], top: 160 }],
			})
		).toBe(true);
		expect(
			sameRenderedWindow(base, {
				...base,
				stickyGroupStack: [{ ...base.stickyGroupStack[0], pushed: true }],
			})
		).toBe(false);
	});

	it('pushes sticky group rows off at their subtree boundary', () => {
		const store = new GridStore<{ id: string; category: string; product: string }>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'category', header: 'Category' },
				{ field: 'product', header: 'Product' },
			],
			defaultRowHeight: 40,
			grouping: { by: ['category'], defaultExpanded: true, stickyHeaders: true, rowHeight: 40 },
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', category: 'Hardware', product: 'Workstation' },
				{ id: '2', category: 'Hardware', product: 'Laptop' },
				{ id: '3', category: 'Software', product: 'IDE' },
			],
			columns: store.getState().columns,
		});

		store.setViewportSize(500, 160);
		store.setScrollPosition(90, 0);

		const window = computeRenderWindow(store.engine);
		expect(window.stickyGroupStack).toEqual([
			{
				groupId: 'group:category=Hardware',
				visualIndex: 0,
				depth: 0,
				top: 80,
				height: 40,
				lastDescendantIndex: 2,
				boundaryBottom: 120,
				pushed: true,
			},
		]);
		expect(window.stickyGroupStack?.map((s) => s.top)).toEqual([80]);

		controller.dispose();
		store.destroy();
	});
});

// ─── Column Virtualization Architecture Guard ─────────────────────────────────
// These tests lock in the contract that only the visible column slice is bound,
// preventing a silent regression from re-rendering all columns regardless of scroll.

describe('column virtualization', () => {
	function makeWideStore(colCount: number, colWidth: number, colBuffer: number) {
		const columns = Array.from({ length: colCount }, (_, i) => ({
			field: `col_${i}`,
			header: `Col ${i}`,
			width: colWidth,
		}));
		const store = new GridStore<Record<string, unknown>>({
			getRowId: (r) => String(r['id']),
			columns,
			defaultRowHeight: 40,
			colBuffer,
		});
		return { store, columns };
	}

	it('center lane renders only the visible column slice, not all columns', () => {
		const COL_COUNT = 50;
		const COL_WIDTH = 100;
		// viewport = 500px → ~5 active columns; colBuffer=1 → max 7 rendered center cols
		const { store } = makeWideStore(COL_COUNT, COL_WIDTH, 1);
		store.setViewportSize(500, 400);
		store.setScrollPosition(0, 0);

		const w = computeRenderWindow(store.engine);
		const renderedCenterCols = w.colEnd - w.colStart + 1;

		expect(w.colCount).toBe(COL_COUNT);
		// Must render far fewer than all columns
		expect(renderedCenterCols).toBeLessThan(COL_COUNT);
		// With 500px viewport and 100px cols: 5 active + 2×1 buffer = 7 max
		expect(renderedCenterCols).toBeLessThanOrEqual(7);

		store.destroy();
	});

	it('scrolling right advances colStart and colEnd', () => {
		const { store } = makeWideStore(50, 100, 1);
		store.setViewportSize(500, 400);

		store.setScrollPosition(0, 0);
		const w0 = computeRenderWindow(store.engine);

		// Scroll right by 1000px (10 columns worth)
		store.setScrollPosition(0, 1000);
		const w1 = computeRenderWindow(store.engine);

		expect(w1.colStart).toBeGreaterThan(w0.colStart);
		expect(w1.colEnd).toBeGreaterThan(w0.colEnd);

		store.destroy();
	});

	it('scrolling to end reaches the last column', () => {
		const COL_COUNT = 50;
		const COL_WIDTH = 100;
		const { store } = makeWideStore(COL_COUNT, COL_WIDTH, 1);
		store.setViewportSize(500, 400);

		// Scroll all the way to the right
		store.setScrollPosition(0, COL_COUNT * COL_WIDTH);
		const w = computeRenderWindow(store.engine);

		expect(w.colEnd).toBe(COL_COUNT - 1);

		store.destroy();
	});

	it('colBuffer enlarges the rendered window symmetrically', () => {
		const makeAtScroll = (colBuffer: number, scrollLeft: number) => {
			const { store } = makeWideStore(50, 100, colBuffer);
			store.setViewportSize(500, 400);
			store.setScrollPosition(0, scrollLeft);
			const w = computeRenderWindow(store.engine);
			store.destroy();
			return w.colEnd - w.colStart + 1;
		};

		// Scroll to middle so both left and right overscan can expand
		const scroll = 1000;
		const spanWith1 = makeAtScroll(1, scroll);
		const spanWith4 = makeAtScroll(4, scroll);

		// 4 extra cols each side = 6 extra total vs buffer=1
		expect(spanWith4).toBeGreaterThan(spanWith1);
		expect(spanWith4 - spanWith1).toBe(6); // (4-1)*2
	});

	it('pinned columns are never counted in the center colStart/colEnd range', () => {
		const COL_COUNT = 20;
		const columns = Array.from({ length: COL_COUNT }, (_, i) => ({
			field: `col_${i}`,
			header: `Col ${i}`,
			width: 80,
		}));
		const store = new GridStore<Record<string, unknown>>({
			getRowId: (r) => String(r['id']),
			columns,
			defaultRowHeight: 40,
			colBuffer: 1,
		});
		store.setViewportPins({ left: 2, right: 2 });
		store.setViewportSize(500, 400);
		store.setScrollPosition(0, 0);

		const w = computeRenderWindow(store.engine);

		// Pinned cols live outside [colStart, colEnd]
		expect(w.colStart).toBeGreaterThanOrEqual(w.pinLeftCols);
		expect(w.colEnd).toBeLessThanOrEqual(w.colCount - 1 - w.pinRightCols);
		expect(w.pinLeftCols).toBe(2);
		expect(w.pinRightCols).toBe(2);

		store.destroy();
	});

	it('getColIndices includes pinned cols plus only the center slice', () => {
		// 10 total cols, 1 pinned each side, viewport shows ~3 center cols
		const columns = Array.from({ length: 10 }, (_, i) => ({
			field: `col_${i}`,
			header: `Col ${i}`,
			width: 100,
		}));
		const store = new GridStore<Record<string, unknown>>({
			getRowId: (r) => String(r['id']),
			columns,
			defaultRowHeight: 40,
			colBuffer: 0,
		});
		store.setViewportPins({ left: 1, right: 1 });
		store.setViewportSize(300, 400); // 300px shows ~3 center columns
		store.setScrollPosition(0, 0);

		const w = computeRenderWindow(store.engine);
		const rendered = getColIndices(w);

		// Must always include both pinned edges
		expect(rendered).toContain(0); // left-pinned
		expect(rendered).toContain(9); // right-pinned
		// Must NOT render all 10 columns
		expect(rendered.length).toBeLessThan(10);

		store.destroy();
	});
});

describe('sticky group headers with nested groups', () => {
	function makeNestedGrid(pagination?: { pageSize: number }) {
		type Row = { id: string; region: string; category: string };
		const rows: Row[] = [];
		for (const region of ['Americas', 'EMEA']) {
			for (const category of ['Cloud', 'Hardware', 'Software']) {
				for (let i = 0; i < 10; i++) rows.push({ id: `${region}-${category}-${i}`, region, category });
			}
		}
		const store = new GridStore<Row>({
			getRowId: (row) => row.id,
			columns: [
				{ field: 'region', header: 'Region' },
				{ field: 'category', header: 'Category' },
			],
			defaultRowHeight: 40,
			grouping: { by: ['region', 'category'], defaultExpanded: true, stickyHeaders: true, rowHeight: 40 },
			...(pagination ? { pagination: { pageSize: pagination.pageSize, page: 0 } } : {}),
		});
		new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
		store.setViewportSize(500, 200);
		return store;
	}

	const stackAt = (store: ReturnType<typeof makeNestedGrid>, scrollTop: number) => {
		store.setScrollPosition(scrollTop, 0);
		const rowModel = store.engine.getRowModel()!;
		return (computeRenderWindow(store.engine).stickyGroupStack ?? []).map((item) => {
			const row = rowModel.getVisualRow(item.visualIndex);
			return row?.kind === 'group' ? row.keyString : '?';
		});
	};

	it.each([
		['unpaginated', undefined],
		['paginated', { pageSize: 1000 }],
	] as const)('%s: keeps the outer group stuck above the current inner group for the whole outer group', (_label, pagination) => {
		const store = makeNestedGrid(pagination);
		// Rows: Americas(0), Cloud(1), 10 rows, Hardware(12), 10 rows, Software(23), 10 rows, EMEA(34)...
		expect(stackAt(store, 5 * 40)).toEqual(['Americas', 'Cloud']);
		// Past the first sub-group (the old bug: the stack emptied here) and into the second.
		expect(stackAt(store, 15 * 40)).toEqual(['Americas', 'Hardware']);
		expect(stackAt(store, 26 * 40)).toEqual(['Americas', 'Software']);
		// Into the next outer group.
		expect(stackAt(store, 37 * 40)).toEqual(['EMEA', 'Cloud']);
	});
});
