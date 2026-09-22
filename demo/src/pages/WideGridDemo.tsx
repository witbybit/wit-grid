/**
 * Wide Grid Demo — Column Virtualization Showcase
 *
 * Demonstrates that the grid renders only the visible column slice even for
 * very wide datasets. The "Visible columns" badge shows the live colStart..colEnd
 * window from api.getVisibleColumnRange(). With 100 columns and colBuffer=2 the
 * badge should show ≤ 20 columns regardless of horizontal scroll position.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Grid } from '@eregister/wit-grid-react';
import type { ColumnDef, GridApi, GridReadyEvent } from '@eregister/wit-grid-react';
import { Eye, Columns, SlidersHorizontal } from 'lucide-react';

// ─── Config ──────────────────────────────────────────────────────────────────

const TOTAL_COLS = 100;
const TOTAL_ROWS = 500;
const COL_WIDTH = 110;

// ─── Data generation ─────────────────────────────────────────────────────────

interface WideRow {
	id: string;
	[key: string]: number | string;
}

function generateColumns(colBuffer: number): ColumnDef<WideRow>[] {
	return Array.from({ length: TOTAL_COLS }, (_, i) => ({
		field: `col_${i}`,
		header: `Col ${i}`,
		width: COL_WIDTH,
	}));
}

function generateRows(): WideRow[] {
	return Array.from({ length: TOTAL_ROWS }, (_, r) => {
		const row: WideRow = { id: String(r) };
		for (let c = 0; c < TOTAL_COLS; c++) {
			row[`col_${c}`] = parseFloat((Math.random() * 10000).toFixed(2));
		}
		return row;
	});
}

const ROWS = generateRows();

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
	onGridReady?: (event: GridReadyEvent<any>) => void;
	editTrigger: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit: boolean;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

export default function WideGridDemo({ onGridReady, editTrigger, arrowKeyNavigationEdit, pinLeftColumns, pinRightColumns }: Props) {
	const [api, setApi] = useState<GridApi<WideRow> | null>(null);
	const [colBuffer, setColBuffer] = useState(2); // matches the new default
	const [visibleRange, setVisibleRange] = useState<{ colStart: number; colEnd: number; total: number }>({
		colStart: 0,
		colEnd: 0,
		total: 0,
	});

	const columns = React.useMemo(() => generateColumns(colBuffer), [colBuffer]);

	const handleGridReady = useCallback(
		(event: GridReadyEvent<WideRow>) => {
			setApi(event.api);
			onGridReady?.(event as GridReadyEvent<any>);
		},
		[onGridReady]
	);

	// Subscribe to viewport changes to update the badge.
	useEffect(() => {
		if (!api) return;
		let rafId = requestAnimationFrame(() => setVisibleRange(api.getVisibleColumnRange()));
		const unsub = api.subscribe(() => setVisibleRange(api.getVisibleColumnRange()));
		return () => {
			cancelAnimationFrame(rafId);
			unsub();
		};
	}, [api]);

	const visibleCount = visibleRange.colEnd - visibleRange.colStart + 1;
	const savedNodes = Math.max(0, TOTAL_COLS - visibleCount);
	const efficiency = TOTAL_COLS > 0 ? Math.round((savedNodes / TOTAL_COLS) * 100) : 0;

	return (
		<div className='flex h-full min-h-0 flex-col gap-3'>
			{/* Toolbar */}
			<div className='flex shrink-0 flex-wrap items-center gap-4 rounded-xl border border-slate-900 bg-slate-900/30 px-4 py-3'>
				<span className='text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>Column Virtualization</span>

				{/* Live badge */}
				<div className='flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5'>
					<Eye className='h-3.5 w-3.5 text-sky-400' />
					<span className='text-[11px] font-bold text-sky-300'>
						Visible: {visibleRange.colStart}–{visibleRange.colEnd}
						<span className='ml-1.5 text-sky-600'>
							({visibleCount} of {TOTAL_COLS} cols)
						</span>
					</span>
				</div>

				{/* Efficiency badge */}
				<div className='flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5'>
					<Columns className='h-3.5 w-3.5 text-emerald-400' />
					<span className='text-[11px] font-bold text-emerald-300'>
						{savedNodes} DOM nodes saved
						<span className='ml-1.5 text-emerald-600'>({efficiency}% off-screen culled)</span>
					</span>
				</div>

				{/* colBuffer control */}
				<div className='ml-auto flex items-center gap-2'>
					<SlidersHorizontal className='h-3.5 w-3.5 text-slate-500' />
					<span className='text-[10px] font-bold uppercase tracking-wider text-slate-500'>Col Buffer</span>
					{[1, 2, 4, 8].map((v) => (
						<button
							key={v}
							onClick={() => setColBuffer(v)}
							className={`rounded px-2 py-0.5 text-[11px] font-bold transition-all ${
								colBuffer === v
									? 'border border-violet-500/40 bg-violet-500/20 text-violet-300'
									: 'border border-slate-700 bg-slate-800/40 text-slate-400 hover:bg-slate-800'
							}`}
						>
							{v}
						</button>
					))}
				</div>
			</div>

			{/* Info strip */}
			<div className='flex shrink-0 items-center gap-3 rounded-xl border border-slate-900/60 bg-slate-900/20 px-4 py-2 text-[10.5px] text-slate-500'>
				<span className='font-semibold text-slate-400'>
					{TOTAL_COLS} columns × {TOTAL_ROWS} rows
				</span>
				<span>·</span>
				<span>Scroll horizontally — the badge updates in real time as columns enter/leave the viewport</span>
				<span>·</span>
				<span>
					<strong className='text-slate-400'>Col Buffer</strong> controls overscan (extra columns rendered off-screen to prevent flicker
					during fast scroll)
				</span>
			</div>

			{/* Grid */}
			<div className='min-h-0 flex-1'>
				<Grid<WideRow>
					rowModelType='client'
					columns={columns}
					rows={ROWS}
					getRowId={(r) => r.id}
					navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
					pinLeftColumns={pinLeftColumns}
					pinRightColumns={pinRightColumns}
					onGridReady={handleGridReady}
					initialState={{ colBuffer }}
					showFilterChipBar
				/>
			</div>
		</div>
	);
}
