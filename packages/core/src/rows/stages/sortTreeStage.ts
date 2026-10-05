import type { RowTreeNode } from './types.js';
import type { SortModel } from '../../rowModel.js';
import type { RowNode } from '../../store.js';
import { type ColumnDef } from '../../store.js';
import type { GroupDef } from '../RowPipeline.js';
import { createRowPipelineContext } from '../pipelineContext.js';
import { compareSortKeys, toSortKey, type SortKey } from '../sortKeys.js';

/**
 * Sorts every sibling list of the tree in place.
 *
 * - Leaf siblings follow the sort model (same comparison as the flat sort).
 * - Group siblings compare by `keyString`, or by `GroupDef.comparator(a.key, b.key)` when the
 *   group level declares one; a desc sort on the group's field reverses either.
 * - Groups precede leaves in mixed lists.
 *
 * Sort keys are extracted once per sibling list (not per comparison), and ties fall back to the
 * original sibling position, which is exactly what the stable `Array.prototype.sort` produced.
 *
 * With no active sort model, only group levels that declare a comparator are reordered.
 */
export function sortTreeStage<TData>(
	roots: RowTreeNode<TData>[],
	sortModel: SortModel | null,
	columns: ColumnDef<TData>[],
	groupDefs?: readonly GroupDef<TData>[]
): void {
	const activeSort = sortModel && sortModel.length > 0 ? sortModel : null;
	const comparatorByField = new Map<string, (a: unknown, b: unknown) => number>();
	for (const def of groupDefs ?? []) {
		if (def.comparator && !comparatorByField.has(def.colId)) comparatorByField.set(def.colId, def.comparator);
	}
	if (!activeSort && comparatorByField.size === 0) return;

	const context = createRowPipelineContext(columns);
	const descByField = new Map<string, boolean>();
	for (const sortItem of activeSort ?? []) {
		if (!descByField.has(sortItem.colId)) descByField.set(sortItem.colId, sortItem.sort === 'desc');
	}
	const sorter: TreeSorter<TData> = {
		sortModel: activeSort ?? [],
		getters: (activeSort ?? []).map((sortItem) => context.readerFor(sortItem.colId)),
		descByField,
		comparatorByField,
	};

	// Iterative walk: deep trees must not overflow the call stack.
	const stack: RowTreeNode<TData>[][] = [roots];
	while (stack.length > 0) {
		const siblings = stack.pop()!;
		sortSiblings(siblings, sorter);
		for (const node of siblings) {
			if (node.children?.length) stack.push(node.children);
		}
	}
}

interface TreeSorter<TData> {
	sortModel: SortModel;
	getters: Array<(node: RowNode<TData>) => unknown>;
	/** First sort-model entry per field decides the group direction (mirrors `sortModel.find`). */
	descByField: Map<string, boolean>;
	comparatorByField: Map<string, (a: unknown, b: unknown) => number>;
}

interface SiblingEntry<TData> {
	node: RowTreeNode<TData>;
	index: number;
	keys: SortKey[] | null;
}

function sortSiblings<TData>(children: RowTreeNode<TData>[], sorter: TreeSorter<TData>): void {
	if (children.length < 2) return;
	const { sortModel, getters, descByField, comparatorByField } = sorter;
	const hasSort = sortModel.length > 0;
	// Without a sort model only comparator-bearing group levels move.
	if (!hasSort && !children.some((child) => child.kind === 'group' && comparatorByField.has(child.field))) return;

	if (hasSort && sortModel.length === 1 && sortNumericLeaves(children, getters[0], sortModel[0].sort === 'desc')) return;

	const entries: SiblingEntry<TData>[] = new Array(children.length);
	for (let i = 0; i < children.length; i++) {
		const node = children[i];
		let keys: SortKey[] | null = null;
		if (hasSort && node.kind === 'data') {
			keys = new Array(getters.length);
			for (let k = 0; k < getters.length; k++) keys[k] = toSortKey(getters[k](node.node));
		}
		entries[i] = { node, index: i, keys };
	}

	entries.sort((left, right) => {
		const a = left.node;
		const b = right.node;
		let comparison = 0;
		if (a.kind === 'group' && b.kind === 'group') {
			const comparator = comparatorByField.get(a.field);
			if (comparator) {
				comparison = comparator(a.key, b.key);
			} else if (hasSort) {
				if (a.keyString < b.keyString) comparison = -1;
				else if (a.keyString > b.keyString) comparison = 1;
			}
			if (descByField.get(a.field) === true) comparison = -comparison;
		} else if (a.kind === 'data' && b.kind === 'data') {
			if (left.keys && right.keys) {
				for (let i = 0; i < sortModel.length; i++) {
					const c = compareSortKeys(left.keys[i], right.keys[i]);
					if (c !== 0) {
						comparison = sortModel[i].sort === 'desc' ? -c : c;
						break;
					}
				}
			}
		} else if (hasSort) {
			// Hybrid comparison (fallback): groups before leaves.
			comparison = a.kind === 'group' ? -1 : 1;
		}
		// NaN (e.g. from a NaN numeric key) is treated as a tie, as Array.prototype.sort does.
		return comparison !== 0 && !Number.isNaN(comparison) ? comparison : left.index - right.index;
	});

	for (let i = 0; i < entries.length; i++) children[i] = entries[i].node;
}

/**
 * One sort column over leaves whose values are all numbers (not NaN): sorts the numbers directly,
 * ties by original position — the same order the general path produces. False (nothing touched)
 * for anything else.
 */
function sortNumericLeaves<TData>(children: RowTreeNode<TData>[], read: (node: RowNode<TData>) => unknown, desc: boolean): boolean {
	const n = children.length;
	const values = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const child = children[i];
		if (child.kind !== 'data') return false;
		const value = read(child.node);
		if (typeof value !== 'number' || value !== value) return false;
		values[i] = value;
	}
	const order: number[] = new Array(n);
	for (let i = 0; i < n; i++) order[i] = i;
	if (desc) order.sort((a, b) => values[b] - values[a] || a - b);
	else order.sort((a, b) => values[a] - values[b] || a - b);
	const original = children.slice();
	for (let i = 0; i < n; i++) children[i] = original[order[i]];
	return true;
}
