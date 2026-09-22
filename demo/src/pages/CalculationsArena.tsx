import React, { useEffect, useMemo, useState } from 'react';
import { Grid, GridEventName, type GridApi, type GridReadyEvent, type StyleRule } from '@eregister/wit-grid-react';
import { Activity, BadgePercent, ShieldAlert } from 'lucide-react';
import { createPerformanceColumns, generatePerformanceRows } from './demoGridConfigs';
import type { PerformanceRow } from '../components/GridShared';

interface CalculationsArenaProps {
	massiveColumns?: boolean;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<PerformanceRow>) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function CalculationsArena({
	massiveColumns = false,
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: CalculationsArenaProps) {
	const [api, setApi] = useState<GridApi<PerformanceRow> | null>(null);
	const columns = useMemo(() => createPerformanceColumns(massiveColumns), [massiveColumns]);
	const rows = useMemo(() => generatePerformanceRows(10000, 'R'), []);
	const [telemetry, setTelemetry] = useState({ totalContracts: 0, avgVol: 0, sumDelta: 0, avgVega: 0, highRiskCount: 0 });

	const styleRules = useMemo<StyleRule<PerformanceRow>[]>(
		() => [
			{
				kind: 'row',
				when: (row) => row.status === 'Inactive',
				rowClass: 'transition-all duration-200 border-l-2 border-rose-500/80 bg-rose-950/5 hover:bg-rose-900/10 text-rose-200/90',
			},
			{
				kind: 'row',
				when: (row) => row.status === 'Pending',
				rowClass: 'transition-all duration-200 border-l-2 border-amber-500/60 bg-amber-950/5 hover:bg-amber-900/10 text-amber-200/90',
			},
			{
				kind: 'row',
				when: (row) => row.status === 'Active',
				rowClass: 'transition-all duration-200 border-l-2 border-emerald-500/40 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-200/90',
			},
			{ kind: 'cell', field: 'status', when: (row) => row.status === 'Inactive', cellClass: 'text-rose-400 font-bold animate-pulse' },
			{ kind: 'cell', field: 'status', when: (row) => row.status === 'Pending', cellClass: 'text-amber-400 font-bold' },
			{ kind: 'cell', field: 'status', when: (row) => row.status === 'Active', cellClass: 'text-emerald-400 font-bold' },
		],
		[]
	);

	useEffect(() => {
		if (!api) return;
		const calculateTelemetry = () => {
			let volSum = 0;
			let deltaSum = 0;
			let vegaSum = 0;
			let highRisk = 0;
			let count = 0;
			api.rows().forEach((row) => {
				count++;
				const vol = parseFloat(row.quantity) || 0;
				volSum += vol;
				const strike = parseFloat(row.price) || 100;
				const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
				deltaSum += 0.5 + 0.5 * Math.tanh(d1);
				vegaSum += (100 * Math.exp((-d1 * d1) / 2)) / Math.sqrt(2 * Math.PI) / 100;
				if (row.status === 'Inactive') highRisk++;
			});
			setTelemetry({
				totalContracts: count,
				avgVol: count ? volSum / count : 0,
				sumDelta: deltaSum,
				avgVega: count ? vegaSum / count : 0,
				highRiskCount: highRisk,
			});
		};
		calculateTelemetry();
		return api.addEventListener(GridEventName.cellValueChanged, calculateTelemetry);
	}, [api]);

	const stressScore = telemetry.totalContracts ? Math.min(100, Math.round((telemetry.highRiskCount / telemetry.totalContracts) * 300)) : 0;

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0'>
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-purple-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>Real-Time Option Risk Grid</span>
					</div>
					<div className='text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono bg-slate-950/60 border border-slate-900 px-2 py-0.5 rounded'>
						O(1) Greeks Recalculator
					</div>
				</div>
				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={columns}
						styleRules={styleRules}
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
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<ShieldAlert className='w-4 h-4 text-purple-400' />
						Greeks Risk Telemetry Hub
					</h3>
					<div className='grid grid-cols-2 gap-2 mt-1'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col'>
							<span className='text-[9px] text-slate-500 uppercase font-extrabold'>Total Contracts</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{telemetry.totalContracts.toLocaleString()}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col'>
							<span className='text-[9px] text-slate-500 uppercase font-extrabold'>High Risk Alerts</span>
							<span className='font-mono text-xs font-bold text-rose-400'>{telemetry.highRiskCount}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col'>
							<span className='text-[9px] text-slate-500 uppercase font-extrabold'>Delta Drift</span>
							<span className='font-mono text-xs font-bold text-emerald-400'>+{telemetry.sumDelta.toFixed(2)}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col'>
							<span className='text-[9px] text-slate-500 uppercase font-extrabold'>Avg Volatility</span>
							<span className='font-mono text-xs font-bold text-slate-200'>{telemetry.avgVol.toFixed(1)}%</span>
						</div>
					</div>
					<div className='border-t border-slate-900/60 pt-3 mt-1 flex flex-col gap-2'>
						<div className='flex items-center justify-between text-[9px] font-bold text-slate-500 uppercase tracking-wider'>
							<span>Stress Index Meter</span>
							<span className={stressScore > 50 ? 'text-rose-400' : 'text-emerald-400'}>{stressScore}% LOAD</span>
						</div>
						<div className='w-full bg-slate-950 border border-slate-900 rounded-full h-2 overflow-hidden'>
							<div
								className={`h-full rounded-full transition-all duration-500 ${stressScore > 60 ? 'bg-rose-500' : stressScore > 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
								style={{ width: `${stressScore}%` }}
							/>
						</div>
					</div>
				</div>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 items-center justify-center text-center'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 self-start w-full text-left'>
						<Activity className='w-4 h-4 text-emerald-400' />
						Options System Volatility
					</h3>
					<div className='relative w-36 h-36 flex items-center justify-center'>
						<div className='absolute inset-0 rounded-full border border-dashed border-emerald-500/25' />
						<div className='absolute w-28 h-28 rounded-full border border-slate-900 bg-slate-950/60 flex flex-col items-center justify-center gap-0.5 shadow-inner'>
							<BadgePercent className='w-5 h-5 text-emerald-400' />
							<span className='font-mono text-xs font-bold text-slate-200'>{telemetry.avgVega.toFixed(4)}</span>
							<span className='text-[8px] text-slate-500 font-extrabold uppercase tracking-wider'>Vega Weight</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
