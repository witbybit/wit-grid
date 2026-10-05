import type { GridCellDecoration } from '../../../insights/insightTypes.js';
import type { ColumnDef } from '../../../columnDef.js';
import type { GridApi } from '../../../api/GridApi.js';
import type { GridCommit } from '../../../engine/GridChangeApplier.js';
import type { GridIntegrityState } from '../../../state/GridState.js';
import type {
	GridIntegrityIssue,
	GridIntegrityModule,
	GridIntegrityRunContext,
	GridQualityIntegrityOptions,
	GridDataQualityRule,
	GridIntegrityRowRef,
	GridIntegrityScope,
} from '../integrityTypes.js';
import type { GridIntegritySeverity } from '../integrityTypes.js';

let _seq = 0;
function nextIssueId(): string {
	return `qi-${++_seq}`;
}

export interface QualityModuleDeps<TRowData> {
	getApi: () => GridApi<TRowData>;
	applyIntegrityChange: (change: GridCommit<TRowData>) => void;
	getIntegrityState: () => GridIntegrityState<TRowData>;
}

export class QualityIntegrityModule<TRowData> implements GridIntegrityModule<TRowData> {
	public readonly id = 'quality' as const;

	private options: GridQualityIntegrityOptions<TRowData>;
	private lastRunAt: number | null = null;
	private lastError: string | null = null;
	private lastScope: GridIntegrityScope | null = null;
	private lastComplete = false;
	private customRules = new Map<string, GridDataQualityRule<TRowData>>();

	constructor(
		options: GridQualityIntegrityOptions<TRowData>,
		private readonly deps: QualityModuleDeps<TRowData>
	) {
		this.options = options;
		for (const rule of options.rules ?? []) {
			this.customRules.set(rule.id, rule);
		}
	}

	isEnabled(): boolean {
		return this.options.enabled !== false;
	}

	getIssues(): readonly GridIntegrityIssue[] {
		return this.deps.getIntegrityState().quality.issues;
	}

	getCellDecorations(rowId: string, colField: string): readonly GridCellDecoration[] {
		return this.getIssues()
			.filter((issue) => issue.rowId === rowId && issue.colField === colField)
			.map((issue) => ({
				layerId: 'dataIntegrity' as const,
				kind: issue.type,
				severity: issue.severity,
				className: _qualityClass(issue.severity),
				title: issue.message,
				data: issue,
			}));
	}

	getDiagnostics(): unknown {
		return {
			enabled: this.isEnabled(),
			totalIssues: this.getIssues().length,
			lastRunAt: this.lastRunAt,
			lastError: this.lastError,
			lastScope: this.lastScope,
			complete: this.lastComplete,
			customRules: this.customRules.size,
		};
	}

	async run(context: GridIntegrityRunContext<TRowData>): Promise<readonly GridIntegrityIssue[]> {
		if (!this.isEnabled()) return _EMPTY;

		this.lastError = null;
		this.lastScope = context.scope;
		this.lastComplete = context.complete;

		const api = this.deps.getApi();
		const allIssues: GridIntegrityIssue[] = [];

		const includeValidation = this.options.includeValidationIssues !== false;
		if (includeValidation) {
			for (const issue of context.existingIssues) {
				if (issue.source === 'validation' || issue.source === 'serverValidation') {
					allIssues.push(issue);
				}
			}
		}

		const missingIssues = _runMissingRequired<TRowData>(context.rows, context.columns);
		for (const issue of missingIssues) allIssues.push({ ...issue, id: nextIssueId() });

		const ruleContext = {
			scope: context.scope,
			rows: context.rows,
			columns: context.columns,
			api,
			complete: context.complete,
		};

		for (const rule of this.customRules.values()) {
			try {
				const ruleIssues = await rule.run(ruleContext);
				for (const issue of ruleIssues) {
					allIssues.push({ ...issue, id: nextIssueId() });
				}
			} catch (error) {
				this.lastError = `Quality rule "${rule.id}" failed: ${error instanceof Error ? error.message : String(error)}`;
			}
		}

		this.lastRunAt = _now();
		this.deps.applyIntegrityChange({
			reason: 'integrity:quality:set-issues',
			domainMutations: [{ kind: 'integrity-set-quality-issues', issues: allIssues }],
		});
		return allIssues;
	}

	registerRule(rule: GridDataQualityRule<TRowData>): void {
		this.customRules.set(rule.id, rule);
	}

	unregisterRule(ruleId: string): void {
		this.customRules.delete(ruleId);
	}

	clearIssues(): void {
		this.deps.applyIntegrityChange({
			reason: 'integrity:quality:set-issues',
			domainMutations: [{ kind: 'integrity-set-quality-issues', issues: [] }],
		});
	}

	destroy(): void {
		this.clearIssues();
		this.customRules.clear();
	}
}

function _runMissingRequired<TRowData>(
	rows: readonly GridIntegrityRowRef<TRowData>[],
	columns: readonly ColumnDef<TRowData>[]
): GridIntegrityIssue[] {
	const requiredFields = columns.filter((column) => (column as { required?: boolean }).required === true).map((column) => column.field);
	if (requiredFields.length === 0) return [];

	const issues: GridIntegrityIssue[] = [];
	for (const ref of rows) {
		for (const field of requiredFields) {
			const value = (ref.row as Record<string, unknown>)[field ?? ''];
			if (value === null || value === undefined || value === '') {
				issues.push({
					id: nextIssueId(),
					source: 'dataQuality',
					type: 'missingRequired',
					severity: 'error',
					blocking: true,
					rowId: ref.rowId,
					colField: field,
					message: `${field} is required but missing`,
					createdAt: _now(),
				});
			}
		}
	}
	return issues;
}

export function duplicateValueRule<TRowData>(field: string): GridDataQualityRule<TRowData> {
	return {
		id: `duplicate:${field}`,
		label: `Duplicate ${field}`,
		run(context): readonly GridIntegrityIssue[] {
			const seen = new Map<unknown, string>();
			const issues: GridIntegrityIssue[] = [];

			for (const ref of context.rows) {
				const value = (ref.row as Record<string, unknown>)[field ?? ''];
				if (value === null || value === undefined || value === '') continue;

				if (seen.has(value)) {
					issues.push({
						id: nextIssueId(),
						source: 'dataQuality',
						type: 'duplicate',
						severity: 'warning',
						blocking: false,
						rowId: ref.rowId,
						colField: field,
						message: `Duplicate ${field}: "${value}" (also in row ${seen.get(value)})`,
						value,
						createdAt: _now(),
					});
				} else {
					seen.set(value, ref.rowId);
				}
			}
			return issues;
		},
	};
}

export function missingRequiredRule<TRowData>(): GridDataQualityRule<TRowData> {
	return {
		id: 'missingRequired',
		label: 'Missing required values',
		run(context): readonly GridIntegrityIssue[] {
			return _runMissingRequired(context.rows, context.columns);
		},
	};
}

function _qualityClass(severity: GridIntegritySeverity): string {
	if (severity === 'error') return 'og-cell-quality-error';
	if (severity === 'warning') return 'og-cell-quality-warning';
	return 'og-cell-quality-info';
}

function _now(): number {
	return typeof performance !== 'undefined' ? Math.floor(performance.timeOrigin + performance.now()) : 0;
}

const _EMPTY: readonly GridIntegrityIssue[] = [];
