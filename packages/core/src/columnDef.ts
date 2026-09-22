/**
 * Column definition types, cell renderer interfaces, and path utilities.
 */
import type { CellEditorProps, CellRendererProps, HeaderMenuRendererProps, GridSelectionState } from './api/GridApi.js';
import type { GroupVisualRow, DetailVisualRow } from './visualRow.js';
import type { GridCapabilityCallback } from './capabilities/capabilityTypes.js';
import type { GridRowDataRef } from './publicRowRef.js';

// ─── Value getter / setter / validator params ─────────────────────────────────

export interface ValueGetterParams<TRowData = unknown> {
	node: GridRowDataRef<TRowData>;
	row: TRowData;
	colField: string;
}

/**
 * Public row reference for DOM cell renderers.
 *
 * This intentionally exposes only stable identity and row data, not the internal mutable RowNode
 * implementation or its helper methods/caches.
 */
export interface DomCellRendererRowRef<TRowData = unknown> {
	id: string;
	data: TRowData;
}

export interface TooltipParams<TRowData = unknown> {
	row: TRowData;
	rowId: string;
	colField: string;
	value: unknown;
}

export interface ValueSetterParams<TRowData = unknown> {
	value: unknown;
	oldValue: unknown;
	row: TRowData;
	colField: string;
	/** Call to signal that the server rejected the value and the grid should roll back. */
	abort: () => void;
}

// ─── Cell renderer phase + capabilities ──────────────────────────────────────

/**
 * 'scroll-force-live' and 'scroll-live' are both distinct from 'scroll': they mark mounts that
 * genuinely happen during an active scroll frame — unlike ordinary 'scroll'-phase mounts, which
 * never occur mid-motion. The renderer callback is told `isScrolling: true` honestly for both.
 *
 * - 'scroll-force-live' — the narrow force-live-interactive-exception mount: an actively editing/
 *   focused cell on a `'freeze'`-mode column that must mount live despite not opting into
 *   `scrollPresentation: 'live'` (see scrollCellPresentation.ts's ScrollCellPresentation union).
 * - 'scroll-live' — an ordinary `scrollPresentation: 'live'` column's mount/update on this scroll
 *   frame. Expected to fire on every scroll frame for these columns, unlike the rare force-live
 *   exception above.
 */
export type CellRendererPhase = 'initial' | 'scroll' | 'scroll-force-live' | 'scroll-live' | 'scroll-idle' | 'interaction' | 'edit' | 'destroy';

/**
 * What a renderer's cell shows while the grid is actively scrolling. This is the ONE field that
 * chooses the scroll presentation mode — mode-specific config lives in the matching sub-object
 * below and is only valid alongside its own mode (enforced at column normalization time).
 *
 * - `'primitive'`    — Fast text/class presentation. Default for non-renderer cells.
 * - `'live'`         — The real renderer is mounted/updated during active scroll. Highest
 *                       fidelity, highest cost. No text fallback, no HTML snapshot fallback, no
 *                       stale previous portal, no blank cell.
 * - `'freeze'`       — An existing live renderer may remain visually frozen during scroll. New/
 *                       cold cells show a shell/loading placeholder until fidelity catches up.
 *                       Default for columns with a renderer but no explicit scrollPresentation.
 * - `'text-impostor'`— Shows an explicit cheap text/chip stand-in (`textImpostor.render`) during
 *                       scroll.
 * - `'html-snapshot'`— Replays a captured inert HTML clone during scroll. Missing HTML shows a
 *                       shell/pending placeholder, not raw text, unless explicitly allowed.
 */
export type CellScrollPresentation = 'primitive' | 'live' | 'freeze' | 'text-impostor' | 'html-snapshot';

export interface CellRendererCapabilities {
	/** Chooses what this column's cells show while the grid is actively scrolling. */
	scrollPresentation?: CellScrollPresentation;

