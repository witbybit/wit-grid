import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Grid,
	GridEventName,
	duplicateValueRule,
	type GridApi,
	type GridContextMenuOptions,
	type GridReadyEvent,
	type StyleRule,
	type GridIntegrityIssue,
	type GridTransactionStreamHandle,
} from '@eregister/wit-grid-react';
import { Activity, BarChart3, Code2, RefreshCw, TrendingUp, Zap, ShieldCheck } from 'lucide-react';
import { createDashboardColumns, createDashboardRows } from './demoGridConfigs';
import type { DashboardStockRow } from '../components/FastRenderers';

interface RealtimeDashboardProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<DashboardStockRow>) => void;
}

export default function RealtimeDashboard({ editTrigger, arrowKeyNavigationEdit, onCellValueChanged, onGridReady }: RealtimeDashboardProps) {
	const columns = useMemo(() => createDashboardColumns(), []);
	const rows = useMemo(() => createDashboardRows(), []);
	const [api, setApi] = useState<GridApi<DashboardStockRow> | null>(null);
	const [stats, setStats] = useState({ sum: 0, avg: 0, min: 0, max: 0, count: 0 });
	const [prices, setPrices] = useState<number[]>([]);
	const [companyCount, setCompanyCount] = useState(0);
	const [eventLogs, setEventLogs] = useState<Array<{ id: number; time: string; msg: string; type: string }>>([]);
	const eventLogIdRef = useRef(0);
	const [autoFire, setAutoFire] = useState(false);
	const [autoFireIntervalMs, setAutoFireIntervalMs] = useState(100);
	const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// ── Integrity state ────────────────────────────────────────────────────────
	const streamRef = useRef<GridTransactionStreamHandle<DashboardStockRow> | null>(null);
	const streamTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [qualityIssues, setQualityIssues] = useState<GridIntegrityIssue[] | null>(null);
	const [diffActive, setDiffActive] = useState(false);
	const [streamRunning, setStreamRunning] = useState(false);
	const [conflictCount, setConflictCount] = useState(0);

	const selectedRowIdsRef = useRef<string[]>([]);
	const selectedColsRef = useRef<string[]>([]);

	const styleRules = useMemo<StyleRule<DashboardStockRow>[]>(
		() => [
			{
				kind: 'row',
				when: (row) => (parseFloat(row.change) || 0) > 0,
				rowClass: 'transition-all duration-200 border-l-2 border-emerald-500/60 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-100/90',
			},
			{
				kind: 'row',
				when: (row) => (parseFloat(row.change) || 0) < 0,
				rowClass: 'transition-all duration-200 border-l-2 border-rose-500/60 bg-rose-950/5 hover:bg-rose-900/10 text-rose-100/90',
			},
			{
				kind: 'cell',
				field: 'change',
				when: (row) => (parseFloat(row.change) || 0) > 0,
				cellClass: 'text-emerald-400 font-extrabold font-mono',
			},
			{ kind: 'cell', field: 'change', when: (row) => (parseFloat(row.change) || 0) < 0, cellClass: 'text-rose-400 font-extrabold font-mono' },
			{ kind: 'cell', field: 'price', when: () => true, cellClass: 'font-mono font-bold text-slate-200' },
		],
		[]
	);

	const refreshStats = useCallback(() => {
		if (!api) return;
		const rowIds = selectedRowIdsRef.current;
		const cols = selectedColsRef.current;
		const numericValues: number[] = [];
		for (const rowId of rowIds)
			for (const col of cols) {
				const num = parseFloat(String(api.getCellValue(rowId, col)));
				if (!Number.isNaN(num)) numericValues.push(num);
			}
		if (numericValues.length) {
			const sum = numericValues.reduce((a, b) => a + b, 0);
			setStats({
				sum,
				avg: sum / numericValues.length,
				min: Math.min(...numericValues),
				max: Math.max(...numericValues),
				count: numericValues.length,
			});
		} else {
			setStats({ sum: 0, avg: 0, min: 0, max: 0, count: 0 });
		}
		if (rowIds.length > 0) {
			setPrices(rowIds.map((id) => parseFloat(String(api.getCellValue(id, 'price'))) || 0));
		} else {
			setPrices(
				api
					.rows()
					.getAll()
					.slice(0, 18)
					.map((row: any) => parseFloat(String(row.price)) || 0)
			);
		}
		setCompanyCount(rowIds.length);
	}, [api]);

	const updateStatsAndChart = useCallback(() => {
		if (!api) return;
		const state = api.getStateSnapshot();
		const range = state.selection.range;
		if (range) {
			selectedRowIdsRef.current = api.rows().inRange(range).getIds();
			const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
			const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);
			selectedColsRef.current =
				startColIdx !== -1 && endColIdx !== -1
					? state.columns.slice(Math.min(startColIdx, endColIdx), Math.max(startColIdx, endColIdx) + 1).map((c) => c.field)
					: [];
		} else {
			selectedRowIdsRef.current = [];
			selectedColsRef.current = [];
		}
		refreshStats();
	}, [api, refreshStats]);

	useEffect(() => {
		if (!api) return;
		updateStatsAndChart();
		const log = (msg: string, type = 'info') =>
			setEventLogs((prev) => [{ id: ++eventLogIdRef.current, time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 10));
		const unsubSelection = api.subscribeToKey('selection', updateStatsAndChart);
		const unsubRows = api.addEventListener(GridEventName.rowsUpdated, () => {
			log('rowsUpdated');
			refreshStats();
		});
		const unsubValue = api.addEventListener(GridEventName.cellValueChanged, () => {
			log('cellValueChanged');
			refreshStats();
		});
		return () => {
			unsubSelection();
			unsubRows();
			unsubValue();
		};
	}, [api, updateStatsAndChart, refreshStats]);

	// ── autoFire (uses raw updateRows — no conflict tracking) ──────────────────

	const triggerVolatility = useCallback(() => {
		if (!api) return;
		api.updateRows((rows) =>
			rows.map((row) => {
				const priceNum = parseFloat(String(row.price)) || 100;
				const volatility = (Math.random() - 0.5) * 8;
				const nextPrice = Math.max(1, priceNum * (1 + volatility / 100));
				const priceDiff = nextPrice - priceNum;
				const changeNum = parseFloat(String(row.change)) || 0;
				const nextChange = changeNum + (priceDiff / priceNum) * 100;
				const volumeNum = parseFloat(String(row.volume)) || 0;
				const nextVolume = Math.max(0.1, volumeNum * (1 + (Math.random() - 0.5) * 0.3));
				return {
					...row,
					price: nextPrice.toFixed(2),
					change: `${nextChange >= 0 ? '+' : ''}${nextChange.toFixed(1)}`,
					volume: nextVolume.toFixed(1),
				};
			})
		);
	}, [api]);

	const toggleAutoFire = useCallback(() => {
		if (!api) return;
		setAutoFire((current) => !current);
	}, [api]);

	useEffect(() => {
		if (autoIntervalRef.current) {
			clearInterval(autoIntervalRef.current);
			autoIntervalRef.current = null;
		}
		if (!autoFire) return;
		autoIntervalRef.current = setInterval(triggerVolatility, autoFireIntervalMs);
		return () => {
			if (autoIntervalRef.current) {
				clearInterval(autoIntervalRef.current);
				autoIntervalRef.current = null;
			}
		};
	}, [autoFire, autoFireIntervalMs, triggerVolatility]);

	useEffect(
		() => () => {
			if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
		},
		[]
	);

	// ── Integrity: Data Quality ────────────────────────────────────────────────

	const handleRunQuality = useCallback(async () => {
		if (!api) return;
		const result = await api.integrity.run({ modules: ['quality'] });
		const issues = result.issues.filter((i) => i.source === 'dataQuality') as GridIntegrityIssue[];
		setQualityIssues(issues);
	}, [api]);

	const handleClearQuality = useCallback(() => {
		if (!api) return;
		api.integrity.clearIssues({ source: 'dataQuality' });
		setQualityIssues(null);
	}, [api]);

	// ── Integrity: Diff ────────────────────────────────────────────────────────

	const handleActivateDiff = useCallback(() => {
		if (!api) return;
		const currentRows = api.rows().getAll() as DashboardStockRow[];
		api.integrity.setDiffModel({
			base: { rows, getRowId: (r: DashboardStockRow) => r.id },
			compare: { rows: currentRows, getRowId: (r: DashboardStockRow) => r.id },
		});
		setDiffActive(true);
	}, [api, rows]);

	const handleClearDiff = useCallback(() => {
		if (!api) return;
		api.integrity.clearDiff();
		setDiffActive(false);
	}, [api]);

	// ── Integrity: Live Stream ─────────────────────────────────────────────────

	const handleStartStream = useCallback(() => {
		if (!api || streamRef.current) return;
		const stream = api.integrity.createStream({
			batchMs: 400,
			flashChanges: true,
			coalesceBy: 'cell',
			dirtyCellPolicy: 'markConflict',
		});
		streamRef.current = stream;
		setStreamRunning(true);

		let tick = 0;
		function pushTick() {
			if (!streamRef.current) return;
			const allRows = rows;
			const n = 3 + (tick % 5);
			const updates = Array.from({ length: n }, (_, j) => {
				const row = allRows[Math.abs(Math.floor(Math.sin((tick * 7 + j) * 1.3) * allRows.length)) % allRows.length];
				const newPrice = parseFloat((parseFloat(row.price) * (0.98 + (tick % 3) * 0.01)).toFixed(2));
				tick++;
				return { rowId: row.id, colField: 'price', value: newPrice };
			});
			stream.push({ cells: updates });
			streamTickRef.current = setTimeout(pushTick, 600 + (tick % 5) * 80);
		}
		pushTick();
	}, [api, rows]);

	const handleStopStream = useCallback(() => {
		if (streamTickRef.current) clearTimeout(streamTickRef.current);
		streamTickRef.current = null;
		streamRef.current?.destroy();
		streamRef.current = null;
		setStreamRunning(false);
	}, []);

	// ── Integrity: Conflicts ───────────────────────────────────────────────────

	const handleInjectConflicts = useCallback(() => {
		if (!api) return;
		const now = Date.now();
		api.integrity.publishIssues('conflict', [
			{
				id: 'ci-AAPL-price',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'AAPL',
				colField: 'price',
				message: 'Conflict: local 173.50 vs remote 168.20',
				createdAt: now,
			},
			{
				id: 'ci-MSFT-volume',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'MSFT',
				colField: 'volume',
				message: 'Conflict: local 42.5 vs remote 38.1',
				createdAt: now,
			},
			{
				id: 'ci-NVDA-change',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'NVDA',
				colField: 'change',
				message: 'Conflict: local +3.4 vs remote -1.2',
				createdAt: now,
			},
		]);
		setConflictCount(3);
	}, [api]);

	const handleClearConflicts = useCallback(() => {
		if (!api) return;
		api.integrity.clearIssues({ source: 'conflict' });
		setConflictCount(0);
	}, [api]);

	// ── Cleanup ────────────────────────────────────────────────────────────────

	useEffect(
		() => () => {
			if (streamTickRef.current) clearTimeout(streamTickRef.current);
			streamRef.current?.destroy();
		},
		[]
	);

	const contextMenuOptions = useMemo<GridContextMenuOptions<DashboardStockRow>>(
		() => ({
			customItems: [
				{ isDivider: true },
				{
					id: 'chart',
					icon: '📊',
					label: 'Show Chart',
					action: ({ api }) => api.openChart(),
					disabled: (params: any) => !params.selection.bounds,
				},
			],
		}),
		[]
	);

	const svgPoints = useMemo(() => {
		if (prices.length < 2) return '';
		const max = Math.max(...prices, 1);
		const min = Math.min(...prices, 0);
		const span = max - min || 1;
		return prices.map((value, index) => `${(index / (prices.length - 1)) * 100},${40 - ((value - min) / span) * 30}`).join(' ');
	}, [prices]);
	const autoFireHzLabel = useMemo(() => (1000 / Math.max(1, autoFireIntervalMs)).toFixed(autoFireIntervalMs >= 100 ? 1 : 2), [autoFireIntervalMs]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				{/* Top bar */}
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0'>
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-emerald-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<TrendingUp className='w-4 h-4 text-emerald-400' />
							Realtime Portfolio Dashboard
						</span>
					</div>
					<div className='flex items-center gap-2'>
						<label className='flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-[10px] font-bold text-slate-400'>
							<span className='uppercase tracking-wider'>Interval</span>
							<input
								type='number'
								min={25}
								step={25}
								value={autoFireIntervalMs}
								onChange={(event) => setAutoFireIntervalMs(Math.max(25, Number(event.target.value) || 25))}
								className='w-16 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-right text-[10px] font-mono text-slate-200 outline-none focus:border-emerald-500'
							/>
							<span className='font-mono text-slate-500'>ms</span>
						</label>
						<button
							onClick={toggleAutoFire}
							className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg font-bold text-[10px] border shadow-lg transition-all cursor-pointer ${
								autoFire
									? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-500/20 shadow-rose-900/20'
									: 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
							}`}
						>
							<Zap className={`w-3 h-3 ${autoFire ? 'animate-pulse' : ''}`} />
							{autoFire ? `Auto ${autoFireHzLabel}hz ON` : `Auto ${autoFireHzLabel}hz`}
						</button>
					</div>
				</div>

				{/* Grid */}
				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={columns}
						styleRules={styleRules}
						enableContextMenu
						contextMenuOptions={contextMenuOptions}
						enableChart
						pinLeftColumns={2}
						enableNavigation
						navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
						onCellValueChanged={onCellValueChanged}
						dataIntegrity={{
							validation: {
								enabled: true,
								validateOnEdit: true,
								cellRules: [
									{
										id: 'price-positive',
										field: 'price',
										severity: 'error',
										blocking: true,
										validate({ value }) {
											const n = parseFloat(String(value));
											if (isNaN(n) || n <= 0) return { message: 'Price must be a positive number' };
											return null;
										},
									},
									{
										id: 'volume-non-negative',
										field: 'volume',
										severity: 'warning',
										blocking: false,
										validate({ value }) {
											const n = parseFloat(String(value));
											if (isNaN(n) || n < 0) return { message: 'Volume cannot be negative' };
											return null;
										},
									},
								],
							},
							quality: {
								enabled: true,
								rules: [
									duplicateValueRule<DashboardStockRow>('symbol'),
									{
										id: 'high-risk-price',
										label: 'High-Risk Price Threshold',
										run(context) {
											return context.rows
												.filter((ref) => {
													const row = ref.row as DashboardStockRow;
													return row.risk === 'high' && parseFloat(String(row.price)) < 100;
												})
												.map((ref) => ({
													id: `high-risk-${ref.rowId}`,
													source: 'dataQuality' as const,
													type: 'custom' as const,
													severity: 'warning' as const,
													blocking: false,
													rowId: ref.rowId,
													colField: 'price',
													message: 'High-risk stock priced below $100 — verify position',
													createdAt: Date.now(),
												}));
										},
									},
								],
							},
							diff: true,
							liveStream: {
								enabled: true,
								dirtyCellPolicy: 'markConflict',
								flashChanges: true,
							},
							conflicts: true,
						}}
						sidebar={{
							panels: ['dataIntegrity'],
							position: 'right',
						}}
						onGridReady={(event) => {
							setApi(event.api);
							onGridReady?.(event);
						}}
					/>
				</div>
			</div>

			{/* Right sidebar */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* Data Integrity Controls */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<ShieldCheck className='w-4 h-4 text-indigo-400' />
						Data Integrity Pipeline
					</h3>

					{/* Quality */}
					<div className='flex flex-col gap-1.5'>
						<div className='text-[9px] font-bold uppercase tracking-widest text-slate-600'>Quality</div>
						<div className='flex gap-2 flex-wrap'>
							<button
								onClick={handleRunQuality}
								className='flex-1 py-1.5 px-2 rounded-lg border border-indigo-700/50 bg-indigo-950/40 text-indigo-300 text-[10px] font-bold hover:bg-indigo-900/40 transition-colors cursor-pointer'
							>
								Run Quality Check
							</button>
							{qualityIssues !== null && (
								<button
									onClick={handleClearQuality}
									className='py-1.5 px-2 rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-400 text-[10px] font-bold hover:bg-slate-700/40 transition-colors cursor-pointer'
								>
									Clear
								</button>
							)}
						</div>
						{qualityIssues !== null && (
							<div className='text-[10px] text-slate-400'>
								{qualityIssues.length} issues —{' '}
								<span className='text-red-400'>{qualityIssues.filter((i) => i.severity === 'error').length} errors</span>{' '}
								<span className='text-amber-400'>{qualityIssues.filter((i) => i.severity === 'warning').length} warnings</span>
							</div>
						)}
					</div>

					{/* Diff */}
					<div className='flex flex-col gap-1.5'>
						<div className='text-[9px] font-bold uppercase tracking-widest text-slate-600'>Diff vs EOD Snapshot</div>
						<div className='flex gap-2'>
							{!diffActive ? (
								<button
									onClick={handleActivateDiff}
									className='flex-1 py-1.5 px-2 rounded-lg border border-amber-700/50 bg-amber-950/40 text-amber-300 text-[10px] font-bold hover:bg-amber-900/40 transition-colors cursor-pointer'
								>
									Activate Diff
								</button>
							) : (
								<button
									onClick={handleClearDiff}
									className='flex-1 py-1.5 px-2 rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-400 text-[10px] font-bold hover:bg-slate-700/40 transition-colors cursor-pointer'
								>
									Clear Diff
								</button>
							)}
						</div>
						{diffActive && <div className='text-[10px] text-amber-400/80'>Diff active — changed cells highlighted</div>}
					</div>

					{/* Live Stream */}
					<div className='flex flex-col gap-1.5'>
						<div className='text-[9px] font-bold uppercase tracking-widest text-slate-600'>Live Stream (Integrity)</div>
						<div className='flex gap-2'>
							{!streamRunning ? (
								<button
									onClick={handleStartStream}
									className='flex-1 py-1.5 px-2 rounded-lg border border-emerald-700/50 bg-emerald-950/40 text-emerald-300 text-[10px] font-bold hover:bg-emerald-900/40 transition-colors cursor-pointer'
								>
									Start Feed
								</button>
							) : (
								<button
									onClick={handleStopStream}
									className='flex-1 py-1.5 px-2 rounded-lg border border-rose-700/50 bg-rose-950/40 text-rose-300 text-[10px] font-bold hover:bg-rose-900/40 transition-colors cursor-pointer'
								>
									Stop Feed
								</button>
							)}
						</div>
						{streamRunning && (
							<div className='text-[10px] text-emerald-400/80 flex items-center gap-1'>
								<span className='w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block' />
								Streaming — edit a cell to trigger a conflict
							</div>
						)}
					</div>

					{/* Conflicts */}
					<div className='flex flex-col gap-1.5'>
						<div className='text-[9px] font-bold uppercase tracking-widest text-slate-600'>Conflicts</div>
						<div className='flex gap-2'>
							<button
								onClick={handleInjectConflicts}
								disabled={conflictCount > 0}
								className='flex-1 py-1.5 px-2 rounded-lg border border-purple-700/50 bg-purple-950/40 text-purple-300 text-[10px] font-bold hover:bg-purple-900/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
							>
								Inject 3 Conflicts
							</button>
							{conflictCount > 0 && (
								<button
									onClick={handleClearConflicts}
									className='py-1.5 px-2 rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-400 text-[10px] font-bold hover:bg-slate-700/40 transition-colors cursor-pointer'
								>
									Clear
								</button>
							)}
						</div>
						{conflictCount > 0 && (
							<div className='text-[10px] text-red-400'>{conflictCount} unresolved — open Conflicts panel to resolve</div>
						)}
					</div>
				</div>

				{/* Selection Analytics */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<BarChart3 className='w-4 h-4 text-emerald-400' />
						Selection Analytics
						{companyCount > 0 && (
							<span className='ml-auto text-[9px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 px-1.5 py-0.5 rounded'>
								{companyCount} {companyCount === 1 ? 'co.' : 'cos.'}
							</span>
						)}
					</h3>
					<div className='grid grid-cols-2 gap-2'>
						{[
							['Count', stats.count],
							['Sum', stats.sum.toFixed(2)],
							['Avg', stats.avg.toFixed(2)],
							['Max', stats.max.toFixed(2)],
						].map(([label, value]) => (
							<div key={label} className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5'>
								<div className='text-[8px] text-slate-500 uppercase font-extrabold'>{label}</div>
								<div className='font-mono text-xs font-bold text-slate-200'>{value}</div>
							</div>
						))}
					</div>
				</div>

				{/* Live Price Sparkline */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Activity className='w-4 h-4 text-cyan-400' />
						Live Price Sparkline
						<span className='ml-auto text-[9px] text-slate-500'>{companyCount > 0 ? 'selection' : 'all rows'}</span>
					</h3>
					<svg className='h-20 w-full rounded-lg border border-slate-900 bg-slate-950/80' viewBox='0 0 100 40' preserveAspectRatio='none'>
						<polyline fill='none' stroke='#10b981' strokeWidth='1.5' points={svgPoints} />
					</svg>
				</div>

				{/* Realtime Event Logger */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-2'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<RefreshCw className='w-4 h-4 text-purple-400' />
						Realtime Event Logger
					</h3>
					{eventLogs.length === 0 ? (
						<div className='text-[10px] text-slate-500'>No events yet.</div>
					) : (
						eventLogs.map((log) => (
							<div key={log.id} className='font-mono text-[10px] text-slate-400'>
								{log.time} · {log.msg}
							</div>
						))
					)}
					<div className='mt-2 flex items-center gap-1.5 text-[10px] text-slate-500'>
						<Code2 className='w-3.5 h-3.5' />
						Data and controls stay in the demo.
					</div>
				</div>
			</div>
		</div>
	);
}
