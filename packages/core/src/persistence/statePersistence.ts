import { freezeGroupingConfig, groupByColIds, type GroupingConfig, type StickyHeadersOptions } from '../rows/hierarchyConfig.js';
import type { TotalPlacement } from '../visualRow.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridViewConfig, GridViewKind } from '../views.js';
import type { GridInitialState, InternalGridState } from '../state/GridState.js';
import type { SortModel, FilterModel } from '../rowModel.js';
import { restoreQueryModel, type GridQueryModel } from '../query/GridQueryModel.js';
import { defaultGridScheduler, type GridScheduler } from '../renderer/gridScheduler.js';
import { restoreFilterModel } from '../filterOperations.js';
import { isBuiltInThemeName, type BuiltInThemeName } from '../renderer/themes.js';

/**
 * Schema version of persisted grid state. Restores reject blobs of another version: bump it when
 * `PersistedGridState` changes shape.
 */
export const GRID_STATE_SCHEMA_VERSION = 3;

export interface SerializedGridState {
	columnWidths?: Record<string, number>;
	columnOrder?: string[];
	/** false = hidden. Omitted fields use column defaults. */
	columnVisibility?: Record<string, boolean>;
	sortModel?: SortModel | null;
	filterModel?: FilterModel | null;
	queryModel?: GridQueryModel | null;
	themeName?: BuiltInThemeName;
	/** The serializable part of the grouping configuration. */
	grouping?: PersistedGrouping;
	pinnedColumns?: { left: number; right: number };
	/**
	 * The view the grid shows (`null` for the table): its JSON-safe configuration. Functions (a
	 * `color` callback) are not persisted; the view falls back to its defaults for them.
	 */
	view?: SerializedViewConfig | null;
}

/** A view configuration as JSON: `kind` plus its plain options. */
export type SerializedViewConfig = { kind: GridViewKind } & Record<string, unknown>;

const VIEW_KINDS: readonly string[] = ['gallery', 'calendar', 'kanban', 'gantt'];

function toSerializedView(view: GridViewConfig<any> | null | undefined): SerializedViewConfig | null {
	if (!view) return null;
	// Functions drop out and dates become ISO strings, exactly as JSON would store them.
	return JSON.parse(JSON.stringify(view)) as SerializedViewConfig;
}

export interface PersistedGrouping {
	by: string[];
	totals?: { groups?: TotalPlacement | false; grand?: TotalPlacement | false };
	stickyHeaders?: boolean | StickyHeadersOptions;
}

export interface PersistedGridState {
	/** Required persisted schema version. */
	v: number;
	/** Serializable grid-state payload. */
	state: SerializedGridState;
}

interface PersistedGridStateParseSuccess {
	ok: true;
	value: PersistedGridState;
}

interface PersistedGridStateParseFailure {
	ok: false;
	error: string;
}

type PersistedGridStateParseResult = PersistedGridStateParseSuccess | PersistedGridStateParseFailure;

interface SerializedGridStateParseSuccess {
	ok: true;
	value: SerializedGridState;
}

type SerializedGridStateParseResult = SerializedGridStateParseSuccess | PersistedGridStateParseFailure;

/**
 * Validate the schema version of a persisted state blob.
 * Returns null if the blob is compatible, or a human-readable error string if not.
 */
export function validateSchemaVersion(state: { v?: unknown } | null | undefined): string | null {
	if (!state || typeof state !== 'object') {
		return '[wit-grid] persisted grid state must be an object.';
	}
	if (state.v === undefined) {
		return '[wit-grid] persisted grid state is missing required schema version `v`.';
	}
	if (!Number.isInteger(state.v)) {
		return `[wit-grid] persisted grid state has invalid schema version \`v=${String(state.v)}\`.`;
	}
	if (state.v === GRID_STATE_SCHEMA_VERSION) return null;
	return (
		`[wit-grid] persisted grid state schema version mismatch ` +
		`(blob v=${state.v}, expected v=${GRID_STATE_SCHEMA_VERSION}). ` +
		`State was not applied.`
	);
}

function isPlacement(value: unknown): boolean {
	return value === undefined || value === false || value === 'top' || value === 'bottom';
}

