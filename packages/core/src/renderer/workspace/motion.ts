import { defaultGridScheduler } from '../gridScheduler.js';
import { animationsEnabled, resolveRowAnimation, type ResolvedRowAnimation, type RowAnimationOptions } from '../rowAnimation.js';

/**
 * Workspace motion: cards, bars and entries gliding to new places, appearing, leaving, and views
 * sliding in. Not a second motion system: whether anything moves, for how long and on which curve
 * comes from the grid's own row-animation options (`api.setRowAnimation`, the same policy the
 * table's LayoutTransitionController follows) and its one capability check (WAAPI, reduced motion).
 * What differs is geometry: views place records in two dimensions, outside the table's row slots.
 * Only transform and opacity animate (compositor-only); scroll paints never animate.
 */
export class RecordMotion {
	private policy: ResolvedRowAnimation = resolveRowAnimation(undefined);
	private readonly positions = new WeakMap<HTMLElement, { x: number; y: number }>();

	constructor(private readonly getOptions: () => RowAnimationOptions | undefined) {}

	/** Re-reads the grid's policy (once per render, not per element). */
	refresh(): void {
		this.policy = resolveRowAnimation(this.getOptions());
	}

	/** Motion plays: allowed by the browser and the user, and not turned off for the grid. */
	get enabled(): boolean {
		return this.policy.style !== 'none' && this.policy.duration > 0 && animationsEnabled();
	}

	private play(element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions = {}): Animation | null {
		if (!this.enabled || typeof (element as HTMLElement).animate !== 'function') return null;
		try {
			return (element as HTMLElement).animate(keyframes, { duration: this.policy.duration, easing: this.policy.easing, ...options });
		} catch {
			return null;
		}
	}

	/**
	 * Places an element at (x, y) through `transform`. With `glide`, a record that had a place moves
	 * from there (FLIP without measuring: the old place is remembered); under the `fade` style it
	 * fades in at the new place instead. Scroll paints pass `glide: false`.
	 */
	place(element: HTMLElement, x: number, y: number, glide: boolean): void {
		const previous = this.positions.get(element);
		element.style.transform = `translate(${x}px, ${y}px)`;
		this.positions.set(element, { x, y });
		if (!glide || !previous || (previous.x === x && previous.y === y)) return;
		// Far jumps (filtered back in across the board) and the fade style settle in place.
		if (this.policy.style === 'fade' || Math.hypot(previous.x - x, previous.y - y) > 1600) {
			this.enter(element);
			return;
		}
		this.play(element, [{ transform: `translate(${previous.x}px, ${previous.y}px)` }, { transform: `translate(${x}px, ${y}px)` }]);
	}

	/** The element now shows another record (recycled): it has no previous place. */
	forget(element: HTMLElement): void {
		this.positions.delete(element);
	}

	/** A record appearing: fades and settles in, keeping the element's own transform. */
	enter(element: HTMLElement, delay = 0): void {
		const base = element.style.transform || '';
		this.play(
			element,
			[
				{ opacity: 0, transform: `${base} translateY(6px) scale(.98)` },
				{ opacity: 1, transform: base || 'none' },
			],
			{ delay: Math.min(delay, 240), fill: 'backwards' }
		);
	}

	/** A record leaving: fades out where it stands, then goes. */
	leave(element: HTMLElement): void {
		element.style.pointerEvents = 'none';
		const base = element.style.transform || '';
		const animation = this.play(element, [{ opacity: 1 }, { opacity: 0, transform: `${base} scale(.96)` }], {
			duration: Math.min(200, this.policy.duration),
			easing: 'ease-in',
		});
		if (!animation) element.remove();
		else animation.onfinish = () => element.remove();
	}

	/** A view, month or panel arriving from a side (-1 left, 1 right, 0 in place). */
	slideIn(element: HTMLElement, direction: -1 | 0 | 1, distance = 24): void {
		this.play(element, [
			{ opacity: 0, transform: `translateX(${direction * distance}px)` },
			{ opacity: 1, transform: 'none' },
		]);
	}

	/** A highlight ring on a record that just changed or landed. */
	flash(element: HTMLElement): void {
		this.play(
			element,
			[{ boxShadow: '0 0 0 3px color-mix(in srgb, var(--og-focus-ring) 65%, transparent)' }, { boxShadow: '0 0 0 0 transparent' }],
			{ duration: 700 }
		);
	}

	/** A number counting to its new value (metrics, totals). */
	tween(element: HTMLElement, from: number, to: number, format: (value: number) => string): void {
		if (from === to || !this.enabled || typeof performance === 'undefined') {
			element.textContent = format(to);
			return;
		}
		const start = performance.now();
		const duration = Math.max(300, this.policy.duration * 1.5);
		const step = () => {
			const t = Math.min(1, (performance.now() - start) / duration);
			element.textContent = format(from + (to - from) * (1 - Math.pow(1 - t, 3)));
			if (t < 1 && element.isConnected) defaultGridScheduler.raf(step);
		};
		defaultGridScheduler.raf(step);
	}
}
