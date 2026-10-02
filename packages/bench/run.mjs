// Real-browser scroll benchmark: Wit Grid vs AG Grid, driven through the locally installed Chrome
// with genuine mouse-wheel input (compositor scroll path, not scripted scrollTop).
//
//   pnpm bench:browser                          # all scenarios, both grids, headless, 5 paired rounds
//   pnpm bench:browser --headed                 # watch it
//   pnpm bench:browser --only=vertical-text --runs=9 --grid=wit
//   pnpm bench:browser --publish                # also update the docs comparison page's data
//   pnpm bench:browser --fidelity               # what visible cells show each frame (flicker), not timing
//
// Method: each round runs both grids back to back on the same scenario, alternating which goes
// first, so machine drift (thermals, background load) hits both equally. Per metric we report the
// median and min-max across rounds, plus the per-round Wit/AG ratio of main-thread time, which is
// the number to compare. Absolute numbers depend on this machine; ratios travel better.
// Results go to packages/bench/results/<timestamp>.json and results/latest.json.
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
const args = Object.fromEntries(
	process.argv.slice(2).map((arg) => {
		const [key, value] = arg.replace(/^--/, '').split('=');
		return [key, value ?? true];
	})
);
const runs = Number(args.runs ?? 5);
// --css=<variant> forwards an experimental CSS override to the Wit Grid page (see src/wit.ts).
const cssVariant = args.css;
const grids = args.grid ? [args.grid] : ['wit', 'ag'];
// --trace records Chrome's devtools.timeline trace and reports what each layout touched
// (layout objects dirtied, objects in the tree, forced layouts) and why elements were restyled
// or re-laid out. Counts, not time: tracing itself costs main-thread time, so trace runs are for
// diagnosis, never for the ratio. The counts are only deterministic where the grid's behaviour
// does not depend on time: the DOM-update budget (rendererOptions.domUpdate.maxMsPerFrame) is
// time-based, so under tracing it defers far more DOM-renderer cells than in a normal run and
// the DOM-renderer scenario's counts describe a slower grid, not the real one.
const traceLayouts = Boolean(args.trace);
// --fidelity compares every visible cell with its final content after every frame: placeholders,
// blanks, another row's content, and content changing while in view (flicker). It forces layout
// each frame, so its timings are meaningless; results go to results/fidelity-*.json, never latest.json.
const fidelity = Boolean(args.fidelity);

const SCENARIOS = [
	{
		name: 'vertical-text',
		title: 'Vertical scroll, plain text',
		description: '100,000 rows x 50 text columns; 150 wheel events of 360px down, then back up.',
		query: { rows: 100_000, cols: 50, domCols: 0 },
		wheel: { dy: 360, events: 150 },
	},
	{
		name: 'vertical-dom-renderers',
		title: 'Vertical scroll, custom DOM renderers',
		description: 'Same grid with 10 columns drawn by a custom renderer (a bar and a label); each grid uses its own default renderer path.',
		query: { rows: 100_000, cols: 50, domCols: 10 },
		wheel: { dy: 360, events: 150 },
	},
	{
		name: 'horizontal-200-cols',
		title: 'Horizontal scroll, 200 columns',
		description: '100,000 rows x 200 text columns; 150 wheel events of 300px right, then back left.',
		query: { rows: 100_000, cols: 200, domCols: 0 },
		wheel: { dx: 300, events: 150 },
	},
	{
		name: 'vertical-fast-fling',
		title: 'Very fast fling',
		description: '90 wheel events of 2,400px, close to dragging the scrollbar; stresses blank area.',
		query: { rows: 100_000, cols: 50, domCols: 0 },
		wheel: { dy: 2400, events: 90 },
	},
	{
		name: 'vertical-formatted',
		title: 'Vertical scroll, formatted numbers',
		description: 'The plain-text grid with a valueFormatter on every numeric column ($<value>).',
		query: { rows: 100_000, cols: 50, domCols: 0, fmt: 1 },
		wheel: { dy: 360, events: 150 },
	},
	{
		name: 'vertical-react-renderers',
		title: 'Vertical scroll, React cell renderers',
		description:
			'The DOM-renderer grid through the React adapter, with React component cells (default scroll presentation). Wit only: fidelity runs.',
		query: { rows: 100_000, cols: 50, domCols: 10 },
		wheel: { dy: 360, events: 150 },
		grids: ['wit-react'],
		fidelityOnly: true,
	},
	{
		name: 'vertical-react-getters',
		title: 'Vertical scroll, React cells over valueGetters',
		description: 'The React cell grid with every renderer column read through a valueGetter. Wit only: fidelity runs.',
		query: { rows: 100_000, cols: 50, domCols: 10, getters: 1 },
		wheel: { dy: 360, events: 150 },
		grids: ['wit-react'],
		fidelityOnly: true,
	},
]
	.filter((s) => !args.only || s.name === args.only)
	// Fidelity-only scenarios have no AG counterpart; they still time on request (--only=<name>), Wit alone.
	.filter((s) => fidelity || !s.fidelityOnly || args.only === s.name);

