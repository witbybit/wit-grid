import { GridEventName } from '../api/GridEvents.js';
import type { GridCellWrite, GridCellPointer, RowDataTransaction } from '../api/GridApi.js';
import { getCellPointerColumnKey } from '../interaction/cellPointer.js';
import {
	asAnyModelCellWritable,
	asRowOrderCapableModel,
	asClientStructuralRowModel,
	type RowModel,
	type RowOrderCapableModel,
	type RowModelTransactionSnapshot,
	type RowModelWriteResult,
	type RowWriteImpact,
} from '../rowModel.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { GridIntegrityState, InternalGridState, GridStateUpdater } from '../state/GridState.js';
import type {
	GridCellConflict,
	GridCellDiff,
	GridDiffModel,
	GridDiffResult,
	GridIntegrityIssue,
	GridIntegrityIssueSource,
	GridIntegritySummary,
	GridTransactionStreamState,
	ServerIntegrityReport,
} from '../state/integrityStateTypes.js';
import type { GridInvalidation } from '../renderer/invalidationManager.js';
import { createIntegrityMutationExecutors } from './integrityMutationExecutors.js';
import type { InternalRowNodeTransaction } from '../rowTransactions.js';
import type { GridCommitEvent, GridCommitReason, GridHistoryEntry } from './GridChangeApplier.js';
import type { CellValueChangeOptions, CellValueChangeResult, StructuralWriteEffectResult } from '../features/DataMutationController.js';
import type { GridIntegrityIssueFilter } from '../features/dataIntegrity/integrityTypes.js';
import type { LayoutTransitionReason } from '../renderer/layoutTransitionController.js';
import type { RowModelRefreshResult } from '../rowModel.js';

export type GridDomain = keyof GridDomainVersions;

export interface CellValueMutation {
	kind: 'cell-value';
	rowId: string;
	colField: string;
	value: unknown;
	undoable?: boolean;
	bypassValueSetter?: boolean;
	source?: CellValueChangeOptions['source'];
}

export interface BatchCellMutation {
	kind: 'batch-cell';
	updates: ReadonlyArray<GridCellWrite>;
	atomic?: boolean;
	undoable?: boolean;
	bypassValueSetter?: boolean;
	source?: CellValueChangeOptions['source'];
}

export interface RowTransactionRejection {
	rowId?: string;
	reason: string;
	index?: number;
}

export interface RowTransactionMutation<TRowData = unknown> {
	kind: 'row-transaction';
	transaction: RowDataTransaction<TRowData>;
	restoreSnapshot?: RowModelTransactionSnapshot<TRowData>;
}

export interface RowOrderMutation {
	kind: 'row-order';
	rowIds: string[];
	emitEvent?: boolean;
	reason?: GridCommitReason;
}

export interface ReplaceRowsMutation<TRowData = unknown> {
	kind: 'replace-rows';
	rows: readonly TRowData[];
	undoable?: boolean;
}

export interface IntegritySetValidationIssuesMutation {
	kind: 'integrity-set-validation-issues';
	issues: readonly GridIntegrityIssue[];
}

export interface IntegritySetQualityIssuesMutation {
	kind: 'integrity-set-quality-issues';
	issues: readonly GridIntegrityIssue[];
}

export interface IntegritySetDiffStateMutation<TRowData = unknown> {
	kind: 'integrity-set-diff-state';
	model: GridDiffModel<TRowData> | null;
	result: GridDiffResult | null;
	cellDiffIndex: Record<string, GridCellDiff>;
}

export interface IntegrityResolveCellDiffMutation {
	kind: 'integrity-resolve-cell-diff';
	rowId: string;
	colField: string;
}

export interface IntegrityUpsertConflictMutation {
	kind: 'integrity-upsert-conflict';
	conflict: GridCellConflict;
}

export interface IntegrityClearConflictMutation {
	kind: 'integrity-clear-conflict';
	conflictId: string;
}

export interface IntegrityClearConflictsMutation {
	kind: 'integrity-clear-conflicts';
}

export interface IntegritySetLiveStreamSessionMutation {
	kind: 'integrity-set-live-stream-session';
	session: GridTransactionStreamState | null;
}

export interface IntegritySetLiveStreamIssuesMutation {
	kind: 'integrity-set-live-stream-issues';
	issues: readonly GridIntegrityIssue[];
}

export interface IntegrityPublishIssuesMutation {
	kind: 'integrity-publish-issues';
	source: GridIntegrityIssueSource;
	issues: readonly GridIntegrityIssue[];
	append?: boolean;
}

export interface IntegrityClearPublishedIssuesMutation {
	kind: 'integrity-clear-published-issues';
	filter?: GridIntegrityIssueFilter;
}

export interface IntegritySetServerReportMutation {
	kind: 'integrity-set-server-report';
	report: ServerIntegrityReport | null;
}

export interface IntegrityClearAllMutation {
	kind: 'integrity-clear-all';
}

