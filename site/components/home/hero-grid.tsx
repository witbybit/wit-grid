'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { Activity, CalendarDays, LayoutGrid, Table2, Users } from 'lucide-react';
import { BUILT_IN_THEME_METADATA, BUILT_IN_THEME_ORDER, getBuiltInTheme, type BuiltInThemeName } from '@eregister/wit-grid-react';

const loading = (label: string) =>
	function HeroLoading() {
		return <div className='flex h-full items-center justify-center text-sm text-fd-muted-foreground'>{label}</div>;
	};

const RealtimeDashboard = dynamic(() => import('@eregister/wit-grid-examples/realtime-dashboard'), {
	ssr: false,
	loading: loading('Loading live grid…'),
});

const NativeCellTypes = dynamic(() => import('@eregister/wit-grid-examples/native-cell-types'), {
	ssr: false,
	loading: loading('Loading cell editors…'),
});

type HeroDemo = 'desk' | 'cells';

const DEMOS: { id: HeroDemo; label: string; hint: string; icon: typeof Activity }[] = [
	{ id: 'cells', label: 'Team workspace', hint: 'Teammates editing live: double-click any cell to join in', icon: Users },
	{ id: 'desk', label: 'Live market desk', hint: 'Thousands of updates a second', icon: Activity },
];

type CellsView = 'table' | 'gallery' | 'calendar';
const CELL_VIEWS: { id: CellsView; label: string; icon: typeof Activity }[] = [
	{ id: 'table', label: 'Table', icon: Table2 },
	{ id: 'gallery', label: 'Gallery', icon: LayoutGrid },
	{ id: 'calendar', label: 'Calendar', icon: CalendarDays },
];

/** Every built-in grid theme, with its background and accent for the swatch. */
const THEMES = BUILT_IN_THEME_ORDER.map((name) => {
	const tokens = getBuiltInTheme(name);
	return { name, label: BUILT_IN_THEME_METADATA[name].label, bg: tokens.bgColor, accent: tokens.focusRing };
});

export function HeroGrid() {
	const { resolvedTheme } = useTheme();
	const siteTheme: BuiltInThemeName = resolvedTheme === 'light' ? 'light' : 'dark';
	const [demo, setDemo] = useState<HeroDemo>('cells');
	// The cell demo follows the site's light / dark mode until a theme is picked here.
	const [pickedTheme, setPickedTheme] = useState<BuiltInThemeName | null>(null);
	// The team workspace as a table, a gallery of cards or a calendar of the plan.
	const [cellsView, setCellsView] = useState<CellsView>('table');
	const gridTheme = pickedTheme ?? siteTheme;
	const active = DEMOS.find((d) => d.id === demo)!;

	return (
		<div>
			<div className='wg-hero-switcher'>
				<div className='wg-hero-tabs' role='tablist' aria-label='Live demo'>
					{DEMOS.map((d) => {
						const Icon = d.icon;
						return (
							<button
								key={d.id}
								role='tab'
								type='button'
								aria-selected={demo === d.id}
								aria-controls='wg-hero-demo'
								className='wg-hero-tab'
								onClick={() => setDemo(d.id)}
							>
								<Icon aria-hidden size={14} />
								{d.label}
							</button>
						);
					})}
				</div>
				<span className='wg-hero-hint'>{active.hint}</span>
				{demo === 'cells' && (
					<div className='wg-hero-views' role='radiogroup' aria-label='View'>
						{CELL_VIEWS.map(({ id, label, icon: Icon }) => (
							<button
								key={id}
								type='button'
								role='radio'
								aria-checked={cellsView === id}
								className='wg-hero-view'
								onClick={() => setCellsView(id)}
							>
								<Icon aria-hidden size={13} />
								{label}
							</button>
						))}
					</div>
				)}
				{demo === 'cells' && (
					<div className='wg-hero-themes' role='radiogroup' aria-label='Grid theme'>
						{THEMES.map((t) => (
							<button
								key={t.name}
								type='button'
								role='radio'
								aria-checked={gridTheme === t.name}
								aria-label={t.label}
								title={t.label}
								className='wg-hero-swatch'
								style={{ background: `linear-gradient(135deg, ${t.bg} 52%, ${t.accent} 52%)` }}
								onClick={() => setPickedTheme(t.name)}
							/>
						))}
						<span className='wg-hero-theme-label'>{BUILT_IN_THEME_METADATA[gridTheme].label}</span>
					</div>
				)}
			</div>
			<div id='wg-hero-demo' role='tabpanel' className='wg-hero-grid'>
				{demo === 'desk' ? (
					<RealtimeDashboard compact theme={siteTheme} />
				) : (
					<NativeCellTypes compact theme={gridTheme} view={cellsView} onViewChange={setCellsView} />
				)}
			</div>
		</div>
	);
}
