import report from '@/data/benchmarks/wit-vs-ag.json';
import history from '@/data/benchmarks/history.json';
import findings from '@/data/benchmarks/findings.json';

/**
 * Wit Grid vs AG Grid, rendered straight from the benchmark's committed output
 * (`pnpm bench:browser --publish` rewrites the data files). Nothing here is hand-typed: numbers,
 * spreads and the trend all come from the latest run and its history, so the page moves as the
 * grid gets faster, and shows it plainly when it does not.
 */

type Spread = { median: number; min: number; max: number };
type GridResult = {
	scenario: string;
	grid: 'wit' | 'ag';
	taskMs: number;
	scriptMs: number;
	layoutMs: number;
	styleMs: number;
	inputOverheadMs: number;
	p99Ms: number;
	droppedPct: number;
	longTasks: number;
	longTaskMs: number;
	blankSamplesPct: number;
	minCoverage: number;
	mounts: number;
	updates: number;
	spread: Record<string, Spread>;
};
type RatioResult = { scenario: string; grid: 'ratio'; witOverAgTaskMs: Spread; rounds: number };
type Scenario = { name: string; title: string; description: string };
type HistoryEntry = { generatedAt: string; commit: string; uncommittedChanges?: boolean; witGrid: string; ratios: Record<string, number> };
type Finding = {
	id: string;
	title: string;
	detail: string;
	status: 'fixed' | 'in-progress' | 'open' | 'not-an-issue';
	impact?: string;
	commits?: string[];
};

const results = report.results as Array<GridResult | RatioResult>;
const scenarios = report.scenarios as Scenario[];
const runs = history as HistoryEntry[];
const issues = findings as Finding[];

function gridResult(scenario: string, grid: 'wit' | 'ag'): GridResult | undefined {
	return results.find((r): r is GridResult => r.scenario === scenario && r.grid === grid);
}
function ratioResult(scenario: string): RatioResult | undefined {
	return results.find((r): r is RatioResult => r.scenario === scenario && r.grid === 'ratio');
}

const ms = (n: number) => `${Math.round(n).toLocaleString('en-US')} ms`;
const x = (n: number) => `${n.toFixed(2)}×`;

/** Verdict from the ratio's full spread, not just its median, so a noisy run is never called a win. */
function verdict(ratio: Spread): { label: string; tone: 'good' | 'bad' | 'even' } {
	if (ratio.max < 1) return { label: 'Wit Grid faster in every round', tone: 'good' };
	if (ratio.min > 1) return { label: 'AG Grid faster in every round', tone: 'bad' };
	if (ratio.median < 1) return { label: 'Wit Grid faster in most rounds', tone: 'even' };
	if (ratio.median > 1) return { label: 'AG Grid faster in most rounds', tone: 'even' };
	return { label: 'Even', tone: 'even' };
}

const toneText: Record<'good' | 'bad' | 'even', string> = {
	good: 'text-emerald-700 dark:text-emerald-400',
	bad: 'text-rose-700 dark:text-rose-400',
	even: 'text-amber-700 dark:text-amber-400',
};

const SEGMENTS: Array<{ key: 'scriptMs' | 'layoutMs' | 'styleMs'; label: string; className: string }> = [
	{ key: 'scriptMs', label: 'Script', className: 'bg-sky-500' },
	{ key: 'layoutMs', label: 'Layout', className: 'bg-violet-500' },
	{ key: 'styleMs', label: 'Style', className: 'bg-amber-500' },
];

function WorkBar({ result, scale, name }: { result: GridResult; scale: number; name: string }) {
	const other = Math.max(0, result.taskMs - result.scriptMs - result.layoutMs - result.styleMs);
	const pct = (v: number) => `${(100 * v) / scale}%`;
	return (
		<div className='grid grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm'>
			<span className='font-medium'>{name}</span>
			<div className='flex h-3 overflow-hidden rounded bg-fd-muted' role='img' aria-label={`${name}: ${ms(result.taskMs)} of main-thread work`}>
				{SEGMENTS.map((s) => (
					<span key={s.key} className={s.className} style={{ width: pct(result[s.key]) }} />
				))}
				<span className='bg-slate-400 dark:bg-slate-500' style={{ width: pct(other) }} />
			</div>
			<span className='text-right tabular-nums'>{ms(result.taskMs)}</span>
		</div>
	);
}

