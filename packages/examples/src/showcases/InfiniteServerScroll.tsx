import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Grid, GridEventName } from '@eregister/wit-grid-react';
import type { GridApi, GridReadyEvent } from '@eregister/wit-grid-react';
import { Terminal, Server, Activity, ShieldAlert, Cpu } from 'lucide-react';
import { createServerColumns, createServerDatasource, createServerRows, type ServerAuditRow } from './server-scroll-data';

interface InfiniteServerScrollProps {
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
	pinLeftColumns?: number;
	pinRightColumns?: number;
	onGridReady?: (event: GridReadyEvent<ServerAuditRow>) => void;
}

type SeverityStats = {
	totalLoaded: number;
	criticalError: number;
	warning: number;
	infoDebug: number;
};

type ServerFailure = {
	blockIndex: number;
	startRow: number;
	endRow: number;
	message: string;
} | null;

type SelectionStats = {
	totalSelectedIds: number;
	loadedSelectedRows: number;
	unloadedSelectedRows: number;
};

export default function InfiniteServerScroll({
	editTrigger = 'doubleClick',
	arrowKeyNavigationEdit = false,
	pinLeftColumns = 0,
	pinRightColumns = 0,
	onGridReady,
}: InfiniteServerScrollProps) {
	const gridHostRef = useRef<HTMLDivElement>(null);
	const [api, setApi] = useState<GridApi<ServerAuditRow> | null>(null);
	const rows = useMemo(() => createServerRows(), []);
	const columns = useMemo(() => createServerColumns(), []);
	const datasource = useMemo(() => createServerDatasource(rows), [rows]);
	const [blockStats, setBlockStats] = useState({
		loadedBlockStart: 0,
		loadedBlockEnd: 0,
		totalRecords: rows.length,
		durationMs: 0,
	});

	const [isLoading, setIsLoading] = useState(false);
	const [lastFailure, setLastFailure] = useState<ServerFailure>(null);
	const [latencyHistory, setLatencyHistory] = useState<number[]>([45, 80, 55, 120, 95, 60, 110, 85]);
	const [severityStats, setSeverityStats] = useState<SeverityStats>({
		totalLoaded: 0,
		criticalError: 0,
		warning: 0,
		infoDebug: 0,
	});
	const [selectionStats, setSelectionStats] = useState<SelectionStats>({
		totalSelectedIds: 0,
		loadedSelectedRows: 0,
		unloadedSelectedRows: 0,
	});

	const refreshSeverityStats = useCallback(() => {
		if (!api) return;
		let totalLoaded = 0;
		let criticalError = 0;
		let warning = 0;
		let infoDebug = 0;

		api.rows().forEach((row: any) => {
			totalLoaded++;
			const severity = String(row.severity ?? '').toUpperCase();

			if (severity === 'CRITICAL' || severity === 'ERROR') {
				criticalError++;
			} else if (severity === 'WARNING') {
				warning++;
			} else if (severity === 'INFO' || severity === 'DEBUG') {
				infoDebug++;
			}
		});

		setSeverityStats({ totalLoaded, criticalError, warning, infoDebug });
	}, [api]);

	const refreshSelectionStats = useCallback(() => {
		if (!api) return;
		const totalSelectedIds = api.rows().getCheckedIds().length;
		const loadedSelectedRows = api.rows().getChecked().length;
		setSelectionStats({
			totalSelectedIds,
			loadedSelectedRows,
			unloadedSelectedRows: Math.max(0, totalSelectedIds - loadedSelectedRows),
		});
	}, [api]);

	useEffect(() => {
		if (!api) return;
		const handleBlockLoaded = (event: {
			payload: {
				loadedBlockStart?: number;
				loadedBlockEnd?: number;
				totalRecords?: number;
				durationMs?: number;
			};
		}) => {
			const { loadedBlockStart, loadedBlockEnd, totalRecords, durationMs } = event.payload || {};
			setBlockStats((prev) => ({
				loadedBlockStart: loadedBlockStart ?? 0,
				loadedBlockEnd: loadedBlockEnd ?? 0,
				totalRecords: Math.max(prev.totalRecords, totalRecords ?? 0, rows.length),
				durationMs: durationMs ?? 0,
			}));

			if (durationMs !== undefined) {
				setLatencyHistory((prev) => [...prev.slice(-9), Math.round(durationMs)]);
			}

			refreshSeverityStats();
			refreshSelectionStats();
		};
		const handleBlockLoadFailed = (event: { payload: { blockIndex: number; startRow: number; endRow: number; message: string } }) => {
			setLastFailure(event.payload);
		};

		const clearSeverityStats = () => {
			setSeverityStats({ totalLoaded: 0, criticalError: 0, warning: 0, infoDebug: 0 });
		};
		const syncLoading = () => {
			setIsLoading(!!api.getStateSnapshot().loading);
		};

		refreshSeverityStats();
		refreshSelectionStats();
		syncLoading();
		const unsubBlockLoaded = api.addEventListener(GridEventName.infiniteBlockLoaded, handleBlockLoaded);
		const unsubBlockLoadFailed = api.addEventListener(GridEventName.infiniteBlockLoadFailed, handleBlockLoadFailed);
		const unsubCellValueChanged = api.addEventListener(GridEventName.cellValueChanged, refreshSeverityStats);
		const unsubSelectionChanged = api.addEventListener(GridEventName.rowSelectionChanged, refreshSelectionStats);
		const unsubSortChanged = api.addEventListener(GridEventName.sortChanged, clearSeverityStats);
		const unsubFilterChanged = api.addEventListener(GridEventName.filterChanged, clearSeverityStats);
		const unsubLoading = api.subscribeToKey('loading', syncLoading);
		return () => {
			unsubBlockLoaded();
			unsubBlockLoadFailed();
			unsubCellValueChanged();
			unsubSelectionChanged();
			unsubSortChanged();
			unsubFilterChanged();
			unsubLoading();
		};
	}, [api, refreshSeverityStats, refreshSelectionStats]);

	const severityDistribution = useMemo(() => {
		const total = severityStats.totalLoaded;
		const toPercent = (value: number) => (total > 0 ? (value / total) * 100 : 0);

		return {
			criticalErrorPercent: toPercent(severityStats.criticalError),
			warningPercent: toPercent(severityStats.warning),
			infoDebugPercent: toPercent(severityStats.infoDebug),
		};
	}, [severityStats]);

	// Visual sparkline coordinates
	const svgPoints = useMemo(() => {
		const max = Math.max(...latencyHistory, 200);
		const min = Math.min(...latencyHistory, 20);
		const range = max - min || 1;
		return latencyHistory
			.map((val, idx) => {
				const x = (idx / (latencyHistory.length - 1)) * 100;
				const y = 40 - ((val - min) / range) * 30; // Scale between y=10 and y=40
				return `${x},${y}`;
			})
			.join(' ');
	}, [latencyHistory]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left Column: Log Grid Panel */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-rose-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-rose-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<Terminal className='w-3.5 h-3.5 text-rose-500' />
							Virtualized System Audit Logs (100K Records)
						</span>
					</div>
					<div className='text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono bg-slate-950/60 border border-slate-900 px-2 py-0.5 rounded'>
						Server-Side Virtualization
					</div>
				</div>

				<div ref={gridHostRef} className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='infinite'
						columns={columns}
						datasource={datasource}
						blockSize={100}
						getRowId={(row) => row.id}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						enableNavigation
						navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
						onGridReady={(event) => {
							setApi(event.api);
							setIsLoading(!!event.api.getStateSnapshot().loading);
							onGridReady?.(event);
						}}
					/>
				</div>
				<div className='flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[10px] font-mono text-slate-300'>
					<div className='flex items-center gap-2'>
						<span className={`h-2 w-2 rounded-full ${isLoading ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'}`} />
						<span>{isLoading ? 'Loading server blocks' : 'Server blocks idle'}</span>
						{lastFailure ? <span className='rounded bg-rose-950/60 px-2 py-0.5 text-rose-300'>Last fetch failed</span> : null}
					</div>
					{lastFailure ? (
						<button
							type='button'
							onClick={() => {
								setLastFailure(null);
								api?.purgeCache();
							}}
							className='rounded border border-rose-700/60 bg-rose-950/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-200'
						>
							Retry Block Load
						</button>
					) : null}
				</div>
			</div>

			{/* Right Column: Auditor Telemetry Sidebar */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				{/* 1. SEVERITY TELEMETRY CARD */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-rose-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<ShieldAlert className='w-4 h-4 text-rose-500' />
						Log Severity Auditor Panel
					</h3>

					<div className='flex flex-col gap-2 mt-1'>
						<div className='flex justify-between items-center bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg'>
							<div className='flex flex-col'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Last Block Loaded</span>
								<span className='font-mono text-xs font-bold text-slate-200'>
									Rows {blockStats.loadedBlockStart} - {blockStats.loadedBlockEnd}
								</span>
							</div>
							<Server className='w-5 h-5 text-slate-500' />
						</div>

						<div className='grid grid-cols-2 gap-2'>
							<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Load Latency</span>
								<span className='font-mono text-xs font-bold text-amber-400 text-glow-amber'>
									{blockStats.durationMs > 0 ? `${blockStats.durationMs.toFixed(0)}ms` : '3000ms (Sim)'}
								</span>
							</div>
							<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Total Capacity</span>
								<span className='font-mono text-xs font-bold text-slate-200'>{blockStats.totalRecords.toLocaleString()}</span>
							</div>
						</div>
						{lastFailure ? (
							<div className='rounded-lg border border-rose-900/70 bg-rose-950/25 p-2.5 text-[9px] text-rose-200'>
								<div className='font-extrabold uppercase tracking-wider text-rose-300'>Block fetch failure</div>
								<div className='mt-1 font-mono'>
									Block {lastFailure.blockIndex} ({lastFailure.startRow}-{lastFailure.endRow}): {lastFailure.message}
								</div>
							</div>
						) : null}
					</div>

					<div className='border-t border-slate-900/60 pt-3 mt-1 flex flex-col gap-2.5'>
						<div className='flex items-center justify-between gap-2'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Severity Distribution</span>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-mono'>
								{severityStats.totalLoaded.toLocaleString()} loaded
							</span>
						</div>
						<div className='flex flex-col gap-2'>
							{/* Critical / Error */}
							<div className='flex items-center justify-between text-[9px] font-mono'>
								<span className='text-rose-400 font-extrabold'>CRITICAL / ERROR</span>
								<span className='text-slate-400'>
									{severityDistribution.criticalErrorPercent.toFixed(1)}% ({severityStats.criticalError})
								</span>
							</div>
							<div className='w-full bg-slate-950 border border-slate-900 rounded-full h-1.5 overflow-hidden'>
								<div className='h-full bg-rose-500 rounded-full' style={{ width: `${severityDistribution.criticalErrorPercent}%` }} />
							</div>

							{/* Warning */}
							<div className='flex items-center justify-between text-[9px] font-mono'>
								<span className='text-amber-400 font-extrabold'>WARNING</span>
								<span className='text-slate-400'>
									{severityDistribution.warningPercent.toFixed(1)}% ({severityStats.warning})
								</span>
							</div>
							<div className='w-full bg-slate-950 border border-slate-900 rounded-full h-1.5 overflow-hidden'>
								<div className='h-full bg-amber-500 rounded-full' style={{ width: `${severityDistribution.warningPercent}%` }} />
							</div>

							{/* Info / Debug */}
							<div className='flex items-center justify-between text-[9px] font-mono'>
								<span className='text-emerald-400 font-extrabold'>INFO / DEBUG</span>
								<span className='text-slate-400'>
									{severityDistribution.infoDebugPercent.toFixed(1)}% ({severityStats.infoDebug})
								</span>
							</div>
							<div className='w-full bg-slate-950 border border-slate-900 rounded-full h-1.5 overflow-hidden'>
								<div className='h-full bg-emerald-500 rounded-full' style={{ width: `${severityDistribution.infoDebugPercent}%` }} />
							</div>
						</div>
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Server className='w-4 h-4 text-violet-400' />
						Selection Persistence Monitor
					</h3>
					<div className='grid grid-cols-1 gap-2 text-[9px] font-mono'>
						<div className='flex items-center justify-between rounded border border-slate-900 bg-slate-950/60 px-2.5 py-2'>
							<span className='text-slate-400 uppercase tracking-wider'>Selected Row IDs</span>
							<span className='text-slate-100 font-bold'>{selectionStats.totalSelectedIds}</span>
						</div>
						<div className='flex items-center justify-between rounded border border-emerald-950/50 bg-emerald-950/15 px-2.5 py-2'>
							<span className='text-emerald-300 uppercase tracking-wider'>Loaded Selected Rows</span>
							<span className='text-emerald-100 font-bold'>{selectionStats.loadedSelectedRows}</span>
						</div>
						<div className='flex items-center justify-between rounded border border-amber-950/50 bg-amber-950/15 px-2.5 py-2'>
							<span className='text-amber-300 uppercase tracking-wider'>Pending Unloaded Selection</span>
							<span className='text-amber-100 font-bold'>{selectionStats.unloadedSelectedRows}</span>
						</div>
					</div>
					<p className='text-[9px] text-slate-500 leading-relaxed font-medium mt-1'>
						Checked row ids persist even when their blocks are not mounted. The loaded count catches back up as those blocks stream back
						in.
					</p>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Cpu className='w-4 h-4 text-cyan-400' />
						Custom Renderer Lifecycle Lab
					</h3>
					<div className='grid grid-cols-1 gap-2 text-[9px] font-mono'>
						<div className='flex items-center justify-between rounded border border-emerald-950/50 bg-emerald-950/15 px-2.5 py-2'>
							<span className='text-slate-300 font-bold'>Live Rebind</span>
							<span className='text-emerald-300 uppercase tracking-wider'>phase=scroll</span>
						</div>
						<div className='flex items-center justify-between rounded border border-indigo-950/50 bg-indigo-950/15 px-2.5 py-2'>
							<span className='text-slate-300 font-bold'>Defer Stable</span>
							<span className='text-indigo-300 uppercase tracking-wider'>snapshot then idle</span>
						</div>
						<div className='flex items-center justify-between rounded border border-amber-950/50 bg-amber-950/15 px-2.5 py-2'>
							<span className='text-slate-300 font-bold'>Fallback Cache</span>
							<span className='text-amber-300 uppercase tracking-wider'>cached text</span>
						</div>
						<div className='flex items-center justify-between rounded border border-rose-950/50 bg-rose-950/15 px-2.5 py-2'>
							<span className='text-slate-300 font-bold'>Destroy Recycle</span>
							<span className='text-rose-300 uppercase tracking-wider'>no warm cache</span>
						</div>
					</div>
				</div>

				{/* 2. LATENCY ANALYSIS CARD */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Activity className='w-4 h-4 text-emerald-400' />
						Trace Load Performance
					</h3>

					{/* SVG Latency Sparkline */}
					<div className='w-full bg-slate-950/80 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-1.5'>
						<div className='flex items-center justify-between text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>
							<span>Fetch Latency Trend</span>
							<span className='font-mono text-emerald-400 text-glow-emerald'>
								Avg: {Math.round(latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length)}ms
							</span>
						</div>
						<div className='h-12 w-full mt-1 relative overflow-hidden'>
							<svg className='w-full h-full' viewBox='0 0 100 40' preserveAspectRatio='none'>
								<defs>
									<linearGradient id='latencyGrad' x1='0' y1='0' x2='0' y2='1'>
										<stop offset='0%' stopColor='#10b981' stopOpacity='0.25' />
										<stop offset='100%' stopColor='#10b981' stopOpacity='0.0' />
									</linearGradient>
								</defs>
								{/* Area fill */}
								<path d={`M 0,40 L ${svgPoints} L 100,40 Z`} fill='url(#latencyGrad)' />
								{/* Line */}
								<polyline fill='none' stroke='#10b981' strokeWidth='1.5' points={svgPoints} />
							</svg>
						</div>
					</div>

					<p className='text-[9px] text-slate-500 leading-relaxed font-medium mt-1'>
						The server-side model fetches logs dynamically in chunks of 100 on-demand, caching blocks to optimize memory and network
						throughput.
					</p>
				</div>
			</div>
		</div>
	);
}
