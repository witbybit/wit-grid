/**
 * Workspace Views Demo — named views layered on top of the Advanced Filters showcase.
 *
 * Demonstrates:
 *  • FakeAsyncWorkspaceAdapter: simulates real network latency on every adapter call
 *  • Pre-seeded system / team / personal views with embedded filter & sort state
 *  • Live workspace state subscription → active-view bar, dirty indicator
 *  • Per-operation event log fed by GridEventName.view* events
 *  • Error injection to show the panel's error state
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Grid,
	GridEventName,
	type ColumnDef,
	type GridApi,
	type GridReadyEvent,
	type FilterModel,
	type ColumnFilterDef,
	type FilterFetchParams,
	type FilterFetchResult,
	type FilterPageParams,
	type FilterPageResult,
	type CustomFilterRendererParams,
	type SelectFilterCondition,
	type GridWorkspaceAdapter,
	type GridViewDefinition,
	type GridWorkspaceState,
	type PersistedGridState,
} from '@eregister/wit-grid-react';

// ── Row type ──────────────────────────────────────────────────────────────────

interface EmployeeRow {
	id: string;
	name: string;
	department: string;
	location: string;
	status: 'Active' | 'On Leave' | 'Contractor' | 'Alumni';
	level: 'IC1' | 'IC2' | 'IC3' | 'IC4' | 'IC5' | 'M1' | 'M2' | 'M3';
	salary: number;
	startDate: string;
	skills: string;
}

// ── Data ──────────────────────────────────────────────────────────────────────

const DEPARTMENTS = ['Engineering', 'Product', 'Design', 'Marketing', 'Sales', 'Finance', 'Operations', 'HR', 'Legal', 'Support'];
const LOCATIONS = ['San Francisco', 'New York', 'London', 'Berlin', 'Singapore', 'Toronto', 'Austin', 'Remote'];
const STATUSES: EmployeeRow['status'][] = ['Active', 'On Leave', 'Contractor', 'Alumni'];
const LEVELS: EmployeeRow['level'][] = ['IC1', 'IC2', 'IC3', 'IC4', 'IC5', 'M1', 'M2', 'M3'];
const NAMES = [
	'Alice Chen',
	'Bob Martinez',
	'Carol Smith',
	'David Kim',
	'Emma Wilson',
	'Frank Lee',
	'Grace Park',
	'Henry Brown',
	'Iris Davis',
	'Jake Thompson',
	'Kate Anderson',
	'Liam Johnson',
	'Maya Patel',
	'Noah Williams',
	'Olivia Garcia',
	'Peter Zhang',
	'Quinn Rodriguez',
	'Rachel Torres',
	'Sam White',
	'Tara Nguyen',
];
const ALL_SKILLS = [
	'React',
	'TypeScript',
	'Python',
	'Go',
	'Rust',
	'SQL',
	'Figma',
	'Kubernetes',
	'AWS',
	'Machine Learning',
	'Data Analysis',
	'Product Strategy',
	'UX Research',
	'Copywriting',
	'SEO',
	'Finance',
	'Compliance',
	'Recruiting',
];

function generateEmployees(count: number): EmployeeRow[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `EMP-${String(i + 1).padStart(4, '0')}`,
		name: `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
		department: DEPARTMENTS[i % DEPARTMENTS.length],
		location: LOCATIONS[i % LOCATIONS.length],
		status: STATUSES[i % STATUSES.length],
		level: LEVELS[i % LEVELS.length],
		salary: 60000 + (i % 8) * 20000 + Math.floor(i / 3) * 500,
		startDate: new Date(2015 + (i % 10), (i * 3) % 12, (i % 28) + 1).toISOString().slice(0, 10),
		skills: ALL_SKILLS.slice((i * 3) % ALL_SKILLS.length, ((i * 3) % ALL_SKILLS.length) + 3).join(', '),
	}));
}

const ALL_ROWS = generateEmployees(200);

// ── Fake async helpers ────────────────────────────────────────────────────────

function fakeDelay<T>(ms: number, value: T): Promise<T> {
	return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// Jitter so operations feel like a real backend (not robotically uniform).
function jitter(base: number): number {
	return base + Math.floor(Math.random() * base * 0.4);
}

async function fetchDepartmentOptions(params: FilterFetchParams, signal: AbortSignal): Promise<FilterFetchResult<string>> {
	await fakeDelay(400, null);
	if (signal.aborted) return { options: [] };
	const q = params.query.toLowerCase();
	const matched = DEPARTMENTS.filter((d) => d.toLowerCase().includes(q));
	return {
		options: matched.map((d) => ({ label: d, value: d, count: ALL_ROWS.filter((r) => r.department === d).length })),
		totalCount: matched.length,
	};
}

async function fetchSkillsPage(params: FilterPageParams, signal: AbortSignal): Promise<FilterPageResult<string>> {
	await fakeDelay(300, null);
	if (signal.aborted) return { options: [], hasMore: false };
	const q = params.query.toLowerCase();
	const matched = ALL_SKILLS.filter((s) => s.toLowerCase().includes(q));
	const page = matched.slice(params.page * params.pageSize, (params.page + 1) * params.pageSize);
	return {
		options: page.map((s) => ({ label: s, value: s })),
		hasMore: (params.page + 1) * params.pageSize < matched.length,
		totalCount: matched.length,
	};
}

// ── Custom salary range filter ────────────────────────────────────────────────

function SalaryRangeFilter({ params }: { params: CustomFilterRendererParams }) {
	const current = params.value?.type === 'select' ? (params.value as SelectFilterCondition) : null;
	const [min, setMin] = useState(current ? String(current.values[0] ?? '') : '');
	const [max, setMax] = useState(current ? String(current.values[1] ?? '') : '');

	const commit = (minVal: string, maxVal: string) => {
		const minN = minVal ? Number(minVal) : null;
		const maxN = maxVal ? Number(maxVal) : null;
		if (minN === null && maxN === null) {
			params.onCommit(null);
			return;
		}
		params.onCommit({ type: 'select', values: [minN, maxN], labels: [`$${minVal || 0}–$${maxVal || '∞'}`] });
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
			<div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
				<input
					type='number'
					placeholder='Min salary'
					value={min}
					onChange={(e) => setMin(e.target.value)}
					onBlur={() => commit(min, max)}
					style={{
						flex: 1,
						height: 26,
						padding: '0 8px',
						fontSize: 11,
						background: '#1e293b',
						border: '1px solid #334155',
						borderRadius: 4,
						color: '#e2e8f0',
						outline: 'none',
					}}
				/>
				<span style={{ fontSize: 10, color: '#64748b' }}>–</span>
				<input
					type='number'
					placeholder='Max'
					value={max}
					onChange={(e) => setMax(e.target.value)}
					onBlur={() => commit(min, max)}
					style={{
						flex: 1,
						height: 26,
						padding: '0 8px',
						fontSize: 11,
						background: '#1e293b',
						border: '1px solid #334155',
						borderRadius: 4,
						color: '#e2e8f0',
						outline: 'none',
					}}
				/>
			</div>
			{current && (
				<button
					onClick={() => {
						setMin('');
						setMax('');
						params.onCommit(null);
					}}
					style={{ fontSize: 10, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
				>
					Clear
				</button>
			)}
		</div>
	);
}

// ── Column definitions ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
	Active: '#22c55e',
	'On Leave': '#f59e0b',
	Contractor: '#60a5fa',
	Alumni: '#94a3b8',
};

function makeColumns(): ColumnDef<EmployeeRow>[] {
	return [
		{ field: 'id', header: 'ID', width: 100, filterType: 'none' },
		{ field: 'name', header: 'Name', width: 180, filterType: 'text' },
		{
			field: 'department',
			header: 'Department',
			width: 160,
			filterDef: {
				type: 'async-multi-select',
				fetchOptions: fetchDepartmentOptions,
				placeholder: 'Search departments…',
				showSelectAll: true,
				debounceMs: 200,
			} satisfies ColumnFilterDef<EmployeeRow, string>,
		},
		{
			field: 'location',
			header: 'Location',
			width: 150,
			filterDef: { type: 'multi-select', options: LOCATIONS.map((l) => ({ label: l, value: l })), searchable: true } satisfies ColumnFilterDef<
				EmployeeRow,
				string
			>,
		},
		{
			field: 'status',
			header: 'Status',
			width: 130,
			renderer: {
				kind: 'react',
				component: ({ value }: { value: string }) => (
					<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
						<span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[value] ?? '#94a3b8', flexShrink: 0 }} />
						{value}
					</span>
				),
			},
			filterDef: { type: 'single-select', options: STATUSES.map((s) => ({ label: s, value: s })) } satisfies ColumnFilterDef<
				EmployeeRow,
				string
			>,
		},
		{
			field: 'level',
			header: 'Level',
			width: 100,
			filterDef: { type: 'multi-select', options: LEVELS.map((l) => ({ label: l, value: l })), showSelectAll: true } satisfies ColumnFilterDef<
				EmployeeRow,
				string
			>,
		},
		{
			field: 'salary',
			header: 'Salary',
			width: 130,
			valueFormatter: ({ value }) => `$${Number(value).toLocaleString()}`,
			filterDef: { type: 'custom', renderFilter: (params) => <SalaryRangeFilter params={params as any} /> } satisfies ColumnFilterDef<
				EmployeeRow,
				number
			>,
		},
		{ field: 'startDate', header: 'Start Date', width: 130, filterType: 'date' },
		{
			field: 'skills',
			header: 'Skills',
			width: 220,
			filterDef: {
				type: 'infinite-multi-select',
				fetchPage: fetchSkillsPage,
				pageSize: 6,
				placeholder: 'Search skills…',
				debounceMs: 150,
			} satisfies ColumnFilterDef<EmployeeRow, string>,
		},
	];
}

// ── Pre-seeded workspace views ────────────────────────────────────────────────
// v:2 matches the current GRID_STATE_SCHEMA_VERSION.
// Each view embeds a PersistedGridState with a real filter / sort model.

const _T = Date.now();

function makeView(
	id: string,
	name: string,
	description: string,
	scope: GridViewDefinition['scope'],
	filterModel: FilterModel | null,
	sortModel?: { colId: string; sort: 'asc' | 'desc' }[],
	themeName?: any
): GridViewDefinition {
	return {
		id,
		name,
		description,
		scope,
		createdAt: _T - 7_200_000,
		updatedAt: _T - 600_000,
		version: 1,
		state: {
			v: 2,
			state: {
				filterModel: filterModel ?? null,
				sortModel: sortModel ?? null,
				themeName,
			},
		} as PersistedGridState,
	};
}

const SEED_VIEWS: GridViewDefinition[] = [
	makeView(
		'eng-active',
		'Engineering · Active',
		'Current headcount in Engineering who are active employees',
		'system',
		{
			department: { type: 'select', values: ['Engineering'], labels: ['Engineering'] },
			status: { type: 'select', values: ['Active'], labels: ['Active'] },
		},
		[{ colId: 'salary', sort: 'desc' }],
		'dark'
	),
	makeView(
		'remote-team',
		'Remote Team',
		'All employees working remotely, sorted by level',
		'team',
		{ location: { type: 'select', values: ['Remote'], labels: ['Remote'] } },
		[{ colId: 'level', sort: 'asc' }],
		'spreadsheet'
	),
	makeView(
		'senior-ics',
		'Senior ICs',
		'IC4 and IC5 contributors across all departments',
		'team',
		{ level: { type: 'select', values: ['IC4', 'IC5'], labels: ['IC4', 'IC5'] } },
		[{ colId: 'salary', sort: 'desc' }],
		'warm-orange'
	),
	makeView('contractors', 'All Contractors', 'External contractors — useful for billing and access reviews', 'personal', {
		status: { type: 'select', values: ['Contractor'], labels: ['Contractor'] },
	}),
	makeView(
		'sf-high-earners',
		'SF High Earners',
		'San Francisco employees earning over $100k — comp review baseline',
		'personal',
		{
			location: { type: 'select', values: ['San Francisco'], labels: ['San Francisco'] },
			salary: { type: 'select', values: [100000, null], labels: ['$100,000–∞'] },
		},
		[{ colId: 'salary', sort: 'desc' }]
	),
];

const DEFAULT_VIEW_ID = 'eng-active';

// ── FakeAsyncWorkspaceAdapter ─────────────────────────────────────────────────

class FakeAsyncWorkspaceAdapter implements GridWorkspaceAdapter {
	private _views: Map<string, GridViewDefinition>;
	private _defaultId: string | null;
	private _injectError = false;

	constructor(seeds: GridViewDefinition[], defaultId: string | null) {
		this._views = new Map(seeds.map((v) => [v.id, v]));
		this._defaultId = defaultId;
	}

	async listViews(): Promise<readonly GridViewDefinition[]> {
		await fakeDelay(jitter(550), null);
		return Array.from(this._views.values()).sort((a, b) => a.createdAt - b.createdAt);
	}

	async getView(id: string): Promise<GridViewDefinition | null> {
		await fakeDelay(jitter(180), null);
		return this._views.get(id) ?? null;
	}

	async saveView(view: GridViewDefinition): Promise<void> {
		if (this._injectError) {
			this._injectError = false;
			await fakeDelay(jitter(600), null);
			throw new Error('Server error: quota exceeded (simulated)');
		}
		await fakeDelay(jitter(480), null);
		this._views.set(view.id, view);
	}

	async deleteView(id: string): Promise<void> {
		await fakeDelay(jitter(320), null);
		this._views.delete(id);
		if (this._defaultId === id) this._defaultId = null;
	}

	async getDefaultView(): Promise<string | null> {
		await fakeDelay(jitter(120), null);
		return this._defaultId;
	}

	async setDefaultView(id: string | null): Promise<void> {
		await fakeDelay(jitter(220), null);
		this._defaultId = id;
	}

	/** Demo helper — next saveView() call will throw a simulated server error. */
	triggerSaveError(): void {
		this._injectError = true;
	}
}

