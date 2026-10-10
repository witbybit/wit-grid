import {
	BarChart3,
	Boxes,
	CalendarRange,
	CheckSquare,
	Command,
	GanttChart,
	KanbanSquare,
	Database,
	FileSpreadsheet,
	Filter,
	Gauge,
	Layers3,
	Map as MapIcon,
	Palette,
	PanelRight,
	Rows3,
	ShieldCheck,
	Users,
} from 'lucide-react';

/* ─── Small live visuals, one per card ─────────────────────────────────────── */

/** Rows streaming past a fixed window: virtualization. */
function ScaleVisual() {
	return (
		<div className='wg-v-scale' aria-hidden>
			<div className='wg-v-scale-track'>
				{Array.from({ length: 16 }, (_, i) => (
					<div key={i} className='wg-v-scale-row'>
						<i style={{ width: `${30 + ((i * 37) % 40)}%` }} />
						<i style={{ width: `${14 + ((i * 23) % 18)}%` }} />
						<b data-up={i % 3 !== 0 || undefined}>
							{i % 3 === 0 ? '−' : '+'}
							{((i * 1.37) % 9).toFixed(2)}%
						</b>
					</div>
				))}
			</div>
			<div className='wg-v-scale-window' />
			<div className='wg-v-scale-stats'>
				<span>
					<strong>100k</strong> rows
				</span>
				<span>
					<strong>1k</strong> cols
				</span>
				<span>
					<strong>60</strong> fps
				</span>
			</div>
		</div>
	);
}

function EditorsVisual() {
	return (
		<div className='wg-v-editors' aria-hidden>
			<span className='wg-v-pill' style={{ ['--h' as string]: '#22c55e' }}>
				<i /> Done
			</span>
			<span className='wg-v-pill' style={{ ['--h' as string]: '#f59e0b' }}>
				<i /> In review
			</span>
			<span className='wg-v-stars'>★★★★☆</span>
			<span className='wg-v-toggle' />
			<span className='wg-v-progress'>
				<i />
			</span>
			<span className='wg-v-avatars'>
				<i>AC</i>
				<i>LN</i>
				<i>+3</i>
			</span>
		</div>
	);
}

function FiltersVisual() {
	return (
		<div className='wg-v-filters' aria-hidden>
			<div className='wg-v-chip'>Status: Done, In review</div>
			<div className='wg-v-chip'>Due: this month</div>
			<div className='wg-v-chip wg-v-chip-muted'>Budget ≥ $5k</div>
		</div>
	);
}

function ChartVisual() {
	const bars = [42, 68, 54, 88, 61, 76, 95];
	return (
		<div className='wg-v-chart' aria-hidden>
			{bars.map((h, i) => (
				<i key={i} style={{ height: `${h}%`, animationDelay: `${i * 0.08}s` }} />
			))}
		</div>
	);
}

function ExcelVisual() {
	return (
		<div className='wg-v-sheet' aria-hidden>
			<span>Budget</span>
			<span>Share</span>
			<span>Due</span>
			<b>$2,500.00</b>
			<b>25%</b>
			<b>2026-03-04</b>
			<b>$12,480.50</b>
			<b>62%</b>
			<b>2026-04-18</b>
		</div>
	);
}

function SidebarVisual() {
	return (
		<div className='wg-v-sidebar' aria-hidden>
			<div className='wg-v-sidebar-panel'>
				<div className='wg-v-sidebar-card'>
					<small>Current view</small>
					<strong>Q3 pipeline</strong>
				</div>
				<i />
				<i />
				<i />
			</div>
			<div className='wg-v-sidebar-rail'>
				<span data-on />
				<span />
				<span />
				<span />
			</div>
		</div>
	);
}

const THEME_SWATCHES: [string, string, string][] = [
	['Dark', '#0b0d12', '#6d7cff'],
	['Ocean', '#071a24', '#22d3ee'],
	['Fjord', '#2e3440', '#88c0d0'],
	['Velvet', '#191626', '#ff6ec7'],
	['Ember', '#17120e', '#f59e0b'],
	['Forest', '#0d1712', '#34d399'],
	['Mono', '#0c0c0c', '#4ade80'],
	['Paper', '#fbf7ef', '#c2410c'],
	['Latte', '#eff1f5', '#8839ef'],
	['Blossom', '#fffafb', '#e11d74'],
	['Light', '#ffffff', '#2563eb'],
];

