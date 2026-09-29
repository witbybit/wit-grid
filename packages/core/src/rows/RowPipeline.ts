import type { ColumnDef } from '../columnDef.js';
import type { SortModel, FilterModel, QuickFilterModel, GroupRowMeta } from '../rowModel.js';
import { applyClientFilterOnly, applyClientSortAndFilter } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import { applyQueryModelFilter } from '../query/evaluateQueryModel.js';
import { RowNode } from '../rowNode.js';
import type { VisualRow } from '../visualRow.js';
import { createRowPipelineContext } from './pipelineContext.js';
import { groupStage } from './stages/groupStage.js';
import { treeStage } from './stages/treeStage.js';
import { sortTreeStage } from './stages/sortTreeStage.js';
import { aggregateStage, type AggregationDef } from './stages/aggregateStage.js';
import { flattenStage } from './stages/flattenStage.js';
import type { RowTreeNode } from './stages/types.js';
import { toDataVisualRowId, toGroupVisualRowId } from './visualRowIds.js';
import { computePageWindow, type PageWindow } from './pageModel.js';

export interface GroupDef<TData = unknown> {
	colId: string;
	keyCreator?: (params: { value: unknown; row: TData; rowId: string }) => string;
	comparator?: (a: unknown, b: unknown) => number;
}

export interface RowModelConfig<TData = unknown> {
	type: 'client' | 'server';
	grouping?: {
		model: GroupDef<TData>[];
		defaultExpanded?: boolean;
		expandedGroupIds?: Record<string, true>;
		includeFooter?: boolean;
	};
	treeData?: {
		enabled: boolean;
		getParentId: (row: TData) => string | null | undefined;
		/** Source fields read by getParentId. When declared, only changes to these fields trigger tree restructuring. */
		getParentIdDependencies?: string[];
		defaultExpanded?: boolean;
		expandedRowIds?: Record<string, true>;
		filterMode?: 'strict' | 'includeAncestors' | 'includeDescendants';
	};
	masterDetail?: {
		enabled: boolean;
		expandedRowIds?: Record<string, true>;
		getDetailHeight?: (params: { row: TData; rowId: string }) => number;
		defaultDetailHeight?: number;
	};
}

export interface RowPipelineInput<TData = unknown> {
	nodes: RowNode<TData>[];
	columns: ColumnDef<TData>[];
	sortModel: SortModel | null;
	filterModel: FilterModel | null;
	quickFilterModel?: QuickFilterModel | null;
	queryModel?: GridQueryModel | null;

	// Tree / Group / Detail configs
	groupBy?: string[];
	rowModelConfig?: RowModelConfig<TData>;
	getParentId?: (data: TData) => string | null | undefined;
	aggDefs?: AggregationDef<TData>[];
	expandedGroupIds: Set<string>;
	expandedTreeRowIds?: Set<string>;
	expandedDetailRowIds: Set<string>;

