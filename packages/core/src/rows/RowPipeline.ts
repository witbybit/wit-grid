import type { ColumnDef } from '../columnDef.js';
import type { SortModel, FilterModel, QuickFilterModel, GroupRowMeta } from '../rowModel.js';
import { applyClientFilterOnly, applyClientSortAndFilter } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import { applyQueryModelFilter } from '../query/evaluateQueryModel.js';
import type { RowNode } from '../rowNode.js';
import { FLAT_HIERARCHY, type VisualRow } from '../visualRow.js';
import { createRowPipelineContext } from './pipelineContext.js';
import { groupStage } from './stages/groupStage.js';
import { treeStage } from './stages/treeStage.js';
import { sortTreeStage } from './stages/sortTreeStage.js';
import { aggregateStage } from './stages/aggregateStage.js';
import { flattenStage } from './stages/flattenStage.js';
import {
	normalizeGroupDefs,
	type AggregationConfig,
	type DetailConfig,
	type ExpansionState,
	type GroupingConfig,
	type TreeDataConfig,
} from './hierarchyConfig.js';
import type { RowTreeNode } from './stages/types.js';
import { toDataVisualRowId } from './visualRowIds.js';
import { computePageWindow, type PageWindow } from './pageModel.js';

export type { GroupDef } from './hierarchyConfig.js';

export interface RowPipelineInput<TData = unknown> {
	nodes: RowNode<TData>[];
	columns: ColumnDef<TData>[];
	sortModel: SortModel | null;
	filterModel: FilterModel | null;
	quickFilterModel?: QuickFilterModel | null;
	queryModel?: GridQueryModel | null;

	// Hierarchy: each is absent when unused.
	grouping?: GroupingConfig<TData>;
	treeData?: TreeDataConfig<TData>;
	aggregation?: AggregationConfig<TData>;
	detail?: DetailConfig<TData>;
	expansion: ExpansionState;

	// Heights
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	getRowHeight?: (row: TData, rowId: string) => number | undefined;
	reportFault?: (operation: string, error: unknown, context?: Record<string, unknown>) => void;

	// Client pagination. When set, the final flattened visual rows are sliced to this page
	// window before any index maps / sticky / group meta are built, so the whole output is
	// page-relative. Omit for no pagination (full list).
	pagination?: { pageSize: number; page: number };
}

export interface RowPipelineOutput<TData = unknown> {
	visualRows: VisualRow<TData>[];
	visualRowIdToIndex: Map<string, number>;
	rowIdToVisualIndex: Map<string, number>;
	rowIdToVisualRowIds?: Map<string, string[]>;
	/** Maps each expanded group row's visual index → its last descendant's visual index. */
	stickyGroupMeta: Map<number, number>;
	/** Rich metadata for each group row, keyed by groupId. */
	groupMeta: Map<string, GroupRowMeta>;
	/** Rich metadata for each group row, keyed by visual index. */
	groupMetaByVisualIndex: Map<number, GroupRowMeta>;
	/** Present when client pagination is active — the slice applied to the visual rows. */
	pageWindow?: PageWindow;
	/** The full row tree (collapsed subtrees included) when rows are grouped, tree-shaped or aggregated. */
	roots: RowTreeNode<TData>[] | null;
	version: number;
	stats: {
		totalDataRows: number;
		totalVisualRows: number;
		groupCount: number;
		detailRowCount: number;
		loadingRowCount: number;
	};
}

export type RowPipelineResult<TData = unknown> = RowPipelineOutput<TData>;

export class RowPipeline<TData = unknown> {
	private version = 0;

