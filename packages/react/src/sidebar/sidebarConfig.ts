import type { ReactNode } from 'react';
import type {
	BuiltinSidebarPanelId,
	GridSidebarConfig as CoreSidebarConfig,
	SidebarPanelContext,
	SidebarPanelDef as CorePanelDef,
} from '@eregister/wit-grid-core';

/** A sidebar panel of your own: a DOM `panel`, or a React component from `renderPanel`. */
export interface SidebarPanelDef<TRowData = unknown> extends Omit<CorePanelDef<TRowData>, 'renderPanel'> {
	renderPanel?(context: SidebarPanelContext<TRowData>): ReactNode;
}

/** The sidebar: core draws it; React panels (`renderPanel`) render through the grid's portal tree. */
export interface GridSidebarConfig<TRowData = unknown> extends Omit<CoreSidebarConfig<TRowData>, 'panels'> {
	panels?: Array<BuiltinSidebarPanelId | SidebarPanelDef<TRowData>>;
}

export type { BuiltinSidebarPanelId, SidebarPanelContext };
