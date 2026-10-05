import type { RowHierarchy, TotalPlacement, VisualRow } from '../../visualRow.js';
import {
	resolveDefaultExpanded,
	type DefaultExpanded,
	type DetailConfig,
	type ExpansionState,
	type GroupInfo,
	type TotalsConfig,
	type TreeRowInfo,
} from '../hierarchyConfig.js';
import { dataVisualRowIdOf, toDataVisualRowId, toDetailVisualRowId, toTotalVisualRowId } from '../visualRowIds.js';
import type { RowTreeNode } from './types.js';

export interface FlattenConfig<TData = unknown> {
	expansion: ExpansionState;
	groupDefaultExpanded?: DefaultExpanded<GroupInfo>;
	treeDefaultExpanded?: DefaultExpanded<TreeRowInfo<TData>>;
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	getRowHeight?: (row: TData, rowId: string) => number | undefined;
	/** Height of group and total rows. */
	groupRowHeight?: number;
	/** Present when rows can open a detail. */
	detail?: DetailConfig<TData>;
	totals?: TotalsConfig;
	/** Aggregates of every row, for the grand total. */
	grandAggregates?: Record<string, unknown>;
}

interface FlattenState<TData> {
	readonly config: FlattenConfig<TData>;
	readonly result: VisualRow<TData>[];
	readonly stickyGroupMeta?: Map<number, number>;
	readonly totalsHeight: number;
	/** `config.rowHeightsRecord`, or null when it is empty (most grids): no per-row lookup then. */
	readonly recordedHeights: Record<string, number> | null;
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
		recordedHeights: hasKeys(config.rowHeightsRecord) ? config.rowHeightsRecord : null,
	};
	const grand = config.totals?.grand;
	if (grand === 'top') pushGrandTotal(state);
	for (let i = 0; i < roots.length; i++) flattenNode(roots[i], state, null, 0, i + 1, roots.length);
	if (grand === 'bottom') pushGrandTotal(state);
	return result;
}

type ExpansionConfig<TData> = Pick<FlattenConfig<TData>, 'expansion' | 'groupDefaultExpanded' | 'treeDefaultExpanded'>;

/** A group's or tree row's expansion: its explicit override, else `expansion.base`, else the configured default. */
export function resolveNodeExpanded<TData>(node: RowTreeNode<TData>, level: number, config: ExpansionConfig<TData>): boolean {
	const { expansion } = config;
	if (node.kind === 'group') {
		return (
			expansion.rows[node.id] ??
			resolveDefaultExpanded(expansion.base ?? config.groupDefaultExpanded, level, () => ({
				id: node.id,
				level,
				field: node.field,
				key: node.key,
				keyString: node.keyString,
				path: node.path,
				leafCount: node.leafCount,
			}))
		);
	}
	const id = toDataVisualRowId(node.rowId);
	return (
		expansion.rows[id] ??
		resolveDefaultExpanded(expansion.base ?? config.treeDefaultExpanded, level, () => ({
			id,
			rowId: node.rowId,
			row: node.node.data,
			level,
			childCount: node.children?.length ?? 0,
		}))
	);
}

/** Finds a group (`group:…`) or tree row (`row:…`) anywhere in the tree, collapsed subtrees included. */
export function findTreeNode<TData>(roots: RowTreeNode<TData>[], visualRowId: string): { node: RowTreeNode<TData>; level: number } | null {
	const stack: Array<{ node: RowTreeNode<TData>; level: number }> = [];
	for (let i = roots.length - 1; i >= 0; i--) stack.push({ node: roots[i], level: 0 });
	while (stack.length > 0) {
		const entry = stack.pop()!;
		const { node, level } = entry;
		if (node.kind === 'group' ? node.id === visualRowId : toDataVisualRowId(node.rowId) === visualRowId) return entry;
		const children = node.children;
		if (children) for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], level: level + 1 });
	}
	return null;
}

/** A measured `'auto'` height (recorded under the detail row's visual id) wins over the estimate. */
function resolveDetailHeight<TData>(detail: DetailConfig<TData>, row: TData, rowId: string, recorded: Record<string, number>): number {
	const { height } = detail;
	if (typeof height === 'function') return height({ row, rowId });
	if (height === 'auto') return recorded[toDetailVisualRowId(rowId)] ?? detail.estimatedHeight ?? 200;
	return height ?? 200;
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

function hasKeys(record: Record<string, unknown>): boolean {
	for (const _ in record) return true;
	return false;
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
		const rowId = node.rowId;
		const id = dataVisualRowIdOf(node.node);
		const explicitHeight = state.recordedHeights?.[rowId] ?? config.getRowHeight?.(node.node.data, rowId);
		const children = node.children;
		const hasChildren = !!children && children.length > 0;
		const expanded = hasChildren && resolveNodeExpanded(node, level, config);
		const row: VisualRow<TData> = {
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
			height: explicitHeight !== undefined ? explicitHeight : config.defaultRowHeight,
			selectable: true,
			editable: true,
		};
		if (node.aggregates) (row as { aggregates?: Record<string, unknown> }).aggregates = node.aggregates;
		node.row = row;
		result.push(row);

		if (expanded) {
			for (let i = 0; i < children!.length; i++) flattenNode(children![i], state, id, level + 1, i + 1, children!.length);
		}

		const detail = config.detail;
		if (detail && config.expansion.details[rowId] && (!detail.isMaster || detail.isMaster(node.node.data, rowId))) {
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
				height: resolveDetailHeight(detail, node.node.data, rowId, config.rowHeightsRecord),
				render: detail.renderer,
			});
		}
		return;
	}

	const expanded = resolveNodeExpanded(node, level, config);
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
