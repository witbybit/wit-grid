/**
 * Client-side evaluator for GridQueryModel.
 *
 * Takes a query model, a row, and a lookup context, and returns true when the
 * row satisfies the query. Invalid conditions (unknown column, unknown operator)
 * produce diagnostics and are treated as passing so they don't silently drop rows.
 */
import type { ColumnDef } from '../columnDef.js';
import { compilePathGetter } from '../columnDef.js';
import { createGridRowDataRef } from '../publicRowRef.js';
import type { RowNode } from '../rowNode.js';
import type { GridQueryCondition, GridQueryGroup, GridQueryModel, GridQueryNode, QueryConditionDiagnostic } from './GridQueryModel.js';
import { resolveColumnFilterDef } from '../filters/filterDef.js';
import { prepareColumnFilter, type PreparedFilterMatcher } from '../filters/matchFilter.js';

export interface QueryEvaluationContext<TRowData = unknown> {
	getCellValue(node: RowNode<TRowData>, columnId: string): unknown;
	/** The prepared matcher of a condition (cached per condition); null when it matches every row. */
	getMatcher(condition: GridQueryCondition): PreparedFilterMatcher | null;
	/** Whether a column exists. */
	hasColumn(columnId: string): boolean;
	reportDiagnostic?(diag: QueryConditionDiagnostic): void;
}

function evaluateNode<TRowData>(node: GridQueryNode, rowNode: RowNode<TRowData>, ctx: QueryEvaluationContext<TRowData>): boolean {
	if (node.kind === 'condition') return evaluateCondition(node, rowNode, ctx);
	return evaluateGroup(node, rowNode, ctx);
}

function evaluateGroup<TRowData>(group: GridQueryGroup, rowNode: RowNode<TRowData>, ctx: QueryEvaluationContext<TRowData>): boolean {
	const validChildren = group.children.filter((c): boolean => (c.kind === 'group' ? c.children.length > 0 : true));
	if (validChildren.length === 0) return true;
	if (group.operator === 'and') return validChildren.every((child) => evaluateNode(child, rowNode, ctx));
	return validChildren.some((child) => evaluateNode(child, rowNode, ctx));
}

function evaluateCondition<TRowData>(condition: GridQueryCondition, rowNode: RowNode<TRowData>, ctx: QueryEvaluationContext<TRowData>): boolean {
	if (!ctx.hasColumn(condition.columnId)) {
		ctx.reportDiagnostic?.({
			conditionId: condition.id,
			columnId: condition.columnId,
			reason: 'unknown-column',
			message: `Query condition references unknown column "${condition.columnId}"`,
		});
		return true;
	}
	const match = ctx.getMatcher(condition);
	if (!match) return true;
	return match(ctx.getCellValue(rowNode, condition.columnId), rowNode.data);
}

/** Evaluate a query model against a single row node. Returns true when the row passes. */
export function evaluateQueryModel<TRowData>(queryModel: GridQueryModel, rowNode: RowNode<TRowData>, ctx: QueryEvaluationContext<TRowData>): boolean {
	return evaluateGroup(queryModel.root, rowNode, ctx);
}

/**
 * An evaluation context over a columns array: cell values through each column's getter, and
 * conditions matched with the column's filter definition (as the filter model is).
 */
export function createQueryEvaluationContext<TRowData>(
	columns: ColumnDef<TRowData>[],
	reportDiagnostic?: (diag: QueryConditionDiagnostic) => void
): QueryEvaluationContext<TRowData> {
	const columnMap = new Map<string, ColumnDef<TRowData>>();
	for (const col of columns) columnMap.set(col.field, col);

	const getterCache = new Map<string, (node: RowNode<TRowData>) => unknown>();
	const matcherCache = new WeakMap<GridQueryCondition, PreparedFilterMatcher | null>();

	function getCellValue(node: RowNode<TRowData>, columnId: string): unknown {
		const col = columnMap.get(columnId);
		if (!col) return undefined;
		let getter = getterCache.get(columnId);
		if (!getter) {
			if (col.valueGetter) {
				const vg = col.valueGetter;
				getter = (n) => vg({ node: createGridRowDataRef(n.id, n.data), row: n.data, colField: col.field });
			} else {
				const pg = compilePathGetter(col.field);
				getter = (n) => n.getCellValue(col.field, pg);
			}
			getterCache.set(columnId, getter);
		}
		return getter(node);
	}

	function getMatcher(condition: GridQueryCondition): PreparedFilterMatcher | null {
		if (matcherCache.has(condition)) return matcherCache.get(condition)!;
		const col = columnMap.get(condition.columnId);
		const match = condition.filter && col ? prepareColumnFilter(condition.filter, resolveColumnFilterDef(col)) : null;
		if (condition.filter && !match) {
			reportDiagnostic?.({
				conditionId: condition.id,
				columnId: condition.columnId,
				reason: 'invalid-value',
				message: `Query condition on "${condition.columnId}" has a value that cannot be matched`,
			});
		}
		matcherCache.set(condition, match);
		return match;
	}

	return { getCellValue, getMatcher, hasColumn: (id) => columnMap.has(id), reportDiagnostic };
}

/**
 * Filter a node array by a query model. Returns the input array unchanged when
 * queryModel is null or has no conditions.
 */
export function applyQueryModelFilter<TRowData>(
	nodes: RowNode<TRowData>[],
	columns: ColumnDef<TRowData>[],
	queryModel: GridQueryModel | null | undefined,
	reportDiagnostic?: (diag: QueryConditionDiagnostic) => void
): RowNode<TRowData>[] {
	if (!queryModel) return nodes;
	if (queryModel.root.children.length === 0) return nodes;
	const ctx = createQueryEvaluationContext(columns, reportDiagnostic);
	return nodes.filter((node) => evaluateQueryModel(queryModel, node, ctx));
}
