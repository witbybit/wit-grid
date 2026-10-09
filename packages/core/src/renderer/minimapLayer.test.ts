// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridLayoutPlan } from './layoutPlan.js';
import type { GridScheduler } from './gridScheduler.js';
import { MinimapLayer, type MinimapSource } from './minimapLayer.js';

const ROW_H = 10;

function plan(scrollTop = 0, rows = 100): GridLayoutPlan {
	return {
		viewport: { width: 512, clientWidth: 500, height: 300, scrollTop, scrollLeft: 0 },
		dimensions: { totalRowsHeight: rows * ROW_H },
		rows: { pinnedTopHeight: 0, pinnedBottomHeight: 0, visibleTop: scrollTop, visibleBottom: scrollTop + 200 },
		origins: { rowLayerTop: 40, bottomChromeTop: 240 },
	} as unknown as GridLayoutPlan;
}

function scheduler(): GridScheduler & { flush(): void } {
	const queue: (() => void)[] = [];
	return {
		microtask: (fn) => queue.push(fn),
		raf: (fn) => queue.push(fn),
		cancelRaf: () => {},
		idle: (fn) => queue.push(() => fn()),
		cancelIdle: () => {},
		supportsIdle: () => false,
		timeout: (fn) => queue.push(fn) as unknown as ReturnType<typeof setTimeout>,
		clearTimeout: () => {},
		flush: () => queue.splice(0).forEach((fn) => fn()),
	};
}

let rects: { style: unknown; alpha: number; x: number; y: number; w: number; h: number }[] = [];

beforeEach(() => {
	rects = [];
	const ctx = {
		fillStyle: '' as unknown,
		globalAlpha: 1,
		setTransform: () => {},
		clearRect: () => (rects = []),
		fillRect(x: number, y: number, w: number, h: number) {
			rects.push({ style: this.fillStyle, alpha: this.globalAlpha, x, y, w, h });
		},
	};
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function setup(overrides: Partial<MinimapSource> = {}) {
	let clock = 0;
	const order = Array.from({ length: 100 }, (_, i) => `r${i}`);
	const scrollToFraction = vi.fn();
	const source: MinimapSource = {
		enabled: () => true,
		rowCount: () => order.length,
		indexOf: (id) => order.indexOf(id),
		rowTop: (i) => i * ROW_H,
		selection: () => [],
		issues: () => [],
		marks: () => [],
		version: () => '1',
		scrollToFraction,
		...overrides,
	};
	const element = document.createElement('div');
	document.body.appendChild(element);
	const sched = scheduler();
	const layer = new MinimapLayer(element, source, () => clock, sched);
	return { element, layer, sched, scrollToFraction, tick: (ms: number) => (clock += ms) };
}

describe('MinimapLayer', () => {
	it('docks over the rows area beside the vertical scrollbar, hidden when disabled', () => {
		const { element, layer } = setup();
		layer.sync(plan());
		expect(element.hidden).toBe(false);
		expect(element.style.top).toBe('40px');
		expect(element.style.height).toBe('200px');
		expect(element.style.right).toBe('12px');

		let on = true;
		const off = setup({ enabled: () => on });
		on = false;
		off.layer.sync(plan());
		expect(off.element.hidden).toBe(true);
	});

	it('draws the view window and marks in content proportion: 1000px of rows on a 200px strip', () => {
		const { layer } = setup({
			selection: () => [{ start: 10, end: 19 }],
			issues: () => [{ rowId: 'r50', severity: 'error' }],
			marks: () => [{ rowId: 'r90', color: 'gold' }],
		});
		layer.sync(plan(300));
		const windowRect = rects[0];
		expect(windowRect.y).toBe(60);
		expect(windowRect.h).toBe(40);
		const selection = rects.find((r) => r.w === 4 && r.x === 1)!;
		expect(selection.y).toBe(20);
		expect(selection.h).toBe(20);
		expect(rects.find((r) => r.style === 'gold')!.y).toBe(180);
		expect(rects.find((r) => r.style === '#ef4444')!.y).toBe(100);
	});

	it('redraws only when something it shows changed', () => {
		const { layer } = setup();
		layer.sync(plan());
		const draws = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length;
		layer.sync(plan());
		expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(draws);
		layer.sync(plan(100));
		expect(vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length).toBeGreaterThan(draws);
	});

	it('marks edited rows and fades them out', () => {
		const { layer, sched, tick } = setup();
		layer.sync(plan());
		layer.noteChange('r30');
		const edit = () => rects.find((r) => r.x === 11);
		expect(edit()!.y).toBe(60);
		expect(edit()!.alpha).toBe(1);
		tick(2500);
		sched.flush();
		expect(edit()!.alpha).toBeCloseTo(0.5, 1);
		tick(3000);
		sched.flush();
		expect(edit()).toBeUndefined();
	});

	it('scrolls to where it is clicked and dragged', () => {
		const { element, layer, scrollToFraction } = setup();
		layer.sync(plan());
		element.getBoundingClientRect = () => ({ top: 40, height: 200 }) as DOMRect;
		element.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientY: 140 }));
		expect(scrollToFraction).toHaveBeenLastCalledWith(0.5);
		element.dispatchEvent(new PointerEvent('pointermove', { clientY: 190 }));
		expect(scrollToFraction).toHaveBeenLastCalledWith(0.75);
		element.dispatchEvent(new PointerEvent('pointerup', { clientY: 190 }));
		element.dispatchEvent(new PointerEvent('pointermove', { clientY: 60 }));
		expect(scrollToFraction).toHaveBeenCalledTimes(2);
	});
});
