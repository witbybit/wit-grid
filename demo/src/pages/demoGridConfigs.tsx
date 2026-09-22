import {
	dropdownColumnType,
	multiSelectColumnType,
	numberColumnType,
	type ColumnDef,
	type FilterModel,
	type GridApi,
	type InfiniteDatasource,
	type SortModel,
} from '@eregister/wit-grid-react';
import {
	GanttStatusBadgeRenderer,
	GanttStatusDropdownEditor,
	GanttTimelineRenderer,
	GreeksRenderer,
	LatencyProfiler,
	LatencyRenderer,
	PriceBadgeRenderer,
	ProgressBarRenderer,
	ProgressSliderEditor,
	RendererStrategyProbe,
	RiskBadgeRenderer,
	ServiceBadgeRenderer,
	StarRatingRenderer,
	StatusBadgeRenderer,
	StatusDropdownEditor,
	StatusHeaderFilter,
	generateCustomShowcaseRows,
	generatePerformanceRows,
	type CustomShowcaseRow,
	type PerformanceRow,
	type SpreadsheetRow,
} from '../components/GridShared';
import { HeavyAnalyticsCell, LivePriceRenderer, SparklineRenderer, type DashboardStockRow } from '../components/FastRenderers';

export type ServerAuditRow = {
	id: string;
	timestamp: string;
	service: string;
	severity: string;
	latencyMs: string;
	ipAddress: string;
};

export type GanttRow = {
	id: string;
	name: string;
	owner: string;
	sprintDay: number;
	durationDays: number;
	progress: number;
	status: 'Done' | 'In Progress' | 'Pending' | 'Blocked';
};

export const layoutColumnsFull: ColumnDef<PerformanceRow>[] = [
	{ field: 'id', header: 'Option ID', width: 180 },
	{ field: 'name', header: 'Underlying', width: 100 },
	{ field: 'price', header: 'Strike ($)', width: 100 },
	{ field: 'quantity', header: 'Implied Vol %', width: 110 },
	{
		field: 'subtotal',
		header: 'Delta Δ',
		width: 100,
		renderer: { kind: 'react', component: GreeksRenderer },
		valueGetterDependencies: ['price', 'quantity'],
		valueGetter: ({ row }) => {
			const vol = parseFloat(row.quantity) || 20;
			const strike = parseFloat(row.price) || 100;
			const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
			return (0.5 + 0.5 * Math.tanh(d1)).toFixed(4);
		},
	},
	{
		field: 'status',
		header: 'Risk Profile',
		width: 120,
		cellEditor: StatusDropdownEditor,
		renderer: { kind: 'react', component: RiskBadgeRenderer },
		valueGetter: ({ row }) => (row.status === 'Active' ? 'LOW' : row.status === 'Pending' ? 'MEDIUM' : 'HIGH'),
	},
];

export function setInactiveRiskSideEffects(api: GridApi<any>, rowId: string, colField: string, value: unknown) {
	if (colField === 'status' && value === 'Inactive') {
		api.setCellValue(rowId, 'price', '0');
		api.setCellValue(rowId, 'quantity', '0');
	}
}

