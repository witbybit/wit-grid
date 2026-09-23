export type EventDoc = {
	name: string;
	category:
		| 'Lifecycle'
		| 'Interaction'
		| 'Editing'
		| 'Columns'
		| 'Rows'
		| 'Filtering'
		| 'Grouping'
		| 'Server Data'
		| 'Validation'
		| 'Workspace'
		| 'Diagnostics';
	when: string;
	payload: string;
	reactCallback?: string;
};

export const eventDocs: EventDoc[] = [
	{
		name: 'onGridReady',
		category: 'Lifecycle',
		when: 'After the React Grid creates its GridApi instance.',
		payload: '{ api, rowModelType }',
		reactCallback: '<Grid onGridReady={(event) => ...} />',
	},
	{
		name: 'cellClicked',
		category: 'Interaction',
		when: 'When a rendered cell is clicked through the interaction surface.',
		payload: 'GridCellClickParams<TRowData>',
		reactCallback: '<Grid onCellClick={(params) => ...} />',
	},
	{
		name: 'focusChanged',
		category: 'Interaction',
		when: 'When the focused cell or selection state changes.',
		payload: '{ focus, selection }',
	},
	{
		name: 'selectionChanged',
		category: 'Interaction',
		when: 'When the cell/range selection model changes.',
		payload: '{ selection, result }',
	},
	{
		name: 'rowSelectionChanged',
		category: 'Interaction',
		when: 'When row selection changes.',
		payload: 'RowSelectionChangeResult',
	},
	{
		name: 'editStarted',
		category: 'Editing',
		when: 'When cell editing begins.',
		payload: '{ rowId, colField }',
	},
	{
		name: 'editStopped',
		category: 'Editing',
		when: 'When cell editing stops or is cancelled.',
		payload: '{ rowId, colField, cancel }',
	},
	{
		name: 'cellValueChanged',
		category: 'Editing',
		when: 'When a committed cell value changes.',
		payload: '{ rowId, colField, oldValue, newValue }',
		reactCallback: '<Grid onCellValueChanged={(event) => ...} />',
	},
	{
		name: 'writeBlocked',
		category: 'Editing',
		when: 'When edit, paste, or fill work is rejected by validation, capabilities, or commit rules.',
		payload: '{ source, status, reason, cells, rowCount, colCount, issues? }',
		reactCallback: '<Grid onWriteBlocked={(event) => ...} />',
	},
	{
		name: 'cellsCopied',
		category: 'Editing',
		when: 'When the clipboard controller copies grid cells.',
		payload: '{ cells, rowCount, colCount, text }',
	},
	{
		name: 'cellsPasted',
		category: 'Editing',
		when: 'When pasted text is applied to the grid.',
		payload: '{ rowCount, colCount }',
	},
	{
		name: 'columnResized',
		category: 'Columns',
		when: 'When a column width changes.',
		payload: '{ colField, width }',
	},
	{
		name: 'columnOrderChanged',
		category: 'Columns',
		when: 'When columns are reordered.',
		payload: '{ columns, columnFields }',
	},
	{
		name: 'columnsChanged',
		category: 'Columns',
		when: 'When the column definition set changes.',
		payload: '{ columns, columnFields }',
	},
	{
		name: 'rowsUpdated',
		category: 'Rows',
		when: 'When row data changes through the store.',
		payload: '{ changedValuesByRow, changedNodes, addedNodes?, removedNodes? }',
	},
	{
		name: 'rowResized',
		category: 'Rows',
		when: 'When a row receives an explicit runtime height.',
		payload: '{ rowId, height }',
	},
	{
		name: 'rowOrderChanged',
		category: 'Rows',
		when: 'When managed row drag changes row order.',
		payload: '{ rowIds }',
	},
	{
		name: 'filterChanged',
		category: 'Filtering',
		when: 'When the structured filter model changes.',
		payload: '{ filterModel }',
	},
	{
		name: 'quickFilterChanged',
		category: 'Filtering',
		when: 'When the quick filter model changes.',
		payload: '{ quickFilterModel }',
	},
	{
		name: 'sortChanged',
		category: 'Filtering',
		when: 'When the sort model changes.',
		payload: '{ sortModel }',
	},
	{
		name: 'queryModelChanged',
		category: 'Filtering',
		when: 'When the advanced query model changes.',
		payload: '{ queryModel }',
	},
	{
		name: 'groupByChanged',
		category: 'Grouping',
		when: 'When the grouped column list changes.',
		payload: '{ groupBy }',
	},
	{
		name: 'groupColumnAdded',
		category: 'Grouping',
		when: 'When a column is added to the grouping model.',
		payload: '{ colId, index, groupBy }',
	},
	{
		name: 'groupColumnRemoved',
		category: 'Grouping',
		when: 'When a column is removed from the grouping model.',
		payload: '{ colId, groupBy }',
	},
	{
		name: 'paginationChanged',
		category: 'Rows',
		when: 'When the active page, page size, page count, or total row count changes.',
		payload: '{ page, pageCount, totalRows, pageSize }',
	},
	{
		name: 'infiniteBlockLoaded',
		category: 'Server Data',
		when: 'When an infinite row model block finishes loading.',
		payload: '{ blockIndex, loadedBlockStart, loadedBlockEnd, totalRecords, durationMs }',
	},
	{
		name: 'infiniteBlockLoadFailed',
		category: 'Server Data',
		when: 'When an infinite row model block request fails.',
		payload: '{ blockIndex, startRow, endRow, message }',
	},
	{
		name: 'serverSideStateChanged',
		category: 'Server Data',
		when: 'When the server-side row model loading/error/store state changes.',
		payload: '{ loading, error, storeStates }',
	},
	{
		name: 'cellValidationChanged',
		category: 'Validation',
		when: 'When a cell validation result changes.',
		payload: '{ rowId, colField, error }',
	},
	{
		name: 'gridValidated',
		category: 'Validation',
		when: 'When grid-level validation completes.',
		payload: '{ errors, hasErrors }',
	},
	{
		name: 'viewSaved',
		category: 'Workspace',
		when: 'When a named workspace view is saved.',
		payload: '{ view }',
	},
	{
		name: 'viewApplied',
		category: 'Workspace',
		when: 'When a saved workspace view is applied.',
		payload: '{ view }',
	},
	{
		name: 'workspaceStateChanged',
		category: 'Workspace',
		when: 'When workspace state changes.',
		payload: '{ state }',
	},
	{
		name: 'renderInvalidated',
		category: 'Diagnostics',
		when: 'When the render layer is explicitly invalidated.',
		payload: '{ reason }',
	},
	{
		name: 'runtimeFault',
		category: 'Diagnostics',
		when: 'When the runtime fault reporter captures an isolated fault.',
		payload: 'RuntimeFault',
	},
];

export const eventUsageCode = `import { Grid, GridEventName, type GridApi } from '@eregister/wit-grid-react';

function OrdersGrid() {
  const [api, setApi] = useState<GridApi<OrderRow> | null>(null);

  useEffect(() => {
    if (!api) return;
    return api.addEventListener(GridEventName.cellValueChanged, ({ payload }) => {
      audit.log('grid.cellValueChanged', payload);
    });
  }, [api]);

  return (
    <Grid
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      onGridReady={({ api }) => setApi(api)}
      onCellValueChanged={(event) => audit.log('react.cellValueChanged', event)}
    />
  );
}`;