function ThemesVisual() {
	return (
		<div className='wg-v-themes' aria-hidden>
			{THEME_SWATCHES.map(([name, bg, accent]) => (
				<span key={name} style={{ background: bg }} title={name}>
					<i style={{ background: accent }} />
				</span>
			))}
		</div>
	);
}

function TreeVisual() {
	return (
		<div className='wg-v-tree' aria-hidden>
			<div>
				▾ <strong>EMEA</strong> <em>128</em>
			</div>
			<div className='wg-v-tree-1'>
				▾ <strong>Cloud</strong> <em>42</em>
			</div>
			<div className='wg-v-tree-2'>Northwind Labs</div>
			<div className='wg-v-tree-2'>Umbrella Logistics</div>
			<div className='wg-v-tree-1'>
				▸ <strong>Devices</strong> <em>86</em>
			</div>
		</div>
	);
}

function RowModelsVisual() {
	return (
		<div className='wg-v-models' aria-hidden>
			<span>client</span>
			<span>infinite</span>
			<span>server</span>
		</div>
	);
}

function IntegrityVisual() {
	return (
		<div className='wg-v-integrity' aria-hidden>
			<span data-tone='ok'>Validated</span>
			<span data-tone='warn'>2 duplicates</span>
			<span data-tone='diff'>
				<s>4,233</s> → 5,966
			</span>
		</div>
	);
}

/** Teammates' cursors gliding between cells, one of them typing. */
function PresenceVisual() {
	return (
		<div className='wg-v-presence' aria-hidden>
			{Array.from({ length: 15 }, (_, i) => (
				<i key={i} />
			))}
			<span className='wg-v-cursor wg-v-cursor-a'>
				<b>Ava</b>
			</span>
			<span className='wg-v-cursor wg-v-cursor-b'>
				<b>Leo ✎</b>
			</span>
		</div>
	);
}

/** Numbers formatted by where they sit: a data bar, a heat tint and an arrow. */
function FormattingVisual() {
	const rows: [number, number, string][] = [
		[92, 0.9, '▲'],
		[64, 0.62, '▶'],
		[38, 0.35, '▼'],
		[78, 0.75, '▲'],
	];
	return (
		<div className='wg-v-format' aria-hidden>
			{rows.map(([bar, heat, icon], i) => (
				<div key={i}>
					<span className='wg-v-format-bar' style={{ ['--w' as string]: `${bar}%` }}>
						${(bar * 412).toLocaleString('en-US')}
					</span>
					<span className='wg-v-format-heat' style={{ ['--t' as string]: `${Math.round(heat * 100)}%` }}>
						{Math.round(heat * 100)}
					</span>
					<span className='wg-v-format-icon' data-band={icon}>
						{icon}
					</span>
				</div>
			))}
		</div>
	);
}

/** Every row on a strip: the view window, selection, edits and issues. */
function MinimapVisual() {
	const marks: [number, string][] = [
		[8, 'sel'],
		[22, 'edit'],
		[37, 'err'],
		[51, 'edit'],
		[63, 'sel'],
		[78, 'err'],
		[88, 'edit'],
	];
	return (
		<div className='wg-v-minimap' aria-hidden>
			<div className='wg-v-minimap-rows'>
				{Array.from({ length: 9 }, (_, i) => (
					<i key={i} style={{ width: `${45 + ((i * 29) % 45)}%` }} />
				))}
			</div>
			<div className='wg-v-minimap-strip'>
				<span className='wg-v-minimap-window' />
				{marks.map(([top, kind], i) => (
					<b key={i} data-kind={kind} style={{ top: `${top}%` }} />
				))}
			</div>
		</div>
	);
}

