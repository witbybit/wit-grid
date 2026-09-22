import { type ColumnDef, setValueByPath, compilePathGetter } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { RowDataTransaction, RowSelectionScope } from './api/GridApi.js';
import type { ClientRowModelRuntime } from './engine/runtimePorts.js';
import { GridMetric } from './diagnostics/GridInstrumentation.js';
import { getFieldRoot } from './ids.js';
import { createGridRowDataRef } from './publicRowRef.js';
import { RowNode } from './rowNode.js';
import type { InternalRowNodeTransaction } from './rowTransactions.js';
import type { AsyncRowModelRequestIdentity } from './asyncRowModelRequestIdentity.js';
import { RowPipeline, type RowModelConfig, type RowPipelineOutput } from './rows/RowPipeline.js';
import { RowDependencyRegistry, classifyMutation, type RowMutationImpact } from './rows/rowMutationClassifier.js';
import type { PageWindow } from './rows/pageModel.js';
import { RowDataStore } from './rows/RowDataStore.js';
import type { RowDataStoreTransactionSnapshot } from './rows/RowDataStore.js';
import { toDataVisualRowId } from './rows/visualRowIds.js';
import type { VisualRow } from './visualRow.js';
import {
	type FilterModel,
	type QuickFilterModel,
	type TextFilterCondition,
	type NumberFilterCondition,
	type DateFilterCondition,
	type SetFilterCondition,
	type FilterCondition,
	type CompoundFilterCondition,
	type ColumnFilter,
} from './filterModel.js';

export type {
	FilterModel,
	QuickFilterModel,
	ColumnFilter,
	FilterCondition,
	CompoundFilterCondition,
	TextFilterCondition,
	NumberFilterCondition,
	DateFilterCondition,
	SetFilterCondition,
};
export type { TextFilterOperator, NumberFilterOperator, DateFilterOperator, SelectFilterCondition } from './filterModel.js';

export type SortDirection = 'asc' | 'desc';

export interface SortModelItem {
	colId: string;
	sort: SortDirection;
}

export type SortModel = SortModelItem[];

/**
 * Internal row-model identity. Keep this explicit so the public `server`
 * alias maps to the real server-side row model (SSRM).
 */
export type InternalRowModelKind = 'client' | 'infinite' | 'server-side';

/**
 * Public/visual row-node kind surface. This is intentionally broader than the current
 * flat client-row implementation because async row models need first-class loading and
 * failure rows, and future grouped/detail rows must not overload plain data nodes.
 */
export type RowNodeKind = 'data' | 'loading' | 'failed' | 'placeholder' | 'group' | 'detail';

export type RowCountKind = 'known' | 'estimated' | 'unknown';

export interface RowModelQueryState {
	readonly datasourceGeneration: number;
	readonly queryVersion: number;
}

export interface RowModelRequestToken extends AsyncRowModelRequestIdentity {
	readonly kind: 'infinite-block' | 'server-side-block';
	readonly startRow?: number;
	readonly endRow?: number;
	readonly blockIndex?: number;
}

export type RowLoadState =
	| { kind: 'loaded'; rowId: string }
	| { kind: 'loading'; reason?: string }
	| { kind: 'failed'; error: string; retryable: boolean }
	| { kind: 'placeholder'; reason?: string }
	| { kind: 'missing' };

export interface RowRangeLoadState {
	loaded: number;
	loading: number;
	failed: number;
	placeholder: number;
	missing: number;
}

export interface ClientRowModelOptions<TData = unknown> {
	rows: TData[];
	columns: Array<ColumnDef<TData>>;
	/** Per-row height callback. Called for every data row when building geometry. Return `undefined` to fall back to `defaultRowHeight`. Overridden by `api.setRowHeight()`. */
	getRowHeight?: (row: TData, rowId: string) => number | undefined;
}

type ClientRowModelTransactionSnapshot<TData> = RowModelTransactionSnapshot<TData> & {
	readonly modelType: 'client';
	readonly snapshot: {
		readonly dataStore: RowDataStoreTransactionSnapshot<TData>;
	};
};

export type { GroupDef, RowModelConfig } from './rows/RowPipeline.js';
export type { AggregationDef } from './rows/stages/aggregateStage.js';

// ── Row model capability types ────────────────────────────────────────────────

export type RowModelCapability =
	| 'fullDataset'
	| 'loadedDataset'
	| 'pagedDataset'
	| 'clientMutation'
	| 'loadedRowMutation'
	| 'pageRowMutation'
	| 'transactions'
	| 'rowOrder'
	| 'blockLoading'
	| 'serverPagination'
	| 'clientSort'
	| 'clientFilter'
	| 'serverSort'
	| 'serverFilter'
	| 'clientGrouping'
	| 'clientTree'
	| 'aggregation'
	| 'masterDetail'
	| 'allRowSelection'
	| 'loadedRowSelection'
	| 'pageRowSelection';

export type RowModelCapabilities = Readonly<Record<RowModelCapability, boolean>>;

export interface CapableRowModel {
	getCapabilities(): RowModelCapabilities;
}

export function asCapableRowModel(rowModel: unknown): CapableRowModel | null {
	return rowModel && typeof (rowModel as CapableRowModel).getCapabilities === 'function' ? (rowModel as CapableRowModel) : null;
}

// ── Unsupported operation error ───────────────────────────────────────────────

export class UnsupportedRowModelOperationError extends Error {
	readonly operation: string;
	readonly rowModelType: string;
	readonly supportedRowModels: readonly string[];

	constructor(opts: { operation: string; rowModelType: string; supportedRowModels: string[] }) {
		super(
			`[wit-grid] Operation '${opts.operation}' is not supported by the '${opts.rowModelType}' row model. ` +
				`Supported row model(s): ${opts.supportedRowModels.join(', ')}.`
		);
		this.name = 'UnsupportedRowModelOperationError';
		this.operation = opts.operation;
		this.rowModelType = opts.rowModelType;
		this.supportedRowModels = opts.supportedRowModels;
	}
}

// ── Row model contract types ──────────────────────────────────────────────────
// Defined here to avoid a circular import with store.ts. store.ts re-exports these.

export type RowRefreshReason = 'sort' | 'filter' | 'group' | 'tree' | 'expansion' | 'detail' | 'flatten' | 'bulk' | 'edit' | 'row-order' | 'refresh';

/**
 * The renderer-facing read contract for the row model.
 *
 * This is the stable, model-agnostic interface the rendering layer depends on.
 * It contains only visual-position lookups and row-data accessors — no mutation,
 * pagination, server-datasource, or client-specific methods. Both
 * ClientRowModelController and ServerRowModelController satisfy it.
 *
 * Renderer code must depend on VisualRowModel, not the full RowModel, so that
 * client and server implementations remain substitutable and the renderer cannot
 * accidentally call mutation or model-specific APIs.
 */
export interface VisualRowModel<TRowData = unknown> {
	/** Fetch a rendered row by its visual (display) index, or null if out of range. */
	getVisualRow(index: number): VisualRow<TRowData> | null;
	/** Total number of visual rows currently displayed (includes group/aggregate rows). */
	getVisualRowCount(): number;
	/** Resolve a visual-row ID to its current visual index, or -1 if not found. */
	getVisualIndexById(visualRowId: string): number;
	/** Resolve a data-row ID to its current visual index, or -1 if not found. */
	getVisualIndexByRowId(rowId: string): number;
	/** Fetch the RowNode for a given data-row ID, or null. */
	getRowNodeById(rowId: string): RowNode<TRowData> | null;
	/** Fetch the raw source data for a given data-row ID, or null. */
	getRawRowById(rowId: string): TRowData | null;
	/**
	 * Returns a map from a sticky-group row's visual index to the visual index of
	 * its last descendant. Absent when there are no sticky group rows.
	 */
	getStickyGroupMeta?(): Map<number, number>;
	/** Returns the group metadata for a row at the given visual index, or null. */
	getGroupMetaByVisualIndex?(visualIndex: number): GroupRowMeta | null;
}

/**
 * Renderer-facing viewport contract for all row models. The renderer should be able to ask
 * for rows, counts, and load/range state without knowing whether the backing model is client,
 * infinite, or server-side.
 */
export interface RowModelViewportAccess<TRowData = unknown> extends VisualRowModel<TRowData> {
	getKnownRowCount(): number | null;
	getEstimatedRowCount(): number;
	getRowCountKind(): RowCountKind;

	getRowLoadState(index: number): RowLoadState;
	isRowLoaded(index: number): boolean;
	isRowLoading(index: number): boolean;
	isRowFailed(index: number): boolean;

	isRangeLoaded(startRow: number, endRow: number): boolean;
	getRangeLoadState(startRow: number, endRow: number): RowRangeLoadState;

	ensureRange(startRow: number, endRow: number, reason?: string): void;
}

export interface StickyGroupMetaCapableVisualRowModel {
	getStickyGroupMeta(): Map<number, number>;
}

