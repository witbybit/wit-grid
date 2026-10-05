// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutTransitionController } from './layoutTransitionController.js';

interface FakeSlot {
	element: HTMLElement;
	visualRowId: string;
	lastTop: number;
}

function makeRows(slots: FakeSlot[]): () => ReadonlyMap<number, any> {
	const map = new Map<number, any>();
	slots.forEach((s, i) => map.set(i, s));
	return () => map;
}

function slot(id: string, top: number): FakeSlot {
	const element = document.createElement('div');
	element.style.transform = `translateY(${top}px)`;
	return { element, visualRowId: id, lastTop: top };
}

describe('LayoutTransitionController', () => {
	const originalAnimate = (HTMLElement.prototype as any).animate;

	afterEach(() => {
		(HTMLElement.prototype as any).animate = originalAnimate;
	});

	it('no-ops safely when WAAPI is unavailable (jsdom default)', () => {
		// jsdom does not implement element.animate — controller must apply instantly.
		(HTMLElement.prototype as any).animate = undefined;
		const a = slot('a', 0);
		const c = new LayoutTransitionController(makeRows([a]));
		c.captureSnapshot();
		a.lastTop = 80;
		expect(() => c.beginAnimation()).not.toThrow();
		c.destroy();
	});

	it('animates moved rows from old top to new top via WAAPI', () => {
		const calls: { kf: Keyframe[]; el: HTMLElement }[] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			calls.push({ kf, el: this });
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};

		const a = slot('a', 0);
		const b = slot('b', 40);
		const c = new LayoutTransitionController(makeRows([a, b]));
		c.captureSnapshot(); // a@0, b@40
		// simulate sort: b moves to top, a moves down (recycleViewport wrote new lastTop)
		a.lastTop = 40;
		b.lastTop = 0;
		c.beginAnimation();

		expect(calls).toHaveLength(2);
		const aCall = calls.find((x) => x.el === a.element)!;
		expect(aCall.kf[0].transform).toBe('translateY(0px)'); // from old
		expect(aCall.kf[1].transform).toBe('translateY(40px)'); // to new
		c.destroy();
	});

	it('fades in entering rows but not on a first paint (empty snapshot)', () => {
		const calls: Keyframe[][] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			calls.push(kf);
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};

		// First paint: no snapshot captured → no enter animation for initial rows.
		const a = slot('a', 0);
		const c = new LayoutTransitionController(makeRows([a]));
		c.beginAnimation();
		expect(calls).toHaveLength(0);

		// After a real change: capture (a only), then a new row 'b' appears → it fades in.
		c.captureSnapshot();
		const b = slot('b', 40);
		const rows = makeRows([a, b]);
		(c as any).getActiveRows = rows;
		c.beginAnimation();
		const enter = calls.find((kf) => kf[0].opacity === 0);
		expect(enter).toBeDefined();
		expect(enter![0].transform).toBe('translateY(40px)');
		c.destroy();
	});

	it('slides rows entering after sort from the captured viewport edge', () => {
		const calls: { kf: Keyframe[]; el: HTMLElement }[] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			calls.push({ kf, el: this });
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};

		const a = slot('a', 0);
		(a as any).lastHeight = 40;
		const b = slot('b', 40);
		(b as any).lastHeight = 40;
		const active = new Map<number, any>([
			[0, a],
			[1, b],
		]);
		const c = new LayoutTransitionController(() => active);
		c.captureSnapshot('sort');

		const z = slot('z', 0);
		(z as any).lastHeight = 40;
		active.clear();
		active.set(0, z);
		c.beginAnimation();

		const enter = calls.find((call) => call.el === z.element);
		expect(enter).toBeDefined();
		expect(enter!.kf[0].transform).toBe('translateY(-40px)');
		expect(enter!.kf[1].transform).toBe('translateY(0px)');
		c.destroy();
	});

	it('uses move-only animation for live reorders without enter or exit ghosts', () => {
		const calls: { kf: Keyframe[]; el: HTMLElement }[] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			calls.push({ kf, el: this });
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};

		const exitLayer = document.createElement('div');
		const a = slot('a', 0);
		(a as any).lastHeight = 40;
		const b = slot('b', 40);
		(b as any).lastHeight = 40;
		const active = new Map<number, any>([
			[0, a],
			[1, b],
		]);
		const c = new LayoutTransitionController(() => active, { getExitLayer: () => exitLayer, isRowIdLive: () => false });
		c.captureSnapshot('live-reorder');

		b.lastTop = 0;
		active.clear();
		active.set(0, b);
		active.set(1, slot('z', 40));
		c.beginAnimation();

		expect(exitLayer.children.length).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.el).toBe(b.element);
		expect(calls[0]!.kf[0].transform).toBe('translateY(40px)');
		expect(calls[0]!.kf[1].transform).toBe('translateY(0px)');
		c.destroy();
	});

	it('cancel() tears down in-flight animations', () => {
		const cancels: Array<() => void> = [];
		(HTMLElement.prototype as any).animate = function () {
			const cancel = vi.fn();
			cancels.push(cancel);
			return { cancel, onfinish: null, oncancel: null } as unknown as Animation;
		};
		const a = slot('a', 0);
		const c = new LayoutTransitionController(makeRows([a]));
		c.captureSnapshot();
		a.lastTop = 80;
		c.beginAnimation();
		c.cancel();
		expect(cancels[0]).toHaveBeenCalled();
		c.destroy();
	});
});

