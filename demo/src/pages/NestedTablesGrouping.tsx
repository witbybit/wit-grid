import React, { useState, useMemo, useCallback } from 'react';
import { Grid, type ColumnDef, type CellRendererProps, type GridApi, type GridReadyEvent, type VisualRow } from '@eregister/wit-grid-react';
import {
	Layers,
	FolderTree,
	ArrowDownWideNarrow,
	Folder,
	File,
	ChevronRight,
	ChevronDown,
	PackageOpen,
	CheckCircle,
	RefreshCw,
	Sparkles,
	User,
	Settings,
	ShieldAlert,
} from 'lucide-react';
import { LatencyProfiler, StatusBadgeRenderer, PriceBadgeRenderer } from '../components/GridShared';

// ============================================================================
// Types
// ============================================================================

interface EmployeeRow {
	id: string;
	name: string;
	department: string;
	title: string;
	rating: number;
	salary: number;
}

interface FileNodeRow {
	id: string;
	name: string;
	type: 'folder' | 'tsx' | 'json' | 'css' | 'md';
	size?: string;
	modifiedAt?: string;
	parentId?: string;
}

interface OrderRow {
	id: string;
	customerName: string;
	orderDate: string;
	totalAmount: number;
	status: 'Shipped' | 'Pending' | 'Cancelled';
}

interface OrderItemRow {
	id: string;
	itemName: string;
	price: number;
	quantity: number;
	subtotal: number;
}

// ============================================================================
// Mock Data Generators
// ============================================================================

const groupRows: EmployeeRow[] = [
	{ id: 'EMP-01', name: 'Rishi Patel', department: 'Engineering', title: 'Principal Architect', rating: 5, salary: 185000 },
	{ id: 'EMP-02', name: 'Sarah Connor', department: 'Engineering', title: 'Staff Engineer', rating: 5, salary: 160000 },
	{ id: 'EMP-03', name: 'John Doe', department: 'Engineering', title: 'Senior Developer', rating: 4, salary: 120000 },
	{ id: 'EMP-04', name: 'Jane Smith', department: 'Design', title: 'Lead Designer', rating: 5, salary: 140000 },
	{ id: 'EMP-05', name: 'Alex Mercer', department: 'Design', title: 'Product Designer', rating: 4, salary: 95000 },
	{ id: 'EMP-06', name: 'David Miller', department: 'Product', title: 'Director of Product', rating: 5, salary: 165000 },
	{ id: 'EMP-07', name: 'Emily Vance', department: 'Product', title: 'Product Manager', rating: 4, salary: 110000 },
	{ id: 'EMP-08', name: 'Gordon Freeman', department: 'Research', title: 'Theoretical Physicist', rating: 5, salary: 250000 },
	{ id: 'EMP-09', name: 'Alyx Vance', department: 'Research', title: 'Field Researcher', rating: 5, salary: 130000 },
	{ id: 'EMP-10', name: 'Isaac Kleiner', department: 'Research', title: 'Lab Coordinator', rating: 4, salary: 155000 },
];

const treeRows: FileNodeRow[] = [
	{ id: 'root', name: 'wit-grid-monorepo', type: 'folder' },
	{ id: 'packages', name: 'packages', type: 'folder', parentId: 'root' },
	{ id: 'core', name: 'core', type: 'folder', parentId: 'packages' },
	{ id: 'core-src', name: 'src', type: 'folder', parentId: 'core' },
	{ id: 'store-tsx', name: 'store.ts', type: 'tsx', size: '24.5 KB', modifiedAt: '2 hours ago', parentId: 'core-src' },
	{ id: 'rowmodel-tsx', name: 'rowModel.ts', type: 'tsx', size: '15.4 KB', modifiedAt: '1 day ago', parentId: 'core-src' },
	{ id: 'packages-json', name: 'package.json', type: 'json', size: '1.8 KB', modifiedAt: '3 days ago', parentId: 'core' },

	{ id: 'react', name: 'react', type: 'folder', parentId: 'packages' },
	{ id: 'react-src', name: 'src', type: 'folder', parentId: 'react' },
	{ id: 'grid-surface-tsx', name: 'GridSurface.tsx', type: 'tsx', size: '17.1 KB', modifiedAt: '5 mins ago', parentId: 'react-src' },
	{ id: 'gridportal-tsx', name: 'GridPortal.tsx', type: 'tsx', size: '8.4 KB', modifiedAt: '2 hours ago', parentId: 'react-src' },

	{ id: 'demo', name: 'demo', type: 'folder', parentId: 'root' },
	{ id: 'demo-src', name: 'src', type: 'folder', parentId: 'demo' },
	{ id: 'app-tsx', name: 'App.tsx', type: 'tsx', size: '11.2 KB', modifiedAt: 'Just now', parentId: 'demo-src' },
	{ id: 'nested-tsx', name: 'NestedTablesGrouping.tsx', type: 'tsx', size: '12.0 KB', modifiedAt: 'Just now', parentId: 'demo-src' },
	{ id: 'readme-md', name: 'README.md', type: 'md', size: '4.2 KB', modifiedAt: 'Last week', parentId: 'root' },
];

