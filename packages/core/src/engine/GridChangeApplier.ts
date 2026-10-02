import type { InternalGridState, GridStateUpdater } from '../state/GridState.js';
import type { GridEventPayloadMap } from '../api/GridEvents.js';
import { GridEventName } from '../api/GridEvents.js';
import type { StateManager } from '../state/StateManager.js';
import { normalizeInvalidationPlan, type InvalidationManager, type GridInvalidation } from '../renderer/invalidationManager.js';
import type { EventBus } from '../events/EventBus.js';
import type { CommandHistory } from '../commands/CommandHistory.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { RuntimeFault, RuntimeFaultReporter } from '../diagnostics/RuntimeFaultReporter.js';
import type {
	AppliedDomainMutation,
	GridCommitContext,
	GridDomainMutation,
	GridDomainMutationExecutorRegistry,
	PreparedDomainMutation,
} from './GridDomainMutation.js';
import type { StateCommitPhase } from '../state/StateManager.js';
import type { RowsUpdatedDispatchPayload } from './runtimePorts.js';
import type { GridCausalTraceSink } from '../diagnostics/GridCausalTrace.js';
import type { GridMutationRejection } from './GridDomainMutation.js';

export type GridCommitReason =
	| 'columns:set-data'
	| 'columns:resize'
	| 'columns:order'
	| 'columns:reorder-toggle'
	| 'columns:set'
	| 'grouping:set-group-by'
	| 'grouping:add-group-by'
	| 'grouping:remove-group-by'
	| 'grouping:move-group-by'
	| 'grouping:set'
	| 'hierarchy:set-tree-data'
	| 'hierarchy:set-aggregation'
	| 'hierarchy:set-detail'
	| 'hierarchy:set-column'
	| 'grouping:set-panel'
	| 'selection:set-range'
	| 'selection:rows'
	| 'editing:start'
	| 'editing:stop'
	| 'editing:validation'
	| 'editing:save-failed'
	| 'validation:cell'
	| 'validation:grid'
	| 'validation:clear-all'
	| 'rows:set-sort-model'
	| 'rows:set-filter-model'
	| 'rows:set-pagination-page'
	| 'rows:initialize-model'
	| 'rows:bump-global-version'
	| 'rows:set-order'
	| 'rows:apply-transaction'
	| 'rows:update-expansion'
	| 'rows:set-loading-state'
	| 'rows:set-server-pagination'
	| 'rows:register-model'
	| 'data:set-cell-value'
	| 'data:set-cell-value:undo'
	| 'data:set-cell-value:redo'
	| 'data:batch-cell-values'
	| 'data:batch-cell-values:undo'
	| 'data:batch-cell-values:redo'
	| 'integrity:validation:set-issues'
	| 'integrity:quality:set-issues'
	| 'integrity:diff:set-model'
	| 'integrity:diff:clear'
	| 'integrity:diff:resolve-cell'
	| 'integrity:conflict:add'
	| 'integrity:conflict:clear'
	| 'integrity:conflict:clear-all'
	| 'integrity:live-stream:set-session'
	| 'integrity:live-stream:set-issues'
	| 'integrity:publish-issues'
	| 'integrity:clear-published-issues'
	| 'integrity:server-report:set'
	| 'integrity:clear-all'
	| 'geometry:resize-row'
	| 'geometry:set-row-heights'
	| 'geometry:set-default-row-height'
	| 'columns:set-pinned-counts'
	| 'ui:set-style-rules'
	| 'ui:set-floating-filters'
	| 'ui:set-row-overscan'
	| 'ui:set-col-buffer'
	| 'ui:set-sidebar-panel'
	| 'ui:set-chart-open'
	| 'ui:set-theme'
	| 'viewport:set-visible-ranges'
	| (string & {});

export type GridChangeReason = GridCommitReason;

export type GridHistoryPolicy = 'record' | 'suppress';

type GridCommitPayload<
	TRowData = unknown,
	K extends keyof GridEventPayloadMap<TRowData> = keyof GridEventPayloadMap<TRowData>,
> = K extends GridEventName.rowsUpdated ? GridEventPayloadMap<TRowData>[K] | RowsUpdatedDispatchPayload<TRowData> : GridEventPayloadMap<TRowData>[K];