function isStickyHeadersValue(value: unknown): value is boolean | StickyHeadersOptions {
	if (typeof value === 'boolean') return true;
	if (!isRecord(value)) return false;
	if (value.levels !== undefined && (typeof value.levels !== 'number' || Number.isNaN(value.levels))) return false;
	if (value.shadow !== undefined && typeof value.shadow !== 'boolean') return false;
	return Object.keys(value).every((key) => key === 'levels' || key === 'shadow');
}

function isPersistedGrouping(value: unknown): value is PersistedGrouping {
	if (!isRecord(value)) return false;
	if (!Array.isArray(value.by) || !value.by.every((entry) => typeof entry === 'string')) return false;
	if (value.stickyHeaders !== undefined && !isStickyHeadersValue(value.stickyHeaders)) return false;
	if (value.totals !== undefined && (!isRecord(value.totals) || !isPlacement(value.totals.groups) || !isPlacement(value.totals.grand)))
		return false;
	return Object.keys(value).every((key) => key === 'by' || key === 'totals' || key === 'stickyHeaders');
}

/** The serializable part of a grouping configuration; per-level total functions are not persisted. */
function toPersistedGrouping<TRowData>(grouping: GroupingConfig<TRowData> | undefined): PersistedGrouping | undefined {
	if (!grouping) return undefined;
	const out: PersistedGrouping = { by: groupByColIds(grouping) };
	const totals = grouping.totals;
	if (totals && (typeof totals.groups !== 'function' || totals.grand !== undefined)) {
		out.totals = {};
		if (totals.groups !== undefined && typeof totals.groups !== 'function') out.totals.groups = totals.groups;
		if (totals.grand !== undefined) out.totals.grand = totals.grand;
	}
	if (grouping.stickyHeaders !== undefined) out.stickyHeaders = grouping.stickyHeaders;
	return out;
}

/**
 * Restores persisted grouping over the configured one: the configured GroupDefs (key creators,
 * comparators) and everything not persisted are kept; levels on removed columns are dropped.
 */
function restoreGrouping<TRowData>(
	persisted: PersistedGrouping,
	configured: GroupingConfig<TRowData> | undefined,
	knownFields: ReadonlySet<string>
): GroupingConfig<TRowData> {
	const defs = new Map((configured?.by ?? []).map((entry) => [typeof entry === 'string' ? entry : entry.colId, entry] as const));
	const by = persisted.by.filter((colId) => knownFields.has(colId)).map((colId) => defs.get(colId) ?? colId);
	return {
		...configured,
		by,
		...(persisted.totals ? { totals: { ...configured?.totals, ...persisted.totals } } : {}),
		...(persisted.stickyHeaders !== undefined ? { stickyHeaders: persisted.stickyHeaders } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'boolean');
}

function isFiniteNumberRecord(value: unknown): value is Record<string, number> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry > 0);
}

