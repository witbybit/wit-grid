// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';

interface LiveRow {
	id: string;
	value: string;
	liveA?: string;
	liveB?: string;
	staticA?: string;
	staticB?: string;
}

function mountLiveGrid(rowCount: number, columns?: ColumnDef<LiveRow>[], rect?: Partial<DOMRect>) {
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
		cb(0);
		return 1;
	});
	vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

	const resolvedColumns: ColumnDef<LiveRow>[] =
		columns ??
		([
			{
				field: 'value',
				header: 'Value',
				width: 150,
				cellRenderer: () => null,
				cellRendererCapabilities: { scroll: 'live' } as any,
			} as any,
		] satisfies ColumnDef<LiveRow>[]);
	const store = new GridStore<LiveRow>({
		columns: resolvedColumns,
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
		rows: Array.from({ length: rowCount }, (_, i) => ({
			id: `row-${i}`,
			value: `v${i}`,
			liveA: `liveA-${i}`,
			liveB: `liveB-${i}`,
			staticA: `staticA-${i}`,
			staticB: `staticB-${i}`,
		})),
		columns: store.getState().columns,
	});
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: rect?.right ?? 300,
		bottom: rect?.bottom ?? 400,
		width: rect?.width ?? 300,
		height: rect?.height ?? 400,
		toJSON: () => ({}),
	} as DOMRect);
	document.body.appendChild(container);

	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	return { store, controller, container, renderer };
}

function cleanup(grid: ReturnType<typeof mountLiveGrid>): void {
	grid.renderer.unmount();
	grid.controller.dispose();
	grid.store.destroy();
	vi.unstubAllGlobals();
}

describe('LiveFrameBudget wiring — end to end sanity (unconfigured)', () => {
	it('unconfigured budget does not interfere with ordinary live-cell scrolling', () => {
		const grid = mountLiveGrid(200);
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = grid.renderer.getRenderStats() as any;
		// Physical live cells recycle their portal across row rebinds (keyed by CellSlot instance, not
		// row id — see identityKeys.ts's createCellInstanceRendererKey), so once the pool is warm
		// (as it is here, after the initial full mount), scrolling produces updates, not fresh mounts.
		// Either counter firing proves the wiring runs; see liveCellBinder.budget.test.ts for the
		// mount-vs-update/emergency-shell branch logic itself, tested directly and deterministically.
		expect(stats.liveReactMountsDuringScroll + stats.liveReactUpdatesDuringScroll).toBeGreaterThan(0);
		expect(stats.liveReactEmergencyShellsDuringScroll || 0).toBe(0);
		expect(stats.liveReactOverscanMounts || 0).toBeGreaterThanOrEqual(0);

		cleanup(grid);
	});

	it('live overscan execution mounts offscreen live cells and records the overscan work', () => {
		const grid = mountLiveGrid(200);
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 400;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const stats = grid.renderer.getRenderStats() as any;
		const plan = grid.renderer.rowRenderer.currentViewportPlan;
		expect(plan).not.toBeNull();
		expect(plan!.liveCells.overscan.length).toBeGreaterThan(0);
		const overscanCell = plan!.liveCells.overscan[0]!;
		expect(overscanCell.rowIndex < plan!.visibleRows.start || overscanCell.rowIndex > plan!.visibleRows.end).toBe(true);
		const overscanCellEl = grid.container.querySelector(
			`.og-cell[data-row-id="row-${overscanCell.rowIndex}"][data-col-field="value"]`
		) as HTMLElement | null;
		expect(overscanCellEl).not.toBeNull();
		expect(overscanCellEl?.dataset.contentMode).toBe('portal');
		expect(stats.liveReactOverscanMounts || 0).toBeGreaterThan(0);

		cleanup(grid);
	});

	it('horizontal live column overscan mounts a live column before it becomes visible', () => {
		const grid = mountLiveGrid(
			50,
			[
				{ field: 'staticA', header: 'Static A', width: 200 },
				{
					field: 'liveA',
					header: 'Live A',
					width: 200,
					cellRenderer: () => null,
					cellRendererCapabilities: { scroll: 'live' } as any,
				} as any,
				{ field: 'staticB', header: 'Static B', width: 200 },
			],
			{ width: 150, height: 240, right: 150, bottom: 240 }
		);
		const scrollViewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 40;
		scrollViewport.scrollLeft = 25;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const plan = grid.renderer.rowRenderer.currentViewportPlan;
		const liveAColumn = grid.store.engine.columns.getPrimaryColumnByField('liveA');
		expect(plan).not.toBeNull();
		expect(liveAColumn).toBeDefined();
		const horizontalOverscanCell = plan!.liveCells.overscan.find((cell) => cell.columnInstanceId === liveAColumn!.instanceId);
		expect(horizontalOverscanCell).toBeDefined();

		const overscanDomCell = grid.container.querySelector(
			`.og-cell[data-row-id="row-${horizontalOverscanCell!.rowIndex}"][data-col-field="liveA"]`
		) as HTMLElement | null;
		expect(overscanDomCell).not.toBeNull();
		expect(overscanDomCell?.dataset.contentMode).toBe('portal');

		const statsBeforeReveal = grid.renderer.getRenderStats() as any;
		expect(statsBeforeReveal.liveReactOverscanMounts || 0).toBeGreaterThan(0);

		scrollViewport.scrollLeft = 200;
		scrollViewport.dispatchEvent(new Event('scroll'));

		const revealedCell = grid.container.querySelector('.og-cell[data-row-id="row-0"][data-col-field="liveA"]') as HTMLElement | null;
		expect(revealedCell).not.toBeNull();
		expect(revealedCell?.dataset.contentMode).toBe('portal');
		expect(revealedCell?.textContent).not.toBe('...');
		expect(revealedCell?.dataset.contentMode).not.toBe('pending');
		expect(revealedCell?.dataset.contentMode).not.toBe('fallback');

		cleanup(grid);
	});
});
