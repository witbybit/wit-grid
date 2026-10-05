import type { GroupVisualRow, TotalVisualRow } from '../visualRow.js';
import { isHierarchyColumn } from '../rows/hierarchyColumn.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { CellRendererPhase, ColumnDef, InternalColumnDef } from '../columnDef.js';
import type { InternalGridState } from '../state/GridState.js';
import type { RowNode } from '../rowNode.js';
import type { CellRenderer } from './cellRenderer.js';
import type { InvalidationFrame } from './invalidationManager.js';
import type { RenderWindow } from './renderWindow.js';
import type { RowSlot } from './rowSlot.js';
import type { ScrollRenderContext } from './scrollRenderContext.js';
import type { SelectionPaintManager } from './selectionPaintManager.js';
import { getMemoizedColumnTopology } from './columnTopology.js';
import { doesCanonicalCellPointerMatchColumn } from '../interaction/cellPointer.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { CellSlot } from './cellSlot.js';
import { isPostScrollRepairCurrent } from './cellPresentationStateMachine.js';

export interface RowCellBindRequest<TRowData = unknown> {
	cellSlot: {
		element: HTMLDivElement;
	};
	slotId: string;
	/** Physical slot generation — incremented on each row rebind. Required for stale-mount detection. */
	slotGeneration: number;
	node: RowNode<TRowData>;
	rowIndex: number;
	colIndex: number;
	col: ColumnDef<TRowData>;
	lane: 'left' | 'center' | 'right';
	pinRightBaseLeft: number;
	plan: ReturnType<GridEngine<TRowData>['columns']['getCompiledPlan']>;
	state: InternalGridState<TRowData>;
	isScrollFrameActive: boolean;
	ctx?: ScrollRenderContext<TRowData>;
	phase?: CellRendererPhase;
}

export interface RowRenderMaintenanceDeps<TRowData = unknown> {
	engine: GridEngine<TRowData>;
	selectionPaint: SelectionPaintManager<TRowData>;
	cellRenderer: CellRenderer;
	activeRows: Map<number, RowSlot<TRowData>>;
	getCurrentWindow: () => RenderWindow | null;
	dirtyCellsAfterScroll: Set<HTMLDivElement>;
	dirtyRowsAfterScroll: Set<number>;
	dirtyBuckets: [HTMLDivElement[], HTMLDivElement[], HTMLDivElement[], HTMLDivElement[]];
	incrementPostScrollDirtyCellsDecorated: () => void;
	incrementStalePostScrollRepairsRejected: () => void;
	bindCellFull: (request: RowCellBindRequest<TRowData>) => void;
	/** Rebinds a group / total row's cells (focus, selection and value changes reach them here). */
	rebindHierarchyRow?: (slot: RowSlot<TRowData>, row: GroupVisualRow<TRowData> | TotalVisualRow<TRowData>, rowIndex: number) => void;
}

export type PostScrollRepairLane = 'motion' | 'fidelity' | 'all';

export interface DecorateDirtyCellsAfterScrollResult {
	remaining: number;
	processed: number;
	remainingMotion: number;
	remainingFidelity: number;
}

/**
 * Explicitly order repairs within a priority bucket. Set insertion order reflects whichever
 * scroll frame happened to dirty a cell first, so it must not decide which visible cell settles
 * first. Keeping the tie-break entirely on physical binding identity makes repeated runs and
 * lane changes deterministic without introducing a new queue owner.
 */
