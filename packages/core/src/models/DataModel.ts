import { compilePathGetter, type ColumnDef } from '../columnDef.js';
import type { DataModelRuntime } from '../engine/runtimePorts.js';
import { createGridRowDataRef } from '../publicRowRef.js';
import { RowNode } from '../rowNode.js';

interface FormattedValueCacheEntry {
	rowVersion: number;
	globalVersion: number;
	raw: unknown;
	rowData: unknown;
	text: string;
}

const FORMATTED_VALUE_CACHE_CAPACITY = 8192;

export class DataModel<TRowData = unknown> {
	private autoRowIdMap = new WeakMap<object, string>();
	private autoRowIdCounter = 0;
	private compiledGetters = new Map<string, (data: TRowData) => unknown>();
	private valueGetterCache = new Map<string, Map<string, unknown>>();
	/** columnKey → rowId → formatted text; see getCachedFormattedValue. */
	private formattedValueCache = new Map<string, Map<string, FormattedValueCacheEntry>>();
	private formattedValueCacheSize = 0;

	constructor(private readonly runtime: DataModelRuntime<TRowData>) {}

	public getRowId = (row: TRowData): string => {
		const state = this.runtime.getState();
		if (state.getRowId) {
			return state.getRowId(row);
		}
		if (typeof row === 'object' && row !== null) {
			const rowRecord = row as Record<string, unknown>;
			if (rowRecord.id !== undefined && rowRecord.id !== null) {
				return String(rowRecord.id);
			}
			let id = this.autoRowIdMap.get(row);
			if (id === undefined) {
				id = `__row_${this.autoRowIdCounter++}__`;
				this.autoRowIdMap.set(row, id);
			}
			return id;
		}
		return String(row);
	};

	public isRowLoading(rowId: string): boolean {
		return rowId.startsWith('__loading_');
	}

	public updateCompiledGetters(columns: ColumnDef<TRowData>[]): void {
		this.compiledGetters.clear();
		this.clearValueGetterCache();
		for (let i = 0; i < columns.length; i++) {
			const col = columns[i];
			if (col.field) {
				this.compiledGetters.set(col.field, compilePathGetter(col.field));
			}
		}
	}

	public clearValueGetterCache(rowId?: string, colField?: string): void {
		// Anything that invalidates computed values also invalidates their formatted text.
		this.clearFormattedValueCache(rowId);
		if (!rowId) {
			this.valueGetterCache.clear();
			return;
		}

		const rowCache = this.valueGetterCache.get(rowId);
		if (!rowCache) return;

		if (colField) {
			rowCache.delete(colField);
			if (rowCache.size === 0) {
				this.valueGetterCache.delete(rowId);
			}
			return;
		}

		this.valueGetterCache.delete(rowId);
	}

	/**
	 * Bounded cache of valueFormatter output for plain field columns, keyed by (rowId, column
	 * instance). An entry is valid only for the exact (rowVersion, globalVersion, raw value, row object)
	 * it was stored at, so any row mutation, row replacement or structural change misses; column
	 * updates and value-getter invalidations clear it outright. Returns undefined on a miss.
	 */
	public getCachedFormattedValue(
		rowId: string,
		columnKey: string,
		rowVersion: number,
		globalVersion: number,
		raw: unknown,
		rowData: unknown
	): string | undefined {
		const entry = this.formattedValueCache.get(columnKey)?.get(rowId);
		if (!entry || entry.rowVersion !== rowVersion || entry.globalVersion !== globalVersion) return undefined;
		if (!Object.is(entry.raw, raw) || entry.rowData !== rowData) return undefined;
		return entry.text;
	}

	public setCachedFormattedValue(
		rowId: string,
		columnKey: string,
		rowVersion: number,
		globalVersion: number,
		raw: unknown,
		rowData: unknown,
		text: string
	): void {
		let byRow = this.formattedValueCache.get(columnKey);
		if (!byRow) {
			byRow = new Map();
			this.formattedValueCache.set(columnKey, byRow);
		}
		const existing = byRow.get(rowId);
		if (existing) {
			existing.rowVersion = rowVersion;
			existing.globalVersion = globalVersion;
			existing.raw = raw;
			existing.rowData = rowData;
			existing.text = text;
			return;
		}
		// Bounded: a full reset when over budget is cheap, rare, and only costs re-formatting.
		if (this.formattedValueCacheSize >= FORMATTED_VALUE_CACHE_CAPACITY) {
			this.formattedValueCache.clear();
			this.formattedValueCacheSize = 0;
			byRow = new Map();
			this.formattedValueCache.set(columnKey, byRow);
		}
		byRow.set(rowId, { rowVersion, globalVersion, raw, rowData, text });
		this.formattedValueCacheSize++;
	}