	public run(input: RowPipelineInput<TData>): RowPipelineOutput<TData> {
		const {
			nodes,
			columns,
			sortModel,
			filterModel,
			quickFilterModel,
			queryModel,
			grouping,
			treeData,
			aggregation,
			detail,
			expansion,
			defaultRowHeight,
			rowHeightsRecord,
			getRowHeight,
			reportFault,
		} = input;

		const groupDefs = normalizeGroupDefs(grouping?.by);
		const aggDefs = aggregation?.defs ?? [];
		const context = createRowPipelineContext(columns, reportFault);

		let roots: RowTreeNode<TData>[] | null = null;
		let visualRows: VisualRow<TData>[] | null = null;

		if (groupDefs.length > 0) {
			const filteredNodes = applyQueryModelFilter(applyClientFilterOnly(nodes, columns, filterModel, quickFilterModel), columns, queryModel);
			roots = groupStage(filteredNodes, groupDefs, context);
		} else if (treeData) {
			const treeRoots = treeStage(nodes, treeData.getParentId);
			const treeFiltered = this.filterTree(treeRoots, columns, filterModel, quickFilterModel, treeData.filterMode ?? 'includeAncestors');
			roots = queryModel ? this.filterTreeByQuery(treeFiltered, columns, queryModel) : treeFiltered;
		} else {
			const filteredNodes = applyQueryModelFilter(
				applyClientSortAndFilter(nodes, columns, sortModel, filterModel, quickFilterModel).map((w) => w.node),
				columns,
				queryModel
			);
			if (!detail && aggDefs.length === 0) {
				visualRows = filteredNodes.map((node) => {
					const explicitHeight = rowHeightsRecord[node.id] ?? getRowHeight?.(node.data, node.id);
					return {
						kind: 'data',
						id: toDataVisualRowId(node.id),
						rowId: node.id,
						node,
						hierarchy: FLAT_HIERARCHY,
						height: explicitHeight !== undefined ? explicitHeight : defaultRowHeight,
						selectable: true,
						editable: true,
					};
				});
			} else {
				roots = filteredNodes.map((node) => ({
					kind: 'data',
					rowId: node.id,
					node,
					depth: 0,
				}));
			}
		}

		if (roots && (groupDefs.length > 0 || treeData) && ((sortModel && sortModel.length > 0) || groupDefs.some((def) => def.comparator))) {
			sortTreeStage(roots, sortModel, columns, groupDefs);
		}

		const grandAggregates =
			roots && aggDefs.length > 0
				? aggregateStage(roots, aggDefs, context, { aggregateTreeParents: treeData?.aggregateParents ?? true })
				: undefined;

		const stickyGroupMeta = new Map<number, number>();
		visualRows ??= flattenStage(
			roots ?? [],
			{
				expansion,
				groupDefaultExpanded: grouping?.defaultExpanded,
				treeDefaultExpanded: treeData?.defaultExpanded,
				defaultRowHeight,
				rowHeightsRecord,
				getRowHeight,
				groupRowHeight: grouping?.rowHeight,
				detail,
				// Totals belong to grouping; a grand total without grouping still makes sense.
				totals: grouping?.totals,
				grandAggregates,
			},
			stickyGroupMeta
		);

		// Client pagination page-window. Slice the fully-flattened visual rows to the
		// requested page BEFORE building any derived structure, so the index maps and group
		// meta below — and the geometry/render-window/sticky/selection that read them —
		// are all page-relative with zero extra work. The total (pre-slice) count is the
		// pagination denominator and is preserved on `pageWindow.totalRows`.
		let pageWindow: PageWindow | undefined;
		if (input.pagination) {
			pageWindow = computePageWindow(visualRows.length, input.pagination.pageSize, input.pagination.page);
			if (pageWindow.startIndex !== 0 || pageWindow.endIndex !== visualRows.length) {
				visualRows = visualRows.slice(pageWindow.startIndex, pageWindow.endIndex);
			}
			// `stickyGroupMeta` was populated inside flattenStage with full-array indices, so
			// rebuild it from the sliced rows (faithful to flattenStage: last descendant before
			// the group's footer; footer shares the group's depth and terminates the subtree).
			rebuildStickyGroupMeta(visualRows, stickyGroupMeta);
		}

		const visualRowIdToIndex = new Map<string, number>();
		const rowIdToVisualIndex = new Map<string, number>();
		let rowIdToVisualRowIds: Map<string, string[]> | undefined;
		let groupCount = 0;
		let detailRowCount = 0;
		let loadingRowCount = 0;
		visualRows.forEach((row, idx) => {
			// Data rows are found through rowIdToVisualIndex (their visual id derives from the row id).
			if (row.kind !== 'data') visualRowIdToIndex.set(row.id, idx);
			if (row.kind === 'data') {
				if (!rowIdToVisualIndex.has(row.rowId)) {
					rowIdToVisualIndex.set(row.rowId, idx);
				}
			} else if (row.kind === 'detail') {
				rowIdToVisualRowIds ??= new Map<string, string[]>();
				const parentRowId = row.parentRowId ?? row.parentId;
				const ids = rowIdToVisualRowIds.get(parentRowId) ?? [];
				// A data row's visual id is derived from its row id.
				const dataVisualRowId = rowIdToVisualIndex.has(parentRowId) ? toDataVisualRowId(parentRowId) : undefined;
				if (ids.length === 0 && dataVisualRowId) {
					ids.push(dataVisualRowId);
				}
				ids.push(row.id);
				rowIdToVisualRowIds.set(parentRowId, ids);
				detailRowCount++;
			} else if (row.kind === 'group') {
				groupCount++;
			} else if (row.kind === 'loading') {
				loadingRowCount++;
			}
		});

		const { byId: groupMeta, byVisualIndex: groupMetaByVisualIndex } = computeGroupMeta(visualRows);

		return {
			visualRows,
			visualRowIdToIndex,
			rowIdToVisualIndex,
			rowIdToVisualRowIds,
			stickyGroupMeta,
			groupMeta,
			groupMetaByVisualIndex,
			pageWindow,
			roots,
			version: ++this.version,
			stats: {
				totalDataRows: nodes.length,
				totalVisualRows: visualRows.length,
				groupCount,
				detailRowCount,
				loadingRowCount,
			},
		};
	}

