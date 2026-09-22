import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid, GridEventName, type GridApi, type GridReadyEvent, type StyleRule } from '@eregister/wit-grid-react';
import { CheckSquare, Clock, Layers, RefreshCw, Sparkles, TrendingUp, Users, Zap } from 'lucide-react';
import { createGanttColumns, createGanttRows, type GanttRow } from './demoGridConfigs';

interface GanttSchedulingWorkspaceProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<GanttRow>) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function GanttSchedulingWorkspace({
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: GanttSchedulingWorkspaceProps) {
	const [api, setApi] = useState<GridApi<GanttRow> | null>(null);
	const [selectedRange, setSelectedRange] = useState<unknown>(null);
	const [revision, setRevision] = useState(0);
	const rows = useMemo(() => createGanttRows(), []);
	const columns = useMemo(() => createGanttColumns(), []);

	const styleRules = useMemo<StyleRule<GanttRow>[]>(
		() => [
			{
				kind: 'row',
				when: (row) => row.status === 'Blocked',
				rowClass: 'transition-all duration-200 border-l-2 border-rose-500/80 bg-rose-950/5 hover:bg-rose-900/10 text-rose-200/90',
			},
			{
				kind: 'row',
				when: (row) => row.status === 'Done',
				rowClass: 'transition-all duration-200 border-l-2 border-emerald-500/80 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-200/90',
			},
			{
				kind: 'row',
				when: (row) => row.status === 'In Progress',
				rowClass: 'transition-all duration-200 border-l-2 border-indigo-500/50 bg-indigo-950/5 hover:bg-indigo-900/10',
			},
			{
				kind: 'row',
				when: (row) => row.status === 'Pending',
				rowClass: 'transition-all duration-200 border-l-2 border-slate-800 bg-slate-900/5 hover:bg-slate-800/10',
			},
			{
				kind: 'cell',
				field: 'progress',
				when: (row) => Number(row.progress) >= 90,
				cellClass: 'text-emerald-400 font-extrabold font-mono shadow-sm',
			},
			{
				kind: 'cell',
				field: 'status',
				when: (row) => row.status === 'Blocked',
				cellClass: 'animate-pulse text-rose-400 font-semibold',
			},
			{
				kind: 'headerCell',
				field: 'timeline',
				when: () => true,
				headerCellClass:
					'bg-gradient-to-r from-slate-900 via-indigo-950/30 to-slate-900 text-indigo-300 font-bold border-b border-indigo-900/30',
			},
			{
				kind: 'headerCell',
				when: (col) => col.field !== 'timeline',
				headerCellClass: 'font-semibold text-slate-400',
			},
		],
		[]
	);

	useEffect(() => {
		if (!api) return;
		const readSelection = () => setSelectedRange(api.getStateSnapshot().selection.range ?? null);
		readSelection();
		const unsubSelection = api.subscribeToKey('selection', readSelection);
		const unsubCell = api.addEventListener(GridEventName.cellValueChanged, () => setRevision((value) => value + 1));
		return () => {
			unsubSelection();
			unsubCell();
		};
	}, [api]);

	const stats = useMemo(() => {
		const currentRows = api?.rows().getAll() ?? rows;
		let done = 0;
		let blocked = 0;
		let progressSum = 0;
		let totalDuration = 0;
		for (const row of currentRows) {
			if (row.status === 'Done') done++;
			if (row.status === 'Blocked') blocked++;
			progressSum += Number(row.progress) || 0;
			totalDuration += Number(row.durationDays) || 0;
		}
		return {
			total: currentRows.length,
			done,
			blocked,
			progressAvg: currentRows.length > 0 ? progressSum / currentRows.length : 0,
			totalDuration,
		};
	}, [api, rows, revision, selectedRange]);

	const handleAutoSolveConflicts = useCallback(() => {
		if (!api) return;
		const start = performance.now();
		let currentDay = 1;
		const updates: GanttRow[] = [];
		api.rows().forEach((row) => {
			updates.push({ ...row, sprintDay: currentDay });
			currentDay += Number(row.durationDays) || 2;
		});
		api.applyTransaction({ update: updates });
		setRevision((value) => value + 1);
		alert(`Sprint Scheduling Overlaps Auto-Resolved! (Shifted coordinate dates sequentially in ${(performance.now() - start).toFixed(2)}ms)`);
	}, [api]);

	const handleBatchExpedite = useCallback(() => {
		if (!api) return;
		const range = api.getStateSnapshot().selection.range;
		if (!range) {
			alert('Please select a range of cells using drag selection first.');
			return;
		}
		const rowIdSet = new Set(api.rows().inRange(range).getIds());
		api.updateRows((rows) => rows.map((row) => (rowIdSet.has(row.id) ? { ...row, progress: 100, status: 'Done' } : row)));
		setRevision((value) => value + 1);
	}, [api]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-950/80 border border-slate-900 rounded-xl p-3 flex items-center justify-between shrink-0 shadow-lg relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-indigo-500 animate-pulse' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>Gantt Scheduling Arena</span>
					</div>
					<div className='text-slate-400 font-medium text-[10px] bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 font-mono flex items-center gap-1 shrink-0'>
						<span>Drag glowing anchor handle at selection bottom-right to autocomplete/extrapolate sprint days & sequences!</span>
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={columns}
						getRowId={(row) => row.id}
						styleRules={styleRules}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
						onCellValueChanged={onCellValueChanged}
						onGridReady={(event) => {
							setApi(event.api);
							onGridReady?.(event);
						}}
					/>
				</div>
			</div>

			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-4 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5'>
						<Clock className='w-4 h-4 text-indigo-400' />
						Sprint Project Analytics
					</h3>
					<div className='grid grid-cols-2 gap-2'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<Layers className='w-3 h-3 text-slate-500' /> Total Tasks
							</span>
							<span className='font-mono text-[14px] font-bold text-slate-100 mt-1'>{stats.total}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<Users className='w-3 h-3 text-indigo-400' /> Team Capacity
							</span>
							<span className='font-mono text-[14px] font-bold text-slate-100 mt-1'>{stats.totalDuration} days</span>
						</div>
					</div>
					<div className='grid grid-cols-2 gap-2'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col border-l-2 border-l-emerald-500'>
							<span className='text-[8px] text-emerald-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<CheckSquare className='w-3 h-3 text-emerald-500' /> Completed
							</span>
							<span className='font-mono text-[14px] font-bold text-emerald-400 mt-1'>{stats.done} Tasks</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col border-l-2 border-l-rose-500'>
							<span className='text-[8px] text-rose-500 uppercase tracking-wider font-extrabold flex items-center gap-1'>
								<Zap className='w-3 h-3 text-rose-500' /> Blocked
							</span>
							<span className='font-mono text-[14px] font-bold text-rose-400 mt-1'>{stats.blocked} Tasks</span>
						</div>
					</div>
					<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-4 flex flex-col items-center justify-center text-center mt-1 relative overflow-hidden'>
						<span className='text-[8px] text-slate-400 uppercase tracking-wider font-extrabold mb-3 flex items-center gap-1.5'>
							<TrendingUp className='w-3.5 h-3.5 text-indigo-400' />
							Sprint Completion Rate
						</span>
						<svg className='w-24 h-24 transform -rotate-90' viewBox='0 0 100 100'>
							<circle cx='50' cy='50' r='40' stroke='#1e293b' strokeWidth='8' fill='transparent' />
							<circle
								cx='50'
								cy='50'
								r='40'
								stroke='#6366f1'
								strokeWidth='8'
								fill='transparent'
								strokeDasharray={2 * Math.PI * 40}
								strokeDashoffset={2 * Math.PI * 40 * (1 - stats.progressAvg / 100)}
								strokeLinecap='round'
								className='transition-all duration-500'
								style={{ filter: 'drop-shadow(0 0 4px rgba(99, 102, 241, 0.4))' }}
							/>
						</svg>
						<span className='absolute font-mono text-[15px] font-bold text-slate-100 top-[52%] translate-y-[-50%]'>
							{stats.progressAvg.toFixed(1)}%
						</span>
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<h3 className='text-[10px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5'>
						<Sparkles className='w-4 h-4 text-purple-400' />
						Sprint Scheduling Optimizer
					</h3>
					<p className='text-[9px] text-slate-500 font-medium leading-normal'>
						Run programmatic scheduling algorithms or batch optimize workflows instantly over the active viewport data.
					</p>
					<div className='flex flex-col gap-2 mt-1'>
						<button
							onClick={handleAutoSolveConflicts}
							className='w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95'
						>
							<RefreshCw className='w-3.5 h-3.5 animate-spin' />
							Auto-Solve Overlaps
						</button>
						<button
							onClick={handleBatchExpedite}
							className='w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-extrabold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95'
						>
							<CheckSquare className='w-3.5 h-3.5' />
							Batch Complete Selection
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
