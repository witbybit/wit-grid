import React, { useEffect, useState } from 'react';
import { Grid } from '@eregister/wit-grid-react';
import type { AggregationDef, ColumnDef, CellRendererProps, GridApi, GridReadyEvent } from '@eregister/wit-grid-react';

// ── Data model ────────────────────────────────────────────────────────────────

interface SalesRow {
	id: string;
	region: string;
	country: string;
	category: string;
	product: string;
	rep: string;
	quarter: string;
	revenue: number;
	units: number;
	margin: number;
	status: 'Won' | 'Lost' | 'Pending';
}

const REGIONS = ['Americas', 'EMEA', 'APAC'];
const COUNTRIES: Record<string, string[]> = {
	Americas: ['USA', 'Canada', 'Brazil', 'Mexico'],
	EMEA: ['UK', 'Germany', 'France', 'Netherlands', 'Sweden'],
	APAC: ['Japan', 'Australia', 'Singapore', 'India', 'South Korea'],
};
const CATEGORIES = ['Hardware', 'Software', 'Services', 'Cloud'];
const PRODUCTS: Record<string, string[]> = {
	Hardware: ['Workstation Pro', 'Server Blade', 'Network Switch', 'SSD Array'],
	Software: ['Analytics Suite', 'DevOps Platform', 'Security Shield', 'ERP Core'],
	Services: ['Consulting Pack', 'Support Gold', 'Training Bundle', 'Migration Kit'],
	Cloud: ['Compute Flex', 'Storage Plus', 'CDN Accelerate', 'ML Pipeline'],
};
const REPS = ['Alice Chen', 'Ben Morris', 'Cara Singh', 'David Kim', 'Elena Voss', 'Felix Tan', 'Grace Park', 'Hiro Yamamoto'];
const QUARTERS = ['Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024'];
const STATUSES: SalesRow['status'][] = ['Won', 'Won', 'Won', 'Pending', 'Pending', 'Lost'];

function generateRows(count: number): SalesRow[] {
	return Array.from({ length: count }, (_, i) => {
		const region = REGIONS[i % REGIONS.length];
		const countryList = COUNTRIES[region];
		const country = countryList[Math.floor(i / REGIONS.length) % countryList.length];
		const category = CATEGORIES[(i * 3) % CATEGORIES.length];
		const productList = PRODUCTS[category];
		const product = productList[(i * 7) % productList.length];
		const rep = REPS[(i * 5) % REPS.length];
		const quarter = QUARTERS[(i * 2) % QUARTERS.length];
		const base = 20000 + ((i * 7919 + 13) % 180000);
		const revenue = Math.round(base / 100) * 100;
		const units = 1 + ((i * 11 + 3) % 49);
		const margin = Math.round((15 + ((i * 17) % 45)) * 10) / 10;
		const status = STATUSES[i % STATUSES.length];
		return { id: `sale-${i}`, region, country, category, product, rep, quarter, revenue, units, margin, status };
	});
}

// ── Aggregation definitions ───────────────────────────────────────────────────

const AGG_DEFS: AggregationDef<SalesRow>[] = [
	{ colId: 'revenue', aggFunc: 'sum' },
	{ colId: 'units', aggFunc: 'sum' },
	{ colId: 'margin', aggFunc: 'avg' },
];

// ── Cell renderers ────────────────────────────────────────────────────────────

const CurrencyRenderer = ({ value }: CellRendererProps<SalesRow>) => (
	<span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>${Number(value).toLocaleString()}</span>
);

const MarginRenderer = ({ value }: CellRendererProps<SalesRow>) => {
	const v = Number(value);
	const color = v >= 40 ? '#34d399' : v >= 25 ? '#fbbf24' : '#f87171';
	return <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color }}>{v.toFixed(1)}%</span>;
};

