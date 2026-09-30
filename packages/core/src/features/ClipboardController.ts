import { isHierarchyColumn } from '../rows/hierarchyColumn.js';
import type { ColumnDef } from '../columnDef.js';
import { getColumnInstanceIdentity } from '../columnDef.js';
import type { CanonicalGridCellPointer, GridWriteResult } from '../api/GridApi.js';
import type { VisualRow } from '../visualRow.js';
import type { InternalGridState } from '../state/GridState.js';
import type { GridEventPayloadMap } from '../api/GridEvents.js';
import { GridEventName } from '../api/GridEvents.js';
import { findColumnByCanonicalCellPointer, findColumnIndexByCanonicalCellPointer } from '../interaction/cellPointer.js';
import { readInteractionState } from '../interaction/interactionState.js';
import type { GridCapabilityAction, GridCapabilityParams, GridCapabilityResult } from '../capabilities/capabilityTypes.js';
import type { GridIntegrityIssue } from './dataIntegrity/integrityTypes.js';
import { dispatchWriteBlockedEvent, isWriteBlockedResult } from './writeBlockedEvent.js';

interface ClipboardContext<TRowData> {
	getState(): InternalGridState<TRowData>;
	getDisplayedColumns(): readonly ColumnDef<TRowData>[];
	getVisualRow(rowIdx: number): VisualRow<TRowData> | null;
	getVisualIndexByRowId(rowId: string): number | null;
	getCellValue(rowId: string, colField: string): unknown;
	getCheapDisplayValue(rowId: string, colField: string): string;
	getRawRowById(rowId: string): TRowData | null;
	batchCellValues(updates: { rowId: string; colField: string; value: unknown }[], source: 'paste' | 'api' | 'fill'): GridWriteResult;
	dispatchEvent<K extends keyof GridEventPayloadMap<TRowData>>(type: K, payload: GridEventPayloadMap<TRowData>[K]): void;
	validateWriteProposal?: (
		updates: readonly { rowId: string; colField: string; proposedValue: unknown }[],
		source: 'paste' | 'api' | 'fill' | 'edit' | 'undo' | 'redo'
	) => Promise<readonly GridIntegrityIssue[]>;
	checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;
	recordRejectedWrite?: (reason: string, cell?: { rowId: string; colField: string }) => void;
	/** Text of hierarchy cells: the hierarchy column on any row, and every column of group / total rows. */
	hierarchyCellText?: (row: VisualRow<TRowData>, col: ColumnDef<TRowData>) => string;
}

interface CopyResult {
	text: string;
	cells: Array<{ rowId: string; colField: string }>;
	rowCount: number;
	colCount: number;
}

export class ClipboardController<TRowData = unknown> {
	constructor(private readonly c: ClipboardContext<TRowData>) {}