export function createPerformanceColumns(massiveColumns: boolean): ColumnDef<PerformanceRow>[] {
	const columns: ColumnDef<PerformanceRow>[] = [
		{ field: 'id', header: 'Option ID', width: 180 },
		{ field: 'name', header: 'Underlying', width: 100 },
		{ field: 'price', header: 'Strike ($)', width: 100 },
		{ field: 'quantity', header: 'Implied Vol %', width: 110 },
		{
			field: 'delta',
			header: 'Delta Δ',
			width: 90,
			renderer: { kind: 'react', component: GreeksRenderer, capabilities: { scrollPresentation: 'freeze' } },
			valueGetterDependencies: ['price', 'quantity'],
			valueGetter: ({ row }) => {
				const vol = parseFloat(row.quantity) || 20;
				const strike = parseFloat(row.price) || 100;
				const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
				return (0.5 + 0.5 * Math.tanh(d1)).toFixed(4);
			},
		},
		{
			field: 'gamma',
			header: 'Gamma Γ',
			width: 95,
			renderer: { kind: 'react', component: GreeksRenderer, capabilities: { scrollPresentation: 'freeze' } },
			valueGetterDependencies: ['price', 'quantity'],
			valueGetter: ({ row }) => {
				const vol = parseFloat(row.quantity) || 20;
				const strike = parseFloat(row.price) || 100;
				const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
				return (Math.exp((-d1 * d1) / 2) / (100 * (vol / 100) * Math.sqrt(2 * Math.PI))).toFixed(5);
			},
		},
		{
			field: 'vega',
			header: 'Vega ν',
			width: 90,
			renderer: { kind: 'react', component: GreeksRenderer, capabilities: { scrollPresentation: 'freeze' } },
			valueGetterDependencies: ['price', 'quantity'],
			valueGetter: ({ row }) => {
				const vol = parseFloat(row.quantity) || 20;
				const strike = parseFloat(row.price) || 100;
				const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
				return ((100 * Math.exp((-d1 * d1) / 2)) / Math.sqrt(2 * Math.PI) / 100).toFixed(4);
			},
		},
		{
			field: 'theta',
			header: 'Theta θ',
			width: 90,
			renderer: { kind: 'react', component: GreeksRenderer, capabilities: { scrollPresentation: 'freeze' } },
			valueGetterDependencies: ['price', 'quantity'],
			valueGetter: ({ row }) => {
				const vol = parseFloat(row.quantity) || 20;
				const strike = parseFloat(row.price) || 100;
				const d1 = (Math.log(100 / strike) + (0.05 + (vol * vol) / 20000)) / (vol / 100 || 0.01);
				const theta =
					-(100 * (vol / 100) * Math.exp((-d1 * d1) / 2)) / (2 * Math.sqrt(2 * Math.PI)) -
					0.05 * strike * Math.exp(-0.05) * (0.5 + 0.5 * Math.tanh(d1));
				return (theta / 365).toFixed(4);
			},
		},
		{
			field: 'status',
			header: 'Risk Rating',
			width: 110,
			cellEditor: StatusDropdownEditor,
			// scrollPresentation: 'html-snapshot' — LOW/MEDIUM/HIGH risk badges keep their glow and
			// color during fast scroll without any React re-render. The static clone is replaced by
			// the live portal on the next post-scroll fidelity pass.
			renderer: { kind: 'react', component: RiskBadgeRenderer, capabilities: { scrollPresentation: 'html-snapshot' } },
			valueGetter: ({ row }) => (row.status === 'Active' ? 'LOW' : row.status === 'Pending' ? 'MEDIUM' : 'HIGH'),
		},
	];

	if (massiveColumns) {
		for (let index = 0; index < 1000; index++) {
			columns.push({
				field: `col_${index}`,
				header: `Col ${index}`,
				width: 100,
				valueGetter: ({ row }) => (row as any)[`col_${index}`] ?? `Val ${index}`,
			});
		}
	}

	return columns;
}