async function bundle() {
	mkdirSync(out, { recursive: true });
	await build({
		entryPoints: { wit: join(here, 'src/wit.ts'), ag: join(here, 'src/ag.ts'), 'wit-react': join(here, 'src/witReact.tsx') },
		outdir: out,
		bundle: true,
		format: 'iife',
		minify: true,
		target: 'es2022',
		define: { 'process.env.NODE_ENV': '"production"' },
		jsx: 'automatic',
		// One React (the adapter's), and the core from source like the plain Wit page.
		alias: {
			react: join(here, '../react/node_modules/react'),
			'react-dom': join(here, '../react/node_modules/react-dom'),
			'@eregister/wit-grid-core': join(here, '../core/src'),
		},
		logLevel: 'warning',
	});
	for (const grid of ['wit', 'ag', 'wit-react']) {
		writeFileSync(
			join(out, `${grid}.html`),
			`<!doctype html><html><head><meta charset="utf-8"><title>${grid}</title>
<style>html,body{margin:0;background:#fff;font:13px system-ui}#grid{width:1200px;height:640px}</style></head>
<body><div id="grid"></div><script src="./${grid}.js"></script></body></html>`
		);
	}
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

function summarize({ frames, longTasks, coverage }) {
	const sorted = [...frames].sort((a, b) => a - b);
	const median = quantile(sorted, 0.5);
	const mean = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
	return {
		frames: frames.length,
		meanMs: mean,
		p95Ms: quantile(sorted, 0.95),
		p99Ms: quantile(sorted, 0.99),
		maxMs: sorted[sorted.length - 1] ?? 0,
		// A frame taking more than 1.5x the typical interval missed at least one vsync.
		droppedPct: (100 * frames.filter((f) => f > median * 1.5).length) / Math.max(1, frames.length),
		longTasks: longTasks.length,
		longTaskMs: longTasks.reduce((a, b) => a + b, 0),
		minCoverage: coverage.length ? Math.min(...coverage) : 1,
		blankSamplesPct: (100 * coverage.filter((c) => c < 0.98).length) / Math.max(1, coverage.length),
	};
}

async function runOnce(browser, grid, scenario) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	const url = pathToFileURL(join(out, `${grid}.html`));
	for (const [key, value] of Object.entries(scenario.query)) url.searchParams.set(key, String(value));
	if (cssVariant && grid === 'wit') url.searchParams.set('css', cssVariant);
	if (fidelity) url.searchParams.set('fidelity', '1');
	// --react-mode=<live|html-snapshot|freeze> sets the React cells' scroll presentation (wit-react page).
	if (args['react-mode'] && grid === 'wit-react') url.searchParams.set('reactMode', args['react-mode']);
	if (args['react-mounts'] && grid === 'wit-react') url.searchParams.set('reactMounts', args['react-mounts']);
	await page.goto(url.href);
	await page.waitForFunction(() => window.benchReady === true, null, { timeout: 60_000 });
	await page.mouse.move(600, 360);
	await page.waitForTimeout(300);
	// Chrome's own main-thread counters (cumulative seconds) — independent of vsync pacing.
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const readMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
	const traceEvents = [];
	if (traceLayouts) {
		cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
		await cdp.send('Tracing.start', {
			categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking',
			transferMode: 'ReportEvents',
		});
	}
	const before = await readMetrics();
	if (traceLayouts) await page.evaluate(() => window.witHost?.resetRenderStats());
	await page.evaluate(() => window.bench.start());
	const { dx = 0, dy = 0, events } = scenario.wheel;
	const inputStart = performance.now();
	// Forward then back, like a user flinging through data and returning.
	for (let i = 0; i < events; i++) {
		const sign = i < events / 2 ? 1 : -1;
		await page.mouse.wheel(dx * sign, dy * sign);
		await page.waitForTimeout(16);
	}
	// page.mouse.wheel resolves once the page has handled the event, so time beyond the fixed
	// 16ms pacing is main-thread work spent handling that input.
	const inputOverheadMs = (performance.now() - inputStart) / events - 16;
	if (fidelity) await page.evaluate(() => window.bench.markInputEnd());
	await page.waitForTimeout(fidelity ? 1500 : 400);
	const raw = await page.evaluate(() => window.bench.stop());
	const after = await readMetrics();
	const rest = fidelity ? await page.evaluate(() => window.bench.restFidelity()) : null;
	if (traceLayouts) {
		const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
		await cdp.send('Tracing.end');
		await done;
	}
	const calls = await page.evaluate(() => window.rendererCalls);
	const writeStats = traceLayouts
		? await page.evaluate(() => {
				const stats = window.witHost?.getRenderStats();
				if (!stats) return {};
				const keys = [
					'cellTextWrites',
					'cellClassWrites',
					'cellTransformWrites',
					'cellWidthWrites',
					'cellLeftWrites',
					'rowClassWrites',
					'rowTransformWrites',
					'rowHeightWrites',
					'scrollFrames',
					'rowSlotRebinds',
					'cellSlotRebinds',
					'domUpdatesDuringScroll',
					'domUpdatesDeferredDuringScroll',
					'textImpostorUsesDuringScroll',
					'motionCellsDecoratedAfterScroll',
					'fidelityCellsDecoratedAfterScroll',
				];
				return Object.fromEntries(keys.map((k) => [`w_${k}`, stats[k] ?? 0]));
			})
		: {};
	if (traceLayouts && Object.keys(writeStats).length)
		process.stdout.write(`  ${grid} writes: ${JSON.stringify(writeStats)}
`);
	const census = traceLayouts
		? await page.evaluate(() => {
				const root = document.getElementById('grid');
				const rows = root.querySelectorAll('.og-rows-container > .og-row, .ag-row');
				const cells = root.querySelectorAll('.og-rows-container .og-cell, .ag-cell');
				const vp = root.querySelector('.og-scroll-viewport, .ag-body-viewport');
				return {
					domElements: root.getElementsByTagName('*').length,
					domRows: rows.length,
					domCells: cells.length,
					domElementsPerCell: cells.length
						? Array.from(cells).reduce((n, c) => n + c.getElementsByTagName('*').length + 1, 0) / cells.length
						: 0,
					viewportHeight: vp ? vp.clientHeight : 0,
				};
			})
		: {};
	await page.close();
	if (fidelity) return summarizeFidelity(raw.fidelity, rest, grid);
	const deltaMs = (name) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
	const delta = (name) => (after[name] ?? 0) - (before[name] ?? 0);
	return {
		...summarize(raw),
		inputOverheadMs,
		scriptMs: deltaMs('ScriptDuration'),
		layoutMs: deltaMs('LayoutDuration'),
		styleMs: deltaMs('RecalcStyleDuration'),
		// Counts separate "too many layouts" (a read after a write forcing an extra one per frame)
		// from "each layout too large" (missing containment).
		layoutCount: delta('LayoutCount'),
		styleCount: delta('RecalcStyleCount'),
		taskMs: deltaMs('TaskDuration'),
		mounts: calls.mounts,
		updates: calls.updates,
		...(traceLayouts ? summarizeLayoutTrace(traceEvents) : {}),
		...census,
	};
}

