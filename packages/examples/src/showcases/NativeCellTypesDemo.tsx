/**
 * Native Cell Types Showcase
 *
 * Every built-in cell type: renderers and editors come from the grid core (DOM, no React per cell),
 * styled from the grid theme, so switching theme restyles cells, badges and editor popovers alike.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	BUILT_IN_THEME_METADATA,
	BUILT_IN_THEME_ORDER,
	Grid,
	getBuiltInTheme,
	comboboxColumnType,
	currencyColumnType,
	multiSelectColumnType,
	personColumnType,
	progressColumnType,
	ratingColumnType,
	selectColumnType,
} from '@eregister/wit-grid-react';
import type { BuiltInThemeName, CellOption, ColumnDef, ColumnTypeDefinition, GridApi, GridReadyEvent, PersonOption } from '@eregister/wit-grid-react';
import { Box, Code2, ChevronRight, Palette } from 'lucide-react';

// ─── Data model ───────────────────────────────────────────────────────────────

interface TaskRow {
	id: string;
	done: boolean;
	task: string;
	status: string;
	priority: string;
	labels: string[];
	team: string;
	owner: string;
	reviewers: string;
	due: string;
	budget: number;
	progress: number;
	confidence: number;
	rating: number;
	spec: string;
	contact: string;
	updated: string;
}

// ─── Options ──────────────────────────────────────────────────────────────────

const STATUS: CellOption[] = [
	{ value: 'backlog', label: 'Backlog', color: 'gray' },
	{ value: 'todo', label: 'To do', color: 'sky' },
	{ value: 'progress', label: 'In progress', color: 'amber' },
	{ value: 'review', label: 'In review', color: 'violet' },
	{ value: 'done', label: 'Done', color: 'emerald' },
	{ value: 'blocked', label: 'Blocked', color: 'rose' },
];

const PRIORITY: CellOption[] = [
	{ value: 'urgent', label: 'Urgent', color: 'red', description: 'Drop everything' },
	{ value: 'high', label: 'High', color: 'orange', description: 'This sprint' },
	{ value: 'medium', label: 'Medium', color: 'yellow', description: 'Next sprint' },
	{ value: 'low', label: 'Low', color: 'gray', description: 'When there is time' },
];

const LABELS: CellOption[] = [
	{ value: 'bug', label: 'Bug', color: 'red' },
	{ value: 'feature', label: 'Feature', color: 'blue' },
	{ value: 'perf', label: 'Performance', color: 'amber' },
	{ value: 'a11y', label: 'Accessibility', color: 'teal' },
	{ value: 'docs', label: 'Docs', color: 'gray' },
	{ value: 'security', label: 'Security', color: 'fuchsia' },
];

const TEAMS: CellOption[] = [
	{ value: 'ui', label: 'UI Design', group: 'Design', color: 'pink' },
	{ value: 'ux', label: 'UX Research', group: 'Design', color: 'rose' },
	{ value: 'brand', label: 'Brand', group: 'Design', color: 'fuchsia' },
	{ value: 'fe', label: 'Frontend', group: 'Engineering', color: 'blue' },
	{ value: 'be', label: 'Backend', group: 'Engineering', color: 'indigo' },
	{ value: 'infra', label: 'Infrastructure', group: 'Engineering', color: 'cyan' },
	{ value: 'qa', label: 'Quality', group: 'Engineering', color: 'teal' },
	{ value: 'growth', label: 'Growth', group: 'Business', color: 'emerald' },
	{ value: 'sales', label: 'Sales', group: 'Business', color: 'lime' },
	{ value: 'support', label: 'Support', group: 'Business', color: 'amber' },
];

const PEOPLE: PersonOption[] = [
	{ value: 'ava', label: 'Ava Chen', description: 'Engineering manager', group: 'Engineering' },
	{ value: 'liam', label: 'Liam Novak', description: 'Frontend', group: 'Engineering' },
	{ value: 'noah', label: 'Noah Patel', description: 'Backend', group: 'Engineering' },
	{ value: 'mia', label: 'Mia Rossi', description: 'Product design', group: 'Design' },
	{ value: 'zoe', label: 'Zoe Okafor', description: 'Research', group: 'Design' },
	{ value: 'ethan', label: 'Ethan Brooks', description: 'QA lead', group: 'Engineering' },
	{ value: 'sofia', label: 'Sofia Lind', description: 'Growth', group: 'Business' },
	{ value: 'kai', label: 'Kai Tanaka', description: 'Infrastructure', group: 'Engineering' },
];

const TASKS = [
	'Redesign onboarding flow',
	'Fix flaky checkout test',
	'Migrate auth to OAuth 2.1',
	'Dark mode for settings',
	'Audit color contrast',
	'Speed up search index',
	'Quarterly pricing review',
	'Write API rate-limit docs',
	'Kubernetes node upgrade',
	'Customer interview round',
	'Rebuild CSV importer',
	'Harden file uploads',
];

// ─── Column types ─────────────────────────────────────────────────────────────
// Built-in names (checkbox, date, datetime, percent, url, email) need no registration; these add options.

const TASK_COLUMN_TYPES: Record<string, ColumnTypeDefinition<TaskRow>> = {
	status: selectColumnType(STATUS, { noneLabel: 'No status' }),
	priority: selectColumnType(PRIORITY, { variant: 'dot' }),
	labels: multiSelectColumnType(LABELS, { maxVisible: 2, searchable: true }),
	team: comboboxColumnType(TEAMS, { searchPlaceholder: 'Search teams…' }),
	owner: personColumnType({ people: PEOPLE }),
	reviewers: personColumnType({ people: PEOPLE, multiple: true }),
	budget: currencyColumnType({ currency: 'USD', decimals: 0, step: 500, colorNegative: true }),
	progress: progressColumnType(),
	confidence: progressColumnType({ max: 1, traffic: true }),
	rating: ratingColumnType(),
};

const COLUMNS: ColumnDef<TaskRow>[] = [
	{ field: 'done', header: '', width: 48, type: 'checkbox' },
	{ field: 'task', header: 'Task', width: 220 },
	{ field: 'status', header: 'Status', width: 140, type: 'status' },
	{ field: 'priority', header: 'Priority', width: 120, type: 'priority' },
	{ field: 'labels', header: 'Labels', width: 200, type: 'labels' },
	{ field: 'team', header: 'Team', width: 150, type: 'team' },
	{ field: 'owner', header: 'Owner', width: 160, type: 'owner' },
	{ field: 'reviewers', header: 'Reviewers', width: 120, type: 'reviewers' },
	{ field: 'due', header: 'Due', width: 140, type: 'date' },
	{ field: 'budget', header: 'Budget', width: 120, type: 'budget' },
	{ field: 'progress', header: 'Progress', width: 160, type: 'progress' },
	{ field: 'confidence', header: 'Confidence', width: 150, type: 'confidence' },
	{ field: 'rating', header: 'Impact', width: 120, type: 'rating' },
	{ field: 'spec', header: 'Spec', width: 190, type: 'url' },
	{ field: 'contact', header: 'Contact', width: 200, type: 'email' },
	{ field: 'updated', header: 'Updated', width: 190, type: 'datetime' },
];

function pick<T>(list: readonly T[], n: number): T {
	return list[n % list.length];
}

function generateTasks(count: number): TaskRow[] {
	return Array.from({ length: count }, (_, i) => {
		const owner = pick(PEOPLE, i * 3);
		const progress = (i * 37) % 101;
		return {
			id: `T-${1001 + i}`,
			done: progress >= 90,
			task: pick(TASKS, i) + (i >= TASKS.length ? ` #${Math.floor(i / TASKS.length) + 1}` : ''),
			status: i % 11 === 5 ? '' : pick(STATUS, i * 5).value,
			priority: pick(PRIORITY, i * 3 + 1).value,
			labels: [pick(LABELS, i).value, pick(LABELS, i * 2 + 3).value, ...(i % 4 === 0 ? [pick(LABELS, i + 4).value] : [])].filter(
				(v, k, all) => all.indexOf(v) === k
			),
			team: pick(TEAMS, i * 7).value,
			owner: owner.value,
			reviewers: [pick(PEOPLE, i + 1).value, pick(PEOPLE, i + 4).value, ...(i % 3 === 0 ? [pick(PEOPLE, i + 6).value] : [])].join(','),
			due: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String(((i * 7) % 28) + 1).padStart(2, '0')}`,
			budget: i % 13 === 4 ? -1200 : 2500 + ((i * 1733) % 48000),
			progress,
			confidence: ((i * 29) % 100) / 100,
			rating: (i * 3) % 6,
			spec: `docs.example.com/specs/${1001 + i}`,
			contact: `${owner.label!.split(' ')[0].toLowerCase()}@example.com`,
			updated: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`,
		};
	});
}

// ─── Reference ────────────────────────────────────────────────────────────────

const TYPE_REFERENCE: { name: string; text: string }[] = [
	{ name: 'selectColumnType', text: 'One option, tinted badge. Variants: soft, dot, outline, plain. Optional “none” entry.' },
	{ name: 'multiSelectColumnType', text: 'Chips with +N overflow; checkbox list editor.' },
	{ name: 'comboboxColumnType', text: 'Searchable, grouped list for long option sets.' },
	{ name: 'tagsColumnType', text: 'Free tags: type to create, colours from the palette.' },
	{ name: 'personColumnType', text: 'Avatar and name, or stacked avatars; people picker.' },
	{ name: "'date' · 'datetime'", text: 'Intl formatting; calendar popover with keyboard navigation.' },
	{ name: "'number' · 'currency' · 'percent'", text: 'Intl number formats, stepper editor with bounds.' },
	{ name: 'progressColumnType', text: 'Bar with label; fixed colour or traffic-light.' },
	{ name: 'ratingColumnType', text: 'Stars, click to rate.' },
	{ name: "'checkbox'", text: 'Toggles on press, keeps the value’s own shape.' },
	{ name: "'url' · 'email'", text: 'Safe links (http, https, mailto only).' },
];

const SNIPPET = `import { selectColumnType, comboboxColumnType } from '@eregister/wit-grid-react';

const columnTypes = {
  status: selectColumnType([
    { value: 'todo', label: 'To do', color: 'sky' },
    { value: 'done', label: 'Done',  color: 'emerald' },
  ], { noneLabel: 'No status' }),
  team: comboboxColumnType([
    { value: 'fe', label: 'Frontend', group: 'Engineering' },
    { value: 'ui', label: 'UI Design', group: 'Design' },
  ]),
};

const columns = [
  { field: 'status', header: 'Status', type: 'status' },
  { field: 'due',    header: 'Due',    type: 'date' },
  { field: 'price',  header: 'Price',  type: 'currency' },
];

// Colours follow the grid theme. To adjust cells alone, set
// --og-ct-accent, --og-ct-radius, --og-ct-rating… on the grid.`;

/** Every built-in theme, with its background and accent for the swatch. */
const THEMES = BUILT_IN_THEME_ORDER.map((name) => {
	const tokens = getBuiltInTheme(name);
	return { name, label: BUILT_IN_THEME_METADATA[name].label, bg: tokens.bgColor, accent: tokens.focusRing };
});

