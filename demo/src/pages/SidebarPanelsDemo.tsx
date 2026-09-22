import React from 'react';
import { Grid } from '@eregister/wit-grid-react';
import type { ColumnDef, CellRendererProps, GridReadyEvent } from '@eregister/wit-grid-react';

// ── Data model ────────────────────────────────────────────────────────────────

interface HoldingRow {
	id: string;
	symbol: string;
	name: string;
	price: string;
	change: string;
	changePct: string;
	marketCap: string;
	volume: string;
	sector: string;
	region: string;
	pe: string;
	status: 'Active' | 'Watch' | 'Closed';
}

const SECTORS = ['Technology', 'Healthcare', 'Finance', 'Energy', 'Consumer', 'Utilities', 'Materials'];
const REGIONS = ['US', 'Europe', 'Asia-Pac', 'LatAm', 'MENA'];
const STATUSES: HoldingRow['status'][] = ['Active', 'Active', 'Active', 'Watch', 'Watch', 'Closed'];

const TICKERS: [string, string, string][] = [
	['AAPL', 'Apple Inc.', 'Technology'],
	['MSFT', 'Microsoft Corp.', 'Technology'],
	['NVDA', 'NVIDIA Corp.', 'Technology'],
	['TSLA', 'Tesla Inc.', 'Consumer'],
	['AMZN', 'Amazon.com Inc.', 'Consumer'],
	['GOOGL', 'Alphabet Inc.', 'Technology'],
	['META', 'Meta Platforms', 'Technology'],
	['JPM', 'JPMorgan Chase', 'Finance'],
	['GS', 'Goldman Sachs', 'Finance'],
	['V', 'Visa Inc.', 'Finance'],
	['JNJ', 'Johnson & Johnson', 'Healthcare'],
	['PFE', 'Pfizer Inc.', 'Healthcare'],
	['UNH', 'UnitedHealth Group', 'Healthcare'],
	['XOM', 'Exxon Mobil', 'Energy'],
	['CVX', 'Chevron Corp.', 'Energy'],
	['NEE', 'NextEra Energy', 'Utilities'],
	['BHP', 'BHP Group', 'Materials'],
	['RIO', 'Rio Tinto', 'Materials'],
	['BABA', 'Alibaba Group', 'Consumer'],
	['TSM', 'Taiwan Semiconductor', 'Technology'],
];

function generateHoldings(count: number): HoldingRow[] {
	return Array.from({ length: count }, (_, i) => {
		const [symbol, name, sector] = TICKERS[i % TICKERS.length];
		const price = (50 + ((i * 37 + 13) % 450)).toFixed(2);
		const changeVal = ((((i * 7 + 3) % 20) - 8) * 0.5).toFixed(2);
		const changePct = ((parseFloat(changeVal) / parseFloat(price)) * 100).toFixed(2);
		const marketCap = ((parseFloat(price) * (500 + ((i * 11) % 2000))) / 1000).toFixed(1) + 'B';
		const volume = ((100 + ((i * 29) % 900)) * 1000).toLocaleString();
		const pe = (10 + ((i * 3 + 5) % 40)).toFixed(1);
		const region = REGIONS[i % REGIONS.length];
		const status = STATUSES[i % STATUSES.length];
		return { id: `${symbol}-${i}`, symbol, name, price, change: changeVal, changePct, marketCap, volume, sector, region, pe, status };
	});
}

// ── Cell renderers ────────────────────────────────────────────────────────────

const ChangeRenderer = ({ value }: CellRendererProps<HoldingRow>) => {
	const v = parseFloat(String(value));
	const pos = v >= 0;
	return (
		<span
			style={{
				fontFamily: 'monospace',
				fontSize: 12,
				fontWeight: 700,
				color: pos ? '#34d399' : '#f87171',
			}}
		>
			{pos ? '+' : ''}
			{v.toFixed(2)}
		</span>
	);
};