export type GridDomainMutation<TRowData = unknown> =
	| CellValueMutation
	| BatchCellMutation
	| RowTransactionMutation<TRowData>
	| RowOrderMutation
	| ReplaceRowsMutation<TRowData>
	| IntegritySetValidationIssuesMutation
	| IntegritySetQualityIssuesMutation
	| IntegritySetDiffStateMutation<TRowData>
	| IntegrityResolveCellDiffMutation
	| IntegrityUpsertConflictMutation
	| IntegrityClearConflictMutation
	| IntegrityClearConflictsMutation
	| IntegritySetLiveStreamSessionMutation
	| IntegritySetLiveStreamIssuesMutation
	| IntegrityPublishIssuesMutation
	| IntegrityClearPublishedIssuesMutation
	| IntegritySetServerReportMutation
	| IntegrityClearAllMutation;

export interface GridMutationRejection {
	mutationKind: GridDomainMutation['kind'];
	reason: string;
	index?: number;
}

export type GridMutationValidationResult = { ok: true } | { ok: false; reason: string; rejection?: GridMutationRejection };

export interface GridCommitContext<TRowData = unknown> {
	getState(): Readonly<InternalGridState<TRowData>>;
	getRowModel(): RowModel<TRowData> | null;
	getCellValue?(rowId: string, colField: string): unknown;
	getRawCellValue?(rowId: string, colField: string): unknown;
	getStoredCellValue?(rowId: string, colField: string): unknown;
	getColumnDef?(colField: string): ColumnDef<TRowData> | undefined;
	applyCellValueChange?: (rowId: string, colField: string, value: unknown, options?: CellValueChangeOptions) => CellValueChangeResult;
	applyStructuralWriteEffects?: (writeResult: RowModelWriteResult<TRowData>) => StructuralWriteEffectResult;
	publishCommittedCellChanges?: (changes: Map<string, Set<string>>) => void;
	requestLayoutTransitionCapture?: (reason: LayoutTransitionReason) => void;
	/** Re-syncs row geometry from a visual index after an in-place row reorder. */
	syncRowGeometryFrom?: (startIndex: number) => void;
}

export interface PreparedDomainMutation<TRowData = unknown, TMutation extends GridDomainMutation<TRowData> = GridDomainMutation<TRowData>> {
	mutation: TMutation;
	noop?: boolean;
	state?: GridStateUpdater<TRowData>;
	invalidations?: readonly GridInvalidation[];
	domains: readonly GridDomain[];
	events: readonly GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender?: boolean;
	rejections?: readonly GridMutationRejection[];
	apply(context: GridCommitContext<TRowData>): AppliedDomainMutation<TRowData>;
	rollback?(applied: AppliedDomainMutation<TRowData>, context: GridCommitContext<TRowData>): void;
}

export interface AppliedDomainMutation<TRowData = unknown> {
	noop?: boolean;
	state?: GridStateUpdater<TRowData>;
	invalidations?: readonly GridInvalidation[];
	domains?: readonly GridDomain[];
	events?: readonly GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender?: boolean;
	rejections?: readonly GridMutationRejection[];
	cellChanges?: Map<string, Set<string>>;
	result?: unknown;
}

export interface GridDomainMutationExecutor<TRowData = unknown, TMutation extends GridDomainMutation<TRowData> = GridDomainMutation<TRowData>> {
	validate(mutation: TMutation, context: GridCommitContext<TRowData>): GridMutationValidationResult;
	prepare(mutation: TMutation, context: GridCommitContext<TRowData>): PreparedDomainMutation<TRowData, TMutation>;
}

export interface GridDomainMutationExecutorRegistry<TRowData = unknown> {
	resolve<TMutation extends GridDomainMutation<TRowData>>(mutation: TMutation): GridDomainMutationExecutor<TRowData, TMutation> | null;
}

function getRowOrderCapableModel<TRowData>(context: GridCommitContext<TRowData>): RowOrderCapableModel | null {
	return asRowOrderCapableModel(context.getRowModel());
}

interface CellValueMutationPreview {
	rowId: string;
	colField: string;
	value: unknown;
	oldRawValue: unknown;
	oldComputedValue: unknown;
	status: 'ready' | 'noop' | 'rejected';
	reason?: string;
}

interface PreparedCellValueMutation<TRowData = unknown> extends PreparedDomainMutation<TRowData, CellValueMutation> {
	preview: CellValueMutationPreview;
}

interface PreparedBatchCellMutation<TRowData = unknown> extends PreparedDomainMutation<TRowData, BatchCellMutation> {
	previews: readonly CellValueMutationPreview[];
}

interface BatchCellMutationExecutionResult {
	results: CellValueChangeResult[];
	committed: CellValueChangeResult[];
	rejected: Array<{ index: number; update: GridCellWrite; reason: string }>;
}

function areRowOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function toCellChangeSet(cells: readonly GridCellPointer[]): Map<string, Set<string>> {
	const changes = new Map<string, Set<string>>();
	for (const cell of cells) {
		let fields = changes.get(cell.rowId);
		if (!fields) {
			fields = new Set<string>();
			changes.set(cell.rowId, fields);
		}
		fields.add(getCellPointerColumnKey(cell));
	}
	return changes;
}

