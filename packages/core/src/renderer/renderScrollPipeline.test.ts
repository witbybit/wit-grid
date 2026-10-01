import { describe, expect, it, vi } from 'vitest';
import { RenderRuntimeState } from './renderRuntimeState.js';
import { RenderScrollPipeline } from './renderScrollPipeline.js';

describe('RenderScrollPipeline fidelity scheduling', () => {
	it('rejects a callback that escaped cancellation from a prior scroll epoch', () => {
		const callbacks: Array<() => void> = [];
		const runtimeState = new RenderRuntimeState();
		runtimeState.transitionTo('scroll-pending');
		runtimeState.transitionTo('idle');
		const decorateDirtyCellsAfterScroll = vi.fn(() => ({ processed: 0, remaining: 0, remainingMotion: 0, remainingFidelity: 0 }));
		const scheduler = {
			idle: (callback: () => void) => {
				callbacks.push(callback);
				return callbacks.length;
			},
			cancelIdle: vi.fn(),
		};
		const coordinator = new RenderScrollPipeline({
			engine: { rowVersions: new Map(), columns: { getCompiledPlan: () => ({}) } },
			runtimeState,
			gridScheduler: scheduler,
			rowRenderer: { decorateDirtyCellsAfterScroll },
			portalMountManager: { beginCellReleaseTransaction: vi.fn(), endCellReleaseTransaction: vi.fn() },
			renderStats: {
				postScrollFidelityChunks: 0,
				maxFidelityCellsDecoratedInOneChunk: 0,
				cellsDecoratedAfterScroll: 0,
				fidelityCellsDecoratedAfterScroll: 0,
			},
		} as any);

		coordinator.scheduleBudgetedFidelityDecoration();
		runtimeState.transitionTo('scroll-pending');
		coordinator.clearPostScrollDecorationTimer();
		runtimeState.transitionTo('idle');
		coordinator.scheduleBudgetedFidelityDecoration();

		callbacks[0]!();
		expect(decorateDirtyCellsAfterScroll).not.toHaveBeenCalled();
		expect(coordinator.fidelityDecorationScheduled).toBe(true);

		callbacks[1]!();
		expect(decorateDirtyCellsAfterScroll).toHaveBeenCalledTimes(1);
	});
});
