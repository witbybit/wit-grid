import type { GridCellPointer } from '../api/GridApi.js';
import { getCellPointerColumnKey } from '../interaction/cellPointer.js';

export type GridInvalidationReason =
	| 'aggregation'
	| 'cell'
	| 'column order'
	| 'column reorder toggle'
	| 'column resize'
	| 'columns'
	| 'data'
	| 'detail'
	| 'edit started'
	| 'edit stopped'
	| 'filter'
	| 'focus'
	| 'geometry'
	| 'groupBy'
	| 'grouping'
	| 'group expansion'
	| 'headers'
	| 'overlay'
	| 'pin'
	| 'resize'
	| 'row model registered'
	| 'row resize'
	| 'selection'
	| 'set data'
	| 'sort'
	| 'state'
	| 'style slots'
	| 'treeData'
	| 'viewport'
	| 'insight-decorations'
	| (string & {});

export interface GridInvalidationBase {
	reason?: GridInvalidationReason;
}

export type GridInvalidation =
	| (GridInvalidationBase & { kind: 'full' })
	| (GridInvalidationBase & { kind: 'cell'; rowId: string; colId: string })
	| (GridInvalidationBase & { kind: 'row'; rowId: string })
	| (GridInvalidationBase & { kind: 'row-range'; startIndex: number; endIndex: number })
	| (GridInvalidationBase & { kind: 'column'; colId: string })
	| (GridInvalidationBase & { kind: 'group'; groupId: string })
	| (GridInvalidationBase & { kind: 'headers' })
	| (GridInvalidationBase & { kind: 'overlay' })
	| (GridInvalidationBase & { kind: 'geometry' })
	| (GridInvalidationBase & { kind: 'viewport' });

export interface InvalidatedRowRange {
	startIndex: number;
	endIndex: number;
	reason?: GridInvalidationReason;
}

export interface NormalizedInvalidationPlan {
	readonly full: boolean;
	readonly fullReason?: GridInvalidationReason;
	readonly viewport: boolean;
	readonly viewportReason?: GridInvalidationReason;
	readonly geometry: boolean;
	readonly geometryReason?: GridInvalidationReason;
	readonly headers: boolean;
	readonly headersReason?: GridInvalidationReason;
	readonly overlay: boolean;
	readonly overlayReason?: GridInvalidationReason;
	readonly cellsByRowId: ReadonlyMap<string, ReadonlySet<string>>;
	readonly rows: ReadonlySet<string>;
	readonly rowReasons: ReadonlyMap<string, GridInvalidationReason>;
	readonly columns: ReadonlySet<string>;
	readonly columnReasons: ReadonlyMap<string, GridInvalidationReason>;
	readonly groups: ReadonlySet<string>;
	readonly groupReasons: ReadonlyMap<string, GridInvalidationReason>;
	readonly rowRanges: readonly InvalidatedRowRange[];
	readonly reasons: readonly GridInvalidationReason[];
}

