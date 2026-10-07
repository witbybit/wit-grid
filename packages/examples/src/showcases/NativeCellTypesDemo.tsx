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
	segmentedColumnType,
	switchColumnType,
	colorColumnType,
	longTextColumnType,
	dateRangeColumnType,
	cascadeColumnType,
	linkedRecordColumnType,
	sparklineColumnType,
	openCellPopover,
	CELL_HUES,
} from '@eregister/wit-grid-react';
import type {
	BuiltInThemeName,
	CascadeOption,
	CellOption,
	CellPopover,
	ColumnDef,
	ColumnTypeDefinition,
	GridApi,
	GridReadyEvent,
	PersonOption,
} from '@eregister/wit-grid-react';
import { Box, Code2, ChevronRight, Filter, Palette } from 'lucide-react';
import { ACCOUNTS, DIRECTORY, PROJECTS, accountsServer, directoryServer, projectsServer } from './nativeCellTypesServer';

// ─── Data model ───────────────────────────────────────────────────────────────

interface TaskRow {
	id: string;
	done: boolean;
	task: string;
	status: string;
	priority: string;
	labels: string[];
	effort: string;
	team: string;
	account: string;
	projects: string[];
	location: string[];
	sprint: { start: string; end: string };
	billable: boolean;
	trend: number[];
	commits: number[];
	color: string;
	notes: string;
	watchers: string[];
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

const EFFORT: CellOption[] = [
	{ value: 's', label: 'S', color: 'emerald' },
	{ value: 'm', label: 'M', color: 'amber' },
	{ value: 'l', label: 'L', color: 'rose' },
];

/** Office locations: country → state → city. */
const LOCATIONS: CascadeOption[] = [
	{
		value: 'in',
		label: 'India',
		children: [
			{
				value: 'ka',
				label: 'Karnataka',
				children: [
					{ value: 'blr', label: 'Bengaluru' },
					{ value: 'mys', label: 'Mysuru' },
				],
			},
			{
				value: 'mh',
				label: 'Maharashtra',
				children: [
					{ value: 'bom', label: 'Mumbai' },
					{ value: 'pnq', label: 'Pune' },
				],
			},
			{ value: 'dl', label: 'Delhi', children: [{ value: 'del', label: 'New Delhi' }] },
		],
	},
	{
		value: 'us',
		label: 'United States',
		children: [
			{
				value: 'ca',
				label: 'California',
				children: [
					{ value: 'sf', label: 'San Francisco' },
					{ value: 'la', label: 'Los Angeles' },
				],
			},
			{ value: 'ny', label: 'New York', children: [{ value: 'nyc', label: 'New York City' }] },
			{ value: 'wa', label: 'Washington', children: [{ value: 'sea', label: 'Seattle' }] },
		],
	},
	{
		value: 'de',
		label: 'Germany',
		children: [
			{ value: 'be', label: 'Berlin', children: [{ value: 'ber', label: 'Berlin' }] },
			{ value: 'by', label: 'Bavaria', children: [{ value: 'muc', label: 'Munich' }] },
		],
	},
	{
		value: 'jp',
		label: 'Japan',
		children: [
			{
				value: 'tk',
				label: 'Tokyo',
				children: [
					{ value: 'shb', label: 'Shibuya' },
					{ value: 'mnt', label: 'Minato' },
				],
			},
		],
	},
];
const LOCATION_PATHS: string[][] = LOCATIONS.flatMap((c) =>
	(c.children ?? []).flatMap((s) => (s.children ?? []).map((city) => [c.value, s.value, city.value]))
);

const NOTES = [
	'Waiting on legal review before the copy changes go out.',
	'Repro only on Safari 17.\nAttach the HAR file from the support ticket.',
	'Pair with design on the empty states; spec is in the linked doc.',
	'',
	'Customer asked for a CSV export as well — scope it separately.',
	'Blocked until the staging cluster is upgraded.',
];

/**
 * Pressing a linked record chip: a preview card anchored to the chip, built on the grid's own
 * popover so it follows the grid theme. A real app would navigate or open a drawer from here.
 */
let openPreview: CellPopover | null = null;
function showRecordPreview(value: string, chip: HTMLElement) {
	openPreview?.close();
	const record = PROJECTS.find((p) => p.value === value);
	if (!record) return;
	const [code, stage] = (record.description ?? '').split(' · ');
	const hue = CELL_HUES[record.color as keyof typeof CELL_HUES] ?? CELL_HUES.blue;
	const card = document.createElement('div');
	card.style.cssText = 'width:260px;padding:8px;display:flex;flex-direction:column;gap:12px';
	card.innerHTML = `
		<div style="display:flex;align-items:center;gap:10px">
			<span style="width:34px;height:34px;border-radius:8px;display:grid;place-items:center;font-weight:700;color:#fff;background:${hue}">${record.label![0]}</span>
			<div style="min-width:0">
				<div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
				<div style="font-size:12px;color:var(--og-ct-muted)">${code}</div>
			</div>
		</div>
		<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12.5px">
			<span style="color:var(--og-ct-muted)">Stage</span><span>${stage}</span>
			<span style="color:var(--og-ct-muted)">Linked tasks</span><span>${(parseInt(value.slice(4), 10) % 9) + 2}</span>
			<span style="color:var(--og-ct-muted)">Lead</span><span>${PEOPLE[parseInt(value.slice(4), 10) % PEOPLE.length].label}</span>
		</div>
		<div style="display:flex;justify-content:flex-end;gap:6px">
			<button type="button" class="og-ct-btn" data-ghost>Close</button>
			<button type="button" class="og-ct-btn" data-primary>Open project</button>
		</div>`;
	(card.querySelector('div > div > div') as HTMLElement).textContent = record.label!;
	const popover = openCellPopover({ anchor: chip, content: card, label: record.label, onDismiss: () => (openPreview = null) });
	openPreview = popover;
	for (const button of card.querySelectorAll('button')) button.addEventListener('click', () => popover.close());
}

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
	// Options on a server: paged and searched there, labels looked up for the values in cells.
	account: comboboxColumnType([], {
		loadOptions: accountsServer.load,
		resolveOptions: accountsServer.resolve,
		searchPlaceholder: 'Search 10,000 accounts…',
	}),
	watchers: personColumnType({
		multiple: true,
		loadOptions: directoryServer.load,
		resolveOptions: directoryServer.resolve,
		searchPlaceholder: 'Search 2,000 people…',
	}),
	owner: personColumnType({ people: PEOPLE }),
	reviewers: personColumnType({ people: PEOPLE, multiple: true }),
	budget: currencyColumnType({ currency: 'USD', decimals: 0, step: 500, colorNegative: true }),
	progress: progressColumnType(),
	confidence: progressColumnType({ max: 1, traffic: true }),
	rating: ratingColumnType(),
	effort: segmentedColumnType(EFFORT),
	// Links to another table: record chips, a record picker paged from its API, chips open the record.
	projects: linkedRecordColumnType([], {
		loadOptions: projectsServer.load,
		resolveOptions: projectsServer.resolve,
		searchPlaceholder: 'Find a project…',
		onOpen: (value, _params, chip) => showRecordPreview(value, chip),
	}),
	location: cascadeColumnType({ options: LOCATIONS, searchPlaceholder: 'Search cities…' }),
	sprint: dateRangeColumnType(),
	billable: switchColumnType({ onLabel: 'Billable', offLabel: 'Internal' }),
	trend: sparklineColumnType({ type: 'area', colorBy: 'trend', curve: 'smooth', label: 'change' }),
	commits: sparklineColumnType({ type: 'bar', color: 'violet', label: 'last', reference: 'average', format: { decimals: 0 } }),
	color: colorColumnType(),
	notes: longTextColumnType({ maxLength: 500, placeholder: 'Add a note…' }),
};