	private filterTreeByQuery<TData>(roots: RowTreeNode<TData>[], columns: ColumnDef<TData>[], queryModel: GridQueryModel): RowTreeNode<TData>[] {
		if (queryModel.root.children.length === 0) return roots;
		const matchingIds = new Set(
			applyQueryModelFilter(
				roots.flatMap((root) => collectDataNodes(root)),
				columns,
				queryModel
			).map((n) => n.id)
		);
		const includeNode = (node: RowTreeNode<TData>): RowTreeNode<TData> | null => {
			if (node.kind !== 'data') return node;
			const children = (node.children ?? []).map(includeNode).filter((c): c is RowTreeNode<TData> => !!c);
			if (!matchingIds.has(node.rowId) && children.length === 0) return null;
			return { ...node, children: children.length > 0 ? children : undefined };
		};
		return roots.map(includeNode).filter((n): n is RowTreeNode<TData> => !!n);
	}

	private filterTree<TData>(
		roots: RowTreeNode<TData>[],
		columns: ColumnDef<TData>[],
		filterModel: FilterModel | null,
		quickFilterModel: QuickFilterModel | null | undefined,
		filterMode: 'strict' | 'includeAncestors' | 'includeDescendants'
	): RowTreeNode<TData>[] {
		const hasFilter = filterModel && Object.keys(filterModel).length > 0;
		const hasQuickFilter = !!quickFilterModel?.text.trim();
		if (!hasFilter && !hasQuickFilter) return roots;
		const matchingIds = new Set(
			applyClientSortAndFilter(
				roots.flatMap((root) => collectDataNodes(root)),
				columns,
				null,
				filterModel,
				quickFilterModel
			).map((w) => w.node.id)
		);
		const includeNode = (node: RowTreeNode<TData>): RowTreeNode<TData> | null => {
			if (node.kind !== 'data') return node;
			const children = (node.children ?? []).map(includeNode).filter((child): child is RowTreeNode<TData> => !!child);
			const selfMatches = matchingIds.has(node.rowId);
			const keep = filterMode === 'strict' ? selfMatches : selfMatches || children.length > 0;
			if (!keep) return null;
			if (filterMode === 'includeDescendants' && selfMatches) {
				return node;
			}
			return { ...node, children: children.length > 0 ? children : undefined };
		};
		return roots.map(includeNode).filter((node): node is RowTreeNode<TData> => !!node);
	}
}

