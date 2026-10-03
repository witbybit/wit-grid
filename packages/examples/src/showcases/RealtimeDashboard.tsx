/**
 * Markets Desk — a high-frequency live markets dashboard on Wit Grid.
 *
 * A seeded universe of 10k / 50k / 200k instruments (5k in `compact`) ticks through a random-walk feed:
 * ticks accumulate and land as ONE `api.transaction({ rows: { update } })` per animation frame.
 * The grid is grouped (asset class › sector), sticky-headed, aggregated, sorted live by change %,
 * and drawn with DOM renderers (price flash, sparkline, heat bar, day range, P&L bar, gauges),
 * React cells for low-frequency badges, and a custom group renderer. A telemetry panel measures
 * the grid honestly (transaction wall time, frame time, dropped frames, long tasks) and mirrors
 * the numbers on `window.__marketsDeskTelemetry`.
 *
 * Theme-aware: `theme="light"` uses the built-in `'spreadsheet'` grid theme and re-tints the cells
 * through CSS variables. Defaults to `'dark'` for hosts (like the demo app) that don't pass it.
 *
 * Files: ./marketsDesk/{data, feed, telemetry, columns, domRenderers, reactCells, panels, DeskGrid, styles}.
 */
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GridReadyEvent, RowAnimationOptions } from '@eregister/wit-grid-react';
import { Pause, Play, TrendingUp } from 'lucide-react';
import { DeskGrid, type GroupBy, type GroupDisplay } from './marketsDesk/DeskGrid';
import type { MarketRow } from './marketsDesk/data';
import { FeedEngine } from './marketsDesk/feed';
import { KpiStrip, PnlChart, SectorHeatmap, TelemetryBadge, TelemetryPanel } from './marketsDesk/panels';
import { DESK_CSS } from './marketsDesk/styles';

export type { MarketRow } from './marketsDesk/data';

