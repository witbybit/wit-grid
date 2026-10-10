/**
 * How rows animate when a discrete change moves them: a sort, a live value change under the
 * current sort, a group or tree expanding or collapsing, a detail row opening or closing. Scrolling
 * never animates. Animations run on the compositor (Web Animations API, transform and opacity
 * only), so a style costs nothing per frame; users who prefer reduced motion get no animation.
 */
export interface RowAnimationOptions {
	/**
	 * `'slide'` (default): rows glide from their old place to the new one.
	 * `'fade'`: rows that moved fade in at their new place.
	 * `'none'`: changes apply instantly.
	 */
	style?: 'slide' | 'fade' | 'none';
	/** Milliseconds per row. Default 280. */
	duration?: number;
	/**
	 * `'smooth'` (default), `'snappy'` (quick start, soft stop), `'spring'` (settles with a small
	 * overshoot), or any CSS easing, e.g. `'ease-out'` or `'cubic-bezier(0.2, 0, 0, 1)'`.
	 */
	easing?: 'smooth' | 'snappy' | 'spring' | (string & {});
	/**
	 * Delay in milliseconds between rows, top to bottom, so they cascade into place. Default 0
	 * (all together). The cascade is capped so a large change still finishes quickly.
	 */
	stagger?: number;
	/** Which changes animate. Default: all of them. */
	on?: { sort?: boolean; liveReorder?: boolean; expand?: boolean; detail?: boolean };
}

export interface ResolvedRowAnimation {
	style: 'slide' | 'fade' | 'none';
	duration: number;
	easing: string;
	stagger: number;
	on: { sort: boolean; liveReorder: boolean; expand: boolean; detail: boolean };
}

/** The whole cascade (first to last row's start) never exceeds this, whatever the stagger. */
export const MAX_STAGGER_SPAN_MS = 240;

const EASING_PRESETS: Record<string, string> = {
	smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
	snappy: 'cubic-bezier(0.2, 0, 0, 1)',
	// A damped spring (damping ratio 0.7) sampled into a linear() curve: overshoots ~4% and settles.
	spring: 'linear(0, 0.072, 0.233, 0.424, 0.605, 0.758, 0.875, 0.956, 1.008, 1.035, 1.046, 1.046, 1.041, 1.032, 1.023, 1.016, 1.01, 1.005, 1.002, 1, 0.999, 0.999, 0.999, 1, 1)',
};

/** CSS linear() easing is newer than the rest; browsers without it get the snappy curve. */
function supportsLinearEasing(): boolean {
	try {
		return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timing-function', 'linear(0, 1)');
	} catch {
		return false;
	}
}

export function resolveRowAnimation(options: RowAnimationOptions | undefined): ResolvedRowAnimation {
	const easingName = options?.easing ?? 'smooth';
	let easing = EASING_PRESETS[easingName] ?? easingName;
	if (easingName === 'spring' && !supportsLinearEasing()) easing = EASING_PRESETS.snappy;
	return {
		style: options?.style ?? 'slide',
		duration: Math.max(0, options?.duration ?? 280),
		easing,
		stagger: Math.max(0, options?.stagger ?? 0),
		on: {
			sort: options?.on?.sort ?? true,
			liveReorder: options?.on?.liveReorder ?? true,
			expand: options?.on?.expand ?? true,
			detail: options?.on?.detail ?? true,
		},
	};
}

/**
 * Motion can play: the Web Animations API exists (not jsdom / SSR) and the user has not asked for
 * reduced motion. The one check every animated surface uses (table rows, workspace views).
 */
export function animationsEnabled(): boolean {
	if (typeof document === 'undefined') return false;
	if (typeof (HTMLElement.prototype as { animate?: unknown }).animate !== 'function') return false;
	try {
		if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
			if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
		}
	} catch {
		/* matchMedia may throw in some test envs — treat as no preference */
	}
	return true;
}