function summarizeFidelity(stats, rest, grid) {
	if (stats.wrongExamples.length)
		process.stdout.write(`  ${grid} wrong cells, e.g. ${stats.wrongExamples.slice(0, 3).join('; ')}
`);
	if (rest.wrongCells > 0)
		process.stdout.write(`  ${grid} WRONG AT REST: ${rest.wrongExamples.slice(0, 3).join('; ')}
`);
	return {
		fidelityFrames: stats.frames,
		cellFrames: stats.cellFrames,
		// Share of visible cell-frames not showing their final content.
		wrongCellPct: (100 * stats.wrongCells) / Math.max(1, stats.cellFrames),
		framesWithWrongPct: (100 * stats.framesWithWrong) / Math.max(1, stats.frames),
		// Content changes of a cell that stayed in view, per 1,000 visible cell-frames.
		changesPer1k: (1000 * stats.changes) / Math.max(1, stats.cellFrames),
		changes: stats.changes,
		// Wrong cells by kind, as % of visible cell-frames.
		blankPct: (100 * stats.blank) / Math.max(1, stats.cellFrames),
		incompletePct: (100 * stats.incomplete) / Math.max(1, stats.cellFrames),
		otherContentPct: (100 * stats.otherContent) / Math.max(1, stats.cellFrames),
		// After the last input, until every visible cell is final (-1: not within the 1.5 s tail).
		settleMs: stats.settleMs,
		// Must be 0: once scrolling settles every visible cell is right (validates the measure).
		wrongAtRest: rest.wrongCells,
		restCells: rest.cellFrames,
	};
}