function parseSerializedGridState(raw: unknown): SerializedGridStateParseResult {
	if (!isRecord(raw)) {
		return { ok: false, error: '[wit-grid] persisted grid state payload `state` must be an object.' };
	}

	const allowedKeys = new Set([
		'columnWidths',
		'columnOrder',
		'columnVisibility',
		'sortModel',
		'filterModel',
		'queryModel',
		'themeName',
		'grouping',
		'pinnedColumns',
		'view',
	]);
	for (const key of Object.keys(raw)) {
		if (!allowedKeys.has(key)) {
			return { ok: false, error: `[wit-grid] persisted grid state contains unsupported field \`${key}\`.` };
		}
	}

	if (raw.columnWidths !== undefined && !isFiniteNumberRecord(raw.columnWidths)) {
		return { ok: false, error: '[wit-grid] persisted grid state field `state.columnWidths` must be a record of positive finite numbers.' };
	}
	if (raw.columnOrder !== undefined && (!Array.isArray(raw.columnOrder) || !raw.columnOrder.every((entry) => typeof entry === 'string'))) {
		return { ok: false, error: '[wit-grid] persisted grid state field `state.columnOrder` must be a string array.' };
	}
	if (raw.columnVisibility !== undefined && !isBooleanRecord(raw.columnVisibility)) {
		return { ok: false, error: '[wit-grid] persisted grid state field `state.columnVisibility` must be a boolean record.' };
	}
	if (
		raw.sortModel !== undefined &&
		raw.sortModel !== null &&
		(!Array.isArray(raw.sortModel) ||
			!raw.sortModel.every((sort) => isRecord(sort) && typeof sort.colId === 'string' && (sort.sort === 'asc' || sort.sort === 'desc')))
	) {
		return { ok: false, error: '[wit-grid] persisted grid state field `state.sortModel` must be null or a valid sort-model array.' };
	}
	if (raw.filterModel !== undefined && raw.filterModel !== null && !isRecord(raw.filterModel)) {
		return { ok: false, error: '[wit-grid] persisted grid state field `state.filterModel` must be null or an object.' };
	}
	if (raw.queryModel !== undefined && raw.queryModel !== null && !isRecord(raw.queryModel)) {
		return { ok: false, error: '[wit-grid] persisted grid state field `state.queryModel` must be null or an object.' };
	}
	if (raw.themeName !== undefined && typeof raw.themeName !== 'string') {
		return { ok: false, error: '[wit-grid] persisted grid state field `state.themeName` must be a string.' };
	}
	if (raw.grouping !== undefined && !isPersistedGrouping(raw.grouping)) {
		return {
			ok: false,
			error: '[wit-grid] persisted grid state field `state.grouping` must be `{ by: string[], totals?: { groups?, grand? }, stickyHeaders?: boolean | { levels?, shadow? } }` with placements `top`, `bottom` or false.',
		};
	}
	if (
		raw.pinnedColumns !== undefined &&
		(!isRecord(raw.pinnedColumns) ||
			typeof raw.pinnedColumns.left !== 'number' ||
			typeof raw.pinnedColumns.right !== 'number' ||
			!Number.isInteger(raw.pinnedColumns.left) ||
			!Number.isInteger(raw.pinnedColumns.right) ||
			raw.pinnedColumns.left < 0 ||
			raw.pinnedColumns.right < 0)
	) {
		return {
			ok: false,
			error: '[wit-grid] persisted grid state field `state.pinnedColumns` must contain non-negative integer `left` and `right` counts.',
		};
	}

	if (raw.view !== undefined && raw.view !== null && (!isRecord(raw.view) || !VIEW_KINDS.includes(raw.view.kind as string))) {
		return {
			ok: false,
			error: `[wit-grid] persisted grid state field \`state.view\` must be null or a view configuration with \`kind\` ${VIEW_KINDS.join(', ')}.`,
		};
	}

	const value: SerializedGridState = {
		columnWidths: raw.columnWidths as SerializedGridState['columnWidths'],
		columnOrder: raw.columnOrder as SerializedGridState['columnOrder'],
		columnVisibility: raw.columnVisibility as SerializedGridState['columnVisibility'],
		sortModel: raw.sortModel as SerializedGridState['sortModel'],
		filterModel: raw.filterModel as SerializedGridState['filterModel'],
		queryModel: raw.queryModel as SerializedGridState['queryModel'],
		themeName: raw.themeName as SerializedGridState['themeName'],
		grouping: raw.grouping as SerializedGridState['grouping'],
		pinnedColumns: raw.pinnedColumns as SerializedGridState['pinnedColumns'],
		view: raw.view as SerializedGridState['view'],
	};
	return {
		ok: true,
		value,
	};
}

function parsePersistedGridState(raw: unknown): PersistedGridStateParseResult {
	if (!isRecord(raw)) {
		return { ok: false, error: '[wit-grid] persisted grid state must be an object.' };
	}
	const versionError = validateSchemaVersion(raw);
	if (versionError !== null) {
		return { ok: false, error: versionError };
	}
	if (!('state' in raw)) {
		return { ok: false, error: '[wit-grid] persisted grid state is missing required `state` payload.' };
	}
	const parsedState = parseSerializedGridState(raw.state);
	if (!parsedState.ok) {
		return parsedState;
	}
	return {
		ok: true,
		value: {
			v: raw.v as number,
			state: parsedState.value,
		},
	};
}

