import React from 'react';
import {
	Cpu,
	Database,
	FileSpreadsheet,
	Sliders,
	Layout,
	Paintbrush,
	TrendingUp,
	PanelLeftClose,
	PanelLeftOpen,
	Sparkles,
	Calendar,
	FolderTree,
	Gauge,
	PanelRight,
	Boxes,
	Layers,
	CheckSquare,
	ClipboardCheck,
	Clipboard,
	TableProperties,
	LayoutTemplate,
	SlidersHorizontal,
	GripVertical,
	ShieldCheck,
	Building2,
	LayoutDashboard,
	Activity,
} from 'lucide-react';
import { APP_VERSION } from '../utils';
import { GridPageType } from './GridShared';

interface ShowroomLeftSidebarProps {
	activePage: GridPageType;
	leftSidebarCollapsed: boolean;
	setLeftSidebarCollapsed: (collapsed: boolean) => void;
}

export default function ShowroomLeftSidebar({ activePage, leftSidebarCollapsed, setLeftSidebarCollapsed }: ShowroomLeftSidebarProps) {
	const navItems = [
		{
			id: 'perf',
			label: 'Risk & Greeks Engine',
			subtitle: '10k Options • Live Stress',
			icon: Cpu,
		},
		{
			id: 'server',
			label: 'Audit Log Ledger',
			subtitle: '100k Logs • Trace Streams',
			icon: Database,
		},
		{
			id: 'ranges',
			label: 'Quantitative Sheet',
			subtitle: 'Financial Models & CAGR',
			icon: FileSpreadsheet,
		},
		{
			id: 'editors',
			label: 'Asset Control Desk',
			subtitle: 'Pricing Tiers & Rating Stars',
			icon: Sliders,
		},
		{
			id: 'layout',
			label: 'Workspace Designer',
			subtitle: 'Column Density & Widths',
			icon: Layout,
		},
		{
			id: 'skins',
			label: 'CSS Themes Studio',
			subtitle: 'Slate Skin & Preset Styles',
			icon: Paintbrush,
		},
		{
			id: 'dashboard',
			label: 'Executive Portfolio',
			subtitle: 'Market Analytics Streamer',
			icon: TrendingUp,
		},
		{
			id: 'gantt',
			label: 'Sprint Scheduling Arena',
			subtitle: '30 Days Gantt • Style Slots',
			icon: Calendar,
		},
		{
			id: 'nested',
			label: 'Hierarchical Desk',
			subtitle: 'Tree • Group • Detail',
			icon: FolderTree,
		},
		{
			id: 'devtools',
			label: 'Flight Recorder',
			subtitle: 'Causal trace workbench',
			icon: Activity,
		},
		{
			id: 'lab',
			label: 'Performance Lab',
			subtitle: '100k x 1k Glide',
			icon: Gauge,
		},
		{
			id: 'panels',
			label: 'Sidebar Panels',
			subtitle: 'Columns · Filters · Sort',
			icon: PanelRight,
		},
		{
			id: 'native',
			label: 'Native Cell Types',
			subtitle: 'Checkbox · Tags · Date · More',
			icon: Boxes,
		},
		{
			id: 'grouping',
			label: 'Live Grouping',
			subtitle: 'Drag · Drop · Reorder Groups',
			icon: Layers,
		},
		{
			id: 'multiselect',
			label: 'Row Multi-Select',
			subtitle: 'Checkbox · Ctrl+Click · Bulk Ops',
			icon: CheckSquare,
		},
		{
			id: 'crud',
			label: 'CRUD & Validation',
			subtitle: 'Validate · Submit · Error Feedback',
			icon: ClipboardCheck,
		},
		{
			id: 'wide',
			label: 'Wide Grid',
			subtitle: '100 Columns · Column Virtualization',
			icon: TableProperties,
		},
		{
			id: 'colgroups',
			label: 'Column Groups',
			subtitle: '1-Level & 2-Level Header Bands',
			icon: LayoutTemplate,
		},
		{
			id: 'clipboard',
			label: 'Clipboard',
			subtitle: 'Copy · Paste · TSV · Formatters',
			icon: Clipboard,
		},
		{
			id: 'floatingfilters',
			label: 'Floating Filters',
			subtitle: 'Inline Filters · Custom Renderer',
			icon: SlidersHorizontal,
		},
		{
			id: 'rowdrag',
			label: 'Row Drag & Drop',
			subtitle: 'Managed · Unmanaged · Auto-scroll',
			icon: GripVertical,
		},
		{
			id: 'advancedfilters',
			label: 'Advanced Filters',
			subtitle: 'Multi-Select · Async · Infinite',
			icon: SlidersHorizontal,
		},
		{
			id: 'integrity',
			label: 'Data Integrity Lab',
			subtitle: 'Quality · Diff · Live · Conflicts',
			icon: ShieldCheck,
		},
		{
			id: 'projects',
			label: 'Projects Compliance',
			subtitle: 'Tree · Compliance · Watchlist',
			icon: Building2,
		},
		{
			id: 'kanban',
			label: 'Kanban Board',
			subtitle: 'Variable Heights · Rich Cards',
			icon: LayoutDashboard,
		},
	] as const;

	return (
		<div
			className={`${leftSidebarCollapsed ? 'w-16 p-2' : 'w-56 p-4'} shrink-0 flex flex-col justify-between overflow-y-auto glass-panel rounded-xl border border-slate-900/50 relative transition-all duration-300 ease-in-out`}
		>
			<div className='flex flex-col gap-5'>
				<div className={`flex items-center justify-between ${leftSidebarCollapsed ? 'flex-col gap-3' : ''} px-1.5 py-0.5`}>
					{!leftSidebarCollapsed && (
						<span className='text-[9px] font-bold text-slate-500 uppercase tracking-wider truncate'>Showrooms</span>
					)}
					<button
						onClick={() => setLeftSidebarCollapsed(!leftSidebarCollapsed)}
						className='p-1 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white transition-all duration-200 shadow-sm border border-slate-800/30'
						title={leftSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
					>
						{leftSidebarCollapsed ? <PanelLeftOpen className='w-4 h-4' /> : <PanelLeftClose className='w-4 h-4' />}
					</button>
				</div>

				<nav className='flex flex-col gap-1.5'>
					{navItems.map((item) => {
						const Icon = item.icon;
						const isActive = activePage === item.id;
						return (
							<a
								key={item.id}
								href={`#${item.id}`}
								title={leftSidebarCollapsed ? `${item.label} (${item.subtitle})` : undefined}
								className={`w-full flex ${leftSidebarCollapsed ? 'justify-center p-3' : 'flex-col gap-0.5 px-3 py-2.5'} rounded-xl text-left transition-all group ${
									isActive
										? 'bg-purple-600 text-white shadow-lg shadow-purple-600/10'
										: 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
								}`}
							>
								<div className='flex items-center gap-2 text-xs font-bold'>
									<Icon className='w-4 h-4 shrink-0' />
									{!leftSidebarCollapsed && item.label}
								</div>
								{!leftSidebarCollapsed && (
									<span className={`text-[9px] ${isActive ? 'text-purple-200' : 'text-slate-500'} font-medium`}>
										{item.subtitle}
									</span>
								)}
							</a>
						);
					})}
				</nav>
			</div>

			<div className='flex flex-col gap-3 pt-4 border-t border-slate-900/60 items-center justify-center'>
				{leftSidebarCollapsed ? (
					<div
						title={`Grid Engine v${APP_VERSION}`}
						className='p-2 rounded-lg bg-slate-950/40 border border-slate-900/80 text-purple-400 cursor-help'
					>
						<Sparkles className='w-4 h-4' />
					</div>
				) : (
					<div className='flex items-center justify-between w-full p-2 rounded-lg bg-slate-950/40 border border-slate-900/80'>
						<div className='flex items-center gap-1.5 text-[10px] text-slate-400 font-bold'>
							<Sparkles className='w-3 h-3 text-purple-400' />
							Wit Grid
						</div>
						<span className='font-mono text-[9px] text-slate-500 font-semibold'>v{APP_VERSION}</span>
					</div>
				)}
			</div>
		</div>
	);
}
