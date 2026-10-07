/**
 * Sticky Groups Demo
 *
 * 20k sales orders grouped region -> country -> category.
 *   - grouping.stickyHeaders: headers stick natively and stack per level; `levels` and `shadow` are live
 *   - rows pinned to the top / bottom (api.transaction({ pins })) stay put natively too
 *   - one group renderer for full-width rows, the hierarchy cell and the stuck copy (ctx.isStuck)
 *   - display: 'column' | 'columns' | 'row', depth 1-3, aggregates and a grand total
 *   - checkbox selection across groups: a group's tri-state checkbox selects every order beneath it,
 *     nested and collapsed groups included; ctx.selection drives the custom renderer's Select toggle
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grid, GroupCount, GroupToggle } from '@eregister/wit-grid-react';
import type { AggregationDef, ColumnDef, GridApi, GridInitialState, GridReadyEvent, GroupRenderContext } from '@eregister/wit-grid-react';
import { CheckSquare, ChevronsDownUp, ChevronsUpDown, Layers, Pin, Sparkles, X } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

interface OrderRow {
	id: string;
	region: string;
	country: string;
	category: string;
	product: string;
	revenue: number;
	units: number;
	margin: number;
}

const COUNTRIES: Record<string, string[]> = {
	Americas: ['USA', 'Canada', 'Brazil', 'Mexico'],
	EMEA: ['UK', 'Germany', 'France', 'Netherlands', 'Sweden'],
	APAC: ['Japan', 'Australia', 'Singapore', 'India'],
};
const PRODUCTS: Record<string, string[]> = {
	Hardware: ['Workstation Pro', 'Server Blade', 'Network Switch', 'SSD Array'],
	Software: ['Analytics Suite', 'DevOps Platform', 'Security Shield', 'ERP Core'],
	Services: ['Consulting', 'Managed Ops', 'Training', 'Support Plan'],
	Cloud: ['Compute Hours', 'Object Storage', 'Managed DB', 'CDN Traffic'],
};
const GROUP_FIELDS = ['region', 'country', 'category'] as const;
const ROW_COUNT = 20_000;

function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function generateOrders(count: number): OrderRow[] {
	const rand = mulberry32(2026);
	const regions = Object.keys(COUNTRIES);
	const categories = Object.keys(PRODUCTS);
	return Array.from({ length: count }, (_, i) => {
		const region = regions[Math.floor(rand() * regions.length)];
		const countries = COUNTRIES[region];
		const country = countries[Math.floor(rand() * countries.length)];
		const category = categories[Math.floor(rand() * categories.length)];
		const products = PRODUCTS[category];
		const units = 1 + Math.floor(rand() * 40);
		return {
			id: `SO-${10000 + i}`,
			region,
			country,
			category,
			product: products[Math.floor(rand() * products.length)],
			revenue: Math.round(units * (80 + rand() * 900)),
			units,
			margin: Math.round((8 + rand() * 40) * 10) / 10,
		};
	});
}

/** The largest group revenue at each level, so the renderer's mini bar has a scale. */
function levelMaxRevenue(rows: OrderRow[]): number[] {
	const sums: Map<string, number>[] = [new Map(), new Map(), new Map()];
	for (const row of rows) {
		let key = '';
		for (let level = 0; level < 3; level++) {
			key += `/${row[GROUP_FIELDS[level]]}`;
			sums[level].set(key, (sums[level].get(key) ?? 0) + row.revenue);
		}
	}
	return sums.map((m) => Math.max(...m.values()));
}

const ORDERS = generateOrders(ROW_COUNT);
const LEVEL_MAX = levelMaxRevenue(ORDERS);
const REGIONS = Object.keys(COUNTRIES);
const REGION_OF = new Map(ORDERS.map((order) => [order.id, order.region]));
const JAPAN_ORDER_IDS = ORDERS.filter((order) => order.country === 'Japan').map((order) => order.id);