/**
 * Validate an unknown persisted-state envelope without applying it.
 * Storage adapters use this at their deserialization boundary so every
 * persisted-state consumer follows the same schema and diagnostic messages.
 */
export function validatePersistedGridState(raw: unknown): string | null {
	const parsed = parsePersistedGridState(raw);
	return parsed.ok ? null : parsed.error;
}

/**
 * Pluggable persistence adapter. Implement this interface to store grid settings
 * anywhere — localStorage, a remote API, a database, etc.
 *
 * @example localStorage (built-in shorthand via `createLocalStorageAdapter`)
 * @example Remote API:
 *   const adapter: GridPersistenceAdapter = {
 *     async load() { const res = await fetch('/api/grid-settings'); return res.ok ? res.json() : null; },
 *     async save(state) { await fetch('/api/grid-settings', { method: 'PUT', body: JSON.stringify(state) }); },
 *     async clear() { await fetch('/api/grid-settings', { method: 'DELETE' }); },
 *   };
 */
export interface GridPersistenceAdapter {
	/** Load saved state. May return a Promise for async/network sources. */
	load(): PersistedGridState | null | Promise<PersistedGridState | null>;
	/** Persist current state. Called debounced after relevant state changes. */
	save(state: PersistedGridState): void | Promise<void>;
	/** Optionally clear all saved state (e.g. "Reset to defaults"). */
	clear?(): void | Promise<void>;
	/**
	 * Debounce delay in ms before saving after a state change.
	 * @default 500
	 */
	debounceMs?: number;
}

export type PersistenceSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface PersistenceStatus {
	status: PersistenceSaveStatus;
	/** Whether auto-save is currently enabled. */
	autoSave: boolean;
	/** ms-since-epoch timestamp of the last successful save, or undefined if never saved this session. */
	lastSavedAt?: number;
	/** Populated when status === 'error'. */
	error?: unknown;
}

export interface PersistenceController {
	setAutoSave(enabled: boolean): void;
	isAutoSaveEnabled(): boolean;
	getStatus(): PersistenceStatus;
	/** Subscribe to status changes. Returns unsubscribe function. */
	onStatusChange(listener: (status: PersistenceStatus) => void): () => void;
	/** Immediately save current state, bypassing the debounce timer. */
	saveNow(): void;
	/** Run work while internal persistence-triggered saves are suppressed. */
	suspendAutoSave<T>(work: () => T): T;
	destroy(): void;
}

/** Built-in localStorage adapter. */
export function createLocalStorageAdapter(key: string): GridPersistenceAdapter {
	return {
		load() {
			try {
				const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
				if (!raw) return null;
				return JSON.parse(raw) as PersistedGridState;
			} catch {
				return null;
			}
		},
		save(state) {
			try {
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem(key, JSON.stringify(state));
				}
			} catch {
				// localStorage may be unavailable (SSR, quota exceeded, private browsing)
			}
		},
		clear() {
			try {
				if (typeof localStorage !== 'undefined') {
					localStorage.removeItem(key);
				}
			} catch {}
		},
	};
}

/** Extract the persisted subset of internal runtime state. */
function extractSerializedGridState<TRowData>(state: InternalGridState<TRowData>): SerializedGridState {
	const columnOrder = state.columns.map((c) => c.field);
	const columnVisibility: Record<string, boolean> = {};
	for (const col of state.columns) {
		// Grid uses col.hide (not col.visible) — persist as false = hidden
		if (col.hide) columnVisibility[col.field] = false;
	}
	const pins = state.pinnedColumns;
	return {
		columnWidths: Object.keys(state.columnWidths).length > 0 ? state.columnWidths : undefined,
		columnOrder,
		columnVisibility: Object.keys(columnVisibility).length > 0 ? columnVisibility : undefined,
		sortModel: state.sortModel,
		filterModel: state.filterModel,
		queryModel: state.queryModel,
		themeName: state.themeName,
		grouping: toPersistedGrouping(state.grouping),
		pinnedColumns: pins && (pins.left > 0 || pins.right > 0) ? pins : undefined,
		// The table is the default: only a view is recorded (older states and table-only grids are unchanged).
		view: state.view ? toSerializedView(state.view) : undefined,
	};
}

