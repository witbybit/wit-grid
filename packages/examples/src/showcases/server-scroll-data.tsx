import type { CellRendererProps, ColumnDef, FilterModel, InfiniteDatasource, SortModel } from '@eregister/wit-grid-react';

export type ServerAuditRow = {
	id: string;
	timestamp: string;
	service: string;
	severity: string;
	latencyMs: string;
	ipAddress: string;
};

function ServiceBadgeRenderer({ value }: CellRendererProps<any>) {
	const service = String(value);
	let tone = 'border-l-indigo-500 text-indigo-300 bg-indigo-950/10';
	if (service === 'Auth') tone = 'border-l-purple-500 text-purple-300 bg-purple-950/10';
	else if (service === 'Billing') tone = 'border-l-emerald-500 text-emerald-300 bg-emerald-950/10';
	else if (service === 'Database') tone = 'border-l-amber-500 text-amber-300 bg-amber-950/10';
	else if (service === 'Cache') tone = 'border-l-cyan-500 text-cyan-300 bg-cyan-950/10';
	return (
		<span className={`inline-block rounded border border-slate-900 border-l-2 px-2 py-0.5 text-[10px] font-bold leading-none ${tone}`}>
			{service}
		</span>
	);
}

function RiskBadgeRenderer({ value, isFocused, isSelected }: CellRendererProps<any>) {
	const severity = String(value).toUpperCase();
	let tone = 'bg-slate-500/10 border-slate-700/50 text-slate-400';
	if (severity === 'CRITICAL' || severity === 'ERROR') tone = 'bg-rose-950/45 border-rose-500/35 text-rose-400 font-black';
	else if (severity === 'WARNING') tone = 'bg-amber-950/40 border-amber-500/30 text-amber-400 font-extrabold';
	else if (severity === 'INFO') tone = 'bg-indigo-950/30 border-indigo-500/25 text-indigo-400 font-bold';
	else if (severity === 'DEBUG') tone = 'bg-emerald-950/30 border-emerald-500/25 text-emerald-400 font-medium';
	const ring = isFocused || isSelected ? 'ring-1 ring-cyan-400/60' : '';
	return (
		<span className={`inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider leading-none ${ring} ${tone}`}>
			{severity}
		</span>
	);
}

function RendererStrategyProbe({ value, phase, isScrolling, isFocused, isSelected }: CellRendererProps<any>) {
	const [strategy, label] = String(value ?? '').split('|');
	const tone =
		strategy === 'live'
			? 'border-emerald-500/40 bg-emerald-950/25 text-emerald-300'
			: strategy === 'defer'
				? 'border-indigo-500/40 bg-indigo-950/25 text-indigo-300'
				: strategy === 'destroy'
					? 'border-amber-500/40 bg-amber-950/25 text-amber-300'
					: 'border-rose-500/40 bg-rose-950/25 text-rose-300';
	const ring = isFocused || isSelected ? 'ring-1 ring-cyan-400/60' : '';
	return (
		<span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-mono leading-none ${tone} ${ring}`}>
			<span className='font-black uppercase'>{strategy}</span>
			<span className='text-slate-300'>{label}</span>
			<span className={isScrolling ? 'text-cyan-300' : 'text-slate-500'}>{phase ?? 'initial'}</span>
		</span>
	);
}

function LatencyRenderer({ value }: CellRendererProps<any>) {
	const latency = Number(value) || 0;
	const tone = latency > 500 ? 'text-rose-400 font-bold' : latency > 150 ? 'text-amber-400 font-semibold' : 'text-emerald-400';
	return <span className={`font-mono text-xs ${tone}`}>{latency} ms</span>;
}

export function createServerColumns(): ColumnDef<ServerAuditRow>[] {
	return [
		{ field: 'id', header: 'Trace ID', width: 130 },
		{ field: 'timestamp', header: 'Timestamp', width: 220 },
		{
			field: 'service',
			header: 'Microservice',
			width: 140,
			renderer: { kind: 'react', component: ServiceBadgeRenderer, capabilities: { scrollPresentation: 'html-snapshot' } },
		},
		{
			field: 'rendererLive',
			header: 'Live Rebind',
			width: 170,
			renderer: { kind: 'react', component: RendererStrategyProbe, capabilities: { scrollPresentation: 'live' } },
			valueGetter: ({ row }) => `live|${row.service}`,
		},
		{
			field: 'rendererDefer',
			header: 'Defer Stable',
			width: 170,
			renderer: { kind: 'react', component: RendererStrategyProbe, capabilities: { scrollPresentation: 'freeze' } },
			valueGetterDependencies: ['severity'],
			valueGetter: ({ row }) => `defer|${row.severity}`,
		},
		{
			field: 'rendererSnap',
			header: 'Defer + Snap',
			width: 185,
			renderer: { kind: 'react', component: RendererStrategyProbe, capabilities: { scrollPresentation: 'html-snapshot' } },
			valueGetterDependencies: ['severity'],
			valueGetter: ({ row }) => `defer|${row.severity}`,
		},
		{
			field: 'severity',
			header: 'Severity',
			width: 120,
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
			const rows = buildRows(params.sortModel as SortModel | undefined, params.filterModel as FilterModel | undefined);
			await new Promise((resolve) => setTimeout(resolve, 250));
			return { rows: rows.slice(params.startRow, params.endRow), totalCount: rows.length };
		},
	};
}
