import type { RowTreeNode } from './stages/types.js';
import { toDataVisualRowId } from './visualRowIds.js';

/** How many of a group's (or tree parent's) rows are selected. */
export type DescendantSelectionState = 'all' | 'some' | 'none';

export interface DescendantSelection {
	state: DescendantSelectionState;
	selected: number;
	total: number;
}

/**
 * The data rows beneath every group and tree parent, collapsed subtrees included. Built in one pass:
 * data row ids in row order (pre-order), and for each group / tree parent the `[start, end)` slice
 * holding its descendants — O(rows) memory however deep the hierarchy.
 */
export class HierarchyIndex {
	private readonly rowIds: string[] = [];
	private readonly ranges = new Map<string, { start: number; end: number }>();

	constructor(roots: readonly RowTreeNode<unknown>[]) {
		// Iterative pre-order walk; an exit marker closes a node's range after its subtree.
		const stack: Array<{ node: RowTreeNode<unknown>; exit: boolean; start: number }> = [];
		for (let i = roots.length - 1; i >= 0; i--) stack.push({ node: roots[i], exit: false, start: 0 });
		while (stack.length > 0) {
			const entry = stack.pop()!;
			const { node } = entry;
			const id = node.kind === 'group' ? node.id : toDataVisualRowId(node.rowId);
			if (entry.exit) {
				this.ranges.set(id, { start: entry.start, end: this.rowIds.length });
				continue;
			}
			if (node.kind === 'data') this.rowIds.push(node.rowId);
			const children = node.children;
			if (!children || children.length === 0) continue;
			// A tree parent's descendants start after itself; a group's with its first row.
			stack.push({ node, exit: true, start: this.rowIds.length });
			for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], exit: false, start: 0 });
		}
	}

	/** Data row ids beneath a group or tree row (by visual row id); empty for anything else. */
	public getDescendantRowIds(id: string): readonly string[] {
		const range = this.ranges.get(id);
		return range ? this.rowIds.slice(range.start, range.end) : [];
	}

	public countSelected(id: string, selected: ReadonlySet<string>): DescendantSelection {
		const range = this.ranges.get(id);
		if (!range || range.end === range.start) return { state: 'none', selected: 0, total: 0 };
		let count = 0;
		for (let i = range.start; i < range.end; i++) if (selected.has(this.rowIds[i])) count++;
		const total = range.end - range.start;
		return { state: count === 0 ? 'none' : count === total ? 'all' : 'some', selected: count, total };
	}
}
