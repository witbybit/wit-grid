/**
 * Realtime Dashboard — a 400-row live portfolio grid showcasing three renderer protocols side
 * by side (DOM, imperative React, and standard React), plus the built-in data integrity
 * pipeline (validation, quality checks, diffing, a live transaction stream, and conflicts).
 *
 *  - price   — DomCellRenderer sparkline: zero React overhead, direct canvas mutation
 *  - change  — imperative React renderer: updates bypass React's scheduler entirely
 *  - volume  — standard React renderer (memo), shown as contrast
 */
'use client';

import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
	Grid,
	GridEventName,
	duplicateValueRule,
	type ColumnDef,
	type DomCellRenderer,
	type GridApi,
	type GridContextMenuOptions,
	type GridIntegrityIssue,
	type GridReadyEvent,
	type GridTransactionStreamHandle,
	type ImperativeCellHandle,
	type CellRendererProps,
	type StyleRule,
} from '@eregister/wit-grid-react';
import { Activity, BarChart3, Code2, RefreshCw, TrendingUp, Zap, ShieldCheck } from 'lucide-react';

// ─── Data model ────────────────────────────────────────────────────────────────

export interface DashboardStockRow {
	id: string;
	symbol: string;
	name: string;
	price: string;
	change: string;
	volume: string;
	risk: 'low' | 'medium' | 'high';
}

const SEED_STOCKS = [
	{ id: 'AAPL', name: 'Apple Inc.', price: 175.5 },
	{ id: 'MSFT', name: 'Microsoft Corp.', price: 420.2 },
	{ id: 'GOOGL', name: 'Alphabet Inc.', price: 150.1 },
	{ id: 'NVDA', name: 'NVIDIA Corp.', price: 875 },
	{ id: 'TSLA', name: 'Tesla Inc.', price: 170.3 },
	{ id: 'AMZN', name: 'Amazon.com Inc.', price: 178.4 },
	{ id: 'NFLX', name: 'Netflix Inc.', price: 610.5 },
	{ id: 'AMD', name: 'Advanced Micro Devices', price: 180.2 },
];

function createDashboardRows(): DashboardStockRow[] {
	return Array.from({ length: 400 }, (_, index) => {
		const stock = SEED_STOCKS[index % SEED_STOCKS.length];
		const change = ((index * 13) % 120) / 10 - 6;
		const volume = 5 + ((index * 17) % 120);
		return {
			id: `${stock.id}${index >= SEED_STOCKS.length ? `.${Math.floor(index / SEED_STOCKS.length)}` : ''}`,
			symbol: stock.id,
			name: stock.name,
			price: (stock.price * (0.75 + ((index * 7) % 50) / 100)).toFixed(2),
			change: `${change >= 0 ? '+' : ''}${change.toFixed(1)}`,
			volume: volume.toFixed(1),
			risk: (stock.price > 500 || Math.abs(change) > 4 ? 'high' : Math.abs(change) > 2 ? 'medium' : 'low') as DashboardStockRow['risk'],
		};
	});
}

// ─── Renderer 1: Sparkline DOM renderer ───────────────────────────────────────

const priceHistory = new Map<string, number[]>();

function addTick(rowId: string, price: number, maxLen = 24): void {
	let hist = priceHistory.get(rowId);
	if (!hist) {
		hist = [];
		priceHistory.set(rowId, hist);
	}
	hist.push(price);
	if (hist.length > maxLen) hist.shift();
}

function drawSparkline(ctx: CanvasRenderingContext2D, hist: number[], w: number, h: number): void {
	ctx.clearRect(0, 0, w, h);
	if (hist.length < 2) return;

	const min = Math.min(...hist);
	const max = Math.max(...hist);
	const range = max - min || 1;
	const isUp = hist[hist.length - 1] >= hist[0];
	const color = isUp ? '#10b981' : '#ef4444';

	ctx.beginPath();
	ctx.strokeStyle = color;
	ctx.lineWidth = 1.5;
	ctx.lineJoin = 'round';

	hist.forEach((p, i) => {
		const x = (i / (hist.length - 1)) * w;
		const y = h - ((p - min) / range) * h * 0.8 - h * 0.1;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	});
	ctx.stroke();

	const lastX = w;
	const lastY = h - ((hist[hist.length - 1] - min) / range) * h * 0.8 - h * 0.1;
	ctx.beginPath();
	ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}

