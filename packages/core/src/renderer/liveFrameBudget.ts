import type { GridRendererOptions } from '../columnDef.js';

/**
 * Enforces GridRendererOptions.live's maxMountsPerFrame/maxUpdatesPerFrame/maxMsPerFrame.
 * Mount and update are budgeted separately: a mount is more expensive than an update, so a grid can
 * allow many updates per frame while still capping fresh mounts.
 *
 * Scope: this only owns per-frame admission control. ViewportPlanner decides which live cells are
 * visible vs. overscan and orders visible cells ahead of overscan cells; callers consume this budget
 * while applying that plan.
 */
export class LiveFrameBudget {
	private maxMountsPerFrame = Infinity;
	private maxUpdatesPerFrame = Infinity;
	private mountsThisFrame = 0;
	private updatesThisFrame = 0;
	private domUpdateMsPerFrame = 4;
	private domUpdateSpentMs = 0;
	private domUpdateStartedAt = -1;
	/** Time spent this frame computing valueGetters for stand-in text (see beginGetterPrime). */
	private getterPrimeSpentMs = 0;
	private getterPrimeStartedAt = -1;
	private readonly getterPrimeMsPerFrame = 2;
	private readonly now: () => number;

	constructor(now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
		this.now = now;
	}

	public configure(options: GridRendererOptions['live'] | undefined): void {
		this.maxMountsPerFrame = options?.maxMountsPerFrame ?? Infinity;
		this.maxUpdatesPerFrame = options?.maxUpdatesPerFrame ?? Infinity;
		this.domUpdateMsPerFrame = options?.maxMsPerFrame ?? 4;
	}

	/** Call once per render frame, before any live-mount binding happens this frame. */
	public resetFrame(): void {
		this.mountsThisFrame = 0;
		this.updatesThisFrame = 0;
		this.domUpdateSpentMs = 0;
		this.domUpdateStartedAt = -1;
		this.getterPrimeSpentMs = 0;
		this.getterPrimeStartedAt = -1;
	}

	/**
	 * Admits computing one cell's valueGetter during a scroll frame, so a visible stand-in shows the
	 * cell's text instead of a blank; pair with endGetterPrime(). Bounded per frame like DOM updates:
	 * user getters can be arbitrarily expensive, and the rest wait for the full bind as before.
	 */
	public beginGetterPrime(): boolean {
		if (this.getterPrimeSpentMs >= this.getterPrimeMsPerFrame) return false;
		this.getterPrimeStartedAt = this.now();
		return true;
	}

	public endGetterPrime(): void {
		if (this.getterPrimeStartedAt < 0) return;
		this.getterPrimeSpentMs += this.now() - this.getterPrimeStartedAt;
		this.getterPrimeStartedAt = -1;
	}

	/**
	 * Admits one in-frame DOM renderer update (`scroll: 'live'`) while this frame's DOM renderer
	 * work is inside the budget, and starts timing it; pair with endDomUpdate(). The budget counts
	 * only DOM renderer time (a count cannot bound a renderer's own DOM work, and elapsed frame time
	 * would let unrelated work starve it), so every frame makes progress on a slow device too.
	 */
	public beginDomUpdate(): boolean {
		if (this.domUpdateSpentMs >= this.domUpdateMsPerFrame) return false;
		this.domUpdateStartedAt = this.now();
		return true;
	}

	public endDomUpdate(): void {
		if (this.domUpdateStartedAt < 0) return;
		this.domUpdateSpentMs += this.now() - this.domUpdateStartedAt;
		this.domUpdateStartedAt = -1;
	}

	/** Returns true if this mount/update may proceed within budget, consuming budget if so. */
	public tryConsume(kind: 'mount' | 'update'): boolean {
		if (kind === 'mount') {
			if (this.mountsThisFrame >= this.maxMountsPerFrame) return false;
			this.mountsThisFrame++;
			return true;
		}
		if (this.updatesThisFrame >= this.maxUpdatesPerFrame) return false;
		this.updatesThisFrame++;
		return true;
	}
}
