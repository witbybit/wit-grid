/** Axis ticks, tick labels, downsampling and curves for the canvas charts. */

/** Round tick values covering [min, max] (about `count` of them). */
export function niceTicks(min: number, max: number, count = 5): number[] {
	if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
	if (min === max) {
		const pad = Math.abs(min) || 1;
		min -= pad;
		max += pad;
	}
	const span = max - min;
	const raw = span / Math.max(1, count);
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
	const start = Math.floor(min / step) * step;
	const end = Math.ceil(max / step) * step;
	const ticks: number[] = [];
	for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12)));
	return ticks;
}

/** 1.2k, 3.4M, 0.25 — short tick and label text. */
export function formatCompact(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1e9) return `${trim(value / 1e9)}B`;
	if (abs >= 1e6) return `${trim(value / 1e6)}M`;
	if (abs >= 1e4) return `${trim(value / 1e3)}k`;
	if (abs >= 100 || Number.isInteger(value)) return Math.round(value).toLocaleString();
	return trim(value, abs < 1 ? 3 : 2);
}

function trim(value: number, digits = 1): string {
	return Number(value.toFixed(digits)).toString();
}

/**
 * Largest-Triangle-Three-Buckets: at most `threshold` points that keep a series' shape, so a line
 * of 100k values draws as fast as one of a thousand.
 */
export function lttb(xs: readonly number[], ys: readonly number[], threshold: number): number[] {
	const n = ys.length;
	if (threshold >= n || threshold < 3) return ys.map((_, i) => i);
	const out: number[] = [0];
	const every = (n - 2) / (threshold - 2);
	let a = 0;
	for (let i = 0; i < threshold - 2; i++) {
		const nextStart = Math.floor((i + 1) * every) + 1;
		const nextEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
		let avgX = 0;
		let avgY = 0;
		for (let j = nextStart; j < nextEnd; j++) {
			avgX += xs[j];
			avgY += ys[j];
		}
		const span = Math.max(1, nextEnd - nextStart);
		avgX /= span;
		avgY /= span;
		const start = Math.floor(i * every) + 1;
		const end = Math.floor((i + 1) * every) + 1;
		let best = start;
		let bestArea = -1;
		for (let j = start; j < end; j++) {
			const area = Math.abs((xs[a] - avgX) * (ys[j] - ys[a]) - (xs[a] - xs[j]) * (avgY - ys[a]));
			if (area > bestArea) {
				bestArea = area;
				best = j;
			}
		}
		out.push(best);
		a = best;
	}
	out.push(n - 1);
	return out;
}

/** Traces a line through the points on a canvas path; `smooth` curves it without overshooting (monotone). */
export function tracePath(ctx: CanvasRenderingContext2D, points: readonly [number, number][], smooth: boolean, moveFirst = true): void {
	if (points.length === 0) return;
	const [x0, y0] = points[0];
	if (moveFirst) ctx.moveTo(x0, y0);
	else ctx.lineTo(x0, y0);
	if (!smooth || points.length < 3) {
		for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
		return;
	}
	const n = points.length;
	const slopes: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		const dx = points[i + 1][0] - points[i][0];
		slopes.push(dx === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx);
	}
	const tangents: number[] = [slopes[0]];
	for (let i = 1; i < n - 1; i++) tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
	tangents.push(slopes[n - 2]);
	for (let i = 0; i < n - 1; i++) {
		const [xa, ya] = points[i];
		const [xb, yb] = points[i + 1];
		const dx = (xb - xa) / 3;
		ctx.bezierCurveTo(xa + dx, ya + tangents[i] * dx, xb - dx, yb - tangents[i + 1] * dx, xb, yb);
	}
}