/**
 * Zero-React-overhead sparkline + price cell. Grid calls mount() once per slot, update() on
 * every tick — no React, no scheduler. Per-row price history persists across slot recycling.
 */
const SparklineRenderer: DomCellRenderer<DashboardStockRow> = {
	mount(container, params) {
		container.style.cssText =
			'display:flex;flex-direction:column;align-items:flex-start;justify-content:center;' +
			'padding:0 6px;gap:1px;width:100%;height:100%;box-sizing:border-box;';

		const valueEl = document.createElement('span');
		valueEl.style.cssText = 'font-family:ui-monospace,monospace;font-weight:700;font-size:11px;color:#e2e8f0;line-height:1;white-space:nowrap;';

		const canvas = document.createElement('canvas');
		const DPR = window.devicePixelRatio || 1;
		const W = 96,
			H = 16;
		canvas.width = W * DPR;
		canvas.height = H * DPR;
		canvas.style.cssText = `display:block;width:${W}px;height:${H}px;`;

		container.appendChild(valueEl);
		container.appendChild(canvas);

		const ctx = canvas.getContext('2d')!;
		ctx.scale(DPR, DPR);

		let currentRowId = params.node.id;

		function render(rowId: string, value: unknown) {
			const price = parseFloat(String(value));
			if (!isNaN(price)) addTick(rowId, price);
			valueEl.textContent = `$${typeof value === 'string' ? value : String(value)}`;
			const hist = priceHistory.get(rowId) ?? [];
			drawSparkline(ctx, hist, W, H);
		}

		render(currentRowId, params.value);

		return {
			update(p) {
				currentRowId = p.node.id;
				render(currentRowId, p.value);
			},
			destroy() {
				container.innerHTML = '';
			},
		};
	},
};

// ─── Renderer 2: Live price (imperative React) ────────────────────────────────

/**
 * Imperative React renderer for real-time price changes. Grid calls ref.current.update()
 * directly — bypasses React's scheduler entirely. Updates are pure DOM mutations.
 */
const LivePriceRenderer = forwardRef<ImperativeCellHandle<DashboardStockRow>, CellRendererProps<DashboardStockRow>>(function LivePriceRenderer(
	{ value },
	ref
) {
	const spanRef = useRef<HTMLSpanElement>(null);
	const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const prevValueRef = useRef(value);

	useImperativeHandle(
		ref,
		() => ({
			update(params) {
				const span = spanRef.current;
				if (!span) return;
				const prev = parseFloat(String(prevValueRef.current));
				const next = parseFloat(String(params.value));
				prevValueRef.current = params.value;
				const raw = params.value;
				span.textContent = `${typeof raw === 'string' ? raw : String(raw)}%`;
				if (next !== prev) {
					const flashColor = next > prev ? '#10b981' : '#ef4444';
					span.style.color = flashColor;
					span.style.fontWeight = '800';
					if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
					flashTimerRef.current = setTimeout(() => {
						if (spanRef.current) {
							spanRef.current.style.color = next > prev ? '#34d399' : '#f87171';
							spanRef.current.style.fontWeight = '700';
						}
					}, 350);
				}
			},
		}),
		[]
	);

	useEffect(
		() => () => {
			if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
		},
		[]
	);

	const raw = value;
	const numVal = parseFloat(String(raw));
	const initialColor = numVal >= 0 ? '#34d399' : '#f87171';

	return (
		<span
			ref={spanRef}
			style={{
				fontFamily: 'ui-monospace,monospace',
				fontWeight: 700,
				fontSize: '12px',
				color: initialColor,
				transition: 'color 0.35s ease',
				display: 'inline-block',
			}}
		>
			{typeof raw === 'string' ? raw : String(raw)}%
		</span>
	);
});
LivePriceRenderer.displayName = 'LivePriceRenderer';

