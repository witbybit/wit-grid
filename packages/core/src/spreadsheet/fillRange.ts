import { createFormulaRefKey } from '../ids.js';
import type { GridCellRange } from '../api/GridApi.js';
import type { GridWriteResult } from '../api/GridApi.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridEngine } from '../engine/GridEngine.js';
import type { RowModel } from '../rowModel.js';
import { dispatchWriteBlockedEvent, isWriteBlockedResult } from '../features/writeBlockedEvent.js';

type FillDirection = 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';

interface CapturedCell {
	value: unknown;
	hasFormula: boolean;
	formula?: string;
}

interface FillSeries {
	allNumeric: boolean;
	baseNum: number;
	step: number;
}

interface FillPlan {
	updates: GridCellRangeFillUpdate[];
	blockedCapabilityCells: Array<{ rowId: string; colField: string }>;
	blockedCapabilityReason: string | null;
}

export class SpreadsheetFillEngine<TRowData = unknown> {
	constructor(private readonly engine: GridEngine<TRowData>) {}

	public fillRange(source: GridCellRange, target: GridCellRange): void {
		const plan = this.buildFillPlan(source, target);
		if (plan.updates.length > 0) {
			const result = this.engine.transaction({ cells: plan.updates, source: 'fill' });
			if (isWriteBlockedResult(result)) {
				dispatchWriteBlockedEvent(
					this.engine.dispatchEvent.bind(this.engine),
					'fill',
					result,
					plan.updates.map((update) => ({ rowId: update.rowId, colField: update.colField }))
				);
			} else if (plan.blockedCapabilityCells.length > 0 && plan.blockedCapabilityReason) {
				dispatchWriteBlockedEvent(
					this.engine.dispatchEvent.bind(this.engine),
					'fill',
					{ status: 'capabilityDenied', reason: plan.blockedCapabilityReason },
					plan.blockedCapabilityCells
				);
			}
		} else if (plan.blockedCapabilityCells.length > 0 && plan.blockedCapabilityReason) {
			dispatchWriteBlockedEvent(
				this.engine.dispatchEvent.bind(this.engine),
				'fill',
				{ status: 'capabilityDenied', reason: plan.blockedCapabilityReason },
				plan.blockedCapabilityCells
			);
		}
	}

	public async fillRangeAsync(source: GridCellRange, target: GridCellRange): Promise<GridWriteResult> {
		const plan = this.buildFillPlan(source, target);
		if (plan.updates.length === 0) {
			if (plan.blockedCapabilityCells.length > 0 && plan.blockedCapabilityReason) {
				dispatchWriteBlockedEvent(
					this.engine.dispatchEvent.bind(this.engine),
					'fill',
					{ status: 'capabilityDenied', reason: plan.blockedCapabilityReason },
					plan.blockedCapabilityCells
				);
			}
			return { status: 'noop' };
		}
		const result = await this.engine.transactionAsync({ cells: plan.updates, source: 'fill' });
		if (isWriteBlockedResult(result)) {
			dispatchWriteBlockedEvent(
				this.engine.dispatchEvent.bind(this.engine),
				'fill',
				result,
				plan.updates.map((update) => ({ rowId: update.rowId, colField: update.colField }))
			);
		} else if (plan.blockedCapabilityCells.length > 0 && plan.blockedCapabilityReason) {
			dispatchWriteBlockedEvent(
				this.engine.dispatchEvent.bind(this.engine),
				'fill',
				{ status: 'capabilityDenied', reason: plan.blockedCapabilityReason },
				plan.blockedCapabilityCells
			);
		}
		return result;
	}

	private buildFillPlan(source: GridCellRange, target: GridCellRange): FillPlan {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return { updates: [], blockedCapabilityCells: [], blockedCapabilityReason: null };

		const state = this.engine.stateManager.getState();
		const columns = state.columns;

		const sourceBounds = this.resolveRangeBounds(source);
		const targetBounds = this.resolveRangeBounds(target);
		if (!sourceBounds || !targetBounds) return { updates: [], blockedCapabilityCells: [], blockedCapabilityReason: null };

		let direction: FillDirection = 'DOWN';
		if (targetBounds.minRow > sourceBounds.maxRow) direction = 'DOWN';
		else if (targetBounds.maxRow < sourceBounds.minRow) direction = 'UP';
		else if (targetBounds.minCol > sourceBounds.maxCol) direction = 'RIGHT';
		else if (targetBounds.maxCol < sourceBounds.minCol) direction = 'LEFT';

		const updates: GridCellRangeFillUpdate[] = [];
		const blockedCapabilityCells: Array<{ rowId: string; colField: string }> = [];
		let blockedCapabilityReason: string | null = null;

		if (direction === 'DOWN' || direction === 'UP') {
			this.fillRows(direction, sourceBounds, targetBounds, rowModel, columns, updates, blockedCapabilityCells, (reason) => {
				if (blockedCapabilityReason === null) {
					blockedCapabilityReason = reason;
				}
			});
		}

		if (direction === 'RIGHT' || direction === 'LEFT') {
			this.fillColumns(direction, sourceBounds, targetBounds, rowModel, columns, updates, blockedCapabilityCells, (reason) => {
				if (blockedCapabilityReason === null) {
					blockedCapabilityReason = reason;
				}
			});
		}

		return { updates, blockedCapabilityCells, blockedCapabilityReason };
	}