type Row = { label: string; hint: string; get: (r: GridResult) => number; format: (n: number) => string; lowerIsBetter: boolean };
const DETAIL_ROWS: Row[] = [
	{ label: 'Main-thread work', hint: 'Chrome task time for the whole scripted scroll', get: (r) => r.taskMs, format: ms, lowerIsBetter: true },
	{ label: 'Script', hint: 'JavaScript execution', get: (r) => r.scriptMs, format: ms, lowerIsBetter: true },
	{ label: 'Layout', hint: 'Layout calculation', get: (r) => r.layoutMs, format: ms, lowerIsBetter: true },
	{ label: 'Style recalculation', hint: 'Style invalidation and recalc', get: (r) => r.styleMs, format: ms, lowerIsBetter: true },
	{
		label: 'Input handling / event',
		hint: 'Extra time before each wheel event was acknowledged',
		get: (r) => r.inputOverheadMs,
		format: (n) => `${n.toFixed(1)} ms`,
		lowerIsBetter: true,
	},
	{
		label: 'Frame time, p99',
		hint: '99th-percentile frame interval',
		get: (r) => r.p99Ms,
		format: (n) => `${n.toFixed(1)} ms`,
		lowerIsBetter: true,
	},
	{
		label: 'Dropped frames',
		hint: 'Frames over 1.5× the typical interval',
		get: (r) => r.droppedPct,
		format: (n) => `${n.toFixed(1)}%`,
		lowerIsBetter: true,
	},
	{
		label: 'Blank samples',
		hint: 'Samples where rendered rows covered under 98% of the body',
		get: (r) => r.blankSamplesPct,
		format: (n) => `${n.toFixed(1)}%`,
		lowerIsBetter: true,
	},
];

