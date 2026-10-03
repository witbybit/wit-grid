import type { RowNode } from '../../store.js';
import type { RowTreeNode } from './types.js';

export function treeStage<TData>(nodes: RowNode<TData>[], getParentId: (data: TData) => string | null | undefined): RowTreeNode<TData>[] {
	const nodeMap = new Map<string, RowTreeNode<TData>>();
	const parentRelations = new Map<string, string[]>(); // parentId -> childIds
	const roots: string[] = [];

	// Build raw leaf nodes and analyze hierarchy
	for (const node of nodes) {
		const dataNode: RowTreeNode<TData> = {
			kind: 'data',
			rowId: node.id,
			node,
			depth: 0,
		};
		nodeMap.set(node.id, dataNode);

		const pId = node.data ? getParentId(node.data) : null;
		if (pId != null && pId !== '') {
			const parentId = String(pId);
			if (!parentRelations.has(parentId)) {
				parentRelations.set(parentId, []);
			}
			parentRelations.get(parentId)!.push(node.id);
		} else {
			roots.push(node.id);
		}
	}

	// We might have nodes whose parent ID is not in our nodes list.
	// They should also be treated as roots!
	for (const [parentId, childIds] of parentRelations.entries()) {
		if (!nodeMap.has(parentId)) {
			for (const childId of childIds) roots.push(childId);
		}
	}

	// Remove duplicates from roots
	const uniqueRoots = Array.from(new Set(roots));

	// Build the hierarchy from the roots down with an explicit stack: a deep parent chain must
	// not overflow the call stack. Each node has one parent, so it is visited at most once.
	const stack: Array<{ nodeId: string; depth: number }> = [];
	for (let i = uniqueRoots.length - 1; i >= 0; i--) stack.push({ nodeId: uniqueRoots[i], depth: 0 });
	while (stack.length > 0) {
		const { nodeId, depth } = stack.pop()!;
		const current = nodeMap.get(nodeId)!;
		current.depth = depth;
		const childIds = parentRelations.get(nodeId);
		if (!childIds || childIds.length === 0) continue;
		current.children = childIds.map((cId) => nodeMap.get(cId)!);
		for (let i = childIds.length - 1; i >= 0; i--) stack.push({ nodeId: childIds[i], depth: depth + 1 });
	}

	return uniqueRoots.map((rootId) => nodeMap.get(rootId)!);
}
