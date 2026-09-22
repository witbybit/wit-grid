import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grid, GridEventName, type GridApi, type GridReadyEvent } from '@eregister/wit-grid-react';
import { BookOpen, Calculator, RefreshCw, Sigma, Sparkles, TrendingUp } from 'lucide-react';
import { type SpreadsheetRow } from '../components/GridShared';
import { createSpreadsheetColumns, createSpreadsheetRows } from './demoGridConfigs';

interface SpreadsheetWorkspaceProps {
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	onCellValueChanged: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<SpreadsheetRow>) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

type CellPointer = { rowId: string; colField: string };
type SelectionRange = { start: CellPointer; end: CellPointer };

export default function SpreadsheetWorkspace({
	editTrigger,
	arrowKeyNavigationEdit,
	onCellValueChanged,
	onGridReady,
	pinLeftColumns = 0,
	pinRightColumns = 0,
}: SpreadsheetWorkspaceProps) {
	const [api, setApi] = useState<GridApi<SpreadsheetRow> | null>(null);
	const [focusedCell, setFocusedCell] = useState<CellPointer | null>(null);
	const [selectedRange, setSelectedRange] = useState<SelectionRange | null>(null);
	const [formulaText, setFormulaText] = useState('');
	const [contextMenuEnabled, setContextMenuEnabled] = useState(true);
	const isEditingRef = useRef(false);

	const rows = useMemo(() => createSpreadsheetRows(), []);
	const columns = useMemo(() => createSpreadsheetColumns(), []);

	const customContextMenuOptions = useMemo(
		() => ({
			customItems: [
				{
					id: 'add100',
					label: 'Add 100 to Selection',
					icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
					action: (params: any) => mutateSelection(params.api, params.selection?.bounds, (value: number) => value + 100),
				},
				{
					id: 'increase10',
					label: 'Apply 10% Increase',
					icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>`,
					action: (params: any) =>
						mutateSelection(params.api, params.selection?.bounds, (value: number) => Math.round(value * 1.1 * 1e10) / 1e10),
				},
			],
		}),
		[]
	);

	useEffect(() => {
		if (!api) return;
		const readSelection = () => {
			const selection = api.getStateSnapshot().selection;
			setFocusedCell((selection.focus ?? null) as CellPointer | null);
			setSelectedRange((selection.range ?? null) as SelectionRange | null);
		};
		readSelection();
		const unsubSelection = api.subscribeToKey('selection', readSelection);
		const unsubCell = api.addEventListener(GridEventName.cellValueChanged, (event) => {
			const { rowId, colField, newValue } = event.payload;
			setFormulaText((current) => {
				if (!focusedCell || focusedCell.rowId !== rowId || focusedCell.colField !== colField || isEditingRef.current) return current;
				return String(newValue ?? '');
			});
		});
		return () => {
			unsubSelection();
			unsubCell();
		};
	}, [api, focusedCell]);

	useEffect(() => {
		if (!api || isEditingRef.current) return;
		if (!focusedCell) {
			setFormulaText('');
			return;
		}
		// Show the formula string if one is registered, otherwise the evaluated value.
		const formula = api.getFormula(focusedCell.rowId, focusedCell.colField);
		setFormulaText(formula ?? String(api.getCellValue(focusedCell.rowId, focusedCell.colField) ?? ''));
	}, [api, focusedCell]);

	const rangeTelemetry = useMemo(() => {
		if (!api || !selectedRange) return { count: 0, sum: 0, avg: 0 };
		const fields = getFieldsInRange(api, selectedRange);
		const rowIds = api
			.rows()
			.inRange(selectedRange as any)
			.getIds();
		let count = 0;
		let sum = 0;
		for (const rowId of rowIds) {
			for (const field of fields) {
				if (field === 'id') continue;
				const val = parseFloat(String(api.getCellValue(rowId, field))) || 0;
				sum += val;
				count++;
			}
		}
		return { count, sum, avg: count > 0 ? sum / count : 0 };
	}, [api, selectedRange]);

	const [cagrInputs, setCagrInputs] = useState({ initial: 100, target: 250, periods: 5 });
	const calculatedCagr = useMemo(() => {
		if (cagrInputs.initial <= 0 || cagrInputs.periods <= 0) return 0;
		return (Math.pow(cagrInputs.target / cagrInputs.initial, 1 / cagrInputs.periods) - 1) * 100;
	}, [cagrInputs]);

	const [compoundInputs, setCompoundInputs] = useState({ principal: 1000, rate: 6, periods: 10 });
	const calculatedCompound = useMemo(
		() => compoundInputs.principal * Math.pow(1 + compoundInputs.rate / 100, compoundInputs.periods),
		[compoundInputs]
	);

	const handleCommitFormula = useCallback(() => {
		if (!api || !focusedCell) return;
		api.setCellValue(focusedCell.rowId, focusedCell.colField, formulaText);
		isEditingRef.current = false;
	}, [api, focusedCell, formulaText]);

	const handleApplyToSelection = useCallback(
		(mapValue: (value: number) => unknown, emptyValue?: unknown) => {
			if (!api) return;
			const range = api.getStateSnapshot().selection.range as SelectionRange | null;
			if (!range) {
				alert('Please select a range of cells first.');
				return;
			}
			const fields = getFieldsInRange(api, range);
			const rowIds = api
				.rows()
				.inRange(range as any)
				.getIds();
			api.updateRows((currentRows) =>
				currentRows.map((row) => {
					if (!rowIds.includes(row.id)) return row;
					const nextRow = { ...row };
					for (const field of fields) {
						if (field === 'id') continue;
						(nextRow as any)[field] = emptyValue !== undefined ? emptyValue : mapValue(parseFloat(String((row as any)[field])) || 0);
					}
					return nextRow;
				})
			);
		},
		[api]
	);

	const handleApplyCompoundToSelection = useCallback(() => {
		if (!api) return;
		const range = api.getStateSnapshot().selection.range as SelectionRange | null;
		if (!range) {
			alert('Please select a range of cells to populate compound projections.');
			return;
		}
		const fields = getFieldsInRange(api, range);
		const rowIds = api
			.rows()
			.inRange(range as any)
			.getIds();
		api.updateRows((currentRows) =>
			currentRows.map((row) => {
				if (!rowIds.includes(row.id)) return row;
				const nextRow = { ...row };
				for (const field of fields) {
					if (field === 'id') continue;
					const idx = rowIds.indexOf(row.id);
					(nextRow as any)[field] = (compoundInputs.principal * Math.pow(1 + compoundInputs.rate / 100, idx + 1)).toFixed(1);
				}
				return nextRow;
			})
		);
	}, [api, compoundInputs.principal, compoundInputs.rate]);

	const focusedValue =
		api && focusedCell
			? (api.getFormula(focusedCell.rowId, focusedCell.colField) ?? String(api.getCellValue(focusedCell.rowId, focusedCell.colField) ?? ''))
			: '';

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-950/80 border border-slate-900 rounded-xl p-2.5 flex items-center gap-3 shrink-0 shadow-lg relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-indigo-500/5 rounded-full blur-xl pointer-events-none' />
					<div className='bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-400 font-mono text-[10px] font-bold tracking-wider shrink-0 flex items-center gap-1.5 min-w-[100px] justify-center'>
						<span className='w-1.5 h-1.5 rounded-full bg-indigo-500' />
						{focusedCell ? `${focusedCell.rowId}:${focusedCell.colField}` : 'NO FOCUS'}
					</div>
					<div className='text-xs font-mono font-extrabold italic text-slate-500 border-r border-slate-900 pr-3 select-none flex items-center gap-1 shrink-0'>
						<span>f</span>
						<span>x</span>
					</div>
					<div className='flex-1 flex items-center gap-2'>
						<input
							type='text'
							className='w-full bg-slate-900/50 hover:bg-slate-900/80 focus:bg-slate-950 border border-slate-850 hover:border-slate-800 focus:border-indigo-500 rounded px-3 py-1 text-slate-200 font-mono text-xs outline-none transition-all duration-200'
							placeholder={
								focusedCell ? 'Enter value, equation, or formula, e.g. =SUM([S-1001:A],-[S-1001:B])' : 'Select a cell to enter values'
							}
							disabled={!focusedCell}
							value={formulaText}
							onChange={(event) => {
								isEditingRef.current = true;
								setFormulaText(event.target.value);
							}}
							onKeyDown={(event) => {
								if (event.key === 'Enter') handleCommitFormula();
								if (event.key === 'Escape') {
									isEditingRef.current = false;
									setFormulaText(focusedValue);
								}
							}}
							onBlur={handleCommitFormula}
						/>
						{focusedCell && formulaText !== focusedValue && (
							<button
								onClick={handleCommitFormula}
								className='px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider text-indigo-400 border border-indigo-500/30 hover:border-indigo-500 hover:text-white rounded bg-indigo-950/20 hover:bg-indigo-900/30 transition-all shrink-0'
							>
								Commit
							</button>
						)}
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={columns}
						getRowId={(row) => row.id}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
						onCellValueChanged={onCellValueChanged}
						enableContextMenu={contextMenuEnabled}
						contextMenuOptions={customContextMenuOptions}
						onGridReady={(event) => {
							setApi(event.api);
							onGridReady?.(event);
						}}
					/>
				</div>
			</div>

			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Sigma className='w-4 h-4 text-indigo-400' />
						Range Analytics & Actions
					</h3>
					<div className='grid grid-cols-3 gap-2 mt-1'>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Cell Count</span>
							<span className='font-mono text-[11px] font-bold text-slate-200'>{rangeTelemetry.count}</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Sum Total</span>
							<span className='font-mono text-[11px] font-bold text-emerald-400 text-glow-emerald'>
								{rangeTelemetry.sum.toFixed(1)}
							</span>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex flex-col items-center text-center'>
							<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Average</span>
							<span className='font-mono text-[11px] font-bold text-indigo-400 text-glow-indigo'>{rangeTelemetry.avg.toFixed(1)}</span>
						</div>
					</div>
					<div className='border-t border-slate-900/60 pt-3 mt-1 flex flex-col gap-2'>
						<div className='flex gap-2'>
							<button
								onClick={() => alert(`Range sum: ${rangeTelemetry.sum.toFixed(2)}`)}
								className='flex-1 py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-300 border border-slate-800 hover:border-slate-700 bg-slate-950 hover:bg-slate-900 rounded transition-all flex items-center justify-center gap-1.5'
							>
								Range Sum
							</button>
							<button
								onClick={() => api?.updateRows((currentRows) => currentRows)}
								className='px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 border border-slate-800 hover:border-slate-750 bg-slate-950 hover:bg-slate-900 rounded transition-all flex items-center justify-center'
								title='Recalculate Formulas'
							>
								<RefreshCw className='w-3 h-3' />
							</button>
						</div>
						<div className='grid grid-cols-2 gap-2'>
							<button
								onClick={() => handleApplyToSelection((value) => (value * 1.1).toFixed(1))}
								className='py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-indigo-400 border border-indigo-950 hover:border-indigo-900 bg-indigo-950/20 hover:bg-indigo-950/40 rounded transition-all text-center'
							>
								Scale Selection (+10%)
							</button>
							<button
								onClick={() => handleApplyToSelection((value) => value, '')}
								className='py-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 border border-slate-900 hover:border-slate-800 bg-slate-950 hover:bg-slate-900 rounded transition-all text-center'
							>
								Clear Selection
							</button>
						</div>
						<div className='border-t border-slate-900/60 pt-3 mt-1.5 flex items-center justify-between'>
							<span className='text-[8px] font-extrabold uppercase text-slate-500'>Enable Context Menu</span>
							<input
								type='checkbox'
								checked={contextMenuEnabled}
								onChange={(event) => setContextMenuEnabled(event.target.checked)}
								className='rounded border-slate-800 text-indigo-650 focus:ring-indigo-500/20 w-3.5 h-3.5 bg-slate-950 cursor-pointer accent-indigo-500'
							/>
						</div>
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<TrendingUp className='w-4 h-4 text-emerald-400' />
						Compound Vol Forecast Tool
					</h3>
					<div className='flex flex-col gap-2.5 mt-1'>
						<div className='flex flex-col gap-1'>
							<div className='flex justify-between text-[8px] font-extrabold uppercase text-slate-500'>
								<span>Principal ($)</span>
								<span className='font-mono text-slate-350'>${compoundInputs.principal}</span>
							</div>
							<input
								type='range'
								min='100'
								max='10000'
								step='100'
								className='w-full accent-emerald-500 bg-slate-950 h-1 rounded'
								value={compoundInputs.principal}
								onChange={(event) => setCompoundInputs((prev) => ({ ...prev, principal: parseInt(event.target.value) }))}
							/>
						</div>
						<div className='flex flex-col gap-1'>
							<div className='flex justify-between text-[8px] font-extrabold uppercase text-slate-500'>
								<span>Growth Rate (%)</span>
								<span className='font-mono text-emerald-400'>{compoundInputs.rate}%</span>
							</div>
							<input
								type='range'
								min='1'
								max='30'
								step='0.5'
								className='w-full accent-emerald-500 bg-slate-950 h-1 rounded'
								value={compoundInputs.rate}
								onChange={(event) => setCompoundInputs((prev) => ({ ...prev, rate: parseFloat(event.target.value) }))}
							/>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex items-center justify-between mt-1'>
							<div className='flex flex-col'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Future Yield (10 periods)</span>
								<span className='font-mono text-xs font-bold text-slate-200'>${calculatedCompound.toFixed(2)}</span>
							</div>
							<Sparkles className='w-5 h-5 text-emerald-400 animate-pulse' />
						</div>
						<button
							onClick={handleApplyCompoundToSelection}
							className='py-2 text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 border border-emerald-950 hover:border-emerald-900 bg-emerald-950/20 hover:bg-emerald-950/40 rounded transition-all text-center mt-1 flex items-center justify-center gap-1.5'
						>
							Apply Projection Sequence
						</button>
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Calculator className='w-4 h-4 text-purple-400' />
						CAGR Quant Module
					</h3>
					<div className='flex flex-col gap-2.5 mt-1'>
						<div className='grid grid-cols-2 gap-2'>
							<div className='flex flex-col gap-1'>
								<span className='text-[8px] font-extrabold uppercase text-slate-500'>Initial Value</span>
								<input
									type='number'
									className='bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-slate-200 font-mono text-xs outline-none'
									value={cagrInputs.initial}
									onChange={(event) => setCagrInputs((prev) => ({ ...prev, initial: parseFloat(event.target.value) || 0 }))}
								/>
							</div>
							<div className='flex flex-col gap-1'>
								<span className='text-[8px] font-extrabold uppercase text-slate-500'>Target Value</span>
								<input
									type='number'
									className='bg-slate-950 border border-slate-900 rounded px-2.5 py-1 text-slate-200 font-mono text-xs outline-none'
									value={cagrInputs.target}
									onChange={(event) => setCagrInputs((prev) => ({ ...prev, target: parseFloat(event.target.value) || 0 }))}
								/>
							</div>
						</div>
						<div className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5 flex items-center justify-between'>
							<div className='flex flex-col'>
								<span className='text-[8px] text-slate-500 uppercase tracking-wider font-extrabold'>Required CAGR (5 periods)</span>
								<span className='font-mono text-xs font-bold text-purple-400 text-glow-purple'>{calculatedCagr.toFixed(2)}%</span>
							</div>
							<BookOpen className='w-5 h-5 text-purple-400' />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function getFieldsInRange(api: GridApi<SpreadsheetRow>, range: SelectionRange) {
	const state = api.getStateSnapshot();
	const startColIdx = state.columns.findIndex((column) => column.field === range.start.colField);
	const endColIdx = state.columns.findIndex((column) => column.field === range.end.colField);
	if (startColIdx === -1 || endColIdx === -1) return [];
	const minCol = Math.min(startColIdx, endColIdx);
	const maxCol = Math.max(startColIdx, endColIdx);
	return state.columns.slice(minCol, maxCol + 1).map((column) => column.field);
}

function mutateSelection(api: GridApi<SpreadsheetRow>, bounds: { minCol: number; maxCol: number } | undefined, mutate: (value: number) => unknown) {
	if (!bounds) return;
	const columns = api.getStateSnapshot().columns;
	const rowIds = api.rows().getSelectedIds();
	for (const rowId of rowIds) {
		for (let colIndex = bounds.minCol; colIndex <= bounds.maxCol; colIndex++) {
			const column = columns[colIndex];
			if (!column || column.field === 'id') continue;
			const value = api.getCellValue(rowId, column.field);
			const numeric = Number(value);
			if (!Number.isNaN(numeric) && value !== '' && value !== null && value !== undefined) {
				api.setCellValue(rowId, column.field, mutate(numeric));
			}
		}
	}
}