describe('LayoutTransitionController — exit ghosts (Plan 043)', () => {
	const originalAnimate = (HTMLElement.prototype as any).animate;
	afterEach(() => {
		(HTMLElement.prototype as any).animate = originalAnimate;
	});

	function stubAnimate(record?: Keyframe[][]) {
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			record?.push(kf);
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};
	}

	it('fades out a captured row that left the model into the exit layer', () => {
		const kfs: Keyframe[][] = [];
		stubAnimate(kfs);
		const exitLayer = document.createElement('div');
		const a = slot('data:a', 0);
		const b = slot('data:b', 40);
		const active = new Map<number, any>([
			[0, a],
			[1, b],
		]);
		// 'data:b' is gone from the model after the change (e.g. collapsed away).
		const c = new LayoutTransitionController(() => active, { getExitLayer: () => exitLayer, isRowIdLive: (id) => id === 'data:a' });

		c.captureSnapshot(); // clones a + b
		active.delete(1); // b no longer rendered
		c.beginAnimation();

		expect(exitLayer.children.length).toBe(1); // one ghost (for b)
		const fade = kfs.find((kf) => kf[0].opacity === 1 && kf[1].opacity === 0);
		expect(fade).toBeDefined();
		c.destroy();
	});

	it('does NOT fade a captured row that merely scrolled out but is still in the model', () => {
		stubAnimate();
		const exitLayer = document.createElement('div');
		const a = slot('data:a', 0);
		const b = slot('data:b', 40);
		const active = new Map<number, any>([
			[0, a],
			[1, b],
		]);
		// Both rows are still live in the model; b just isn't rendered this frame.
		const c = new LayoutTransitionController(() => active, { getExitLayer: () => exitLayer, isRowIdLive: () => true });
		c.captureSnapshot();
		active.delete(1);
		c.beginAnimation();
		expect(exitLayer.children.length).toBe(0);
		c.destroy();
	});

	it('cancel() removes in-flight exit ghosts (no ghost survives a scroll)', () => {
		stubAnimate();
		const exitLayer = document.createElement('div');
		const a = slot('data:a', 0);
		const b = slot('data:b', 40);
		const active = new Map<number, any>([
			[0, a],
			[1, b],
		]);
		const c = new LayoutTransitionController(() => active, { getExitLayer: () => exitLayer, isRowIdLive: (id) => id === 'data:a' });
		c.captureSnapshot();
		active.delete(1);
		c.beginAnimation();
		expect(exitLayer.children.length).toBe(1);
		c.cancel();
		expect(exitLayer.children.length).toBe(0);
		c.destroy();
	});

	it('does not clone or ghost when no exit layer is configured', () => {
		stubAnimate();
		const a = slot('data:a', 0);
		const active = new Map<number, any>([[0, a]]);
		const c = new LayoutTransitionController(() => active, { isRowIdLive: () => false });
		c.captureSnapshot();
		active.delete(0);
		expect(() => c.beginAnimation()).not.toThrow();
		c.destroy();
	});
});

