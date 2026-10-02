import {
	isDomCellRenderer,
	createColumnInstanceId,
	type ColumnDef,
	type ColumnInstanceId,
	type InternalColumnDef,
	type ColumnRenderPlan,
	type ColumnRenderMode,
	type CompiledGridPlan,
	type CellRendererCapabilities,
	type CellScrollPresentation,
	type NormalizedCellRendererCapabilities,
} from '../columnDef.js';
import type { ColumnModelRuntime } from '../engine/runtimePorts.js';
import { IndexMapper } from './IndexMapper.js';

/** The one place a renderer column's scroll presentation default lives: DOM renderers update in place, React renderers show stand-in text. */
export function defaultRendererScroll(domRenderer: boolean): CellScrollPresentation {
	return domRenderer ? 'live' : 'text';
}

/** Normalizes a renderer's capabilities, resolving `scroll` to a concrete mode. */
export function normalizeRendererCapabilities(
	cap: CellRendererCapabilities | undefined,
	options: { domRenderer?: boolean; imperative?: boolean } = {}
): NormalizedCellRendererCapabilities {
	if (options.imperative) return { ...cap, scroll: 'live', imperative: true };
	return { ...cap, scroll: cap?.scroll ?? defaultRendererScroll(!!options.domRenderer) };
}

/**
 * Structural fingerprint deciding whether a re-normalized column at the same `field` is still the
 * "same" column instance (stable instanceId) or has been semantically replaced (mint a new one).
 * Deliberately reference equality, not deep-equality: deep-equality would mint a spurious new
 * instanceId on every capabilities-object recreation from caller-side spreads/memo boundaries, and
 * would be too expensive to run on every updateColumns() call (which can run once per keystroke in
 * interactive column-config UIs). Reference equality on the two fields that most often change under
 * a genuine renderer swap (cellRenderer, valueGetter) is enough to catch the real cases this exists
 * for — e.g. a text column swapped for a react custom renderer at the same field.
 */
function isSameColumnInstance<TRowData>(
	prev: Pick<InternalColumnDef<TRowData>, 'cellRenderer' | 'valueGetter'>,
	next: Pick<InternalColumnDef<TRowData>, 'cellRenderer' | 'valueGetter'>
): boolean {
	return prev.cellRenderer === next.cellRenderer && prev.valueGetter === next.valueGetter;
}

export class ColumnModel<TRowData = unknown> {
	private columnsByInstanceId = new Map<ColumnInstanceId, InternalColumnDef<TRowData>>();
	private columnsByColId = new Map<string, InternalColumnDef<TRowData>>();
	private displayedColumns: InternalColumnDef<TRowData>[] = [];
	private valueGetterDependents = new Map<string, string[]>();
	private indexMapper = new IndexMapper<ColumnInstanceId>();
	private instanceIdsByField = new Map<string, ColumnInstanceId[]>();
	private fieldByInstanceId = new Map<ColumnInstanceId, string>();
	private defaultColWidth = 100;
	private columnPlans = new Map<ColumnInstanceId, ColumnRenderPlan<TRowData>>();
	private planVersion = 0;
	private compiledPlan: CompiledGridPlan<TRowData> | null = null;
	private compiledPlanPinLeft = -1;
	private compiledPlanPinRight = -1;
	private compiledPlanGeometryVersion = -1;

	constructor(private readonly runtime: ColumnModelRuntime<TRowData>) {}

