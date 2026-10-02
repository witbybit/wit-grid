import type { ColumnDef } from '../../columnDef.js';
import type { GridApi, GridWriteResult } from '../../api/GridApi.js';
import type {
	GridCellConflict,
	GridDiffModel,
	GridDiffResult,
	GridIntegrityIssue,
	GridIntegrityIssueSource,
	GridIntegritySeverity,
	GridIntegritySummary,
	GridTransactionStreamState,
	ServerIntegrityReport,
} from '../../state/integrityStateTypes.js';

export type {
	GridCellConflict,
	GridCellDiff,
	GridConflictSource,
	GridDiffModel,
	GridDiffResult,
	GridIntegrityIssue,
	GridIntegrityIssueSource,
	GridIntegritySeverity,
	GridIntegritySummary,
	GridTransactionStreamState,
	ServerIntegrityReport,
} from '../../state/integrityStateTypes.js';

export type GridIntegrityIssueType =
	| 'invalidValue'
	| 'missingRequired'
	| 'rowValidation'
	| 'serverRejected'
	| 'duplicate'
	| 'outlier'
	| 'typeMismatch'
	| 'formulaError'
	| 'inconsistentFormat'
	| 'diffChanged'
	| 'diffAdded'
	| 'diffRemoved'
	| 'streamSkipped'
	| 'conflict'
	| 'custom';

export type GridCommitResult = GridWriteResult;

export interface GridValidateCellProposalParams {
	readonly rowId: string;
	readonly colField: string;
	readonly proposedValue: unknown;
	readonly source?: 'edit' | 'diffAccept' | 'conflictResolve' | 'paste' | 'fill' | 'api';
}

export interface GridIntegrityIssueFilter {
	readonly source?: GridIntegrityIssueSource | readonly GridIntegrityIssueSource[];
	readonly type?: GridIntegrityIssueType | readonly GridIntegrityIssueType[];
	readonly severity?: GridIntegritySeverity;
	readonly rowId?: string;
	readonly colField?: string;
	readonly blockingOnly?: boolean;
}

export type GridIntegrityScope = 'allRows' | 'loadedRows' | 'filteredRows' | 'selectedRows' | 'visibleRows' | 'currentPage' | 'serverProvided';

export type GridIntegrityCapabilityLevel = 'authoritative' | 'partial' | 'unsupported';

export interface GridIntegrityScopeCapability {
	readonly scope: GridIntegrityScope;
	readonly level: GridIntegrityCapabilityLevel;
	readonly complete: boolean;
	readonly source:
		| 'allDataNodes'
		| 'filteredDataNodes'
		| 'currentPageDataNodes'
		| 'visualRows'
		| 'selectedRows'
		| 'loadedRows'
		| 'serverProvided'
		| 'none';
	readonly reason?: string;
	readonly message?: string;
}

export type GridIntegrityCapabilityMatrix = Record<GridIntegrityScope, GridIntegrityScopeCapability>;

export interface GridIntegrityRowRef<TRowData> {
	readonly rowId: string;
	readonly row: TRowData;
	readonly rowIndex?: number;
	readonly source: 'client' | 'infiniteLoaded' | 'serverLoaded' | 'selected' | 'visible' | 'serverProvided';
}

export type GridIntegrityRowsResult<TRowData> =
	| {
			readonly status: 'ok';
			readonly scope: GridIntegrityScope;
			readonly capability: GridIntegrityScopeCapability;
			readonly rows: readonly GridIntegrityRowRef<TRowData>[];
			readonly complete: boolean;
			readonly message?: string;
	  }
	| {
			readonly status: 'unsupported';
			readonly scope: GridIntegrityScope;
			readonly capability: GridIntegrityScopeCapability;
			readonly reason: string;
	  };

export interface GridIntegrityRowProvider<TRowData> {
	getCapabilities(): GridIntegrityCapabilityMatrix;
	getScopeCapability(scope: GridIntegrityScope): GridIntegrityScopeCapability;
	getRowsForIntegrityScope(scope: GridIntegrityScope): GridIntegrityRowsResult<TRowData>;
}

export type GridIntegrityModuleId = 'validation' | 'quality' | 'diff' | 'liveStream' | 'conflicts';

export interface GridIntegrityRunOptions {
	readonly modules?: 'enabled' | readonly GridIntegrityModuleId[];
	readonly scope?: GridIntegrityScope;
}

export type GridIntegrityRunResult =
	| {
			readonly status: 'completed';
			readonly scope: GridIntegrityScope;
			readonly capability: GridIntegrityScopeCapability;
			readonly complete: boolean;
			readonly summary: GridIntegritySummary;
			readonly issues: readonly GridIntegrityIssue[];
			readonly message?: string;
	  }
	| {
			readonly status: 'unsupported';
			readonly scope: GridIntegrityScope;
			readonly capability: GridIntegrityScopeCapability;
			readonly reason: string;
			readonly summary: GridIntegritySummary;
			readonly issues: readonly GridIntegrityIssue[];
	  };

