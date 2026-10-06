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

/** Values a tick scenario has edited, by `<rowId>/<colId>`: the cell's current value from then on. */
const editedValues = new Map<string, string | number>();

/**
 * For each edited cell, its value before the latest edit and the fidelity sample count when that edit
 * was handed to the grid. An edit can land after the grid's frame but before that frame's sample, and
 * no renderer can draw data before it has it: such a cell may show its previous value in exactly the
 * first sample after the edit. One sample later it must be current; anything older is stale.
 */
const editLag = new Map<string, { previous: string | number; sample: number }>();
let fidelitySampleCount = 0;

/** The value a cell holds: its edited value, else what makeRows put there from its ids (`r<row>`, `c<col>`). */
function cellValue(rowId: string, colId: string): string | number {
	const edited = editedValues.get(`${rowId}/${colId}`);
	if (edited !== undefined) return edited;
	const r = Number(rowId.slice(1));
	const c = Number(colId.slice(1));
	return c % 3 === 0 ? `R${r}C${c}` : (r * 31 + c * 17) % 1000;
}

/** What a fully drawn cell shows: its text, plus the bar's width for renderer columns. */
/** ?fmt=1: numeric columns carry a valueFormatter (`$<value>`) in both grids. */
export const formatNumbers = new URLSearchParams(location.search).get('fmt') === '1';
export function formatBenchValue(value: unknown): string {
	return `$${String(value)}`;
}

/**
 * ?styled=1: a cell style rule marks every numeric cell above 500 with `bench-hot`, and fidelity
 * judges the class too: a decorated cell must show its decoration, not only its text.
 */
export const styledCells = new URLSearchParams(location.search).get('styled') === '1';
export const HOT_CLASS = 'bench-hot';
export const isHotValue = (value: unknown): boolean => typeof value === 'number' && value > 500;

export function expectedSignature(rowId: string, colId: string, domCols: number, value = cellValue(rowId, colId)): string {
	const base = expectedContentSignature(colId, domCols, value);
	return styledCells && isHotValue(value) ? `${base}|hot` : base;
}

function expectedContentSignature(colId: string, domCols: number, value: string | number): string {
	if (formatNumbers && typeof value === 'number' && Number(colId.slice(1)) >= domCols) return formatBenchValue(value);
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
	/** Wrong cells by kind: nothing shown; the right text without the renderer's output; anything else (stale, another row's). */
	blank: number;
	incomplete: number;
	otherContent: number;
	/** ms from the last input until the first frame with every visible cell final (-1: never). */
	settleMs: number;
	/** Edited cells showing their previous value in the first sample after the edit (allowed; see editLag). */
	editLag: number;
	wrongExamples: string[];
	otherExamples: string[];
}

const emptyFidelity = (): FidelityStats => ({
	frames: 0,
	cellFrames: 0,
	wrongCells: 0,
	framesWithWrong: 0,
	changes: 0,
	blank: 0,
	incomplete: 0,
	otherContent: 0,
	settleMs: -1,
	editLag: 0,
	wrongExamples: [],
	otherExamples: [],
});

/** A signature without its bar-width segment (`|<n>%`): what a stand-in shows. */
const withoutBar = (signature: string): string => signature.replace(/\|[\d.]+%/, '');

/** Visible text plus the visible bar's width: what a viewer actually sees in the cell. */
function readSignature(cell: HTMLElement): string {
	const text = cell.innerText.trim();
	const bar = cell.querySelector<HTMLElement>('.bench-bar');
	const content = bar && bar.getClientRects().length > 0 ? `${text}|${bar.style.width}` : text;
	return styledCells && cell.classList.contains(HOT_CLASS) ? `${content}|hot` : content;
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
	let inputEndedAt = -1;

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
		fidelitySampleCount++;
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
				// Data cells only: group/total rows and the grouping column have no bench value to judge.
				if (!rowId || !colId || !/^r\d+$/.test(rowId) || !/^c\d+$/.test(colId)) continue;
				const key = `${rowId}/${colId}`;
				const signature = readSignature(cell);
				seen.set(key, signature);
				stats.cellFrames++;
				const expected = expectedSignature(rowId, colId, domCols);
				const lag = signature === expected ? undefined : editLag.get(key);
				if (lag && fidelitySampleCount === lag.sample + 1 && signature === expectedSignature(rowId, colId, domCols, lag.previous)) {
					stats.editLag++;
				} else if (signature !== expected) {
					wrong++;
					if (signature === '') stats.blank++;
					// Incomplete: the right text (and decoration) without the renderer's bar.
					else if (signature === withoutBar(expected)) stats.incomplete++;
					else stats.otherContent++;
					const example = `${key}: ${JSON.stringify(signature)} (expected ${JSON.stringify(expected)})`;
					if (stats.wrongExamples.length < 8) stats.wrongExamples.push(example);
					// Stale or another row's content is the kind that matters: keep its examples apart.
					if (signature !== '' && signature !== withoutBar(expected) && stats.otherExamples.length < 8) stats.otherExamples.push(example);
				}
				const previous = lastSeen.get(key);
				if (previous !== undefined && previous !== signature) stats.changes++;
			}
		}
		lastSeen = seen;
		stats.frames++;
		stats.wrongCells += wrong;
		if (wrong > 0) stats.framesWithWrong++;
		if (inputEndedAt >= 0 && stats.settleMs < 0 && wrong === 0) stats.settleMs = performance.now() - inputEndedAt;
		else if (inputEndedAt >= 0 && wrong > 0) stats.settleMs = -1;
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
			inputEndedAt = -1;
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
		/** The runner sent its last input: fidelity measures how long the grid takes to settle from here. */
		markInputEnd() {
			inputEndedAt = performance.now();
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

/**
 * Tick scenarios: each tick hands the grid a new rows array in which one visible row is an edited
 * copy — what a React app does with immutable state. `replace` gives the array to the grid.
 * `pickRow` chooses the edited row's index (default: one of the first 12, in view at rest); the
 * edit is recorded so fidelity judges cells against their current value.
 */
export function installTicker(initial: BenchRow[], replace: (rows: BenchRow[]) => void, pickRow?: (i: number) => number): void {
	let rows = initial;
	(window as unknown as { benchTick: (i: number) => void }).benchTick = (i: number) => {
		const k = pickRow?.(i) ?? i % 12;
		const next = rows.slice();
		const value = (Number(rows[k].c1) + 1) % 1000;
		next[k] = { ...rows[k], c1: value };
		editLag.set(`${rows[k].id}/c1`, { previous: rows[k].c1, sample: fidelitySampleCount });
		editedValues.set(`${rows[k].id}/c1`, value);
		rows = next;
		replace(next);
	};
}

/** A row in the middle of the viewport: its index, read from the rendered rows' cells. */
export function middleVisibleRowIndex(rowsSelector: string): number | undefined {
	const rows = document.querySelectorAll<HTMLElement>(rowsSelector);
	const viewportMiddle = window.innerHeight / 2;
	for (const row of rows) {
		const box = row.getBoundingClientRect();
		if (box.top <= viewportMiddle && box.bottom >= viewportMiddle) {
			const id = row.querySelector<HTMLElement>('.og-cell')?.dataset.rowId;
			if (id) return Number(id.slice(1));
		}
	}
	return undefined;
}

export function markReady(): void {
	(window as unknown as { benchReady: boolean }).benchReady = true;
}
