/**
 * The record workspace: one engineering roadmap as a table, a gallery, a calendar, a Kanban board
 * and a Gantt schedule. Every view reads the same records (roles are set once below), writes
 * through the same pipeline (undo works across views), and shares selection, the focused record and
 * the inspector, so switching views keeps your place.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
	Grid,
	currencyColumnType,
	dateColumnType,
	dateRangeColumnType,
	longTextColumnType,
	multiSelectColumnType,
	numberColumnType,
	personColumnType,
	progressColumnType,
	selectColumnType,
	checkboxColumnType,
	createLocalStorageWorkspaceAdapter,
	type ColumnDef,
	type GridApi,
	type GridReadyEvent,
	type GridWorkspaceOptions,
	type RecordComment,
	type BuiltInThemeName,
} from '@eregister/wit-grid-react';
import { startTeammates } from './simulatedTeammates';

export interface RoadmapTask {
	id: string;
	key: string;
	title: string;
	status: string;
	priority: string;
	team: string;
	owner: string;
	labels: string[];
	due: string;
	schedule: { start: string; end: string };
	baseline: { start: string; end: string };
	estimate: number;
	budget: number;
	progress: number;
	parent: string | null;
	dependsOn: string[];
	milestone: boolean;
	cover: string;
	description: string;
}

// ─── Vocabulary ───────────────────────────────────────────────────────────────

const STATUS = [
	{ value: 'backlog', label: 'Backlog', color: 'gray' },
	{ value: 'todo', label: 'To do', color: 'blue' },
	{ value: 'doing', label: 'In progress', color: 'amber' },
	{ value: 'review', label: 'In review', color: 'violet' },
	{ value: 'done', label: 'Done', color: 'green' },
];
const PRIORITY = [
	{ value: 'urgent', label: 'Urgent', color: 'red' },
	{ value: 'high', label: 'High', color: 'orange' },
	{ value: 'medium', label: 'Medium', color: 'amber' },
	{ value: 'low', label: 'Low', color: 'gray' },
];
const TEAMS = [
	{ value: 'FE', label: 'Frontend', color: 'blue' },
	{ value: 'BE', label: 'Backend', color: 'emerald' },
	{ value: 'DS', label: 'Design', color: 'fuchsia' },
	{ value: 'PL', label: 'Platform', color: 'orange' },
];
const PEOPLE = [
	{ value: 'ava', label: 'Ava Chen', color: 'blue' },
	{ value: 'liam', label: 'Liam Novak', color: 'teal' },
	{ value: 'noah', label: 'Noah Patel', color: 'green' },
	{ value: 'mia', label: 'Mia Rossi', color: 'violet' },
	{ value: 'ethan', label: 'Ethan Brooks', color: 'orange' },
	{ value: 'zoe', label: 'Zoe Okafor', color: 'rose' },
	{ value: 'sofia', label: 'Sofia Lind', color: 'amber' },
	{ value: 'leo', label: 'Leo Park', color: 'cyan' },
];
const LABELS = [
	{ value: 'Settings', color: 'blue' },
	{ value: 'UI/UX', color: 'violet' },
	{ value: 'Accessibility', color: 'purple' },
	{ value: 'Performance', color: 'emerald' },
	{ value: 'Security', color: 'red' },
	{ value: 'API', color: 'sky' },
	{ value: 'Infra', color: 'orange' },
	{ value: 'Docs', color: 'gray' },
];

const EPICS: { title: string; team: string; tasks: string[] }[] = [
	{
		title: 'Planning & research',
		team: 'DS',
		tasks: ['Market research', 'Competitive analysis', 'Define positioning', 'Stakeholder alignment', 'Research complete'],
	},
	{
		title: 'Design system v3',
		team: 'DS',
		tasks: ['Information architecture', 'Wireframes', 'Visual design', 'Design tokens', 'Icon library update', 'Dark mode for settings'],
	},
	{
		title: 'Frontend platform',
		team: 'FE',
		tasks: [
			'Fix flaky checkout test',
			'Harden file uploads',
			'Audit color contrast',
			'Implement dark mode',
			'Redesign onboarding flow',
			'Optimize image pipeline',
			'Keyboard navigation pass',
		],
	},
	{
		title: 'Backend services',
		team: 'BE',
		tasks: [
			'Improve query performance',
			'Add rate limiting',
			'Rebuild CSV importer',
			'Audit logging v2',
			'Database migration',
			'Migrate auth to OAuth 2.1',
			'Webhooks retry policy',
		],
	},
	{
		title: 'Platform & infra',
		team: 'PL',
		tasks: ['Kubernetes upgrade', 'Observability dashboards', 'Cost allocation tags', 'Disaster recovery drill', 'Edge cache rollout'],
	},
	{ title: 'Testing & QA', team: 'FE', tasks: ['Test plan', 'Functional testing', 'Performance testing', 'Security review', 'Cross-browser QA'] },
	{ title: 'Launch & go-to-market', team: 'DS', tasks: ['Marketing site refresh', 'Product announcement', 'Sales enablement', 'Launch'] },
];

const DESCRIPTIONS = [
	'Add dark mode support for the settings area, including a theme toggle, persistence and accessibility improvements.',
	'Review and improve colour contrast across the product to meet WCAG 2.1 AA. Focus on primary buttons, form components and data visualisations.',
	'Remove the race in the checkout flow that makes the end-to-end test fail one run in twenty.',
	'Move session handling to OAuth 2.1 with PKCE everywhere; retire the legacy implicit flow.',
	'Batch the importer so 100k-row files stream through validation without blocking the UI.',
];

// ─── Data ─────────────────────────────────────────────────────────────────────

/** A deterministic pseudo-random sequence, so the roadmap looks the same on every load. */
function random(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return seed / 4294967296;
	};
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addWorkdays(date: Date, days: number): Date {
	const d = new Date(date);
	let left = days;
	while (left > 0) {
		d.setDate(d.getDate() + 1);
		if (d.getDay() !== 0 && d.getDay() !== 6) left--;
	}
	return d;
}
const nextWorkday = (date: Date) => addWorkdays(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1), 1);

