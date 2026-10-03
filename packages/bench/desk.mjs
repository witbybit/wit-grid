// Live markets-desk telemetry in real Chrome (the demo dev server must be running):
//   node desk.mjs [--url=http://localhost:5174/#dashboard] [--rates=100,1k,10k] [--seconds=7]
// For each feed rate it clicks the desk's rate control, waits, and prints the desk's own telemetry
// (window.__marketsDeskTelemetry): applied updates/s, rows per frame, frames/s, frame and
// transaction ms (p50/p95) and long tasks.
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const url = args.url ?? 'http://localhost:5174/#dashboard';
const rates = (args.rates ?? '100,1k,10k').split(',');
const seconds = Number(args.seconds ?? 7);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url);
await page.waitForFunction(() => window.__marketsDeskTelemetry?.transactionsTotal > 0, null, { timeout: 120000 });
for (const rate of rates) {
	await page
		.locator('button')
		.filter({ hasText: new RegExp(`^${rate}$`) })
		.first()
		.click();
	await page.waitForTimeout(seconds * 1000);
	const t = await page.evaluate(() => {
		const telemetry = window.__marketsDeskTelemetry;
		telemetry.refresh?.();
		return JSON.parse(JSON.stringify(telemetry));
	});
	console.log(
		`${rate.padStart(4)}/s  rows ${t.rowCount}  applied ${Math.round(t.updatesPerSec)}/s  rows/frame ${Math.round(t.rowsPerFrameAvg)}  fps ${t.fps.toFixed(1)}  ` +
			`frame p50/p95 ${t.frameMs.p50.toFixed(1)}/${t.frameMs.p95.toFixed(1)} ms  tx p50/p95 ${t.txnMs.p50.toFixed(1)}/${t.txnMs.p95.toFixed(1)} ms  long tasks ${t.longTasks}`
	);
}
await browser.close();
