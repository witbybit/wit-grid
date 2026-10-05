import type {
	GridDomainMutation,
	GridDomainMutationExecutor,
	PreparedDomainMutation,
	IntegrityClearAllMutation,
	IntegrityClearConflictMutation,
	IntegrityClearConflictsMutation,
	IntegrityClearPublishedIssuesMutation,
	IntegrityPublishIssuesMutation,
	IntegrityResolveCellDiffMutation,
	IntegritySetDiffStateMutation,
	IntegritySetLiveStreamIssuesMutation,
	IntegritySetLiveStreamSessionMutation,
	IntegritySetQualityIssuesMutation,
	IntegritySetServerReportMutation,
	IntegritySetValidationIssuesMutation,
	IntegrityUpsertConflictMutation,
} from './GridDomainMutation.js';
import type { GridIntegrityState, InternalGridState } from '../state/GridState.js';
import type { GridCellConflict, GridIntegrityIssue, GridIntegrityIssueSource, GridIntegritySummary } from '../state/integrityStateTypes.js';
import type { GridIntegrityIssueFilter } from '../features/dataIntegrity/integrityTypes.js';

/** The data-integrity domain's mutation executors (validation, quality, diff, conflicts, live stream, published issues), by mutation kind. */
export function createIntegrityMutationExecutors<TRowData>() {
	const validationIssuesExecutor: GridDomainMutationExecutor<TRowData, IntegritySetValidationIssuesMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => ({
				...integrity,
				validation: {
					issues: mutation.issues.slice(),
					cellErrorIndex: buildValidationCellErrorIndex(mutation.issues),
				},
			}));
		},
	};

	const qualityIssuesExecutor: GridDomainMutationExecutor<TRowData, IntegritySetQualityIssuesMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => ({
				...integrity,
				quality: {
					issues: mutation.issues.slice(),
				},
			}));
		},
	};

	const diffStateExecutor: GridDomainMutationExecutor<TRowData, IntegritySetDiffStateMutation<TRowData>> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => ({
				...integrity,
				diff: {
					model: mutation.model,
					result: mutation.result,
					cellDiffIndex: { ...mutation.cellDiffIndex },
				},
			}));
		},
	};

	const resolveCellDiffExecutor: GridDomainMutationExecutor<TRowData, IntegrityResolveCellDiffMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => {
				const key = `${mutation.rowId}\0${mutation.colField}`;
				const nextCellDiffIndex = { ...integrity.diff.cellDiffIndex };
				delete nextCellDiffIndex[key];
				const currentResult = integrity.diff.result;
				if (!currentResult) {
					return {
						...integrity,
						diff: {
							...integrity.diff,
							cellDiffIndex: nextCellDiffIndex,
						},
					};
				}

				const changedCells = currentResult.changedCells.filter(
					(cell) => !(cell.rowId === mutation.rowId && cell.colField === mutation.colField)
				);
				const changedRows = changedCells.some((cell) => cell.rowId === mutation.rowId)
					? currentResult.changedRows
					: currentResult.changedRows.filter((rowId) => rowId !== mutation.rowId);

				return {
					...integrity,
					diff: {
						...integrity.diff,
						result: {
							...currentResult,
							changedCells,
							changedRows,
						},
						cellDiffIndex: nextCellDiffIndex,
					},
				};
			});
		},
	};

	const upsertConflictExecutor: GridDomainMutationExecutor<TRowData, IntegrityUpsertConflictMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => {
				const cellKey = `${mutation.conflict.rowId}\0${mutation.conflict.colField}`;
				const existingId = integrity.conflicts.cellConflictIndex[cellKey];
				const conflicts = integrity.conflicts.conflicts
					.filter((conflict) => conflict.id !== existingId && conflict.id !== mutation.conflict.id)
					.concat(mutation.conflict);

				return {
					...integrity,
					conflicts: {
						conflicts,
						cellConflictIndex: buildConflictCellIndex(conflicts),
						resolvedConflicts: integrity.conflicts.resolvedConflicts,
						lastConflictAt: mutation.conflict.createdAt,
					},
				};
			});
		},
	};

	const clearConflictExecutor: GridDomainMutationExecutor<TRowData, IntegrityClearConflictMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => {
				const existing = integrity.conflicts.conflicts.find((conflict) => conflict.id === mutation.conflictId);
				if (!existing) return integrity;
				const conflicts = integrity.conflicts.conflicts.filter((conflict) => conflict.id !== mutation.conflictId);
				return {
					...integrity,
					conflicts: {
						conflicts,
						cellConflictIndex: buildConflictCellIndex(conflicts),
						resolvedConflicts: integrity.conflicts.resolvedConflicts + 1,
						lastConflictAt: integrity.conflicts.lastConflictAt,
					},
				};
			});
		},
	};

	const clearConflictsExecutor: GridDomainMutationExecutor<TRowData, IntegrityClearConflictsMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => ({
				...integrity,
				conflicts: {
					conflicts: [],
					cellConflictIndex: {},
					resolvedConflicts: integrity.conflicts.resolvedConflicts,
					lastConflictAt: integrity.conflicts.lastConflictAt,
				},
			}));
		},
	};

	const liveStreamSessionExecutor: GridDomainMutationExecutor<TRowData, IntegritySetLiveStreamSessionMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => ({
				...integrity,
				liveStream: {
					...integrity.liveStream,
					session: mutation.session,
				},
			}));
		},
	};

	const liveStreamIssuesExecutor: GridDomainMutationExecutor<TRowData, IntegritySetLiveStreamIssuesMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => ({
				...integrity,
				liveStream: {
					...integrity.liveStream,
					issues: mutation.issues.slice(),
				},
			}));
		},
	};

	const publishIssuesExecutor: GridDomainMutationExecutor<TRowData, IntegrityPublishIssuesMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => {
				const existing = integrity.publishedIssues[mutation.source] ?? [];
				return {
					...integrity,
					publishedIssues: {
						...integrity.publishedIssues,
						[mutation.source]: mutation.append === false ? mutation.issues.slice() : [...existing, ...mutation.issues],
					},
				};
			});
		},
	};

	const clearPublishedIssuesExecutor: GridDomainMutationExecutor<TRowData, IntegrityClearPublishedIssuesMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => {
				if (!mutation.filter) {
					return {
						...integrity,
						publishedIssues: {},
					};
				}
				const publishedIssues: Partial<Record<GridIntegrityIssueSource, readonly GridIntegrityIssue[]>> = {};
				for (const [source, issues] of Object.entries(integrity.publishedIssues) as [
					GridIntegrityIssueSource,
					readonly GridIntegrityIssue[],
				][]) {
					const kept = issues.filter((issue) => !matchesIntegrityFilter(issue, mutation.filter!));
					if (kept.length > 0) {
						publishedIssues[source] = kept;
					}
				}
				return {
					...integrity,
					publishedIssues,
				};
			});
		},
	};

	const serverReportExecutor: GridDomainMutationExecutor<TRowData, IntegritySetServerReportMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => ({
				...integrity,
				serverReport: mutation.report,
			}));
		},
	};

	const clearAllIntegrityExecutor: GridDomainMutationExecutor<TRowData, IntegrityClearAllMutation> = {
		validate() {
			return { ok: true };
		},
		prepare(mutation) {
			return createIntegrityPreparedMutation(mutation, (integrity) => ({
				...integrity,
				validation: { issues: [], cellErrorIndex: {} },
				quality: { issues: [] },
				diff: { model: null, result: null, cellDiffIndex: {} },
				conflicts: {
					conflicts: [],
					cellConflictIndex: {},
					resolvedConflicts: integrity.conflicts.resolvedConflicts,
					lastConflictAt: integrity.conflicts.lastConflictAt,
				},
				liveStream: {
					issues: [],
					session: integrity.liveStream.session,
				},
				publishedIssues: {},
				serverReport: null,
			}));
		},
	};

	return {
		'integrity-set-validation-issues': validationIssuesExecutor,
		'integrity-set-quality-issues': qualityIssuesExecutor,
		'integrity-set-diff-state': diffStateExecutor,
		'integrity-resolve-cell-diff': resolveCellDiffExecutor,
		'integrity-upsert-conflict': upsertConflictExecutor,
		'integrity-clear-conflict': clearConflictExecutor,
		'integrity-clear-conflicts': clearConflictsExecutor,
		'integrity-set-live-stream-session': liveStreamSessionExecutor,
		'integrity-set-live-stream-issues': liveStreamIssuesExecutor,
		'integrity-publish-issues': publishIssuesExecutor,
		'integrity-clear-published-issues': clearPublishedIssuesExecutor,
		'integrity-set-server-report': serverReportExecutor,
		'integrity-clear-all': clearAllIntegrityExecutor,
	};
}