const ChangePctRenderer = ({ value }: CellRendererProps<HoldingRow>) => {
	const v = parseFloat(String(value));
	const pos = v >= 0;
	return (
		<span
			style={{
				fontFamily: 'monospace',
				fontSize: 11,
				fontWeight: 700,
				padding: '2px 6px',
				borderRadius: 4,
				background: pos ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
				border: `1px solid ${pos ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
				color: pos ? '#34d399' : '#f87171',
			}}
		>
			{pos ? '▲' : '▼'} {Math.abs(v).toFixed(2)}%
		</span>
	);
};

const StatusRenderer = ({ value }: CellRendererProps<HoldingRow>) => {
	const v = String(value);
	const style =
		v === 'Active'
			? { bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', color: '#34d399' }
			: v === 'Watch'
				? { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)', color: '#fbbf24' }
				: { bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.25)', color: '#64748b' };
	return (
		<span
			style={{
				fontSize: 10,
				fontWeight: 700,
				textTransform: 'uppercase',
				letterSpacing: '0.05em',
				padding: '2px 7px',
				borderRadius: 4,
				background: style.bg,
				border: `1px solid ${style.border}`,
				color: style.color,
			}}
		>
			{v}
		</span>
	);
};

const PriceRenderer = ({ value }: CellRendererProps<HoldingRow>) => (
	<span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>${String(value)}</span>
);

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMNS: ColumnDef<HoldingRow>[] = [
	{ field: 'symbol', header: 'Symbol', width: 90, sortable: true },
	{ field: 'name', header: 'Name', width: 180, sortable: true },
	{
		field: 'price',
		header: 'Price',
		width: 100,
		sortable: true,
		renderer: { kind: 'react', component: PriceRenderer, capabilities: { scrollPresentation: 'freeze' } },
	},
	{
		field: 'change',
		header: 'Change $',
		width: 100,
		sortable: true,
		renderer: { kind: 'react', component: ChangeRenderer, capabilities: { scrollPresentation: 'freeze' } },
	},
	{
		field: 'changePct',
		header: 'Change %',
		width: 105,
		sortable: true,
		// scrollPresentation: 'html-snapshot' — the ▲/▼ badge with its green/red tinted background and
		// border is captured after each fidelity render and replayed as a static clone during scroll.
		renderer: { kind: 'react', component: ChangePctRenderer, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
	{ field: 'marketCap', header: 'Mkt Cap', width: 100, sortable: true },
	{ field: 'volume', header: 'Volume', width: 110, sortable: true },
	{ field: 'sector', header: 'Sector', width: 130, sortable: true },
	{ field: 'region', header: 'Region', width: 90, sortable: true },
	{ field: 'pe', header: 'P/E', width: 70, sortable: true },
	{
		field: 'status',
		header: 'Status',
		width: 90,
		sortable: true,
		// scrollPresentation: 'html-snapshot' — Active/Watch/Closed colored status chips are captured
		// as static HTML after fidelity render, so the portfolio status column looks settled while scrolling.
		renderer: { kind: 'react', component: StatusRenderer, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
];

const ROWS = generateHoldings(200);

interface SidebarPanelsDemoProps {
	onGridReady?: (event: GridReadyEvent<HoldingRow>) => void;
}

export default function SidebarPanelsDemo({ onGridReady }: SidebarPanelsDemoProps) {
	return (
		<div style={{ display: 'flex', height: '100%', flexDirection: 'column', gap: 12 }}>
			{/* Intro strip */}
			<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
				<div className='flex items-center gap-2'>
					<span className='w-2 h-2 rounded-full bg-blue-500 animate-pulse' />
					<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>
						Portfolio Holdings — 200 rows · 11 columns
					</span>
				</div>
				<div className='flex items-center gap-2 text-[9px] text-slate-500 font-bold uppercase tracking-widest'>
					<span className='px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400'>Columns Panel</span>
					<span className='px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400'>Filters Panel</span>
					<span className='px-2 py-0.5 rounded bg-slate-500/10 border border-slate-700/50 text-slate-400'>Sort Panel</span>
				</div>
			</div>

			{/* Grid with integrated sidebar — api.openPanel() / closePanel() / getOpenPanel() */}
			<div className='flex-1 min-h-0 rounded-lg overflow-hidden border border-slate-800 shadow-2xl'>
				<Grid<HoldingRow>
					rowModelType='client'
					columns={COLUMNS}
					rows={ROWS}
					pinLeftColumns={1}
					enableContextMenu={true}
					enableChart
					sidebar={{
						panels: ['columns', 'filters', 'sort', 'themes'],
						defaultOpen: 'columns',
						position: 'right',
						width: 300,
					}}
					onGridReady={onGridReady}
				/>
			</div>
		</div>
	);
}