	/** Only valid for `scrollPresentation: 'live'`. */
	live?: {
		/**
		 * `'react'` (default) updates through React's scheduler. `'imperative'` calls
		 * `ref.current.update()` directly, bypassing React's scheduler entirely — the cell
		 * renderer must be a forwardRef component exposing `ImperativeCellHandle`. Ideal for
		 * real-time feeds (tick data, live prices) where even setState latency is too high.
		 */
		update?: 'react' | 'imperative';
		priority?: 'high' | 'normal' | 'low';
		allowEmergencyShell?: boolean;
	};

	/** Only valid for `scrollPresentation: 'text-impostor'`. */
	textImpostor?: {
		/** Returns a cheap plain-text/chip representation of the cell value to show during scroll. */
		render: (params: { value: unknown; formattedValue: string }) => string;
	};

	/** Only valid for `scrollPresentation: 'html-snapshot'`. */
	htmlSnapshot?: {
		strict?: boolean;
		freshness?: 'row-version-only' | 'visual';
		allowShellWhenMissing?: boolean;
		allowTextFallbackWhenMissing?: boolean;
		invalidateOnWidthChange?: boolean;
		invalidateOnHeightChange?: boolean;
	};
}

/**
 * @internal Normalized form of CellRendererCapabilities produced by ColumnModel.normalizeColumn —
 * scrollPresentation is always resolved to a concrete mode (never undefined).
 */
export interface NormalizedCellRendererCapabilities extends CellRendererCapabilities {
	scrollPresentation: CellScrollPresentation;
}

/**
 * Grid-level renderer policy — global virtualization behavior, budgets, and caches for the scroll
 * presentation modes. Deliberately NOT part of ColumnDef: windowing/budget/cache policy is a grid-
 * wide concern, not a per-column one.
 */
export interface GridRendererOptions {
	liveReact?: {
		rowOverscan?: number;
		columnOverscan?: number;
		maxMountsPerFrame?: number;
		maxUpdatesPerFrame?: number;
		allowEmergencyShell?: boolean;
	};
	htmlSnapshot?: {
		maxSnapshots?: number;
		maxTotalBytes?: number;
		maxSingleSnapshotBytes?: number;
		defaultStrict?: boolean;
		allowShellWhenMissing?: boolean;
		allowTextFallbackWhenMissing?: boolean;
	};
	textImpostor?: {
		allowRawValueFallback?: boolean;
	};
}

// ─── Imperative handle ────────────────────────────────────────────────────────

/** Exposed via forwardRef on renderers with capabilities.live.update === 'imperative' */
export interface ImperativeCellHandle<TRowData = unknown> {
	update(params: CellRendererProps<TRowData>): void;
}

// ─── DOM cell renderer ────────────────────────────────────────────────────────

/** Parameters passed to DomCellRenderer.mount() and DomCellRendererHandle.update() */
export interface DomCellRendererParams<TRowData = unknown> {
	container: HTMLElement;
	value: unknown;
	node: DomCellRendererRowRef<TRowData>;
	col: ColumnDef<TRowData>;
	isEditing: boolean;
	isScrolling: boolean;
	phase: CellRendererPhase;
	isFocused: boolean;
	isSelected: boolean;
}

/** Handle returned by DomCellRenderer.mount() — grid calls update() directly in the paint loop */
export interface DomCellRendererHandle {
	update(params: DomCellRendererParams<any>): void;
	destroy?(): void;
}

/**
 * Zero-React-overhead cell renderer. Grid calls mount() once and update() on every data change.
 * No virtual DOM, no scheduler, no reconciler — pure DOM manipulation.
 *
 * @example
 * const priceRenderer: DomCellRenderer<MyRow> = {
 *   mount(container, params) {
 *     const span = document.createElement('span');
 *     span.textContent = String(params.value);
 *     container.appendChild(span);
 *     return { update(p) { span.textContent = String(p.value); } };
 *   }
 * };
 */
export interface DomCellRenderer<TRowData = unknown> {
	mount(container: HTMLElement, params: DomCellRendererParams<TRowData>): DomCellRendererHandle;
	capabilities?: CellRendererCapabilities;
}

/** Type guard — returns true when renderer is a DomCellRenderer (has a mount function) */
export function isDomCellRenderer<TRowData = unknown>(renderer: unknown): renderer is DomCellRenderer<TRowData> {
	return typeof renderer === 'object' && renderer !== null && typeof (renderer as DomCellRenderer).mount === 'function';
}

