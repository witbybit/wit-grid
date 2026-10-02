// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';

interface ModeRow {
	id: string;
	value: string;
}

function mountGrid(mode: 'primitive' | 'live' | 'text') {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

	const isCustom = mode !== 'primitive';
	const columns: ColumnDef<ModeRow>[] = [
		{
			field: 'value',
			header: 'Value',
			width: 150,
			cellRenderer: isCustom ? () => null : undefined,
			cellRendererCapabilities: isCustom ? ({ scroll: mode } as any) : undefined,
		} as any,
	];
	const store = new GridStore<ModeRow>({
		columns,
		defaultRowHeight: 40,
		defaultColWidth: 150,
		getRowId: (row) => row.id,
		rendererOptions: {
			live: {
				rowOverscan: 2,
				columnOverscan: 1,
				maxMountsPerFrame: 100,
				maxUpdatesPerFrame: 100,
			},
		},
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: 200 }, (_, i) => ({ id: `row-${i}`, value: `v${i}` })),
		columns: store.getState().columns,
	});
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 300,
		bottom: 400,
		width: 300,
		height: 400,
		toJSON: () => ({}),
	} as DOMRect);
	document.body.appendChild(container);

	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	renderer.resetRenderStats();
	return { store, controller, container, renderer };
}

function cleanup(grid: ReturnType<typeof mountGrid>): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
	vi.unstubAllGlobals();
}

describe('Scroll presentation mode telemetry benchmarks', () => {
	it('primitive mode stays portal-free during scroll', () => {
		const grid = mountGrid('primitive');
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = grid.renderer.getRenderStats();
		expect(stats.cellsBoundDuringScroll).toBeGreaterThan(0);
		expect(stats.portalMountsDuringScroll).toBe(0);
		expect(stats.liveReactMountsDuringScroll).toBe(0);

		cleanup(grid);
	});

	it('live mode admits live work in both visible and overscan bands', () => {
		const grid = mountGrid('live');
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = grid.renderer.getRenderStats();
		expect((stats.liveReactMountsDuringScroll || 0) + (stats.liveReactUpdatesDuringScroll || 0)).toBeGreaterThan(0);
		expect(stats.liveReactOverscanMounts || 0).toBeGreaterThan(0);

		cleanup(grid);
	});

	it('text mode mounts no portals during scroll', () => {
		const grid = mountGrid('text');
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = grid.renderer.getRenderStats();
		expect(stats.liveReactMountsDuringScroll).toBe(0);
		expect(stats.portalMountsDuringScroll).toBe(0);
		expect(stats.rootTextContentWritesOnPortalCells).toBe(0);

		cleanup(grid);
	});
});
