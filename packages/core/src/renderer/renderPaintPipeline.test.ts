import { describe, it, expect, vi } from 'vitest';
import { RenderPaintPipeline, type RenderPaintPipelineDeps } from './renderPaintPipeline.js';
import type { InvalidationFrame } from './invalidationManager.js';
import { createRenderRuntimeStats } from './renderTelemetry.js';

const SENTINEL_A = { tag: 'A' };
const SENTINEL_B = { tag: 'B' };

function createFrame(overrides: Partial<InvalidationFrame> = {}): InvalidationFrame {
	return {
		full: false,
		cellsByRowId: new Map(),
		rows: new Set(),
		rowRanges: [],
		columns: new Set(),
		groups: new Set(),
		headers: false,
		overlay: false,
		geometry: false,
		viewport: false,
		reasons: [],
		invalidations: [],
		...overrides,
	};
}

interface FakeGridState {
	styleRules: unknown;
	loading: unknown;
	defaultColWidth: number;
	defaultRowHeight: number;
}

function makeDeps(
	options: { state?: Partial<FakeGridState>; frame?: InvalidationFrame; scrolling?: boolean } = {},
	overrides: Partial<RenderPaintPipelineDeps<unknown>> = {}
): RenderPaintPipelineDeps<unknown> {
	const state: FakeGridState = { styleRules: undefined, loading: undefined, defaultColWidth: 100, defaultRowHeight: 40, ...options.state };
	const frame = options.frame ?? createFrame();
	return {
		engine: {
			stateManager: { getState: () => state },
			invalidation: {
				consume: vi.fn(() => frame),
				invalidateFull: vi.fn(),
				invalidateViewport: vi.fn(),
			},
			viewport: { consumeScrollAnchor: () => 0 },
		} as any,
		runtimeState: { isScrolling: () => options.scrolling ?? false } as any,
		renderStats: createRenderRuntimeStats(),
		frameCoordinator: { requestPaintFrame: vi.fn() } as any,
		geometryController: { recomputeIfNeeded: vi.fn(), invalidateAll: vi.fn() } as any,
		portalMountManager: { beginCellReleaseTransaction: vi.fn(), endCellReleaseTransaction: vi.fn() } as any,
		layoutTransition: { beginAnimation: vi.fn(), captureSnapshot: vi.fn() } as any,
		viewportRenderer: { syncViewportScrollFromDom: vi.fn(), scrollViewport: null, getLayoutPlan: vi.fn(() => ({ renderWindow: {} })) } as any,
		rowRenderer: {
			styleVersion: 0,
			loadingVersion: 0,
			syncInteractionAccessibility: vi.fn(),
			repaintInvalidatedRows: vi.fn(),
			repaintInvalidatedCells: vi.fn(),
		} as any,
		headerRenderer: { repaintHeaders: vi.fn(), sync: vi.fn() } as any,
		floatingFilterRenderer: { repaint: vi.fn() } as any,
		overlayRenderer: { repaintOverlay: vi.fn(), sync: vi.fn() } as any,
		stickyGroupRenderer: { sync: vi.fn(), refresh: vi.fn() } as any,
		viewportLayout: {
			syncLayoutPlan: vi.fn(() => ({ renderWindow: {} }) as any),
			recycleViewport: vi.fn(),
			scrollCellPointerIntoView: vi.fn(),
		},
		scrollLane: { markFlushPendingAfterScroll: vi.fn(), updateGeometryBounds: vi.fn() },
		resetScroll: vi.fn(),
		...overrides,
	};
}

// ─── Renderer epochs ─────────────────────────────────────────────────────────