function createIntegrityPreparedMutation<TRowData, TMutation extends GridDomainMutation<TRowData>>(
	mutation: TMutation,
	updateIntegrity: (integrity: GridIntegrityState<TRowData>) => GridIntegrityState<TRowData>
): PreparedDomainMutation<TRowData, TMutation> {
	return {
		mutation,
		domains: [],
		events: [],
		apply() {
			return {
				state: (state: InternalGridState<TRowData>) => ({
					integrity: withIntegritySummary(updateIntegrity(state.integrity)),
				}),
			};
		},
	};
}

function withIntegritySummary<TRowData>(integrity: GridIntegrityState<TRowData>): GridIntegrityState<TRowData> {
	return {
		...integrity,
		summary: buildIntegritySummary(collectIntegrityIssues(integrity)),
	};
}

function collectIntegrityIssues<TRowData>(integrity: GridIntegrityState<TRowData>): GridIntegrityIssue[] {
	const issues: GridIntegrityIssue[] = [];
	issues.push(...integrity.validation.issues);
	issues.push(...integrity.quality.issues);
	if (integrity.diff.result) {
		for (const cell of integrity.diff.result.changedCells) {
			issues.push({
				id: `diff:changed:${cell.rowId}:${cell.colField}`,
				source: 'diff',
				type: 'diffChanged',
				severity: 'info',
				blocking: false,
				rowId: cell.rowId,
				colField: cell.colField,
				message: `Changed: ${formatIntegrityValue(cell.oldValue)} -> ${formatIntegrityValue(cell.newValue)}`,
				value: cell.newValue,
				createdAt: 0,
				data: cell,
			});
		}
		for (const rowId of integrity.diff.result.addedRows) {
			issues.push({
				id: `diff:added:${rowId}`,
				source: 'diff',
				type: 'diffAdded',
				severity: 'info',
				blocking: false,
				rowId,
				message: 'Row added',
				createdAt: 0,
			});
		}
		for (const rowId of integrity.diff.result.removedRows) {
			issues.push({
				id: `diff:removed:${rowId}`,
				source: 'diff',
				type: 'diffRemoved',
				severity: 'info',
				blocking: false,
				rowId,
				message: 'Row removed',
				createdAt: 0,
			});
		}
	}
	for (const conflict of integrity.conflicts.conflicts) {
		issues.push({
			id: `conflict:${conflict.id}`,
			source: 'conflict',
			type: 'conflict',
			severity: 'error',
			blocking: true,
			rowId: conflict.rowId,
			colField: conflict.colField,
			message:
				conflict.message ??
				`Conflict: local ${formatIntegrityValue(conflict.localValue)} vs remote ${formatIntegrityValue(conflict.remoteValue)}`,
			createdAt: conflict.createdAt,
			data: conflict,
		});
	}
	issues.push(...integrity.liveStream.issues);
	for (const sourceIssues of Object.values(integrity.publishedIssues)) {
		if (sourceIssues) issues.push(...sourceIssues);
	}
	if (integrity.serverReport) {
		issues.push(...integrity.serverReport.issues);
	}
	return issues;
}

