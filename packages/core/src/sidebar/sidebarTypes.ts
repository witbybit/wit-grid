import type { GridApi } from '../api/GridApi.js';
import type { ColumnFilter } from '../filterModel.js';
import type { DomFilterEditorHandle, FilterSurface } from '../filters/filterDef.js';

export type BuiltinSidebarPanelId = 'columns' | 'filters' | 'sort' | 'themes' | 'views' | 'query' | 'dataIntegrity';

/** What a panel gets when it opens. */
export interface SidebarPanelContext<TRowData = unknown> {
	readonly api: GridApi<TRowData>;
	/** The header slot beside the panel title, for the panel's own actions (“Clear all”). */
	readonly actions: HTMLElement;
	/** Closes the sidebar. */
	close(): void;
	/**
	 * Mounts a column's filter editor (the same editor as every other filter surface); it applies its
	 * filter itself and tells `onApplied` of each one.
	 */
	mountFilterEditor(
		container: HTMLElement,
		colField: string,
		surface?: FilterSurface,
		onApplied?: (filter: ColumnFilter | null) => void
	): DomFilterEditorHandle | null;
}

export interface SidebarPanelHandle {
	destroy?(): void;
}

/** A panel built from DOM. */
export interface SidebarPanel<TRowData = unknown> {
	mount(container: HTMLElement, context: SidebarPanelContext<TRowData>): SidebarPanelHandle | void;
}

/** A panel of your own. */
export interface SidebarPanelDef<TRowData = unknown> {
	id: string;
	label: string;
	/** SVG markup for the rail button (24×24 viewBox, `currentColor` strokes). */
	icon?: string;
	/** A DOM panel. */
	panel?: SidebarPanel<TRowData>;
	/** An adapter component (React: `renderPanel`), drawn through the adapter that mounted the grid. */
	renderPanel?(context: SidebarPanelContext<TRowData>): unknown;
}

export interface GridSidebarConfig<TRowData = unknown> {
	/** Panels in rail order: built-in ids or your own. Default: columns, filters, sort, views. */
	panels?: Array<BuiltinSidebarPanelId | SidebarPanelDef<TRowData>>;
	/** The panel open at first. */
	defaultOpen?: string | null;
	/** Default: 'right'. */
	position?: 'left' | 'right';
	/** Panel width in px. Default: 300. */
	width?: number;
}

/**
 * Renders an adapter panel component into a container; returns its unmount. Called again for the
 * same container with a new render (the panel's config changed), it updates the panel in place.
 */
export type AdapterPanelMount = (
	container: HTMLElement,
	render: (context: SidebarPanelContext<any>) => unknown,
	context: SidebarPanelContext<any>
) => () => void;
