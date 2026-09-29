import { describe, expect, it } from 'vitest';
import { collectRenderStats, createRenderRuntimeStats, type RenderRuntimeStats } from './renderTelemetry.js';

function makeDeps(runtimeStats: RenderRuntimeStats) {
	return {
		engine: {
			columns: { getCompiledPlanVersion: () => 0 },
			rowCtrls: { stats: { created: 0, reused: 0, evicted: 0, cellCtrlsCreated: 0, cellCtrlsReused: 0 } },
		},
		portalMountManager: {
			getScrollStats: () => ({
				portalFlushesDuringScroll: 0,
				portalDeferredDuringScroll: 0,
				portalMountsDuringScroll: 0,
				portalReleasesDuringScroll: 0,
				portalFlushChunks: 0,
				maxPortalOpsFlushedInOneChunk: 0,
			}),
			getStats: () => ({ cells: 0, rows: 0, menus: 0 }),
			customRendererManager: { getStats: () => ({}) },
		},
		rowRenderer: {},
		runtimeStats,
	} as any;
}

describe('collectRenderStats', () => {
	it('reports every runtime counter exactly as counted: none is dropped or shadowed', () => {
		const runtime = createRenderRuntimeStats();
		// runtimeLimitsClamped is optional (counted lazily by the row renderer); it was once reported as 0.
		runtime.runtimeLimitsClamped = 0;
		const expected: Record<string, unknown> = {};
		let n = 1;
		for (const key of Object.keys(runtime) as Array<keyof RenderRuntimeStats>) {
			if (typeof runtime[key] === 'number') {
				(runtime as unknown as Record<string, number>)[key] = n;
				expected[key] = n++;
			}
		}
		const stats = collectRenderStats(makeDeps(runtime)) as unknown as Record<string, unknown>;
		for (const [key, value] of Object.entries(expected)) expect(stats[key], key).toBe(value);
		expect(stats.runtimeLimitsClamped).not.toBe(0);
	});

	it('copies the list counters, so a later frame does not change an earlier snapshot', () => {
		const runtime = createRenderRuntimeStats();
		runtime.cellsPatchedPerScrollFrame.push(3);
		runtime.lastInvalidationReasons = ['sort'];
		const stats = collectRenderStats(makeDeps(runtime));
		runtime.cellsPatchedPerScrollFrame.push(4);
		expect(stats.cellsPatchedPerScrollFrame).toEqual([3]);
		expect(stats.lastInvalidationReasons).toEqual(['sort']);
		expect(stats.lastInvalidationReasons).not.toBe(runtime.lastInvalidationReasons);
	});
});