// ─── Column instance identity ─────────────────────────────────────────────────

/**
 * Opaque, monotonic identity for a column DEFINITION INSTANCE — distinct from `field` (data access
 * identity) and `colId` (user/API column identity), which both name a logical column slot that may
 * be re-populated by a semantically different definition over time (e.g. a column removed and
 * re-added with a different renderer, same field). `instanceId` never changes for a column that is
 * merely re-normalized with an equivalent shape, and never gets reused after a column is replaced —
 * this is what lets renderer lifecycle (CellSlot/CellCtrl ownership, HTML/portal caches) key off
 * "is this semantically the same column" rather than "does this field string match."
 */
export type ColumnInstanceId = string & { readonly __brand: 'ColumnInstanceId' };

let _columnInstanceCounter = 0;

/** @internal Only ColumnModel.normalizeColumn() should call this. */
export function createColumnInstanceId(): ColumnInstanceId {
	return `coli${++_columnInstanceCounter}` as ColumnInstanceId;
}

// ─── Column renderer spec ─────────────────────────────────────────────────────

export type ColumnRendererSpec<TRowData = unknown> =
	| { kind: 'text' }
	| { kind: 'dom'; renderer: DomCellRenderer<TRowData>; capabilities?: CellRendererCapabilities }
	| { kind: 'react'; component: unknown; capabilities?: CellRendererCapabilities }
	| { kind: 'imperativeReact'; component: unknown; capabilities?: CellRendererCapabilities };

// ─── Column render plan (produced by ColumnModel) ─────────────────────────────

export type ColumnRenderMode =
	| 'primitive' // No renderer; raw/text value only
	| 'primitive-formatted' // No renderer; value goes through a getter or formatter
	| 'custom-live' // React portal mounted/updated every scroll frame (scrollPresentation:'live')
	| 'custom' // React portal frozen/impostor'd during scroll; refreshed only on data change
	| 'custom-dom' // DomCellRenderer — direct DOM manipulation, no React overhead
	| 'custom-imperative' // React portal with scrollPresentation:'live', live.update:'imperative'
	| 'loading'; // Loading skeleton row

export interface ColumnRenderPlan<TData = unknown> {
	/** Renderer/topology lifecycle identity — see ColumnInstanceId. Previously just an alias for
	 *  `field`; now a real distinct identity assigned by ColumnModel. */
	colId: ColumnInstanceId;
	field: string;
	mode: ColumnRenderMode;
	/** True when the column uses a custom cell renderer (mode starts with 'custom'). Pre-computed to avoid string.startsWith on the hot scroll path. */
	isCustom: boolean;
	hasValueGetter: boolean;
	hasFormatter: boolean;
	hasFormulaSupport: boolean;
	canUseCachedDisplayValue: boolean;
}

export interface CompiledGridPlan<TData = unknown> {
	version: number;
	columns: InternalColumnDef<TData>[];
	displayedColumns: InternalColumnDef<TData>[];
	columnPlans: ColumnRenderPlan<TData>[];
	colFields: string[];
	colWidths: ArrayLike<number>;
	colLefts: ArrayLike<number>;
	totalWidth: number;
	pinLeftCount: number;
	pinRightCount: number;
	pinRightStart: number;
	pinLeftWidth: number;
	pinRightWidth: number;
	pinRightBaseLeft: number;
	hasCustomRenderers: boolean;
	hasDomRenderers: boolean;
	hasFormattedValues: boolean;
	hasValueGetters: boolean;
}

// ─── Column definition ────────────────────────────────────────────────────────

export interface CellCopyParams<TRowData = unknown> {
	rowId: string;
	colField: string;
	value: unknown;
	row: TRowData;
}

export interface CellPasteParams<TRowData = unknown> {
	rowId: string;
	colField: string;
	pastedText: string;
	row: TRowData;
}

