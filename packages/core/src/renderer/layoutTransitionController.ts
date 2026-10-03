import { MAX_STAGGER_SPAN_MS, resolveRowAnimation, type ResolvedRowAnimation, type RowAnimationOptions } from './rowAnimation.js';
import type { RowSlot } from './rowSlot.js';

/**
 * LayoutTransitionController — animates **discrete** layout changes via the
 * Web Animations API (WAAPI). It generalizes the former DOM-snapshot FLIP sort animator
 * into one controller for every animated structural delta: row reorder (sort), row
 * **enter** (expand reveal), and — once the slot exit pool lands — row **exit** (collapse).
 *
 * Why WAAPI instead of inline CSS transitions:
 *  - No forced reflow: `element.animate()` does its own from→to interpolation, so the
 *    old FLIP "set inverse transform, read getBoundingClientRect(), set final" dance is
 *    gone. We keyframe from the captured old transform to the live (already-written)
 *    final transform.
 *  - Per-element handles: every running animation is an `Animation` we can `cancel()`
 *    individually and instantly, which is exactly what the scroll-start path needs.
 *  - Composes with steady-state positioning: rows are positioned by an inline
 *    `transform: translateY(lastTop)`. With `fill: 'none'` the element reverts to that
 *    inline transform when the animation ends — which is the final position — so no
 *    commit step and no stale animation state is left behind.
 *
 * Hot-path guarantee: this controller is ONLY driven from discrete-change hooks
 * (`captureSnapshot` on sort/expansion/etc., `beginAnimation` after the resulting paint).
 * Scroll frames and data-tick frames never call it, and `cancel()` (invoked on scroll
 * start) tears down every live animation. No transition/animation property is ever set
 * on a scroll frame. Feature-detected: where WAAPI is unavailable (jsdom/SSR) or the
 * user prefers reduced motion, changes apply instantly (no animation).
 */
export interface LayoutTransitionOptions {
	/** The `.og-layer-exiting` overlay that holds fade-out ghosts. */
	getExitLayer?: () => HTMLElement | null;
	/** True when a rowId still exists in the visual model — used to tell a true exit
	 *  (row removed, e.g. collapsed) from a row that merely scrolled out of the window. */
	isRowIdLive?: (rowId: string) => boolean;
	/** The grid root element used for semantic, CSS-only layout effects such as pinning. */
	getGridRoot?: () => HTMLElement | null;
	/** The grid's current row animation options (style, timing, cascade, which changes animate). */
	getRowAnimation?: () => RowAnimationOptions | undefined;
}

interface PendingRowAnimation {
	el: HTMLElement;
	keyframes: Keyframe[];
	/** New top: the cascade runs top to bottom. */
	top: number;
	onSettle?: () => void;
}

interface SnapshotEntry {
	top: number;
	/** Row height at capture — used to height-shrink an exiting detail row's ghost. */
	height: number;
	/** Row kind at capture — detail rows get a height grow/shrink instead of a plain fade. */
	kind: string;
	/** Deep clone of the row element at capture, used as a fade-out ghost if it exits. */
	clone: HTMLElement;
}

export type LayoutTransitionReason = 'sort' | 'expansion' | 'detail' | 'live-reorder' | 'other';

interface SnapshotBounds {
	top: number;
	bottom: number;
}

export class LayoutTransitionController<TRowData = unknown> {
	private snapshot = new Map<string, SnapshotEntry>(); // rowId → {top, clone} at capture
	private snapshotReason: LayoutTransitionReason = 'other';
	private snapshotBounds: SnapshotBounds | null = null;
	private animations = new Map<HTMLElement, Animation>();
	private exitGhosts = new Set<HTMLElement>();
	/** Options resolved for the animation being played (read once per beginAnimation). */
	private current: ResolvedRowAnimation = resolveRowAnimation(undefined);
	private readonly pending: PendingRowAnimation[] = [];
	constructor(
		private readonly getActiveRows: () => ReadonlyMap<number, RowSlot<TRowData>>,
		private readonly options: LayoutTransitionOptions = {}
	) {}