/** Per-layout scope from Chrome's Layout trace events (B/E pairs or complete X events). */
function summarizeLayoutTrace(events) {
	const layouts = events.filter((e) => e.name === 'Layout' && (e.ph === 'B' || e.ph === 'X'));
	const styles = events.filter((e) => e.name === 'UpdateLayoutTree' && (e.ph === 'B' || e.ph === 'X' || e.ph === 'E'));
	let dirty = 0;
	let total = 0;
	let forced = 0;
	for (const e of layouts) {
		const data = e.args?.beginData ?? {};
		dirty += data.dirtyObjects ?? 0;
		total += data.totalObjects ?? 0;
		if (data.stackTrace?.length) forced++;
	}
	let styledElements = 0;
	for (const e of styles) styledElements += e.args?.elementCount ?? e.args?.endData?.elementCount ?? 0;
	// Why elements were restyled: Chrome's invalidation tracking, grouped by reason and node.
	const reasons = {};
	for (const e of events) {
		if (e.name !== 'StyleRecalcInvalidationTracking' && e.name !== 'ScheduleStyleInvalidationTracking' && e.name !== 'LayoutInvalidationTracking')
			continue;
		const data = e.args?.data ?? {};
		const what = data.changedClass
			? `class ${data.changedClass}`
			: data.changedAttribute
				? `attr ${data.changedAttribute}`
				: data.changedPseudo
					? `pseudo ${data.changedPseudo}`
					: (data.reason ?? data.extraData ?? '?');
		const kind = e.name === 'LayoutInvalidationTracking' ? 'layout' : e.name === 'StyleRecalcInvalidationTracking' ? 'recalc' : 'schedule';
		// Cell and row ids vary per node; group by class so one kind of node is one line.
		const node = String(data.nodeName ?? '?').replace(/ id='[^']*'/, '');
		const key = `${kind}: ${what} @ ${node}`;
		reasons[key] = (reasons[key] ?? 0) + 1;
	}
	const topReasons = Object.entries(reasons)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 16);
	if (topReasons.length)
		process.stdout.write(`  invalidations: ${JSON.stringify(topReasons)}
`);
	return {
		traceLayouts: layouts.length,
		traceForcedLayouts: forced,
		traceDirtyPerLayout: layouts.length ? dirty / layouts.length : 0,
		traceTreeObjectsPerLayout: layouts.length ? total / layouts.length : 0,
		traceStyledElements: styledElements,
	};
}

