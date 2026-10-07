import { useContext, useLayoutEffect, useRef } from 'react';
import {
	createFilterEditor,
	resolveColumnFilterDef,
	type ColumnDef,
	type ColumnFilter,
	type DomFilterEditorHandle,
	type FilterSurface,
	type GridApi,
} from '@eregister/wit-grid-core';
import { GridFilterMountContext } from '../gridContext.js';

export interface CoreFilterEditorProps {
	api: GridApi<any>;
	column: ColumnDef<any>;
	surface: FilterSurface;
	filter: ColumnFilter | null;
	onChange: (filter: ColumnFilter | null) => void;
}

/**
 * Mounts the grid's own filter editor for a column (from its `filterDef`): the editor the header
 * funnel, menu and floating row show, so React surfaces (sidebar, query builder) match them. It
 * carries the grid's theme scope, so it and its popovers read the grid's theme outside the grid.
 */
export function CoreFilterEditor({ api, column, surface, filter, onChange }: CoreFilterEditorProps) {
	const ref = useRef<HTMLDivElement>(null);
	const mountFilter = useContext(GridFilterMountContext);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	// The filter this editor last showed or applied: a different one came from elsewhere.
	const shown = useRef<ColumnFilter | null | undefined>(undefined);
	const def = resolveColumnFilterDef(column);

	const handle = useRef<DomFilterEditorHandle | null>(null);
	const mountedFor = useRef<{ column: ColumnDef<any>; surface: FilterSurface } | null>(null);

	useLayoutEffect(() => {
		const host = ref.current;
		if (!host || !def) return;
		// Its own changes keep the editor (focus, typing); a filter set elsewhere, or a new column
		// definition, remounts it.
		const same = mountedFor.current?.column === column && mountedFor.current.surface === surface;
		if (same && shown.current === filter && handle.current) return;
		shown.current = filter;
		mountedFor.current = { column, surface };
		handle.current?.destroy?.();
		host.replaceChildren();
		const scope = api.getContainer()?.dataset.ogThemeScope;
		if (scope) host.dataset.ogThemeScope = scope;
		handle.current = createFilterEditor(def, surface, mountFilter).mount(host, {
			colField: column.field,
			filterDef: def,
			filter,
			surface,
			onChange: (next) => {
				shown.current = next;
				onChangeRef.current(next);
			},
			distinctValues: () => api.getColumnDistinctValueSummary(column.field),
		});
	}, [api, column, def, surface, filter, mountFilter]);

	useLayoutEffect(
		() => () => {
			handle.current?.destroy?.();
			handle.current = null;
		},
		[]
	);

	return def ? <div ref={ref} className='og-flt-host' /> : null;
}