export type GridCommitEventPayloadResolver<
	TRowData = unknown,
	K extends keyof GridEventPayloadMap<TRowData> = keyof GridEventPayloadMap<TRowData>,
> = (state: Readonly<InternalGridState<TRowData>>) => GridCommitPayload<TRowData, K>;

export type GridCommitEvent<TRowData = unknown, K extends keyof GridEventPayloadMap<TRowData> = keyof GridEventPayloadMap<TRowData>> = {
	[Type in K]: {
		type: Type;
		payload: GridCommitPayload<TRowData, Type> | GridCommitEventPayloadResolver<TRowData, Type>;
	};
}[K];

export type GridChangeEvent<
	TRowData = unknown,
	K extends keyof GridEventPayloadMap<TRowData> = keyof GridEventPayloadMap<TRowData>,
> = GridCommitEvent<TRowData, K>;

export type GridCommitPrecondition<TRowData = unknown> = (state: Readonly<InternalGridState<TRowData>>) => true | string;
export type GridChangePrecondition<TRowData = unknown> = GridCommitPrecondition<TRowData>;

export interface GridHistoryMutation<TRowData = unknown> {
	reason: GridCommitReason;
	state?: GridStateUpdater<TRowData>;
	domainMutations?: readonly GridDomainMutation<TRowData>[];
	invalidations?: GridInvalidation[];
	domains?: ReadonlyArray<keyof GridDomainVersions>;
	events?: GridCommitEvent<TRowData>[];
	requestRender?: boolean;
	historyPolicy?: GridHistoryPolicy;
}

export interface GridHistoryEntry<TRowData = unknown> {
	undo: GridHistoryMutation<TRowData>;
	redo: GridHistoryMutation<TRowData>;
}

type GridCommitRejectionReason = string & {};

export type GridCommitResult =
	| {
			status: 'committed';
			changeId: number;
			faults: readonly RuntimeFault[];
			rejectedMutations?: readonly GridMutationRejection[];
	  }
	| { status: 'noop' }
	| { status: 'rejected'; reason: GridCommitRejectionReason; rejections?: readonly GridMutationRejection[] }
	| { status: 'failed-before-commit'; fault: RuntimeFault };

interface GridCommitRecord<TRowData = unknown> {
	changeId: number;
	reason: GridCommitReason;
	state?: GridStateUpdater<TRowData>;
	invalidations: GridInvalidation[];
	domains: ReadonlyArray<keyof GridDomainVersions>;
	events: GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	requestRender: boolean;
}

export interface GridCommitExecution<TRowData = unknown> {
	result: GridCommitResult;
	appliedMutations: readonly AppliedDomainMutation<TRowData>[];
}

export interface GridCommit<TRowData = unknown> {
	reason: GridCommitReason;
	state?: GridStateUpdater<TRowData>;
	domainMutations?: readonly GridDomainMutation<TRowData>[];
	invalidations?: GridInvalidation[];
	// Domain increments are declared on the change and applied by the commit protocol.
	domains?: ReadonlyArray<keyof GridDomainVersions>;
	events?: GridCommitEvent<TRowData>[];
	history?: GridHistoryEntry<TRowData>;
	precondition?: GridCommitPrecondition<TRowData>;
	requestRender?: boolean;
	historyPolicy?: GridHistoryPolicy;
}

export interface GridChange<TRowData = unknown> extends GridCommit<TRowData> {}

export interface GridCommitKernelDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	invalidation: InvalidationManager;
	eventBus: EventBus<TRowData>;
	dispatchEvent?: <K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridCommitPayload<TRowData, K>) => void;
	commandHistory: CommandHistory;
	requestRender: (commitReason: string, changeId?: number) => void;
	commitContext?: GridCommitContext<TRowData>;
	domainMutationExecutorRegistry?: GridDomainMutationExecutorRegistry<TRowData>;
	publishDomains?: (domains: readonly (keyof GridDomainVersions)[]) => void;
	projectStateChange?: (phase: StateCommitPhase<TRowData>) => void;
	faultReporter?: RuntimeFaultReporter<TRowData>;
	flightRecorder?: GridCausalTraceSink;
	/** Runs before every commit: flushes queued async row transactions so writes stay in call order. */
	beforeCommit?: () => void;
}

