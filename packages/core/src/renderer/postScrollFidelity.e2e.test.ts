// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore, type ColumnDef } from '../store.js';
import { RenderEngine } from './renderEngine.js';
import { CellSlot } from './cellSlot.js';

interface RiskRow {
	id: string;
	name: string;
	risk: string;
}

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 400;

function mountRiskGrid(rowCount: number) {
	// The scroll-end quiet window and velocity read performance.now(): fake the clock too, so CPU load
	// cannot end the gesture early.
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
	vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));

	// A React-style renderer column with default scroll capabilities: while flinging it shows cheap
	// stand-in text, and the post-scroll fidelity lane must mount the real renderer afterwards.
	const columns: ColumnDef<RiskRow>[] = [
		{ field: 'name', header: 'Name', width: 150 },
		{ field: 'risk', header: 'Risk', width: 150, cellRenderer: () => null } as ColumnDef<RiskRow>,
	];
	const store = new GridStore<RiskRow>({
		columns,
		defaultRowHeight: ROW_HEIGHT,
		defaultColWidth: 150,
		getRowId: (row) => row.id,
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: rowCount }, (_, i) => ({ id: `row-${i}`, name: `name-${i}`, risk: ['LOW', 'MEDIUM', 'HIGH'][i % 3] })),
		columns: store.getState().columns,
	});
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 300,
		bottom: VIEWPORT_HEIGHT,
		width: 300,
		height: VIEWPORT_HEIGHT,
		toJSON: () => ({}),
	} as DOMRect);
	document.body.appendChild(container);
	const renderer = new RenderEngine(store.engine, store);
	renderer.mount(container);
	vi.advanceTimersByTime(500);
	return { store, controller, container, renderer };
}

function visibleRiskCells(container: HTMLElement, scrollTop: number): HTMLElement[] {
	const first = Math.floor(scrollTop / ROW_HEIGHT);
	const last = Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) - 1;
	const cells: HTMLElement[] = [];
	for (let row = first; row <= last; row++) {
		const cell = container.querySelector(`.og-cell[data-row-id="row-${row}"][data-col-field="risk"]`) as HTMLElement | null;
		if (cell) cells.push(cell);
	}
	return cells;
}

describe('post-scroll fidelity repair — end to end', () => {
	let grid: ReturnType<typeof mountRiskGrid> | null = null;
	afterEach(() => {
		grid?.renderer.unmount();
		grid?.controller.dispose();
		grid?.store.destroy();
		grid = null;
		vi.useRealTimers();
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	it('upgrades every visible React stand-in after a fling, even when a queued cell is cold-released mid-gesture', () => {
		grid = mountRiskGrid(2000);
		const viewport = grid.container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		// A fling: each frame lands far enough away that every physical row slot is rebound to a new
		// row, several times over, before the gesture ends.
		let scrollTop = 0;
		for (let frame = 0; frame < 24; frame++) {
			scrollTop += 1400;
			viewport.scrollTop = scrollTop;
			viewport.dispatchEvent(new Event('scroll'));
			vi.advanceTimersByTime(16);
		}
		const stats = grid.renderer.getRenderStats() as any;
		expect(stats.dirtyCellsMarkedDuringScroll).toBeGreaterThan(0);
		expect(visibleRiskCells(grid.container, scrollTop).every((cell) => cell.dataset.contentMode === 'fallback')).toBe(true);

		// Still mid-gesture, a queued plain-text cell is cold-released, exactly as column scroll-out,
		// retention trimming or a pool shrink does. Release clears its repair intent while the element
		// is still queued; the drain must drop it and still upgrade every visible renderer cell.
		const dirty = grid.renderer.rowRenderer.dirtyCellsAfterScroll;
		const queuedText = [...dirty].find((el) => CellSlot.fromElement(el)?.colField === 'name');
		expect(queuedText).toBeDefined();
		CellSlot.fromElement(queuedText!)!.releaseCold();
		expect(dirty.has(queuedText!)).toBe(true);

		const faults: unknown[] = [];
		const onError = (event: ErrorEvent) => faults.push(event.error);
		window.addEventListener('error', onError);

		// Gesture ends; give the scroll-end timer and every idle repair slice time to run.
		let thrown: unknown = null;
		try {
			vi.advanceTimersByTime(3000);
		} catch (error) {
			thrown = error;
		}
		window.removeEventListener('error', onError);
		expect(thrown).toBeNull();
		expect(faults).toEqual([]);

		const cells = visibleRiskCells(grid.container, scrollTop);
		expect(cells.length).toBeGreaterThanOrEqual(VIEWPORT_HEIGHT / ROW_HEIGHT);
		const notUpgraded = cells
			.filter((cell) => cell.dataset.contentMode !== 'portal')
			.map((cell) => `${cell.dataset.rowId}:${cell.dataset.contentMode}`);
		expect(notUpgraded).toEqual([]);
		expect(grid.renderer.rowRenderer.dirtyCellsAfterScroll.size).toBe(0);
		expect(grid.store.engine.runtimeFaults.snapshot()).toEqual([]);
	}, 30_000);
});