export function createServerColumns(): ColumnDef<ServerAuditRow>[] {
	return [
		{ field: 'id', header: 'Trace ID', width: 130 },
		{ field: 'timestamp', header: 'Timestamp', width: 220 },
		{
			field: 'service',
			header: 'Microservice',
			width: 140,
			// scrollPresentation: 'html-snapshot' — after the first fidelity render the grid captures
			// the badge's styled HTML (colored left-border pill) and injects it as a static clone
			// during scroll. The service chip looks exactly the same while the grid is in motion.
			renderer: { kind: 'react', component: ServiceBadgeRenderer, capabilities: { scrollPresentation: 'html-snapshot' } },
		},
		{
			field: 'rendererLive',
			header: 'Live Rebind',
			width: 170,
			// scrollPresentation: 'live' — the real renderer mounts/updates on every scroll frame,
			// unlike every other column here which freezes or shows an impostor during scroll.
			renderer: { kind: 'react', component: RendererStrategyProbe, capabilities: { scrollPresentation: 'live' } },
			valueGetter: ({ row }) => `live|${row.service}`,
		},
		{
			field: 'rendererDefer',
			header: 'Defer Stable',
			width: 170,
			// Plain text impostor — shows raw "defer|INFO scroll-idle" text during scroll.
			// Compare with the Snap column next to it to see the visual difference.
			renderer: { kind: 'react', component: RendererStrategyProbe, capabilities: { scrollPresentation: 'freeze' } },
			valueGetterDependencies: ['severity'],
			valueGetter: ({ row }) => `defer|${row.severity}`,
		},
		{
			field: 'rendererSnap',
			header: 'Defer + Snap',
			width: 185,
			// scrollPresentation: 'html-snapshot' opt-in — same renderer and data as "Defer Stable" but
			// the grid captures the badge HTML after each fidelity render and replays it during scroll.
			// Scroll fast and compare: this column shows styled chips, the one to its left shows text.
			renderer: {
				kind: 'react',
				component: RendererStrategyProbe,
				capabilities: { scrollPresentation: 'html-snapshot' },
			},
			valueGetterDependencies: ['severity'],
			valueGetter: ({ row }) => `defer|${row.severity}`,
		},
		{
			field: 'severity',
			header: 'Severity',
			width: 120,
			// scrollPresentation: 'html-snapshot' — the CRITICAL/ERROR/WARNING risk badges preserve
			// their glow colors and typography during scroll without any React re-render.
			renderer: { kind: 'react', component: RiskBadgeRenderer, capabilities: { scrollPresentation: 'html-snapshot' } },
		},
		{
			field: 'rendererFallback',
			header: 'Defer Freeze',
			width: 175,
			renderer: { kind: 'react', component: RendererStrategyProbe, capabilities: { scrollPresentation: 'freeze' } },
			valueGetterDependencies: ['latencyMs'],
			valueGetter: ({ row }) => `defer|${row.latencyMs}ms`,
		},
		{
			field: 'rendererDestroy',
			header: 'Destroy Recycle',
			width: 180,
			renderer: { kind: 'react', component: RendererStrategyProbe, capabilities: { scrollPresentation: 'freeze' } },
			valueGetterDependencies: ['ipAddress'],
			valueGetter: ({ row }) => `destroy|${row.ipAddress}`,
		},
		{ field: 'latencyMs', header: 'Latency', width: 110, renderer: { kind: 'react', component: LatencyRenderer } },
		{ field: 'ipAddress', header: 'Origin IP', width: 140 },
	];
}

