import React, { useCallback, useMemo, useState } from 'react';
import {
	Grid,
	type AggregationDef,
	type CellRendererProps,
	type ColumnDef,
	type GridApi,
	type GridReadyEvent,
	type VisualRow,
} from '@eregister/wit-grid-react';
import {
	Boxes,
	Calculator,
	ChevronDown,
	ChevronRight,
	Database,
	Folder,
	FolderTree,
	GitBranch,
	Layers3,
	PackageOpen,
	PanelRightOpen,
	RefreshCw,
	Sigma,
	Sparkles,
	TrendingUp,
} from 'lucide-react';
import type { WitGridExampleRuntimeProps } from '../types';

type TabId = 'groups' | 'tree' | 'detail';

interface WorkforceRow {
	id: string;
	employee: string;
	department: string;
	region: string;
	role: string;
	costCenter: string;
	utilization: number;
	salary: number;
	health: 'Green' | 'Amber' | 'Red';
}

interface RepoNodeRow {
	id: string;
	name: string;
	area: string;
	owner: string;
	status: 'Stable' | 'Active' | 'Review';
	size: string;
	parentId?: string;
}

interface OrderRow {
	id: string;
	account: string;
	segment: string;
	region: string;
	renewalDate: string;
	total: number;
	status: 'Ready' | 'In review' | 'Blocked';
}

interface OrderLineRow {
	id: string;
	sku: string;
	module: string;
	seats: number;
	unitPrice: number;
	subtotal: number;
	status: 'Provisioned' | 'Queued' | 'Exception';
}

const workforceRows: WorkforceRow[] = [
	{
		id: 'WF-001',
		employee: 'Anika Rao',
		department: 'Platform',
		region: 'APAC',
		role: 'Principal Engineer',
		costCenter: 'PLT-01',
		utilization: 94,
		salary: 188000,
		health: 'Green',
	},
	{
		id: 'WF-002',
		employee: 'Noah Kim',
		department: 'Platform',
		region: 'APAC',
		role: 'Staff Engineer',
		costCenter: 'PLT-01',
		utilization: 89,
		salary: 164000,
		health: 'Green',
	},
	{
		id: 'WF-003',
		employee: 'Maya Okafor',
		department: 'Platform',
		region: 'EMEA',
		role: 'Runtime Engineer',
		costCenter: 'PLT-02',
		utilization: 82,
		salary: 142000,
		health: 'Amber',
	},
	{
		id: 'WF-004',
		employee: 'Luca Rossi',
		department: 'Platform',
		region: 'EMEA',
		role: 'Runtime Engineer',
		costCenter: 'PLT-02',
		utilization: 76,
		salary: 136000,
		health: 'Amber',
	},
	{
		id: 'WF-005',
		employee: 'Sofia Mendes',
		department: 'Product',
		region: 'Americas',
		role: 'Product Lead',
		costCenter: 'PRD-01',
		utilization: 91,
		salary: 172000,
		health: 'Green',
	},
	{
		id: 'WF-006',
		employee: 'Ethan Brooks',
		department: 'Product',
		region: 'Americas',
		role: 'Product Manager',
		costCenter: 'PRD-01',
		utilization: 84,
		salary: 134000,
		health: 'Green',
	},
	{
		id: 'WF-007',
		employee: 'Iris Chen',
		department: 'Product',
		region: 'APAC',
		role: 'Research Ops',
		costCenter: 'PRD-02',
		utilization: 68,
		salary: 118000,
		health: 'Red',
	},
	{
		id: 'WF-008',
		employee: 'Samir Vyas',
		department: 'Design',
		region: 'APAC',
		role: 'Design Systems',
		costCenter: 'DSN-01',
		utilization: 88,
		salary: 148000,
		health: 'Green',
	},
	{
		id: 'WF-009',
		employee: 'Clara Stein',
		department: 'Design',
		region: 'EMEA',
		role: 'Interaction Design',
		costCenter: 'DSN-01',
		utilization: 79,
		salary: 132000,
		health: 'Amber',
	},
	{
		id: 'WF-010',
		employee: 'Owen Hayes',
		department: 'Design',
		region: 'Americas',
		role: 'Content Design',
		costCenter: 'DSN-02',
		utilization: 74,
		salary: 116000,
		health: 'Amber',
	},
	{
		id: 'WF-011',
		employee: 'Nadia Petrova',
		department: 'Solutions',
		region: 'EMEA',
		role: 'Field Architect',
		costCenter: 'SOL-01',
		utilization: 96,
		salary: 158000,
		health: 'Green',
	},
	{
		id: 'WF-012',
		employee: 'Mateo Cruz',
		department: 'Solutions',
		region: 'Americas',
		role: 'Field Architect',
		costCenter: 'SOL-01',
		utilization: 92,
		salary: 154000,
		health: 'Green',
	},
	{
		id: 'WF-013',
		employee: 'Priya Kapoor',
		department: 'Solutions',
		region: 'APAC',
		role: 'Customer Engineer',
		costCenter: 'SOL-02',
		utilization: 81,
		salary: 128000,
		health: 'Amber',
	},
	{
		id: 'WF-014',
		employee: 'Jon Bell',
		department: 'Operations',
		region: 'Americas',
		role: 'Release Manager',
		costCenter: 'OPS-01',
		utilization: 86,
		salary: 126000,
		health: 'Green',
	},
	{
		id: 'WF-015',
		employee: 'Ava Hart',
		department: 'Operations',
		region: 'EMEA',
		role: 'Program Manager',
		costCenter: 'OPS-01',
		utilization: 72,
		salary: 121000,
		health: 'Red',
	},
	{
		id: 'WF-016',
		employee: 'Kenji Ito',
		department: 'Operations',
		region: 'APAC',
		role: 'Automation Lead',
		costCenter: 'OPS-02',
		utilization: 90,
		salary: 139000,
		health: 'Green',
	},
];