	public updateColumns(columns: ColumnDef<TRowData>[], columnWidths: Record<string, number>, defaultColWidth?: number): void {
		if (defaultColWidth !== undefined) {
			this.defaultColWidth = defaultColWidth;
		}
		const previousColumnsByColId = this.columnsByColId;
		const normalizedColumns = columns.map((column) => {
			const normalized = this.normalizeColumn(column);
			const prevColId = normalized.colId ?? normalized.field;
			const prev = prevColId ? previousColumnsByColId.get(prevColId) : undefined;
			const instanceId = prev && isSameColumnInstance(prev, normalized) ? prev.instanceId : createColumnInstanceId();
			return { ...normalized, instanceId } as InternalColumnDef<TRowData>;
		});
		this.columnsByInstanceId = new Map();
		this.columnsByColId = new Map();
		this.instanceIdsByField = new Map();
		this.fieldByInstanceId = new Map();
		this.valueGetterDependents.clear();
		this.indexMapper.setIds(normalizedColumns.map((column) => column.instanceId));
		for (const column of normalizedColumns) {
			this.indexMapper.setVisible(column.instanceId, column.hide !== true);
		}

		for (const col of normalizedColumns) {
			if (col.field) {
				this.columnsByInstanceId.set(col.instanceId, col);
				this.columnsByColId.set(col.colId ?? col.field, col);
				const idsForField = this.instanceIdsByField.get(col.field);
				if (idsForField) idsForField.push(col.instanceId);
				else this.instanceIdsByField.set(col.field, [col.instanceId]);
				this.fieldByInstanceId.set(col.instanceId, col.field);
				if (col.valueGetter && col.valueGetterDependencies) {
					for (const dependency of col.valueGetterDependencies) {
						const dependents = this.valueGetterDependents.get(dependency);
						if (dependents) {
							dependents.push(col.field);
						} else {
							this.valueGetterDependents.set(dependency, [col.field]);
						}
					}
				}
			}
		}

		const widths = this.getDisplayedColumns(normalizedColumns).map((col) => {
			const customWidth = columnWidths[col.field] ?? col.width;
			return customWidth !== undefined ? customWidth : this.defaultColWidth;
		});
		this.displayedColumns = normalizedColumns.filter((column) => column.hide !== true);

		this.runtime.geometry.updateColumns(widths, this.defaultColWidth);
		this.runtime.updateCompiledGetters(normalizedColumns);

		// Compute ColumnRenderPlans
		this.columnPlans.clear();
		for (const col of normalizedColumns) {
			if (col.field) {
				const hasValueGetter = !!col.valueGetter;
				const hasFormatter = !!(col as any).valueFormatter;
				const hasFormulaSupport = true;

				let mode: ColumnRenderMode = 'primitive';
				if (col.cellRenderer) {
					const caps = col.cellRendererCapabilities;
					if (isDomCellRenderer(col.cellRenderer)) {
						mode = 'custom-dom';
					} else if (caps?.scroll === 'live') {
						mode = caps.imperative ? 'custom-imperative' : 'custom-live';
					} else {
						mode = 'custom';
					}
				} else if (hasValueGetter || hasFormatter) {
					mode = 'primitive-formatted';
				}

				const plan: ColumnRenderPlan<TRowData> = {
					colId: col.instanceId,
					field: col.field,
					mode,
					isCustom: mode !== 'primitive' && mode !== 'primitive-formatted',
					hasValueGetter,
					hasFormatter,
					hasFormulaSupport,
					canUseCachedDisplayValue: hasValueGetter || hasFormulaSupport || !!col.cellRenderer,
				};

				this.columnPlans.set(col.instanceId, plan);
			}
		}
		this.compiledPlan = null;
	}

	private normalizeColumn(column: ColumnDef<TRowData>): Omit<InternalColumnDef<TRowData>, 'instanceId'> {
		if (!column.renderer) return column;
		const renderer = column.renderer;
		if (renderer.kind === 'text') {
			return { ...column, cellRenderer: undefined, cellRendererCapabilities: undefined };
		}
		if (renderer.kind === 'dom') {
			return {
				...column,
				cellRenderer: renderer.renderer,
				cellRendererCapabilities: normalizeRendererCapabilities(
					{ ...renderer.renderer.capabilities, ...renderer.capabilities },
					{ domRenderer: true }
				),
			};
		}
		if (renderer.kind === 'imperativeReact') {
			return {
				...column,
				cellRenderer: renderer.component as InternalColumnDef<TRowData>['cellRenderer'],
				cellRendererCapabilities: normalizeRendererCapabilities(renderer.capabilities, { imperative: true }),
			};
		}
		// kind === 'react': defaults to 'text' (full portal, stand-in text for entering cells during scroll)
		return {
			...column,
			cellRenderer: renderer.component as InternalColumnDef<TRowData>['cellRenderer'],
			cellRendererCapabilities: normalizeRendererCapabilities(renderer.capabilities),
		};
	}

	public getCompiledPlan(): CompiledGridPlan<TRowData> {
		const pinCounts = this.runtime.getPinnedColumnCounts();
		const pinLeftCount = Math.min(pinCounts.left, this.displayedColumns.length);
		const pinRightCount = Math.min(pinCounts.right, Math.max(0, this.displayedColumns.length - pinLeftCount));
		const geometryVersion = this.runtime.getGeometryVersion();
		if (
			this.compiledPlan &&
			this.compiledPlanPinLeft === pinLeftCount &&
			this.compiledPlanPinRight === pinRightCount &&
			this.compiledPlanGeometryVersion === geometryVersion
		) {
			return this.compiledPlan;
		}

		const displayedColumns = this.displayedColumns;
		const columnPlans = displayedColumns.map((column) => this.columnPlans.get(column.instanceId)!);
		const totalWidth = this.runtime.geometry.getTotalWidth(this.defaultColWidth);
		const colLefts = this.runtime.geometry.colLefts.slice(0, displayedColumns.length);
		const colWidths = this.runtime.geometry.colWidths.slice(0, displayedColumns.length);
		const pinRightStart = Math.max(pinLeftCount, displayedColumns.length - pinRightCount);
		const pinLeftWidth = pinLeftCount > 0 ? (colLefts[Math.min(pinLeftCount, displayedColumns.length)] ?? 0) : 0;
		const pinRightBaseLeft = pinRightStart < displayedColumns.length ? (colLefts[pinRightStart] ?? totalWidth) : totalWidth;
		const pinRightWidth = Math.max(0, totalWidth - pinRightBaseLeft);
		const next: CompiledGridPlan<TRowData> = {
			version: ++this.planVersion,
			columns: Array.from(this.columnsByInstanceId.values()),
			displayedColumns,
			columnPlans,
			colFields: displayedColumns.map((column) => column.field),
			colWidths,
			colLefts,
			totalWidth,
			pinLeftCount,
			pinRightCount,
			pinRightStart,
			pinLeftWidth,
			pinRightWidth,
			pinRightBaseLeft,
			hasCustomRenderers: displayedColumns.some((column) => !!column.cellRenderer),
			hasDomRenderers: displayedColumns.some((column) => isDomCellRenderer(column.cellRenderer)),
			hasFormattedValues: columnPlans.some((plan) => plan.hasFormatter),
			hasValueGetters: columnPlans.some((plan) => plan.hasValueGetter),
		};
		this.compiledPlan = next;
		this.compiledPlanPinLeft = pinLeftCount;
		this.compiledPlanPinRight = pinRightCount;
		this.compiledPlanGeometryVersion = geometryVersion;
		return next;
	}