export interface ValueFormatterParams<TRowData = unknown> {
	/** The raw cell value (from field, valueGetter, or formula). */
	value: unknown;
	/** The complete row data object. */
	rowData: TRowData;
	/** The column definition. */
	colDef: ColumnDef<TRowData>;
	/** The row ID. */
	rowId: string;
}

export interface ColumnDef<TRowData = unknown> {
	field: string;
	colId?: string;
	header: string;
	width?: number;
	/** Named column type registered via `columnTypes` on the grid options. Resolved in the React layer. */
	type?: string;
	hide?: boolean;
	loading?: boolean;
	valueGetter?: (params: ValueGetterParams<TRowData>) => unknown;
	valueGetterDependencies?: string[];
	/**
	 * Converts the raw cell value (from field, valueGetter, or formula) into a display string.
	 * Used by: default text renderer, CSV export, tooltip (when no custom tooltip is set),
	 * and the `formattedValue` prop passed to custom React cell renderers.
	 *
	 * @example
	 * valueFormatter: ({ value }) => value != null ? `$${Number(value).toFixed(2)}` : ''
	 */
	valueFormatter?: (params: ValueFormatterParams<TRowData>) => string;
	/**
	 * Called during commit to apply the value to the row's data object.
	 * Sync: return false to reject. Async: return Promise<false> to reject after optimistic update.
	 * Call params.abort() to trigger an immediate rollback.
	 * Breaking change from v1: params object replaces the old (row, value) signature.
	 */
	valueSetter?: (params: ValueSetterParams<TRowData>) => boolean | Promise<boolean>;
	renderer?: ColumnRendererSpec<TRowData>;
	cellEditor?: (props: CellEditorProps<TRowData>) => unknown;
	headerMenuRenderer?: (props: HeaderMenuRendererProps<TRowData>) => void;
	headerMenuComponent?: any;
	sortable?: boolean;
	/** When false, this column cannot be added to the row grouping. Defaults to true. */
	enableRowGroup?: boolean;
	/** Set to true to hide/disable the header menu for this column. Defaults to false. */
	suppressHeaderMenu?: boolean;
	/** Minimum column width in pixels. Enforced during resize. */
	minWidth?: number;
	/** Maximum column width in pixels. Enforced during resize. */
	maxWidth?: number;
	/**
	 * Cell tooltip. Shown as a native browser tooltip on hover.
	 * Pass a string for a static tooltip, or a function for dynamic tooltips based on cell value/row data.
	 */
	tooltip?: string | ((params: TooltipParams<TRowData>) => string | null);
	/**
	 * Initial pin side for this column. Pinned-left columns should come first in the
	 * columns array; pinned-right columns should come last.
	 * Only applied at grid initialization — use api.setPinnedColumns() for runtime changes.
	 */
	pinned?: 'left' | 'right';
	/** Override the clipboard text for this cell on copy. Return the string to write. */
	onCopy?: (params: CellCopyParams<TRowData>) => string;
	/** Transform pasted text before setting the cell value. Return the value to write. */
	onPaste?: (params: CellPasteParams<TRowData>) => unknown;
	/** When true, renders a checkbox in this column for row multi-select */
	checkboxSelection?: boolean;
	/**
	 * One or more group header labels for this column.
	 * A string places the column under a single group band.
	 * An array places it under nested groups from outermost to innermost
	 * (e.g. `['Financials', 'Revenue']` → Financials > Revenue > this leaf).
	 */
	headerGroup?: string | string[];
	/**
	 * Rich filter definition for this column. Supersedes `filterType` and `filterValues`.
	 * Supports multi-select, single-select, async-*, infinite-*, and fully custom React UI.
	 * Backwards-compatible — existing filterType/filterValues still work and are normalised
	 * to filterDef internally.
	 */
	filterDef?: import('./filters/filterDef.js').ColumnFilterDef<TRowData>;
	/**
	 * Filter UI type shown for this column in the sidebar and header menu.
	 * Defaults to `'text'`. Use `'none'` to hide the filter UI for this column.
	 * @deprecated Prefer filterDef.type — this field is normalised into filterDef on mount.
	 */
	filterType?: 'text' | 'number' | 'date' | 'set' | 'none';
	/**
	 * For set filter: explicit list of selectable values.
	 * When omitted, distinct values are derived from row data via `api.getColumnDistinctValues()`.
	 * @deprecated Prefer filterDef.options — this field is normalised into filterDef on mount.
	 */
	filterValues?: (string | number | null)[];
	/**
	 * Custom floating filter renderer for this column.
	 * Receives a `FloatingFilterRendererParams` object and must populate `eCell`.
	 * When omitted, the default input (text / number / date / set badge) is used.
	 * @deprecated Prefer filterDef.renderFloatingFilter for React-based renderers.
	 */
	floatingFilterRenderer?: (params: import('./renderer/floatingFilterRenderer.js').FloatingFilterRendererParams<TRowData>) => void;
	/**
	 * Prevent cell range selection from starting when the user clicks on cells in this column.
	 * Useful for action / checkbox / drag-handle columns.
	 */
	disableCellRangeSelection?: boolean;
	/**
	 * Marks this column as required for data-quality purposes.
	 * Does not block editing — use `GridDataIntegrityManager.validation` cell rules to enforce hard constraints.
	 */
	required?: boolean;

