import { describe, expect, it } from 'vitest';
import type { GridApi } from './GridApi.js';
import { createClientGrid, createInfiniteGrid, createServerSideGrid } from '../createGrid.js';

/**
 * Every member the public GridApi declares. `satisfies` keeps the list and the type in step: a
 * member added to or removed from the interface without this list is a compile error.
 */
const PUBLIC_API_MEMBERS = {
	addEventListener: true,
	addGroupBy: true,
	applyColumnState: true,
	applyGridState: true,
	applyRowSelectionGesture: true,
	applyView: true,
	autoSizeAllColumns: true,
	autoSizeColumn: true,
	can: true,
	canCopy: true,
	canEdit: true,
	canExport: true,
	canPaste: true,
	canRedo: true,
	canUndo: true,
	clearFormula: true,
	clearPersistedState: true,
	clearRowSelection: true,
	clearRuntimeFaults: true,
	closeChart: true,
	closePanel: true,
	collapseAll: true,
	commitEdit: true,
	copyRange: true,
	copySelectedRange: true,
	deleteView: true,
	deselectRows: true,
	destroy: true,
	dispatchEvent: true,
	duplicateView: true,
	evaluateQueryForRow: true,
	expandAll: true,
	exportCsv: true,
	exportExcel: true,
	extendSelection: true,
	flushCellUpdatesSync: true,
	flushTransactions: true,
	forEachDisplayedNode: true,
	forEachNode: true,
	getAggregation: true,
	getAvailableThemes: true,
	getCellValue: true,
	getColumnDef: true,
	getColumnDistinctValueSummary: true,
	getColumnDistinctValues: true,
	getColumnField: true,
	getColumnIndex: true,
	getColumnState: true,
	getColumns: true,
	getContainer: true,
	getCsv: true,
	getDataRowAtVisualIndex: true,
	getDescendantRowIds: true,
	getDescendantSelection: true,
	getDetail: true,
	getDisplayedColumns: true,
	getDisplayedRowAtIndex: true,
	getExcel: true,
	getFormula: true,
	getGridState: true,
	getGroupBy: true,
	getGrouping: true,
	getHierarchyColumn: true,
	getInsightDiagnostics: true,
	getInstrumentation: true,
	getOpenPanel: true,
	getPersistenceStatus: true,
	getPinnedColumns: true,
	getQuickFilter: true,
	getRawRowById: true,
	getRowId: true,
	getRowIndexById: true,
	getRowLoadState: true,
	getRowModelCapabilities: true,
	getRowModelType: true,
	getRowNode: true,
	getRowOrder: true,
	getRuntimeFaults: true,
	getSelectedRowCount: true,
	getSelectedRowIds: true,
	getServerSideStoreState: true,
	getStateSnapshot: true,
	getTheme: true,
	getThemeName: true,
	getTreeData: true,
	getVisibleColumnRange: true,
	getVisibleRowRange: true,
	getWorkspaceState: true,
	hasFormula: true,
	hasPersistence: true,
	hasWorkspace: true,
	integrity: true,
	isAutoSaveEnabled: true,
	isChartOpen: true,
	isDetailOpen: true,
	isExpanded: true,
	isRowLoading: true,
	isRowNodeSelected: true,
	listViews: true,
	mergeTheme: true,
	moveColumn: true,
	moveGroupBy: true,
	onThemeChange: true,
	openChart: true,
	openPanel: true,
	pasteFromClipboard: true,
	purgeCache: true,
	purgeServerSide: true,
	redo: true,
	refreshRows: true,
	refreshServerSide: true,
	removeGroupBy: true,
	renameView: true,
	revertView: true,
	rows: true,
	saveNow: true,
	saveView: true,
	scrollToCell: true,
	scrollToRow: true,
	selectAllRows: true,
	selectCell: true,
	selectRange: true,
	selectRows: true,
	setAggregation: true,
	setAutoSave: true,
	setCellValue: true,
	setColumnOrder: true,
	setColumnReorderEnabled: true,
	setColumnVisible: true,
	setColumnWidth: true,
	setColumns: true,
	setColumnsVisible: true,
	setDefaultRowHeight: true,
	setDefaultView: true,
	setDescendantsSelected: true,
	setDetail: true,
	setDetailOpen: true,
	setExpanded: true,
	setFilterModel: true,
	setFormula: true,
	setGroupBy: true,
	setGrouping: true,
	setHierarchyColumn: true,
	setInfiniteDatasource: true,
	setInstrumentation: true,
	setPinnedColumns: true,
	setQueryModel: true,
	setQuickFilter: true,
	setRowAnimation: true,
	setRowHeight: true,
	setRowHeights: true,
	setRowOrder: true,
	setRows: true,
	setServerSideDatasource: true,
	setShowFilterChipBar: true,
	setShowMinimap: true,
	setView: true,
	getView: true,
	setMinimapMarks: true,
	setShowFloatingFilters: true,
	setShowGroupPanel: true,
	setSortModel: true,
	setStyleRules: true,
	setPresence: true,
	getPresence: true,
	flashCells: true,
	setTheme: true,
	setTreeData: true,
	startEditing: true,
	stopEditing: true,
	subscribe: true,
	subscribeDomain: true,
	subscribeToCell: true,
	subscribeToDomainVersions: true,
	subscribeToIntegrity: true,
	subscribeToKey: true,
	subscribeToPersistenceStatus: true,
	subscribeToSnapshotSelector: true,
	subscribeToWorkspaceState: true,
	supportsRowModelCapability: true,
	switchTheme: true,
	toggleChart: true,
	toggleDetailOpen: true,
	toggleExpanded: true,
	togglePanel: true,
	toggleRowSelection: true,
	transaction: true,
	undo: true,
	updateEditDraft: true,
	updateGrouping: true,
	updateView: true,
} satisfies Record<keyof GridApi<unknown>, true>;