	private fillRows(
		direction: FillDirection,
		sourceBounds: GridBounds,
		targetBounds: GridBounds,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[],
		updates: GridCellRangeFillUpdate[],
		blockedCapabilityCells: Array<{ rowId: string; colField: string }>,
		onCapabilityBlocked: (reason: string) => void
	): void {
		const fillRows = this.buildOrderedIndexes(targetBounds.minRow, targetBounds.maxRow, direction === 'UP');
		for (let c = targetBounds.minCol; c <= targetBounds.maxCol; c++) {
			const col = columns[c];
			if (!col) continue;

			const sourceValues: CapturedCell[] = [];
			for (let r = sourceBounds.minRow; r <= sourceBounds.maxRow; r++) {
				const visualRow = rowModel.getVisualRow(r);
				if (visualRow?.kind === 'data') sourceValues.push(this.captureCell(visualRow.rowId, col.field));
			}

			if (sourceValues.length === 0) continue;

			const series = this.analyzeFillSeries(sourceValues);
			fillRows.forEach((r, idx) => {
				const visualRow = rowModel.getVisualRow(r);
				if (visualRow?.kind !== 'data') return;

				const srcItem = sourceValues[idx % sourceValues.length];
				const deltaRow = r - (direction === 'DOWN' ? sourceBounds.maxRow : sourceBounds.minRow);
				this.applyFillValue(
					visualRow.rowId,
					col.field,
					idx,
					srcItem,
					series,
					deltaRow,
					0,
					rowModel,
					columns,
					updates,
					blockedCapabilityCells,
					onCapabilityBlocked
				);
			});
		}
	}

	private fillColumns(
		direction: FillDirection,
		sourceBounds: GridBounds,
		targetBounds: GridBounds,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[],
		updates: GridCellRangeFillUpdate[],
		blockedCapabilityCells: Array<{ rowId: string; colField: string }>,
		onCapabilityBlocked: (reason: string) => void
	): void {
		const fillCols = this.buildOrderedIndexes(targetBounds.minCol, targetBounds.maxCol, direction === 'LEFT');
		for (let r = targetBounds.minRow; r <= targetBounds.maxRow; r++) {
			const visualRow = rowModel.getVisualRow(r);
			if (visualRow?.kind !== 'data') continue;

			const sourceValues: CapturedCell[] = [];
			for (let c = sourceBounds.minCol; c <= sourceBounds.maxCol; c++) {
				const col = columns[c];
				if (col) sourceValues.push(this.captureCell(visualRow.rowId, col.field));
			}

			if (sourceValues.length === 0) continue;

			const series = this.analyzeFillSeries(sourceValues);
			fillCols.forEach((c, idx) => {
				const col = columns[c];
				if (!col) return;

				const srcItem = sourceValues[idx % sourceValues.length];
				const deltaCol = c - (direction === 'RIGHT' ? sourceBounds.maxCol : sourceBounds.minCol);
				this.applyFillValue(
					visualRow.rowId,
					col.field,
					idx,
					srcItem,
					series,
					0,
					deltaCol,
					rowModel,
					columns,
					updates,
					blockedCapabilityCells,
					onCapabilityBlocked
				);
			});
		}
	}

	private resolveRangeBounds(range: GridCellRange): GridBounds | null {
		const rowModel = this.engine.getRowModel();
		if (!rowModel) return null;

		const startRowIdx = rowModel.getVisualIndexByRowId(range.start.rowId);
		const endRowIdx = rowModel.getVisualIndexByRowId(range.end.rowId);
		const startColIdx = this.engine.columns.getColumnIndex(range.start.colField);
		const endColIdx = this.engine.columns.getColumnIndex(range.end.colField);

		if (startRowIdx < 0 || endRowIdx < 0 || startColIdx < 0 || endColIdx < 0) return null;

		return {
			minRow: Math.min(startRowIdx, endRowIdx),
			maxRow: Math.max(startRowIdx, endRowIdx),
			minCol: Math.min(startColIdx, endColIdx),
			maxCol: Math.max(startColIdx, endColIdx),
		};
	}

