import { GridEventName } from '../api/GridEvents.js';
import type { InvalidationManager } from '../renderer/invalidationManager.js';
import type { GridFeatureContext } from './GridFeatureContext.js';
import {
	asRowExpansionCapableModel,
	asRowExpansionStateReadableModel,
	type ExpandAllOptions,
	type SetExpandedOptions,
	type RowModel,
	type RowExpansionCapableModel,
	type RowModelRefreshResult,
} from '../rowModel.js';
import type { GridCapabilityAction, GridCapabilityParams, GridCapabilityResult } from '../capabilities/capabilityTypes.js';
import {
	freezeAggregationConfig,
	freezeDetailConfig,
	freezeGroupingConfig,
	freezeTreeDataConfig,
	groupByColIds,
	type AggregationDef,
	type DetailConfig,
	type ExpansionState,
	type GroupDef,
	type GroupingConfig,
	type HierarchyColumnConfig,
	type TreeDataConfig,
} from '../rows/hierarchyConfig.js';
import type { GridInvalidation } from '../renderer/invalidationManager.js';
import type { GridCommitEvent } from '../engine/GridChangeApplier.js';
import type { GridDomainVersions } from '../state/GridDomainVersions.js';
import type { GridStateUpdater, InternalGridState } from '../state/GridState.js';
import { syncHierarchyColumn } from '../rows/hierarchyColumn.js';
import { asRowHierarchyReadableModel } from '../rowModel.js';
import type { DescendantSelection, HierarchyIndex } from '../rows/hierarchyIndex.js';
import { readInteractionState } from '../interaction/interactionState.js';

export interface GroupingFeatureControllerDeps<TRowData = unknown> {
	ctx: GridFeatureContext<TRowData>;
	getRowModel: () => RowModel<TRowData> | null;
	invalidation: InvalidationManager;
	requestRender?: (reason: string) => void;
	checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;
	/** New row version for a row whose UI state (detail open) changed, so its renderer cells redraw. */
	notifyRowStateChanged?: (rowId: string) => void;
}

/** A hierarchy configuration change restructures rows: geometry, rows, headers and overlays all follow. */
const STRUCTURAL_INVALIDATIONS = (reason: string): GridInvalidation[] => [
	{ kind: 'geometry', reason },
	{ kind: 'viewport', reason },
	{ kind: 'headers', reason },
	{ kind: 'overlay', reason },
];

/** Group ids change with the levels, so their expansion choices go; tree-row choices stay. */
function withoutGroupOverrides(expansion: ExpansionState): ExpansionState {
	const rows: Record<string, boolean> = {};
	for (const id in expansion.rows) if (!id.startsWith('group:')) rows[id] = expansion.rows[id];
	return { ...expansion, rows };
}

export class GroupingFeatureController<TRowData = unknown> {
	private readonly ctx: GridFeatureContext<TRowData>;
	private readonly getRowModel: () => RowModel<TRowData> | null;
	private readonly invalidation: InvalidationManager;
	private readonly requestRender: (reason: string) => void;
	private readonly checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;
	private readonly notifyRowStateChanged?: (rowId: string) => void;

	constructor(deps: GroupingFeatureControllerDeps<TRowData>) {
		this.ctx = deps.ctx;
		this.getRowModel = deps.getRowModel;
		this.invalidation = deps.invalidation;
		this.requestRender = deps.requestRender ?? (() => {});
		this.checkCapability = deps.checkCapability;
		this.notifyRowStateChanged = deps.notifyRowStateChanged;
	}

	private getExpansionCapableRowModel(): RowExpansionCapableModel<TRowData> | null {
		return asRowExpansionCapableModel(this.getRowModel());
	}

	public applyRowModelRefreshInvalidation(result: RowModelRefreshResult | void, reason: 'group expansion' | 'detail', groupId?: string): void {
		if (!result?.changed) return;

		const targetGroupId = result.groupId ?? groupId;
		if (targetGroupId) {
			this.invalidation.invalidateGroup(targetGroupId, reason);
		}
		if (result.changedStartIndex !== undefined && result.changedEndIndex !== undefined) {
			this.invalidation.invalidateRowRange(result.changedStartIndex, result.changedEndIndex, reason);
		}
		for (const index of result.aggregateChangedIndices ?? []) this.invalidation.invalidateRowRange(index, index, reason);
		if (result.previousRowCount !== result.nextRowCount) {
			this.invalidation.invalidateGeometry(reason);
		}
		this.invalidation.invalidateViewport(reason);
		this.requestRender(reason);
	}

	// ── Grouping configuration ──────────────────────────────────────────────

