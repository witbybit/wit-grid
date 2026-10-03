import type { ColumnDef } from '../columnDef.js';
import type { RowNode } from '../rowNode.js';
import type { VisualRow } from '../visualRow.js';
import type { AggregationDef } from './hierarchyConfig.js';
import { DRIFT_RECOMPUTE_EVERY } from './incrementalRowIndex.js';
import { createRowPipelineContext } from './pipelineContext.js';
import { addStatsValue, createStats, STAT_FUNCS, statAggregates, type FieldStats } from './stages/aggregateStage.js';

type ChangedValues = Map<string, Map<string, { oldValue: unknown; newValue: unknown }>>;

const isNumber = (value: unknown): value is number => typeof value === 'number' && !isNaN(value);

/**
 * A flat grid's grand total kept by deltas: a value change moves sum and counts by the difference,
 * min/max rescan only when the extreme leaves, first/last are read from the first and last data
 * row, and an exact recount every {@link DRIFT_RECOMPUTE_EVERY} deltas bounds float drift. Built-in
 * functions on plain fields only (`create` returns null otherwise).
 */
export class FlatTotals<TData> {
	private readonly stats = new Map<string, FieldStats>();
	private readonly fields: string[];
	private readonly readers: Array<(node: RowNode<TData>) => unknown>;
	private deltas = 0;

	private constructor(
		private readonly aggDefs: AggregationDef<TData>[],
		columns: ColumnDef<TData>[],
		private readonly rows: () => readonly VisualRow<TData>[]
	) {
		this.fields = [...new Set(aggDefs.map((def) => def.colId))];
		const context = createRowPipelineContext(columns);
		this.readers = this.fields.map((colId) => context.readerFor(colId));
		this.recount();
	}

	static create<TData>(aggDefs: AggregationDef<TData>[], columns: ColumnDef<TData>[], rows: () => readonly VisualRow<TData>[]): FlatTotals<TData> | null {
		if (aggDefs.length === 0 || aggDefs.some((def) => typeof def.aggFunc !== 'string' || !STAT_FUNCS.has(def.aggFunc))) return null;
		const byField = new Map(columns.map((column) => [column.field, column]));
		if (aggDefs.some((def) => def.colId.includes('.') || byField.get(def.colId)?.valueGetter)) return null;
		return new FlatTotals(aggDefs, columns, rows);
	}

	/** Folds value changes of visible rows (`isVisible`) into the totals. */
	apply(changedValuesByRow: ChangedValues, isVisible: (rowId: string) => boolean): void {
		let rescan = false;
		for (const [rowId, changes] of changedValuesByRow) {
			if (!isVisible(rowId)) continue;
			for (const colId of this.fields) {
				const change = changes.get(colId);
				if (!change) continue;
				const stats = this.stats.get(colId)!;
				const { oldValue, newValue } = change;
				if (isNumber(oldValue)) {
					stats.numericCount--;
					stats.sum -= oldValue;
					if (oldValue === stats.min || oldValue === stats.max) rescan = true;
				}
				if (isNumber(newValue)) {
					stats.numericCount++;
					stats.sum += newValue;
					if (newValue < stats.min) stats.min = newValue;
					if (newValue > stats.max) stats.max = newValue;
				}
				this.deltas++;
			}
		}
		if (rescan || this.deltas >= DRIFT_RECOMPUTE_EVERY) this.recount();
	}

	/** The grand total's aggregates, as the full run's aggregate stage would produce them. */
	aggregates(): Record<string, unknown> {
		const rows = this.rows();
		let first = -1;
		let last = -1;
		for (let i = 0; i < rows.length; i++) if (rows[i].kind === 'data') {
			first = i;
			break;
		}
		for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === 'data') {
			last = i;
			break;
		}
		for (let f = 0; f < this.fields.length; f++) {
			const stats = this.stats.get(this.fields[f])!;
			const firstRow = rows[first];
			const lastRow = rows[last];
			stats.first = firstRow?.kind === 'data' ? this.readers[f](firstRow.node) : undefined;
			stats.last = lastRow?.kind === 'data' ? this.readers[f](lastRow.node) : undefined;
		}
		return statAggregates(this.aggDefs, this.stats);
	}

	private recount(): void {
		this.deltas = 0;
		const stats = this.fields.map(() => createStats());
		for (const row of this.rows()) {
			if (row.kind !== 'data') continue;
			for (let f = 0; f < this.fields.length; f++) addStatsValue(stats[f], this.readers[f](row.node));
		}
		this.fields.forEach((colId, f) => this.stats.set(colId, stats[f]));
	}
}