export interface RowModelRefreshResult {
	changed: boolean;
	reason?: RowRefreshReason;
	layoutTransitionHint?: 'live-reorder';
	previousRowCount?: number;
	nextRowCount?: number;
	changedStartIndex?: number;
	changedEndIndex?: number;
	groupId?: string;
}

export interface RowExpansionCapableModel<TRowData = unknown> {
	expandAllGroups(): RowModelRefreshResult | void;
	collapseAllGroups(): RowModelRefreshResult | void;
	toggleGroupExpanded(groupId: string): RowModelRefreshResult | void;
	toggleDetailExpanded(rowId: string): RowModelRefreshResult | void;
}

export interface RowExpansionStateReadableModel {
	isGroupExpanded(groupId: string): boolean;
	isDetailExpanded(rowId: string): boolean;
}

export interface DataRowCountModel {
	getDataRowCount(): number;
}

export interface SelectableDataRowModel {
	getSelectableDataRowIds(scope?: RowSelectionScope): string[];
}

export interface PageWindowCapableRowModel {
	getPageWindow(): PageWindow | null;
}

export interface AllDataNodesCapableRowModel<TRowData = unknown> {
	getAllDataNodes(): RowNode<TRowData>[];
}

export interface FilteredDataNodesCapableRowModel<TRowData = unknown> {
	getFilteredDataNodes(): RowNode<TRowData>[];
}

export interface CurrentPageDataNodesCapableRowModel<TRowData = unknown> {
	getCurrentPageDataNodes(): RowNode<TRowData>[];
}

export interface GroupMetaCapableRowModel {
	getGroupMeta(groupId: string): GroupRowMeta | null;
}

export interface RowOrderCapableModel {
	getRowOrder(): string[];
	setRowOrder(rowIds: string[]): void;
}

// ── Structural write contract ─────────────────────────────────────────────────

/**
 * How a data write affects the visual row model — drives refresh strategy.
 * Aliased from RowMutationImpact so the commit layer and row-model classifier
 * share one canonical type.
 */
export type RowWriteImpact = RowMutationImpact;

/** Returned by every structural write method — carries exactly what changed, nothing else. */
export interface RowModelWriteResult<TRowData = unknown> {
	addedNodes?: RowNode<TRowData>[];
	removedNodes?: RowNode<TRowData>[];
	updatedNodes?: RowNode<TRowData>[];
	changedFieldsByRow?: Map<string, Set<string>>;
	changedValuesByRow?: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
	visualChange: 'none' | 'partial' | 'full';
}

/**
 * Structural row-model write interface — commit layer calls these methods.
 * Implementations mutate storage and return what changed; they do NOT refresh,
 * dispatch events, invalidate formulas, or bump versions.
 */
export interface ClientStructuralRowModel<TRowData = unknown> extends RowOrderCapableModel {
	captureTransactionSnapshot(
		mutation: import('./engine/GridDomainMutation.js').RowTransactionMutation<TRowData>
	): RowModelTransactionSnapshot<TRowData>;
	restoreTransactionSnapshot(snapshot: RowModelTransactionSnapshot<TRowData>): void;
	replaceRowsStructurally(rows: readonly TRowData[]): RowModelWriteResult<TRowData>;
	updateRowsStructurally(updater: (rows: TRowData[]) => TRowData[]): RowModelWriteResult<TRowData>;
	applyTransactionStructurally(
		transaction: import('./api/GridApi.js').RowDataTransaction<TRowData>
	): RowModelWriteResult<TRowData> & InternalRowNodeTransaction<TRowData>;
	writeCellValueStructurally(
		rowId: string,
		colField: string,
		value: unknown,
		options?: { bypassValueSetter?: boolean }
	): RowModelWriteResult<TRowData>;
	reconcileAfterDataWrite(writeResult: RowModelWriteResult<TRowData>, impact: RowWriteImpact): RowModelRefreshResult;
	classifyFieldMutation(changedFields: ReadonlySet<string>): RowWriteImpact;
}

/**
 * Classify which visual-model systems are affected by a set of changed data fields.
 * Delegates to the row model's own registry when possible; returns 'none' when the
 * row model is not a ClientStructuralRowModel (infinite/server never need client-side
 * sort/filter/group classification).
 */
export function classifyWriteImpact(rowModel: RowModel<unknown> | null, changedFieldsByRow: Map<string, Set<string>>): RowWriteImpact {
	const client = asClientStructuralRowModel(rowModel);
	if (!client) return 'value-only';
	const allFields = new Set<string>();
	for (const fields of changedFieldsByRow.values()) {
		for (const f of fields) allFields.add(f);
	}
	if (allFields.size === 0) return 'value-only';
	return client.classifyFieldMutation(allFields);
}

export function asClientStructuralRowModel<TRowData = unknown>(rowModel: RowModel<TRowData> | null): ClientStructuralRowModel<TRowData> | null {
	return hasFunctions(rowModel, [
		'captureTransactionSnapshot',
		'restoreTransactionSnapshot',
		'replaceRowsStructurally',
		'updateRowsStructurally',
		'applyTransactionStructurally',
		'writeCellValueStructurally',
		'reconcileAfterDataWrite',
		'classifyFieldMutation',
	])
		? (rowModel as unknown as ClientStructuralRowModel<TRowData>)
		: null;
}

/**
 * Any row model that can structurally write a single cell value.
 * Narrower than `ClientStructuralRowModel` — infinite and server models implement this
 * without providing the full dataset-replace / update / reconcile contract.
 * Duck-typed: any model with `writeCellValueStructurally` satisfies this interface.
 */
export interface AnyModelCellWritable<TRowData = unknown> {
	writeCellValueStructurally(
		rowId: string,
		colField: string,
		value: unknown,
		options?: { bypassValueSetter?: boolean }
	): RowModelWriteResult<TRowData>;
}

export function asAnyModelCellWritable<TRowData = unknown>(rowModel: RowModel<TRowData> | null): AnyModelCellWritable<TRowData> | null {
	return hasFunctions(rowModel, ['writeCellValueStructurally']) ? (rowModel as unknown as AnyModelCellWritable<TRowData>) : null;
}

/** Capability interface for the infinite (block/range) row model. */
export interface InfiniteControllableRowModel<TRowData = unknown> {
	purgeCache(): void;
	setDatasource(datasource: import('./infiniteRowModel.js').InfiniteDatasource<TRowData>, blockSize?: number): void;
}

/** Capability interface for the real server-side row model (SSRM). */
export interface ServerSideControllableRowModel<TRowData = unknown> {
	setServerSideDatasource(datasource: import('./serverSideRowModel.js').ServerSideDatasource<TRowData>): void;
	refreshServerSide(options?: import('./serverSideRowModel.js').ServerSideRefreshOptions): void;
	purgeServerSide(options?: Omit<import('./serverSideRowModel.js').ServerSideRefreshOptions, 'purge'>): void;
	getServerSideStoreState(): readonly import('./serverSideRowModel.js').ServerSideStoreSnapshot[];
}

export interface VisibleBlockLoadCapableRowModel {
	loadVisibleBlocks(startRow: number, endRow: number): void;
}

export interface RowModelTransactionSnapshot<TRowData = unknown> {
	readonly modelType: string;
	readonly snapshot: unknown;
}

/** Shared row-model contract used across engine and rendering code. */
export interface RowModel<TRowData = unknown> extends RowModelViewportAccess<TRowData> {
	refresh(reason?: RowRefreshReason): RowModelRefreshResult;
}

function hasFunctions(value: unknown, names: readonly string[]): boolean {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
	const record = value as Record<string, unknown>;
	return names.every((name) => typeof record[name] === 'function');
}

export function asRowExpansionCapableModel<TRowData = unknown>(rowModel: RowModel<TRowData> | null): RowExpansionCapableModel<TRowData> | null {
	return hasFunctions(rowModel, ['expandAllGroups', 'collapseAllGroups', 'toggleGroupExpanded', 'toggleDetailExpanded'])
		? (rowModel as unknown as RowExpansionCapableModel<TRowData>)
		: null;
}

export function asRowExpansionStateReadableModel(rowModel: RowModel<unknown> | null): RowExpansionStateReadableModel | null {
	return hasFunctions(rowModel, ['isGroupExpanded', 'isDetailExpanded']) ? (rowModel as unknown as RowExpansionStateReadableModel) : null;
}

export function asDataRowCountModel(rowModel: RowModel<unknown> | null): DataRowCountModel | null {
	return hasFunctions(rowModel, ['getDataRowCount']) ? (rowModel as unknown as DataRowCountModel) : null;
}

export function asSelectableDataRowModel(rowModel: RowModel<unknown> | null): SelectableDataRowModel | null {
	return hasFunctions(rowModel, ['getSelectableDataRowIds']) ? (rowModel as unknown as SelectableDataRowModel) : null;
}

export function asPageWindowCapableRowModel(rowModel: RowModel<unknown> | null): PageWindowCapableRowModel | null {
	return hasFunctions(rowModel, ['getPageWindow']) ? (rowModel as unknown as PageWindowCapableRowModel) : null;
}

