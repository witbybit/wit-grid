/**
 * The markets desk feed: a random-walk price engine that accumulates ticks and applies them to the
 * grid ONCE per animation frame as a single `api.transaction({ rows: { update } })`. It also keeps
 * incremental desk totals (so the KPI strip never scans 200k rows) and the telemetry.
 */
import type { GridApi } from '@eregister/wit-grid-react';
import { DESKS, gauss, generateMarket, mulberry32, type MarketRow } from './data';
import { Telemetry, type TelemetrySnapshot } from './telemetry';

export const RATE_OPTIONS = [100, 1_000, 10_000, 50_000] as const;
const MAX_FRAME_DT_MS = 100;
/** A frame's grid transaction aims at this, leaving the rest of the frame to paint (see adaptBudget). */
const FRAME_TX_TARGET_MS = 6;
const PNL_SERIES_LENGTH = 120;
const PUBLISH_MS = 250;

export interface SectorTile {
	key: string;
	assetClass: string;
	sector: string;
	count: number;
	/** Average day change of the instruments in the sector, percent. */
	avgPct: number;
	notional: number;
}

export interface DeskSnapshot {
	instruments: number;
	grossNotional: number;
	totalPnl: number;
	/** Total P&L when the page opened, for the session delta. */
	basePnl: number;
	advancers: number;
	decliners: number;
	tiles: SectorTile[];
	/** Total P&L sampled each second, oldest first. */
	pnlSeries: number[];
	rate: number;
	paused: boolean;
	telemetry: TelemetrySnapshot;
}

type Listener = (snapshot: DeskSnapshot) => void;

