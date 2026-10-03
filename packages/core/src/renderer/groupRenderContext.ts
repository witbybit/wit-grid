import type { GridApi } from '../api/GridApiSurfaces.js';
import type { HierarchyCellModel } from '../rows/hierarchyCellModel.js';
import { isGroupingActive, type GroupRenderContext } from '../rows/hierarchyConfig.js';
import { resolveHierarchyCellModel } from '../rows/hierarchyCellModel.js';
import type { GroupPathItem } from '../rows/visualRowIds.js';
import type { VisualRow } from '../visualRow.js';

const NO_PATH: readonly GroupPathItem[] = Object.freeze([]);

/**
 * The context a group, total or tree-row renderer receives: the hierarchy cell's fields plus actions
 * bound to this row. Built once per bind that reaches a renderer; the actions are four small closures.
 */
export function createGroupRenderContext<TData>(
	api: GridApi<TData>,
	row: VisualRow<TData>,
	model: HierarchyCellModel<TData>,
	isStuck: boolean
): GroupRenderContext<TData> {
	const { ctx } = model;
	const id = ctx.id;
	return {
		...ctx,
		row,
		isTotal: ctx.kind === 'total',
		isStuck,
		path: row.kind === 'group' ? row.path : NO_PATH,
		indentPx: model.indentPx,
		label: model.label,
		count: model.count,
		api,
		toggle: () => api.toggleExpanded(id),
		setExpanded: (open) => api.setExpanded(id, open),
		expandAll: () => api.setExpanded(id, true, { deep: true }),
		collapseAll: () => api.setExpanded(id, false, { deep: true }),
		selectChildren: (selected) => api.setDescendantsSelected(id, selected),
	};
}

/** The hierarchy cell model of a full-width group or total row, resolved through the public API only. */
export function resolveFullWidthGroupModel<TData>(api: GridApi<TData>, row: VisualRow<TData>): HierarchyCellModel<TData> | null {
	const treeData = api.getTreeData();
	return resolveHierarchyCellModel(
		row,
		{ config: api.getHierarchyColumn() || undefined, treeColumn: treeData?.column, isTree: !isGroupingActive(api.getGrouping()) && !!treeData },
		{
			getColumn: (field) => api.getColumnDef(field),
			getCellValue: (rowId, field) => api.getCellValue(rowId, field),
			isRowSelected: (rowId) => api.isRowNodeSelected(rowId),
			getDescendantSelection: (id) => api.getDescendantSelection(id).state,
		}
	);
}

function sameAggregates(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;
	for (const key of keys) if (!Object.is(a[key], b[key])) return false;
	return true;
}

/** Whether two contexts would draw the same: a renderer is only updated when they differ. */
export function isSameGroupRenderContext<TData>(a: GroupRenderContext<TData>, b: GroupRenderContext<TData>): boolean {
	return (
		a.id === b.id &&
		a.kind === b.kind &&
		a.isStuck === b.isStuck &&
		a.expanded === b.expanded &&
		a.hasChildren === b.hasChildren &&
		a.level === b.level &&
		a.leafCount === b.leafCount &&
		a.indentPx === b.indentPx &&
		a.label === b.label &&
		a.count === b.count &&
		Object.is(a.value, b.value) &&
		a.formattedValue === b.formattedValue &&
		a.data === b.data &&
		sameAggregates(a.aggregates, b.aggregates)
	);
}
