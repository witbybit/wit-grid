/**
 * Framework-free cell renderers for the high-frequency columns. The grid calls `mount` once per
 * cell slot and `update` whenever the value (or row) changes: no React, no scheduler, and DOM
 * renderers stay live during scroll. All colours come from CSS variables (see styles.ts), so a
 * theme switch re-tints them without remounting.
 */
import type { DomCellRenderer, DomCellRendererParams } from '@eregister/wit-grid-react';
import { fmtPct, fmtPrice, fmtCompact, fmtSignedUsd } from './format';
import type { MarketRow } from './data';

type Params = DomCellRendererParams<MarketRow>;
const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	parent?.appendChild(node);
	return node;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Sets a bar's transform, tweening only when the cell still shows the same row (a live value change);
 * a cell rebound to another row (scroll, sort, regroup) snaps instead of morphing from the old row.
 */
function setBar(bar: HTMLElement, transform: string, tween: boolean): void {
	bar.classList.toggle('md-tween', tween);
	bar.style.transform = transform;
}

/** True while `p` is an update of the row the cell already showed; records the row for the next call. */
function sameRow(): (p: Params) => boolean {
	let rowId: string | null = null;
	return (p) => {
		const same = p.node.id === rowId;
		rowId = p.node.id;
		return same;
	};
}

// ─── Price with an up/down flash ──────────────────────────────────────────────

/** Price cell. A tick toggles one of two identical keyframe classes, which restarts the CSS animation without a reflow. */
export const priceRenderer: DomCellRenderer<MarketRow> = {
	mount(container, params: Params) {
		container.classList.add('md-cell', 'md-end');
		const text = el('span', 'md-price', container);
		let rowId = params.node.id;
		let prev = Number(params.value);
		let flash = '';
		let parity = 0;
		const paint = (p: Params, animate: boolean) => {
			const v = Number(p.value);
			if (animate && v !== prev) {
				const next = `md-f${v > prev ? 'u' : 'd'}${(parity ^= 1)}`;
				if (flash) text.classList.remove(flash);
				text.classList.add(next);
				flash = next;
			}
			prev = v;
			text.textContent = fmtPrice(v, p.node.data.dp);
		};
		paint(params, false);
		return {
			update(p: Params) {
				const same = p.node.id === rowId;
				rowId = p.node.id;
				if (!same && flash) {
					text.classList.remove(flash);
					flash = '';
				}
				paint(p, same);
			},
		};
	},
};

// ─── 40-point sparkline ───────────────────────────────────────────────────────

const SPARK_W = 92;
const SPARK_H = 22;

