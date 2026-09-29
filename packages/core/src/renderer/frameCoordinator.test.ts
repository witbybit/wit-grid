import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultFrameCoordinator } from './frameCoordinator.js';
import { RenderRuntimeState } from './renderRuntimeState.js';
import type { GridScheduler } from './gridScheduler.js';
import type { FrameCoordinatorDeps } from './frameCoordinator.js';

function makeSyncScheduler(): GridScheduler {
	return {
		microtask: (cb) => cb(),
		raf: (cb) => {
			cb();
			return 0;
		},
		cancelRaf: vi.fn(),
		idle: (cb) => {
			cb();
			return 0;
		},
		cancelIdle: vi.fn(),
		timeout: (cb, ms) => setTimeout(cb, ms),
		clearTimeout: (id) => clearTimeout(id),
	};
}

function makeBaseDeps(overrides: Partial<FrameCoordinatorDeps> = {}): FrameCoordinatorDeps {
	return {
		onScrollFrame: vi.fn(),
		onPaintFrame: vi.fn(),
		onPostScrollWork: vi.fn(),
		gridScheduler: makeSyncScheduler(),
		...overrides,
	};
}

describe('DefaultFrameCoordinator', () => {
	it('requestScrollFrame() triggers the onScrollFrame callback', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onScrollFrame, onPaintFrame }));

		coordinator.requestScrollFrame();

		expect(onScrollFrame).toHaveBeenCalledTimes(1);
		expect(onPaintFrame).not.toHaveBeenCalled();
	});

	it('requestPaintFrame() triggers the onPaintFrame callback', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onScrollFrame, onPaintFrame }));

		coordinator.requestPaintFrame();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
		expect(onScrollFrame).not.toHaveBeenCalled();
	});

	it('requestPostScrollWork() triggers the onPostScrollWork callback (not onPaintFrame)', () => {
		const onPaintFrame = vi.fn();
		const onPostScrollWork = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, onPostScrollWork }));

		coordinator.requestPostScrollWork();

		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
		expect(onPaintFrame).not.toHaveBeenCalled();
	});

	it('flushNowForTests() invokes paint synchronously without scheduling', () => {
		const raf = vi.fn((cb: () => void) => {
			cb();
			return 0;
		});
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, gridScheduler: { ...makeSyncScheduler(), raf } }));

		coordinator.flushNowForTests();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
		expect(raf).not.toHaveBeenCalled();
	});

	it('duplicate requestScrollFrame() calls are coalesced to one callback', () => {
		const onScrollFrame = vi.fn();
		let captured: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				captured = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onScrollFrame, gridScheduler: gs }));

		coordinator.requestScrollFrame();
		coordinator.requestScrollFrame();
		captured?.();

		expect(onScrollFrame).toHaveBeenCalledTimes(1);
	});

	it('duplicate requestPaintFrame() calls are coalesced to one callback', () => {
		const onPaintFrame = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, gridScheduler: gs }));

		coordinator.requestPaintFrame();
		coordinator.requestPaintFrame();
		(capturedRaf as unknown as () => void)();

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
	});

	it('duplicate requestPostScrollWork() calls are coalesced to one callback', () => {
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, gridScheduler: gs }));

		coordinator.requestPostScrollWork();
		coordinator.requestPostScrollWork();
		(capturedRaf as unknown as () => void)();

		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
	});

	it('destroy() prevents further scheduling', () => {
		const onScrollFrame = vi.fn();
		const onPaintFrame = vi.fn();
		const onPostScrollWork = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onScrollFrame, onPaintFrame, onPostScrollWork }));

		coordinator.destroy();
		coordinator.requestScrollFrame();
		coordinator.requestPaintFrame();
		coordinator.requestPostScrollWork();

		expect(onScrollFrame).not.toHaveBeenCalled();
		expect(onPaintFrame).not.toHaveBeenCalled();
		expect(onPostScrollWork).not.toHaveBeenCalled();
	});

	it('destroy() cancels the single pending RAF (scroll + post-scroll share one RAF)', () => {
		const cancelRaf = vi.fn();
		let lastRafId = 0;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (_cb) => {
				/* intentionally do not fire — simulates async microtask */
			},
			raf: (_cb) => ++lastRafId,
			cancelRaf,
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ gridScheduler: gs }));

		coordinator.requestScrollFrame(); // RAF registered (rafId = 1)
		coordinator.requestPostScrollWork(); // RAF already registered — no-op
		coordinator.destroy();

		// Both share one RAF; destroy() cancels it once.
		expect(cancelRaf).toHaveBeenCalledTimes(1);
	});

	it('destroy() cancels paint RAF when it was already scheduled past the microtask', () => {
		const cancelRaf = vi.fn();
		let lastRafId = 0;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(), // fires synchronously so RAF is scheduled
			raf: (_cb) => ++lastRafId,
			cancelRaf,
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ gridScheduler: gs }));

		coordinator.requestPaintFrame(); // microtask fires → RAF scheduled
		coordinator.destroy();

		expect(cancelRaf).toHaveBeenCalledWith(lastRafId);
	});

	it('reports a fault and skips the frame when a reentrant scroll frame is detected', () => {
		const onFault = vi.fn();
		let capturedScrollRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedScrollRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onScrollFrame: () => {
					coordinator.requestScrollFrame();
					capturedScrollRaf?.();
				},
				gridScheduler: gs,
				onFault,
			})
		);

		coordinator.requestScrollFrame();
		capturedScrollRaf?.();

		expect(onFault).toHaveBeenCalledWith(expect.stringContaining('reentrant frame'));
	});

	it('reports a fault and skips the frame when a reentrant paint frame is detected (no runtimeState)', () => {
		const onFault = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					capturedRaf?.();
				},
				gridScheduler: gs,
				onFault,
			})
		);

		coordinator.requestPaintFrame();
		capturedRaf?.();

		expect(onFault).toHaveBeenCalledWith(expect.stringContaining('reentrant frame'));
	});
});

