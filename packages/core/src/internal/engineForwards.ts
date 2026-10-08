import type { GridEngine } from '../engine/GridEngine.js';
import { memberNames, type MemberNames } from './memberNames.js';

/**
 * Store members that are a plain call into the engine: same arguments, same result, no logic.
 * They are declared here once and bound onto the store, instead of a hand-written
 * `x = (a, b) => this.engine.x(a, b)` per member in the store, the runtime composition and the plugin runtime.
 *
 * A member is either listed by name (the engine method has that same name) or mapped:
 * `name: 'engineMethod'` or `name: ['engineField', 'method']`.
 */
type EngineMethodName = keyof GridEngine<unknown>;
type EngineForwardSpec = EngineMethodName | readonly [EngineMethodName, string];

interface EngineForwardTable<Same extends string, Mapped extends Record<string, EngineForwardSpec>> {
	same: Same;
	mapped: Mapped;
}

function forwardTable<const Same extends string, const Mapped extends Record<string, EngineForwardSpec>>(
	same: Same,
	mapped: Mapped
): EngineForwardTable<Same, Mapped> {
	return { same, mapped };
}

type ResolveSpec<TRowData, Spec> = Spec extends readonly [infer Field extends EngineMethodName, infer Method]
	? Method extends keyof GridEngine<TRowData>[Field]
		? GridEngine<TRowData>[Field][Method]
		: never
	: Spec extends EngineMethodName
		? GridEngine<TRowData>[Spec]
		: never;

export type EngineForwards<TRowData, Table> =
	Table extends EngineForwardTable<infer Same, infer Mapped>
		? { -readonly [K in MemberNames<Same> & keyof GridEngine<TRowData>]: GridEngine<TRowData>[K] } & {
				-readonly [K in keyof Mapped]: ResolveSpec<TRowData, Mapped[K]>;
			}
		: never;

/** Forwards that are also members of the public GridApi. */
export const PUBLIC_ENGINE_FORWARDS = forwardTable(
	`getRowId isRowLoading getFormula hasFormula setCellValue autoSizeColumn autoSizeAllColumns
	getColumnDistinctValues getColumnDistinctValueSummary copyRange getDisplayedColumns getPinnedColumns
	moveColumn setColumnReorderEnabled setSortModel setFilterModel setGroupBy addGroupBy removeGroupBy
	moveGroupBy setShowGroupPanel setRowAnimation setShowFloatingFilters setShowFilterChipBar setShowMinimap setMinimapMarks setStyleRules setPresence getPresence flashCells addEventListener
	dispatchEvent setRowOrder flushTransactions subscribeToDomainVersions subscribeDomain getColumnIndex
	getColumnField getColumnDef flushCellUpdatesSync undo redo setQueryModel`,
	{
		getCellValue: 'getCellDisplayValue',
		setColumnWidth: 'resizeColumn',
		setColumnOrder: 'setColumnOrderByFields',
		setRowHeight: 'resizeRow',
		openPanel: 'setSidebarOpenPanel',
		getColumnState: ['columnFeature', 'getColumnState'],
		canUndo: ['commandHistory', 'canUndo'],
		canRedo: ['commandHistory', 'canRedo'],
		getGrouping: ['groupingFeature', 'getGrouping'],
		setGrouping: ['groupingFeature', 'setGrouping'],
		updateGrouping: ['groupingFeature', 'updateGrouping'],
		getGroupBy: ['groupingFeature', 'getGroupBy'],
		getTreeData: ['groupingFeature', 'getTreeData'],
		setTreeData: ['groupingFeature', 'setTreeData'],
		getAggregation: ['groupingFeature', 'getAggregation'],
		setAggregation: ['groupingFeature', 'setAggregation'],
		getHierarchyColumn: ['groupingFeature', 'getHierarchyColumn'],
		setHierarchyColumn: ['groupingFeature', 'setHierarchyColumn'],
		getDetail: ['groupingFeature', 'getDetail'],
		setDetail: ['groupingFeature', 'setDetail'],
		setExpanded: ['groupingFeature', 'setExpanded'],
		toggleExpanded: ['groupingFeature', 'toggleExpanded'],
		isExpanded: ['groupingFeature', 'isExpanded'],
		expandAll: ['groupingFeature', 'expandAll'],
		collapseAll: ['groupingFeature', 'collapseAll'],
		setDetailOpen: ['groupingFeature', 'setDetailOpen'],
		toggleDetailOpen: ['groupingFeature', 'toggleDetailOpen'],
		isDetailOpen: ['groupingFeature', 'isDetailOpen'],
		getDescendantRowIds: ['groupingFeature', 'getDescendantRowIds'],
		getDescendantSelection: ['groupingFeature', 'getDescendantSelection'],
	}
);

/** Forwards the store keeps for the renderer, the plugin runtime and the interaction controller only. */
export const INTERNAL_ENGINE_FORWARDS = forwardTable(
	`getState getCachedDisplayValue getCheapDisplayValue getComputedCellValue setRowOverscanPx
	registerRowModel getRowModel registerCellSubscription unregisterCellSubscription updateCellSubscription`,
	{}
);

export const PUBLIC_ENGINE_FORWARD_NAMES = forwardNames(PUBLIC_ENGINE_FORWARDS);

function forwardNames<Same extends string, Mapped extends Record<string, EngineForwardSpec>>(
	table: EngineForwardTable<Same, Mapped>
): readonly (MemberNames<Same> | (keyof Mapped & string))[] {
	return [...memberNames(table.same), ...Object.keys(table.mapped)] as (MemberNames<Same> | (keyof Mapped & string))[];
}

/** Binds every forward in `table` to `engine`. */
export function bindEngineForwards<TRowData, Table extends EngineForwardTable<string, Record<string, EngineForwardSpec>>>(
	engine: GridEngine<TRowData>,
	table: Table
): EngineForwards<TRowData, Table> {
	const bound: Record<string, unknown> = {};
	const bind = (name: string, owner: object, method: string): void => {
		bound[name] = (owner as Record<string, (...args: unknown[]) => unknown>)[method].bind(owner);
	};
	for (const name of memberNames(table.same)) bind(name, engine, name);
	for (const [name, spec] of Object.entries(table.mapped)) {
		if (typeof spec === 'string') bind(name, engine, spec);
		else bind(name, (engine as unknown as Record<string, object>)[spec[0]], spec[1]);
	}
	return bound as EngineForwards<TRowData, Table>;
}
