import type { ColumnDef } from '../../columnDef.js';
import type { RowNode } from '../../rowNode.js';
import { recordCellSlotMountedVisualVersions, type CellSlot } from '../cellSlot.js';
import { mergeCellSnapshotTitle, type CellDisplaySnapshot } from '../cellDisplaySnapshot.js';
import type { VisualFreshness } from '../visualFreshness.js';
import type { RowCellBinderDeps } from '../rowCellBinder.js';
import type { DispatchCellPresentationInput } from './cellPresentationDispatcher.js';
import { deriveCellCtrlAccessibilityState, type CellCtrl } from '../controllers/CellCtrl.js';
import { createCellRendererLifecycle, type CellRendererLifecycle } from '../lifecycle/cellRendererLifecycle.js';

const lifecyclesByDeps = new WeakMap<object, CellRendererLifecycle<any>>();

/**
 * The CellRendererLifecycle for a binder deps object, created once and reused — the lifecycle's
 * closures only read `deps` at call time, so one instance per deps is equivalent to building a
 * fresh one (with its closures) for every cell bind.
 */
export function getCellRendererLifecycle<TRowData>(deps: RowCellBinderDeps<TRowData>): CellRendererLifecycle<TRowData> {
	let lifecycle = lifecyclesByDeps.get(deps) as CellRendererLifecycle<TRowData> | undefined;
	if (!lifecycle) {
		lifecycle = createCellRendererLifecycle(deps);
		lifecyclesByDeps.set(deps, lifecycle);
	}
	return lifecycle;
}

/**
 * Shared helpers used by every presentation-mode binder (primitiveCellBinder.ts, liveCellBinder.ts,
 * freezeCellBinder.ts, textImpostorCellBinder.ts, htmlSnapshotCellBinder.ts). Promoted out of
 * rowCellBinder.ts's former applyScrollCellPresentation closure/top-level scope — byte-for-byte
 * identical bodies, just given a shared home so the 5 binder files can all reach them.
 */

export function buildCellPinClass(lane: 'left' | 'center' | 'right'): string {
	if (lane === 'left') return 'og-cell og-cell-pinned-left';
	if (lane === 'right') return 'og-cell og-cell-pinned-right';
	return 'og-cell';
}

export function applyCellTitlesAndValidation(
	element: HTMLDivElement,
	tooltipText: string | null,
	insightTitle: string,
	validationError?: string
): void {
	const prevValidationAttr = element.dataset.validationError;
	if (validationError) {
		if (prevValidationAttr !== validationError) element.dataset.validationError = validationError;
	} else if (prevValidationAttr !== undefined) {
		delete element.dataset.validationError;
	}

	const title = mergeCellSnapshotTitle(tooltipText, insightTitle);
	if (title) {
		// Diffed rather than blind-written: an attribute write invalidates style and notifies
		// observers even when the value is unchanged.
		if (element.title !== title) element.title = title;
	} else if (element.title) {
		element.removeAttribute('title');
	}
}

export function applyCellAccessibilityState<TRowData>(cellSlot: CellSlot<TRowData>, cellCtrl: CellCtrl): boolean {
	return cellSlot.syncAccessibilityState(deriveCellCtrlAccessibilityState(cellCtrl));
}

/** Stamps the cell slot's mounted-version bookkeeping from a resolved presentation's freshness
 *  source — accepts either a full CellDisplaySnapshot or a bare VisualFreshness (some presentation
 *  kinds synthesize a freshness stamp with no backing snapshot). */
export function stampMountedVersions<TRowData>(
	cellSlot: CellSlot<TRowData>,
	rowVersion: number,
	globalVersion: number,
	source: CellDisplaySnapshot | VisualFreshness
): void {
	cellSlot.lastMountedRowVersion = rowVersion;
	cellSlot.lastMountedGlobalVersion = globalVersion;
	recordCellSlotMountedVisualVersions(cellSlot, source);
}

/** Best-effort value to hand a live-mounted renderer when no authoritative computed value is
 *  available on the scroll hot path (mount happens outside the normal semantic-read pipeline). */
export function getScrollMountValue<TRowData>(
	deps: RowCellBinderDeps<TRowData>,
	node: RowNode<TRowData>,
	col: ColumnDef<TRowData>,
	cellSlot?: CellSlot<TRowData>
): unknown {
	const cachedVal = deps.engine.data.getCachedDisplayValue(node.id, col.field);
	if (cachedVal !== undefined) return cachedVal;
	if (col.valueGetter || deps.engine.hasFormula(node.id, col.field)) {
		return '';
	}
	if (node.data) return (node.data as Record<string, unknown>)[col.field];
	// No row data at all (e.g. a loading placeholder row) — warm DOM may only stand in for this
	// exact row/column identity, never for whatever row previously occupied this slot.
	const isSameIdentity = !!cellSlot && cellSlot.rowId === node.id && cellSlot.colField === col.field;
	return isSameIdentity ? (cellSlot!.lastFormattedValue ?? '') : '';
}

interface OverscanCellIndex {
	length: number;
	byRow: Map<number, Set<string>>;
}

const overscanCellIndexes = new WeakMap<readonly { rowIndex: number; columnInstanceId: string }[], OverscanCellIndex>();

/**
 * O(1) membership test for a ViewportPlan's `liveCells.overscan` list — replaces a linear
 * `.some()` scan per cell per frame. The index is built once per (immutable, per-frame) plan array;
 * the length check rebuilds it defensively should a caller ever append to the array afterwards.
 */
export function isOverscanLiveCell(
	overscan: readonly { rowIndex: number; columnInstanceId: string }[],
	rowIndex: number,
	columnInstanceId: string
): boolean {
	if (overscan.length === 0) return false;
	let index = overscanCellIndexes.get(overscan);
	if (!index || index.length !== overscan.length) {
		const byRow = new Map<number, Set<string>>();
		for (const cell of overscan) {
			let columns = byRow.get(cell.rowIndex);
			if (!columns) {
				columns = new Set();
				byRow.set(cell.rowIndex, columns);
			}
			columns.add(cell.columnInstanceId);
		}
		index = { length: overscan.length, byRow };
		overscanCellIndexes.set(overscan, index);
	}
	return index.byRow.get(rowIndex)?.has(columnInstanceId) ?? false;
}

export function recordDispatchWrite<TRowData>(input: DispatchCellPresentationInput<TRowData>, didWrite: boolean): void {
	if (input.phase !== 'scroll') return;
	if (didWrite) input.deps.incrementCurrentScrollCellsWritten();
	input.deps.incrementCellsBoundDuringScroll();
}