describe('DefaultFrameCoordinator – post-scroll epoch semantics (Plan 080)', () => {
	it('coalesces commit causes and drains them only into the executing paint', () => {
		const onPaintFrame = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame,
				gridScheduler: {
					...makeSyncScheduler(),
					raf: (cb) => {
						capturedRaf = cb;
						return 1;
					},
				},
			})
		);
		coordinator.requestPaintFrame([11]);
		coordinator.requestPaintFrame([12, 11]);
		expect(onPaintFrame).not.toHaveBeenCalled();
		capturedRaf?.();
		expect(onPaintFrame).toHaveBeenCalledWith([11, 12]);
		coordinator.flushNowForTests();
		expect(onPaintFrame).toHaveBeenLastCalledWith([]);
	});

	it('clears cancelled causes on destroy without attributing a frame', () => {
		const onPaintFrame = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame,
				gridScheduler: {
					...makeSyncScheduler(),
					raf: (cb) => {
						capturedRaf = cb;
						return 1;
					},
				},
			})
		);
		coordinator.requestPaintFrame([21]);
		coordinator.destroy();
		capturedRaf?.();
		expect(onPaintFrame).not.toHaveBeenCalled();
	});

	it('post-scroll work fires when scroll epoch matches', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, runtimeState: rs }));

		coordinator.requestPostScrollWork();

		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
	});

	it('post-scroll work is dropped when scroll epoch has advanced', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, gridScheduler: gs, runtimeState: rs }));

		coordinator.requestPostScrollWork([31]);
		// Simulate new scroll session starting before the RAF fires (advances scrollEpoch).
		rs.transitionTo('scroll-pending');
		rs.transitionTo('idle');
		capturedRaf?.();

		expect(onPostScrollWork).not.toHaveBeenCalled();
		coordinator.requestPostScrollWork();
		(capturedRaf as unknown as () => void)();
		expect(onPostScrollWork).toHaveBeenCalledWith([]);
	});

	it('post-scroll work is dropped when scroll is still active when RAF fires', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, gridScheduler: gs, runtimeState: rs }));

		coordinator.requestPostScrollWork();
		rs.transitionTo('scroll-pending');
		capturedRaf?.();

		expect(onPostScrollWork).not.toHaveBeenCalled();
	});

	it('paint and post-scroll coalesce into one RAF when both pending (Plan 093)', () => {
		const onPaintFrame = vi.fn();
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		let rafCount = 0;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(), // sync — fires before requestPostScrollWork() is called
			raf: (cb) => {
				rafCount++;
				capturedRaf = cb;
				return rafCount;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, onPostScrollWork, gridScheduler: gs }));

		coordinator.requestPaintFrame(); // microtask fires → scheduleFrame() → RAF registered (rafId = 1)
		coordinator.requestPostScrollWork(); // rafId already set → scheduleFrame() is a no-op

		capturedRaf?.(); // flush: scroll (none) → paint → post-scroll

		expect(rafCount).toBe(1);
		expect(onPaintFrame).toHaveBeenCalledTimes(1);
		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
	});
});

