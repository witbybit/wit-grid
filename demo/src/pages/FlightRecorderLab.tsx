import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUILT_IN_THEMES, Grid, GridEventName, type CellRendererProps, type GridApi, type GridReadyEvent } from '@eregister/wit-grid-react';
import { GridFlightRecorderDevTools } from '@eregister/wit-grid-react/experimental';

interface TraceRow {
	id: string;
	service: string;
	latency: number;
	requests: number;
	score: number;
	status: string;
}

function StatusPulse({ value }: CellRendererProps<TraceRow>) {
	return (
		<span
			className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-extrabold ${value === 'degraded' ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`}
		>
			{String(value)}
		</span>
	);
}

const rows: TraceRow[] = Array.from({ length: 180 }, (_, index) => ({
	id: `svc-${index}`,
	service: `edge-${String(index).padStart(3, '0')}`,
	latency: 12 + ((index * 17) % 220),
	requests: 800 + index * 13,
	score: 0,
	status: index % 9 === 0 ? 'degraded' : 'healthy',
}));

export default function FlightRecorderLab() {
	const [api, setApi] = useState<GridApi<TraceRow> | null>(null);
	const [lastAction, setLastAction] = useState('Ready for evidence');
	const [lightTheme, setLightTheme] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const streamRef = useRef<ReturnType<GridApi<TraceRow>['integrity']['createStream']> | null>(null);
	useEffect(() => () => streamRef.current?.destroy(), []);
	const getRowId = useCallback((row: TraceRow) => row.id, []);
	const dataIntegrity = useMemo(
		() => ({
			validation: {
				validateOnEdit: true,
				validateOnSubmit: true,
				cellRules: [
					{
						id: 'positive-latency',
						field: 'latency',
						severity: 'error' as const,
						blocking: true,
						validate: ({ value }: { value: unknown }) =>
							typeof value === 'number' && value >= 0 ? null : { message: 'Latency must be positive' },
					},
				],
			},
			liveStream: { enabled: true },
			conflicts: { enabled: true },
		}),
		[]
	);
	const columns = useMemo(
		() => [
			{ field: 'service', header: 'Service', width: 150 },
			{ field: 'latency', header: 'Latency ms', width: 130, editable: true },
			{ field: 'requests', header: 'Requests', width: 130, editable: true },
			{
				field: 'score',
				header: 'Computed score',
				width: 155,
				valueGetterDependencies: ['latency', 'requests'],
				valueGetter: ({ row }: { row: TraceRow }) => {
					let value = 0;
					for (let i = 0; i < 1800; i++) value += Math.sqrt(row.latency * row.requests + i);
					return Math.round(value);
				},
			},
			{
				field: 'status',
				header: 'Live state',
				width: 140,
				renderer: { kind: 'react' as const, component: StatusPulse, capabilities: { scrollPresentation: 'freeze' as const } },
			},
		],
		[]
	);
	const action = (label: string, work: () => void) => {
		work();
		setLastAction(label);
	};
	const onReady = (event: GridReadyEvent<TraceRow>) => {
		setApi(event.api);
		event.api.setTheme(BUILT_IN_THEMES.dark);
		event.api.setFormula('svc-2', 'score', '=[svc-1:latency]*[svc-1:requests]');
	};
	const rejectValidation = async () => {
		if (!api) return;
		api.startEditing('svc-1', 'latency');
		api.updateEditDraft('svc-1', 'latency', -12);
		const committed = await api.commitEdit('svc-1', 'latency', -12);
		setLastAction(committed ? 'Unexpectedly accepted edit' : 'Validation rejected the edit; no committed change was fabricated');
	};
	const createConflict = async () => {
		if (!api) return;
		streamRef.current?.destroy();
		api.startEditing('svc-6', 'latency');
		api.updateEditDraft('svc-6', 'latency', 333);
		const stream = api.integrity.createStream({ batchMs: 0, dirtyCellPolicy: 'markConflict' });
		streamRef.current = stream;
		stream.pushCells([{ rowId: 'svc-6', colField: 'latency', value: 910 }]);
		await stream.flush();
		setLastAction(`Live remote update produced ${api.integrity.getConflicts().length} conflict(s)`);
	};
	return (
		<div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cyan-900/40 bg-slate-950 shadow-2xl shadow-cyan-950/30'>
			<div className='flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/90 px-4 py-3'>
				<div className='mr-auto'>
					<p className='text-[10px] font-black uppercase tracking-[.2em] text-cyan-400'>Real causal evidence fixture</p>
					<h2 className='text-lg font-bold text-white'>Flight Recorder Operations Lab</h2>
					<p className='text-xs text-slate-500'>{lastAction}</p>
				</div>
				<button
					className='rounded-lg border border-cyan-700/50 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-100'
					onClick={() => api && action('Accepted edit emitted commit + invalidation', () => api.setCellValue('svc-1', 'latency', 248))}
				>
					Accepted edit
				</button>
				<button
					className='rounded-lg border border-violet-700/50 bg-violet-950/40 px-3 py-2 text-xs font-bold text-violet-100'
					onClick={() =>
						api &&
						action('Batch and formula-dependent cells invalidated', () =>
							api.batchCellValues(
								[
									{ rowId: 'svc-1', colField: 'requests', value: 2400 },
									{ rowId: 'svc-3', colField: 'latency', value: 312 },
								],
								'paste'
							)
						)
					}
				>
					Batch + formula
				</button>
				<button
					className='rounded-lg border border-rose-700/50 bg-rose-950/40 px-3 py-2 text-xs font-bold text-rose-100'
					onClick={rejectValidation}
				>
					Validation reject
				</button>
				<button
					className='rounded-lg border border-fuchsia-700/50 bg-fuchsia-950/40 px-3 py-2 text-xs font-bold text-fuchsia-100'
					onClick={createConflict}
				>
					Live conflict
				</button>
				<button
					className='rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-100'
					onClick={() =>
						api &&
						action('Runtime listener fault captured by the authoritative reporter', () => {
							const remove = api.addEventListener(GridEventName.cellValueChanged, () => {
								remove();
								throw new Error('Demo listener fault');
							});
							api.setCellValue('svc-4', 'latency', 401);
						})
					}
				>
					Runtime fault
				</button>
				<button
					className='rounded-lg border border-slate-600/60 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-100'
					onClick={() => {
						const next = !lightTheme;
						setLightTheme(next);
						api?.setTheme(BUILT_IN_THEMES[next ? 'light' : 'dark']);
					}}
				>
					{lightTheme ? 'Switch to dark' : 'Switch to light'}
				</button>
				<button
					className='rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-100'
					onClick={() =>
						action('Stress scroll requested; inspect the trace for an observed renderer fallback', () => {
							const viewport = rootRef.current?.querySelector<HTMLElement>('.og-scroll-viewport');
							if (viewport) {
								viewport.scrollTop = 1600;
								viewport.dispatchEvent(new Event('scroll'));
							}
						})
					}
				>
					Stress scroll
				</button>
			</div>
			<div ref={rootRef} className='relative flex min-h-0 flex-1 overflow-hidden'>
				<div className='demo-grid-surface min-h-0 flex-1'>
					<Grid rows={rows} columns={columns} getRowId={getRowId} onGridReady={onReady} dataIntegrity={dataIntegrity} />
				</div>
				{api && <GridFlightRecorderDevTools api={api} defaultDock='right' capacity={512} />}
			</div>
		</div>
	);
}
