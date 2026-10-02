import type { GridWriteResult } from './api/GridApi.js';
import type { GridIntegrityIssue } from './features/dataIntegrity/integrityTypes.js';
import type { RowLoadState, RowNodeKind } from './rowModel.js';

export interface RowNodeSelectionOptions {
	clearOthers?: boolean;
	rangeAnchor?: string;
}

export interface GridRowNodeValidationState {
	readonly issues: readonly GridIntegrityIssue[];
	readonly valid: boolean;
}

/**
 * Public row-node facade exposed to consumers.
 *
 * This is intentionally NOT the internal mutable row-model/cache node. Implementations must route
 * writes and refresh/integrity actions back through the grid's authoritative APIs so row version
 * bumps, invalidation, validation, integrity, and renderer refresh ownership remain centralized.
 */
export interface GridRowNode<TRowData = unknown> {
	readonly id: string;
	readonly kind: RowNodeKind;

	readonly data: TRowData | undefined;
	readonly rowIndex: number | null;

	readonly loaded: boolean;
	readonly loading: boolean;
	readonly failed: boolean;
	readonly placeholder: boolean;
	readonly loadState: RowLoadState;

	readonly selectable: boolean;
	readonly selected: boolean;

	readonly expandable: boolean;
	readonly expanded: boolean;

	readonly editable: boolean;

	getData(): TRowData | undefined;
	getValue<TValue = unknown>(field: string): TValue | undefined;
	getDisplayValue(field: string): string;

	setSelected(selected: boolean, options?: RowNodeSelectionOptions): GridWriteResult;
	setExpanded(expanded: boolean): GridWriteResult;
	ensureVisible(position?: 'top' | 'middle' | 'bottom' | 'nearest'): GridWriteResult;

	setData(data: TRowData): GridWriteResult;
	updateData(partial: Partial<TRowData>): GridWriteResult;
	setDataValue(field: string, value: unknown): GridWriteResult;

	refresh(): GridWriteResult;
	retryLoad(): GridWriteResult;

	getValidationState?(): GridRowNodeValidationState;
	validate?(): Promise<GridWriteResult>;
	getIntegrityIssues?(): readonly GridIntegrityIssue[];
	refreshIntegrity?(): Promise<GridWriteResult>;
}

export interface GridRowNodeFacadeSource<TRowData = unknown> {
	getRowId(data: TRowData): string;
	getRawRowById(rowId: string): TRowData | null;
	getCellValue(rowId: string, field: string): unknown;
	getVisualIndexByRowId(rowId: string): number | null;
	getVisualRowCount(): number;
	getSelectedRowIds(): string[];
	isExpanded(id: string): boolean;
	isDetailOpen(rowId: string): boolean;
	selectRows(rowIds: string[], options?: { mode?: 'add' | 'replace' }): void;
	deselectRows(rowIds: string[]): void;
	scrollToRow(rowId: string, options?: { select?: boolean }): void;
	setCellValue(rowId: string, field: string, value: unknown): GridWriteResult;
	writeCells(updates: ReadonlyArray<{ rowId: string; colField: string; value: unknown }>): GridWriteResult;
	setExpanded(id: string, expanded: boolean): void;
	setDetailOpen(rowId: string, open: boolean): void;
	refreshRows(): void;
	retryRowLoad(rowIndex: number | null, loadState: RowLoadState): GridWriteResult;
	getRowIssues(rowId: string): readonly GridIntegrityIssue[];
	validateRow(rowId: string): Promise<readonly GridIntegrityIssue[]>;
	getRowModelType(): 'client' | 'infinite' | 'server';
}

function appliedResult(changeId: number): GridWriteResult {
	return { status: 'applied', changeId, faults: [] };
}

function rejectedResult(reason: string): GridWriteResult {
	return { status: 'rejected', reason };
}

function validationResult(issues: readonly GridIntegrityIssue[]): GridWriteResult {
	if (issues.length === 0) return appliedResult(Date.now());
	return {
		status: 'validationFailed',
		reason: issues[0]?.message ?? 'Row validation failed.',
		issues,
	};
}

function toRowPatchUpdates<TRowData>(
	source: GridRowNodeFacadeSource<TRowData>,
	rowId: string,
	current: TRowData,
	next: Partial<TRowData>
): Array<{ rowId: string; colField: string; value: unknown }> {
	const patch = next as Record<string, unknown>;
	const currentRecord = current as Record<string, unknown>;
	const updates: Array<{ rowId: string; colField: string; value: unknown }> = [];
	for (const colField of Object.keys(patch)) {
		if (source.getCellValue(rowId, colField) === patch[colField] && currentRecord[colField] === patch[colField]) continue;
		updates.push({ rowId, colField, value: patch[colField] });
	}
	return updates;
}

function toRowReplaceUpdates<TRowData>(
	source: GridRowNodeFacadeSource<TRowData>,
	rowId: string,
	current: TRowData,
	next: TRowData
): Array<{ rowId: string; colField: string; value: unknown }> {
	const nextRecord = next as Record<string, unknown>;
	const currentRecord = current as Record<string, unknown>;
	const keys = new Set([...Object.keys(currentRecord), ...Object.keys(nextRecord)]);
	const updates: Array<{ rowId: string; colField: string; value: unknown }> = [];
	for (const colField of keys) {
		if (source.getCellValue(rowId, colField) === nextRecord[colField] && currentRecord[colField] === nextRecord[colField]) continue;
		updates.push({ rowId, colField, value: nextRecord[colField] });
	}
	return updates;
}