/** One record model, five projections: the tab strip, cards, a calendar and a timeline. */
function ViewsVisual() {
	return (
		<div className='wg-v-views' aria-hidden>
			<div className='wg-v-views-tabs'>
				{['Table', 'Gallery', 'Calendar', 'Kanban', 'Gantt'].map((tab) => (
					<span key={tab} data-on={tab === 'Kanban' || undefined}>
						{tab}
					</span>
				))}
			</div>
			<div className='wg-v-views-cards'>
				{['Launch', 'Pricing', 'Onboarding', 'Billing'].map((title, i) => (
					<div key={title} style={{ ['--h' as string]: ['#22c55e', '#f59e0b', '#6d7cff', '#ec4899'][i] }}>
						<strong>{title}</strong>
						<i />
						<i />
					</div>
				))}
			</div>
			<div className='wg-v-views-cal'>
				{Array.from({ length: 21 }, (_, i) => (
					// Placed explicitly, so the entries can overlay the days they span.
					<span key={i} data-today={i === 9 || undefined} style={{ gridColumn: (i % 7) + 1, gridRow: Math.floor(i / 7) + 1 }} />
				))}
				<b style={{ gridColumn: '2 / 6', gridRow: 1, ['--h' as string]: '#6d7cff' }} />
				<b style={{ gridColumn: '4 / 8', gridRow: 2, ['--h' as string]: '#22c55e' }} />
				<b style={{ gridColumn: '1 / 3', gridRow: 3, ['--h' as string]: '#f59e0b' }} />
			</div>
			<div className='wg-v-views-gantt'>
				<i style={{ marginLeft: '6%', width: '38%', ['--h' as string]: '#6d7cff' }} />
				<i style={{ marginLeft: '30%', width: '44%', ['--h' as string]: '#22c55e' }} />
				<i style={{ marginLeft: '58%', width: '30%', ['--h' as string]: '#f59e0b' }} />
			</div>
		</div>
	);
}

/** A board: status columns with WIP counts, a card in flight and the slot it will land in. */
function KanbanVisual() {
	const columns: [string, string, string, number][] = [
		['To do', '#3b82f6', '4', 3],
		['Doing', '#f59e0b', '3 / 4', 2],
		['Done', '#22c55e', '6', 2],
	];
	return (
		<div className='wg-v-kanban' aria-hidden>
			{columns.map(([name, hue, count, cards], c) => (
				<div key={name} className='wg-v-kanban-col' style={{ ['--h' as string]: hue }}>
					<div className='wg-v-kanban-head'>
						<i />
						<strong>{name}</strong>
						<em>{count}</em>
					</div>
					{Array.from({ length: cards }, (_, i) => (
						<div key={i} className='wg-v-kanban-card'>
							<b style={{ width: `${55 + ((i * 17 + c * 11) % 35)}%` }} />
							<span>
								<i />
								<b />
							</span>
						</div>
					))}
					{c === 1 && <div className='wg-v-kanban-slot'>Drop here</div>}
				</div>
			))}
			<div className='wg-v-kanban-ghost'>
				<b />
				<span>
					<i />
					<b />
				</span>
			</div>
		</div>
	);
}

/** A schedule: outline and bars on one row model, links, the critical path and today. */
function GanttVisual() {
	const rows: {
		wbs: string;
		name: string;
		left: number;
		width: number;
		progress: number;
		kind: 'summary' | 'task' | 'milestone';
		hue?: string;
		critical?: boolean;
	}[] = [
		{ wbs: '1', name: 'Launch plan', left: 4, width: 82, progress: 46, kind: 'summary' },
		{ wbs: '1.1', name: 'Research', left: 4, width: 24, progress: 100, kind: 'task', hue: '#22c55e' },
		{ wbs: '1.2', name: 'Design', left: 30, width: 24, progress: 70, kind: 'task', hue: '#6d7cff', critical: true },
		{ wbs: '1.3', name: 'Build', left: 56, width: 26, progress: 20, kind: 'task', hue: '#f59e0b', critical: true },
		{ wbs: '1.4', name: 'Launch', left: 85, width: 0, progress: 0, kind: 'milestone', critical: true },
	];
	return (
		<div className='wg-v-gantt' aria-hidden>
			<div className='wg-v-gantt-outline'>
				{rows.map((row) => (
					<div key={row.wbs} data-summary={row.kind === 'summary' || undefined}>
						<em>{row.wbs}</em>
						{row.name}
					</div>
				))}
			</div>
			<div className='wg-v-gantt-chart'>
				<span className='wg-v-gantt-today' />
				{rows.map((row, i) =>
					row.kind === 'milestone' ? (
						<i key={row.wbs} className='wg-v-gantt-diamond' style={{ left: `${row.left}%`, top: `${i * 20 + 6}px` }} />
					) : (
						<i
							key={row.wbs}
							className={row.kind === 'summary' ? 'wg-v-gantt-summary' : 'wg-v-gantt-bar'}
							data-critical={row.critical || undefined}
							style={{
								left: `${row.left}%`,
								width: `${row.width}%`,
								top: `${i * 20 + (row.kind === 'summary' ? 7 : 4)}px`,
								['--h' as string]: row.hue ?? '#60a5fa',
								['--p' as string]: `${row.progress}%`,
							}}
						/>
					)
				)}
				<svg viewBox='0 0 100 100' preserveAspectRatio='none'>
					<path d='M28 30 H29 V50 H30' />
					<path d='M54 50 H55 V70 H56' />
					<path d='M82 70 H85 V86' />
				</svg>
				<span className='wg-v-gantt-impact'>Reschedule 3 tasks · +2d</span>
			</div>
		</div>
	);
}

