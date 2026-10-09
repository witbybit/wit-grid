/**
 * Draws a chart on a canvas and returns where its marks are (for tooltips and cross-filter
 * clicks). Lines and areas past the plot's pixel width are downsampled (LTTB).
 */
import { formatCompact, lttb, niceTicks, tracePath } from './chartScale.js';
import type { ChartData, ChartSpec } from './chartTypes.js';

export interface ChartTheme {
	text: string;
	line: string;
	background: string;
	font: string;
}

export type HitRegion =
	| { kind: 'rect'; category: number; series: number; x: number; y: number; w: number; h: number }
	| { kind: 'arc'; category: number; series: number; cx: number; cy: number; r0: number; r1: number; a0: number; a1: number }
	| { kind: 'point'; category: number; series: number; x: number; y: number };

export interface DrawState {
	/** The category under the pointer, or the one a cross-filter selected: the rest dim. */
	focus: number | null;
	/** Growth from the baseline, 0 → 1 (the entry animation). */
	progress: number;
}

export interface DrawResult {
	regions: HitRegion[];
	/** The category at a point of the plot (lines and areas: by x). */
	categoryAt?: (x: number, y: number) => number | null;
}

const PAD = { top: 14, right: 16, bottom: 10, left: 10 };
const DIM = 0.28;

function valueDomain(data: ChartData, spec: ChartSpec): [number, number] {
	let min = Infinity;
	let max = -Infinity;
	const stacked = spec.stacked && spec.type !== 'line' && spec.type !== 'scatter';
	if (stacked) {
		for (let c = 0; c < data.categories.length; c++) {
			let pos = 0;
			let neg = 0;
			for (const s of data.series) {
				const v = s.values[c] ?? 0;
				if (v >= 0) pos += v;
				else neg += v;
			}
			min = Math.min(min, neg);
			max = Math.max(max, pos);
		}
	} else {
		const series = spec.type === 'scatter' && data.series.length > 1 ? data.series.slice(1) : data.series;
		for (const s of series) for (const v of s.values) if (Number.isFinite(v)) ((min = Math.min(min, v)), (max = Math.max(max, v)));
	}
	if (min === Infinity) return [0, 1];
	if (spec.zeroBased !== false) {
		min = Math.min(0, min);
		max = Math.max(0, max);
	}
	return [min, max];
}

function setFont(ctx: CanvasRenderingContext2D, theme: ChartTheme, size: number, weight = 400) {
	ctx.font = `${weight} ${size}px ${theme.font}`;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
	if (ctx.measureText(text).width <= width) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) lo = mid;
		else hi = mid - 1;
	}
	return lo > 0 ? `${text.slice(0, lo)}…` : '';
}

function alphaFor(state: DrawState, category: number): number {
	return state.focus === null || state.focus === category ? 1 : DIM;
}

export function drawChart(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	data: ChartData,
	spec: ChartSpec,
	theme: ChartTheme,
	state: DrawState
): DrawResult {
	ctx.clearRect(0, 0, width, height);
	if (data.categories.length === 0 || data.series.length === 0) return { regions: [] };
	if (spec.type === 'pie' || spec.type === 'donut') return drawPie(ctx, width, height, data, spec, theme, state);
	return drawCartesian(ctx, width, height, data, spec, theme, state);
}

function drawPie(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	data: ChartData,
	spec: ChartSpec,
	theme: ChartTheme,
	state: DrawState
): DrawResult {
	const regions: HitRegion[] = [];
	const values = data.series[0].values.map((v) => Math.max(0, v || 0));
	const total = values.reduce((s, v) => s + v, 0);
	const cx = width / 2;
	const cy = height / 2;
	const r1 = Math.max(10, Math.min(width, height) / 2 - 12);
	const r0 = spec.type === 'donut' ? r1 * 0.62 : 0;
	if (total <= 0) return { regions };
	let angle = -Math.PI / 2;
	const sweep = Math.PI * 2 * state.progress;
	values.forEach((value, category) => {
		const a0 = angle;
		const a1 = angle + (value / total) * sweep;
		angle = a1;
		if (a1 - a0 <= 0) return;
		const color = spec.palette?.[category % spec.palette.length] ?? sliceColor(category);
		const lift = state.focus === category ? 6 : 0;
		const mid = (a0 + a1) / 2;
		const ox = Math.cos(mid) * lift;
		const oy = Math.sin(mid) * lift;
		ctx.beginPath();
		ctx.arc(cx + ox, cy + oy, r1, a0, a1);
		if (r0 > 0) ctx.arc(cx + ox, cy + oy, r0, a1, a0, true);
		else ctx.lineTo(cx + ox, cy + oy);
		ctx.closePath();
		ctx.globalAlpha = alphaFor(state, category);
		ctx.fillStyle = color;
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.lineWidth = 2;
		ctx.strokeStyle = theme.background;
		ctx.stroke();
		regions.push({ kind: 'arc', category, series: 0, cx, cy, r0, r1: r1 + lift, a0, a1 });
		if (spec.labels && a1 - a0 > 0.28 && state.progress === 1) {
			const lr = r0 > 0 ? (r0 + r1) / 2 : r1 * 0.66;
			setFont(ctx, theme, 11, 600);
			ctx.fillStyle = '#fff';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(`${Math.round((value / total) * 100)}%`, cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr);
		}
	});
	if (r0 > 0 && state.progress === 1) {
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const focused = state.focus;
		setFont(ctx, theme, Math.max(14, Math.min(26, r0 / 2.6)), 650);
		ctx.fillStyle = theme.text;
		ctx.fillText(formatCompact(focused === null ? total : values[focused]), cx, cy - 6);
		setFont(ctx, theme, 11);
		ctx.globalAlpha = 0.6;
		ctx.fillText(fitText(ctx, focused === null ? 'Total' : data.categories[focused], r0 * 1.5), cx, cy + 12);
		ctx.globalAlpha = 1;
	}
	return { regions };
}