/** Extract the persisted subset of internal runtime state. */
export function extractPersistedState<TRowData>(state: InternalGridState<TRowData>): PersistedGridState {
	return {
		v: GRID_STATE_SCHEMA_VERSION,
		state: extractSerializedGridState(state),
	};
}

/** Runs the latest call after a pause, through the grid scheduler. */
function debounce(fn: () => void, ms: number): (() => void) & { flush(): void; cancel(): void } {
	let timer: ReturnType<GridScheduler['timeout']> | null = null;
	const cancel = () => {
		if (timer !== null) defaultGridScheduler.clearTimeout(timer);
		timer = null;
	};
	const debounced = () => {
		cancel();
		timer = defaultGridScheduler.timeout(() => {
			timer = null;
			fn();
		}, ms);
	};
	debounced.flush = () => {
		if (timer === null) return;
		cancel();
		fn();
	};
	debounced.cancel = cancel;
	return debounced;
}

/**
 * The saved column order over today's columns: columns that no longer exist drop out, and columns
 * added since keep their place (after the column they follow today).
 */
function mergeColumnOrder<T extends { field: string }>(current: readonly T[], saved: readonly string[]): T[] {
	const byField = new Map(current.map((column) => [column.field, column]));
	const result = saved.filter((field, index) => byField.has(field) && saved.indexOf(field) === index).map((field) => byField.get(field)!);
	const placed = new Set(result.map((column) => column.field));
	current.forEach((column, index) => {
		if (placed.has(column.field)) return;
		const before = index > 0 ? result.findIndex((c) => c.field === current[index - 1].field) : -1;
		result.splice(before + 1, 0, column);
		placed.add(column.field);
	});
	return result;
}

/**
 * Only these state keys should trigger a persistence save.
 * Scroll position, selection, active edit, etc. are intentionally excluded to
 * avoid flooding network adapters on every pointer event.
 */
export const PERSISTED_STATE_KEYS = [
	'columns',
	'columnWidths',
	'sortModel',
	'filterModel',
	'queryModel',
	'themeName',
	'grouping',
	'pinnedColumns',
	'view',
];

/**
 * Wire persistence to the grid via key-specific subscriptions.
 * Returns a controller that exposes auto-save toggle and save status.
 */
export function createPersistenceSubscription(
	adapter: GridPersistenceAdapter,
	subscribeToKey: (key: string, listener: () => void) => () => void,
	getGridState: () => PersistedGridState,
	debounceMs = 500
): PersistenceController {
	let autoSave = true;
	let autoSaveSuppressionDepth = 0;
	let currentStatus: PersistenceStatus = { status: 'idle', autoSave: true };
	const statusListeners = new Set<(status: PersistenceStatus) => void>();

	function setStatus(next: PersistenceStatus): void {
		currentStatus = next;
		statusListeners.forEach((l) => l(next));
	}

	function performSave(): void {
		if (!autoSave || autoSaveSuppressionDepth > 0) return;
		const snapshot = getGridState();
		setStatus({ status: 'saving', autoSave, lastSavedAt: currentStatus.lastSavedAt });
		try {
			const result = adapter.save(snapshot);
			if (result instanceof Promise) {
				result
					.then(() => {
						setStatus({ status: 'saved', autoSave, lastSavedAt: Date.now() });
					})
					.catch((err: unknown) => {
						setStatus({ status: 'error', autoSave, lastSavedAt: currentStatus.lastSavedAt, error: err });
					});
			} else {
				setStatus({ status: 'saved', autoSave, lastSavedAt: Date.now() });
			}
		} catch (err) {
			setStatus({ status: 'error', autoSave, lastSavedAt: currentStatus.lastSavedAt, error: err });
		}
	}

	const debouncedSave = debounce(performSave, debounceMs);

	// Subscribe only to keys that affect persisted state — not scroll, selection, viewport, etc.
	const unsubs = PERSISTED_STATE_KEYS.map((key) => subscribeToKey(key, debouncedSave));

	return {
		setAutoSave(enabled: boolean) {
			autoSave = enabled;
			setStatus({ ...currentStatus, autoSave: enabled });
		},
		isAutoSaveEnabled() {
			return autoSave;
		},
		getStatus() {
			return currentStatus;
		},
		onStatusChange(listener) {
			statusListeners.add(listener);
			return () => statusListeners.delete(listener);
		},
		saveNow() {
			debouncedSave.cancel(); // cancel any pending debounce to avoid a second save
			performSave();
		},
		suspendAutoSave<T>(work: () => T): T {
			autoSaveSuppressionDepth++;
			debouncedSave.cancel();
			try {
				return work();
			} finally {
				autoSaveSuppressionDepth--;
			}
		},
		destroy() {
			debouncedSave.flush(); // flush any pending save before teardown
			unsubs.forEach((u) => u());
			statusListeners.clear();
		},
	};
}