function createInvalidationsFromCells(cells: readonly GridCellPointer[]): GridInvalidation[] {
	const invalidations: GridInvalidation[] = [];
	const rowIds = new Set<string>();
	const cellKeys = new Set<string>();
	for (const cell of cells) {
		const columnKey = getCellPointerColumnKey(cell);
		const key = `${cell.rowId}:${columnKey}`;
		if (!cellKeys.has(key)) {
			cellKeys.add(key);
			invalidations.push({ kind: 'cell', rowId: cell.rowId, colId: columnKey, reason: 'cell' });
		}
		rowIds.add(cell.rowId);
	}
	for (const rowId of rowIds) {
		invalidations.push({ kind: 'row', rowId, reason: 'cell' });
	}
	return invalidations;
}

function createInvalidationsFromRefreshResult<TRowData>(
	result: RowModelRefreshResult,
	context: GridCommitContext<TRowData>,
	reason: GridInvalidation['reason'] = 'data'
): GridInvalidation[] {
	if (!result.changed) return [];
	// A live sort-key relocation moves rows in place: no globalVersion bump and no row-count
	// change, so the projection pipeline would keep the old per-index heights. Re-sync geometry
	// from the first moved index so variable row heights follow their rows.
	if (result.layoutTransitionHint === 'live-reorder' && result.changedStartIndex !== undefined) {
		context.syncRowGeometryFrom?.(result.changedStartIndex);
	}
	const effectiveReason: GridInvalidation['reason'] = result.layoutTransitionHint === 'live-reorder' ? 'sort' : reason;
	// Aggregates changing in place (same rows, same order) need only those rows, not the viewport.
	const aggregateOnly =
		result.changedStartIndex === undefined &&
		!result.groupId &&
		result.previousRowCount === result.nextRowCount &&
		!!result.aggregateChangedIndices;
	const invalidations: GridInvalidation[] = aggregateOnly ? [] : [{ kind: 'viewport', reason: effectiveReason }];
	if (result.groupId) {
		invalidations.push({ kind: 'group', groupId: result.groupId, reason: effectiveReason });
	}
	if (result.changedStartIndex !== undefined && result.changedEndIndex !== undefined) {
		invalidations.push({
			kind: 'row-range',
			startIndex: result.changedStartIndex,
			endIndex: result.changedEndIndex,
			reason: effectiveReason,
		});
	}
	// Rows whose aggregates changed in place, as contiguous runs.
	const aggregateRows = result.aggregateChangedIndices;
	if (aggregateRows) {
		for (let i = 0; i < aggregateRows.length; ) {
			let end = i;
			while (end + 1 < aggregateRows.length && aggregateRows[end + 1] === aggregateRows[end] + 1) end++;
			invalidations.push({ kind: 'row-range', startIndex: aggregateRows[i], endIndex: aggregateRows[end], reason: effectiveReason });
			i = end + 1;
		}
	}
	if (result.previousRowCount !== result.nextRowCount) {
		invalidations.push({ kind: 'geometry', reason: effectiveReason });
	}
	return invalidations;
}

function requestLayoutTransitionCaptureForImpact<TRowData>(context: GridCommitContext<TRowData>, impact: RowWriteImpact): void {
	if (impact === 'sort-key') {
		context.requestLayoutTransitionCapture?.('live-reorder');
	}
}

function createEventsFromResults<TRowData>(results: readonly CellValueChangeResult[]): GridCommitEvent<TRowData>[] {
	return results
		.filter((result) => result.applied)
		.map((result) => ({
			type: GridEventName.cellValueChanged,
			payload: {
				rowId: result.rowId,
				colField: result.colField,
				oldValue: result.oldComputedValue,
				newValue: result.newComputedValue,
			},
		}));
}

function createRowsUpdatedEvents<TRowData>(params: {
	changedValuesByRow?: Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;
	changedNodes?: InternalRowNodeTransaction<TRowData>['update'];
	addedNodes?: InternalRowNodeTransaction<TRowData>['add'];
	removedNodes?: InternalRowNodeTransaction<TRowData>['remove'];
}): GridCommitEvent<TRowData>[] {
	const changedNodes = params.changedNodes ?? [];
	const addedNodes = params.addedNodes ?? [];
	const removedNodes = params.removedNodes ?? [];
	const changedValuesByRow = params.changedValuesByRow;
	if ((!changedValuesByRow || changedValuesByRow.size === 0) && changedNodes.length === 0 && addedNodes.length === 0 && removedNodes.length === 0) {
		return [];
	}
	return [
		{
			type: GridEventName.rowsUpdated,
			payload: {
				changedValuesByRow: changedValuesByRow ?? new Map(),
				changedNodes,
				addedNodes,
				removedNodes,
			},
		},
	];
}

