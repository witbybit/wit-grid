/** Panels around the grid: KPI strip, sector heatmap, live P&L chart and the telemetry readout. */
import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, X } from 'lucide-react';
import type { DeskSnapshot, FeedEngine, SectorTile } from './feed';
import { fmtMs, fmtPct, fmtSignedUsd, fmtUsd } from './format';

export function useDeskSnapshot(engine: FeedEngine): DeskSnapshot {
	const [snap, setSnap] = useState(engine.snapshot);
	useEffect(() => {
		setSnap(engine.snapshot);
		return engine.subscribe(setSnap);
	}, [engine]);
	return snap;
}

export interface Tone {
	isLight: boolean;
}

const card = (isLight: boolean) => (isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-900/40');
const labelCls = (isLight: boolean) => `text-[9px] font-extrabold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-slate-500'}`;
const up = (isLight: boolean) => (isLight ? 'text-emerald-700' : 'text-emerald-400');
const down = (isLight: boolean) => (isLight ? 'text-rose-700' : 'text-rose-400');
const signTone = (v: number, isLight: boolean) => (v > 0 ? up(isLight) : v < 0 ? down(isLight) : '');

// ─── KPI strip ────────────────────────────────────────────────────────────────

function Kpi({ label, isLight, children, sub }: { label: string; isLight: boolean; children: React.ReactNode; sub?: React.ReactNode }) {
	return (
		<div className={`min-w-0 flex-1 rounded-lg border px-3 py-1.5 ${card(isLight)}`}>
			<div className={labelCls(isLight)}>{label}</div>
			<div className={`font-mono text-sm font-bold leading-tight ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>{children}</div>
			{sub && <div className={`font-mono text-[10px] ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>{sub}</div>}
		</div>
	);
}

export function KpiStrip({ engine, isLight, compact }: { engine: FeedEngine; isLight: boolean; compact?: boolean }) {
	const s = useDeskSnapshot(engine);
	const total = s.advancers + s.decliners || 1;
	const advPct = (s.advancers / total) * 100;
	const session = s.totalPnl - s.basePnl;
	return (
		<div className='flex shrink-0 gap-2 overflow-x-auto'>
			<Kpi label='Gross notional' isLight={isLight}>
				{fmtUsd(s.grossNotional)}
			</Kpi>
			<Kpi
				label='Unrealized P&L'
				isLight={isLight}
				sub={
					<span className={signTone(session, isLight)}>
						{fmtSignedUsd(session)} <span className='text-slate-500'>session</span>
					</span>
				}
			>
				<span className={signTone(s.totalPnl, isLight)}>{fmtSignedUsd(s.totalPnl)}</span>
			</Kpi>
			<Kpi
				label='Advancers / decliners'
				isLight={isLight}
				sub={
					<span className={`mt-1 block h-1 w-full overflow-hidden rounded-full ${isLight ? 'bg-rose-200' : 'bg-rose-500/40'}`}>
						<span
							className={`block h-full w-full origin-left transition-transform duration-500 ease-out ${isLight ? 'bg-emerald-600' : 'bg-emerald-400'}`}
							style={{ transform: `scaleX(${advPct / 100})` }}
						/>
					</span>
				}
			>
				<span className={up(isLight)}>{s.advancers.toLocaleString('en-US')}</span> <span className='text-slate-500'>/</span>{' '}
				<span className={down(isLight)}>{s.decliners.toLocaleString('en-US')}</span>
			</Kpi>
			<Kpi label='Updates / s' isLight={isLight} sub={compact ? undefined : `${s.telemetry.rowsPerFrame.toLocaleString('en-US')} rows / frame`}>
				{s.paused ? 'paused' : s.telemetry.updatesPerSec.toLocaleString('en-US')}
			</Kpi>
		</div>
	);
}

// ─── Sector heatmap ───────────────────────────────────────────────────────────

const HEAT_FULL_PCT = 1.2;

function tileColor(avg: number, isLight: boolean): string {
	const a = Math.min(1, Math.abs(avg) / HEAT_FULL_PCT);
	const alpha = (isLight ? 0.1 : 0.14) + a * (isLight ? 0.5 : 0.55);
	const rgb = avg >= 0 ? (isLight ? '15,157,88' : '16,185,129') : isLight ? '192,57,43' : '239,68,68';
	return `rgba(${rgb},${alpha.toFixed(3)})`;
}

export function SectorHeatmap({
	engine,
	isLight,
	selected,
	onSelect,
}: {
	engine: FeedEngine;
	isLight: boolean;
	selected: string | null;
	onSelect: (sector: string | null) => void;
}) {
	const { tiles } = useDeskSnapshot(engine);
	const sorted = useMemo(() => [...tiles].sort((a, b) => b.notional - a.notional), [tiles]);
	return (
		<div className={`flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border p-2 ${card(isLight)}`}>
			<div className='flex items-center justify-between'>
				<span className={labelCls(isLight)}>Sector heatmap · avg change</span>
				{selected && (
					<button
						type='button'
						onClick={() => onSelect(null)}
						className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
							isLight ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-indigo-700/60 bg-indigo-950/40 text-indigo-300'
						}`}
					>
						{selected}
						<X className='h-3 w-3' />
					</button>
				)}
			</div>
			<div
				className='grid min-h-0 flex-1 gap-1'
				style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gridAutoRows: 'minmax(34px, 1fr)' }}
			>
				{sorted.map((t: SectorTile) => (
					<button
						key={t.key}
						type='button'
						title={`${t.assetClass} · ${t.sector} · ${t.count.toLocaleString('en-US')} instruments · ${fmtUsd(t.notional)}`}
						onClick={() => onSelect(selected === t.sector ? null : t.sector)}
						className={`flex min-w-0 flex-col items-start justify-center rounded-md px-1.5 py-0.5 text-left transition-colors ${
							selected === t.sector ? (isLight ? 'ring-2 ring-indigo-500' : 'ring-2 ring-indigo-400') : ''
						}`}
						style={{ background: tileColor(t.avgPct, isLight) }}
					>
						<span className={`w-full truncate text-[10px] font-bold leading-tight ${isLight ? 'text-slate-800' : 'text-slate-100'}`}>
							{t.sector}
						</span>
						<span className={`font-mono text-[10px] font-bold leading-tight ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>
							{fmtPct(t.avgPct)}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

// ─── Live P&L chart ───────────────────────────────────────────────────────────

export function PnlChart({ engine, isLight }: { engine: FeedEngine; isLight: boolean }) {
	const { pnlSeries, totalPnl } = useDeskSnapshot(engine);
	const W = 300;
	const H = 84;
	const { line, area, zeroY, lastX, lastY } = useMemo(() => {
		const n = pnlSeries.length;
		let lo = Math.min(...pnlSeries, 0);
		let hi = Math.max(...pnlSeries, 0);
		if (hi - lo < 1) {
			hi += 1;
			lo -= 1;
		}
		const pad = (hi - lo) * 0.12;
		lo -= pad;
		hi += pad;
		const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
		const pts = pnlSeries.map((v, i) => `${((i / Math.max(1, n - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`);
		return {
			line: pts.join(' '),
			area: `0,${H} ${pts.join(' ')} ${W},${H}`,
			zeroY: y(0),
			lastX: W,
			lastY: y(pnlSeries[n - 1] ?? 0),
		};
	}, [pnlSeries]);
	const positive = totalPnl >= 0;
	const stroke = positive ? (isLight ? '#0f9d58' : '#34d399') : isLight ? '#c0392b' : '#f87171';
	return (
		<div className={`flex w-full shrink-0 flex-col gap-1 rounded-lg border p-2 lg:w-72 ${card(isLight)}`}>
			<div className='flex items-baseline justify-between'>
				<span className={labelCls(isLight)}>Live P&L · last 2 min</span>
				<span className={`font-mono text-[11px] font-bold ${signTone(totalPnl, isLight)}`}>{fmtSignedUsd(totalPnl)}</span>
			</div>
			<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='none' className='h-full min-h-[56px] w-full'>
				<line
					x1='0'
					x2={W}
					y1={zeroY}
					y2={zeroY}
					stroke={isLight ? '#94a3b8' : '#475569'}
					strokeDasharray='3 3'
					strokeWidth='1'
					vectorEffect='non-scaling-stroke'
				/>
				<polygon points={area} fill={stroke} opacity='0.12' />
				<polyline points={line} fill='none' stroke={stroke} strokeWidth='1.6' strokeLinejoin='round' vectorEffect='non-scaling-stroke' />
				<circle cx={lastX} cy={lastY} r='2.5' fill={stroke} />
			</svg>
		</div>
	);
}

// ─── Telemetry ────────────────────────────────────────────────────────────────

function Stat({ label, value, unit, isLight, warn }: { label: string; value: string; unit?: string; isLight: boolean; warn?: boolean }) {
	return (
		<div className={`rounded-md border px-2 py-1 ${isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950/50'}`}>
			<div className='text-[8px] font-extrabold uppercase tracking-wider text-slate-500'>{label}</div>
			<div
				className={`font-mono text-[12px] font-bold ${warn ? (isLight ? 'text-amber-700' : 'text-amber-400') : isLight ? 'text-slate-900' : 'text-slate-100'}`}
			>
				{value}
				{unit && <span className='ml-0.5 text-[9px] font-medium text-slate-500'>{unit}</span>}
			</div>
		</div>
	);
}

export function TelemetryPanel({ engine, isLight }: { engine: FeedEngine; isLight: boolean }) {
	const { telemetry: t } = useDeskSnapshot(engine);
	const pair = (a: number, b: number) => `${fmtMs(a)} / ${fmtMs(b)}`;
	return (
		<div className={`flex w-full shrink-0 flex-col gap-1.5 rounded-lg border p-2 lg:w-[19rem] ${card(isLight)}`}>
			<div className='flex items-center justify-between'>
				<span className={`flex items-center gap-1 ${labelCls(isLight)}`}>
					<Gauge className='h-3 w-3' />
					Grid telemetry · 5 s window
				</span>
				<span className='font-mono text-[9px] text-slate-500'>{t.fps.toFixed(0)} fps</span>
			</div>
			<div className='grid grid-cols-3 gap-1'>
				<Stat label='Applied upd/s' value={t.updatesPerSec.toLocaleString('en-US')} isLight={isLight} />
				<Stat label='Rows / frame' value={t.rowsPerFrame.toLocaleString('en-US')} isLight={isLight} />
				<Stat label='Txn max' value={fmtMs(t.txnMs.max)} unit='ms' isLight={isLight} warn={t.txnMs.max > 16} />
				<Stat label='Txn p50 / p95' value={pair(t.txnMs.p50, t.txnMs.p95)} unit='ms' isLight={isLight} warn={t.txnMs.p95 > 8} />
				<Stat label='Frame p50 / p95' value={pair(t.frameMs.p50, t.frameMs.p95)} unit='ms' isLight={isLight} warn={t.frameMs.p95 > 20} />
				<Stat label='Dropped >20ms' value={`${t.droppedFrames} · ${t.droppedFramesTotal}`} isLight={isLight} warn={t.droppedFrames > 0} />
			</div>
			<div className='flex items-center justify-between font-mono text-[9px] text-slate-500'>
				<span>long tasks {t.longTasksSupported ? `${t.longTasks} · ${t.longTasksTotal}` : 'n/a'}</span>
				<span>window · total</span>
			</div>
		</div>
	);
}

/** One-line telemetry for the compact (landing page) layout. */
export function TelemetryBadge({ engine, isLight }: { engine: FeedEngine; isLight: boolean }) {
	const { telemetry: t, paused } = useDeskSnapshot(engine);
	return (
		<span
			className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold ${
				isLight ? 'border-slate-200 bg-white text-slate-600' : 'border-slate-800 bg-slate-950/60 text-slate-400'
			}`}
			title='Live grid telemetry: applied updates per second, p95 api.transaction wall time, frame rate'
		>
			<span
				className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-slate-500' : isLight ? 'animate-pulse bg-emerald-600' : 'animate-pulse bg-emerald-400'}`}
			/>
			{paused ? 'paused' : `${t.updatesPerSec.toLocaleString('en-US')} upd/s`}
			<span className='text-slate-500'>·</span>
			txn p95 {fmtMs(t.txnMs.p95)}ms
			<span className='text-slate-500'>·</span>
			{t.fps.toFixed(0)} fps
		</span>
	);
}