export function areRowHeightsEqual(current: Record<string, number>, next: Record<string, number>): boolean {
	const currentKeys = Object.keys(current);
	const nextKeys = Object.keys(next);
	if (currentKeys.length !== nextKeys.length) return false;
	for (const key of currentKeys) {
		if (current[key] !== next[key]) return false;
	}
	return true;
}

export interface PreparedPersistedStateRestore<TRowData = unknown> {
	readonly stateMutation: Partial<InternalGridState<TRowData>>;
}

export type ApplyGridStateResult =
	| { status: 'applied'; changeId: number }
	| { status: 'rejected'; reason: string }
	| { status: 'failed'; error: Error };

/**
 * Validate a persisted state blob and compute the atomic state mutation needed to
 * restore it. The caller executes this as a single GridCommitKernel commit — no
 * intermediate state is ever exposed and no rollback loop is needed.
 */
export function preparePersistedGridStateRestore<TRowData>(
	persisted: PersistedGridState,
	current: InternalGridState<TRowData>
): { ok: true; restore: PreparedPersistedStateRestore<TRowData> } | { ok: false; reason: string } {
	const parsed = parsePersistedGridState(persisted);
	if (!parsed.ok) return { ok: false, reason: parsed.error };

	const s = parsed.value.state;
	const knownFields = new Set(current.columns.map((c) => c.field));

	let columns = current.columns as ColumnDef<TRowData>[];
	let columnWidths = { ...current.columnWidths };

	if (s.columnOrder) columns = mergeColumnOrder(columns, s.columnOrder);

	if (s.columnVisibility) {
		columns = columns.map((col) => {
			const savedVis = s.columnVisibility![col.field];
			if (savedVis === false) return { ...col, hide: true };
			if (savedVis === true && col.hide) return { ...col, hide: false };
			return col;
		});
	}

	if (s.columnWidths) {
		for (const [field, width] of Object.entries(s.columnWidths)) {
			if (knownFields.has(field)) columnWidths[field] = width;
		}
	}

	const stateMutation: Partial<InternalGridState<TRowData>> = { columns, columnWidths };

	if (s.sortModel !== undefined) {
		const sm = s.sortModel;
		if (sm === null || (Array.isArray(sm) && sm.every((sort) => knownFields.has(sort.colId)))) {
			stateMutation.sortModel = sm as SortModel | null;
		}
	}
	if (s.filterModel !== undefined) {
		stateMutation.filterModel = restoreFilterModel(s.filterModel, knownFields);
	}
	if (s.queryModel !== undefined) {
		stateMutation.queryModel = restoreQueryModel(s.queryModel, knownFields);
	}
	if (s.themeName !== undefined && isBuiltInThemeName(s.themeName)) {
		stateMutation.themeName = s.themeName;
	}
	if (s.grouping !== undefined) {
		stateMutation.grouping = freezeGroupingConfig(restoreGrouping(s.grouping, current.grouping, knownFields));
	}
	if (s.pinnedColumns !== undefined) {
		stateMutation.pinnedColumns = s.pinnedColumns;
	}
	if (s.view !== undefined) {
		// The same config again is the same view: keep the live object (and its callbacks), no remount.
		const live = (current.view ?? null) as GridViewConfig<TRowData> | null;
		stateMutation.view =
			JSON.stringify(toSerializedView(live)) === JSON.stringify(s.view) ? live : (s.view as unknown as GridViewConfig<TRowData> | null);
	}

	return { ok: true, restore: { stateMutation } };
}