	// Heights
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	getRowHeight?: (row: TData, rowId: string) => number | undefined;
	groupRowHeight?: number;
	detailRowHeight?: number;
	getDetailHeight?: (params: { row: TData; rowId: string }) => number;
	masterDetailEnabled?: boolean;
	detailRenderer?: unknown;
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
	rowIdToVisualRowId: Map<string, string>;
	rowIdToVisualRowIds?: Map<string, string[]>;
	/** Maps each expanded group row's visual index → its last descendant's visual index. */
	stickyGroupMeta: Map<number, number>;
	/** Rich metadata for each group row, keyed by groupId. */
	groupMeta: Map<string, GroupRowMeta>;
	/** Rich metadata for each group row, keyed by visual index. */
	groupMetaByVisualIndex: Map<number, GroupRowMeta>;
	/** Present when client pagination is active — the slice applied to the visual rows. */
	pageWindow?: PageWindow;
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
			groupBy,
			rowModelConfig,
			getParentId,
			aggDefs = [],
			expandedGroupIds,
			expandedTreeRowIds = new Set<string>(),
			expandedDetailRowIds,
			defaultRowHeight,
			rowHeightsRecord,
			getRowHeight,
			groupRowHeight,
			detailRowHeight,
			getDetailHeight,
			masterDetailEnabled,
			detailRenderer,
			reportFault,
		} = input;

		const groupingConfig = rowModelConfig?.grouping;
		const treeConfig = rowModelConfig?.treeData?.enabled ? rowModelConfig.treeData : undefined;
		const detailConfig = rowModelConfig?.masterDetail;
		const groupDefs: GroupDef<TData>[] = groupingConfig?.model ?? (groupBy ?? []).map((colId) => ({ colId }));
		const effectiveGetParentId = treeConfig?.getParentId ?? getParentId;
		const context = createRowPipelineContext(
			columns,
			{
				groups: new Set([...expandedGroupIds, ...Object.keys(groupingConfig?.expandedGroupIds ?? {})]),
				treeRows: new Set([...expandedTreeRowIds, ...Object.keys(treeConfig?.expandedRowIds ?? {})]),
				details: new Set([...expandedDetailRowIds, ...Object.keys(detailConfig?.expandedRowIds ?? {})]),
			},
			reportFault
		);

		let roots: RowTreeNode<TData>[] | null = null;
		let visualRows: VisualRow<TData>[] | null = null;

		if (groupDefs.length > 0) {
			const filteredNodes = applyQueryModelFilter(applyClientFilterOnly(nodes, columns, filterModel, quickFilterModel), columns, queryModel);
			roots = groupStage(filteredNodes, groupDefs, context);
		} else if (effectiveGetParentId) {
			const treeRoots = treeStage(nodes, effectiveGetParentId);
			const treeFiltered = this.filterTree(treeRoots, columns, filterModel, quickFilterModel, treeConfig?.filterMode ?? 'includeAncestors');
			roots = queryModel ? this.filterTreeByQuery(treeFiltered, columns, queryModel) : treeFiltered;
		} else {
			const filteredNodes = applyQueryModelFilter(
				applyClientSortAndFilter(nodes, columns, sortModel, filterModel, quickFilterModel).map((w) => w.node),
				columns,
				queryModel
			);
			if (!detailConfig?.enabled && !masterDetailEnabled && aggDefs.length === 0) {
				visualRows = filteredNodes.map((node) => {
					const explicitHeight = rowHeightsRecord[node.id] ?? getRowHeight?.(node.data, node.id);
					return {
						kind: 'data',
						id: toDataVisualRowId(node.id),
						rowId: node.id,
						node,
						depth: 0,
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

		if (
			roots &&
			(groupDefs.length > 0 || effectiveGetParentId) &&
			((sortModel && sortModel.length > 0) || groupDefs.some((def) => def.comparator))
		) {
			sortTreeStage(roots, sortModel, columns, groupDefs);
		}

		if (roots && aggDefs && aggDefs.length > 0) {
			aggregateStage(roots, aggDefs, context);
		}

		const stickyGroupMeta = new Map<number, number>();
		visualRows ??= flattenStage(
			roots ?? [],
			{
				expandedGroupIds: context.expansion.groups,
				expandedTreeRowIds: context.expansion.treeRows,
				expandedDetailRowIds: context.expansion.details,
				defaultRowHeight,
				rowHeightsRecord,
				getRowHeight,
				groupRowHeight,
				detailRowHeight: detailConfig?.defaultDetailHeight ?? detailRowHeight,
				getDetailHeight: detailConfig?.getDetailHeight ?? getDetailHeight,
				masterDetailEnabled: detailConfig?.enabled ?? masterDetailEnabled,
				detailRenderer,
				defaultGroupsExpanded: groupingConfig?.defaultExpanded,
				defaultTreeRowsExpanded: treeConfig?.defaultExpanded,
				includeFooter: groupingConfig?.includeFooter,
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
		const rowIdToVisualRowId = new Map<string, string>();
		let rowIdToVisualRowIds: Map<string, string[]> | undefined;
		let groupCount = 0;
		let detailRowCount = 0;
		let loadingRowCount = 0;
		visualRows.forEach((row, idx) => {
			visualRowIdToIndex.set(row.id, idx);
			if (row.kind === 'data') {
				if (!rowIdToVisualIndex.has(row.rowId)) {
					rowIdToVisualIndex.set(row.rowId, idx);
					rowIdToVisualRowId.set(row.rowId, row.id);
				}
			} else if (row.kind === 'detail') {
				rowIdToVisualRowIds ??= new Map<string, string[]>();
				const parentRowId = row.parentRowId ?? row.parentId;
				const ids = rowIdToVisualRowIds.get(parentRowId) ?? [];
				const dataVisualRowId = rowIdToVisualRowId.get(parentRowId);
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
			rowIdToVisualRowId,
			rowIdToVisualRowIds,
			stickyGroupMeta,
			groupMeta,
			groupMetaByVisualIndex,
			pageWindow,
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

	public collectAllExpansionIds(
		input: Pick<RowPipelineInput<TData>, 'nodes' | 'columns' | 'groupBy' | 'rowModelConfig' | 'filterModel' | 'quickFilterModel' | 'queryModel'>
	): { groupIds: string[]; treeRowIds: string[] } {
		const { nodes, columns, groupBy, rowModelConfig, filterModel, quickFilterModel, queryModel } = input;
		const groupingConfig = rowModelConfig?.grouping;
		const groupDefs: GroupDef<TData>[] = groupingConfig?.model ?? (groupBy ?? []).map((colId) => ({ colId }));
		const filteredNodes = applyQueryModelFilter(applyClientFilterOnly(nodes, columns, filterModel, quickFilterModel), columns, queryModel);
		const context = createRowPipelineContext(columns, { groups: new Set(), treeRows: new Set(), details: new Set() });
		const groupIds: string[] = [];
		const treeRowIds: string[] = [];

		if (groupDefs.length > 0) {
			const roots = groupStage(filteredNodes, groupDefs, context);
			const collectGroups = (nodes: RowTreeNode<TData>[]) => {
				for (const node of nodes) {
					if (node.kind === 'group') {
						groupIds.push(toGroupVisualRowId(node.path));
						collectGroups(node.children);
					}
				}
			};
			collectGroups(roots);
		}

		const treeConfig = rowModelConfig?.treeData?.enabled ? rowModelConfig.treeData : undefined;
		if (treeConfig?.getParentId) {
			const roots = treeStage(filteredNodes, treeConfig.getParentId);
			const collectTreeRows = (nodes: RowTreeNode<TData>[]) => {
				for (const node of nodes) {
					if (node.kind === 'data' && node.children && node.children.length > 0) {
						treeRowIds.push(node.rowId);
					}
					if (node.kind === 'data' && node.children) {
						collectTreeRows(node.children);
					}
				}
			};
			collectTreeRows(roots);
		}

		return { groupIds, treeRowIds };
	}

	public collectAllGroupIds(
		input: Pick<RowPipelineInput<TData>, 'nodes' | 'columns' | 'groupBy' | 'rowModelConfig' | 'filterModel' | 'quickFilterModel' | 'queryModel'>
	): string[] {
		return this.collectAllExpansionIds(input).groupIds;
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
 * Rebuild `stickyGroupMeta` (expanded-group visual index → last descendant index) from a
 * flat visual-row array. Used after a pagination slice, where flattenStage's original
 * meta holds stale full-array indices.
 *
 * Faithful to flattenStage: a group's sticky boundary is its last *content* descendant,
 * which sits before the group's footer. Footers (and sibling/shallower groups) share or
 * undercut the group's depth, so the first row at depth <= the group's depth terminates
 * the descendant range — the row just before it is the boundary.
 */
function rebuildStickyGroupMeta<TData>(visualRows: VisualRow<TData>[], out: Map<number, number>): void {
	out.clear();
	const stack: Array<{ idx: number; depth: number }> = [];
	for (let i = 0; i < visualRows.length; i++) {
		const row = visualRows[i];
		const depth = 'depth' in row ? ((row as { depth?: number }).depth ?? 0) : 0;
		while (stack.length > 0 && depth <= stack[stack.length - 1].depth) {
			const g = stack.pop()!;
			if (i - 1 > g.idx) out.set(g.idx, i - 1);
		}
		if (row.kind === 'group' && row.expanded) {
			stack.push({ idx: i, depth });
		}
	}
	while (stack.length > 0) {
		const g = stack.pop()!;
		if (visualRows.length - 1 > g.idx) out.set(g.idx, visualRows.length - 1);
	}
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
			while (stack.length > 0 && stack[stack.length - 1].depth >= row.depth) {
				const closing = stack.pop()!;
				if (closing.firstChildIndex !== -1) closing.lastChildIndex = i - 1;
			}
			const parentGroupId = stack.length > 0 ? stack[stack.length - 1].groupId : null;
			const meta: GroupRowMeta = {
				groupId: row.groupId,
				visualIndex: i,
				depth: row.depth,
				parentGroupId,
				firstChildIndex: row.expanded ? i + 1 : -1,
				lastChildIndex: row.expanded ? visualRows.length - 1 : -1,
				firstLeafIndex: -1,
				lastLeafIndex: -1,
				visibleDescendantRowIds: [],
				childGroupIds: [],
				leafCount: row.leafCount ?? 0,
				childCount: row.childCount ?? 0,
				expanded: row.expanded,
				aggregateValues: row.aggregateValues,
			};
			if (parentGroupId !== null) byId.get(parentGroupId)?.childGroupIds.push(row.groupId);
			byId.set(row.groupId, meta);
			byVisualIndex.set(i, meta);
			if (row.expanded) stack.push(meta);
		} else if (row.kind === 'data') {
			for (const group of stack) {
				group.visibleDescendantRowIds.push(row.rowId);
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
