import type { GridPluginRuntime } from '../api/GridApi.js';
import { memberNames, pickMembers, type MemberNames } from '../internal/memberNames.js';

/** Every member of the plugin surface. The compile-time check below keeps this list equal to `GridPluginRuntime`. */
const PLUGIN_RUNTIME_MEMBERS = `
	getStateSnapshot getRowId isRowLoading getDataRowAtVisualIndex setRows transaction flushTransactions
	refreshRows setRowHeights setDefaultRowHeight getRowModelType getRowModelCapabilities
	supportsRowModelCapability purgeCache setInfiniteDatasource setServerSideDatasource refreshServerSide
	purgeServerSide getServerSideStoreState getCellValue getFormula hasFormula setFormula clearFormula
	getCellAccessByPointer setCellValue getRowNode getDisplayedRowAtIndex getRowIndexById forEachNode
	forEachDisplayedNode getRowLoadState selectCell selectRange extendSelection applyRowSelectionGesture
	selectRows deselectRows toggleRowSelection selectAllRows clearRowSelection getSelectedRowIds
	isRowNodeSelected getSelectedRowCount setColumns setColumnWidth autoSizeColumn autoSizeAllColumns
	getColumnDistinctValues getColumnDistinctValueSummary copySelectedRange pasteFromClipboard copyRange
	setColumnVisible setColumnsVisible getColumns getDisplayedColumns setPinnedColumns getPinnedColumns
	moveColumn setColumnOrder setColumnReorderEnabled setRowHeight setSortModel setFilterModel getQuickFilter
	setQuickFilter setQueryModel evaluateQueryForRow setStyleRules setGroupBy
	getGroupBy addGroupBy removeGroupBy moveGroupBy getGrouping setGrouping updateGrouping getTreeData
	setTreeData getAggregation setAggregation getHierarchyColumn setHierarchyColumn getDetail setDetail
	setExpanded toggleExpanded isExpanded expandAll collapseAll setDetailOpen toggleDetailOpen isDetailOpen
	getDescendantRowIds getDescendantSelection setDescendantsSelected setShowGroupPanel setRowAnimation setShowFloatingFilters
	setShowFilterChipBar getRawRowById rows addEventListener dispatchEvent startEditing updateEditDraft
	stopEditing commitEdit getColumnState applyColumnState getGridState applyGridState subscribe subscribeToKey
	subscribeToSnapshotSelector subscribeToIntegrity subscribeToCell subscribeToDomainVersions subscribeDomain
	getColumnIndex getColumnField getColumnDef undo redo canUndo canRedo openPanel closePanel togglePanel
	getOpenPanel openChart closeChart toggleChart isChartOpen exportCsv getCsv exportExcel getExcel hasPersistence clearPersistedState
	setAutoSave isAutoSaveEnabled getPersistenceStatus subscribeToPersistenceStatus saveNow hasWorkspace
	getWorkspaceState subscribeToWorkspaceState listViews saveView updateView applyView revertView deleteView duplicateView
	renameView setDefaultView getRuntimeFaults clearRuntimeFaults flushCellUpdatesSync getInstrumentation
	setInstrumentation reportRuntimeFault getTheme getThemeName getAvailableThemes switchTheme mergeTheme
	setTheme onThemeChange getContainer destroy getCellState getCheapDisplayValue getVisualRow getVisualRowCount
	getVisualIndexByRowId getVisibleRowRange getRowModel integrity getVisibleColumnRange getRowOrder setRowOrder
	can canEdit canCopy canPaste canExport scrollToRow scrollToCell getInsightDiagnostics`;

type PluginRuntimeMember = MemberNames<typeof PLUGIN_RUNTIME_MEMBERS>;
type MissingFromList = Exclude<keyof GridPluginRuntime, PluginRuntimeMember>;
type NotOnSurface = Exclude<PluginRuntimeMember, keyof GridPluginRuntime>;
const _surfaceMatchesList: [MissingFromList, NotOnSurface] extends [never, never] ? true : never = true;
void _surfaceMatchesList;

const pluginRuntimeMembers = memberNames(PLUGIN_RUNTIME_MEMBERS);

/** The plugin surface of `source`: exactly the members plugins may use, none of the host's other internals. */
export function createGridPluginRuntime<TRowData>(source: GridPluginRuntime<TRowData>): GridPluginRuntime<TRowData> {
	return pickMembers(source, pluginRuntimeMembers);
}
