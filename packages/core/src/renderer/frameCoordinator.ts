import { type GridScheduler, defaultGridScheduler } from './gridScheduler.js';
import type { RenderRuntimeState } from './renderRuntimeState.js';

/**
 * Single entry point for all renderer frame scheduling.
 *
 * Consumers request work through one of three methods; the coordinator
 * routes all work through a single pending-bit arbiter that fires one RAF
 * per pending frame and flushes in documented priority order:
 *   scroll → paint → post-scroll
 *
 * Every request sets a pending bit; scheduleFrame() registers a RAF only if
 * none is already registered. Requests made during a flush callback are
 * deferred to the next RAF automatically.
 *
 * post-scroll work captures the scroll epoch at scheduling time and silently
 * no-ops if a new scroll session has begun.
 *
 * Scroll-end detection: after requestScrollFrame() stops arriving, the
 * coordinator counts quiet frames internally. Scroll ends once at least
 * scrollEndQuietFrames consecutive RAF callbacks had no new scroll request AND
 * (when scrollEndQuietMs is set) that much wall-clock time has passed since the
 * last request — a pure frame count ends a gesture after ~12ms at 240Hz, which
 * is mid-gesture. The runtime then transitions to idle and onScrollEnd() fires.
 * A native `scrollend` (notifyScrollEnd) short-circuits the wait. This
 * eliminates any secondary RAF loop outside the coordinator.
 *
 * Phase transitions: the coordinator owns scroll-frame and post-scroll
 * transitions around the onScrollFrame callback. Callbacks must not call
 * transitionTo() themselves for those phases.
 */
export interface FrameCoordinator {
	/** Schedule a scroll frame (RAF-only). */
	requestScrollFrame(): void;
	/** Schedule a paint frame (microtask → RAF, coalescing synchronous invalidation). */
	requestPaintFrame(changeIds?: readonly number[]): void;
	/** Schedule post-scroll work (distinct from paint, epoch-validated). */
	requestPostScrollWork(changeIds?: readonly number[]): void;
	/** Synchronous flush — test-only / documented transactional boundaries. */
	flushNowForTests(): void;
	/** Current coordinator ownership only; cumulative render counters live elsewhere. */
	getOwnershipSnapshot(): Readonly<{
		pendingScroll: boolean;
		pendingPaint: boolean;
		pendingPostScroll: boolean;
		ownsAnimationFrame: boolean;
		inFrame: boolean;
		destroyed: boolean;
	}>;
	destroy(): void;
}

export interface FrameCoordinatorDeps {
	onScrollFrame: () => void;
	onPaintFrame: (changeIds: readonly number[]) => void;
	/** Distinct callback for post-scroll deferred work. Must not alias onPaintFrame. */
	onPostScrollWork: (changeIds: readonly number[]) => void;
	/**
	 * Called when scroll ends — after scrollEndQuietFrames consecutive RAF callbacks
	 * with no new scroll request. The runtime has already transitioned to idle before
	 * this fires. Use it to flush deferred post-scroll work (portals, decoration, etc.).
	 */
	onScrollEnd?: () => void;
	gridScheduler?: GridScheduler;
	/** Called when a reentrancy or lifecycle violation is detected. Should not throw. */
	onFault?: (msg: string) => void;
	/** Authoritative render lifecycle state. When provided, every paint frame is wrapped in paint-frame phase transitions,
	 *  and scroll frames are wrapped in scroll-frame/post-scroll transitions. */
	runtimeState?: RenderRuntimeState;
	/**
	 * Number of consecutive RAF callbacks without a new scroll request before scroll-end
	 * is declared. Defaults to 3. Lower values detect scroll-end faster; higher values
	 * add a buffer against momentary gaps between scroll events.
	 */
	scrollEndQuietFrames?: number;
	/**
	 * Minimum wall-clock quiet time (ms since the last requestScrollFrame) before scroll-end is
	 * declared, in addition to scrollEndQuietFrames. Defaults to 0 (frame count only). Ignored
	 * for synchronously-firing test schedulers, where no time can pass between frames.
	 */
	scrollEndQuietMs?: number;
	/** Clock for scrollEndQuietMs. Defaults to performance.now(). */
	now?: () => number;
}

/** Upper bound on quiet frames before scroll-end when scrollEndQuietMs is in use. */
const SCROLL_END_MAX_QUIET_FRAMES = 48;