export function sortDirtyCellsForRepair(cells: HTMLDivElement[], getPriority: (cell: HTMLDivElement) => number): void {
	if (cells.length < 2) return;
	// Priority is evaluated once per cell, not twice per comparison (O(n) vs O(n log n) calls).
	const priorities = new Map<HTMLDivElement, number>();
	for (const cell of cells) priorities.set(cell, getPriority(cell));
	cells.sort((a, b) => {
		const priorityDelta = priorities.get(b)! - priorities.get(a)!;
		if (priorityDelta !== 0) return priorityDelta;
		const aSlot = (a as unknown as { __cellSlot?: { rowIndex?: number; colIndex?: number; cellInstanceId?: string } }).__cellSlot;
		const bSlot = (b as unknown as { __cellSlot?: { rowIndex?: number; colIndex?: number; cellInstanceId?: string } }).__cellSlot;
		const rowDelta = (aSlot?.rowIndex ?? Number.MAX_SAFE_INTEGER) - (bSlot?.rowIndex ?? Number.MAX_SAFE_INTEGER);
		if (rowDelta !== 0) return rowDelta;
		const colDelta = (aSlot?.colIndex ?? Number.MAX_SAFE_INTEGER) - (bSlot?.colIndex ?? Number.MAX_SAFE_INTEGER);
		if (colDelta !== 0) return colDelta;
		return (aSlot?.cellInstanceId ?? '').localeCompare(bSlot?.cellInstanceId ?? '');
	});
}

type DirtyCellSlotIdentity = { rowIndex?: number; colIndex?: number; rowId?: string; columnInstanceId?: string };

interface DirtyRepairQueueKey {
	rowStart: number;
	rowEnd: number;
	colStart: number;
	colEnd: number;
	focusedCell: unknown;
	activeEdit: unknown;
	plan: unknown;
	rowModel: unknown;
}

/**
 * Persistent repair order for one dirty set. Post-scroll repair runs in many small idle chunks;
 * re-bucketing and re-sorting the whole dirty set per chunk made a full repair O(n² log n). The
 * queue is reused while every input to the priority and tie-break order is unchanged (visible
 * ranges, focus/edit pointers, column plan, row model, dirty-set membership and each queued
 * cell's slot identity), so a reused queue yields exactly the order a fresh sort would. Any
 * mismatch (a new scroll epoch moves the ranges, a cell is added, a slot rebinds) re-sorts.
 */
interface DirtyRepairQueue extends DirtyRepairQueueKey {
	cells: HTMLDivElement[];
	rowIndexes: (number | undefined)[];
	colIndexes: (number | undefined)[];
	rowIds: (string | undefined)[];
	columnInstanceIds: (string | undefined)[];
}

const dirtyRepairQueues = new WeakMap<Set<HTMLDivElement>, DirtyRepairQueue>();

function getCellSlotIdentity(cell: HTMLDivElement): DirtyCellSlotIdentity | undefined {
	return (cell as unknown as { __cellSlot?: DirtyCellSlotIdentity }).__cellSlot;
}

function isDirtyRepairQueueCurrent(
	queue: DirtyRepairQueue | undefined,
	dirtyCells: Set<HTMLDivElement>,
	key: DirtyRepairQueueKey
): queue is DirtyRepairQueue {
	if (
		!queue ||
		queue.cells.length !== dirtyCells.size ||
		queue.rowStart !== key.rowStart ||
		queue.rowEnd !== key.rowEnd ||
		queue.colStart !== key.colStart ||
		queue.colEnd !== key.colEnd ||
		queue.focusedCell !== key.focusedCell ||
		queue.activeEdit !== key.activeEdit ||
		queue.plan !== key.plan ||
		queue.rowModel !== key.rowModel
	) {
		return false;
	}
	for (let i = 0; i < queue.cells.length; i++) {
		const cell = queue.cells[i];
		if (!dirtyCells.has(cell)) return false;
		const cs = getCellSlotIdentity(cell);
		if (
			cs?.rowIndex !== queue.rowIndexes[i] ||
			cs?.colIndex !== queue.colIndexes[i] ||
			cs?.rowId !== queue.rowIds[i] ||
			cs?.columnInstanceId !== queue.columnInstanceIds[i]
		) {
			return false;
		}
	}
	return true;
}

