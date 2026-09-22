import React from 'react';
import { Zap, Filter, ArrowDownAZ, ArrowUpAZ, Keyboard, Layers, HelpCircle, RefreshCw, GripVertical, MoveLeft, MoveRight } from 'lucide-react';
import type { GridApi } from '@eregister/wit-grid-react';
import { normalizeCapabilityResult } from '@eregister/wit-grid-react';
import { GridPageType, LatencyProfiler } from './GridShared';

// ============================================================================
// 1. Viewport & Layout Panel
// ============================================================================
interface ViewportPanelProps {
	pinLeftColumns: number;
	setPinLeftColumns: (val: number) => void;
	pinRightColumns: number;
	setPinRightColumns: (val: number) => void;
	activePage: string;
	massiveColumns: boolean;
	setMassiveColumns: (val: boolean) => void;
}

export function ViewportPanel({
	pinLeftColumns,
	setPinLeftColumns,
	pinRightColumns,
	setPinRightColumns,
	activePage,
	massiveColumns,
	setMassiveColumns,
}: ViewportPanelProps) {
	return (
		<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0'>
			<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
				<Zap className='w-4 h-4 text-amber-400' />
				Viewport & Columns Layout
			</h3>

			<div className='flex flex-col gap-3.5'>
				{/* Pinned Lanes Control */}
				<div className='grid grid-cols-2 gap-2.5'>
					<label className='flex flex-col gap-1'>
						<span className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Pin Left Cols</span>
						<input
							type='number'
							min={0}
							max={5}
							value={pinLeftColumns}
							onChange={(e) => setPinLeftColumns(Math.max(0, parseInt(e.target.value) || 0))}
							className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-bold font-sans'
						/>
					</label>

					<label className='flex flex-col gap-1'>
						<span className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Pin Right Cols</span>
						<input
							type='number'
							min={0}
							max={5}
							value={pinRightColumns}
							onChange={(e) => setPinRightColumns(Math.max(0, parseInt(e.target.value) || 0))}
							className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-bold font-sans'
						/>
					</label>
				</div>

				{/* Massive columns mode for perf/server-backed grids */}
				{(activePage === 'perf' || activePage === 'server') && (
					<label className='flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-900 hover:border-slate-850 cursor-pointer select-none transition-all'>
						<input
							type='checkbox'
							checked={massiveColumns}
							onChange={(e) => setMassiveColumns(e.target.checked)}
							className='rounded border-slate-800 text-purple-600 focus:ring-purple-500/20 w-3 h-3 bg-slate-950 cursor-pointer'
						/>
						<div className='flex flex-col'>
							<span className='text-[11px] font-bold text-slate-200 leading-tight'>1,000+ Column Scale</span>
							<span className='text-[9px] text-slate-500 mt-0.5 leading-none'>Enable 1,000 extra dynamically-evaluated columns</span>
						</div>
					</label>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// 2. Sort & Filter Panel
// ============================================================================
interface SortFilterPanelProps {
	activeApi: GridApi<any>;
	sortField: string;
	setSortField: (val: string) => void;
	statusFilter: 'All' | 'Active' | 'Pending' | 'Inactive';
	setStatusFilter: (val: 'All' | 'Active' | 'Pending' | 'Inactive') => void;
	sortDirection: 'asc' | 'desc';
	setSortDirection: (val: 'asc' | 'desc') => void;
}

export function SortFilterPanel({
	activeApi,
	sortField,
	setSortField,
	statusFilter,
	setStatusFilter,
	sortDirection,
	setSortDirection,
}: SortFilterPanelProps) {
	const cols = activeApi.getStateSnapshot().columns || [];

	return (
		<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0'>
			<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
				<Filter className='w-4 h-4 text-emerald-400' />
				Sort & Filter
			</h3>

			<div className='grid grid-cols-2 gap-2.5'>
				<label className='flex flex-col gap-1'>
					<span className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Sort Field</span>
					<select
						value={sortField}
						onChange={(e) => setSortField(e.target.value)}
						className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-bold cursor-pointer'
					>
						{cols.map((column) => (
							<option key={column.field} value={column.field}>
								{column.header}
							</option>
						))}
					</select>
				</label>

				<label className='flex flex-col gap-1'>
					<span className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Status Filter</span>
					<select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value as any)}
						className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-bold cursor-pointer'
					>
						<option value='All'>All Rows</option>
						<option value='Active'>Active</option>
						<option value='Pending'>Pending</option>
						<option value='Inactive'>Inactive</option>
					</select>
				</label>
			</div>

			<div className='flex gap-2'>
				<button
					onClick={() => setSortDirection('asc')}
					className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
						sortDirection === 'asc'
							? 'bg-purple-600 border-purple-500 text-white shadow-md shadow-purple-600/10'
							: 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200'
					}`}
				>
					<ArrowDownAZ className='w-3.5 h-3.5' />
					Asc
				</button>
				<button
					onClick={() => setSortDirection('desc')}
					className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
						sortDirection === 'desc'
							? 'bg-purple-600 border-purple-500 text-white shadow-md shadow-purple-600/10'
							: 'bg-slate-950 border-slate-850 text-slate-400 hover:text-slate-200'
					}`}
				>
					<ArrowUpAZ className='w-3.5 h-3.5' />
					Desc
				</button>
			</div>
		</div>
	);
}

