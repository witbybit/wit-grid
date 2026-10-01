import { GridEventName } from '../api/GridEvents.js';
import type { StateManager } from '../state/StateManager.js';
import type { SortModel, FilterModel, QuickFilterModel } from '../rowModel.js';
import type { RowModel } from '../rowModel.js';
import type { GridQueryModel } from '../query/GridQueryModel.js';
import type { GridCommit, GridCommitResult } from '../engine/GridChangeApplier.js';
import type { InternalGridState } from '../state/GridState.js';
import type { GridCapabilityAction, GridCapabilityParams, GridCapabilityResult } from '../capabilities/capabilityTypes.js';

export interface GridStateFeatureControllerDeps<TRowData = unknown> {
	stateManager: StateManager<TRowData>;
	applyChange: (change: GridCommit<TRowData>) => GridCommitResult;
	getRowModel?: () => RowModel<TRowData> | null;
	checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;
}

export class GridStateFeatureController<TRowData = unknown> {
	private readonly checkCapability?: (action: GridCapabilityAction, params: Partial<GridCapabilityParams<TRowData>>) => GridCapabilityResult;

	constructor(private readonly deps: GridStateFeatureControllerDeps<TRowData>) {
		this.checkCapability = deps.checkCapability;
	}

	public getRowOverscanPx(): number {
		return this.deps.stateManager.getState().rowOverscanPx ?? 400;
	}

	public setRowOverscanPx(px: number): void {
		this.deps.applyChange({
			reason: 'ui:set-row-overscan',
			state: { rowOverscanPx: px },
			requestRender: false,
		});
	}

	public getColBuffer(): number {
		return this.deps.stateManager.getState().colBuffer ?? 2;
	}

	public setColBuffer(colBuffer: number): void {
		this.deps.applyChange({
			reason: 'ui:set-col-buffer',
			state: { colBuffer },
			requestRender: false,
		});
	}

	public setStyleRules(styleRules: InternalGridState<TRowData>['styleRules']): void {
		this.deps.applyChange({
			reason: 'ui:set-style-rules',
			state: { styleRules },
			invalidations: [
				{ kind: 'viewport', reason: 'style rules' },
				{ kind: 'headers', reason: 'style rules' },
				{ kind: 'overlay', reason: 'style rules' },
			],
			requestRender: true,
		});
	}

	public setShowFloatingFilters(enabled: boolean): void {
		if (this.deps.stateManager.getState().showFloatingFilters === enabled) return;
		this.deps.applyChange({
			reason: 'ui:set-floating-filters',
			state: { showFloatingFilters: enabled },
			invalidations: [
				{ kind: 'geometry', reason: 'showFloatingFilters' },
				{ kind: 'viewport', reason: 'showFloatingFilters' },
				{ kind: 'headers', reason: 'showFloatingFilters' },
			],
			requestRender: true,
		});
	}

	public setShowFilterChipBar(enabled: boolean): void {
		if ((this.deps.stateManager.getState().showFilterChipBar ?? false) === enabled) return;
		this.deps.applyChange({
			reason: 'ui:set-filter-chip-bar',
			state: { showFilterChipBar: enabled },
			invalidations: [
				{ kind: 'geometry', reason: 'showFilterChipBar' },
				{ kind: 'viewport', reason: 'showFilterChipBar' },
				{ kind: 'headers', reason: 'showFilterChipBar' },
			],
			domains: ['geometry'],
			requestRender: true,
		});
	}

	public setSidebarOpenPanel(panelId: string | null): void {
		if (this.deps.stateManager.getState().sidebarOpenPanel === panelId) return;
		this.deps.applyChange({
			reason: 'ui:set-sidebar-panel',
			state: { sidebarOpenPanel: panelId },
			requestRender: false,
		});
	}

	public setChartOpen(chartOpen: boolean): void {
		if ((this.deps.stateManager.getState().chartOpen ?? false) === chartOpen) return;
		this.deps.applyChange({
			reason: 'ui:set-chart-open',
			state: { chartOpen },
			requestRender: false,
		});
	}

	public setThemeName(themeName: InternalGridState<TRowData>['themeName']): void {
		if (this.deps.stateManager.getState().themeName === themeName) return;
		this.deps.applyChange({
			reason: 'ui:set-theme',
			state: { themeName },
			requestRender: false,
		});
	}

	public resizeRow(rowId: string, height: number, undoable = true): void {
		const state = this.deps.stateManager.getState();
		const oldHeight = state.rowHeights[rowId] ?? state.defaultRowHeight;
		if (oldHeight === height) return;
		this.applyRowHeight(rowId, height, undoable ? oldHeight : null);
	}