	private buildOrderedIndexes(start: number, end: number, reverse: boolean): number[] {
		const indexes: number[] = [];
		if (reverse) {
			for (let i = end; i >= start; i--) indexes.push(i);
		} else {
			for (let i = start; i <= end; i++) indexes.push(i);
		}
		return indexes;
	}

	private captureCell(rowId: string, colField: string): CapturedCell {
		const hasFormula = this.engine.hasFormula(rowId, colField);
		return {
			value: this.engine.data.getCellValue(rowId, colField),
			hasFormula,
			formula: hasFormula ? this.engine.getFormula(rowId, colField) : undefined,
		};
	}

	private analyzeFillSeries(sourceValues: Array<{ value: unknown; hasFormula: boolean }>): FillSeries {
		const allNumeric = sourceValues.every((s) => !s.hasFormula && !Number.isNaN(parseFloat(String(s.value))) && s.value !== '');
		if (!allNumeric || sourceValues.length === 0) return { allNumeric: false, baseNum: 0, step: 0 };

		const numbers = sourceValues.map((s) => parseFloat(String(s.value)));
		if (numbers.length === 1) return { allNumeric: true, baseNum: numbers[0], step: 0 };

		let diffSum = 0;
		for (let i = 0; i < numbers.length - 1; i++) {
			diffSum += numbers[i + 1] - numbers[i];
		}
		return { allNumeric: true, baseNum: numbers[numbers.length - 1], step: diffSum / (numbers.length - 1) };
	}

	private applyFillValue(
		rowId: string,
		colField: string,
		index: number,
		source: CapturedCell,
		series: FillSeries,
		deltaRow: number,
		deltaCol: number,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[],
		updates: GridCellRangeFillUpdate[],
		blockedCapabilityCells: Array<{ rowId: string; colField: string }>,
		onCapabilityBlocked: (reason: string) => void
	): void {
		let nextValue = source.value;
		let nextFormula: string | undefined;

		if (source.hasFormula && source.formula) {
			nextFormula = this.shiftFormulaReferences(source.formula, deltaRow, deltaCol, rowModel, columns);
			nextValue = nextFormula;
		} else if (series.allNumeric) {
			const finalVal = series.step === 0 ? series.baseNum : series.baseNum + series.step * (index + 1);
			nextValue = Number.isInteger(finalVal) ? finalVal : parseFloat(finalVal.toFixed(4));
		}

		if (this.engine.capabilityManager) {
			const result = this.engine.capabilityManager.can('fill', { rowId, colField });
			if (!result.allowed) {
				blockedCapabilityCells.push({ rowId, colField });
				onCapabilityBlocked(result.reason ?? 'fill blocked by capability policy');
				return;
			}
		}
		updates.push({
			rowId,
			colField,
			value: nextFormula ?? nextValue,
		});
	}

	private shiftFormulaReferences(
		formula: string,
		deltaRow: number,
		deltaCol: number,
		rowModel: RowModel<TRowData>,
		columns: ColumnDef<TRowData>[]
	): string {
		const regex = /\[([^\]:]+):([^\]:]+)\]/g;
		return formula.replace(regex, (_match, refRowId, refColField) => {
			let newRowId = refRowId;
			let newColField = refColField;

			if (deltaRow !== 0) {
				const rowIdx = rowModel.getVisualIndexByRowId(refRowId);
				if (rowIdx !== -1) {
					const newRowIdx = rowIdx + deltaRow;
					const newVisualRow = rowModel.getVisualRow(newRowIdx);
					if (newVisualRow?.kind === 'data') {
						newRowId = newVisualRow.rowId;
					}
				}
			}

			if (deltaCol !== 0) {
				const colIdx = this.engine.columns.getColumnIndex(refColField);
				if (colIdx !== -1) {
					const newColIdx = colIdx + deltaCol;
					const newCol = columns[newColIdx];
					if (newCol) {
						newColField = newCol.field;
					}
				}
			}

			return createFormulaRefKey(newRowId, newColField);
		});
	}
}

interface GridBounds {
	minRow: number;
	maxRow: number;
	minCol: number;
	maxCol: number;
}

interface GridCellRangeFillUpdate {
	rowId: string;
	colField: string;
	value: unknown;
}
