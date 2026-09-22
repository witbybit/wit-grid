import React, { useEffect, useMemo, useState } from 'react';
import { Grid, type GridApi, type GridCellPointer, type GridReadyEvent } from '@eregister/wit-grid-react';
import { CheckCircle2, Compass, Cpu, Layout, Maximize2 } from 'lucide-react';
import { generatePerformanceRows, layoutColumnsFull } from './demoGridConfigs';
import type { PerformanceRow } from '../components/GridShared';

interface DynamicLayoutProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	rowHeightsMap: Record<string, number>;
	onCellValueChanged: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<PerformanceRow>) => void;
	compactLayout: 'compact' | 'normal' | 'spacious';
	visibleColumns?: Record<string, boolean>;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function DynamicLayout({
	editTrigger,
	arrowKeyNavigationEdit,
	rowHeightsMap,
	onCellValueChanged,
	onGridReady,
	compactLayout,
	visibleColumns,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: DynamicLayoutProps) {
	const rows = useMemo(() => generatePerformanceRows(100, 'R'), []);
	const columns = useMemo(
		() => (visibleColumns ? layoutColumnsFull.filter((column) => visibleColumns[column.field]) : layoutColumnsFull),
		[visibleColumns]
	);
	const [api, setApi] = useState<GridApi<PerformanceRow> | null>(null);
	const [focusedCell, setFocusedCell] = useState<GridCellPointer | null>(null);

	useEffect(() => {
		if (!api) return;
		const update = () => setFocusedCell(api.getStateSnapshot().selection.focus);
		update();
		return api.subscribeToKey('selection', update);
	}, [api]);

	const layoutStats = {
		colsCount: columns.length,
		rowHeight: rowHeightsMap[compactLayout],
		totalRows: rows.length,
		estimatedMemoryKb: (rows.length * columns.length * 1.2).toFixed(1),
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0'>
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-purple-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<Layout className='w-3.5 h-3.5 text-purple-400' />
							Workspace Responsive Grid (Virtual Scroll Viewport)
						</span>
					</div>
					<div className='text-[9px] text-slate-500 font-bold uppercase tracking-widest font-mono bg-slate-950/60 border border-slate-900 px-2 py-0.5 rounded'>
						Auto Layout Resizing
					</div>
				</div>
				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={columns}
						initialState={{ rowHeight: rowHeightsMap[compactLayout] } as any}
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
						<Maximize2 className='w-4 h-4 text-purple-400' />
						Layout Sizing Telemetry
					</h3>
					<div className='grid grid-cols-2 gap-2 mt-1'>
						{[
							['Density Preset', compactLayout],
							['Row Height', `${layoutStats.rowHeight}px`],
							['Visible Cols', `${layoutStats.colsCount} Fields`],
							['Total Rows', `${layoutStats.totalRows} Items`],
						].map(([label, value]) => (
							<div key={label} className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex flex-col gap-0.5'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>{label}</span>
								<span className='font-mono text-xs font-bold text-slate-200'>{value}</span>
							</div>
						))}
					</div>
				</div>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Compass className='w-4 h-4 text-purple-400' />
						Viewport Blueprint
					</h3>
					<div className='bg-slate-950/60 border border-slate-900 p-2.5 rounded-lg font-mono text-[10px]'>
						<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Focus Address</span>
						<div className='text-purple-400 font-extrabold'>
							{focusedCell ? `${focusedCell.rowId} : ${focusedCell.colField}` : 'No Focus Coordinate'}
						</div>
					</div>
				</div>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Cpu className='w-4 h-4 text-emerald-400' />
						Grid Virtualization Engine
					</h3>
					<div className='flex items-start gap-2 text-[10px] font-medium text-slate-400 leading-relaxed'>
						<CheckCircle2 className='w-4 h-4 text-emerald-400 shrink-0 mt-0.5' />
						DOM virtualization active with density hot-swaps.
					</div>
				</div>
			</div>
		</div>
	);
}