// ─── Renderer 3: Heavy analytics cell (standard React, memo) ──────────────────

function HeavyAnalyticsCellInner({ value, row }: CellRendererProps<DashboardStockRow>) {
	const stockRow = row as DashboardStockRow;
	const volume = parseFloat(String(value));
	const changeVal = parseFloat(stockRow.change || '0');
	const price = parseFloat(stockRow.price || '0');

	const riskScore = useMemo(() => {
		const volatility = Math.abs(changeVal) / (price || 1);
		const liquidityFactor = volume > 50 ? 0.8 : volume > 20 ? 1.0 : 1.3;
		const raw = volatility * liquidityFactor * 100;
		return Math.min(Math.max(raw, 0), 10).toFixed(2);
	}, [price, changeVal, volume]);

	const riskColor = parseFloat(riskScore) > 4 ? '#ef4444' : parseFloat(riskScore) > 2 ? '#f59e0b' : '#10b981';

	return (
		<div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 4px', lineHeight: 1.2 }}>
			<span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700, fontSize: '11px', color: '#e2e8f0' }}>{volume.toFixed(1)}M</span>
			<span style={{ fontSize: '9px', color: riskColor, fontWeight: 600 }}>risk {riskScore}</span>
		</div>
	);
}

const HeavyAnalyticsCell = memo(HeavyAnalyticsCellInner);
HeavyAnalyticsCell.displayName = 'HeavyAnalyticsCell';

function createDashboardColumns(): ColumnDef<DashboardStockRow>[] {
	return [
		{ field: 'symbol', header: 'Ticker', width: 80 },
		{ field: 'name', header: 'Company', width: 160 },
		{
			field: 'price',
			header: 'Price (DOM)',
			width: 130,
			renderer: {
				kind: 'dom',
				renderer: SparklineRenderer,
				capabilities: { scrollPresentation: 'html-snapshot', htmlSnapshot: { allowShellWhenMissing: true } },
			},
		},
		{ field: 'change', header: 'Change % (Imperative)', width: 165, renderer: { kind: 'imperativeReact', component: LivePriceRenderer } },
		{ field: 'volume', header: 'Vol/Analytics (React)', width: 165, renderer: { kind: 'react', component: HeavyAnalyticsCell } },
		{ field: 'risk', header: 'Risk', width: 90 },
	];
}

// ─── Dashboard shell ───────────────────────────────────────────────────────────

interface RealtimeDashboardProps {
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
	onCellValueChanged?: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<DashboardStockRow>) => void;
}

