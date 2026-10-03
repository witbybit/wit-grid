import type { RowNode } from '../../store.js';
import type { GroupDef } from '../RowPipeline.js';
import { toGroupVisualRowId, type GroupPathItem } from '../visualRowIds.js';
import type { RowPipelineContext, RowTreeNode } from './types.js';

export function groupStage<TData>(nodes: RowNode<TData>[], groupDefs: GroupDef<TData>[], context: RowPipelineContext<TData>): RowTreeNode<TData>[] {
	if (groupDefs.length === 0) {
		return nodes.map((node) => ({
			kind: 'data',
			rowId: node.id,
			node,
			depth: 0,
		}));
	}

	return groupRecursively(nodes, groupDefs, context, 0, []);
}

function groupRecursively<TData>(
	nodes: RowNode<TData>[],
	groupDefs: GroupDef<TData>[],
	context: RowPipelineContext<TData>,
	depth: number,
	parentPath: GroupPathItem[]
): RowTreeNode<TData>[] {
	const groupDef = groupDefs[depth];
	const field = groupDef.colId;
	const groupsMap = new Map<string, RowNode<TData>[]>();
	const groupKeys = new Map<string, { key: unknown; keyString: string }>();

	for (const node of nodes) {
		const key = context.getGroupKey(node, groupDef);
		if (!groupsMap.has(key.keyString)) {
			groupsMap.set(key.keyString, []);
			groupKeys.set(key.keyString, key);
		}
		groupsMap.get(key.keyString)!.push(node);
	}

	const results: RowTreeNode<TData>[] = [];

	for (const [keyString, groupNodes] of groupsMap.entries()) {
		const key = groupKeys.get(keyString)?.key ?? keyString;
		const path = [...parentPath, { field, key, keyString }];
		const groupId = toGroupVisualRowId(path);
		const isLastLevel = depth === groupDefs.length - 1;

		let childNodes: RowTreeNode<TData>[];
		if (isLastLevel) {
			childNodes = groupNodes.map((node) => ({
				kind: 'data',
				rowId: node.id,
				node,
				depth: depth + 1,
			}));
		} else {
			childNodes = groupRecursively(groupNodes, groupDefs, context, depth + 1, path);
		}

		const leafCount = childNodes.reduce((acc, child) => {
			return acc + (child.kind === 'data' ? 1 : child.leafCount);
		}, 0);

		results.push({
			kind: 'group',
			id: groupId,
			field,
			key,
			keyString,
			depth,
			path,
			children: childNodes,
			childCount: childNodes.length,
			leafCount,
			aggregates: {},
		});
	}

	return results;
}