export interface GridIntegrityRunContext<TRowData> {
	readonly scope: GridIntegrityScope;
	readonly rows: readonly GridIntegrityRowRef<TRowData>[];
	readonly complete: boolean;
	readonly columns: readonly ColumnDef<TRowData>[];
	readonly api: GridApi<TRowData>;
	readonly existingIssues: readonly GridIntegrityIssue[];
}

export interface GridIntegrityModule<TRowData> {
	readonly id: GridIntegrityModuleId;
	isEnabled(): boolean;
	run?(context: GridIntegrityRunContext<TRowData>): Promise<readonly GridIntegrityIssue[]> | readonly GridIntegrityIssue[];
	getIssues?(): readonly GridIntegrityIssue[];
	clearIssues?(): void;
	getDiagnostics?(): unknown;
	destroy?(): void;
}

export interface GridIntegrityRuleResult {
	readonly message: string;
	readonly fields?: readonly string[];
	readonly value?: unknown;
	readonly data?: unknown;
}

export interface GridCellIntegrityRule<TRowData> {
	readonly id: string;
	readonly field: string;
	readonly severity?: GridIntegritySeverity;
	readonly blocking?: boolean;
	validate(params: {
		rowId: string;
		row: TRowData;
		field: string;
		value: unknown;
		api: GridApi<TRowData>;
	}): GridIntegrityRuleResult | null | Promise<GridIntegrityRuleResult | null>;
}

export interface GridRowIntegrityRule<TRowData> {
	readonly id: string;
	readonly severity?: GridIntegritySeverity;
	readonly blocking?: boolean;
	validate(params: {
		rowId: string;
		row: TRowData;
		api: GridApi<TRowData>;
	}): GridIntegrityRuleResult | null | Promise<GridIntegrityRuleResult | null>;
}

export interface GridValidationIntegrityOptions<TRowData> {
	readonly enabled?: boolean;
	readonly validateOnEdit?: boolean;
	readonly validateOnBlur?: boolean;
	readonly validateOnSubmit?: boolean;
	readonly validateOnPaste?: boolean;
	readonly validateOnFill?: boolean;
	/**
	 * Re-validate rows written by setRows or a row transaction (sync or async) right after they
	 * commit: changed and added rows run every cell and row rule. Rows a write removes always lose
	 * their issues. Never blocks the write. Default: validateOnEdit.
	 */
	readonly validateOnTransaction?: boolean;
	readonly showInlineErrors?: boolean;
	readonly defaultScope?: GridIntegrityScope;
	readonly cellRules?: readonly GridCellIntegrityRule<TRowData>[];
	readonly rowRules?: readonly GridRowIntegrityRule<TRowData>[];
}

export interface GridDataQualityRuleContext<TRowData> {
	readonly scope: GridIntegrityScope;
	readonly rows: readonly GridIntegrityRowRef<TRowData>[];
	readonly columns: readonly ColumnDef<TRowData>[];
	readonly api: GridApi<TRowData>;
	readonly complete: boolean;
}

export interface GridDataQualityRule<TRowData> {
	readonly id: string;
	readonly label: string;
	run(context: GridDataQualityRuleContext<TRowData>): readonly GridIntegrityIssue[] | Promise<readonly GridIntegrityIssue[]>;
}

export interface GridQualityIntegrityOptions<TRowData> {
	readonly enabled?: boolean;
	readonly rules?: readonly GridDataQualityRule<TRowData>[];
	readonly includeValidationIssues?: boolean;
	readonly defaultScope?: GridIntegrityScope;
}

export type GridDiffAcceptResult =
	| { status: 'accepted' }
	| { status: 'notFound'; reason: string }
	| { status: 'unsupported'; reason: string }
	| { status: 'validationFailed'; issues: readonly GridIntegrityIssue[] }
	| { status: 'capabilityDenied'; reason: string }
	| { status: 'failed'; error: unknown };

export interface GridDiffIntegrityOptions {
	readonly enabled?: boolean;
	readonly validateChangedValues?: boolean;
}

export interface GridLiveStreamIntegrityOptions {
	readonly enabled?: boolean;
	readonly dirtyCellPolicy?: 'skip' | 'markConflict' | 'remoteWins';
	readonly flashChanges?: boolean;
}

export interface GridConflictIntegrityOptions {
	readonly enabled?: boolean;
	readonly validateBeforeResolve?: boolean;
	readonly checkCapabilitiesBeforeResolve?: boolean;
}

