import { CellSlot, toPx } from './cellSlot.js';
import type { ColumnInstanceId } from '../columnDef.js';

export const rowSlotWriteStats = {
	rowClassWrites: 0,
	rowTransformWrites: 0,
	rowHeightWrites: 0,
};

export function resetRowSlotWriteStats(): void {
	rowSlotWriteStats.rowClassWrites = 0;
	rowSlotWriteStats.rowTransformWrites = 0;
	rowSlotWriteStats.rowHeightWrites = 0;
}

export class RowSlot<TRowData = unknown> {
	public readonly id: string;
	public readonly element: HTMLDivElement;

	public visualIndex = -1;
	public visualRowId = '';
	public rowKind: 'data' | 'group' | 'detail' | 'loading' | 'failed' | 'placeholder' | 'footer' | '' = '';
	public rowTop = -1;
	public rowHeight = -1;

	// Integer comparisons are faster than string comparisons
	public lastTop = -1;
	public lastHeight = -1;
	public lastClassName = '';
	public lastVisualIndex = -2; // distinct from -1 so first update always fires
	public lastVisualRowId = '\0'; // guaranteed != any real rowId on first update

	public keepAlive = false;
	/** Mirrors the inline `visibility: hidden` unbindHot() writes (the only writer), so update()
	 *  doesn't read the style back on every bind. */
	private hiddenByUnbind = false;
	public lastPortalRowKey: string | undefined = undefined;

	/**
	 * Incremented each time this slot is rebound to a different visual row.
	 * Consumers may capture the generation at mount time and compare later to
	 * detect stale deferred or async operations.
	 */
	public generation = 0;

	public pinLeftContainer: HTMLDivElement | null = null;
	public pinRightContainer: HTMLDivElement | null = null;
	public pinLeftContainerWidth = -1;
	public pinRightContainerWidth = -1;

	// ── Stable cell ownership — keyed by column instance id ─────────────────────────
	// This map is the lifecycle owner for all cell slots in this row slot.
	// Lane arrays below are derived placement views rebuilt each frame by reconcileTopology.
	// A column moving between lanes relocates its CellSlot — it does not destroy and recreate it.
	// Keyed by ColumnInstanceId, not field — a field that is semantically replaced (different
	// renderer/valueGetter reusing the same field) gets a new instance id and therefore a fresh cell.
	public readonly cellsByColumnInstanceId: Map<ColumnInstanceId, CellSlot<TRowData>> = new Map();

	// ── Lane-based cell slots (derived from cellsByColumnInstanceId) ─────────────────
	// Three ordered arrays — one per pin lane. Rebuilt each frame by reconcileTopology.
	// During normal scroll none of these change length, so zero cell DOM append/remove occurs.
	//
	// Indices:
	//   leftCells[i]   ↔  columns[i]                   (i in 0..pinLeftCount-1)
	//   centerCells[i] ↔  columns[centerColStart + i]   (i in 0..centerCells.length-1)
	//   rightCells[i]  ↔  columns[pinRightStart + i]    (i in 0..rightCells.length-1)

	public readonly leftCells: CellSlot<TRowData>[] = [];
	public readonly centerCells: CellSlot<TRowData>[] = [];
	public readonly rightCells: CellSlot<TRowData>[] = [];

	// Column-layout metadata updated each frame — needed for getCellForCol() lookups.
	public centerColStart = 0;
	public pinLeftCount = 0;
	public pinRightStart = Number.MAX_SAFE_INTEGER;

	constructor(id: string, element: HTMLDivElement) {
		this.id = id;
		this.element = element;
		if (element.getAttribute('role') !== 'row') element.setAttribute('role', 'row');
		element.dataset.rowSlotId = id;
		this.hiddenByUnbind = element.style.visibility === 'hidden';
	}

	// ── Lookup ───────────────────────────────────────────────────────────────────────

	/**
	 * Return the CellSlot for a given column index, or undefined if the column is
	 * outside every active lane.
	 */
	public getCellForCol(colIndex: number): CellSlot<TRowData> | undefined {
		if (colIndex < this.pinLeftCount) return this.leftCells[colIndex];
		if (colIndex >= this.pinRightStart) {
			const i = colIndex - this.pinRightStart;
			return i < this.rightCells.length ? this.rightCells[i] : undefined;
		}
		const i = colIndex - this.centerColStart;
		if (i < 0 || i >= this.centerCells.length) return undefined;
		return this.centerCells[i];
	}

	// ── Lane resize helpers ──────────────────────────────────────────────────────────

	/** Iterate every CellSlot across all three lanes. */
	public forEachCell(fn: (cell: CellSlot<TRowData>) => void): void {
		for (const c of this.leftCells) fn(c);
		for (const c of this.centerCells) fn(c);
		for (const c of this.rightCells) fn(c);
	}

	/** Total live cell count across all lanes. */
	public get cellCount(): number {
		return this.leftCells.length + this.centerCells.length + this.rightCells.length;
	}

