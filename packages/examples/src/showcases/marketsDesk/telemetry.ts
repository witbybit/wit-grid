/**
 * Honest grid telemetry for the markets desk: transaction wall time, frame time, dropped frames and
 * long tasks over a sliding window. The numbers are mirrored on `window.__marketsDeskTelemetry`
 * so an automated benchmark can read them without touching the UI.
 */

export const TELEMETRY_WINDOW_MS = 5000;
/** A frame longer than this missed a 60 Hz deadline with margin. */
export const DROPPED_FRAME_MS = 20;

export interface Percentiles {
	p50: number;
	p95: number;
	max: number;
	count: number;
}

export interface TelemetrySnapshot {
	/** Price updates applied in the last second. */
	updatesPerSec: number;
	/** Rows changed by the most recent transaction. */
	rowsPerFrame: number;
	/** Average rows changed per transaction over the window. */
	rowsPerFrameAvg: number;
	/** Wall time of each `api.transaction` call over the last ~5 s, ms. */
	txnMs: Percentiles;
	/** requestAnimationFrame deltas over the last ~5 s, ms. */
	frameMs: Percentiles;
	fps: number;
	/** Frames longer than 20 ms: over the window and since start. */
	droppedFrames: number;
	droppedFramesTotal: number;
	/** `longtask` entries: over the window and since start (0 where unsupported). */
	longTasks: number;
	longTasksTotal: number;
	longTasksSupported: boolean;
	transactionsTotal: number;
	rowCount: number;
	targetRate: number;
	paused: boolean;
	timestamp: number;
}

export interface MarketsDeskTelemetry extends TelemetrySnapshot {
	/** Recomputes every field now and returns the same object. */
	refresh(): MarketsDeskTelemetry;
}

declare global {
	interface Window {
		__marketsDeskTelemetry?: MarketsDeskTelemetry;
	}
}

interface Sample {
	t: number;
	v: number;
	w?: number;
}

function percentiles(samples: Sample[]): Percentiles {
	const n = samples.length;
	if (n === 0) return { p50: 0, p95: 0, max: 0, count: 0 };
	const sorted = samples.map((s) => s.v).sort((a, b) => a - b);
	const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
	return { p50: at(0.5), p95: at(0.95), max: sorted[n - 1], count: n };
}

function prune(samples: Sample[], now: number, windowMs: number): void {
	let drop = 0;
	while (drop < samples.length && now - samples[drop].t > windowMs) drop++;
	if (drop > 0) samples.splice(0, drop);
}

export class Telemetry {
	private frames: Sample[] = [];
	private txns: Sample[] = [];
	private ticks: Sample[] = [];
	private longs: Sample[] = [];
	private droppedTotal = 0;
	private longTotal = 0;
	private txnTotal = 0;
	private lastRows = 0;
	private observer: PerformanceObserver | null = null;
	private longTasksSupported = false;

	rowCount = 0;
	targetRate = 0;
	paused = false;

	readonly published: MarketsDeskTelemetry;

	constructor() {
		const empty = this.compute(performance.now());
		this.published = { ...empty, refresh: () => this.publish(performance.now()) };
		if (typeof window !== 'undefined') window.__marketsDeskTelemetry = this.published;
		try {
			if (typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask')) {
				this.observer = new PerformanceObserver((list) => {
					const t = performance.now();
					for (const entry of list.getEntries()) {
						this.longs.push({ t, v: entry.duration });
						this.longTotal++;
					}
				});
				this.observer.observe({ entryTypes: ['longtask'] });
				this.longTasksSupported = true;
			}
		} catch {
			this.longTasksSupported = false;
		}
	}

	frame(now: number, delta: number): void {
		// A hidden tab throttles rAF to a crawl: that is the browser, not the grid.
		if (delta > 1000) return;
		this.frames.push({ t: now, v: delta });
		if (delta > DROPPED_FRAME_MS) this.droppedTotal++;
	}

	transaction(now: number, ms: number, rowsChanged: number, updates: number): void {
		this.txns.push({ t: now, v: ms });
		this.ticks.push({ t: now, v: rowsChanged, w: updates });
		this.lastRows = rowsChanged;
		this.txnTotal++;
	}

	private compute(now: number): TelemetrySnapshot {
		prune(this.frames, now, TELEMETRY_WINDOW_MS);
		prune(this.txns, now, TELEMETRY_WINDOW_MS);
		prune(this.ticks, now, TELEMETRY_WINDOW_MS);
		prune(this.longs, now, TELEMETRY_WINDOW_MS);
		const frameMs = percentiles(this.frames);
		let updates = 0;
		let rows = 0;
		for (const s of this.ticks) {
			rows += s.v;
			if (now - s.t <= 1000) updates += s.w ?? 0;
		}
		let dropped = 0;
		let frameSum = 0;
		for (const s of this.frames) {
			frameSum += s.v;
			if (s.v > DROPPED_FRAME_MS) dropped++;
		}
		return {
			updatesPerSec: updates,
			rowsPerFrame: this.lastRows,
			rowsPerFrameAvg: this.ticks.length ? rows / this.ticks.length : 0,
			txnMs: percentiles(this.txns),
			frameMs,
			fps: frameSum > 0 ? (this.frames.length * 1000) / frameSum : 0,
			droppedFrames: dropped,
			droppedFramesTotal: this.droppedTotal,
			longTasks: this.longs.length,
			longTasksTotal: this.longTotal,
			longTasksSupported: this.longTasksSupported,
			transactionsTotal: this.txnTotal,
			rowCount: this.rowCount,
			targetRate: this.targetRate,
			paused: this.paused,
			timestamp: Date.now(),
		};
	}

	/** Recomputes the window and refreshes `window.__marketsDeskTelemetry` in place. */
	publish(now: number): MarketsDeskTelemetry {
		Object.assign(this.published, this.compute(now));
		return this.published;
	}

	snapshot(now: number): TelemetrySnapshot {
		const { refresh: _refresh, ...rest } = this.publish(now);
		return rest;
	}

	dispose(): void {
		this.observer?.disconnect();
		if (typeof window !== 'undefined' && window.__marketsDeskTelemetry === this.published) delete window.__marketsDeskTelemetry;
	}
}