function rollbackAppliedCellResults<TRowData>(
	results: readonly CellValueChangeResult[],
	context: GridCommitContext<TRowData>,
	source: CellValueChangeOptions['source']
): void {
	if (!context.applyCellValueChange) return;
	for (let index = results.length - 1; index >= 0; index--) {
		const result = results[index]!;
		if (!result.applied) continue;
		context.applyCellValueChange(result.rowId, result.colField, result.oldRawValue, {
			bypassValueSetter: true,
			source,
		});
	}
}

function createRowOrderHistory<TRowData>(reason: GridCommitReason, currentOrder: string[], nextOrder: string[]): GridHistoryEntry<TRowData> {
	return {
		undo: {
			reason,
			domainMutations: [{ kind: 'row-order', rowIds: currentOrder, emitEvent: true, reason }],
			requestRender: false,
		},
		redo: {
			reason,
			domainMutations: [{ kind: 'row-order', rowIds: nextOrder, emitEvent: true, reason }],
			requestRender: false,
		},
	};
}

export function createCellValueMutationHistory<TRowData>(
	reason: GridCommitReason,
	rowId: string,
	colField: string,
	oldValue: unknown,
	newValue: unknown,
	bypassValueSetter = false
): GridHistoryEntry<TRowData> {
	return {
		undo: {
			reason,
			domainMutations: [{ kind: 'cell-value', rowId, colField, value: oldValue, undoable: false, bypassValueSetter, source: 'undo' }],
			requestRender: false,
		},
		redo: {
			reason,
			domainMutations: [{ kind: 'cell-value', rowId, colField, value: newValue, undoable: false, bypassValueSetter, source: 'redo' }],
			requestRender: false,
		},
	};
}

export function createBatchCellMutationHistory<TRowData>(
	reason: GridCommitReason,
	updates: ReadonlyArray<{ rowId: string; colField: string; oldValue: unknown; newValue: unknown }>,
	bypassValueSetter = false
): GridHistoryEntry<TRowData> {
	return {
		undo: {
			reason,
			domainMutations: [
				{
					kind: 'batch-cell',
					updates: updates.map((update) => ({ rowId: update.rowId, colField: update.colField, value: update.oldValue })),
					undoable: false,
					bypassValueSetter,
					source: 'undo',
				},
			],
			requestRender: false,
		},
		redo: {
			reason,
			domainMutations: [
				{
					kind: 'batch-cell',
					updates: updates.map((update) => ({ rowId: update.rowId, colField: update.colField, value: update.newValue })),
					undoable: false,
					bypassValueSetter,
					source: 'redo',
				},
			],
			requestRender: false,
		},
	};
}

