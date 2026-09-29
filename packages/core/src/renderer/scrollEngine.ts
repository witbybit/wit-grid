import type { GridEngine } from '../engine/GridEngine.js';

/**
 * ScrollEngine coordinates passive scroll events from the DOM scroll viewport,
 * tracks scrolling velocity, and maps natural scroll positions to virtual coordinate offsets.
 *
 * Performance guarantees:
 * - Event listeners bound passively to prevent main-thread scrolling jank
 * - High-resolution timing used for velocity calculations
 * - Zero allocations on scroll event hot path
 */
export class ScrollEngine<TRowData = unknown> {
	private engine: GridEngine<TRowData>;
	private scrollContainer: HTMLElement | null = null;
	private onScrollCallback: ((scrollTop: number, scrollLeft: number, timestamp?: number) => void) | null = null;
	private onScrollEndCallback: (() => void) | null = null;

	private scrollEndTimer: any = null;
	// Feature-detected once in bind() — the per-event `in` checks showed up in profiles.
	private supportsScrollEnd = false;

	// High-resolution velocity tracking state
	private lastScrollTop = 0;
	private lastScrollLeft = 0;
	private lastTimestamp = 0;
	private velocityY = 0; // px/ms
	private velocityX = 0; // px/ms

	constructor(engine: GridEngine<TRowData>) {
		this.engine = engine;
	}

	/**
	 * Bind the scroll engine to the scrollable viewport container. `onScrollEnd` fires on the
	 * browser's native `scrollend` only; without native support the frame coordinator's
	 * time-based quiet detection ends the scroll instead.
	 */
	public bind(
		scrollContainer: HTMLElement,
		onScroll: (scrollTop: number, scrollLeft: number, timestamp?: number) => void,
		onScrollEnd?: () => void
	): void {
		this.unbind();
		this.scrollContainer = scrollContainer;
		this.onScrollCallback = onScroll;
		this.onScrollEndCallback = onScrollEnd ?? null;

		this.lastScrollTop = scrollContainer.scrollTop;
		this.lastScrollLeft = scrollContainer.scrollLeft;
		this.lastTimestamp = performance.now();
		this.velocityY = 0;
		this.velocityX = 0;

		// Standard passive listener to avoid blocking main thread compositor scrolls
		scrollContainer.addEventListener('scroll', this.handleScroll, { passive: true });

		// Bind native scrollend event if supported by the browser
		this.supportsScrollEnd = typeof window !== 'undefined' && ('onscrollend' in window || 'onscrollend' in HTMLElement.prototype);
		if (this.supportsScrollEnd) {
			scrollContainer.addEventListener('scrollend', this.handleNativeScrollEnd);
		}
	}

	/**
	 * Unbind event listeners and release references.
	 */
	public unbind(): void {
		if (this.scrollEndTimer) {
			clearTimeout(this.scrollEndTimer);
			this.scrollEndTimer = null;
		}
		if (this.scrollContainer) {
			this.scrollContainer.removeEventListener('scroll', this.handleScroll);
			this.scrollContainer.removeEventListener('scrollend', this.handleNativeScrollEnd);
			this.scrollContainer = null;
		}
		this.onScrollCallback = null;
		this.onScrollEndCallback = null;
	}

	/**
	 * Active scroll handler - runs inside browser compositor lane, keeps allocations strictly at zero.
	 */
	private handleScroll = (): void => {
		if (!this.scrollContainer || !this.onScrollCallback) return;

		const scrollTop = this.scrollContainer.scrollTop;
		const scrollLeft = this.scrollContainer.scrollLeft;
		const now = performance.now();
		const timeDelta = now - this.lastTimestamp;

		if (timeDelta > 0) {
			this.velocityY = (scrollTop - this.lastScrollTop) / timeDelta;
			this.velocityX = (scrollLeft - this.lastScrollLeft) / timeDelta;
		} else {
			this.velocityY = 0;
			this.velocityX = 0;
		}

		this.lastScrollTop = scrollTop;
		this.lastScrollLeft = scrollLeft;
		this.lastTimestamp = now;

		// Velocity settle for browsers without native 'scrollend'. Scroll-end itself is detected by
		// the frame coordinator's time-based quiet window, not by this timer.
		if (!this.supportsScrollEnd) {
			if (this.scrollEndTimer) {
				clearTimeout(this.scrollEndTimer);
			}
			this.scrollEndTimer = setTimeout(this.handleScrollEnd, 50);
		}

		// Delegate callback (which will update ViewportModel and trigger transforms).
		// `now` is passed through so ViewportModel reuses this timestamp instead of
		// calling performance.now() and recomputing velocity a second time.
		this.onScrollCallback(scrollTop, scrollLeft, now);
	};

	/**
	 * Unified handler to cleanly reset velocity to rest (0) and flush the final static cell state.
	 */
	private handleScrollEnd = (): void => {
		if (this.scrollEndTimer) {
			clearTimeout(this.scrollEndTimer);
			this.scrollEndTimer = null;
		}
		this.velocityY = 0;
		this.velocityX = 0;
		this.engine.viewport.resetVelocity();

		if (this.onScrollCallback && this.scrollContainer) {
			this.onScrollCallback(this.scrollContainer.scrollTop, this.scrollContainer.scrollLeft);
		}
	};

	/**
	 * Native `scrollend`. Routing it through onScroll alone was a no-op — the position is
	 * unchanged, so the viewport bails before anything reacts — which left scroll-end to the
	 * quiet-frame fallback. Signal scroll-end explicitly after the settle bookkeeping.
	 */
	private handleNativeScrollEnd = (): void => {
		// Sync the final position, then let the frame coordinator confirm the end. Velocity is reset
		// only once it does (settleVelocity): a programmatic scroll fires scrollend while still moving.
		if (this.onScrollCallback && this.scrollContainer) {
			this.onScrollCallback(this.scrollContainer.scrollTop, this.scrollContainer.scrollLeft);
		}
		this.onScrollEndCallback?.();
	};

	/** The scroll session has ended: velocity, and the adaptive overscan it drives, return to rest. */
	public settleVelocity(): void {
		this.velocityY = 0;
		this.velocityX = 0;
		this.engine.viewport.resetVelocity();
	}

	/**
	 * Retrieve calculated real-time scroll velocity.
	 */
	public getVelocity(): { vx: number; vy: number } {
		return { vx: this.velocityX, vy: this.velocityY };
	}

	/**
	 * Programmatically update scroll offsets.
	 */
	public scrollTo(scrollTop: number, scrollLeft: number): void {
		if (this.scrollContainer) {
			this.scrollContainer.scrollTop = scrollTop;
			this.scrollContainer.scrollLeft = scrollLeft;

			// Sync tracking immediately to prevent jump-back on subsequent scroll events
			this.lastScrollTop = scrollTop;
			this.lastScrollLeft = scrollLeft;
			this.lastTimestamp = performance.now();
			this.velocityY = 0;
			this.velocityX = 0;
		}
	}
}
