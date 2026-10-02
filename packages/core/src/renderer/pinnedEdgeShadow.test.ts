// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';

type Row = Record<string, string>;

describe('pinned lane edge shadow', () => {
	it('is enabled only while content is scrolled under the pinned lanes', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		const columns: ColumnDef<Row>[] = Array.from({ length: 30 }, (_, c) => ({ field: `c${c}`, header: `Col ${c}`, width: 100 }));
		const store = new GridStore<Row>({ columns, defaultRowHeight: 40, defaultColWidth: 100, getRowId: (row) => row.id });
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 5 }, (_, r) => ({ id: `r${r}`, c0: `${r}` })),
			columns: store.getState().columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 800,
			bottom: 400,
			width: 800,
			height: 400,
			toJSON: () => ({}),
		} as DOMRect);
		document.body.appendChild(container);
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		const grid = container; // mount() makes the container itself the .og-grid-container
		const viewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 800 });
		const scrollTo = (left: number) => {
			viewport.scrollLeft = left;
			viewport.dispatchEvent(new Event('scroll'));
			renderer.fullPaint();
		};

		scrollTo(0);
		expect(grid.classList.contains('og-scrolled-left')).toBe(false);
		expect(grid.classList.contains('og-scrolled-right')).toBe(true);
		scrollTo(500);
		expect(grid.classList.contains('og-scrolled-left')).toBe(true);
		scrollTo(2200); // 3000 wide content, 800 viewport: the right end
		expect(grid.classList.contains('og-scrolled-right')).toBe(false);
		scrollTo(0);
		expect(grid.classList.contains('og-scrolled-left')).toBe(false);

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});
});
