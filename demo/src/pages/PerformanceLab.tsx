import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Gauge, Play } from 'lucide-react';
import {
	Grid,
	type ColumnDef,
	type DomCellRenderer,
	type ImperativeCellHandle,
	type CellRendererProps,
	type GridReadyEvent,
} from '@eregister/open-grid-react';

type RendererMode = 'text' | 'dom' | 'imperativeReact' | 'deferredReact';

interface LabRow {
	id: string;
	name: string;
	price: string;
	status: string;
	[key: string]: string;
}

const statusDomRenderer: DomCellRenderer<LabRow> = {
	mount(container, params) {
		const badge = document.createElement('span');
		badge.style.cssText =
			'display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:4px;font:800 11px ui-monospace,monospace;text-transform:uppercase;';
		container.appendChild(badge);
		const paint = (value: unknown) => {
			const text = String(value ?? '');
			badge.textContent = text;
			const active = text === 'Active';
			badge.style.color = active ? '#34d399' : text === 'Pending' ? '#fbbf24' : '#94a3b8';
			badge.style.background = active ? 'rgba(16,185,129,.12)' : text === 'Pending' ? 'rgba(245,158,11,.12)' : 'rgba(148,163,184,.10)';
			badge.style.border = active
				? '1px solid rgba(16,185,129,.35)'
				: text === 'Pending'
					? '1px solid rgba(245,158,11,.35)'
					: '1px solid rgba(148,163,184,.25)';
		};
		paint(params.value);
		return {
			update(next) {
				paint(next.value);
			},
			destroy() {
				container.textContent = '';
			},
		};
	},
};

const DeferredStatus = React.memo(function DeferredStatus({ value }: CellRendererProps<LabRow>) {
	return <span className='font-mono text-xs font-extrabold text-cyan-300'>{String(value)}</span>;
});

const ImperativeStatus = React.forwardRef<ImperativeCellHandle<LabRow>, CellRendererProps<LabRow>>(function ImperativeStatus({ value }, ref) {
	const spanRef = useRef<HTMLSpanElement>(null);
	React.useImperativeHandle(ref, () => ({
		update(params) {
			if (spanRef.current) spanRef.current.textContent = String(params.value ?? '');
		},
	}));
	return (
		<span ref={spanRef} className='font-mono text-xs font-extrabold text-emerald-300'>
			{String(value)}
		</span>
	);
});

// ─── Extra custom renderers for renderer stress-testing ──────────────────────

/** DOM renderer: renders a compact progress/heat bar for numeric metric values */
const metricBarDomRenderer: DomCellRenderer<LabRow> = {
	mount(container, params) {
		const wrap = document.createElement('div');
		wrap.style.cssText = 'display:flex;align-items:center;width:100%;gap:4px;padding:0 4px;box-sizing:border-box;';
		const bar = document.createElement('div');
		bar.style.cssText = 'flex:1;height:6px;border-radius:3px;overflow:hidden;background:rgba(100,116,139,0.2);position:relative;';
		const fill = document.createElement('div');
		fill.style.cssText = 'position:absolute;left:0;top:0;height:100%;border-radius:3px;transition:width 0.15s,background 0.15s;';
		bar.appendChild(fill);
		const label = document.createElement('span');
		label.style.cssText = 'font:700 9px ui-monospace,monospace;color:#94a3b8;min-width:32px;text-align:right;flex-shrink:0;';
		wrap.appendChild(bar);
		wrap.appendChild(label);
		container.appendChild(wrap);
		const paint = (value: unknown) => {
			const n = Math.min(10000, Math.max(0, Number(value) || 0));
			const pct = (n / 10000) * 100;
			fill.style.width = `${pct}%`;
			fill.style.background = pct > 66 ? 'rgba(52,211,153,0.85)' : pct > 33 ? 'rgba(251,191,36,0.85)' : 'rgba(239,68,68,0.80)';
			label.textContent = n.toString();
		};
		paint(params.value);
		return {
			update(next) {
				paint(next.value);
			},
			destroy() {
				container.textContent = '';
			},
		};
	},
};

/** Imperative React renderer: a tiny sparkline-like number cell that updates in-place */
const ImperativeMetric = React.forwardRef<ImperativeCellHandle<LabRow>, CellRendererProps<LabRow>>(function ImperativeMetric({ value }, ref) {
	const valRef = useRef<HTMLSpanElement>(null);
	const barRef = useRef<HTMLDivElement>(null);
	const paint = (v: unknown) => {
		const n = Math.min(10000, Math.max(0, Number(v) || 0));
		if (valRef.current) valRef.current.textContent = n.toString();
		if (barRef.current) {
			const pct = (n / 10000) * 100;
			barRef.current.style.width = `${pct}%`;
			barRef.current.style.background = pct > 66 ? '#34d399' : pct > 33 ? '#fbbf24' : '#f87171';
		}
	};
	React.useImperativeHandle(ref, () => ({
		update(p) {
			paint(p.value);
		},
	}));
	return (
		<div className='flex items-center w-full gap-1 px-1'>
			<div className='flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden relative'>
				<div ref={barRef} className='absolute left-0 top-0 h-full rounded-full' style={{ width: '50%', background: '#34d399' }} />
			</div>
			<span ref={valRef} className='font-mono text-[9px] font-bold text-slate-400 w-8 text-right shrink-0'>
				{String(value)}
			</span>
		</div>
	);
});

