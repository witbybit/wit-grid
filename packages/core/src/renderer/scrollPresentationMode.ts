import { isDomCellRenderer, type CellScrollPresentation, type ColumnDef, type InternalColumnDef } from '../columnDef.js';
import { defaultRendererScroll } from '../models/ColumnModel.js';

/** A column's resolved scroll presentation: `'primitive'` for non-renderer cells, else its normalized `scroll`. */
export type ResolvedScrollPresentation = 'primitive' | CellScrollPresentation;

/**
 * Reads a column's scroll presentation. Defaults live in ColumnModel's normalization, which stamps
 * `scroll` onto `cellRendererCapabilities`; a raw `cellRenderer` set without a `renderer` spec is
 * the only un-normalized case and takes the same default.
 */
export function getCellScrollPresentation<TRowData>(col: ColumnDef<TRowData>): ResolvedScrollPresentation {
	const internal = col as InternalColumnDef<TRowData>;
	if (!internal.cellRenderer) return 'primitive';
	return internal.cellRendererCapabilities?.scroll ?? defaultRendererScroll(isDomCellRenderer(internal.cellRenderer));
}
