import type { ColumnDef } from '../columnDef.js';
import {
	groupByColIds,
	isGroupingActive,
	type GroupingConfig,
	type HierarchyCellContext,
	type HierarchyColumnConfig,
	type TreeDataConfig,
} from './hierarchyConfig.js';
import { hierarchyColumnGroupColId } from './hierarchyColumn.js';
import type { DescendantSelectionState } from './hierarchyIndex.js';
import type { VisualRow } from '../visualRow.js';

/** Everything the hierarchy cell shows, resolved once per bind; the writer only diffs it onto the DOM. */
export interface HierarchyCellModel {
	/** Visual row id the toggle and checkbox act on. */
	targetId: string;
	indentPx: number;
	/** null: the row has no children (the toggle slot keeps the label aligned). */
	toggle: 'open' | 'closed' | null;
	/** null: no checkbox part. */
	checkbox: DescendantSelectionState | null;
	label: string;
	count: string | null;
	cellClass: string;
}

export interface HierarchyCellDeps<TData> {
	getColumn(field: string): ColumnDef<TData> | undefined;
	getCellValue(rowId: string, field: string): unknown;
	isRowSelected(rowId: string): boolean;
	getDescendantSelection(id: string): DescendantSelectionState;
}

export interface HierarchyCellInputs<TData> {
	config: HierarchyColumnConfig<TData> | undefined;
	/** `treeData.column`: the field tree rows show. */
	treeColumn: string | undefined;
	isTree: boolean;
	/** `display: 'columns'`: the grouping level this column shows; undefined for the single hierarchy column. */
	levelIndex?: number;
}

/** The inputs for a hierarchy cell of `col` (a level column in `display: 'columns'`), from grid state. */
export function hierarchyCellInputsFor<TData>(
	state: { grouping?: GroupingConfig<TData>; treeData?: TreeDataConfig<TData>; hierarchyColumn?: HierarchyColumnConfig<TData> | false },
	col?: { field: string } | null
): HierarchyCellInputs<TData> {
	const grouped = isGroupingActive(state.grouping);
	const levelColId = hierarchyColumnGroupColId(col);
	const levelIndex = levelColId !== null && grouped ? groupByColIds(state.grouping).indexOf(levelColId) : -1;
	return {
		config: state.hierarchyColumn || undefined,
		treeColumn: state.treeData?.column,
		isTree: !grouped && !!state.treeData,
		...(levelIndex >= 0 ? { levelIndex } : {}),
	};
}

const DEFAULT_INDENT = 16;

function formatWith<TData>(column: ColumnDef<TData> | undefined, value: unknown, data: TData | undefined, rowId: string): string {
	if (value == null || value === '')
		return column?.valueFormatter ? column.valueFormatter({ value, rowData: data as TData, colDef: column, rowId }) : '';
	if (column?.valueFormatter) return column.valueFormatter({ value, rowData: data as TData, colDef: column, rowId });
	return String(value);
}

/** Resolves the hierarchy cell for a group, total or data row (tree rows and grouped leaves). */
export function resolveHierarchyCellModel<TData>(
	row: VisualRow<TData>,
	inputs: HierarchyCellInputs<TData>,
	deps: HierarchyCellDeps<TData>
): HierarchyCellModel | null {
	if (row.kind !== 'group' && row.kind !== 'total' && row.kind !== 'data') return null;
	const { config, levelIndex } = inputs;
	const { hierarchy } = row;
	const show = config?.show;
	if (levelIndex !== undefined) {
		// One column per level: a group shows in its own level's column, a total under its group's.
		if (row.kind === 'data') return null;
		const shownAt = row.kind === 'group' ? hierarchy.level : row.scope === 'grand' ? 0 : hierarchy.level - 1;
		if (shownAt !== levelIndex) return null;
	}

	let ctx: HierarchyCellContext<TData>;
	if (row.kind === 'group') {
		const column = deps.getColumn(row.field);
		const formatted = row.key == null || row.key === '' ? '(Blank)' : formatWith(column, row.key, undefined, row.id) || String(row.key);
		ctx = {
			kind: 'group',
			id: row.id,
			level: hierarchy.level,
			hasChildren: hierarchy.hasChildren,
			expanded: hierarchy.expanded,
			leafCount: hierarchy.leafCount,
			value: row.key,
			formattedValue: formatted,
			field: row.field,
			aggregates: row.aggregates,
		};
	} else if (row.kind === 'total') {
		ctx = {
			kind: 'total',
			id: row.id,
			level: hierarchy.level,
			hasChildren: false,
			expanded: false,
			leafCount: 0,
			value: null,
			formattedValue: row.scope === 'grand' ? 'Grand total' : 'Total',
			field: null,
			aggregates: row.aggregates,
		};
	} else {
		const field = inputs.isTree ? inputs.treeColumn : undefined;
		const value = field ? deps.getCellValue(row.rowId, field) : undefined;
		ctx = {
			kind: 'data',
			id: row.id,
			level: hierarchy.level,
			hasChildren: hierarchy.hasChildren,
			expanded: hierarchy.expanded,
			leafCount: hierarchy.leafCount,
			value,
			formattedValue: field ? formatWith(deps.getColumn(field), value, row.node.data, row.rowId) : '',
			field: field ?? null,
			data: row.node.data,
			aggregates: row.aggregates,
		};
	}

	const label = config?.label ? config.label(ctx) : ctx.formattedValue;
	const count = config?.count ? config.count(ctx) : (show?.count ?? true) && ctx.kind === 'group' ? String(ctx.leafCount) : null;
	let checkbox: DescendantSelectionState | null = null;
	if (show?.checkbox && ctx.kind !== 'total') {
		checkbox = ctx.kind === 'group' ? deps.getDescendantSelection(ctx.id) : deps.isRowSelected((row as { rowId: string }).rowId) ? 'all' : 'none';
	}
	const extraClass = typeof config?.cellClass === 'function' ? config.cellClass(ctx) : config?.cellClass;
	return {
		targetId: ctx.id,
		indentPx: levelIndex !== undefined ? 0 : ctx.level * (config?.indentPerLevel ?? DEFAULT_INDENT),
		toggle: (show?.toggle ?? true) && ctx.hasChildren ? (ctx.expanded ? 'open' : 'closed') : null,
		checkbox,
		label,
		count,
		cellClass: `og-cell-hierarchy og-cell-hierarchy-${ctx.kind}${extraClass ? ' ' + extraClass : ''}`,
	};
}

/** Plain text for a hierarchy row cell (copy, export): the hierarchy column's label, else the aggregate. */
export function hierarchyRowCellText<TData>(
	row: VisualRow<TData>,
	col: ColumnDef<TData>,
	isHierarchyColumnCell: boolean,
	inputs: HierarchyCellInputs<TData>,
	deps: HierarchyCellDeps<TData>,
	options: { withCount?: boolean; indent?: string } = {}
): string {
	if (isHierarchyColumnCell) {
		const model = resolveHierarchyCellModel(row, inputs, deps);
		if (!model) return '';
		const level = row.kind === 'group' || row.kind === 'total' || row.kind === 'data' ? row.hierarchy.level : 0;
		const prefix = options.indent && inputs.levelIndex === undefined ? options.indent.repeat(level) : '';
		return prefix + model.label + (options.withCount && model.count !== null ? ` (${model.count})` : '');
	}
	if (row.kind !== 'group' && row.kind !== 'total') return '';
	const value = row.aggregates[col.field];
	if (value == null) return '';
	return col.valueFormatter ? col.valueFormatter({ value, rowData: undefined as TData, colDef: col, rowId: row.id }) : String(value);
}
