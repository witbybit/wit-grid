import type { GridInsightLayer, GridCellDecoration, GridRowDecoration } from '../../insights/insightTypes.js';
import type { GridFeatureContext } from '../GridFeatureContext.js';
import type { DataModel } from '../../models/DataModel.js';
import type { RowModel } from '../../rowModel.js';
import type { GridApi } from '../../api/GridApi.js';
import type { GridScheduler } from '../../renderer/gridScheduler.js';
import type { GridCapabilityManager } from '../../capabilities/GridCapabilityManager.js';
import type {
	GridDataIntegrityConfig,
	GridIntegrityIssue,
	GridIntegrityIssueFilter,
	GridIntegrityIssueSource,
	GridIntegritySeverity,
	GridIntegritySummary,
	GridIntegrityRunOptions,
	GridIntegrityRunResult,
	GridIntegrityScope,
	GridIntegrityModuleId,
	GridDiffModel,
	GridDiffResult,
	GridDiffAcceptResult,
	GridCellDiff,
	GridLiveStreamOptions,
	GridTransactionStreamHandle,
	GridTransactionStreamState,
	GridCellConflict,
	ResolveConflictOptions,
	ConflictResolutionResult,
	ServerIntegrityReport,
	GridIntegrityApi,
	GridCommitResult,
	GridValidateCellProposalParams,
	IntegrityRepaintRequest,
} from './integrityTypes.js';
import type { GridWriteResult } from '../../api/GridApi.js';
import type { GridIntegrityRowProvider } from './integrityTypes.js';
import { ValidationIntegrityModule } from './modules/ValidationIntegrityModule.js';
import type { ValidationModuleDeps } from './modules/ValidationIntegrityModule.js';
import { QualityIntegrityModule } from './modules/QualityIntegrityModule.js';
import { DiffIntegrityModule } from './modules/DiffIntegrityModule.js';
import { readInteractionState } from '../../interaction/interactionState.js';
import { LiveStreamIntegrityModule } from './modules/LiveStreamIntegrityModule.js';
import { ConflictIntegrityModule } from './modules/ConflictIntegrityModule.js';
import { doesCanonicalCellPointerMatchColumn } from '../../interaction/cellPointer.js';

let _publishedIssueSeq = 0;
function nextPublishedIssueId(): string {
	return `ig-${++_publishedIssueSeq}`;
}

export interface GridDataIntegrityManagerDeps<TRowData> {
	ctx: GridFeatureContext<TRowData>;
	data: DataModel<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	getApi: () => GridApi<TRowData>;
	scheduler: GridScheduler;
	rowProvider: GridIntegrityRowProvider<TRowData>;
	capabilityManager: GridCapabilityManager<TRowData>;
	commitCells: (updates: readonly { rowId: string; colField: string; value: unknown }[]) => GridWriteResult;
	applyRowPatch: (rowId: string, patch: Partial<TRowData>) => GridWriteResult;
	requestIntegrityRepaint: (request: IntegrityRepaintRequest) => void;
}

export class GridDataIntegrityManager<TRowData> implements GridInsightLayer {
	public readonly id = 'dataIntegrity' as const;

	/** @internal exposed for GridEngine to route post-edit validateCell to the integrity pipeline */
	public readonly validationModule: ValidationIntegrityModule<TRowData> | null;
	private readonly qualityModule: QualityIntegrityModule<TRowData> | null;
	private readonly diffModule: DiffIntegrityModule<TRowData> | null;
	private readonly liveStreamModule: LiveStreamIntegrityModule<TRowData> | null;
	private readonly conflictModule: ConflictIntegrityModule<TRowData> | null;

