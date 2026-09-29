import type { RowHierarchy, TotalPlacement, VisualRow } from '../../visualRow.js';
import { toDataVisualRowId, toDetailVisualRowId, toTotalVisualRowId } from '../visualRowIds.js';
import type { RowTreeNode } from './types.js';

/** Where total rows go: per grouping level (0 = outermost), and for the whole grid. */
export interface TotalsConfig {
	groups?: TotalPlacement | false | ((level: number) => TotalPlacement | false);
	grand?: TotalPlacement | false;
}

export interface FlattenConfig<TData = unknown> {
	expandedGroupIds: Set<string>;
	expandedTreeRowIds: Set<string>;
	expandedDetailRowIds: Set<string>;
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	getRowHeight?: (row: TData, rowId: string) => number | undefined;
	groupRowHeight?: number;
	detailRowHeight?: number;
	getDetailHeight?: (params: { row: TData; rowId: string }) => number;
	masterDetailEnabled?: boolean;
	detailRenderer?: unknown;
	defaultGroupsExpanded?: boolean;
	defaultTreeRowsExpanded?: boolean;
	totals?: TotalsConfig;
	/** Aggregates of every row, for the grand total. */
	grandAggregates?: Record<string, unknown>;
}

interface FlattenState<TData> {
	readonly config: FlattenConfig<TData>;
	readonly result: VisualRow<TData>[];
	readonly stickyGroupMeta?: Map<number, number>;
	readonly totalsHeight: number;
}

/**
 * Flattens the row tree into visual rows. Every row gets its `hierarchy` block; totals are emitted
 * where `config.totals` asks for them (only for expanded groups: a collapsed group row already shows
 * its aggregates). `stickyGroupMeta` receives expanded group index → last descendant index, in row
 * order (a group's entry is created before its children's).
 */
export function flattenStage<TData>(
	roots: RowTreeNode<TData>[],
	config: FlattenConfig<TData>,
	stickyGroupMeta?: Map<number, number>
): VisualRow<TData>[] {
	const result: VisualRow<TData>[] = [];
	const state: FlattenState<TData> = {
		config,
		result,
		stickyGroupMeta,
		totalsHeight: config.groupRowHeight || config.defaultRowHeight,
	};
	const grand = config.totals?.grand;
	if (grand === 'top') pushGrandTotal(state);
	for (let i = 0; i < roots.length; i++) flattenNode(roots[i], state, null, 0, i + 1, roots.length);
	if (grand === 'bottom') pushGrandTotal(state);
	return result;
}

function groupTotalPlacement(totals: TotalsConfig | undefined, level: number): TotalPlacement | false {
	const groups = totals?.groups;
	if (typeof groups === 'function') return groups(level);
	return groups ?? false;
}

function pushGrandTotal<TData>(state: FlattenState<TData>): void {
	state.result.push({
		kind: 'total',
		id: toTotalVisualRowId(null),
		scope: 'grand',
		groupId: null,
		placement: state.config.totals!.grand as TotalPlacement,
		hierarchy: { level: 0, parentId: null, hasChildren: false, expanded: false, childCount: 0, leafCount: 0, posInSet: 0, setSize: 0 },
		aggregates: state.config.grandAggregates ?? {},
		height: state.totalsHeight,
		selectable: false,
	});
}

function countLeaves<TData>(node: RowTreeNode<TData>): number {
	if (node.kind === 'group') return node.leafCount;
	let count = 0;
	const stack = [...(node.children ?? [])];
	while (stack.length > 0) {
		const next = stack.pop()!;
		if (next.kind === 'group') count += next.leafCount;
		else if (next.children?.length) stack.push(...next.children);
		else count++;
	}
	return count;
}

function flattenNode<TData>(
	node: RowTreeNode<TData>,
	state: FlattenState<TData>,
	parentId: string | null,
	level: number,
	posInSet: number,
	setSize: number
): void {
	const { config, result } = state;

	if (node.kind === 'data') {
		const rowId = node.node.id;
		const id = toDataVisualRowId(rowId);
		const explicitHeight = config.rowHeightsRecord[rowId] ?? config.getRowHeight?.(node.node.data, rowId);
		const children = node.children;
		const hasChildren = !!children && children.length > 0;
		const expanded = hasChildren && (config.defaultTreeRowsExpanded || config.expandedTreeRowIds.has(rowId));
		result.push({
			kind: 'data',
			id,
			rowId,
			node: node.node,
			hierarchy: {
				level,
				parentId,
				hasChildren,
				expanded,
				childCount: children?.length ?? 0,
				leafCount: hasChildren ? countLeaves(node) : 0,
				posInSet,
				setSize,
			},
			...(node.aggregates ? { aggregates: node.aggregates } : {}),
			height: explicitHeight !== undefined ? explicitHeight : config.defaultRowHeight,
			selectable: true,
			editable: true,
		});

		if (expanded) {
			for (let i = 0; i < children!.length; i++) flattenNode(children![i], state, id, level + 1, i + 1, children!.length);
		}

		if (config.masterDetailEnabled && config.expandedDetailRowIds.has(rowId)) {
			result.push({
				kind: 'detail',
				id: toDetailVisualRowId(rowId),
				parentId: rowId,
				parentRowId: rowId,
				hierarchy: {
					level: level + 1,
					parentId: id,
					hasChildren: false,
					expanded: false,
					childCount: 0,
					leafCount: 0,
					posInSet: 0,
					setSize: 0,
				},
				height: config.getDetailHeight?.({ row: node.node.data, rowId }) ?? config.detailRowHeight ?? 200,
				render: config.detailRenderer,
			});
		}
		return;
	}

	const expanded = config.defaultGroupsExpanded || config.expandedGroupIds.has(node.id);
	const groupRowIdx = result.length;
	const hierarchy: RowHierarchy = {
		level,
		parentId,
		hasChildren: node.children.length > 0,
		expanded,
		childCount: node.childCount,
		leafCount: node.leafCount,
		posInSet,
		setSize,
	};

	result.push({
		kind: 'group',
		id: node.id,
		groupId: node.id,
		key: node.key,
		keyString: node.keyString,
		field: node.field,
		path: node.path,
		hierarchy,
		aggregates: node.aggregates,
		height: config.groupRowHeight || config.defaultRowHeight,
		selectable: false,
	});

	if (!expanded) return;

	// Created before the children's entries so the map iterates in row order.
	state.stickyGroupMeta?.set(groupRowIdx, groupRowIdx);

	const placement = groupTotalPlacement(config.totals, level);
	const pushTotal = (where: TotalPlacement) =>
		result.push({
			kind: 'total',
			id: toTotalVisualRowId(node.id),
			scope: 'group',
			groupId: node.id,
			placement: where,
			hierarchy: {
				level: level + 1,
				parentId: node.id,
				hasChildren: false,
				expanded: false,
				childCount: 0,
				leafCount: 0,
				posInSet: 0,
				setSize: 0,
			},
			aggregates: node.aggregates,
			height: state.totalsHeight,
			selectable: false,
		});

	if (placement === 'top') pushTotal('top');
	for (let i = 0; i < node.children.length; i++) flattenNode(node.children[i], state, node.id, level + 1, i + 1, node.children.length);

	// The sticky boundary is the last row of the group's content: a bottom total sits after it, so
	// the header stops sticking as the content ends, not after its total has scrolled past.
	if (state.stickyGroupMeta) {
		if (result.length - 1 > groupRowIdx) state.stickyGroupMeta.set(groupRowIdx, result.length - 1);
		else state.stickyGroupMeta.delete(groupRowIdx);
	}
	if (placement === 'bottom') pushTotal('bottom');
}