const repoRows: RepoNodeRow[] = [
	{ id: 'root', name: 'wit-grid', area: 'Workspace', owner: 'Core Team', status: 'Active', size: 'workspace' },
	{ id: 'packages', name: 'packages', area: 'Workspace', owner: 'Core Team', status: 'Active', size: '4 packages', parentId: 'root' },
	{ id: 'core', name: '@eregister/wit-grid-core', area: 'Package', owner: 'Runtime', status: 'Stable', size: '148 KB', parentId: 'packages' },
	{ id: 'react', name: '@eregister/wit-grid-react', area: 'Package', owner: 'React', status: 'Active', size: '212 KB', parentId: 'packages' },
	{
		id: 'examples',
		name: '@eregister/wit-grid-examples',
		area: 'Package',
		owner: 'Docs',
		status: 'Active',
		size: 'showcases',
		parentId: 'packages',
	},
	{ id: 'site', name: 'site', area: 'Next/Fumadocs', owner: 'Docs', status: 'Review', size: 'MDX', parentId: 'root' },
	{ id: 'site-docs', name: 'content/docs', area: 'Documentation', owner: 'Docs', status: 'Active', size: 'versioned', parentId: 'site' },
	{ id: 'site-examples', name: 'components/examples', area: 'Documentation', owner: 'Docs', status: 'Active', size: 'gallery', parentId: 'site' },
	{ id: 'demo', name: 'demo', area: 'Development', owner: 'Experience', status: 'Review', size: 'Vite app', parentId: 'root' },
	{ id: 'demo-pages', name: 'src/pages', area: 'Development', owner: 'Experience', status: 'Active', size: 'routes', parentId: 'demo' },
	{ id: 'hierarchy-api', name: 'hierarchyConfig.ts', area: 'Core API', owner: 'Runtime', status: 'Stable', size: '12 KB', parentId: 'core' },
	{ id: 'grid-surface', name: 'GridSurface.tsx', area: 'React API', owner: 'React', status: 'Active', size: '35 KB', parentId: 'react' },
];