export function createGridRowNodeFacade<TRowData>(
	source: GridRowNodeFacadeSource<TRowData>,
	input: {
		id: string;
		kind: RowNodeKind;
		rowIndex: number | null;
		loadState: RowLoadState;
		data?: TRowData;
		selectable?: boolean;
		selected?: boolean;
		expandable?: boolean;
		expanded?: boolean;
		editable?: boolean;
	}
): GridRowNode<TRowData> {
	const getCurrentData = (): TRowData | undefined => source.getRawRowById(input.id) ?? input.data;
	const isWriteableLoadedDataRow = (): boolean => input.kind === 'data' && input.loadState.kind === 'loaded' && getCurrentData() !== undefined;

	return {
		get id() {
			return input.id;
		},
		get kind() {
			return input.kind;
		},
		get data() {
			return getCurrentData();
		},
		get rowIndex() {
			const visualIndex = source.getVisualIndexByRowId(input.id);
			return visualIndex ?? input.rowIndex;
		},
		get loaded() {
			return input.loadState.kind === 'loaded';
		},
		get loading() {
			return input.loadState.kind === 'loading';
		},
		get failed() {
			return input.loadState.kind === 'failed';
		},
		get placeholder() {
			return input.loadState.kind === 'placeholder';
		},
		get loadState() {
			return input.loadState;
		},
		get selectable() {
			return input.selectable ?? input.kind === 'data';
		},
		get selected() {
			return source.getSelectedRowIds().includes(input.id);
		},
		get expandable() {
			return input.expandable ?? false;
		},
		get expanded() {
			if (input.expanded !== undefined) return input.expanded;
			if (input.kind === 'group') return source.isExpanded(input.id);
			return source.isDetailOpen(input.id);
		},
		get editable() {
			return input.editable ?? input.kind === 'data';
		},
		getData() {
			return getCurrentData();
		},
		getValue<TValue = unknown>(field: string): TValue | undefined {
			if (input.loadState.kind !== 'loaded') return undefined;
			return source.getCellValue(input.id, field) as TValue | undefined;
		},
		getDisplayValue(field: string): string {
			const value = this.getValue(field);
			return value == null ? '' : String(value);
		},
		setSelected(selected: boolean, options?: RowNodeSelectionOptions): GridWriteResult {
			if (!this.selectable) return rejectedResult(`Row '${input.id}' is not selectable.`);
			if (selected) source.selectRows([input.id], { mode: options?.clearOthers ? 'replace' : 'add' });
			else source.deselectRows([input.id]);
			return appliedResult(Date.now());
		},
		setExpanded(expanded: boolean): GridWriteResult {
			if (!this.expandable) return rejectedResult(`Row '${input.id}' is not expandable.`);
			if (expanded === this.expanded) return { status: 'noop' };
			if (input.kind === 'group') {
				source.setExpanded(input.id, expanded);
				return appliedResult(Date.now());
			}
			source.setDetailOpen(input.id, expanded);
			return appliedResult(Date.now());
		},
		ensureVisible(position?: 'top' | 'middle' | 'bottom' | 'nearest'): GridWriteResult {
			void position;
			source.scrollToRow(input.id);
			return appliedResult(Date.now());
		},
		setData(data: TRowData): GridWriteResult {
			const current = getCurrentData();
			if (!isWriteableLoadedDataRow() || current == null) return rejectedResult(`Row '${input.id}' is not writable in its current state.`);
			return source.writeCells(toRowReplaceUpdates(source, input.id, current, data));
		},
		updateData(partial: Partial<TRowData>): GridWriteResult {
			const current = getCurrentData();
			if (!isWriteableLoadedDataRow() || current == null) return rejectedResult(`Row '${input.id}' is not writable in its current state.`);
			return source.writeCells(toRowPatchUpdates(source, input.id, current, partial));
		},
		setDataValue(field: string, value: unknown): GridWriteResult {
			if (!isWriteableLoadedDataRow()) return rejectedResult(`Row '${input.id}' is not writable in its current state.`);
			return source.setCellValue(input.id, field, value);
		},
		refresh(): GridWriteResult {
			source.refreshRows();
			return appliedResult(Date.now());
		},
		retryLoad(): GridWriteResult {
			return source.retryRowLoad(this.rowIndex, input.loadState);
		},
		getValidationState(): GridRowNodeValidationState {
			const issues = source.getRowIssues(input.id);
			return {
				issues,
				valid: issues.length === 0,
			};
		},
		async validate(): Promise<GridWriteResult> {
			if (input.kind !== 'data') return rejectedResult(`Row '${input.id}' does not currently support validate.`);
			return validationResult(await source.validateRow(input.id));
		},
		getIntegrityIssues(): readonly GridIntegrityIssue[] {
			return source.getRowIssues(input.id);
		},
		async refreshIntegrity(): Promise<GridWriteResult> {
			if (input.kind !== 'data') return rejectedResult(`Row '${input.id}' does not currently support refreshIntegrity.`);
			return validationResult(await source.validateRow(input.id));
		},
	};
}