const MEMBERS = Object.keys(PUBLIC_API_MEMBERS) as (keyof GridApi<unknown>)[];

interface Row {
	id: string;
	name: string;
}

const columns = [{ field: 'name', header: 'Name' }];
const datasource = { getRows: () => new Promise<never>(() => {}) };

const GRIDS: [string, () => GridApi<Row>][] = [
	['client', () => createClientGrid<Row>({ rows: [{ id: '1', name: 'Ava' }], columns })],
	['infinite', () => createInfiniteGrid<Row>({ columns, getRowId: (row) => row.id, datasource })],
	['server-side', () => createServerSideGrid<Row>({ columns, getRowId: (row) => row.id, datasource })],
];

describe('the public GridApi at runtime', () => {
	it.each(GRIDS)('%s grid: every declared member exists, and nothing undeclared', (_name, create) => {
		const api = create() as unknown as Record<string, unknown>;
		expect(MEMBERS.filter((member) => api[member] === undefined)).toEqual([]);
		expect(Object.keys(api).filter((key) => !(key in PUBLIC_API_MEMBERS))).toEqual([]);
		(api as unknown as GridApi<Row>).destroy();
	});

	it('forwarded members work through the api', () => {
		const api = createClientGrid<Row>({
			rows: [
				{ id: '1', name: 'Ava' },
				{ id: '2', name: 'Liam' },
			],
			columns,
		});
		expect(api.getRowNode('2')?.data).toEqual({ id: '2', name: 'Liam' });
		expect(api.getDisplayedRowAtIndex(0)?.id).toBe('1');
		expect(api.getRowIndexById('2')).toBe(1);
		const shown: string[] = [];
		api.forEachDisplayedNode((node) => shown.push(node.id));
		expect(shown).toEqual(['1', '2']);
		api.selectRows(['2']);
		expect(api.getSelectedRowCount()).toBe(1);
		expect(api.isRowNodeSelected('2')).toBe(true);
		expect(api.canEdit('1', 'name')).toBe(true);
		expect(api.can('sort', { colField: 'name' }).allowed).toBe(true);
		api.setQueryModel({
			version: 1,
			root: {
				kind: 'group',
				id: 'root',
				operator: 'and',
				children: [{ kind: 'condition', id: 'c', columnId: 'name', filter: { type: 'text', operator: 'equals', value: 'Liam' } }],
			},
		});
		expect(api.evaluateQueryForRow('2')).toBe(true);
		expect(api.evaluateQueryForRow('1')).toBe(false);
		api.destroy();
	});
});
