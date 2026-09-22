import React, { useEffect, useMemo, useState } from 'react';
import { Grid, GridEventName, type GridApi, type GridReadyEvent, type GridStateSnapshot } from '@eregister/wit-grid-react';
import { AlertTriangle, BarChart3, Gauge, Play, ShieldCheck, Star } from 'lucide-react';
import { createCustomColumns, generateCustomShowcaseRows } from './demoGridConfigs';
import type { CustomShowcaseRow } from '../components/GridShared';

interface CustomEditorRendererProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<CustomShowcaseRow>) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CustomEditorRenderer({
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: CustomEditorRendererProps) {
	const columns = useMemo(() => createCustomColumns(), []);
	const rows = useMemo(() => generateCustomShowcaseRows(50), []);
	const [api, setApi] = useState<GridApi<CustomShowcaseRow> | null>(null);
	const [selectedRange, setSelectedRange] = useState<GridStateSnapshot<CustomShowcaseRow>['selection']['range']>(null);
	const [telemetry, setTelemetry] = useState({
		totalAssets: 0,
		totalValuation: 0,
		avgRating: 0,
		lowDeploymentAlerts: 0,
		activeCount: 0,
		pendingCount: 0,
		inactiveCount: 0,
	});

	useEffect(() => {
		if (!api) return;
		const calculateTelemetry = () => {
			let total = 0,
				valSum = 0,
				ratingSum = 0,
				ratingCount = 0,
				lowDep = 0,
				active = 0,
				pending = 0,
				inactive = 0;
			api.rows().forEach((row) => {
				total++;
				valSum += parseFloat(String(row.price).replace(/[^0-9.-]+/g, '')) || 0;
				const rating = parseFloat(String(row.rating)) || 0;
				if (rating > 0) {
					ratingSum += rating;
					ratingCount++;
				}
				if ((parseFloat(String(row.progress)) || 0) < 30) lowDep++;
				if (row.status === 'Active') active++;
				else if (row.status === 'Pending') pending++;
				else inactive++;
			});
			setTelemetry({
				totalAssets: total,
				totalValuation: valSum,
				avgRating: ratingCount ? ratingSum / ratingCount : 0,
				lowDeploymentAlerts: lowDep,
				activeCount: active,
				pendingCount: pending,
				inactiveCount: inactive,
			});
		};
		const updateSelection = () => setSelectedRange(api.getStateSnapshot().selection.range);
		calculateTelemetry();
		updateSelection();
		const unsubValue = api.addEventListener(GridEventName.cellValueChanged, calculateTelemetry);
		const unsubSelection = api.subscribeToKey('selection', updateSelection);
		return () => {
			unsubValue();
			unsubSelection();
		};
	}, [api]);

	const handleBatchActivate = () => {
		if (!api || !selectedRange) return alert('Please select a range of cells or rows first.');
		const rowIdSet = new Set(api.rows().inRange(selectedRange).getIds());
		api.updateRows((rows) => rows.map((row) => (rowIdSet.has(row.id) ? { ...row, status: 'Active' } : row)));
	};

	const handleBatchBoostProgress = () => {
		if (!api || !selectedRange) return alert('Please select a range of cells or rows first.');
		const rowIdSet = new Set(api.rows().inRange(selectedRange).getIds());
		api.updateRows((rows) =>
			rows.map((row) => {
				if (!rowIdSet.has(row.id)) return row;
				return { ...row, progress: Math.min(100, (parseFloat(String(row.progress)) || 0) + 10).toString() };
			})
		);
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0'>
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-indigo-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<ShieldCheck className='w-4 h-4 text-indigo-400' />
							Enterprise Asset Control Desk (Interactive Slide Editors)
						</span>
					</div>
					<div className='text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono bg-slate-950/60 border border-slate-900 px-2 py-0.5 rounded'>
						High Fidelity Custom Cell Editors
					</div>
				</div>
				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={columns}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						enableNavigation
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
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<BarChart3 className='w-4 h-4 text-indigo-400' />
						Asset Value & Telemetry
					</h3>
					<div className='grid grid-cols-2 gap-2 mt-1'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5 col-span-2'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Total Value Assets</span>
							<span className='font-mono text-sm font-bold text-emerald-400'>
								${telemetry.totalValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Total Inventory</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{telemetry.totalAssets} Units</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Average Rating</span>
							<span className='font-mono text-xs font-bold text-amber-400 flex items-center gap-1'>
								<Star className='w-3.5 h-3.5 fill-amber-400 stroke-none' />
								{telemetry.avgRating.toFixed(2)}
							</span>
						</div>
					</div>
					{telemetry.lowDeploymentAlerts > 0 && (
						<div className='flex items-center gap-1.5 bg-rose-950/20 border border-rose-950/60 p-2 rounded text-[9px] text-rose-400 font-medium leading-relaxed'>
							<AlertTriangle className='w-3.5 h-3.5 text-rose-400 shrink-0' />
							<span>{telemetry.lowDeploymentAlerts} assets are below 30% deployment.</span>
						</div>
					)}
				</div>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Gauge className='w-4 h-4 text-purple-400' />
						Lifecycle Operations
					</h3>
					{[
						['ACTIVE STATE', telemetry.activeCount, 'bg-emerald-500', 'text-emerald-400'],
						['PENDING REVIEW', telemetry.pendingCount, 'bg-amber-500', 'text-amber-400'],
						['DECOMMISSIONED', telemetry.inactiveCount, 'bg-rose-500', 'text-rose-400'],
					].map(([label, count, bar, text]) => (
						<div key={String(label)} className='flex flex-col gap-1'>
							<div className='flex justify-between text-[8px] font-mono text-slate-400'>
								<span className={`${text} font-bold uppercase`}>{label}</span>
								<span>{count} assets</span>
							</div>
							<div className='w-full bg-slate-950 border border-slate-900 h-2 rounded-full overflow-hidden'>
								<div
									className={`${bar} h-full rounded-full transition-all duration-500`}
									style={{ width: `${(Number(count) / (telemetry.totalAssets || 1)) * 100}%` }}
								/>
							</div>
						</div>
					))}
				</div>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Play className='w-4 h-4 text-emerald-400' />
						Batch Operations Desk
					</h3>
					<button
						onClick={handleBatchActivate}
						className='py-2 text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 border border-emerald-950 bg-emerald-950/20 hover:bg-emerald-950/40 rounded'
					>
						Activate Selection Range
					</button>
					<button
						onClick={handleBatchBoostProgress}
						className='py-2 text-[9px] font-extrabold uppercase tracking-wider text-purple-400 border border-purple-950 bg-purple-950/20 hover:bg-purple-950/40 rounded'
					>
						Boost Deployment (+10%)
					</button>
				</div>
			</div>
		</div>
	);
}