	public getGrouping(): GroupingConfig<TRowData> | undefined {
		return this.ctx.getState().grouping;
	}

	public setGrouping(next: GroupingConfig<TRowData> | undefined): void {
		const grouping = freezeGroupingConfig(next);
		const state = this.ctx.getState();
		const levelsChanged = !sameColIds(groupByColIds(state.grouping), groupByColIds(grouping));
		this.ctx.applyChange({
			reason: 'grouping:set',
			...this.withHierarchyColumn(
				{ grouping, ...(levelsChanged ? { expansion: withoutGroupOverrides(state.expansion) } : {}) },
				STRUCTURAL_INVALIDATIONS('grouping'),
				['rows', 'geometry']
			),
			events: levelsChanged
				? [
						{ type: GridEventName.groupingChanged, payload: { grouping } },
						{ type: GridEventName.groupByChanged, payload: { groupBy: groupByColIds(grouping) } },
					]
				: [{ type: GridEventName.groupingChanged, payload: { grouping } }],
		});
	}

	public updateGrouping(patch: Partial<GroupingConfig<TRowData>>): void {
		this.setGrouping({ by: [], ...this.ctx.getState().grouping, ...patch });
	}

	public getGroupBy(): string[] {
		return groupByColIds(this.ctx.getState().grouping);
	}

	public setGroupBy(by: ReadonlyArray<string | GroupDef<TRowData>>): void {
		if (this.checkCapability) {
			const denied = by.some((entry) => !this.checkCapability!('group', { colField: typeof entry === 'string' ? entry : entry.colId }).allowed);
			if (denied) return;
		}
		const current = this.ctx.getState().grouping;
		// A bare column id keeps the GroupDef it already has (its keyCreator / comparator).
		const existing = new Map<string, string | GroupDef<TRowData>>((current?.by ?? []).map((entry) => [colIdOf(entry), entry]));
		const next = by.map((entry) => (typeof entry === 'string' ? (existing.get(entry) ?? entry) : entry));
		this.commitGroupBy(next, 'grouping:set-group-by', []);
	}

	public addGroupBy(colId: string, atIndex?: number): void {
		if (this.checkCapability && !this.checkCapability('group', { colField: colId }).allowed) return;
		const current = this.ctx.getState().grouping?.by ?? [];
		if (groupByColIds(this.ctx.getState().grouping).includes(colId)) return;
		const next = [...current];
		const insertAt = atIndex !== undefined ? Math.max(0, Math.min(next.length, atIndex)) : next.length;
		next.splice(insertAt, 0, colId);
		this.commitGroupBy(next, 'grouping:add-group-by', [
			{ type: GridEventName.groupColumnAdded, payload: { colId, index: insertAt, groupBy: next.map(colIdOf) } },
		]);
	}

	public removeGroupBy(colId: string): void {
		const current = this.ctx.getState().grouping?.by ?? [];
		const next = current.filter((entry) => colIdOf(entry) !== colId);
		if (next.length === current.length) return;
		this.commitGroupBy(next, 'grouping:remove-group-by', [
			{ type: GridEventName.groupColumnRemoved, payload: { colId, groupBy: next.map(colIdOf) } },
		]);
	}

	public moveGroupBy(colId: string, toIndex: number): void {
		const current = this.ctx.getState().grouping?.by ?? [];
		const fromIndex = current.findIndex((entry) => colIdOf(entry) === colId);
		if (fromIndex === -1) return;
		const next = [...current];
		const [moved] = next.splice(fromIndex, 1);
		const boundedTo = Math.max(0, Math.min(next.length, toIndex));
		if (boundedTo === fromIndex) return;
		next.splice(boundedTo, 0, moved);
		this.commitGroupBy(next, 'grouping:move-group-by', [
			{ type: GridEventName.groupColumnMoved, payload: { colId, fromIndex, toIndex: boundedTo, groupBy: next.map(colIdOf) } },
		]);
	}

	private commitGroupBy(
		by: Array<string | GroupDef<TRowData>>,
		reason: 'grouping:set-group-by' | 'grouping:add-group-by' | 'grouping:remove-group-by' | 'grouping:move-group-by',
		extraEvents: GridCommitEvent<TRowData>[]
	): void {
		const state = this.ctx.getState();
		const grouping = freezeGroupingConfig({ ...state.grouping, by })!;
		const groupBy = by.map(colIdOf);
		this.ctx.applyChange({
			reason,
			...this.withHierarchyColumn({ grouping, expansion: withoutGroupOverrides(state.expansion) }, STRUCTURAL_INVALIDATIONS('groupBy'), [
				'rows',
			]),
			events: [
				{ type: GridEventName.groupingChanged, payload: { grouping } },
				{ type: GridEventName.groupByChanged, payload: { groupBy } },
				...extraEvents,
			],
		});
	}

