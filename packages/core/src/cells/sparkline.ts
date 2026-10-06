/**
 * Sparklines: a small SVG chart of a cell's numbers. It stretches to the column width (no layout
 * reads per cell), with strokes and markers kept crisp. Redraws only when the value changes.
 */
import type { DomCellRenderer } from '../columnDef.js';
import { formatCellNumber, parseCellNumber, type NumberCellOptions } from './format.js';
import { resolveCellColor, type CellColor } from './palette.js';
import { valueRenderer } from './renderers.js';

export interface SparklineCellOptions {
	/** line · area (line with a fading fill, default) · bar · winloss (up / down blocks). */
	type?: 'line' | 'area' | 'bar' | 'winloss';
	/** Series colour. Default: the theme accent. */
	color?: CellColor;
	/** `trend`: green when the last value is above the first, red when below. Default `fixed`. */
	colorBy?: 'fixed' | 'trend';
	/** Bars below zero and losses. Default: the theme danger colour. */
	negativeColor?: CellColor;
	/** `smooth` draws a curve through the points (never overshooting them). Default `linear`. */
	curve?: 'linear' | 'smooth';
	/** Dots on: the last point (default), the lowest and highest, every point, or none. */
	markers?: 'none' | 'last' | 'minmax' | 'all';
	/** A dashed guide at a value, the average, or zero. */
	reference?: number | 'average' | 'zero';
	/** Text after the chart: the last value (default), the change from first to last, or nothing. */
	label?: 'last' | 'change' | 'none';
	/** Number format of the label. */
	format?: NumberCellOptions | ((value: number) => string);
	/** Fixed y-axis bounds (comparable charts across rows); default each row's own range. */
	min?: number;
	max?: number;
	/** Chart height in px. Default 22. */
	height?: number;
	/** Line width in px. Default 1.5. */
	strokeWidth?: number;
}

/** Numbers from an array, a comma-separated string or `{ values }`; non-numbers are skipped. */
export function parseSparklineValues(value: unknown): number[] {
	const raw = Array.isArray(value)
		? value
		: value && typeof value === 'object' && Array.isArray((value as { values?: unknown }).values)
			? (value as { values: unknown[] }).values
			: typeof value === 'string'
				? value.split(',')
				: [];
	const out: number[] = [];
	for (const item of raw) {
		const n = parseCellNumber(item);
		if (n !== null) out.push(n);
	}
	return out;
}

