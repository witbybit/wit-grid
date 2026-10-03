import { type ColumnDef, setValueByPath, compilePathGetter } from './columnDef.js';
import { GridEventName } from './api/GridEvents.js';
import type { RowDataTransaction, RowSelectionScope } from './api/GridApi.js';
import type { ClientRowModelRuntime } from './engine/runtimePorts.js';
import { GridMetric } from './diagnostics/GridInstrumentation.js';
import { getFieldRoot } from './ids.js';
import { createGridRowDataRef } from './publicRowRef.js';
import type { RowNode } from './rowNode.js';
import type { InternalRowNodeTransaction } from './rowTransactions.js';
import type { AsyncRowModelRequestIdentity } from './asyncRowModelRequestIdentity.js';
import { RowPipeline, type RowPipelineInput } from './rows/RowPipeline.js';
import { groupByColIds, isGroupingActive, normalizeGroupDefs } from './rows/hierarchyConfig.js';
import { findTreeNode, resolveNodeExpanded } from './rows/stages/flattenStage.js';
import type { RowTreeNode } from './rows/stages/types.js';
import { HierarchyIndex } from './rows/hierarchyIndex.js';
import { FlatTotals } from './rows/flatTotals.js';
import { IncrementalRowIndex } from './rows/incrementalRowIndex.js';
import { RowDependencyRegistry, classifyMutation, mutationAffectsSortKeys, type RowMutationImpact } from './rows/rowMutationClassifier.js';
import { compareSortKeys, toSortKey, type SortKey } from './rows/sortKeys.js';
import type { PageWindow } from './rows/pageModel.js';
import { RowDataStore } from './rows/RowDataStore.js';
import type { RowDataStoreTransactionSnapshot } from './rows/RowDataStore.js';
import { rowIdFromDataVisualRowId, toDataVisualRowId, toTotalVisualRowId } from './rows/visualRowIds.js';
import { FLAT_HIERARCHY, type VisualRow } from './visualRow.js';
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
import type { RowTransactionMutation } from './engine/GridDomainMutation.js';
import type { InfiniteDatasource } from './infiniteRowModel.js';
import type { ServerSideDatasource, ServerSideRefreshOptions, ServerSideStoreSnapshot } from './serverSideRowModel.js';

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

export type { GroupDef } from './rows/RowPipeline.js';

/** True when the visual rows include anything besides flat data rows (groups, tree rows, details, totals). */
function hasHierarchyRows(state: {
	grouping?: { by: readonly unknown[] };
	treeData?: unknown;
	detail?: unknown;
	aggregation?: { defs: readonly unknown[] };
}): boolean {
	return (state.grouping?.by.length ?? 0) > 0 || !!state.treeData || !!state.detail || (state.aggregation?.defs.length ?? 0) > 0;
}
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
	/** When the changed rows are a few disjoint spans: each of them, ascending (the start/end above are their union). */
	changedRanges?: ReadonlyArray<{ startIndex: number; endIndex: number }>;
	/** Rows only swapped places among rows of one height: row geometry needs no re-sync. */
	heightsUnchanged?: boolean;
	groupId?: string;
	/**
	 * Rows outside the changed range that kept their identity but whose aggregates changed (group,
	 * total and tree-parent rows after a write to an aggregated column), ascending. They repaint too.
	 */
	aggregateChangedIndices?: number[];
}

export interface ExpandAllOptions {
	/** Open levels up to and including this one (0 = outermost) and close deeper ones. Default: every level. */
	maxLevel?: number;
}

export interface SetExpandedOptions {
	/** Also open or close every group and tree row beneath the row. Default: false. */
	deep?: boolean;
}

/** Expansion for groups and tree rows (by visual row id) and detail rows (by row id). */
export interface RowExpansionCapableModel<TRowData = unknown> {
	setExpanded(id: string, expanded: boolean, options?: SetExpandedOptions): RowModelRefreshResult | void;
	expandAll(options?: ExpandAllOptions): RowModelRefreshResult | void;
	collapseAll(): RowModelRefreshResult | void;
	setDetailOpen(rowId: string, open: boolean): RowModelRefreshResult | void;
}

export interface RowExpansionStateReadableModel {
	isExpanded(id: string): boolean;
	isDetailOpen(rowId: string): boolean;
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
	/** Number of source rows, without copying the order. */
	getSourceRowCount(): number;
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
	captureTransactionSnapshot(mutation: RowTransactionMutation<TRowData>): RowModelTransactionSnapshot<TRowData>;
	restoreTransactionSnapshot(snapshot: RowModelTransactionSnapshot<TRowData>): void;
	replaceRowsStructurally(rows: readonly TRowData[]): RowModelWriteResult<TRowData>;
	applyTransactionStructurally(transaction: RowDataTransaction<TRowData>): RowModelWriteResult<TRowData> & InternalRowNodeTransaction<TRowData>;
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
	return rowModel?.kind === 'client' ? (rowModel as unknown as ClientStructuralRowModel<TRowData>) : null;
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
	setDatasource(datasource: InfiniteDatasource<TRowData>, blockSize?: number): void;
}

/** Capability interface for the real server-side row model (SSRM). */
export interface ServerSideControllableRowModel<TRowData = unknown> {
	setServerSideDatasource(datasource: ServerSideDatasource<TRowData>): void;
	refreshServerSide(options?: ServerSideRefreshOptions): void;
	purgeServerSide(options?: Omit<ServerSideRefreshOptions, 'purge'>): void;
	getServerSideStoreState(): readonly ServerSideStoreSnapshot[];
}

export interface VisibleBlockLoadCapableRowModel {
	loadVisibleBlocks(startRow: number, endRow: number): void;
}

export interface RowModelTransactionSnapshot<TRowData = unknown> {
	readonly modelType: string;
	readonly snapshot: unknown;
}

/** Shared row-model contract used across engine and rendering code. */
/** Which row model this is: client-side rows, infinite blocks, or the server-side row model. */
export type RowModelKind = 'client' | 'infinite' | 'server';

export interface RowModel<TRowData = unknown> extends RowModelViewportAccess<TRowData> {
	readonly kind: RowModelKind;
	refresh(reason?: RowRefreshReason): RowModelRefreshResult;
	/** The height every visual row has (`row.height ?? defaultRowHeight`), or null when they differ. */
	getUniformRowHeight?(defaultRowHeight: number): number | null;
}

function hasFunctions(value: unknown, names: readonly string[]): boolean {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
	const record = value as Record<string, unknown>;
	return names.every((name) => typeof record[name] === 'function');
}