export class DefaultFrameCoordinator implements FrameCoordinator {
	private pendingScroll = false;
	private pendingPaint = false;
	private readonly pendingPaintChangeIds = new Set<number>();
	private pendingPostScroll = false;
	private readonly pendingPostScrollChangeIds = new Set<number>();
	private inFrame = false;
	private destroyed = false;
	private rafId: number | null = null;
	private postScrollEpoch = 0;
	private scrollEndQuietCount = 0;
	private readonly scrollEndQuietThreshold: number;
	private readonly scrollEndQuietMs: number;
	private readonly now: () => number;
	private lastScrollRequestAt = 0;
	/** Native scrollend arrived while a scroll frame was still owed; end right after it. */
	private scrollEndRequested = false;
	/** >0 while inside gs.raf(); a frame firing then comes from a synchronous scheduler. */
	private rafScheduleDepth = 0;
	private readonly gs: GridScheduler;
	private readonly onScrollFrame: () => void;
	private readonly onPaintFrame: (changeIds: readonly number[]) => void;
	private readonly onPostScrollWork: (changeIds: readonly number[]) => void;
	private readonly onScrollEnd: (() => void) | undefined;
	private readonly onFault: ((msg: string) => void) | undefined;
	private readonly runtimeState: RenderRuntimeState | undefined;

	constructor(deps: FrameCoordinatorDeps) {
		this.gs = deps.gridScheduler ?? defaultGridScheduler;
		this.onScrollFrame = deps.onScrollFrame;
		this.onPaintFrame = deps.onPaintFrame;
		this.onPostScrollWork = deps.onPostScrollWork;
		this.onScrollEnd = deps.onScrollEnd;
		this.onFault = deps.onFault;
		this.runtimeState = deps.runtimeState;
		this.scrollEndQuietThreshold = deps.scrollEndQuietFrames ?? 3;
		this.scrollEndQuietMs = deps.scrollEndQuietMs ?? 0;
		this.now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
	}

	requestScrollFrame(): void {
		if (this.destroyed) return;
		// Movement after a native scrollend belongs to a new gesture.
		this.scrollEndRequested = false;
		if (this.scrollEndQuietMs > 0) this.lastScrollRequestAt = this.now();
		if (this.pendingScroll) return;
		this.pendingScroll = true;
		this.scheduleFrame();
	}

	/**
	 * Native `scrollend`: the browser has settled the gesture, so end the scroll now instead of
	 * waiting out the quiet-frame fallback. If the final scroll frame is still owed (or a frame is
	 * running), scroll-end runs right after that frame instead.
	 */
	notifyScrollEnd(): void {
		if (this.destroyed || !this.runtimeState?.isScrolling()) return;
		if (this.pendingScroll || this.inFrame) {
			this.scrollEndRequested = true;
			this.scheduleFrame();
			return;
		}
		this.endScroll();
	}

	private endScroll(): void {
		this.scrollEndQuietCount = 0;
		this.scrollEndRequested = false;
		// Runtime transitions to idle before notifying the scroll-end handler.
		this.runtimeState?.transitionTo('idle');
		this.onScrollEnd?.();
	}

	private isScrollQuiet(syncFrame: boolean): boolean {
		if (this.scrollEndQuietCount < this.scrollEndQuietThreshold) return false;
		if (this.scrollEndQuietMs <= 0 || syncFrame) return true;
		// The frame cap bounds the wait when the clock does not advance between frames (frozen or
		// fake timers, frames drained back-to-back); on real displays the time window ends first
		// (48 frames is 200ms at 240Hz).
		if (this.scrollEndQuietCount >= SCROLL_END_MAX_QUIET_FRAMES) return true;
		return this.now() - this.lastScrollRequestAt >= this.scrollEndQuietMs;
	}

	requestPaintFrame(changeIds: readonly number[] = []): void {
		if (this.destroyed) return;
		for (const changeId of changeIds) this.pendingPaintChangeIds.add(changeId);
		if (this.pendingPaint) return;
		this.pendingPaint = true;
		this.gs.microtask(() => {
			if (!this.destroyed) this.scheduleFrame();
		});
	}

	requestPostScrollWork(changeIds: readonly number[] = []): void {
		if (this.destroyed) return;
		for (const changeId of changeIds) this.pendingPostScrollChangeIds.add(changeId);
		if (this.pendingPostScroll) return;
		this.pendingPostScroll = true;
		this.postScrollEpoch = this.runtimeState?.scrollEpoch ?? 0;
		this.scheduleFrame();
	}

	private scheduleFrame(): void {
		if (this.rafId !== null) return;
		// Set a non-null sentinel before calling gs.raf() so that
		// synchronously-firing test schedulers don't re-enter scheduleFrame
		// while the callback is running.  The real id overwrites it after
		// the call — unless the callback already fired and cleared it to null.
		this.rafId = -1;
		this.rafScheduleDepth++;
		let id: number;
		try {
			id = this.gs.raf(() => this.flushFrame());
		} finally {
			this.rafScheduleDepth--;
		}
		if (this.rafId === -1) this.rafId = id;
	}