export type GridChangeApplierDeps<TRowData = unknown> = GridCommitKernelDeps<TRowData>;

class GridCommitRejectedError {
	constructor(readonly rejections: readonly GridMutationRejection[]) {}
}

export class GridCommitKernel<TRowData = unknown> {
	private nextChangeId = 1;
	private isReplayingHistory = false;

	constructor(private readonly deps: GridCommitKernelDeps<TRowData>) {}

	commit(change: GridCommit<TRowData>): GridCommitResult {
		return this.commitDetailed(change).result;
	}

	commitDetailed(change: GridCommit<TRowData>): GridCommitExecution<TRowData> {
		this.deps.beforeCommit?.();
		const attemptId = this.deps.flightRecorder?.beginCommitAttempt(change.reason);
		const validation = this.validate(change);
		if (validation.status === 'rejected') {
			this.traceOutcome(attemptId, 'rejected');
			return { result: validation.result, appliedMutations: [] };
		}

		const domainMutationResolution = this.resolveDomainMutations(change);
		if (domainMutationResolution.status !== 'ok') {
			this.traceOutcome(attemptId, domainMutationResolution.result.status);
			return { result: domainMutationResolution.result, appliedMutations: [] };
		}

		const appliedMutations: AppliedDomainMutation<TRowData>[] = [];
		let failureOperation: string | null = null;
		try {
			for (const preparedMutation of domainMutationResolution.preparedMutations) {
				failureOperation = `apply-domain:${preparedMutation.mutation.kind}`;
				const appliedMutation = preparedMutation.apply(this.deps.commitContext!);
				if (appliedMutation.noop === true && (appliedMutation.rejections?.length ?? 0) > 0) {
					throw new GridCommitRejectedError(appliedMutation.rejections!);
				}
				appliedMutations.push(appliedMutation);
			}
			const mutationState = appliedMutations
				.map((mutation) => mutation.state)
				.filter((state): state is GridStateUpdater<TRowData> => state !== undefined);
			const mergedState =
				mutationState.length === 0
					? change.state
					: mutationState.reduce<GridStateUpdater<TRowData>>((acc, next) => this.composeStateUpdaters(acc, next), change.state ?? {});
			if (mergedState !== undefined) {
				failureOperation = 'commit-state';
				this.deps.stateManager.commitState(mergedState, (phase) => {
					this.deps.projectStateChange?.(phase);
				});
			}
		} catch (error) {
			const primaryRejections = error instanceof GridCommitRejectedError ? error.rejections : undefined;
			const primaryFault =
				error instanceof GridCommitRejectedError
					? null
					: this.reportFault(failureOperation ?? 'commit-domain', error, { reason: change.reason });
			const rollbackFaults: RuntimeFault[] = [];
			for (let index = appliedMutations.length - 1; index >= 0; index--) {
				const preparedMutation = domainMutationResolution.preparedMutations[index];
				const appliedMutation = appliedMutations[index];
				if (!preparedMutation?.rollback || !appliedMutation) continue;
				try {
					preparedMutation.rollback(appliedMutation, this.deps.commitContext!);
				} catch (rollbackError) {
					rollbackFaults.push(
						this.reportFault(`rollback-domain:${preparedMutation.mutation.kind}`, rollbackError, { reason: change.reason })
					);
				}
			}
			if (rollbackFaults.length === 0) {
				if (primaryRejections) {
					this.traceOutcome(attemptId, 'rejected');
					return {
						result: {
							status: 'rejected',
							reason: primaryRejections[0]?.reason ?? 'mutation rejected',
							rejections: primaryRejections,
						},
						appliedMutations: [],
					};
				}
				this.traceOutcome(attemptId, 'failed-before-commit');
				return {
					result: { status: 'failed-before-commit', fault: primaryFault! },
					appliedMutations: [],
				};
			}
			const committedChangeId = this.nextChangeId++;
			this.traceOutcome(attemptId, 'committed-with-faults', committedChangeId, change.domains ?? []);
			return {
				result: {
					status: 'committed',
					changeId: committedChangeId,
					faults: primaryFault ? [primaryFault, ...rollbackFaults] : rollbackFaults,
					rejectedMutations: this.collectRejectedMutations(appliedMutations),
				},
				appliedMutations,
			};
		}

		const record = this.toCommitRecord(change, appliedMutations);
		if (!record) {
			this.traceOutcome(attemptId, 'noop');
			return { result: { status: 'noop' }, appliedMutations };
		}

		const faults: RuntimeFault[] = [];
		const isolate = (operation: string, work: () => void): void => {
			try {
				work();
			} catch (error) {
				faults.push(this.reportFault(operation, error, { reason: record.reason, changeId: record.changeId }));
			}
		};

		// 2. Increment declared domain versions before consumer-visible effects.
		if (record.domains.length > 0 && this.deps.publishDomains) {
			isolate('publish-domains', () => {
				this.deps.publishDomains!(record.domains);
			});
		}
		// 3. Normalize then apply invalidation plan atomically.
		if (record.invalidations.length > 0) {
			isolate('apply-invalidations', () => {
				const normalized = normalizeInvalidationPlan(record.invalidations);
				this.deps.invalidation.applyNormalizedPlan(normalized);
			});
			this.deps.flightRecorder?.record(() => ({
				type: 'invalidation',
				changeId: record.changeId,
				reason: record.reason,
				domains: record.domains.map(String),
			}));
		}
		const cellChanges = this.mergeCellChanges(appliedMutations);
		if (this.deps.flightRecorder?.isActive() && cellChanges.size > 0) {
			for (const [rowId, fields] of cellChanges) {
				for (const colField of fields) {
					const cell = { rowId, colField };
					const value = this.deps.flightRecorder.captureValue(this.deps.commitContext?.getCellValue?.(rowId, colField), cell);
					this.deps.flightRecorder.record(() => ({ type: 'cell-change', changeId: record.changeId, cell, value }));
				}
			}
		}
		if (cellChanges.size > 0 && this.deps.commitContext?.publishCommittedCellChanges) {
			isolate('publish-cell-changes', () => {
				this.deps.commitContext!.publishCommittedCellChanges!(cellChanges);
			});
		}
		// 4. Register a bounded history record.
		if (record.history) {
			isolate('register-history', () => {
				this.deps.commandHistory.add({
					undo: () => this.applyHistoryMutation(record.history!.undo),
					redo: () => this.applyHistoryMutation(record.history!.redo),
				});
			});
		}
		// 5. Request rendering before user events so listeners cannot block scheduling.
		if (record.requestRender) {
			isolate('request-render', () => {
				this.deps.requestRender(record.reason, record.changeId);
			});
		}
		// 6. Dispatch events after state is durable and render is scheduled.
		if (record.events.length > 0) {
			isolate('dispatch-events', () => {
				for (const event of record.events) {
					const payload =
						typeof event.payload === 'function'
							? (event.payload as GridCommitEventPayloadResolver<TRowData, typeof event.type>)(this.deps.stateManager.getState())
							: event.payload;
					if (this.deps.dispatchEvent) {
						this.deps.dispatchEvent(event.type, payload);
					} else {
						this.deps.eventBus.dispatchEvent(event.type, payload as GridEventPayloadMap<TRowData>[typeof event.type]);
					}
				}
			});
		}

		this.deps.flightRecorder?.finishCommitAttempt(attemptId, 'committed', record.changeId, record.domains.map(String));
		return {
			result: {
				status: 'committed',
				changeId: record.changeId,
				faults,
				rejectedMutations: this.collectRejectedMutations(appliedMutations),
			},
			appliedMutations,
		};
	}