export function createRowOrderMutationExecutor<TRowData = unknown>(
	reason: GridCommitReason = 'rows:set-order'
): GridDomainMutationExecutor<TRowData, RowOrderMutation> {
	return {
		validate(_mutation, context) {
			if (!getRowOrderCapableModel(context)) {
				return {
					ok: false,
					reason: 'row model unavailable',
					rejection: { mutationKind: 'row-order', reason: 'row model unavailable' },
				};
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const commitReason = mutation.reason ?? reason;
			const rowModel = getRowOrderCapableModel(context)!;
			const currentOrder = rowModel.getRowOrder();
			const nextOrder = mutation.rowIds.slice();
			if (areRowOrdersEqual(currentOrder, nextOrder)) {
				return {
					mutation,
					noop: true,
					domains: [],
					events: [],
					apply: () => ({ noop: true }),
				};
			}
			return {
				mutation: { ...mutation, rowIds: nextOrder },
				domains: ['rows'],
				events: mutation.emitEvent === false ? [] : [{ type: GridEventName.rowOrderChanged, payload: { rowIds: nextOrder } }],
				history: createRowOrderHistory(commitReason, currentOrder, nextOrder),
				requestRender: true,
				apply(commitContext) {
					getRowOrderCapableModel(commitContext)!.setRowOrder(nextOrder);
					return {
						domains: ['rows'],
						invalidations: [{ kind: 'full', reason: 'row order changed' }],
						events: mutation.emitEvent === false ? [] : [{ type: GridEventName.rowOrderChanged, payload: { rowIds: nextOrder } }],
						history: createRowOrderHistory(commitReason, currentOrder, nextOrder),
						requestRender: true,
					};
				},
				rollback(_applied, commitContext) {
					getRowOrderCapableModel(commitContext)!.setRowOrder(currentOrder);
				},
			};
		},
	};
}

function previewCellValueMutation<TRowData>(context: GridCommitContext<TRowData>, mutation: CellValueMutation): CellValueMutationPreview {
	const rowModel = context.getRowModel();
	const getCellValue = context.getCellValue;
	const getRawCellValue = context.getRawCellValue;
	const getStoredCellValue = context.getStoredCellValue;
	const getColumnDef = context.getColumnDef;

	const hasCellWriteCapability = asAnyModelCellWritable(rowModel) !== null;
	if (!hasCellWriteCapability || !getCellValue || !getRawCellValue || !getStoredCellValue || !getColumnDef) {
		return {
			rowId: mutation.rowId,
			colField: mutation.colField,
			value: mutation.value,
			oldRawValue: undefined,
			oldComputedValue: undefined,
			status: 'rejected',
			reason: 'cell mutation runtime unavailable',
		};
	}

	const activeRowModel = rowModel!;
	const row = activeRowModel.getRawRowById?.(mutation.rowId);
	if (!row) {
		return {
			rowId: mutation.rowId,
			colField: mutation.colField,
			value: mutation.value,
			oldRawValue: undefined,
			oldComputedValue: undefined,
			status: 'rejected',
			reason: 'row unavailable',
		};
	}

	const column = getColumnDef(mutation.colField);
	const oldRawValue = getRawCellValue(mutation.rowId, mutation.colField);
	const oldComputedValue = getCellValue(mutation.rowId, mutation.colField);
	const oldStoredValue = column?.valueGetter ? getStoredCellValue(mutation.rowId, mutation.colField) : oldRawValue;

	if (oldStoredValue === mutation.value) {
		return {
			rowId: mutation.rowId,
			colField: mutation.colField,
			value: mutation.value,
			oldRawValue,
			oldComputedValue,
			status: 'noop',
		};
	}

	return {
		rowId: mutation.rowId,
		colField: mutation.colField,
		value: mutation.value,
		oldRawValue,
		oldComputedValue,
		status: 'ready',
	};
}

export function createDefaultGridDomainMutationExecutorRegistry<TRowData = unknown>(): GridDomainMutationExecutorRegistry<TRowData> {
	// The commit kernel calls validate() and then immediately prepare() for the same mutation
	// object and context, with nothing applied in between. Hand the validate-time preview to that
	// prepare() instead of re-reading raw/computed/stored values; any other call order misses the
	// single slot and previews afresh.
	let validatedCellPreview: {
		mutation: CellValueMutation;
		context: GridCommitContext<TRowData>;
		preview: CellValueMutationPreview;
	} | null = null;
	const cellValueExecutor: GridDomainMutationExecutor<TRowData, CellValueMutation> = {
		validate(mutation, context) {
			validatedCellPreview = null;
			if (!context.applyCellValueChange) {
				return {
					ok: false,
					reason: 'cell mutation runtime unavailable',
					rejection: { mutationKind: 'cell-value', reason: 'cell mutation runtime unavailable' },
				};
			}
			const preview = previewCellValueMutation(context, mutation);
			if (preview.status !== 'rejected') validatedCellPreview = { mutation, context, preview };
			if (preview.status === 'rejected') {
				return {
					ok: false,
					reason: preview.reason ?? 'cell mutation rejected',
					rejection: { mutationKind: 'cell-value', reason: preview.reason ?? 'cell mutation rejected' },
				};
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const validated = validatedCellPreview;
			validatedCellPreview = null;
			const preview =
				validated && validated.mutation === mutation && validated.context === context
					? validated.preview
					: previewCellValueMutation(context, mutation);
			return {
				mutation,
				preview,
				noop: preview.status === 'noop',
				domains: preview.status === 'ready' ? ['rows'] : [],
				events: [],
				apply(commitContext) {
					if (!commitContext.applyCellValueChange) return { noop: true };
					if (preview.status !== 'ready') {
						return {
							noop: true,
							result: {
								applied: false,
								rowId: preview.rowId,
								colField: preview.colField,
								oldRawValue: preview.oldRawValue,
								oldComputedValue: preview.oldComputedValue,
								newRawValue: preview.value,
								invalidatedCells: [],
							} satisfies CellValueChangeResult,
						};
					}
					const result = commitContext.applyCellValueChange(preview.rowId, preview.colField, preview.value, {
						bypassValueSetter: mutation.bypassValueSetter === true,
						source: mutation.source ?? 'api',
					});
					if (!result.applied) {
						return {
							noop: true,
							rejections: [
								{
									mutationKind: 'cell-value',
									reason: 'value setter rejected change',
								},
							],
							result,
						};
					}
					let invalidations = createInvalidationsFromCells(result.invalidatedCells);
					const structuralRowModel = asClientStructuralRowModel<TRowData>(commitContext.getRowModel());
					if (structuralRowModel) {
						const changedFieldsByRow = new Map([[preview.rowId, new Set([preview.colField])]]);
						const impact = structuralRowModel.classifyFieldMutation(new Set([preview.colField]));
						if (impact !== 'value-only') {
							requestLayoutTransitionCaptureForImpact(commitContext, impact);
							const node = commitContext.getRowModel()!.getRowNodeById(preview.rowId);
							const reconcileResult = structuralRowModel.reconcileAfterDataWrite(
								{
									updatedNodes: node ? [node] : [],
									changedFieldsByRow,
									visualChange: 'none',
								},
								impact
							);
							if (reconcileResult.changed)
								invalidations = [...invalidations, ...createInvalidationsFromRefreshResult(reconcileResult, commitContext)];
						}
					}
					return {
						domains: ['rows'],
						invalidations,
						events: createEventsFromResults<TRowData>([result]),
						history:
							mutation.undoable === false
								? undefined
								: createCellValueMutationHistory<TRowData>(
										'data:set-cell-value',
										preview.rowId,
										preview.colField,
										preview.oldRawValue,
										preview.value,
										mutation.bypassValueSetter === true
									),
						requestRender: true,
						cellChanges: toCellChangeSet(result.invalidatedCells),
						result,
					};
				},
				rollback(applied, commitContext) {
					const result = applied.result as CellValueChangeResult | undefined;
					if (!result?.applied || !commitContext.applyCellValueChange) return;
					commitContext.applyCellValueChange(result.rowId, result.colField, preview.oldRawValue, {
						bypassValueSetter: true,
						source: 'undo',
					});
				},
			} satisfies PreparedCellValueMutation<TRowData>;
		},
	};

	const batchCellExecutor: GridDomainMutationExecutor<TRowData, BatchCellMutation> = {
		validate(mutation, context) {
			if (!context.applyCellValueChange) {
				return {
					ok: false,
					reason: 'batch cell mutation runtime unavailable',
					rejection: { mutationKind: 'batch-cell', reason: 'batch cell mutation runtime unavailable' },
				};
			}
			if (!context.getCellValue || !context.getRawCellValue || !context.getStoredCellValue || !context.getColumnDef) {
				return {
					ok: false,
					reason: 'batch cell preview runtime unavailable',
					rejection: { mutationKind: 'batch-cell', reason: 'batch cell preview runtime unavailable' },
				};
			}
			if (mutation.atomic !== false) {
				for (let index = 0; index < mutation.updates.length; index++) {
					const preview = previewCellValueMutation(context, {
						kind: 'cell-value',
						...mutation.updates[index]!,
						undoable: mutation.undoable,
						bypassValueSetter: mutation.bypassValueSetter,
						source: mutation.source,
					});
					if (preview.status === 'rejected') {
						return {
							ok: false,
							reason: preview.reason ?? 'batch cell mutation rejected',
							rejection: { mutationKind: 'batch-cell', reason: preview.reason ?? 'batch cell mutation rejected', index },
						};
					}
				}
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const previews = mutation.updates.map((update) =>
				previewCellValueMutation(context, {
					kind: 'cell-value',
					...update,
					undoable: mutation.undoable,
					bypassValueSetter: mutation.bypassValueSetter,
					source: mutation.source,
				})
			);
			const rejections: GridMutationRejection[] = [];
			for (let index = 0; index < previews.length; index++) {
				const preview = previews[index]!;
				if (preview.status === 'rejected') {
					rejections.push({
						mutationKind: 'batch-cell',
						reason: preview.reason ?? 'batch cell mutation rejected',
						index,
					});
				}
			}
			return {
				mutation,
				previews,
				noop: previews.every((preview) => preview.status !== 'ready'),
				domains: previews.some((preview) => preview.status === 'ready') ? ['rows'] : [],
				events: [],
				rejections,
				apply(commitContext) {
					if (!commitContext.applyCellValueChange) return { noop: true, rejections };
					const committed: CellValueChangeResult[] = [];
					const results: CellValueChangeResult[] = [];
					const rejected: Array<{ index: number; update: GridCellWrite; reason: string }> = [];

					for (let index = 0; index < previews.length; index++) {
						const preview = previews[index]!;
						const update = mutation.updates[index]!;
						if (preview.status === 'rejected') {
							rejected.push({ index, update, reason: preview.reason ?? 'batch cell mutation rejected' });
							continue;
						}
						if (preview.status === 'noop') continue;

						const result = commitContext.applyCellValueChange(update.rowId, update.colField, update.value, {
							bypassValueSetter: mutation.bypassValueSetter === true,
							source: mutation.source ?? 'api',
						});
						if (!result.applied) {
							if (mutation.atomic !== false) {
								rollbackAppliedCellResults(committed, commitContext, 'undo');
								return {
									noop: true,
									rejections: [
										{
											mutationKind: 'batch-cell',
											index,
											reason: 'value setter rejected change',
										},
									],
									result: {
										results,
										committed: [],
										rejected: [{ index, update, reason: 'value setter rejected change' }],
									} satisfies BatchCellMutationExecutionResult,
								};
							}
							rejected.push({ index, update, reason: 'value setter rejected change' });
							continue;
						}
						results.push(result);
						committed.push(result);
					}

					const invalidatedCells = committed.flatMap((result) => result.invalidatedCells);
					let batchInvalidations = createInvalidationsFromCells(invalidatedCells);
					if (committed.length > 0) {
						const structuralRowModel = asClientStructuralRowModel<TRowData>(commitContext.getRowModel());
						if (structuralRowModel) {
							const changedFieldsByRow = new Map<string, Set<string>>();
							for (const r of committed) {
								let fields = changedFieldsByRow.get(r.rowId);
								if (!fields) {
									fields = new Set();
									changedFieldsByRow.set(r.rowId, fields);
								}
								fields.add(r.colField);
							}
							const allFields = new Set<string>();
							for (const fields of changedFieldsByRow.values()) for (const f of fields) allFields.add(f);
							const impact = allFields.size > 0 ? structuralRowModel.classifyFieldMutation(allFields) : 'value-only';
							if (impact !== 'value-only') {
								requestLayoutTransitionCaptureForImpact(commitContext, impact);
								const nodes = [...new Set(committed.map((r) => r.rowId))]
									.map((id) => commitContext.getRowModel()!.getRowNodeById(id))
									.filter((n): n is NonNullable<typeof n> => n != null);
								const reconcileResult = structuralRowModel.reconcileAfterDataWrite(
									{
										updatedNodes: nodes,
										changedFieldsByRow,
										visualChange: 'none',
									},
									impact
								);
								if (reconcileResult.changed) {
									batchInvalidations = [
										...batchInvalidations,
										...createInvalidationsFromRefreshResult(reconcileResult, commitContext),
									];
								}
							}
						}
					}
					return {
						noop: committed.length === 0,
						domains: committed.length > 0 ? ['rows'] : [],
						invalidations: batchInvalidations,
						events: createEventsFromResults<TRowData>(committed),
						history:
							committed.length > 0 && mutation.undoable !== false
								? createBatchCellMutationHistory<TRowData>(
										'data:batch-cell-values',
										committed.map((result) => ({
											rowId: result.rowId,
											colField: result.colField,
											oldValue: result.oldRawValue,
											newValue: result.newRawValue,
										})),
										mutation.bypassValueSetter === true
									)
								: undefined,
						requestRender: committed.length > 0,
						rejections: rejected.map((entry) => ({
							mutationKind: 'batch-cell' as const,
							index: entry.index,
							reason: entry.reason,
						})),
						cellChanges: toCellChangeSet(invalidatedCells),
						result: { results, committed, rejected } satisfies BatchCellMutationExecutionResult,
					};
				},
				rollback(applied, commitContext) {
					const result = applied.result as BatchCellMutationExecutionResult | undefined;
					if (!result) return;
					rollbackAppliedCellResults(result.committed, commitContext, 'undo');
				},
			} satisfies PreparedBatchCellMutation<TRowData>;
		},
	};

	const rowOrderExecutor = createRowOrderMutationExecutor<TRowData>();
	const rowTransactionExecutor: GridDomainMutationExecutor<TRowData, RowTransactionMutation<TRowData>> = {
		validate(_mutation, context) {
			if (!asClientStructuralRowModel(context.getRowModel())) {
				return {
					ok: false,
					reason: 'row model does not implement TransactionalRowModel',
					rejection: { mutationKind: 'row-transaction', reason: 'row model does not implement TransactionalRowModel' },
				};
			}
			return { ok: true };
		},
		prepare(mutation, context) {
			const transaction = mutation.transaction;
			const hasWork =
				mutation.restoreSnapshot !== undefined ||
				(transaction.add?.length ?? 0) > 0 ||
				(transaction.remove?.length ?? 0) > 0 ||
				(transaction.update?.length ?? 0) > 0;
			if (!hasWork) {
				return {
					mutation,
					noop: true,
					domains: [],
					events: [],
					apply: () => ({ noop: true, result: { add: [], remove: [], update: [] } satisfies InternalRowNodeTransaction<TRowData> }),
				};
			}
			const rowModel = asClientStructuralRowModel(context.getRowModel())!;
			const preparedRestoreSnapshot = mutation.restoreSnapshot ?? rowModel.captureTransactionSnapshot(mutation);
			return {
				mutation,
				domains: ['rows', 'geometry'],
				events: [],
				requestRender: true,
				apply(context) {
					const structuralRowModel = asClientStructuralRowModel<TRowData>(context.getRowModel())!;
					if (mutation.restoreSnapshot) {
						structuralRowModel.restoreTransactionSnapshot(preparedRestoreSnapshot);
						structuralRowModel.reconcileAfterDataWrite({ visualChange: 'full' }, 'value-only');
						return {
							domains: ['rows', 'geometry'],
							invalidations: [{ kind: 'full', reason: 'data' }],
							requestRender: true,
							result: { add: [], remove: [], update: [] } satisfies InternalRowNodeTransaction<TRowData>,
						};
					}
					const txResult = structuralRowModel.applyTransactionStructurally(mutation.transaction);
					const writeEffects = context.applyStructuralWriteEffects?.(txResult);
					const hasStructural = (txResult.addedNodes?.length ?? 0) > 0 || (txResult.removedNodes?.length ?? 0) > 0;
					let impact: RowWriteImpact;
					if (hasStructural) {
						impact = 'insert';
					} else {
						const allFields = new Set<string>();
						if (txResult.changedFieldsByRow) {
							for (const fields of txResult.changedFieldsByRow.values()) {
								for (const f of fields) allFields.add(f);
							}
						}
						impact = allFields.size > 0 ? structuralRowModel.classifyFieldMutation(allFields) : 'value-only';
					}
					requestLayoutTransitionCaptureForImpact(context, impact);
					const reconcileResult = structuralRowModel.reconcileAfterDataWrite(txResult, impact);
					const invalidations = reconcileResult.changed ? createInvalidationsFromRefreshResult(reconcileResult, context) : [];
					const changed = txResult.visualChange !== 'none' || invalidations.length > 0;
					return {
						domains: ['rows', 'geometry'],
						invalidations,
						events: createRowsUpdatedEvents<TRowData>({
							changedValuesByRow: txResult.changedValuesByRow,
							changedNodes: txResult.update,
							addedNodes: txResult.add,
							removedNodes: txResult.remove,
						}),
						history: {
							undo: {
								reason: 'rows:apply-transaction',
								domainMutations: [
									{
										kind: 'row-transaction',
										transaction: { update: [] },
										restoreSnapshot: preparedRestoreSnapshot,
									},
								],
								requestRender: false,
							},
							redo: {
								reason: 'rows:apply-transaction',
								domainMutations: [mutation],
								requestRender: false,
							},
						},
						requestRender: changed,
						cellChanges: writeEffects?.cellChanges,
						result: { add: txResult.add, remove: txResult.remove, update: txResult.update },
					};
				},
				rollback(_applied, context) {
					asClientStructuralRowModel(context.getRowModel())!.restoreTransactionSnapshot(preparedRestoreSnapshot);
				},
			};
		},
	};

	const replaceRowsExecutor: GridDomainMutationExecutor<TRowData, ReplaceRowsMutation<TRowData>> = {
		validate(_mutation, context) {
			if (!asClientStructuralRowModel(context.getRowModel())) {
				return {
					ok: false,
					reason: 'replace-rows requires client row model',
					rejection: { mutationKind: 'replace-rows', reason: 'replace-rows requires client row model' },
				};
			}
			return { ok: true };
		},
		prepare(mutation, _context) {
			return {
				mutation,
				domains: ['rows', 'geometry'],
				events: [],
				requestRender: true,
				apply(commitContext) {
					const rowModel = asClientStructuralRowModel<TRowData>(commitContext.getRowModel())!;
					const writeResult = rowModel.replaceRowsStructurally(mutation.rows as TRowData[]);
					// Field-level effects for changed rows (getter caches, getter/formula dependents, row
					// versions) exactly as a row update; a full replace rebuilds the projection on top.
					const writeEffects = commitContext.applyStructuralWriteEffects?.(writeResult);
					const isFull = writeResult.visualChange === 'full';
					const allFields = new Set<string>();
					if (!isFull && writeResult.changedFieldsByRow) {
						for (const fields of writeResult.changedFieldsByRow.values()) for (const f of fields) allFields.add(f);
					}
					const impact: RowWriteImpact = isFull ? 'insert' : allFields.size > 0 ? rowModel.classifyFieldMutation(allFields) : 'value-only';
					if (!isFull) requestLayoutTransitionCaptureForImpact(commitContext, impact);
					const reconcileResult = rowModel.reconcileAfterDataWrite(writeResult, isFull ? 'value-only' : impact);
					const invalidations = reconcileResult.changed ? createInvalidationsFromRefreshResult(reconcileResult, commitContext) : [];
					// Rows added, removed or reordered: the reconcile may still see "no change" when only the
					// order moved, so the data invalidation guarantees the visible cells are rebuilt.
					if (isFull) invalidations.push({ kind: 'full', reason: 'data' });
					const changed = writeResult.visualChange !== 'none' || invalidations.length > 0;
					return {
						domains: changed ? (['rows', 'geometry'] as const) : ([] as const),
						invalidations,
						events: createRowsUpdatedEvents<TRowData>({
							changedValuesByRow: writeResult.changedValuesByRow,
							changedNodes: writeResult.updatedNodes,
							addedNodes: writeResult.addedNodes,
							removedNodes: writeResult.removedNodes,
						}),
						requestRender: changed,
						cellChanges: writeEffects?.cellChanges,
					};
				},
			};
		},
	};

	// One executor per mutation kind; the mapped type makes a kind without an executor a type error.
	const executors: {
		[K in GridDomainMutation<TRowData>['kind']]: GridDomainMutationExecutor<TRowData, Extract<GridDomainMutation<TRowData>, { kind: K }>>;
	} = {
		'cell-value': cellValueExecutor,
		'batch-cell': batchCellExecutor,
		'row-order': rowOrderExecutor,
		'row-transaction': rowTransactionExecutor,
		'replace-rows': replaceRowsExecutor,
		...createIntegrityMutationExecutors<TRowData>(),
	};

	return {
		resolve(mutation) {
			return (executors[mutation.kind as GridDomainMutation<TRowData>['kind']] ?? null) as GridDomainMutationExecutor<
				TRowData,
				typeof mutation
			> | null;
		},
	};
}