	private flushFrame(): void {
		const syncFrame = this.rafScheduleDepth > 0;
		this.rafId = null;
		if (this.inFrame) {
			this.onFault?.('FrameCoordinator: reentrant frame detected');
			return;
		}
		this.inFrame = true;
		try {
			if (this.pendingScroll) {
				this.pendingScroll = false;
				// Reset quiet-frame counter: a new scroll frame means scrolling is still active.
				this.scrollEndQuietCount = 0;
				const rs = this.runtimeState;
				// Runtime owns scroll-frame phase transition. The onScrollFrame callback
				// must not call transitionTo('scroll-frame') or transitionTo('post-scroll').
				if (rs && !rs.isDestroyed()) {
					// A scroll frame owed while idle (a request that skipped markScrolling) opens a scroll
					// session first; idle -> scroll-frame is not a legal transition.
					if (rs.phase === 'idle') rs.transitionTo('scroll-pending');
					rs.transitionTo('scroll-frame');
				}
				try {
					this.onScrollFrame();
				} finally {
					if (rs && !rs.isDestroyed()) {
						rs.transitionTo('post-scroll');
					}
				}
				if (this.scrollEndRequested && rs && !rs.isDestroyed() && rs.isScrolling()) {
					this.endScroll();
				}
			} else if (this.runtimeState?.isScrolling()) {
				// No new scroll frame arrived — count quiet frames for scroll-end detection.
				// This path fires while the runtime is still in post-scroll (or scroll-pending)
				// after the last visible scroll frame.
				this.scrollEndQuietCount++;
				if (this.scrollEndRequested || this.isScrollQuiet(syncFrame)) {
					this.endScroll();
				}
			}
			if (this.pendingPaint) {
				this.pendingPaint = false;
				this.runPaintFrame();
			}
			if (this.pendingPostScroll) {
				const rs = this.runtimeState;
				const epochOk = !rs || rs.isScrollEpochCurrent(this.postScrollEpoch);
				if (!epochOk) {
					// Stale epoch: a newer scroll session supersedes this request — drop.
					this.pendingPostScroll = false;
					this.pendingPostScrollChangeIds.clear();
				} else {
					const notActive = !rs || (!rs.isScrolling() && !rs.isFrameActive());
					if (notActive) {
						this.pendingPostScroll = false;
						const changeIds = Object.freeze([...this.pendingPostScrollChangeIds]);
						this.pendingPostScrollChangeIds.clear();
						this.onPostScrollWork(changeIds);
					}
					// else: conditions not yet met but epoch is valid (scrolling still active).
					// Retain pendingPostScroll = true so the finally block re-schedules a RAF.
					// The work will execute once scrolling becomes idle.
				}
			}
		} finally {
			this.inFrame = false;
			// Keep the RAF loop alive while scrolling (for scroll-end detection)
			// or while there is pending work to flush.
			const keepAlive = this.pendingScroll || this.pendingPaint || this.pendingPostScroll || (this.runtimeState?.isScrolling() ?? false);
			if (keepAlive) {
				this.scheduleFrame();
			}
		}
	}

	flushNowForTests(): void {
		if (this.destroyed) return;
		this.pendingPaint = false;
		this.runPaintFrame();
	}

	public getOwnershipSnapshot(): Readonly<{
		pendingScroll: boolean;
		pendingPaint: boolean;
		pendingPostScroll: boolean;
		ownsAnimationFrame: boolean;
		inFrame: boolean;
		destroyed: boolean;
	}> {
		return Object.freeze({
			pendingScroll: this.pendingScroll,
			pendingPaint: this.pendingPaint,
			pendingPostScroll: this.pendingPostScroll,
			ownsAnimationFrame: this.rafId !== null,
			inFrame: this.inFrame,
			destroyed: this.destroyed,
		});
	}

	private runPaintFrame(): void {
		const changeIds = Object.freeze([...this.pendingPaintChangeIds]);
		this.pendingPaintChangeIds.clear();
		const rs = this.runtimeState;
		if (rs?.isDestroyed()) {
			this.onFault?.('FrameCoordinator: paint frame after destruction');
			return;
		}
		// A paint can be owed while a scroll session is open (scroll-pending / post-scroll). It runs
		// inside that session instead of taking a paint-frame phase: entering paint-frame is illegal
		// there, and returning to idle afterwards would silently drop the scroll session, so its
		// scroll-end work (deferred portal mounts, the scrolling class) would never run.
		const ownsPhase = !rs || rs.phase === 'idle';
		if (rs && ownsPhase) rs.transitionTo('paint-frame');
		try {
			this.onPaintFrame(changeIds);
		} finally {
			if (rs && ownsPhase && !rs.isDestroyed()) {
				rs.transitionTo('idle');
			}
		}
	}

	destroy(): void {
		this.destroyed = true;
		if (this.rafId !== null) {
			this.gs.cancelRaf(this.rafId);
			this.rafId = null;
		}
		this.pendingScroll = false;
		this.pendingPaint = false;
		this.pendingPaintChangeIds.clear();
		this.pendingPostScroll = false;
		this.pendingPostScrollChangeIds.clear();
		this.scrollEndQuietCount = 0;
		this.scrollEndRequested = false;
	}
}