	private getLiveSelectionBounds(
		selection: ReturnType<typeof readInteractionState<TRowData>>['cellSelection']['selection'],
		state: InternalGridState<TRowData>
	): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
		const range = selection.range;
		if (!range) return null;
		const startRow = this.c.getVisualIndexByRowId(range.start.rowId) ?? -1;
		const endRow = this.c.getVisualIndexByRowId(range.end.rowId) ?? -1;
		const startCol = this.getColumnIndexFromPointer(range.start, state);
		const endCol = this.getColumnIndexFromPointer(range.end, state);
		if (startRow === -1 || endRow === -1 || startCol === -1 || endCol === -1) return null;
		return {
			minRow: Math.min(startRow, endRow),
			maxRow: Math.max(startRow, endRow),
			minCol: Math.min(startCol, endCol),
			maxCol: Math.max(startCol, endCol),
		};
	}

	private resolveColumnFromPointer(pointer: CanonicalGridCellPointer, state: InternalGridState<TRowData>) {
		return findColumnByCanonicalCellPointer(this.c.getDisplayedColumns(), pointer) as ColumnDef<TRowData> | undefined;
	}

	private getColumnIndexFromPointer(pointer: CanonicalGridCellPointer, state: InternalGridState<TRowData>): number {
		return findColumnIndexByCanonicalCellPointer(this.c.getDisplayedColumns(), pointer);
	}

	private getDisplayedColumnAtIndex(index: number): ColumnDef<TRowData> | undefined {
		return this.c.getDisplayedColumns()[index];
	}

	public async copySelectedRange(): Promise<void> {
		const state = this.c.getState();
		const selection = readInteractionState(state).cellSelection.selection;
		const bounds = this.getLiveSelectionBounds(selection, state);

		if (!bounds) {
			const focus = selection.focus;
			if (!focus) return;
			const column = this.resolveColumnFromPointer(focus, state);
			if (!column) return;
			const text = this._getCellText(focus.rowId, column, state);
			await this._writeToClipboard(text);
			this.c.dispatchEvent(GridEventName.cellsCopied, {
				cells: [{ rowId: focus.rowId, colField: focus.colField }],
				rowCount: 1,
				colCount: 1,
				text,
			});
			return;
		}

		await this._copyRange(bounds.minRow, bounds.maxRow, bounds.minCol, bounds.maxCol);
	}

	public async copyRange(minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void> {
		await this._copyRange(minRow, maxRow, minCol, maxCol);
	}

	public async pasteFromClipboard(): Promise<void> {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		const state = this.c.getState();
		const selection = readInteractionState(state).cellSelection.selection;
		const focus = selection.focus;
		if (!focus) return;
		const liveBounds = this.getLiveSelectionBounds(selection, state);

		const focusRowIdx = this.c.getVisualIndexByRowId(focus.rowId) ?? -1;
		const focusColIdx = this.getColumnIndexFromPointer(focus, state);
		if (focusRowIdx === -1 || focusColIdx === -1) return;

		const startRow = liveBounds ? liveBounds.minRow : focusRowIdx;
		const startCol = liveBounds ? liveBounds.minCol : focusColIdx;

		try {
			const text = await navigator.clipboard.readText();
			if (!text) return;

			const lines = text.split(/\r?\n/);
			const updates: { rowId: string; colField: string; value: unknown }[] = [];
			const blockedCapabilityCells: Array<{ rowId: string; colField: string }> = [];
			let blockedCapabilityReason: string | null = null;
			let pastedRows = 0;
			let pastedCols = 0;

			for (let r = 0; r < lines.length; r++) {
				if (!lines[r] && r === lines.length - 1) break; // skip trailing newline
				const vr = this.c.getVisualRow(startRow + r);
				if (!vr || vr.kind !== 'data') continue;
				const rowId = vr.rowId;
				const cells = lines[r].split('\t');
				let colsPasted = 0;
				for (let c = 0; c < cells.length; c++) {
					const col = this.getDisplayedColumnAtIndex(startCol + c);
					if (!col) break;
					let value: unknown = cells[c];
					if (col.onPaste) {
						const row = this.c.getRawRowById(rowId);
						if (row !== null) value = col.onPaste({ row, rowId, colField: col.field, pastedText: cells[c] });
					}
					if (this.c.checkCapability) {
						const r = this.c.checkCapability('paste', { rowId, colField: col.field });
						if (!r.allowed) {
							blockedCapabilityCells.push({ rowId, colField: col.field });
							if (blockedCapabilityReason === null) {
								blockedCapabilityReason = typeof r.reason === 'string' ? r.reason : 'paste blocked by capability policy';
							}
							continue;
						}
					}
					updates.push({ rowId, colField: col.field, value });
					colsPasted++;
				}
				pastedRows++;
				if (colsPasted > pastedCols) pastedCols = colsPasted;
			}

			if (updates.length > 0) {
				const issues = await this.c.validateWriteProposal?.(
					updates.map((update) => ({ rowId: update.rowId, colField: update.colField, proposedValue: update.value })),
					'paste'
				);
				if ((issues?.length ?? 0) > 0) {
					const exactCell = this.getExactRejectedCell(updates, issues!);
					this.c.recordRejectedWrite?.('clipboard:validation', exactCell);
					dispatchWriteBlockedEvent(
						this.c.dispatchEvent,
						'paste',
						{ status: 'validationFailed', reason: issues![0]?.message ?? 'blocking validation failed', issues: issues! },
						updates.map((update) => ({ rowId: update.rowId, colField: update.colField }))
					);
					return;
				}
				const result = this.c.batchCellValues(updates, 'paste');
				if (result.status === 'applied' || result.status === 'noop') {
					this.c.dispatchEvent(GridEventName.cellsPasted, { rowCount: pastedRows, colCount: pastedCols });
					if (blockedCapabilityCells.length > 0 && blockedCapabilityReason) {
						dispatchWriteBlockedEvent(
							this.c.dispatchEvent,
							'paste',
							{ status: 'capabilityDenied', reason: blockedCapabilityReason },
							blockedCapabilityCells
						);
					}
				} else if (isWriteBlockedResult(result)) {
					dispatchWriteBlockedEvent(
						this.c.dispatchEvent,
						'paste',
						result,
						updates.map((update) => ({ rowId: update.rowId, colField: update.colField }))
					);
				}
			} else if (blockedCapabilityCells.length > 0 && blockedCapabilityReason) {
				dispatchWriteBlockedEvent(
					this.c.dispatchEvent,
					'paste',
					{ status: 'capabilityDenied', reason: blockedCapabilityReason },
					blockedCapabilityCells
				);
			}
		} catch {
			// Clipboard access denied — silently ignore
		}
	}

	private getExactRejectedCell(
		updates: readonly { rowId: string; colField: string }[],
		issues: readonly GridIntegrityIssue[]
	): { rowId: string; colField: string } | undefined {
		if (updates.length === 1) return { rowId: updates[0]!.rowId, colField: updates[0]!.colField };
		if (issues.some((issue) => issue.rowId === undefined || issue.colField === undefined)) return undefined;
		const first = { rowId: issues[0]!.rowId!, colField: issues[0]!.colField! };
		return issues.every((issue) => issue.rowId === first.rowId && issue.colField === first.colField) ? first : undefined;
	}

	private async _copyRange(minRow: number, maxRow: number, minCol: number, maxCol: number): Promise<void> {
		const state = this.c.getState();
		const result = this._buildTsv(minRow, maxRow, minCol, maxCol, state);
		if (!result) return;
		await this._writeToClipboard(result.text);
		this.c.dispatchEvent(GridEventName.cellsCopied, {
			cells: result.cells,
			rowCount: result.rowCount,
			colCount: result.colCount,
			text: result.text,
		});
	}

	private _buildTsv(minRow: number, maxRow: number, minCol: number, maxCol: number, state: InternalGridState<TRowData>): CopyResult | null {
		const cells: Array<{ rowId: string; colField: string }> = [];
		const rows: string[] = [];

		for (let r = minRow; r <= maxRow; r++) {
			const vr = this.c.getVisualRow(r);
			if (!vr) continue;
			if ((vr.kind === 'group' || vr.kind === 'total') && this.c.hierarchyCellText) {
				// Group and total rows copy what they show: the group label and formatted aggregates.
				const rowCells: string[] = [];
				for (let c = minCol; c <= maxCol; c++) {
					const col = this.getDisplayedColumnAtIndex(c);
					if (col) rowCells.push(this.c.hierarchyCellText(vr, col));
				}
				rows.push(rowCells.join('	'));
				continue;
			}
			if (vr.kind !== 'data') continue;
			const rowCells: string[] = [];
			for (let c = minCol; c <= maxCol; c++) {
				const col = this.getDisplayedColumnAtIndex(c);
				if (!col) continue;
				if (this.c.checkCapability) {
					const res = this.c.checkCapability('copy', { rowId: vr.rowId, colField: col.field });
					if (!res.allowed) continue;
				}
				rowCells.push(
					isHierarchyColumn(col) && this.c.hierarchyCellText ? this.c.hierarchyCellText(vr, col) : this._getCellText(vr.rowId, col, state)
				);
				cells.push({ rowId: vr.rowId, colField: col.field });
			}
			rows.push(rowCells.join('\t'));
		}

		if (rows.length === 0) return null;
		return {
			text: rows.join('\n'),
			cells,
			rowCount: maxRow - minRow + 1,
			colCount: maxCol - minCol + 1,
		};
	}

	private _getCellText(rowId: string, col: ColumnDef<TRowData>, state: InternalGridState<TRowData>): string {
		const colField = col.field;
		if (col?.onCopy) {
			const row = this.c.getRawRowById(rowId);
			if (row !== null) {
				return col.onCopy({ row, rowId, colField, value: this.c.getCellValue(rowId, colField) });
			}
		}
		if (col?.valueFormatter) {
			const value = this.c.getCellValue(rowId, colField);
			const rowData = this.c.getRawRowById(rowId) as TRowData;
			return col.valueFormatter({ value, rowData, colDef: col, rowId });
		}
		return this.c.getCheapDisplayValue(rowId, colField);
	}

	private async _writeToClipboard(text: string): Promise<void> {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		await navigator.clipboard.writeText(text).catch(() => {});
	}
}