interface RealtimeDashboardProps {
	editTrigger?: 'singleClick' | 'doubleClick';
	arrowKeyNavigationEdit?: boolean;
	onCellValueChanged?: (event: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => void;
	onGridReady?: (event: GridReadyEvent<MarketRow>) => void;
	/**
	 * Landing-page layout: 5k rows grouped by asset class, a KPI strip, a one-line telemetry badge
	 * and the grid; the heatmap, P&L chart and telemetry panel are left out.
	 */
	compact?: boolean;
	/**
	 * Light switches the grid to the built-in `'spreadsheet'` theme and re-tints this component's own
	 * chrome and custom renderers to match. Defaults to `'dark'`.
	 */
	theme?: 'light' | 'dark';
	/** Initial instrument count. Default: 50,000 (5,000 in `compact`). The gauntlet passes a small number. */
	rowCount?: number;
	/** Initial updates per second (100 / 1,000 / 10,000 / 50,000). Default: 10,000 (1,000 in `compact`). */
	rate?: number;
	/** Start with the feed paused. */
	paused?: boolean;
}

/** Row animation styles to try on the live sort: each is a plain `rowAnimation` object. */
export const ROW_ANIMATION_PRESETS = {
	cascade: { label: 'Cascade', options: { style: 'slide', easing: 'snappy', duration: 360, stagger: 18 } },
	spring: { label: 'Spring', options: { style: 'slide', easing: 'spring', duration: 520 } },
	smooth: { label: 'Smooth', options: { style: 'slide', easing: 'smooth', duration: 280 } },
	fade: { label: 'Fade', options: { style: 'fade', duration: 320, stagger: 12 } },
	off: { label: 'Off', options: { style: 'none' } },
} satisfies Record<string, { label: string; options: RowAnimationOptions }>;

type PresetId = keyof typeof ROW_ANIMATION_PRESETS;
const PRESET_IDS = Object.keys(ROW_ANIMATION_PRESETS) as PresetId[];

const ROW_COUNTS = [
	{ value: 10_000, label: '10k' },
	{ value: 50_000, label: '50k' },
	{ value: 200_000, label: '200k' },
];
const RATES = [
	{ value: 100, label: '100' },
	{ value: 1_000, label: '1k' },
	{ value: 10_000, label: '10k' },
	{ value: 50_000, label: '50k' },
];
const GROUPINGS: { value: GroupBy; label: string }[] = [
	{ value: 'none', label: 'None' },
	{ value: 'class', label: 'Class' },
	{ value: 'sector', label: 'Class › Sector' },
	{ value: 'region', label: 'Class › Sector › Region' },
];
const DISPLAYS: { value: GroupDisplay; label: string }[] = [
	{ value: 'column', label: 'Column' },
	{ value: 'row', label: 'Row' },
];

function Segmented<T extends string | number>({
	label,
	value,
	options,
	onChange,
	isLight,
	title,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	isLight: boolean;
	title?: string;
}) {
	return (
		<div
			role='radiogroup'
			aria-label={label}
			title={title ?? label}
			className={`flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5 ${isLight ? 'border-slate-300 bg-slate-100' : 'border-slate-700/60 bg-slate-900/80'}`}
		>
			<span className='px-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500'>{label}</span>
			{options.map((o) => {
				const active = o.value === value;
				return (
					<button
						key={String(o.value)}
						type='button'
						role='radio'
						aria-checked={active}
						onClick={() => onChange(o.value)}
						className={`cursor-pointer rounded-md px-2 py-1 text-[10px] font-bold transition-colors ${
							active
								? 'bg-indigo-600 text-white shadow-sm shadow-indigo-900/30'
								: isLight
									? 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
									: 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
						}`}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}

export default function RealtimeDashboard({
	editTrigger = 'doubleClick',
	arrowKeyNavigationEdit = true,
	onCellValueChanged,
	onGridReady,
	compact = false,
	theme = 'dark',
	rowCount: rowCountProp,
	rate: rateProp,
	paused: pausedProp,
}: RealtimeDashboardProps = {}) {
	const isLight = theme === 'light';
	const [rowCount, setRowCount] = useState(rowCountProp ?? (compact ? 5_000 : 50_000));
	const [rate, setRate] = useState(rateProp ?? (compact ? 1_000 : 10_000));
	const [paused, setPaused] = useState(pausedProp ?? false);
	const [groupBy, setGroupBy] = useState<GroupBy>(compact ? 'class' : 'sector');
	const [display, setDisplay] = useState<GroupDisplay>('column');
	const [preset, setPreset] = useState<PresetId>('cascade');
	const [sectorFilter, setSectorFilter] = useState<string | null>(null);
	const [engine, setEngine] = useState<FeedEngine | null>(null);

	// A new row count builds a new universe and feed. Built in an effect, after the loading frame paints.
	useEffect(() => {
		setEngine(null);
		let created: FeedEngine | null = null;
		const id = setTimeout(() => {
			created = new FeedEngine(rowCount);
			created.start();
			setEngine(created);
		}, 0);
		return () => {
			clearTimeout(id);
			created?.dispose();
		};
	}, [rowCount]);

	useEffect(() => {
		engine?.setRate(rate);
		engine?.setPaused(paused);
	}, [engine, rate, paused]);

	// Host callbacks may change identity each render; the memoised grid reads them through refs.
	const hostRef = useRef({ onCellValueChanged, onGridReady });
	hostRef.current = { onCellValueChanged, onGridReady };
	const handleCellValueChanged = useCallback<NonNullable<RealtimeDashboardProps['onCellValueChanged']>>(
		(e) => hostRef.current.onCellValueChanged?.(e),
		[]
	);
	const handleGridReady = useCallback((e: GridReadyEvent<MarketRow>) => hostRef.current.onGridReady?.(e), []);

	const ui = isLight
		? { shell: 'bg-white', bar: 'border-slate-200 bg-slate-50', title: 'text-slate-600', dot: 'bg-emerald-600', icon: 'text-emerald-600' }
		: { shell: '', bar: 'border-slate-900 bg-slate-900/10', title: 'text-slate-400', dot: 'bg-emerald-500', icon: 'text-emerald-400' };

	const pauseButton = (
		<button
			type='button'
			onClick={() => setPaused((p) => !p)}
			className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition-colors ${
				paused
					? 'border-emerald-500/30 bg-emerald-600 text-white hover:bg-emerald-700'
					: isLight
						? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
						: 'border-slate-700/60 bg-slate-800 text-slate-300 hover:bg-slate-700'
			}`}
		>
			{paused ? <Play className='h-3 w-3' /> : <Pause className='h-3 w-3' />}
			{paused ? 'Resume feed' : 'Pause feed'}
		</button>
	);

	const motion = (
		<Segmented
			label='Motion'
			title='How rows move when the live sort reorders them'
			isLight={isLight}
			value={preset}
			onChange={setPreset}
			options={PRESET_IDS.map((id) => ({ value: id, label: ROW_ANIMATION_PRESETS[id].label }))}
		/>
	);

	return (
		<div className={`md-root ${isLight ? 'md-light' : 'md-dark'} flex h-full w-full min-w-0 flex-col gap-2 overflow-hidden ${ui.shell}`}>
			<style>{DESK_CSS}</style>

			<div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-2 ${ui.bar}`}>
				<span className={`flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider ${ui.title}`}>
					<span className={`h-2 w-2 rounded-full ${paused ? 'bg-slate-500' : `animate-ping ${ui.dot}`}`} />
					<TrendingUp className={`h-4 w-4 ${ui.icon}`} />
					Markets desk
				</span>
				<Segmented label='Rate' title='Price updates per second' isLight={isLight} value={rate} onChange={setRate} options={RATES} />
				{!compact && (
					<Segmented label='Rows' title='Instrument count' isLight={isLight} value={rowCount} onChange={setRowCount} options={ROW_COUNTS} />
				)}
				{!compact && <Segmented label='Group' isLight={isLight} value={groupBy} onChange={setGroupBy} options={GROUPINGS} />}
				{!compact && groupBy !== 'none' && (
					<Segmented label='Display' isLight={isLight} value={display} onChange={setDisplay} options={DISPLAYS} />
				)}
				<div className='ml-auto flex flex-wrap items-center gap-2'>
					<div className={compact ? 'hidden md:block' : ''}>{motion}</div>
					{pauseButton}
					{compact && engine && <TelemetryBadge engine={engine} isLight={isLight} />}
				</div>
			</div>

			{engine ? (
				<>
					<KpiStrip engine={engine} isLight={isLight} compact={compact} />
					{!compact && (
						<div className='hidden h-[132px] shrink-0 gap-2 md:flex'>
							<SectorHeatmap engine={engine} isLight={isLight} selected={sectorFilter} onSelect={setSectorFilter} />
							<PnlChart engine={engine} isLight={isLight} />
							<TelemetryPanel engine={engine} isLight={isLight} />
						</div>
					)}
					<div className='min-h-[260px] min-w-0 flex-1'>
						<DeskGrid
							engine={engine}
							display={display}
							groupBy={groupBy}
							isLight={isLight}
							compact={compact}
							sectorFilter={sectorFilter}
							rowAnimation={ROW_ANIMATION_PRESETS[preset].options}
							editTrigger={editTrigger}
							arrowKeyNavigationEdit={arrowKeyNavigationEdit}
							onCellValueChanged={handleCellValueChanged}
							onGridReady={handleGridReady}
						/>
					</div>
				</>
			) : (
				<div className={`flex flex-1 items-center justify-center text-xs ${ui.title}`}>
					Generating {rowCount.toLocaleString('en-US')} instruments…
				</div>
			)}
		</div>
	);
}