function getDirtyCellSlot(cell: HTMLDivElement): CellSlot | undefined {
	return (cell as unknown as { __cellSlot?: CellSlot }).__cellSlot;
}

function getDirtyCellLane(cell: HTMLDivElement): Exclude<PostScrollRepairLane, 'all'> {
	const cs = getDirtyCellSlot(cell);
	if (cs?.postScrollRepair === 'motion' || cs?.postScrollRepair === 'fidelity') return cs.postScrollRepair;
	throw new Error('Dirty cell has no post-scroll repair lane.');
}

function clearDirtyCellRepair(cell: HTMLDivElement): void {
	const cs = getDirtyCellSlot(cell);
	if (!cs) return;
	cs.postScrollRepair = 'none';
	cs.postScrollRepairReasons = 0;
	cs.postScrollRepairBindingGeneration = -1;
}

function getDisplayedColumnIndexesForField<TRowData>(columns: readonly ColumnDef<TRowData>[], colField: string): number[] {
	const indexes: number[] = [];
	for (let index = 0; index < columns.length; index++) {
		if (columns[index]?.field === colField) indexes.push(index);
	}
	return indexes;
}

function getDisplayedColumnIndexesForInvalidation<TRowData>(columns: readonly ColumnDef<TRowData>[], colIdOrField: string): number[] {
	const exactIndexes: number[] = [];
	for (let index = 0; index < columns.length; index++) {
		const column = columns[index] as InternalColumnDef<TRowData> | undefined;
		if (!column) continue;
		if (column.instanceId === colIdOrField || column.colId === colIdOrField) exactIndexes.push(index);
	}
	if (exactIndexes.length > 0) return exactIndexes;
	return getDisplayedColumnIndexesForField(columns, colIdOrField);
}

export function repaintInvalidatedRows<TRowData>(deps: RowRenderMaintenanceDeps<TRowData>, frame: InvalidationFrame): void {
	const rowModel = deps.engine.getVisualRowModel();
	if (!rowModel) return;

	const state = deps.engine.stateManager.getState();
	const interaction = readInteractionState(state);
	const columns = deps.engine.columns.getDisplayedColumns();
	const plan = deps.engine.columns.getCompiledPlan();
	const columnTopology = getMemoizedColumnTopology(plan);
	const colCount = columns.length;
	const pinRightBaseLeft = plan.pinRightBaseLeft;

	deps.selectionPaint.rebuildSelection(interaction.rowSelection.selectedRowIds);

	for (const rowId of frame.rows) {
		const rowIndex = rowModel.getVisualIndexByRowId(rowId);
		const slot = rowIndex >= 0 ? deps.activeRows.get(rowIndex) : undefined;
		const row = rowIndex >= 0 ? rowModel.getVisualRow(rowIndex) : null;
		if (!slot || row?.kind !== 'data') continue;

		deps.selectionPaint.updateRowClassNameSlot(slot, row.node, rowIndex, state);
		for (let c = 0; c < colCount; c++) {
			// Selection-driven parts: the row checkbox and the hierarchy cell's checkbox.
			if (!columns[c].checkboxSelection && !isHierarchyColumn(columns[c])) continue;
			const cellSlot = slot.getCellForCol(c);
			if (!cellSlot) continue;
			const lane = columnTopology.byColumnId.get((columns[c] as InternalColumnDef<TRowData>).instanceId)?.lane ?? 'center';
			deps.bindCellFull({
				cellSlot,
				slotId: slot.id,
				slotGeneration: slot.generation,
				node: row.node,
				rowIndex,
				colIndex: c,
				col: columns[c],
				lane,
				pinRightBaseLeft,
				plan,
				state,
				isScrollFrameActive: false,
				phase: 'initial',
			});
		}
	}
}