export function asRowExpansionCapableModel<TRowData = unknown>(rowModel: RowModel<TRowData> | null): RowExpansionCapableModel<TRowData> | null {
	return hasFunctions(rowModel, ['setExpanded', 'expandAll', 'collapseAll', 'setDetailOpen'])
		? (rowModel as unknown as RowExpansionCapableModel<TRowData>)
		: null;
}

/** Row models that know the full hierarchy (collapsed subtrees included). */
export interface RowHierarchyReadableModel {
	getHierarchyIndex(): HierarchyIndex | null;
}

export function asRowHierarchyReadableModel(rowModel: RowModel<unknown> | null): RowHierarchyReadableModel | null {
	return hasFunctions(rowModel, ['getHierarchyIndex']) ? (rowModel as unknown as RowHierarchyReadableModel) : null;
}

export function asRowExpansionStateReadableModel(rowModel: RowModel<unknown> | null): RowExpansionStateReadableModel | null {
	return hasFunctions(rowModel, ['isExpanded', 'isDetailOpen']) ? (rowModel as unknown as RowExpansionStateReadableModel) : null;
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
	return rowModel?.kind === 'infinite' ? (rowModel as unknown as InfiniteControllableRowModel<TRowData>) : null;
}

export function asServerSideControllableRowModel<TRowData = unknown>(
	rowModel: RowModel<TRowData> | null
): ServerSideControllableRowModel<TRowData> | null {
	return rowModel?.kind === 'server' ? (rowModel as unknown as ServerSideControllableRowModel<TRowData>) : null;
}

export function asStickyGroupMetaCapableVisualRowModel(rowModel: VisualRowModel<unknown> | null): StickyGroupMetaCapableVisualRowModel | null {
	return hasFunctions(rowModel, ['getStickyGroupMeta']) ? (rowModel as unknown as StickyGroupMetaCapableVisualRowModel) : null;
}