	public getCompiledPlanVersion(): number {
		// Return the current planVersion directly without triggering a rebuild.
		// getCompiledPlan() increments planVersion on every cache miss, so calling
		// it from getRenderStats() (polled every 250 ms) caused the counter to tick
		// up continuously even when nothing actually changed.
		return this.planVersion;
	}

	public getColumnPlan(colField: string): ColumnRenderPlan<TRowData> | undefined {
		const instanceId = this.getColumnInstanceIdsByField(colField)[0];
		return instanceId ? this.columnPlans.get(instanceId) : undefined;
	}

	public getColumnPlans(): ColumnRenderPlan<TRowData>[] {
		return Array.from(this.columnPlans.values());
	}

	public getColumnIndex(colField: string): number {
		const instanceId = this.getColumnInstanceIdsByField(colField)[0];
		return instanceId ? this.indexMapper.idToVisualIndex(instanceId) : -1;
	}

	public getColumnField(colIdx: number): string | null {
		const instanceId = this.indexMapper.visualIndexToId(colIdx);
		return instanceId ? (this.fieldByInstanceId.get(instanceId) ?? null) : null;
	}

	public getPhysicalColumnIndex(colField: string): number {
		const instanceId = this.getColumnInstanceIdsByField(colField)[0];
		return instanceId ? this.indexMapper.idToPhysicalIndex(instanceId) : -1;
	}

	public getIndexMapper(): IndexMapper<ColumnInstanceId> {
		return this.indexMapper;
	}

	public getColumnDef(colField: string): ColumnDef<TRowData> | undefined {
		return this.getPrimaryColumnByField(colField);
	}

	public getDisplayedColumns(columns?: ColumnDef<TRowData>[]): ColumnDef<TRowData>[] {
		if (!columns) return this.displayedColumns;
		// Only called internally (updateColumns, below) with the just-normalized array, whose
		// instanceIds are exactly what indexMapper.setIds() was just given — safe to match by instanceId.
		const columnByInstanceId = new Map(columns.map((column) => [(column as InternalColumnDef<TRowData>).instanceId, column]));
		return this.indexMapper
			.getVisibleIds()
			.map((instanceId) => columnByInstanceId.get(instanceId))
			.filter((column): column is ColumnDef<TRowData> => !!column);
	}

	public getDisplayedColumnCount(): number {
		return this.indexMapper.length;
	}

	public hasValueGetter(colField: string): boolean {
		return !!this.getPrimaryColumnByField(colField)?.valueGetter;
	}

	public getValueGetterDependents(changedField: string): string[] {
		return this.valueGetterDependents.get(changedField) ?? [];
	}

	public getColLeft(colIdx: number): number {
		return this.runtime.geometry.getColLeft(colIdx, this.defaultColWidth);
	}

	public getColWidth(colIdx: number): number {
		return this.runtime.geometry.getColWidth(colIdx, this.defaultColWidth);
	}

	public getTotalWidth(): number {
		return this.runtime.geometry.getTotalWidth(this.defaultColWidth);
	}

	public getColumnByInstanceId(instanceId: ColumnInstanceId): InternalColumnDef<TRowData> | undefined {
		return this.columnsByInstanceId.get(instanceId);
	}

	public getColumnByFieldOrInstanceId(fieldOrInstanceId: string): InternalColumnDef<TRowData> | undefined {
		return this.columnsByInstanceId.get(fieldOrInstanceId as ColumnInstanceId) ?? this.getPrimaryColumnByField(fieldOrInstanceId);
	}

	public getColumnByColId(colId: string): InternalColumnDef<TRowData> | undefined {
		return this.columnsByColId.get(colId);
	}

	public getColumnInstanceIdsByField(field: string): ColumnInstanceId[] {
		return this.instanceIdsByField.get(field) ?? [];
	}

	public getPrimaryColumnByField(field: string): InternalColumnDef<TRowData> | undefined {
		const instanceId = this.getColumnInstanceIdsByField(field)[0];
		return instanceId ? this.columnsByInstanceId.get(instanceId) : undefined;
	}
}