describe('RenderPaintPipeline – refreshRendererEpochs', () => {
	it('bumps styleVersion once per distinct styleRules reference', () => {
		const deps = makeDeps({ state: { styleRules: SENTINEL_A } });
		const pipeline = new RenderPaintPipeline(deps);
		pipeline.refreshRendererEpochs();
		pipeline.refreshRendererEpochs();
		expect((deps.rowRenderer as any).styleVersion).toBe(1);
	});

	it('bumps loadingVersion once per distinct loading value', () => {
		const deps = makeDeps({ state: { loading: true } });
		const pipeline = new RenderPaintPipeline(deps);
		pipeline.refreshRendererEpochs();
		pipeline.refreshRendererEpochs();
		expect((deps.rowRenderer as any).loadingVersion).toBe(1);
	});

	it('bumps both when both change', () => {
		const gridState: FakeGridState = { styleRules: SENTINEL_A, loading: true, defaultColWidth: 100, defaultRowHeight: 40 };
		const deps = makeDeps({}, { engine: { stateManager: { getState: () => gridState } } as any });
		const pipeline = new RenderPaintPipeline(deps);
		pipeline.refreshRendererEpochs();
		gridState.styleRules = SENTINEL_B;
		gridState.loading = false;
		pipeline.refreshRendererEpochs();
		expect((deps.rowRenderer as any).styleVersion).toBe(2);
		expect((deps.rowRenderer as any).loadingVersion).toBe(2);
	});
});

// ─── Layout transition gate ──────────────────────────────────────────────────

describe('RenderPaintPipeline – flushPaint transition gate', () => {
	function flushWithReason(reason: string, scrolling = false) {
		const deps = makeDeps({ frame: createFrame({ reasons: [reason] }), scrolling });
		const pipeline = new RenderPaintPipeline(deps);
		pipeline.flushPaint();
		return deps;
	}

	it.each([['sort'], ['group expansion'], ['detail']])('plays the transition for a %s frame while not scrolling', (reason) => {
		expect((flushWithReason(reason).layoutTransition as any).beginAnimation).toHaveBeenCalledTimes(1);
	});

	it('does not play the transition while scrolling', () => {
		expect((flushWithReason('sort', true).layoutTransition as any).beginAnimation).not.toHaveBeenCalled();
	});

	it('does not play the transition for other frames', () => {
		expect((flushWithReason('filter').layoutTransition as any).beginAnimation).not.toHaveBeenCalled();
	});

	it('plays the transition once, after the dispatch has repositioned rows', () => {
		const deps = makeDeps();
		const frames = [createFrame({ reasons: ['group expansion'], viewport: true }), createFrame({ reasons: ['data'], viewport: true })];
		(deps.engine.invalidation.consume as any).mockImplementation(() => frames.shift());
		const order: string[] = [];
		(deps.viewportLayout.recycleViewport as any).mockImplementation(() => order.push('recycle'));
		(deps.layoutTransition as any).beginAnimation = vi.fn(() => order.push('beginAnimation'));
		const pipeline = new RenderPaintPipeline(deps);
		pipeline.flushPaint();
		pipeline.flushPaint();
		expect(order).toEqual(['recycle', 'beginAnimation', 'recycle']);
	});

	it('wraps the dispatch in exactly one portal release transaction', () => {
		const begin = vi.fn();
		const end = vi.fn();
		let insideTransaction = false;
		const deps = makeDeps(
			{ frame: createFrame({ viewport: true }) },
			{ portalMountManager: { beginCellReleaseTransaction: begin, endCellReleaseTransaction: end } as any }
		);
		(deps.viewportLayout.recycleViewport as any).mockImplementation(() => {
			insideTransaction = begin.mock.calls.length === 1 && end.mock.calls.length === 0;
		});
		new RenderPaintPipeline(deps).flushPaint();
		expect(insideTransaction).toBe(true);
		expect(begin).toHaveBeenCalledTimes(1);
		expect(end).toHaveBeenCalledTimes(1);
	});
});

// ─── Dispatch ────────────────────────────────────────────────────────────────

