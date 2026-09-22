import React from 'react';
import { useGridKeySelector } from '../hooks.js';
import type { GridApi } from '../types.js';
import { summarizeAnalysisState } from '@eregister/wit-grid-core';
import { ColumnsPanel } from './panels/ColumnsPanel.js';
import { FiltersPanel } from './panels/FiltersPanel.js';
import { SortPanel } from './panels/SortPanel.js';
import { ThemesPanel } from './panels/ThemesPanel.js';
import { ViewsPanel } from './panels/ViewsPanel.js';
import { QueryPanel } from './panels/QueryPanel.js';
import { DataIntegrityPanel } from './panels/DataIntegrityPanel.js';

// ── Sidebar types ─────────────────────────────────────────────────────────────

export type BuiltinSidebarPanelId = 'columns' | 'filters' | 'sort' | 'themes' | 'views' | 'query' | 'dataIntegrity';

export interface SidebarPanelDef<TRowData = unknown> {
	id: string;
	label: string;
	icon?: React.ReactNode;
	render?: (api: GridApi<TRowData>, onClose: () => void) => React.ReactNode;
}

export interface GridSidebarConfig<TRowData = unknown> {
	/** Which panels to show. Accepts built-in IDs or custom panel defs. */
	panels?: Array<BuiltinSidebarPanelId | SidebarPanelDef<TRowData>>;
	/** Panel ID open on first render. `null` = all collapsed. */
	defaultOpen?: string | null;
	/** Which side to attach the sidebar. Default: 'right'. */
	position?: 'left' | 'right';
	/** Open-panel content width in px. Default: 264. */
	width?: number;
}

// ── Inline SVG icons (avoids circular dep with GridSidebar.tsx) ───────────────

const _ColumnsIcon = () => (
	<svg width='15' height='15' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<rect x='1' y='1.5' width='3.5' height='12' rx='1' />
		<rect x='5.75' y='1.5' width='3.5' height='12' rx='1' />
		<rect x='10.5' y='1.5' width='3.5' height='12' rx='1' />
	</svg>
);
const _FiltersIcon = () => (
	<svg width='15' height='15' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round'>
		<path d='M1.5 3.5h12M3.5 7.5h8M5.5 11.5h4' />
	</svg>
);
const _SortIcon = () => (
	<svg width='15' height='15' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M1.5 4h8M1.5 7.5h6M1.5 11h4' />
		<path d='M12 2.5v9M10.5 9.5l1.5 1.5 1.5-1.5' />
	</svg>
);
const _ThemesIcon = () => (
	<svg width='15' height='15' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M7.5 1.5a6 6 0 1 0 6 6c0-.6-.1-1.1-.2-1.6a.9.9 0 0 0-1.3-.6 2.8 2.8 0 0 1-1.4.4 2.9 2.9 0 0 1-2.9-2.9c0-.5.1-1 .4-1.4A.9.9 0 0 0 7.5 1.5Z' />
	</svg>
);
const _ViewsIcon = () => (
	<svg width='15' height='15' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<rect x='1.5' y='1.5' width='12' height='12' rx='2' />
		<path d='M1.5 5.5h12' />
		<path d='M5.5 5.5v8' />
	</svg>
);
const _QueryIcon = () => (
	<svg width='15' height='15' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<circle cx='7.5' cy='7.5' r='6' />
		<path d='M5.5 6a2 2 0 1 1 2 2v1' />
		<circle cx='7.5' cy='11.5' r='0.5' fill='currentColor' />
	</svg>
);
const _DataIntegrityIcon = () => (
	<svg width='15' height='15' viewBox='0 0 15 15' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
		<path d='M7.5 1.5L13 4v4c0 3-2.5 5-5.5 5.5C4.5 13 2 11 2 8V4z' />
		<path d='M5 7.5l1.5 1.5 3-3' />
	</svg>
);

interface _ResolvedPanel<TRowData> {
	id: string;
	label: string;
	icon: React.ReactNode;
	render: (api: GridApi<TRowData>, onClose: () => void) => React.ReactNode;
}

const _BUILTIN_ICONS: Record<BuiltinSidebarPanelId, React.ReactNode> = {
	columns: <_ColumnsIcon />,
	filters: <_FiltersIcon />,
	sort: <_SortIcon />,
	themes: <_ThemesIcon />,
	views: <_ViewsIcon />,
	query: <_QueryIcon />,
	dataIntegrity: <_DataIntegrityIcon />,
};
const _BUILTIN_LABELS: Record<BuiltinSidebarPanelId, string> = {
	columns: 'Columns',
	filters: 'Filters',
	sort: 'Sort',
	themes: 'Themes',
	views: 'Views',
	query: 'Query',
	dataIntegrity: 'Data Integrity',
};

