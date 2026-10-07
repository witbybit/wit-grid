import React, { type ReactNode } from 'react';
import type { BuiltinSidebarPanelId, GridSidebarConfig as CoreSidebarConfig, SidebarPanelContext, SidebarPanelDef as CorePanelDef } from '@eregister/wit-grid-core';
import type { GridApi } from '../types.js';
import { DataIntegrityPanel } from './panels/DataIntegrityPanel.js';
import { QueryPanel } from './panels/QueryPanel.js';
import { ViewsPanel } from './panels/ViewsPanel.js';

/** A sidebar panel of your own: a DOM `panel`, or a React component from `renderPanel`. */
export interface SidebarPanelDef<TRowData = unknown> extends Omit<CorePanelDef<TRowData>, 'renderPanel'> {
	renderPanel?(context: SidebarPanelContext<TRowData>): ReactNode;
}

export interface GridSidebarConfig<TRowData = unknown> extends Omit<CoreSidebarConfig<TRowData>, 'panels'> {
	panels?: Array<BuiltinSidebarPanelId | SidebarPanelDef<TRowData>>;
}

export type { BuiltinSidebarPanelId, SidebarPanelContext };

// Built-in panels still drawn by React until their core versions land.
const REACT_PANELS: Partial<Record<BuiltinSidebarPanelId, { label: string; render: (api: GridApi<any>, close: () => void) => ReactNode }>> = {
	views: { label: 'Views', render: (api, close) => <ViewsPanel api={api} onClose={close} /> },
	query: { label: 'Query', render: (api, close) => <QueryPanel api={api} onClose={close} /> },
	dataIntegrity: { label: 'Data Integrity', render: (api, close) => <DataIntegrityPanel api={api} onClose={close} /> },
};

export function toCoreSidebarConfig<TRowData>(config: GridSidebarConfig<TRowData>): CoreSidebarConfig<TRowData> {
	const panels = (config.panels ?? ['columns', 'filters', 'sort', 'views']).map((entry) => {
		if (typeof entry !== 'string') return entry as CorePanelDef<TRowData>;
		const react = REACT_PANELS[entry];
		if (!react) return entry;
		return { id: entry, label: react.label, renderPanel: (context: SidebarPanelContext<TRowData>) => react.render(context.api as GridApi<any>, context.close) };
	});
	return { ...config, panels };
}
