import React from 'react';
import type { GridApi } from '@eregister/wit-grid-react';
import { StateInspector, LiveEventLogPanel } from './RightSidebar';
import { ViewportPanel, SortFilterPanel, ColumnOrderPanel, AccessibilityPanel, KeyboardShortcutsPanel } from './ShowroomControls';
import { GridPageType } from './GridShared';

interface ShowroomRightSidebarProps {
	rightSidebarCollapsed: boolean;
	activeApi: GridApi<any>;
	pinLeftColumns: number;
	setPinLeftColumns: (n: number) => void;
	pinRightColumns: number;
	setPinRightColumns: (n: number) => void;
	activePage: GridPageType;
	massiveColumns: boolean;
	setMassiveColumns: (b: boolean) => void;
	sortField: string;
	setSortField: (s: string) => void;
	statusFilter: 'All' | 'Active' | 'Pending' | 'Inactive';
	setStatusFilter: (s: 'All' | 'Active' | 'Pending' | 'Inactive') => void;
	sortDirection: 'asc' | 'desc';
	setSortDirection: (d: 'asc' | 'desc') => void;
	editTrigger: 'singleClick' | 'doubleClick';
	setEditTrigger: (t: 'singleClick' | 'doubleClick') => void;
	arrowKeyNavigationEdit: boolean;
	setArrowKeyNavigationEdit: (b: boolean) => void;
}

export default function ShowroomRightSidebar({
	rightSidebarCollapsed,
	activeApi,
	pinLeftColumns,
	setPinLeftColumns,
	pinRightColumns,
	setPinRightColumns,
	activePage,
	massiveColumns,
	setMassiveColumns,
	sortField,
	setSortField,
	statusFilter,
	setStatusFilter,
	sortDirection,
	setSortDirection,
	editTrigger,
	setEditTrigger,
	arrowKeyNavigationEdit,
	setArrowKeyNavigationEdit,
}: ShowroomRightSidebarProps) {
	return (
		<div
			className={`${rightSidebarCollapsed ? 'w-0 p-0 border-0 overflow-hidden' : 'w-72 p-4 border border-slate-900/50'} shrink-0 flex flex-col gap-4 overflow-y-auto pl-1 glass-panel rounded-xl transition-all duration-300 ease-in-out`}
		>
			{/* Coordinate Inspector */}
			<StateInspector api={activeApi} />

			{/* Viewport Settings Panel */}
			<ViewportPanel
				pinLeftColumns={pinLeftColumns}
				setPinLeftColumns={setPinLeftColumns}
				pinRightColumns={pinRightColumns}
				setPinRightColumns={setPinRightColumns}
				activePage={activePage}
				massiveColumns={massiveColumns}
				setMassiveColumns={setMassiveColumns}
			/>

			{/* Sorting and Filtering controls */}
			<SortFilterPanel
				activeApi={activeApi}
				sortField={sortField}
				setSortField={setSortField}
				statusFilter={statusFilter}
				setStatusFilter={setStatusFilter}
				sortDirection={sortDirection}
				setSortDirection={setSortDirection}
			/>

			{/* Column reorder controls */}
			<ColumnOrderPanel activeApi={activeApi} />

			{/* Grid Accessibility panel */}
			<AccessibilityPanel
				editTrigger={editTrigger}
				setEditTrigger={setEditTrigger}
				arrowKeyNavigationEdit={arrowKeyNavigationEdit}
				setArrowKeyNavigationEdit={setArrowKeyNavigationEdit}
			/>

			{/* Live core event log panel */}
			<LiveEventLogPanel api={activeApi} />

			{/* Keyboard Shortcuts guide */}
			<KeyboardShortcutsPanel />
		</div>
	);
}