/** Ctrl / ⌘ K: every view and record action, fuzzy-searched. */
function PaletteVisual() {
	const items: [string, string, boolean?][] = [
		['Switch to Kanban', 'Views', true],
		['Move selection to In review', 'Selection'],
		['Zoom to weeks', 'Schedule'],
		['Show the critical path', 'Schedule'],
	];
	return (
		<div className='wg-v-palette' aria-hidden>
			<div className='wg-v-palette-search'>
				<span>sw kan</span>
				<kbd>⌘K</kbd>
			</div>
			{items.map(([label, group, on]) => (
				<div key={label} className='wg-v-palette-item' data-on={on || undefined}>
					<span>{label}</span>
					<em>{group}</em>
				</div>
			))}
		</div>
	);
}

/** Several cards selected, and the bar that edits them all in one undo step. */
function BulkVisual() {
	return (
		<div className='wg-v-bulk' aria-hidden>
			<div className='wg-v-bulk-cards'>
				{['#6d7cff', '#f59e0b', '#22c55e', '#ec4899'].map((hue, i) => (
					<div key={hue} data-on={i < 3 || undefined} style={{ ['--h' as string]: hue }}>
						<i />
						<b />
						<b />
					</div>
				))}
			</div>
			<div className='wg-v-bulk-bar'>
				<strong>3 selected</strong>
				<span>Move to</span>
				<span>Assign</span>
				<span>Priority</span>
				<span>Dates</span>
			</div>
		</div>
	);
}

/* ─── The cards ─────────────────────────────────────────────────────────────── */

interface Feature {
	title: string;
	description: string;
	icon: typeof Layers3;
	tag: string;
	visual: () => ReturnType<typeof ScaleVisual>;
	size?: 'wide' | 'tall';
	hue: string;
}