export function asAllDataNodesCapableRowModel<TRowData = unknown>(rowModel: RowModel<TRowData> | null): AllDataNodesCapableRowModel<TRowData> | null {
	return hasFunctions(rowModel, ['getAllDataNodes']) ? (rowModel as unknown as AllDataNodesCapableRowModel<TRowData>) : null;
}

export function asGroupMetaCapableRowModel(rowModel: RowModel<unknown> | null): GroupMetaCapableRowModel | null {
	return hasFunctions(rowModel, ['getGroupMeta']) ? (rowModel as unknown as GroupMetaCapableRowModel) : null;
}

export function asRowOrderCapableModel(rowModel: RowModel<unknown> | null): RowOrderCapableModel | null {
	return hasFunctions(rowModel, ['getRowOrder', 'setRowOrder']) ? (rowModel as unknown as RowOrderCapableModel) : null;
}

export function asInfiniteControllableRowModel<TRowData = unknown>(
	rowModel: RowModel<TRowData> | null
): InfiniteControllableRowModel<TRowData> | null {
	return hasFunctions(rowModel, ['purgeCache', 'setDatasource', 'loadVisibleBlocks'])
		? (rowModel as unknown as InfiniteControllableRowModel<TRowData>)
		: null;
}

export function asServerSideControllableRowModel<TRowData = unknown>(
	rowModel: RowModel<TRowData> | null
): ServerSideControllableRowModel<TRowData> | null {
	return hasFunctions(rowModel, ['setServerSideDatasource', 'refreshServerSide', 'purgeServerSide', 'getServerSideStoreState'])
		? (rowModel as unknown as ServerSideControllableRowModel<TRowData>)
		: null;
}

export function asStickyGroupMetaCapableVisualRowModel(rowModel: VisualRowModel<unknown> | null): StickyGroupMetaCapableVisualRowModel | null {
	return hasFunctions(rowModel, ['getStickyGroupMeta']) ? (rowModel as unknown as StickyGroupMetaCapableVisualRowModel) : null;
}

export interface GroupRowMeta {
	groupId: string;
	visualIndex: number;
	depth: number;
	parentGroupId: string | null;
	/** Index of the first child visual row (group or data), or -1 if collapsed. */
	firstChildIndex: number;
	/** Index of the last child visual row (group or data), or -1 if collapsed. */
	lastChildIndex: number;
	firstLeafIndex: number;
	lastLeafIndex: number;
	/** rowIds of all visible (non-collapsed) data rows beneath this group. */
	visibleDescendantRowIds: string[];
	/** groupIds of immediate child group rows that are visible. */
	childGroupIds: string[];
	leafCount: number;
	childCount: number;
	expanded: boolean;
	aggregateValues?: Record<string, unknown>;
}

// ── Filter preparation ────────────────────────────────────────────────────────

interface PreparedBase<TData> {
	getter: (node: RowNode<TData>) => unknown;
}

interface PreparedTextFilter<TData> extends PreparedBase<TData> {
	kind: 'text';
	operator: TextFilterCondition['operator'];
	textValue: string;
}

interface PreparedNumberFilter<TData> extends PreparedBase<TData> {
	kind: 'number';
	operator: NumberFilterCondition['operator'];
	value: number;
	valueTo?: number;
}

interface PreparedDateFilter<TData> extends PreparedBase<TData> {
	kind: 'date';
	operator: DateFilterCondition['operator'];
	dateFrom: Date;
	dateTo?: Date;
}

interface PreparedSetFilter<TData> extends PreparedBase<TData> {
	kind: 'set';
	valueSet: Set<string>;
	includeNull: boolean;
}

interface PreparedSelectFilter<TData> extends PreparedBase<TData> {
	kind: 'select';
	valueSet: Set<string>;
	includeNull: boolean;
	matchMode: 'any' | 'all';
}

interface PreparedCompoundFilter<TData> {
	kind: 'compound';
	logicalOp: 'AND' | 'OR';
	left: PreparedColumnFilter<TData>;
	right: PreparedColumnFilter<TData>;
}

/** A single search string matched (OR) across every targeted column's getter. */
interface PreparedQuickFilter<TData> {
	kind: 'quick';
	getters: Array<(node: RowNode<TData>) => unknown>;
	textValue: string;
}

type PreparedColumnFilter<TData> =
	| PreparedTextFilter<TData>
	| PreparedNumberFilter<TData>
	| PreparedDateFilter<TData>
	| PreparedSetFilter<TData>
	| PreparedSelectFilter<TData>
	| PreparedCompoundFilter<TData>
	| PreparedQuickFilter<TData>;

function parseFilterDate(raw: string): Date | null {
	const d = new Date(raw);
	return isNaN(d.getTime()) ? null : d;
}

function stripTime(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseCellDate(value: unknown): Date | null {
	if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
	if (typeof value === 'number') return new Date(value);
	if (typeof value === 'string') {
		const d = new Date(value);
		return isNaN(d.getTime()) ? null : d;
	}
	return null;
}

function compareValues(a: unknown, b: unknown): number {
	if (a === b) return 0;
	if (a == null) return -1;
	if (b == null) return 1;

	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}

	const aNumber = Number(a);
	const bNumber = Number(b);
	if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
		return aNumber - bNumber;
	}

	const aStr = String(a);
	const bStr = String(b);
	if (aStr < bStr) return -1;
	if (aStr > bStr) return 1;
	return 0;
}

export function getColumnValue<TData>(node: RowNode<TData>, column: ColumnDef<TData> | undefined): unknown {
	if (!column) return undefined;
	if (column.valueGetter) return column.valueGetter({ node: createGridRowDataRef(node.id, node.data), row: node.data, colField: column.field });
	const getter = compilePathGetter(column.field);
	return node.getCellValue(column.field, getter);
}

function matchTextFilter(value: unknown, pf: PreparedTextFilter<unknown>): boolean {
	const isBlank = value == null || value === '';
	if (pf.operator === 'blank') return isBlank;
	if (pf.operator === 'notBlank') return !isBlank;
	const text = String(value ?? '').toLowerCase();
	switch (pf.operator) {
		case 'equals':
			return text === pf.textValue;
		case 'notEquals':
			return text !== pf.textValue;
		case 'startsWith':
			return text.startsWith(pf.textValue);
		case 'endsWith':
			return text.endsWith(pf.textValue);
		case 'notContains':
			return !text.includes(pf.textValue);
		case 'contains':
		default:
			return text.includes(pf.textValue);
	}
}

function matchNumberFilter(value: unknown, pf: PreparedNumberFilter<unknown>): boolean {
	const isBlank = value == null || value === '';
	if (pf.operator === 'blank') return isBlank;
	if (pf.operator === 'notBlank') return !isBlank;
	if (isBlank) return false;
	const n = Number(value);
	if (isNaN(n)) return false;
	switch (pf.operator) {
		case 'equals':
			return n === pf.value;
		case 'notEquals':
			return n !== pf.value;
		case 'gt':
			return n > pf.value;
		case 'gte':
			return n >= pf.value;
		case 'lt':
			return n < pf.value;
		case 'lte':
			return n <= pf.value;
		case 'inRange':
			return pf.valueTo !== undefined ? n >= pf.value && n <= pf.valueTo : n >= pf.value;
	}
}

function matchDateFilter(value: unknown, pf: PreparedDateFilter<unknown>): boolean {
	const isBlank = value == null || value === '';
	if (pf.operator === 'blank') return isBlank;
	if (pf.operator === 'notBlank') return !isBlank;
	const cellDate = parseCellDate(value);
	if (!cellDate) return false;
	switch (pf.operator) {
		case 'equals':
			return stripTime(cellDate).getTime() === stripTime(pf.dateFrom).getTime();
		case 'before':
			return cellDate < pf.dateFrom;
		case 'after':
			return cellDate > pf.dateFrom;
		case 'inRange':
			return pf.dateTo !== undefined ? cellDate >= pf.dateFrom && cellDate <= pf.dateTo : cellDate >= pf.dateFrom;
	}
}

function matchSetFilter(value: unknown, pf: PreparedSetFilter<unknown>): boolean {
	if (pf.valueSet.size === 0 && !pf.includeNull) return false;
	if (value == null || value === '') return pf.includeNull;
	return pf.valueSet.has(String(value).toLowerCase());
}

function matchSelectFilter(value: unknown, pf: PreparedSelectFilter<unknown>): boolean {
	if (pf.valueSet.size === 0 && !pf.includeNull) return false;
	if (value == null || value === '') return pf.includeNull;
	const strVal = String(value).toLowerCase();
	if (pf.matchMode === 'all') {
		// Unusual: cell value must equal every selected value (useful for multi-valued cells)
		return pf.valueSet.has(strVal) && pf.valueSet.size === 1;
	}
	// Default: OR — any selected value matches
	return pf.valueSet.has(strVal);
}