const StatusRenderer = ({ value }: CellRendererProps<SalesRow>) => {
	const v = String(value);
	const s =
		v === 'Won'
			? { bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', color: '#34d399' }
			: v === 'Pending'
				? { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)', color: '#fbbf24' }
				: { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.25)', color: '#f87171' };
	return (
		<span
			style={{
				fontSize: 10,
				fontWeight: 700,
				textTransform: 'uppercase',
				letterSpacing: '0.05em',
				padding: '2px 7px',
				borderRadius: 4,
				background: s.bg,
				border: `1px solid ${s.border}`,
				color: s.color,
			}}
		>
			{v}
		</span>
	);
};

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMNS: ColumnDef<SalesRow>[] = [
	{ field: 'region', header: 'Region', width: 110, sortable: true, enableRowGroup: true },
	{ field: 'country', header: 'Country', width: 120, sortable: true, enableRowGroup: true },
	{ field: 'category', header: 'Category', width: 110, sortable: true, enableRowGroup: true },
	{ field: 'product', header: 'Product', width: 160, sortable: true, enableRowGroup: true },
	{ field: 'rep', header: 'Sales Rep', width: 145, sortable: true, enableRowGroup: true },
	{ field: 'quarter', header: 'Quarter', width: 100, sortable: true, enableRowGroup: true },
	{
		field: 'revenue',
		header: 'Revenue',
		width: 130,
		sortable: true,

		enableRowGroup: false,
		// Formats the group and total aggregates (the renderer draws the data cells).
		valueFormatter: ({ value }) => (typeof value === 'number' ? `$${Math.round(value).toLocaleString('en-US')}` : ''),
		renderer: { kind: 'react', component: CurrencyRenderer, capabilities: { scrollPresentation: 'freeze' } },
	},
	{ field: 'units', header: 'Units', width: 75, sortable: true, enableRowGroup: false },
	{
		field: 'margin',
		header: 'Margin %',
		width: 95,
		sortable: true,

		enableRowGroup: false,
		valueFormatter: ({ value }) => (typeof value === 'number' ? `${value.toFixed(1)}%` : ''),
		renderer: { kind: 'react', component: MarginRenderer, capabilities: { scrollPresentation: 'freeze' } },
	},
	{
		field: 'status',
		header: 'Status',
		width: 95,
		sortable: true,

		enableRowGroup: true,
		renderer: { kind: 'react', component: StatusRenderer, capabilities: { scrollPresentation: 'freeze' } },
	},
];

const ROWS = generateRows(500);

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar({ api, showPanel, onTogglePanel }: { api: GridApi<SalesRow> | null; showPanel: boolean; onTogglePanel: () => void }) {
	return (
		<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
			<ToolBtn onClick={() => api?.expandAll()} title='Expand all groups'>
				Expand All
			</ToolBtn>
			<ToolBtn onClick={() => api?.collapseAll()} title='Collapse all groups'>
				Collapse All
			</ToolBtn>
			<div style={{ width: 1, height: 16, background: 'rgba(100,116,139,0.3)', margin: '0 2px' }} />
			<ToolBtn onClick={onTogglePanel} title='Toggle drag-to-group panel' accent={showPanel}>
				{showPanel ? 'Hide Group Panel' : 'Group Panel'}
			</ToolBtn>
			<div style={{ width: 1, height: 16, background: 'rgba(100,116,139,0.3)', margin: '0 2px' }} />
			<ToolBtn onClick={() => api?.exportCsv({ fileName: 'sales-pipeline.csv' })} title='Download as CSV (Excel-compatible)' accent>
				Export CSV
			</ToolBtn>
		</div>
	);
}

function ToolBtn({ children, onClick, title, accent }: { children: React.ReactNode; onClick: () => void; title?: string; accent?: boolean }) {
	return (
		<button
			onClick={onClick}
			title={title}
			style={{
				height: 26,
				padding: '0 10px',
				fontSize: 10,
				fontWeight: 700,
				letterSpacing: '0.05em',
				textTransform: 'uppercase',
				borderRadius: 5,
				border: accent ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(30,41,59,0.8)',
				background: accent ? 'rgba(59,130,246,0.12)' : 'rgba(15,23,42,0.6)',
				color: accent ? '#60a5fa' : '#64748b',
				cursor: 'pointer',
				whiteSpace: 'nowrap',
			}}
		>
			{children}
		</button>
	);
}

// ── Inner component ───────────────────────────────────────────────────────────

function RealtimeGroupingDemoInner({
	api,
	onGridReady,
	compact,
}: {
	api: GridApi<SalesRow> | null;
	onGridReady?: (event: GridReadyEvent<SalesRow>) => void;
	compact: boolean;
}) {
	const [showPanel, setShowPanel] = useState(!compact);

	useEffect(() => {
		if (!api) return;
		api.setRows(ROWS);
	}, [api]);

	useEffect(() => {
		if (!api) return;
		api.setShowGroupPanel(showPanel);
	}, [api, showPanel]);

	return (
		<div style={{ display: 'flex', height: '100%', flexDirection: 'column', gap: 12 }}>
			{/* Intro strip */}
			<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
				<div className='flex items-center gap-2'>
					<span className='w-2 h-2 rounded-full bg-violet-500 animate-pulse' />
					<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider'>
						{compact ? 'Sales Pipeline — Live Grouping' : 'Sales Pipeline — 500 rows · 10 columns · Live Grouping + Aggregations'}
					</span>
					{!compact && showPanel && (
						<span className='text-[10px] text-blue-400/60 font-semibold ml-2'>· Drag column headers into the group panel to group</span>
					)}
				</div>
				<Toolbar api={api} showPanel={showPanel} onTogglePanel={() => setShowPanel((v) => !v)} />
			</div>

			{/* Grid */}
			<div className='flex-1 min-h-0 rounded-lg overflow-hidden border border-slate-800 shadow-2xl'>
				<Grid<SalesRow>
					rowModelType='client'
					columns={COLUMNS}
					rows={ROWS}
					persistence='wit-grid-sales-demo'
					initialState={{
						grouping: { by: ['region', 'category'], rowHeight: 44, totals: { groups: 'bottom' }, stickyHeaders: true },
						aggregation: { defs: AGG_DEFS },
						showGroupPanel: true,
					}}
					pinLeftColumns={1}
					enableContextMenu={true}
					sidebar={
						compact
							? undefined
							: { panels: ['columns', 'filters', 'sort', 'themes'], defaultOpen: 'columns', position: 'right', width: 280 }
					}
					onGridReady={onGridReady}
				/>
			</div>
		</div>
	);
}

// ── Page export ───────────────────────────────────────────────────────────────

interface RealtimeGroupingDemoProps {
	onGridReady?: (event: GridReadyEvent<SalesRow>) => void;
	/** Hides the description subtitle and the built-in columns/filters/sort/themes sidebar. */
	compact?: boolean;
}

export default function RealtimeGroupingDemo({ onGridReady, compact = false }: RealtimeGroupingDemoProps) {
	const [api, setApi] = useState<GridApi<SalesRow> | null>(null);

	return (
		<RealtimeGroupingDemoInner
			api={api}
			compact={compact}
			onGridReady={(event) => {
				setApi(event.api);
				onGridReady?.(event);
			}}
		/>
	);
}
