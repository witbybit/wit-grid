import {
	Cpu,
	Database,
	FileSpreadsheet,
	Sliders,
	Layout,
	Paintbrush,
	TrendingUp,
	Play,
	PanelRightOpen,
	PanelRightClose,
	Calendar,
	Gauge,
	Boxes,
	TableProperties,
	LayoutTemplate,
	SlidersHorizontal,
	GripVertical,
	ShieldCheck,
	Building2,
	BookOpen,
} from 'lucide-react';
import { GridPageType, LatencyProfiler } from './GridShared';

interface ShowroomTitleBannerProps {
	activePage: GridPageType;
	runBulkCalculationTest: () => void;
	applySpreadsheetRangeAction: (action: 'fill' | 'clear' | 'addPercent' | 'sum') => void;
	compactLayout: 'compact' | 'normal' | 'spacious';
	setCompactLayout: (layout: 'compact' | 'normal' | 'spacious') => void;
	rightSidebarCollapsed: boolean;
	setRightSidebarCollapsed: (collapsed: boolean) => void;
	showRightSidebar: boolean;
}

export default function ShowroomTitleBanner({
	activePage,
	runBulkCalculationTest,
	applySpreadsheetRangeAction,
	compactLayout,
	setCompactLayout,
	rightSidebarCollapsed,
	setRightSidebarCollapsed,
	showRightSidebar,
}: ShowroomTitleBannerProps) {
	return (
		<div className='flex items-center justify-between bg-slate-900/10 border border-slate-900 rounded-xl p-3.5 relative overflow-hidden shrink-0'>
			<div className='absolute right-0 top-0 translate-x-6 -translate-y-6 w-20 h-20 bg-purple-600/10 rounded-full blur-xl' />
			<div className='z-10 flex items-center gap-3'>
				<span className='p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400'>
					{activePage === 'perf' && <Cpu className='w-4.5 h-4.5' />}
					{activePage === 'lab' && <Gauge className='w-4.5 h-4.5' />}
					{activePage === 'server' && <Database className='w-4.5 h-4.5' />}
					{activePage === 'ranges' && <FileSpreadsheet className='w-4.5 h-4.5' />}
					{activePage === 'editors' && <Sliders className='w-4.5 h-4.5' />}
					{activePage === 'layout' && <Layout className='w-4.5 h-4.5' />}
					{activePage === 'skins' && <Paintbrush className='w-4.5 h-4.5' />}
					{activePage === 'dashboard' && <TrendingUp className='w-4.5 h-4.5' />}
					{activePage === 'gantt' && <Calendar className='w-4.5 h-4.5' />}
					{activePage === 'native' && <Boxes className='w-4.5 h-4.5' />}
					{activePage === 'wide' && <TableProperties className='w-4.5 h-4.5' />}
					{activePage === 'colgroups' && <LayoutTemplate className='w-4.5 h-4.5' />}
					{activePage === 'floatingfilters' && <SlidersHorizontal className='w-4.5 h-4.5' />}
					{activePage === 'rowdrag' && <GripVertical className='w-4.5 h-4.5' />}
					{activePage === 'integrity' && <ShieldCheck className='w-4.5 h-4.5' />}
					{activePage === 'projects' && <Building2 className='w-4.5 h-4.5' />}
					{activePage === 'docs' && <BookOpen className='w-4.5 h-4.5' />}
				</span>
				<div>
					<h2 className='text-sm font-extrabold text-slate-200 leading-tight uppercase tracking-wider flex items-center gap-2'>
						{activePage === 'docs' && 'Docs Showcase - package-backed examples'}
						{activePage === 'integrity' && 'Data Integrity Lab — Quality · Diff · Live Stream · Conflict Resolution'}
						{activePage === 'lab' && 'Performance Lab: compiled plans, DOM renderers, and glide telemetry'}
						{activePage === 'perf' && 'Financial Risk & Option Greeks stress-test engine'}
						{activePage === 'server' && 'Global Audit & Transaction Logging Ledger'}
						{activePage === 'ranges' && 'Quantitative Financial Planning & Sheet Workbench'}
						{activePage === 'editors' && 'Enterprise Inventory, Pricing & Asset Control Desk'}
						{activePage === 'layout' && 'Dynamic Workspace Layout & Column Manager'}
						{activePage === 'skins' && 'Design System & CSS Themes Studio'}
						{activePage === 'dashboard' && 'Executive Portfolio & SVG Market Analytics Streamer'}
						{activePage === 'gantt' && 'Quantitative Gantt Scheduling & Task Optimizer Arena'}
						{activePage === 'nested' && 'Nested and Group Grid Arena'}
						{activePage === 'native' && 'Native Cell Types — Built into @eregister/wit-grid-react'}
						{activePage === 'wide' && 'Wide Grid — Column Virtualization Showcase'}
						{activePage === 'colgroups' && 'Multi-Level Column Header Groups'}
						{activePage === 'floatingfilters' && 'Floating Filters — Inline Filter Row with Custom Renderers'}
						{activePage === 'rowdrag' && 'Row Drag & Drop — Managed and Unmanaged Reorder Modes'}
						{activePage === 'projects' && 'Projects Compliance Dashboard — Tree Data · Style Rules · Live Filter'}
					</h2>
					<p className='text-[10px] text-slate-400 leading-tight mt-0.5'>
						{activePage === 'docs' &&
							'These examples are imported from @eregister/wit-grid-examples, the same source package used by the documentation site.'}
						{activePage === 'lab' &&
							'Drive a 100,000 row by 1,000 column grid through violent scroll patterns while watching bounded-work counters stay flat.'}
						{activePage === 'perf' &&
							'Perform high-frequency option risk simulations with O(1) Greek recalculations across 10,000 open options.'}
						{activePage === 'server' &&
							'Monitor virtualized distributed trace logging streams with full severity levels and latency filters across 100,000 logs.'}
						{activePage === 'ranges' &&
							'Conduct professional multi-range spreadsheet forecasts, compound ratios, and CAGR growth calculations.'}
						{activePage === 'editors' &&
							'Govern physical premium assets, star reviews, pricing tiers, and translucent fulfillment sliders.'}
						{activePage === 'layout' &&
							'Construct active grid spacing, compact densities, and custom workspace blueprints under sub-millisecond updates.'}
						{activePage === 'skins' &&
							'Toggle styling templates or compile a live CSS stylesheet to showcase total grid layout presentation freedom.'}
						{activePage === 'dashboard' &&
							'Assess real-time stock portfolios, flowing color-gradient sparklines, and selection telemetry graphs.'}
						{activePage === 'gantt' &&
							'Track, extrapolate, and align multi-day team sprints utilizing dynamic styling slots and drag-to-fill date progressions.'}
						{activePage === 'nested' && 'Examples of nested and grouped grids'}
						{activePage === 'native' &&
							'Checkbox, multi-select tags, date picker, dropdown badge, and number stepper — all zero external deps, CSS-variable themed.'}
						{activePage === 'wide' &&
							'100 columns × 500 rows. Only the visible column slice is rendered — scroll horizontally to watch the live badge track colStart/colEnd in real time.'}
						{activePage === 'colgroups' &&
							'Header bands span related columns at one or two levels of depth. Resize a column and the group cell reflows. Pin columns and the group splits at the pin-zone boundary.'}
						{activePage === 'floatingfilters' &&
							'Always-visible filter row per column below the header. Text debounce, number eq, date, set-badge, and custom DOM renderer (probability slider). Horizontally virtualised, pinned-lane aware.'}
						{activePage === 'rowdrag' &&
							'Drag the gripper handle to reorder rows. Managed mode auto-applies the new order; unmanaged mode lets the host drive the update. Auto-scroll at viewport edges, Escape to cancel.'}
						{activePage === 'integrity' &&
							'Walk through all 5 insight layers: data quality rules, EOD diff comparison, live price streaming, and server-vs-local conflict resolution — all composable on the same grid.'}
						{activePage === 'projects' &&
							'17 projects × 77 subprojects rendered via tree data. Compliance bars, per-row style rules, and live search + status filter — all wired to a flat row array.'}
					</p>
				</div>
			</div>

			{/* Context-aware upper toolbar buttons */}
			<div className='z-10 flex gap-2 shrink-0'>
				{activePage === 'perf' && (
					<button
						onClick={runBulkCalculationTest}
						className='flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 font-bold text-[10px] text-white border border-purple-500/20 shadow-md shadow-purple-600/10 transition-all font-sans cursor-pointer'
					>
						<Play className='w-3 h-3' />
						Run Greeks Stress Simulation
					</button>
				)}

				{activePage === 'ranges' && (
					<div className='flex gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-850 shrink-0'>
						<button
							onClick={() => applySpreadsheetRangeAction('sum')}
							className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-purple-400 font-bold hover:text-white transition-all font-sans'
						>
							Sum Selected
						</button>
						<button
							onClick={() => applySpreadsheetRangeAction('addPercent')}
							className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-indigo-400 font-bold hover:text-white transition-all font-sans'
						>
							Add +10%
						</button>
						<button
							onClick={() => applySpreadsheetRangeAction('fill')}
							className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-emerald-400 font-bold hover:text-white transition-all font-sans'
						>
							Fill 100
						</button>
						<button
							onClick={() => applySpreadsheetRangeAction('clear')}
							className='px-2.5 py-1 rounded text-[10px] bg-slate-900 border border-slate-800 text-rose-400 font-bold hover:text-white transition-all font-sans'
						>
							Clear Range
						</button>
					</div>
				)}

				{activePage === 'layout' && (
					<div className='flex items-center gap-1.5 bg-slate-950 border border-slate-850 rounded-lg p-0.5 shrink-0'>
						{(['compact', 'normal', 'spacious'] as const).map((mode) => (
							<button
								key={mode}
								onClick={() => {
									const start = performance.now();
									setCompactLayout(mode);
									const duration = performance.now() - start;
									LatencyProfiler.record(duration);
								}}
								className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all ${
									compactLayout === mode ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
								}`}
							>
								{mode}
							</button>
						))}
					</div>
				)}

				{showRightSidebar && (
					<button
						onClick={() => setRightSidebarCollapsed(!rightSidebarCollapsed)}
						className='flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-slate-950 hover:bg-slate-900 font-bold text-[10px] text-slate-300 hover:text-white border border-slate-850 hover:border-slate-750 transition-all font-sans'
						title={rightSidebarCollapsed ? 'Open Controls Sidebar' : 'Hide Controls Sidebar'}
					>
						{rightSidebarCollapsed ? <PanelRightOpen className='w-3 h-3' /> : <PanelRightClose className='w-3 h-3' />}
						{!rightSidebarCollapsed ? 'Hide Controls' : 'Show Controls'}
					</button>
				)}
			</div>
		</div>
	);
}