function matchPreparedFilter<TData>(node: RowNode<TData>, pf: PreparedColumnFilter<TData>): boolean {
	if (pf.kind === 'compound') {
		const l = matchPreparedFilter(node, pf.left);
		const r = matchPreparedFilter(node, pf.right);
		return pf.logicalOp === 'AND' ? l && r : l || r;
	}
	if (pf.kind === 'quick') {
		for (const getter of pf.getters) {
			const text = String(getter(node) ?? '').toLowerCase();
			if (text.includes(pf.textValue)) return true;
		}
		return false;
	}
	const value = pf.getter(node);
	switch (pf.kind) {
		case 'text':
			return matchTextFilter(value, pf as PreparedTextFilter<unknown>);
		case 'number':
			return matchNumberFilter(value, pf as PreparedNumberFilter<unknown>);
		case 'date':
			return matchDateFilter(value, pf as PreparedDateFilter<unknown>);
		case 'set':
			return matchSetFilter(value, pf as PreparedSetFilter<unknown>);
		case 'select':
			return matchSelectFilter(value, pf as PreparedSelectFilter<unknown>);
	}
}

function fieldsAffectColumn(fields: Set<string>, columnField: string): boolean {
	return fields.has(columnField) || fields.has(getFieldRoot(columnField));
}

function createColumnLookup<TData>(columns: Array<ColumnDef<TData>>): Map<string, ColumnDef<TData>> {
	const columnById = new Map<string, ColumnDef<TData>>();
	columns.forEach((column) => {
		columnById.set(column.field, column);
	});
	return columnById;
}

function sameVisualRowIdentity<TData>(left: VisualRow<TData>, right: VisualRow<TData>): boolean {
	return left.kind === right.kind && left.id === right.id;
}

function describeVisualRowDiff<TData>(
	previousRows: Array<VisualRow<TData>>,
	nextRows: Array<VisualRow<TData>>,
	reason?: RowRefreshReason,
	groupId?: string
): RowModelRefreshResult {
	let prefix = 0;
	const minLength = Math.min(previousRows.length, nextRows.length);
	while (prefix < minLength && sameVisualRowIdentity(previousRows[prefix], nextRows[prefix])) {
		prefix++;
	}

	let suffix = 0;
	while (
		suffix < minLength - prefix &&
		sameVisualRowIdentity(previousRows[previousRows.length - 1 - suffix], nextRows[nextRows.length - 1 - suffix])
	) {
		suffix++;
	}

	const changed = previousRows.length !== nextRows.length || prefix < previousRows.length || prefix < nextRows.length;
	const changedEndIndex = changed ? Math.max(previousRows.length, nextRows.length) - suffix - 1 : undefined;

	return {
		changed,
		reason,
		previousRowCount: previousRows.length,
		nextRowCount: nextRows.length,
		changedStartIndex: changed ? prefix : undefined,
		changedEndIndex,
		groupId,
	};
}

function makeGetter<TData>(column: ColumnDef<TData>): (node: RowNode<TData>) => unknown {
	if (column.valueGetter) {
		const vg = column.valueGetter;
		return (node) => vg({ node: createGridRowDataRef(node.id, node.data), row: node.data, colField: column.field });
	}
	const pg = compilePathGetter(column.field);
	return (node) => node.getCellValue(column.field, pg);
}

function prepareCondition<TData>(condition: FilterCondition, getter: (node: RowNode<TData>) => unknown): PreparedColumnFilter<TData> | null {
	if (condition.type === 'text') {
		return { kind: 'text', getter, operator: condition.operator, textValue: condition.value.toLowerCase() };
	}
	if (condition.type === 'number') {
		return { kind: 'number', getter, operator: condition.operator, value: condition.value, valueTo: condition.valueTo };
	}
	if (condition.type === 'date') {
		if (condition.operator === 'blank' || condition.operator === 'notBlank') {
			return { kind: 'date', getter, operator: condition.operator, dateFrom: new Date(0) };
		}
		const dateFrom = parseFilterDate(condition.dateFrom);
		if (!dateFrom) return null;
		const dateTo = condition.dateTo ? (parseFilterDate(condition.dateTo) ?? undefined) : undefined;
		return { kind: 'date', getter, operator: condition.operator, dateFrom, dateTo };
	}
	if (condition.type === 'set') {
		const hasNull = condition.values.includes(null);
		const valueSet = new Set(condition.values.filter((v): v is string | number => v !== null).map((v) => String(v).toLowerCase()));
		return { kind: 'set', getter, valueSet, includeNull: hasNull };
	}
	if (condition.type === 'select') {
		const hasNull = condition.values.includes(null);
		const valueSet = new Set(condition.values.filter((v): v is string | number => v !== null).map((v) => String(v).toLowerCase()));
		return { kind: 'select', getter, valueSet, includeNull: hasNull, matchMode: condition.matchMode ?? 'any' };
	}
	return null;
}

function prepareColumnFilter<TData>(columnFilter: ColumnFilter, getter: (node: RowNode<TData>) => unknown): PreparedColumnFilter<TData> | null {
	if (columnFilter.type === 'compound') {
		const [c1, c2] = columnFilter.conditions;
		const left = prepareCondition<TData>(c1, getter);
		const right = prepareCondition<TData>(c2, getter);
		if (!left || !right) return null;
		return { kind: 'compound', logicalOp: columnFilter.operator, left, right };
	}
	return prepareCondition(columnFilter, getter);
}

function prepareQuickFilter<TData>(
	columns: Array<ColumnDef<TData>>,
	quickFilterModel: QuickFilterModel | null | undefined
): PreparedQuickFilter<TData> | null {
	if (!quickFilterModel || !quickFilterModel.text.trim()) return null;
	const columnById = createColumnLookup(columns);
	const targetColumns =
		quickFilterModel.columnIds && quickFilterModel.columnIds.length > 0
			? (quickFilterModel.columnIds.map((id) => columnById.get(id)).filter((c): c is ColumnDef<TData> => !!c) as ColumnDef<TData>[])
			: columns;
	if (targetColumns.length === 0) return null;
	return {
		kind: 'quick',
		getters: targetColumns.map((column) => makeGetter(column)),
		textValue: quickFilterModel.text.trim().toLowerCase(),
	};
}

function prepareFilters<TData>(
	columns: Array<ColumnDef<TData>>,
	filterModel: FilterModel | null | undefined,
	quickFilterModel?: QuickFilterModel | null
): PreparedColumnFilter<TData>[] {
	const result: PreparedColumnFilter<TData>[] = [];
	if (filterModel) {
		const columnById = createColumnLookup(columns);
		for (const [colId, rawItem] of Object.entries(filterModel)) {
			const item = rawItem as ColumnFilter;
			if (!item) continue;
			const column = columnById.get(colId);
			if (!column) continue;
			const getter = makeGetter(column);
			const prepared = prepareColumnFilter(item, getter);
			if (prepared) result.push(prepared);
		}
	}

	const preparedQuick = prepareQuickFilter(columns, quickFilterModel);
	if (preparedQuick) result.push(preparedQuick);

	return result;
}

function nodeMatchesPreparedFilters<TData>(node: RowNode<TData>, preparedFilters: PreparedColumnFilter<TData>[]): boolean {
	for (let i = 0; i < preparedFilters.length; i++) {
		if (!matchPreparedFilter(node, preparedFilters[i])) return false;
	}
	return true;
}

export function applyClientFilterOnly<TData>(
	nodes: RowNode<TData>[],
	columns: Array<ColumnDef<TData>>,
	filterModel: FilterModel | null | undefined,
	quickFilterModel?: QuickFilterModel | null
): RowNode<TData>[] {
	const preparedFilters = prepareFilters(columns, filterModel, quickFilterModel);
	if (preparedFilters.length === 0) return nodes;
	return nodes.filter((node) => nodeMatchesPreparedFilters(node, preparedFilters));
}