describe('DefaultFrameCoordinator – single RAF arbitration (Plan 093)', () => {
	it('scroll executes before paint even when paint is requested first', () => {
		const order: string[] = [];
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => order.push('paint'),
				onScrollFrame: () => order.push('scroll'),
				gridScheduler: gs,
			})
		);

		coordinator.requestPaintFrame(); // microtask fires → RAF registered
		coordinator.requestScrollFrame(); // pending scroll set; RAF already registered

		capturedRaf?.();

		expect(order).toEqual(['scroll', 'paint']);
	});

	it('scroll → paint → post-scroll all run in priority order in one RAF', () => {
		const order: string[] = [];
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onScrollFrame: () => order.push('scroll'),
				onPaintFrame: () => order.push('paint'),
				onPostScrollWork: () => order.push('post-scroll'),
				gridScheduler: gs,
			})
		);

		coordinator.requestPostScrollWork();
		coordinator.requestPaintFrame(); // microtask fires → scheduleFrame → no-op (rafId set)
		coordinator.requestScrollFrame(); // pending scroll set; RAF already registered

		capturedRaf?.();

		expect(order).toEqual(['scroll', 'paint', 'post-scroll']);
	});

	it('scroll request during scroll callback defers to next RAF (not lost)', () => {
		const onScrollFrame = vi.fn();
		const rafs: Array<() => void> = [];
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				rafs.push(cb);
				return rafs.length;
			},
		};
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onScrollFrame: () => {
					onScrollFrame();
					// Re-request only on the first callback to test deferral semantics.
					if (onScrollFrame.mock.calls.length === 1) {
						coordinator.requestScrollFrame();
					}
				},
				gridScheduler: gs,
			})
		);

		coordinator.requestScrollFrame();
		rafs[0]?.(); // first frame: scroll runs, requests second scroll
		rafs[1]?.(); // second frame: deferred scroll runs

		expect(onScrollFrame).toHaveBeenCalledTimes(2);
		expect(rafs.length).toBe(2);
	});

	it('exactly one RAF is registered for multiple simultaneous pending requests', () => {
		let rafRegistrations = 0;
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(),
			raf: (cb) => {
				rafRegistrations++;
				capturedRaf = cb;
				return rafRegistrations;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ gridScheduler: gs }));

		coordinator.requestScrollFrame();
		coordinator.requestPaintFrame(); // microtask → scheduleFrame → no-op
		coordinator.requestPostScrollWork(); // scheduleFrame → no-op

		expect(rafRegistrations).toBe(1);

		capturedRaf?.();
	});
});