// ─── Page component ───────────────────────────────────────────────────────────

interface NativeCellTypesDemoProps {
	onGridReady?: (event: GridReadyEvent<TaskRow>) => void;
	/** Hides the reference sidebar and the toolbar frame, keeping just the grid (for embedding). */
	compact?: boolean;
	/**
	 * The grid theme, when the host picks it (the docs hero). Hides the built-in theme picker; the
	 * grid follows this prop. Without it the demo keeps its own picker, starting on `'dark'`.
	 */
	theme?: BuiltInThemeName;
}

export default function NativeCellTypesDemo({ onGridReady, compact = false, theme: controlledTheme }: NativeCellTypesDemoProps) {
	const rows = useMemo(() => generateTasks(200), []);
	const apiRef = useRef<GridApi<TaskRow> | null>(null);
	const [ownTheme, setOwnTheme] = useState<BuiltInThemeName>('dark');
	const theme = controlledTheme ?? ownTheme;
	const themeRef = useRef(theme);
	const [showSnippet, setShowSnippet] = useState(false);
	// The theme the grid is created with (no flash of the default theme); later changes switch it.
	const initialState = useMemo(() => ({ themeName: themeRef.current }), []);

	const handleReady = useCallback(
		(event: GridReadyEvent<TaskRow>) => {
			apiRef.current = event.api;
			// A remounted grid starts on the theme it was created with: bring it to the current one.
			if (event.api.getThemeName() !== themeRef.current) event.api.switchTheme(themeRef.current);
			onGridReady?.(event);
		},
		[onGridReady]
	);
	useEffect(() => {
		themeRef.current = theme;
		const api = apiRef.current;
		if (api && api.getThemeName() !== theme) api.switchTheme(theme);
	}, [theme]);

	const grid = (
		<Grid
			rowModelType='client'
			rows={rows}
			columns={COLUMNS}
			columnTypes={TASK_COLUMN_TYPES}
			initialState={initialState}
			navigationOptions={{ editTrigger: 'doubleClick' }}
			pinLeftColumns={2}
			onGridReady={handleReady}
		/>
	);
	if (compact) return <div style={{ height: '100%', width: '100%', minHeight: 0, minWidth: 0 }}>{grid}</div>;

	return (
		<div className='flex flex-col lg:flex-row h-full w-full gap-5 overflow-hidden'>
			<div className='flex-1 flex flex-col gap-3 min-h-[360px] lg:min-h-0 min-w-0'>
				<div className='border border-slate-800 rounded-xl px-3 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-slate-900/30'>
					<div className='flex items-center gap-2 text-[11px] text-slate-300 font-semibold'>
						<Box className='w-4 h-4 text-violet-400' />
						Native cell types
						<span className='text-slate-500 font-normal'>· double-click or press Enter on a cell to edit</span>
					</div>
					{!controlledTheme && (
						<div className='flex flex-wrap items-center gap-1' role='radiogroup' aria-label='Grid theme'>
							<Palette className='w-3.5 h-3.5 text-slate-500 mr-1' />
							{THEMES.map((t) => (
								<button
									key={t.name}
									role='radio'
									aria-checked={theme === t.name}
									onClick={() => setOwnTheme(t.name)}
									className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
										theme === t.name
											? 'border-slate-500 bg-slate-800 text-slate-100'
											: 'border-transparent text-slate-400 hover:bg-slate-800/60'
									}`}
								>
									<span
										className='w-2.5 h-2.5 rounded-full border border-slate-600'
										style={{ background: `linear-gradient(135deg, ${t.bg} 50%, ${t.accent} 50%)` }}
									/>
									{t.label}
								</button>
							))}
						</div>
					)}
				</div>

				<div className='flex-1 min-h-0 min-w-0 rounded-xl overflow-hidden border border-slate-800'>{grid}</div>
			</div>

			<div className='w-full lg:w-[300px] flex flex-col gap-4 shrink lg:shrink-0 min-h-0 overflow-y-auto max-h-[40%] lg:max-h-none pr-1'>
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3'>
					<h3 className='text-[11px] font-semibold text-slate-300'>Cell types</h3>
					{TYPE_REFERENCE.map((t) => (
						<div key={t.name} className='flex flex-col gap-0.5'>
							<code className='text-[11px] text-violet-300'>{t.name}</code>
							<span className='text-[11px] text-slate-500 leading-snug'>{t.text}</span>
						</div>
					))}
					<p className='text-[11px] text-slate-500 leading-snug border-t border-slate-800 pt-3'>
						All cells are DOM renderers from the grid core: no React work per cell, nothing to freeze while scrolling. Colours come from
						the grid theme, so popovers and badges follow the theme switch above.
					</p>
				</div>

				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-2.5'>
					<button className='flex items-center justify-between w-full text-left' onClick={() => setShowSnippet((v) => !v)}>
						<h3 className='text-[11px] font-semibold text-slate-300 flex items-center gap-1.5'>
							<Code2 className='w-3.5 h-3.5 text-emerald-400' />
							Usage
						</h3>
						<ChevronRight
							className='w-3 h-3 text-slate-500 transition-transform duration-150'
							style={{ transform: showSnippet ? 'rotate(90deg)' : 'none' }}
						/>
					</button>
					{showSnippet && (
						<pre className='text-[10px] text-slate-400 font-mono leading-relaxed bg-slate-950/80 border border-slate-900 rounded-lg p-3 overflow-x-auto whitespace-pre'>
							{SNIPPET}
						</pre>
					)}
				</div>
			</div>
		</div>
	);
}