	/** True when WAAPI is usable and the user has not requested reduced motion. */
	private animationsEnabled(): boolean {
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

	/** True when this kind of change animates under the grid's row animation options. */
	private animatesReason(reason: LayoutTransitionReason, options: ResolvedRowAnimation): boolean {
		if (options.style === 'none' || options.duration === 0) return false;
		if (reason === 'sort') return options.on.sort;
		if (reason === 'live-reorder') return options.on.liveReorder;
		if (reason === 'expansion') return options.on.expand;
		if (reason === 'detail') return options.on.detail;
		return true;
	}

	/**
	 * Step 1 — record current row positions before the structural state change renders.
	 * Called synchronously from the invalidation hook (sortModel/expansion/etc.).
	 */
	public captureSnapshot(reason: LayoutTransitionReason = 'other'): void {
		this.cancel(); // snap any in-flight animation + clear ghosts so the snapshot is clean
		this.snapshot.clear();
		this.snapshotReason = reason;
		this.snapshotBounds = null;
		// A change that will not animate needs no snapshot (and no ghost clones).
		if (!this.animatesReason(reason, resolveRowAnimation(this.options.getRowAnimation?.()))) return;
		const canExit = reason !== 'live-reorder' && !!this.options.getExitLayer && this.animationsEnabled();
		for (const [, slot] of this.getActiveRows()) {
			if (slot.visualRowId && slot.lastTop >= 0) {
				// Clone now (before recycleViewport reuses the element) so a row that turns out
				// to have left the model can fade out as a static ghost. Cheap + off the hot
				// path (capture only runs on discrete actions). Skipped when exits can't render.
				const clone = canExit ? (slot.element.cloneNode(true) as HTMLElement) : (null as unknown as HTMLElement);
				this.snapshot.set(slot.visualRowId, { top: slot.lastTop, height: slot.lastHeight, kind: slot.rowKind, clone });
				const bottom = slot.lastTop + slot.lastHeight;
				this.snapshotBounds =
					this.snapshotBounds === null
						? { top: slot.lastTop, bottom }
						: { top: Math.min(this.snapshotBounds.top, slot.lastTop), bottom: Math.max(this.snapshotBounds.bottom, bottom) };
			}
		}
	}

	/**
	 * Step 2 — after recycleViewport() has written the new inline transforms, play the
	 * transition. Rows present before and after at a different top → **move**; rows that
	 * appeared (no captured top) → **enter** (fade in at their final position). Exit of
	 * removed rows is handled separately via the slot exit pool (their DOM is recycled).
	 */
	public beginAnimation(): void {
		const hadSnapshot = this.snapshot.size > 0;
		this.current = resolveRowAnimation(this.options.getRowAnimation?.());
		if (!this.animationsEnabled() || !this.animatesReason(this.snapshotReason, this.current)) {
			this.snapshot.clear();
			this.snapshotBounds = null;
			this.snapshotReason = 'other';
			return;
		}

		const activeRowIds = new Set<string>();
		for (const [, slot] of this.getActiveRows()) {
			if (slot.lastTop < 0) continue;
			if (slot.visualRowId) activeRowIds.add(slot.visualRowId);
			const el = slot.element;
			const entry = this.snapshot.get(slot.visualRowId);
			if (entry === undefined) {
				if (this.snapshotReason === 'live-reorder') continue;
				// ENTER — only animate reveals that accompany a real structural change, so a
				// first paint (empty snapshot) does not fade every row in.
				if (!hadSnapshot) continue;
				if (slot.rowKind === 'detail' && slot.lastHeight > 0) {
					// Detail rows grow from 0 → full height (content clipped) so the rows below —
					// which slide down by the same amount via MOVE — stay glued to the detail's
					// growing bottom edge. Restore overflow when the animation settles.
					const finalHeight = slot.lastHeight;
					const prevOverflow = el.style.overflow;
					el.style.overflow = 'hidden';
					this.run(
						el,
						slot.lastTop,
						[
							{ height: '0px', opacity: 0 },
							{ height: `${finalHeight}px`, opacity: 1 },
						],
						() => {
							el.style.overflow = prevOverflow;
						}
					);
				} else {
					const fromTop = this.current.style === 'fade' ? slot.lastTop : this.getEnterTop(slot.lastTop, slot.lastHeight ?? 0);
					this.run(el, slot.lastTop, [
						{ transform: `translateY(${fromTop}px)`, opacity: 0 },
						{ transform: `translateY(${slot.lastTop}px)`, opacity: 1 },
					]);
				}
			} else if (entry.top !== slot.lastTop) {
				// MOVE — 'slide': from the old top to the live (already-written) new top; 'fade': fade
				// in at the new top.
				this.run(
					el,
					slot.lastTop,
					this.current.style === 'fade'
						? [{ opacity: 0 }, { opacity: 1 }]
						: [{ transform: `translateY(${entry.top}px)` }, { transform: `translateY(${slot.lastTop}px)` }]
				);
			}
		}

		this.playPending();

		// EXIT — a captured row that is no longer rendered AND no longer in the model truly
		// left (e.g. a collapsed group's children). Fade out its ghost clone in place. Rows
		// that merely scrolled out of the window (still live in the model) are not faded.
		if (this.snapshotReason !== 'live-reorder') {
			this.playExits(activeRowIds);
		}

		this.snapshot.clear();
		this.snapshotBounds = null;
		this.snapshotReason = 'other';
	}

	private getEnterTop(finalTop: number, height: number): number {
		if (this.snapshotReason !== 'sort' || this.snapshotBounds === null) return finalTop;
		const midpoint = (this.snapshotBounds.top + this.snapshotBounds.bottom) / 2;
		if (finalTop < midpoint) return this.snapshotBounds.top - Math.max(1, height);
		return this.snapshotBounds.bottom;
	}

	private playExits(activeRowIds: Set<string>): void {
		const exitLayer = this.options.getExitLayer?.();
		const isLive = this.options.isRowIdLive;
		if (!exitLayer) return;
		for (const [rowId, entry] of this.snapshot) {
			if (!entry.clone) continue;
			if (activeRowIds.has(rowId)) continue; // still rendered → moved/stayed, not exiting
			if (isLive && isLive(rowId)) continue; // still in the model → scrolled out, not removed
			const ghost = entry.clone;
			ghost.style.transition = 'none';
			ghost.style.pointerEvents = 'none';
			ghost.style.transform = `translateY(${entry.top}px)`;
			exitLayer.appendChild(ghost);
			this.exitGhosts.add(ghost);
			// Detail rows collapse by shrinking their height to 0 (content clipped) while
			// fading — the rows below slide up by the same amount via MOVE, so the ghost's
			// bottom edge stays glued to them. Other rows just fade out in place.
			const keyframes: Keyframe[] =
				entry.kind === 'detail' && entry.height > 0
					? [
							{ height: `${entry.height}px`, opacity: 1 },
							{ height: '0px', opacity: 0 },
						]
					: [{ opacity: 1 }, { opacity: 0 }];
			if (entry.kind === 'detail') {
				ghost.style.overflow = 'hidden';
				ghost.style.willChange = 'height, opacity';
			} else {
				ghost.style.willChange = 'opacity';
			}
			const anim = (ghost as unknown as { animate: (k: Keyframe[], o: KeyframeAnimationOptions) => Animation }).animate(keyframes, {
				duration: this.current.duration,
				easing: this.current.easing,
				fill: 'forwards',
			});
			const done = () => this.removeGhost(ghost);
			anim.onfinish = done;
			anim.oncancel = done;
		}
	}

	private removeGhost(ghost: HTMLElement): void {
		if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
		this.exitGhosts.delete(ghost);
	}

	/** Queues a row animation at its new top; playPending starts them, cascading top to bottom when staggered. */
	private run(el: HTMLElement, top: number, keyframes: Keyframe[], onSettle?: () => void): void {
		this.pending.push({ el, keyframes, top, onSettle });
	}

	private playPending(): void {
		const pending = this.pending;
		if (pending.length === 0) return;
		const { duration, easing } = this.current;
		let step = this.current.stagger;
		if (step > 0) {
			pending.sort((a, b) => a.top - b.top);
			// Cap the whole cascade so a large change still finishes quickly.
			if (step * (pending.length - 1) > MAX_STAGGER_SPAN_MS) step = MAX_STAGGER_SPAN_MS / Math.max(1, pending.length - 1);
		}
		for (let i = 0; i < pending.length; i++) {
			const { el, keyframes, onSettle } = pending[i];
			const existing = this.animations.get(el);
			if (existing) existing.cancel();
			const delay = step * i;
			const anim = (el as unknown as { animate: (k: Keyframe[], o: KeyframeAnimationOptions) => Animation }).animate(keyframes, {
				duration,
				easing,
				delay,
				// A delayed row holds its starting keyframe until its turn instead of jumping ahead.
				fill: delay > 0 ? 'backwards' : 'none',
			});
			this.animations.set(el, anim);
			const done = () => {
				if (this.animations.get(el) === anim) this.animations.delete(el);
				onSettle?.();
			};
			anim.onfinish = done;
			anim.oncancel = done;
		}
		pending.length = 0;
	}

	/** Immediately tear down all in-flight animations + exit ghosts; live elements revert
	 *  to their inline transforms. Invoked on scroll start so nothing survives a scroll frame. */
	public cancel(): void {
		for (const anim of this.animations.values()) {
			anim.cancel();
		}
		this.animations.clear();
		for (const ghost of this.exitGhosts) {
			if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
		}
		this.exitGhosts.clear();
	}

	public destroy(): void {
		this.cancel();
		this.snapshot.clear();
		this.snapshotBounds = null;
		this.snapshotReason = 'other';
	}
}