// ============================================================================
// 3. Column Order Panel
// ============================================================================
interface ColumnOrderPanelProps {
	activeApi: GridApi<any>;
}

export function ColumnOrderPanel({ activeApi }: ColumnOrderPanelProps) {
	const [state, setState] = React.useState(() => activeApi.getStateSnapshot());
	const [selectedField, setSelectedField] = React.useState(() => activeApi.getStateSnapshot().columns[0]?.field ?? '');

	React.useEffect(() => {
		setState(activeApi.getStateSnapshot());
		setSelectedField(activeApi.getStateSnapshot().columns[0]?.field ?? '');
		return activeApi.subscribe(() => {
			const nextState = activeApi.getStateSnapshot();
			setState(nextState);
			setSelectedField((currentField) =>
				nextState.columns.some((column) => column.field === currentField) ? currentField : (nextState.columns[0]?.field ?? '')
			);
		});
	}, [activeApi]);

	const columns = state.columns || [];
	const selectedIndex = columns.findIndex((column) => column.field === selectedField);
	const selectedColumn = selectedIndex >= 0 ? columns[selectedIndex] : null;
	const canMoveSelected =
		state.enableColumnReorder &&
		(selectedColumn?.canMoveColumn === undefined ||
			normalizeCapabilityResult(selectedColumn.canMoveColumn({ action: 'moveColumn', colField: selectedColumn.field ?? '' })).allowed);

	const moveSelected = (delta: -1 | 1) => {
		if (!canMoveSelected || !selectedColumn) return;
		activeApi.moveColumn(selectedColumn.field, selectedIndex + delta);
	};

	return (
		<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0'>
			<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
				<GripVertical className='w-4 h-4 text-sky-400' />
				Column Order
			</h3>

			<label className='flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-900 hover:border-slate-850 cursor-pointer select-none transition-all'>
				<input
					type='checkbox'
					checked={state.enableColumnReorder}
					onChange={(e) => activeApi.setColumnReorderEnabled(e.target.checked)}
					className='rounded border-slate-800 text-purple-600 focus:ring-purple-500/20 w-3 h-3 bg-slate-950 cursor-pointer'
				/>
				<div className='flex flex-col'>
					<span className='text-[11px] font-bold text-slate-200 leading-tight'>Header Drag Reorder</span>
					<span className='text-[9px] text-slate-500 mt-0.5 leading-none'>Global API toggle for draggable headers</span>
				</div>
			</label>

			<div className='grid grid-cols-[1fr_auto_auto] gap-2 items-end'>
				<label className='flex flex-col gap-1 min-w-0'>
					<span className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Move Column</span>
					<select
						value={selectedField}
						onChange={(e) => setSelectedField(e.target.value)}
						className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-bold cursor-pointer'
					>
						{columns.map((column) => (
							<option key={column.field} value={column.field}>
								{column.header}
							</option>
						))}
					</select>
				</label>
				<button
					onClick={() => moveSelected(-1)}
					disabled={!canMoveSelected || selectedIndex <= 0}
					className='h-8 w-8 inline-flex items-center justify-center rounded-lg bg-slate-950 border border-slate-850 text-slate-300 hover:text-white hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all'
					title='Move selected column left'
				>
					<MoveLeft className='w-3.5 h-3.5' />
				</button>
				<button
					onClick={() => moveSelected(1)}
					disabled={!canMoveSelected || selectedIndex < 0 || selectedIndex >= columns.length - 1}
					className='h-8 w-8 inline-flex items-center justify-center rounded-lg bg-slate-950 border border-slate-850 text-slate-300 hover:text-white hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all'
					title='Move selected column right'
				>
					<MoveRight className='w-3.5 h-3.5' />
				</button>
			</div>
		</div>
	);
}