/**
 * Rebuild `stickyGroupMeta` (expanded-group visual index → last content index) from a flat
 * visual-row array, in row order. Used after a pagination slice, where flattenStage's meta holds
 * full-array indices. Faithful to flattenStage: a group's content ends at the first row at its
 * level or shallower, or at its own bottom total.
 */
function rebuildStickyGroupMeta<TData>(visualRows: VisualRow<TData>[], out: Map<number, number>): void {
	out.clear();
	const stack: Array<{ idx: number; level: number; groupId: string }> = [];
	const close = (group: { idx: number }, last: number) => {
		if (last > group.idx) out.set(group.idx, last);
		else out.delete(group.idx);
	};
	for (let i = 0; i < visualRows.length; i++) {
		const row = visualRows[i];
		const level = row.hierarchy.level;
		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			const endsTop = level <= top.level || (row.kind === 'total' && row.placement === 'bottom' && row.groupId === top.groupId);
			if (!endsTop) break;
			close(stack.pop()!, i - 1);
		}
		if (row.kind === 'group' && row.hierarchy.expanded) {
			// Created before the entries of the groups it contains, so the map iterates in row order.
			out.set(i, i);
			stack.push({ idx: i, level, groupId: row.groupId });
		}
	}
	while (stack.length > 0) close(stack.pop()!, visualRows.length - 1);
}

function computeGroupMeta<TData>(visualRows: VisualRow<TData>[]): {
	byId: Map<string, GroupRowMeta>;
	byVisualIndex: Map<number, GroupRowMeta>;
} {
	const byId = new Map<string, GroupRowMeta>();
	const byVisualIndex = new Map<number, GroupRowMeta>();
	const stack: GroupRowMeta[] = [];

	for (let i = 0; i < visualRows.length; i++) {
		const row = visualRows[i];
		if (row.kind === 'group') {
			// Close groups on the stack that are at same or deeper depth than this new group.
			while (stack.length > 0 && stack[stack.length - 1].level >= row.hierarchy.level) {
				const closing = stack.pop()!;
				if (closing.firstChildIndex !== -1) closing.lastChildIndex = i - 1;
			}
			const parentGroupId = stack.length > 0 ? stack[stack.length - 1].groupId : null;
			const meta: GroupRowMeta = {
				groupId: row.groupId,
				visualIndex: i,
				level: row.hierarchy.level,
				parentGroupId,
				firstChildIndex: row.hierarchy.expanded ? i + 1 : -1,
				lastChildIndex: row.hierarchy.expanded ? visualRows.length - 1 : -1,
				firstLeafIndex: -1,
				lastLeafIndex: -1,
				childGroupIds: [],
				leafCount: row.hierarchy.leafCount,
				childCount: row.hierarchy.childCount,
				expanded: row.hierarchy.expanded,
				aggregates: row.aggregates,
			};
			if (parentGroupId !== null) byId.get(parentGroupId)?.childGroupIds.push(row.groupId);
			byId.set(row.groupId, meta);
			byVisualIndex.set(i, meta);
			if (row.hierarchy.expanded) stack.push(meta);
		} else if (row.kind === 'data') {
			for (const group of stack) {
				if (group.firstLeafIndex === -1) group.firstLeafIndex = i;
				group.lastLeafIndex = i;
			}
		}
	}
	// Close any groups still open at end of list.
	while (stack.length > 0) {
		const closing = stack.pop()!;
		if (closing.firstChildIndex !== -1) closing.lastChildIndex = visualRows.length - 1;
	}

	return { byId, byVisualIndex };
}

function collectDataNodes<TData>(root: RowTreeNode<TData>): RowNode<TData>[] {
	if (root.kind === 'data') {
		return [root.node, ...(root.children ?? []).flatMap((child) => collectDataNodes(child))];
	}
	return root.children.flatMap((child) => collectDataNodes(child));
}
