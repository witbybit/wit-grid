import React, { useEffect, useRef, useState } from 'react';
import { Grid, duplicateValueRule } from '@eregister/wit-grid-react';
import type { ColumnDef, GridReadyEvent, GridApi, GridTransactionStreamHandle, GridIntegrityIssue, GridDiffModel } from '@eregister/wit-grid-react';

// ── Data model ────────────────────────────────────────────────────────────────

interface TradeRow {
	id: string;
	symbol: string;
	trader: string;
	quantity: number;
	price: number;
	notional: number;
	status: 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';
	desk: string;
	venue: string;
}

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM'];
const TRADERS = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];
const DESKS = ['Equity', 'Fixed Income', 'Derivatives', 'FX'];
const VENUES = ['NYSE', 'NASDAQ', 'CBOE', 'LSE'];
const STATUSES: TradeRow['status'][] = ['OPEN', 'FILLED', 'CANCELLED', 'REJECTED'];

function makeRow(i: number): TradeRow {
	const symbol = SYMBOLS[i % SYMBOLS.length];
	const qty = 100 + ((i * 37) % 900);
	const price = parseFloat((50 + ((i * 13) % 400)).toFixed(2));
	return {
		id: `T${String(i + 1).padStart(4, '0')}`,
		symbol,
		trader: TRADERS[i % TRADERS.length],
		quantity: qty,
		price,
		notional: qty * price,
		status: STATUSES[i % STATUSES.length],
		desk: DESKS[i % DESKS.length],
		venue: VENUES[i % VENUES.length],
	};
}

const BASE_ROWS: TradeRow[] = Array.from({ length: 30 }, (_, i) => makeRow(i));

// ── Compare dataset (slightly different from base) ────────────────────────────

function makeCompareRows(): TradeRow[] {
	return BASE_ROWS.map((r, i) => {
		if (i % 5 === 0)
			return { ...r, price: parseFloat((r.price * 1.05).toFixed(2)), notional: r.quantity * parseFloat((r.price * 1.05).toFixed(2)) };
		if (i % 7 === 0) return { ...r, status: 'CANCELLED' as const };
		return r;
	}).filter((_, i) => i !== 3); // simulate one removed row
}

// ── Columns ───────────────────────────────────────────────────────────────────

function StatusRenderer({ value }: { value: unknown }) {
	const color: Record<string, string> = {
		OPEN: '#22c55e',
		FILLED: '#6366f1',
		CANCELLED: '#f59e0b',
		REJECTED: '#ef4444',
	};
	const v = String(value ?? '');
	return (
		<span
			style={{
				fontSize: 10,
				fontWeight: 700,
				padding: '2px 7px',
				borderRadius: 4,
				background: `${color[v] ?? '#6b7280'}22`,
				color: color[v] ?? '#6b7280',
			}}
		>
			{v}
		</span>
	);
}

const COLUMNS: ColumnDef<TradeRow>[] = [
	{ field: 'id', header: 'Trade ID', width: 90 },
	{ field: 'symbol', header: 'Symbol', width: 80 },
	{ field: 'trader', header: 'Trader', width: 90 },
	{ field: 'desk', header: 'Desk', width: 100 },
	{ field: 'venue', header: 'Venue', width: 80 },
	{ field: 'quantity', header: 'Qty', width: 80, type: 'number' },
	{
		field: 'price',
		header: 'Price',
		width: 90,
		type: 'number',
		valueFormatter: (p) => (p.value != null ? `$${Number(p.value).toFixed(2)}` : ''),
	},
	{
		field: 'notional',
		header: 'Notional',
		width: 110,
		type: 'number',
		valueFormatter: (p) => (p.value != null ? `$${Number(p.value).toLocaleString()}` : ''),
	},
	{
		field: 'status',
		header: 'Status',
		width: 95,
		renderer: { kind: 'react', component: StatusRenderer },
	},
];

// ── Panel button style ────────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'amber' | 'green' | 'red' | 'indigo' | 'ghost';