	/**
	 * Applies DOM-measured row heights from one renderer delivery in a single commit.
	 * Measurements are deliberately not recorded in history, but retain the same row
	 * resize events as individual non-undoable resizeRow calls so renderer anchoring and
	 * row-level invalidation continue to work.
	 */
	/** `baseline`: the height a row has before any measurement is recorded (default: the grid row height). */
	public applyAutoRowHeightBatch(measuredHeights: ReadonlyMap<string, number>, baseline?: (rowId: string) => number | undefined): void {
		if (measuredHeights.size === 0) return;

		const state = this.deps.stateManager.getState();
		const nextRowHeights = { ...state.rowHeights };
		const changed: Array<{ rowId: string; height: number }> = [];
		for (const [rowId, height] of measuredHeights) {
			const currentHeight = state.rowHeights[rowId] ?? baseline?.(rowId) ?? state.defaultRowHeight;
			if (Math.abs(height - currentHeight) <= 1) continue;
			nextRowHeights[rowId] = height;
			changed.push({ rowId, height });
		}
		if (changed.length === 0) return;

		this.deps.applyChange({
			reason: 'geometry:resize-row',
			state: { rowHeights: nextRowHeights },
			invalidations: [
				{ kind: 'geometry', reason: 'row resize' },
				...changed.map(({ rowId }) => ({ kind: 'row' as const, rowId, reason: 'row resize' })),
			],
			domains: ['geometry'],
			events: changed.map(({ rowId, height }) => ({ type: GridEventName.rowResized as const, payload: { rowId, height } })),
			requestRender: true,
		});
	}

	public setRowHeights(rowHeights: Record<string, number>): void {
		this.deps.applyChange({
			reason: 'geometry:set-row-heights',
			state: { rowHeights },
			invalidations: [
				{ kind: 'geometry', reason: 'row heights' },
				{ kind: 'viewport', reason: 'row heights' },
			],
			domains: ['geometry'],
			requestRender: true,
		});
	}

	public setDefaultRowHeight(defaultRowHeight: number): void {
		this.deps.applyChange({
			reason: 'geometry:set-default-row-height',
			state: { defaultRowHeight },
			invalidations: [
				{ kind: 'geometry', reason: 'default row height' },
				{ kind: 'viewport', reason: 'default row height' },
			],
			domains: ['geometry'],
			requestRender: true,
		});
	}

	public setSortModel(sortModel: SortModel | null, undoable = true): void {
		if (this.checkCapability) {
			const result = this.checkCapability('sort', {});
			if (!result.allowed) return;
		}
		const oldSort = this.deps.stateManager.getState().sortModel;
		const hasRowModel = this.deps.getRowModel?.() != null;
		const forwardInvalidations = hasRowModel ? [] : [{ kind: 'headers', reason: 'sort' } as const, { kind: 'full', reason: 'sort' } as const];
		this.deps.applyChange({
			reason: 'rows:set-sort-model',
			state: { sortModel },
			invalidations: forwardInvalidations,
			domains: ['rows', 'sorting'],
			events: [{ type: GridEventName.sortChanged, payload: { sortModel } }],
			history: undoable
				? {
						undo: {
							reason: 'rows:set-sort-model',
							state: { sortModel: oldSort },
							invalidations: forwardInvalidations,
							domains: ['rows', 'sorting'],
							events: [{ type: GridEventName.sortChanged, payload: { sortModel: oldSort } }],
							requestRender: !hasRowModel,
						},
						redo: {
							reason: 'rows:set-sort-model',
							state: { sortModel },
							invalidations: forwardInvalidations,
							domains: ['rows', 'sorting'],
							events: [{ type: GridEventName.sortChanged, payload: { sortModel } }],
							requestRender: !hasRowModel,
						},
					}
				: undefined,
			requestRender: !hasRowModel,
		});
	}

	public setFilterModel(filterModel: FilterModel | null, undoable = true): void {
		if (this.checkCapability) {
			const result = this.checkCapability('filter', {});
			if (!result.allowed) return;
		}
		const oldFilter = this.deps.stateManager.getState().filterModel;
		const hasRowModel = this.deps.getRowModel?.() != null;
		const forwardInvalidations = hasRowModel ? [] : [{ kind: 'full' } as const];
		this.deps.applyChange({
			reason: 'rows:set-filter-model',
			state: { filterModel },
			invalidations: forwardInvalidations,
			domains: ['rows', 'filtering'],
			events: [{ type: GridEventName.filterChanged, payload: { filterModel } }],
			history: undoable
				? {
						undo: {
							reason: 'rows:set-filter-model',
							state: { filterModel: oldFilter },
							invalidations: forwardInvalidations,
							domains: ['rows', 'filtering'],
							events: [{ type: GridEventName.filterChanged, payload: { filterModel: oldFilter } }],
							requestRender: !hasRowModel,
						},
						redo: {
							reason: 'rows:set-filter-model',
							state: { filterModel },
							invalidations: forwardInvalidations,
							domains: ['rows', 'filtering'],
							events: [{ type: GridEventName.filterChanged, payload: { filterModel } }],
							requestRender: !hasRowModel,
						},
					}
				: undefined,
			requestRender: !hasRowModel,
		});
	}