const sortedCopy = (values) => [...values].sort((a, b) => a - b);
const spread = (values) => {
	const sorted = sortedCopy(values);
	return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted[sorted.length - 1] };
};
const packageVersion = (path) => {
	try {
		return JSON.parse(readFileSync(path, 'utf8')).version;
	} catch {
		return 'unknown';
	}
};

function gitInfo() {
	try {
		const commit = execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim();
		const dirty = execSync('git status --porcelain -- ../core ../react', { cwd: here }).toString().trim().length > 0;
		return { commit, uncommittedChanges: dirty };
	} catch {
		return { commit: 'unknown', uncommittedChanges: false };
	}
}

await bundle();
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
const environment = {
	chrome: browser.version(),
	headless: !args.headed,
	os: `${os.type()} ${os.release()}`,
	cpu: os.cpus()[0]?.model?.trim() ?? 'unknown',
	cores: os.cpus().length,
	witGrid: packageVersion(join(here, '../core/package.json')),
	agGrid: packageVersion(join(here, 'node_modules/ag-grid-community/package.json')),
	...gitInfo(),
};
const results = [];
try {
	for (const scenario of SCENARIOS) {
		const scenarioGrids = scenario.grids ?? grids;
		const samples = Object.fromEntries(scenarioGrids.map((grid) => [grid, []]));
		for (let r = 0; r < runs; r++) {
			// Paired round: both grids back to back, alternating which goes first.
			const order = r % 2 === 0 ? scenarioGrids : [...scenarioGrids].reverse();
			for (const grid of order) samples[grid].push(await runOnce(browser, grid, scenario));
		}
		for (const grid of scenarioGrids) {
			const list = samples[grid];
			const metrics = Object.fromEntries(Object.keys(list[0]).map((key) => [key, spread(list.map((s) => s[key]))]));
			results.push({
				scenario: scenario.name,
				grid,
				...Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value.median])),
				spread: metrics,
			});
		}
		if (!fidelity && scenarioGrids.length === 2) {
			const ratios = samples.wit.map((w, i) => w.taskMs / samples.ag[i].taskMs);
			results.push({ scenario: scenario.name, grid: 'ratio', witOverAgTaskMs: spread(ratios), rounds: runs });
		}
		process.stdout.write(`${scenario.name}: done\n`);
	}
} finally {
	await browser.close();
}

const fmt = (n, digits = 1) => (typeof n === 'number' ? n.toFixed(digits) : String(n));
const fidelityTable = () =>
	results.map((r) => ({
		scenario: r.scenario,
		grid: r.grid,
		'wrong cells % (min-max)': `${fmt(r.wrongCellPct, 2)} (${fmt(r.spread.wrongCellPct.min, 2)}-${fmt(r.spread.wrongCellPct.max, 2)})`,
		'frames with wrong %': fmt(r.framesWithWrongPct),
		'changes in view /1k': fmt(r.changesPer1k, 2),
		'blank / incomplete / other %': `${fmt(r.blankPct, 2)} / ${fmt(r.incompletePct, 2)} / ${fmt(r.otherContentPct, 2)}`,
		'settle ms': fmt(r.settleMs, 0),
		'wrong at rest': fmt(r.wrongAtRest, 0),
		'cell-frames': fmt(r.cellFrames, 0),
	}));