	// ── Column-level capability callbacks ────────────────────────────────────────
	/** Return false / { allowed: false } to make this column read-only. */
	canEdit?: GridCapabilityCallback<TRowData>;
	canSelect?: GridCapabilityCallback<TRowData>;
	canCopy?: GridCapabilityCallback<TRowData>;
	canPaste?: GridCapabilityCallback<TRowData>;
	canGroup?: GridCapabilityCallback<TRowData>;
	canFill?: GridCapabilityCallback<TRowData>;
	canSort?: GridCapabilityCallback<TRowData>;
	canFilter?: GridCapabilityCallback<TRowData>;
	canPin?: GridCapabilityCallback<TRowData>;
	canResize?: GridCapabilityCallback<TRowData>;
	canDelete?: GridCapabilityCallback<TRowData>;
	canExpand?: GridCapabilityCallback<TRowData>;
	/**
	 * When defined, this column shows a row-drag handle. The callback is called per row to
	 * conditionally show/hide the handle (return false to hide for a specific row).
	 */
	canDrag?: GridCapabilityCallback<TRowData>;
	/** Return false / { allowed: false } to prevent header drag-reordering for this column. */
	canMoveColumn?: GridCapabilityCallback<TRowData>;
	canExport?: GridCapabilityCallback<TRowData>;
}

/**
 * @internal
 * Internal column definition — extends the public ColumnDef with normalised renderer fields
 * produced by ColumnModel.normalizeColumn(). Never expose these on the public ColumnDef.
 */
export interface InternalColumnDef<TRowData = unknown> extends ColumnDef<TRowData> {
	cellRenderer?: ((props: CellRendererProps<TRowData>) => unknown) | DomCellRenderer<TRowData>;
	cellRendererCapabilities?: NormalizedCellRendererCapabilities;
	/** @internal Assigned by ColumnModel.normalizeColumn/updateColumns; never set by user-authored
	 *  ColumnDef. Stable across re-normalization of an equivalent column, minted fresh when a field
	 *  is semantically replaced (different renderer/valueGetter) — see ColumnInstanceId. */
	instanceId: ColumnInstanceId;
}

export function getColumnInstanceIdentity<TRowData = unknown>(
	column: Pick<ColumnDef<TRowData>, 'field'> & Partial<Pick<InternalColumnDef<TRowData>, 'instanceId'>>
): ColumnInstanceId {
	return (column.instanceId ?? column.field) as ColumnInstanceId;
}

// ─── Style slots ──────────────────────────────────────────────────────────────

export interface GridRowClassParams<TRowData = unknown> {
	row: TRowData;
	rowId: string;
	rowIndex: number;
	isFocused: boolean;
	isSelected: boolean;
	isLoading: boolean;
	selection: GridSelectionState;
}

export interface GridCellClassParams<TRowData = unknown> {
	row: TRowData;
	rowId: string;
	rowIndex: number;
	col: ColumnDef<TRowData>;
	colField: string;
	colIndex: number;
	isFocused: boolean;
	isRowFocused: boolean;
	isRowSelected: boolean;
	isSelected: boolean;
	isEditing: boolean;
	value: unknown;
	rawValue: unknown;
	isLoading: boolean;
	selection: GridSelectionState;
}