	// ── Row position / identity ──────────────────────────────────────────────────────

	public update(
		visualIndex: number,
		visualRowId: string,
		rowKind: 'data' | 'group' | 'detail' | 'loading' | 'failed' | 'placeholder' | 'footer',
		rowTop: number,
		rowHeight: number,
		className: string
	): boolean {
		let domUpdated = false;

		this.visualIndex = visualIndex;
		this.visualRowId = visualRowId;
		this.rowKind = rowKind;
		this.rowTop = rowTop;
		this.rowHeight = rowHeight;

		if (this.hiddenByUnbind) {
			this.hiddenByUnbind = false;
			this.element.style.visibility = '';
			domUpdated = true;
		}

		if (this.lastTop !== rowTop) {
			this.lastTop = rowTop;
			// translateY (not top): moving a row must never invalidate layout — transform
			// changes are paint/composite-only. Rows sit at top:0 and are offset here.
			this.element.style.transform = `translateY(${rowTop}px)`;
			rowSlotWriteStats.rowTransformWrites++;
			domUpdated = true;
		}
		if (this.lastHeight !== rowHeight) {
			this.lastHeight = rowHeight;
			this.element.style.height = toPx(rowHeight);
			rowSlotWriteStats.rowHeightWrites++;
			domUpdated = true;
		}

		if (this.lastVisualIndex !== visualIndex) {
			this.lastVisualIndex = visualIndex;
			this.element.dataset.rowIndex = String(visualIndex);
			this.element.setAttribute('aria-rowindex', String(visualIndex + 1)); // ARIA: 1-based
			domUpdated = true;
		}
		if (this.lastVisualRowId !== visualRowId) {
			this.lastVisualRowId = visualRowId;
			this.element.dataset.rowId = visualRowId;
			this.generation++;
			domUpdated = true;
		}
		if (this.lastClassName !== className) {
			this.lastClassName = className;
			this.element.className = className;
			rowSlotWriteStats.rowClassWrites++;
			domUpdated = true;
		}

		return domUpdated;
	}

	public updatePosition(rowTop: number): void {
		this.rowTop = rowTop;
		if (this.lastTop !== rowTop) {
			this.lastTop = rowTop;
			this.element.style.transform = `translateY(${rowTop}px)`;
			rowSlotWriteStats.rowTransformWrites++;
		}
	}

	/**
	 * Hot unbind — clears row identity but leaves DOM elements and cell slots mounted.
	 * Used when a slot is temporarily hidden (e.g. row count drops below pool size
	 * mid-frame before ensureSlotCount shrinks the pool).
	 */
	public unbindHot(): void {
		this.visualIndex = -1;
		this.visualRowId = '';
		this.rowKind = '';
		this.rowTop = -1;
		this.rowHeight = -1;
		this.keepAlive = false;
		this.lastPortalRowKey = undefined;
		this.element.style.visibility = 'hidden';
		this.hiddenByUnbind = true;
		// Keep dataset/ARIA mirrors warm as well as the DOM subtree. A rebound to the same
		// visual row should not need to rewrite debug mirrors we just tore down.
	}

	/**
	 * Cold destroy — full DOM reset. Called when the pool shrinks.
	 * Releases all cell content and removes the element from the DOM after the call.
	 */
	public destroyCold(): void {
		this.visualIndex = -1;
		this.visualRowId = '';
		this.rowKind = '';
		this.rowTop = -1;
		this.rowHeight = -1;
		this.keepAlive = false;
		this.lastTop = -1;
		this.lastHeight = -1;
		this.lastClassName = '';
		this.lastPortalRowKey = undefined;
		this.centerColStart = 0;
		this.pinLeftCount = 0;
		this.pinRightStart = Number.MAX_SAFE_INTEGER;

		// Unbind all cell slots. cellsByColumnInstanceId is authoritative, but lane arrays are
		// unioned defensively in case external callers have pushed to them directly.
		const allCells = new Set<CellSlot<TRowData>>();
		for (const cell of this.cellsByColumnInstanceId.values()) allCells.add(cell);
		for (const cell of this.leftCells) allCells.add(cell);
		for (const cell of this.centerCells) allCells.add(cell);
		for (const cell of this.rightCells) allCells.add(cell);
		for (const cell of allCells) cell.unbindCold();
		this.cellsByColumnInstanceId.clear();
		this.leftCells.length = 0;
		this.centerCells.length = 0;
		this.rightCells.length = 0;

		this.element.className = '';
		this.element.removeAttribute('style');
		this.hiddenByUnbind = false;

		delete this.element.dataset.rowIndex;
		delete this.element.dataset.rowId;
		delete this.element.dataset.rowKey;
		this.element.textContent = '';
		this.pinLeftContainer = null;
		this.pinRightContainer = null;
		this.pinLeftContainerWidth = -1;
		this.pinRightContainerWidth = -1;
	}
}