describe('DefaultFrameCoordinator – runtime state integration (Plan 079)', () => {
	it('transitions to paint-frame before invoking the callback', () => {
		const rs = new RenderRuntimeState();
		let phaseInsidePaint: string | null = null;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					phaseInsidePaint = rs.phase;
				},
				runtimeState: rs,
			})
		);

		coordinator.requestPaintFrame();

		expect(phaseInsidePaint).toBe('paint-frame');
	});

	it('returns to idle after a successful paint', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ runtimeState: rs }));

		coordinator.requestPaintFrame();

		expect(rs.phase).toBe('idle');
	});

	it('returns to idle after a paint that throws', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					throw new Error('paint failure');
				},
				runtimeState: rs,
			})
		);

		expect(() => coordinator.requestPaintFrame()).toThrow('paint failure');
		expect(rs.phase).toBe('idle');
	});

	it('increments frameEpoch for every paint frame', () => {
		const rs = new RenderRuntimeState();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ runtimeState: rs }));

		expect(rs.frameEpoch).toBe(0);
		coordinator.requestPaintFrame();
		expect(rs.frameEpoch).toBe(1);
		coordinator.requestPaintFrame();
		expect(rs.frameEpoch).toBe(2);
	});

	it('isFrameActive() is true inside the paint callback', () => {
		const rs = new RenderRuntimeState();
		let frameActiveInsidePaint = false;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					frameActiveInsidePaint = rs.isFrameActive();
				},
				runtimeState: rs,
			})
		);

		coordinator.requestPaintFrame();

		expect(frameActiveInsidePaint).toBe(true);
	});

	it('canRunDecoration() is false inside the paint callback', () => {
		const rs = new RenderRuntimeState();
		let decorationAllowedInsidePaint = true;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					decorationAllowedInsidePaint = rs.canRunDecoration();
				},
				runtimeState: rs,
			})
		);

		coordinator.requestPaintFrame();

		expect(decorationAllowedInsidePaint).toBe(false);
	});

	it('flushNowForTests() also transitions through paint-frame', () => {
		const rs = new RenderRuntimeState();
		let phaseInsidePaint: string | null = null;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					phaseInsidePaint = rs.phase;
				},
				runtimeState: rs,
			})
		);

		coordinator.flushNowForTests();

		expect(phaseInsidePaint).toBe('paint-frame');
		expect(rs.phase).toBe('idle');
	});

	it('reports a fault and skips execution when paint is attempted after destruction', () => {
		const onFault = vi.fn();
		const rs = new RenderRuntimeState();
		const onPaintFrame = vi.fn();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPaintFrame, onFault, runtimeState: rs }));

		rs.transitionTo('destroyed');
		coordinator.flushNowForTests();

		expect(onFault).toHaveBeenCalledWith(expect.stringContaining('paint frame after destruction'));
		expect(onPaintFrame).not.toHaveBeenCalled();
	});
});

