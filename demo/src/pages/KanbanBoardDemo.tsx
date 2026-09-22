/**
 * Kanban Board Demo — variable-height rows
 *
 * Compares two approaches side-by-side via a toggle:
 *   - getRowHeight   — pre-computed heights from data, zero DOM cost
 *   - autoRowHeight  — measured from scrollHeight after first paint, zero manual math
 *
 * Rich cell renderers used:
 *   - Priority badge cell  — colour-coded severity pill
 *   - Progress arc cell    — SVG arc showing % complete
 *   - Tag cloud cell       — wrapping coloured label chips
 *   - Attachment cell      — file-type icon grid
 *   - Due-date cell        — calendar chip with overdue highlight
 *   - Status cell          — traffic-light dot + label
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Grid } from '@eregister/wit-grid-react';
import type { ColumnDef, GridReadyEvent, GridApi, CellRendererProps } from '@eregister/wit-grid-react';

// ─── Data model ──────────────────────────────────────────────────────────────

type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
type Status = 'Backlog' | 'In Progress' | 'Review' | 'Done' | 'Blocked';

interface Attachment {
	name: string;
	type: 'pdf' | 'figma' | 'doc' | 'img' | 'zip' | 'code';
}

interface KanbanCard {
	id: string;
	title: string;
	description: string;
	status: Status;
	priority: Priority;
	progress: number;
	assignee: { name: string; initials: string; color: string };
	tags: string[];
	attachments: Attachment[];
	dueDate: string;
	storyPoints: number;
	epic: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<Priority, { color: string; bg: string; dot: string }> = {
	Critical: { color: 'text-rose-300', bg: 'bg-rose-500/15 border-rose-500/30', dot: 'bg-rose-400' },
	High: { color: 'text-orange-300', bg: 'bg-orange-500/15 border-orange-500/30', dot: 'bg-orange-400' },
	Medium: { color: 'text-amber-300', bg: 'bg-amber-500/15 border-amber-500/30', dot: 'bg-amber-400' },
	Low: { color: 'text-sky-300', bg: 'bg-sky-500/15 border-sky-500/30', dot: 'bg-sky-400' },
};

const STATUS_META: Record<Status, { color: string; dot: string; label: string }> = {
	Backlog: { color: 'text-slate-400', dot: 'bg-slate-500', label: 'Backlog' },
	'In Progress': { color: 'text-indigo-300', dot: 'bg-indigo-400', label: 'In Progress' },
	Review: { color: 'text-violet-300', dot: 'bg-violet-400', label: 'Review' },
	Done: { color: 'text-emerald-300', dot: 'bg-emerald-400', label: 'Done' },
	Blocked: { color: 'text-rose-300', dot: 'bg-rose-400', label: 'Blocked' },
};

const TAG_COLORS = [
	'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
	'bg-violet-500/20 text-violet-300 border-violet-500/30',
	'bg-sky-500/20 text-sky-300 border-sky-500/30',
	'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
	'bg-amber-500/20 text-amber-300 border-amber-500/30',
	'bg-rose-500/20 text-rose-300 border-rose-500/30',
	'bg-pink-500/20 text-pink-300 border-pink-500/30',
];

function tagColor(tag: string) {
	let h = 0;
	for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
	return TAG_COLORS[h % TAG_COLORS.length];
}

const FILE_ICONS: Record<Attachment['type'], string> = {
	pdf: '📄',
	figma: '🎨',
	doc: '📝',
	img: '🖼️',
	zip: '📦',
	code: '💻',
};

function isOverdue(dateStr: string) {
	return new Date(dateStr) < new Date();
}

// ─── Row height calculation (getRowHeight approach) ──────────────────────────

const BASE_HEIGHT = 20;
const DESC_HEIGHT = 56;
const TAGS_HEIGHT = 44;
const ATTACH_HEIGHT = 36;

export function computeCardHeight(row: KanbanCard): number {
	let h = BASE_HEIGHT;
	if (row.description) h += DESC_HEIGHT;
	if (row.tags.length > 0) h += TAGS_HEIGHT;
	if (row.attachments.length > 0) h += ATTACH_HEIGHT;
	return h;
}

// ─── Sample data ─────────────────────────────────────────────────────────────

const ASSIGNEES = [
	{ name: 'Alice Chen', initials: 'AC', color: '#6366f1' },
	{ name: 'Bob Smith', initials: 'BS', color: '#f59e0b' },
	{ name: 'Carol Ng', initials: 'CN', color: '#10b981' },
	{ name: 'David Kim', initials: 'DK', color: '#f43f5e' },
	{ name: 'Eva Torres', initials: 'ET', color: '#8b5cf6' },
	{ name: 'Frank Lee', initials: 'FL', color: '#06b6d4' },
];

function pick<T>(arr: T[], seed: number): T {
	return arr[seed % arr.length];
}

const RAW_CARDS: Omit<KanbanCard, 'id'>[] = [
	{
		title: 'Redesign authentication flow',
		description: 'Replace legacy OAuth with PKCE. Update session management and add MFA support across all entry points.',
		status: 'In Progress',
		priority: 'Critical',
		progress: 68,
		assignee: ASSIGNEES[0],
		tags: ['Auth', 'Security', 'Backend'],
		attachments: [
			{ name: 'spec.pdf', type: 'pdf' },
			{ name: 'wireframes.fig', type: 'figma' },
		],
		dueDate: '2025-06-20',
		storyPoints: 13,
		epic: 'Identity & Access',
	},
	{
		title: 'Fix memory leak in chart renderer',
		description: 'Canvas contexts not disposed on unmount. Profiler shows 400 MB growth over 2-hour session.',
		status: 'Blocked',
		priority: 'Critical',
		progress: 20,
		assignee: ASSIGNEES[1],
		tags: ['Performance', 'Charts', 'React'],
		attachments: [{ name: 'heap-snapshot.zip', type: 'zip' }],
		dueDate: '2025-06-15',
		storyPoints: 8,
		epic: 'Data Visualization',
	},
	{
		title: 'Implement dark mode tokens',
		description: '',
		status: 'Review',
		priority: 'Medium',
		progress: 90,
		assignee: ASSIGNEES[2],
		tags: ['Design', 'CSS'],
		attachments: [
			{ name: 'tokens.fig', type: 'figma' },
			{ name: 'theme.ts', type: 'code' },
		],
		dueDate: '2026-07-10',
		storyPoints: 5,
		epic: 'Design System',
	},
	{
		title: 'Grid virtual scroll — variable row heights',
		description:
			'Support getRowHeight callback in client row model. Pipeline must compile per-row heights before geometry. Freeze-in-place snapshot guard for frozenHtml height mismatch.',
		status: 'In Progress',
		priority: 'High',
		progress: 55,
		assignee: ASSIGNEES[3],
		tags: ['Grid', 'Performance', 'Rendering', 'Geometry'],
		attachments: [
			{ name: 'arch.pdf', type: 'pdf' },
			{ name: 'bench.code', type: 'code' },
		],
		dueDate: '2026-07-15',
		storyPoints: 21,
		epic: 'Grid Platform',
	},
	{
		title: 'CSV bulk import pipeline',
		description: 'Stream large CSV files through validation, dedup, and upsert. Target: 500k rows in under 30s.',
		status: 'Backlog',
		priority: 'High',
		progress: 0,
		assignee: ASSIGNEES[4],
		tags: ['ETL', 'Backend'],
		attachments: [],
		dueDate: '2026-08-01',
		storyPoints: 13,
		epic: 'Data Platform',
	},
	{
		title: 'Add E2E smoke tests',
		description: '',
		status: 'Backlog',
		priority: 'Low',
		progress: 0,
		assignee: ASSIGNEES[5],
		tags: ['Testing', 'CI'],
		attachments: [{ name: 'plan.doc', type: 'doc' }],
		dueDate: '2026-09-01',
		storyPoints: 3,
		epic: 'Quality',
	},
	{
		title: 'Real-time collaboration cursors',
		description: 'Show peer cursors and selections over WebSocket. Conflict resolution via CRDT merge on cell-value writes.',
		status: 'In Progress',
		priority: 'High',
		progress: 42,
		assignee: ASSIGNEES[0],
		tags: ['Real-time', 'WebSocket', 'CRDT'],
		attachments: [{ name: 'collab-spec.pdf', type: 'pdf' }],
		dueDate: '2026-07-30',
		storyPoints: 34,
		epic: 'Collaboration',
	},
	{
		title: 'Storybook component catalogue',
		description: '',
		status: 'Done',
		priority: 'Low',
		progress: 100,
		assignee: ASSIGNEES[2],
		tags: ['Docs'],
		attachments: [],
		dueDate: '2026-06-01',
		storyPoints: 5,
		epic: 'Design System',
	},
	{
		title: 'WCAG 2.1 AA audit & remediation',
		description: 'Fix 23 failing contrast issues, add ARIA landmarks, keyboard trap fixes for modal dialogs.',
		status: 'Review',
		priority: 'High',
		progress: 78,
		assignee: ASSIGNEES[1],
		tags: ['Accessibility', 'WCAG', 'UX'],
		attachments: [
			{ name: 'audit.pdf', type: 'pdf' },
			{ name: 'fixes.code', type: 'code' },
		],
		dueDate: '2026-07-05',
		storyPoints: 8,
		epic: 'Accessibility',
	},
	{
		title: 'Rate limiting middleware',
		description: 'Token bucket per IP and per user. Redis-backed with 1-second resolution.',
		status: 'Done',
		priority: 'Medium',
		progress: 100,
		assignee: ASSIGNEES[3],
		tags: ['Backend', 'Security'],
		attachments: [],
		dueDate: '2026-05-20',
		storyPoints: 5,
		epic: 'Infrastructure',
	},
	{
		title: 'Plugin API public interface',
		description: 'Stable plugin manifest schema, lifecycle hooks, and sandboxed renderer access. Breaking change gated behind feature flag.',
		status: 'Backlog',
		priority: 'Medium',
		progress: 5,
		assignee: ASSIGNEES[4],
		tags: ['SDK', 'API', 'Breaking'],
		attachments: [{ name: 'rfc.doc', type: 'doc' }],
		dueDate: '2026-09-15',
		storyPoints: 21,
		epic: 'Platform SDK',
	},
	{
		title: 'Deprecate REST v1 endpoints',
		description: '',
		status: 'In Progress',
		priority: 'Medium',
		progress: 60,
		assignee: ASSIGNEES[5],
		tags: ['API', 'Deprecation'],
		attachments: [{ name: 'migration.doc', type: 'doc' }],
		dueDate: '2026-08-15',
		storyPoints: 3,
		epic: 'API Governance',
	},
	{
		title: 'Search index rebuild — Elasticsearch 8',
		description: 'Migrate mappings, update analyzers for multilingual support, zero-downtime reindex via dual-write.',
		status: 'In Progress',
		priority: 'High',
		progress: 35,
		assignee: ASSIGNEES[0],
		tags: ['Search', 'Elasticsearch', 'Migration'],
		attachments: [
			{ name: 'mapping.json', type: 'code' },
			{ name: 'runbook.doc', type: 'doc' },
		],
		dueDate: '2026-07-25',
		storyPoints: 13,
		epic: 'Search Platform',
	},
	{
		title: 'Mobile responsive grid layout',
		description: '',
		status: 'Review',
		priority: 'Medium',
		progress: 88,
		assignee: ASSIGNEES[2],
		tags: ['Mobile', 'Responsive', 'CSS'],
		attachments: [{ name: 'breakpoints.fig', type: 'figma' }],
		dueDate: '2026-07-08',
		storyPoints: 8,
		epic: 'Mobile',
	},
	{
		title: 'Monorepo CI pipeline optimisation',
		description: 'Introduce affected-package detection to skip unchanged packages. Target: 60% reduction in avg CI time.',
		status: 'Done',
		priority: 'Low',
		progress: 100,
		assignee: ASSIGNEES[5],
		tags: ['CI/CD', 'DevEx', 'Nx'],
		attachments: [],
		dueDate: '2026-06-10',
		storyPoints: 5,
		epic: 'Developer Experience',
	},
];

const ROWS: KanbanCard[] = RAW_CARDS.map((c, i) => ({ ...c, id: String(i + 1) }));

// ─── Cell renderers ───────────────────────────────────────────────────────────

function TitleCell({ row }: CellRendererProps<KanbanCard>) {
	const p = PRIORITY_META[row.priority];
	return (
		<div className='flex flex-col justify-start gap-1.5 px-3 py-2.5'>
			<div className='flex items-center gap-2 min-w-0'>
				<span
					className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${p.bg} ${p.color}`}
				>
					<span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
					{row.priority}
				</span>
				<span className='truncate text-[12px] font-semibold text-slate-100'>{row.title}</span>
			</div>
			{row.description && <p className='line-clamp-3 text-[11px] leading-[1.6] text-slate-400'>{row.description}</p>}
			{row.tags.length > 0 && (
				<div className='flex flex-wrap gap-1'>
					{row.tags.map((t) => (
						<span key={t} className={`rounded border px-1.5 py-px text-[10px] font-semibold ${tagColor(t)}`}>
							{t}
						</span>
					))}
				</div>
			)}
			{row.attachments.length > 0 && (
				<div className='flex items-center gap-1.5'>
					{row.attachments.map((a, i) => (
						<span
							key={i}
							className='flex items-center gap-0.5 rounded bg-slate-800/60 px-1.5 py-px text-[9px] text-slate-400 border border-slate-700/50'
						>
							{FILE_ICONS[a.type]} <span className='max-w-[60px] truncate'>{a.name}</span>
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function AssigneeCell({ row }: CellRendererProps<KanbanCard>) {
	const a = row.assignee;
	return (
		<div className='flex h-full items-center justify-center px-2'>
			<div
				className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-md ring-2 ring-slate-900'
				style={{ backgroundColor: a.color }}
				title={a.name}
			>
				{a.initials}
			</div>
		</div>
	);
}

function StatusCell({ row }: CellRendererProps<KanbanCard>) {
	const s = STATUS_META[row.status];
	return (
		<div className='flex h-full items-center px-2'>
			<span
				className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${s.color} bg-slate-800/60 border border-slate-700/50`}
			>
				<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
				{s.label}
			</span>
		</div>
	);
}

function ProgressCell({ row }: CellRendererProps<KanbanCard>) {
	const r = 14;
	const circ = 2 * Math.PI * r;
	const pct = Math.min(100, Math.max(0, row.progress));
	const offset = circ * (1 - pct / 100);
	const color = pct === 100 ? '#10b981' : pct >= 70 ? '#6366f1' : pct >= 40 ? '#f59e0b' : '#f43f5e';
	return (
		<div className='flex h-full items-center justify-center px-2'>
			<div className='relative flex h-9 w-9 items-center justify-center'>
				<svg className='-rotate-90' width='36' height='36' viewBox='0 0 36 36'>
					<circle cx='18' cy='18' r={r} fill='none' stroke='#1e293b' strokeWidth='4' />
					<circle
						cx='18'
						cy='18'
						r={r}
						fill='none'
						stroke={color}
						strokeWidth='4'
						strokeDasharray={circ}
						strokeDashoffset={offset}
						strokeLinecap='round'
						style={{ transition: 'stroke-dashoffset 0.4s ease' }}
					/>
				</svg>
				<span className='absolute text-[8px] font-bold text-slate-300'>{pct}</span>
			</div>
		</div>
	);
}

function PointsCell({ row }: CellRendererProps<KanbanCard>) {
	return (
		<div className='flex h-full items-center justify-center px-2'>
			<span className='flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-300 ring-1 ring-slate-700'>
				{row.storyPoints}
			</span>
		</div>
	);
}

function DueDateCell({ row }: CellRendererProps<KanbanCard>) {
	const overdue = isOverdue(row.dueDate) && row.status !== 'Done';
	const d = new Date(row.dueDate);
	const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
	return (
		<div className='flex h-full items-center px-2'>
			<span
				className={`rounded px-2 py-0.5 text-[10px] font-semibold ${overdue ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30' : 'bg-slate-800/60 text-slate-400 border border-slate-700/40'}`}
			>
				{overdue && '⚠ '}
				{label}
			</span>
		</div>
	);
}

function EpicCell({ row }: CellRendererProps<KanbanCard>) {
	return (
		<div className='flex h-full items-center px-2 overflow-hidden'>
			<span
				className='truncate rounded bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 border border-violet-500/20'
				title={row.epic}
			>
				{row.epic}
			</span>
		</div>
	);
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: ColumnDef<KanbanCard>[] = [
	{
		field: 'title',
		header: 'Card',
		width: 440,
		minWidth: 260,
		renderer: { kind: 'react', component: TitleCell, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
	{
		field: 'status',
		header: 'Status',
		width: 130,
		renderer: { kind: 'react', component: StatusCell, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
	{
		field: 'assignee',
		header: 'Owner',
		width: 70,
		renderer: { kind: 'react', component: AssigneeCell, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
	{
		field: 'progress',
		header: '%',
		width: 70,
		renderer: { kind: 'react', component: ProgressCell, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
	{
		field: 'storyPoints',
		header: 'Pts',
		width: 60,
		renderer: { kind: 'react', component: PointsCell, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
	{
		field: 'dueDate',
		header: 'Due',
		width: 100,
		renderer: { kind: 'react', component: DueDateCell, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
	{
		field: 'epic',
		header: 'Epic',
		width: 160,
		renderer: { kind: 'react', component: EpicCell, capabilities: { scrollPresentation: 'html-snapshot' } },
	},
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
	onGridReady?: (event: GridReadyEvent<KanbanCard>) => void;
	pinLeftColumns?: number;
	pinRightColumns?: number;
}

type HeightMode = 'getRowHeight' | 'autoRowHeight';

const MODE_META: Record<HeightMode, { label: string; badge: string; description: string }> = {
	getRowHeight: {
		label: 'getRowHeight',
		badge: 'Pre-computed',
		description:
			'Heights are computed from row data before geometry — zero DOM measurement, no initial flash. ' +
			'Requires manual math that must stay in sync with cell content.',
	},
	autoRowHeight: {
		label: 'autoRowHeight',
		badge: 'DOM-measured',
		description:
			"Rows render at defaultRowHeight first, then each cell's scrollHeight is measured and fed back into geometry. " +
			'No manual math — content changes are reflected automatically, at the cost of a two-pass render.',
	},
};

export default function KanbanBoardDemo({ onGridReady, pinLeftColumns = 0, pinRightColumns = 0 }: Props) {
	const [api, setApi] = useState<GridApi<KanbanCard> | null>(null);
	const [heightMode, setHeightMode] = useState<HeightMode>('getRowHeight');
	const [stats, setStats] = useState({ total: ROWS.length, byStatus: {} as Record<string, number> });

	const getRowHeight = useCallback((row: KanbanCard) => computeCardHeight(row), []);

	const handleGridReady = useCallback(
		(event: GridReadyEvent<KanbanCard>) => {
			setApi(event.api);
			onGridReady?.(event);
		},
		[onGridReady]
	);

	useMemo(() => {
		const byStatus: Record<string, number> = {};
		for (const row of ROWS) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
		setStats({ total: ROWS.length, byStatus });
	}, []);

	const modeMeta = MODE_META[heightMode];

	return (
		<div className='flex h-full min-h-0 flex-col gap-3'>
			{/* Header stats + mode toggle */}
			<div className='flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-900 bg-slate-900/30 px-4 py-2.5'>
				<span className='mr-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>Sprint Board</span>
				{Object.entries(STATUS_META).map(([status, meta]) => {
					const count = stats.byStatus[status] ?? 0;
					if (!count) return null;
					return (
						<span
							key={status}
							className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${meta.color} bg-slate-900/60 border-slate-700/50`}
						>
							<span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
							{status} · {count}
						</span>
					);
				})}
				{/* Mode toggle */}
				<div className='ml-auto flex items-center gap-1 rounded-lg border border-slate-700/40 bg-slate-800/40 p-0.5'>
					{(Object.keys(MODE_META) as HeightMode[]).map((mode) => (
						<button
							key={mode}
							onClick={() => setHeightMode(mode)}
							className={`rounded px-2.5 py-1 text-[10px] font-semibold transition-colors ${
								heightMode === mode
									? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
									: 'text-slate-500 hover:text-slate-300 border border-transparent'
							}`}
						>
							{MODE_META[mode].label}
						</button>
					))}
				</div>
			</div>

			{/* Grid — key forces remount when mode changes (both props are initial-only) */}
			<div className='min-h-0 flex-1'>
				{heightMode === 'getRowHeight' ? (
					<Grid<KanbanCard>
						key='getRowHeight'
						rowModelType='client'
						rows={ROWS}
						columns={COLUMNS}
						getRowId={(r) => r.id}
						getRowHeight={getRowHeight}
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						onGridReady={handleGridReady}
						initialState={{ defaultColWidth: 120 }}
					/>
				) : (
					<Grid<KanbanCard>
						key='autoRowHeight'
						rowModelType='client'
						rows={ROWS}
						columns={COLUMNS}
						getRowId={(r) => r.id}
						autoRowHeight
						pinLeftColumns={pinLeftColumns}
						pinRightColumns={pinRightColumns}
						onGridReady={handleGridReady}
						initialState={{ defaultColWidth: 120, defaultRowHeight: 80 }}
					/>
				)}
			</div>

			{/* Legend */}
			<div className='flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-slate-800/60 bg-slate-900/20 px-3 py-2 text-[10px] text-slate-500'>
				<span
					className={`shrink-0 rounded border px-1.5 py-px font-bold text-[9px] uppercase tracking-wider ${
						heightMode === 'getRowHeight'
							? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
							: 'bg-violet-500/10 text-violet-400 border-violet-500/20'
					}`}
				>
					{modeMeta.badge}
				</span>
				<span>{modeMeta.description}</span>
			</div>
		</div>
	);
}