export function repaintInvalidatedCells<TRowData>(deps: RowRenderMaintenanceDeps<TRowData>, frame: InvalidationFrame): void {
	const rowModel = deps.engine.getVisualRowModel();
	if (!rowModel) return;

	const state = deps.engine.stateManager.getState();
	const interaction = readInteractionState(state);
	const columns = deps.engine.columns.getDisplayedColumns();
	const plan = deps.engine.columns.getCompiledPlan();
	const columnTopology = getMemoizedColumnTopology(plan);
	const pinRightBaseLeft = plan.pinRightBaseLeft;

	for (const [rowId, colFields] of frame.cellsByRowId) {
		const rowIndex = rowModel.getVisualIndexByRowId(rowId);
		if (rowIndex < 0) continue;
		const slot = deps.activeRows.get(rowIndex);
		const row = rowModel.getVisualRow(rowIndex);
		if (slot && (row?.kind === 'group' || row?.kind === 'total')) {
			deps.rebindHierarchyRow?.(slot, row, rowIndex);
			continue;
		}
		if (!slot || row?.kind !== 'data') continue;

		for (const colIdOrField of colFields) {
			for (const colIndex of getDisplayedColumnIndexesForInvalidation(columns, colIdOrField)) {
				const cellSlot = slot.getCellForCol(colIndex);
				if (!cellSlot) continue;
				const lane = columnTopology.byColumnId.get((columns[colIndex] as InternalColumnDef<TRowData>).instanceId)?.lane ?? 'center';
				deps.bindCellFull({
					cellSlot,
					slotId: slot.id,
					slotGeneration: slot.generation,
					node: row.node,
					rowIndex,
					colIndex,
					col: columns[colIndex],
					lane,
					pinRightBaseLeft,
					plan,
					state,
					isScrollFrameActive: false,
					phase: 'initial',
				});
			}
		}
	}

	for (const colIdOrField of frame.columns) {
		for (const colIndex of getDisplayedColumnIndexesForInvalidation(columns, colIdOrField)) {
			const lane = columnTopology.byColumnId.get((columns[colIndex] as InternalColumnDef<TRowData>).instanceId)?.lane ?? 'center';
			for (const [rowIndex, slot] of deps.activeRows) {
				const row = rowModel.getVisualRow(rowIndex);
				if (row?.kind !== 'data') continue;

				const cellSlot = slot.getCellForCol(colIndex);
				if (!cellSlot) continue;
				deps.bindCellFull({
					cellSlot,
					slotId: slot.id,
					slotGeneration: slot.generation,
					node: row.node,
					rowIndex,
					colIndex,
					col: columns[colIndex],
					lane,
					pinRightBaseLeft,
					plan,
					state,
					isScrollFrameActive: false,
					phase: 'initial',
				});
			}
		}
	}
}

export function repaintInvalidatedRowsAndCells<TRowData>(deps: RowRenderMaintenanceDeps<TRowData>, frame: InvalidationFrame): void {
	repaintInvalidatedRows(deps, frame);
	repaintInvalidatedCells(deps, frame);
}