	public clearFormattedValueCache(rowId?: string): void {
		if (this.formattedValueCacheSize === 0) return;
		if (!rowId) {
			this.formattedValueCache.clear();
			this.formattedValueCacheSize = 0;
			return;
		}
		for (const byRow of this.formattedValueCache.values()) {
			if (byRow.delete(rowId)) this.formattedValueCacheSize--;
		}
	}

	/**
	 * The raw (unstringified) cached value behind a getCachedDisplayValue hit for a valueGetter or
	 * formula cell — what a valueFormatter should receive. Only meaningful after getCachedDisplayValue
	 * returned a string for the same cell; plain fields are read from the row directly by callers.
	 */
	public getCachedCellValue(rowId: string, colField: string): unknown {
		if (this.runtime.hasFormula(rowId, colField)) {
			const res = this.runtime.getCachedFormulaValue(rowId, colField);
			return res.hasCached ? res.value : undefined;
		}
		return this.valueGetterCache.get(rowId)?.get(colField);
	}

	private getValueGetterValue(rowId: string, colField: string, col: ColumnDef<TRowData>, node: RowNode<TRowData>): unknown {
		return this.getValueGetterValueInternal(rowId, colField, col, node, true);
	}

	private getValueGetterValueInternal(
		rowId: string,
		colField: string,
		col: ColumnDef<TRowData>,
		node: RowNode<TRowData>,
		trackDuringScroll: boolean
	): unknown {
		if (this.runtime.isScrolling() || this.runtime.isScrollFrameActive()) {
			if (trackDuringScroll) this.runtime.recordValueGetterDuringScroll();
		}
		const rowRef = createGridRowDataRef(node.id, node.data);
		if (!col.valueGetterDependencies) {
			return col.valueGetter!({ node: rowRef, row: node.data, colField });
		}

		let rowCache = this.valueGetterCache.get(rowId);
		if (!rowCache) {
			rowCache = new Map<string, unknown>();
			this.valueGetterCache.set(rowId, rowCache);
		}
		if (rowCache.has(colField)) {
			return rowCache.get(colField);
		}

		const value = col.valueGetter!({ node: rowRef, row: node.data, colField });
		rowCache.set(colField, value);
		return value;
	}

	public primeDisplayValue(rowId: string, colField: string): string | undefined {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		const col = this.runtime.getColumnDef(colField);
		const rawValue = this.getRawCellValueInternal(rowId, colField, false);
		if (this.runtime.hasFormula(rowId, colField) || (typeof rawValue === 'string' && rawValue.startsWith('='))) {
			const value = this.getCellValueInternal(rowId, colField, false);
			return value == null ? '' : String(value);
		}

		if (!col?.valueGetter) {
			return this.getCachedDisplayValue(rowId, colField);
		}

		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return undefined;
		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		if (node?.data) {
			const value = this.getValueGetterValueInternal(rowId, colField, col, node, false);
			return value == null ? '' : String(value);
		}

		const idx = rowModel.getVisualIndexByRowId(rowId);
		if (idx === -1) return undefined;
		const visualRow = rowModel.getVisualRow(idx);
		const row = visualRow?.kind === 'data' ? visualRow.node.data : null;
		if (!row) return undefined;

		const dummyNode = new RowNode<TRowData>(rowId, row);
		const value = this.getValueGetterValueInternal(rowId, colField, col, dummyNode, false);
		return value == null ? '' : String(value);
	}

	private getRawCellValueInternal(rowId: string, colField: string, trackDuringScroll: boolean): unknown {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return '';
		const col = this.runtime.getColumnDef(colField);
		if (!col) return '';

		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		if (!node) {
			const idx = rowModel.getVisualIndexByRowId(rowId);
			if (idx === -1) return '';
			const visualRow = rowModel.getVisualRow(idx);
			const row = visualRow?.kind === 'data' ? visualRow.node.data : null;
			if (!row) return '';
			if (col.valueGetter) {
				const dummyNode = new RowNode<TRowData>(rowId, row);
				return this.getValueGetterValueInternal(rowId, colField, col, dummyNode, trackDuringScroll);
			}
			const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
			return getter(row);
		}

		if (col.valueGetter) {
			return this.getValueGetterValueInternal(rowId, colField, col, node, trackDuringScroll);
		}
		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		return node.getCellValue(colField, getter);
	}

