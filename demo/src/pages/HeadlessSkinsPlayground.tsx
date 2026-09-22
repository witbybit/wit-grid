import React, { useMemo, useRef, useState } from 'react';
import { Grid, type GridReadyEvent } from '@eregister/wit-grid-react';
import { Palette } from 'lucide-react';
import { createSkinsColumns, generatePerformanceRows } from './demoGridConfigs';
import { ThemeTweaker } from '../components/ThemeTweaker';

interface HeadlessSkinsPlaygroundProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<any>) => void;
}

export default function HeadlessSkinsPlayground({
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
}: HeadlessSkinsPlaygroundProps) {
	const apiRef = useRef<any>(null);
	const [apiReady, setApiReady] = useState<any>(null);
	const rows = useMemo(() => generatePerformanceRows(1000, 'R'), []);
	const columns = useMemo(() => createSkinsColumns(), []);

	const handleGridReady = (event: GridReadyEvent<any>) => {
		apiRef.current = event.api;
		setApiReady(event.api);
		onGridReady?.(event);
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			{/* Left: header + grid */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				{/* Header bar */}
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-4 flex items-center gap-3 shrink-0'>
					<span className='p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400'>
						<Palette className='w-4.5 h-4.5' />
					</span>
					<div>
						<h3 className='text-sm font-extrabold text-slate-200 uppercase tracking-wider'>Live Theme Studio</h3>
						<p className='text-[10px] text-slate-400 mt-0.5 leading-tight'>
							Pick a preset or tweak individual tokens — every change applies instantly via CSS variables
						</p>
					</div>
				</div>

				{/* Grid viewport */}
				<div className='flex-1 min-h-0 relative overflow-hidden'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={columns}
						getRowId={(row) => row.id}
						pinLeftColumns={1}
						pinRightColumns={1}
						navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
						onCellValueChanged={onCellValueChanged}
						onGridReady={handleGridReady}
					/>
				</div>

				{/* Footer note */}
				<div className='p-3 bg-slate-900/10 border border-slate-900 rounded-xl flex items-start gap-2.5 shrink-0'>
					<div className='text-purple-400 mt-0.5 shrink-0'>ℹ️</div>
					<p className='text-[9px] text-slate-400 leading-normal font-medium'>
						<strong>API-Driven:</strong> Theme changes flow through <code>api.switchTheme()</code> and <code>api.mergeTheme()</code>. CSS
						variables are injected scoped to this grid's container — no global side-effects, no framework coupling.
					</p>
				</div>
			</div>

			{/* Right: Theme Tweaker sidebar */}
			<div className='w-full xl:w-[340px] flex flex-col shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-0.5'>
				<ThemeTweaker api={apiReady} />
			</div>
		</div>
	);
}
