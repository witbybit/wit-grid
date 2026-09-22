import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from 'lucide-react';
import type { FilterModel, GridApi, GridReadyEvent } from '@eregister/wit-grid-react';
import { DemoGridApiScope } from './DemoGridContext';
import ShowroomHeader from './components/ShowroomHeader';
import ShowroomLeftSidebar from './components/ShowroomLeftSidebar';
import ShowroomTitleBanner from './components/ShowroomTitleBanner';
import ShowroomRightSidebar from './components/ShowroomRightSidebar';
import type { GridPageType } from './components/GridShared';
import { layoutColumnsFull, setInactiveRiskSideEffects } from './pages/demoGridConfigs';

const CalculationsArena = lazy(() => import('./pages/CalculationsArena'));
const InfiniteServerScroll = lazy(() => import('./pages/InfiniteServerScroll'));
const SpreadsheetWorkspace = lazy(() => import('./pages/SpreadsheetWorkspace'));
const CustomEditorRenderer = lazy(() => import('./pages/CustomEditorRenderer'));
const DynamicLayout = lazy(() => import('./pages/DynamicLayout'));
const HeadlessSkinsPlayground = lazy(() => import('./pages/HeadlessSkinsPlayground'));
const RealtimeDashboard = lazy(() => import('./pages/RealtimeDashboard'));
const GanttSchedulingWorkspace = lazy(() => import('./pages/GanttSchedulingWorkspace'));
const NestedTablesGrouping = lazy(() => import('./pages/NestedTablesGrouping'));
const PerformanceLab = lazy(() => import('./pages/PerformanceLab'));
const FlightRecorderLab = lazy(() => import('./pages/FlightRecorderLab'));
const SidebarPanelsDemo = lazy(() => import('./pages/SidebarPanelsDemo'));
const NativeCellTypesDemo = lazy(() => import('./pages/NativeCellTypesDemo'));
const RealtimeGroupingDemo = lazy(() => import('./pages/RealtimeGroupingDemo'));
const RowMultiSelectDemo = lazy(() => import('./pages/RowMultiSelectDemo'));
const CrudValidationDemo = lazy(() => import('./pages/CrudValidationDemo'));
const WideGridDemo = lazy(() => import('./pages/WideGridDemo'));
const ColumnGroupHeaderDemo = lazy(() => import('./pages/ColumnGroupHeaderDemo'));
const ClipboardDemo = lazy(() => import('./pages/ClipboardDemo'));
const FloatingFiltersDemo = lazy(() => import('./pages/FloatingFiltersDemo'));
const RowDragDemo = lazy(() => import('./pages/RowDragDemo'));
const AdvancedFiltersDemo = lazy(() => import('./pages/AdvancedFiltersDemo'));
const DataIntegrityLab = lazy(() => import('./pages/DataIntegrityLab'));
const ProjectsComplianceDemo = lazy(() => import('./pages/ProjectsComplianceDemo'));
const KanbanBoardDemo = lazy(() => import('./pages/KanbanBoardDemo'));

const PAGES: readonly GridPageType[] = [
	'devtools',
	'perf',
	'server',
	'ranges',
	'editors',
	'layout',
	'skins',
	'dashboard',
	'gantt',
	'nested',
	'lab',
	'panels',
	'native',
	'grouping',
	'multiselect',
	'crud',
	'wide',
	'colgroups',
	'floatingfilters',
	'rowdrag',
	'advancedfilters',
	'integrity',
	'projects',
	'kanban',
];

function GridPageFallback() {
	return (
		<div className='flex h-full min-h-0 flex-1 items-center justify-center rounded-xl border border-slate-900 bg-slate-950/40'>
			<div className='flex flex-col items-center gap-2 text-center'>
				<div className='h-10 w-10 animate-pulse rounded-full border border-slate-800 bg-slate-900/80' />
				<p className='text-[11px] font-semibold uppercase tracking-wider text-slate-500'>Loading showroom</p>
			</div>
		</div>
	);
}

function readActivePage(): GridPageType {
	const hash = window.location.hash.slice(1);
	return PAGES.includes(hash as GridPageType) ? (hash as GridPageType) : 'perf';
}