const SLICE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16', '#14b8a6', '#f97316'];
const sliceColor = (i: number) => SLICE_COLORS[i % SLICE_COLORS.length];

function drawCartesian(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	data: ChartData,
	spec: ChartSpec,
	theme: ChartTheme,
	state: DrawState
): DrawResult {
	const regions: HitRegion[] = [];
	const horizontal = spec.type === 'bar';
	const n = data.categories.length;
	const [min, max] = valueDomain(data, spec);
	setFont(ctx, theme, 11);

	// The value axis.
	const valueLength = horizontal ? width : height;
	const ticks = niceTicks(min, max, Math.max(2, Math.round(valueLength / 70)));
	const lo = ticks[0];
	const hi = ticks[ticks.length - 1];
	const tickLabels = ticks.map(formatCompact);
	const valueLabelWidth = Math.max(...tickLabels.map((t) => ctx.measureText(t).width));
	const categoryLabelWidth = horizontal ? Math.min(width * 0.32, Math.max(...data.categories.map((c) => ctx.measureText(c).width)) + 8) : 0;

	const left = PAD.left + (horizontal ? categoryLabelWidth : valueLabelWidth + 8);
	const right = width - PAD.right;
	const top = PAD.top;
	const bottom = height - PAD.bottom - 20;
	const plotW = Math.max(10, right - left);
	const plotH = Math.max(10, bottom - top);
	const scale = (v: number) => (horizontal ? left + ((v - lo) / (hi - lo)) * plotW : bottom - ((v - lo) / (hi - lo)) * plotH);
	const base = scale(Math.max(lo, Math.min(hi, 0)));

	// Grid lines and value ticks.
	ctx.lineWidth = 1;
	ticks.forEach((tick, i) => {
		const p = Math.round(scale(tick)) + 0.5;
		ctx.strokeStyle = theme.line;
		ctx.globalAlpha = tick === 0 ? 0.9 : 0.45;
		ctx.beginPath();
		if (horizontal) {
			ctx.moveTo(p, top);
			ctx.lineTo(p, bottom);
		} else {
			ctx.moveTo(left, p);
			ctx.lineTo(right, p);
		}
		ctx.stroke();
		ctx.globalAlpha = 0.6;
		ctx.fillStyle = theme.text;
		if (horizontal) {
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			ctx.fillText(tickLabels[i], p, bottom + 6);
		} else {
			ctx.textAlign = 'right';
			ctx.textBaseline = 'middle';
			ctx.fillText(tickLabels[i], left - 8, p);
		}
	});
	ctx.globalAlpha = 1;

	// Category labels: as many as fit, evenly spaced.
	const categoryLength = horizontal ? plotH : plotW;
	const band = categoryLength / n;
	const pointX = (i: number) =>
		(spec.type === 'line' || spec.type === 'area' || spec.type === 'scatter') && n > 1 ? left + (i / (n - 1)) * plotW : left + band * (i + 0.5);
	const categoryPos = (i: number) => (horizontal ? top + band * (i + 0.5) : pointX(i));
	ctx.fillStyle = theme.text;
	ctx.globalAlpha = 0.7;
	if (horizontal) {
		const every = Math.max(1, Math.ceil(16 / band));
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		for (let i = 0; i < n; i += every) ctx.fillText(fitText(ctx, data.categories[i], categoryLabelWidth - 8), left - 8, categoryPos(i));
	} else if (!(spec.type === 'scatter' && data.series.length > 1)) {
		const widest = Math.max(...data.categories.map((c) => ctx.measureText(c).width), 1);
		const every = Math.max(1, Math.ceil((Math.min(widest, 120) + 12) / (n > 1 ? plotW / n : plotW)));
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		for (let i = 0; i < n; i += every) ctx.fillText(fitText(ctx, data.categories[i], (plotW / n) * every - 6), categoryPos(i), bottom + 6);
	}
	ctx.globalAlpha = 1;

	const grow = (v: number) => base + (scale(v) - base) * state.progress;

	if (spec.type === 'column' || spec.type === 'bar') {
		const groupWidth = band * 0.72;
		const stacked = !!spec.stacked;
		const each = stacked ? groupWidth : groupWidth / data.series.length;
		for (let c = 0; c < n; c++) {
			let pos = 0;
			let neg = 0;
			const start = (horizontal ? top + band * c : left + band * c) + (band - groupWidth) / 2;
			data.series.forEach((series, s) => {
				const v = series.values[c] ?? 0;
				let from = 0;
				if (stacked) {
					from = v >= 0 ? pos : neg;
					if (v >= 0) pos += v;
					else neg += v;
				}
				const a = grow(from);
				const b = grow(from + v);
				const offset = stacked ? 0 : each * s;
				const thickness = Math.max(1, each - (stacked || data.series.length === 1 ? 0 : 2));
				const x = horizontal ? Math.min(a, b) : start + offset;
				const y = horizontal ? start + offset : Math.min(a, b);
				const w = horizontal ? Math.abs(b - a) : thickness;
				const h = horizontal ? thickness : Math.abs(b - a);
				ctx.globalAlpha = alphaFor(state, c);
				ctx.fillStyle = series.color;
				roundRect(ctx, x, y, w, h, Math.min(4, thickness / 3), horizontal ? (v >= 0 ? 'end' : 'start') : v >= 0 ? 'top' : 'bottom', stacked);
				ctx.fill();
				ctx.globalAlpha = 1;
				regions.push({ kind: 'rect', category: c, series: s, x, y, w, h });
				if (spec.labels && state.progress === 1 && !stacked && thickness >= 14) {
					setFont(ctx, theme, 10.5, 600);
					ctx.fillStyle = theme.text;
					ctx.textAlign = horizontal ? 'left' : 'center';
					ctx.textBaseline = horizontal ? 'middle' : 'bottom';
					if (horizontal) ctx.fillText(formatCompact(v), x + w + 4, y + h / 2);
					else ctx.fillText(formatCompact(v), x + w / 2, y - 3);
				}
			});
		}
		return { regions };
	}

	// Lines, areas and scatter.
	const xyScatter = spec.type === 'scatter' && data.series.length > 1;
	let xScale = pointX;
	if (xyScatter) {
		const xs = data.series[0].values;
		const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), Math.max(2, Math.round(plotW / 90)));
		const xlo = xTicks[0];
		const xhi = xTicks[xTicks.length - 1];
		xScale = (i: number) => left + ((xs[i] - xlo) / (xhi - xlo)) * plotW;
		ctx.fillStyle = theme.text;
		ctx.globalAlpha = 0.6;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		setFont(ctx, theme, 11);
		for (const t of xTicks) ctx.fillText(formatCompact(t), left + ((t - xlo) / (xhi - xlo)) * plotW, bottom + 6);
		ctx.globalAlpha = 1;
	}
	const plotted = xyScatter ? data.series.slice(1) : data.series;
	const stack = new Array(n).fill(0);
	const indexes = (values: number[]) =>
		n > plotW * 1.5 && !xyScatter
			? lttb(
					values.map((_, i) => i),
					values,
					Math.round(plotW)
				)
			: values.map((_, i) => i);
	plotted.forEach((series, sIndex) => {
		const s = xyScatter ? sIndex + 1 : sIndex;
		const keep = indexes(series.values);
		const below = keep.map((i) => stack[i]);
		const points: [number, number][] = keep.map((i, k) => {
			const v = (series.values[i] ?? 0) + (spec.stacked && spec.type === 'area' ? below[k] : 0);
			return [xScale(i), grow(v)];
		});
		if (spec.type === 'scatter') {
			points.forEach(([x, y], k) => {
				ctx.globalAlpha = alphaFor(state, keep[k]) * 0.85;
				ctx.fillStyle = series.color;
				ctx.beginPath();
				ctx.arc(x, y, 3.5, 0, Math.PI * 2);
				ctx.fill();
				regions.push({ kind: 'point', category: keep[k], series: s, x, y });
			});
			ctx.globalAlpha = 1;
			return;
		}
		if (spec.type === 'area') {
			const floor: [number, number][] = spec.stacked
				? keep.map((i, k) => [xScale(i), grow(below[k])] as [number, number]).reverse()
				: [
						[points[points.length - 1][0], base],
						[points[0][0], base],
					];
			const gradient = ctx.createLinearGradient(0, top, 0, bottom);
			gradient.addColorStop(0, withAlpha(series.color, 0.42));
			gradient.addColorStop(1, withAlpha(series.color, 0.04));
			ctx.beginPath();
			tracePath(ctx, points, !!spec.smooth);
			if (spec.stacked) tracePath(ctx, floor, !!spec.smooth, false);
			else for (const [x, y] of floor) ctx.lineTo(x, y);
			ctx.closePath();
			ctx.fillStyle = gradient;
			ctx.fill();
			if (spec.stacked) keep.forEach((i) => (stack[i] += series.values[i] ?? 0));
		}
		ctx.beginPath();
		tracePath(ctx, points, !!spec.smooth);
		ctx.strokeStyle = series.color;
		ctx.lineWidth = 2;
		ctx.lineJoin = 'round';
		ctx.stroke();
		if (keep.length <= 60) {
			points.forEach(([x, y], k) => {
				ctx.beginPath();
				ctx.arc(x, y, state.focus === keep[k] ? 4.5 : 2.5, 0, Math.PI * 2);
				ctx.fillStyle = state.focus === keep[k] ? series.color : theme.background;
				ctx.fill();
				ctx.lineWidth = 2;
				ctx.strokeStyle = series.color;
				ctx.stroke();
				if (spec.labels && state.progress === 1) {
					setFont(ctx, theme, 10.5, 600);
					ctx.fillStyle = theme.text;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'bottom';
					ctx.fillText(formatCompact(series.values[keep[k]]), x, y - 6);
				}
			});
		}
	});
	// The focused category: a guide line.
	if (state.focus !== null && !xyScatter && state.focus < n) {
		const x = Math.round(xScale(state.focus)) + 0.5;
		ctx.strokeStyle = theme.text;
		ctx.globalAlpha = 0.25;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(x, top);
		ctx.lineTo(x, bottom);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}
	const categoryAt = xyScatter
		? undefined
		: (x: number) => {
				if (x < left - 8 || x > right + 8) return null;
				return Math.max(0, Math.min(n - 1, Math.round(((x - left) / plotW) * (n - 1))));
			};
	return { regions, categoryAt };
}