const COLUMNS: ColumnDef<TaskRow>[] = [
	{ field: 'done', header: '', width: 48, type: 'checkbox' },
	{ field: 'task', header: 'Task', width: 220 },
	{ field: 'status', header: 'Status', width: 140, type: 'status' },
	{ field: 'priority', header: 'Priority', width: 120, type: 'priority' },
	{ field: 'effort', header: 'Effort', width: 120, type: 'effort' },
	{ field: 'labels', header: 'Labels', width: 200, type: 'labels' },
	{ field: 'team', header: 'Team', width: 150, type: 'team' },
	{ field: 'account', header: 'Account', width: 200, type: 'account' },
	{ field: 'projects', header: 'Projects', width: 240, type: 'projects' },
	{ field: 'watchers', header: 'Watchers', width: 120, type: 'watchers' },
	{ field: 'owner', header: 'Owner', width: 160, type: 'owner' },
	{ field: 'reviewers', header: 'Reviewers', width: 120, type: 'reviewers' },
	{ field: 'location', header: 'Office', width: 240, type: 'location' },
	{ field: 'due', header: 'Due', width: 140, type: 'date' },
	{ field: 'sprint', header: 'Sprint', width: 250, type: 'sprint' },
	{ field: 'budget', header: 'Budget', width: 120, type: 'budget' },
	{ field: 'billable', header: 'Billing', width: 130, type: 'billable' },
	{ field: 'progress', header: 'Progress', width: 160, type: 'progress' },
	{ field: 'trend', header: 'Trend (12 wk)', width: 170, type: 'trend' },
	{ field: 'commits', header: 'Commits', width: 150, type: 'commits' },
	{ field: 'confidence', header: 'Confidence', width: 150, type: 'confidence' },
	{ field: 'rating', header: 'Impact', width: 120, type: 'rating' },
	{ field: 'color', header: 'Colour', width: 130, type: 'color' },
	{ field: 'notes', header: 'Notes', width: 260, type: 'notes' },
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
			effort: pick(EFFORT, i * 2).value,
			team: pick(TEAMS, i * 7).value,
			account: pick(ACCOUNTS, i * 37).value,
			projects:
				i % 5 === 3
					? []
					: [
							pick(PROJECTS, i * 11).value,
							...(i % 2 === 0 ? [pick(PROJECTS, i * 17 + 5).value] : []),
							...(i % 6 === 0 ? [pick(PROJECTS, i + 40).value] : []),
						],
			location: pick(LOCATION_PATHS, i * 3),
			sprint: (() => {
				const start = new Date(2026, 8, 1 + (i % 6) * 14);
				const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 13);
				const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
				return { start: iso(start), end: iso(end) };
			})(),
			billable: i % 3 !== 1,
			trend: Array.from({ length: 12 }, (_, w) =>
				Math.round(40 + 25 * Math.sin((w + i) / 2.2) + ((i * 7 + w * 13) % 17) + (i % 2 ? w * 2 : -w))
			),
			commits: Array.from({ length: 10 }, (_, d) => ((i * 31 + d * 17) % 23) - (d % 4 === 3 ? 4 : 0)),
			color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#64748b'][i % 8],
			notes: pick(NOTES, i),
			watchers: [pick(DIRECTORY, i * 13).value, pick(DIRECTORY, i * 29 + 7).value],
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
	{
		name: 'loadOptions · resolveOptions',
		text: 'Options from a server: searched there, paged in as the list scrolls, labels looked up for cells (Account, Watchers).',
	},
	{ name: "'date' · 'datetime'", text: 'Intl formatting; calendar popover with keyboard navigation.' },
	{ name: "'number' · 'currency' · 'percent'", text: 'Intl number formats, stepper editor with bounds.' },
	{ name: 'progressColumnType', text: 'Bar with label; fixed colour or traffic-light.' },
	{ name: 'ratingColumnType', text: 'Stars, click to rate.' },
	{ name: 'segmentedColumnType', text: 'Two to four options inline; one press picks (Effort).' },
	{ name: 'linkedRecordColumnType', text: 'Record chips from another table, a paged record picker; pressing a chip opens a preview (Projects).' },
	{ name: 'cascadeColumnType', text: 'A path through a tree, one column per level, search across paths (Office).' },
	{ name: 'dateRangeColumnType', text: 'Two-month range calendar with presets (Sprint).' },
	{ name: 'sparklineColumnType', text: 'Line, area, bar or win/loss charts; trend colours, markers, reference lines (Trend, Commits).' },
	{ name: 'longTextColumnType', text: 'Notes in a textarea popover; Ctrl/⌘+Enter saves (Notes).' },
	{ name: 'colorColumnType', text: 'Palette, hex field and the system picker (Colour).' },
	{ name: "'checkbox' · switchColumnType", text: 'Toggle on press or Enter, keeping the value’s own shape (Billing).' },
	{
		name: 'filters',
		text: 'Every column filters with an editor that fits its type: funnel in the header, the header menu, the filter row, the sidebar and the query builder all share it.',
	},
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
	// The floating filter row: compact filter editors under the headers (on by default on the page).
	const [filterRow, setFilterRow] = useState(!compact);
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
			showFloatingFilters={filterRow}
			showFilterChipBar
			onGridReady={handleReady}
			rendererOptions={{ rowAnimation: { duration: 700, style: 'slide', easing: 'spring' } }}
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
						<span className='text-slate-500 font-normal'>· double-click or press Enter to edit · funnel in a header to filter</span>
					</div>
					<button
						onClick={() => setFilterRow((v) => !v)}
						aria-pressed={filterRow}
						className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
							filterRow ? 'border-slate-500 bg-slate-800 text-slate-100' : 'border-slate-800 text-slate-400 hover:bg-slate-800/60'
						}`}
					>
						<Filter className='w-3.5 h-3.5' />
						Filter row
					</button>
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
