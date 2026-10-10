'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { Activity, LayoutDashboard, Maximize2, Minimize2 } from 'lucide-react';
import { BUILT_IN_THEME_METADATA, BUILT_IN_THEME_ORDER, getBuiltInTheme, type BuiltInThemeName } from '@eregister/wit-grid-react';

const loading = (label: string) =>
	function HeroLoading() {
		return <div className='flex h-full items-center justify-center text-sm text-fd-muted-foreground'>{label}</div>;
	};

const RealtimeDashboard = dynamic(() => import('@eregister/wit-grid-examples/realtime-dashboard'), {
	ssr: false,
	loading: loading('Loading live grid…'),
});

const RecordWorkspace = dynamic(() => import('@eregister/wit-grid-examples/record-workspace'), {
	ssr: false,
	loading: loading('Loading the workspace…'),
});

type HeroDemo = 'desk' | 'workspace';

const DEMOS: { id: HeroDemo; label: string; hint: string; icon: typeof Activity }[] = [
	{
		id: 'workspace',
		label: 'Record workspace',
		hint: 'One roadmap as a table, gallery, calendar, Kanban board and Gantt — switch views, your place stays',
		icon: LayoutDashboard,
	},
	{ id: 'desk', label: 'Live market desk', hint: 'Thousands of updates a second', icon: Activity },
];

/** Every built-in grid theme, with its background and accent for the swatch. */
const THEMES = BUILT_IN_THEME_ORDER.map((name) => {
	const tokens = getBuiltInTheme(name);
	return { name, label: BUILT_IN_THEME_METADATA[name].label, bg: tokens.bgColor, accent: tokens.focusRing };
});

export function HeroGrid() {
	const { resolvedTheme } = useTheme();
	const siteTheme: BuiltInThemeName = resolvedTheme === 'light' ? 'glass-light' : 'glass-dark';
	const [demo, setDemo] = useState<HeroDemo>('workspace');
	// The workspace follows the site's light / dark mode until a theme is picked here.
	const [pickedTheme, setPickedTheme] = useState<BuiltInThemeName | null>(null);
	const gridTheme = pickedTheme ?? siteTheme;
	const active = DEMOS.find((d) => d.id === demo)!;

	// Full screen: the showcase covers the window, and the browser goes full screen when it allows.
	// The document (not the showcase) is what goes full screen, so the grid's popovers and menus — which
	// live in <body> — stay visible.
	const [full, setFull] = useState(false);
	const closeButton = useRef<HTMLButtonElement>(null);
	const enter = useCallback(() => {
		setFull(true);
		const root = document.documentElement;
		if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
	}, []);
	const exit = useCallback(() => {
		setFull(false);
		if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
	}, []);
	useEffect(() => {
		if (!full) return;
		// Leaving browser full screen (Esc, F11) leaves the showcase's too.
		const onChange = () => {
			if (!document.fullscreenElement) setFull(false);
		};
		document.addEventListener('fullscreenchange', onChange);
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		closeButton.current?.focus({ preventScroll: true });
		return () => {
			document.removeEventListener('fullscreenchange', onChange);
			document.body.style.overflow = overflow;
		};
	}, [full]);

	return (
		<div className={full ? 'wg-hero-full' : undefined}>
			<div className='wg-hero-switcher'>
				{/* The tabs with their hint underneath, so the controls fit on one row beside them. */}
				<div className='wg-hero-lead'>
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
				</div>
				{demo === 'workspace' && (
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
				<button
					ref={closeButton}
					type='button'
					className='wg-hero-fullscreen'
					aria-pressed={full}
					aria-label={full ? 'Exit full screen' : 'Full screen'}
					title={full ? 'Exit full screen (Esc)' : 'Full screen'}
					onClick={full ? exit : enter}
				>
					{full ? <Minimize2 aria-hidden size={14} /> : <Maximize2 aria-hidden size={14} />}
					<span>{full ? 'Exit full screen' : 'Full screen'}</span>
				</button>
			</div>
			<div id='wg-hero-demo' role='tabpanel' className='wg-hero-grid'>
				{demo === 'desk' ? <RealtimeDashboard compact theme={siteTheme} /> : <RecordWorkspace theme={gridTheme} />}
			</div>
		</div>
	);
}