	constructor(
		config: GridDataIntegrityConfig<TRowData>,
		private readonly deps: GridDataIntegrityManagerDeps<TRowData>
	) {
		const requestRepaint = (cells?: Array<{ rowId: string; colField: string }>) => {
			deps.requestIntegrityRepaint({ reason: 'module-repaint', cells });
		};

		const commitCellValue = async (rowId: string, colField: string, value: unknown): Promise<GridCommitResult> =>
			deps.getApi().setCellValue(rowId, colField, value);

		// Validation module
		const validationConfig = _normalizeModuleConfig(config.validation);
		if (validationConfig) {
			const validationDeps: ValidationModuleDeps<TRowData> = {
				ctx: deps.ctx,
				getRowModel: deps.getRowModel,
				data: deps.data,
				getApi: deps.getApi,
				getIntegrityState: () => deps.ctx.getState().integrity,
				requestRepaint,
			};
			this.validationModule = new ValidationIntegrityModule<TRowData>(validationConfig, validationDeps);
		} else {
			this.validationModule = null;
		}

		// Conflict module (created before liveStream since liveStream references it)
		const conflictConfig = _normalizeModuleConfig(config.conflicts);
		if (conflictConfig) {
			this.conflictModule = new ConflictIntegrityModule<TRowData>(conflictConfig, {
				applyIntegrityChange: (change) => deps.ctx.applyChange(change),
				getIntegrityState: () => deps.ctx.getState().integrity,
				commitCellValue,
				validateCellProposal: this.validationModule ? (params) => this.validationModule!.validateCellProposal(params) : undefined,
				canEdit: (rowId, colField) => deps.capabilityManager.can('edit', { rowId, colField }).allowed,
				requestRepaint,
			});
		} else {
			this.conflictModule = null;
		}

		// Live stream module
		const liveStreamConfig = _normalizeModuleConfig(config.liveStream);
		if (liveStreamConfig) {
			this.liveStreamModule = new LiveStreamIntegrityModule<TRowData>(liveStreamConfig, {
				applyIntegrityChange: (change) => deps.ctx.applyChange(change),
				getIntegrityState: () => deps.ctx.getState().integrity,
				commitCells: deps.commitCells,
				applyRowPatch: deps.applyRowPatch,
				getRawCellValue: (rowId, colField) => deps.data.getRawCellValue(rowId, colField),
				isCellDirty: (rowId, colField) => this._isCellDirty(rowId, colField),
				getConflictModule: () => this.conflictModule,
				requestRepaint,
				scheduler: deps.scheduler,
			});
		} else {
			this.liveStreamModule = null;
		}

		// Quality module
		const qualityConfig = _normalizeModuleConfig(config.quality);
		if (qualityConfig) {
			this.qualityModule = new QualityIntegrityModule<TRowData>(qualityConfig, {
				getApi: deps.getApi,
				applyIntegrityChange: (change) => deps.ctx.applyChange(change),
				getIntegrityState: () => deps.ctx.getState().integrity,
			});
		} else {
			this.qualityModule = null;
		}

		// Diff module
		const diffConfig = _normalizeModuleConfig(config.diff);
		if (diffConfig) {
			this.diffModule = new DiffIntegrityModule<TRowData>(diffConfig, {
				getColumns: () => deps.ctx.getState().columns,
				applyIntegrityChange: (change) => deps.ctx.applyChange(change),
				getIntegrityState: () => deps.ctx.getState().integrity,
				commitCellValue,
				validateCellProposal: this.validationModule ? (params) => this.validationModule!.validateCellProposal(params) : undefined,
				canEdit: (rowId, colField) => deps.capabilityManager.can('edit', { rowId, colField }).allowed,
				requestRepaint,
			});
		} else {
			this.diffModule = null;
		}
	}