describe('DefaultFrameCoordinator – post-scroll durability (Plan 096)', () => {
	it('post-scroll work requested during an active paint frame runs after the paint completes', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		let rafCount = 0;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			microtask: (cb) => cb(),
			raf: (cb) => {
				rafCount++;
				capturedRaf = cb;
				return rafCount;
			},
		};
		let requestPostScrollDuringPaint: (() => void) | null = null;
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onPaintFrame: () => {
					// Request post-scroll work mid-paint — should survive
					requestPostScrollDuringPaint?.();
				},
				onPostScrollWork,
				gridScheduler: gs,
				runtimeState: rs,
			})
		);

		coordinator.requestPaintFrame(); // microtask → RAF registered
		requestPostScrollDuringPaint = () => coordinator.requestPostScrollWork();

		capturedRaf?.(); // paint frame fires; onPaintFrame calls requestPostScrollWork inside

		// After paint, post-scroll should have run (idle phase, conditions met)
		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
	});

	it('post-scroll work retained when scroll is still active, executed once scrolling becomes idle', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		const rafs: Array<() => void> = [];
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				rafs.push(cb);
				return rafs.length;
			},
		};
		// coordinator is captured by the onScrollFrame closure; by the time onScrollFrame
		// fires (inside rafs[0]), the assignment is complete.
		let coordinator!: DefaultFrameCoordinator;
		coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onScrollFrame: () => {
					// FrameCoordinator has already transitioned to scroll-frame before calling this.
					// Request post-scroll work — captures the current scroll epoch.
					coordinator.requestPostScrollWork();
					// FrameCoordinator transitions to post-scroll in its finally block after we return.
				},
				onPostScrollWork,
				gridScheduler: gs,
				runtimeState: rs,
				// Use 1 quiet frame so the test doesn't need to fire 3 extra RAFs.
				scrollEndQuietFrames: 1,
			})
		);

		// Simulate markScrolling(): scroll-pending increments epoch to 1.
		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();

		rafs[0]?.(); // scroll fires → FrameCoordinator: scroll-frame → onScrollFrame (captures epoch 1) → post-scroll
		// post-scroll retained (still scrolling — rs.phase === 'post-scroll')
		expect(onPostScrollWork).not.toHaveBeenCalled();
		// FrameCoordinator keeps RAF alive while isScrolling() — a new RAF was scheduled.
		expect(rafs.length).toBeGreaterThanOrEqual(2);

		// Fire the quiet frame: FrameCoordinator detects scroll-end, transitions to idle, then
		// post-scroll conditions are met → onPostScrollWork runs.
		rafs[rafs.length - 1]?.();
		expect(onPostScrollWork).toHaveBeenCalledTimes(1);
	});

	it('post-scroll work is dropped when a new scroll epoch supersedes it', () => {
		const rs = new RenderRuntimeState();
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, gridScheduler: gs, runtimeState: rs }));

		coordinator.requestPostScrollWork(); // epoch captured as 0

		// New scroll session starts: epoch advances
		rs.transitionTo('scroll-pending'); // epoch → 1

		capturedRaf?.(); // RAF fires with stale epoch
		expect(onPostScrollWork).not.toHaveBeenCalled();
	});

	// ── Plan 098: Render Runtime Convergence ──────────────────────────────────────

	it('[098] FrameCoordinator wraps onScrollFrame with scroll-frame/post-scroll phase transitions', () => {
		const rs = new RenderRuntimeState();
		const phases: string[] = [];
		const rafs: Array<() => void> = [];
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				rafs.push(cb);
				return rafs.length;
			},
		};
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onScrollFrame: () => {
					phases.push(rs.phase); // should be 'scroll-frame' inside callback
				},
				runtimeState: rs,
				gridScheduler: gs,
			})
		);

		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();
		rafs[0]?.(); // fire RAF manually

		expect(phases).toEqual(['scroll-frame']);
		// FrameCoordinator transitions to post-scroll in finally block after callback returns
		expect(rs.phase).toBe('post-scroll');
	});

	it('[098] onScrollFrame must not call transitionTo for scroll phases — FrameCoordinator owns them', () => {
		const rs = new RenderRuntimeState();
		let faultMsg = '';
		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				onScrollFrame: () => {
					// Intentionally trying to re-transition (simulates old coordinator code)
					// This is a double-transition into scroll-frame from scroll-frame — should fault.
					try {
						rs.transitionTo('scroll-frame');
					} catch {
						/* absorbed */
					}
				},
				runtimeState: rs,
				onFault: (msg) => {
					faultMsg = msg;
				},
			})
		);

		rs.transitionTo('scroll-pending');
		// Should not throw — but runtime state may fault internally
		expect(() => coordinator.requestScrollFrame()).not.toThrow();
		// FrameCoordinator itself should not fault (the fault originates from runtimeState, not coordinator)
		expect(faultMsg).toBe('');
	});

	it('[098] scroll-end detection fires onScrollEnd after N quiet frames', () => {
		const rs = new RenderRuntimeState();
		const onScrollEnd = vi.fn();
		const rafs: Array<() => void> = [];
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				rafs.push(cb);
				return rafs.length;
			},
		};

		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				gridScheduler: gs,
				runtimeState: rs,
				onScrollEnd,
				scrollEndQuietFrames: 2,
			})
		);

		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();

		// RAF 0: scroll frame fires, transitions to post-scroll
		rafs[0]?.();
		expect(onScrollEnd).not.toHaveBeenCalled();
		expect(rs.phase).toBe('post-scroll');

		// RAF 1: first quiet frame — count = 1, threshold = 2 — not yet
		rafs[1]?.();
		expect(onScrollEnd).not.toHaveBeenCalled();
		expect(rs.phase).toBe('post-scroll');

		// RAF 2: second quiet frame — count = 2 >= 2 → idle + onScrollEnd
		rafs[2]?.();
		expect(onScrollEnd).toHaveBeenCalledTimes(1);
		expect(rs.phase).toBe('idle');
	});

	it('[098] scroll-end quiet counter resets when a new scroll frame arrives mid-detection', () => {
		const rs = new RenderRuntimeState();
		const onScrollEnd = vi.fn();
		const rafs: Array<() => void> = [];
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				rafs.push(cb);
				return rafs.length;
			},
		};

		const coordinator = new DefaultFrameCoordinator(
			makeBaseDeps({
				gridScheduler: gs,
				runtimeState: rs,
				onScrollEnd,
				scrollEndQuietFrames: 2,
			})
		);

		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();

		// RAF 0: scroll frame → post-scroll
		rafs[0]?.();

		// RAF 1: first quiet frame — count = 1
		rafs[1]?.();
		expect(onScrollEnd).not.toHaveBeenCalled();

		// New scroll arrives before threshold is reached — reset counter
		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();
		rafs[2]?.(); // second scroll frame → resets quiet count to 0, transitions to post-scroll

		expect(onScrollEnd).not.toHaveBeenCalled();
		// Counter reset; two more quiet frames needed
		rafs[3]?.();
		expect(onScrollEnd).not.toHaveBeenCalled();
		rafs[4]?.();
		expect(onScrollEnd).toHaveBeenCalledTimes(1);
	});

	it('[098] RAF loop stays alive while isScrolling() even with no pending work', () => {
		const rs = new RenderRuntimeState();
		const rafCount = { n: 0 };
		const rafs: Array<() => void> = [];
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				rafCount.n++;
				rafs.push(cb);
				return rafCount.n;
			},
		};

		new DefaultFrameCoordinator(
			makeBaseDeps({
				gridScheduler: gs,
				runtimeState: rs,
				scrollEndQuietFrames: 3,
			})
		);

		// One scroll frame → transitions to post-scroll → RAF loop must keep going
		rs.transitionTo('scroll-pending');
		const rafsBefore = rafCount.n;
		// Manually schedule and fire
		rafs.push((() => {}) as () => void); // placeholder
		// Use a coordinator with captured state
		const coordinator2 = new DefaultFrameCoordinator(
			makeBaseDeps({
				gridScheduler: gs,
				runtimeState: rs,
				scrollEndQuietFrames: 3,
			})
		);
		coordinator2.requestScrollFrame();
		const afterRequest = rafCount.n;
		expect(afterRequest).toBeGreaterThan(rafsBefore); // at least one RAF scheduled

		rafs[rafs.length - 1]?.(); // fire scroll frame → post-scroll; keepAlive = true
		expect(rafCount.n).toBeGreaterThan(afterRequest); // additional RAF was scheduled
	});

	it('destroy() cancels pending post-scroll work before it executes', () => {
		const onPostScrollWork = vi.fn();
		let capturedRaf: (() => void) | null = null;
		const gs: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				capturedRaf = cb;
				return 0;
			},
			cancelRaf: vi.fn(),
		};
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ onPostScrollWork, gridScheduler: gs }));

		coordinator.requestPostScrollWork();
		coordinator.destroy(); // cancels the RAF

		// Even if someone manually fires the RAF, the guard prevents execution
		capturedRaf?.();
		expect(onPostScrollWork).not.toHaveBeenCalled();
	});
});