/** A generated cover: a soft gradient with a few shapes (offline, deterministic). */
function coverFor(seed: number, hue: number): string {
	const r = random(seed);
	const a = `hsl(${hue} 80% 55%)`;
	const b = `hsl(${(hue + 60 + r() * 80) % 360} 75% 45%)`;
	const shapes = Array.from({ length: 4 }, () => {
		const x = Math.round(r() * 320);
		const y = Math.round(r() * 160);
		const s = Math.round(30 + r() * 90);
		return `<circle cx='${x}' cy='${y}' r='${s}' fill='white' fill-opacity='${(0.05 + r() * 0.12).toFixed(2)}'/>`;
	}).join('');
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 160'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='320' height='160' fill='url(#g)'/>${shapes}<path d='M0 ${110 + r() * 30} Q 160 ${40 + r() * 60} 320 ${90 + r() * 40} V160 H0 Z' fill='black' fill-opacity='.18'/></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function generateRoadmap(total = 200): RoadmapTask[] {
	const r = random(42);
	const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
	const tasks: RoadmapTask[] = [];
	let n = 1000;
	// The plan started about ten weeks ago (on a Monday), so there is history, work in flight and a future.
	const today = new Date();
	const projectStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 70 - ((today.getDay() + 6) % 7));
	// Real plans are noisy: some work finishes late, some starts early.
	const statusFor = (start: Date, end: Date) => {
		const x = r();
		if (end < today) return x < 0.78 ? 'done' : x < 0.9 ? 'review' : 'doing';
		if (start <= today) return x < 0.65 ? 'doing' : 'review';
		const ahead = (start.getTime() - today.getTime()) / 86_400_000;
		if (ahead < 12) return x < 0.35 ? 'doing' : x < 0.85 ? 'todo' : 'backlog';
		return x < 0.35 ? 'todo' : 'backlog';
	};
	let cursor = new Date(projectStart);
	let epicIndex = 0;
	while (tasks.length < total) {
		const epic = EPICS[epicIndex % EPICS.length];
		const round = Math.floor(epicIndex / EPICS.length);
		epicIndex++;
		const epicId = `T-${n++}`;
		const epicTitle = round ? `${epic.title} ${round + 1}` : epic.title;
		const epicRow: RoadmapTask = {
			id: epicId,
			key: epicId,
			title: epicTitle,
			status: 'todo',
			priority: 'high',
			team: epic.team,
			owner: pick(PEOPLE).value,
			labels: [],
			due: '',
			schedule: { start: '', end: '' },
			baseline: { start: '', end: '' },
			estimate: 0,
			budget: 0,
			progress: 0,
			parent: null,
			dependsOn: [],
			milestone: false,
			cover: coverFor(n, 200 + epicIndex * 37),
			description: `Everything for ${epicTitle.toLowerCase()}.`,
		};
		tasks.push(epicRow);
		let start = nextWorkday(new Date(cursor));
		let previous: string | null = null;
		const children: RoadmapTask[] = [];
		for (const [i, name] of epic.tasks.entries()) {
			if (tasks.length + children.length >= total) break;
			const id = `T-${n++}`;
			const milestone = name === 'Launch' || name === 'Research complete';
			const duration = milestone ? 0 : 2 + Math.floor(r() * 7);
			const overlap = previous && r() < 0.3;
			const taskStart = overlap ? addWorkdays(start, -Math.min(2, duration)) : start;
			const end = milestone ? taskStart : addWorkdays(taskStart, Math.max(0, duration - 1));
			const slip = r() < 0.35 ? Math.floor(r() * 4) : 0;
			const baseEnd = addWorkdays(new Date(end), 0);
			baseEnd.setDate(baseEnd.getDate() - slip);
			const status = statusFor(taskStart, end);
			const progress =
				status === 'done' ? 100 : status === 'review' ? 80 + Math.floor(r() * 15) : status === 'doing' ? 20 + Math.floor(r() * 60) : 0;
			const title = round ? `${name} #${round + 1}` : name;
			const labels = [pick(LABELS).value, ...(r() < 0.4 ? [pick(LABELS).value] : [])].filter((v, idx, all) => all.indexOf(v) === idx);
			children.push({
				id,
				key: id,
				title,
				status,
				priority: milestone ? 'high' : pick(PRIORITY).value,
				team: r() < 0.8 ? epic.team : pick(TEAMS).value,
				owner: pick(PEOPLE).value,
				labels,
				due: iso(end),
				schedule: { start: iso(taskStart), end: iso(end) },
				baseline: { start: iso(taskStart), end: iso(baseEnd < taskStart ? taskStart : baseEnd) },
				estimate: Math.max(1, duration),
				budget: milestone ? 0 : Math.round((4000 + r() * 52000) / 100) * 100,
				progress,
				parent: epicId,
				dependsOn: previous && !overlap ? [previous] : previous ? [`${previous}SS+1d`] : [],
				milestone,
				cover: coverFor(n * 7, (i * 47 + epicIndex * 61) % 360),
				description: pick(DESCRIPTIONS),
			});
			previous = id;
			start = nextWorkday(addWorkdays(end, 1));
		}
		tasks.push(...children);
		// Epics overlap: the next starts part-way through this one.
		cursor = addWorkdays(cursor, 2 + Math.floor(r() * 4));
	}
	// The launch waits on QA; QA waits on the backend.
	const byTitle = (title: string) => tasks.find((task) => task.title === title);
	const launch = byTitle('Launch');
	const qa = byTitle('Cross-browser QA');
	if (launch && qa && !launch.dependsOn.includes(qa.id)) launch.dependsOn.push(qa.id);
	return tasks;
}