export default function App() {
	const [activePage, setActivePage] = useState<GridPageType>(() => readActivePage());
	const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
	const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
	const [pinLeftColumns, setPinLeftColumns] = useState(1);
	const [pinRightColumns, setPinRightColumns] = useState(1);
	const [massiveColumns, setMassiveColumns] = useState(false);
	const [editTrigger, setEditTrigger] = useState<'singleClick' | 'doubleClick'>('doubleClick');
	const [arrowKeyNavigationEdit, setArrowKeyNavigationEdit] = useState(false);
	const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Pending' | 'Inactive'>('All');
	const [sortField, setSortField] = useState('id');
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
	const [compactLayout, setCompactLayout] = useState<'compact' | 'normal' | 'spacious'>('normal');
	const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
		id: true,
		name: true,
		price: true,
		quantity: true,
		subtotal: true,
		status: true,
	});
	const [activeApi, setActiveApi] = useState<GridApi<any> | null>(null);

	useEffect(() => {
		const handleHashChange = () => {
			setActivePage(readActivePage());
			setActiveApi(null);
			setSortField('id');
			setSortDirection('asc');
			setStatusFilter('All');
		};
		window.addEventListener('hashchange', handleHashChange);
		if (window.location.hash) handleHashChange();
		else window.location.hash = 'perf';
		return () => window.removeEventListener('hashchange', handleHashChange);
	}, []);

	const rowHeightsMap = useMemo(() => ({ compact: 30, normal: 38, spacious: 48 }), []);
	const filterModel = useMemo<FilterModel | null>(
		() => (statusFilter === 'All' ? null : { status: { type: 'text', operator: 'equals', value: statusFilter } }),
		[statusFilter]
	);

	useEffect(() => {
		activeApi?.setFilterModel(filterModel);
	}, [activeApi, filterModel]);

	useEffect(() => {
		if (!activeApi) return;
		const columns = activeApi.getStateSnapshot().columns;
		if (columns.length > 0 && !columns.some((column) => column.field === sortField)) {
			setSortField(columns[0].field);
		}
	}, [activeApi, sortField]);

	const registerGridApi = useCallback(
		(page: GridPageType, event: GridReadyEvent<any>) => {
			if (page === activePage) setActiveApi(event.api);
		},
		[activePage]
	);

	const handleGridReady = useCallback((event: GridReadyEvent<any>) => registerGridApi(activePage, event), [activePage, registerGridApi]);

	const handleCellValueChanged = useCallback(
		({ rowId, colField, newValue }: { rowId: string; colField: string; oldValue: unknown; newValue: unknown }) => {
			if (!activeApi) return;
			setInactiveRiskSideEffects(activeApi, rowId, colField, newValue);
			if (activePage === 'gantt' && colField === 'status') {
				if (newValue === 'Done') activeApi.setCellValue(rowId, 'progress', 100);
				else if (newValue === 'Pending') activeApi.setCellValue(rowId, 'progress', 0);
			}
			performance.mark('wit-grid-demo-cell-change');
		},
		[activeApi, activePage]
	);

	const runBulkCalculationTest = useCallback(() => {
		if (!activeApi) return;
		const start = performance.now();
		const updates: any[] = [];
		activeApi.rows().forEach((row, index) => {
			if (index % 10 !== 0) return;
			updates.push({
				...row,
				price: (Math.floor(Math.random() * 150) + 10).toString(),
				quantity: (Math.floor(Math.random() * 60) + 15).toString(),
			});
		});
		activeApi.applyTransaction({ update: updates });
		performance.measure('wit-grid-demo-bulk-calculation', { start, end: performance.now() });
		performance.mark('wit-grid-demo-grid-action');
	}, [activeApi]);

	const applySpreadsheetRangeAction = useCallback(
		(action: 'fill' | 'clear' | 'addPercent' | 'sum') => {
			if (!activeApi) return;
			const state = activeApi.getStateSnapshot();
			const range = state.selection.range;
			if (!range) {
				window.alert('Please select a range of cells first using click-and-drag or Shift+Arrows.');
				return;
			}
			const startColIndex = state.columns.findIndex((column) => column.field === range.start.colField);
			const endColIndex = state.columns.findIndex((column) => column.field === range.end.colField);
			if (startColIndex === -1 || endColIndex === -1) return;
			const rowIds = activeApi.rows().inRange(range).getIds();
			const columns = state.columns
				.slice(Math.min(startColIndex, endColIndex), Math.max(startColIndex, endColIndex) + 1)
				.map((column) => column.field)
				.filter((field) => field !== 'id');
			if (action === 'sum') {
				let total = 0;
				for (const rowId of rowIds) for (const colField of columns) total += parseFloat(String(activeApi.getCellValue(rowId, colField))) || 0;
				window.alert(`Calculated Selection Range Sum: ${total.toFixed(2)}`);
				return;
			}
			const rowIdSet = new Set(rowIds);
			activeApi.updateRows((currentRows) =>
				currentRows.map((row) => {
					if (!rowIdSet.has(row.id)) return row;
					const next = { ...row } as any;
					for (const field of columns) {
						if (action === 'fill') next[field] = '100';
						else if (action === 'clear') next[field] = 0;
						else next[field] = ((parseFloat(String((row as any)[field])) || 0) * 1.1).toFixed(0);
					}
					return next;
				})
			);
			performance.mark('wit-grid-demo-range-action');
		},
		[activeApi]
	);

	const toggleColumnVisibility = (field: string) => {
		const nextVisible = { ...visibleColumns, [field]: !visibleColumns[field] };
		if (Object.values(nextVisible).some(Boolean)) setVisibleColumns(nextVisible);
	};

	const contextValue = useMemo(() => ({ activeApi, registerGridApi }), [activeApi, registerGridApi]);
	const commonGridProps = {
		editTrigger,
		arrowKeyNavigationEdit,
		onGridReady: handleGridReady,
		onCellValueChanged: handleCellValueChanged,
		pinLeftColumns,
		pinRightColumns,
	};

	const activePageContent = (() => {
		if (activePage === 'perf') return <CalculationsArena {...commonGridProps} massiveColumns={massiveColumns} />;
		if (activePage === 'server') return <InfiniteServerScroll {...commonGridProps} />;
		if (activePage === 'ranges') return <SpreadsheetWorkspace {...commonGridProps} />;
		if (activePage === 'editors') return <CustomEditorRenderer {...commonGridProps} />;
		if (activePage === 'layout') {
			return <DynamicLayout {...commonGridProps} rowHeightsMap={rowHeightsMap} compactLayout={compactLayout} visibleColumns={visibleColumns} />;
		}
		if (activePage === 'skins') return <HeadlessSkinsPlayground {...commonGridProps} />;
		if (activePage === 'dashboard') return <RealtimeDashboard {...commonGridProps} />;
		if (activePage === 'gantt') return <GanttSchedulingWorkspace {...commonGridProps} />;
		if (activePage === 'lab') return <PerformanceLab {...commonGridProps} />;
		if (activePage === 'devtools') return <FlightRecorderLab />;
		if (activePage === 'nested') return <NestedTablesGrouping {...commonGridProps} />;
		if (activePage === 'panels') return <SidebarPanelsDemo {...commonGridProps} />;
		if (activePage === 'native') return <NativeCellTypesDemo {...commonGridProps} />;
		if (activePage === 'grouping') return <RealtimeGroupingDemo {...commonGridProps} />;
		if (activePage === 'multiselect') return <RowMultiSelectDemo {...commonGridProps} />;
		if (activePage === 'wide') return <WideGridDemo {...commonGridProps} />;
		if (activePage === 'colgroups') return <ColumnGroupHeaderDemo {...commonGridProps} />;
		if (activePage === 'clipboard') return <ClipboardDemo />;
		if (activePage === 'floatingfilters') return <FloatingFiltersDemo {...commonGridProps} />;
		if (activePage === 'rowdrag') return <RowDragDemo />;
		if (activePage === 'advancedfilters') return <AdvancedFiltersDemo />;
		if (activePage === 'integrity') return <DataIntegrityLab />;
		if (activePage === 'projects') return <ProjectsComplianceDemo onGridReady={handleGridReady} />;
		if (activePage === 'kanban')
			return <KanbanBoardDemo onGridReady={handleGridReady} pinLeftColumns={pinLeftColumns} pinRightColumns={pinRightColumns} />;
		return <CrudValidationDemo {...commonGridProps} />;
	})();

	const showRightSidebar = !(
		[
			'crud',
			'projects',
			'integrity',
			'floatingfilters',
			'colgroups',
			'multiselect',
			'grouping',
			'native',
			'panels',
			'kanban',
			'skins',
		] as GridPageType[]
	).includes(activePage);

	const showTitleBanner = !(['crud', 'advancedfilters', 'panels', 'kanban'] as GridPageType[]).includes(activePage);

	return (
		<DemoGridApiScope value={contextValue}>
			<div className='flex h-full w-full select-none flex-col overflow-hidden bg-slate-950 p-6 font-sans text-slate-100'>
				<ShowroomHeader />
				<div className='mt-6 flex min-h-0 flex-1 gap-6 overflow-hidden'>
					<ShowroomLeftSidebar
						activePage={activePage}
						leftSidebarCollapsed={leftSidebarCollapsed}
						setLeftSidebarCollapsed={setLeftSidebarCollapsed}
					/>
					<div className='flex min-w-0 flex-1 flex-col gap-5 overflow-hidden pr-1.5'>
						{showTitleBanner && (
							<ShowroomTitleBanner
								activePage={activePage}
								runBulkCalculationTest={runBulkCalculationTest}
								applySpreadsheetRangeAction={applySpreadsheetRangeAction}
								compactLayout={compactLayout}
								setCompactLayout={setCompactLayout}
								rightSidebarCollapsed={rightSidebarCollapsed}
								setRightSidebarCollapsed={setRightSidebarCollapsed}
								showRightSidebar={showRightSidebar}
							/>
						)}
						{activePage === 'layout' && (
							<div className='flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-slate-900 bg-slate-900/10 p-3 text-xs font-semibold'>
								<span className='flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-500'>
									<Layout className='h-3.5 w-3.5 text-purple-400' />
									Column Visibility:
								</span>
								{layoutColumnsFull.map((col) => (
									<label
										key={col.field}
										className='flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-slate-850 bg-slate-950/80 px-2.5 py-1 transition-all hover:border-slate-750'
									>
										<input
											type='checkbox'
											checked={visibleColumns[col.field]}
											onChange={() => toggleColumnVisibility(col.field)}
											className='h-3 w-3 cursor-pointer rounded border-slate-800 bg-slate-950 text-purple-600 focus:ring-purple-500/20'
										/>
										<span className='text-[10px] font-bold text-slate-300'>{col.header}</span>
									</label>
								))}
							</div>
						)}
						<div className='flex min-h-0 flex-1 flex-col'>
							<Suspense fallback={<GridPageFallback />}>{activePageContent}</Suspense>
						</div>
					</div>
					{activeApi && showRightSidebar && (
						<ShowroomRightSidebar
							rightSidebarCollapsed={rightSidebarCollapsed}
							activeApi={activeApi}
							pinLeftColumns={pinLeftColumns}
							setPinLeftColumns={setPinLeftColumns}
							pinRightColumns={pinRightColumns}
							setPinRightColumns={setPinRightColumns}
							activePage={activePage}
							massiveColumns={massiveColumns}
							setMassiveColumns={setMassiveColumns}
							sortField={sortField}
							setSortField={setSortField}
							statusFilter={statusFilter}
							setStatusFilter={setStatusFilter}
							sortDirection={sortDirection}
							setSortDirection={setSortDirection}
							editTrigger={editTrigger}
							setEditTrigger={setEditTrigger}
							arrowKeyNavigationEdit={arrowKeyNavigationEdit}
							setArrowKeyNavigationEdit={setArrowKeyNavigationEdit}
						/>
					)}
				</div>
			</div>
		</DemoGridApiScope>
	);
}
