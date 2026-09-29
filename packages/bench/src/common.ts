/**
 * Shared bench-page harness: identical data and scenario shape for both grids, plus in-page
 * measurement. The runner (run.mjs) drives real mouse-wheel input through Chrome and calls
 * window.bench.start()/stop() around it.
 */

export interface Scenario {
	rows: number;
	cols: number;
	/** Columns rendered by a custom DOM renderer (a bar + label), counted from the left. */
	domCols: number;
}

export function readScenario(): Scenario {
	const q = new URLSearchParams(location.search);
	return { rows: Number(q.get('rows') ?? 100_000), cols: Number(q.get('cols') ?? 50), domCols: Number(q.get('domCols') ?? 0) };
}

export type BenchRow = { id: string } & Record<string, string | number>;

export function makeRows(scenario: Scenario): BenchRow[] {
	const rows: BenchRow[] = new Array(scenario.rows);
	for (let r = 0; r < scenario.rows; r++) {
		const row: BenchRow = { id: `r${r}` };
		for (let c = 0; c < scenario.cols; c++) row[`c${c}`] = c % 3 === 0 ? `R${r}C${c}` : (r * 31 + c * 17) % 1000;
		rows[r] = row;
	}
	return rows;
}

/** A tiny DOM cell renderer both grids share: a proportional bar plus the value as text. */
export function paintBar(bar: HTMLElement, label: HTMLElement, value: unknown): void {
	const n = typeof value === 'number' ? value : 0;
	bar.style.width = `${n / 10}%`;
	label.textContent = String(value ?? '');
}

export function createBarElements(container: HTMLElement): { bar: HTMLElement; label: HTMLElement } {
	container.style.position = 'relative';
	const bar = document.createElement('div');
	bar.style.cssText = 'position:absolute;left:0;top:25%;height:50%;background:#4f8cff55;';
	const label = document.createElement('span');
	label.style.cssText = 'position:relative;';
	container.append(bar, label);
	return { bar, label };
}

interface Measurement {
	frames: number[];
	longTasks: number[];
	coverage: number[];
	running: boolean;
}

/**
 * Frame intervals from a rAF loop, long tasks from PerformanceObserver, and blank-area samples:
 * the fraction of the scroll viewport's height covered by rendered rows. Coverage forces layout,
 * so it is sampled only every 12th frame and the frame after a sample is excluded from timing.
 */
export function installMeasurement(options: {
	viewport: () => HTMLElement | null;
	/** Sticky header inside the scroller: its area is excluded (rows never cover it). */
	header: () => HTMLElement | null;
	rows: () => ArrayLike<HTMLElement>;
}): void {
	const m: Measurement = { frames: [], longTasks: [], coverage: [], running: false };
	let observer: PerformanceObserver | null = null;

	function sampleCoverage(): number {
		const viewport = options.viewport();
		if (!viewport) return 0;
		const viewportBox = viewport.getBoundingClientRect();
		const headerBottom = options.header()?.getBoundingClientRect().bottom ?? viewportBox.top;
		const box = { top: Math.max(viewportBox.top, headerBottom), bottom: viewportBox.bottom, height: 0 };
		box.height = box.bottom - box.top;
		const spans: Array<[number, number]> = [];
		const rows = options.rows();
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (row.style.visibility === 'hidden' || row.style.display === 'none') continue;
			const r = row.getBoundingClientRect();
			const top = Math.max(r.top, box.top);
			const bottom = Math.min(r.bottom, box.bottom);
			if (bottom > top && row.childElementCount > 0) spans.push([top, bottom]);
		}
		spans.sort((a, b) => a[0] - b[0]);
		let covered = 0;
		let end = box.top;
		for (const [top, bottom] of spans) {
			if (bottom <= end) continue;
			covered += bottom - Math.max(top, end);
			end = bottom;
		}
		return box.height > 0 ? covered / box.height : 0;
	}

	(window as unknown as { bench: unknown }).bench = {
		start() {
			m.frames = [];
			m.longTasks = [];
			m.coverage = [];
			m.running = true;
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) m.longTasks.push(entry.duration);
			});
			try {
				observer.observe({ entryTypes: ['longtask'] });
			} catch {
				observer = null;
			}
			let last = performance.now();
			let frame = 0;
			let skipNext = false;
			const tick = (now: number) => {
				if (!m.running) return;
				if (!skipNext) m.frames.push(now - last);
				skipNext = false;
				last = now;
				if (++frame % 12 === 0) {
					m.coverage.push(sampleCoverage());
					skipNext = true;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame((now) => {
				last = now;
				requestAnimationFrame(tick);
			});
		},
		stop() {
			m.running = false;
			observer?.disconnect();
			return { frames: m.frames, longTasks: m.longTasks, coverage: m.coverage };
		},
		scrollInfo() {
			const viewport = options.viewport();
			return viewport
				? { top: viewport.scrollTop, left: viewport.scrollLeft, height: viewport.scrollHeight, width: viewport.scrollWidth }
				: null;
		},
	};
}

export function markReady(): void {
	(window as unknown as { benchReady: boolean }).benchReady = true;
}