describe('LayoutTransitionController — detail height animation (Plan 045)', () => {
	const originalAnimate = (HTMLElement.prototype as any).animate;
	afterEach(() => {
		(HTMLElement.prototype as any).animate = originalAnimate;
	});

	function detailSlot(id: string, top: number, height: number): any {
		const s: any = slot(id, top);
		s.rowKind = 'detail';
		s.lastHeight = height;
		return s;
	}

	it('grows an entering detail row from height 0 to its full height', () => {
		const kfs: Keyframe[][] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			kfs.push(kf);
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};
		const a = slot('data:a', 0);
		const active = new Map<number, any>([[0, a]]);
		const c = new LayoutTransitionController(() => active);
		c.captureSnapshot(); // non-empty snapshot so enter animates
		const detail = detailSlot('detail:a', 40, 200);
		active.set(1, detail);
		c.beginAnimation();

		const grow = kfs.find((kf) => kf[0].height === '0px' && kf[1].height === '200px');
		expect(grow).toBeDefined();
		c.destroy();
	});

	it('shrinks an exiting detail row ghost from full height to 0', () => {
		const kfs: Keyframe[][] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[]) {
			kfs.push(kf);
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};
		const exitLayer = document.createElement('div');
		const detail = detailSlot('detail:a', 40, 200);
		const active = new Map<number, any>([[0, detail]]);
		const c = new LayoutTransitionController(() => active, { getExitLayer: () => exitLayer, isRowIdLive: () => false });
		c.captureSnapshot();
		active.delete(0);
		c.beginAnimation();

		expect(exitLayer.children.length).toBe(1);
		const shrink = kfs.find((kf) => kf[0].height === '200px' && kf[1].height === '0px');
		expect(shrink).toBeDefined();
		c.destroy();
	});
});

describe('row animation options', () => {
	const originalAnimate = (HTMLElement.prototype as any).animate;
	afterEach(() => {
		(HTMLElement.prototype as any).animate = originalAnimate;
	});
	function recordAnimate() {
		const calls: { kf: Keyframe[]; options: KeyframeAnimationOptions; el: HTMLElement }[] = [];
		(HTMLElement.prototype as any).animate = function (kf: Keyframe[], options: KeyframeAnimationOptions) {
			calls.push({ kf, options, el: this });
			return { cancel: vi.fn(), onfinish: null, oncancel: null } as unknown as Animation;
		};
		return calls;
	}
	function sortOf(count: number) {
		const slots = Array.from({ length: count }, (_, i) => slot(`r${i}`, i * 40));
		return { slots, reverse: () => slots.forEach((s, i) => (s.lastTop = (count - 1 - i) * 40)) };
	}

	it('stagger cascades rows top to bottom (by new position), holding their start until their turn', () => {
		const calls = recordAnimate();
		const { slots, reverse } = sortOf(3);
		const c = new LayoutTransitionController(makeRows(slots), { getRowAnimation: () => ({ stagger: 30, easing: 'snappy', duration: 400 }) });
		c.captureSnapshot('sort');
		reverse();
		c.beginAnimation();
		const byTop = [...calls]
			.sort((a, b) => (a.options.delay ?? 0) - (b.options.delay ?? 0))
			.map((x) => slots.find((s) => s.element === x.el)!.lastTop);
		// The middle row of a reversed three keeps its place, so it does not animate.
		expect(byTop).toEqual([0, 80]);
		expect(calls.map((x) => x.options.delay).sort((a, b) => a! - b!)).toEqual([0, 30]);
		expect(calls.find((x) => x.options.delay === 30)!.options.fill).toBe('backwards');
		expect(calls[0].options.duration).toBe(400);
		expect(calls[0].options.easing).toBe('cubic-bezier(0.2, 0, 0, 1)');
		c.destroy();
	});

	it('caps the whole cascade so a large change still finishes quickly', () => {
		const calls = recordAnimate();
		const { slots, reverse } = sortOf(50);
		const c = new LayoutTransitionController(makeRows(slots), { getRowAnimation: () => ({ stagger: 40 }) });
		c.captureSnapshot('sort');
		reverse();
		c.beginAnimation();
		expect(Math.max(...calls.map((x) => x.options.delay ?? 0))).toBeLessThanOrEqual(240);
		c.destroy();
	});

	it("'fade' fades moved rows in place; 'none' and a switched-off change do not animate", () => {
		let calls = recordAnimate();
		let { slots, reverse } = sortOf(2);
		let c = new LayoutTransitionController(makeRows(slots), { getRowAnimation: () => ({ style: 'fade' }) });
		c.captureSnapshot('sort');
		reverse();
		c.beginAnimation();
		expect(calls).toHaveLength(2);
		expect(calls[0].kf).toEqual([{ opacity: 0 }, { opacity: 1 }]);
		c.destroy();

		for (const options of [{ style: 'none' as const }, { on: { sort: false } }]) {
			calls = recordAnimate();
			({ slots, reverse } = sortOf(2));
			c = new LayoutTransitionController(makeRows(slots), { getRowAnimation: () => options });
			c.captureSnapshot('sort');
			reverse();
			c.beginAnimation();
			expect(calls).toHaveLength(0);
			c.destroy();
		}
	});
});