const masterRows: OrderRow[] = [
	{ id: 'ORD-101', customerName: 'Apex Capital', orderDate: '2026-05-28', totalAmount: 4950.0, status: 'Shipped' },
	{ id: 'ORD-102', customerName: 'Cyberdyne Systems', orderDate: '2026-05-27', totalAmount: 12400.0, status: 'Pending' },
	{ id: 'ORD-103', customerName: 'Umbrella Corp', orderDate: '2026-05-26', totalAmount: 3120.5, status: 'Shipped' },
	{ id: 'ORD-104', customerName: 'Weyland-Yutani', orderDate: '2026-05-25', totalAmount: 18450.0, status: 'Cancelled' },
	{ id: 'ORD-105', customerName: 'Initech Inc', orderDate: '2026-05-24', totalAmount: 150.0, status: 'Shipped' },
];

// Inner nested order items maps
const orderItemsMap: Record<string, OrderItemRow[]> = {
	'ORD-101': [
		{ id: 'ITM-01', itemName: 'High-Freq Options Feed Sub', price: 2500, quantity: 1, subtotal: 2500 },
		{ id: 'ITM-02', itemName: 'Ultra-Low Latency Port licenses', price: 816.66, quantity: 3, subtotal: 2450 },
	],
	'ORD-102': [{ id: 'ITM-03', itemName: 'T-800 Neural Net CPU Module', price: 6200, quantity: 2, subtotal: 12400 }],
	'ORD-103': [{ id: 'ITM-04', itemName: 'T-Virus Containment Capsule', price: 1560.25, quantity: 2, subtotal: 3120.5 }],
	'ORD-104': [
		{ id: 'ITM-05', itemName: 'M41A Pulse Rifle Replica Pro', price: 2050, quantity: 5, subtotal: 10250 },
		{ id: 'ITM-06', itemName: 'Power Loader Hydraulic Core', price: 4100, quantity: 2, subtotal: 8200 },
	],
	'ORD-105': [{ id: 'ITM-07', itemName: 'Red Swingline Stapler (Special)', price: 75, quantity: 2, subtotal: 150 }],
};

const initialQuantities: Record<string, number> = {
	'ITM-01': 1,
	'ITM-02': 3,
	'ITM-03': 2,
	'ITM-04': 2,
	'ITM-05': 5,
	'ITM-06': 2,
	'ITM-07': 2,
};

// ============================================================================
// Custom Renderers
// ============================================================================