const table = fidelity
	? fidelityTable()
	: results
			.filter((r) => r.grid !== 'ratio')
			.map((r) => ({
				scenario: r.scenario,
				grid: r.grid,
				'main thread ms (min-max)': `${fmt(r.taskMs, 0)} (${fmt(r.spread.taskMs.min, 0)}-${fmt(r.spread.taskMs.max, 0)})`,
				'script ms': fmt(r.scriptMs, 0),
				'layout ms': fmt(r.layoutMs, 0),
				'style ms': fmt(r.styleMs, 0),
				'layouts/frame': fmt(r.layoutCount / Math.max(1, r.frames), 2),
				'ms/layout': fmt(r.layoutMs / Math.max(1, r.layoutCount), 2),
				...(traceLayouts
					? {
							'trace layouts (forced)': `${fmt(r.traceLayouts, 0)} (${fmt(r.traceForcedLayouts, 0)})`,
							'dirty objs/layout': fmt(r.traceDirtyPerLayout, 0),
							'tree objs/layout': fmt(r.traceTreeObjectsPerLayout, 0),
							'styled elements': fmt(r.traceStyledElements, 0),
							'DOM rows/cells/els-per-cell': `${fmt(r.domRows, 0)}/${fmt(r.domCells, 0)}/${fmt(r.domElementsPerCell, 1)}`,
							'DOM elements': fmt(r.domElements, 0),
						}
					: {}),
				'input +ms/evt': fmt(r.inputOverheadMs, 2),
				'p99 frame ms': fmt(r.p99Ms),
				'dropped %': fmt(r.droppedPct),
				'blank %': fmt(r.blankSamplesPct),
				'renderer mounts/updates': `${r.mounts}/${r.updates}`,
			}));
console.log();
console.table(table);
for (const r of results.filter((x) => x.grid === 'ratio')) {
	const q = r.witOverAgTaskMs;
	console.log(
		`${r.scenario.padEnd(26)} Wit/AG main thread: ${fmt(q.median, 2)}x  (rounds ${fmt(q.min, 2)}-${fmt(q.max, 2)}x, ${r.rounds} paired rounds)`
	);
}
const report = {
	generatedAt: new Date().toISOString(),
	method: {
		rounds: runs,
		pairing: 'Each round runs both grids back to back on the same scenario, alternating which goes first.',
		input: 'Real mouse-wheel events through Chrome (playwright-core), 16ms apart; each grid uses its own defaults.',
		metrics:
			'Chrome main-thread counters (CDP Performance.getMetrics), frame intervals from rAF, long tasks, and blank area sampled after each frame.',
	},
	environment,
	scenarios: SCENARIOS.map(({ name, title, description, query, wheel }) => ({ name, title, description, query, wheel })),
	results,
};
const resultsDir = join(here, 'results');
mkdirSync(resultsDir, { recursive: true });
const prefix = fidelity ? 'fidelity-' : '';
if (fidelity)
	report.method.metrics =
		'Fidelity: after every frame, each fully visible cell is compared with its final content (text, plus bar width for renderer columns). Timings are not recorded: the sampling forces layout each frame.';
const file = join(resultsDir, `${prefix}${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
writeFileSync(join(resultsDir, `${prefix}latest.json`), JSON.stringify(report, null, 2));
console.log(`\nwrote ${file}`);
if (args.publish && !fidelity) {
	const dataDir = join(here, '../../site/data/benchmarks');
	mkdirSync(dataDir, { recursive: true });
	writeFileSync(join(dataDir, 'wit-vs-ag.json'), JSON.stringify(report, null, 2) + '\n');
	// One compact entry per publish, so the docs page can chart the Wit/AG ratio over time.
	const historyFile = join(dataDir, 'history.json');
	let history = [];
	try {
		history = JSON.parse(readFileSync(historyFile, 'utf8'));
	} catch {
		history = [];
	}
	history.push({
		generatedAt: report.generatedAt,
		commit: environment.commit,
		uncommittedChanges: environment.uncommittedChanges,
		witGrid: environment.witGrid,
		agGrid: environment.agGrid,
		ratios: Object.fromEntries(results.filter((r) => r.grid === 'ratio').map((r) => [r.scenario, r.witOverAgTaskMs.median])),
	});
	writeFileSync(historyFile, JSON.stringify(history, null, 2) + '\n');
	console.log(`published ${join(dataDir, 'wit-vs-ag.json')} (history: ${history.length} runs)`);
}