// ─── Columns ──────────────────────────────────────────────────────────────────

const COLUMNS: ColumnDef<RoadmapTask>[] = [
	{ field: 'key', header: 'Key', width: 92 },
	{ field: 'title', header: 'Task', width: 260 },
	{ field: 'status', header: 'Status', width: 132, ...selectColumnType(STATUS) },
	{ field: 'priority', header: 'Priority', width: 112, ...selectColumnType(PRIORITY, { variant: 'dot' }) },
	{ field: 'owner', header: 'Owner', width: 160, ...personColumnType({ people: PEOPLE }) },
	{ field: 'team', header: 'Team', width: 120, ...selectColumnType(TEAMS) },
	{ field: 'labels', header: 'Labels', width: 180, ...multiSelectColumnType(LABELS) },
	{ field: 'schedule', header: 'Schedule', width: 200, ...dateRangeColumnType() },
	{ field: 'due', header: 'Due date', width: 120, ...dateColumnType() },
	{ field: 'progress', header: 'Progress', width: 140, ...progressColumnType() },
	{ field: 'estimate', header: 'Estimate (d)', width: 110, ...numberColumnType({ decimals: 0 }) },
	{ field: 'budget', header: 'Budget', width: 120, ...currencyColumnType({ decimals: 0 }) },
	{ field: 'dependsOn', header: 'Depends on', width: 140 },
	{ field: 'baseline', header: 'Baseline', width: 200, ...dateRangeColumnType() },
	{ field: 'milestone', header: 'Milestone', width: 100, ...checkboxColumnType() },
	{ field: 'parent', header: 'Parent', width: 100, hide: true },
	{ field: 'cover', header: 'Cover', width: 100, hide: true },
	{ field: 'description', header: 'Description', width: 280, ...longTextColumnType() },
];