export function normalizeInvalidationPlan(plan: readonly GridInvalidation[]): NormalizedInvalidationPlan {
	if (plan.length === 0) {
		return {
			full: false,
			viewport: false,
			geometry: false,
			headers: false,
			overlay: false,
			cellsByRowId: new Map(),
			rows: new Set(),
			rowReasons: new Map(),
			columns: new Set(),
			columnReasons: new Map(),
			groups: new Set(),
			groupReasons: new Map(),
			rowRanges: [],
			reasons: [],
		} as NormalizedInvalidationPlan;
	}

	// Pre-scan to determine supersession flags before populating row-level entries.
	// full supersedes everything; viewport supersedes row/cell/range but not column/group.
	const hasFull = plan.some((e) => e.kind === 'full');
	const hasViewport = !hasFull && plan.some((e) => e.kind === 'viewport');
	const skipRowLevel = hasFull || hasViewport;
	const skipColumnLevel = hasFull;

	let fullReason: GridInvalidationReason | undefined;
	let viewportReason: GridInvalidationReason | undefined;
	let geometry = false;
	let geometryReason: GridInvalidationReason | undefined;
	let headers = false;
	let headersReason: GridInvalidationReason | undefined;
	let overlay = false;
	let overlayReason: GridInvalidationReason | undefined;

	const cellsByRowId = new Map<string, Set<string>>();
	const rows = new Set<string>();
	const rowReasons = new Map<string, GridInvalidationReason>();
	const columns = new Set<string>();
	const columnReasons = new Map<string, GridInvalidationReason>();
	const groups = new Set<string>();
	const groupReasons = new Map<string, GridInvalidationReason>();
	const rowRanges: InvalidatedRowRange[] = [];
	const rowRangeKeys = new Set<string>();
	const reasons: GridInvalidationReason[] = [];

	const addReason = (reason?: GridInvalidationReason) => {
		if (reason && !reasons.includes(reason)) reasons.push(reason);
	};

	for (const entry of plan) {
		addReason(entry.reason);

		if (entry.kind === 'full') {
			fullReason = fullReason ?? entry.reason;
			continue;
		}
		if (entry.kind === 'viewport') {
			viewportReason = viewportReason ?? entry.reason;
			continue;
		}
		if (entry.kind === 'geometry') {
			geometry = true;
			geometryReason = geometryReason ?? entry.reason;
			continue;
		}
		if (entry.kind === 'headers') {
			headers = true;
			headersReason = headersReason ?? entry.reason;
			continue;
		}
		if (entry.kind === 'overlay') {
			overlay = true;
			overlayReason = overlayReason ?? entry.reason;
			continue;
		}

		if (entry.kind === 'cell') {
			if (!skipRowLevel) {
				let cols = cellsByRowId.get(entry.rowId);
				if (!cols) {
					cols = new Set();
					cellsByRowId.set(entry.rowId, cols);
				}
				cols.add(entry.colId);
			}
		} else if (entry.kind === 'row') {
			if (!skipRowLevel) {
				rows.add(entry.rowId);
				if (entry.reason && !rowReasons.has(entry.rowId)) rowReasons.set(entry.rowId, entry.reason);
			}
		} else if (entry.kind === 'row-range') {
			if (!skipRowLevel) {
				const start = Math.max(0, Math.min(entry.startIndex, entry.endIndex));
				const end = Math.max(0, Math.max(entry.startIndex, entry.endIndex));
				const key = `${start}\0${end}`;
				if (!rowRangeKeys.has(key)) {
					rowRangeKeys.add(key);
					rowRanges.push({ startIndex: start, endIndex: end, reason: entry.reason });
				}
			}
		} else if (entry.kind === 'column') {
			if (!skipColumnLevel) {
				columns.add(entry.colId);
				if (entry.reason && !columnReasons.has(entry.colId)) columnReasons.set(entry.colId, entry.reason);
			}
		} else if (entry.kind === 'group') {
			if (!skipColumnLevel) {
				groups.add(entry.groupId);
				if (entry.reason && !groupReasons.has(entry.groupId)) groupReasons.set(entry.groupId, entry.reason);
			}
		}
	}

	return {
		full: hasFull,
		fullReason,
		viewport: hasViewport,
		viewportReason,
		geometry,
		geometryReason,
		headers,
		headersReason,
		overlay,
		overlayReason,
		cellsByRowId,
		rows,
		rowReasons,
		columns,
		columnReasons,
		groups,
		groupReasons,
		rowRanges,
		reasons,
	};
}

export interface InvalidationFrame {
	full: boolean;
	cellsByRowId: Map<string, Set<string>>;
	rows: Set<string>;
	rowRanges: InvalidatedRowRange[];
	columns: Set<string>;
	groups: Set<string>;
	headers: boolean;
	overlay: boolean;
	geometry: boolean;
	viewport: boolean;
	reasons: GridInvalidationReason[];
	invalidations: GridInvalidation[];
}

export class InvalidationManager {
	private full = false;
	private cellsByRowId = new Map<string, Set<string>>();
	private rows = new Set<string>();
	private rowRanges: InvalidatedRowRange[] = [];
	private columns = new Set<string>();
	private groups = new Set<string>();
	private headers = false;
	private overlay = false;
	private geometry = false;
	private viewport = false;
	private reasons: GridInvalidationReason[] = [];
	private invalidationKeys = new Set<string>();
	private invalidations: GridInvalidation[] = [];

	public invalidate(invalidation: GridInvalidation): void {
		this.addReason(invalidation.reason);
		this.addInvalidation(this.getInvalidationKey(invalidation), invalidation);

		switch (invalidation.kind) {
			case 'full':
				this.full = true;
				break;
			case 'cell':
				if (!this.full) this.addCell(invalidation.rowId, invalidation.colId);
				break;
			case 'row':
				if (!this.full) this.rows.add(invalidation.rowId);
				break;
			case 'row-range':
				if (!this.full) this.addRowRange(invalidation.startIndex, invalidation.endIndex, invalidation.reason);
				break;
			case 'column':
				if (!this.full) this.columns.add(invalidation.colId);
				break;
			case 'group':
				if (!this.full) this.groups.add(invalidation.groupId);
				break;
			case 'headers':
				if (!this.full) this.headers = true;
				break;
			case 'overlay':
				if (!this.full) this.overlay = true;
				break;
			case 'geometry':
				if (!this.full) this.geometry = true;
				break;
			case 'viewport':
				if (!this.full) this.viewport = true;
				break;
		}
	}