	// ── GridInsightLayer ────────────────────────────────────────────────────────

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const decs: GridCellDecoration[] = [];
		_pushAll(decs, this.conflictModule?.getCellDecorations(rowId, colField));
		_pushAll(decs, this._getValidationCellDecorations(rowId, colField));
		_pushAll(decs, this.diffModule?.getCellDecorations(rowId, colField));
		_pushAll(decs, this.liveStreamModule?.getCellDecorations(rowId, colField));
		_pushAll(decs, this.qualityModule?.getCellDecorations(rowId, colField));
		_pushAll(decs, this._getPublishedIssueCellDecorations(rowId, colField));
		return decs;
	}

	getRowDecorations(rowId: string): readonly GridRowDecoration[] {
		const decs: GridRowDecoration[] = [];
		_pushAll(decs, this.diffModule?.getRowDecorations(rowId));
		return decs;
	}

	getDiagnostics(): unknown {
		const integrity = this.deps.ctx.getState().integrity;
		return {
			summary: integrity.summary,
			modules: {
				validation: this.validationModule?.getDiagnostics() ?? null,
				quality: this.qualityModule?.getDiagnostics() ?? null,
				diff: this.diffModule?.getDiagnostics() ?? null,
				liveStream: this.liveStreamModule?.getDiagnostics() ?? null,
				conflicts: this.conflictModule?.getDiagnostics() ?? null,
			},
			publishedIssues: Object.fromEntries(Object.entries(integrity.publishedIssues).map(([k, v]) => [k, v?.length ?? 0])),
			serverReport: integrity.serverReport
				? { scope: integrity.serverReport.scope, complete: integrity.serverReport.complete, issues: integrity.serverReport.issues.length }
				: null,
		};
	}

	destroy(): void {
		this.validationModule?.destroy();
		this.qualityModule?.destroy();
		this.diffModule?.destroy();
		this.liveStreamModule?.destroy();
		this.conflictModule?.destroy();
	}

	// ── Public API (GridIntegrityApi) ──────────────────────────────────────────

	buildApi(): GridIntegrityApi<TRowData> {
		return {
			run: (options) => this.run(options),
			getCapabilities: () => this.getCapabilities(),
			getScopeCapability: (scope) => this.getScopeCapability(scope),
			getSummary: () => this.getSummary(),
			getIssues: (filter) => this.getIssues(filter),
			getCellIssues: (rowId, colField) => this.getCellIssues(rowId, colField),
			getRowIssues: (rowId) => this.getRowIssues(rowId),
			getBlockingIssues: () => this.getBlockingIssues(),
			canSubmit: () => this.canSubmit(),
			publishIssues: (source, issues) => this.publishIssues(source, issues),
			publishServerReport: (report) => this.publishServerReport(report),
			clearIssues: (filter) => this.clearIssues(filter),
			validateCell: (rowId, colField) => this.validateCell(rowId, colField),
			validateCellProposal: (params) => this.validateCellProposal(params),
			validateRow: (rowId) => this.validateRow(rowId),
			validateGrid: (options) => this.validateGrid(options),
			setDiffModel: (model) => this.setDiffModel(model),
			clearDiff: () => this.clearDiff(),
			getDiffResult: () => this.getDiffResult(),
			acceptCellDiff: (rowId, colField) => this.acceptCellDiff(rowId, colField),
			createStream: (options) => this.createStream(options),
			getStreamState: () => this.getStreamState(),
			getConflicts: () => this.getConflicts(),
			resolveConflict: (conflictId, options) => this.resolveConflict(conflictId, options),
			clearConflict: (conflictId) => this.clearConflict(conflictId),
		};
	}

	// ── Integrity run ──────────────────────────────────────────────────────────

	async run(options?: GridIntegrityRunOptions): Promise<GridIntegrityRunResult> {
		const scope = options?.scope ?? this._defaultScope();
		const moduleIds = options?.modules ?? 'enabled';

		const rowsResult = this.deps.rowProvider.getRowsForIntegrityScope(scope);
		if (rowsResult.status === 'unsupported') {
			return {
				status: 'unsupported',
				scope,
				capability: rowsResult.capability,
				reason: rowsResult.reason,
				summary: this.getSummary(),
				issues: this._collectAllIssues(),
			};
		}
		const rows = rowsResult.status === 'ok' ? rowsResult.rows : [];
		const complete = rowsResult.status === 'ok' ? rowsResult.complete : false;
		const state = this.deps.ctx.getState();
		const api = this.deps.getApi();

		const collectedIssues: GridIntegrityIssue[] = [];

		const context = {
			scope,
			rows,
			complete,
			columns: state.columns,
			api,
			existingIssues: collectedIssues as readonly GridIntegrityIssue[],
		};

		const shouldRunModule = (id: GridIntegrityModuleId) =>
			moduleIds === 'enabled' ? true : (moduleIds as readonly GridIntegrityModuleId[]).includes(id);

		if (shouldRunModule('validation') && this.validationModule?.isEnabled()) {
			const issues = await this.validationModule.run(context);
			for (const i of issues) collectedIssues.push(i);
		}

		if (shouldRunModule('quality') && this.qualityModule?.isEnabled()) {
			const qualityContext = { ...context, existingIssues: collectedIssues as readonly GridIntegrityIssue[] };
			const issues = await this.qualityModule.run(qualityContext);
			for (const i of issues) collectedIssues.push(i);
		}

		if (shouldRunModule('diff') && this.diffModule?.isEnabled()) {
			const issues = this.diffModule.run(context);
			for (const i of issues) collectedIssues.push(i);
		}

		if (shouldRunModule('liveStream') && this.liveStreamModule?.isEnabled()) {
			const issues = this.liveStreamModule.run(context);
			for (const i of issues) collectedIssues.push(i);
		}

		if (shouldRunModule('conflicts') && this.conflictModule?.isEnabled()) {
			const issues = this.conflictModule.run(context);
			for (const i of issues) collectedIssues.push(i);
		}

		this.deps.requestIntegrityRepaint({ reason: 'run-complete', full: true });

		return {
			status: 'completed',
			scope,
			capability: rowsResult.capability,
			complete,
			message: rowsResult.message,
			summary: this.getSummary(),
			issues: this._collectAllIssues(),
		};
	}

	getCapabilities() {
		return this.deps.rowProvider.getCapabilities();
	}

	getScopeCapability(scope: GridIntegrityScope) {
		return this.deps.rowProvider.getScopeCapability(scope);
	}

	// ── Issue registry ─────────────────────────────────────────────────────────

	getSummary(): GridIntegritySummary {
		return this.deps.ctx.getState().integrity.summary;
	}

	getIssues(filter?: GridIntegrityIssueFilter): readonly GridIntegrityIssue[] {
		const all = this._collectAllIssues();
		if (!filter) return all;
		return all.filter((i) => _matchesFilter(i, filter));
	}

	getCellIssues(rowId: string, colField: string): readonly GridIntegrityIssue[] {
		return this._collectAllIssues().filter((i) => i.rowId === rowId && i.colField === colField);
	}

	getRowIssues(rowId: string): readonly GridIntegrityIssue[] {
		return this._collectAllIssues().filter((i) => i.rowId === rowId);
	}

	getBlockingIssues(): readonly GridIntegrityIssue[] {
		return this._collectAllIssues().filter((i) => i.blocking);
	}

	canSubmit(): boolean {
		return this.getBlockingIssues().length === 0;
	}

	publishIssues(source: GridIntegrityIssueSource, issues: readonly GridIntegrityIssue[]): void {
		const stamped = issues.map((i) => ({ ...i, id: i.id || nextPublishedIssueId(), source }));
		this.deps.ctx.applyChange({
			reason: 'integrity:publish-issues',
			domainMutations: [{ kind: 'integrity-publish-issues', source, issues: stamped }],
		});
		this.deps.requestIntegrityRepaint({ reason: 'publish-issues', full: true });
	}

	publishServerReport(report: ServerIntegrityReport): void {
		this.deps.ctx.applyChange({
			reason: 'integrity:server-report:set',
			domainMutations: [{ kind: 'integrity-set-server-report', report }],
		});
		this.deps.requestIntegrityRepaint({ reason: 'server-report', full: true });
	}

	clearIssues(filter?: GridIntegrityIssueFilter): void {
		if (!filter) {
			this.validationModule?.clearIssues();
			this.qualityModule?.clearIssues();
			this.diffModule?.clearIssues();
			this.conflictModule?.clearIssues();
			this.deps.ctx.applyChange({
				reason: 'integrity:clear-all',
				domainMutations: [{ kind: 'integrity-clear-published-issues' }, { kind: 'integrity-set-server-report', report: null }],
			});
		} else {
			const sources = filter.source ? (Array.isArray(filter.source) ? filter.source : [filter.source]) : null;
			if (!sources || sources.includes('validation') || sources.includes('serverValidation')) {
				this.validationModule?.clearIssues();
			}
			if (!sources || sources.includes('dataQuality')) this.qualityModule?.clearIssues();
			if (!sources || sources.includes('diff')) this.diffModule?.clearIssues();
			if (!sources || sources.includes('conflict')) this.conflictModule?.clearIssues();
			this.deps.ctx.applyChange({
				reason: 'integrity:clear-published-issues',
				domainMutations: [
					{ kind: 'integrity-clear-published-issues', filter },
					...(!sources || sources.includes('system') ? [{ kind: 'integrity-set-server-report', report: null } as const] : []),
				],
			});
		}
		this.deps.requestIntegrityRepaint({ reason: 'clear-issues', full: true });
	}

	// ── Validation shortcuts ───────────────────────────────────────────────────

	async validateCell(rowId: string, colField: string): Promise<readonly GridIntegrityIssue[]> {
		if (!this.validationModule) return _EMPTY;
		return this.validationModule.validateCell(rowId, colField);
	}

	shouldAutoValidateWrite(source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo' | 'transaction'): boolean {
		return this.validationModule?.shouldAutoValidateWrite(source) ?? false;
	}

	shouldPreflightWrite(source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo' | 'transaction'): boolean {
		return this.validationModule?.shouldPreflightWrite(source) ?? false;
	}

	shouldPreflightWriteSync(source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo' | 'transaction'): boolean {
		return this.validationModule?.shouldPreflightWriteSync(source) ?? false;
	}

	async validateCommittedCells(
		cells: readonly { rowId: string; colField: string }[],
		source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo'
	): Promise<void> {
		if (!this.validationModule || !this.shouldAutoValidateWrite(source)) return;
		await this.validationModule.validateCells(cells);
	}

	/** A row-level write committed: validate its changed/added rows (per policy), drop removed rows' issues. */
	async validateRowsAfterWrite(rowIds: readonly string[], removedRowIds: readonly string[]): Promise<void> {
		if (!this.validationModule) return;
		await this.validationModule.validateRowsAfterWrite({ rowIds, removedRowIds, validate: this.shouldAutoValidateWrite('transaction') });
	}

	async validateWriteProposal(
		updates: readonly { rowId: string; colField: string; proposedValue: unknown }[],
		source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo'
	): Promise<readonly GridIntegrityIssue[]> {
		if (!this.validationModule) return _EMPTY;
		return this.validationModule.validateWriteProposal(updates, source);
	}

	validateWriteProposalSync(
		updates: readonly { rowId: string; colField: string; proposedValue: unknown }[],
		source: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo'
	): readonly GridIntegrityIssue[] {
		if (!this.validationModule) return _EMPTY;
		return this.validationModule.validateWriteProposalSync(updates, source);
	}

	async validateCellProposal(params: GridValidateCellProposalParams): Promise<readonly GridIntegrityIssue[]> {
		if (!this.validationModule) return _EMPTY;
		return this.validationModule.validateCellProposal(params);
	}

	async validateRow(rowId: string): Promise<readonly GridIntegrityIssue[]> {
		if (!this.validationModule) return _EMPTY;
		return this.validationModule.validateRow(rowId);
	}

	async validateGrid(options?: { scope?: GridIntegrityScope }): Promise<GridIntegrityRunResult> {
		return this.run({ modules: ['validation'], scope: options?.scope });
	}

	// ── Diff shortcuts ─────────────────────────────────────────────────────────

	setDiffModel(model: GridDiffModel<TRowData> | null): void {
		if (!this.diffModule) throw new Error('[DataIntegrity] Diff module is not enabled. Add diff: true to dataIntegrity config.');
		this.diffModule.setDiffModel(model);
	}

	clearDiff(): void {
		this.diffModule?.clearDiff();
	}

	getDiffResult(): GridDiffResult | null {
		return this.deps.ctx.getState().integrity.diff.result;
	}

	getCellDiff(rowId: string, colField: string): GridCellDiff | null {
		return this.deps.ctx.getState().integrity.diff.cellDiffIndex[`${rowId}\0${colField}`] ?? null;
	}

	async acceptCellDiff(rowId: string, colField: string): Promise<GridDiffAcceptResult> {
		if (!this.diffModule) return { status: 'unsupported', reason: 'Diff module is not enabled' };
		return this.diffModule.acceptCellDiff(rowId, colField);
	}

	// ── Live stream shortcuts ──────────────────────────────────────────────────

	createStream(options?: GridLiveStreamOptions<TRowData>): GridTransactionStreamHandle<TRowData> {
		if (!this.liveStreamModule) {
			throw new Error('[DataIntegrity] Live stream module is not enabled. Add liveStream: true to dataIntegrity config.');
		}
		return this.liveStreamModule.createStream(options);
	}

	getStreamState(): GridTransactionStreamState | null {
		return this.deps.ctx.getState().integrity.liveStream.session;
	}

	// ── Conflict shortcuts ─────────────────────────────────────────────────────

	getConflicts(): readonly GridCellConflict[] {
		return this.deps.ctx.getState().integrity.conflicts.conflicts;
	}

	async resolveConflict(conflictId: string, options: ResolveConflictOptions): Promise<ConflictResolutionResult> {
		if (!this.conflictModule) return { status: 'notFound' };
		return this.conflictModule.resolveConflict(conflictId, options);
	}

	clearConflict(conflictId: string): void {
		this.conflictModule?.clearConflict(conflictId);
	}

	getCellErrorMessage(rowId: string, colField: string): string | null {
		return this.deps.ctx.getState().integrity.validation.cellErrorIndex[`${rowId}:${colField}`]?.message ?? null;
	}

	// ── Private ────────────────────────────────────────────────────────────────

	private _collectAllIssues(): GridIntegrityIssue[] {
		const integrity = this.deps.ctx.getState().integrity;
		const all: GridIntegrityIssue[] = [...integrity.validation.issues, ...integrity.quality.issues, ...integrity.liveStream.issues];
		for (const cell of integrity.diff.result?.changedCells ?? []) {
			all.push({
				id: `diff:changed:${cell.rowId}:${cell.colField}`,
				source: 'diff',
				type: 'diffChanged',
				severity: 'info',
				blocking: false,
				rowId: cell.rowId,
				colField: cell.colField,
				message: `Changed: ${_fmt(cell.oldValue)} -> ${_fmt(cell.newValue)}`,
				value: cell.newValue,
				createdAt: 0,
				data: cell,
			});
		}
		for (const rowId of integrity.diff.result?.addedRows ?? []) {
			all.push({
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
		for (const rowId of integrity.diff.result?.removedRows ?? []) {
			all.push({
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
		for (const conflict of integrity.conflicts.conflicts) {
			all.push({
				id: `conflict:${conflict.id}`,
				source: 'conflict',
				type: 'conflict',
				severity: 'error',
				blocking: true,
				rowId: conflict.rowId,
				colField: conflict.colField,
				message: conflict.message ?? `Conflict: local ${_fmt(conflict.localValue)} vs remote ${_fmt(conflict.remoteValue)}`,
				createdAt: conflict.createdAt,
				data: conflict,
			});
		}
		for (const issues of Object.values(integrity.publishedIssues)) {
			if (issues) all.push(...issues);
		}
		if (integrity.serverReport) all.push(...integrity.serverReport.issues);
		return all;
	}

	private _defaultScope(): GridIntegrityScope {
		const rowModel = this.deps.getRowModel();
		const type = (rowModel as { type?: string } | null)?.type;
		return type === 'client' ? 'allRows' : 'loadedRows';
	}

	private _isCellDirty(rowId: string, colField: string): boolean {
		// Check active editing
		const editState = readInteractionState(this.deps.ctx.getState()).activeEdit.active;
		if (
			editState &&
			this.deps.ctx.columns
				.getDisplayedColumns()
				.some((column) => column.field === colField && doesCanonicalCellPointerMatchColumn(editState, rowId, column))
		) {
			return true;
		}
		// Check existing conflicts (a conflicted cell is locally dirty)
		if (this.deps.ctx.getState().integrity.conflicts.cellConflictIndex[`${rowId}\0${colField}`]) return true;
		return false;
	}

	private _getPublishedIssueCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const decs: GridCellDecoration[] = [];
		for (const issues of Object.values(this.deps.ctx.getState().integrity.publishedIssues)) {
			if (!issues) continue;
			for (const issue of issues) {
				if (issue.rowId === rowId && issue.colField === colField) {
					decs.push({
						layerId: 'dataIntegrity',
						kind: issue.type,
						severity: issue.severity,
						className: _publishedIssueClass(issue.source, issue.severity),
						title: issue.message,
						data: issue,
					});
				}
			}
		}
		return decs;
	}

	private _getValidationCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		const issue = this.deps.ctx.getState().integrity.validation.cellErrorIndex[`${rowId}:${colField}`] ?? null;
		if (!issue) return _EMPTY_DECS;
		return [
			{
				layerId: 'dataIntegrity',
				kind: 'validationError',
				severity: issue.severity,
				className: issue.severity === 'error' ? 'og-cell-integrity-error og-cell-validation-error' : 'og-cell-integrity-warning',
				title: issue.message,
				data: issue,
			},
		];
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _normalizeModuleConfig<T extends object>(config: T | boolean | undefined): T | null {
	if (!config) return null;
	if (config === true) return {} as T;
	return config;
}

function _matchesFilter(issue: GridIntegrityIssue, filter: GridIntegrityIssueFilter): boolean {
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

function _publishedIssueClass(source: GridIntegrityIssueSource, severity: GridIntegritySeverity): string {
	if (source === 'conflict') return 'og-cell-conflict';
	if (severity === 'error') return 'og-cell-insight-error';
	if (severity === 'warning') return 'og-cell-insight-warning';
	return 'og-cell-insight-info';
}

function _fmt(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	return String(value);
}

function _pushAll<T>(target: T[], source: readonly T[] | undefined): void {
	if (!source) return;
	for (const item of source) target.push(item);
}

const _EMPTY: readonly GridIntegrityIssue[] = [];
const _EMPTY_DECS: readonly GridCellDecoration[] = [];
