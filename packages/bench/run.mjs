// Real-browser scroll benchmark: Wit Grid vs AG Grid, driven through the locally installed Chrome
// with genuine mouse-wheel input (compositor scroll path, not scripted scrollTop).
//
//   pnpm --filter @eregister/wit-grid-bench bench              # all scenarios, both grids, headless
//   pnpm --filter @eregister/wit-grid-bench bench -- --headed  # watch it
//   ... -- --only=vertical-text --runs=5 --grid=wit
//
// Frame timing reflects this machine and Chrome's frame rate; compare grids within one run, not
// numbers across machines. Results are also written to packages/bench/results/<timestamp>.json.
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const runs = Number(args.runs ?? 3);
const grids = args.grid ? [args.grid] : ['wit', 'ag'];

const SCENARIOS = [
	{ name: 'vertical-text', query: { rows: 100_000, cols: 50, domCols: 0 }, wheel: { dy: 360, events: 150 } },
	{ name: 'vertical-dom-renderers', query: { rows: 100_000, cols: 50, domCols: 10 }, wheel: { dy: 360, events: 150 } },
	{ name: 'horizontal-200-cols', query: { rows: 100_000, cols: 200, domCols: 0 }, wheel: { dx: 300, events: 150 } },
	{ name: 'vertical-fast-fling', query: { rows: 100_000, cols: 50, domCols: 0 }, wheel: { dy: 2400, events: 90 } },
].filter((s) => !args.only || s.name === args.only);

async function bundle() {
	mkdirSync(out, { recursive: true });
	await build({
		entryPoints: { wit: join(here, 'src/wit.ts'), ag: join(here, 'src/ag.ts') },
		outdir: out,
		bundle: true,
		format: 'iife',
		minify: true,
		target: 'es2022',
		define: { 'process.env.NODE_ENV': '"production"' },
		logLevel: 'warning',
	});
	for (const grid of ['wit', 'ag']) {
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
	await page.goto(url.href);
	await page.waitForFunction(() => window.benchReady === true, null, { timeout: 60_000 });
	await page.mouse.move(600, 360);
	await page.waitForTimeout(300);
	// Chrome's own main-thread counters (cumulative seconds) — independent of vsync pacing.
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const readMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
	const before = await readMetrics();
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
	await page.waitForTimeout(400);
	const raw = await page.evaluate(() => window.bench.stop());
	const after = await readMetrics();
	await page.close();
	const deltaMs = (name) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
	return {
		...summarize(raw),
		inputOverheadMs,
		scriptMs: deltaMs('ScriptDuration'),
		layoutMs: deltaMs('LayoutDuration'),
		styleMs: deltaMs('RecalcStyleDuration'),
		taskMs: deltaMs('TaskDuration'),
	};
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

await bundle();
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
const results = [];
try {
	for (const scenario of SCENARIOS) {
		for (const grid of grids) {
			const samples = [];
			for (let r = 0; r < runs; r++) samples.push(await runOnce(browser, grid, scenario));
			const summary = Object.fromEntries(Object.keys(samples[0]).map((key) => [key, median(samples.map((s) => s[key]))]));
			results.push({ scenario: scenario.name, grid, ...summary });
			process.stdout.write(`${scenario.name} / ${grid}: done\n`);
		}
	}
} finally {
	await browser.close();
}

const fmt = (n, digits = 1) => (typeof n === 'number' ? n.toFixed(digits) : String(n));
const table = results.map((r) => ({
	scenario: r.scenario,
	grid: r.grid,
	'main thread ms': fmt(r.taskMs, 0),
	'script ms': fmt(r.scriptMs, 0),
	'layout ms': fmt(r.layoutMs, 0),
	'style ms': fmt(r.styleMs, 0),
	'input +ms/evt': fmt(r.inputOverheadMs, 2),
	'p99 frame ms': fmt(r.p99Ms),
	'dropped %': fmt(r.droppedPct),
	'long tasks': `${r.longTasks} (${fmt(r.longTaskMs, 0)}ms)`,
	'min cover': fmt(r.minCoverage, 2),
	'blank %': fmt(r.blankSamplesPct),
}));
console.log();
console.table(table);
const resultsDir = join(here, 'results');
mkdirSync(resultsDir, { recursive: true });
const file = join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ runs, date: new Date().toISOString(), results }, null, 2));
console.log(`\nwrote ${file}`);