	public applyNormalizedPlan(plan: NormalizedInvalidationPlan): void {
		const hasWork =
			plan.full ||
			plan.viewport ||
			plan.geometry ||
			plan.headers ||
			plan.overlay ||
			plan.cellsByRowId.size > 0 ||
			plan.rows.size > 0 ||
			plan.columns.size > 0 ||
			plan.groups.size > 0 ||
			plan.rowRanges.length > 0;
		if (!hasWork) return;

		for (const reason of plan.reasons) {
			this.addReason(reason);
		}

		if (plan.full) {
			this.full = true;
			this.addInvalidation('full', { kind: 'full', reason: plan.fullReason });
		} else if (plan.viewport) {
			this.viewport = true;
			this.addInvalidation('viewport', { kind: 'viewport', reason: plan.viewportReason });
		}

		if (plan.geometry) {
			this.geometry = true;
			this.addInvalidation('geometry', { kind: 'geometry', reason: plan.geometryReason });
		}
		if (plan.headers) {
			this.headers = true;
			this.addInvalidation('headers', { kind: 'headers', reason: plan.headersReason });
		}
		if (plan.overlay) {
			this.overlay = true;
			this.addInvalidation('overlay', { kind: 'overlay', reason: plan.overlayReason });
		}

		if (!plan.full) {
			if (!plan.viewport) {
				for (const [rowId, colIds] of plan.cellsByRowId) {
					for (const colId of colIds) {
						this.addCell(rowId, colId);
						this.addInvalidation(`cell\0${rowId}\0${colId}`, { kind: 'cell', rowId, colId });
					}
				}
				for (const rowId of plan.rows) {
					this.rows.add(rowId);
					this.addInvalidation(`row\0${rowId}`, { kind: 'row', rowId, reason: plan.rowReasons.get(rowId) });
				}
				for (const range of plan.rowRanges) {
					this.addRowRange(range.startIndex, range.endIndex, range.reason);
					this.addInvalidation(`row-range\0${range.startIndex}\0${range.endIndex}`, { kind: 'row-range', ...range });
				}
			}
			for (const colId of plan.columns) {
				this.columns.add(colId);
				this.addInvalidation(`column\0${colId}`, { kind: 'column', colId, reason: plan.columnReasons.get(colId) });
			}
			for (const groupId of plan.groups) {
				this.groups.add(groupId);
				this.addInvalidation(`group\0${groupId}`, { kind: 'group', groupId, reason: plan.groupReasons.get(groupId) });
			}
		}
	}

	public invalidateFull(reason?: GridInvalidationReason): void {
		this.full = true;
		this.addReason(reason);
		this.addInvalidation('full', { kind: 'full', reason });
	}

	public invalidateCell(rowId: string, colId: string, reason?: GridInvalidationReason): void {
		if (!this.full) this.addCell(rowId, colId);
		this.addReason(reason);
		if (reason !== 'cell') {
			this.addInvalidation(`cell\0${rowId}\0${colId}`, { kind: 'cell', rowId, colId, reason });
		}
	}

	public invalidateCells(cells: GridCellPointer[], reason?: GridInvalidationReason): void {
		for (const cell of cells) {
			this.invalidateCell(cell.rowId, getCellPointerColumnKey(cell), reason);
		}
	}

	public invalidateRow(rowId: string, reason?: GridInvalidationReason): void {
		if (!this.full) this.rows.add(rowId);
		this.addReason(reason);
		if (reason !== 'cell') {
			this.addInvalidation(`row\0${rowId}`, { kind: 'row', rowId, reason });
		}
	}

	public invalidateRows(rowIds: string[], reason?: GridInvalidationReason): void {
		for (const rowId of rowIds) {
			this.invalidateRow(rowId, reason);
		}
	}

	public invalidateRowRange(startIndex: number, endIndex: number, reason?: GridInvalidationReason): void {
		const range = this.normalizeRowRange(startIndex, endIndex);
		if (!this.full) this.addRowRange(range.startIndex, range.endIndex, reason);
		this.addReason(reason);
		this.addInvalidation(`row-range\0${range.startIndex}\0${range.endIndex}`, { kind: 'row-range', ...range, reason });
	}

	public invalidateColumn(colId: string, reason?: GridInvalidationReason): void {
		if (!this.full) this.columns.add(colId);
		this.addReason(reason);
		this.addInvalidation(`column\0${colId}`, { kind: 'column', colId, reason });
	}

	public invalidateColumns(colIds: string[], reason?: GridInvalidationReason): void {
		for (const colId of colIds) {
			this.invalidateColumn(colId, reason);
		}
	}