	private traceOutcome(
		attemptId: number | undefined,
		outcome: string,
		changeId?: number,
		domains: readonly (keyof GridDomainVersions)[] = []
	): void {
		this.deps.flightRecorder?.finishCommitAttempt(attemptId, outcome, changeId, domains.map(String));
	}

	apply(change: GridChange<TRowData>): GridCommitResult {
		return this.commit(change);
	}

	private validate(change: GridCommit<TRowData>): { status: 'ok' } | { status: 'rejected'; result: GridCommitResult } {
		if (!change.precondition) return { status: 'ok' };
		try {
			const result = change.precondition(this.deps.stateManager.getState());
			if (result === true) return { status: 'ok' };
			return { status: 'rejected', result: { status: 'rejected', reason: result } };
		} catch (error) {
			return {
				status: 'rejected',
				result: {
					status: 'failed-before-commit',
					fault: this.reportFault('validate-precondition', error, { reason: change.reason }),
				},
			};
		}
	}

	private toCommitRecord(
		change: GridCommit<TRowData>,
		appliedMutations: readonly AppliedDomainMutation<TRowData>[] = []
	): GridCommitRecord<TRowData> | null {
		const mutationState = appliedMutations
			.map((mutation) => mutation.state)
			.filter((state): state is GridStateUpdater<TRowData> => state !== undefined);
		const mergedState =
			mutationState.length === 0
				? change.state
				: mutationState.reduce<GridStateUpdater<TRowData>>((acc, next) => this.composeStateUpdaters(acc, next), change.state ?? {});
		const invalidations = [...appliedMutations.flatMap((mutation) => mutation.invalidations ?? []), ...(change.invalidations ?? [])];
		const domains = [...appliedMutations.flatMap((mutation) => mutation.domains ?? []), ...(change.domains ?? [])];
		const events = [...appliedMutations.flatMap((mutation) => mutation.events ?? []), ...(change.events ?? [])];
		const shouldSuppressHistory = change.historyPolicy === 'suppress' || this.isReplayingHistory;
		const history = shouldSuppressHistory ? undefined : this.mergeHistoryEntries(change.reason, appliedMutations, change.history);
		const semanticWork =
			appliedMutations.some((mutation) => mutation.noop !== true) ||
			mergedState !== undefined ||
			invalidations.length > 0 ||
			domains.length > 0 ||
			events.length > 0 ||
			history !== undefined;
		const hasInvalidations = invalidations.length > 0 || appliedMutations.some((mutation) => mutation.requestRender === true);
		const shouldScheduleRender = change.requestRender === false ? false : hasInvalidations || change.requestRender === true;
		const record: GridCommitRecord<TRowData> = {
			changeId: this.nextChangeId++,
			reason: change.reason,
			state: mergedState,
			invalidations,
			domains,
			events,
			history,
			requestRender: shouldScheduleRender,
		};

		const hasWork = semanticWork || record.requestRender;

		return hasWork ? record : null;
	}