function _resolvePanel<TRowData>(def: BuiltinSidebarPanelId | SidebarPanelDef<TRowData>): _ResolvedPanel<TRowData> {
	if (typeof def !== 'string') {
		return { id: def.id, label: def.label, icon: def.icon ?? null, render: def.render ?? (() => null) };
	}
	return {
		id: def,
		label: _BUILTIN_LABELS[def],
		icon: _BUILTIN_ICONS[def],
		render: (api, onClose) => {
			if (def === 'columns') return <ColumnsPanel api={api as GridApi<any>} onClose={onClose} />;
			if (def === 'filters') return <FiltersPanel api={api as GridApi<any>} onClose={onClose} />;
			if (def === 'sort') return <SortPanel api={api as GridApi<any>} onClose={onClose} />;
			if (def === 'themes') return <ThemesPanel api={api as GridApi<any>} onClose={onClose} />;
			if (def === 'views') return <ViewsPanel api={api as GridApi<any>} onClose={onClose} />;
			if (def === 'query') return <QueryPanel api={api as GridApi<any>} onClose={onClose} />;
			if (def === 'dataIntegrity') return <DataIntegrityPanel api={api as GridApi<any>} onClose={onClose} />;
			return null;
		},
	};
}

const _SIDEBAR_TAB_W = 44;
export function GridSidebar<TRowData>({ api, config }: { api: GridApi<TRowData>; config: GridSidebarConfig<TRowData> }) {
	const { panels = ['columns', 'filters', 'sort', 'themes', 'views'], position = 'right', width = 264 } = config;
	const activeId = useGridKeySelector<string | null>('sidebarOpenPanel', (s) => s.sidebarOpenPanel ?? null);
	const themeName = useGridKeySelector('themeName', (s) => s.themeName);
	const filterCount = useGridKeySelector<number>('filterModel', (s) => summarizeAnalysisState(s.filterModel, null).filterCount);
	const queryConditionCount = useGridKeySelector<number>(
		'queryModel',
		(s) => summarizeAnalysisState(null, s.queryModel ?? null).queryConditionCount
	);
	const sortCount = useGridKeySelector<number>('sortModel', (s) => (s.sortModel ? s.sortModel.length : 0));
	const theme = api.getTheme();

	const getBadge = (id: string) => (id === 'filters' ? filterCount : id === 'query' ? queryConditionCount : id === 'sort' ? sortCount : 0);
	const resolvedPanels = (panels as Array<BuiltinSidebarPanelId | SidebarPanelDef<TRowData>>).map(_resolvePanel);
	const activeDef = resolvedPanels.find((p) => p.id === activeId) ?? null;

	return (
		<div style={{ display: 'flex', flexDirection: position === 'right' ? 'row' : 'row-reverse', height: '100%', flexShrink: 0 }}>
			{/* Tab strip */}
			<div
				style={{
					width: _SIDEBAR_TAB_W,
					flexShrink: 0,
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					paddingTop: 10,
					gap: 4,
					background: theme.headerBg,
					borderLeft: position === 'right' ? `1px solid ${theme.borderColor}` : undefined,
					borderRight: position === 'left' ? `1px solid ${theme.borderColor}` : undefined,
				}}
			>
				{resolvedPanels.map((panel) => {
					const active = panel.id === activeId;
					const badge = getBadge(panel.id);
					return (
						<button
							key={panel.id}
							title={panel.label}
							onClick={() => api.togglePanel(panel.id)}
							style={{
								width: 32,
								height: 32,
								flexShrink: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								borderRadius: 7,
								border: active ? `1px solid ${theme.selectionBorder}` : '1px solid transparent',
								background: active ? theme.selectionBg : 'transparent',
								color: active ? theme.focusRing : theme.headerText,
								cursor: 'pointer',
								position: 'relative',
								padding: 0,
								transition: 'color 0.12s ease, background 0.12s ease, border-color 0.12s ease',
							}}
						>
							{panel.icon}
							{badge > 0 && (
								<span
									style={{
										position: 'absolute',
										top: -4,
										right: -4,
										minWidth: 15,
										height: 15,
										borderRadius: 999,
										background: theme.focusRing,
										color: theme.bgColor,
										fontSize: 9,
										fontWeight: 700,
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										lineHeight: 1,
										padding: '0 3px',
									}}
								>
									{badge > 9 ? '9+' : badge}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{/* Animated panel area */}
			<div
				style={{
					width: activeDef ? width : 0,
					flexShrink: 0,
					overflow: 'hidden',
					transition: 'width 220ms cubic-bezier(0.4,0,0.2,1)',
					display: 'flex',
					flexDirection: 'column',
					background: theme.bgColor,
					borderLeft: position === 'right' ? `1px solid ${theme.borderColor}` : undefined,
					borderRight: position === 'left' ? `1px solid ${theme.borderColor}` : undefined,
				}}
			>
				<div style={{ width, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
					{activeDef && activeDef.render(api, () => api.closePanel())}
				</div>
			</div>
		</div>
	);
}
