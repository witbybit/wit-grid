// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';

type Row = { id: string; product: string };

describe('replacing rows with edited copies', () => {
	it('repaints the visible cells of rows whose data changed, without scrolling', async () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		const columns: ColumnDef<Row>[] = [{ field: 'product', header: 'Product', width: 200 }];
		const store = new GridStore<Row>({ columns, defaultRowHeight: 40, defaultColWidth: 200, getRowId: (row) => row.id });
		const rows: Row[] = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, product: `P${i}` }));
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 400,
			bottom: 400,
			width: 400,
			height: 400,
			toJSON: () => ({}),
		} as DOMRect);
		document.body.appendChild(container);
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		const text = (i: number) => container.querySelector(`.og-cell[data-row-id="r${i}"][data-col-field="product"]`)?.textContent;
		expect(text(2)).toBe('P2');

		// What a React app does: new array, edited copies for some rows, same ids.
		store.setRows(rows.map((r, i) => (i < 5 ? { ...r, product: `[tag] ${r.product}` } : r)));
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
		expect([0, 1, 2, 3, 4, 5].map(text)).toEqual(['[tag] P0', '[tag] P1', '[tag] P2', '[tag] P3', '[tag] P4', 'P5']);

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});
});