	private applyHistoryMutation(change: GridHistoryMutation<TRowData>): GridCommitResult {
		const wasReplaying = this.isReplayingHistory;
		this.isReplayingHistory = true;
		try {
			return this.commit({
				reason: change.reason,
				state: change.state,
				domainMutations: change.domainMutations,
				invalidations: change.invalidations,
				domains: change.domains,
				events: change.events,
				requestRender: change.requestRender,
				historyPolicy: 'suppress',
			});
		} finally {
			this.isReplayingHistory = wasReplaying;
		}
	}

	private resolveDomainMutations(
		change: GridCommit<TRowData>
	): { status: 'ok'; preparedMutations: readonly PreparedDomainMutation<TRowData>[] } | { status: 'rejected'; result: GridCommitResult } {
		if (!change.domainMutations || change.domainMutations.length === 0) {
			return { status: 'ok', preparedMutations: [] };
		}
		if (!this.deps.commitContext || !this.deps.domainMutationExecutorRegistry) {
			return { status: 'rejected', result: { status: 'rejected', reason: 'domain mutation registry unavailable' } };
		}

		const preparedMutations: PreparedDomainMutation<TRowData>[] = [];
		for (let index = 0; index < change.domainMutations.length; index++) {
			const mutation = change.domainMutations[index]!;
			const executor = this.deps.domainMutationExecutorRegistry.resolve(mutation);
			if (!executor) {
				return {
					status: 'rejected',
					result: { status: 'rejected', reason: `no executor registered for domain mutation "${mutation.kind}"` },
				};
			}
			let validation;
			try {
				validation = executor.validate(mutation as never, this.deps.commitContext);
			} catch (error) {
				return {
					status: 'rejected',
					result: {
						status: 'failed-before-commit',
						fault: this.reportFault(`validate-domain:${mutation.kind}`, error, { reason: change.reason, index }),
					},
				};
			}
			if (!validation.ok) {
				return {
					status: 'rejected',
					result: { status: 'rejected', reason: validation.reason, rejections: validation.rejection ? [validation.rejection] : undefined },
				};
			}
			try {
				preparedMutations.push(executor.prepare(mutation as never, this.deps.commitContext));
			} catch (error) {
				return {
					status: 'rejected',
					result: {
						status: 'failed-before-commit',
						fault: this.reportFault(`prepare-domain:${mutation.kind}`, error, { reason: change.reason, index }),
					},
				};
			}
		}
		return { status: 'ok', preparedMutations };
	}