const SalaryRenderer = ({ value }: CellRendererProps<EmployeeRow>) => {
	const sal = parseFloat(String(value)) || 0;
	return <span className='font-mono font-bold text-slate-200'>${sal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>;
};

const RatingStarsRenderer = ({ value }: CellRendererProps<EmployeeRow>) => {
	const stars = Math.min(5, Math.max(0, Number(value) || 0));
	return (
		<div className='flex items-center text-amber-400 select-none h-full'>
			{Array.from({ length: 5 }).map((_, i) => (
				<span key={i} className='text-sm'>
					{i < stars ? '★' : '☆'}
				</span>
			))}
		</div>
	);
};

// Custom Tree node name renderer with indent and folder/file icon!
const TreeNameRenderer = ({ value, row, rowId, api }: CellRendererProps<FileNodeRow>) => {
	const visualRow = api.rows().getVisualRowById(rowId);
	const depth = visualRow && 'depth' in visualRow ? visualRow.depth : 0;

	const isFolder = row.type === 'folder';
	const isExpanded = api.isGroupExpanded(rowId);
	let Icon = File;
	if (isFolder) {
		Icon = Folder;
	}

	const handleToggle = (e: React.MouseEvent) => {
		if (!isFolder) return;
		e.stopPropagation();
		const start = performance.now();
		api.toggleGroupExpanded(rowId);
		LatencyProfiler.record(performance.now() - start);
	};

	return (
		<div className='flex items-center h-full select-none' style={{ paddingLeft: `${depth * 20}px` }}>
			<button
				type='button'
				onClick={handleToggle}
				className='w-4 h-4 mr-1 flex items-center justify-center rounded hover:bg-slate-800 transition-colors'
			>
				{isFolder ? (
					isExpanded ? (
						<ChevronDown className='w-3.5 h-3.5 text-amber-400' />
					) : (
						<ChevronRight className='w-3.5 h-3.5 text-slate-400' />
					)
				) : null}
			</button>
			<Icon className={`w-3.5 h-3.5 mr-2 shrink-0 ${isFolder ? 'text-amber-400' : 'text-slate-400'}`} />
			<span className={`${isFolder ? 'font-semibold text-slate-200' : 'text-slate-300'}`}>{String(value)}</span>
		</div>
	);
};

// Custom detail toggle button in the master grid!
const DetailToggleRenderer = ({ rowId, api }: CellRendererProps<OrderRow>) => {
	const isExpanded = api.isDetailExpanded(rowId);

	const handleToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		api.toggleDetailExpanded(rowId);
	};

	return (
		<button
			onClick={handleToggle}
			className='w-5 h-5 flex items-center justify-center rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors'
		>
			{isExpanded ? <ChevronDown className='w-3.5 h-3.5 text-purple-400' /> : <ChevronRight className='w-3.5 h-3.5 text-slate-400' />}
		</button>
	);
};

// ============================================================================
// Standalone Detail Grid component (Clean, modular, and easy to extract/move to its own file!)
// ============================================================================

interface NestedOrderGridProps {
	visualRow: VisualRow<OrderRow>;
	parentApi: GridApi<OrderRow>;
}

const NestedOrderGrid = ({ visualRow, parentApi }: NestedOrderGridProps) => {
	const [detailApi, setDetailApi] = useState<GridApi<OrderItemRow> | null>(null);
	if (visualRow.kind !== 'detail') return null;
	const orderId = visualRow.parentId;
	const items = orderItemsMap[orderId] || [];

	const detailColumns = useMemo<ColumnDef<OrderItemRow>[]>(
		() => [
			{ field: 'id', header: 'Item ID', width: 100 },
			{ field: 'itemName', header: 'Product Item Name', width: 260 },
			{ field: 'price', header: 'Unit Price', width: 130, renderer: { kind: 'react', component: PriceBadgeRenderer } },
			{ field: 'quantity', header: 'Qty', width: 100 },
			{ field: 'subtotal', header: 'Total Value', width: 140, renderer: { kind: 'react', component: PriceBadgeRenderer } },
		],
		[]
	);

	// Trigger latency profiling on cell change
	const handleChildCellValueChanged = ({
		rowId,
		colField,
		newValue,
	}: {
		rowId: string;
		colField: string;
		oldValue: unknown;
		newValue: unknown;
	}) => {
		const start = performance.now();
		if (colField === 'quantity' && detailApi) {
			const q = parseInt(String(newValue)) || 0;
			const row = detailApi.getRawRowById(rowId);
			if (row) {
				const p = row.price;
				const newSubtotal = q * p;
				detailApi.setCellValue(rowId, 'subtotal', newSubtotal);

				// Mutate the original reference so the cross-grid aggregator reads the correct edited values!
				const originalItem = items.find((itm) => itm.id === rowId);
				if (originalItem) {
					originalItem.quantity = q;
					originalItem.subtotal = newSubtotal;
				}

				// Re-calculate parent grid totals!
				setTimeout(() => {
					let parentSum = 0;
					detailApi.rows().forEach((item) => {
						parentSum += item.subtotal;
					});
					parentApi.setCellValue(orderId, 'totalAmount', parentSum);
				}, 0);
			}
		}
		LatencyProfiler.record(performance.now() - start);
	};

	return (
		<div className='w-full h-full p-4 pl-12 bg-slate-950/90 border-b border-slate-900 flex flex-col gap-2 font-sans relative'>
			<div className='absolute inset-y-0 left-6 w-0.5 bg-gradient-to-b from-purple-500/25 to-pink-500/25' />
			<div className='flex items-center justify-between text-[10px] text-slate-400 font-extrabold uppercase tracking-widest leading-none'>
				<div className='flex items-center gap-2'>
					<PackageOpen className='w-4 h-4 text-purple-400' />
					<span>Order Line Items ({orderId})</span>
				</div>
				<div className='flex items-center gap-1.5 text-purple-400'>
					<Sparkles className='w-3.5 h-3.5 text-purple-400 animate-pulse' />
					Nested Grid Portal mounted successfully
				</div>
			</div>
			<div className='flex-1 min-h-0 border border-slate-850 rounded-lg overflow-hidden bg-slate-950/70 shadow-inner'>
				<Grid
					rowModelType='client'
					rows={items}
					columns={detailColumns}
					enableNavigation={true}
					navigationOptions={{ editTrigger: 'singleClick' }}
					onCellValueChanged={handleChildCellValueChanged}
					onGridReady={({ api }) => setDetailApi(api)}
				/>
			</div>
		</div>
	);
};