function withAlpha(color: string, alpha: number): string {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
	if (!hex) return color;
	const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
	return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

/** A bar with its outer end rounded. */
function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	end: 'top' | 'bottom' | 'start' | 'end',
	square: boolean
) {
	ctx.beginPath();
	const radius = square ? Math.min(r, 2) : Math.min(r, w / 2, h / 2);
	if (radius <= 0.5 || w < 2 || h < 2) {
		ctx.rect(x, y, w, h);
		return;
	}
	const tl = end === 'top' || end === 'start' ? radius : 0;
	const tr = end === 'top' || end === 'end' ? radius : 0;
	const br = end === 'bottom' || end === 'end' ? radius : 0;
	const bl = end === 'bottom' || end === 'start' ? radius : 0;
	ctx.moveTo(x + tl, y);
	ctx.lineTo(x + w - tr, y);
	ctx.arcTo(x + w, y, x + w, y + tr, tr);
	ctx.lineTo(x + w, y + h - br);
	ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
	ctx.lineTo(x + bl, y + h);
	ctx.arcTo(x, y + h, x, y + h - bl, bl);
	ctx.lineTo(x, y + tl);
	ctx.arcTo(x, y, x + tl, y, tl);
	ctx.closePath();
}

/** The mark at a point, if any. */
export function hitTest(result: DrawResult, x: number, y: number): { category: number; series: number } | null {
	for (let i = result.regions.length - 1; i >= 0; i--) {
		const r = result.regions[i];
		if (r.kind === 'rect' && x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.y - 1 && y <= r.y + r.h + 1) return r;
		if (r.kind === 'point' && (x - r.x) ** 2 + (y - r.y) ** 2 <= 49) return r;
		if (r.kind === 'arc') {
			const d = Math.hypot(x - r.cx, y - r.cy);
			if (d < r.r0 || d > r.r1) continue;
			let a = Math.atan2(y - r.cy, x - r.cx);
			if (a < -Math.PI / 2) a += Math.PI * 2;
			if (a >= r.a0 && a <= r.a1) return r;
		}
	}
	const category = result.categoryAt?.(x, y);
	return category === null || category === undefined ? null : { category, series: -1 };
}
