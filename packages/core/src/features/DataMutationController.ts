import type { DataModel } from '../models/DataModel.js';
import type { ColumnModel } from '../models/ColumnModel.js';
import type { FormulaCellCoordinate } from '../calculations/dagEngine.js';
import type { GridCellWrite, GridCellPointer } from '../api/GridApi.js';
import { asAnyModelCellWritable, type RowModel, type RowModelWriteResult } from '../rowModel.js';

export type { GridCellWrite };

export interface CellValueChangeOptions {
	bypassValueSetter?: boolean;
	source?: 'api' | 'edit' | 'fill' | 'paste' | 'undo' | 'redo' | 'transaction';
}

export interface CellValueChangeResult {
	applied: boolean;
	rowId: string;
	colField: string;
	oldRawValue: unknown;
	oldComputedValue: unknown;
	newRawValue: unknown;
	newComputedValue?: unknown;
	invalidatedCells: GridCellPointer[];
}

export interface StructuralWriteEffectResult {
	invalidatedCells: GridCellPointer[];
	cellChanges: Map<string, Set<string>>;
}

export interface DataMutationDeps<TRowData = unknown> {
	data: DataModel<TRowData>;
	columns: ColumnModel<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	syncFormulaForCell: (rowId: string, colField: string, value: unknown) => void;
	invalidateFormulaCell: (rowId: string, colField: string) => FormulaCellCoordinate[];
}

export class DataMutationController<TRowData = unknown> {
	constructor(private readonly deps: DataMutationDeps<TRowData>) {}

	applyStructuralWriteEffects(writeResult: RowModelWriteResult<TRowData>): StructuralWriteEffectResult {
		const invalidatedCells: GridCellPointer[] = [];
		const cellChanges = new Map<string, Set<string>>();
		const seen = new Set<string>();

		const addCell = (rowId: string, colField: string): void => {
			const key = `${rowId}:${colField}`;
			if (seen.has(key)) return;
			seen.add(key);
			invalidatedCells.push({ rowId, colField });
			let rowFields = cellChanges.get(rowId);
			if (!rowFields) {
				rowFields = new Set<string>();
				cellChanges.set(rowId, rowFields);
			}
			rowFields.add(colField);
		};

		const changedFieldsByRow = writeResult.changedFieldsByRow;
		if (!changedFieldsByRow || changedFieldsByRow.size === 0) {
			return { invalidatedCells, cellChanges };
		}

		for (const [rowId, fields] of changedFieldsByRow) {
			const changedValues = writeResult.changedValuesByRow?.get(rowId);
			for (const colField of fields) {
				const newRawValue = changedValues?.get(colField)?.newValue ?? this.deps.data.getRawCellValue(rowId, colField);
				this.deps.syncFormulaForCell(rowId, colField, newRawValue);
				addCell(rowId, colField);
				for (const dependentField of this.deps.columns.getValueGetterDependents(colField)) {
					if (dependentField !== colField) addCell(rowId, dependentField);
				}
				for (const formulaCell of this.deps.invalidateFormulaCell(rowId, colField)) {
					addCell(formulaCell.rowId, formulaCell.colField);
				}
			}
		}

		for (const cell of invalidatedCells) {
			this.deps.data.clearValueGetterCache(cell.rowId, cell.colField);
		}

		return { invalidatedCells, cellChanges };
	}

	applyCellValueChange(rowId: string, colField: string, value: unknown, options: CellValueChangeOptions = {}): CellValueChangeResult {
		const notApplied = (oldRawValue: unknown, oldComputedValue: unknown): CellValueChangeResult => ({
			applied: false,
			rowId,
			colField,
			oldRawValue,
			oldComputedValue,
			newRawValue: value,
			invalidatedCells: [],
		});

		const col = this.deps.columns.getColumnDef(colField);
		const oldRawValue = this.deps.data.getRawCellValue(rowId, colField);
		const oldComputedValue = this.deps.data.getCellValue(rowId, colField);

		const oldStoredValue = col?.valueGetter ? this.deps.data.getStoredCellValue(rowId, colField) : oldRawValue;
		if (oldStoredValue === value) return notApplied(oldRawValue, oldComputedValue);

		const cellWritable = asAnyModelCellWritable(this.deps.getRowModel());
		if (!cellWritable) return notApplied(oldRawValue, oldComputedValue);
		const writeResult = cellWritable.writeCellValueStructurally(rowId, colField, value, {
			bypassValueSetter: options.bypassValueSetter === true,
		});
		if (!writeResult.updatedNodes?.length) return notApplied(oldRawValue, oldComputedValue);
		const effects = this.applyStructuralWriteEffects(writeResult);

		const newComputedValue = this.deps.data.getCellValue(rowId, colField);

		return {
			applied: true,
			rowId,
			colField,
			oldRawValue,
			oldComputedValue,
			newRawValue: value,
			newComputedValue,
			invalidatedCells: effects.invalidatedCells,
		};
	}
}