describe('DefaultFrameCoordinator – paint owed during an open scroll session', () => {
	function makeManualScheduler() {
		const frames: Array<() => void> = [];
		const scheduler: GridScheduler = {
			...makeSyncScheduler(),
			raf: (cb) => {
				frames.push(cb);
				return frames.length;
			},
		};
		const runFrame = () => frames.shift()?.();
		return { scheduler, runFrame };
	}

	it('runs the paint inside post-scroll without faulting or dropping the scroll session', () => {
		const faults: string[] = [];
		const rs = new RenderRuntimeState((msg) => faults.push(msg));
		const onScrollEnd = vi.fn();
		const onPaintFrame = vi.fn();
		const { scheduler, runFrame } = makeManualScheduler();
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ gridScheduler: scheduler, runtimeState: rs, onPaintFrame, onScrollEnd }));

		rs.transitionTo('scroll-pending');
		coordinator.requestScrollFrame();
		coordinator.requestPaintFrame();
		runFrame(); // scroll frame -> post-scroll, then the owed paint

		expect(onPaintFrame).toHaveBeenCalledTimes(1);
		expect(rs.phase).toBe('post-scroll');
		expect(faults).toEqual([]);

		for (let i = 0; i < 5 && rs.isScrolling(); i++) runFrame();
		expect(rs.phase).toBe('idle');
		expect(onScrollEnd).toHaveBeenCalledTimes(1);
		expect(faults).toEqual([]);
	});

	it('opens a scroll session for a scroll frame owed while idle instead of faulting', () => {
		const faults: string[] = [];
		const rs = new RenderRuntimeState((msg) => faults.push(msg));
		const coordinator = new DefaultFrameCoordinator(makeBaseDeps({ runtimeState: rs }));

		coordinator.requestScrollFrame();

		expect(faults).toEqual([]);
		expect(rs.isScrolling() || rs.phase === 'idle').toBe(true);
	});
});
