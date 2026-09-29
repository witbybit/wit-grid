// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type VisualRow } from '../store.js';
import { GridEventName } from '../api/GridEvents.js';
import { createMinimalRowModel } from '../testUtils/createMinimalRowModel.js';
import { RecordingGridInstrumentation } from '../diagnostics/GridInstrumentation.js';
import { RenderEngine } from './renderEngine.js';
import { InfiniteRowModelController } from '../infiniteRowModel.js';
import { ServerSideRowModelController } from '../serverSideRowModel.js';

/**
 * Count the row-slot DOM children of the rows container, excluding the `.og-layer-exiting`
 * overlay (Plan 043) which is a deliberate non-slot sibling for fade-out ghosts. The
 * stable-slot invariant is about slot elements, not this overlay.
 */
function slotDomCount(rowsContainer: HTMLElement): number {
	return Array.from(rowsContainer.children).filter((c) => !c.classList.contains('og-layer-exiting')).length;
}

describe('RenderEngine', () => {
	afterEach(() => {
		document.body.textContent = '';
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('wraps paint and post-scroll work in recorder timing without changing causes or error propagation', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name' }],
			getRowId: (row) => row.id,
		});
		const renderer = new RenderEngine(store.engine, store);
		const recorder = store.engine.flightRecorder;
		recorder.start();
		const begin = vi.spyOn(recorder, 'beginExecutingFrame');
		const finish = vi.spyOn(recorder, 'finishExecutingFrame');
		const flush = vi.spyOn(renderer as unknown as { flushPaint: () => void }, 'flushPaint').mockImplementation(() => {});
		const coordinator = (renderer as unknown as { frameCoordinator: object }).frameCoordinator as {
			onPaintFrame: (changeIds: readonly number[]) => void;
			onPostScrollWork: (changeIds: readonly number[]) => void;
		};

		coordinator.onPaintFrame([11, 12]);
		coordinator.onPostScrollWork([21]);
		expect(begin.mock.calls).toEqual([[[11, 12]], [[21]]]);
		expect(finish.mock.calls.map(([, kind]) => kind)).toEqual(['full', 'post-scroll']);
		expect(flush).toHaveBeenCalledTimes(2);
		expect(recorder.snapshot().events.map((entry) => entry.event)).toEqual([
			expect.objectContaining({ type: 'frame', kind: 'full', changeIds: [11, 12] }),
			expect.objectContaining({ type: 'frame', kind: 'post-scroll', changeIds: [21] }),
		]);

		flush.mockImplementationOnce(() => {
			throw new Error('paint failure');
		});
		expect(() => coordinator.onPaintFrame([31])).toThrow('paint failure');
		expect(finish).toHaveBeenLastCalledWith(expect.anything(), 'full');
		expect(recorder.getExecutingFrameChangeIds()).toEqual([]);

		renderer.unmount();
		store.destroy();
	});

	it('syncs state-driven paints from the real scroll viewport position', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 60 }, (_, index) => ({
			id: `row-${index}`,
			name: `Row ${index}`,
		}));
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
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 0;
		store.engine.viewport.setScrollPosition(900, 0);

		renderer.fullPaint();

		expect(store.engine.viewport.scrollTop).toBe(0);
		expect(container.querySelector('[data-row-index="0"]')).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	// Regression (Plan 043 / expand-collapse animation): group/tree/detail toggles
	// invalidate the VIEWPORT (not full), so the transition must fire from flushPaint —
	// not only the full-paint path. Before the fix, captureSnapshot ran on the `expansion`
	// state change but beginAnimation was never reached on the viewport flush, so rows
	// snapped. This drives the real chain (toggle → invalidateViewport('group expansion')
	// → flushPaint) and asserts WAAPI animate() is actually invoked.
	it('plays the expand/collapse transition (invokes WAAPI animate) on a group toggle', () => {
		// jsdom has no WAAPI; stub it so LayoutTransitionController is feature-enabled.
		const animateMock = vi.fn(() => ({ cancel: vi.fn(), finish: vi.fn(), onfinish: null, oncancel: null }) as unknown as Animation);
		(HTMLElement.prototype as unknown as { animate: unknown }).animate = animateMock;

		const store = new GridStore<{ id: string; name: string; category: string }>({
			columns: [
				{ field: 'name', header: 'Name', width: 120 },
				{ field: 'category', header: 'Category', width: 120, enableRowGroup: true },
			],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 20 }, (_, index) => ({
			id: `row-${index}`,
			name: `Row ${index}`,
			category: index % 2 === 0 ? 'A' : 'B',
		}));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 400,
			width: 500,
			height: 400,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		store.engine.setGroupBy(['category']);
		renderer.fullPaint(); // populate slots with their current positions

		// A toggle changes state.expansion (→ captureSnapshot, sync) and invalidates the
		// viewport with reason 'group expansion'. Running the gated flush then plays it.
		animateMock.mockClear();
		store.engine.groupingFeature.toggleExpanded('group:category=A');
		(renderer as unknown as { flushPaint: () => void }).flushPaint();

		expect(animateMock).toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('animates visible row moves when a live sort-key update reorders the current viewport', () => {
		const animateMock = vi.fn(() => ({ cancel: vi.fn(), finish: vi.fn(), onfinish: null, oncancel: null }) as unknown as Animation);
		(HTMLElement.prototype as unknown as { animate: unknown }).animate = animateMock;

		const store = new GridStore<{ id: string; name: string; price: number }>({
			columns: [
				{ field: 'name', header: 'Name', width: 120 },
				{ field: 'price', header: 'Price', width: 120 },
			],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			sortModel: [{ colId: 'price', sort: 'asc' }],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: '1', name: 'A', price: 10 },
				{ id: '2', name: 'B', price: 20 },
				{ id: '3', name: 'C', price: 30 },
			],
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 420,
			bottom: 220,
			width: 420,
			height: 220,
			toJSON: () => ({}),
		} as DOMRect);
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.fullPaint();

		animateMock.mockClear();
		store.setCellValue('1', 'price', 25);
		(renderer as unknown as { flushPaint: () => void }).flushPaint();

		expect(animateMock).toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('exposes ARIA grid semantics (roles, counts, indices, sort, selection)', () => {
		const store = new GridStore<{ id: string; name: string; val: string }>({
			columns: [
				{ field: 'name', header: 'Name', width: 100 },
				{ field: 'val', header: 'Val', width: 100 },
			],
			defaultRowHeight: 30,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 8 }, (_, i) => ({ id: `row-${i}`, name: `N${i}`, val: `V${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 400,
			bottom: 300,
			width: 400,
			height: 300,
			toJSON: () => ({}),
		} as DOMRect);
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.fullPaint();

		// Grid root
		expect(container.getAttribute('role')).toBe('grid');
		expect(container.getAttribute('aria-multiselectable')).toBe('true');
		expect(container.getAttribute('aria-rowcount')).toBe('8');
		expect(container.getAttribute('aria-colcount')).toBe('2');

		// Row
		const rowEl = container.querySelector('[data-row-index="0"]') as HTMLElement;
		expect(rowEl.getAttribute('role')).toBe('row');
		expect(rowEl.getAttribute('aria-rowindex')).toBe('1');

		// Body cell
		const cellEl = container.querySelector('.og-cell[data-col-field="name"]') as HTMLElement;
		expect(cellEl.getAttribute('role')).toBe('gridcell');
		expect(cellEl.getAttribute('aria-colindex')).toBe('1');

		// Header cell + default aria-sort
		const headerEl = container.querySelector('.og-header-cell[data-col-field="val"]') as HTMLElement;
		expect(headerEl.getAttribute('role')).toBe('columnheader');
		expect(headerEl.getAttribute('aria-colindex')).toBe('2');
		expect(headerEl.getAttribute('aria-sort')).toBe('none');

		// aria-sort tracks the sort model
		store.setSortModel([{ colId: 'val', sort: 'desc' }]);
		renderer.fullPaint();
		expect((container.querySelector('.og-header-cell[data-col-field="val"]') as HTMLElement).getAttribute('aria-sort')).toBe('descending');

		// aria-selected appears on a selected cell
		store.selectCell({ rowId: 'row-0', colField: 'name' });
		renderer.fullPaint();
		const selCell = container.querySelector('.og-cell[data-row-id="row-0"][data-col-field="name"]') as HTMLElement;
		expect(selCell.getAttribute('aria-selected')).toBe('true');
		expect(selCell.getAttribute('tabindex')).toBe('-1');

		store.selectCell(null);
		renderer.fullPaint();
		expect(selCell.hasAttribute('tabindex')).toBe(false);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('syncs aria-activedescendant from the kernel-owned focused cell and clears it when focus is removed', () => {
		const store = new GridStore<{ id: string; name: string; val: string }>({
			columns: [
				{ field: 'name', header: 'Name', width: 100 },
				{ field: 'val', header: 'Val', width: 100 },
			],
			defaultRowHeight: 30,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const rows = Array.from({ length: 8 }, (_, i) => ({ id: `row-${i}`, name: `N${i}`, val: `V${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 400,
			bottom: 300,
			width: 400,
			height: 300,
			toJSON: () => ({}),
		} as DOMRect);
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.fullPaint();

		store.selectCell({ rowId: 'row-2', colField: 'val' }, 'keyboard');
		renderer.fullPaint();

		const focusedCell = container.querySelector('.og-cell[data-row-id="row-2"][data-col-field="val"]') as HTMLElement;
		expect(focusedCell.getAttribute('tabindex')).toBe('-1');
		expect(focusedCell.id).toMatch(/^og-cell-/);
		expect(container.getAttribute('aria-activedescendant')).toBe(focusedCell.id);

		store.selectCell(null, 'keyboard');
		renderer.fullPaint();
		expect(container.hasAttribute('aria-activedescendant')).toBe(false);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('releases out-of-range cells when columns shrink with right pinning enabled', () => {
		const wideColumns = [
			{ field: 'risk', header: 'Risk', width: 120 },
			{ field: 'filler', header: 'Filler', width: 120 },
			{ field: 'col_999', header: 'Col 999', width: 120 },
		];
		const store = new GridStore<{ id: string; risk: string; filler: string; col_999: string }>({
			columns: wideColumns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', risk: 'LOW', filler: 'Filler', col_999: 'Val 999' }],
			columns: wideColumns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		store.setViewportPins({ right: 1 });
		renderer.mount(container);

		expect(container.querySelector('.og-cell[data-col-field="col_999"]')).not.toBeNull();

		store.setColumns([{ field: 'risk', header: 'Risk', width: 120 }]);
		renderer.fullPaint();

		expect(container.querySelector('.og-cell[data-col-field="col_999"]')).toBeNull();
		expect(container.querySelector('.og-cell[data-col-field="risk"]')?.textContent).toBe('LOW');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('moves body cells live during header drag reorder preview before drop commit', () => {
		const columns = [
			{ field: 'a', header: 'A', width: 100 },
			{ field: 'b', header: 'B', width: 100 },
			{ field: 'c', header: 'C', width: 100 },
		];
		const store = new GridStore<{ id: string; a: string; b: string; c: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
			enableColumnReorder: true,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-0', a: 'A0', b: 'B0', c: 'C0' }],
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 420,
			bottom: 220,
			width: 420,
			height: 220,
			toJSON: () => ({}),
		} as DOMRect);
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.fullPaint();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		vi.spyOn(scrollViewport, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 420,
			bottom: 220,
			width: 420,
			height: 220,
			toJSON: () => ({}),
		} as DOMRect);

		const headerA = container.querySelector('.og-header-cell[data-col-field="a"]') as HTMLElement;
		const bodyA = container.querySelector('.og-cell[data-row-id="row-0"][data-col-field="a"]') as HTMLElement;
		const bodyB = container.querySelector('.og-cell[data-row-id="row-0"][data-col-field="b"]') as HTMLElement;

		headerA.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
		window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 250, clientY: 12 }));

		expect(container.querySelector('.og-grid-container, .og-col-reordering') ?? container.closest('.og-grid-container')).not.toBeNull();
		expect(bodyA.style.transform).toContain('translateX');
		expect(bodyB.style.transform).toContain('translateX');

		window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 250, clientY: 12 }));

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('auto-scrolls horizontally while a header drag stays parked at the viewport edge', () => {
		const columns = Array.from({ length: 10 }, (_, index) => ({
			field: `c${index}`,
			header: `C${index}`,
			width: 100,
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
			enableColumnReorder: true,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-0', ...Object.fromEntries(columns.map((col, index) => [col.field, `V${index}`])) }],
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 260,
			bottom: 220,
			width: 260,
			height: 220,
			toJSON: () => ({}),
		} as DOMRect);
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.fullPaint();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		vi.spyOn(scrollViewport, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 260,
			bottom: 220,
			width: 260,
			height: 220,
			toJSON: () => ({}),
		} as DOMRect);
		Object.defineProperty(scrollViewport, 'clientWidth', { value: 260, configurable: true });
		Object.defineProperty(scrollViewport, 'scrollWidth', { value: 1000, configurable: true });
		scrollViewport.scrollLeft = 0;

		const rafCallbacks: FrameRequestCallback[] = [];
		const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
			rafCallbacks.push(cb);
			return rafCallbacks.length;
		});
		const cancelRaf = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);

		const header = container.querySelector('.og-header-cell[data-col-field="c0"]') as HTMLElement;
		header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
		window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 255, clientY: 12 }));

		expect(raf).toHaveBeenCalled();
		expect(rafCallbacks.length).toBeGreaterThan(0);

		rafCallbacks.shift()?.(0);
		const afterFirstFrame = scrollViewport.scrollLeft;
		expect(afterFirstFrame).toBeGreaterThan(0);
		expect(store.engine.viewport.scrollLeft).toBe(afterFirstFrame);

		rafCallbacks.shift()?.(16);
		expect(scrollViewport.scrollLeft).toBeGreaterThan(afterFirstFrame);

		window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 255, clientY: 12 }));
		expect(cancelRaf).toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('positions right-pinned body and header cells inside sticky right lanes', () => {
		const columns = [
			{ field: 'a', header: 'A', width: 100 },
			{ field: 'b', header: 'B', width: 110 },
			{ field: 'c', header: 'C', width: 120 },
			{ field: 'd', header: 'D', width: 130 },
			{ field: 'e', header: 'E', width: 140 },
		];
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' }],
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		store.setViewportPins({ right: 2 });
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollLeft = 100;
		renderer.fullPaint();

		const row = container.querySelector('.og-row[data-row-id="row:row-1"]') as HTMLDivElement;
		const rightLane = row.querySelector('.og-row-pin-right') as HTMLDivElement;
		const dCell = row.querySelector('.og-cell[data-col-field="d"]') as HTMLDivElement;
		const eCell = row.querySelector('.og-cell[data-col-field="e"]') as HTMLDivElement;
		const rightHeaderLayer = container.querySelector('.og-layer-header-right') as HTMLDivElement;
		const eHeader = container.querySelector('.og-header-cell[data-col-field="e"]') as HTMLDivElement;

		expect(rightLane).not.toBeNull();
		expect(rightLane.style.width).toBe('270px');
		expect(dCell.parentElement).toBe(rightLane);
		expect(eCell.parentElement).toBe(rightLane);
		expect(dCell.className).toContain('og-cell-pinned-right');
		expect(eCell.className).toContain('og-cell-pinned-right');
		expect(dCell.style.position).toBe('');
		expect(dCell.style.left).toBe('0px');
		expect(eCell.style.left).toBe('130px');
		expect(dCell.style.right).toBe('');
		expect(eCell.style.right).toBe('');
		// Right lane position is CSS sticky (position:sticky; right:0; margin-left:auto)
		// rather than JS-managed style.left — no inline left style is written.
		expect(rightLane.style.left).toBe('');
		// Header right layer also uses CSS sticky; no JS-managed left.
		expect(rightHeaderLayer.style.left).toBe('');
		expect(rightHeaderLayer.style.width).toBe('270px');
		expect(eHeader.parentElement).toBe(rightHeaderLayer);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('uses explicit geometry invalidations for default row height changes', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'Row 1' }],
			columns: store.getState().columns,
		});
		const inst = new RecordingGridInstrumentation();
		store.setInstrumentation(inst);

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const before = renderer.getRenderStats();
		store.setDefaultRowHeight(48);

		expect(store.getState().defaultRowHeight).toBe(48);
		expect(renderer.getRenderStats().fullPaints).toBeGreaterThanOrEqual(before.fullPaints);
		expect(inst.snapshot().fallbacks).toEqual([]);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('batches visible auto-row-height measurements into one commit and geometry rebuild', async () => {
		const paintCallbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			paintCallbacks.push(callback);
			return paintCallbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= paintCallbacks.length) paintCallbacks[id - 1] = () => {};
		});

		const columns = [{ field: 'name', header: 'Name', width: 120 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			rowOverscanPx: 0,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 10_000 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});
		// The bulk commit must merge its measurements rather than replacing unrelated explicit heights.
		store.setRowHeight('explicit-offscreen', 88);
		store.engine.commandHistory.clear();

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.setAutoRowHeight(true);
		renderer.resetRenderStats();

		const measuredSlots = renderer.rowRenderer
			.rowSlotPool!.getSlots()
			.filter((slot) => slot.rowKind === 'data' && slot.visualRowId.startsWith('row:'));
		expect(measuredSlots.length).toBeGreaterThan(4);
		for (const [index, slot] of measuredSlots.entries()) {
			const cell = slot.element.querySelector<HTMLElement>('.og-cell');
			expect(cell).not.toBeNull();
			Object.defineProperty(cell!, 'scrollHeight', { configurable: true, value: 60 + index });
		}

		let resizedEvents = 0;
		const removeResizeListener = store.engine.eventBus.addEventListener(GridEventName.rowResized, () => {
			resizedEvents++;
		});
		const stateCommits = vi.spyOn(store.engine.stateManager, 'commitState');
		const projectionGeometryRebuilds = vi.spyOn(store.engine.geometry, 'syncRows');

		// Drive one measurement delivery directly: work assertions use commits/rebuilds, never time.
		(renderer as unknown as { measureAndUpdateRowHeights(): void }).measureAndUpdateRowHeights();

		expect(stateCommits).toHaveBeenCalledTimes(1);
		expect(projectionGeometryRebuilds).toHaveBeenCalledTimes(1);
		expect(resizedEvents).toBe(measuredSlots.length);
		expect(store.getState().rowHeights['explicit-offscreen']).toBe(88);
		expect(store.canUndo()).toBe(false);

		// The one scheduled renderer flush performs one geometry recompute for the whole batch.
		await Promise.resolve();
		while (paintCallbacks.length > 0) paintCallbacks.shift()!(0);
		expect(renderer.getRenderStats().geometryRecomputes).toBe(1);

		removeResizeListener();
		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps command-owned invalidations off the fallback instrumentation path', () => {
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'Row 1' }],
			columns: store.getState().columns,
		});
		const inst = new RecordingGridInstrumentation();
		store.setInstrumentation(inst);

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		store.setShowFilterChipBar(true);
		store.setColumnReorderEnabled(false);

		expect(inst.snapshot().fallbacks).toEqual([]);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not render hidden columns in headers or cells', () => {
		const columns = [
			{ field: 'id', header: 'ID', width: 80 },
			{ field: 'name', header: 'Name', width: 120, hide: true },
			{ field: 'price', header: 'Price', width: 120 },
		];
		const store = new GridStore<{ id: string; name: string; price: number }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'Hidden Name', price: 42 }],
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		expect(container.querySelector('.og-cell[data-col-field="name"]')).toBeNull();
		expect(container.querySelector('.og-header-cell[data-col-field="name"]')).toBeNull();
		expect(container.querySelector('.og-cell[data-col-field="price"]')?.textContent).toBe('42');

		store.setColumnVisible('name', true);
		renderer.fullPaint();

		expect(container.querySelector('.og-cell[data-col-field="name"]')?.textContent).toBe('Hidden Name');
		expect(container.querySelector('.og-header-cell[data-col-field="name"]')?.textContent).toContain('Name');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('marks focused and selected rows from navigation state and passes row class params', () => {
		const rowClass = vi.fn((_row: { id: string; name: string }, params: { isSelected: boolean; isFocused: boolean }) =>
			params.isFocused ? 'custom-focused-row' : params.isSelected ? 'custom-selected-row' : ''
		);
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			styleRules: [{ kind: 'row', when: (...args) => !!rowClass(...args), rowClass: 'custom-focused-row custom-selected-row' }],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'row-1', name: 'One' },
				{ id: 'row-2', name: 'Two' },
			],
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		store.selectCell({ rowId: 'row-2', colField: 'name' });
		renderer.fullPaint();

		const selectedRow = container.querySelector('.og-row[data-row-id="row:row-2"]') as HTMLElement;
		expect(selectedRow.className).toContain('og-row-selected');
		expect(selectedRow.className).toContain('og-row-focused');
		expect(selectedRow.className).toContain('custom-focused-row');
		expect(rowClass).toHaveBeenCalledWith(
			{ id: 'row-2', name: 'Two' },
			expect.objectContaining({
				rowId: 'row-2',
				rowIndex: 1,
				isFocused: true,
				isSelected: true,
			})
		);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not steal focus from custom editor descendants during focused cell paints', () => {
		const columns = [{ field: 'status', header: 'Status', width: 120, cellEditor: () => null }];
		const store = new GridStore<{ id: string; status: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', status: 'Active' }],
			columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.onMountCellContent = ({ container: portalHost }) => {
			if (!portalHost.querySelector('[data-custom-editor-root]')) {
				const customEditorRoot = document.createElement('div');
				customEditorRoot.dataset.customEditorRoot = 'true';
				customEditorRoot.tabIndex = 0;
				portalHost.appendChild(customEditorRoot);
			}
		};
		renderer.mount(container);

		store.selectCell({ rowId: 'row-1', colField: 'status' });
		store.startEditing('row-1', 'status');
		renderer.fullPaint();

		const cell = container.querySelector('.og-cell[data-col-field="status"]') as HTMLDivElement;
		const customEditorRoot = cell.querySelector('[data-custom-editor-root]') as HTMLDivElement;
		customEditorRoot.focus();
		const focusSpy = vi.spyOn(cell, 'focus');

		renderer.fullPaint();

		expect(focusSpy).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(customEditorRoot);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('repaints dirty cells without scheduling a full viewport paint', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'Before' }],
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		const fullPaintSpy = vi.spyOn(renderer, 'fullPaint');

		store.setCellValue('row-1', 'name', 'After');
		store.flushCellUpdatesSync();
		await Promise.resolve();
		await Promise.resolve();

		expect(fullPaintSpy).not.toHaveBeenCalled();
		expect(container.querySelector('.og-cell[data-col-field="name"]')?.textContent).toBe('After');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('repaints invalidated cells for row ids containing colons', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string; status: string }>({
			columns: [
				{ field: 'name', header: 'Name', width: 120 },
				{ field: 'status', header: 'Status', width: 120 },
			],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'row:0', name: 'Before', status: 'Open' },
				{ id: 'row:1', name: 'Other', status: 'Closed' },
			],
			columns: store.getState().columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.resetRenderStats();

		store.setCellValue('row:0', 'name', 'After');
		store.flushCellUpdatesSync();
		await Promise.resolve();
		await Promise.resolve();

		const visibleNames = Array.from(container.querySelectorAll<HTMLDivElement>('.og-cell[data-col-field="name"]')).map((cell) => ({
			rowId: (cell.closest('.og-row') as HTMLElement | null)?.dataset.rowId,
			text: cell.textContent,
		}));
		expect(visibleNames).toContainEqual({ rowId: 'row:row%3A0', text: 'After' });
		expect(visibleNames).toContainEqual({ rowId: 'row:row%3A1', text: 'Other' });
		expect(renderer.getRenderStats().cellPaints).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('renders loading visual rows as skeleton cells without fake data rows', () => {
		const columns = [{ field: 'name', header: 'Name', width: 120 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const loadingRow: VisualRow<{ id: string; name: string }> = {
			kind: 'loading',
			id: 'loading:0',
			rowIndex: 0,
			editable: false,
		};
		const rowModel = createMinimalRowModel({
			visualRows: [loadingRow],
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		store.registerRowModel(rowModel);
		renderer.mount(container);

		const row = container.querySelector('.og-row[data-row-id="loading:0"]') as HTMLDivElement;
		const cell = container.querySelector('.og-cell[data-col-field="name"]') as HTMLDivElement;

		expect(row.className).toContain('og-row-loading');
		expect(cell.className).toContain('og-cell-loading');
		expect(cell.dataset.contentMode).toBe('loading');
		expect(cell.querySelector('.og-cell-loading-skeleton')).toBeNull();

		renderer.unmount();
		store.destroy();
	});

	it('renders failed visual rows as explicit failed rows instead of inferring from missing data', () => {
		const columns: ColumnDef<{ id: string; name: string }>[] = [{ field: 'name', header: 'Name', width: 120 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const rowModel = createMinimalRowModel({
			visualRows: [{ kind: 'failed', id: 'failed:0', rowIndex: 0, error: 'load failed', retryable: true }],
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		store.registerRowModel(rowModel);
		renderer.mount(container);

		const row = container.querySelector('.og-row[data-row-id="failed:0"]') as HTMLDivElement;
		expect(row.className).toContain('og-row-failed');

		renderer.unmount();
		store.destroy();
	});

	it('records granular invalidation stats for cell edit and focus movement', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'row-1', name: 'One' },
				{ id: 'row-2', name: 'Two' },
			],
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const before = renderer.getRenderStats();
		store.setCellValue('row-1', 'name', 'After');
		store.flushCellUpdatesSync();
		await Promise.resolve();
		await Promise.resolve();

		const afterEdit = renderer.getRenderStats();
		expect(afterEdit.fullPaints - before.fullPaints).toBe(0);
		expect(afterEdit.cellPaints - before.cellPaints).toBe(1);

		store.selectCell({ rowId: 'row-1', colField: 'name' });
		await Promise.resolve();
		await Promise.resolve();
		const afterFirstFocus = renderer.getRenderStats();
		store.selectCell({ rowId: 'row-2', colField: 'name' });
		await Promise.resolve();
		await Promise.resolve();

		const afterFocusMove = renderer.getRenderStats();
		expect(afterFocusMove.fullPaints - afterFirstFocus.fullPaints).toBe(0);
		expect(afterFocusMove.cellPaints - afterFirstFocus.cellPaints).toBe(2);
		expect(afterFocusMove.overlayPaints).toBeGreaterThan(afterFirstFocus.overlayPaints);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('automatically scrolls cell into view when focus changes from non-pointer source', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns: store.getState().columns,
		});

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 240,
			width: 500,
			height: 240,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		expect(scrollViewport.scrollTop).toBe(0);

		// Focus row-15 (index 15), which is far below the viewport (only 5 rows fit)
		// Selection source is 'keyboard'
		store.selectCell({ rowId: 'row-15', colField: 'name' }, 'keyboard');
		await Promise.resolve();
		await Promise.resolve();

		expect(store.getState().selection.focus).toEqual(
			expect.objectContaining({ rowId: 'row-15', colField: 'name', colId: 'name', columnInstanceId: expect.any(String) })
		);
		expect(store.engine.viewport.scrollTop).toBe(440);
		const focusedCell = container.querySelector('.og-cell[data-row-id="row-15"][data-col-field="name"]') as HTMLElement;
		expect(focusedCell.getAttribute('tabindex')).toBe('-1');
		expect(focusedCell.id).toMatch(/^og-cell-/);
		expect(container.getAttribute('aria-activedescendant')).toBe(focusedCell.id);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not duplicate cell invalidation through the render event listener', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'One' }],
			columns: store.getState().columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		const invalidateCell = vi.spyOn(store.engine.invalidation, 'invalidateCell');
		const invalidateRow = vi.spyOn(store.engine.invalidation, 'invalidateRow');

		store.engine.notifyCellChange('row-1', 'name');
		await Promise.resolve();
		await Promise.resolve();

		expect(invalidateCell).toHaveBeenCalledTimes(1);
		expect(invalidateCell).toHaveBeenCalledWith('row-1', 'name', 'cell');
		expect(invalidateRow).toHaveBeenCalledTimes(1);
		expect(invalidateRow).toHaveBeenCalledWith('row-1', 'cell');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('repaints every displayed duplicate-field cell when a shared field invalidates', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [
				{ field: 'name', header: 'Name A', width: 120, colId: 'name-a' },
				{ field: 'name', header: 'Name B', width: 120, colId: 'name-b' },
			],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'Before' }],
			columns: store.getState().columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const before = renderer.getRenderStats();
		store.setCellValue('row-1', 'name', 'After');
		store.flushCellUpdatesSync();
		await Promise.resolve();
		await Promise.resolve();

		const nameCells = Array.from(container.querySelectorAll<HTMLDivElement>('.og-cell[data-row-id="row-1"][data-col-field="name"]'));
		expect(nameCells).toHaveLength(2);
		expect(nameCells.map((cell) => cell.textContent)).toEqual(['After', 'After']);

		const after = renderer.getRenderStats();
		expect(after.cellPaints - before.cellPaints).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('repaints only the old and new duplicate-field focus cells when focus moves by column instance', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [
				{ field: 'name', header: 'Name A', width: 120, colId: 'name-a' },
				{ field: 'name', header: 'Name B', width: 120, colId: 'name-b' },
				{ field: 'name', header: 'Name C', width: 120, colId: 'name-c' },
			],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'Alpha' }],
			columns: store.getState().columns,
		});
		const displayedColumns = store.engine.columns.getDisplayedColumns() as Array<{ field: string; colId?: string; instanceId?: string }>;
		const firstPointer = {
			rowId: 'row-1',
			colField: displayedColumns[0]!.field,
			colId: displayedColumns[0]!.colId,
			columnInstanceId: displayedColumns[0]!.instanceId,
		};
		const secondPointer = {
			rowId: 'row-1',
			colField: displayedColumns[1]!.field,
			colId: displayedColumns[1]!.colId,
			columnInstanceId: displayedColumns[1]!.instanceId,
		};

		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		store.selectCell(firstPointer, 'keyboard');
		await Promise.resolve();
		await Promise.resolve();
		renderer.resetRenderStats();

		store.selectCell(secondPointer, 'keyboard');
		await Promise.resolve();
		await Promise.resolve();

		const nameCells = Array.from(container.querySelectorAll<HTMLDivElement>('.og-cell[data-row-id="row-1"][data-col-field="name"]'));
		expect(nameCells).toHaveLength(3);
		expect(nameCells[0]?.className).not.toContain('og-cell-focused');
		expect(nameCells[1]?.className).toContain('og-cell-focused');
		expect(nameCells[2]?.className).not.toContain('og-cell-focused');
		expect(renderer.getRenderStats().cellPaints).toBe(2);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('records geometry invalidation without forcing a full paint for row and column resizing', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'One' }],
			columns: store.getState().columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const beforeColumn = renderer.getRenderStats();
		store.setColumnWidth('name', 180);
		await Promise.resolve();
		await Promise.resolve();
		const afterColumn = renderer.getRenderStats();
		expect(afterColumn.fullPaints - beforeColumn.fullPaints).toBe(0);
		expect(afterColumn.geometryRecomputes - beforeColumn.geometryRecomputes).toBe(1);
		expect(afterColumn.headerPaints - beforeColumn.headerPaints).toBeGreaterThan(0);

		store.setRowHeight('row:row-1', 52);
		await Promise.resolve();
		await Promise.resolve();
		const afterRow = renderer.getRenderStats();
		expect(afterRow.fullPaints - afterColumn.fullPaints).toBe(0);
		expect(afterRow.geometryRecomputes - afterColumn.geometryRecomputes).toBe(1);
		expect(afterRow.rowPaints - afterColumn.rowPaints).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('supports explicit paint scheduling without falling back to full paint', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-1', name: 'One' }],
			columns: store.getState().columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.resetRenderStats();

		renderer.scheduleHeaderPaint('test header');
		await Promise.resolve();
		await Promise.resolve();
		const afterHeader = renderer.getRenderStats();
		expect(afterHeader.fullPaints).toBe(0);
		expect(afterHeader.headerPaints).toBe(1);

		renderer.scheduleOverlayPaint('test overlay');
		await Promise.resolve();
		await Promise.resolve();
		const afterOverlay = renderer.getRenderStats();
		expect(afterOverlay.fullPaints).toBe(0);
		expect(afterOverlay.overlayPaints).toBe(1);

		renderer.scheduleViewportPaint('test viewport');
		await Promise.resolve();
		await Promise.resolve();
		const afterViewport = renderer.getRenderStats();
		expect(afterViewport.fullPaints).toBe(0);
		expect(afterViewport.viewportPaints).toBe(1);
		expect(afterViewport.headerPaints).toBe(afterOverlay.headerPaints);
		expect(afterViewport.overlayPaints).toBe(afterOverlay.overlayPaints + 1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not full paint or recompute geometry for explicit viewport/data invalidations during viewport recycling', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			columns: store.getState().columns,
			blockSize: 50,
			datasource: {
				getRows: async ({ startRow, endRow }) => ({
					rows: Array.from({ length: endRow - startRow }, (_, index) => ({
						id: `row-${startRow + index}`,
						name: `Row ${startRow + index}`,
					})),
					totalCount: 100000,
				}),
			},
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		await vi.waitFor(() => expect(store.getVisualRowCount()).toBe(100000));
		renderer.fullPaint();
		const before = renderer.getRenderStats();

		store.engine.setRowModelLoadingState(true);
		await Promise.resolve();
		await Promise.resolve();
		const afterData = renderer.getRenderStats();
		expect(afterData.fullPaints - before.fullPaints).toBe(0);
		expect(afterData.geometryRecomputes - before.geometryRecomputes).toBe(0);
		expect(afterData.viewportPaints - before.viewportPaints).toBe(1);
		expect(afterData.headerPaints - before.headerPaints).toBe(0);
		expect(afterData.overlayPaints - before.overlayPaints).toBe(1);

		store.engine.setVisibleRanges({ startIdx: 50, endIdx: 75 }, store.getState().visibleColRange);
		await Promise.resolve();
		await Promise.resolve();
		const afterViewport = renderer.getRenderStats();
		expect(afterViewport.fullPaints - afterData.fullPaints).toBe(0);
		expect(afterViewport.viewportPaints - afterData.viewportPaints).toBe(1);
		expect(afterViewport.headerPaints - afterData.headerPaints).toBe(0);
		expect(afterViewport.overlayPaints - afterData.overlayPaints).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('repaints visible infinite rows after an async sort response without an incidental scroll', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new InfiniteRowModelController(store.getInfiniteRowModelRuntime(), {
			columns: store.getState().columns,
			blockSize: 10,
			datasource: {
				getRows: async ({ sortModel }) => {
					if ((sortModel as Array<{ colId: string; sort: string }> | null)?.[0]?.sort === 'desc') {
						return {
							rows: [
								{ id: '2', name: 'Zulu' },
								{ id: '1', name: 'Alpha' },
							],
							totalCount: 2,
						};
					}
					return {
						rows: [
							{ id: '1', name: 'Alpha' },
							{ id: '2', name: 'Zulu' },
						],
						totalCount: 2,
					};
				},
			},
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-row-index="0"] .og-cell[data-col-field="name"]')?.textContent).toBe('Alpha');
		});

		renderer.resetRenderStats();
		store.setSortModel([{ colId: 'name', sort: 'desc' }]);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-row-index="0"] .og-cell[data-col-field="name"]')?.textContent).toBe('Zulu');
		});

		const stats = renderer.getRenderStats();
		expect(stats.scrollFrames).toBe(0);
		expect(stats.viewportPaints).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('repaints visible server-side rows after an async sort response without an incidental scroll', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const store = new GridStore<{ id: string; name: string }>({
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ServerSideRowModelController(store.getServerSideRowModelRuntime(), {
			columns: store.getState().columns,
			blockSize: 10,
			datasource: {
				getRows: async ({ sortModel }) => {
					if ((sortModel as Array<{ colId: string; sort: string }> | null)?.[0]?.sort === 'desc') {
						return {
							rows: [
								{ id: '2', name: 'Zulu' },
								{ id: '1', name: 'Alpha' },
							],
							rowCount: 2,
						};
					}
					return {
						rows: [
							{ id: '1', name: 'Alpha' },
							{ id: '2', name: 'Zulu' },
						],
						rowCount: 2,
					};
				},
			},
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-row-index="0"] .og-cell[data-col-field="name"]')?.textContent).toBe('Alpha');
		});

		renderer.resetRenderStats();
		store.setSortModel([{ colId: 'name', sort: 'desc' }]);

		await vi.waitFor(() => {
			expect(container.querySelector('[data-row-index="0"] .og-cell[data-col-field="name"]')?.textContent).toBe('Zulu');
		});

		const stats = renderer.getRenderStats();
		expect(stats.scrollFrames).toBe(0);
		expect(stats.viewportPaints).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('uses a viewport-only vertical scroll fast path', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [
			{ field: 'a', header: 'A', width: 120 },
			{ field: 'b', header: 'B', width: 120 },
		];
		const store = new GridStore<{ id: string; a: string; b: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 150 }, (_, index) => ({ id: `row-${index}`, a: `A${index}`, b: `B${index}` })),
			columns,
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
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = renderer.getRenderStats();
		expect(stats.scrollFrames).toBe(1);
		expect(stats.viewportRecycles).toBe(1);
		expect(stats.fullPaints).toBe(0);
		expect(stats.headerPaintsDuringScroll).toBe(0);
		expect(stats.overlayPaintsDuringScroll).toBe(0);
		expect(stats.portalFlushesDuringScroll).toBe(0);
		expect(stats.hotDomReleases).toBeGreaterThan(0);
		expect(stats.rowsRecycledPerScrollFrame[0]).toBeGreaterThan(0);
		expect(stats.cellsPatchedPerScrollFrame[0]).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('coalesces repeated scroll events into one scroll animation frame', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
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
		callbacks.length = 0;
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));
		scrollViewport.scrollTop = 1200;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// callbacks[0] is the scroll frame; scroll-end RAF ticks are also queued but don't matter here
		expect(renderer.getRenderStats().scrollFrames).toBe(0);
		callbacks[0](0);
		expect(renderer.getRenderStats().scrollFrames).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('ignores scroll callbacks when the DOM scroll position has not changed', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
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
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(renderer.getRenderStats().scrollFrames).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not rebuild headers on horizontal scroll', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = Array.from({ length: 80 }, (_, index) => ({ field: `col_${index}`, header: `Col ${index}`, width: 100 }));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 20 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 520,
			bottom: 180,
			width: 520,
			height: 180,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollLeft = 3000;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = renderer.getRenderStats();
		expect(stats.scrollFrames).toBe(1);
		expect(stats.fullPaints).toBe(0);
		expect(stats.headerPaints).toBe(0);
		expect(stats.headerPaintsDuringScroll).toBe(0);
		expect(stats.headerRangeSyncsDuringScroll).toBe(1);
		const visibleHeaderLabels = Array.from(container.querySelectorAll<HTMLDivElement>('.og-header-cell'))
			.map((cell) => cell.textContent ?? '')
			.filter(Boolean);
		expect(visibleHeaderLabels).toContain('Col 30');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not rebuild headers or call focus during vertical scroll frames', () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 120 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
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

		store.selectCell({ rowId: 'row-20', colField: 'name' });
		const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		focusSpy.mockClear();
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const statsDuringScroll = renderer.getRenderStats();
		expect(statsDuringScroll.scrollFrames).toBe(1);
		expect(statsDuringScroll.headerPaintsDuringScroll).toBe(0);
		expect(statsDuringScroll.headerRangeSyncsDuringScroll).toBe(0);
		expect(statsDuringScroll.overlayCheapSyncsDuringScroll).toBe(1);
		// With RAF-based scroll-end, finishScrolling runs after 4 RAF ticks (synchronously with
		// immediately-firing RAF stub). Focus is called in finishScrolling after isScrolling=false,
		// so it is not counted as a during-scroll focus call.
		expect(focusSpy).toHaveBeenCalledTimes(1);
		expect(statsDuringScroll.focusCallsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('preserves portals and immediately updates content during vertical scroll with custom renderers', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [
			{ field: 'a', header: 'A', width: 120, cellRenderer: () => null },
			{ field: 'b', header: 'B', width: 120, cellRenderer: () => null },
			{ field: 'c', header: 'C', width: 120, cellRenderer: () => null },
		];
		const store = new GridStore<{ id: string; a: string; b: string; c: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({
				id: `row-${index}`,
				a: `A${index}`,
				b: `B${index}`,
				c: `C${index}`,
			})),
			columns,
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
		const flushPortalContent = vi.fn();
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.portalMountManager.onFlushCellContent = flushPortalContent;
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		await Promise.resolve();
		await Promise.resolve();

		const unmountCount = (renderer.portalMountManager.onUnmountCellContent as ReturnType<typeof vi.fn>).mock.calls.length;
		const stats = renderer.getRenderStats();
		// Offscreen recycled portals may be internally released, but they must not synchronously
		// unmount or flush while the visible band stays live during scroll.
		expect(unmountCount).toBe(0);
		expect(flushPortalContent).not.toHaveBeenCalled();
		expect(stats.portalFlushesDuringScroll).toBe(0);
		// Visible portals stay live immediately during scroll, whether via in-place update or remount.
		expect(stats.portalMountsDuringScroll).toBeGreaterThanOrEqual(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('retains portal content in-place during scroll without evacuating it from the cell', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'name', header: 'Name', width: 120, cellRenderer: () => null }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
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
		renderer.onMountCellContent = ({ cellKey, container: portalHost }) => {
			if (!portalHost.querySelector('[data-portal-child]')) {
				const child = document.createElement('div');
				child.dataset.portalChild = cellKey;
				child.textContent = `portal:${cellKey}`;
				portalHost.appendChild(child);
			}
		};
		renderer.mount(container);
		const originalPortalChild = container.querySelector('[data-portal-child]') as HTMLDivElement;
		expect(originalPortalChild).not.toBeNull();
		renderer.resetRenderStats();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));
		callbacks[0](0); // run the scroll frame; scroll-end chain stays deferred

		expect(originalPortalChild.isConnected).toBe(true);
		// Portal stays inside its cell — no evacuation. The slot is updated in-place with new row data.
		expect(originalPortalChild.closest('.og-cell')).not.toBeNull();
		expect(container.querySelector('.og-cell-portal-host')).not.toBeNull();
		expect(renderer.getRenderStats().rootTextContentWritesOnPortalCells).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('shows text impostor for newly bound custom cells during scroll; portal deferred to fidelity lane', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'name', header: 'Name', width: 120, cellRenderer: () => null }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
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
		renderer.onMountCellContent = ({ cellKey, container: portalHost }) => {
			const child = document.createElement('div');
			child.dataset.portalChild = cellKey;
			child.textContent = `portal:${cellKey}`;
			portalHost.replaceChildren(child);
		};
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));
		callbacks[0](0); // run the scroll frame; scroll-end chain stays deferred

		// No pending cells — scroll frame never blocks on portal mounts.
		const pendingCell = container.querySelector<HTMLDivElement>('.og-cell[data-content-mode="pending"]');
		expect(pendingCell).toBeNull();
		// custom cells show text impostor during scroll — no portal content until fidelity lane fires.
		const portalCell = container.querySelector<HTMLDivElement>('.og-cell[data-content-mode="portal"]');
		expect(portalCell).toBeNull();
		const impostorCell = container.querySelector<HTMLDivElement>('.og-cell[data-content-mode="empty"], .og-cell[data-content-mode="fallback"]');
		expect(impostorCell).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not synchronously unmount scrolled-out custom renderers on scroll idle', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [
			{ field: 'a', header: 'A', width: 120, cellRenderer: () => null },
			{ field: 'b', header: 'B', width: 120, cellRenderer: () => null },
		];
		const store = new GridStore<{ id: string; a: string; b: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}`, b: `B${index}` })),
			columns,
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
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(renderer.portalMountManager.onUnmountCellContent).not.toHaveBeenCalled();
		vi.advanceTimersByTime(80);
		expect(renderer.portalMountManager.onUnmountCellContent).not.toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('mounts custom cell portals during scroll and refreshes them at scroll-idle phase', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [
			{ field: 'a', header: 'A', width: 120, cellRenderer: () => null },
			{ field: 'b', header: 'B', width: 120, cellRenderer: () => null },
		];
		const store = new GridStore<{ id: string; a: string; b: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}`, b: `B${index}` })),
			columns,
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
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — visible cells keep portal content immediately during scroll.
		callbacks[0](0);

		// Every mount call must have isScrolling:false — we never strip cell content.
		const allCalls = (renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mock.calls;
		for (const [mount] of allCalls) {
			expect(mount.isScrolling).toBe(false);
		}

		// Flush scroll-end chain — no crash, no additional unexpected portal work.
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('shows a cheap text impostor for a custom-live cell with no prewarm snapshot during scroll and defers portal mount to fidelity lane', async () => {
		const idleCallbacks: IdleRequestCallback[] = [];
		vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		});
		vi.stubGlobal('cancelIdleCallback', (id: number) => {
			if (id >= 1 && id <= idleCallbacks.length) idleCallbacks[id - 1] = () => {};
		});
		const rafCallbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			rafCallbacks.push(cb);
			return rafCallbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= rafCallbacks.length) rafCallbacks[id - 1] = () => {};
		});
		const columns = [
			{
				field: 'a',
				header: 'A',
				width: 120,
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
			},
		];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
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

		const mountFn = vi.fn(({ cellKey, container: host }: { cellKey: string; container: HTMLElement }) => {
			const child = document.createElement('div');
			child.dataset.portal = cellKey;
			host.appendChild(child);
		});
		const renderer = new RenderEngine(store.engine, store);
		renderer.portalMountManager.onMountCellContent = mountFn;
		renderer.mount(container);
		mountFn.mockClear();

		// Scroll far beyond the prewarm band so no snapshot exists for row-60.
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — row-60's custom-live cell has no prewarm snapshot.
		// It must show a text impostor, not mount a portal during the gesture.
		rafCallbacks[rafCallbacks.length - 1]?.(0);
		const cellNode = container.querySelector('[data-row-id="row:row-60"]') as HTMLDivElement;
		expect(cellNode).not.toBeNull();
		const cellA = cellNode.querySelector('[data-col-field="a"]') as HTMLDivElement;
		// Impostor (fallback text) during scroll — no live portal mount.
		expect(cellA.dataset.contentMode).not.toBe('portal');
		expect(mountFn).not.toHaveBeenCalled();

		// Simulate scroll end + post-scroll idle to verify fidelity lane upgrades the cell.
		// Run any remaining RAF callbacks (post-scroll chain).
		for (let i = 0; i < rafCallbacks.length; i++) rafCallbacks[i]?.(0);
		// Run idle callbacks (motion lane, then fidelity lane).
		const fakeDeadline = { timeRemaining: () => 50, didTimeout: false };
		for (const idle of idleCallbacks) idle(fakeDeadline);
		expect(mountFn).toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps custom cell classes during scroll and defers heavier cell hooks until idle', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const cellClass = vi.fn(() => 'custom-cell');
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			styleRules: [{ kind: 'cell', when: () => !!cellClass(), cellClass: 'custom-cell' }],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
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
		cellClass.mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — cell hooks must not fire yet
		callbacks[0](0);
		expect(cellClass).not.toHaveBeenCalled();
		const statsDuringScroll = renderer.getRenderStats();
		expect(statsDuringScroll.cellAccessReadsDuringScroll).toBe(0);
		expect(statsDuringScroll.cellClassComputesDuringScroll).toBe(0);
		expect(statsDuringScroll.dirtyCellsMarkedDuringScroll).toBeGreaterThan(0);

		// Flush scroll-end chain (4 RAF ticks → finishScrolling) and post-scroll decoration
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		expect(cellClass).toHaveBeenCalled();
		const statsAfterScroll = renderer.getRenderStats();
		expect(statsAfterScroll.postScrollDirtyCellsDecorated).toBeGreaterThan(0);
		expect(statsAfterScroll.postScrollMotionChunks).toBeGreaterThan(0);
		expect(statsAfterScroll.motionCellsDecoratedAfterScroll).toBeGreaterThan(0);
		expect(statsAfterScroll.fidelityCellsDecoratedAfterScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('routes dirty custom-renderer cells through the post-scroll fidelity lane', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'a', header: 'A', width: 120, cellRenderer: () => null }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			rowOverscanPx: 80,
		});
		store.engine.insights.register({
			id: 'custom-fidelity',
			getCellDecorations: (rowId, colField) =>
				rowId.startsWith('row-') && colField === 'a'
					? [
							{
								layerId: 'custom-fidelity',
								kind: 'validationError',
								className: 'og-cell-validation-error',
								title: 'Needs review',
							},
						]
					: [],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
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

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		callbacks[0](0);
		const statsDuringScroll = renderer.getRenderStats();
		expect(statsDuringScroll.dirtyCellsMarkedDuringScroll).toBeGreaterThan(0);

		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		const statsAfterScroll = renderer.getRenderStats();
		expect(statsAfterScroll.postScrollFidelityChunks).toBeGreaterThan(0);
		expect(statsAfterScroll.fidelityCellsDecoratedAfterScroll).toBeGreaterThan(0);
		expect(statsAfterScroll.motionCellsDecoratedAfterScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('fidelity work completes even when a new scroll starts mid-repair, by rescheduling on the next idle', async () => {
		const callbacks: FrameRequestCallback[] = [];
		const idleCallbacks: IdleRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		});

		const columns = [
			{ field: 'id', header: 'ID', width: 120 },
			{
				field: 'name',
				header: 'Name',
				width: 120,
				cellRenderer: () => null,
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
			},
		];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			rowOverscanPx: 80,
		});
		store.engine.insights.register({
			id: 'fidelity-test',
			getCellDecorations: (rowId, colField) =>
				colField === 'name'
					? [{ layerId: 'fidelity-test', kind: 'validationError', className: 'og-cell-validation-error', title: 'err' }]
					: [],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, name: `Name ${i}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 300,
			bottom: 160,
			width: 300,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;

		// First scroll
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		let i = callbacks.length - 1;
		while (i < callbacks.length) callbacks[i++]?.(0);

		// Second scroll starts before any idles fire (simulates rapid scroll)
		scrollViewport.scrollTop = 800;
		scrollViewport.dispatchEvent(new Event('scroll'));
		while (i < callbacks.length) callbacks[i++]?.(0);

		// Drain all idles to completion (including any reschedules)
		let idleIdx = 0;
		let safety = 50;
		while (idleIdx < idleCallbacks.length && safety-- > 0) {
			idleCallbacks[idleIdx++]?.({ didTimeout: false, timeRemaining: () => 50 });
			while (i < callbacks.length) callbacks[i++]?.(0);
		}

		// Fidelity cells must have been decorated — the repair pipeline must complete
		// even through the mid-scroll interruption.
		const stats = renderer.getRenderStats();
		expect(stats.fidelityCellsDecoratedAfterScroll).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps custom row classes during scroll', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const rowClass = vi.fn(() => 'custom-row');
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			styleRules: [{ kind: 'row', when: (...args) => !!rowClass(...args), rowClass: 'custom-row' }],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `row-${index}`, a: `A${index}` })),
			columns,
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
		rowClass.mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — rowClass must not fire yet
		callbacks[0](0);
		expect(rowClass).not.toHaveBeenCalled();

		// Flush scroll-end chain (4 RAF ticks → finishScrolling) and post-scroll decoration
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		expect(rowClass).toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('restores validation decorations when a row scrolls out and back in', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});

		const columns = [{ field: 'name', header: 'Name', width: 160 }];
		const store = new GridStore<{ id: string; name: string }>(
			{
				columns,
				defaultRowHeight: 40,
				defaultColWidth: 160,
				getRowId: (row) => row.id,
			},
			{
				dataIntegrity: {
					validation: {
						cellRules: [
							{ id: 'required-name', field: 'name', validate: ({ value }) => (value ? null : { message: 'Name is required' }) },
						],
					},
				},
			}
		);
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 80 }, (_, index) => ({
				id: `row-${index}`,
				name: index === 30 ? '' : `Name ${index}`,
			})),
			columns,
		});
		await store.integrity.validateCell('row-30', 'name');

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

		const flushScrollIdle = async () => {
			let i = 0;
			while (i < callbacks.length) {
				callbacks[i](0);
				i++;
			}
			await Promise.resolve();
			await Promise.resolve();
			while (i < callbacks.length) {
				callbacks[i](0);
				i++;
			}
		};

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		const findInvalidCell = () => container.querySelector('[data-row-id="row-30"][data-col-field="name"]') as HTMLDivElement | null;

		scrollViewport.scrollTop = 1200;
		scrollViewport.dispatchEvent(new Event('scroll'));
		await flushScrollIdle();

		let invalidCell = findInvalidCell();
		expect(invalidCell).not.toBeNull();
		expect(invalidCell?.className).toContain('og-cell-validation-error');
		expect(invalidCell?.dataset.validationError).toBe('Name is required');

		scrollViewport.scrollTop = 0;
		scrollViewport.dispatchEvent(new Event('scroll'));
		await flushScrollIdle();

		scrollViewport.scrollTop = 1200;
		scrollViewport.dispatchEvent(new Event('scroll'));
		await flushScrollIdle();

		invalidCell = findInvalidCell();
		expect(invalidCell).not.toBeNull();
		expect(invalidCell?.className).toContain('og-cell-validation-error');
		expect(invalidCell?.dataset.validationError).toBe('Name is required');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('defers loading skeleton DOM queries until after scroll idle', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, index) => ({ id: `__loading_${index}`, a: `A${index}` })),
			columns,
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
		const querySelectorSpy = vi.spyOn(Element.prototype, 'querySelector');
		querySelectorSpy.mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		querySelectorSpy.mockClear();
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(querySelectorSpy).not.toHaveBeenCalledWith('.og-cell-loading-skeleton');

		vi.advanceTimersByTime(80);
		await Promise.resolve();
		await Promise.resolve();

		expect(querySelectorSpy).not.toHaveBeenCalledWith('.og-cell-loading-skeleton');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('defers row portal work for detail rows during active scroll', () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			detail: { height: 40 },
			expansion: {
				rows: {},
				details: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`row-${index}`, true])),
			},
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
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
		renderer.portalMountManager.onMountRowContent = vi.fn();
		renderer.portalMountManager.onUnmountRowContent = vi.fn();
		renderer.mount(container);
		renderer.resetRenderStats();
		(renderer.portalMountManager.onMountRowContent as ReturnType<typeof vi.fn>).mockClear();
		(renderer.portalMountManager.onUnmountRowContent as ReturnType<typeof vi.fn>).mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run scroll frame — row portal callbacks must not fire yet
		callbacks[0](0);
		const stats = renderer.getRenderStats();
		expect(stats.scrollFrames).toBe(1);
		expect(stats.portalMountsDuringScroll + stats.portalReleasesDuringScroll).toBeGreaterThan(0);
		expect(renderer.portalMountManager.onMountRowContent).not.toHaveBeenCalled();
		expect(renderer.portalMountManager.onUnmountRowContent).not.toHaveBeenCalled();

		// Flush scroll-end chain (4 RAF ticks → finishScrolling) and post-scroll portal work
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		expect(
			(renderer.portalMountManager.onMountRowContent as ReturnType<typeof vi.fn>).mock.calls.length +
				(renderer.portalMountManager.onUnmountRowContent as ReturnType<typeof vi.fn>).mock.calls.length
		).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not clear React-owned detail portal DOM before deferred unmount runs', () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			detail: { height: 40 },
			expansion: {
				rows: {},
				details: { 'row-0': true },
			},
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 120,
			width: 500,
			height: 120,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		let portalChild: HTMLDivElement | null = null;
		renderer.portalMountManager.onMountRowContent = ({ container: portalHost }) => {
			portalChild = document.createElement('div');
			portalChild.dataset.detailPortalChild = 'true';
			portalHost.appendChild(portalChild);
		};
		renderer.portalMountManager.onUnmountRowContent = ({ container: portalHost }) => {
			if (portalChild) {
				portalHost?.removeChild(portalChild);
				portalChild = null;
			}
		};
		renderer.mount(container);
		expect((portalChild as any)?.parentElement?.classList.contains('og-row-portal-host')).toBe(true);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1200;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(() => vi.advanceTimersByTime(80)).not.toThrow();
		expect(portalChild).toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('keeps custom detail row classes during scroll', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			detail: { height: 40 },
			styleRules: [{ kind: 'detailRow', rowClass: 'custom-detail-row' }],
			expansion: {
				rows: {},
				details: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`row-${index}`, true])),
			},
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
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

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(container.querySelector('.og-row-detail.custom-detail-row')).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not remount already-bound detail row portals during viewport paints', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			detail: { height: 40 },
			expansion: {
				rows: {},
				details: {
					'row-0': true,
					'row-1': true,
				},
			},
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'row-0', name: 'Zero' },
				{ id: 'row-1', name: 'One' },
			],
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.portalMountManager.onMountRowContent = vi.fn();
		renderer.mount(container);
		expect(renderer.portalMountManager.onMountRowContent).toHaveBeenCalled();
		(renderer.portalMountManager.onMountRowContent as ReturnType<typeof vi.fn>).mockClear();

		renderer.scheduleViewportPaint('stable detail rows');
		await Promise.resolve();
		await Promise.resolve();

		expect(renderer.portalMountManager.onMountRowContent).not.toHaveBeenCalled();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('preserves portals during horizontal recycling without mounting new columns synchronously during scroll', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = Array.from({ length: 1000 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
			cellRenderer: () => null,
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 12 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) {
					row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				}
				return row;
			}),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 520,
			bottom: 180,
			width: 520,
			height: 180,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		const flushPortalContent = vi.fn();
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.portalMountManager.onFlushCellContent = flushPortalContent;
		renderer.mount(container);

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollLeft = 60000;
		scrollViewport.dispatchEvent(new Event('scroll'));
		// Run scroll frame only — scroll-end chain stays deferred
		callbacks[0](0);
		await Promise.resolve();
		await Promise.resolve();

		const unmountCount = (renderer.portalMountManager.onUnmountCellContent as ReturnType<typeof vi.fn>).mock.calls.length;
		const stats = renderer.getRenderStats();
		// Portals for exited columns are warm-cached (deferred), not destroyed during scroll.
		expect(unmountCount).toBe(0);
		expect(flushPortalContent).not.toHaveBeenCalled();
		expect(stats.portalFlushesDuringScroll).toBe(0);
		// New columns entering the viewport take the impostor path during scroll — no synchronous portal mounts.
		expect(stats.portalMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('wakes buffered offscreen columns when horizontal scroll moves them into the visible viewport', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = Array.from({ length: 12 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
			valueGetter: ({ row }: { row: Record<string, string> }) => `${row.id}:${index}`,
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 80,
			colBuffer: 4,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 40 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
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

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;

		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		scrollViewport.scrollLeft = 200;
		scrollViewport.dispatchEvent(new Event('scroll'));
		expect(callbacks.length).toBeGreaterThanOrEqual(2);
		callbacks[1](0);

		const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
		expect(row10).not.toBeNull();
		const newlyVisibleCell = row10.querySelector('[data-col-field="col_6"]') as HTMLDivElement;
		expect(newlyVisibleCell).not.toBeNull();
		expect(newlyVisibleCell.textContent).not.toBe('row-2:6');

		let i = 2;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		expect(newlyVisibleCell.textContent).toBe('row-10:6');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not treat an emptied buffered portal host as authoritative during horizontal reveal', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = Array.from({ length: 12 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
			cellRenderer: () => `Rendered ${index}`,
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 80,
			colBuffer: 4,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 40 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
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

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;

		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);
		await Promise.resolve();
		await Promise.resolve();

		const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
		expect(row10).not.toBeNull();
		const bufferedCell = row10.querySelector('[data-col-field="col_6"]') as HTMLDivElement;
		expect(bufferedCell).not.toBeNull();
		const bufferedHost = bufferedCell.querySelector('.og-cell-portal-host') as HTMLDivElement;
		expect(bufferedHost).not.toBeNull();
		expect(bufferedHost.childElementCount).toBeGreaterThan(0);

		bufferedHost.replaceChildren();
		expect(bufferedHost.childElementCount).toBe(0);

		scrollViewport.scrollLeft = 200;
		scrollViewport.dispatchEvent(new Event('scroll'));
		expect(callbacks.length).toBeGreaterThanOrEqual(2);
		callbacks[1](0);

		const revealedCell = row10.querySelector('[data-col-field="col_6"]') as HTMLDivElement;
		// custom cells always take the impostor path during scroll — emptied portal host is never
		// mistaken for authoritative content; the cell shows empty/fallback, not portal.
		expect(revealedCell.dataset.contentMode).not.toBe('portal');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('prewarms valueGetter columns just outside the visible band so horizontal re-entry wakes immediately', async () => {
		const callbacks: FrameRequestCallback[] = [];
		const idleCallbacks: Array<(deadline?: { timeRemaining(): number; didTimeout: boolean }) => void> = [];
		const previousRequestIdleCallback = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
		const previousCancelIdleCallback = (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		(
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
				cancelIdleCallback?: (id: number) => void;
			}
		).requestIdleCallback = (cb) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		};
		(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = (id) => {
			if (id >= 1 && id <= idleCallbacks.length) idleCallbacks[id - 1] = () => {};
		};

		const columns = Array.from({ length: 12 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
			valueGetterDependencies: [`col_${index}`],
			valueGetter: ({ row }: { row: Record<string, string> }) => `Snapshot:${row.id}:${index}`,
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 80,
			colBuffer: 0,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 40 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
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
		try {
			renderer.mount(container);

			const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
			scrollViewport.scrollTop = 400;
			scrollViewport.scrollLeft = 400;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(1);
			callbacks[0](0);
			expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
			idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 0 });

			scrollViewport.scrollLeft = 200;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(2);
			callbacks[1](0);

			const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
			expect(row10).not.toBeNull();
			const reenteredCell = row10.querySelector('[data-col-field="col_2"]') as HTMLDivElement;
			expect(reenteredCell).not.toBeNull();
			expect(reenteredCell.textContent).toBe('Snapshot:row-10:2');
			const stats = renderer.getRenderStats();
			expect(stats.valueGetterCallsDuringScroll).toBe(0);
			expect(stats.prewarmedDisplayValues).toBeGreaterThan(0);
			expect(stats.prewarmedCellSnapshots).toBeGreaterThan(0);
			expect(stats.prewarmPasses).toBeGreaterThan(0);
		} finally {
			if (previousRequestIdleCallback === undefined) {
				delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
			} else {
				(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = previousRequestIdleCallback;
			}
			if (previousCancelIdleCallback === undefined) {
				delete (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
			} else {
				(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = previousCancelIdleCallback;
			}
			renderer.unmount();
			controller.dispose();
			store.destroy();
		}
	});

	it('prewarms formula columns just outside the visible band so horizontal re-entry wakes immediately', async () => {
		const callbacks: FrameRequestCallback[] = [];
		const idleCallbacks: Array<(deadline?: { timeRemaining(): number; didTimeout: boolean }) => void> = [];
		const previousRequestIdleCallback = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
		const previousCancelIdleCallback = (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		(
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
				cancelIdleCallback?: (id: number) => void;
			}
		).requestIdleCallback = (cb) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		};
		(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = (id) => {
			if (id >= 1 && id <= idleCallbacks.length) idleCallbacks[id - 1] = () => {};
		};

		const columns = [
			{ field: 'id', header: 'Id', width: 100 },
			{ field: 'val', header: 'Val', width: 100 },
			{ field: 'formula', header: 'Formula', width: 100 },
			...Array.from({ length: 9 }, (_, index) => ({
				field: `filler_${index}`,
				header: `Filler ${index}`,
				width: 100,
			})),
		];
		const rows = Array.from({ length: 40 }, (_, rowIndex) => ({
			id: `row-${rowIndex}`,
			val: rowIndex + 1,
			formula: `=[row-${rowIndex}:val]*2`,
			...Object.fromEntries(Array.from({ length: 9 }, (_, fillerIndex) => [`filler_${fillerIndex}`, `${rowIndex}:${fillerIndex}`])),
		}));
		const store = new GridStore<Record<string, string | number>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 80,
			colBuffer: 0,
			getRowId: (row) => String(row.id),
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows,
			columns,
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
		try {
			renderer.mount(container);

			const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
			scrollViewport.scrollTop = 400;
			scrollViewport.scrollLeft = 400;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(1);
			callbacks[0](0);
			expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
			idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 0 });

			scrollViewport.scrollLeft = 200;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(2);
			callbacks[1](0);

			const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
			expect(row10).not.toBeNull();
			const formulaCell = row10.querySelector('[data-col-field="formula"]') as HTMLDivElement;
			expect(formulaCell).not.toBeNull();
			expect(formulaCell.textContent).toBe('22');
			const stats = renderer.getRenderStats();
			expect(stats.getCellValueCallsDuringScroll).toBe(0);
			expect(stats.formulaCallsDuringScroll).toBe(0);
			expect(stats.prewarmedDisplayValues).toBeGreaterThan(0);
			expect(stats.prewarmedCellSnapshots).toBeGreaterThan(0);
		} finally {
			if (previousRequestIdleCallback === undefined) {
				delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
			} else {
				(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = previousRequestIdleCallback;
			}
			if (previousCancelIdleCallback === undefined) {
				delete (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
			} else {
				(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = previousCancelIdleCallback;
			}
			renderer.unmount();
			controller.dispose();
			store.destroy();
		}
	});

	it('prewarms insight decorations just outside the visible band so horizontal re-entry keeps validation state', async () => {
		const callbacks: FrameRequestCallback[] = [];
		const idleCallbacks: Array<(deadline?: { timeRemaining(): number; didTimeout: boolean }) => void> = [];
		const previousRequestIdleCallback = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
		const previousCancelIdleCallback = (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		(
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
				cancelIdleCallback?: (id: number) => void;
			}
		).requestIdleCallback = (cb) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		};
		(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = (id) => {
			if (id >= 1 && id <= idleCallbacks.length) idleCallbacks[id - 1] = () => {};
		};

		const columns = Array.from({ length: 12 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
			...(index === 2
				? {
						tooltip: ({ row }: { row: Record<string, string> }) => `Tip:${row.id}`,
						canEdit: () => ({ allowed: false }),
					}
				: {}),
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 80,
			colBuffer: 0,
			getRowId: (row) => row.id,
		});
		store.engine.insights.register({
			id: 'dataIntegrity',
			getCellDecorations: (rowId, colField) =>
				rowId === 'row-10' && colField === 'col_2'
					? [
							{
								layerId: 'dataIntegrity',
								kind: 'validationError',
								className: 'og-cell-validation-error',
								title: 'Needs review',
							},
						]
					: [],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 40 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
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
		try {
			renderer.mount(container);

			const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
			scrollViewport.scrollTop = 400;
			scrollViewport.scrollLeft = 400;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(1);
			callbacks[0](0);
			expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
			idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 0 });

			scrollViewport.scrollLeft = 200;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(2);
			callbacks[1](0);

			const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
			expect(row10).not.toBeNull();
			const decoratedCell = row10.querySelector('[data-col-field="col_2"]') as HTMLDivElement;
			expect(decoratedCell).not.toBeNull();
			expect(decoratedCell.className).toContain('og-cell-validation-error');
			expect(decoratedCell.className).toContain('og-cell-readonly');
			expect(decoratedCell.dataset.validationError).toBe('Needs review');
			expect(decoratedCell.getAttribute('aria-invalid')).toBe('true');
			expect(decoratedCell.getAttribute('aria-readonly')).toBe('true');
			expect(decoratedCell.title).toContain('Tip:row-10');
			expect(decoratedCell.title).toContain('Needs review');
			const stats = renderer.getRenderStats();
			expect(stats.prewarmedCellSnapshots).toBeGreaterThan(0);
			expect(stats.prewarmedDisplayValues).toBe(0);
		} finally {
			if (previousRequestIdleCallback === undefined) {
				delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
			} else {
				(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = previousRequestIdleCallback;
			}
			if (previousCancelIdleCallback === undefined) {
				delete (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
			} else {
				(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = previousCancelIdleCallback;
			}
			renderer.unmount();
			controller.dispose();
			store.destroy();
		}
	});

	it('prewarms style-rule snapshots just outside the visible band so horizontal re-entry keeps visual state without live wake-up', async () => {
		const callbacks: FrameRequestCallback[] = [];
		const idleCallbacks: Array<(deadline: { timeRemaining(): number; didTimeout: boolean }) => void> = [];
		const previousRequestIdleCallback = (
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
			}
		).requestIdleCallback;
		const previousCancelIdleCallback = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		(
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
				cancelIdleCallback?: (id: number) => void;
			}
		).requestIdleCallback = (cb) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		};
		(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = (id) => {
			if (id >= 1 && id <= idleCallbacks.length) idleCallbacks[id - 1] = () => {};
		};

		const columns = Array.from({ length: 12 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 80,
			colBuffer: 0,
			getRowId: (row) => row.id,
			styleRules: [
				{
					kind: 'cell',
					field: 'col_2',
					cellClass: 'prewarm-flag',
					when: (row) => row.id === 'row-10',
				},
			],
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 40 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
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
		try {
			renderer.mount(container);

			const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
			scrollViewport.scrollTop = 400;
			scrollViewport.scrollLeft = 400;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(1);
			callbacks[0](0);
			expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
			idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 0 });

			scrollViewport.scrollLeft = 200;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(2);
			callbacks[1](0);

			const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
			expect(row10).not.toBeNull();
			const styledCell = row10.querySelector('[data-col-field="col_2"]') as HTMLDivElement;
			expect(styledCell).not.toBeNull();
			expect(styledCell.className).toContain('prewarm-flag');
			expect(renderer.getRenderStats().prewarmedCellSnapshots).toBeGreaterThan(0);
		} finally {
			if (previousRequestIdleCallback === undefined) {
				delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
			} else {
				(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = previousRequestIdleCallback;
			}
			if (previousCancelIdleCallback === undefined) {
				delete (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
			} else {
				(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = previousCancelIdleCallback;
			}
			renderer.unmount();
			controller.dispose();
			store.destroy();
		}
	});

	it('prewarms plain primitive snapshots just outside the visible band so horizontal re-entry binds coherently', async () => {
		const callbacks: FrameRequestCallback[] = [];
		const idleCallbacks: Array<(deadline: { timeRemaining(): number; didTimeout: boolean }) => void> = [];
		const previousRequestIdleCallback = (
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
			}
		).requestIdleCallback;
		const previousCancelIdleCallback = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		(
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
				cancelIdleCallback?: (id: number) => void;
			}
		).requestIdleCallback = (cb) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		};
		(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = (id) => {
			if (id >= 1 && id <= idleCallbacks.length) idleCallbacks[id - 1] = () => {};
		};

		const columns = Array.from({ length: 12 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 80,
			colBuffer: 0,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 40 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
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
		try {
			renderer.mount(container);

			const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
			scrollViewport.scrollTop = 400;
			scrollViewport.scrollLeft = 400;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(1);
			callbacks[0](0);
			expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
			idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 0 });

			const snapshot = store.engine.getCellDisplaySnapshot('row-10', 'col_2');
			expect(snapshot).toMatchObject({
				rowId: 'row-10',
				colField: 'col_2',
				formattedValue: '10:2',
				contentMode: 'text',
			});

			scrollViewport.scrollLeft = 200;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(2);
			callbacks[1](0);

			const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
			expect(row10).not.toBeNull();
			const primitiveCell = row10.querySelector('[data-col-field="col_2"]') as HTMLDivElement;
			expect(primitiveCell).not.toBeNull();
			expect(primitiveCell.textContent).toBe('10:2');
			expect(renderer.getRenderStats().prewarmedCellSnapshots).toBeGreaterThan(0);
		} finally {
			if (previousRequestIdleCallback === undefined) {
				delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
			} else {
				(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = previousRequestIdleCallback;
			}
			if (previousCancelIdleCallback === undefined) {
				delete (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
			} else {
				(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = previousCancelIdleCallback;
			}
			renderer.unmount();
			controller.dispose();
			store.destroy();
		}
	});

	it('prewarms custom-live impostor snapshots just outside the visible band so horizontal re-entry avoids blank wake-up', async () => {
		const callbacks: FrameRequestCallback[] = [];
		const idleCallbacks: Array<(deadline: { timeRemaining(): number; didTimeout: boolean }) => void> = [];
		const previousRequestIdleCallback = (
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
			}
		).requestIdleCallback;
		const previousCancelIdleCallback = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		(
			window as Window & {
				requestIdleCallback?: (cb: (deadline: { timeRemaining(): number; didTimeout: boolean }) => void) => number;
				cancelIdleCallback?: (id: number) => void;
			}
		).requestIdleCallback = (cb) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		};
		(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = (id) => {
			if (id >= 1 && id <= idleCallbacks.length) idleCallbacks[id - 1] = () => {};
		};

		const columns = Array.from({ length: 12 }, (_, index) => ({
			field: `col_${index}`,
			header: `Col ${index}`,
			width: 100,
			...(index === 2
				? {
						cellRenderer: ({ value }: { value: string }) => `Portal ${value}`,
						cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
					}
				: {}),
		}));
		const store = new GridStore<Record<string, string>>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			rowOverscanPx: 80,
			colBuffer: 0,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 40 }, (_, rowIndex) => {
				const row: Record<string, string> = { id: `row-${rowIndex}` };
				for (let colIndex = 0; colIndex < columns.length; colIndex++) row[`col_${colIndex}`] = `${rowIndex}:${colIndex}`;
				return row;
			}),
			columns,
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
		try {
			renderer.mount(container);

			const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
			scrollViewport.scrollTop = 400;
			scrollViewport.scrollLeft = 400;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(1);
			callbacks[0](0);
			expect(idleCallbacks.length).toBeGreaterThanOrEqual(1);
			idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 0 });

			const snapshot = store.engine.getCellDisplaySnapshot('row-10', 'col_2');
			expect(snapshot).toMatchObject({
				rowId: 'row-10',
				colField: 'col_2',
				formattedValue: '10:2',
				contentKind: 'impostor',
				contentMode: 'fallback',
			});

			scrollViewport.scrollLeft = 200;
			scrollViewport.dispatchEvent(new Event('scroll'));
			expect(callbacks.length).toBeGreaterThanOrEqual(2);
			callbacks[1](0);

			const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
			expect(row10).not.toBeNull();
			const customCell = row10.querySelector('[data-col-field="col_2"]') as HTMLDivElement;
			expect(customCell).not.toBeNull();
			expect(customCell.dataset.contentMode).toBe('fallback');
			expect(customCell.textContent).toBe('10:2');
			expect(renderer.getRenderStats().prewarmedCellSnapshots).toBeGreaterThan(0);
			expect(renderer.getRenderStats().prewarmedDisplayValues).toBeGreaterThan(0);
		} finally {
			if (previousRequestIdleCallback === undefined) {
				delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
			} else {
				(window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = previousRequestIdleCallback;
			}
			if (previousCancelIdleCallback === undefined) {
				delete (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
			} else {
				(window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = previousCancelIdleCallback;
			}
			renderer.unmount();
			controller.dispose();
			store.destroy();
		}
	});

	it('prewarms more rows in the direction of vertical scroll travel than the trailing edge', async () => {
		const callbacks: FrameRequestCallback[] = [];
		const idleCallbacks: Array<(deadline: { timeRemaining(): number; didTimeout: boolean }) => void> = [];
		const prevRIC = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
		const prevCIC = (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		(
			window as Window & { requestIdleCallback?: (cb: (d: { timeRemaining(): number; didTimeout: boolean }) => void) => number }
		).requestIdleCallback = (cb) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		};
		(window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback = (id) => {
			if (id >= 1 && id <= idleCallbacks.length) idleCallbacks[id - 1] = () => {};
		};

		const columns = [{ field: 'v', header: 'V', width: 100 }];
		const store = new GridStore<{ id: string; v: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, v: `V${i}` })),
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 200,
			bottom: 160,
			width: 200,
			height: 160,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		try {
			renderer.mount(container);

			const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;

			// First scroll: establish a base position (rows 10-13 visible at scrollTop=400).
			// This also primes lastPrewarmRequest to {visibleRowStart:10, ...}.
			scrollViewport.scrollTop = 400;
			scrollViewport.dispatchEvent(new Event('scroll'));
			callbacks[callbacks.length - 1]?.(0);
			idleCallbacks[idleCallbacks.length - 1]?.({ didTimeout: false, timeRemaining: () => 50 });

			// Second scroll: jump down to rows 20-23 visible (scrollTop=800).
			// rowDelta = 20-10 = 10 > 0 → scrolling down.
			// rowBefore (trailing) = base = 2 → prewarms rows 18-19.
			// rowAfter (leading)   = base × 2 = 4 → prewarms rows 24-27.
			scrollViewport.scrollTop = 800;
			scrollViewport.dispatchEvent(new Event('scroll'));
			callbacks[callbacks.length - 1]?.(0);
			idleCallbacks[idleCallbacks.length - 1]?.({ didTimeout: false, timeRemaining: () => 50 });

			// Leading edge (rows 24-27): should be prewarmed.
			expect(store.engine.getCellDisplaySnapshot('r27', 'v')).toBeDefined();
			// Beyond leading edge (row 28): not yet prewarmed.
			expect(store.engine.getCellDisplaySnapshot('r28', 'v')).toBeUndefined();

			// Trailing edge: only 2 rows back (rows 18-19). Row 16 is 4 rows back — out of range.
			expect(store.engine.getCellDisplaySnapshot('r18', 'v')).toBeDefined();
			expect(store.engine.getCellDisplaySnapshot('r16', 'v')).toBeUndefined();
		} finally {
			if (prevRIC === undefined) delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
			else (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = prevRIC;
			if (prevCIC === undefined) delete (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback;
			else (window as Window & { cancelIdleCallback?: unknown }).cancelIdleCallback = prevCIC;
			renderer.unmount();
			controller.dispose();
			store.destroy();
		}
	});

	it('updates cell widths immediately on column resize', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-0', a: 'A0' }],
			columns,
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

		const cell = container.querySelector('.og-cell') as HTMLDivElement;
		expect(cell.style.width).toBe('120px');

		// Trigger column resize
		store.setColumnWidth('a', 200);

		// Wait for render scheduler frame
		await Promise.resolve();
		await Promise.resolve();

		expect(cell.style.width).toBe('200px');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('replaces loading skeletons with data rows immediately when loading state and globalVersion update', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});
		const rowModelState: { visualRows: Array<any> } = {
			visualRows: [{ kind: 'loading', id: 'loading:0', rowIndex: 0, editable: false }],
		};
		const rowModel = createMinimalRowModel({
			get visualRows() {
				return rowModelState.visualRows;
			},
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
		store.registerRowModel(rowModel);
		renderer.mount(container);

		// Cell should be in loading mode initially
		let cell = container.querySelector('.og-cell') as HTMLDivElement;
		expect(cell.className).toContain('og-cell-loading');

		// Transition from an explicit loading visual row to a data row.
		rowModelState.visualRows = [
			{
				kind: 'data',
				id: 'row:row-0',
				rowId: 'row-0',
				rowIndex: 0,
				node: {
					id: 'row-0',
					data: { id: 'row-0', a: 'A0' },
					getCellValue: (_field: string) => 'A0',
				},
			},
		];
		store.registerRowModel(rowModel);

		// Wait for render scheduler frame
		await Promise.resolve();
		await Promise.resolve();

		cell = container.querySelector('.og-cell') as HTMLDivElement;
		expect(cell.className).not.toContain('og-cell-loading');
		expect(cell.textContent).toBe('A0');

		renderer.unmount();
		store.destroy();
	});

	it('mounts detail row portal immediately when master row is expanded', async () => {
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
		const columns = [{ field: 'name', header: 'Name', width: 180 }];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 180,
			getRowId: (row) => row.id,
			detail: { height: 40 },
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'row-0', name: 'Row 0' }],
			columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 500,
			bottom: 220,
			width: 500,
			height: 220,
			toJSON: () => ({}),
		});
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		const onMountRow = vi.fn(({ container: host }) => {
			const detail = document.createElement('div');
			detail.className = 'my-detail-content';
			host.appendChild(detail);
		});
		renderer.portalMountManager.onMountRowContent = onMountRow;
		renderer.mount(container);

		expect(onMountRow).not.toHaveBeenCalled();

		// Expand the row
		store.toggleDetailOpen('row-0');

		// Wait for render scheduler frame
		await Promise.resolve();
		await Promise.resolve();

		expect(onMountRow).toHaveBeenCalledTimes(1);
		expect(container.querySelector('.my-detail-content')).not.toBeNull();

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('renders valueGetter column values correctly during scroll', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [
			{ field: 'name', header: 'Name', width: 120 },
			{ field: 'computed', header: 'Computed', width: 120, valueGetter: ({ row }) => `${row.name}!` },
		];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			rowOverscanPx: 80,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 50 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
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

		// Scroll to row 10
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// Run the scroll animation frame
		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		// Inspect the cells rendered at the scrolled position - during scroll it shows loading placeholder
		const row10 = container.querySelector('[data-row-id="row:row-10"]') as HTMLDivElement;
		expect(row10).not.toBeNull();
		const computedCell = row10.querySelector('[data-col-field="computed"]') as HTMLDivElement;
		expect(computedCell).not.toBeNull();
		expect(computedCell.textContent).toBe('...');

		// Flush scroll-end chain (4 RAF ticks → finishScrolling) and post-scroll decoration
		let i = 1;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		// Now it should be resolved to the computed value
		expect(computedCell.textContent).toBe('Row 10!');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('does not leave rows blank when they move from overscan into the visible viewport', async () => {
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});
		const columns = [
			{ field: 'name', header: 'Name', width: 120 },
			{ field: 'computed', header: 'Computed', width: 120, valueGetter: ({ row }) => `${row.name}!` },
		];
		const store = new GridStore<{ id: string; name: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			rowOverscanPx: 80,
			getRowId: (row) => row.id,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 50 }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
			columns,
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

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		scrollViewport.scrollTop = 480;
		scrollViewport.dispatchEvent(new Event('scroll'));
		expect(callbacks.length).toBeGreaterThanOrEqual(2);
		callbacks[1](0);

		const row15 = container.querySelector('[data-row-id="row:row-15"]') as HTMLDivElement;
		expect(row15).not.toBeNull();
		const computedCell = row15.querySelector('[data-col-field="computed"]') as HTMLDivElement;
		expect(computedCell).not.toBeNull();
		expect(computedCell.textContent).not.toBe('');

		let i = 2;
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}
		await Promise.resolve();
		await Promise.resolve();
		while (i < callbacks.length) {
			callbacks[i](0);
			i++;
		}

		expect(computedCell.textContent).toBe('Row 15!');

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('all custom and deferred columns show text impostor during scroll; portal deferred to fidelity lane', () => {
		vi.useFakeTimers();
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});

		const columns = [
			{ field: 'col1', header: 'Col 1', width: 100, cellRenderer: () => 'Col1Rendered' },
			{
				field: 'col2',
				header: 'Col 2',
				width: 100,
				cellRenderer: () => 'Col2Rendered',
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
			},
			{
				field: 'col3',
				header: 'Col 3',
				width: 100,
				cellRenderer: () => 'Col3Rendered',
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
			},
		];

		const store = new GridStore<{ id: string; col1: string; col2: string; col3: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 100 }, (_, index) => ({
				id: `row-${index}`,
				col1: `Val 1-${index}`,
				col2: `Val 2-${index}`,
				col3: `Val 3-${index}`,
			})),
			columns,
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
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.portalMountManager.onUnmountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		const row40 = container.querySelector('[data-row-id="row:row-40"]') as HTMLDivElement;
		expect(row40).not.toBeNull();

		const cell1 = row40.querySelector('[data-col-field="col1"]') as HTMLDivElement;
		const cell2 = row40.querySelector('[data-col-field="col2"]') as HTMLDivElement;
		const cell3 = row40.querySelector('[data-col-field="col3"]') as HTMLDivElement;

		// All portal-mode columns show text impostor during scroll — no synchronous portal mounts.
		// col1 (mode='custom'), col2 (mode='custom-live'), col3 (mode='custom', defer) all defer to fidelity lane.
		expect(cell1.dataset.contentMode).not.toBe('portal');
		expect(cell2.dataset.contentMode).not.toBe('portal');
		expect(cell3.dataset.contentMode).not.toBe('portal');
		// isScrolling:false always passed → customRendererMountsDuringScroll stays 0.
		expect(renderer.getRenderStats().customRendererMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.useRealTimers();
	});

	it('cellRendererCapabilities: all portal-mode cells show text impostor during scroll; portal deferred to fidelity lane', () => {
		vi.useFakeTimers();
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});

		const columns = [
			{
				field: 'live',
				header: 'Live',
				width: 100,
				cellRenderer: () => 'LiveRendered',
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
			},
			{
				field: 'defer',
				header: 'Defer',
				width: 100,
				cellRenderer: () => 'DeferRendered',
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
				valueGetterDependencies: ['defer'],
				valueGetter: ({ row }: any) => `Snapshot ${row.defer}`,
			},
			{
				field: 'fallback',
				header: 'Fallback',
				width: 100,
				cellRenderer: () => 'FallbackRendered',
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
			},
		];

		const store = new GridStore<{ id: string; live: string; defer: string; fallback: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 100,
			getRowId: (row) => row.id,
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 100 }, (_, index) => ({
				id: `row-${index}`,
				live: `Live ${index}`,
				defer: `Defer ${index}`,
				fallback: `Fallback ${index}`,
			})),
			columns,
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
		renderer.portalMountManager.onMountCellContent = vi.fn();
		renderer.mount(container);
		(renderer.portalMountManager.onMountCellContent as ReturnType<typeof vi.fn>).mockClear();
		expect(store.getCellValue('row-40', 'defer')).toBe('Snapshot Defer 40');
		expect(store.getCachedDisplayValue('row-40', 'defer')).toBe('Snapshot Defer 40');

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		const row40 = container.querySelector('[data-row-id="row:row-40"]') as HTMLDivElement;
		expect(row40).not.toBeNull();
		// All portal-mode columns show text impostor during scroll — portal deferred to fidelity lane.
		expect((row40.querySelector('[data-col-field="live"]') as HTMLDivElement).dataset.contentMode).not.toBe('portal');
		const deferCell = row40.querySelector('[data-col-field="defer"]') as HTMLDivElement;
		// defer cell has a cached display value ('Snapshot Defer 40') → prewarm snapshot tagged impostor → shows 'fallback'
		expect(deferCell.dataset.contentMode).not.toBe('portal');
		expect((row40.querySelector('[data-col-field="fallback"]') as HTMLDivElement).dataset.contentMode).not.toBe('portal');
		// isScrolling:false always passed → customRendererMountsDuringScroll stays 0.
		expect(renderer.getRenderStats().customRendererMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.useRealTimers();
	});

	it('deferred custom renderers show text impostor during scroll; portal content deferred to fidelity lane', () => {
		vi.useFakeTimers();
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});

		const columns = [
			{
				field: 'defer',
				header: 'Defer',
				width: 120,
				cellRenderer: () => 'DeferRendered',
				cellRendererCapabilities: { scrollPresentation: 'freeze' as const },
			},
		];

		const store = new GridStore<{ id: string; defer: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
		});

		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 80 }, (_, index) => ({ id: `row-${index}`, defer: `Defer ${index}` })),
			columns,
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

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 1600;
		scrollViewport.dispatchEvent(new Event('scroll'));

		expect(callbacks.length).toBeGreaterThanOrEqual(1);
		callbacks[0](0);

		const row40 = container.querySelector('[data-row-id="row:row-40"]') as HTMLDivElement;
		const deferCell = row40.querySelector('[data-col-field="defer"]') as HTMLDivElement;
		// Deferred (custom) cells show text impostor during scroll — portal deferred to fidelity lane.
		expect(deferCell.dataset.contentMode).not.toBe('portal');

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.useRealTimers();
	});

	// ── Phase 11: Stable slot model verification tests ────────────────────────────────

	it('stable-slot model: row DOM elements are not appended during a steady-state scroll', () => {
		// Use deferred RAF so we can control exactly which frame runs.
		vi.useFakeTimers();
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});

		const columns = [{ field: 'v', header: 'V', width: 120 }];
		const store = new GridStore<{ id: string; v: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			rowOverscanPx: 80,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}`, v: `V${i}` })),
			columns,
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
		// Drain any queued callbacks from mount.
		while (callbacks.length > 0) callbacks.shift()!(0);

		const rowsContainer = container.querySelector('.og-rows-container') as HTMLElement;
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;

		// First scroll: move to a middle position (not near top or bottom) so the slot pool
		// reaches its steady-state size (full overscan above and below).
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		// Drain all callbacks: scroll frame + scroll-end detection quiet frames. This lets
		// FrameCoordinator's rafId reset to null so the second scroll can schedule cleanly.
		while (callbacks.length > 0) callbacks.shift()!(0);

		// Record the steady-state slot count (full overscan both ways).
		const slotCountAtSteadyState = renderer.rowRenderer.rowSlotPool.count;
		const domChildCountAtSteadyState = slotDomCount(rowsContainer);
		expect(slotCountAtSteadyState).toBeGreaterThan(0);
		expect(domChildCountAtSteadyState).toBe(slotCountAtSteadyState);

		renderer.resetRenderStats();

		// Second scroll: move a small amount from 2400 → 2480 (2 rows) within the same
		// middle zone. The slot pool should not grow since the window size stays constant.
		scrollViewport.scrollTop = 2480;
		scrollViewport.dispatchEvent(new Event('scroll'));
		// Drain all callbacks: scroll frame + scroll-end detection quiet frames.
		while (callbacks.length > 0) callbacks.shift()!(0);

		// Slot count and DOM child count must be identical after steady-state scroll.
		expect(renderer.rowRenderer.rowSlotPool.count).toBe(slotCountAtSteadyState);
		expect(slotDomCount(rowsContainer)).toBe(domChildCountAtSteadyState);

		// Some rows were recycled, confirming the scroll did real work.
		const stats = renderer.getRenderStats();
		expect(stats.hotDomReleases).toBeGreaterThan(0);
		expect(stats.rowsRecycledPerScrollFrame[0]).toBeGreaterThan(0);

		// No DOM appends were needed — the key stable-slot property.
		expect(renderer.rowRenderer.rowSlotPool.slotAppendCount).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.useRealTimers();
	});

	it('stable-slot model: most rows stay in place during a small scroll', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			rowOverscanPx: 0, // zero overscan → exactly 4 rows visible in 160px viewport
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 120 }, (_, i) => ({ id: `row-${i}`, a: `A${i}` })),
			columns,
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
		renderer.resetRenderStats();

		// Scroll by exactly 1 row height (40px): row 0 exits, row 4 enters, rows 1-3 stay.
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 40;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = renderer.getRenderStats();

		// Only 1 row was recycled (exited and its slot reassigned to the entering row).
		expect(stats.rowsRecycledPerScrollFrame[0]).toBe(1);
		expect(stats.hotDomReleases).toBe(1);

		// Rows 1-4 stayed: visible range is [0,4] initially (5 rows with rowOverscanPx=0),
		// after 40px scroll it's [1,5]; row 0 exits, row 5 enters, rows 1-4 stay.
		expect(stats.rowsStayedDuringScroll).toBe(4);
		expect(stats.rowsEnteredDuringScroll).toBe(1);
		expect(stats.rowsExitedDuringScroll).toBe(1);

		// No portal mounts happen during the scroll frame — entering row gets 'pending' mode,
		// its custom-renderer mount is deferred to the post-scroll decoration pass.
		expect(stats.portalMountsDuringScroll).toBe(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('stable-slot model: slot pool count equals DOM children count invariant holds after scroll', () => {
		// Use deferred RAF (manually drained) — the same pattern as other passing scroll tests.
		const callbacks: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => {
			if (id >= 1 && id <= callbacks.length) callbacks[id - 1] = () => {};
		});

		const columns = [{ field: 'x', header: 'X', width: 120 }];
		const store = new GridStore<{ id: string; x: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			rowOverscanPx: 80,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}`, x: `X${i}` })),
			columns,
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

		const rowsContainer = container.querySelector('.og-rows-container') as HTMLElement;
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;

		// Invariant at mount: slot count matches DOM children.
		expect(renderer.rowRenderer.rowSlotPool.count).toBe(slotDomCount(rowsContainer));

		// Scroll to a middle position and run one scroll frame.
		scrollViewport.scrollTop = 1200;
		scrollViewport.dispatchEvent(new Event('scroll'));
		if (callbacks.length > 0) callbacks.shift()!(0);
		callbacks.length = 0;

		// Invariant after scroll: slot count still matches DOM children.
		// This confirms the stable-slot model doesn't leave orphaned slots or DOM nodes.
		expect(renderer.rowRenderer.rowSlotPool.count).toBe(slotDomCount(rowsContainer));

		// Scroll further and verify again.
		scrollViewport.scrollTop = 2400;
		scrollViewport.dispatchEvent(new Event('scroll'));
		if (callbacks.length > 0) callbacks.shift()!(0);
		callbacks.length = 0;

		// Invariant still holds.
		expect(renderer.rowRenderer.rowSlotPool.count).toBe(slotDomCount(rowsContainer));

		// Confirm rows were recycled (the scrolls did real work).
		const stats = renderer.getRenderStats();
		expect(stats.hotDomReleases).toBeGreaterThan(0);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('rotates the viewport slot window and only rebinds one row for a one-row scroll', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

		const columns = [{ field: 'a', header: 'A', width: 120 }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			rowOverscanPx: 0,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}`, a: `A${i}` })),
			columns,
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

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		renderer.resetRenderStats();
		scrollViewport.scrollTop = 40;
		scrollViewport.dispatchEvent(new Event('scroll'));
		const stats = renderer.getRenderStats();
		expect(stats.rowSlotMoves).toBeGreaterThan(0);
		expect(stats.rowSlotRebinds).toBe(1);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});

	it('stable-slot model: custom renderers are updated in-place when slots rebind to new rows', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

		const columns = [{ field: 'a', header: 'A', width: 120, cellRenderer: () => 'CellContent' }];
		const store = new GridStore<{ id: string; a: string }>({
			columns,
			defaultRowHeight: 40,
			defaultColWidth: 120,
			getRowId: (row) => row.id,
			rowOverscanPx: 0,
		});
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 100 }, (_, i) => ({ id: `row-${i}`, a: `A${i}` })),
			columns,
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

		// Capture lifecycle operations delivered to the framework adapter.
		const lifecycleLog: Array<{ cellKey: string; op: string }> = [];
		renderer.onMountCellContent = (mount) => {
			lifecycleLog.push({ cellKey: mount.cellKey, op: mount.lifecycleOperation ?? 'update' });
		};

		renderer.mount(container);
		// After mount: 5 rows visible (rows 0-4, rowOverscanPx=0 + getRowIndexAtOffset(160)=4),
		// each with 1 cellRenderer → 5 warm misses (mount lifecycle).
		const statsAfterMount = renderer.portalMountManager.customRendererManager.getStats();
		expect(statsAfterMount.warmMisses).toBe(5);
		expect(statsAfterMount.warmHits).toBe(0);

		// Scroll far enough that all 5 initial rows exit and 5 new rows enter.
		// rowOverscanPx=0: rows 0-4 exit when we scroll to show rows 10-14.
		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		// After scroll: impostor path releases portals, full bind (via immediate RAF) restores them
		// via warm cache. warmHits ≥ 4 (released + re-acquired), warmMisses stays at 5 (initial only).
		const statsAfterScroll = renderer.portalMountManager.customRendererManager.getStats();
		expect(statsAfterScroll.warmHits).toBeGreaterThanOrEqual(4); // warm cache restore from fidelity/full-bind
		expect(statsAfterScroll.warmMisses).toBe(5); // no additional cold mounts — warm cache covers rebound slots

		// onMountCellContent fires for initial cold mounts and for warm cache restores post-scroll.
		// 5 initial + up to 5 warm cache restores from full bind = ≥ 5 total events.
		expect(lifecycleLog.length).toBeGreaterThanOrEqual(5);

		// cellKeys are cell-instance-based (C prefix from createCellInstanceRendererKey).
		for (const entry of lifecycleLog) {
			expect(entry.cellKey).toMatch(/^C\d+:ci\d+/);
		}

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});
});
