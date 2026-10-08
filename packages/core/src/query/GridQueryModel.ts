// Cross-column nested AND/OR query model.
// Distinct from FilterModel (per-column) — this layer combines conditions
// across columns in arbitrary nested groups.

import type { ColumnFilter } from '../filterModel.js';
import { restoreColumnFilter } from '../filterOperations.js';

export type GridQueryNode = GridQueryGroup | GridQueryCondition;

export interface GridQueryGroup {
	readonly kind: 'group';
	readonly id: string;
	readonly operator: 'and' | 'or';
	readonly children: readonly GridQueryNode[];
}

/**
 * One condition of the query: a column and a filter condition, the same conditions the filter
 * model holds, matched by the same code.
 */
export interface GridQueryCondition {
	readonly kind: 'condition';
	readonly id: string;
	/** Matches a column's `field` value. */
	readonly columnId: string;
	/** The condition on that column; null while the user has not set one (matches every row). */
	readonly filter: ColumnFilter | null;
}

export interface GridQueryModel {
	readonly version: number;
	readonly root: GridQueryGroup;
}

/** Diagnostic produced when a condition references an unknown column or operator. */
export interface QueryConditionDiagnostic {
	readonly conditionId: string;
	readonly columnId: string;
	readonly reason: 'unknown-column' | 'invalid-value';
	readonly message: string;
}

export interface QueryDiagnostics {
	readonly active: boolean;
	readonly conditionCount: number;
	readonly groupCount: number;
	readonly invalidConditions: readonly string[];
}

/** Count leaf conditions in a query model. */
export function countQueryNodes(root: GridQueryGroup): { conditions: number; groups: number } {
	let conditions = 0;
	let groups = 0;
	function visit(node: GridQueryNode): void {
		if (node.kind === 'condition') {
			conditions++;
		} else {
			groups++;
			for (const child of node.children) visit(child);
		}
	}
	visit(root);
	return { conditions, groups };
}

/** Return true when the query model has at least one condition. */
export function isQueryModelActive(model: GridQueryModel | null | undefined): boolean {
	if (!model) return false;
	return countQueryNodes(model.root).conditions > 0;
}

/** Create a new empty root group. */
export function createEmptyQueryModel(): GridQueryModel {
	return {
		version: 1,
		root: { kind: 'group', id: 'root', operator: 'and', children: [] },
	};
}

function restoreNode(raw: unknown, knownFields: ReadonlySet<string>): GridQueryNode | null {
	if (!raw || typeof raw !== 'object') return null;
	const node = raw as Record<string, unknown>;
	if (typeof node.id !== 'string') return null;
	if (node.kind === 'condition') {
		if (typeof node.columnId !== 'string' || !knownFields.has(node.columnId)) return null;
		const filter = node.filter == null ? null : restoreColumnFilter(node.filter);
		if (node.filter != null && !filter) return null;
		return { kind: 'condition', id: node.id, columnId: node.columnId, filter };
	}
	if (node.kind !== 'group' || (node.operator !== 'and' && node.operator !== 'or') || !Array.isArray(node.children)) return null;
	const children = node.children.map((child) => restoreNode(child, knownFields)).filter((child): child is GridQueryNode => !!child);
	return { kind: 'group', id: node.id, operator: node.operator, children };
}

/**
 * A saved query checked against the grid: conditions on columns that no longer exist, and
 * malformed nodes, are dropped. Null when no condition is left.
 */
export function restoreQueryModel(raw: unknown, knownFields: ReadonlySet<string>): GridQueryModel | null {
	if (!raw || typeof raw !== 'object') return null;
	const model = raw as { version?: unknown; root?: unknown };
	const root = restoreNode(model.root, knownFields);
	if (!root || root.kind !== 'group') return null;
	const restored: GridQueryModel = { version: typeof model.version === 'number' ? model.version : 1, root };
	return isQueryModelActive(restored) ? restored : null;
}