const money = (value: unknown) => (typeof value === 'number' ? `$${Math.round(value).toLocaleString('en-US')}` : '');
const compactMoney = (value: unknown) => {
	const n = Number(value) || 0;
	return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000).toLocaleString('en-US')}K`;
};

const COLUMNS: ColumnDef<OrderRow>[] = [
	{ field: 'id', header: 'Order', width: 110 },
	{ field: 'region', header: 'Region', width: 110 },
	{ field: 'country', header: 'Country', width: 120 },
	{ field: 'category', header: 'Category', width: 120 },
	{ field: 'product', header: 'Product', width: 160 },
	{ field: 'revenue', header: 'Revenue', width: 130, valueFormatter: ({ value }) => money(value) },
	{ field: 'units', header: 'Units', width: 90 },
	{ field: 'margin', header: 'Margin', width: 90, valueFormatter: ({ value }) => (typeof value === 'number' ? `${value.toFixed(1)}%` : '') },
];

const AGGREGATES: AggregationDef<OrderRow>[] = [
	{ colId: 'revenue', aggFunc: 'sum' },
	{ colId: 'units', aggFunc: 'sum' },
	{ colId: 'margin', aggFunc: 'avg' },
];

// ─── Custom group renderer (rows, hierarchy cell and stuck header) ───────────

const LEVEL_TINT = ['bg-indigo-500', 'bg-sky-500', 'bg-emerald-500'];

const btn =
	'rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-300 hover:border-slate-500 hover:text-white';

/** One component for every place a group is drawn: it receives the GroupRenderContext as props. */
function GroupRenderer(ctx: GroupRenderContext<OrderRow>) {
	const revenue = Number(ctx.aggregates?.revenue) || 0;
	const share = ctx.isTotal ? 1 : Math.min(1, revenue / (LEVEL_MAX[ctx.level] || 1));
	const onClick = (fn: () => void) => (e: React.MouseEvent) => {
		e.stopPropagation();
		fn();
	};

	if (ctx.isTotal) {
		return (
			<div className='flex h-full items-center gap-3 px-3 text-xs font-extrabold text-amber-300'>
				{ctx.label}
				<span className='font-mono text-slate-100'>{money(revenue)}</span>
			</div>
		);
	}

	// Compact variant while the header is stuck: just toggle, label and revenue, on a solid tinted strip.
	if (ctx.isStuck) {
		return (
			<div className='flex h-full items-center gap-2 bg-slate-900 px-2 text-[11px]' style={{ paddingLeft: ctx.indentPx + 8 }}>
				<GroupToggle ctx={ctx} />
				<span className={`h-2 w-2 rounded-full ${LEVEL_TINT[ctx.level % 3]}`} />
				<span className='font-bold text-slate-100'>{ctx.label}</span>
				{ctx.selection !== 'none' && (
					<span className='rounded bg-purple-600/30 px-1 text-[9px] font-bold uppercase tracking-wider text-purple-200'>
						{ctx.selection === 'all' ? 'selected' : 'partly'}
					</span>
				)}
				<span className='ml-auto font-mono font-bold text-slate-300'>{compactMoney(revenue)}</span>
			</div>
		);
	}

	return (
		<div className='flex h-full items-center gap-2 px-2 text-xs' style={{ paddingLeft: ctx.indentPx + 8 }}>
			<GroupToggle ctx={ctx} />
			<span className='truncate font-bold text-slate-100'>{ctx.label}</span>
			<span className='text-[10px] text-slate-500'>
				<GroupCount ctx={ctx} /> orders
			</span>
			<div className='ml-2 h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-800'>
				<div className={`h-full rounded-full ${LEVEL_TINT[ctx.level % 3]}`} style={{ width: `${Math.max(2, share * 100)}%` }} />
			</div>
			<span className='font-mono font-bold text-slate-200'>{compactMoney(revenue)}</span>
			<div className='ml-auto flex shrink-0 items-center gap-1'>
				<button type='button' className={btn} onClick={onClick(ctx.expandAll)}>
					Expand below
				</button>
				<button type='button' className={btn} onClick={onClick(ctx.collapseAll)}>
					Collapse
				</button>
				<button
					type='button'
					aria-pressed={ctx.selection === 'all'}
					className={`${btn} ${ctx.selection === 'all' ? '!border-purple-500 !bg-purple-600 !text-white' : ctx.selection === 'some' ? '!border-purple-500/70 !text-purple-200' : ''}`}
					onClick={onClick(() => ctx.selectChildren(ctx.selection !== 'all'))}
				>
					{ctx.selection === 'all' ? 'Selected' : ctx.selection === 'some' ? 'Select rest' : 'Select'}
				</button>
			</div>
		</div>
	);
}

// ─── Controls ─────────────────────────────────────────────────────────────────

type Display = 'column' | 'columns' | 'row';
type LevelsOption = 'all' | 1 | 2;

function Segmented<T extends string | number | boolean>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (v: T) => void;
}) {
	return (
		<div className='flex items-center gap-1.5'>
			<span className='text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>{label}</span>
			<div className='flex rounded-lg border border-slate-800 bg-slate-900/60 p-0.5'>
				{options.map((o) => (
					<button
						key={String(o.value)}
						type='button'
						onClick={() => onChange(o.value)}
						className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
							value === o.value ? 'bg-purple-600 text-white shadow shadow-purple-600/20' : 'text-slate-400 hover:text-slate-200'
						}`}
					>
						{o.label}
					</button>
				))}
			</div>
		</div>
	);
}