function Btn({
	children,
	onClick,
	variant = 'ghost',
	disabled,
}: {
	children: React.ReactNode;
	onClick?: () => void;
	variant?: BtnVariant;
	disabled?: boolean;
}) {
	const colors: Record<BtnVariant, string> = {
		primary: 'bg-purple-600/20 border-purple-500/40 text-purple-300 hover:bg-purple-600/30',
		amber: 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30',
		green: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30',
		red: 'bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30',
		indigo: 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30',
		ghost: 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60',
	};
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition-all ${colors[variant]} disabled:opacity-40 disabled:cursor-not-allowed`}
		>
			{children}
		</button>
	);
}

// ── Stage badge ───────────────────────────────────────────────────────────────

function StageBadge({ label, active, done }: { label: string; active: boolean; done: boolean }) {
	return (
		<div
			className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition-all ${
				done
					? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
					: active
						? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
						: 'border-slate-800 bg-slate-900/20 text-slate-600'
			}`}
		>
			{done ? '✓' : active ? '◉' : '○'} {label}
		</div>
	);
}

// ── Main component ────────────────────────────────────────────────────────────

type Stage = 'quality' | 'diff' | 'stream' | 'conflict';

export default function DataIntegrityLab() {
	const apiRef = useRef<GridApi<TradeRow> | null>(null);
	const streamRef = useRef<GridTransactionStreamHandle<TradeRow> | null>(null);
	const [activeStage, setActiveStage] = useState<Stage>('quality');
	const [log, setLog] = useState<string[]>([]);
	const [qualityIssues, setQualityIssues] = useState<GridIntegrityIssue[] | null>(null);
	const [diffActive, setDiffActive] = useState(false);
	const [streamRunning, setStreamRunning] = useState(false);
	const [conflictCount, setConflictCount] = useState(0);

	function addLog(msg: string) {
		setLog((prev) => [`[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ${msg}`, ...prev].slice(0, 40));
	}

	function onGridReady(e: GridReadyEvent<TradeRow>) {
		const api = e.api as GridApi<TradeRow>;
		apiRef.current = api;
		addLog('Grid ready — 30 trade rows loaded');
	}

	// ── Stage 1: Data Quality ─────────────────────────────────────────────────

	async function handleRunQuality() {
		const api = apiRef.current;
		if (!api) return;
		addLog('Running data quality check…');
		const result = await api.integrity.run({ modules: ['quality'] });
		const issues = result.issues.filter((i) => i.source === 'dataQuality') as GridIntegrityIssue[];
		setQualityIssues(issues);
		addLog(
			`Quality: ${issues.length} issues found (${issues.filter((i) => i.severity === 'error').length} errors, ${issues.filter((i) => i.severity === 'warning').length} warnings)`
		);
	}

	function handleClearQuality() {
		apiRef.current?.integrity.clearIssues({ source: 'dataQuality' });
		setQualityIssues(null);
		addLog('Quality report cleared');
	}

	// ── Stage 2: Data Diff ────────────────────────────────────────────────────

	function handleActivateDiff() {
		const api = apiRef.current;
		if (!api) return;
		const compareRows = makeCompareRows();
		const model: GridDiffModel<TradeRow> = {
			base: { rows: BASE_ROWS, getRowId: (r) => r.id },
			compare: { rows: compareRows, getRowId: (r) => r.id },
		};
		api.integrity.setDiffModel(model);
		setDiffActive(true);
		addLog('Diff activated — comparing current vs EOD snapshot');
	}

	function handleClearDiff() {
		apiRef.current?.integrity.clearDiff();
		setDiffActive(false);
		addLog('Diff cleared');
	}

	// ── Stage 3: Live Stream ──────────────────────────────────────────────────

	function handleStartStream() {
		const api = apiRef.current;
		if (!api || streamRef.current) return;
		const stream = api.integrity.createStream({
			batchMs: 400,
			flashChanges: true,
			coalesceBy: 'cell',
			dirtyCellPolicy: 'markConflict',
		});
		streamRef.current = stream;
		setStreamRunning(true);
		addLog('Live stream started — price updates every 400ms');

		let tick = 0;
		function pushTick() {
			if (!streamRef.current) return;
			const rows = BASE_ROWS;
			const n = 3 + (tick % 4);
			const updates = Array.from({ length: n }, () => {
				const row = rows[Math.floor(Math.abs(Math.sin(tick * 7 + Math.random())) * rows.length)];
				const newPrice = parseFloat((row.price * (0.98 + Math.random() * 0.04)).toFixed(2));
				tick++;
				return { rowId: row.id, colField: 'price', value: newPrice };
			});
			stream.push({ cells: updates });
			setTimeout(pushTick, 600 + Math.floor(Math.random() * 400));
		}
		pushTick();
	}

	function handleStopStream() {
		streamRef.current?.destroy();
		streamRef.current = null;
		setStreamRunning(false);
		addLog('Live stream stopped');
	}

	// ── Stage 4: Conflicts ────────────────────────────────────────────────────

	function handleInjectConflicts() {
		const api = apiRef.current;
		if (!api) return;
		const now = Date.now();
		const conflictIssues: GridIntegrityIssue[] = [
			{
				id: 'ci-T0001-price',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'T0001',
				colField: 'price',
				message: 'Conflict: local 65.5 vs remote 61.0',
				createdAt: now,
			},
			{
				id: 'ci-T0003-status',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'T0003',
				colField: 'status',
				message: 'Conflict: local FILLED vs remote CANCELLED',
				createdAt: now,
			},
			{
				id: 'ci-T0007-qty',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'T0007',
				colField: 'quantity',
				message: 'Conflict: local 850 vs remote 750',
				createdAt: now,
			},
		];
		api.integrity.publishIssues('conflict', conflictIssues);
		setConflictCount(3);
		addLog(`Injected 3 conflicts — open Conflicts panel to resolve`);
	}

	function handleResolveAll() {
		const api = apiRef.current;
		if (!api) return;
		api.integrity.clearIssues({ source: 'conflict' });
		setConflictCount(0);
		addLog('All conflicts cleared');
	}

	// ── Cleanup on unmount ────────────────────────────────────────────────────

	useEffect(() => {
		return () => {
			streamRef.current?.destroy();
			streamRef.current = null;
		};
	}, []);

	const stages: { id: Stage; label: string }[] = [
		{ id: 'quality', label: '1 · Quality' },
		{ id: 'diff', label: '2 · Diff' },
		{ id: 'stream', label: '3 · Stream' },
		{ id: 'conflict', label: '4 · Conflicts' },
	];

	const stageDone: Record<Stage, boolean> = {
		quality: qualityIssues !== null,
		diff: diffActive,
		stream: streamRunning,
		conflict: conflictCount === 0 && false, // never "done" automatically
	};

	return (
		<div className='flex h-full min-h-0 flex-col gap-3 overflow-hidden'>
			{/* Top control strip */}
			<div className='flex flex-col gap-2 rounded-xl border border-slate-800/60 bg-slate-900/30 p-3'>
				{/* Stage breadcrumb */}
				<div className='flex items-center gap-2 flex-wrap'>
					{stages.map((s) => (
						<button key={s.id} onClick={() => setActiveStage(s.id)}>
							<StageBadge label={s.label} active={activeStage === s.id} done={stageDone[s.id]} />
						</button>
					))}
					<div className='ml-auto text-[9px] font-bold uppercase tracking-widest text-slate-600'>Data Integrity Pipeline</div>
				</div>

				{/* Stage controls */}
				<div className='flex items-center gap-2 flex-wrap min-h-[28px]'>
					{activeStage === 'quality' && (
						<>
							<Btn variant='primary' onClick={handleRunQuality}>
								Run Quality Check
							</Btn>
							{qualityIssues !== null && (
								<>
									<span className='text-[10px] text-slate-400'>
										{qualityIssues.length} issues —{' '}
										<span className='text-red-400'>{qualityIssues.filter((i) => i.severity === 'error').length} errors</span>{' '}
										<span className='text-amber-400'>
											{qualityIssues.filter((i) => i.severity === 'warning').length} warnings
										</span>
									</span>
									<Btn onClick={handleClearQuality}>Clear</Btn>
								</>
							)}
						</>
					)}
					{activeStage === 'diff' && (
						<>
							{!diffActive ? (
								<Btn variant='amber' onClick={handleActivateDiff}>
									Activate EOD Diff
								</Btn>
							) : (
								<Btn onClick={handleClearDiff}>Clear Diff</Btn>
							)}
							<span className='text-[10px] text-slate-500'>
								Compares live data vs EOD snapshot — changed cells highlighted amber, removed rows red
							</span>
						</>
					)}
					{activeStage === 'stream' && (
						<>
							{!streamRunning ? (
								<Btn variant='green' onClick={handleStartStream}>
									Start Live Feed
								</Btn>
							) : (
								<Btn variant='red' onClick={handleStopStream}>
									Stop Feed
								</Btn>
							)}
							<span className='text-[10px] text-slate-500'>
								{streamRunning
									? 'Streaming price updates — cells flash yellow on update'
									: 'Click to stream live price ticks with coalescing & flash'}
							</span>
						</>
					)}
					{activeStage === 'conflict' && (
						<>
							<Btn variant='indigo' onClick={handleInjectConflicts} disabled={conflictCount > 0}>
								Inject 3 Conflicts
							</Btn>
							{conflictCount > 0 && (
								<>
									<span className='text-[10px] text-red-400'>{conflictCount} unresolved conflicts (striped cells)</span>
									<Btn variant='red' onClick={handleResolveAll}>
										Clear All
									</Btn>
								</>
							)}
							{conflictCount === 0 && (
								<span className='text-[10px] text-slate-500'>
									Injects server-vs-local conflicts; open Conflicts panel to resolve per-cell
								</span>
							)}
						</>
					)}
				</div>
			</div>

			{/* Grid + log */}
			<div className='flex min-h-0 flex-1 gap-3 overflow-hidden'>
				{/* Grid */}
				<div className='flex-1 min-w-0 demo-grid-surface rounded-xl border border-slate-800/60 overflow-hidden'>
					<Grid<TradeRow>
						columns={COLUMNS}
						rows={BASE_ROWS}
						getRowId={(r) => r.id}
						dataIntegrity={{
							quality: {
								enabled: true,
								rules: [
									duplicateValueRule('symbol'),
									{
										id: 'notional-range',
										label: 'Notional Range',
										run(context) {
											return context.rows
												.filter((ref) => {
													const n = (ref.row as TradeRow).notional;
													return n < 5_000 || n > 500_000;
												})
												.map((ref) => ({
													id: `notional-range-${ref.rowId}`,
													source: 'dataQuality' as const,
													type: 'custom' as const,
													severity: 'error' as const,
													blocking: false,
													rowId: ref.rowId,
													colField: 'notional',
													message: `Notional out of [$5k – $500k]`,
													createdAt: Date.now(),
												}));
										},
									},
								],
							},
							diff: true,
							liveStream: { enabled: true, dirtyCellPolicy: 'markConflict', flashChanges: true },
							conflicts: true,
						}}
						sidebar={{
							panels: ['columns', 'dataIntegrity'],
							position: 'right',
						}}
						onGridReady={onGridReady}
					/>
				</div>

				{/* Activity log */}
				<div className='w-52 shrink-0 rounded-xl border border-slate-800/60 bg-slate-900/30 flex flex-col overflow-hidden'>
					<div className='flex items-center justify-between px-3 py-2 border-b border-slate-800/60'>
						<span className='text-[9px] font-extrabold uppercase tracking-widest text-slate-500'>Activity Log</span>
						{log.length > 0 && (
							<button onClick={() => setLog([])} className='text-[9px] text-slate-600 hover:text-slate-400'>
								Clear
							</button>
						)}
					</div>
					<div className='flex-1 overflow-y-auto flex flex-col-reverse p-2 gap-1'>
						{log.length === 0 ? (
							<p className='text-[9px] text-slate-700 text-center mt-4'>No activity yet</p>
						) : (
							log.map((msg, i) => (
								<div key={i} className='text-[9px] text-slate-400 font-mono leading-tight'>
									{msg}
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