	public setShowGroupPanel(enabled: boolean): void {
		this.ctx.applyChange({
			reason: 'grouping:set-panel',
			state: { showGroupPanel: enabled },
			invalidations: [
				{ kind: 'geometry', reason: 'showGroupPanel' },
				{ kind: 'viewport', reason: 'showGroupPanel' },
				{ kind: 'headers', reason: 'showGroupPanel' },
			],
			domains: ['geometry'],
		});
	}

	// ── Hierarchy column ────────────────────────────────────────────────────

	public getHierarchyColumn(): HierarchyColumnConfig<TRowData> | false | undefined {
		return this.ctx.getState().hierarchyColumn;
	}

	public setHierarchyColumn(hierarchyColumn: HierarchyColumnConfig<TRowData> | false | undefined): void {
		this.ctx.applyChange({
			reason: 'hierarchy:set-column',
			...this.withHierarchyColumn({ hierarchyColumn }, [{ kind: 'headers', reason: 'hierarchyColumn' }], ['columns']),
			events: [{ type: GridEventName.hierarchyColumnChanged, payload: { hierarchyColumn } }],
		});
	}

	/**
	 * Adds the hierarchy column change (columns + pinned count) implied by a hierarchy config change
	 * to the same commit, so the column appears, updates or goes in step with the rows.
	 */
	private withHierarchyColumn(
		patch: Partial<Pick<InternalGridState<TRowData>, 'grouping' | 'treeData' | 'hierarchyColumn' | 'expansion'>>,
		invalidations: GridInvalidation[],
		domains: ReadonlyArray<keyof GridDomainVersions>
	): { state: GridStateUpdater<TRowData>; invalidations: GridInvalidation[]; domains: ReadonlyArray<keyof GridDomainVersions> } {
		const state = this.ctx.getState();
		const synced = syncHierarchyColumn({
			columns: state.columns,
			pinnedColumns: state.pinnedColumns,
			grouping: 'grouping' in patch ? patch.grouping : state.grouping,
			treeData: 'treeData' in patch ? patch.treeData : state.treeData,
			hierarchyColumn: 'hierarchyColumn' in patch ? patch.hierarchyColumn : state.hierarchyColumn,
		});
		if (!synced.changed) return { state: patch, invalidations, domains };
		return {
			state: { ...patch, columns: synced.columns, pinnedColumns: synced.pinnedColumns },
			invalidations: [{ kind: 'full', reason: 'hierarchyColumn' }],
			domains: [...new Set([...domains, 'columns', 'geometry'] as Array<keyof GridDomainVersions>)],
		};
	}

	// ── Tree data, aggregation, detail ─────────────────────────────────────

	public getTreeData(): TreeDataConfig<TRowData> | undefined {
		return this.ctx.getState().treeData;
	}

	public setTreeData(next: TreeDataConfig<TRowData> | undefined): void {
		const treeData = freezeTreeDataConfig(next);
		const state = this.ctx.getState();
		this.ctx.applyChange({
			reason: 'hierarchy:set-tree-data',
			...this.withHierarchyColumn(
				{ treeData, expansion: { ...state.expansion, rows: {}, base: undefined } },
				STRUCTURAL_INVALIDATIONS('treeData'),
				['rows', 'geometry']
			),
			events: [{ type: GridEventName.treeDataChanged, payload: { treeData } }],
		});
	}

	public getAggregation(): AggregationDef<TRowData>[] {
		return this.ctx.getState().aggregation?.defs ?? [];
	}

	public setAggregation(defs: AggregationDef<TRowData>[]): void {
		const aggregation = defs.length > 0 ? freezeAggregationConfig({ defs }) : undefined;
		this.ctx.applyChange({
			reason: 'hierarchy:set-aggregation',
			state: { aggregation },
			invalidations: STRUCTURAL_INVALIDATIONS('aggregation'),
			domains: ['rows'],
			events: [{ type: GridEventName.aggregationChanged, payload: { defs: aggregation?.defs ?? [] } }],
		});
	}

	public getDetail(): DetailConfig<TRowData> | undefined {
		return this.ctx.getState().detail;
	}