const UP = '#22c55e';
const DOWN = 'var(--og-ct-danger)';
let nextGradientId = 0;

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** A path through points; `smooth` uses Catmull-Rom segments clamped so no curve overshoots. */
function linePath(points: [number, number][], smooth: boolean): string {
	if (points.length === 0) return '';
	let d = `M${f(points[0][0])},${f(points[0][1])}`;
	if (!smooth || points.length < 3) {
		for (let i = 1; i < points.length; i++) d += `L${f(points[i][0])},${f(points[i][1])}`;
		return d;
	}
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[Math.min(points.length - 1, i + 2)];
		const lo = Math.min(p1[1], p2[1]);
		const hi = Math.max(p1[1], p2[1]);
		const clamp = (y: number) => Math.min(hi, Math.max(lo, y));
		const c1x = p1[0] + (p2[0] - p0[0]) / 6;
		const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6);
		const c2x = p2[0] - (p3[0] - p1[0]) / 6;
		const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6);
		d += `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
	}
	return d;
}

export function createSparklineRenderer(options: SparklineCellOptions = {}): DomCellRenderer<any> {
	const type = options.type ?? 'area';
	const height = options.height ?? 22;
	const stroke = options.strokeWidth ?? 1.5;
	const markers = options.markers ?? 'last';
	const labelKind = options.label ?? 'last';
	const fixedColor = resolveCellColor(options.color) ?? 'var(--og-ct-accent)';
	const negative = resolveCellColor(options.negativeColor) ?? DOWN;
	const format = (n: number) =>
		typeof options.format === 'function'
			? options.format(n)
			: (formatCellNumber(n, options.format ?? { decimals: Math.abs(n) < 10 ? 1 : 0 }) ?? '');

	return valueRenderer((root) => {
		const chart = document.createElement('div');
		chart.className = 'og-ct-spark';
		chart.style.height = `${height}px`;
		const label = document.createElement('span');
		label.className = 'og-ct-spark-label';
		root.append(chart);
		if (labelKind !== 'none') root.append(label);
		const gradientId = `og-ct-spark-${++nextGradientId}`;

		return (value) => {
			const values = parseSparklineValues(value);
			chart.textContent = '';
			label.textContent = '';
			chart.removeAttribute('title');
			if (values.length === 0) return;

			const first = values[0];
			const last = values[values.length - 1];
			const color = options.colorBy === 'trend' ? (last > first ? UP : last < first ? DOWN : fixedColor) : fixedColor;
			let lo = options.min ?? Math.min(...values);
			let hi = options.max ?? Math.max(...values);
			if (type === 'bar' || type === 'winloss' || options.reference === 'zero') {
				lo = Math.min(lo, 0);
				hi = Math.max(hi, 0);
			}
			if (hi === lo) {
				hi += 1;
				lo -= 1;
			}
			const pad = Math.max(2, stroke + 1);
			const y = (v: number) => pad + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (height - pad * 2);
			const n = values.length;
			const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);

			let body = '';
			if (type === 'bar' || type === 'winloss') {
				const band = 100 / n;
				const width = band * (n > 40 ? 0.85 : 0.7);
				const zero = type === 'winloss' ? height / 2 : y(0);
				values.forEach((v, i) => {
					const left = i * band + (band - width) / 2;
					let top: number;
					let h: number;
					if (type === 'winloss') {
						h = v === 0 ? 1 : height / 2 - pad;
						top = v > 0 ? zero - h : v < 0 ? zero : zero - 0.5;
					} else {
						top = Math.min(y(v), zero);
						h = Math.max(1, Math.abs(y(v) - zero));
					}
					const fill = v < 0 ? negative : color;
					body += `<rect x="${f(left)}" y="${f(top)}" width="${f(width)}" height="${f(h)}" rx="0.6" fill="${fill}" fill-opacity="${v === 0 ? 0.35 : 0.9}"/>`;
				});
			} else {
				const points = values.map((v, i) => [x(i), y(v)] as [number, number]);
				const line = linePath(points, options.curve === 'smooth');
				if (type === 'area') {
					body += `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".32"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>`;
					body += `<path d="${line}L${f(x(n - 1))},${height}L${f(x(0))},${height}Z" fill="url(#${gradientId})" stroke="none"/>`;
				}
				body += `<path d="${line}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
			}

			if (options.reference !== undefined) {
				const ref =
					options.reference === 'average' ? values.reduce((a, b) => a + b, 0) / n : options.reference === 'zero' ? 0 : options.reference;
				const ry = type === 'winloss' ? height / 2 : y(ref);
				body =
					`<line x1="0" x2="100" y1="${f(ry)}" y2="${f(ry)}" stroke="currentColor" stroke-opacity=".35" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" class="og-ct-spark-ref"/>` +
					body;
			}

			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('viewBox', `0 0 100 ${height}`);
			svg.setAttribute('preserveAspectRatio', 'none');
			svg.setAttribute('width', '100%');
			svg.setAttribute('height', String(height));
			svg.setAttribute('aria-hidden', 'true');
			svg.style.color = color;
			svg.innerHTML = body;
			chart.appendChild(svg);

			// Markers are HTML dots placed in percent, so they stay round however the chart stretches.
			if (type === 'line' || type === 'area') {
				const marked = new Set<number>();
				if (markers === 'all') values.forEach((_, i) => marked.add(i));
				if (markers === 'last') marked.add(n - 1);
				if (markers === 'minmax') {
					marked.add(values.indexOf(Math.min(...values)));
					marked.add(values.indexOf(Math.max(...values)));
				}
				for (const i of marked) {
					const dot = document.createElement('i');
					dot.className = 'og-ct-spark-dot';
					dot.style.left = `${x(i)}%`;
					dot.style.top = `${y(values[i])}px`;
					dot.style.background = markers === 'minmax' ? (values[i] === Math.max(...values) ? UP : DOWN) : color;
					chart.appendChild(dot);
				}
			}

			chart.title = `${n} points · min ${format(Math.min(...values))} · max ${format(Math.max(...values))} · last ${format(last)}`;
			if (labelKind === 'last') label.textContent = format(last);
			else if (labelKind === 'change') {
				const change = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
				label.textContent = `${change > 0 ? '+' : ''}${change.toFixed(Math.abs(change) < 10 ? 1 : 0)}%`;
				label.style.color = change > 0 ? UP : change < 0 ? DOWN : '';
			}
		};
	});
}
