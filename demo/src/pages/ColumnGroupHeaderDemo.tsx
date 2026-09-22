import React, { useCallback, useRef, useState } from 'react';
import { Grid } from '@eregister/wit-grid-react';
import type { ColumnDef, GridApi, GridReadyEvent } from '@eregister/wit-grid-react';

interface FinancialRow {
	id: string;
	name: string;
	ticker: string;
	q1Revenue: number;
	q1Cost: number;
	q1Margin: number;
	q2Revenue: number;
	q2Cost: number;
	q2Margin: number;
	fyRevenue: number;
	fyMargin: number;
	yoyPct: number;
	status: 'Active' | 'Watchlist' | 'Inactive';
	region: string;
}

const REGIONS = ['APAC', 'EMEA', 'NA', 'LATAM'];
const TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX', 'AMD', 'INTC'];
const STATUSES: FinancialRow['status'][] = ['Active', 'Watchlist', 'Inactive'];
const NAMES = [
	'Apple Inc',
	'Microsoft Corp',
	'NVIDIA Corp',
	'Tesla Inc',
	'Amazon.com',
	'Alphabet Inc',
	'Meta Platforms',
	'Netflix Inc',
	'Adv. Micro Devices',
	'Intel Corp',
];

function generateRows(count: number): FinancialRow[] {
	return Array.from({ length: count }, (_, i) => {
		const q1Revenue = 10000 + ((i * 1317) % 90000);
		const q1Cost = Math.floor(q1Revenue * (0.55 + ((i * 3) % 30) / 100));
		const q2Revenue = Math.floor(q1Revenue * (0.9 + ((i * 7) % 30) / 100));
		const q2Cost = Math.floor(q2Revenue * (0.55 + (((i + 1) * 3) % 30) / 100));
		const q3Revenue = Math.floor(q1Revenue * (0.95 + ((i * 5) % 30) / 100));
		const fyRevenue = q1Revenue + q2Revenue + q3Revenue;
		const fyMargin = ((fyRevenue - q1Cost - q2Cost) / fyRevenue) * 100;
		const prevFyRevenue = Math.floor(fyRevenue * (0.8 + ((i * 4) % 35) / 100));
		const yoyPct = ((fyRevenue - prevFyRevenue) / prevFyRevenue) * 100;
		return {
			id: `row-${i}`,
			name: NAMES[i % NAMES.length],
			ticker: TICKERS[i % TICKERS.length],
			q1Revenue,
			q1Cost,
			q1Margin: ((q1Revenue - q1Cost) / q1Revenue) * 100,
			q2Revenue,
			q2Cost,
			q2Margin: ((q2Revenue - q2Cost) / q2Revenue) * 100,
			fyRevenue,
			fyMargin,
			yoyPct,
			status: STATUSES[i % 3],
			region: REGIONS[i % REGIONS.length],
		};
	});
}

const fmt$ = ({ value }: { value: unknown }) => {
	const n = Number(value);
	return isNaN(n) ? '' : `$${n.toLocaleString()}`;
};
const fmtPct = ({ value }: { value: unknown }) => {
	const n = Number(value);
	return isNaN(n) ? '' : `${n.toFixed(1)}%`;
};

// Single-level: Identity | Q1 Actuals | Q2 Actuals | Full Year | ungrouped
const SINGLE_LEVEL_COLUMNS: ColumnDef<FinancialRow>[] = [
	{ field: 'name', header: 'Company', width: 140, headerGroup: 'Identity' },
	{ field: 'ticker', header: 'Ticker', width: 80, headerGroup: 'Identity' },
	{ field: 'q1Revenue', header: 'Revenue', width: 110, headerGroup: 'Q1 Actuals', valueFormatter: fmt$ },
	{ field: 'q1Cost', header: 'Cost', width: 100, headerGroup: 'Q1 Actuals', valueFormatter: fmt$ },
	{ field: 'q1Margin', header: 'Margin %', width: 95, headerGroup: 'Q1 Actuals', valueFormatter: fmtPct },
	{ field: 'q2Revenue', header: 'Revenue', width: 110, headerGroup: 'Q2 Actuals', valueFormatter: fmt$ },
	{ field: 'q2Cost', header: 'Cost', width: 100, headerGroup: 'Q2 Actuals', valueFormatter: fmt$ },
	{ field: 'q2Margin', header: 'Margin %', width: 95, headerGroup: 'Q2 Actuals', valueFormatter: fmtPct },
	{ field: 'fyRevenue', header: 'FY Revenue', width: 115, headerGroup: 'Full Year', valueFormatter: fmt$ },
	{ field: 'fyMargin', header: 'FY Margin', width: 100, headerGroup: 'Full Year', valueFormatter: fmtPct },
	{ field: 'yoyPct', header: 'YoY %', width: 85, headerGroup: 'Full Year', valueFormatter: fmtPct },
	{ field: 'status', header: 'Status', width: 90 },
	{ field: 'region', header: 'Region', width: 80 },
];

