// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { computeGridLayoutPlan } from './layoutPlan.js';
import { RenderEngine } from './renderEngine.js';
import { RenderRuntimeState } from './renderRuntimeState.js';
import { RenderScrollPipeline } from './renderScrollPipeline.js';
import { DefaultFrameCoordinator } from './frameCoordinator.js';
import type { GridIdleDeadline, GridScheduler } from './gridScheduler.js';
import { ScrollEngine } from './scrollEngine.js';
import { GridEngine } from '../engine/GridEngine.js';
import { sortDirtyCellsForRepair } from './rowRenderMaintenance.js';

type Row = { id: string; name: string; amount: number };

function makeStore(nameOverrides: Record<string, unknown> = {}, amountOverrides: Record<string, unknown> = {}, rowCount = 200) {
	const columns = [
		{ field: 'name', header: 'Name', width: 120, ...nameOverrides },
		{ field: 'amount', header: 'Amount', width: 120, ...amountOverrides },
	];
	const store = new GridStore<Row>({ columns: columns as never, defaultRowHeight: 40, defaultColWidth: 120, getRowId: (row) => row.id });
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
		rows: Array.from({ length: rowCount }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}`, amount: index * 1000 + 0.5 })),
		columns: store.getState().columns,
	});
	return { store, controller };
}

function makeContainer(height = 200): HTMLDivElement {
	const container = document.createElement('div');
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 500,
		bottom: height,
		width: 500,
		height,
		toJSON: () => ({}),
	});
	document.body.appendChild(container);
	return container;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.textContent = '';
});

describe('layout plan memoization across scroll frames', () => {
	it('reuses topology and header bands (no per-column canMoveColumn calls) when only scroll moved', () => {
		const canMoveColumn = vi.fn(() => true);
		const { store, controller } = makeStore({ canMoveColumn });
		store.setViewportSize(500, 300);

		const first = computeGridLayoutPlan(store.engine);
		expect(canMoveColumn).toHaveBeenCalledTimes(1);
		for (let frame = 1; frame <= 5; frame++) {
			store.engine.viewport.setScrollPosition(frame * 40, 0, frame * 16);
			const next = computeGridLayoutPlan(store.engine);
			expect(next.viewport.scrollTop).toBe(frame * 40);
			expect(next.columnTopology).toBe(first.columnTopology);
			expect(next.headerBands).toBe(first.headerBands);
		}
		expect(canMoveColumn).toHaveBeenCalledTimes(1);

		// A structural change (pins → new compiled plan) rebuilds the static half.
		store.setViewportPins({ left: 1 });
		const pinned = computeGridLayoutPlan(store.engine);
		expect(pinned.columnTopology).not.toBe(first.columnTopology);
		expect(pinned.headerBands[0].cells[0].pinned).toBe('left');
		expect(canMoveColumn).toHaveBeenCalledTimes(2);

		controller.dispose();
		store.destroy();
	});

	it('skips container/layer style writes when no layout scalar changed', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		const { store, controller } = makeStore();
		const container = makeContainer();
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const setProperty = vi.spyOn(container.style, 'setProperty');
		store.engine.viewport.setScrollPosition(400, 0);
		renderer.viewportRenderer.syncLayoutPlan(computeGridLayoutPlan(store.engine));
		expect(setProperty).not.toHaveBeenCalled();

		const plan = computeGridLayoutPlan(store.engine);
		renderer.viewportRenderer.syncLayoutPlan({ ...plan, dimensions: { ...plan.dimensions, contentWidth: plan.dimensions.contentWidth + 10 } });
		expect(setProperty).toHaveBeenCalledWith('--og-content-width', `${plan.dimensions.contentWidth + 10}px`);
		expect(renderer.viewportRenderer.rowsContainer!.style.width).toBe(`${plan.dimensions.contentWidth + 10}px`);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});
});

describe('post-scroll repair ordering', () => {
	it('evaluates each dirty cell priority once per sort', () => {
		const cells = Array.from({ length: 50 }, (_, index) => {
			const cell = {} as HTMLDivElement & { __cellSlot: { rowIndex: number; colIndex: number; cellInstanceId: string } };
			cell.__cellSlot = { rowIndex: index % 7, colIndex: index % 3, cellInstanceId: `c${index}` };
			return cell;
		});
		const priorityOf = new Map(cells.map((cell, index) => [cell as HTMLDivElement, (index % 5) + 1]));
		const getPriority = vi.fn((cell: HTMLDivElement) => priorityOf.get(cell)!);
		sortDirtyCellsForRepair(cells, getPriority);
		expect(getPriority).toHaveBeenCalledTimes(50);
		for (let i = 1; i < cells.length; i++) {
			expect(priorityOf.get(cells[i - 1])!).toBeGreaterThanOrEqual(priorityOf.get(cells[i])!);
		}
	});
});

describe('deadline-aware post-scroll decoration budgets', () => {
	function makeCoordinator(remainingBatches: number) {
		const callbacks: Array<(deadline?: GridIdleDeadline) => void> = [];
		const runtimeState = new RenderRuntimeState();
		let left = remainingBatches;
		const decorateDirtyCellsAfterScroll = vi.fn((options: { maxCells: number; lane: string }) => {
			if (options.lane !== 'motion' || left <= 0) return { processed: 0, remaining: 0, remainingMotion: 0, remainingFidelity: 0 };
			left--;
			return { processed: options.maxCells, remaining: left, remainingMotion: left, remainingFidelity: 0 };
		});
		const renderStats = {
			postScrollMotionChunks: 0,
			postScrollFidelityChunks: 0,
			maxMotionCellsDecoratedInOneChunk: 0,
			maxFidelityCellsDecoratedInOneChunk: 0,
			cellsDecoratedAfterScroll: 0,
			motionCellsDecoratedAfterScroll: 0,
			fidelityCellsDecoratedAfterScroll: 0,
		};
		const coordinator = new RenderScrollPipeline(
			{
				engine: { rowVersions: new Map(), columns: { getCompiledPlan: () => ({}) } },
				runtimeState,
				gridScheduler: {
					idle: (callback: (deadline?: GridIdleDeadline) => void) => {
						callbacks.push(callback);
						return callbacks.length;
					},
					cancelIdle: vi.fn(),
				},
				rowRenderer: { decorateDirtyCellsAfterScroll },
				portalMountManager: { beginCellReleaseTransaction: vi.fn(), endCellReleaseTransaction: vi.fn() },
				renderStats,
			} as any,
			{ postScrollDecorationBudget: 32, postScrollFidelityBudget: 12 }
		);
		return { coordinator, callbacks, decorateDirtyCellsAfterScroll, renderStats };
	}

	it('keeps the fixed batch count when there is no deadline or the idle callback timed out', () => {
		const noDeadline = makeCoordinator(5);
		noDeadline.coordinator.scheduleBudgetedDecoration();
		noDeadline.callbacks[0]!();
		expect(noDeadline.decorateDirtyCellsAfterScroll).toHaveBeenCalledTimes(1);

		const timedOut = makeCoordinator(5);
		timedOut.coordinator.scheduleBudgetedDecoration();
		timedOut.callbacks[0]!({ didTimeout: true, timeRemaining: () => 50 });
		expect(timedOut.decorateDirtyCellsAfterScroll).toHaveBeenCalledTimes(1);
	});

	it('runs extra batches while the idle deadline has time left, and stops when it runs out', () => {
		const roomy = makeCoordinator(5);
		roomy.coordinator.scheduleBudgetedDecoration();
		roomy.callbacks[0]!({ didTimeout: false, timeRemaining: () => 40 });
		// All five motion batches drain in one slice; the sixth call is the fidelity lane probe
		// only if motion is exhausted with fidelity remaining (it is not here).
		expect(roomy.decorateDirtyCellsAfterScroll).toHaveBeenCalledTimes(5);
		expect(roomy.renderStats.motionCellsDecoratedAfterScroll).toBe(5 * 32);
		expect(roomy.callbacks).toHaveLength(1);

		let time = 10;
		const tight = makeCoordinator(5);
		tight.coordinator.scheduleBudgetedDecoration();
		tight.callbacks[0]!({ didTimeout: false, timeRemaining: () => (time -= 4) });
		// 10 → 6 (> margin, run), 6 → 2 (stop): two batches, then a follow-up idle slice.
		expect(tight.decorateDirtyCellsAfterScroll).toHaveBeenCalledTimes(2);
		expect(tight.callbacks).toHaveLength(2);
	});
});

describe('scroll-end detection', () => {
	function makeFrameCoordinator(options: { scrollEndQuietMs?: number; now?: () => number } = {}) {
		const rs = new RenderRuntimeState();
		const onScrollEnd = vi.fn();
		const rafs: Array<() => void> = [];
		const gs: GridScheduler = {
			microtask: (cb) => cb(),
			raf: (cb) => {
				rafs.push(cb);
				return rafs.length;
			},
			cancelRaf: vi.fn(),
			idle: () => 0,
			cancelIdle: vi.fn(),
			supportsIdle: () => false,
			timeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
			clearTimeout: vi.fn(),
		};
		const coordinator = new DefaultFrameCoordinator({
			onScrollFrame: vi.fn(),
			onPaintFrame: vi.fn(),
			onPostScrollWork: vi.fn(),
			onScrollEnd,
			gridScheduler: gs,
			runtimeState: rs,
			...options,
		});
		return { rs, onScrollEnd, rafs, coordinator };
	}

	it('waits for the time-based quiet window, not just a frame count (240Hz frames)', () => {
		let now = 0;
		const { rs, onScrollEnd, rafs, coordinator } = makeFrameCoordinator({ scrollEndQuietMs: 100, now: () => now });
		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();
		rafs[0]!();
		// Eight quiet 240Hz frames (~33ms) — well past the 3-frame count, still mid-gesture.
		for (let i = 1; i <= 8; i++) {
			now += 4.17;
			rafs[i]!();
		}
		expect(onScrollEnd).not.toHaveBeenCalled();
		expect(rs.isScrolling()).toBe(true);

		now = 101;
		rafs[rafs.length - 1]!();
		expect(onScrollEnd).toHaveBeenCalledTimes(1);
		expect(rs.phase).toBe('idle');
	});

	it('native scrollend ends the scroll once 50ms pass without movement, well before the 100ms fallback', () => {
		let t = 0;
		const { rs, onScrollEnd, rafs, coordinator } = makeFrameCoordinator({ scrollEndQuietMs: 100, now: () => t });
		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();
		rafs[0]!();
		coordinator.notifyScrollEnd();
		t = 16;
		rafs[rafs.length - 1]!();
		expect(onScrollEnd).not.toHaveBeenCalled();
		t = 50;
		rafs[rafs.length - 1]!();
		expect(onScrollEnd).toHaveBeenCalledTimes(1);
		expect(rs.phase).toBe('idle');
	});

	it('native scrollend that arrives before the final scroll frame ends the scroll after that frame', () => {
		let t = 0;
		const { rs, onScrollEnd, rafs, coordinator } = makeFrameCoordinator({ scrollEndQuietMs: 100, now: () => t });
		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();
		coordinator.notifyScrollEnd();
		rafs[0]!();
		expect(onScrollEnd).not.toHaveBeenCalled();
		t = 60;
		rafs[rafs.length - 1]!();
		expect(onScrollEnd).toHaveBeenCalledTimes(1);
	});

	it('a stream of discrete scrolls that each fire scrollend keeps one scroll session until it stops', () => {
		// Instant wheel ticks and scripted scrollTop assignments each fire scrollend while the scroll
		// is still going: the session must not end (and restart) between steps.
		let t = 0;
		const { rs, onScrollEnd, rafs, coordinator } = makeFrameCoordinator({ scrollEndQuietMs: 100, now: () => t });
		rs.transitionTo('scroll-pending');
		for (let step = 0; step < 5; step++) {
			coordinator.requestScrollFrame();
			rafs[rafs.length - 1]!();
			coordinator.notifyScrollEnd();
			t += 16;
			rafs[rafs.length - 1]!(); // a quiet frame between steps
			t += 16;
			expect(onScrollEnd).not.toHaveBeenCalled();
			expect(rs.isScrolling()).toBe(true);
		}
		t += 50; // the stream stopped
		rafs[rafs.length - 1]!();
		expect(onScrollEnd).toHaveBeenCalledTimes(1);
	});

	it('ScrollEngine forwards native scrollend to its scroll-end callback', () => {
		const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
		const hadNative = 'onscrollend' in proto;
		if (!hadNative) proto.onscrollend = null;
		try {
			const scrollEngine = new ScrollEngine(new GridEngine({ columns: [] }));
			const container = document.createElement('div');
			const onScroll = vi.fn();
			const onScrollEnd = vi.fn();
			scrollEngine.bind(container, onScroll, onScrollEnd);
			container.dispatchEvent(new Event('scrollend'));
			expect(onScrollEnd).toHaveBeenCalledTimes(1);
			scrollEngine.unbind();
		} finally {
			if (!hadNative) delete proto.onscrollend;
		}
	});
});

describe('selection overlay during scroll', () => {
	it('moves the selection border with the content on every scroll frame', () => {
		const rafs: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			rafs.push(cb);
			return rafs.length;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		const { store, controller } = makeStore();
		const container = makeContainer();
		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);
		store.selectRange({ rowId: 'row-2', colField: 'name' }, { rowId: 'row-3', colField: 'amount' });
		renderer.overlayRenderer.repaintOverlay();
		const border = container.querySelector('.og-selection-border') as HTMLDivElement;
		expect(border).not.toBeNull();
		const before = border.style.transform;

		const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		scrollViewport.scrollTop = 40;
		scrollViewport.dispatchEvent(new Event('scroll'));
		rafs[rafs.length - 1]!(0);

		expect(renderer.getRenderStats().scrollFrames).toBeGreaterThan(0);
		expect(border.style.transform).not.toBe(before);
		expect(border.style.transform).toContain(`${2 * 40 - 40}px`);

		renderer.unmount();
		controller.dispose();
		store.destroy();
	});
});

describe('approach-band prewarm snapshots', () => {
	it('stores the valueFormatter output, not the raw value', () => {
		const rafs: FrameRequestCallback[] = [];
		const idleCallbacks: Array<(deadline?: GridIdleDeadline) => void> = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			rafs.push(cb);
			return rafs.length;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		const win = window as Window & { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
		const previousRequestIdleCallback = win.requestIdleCallback;
		const previousCancelIdleCallback = win.cancelIdleCallback;
		win.requestIdleCallback = (cb: (deadline?: GridIdleDeadline) => void) => {
			idleCallbacks.push(cb);
			return idleCallbacks.length;
		};
		win.cancelIdleCallback = () => {};
		const { store, controller } = makeStore(
			{},
			{
				valueFormatter: ({ value }: { value: unknown }) => `$${Number(value).toFixed(2)}`,
			}
		);
		const container = makeContainer(160);
		const renderer = new RenderEngine(store.engine, store);
		try {
			renderer.mount(container);
			const scrollViewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
			scrollViewport.scrollTop = 800;
			scrollViewport.dispatchEvent(new Event('scroll'));
			rafs[rafs.length - 1]!(0);
			expect(idleCallbacks.length).toBeGreaterThan(0);
			// Drop full-bind snapshots so every snapshot inspected below was written by the prewarm.
			store.engine.cellDisplaySnapshots.clear();
			for (const cb of [...idleCallbacks]) cb({ didTimeout: false, timeRemaining: () => 50 });

			expect(renderer.getRenderStats().prewarmedCellSnapshots).toBeGreaterThan(0);
			const snapshots = Array.from({ length: 40 }, (_, i) => store.engine.getCellDisplaySnapshot(`row-${i}`, 'amount')).filter(
				(snapshot) => snapshot !== undefined
			);
			expect(snapshots.length).toBeGreaterThan(0);
			for (const snapshot of snapshots) expect(snapshot!.formattedValue).toMatch(/^\$\d+\.\d{2}$/);
		} finally {
			renderer.unmount();
			controller.dispose();
			store.destroy();
			win.requestIdleCallback = previousRequestIdleCallback;
			win.cancelIdleCallback = previousCancelIdleCallback;
			if (previousRequestIdleCallback === undefined) delete win.requestIdleCallback;
			if (previousCancelIdleCallback === undefined) delete win.cancelIdleCallback;
		}
	});
});
