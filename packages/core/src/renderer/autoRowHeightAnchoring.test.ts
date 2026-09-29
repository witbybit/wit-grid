// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';
import { RenderEngine } from './renderEngine.js';

type Row = { id: string; name: string };

function mountGrid(rowCount: number) {
	const paintCallbacks: FrameRequestCallback[] = [];
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		paintCallbacks.push(callback);
		return paintCallbacks.length;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number) => {
		if (id >= 1 && id <= paintCallbacks.length) paintCallbacks[id - 1] = () => {};
	});
	const columns = [{ field: 'name', header: 'Name', width: 120 }];
	const store = new GridStore<Row>({ columns, defaultRowHeight: 40, defaultColWidth: 120, getRowId: (row) => row.id, rowOverscanPx: 0 });
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: rowCount }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
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
	const drainFrames = async () => {
		await Promise.resolve();
		while (paintCallbacks.length > 0) paintCallbacks.shift()!(0);
	};
	const dispose = () => {
		renderer.unmount();
		controller.dispose();
		store.destroy();
		container.remove();
	};
	return { store, renderer, drainFrames, dispose };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('auto row height measurement', () => {
	it('bounds incremental measurement to rows not yet measured at their current version', () => {
		const { renderer, dispose } = mountGrid(1000);
		renderer.setAutoRowHeight(true);
		let reads = 0;
		const slots = renderer.rowRenderer.rowSlotPool!.getSlots().filter((slot) => slot.rowKind === 'data');
		expect(slots.length).toBeGreaterThan(2);
		for (const slot of slots) {
			for (const cell of slot.element.querySelectorAll<HTMLElement>('.og-cell')) {
				Object.defineProperty(cell, 'scrollHeight', {
					configurable: true,
					get: () => {
						reads++;
						return 40;
					},
				});
			}
		}
		const measure = (onlyUnmeasured?: boolean) =>
			(renderer as unknown as { measureAndUpdateRowHeights(onlyUnmeasured?: boolean): void }).measureAndUpdateRowHeights(onlyUnmeasured);

		measure(true);
		const firstPass = reads;
		expect(firstPass).toBeGreaterThan(0);

		// Same rows, same versions: an incremental pass reads nothing.
		measure(true);
		expect(reads).toBe(firstPass);

		// A full paint measurement still re-reads every bound row.
		measure(false);
		expect(reads).toBe(firstPass * 2);
		dispose();
	});

	it('measures rows after a non-full viewport paint, not only after full paints', async () => {
		const { store, renderer, drainFrames, dispose } = mountGrid(1000);
		renderer.setAutoRowHeight(true);
		await drainFrames();
		const measureSpy = vi.spyOn(
			renderer as unknown as { measureAndUpdateRowHeights(onlyUnmeasured?: boolean): void },
			'measureAndUpdateRowHeights'
		);
		const before = renderer.getRenderStats().fullPaints;
		store.setRowHeight('row-1', 60);
		await drainFrames();
		expect(renderer.getRenderStats().fullPaints).toBe(before);
		expect(measureSpy).toHaveBeenCalledWith(true);
		dispose();
	});
});

describe('scroll anchoring', () => {
	it('shifts scrollTop by the height change of rows above the first visible row in the same paint', async () => {
		const { store, renderer, drainFrames, dispose } = mountGrid(200);
		await drainFrames();
		const scrollViewport = (renderer as unknown as { viewportRenderer: { scrollViewport: HTMLElement } }).viewportRenderer.scrollViewport;
		scrollViewport.scrollTop = 400;
		store.setScrollPosition(400, 0);
		expect(scrollViewport.scrollTop).toBe(400);

		expect(store.engine.viewport.getScrollAnchorRowIndex()).toBe(10);
		store.setRowHeight('row-2', 100); // index 2 is above the first visible row (index 10)
		await drainFrames();
		expect(scrollViewport.scrollTop).toBe(460);
		expect(store.engine.viewport.scrollTop).toBe(460);

		store.setRowHeight('row-30', 100); // below: no shift
		await drainFrames();
		expect(scrollViewport.scrollTop).toBe(460);
		dispose();
	});
});