export interface ResolveConflictOptions {
	readonly strategy: 'local' | 'remote' | 'custom';
	readonly value?: unknown;
}

export type ConflictResolutionResult =
	| { status: 'resolved' }
	| { status: 'blocked'; reason: string; issues?: readonly GridIntegrityIssue[] }
	| { status: 'validationFailed'; issues: readonly GridIntegrityIssue[] }
	| { status: 'capabilityDenied'; reason: string }
	| { status: 'notFound' }
	| { status: 'failed'; error: unknown };

export interface GridDataIntegrityConfig<TRowData> {
	readonly validation?: GridValidationIntegrityOptions<TRowData> | boolean;
	readonly quality?: GridQualityIntegrityOptions<TRowData> | boolean;
	readonly diff?: GridDiffIntegrityOptions | boolean;
	readonly liveStream?: GridLiveStreamIntegrityOptions | boolean;
	readonly conflicts?: GridConflictIntegrityOptions | boolean;
}

export interface GridIntegrityApi<TRowData> {
	run(options?: GridIntegrityRunOptions): Promise<GridIntegrityRunResult>;
	getCapabilities(): GridIntegrityCapabilityMatrix;
	getScopeCapability(scope: GridIntegrityScope): GridIntegrityScopeCapability;
	getSummary(): GridIntegritySummary;
	getIssues(filter?: GridIntegrityIssueFilter): readonly GridIntegrityIssue[];
	getCellIssues(rowId: string, colField: string): readonly GridIntegrityIssue[];
	getRowIssues(rowId: string): readonly GridIntegrityIssue[];
	getBlockingIssues(): readonly GridIntegrityIssue[];
	canSubmit(): boolean;
	publishIssues(source: GridIntegrityIssueSource, issues: readonly GridIntegrityIssue[]): void;
	publishServerReport(report: ServerIntegrityReport): void;
	clearIssues(filter?: GridIntegrityIssueFilter): void;
	validateCell(rowId: string, colField: string): Promise<readonly GridIntegrityIssue[]>;
	validateCellProposal(params: GridValidateCellProposalParams): Promise<readonly GridIntegrityIssue[]>;
	validateRow(rowId: string): Promise<readonly GridIntegrityIssue[]>;
	validateGrid(options?: { scope?: GridIntegrityScope }): Promise<GridIntegrityRunResult>;
	setDiffModel(model: GridDiffModel<TRowData> | null): void;
	clearDiff(): void;
	getDiffResult(): GridDiffResult | null;
	acceptCellDiff(rowId: string, colField: string): Promise<GridDiffAcceptResult>;
	createStream(options?: GridLiveStreamOptions<TRowData>): GridTransactionStreamHandle<TRowData>;
	getStreamState(): GridTransactionStreamState | null;
	getConflicts(): readonly GridCellConflict[];
	resolveConflict(conflictId: string, options: ResolveConflictOptions): Promise<ConflictResolutionResult>;
	clearConflict(conflictId: string): void;
}

export interface GridLiveStreamOptions<TRowData> {
	readonly batchMs?: number;
	readonly maxBatchSize?: number;
	readonly coalesceBy?: 'cell' | 'row';
	readonly history?: 'suppress' | 'grouped';
	readonly flashChanges?: boolean;
	readonly dirtyCellPolicy?: 'skip' | 'markConflict' | 'remoteWins';
	readonly sortPolicy?: 'live' | 'defer';
	readonly filterPolicy?: 'live' | 'defer';
}

export interface GridLiveStreamUpdate<TRowData> {
	readonly cells?: readonly GridCellStreamUpdate[];
	readonly rows?: readonly GridRowStreamUpdate<TRowData>[];
}

export interface GridCellStreamUpdate {
	readonly rowId: string;
	readonly colField: string;
	readonly value: unknown;
	readonly version?: string | number;
	readonly source?: string;
}

export interface GridRowStreamUpdate<TRowData> {
	readonly rowId: string;
	readonly patch: Partial<TRowData>;
	readonly version?: string | number;
	readonly source?: string;
}

export interface GridTransactionStreamHandle<TRowData> {
	push(update: GridLiveStreamUpdate<TRowData>): void;
	pushCells(updates: readonly GridCellStreamUpdate[]): void;
	pushRows(updates: readonly GridRowStreamUpdate<TRowData>[]): void;
	pause(): void;
	resume(): void;
	flush(): void;
	destroy(): void;
	getState(): GridTransactionStreamState;
}

export interface IntegrityRepaintRequest {
	readonly reason: string;
	readonly cells?: readonly { rowId: string; colField: string }[];
	readonly rows?: readonly string[];
	readonly full?: boolean;
}