export function applyClientSortAndFilter<TData>(
	nodes: RowNode<TData>[],
	columns: Array<ColumnDef<TData>>,
	sortModel: SortModel | null | undefined,
	filterModel: FilterModel | null | undefined,
	quickFilterModel?: QuickFilterModel | null
): Array<{ node: RowNode<TData>; sourceIndex: number }> {
	const columnById = createColumnLookup(columns);
	let result = nodes.map((node, sourceIndex) => ({ node, sourceIndex }));

	// 1. Pre-compile and pre-resolve active filters to avoid O(N) entries allocations, string manipulation, and Map lookups
	const preparedFilters = prepareFilters(columns, filterModel, quickFilterModel);
	if (preparedFilters.length > 0) {
		result = result.filter(({ node }) => nodeMatchesPreparedFilters(node, preparedFilters));
	}

	// 2. Pre-compile sort getters to avoid O(N log N) getter compilations and map lookups
	if (sortModel?.length) {
		const precompiledSortGetters = sortModel.map((sortItem) => {
			const column = columnById.get(sortItem.colId);
			let getter: (node: RowNode<TData>) => unknown;
			if (column) {
				if (column.valueGetter) {
					const colValGetter = column.valueGetter;
					getter = (node: RowNode<TData>) =>
						colValGetter({ node: createGridRowDataRef(node.id, node.data), row: node.data, colField: column.field });
				} else {
					const pathGetter = compilePathGetter(column.field);
					getter = (node: RowNode<TData>) => node.getCellValue(column.field, pathGetter);
				}
			} else {
				getter = () => undefined;
			}
			return getter;
		});

		// Schwartzian transform: extract sort keys in O(N) using pre-allocated arrays to minimize allocation overhead
		const sortData = result.map((item) => {
			const keys = new Array(sortModel.length);
			for (let i = 0; i < sortModel.length; i++) {
				keys[i] = precompiledSortGetters[i](item.node);
			}
			return { item, keys };
		});

		sortData.sort((left, right) => {
			for (let i = 0; i < sortModel.length; i++) {
				const sortItem = sortModel[i];
				const comparison = compareValues(left.keys[i], right.keys[i]);
				if (comparison !== 0) {
					return sortItem.sort === 'desc' ? -comparison : comparison;
				}
			}
			return left.item.sourceIndex - right.item.sourceIndex;
		});

		result = sortData.map((d) => d.item);
	}

	return result;
}

const CLIENT_CAPABILITIES: RowModelCapabilities = {
	fullDataset: true,
	loadedDataset: false,
	pagedDataset: false,
	clientMutation: true,
	loadedRowMutation: false,
	pageRowMutation: false,
	transactions: true,
	rowOrder: true,
	blockLoading: false,
	serverPagination: false,
	clientSort: true,
	clientFilter: true,
	serverSort: false,
	serverFilter: false,
	clientGrouping: true,
	clientTree: true,
	aggregation: true,
	masterDetail: true,
	allRowSelection: true,
	loadedRowSelection: false,
	pageRowSelection: false,
};