const FEATURES: Feature[] = [
	{
		title: 'Virtualized at any scale',
		description: 'Only the cells in view exist, and an edit repaints only the cell that changed: 100k rows and 1,000 columns scroll at 60fps.',
		icon: Layers3,
		tag: 'scrollPresentation',
		visual: ScaleVisual,
		size: 'wide',
		hue: '#38bdf8',
	},
	{
		title: '20+ native cell editors',
		description: 'Selects, tags, people, dates, ranges, ratings, toggles, colours, sparklines — themed, keyboard-first, server-loaded options.',
		icon: Boxes,
		tag: 'type: "select"',
		visual: EditorsVisual,
		hue: '#22c55e',
	},
	{
		title: 'One record, every view',
		description:
			'Table, gallery, calendar, Kanban and Gantt read the same records and the same field meanings. Selection, the inspector and undo follow you between them.',
		icon: CalendarRange,
		tag: 'workspace',
		visual: ViewsVisual,
		size: 'wide',
		hue: '#6d7cff',
	},
	{
		title: 'A board that runs the work',
		description: 'Status columns with WIP limits and totals, swimlanes, multi-card drag with a drop slot, blocked work flagged.',
		icon: KanbanSquare,
		tag: "kind: 'kanban'",
		visual: KanbanVisual,
		hue: '#f59e0b',
	},
	{
		title: 'A Gantt that schedules',
		description:
			'Outline and timeline on one row model: dependencies with lag, working calendars, the critical path, baselines and workload. You see the knock-on before a move reschedules anything.',
		icon: GanttChart,
		tag: "autoSchedule: 'push'",
		visual: GanttVisual,
		size: 'wide',
		hue: '#22c55e',
	},
	{
		title: 'Inspector & command palette',
		description: 'Every field edited by its column’s own editor, with comments and activity; Ctrl/⌘ K reaches every view and record action.',
		icon: Command,
		tag: 'Ctrl + K',
		visual: PaletteVisual,
		hue: '#a855f7',
	},
	{
		title: 'One filter, every surface',
		description: 'A column’s filterDef drives the header funnel, floating row, sidebar, chips and query builder — relative dates included.',
		icon: Filter,
		tag: 'filterDef',
		visual: FiltersVisual,
		hue: '#6d7cff',
	},
	{
		title: 'Charts, built in',
		description: 'Chart a selection or a column per category on a crisp canvas; click a bar to filter the grid.',
		icon: BarChart3,
		tag: 'createGridChart()',
		visual: ChartVisual,
		hue: '#a855f7',
	},
	{
		title: 'Excel that keeps formats',
		description: 'Currency, percent and dates stay typed; groups export as collapsible outlines. No dependency.',
		icon: FileSpreadsheet,
		tag: 'exportExcel()',
		visual: ExcelVisual,
		hue: '#10b981',
	},
	{
		title: 'Saved views, personal or shared',
		description:
			'A view keeps its filters, sort, columns and the view itself — a board with swimlanes, a schedule at a zoom. Saved views are tabs, yours or the team’s.',
		icon: PanelRight,
		tag: 'api.saveView()',
		visual: SidebarVisual,
		hue: '#f59e0b',
	},
	{
		title: 'Sixteen themes, your own in one call',
		description: 'Each with its own palette and typeface, switched at runtime — or build one from a dozen colours with createTheme().',
		icon: Palette,
		tag: 'createTheme()',
		visual: ThemesVisual,
		size: 'wide',
		hue: '#ec4899',
	},
	{
		title: 'Grouping, trees & detail',
		description: 'Expandable groups with live aggregates, parent-child trees, and a sub-grid per row.',
		icon: Rows3,
		tag: 'groupBy',
		visual: TreeVisual,
		hue: '#8b5cf6',
	},
	{
		title: 'Client, infinite or server',
		description: 'The same grid over an array, a block-loading datasource or a server query: swap rowModelType, not your code.',
		icon: Database,
		tag: 'rowModelType',
		visual: RowModelsVisual,
		hue: '#14b8a6',
	},
	{
		title: 'Data integrity & live data',
		description: 'Validation, quality checks, diffs against a snapshot and conflict resolution for streaming updates.',
		icon: ShieldCheck,
		tag: 'api.integrity',
		visual: IntegrityVisual,
		hue: '#f43f5e',
	},
	{
		title: 'Teammates, live in the grid',
		description:
			'Feed in who is where: cursors glide between cells, rings sit on the cards and bars they are on, and their edits stay out of your undo.',
		icon: Users,
		tag: 'api.setPresence()',
		visual: PresenceVisual,
		size: 'wide',
		hue: '#ec4899',
	},
	{
		title: 'Conditional formatting',
		description: 'Colour scales, data bars and icon sets scaled to each column, repainting as live data moves — and kept in Excel.',
		icon: Gauge,
		tag: "kind: 'dataBar'",
		visual: FormattingVisual,
		hue: '#f59e0b',
	},
	{
		title: 'A minimap of every row',
		description: 'A strip beside the scrollbar marks selection, recent edits and issues across 100k rows. Click to jump.',
		icon: MapIcon,
		tag: 'showMinimap',
		visual: MinimapVisual,
		hue: '#14b8a6',
	},
	{
		title: 'Bulk edits, one undo step',
		description:
			'Select across any view and move, assign, re-prioritise or shift dates for all of them: one transaction, validated and undoable.',
		icon: CheckSquare,
		tag: 'api.transaction()',
		visual: BulkVisual,
		size: 'wide',
		hue: '#14b8a6',
	},
];

export function FeatureBento() {
	return (
		<section className='mx-auto max-w-6xl px-6 py-20 sm:py-28'>
			<div className='wg-bento-head'>
				<p className='wg-bento-eyebrow'>Under the hood</p>
				<h2 className='wg-bento-title'>
					Everything a serious grid needs, <span>built into the core.</span>
				</h2>
				<p className='wg-bento-lede'>A framework-agnostic engine draws the grid; the React adapter is a thin bridge.</p>
			</div>
			<div className='wg-bento'>
				{FEATURES.map((feature) => {
					const Icon = feature.icon;
					const Visual = feature.visual;
					return (
						<article key={feature.title} className='wg-bento-card' data-size={feature.size} style={{ ['--hue' as string]: feature.hue }}>
							<div className='wg-bento-visual'>
								<Visual />
							</div>
							<div className='wg-bento-body'>
								<div className='wg-bento-card-head'>
									<span className='wg-bento-icon'>
										<Icon aria-hidden size={16} />
									</span>
									<h3>{feature.title}</h3>
								</div>
								<p>{feature.description}</p>
								<code>{feature.tag}</code>
							</div>
						</article>
					);
				})}
			</div>
		</section>
	);
}
