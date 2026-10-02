import type { CellContentMode } from './cellSlot.js';
import type { GridCellDecoration } from '../insights/insightTypes.js';
import type { ColumnInstanceId } from '../columnDef.js';
import type { VisualFreshness } from './visualFreshness.js';

export type CellDisplayContentKind = CellContentMode | 'portal-live' | 'portal-frozen' | 'impostor';

/**
 * Snapshot authority is a bounded working set, not a per-dataset mirror. This comfortably covers
 * the rendered window plus several directional prewarm rings while making long-session growth
 * independent of how many distinct cells a user visits.
 */
export const DEFAULT_CELL_DISPLAY_SNAPSHOT_CAPACITY = 1024;

/** Upper bound for render-window-driven growth (see CellDisplaySnapshotStore.ensureCapacity). */
export const MAX_CELL_DISPLAY_SNAPSHOT_CAPACITY = 16384;

/**
 * Extends VisualFreshness (rowVersion/globalVersion/insightVersion/styleVersion/loadingVersion/
 * selectionVersion) so a snapshot's freshness can be judged by the same canonical predicate
 * (isVisualFresh) that mounted CellSlot state is judged by — see visualFreshness.ts.
 */
export interface CellDisplaySnapshot extends VisualFreshness {
	rowId: string;
	columnInstanceId: ColumnInstanceId;
	colField: string;
	baseClassName: string;
	stateClassName: string;
	decorationClassName: string;
	classTokens: readonly string[];
	className: string;
	contentKind: CellDisplayContentKind;
	contentMode: CellContentMode;
	formattedValue: string;
	title: string;
	validationError?: string;
}

export interface CellDecorationSnapshotMetadata {
	classNameSuffix: string;
	insightTitle: string;
	validationError?: string;
}

export function collectCellDecorationSnapshotMetadata(decorations: readonly GridCellDecoration[]): CellDecorationSnapshotMetadata {
	let classNameSuffix = '';
	let insightTitle = '';
	let validationError: string | undefined;
	for (const decoration of decorations) {
		if (decoration.className) classNameSuffix += ` ${decoration.className}`;
		if (decoration.kind === 'validationError') {
			// Shown by the grid's validation tooltip (data-validation-error); a native title as well
			// would pop a second, unstyled tooltip over it.
			if (decoration.title) validationError = decoration.title;
			continue;
		}
		if (decoration.title) insightTitle = insightTitle ? `${insightTitle}\n${decoration.title}` : decoration.title;
	}
	return { classNameSuffix, insightTitle, validationError };
}

export function mergeCellSnapshotTitle(tooltipText: string | null, insightTitle: string): string {
	if (tooltipText && insightTitle) return `${tooltipText}\n${insightTitle}`;
	return tooltipText || insightTitle || '';
}

/** True when `className` is already in normalized form: single ASCII spaces between tokens, no leading or
 *  trailing whitespace, no tabs/newlines. The renderer's own class strings always are. */
function isNormalizedClassName(className: string): boolean {
	const length = className.length;
	if (length === 0) return true;
	if (className.charCodeAt(0) === 32 || className.charCodeAt(length - 1) === 32) return false;
	let previousWasSpace = false;
	for (let i = 0; i < length; i++) {
		const code = className.charCodeAt(i);
		if (code === 32) {
			if (previousWasSpace) return false;
			previousWasSpace = true;
		} else {
			// Any other whitespace (or non-ASCII, which may be Unicode whitespace) takes the slow path.
			if (code < 33 || code > 126) return false;
			previousWasSpace = false;
		}
	}
	return true;
}

function normalizeClassNameSegment(className: string): string {
	if (isNormalizedClassName(className)) return className;
	return className.trim().split(/\s+/).filter(Boolean).join(' ');
}

function tokenizeClassName(className: string): string[] {
	const normalized = normalizeClassNameSegment(className);
	if (!normalized) return [];
	return normalized.split(' ');
}

export function joinCellSnapshotClassNameParts(...parts: Array<string | undefined>): {
	className: string;
	classTokens: readonly string[];
} {
	const classTokens: string[] = [];
	for (const part of parts) {
		if (!part) continue;
		for (const token of tokenizeClassName(part)) {
			if (!classTokens.includes(token)) classTokens.push(token);
		}
	}
	return { className: classTokens.join(' '), classTokens };
}

export interface CreateCellDisplaySnapshotOptions extends VisualFreshness {
	rowId: string;
	columnInstanceId?: ColumnInstanceId;
	colField: string;
	baseClassName: string;
	stateClassName?: string;
	decorationClassName?: string;
	contentKind: CellDisplayContentKind;
	contentMode: CellContentMode;
	formattedValue: string;
	title: string;
	validationError?: string;
}