	public invalidateGroup(groupId: string, reason?: GridInvalidationReason): void {
		if (!this.full) this.groups.add(groupId);
		this.addReason(reason);
		this.addInvalidation(`group\0${groupId}`, { kind: 'group', groupId, reason });
	}

	public invalidateHeaders(reason?: GridInvalidationReason): void {
		if (!this.full) this.headers = true;
		this.addReason(reason);
		this.addInvalidation('headers', { kind: 'headers', reason });
	}

	public invalidateOverlay(reason?: GridInvalidationReason): void {
		if (!this.full) this.overlay = true;
		this.addReason(reason);
		this.addInvalidation('overlay', { kind: 'overlay', reason });
	}

	public invalidateGeometry(reason?: GridInvalidationReason): void {
		if (!this.full) this.geometry = true;
		this.addReason(reason);
		this.addInvalidation('geometry', { kind: 'geometry', reason });
	}

	public invalidateViewport(reason?: GridInvalidationReason): void {
		if (!this.full) this.viewport = true;
		this.addReason(reason);
		this.addInvalidation('viewport', { kind: 'viewport', reason });
	}

	public consume(): InvalidationFrame {
		const frame: InvalidationFrame = {
			full: this.full,
			cellsByRowId: this.full ? new Map() : this.cloneCellsByRowId(),
			rows: this.full ? new Set() : new Set(this.rows),
			rowRanges: this.full ? [] : this.rowRanges.map((range) => ({ ...range })),
			columns: this.full ? new Set() : new Set(this.columns),
			groups: this.full ? new Set() : new Set(this.groups),
			headers: this.full ? false : this.headers,
			overlay: this.full ? false : this.overlay,
			geometry: this.full ? false : this.geometry,
			viewport: this.full ? false : this.viewport,
			reasons: this.reasons.slice(),
			invalidations: this.invalidations.slice(),
		};
		this.reset();
		return frame;
	}

	private addCell(rowId: string, colId: string): void {
		let cols = this.cellsByRowId.get(rowId);
		if (!cols) {
			cols = new Set<string>();
			this.cellsByRowId.set(rowId, cols);
		}
		cols.add(colId);
	}

	private addRowRange(startIndex: number, endIndex: number, reason?: GridInvalidationReason): void {
		const { startIndex: start, endIndex: end } = this.normalizeRowRange(startIndex, endIndex);
		const existing = this.rowRanges.find((range) => range.startIndex === start && range.endIndex === end);
		if (!existing) {
			this.rowRanges.push({ startIndex: start, endIndex: end, reason });
		}
	}

	private addInvalidation(key: string, invalidation: GridInvalidation): void {
		if (!this.invalidationKeys.has(key)) {
			this.invalidationKeys.add(key);
			this.invalidations.push(
				invalidation.kind === 'row-range'
					? { ...invalidation, ...this.normalizeRowRange(invalidation.startIndex, invalidation.endIndex) }
					: invalidation
			);
		}
	}

	private getInvalidationKey(invalidation: GridInvalidation): string {
		switch (invalidation.kind) {
			case 'cell':
				return `cell\0${invalidation.rowId}\0${invalidation.colId}`;
			case 'row':
				return `row\0${invalidation.rowId}`;
			case 'row-range': {
				const range = this.normalizeRowRange(invalidation.startIndex, invalidation.endIndex);
				return `row-range\0${range.startIndex}\0${range.endIndex}`;
			}
			case 'column':
				return `column\0${invalidation.colId}`;
			case 'group':
				return `group\0${invalidation.groupId}`;
			default:
				return invalidation.kind;
		}
	}

	private normalizeRowRange(startIndex: number, endIndex: number): { startIndex: number; endIndex: number } {
		return {
			startIndex: Math.max(0, Math.min(startIndex, endIndex)),
			endIndex: Math.max(0, Math.max(startIndex, endIndex)),
		};
	}

	private cloneCellsByRowId(): Map<string, Set<string>> {
		const next = new Map<string, Set<string>>();
		for (const [rowId, colIds] of this.cellsByRowId) {
			next.set(rowId, new Set(colIds));
		}
		return next;
	}

	private addReason(reason?: GridInvalidationReason): void {
		if (reason && !this.reasons.includes(reason)) {
			this.reasons.push(reason);
		}
	}

	private reset(): void {
		this.full = false;
		this.cellsByRowId.clear();
		this.rows.clear();
		this.rowRanges = [];
		this.columns.clear();
		this.groups.clear();
		this.headers = false;
		this.overlay = false;
		this.geometry = false;
		this.viewport = false;
		this.reasons = [];
		this.invalidationKeys.clear();
		this.invalidations = [];
	}
}