const REACT_RENDERER = { kind: 'react', component: GroupRenderer } as const;

// ─── Demo component ───────────────────────────────────────────────────────────

interface Props {
	/** Hides the explanatory hint, keeping the controls and the grid. */
	compact?: boolean;
}

export default function GroupingStickyDemo({ compact = false }: Props = {}) {
	const [depth, setDepth] = useState<1 | 2 | 3>(3);
	const [display, setDisplay] = useState<Display>('column');
	const [sticky, setSticky] = useState(true);
	const [levels, setLevels] = useState<LevelsOption>('all');
	const [shadow, setShadow] = useState(true);
	const [pinTop, setPinTop] = useState(0);
	const [pinBottom, setPinBottom] = useState(1);
	const [custom, setCustom] = useState(true);
	const [groupBox, setGroupBox] = useState(false);
	const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
	const apiRef = useRef<GridApi<OrderRow> | null>(null);
	// The grid remounts per display mode, so the selection readout follows whichever grid is current.
	const [readyApi, setReadyApi] = useState<GridApi<OrderRow> | null>(null);
	useEffect(() => {
		if (!readyApi) return;
		const read = () => setSelectedIds(readyApi.getStateSnapshot().selectedRowIds);
		read();
		return readyApi.subscribeToKey('selectedRowIds', read);
	}, [readyApi]);

	const grouping = useMemo<NonNullable<Partial<GridInitialState<OrderRow>>['grouping']>>(
		() => ({
			by: GROUP_FIELDS.slice(0, depth),
			display,
			defaultExpanded: true,
			rowHeight: 36,
			totals: { grand: 'bottom' },
			stickyHeaders: sticky ? (levels === 'all' && shadow ? true : { ...(levels === 'all' ? {} : { levels }), shadow }) : false,
			...(display === 'row' && custom ? { rowRenderer: REACT_RENDERER } : {}),
		}),
		[depth, display, sticky, levels, shadow, custom]
	);

	const hierarchyColumn = useMemo<NonNullable<Partial<GridInitialState<OrderRow>>['hierarchyColumn']>>(
		() => ({
			header: 'Group',
			width: 320,
			indentPerLevel: 18,
			show: { toggle: true, checkbox: groupBox, count: true },
			...(display !== 'row' && custom ? { renderer: REACT_RENDERER } : {}),
		}),
		[display, custom, groupBox]
	);

	// What the grid was built with: later changes are applied live, without remounting.
	const applied = useRef<{ grouping: unknown; hierarchyColumn: unknown } | null>(null);
	const latest = useRef({ grouping, hierarchyColumn, pinTop, pinBottom, display });
	latest.current = { grouping, hierarchyColumn, pinTop, pinBottom, display };
	const apiDisplay = useRef<Display | null>(null);

	const initialState = useMemo<Partial<GridInitialState<OrderRow>>>(
		() => ({
			defaultRowHeight: 32,
			grouping: latest.current.grouping,
			aggregation: { defs: AGGREGATES },
			hierarchyColumn: latest.current.hierarchyColumn,
		}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[display]
	);

	const handleReady = useCallback((e: GridReadyEvent<OrderRow>) => {
		apiRef.current = e.api;
		setReadyApi(e.api);
		apiDisplay.current = latest.current.display;
		applied.current = { grouping: latest.current.grouping, hierarchyColumn: latest.current.hierarchyColumn };
		e.api.transaction({ pins: { top: latest.current.pinTop, bottom: latest.current.pinBottom } });
	}, []);

	const selectedByRegion = useMemo(() => {
		const counts = new Map<string, number>();
		for (const id of selectedIds) {
			const region = REGION_OF.get(id);
			if (region) counts.set(region, (counts.get(region) ?? 0) + 1);
		}
		return counts;
	}, [selectedIds]);

	useEffect(() => {
		const api = apiRef.current;
		if (!api || !applied.current || apiDisplay.current !== display) return;
		if (applied.current.grouping !== grouping) api.setGrouping(grouping);
		if (applied.current.hierarchyColumn !== hierarchyColumn) api.setHierarchyColumn(hierarchyColumn);
		applied.current = { grouping, hierarchyColumn };
	}, [grouping, hierarchyColumn, display]);

	useEffect(() => {
		if (apiDisplay.current === display) apiRef.current?.transaction({ pins: { top: pinTop, bottom: pinBottom } });
	}, [pinTop, pinBottom, display]);

	return (
		<div className='flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden'>
			<div className='flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-900 bg-slate-950/60 px-4 py-2.5'>
				<span className='flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>
					<Layers className='h-3.5 w-3.5 text-purple-400' />
					Grouping
				</span>
				<Segmented
					label='Depth'
					value={depth}
					onChange={setDepth}
					options={[
						{ value: 1, label: '1' },
						{ value: 2, label: '2' },
						{ value: 3, label: '3' },
					]}
				/>
				<Segmented
					label='Display'
					value={display}
					onChange={setDisplay}
					options={[
						{ value: 'column', label: 'One column' },
						{ value: 'columns', label: 'Column per level' },
						{ value: 'row', label: 'Full-width rows' },
					]}
				/>
				<Segmented
					label='Renderer'
					value={custom}
					onChange={setCustom}
					options={[
						{ value: false, label: 'Built-in' },
						{ value: true, label: 'Custom React' },
					]}
				/>
				<Segmented
					label='Group checkbox'
					value={groupBox}
					onChange={setGroupBox}
					options={[
						{ value: false, label: 'Selection column' },
						{ value: true, label: '+ Group column' },
					]}
				/>
				<div className='flex items-center gap-1.5 border-l border-slate-800 pl-5'>
					<Pin className='h-3.5 w-3.5 text-purple-400' />
					<Segmented
						label='Sticky'
						value={sticky}
						onChange={setSticky}
						options={[
							{ value: true, label: 'On' },
							{ value: false, label: 'Off' },
						]}
					/>
				</div>
				<Segmented
					label='Levels'
					value={levels}
					onChange={setLevels}
					options={[
						{ value: 'all', label: 'All' },
						{ value: 1, label: '1' },
						{ value: 2, label: '2' },
					]}
				/>
				<Segmented
					label='Shadow'
					value={shadow}
					onChange={setShadow}
					options={[
						{ value: true, label: 'On' },
						{ value: false, label: 'Off' },
					]}
				/>
				<Segmented
					label='Pin top'
					value={pinTop}
					onChange={setPinTop}
					options={[
						{ value: 0, label: '0' },
						{ value: 1, label: '1' },
						{ value: 2, label: '2' },
					]}
				/>
				<Segmented
					label='Pin bottom'
					value={pinBottom}
					onChange={setPinBottom}
					options={[
						{ value: 0, label: '0' },
						{ value: 1, label: '1' },
					]}
				/>
				<div className='ml-auto flex items-center gap-2'>
					<button
						type='button'
						onClick={() => apiRef.current?.expandAll()}
						className='flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1 text-[11px] font-bold text-slate-400 transition hover:text-slate-200'
					>
						<ChevronsUpDown className='h-3 w-3' />
						Expand all
					</button>
					<button
						type='button'
						onClick={() => apiRef.current?.collapseAll()}
						className='flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1 text-[11px] font-bold text-slate-400 transition hover:text-slate-200'
					>
						<ChevronsDownUp className='h-3 w-3' />
						Collapse all
					</button>
				</div>
			</div>

			<div className='flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-900 bg-slate-950/60 px-4 py-2'>
				<span className='flex items-center gap-1.5 text-[11px] font-bold text-slate-200'>
					<CheckSquare className='h-3.5 w-3.5 text-purple-400' />
					<span className='font-mono tabular-nums'>{selectedIds.length.toLocaleString('en-US')}</span>
					<span className='font-medium text-slate-500'>of {ROW_COUNT.toLocaleString('en-US')} orders selected</span>
				</span>
				<div className='flex flex-wrap items-center gap-1.5'>
					{REGIONS.map((region) => {
						const count = selectedByRegion.get(region) ?? 0;
						return (
							<span
								key={region}
								className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
									count > 0 ? 'border-purple-500/40 bg-purple-500/10 text-purple-200' : 'border-slate-800 text-slate-600'
								}`}
							>
								{region} {count.toLocaleString('en-US')}
							</span>
						);
					})}
				</div>
				<div className='ml-auto flex flex-wrap items-center gap-1.5'>
					{[
						{ label: 'Select all', run: () => apiRef.current?.selectAllRows({ scope: 'filtered' }) },
						{ label: 'Select EMEA group', run: () => apiRef.current?.setDescendantsSelected('group:region=EMEA', true) },
						{ label: 'Add Japan orders', run: () => apiRef.current?.selectRows(JAPAN_ORDER_IDS) },
					].map((action) => (
						<button
							key={action.label}
							type='button'
							onClick={action.run}
							className='rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-[11px] font-bold text-slate-300 transition hover:border-purple-500/50 hover:text-white'
						>
							{action.label}
						</button>
					))}
					<button
						type='button'
						onClick={() => apiRef.current?.clearRowSelection()}
						disabled={selectedIds.length === 0}
						className='flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-[11px] font-bold text-slate-400 transition hover:text-white disabled:opacity-40'
					>
						<X className='h-3 w-3' />
						Clear
					</button>
				</div>
			</div>

			{!compact && (
				<div className='flex shrink-0 items-start gap-2 rounded-lg border border-slate-900 bg-slate-950/40 px-3 py-2 text-[11px] leading-relaxed text-slate-400'>
					<Sparkles className='mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-400' />
					<span>
						Scroll through the {ROW_COUNT.toLocaleString('en-US')} orders: each open group header sticks under the column header, stacks
						with its parents, and is pushed up when its group ends. This is native sticky positioning, so it moves with the scroll on the
						GPU with no JavaScript per frame. Pinned rows sit above and below the stack. The custom renderer is one component for
						full-width rows, the group column and the stuck copy, which gets a compact layout through{' '}
						<code className='text-indigo-300'>ctx.isStuck</code>. Selection works across groups: tick a group to select every order
						beneath it, nested and collapsed groups included. A partly selected group shows a dash, and the renderer reads it from{' '}
						<code className='text-indigo-300'>ctx.selection</code>. Shift-click selects a range across group headers; Ctrl/Cmd-click
						toggles one order.
					</span>
				</div>
			)}

			<div className='min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-900/60'>
				<Grid<OrderRow>
					key={display}
					rowModelType='client'
					rows={ORDERS}
					columns={COLUMNS}
					getRowId={(row) => row.id}
					rowSelection={{ mode: 'multiple', selectAllScope: 'filtered' }}
					initialState={initialState}
					pinTopRows={pinTop}
					pinBottomRows={pinBottom}
					onGridReady={handleReady}
				/>
			</div>
		</div>
	);
}
