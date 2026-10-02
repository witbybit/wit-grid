import type { GridRendererOptions } from '../columnDef.js';

/**
 * Enforces GridRendererOptions.liveReact's maxMountsPerFrame/maxUpdatesPerFrame.
 * Mount and update are budgeted separately: a mount is more expensive than an update, so a grid can
 * allow many updates per frame while still capping fresh mounts.
 *
 * Scope: this only owns per-frame admission control. ViewportPlanner decides which live cells are
 * visible vs. overscan and orders visible cells ahead of overscan cells; callers consume this budget
 * while applying that plan.
 */
const TIMED_DOM_UPDATES_PER_FRAME = 8;
const TIMED_DOM_UPDATE_INTERVAL = 8;
/** domUpdateStartedAt marker: this update is charged the running average, not timed. */
const ESTIMATED = -2;

export class LiveFrameBudget {
	private maxMountsPerFrame = Infinity;
	private maxUpdatesPerFrame = Infinity;
	private emergencyShellAllowed = true;
	private mountsThisFrame = 0;
	private updatesThisFrame = 0;
	private domUpdateMsPerFrame = 4;
	private domUpdateSpentMs = 0;
	private domUpdateStartedAt = -1;
	/** DOM updates admitted this frame; only some are timed (see beginDomUpdate). */
	private domUpdatesThisFrame = 0;
	/** Running average cost of a timed DOM update, used for the untimed ones. */
	private domUpdateAvgMs = 0;
	private domUpdateTimedCount = 0;
	private readonly now: () => number;

	constructor(now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
		this.now = now;
	}

	public configure(options: GridRendererOptions['liveReact'] | undefined, domUpdate?: GridRendererOptions['domUpdate']): void {
		this.maxMountsPerFrame = options?.maxMountsPerFrame ?? Infinity;
		this.maxUpdatesPerFrame = options?.maxUpdatesPerFrame ?? Infinity;
		this.emergencyShellAllowed = options?.allowEmergencyShell ?? true;
		this.domUpdateMsPerFrame = domUpdate?.maxMsPerFrame ?? 4;
	}

	/** Call once per render frame, before any live-mount binding happens this frame. */
	public resetFrame(): void {
		this.mountsThisFrame = 0;
		this.updatesThisFrame = 0;
		this.domUpdateSpentMs = 0;
		this.domUpdateStartedAt = -1;
		this.domUpdatesThisFrame = 0;
	}

	/**
	 * Admits one in-frame DOM renderer update ('update' presentation) while this frame's DOM renderer
	 * work is inside the budget, and starts timing it; pair with endDomUpdate(). The budget counts
	 * only DOM renderer time (a count cannot bound a renderer's own DOM work, and elapsed frame time
	 * would let unrelated work starve it), so every frame makes progress on a slow device too.
	 */
	public beginDomUpdate(): boolean {
		if (this.domUpdateSpentMs >= this.domUpdateMsPerFrame) return false;
		// The first updates of a frame and every 8th after are timed; the rest are charged the running
		// average, so a frame of hundreds of cheap updates doesn't pay two clock reads each.
		const n = ++this.domUpdatesThisFrame;
		this.domUpdateStartedAt = n <= TIMED_DOM_UPDATES_PER_FRAME || n % TIMED_DOM_UPDATE_INTERVAL === 0 ? this.now() : ESTIMATED;
		return true;
	}

	public endDomUpdate(): void {
		const startedAt = this.domUpdateStartedAt;
		if (startedAt === -1) return;
		this.domUpdateStartedAt = -1;
		if (startedAt === ESTIMATED) {
			this.domUpdateSpentMs += this.domUpdateAvgMs;
			return;
		}
		const elapsed = this.now() - startedAt;
		this.domUpdateSpentMs += elapsed;
		// Average over a bounded window, so it follows a renderer whose cost changes.
		this.domUpdateTimedCount = Math.min(this.domUpdateTimedCount + 1, 64);
		this.domUpdateAvgMs += (elapsed - this.domUpdateAvgMs) / this.domUpdateTimedCount;
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

	public get allowEmergencyShell(): boolean {
		return this.emergencyShellAllowed;
	}
}
