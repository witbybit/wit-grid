import { isDomCellRenderer, type CellScrollPresentation, type ColumnDef, type InternalColumnDef } from '../columnDef.js';

/**
 * Resolves a column's scroll presentation mode. Non-renderer columns are always 'primitive';
 * renderer columns without an explicit `scrollPresentation` default to 'freeze' (normalized onto
 * `cellRendererCapabilities` by ColumnModel.normalizeColumn — see normalizeRendererCapabilities).
 */
export function getCellScrollPresentation<TRowData>(col: ColumnDef<TRowData>): CellScrollPresentation {
	const internal = col as InternalColumnDef<TRowData>;
	if (!internal.cellRenderer) return 'primitive';
	// A raw DOM `cellRenderer` (no `renderer` spec) is not normalized; it gets the DOM default too.
	return internal.cellRendererCapabilities?.scrollPresentation ?? (isDomCellRenderer(internal.cellRenderer) ? 'update' : 'freeze');
}

export function isPrimitivePresentation<TRowData>(col: ColumnDef<TRowData>): boolean {
	return getCellScrollPresentation(col) === 'primitive';
}

export function isLivePresentation<TRowData>(col: ColumnDef<TRowData>): boolean {
	return getCellScrollPresentation(col) === 'live';
}

export function isFreezePresentation<TRowData>(col: ColumnDef<TRowData>): boolean {
	return getCellScrollPresentation(col) === 'freeze';
}

export function isTextImpostorPresentation<TRowData>(col: ColumnDef<TRowData>): boolean {
	return getCellScrollPresentation(col) === 'text-impostor';
}

export function isHtmlSnapshotPresentation<TRowData>(col: ColumnDef<TRowData>): boolean {
	return getCellScrollPresentation(col) === 'html-snapshot';
}

/** True for `scrollPresentation: 'live'` columns configured for imperative (ref-based) updates. */
export function isImperativeLivePresentation<TRowData>(col: ColumnDef<TRowData>): boolean {
	const internal = col as InternalColumnDef<TRowData>;
	return internal.cellRendererCapabilities?.scrollPresentation === 'live' && internal.cellRendererCapabilities?.live?.update === 'imperative';
}