export interface RowStyleRule<TRowData = unknown> {
	kind: 'row';
	when: (row: TRowData, params: GridRowClassParams<TRowData>) => boolean;
	rowClass: string;
}

export interface GroupRowStyleRule<TRowData = unknown> {
	kind: 'groupRow';
	when?: (visualRow: GroupVisualRow<TRowData>) => boolean;
	rowClass: string;
}

export interface DetailRowStyleRule<TRowData = unknown> {
	kind: 'detailRow';
	when?: (visualRow: DetailVisualRow<TRowData>) => boolean;
	rowClass: string;
}

export interface CellStyleRule<TRowData = unknown> {
	kind: 'cell';
	field?: string;
	when: (row: TRowData, col: ColumnDef<TRowData>, params: GridCellClassParams<TRowData>) => boolean;
	cellClass: string;
}

export interface HeaderCellStyleRule<TRowData = unknown> {
	kind: 'headerCell';
	field?: string;
	when: (col: ColumnDef<TRowData>) => boolean;
	headerCellClass: string;
}

export type GridStyleRule<TRowData = unknown> =
	| RowStyleRule<TRowData>
	| GroupRowStyleRule<TRowData>
	| DetailRowStyleRule<TRowData>
	| CellStyleRule<TRowData>
	| HeaderCellStyleRule<TRowData>;

// ─── Path utilities ───────────────────────────────────────────────────────────

export function getValueByPath(obj: unknown, path: string): unknown {
	if (!obj || typeof obj !== 'object' || !path) return undefined;
	const record = obj as Record<string, unknown>;
	if (!path.includes('.')) return record[path];
	return path.split('.').reduce((acc: unknown, part) => {
		if (acc && typeof acc === 'object') {
			return (acc as Record<string, unknown>)[part];
		}
		return undefined;
	}, obj);
}

export function setValueByPath(obj: unknown, path: string, value: unknown): boolean {
	if (!obj || typeof obj !== 'object' || !path) return false;
	const record = obj as Record<string, unknown>;
	if (!path.includes('.')) {
		record[path] = value;
		return true;
	}
	const parts = path.split('.');
	let curr = record;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!curr[part] || typeof curr[part] !== 'object') {
			curr[part] = {};
		}
		curr = curr[part] as Record<string, unknown>;
	}
	curr[parts[parts.length - 1]] = value;
	return true;
}

const pathGetterCache = new Map<string, (data: unknown) => unknown>();

export function compilePathGetter(path: string): (data: unknown) => unknown {
	if (!path) return () => undefined;
	if (pathGetterCache.has(path)) return pathGetterCache.get(path)!;

	let getter: (data: unknown) => unknown;
	if (!path.includes('.')) {
		getter = (data: unknown) => (data && typeof data === 'object' ? (data as Record<string, unknown>)[path] : undefined);
	} else {
		const parts = path.split('.');
		getter = (data: unknown) => {
			let curr: unknown = data;
			for (let i = 0; i < parts.length; i++) {
				if (curr === null || curr === undefined || typeof curr !== 'object') return undefined;
				curr = (curr as Record<string, unknown>)[parts[i]];
			}
			return curr;
		};
	}
	pathGetterCache.set(path, getter);
	return getter;
}

/**
 * Validates column definitions before they are applied to the grid.
 * Throws early with a clear message rather than silently producing broken layout.
 */
export function validateColumns<TRowData>(columns: ColumnDef<TRowData>[]): void {
	const seen = new Set<string>();

	for (const column of columns) {
		const id = column.field;

		if (!id) {
			throw new Error('Wit Grid: every column must have a non-empty field.');
		}

		seen.add(id);

		if (column.width != null && (!Number.isFinite(column.width) || column.width <= 0)) {
			throw new Error(`Wit Grid: invalid width for column "${id}". Width must be a positive finite number, got ${column.width}.`);
		}
	}
}