describe('RenderPaintPipeline – dispatch', () => {
	it('treats row-range invalidations as viewport work instead of ignoring them', () => {
		const deps = makeDeps();
		new RenderPaintPipeline(deps).dispatch(
			createFrame({
				rowRanges: [{ startIndex: 4, endIndex: 9, reason: 'data' }],
				reasons: ['data'],
				invalidations: [{ kind: 'row-range', startIndex: 4, endIndex: 9, reason: 'data' }],
			})
		);
		expect(deps.viewportLayout.recycleViewport).toHaveBeenCalledTimes(1);
		expect((deps.overlayRenderer as any).sync).toHaveBeenCalledTimes(1);
		expect((deps.rowRenderer as any).repaintInvalidatedRows).not.toHaveBeenCalled();
		expect((deps.rowRenderer as any).repaintInvalidatedCells).not.toHaveBeenCalled();
		expect((deps.headerRenderer as any).sync).not.toHaveBeenCalled();
		expect((deps.geometryController as any).recomputeIfNeeded).not.toHaveBeenCalled();
		expect(deps.renderStats.rowPaints).toBe(6);
		expect(deps.renderStats.viewportPaints).toBe(1);
		expect(deps.renderStats.lastInvalidationReasons).toEqual(['data']);
	});

	it('treats group invalidations as viewport work instead of ignoring them', () => {
		const deps = makeDeps();
		new RenderPaintPipeline(deps).dispatch(
			createFrame({
				groups: new Set(['group:region:Americas']),
				reasons: ['group expansion'],
				invalidations: [{ kind: 'group', groupId: 'group:region:Americas', reason: 'group expansion' }],
			})
		);
		expect(deps.viewportLayout.recycleViewport).toHaveBeenCalledTimes(1);
		expect((deps.overlayRenderer as any).sync).toHaveBeenCalledTimes(1);
	});

	it('routes a full frame to the full paint only', () => {
		const deps = makeDeps();
		new RenderPaintPipeline(deps).dispatch(createFrame({ full: true, rows: new Set(['r1']) }));
		expect(deps.renderStats.fullPaints).toBe(1);
		expect(deps.scrollLane.updateGeometryBounds).toHaveBeenCalledWith(100, 40);
		expect((deps.headerRenderer as any).repaintHeaders).toHaveBeenCalledTimes(1);
		expect((deps.rowRenderer as any).repaintInvalidatedRows).not.toHaveBeenCalled();
		expect(deps.renderStats.rowPaints).toBe(0);
	});

	it('routes cell, row, header and geometry work to their renderers', () => {
		const deps = makeDeps();
		new RenderPaintPipeline(deps).dispatch(
			createFrame({ rows: new Set(['r1']), cellsByRowId: new Map([['r2', new Set(['a', 'b'])]]), headers: true, geometry: true })
		);
		expect((deps.geometryController as any).recomputeIfNeeded).toHaveBeenCalledTimes(1);
		expect((deps.rowRenderer as any).repaintInvalidatedRows).toHaveBeenCalledTimes(1);
		expect((deps.rowRenderer as any).repaintInvalidatedCells).toHaveBeenCalledTimes(1);
		expect((deps.headerRenderer as any).sync).toHaveBeenCalledTimes(1);
		// Sticky header copies repeat group rows, so row and cell repaints refresh them once.
		expect((deps.stickyGroupRenderer as any).refresh).toHaveBeenCalledTimes(1);
		expect(deps.renderStats.cellPaints).toBe(2);
		expect(deps.renderStats.rowPaints).toBe(1);
	});
});

// ─── Paint requests ──────────────────────────────────────────────────────────

describe('RenderPaintPipeline – paint requests', () => {
	it('requests a paint frame when idle', () => {
		const deps = makeDeps();
		new RenderPaintPipeline(deps).scheduleViewportPaint('test');
		expect(deps.engine.invalidation.invalidateViewport).toHaveBeenCalledWith('test');
		expect(deps.frameCoordinator.requestPaintFrame).toHaveBeenCalledTimes(1);
		expect(deps.scrollLane.markFlushPendingAfterScroll).not.toHaveBeenCalled();
	});

	it('defers to the end of the scroll while scrolling', () => {
		const deps = makeDeps({ scrolling: true });
		new RenderPaintPipeline(deps).scheduleFullPaint('test');
		expect(deps.engine.invalidation.invalidateFull).toHaveBeenCalledWith('test');
		expect(deps.frameCoordinator.requestPaintFrame).not.toHaveBeenCalled();
		expect(deps.scrollLane.markFlushPendingAfterScroll).toHaveBeenCalledTimes(1);
	});
});
