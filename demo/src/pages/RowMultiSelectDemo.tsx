/**
 * Row Multi-Select Demo
 *
 * Showcases row multi-select across all three rowModelType modes:
 *   - client     — all data local; grid owns sorting/filtering/pagination
 *   - infinite   — block/range loading; datasource receives startRow/endRow
 *   - server     — SSRM block loading; datasource receives startRow/endRow
 *
 * Features demonstrated:
 *   - checkboxSelection column  →  checkbox cell + select-all header checkbox
 *   - Ctrl/Cmd+Click            →  toggle a row without losing cell focus
 *   - api.selectRows / deselectRows / toggleRowSelection / selectAllRows / clearRowSelection
 *   - api.rows().getChecked()   →  drive bulk actions from the selection
 *   - rowSelectionChanged event →  reactive event log
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Grid, GridEventName } from '@eregister/wit-grid-react';
import type { ColumnDef, GridApi, GridReadyEvent, InfiniteDatasource, RowSelectionScope, ServerSideDatasource } from '@eregister/wit-grid-react';
import { CheckSquare, Trash2, Download, Tag, MousePointerClick, Info } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

interface OrderRow {
	id: string;
	orderId: string;
	customer: string;
	product: string;
	qty: number;
	unitPrice: number;
	status: 'Fulfilled' | 'Pending' | 'Cancelled';
	region: string;
}

const CUSTOMERS = ['Acme Corp', 'GlobalTech', 'NovaStar', 'ByteWave', 'PrimeLine', 'CoreLogic', 'SkyNet', 'DataFuse'];
const PRODUCTS = ['Widget Pro', 'Gadget X', 'Ultra Module', 'Nexus Kit', 'CorePack', 'Flex Unit', 'Spark One', 'Orbit Set'];
const STATUSES: OrderRow['status'][] = ['Fulfilled', 'Pending', 'Cancelled'];
const REGIONS = ['APAC', 'EMEA', 'AMER', 'LATAM'];

function generateOrders(count: number): OrderRow[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `ORD-${1000 + i}`,
		orderId: `ORD-${1000 + i}`,
		customer: CUSTOMERS[i % CUSTOMERS.length],
		product: PRODUCTS[i % PRODUCTS.length],
		qty: ((i * 7) % 20) + 1,
		unitPrice: ((i * 13) % 90) + 10,
		status: STATUSES[i % STATUSES.length],
		region: REGIONS[i % REGIONS.length],
	}));
}

// ─── Column definitions ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
	Fulfilled: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
	Pending: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
	Cancelled: 'bg-rose-500/10 border-rose-500/20 text-rose-400',
};

const StatusBadge = ({ value }: { value: unknown }) => {
	const v = String(value ?? '');
	return (
		<span
			className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border leading-none inline-block ${STATUS_COLORS[v] ?? 'text-slate-400'}`}
		>
			{v}
		</span>
	);
};

const COLUMNS: ColumnDef<OrderRow>[] = [
	{ field: 'orderId', header: 'Order ID', width: 110 },
	{ field: 'customer', header: 'Customer', width: 130 },
	{ field: 'product', header: 'Product', width: 150 },
	{ field: 'qty', header: 'Qty', width: 70 },
	{ field: 'unitPrice', header: 'Unit Price', width: 100, valueGetter: ({ row }) => `$${Number(row.unitPrice).toFixed(2)}` },
	{
		field: 'status',
		header: 'Status',
		width: 110,
		renderer: { kind: 'react', component: ({ value }: { value: unknown }) => <StatusBadge value={value} /> } as any,
	},
	{ field: 'region', header: 'Region', width: 90 },
];

function BulkActions({
	onDelete,
	onExport,
	onTag,
	bulkTag,
	setBulkTag,
	api,
	selectedCount,
	selectAllScope,
	setSelectAllScope,
}: {
	onDelete: () => void;
	onExport: () => void;
	onTag: () => void;
	bulkTag: string;
	setBulkTag: (v: string) => void;
	api: GridApi<OrderRow> | null;
	selectedCount: number;
	selectAllScope: RowSelectionScope;
	setSelectAllScope: (scope: RowSelectionScope) => void;
}) {
	const hasSelection = selectedCount > 0;

	return (
		<>
			{/* Tag input */}
			<div className='flex items-center gap-1.5'>
				<input
					type='text'
					value={bulkTag}
					onChange={(e) => setBulkTag(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && onTag()}
					placeholder='Tag label…'
					className='w-28 text-[11px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500 transition'
				/>
				<button
					onClick={onTag}
					disabled={!hasSelection || !bulkTag.trim()}
					className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition border border-slate-700'
				>
					<Tag className='w-3.5 h-3.5' /> Tag
				</button>
			</div>

			<button
				onClick={onExport}
				disabled={!hasSelection}
				className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition border border-slate-700'
			>
				<Download className='w-3.5 h-3.5' /> Export CSV
			</button>

			<button
				onClick={onDelete}
				disabled={!hasSelection}
				className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-900/50 hover:bg-rose-800/60 text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed transition border border-rose-800/50'
			>
				<Trash2 className='w-3.5 h-3.5' /> Delete
			</button>

			<button
				onClick={() => api?.selectAllRows({ scope: selectAllScope })}
				className='px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-900/40 hover:bg-indigo-800/50 text-indigo-300 transition border border-indigo-800/50'
			>
				Select All
			</button>

			<div className='flex rounded-lg overflow-hidden border border-slate-700'>
				{(['page', 'filtered', 'all'] as RowSelectionScope[]).map((scope) => (
					<button
						key={scope}
						onClick={() => setSelectAllScope(scope)}
						className={`px-2.5 py-1.5 text-[10px] font-semibold capitalize transition ${
							selectAllScope === scope ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
						}`}
					>
						{scope}
					</button>
				))}
			</div>

			<button
				onClick={() => api?.clearRowSelection()}
				disabled={!hasSelection}
				className='px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition border border-slate-700'
			>
				Clear
			</button>
		</>
	);
}