export function createServerRows(): ServerAuditRow[] {
	const services = ['Auth', 'Billing', 'Database', 'Cache', 'API Gateway', 'Shipping'];
	const severities = ['DEBUG', 'INFO', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
	return Array.from({ length: 100000 }, (_, index) => {
		const latency = index % 8 === 0 ? Math.floor(Math.random() * 900) + 350 : Math.floor(Math.random() * 85) + 15;
		return {
			id: `TR-${100000 + index}`,
			timestamp: new Date(Date.now() - index * 60000).toISOString(),
			service: services[index % services.length],
			severity: severities[index % severities.length],
			latencyMs: latency.toString(),
			ipAddress: `192.168.1.${(index * 7) % 255}`,
		};
	});
}

export function createServerDatasource(serverRows: ServerAuditRow[]): InfiniteDatasource<ServerAuditRow> {
	let cachedSortKey = '';
	let cachedFilterKey = '';
	let cachedRows = serverRows;

	const buildRows = (sortModel: SortModel | undefined, filterModel: FilterModel | undefined) => {
		const sortKey = JSON.stringify(sortModel ?? []);
		const filterKey = JSON.stringify(filterModel ?? {});
		if (sortKey === cachedSortKey && filterKey === cachedFilterKey) return cachedRows;

		cachedSortKey = sortKey;
		cachedFilterKey = filterKey;
		let rows = serverRows;
		const statusFilter = filterModel?.status as any;
		if (statusFilter?.value) {
			if (statusFilter.value === 'Active') rows = rows.filter((row) => row.severity === 'CRITICAL' || row.severity === 'ERROR');
			else if (statusFilter.value === 'Pending') rows = rows.filter((row) => row.severity === 'WARNING');
			else if (statusFilter.value === 'Inactive') rows = rows.filter((row) => row.severity === 'INFO' || row.severity === 'DEBUG');
		}
		if (sortModel?.length) {
			rows = [...rows].sort((leftRow, rightRow) => {
				for (const item of sortModel) {
					const field = item.colId as keyof ServerAuditRow;
					const left = leftRow[field];
					const right = rightRow[field];
					const leftNum = Number(left);
					const rightNum = Number(right);
					const cmp =
						!Number.isNaN(leftNum) && !Number.isNaN(rightNum)
							? leftNum - rightNum
							: String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
					if (cmp !== 0) return item.sort === 'desc' ? -cmp : cmp;
				}
				return 0;
			});
		}
		cachedRows = rows;
		return rows;
	};

	return {
		getRows: async (params) => {
			const start = performance.now();
			const rows = buildRows(params.sortModel as SortModel | undefined, params.filterModel as FilterModel | undefined);
			await new Promise((resolve) => setTimeout(resolve, 250));
			LatencyProfiler.record(performance.now() - start);
			return { rows: rows.slice(params.startRow, params.endRow), totalCount: rows.length };
		},
	};
}

export function createSpreadsheetColumns(): ColumnDef<SpreadsheetRow>[] {
	return [
		{
			field: 'id',
			header: 'Fiscal Period',
			width: 130,
			valueGetter: ({ node }) => {
				const index = Number(node.id.replace('S-', '')) - 1000;
				return `${2026 + Math.floor((Number.isFinite(index) ? index : 0) / 4)} Q${((Number.isFinite(index) ? index : 0) % 4) + 1}`;
			},
		},
		{ field: 'A', header: 'Revenue ($M)', width: 120 },
		{ field: 'B', header: 'OpEx ($M)', width: 120 },
		{ field: 'C', header: 'Net Income ($M)', width: 140 },
		{ field: 'D', header: 'CAGR (%)', width: 110 },
		{ field: 'E', header: 'Interest Rate (%)', width: 140 },
		{ field: 'F', header: 'Discount Factor', width: 140 },
	];
}

export function createSpreadsheetRows(): SpreadsheetRow[] {
	const rows = Array.from({ length: 500 }, (_, index) => {
		const rowId = `S-${1000 + index}`;
		return {
			id: rowId,
			A: (120 + index * 4.5).toFixed(1),
			B: (75 + index * 1.8).toFixed(1),
			C: '',
			D: '5.5',
			E: '4.25',
			F: '',
		};
	});
	for (let index = 0; index < 15; index++) {
		const rowId = `S-${1000 + index}`;
		rows[index].C = `=SUM([${rowId}:A],-[${rowId}:B])`;
		rows[index].F = `=[${rowId}:C]*0.8`;
	}
	return rows;
}

export function createCustomColumns(): ColumnDef<CustomShowcaseRow>[] {
	return [
		{ field: 'id', header: 'Asset ID', width: 100 },
		{ field: 'name', header: 'Premium Asset', width: 180 },
		{
			field: 'price',
			header: 'Acquisition Cost ($)',
			width: 150,
			renderer: {
				kind: 'react',
				component: PriceBadgeRenderer,
				capabilities: { scrollPresentation: 'live', live: { priority: 'high', allowEmergencyShell: true, update: 'react' } },
			},
		},
		{
			field: 'rating',
			header: 'Client Rating',
			width: 160,
			renderer: {
				kind: 'react',
				component: StarRatingRenderer,
				capabilities: { scrollPresentation: 'live', live: { priority: 'high', update: 'react', allowEmergencyShell: true } },
			},
		},
		{
			field: 'progress',
			header: 'Deployment Status',
			width: 170,
			renderer: {
				kind: 'react',
				component: ProgressBarRenderer,
				capabilities: { scrollPresentation: 'live', live: { priority: 'high', allowEmergencyShell: true, update: 'react' } },
			},
			cellEditor: ProgressSliderEditor,
		},
		{
			field: 'status',
			header: 'Operational Status',
			width: 140,
			renderer: {
				kind: 'react',
				component: StatusBadgeRenderer,
				capabilities: { scrollPresentation: 'live', live: { priority: 'high', allowEmergencyShell: true, update: 'react' } },
			},
			cellEditor: StatusDropdownEditor,
			headerMenuComponent: StatusHeaderFilter,
		},
	];
}

export function createSkinsColumns(): ColumnDef<PerformanceRow>[] {
	return [
		{ field: 'id', header: 'Token ID', width: 150 },
		{ field: 'name', header: 'Token Key', width: 160 },
		{ field: 'price', header: 'Raw Value ($)', width: 130, renderer: { kind: 'react', component: PriceBadgeRenderer } },
		{ field: 'quantity', header: 'Allocated Scale', width: 130 },
		{
			field: 'status',
			header: 'Luxe Status',
			width: 130,
			cellEditor: StatusDropdownEditor,
			renderer: { kind: 'react', component: RiskBadgeRenderer },
			valueGetter: ({ row }) => (row.status === 'Active' ? 'LOW' : row.status === 'Pending' ? 'MEDIUM' : 'HIGH'),
		},
	];
}

const SEED_STOCKS = [
	{ id: 'AAPL', name: 'Apple Inc.', price: 175.5 },
	{ id: 'MSFT', name: 'Microsoft Corp.', price: 420.2 },
	{ id: 'GOOGL', name: 'Alphabet Inc.', price: 150.1 },
	{ id: 'NVDA', name: 'NVIDIA Corp.', price: 875 },
	{ id: 'TSLA', name: 'Tesla Inc.', price: 170.3 },
	{ id: 'AMZN', name: 'Amazon.com Inc.', price: 178.4 },
	{ id: 'NFLX', name: 'Netflix Inc.', price: 610.5 },
	{ id: 'AMD', name: 'Advanced Micro Devices', price: 180.2 },
];

export function createDashboardRows(): DashboardStockRow[] {
	return Array.from({ length: 400 }, (_, index) => {
		const stock = SEED_STOCKS[index % SEED_STOCKS.length];
		const change = ((index * 13) % 120) / 10 - 6;
		const volume = 5 + ((index * 17) % 120);
		return {
			id: `${stock.id}${index >= SEED_STOCKS.length ? `.${Math.floor(index / SEED_STOCKS.length)}` : ''}`,
			symbol: stock.id,
			name: stock.name,
			price: (stock.price * (0.75 + ((index * 7) % 50) / 100)).toFixed(2),
			change: `${change >= 0 ? '+' : ''}${change.toFixed(1)}`,
			volume: volume.toFixed(1),
			risk: stock.price > 500 || Math.abs(change) > 4 ? 'high' : Math.abs(change) > 2 ? 'medium' : 'low',
		};
	});
}

export function createDashboardColumns(): ColumnDef<DashboardStockRow>[] {
	return [
		{ field: 'symbol', header: 'Ticker', width: 80 },
		{ field: 'name', header: 'Company', width: 160 },
		{
			field: 'price',
			header: 'Price (DOM)',
			width: 130,
			renderer: {
				kind: 'dom',
				renderer: SparklineRenderer,
				capabilities: { scrollPresentation: 'html-snapshot', htmlSnapshot: { allowShellWhenMissing: true } },
			},
		},
		{ field: 'change', header: 'Change % (Imperative)', width: 165, renderer: { kind: 'imperativeReact', component: LivePriceRenderer } },
		{ field: 'volume', header: 'Vol/Analytics (React)', width: 165, renderer: { kind: 'react', component: HeavyAnalyticsCell } },
		{ field: 'risk', header: 'Risk', width: 90 },
	];
}

export function createGanttColumns(): ColumnDef<GanttRow>[] {
	return [
		{ field: 'id', header: 'Task ID', width: 90 },
		{ field: 'name', header: 'Task Description', width: 170 },
		{ field: 'owner', header: 'Owner', width: 110 },
		{ field: 'sprintDay', header: 'Sprint Start', width: 100 },
		{ field: 'durationDays', header: 'Duration (Days)', width: 120 },
		{ field: 'progress', header: 'Progress (%)', width: 110 },
		{
			field: 'status',
			header: 'Status',
			width: 120,
			renderer: { kind: 'react', component: GanttStatusBadgeRenderer },
			cellEditor: GanttStatusDropdownEditor,
		},
		{
			field: 'timeline',
			header: 'Gantt Sprint Timeline (30 Days)',
			width: 280,
			renderer: { kind: 'react', component: GanttTimelineRenderer },
			valueGetterDependencies: ['status', 'sprintDay', 'durationDays', 'progress'],
			valueGetter: ({ row }) => `${row.status}|${row.sprintDay}|${row.durationDays}|${row.progress}`,
		},
	];
}

export function createGanttRows(): GanttRow[] {
	const tasks = [
		'Project Blueprint Mapping',
		'User Persona Def & Scoping',
		'Visual Branding & Palette Setup',
		'Database Schema Architecture',
		'API Endpoints Design',
		'Auth Token Core Integration',
		'DOM Recycle Engine Refactoring',
		'Layout Render Optimization',
		'Drag-to-Fill Anchor Handle',
		'Extrapolation Mathematics',
	];
	const owners = ['Rishi', 'Alice', 'Sarah', 'Bob'];
	return Array.from({ length: 30 }, (_, index) => {
		const status: GanttRow['status'] = index < 6 ? 'Done' : index < 12 ? 'In Progress' : index % 7 === 0 ? 'Blocked' : 'Pending';
		return {
			id: `T-${1000 + index}`,
			name: tasks[index % tasks.length],
			owner: owners[index % owners.length],
			sprintDay: index === 0 ? 1 : Math.max(1, index * 2 - 1),
			durationDays: Math.floor(Math.random() * 5) + 2,
			progress: status === 'Done' ? 100 : status === 'In Progress' ? Math.floor(Math.random() * 60) + 20 : 0,
			status,
		};
	});
}

export function createSimpleFeatureRows(label: string, count: number) {
	const statuses = ['Active', 'Pending', 'Inactive'] as const;
	return Array.from({ length: count }, (_, index) => ({
		id: `${label}-${1000 + index}`,
		name: `${label} ${index + 1}`,
		category: ['Group A', 'Group B', 'Group C'][index % 3],
		status: statuses[index % statuses.length],
		value: ((index * 7919) % 90000) + 1000,
		quantity: 1 + ((index * 17) % 500),
	}));
}

export function createSimpleFeatureColumns(): ColumnDef<any>[] {
	return [
		{ field: 'id', header: 'ID', width: 140, sortable: true },
		{ field: 'name', header: 'Name', width: 180, sortable: true },
		{ field: 'category', header: 'Category', width: 130, sortable: true, enableRowGroup: true },
		{ field: 'status', header: 'Status', width: 120, sortable: true, renderer: { kind: 'react', component: StatusBadgeRenderer } },
		{ field: 'value', header: 'Value', width: 120, sortable: true, renderer: { kind: 'react', component: PriceBadgeRenderer } },
		{ field: 'quantity', header: 'Qty', width: 90, sortable: true },
	];
}

export function createNativeRows() {
	const statuses = ['Active', 'Pending', 'Inactive'] as const;
	const skills = ['React', 'TypeScript', 'Node', 'Design', 'Testing', 'Data'];
	return Array.from({ length: 1200 }, (_, index) => ({
		id: `SK-${1000 + index}`,
		active: index % 3 !== 0 ? 'true' : 'false',
		name: `Skater ${index + 1}`,
		status: statuses[index % statuses.length],
		tags: [skills[index % skills.length], skills[(index + 2) % skills.length]].join(','),
		startDate: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
		score: String(50 + (index % 50)),
	}));
}

export function createNativeColumns(): ColumnDef<any>[] {
	return [
		{ field: 'active', header: 'Active', width: 80, type: 'checkbox' },
		{ field: 'id', header: 'ID', width: 100 },
		{ field: 'name', header: 'Name', width: 160 },
		{ field: 'status', header: 'Status', width: 130, type: 'statusBadge' },
		{ field: 'tags', header: 'Tags', width: 180, type: 'skills' },
		{ field: 'startDate', header: 'Start Date', width: 130, type: 'date' },
		{ field: 'score', header: 'Score', width: 110, type: 'score' },
	];
}

export function createNativeColumnTypes() {
	return {
		skills: multiSelectColumnType(['React', 'TypeScript', 'Node', 'Design', 'Testing', 'Data'], 2),
		statusBadge: dropdownColumnType([
			{ value: 'Active', color: 'emerald' },
			{ value: 'Pending', color: 'amber' },
			{ value: 'Inactive', color: 'default' },
		]),
		score: numberColumnType({ min: 0, max: 100, step: 1, suffix: ' pts' }),
	};
}

export { generateCustomShowcaseRows, generatePerformanceRows };