function DetailTable({ wit, ag }: { wit: GridResult; ag: GridResult }) {
	return (
		<div className='overflow-x-auto'>
			<table className='w-full text-sm'>
				<thead>
					<tr className='text-left text-fd-muted-foreground'>
						<th className='py-2 pr-4 font-medium'>Metric</th>
						<th className='py-2 pr-4 text-right font-medium'>Wit Grid</th>
						<th className='py-2 pr-4 text-right font-medium'>AG Grid</th>
						<th className='py-2 font-medium'>Better</th>
					</tr>
				</thead>
				<tbody>
					{DETAIL_ROWS.map((row) => {
						const w = row.get(wit);
						const a = row.get(ag);
						const same = Math.abs(w - a) <= Math.max(Math.abs(w), Math.abs(a)) * 0.03;
						const witBetter = row.lowerIsBetter ? w < a : w > a;
						return (
							<tr key={row.label} className='border-t border-fd-border'>
								<td className='py-2 pr-4'>
									<span title={row.hint}>{row.label}</span>
								</td>
								<td className='py-2 pr-4 text-right tabular-nums'>{row.format(w)}</td>
								<td className='py-2 pr-4 text-right tabular-nums'>{row.format(a)}</td>
								<td className={`py-2 ${same ? 'text-fd-muted-foreground' : witBetter ? toneText.good : toneText.bad}`}>
									{same ? 'Even' : witBetter ? 'Wit Grid' : 'AG Grid'}
								</td>
							</tr>
						);
					})}
					<tr className='border-t border-fd-border'>
						<td className='py-2 pr-4'>
							<span title='Custom renderer calls during the run'>Renderer mounts / updates</span>
						</td>
						<td className='py-2 pr-4 text-right tabular-nums'>
							{wit.mounts.toLocaleString('en-US')} / {wit.updates.toLocaleString('en-US')}
						</td>
						<td className='py-2 pr-4 text-right tabular-nums'>
							{ag.mounts.toLocaleString('en-US')} / {ag.updates.toLocaleString('en-US')}
						</td>
						<td className='py-2 text-fd-muted-foreground'>Context</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

/** Wit/AG ratio per published run; the dashed line is parity (1.0×). */
function Trend({ scenario }: { scenario: string }) {
	const points = runs.map((run) => run.ratios[scenario]).filter((v): v is number => typeof v === 'number');
	if (points.length < 2) return <p className='text-sm text-fd-muted-foreground'>The trend appears after the next published run.</p>;
	const W = 280;
	const H = 64;
	const lo = Math.min(0.5, ...points);
	const hi = Math.max(1.5, ...points);
	const y = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);
	const step = (W - 12) / (points.length - 1);
	const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${6 + i * step},${y(v)}`).join(' ');
	const last = points[points.length - 1];
	return (
		<svg
			viewBox={`0 0 ${W} ${H}`}
			className='h-16 w-full max-w-xs'
			role='img'
			aria-label={`Wit/AG ratio over ${points.length} runs, latest ${x(last)}`}
		>
			<line x1={6} x2={W - 6} y1={y(1)} y2={y(1)} className='stroke-fd-muted-foreground' strokeDasharray='4 4' strokeWidth={1} />
			<path d={path} fill='none' className='stroke-sky-500' strokeWidth={2} />
			<circle cx={6 + (points.length - 1) * step} cy={y(last)} r={3.5} className='fill-sky-500' />
		</svg>
	);
}

const STATUS_LABEL: Record<Finding['status'], string> = {
	fixed: 'Fixed',
	'in-progress': 'In progress',
	open: 'Open',
	'not-an-issue': 'Not an issue',
};
const STATUS_CLASS: Record<Finding['status'], string> = {
	fixed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
	'in-progress': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
	open: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
	'not-an-issue': 'bg-fd-muted text-fd-muted-foreground',
};

export function BenchmarkScoreboard() {
	return (
		<div className='not-prose grid gap-3 sm:grid-cols-2'>
			{scenarios.map((scenario) => {
				const ratio = ratioResult(scenario.name);
				if (!ratio) return null;
				const v = verdict(ratio.witOverAgTaskMs);
				return (
					<div key={scenario.name} className='rounded-lg border border-fd-border bg-fd-card p-4'>
						<div className='text-sm text-fd-muted-foreground'>{scenario.title}</div>
						<div className='mt-1 text-2xl font-semibold tabular-nums'>{x(ratio.witOverAgTaskMs.median)}</div>
						<div className='text-sm text-fd-muted-foreground'>Wit Grid main-thread work relative to AG Grid</div>
						<div className={`mt-2 text-sm font-medium ${toneText[v.tone]}`}>{v.label}</div>
						<div className='text-xs text-fd-muted-foreground'>
							{ratio.rounds} paired rounds, {x(ratio.witOverAgTaskMs.min)} – {x(ratio.witOverAgTaskMs.max)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

export function BenchmarkScenarios() {
	return (
		<div className='not-prose grid gap-6'>
			{scenarios.map((scenario) => {
				const wit = gridResult(scenario.name, 'wit');
				const ag = gridResult(scenario.name, 'ag');
				if (!wit || !ag) return null;
				const scale = Math.max(wit.taskMs, ag.taskMs);
				return (
					<section key={scenario.name} className='grid gap-4 rounded-lg border border-fd-border bg-fd-card p-4'>
						<div>
							<h3 className='text-base font-semibold'>{scenario.title}</h3>
							<p className='text-sm text-fd-muted-foreground'>{scenario.description}</p>
						</div>
						<div className='grid gap-2'>
							<WorkBar result={wit} scale={scale} name='Wit Grid' />
							<WorkBar result={ag} scale={scale} name='AG Grid' />
							<div className='flex flex-wrap gap-4 text-xs text-fd-muted-foreground'>
								{SEGMENTS.map((s) => (
									<span key={s.key} className='inline-flex items-center gap-1.5'>
										<i className={`inline-block h-2 w-2 rounded-sm ${s.className}`} /> {s.label}
									</span>
								))}
								<span className='inline-flex items-center gap-1.5'>
									<i className='inline-block h-2 w-2 rounded-sm bg-slate-400 dark:bg-slate-500' /> Other
								</span>
							</div>
						</div>
						<DetailTable wit={wit} ag={ag} />
						<div>
							<div className='mb-1 text-sm text-fd-muted-foreground'>Wit/AG main-thread ratio across published runs</div>
							<Trend scenario={scenario.name} />
						</div>
					</section>
				);
			})}
		</div>
	);
}

export function BenchmarkFindings() {
	const order: Finding['status'][] = ['open', 'in-progress', 'fixed', 'not-an-issue'];
	const sorted = [...issues].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
	return (
		<div className='not-prose divide-y divide-fd-border rounded-lg border border-fd-border bg-fd-card'>
			{sorted.map((f) => (
				<div key={f.id} className='grid gap-1 p-4 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-4'>
					<div>
						<span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[f.status]}`}>
							{STATUS_LABEL[f.status]}
						</span>
					</div>
					<div className='min-w-0'>
						<div className='font-medium'>{f.title}</div>
						<p className='text-sm text-fd-muted-foreground'>{f.detail}</p>
						{f.impact ? <p className='mt-1 text-sm'>{f.impact}</p> : null}
						{f.commits?.length ? (
							<div className='mt-1 flex flex-wrap gap-1.5'>
								{f.commits.map((c) => (
									<code key={c} className='rounded bg-fd-muted px-1.5 py-0.5 text-xs'>
										{c}
									</code>
								))}
							</div>
						) : null}
					</div>
				</div>
			))}
		</div>
	);
}

export function BenchmarkEnvironment() {
	const e = report.environment;
	const when = new Date(report.generatedAt).toISOString().slice(0, 10);
	return (
		<ul className='text-sm'>
			<li>
				Run on {when} at commit <code>{e.commit}</code>
				{e.uncommittedChanges ? ' (with uncommitted core changes)' : ''}, Wit Grid {e.witGrid}, AG Grid Community {e.agGrid}.
			</li>
			<li>
				Chrome {e.chrome}
				{e.headless ? ' (headless)' : ''} on {e.os}, {e.cpu} ({e.cores} logical cores).
			</li>
			<li>{report.method.pairing}</li>
			<li>{report.method.input}</li>
			<li>{report.method.metrics}</li>
		</ul>
	);
}