export interface GroupRowMeta {
	groupId: string;
	visualIndex: number;
	level: number;
	parentGroupId: string | null;
	/** Index of the first child visual row (group or data), or -1 if collapsed. */
	firstChildIndex: number;
	/** Index of the last child visual row (group or data), or -1 if collapsed. */
	lastChildIndex: number;
	firstLeafIndex: number;
	lastLeafIndex: number;
	/** rowIds of all visible (non-collapsed) data rows beneath this group. */
	/** groupIds of immediate child group rows that are visible. */
	childGroupIds: string[];
	leafCount: number;
	childCount: number;
	expanded: boolean;
	aggregates: Record<string, unknown>;
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
	/** Per getter: whether its lowercased text may be cached per row (plain-field columns only). */
	cacheable: boolean[];
	/** Identifies the target column set; a cached row entry is reused only for the same signature. */
	signature: string;
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
		return matchQuickFilter(node, pf);
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

function rowAggregates<TData>(row: VisualRow<TData>): Record<string, unknown> | undefined {
	return row.kind === 'group' || row.kind === 'total' || row.kind === 'data' ? row.aggregates : undefined;
}

function sameRowAggregates<TData>(left: VisualRow<TData>, right: VisualRow<TData>): boolean {
	const a = rowAggregates(left);
	const b = rowAggregates(right);
	if (a === b) return true;
	if (!a || !b) return false;
	let count = 0;
	for (const key in a) {
		if (!Object.is(a[key], b[key])) return false;
		count++;
	}
	return count === Object.keys(b).length;
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

	const structural = previousRows.length !== nextRows.length || prefix < previousRows.length || prefix < nextRows.length;
	const changedEndIndex = structural ? Math.max(previousRows.length, nextRows.length) - suffix - 1 : undefined;

	// Rows that kept their place (the identical prefix and suffix) may still carry new aggregates.
	let aggregateChangedIndices: number[] | undefined;
	const noteAggregateChange = (prev: VisualRow<TData>, next: VisualRow<TData>, index: number) => {
		if (!sameRowAggregates(prev, next)) (aggregateChangedIndices ??= []).push(index);
	};
	for (let i = 0; i < prefix; i++) noteAggregateChange(previousRows[i], nextRows[i], i);
	for (let k = suffix - 1; k >= 0; k--) {
		noteAggregateChange(previousRows[previousRows.length - 1 - k], nextRows[nextRows.length - 1 - k], nextRows.length - 1 - k);
	}

	return {
		changed: structural || aggregateChangedIndices !== undefined,
		aggregateChangedIndices,
		reason,
		previousRowCount: previousRows.length,
		nextRowCount: nextRows.length,
		changedStartIndex: structural ? prefix : undefined,
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
		// Plain-field columns read node-cached values that only change with node.data, so their
		// lowercased text can be cached per row. valueGetter columns may be impure: never cached.
		cacheable: targetColumns.map((column) => !column.valueGetter),
		signature: targetColumns.map((column) => (column.valueGetter ? '' : column.field)).join('\u0000'),
	};
}

interface QuickFilterTextCacheEntry {
	data: unknown;
	signature: string;
	lowered: Array<string | undefined>;
}

/**
 * Per-row lowercased quick-filter text, so each keystroke does not re-run
 * `String().toLowerCase()` for rows × columns. An entry is valid while the row's data
 * reference (rows are replaced immutably) and the target column set are unchanged.
 */
const quickFilterTextCache = new WeakMap<RowNode<unknown>, QuickFilterTextCacheEntry>();

function matchQuickFilter<TData>(node: RowNode<TData>, pf: PreparedQuickFilter<TData>): boolean {
	const getters = pf.getters;
	let entry = quickFilterTextCache.get(node as RowNode<unknown>);
	if (!entry || entry.data !== node.data || entry.signature !== pf.signature) {
		entry = { data: node.data, signature: pf.signature, lowered: new Array(getters.length) };
		quickFilterTextCache.set(node as RowNode<unknown>, entry);
	}
	const lowered = entry.lowered;
	for (let i = 0; i < getters.length; i++) {
		let text: string;
		if (pf.cacheable[i]) {
			const cached = lowered[i];
			text = cached !== undefined ? cached : (lowered[i] = String(getters[i](node) ?? '').toLowerCase());
		} else {
			text = String(getters[i](node) ?? '').toLowerCase();
		}
		if (text.includes(pf.textValue)) return true;
	}
	return false;
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
	const matches = createClientFilterPredicate(columns, filterModel, quickFilterModel);
	return matches ? nodes.filter(matches) : nodes;
}

/**
 * The single-row form of `applyClientFilterOnly`: whether one node passes the column filters and the
 * quick filter. Null when no filter is active (every node passes).
 */
export function createClientFilterPredicate<TData>(
	columns: Array<ColumnDef<TData>>,
	filterModel: FilterModel | null | undefined,
	quickFilterModel?: QuickFilterModel | null
): ((node: RowNode<TData>) => boolean) | null {
	const preparedFilters = prepareFilters(columns, filterModel, quickFilterModel);
	if (preparedFilters.length === 0) return null;
	return (node) => nodeMatchesPreparedFilters(node, preparedFilters);
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
					// A direct read, as the pipeline's readers do: the per-node cache costs more than it saves.
					const pathGetter = compilePathGetter(column.field) as (data: TData) => unknown;
					getter = (node: RowNode<TData>) => pathGetter(node.data);
				}
			} else {
				getter = () => undefined;
			}
			return getter;
		});

		// One all-numeric column: sort the numbers directly (ties in source order, as below).
		if (sortModel.length === 1) {
			const sorted = sortByNumber(result, precompiledSortGetters[0], sortModel[0].sort === 'desc');
			if (sorted) return sorted;
		}

		// Schwartzian transform: extract sort keys in O(N) using pre-allocated arrays to minimize allocation overhead
		// Keys carry their Number()/String() coercions so the comparator never re-coerces.
		const sortData = result.map((item) => {
			const keys: SortKey[] = new Array(sortModel.length);
			for (let i = 0; i < sortModel.length; i++) {
				keys[i] = toSortKey(precompiledSortGetters[i](item.node));
			}
			return { item, keys };
		});

		sortData.sort((left, right) => {
			for (let i = 0; i < sortModel.length; i++) {
				const sortItem = sortModel[i];
				const comparison = compareSortKeys(left.keys[i], right.keys[i]);
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

/** The data rows' span of a flat list: after its top totals, before its bottom totals. */
function dataBounds<TData>(rows: readonly VisualRow<TData>[]): [number, number] {
	let start = 0;
	while (start < rows.length && rows[start].kind === 'total' && (rows[start] as { placement?: string }).placement === 'top') start++;
	let end = rows.length;
	while (end > start && rows[end - 1].kind === 'total' && (rows[end - 1] as { placement?: string }).placement === 'bottom') end--;
	return [start, end];
}

/** Null unless every value is a number (not NaN); `items` are in source order. */
function sortByNumber<TItem extends { node: RowNode<TData> }, TData>(
	items: TItem[],
	read: (node: RowNode<TData>) => unknown,
	desc: boolean
): TItem[] | null {
	const n = items.length;
	const values = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const value = read(items[i].node);
		if (typeof value !== 'number' || value !== value) return null;
		values[i] = value;
	}
	const order: number[] = new Array(n);
	for (let i = 0; i < n; i++) order[i] = i;
	if (desc) order.sort((a, b) => values[b] - values[a] || a - b);
	else order.sort((a, b) => values[a] - values[b] || a - b);
	const out: TItem[] = new Array(n);
	for (let i = 0; i < n; i++) out[i] = items[order[i]];
	return out;
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
	public readonly kind = 'client' as const;
	private readonly runtime: ClientRowModelRuntime<TData>;
	private dataStore: RowDataStore<TData>;
	private readonly getRowHeight: ClientRowModelOptions<TData>['getRowHeight'];
	private visualRows: Array<VisualRow<TData>> = [];
	private visualRowIdToIndex = new Map<string, number>();
	/**
	 * Data rows are located by `RowNode.visualIndex` (see {@link stampRowPositions}). Set once the
	 * incremental index has moved data rows: it does not keep those fields (a group that grows would
	 * shift every later row), so rows are found through the index, and re-stamped only if something
	 * else needs them.
	 */
	private rowIndexStale = false;
	private rowIdToVisualRowIds: Map<string, string[]> | undefined;
	private dataRowCount = 0;
	private unsubscribers: Array<() => void> = [];

	private pipeline = new RowPipeline<TData>();
	readonly dependencyRegistry = new RowDependencyRegistry<TData>();
	private _stickyGroupMeta = new Map<number, number>();
	private _groupMeta = new Map<string, GroupRowMeta>();
	private _groupMetaByVisualIndex = new Map<number, GroupRowMeta>();
	private _pageWindow: PageWindow | null = null;
	private _roots: RowTreeNode<TData>[] | null = null;
	private _hierarchyIndex: HierarchyIndex | null = null;
	/** The incremental row index for the last full run: undefined = not built yet, null = not applicable. */
	private _incremental: IncrementalRowIndex<TData> | null | undefined = undefined;
	/** A flat grid's grand total kept by deltas (undefined: not built since the last full run; null: not possible). */
	private _flatTotals: FlatTotals<TData> | null | undefined = undefined;
	/** Cached {@link getUniformRowHeight} answer (undefined: not known) and the default it was read with. */
	private _uniformHeight: number | null | undefined = undefined;
	private _uniformHeightDefault = NaN;
	/** The configuration the last full run saw; the index is only valid while it is unchanged. */
	private _incrementalSeed: Record<string, unknown> | null = null;

	/** Built on first use after each pipeline run that produced a row tree. */
	public getHierarchyIndex = (): HierarchyIndex | null => {
		if (!this._roots) return null;
		return (this._hierarchyIndex ??= new HierarchyIndex(this._roots as RowTreeNode<unknown>[]));
	};

	public getStickyGroupMeta = (): Map<number, number> => this._stickyGroupMeta;
	public getPageWindow = (): PageWindow | null => this._pageWindow;
	public getGroupMeta = (groupId: string): GroupRowMeta | null => this._groupMeta.get(groupId) ?? null;
	public getGroupMetaByVisualIndex = (visualIndex: number): GroupRowMeta | null => this._groupMetaByVisualIndex.get(visualIndex) ?? null;

	public getDataRowCount = (): number => this.dataRowCount;

	public getCapabilities(): RowModelCapabilities {
		return CLIENT_CAPABILITIES;
	}

	private dataRowIndex(rowId: string): number | undefined {
		if (this.rowIndexStale && this._incremental) return this._incremental.visualIndexOfRow(rowId, this.visualRows, this.visualRowIdToIndex);
		const node = this.dataStore.getNode(rowId);
		return node ? this.nodeIndex(node) : undefined;
	}

	/** The node's data row index, or undefined when it has none (filtered out, collapsed, removed). */
	private nodeIndex(node: RowNode<TData>): number | undefined {
		this.ensureRowPositions();
		const at = node.visualIndex;
		const row = this.visualRows[at];
		return row?.kind === 'data' && row.node === node ? at : undefined;
	}

	/** Re-stamps every row after incremental moves, for the paths that read or patch positions directly. */
	private ensureRowPositions(): void {
		if (!this.rowIndexStale) return;
		this.rowIndexStale = false;
		this.stampRowPositions(0);
	}

	/**
	 * Records each data row's index on its node from `start` through `end` (default: the last row; the
	 * first occurrence wins), and group, total and detail rows' indices by visual id. O(end - start),
	 * plain field writes for data rows.
	 */
	private stampRowPositions(start: number, end = this.visualRows.length - 1): void {
		const rows = this.visualRows;
		for (let i = start; i <= end; i++) {
			const row = rows[i];
			if (row.kind !== 'data') {
				this.visualRowIdToIndex.set(row.id, i);
				continue;
			}
			const prior = row.node.visualIndex;
			const priorRow = prior >= 0 && prior < i ? rows[prior] : undefined;
			if (priorRow?.kind === 'data' && priorRow.node === row.node) continue;
			row.node.visualIndex = i;
		}
	}

	/** A visual row's index: group/total/detail rows by visual id, data rows through their row id. */
	private visualIndexOf(visualRowId: string): number | undefined {
		const index = this.visualRowIdToIndex.get(visualRowId);
		if (index !== undefined) return index;
		const rowId = rowIdFromDataVisualRowId(visualRowId);
		if (rowId === null) return undefined;
		const at = this.dataRowIndex(rowId);
		return at !== undefined && this.visualRows[at]?.id === visualRowId ? at : undefined;
	}

	public isExpanded = (id: string): boolean => {
		const index = this.visualIndexOf(id);
		const row = index === undefined ? undefined : this.visualRows[index];
		if (row) return row.hierarchy.expanded;
		// Not displayed (under a collapsed ancestor, filtered out or on another page).
		const state = this.runtime.getState();
		const found = this._roots ? findTreeNode(this._roots, id) : null;
		if (!found) return state.expansion.rows[id] ?? false;
		return resolveNodeExpanded(found.node, found.level, {
			expansion: state.expansion,
			groupDefaultExpanded: state.grouping?.defaultExpanded,
			treeDefaultExpanded: state.treeData?.defaultExpanded,
		});
	};

	public setExpanded = (id: string, expanded: boolean, options?: SetExpandedOptions): RowModelRefreshResult => {
		const below = options?.deep ? (this.getHierarchyIndex()?.getDescendantContainerIds(id) ?? []) : [];
		if (below.length > 0) {
			// One write for the whole subtree, so one refresh.
			this.runtime.updateExpansion((expansion) => {
				const rows = { ...expansion.rows, [id]: expanded };
				for (const childId of below) rows[childId] = expanded;
				return { ...expansion, rows };
			});
			return this.refresh('expansion', id);
		}
		if (this.isExpanded(id) === expanded) return { changed: false };
		this.runtime.updateExpansion((expansion) => ({ ...expansion, rows: { ...expansion.rows, [id]: expanded } }));
		return this.refresh('expansion', id);
	};

	/** `base` replaces every explicit choice, so this is O(1) however many rows the tree holds. */
	public expandAll = (options?: ExpandAllOptions): RowModelRefreshResult => {
		const base = options?.maxLevel === undefined ? true : Math.max(0, options.maxLevel + 1);
		this.runtime.updateExpansion((expansion) => ({ ...expansion, base, rows: {} }));
		return this.refresh('expansion');
	};

	public collapseAll = (): RowModelRefreshResult => {
		this.runtime.updateExpansion((expansion) => ({ ...expansion, base: false, rows: {} }));
		return this.refresh('expansion');
	};

	/** Every row of the hierarchy with all groups and tree rows expanded, and no detail rows (export). */
	public getHierarchyExportRows = (): VisualRow<TData>[] | null => {
		if (!this._roots) return null;
		const input = this.buildPipelineInput(this.runtime.getState(), false);
		// A separate pipeline: the live one's version and caches are untouched.
		return new RowPipeline<TData>().run({ ...input, detail: undefined, expansion: { rows: {}, details: {}, base: true } }).visualRows;
	};

	public isDetailOpen = (rowId: string): boolean => {
		return !!this.runtime.getState().expansion.details[rowId];
	};

	public setDetailOpen = (rowId: string, open: boolean): RowModelRefreshResult => {
		const state = this.runtime.getState();
		if (this.isDetailOpen(rowId) === open) return { changed: false };
		if (open) {
			const detail = state.detail;
			const node = this.dataStore.getNode(rowId);
			if (!detail || !node || (detail.isMaster && !detail.isMaster(node.data, rowId))) return { changed: false };
		}
		this.runtime.updateExpansion((expansion) => {
			const details = { ...expansion.details };
			if (open) details[rowId] = true;
			else delete details[rowId];
			return { ...expansion, details };
		});
		return this.refresh('detail');
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
			// Every hierarchy configuration change: grouping (its levels included), tree data, aggregation, detail.
			...[GridEventName.groupingChanged, GridEventName.treeDataChanged, GridEventName.aggregationChanged, GridEventName.detailChanged].map(
				(event) =>
					this.runtime.addEventListener(event, () => {
						this.rebuildDependencyRegistry();
						this.refresh();
					})
			),
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
			groupBy: groupByColIds(state.grouping),
			aggDefs: state.aggregation?.defs,
			hasTreeParent: !!state.treeData,
			treeParentDependencies: state.treeData?.getParentIdDependencies,
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
		if (isGroupingActive(state.grouping) || state.treeData) return true;
		const preparedFilters = prepareFilters(state.columns, state.filterModel, state.quickFilterModel);
		for (const node of changedNodes) {
			const wasVisible = this.nodeIndex(node) !== undefined;
			const passes = preparedFilters.length === 0 || nodeMatchesPreparedFilters(node, preparedFilters);
			if (wasVisible !== passes) return true;
		}
		return false;
	}

	/**
	 * Builds the comparator the incremental paths binary-search with. It mirrors the pipeline's
	 * flat sort (same getters, same comparison, source order as the stable tiebreak) and reads the
	 * tiebreak from the store's cached source index, so no O(n) structure is built per call.
	 * `compareToNode(a)` precomputes `a`'s keys once and returns `(b) => compare(a, b)`.
	 */
	private createIncrementalSortComparator(
		columns: Array<ColumnDef<TData>>,
		sortModel: SortModel
	): (a: RowNode<TData>) => (b: RowNode<TData>) => number {
		const columnById = createColumnLookup(columns);
		const sortGetters = sortModel.map((sortItem) => {
			const col = columnById.get(sortItem.colId);
			return col ? makeGetter(col) : (): undefined => undefined;
		});
		const descending = sortModel.map((sortItem) => sortItem.sort === 'desc');
		const dataStore = this.dataStore;
		return (a) => {
			const aKeys = sortGetters.map((getter) => toSortKey(getter(a)));
			const aSourceIndex = dataStore.getSourceIndex(a.id) ?? 0;
			return (b) => {
				for (let i = 0; i < aKeys.length; i++) {
					const cmp = compareSortKeys(aKeys[i], toSortKey(sortGetters[i](b)));
					if (cmp !== 0) return descending[i] ? -cmp : cmp;
				}
				return aSourceIndex - (dataStore.getSourceIndex(b.id) ?? 0);
			};
		};
	}

	/**
	 * Incrementally repositions changed rows within the sorted visual array, avoiding a full
	 * pipeline rebuild. Only applicable to flat (non-grouped, non-tree) grids with an active sort
	 * and no pagination. Returns false to signal that the caller must fall back to full refresh.
	 */
	private relocateSortedRows(changedNodes: RowNode<TData>[]): number | null {
		const state = this.runtime.getState();
		// Aggregation alone adds only grand total rows above/below the data rows; the search stays between them.
		if (isGroupingActive(state.grouping) || state.treeData || state.detail) return null;
		if (!state.sortModel || state.sortModel.length === 0) return null;
		if (this._pageWindow !== null) return null;

		const compareToNode = this.createIncrementalSortComparator(state.columns, state.sortModel);

		// Collect VisualRow objects and old indices for each changed node
		const toRelocate: Array<{ node: RowNode<TData>; vr: VisualRow<TData>; oldIdx: number }> = [];
		const seen = new Set<RowNode<TData>>();
		for (const node of changedNodes) {
			// A batch may update one row more than once; it moves once.
			if (seen.has(node)) continue;
			seen.add(node);
			const oldIdx = this.nodeIndex(node);
			if (oldIdx === undefined) continue; // was filtered out; stays filtered (sort-key can't change filter membership)
			const vr = this.visualRows[oldIdx];
			if (vr?.kind === 'data') toRelocate.push({ node, vr, oldIdx });
		}
		if (toRelocate.length === 0) return 0;
		if (toRelocate.length > ClientRowModelController.SPLICE_RELOCATE_MAX) return this.mergeRelocate(toRelocate, compareToNode);

		// Remove in descending index order so prior splices don't shift remaining indices.
		// After sort, toRelocate[last].oldIdx is the smallest (earliest) affected position.
		toRelocate.sort((a, b) => b.oldIdx - a.oldIdx);
		const earliestRemovedIndex = toRelocate[toRelocate.length - 1].oldIdx;
		// Edit the (private) visual array in place: a relocation allocates O(changed rows), not O(n).
		const mutable = this.visualRows;
		for (const item of toRelocate) mutable.splice(item.oldIdx, 1);

		// Insert each row at its new sorted position; track earliest insertion index.
		let earliestInsertedIndex = mutable.length;
		try {
			for (const item of toRelocate) {
				const compare = compareToNode(item.node);
				let [lo, hi] = dataBounds(mutable);
				while (lo < hi) {
					const mid = (lo + hi) >>> 1;
					const midVR = mutable[mid];
					if (midVR?.kind !== 'data') {
						lo = mid + 1;
						continue;
					}
					if (compare(midVR.node) <= 0) hi = mid;
					else lo = mid + 1;
				}
				mutable.splice(lo, 0, item.vr);
				if (lo < earliestInsertedIndex) earliestInsertedIndex = lo;
			}
		} catch (error) {
			// A throwing getter left the in-place array half-edited — rebuild it from the store.
			this.refresh('sort' as RowRefreshReason);
			throw error;
		}

		// Update maps in-place from the earliest affected index — no Map allocations.
		const changedStartIndex = Math.min(earliestRemovedIndex, earliestInsertedIndex);
		this.stampRowPositions(changedStartIndex);
		return changedStartIndex;
	}

	/**
	 * Many moved rows: one pass instead of two O(n) splices per row. The moved rows are sorted, each
	 * binary-searches its place among the rows that stay, and the list is rewritten once from the
	 * first changed index.
	 */
	private mergeRelocate(
		toRelocate: Array<{ node: RowNode<TData>; vr: VisualRow<TData>; oldIdx: number }>,
		compareToNode: (a: RowNode<TData>) => (b: RowNode<TData>) => number
	): number {
		const rows = this.visualRows;
		const n = rows.length;
		// Movers are marked by old index (unique: a batch's repeated rows were merged).
		const moved = new Uint8Array(n);
		for (const item of toRelocate) moved[item.oldIdx] = 1;
		const rest: VisualRow<TData>[] = new Array(n - toRelocate.length);
		for (let i = 0, k = 0; i < n; i++) if (moved[i] === 0) rest[k++] = rows[i];
		const movers = toRelocate.map((item) => ({ item, compare: compareToNode(item.node) }));
		movers.sort((a, b) => a.compare(b.item.node));
		// Same search as the splice path: before the first data row the mover sorts at or before.
		const [restStart, restEnd] = dataBounds(rest);
		const places = movers.map(({ compare }) => {
			let lo = restStart;
			let hi = restEnd;
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				const midVR = rest[mid];
				if (midVR.kind === 'data' && compare(midVR.node) <= 0) hi = mid;
				else lo = mid + 1;
			}
			return lo;
		});
		let start = n;
		let end = -1;
		let out = 0;
		let r = 0;
		for (let m = 0; m <= movers.length; m++) {
			const stop = m < movers.length ? places[m] : rest.length;
			for (; r < stop; r++, out++) {
				const row = rest[r];
				if (rows[out] === row) continue;
				if (out < start) start = out;
				end = out;
				rows[out] = row;
			}
			if (m === movers.length) break;
			const row = movers[m].item.vr;
			if (rows[out] !== row) {
				if (out < start) start = out;
				end = out;
				rows[out] = row;
			}
			out++;
		}
		if (end < 0) return 0;
		this.stampRowPositions(start, end);
		return start;
	}

	public replaceRowsStructurally(rows: readonly TData[]): RowModelWriteResult<TData> {
		const result = this.dataStore.replaceRows(rows as TData[]);
		return {
			addedNodes: result.added,
			removedNodes: result.removed,
			updatedNodes: result.changedNodes,
			changedFieldsByRow: result.changedFieldsByRow,
			changedValuesByRow: result.changedValuesByRow,
			// Same ids in the same order: only the changed rows' fields changed (targeted, like a
			// row update). Anything else moved rows, so the projection is rebuilt.
			visualChange: !result.sameOrder ? 'full' : result.changedNodes.length > 0 ? 'partial' : 'none',
		};
	}

	public applyTransactionStructurally(transaction: RowDataTransaction<TData>): RowModelWriteResult<TData> & InternalRowNodeTransaction<TData> {
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
		if (impact === 'aggregation-input' || impact === 'sort-key' || impact === 'filter-key') {
			const flat = this.tryFlatAggregateUpdate(writeResult, impact);
			if (flat) return flat;
		}
		if (impact === 'aggregation-input' || impact === 'sort-key' || impact === 'group-key' || impact === 'filter-key') {
			const incremental = this.tryIncrementalGroupedUpdate(writeResult, impact);
			if (incremental) return incremental;
			this._incremental = undefined;
		} else if (impact !== 'value-only') {
			// A write the index cannot see may have moved aggregate inputs.
			this._incremental = undefined;
		}
		if (impact === 'group-key' || impact === 'tree-parent' || impact === 'aggregation-input') {
			inst.increment(GridMetric.ROW_MUTATION_FULL_REBUILD);
			return this.refresh('bulk');
		}
		if (impact === 'sort-key') {
			return this.reconcileSortKeyWrite(writeResult);
		}
		if (impact === 'filter-key') {
			const nodes = writeResult.updatedNodes ?? [];
			if (nodes.length > 0 && this.filterMembershipChanged(nodes)) {
				inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL);
				return this.refresh('filter' as RowRefreshReason);
			}
			// Membership held, but 'filter-key' outranks 'sort-key' in the classification — with a
			// quick filter active every field is a filter key — so the write may still have moved
			// a row within the sort order.
			if (nodes.length > 0 && this.writeMayAffectSortOrder(writeResult)) {
				return this.reconcileSortKeyWrite(writeResult);
			}
			inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL);
			return { changed: false };
		}
		inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL);
		return { changed: false };
	}

	/**
	 * A flat grid with aggregates (a grand total): rows move by the live-sort relocation and the total
	 * follows by deltas, instead of a full run per write. Null (nothing touched) outside that shape.
	 */
	private tryFlatAggregateUpdate(writeResult: RowModelWriteResult<TData>, impact: RowWriteImpact): RowModelRefreshResult | null {
		const state = this.runtime.getState();
		const defs = state.aggregation?.defs ?? [];
		if (defs.length === 0 || isGroupingActive(state.grouping) || state.treeData || state.detail || this._pageWindow !== null) return null;
		const nodes = writeResult.updatedNodes ?? [];
		const changedValues = writeResult.changedValuesByRow;
		if (nodes.length === 0 || !changedValues || (writeResult.addedNodes?.length ?? 0) > 0 || (writeResult.removedNodes?.length ?? 0) > 0)
			return null;
		if (impact === 'filter-key') {
			if (state.queryModel && state.queryModel.root.children.length > 0) return null;
			if (this.filterMembershipChanged(nodes)) return null;
		}
		// Built from the rows as they are now (values already written), so a fresh one takes no deltas.
		const fresh = this._flatTotals === undefined;
		if (fresh) this._flatTotals = FlatTotals.create(defs, state.columns, () => this.visualRows);
		const totals = this._flatTotals;
		if (!totals) return null;
		if (!fresh) totals.apply(changedValues, (rowId) => this.dataRowIndex(rowId) !== undefined);

		let changedStartIndex: number | null = null;
		if (this.writeMayAffectSortOrder(writeResult)) {
			changedStartIndex = this.relocateSortedRows(nodes);
			if (changedStartIndex === null) {
				this._flatTotals = undefined;
				return null;
			}
		}
		const aggregateChangedIndices: number[] = [];
		const totalAt = this.visualRowIdToIndex.get(toTotalVisualRowId(null));
		const totalRow = totalAt === undefined ? undefined : this.visualRows[totalAt];
		if (totalRow?.kind === 'total') {
			this.visualRows[totalAt!] = { ...totalRow, aggregates: totals.aggregates() };
			aggregateChangedIndices.push(totalAt!);
		}
		this.runtime.getInstrumentation().increment(GridMetric.ROW_MUTATION_INCREMENTAL);
		const aggregates = aggregateChangedIndices.length > 0 ? aggregateChangedIndices : undefined;
		if (changedStartIndex !== null) {
			return {
				changed: true,
				reason: 'sort',
				layoutTransitionHint: 'live-reorder',
				changedStartIndex,
				changedEndIndex: Math.max(changedStartIndex, this.visualRows.length - 1),
				heightsUnchanged:
					Object.keys(state.rowHeights).length === 0 && this.getUniformRowHeight(state.defaultRowHeight) !== null ? true : undefined,
				aggregateChangedIndices: aggregates,
			};
		}
		return aggregates ? { changed: true, reason: 'bulk', aggregateChangedIndices: aggregates } : { changed: false };
	}

	/** The configuration the incremental index depends on, compared by reference. */
	private captureIncrementalSeed(state: ReturnType<ClientRowModelRuntime<TData>['getState']>): Record<string, unknown> {
		return {
			columns: state.columns,
			sortModel: state.sortModel,
			filterModel: state.filterModel,
			quickFilterModel: state.quickFilterModel,
			queryModel: state.queryModel,
			grouping: state.grouping,
			treeData: state.treeData,
			aggregation: state.aggregation,
			detail: state.detail,
			expansion: state.expansion,
			rowHeights: state.rowHeights,
			defaultRowHeight: state.defaultRowHeight,
			pagination: state.pagination,
		};
	}

	/**
	 * Grouped grids: absorbs updates that keep every row's group and filter membership (aggregate
	 * inputs, sort keys) by patching the tree and flat list, instead of a full pipeline run.
	 * Null when the update needs the full run.
	 */
	private tryIncrementalGroupedUpdate(writeResult: RowModelWriteResult<TData>, impact: RowWriteImpact): RowModelRefreshResult | null {
		const nodes = writeResult.updatedNodes;
		if (!nodes || nodes.length === 0 || (writeResult.addedNodes?.length ?? 0) > 0 || (writeResult.removedNodes?.length ?? 0) > 0) return null;
		const state = this.runtime.getState();
		const seed = this._incrementalSeed;
		if (!seed || this._incremental === null || !this._roots || this._pageWindow !== null || this.getRowHeight) return null;
		const now = this.captureIncrementalSeed(state);
		for (const key of Object.keys(now)) if (now[key] !== seed[key]) return null;
		if (state.treeData || state.detail || state.pagination || !isGroupingActive(state.grouping)) return null;
		if (state.queryModel && state.queryModel.root.children.length > 0) return null;
		// A row may change group or enter / leave the filter only when those are decided by plain row data.
		const checkFilter = impact === 'group-key' || impact === 'filter-key';
		const hasFilter = !!state.quickFilterModel?.text.trim() || (!!state.filterModel && Object.keys(state.filterModel).length > 0);
		if (checkFilter && hasFilter && state.columns.some((column) => column.valueGetter)) return null;
		if (this._incremental === undefined) {
			const expansionBase: unknown = state.expansion.base;
			this._incremental = IncrementalRowIndex.create<TData>({
				roots: this._roots,
				columns: state.columns,
				sortModel: state.sortModel,
				aggDefs: state.aggregation?.defs ?? [],
				groupByColIds: groupByColIds(state.grouping),
				groupDefs: normalizeGroupDefs(state.grouping.by),
				hasGrandTotal: !!state.grouping?.totals?.grand,
				getSourceIndex: (rowId) => this.dataStore.getSourceIndex(rowId),
				matchesFilter: createClientFilterPredicate(state.columns, state.filterModel, state.quickFilterModel),
				defaultRowHeight: state.defaultRowHeight,
				rowHeights: state.rowHeights,
				countSensitiveExpansion: typeof state.grouping.defaultExpanded === 'function' || typeof expansionBase === 'function',
			});
			if (!this._incremental) return null;
		}
		const previousRowCount = this.visualRows.length;
		const result = this._incremental.apply(
			nodes,
			writeResult.changedValuesByRow,
			{
				visualRows: this.visualRows,
				visualRowIdToIndex: this.visualRowIdToIndex,
				groupMeta: this._groupMeta,
				groupMetaByVisualIndex: this._groupMetaByVisualIndex,
				stickyGroupMeta: this._stickyGroupMeta,
			},
			{ checkFilter }
		);
		if (!result) {
			this._incremental = undefined;
			return null;
		}
		this.runtime.getInstrumentation().increment(GridMetric.ROW_MUTATION_INCREMENTAL);
		if (result.moved || result.listChanged) this.rowIndexStale = true;
		if (result.membershipChanged) this._hierarchyIndex = null;
		const aggregates = result.aggregateChangedIndices.length > 0 ? result.aggregateChangedIndices : undefined;
		const hasRange = result.changedStartIndex !== undefined;
		if (!hasRange && !aggregates) return { changed: false };
		if (result.listChanged) {
			// Rows were rewritten whole (some entered, left or changed group): everything after shifts, so
			// geometry (group and total rows are not data-row height) and the viewport are rebuilt.
			this.runtime.bumpGlobalVersion();
			// Entering rows take their recorded heights, if any.
			if (Object.keys(state.rowHeights).length > 0) this._uniformHeight = undefined;
			return {
				changed: true,
				reason: impact === 'filter-key' ? 'filter' : 'bulk',
				previousRowCount,
				nextRowCount: this.visualRows.length,
				changedStartIndex: result.changedStartIndex,
				changedEndIndex: result.changedEndIndex,
				changedRanges: result.changedRanges.length > 0 ? result.changedRanges : undefined,
				aggregateChangedIndices: aggregates,
			};
		}
		return {
			changed: true,
			reason: 'sort',
			layoutTransitionHint: hasRange ? 'live-reorder' : undefined,
			previousRowCount,
			nextRowCount: this.visualRows.length,
			changedStartIndex: result.changedStartIndex,
			changedEndIndex: result.changedEndIndex,
			changedRanges: result.changedRanges.length > 0 ? result.changedRanges : undefined,
			// No per-row heights (callback excluded above), so every data row of a group is the default height.
			heightsUnchanged: Object.keys(state.rowHeights).length === 0 ? true : undefined,
			aggregateChangedIndices: aggregates,
		};
	}

	private reconcileSortKeyWrite(writeResult: RowModelWriteResult<TData>): RowModelRefreshResult {
		const inst = this.runtime.getInstrumentation();
		const nodes = writeResult.updatedNodes ?? [];
		const changedStartIndex = nodes.length > 0 ? this.relocateSortedRows(nodes) : null;
		if (changedStartIndex !== null) {
			inst.increment(GridMetric.ROW_MUTATION_INCREMENTAL);
			const state = this.runtime.getState();
			return {
				changed: true,
				reason: 'sort',
				layoutTransitionHint: 'live-reorder',
				changedStartIndex,
				changedEndIndex: Math.max(changedStartIndex, this.visualRows.length - 1),
				// Same rows, new order: with one height for all of them, no row's top or height changes.
				heightsUnchanged:
					Object.keys(state.rowHeights).length === 0 && this.getUniformRowHeight(state.defaultRowHeight) !== null ? true : undefined,
			};
		}
		inst.increment(GridMetric.ROW_MUTATION_FULL_REBUILD);
		return this.refresh('sort' as RowRefreshReason);
	}

	/** Conservative: without per-row changed fields, any write may affect an active sort. */
	private writeMayAffectSortOrder(writeResult: RowModelWriteResult<TData>): boolean {
		const sortModel = this.runtime.getState().sortModel;
		if (!sortModel || sortModel.length === 0) return false;
		const changedFieldsByRow = writeResult.changedFieldsByRow;
		if (!changedFieldsByRow || changedFieldsByRow.size === 0) return true;
		const allFields = new Set<string>();
		for (const fields of changedFieldsByRow.values()) {
			for (const field of fields) allFields.add(field);
		}
		return mutationAffectsSortKeys(allFields, this.dependencyRegistry);
	}

	/**
	 * Threshold (added + removed rows) above which a full pipeline rebuild is cheaper than
	 * incremental insert/remove into the visual array. Chosen empirically: below this threshold
	 * individual array splices + map rebuilds outperform a full O(N log N) sort.
	 */
	private static readonly INCREMENTAL_TX_LIMIT = 100;
	/** Above this many moved rows a live sort reorder merges in one pass instead of splicing per row. */
	private static readonly SPLICE_RELOCATE_MAX = 16;

	/**
	 * Attempts to apply structural row mutations (adds/removes) incrementally on flat grids.
	 * Returns false to signal full rebuild is needed (grouped/tree/paginated grids, or when
	 * the transaction exceeds the INCREMENTAL_TX_LIMIT threshold).
	 */
	private tryIncrementalTransaction(added: RowNode<TData>[], removed: RowNode<TData>[]): number | null {
		const state = this.runtime.getState();
		if (hasHierarchyRows(state)) return null;
		if (this._pageWindow !== null) return null;
		if (added.length + removed.length > ClientRowModelController.INCREMENTAL_TX_LIMIT) return null;

		this.ensureRowPositions();
		const mutable = this.visualRows.slice();
		let earliestChangedIndex = mutable.length;

		// Removals: collect visual indices in descending order so splices don't shift later indices.
		// Delete stale map entries for removed rows before the splice.
		if (removed.length > 0) {
			const removalIndices: number[] = [];
			for (const node of removed) {
				const idx = this.nodeIndex(node);
				if (idx !== undefined) {
					removalIndices.push(idx);
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

			const compareToNode = hasSort ? this.createIncrementalSortComparator(state.columns, state.sortModel!) : null;

			for (const node of added) {
				if (preparedFilters.length > 0 && !nodeMatchesPreparedFilters(node, preparedFilters)) continue;

				const explicitHeight = (state.rowHeights as Record<string, number>)[node.id] ?? this.getRowHeight?.(node.data, node.id);
				const vr: VisualRow<TData> = {
					kind: 'data',
					id: toDataVisualRowId(node.id),
					rowId: node.id,
					node,
					hierarchy: FLAT_HIERARCHY,
					height: explicitHeight !== undefined ? explicitHeight : state.defaultRowHeight,
					selectable: true,
					editable: true,
				};

				if (vr.height !== this._uniformHeight) this._uniformHeight = undefined;
				if (compareToNode) {
					const compare = compareToNode(node);
					let lo = 0,
						hi = mutable.length;
					while (lo < hi) {
						const mid = (lo + hi) >>> 1;
						const midVR = mutable[mid];
						if (midVR?.kind !== 'data') {
							lo = mid + 1;
							continue;
						}
						if (compare(midVR.node) <= 0) hi = mid;
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
		this.stampRowPositions(earliestChangedIndex);
		return earliestChangedIndex === mutable.length ? 0 : earliestChangedIndex;
	}

	public captureTransactionSnapshot = (mutation: RowTransactionMutation<TData>): RowModelTransactionSnapshot<TData> => {
		// Delta snapshot: only the rows this transaction touches, captured by reference.
		return {
			modelType: 'client',
			snapshot: {
				dataStore: this.dataStore.captureTransactionSnapshot(mutation.transaction),
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

	/**
	 * Full runs reset the cache; incremental paths keep it, since the rows they add are data rows of the
	 * default height whenever no per-row heights exist (the only case the engine asks).
	 */
	public getUniformRowHeight(defaultRowHeight: number): number | null {
		if (this._uniformHeight === undefined || this._uniformHeightDefault !== defaultRowHeight) {
			let uniform: number | null = defaultRowHeight;
			for (const row of this.visualRows) {
				if ((row.height ?? defaultRowHeight) !== defaultRowHeight) {
					uniform = null;
					break;
				}
			}
			this._uniformHeight = uniform;
			this._uniformHeightDefault = defaultRowHeight;
		}
		return this._uniformHeight;
	}

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
		const idx = this.visualIndexOf(visualRowId);
		return idx !== undefined ? idx : -1;
	};

	public getVisualIndexByRowId = (rowId: string): number => {
		const idx = this.dataRowIndex(rowId);
		if (idx !== undefined) return idx;
		// Group and total rows are addressed by their visual row id (focus, selection ranges).
		const visualIdx = this.visualRowIdToIndex.get(rowId);
		if (visualIdx === undefined) return -1;
		const kind = this.visualRows[visualIdx]?.kind;
		return kind === 'group' || kind === 'total' ? visualIdx : -1;
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

	// A copy: the store's list is cached and shared with the pipeline.
	public getAllDataNodes = (): RowNode<TData>[] => this.dataStore.getAllNodes().slice();

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
	public getSourceRowCount = (): number => this.dataStore.getRowCount();

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
			// Without client pagination the cached visual rows already are the full filtered
			// pipeline output; only a paginated view needs the unpaginated re-run below.
			if (this._pageWindow === null && !state.pagination) {
				const ids: string[] = [];
				for (const row of this.visualRows) {
					if (row?.kind === 'data') ids.push(row.rowId);
				}
				return ids;
			}
			const result = this.pipeline.run(this.buildPipelineInput(state, false));
			return result.visualRows.flatMap((row) => (row.kind === 'data' ? [row.rowId] : []));
		}
		const ids: string[] = [];
		for (const row of this.visualRows) {
			if (row?.kind === 'data') ids.push(row.rowId);
		}
		return ids;
	};

	private buildPipelineInput(state: ReturnType<ClientRowModelRuntime<TData>['getState']>, paginate: boolean): RowPipelineInput<TData> {
		return {
			nodes: this.dataStore.getAllNodes(),
			columns: state.columns,
			sortModel: state.sortModel,
			filterModel: state.filterModel,
			quickFilterModel: state.quickFilterModel,
			queryModel: state.queryModel,
			grouping: state.grouping,
			treeData: state.treeData,
			aggregation: state.aggregation,
			detail: state.detail,
			expansion: state.expansion,
			defaultRowHeight: state.defaultRowHeight,
			rowHeightsRecord: state.rowHeights,
			getRowHeight: this.getRowHeight,
			reportFault: this.runtime.reportRowPipelineFault,
			// Client pagination: slice happens inside the pipeline so every derived
			// map/meta/geometry stays page-consistent. Undefined → full list.
			pagination: paginate && state.pagination ? { pageSize: state.pagination.pageSize, page: state.pagination.page ?? 0 } : undefined,
		};
	}

	public refresh(reason?: RowRefreshReason, groupId?: string): RowModelRefreshResult {
		const state = this.runtime.getState();
		const previousRows = this.visualRows;

		const result = this.pipeline.run(this.buildPipelineInput(state, true));
		const { visualRows } = result;
		const refreshResult = describeVisualRowDiff(previousRows, visualRows, reason, groupId);

		this.visualRows = visualRows;
		this._pageWindow = result.pageWindow ?? null;
		this.visualRowIdToIndex = result.visualRowIdToIndex;
		this.rowIndexStale = false;
		this.stampRowPositions(0);
		this.rowIdToVisualRowIds = result.rowIdToVisualRowIds;
		this._stickyGroupMeta = result.stickyGroupMeta;
		this._groupMeta = result.groupMeta;
		this._groupMetaByVisualIndex = result.groupMetaByVisualIndex;
		this._roots = result.roots;
		this._hierarchyIndex = null;
		this._incremental = undefined;
		this._flatTotals = undefined;
		this._uniformHeight = undefined;
		this._incrementalSeed = this.captureIncrementalSeed(state);
		this.dataRowCount = result.stats.totalDataRows;

		this.runtime.bumpGlobalVersion();

		return refreshResult;
	}
}
