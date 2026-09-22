import React, { useEffect, useState } from 'react';
import { GridEventName, type GridApi } from '@eregister/wit-grid-react';
import { TableProperties, Terminal } from 'lucide-react';

export const StateInspector = React.memo(({ api }: { api: GridApi<any> }) => {
	const [selection, setSelection] = useState(() => api.getStateSnapshot().selection);

	useEffect(() => {
		setSelection(api.getStateSnapshot().selection);
		return api.subscribeToKey('selection', () => {
			setSelection(api.getStateSnapshot().selection);
		});
	}, [api]);

	const focusText = selection.focus ? `Row ID: ${selection.focus.rowId}, Col Field: ${selection.focus.colField}` : 'None';
	const rangeText = selection.range
		? `(${selection.range.start.rowId},${selection.range.start.colField}) to (${selection.range.end.rowId},${selection.range.end.colField})`
		: 'None';

	return (
		<div className='flex shrink-0 flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4 glass-card'>
			<h3 className='flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400'>
				<TableProperties className='h-4 w-4 text-purple-400' />
				State Inspector
			</h3>
			<div className='break-all rounded-lg border border-slate-850 bg-slate-950 p-2.5 font-mono text-xs leading-relaxed text-purple-400'>
				Focused: {focusText} <br />
				Range: {rangeText}
			</div>
			<p className='text-[9px] leading-normal text-slate-500'>
				* This panel reads the active API supplied by the page. It does not create another grid owner.
			</p>
		</div>
	);
});

StateInspector.displayName = 'StateInspector';

export const LiveEventLogPanel = React.memo(({ api }: { api: GridApi<any> }) => {
	const [eventLogs, setEventLogs] = useState<string[]>([]);

	useEffect(() => {
		setEventLogs([]);

		const formatLog = (name: string, payload: unknown) => `${name} => ${JSON.stringify(payload)}`;
		const addLog = (msg: string) => setEventLogs((prev) => [msg, ...prev].slice(0, 4));

		const unsubValue = api.addEventListener(GridEventName.cellValueChanged, (e) => {
			addLog(formatLog(GridEventName.cellValueChanged, e.payload));
		});
		const unsubResize = api.addEventListener(GridEventName.columnResized, (e) => {
			addLog(formatLog(GridEventName.columnResized, e.payload));
		});
		const unsubFocus = api.addEventListener(GridEventName.focusChanged, (e) => {
			addLog(formatLog(GridEventName.focusChanged, e.payload));
		});
		const unsubSelect = api.addEventListener(GridEventName.selectionChanged, (e) => {
			addLog(formatLog(GridEventName.selectionChanged, e.payload));
		});
		const unsubSort = api.addEventListener(GridEventName.sortChanged, (e) => {
			addLog(formatLog(GridEventName.sortChanged, e.payload));
		});
		const unsubFilter = api.addEventListener(GridEventName.filterChanged, (e) => {
			addLog(formatLog(GridEventName.filterChanged, e.payload));
		});

		return () => {
			unsubValue();
			unsubResize();
			unsubFocus();
			unsubSelect();
			unsubSort();
			unsubFilter();
		};
	}, [api]);

	return (
		<div className='flex shrink-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 glass-card'>
			<h3 className='flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400'>
				<Terminal className='h-4 w-4 text-purple-400' />
				Reactive Store Log
			</h3>
			<div className='flex max-h-40 flex-col gap-2 overflow-y-auto'>
				{eventLogs.length === 0 ? (
					<div className='rounded-lg border border-slate-900 bg-slate-950/60 p-2 font-mono text-[10px] italic text-slate-600'>
						Emitting real-time state logs...
					</div>
				) : (
					eventLogs.map((log, index) => (
						<div
							key={`${index}-${log}`}
							className='break-all rounded-lg border border-slate-850 bg-slate-950 p-2 font-mono text-[9px] leading-snug text-purple-400'
						>
							{log}
						</div>
					))
				)}
			</div>
		</div>
	);
});

LiveEventLogPanel.displayName = 'LiveEventLogPanel';