export default function RealtimeDashboard({
	editTrigger = 'doubleClick',
	arrowKeyNavigationEdit = true,
	onCellValueChanged,
	onGridReady,
}: RealtimeDashboardProps = {}) {
	const columns = useMemo(() => createDashboardColumns(), []);
	const rows = useMemo(() => createDashboardRows(), []);
	const [api, setApi] = useState<GridApi<DashboardStockRow> | null>(null);
	const [stats, setStats] = useState({ sum: 0, avg: 0, min: 0, max: 0, count: 0 });
	const [prices, setPrices] = useState<number[]>([]);
	const [companyCount, setCompanyCount] = useState(0);
	const [eventLogs, setEventLogs] = useState<Array<{ id: number; time: string; msg: string; type: string }>>([]);
	const eventLogIdRef = useRef(0);
	const [autoFire, setAutoFire] = useState(false);
	const [autoFireIntervalMs, setAutoFireIntervalMs] = useState(100);
	const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const streamRef = useRef<GridTransactionStreamHandle<DashboardStockRow> | null>(null);
	const streamTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [qualityIssues, setQualityIssues] = useState<GridIntegrityIssue[] | null>(null);
	const [diffActive, setDiffActive] = useState(false);
	const [streamRunning, setStreamRunning] = useState(false);
	const [conflictCount, setConflictCount] = useState(0);

	const selectedRowIdsRef = useRef<string[]>([]);
	const selectedColsRef = useRef<string[]>([]);

	const styleRules = useMemo<StyleRule<DashboardStockRow>[]>(
		() => [
			{
				kind: 'row',
				when: (row) => (parseFloat(row.change) || 0) > 0,
				rowClass: 'transition-all duration-200 border-l-2 border-emerald-500/60 bg-emerald-950/5 hover:bg-emerald-900/10 text-emerald-100/90',
			},
			{
				kind: 'row',
				when: (row) => (parseFloat(row.change) || 0) < 0,
				rowClass: 'transition-all duration-200 border-l-2 border-rose-500/60 bg-rose-950/5 hover:bg-rose-900/10 text-rose-100/90',
			},
			{
				kind: 'cell',
				field: 'change',
				when: (row) => (parseFloat(row.change) || 0) > 0,
				cellClass: 'text-emerald-400 font-extrabold font-mono',
			},
			{ kind: 'cell', field: 'change', when: (row) => (parseFloat(row.change) || 0) < 0, cellClass: 'text-rose-400 font-extrabold font-mono' },
			{ kind: 'cell', field: 'price', when: () => true, cellClass: 'font-mono font-bold text-slate-200' },
		],
		[]
	);

	const refreshStats = useCallback(() => {
		if (!api) return;
		const rowIds = selectedRowIdsRef.current;
		const cols = selectedColsRef.current;
		const numericValues: number[] = [];
		for (const rowId of rowIds)
			for (const col of cols) {
				const num = parseFloat(String(api.getCellValue(rowId, col)));
				if (!Number.isNaN(num)) numericValues.push(num);
			}
		if (numericValues.length) {
			const sum = numericValues.reduce((a, b) => a + b, 0);
			setStats({
				sum,
				avg: sum / numericValues.length,
				min: Math.min(...numericValues),
				max: Math.max(...numericValues),
				count: numericValues.length,
			});
		} else {
			setStats({ sum: 0, avg: 0, min: 0, max: 0, count: 0 });
		}
		if (rowIds.length > 0) {
			setPrices(rowIds.map((id) => parseFloat(String(api.getCellValue(id, 'price'))) || 0));
		} else {
			setPrices(
				api
					.rows()
					.getAll()
					.slice(0, 18)
					.map((row: any) => parseFloat(String(row.price)) || 0)
			);
		}
		setCompanyCount(rowIds.length);
	}, [api]);

	const updateStatsAndChart = useCallback(() => {
		if (!api) return;
		const state = api.getStateSnapshot();
		const range = state.selection.range;
		if (range) {
			selectedRowIdsRef.current = api.rows().inRange(range).getIds();
			const startColIdx = state.columns.findIndex((c) => c.field === range.start.colField);
			const endColIdx = state.columns.findIndex((c) => c.field === range.end.colField);
			selectedColsRef.current =
				startColIdx !== -1 && endColIdx !== -1
					? state.columns.slice(Math.min(startColIdx, endColIdx), Math.max(startColIdx, endColIdx) + 1).map((c) => c.field)
					: [];
		} else {
			selectedRowIdsRef.current = [];
			selectedColsRef.current = [];
		}
		refreshStats();
	}, [api, refreshStats]);

	useEffect(() => {
		if (!api) return;
		updateStatsAndChart();
		const log = (msg: string, type = 'info') =>
			setEventLogs((prev) => [{ id: ++eventLogIdRef.current, time: new Date().toLocaleTimeString(), msg, type }, ...prev].slice(0, 10));
		const unsubSelection = api.subscribeToKey('selection', updateStatsAndChart);
		const unsubRows = api.addEventListener(GridEventName.rowsUpdated, () => {
			log('rowsUpdated');
			refreshStats();
		});
		const unsubValue = api.addEventListener(GridEventName.cellValueChanged, () => {
			log('cellValueChanged');
			refreshStats();
		});
		return () => {
			unsubSelection();
			unsubRows();
			unsubValue();
		};
	}, [api, updateStatsAndChart, refreshStats]);

	const triggerVolatility = useCallback(() => {
		if (!api) return;
		api.updateRows((rows) =>
			rows.map((row) => {
				const priceNum = parseFloat(String(row.price)) || 100;
				const volatility = (Math.random() - 0.5) * 8;
				const nextPrice = Math.max(1, priceNum * (1 + volatility / 100));
				const priceDiff = nextPrice - priceNum;
				const changeNum = parseFloat(String(row.change)) || 0;
				const nextChange = changeNum + (priceDiff / priceNum) * 100;
				const volumeNum = parseFloat(String(row.volume)) || 0;
				const nextVolume = Math.max(0.1, volumeNum * (1 + (Math.random() - 0.5) * 0.3));
				return {
					...row,
					price: nextPrice.toFixed(2),
					change: `${nextChange >= 0 ? '+' : ''}${nextChange.toFixed(1)}`,
					volume: nextVolume.toFixed(1),
				};
			})
		);
	}, [api]);

	const toggleAutoFire = useCallback(() => {
		if (!api) return;
		setAutoFire((current) => !current);
	}, [api]);

	useEffect(() => {
		if (autoIntervalRef.current) {
			clearInterval(autoIntervalRef.current);
			autoIntervalRef.current = null;
		}
		if (!autoFire) return;
		autoIntervalRef.current = setInterval(triggerVolatility, autoFireIntervalMs);
		return () => {
			if (autoIntervalRef.current) {
				clearInterval(autoIntervalRef.current);
				autoIntervalRef.current = null;
			}
		};
	}, [autoFire, autoFireIntervalMs, triggerVolatility]);

	useEffect(
		() => () => {
			if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
		},
		[]
	);

	const handleRunQuality = useCallback(async () => {
		if (!api) return;
		const result = await api.integrity.run({ modules: ['quality'] });
		const issues = result.issues.filter((i) => i.source === 'dataQuality') as GridIntegrityIssue[];
		setQualityIssues(issues);
	}, [api]);

	const handleClearQuality = useCallback(() => {
		if (!api) return;
		api.integrity.clearIssues({ source: 'dataQuality' });
		setQualityIssues(null);
	}, [api]);

	const handleActivateDiff = useCallback(() => {
		if (!api) return;
		const currentRows = api.rows().getAll() as DashboardStockRow[];
		api.integrity.setDiffModel({
			base: { rows, getRowId: (r: DashboardStockRow) => r.id },
			compare: { rows: currentRows, getRowId: (r: DashboardStockRow) => r.id },
		});
		setDiffActive(true);
	}, [api, rows]);

	const handleClearDiff = useCallback(() => {
		if (!api) return;
		api.integrity.clearDiff();
		setDiffActive(false);
	}, [api]);

	const handleStartStream = useCallback(() => {
		if (!api || streamRef.current) return;
		const stream = api.integrity.createStream({
			batchMs: 400,
			flashChanges: true,
			coalesceBy: 'cell',
			dirtyCellPolicy: 'markConflict',
		});
		streamRef.current = stream;
		setStreamRunning(true);

		let tick = 0;
		function pushTick() {
			if (!streamRef.current) return;
			const allRows = rows;
			const n = 3 + (tick % 5);
			const updates = Array.from({ length: n }, (_, j) => {
				const row = allRows[Math.abs(Math.floor(Math.sin((tick * 7 + j) * 1.3) * allRows.length)) % allRows.length];
				const newPrice = parseFloat((parseFloat(row.price) * (0.98 + (tick % 3) * 0.01)).toFixed(2));
				tick++;
				return { rowId: row.id, colField: 'price', value: newPrice };
			});
			stream.push({ cells: updates });
			streamTickRef.current = setTimeout(pushTick, 600 + (tick % 5) * 80);
		}
		pushTick();
	}, [api, rows]);

	const handleStopStream = useCallback(() => {
		if (streamTickRef.current) clearTimeout(streamTickRef.current);
		streamTickRef.current = null;
		streamRef.current?.destroy();
		streamRef.current = null;
		setStreamRunning(false);
	}, []);

	const handleInjectConflicts = useCallback(() => {
		if (!api) return;
		const now = Date.now();
		api.integrity.publishIssues('conflict', [
			{
				id: 'ci-AAPL-price',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'AAPL',
				colField: 'price',
				message: 'Conflict: local 173.50 vs remote 168.20',
				createdAt: now,
			},
			{
				id: 'ci-MSFT-volume',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'MSFT',
				colField: 'volume',
				message: 'Conflict: local 42.5 vs remote 38.1',
				createdAt: now,
			},
			{
				id: 'ci-NVDA-change',
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: 'NVDA',
				colField: 'change',
				message: 'Conflict: local +3.4 vs remote -1.2',
				createdAt: now,
			},
		]);
		setConflictCount(3);
	}, [api]);

	const handleClearConflicts = useCallback(() => {
		if (!api) return;
		api.integrity.clearIssues({ source: 'conflict' });
		setConflictCount(0);
	}, [api]);

	useEffect(
		() => () => {
			if (streamTickRef.current) clearTimeout(streamTickRef.current);
			streamRef.current?.destroy();
		},
		[]
	);

	const contextMenuOptions = useMemo<GridContextMenuOptions<DashboardStockRow>>(
		() => ({
			customItems: [
				{ isDivider: true },
				{
					id: 'chart',
					icon: '📊',
					label: 'Show Chart',
					action: ({ api }) => api.openChart(),
					disabled: (params: any) => !params.selection.bounds,
				},
			],
		}),
		[]
	);

	const svgPoints = useMemo(() => {
		if (prices.length < 2) return '';
		const max = Math.max(...prices, 1);
		const min = Math.min(...prices, 0);
		const span = max - min || 1;
		return prices.map((value, index) => `${(index / (prices.length - 1)) * 100},${40 - ((value - min) / span) * 30}`).join(' ');
	}, [prices]);
	const autoFireHzLabel = useMemo(() => (1000 / Math.max(1, autoFireIntervalMs)).toFixed(autoFireIntervalMs >= 100 ? 1 : 2), [autoFireIntervalMs]);

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex items-center justify-between gap-4 shrink-0'>
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-emerald-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<TrendingUp className='w-4 h-4 text-emerald-400' />
							Realtime Portfolio Dashboard
						</span>
					</div>
					<div className='flex items-center gap-2'>
						<label className='flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-[10px] font-bold text-slate-400'>
							<span className='uppercase tracking-wider'>Interval</span>
							<input
								type='number'
								min={25}
								step={25}
								value={autoFireIntervalMs}
								onChange={(event) => setAutoFireIntervalMs(Math.max(25, Number(event.target.value) || 25))}
								className='w-16 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-right text-[10px] font-mono text-slate-200 outline-none focus:border-emerald-500'
							/>
							<span className='font-mono text-slate-500'>ms</span>
						</label>
						<button
							onClick={toggleAutoFire}
							className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg font-bold text-[10px] border shadow-lg transition-all cursor-pointer ${
								autoFire
									? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-500/20 shadow-rose-900/20'
									: 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700/60'
							}`}
						>
							<Zap className={`w-3 h-3 ${autoFire ? 'animate-pulse' : ''}`} />
							{autoFire ? `Auto ${autoFireHzLabel}hz ON` : `Auto ${autoFireHzLabel}hz`}
						</button>
					</div>
				</div>

				<div className='flex-1 min-h-0 min-w-0'>
					<Grid
						rowModelType='client'
						rows={rows}
						columns={columns}
						styleRules={styleRules}
						enableContextMenu
						contextMenuOptions={contextMenuOptions}
						enableChart
						pinLeftColumns={2}
						enableNavigation
						navigationOptions={{ editTrigger, arrowKeyNavigationEdit }}
						onCellValueChanged={onCellValueChanged}
						dataIntegrity={{
							validation: {
								enabled: true,
								validateOnEdit: true,
								cellRules: [
									{
										id: 'price-positive',
										field: 'price',
										severity: 'error',
										blocking: true,
										validate({ value }) {
											const n = parseFloat(String(value));
											if (isNaN(n) || n <= 0) return { message: 'Price must be a positive number' };
											return null;
										},
									},
									{
										id: 'volume-non-negative',
										field: 'volume',
										severity: 'warning',
										blocking: false,
										validate({ value }) {
											const n = parseFloat(String(value));
											if (isNaN(n) || n < 0) return { message: 'Volume cannot be negative' };
											return null;
										},
									},
								],
							},
							quality: {
								enabled: true,
								rules: [
									duplicateValueRule<DashboardStockRow>('symbol'),
									{
										id: 'high-risk-price',
										label: 'High-Risk Price Threshold',
										run(context) {
											return context.rows
												.filter((ref) => {
													const row = ref.row as DashboardStockRow;
													return row.risk === 'high' && parseFloat(String(row.price)) < 100;
												})
												.map((ref) => ({
													id: `high-risk-${ref.rowId}`,
													source: 'dataQuality' as const,
													type: 'custom' as const,
													severity: 'warning' as const,
													blocking: false,
													rowId: ref.rowId,
													colField: 'price',
													message: 'High-risk stock priced below $100 — verify position',
													createdAt: Date.now(),
												}));
										},
									},
								],
							},
							diff: true,
							liveStream: {
								enabled: true,
								dirtyCellPolicy: 'markConflict',
								flashChanges: true,
							},
							conflicts: true,
						}}
						sidebar={{
							panels: ['dataIntegrity'],
							position: 'right',
						}}
						onGridReady={(event) => {
							setApi(event.api);
							onGridReady?.(event);
						}}
					/>
				</div>
			</div>

			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5'>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<ShieldCheck className='w-4 h-4 text-indigo-400' />
						Data Integrity Pipeline
					</h3>

					<div className='flex flex-col gap-1.5'>
						<div className='text-[9px] font-bold uppercase tracking-widest text-slate-600'>Quality</div>
						<div className='flex gap-2 flex-wrap'>
							<button
								onClick={handleRunQuality}
								className='flex-1 py-1.5 px-2 rounded-lg border border-indigo-700/50 bg-indigo-950/40 text-indigo-300 text-[10px] font-bold hover:bg-indigo-900/40 transition-colors cursor-pointer'
							>
								Run Quality Check
							</button>
							{qualityIssues !== null && (
								<button
									onClick={handleClearQuality}
									className='py-1.5 px-2 rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-400 text-[10px] font-bold hover:bg-slate-700/40 transition-colors cursor-pointer'
								>
									Clear
								</button>
							)}
						</div>
						{qualityIssues !== null && (
							<div className='text-[10px] text-slate-400'>
								{qualityIssues.length} issues —{' '}
								<span className='text-red-400'>{qualityIssues.filter((i) => i.severity === 'error').length} errors</span>{' '}
								<span className='text-amber-400'>{qualityIssues.filter((i) => i.severity === 'warning').length} warnings</span>
							</div>
						)}
					</div>

					<div className='flex flex-col gap-1.5'>
						<div className='text-[9px] font-bold uppercase tracking-widest text-slate-600'>Diff vs EOD Snapshot</div>
						<div className='flex gap-2'>
							{!diffActive ? (
								<button
									onClick={handleActivateDiff}
									className='flex-1 py-1.5 px-2 rounded-lg border border-amber-700/50 bg-amber-950/40 text-amber-300 text-[10px] font-bold hover:bg-amber-900/40 transition-colors cursor-pointer'
								>
									Activate Diff
								</button>
							) : (
								<button
									onClick={handleClearDiff}
									className='flex-1 py-1.5 px-2 rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-400 text-[10px] font-bold hover:bg-slate-700/40 transition-colors cursor-pointer'
								>
									Clear Diff
								</button>
							)}
						</div>
						{diffActive && <div className='text-[10px] text-amber-400/80'>Diff active — changed cells highlighted</div>}
					</div>

					<div className='flex flex-col gap-1.5'>
						<div className='text-[9px] font-bold uppercase tracking-widest text-slate-600'>Live Stream (Integrity)</div>
						<div className='flex gap-2'>
							{!streamRunning ? (
								<button
									onClick={handleStartStream}
									className='flex-1 py-1.5 px-2 rounded-lg border border-emerald-700/50 bg-emerald-950/40 text-emerald-300 text-[10px] font-bold hover:bg-emerald-900/40 transition-colors cursor-pointer'
								>
									Start Feed
								</button>
							) : (
								<button
									onClick={handleStopStream}
									className='flex-1 py-1.5 px-2 rounded-lg border border-rose-700/50 bg-rose-950/40 text-rose-300 text-[10px] font-bold hover:bg-rose-900/40 transition-colors cursor-pointer'
								>
									Stop Feed
								</button>
							)}
						</div>
						{streamRunning && (
							<div className='text-[10px] text-emerald-400/80 flex items-center gap-1'>
								<span className='w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block' />
								Streaming — edit a cell to trigger a conflict
							</div>
						)}
					</div>

					<div className='flex flex-col gap-1.5'>
						<div className='text-[9px] font-bold uppercase tracking-widest text-slate-600'>Conflicts</div>
						<div className='flex gap-2'>
							<button
								onClick={handleInjectConflicts}
								disabled={conflictCount > 0}
								className='flex-1 py-1.5 px-2 rounded-lg border border-purple-700/50 bg-purple-950/40 text-purple-300 text-[10px] font-bold hover:bg-purple-900/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
							>
								Inject 3 Conflicts
							</button>
							{conflictCount > 0 && (
								<button
									onClick={handleClearConflicts}
									className='py-1.5 px-2 rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-400 text-[10px] font-bold hover:bg-slate-700/40 transition-colors cursor-pointer'
								>
									Clear
								</button>
							)}
						</div>
						{conflictCount > 0 && (
							<div className='text-[10px] text-red-400'>{conflictCount} unresolved — open Conflicts panel to resolve</div>
						)}
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<BarChart3 className='w-4 h-4 text-emerald-400' />
						Selection Analytics
						{companyCount > 0 && (
							<span className='ml-auto text-[9px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 px-1.5 py-0.5 rounded'>
								{companyCount} {companyCount === 1 ? 'co.' : 'cos.'}
							</span>
						)}
					</h3>
					<div className='grid grid-cols-2 gap-2'>
						{[
							['Count', stats.count],
							['Sum', stats.sum.toFixed(2)],
							['Avg', stats.avg.toFixed(2)],
							['Max', stats.max.toFixed(2)],
						].map(([label, value]) => (
							<div key={label} className='bg-slate-950/60 border border-slate-900 rounded-lg p-2.5'>
								<div className='text-[8px] text-slate-500 uppercase font-extrabold'>{label}</div>
								<div className='font-mono text-xs font-bold text-slate-200'>{value}</div>
							</div>
						))}
					</div>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Activity className='w-4 h-4 text-cyan-400' />
						Live Price Sparkline
						<span className='ml-auto text-[9px] text-slate-500'>{companyCount > 0 ? 'selection' : 'all rows'}</span>
					</h3>
					<svg className='h-20 w-full rounded-lg border border-slate-900 bg-slate-950/80' viewBox='0 0 100 40' preserveAspectRatio='none'>
						<polyline fill='none' stroke='#10b981' strokeWidth='1.5' points={svgPoints} />
					</svg>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-2'>
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<RefreshCw className='w-4 h-4 text-purple-400' />
						Realtime Event Logger
					</h3>
					{eventLogs.length === 0 ? (
						<div className='text-[10px] text-slate-500'>No events yet.</div>
					) : (
						eventLogs.map((log) => (
							<div key={log.id} className='font-mono text-[10px] text-slate-400'>
								{log.time} · {log.msg}
							</div>
						))
					)}
					<div className='mt-2 flex items-center gap-1.5 text-[10px] text-slate-500'>
						<Code2 className='w-3.5 h-3.5' />
						Data and controls stay client-side.
					</div>
				</div>
			</div>
		</div>
	);
}