// ─── Collaboration (an in-memory stand-in for the app's backend) ──────────────

function createCollaboration(rows: RoadmapTask[]) {
	const r = random(7);
	const people = PEOPLE.map((person) => ({ id: person.value, name: person.label, color: person.color }));
	const lines = [
		'Designs are ready for implementation. Focus on the new theme tokens and ensure contrast meets WCAG AA.',
		'Started work on the main components. Will push a draft PR by end of day tomorrow.',
		'Let’s also update the mobile settings screen in this task.',
		'Blocked on the API change — moving this to review once the endpoint lands.',
		'Perf numbers look good: p95 down 38% on the staging dataset.',
		'Can we split the migration into two releases? The rollback story is cleaner.',
	];
	const comments = new Map<string, RecordComment[]>();
	const files = new Map<string, number>();
	let seq = 0;
	for (const row of rows) {
		const count = r() < 0.55 ? Math.floor(r() * 6) : 0;
		comments.set(
			row.id,
			Array.from({ length: count }, (_, i) => ({
				id: `c${++seq}`,
				author: people[Math.floor(r() * people.length)],
				body: lines[Math.floor(r() * lines.length)],
				createdAt: Date.now() - (count - i) * 3_600_000 * (2 + r() * 20),
				reactions: r() < 0.4 ? [{ emoji: '👍', count: 1 + Math.floor(r() * 4) }] : undefined,
			}))
		);
		files.set(row.id, r() < 0.5 ? Math.floor(r() * 8) : 0);
	}
	const listeners = new Set<(id: string) => void>();
	const me = { id: 'you', name: 'You', color: 'indigo' };
	return {
		me,
		counts: (id: string) => ({ comments: comments.get(id)?.length, files: files.get(id) }),
		listComments: (id: string) => [...(comments.get(id) ?? [])].reverse(),
		addComment: (id: string, body: string) => {
			const comment: RecordComment = { id: `c${++seq}`, author: me, body, createdAt: Date.now() };
			comments.set(id, [...(comments.get(id) ?? []), comment]);
			listeners.forEach((listener) => listener(id));
			return comment;
		},
		listFiles: (id: string) =>
			Array.from({ length: files.get(id) ?? 0 }, (_, i) => ({
				id: `${id}-f${i}`,
				name: ['spec.pdf', 'mockups.fig', 'notes.md', 'trace.json', 'screenshot.png'][i % 5],
				size: 20_000 + i * 48_000,
			})),
		subscribe: (listener: (id: string) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export interface RecordWorkspaceDemoProps {
	onGridReady?: (event: GridReadyEvent<RoadmapTask>) => void;
	theme?: BuiltInThemeName;
}

export default function RecordWorkspaceDemo({ onGridReady, theme = 'dark' }: RecordWorkspaceDemoProps) {
	const rows = useMemo(() => generateRoadmap(200), []);
	const [api, setApi] = useState<GridApi<RoadmapTask> | null>(null);
	const initialState = useMemo(() => ({ themeName: theme }), []); // eslint-disable-line react-hooks/exhaustive-deps
	const nextId = useRef(2000);
	const workspace = useMemo<GridWorkspaceOptions<RoadmapTask>>(
		() => ({
			title: 'Engineering roadmap',
			// What the fields mean — once, for every view.
			records: {
				title: 'title',
				key: 'key',
				status: 'status',
				priority: 'priority',
				owner: 'owner',
				team: 'team',
				labels: 'labels',
				schedule: 'schedule',
				baseline: 'baseline',
				due: 'due',
				progress: 'progress',
				estimate: 'estimate',
				value: 'budget',
				parent: 'parent',
				dependencies: 'dependsOn',
				milestone: 'milestone',
				cover: 'cover',
				description: 'description',
			},
			views: [
				{ id: 'table', name: 'Table', view: null },
				{ id: 'gallery', name: 'Gallery', view: { kind: 'gallery', layout: 'medium' } },
				{ id: 'calendar', name: 'Calendar', view: { kind: 'calendar' } },
				{ id: 'kanban', name: 'Kanban', view: { kind: 'kanban', swimlaneField: 'team', wipLimits: { doing: 24, review: 16 } } },
				{ id: 'gantt', name: 'Gantt', view: { kind: 'gantt', zoom: 'week', criticalPath: true } },
			],
			collaboration: createCollaboration(rows),
			// Views made with + are kept here, personal or shared with the team, and show as tabs.
			savedViews: createLocalStorageWorkspaceAdapter({ storageKey: 'record-workspace-demo' }),
			createRecord: (values) => {
				const id = `T-${nextId.current++}`;
				const today = new Date();
				const end = addWorkdays(today, 4);
				return {
					id,
					key: id,
					title: 'New task',
					status: 'todo',
					priority: 'medium',
					team: 'FE',
					owner: 'ava',
					labels: [],
					due: iso(end),
					schedule: { start: iso(nextWorkday(today)), end: iso(end) },
					baseline: { start: iso(nextWorkday(today)), end: iso(end) },
					estimate: 5,
					budget: 0,
					progress: 0,
					parent: null,
					dependsOn: [],
					milestone: false,
					cover: coverFor(nextId.current, (nextId.current * 53) % 360),
					description: '',
					...(values as Partial<RoadmapTask>),
				};
			},
		}),
		[rows]
	);

	// The grid starts on `theme`; later changes (a host's theme picker) switch it in place.
	useEffect(() => {
		if (api && api.getThemeName() !== theme) api.switchTheme(theme);
	}, [api, theme]);

	// Teammates move between records and land edits: their rings show on cards and bars.
	useEffect(() => {
		if (!api) return;
		return startTeammates(api, {
			edits: {
				progress: (value) => Math.min(100, Number(value) + 10),
				priority: () => PRIORITY[Math.floor(Math.random() * PRIORITY.length)].value,
			},
		});
	}, [api]);

	return (
		<div style={{ height: '100%', width: '100%', minHeight: 0, minWidth: 0 }}>
			<Grid<RoadmapTask>
				rowModelType='client'
				rows={rows}
				columns={COLUMNS}
				getRowId={(row) => row.id}
				initialState={initialState}
				rowSelection='multiple'
				pinLeftColumns={2}
				workspace={workspace}
				onGridReady={(event) => {
					setApi(event.api);
					onGridReady?.(event);
				}}
			/>
		</div>
	);
}