// ============================================================================
// Page Component
// ============================================================================

interface NestedTablesGroupingProps {
	onGridReady?: (event: GridReadyEvent<any>) => void;
}

export default function NestedTablesGrouping({ onGridReady }: NestedTablesGroupingProps) {
	const [activeTab, setActiveTab] = useState<'group' | 'tree' | 'detail'>('group');
	const [gridVersion, setGridVersion] = useState(0);

	const [telemetryResult, setTelemetryResult] = useState<{
		totalOrders: number;
		totalQuantity: number;
		grandTotal: number;
		highestItem: string;
		highestPrice: number;
		timestamp: string;
	} | null>(null);

	const handleCalculateTotals = () => {
		let totalQuantity = 0;
		let grandTotal = 0;
		let highestItem = '—';
		let highestPrice = 0;

		for (const orderId of Object.keys(orderItemsMap)) {
			const items = orderItemsMap[orderId] || [];
			for (const item of items) {
				totalQuantity += item.quantity;
				grandTotal += item.subtotal;
				if (item.price > highestPrice) {
					highestPrice = item.price;
					highestItem = item.itemName;
				}
			}
		}

		setTelemetryResult({
			totalOrders: masterRows.length,
			totalQuantity,
			grandTotal,
			highestItem,
			highestPrice,
			timestamp: new Date().toLocaleTimeString(),
		});
	};

	// 1. Grouping Grid config
	const groupingColumns = useMemo<ColumnDef<EmployeeRow>[]>(
		() => [
			{ field: 'id', header: 'ID', width: 100 },
			{ field: 'name', header: 'Full Name', width: 180 },
			{ field: 'department', header: 'Department', width: 140 },
			{ field: 'title', header: 'Job Title', width: 180 },
			{ field: 'rating', header: 'Rating', width: 120, renderer: { kind: 'react', component: RatingStarsRenderer } },
			{ field: 'salary', header: 'Salary', width: 140, renderer: { kind: 'react', component: SalaryRenderer } },
		],
		[]
	);

	const groupInitialState = useMemo(
		() => ({
			groupBy: ['department'],
			groupRowHeight: 42,
			styleRules: [{ kind: 'groupRow', rowClass: 'border-l-[3px] border-purple-500 bg-purple-950/5' }],
		}),
		[]
	);

	// Custom Group row renderer
	const handleGroupRowRender = useCallback(({ visualRow, api }: { visualRow: VisualRow<EmployeeRow>; api: GridApi<EmployeeRow> }) => {
		if (visualRow.kind !== 'group') return null;
		const expanded = visualRow.expanded;
		const depth = visualRow.depth;

		const handleToggle = (e: React.MouseEvent) => {
			e.stopPropagation();
			const start = performance.now();
			api.toggleGroupExpanded(visualRow.id);
			LatencyProfiler.record(performance.now() - start);
		};

		return (
			<div
				className='og-group-row-content flex items-center justify-between px-4 h-full w-full border-b border-slate-900 bg-slate-900/40 hover:bg-slate-900/60 cursor-pointer'
				onClick={handleToggle}
				style={{ paddingLeft: `${depth * 24 + 16}px` }}
			>
				<div className='flex items-center gap-2'>
					<span className='p-0.5 rounded hover:bg-slate-800 transition-colors'>
						{expanded ? <ChevronDown className='w-4 h-4 text-purple-400' /> : <ChevronRight className='w-4 h-4 text-slate-400' />}
					</span>
					<Folder className='w-4 h-4 text-purple-400 shrink-0' />
					<span className='text-[10px] text-slate-500 uppercase tracking-wider font-extrabold'>{visualRow.field}:</span>
					<span className='text-slate-200 text-xs font-bold'>{String(visualRow.key)}</span>
				</div>
				<span className='text-[9px] font-bold text-purple-400 bg-purple-950/40 border border-purple-900/50 px-2 py-0.5 rounded-full shadow-sm'>
					{visualRow.childCount} employees
				</span>
			</div>
		);
	}, []);

	// 2. Tree Data Grid config
	const treeColumns = useMemo<ColumnDef<FileNodeRow>[]>(
		() => [
			{ field: 'name', header: 'Node Path / Name', width: 260, renderer: { kind: 'react', component: TreeNameRenderer } },
			{
				field: 'type',
				header: 'File Type',
				width: 110,
				renderer: {
					kind: 'react',
					component: ({ value }: CellRendererProps<any>) => (
						<span className='text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wide'>{String(value)}</span>
					),
				},
			},
			{
				field: 'size',
				header: 'Capacity Size',
				width: 120,
				renderer: {
					kind: 'react',
					component: ({ value }: CellRendererProps<any>) => (
						<span className='font-mono text-slate-400 text-xs'>{String(value ?? '—')}</span>
					),
				},
			},
			{ field: 'modifiedAt', header: 'Last Edited', width: 140 },
		],
		[]
	);

	const treeInitialState = useMemo(
		() => ({
			rowModelConfig: {
				type: 'client',
				treeData: {
					enabled: true,
					getParentId: (row: FileNodeRow) => row.parentId,
				},
			},
			expansion: {
				groups: {},
				treeRows: treeRows.reduce<Record<string, true>>((acc, row) => {
					if (row.type === 'folder') acc[row.id] = true;
					return acc;
				}, {}),
				details: {},
			},
			styleRules: [
				{
					kind: 'row',
					when: (row: FileNodeRow) => row.type === 'folder',
					rowClass: 'border-l-[3px] border-amber-500 bg-amber-950/5',
				},
			],
		}),
		[]
	);

	// 3. Master-Detail Grid Config
	const masterColumns = useMemo<ColumnDef<OrderRow>[]>(
		() => [
			{ field: 'toggle', header: '🔍', width: 45, renderer: { kind: 'react', component: DetailToggleRenderer } },
			{ field: 'id', header: 'Order ID', width: 110 },
			{ field: 'customerName', header: 'Client Corporation', width: 220 },
			{ field: 'orderDate', header: 'Purchase Date', width: 150 },
			{ field: 'totalAmount', header: 'Transaction Value', width: 160, renderer: { kind: 'react', component: PriceBadgeRenderer } },
			{ field: 'status', header: 'Fulfillment Status', width: 140, renderer: { kind: 'react', component: StatusBadgeRenderer } },
		],
		[]
	);

	const masterInitialState = useMemo(
		() => ({
			masterDetailEnabled: true,
			detailRowHeight: 220,
		}),
		[]
	);

	// Wrap the details renderer so that parentApi can be resolved and passed down!
	const handleDetailRowRender = useCallback(({ visualRow, api }: { visualRow: VisualRow<OrderRow>; api: GridApi<OrderRow> }) => {
		return <NestedOrderGrid visualRow={visualRow} parentApi={api} />;
	}, []);

	// Force refresh active grids when tab changes
	const handleTabChange = (tab: 'group' | 'tree' | 'detail') => {
		setActiveTab(tab);
		setGridVersion((v) => v + 1);
	};

	return (
		<div className='flex flex-col xl:flex-row h-full w-full gap-5 overflow-hidden font-sans'>
			{/* Left Column: Grid Panel and Segmented Control */}
			<div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
				{/* Gorgeous Header Control bar with Tab Switchers */}
				<div className='bg-slate-900/10 border border-slate-900 rounded-xl p-3 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-8 -translate-y-8 w-20 h-20 bg-purple-500/5 rounded-full blur-xl pointer-events-none' />

					{/* Tab Title */}
					<div className='flex items-center gap-2'>
						<span className='w-2 h-2 rounded-full bg-purple-500 animate-ping' />
						<span className='text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center gap-1.5'>
							<Layers className='w-4 h-4 text-purple-400' />
							Hierarchical & Relational Layout Desk (VisualRow Architecture)
						</span>
					</div>

					{/* Tab Segmented Switcher */}
					<div className='flex bg-slate-950 border border-slate-850 p-1 rounded-xl shadow-inner text-xs font-semibold gap-1'>
						<button
							onClick={() => handleTabChange('group')}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
								activeTab === 'group' ? 'bg-purple-600 text-white shadow shadow-purple-600/20' : 'text-slate-400 hover:text-slate-200'
							}`}
						>
							<Layers className='w-3.5 h-3.5' />
							Row Grouping
						</button>
						<button
							onClick={() => handleTabChange('tree')}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
								activeTab === 'tree' ? 'bg-amber-600 text-white shadow shadow-amber-600/20' : 'text-slate-400 hover:text-slate-200'
							}`}
						>
							<FolderTree className='w-3.5 h-3.5' />
							Tree Hierarchy
						</button>
						<button
							onClick={() => handleTabChange('detail')}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
								activeTab === 'detail' ? 'bg-pink-600 text-white shadow shadow-pink-600/20' : 'text-slate-400 hover:text-slate-200'
							}`}
						>
							<PackageOpen className='w-3.5 h-3.5' />
							Master-Detail Portal
						</button>
					</div>
				</div>

				{/* Active Grid Viewport Surface */}
				<div className='flex-1 min-h-0 min-w-0 border border-slate-900 rounded-lg overflow-hidden bg-slate-950 shadow-2xl relative'>
					{activeTab === 'group' && (
						<Grid
							key={`group-${gridVersion}`}
							rowModelType='client'
							rows={groupRows}
							columns={groupingColumns}
							initialState={groupInitialState as any}
							enableNavigation={true}
							groupRowRenderer={handleGroupRowRender}
							navigationOptions={{
								editTrigger: 'doubleClick',
							}}
							onGridReady={onGridReady}
						/>
					)}

					{activeTab === 'tree' && (
						<Grid
							key={`tree-${gridVersion}`}
							rowModelType='client'
							rows={treeRows}
							columns={treeColumns}
							initialState={treeInitialState as any}
							enableNavigation={true}
							navigationOptions={{
								editTrigger: 'doubleClick',
							}}
							onGridReady={onGridReady}
						/>
					)}

					{activeTab === 'detail' && (
						<Grid
							key={`detail-${gridVersion}`}
							rowModelType='client'
							rows={masterRows}
							columns={masterColumns}
							initialState={masterInitialState}
							enableNavigation={true}
							detailRowRenderer={handleDetailRowRender}
							navigationOptions={{
								editTrigger: 'doubleClick',
							}}
							onGridReady={onGridReady}
						/>
					)}
				</div>
			</div>

			{/* Right Column: Architectural Telemetry Sidebar */}
			<div className='w-full xl:w-80 flex flex-col gap-4 shrink-0 overflow-y-auto max-h-full xl:max-h-none pr-1.5 leading-normal'>
				{/* 1. CONCEPT & CAPABILITIES CARD */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Sparkles className='w-4 h-4 text-purple-400' />
						VisualRow Architecture
					</h3>
					<div className='text-xs text-slate-300 flex flex-col gap-2.5'>
						<p>
							Rather than treating every visible row strictly as a data-centric{' '}
							<span className='font-mono text-purple-400'>RowNode</span>, the grid now operates on a pipeline-driven{' '}
							<span className='font-mono text-purple-400'>VisualRow</span> discriminated union.
						</p>
						<p>This enables complex, dynamically structured render hierarchies without bloating or mutating the original dataset.</p>
					</div>

					<div className='border-t border-slate-900/60 pt-3 flex flex-col gap-2 text-[10px]'>
						<div className='flex items-center gap-2 text-slate-400'>
							<CheckCircle className='w-4 h-4 text-emerald-400 shrink-0' />
							<span>Zero data-row mutation on expansion</span>
						</div>
						<div className='flex items-center gap-2 text-slate-400'>
							<CheckCircle className='w-4 h-4 text-emerald-400 shrink-0' />
							<span>Dynamic parent aggregate calculation</span>
						</div>
						<div className='flex items-center gap-2 text-slate-400'>
							<CheckCircle className='w-4 h-4 text-emerald-400 shrink-0' />
							<span>Infinite nested components via portals</span>
						</div>
					</div>
				</div>

				{/* 2. SPECIFIC TAB EXPLANATION */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3.5 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<Settings className='w-4 h-4 text-indigo-400' />
						Layout Features
					</h3>

					{activeTab === 'group' && (
						<div className='text-xs text-slate-300 flex flex-col gap-2 leading-relaxed'>
							<span className='text-[10px] font-extrabold text-purple-400 uppercase tracking-wide'>📦 Row Grouping Mode</span>
							<p>
								Groups employee data on the fly by their <span className='font-semibold text-slate-200'>Department</span> column.
							</p>
							<p>
								Press{' '}
								<span className='font-mono bg-slate-950 border border-slate-800 px-1 py-0.5 rounded text-purple-300 text-[10px]'>
									Space
								</span>{' '}
								when a cell is active to dynamically toggle the expansion state of its parent group!
							</p>
						</div>
					)}

					{activeTab === 'tree' && (
						<div className='text-xs text-slate-300 flex flex-col gap-2 leading-relaxed'>
							<span className='text-[10px] font-extrabold text-amber-500 uppercase tracking-wide'>🌳 Tree Hierarchy Mode</span>
							<p>Uses a parent-child recursive tree structure to build directory files and folders.</p>
							<p>
								Parent directory nodes map into folder nodes with customizable icons, custom visual indentation depths, and full
								keyboard navigation.
							</p>
						</div>
					)}

					{activeTab === 'detail' && (
						<div className='text-xs text-slate-300 flex flex-col gap-2 leading-relaxed'>
							<span className='text-[10px] font-extrabold text-pink-400 uppercase tracking-wide'>🔍 Master-Detail Mode</span>
							<p>Renders completely separate **nested interactive grids** inside order detail portals!</p>
							<p>
								Try editing the <span className='font-mono text-pink-300 text-[10px]'>Qty</span> column in the nested grids. It
								updates subtotal values and dynamically propagates totals up to the parent ledger cells!
							</p>
						</div>
					)}
				</div>

				{/* 3. NESTED GRIDS CALCULATOR LEDGER (Only in detail tab!) */}
				{activeTab === 'detail' && (
					<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3 glass-card relative overflow-hidden shadow-lg border-purple-500/20'>
						<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none' />
						<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
							<RefreshCw className='w-4 h-4 text-purple-400 font-bold shrink-0 animate-pulse' />
							Cross-Grid Portfolio Ledger
						</h3>

						<button
							onClick={handleCalculateTotals}
							className='w-full py-2.5 px-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-xs shadow-md shadow-purple-600/20 active:scale-95 transition-transform duration-100 flex items-center justify-center gap-1.5 cursor-pointer'
						>
							<Sparkles className='w-3.5 h-3.5 animate-bounce' />
							Calculate Sub-Grid Summary
						</button>

						{telemetryResult ? (
							<div className='flex flex-col gap-2.5 mt-1 border-t border-slate-800/80 pt-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300'>
								<div className='grid grid-cols-2 gap-2 text-[10px] font-mono'>
									<div className='p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col'>
										<span className='text-slate-500 text-[8px] uppercase font-sans font-extrabold'>Total Orders</span>
										<span className='text-purple-400 text-sm font-extrabold mt-0.5'>{telemetryResult.totalOrders}</span>
									</div>
									<div className='p-2 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col'>
										<span className='text-slate-500 text-[8px] uppercase font-sans font-extrabold'>Total Items</span>
										<span className='text-pink-400 text-sm font-extrabold mt-0.5'>{telemetryResult.totalQuantity} qty</span>
									</div>
								</div>

								<div className='p-2.5 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col font-mono text-left'>
									<span className='text-slate-500 text-[8px] uppercase font-sans font-extrabold'>Grand Total Order Book</span>
									<span className='text-emerald-400 text-base font-extrabold mt-0.5'>
										$
										{telemetryResult.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
									</span>
								</div>

								<div className='p-2.5 bg-slate-950/80 border border-slate-900 rounded-lg flex flex-col font-mono text-[9px] text-left leading-relaxed'>
									<span className='text-slate-500 text-[8px] uppercase font-sans font-extrabold mb-1'>Highest Value Item</span>
									<div className='flex justify-between items-start gap-1'>
										<span className='text-slate-300 font-sans font-semibold break-words max-w-[140px]'>
											{telemetryResult.highestItem}
										</span>
										<span className='text-amber-400 font-extrabold shrink-0'>
											${telemetryResult.highestPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
										</span>
									</div>
								</div>

								<div className='text-[8px] text-slate-500 text-center italic mt-0.5'>
									Calculated at {telemetryResult.timestamp} from active sub-grid states!
								</div>

								{(() => {
									const modifiedItems = [];
									for (const orderId of Object.keys(orderItemsMap)) {
										const items = orderItemsMap[orderId] || [];
										for (const item of items) {
											const initialQty = initialQuantities[item.id];
											if (initialQty !== undefined && item.quantity !== initialQty) {
												modifiedItems.push({
													id: item.id,
													orderId,
													itemName: item.itemName,
													oldQty: initialQty,
													newQty: item.quantity,
													subtotal: item.subtotal,
													oldSubtotal: initialQty * item.price,
												});
											}
										}
									}

									if (modifiedItems.length === 0) return null;

									return (
										<div className='mt-2.5 border-t border-slate-800/80 pt-2.5 flex flex-col gap-2'>
											<span className='text-[8px] uppercase tracking-wider font-extrabold text-purple-400 text-left'>
												Live Modifications Stream
											</span>
											<div className='flex flex-col gap-1.5 max-h-[140px] overflow-y-auto pr-1'>
												{modifiedItems.map((item) => (
													<div
														key={item.id}
														className='p-2 bg-purple-950/20 border border-purple-900/30 rounded-lg flex flex-col gap-1 text-[9px] font-mono text-left relative overflow-hidden'
													>
														<div className='absolute right-1 top-1 text-[8px] bg-purple-900/50 text-purple-200 px-1 py-0.2 rounded border border-purple-800/30'>
															{item.id}
														</div>
														<div className='text-slate-300 font-sans font-semibold pr-10 truncate'>{item.itemName}</div>
														<div className='flex justify-between text-slate-400'>
															<span>
																Qty: <span className='line-through text-slate-500'>{item.oldQty}</span> →{' '}
																<span className='text-pink-400 font-bold'>{item.newQty}</span>
															</span>
															<span>
																Val:{' '}
																<span className='line-through text-slate-500'>${item.oldSubtotal.toFixed(0)}</span> →{' '}
																<span className='text-emerald-400 font-bold'>${item.subtotal.toFixed(0)}</span>
															</span>
														</div>
													</div>
												))}
											</div>
										</div>
									);
								})()}
							</div>
						) : (
							<div className='text-[10px] text-slate-500 italic p-3 bg-slate-950/40 border border-slate-900/60 rounded-lg text-center leading-normal'>
								Edit any order item Qty inside the nested portals, then click calculate to run live aggregates across all grids!
							</div>
						)}
					</div>
				)}

				{/* 4. HARDWARE TELEMETRY PORTAL */}
				<div className='p-4 rounded-xl border border-slate-800 bg-slate-900/30 flex flex-col gap-3 glass-card relative overflow-hidden'>
					<div className='absolute right-0 top-0 translate-x-12 -translate-y-12 w-24 h-24 bg-rose-600/5 rounded-full blur-2xl pointer-events-none' />
					<h3 className='text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5'>
						<ShieldAlert className='w-4 h-4 text-rose-400' />
						Portal Mounting Performance
					</h3>

					<div className='flex items-center gap-2 mt-1'>
						<RefreshCw className='w-3.5 h-3.5 text-rose-400 animate-spin shrink-0' />
						<div className='text-xs text-slate-400'>
							Active Portal Subsystems: <span className='font-mono text-slate-200 font-bold'>Wired</span>
						</div>
					</div>

					<p className='text-[10px] text-slate-500 leading-normal mt-1'>
						Visual portal mounts are batch-flushed to avoid layout thrashing, ensuring smooth performance even with deep sub-grid
						recursion.
					</p>
				</div>
			</div>
		</div>
	);
}
