import type { ColumnDef } from '../columnDef.js';
import type { SortModel, FilterModel, QuickFilterModel, GroupRowMeta } from '../rowModel.js';
import { applyClientFilterOnly, applyClientSortAndFilter, createClientFilterPredicate } from '../rowModel.js';
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
import { dataVisualRowIdOf, toDataVisualRowId } from './visualRowIds.js';
import { computePageWindow, type PageWindow } from './pageModel.js';

export type { GroupDef } from './hierarchyConfig.js';

export interface RowPipelineInput<TData = unknown> {
	nodes: RowNode<TData>[];
	/**
	 * Changes whenever row membership, order or data changes (RowDataStore.dataVersion). When set, a
	 * run whose row-shaping inputs are unchanged reuses the previous row tree and only flattens
	 * (expansion, detail rows, pagination, heights). Omit to always run every stage.
	 */
	dataVersion?: number;
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

/**
 * Everything the row tree (filter, group / tree, sort, aggregate) is built from, compared by
 * reference. Flatten inputs (expansion, detail, heights, totals placement, pagination) are not part
 * of it: they are re-applied on every run.
 */
interface TreeStageKey<TData> {
	dataVersion: number;
	nodes: RowNode<TData>[];
	columns: ColumnDef<TData>[];
	sortModel: SortModel | null;
	/**
	 * Grouped and flat grids: the filter stage's output, which keeps its array identity while the
	 * same rows pass (a keystroke that matches the same rows rebuilds nothing). Tree grids filter
	 * the tree itself, so they key on the filter models instead.
	 */
	filtered: RowNode<TData>[] | null;
	filterModel: FilterModel | null;
	quickFilterModel: QuickFilterModel | null | undefined;
	queryModel: GridQueryModel | null | undefined;
	groupBy: GroupingConfig<TData>['by'] | undefined;
	treeData: TreeDataConfig<TData> | undefined;
	aggregationDefs: AggregationConfig<TData>['defs'] | undefined;
	hasDetail: boolean;
}

function treeStageKeyOf<TData>(input: RowPipelineInput<TData>, filtered: RowNode<TData>[] | null): TreeStageKey<TData> {
	const tree = !!input.treeData;
	return {
		dataVersion: input.dataVersion ?? -1,
		nodes: input.nodes,
		columns: input.columns,
		sortModel: input.sortModel,
		filtered: tree ? null : filtered,
		filterModel: tree ? input.filterModel : null,
		quickFilterModel: tree ? input.quickFilterModel : null,
		queryModel: tree ? input.queryModel : null,
		groupBy: input.grouping?.by,
		treeData: input.treeData,
		aggregationDefs: input.aggregation?.defs,
		hasDetail: !!input.detail,
	};
}

function sameTreeStageKey<TData>(a: TreeStageKey<TData>, b: TreeStageKey<TData>): boolean {
	return (
		a.dataVersion === b.dataVersion &&
		a.nodes === b.nodes &&
		a.columns === b.columns &&
		a.sortModel === b.sortModel &&
		a.filtered === b.filtered &&
		a.filterModel === b.filterModel &&
		a.quickFilterModel === b.quickFilterModel &&
		a.queryModel === b.queryModel &&
		a.groupBy === b.groupBy &&
		a.treeData === b.treeData &&
		a.aggregationDefs === b.aggregationDefs &&
		a.hasDetail === b.hasDetail
	);
}

const FILTER_CACHE_TEXTS = 8;

/** Everything flattening reads besides the tree's own contents, compared by reference. */
interface FlattenKey<TData> {
	roots: RowTreeNode<TData>[];
	expansion: ExpansionState;
	grouping: GroupingConfig<TData> | undefined;
	treeData: TreeDataConfig<TData> | undefined;
	detail: DetailConfig<TData> | undefined;
	defaultRowHeight: number;
	rowHeightsRecord: Record<string, number>;
	getRowHeight: RowPipelineInput<TData>['getRowHeight'];
	pagination: RowPipelineInput<TData>['pagination'];
}

function sameFlattenKey<TData>(a: FlattenKey<TData>, b: FlattenKey<TData>): boolean {
	return (
		a.roots === b.roots &&
		a.expansion === b.expansion &&
		a.grouping === b.grouping &&
		a.treeData === b.treeData &&
		a.detail === b.detail &&
		a.defaultRowHeight === b.defaultRowHeight &&
		a.rowHeightsRecord === b.rowHeightsRecord &&
		a.getRowHeight === b.getRowHeight &&
		a.pagination?.page === b.pagination?.page &&
		a.pagination?.pageSize === b.pagination?.pageSize
	);
}

interface FilterBase<TData> {
	dataVersion: number | undefined;
	nodes: RowNode<TData>[];
	columns: ColumnDef<TData>[];
	filterModel: FilterModel | null;
	queryModel: GridQueryModel | null | undefined;
	quickColumnIds: readonly string[] | undefined;
}

function filterBaseOf<TData>(input: RowPipelineInput<TData>): FilterBase<TData> {
	return {
		dataVersion: input.dataVersion,
		nodes: input.nodes,
		columns: input.columns,
		filterModel: input.filterModel,
		queryModel: input.queryModel,
		quickColumnIds: input.quickFilterModel?.columnIds,
	};
}

function sameFilterBase<TData>(a: FilterBase<TData>, b: FilterBase<TData>): boolean {
	return (
		a.dataVersion === b.dataVersion &&
		a.nodes === b.nodes &&
		a.columns === b.columns &&
		a.filterModel === b.filterModel &&
		a.queryModel === b.queryModel &&
		sameStrings(a.quickColumnIds, b.quickColumnIds)
	);
}

/** Column id lists compared by content; absent and empty both mean every column. */
function sameStrings(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
	if (a === b) return true;
	const left = a ?? [];
	const right = b ?? [];
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
	return true;
}

/** The quick-filter text as matching uses it: trimmed and lowercased; '' when there is none. */
function quickFilterText(model: QuickFilterModel | null | undefined): string {
	return model?.text.trim().toLowerCase() ?? '';
}

function sameRows<TData>(a: readonly RowNode<TData>[], b: readonly RowNode<TData>[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

interface FlatRowsKey<TData> {
	filtered: RowNode<TData>[];
	sortModel: SortModel | null;
	columns: ColumnDef<TData>[];
	dataVersion: number | undefined;
	rowHeightsRecord: Record<string, number>;
	getRowHeight: RowPipelineInput<TData>['getRowHeight'];
	defaultRowHeight: number;
}

function sameFlatRowsKey<TData>(a: FlatRowsKey<TData>, b: FlatRowsKey<TData>): boolean {
	return (
		a.filtered === b.filtered &&
		a.sortModel === b.sortModel &&
		a.columns === b.columns &&
		a.dataVersion === b.dataVersion &&
		a.rowHeightsRecord === b.rowHeightsRecord &&
		a.getRowHeight === b.getRowHeight &&
		a.defaultRowHeight === b.defaultRowHeight
	);
}

export class RowPipeline<TData = unknown> {
	private version = 0;
	/** The last built row tree and grand totals, reused while its key is unchanged. */
	private treeCache: { key: TreeStageKey<TData>; roots: RowTreeNode<TData>[]; grandAggregates: Record<string, unknown> | undefined } | null = null;
	/** Runs that reused the cached tree (diagnostics and tests). */
	public treeCacheHits = 0;
	/**
	 * The tree built without a quick filter (column filters still apply), kept beside the last tree
	 * so clearing the quick-filter box shows every row again without regrouping them.
	 */
	private unfilteredTreeCache: {
		key: TreeStageKey<TData>;
		roots: RowTreeNode<TData>[];
		grandAggregates: Record<string, unknown> | undefined;
	} | null = null;
	/**
	 * Recent filter results for one filter base (data, columns, column filters, query, quick-filter
	 * columns), keyed by quick-filter text. A text that contains a cached text only re-checks that
	 * text's matches, so typing narrows instead of rescanning every row; backspace hits the cache.
	 */
	private filterCache: { base: FilterBase<TData>; byText: Map<string, RowNode<TData>[]> } | null = null;
	/** The last filter output: an equal result is returned as this same array. */
	private lastFiltered: RowNode<TData>[] | null = null;
	/** The last output, returned again when nothing about the rows changed. */
	private lastOutput: RowPipelineOutput<TData> | null = null;
	/** What the last flatten was built from. */
	private lastFlattenKey: FlattenKey<TData> | null = null;
	/** Flat grids: the visual rows built from the last filtered + sorted rows, reused while they match. */
	private flatCache: { key: FlatRowsKey<TData>; visualRows: VisualRow<TData>[] } | null = null;

	/** Rows that pass the column filters, the quick filter and the query, in source order. */
	private filterStage(input: RowPipelineInput<TData>): RowNode<TData>[] {
		const { nodes, columns, filterModel, quickFilterModel, queryModel } = input;
		if (input.dataVersion === undefined) {
			return applyQueryModelFilter(applyClientFilterOnly(nodes, columns, filterModel, quickFilterModel), columns, queryModel);
		}
		const base = filterBaseOf(input);
		if (!this.filterCache || !sameFilterBase(this.filterCache.base, base)) this.filterCache = { base, byText: new Map() };
		const byText = this.filterCache.byText;
		const text = quickFilterText(quickFilterModel);
		let result = byText.get(text);
		if (!result) {
			let from: RowNode<TData>[] | undefined;
			let fromLength = -1;
			for (const [cachedText, rows] of byText) {
				if (cachedText.length > fromLength && text.includes(cachedText)) {
					from = rows;
					fromLength = cachedText.length;
				}
			}
			if (from) {
				// Already past the column filters and the query: only the quick filter can drop more.
				const quick = createClientFilterPredicate(columns, null, quickFilterModel);
				result = quick ? from.filter(quick) : from;
			} else {
				result = applyQueryModelFilter(applyClientFilterOnly(nodes, columns, filterModel, quickFilterModel), columns, queryModel);
			}
			byText.set(text, result);
			if (byText.size > FILTER_CACHE_TEXTS) {
				for (const key of byText.keys()) {
					if (key !== '' && key !== text) {
						byText.delete(key);
						break;
					}
				}
			}
		}
		const last = this.lastFiltered;
		if (last && last !== result && sameRows(last, result)) {
			result = last;
			byText.set(text, last);
		}
		this.lastFiltered = result;
		return result;
	}

	/** The filter output a run with this input would produce, if it is already known. */
	private peekFiltered(input: RowPipelineInput<TData>): RowNode<TData>[] | null {
		const cache = this.filterCache;
		if (!cache || !sameFilterBase(cache.base, filterBaseOf(input))) return null;
		return cache.byText.get(quickFilterText(input.quickFilterModel)) ?? null;
	}

	/** Whether a run with this input would reuse `roots` as built: the tree is current for it. */
	public isTreeCurrent(input: RowPipelineInput<TData>, roots: RowTreeNode<TData>[] | null): boolean {
		const cache = this.treeCache;
		if (!cache || !roots || cache.roots !== roots || input.dataVersion === undefined) return false;
		const filtered = input.treeData ? null : this.peekFiltered(input);
		if (!input.treeData && !filtered) return false;
		return sameTreeStageKey(cache.key, treeStageKeyOf(input, filtered));
	}

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
		let grandAggregates: Record<string, unknown> | undefined;

		const filtered = treeData && groupDefs.length === 0 ? null : this.filterStage(input);
		const treeKey = input.dataVersion === undefined ? null : treeStageKeyOf(input, filtered);
		let cached = treeKey && this.treeCache && sameTreeStageKey(this.treeCache.key, treeKey) ? this.treeCache : null;
		if (!cached && treeKey && this.unfilteredTreeCache && sameTreeStageKey(this.unfilteredTreeCache.key, treeKey)) {
			cached = this.treeCache = this.unfilteredTreeCache;
		}

		if (cached) {
			// Only expansion, detail, heights or pagination changed: the tree is current as built.
			this.treeCacheHits++;
			roots = cached.roots;
			grandAggregates = cached.grandAggregates;
		} else if (groupDefs.length > 0) {
			roots = groupStage(filtered!, groupDefs, context);
		} else if (treeData) {
			const treeRoots = treeStage(nodes, treeData.getParentId);
			const treeFiltered = this.filterTree(treeRoots, columns, filterModel, quickFilterModel, treeData.filterMode ?? 'includeAncestors');
			roots = queryModel ? this.filterTreeByQuery(treeFiltered, columns, queryModel) : treeFiltered;
		} else if (!detail && aggDefs.length === 0) {
			const flatKey: FlatRowsKey<TData> = {
				filtered: filtered!,
				sortModel,
				columns,
				dataVersion: input.dataVersion,
				rowHeightsRecord,
				getRowHeight,
				defaultRowHeight,
			};
			if (input.dataVersion !== undefined && this.flatCache && sameFlatRowsKey(this.flatCache.key, flatKey)) {
				visualRows = this.flatCache.visualRows;
				// Nothing about the rows changed: the previous output (indexes, metadata) still holds.
				if (!input.pagination && this.lastOutput?.visualRows === visualRows) return this.lastOutput;
			} else {
				const sortedNodes = sortModel?.length
					? applyClientSortAndFilter(filtered!, columns, sortModel, null, null).map((w) => w.node)
					: filtered!;
				let recorded: Record<string, number> | null = null;
				for (const _ in rowHeightsRecord) {
					recorded = rowHeightsRecord;
					break;
				}
				visualRows = sortedNodes.map((node) => {
					const explicitHeight = recorded?.[node.id] ?? getRowHeight?.(node.data, node.id);
					const height = explicitHeight !== undefined ? explicitHeight : defaultRowHeight;
					// The same row drawn the same way keeps its row object: no allocation, and the
					// row model's diff sees it unchanged.
					const previous = node.flatRow;
					if (previous !== undefined && previous.height === height) return previous;
					return (node.flatRow = {
						kind: 'data',
						id: dataVisualRowIdOf(node),
						rowId: node.id,
						node,
						hierarchy: FLAT_HIERARCHY,
						height,
						selectable: true,
						editable: true,
					});
				});
				this.flatCache = input.dataVersion === undefined ? null : { key: flatKey, visualRows };
			}
		} else {
			const sortedNodes = sortModel?.length
				? applyClientSortAndFilter(filtered!, columns, sortModel, null, null).map((w) => w.node)
				: filtered!;
			roots = sortedNodes.map((node) => ({
				kind: 'data',
				rowId: node.id,
				node,
				depth: 0,
			}));
		}

		if (!cached) {
			if (roots && (groupDefs.length > 0 || treeData) && ((sortModel && sortModel.length > 0) || groupDefs.some((def) => def.comparator))) {
				sortTreeStage(roots, sortModel, columns, groupDefs);
			}
			grandAggregates =
				roots && aggDefs.length > 0
					? aggregateStage(roots, aggDefs, context, { aggregateTreeParents: treeData?.aggregateParents ?? true })
					: undefined;
			this.treeCache = treeKey && roots ? { key: treeKey, roots, grandAggregates } : null;
			if (this.treeCache && quickFilterText(quickFilterModel) === '') this.unfilteredTreeCache = this.treeCache;
		}

		// The same tree drawn with the same expansion, heights and layout: the previous output holds.
		const flattenKey: FlattenKey<TData> | null =
			input.dataVersion === undefined || !roots
				? null
				: {
						roots,
						expansion,
						grouping,
						treeData,
						detail,
						defaultRowHeight,
						rowHeightsRecord,
						getRowHeight,
						pagination: input.pagination,
					};
		if (cached && flattenKey && this.lastFlattenKey && sameFlattenKey(this.lastFlattenKey, flattenKey) && this.lastOutput?.roots === roots) {
			return this.lastOutput;
		}
		this.lastFlattenKey = flattenKey;

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
		// Built on first read: the client row model keeps positions on RowNodes and never asks.
		const finalRows = visualRows;
		let rowIdToVisualIndex: Map<string, number> | undefined;
		const rowIndex = (): Map<string, number> => {
			if (!rowIdToVisualIndex) {
				const map = (rowIdToVisualIndex = new Map<string, number>());
				finalRows.forEach((row, idx) => {
					if (row.kind === 'data' && !map.has(row.rowId)) map.set(row.rowId, idx);
				});
			}
			return rowIdToVisualIndex;
		};
		let rowIdToVisualRowIds: Map<string, string[]> | undefined;
		let groupCount = 0;
		let detailRowCount = 0;
		let loadingRowCount = 0;
		visualRows.forEach((row, idx) => {
			// Data rows are found through rowIdToVisualIndex (their visual id derives from the row id).
			if (row.kind === 'data') return;
			visualRowIdToIndex.set(row.id, idx);
			if (row.kind === 'detail') {
				rowIdToVisualRowIds ??= new Map<string, string[]>();
				const parentRowId = row.parentRowId ?? row.parentId;
				const ids = rowIdToVisualRowIds.get(parentRowId) ?? [];
				// A data row's visual id is derived from its row id.
				const dataVisualRowId = rowIndex().has(parentRowId) ? toDataVisualRowId(parentRowId) : undefined;
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

		const output: RowPipelineOutput<TData> = {
			visualRows,
			visualRowIdToIndex,
			get rowIdToVisualIndex() {
				return rowIndex();
			},
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
		this.lastOutput = input.dataVersion === undefined ? null : output;
		return output;
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

export function computeGroupMeta<TData>(visualRows: VisualRow<TData>[]): {
	byId: Map<string, GroupRowMeta>;
	byVisualIndex: Map<number, GroupRowMeta>;
} {
	const byId = new Map<string, GroupRowMeta>();
	const byVisualIndex = new Map<number, GroupRowMeta>();
	const stack: GroupRowMeta[] = [];

	// A data row only updates the innermost open group; a closing group hands its leaf range to its
	// parent. One write per data row instead of one per ancestor.
	const close = (closing: GroupRowMeta, lastIndex: number) => {
		if (closing.firstChildIndex !== -1) closing.lastChildIndex = lastIndex;
		const parent = stack[stack.length - 1];
		if (parent && closing.firstLeafIndex !== -1) {
			if (parent.firstLeafIndex === -1) parent.firstLeafIndex = closing.firstLeafIndex;
			parent.lastLeafIndex = closing.lastLeafIndex;
		}
	};

	for (let i = 0; i < visualRows.length; i++) {
		const row = visualRows[i];
		if (row.kind === 'group') {
			// Close groups on the stack that are at same or deeper depth than this new group.
			while (stack.length > 0 && stack[stack.length - 1].level >= row.hierarchy.level) close(stack.pop()!, i - 1);
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
		} else if (row.kind === 'data' && stack.length > 0) {
			const group = stack[stack.length - 1];
			if (group.firstLeafIndex === -1) group.firstLeafIndex = i;
			group.lastLeafIndex = i;
		}
	}
	// Close any groups still open at end of list.
	while (stack.length > 0) close(stack.pop()!, visualRows.length - 1);

	return { byId, byVisualIndex };
}

function collectDataNodes<TData>(root: RowTreeNode<TData>): RowNode<TData>[] {
	if (root.kind === 'data') {
		return [root.node, ...(root.children ?? []).flatMap((child) => collectDataNodes(child))];
	}
	return root.children.flatMap((child) => collectDataNodes(child));
}