const initialOrderLines: Record<string, OrderLineRow[]> = {
	'SO-1101': [
		{ id: 'L-101', sku: 'WG-ENT-CORE', module: 'Enterprise Core', seats: 120, unitPrice: 84, subtotal: 10080, status: 'Provisioned' },
		{ id: 'L-102', sku: 'WG-SSRM', module: 'Server-side Row Model', seats: 120, unitPrice: 42, subtotal: 5040, status: 'Queued' },
	],
	'SO-1102': [
		{ id: 'L-201', sku: 'WG-AUDIT', module: 'Audit Persistence', seats: 80, unitPrice: 55, subtotal: 4400, status: 'Provisioned' },
		{ id: 'L-202', sku: 'WG-FILTER', module: 'Advanced Filters', seats: 80, unitPrice: 38, subtotal: 3040, status: 'Provisioned' },
		{ id: 'L-203', sku: 'WG-SUPPORT', module: 'Launch Support', seats: 1, unitPrice: 6200, subtotal: 6200, status: 'Queued' },
	],
	'SO-1103': [
		{ id: 'L-301', sku: 'WG-EDIT', module: 'Editing Toolkit', seats: 60, unitPrice: 32, subtotal: 1920, status: 'Exception' },
		{ id: 'L-302', sku: 'WG-THEME', module: 'Theme Pack', seats: 60, unitPrice: 18, subtotal: 1080, status: 'Queued' },
	],
	'SO-1104': [
		{ id: 'L-401', sku: 'WG-ENT-CORE', module: 'Enterprise Core', seats: 220, unitPrice: 76, subtotal: 16720, status: 'Provisioned' },
		{ id: 'L-402', sku: 'WG-LIVE', module: 'Realtime Updates', seats: 220, unitPrice: 35, subtotal: 7700, status: 'Provisioned' },
	],
};

const orderRows: OrderRow[] = [
	{
		id: 'SO-1101',
		account: 'Apex Capital',
		segment: 'Financial services',
		region: 'Americas',
		renewalDate: '2026-11-04',
		total: 15120,
		status: 'Ready',
	},
	{
		id: 'SO-1102',
		account: 'Northstar Health',
		segment: 'Healthcare',
		region: 'EMEA',
		renewalDate: '2026-11-12',
		total: 13640,
		status: 'In review',
	},
	{ id: 'SO-1103', account: 'Kairo Logistics', segment: 'Supply chain', region: 'APAC', renewalDate: '2026-12-01', total: 3000, status: 'Blocked' },
	{ id: 'SO-1104', account: 'Helio Cloud', segment: 'SaaS', region: 'Americas', renewalDate: '2026-12-16', total: 24420, status: 'Ready' },
];

const workforceAggs: AggregationDef<WorkforceRow>[] = [
	{ colId: 'salary', aggFunc: 'sum' },
	{ colId: 'utilization', aggFunc: 'avg' },
];