export class ClientRowModelController<TData = unknown>
	implements
		RowModel<TData>,
		DataRowCountModel,
		SelectableDataRowModel,
		RowExpansionCapableModel<TData>,
		RowExpansionStateReadableModel,
		PageWindowCapableRowModel,
		AllDataNodesCapableRowModel<TData>,
		GroupMetaCapableRowModel,
		ClientStructuralRowModel<TData>,
		CapableRowModel
{
	private readonly runtime: ClientRowModelRuntime<TData>;
	private dataStore: RowDataStore<TData>;
	private readonly getRowHeight: ClientRowModelOptions<TData>['getRowHeight'];
	private visualRows: Array<VisualRow<TData>> = [];
	private visualRowIdToIndex = new Map<string, number>();
	private rowIdToVisualIndex = new Map<string, number>();
	private rowIdToVisualRowId = new Map<string, string>();
	private rowIdToVisualRowIds: Map<string, string[]> | undefined;
	private dataRowCount = 0;
	private unsubscribers: Array<() => void> = [];

	private pipeline = new RowPipeline<TData>();
	readonly dependencyRegistry = new RowDependencyRegistry<TData>();
	private _stickyGroupMeta = new Map<number, number>();
	private _groupMeta = new Map<string, GroupRowMeta>();
	private _groupMetaByVisualIndex = new Map<number, GroupRowMeta>();
	private _pageWindow: PageWindow | null = null;

	public getStickyGroupMeta = (): Map<number, number> => this._stickyGroupMeta;
	public getPageWindow = (): PageWindow | null => this._pageWindow;
	public getGroupMeta = (groupId: string): GroupRowMeta | null => this._groupMeta.get(groupId) ?? null;
	public getGroupMetaByVisualIndex = (visualIndex: number): GroupRowMeta | null => this._groupMetaByVisualIndex.get(visualIndex) ?? null;

	public getDataRowCount = (): number => this.dataRowCount;

	public getCapabilities(): RowModelCapabilities {
		return CLIENT_CAPABILITIES;
	}

	public toggleGroupExpanded = (groupId: string): RowModelRefreshResult => {
		const expansion = this.runtime.getState().expansion;
		if (groupId.startsWith('group:')) {
			const groups = { ...expansion.groups };
			if (groups[groupId]) {
				delete groups[groupId];
			} else {
				groups[groupId] = true;
			}
			this.runtime.updateExpansion(() => ({ ...expansion, groups }));
		} else {
			const treeRows = { ...expansion.treeRows };
			if (treeRows[groupId]) {
				delete treeRows[groupId];
			} else {
				treeRows[groupId] = true;
			}
			this.runtime.updateExpansion(() => ({ ...expansion, treeRows }));
		}
		return this.refresh('expansion', groupId);
	};

	public toggleDetailExpanded = (rowId: string): RowModelRefreshResult => {
		const expansion = this.runtime.getState().expansion;
		const details = { ...expansion.details };
		if (details[rowId]) {
			delete details[rowId];
		} else {
			details[rowId] = true;
		}
		this.runtime.updateExpansion(() => ({ ...expansion, details }));
		return this.refresh('detail');
	};

	public isGroupExpanded = (groupId: string): boolean => {
		const expansion = this.runtime.getState().expansion;
		return groupId.startsWith('group:') ? !!expansion.groups[groupId] : !!expansion.treeRows[groupId];
	};

	public isDetailExpanded = (rowId: string): boolean => {
		return !!this.runtime.getState().expansion.details[rowId];
	};

	public expandAllGroups = (): RowModelRefreshResult => {
		const state = this.runtime.getState();
		const expansionIds = this.pipeline.collectAllExpansionIds({
			nodes: this.dataStore.getAllNodes(),
			columns: state.columns,
			groupBy: state.groupBy,
			rowModelConfig: state.rowModelConfig,
			filterModel: state.filterModel,
			quickFilterModel: state.quickFilterModel,
		});
		const groups: Record<string, true> = {};
		for (const id of expansionIds.groupIds) groups[id] = true;
		const treeRows: Record<string, true> = {};
		for (const id of expansionIds.treeRowIds) treeRows[id] = true;
		this.runtime.updateExpansion((expansion) => ({ ...expansion, groups, treeRows }));
		return this.refresh('expansion');
	};

	public collapseAllGroups = (): RowModelRefreshResult => {
		this.runtime.updateExpansion((expansion) => ({ ...expansion, groups: {}, treeRows: {} }));
		return this.refresh('expansion');
	};

	constructor(runtime: ClientRowModelRuntime<TData>, options: ClientRowModelOptions<TData>) {
		this.runtime = runtime;
		this.getRowHeight = options.getRowHeight;
		this.dataStore = new RowDataStore<TData>((row) => this.runtime.getRowId(row));

		this.runtime.initializeModel({
			columns: options.columns,
		});

		this.runtime.registerRowModel(this);

		this.unsubscribers.push(
			this.runtime.addEventListener(GridEventName.sortChanged, () => {
				this.rebuildDependencyRegistry();
				this.runtime.applyRefreshInvalidation(this.refresh('sort'), {
					invalidationReason: 'sort',
					requestRenderReason: 'rows:set-sort-model',
					includeHeaders: true,
				});
			}),
			this.runtime.addEventListener(GridEventName.filterChanged, () => {
				this.rebuildDependencyRegistry();
				this.runtime.applyRefreshInvalidation(this.refresh('filter'), {
					invalidationReason: 'filter',
					requestRenderReason: 'rows:set-filter-model',
					includeHeaders: true,
					includeOverlay: true,
				});
			}),
			this.runtime.addEventListener(GridEventName.quickFilterChanged, () => {
				this.rebuildDependencyRegistry();
				this.runtime.applyRefreshInvalidation(this.refresh('filter'), {
					invalidationReason: 'filter',
					requestRenderReason: 'rows:set-quick-filter-model',
					includeHeaders: true,
					includeOverlay: true,
				});
			}),
			this.runtime.addEventListener(GridEventName.queryModelChanged, () => {
				this.refresh();
			}),
			this.runtime.addEventListener(GridEventName.groupByChanged, () => {
				this.rebuildDependencyRegistry();
				this.refresh();
			}),
			this.runtime.addEventListener(GridEventName.aggDefsChanged, () => {
				this.rebuildDependencyRegistry();
				this.refresh();
			}),
			this.runtime.addEventListener(GridEventName.showGroupFooterChanged, () => this.refresh()),
			this.runtime.addEventListener(GridEventName.enableStickyGroupRowsChanged, () => this.refresh()),
			// Client pagination page change → re-run the pipeline with the new page window.
			this.runtime.addEventListener(GridEventName.paginationChanged, () => this.refresh('flatten'))
		);
		this.rebuildDependencyRegistry();
		this.dataStore.setRows(options.rows);
		this.refresh();
	}

	public dispose(): void {
		this.unsubscribers.forEach((unsubscribe) => unsubscribe());
		this.unsubscribers = [];
	}

	private rebuildDependencyRegistry(): void {
		const state = this.runtime.getState();
		this.dependencyRegistry.update({
			columns: state.columns,
			sortModel: state.sortModel,
			filterModel: state.filterModel,
			quickFilterModel: state.quickFilterModel,
			groupBy: state.groupBy,
			aggDefs: state.aggDefs,
			hasTreeParent: !!state.getParentId,
			treeParentDependencies: state.rowModelConfig?.treeData?.getParentIdDependencies,
		});
	}

	/** @internal Exposed for use by the incremental update path. */
	public classifyFieldMutation(changedFields: ReadonlySet<string>) {
		return classifyMutation(changedFields, this.dependencyRegistry);
	}

	/**
	 * Returns true when at least one of the changed nodes would enter or exit the active filter,
	 * meaning the visual row array must be rebuilt. Returns true immediately for grouped/tree grids
	 * because group rows may appear or disappear when all their children enter/exit the filter.
	 */
	private filterMembershipChanged(changedNodes: RowNode<TData>[]): boolean {
		const state = this.runtime.getState();
		if (state.groupBy?.length || state.rowModelConfig?.treeData?.enabled) return true;
		const preparedFilters = prepareFilters(state.columns, state.filterModel, state.quickFilterModel);
		for (const node of changedNodes) {
			const wasVisible = this.rowIdToVisualIndex.has(node.id);
			const passes = preparedFilters.length === 0 || nodeMatchesPreparedFilters(node, preparedFilters);
			if (wasVisible !== passes) return true;
		}
		return false;
	}

	/**
	 * Incrementally repositions changed rows within the sorted visual array, avoiding a full
	 * pipeline rebuild. Only applicable to flat (non-grouped, non-tree) grids with an active sort
	 * and no pagination. Returns false to signal that the caller must fall back to full refresh.
	 */
	private relocateSortedRows(changedNodes: RowNode<TData>[]): number | null {
		const state = this.runtime.getState();
		if (state.groupBy?.length) return null;
		if (state.rowModelConfig?.treeData?.enabled) return null;
		if (state.rowModelConfig?.masterDetail?.enabled) return null;
		if (!state.sortModel || state.sortModel.length === 0) return null;
		if (this._pageWindow !== null) return null;

		// Build sort key getters mirroring the pipeline's comparator
		const columnById = createColumnLookup(state.columns);
		const sortGetters = state.sortModel.map((sortItem) => {
			const col = columnById.get(sortItem.colId);
			if (col) {
				if (col.valueGetter) {
					const vg = col.valueGetter;
					return (node: RowNode<TData>): unknown =>
						vg({ node: createGridRowDataRef(node.id, node.data), row: node.data, colField: col.field });
				}
				const pg = compilePathGetter(col.field);
				return (node: RowNode<TData>): unknown => node.getCellValue(col.field, pg);
			}
			return (): undefined => undefined;
		});

		// Pre-build source index map for stable-sort tiebreaker
		const allNodes = this.dataStore.getAllNodes();
		const sourceIndexOf = new Map<string, number>();
		for (let i = 0; i < allNodes.length; i++) sourceIndexOf.set(allNodes[i].id, i);

		const compareNodes = (a: RowNode<TData>, b: RowNode<TData>): number => {
			for (let i = 0; i < state.sortModel!.length; i++) {
				const aVal = sortGetters[i](a);
				const bVal = sortGetters[i](b);
				const cmp = compareValues(aVal, bVal);
				if (cmp !== 0) return state.sortModel![i].sort === 'desc' ? -cmp : cmp;
			}
			return (sourceIndexOf.get(a.id) ?? 0) - (sourceIndexOf.get(b.id) ?? 0);
		};

		// Collect VisualRow objects and old indices for each changed node
		const toRelocate: Array<{ node: RowNode<TData>; vr: VisualRow<TData>; oldIdx: number }> = [];
		for (const node of changedNodes) {
			const oldIdx = this.rowIdToVisualIndex.get(node.id);
			if (oldIdx === undefined) continue; // was filtered out; stays filtered (sort-key can't change filter membership)
			const vr = this.visualRows[oldIdx];
			if (vr?.kind === 'data') toRelocate.push({ node, vr, oldIdx });
		}
		if (toRelocate.length === 0) return 0;

		// Remove in descending index order so prior splices don't shift remaining indices.
		// After sort, toRelocate[last].oldIdx is the smallest (earliest) affected position.
		toRelocate.sort((a, b) => b.oldIdx - a.oldIdx);
		const earliestRemovedIndex = toRelocate[toRelocate.length - 1].oldIdx;
		const mutable = this.visualRows.slice();
		for (const item of toRelocate) mutable.splice(item.oldIdx, 1);

		// Insert each row at its new sorted position; track earliest insertion index.
		let earliestInsertedIndex = mutable.length;
		for (const item of toRelocate) {
			let lo = 0,
				hi = mutable.length;
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				const midVR = mutable[mid];
				if (midVR?.kind !== 'data') {
					lo = mid + 1;
					continue;
				}
				if (compareNodes(item.node, midVR.node) <= 0) hi = mid;
				else lo = mid + 1;
			}
			mutable.splice(lo, 0, item.vr);
			if (lo < earliestInsertedIndex) earliestInsertedIndex = lo;
		}

		// Update maps in-place from the earliest affected index — no Map allocations.
		this.visualRows = mutable;
		const changedStartIndex = Math.min(earliestRemovedIndex, earliestInsertedIndex);
		this.reindexFrom(changedStartIndex);
		return changedStartIndex;
	}

	public replaceRowsStructurally(rows: readonly TData[]): RowModelWriteResult<TData> {
		this.dataStore.setRows(rows as TData[]);
		return { visualChange: 'full' };
	}

	public updateRowsStructurally(updater: (rows: TData[]) => TData[]): RowModelWriteResult<TData> {
		const result = this.dataStore.updateRows(updater);
		if (result.mismatch) {
			const current = this.dataStore.getAllNodes().map((n) => n.data);
			this.dataStore.setRows(updater(current));
			return { visualChange: 'full' };
		}
		return {
			updatedNodes: result.changedNodes,
			changedFieldsByRow: result.changedFieldsByRow,
			changedValuesByRow: result.changedValuesByRow,
			visualChange: result.changedNodes.length > 0 ? 'partial' : 'none',
		};
	}

	public applyTransactionStructurally(
		transaction: import('./api/GridApi.js').RowDataTransaction<TData>
	): RowModelWriteResult<TData> & InternalRowNodeTransaction<TData> {
		const result = this.dataStore.applyTransaction(transaction);
		const hasStructural = result.added.length > 0 || result.removed.length > 0;
		return {
			add: result.added,
			remove: result.removed,
			update: result.updated,
			addedNodes: result.added,
			removedNodes: result.removed,
			updatedNodes: result.updated,
			changedFieldsByRow: result.changedFieldsByRow,
			changedValuesByRow: result.changedValuesByRow,
			visualChange: hasStructural ? 'partial' : result.updated.length > 0 ? 'partial' : 'none',
		};
	}

	public writeCellValueStructurally(
		rowId: string,
		colField: string,
		value: unknown,
		options?: { bypassValueSetter?: boolean }
	): RowModelWriteResult<TData> {
		const node = this.getRowNodeById(rowId);
		if (!node) return { visualChange: 'none' };

		const col = this.runtime.getColumnDef(colField);
		const oldValue = this.runtime.getCellValue(rowId, colField);
		const updatedRow = { ...node.data };
		if (options?.bypassValueSetter === true) {
			setValueByPath(updatedRow, colField, value);
		} else if (col?.valueSetter) {
			const result = col.valueSetter({ value, oldValue, row: updatedRow, colField, abort: () => {} });
			if (result === false || (!(result instanceof Promise) && !result)) return { visualChange: 'none' };
		} else {
			setValueByPath(updatedRow, colField, value);
		}

		node.setData(updatedRow);

		return {
			updatedNodes: [node],
			changedFieldsByRow: new Map([[rowId, new Set([colField])]]),
			changedValuesByRow: new Map([[rowId, new Map([[colField, { oldValue, newValue: value }]])]]),
			visualChange: 'none',
		};
	}

	public reconcileAfterDataWrite(writeResult: RowModelWriteResult<TData>, impact: RowWriteImpact): RowModelRefreshResult {
		const inst = this.runtime.getInstrumentation();
		if (impact === 'insert' || impact === 'remove') {
			const previousRowCount = this.visualRows.length;
			const added = writeResult.addedNodes ?? [];
			const removed = writeResult.removedNodes ?? [];
			const changedStartIndex = this.tryIncrementalTransaction(added, removed);
			if (changedStartIndex !== null) {
				this.runtime.bumpGlobalVersion();
				inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL);
				return {
					changed: true,
					reason: 'row-order' as RowRefreshReason,
					previousRowCount,
					nextRowCount: this.visualRows.length,
					changedStartIndex,
					changedEndIndex: Math.max(changedStartIndex, this.visualRows.length - 1),
				};
			}
			inst.increment(GridMetric.ROW_MUTATION_FULL_REBUILD);
			return this.refresh('bulk');
		}
		if (writeResult.visualChange === 'full' || impact === 'full-rebuild') {
			inst.increment(GridMetric.ROW_MUTATION_FULL_REBUILD);
			return this.refresh('bulk');
		}
		if (impact === 'group-key' || impact === 'tree-parent' || impact === 'aggregation-input') {
			inst.increment(GridMetric.ROW_MUTATION_FULL_REBUILD);
			return this.refresh('bulk');
		}
		if (impact === 'sort-key') {
			const nodes = writeResult.updatedNodes ?? [];
			const changedStartIndex = nodes.length > 0 ? this.relocateSortedRows(nodes) : null;
			if (changedStartIndex !== null) {
				inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL);
				return {
					changed: true,
					reason: 'sort',
					layoutTransitionHint: 'live-reorder',
					changedStartIndex,
					changedEndIndex: Math.max(changedStartIndex, this.visualRows.length - 1),
				};
			}
			inst.increment(GridMetric.ROW_MUTATION_FULL_REBUILD);
			return this.refresh('sort' as RowRefreshReason);
		}
		if (impact === 'filter-key') {
			inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL);
			const nodes = writeResult.updatedNodes ?? [];
			const changed = nodes.length > 0 && this.filterMembershipChanged(nodes);
			return changed ? this.refresh('filter' as RowRefreshReason) : { changed: false };
		}
		inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL);
		return { changed: false };
	}

	/**
	 * Threshold (added + removed rows) above which a full pipeline rebuild is cheaper than
	 * incremental insert/remove into the visual array. Chosen empirically: below this threshold
	 * individual array splices + map rebuilds outperform a full O(N log N) sort.
	 */
	private static readonly INCREMENTAL_TX_LIMIT = 100;

	/**
	 * Returns false when the estimated reindex cost — proportional to the number of rows
	 * that must have their map entries updated — exceeds the rebuild threshold.
	 *
	 * Rule: if reindexing would touch more than INCREMENTAL_TX_LIMIT × 10 rows AND more than
	 * 40 % of the total visual model, a full O(N log N) pipeline rebuild is cheaper than
	 * the O(N - earliestChangedIndex) partial reindex.
	 */
	private static isIncrementalCheaper(totalVisualRows: number, earliestChangedIndex: number): boolean {
		const shiftCount = totalVisualRows - earliestChangedIndex;
		if (shiftCount <= ClientRowModelController.INCREMENTAL_TX_LIMIT * 10) return true;
		return shiftCount / totalVisualRows < 0.4;
	}

	/**
	 * Update map entries in-place for all rows from `start` to the end of `visualRows`.
	 * Avoids allocating new Map objects — preserves existing map identity and all entries
	 * before `start` (which are unaffected by the incremental operation).
	 * O(N - start) time; cheapest when the earliest changed index is near the end.
	 */
	private reindexFrom(start: number): void {
		for (let i = start; i < this.visualRows.length; i++) {
			const vr = this.visualRows[i];
			this.visualRowIdToIndex.set(vr.id, i);
			if (vr.kind === 'data') {
				this.rowIdToVisualIndex.set(vr.rowId, i);
				this.rowIdToVisualRowId.set(vr.rowId, vr.id);
			}
		}
	}

	/**
	 * Attempts to apply structural row mutations (adds/removes) incrementally on flat grids.
	 * Returns false to signal full rebuild is needed (grouped/tree/paginated grids, or when
	 * the transaction exceeds the INCREMENTAL_TX_LIMIT threshold).
	 */
	private tryIncrementalTransaction(added: RowNode<TData>[], removed: RowNode<TData>[]): number | null {
		const state = this.runtime.getState();
		if (state.groupBy?.length) return null;
		if (state.rowModelConfig?.treeData?.enabled) return null;
		if (state.rowModelConfig?.masterDetail?.enabled) return null;
		if (this._pageWindow !== null) return null;
		if (added.length + removed.length > ClientRowModelController.INCREMENTAL_TX_LIMIT) return null;

		const mutable = this.visualRows.slice();
		let earliestChangedIndex = mutable.length;

		// Removals: collect visual indices in descending order so splices don't shift later indices.
		// Delete stale map entries for removed rows before the splice.
		if (removed.length > 0) {
			const removalIndices: number[] = [];
			for (const node of removed) {
				const idx = this.rowIdToVisualIndex.get(node.id);
				if (idx !== undefined) {
					removalIndices.push(idx);
					this.rowIdToVisualIndex.delete(node.id);
					this.rowIdToVisualRowId.delete(node.id);
					this.visualRowIdToIndex.delete(toDataVisualRowId(node.id));
					this.dataRowCount--;
				}
			}
			removalIndices.sort((a, b) => b - a);
			for (const idx of removalIndices) mutable.splice(idx, 1);
			if (removalIndices.length > 0) {
				earliestChangedIndex = Math.min(earliestChangedIndex, removalIndices[removalIndices.length - 1]);
			}
		}

		// Additions: filter-check, then insert at sorted position (or append if unsorted).
		if (added.length > 0) {
			const preparedFilters = prepareFilters(state.columns, state.filterModel, state.quickFilterModel);
			const hasSort = !!(state.sortModel && state.sortModel.length > 0);

			let sortComparator: ((a: RowNode<TData>, b: RowNode<TData>) => number) | null = null;
			if (hasSort) {
				const columnById = createColumnLookup(state.columns);
				const sortGetters = state.sortModel!.map((sortItem) => {
					const col = columnById.get(sortItem.colId);
					if (col) {
						if (col.valueGetter) {
							const vg = col.valueGetter;
							return (node: RowNode<TData>): unknown =>
								vg({ node: createGridRowDataRef(node.id, node.data), row: node.data, colField: col.field });
						}
						const pg = compilePathGetter(col.field);
						return (node: RowNode<TData>): unknown => node.getCellValue(col.field, pg);
					}
					return (): undefined => undefined;
				});
				const allNodes = this.dataStore.getAllNodes();
				const sourceIndexOf = new Map<string, number>();
				for (let i = 0; i < allNodes.length; i++) sourceIndexOf.set(allNodes[i].id, i);

				sortComparator = (a: RowNode<TData>, b: RowNode<TData>): number => {
					for (let i = 0; i < state.sortModel!.length; i++) {
						const cmp = compareValues(sortGetters[i](a), sortGetters[i](b));
						if (cmp !== 0) return state.sortModel![i].sort === 'desc' ? -cmp : cmp;
					}
					return (sourceIndexOf.get(a.id) ?? 0) - (sourceIndexOf.get(b.id) ?? 0);
				};
			}

			for (const node of added) {
				if (preparedFilters.length > 0 && !nodeMatchesPreparedFilters(node, preparedFilters)) continue;

				const explicitHeight = (state.rowHeights as Record<string, number>)[node.id] ?? this.getRowHeight?.(node.data, node.id);
				const vr: VisualRow<TData> = {
					kind: 'data',
					id: toDataVisualRowId(node.id),
					rowId: node.id,
					node,
					depth: 0,
					height: explicitHeight !== undefined ? explicitHeight : state.defaultRowHeight,
					selectable: true,
					editable: true,
				};

				if (sortComparator) {
					let lo = 0,
						hi = mutable.length;
					while (lo < hi) {
						const mid = (lo + hi) >>> 1;
						const midVR = mutable[mid];
						if (midVR?.kind !== 'data') {
							lo = mid + 1;
							continue;
						}
						if (sortComparator(node, midVR.node) <= 0) hi = mid;
						else lo = mid + 1;
					}
					mutable.splice(lo, 0, vr);
					if (lo < earliestChangedIndex) earliestChangedIndex = lo;
				} else {
					earliestChangedIndex = Math.min(earliestChangedIndex, mutable.length);
					mutable.push(vr);
				}
				this.dataRowCount++;
			}
		}

		// Update maps in-place from the earliest affected index — preserves Map identity.
		this.visualRows = mutable;
		this.reindexFrom(earliestChangedIndex);
		return earliestChangedIndex === mutable.length ? 0 : earliestChangedIndex;
	}

	public captureTransactionSnapshot = (
		_mutation: import('./engine/GridDomainMutation.js').RowTransactionMutation<TData>
	): RowModelTransactionSnapshot<TData> => {
		return {
			modelType: 'client',
			snapshot: {
				dataStore: this.dataStore.captureTransactionSnapshot(),
			},
		};
	};

	public restoreTransactionSnapshot = (snapshot: RowModelTransactionSnapshot<TData>): void => {
		if (snapshot.modelType !== 'client') {
			throw new Error(`Wit Grid: cannot restore ${snapshot.modelType} snapshot into client row model.`);
		}
		const clientSnapshot = snapshot as ClientRowModelTransactionSnapshot<TData>;
		this.dataStore.restoreTransactionSnapshot(clientSnapshot.snapshot.dataStore);
		this.runtime.clearFormulas();
		this.refresh('bulk');
	};

	public getVisualRow = (index: number): VisualRow<TData> | null => {
		return this.visualRows[index] ?? null;
	};

	public getVisualRowCount = (): number => {
		return this.visualRows.length;
	};

	public getKnownRowCount = (): number | null => {
		return this.visualRows.length;
	};

	public getEstimatedRowCount = (): number => {
		return this.visualRows.length;
	};

	public getRowCountKind = (): RowCountKind => {
		return 'known';
	};

	public getVisualIndexById = (visualRowId: string): number => {
		const idx = this.visualRowIdToIndex.get(visualRowId);
		return idx !== undefined ? idx : -1;
	};

	public getVisualIndexByRowId = (rowId: string): number => {
		const idx = this.rowIdToVisualIndex.get(rowId);
		return idx !== undefined ? idx : -1;
	};

	public getRow = (index: number): TData | null => {
		const row = this.getVisualRow(index);
		return row?.kind === 'data' ? row.node.data : null;
	};

	public getRowNode = (index: number): RowNode<TData> | null => {
		const row = this.getVisualRow(index);
		return row?.kind === 'data' ? row.node : null;
	};

	public getRowIndexById = (rowId: string): number => {
		return this.getVisualIndexByRowId(rowId);
	};

	public getRowLoadState = (index: number): RowLoadState => {
		const row = this.getVisualRow(index);
		if (!row) return { kind: 'missing' };
		if (row.kind === 'data') return { kind: 'loaded', rowId: row.rowId };
		return { kind: 'loaded', rowId: row.id };
	};

	public isRowLoaded = (index: number): boolean => {
		return this.getRowLoadState(index).kind === 'loaded';
	};

	public isRowLoading = (_index: number): boolean => {
		return false;
	};

	public isRowFailed = (_index: number): boolean => {
		return false;
	};

	public isRangeLoaded = (startRow: number, endRow: number): boolean => {
		if (startRow > endRow) return true;
		for (let index = startRow; index <= endRow; index++) {
			if (!this.isRowLoaded(index)) return false;
		}
		return true;
	};

	public getRangeLoadState = (startRow: number, endRow: number): RowRangeLoadState => {
		const state: RowRangeLoadState = { loaded: 0, loading: 0, failed: 0, placeholder: 0, missing: 0 };
		if (startRow > endRow) return state;
		for (let index = startRow; index <= endRow; index++) {
			const rowState = this.getRowLoadState(index);
			state[rowState.kind]++;
		}
		return state;
	};

	public ensureRange = (_startRow: number, _endRow: number, _reason?: string): void => {};

	public getDataRowById = (rowId: string): TData | null => {
		return this.getRawRowById(rowId);
	};

	public getRowNodeById = (rowId: string): RowNode<TData> | null => {
		return this.dataStore.getNode(rowId);
	};

	public getRawRowById = (rowId: string): TData | null => {
		return this.dataStore.getNode(rowId)?.data ?? null;
	};

	public getAllDataNodes = (): RowNode<TData>[] => this.dataStore.getAllNodes();

	/** Returns all nodes that currently pass the active filter (post-sort). With client pagination, returns only the current page. */
	public getFilteredDataNodes = (): RowNode<TData>[] => {
		const result: RowNode<TData>[] = [];
		for (const vr of this.visualRows) {
			if (vr.kind === 'data' && vr.node.data != null) result.push(vr.node);
		}
		return result;
	};

	/** Returns nodes on the current page. Without pagination, identical to getFilteredDataNodes(). */
	public getCurrentPageDataNodes = (): RowNode<TData>[] => this.getFilteredDataNodes();

	public getRowOrder = (): string[] => this.dataStore.getSourceOrder();

	public setRowOrder = (rowIds: string[]): void => {
		this.dataStore.setRowOrder(rowIds);
		this.refresh('row-order');
	};

	public getSelectableDataRowIds = (scope: RowSelectionScope = 'page'): string[] => {
		if (scope === 'all') {
			return this.dataStore.getAllNodes().map((node) => node.id);
		}
		if (scope === 'filtered') {
			const state = this.runtime.getState();
			const expansion = state.expansion;
			const rowModelConfig: RowModelConfig<TData> | undefined =
				state.rowModelConfig ??
				(state.groupBy?.length || state.getParentId || state.masterDetailEnabled
					? {
							type: 'client',
							grouping: state.groupBy?.length
								? { model: state.groupBy.map((colId) => ({ colId })), includeFooter: !!state.showGroupFooter }
								: undefined,
							treeData: state.getParentId ? { enabled: true, getParentId: state.getParentId } : undefined,
							masterDetail: state.masterDetailEnabled
								? {
										enabled: true,
										expandedRowIds: expansion.details,
										defaultDetailHeight: state.detailRowHeight,
									}
								: undefined,
						}
					: undefined);
			const result = this.pipeline.run({
				nodes: this.dataStore.getAllNodes(),
				columns: state.columns,
				sortModel: state.sortModel,
				filterModel: state.filterModel,
				quickFilterModel: state.quickFilterModel,
				queryModel: state.queryModel,
				groupBy: state.groupBy,
				rowModelConfig,
				getParentId: state.getParentId,
				aggDefs: state.aggDefs ?? [],
				expandedGroupIds: new Set(Object.keys(expansion.groups)),
				expandedTreeRowIds: new Set(Object.keys(expansion.treeRows)),
				expandedDetailRowIds: new Set(Object.keys(expansion.details)),
				defaultRowHeight: state.defaultRowHeight,
				rowHeightsRecord: state.rowHeights,
				getRowHeight: this.getRowHeight,
				groupRowHeight: state.groupRowHeight,
				detailRowHeight: state.detailRowHeight,
				masterDetailEnabled: state.masterDetailEnabled,
				detailRenderer: state.detailRenderer,
				reportFault: this.runtime.reportRowPipelineFault,
			});
			return result.visualRows.flatMap((row) => (row.kind === 'data' ? [row.rowId] : []));
		}
		const ids: string[] = [];
		for (const row of this.visualRows) {
			if (row?.kind === 'data') ids.push(row.rowId);
		}
		return ids;
	};

	public refresh(reason?: RowRefreshReason, groupId?: string): RowModelRefreshResult {
		const state = this.runtime.getState();
		const previousRows = this.visualRows;

		const expansion = state.expansion;
		const rowModelConfig: RowModelConfig<TData> | undefined =
			state.rowModelConfig ??
			(state.groupBy?.length || state.getParentId || state.masterDetailEnabled
				? {
						type: 'client',
						grouping: state.groupBy?.length
							? { model: state.groupBy.map((colId) => ({ colId })), includeFooter: !!state.showGroupFooter }
							: undefined,
						treeData: state.getParentId ? { enabled: true, getParentId: state.getParentId } : undefined,
						masterDetail: state.masterDetailEnabled
							? {
									enabled: true,
									expandedRowIds: expansion.details,
									defaultDetailHeight: state.detailRowHeight,
								}
							: undefined,
					}
				: undefined);

		const result = this.pipeline.run({
			nodes: this.dataStore.getAllNodes(),
			columns: state.columns,
			sortModel: state.sortModel,
			filterModel: state.filterModel,
			quickFilterModel: state.quickFilterModel,
			queryModel: state.queryModel,
			groupBy: state.groupBy,
			rowModelConfig,
			getParentId: state.getParentId,
			aggDefs: state.aggDefs ?? [],
			expandedGroupIds: new Set(Object.keys(expansion.groups)),
			expandedTreeRowIds: new Set(Object.keys(expansion.treeRows)),
			expandedDetailRowIds: new Set(Object.keys(expansion.details)),
			defaultRowHeight: state.defaultRowHeight,
			rowHeightsRecord: state.rowHeights,
			getRowHeight: this.getRowHeight,
			groupRowHeight: state.groupRowHeight,
			detailRowHeight: state.detailRowHeight,
			masterDetailEnabled: state.masterDetailEnabled,
			detailRenderer: state.detailRenderer,
			reportFault: this.runtime.reportRowPipelineFault,
			// Client pagination: slice happens inside the pipeline so every derived
			// map/meta/geometry stays page-consistent. Undefined → full list.
			pagination: state.pagination ? { pageSize: state.pagination.pageSize, page: state.pagination.page ?? 0 } : undefined,
		});
		const { visualRows } = result;
		const refreshResult = describeVisualRowDiff(previousRows, visualRows, reason, groupId);

		this.visualRows = visualRows;
		this._pageWindow = result.pageWindow ?? null;
		this.visualRowIdToIndex = result.visualRowIdToIndex;
		this.rowIdToVisualIndex = result.rowIdToVisualIndex;
		this.rowIdToVisualRowId = result.rowIdToVisualRowId;
		this.rowIdToVisualRowIds = result.rowIdToVisualRowIds;
		this._stickyGroupMeta = result.stickyGroupMeta;
		this._groupMeta = result.groupMeta;
		this._groupMetaByVisualIndex = result.groupMetaByVisualIndex;
		this.dataRowCount = result.stats.totalDataRows;

		this.runtime.bumpGlobalVersion();

		return refreshResult;
	}
}