// ── Event log ─────────────────────────────────────────────────────────────────

interface LogEntry {
	key: number;
	ts: number;
	icon: string;
	msg: string;
	sub?: string;
}

let _logSeq = 0;

function makeEntry(icon: string, msg: string, sub?: string): LogEntry {
	return { key: _logSeq++, ts: Date.now(), icon, msg, sub };
}

const SCOPE_COLORS: Record<string, string> = {
	system: '#f472b6',
	team: '#818cf8',
	personal: '#34d399',
};

const SCOPE_LABELS: Record<string, string> = {
	system: 'System',
	team: 'Team',
	personal: 'Personal',
};

// ── Demo page ─────────────────────────────────────────────────────────────────

export default function AdvancedFiltersDemo() {
	const apiRef = useRef<GridApi<EmployeeRow> | null>(null);
	const [filterModel, setFilterModel] = useState<FilterModel | null>(null);
	const [wsState, setWsState] = useState<GridWorkspaceState | null>(null);
	const [log, setLog] = useState<LogEntry[]>([]);
	const [quickFilterText, setQuickFilterText] = useState('');
	const columns = useMemo(() => makeColumns(), []);
	const rows = useMemo(() => ALL_ROWS, []);

	// Global search box, wired straight to api.setQuickFilter — matches every column
	// (id, name, department, location, status, level, salary, startDate, skills) at once,
	// combined via AND with any active per-column filters and the pre-seeded views above.
	const handleQuickFilterChange = (text: string) => {
		setQuickFilterText(text);
		apiRef.current?.setQuickFilter(text);
	};

	// Stable adapter instance — lives for the lifetime of this page.
	const adapter = useMemo(() => new FakeAsyncWorkspaceAdapter(SEED_VIEWS, DEFAULT_VIEW_ID), []);

	const pushLog = useCallback((entry: LogEntry) => {
		setLog((prev) => [entry, ...prev].slice(0, 12));
	}, []);

	const onGridReady = useCallback(
		(e: GridReadyEvent<EmployeeRow>) => {
			apiRef.current = e.api;

			// Track filter model for the "clear filters" button.
			e.api.subscribeToKey('filterModel', (s) => setFilterModel((s as any).filterModel ?? null));

			// Track workspace state for the status bar.
			e.api.subscribeToWorkspaceState(setWsState);

			// Populate the event log from workspace events.
			e.api.addEventListener(GridEventName.viewApplied, ({ payload: { view } }) => {
				if (!view) return;
				pushLog(makeEntry('▶', `Applied "${view.name}"`, SCOPE_LABELS[view.scope]));
			});
			e.api.addEventListener(GridEventName.viewSaved, ({ payload: { view } }) => {
				pushLog(makeEntry('✦', `Saved "${view.name}"`, SCOPE_LABELS[view.scope]));
			});
			e.api.addEventListener(GridEventName.viewDeleted, ({ payload: { id } }) => {
				pushLog(makeEntry('✕', `Deleted view`, id));
			});
			e.api.addEventListener(GridEventName.viewRenamed, ({ payload: { id: _id, name } }) => {
				pushLog(makeEntry('✎', `Renamed to "${name}"`));
			});
		},
		[pushLog]
	);

	// Log loading completion when workspace finishes initialising.
	useEffect(() => {
		if (!wsState) return;
		if (!wsState.loading && wsState.views.length > 0) {
			pushLog(makeEntry('↓', `Loaded ${wsState.views.length} views from adapter`));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [wsState?.loading]);

	const activeFilters = filterModel ? Object.keys(filterModel).length : 0;
	const activeView = wsState?.views.find((v) => v.id === wsState.activeViewId) ?? null;
	const isDirty = wsState?.dirty ?? false;

	// Quick-apply a pre-seeded view by ID.
	const applyView = (id: string) => {
		apiRef.current?.applyView(id).catch(console.error);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
			{/* ── Header ────────────────────────────────────────────────── */}
			<div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '0 4px', flexShrink: 0 }}>
				<div style={{ flex: 1 }}>
					<div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.01em' }}>Workspace Views Demo</div>
					<div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
						Named views over the Advanced Filters dataset — open Sidebar → <strong style={{ color: '#94a3b8' }}>Views</strong> to save,
						rename, and switch views
					</div>
				</div>

				{/* Global quick filter — api.setQuickFilter() searches every column at once. */}
				<div style={{ position: 'relative', flexShrink: 0, width: 240 }}>
					<span
						style={{
							position: 'absolute',
							left: 9,
							top: '50%',
							transform: 'translateY(-50%)',
							fontSize: 12,
							color: '#475569',
							pointerEvents: 'none',
						}}
					>
						🔍
					</span>
					<input
						type='text'
						value={quickFilterText}
						onChange={(e) => handleQuickFilterChange(e.target.value)}
						placeholder='Search all columns…'
						style={{
							width: '100%',
							height: 28,
							padding: '0 26px 0 26px',
							fontSize: 11,
							background: 'rgba(15,23,42,0.7)',
							border: `1px solid ${quickFilterText ? 'rgba(59,130,246,0.4)' : '#1e293b'}`,
							borderRadius: 6,
							color: '#e2e8f0',
							outline: 'none',
							boxSizing: 'border-box',
						}}
					/>
					{quickFilterText && (
						<button
							onClick={() => handleQuickFilterChange('')}
							aria-label='Clear search'
							style={{
								position: 'absolute',
								right: 6,
								top: '50%',
								transform: 'translateY(-50%)',
								fontSize: 13,
								lineHeight: 1,
								color: '#64748b',
								background: 'none',
								border: 'none',
								cursor: 'pointer',
								padding: 2,
							}}
						>
							×
						</button>
					)}
				</div>

				{activeFilters > 0 && (
					<button
						onClick={() => apiRef.current?.setFilterModel(null)}
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: '#60a5fa',
							background: 'rgba(59,130,246,0.1)',
							border: '1px solid rgba(59,130,246,0.3)',
							borderRadius: 6,
							padding: '4px 12px',
							cursor: 'pointer',
							flexShrink: 0,
						}}
					>
						Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
					</button>
				)}
			</div>

			{/* ── Workspace control panel ───────────────────────────────── */}
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: '1fr 1fr',
					gap: 10,
					flexShrink: 0,
				}}
			>
				{/* Left: active view + quick-apply chips */}
				<div
					style={{
						background: 'rgba(15,23,42,0.7)',
						border: '1px solid #1e293b',
						borderRadius: 8,
						padding: '10px 12px',
						display: 'flex',
						flexDirection: 'column',
						gap: 8,
					}}
				>
					{/* Active view row */}
					<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
						<div
							style={{
								width: 8,
								height: 8,
								borderRadius: '50%',
								background: isDirty ? '#f59e0b' : activeView ? '#22c55e' : '#475569',
								flexShrink: 0,
								boxShadow: isDirty ? '0 0 6px #f59e0b80' : activeView ? '0 0 6px #22c55e60' : 'none',
								transition: 'background 0.3s, box-shadow 0.3s',
							}}
						/>
						<span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{activeView ? activeView.name : 'No active view'}</span>
						{activeView && (
							<span
								style={{
									fontSize: 9,
									fontWeight: 700,
									letterSpacing: '0.07em',
									padding: '1px 5px',
									borderRadius: 3,
									background: `${SCOPE_COLORS[activeView.scope]}18`,
									border: `1px solid ${SCOPE_COLORS[activeView.scope]}40`,
									color: SCOPE_COLORS[activeView.scope],
									textTransform: 'uppercase',
								}}
							>
								{SCOPE_LABELS[activeView.scope]}
							</span>
						)}
						{isDirty && (
							<span
								style={{
									fontSize: 9,
									fontWeight: 700,
									padding: '1px 6px',
									borderRadius: 3,
									background: 'rgba(245,158,11,0.12)',
									border: '1px solid rgba(245,158,11,0.35)',
									color: '#f59e0b',
								}}
							>
								UNSAVED CHANGES
							</span>
						)}
						{wsState?.loading && <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>Loading…</span>}
					</div>

					{/* Quick-apply chips */}
					<div>
						<div
							style={{
								fontSize: 9,
								fontWeight: 700,
								letterSpacing: '0.08em',
								textTransform: 'uppercase',
								color: '#475569',
								marginBottom: 5,
							}}
						>
							Quick Apply
						</div>
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
							{SEED_VIEWS.map((v) => {
								const isActive = wsState?.activeViewId === v.id;
								const col = SCOPE_COLORS[v.scope];
								return (
									<button
										key={v.id}
										onClick={() => applyView(v.id)}
										title={v.description}
										style={{
											fontSize: 10,
											fontWeight: 600,
											padding: '3px 9px',
											borderRadius: 5,
											border: isActive ? `1px solid ${col}70` : `1px solid ${col}30`,
											background: isActive ? `${col}20` : 'transparent',
											color: isActive ? col : '#64748b',
											cursor: 'pointer',
											transition: 'all 0.15s',
										}}
									>
										{v.name}
									</button>
								);
							})}
						</div>
					</div>

					{/* Error injection */}
					<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
						<button
							onClick={() => {
								adapter.triggerSaveError();
								pushLog(makeEntry('⚠', 'Next save will fail', 'simulated error injected'));
							}}
							style={{
								fontSize: 10,
								fontWeight: 600,
								padding: '3px 10px',
								borderRadius: 5,
								border: '1px solid rgba(239,68,68,0.3)',
								background: 'rgba(239,68,68,0.06)',
								color: '#f87171',
								cursor: 'pointer',
							}}
						>
							Inject save error
						</button>
						<span style={{ fontSize: 10, color: '#475569' }}>then save a view to observe error handling in the panel</span>
					</div>
				</div>

				{/* Right: event log */}
				<div
					style={{
						background: 'rgba(15,23,42,0.7)',
						border: '1px solid #1e293b',
						borderRadius: 8,
						padding: '10px 12px',
						display: 'flex',
						flexDirection: 'column',
						gap: 6,
						minHeight: 0,
						overflow: 'auto',
						maxHeight: 150,
					}}
				>
					<div
						style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', flexShrink: 0 }}
					>
						Event Log
					</div>
					{log.length === 0 ? (
						<div style={{ fontSize: 10, color: '#334155', fontStyle: 'italic' }}>Workspace events will appear here…</div>
					) : (
						<div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
							{log.map((entry, i) => (
								<div
									key={entry.key}
									style={{
										display: 'flex',
										alignItems: 'baseline',
										gap: 6,
										opacity: i === 0 ? 1 : Math.max(0.25, 1 - i * 0.12),
										transition: 'opacity 0.2s',
									}}
								>
									<span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', flexShrink: 0 }}>
										{new Date(entry.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
									</span>
									<span style={{ fontSize: 10, color: '#60a5fa', fontFamily: 'monospace', flexShrink: 0 }}>{entry.icon}</span>
									<span
										style={{ fontSize: 10, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
									>
										{entry.msg}
									</span>
									{entry.sub && <span style={{ fontSize: 9, color: '#475569', flexShrink: 0 }}>{entry.sub}</span>}
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* ── Filter type legend ────────────────────────────────────── */}
			<div
				style={{
					display: 'flex',
					flexWrap: 'wrap',
					gap: 6,
					padding: '5px 10px',
					background: 'rgba(30,41,59,0.5)',
					borderRadius: 8,
					border: '1px solid #1e293b',
					flexShrink: 0,
				}}
			>
				{[
					{ col: 'Department', type: 'async-multi-select', color: '#818cf8' },
					{ col: 'Location', type: 'multi-select', color: '#34d399' },
					{ col: 'Status', type: 'single-select', color: '#fbbf24' },
					{ col: 'Level', type: 'multi-select', color: '#34d399' },
					{ col: 'Salary', type: 'custom range', color: '#f472b6' },
					{ col: 'Skills', type: 'infinite-multi-select', color: '#60a5fa' },
				].map(({ col, type, color }) => (
					<div key={col} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
						<span
							style={{
								padding: '1px 6px',
								background: `${color}18`,
								border: `1px solid ${color}40`,
								borderRadius: 4,
								color,
								fontWeight: 600,
								fontFamily: 'monospace',
							}}
						>
							{type}
						</span>
						<span style={{ color: '#94a3b8' }}>{col}</span>
					</div>
				))}
				<div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, marginLeft: 'auto' }}>
					<span
						style={{
							padding: '1px 6px',
							background: '#60a5fa18',
							border: '1px solid #60a5fa40',
							borderRadius: 4,
							color: '#60a5fa',
							fontWeight: 600,
							fontFamily: 'monospace',
						}}
					>
						quickFilter
					</span>
					<span style={{ color: '#94a3b8' }}>Search box above — matches any column, ANDed with the per-column filters</span>
				</div>
			</div>

			{/* ── Grid ──────────────────────────────────────────────────── */}
			<div style={{ flex: 1, minHeight: 0 }}>
				<Grid<EmployeeRow>
					rowModelType='client'
					columns={columns}
					rows={rows}
					getRowId={(row) => row.id}
					onGridReady={onGridReady}
					showFilterChipBar={true}
					persistence='advancedfilters-ws'
					workspace={adapter}
					sidebar={{ panels: ['columns', 'query', 'filters', 'sort', 'themes', 'views'], defaultOpen: 'views' }}
				/>
			</div>
		</div>
	);
}