	public setDetail(next: DetailConfig<TRowData> | undefined): void {
		const detail = freezeDetailConfig(next);
		const state = this.ctx.getState();
		this.ctx.applyChange({
			reason: 'hierarchy:set-detail',
			state: { detail, ...(detail ? {} : { expansion: { ...state.expansion, details: {} } }) },
			invalidations: STRUCTURAL_INVALIDATIONS('detail'),
			domains: ['rows', 'geometry'],
			events: [{ type: GridEventName.detailChanged, payload: { detail } }],
		});
	}

	// ── Expansion ─────────────────────────────────────────────────────────

	public isExpanded(id: string): boolean {
		return asRowExpansionStateReadableModel(this.getRowModel())?.isExpanded(id) ?? false;
	}

	public setExpanded(id: string, expanded: boolean, options?: SetExpandedOptions): void {
		const result = this.getExpansionCapableRowModel()?.setExpanded(id, expanded, options);
		this.applyRowModelRefreshInvalidation(result, 'group expansion', id);
		if (result?.changed) this.dispatchExpansionChanged({ target: 'row', id, expanded });
	}

	public toggleExpanded(id: string): void {
		this.setExpanded(id, !this.isExpanded(id));
	}

	public expandAll(options?: ExpandAllOptions): void {
		const result = this.getExpansionCapableRowModel()?.expandAll(options);
		this.applyRowModelRefreshInvalidation(result, 'group expansion');
		if (result?.changed) this.dispatchExpansionChanged({ target: 'all', id: null, expanded: true, maxLevel: options?.maxLevel });
	}

	public collapseAll(): void {
		const result = this.getExpansionCapableRowModel()?.collapseAll();
		this.applyRowModelRefreshInvalidation(result, 'group expansion');
		if (result?.changed) this.dispatchExpansionChanged({ target: 'all', id: null, expanded: false });
	}

	public isDetailOpen(rowId: string): boolean {
		return asRowExpansionStateReadableModel(this.getRowModel())?.isDetailOpen(rowId) ?? false;
	}

	public setDetailOpen(rowId: string, open: boolean): void {
		const result = this.getExpansionCapableRowModel()?.setDetailOpen(rowId, open);
		this.applyRowModelRefreshInvalidation(result, 'detail');
		// The row's own cells show its open state (a toggle renderer reads it): redraw them even when the
		// row does not move.
		if (result?.changed) {
			this.notifyRowStateChanged?.(rowId);
			this.invalidation.invalidateRow(rowId, 'detail');
		}
		if (result?.changed) this.dispatchExpansionChanged({ target: 'detail', id: rowId, expanded: open });
	}

	public toggleDetailOpen(rowId: string): void {
		this.setDetailOpen(rowId, !this.isDetailOpen(rowId));
	}

	// ── Hierarchy selection ─────────────────────────────────────────────────

	private selectionCache: {
		index: HierarchyIndex;
		selectedRowIds: readonly string[];
		set: ReadonlySet<string>;
		byId: Map<string, DescendantSelection>;
	} | null = null;

	/** Data rows beneath a group or tree row (visual row id), collapsed and off-page rows included; filtered-out rows excluded. */
	public getDescendantRowIds(id: string): readonly string[] {
		return asRowHierarchyReadableModel(this.getRowModel())?.getHierarchyIndex()?.getDescendantRowIds(id) ?? [];
	}

	/**
	 * `all` / `some` / `none` of a group's or tree parent's descendant rows are selected. Cached per
	 * hierarchy and selection state, so every group row can ask on every paint.
	 */
	public getDescendantSelection(id: string): DescendantSelection {
		const index = asRowHierarchyReadableModel(this.getRowModel())?.getHierarchyIndex();
		if (!index) return { state: 'none', selected: 0, total: 0 };
		const selectedRowIds = readInteractionState(this.ctx.getState()).rowSelection.selectedRowIds;
		let cache = this.selectionCache;
		if (!cache || cache.index !== index || cache.selectedRowIds !== selectedRowIds) {
			cache = this.selectionCache = { index, selectedRowIds, set: new Set(selectedRowIds), byId: new Map() };
		}
		let result = cache.byId.get(id);
		if (!result) cache.byId.set(id, (result = index.countSelected(id, cache.set)));
		return result;
	}

	private dispatchExpansionChanged(payload: { target: 'row' | 'detail' | 'all'; id: string | null; expanded: boolean; maxLevel?: number }): void {
		this.ctx.applyChange({ reason: 'rows:update-expansion', events: [{ type: GridEventName.expansionChanged, payload }] });
	}
}

function colIdOf<TRowData>(entry: string | GroupDef<TRowData>): string {
	return typeof entry === 'string' ? entry : entry.colId;
}

function sameColIds(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i]);
}