export function createCellDisplaySnapshot(options: CreateCellDisplaySnapshotOptions): CellDisplaySnapshot {
	const baseClassName = normalizeClassNameSegment(options.baseClassName);
	const stateClassName = normalizeClassNameSegment(options.stateClassName ?? '');
	const decorationClassName = normalizeClassNameSegment(options.decorationClassName ?? '');
	const { className, classTokens } = joinCellSnapshotClassNameParts(baseClassName, stateClassName, decorationClassName);
	return {
		rowId: options.rowId,
		columnInstanceId: options.columnInstanceId ?? (options.colField as ColumnInstanceId),
		colField: options.colField,
		rowVersion: options.rowVersion,
		globalVersion: options.globalVersion,
		insightVersion: options.insightVersion,
		styleVersion: options.styleVersion,
		loadingVersion: options.loadingVersion,
		selectionVersion: options.selectionVersion,
		baseClassName,
		stateClassName,
		decorationClassName,
		classTokens,
		className,
		contentKind: options.contentKind,
		contentMode: options.contentMode,
		formattedValue: options.formattedValue,
		title: options.title,
		validationError: options.validationError,
	};
}

function buildCellSnapshotKey(rowId: string, columnInstanceId: ColumnInstanceId | string): string {
	return `${rowId}\0${columnInstanceId}`;
}

export class CellDisplaySnapshotStore {
	/** Insertion order is the eviction order (string keys, written only on set/delete). */
	private readonly snapshots = new Map<string, CellDisplaySnapshot>();
	/** Read index: every scrolled cell looks a snapshot up, so reads build no key string. */
	private readonly byRow = new Map<string, Map<string, CellDisplaySnapshot>>();
	private evictedSnapshotCount = 0;

	constructor(private maxEntries = DEFAULT_CELL_DISPLAY_SNAPSHOT_CAPACITY) {}

	/**
	 * Grows (never shrinks) the working-set bound so it covers at least `minEntries` — the renderer
	 * calls this with ~3x its rendered cell count, since a fixed 1024 is smaller than a large
	 * viewport plus overscan. Capped at MAX_CELL_DISPLAY_SNAPSHOT_CAPACITY.
	 */
	public ensureCapacity(minEntries: number): void {
		if (minEntries <= this.maxEntries) return;
		this.maxEntries = Math.max(this.maxEntries, Math.min(MAX_CELL_DISPLAY_SNAPSHOT_CAPACITY, Math.ceil(minEntries)));
	}

	public get(rowId: string, columnInstanceId: ColumnInstanceId | string): CellDisplaySnapshot | undefined {
		return this.byRow.get(rowId)?.get(columnInstanceId);
	}

	public set(snapshot: CellDisplaySnapshot): void {
		const key = buildCellSnapshotKey(snapshot.rowId, snapshot.columnInstanceId);
		// Targeted invalidation/full-bind updates refresh recency. Reads deliberately do not: active
		// scroll must consume snapshots without mutating cache ownership.
		this.snapshots.delete(key);
		this.snapshots.set(key, snapshot);
		let row = this.byRow.get(snapshot.rowId);
		if (!row) {
			row = new Map();
			this.byRow.set(snapshot.rowId, row);
		}
		row.set(snapshot.columnInstanceId, snapshot);
		while (this.snapshots.size > this.maxEntries) {
			const oldest = this.snapshots.entries().next().value as [string, CellDisplaySnapshot] | undefined;
			if (oldest === undefined) break;
			this.snapshots.delete(oldest[0]);
			this.unindex(oldest[1].rowId, oldest[1].columnInstanceId);
			this.evictedSnapshotCount++;
		}
	}

	public delete(rowId: string, columnInstanceId: ColumnInstanceId | string): void {
		this.snapshots.delete(buildCellSnapshotKey(rowId, columnInstanceId));
		this.unindex(rowId, columnInstanceId);
	}

	public clear(): void {
		this.snapshots.clear();
		this.byRow.clear();
	}

	private unindex(rowId: string, columnInstanceId: string): void {
		const row = this.byRow.get(rowId);
		if (!row) return;
		row.delete(columnInstanceId);
		if (row.size === 0) this.byRow.delete(rowId);
	}

	/** Read-only ownership gauge for deterministic long-session diagnostics. */
	public getOwnershipSnapshot(): Readonly<{ entryCount: number; maxEntries: number; evictedSnapshotCount: number }> {
		return Object.freeze({ entryCount: this.snapshots.size, maxEntries: this.maxEntries, evictedSnapshotCount: this.evictedSnapshotCount });
	}
}