/** Deferred React renderer: a badge-style number with colour coding */
const DeferredMetric = React.memo(function DeferredMetric({ value }: CellRendererProps<LabRow>) {
	const n = Math.min(10000, Math.max(0, Number(value) || 0));
	const pct = (n / 10000) * 100;
	const color = pct > 66 ? 'text-emerald-400' : pct > 33 ? 'text-amber-400' : 'text-rose-400';
	return <span className={`font-mono text-[10px] font-extrabold ${color}`}>{n}</span>;
});

function makeRows(count: number): LabRow[] {
	const statuses = ['Active', 'Pending', 'Inactive'];
	return Array.from({ length: count }, (_, rowIndex) => {
		const row: LabRow = {
			id: `LAB-${rowIndex}`,
			name: `Instrument ${rowIndex}`,
			price: (100 + (rowIndex % 900)).toString(),
			status: statuses[rowIndex % statuses.length],
		};
		// Populate 200 metric columns — enough to have real values throughout
		// the Glide scroll path without allocating 100k × 996 strings.
		for (let col = 0; col < 200; col++) {
			row[`m_${col}`] = `${(rowIndex * 17 + col * 31) % 10000}`;
		}
		return row;
	});
}

function makeColumns(mode: RendererMode): ColumnDef<LabRow>[] {
	const statusColumn: ColumnDef<LabRow> =
		mode === 'dom'
			? { field: 'status', header: 'Status DOM', width: 120, renderer: { kind: 'dom', renderer: statusDomRenderer } }
			: mode === 'imperativeReact'
				? { field: 'status', header: 'Status Imperative', width: 150, renderer: { kind: 'imperativeReact', component: ImperativeStatus } }
				: mode === 'deferredReact'
					? { field: 'status', header: 'Status Deferred', width: 140, renderer: { kind: 'react', component: DeferredStatus } }
					: { field: 'status', header: 'Status Text', width: 120, renderer: { kind: 'text' } };

	// Spread multiple renderer flavours across the 996 metric columns to put real
	// pressure on the portal/DOM renderer paths during Glide.
	//   index % 40 === 0  → DOM bar renderer   (~25 columns)
	//   index % 40 === 20 → Imperative React    (~25 columns)
	//   index % 40 === 10 → Deferred React      (~25 columns)  [only in deferredReact mode for extra load]
	//   rest               → plain text
	const metricColumns: ColumnDef<LabRow>[] = Array.from({ length: 996 }, (_, index) => {
		const base = { field: `m_${index}`, header: `Metric ${index}`, width: 96 + (index % 5) * 12 } as const;
		if (index % 40 === 0) {
			return { ...base, renderer: { kind: 'dom' as const, renderer: metricBarDomRenderer } };
		}
		if (index % 40 === 20) {
			return { ...base, renderer: { kind: 'imperativeReact' as const, component: ImperativeMetric } };
		}
		if (mode === 'deferredReact' && index % 40 === 10) {
			return { ...base, renderer: { kind: 'react' as const, component: DeferredMetric } };
		}
		return { ...base, renderer: { kind: 'text' as const } };
	});

	return [
		{ field: 'id', header: 'ID', width: 130 },
		{ field: 'name', header: 'Name', width: 160 },
		{ field: 'price', header: 'Price', width: 100 },
		statusColumn,
		...metricColumns,
	];
}

const PAGE_SIZE = 5000;

interface PerformanceLabProps {
	onGridReady?: (event: GridReadyEvent<LabRow>) => void;
}

export default function PerformanceLab({ onGridReady }: PerformanceLabProps) {
	const [mode, setMode] = useState<RendererMode>('dom');
	const allRows = useMemo(() => makeRows(100000), []);
	const columns = useMemo(() => makeColumns(mode), [mode]);

	const hostRef = useRef<HTMLDivElement>(null);

	const runGlide = useCallback(() => {
		const scroller = hostRef.current?.querySelector<HTMLDivElement>('.og-scroll-viewport');
		if (!scroller) return;
		let frame = 0;
		const maxFrames = 90;
		const tick = () => {
			frame++;
			scroller.scrollTop = (frame * 280) % 3200000;
			scroller.scrollLeft = (frame * 190) % 80000;
			scroller.dispatchEvent(new Event('scroll'));
			if (frame < maxFrames) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, []);

	return (
		<div className='flex h-full w-full flex-col gap-4 overflow-hidden'>
			<div className='flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/30 p-3 shrink-0'>
				<div className='flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-300'>
					<Gauge className='h-4 w-4 text-emerald-400' />
					Performance Lab
				</div>
				<div className='flex items-center gap-2'>
					{(['text', 'dom', 'imperativeReact', 'deferredReact'] as RendererMode[]).map((nextMode) => (
						<button
							key={nextMode}
							onClick={() => setMode(nextMode)}
							className={`rounded-md border px-2.5 py-1 text-[10px] font-extrabold uppercase ${
								mode === nextMode ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200' : 'border-slate-800 text-slate-400'
							}`}
						>
							{nextMode}
						</button>
					))}
					<button
						onClick={runGlide}
						className='inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1 text-xs font-black text-slate-950'
					>
						<Play className='h-3.5 w-3.5' />
						Glide
					</button>
				</div>
			</div>

			<div ref={hostRef} className='min-h-0 flex-1'>
				<Grid
					rowModelType='client'
					rows={allRows}
					columns={columns}
					pagination={{ pageSize: PAGE_SIZE }}
					rowOverscanPx={100}
					colBuffer={1}
					runtimeLimits={{ maxRenderedRows: 36, maxRenderedCells: 900 }}
					getRowId={(row) => row.id}
					pinLeftColumns={2}
					pinRightColumns={1}
					enableContextMenu={false}
					onGridReady={onGridReady}
				/>
			</div>
		</div>
	);
}