	public getRawCellValue = (rowId: string, colField: string): unknown => {
		return this.getRawCellValueInternal(rowId, colField, true);
	};

	public getStoredCellValue = (rowId: string, colField: string): unknown => {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return '';
		const col = this.runtime.getColumnDef(colField);
		if (!col) return '';

		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		const row =
			node?.data ??
			(() => {
				const idx = rowModel.getVisualIndexByRowId(rowId);
				if (idx === -1) return null;
				const visualRow = rowModel.getVisualRow(idx);
				return visualRow?.kind === 'data' ? visualRow.node.data : null;
			})();
		if (!row) return '';

		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		return getter(row);
	};

	public getCachedDisplayValue(rowId: string, colField: string): string | undefined {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		if (this.runtime.hasFormula(rowId, colField)) {
			const res = this.runtime.getCachedFormulaValue(rowId, colField);
			if (res.hasCached) {
				return res.value == null ? '' : String(res.value);
			}
			return undefined;
		}

		const col = this.runtime.getColumnDef(colField);
		if (col?.valueGetter) {
			const rowCache = this.valueGetterCache.get(rowId);
			if (rowCache && rowCache.has(colField)) {
				const val = rowCache.get(colField);
				return val == null ? '' : String(val);
			}
			return undefined;
		}

		const cheapVal = this.getCheapDisplayValue(rowId, colField);
		return cheapVal;
	}

	public getCheapDisplayValue(rowId: string, colField: string): string {
		if (this.isRowLoading(rowId)) {
			return '';
		}

		const col = this.runtime.getColumnDef(colField);
		if (!col) return '';

		if (col.valueGetter || this.runtime.hasFormula(rowId, colField)) {
			const rowCache = this.valueGetterCache.get(rowId);
			if (rowCache && rowCache.has(colField)) {
				const val = rowCache.get(colField);
				return val == null ? '' : String(val);
			}
			if (this.runtime.hasFormula(rowId, colField)) {
				const res = this.runtime.getCachedFormulaValue(rowId, colField);
				if (res.hasCached) {
					return res.value == null ? '' : String(res.value);
				}
			}
			return '';
		}

		const rowModel = this.runtime.getRowModel();
		if (!rowModel) return '';

		const node = rowModel.getRowNodeById ? rowModel.getRowNodeById(rowId) : null;
		const row = node ? node.data : rowModel.getRawRowById ? rowModel.getRawRowById(rowId) : null;
		if (!row) return '';

		const getter = this.compiledGetters.get(colField) || compilePathGetter(colField);
		const rawVal = getter(row);
		return rawVal == null ? '' : String(rawVal);
	}

	public getComputedCellValue(rowId: string, colField: string): unknown {
		return this.getCellValue(rowId, colField);
	}

	private getCellValueInternal(rowId: string, colField: string, trackDuringScroll: boolean): unknown {
		if (this.runtime.isScrolling() || this.runtime.isScrollFrameActive()) {
			if (trackDuringScroll) this.runtime.recordGetCellValueDuringScroll();
		}
		const rawVal = this.getRawCellValueInternal(rowId, colField, trackDuringScroll);
		if (typeof rawVal === 'string' && rawVal.startsWith('=')) {
			if (!this.runtime.hasFormula(rowId, colField) || this.runtime.getFormula(rowId, colField) !== rawVal) {
				this.runtime.syncFormulaForCell(rowId, colField, rawVal);
			}
		} else {
			if (this.runtime.hasFormula(rowId, colField)) {
				this.runtime.syncFormulaForCell(rowId, colField, rawVal);
			}
		}

		if (this.runtime.hasFormula(rowId, colField)) {
			if (this.runtime.isScrolling() || this.runtime.isScrollFrameActive()) {
				if (trackDuringScroll) this.runtime.recordFormulaDuringScroll();
			}
			return this.runtime.evaluateFormulaCell(rowId, colField, (rId, cField) => this.getRawCellValueInternal(rId, cField, trackDuringScroll));
		}

		return rawVal;
	}

	public getCellValue = (rowId: string, colField: string): unknown => {
		return this.getCellValueInternal(rowId, colField, true);
	};
}