// Two-level: Performance > Revenue | Performance > Cost | Summary | ungrouped
const NESTED_COLUMNS: ColumnDef<FinancialRow>[] = [
	{ field: 'name', header: 'Company', width: 140 },
	{ field: 'ticker', header: 'Ticker', width: 80 },
	{ field: 'q1Revenue', header: 'Q1', width: 100, headerGroup: ['Performance', 'Revenue'], valueFormatter: fmt$ },
	{ field: 'q2Revenue', header: 'Q2', width: 100, headerGroup: ['Performance', 'Revenue'], valueFormatter: fmt$ },
	{ field: 'fyRevenue', header: 'FY', width: 100, headerGroup: ['Performance', 'Revenue'], valueFormatter: fmt$ },
	{ field: 'q1Cost', header: 'Q1', width: 100, headerGroup: ['Performance', 'Cost'], valueFormatter: fmt$ },
	{ field: 'q2Cost', header: 'Q2', width: 100, headerGroup: ['Performance', 'Cost'], valueFormatter: fmt$ },
	{ field: 'q1Margin', header: 'Q1 Margin', width: 95, headerGroup: 'Summary', valueFormatter: fmtPct },
	{ field: 'fyMargin', header: 'FY Margin', width: 95, headerGroup: 'Summary', valueFormatter: fmtPct },
	{ field: 'yoyPct', header: 'YoY %', width: 85, headerGroup: 'Summary', valueFormatter: fmtPct },
	{ field: 'status', header: 'Status', width: 90 },
	{ field: 'region', header: 'Region', width: 80 },
];

const ROWS = generateRows(50);

interface ColumnGroupHeaderDemoProps {
	onGridReady?: (event: GridReadyEvent<any>) => void;
	onCellValueChanged?: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
}

export default function ColumnGroupHeaderDemo({ onGridReady, pinLeftColumns = 0, pinRightColumns = 0 }: ColumnGroupHeaderDemoProps) {
	const [showNested, setShowNested] = useState(false);
	const apiRef = useRef<GridApi<any> | null>(null);

	const handleGridReady = useCallback(
		(event: GridReadyEvent<any>) => {
			apiRef.current = event.api;
			onGridReady?.(event);
		},
		[onGridReady]
	);

	const columns = showNested ? NESTED_COLUMNS : SINGLE_LEVEL_COLUMNS;

	return (
		<div className='flex flex-col min-h-0 flex-1 gap-3'>
			<div className='flex items-center gap-3 shrink-0 px-1'>
				<span className='text-[10px] font-bold uppercase tracking-wider text-slate-500'>Group depth:</span>
				<button
					onClick={() => setShowNested(false)}
					className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all ${
						!showNested
							? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-600/20'
							: 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
					}`}
				>
					Single Level
				</button>
				<button
					onClick={() => setShowNested(true)}
					className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all ${
						showNested
							? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-600/20'
							: 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
					}`}
				>
					Two-Level Nested
				</button>
				<span className='text-[9px] text-slate-600 font-medium'>
					{showNested
						? 'Depth 2: Performance › Revenue / Cost  +  Summary (ungrouped: Status, Region)'
						: 'Depth 1: Identity  |  Q1 Actuals  |  Q2 Actuals  |  Full Year  (ungrouped: Status, Region)'}
				</span>
				<div className='ml-auto flex items-center gap-2'>
					<button
						onClick={() => apiRef.current?.autoSizeAllColumns()}
						className='px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200 transition-all'
						title='Auto-size all columns to fit their content'
					>
						Auto-Size All
					</button>
					<span className='text-[9px] text-slate-700'>or dbl-click a resize handle</span>
				</div>
			</div>
			<div className='flex min-h-0 flex-1'>
				<Grid
					rowModelType='client'
					columns={columns as ColumnDef<any>[]}
					rows={ROWS as any[]}
					getRowId={(row: any) => row.id}
					onGridReady={handleGridReady}
					pinLeftColumns={pinLeftColumns}
					pinRightColumns={pinRightColumns}
					enableColumnReorder
				/>
			</div>
		</div>
	);
}