	private mergeHistoryEntries(
		reason: GridCommitReason,
		appliedMutations: readonly AppliedDomainMutation<TRowData>[],
		history?: GridHistoryEntry<TRowData>
	): GridHistoryEntry<TRowData> | undefined {
		const mutationHistories = appliedMutations
			.map((mutation) => mutation.history)
			.filter((entry): entry is GridHistoryEntry<TRowData> => entry !== undefined);
		const allHistories = history ? [...mutationHistories, history] : mutationHistories;
		if (allHistories.length === 0) return undefined;
		if (allHistories.length === 1) return allHistories[0];

		return {
			undo: this.combineHistoryMutations(reason, allHistories.map((entry) => entry.undo).reverse()),
			redo: this.combineHistoryMutations(
				reason,
				allHistories.map((entry) => entry.redo)
			),
		};
	}

	private composeStateUpdaters(left: GridStateUpdater<TRowData>, right: GridStateUpdater<TRowData>): GridStateUpdater<TRowData> {
		if (typeof left === 'function' || typeof right === 'function') {
			return (state) => {
				const leftValue = typeof left === 'function' ? left(state) : left;
				const baseState = { ...state, ...leftValue };
				const rightValue = typeof right === 'function' ? right(baseState) : right;
				return { ...leftValue, ...rightValue };
			};
		}
		return { ...left, ...right };
	}

	private reportFault(operation: string, error: unknown, context?: Record<string, unknown>): RuntimeFault {
		if (this.deps.faultReporter) {
			return this.deps.faultReporter.report({
				source: 'grid-change',
				operation,
				error,
				context,
			});
		}
		return {
			id: -1,
			timestamp: Date.now(),
			source: 'grid-change',
			operation,
			message: error instanceof Error && error.message ? error.message : typeof error === 'string' ? error : 'Unknown runtime fault',
			error,
			context,
		};
	}

	private combineHistoryMutations(reason: GridCommitReason, mutations: readonly GridHistoryMutation<TRowData>[]): GridHistoryMutation<TRowData> {
		let state: GridStateUpdater<TRowData> | undefined;
		const domainMutations: GridDomainMutation<TRowData>[] = [];
		const invalidations: GridInvalidation[] = [];
		const domains: Array<keyof GridDomainVersions> = [];
		const events: GridCommitEvent<TRowData>[] = [];
		for (const mutation of mutations) {
			if (mutation.state !== undefined) {
				state = state === undefined ? mutation.state : this.composeStateUpdaters(state, mutation.state);
			}
			if (mutation.domainMutations) domainMutations.push(...mutation.domainMutations);
			if (mutation.invalidations) invalidations.push(...mutation.invalidations);
			if (mutation.domains) domains.push(...mutation.domains);
			if (mutation.events) events.push(...mutation.events);
		}
		return {
			reason,
			state,
			domainMutations: domainMutations.length > 0 ? domainMutations : undefined,
			invalidations: invalidations.length > 0 ? invalidations : undefined,
			domains: domains.length > 0 ? domains : undefined,
			events: events.length > 0 ? events : undefined,
			requestRender: false,
		};
	}

	private collectRejectedMutations(appliedMutations: readonly AppliedDomainMutation<TRowData>[]): readonly GridMutationRejection[] | undefined {
		const rejections = appliedMutations.flatMap((mutation) => mutation.rejections ?? []);
		return rejections.length > 0 ? rejections : undefined;
	}

	private mergeCellChanges(appliedMutations: readonly AppliedDomainMutation<TRowData>[]): Map<string, Set<string>> {
		const merged = new Map<string, Set<string>>();
		for (const mutation of appliedMutations) {
			if (!mutation.cellChanges) continue;
			for (const [rowId, fields] of mutation.cellChanges) {
				let target = merged.get(rowId);
				if (!target) {
					target = new Set<string>();
					merged.set(rowId, target);
				}
				for (const field of fields) target.add(field);
			}
		}
		return merged;
	}
}

export class GridChangeApplier<TRowData = unknown> extends GridCommitKernel<TRowData> {}