export const sparklineRenderer: DomCellRenderer<MarketRow> = {
	mount(container, params: Params) {
		container.classList.add('md-cell');
		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
		svg.setAttribute('width', String(SPARK_W));
		svg.setAttribute('height', String(SPARK_H));
		svg.setAttribute('class', 'md-spark');
		const area = document.createElementNS(SVG_NS, 'polygon');
		area.setAttribute('class', 'md-spark-area');
		const line = document.createElementNS(SVG_NS, 'polyline');
		line.setAttribute('class', 'md-spark-line');
		const dot = document.createElementNS(SVG_NS, 'circle');
		dot.setAttribute('r', '2');
		dot.setAttribute('class', 'md-spark-dot');
		svg.append(area, line, dot);
		container.appendChild(svg);
		const draw = (history: number[]) => {
			const n = history.length;
			if (n < 2) return;
			let lo = Infinity;
			let hi = -Infinity;
			for (let i = 0; i < n; i++) {
				const v = history[i];
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			const range = hi - lo || 1;
			let pts = '';
			let lastY = 0;
			for (let i = 0; i < n; i++) {
				const x = (i / (n - 1)) * (SPARK_W - 4) + 1;
				lastY = SPARK_H - 3 - ((history[i] - lo) / range) * (SPARK_H - 6);
				pts += `${x.toFixed(1)},${lastY.toFixed(1)} `;
			}
			line.setAttribute('points', pts);
			area.setAttribute('points', `1,${SPARK_H} ${pts}${SPARK_W - 3},${SPARK_H}`);
			dot.setAttribute('cx', String(SPARK_W - 3));
			dot.setAttribute('cy', lastY.toFixed(1));
			svg.setAttribute('data-dir', history[n - 1] >= history[0] ? 'up' : 'down');
		};
		draw(params.value as number[]);
		return {
			update(p: Params) {
				draw(p.value as number[]);
			},
		};
	},
};

// ─── Change % heat bar (diverging) ────────────────────────────────────────────

const HEAT_FULL_PCT = 4;

export const changeHeatRenderer: DomCellRenderer<MarketRow> = {
	mount(container, params: Params) {
		container.classList.add('md-cell');
		const wrap = el('div', 'md-heat', container);
		const bar = el('i', 'md-heat-bar', wrap);
		const text = el('span', 'md-heat-text', wrap);
		const same = sameRow();
		const paint = (p: Params) => {
			const pct = Number(p.value);
			// From the centre line: right for gains, mirrored left for losses.
			setBar(bar, `scaleX(${clamp(pct / HEAT_FULL_PCT, -1, 1)})`, same(p));
			bar.dataset.dir = pct >= 0 ? 'up' : 'down';
			text.dataset.dir = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
			text.textContent = fmtPct(pct);
		};
		paint(params);
		return { update: paint };
	},
};

// ─── Bid | spread | ask ───────────────────────────────────────────────────────

export const quoteRenderer: DomCellRenderer<MarketRow> = {
	mount(container, params: Params) {
		container.classList.add('md-cell');
		const wrap = el('div', 'md-quote', container);
		const bid = el('span', 'md-quote-bid', wrap);
		const spread = el('span', 'md-quote-spread', wrap);
		const ask = el('span', 'md-quote-ask', wrap);
		const paint = (p: Params) => {
			const r = p.node.data;
			bid.textContent = fmtPrice(r.bid, r.dp);
			spread.textContent = r.spread < 0.01 ? r.spread.toFixed(r.dp) : r.spread.toFixed(2);
			ask.textContent = fmtPrice(r.ask, r.dp);
		};
		paint(params);
		return { update: paint };
	},
};

// ─── Day range with price marker and VWAP tick ────────────────────────────────

export const dayRangeRenderer: DomCellRenderer<MarketRow> = {
	mount(container, params: Params) {
		container.classList.add('md-cell');
		const wrap = el('div', 'md-range', container);
		const lo = el('span', 'md-range-lo', wrap);
		const track = el('div', 'md-range-track', wrap);
		const vwap = el('i', 'md-range-vwap', track);
		const marker = el('i', 'md-range-marker', track);
		const hi = el('span', 'md-range-hi', wrap);
		const same = sameRow();
		const paint = (p: Params) => {
			const r = p.node.data;
			const span = r.dayHigh - r.dayLow || 1;
			lo.textContent = fmtPrice(r.dayLow, r.dp);
			hi.textContent = fmtPrice(r.dayHigh, r.dp);
			// The marker spans the track; translating it by a share of its own width moves its tick along the track.
			setBar(marker, `translateX(${clamp((r.price - r.dayLow) / span, 0, 1) * 100}%)`, same(p));
			marker.dataset.dir = r.price >= r.prevClose ? 'up' : 'down';
			vwap.style.left = `${clamp((r.vwap - r.dayLow) / span, 0, 1) * 100}%`;
		};
		paint(params);
		return { update: paint };
	},
};

// ─── Relative volume bar ──────────────────────────────────────────────────────

export const volumeRenderer: DomCellRenderer<MarketRow> = {
	mount(container, params: Params) {
		container.classList.add('md-cell');
		const wrap = el('div', 'md-bar-cell', container);
		const track = el('div', 'md-bar-track', wrap);
		const fill = el('i', 'md-bar-fill md-bar-accent', track);
		const text = el('span', 'md-bar-text', wrap);
		const same = sameRow();
		const paint = (p: Params) => {
			const r = p.node.data;
			setBar(fill, `scaleX(${clamp(r.volume / r.avgVolume, 0.02, 1)})`, same(p));
			text.textContent = fmtCompact(r.volume);
		};
		paint(params);
		return { update: paint };
	},
};

// ─── Unrealised P&L: value plus a mini bar ────────────────────────────────────

export const pnlRenderer: DomCellRenderer<MarketRow> = {
	mount(container, params: Params) {
		container.classList.add('md-cell', 'md-end');
		const wrap = el('div', 'md-pnl', container);
		const text = el('span', 'md-pnl-text', wrap);
		const track = el('div', 'md-pnl-track', wrap);
		const fill = el('i', 'md-pnl-fill', track);
		const same = sameRow();
		const paint = (p: Params) => {
			const r = p.node.data;
			const v = Number(p.value);
			text.textContent = fmtSignedUsd(v);
			text.dataset.dir = v > 0 ? 'up' : v < 0 ? 'down' : '';
			fill.dataset.dir = v >= 0 ? 'up' : 'down';
			setBar(fill, `scaleX(${clamp(Math.abs(v) / (r.notional * 0.04 || 1), 0.03, 1)})`, same(p));
		};
		paint(params);
		return { update: paint };
	},
};

// ─── Volatility gauge ─────────────────────────────────────────────────────────

export const volatilityRenderer: DomCellRenderer<MarketRow> = {
	mount(container, params: Params) {
		container.classList.add('md-cell');
		const wrap = el('div', 'md-bar-cell', container);
		const track = el('div', 'md-bar-track', wrap);
		const fill = el('i', 'md-bar-fill', track);
		const text = el('span', 'md-bar-text', wrap);
		const same = sameRow();
		const paint = (p: Params) => {
			const v = Number(p.value);
			setBar(fill, `scaleX(${clamp(v / 100, 0.03, 1)})`, same(p));
			fill.dataset.level = v >= 60 ? 'hi' : v >= 30 ? 'mid' : 'lo';
			text.textContent = `${v.toFixed(0)}%`;
		};
		paint(params);
		return { update: paint };
	},
};

// ─── Aggregate renderer: coloured text for group and total rows ───────────────

export function coloredAggregate(format: (value: number) => string) {
	return {
		kind: 'dom' as const,
		renderer: {
			mount(container: HTMLElement, params: { value: unknown }) {
				container.classList.add('md-cell', 'md-end');
				const text = el('span', 'md-agg', container);
				const paint = (value: unknown) => {
					const v = Number(value);
					if (!Number.isFinite(v)) {
						text.textContent = '';
						return;
					}
					text.textContent = format(v);
					text.dataset.dir = v > 0 ? 'up' : v < 0 ? 'down' : '';
				};
				paint(params.value);
				return {
					update(p: { value: unknown }) {
						paint(p.value);
					},
				};
			},
		},
	};
}
