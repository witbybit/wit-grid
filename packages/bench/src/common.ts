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

/** The value makeRows puts in a cell, from its ids alone (`r<row>`, `c<col>`). */
function cellValue(rowId: string, colId: string): string | number {
	const r = Number(rowId.slice(1));
	const c = Number(colId.slice(1));
	return c % 3 === 0 ? `R${r}C${c}` : (r * 31 + c * 17) % 1000;
}

/** What a fully drawn cell shows: its text, plus the bar's width for renderer columns. */
export function expectedSignature(rowId: string, colId: string, domCols: number): string {
	const value = cellValue(rowId, colId);
	return Number(colId.slice(1)) < domCols ? `${value}|${(typeof value === 'number' ? value : 0) / 10}%` : String(value);
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
/** Renderer call counters, so a run can report mounts vs in-place updates for each grid. */
export const rendererCalls = { mounts: 0, updates: 0 };
(window as unknown as { rendererCalls: typeof rendererCalls }).rendererCalls = rendererCalls;

export function paintBar(bar: HTMLElement, label: HTMLElement, value: unknown): void {
	const n = typeof value === 'number' ? value : 0;
	bar.style.width = `${n / 10}%`;
	label.textContent = String(value ?? '');
}

export function createBarElements(container: HTMLElement): { bar: HTMLElement; label: HTMLElement } {
	rendererCalls.mounts++;
	container.style.position = 'relative';
	const bar = document.createElement('div');
	bar.className = 'bench-bar';
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
	fidelity: FidelityStats;
}

/**
 * Fidelity mode (?fidelity=1): what every visible cell shows, compared with what it should show,
 * after every frame. `wrongCells` counts cell-frames showing anything but the final content (a
 * placeholder, raw or blank text, a missing bar, another row's content); `changes` counts a cell
 * whose content changed between consecutive frames while it stayed in view — flicker, since the
 * bench data never changes. Reading it forces layout every frame, so timings from such a run are
 * not comparable and the runner keeps them apart.
 */
interface FidelityStats {
	frames: number;
	cellFrames: number;
	wrongCells: number;
	framesWithWrong: number;
	changes: number;
	wrongExamples: string[];
}

const emptyFidelity = (): FidelityStats => ({ frames: 0, cellFrames: 0, wrongCells: 0, framesWithWrong: 0, changes: 0, wrongExamples: [] });

/** Visible text plus the visible bar's width: what a viewer actually sees in the cell. */
function readSignature(cell: HTMLElement): string {
	const text = cell.innerText.trim();
	const bar = cell.querySelector<HTMLElement>('.bench-bar');
	return bar && bar.getClientRects().length > 0 ? `${text}|${bar.style.width}` : text;
}

/**
 * Frame intervals from a rAF loop, long tasks from PerformanceObserver, and blank-area samples:
 * the fraction of the body (below the sticky header) covered by rendered rows, taken after the
 * frame's work so both grids are judged on what they actually drew for their scroll position.
 * Coverage forces layout, so it is sampled only every 12th frame and the frame after a sample is
 * excluded from timing. It measures main-thread rendering, not compositor-only checkerboarding.
 */
export function installMeasurement(options: {
	viewport: () => HTMLElement | null;
	/** Sticky header inside the scroller: its area is excluded (rows never cover it). */
	header: () => HTMLElement | null;
	rows: () => ArrayLike<HTMLElement>;
	/** Fidelity mode: the cells of a row, and a cell's row and column ids. */
	cells: (row: HTMLElement) => ArrayLike<HTMLElement>;
	cellIds: (cell: HTMLElement, row: HTMLElement) => { rowId: string | null; colId: string | null };
}): void {
	const m: Measurement = { frames: [], longTasks: [], coverage: [], running: false, fidelity: emptyFidelity() };
	let observer: PerformanceObserver | null = null;
	const fidelityMode = new URLSearchParams(location.search).get('fidelity') === '1';
	const domCols = readScenario().domCols;
	let lastSeen = new Map<string, string>();

	function bodyBox() {
		const viewport = options.viewport();
		if (!viewport) return null;
		const viewportBox = viewport.getBoundingClientRect();
		const headerBottom = options.header()?.getBoundingClientRect().bottom ?? viewportBox.top;
		return { top: Math.max(viewportBox.top, headerBottom), bottom: viewportBox.bottom, left: viewportBox.left, right: viewportBox.right };
	}

	function sampleFidelity(stats: FidelityStats): void {
		const box = bodyBox();
		if (!box) return;
		const seen = new Map<string, string>();
		let wrong = 0;
		const rows = options.rows();
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			const r = row.getBoundingClientRect();
			// Fully inside the body: a row half under the header is judged by its visible half otherwise.
			if (r.height === 0 || r.top < box.top || r.bottom > box.bottom) continue;
			const cells = options.cells(row);
			for (let j = 0; j < cells.length; j++) {
				const cell = cells[j];
				const c = cell.getBoundingClientRect();
				if (c.width === 0 || c.left < box.left || c.right > box.right) continue;
				const { rowId, colId } = options.cellIds(cell, row);
				if (!rowId || !colId) continue;
				const key = `${rowId}/${colId}`;
				const signature = readSignature(cell);
				seen.set(key, signature);
				stats.cellFrames++;
				const expected = expectedSignature(rowId, colId, domCols);
				if (signature !== expected) {
					wrong++;
					if (stats.wrongExamples.length < 8)
						stats.wrongExamples.push(`${key}: ${JSON.stringify(signature)} (expected ${JSON.stringify(expected)})`);
				}
				const previous = lastSeen.get(key);
				if (previous !== undefined && previous !== signature) stats.changes++;
			}
		}
		lastSeen = seen;
		stats.frames++;
		stats.wrongCells += wrong;
		if (wrong > 0) stats.framesWithWrong++;
	}

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
			m.fidelity = emptyFidelity();
			lastSeen = new Map();
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
				if (fidelityMode) {
					// After this frame's work, like coverage below.
					setTimeout(() => {
						if (m.running) sampleFidelity(m.fidelity);
					}, 0);
				} else if (++frame % 12 === 0) {
					// Sample after this frame's work: rAF callbacks run in registration order, so sampling
					// here directly would run before a grid that renders in its own rAF and count its
					// not-yet-drawn rows as blank (a grid rendering inside the scroll event would not be).
					setTimeout(() => {
						if (m.running) m.coverage.push(sampleCoverage());
					}, 0);
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
			return { frames: m.frames, longTasks: m.longTasks, coverage: m.coverage, fidelity: m.fidelity };
		},
		/** Fidelity of the grid at rest: after the scroll has settled every visible cell must be right. */
		restFidelity() {
			const stats = emptyFidelity();
			lastSeen = new Map();
			sampleFidelity(stats);
			return stats;
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
