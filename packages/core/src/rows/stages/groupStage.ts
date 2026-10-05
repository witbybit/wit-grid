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
	// Same keys as context.getGroupKey, inlined: one reader, one Map lookup and no allocation per row.
	const read = context.readerFor(field);
	const keyCreator = groupDef.keyCreator;
	const groupsMap = new Map<string, { key: unknown; nodes: RowNode<TData>[] }>();
	for (const node of nodes) {
		const value = read(node);
		const keyString = keyCreator
			? keyCreator({ value, row: node.data, rowId: node.id })
			: typeof value === 'string'
				? value
				: String(value ?? 'None');
		let group = groupsMap.get(keyString);
		if (!group) groupsMap.set(keyString, (group = { key: value, nodes: [] }));
		group.nodes.push(node);
	}

	const results: RowTreeNode<TData>[] = [];

	for (const [keyString, { key: rawKey, nodes: groupNodes }] of groupsMap) {
		const key = rawKey ?? keyString;
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

		let leafCount = 0;
		for (const child of childNodes) leafCount += child.kind === 'data' ? 1 : child.leafCount;

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