// ============================================================================
// 4. Grid Accessibility Panel
// ============================================================================
interface AccessibilityPanelProps {
	editTrigger: 'singleClick' | 'doubleClick';
	setEditTrigger: (val: 'singleClick' | 'doubleClick') => void;
	arrowKeyNavigationEdit: boolean;
	setArrowKeyNavigationEdit: (val: boolean) => void;
}

export function AccessibilityPanel({ editTrigger, setEditTrigger, arrowKeyNavigationEdit, setArrowKeyNavigationEdit }: AccessibilityPanelProps) {
	return (
		<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 shrink-0'>
			<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
				<Keyboard className='w-4 h-4 text-purple-400' />
				Grid Accessibility
			</h3>

			<div className='flex flex-col gap-2.5'>
				<div className='flex flex-col gap-1'>
					<label className='text-[9px] text-slate-500 font-bold uppercase tracking-wider'>Edit Trigger</label>
					<select
						value={editTrigger}
						onChange={(e) => setEditTrigger(e.target.value as any)}
						className='w-full bg-slate-950 border border-slate-850 rounded-lg px-2 py-1.5 text-[10px] text-slate-200 outline-none focus:border-purple-500 transition-all font-sans font-bold cursor-pointer'
					>
						<option value='doubleClick'>Double-Click to Edit (Excel)</option>
						<option value='singleClick'>Single-Click to Edit</option>
					</select>
				</div>

				<label className='flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-900 hover:border-slate-850 cursor-pointer select-none transition-all'>
					<input
						type='checkbox'
						checked={arrowKeyNavigationEdit}
						onChange={(e) => setArrowKeyNavigationEdit(e.target.checked)}
						className='rounded border-slate-800 text-purple-600 focus:ring-purple-500/20 w-3 h-3 bg-slate-950 cursor-pointer'
					/>
					<div className='flex flex-col'>
						<span className='text-[11px] font-bold text-slate-200 leading-tight'>Arrow Key Auto-Edit</span>
						<span className='text-[9px] text-slate-500 mt-0.5 leading-none'>Auto-open cell in edit state when navigating</span>
					</div>
				</label>
			</div>
		</div>
	);
}

// ============================================================================
// 5. Developer Reset Panel
// ============================================================================
interface DeveloperPanelProps {
	activePage: GridPageType;
	activeApi: GridApi<any>;
}

// ============================================================================
// 6. Keyboard Shortcuts Guide
// ============================================================================
export function KeyboardShortcutsPanel() {
	return (
		<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-2.5 shrink-0'>
			<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
				<HelpCircle className='w-4 h-4 text-emerald-400' />
				Keyboard Shortcuts
			</h3>
			<ul className='text-slate-400 text-[10px] leading-relaxed flex flex-col gap-1.5 font-semibold'>
				<li className='flex justify-between border-b border-slate-900/60 pb-1'>
					<span>Navigate Cells</span>
					<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Arrow Keys</span>
				</li>
				<li className='flex justify-between border-b border-slate-900/60 pb-1'>
					<span>Expand Range</span>
					<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Shift + Arrows</span>
				</li>
				<li className='flex justify-between border-b border-slate-900/60 pb-1'>
					<span>Edit Mode</span>
					<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Enter / Double Click</span>
				</li>
				<li className='flex justify-between border-b border-slate-900/60 pb-1'>
					<span>Commit & Down</span>
					<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Enter</span>
				</li>
				<li className='flex justify-between pb-0.5'>
					<span>Navigate / Cancel</span>
					<span className='font-mono bg-slate-950 px-1 py-0.5 rounded text-purple-400 text-[9px]'>Escape</span>
				</li>
			</ul>
		</div>
	);
}