export function decorateDirtyCellsAfterScroll<TRowData>(
	deps: RowRenderMaintenanceDeps<TRowData>,
	options?: { maxCells?: number; lane?: PostScrollRepairLane }
): DecorateDirtyCellsAfterScrollResult {
	const maxCells = options?.maxCells ?? Infinity;
	const lane = options?.lane ?? 'all';
	if (deps.dirtyCellsAfterScroll.size === 0 && deps.dirtyRowsAfterScroll.size === 0) {
		return { remaining: 0, processed: 0, remainingMotion: 0, remainingFidelity: 0 };
	}

	const rowModel = deps.engine.getVisualRowModel();
	if (!rowModel) {
		for (const cell of deps.dirtyCellsAfterScroll) clearDirtyCellRepair(cell);
		deps.dirtyCellsAfterScroll.clear();
		deps.dirtyRowsAfterScroll.clear();
		return { remaining: 0, processed: 0, remainingMotion: 0, remainingFidelity: 0 };
	}

	const state = deps.engine.stateManager.getState();
	const interaction = readInteractionState(state);
	const columns = deps.engine.columns.getDisplayedColumns();
	const plan = deps.engine.columns.getCompiledPlan();
	const columnTopology = getMemoizedColumnTopology(plan);
	const colCount = columns.length;
	const pinRightBaseLeft = plan.pinRightBaseLeft;

	const rowCount = rowModel.getVisualRowCount();
	const colRange = deps.engine.viewport.getVisibleColumnRange(colCount);
	const rowRange = deps.engine.viewport.getVisibleRowRange(rowCount);
	const rowCenter = (rowRange.startIdx + rowRange.endIdx) / 2;
	const colCenter = (colRange.startIdx + colRange.endIdx) / 2;
	const activeEdit = interaction.activeEdit.active;
	const focusedCell = interaction.focus.cell;

	const getCellPriority = (cell: HTMLDivElement): number => {
		const cs = (
			cell as unknown as {
				__cellSlot?: { rowIndex: number; colField?: string; rowId?: string; colIndex: number; columnInstanceId?: string };
			}
		).__cellSlot;
		if (!cs || cs.rowIndex < 0 || !cs.colField) return 0;
		if (
			activeEdit &&
			doesCanonicalCellPointerMatchColumn(activeEdit, cs.rowId ?? '', { field: cs.colField, instanceId: cs.columnInstanceId as any })
		)
			return 6;
		if (
			focusedCell &&
			doesCanonicalCellPointerMatchColumn(focusedCell, cs.rowId ?? '', { field: cs.colField, instanceId: cs.columnInstanceId as any })
		)
			return 5;

		const isRowVisible = cs.rowIndex >= rowRange.startIdx && cs.rowIndex <= rowRange.endIdx;
		const isColVisible = cs.colIndex >= colRange.startIdx && cs.colIndex <= colRange.endIdx;
		if (!isRowVisible || !isColVisible) return 1;

		const normDist = Math.abs(cs.rowIndex - rowCenter) + Math.abs(cs.colIndex - colCenter);
		return 4 - normDist * 0.01;
	};

	const queueKey: DirtyRepairQueueKey = {
		rowStart: rowRange.startIdx,
		rowEnd: rowRange.endIdx,
		colStart: colRange.startIdx,
		colEnd: colRange.endIdx,
		focusedCell,
		activeEdit,
		plan,
		rowModel,
	};
	let queue = dirtyRepairQueues.get(deps.dirtyCellsAfterScroll);
	if (!isDirtyRepairQueueCurrent(queue, deps.dirtyCellsAfterScroll, queueKey)) {
		const [b0, b1, b2, b3] = deps.dirtyBuckets;
		b0.length = 0;
		b1.length = 0;
		b2.length = 0;
		b3.length = 0;
		for (const cell of deps.dirtyCellsAfterScroll) {
			const p = getCellPriority(cell);
			if (p >= 6) b0.push(cell);
			else if (p >= 5) b1.push(cell);
			else if (p > 1) b2.push(cell);
			else b3.push(cell);
		}
		for (const bucket of deps.dirtyBuckets) sortDirtyCellsForRepair(bucket, getCellPriority);
		queue = { ...queueKey, cells: [], rowIndexes: [], colIndexes: [], rowIds: [], columnInstanceIds: [] };
		for (const bucket of deps.dirtyBuckets) {
			for (const cell of bucket) queue.cells.push(cell);
			bucket.length = 0;
		}
		dirtyRepairQueues.set(deps.dirtyCellsAfterScroll, queue);
	}

	// Walk the queue in priority order, compacting survivors (unprocessed cells, other-lane cells)
	// to the front so the queue keeps mirroring the dirty set for the next chunk.
	const queued = queue.cells;
	let kept = 0;
	let processed = 0;
	for (let i = 0; i < queued.length; i++) {
		const cell = queued[i];
		if (!deps.dirtyCellsAfterScroll.has(cell)) continue;
		if (processed >= maxCells || (lane !== 'all' && getDirtyCellLane(cell) !== lane)) {
			queued[kept++] = cell;
			continue;
		}
		deps.dirtyCellsAfterScroll.delete(cell);
		const cs = getDirtyCellSlot(cell);
		if (!cs) continue;
		if (!isPostScrollRepairCurrent(cs.rowBindingGeneration, cs.postScrollRepairBindingGeneration)) {
			clearDirtyCellRepair(cell);
			deps.incrementStalePostScrollRepairsRejected();
			continue;
		}
		clearDirtyCellRepair(cell);
		if (cs.rowIndex < 0 || !cs.colField) continue;

		const rowIndex = cs.rowIndex;
		const visualRow = rowModel.getVisualRow(rowIndex);
		const colIndex = cs.colIndex;

		if (visualRow?.kind === 'data' && colIndex >= 0) {
			const slot = deps.activeRows.get(rowIndex);
			if (!slot) continue;
			const cellSlot = slot.getCellForCol(colIndex);
			if (!cellSlot || cellSlot.element !== cell) continue;

			const laneCol = columns[colIndex] as InternalColumnDef<TRowData> | undefined;
			const lane = (laneCol ? columnTopology.byColumnId.get(laneCol.instanceId) : undefined)?.lane ?? 'center';
			deps.bindCellFull({
				cellSlot,
				slotId: slot.id,
				slotGeneration: slot.generation,
				node: visualRow.node,
				rowIndex,
				colIndex,
				col: columns[colIndex],
				lane,
				pinRightBaseLeft,
				plan,
				state,
				isScrollFrameActive: false,
				phase: 'scroll-idle',
			});
			deps.incrementPostScrollDirtyCellsDecorated();
			processed++;
		} else if (visualRow?.kind === 'loading' && colIndex >= 0) {
			const slot = deps.activeRows.get(rowIndex);
			if (!slot) continue;
			const cellSlot = slot.getCellForCol(colIndex);
			if (!cellSlot || cellSlot.element !== cell) continue;

			deps.cellRenderer.ensureLoadingSkeleton(cell);
			deps.incrementPostScrollDirtyCellsDecorated();
			processed++;
		}
	}
	queued.length = kept;
	// Snapshot the survivors' slot identity after binding so the next chunk can prove the order
	// is still exactly what a fresh sort would produce.
	queue.rowIndexes.length = kept;
	queue.colIndexes.length = kept;
	queue.rowIds.length = kept;
	queue.columnInstanceIds.length = kept;
	for (let i = 0; i < kept; i++) {
		const cs = getCellSlotIdentity(queued[i]);
		queue.rowIndexes[i] = cs?.rowIndex;
		queue.colIndexes[i] = cs?.colIndex;
		queue.rowIds[i] = cs?.rowId;
		queue.columnInstanceIds[i] = cs?.columnInstanceId;
	}

	const remaining = deps.dirtyCellsAfterScroll.size;
	let remainingMotion = 0;
	let remainingFidelity = 0;
	for (const cell of deps.dirtyCellsAfterScroll) {
		if (getDirtyCellLane(cell) === 'fidelity') remainingFidelity++;
		else remainingMotion++;
	}
	if (remaining === 0) {
		dirtyRepairQueues.delete(deps.dirtyCellsAfterScroll);
		for (const r of deps.dirtyRowsAfterScroll) {
			const slot = deps.activeRows.get(r);
			const visualRow = rowModel.getVisualRow(r);
			if (slot && visualRow?.kind === 'data') {
				deps.selectionPaint.updateRowClassNameSlot(slot, (visualRow as { node: RowNode<TRowData> }).node, r, state);
			}
		}
		deps.dirtyRowsAfterScroll.clear();
	}

	return { remaining, processed, remainingMotion, remainingFidelity };
}