function formatCurrency(value: unknown) {
	const amount = Number(value) || 0;
	return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet' }) {
	const tones = {
		slate: 'border-slate-700 bg-slate-900/70 text-slate-300',
		green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
		amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
		red: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
		blue: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
		violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
	};

	return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

const MoneyRenderer = ({ value }: CellRendererProps<any>) => (
	<span className='font-mono text-xs font-bold text-slate-100'>{formatCurrency(value)}</span>
);

const PercentRenderer = ({ value }: CellRendererProps<any>) => {
	const percent = Number(value) || 0;
	const tone = percent >= 88 ? 'text-emerald-300' : percent >= 78 ? 'text-amber-300' : 'text-rose-300';
	return <span className={`font-mono text-xs font-bold ${tone}`}>{percent.toFixed(0)}%</span>;
};

const StatusRenderer = ({ value }: CellRendererProps<any>) => {
	const label = String(value);
	const tone =
		label === 'Green' || label === 'Ready' || label === 'Stable' || label === 'Provisioned'
			? 'green'
			: label === 'Red' || label === 'Blocked' || label === 'Exception'
				? 'red'
				: 'amber';
	return <Pill tone={tone}>{label}</Pill>;
};

const RepoNameRenderer = ({ value, row }: CellRendererProps<RepoNodeRow>) => {
	const isFolder = row.area === 'Workspace' || row.area === 'Package' || row.area === 'Next/Fumadocs' || row.area === 'Development';
	return (
		<div className='flex h-full items-center gap-2'>
			{isFolder ? <Folder className='h-4 w-4 text-amber-300' /> : <Database className='h-4 w-4 text-cyan-300' />}
			<span className='truncate font-semibold text-slate-100'>{String(value)}</span>
		</div>
	);
};

function ToolButton({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
	return (
		<button
			type='button'
			onClick={onClick}
			className={`inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-bold transition ${
				active
					? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)]'
					: 'border-slate-700 bg-slate-950/55 text-slate-300 hover:border-slate-500 hover:text-white'
			}`}
		>
			{children}
		</button>
	);
}

function TabButton({
	id,
	active,
	icon: Icon,
	label,
	onClick,
}: {
	id: TabId;
	active: TabId;
	icon: React.ElementType;
	label: string;
	onClick: (id: TabId) => void;
}) {
	const isActive = id === active;
	return (
		<button
			type='button'
			onClick={() => onClick(id)}
			className={`group inline-flex items-center justify-center gap-2 rounded-md border text-left transition ${
				isActive
					? 'border-cyan-400/60 bg-cyan-400/15 text-white shadow-[0_0_26px_rgba(34,211,238,0.16)]'
					: 'border-transparent bg-transparent text-slate-400 hover:bg-slate-900/80 hover:text-slate-100'
			}`}
			style={{ minWidth: 0, height: 34, padding: '0 14px' }}
		>
			<span className={`flex h-6 w-6 items-center justify-center rounded ${isActive ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-500'}`}>
				<Icon className='h-3.5 w-3.5' />
			</span>
			<span className='truncate text-[12px] font-extrabold'>{label}</span>
		</button>
	);
}

function DetailToggleRenderer({ rowId, api }: CellRendererProps<OrderRow>) {
	const isOpen = api.isDetailOpen(rowId);
	return (
		<button
			type='button'
			onClick={(event) => {
				event.stopPropagation();
				api.toggleDetailOpen(rowId);
			}}
			className='flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'
		>
			{isOpen ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
		</button>
	);
}

function DetailGrid({
	visualRow,
	parentApi,
	onLedgerChange,
}: {
	visualRow: VisualRow<OrderRow>;
	parentApi: GridApi<OrderRow>;
	onLedgerChange: () => void;
}) {
	const [detailApi, setDetailApi] = useState<GridApi<OrderLineRow> | null>(null);
	if (visualRow.kind !== 'detail') return null;

	const orderId = visualRow.parentId;
	const rows = initialOrderLines[orderId] ?? [];

	const columns = useMemo<ColumnDef<OrderLineRow>[]>(
		() => [
			{ field: 'sku', header: 'SKU', width: 130 },
			{ field: 'module', header: 'Module', width: 190 },
			{ field: 'seats', header: 'Seats', width: 90 },
			{ field: 'unitPrice', header: 'Unit', width: 100, renderer: { kind: 'react', component: MoneyRenderer } },
			{ field: 'subtotal', header: 'Subtotal', width: 120, renderer: { kind: 'react', component: MoneyRenderer } },
			{ field: 'status', header: 'Status', width: 130, renderer: { kind: 'react', component: StatusRenderer } },
		],
		[]
	);

	const handleCellValueChanged = useCallback(
		({ rowId, colField, newValue }: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => {
			if (colField !== 'seats' || !detailApi) return;

			const row = detailApi.getRawRowById(rowId);
			if (!row) return;

			const seats = Math.max(0, Number(newValue) || 0);
			const subtotal = seats * row.unitPrice;
			detailApi.setCellValue(rowId, 'subtotal', subtotal);

			const sourceRow = rows.find((item) => item.id === rowId);
			if (sourceRow) {
				sourceRow.seats = seats;
				sourceRow.subtotal = subtotal;
			}

			const nextTotal = rows.reduce((sum, item) => sum + item.subtotal, 0);
			parentApi.setCellValue(orderId, 'total', nextTotal);
			onLedgerChange();
		},
		[detailApi, onLedgerChange, orderId, parentApi, rows]
	);

	return (
		<div className='flex h-full w-full flex-col gap-2 border-b border-slate-800 bg-slate-950/95 px-6 py-3' style={{ minHeight: 240 }}>
			<div className='flex items-center justify-between gap-3'>
				<div className='flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-300'>
					<PackageOpen className='h-4 w-4 text-cyan-300' />
					Line items for {orderId}
				</div>
				<Pill tone='blue'>Nested grid detail renderer</Pill>
			</div>
			<div className='overflow-hidden rounded-lg border border-slate-800 bg-slate-950' style={{ height: 178 }}>
				<Grid<OrderLineRow>
					rowModelType='client'
					rows={rows}
					columns={columns}
					enableNavigation
					navigationOptions={{ editTrigger: 'singleClick' }}
					onCellValueChanged={handleCellValueChanged}
					onGridReady={({ api }) => setDetailApi(api)}
				/>
			</div>
		</div>
	);
}

export interface NestedHierarchyDemoProps extends WitGridExampleRuntimeProps {
	onGridReady?: (event: GridReadyEvent<any>) => void;
}

export default function NestedHierarchyDemo({ onGridReady, compact = false }: NestedHierarchyDemoProps) {
	const [activeTab, setActiveTab] = useState<TabId>('groups');
	const [groupApi, setGroupApi] = useState<GridApi<WorkforceRow> | null>(null);
	const [treeApi, setTreeApi] = useState<GridApi<RepoNodeRow> | null>(null);
	const [detailApi, setDetailApi] = useState<GridApi<OrderRow> | null>(null);
	const [groupBy, setGroupBy] = useState(['department', 'region']);
	const [expandedOrders, setExpandedOrders] = useState(false);
	const [ledgerRevision, setLedgerRevision] = useState(0);
	const [ledgerRun, setLedgerRun] = useState<{
		timestamp: string;
		totalOrders: number;
		totalSeats: number;
		grandTotal: number;
		highestModule: string;
	} | null>(null);

	const workforceColumns = useMemo<ColumnDef<WorkforceRow>[]>(
		() => [
			{ field: 'department', header: 'Department', width: 135, sortable: true, enableRowGroup: true },
			{ field: 'region', header: 'Region', width: 115, sortable: true, enableRowGroup: true },
			{ field: 'role', header: 'Role', width: 170, sortable: true, enableRowGroup: true },
			{ field: 'employee', header: 'Employee', width: 165, sortable: true },
			{ field: 'costCenter', header: 'Cost center', width: 120, sortable: true, enableRowGroup: true },
			{
				field: 'utilization',
				header: 'Utilization',
				width: 115,
				sortable: true,
				valueFormatter: ({ value }) => (typeof value === 'number' ? `${value.toFixed(0)}%` : ''),
				renderer: { kind: 'react', component: PercentRenderer },
			},
			{
				field: 'salary',
				header: 'Salary',
				width: 130,
				sortable: true,
				valueFormatter: ({ value }) => (typeof value === 'number' ? formatCurrency(value) : ''),
				renderer: { kind: 'react', component: MoneyRenderer },
			},
			{ field: 'health', header: 'Health', width: 110, renderer: { kind: 'react', component: StatusRenderer }, enableRowGroup: true },
		],
		[]
	);

	const repoColumns = useMemo<ColumnDef<RepoNodeRow>[]>(
		() => [
			{ field: 'name', header: 'Node', width: 290, renderer: { kind: 'react', component: RepoNameRenderer } },
			{ field: 'area', header: 'Area', width: 145, sortable: true },
			{ field: 'owner', header: 'Owner', width: 130, sortable: true },
			{ field: 'status', header: 'Status', width: 120, renderer: { kind: 'react', component: StatusRenderer } },
			{ field: 'size', header: 'Size', width: 115 },
		],
		[]
	);

	const orderColumns = useMemo<ColumnDef<OrderRow>[]>(
		() => [
			{ field: 'toggle', header: '', width: 48, renderer: { kind: 'react', component: DetailToggleRenderer } },
			{ field: 'id', header: 'Order', width: 115, sortable: true },
			{ field: 'account', header: 'Account', width: 180, sortable: true },
			{ field: 'segment', header: 'Segment', width: 155, sortable: true },
			{ field: 'region', header: 'Region', width: 120, sortable: true },
			{ field: 'renewalDate', header: 'Renewal', width: 125, sortable: true },
			{ field: 'total', header: 'Total', width: 130, sortable: true, renderer: { kind: 'react', component: MoneyRenderer } },
			{ field: 'status', header: 'Status', width: 130, renderer: { kind: 'react', component: StatusRenderer } },
		],
		[]
	);

	const setGrouping = useCallback(
		(next: string[]) => {
			setGroupBy(next);
			groupApi?.setGroupBy(next);
		},
		[groupApi]
	);

	const expandAllOrders = useCallback(() => {
		const next = !expandedOrders;
		for (const row of orderRows) {
			detailApi?.setDetailOpen(row.id, next);
		}
		setExpandedOrders(next);
	}, [detailApi, expandedOrders]);

	const ledgerSummary = useMemo(() => {
		void ledgerRevision;
		let totalSeats = 0;
		let grandTotal = 0;
		let highestModule = '';
		let highestSubtotal = 0;

		for (const lines of Object.values(initialOrderLines)) {
			for (const line of lines) {
				totalSeats += line.seats;
				grandTotal += line.subtotal;
				if (line.subtotal > highestSubtotal) {
					highestSubtotal = line.subtotal;
					highestModule = line.module;
				}
			}
		}

		return { totalOrders: orderRows.length, totalSeats, grandTotal, highestModule };
	}, [ledgerRevision]);

	const calculateLedger = useCallback(() => {
		setLedgerRun({
			...ledgerSummary,
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
		});
	}, [ledgerSummary]);

	const handleGridReady = useCallback(
		(event: GridReadyEvent<any>) => {
			onGridReady?.(event);
		},
		[onGridReady]
	);

	const shellStyle: React.CSSProperties = {
		display: 'flex',
		flexDirection: 'column',
		gap: compact ? 12 : 14,
		width: '100%',
		height: '100%',
		minHeight: 0,
		overflow: 'hidden',
		background: 'rgba(2, 6, 23, 0.2)',
		color: '#f8fafc',
	};
	const tabsStyle: React.CSSProperties = {
		display: 'flex',
		alignItems: 'center',
		gap: 4,
		flexShrink: 0,
		width: 'fit-content',
		maxWidth: '100%',
		padding: 4,
		border: '1px solid rgba(30, 41, 59, 1)',
		borderRadius: 10,
		background: 'rgba(2, 6, 23, 0.78)',
	};
	const workbenchStyle: React.CSSProperties = {
		display: 'grid',
		gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 300px',
		gap: 14,
		flex: '1 1 auto',
		minHeight: 0,
	};
	const gridShellStyle: React.CSSProperties = {
		minHeight: 0,
		height: compact ? 430 : '100%',
		overflow: 'hidden',
	};
	const gridViewportStyle: React.CSSProperties = {
		height: 'calc(100% - 61px)',
		minHeight: 260,
	};

	return (
		<div style={shellStyle}>
			{!compact && (
				<div className='rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-2xl' style={{ flexShrink: 0 }}>
					<div className='flex items-center justify-between gap-4'>
						<div className='min-w-0'>
							<div className='mb-1.5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wide text-cyan-300'>
								<GitBranch className='h-4 w-4' />
								Hierarchy workbench
							</div>
							<h2 className='text-lg font-black tracking-tight text-white'>Grouping, tree data, and nested detail grids</h2>
							<p className='mt-1 max-w-3xl text-xs leading-5 text-slate-400'>
								One package-backed showcase for the grid hierarchy stack: grouped analytics, parent-child tree rows, and editable
								master-detail portals.
							</p>
						</div>
						<div className='grid grid-cols-3 gap-2' style={{ width: 300, flexShrink: 0 }}>
							<div className='rounded-lg border border-slate-800 bg-slate-900/70 p-2.5'>
								<div className='text-[10px] font-bold uppercase text-slate-500'>Modes</div>
								<div className='mt-0.5 text-base font-black text-white'>3</div>
							</div>
							<div className='rounded-lg border border-slate-800 bg-slate-900/70 p-2.5'>
								<div className='text-[10px] font-bold uppercase text-slate-500'>Rows</div>
								<div className='mt-0.5 text-base font-black text-white'>
									{workforceRows.length + repoRows.length + orderRows.length}
								</div>
							</div>
							<div className='rounded-lg border border-slate-800 bg-slate-900/70 p-2.5'>
								<div className='text-[10px] font-bold uppercase text-slate-500'>APIs</div>
								<div className='mt-0.5 text-base font-black text-white'>6</div>
							</div>
						</div>
					</div>
				</div>
			)}

			<div style={tabsStyle}>
				<TabButton id='groups' active={activeTab} icon={Layers3} label='Groups' onClick={setActiveTab} />
				<TabButton id='tree' active={activeTab} icon={FolderTree} label='Tree' onClick={setActiveTab} />
				<TabButton id='detail' active={activeTab} icon={PanelRightOpen} label='Details' onClick={setActiveTab} />
			</div>

			<div style={workbenchStyle}>
				<div className='rounded-xl border border-slate-800 bg-slate-950 shadow-2xl' style={gridShellStyle}>
					<div className='flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/70 px-4 py-2.5'>
						<div>
							<div className='text-[13px] font-black text-white'>
								{activeTab === 'groups' ? 'Workforce capacity' : activeTab === 'tree' ? 'Workspace topology' : 'Renewal order book'}
							</div>
							<div className='text-[11px] text-slate-400'>
								{activeTab === 'groups'
									? 'Try changing grouping levels, then expand and collapse the hierarchy.'
									: activeTab === 'tree'
										? 'Tree data uses parent IDs, built-in hierarchy indentation, and descendant behavior.'
										: 'Open order details, edit seats in a child grid, and watch parent totals update.'}
							</div>
						</div>
						<div className='flex flex-wrap items-center gap-2'>
							{activeTab === 'groups' && (
								<>
									<ToolButton
										onClick={() => setGrouping(['department', 'region'])}
										active={groupBy.join('/') === 'department/region'}
									>
										Dept / Region
									</ToolButton>
									<ToolButton onClick={() => setGrouping(['region', 'role'])} active={groupBy.join('/') === 'region/role'}>
										Region / Role
									</ToolButton>
									<ToolButton onClick={() => groupApi?.expandAll()}>Expand</ToolButton>
									<ToolButton onClick={() => groupApi?.collapseAll()}>Collapse</ToolButton>
								</>
							)}
							{activeTab === 'tree' && (
								<>
									<ToolButton onClick={() => treeApi?.expandAll()}>Expand tree</ToolButton>
									<ToolButton onClick={() => treeApi?.collapseAll()}>Collapse tree</ToolButton>
								</>
							)}
							{activeTab === 'detail' && (
								<ToolButton onClick={expandAllOrders} active={expandedOrders}>
									{expandedOrders ? 'Close details' : 'Open details'}
								</ToolButton>
							)}
						</div>
					</div>

					<div style={gridViewportStyle}>
						{activeTab === 'groups' && (
							<Grid<WorkforceRow>
								rowModelType='client'
								rows={workforceRows}
								columns={workforceColumns}
								persistence='wit-grid-hierarchy-workforce'
								initialState={
									{
										grouping: {
											by: groupBy,
											display: 'columns',
											rowHeight: 42,
											stickyHeaders: true,
											totals: { groups: 'bottom', grand: 'bottom' },
										},
										aggregation: { defs: workforceAggs },
										hierarchyColumn: {
											header: 'Organization',
											width: 280,
											indentPerLevel: 18,
											show: { toggle: true, checkbox: false, count: true },
										},
									} as any
								}
								pinLeftColumns={1}
								onGridReady={(event) => {
									setGroupApi(event.api);
									handleGridReady(event);
								}}
							/>
						)}

						{activeTab === 'tree' && (
							<Grid<RepoNodeRow>
								rowModelType='client'
								rows={repoRows}
								columns={repoColumns}
								persistence='wit-grid-hierarchy-repo-tree'
								initialState={
									{
										treeData: {
											getParentId: (row: RepoNodeRow) => row.parentId,
											column: 'name',
											defaultExpanded: true,
											filterMode: 'includeDescendants',
											aggregateParents: true,
											selectDescendants: true,
										},
										hierarchyColumn: {
											header: 'Repository',
											width: 320,
											indentPerLevel: 18,
											show: { toggle: true, checkbox: true, count: true },
										},
									} as any
								}
								rowSelection='multiple'
								onGridReady={(event) => {
									setTreeApi(event.api);
									handleGridReady(event);
								}}
							/>
						)}

						{activeTab === 'detail' && (
							<Grid<OrderRow>
								rowModelType='client'
								rows={orderRows}
								columns={orderColumns}
								persistence='wit-grid-hierarchy-orders'
								initialState={
									{
										detail: {
											height: 250,
											estimatedHeight: 250,
											isMaster: (row: OrderRow) => Boolean(initialOrderLines[row.id]?.length),
										},
									} as any
								}
								detailRowRenderer={({ visualRow, api }) => (
									<DetailGrid
										visualRow={visualRow}
										parentApi={api}
										onLedgerChange={() => setLedgerRevision((value) => value + 1)}
									/>
								)}
								onGridReady={(event) => {
									setDetailApi(event.api);
									handleGridReady(event);
								}}
							/>
						)}
					</div>
				</div>

				{!compact && (
					<aside
						className='flex flex-col gap-3 overflow-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3'
						style={{ minHeight: 0 }}
					>
						<div className='flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-400'>
							<Sparkles className='h-4 w-4 text-cyan-300' />
							Active API surface
						</div>

						{activeTab === 'groups' && (
							<div className='space-y-3 text-sm text-slate-300'>
								<div className='rounded-lg border border-slate-800 bg-slate-900/70 p-3'>
									<div className='mb-2 flex items-center gap-2 font-bold text-white'>
										<Sigma className='h-4 w-4 text-cyan-300' />
										Grouping pipeline
									</div>
									<p className='text-xs leading-5 text-slate-400'>
										Uses <code className='rounded bg-slate-950 px-1.5 py-0.5 text-cyan-200'>setGroupBy</code>, sticky group rows,
										group totals, and sum/avg aggregation definitions.
									</p>
								</div>
								<Pill tone='blue'>{groupBy.join(' -> ')}</Pill>
							</div>
						)}

						{activeTab === 'tree' && (
							<div className='space-y-3 text-sm text-slate-300'>
								<div className='rounded-lg border border-slate-800 bg-slate-900/70 p-3'>
									<div className='mb-2 flex items-center gap-2 font-bold text-white'>
										<FolderTree className='h-4 w-4 text-amber-300' />
										Tree data
									</div>
									<p className='text-xs leading-5 text-slate-400'>
										Uses <code className='rounded bg-slate-950 px-1.5 py-0.5 text-cyan-200'>getParentId</code>, a hierarchy
										column, descendant selection, and include-descendants filtering semantics.
									</p>
								</div>
								<Pill tone='amber'>{repoRows.length} topology nodes</Pill>
							</div>
						)}

						{activeTab === 'detail' && (
							<div className='space-y-3 text-sm text-slate-300'>
								<div className='overflow-hidden rounded-xl border border-cyan-500/30 bg-cyan-500/10'>
									<div className='border-b border-cyan-500/20 px-3 py-2'>
										<div className='flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-cyan-200'>
											<Calculator className='h-4 w-4' />
											Nested ledger
										</div>
									</div>
									<div className='grid grid-cols-2 gap-px bg-cyan-500/10 text-xs'>
										<div className='bg-slate-950/70 p-3'>
											<div className='text-[10px] font-bold uppercase text-slate-500'>Order book</div>
											<div className='mt-1 font-mono text-lg font-black text-white'>
												{formatCurrency(ledgerSummary.grandTotal)}
											</div>
										</div>
										<div className='bg-slate-950/70 p-3'>
											<div className='text-[10px] font-bold uppercase text-slate-500'>Seats</div>
											<div className='mt-1 font-mono text-lg font-black text-white'>{ledgerSummary.totalSeats}</div>
										</div>
									</div>
									<div className='space-y-3 bg-slate-950/80 p-3'>
										<div className='flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/70 p-2.5'>
											<TrendingUp className='mt-0.5 h-4 w-4 shrink-0 text-emerald-300' />
											<div className='min-w-0'>
												<div className='text-[10px] font-bold uppercase tracking-wide text-slate-500'>Largest line</div>
												<div className='truncate text-xs font-bold text-slate-200'>{ledgerSummary.highestModule}</div>
											</div>
										</div>
										<button
											type='button'
											onClick={calculateLedger}
											className='flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-3 py-2 text-xs font-extrabold text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.12)] transition hover:bg-cyan-400/20'
										>
											<Sigma className='h-4 w-4' />
											Calculate nested totals
										</button>
										{ledgerRun && (
											<div className='rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-[11px] leading-5 text-slate-400'>
												<span className='font-bold text-slate-200'>{ledgerRun.totalOrders}</span> orders,{' '}
												<span className='font-bold text-slate-200'>{ledgerRun.totalSeats}</span> seats,{' '}
												<span className='font-mono font-bold text-emerald-300'>{formatCurrency(ledgerRun.grandTotal)}</span>{' '}
												at <span className='font-mono text-cyan-200'>{ledgerRun.timestamp}</span>.
											</div>
										)}
									</div>
								</div>
								<div className='rounded-lg border border-slate-800 bg-slate-900/70 p-3'>
									<div className='mb-2 flex items-center gap-2 font-bold text-white'>
										<Boxes className='h-4 w-4 text-violet-300' />
										Master detail
									</div>
									<p className='text-xs leading-5 text-slate-400'>
										Uses detail row portals with nested grids. Child grid edits recalculate subtotal cells and push totals back to
										the parent order row.
									</p>
								</div>
								<Pill tone='violet'>{orderRows.length} master rows</Pill>
							</div>
						)}

						<div className='mt-auto rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs leading-5 text-slate-400'>
							<div className='mb-2 flex items-center gap-2 font-bold text-slate-200'>
								<RefreshCw className='h-4 w-4 text-slate-400' />
								Shared package example
							</div>
							The demo app and docs import this same component from{' '}
							<code className='rounded bg-slate-950 px-1.5 py-0.5 text-cyan-200'>@eregister/wit-grid-examples</code>.
						</div>
					</aside>
				)}
			</div>
		</div>
	);
}