function buildIntegritySummary(issues: readonly GridIntegrityIssue[]): GridIntegritySummary {
	const blocking = issues.filter((issue) => issue.blocking).length;
	const errors = issues.filter((issue) => issue.severity === 'error').length;
	const warnings = issues.filter((issue) => issue.severity === 'warning').length;
	const bySource: Partial<Record<GridIntegrityIssueSource, number>> = {};
	for (const issue of issues) {
		bySource[issue.source] = (bySource[issue.source] ?? 0) + 1;
	}

	let status: GridIntegritySummary['status'] = 'clean';
	if (blocking > 0 || errors > 0) status = 'blocked';
	else if (warnings > 0) status = 'warning';

	return {
		status,
		totalIssues: issues.length,
		blockingIssues: blocking,
		warnings,
		errors,
		bySource,
	};
}

function buildValidationCellErrorIndex(issues: readonly GridIntegrityIssue[]): Record<string, GridIntegrityIssue> {
	const index: Record<string, GridIntegrityIssue> = {};
	for (const issue of issues) {
		if (issue.rowId && issue.colField) {
			index[`${issue.rowId}:${issue.colField}`] = issue;
		}
	}
	return index;
}

function buildConflictCellIndex(conflicts: readonly GridCellConflict[]): Record<string, string> {
	const index: Record<string, string> = {};
	for (const conflict of conflicts) {
		index[`${conflict.rowId}\0${conflict.colField}`] = conflict.id;
	}
	return index;
}

function matchesIntegrityFilter(issue: GridIntegrityIssue, filter: GridIntegrityIssueFilter): boolean {
	if (filter.rowId !== undefined && issue.rowId !== filter.rowId) return false;
	if (filter.colField !== undefined && issue.colField !== filter.colField) return false;
	if (filter.severity !== undefined && issue.severity !== filter.severity) return false;
	if (filter.blockingOnly && !issue.blocking) return false;
	if (filter.source !== undefined) {
		const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
		if (!sources.includes(issue.source)) return false;
	}
	if (filter.type !== undefined) {
		const types = Array.isArray(filter.type) ? filter.type : [filter.type];
		if (!types.includes(issue.type)) return false;
	}
	return true;
}

function formatIntegrityValue(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	return String(value);
}