	/**
	 * Not undoable by default — a search box typically changes on every keystroke, and putting
	 * each intermediate value on the undo stack would make undo/redo useless for anything else.
	 */
	public setQuickFilterModel(quickFilterModel: QuickFilterModel | null): void {
		if (this.checkCapability) {
			const result = this.checkCapability('filter', {});
			if (!result.allowed) return;
		}
		const hasRowModel = this.deps.getRowModel?.() != null;
		const forwardInvalidations = hasRowModel ? [] : [{ kind: 'full' } as const];
		this.deps.applyChange({
			reason: 'rows:set-quick-filter-model',
			state: { quickFilterModel },
			invalidations: forwardInvalidations,
			domains: ['rows', 'filtering'],
			events: [{ type: GridEventName.quickFilterChanged, payload: { quickFilterModel } }],
			requestRender: !hasRowModel,
		});
	}

	public setQueryModel(queryModel: GridQueryModel | null): void {
		const oldQueryModel = this.deps.stateManager.getState().queryModel;
		this.deps.applyChange({
			reason: 'rows:set-query-model',
			state: { queryModel },
			invalidations: [{ kind: 'full' }],
			domains: ['rows', 'filtering'],
			events: [{ type: GridEventName.queryModelChanged, payload: { queryModel } }],
			history: {
				undo: {
					reason: 'rows:set-query-model',
					state: { queryModel: oldQueryModel },
					invalidations: [{ kind: 'full' }],
					domains: ['rows', 'filtering'],
					events: [{ type: GridEventName.queryModelChanged, payload: { queryModel: oldQueryModel } }],
					requestRender: true,
				},
				redo: {
					reason: 'rows:set-query-model',
					state: { queryModel },
					invalidations: [{ kind: 'full' }],
					domains: ['rows', 'filtering'],
					events: [{ type: GridEventName.queryModelChanged, payload: { queryModel } }],
					requestRender: true,
				},
			},
			requestRender: true,
		});
	}

	public setPaginationPage(page: number, metrics?: { pageCount: number; totalRows: number }): void {
		const state = this.deps.stateManager.getState();
		const current = state.pagination;
		if (!current) return;
		const nextPage = Math.max(0, page);
		if (current.page === nextPage) return;
		const payload = {
			page: nextPage,
			pageCount: metrics?.pageCount ?? 0,
			totalRows: metrics?.totalRows ?? 0,
			pageSize: current.pageSize,
		};
		this.deps.applyChange({
			reason: 'rows:set-pagination-page',
			state: { pagination: { pageSize: current.pageSize, page: nextPage } },
			domains: ['rows'],
			events: [{ type: GridEventName.paginationChanged, payload }],
			invalidations: [{ kind: 'full', reason: 'pagination' }],
			requestRender: true,
		});
	}

	private applyRowHeight(rowId: string, height: number, undoHeight: number | null = null): void {
		this.deps.applyChange({
			reason: 'geometry:resize-row',
			state: (state) => ({ rowHeights: { ...state.rowHeights, [rowId]: height } }),
			invalidations: [{ kind: 'geometry' }, { kind: 'row', rowId, reason: 'row resize' }],
			domains: ['geometry'],
			events: [{ type: GridEventName.rowResized, payload: { rowId, height } }],
			history:
				undoHeight === null
					? undefined
					: {
							undo: {
								reason: 'geometry:resize-row',
								state: (state) => ({ rowHeights: { ...state.rowHeights, [rowId]: undoHeight } }),
								invalidations: [{ kind: 'geometry' }, { kind: 'row', rowId, reason: 'row resize' }],
								domains: ['geometry'],
								events: [{ type: GridEventName.rowResized, payload: { rowId, height: undoHeight } }],
								requestRender: true,
							},
							redo: {
								reason: 'geometry:resize-row',
								state: (state) => ({ rowHeights: { ...state.rowHeights, [rowId]: height } }),
								invalidations: [{ kind: 'geometry' }, { kind: 'row', rowId, reason: 'row resize' }],
								domains: ['geometry'],
								events: [{ type: GridEventName.rowResized, payload: { rowId, height } }],
								requestRender: true,
							},
						},
			requestRender: true,
		});
	}
}