const requestFrame: (cb: (t: number) => void) => number =
	typeof requestAnimationFrame === 'function'
		? (cb) => requestAnimationFrame(cb)
		: (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const cancelFrame: (id: number) => void =
	typeof cancelAnimationFrame === 'function'
		? (id) => cancelAnimationFrame(id)
		: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

export class FeedEngine {
	/** Current rows, indexed like the generated universe. Replaced (never mutated) per changed row. */
	readonly rows: MarketRow[];
	api: GridApi<MarketRow> | null = null;
	readonly telemetry = new Telemetry();

	rate = 1000;
	paused = false;

	private readonly rand: () => number;
	private raf = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private lastFrame = 0;
	private carry = 0;
	private running = false;
	private listeners = new Set<Listener>();
	/**
	 * Conflated rows waiting to reach the grid, oldest first. A row ticking again merges into its draft,
	 * so a row the frame budget defers shows its latest value a frame or two later; nothing is dropped.
	 */
	private readonly drafts = new Map<number, MarketRow>();
	/** Drafts whose price history already holds their pending point (a later tick replaces it). */
	private readonly historyPending = new Set<number>();
	/** Rows per frame the grid is handed, adapted so a frame's transaction stays near FRAME_TX_TARGET_MS. */
	private frameBudget = 1500;
	private readonly nonActive = new Set<number>();
	private nonActiveList: number[] = [];

	// Incremental totals.
	private grossNotional = 0;
	private totalPnl = 0;
	private basePnl = 0;
	private advancers = 0;
	private decliners = 0;
	private readonly sectorOf: Uint16Array;
	private readonly sectorKeys: { assetClass: string; sector: string }[] = [];
	private readonly sectorCount: number[] = [];
	private readonly sectorPct: number[] = [];
	private readonly sectorNotional: number[] = [];
	private pnlSeries: number[] = [];
	private lastSeriesAt = 0;
	snapshot: DeskSnapshot;

	/** `rows` from generateMarketAsync (a large universe built without freezing the page); generated here otherwise. */
	constructor(count: number, seed = 2026, rows?: MarketRow[]) {
		this.rows = rows ?? generateMarket(count, seed);
		this.drafts.clear();
		this.historyPending.clear();
		this.rand = mulberry32(seed ^ 0x9e3779b9);
		this.sectorOf = new Uint16Array(count);
		const sectorIndex = new Map<string, number>();
		for (let i = 0; i < count; i++) {
			const r = this.rows[i];
			const key = `${r.assetClass}|${r.sector}`;
			let s = sectorIndex.get(key);
			if (s === undefined) {
				s = this.sectorKeys.length;
				sectorIndex.set(key, s);
				this.sectorKeys.push({ assetClass: r.assetClass, sector: r.sector });
				this.sectorCount.push(0);
				this.sectorPct.push(0);
				this.sectorNotional.push(0);
			}
			this.sectorOf[i] = s;
			this.sectorCount[s]++;
			this.sectorPct[s] += r.changePct;
			this.sectorNotional[s] += r.notional;
			this.grossNotional += r.notional;
			this.totalPnl += r.unrealizedPnl;
			if (r.changePct > 0) this.advancers++;
			else if (r.changePct < 0) this.decliners++;
			if (r.status !== 'active') this.nonActive.add(i);
		}
		this.nonActiveList = [...this.nonActive];
		this.basePnl = this.totalPnl;
		// Seed the chart with a gentle approach to the opening value, so it has a shape from the first paint.
		const seedRand = mulberry32(seed + 1);
		let level = this.totalPnl;
		const seeded: number[] = [];
		for (let i = 0; i < 60; i++) {
			seeded.push(level);
			level -= gauss(seedRand) * Math.abs(this.grossNotional) * 0.00004;
		}
		this.pnlSeries = seeded.reverse();
		this.telemetry.rowCount = count;
		this.telemetry.targetRate = this.rate;
		this.snapshot = this.buildSnapshot(performance.now());
	}

	get count(): number {
		return this.rows.length;
	}

	/** A copy of the current rows, for mounting a fresh grid. */
	snapshotRows(): MarketRow[] {
		return this.rows.slice();
	}

	attach(api: GridApi<MarketRow> | null): void {
		this.api = api;
	}

	setRate(rate: number): void {
		this.rate = rate;
		this.telemetry.targetRate = rate;
	}

	setPaused(paused: boolean): void {
		this.paused = paused;
		this.telemetry.paused = paused;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.lastFrame = performance.now();
		const loop = (now: number) => {
			if (!this.running) return;
			const dt = now - this.lastFrame;
			this.lastFrame = now;
			this.telemetry.frame(now, dt);
			if (!this.paused && this.api) this.applyFrame(Math.min(dt, MAX_FRAME_DT_MS));
			this.raf = requestFrame(loop);
		};
		this.raf = requestFrame(loop);
		this.timer = setInterval(() => this.publish(), PUBLISH_MS);
	}

	stop(): void {
		this.running = false;
		cancelFrame(this.raf);
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.api = null;
	}

	dispose(): void {
		this.stop();
		this.telemetry.dispose();
		this.listeners.clear();
	}

	private applyFrame(dtMs: number): void {
		const rows = this.rows;
		const n = rows.length;
		const drafts = this.drafts;
		const touched = new Set<number>();
		const exact = this.carry + (this.rate * dtMs) / 1000;
		const ticks = Math.floor(exact);
		this.carry = exact - ticks;
		const rand = this.rand;
		let applied = 0;

		for (let t = 0; t < ticks; t++) {
			const idx = (rand() * n) | 0;
			let d = drafts.get(idx);
			const base = d ?? rows[idx];
			if (base.status === 'halted') continue;
			if (!d) {
				d = { ...base };
				drafts.set(idx, d);
			}
			touched.add(idx);
			const tickVol = (d.volatility / 40) * 0.0007;
			let step = gauss(rand) * tickVol;
			// A soft leash keeps the session from random-walking far away from the previous close.
			if (Math.abs(d.changePct) > 12 && Math.sign(step) === Math.sign(d.changePct)) step = -step;
			const p = d.price * (1 + step);
			d.price = p;
			if (p > d.dayHigh) d.dayHigh = p;
			if (p < d.dayLow) d.dayLow = p;
			d.volume += d.avgVolume * 0.0002 * (0.5 + rand());
			applied++;
		}

		const now = Date.now();
		// Rare structural changes: a status flip or a desk move, so group and filter membership moves too.
		if (rand() < 0.04) this.structuralChange(drafts, now);

		// Derived fields once per frame for the rows that ticked in it (a deferred row keeps its draft).
		for (const idx of touched) {
			const d = drafts.get(idx)!;
			d.spread = d.price * d.spreadFrac * 2;
			d.bid = d.price - d.spread / 2;
			d.ask = d.price + d.spread / 2;
			d.change = d.price - d.prevClose;
			d.changePct = (d.price / d.prevClose - 1) * 100;
			d.notional = Math.abs(d.position) * d.price;
			d.unrealizedPnl = d.position * (d.price - d.avgCost);
			d.vwap += (d.price - d.vwap) * 0.02;
			if (this.historyPending.has(idx)) {
				const h = d.history.slice();
				h[h.length - 1] = d.price;
				d.history = h;
			} else {
				const h = rows[idx].history.slice(1);
				h.push(d.price);
				d.history = h;
				this.historyPending.add(idx);
			}
			d.lastTickAt = now;
		}

		if (drafts.size === 0) return;
		const api = this.api;
		if (!api) return;
		// Oldest drafts first, up to the frame budget; the rest wait for the next frame.
		const update: MarketRow[] = [];
		const committed: number[] = [];
		for (const [idx, d] of drafts) {
			if (update.length >= this.frameBudget) break;
			update.push(d);
			committed.push(idx);
		}
		const t0 = performance.now();
		try {
			api.transaction({ rows: { update } });
		} catch (error) {
			// The grid was torn down between frames (a remount); the next onGridReady re-attaches.
			// Anything else is a real failure: report it rather than silently stopping the feed.
			console.error('[markets desk] transaction failed', error);
			this.api = null;
			return;
		}
		const t1 = performance.now();
		this.adaptBudget(t1 - t0, drafts.size - update.length);
		this.telemetry.transaction(t1, t1 - t0, update.length, applied);
		for (const idx of committed) this.commit(idx, drafts.get(idx)!);
	}

	/** Shrinks the budget when a frame's transaction runs long, grows it while a backlog waits and frames are cheap. */
	private adaptBudget(txMs: number, backlog: number): void {
		if (txMs > FRAME_TX_TARGET_MS * 1.3) this.frameBudget = Math.max(200, Math.floor(this.frameBudget * 0.85));
		else if (backlog > 0 && txMs < FRAME_TX_TARGET_MS * 0.7) this.frameBudget = Math.min(6000, Math.ceil(this.frameBudget * 1.1));
	}

	/** The grid now shows `d`: it becomes the row, and the desk totals move by its difference. */
	private commit(idx: number, d: MarketRow): void {
		const old = this.rows[idx];
		this.drafts.delete(idx);
		this.historyPending.delete(idx);
		this.rows[idx] = d;
		if (d.price === old.price) return;
		this.grossNotional += d.notional - old.notional;
		this.totalPnl += d.unrealizedPnl - old.unrealizedPnl;
		const s = this.sectorOf[idx];
		this.sectorPct[s] += d.changePct - old.changePct;
		this.sectorNotional[s] += d.notional - old.notional;
		const was = old.changePct > 0 ? 1 : old.changePct < 0 ? -1 : 0;
		const is = d.changePct > 0 ? 1 : d.changePct < 0 ? -1 : 0;
		if (was !== is) {
			if (was === 1) this.advancers--;
			else if (was === -1) this.decliners--;
			if (is === 1) this.advancers++;
			else if (is === -1) this.decliners++;
		}
	}

	private structuralChange(drafts: Map<number, MarketRow>, now: number): void {
		const rand = this.rand;
		const n = this.rows.length;
		const roll = rand();
		if (roll < 0.35) {
			// A desk move.
			const idx = (rand() * n) | 0;
			const d = drafts.get(idx) ?? { ...this.rows[idx] };
			let desk = d.desk;
			while (desk === d.desk) desk = DESKS[Math.floor(rand() * DESKS.length)];
			d.desk = desk;
			d.lastTickAt = now;
			drafts.set(idx, d);
		} else if (roll < 0.75 && this.nonActive.size > 0) {
			// A halted or auction instrument resumes.
			const idx = this.nonActiveList[Math.floor(rand() * this.nonActiveList.length)];
			this.nonActive.delete(idx);
			this.nonActiveList = [...this.nonActive];
			const d = drafts.get(idx) ?? { ...this.rows[idx] };
			d.status = 'active';
			d.lastTickAt = now;
			drafts.set(idx, d);
		} else {
			const idx = (rand() * n) | 0;
			const d = drafts.get(idx) ?? { ...this.rows[idx] };
			if (d.status === 'active') {
				d.status = rand() < 0.5 ? 'halted' : 'auction';
				this.nonActive.add(idx);
				this.nonActiveList.push(idx);
				d.lastTickAt = now;
				drafts.set(idx, d);
			}
		}
	}

	private buildSnapshot(now: number): DeskSnapshot {
		const tiles: SectorTile[] = this.sectorKeys.map((k, i) => ({
			key: `${k.assetClass}|${k.sector}`,
			assetClass: k.assetClass,
			sector: k.sector,
			count: this.sectorCount[i],
			avgPct: this.sectorCount[i] ? this.sectorPct[i] / this.sectorCount[i] : 0,
			notional: this.sectorNotional[i],
		}));
		return {
			instruments: this.rows.length,
			grossNotional: this.grossNotional,
			totalPnl: this.totalPnl,
			basePnl: this.basePnl,
			advancers: this.advancers,
			decliners: this.decliners,
			tiles,
			pnlSeries: this.pnlSeries,
			rate: this.rate,
			paused: this.paused,
			telemetry: this.telemetry.snapshot(now),
		};
	}

	private publish(): void {
		const now = performance.now();
		if (now - this.lastSeriesAt >= 1000) {
			this.lastSeriesAt = now;
			this.pnlSeries = [...this.pnlSeries.slice(-(PNL_SERIES_LENGTH - 1)), this.totalPnl];
		}
		this.snapshot = this.buildSnapshot(now);
		for (const listener of this.listeners) listener(this.snapshot);
	}
}
