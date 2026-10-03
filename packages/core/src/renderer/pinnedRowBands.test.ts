// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import { RenderEngine } from './renderEngine.js';

type Row = { id: string; a: string };

function mountPinned(rowCount = 200) {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
	const columns = [{ field: 'a', header: 'A', width: 120 }];
	const store = new GridStore<Row>({ columns, defaultRowHeight: 40, defaultColWidth: 120, getRowId: (row) => row.id });
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}`, a: `A${i}` })),
		columns,
	});
	store.setViewportPins({ top: 2, bottom: 1 });
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 500,
		bottom: 300,
		width: 500,
		height: 300,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
	const scrollTo = (top: number) => {
		scrollViewport.scrollTop = top;
		scrollViewport.dispatchEvent(new Event('scroll'));
	};
	const rowEl = (id: string) => container.querySelector(`.og-row[data-row-index="${id.slice(1)}"]`) as HTMLElement | null;
	return {
		store,
		renderer,
		container,
		scrollTo,
		rowEl,
		dispose() {
			renderer.unmount();
			controller.dispose();
			store.destroy();
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.textContent = '';
});

describe('viewport-pinned rows ride zero-height sticky bands', () => {
	it('parents pinned rows into the bands at constant offsets and body rows in the rows container', () => {
		const t = mountPinned();
		const top = t.container.querySelector('.og-layer-pinned-top')!;
		const bottom = t.container.querySelector('.og-layer-pinned-bottom')!;
		const rows = t.container.querySelector('.og-rows-container')!;
		expect(top).toBeTruthy();
		expect(bottom).toBeTruthy();
		for (const id of ['r0', 'r1']) expect(t.rowEl(id)!.parentNode).toBe(top);
		expect(t.rowEl('r199')!.parentNode).toBe(bottom);
		expect(t.rowEl('r5')!.parentNode).toBe(rows);
		expect(t.rowEl('r0')!.style.transform).toBe('translateY(0px)');
		expect(t.rowEl('r1')!.style.transform).toBe('translateY(40px)');
		expect(t.rowEl('r199')!.style.transform).toBe('translateY(-40px)');
		t.dispose();
	});

	it('performs no scroll-linked position writes for pinned rows and keeps their offsets', () => {
		const t = mountPinned();
		t.renderer.resetRenderStats();
		for (const top of [400, 800, 1200, 2000]) t.scrollTo(top);
		expect(t.renderer.getRenderStats().scrollLinkedPositionWrites).toBe(0);
		expect(t.rowEl('r1')!.style.transform).toBe('translateY(40px)');
		expect(t.rowEl('r199')!.style.transform).toBe('translateY(-40px)');
		expect(t.rowEl('r1')!.parentNode).toBe(t.container.querySelector('.og-layer-pinned-top'));
		t.dispose();
	});

	it('reparents a slot when it moves between a pinned index and a body index', () => {
		const t = mountPinned();
		const top = t.container.querySelector('.og-layer-pinned-top')!;
		const rows = t.container.querySelector('.og-rows-container')!;
		const pinnedEl = t.rowEl('r1')!;
		expect(pinnedEl.parentNode).toBe(top);
		t.store.setViewportPins({ top: 1, bottom: 1 });
		t.renderer.fullPaint();
		const r1 = t.rowEl('r1')!;
		expect(r1.parentNode).toBe(rows);
		expect(r1.style.transform).toBe('translateY(40px)');
		t.store.setViewportPins({ top: 2, bottom: 1 });
		t.renderer.fullPaint();
		expect(t.rowEl('r1')!.parentNode).toBe(top);
		t.dispose();
	});
});