// ─── Main demo ────────────────────────────────────────────────────────────────

type GridMode = 'client' | 'infinite' | 'server';

interface RowMultiSelectDemoProps {
	onGridReady?: (event: GridReadyEvent<OrderRow>) => void;
}

export default function RowMultiSelectDemo({ onGridReady }: RowMultiSelectDemoProps) {
	const [rows, setRows] = useState<OrderRow[]>(() => generateOrders(120));
	const [lastEvent, setLastEvent] = useState<string>('—');
	const [bulkTag, setBulkTag] = useState<string>('');
	const [api, setApi] = useState<GridApi<OrderRow> | null>(null);
	const [selectedCount, setSelectedCount] = useState(0);
	const [selectAllScope, setSelectAllScope] = useState<RowSelectionScope>('page');
	const [gridMode, setGridMode] = useState<GridMode>('client');

	const infiniteDatasource = useMemo<InfiniteDatasource<OrderRow>>(
		() => ({
			getRows: async ({ startRow, endRow }) => ({
				rows: rows.slice(startRow, endRow),
				totalCount: rows.length,
			}),
		}),
		[rows]
	);

	const serverDatasource = useMemo<ServerSideDatasource<OrderRow>>(
		() => ({
			getRows: async ({ startRow, endRow }) => ({
				rows: rows.slice(startRow, endRow),
				rowCount: rows.length,
			}),
		}),
		[rows]
	);

	// Subscribe to rowSelectionChanged for the event log
	useEffect(() => {
		if (!api) return;
		const readSelection = () => setSelectedCount(api.getStateSnapshot().selectedRowIds.length);
		readSelection();
		const unsubKey = api.subscribeToKey('selectedRowIds', readSelection);
		const unsubEvent = api.addEventListener(GridEventName.rowSelectionChanged, (event) => {
			const { selectedRowIds, changedRowIds } = event.payload;
			setLastEvent(`${changedRowIds.length} row(s) toggled → ${selectedRowIds.length} total selected`);
			setSelectedCount(selectedRowIds.length);
		});
		return () => {
			unsubKey();
			unsubEvent();
		};
	}, [api]);

	const handleDeleteSelected = useCallback(() => {
		if (!api) return;
		const ids = new Set<string>(api.rows().getCheckedIds());
		if (ids.size === 0) return;
		setRows((prev: OrderRow[]) => prev.filter((r) => !ids.has(r.id)));
		api.clearRowSelection();
	}, [api]);

	const handleExportCSV = useCallback(() => {
		if (!api) return;
		const checked: OrderRow[] = api.rows().getChecked();
		if (checked.length === 0) return;
		const header = 'Order ID,Customer,Product,Qty,Unit Price,Status,Region';
		const lines = checked.map((r) => `${r.orderId},${r.customer},${r.product},${r.qty},${r.unitPrice},${r.status},${r.region}`);
		const csv = [header, ...lines].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'selected-orders.csv';
		a.click();
		URL.revokeObjectURL(url);
	}, [api]);

	const handleTagSelected = useCallback(() => {
		if (!api) return;
		const tag = bulkTag.trim();
		if (!tag) return;
		const checkedIds = new Set<string>(api.rows().getCheckedIds());
		if (checkedIds.size === 0) return;
		setRows((prev: OrderRow[]) => prev.map((r) => (checkedIds.has(r.id) ? { ...r, product: `[${tag}] ${r.product}` } : r)));
		setBulkTag('');
	}, [api, bulkTag]);

	const MODE_LABELS: Record<GridMode, string> = { client: 'Client', infinite: 'Infinite', server: 'Server' };

	return (
		<div className='flex flex-col gap-4 h-full min-h-0'>
			{/* ── Feature callout cards ──────────────────────────────────── */}
			<div className='flex gap-3 shrink-0'>
				<div className='flex-1 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5'>
					<div className='flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-400'>
						<CheckSquare className='w-3.5 h-3.5' /> First-Class Row Selection
					</div>
					<p className='text-[11px] text-slate-400 leading-snug'>
						Pass <code className='bg-slate-800 px-1 rounded text-indigo-300 font-mono text-[10px]'>rowSelection: 'multiple'</code> to{' '}
						<code className='bg-slate-800 px-1 rounded text-indigo-300 font-mono text-[10px]'>Grid</code>. Works across{' '}
						<code className='bg-slate-800 px-1 rounded text-indigo-300 font-mono text-[10px]'>client</code>,{' '}
						<code className='bg-slate-800 px-1 rounded text-indigo-300 font-mono text-[10px]'>infinite</code>, and{' '}
						<code className='bg-slate-800 px-1 rounded text-indigo-300 font-mono text-[10px]'>server</code> row models.
					</p>
				</div>
				<div className='flex-1 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5'>
					<div className='flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-400'>
						<MousePointerClick className='w-3.5 h-3.5' /> Ctrl / ⌘ + Click
					</div>
					<p className='text-[11px] text-slate-400 leading-snug'>
						Hold <kbd className='bg-slate-800 border border-slate-700 px-1.5 rounded font-mono text-[10px]'>Ctrl</kbd> or{' '}
						<kbd className='bg-slate-800 border border-slate-700 px-1.5 rounded font-mono text-[10px]'>⌘</kbd> and click any cell to
						toggle that row's selection without moving the cell cursor.
					</p>
				</div>
			</div>

			{/* ── Toolbar ────────────────────────────────────────────────── */}
			<div className='flex items-center gap-3 shrink-0 bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-2.5'>
				<div className='flex items-center gap-2 text-[11px] text-slate-500 font-medium'>
					<Info className='w-3.5 h-3.5 shrink-0' />
					Switch row model type to see selection work identically across all three modes.
				</div>
				<div className='flex-1' />
				<div className='flex rounded-lg overflow-hidden border border-slate-700'>
					{(['client', 'infinite', 'server'] as GridMode[]).map((mode) => (
						<button
							key={mode}
							onClick={() => {
								setGridMode(mode);
								api?.clearRowSelection();
							}}
							className={`px-3 py-1.5 text-[10px] font-semibold transition ${
								gridMode === mode ? 'bg-slate-200 text-slate-950' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
							}`}
						>
							{MODE_LABELS[mode]}
						</button>
					))}
				</div>
				<BulkActions
					api={api}
					selectedCount={selectedCount}
					onDelete={handleDeleteSelected}
					onExport={handleExportCSV}
					onTag={handleTagSelected}
					bulkTag={bulkTag}
					setBulkTag={setBulkTag}
					selectAllScope={selectAllScope}
					setSelectAllScope={setSelectAllScope}
				/>
			</div>

			{/* ── Grid ───────────────────────────────────────────────────── */}
			<div className='flex-1 min-h-0 border border-slate-800 rounded-xl overflow-hidden bg-slate-950 shadow-2xl flex flex-col'>
				<div className='flex-1 min-h-0'>
					{gridMode === 'client' ? (
						<Grid
							key='client'
							rowModelType='client'
							rows={rows}
							columns={COLUMNS}
							getRowId={(row) => row.id}
							rowSelection={{ mode: 'multiple', selectAllScope }}
							pagination={{ pageSize: 25 }}
							sidebar={{ panels: ['themes'] }}
							showStatusBar
							enableNavigation={true}
							navigationOptions={{ editTrigger: 'doubleClick' }}
							onGridReady={(event) => {
								setApi(event.api);
								onGridReady?.(event);
							}}
						/>
					) : gridMode === 'infinite' ? (
						<Grid
							key='infinite'
							rowModelType='infinite'
							datasource={infiniteDatasource}
							columns={COLUMNS}
							getRowId={(row) => row.id}
							rowSelection={{ mode: 'multiple', selectAllScope }}
							showStatusBar
							enableNavigation={true}
							navigationOptions={{ editTrigger: 'doubleClick' }}
							onGridReady={(event) => {
								setApi(event.api);
								onGridReady?.(event);
							}}
						/>
					) : (
						<Grid
							key='server'
							rowModelType='server'
							datasource={serverDatasource}
							columns={COLUMNS}
							getRowId={(row) => row.id}
							rowSelection={{ mode: 'multiple', selectAllScope }}
							showStatusBar
							enableNavigation={true}
							navigationOptions={{ editTrigger: 'doubleClick' }}
							onGridReady={(event) => {
								setApi(event.api);
								onGridReady?.(event);
							}}
						/>
					)}
				</div>
			</div>

			{/* ── Event log ──────────────────────────────────────────────── */}
			<div className='shrink-0 flex items-center gap-2 text-[10px] font-mono'>
				<span className='text-slate-600'>rowSelectionChanged →</span>
				<span className='text-slate-400'>{lastEvent}</span>
			</div>
		</div>
	);
}
