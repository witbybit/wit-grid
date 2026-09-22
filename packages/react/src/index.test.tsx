// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(cleanup);
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { createClientGrid, type ClientGridOptions, type ColumnDef } from '@eregister/wit-grid-core';
import * as ReactPackage from './index.js';
import { GridProvider } from './gridContext.js';
import { GridView } from './GridView.js';
import { GridEventName, Grid, useGridKeySelector, useGridApi, useGridSelector } from './index.js';
import { PortalCell, PortalManager, createPortalStore } from './GridPortal.js';
import { FormulaBar } from './FormulaBar.js';

// Mock ResizeObserver for jsdom environment
class MockResizeObserver {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}
globalThis.ResizeObserver = MockResizeObserver;

interface TestRow {
	id: string;
	name: string;
}

function createTestGrid<TRowData>(options: ClientGridOptions<TRowData>) {
	return {
		api: createClientGrid(options),
	};
}

function makeInternalNode<TRowData>(id: string, data: TRowData) {
	return { id, data };
}

const SelectorInspector = () => {
	const focused = useGridSelector((s) => s.selection.focus);
	const dataVersion = useGridKeySelector('globalVersion', (s) => s.globalVersion);
	const api = useGridApi<TestRow>();

	return (
		<div>
			<span data-testid='focused-cell'>{focused ? `${focused.rowId}:${focused.colField}` : 'none'}</span>
			<span data-testid='data-version'>{dataVersion}</span>
			<span data-testid='api-exists'>{api ? 'yes' : 'no'}</span>
		</div>
	);
};

const ApiSurfaceInspector = () => {
	const api = useGridApi<TestRow>();
	return (
		<div>
			<span data-testid='api-frozen'>{Object.isFrozen(api) ? 'yes' : 'no'}</span>
			<span data-testid='api-engine'>{'engine' in (api as unknown as Record<string, unknown>) ? 'yes' : 'no'}</span>
			<span data-testid='api-register-row-model'>{'registerRowModel' in (api as unknown as Record<string, unknown>) ? 'yes' : 'no'}</span>
			<button data-testid='move-column' onClick={() => api.moveColumn('name', 0)}>
				Move
			</button>
			<button data-testid='disable-reorder' onClick={() => api.setColumnReorderEnabled(false)}>
				Disable
			</button>
		</div>
	);
};

describe('React Adapter (v2 API and Architecture)', () => {
	it('should provide context and support selector hooks', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		render(
			<GridProvider api={grid.api}>
				<SelectorInspector />
			</GridProvider>
		);

		expect(screen.getByTestId('api-exists').textContent).toBe('yes');
		expect(screen.getByTestId('focused-cell').textContent).toBe('none');
		expect(screen.getByTestId('data-version').textContent).toBe('2');

		act(() => {
			grid.api.selectCell({ rowId: '1', colField: 'name' });
		});
		expect(screen.getByTestId('focused-cell').textContent).toBe('1:name');

		act(() => {
			grid.api.setRows([{ id: '1', name: 'Product B' }]);
		});
		expect(screen.getByTestId('data-version').textContent).toBe('3');

		grid.api.destroy();
	});

	it('should expose a frozen public API facade instead of the mutable store internals', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [
				{ field: 'id', header: 'ID', width: 50 },
				{ field: 'name', header: 'Name', width: 100 },
			],
		});

		render(
			<GridProvider api={grid.api}>
				<ApiSurfaceInspector />
			</GridProvider>
		);

		expect(screen.getByTestId('api-frozen').textContent).toBe('yes');
		expect(screen.getByTestId('api-engine').textContent).toBe('no');
		expect(screen.getByTestId('api-register-row-model').textContent).toBe('no');

		fireEvent.click(screen.getByTestId('move-column'));
		expect(grid.api.getStateSnapshot().columns.map((column) => column.field)).toEqual(['name', 'id']);

		fireEvent.click(screen.getByTestId('disable-reorder'));
		expect(grid.api.getStateSnapshot().enableColumnReorder).toBe(false);

		grid.api.destroy();
	});

	it('should render custom cell renderer via PortalCell', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					renderer: {
						kind: 'react',
						component: ({ value }: { value: any }) => <span data-testid='custom-renderer'>{String(value)}!!!</span>,
					},
				},
			],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={false} isLoading={false} />
			</GridProvider>
		);

		expect(screen.getByTestId('custom-renderer').textContent).toBe('Product A!!!');
		grid.api.destroy();
	});

	it('should pass lifecycle metadata to custom cell renderers', () => {
		const rendererProps: Record<string, unknown>[] = [];
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					renderer: {
						kind: 'react',
						component: (props: any) => {
							rendererProps.push(props as unknown as Record<string, unknown>);
							return <span data-testid='custom-renderer-phase'>{String(props.phase)}</span>;
						},
					},
				},
			],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		render(
			<GridProvider api={grid.api}>
				<PortalCell
					rowId='1'
					colField='name'
					value='Product A'
					col={colDef}
					node={node}
					isEditing={false}
					isLoading={false}
					phase='scroll-idle'
					isScrolling={false}
				/>
			</GridProvider>
		);

		expect(screen.getByTestId('custom-renderer-phase').textContent).toBe('scroll-idle');
		expect(rendererProps[0]).toEqual(
			expect.objectContaining({
				colId: 'name',
				phase: 'scroll-idle',
				isScrolling: false,
				isEditing: false,
				isFocused: false,
			})
		);
		grid.api.destroy();
	});

	it('should render default text input when editing and no custom editor via PortalCell', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.value).toBe('Product A');

		fireEvent.change(input, { target: { value: 'Product B' } });
		expect(grid.api.getStateSnapshot().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				draftValue: 'Product B',
				originalValue: 'Product A',
				startedBy: 'api',
				version: expect.any(Number),
			})
		);
		fireEvent.blur(input);

		await waitFor(() => expect(grid.api.getCellValue('1', 'name')).toBe('Product B'));
		grid.api.destroy();
	});

	it('should not commit an in-progress edit just because the portal unmounts', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		const rendered = render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = within(rendered.container).getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Product B' } });
		rendered.unmount();

		expect(grid.api.getCellValue('1', 'name')).toBe('Product A');
		grid.api.destroy();
	});

	it('should commit an in-progress edit when editStopped is dispatched without cancellation', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		const rendered = render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = within(rendered.container).getByRole('textbox') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Product B' } });

		act(() => {
			grid.api.stopEditing(false);
		});

		await waitFor(() => expect(grid.api.getCellValue('1', 'name')).toBe('Product B'));
		grid.api.destroy();
	});

	it('should render custom cell editor via PortalCell', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellEditor: ({ value, onChange, onCommit }) => (
						<input
							data-testid='custom-editor'
							value={String(value)}
							onChange={(e) => onChange(e.target.value)}
							onBlur={() => onCommit()}
						/>
					),
				},
			],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByTestId('custom-editor') as HTMLInputElement;
		expect(input).toBeDefined();
		expect(input.value).toBe('Product A');

		fireEvent.change(input, { target: { value: 'Product B' } });
		expect(grid.api.getStateSnapshot().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				draftValue: 'Product B',
				originalValue: 'Product A',
				startedBy: 'api',
				version: expect.any(Number),
			})
		);
		fireEvent.blur(input);

		await waitFor(() => expect(grid.api.getCellValue('1', 'name')).toBe('Product B'));
		grid.api.destroy();
	});

	it('should commit custom cell editors immediately on Enter from the portal shell', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellEditor: ({ value, onChange }) => (
						<div data-testid='custom-editor-root' tabIndex={0}>
							<input data-testid='custom-editor-input' value={String(value)} onChange={(e) => onChange(e.target.value)} />
						</div>
					),
				},
			],
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByTestId('custom-editor-input') as HTMLInputElement;

		fireEvent.change(input, { target: { value: 'Product B' } });
		fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(grid.api.getCellValue('1', 'name')).toBe('Product B');
			expect(grid.api.getStateSnapshot().activeEdit).toBeNull();
		});

		grid.api.destroy();
	});

	it('keeps advanced editors on the canonical blocked-write path when validation rejects the commit', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					cellEditor: ({ value, onChange, onCommit }) => (
						<input
							data-testid='validated-editor'
							value={String(value)}
							onChange={(e) => onChange(e.target.value)}
							onBlur={() => onCommit()}
						/>
					),
				},
			],
			dataIntegrity: {
				validation: {
					validateOnSubmit: true,
					cellRules: [{ id: 'required-name', field: 'name', validate: ({ value }) => (value ? null : { message: 'Name is required' }) }],
				},
			},
		});

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });
		const blockedHandler = vi.fn();
		grid.api.addEventListener(GridEventName.writeBlocked, blockedHandler);

		act(() => {
			grid.api.startEditing('1', 'name');
		});

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={colDef} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByTestId('validated-editor') as HTMLInputElement;
		fireEvent.change(input, { target: { value: '' } });
		fireEvent.blur(input);

		await waitFor(() => {
			expect(grid.api.getCellValue('1', 'name')).toBe('Product A');
			expect(grid.api.getStateSnapshot().activeEdit).toEqual(
				expect.objectContaining({ rowId: '1', colField: 'name', colId: 'name', columnInstanceId: expect.any(String) })
			);
		});
		expect(blockedHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					source: 'edit',
					status: 'validationFailed',
				}),
			})
		);

		grid.api.destroy();
	});

	it('should render portals inside PortalManager', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					renderer: { kind: 'react', component: ({ value }: { value: any }) => <span data-testid='portal-content'>{String(value)}</span> },
				},
			],
		});

		const container = document.createElement('div');
		document.body.appendChild(container);

		const colDef = grid.api.getColumnDef('name')!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		const store = createPortalStore<TestRow>();
		store.mountCell('1:name', container, 'Product A', node, colDef, false, false, undefined, undefined, undefined, undefined, {
			rowSlotId: 'slot-1',
			slotGeneration: 1,
		});

		render(<PortalManager store={store} api={grid.api} />);

		expect(screen.getByTestId('portal-content').textContent).toBe('Product A');

		document.body.removeChild(container);
		grid.api.destroy();
	});

	it('should render only the latest cell portal for a recycled container', () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: '1', name: 'Old' },
				{ id: '2', name: 'New' },
			],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					renderer: { kind: 'react', component: ({ value }: { value: any }) => <span data-testid='portal-content'>{String(value)}</span> },
				},
			],
		});
		const container = document.createElement('div');
		document.body.appendChild(container);
		const colDef = grid.api.getColumnDef('name')!;

		const store = createPortalStore<TestRow>();
		store.mountCell(
			'1:name',
			container,
			'Old',
			makeInternalNode('1', { id: '1', name: 'Old' }),
			colDef,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				rowSlotId: 'slot-1',
				slotGeneration: 1,
			}
		);
		store.mountCell(
			'2:name',
			container,
			'New',
			makeInternalNode('2', { id: '2', name: 'New' }),
			colDef,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				rowSlotId: 'slot-1',
				slotGeneration: 2,
			}
		);

		render(<PortalManager store={store} api={grid.api} />);

		expect(screen.getAllByTestId('portal-content')).toHaveLength(1);
		expect(screen.getByTestId('portal-content').textContent).toBe('New');

		document.body.removeChild(container);
		grid.api.destroy();
	});

	it('should replace recycled cell portal store entries without retaining stale container owners', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: '1', name: 'Old' },
				{ id: '2', name: 'New' },
			],
			columns: [{ field: 'name', header: 'Name', width: 100, renderer: { kind: 'react', component: () => null } }],
		});
		const store = createPortalStore<TestRow>();
		const container = document.createElement('div');
		const colDef = grid.api.getColumnDef('name')!;

		store.mountCell(
			'1:name',
			container,
			'Old',
			makeInternalNode('1', { id: '1', name: 'Old' }),
			colDef,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				rowSlotId: 'slot-1',
				slotGeneration: 1,
			}
		);
		store.mountCell(
			'2:name',
			container,
			'New',
			makeInternalNode('2', { id: '2', name: 'New' }),
			colDef,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				rowSlotId: 'slot-1',
				slotGeneration: 2,
			}
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(store.getCellSnapshot().cellPortalList.map((p) => p.cellKey)).toEqual(['2:name']);

		store.unmountCell('1:name', container);
		await act(async () => {
			await Promise.resolve();
		});
		expect(store.getCellSnapshot().cellPortalList.map((p) => p.cellKey)).toEqual(['2:name']);

		grid.api.destroy();
	});

	it('should update cell data without triggering structural listeners', async () => {
		const store = createPortalStore<TestRow>();
		const structuralListener = vi.fn();
		store.subscribeCells(structuralListener);

		const cellListener = vi.fn();
		const cellKey = '1:name';
		const container = document.createElement('div');
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const colDef = grid.api.getColumnDef('name')!;

		// Mount cell first (structural change)
		store.mountCell(
			cellKey,
			container,
			'Old',
			makeInternalNode('1', { id: '1', name: 'Product A' }),
			colDef,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				rowSlotId: 'slot-1',
				slotGeneration: 1,
			}
		);
		await act(async () => {
			await Promise.resolve();
		});
		expect(structuralListener).toHaveBeenCalledTimes(1);

		// Subscribe to cell
		const unsubscribeCell = store.subscribeToCell!(cellKey, cellListener);

		// Update cell data only (non-structural change)
		store.mountCell(
			cellKey,
			container,
			'New',
			makeInternalNode('1', { id: '1', name: 'Product A' }),
			colDef,
			false,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			{
				rowSlotId: 'slot-1',
				slotGeneration: 2,
			}
		);

		// The structural listener should NOT have fired again (remains 1)
		expect(structuralListener).toHaveBeenCalledTimes(1);
		// But the cell-specific listener SHOULD have been called
		expect(cellListener).toHaveBeenCalledTimes(1);

		// Clean up
		unsubscribeCell();
		grid.api.destroy();
	});

	it('should fire onCellValueChanged with old and new value when a cell is edited', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Original' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const onCellValueChanged = vi.fn();

		render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} onCellValueChanged={onCellValueChanged} />
			</GridProvider>
		);

		act(() => {
			grid.api.setCellValue('1', 'name', 'Updated');
		});

		expect(onCellValueChanged).toHaveBeenCalledTimes(1);
		expect(onCellValueChanged).toHaveBeenCalledWith({
			rowId: '1',
			colField: 'name',
			oldValue: 'Original',
			newValue: 'Updated',
		});

		grid.api.destroy();
	});

	it('should stop firing onCellValueChanged after GridView unmounts', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Cell Content' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const onCellValueChanged = vi.fn();

		const { unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} onCellValueChanged={onCellValueChanged} />
			</GridProvider>
		);

		unmount();

		act(() => {
			grid.api.setCellValue('1', 'name', 'After unmount');
		});

		expect(onCellValueChanged).not.toHaveBeenCalled();
		grid.api.destroy();
	});

	it('should keep custom renderer portals mounted when renderer column layout changes', async () => {
		// This test verifies the cycle: custom renderer columns visible → replace with native columns → restore
		// custom renderer columns. Uses the same code path (releaseAll + full repaint) as a column reorder.
		const customColumns: ColumnDef<{ id: string; severity: string; service: string }>[] = [
			{
				field: 'severity',
				header: 'Severity',
				width: 120,
				renderer: {
					kind: 'react',
					component: ({ value }: { value: any }) => <span data-testid='severity-renderer'>{String(value)}</span>,
				},
			},
			{
				field: 'service',
				header: 'Service',
				width: 120,
				renderer: {
					kind: 'react',
					component: ({ value }: { value: any }) => <span data-testid='service-renderer'>{String(value)}</span>,
				},
			},
		];
		const nativeColumns: ColumnDef<{ id: string; severity: string; service: string }>[] = [
			{ field: 'severity', header: 'Severity', width: 120 },
			{ field: 'service', header: 'Service', width: 120 },
		];

		const grid = createTestGrid<{ id: string; severity: string; service: string }>({
			rows: [{ id: '1', severity: 'CRITICAL', service: 'Auth' }],
			columns: customColumns,
			getRowId: (row) => row.id,
		});

		const { unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} />
			</GridProvider>
		);

		// Initial render: React renderer portals are mounted and show their values.
		await screen.findByTestId('severity-renderer');
		await screen.findByTestId('service-renderer');
		expect(screen.getByTestId('severity-renderer').textContent).toBe('CRITICAL');
		expect(screen.getByTestId('service-renderer').textContent).toBe('Auth');

		// Switch to native columns — portals are released, native text appears.
		act(() => {
			grid.api.setColumns(nativeColumns);
		});
		// waitFor lets the event loop advance (RAF fires → fullPaint → portals released → React re-renders).
		// Using findByText('CRITICAL') would resolve immediately from the still-mounted portal (same text),
		// so we poll for the portal's *absence* instead, which requires the async release cycle to complete.
		await waitFor(() => {
			expect(screen.queryByTestId('severity-renderer')).toBeNull();
			expect(screen.queryByTestId('service-renderer')).toBeNull();
		});
		expect(screen.getByText('CRITICAL')).toBeTruthy();
		expect(screen.getByText('Auth')).toBeTruthy();

		// Restore custom renderer columns — portals must be re-mounted with correct values.
		act(() => {
			grid.api.setColumns(customColumns);
		});
		await waitFor(() => {
			expect(screen.getByTestId('severity-renderer').textContent).toBe('CRITICAL');
			expect(screen.getByTestId('service-renderer').textContent).toBe('Auth');
		});

		unmount();
		grid.api.destroy();
	});

	it('should expose precise cell click params and dispatch cellClicked event', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const onCellClick = vi.fn();
		const eventListener = vi.fn();
		const unsubscribe = grid.api.addEventListener(GridEventName.cellClicked, eventListener);

		const { container, unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} onCellClick={onCellClick} />
			</GridProvider>
		);

		await waitFor(() => {
			expect(container.querySelector('.og-cell[data-col-field="name"]')).not.toBeNull();
		});

		fireEvent.click(container.querySelector('.og-cell[data-col-field="name"]')!);

		expect(onCellClick).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: '1',
				rowIndex: 0,
				row: { id: '1', name: 'Product A' },
				colField: 'name',
				colIndex: 0,
				value: 'Product A',
				api: grid.api,
			})
		);
		expect(eventListener).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'cellClicked',
				payload: expect.objectContaining({ rowId: '1', colField: 'name' }),
			})
		);

		unsubscribe();
		unmount();
		grid.api.destroy();
	});

	it('should preserve duplicate-field column identity in cell click params', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{ field: 'name', header: 'Name A', width: 100, colId: 'name-a' },
				{ field: 'name', header: 'Name B', width: 100, colId: 'name-b' },
			],
		});
		const onCellClick = vi.fn();

		const { container, unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} onCellClick={onCellClick} />
			</GridProvider>
		);

		await waitFor(() => {
			expect(container.querySelectorAll('.og-cell[data-col-field="name"]')).toHaveLength(2);
		});

		fireEvent.click(container.querySelectorAll('.og-cell[data-col-field="name"]')[1]!);

		expect(onCellClick).toHaveBeenCalledWith(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colIndex: 1,
				column: expect.objectContaining({ colId: 'name-b' }),
				value: 'Product A',
			})
		);

		unmount();
		grid.api.destroy();
	});

	it('should pass canonical duplicate-field column identity to custom renderers', () => {
		const rendererProps: Record<string, unknown>[] = [];
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{ field: 'name', header: 'Name A', width: 100, colId: 'name-a' },
				{
					field: 'name',
					header: 'Name B',
					width: 100,
					colId: 'name-b',
					renderer: {
						kind: 'react',
						component: (props: any) => {
							rendererProps.push(props as Record<string, unknown>);
							return <span data-testid='duplicate-renderer'>{String(props.colId)}</span>;
						},
					},
				},
			],
		});

		const duplicateColumn = grid.api.getDisplayedColumns()[1]!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={duplicateColumn} node={node} isEditing={false} isLoading={false} />
			</GridProvider>
		);

		expect(screen.getByTestId('duplicate-renderer').textContent).toBe('name-b');
		expect(rendererProps[0]).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: duplicateColumn.instanceId,
			})
		);

		grid.api.destroy();
	});

	it('should pass canonical duplicate-field column identity to custom editors and route draft updates by instance id', async () => {
		const editorProps: Record<string, unknown>[] = [];
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{ field: 'name', header: 'Name A', width: 100, colId: 'name-a' },
				{
					field: 'name',
					header: 'Name B',
					width: 100,
					colId: 'name-b',
					cellEditor: (props) => {
						editorProps.push(props as unknown as Record<string, unknown>);
						return (
							<input
								data-testid='duplicate-editor'
								value={String(props.value)}
								onChange={(e) => props.onChange(e.target.value)}
								onBlur={() => props.onCommit()}
							/>
						);
					},
				},
			],
		});

		const duplicateColumn = grid.api.getDisplayedColumns()[1]!;
		const node = makeInternalNode('1', { id: '1', name: 'Product A' });

		act(() => {
			grid.api.startEditing('1', duplicateColumn.instanceId!);
		});

		render(
			<GridProvider api={grid.api}>
				<PortalCell rowId='1' colField='name' value='Product A' col={duplicateColumn} node={node} isEditing={true} isLoading={false} />
			</GridProvider>
		);

		const input = screen.getByTestId('duplicate-editor') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Product B' } });

		expect(editorProps[0]).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: duplicateColumn.instanceId,
			})
		);
		expect(grid.api.getStateSnapshot().activeEdit).toEqual(
			expect.objectContaining({
				rowId: '1',
				colField: 'name',
				colId: 'name-b',
				columnInstanceId: duplicateColumn.instanceId,
				draftValue: 'Product B',
			})
		);

		fireEvent.blur(input);

		await waitFor(() => {
			expect(grid.api.getCellValue('1', 'name')).toBe('Product B');
			expect(grid.api.getStateSnapshot().activeEdit).toBeNull();
		});

		grid.api.destroy();
	});

	it('should not mix stale native text with custom renderer content after column topology changes', async () => {
		const customColumns: ColumnDef<{ id: string; risk: string; col_999: string }>[] = [
			{
				field: 'risk',
				header: 'Risk',
				width: 120,
				renderer: {
					kind: 'react',
					component: ({ value }: { value: unknown }) => <span data-testid='risk-renderer'>Risk {String(value)}</span>,
				},
			},
		];
		const nativeColumns = [{ field: 'col_999', header: 'Col 999', width: 120 }];
		const grid = createTestGrid<{ id: string; risk: string; col_999: string }>({
			rows: [{ id: '1', risk: 'LOW', col_999: 'Val 999' }],
			columns: customColumns,
			getRowId: (row) => row.id,
		});

		const { unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} />
			</GridProvider>
		);

		await screen.findByText('Risk LOW');

		act(() => {
			grid.api.setColumns(nativeColumns);
		});

		await screen.findByText('Val 999');

		act(() => {
			grid.api.setColumns(customColumns);
		});

		await waitFor(() => {
			expect(screen.getByTestId('risk-renderer').textContent).toBe('Risk LOW');
			expect(screen.queryByText('Val 999')).toBeNull();
		});

		unmount();
		grid.api.destroy();
	});

	it('should not register navigation when navigation is disabled', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const { container, unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} />
			</GridProvider>
		);

		fireEvent.mouseDown(container.querySelector('.og-cell[data-col-field="name"]')!);
		expect(grid.api.getStateSnapshot().selection.focus).toBeNull();

		unmount();
		grid.api.destroy();
	});

	it('should use selector equality to avoid rerenders for equivalent selected values', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const renderSpy = vi.fn();

		const EqualityInspector = () => {
			const selected = useGridSelector(
				(state) => ({ version: state.globalVersion }),
				(left, right) => left.version === right.version
			);
			renderSpy(selected);
			return <span data-testid='selector-version'>{selected.version}</span>;
		};

		render(
			<GridProvider api={grid.api}>
				<EqualityInspector />
			</GridProvider>
		);

		expect(renderSpy).toHaveBeenCalledTimes(1);

		act(() => {
			grid.api.selectCell({ rowId: '1', colField: 'name' });
		});

		expect(renderSpy).toHaveBeenCalledTimes(1);
		grid.api.destroy();
	});

	it('does not rerender a key-scoped selector for an unrelated column mutation', () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const renderSpy = vi.fn();

		const SelectionInspector = () => {
			const focused = useGridKeySelector('selection', (state) => state.selection.focus);
			renderSpy(focused);
			return <span data-testid='key-scoped-focus'>{focused?.rowId ?? 'none'}</span>;
		};

		render(
			<GridProvider api={grid.api}>
				<SelectionInspector />
			</GridProvider>
		);

		expect(renderSpy).toHaveBeenCalledTimes(1);
		act(() => {
			grid.api.setColumnWidth('name', 180);
		});
		expect(renderSpy).toHaveBeenCalledTimes(1);

		act(() => {
			grid.api.selectCell({ rowId: '1', colField: 'name' });
		});
		expect(renderSpy).toHaveBeenCalledTimes(2);
		grid.api.destroy();
	});

	it('FormulaBar subscribes only to the focused cell', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: '1', name: 'Product A' },
				{ id: '2', name: 'Product B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const cellNotifications = vi.fn();
		const subscribeToCell = vi.fn((rowId: string, colField: string, listener: () => void) =>
			grid.api.subscribeToCell(rowId, colField, () => {
				cellNotifications(rowId, colField);
				listener();
			})
		);
		const formulaApi = { ...grid.api, subscribeToCell };

		act(() => {
			grid.api.selectCell({ rowId: '1', colField: 'name' });
		});
		render(<FormulaBar api={formulaApi} />);

		const input = await screen.findByRole('textbox');
		await waitFor(() => {
			expect(subscribeToCell).toHaveBeenCalledWith('1', 'name', expect.any(Function));
			expect((input as HTMLInputElement).value).toBe('Product A');
		});

		act(() => {
			grid.api.setCellValue('2', 'name', 'Product B+');
			grid.api.flushCellUpdatesSync();
		});
		expect(cellNotifications).not.toHaveBeenCalled();
		expect((input as HTMLInputElement).value).toBe('Product A');

		act(() => {
			grid.api.setCellValue('1', 'name', 'Product A+');
			grid.api.flushCellUpdatesSync();
		});
		await waitFor(() => {
			expect(cellNotifications).toHaveBeenCalledTimes(1);
			expect((input as HTMLInputElement).value).toBe('Product A+');
		});

		grid.api.destroy();
	});

	it('should rerender custom cell renderer when cell value is programmatically updated', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					renderer: {
						kind: 'react',
						component: ({ value }: { value: any }) => <span data-testid='custom-renderer-programmatic'>{String(value)}</span>,
					},
				},
			],
		});

		const { unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} />
			</GridProvider>
		);

		await screen.findByText('Product A');
		expect(screen.getByTestId('custom-renderer-programmatic').textContent).toBe('Product A');

		act(() => {
			grid.api.setCellValue('1', 'name', 'Product Updated');
		});

		await waitFor(() => {
			expect(screen.getByTestId('custom-renderer-programmatic').textContent).toBe('Product Updated');
		});

		unmount();
		grid.api.destroy();
	});

	it('should route arrow navigation only to the active nested detail grid', async () => {
		const parentGrid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Parent A' },
				{ id: 'p2', name: 'Parent B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				rowModelConfig: {
					type: 'client',
					masterDetail: {
						enabled: true,
						expandedRowIds: { p1: true },
						defaultDetailHeight: 120,
					},
				},
			},
		});
		const childGrid = createTestGrid<TestRow>({
			rows: [
				{ id: 'c1', name: 'Child A' },
				{ id: 'c2', name: 'Child B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
		});

		const { unmount } = render(
			<GridProvider api={parentGrid.api}>
				<GridView
					api={parentGrid.api}
					enableNavigation
					detailRowRenderer={() => (
						<GridProvider api={childGrid.api}>
							<GridView api={childGrid.api} enableNavigation />
						</GridProvider>
					)}
				/>
			</GridProvider>
		);

		act(() => {
			parentGrid.api.selectCell({ rowId: 'p1', colField: 'name' });
		});

		const childCell = (await screen.findByText('Child A')).closest('.og-cell') as HTMLElement;
		fireEvent.mouseDown(childCell);
		fireEvent.click(childCell);
		expect(childGrid.api.getStateSnapshot().selection.focus).toEqual(
			expect.objectContaining({ rowId: 'c1', colField: 'name', colId: 'name', columnInstanceId: expect.any(String) })
		);

		fireEvent.keyDown(window, { key: 'ArrowDown' });

		expect(parentGrid.api.getStateSnapshot().selection.focus).toEqual(
			expect.objectContaining({ rowId: 'p1', colField: 'name', colId: 'name', columnInstanceId: expect.any(String) })
		);
		expect(childGrid.api.getStateSnapshot().selection.focus).toEqual(
			expect.objectContaining({ rowId: 'c2', colField: 'name', colId: 'name', columnInstanceId: expect.any(String) })
		);

		unmount();
		parentGrid.api.destroy();
		childGrid.api.destroy();
	});

	it('should keep expanded detail row renderers bound to their own row portal hosts', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Parent A' },
				{ id: 'p2', name: 'Parent B' },
				{ id: 'p3', name: 'Parent C' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				masterDetailEnabled: true,
				detailRowHeight: 120,
			},
		});

		const { container, unmount } = render(
			<div style={{ width: 500, height: 400 }}>
				<GridProvider api={grid.api}>
					<GridView
						api={grid.api}
						enableNavigation={false}
						detailRowRenderer={({ visualRow }) =>
							visualRow.kind === 'detail' ? (
								<div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div>
							) : null
						}
					/>
				</GridProvider>
			</div>
		);

		act(() => {
			grid.api.toggleDetailExpanded('p1');
			grid.api.toggleDetailExpanded('p2');
		});

		await waitFor(() => {
			expect(screen.getByTestId('detail-p1')).toBeTruthy();
			expect(screen.getByTestId('detail-p2')).toBeTruthy();
		});

		const getRowTop = (el: HTMLElement) => {
			const row = el.closest('.og-row') as HTMLElement | null;
			const m = row?.style.transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
			return m ? parseFloat(m[1]) : 0;
		};
		const detailHosts = (Array.from(container.querySelectorAll('.og-row-portal-host')) as HTMLElement[]).sort(
			(a, b) => getRowTop(a) - getRowTop(b)
		);
		expect(detailHosts).toHaveLength(2);
		expect(screen.getByTestId('detail-p1').closest('.og-row-portal-host')).toBe(detailHosts[0]);
		expect(screen.getByTestId('detail-p2').closest('.og-row-portal-host')).toBe(detailHosts[1]);
		expect(detailHosts.map((host) => (host.closest('.og-row') as HTMLElement | null)?.dataset.rowId)).toEqual(['detail:p1', 'detail:p2']);
		expect(detailHosts.map((host) => (host.closest('.og-row') as HTMLElement | null)?.style.height)).toEqual(['120px', '120px']);

		unmount();
		grid.api.destroy();
	});

	it('should preserve detail row height and spacing when sorted master rows are expanded', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Cy' },
				{ id: 'p2', name: 'In' },
				{ id: 'p3', name: 'Um' },
				{ id: 'p4', name: 'We' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				masterDetailEnabled: true,
				detailRowHeight: 120,
				sortModel: [{ colId: 'name', sort: 'asc' }],
			},
		});

		const { container, unmount } = render(
			<div style={{ width: 500, height: 500 }}>
				<GridProvider api={grid.api}>
					<GridView
						api={grid.api}
						enableNavigation={false}
						detailRowRenderer={({ visualRow }) =>
							visualRow.kind === 'detail' ? (
								<div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div>
							) : null
						}
					/>
				</GridProvider>
			</div>
		);

		act(() => {
			grid.api.toggleDetailExpanded('p1');
			grid.api.toggleDetailExpanded('p2');
			grid.api.toggleDetailExpanded('p4');
		});

		await waitFor(() => {
			expect(screen.getByTestId('detail-p1')).toBeTruthy();
			expect(screen.getByTestId('detail-p2')).toBeTruthy();
			expect(screen.getByTestId('detail-p4')).toBeTruthy();
		});

		const getTranslateY = (el: HTMLElement) => {
			const m = el.style.transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
			return m ? parseFloat(m[1]) : 0;
		};
		const rows = (Array.from(container.querySelectorAll('.og-rows-container > .og-row')) as HTMLElement[]).sort(
			(a, b) => getTranslateY(a) - getTranslateY(b)
		);
		expect(rows.map((row) => [row.dataset.rowId, row.style.height, row.style.transform])).toEqual([
			['row:p1', '40px', 'translateY(0px)'],
			['detail:p1', '120px', 'translateY(40px)'],
			['row:p2', '40px', 'translateY(160px)'],
			['detail:p2', '120px', 'translateY(200px)'],
			['row:p3', '40px', 'translateY(320px)'],
			['row:p4', '40px', 'translateY(360px)'],
			['detail:p4', '120px', 'translateY(400px)'],
		]);

		unmount();
		grid.api.destroy();
	});

	it('should remove detail row renderer content when a detail row is recycled into a data row', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Parent A' },
				{ id: 'p2', name: 'Parent B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				masterDetailEnabled: true,
				detailRowHeight: 120,
			},
		});

		const { container, unmount } = render(
			<div style={{ width: 500, height: 240 }}>
				<GridProvider api={grid.api}>
					<GridView
						api={grid.api}
						enableNavigation={false}
						detailRowRenderer={({ visualRow }) =>
							visualRow.kind === 'detail' ? (
								<div data-testid={`detail-${visualRow.parentId}`}>Details for {visualRow.parentId}</div>
							) : null
						}
					/>
				</GridProvider>
			</div>
		);

		act(() => {
			grid.api.toggleDetailExpanded('p1');
		});

		await screen.findByTestId('detail-p1');

		act(() => {
			grid.api.toggleDetailExpanded('p1');
		});

		await waitFor(() => {
			expect(screen.queryByTestId('detail-p1')).toBeNull();
		});
		expect(container.querySelector('.og-row-portal-host')).toBeNull();

		unmount();
		grid.api.destroy();
	});

	it('should render custom group and detail row renderers inside PortalManager', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});

		const containerGroup = document.createElement('div');
		const containerDetail = document.createElement('div');
		document.body.appendChild(containerGroup);
		document.body.appendChild(containerDetail);

		const store = createPortalStore<TestRow>();
		store.mountRow('group-1', containerGroup, {
			kind: 'group',
			id: 'group-1',
			field: 'category',
			key: 'Electronics',
			expanded: true,
			depth: 1,
			childCount: 5,
		} as any);
		store.mountRow('detail-1', containerDetail, {
			kind: 'detail',
			id: 'detail-1',
			parentId: 'parent-1',
		} as any);

		const groupRenderer = ({ visualRow }: any) => (
			<span data-testid='custom-group'>
				{visualRow.field}:{visualRow.key} ({visualRow.childCount} items)
			</span>
		);

		const detailRenderer = ({ visualRow }: any) => <span data-testid='custom-detail'>Details for {visualRow.parentId}</span>;

		render(<PortalManager store={store} api={grid.api} groupRowRenderer={groupRenderer} detailRowRenderer={detailRenderer} />);

		expect(screen.getByTestId('custom-group').textContent).toBe('category:Electronics (5 items)');
		expect(screen.getByTestId('custom-detail').textContent).toBe('Details for parent-1');

		document.body.removeChild(containerGroup);
		document.body.removeChild(containerDetail);
		grid.api.destroy();
	});

	it('should render only the latest row portal for a recycled detail container', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});
		const container = document.createElement('div');
		document.body.appendChild(container);

		const store = createPortalStore<TestRow>();
		store.mountRow('detail-old', container, { kind: 'detail', id: 'detail-old', parentId: 'old-parent' } as any);
		store.mountRow('detail-new', container, { kind: 'detail', id: 'detail-new', parentId: 'new-parent' } as any);

		render(
			<PortalManager
				store={store}
				api={grid.api}
				detailRowRenderer={({ visualRow }: any) => <span data-testid='custom-detail'>Details for {visualRow.parentId}</span>}
			/>
		);

		expect(screen.getAllByTestId('custom-detail')).toHaveLength(1);
		expect(screen.getByTestId('custom-detail').textContent).toBe('Details for new-parent');

		document.body.removeChild(container);
		grid.api.destroy();
	});

	it('should ignore a stale row portal when a recycled host now belongs to another row', () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});
		const row = document.createElement('div');
		row.className = 'og-row';
		row.dataset.rowKey = 'detail-new';
		const container = document.createElement('div');
		container.className = 'og-row-portal-host';
		row.appendChild(container);
		document.body.appendChild(row);

		const store = createPortalStore<TestRow>();
		store.mountRow('detail-old', container, { kind: 'detail', id: 'detail-old', parentId: 'old-parent' } as any);

		render(
			<PortalManager
				store={store}
				api={grid.api}
				detailRowRenderer={({ visualRow }: any) => <span data-testid='custom-detail'>Details for {visualRow.parentId}</span>}
			/>
		);

		expect(screen.queryByTestId('custom-detail')).toBeNull();

		document.body.removeChild(row);
		grid.api.destroy();
	});

	it('should update row portal content when the visual row changes for the same container', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [],
			columns: [],
		});
		const container = document.createElement('div');
		document.body.appendChild(container);

		const store = createPortalStore<TestRow>();

		const makeVisualRow = (expanded: boolean) => ({
			kind: 'group' as const,
			id: 'group-1',
			field: 'category',
			key: 'Electronics',
			expanded,
			depth: 0,
			childCount: expanded ? 5 : 2,
		});

		const groupRenderer = ({ visualRow }: any) => (
			<span data-testid='custom-group'>{visualRow.expanded ? `expanded:${visualRow.childCount}` : `collapsed:${visualRow.childCount}`}</span>
		);

		store.mountRow('group-1', container, makeVisualRow(false) as any);

		render(<PortalManager store={store} api={grid.api} groupRowRenderer={groupRenderer} />);

		expect(screen.getByTestId('custom-group').textContent).toBe('collapsed:2');

		store.mountRow('group-1', container, makeVisualRow(true) as any);
		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByTestId('custom-group').textContent).toBe('expanded:5');

		document.body.removeChild(container);
		grid.api.destroy();
	});

	it('should not flush portal updates synchronously during React cleanup', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					renderer: { kind: 'react', component: ({ value }: { value: any }) => <span data-testid='portal-content'>{String(value)}</span> },
				},
			],
		});

		const { unmount } = render(
			<React.StrictMode>
				<GridProvider api={grid.api}>
					<GridView api={grid.api} />
				</GridProvider>
			</React.StrictMode>
		);

		unmount();

		expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('flushSync was called from inside a lifecycle method'));
		consoleError.mockRestore();
		grid.api.destroy();
	});

	it('should maintain stable event listeners on the container and memoize PortalCell to prevent redundant renders', async () => {
		const addEventListenerSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener');
		let renderCount = 0;

		const grid = createTestGrid<TestRow>({
			rows: [
				{ id: '1', name: 'Product A' },
				{ id: '2', name: 'Product B' },
			],
			columns: [
				{
					field: 'name',
					header: 'Name',
					width: 100,
					renderer: {
						kind: 'react',
						component: ({ value }: { value: any }) => {
							renderCount++;
							return <span data-testid={`cell-${value}`}>{String(value)}</span>;
						},
					},
				},
			],
		});

		const { container } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} />
			</GridProvider>
		);
		const openGridContainer = container.firstElementChild as HTMLElement;

		// Initial render should bind event listeners on the container
		const initialAddCalls = addEventListenerSpy.mock.calls.filter((call, index) => {
			const instance = addEventListenerSpy.mock.instances[index];
			return instance === openGridContainer && ['mousedown', 'mouseover', 'click', 'dblclick', 'contextmenu'].includes(call[0]);
		}).length;
		expect(initialAddCalls).toBeGreaterThanOrEqual(5);

		await waitFor(() => {
			expect(renderCount).toBeGreaterThan(0);
		});
		addEventListenerSpy.mockClear();

		// Trigger editing on row 2, which changes the portal list state
		act(() => {
			grid.api.startEditing('2', 'name');
		});

		// Check if container event listeners were re-bound during this update
		const updateAddCalls = addEventListenerSpy.mock.calls.filter((call, index) => {
			const instance = addEventListenerSpy.mock.instances[index];
			return instance === openGridContainer && ['mousedown', 'mouseover', 'click', 'dblclick', 'contextmenu'].includes(call[0]);
		}).length;
		expect(updateAddCalls).toBe(0); // Event listeners are stable and not re-bound!

		addEventListenerSpy.mockRestore();
		grid.api.destroy();
	});

	it('should keep container listeners stable while adopting the latest onCellClick callback on rerender', async () => {
		const addEventListenerSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener');
		const firstClick = vi.fn();
		const secondClick = vi.fn();

		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const { container, rerender, unmount } = render(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} onCellClick={firstClick} />
			</GridProvider>
		);

		const openGridContainer = container.firstElementChild as HTMLElement;
		await waitFor(() => {
			expect(container.querySelector('.og-cell[data-col-field="name"]')).not.toBeNull();
		});

		addEventListenerSpy.mockClear();

		rerender(
			<GridProvider api={grid.api}>
				<GridView api={grid.api} enableNavigation={false} onCellClick={secondClick} />
			</GridProvider>
		);

		const updateAddCalls = addEventListenerSpy.mock.calls.filter((call, index) => {
			const instance = addEventListenerSpy.mock.instances[index];
			return instance === openGridContainer && ['mousedown', 'mouseover', 'click', 'dblclick', 'contextmenu'].includes(call[0]);
		}).length;
		expect(updateAddCalls).toBe(0);

		fireEvent.click(container.querySelector('.og-cell[data-col-field="name"]')!);

		expect(firstClick).not.toHaveBeenCalled();
		expect(secondClick).toHaveBeenCalledTimes(1);

		addEventListenerSpy.mockRestore();
		unmount();
		grid.api.destroy();
	});

	it('should adopt the latest context menu options on rerender without rebinding container listeners', async () => {
		const addEventListenerSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener');
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Product A' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		const { container, rerender, unmount } = render(
			<GridProvider api={grid.api}>
				<GridView
					api={grid.api}
					enableNavigation={false}
					contextMenuOptions={{
						disableDefaults: true,
						customItems: [{ label: 'First Action' }],
					}}
				/>
			</GridProvider>
		);

		const openGridContainer = container.firstElementChild as HTMLElement;
		await waitFor(() => {
			expect(container.querySelector('.og-cell[data-col-field="name"]')).not.toBeNull();
		});
		const cell = container.querySelector('.og-cell[data-col-field="name"]') as HTMLElement;

		fireEvent.contextMenu(cell, { clientX: 40, clientY: 50 });
		await screen.findByText('First Action');

		addEventListenerSpy.mockClear();
		fireEvent.mouseDown(document.body);
		await waitFor(() => expect(screen.queryByText('First Action')).toBeNull());

		rerender(
			<GridProvider api={grid.api}>
				<GridView
					api={grid.api}
					enableNavigation={false}
					contextMenuOptions={{
						disableDefaults: true,
						customItems: [{ label: 'Second Action' }],
					}}
				/>
			</GridProvider>
		);

		const updateAddCalls = addEventListenerSpy.mock.calls.filter((call, index) => {
			const instance = addEventListenerSpy.mock.instances[index];
			return instance === openGridContainer && ['mousedown', 'mouseover', 'click', 'dblclick', 'contextmenu'].includes(call[0]);
		}).length;
		expect(updateAddCalls).toBe(0);

		fireEvent.contextMenu(cell, { clientX: 45, clientY: 55 });
		await screen.findByText('Second Action');
		expect(screen.queryByText('First Action')).toBeNull();

		addEventListenerSpy.mockRestore();
		fireEvent.mouseDown(document.body);
		unmount();
		grid.api.destroy();
	});

	it('should keep global navigation listeners stable across nested grid rerenders and clean them up on unmount', async () => {
		const windowAddSpy = vi.spyOn(window, 'addEventListener');
		const windowRemoveSpy = vi.spyOn(window, 'removeEventListener');
		const documentAddSpy = vi.spyOn(document, 'addEventListener');
		const documentRemoveSpy = vi.spyOn(document, 'removeEventListener');

		const parentGrid = createTestGrid<TestRow>({
			rows: [
				{ id: 'p1', name: 'Parent A' },
				{ id: 'p2', name: 'Parent B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
			initialState: {
				rowModelConfig: {
					type: 'client',
					masterDetail: {
						enabled: true,
						expandedRowIds: { p1: true },
						defaultDetailHeight: 120,
					},
				},
			},
		});
		const childGrid = createTestGrid<TestRow>({
			rows: [{ id: 'c1', name: 'Child A' }],
			columns: [{ field: 'name', header: 'Name', width: 120 }],
		});
		const firstClick = vi.fn();
		const secondClick = vi.fn();

		const { rerender, unmount } = render(
			<GridProvider api={parentGrid.api}>
				<GridView
					api={parentGrid.api}
					enableNavigation
					onCellClick={firstClick}
					detailRowRenderer={() => (
						<GridProvider api={childGrid.api}>
							<GridView api={childGrid.api} enableNavigation />
						</GridProvider>
					)}
				/>
			</GridProvider>
		);

		await screen.findByText('Child A');

		const addedWindowListeners = windowAddSpy.mock.calls.filter(([type]) => type === 'keydown' || type === 'mouseup');
		const addedDocumentListeners = documentAddSpy.mock.calls.filter(([type, , options]) => type === 'mousedown' && options === true);
		expect(addedWindowListeners).toHaveLength(4);
		expect(addedDocumentListeners).toHaveLength(2);

		windowAddSpy.mockClear();
		windowRemoveSpy.mockClear();
		documentAddSpy.mockClear();
		documentRemoveSpy.mockClear();

		rerender(
			<GridProvider api={parentGrid.api}>
				<GridView
					api={parentGrid.api}
					enableNavigation
					onCellClick={secondClick}
					detailRowRenderer={() => (
						<GridProvider api={childGrid.api}>
							<GridView api={childGrid.api} enableNavigation />
						</GridProvider>
					)}
				/>
			</GridProvider>
		);

		expect(windowAddSpy.mock.calls.filter(([type]) => type === 'keydown' || type === 'mouseup')).toHaveLength(0);
		expect(windowRemoveSpy.mock.calls.filter(([type]) => type === 'keydown' || type === 'mouseup')).toHaveLength(0);
		expect(documentAddSpy.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(0);
		expect(documentRemoveSpy.mock.calls.filter(([type]) => type === 'mousedown')).toHaveLength(0);

		fireEvent.click((await screen.findByText('Parent A')).closest('.og-cell')!);
		expect(firstClick).not.toHaveBeenCalled();
		expect(secondClick).toHaveBeenCalledTimes(1);

		unmount();

		const removedWindowListeners = windowRemoveSpy.mock.calls.filter(([type]) => type === 'keydown' || type === 'mouseup');
		const removedDocumentListeners = documentRemoveSpy.mock.calls.filter(([type, , options]) => type === 'mousedown' && options === true);
		expect(removedWindowListeners.length).toBeGreaterThanOrEqual(addedWindowListeners.length);
		expect(removedDocumentListeners.length).toBeGreaterThanOrEqual(addedDocumentListeners.length);

		for (const [, listener] of addedWindowListeners) {
			expect(removedWindowListeners).toContainEqual(expect.arrayContaining([expect.any(String), listener]));
		}
		for (const [, listener, options] of addedDocumentListeners) {
			expect(removedDocumentListeners).toContainEqual(expect.arrayContaining(['mousedown', listener, options]));
		}

		windowAddSpy.mockRestore();
		windowRemoveSpy.mockRestore();
		documentAddSpy.mockRestore();
		documentRemoveSpy.mockRestore();
		parentGrid.api.destroy();
		childGrid.api.destroy();
	});

	it('should survive repeated mount and unmount cycles without leaking portal content or cleanup warnings', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		for (let cycle = 0; cycle < 3; cycle++) {
			const grid = createTestGrid<TestRow>({
				rows: [
					{ id: 'p1', name: `Parent ${cycle}` },
					{ id: 'p2', name: `Other ${cycle}` },
				],
				columns: [
					{
						field: 'name',
						header: 'Name',
						width: 120,
						renderer: {
							kind: 'react',
							component: ({ value }: { value: any }) => <span data-testid={`portal-content-${cycle}`}>{String(value)}</span>,
						},
					},
				],
				initialState: {
					masterDetailEnabled: true,
					detailRowHeight: 120,
				},
			});

			const { unmount } = render(
				<div style={{ width: 500, height: 320 }}>
					<GridProvider api={grid.api}>
						<GridView
							api={grid.api}
							enableNavigation={false}
							detailRowRenderer={({ visualRow }) =>
								visualRow.kind === 'detail' ? (
									<div data-testid={`detail-portal-${cycle}`}>Details for {visualRow.parentId}</div>
								) : null
							}
						/>
					</GridProvider>
				</div>
			);

			await waitFor(() => {
				expect(screen.getAllByTestId(`portal-content-${cycle}`)).toHaveLength(2);
			});

			act(() => {
				grid.api.toggleDetailExpanded('p1');
			});

			await screen.findByTestId(`detail-portal-${cycle}`);

			unmount();
			await act(async () => {});

			expect(screen.queryByTestId(`portal-content-${cycle}`)).toBeNull();
			expect(screen.queryByTestId(`detail-portal-${cycle}`)).toBeNull();
			expect(document.body.querySelector('.og-row-portal-host')).toBeNull();

			grid.api.destroy();
		}

		expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('flushSync was called from inside a lifecycle method'));
		expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining("Can't perform a React state update on an unmounted component"));
		consoleError.mockRestore();
	});
});

describe('Grid pagination prop', () => {
	it('paginates client rows without requiring a separate pagination component', async () => {
		const rows: TestRow[] = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Cara' },
			{ id: '4', name: 'Dane' },
			{ id: '5', name: 'Elle' },
		];

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='client'
					rows={rows}
					columns={[{ field: 'name', header: 'Name', width: 120 }]}
					getRowId={(row: TestRow) => row.id}
					enableNavigation={false}
					pagination={{ pageSize: 2 }}
				/>
			</div>
		);

		await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
		// Pagination is core chrome now — the core bar renders inside the grid; the adapter
		// no longer slices rows or renders a React pagination component.
		expect(screen.getByLabelText('Next page')).toBeTruthy();
		expect(screen.queryByText('Cara')).toBeNull();

		fireEvent.click(screen.getByLabelText('Next page'));

		await waitFor(() => expect(screen.getByText('Cara')).toBeTruthy());
		expect(screen.queryByText('Alice')).toBeNull();
		expect(screen.getByText((content) => content.includes('of 5'))).toBeTruthy();
	});

	it('loads server rows through the SSRM datasource contract', async () => {
		const rows: TestRow[] = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Cara' },
			{ id: '4', name: 'Dane' },
			{ id: '5', name: 'Elle' },
		];
		const getRows = vi.fn(async ({ startRow, endRow }: { startRow: number; endRow: number }) => ({
			rows: rows.slice(startRow, endRow),
			rowCount: rows.length,
		}));

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='server'
					columns={[{ field: 'name', header: 'Name', width: 120 }]}
					datasource={{ getRows }}
					getRowId={(row: TestRow) => row.id}
					enableNavigation={false}
					blockSize={2}
				/>
			</div>
		);

		await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
		expect(screen.getByText('Bob')).toBeTruthy();
		expect(getRows.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				startRow: 0,
				endRow: 2,
				route: [],
				sortModel: null,
				filterModel: null,
			})
		);
	});
});

describe('explicit React entrypoints', () => {
	it('exposes Grid as the only public grid entrypoint', () => {
		expect(ReactPackage.Grid).toBeDefined();
		expect((ReactPackage as Record<string, unknown>).GridView).toBeUndefined();
		expect((ReactPackage as Record<string, unknown>).GridProvider).toBeUndefined();
		expect((ReactPackage as Record<string, unknown>).useOwnedClientGrid).toBeUndefined();
		expect((ReactPackage as Record<string, unknown>).useOwnedServerGrid).toBeUndefined();
	});

	it('Grid owns the api and fires onGridReady while descendants can still read useGridApi', async () => {
		const onGridReady = vi.fn();
		const HookRenderer = () => {
			const api = useGridApi<TestRow>();
			return <span data-testid='api-hook'>{api ? 'yes' : 'no'}</span>;
		};

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[
						{
							field: 'name',
							header: 'Name',
							width: 100,
							renderer: { kind: 'react', component: HookRenderer },
						},
					]}
					enableNavigation={false}
					onGridReady={onGridReady}
				/>
			</div>
		);

		await waitFor(() => expect(onGridReady).toHaveBeenCalledTimes(1));
		expect(onGridReady.mock.calls[0][0]).toEqual(expect.objectContaining({ rowModelType: 'client' }));
		expect(screen.getByTestId('api-hook').textContent).toBe('yes');
	});

	it('Grid forwards writeBlocked events through the React callback surface', async () => {
		const onGridReady = vi.fn();
		const onWriteBlocked = vi.fn();

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 100 }]}
					getRowId={(row: TestRow) => row.id}
					enableNavigation={false}
					onGridReady={onGridReady}
					onWriteBlocked={onWriteBlocked}
				/>
			</div>
		);

		await waitFor(() => expect(onGridReady).toHaveBeenCalledTimes(1));
		const api = onGridReady.mock.calls[0][0].api;

		act(() => {
			api.dispatchEvent(GridEventName.writeBlocked, {
				source: 'paste',
				status: 'validationFailed',
				reason: 'Invalid email format',
				cells: [{ rowId: '1', colField: 'name' }],
				rowCount: 1,
				colCount: 1,
				issues: [],
			});
		});

		expect(onWriteBlocked).toHaveBeenCalledWith(
			expect.objectContaining({
				source: 'paste',
				status: 'validationFailed',
				reason: 'Invalid email format',
			})
		);
	});

	it('GridView renders against an explicit api', async () => {
		const grid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Alice' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});

		render(
			<div style={{ width: 400, height: 300 }}>
				<GridProvider api={grid.api}>
					<GridView api={grid.api} enableNavigation={false} />
				</GridProvider>
			</div>
		);

		await act(async () => {});
		grid.api.destroy();
	});

	it('GridView treats sidebar.defaultOpen as initial-only per api instance and reapplies the latest default when the api changes', async () => {
		const firstGrid = createTestGrid<TestRow>({
			rows: [{ id: '1', name: 'Alice' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const secondGrid = createTestGrid<TestRow>({
			rows: [{ id: '2', name: 'Bob' }],
			columns: [{ field: 'name', header: 'Name', width: 100 }],
		});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const onCellClick = vi.fn();

		const { rerender } = render(
			<div style={{ width: 500, height: 320 }}>
				<GridProvider api={firstGrid.api}>
					<GridView
						api={firstGrid.api}
						enableNavigation={false}
						onCellClick={onCellClick}
						sidebar={{ panels: ['columns', 'filters'], defaultOpen: 'columns' }}
					/>
				</GridProvider>
			</div>
		);

		await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
		await waitFor(() => expect(firstGrid.api.getStateSnapshot().sidebarOpenPanel).toBe('columns'));

		act(() => {
			firstGrid.api.closePanel();
		});
		await waitFor(() => expect(firstGrid.api.getStateSnapshot().sidebarOpenPanel ?? null).toBeNull());

		rerender(
			<div style={{ width: 500, height: 320 }}>
				<GridProvider api={firstGrid.api}>
					<GridView
						api={firstGrid.api}
						enableNavigation={false}
						onCellClick={onCellClick}
						sidebar={{ panels: ['columns', 'filters'], defaultOpen: 'filters' }}
					/>
				</GridProvider>
			</div>
		);

		await waitFor(() => {
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Prop "sidebar.defaultOpen" is initial-only'));
		});
		expect(firstGrid.api.getStateSnapshot().sidebarOpenPanel ?? null).toBeNull();

		rerender(
			<div style={{ width: 500, height: 320 }}>
				<GridProvider api={secondGrid.api}>
					<GridView
						api={secondGrid.api}
						enableNavigation={false}
						onCellClick={onCellClick}
						sidebar={{ panels: ['columns', 'filters'], defaultOpen: 'filters' }}
					/>
				</GridProvider>
			</div>
		);

		await waitFor(() => expect(screen.getByText('Bob')).toBeTruthy());
		expect(screen.queryByText('Alice')).toBeNull();
		await waitFor(() => expect(secondGrid.api.getStateSnapshot().sidebarOpenPanel).toBe('filters'));

		fireEvent.click(screen.getByText('Bob').closest('.og-cell')!);
		expect(onCellClick).toHaveBeenCalledWith(expect.objectContaining({ rowId: '2', colField: 'name', value: 'Bob' }));

		warnSpy.mockRestore();
		firstGrid.api.destroy();
		secondGrid.api.destroy();
	});

	it('Grid can own its api directly', async () => {
		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 100 }]}
					enableNavigation={false}
				/>
			</div>
		);

		await act(async () => {});
	});

	it('syncs supported live props on rerender without recreating the grid api', async () => {
		const onGridReady = vi.fn();
		const getRowId = (row: TestRow) => row.id;

		const { container, rerender } = render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 100 }]}
					getRowId={getRowId}
					enableNavigation={false}
					showFloatingFilters={false}
					showFilterChipBar={false}
					onGridReady={onGridReady}
				/>
			</div>
		);

		await waitFor(() => expect(onGridReady).toHaveBeenCalledTimes(1));
		const api = onGridReady.mock.calls[0][0].api;
		const gridContainer = container.querySelector('.og-grid-container') as HTMLElement;
		expect(gridContainer.style.getPropertyValue('--og-floating-filter-height')).toBe('0px');

		rerender(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 100 }]}
					getRowId={getRowId}
					enableNavigation={false}
					showFloatingFilters
					showFilterChipBar
					onGridReady={onGridReady}
				/>
			</div>
		);

		await waitFor(() => {
			expect(onGridReady).toHaveBeenCalledTimes(1);
			expect(gridContainer.style.getPropertyValue('--og-floating-filter-height')).toBe('36px');
		});

		act(() => {
			api.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'Ali' } });
		});

		await waitFor(() => {
			expect(screen.getByText('Name: contains "Ali"')).toBeTruthy();
		});
	});

	it('warns when initial-only Grid props change after mount', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const onGridReady = vi.fn();
		const getRowId = (row: TestRow) => row.id;

		const { rerender } = render(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 100 }]}
					getRowId={getRowId}
					enableNavigation={false}
					persistence='grid-a'
					rowOverscanPx={40}
					showStatusBar
					rowSelection='single'
					onGridReady={onGridReady}
				/>
			</div>
		);

		await waitFor(() => expect(onGridReady).toHaveBeenCalledTimes(1));

		rerender(
			<div style={{ width: 400, height: 300 }}>
				<Grid
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 100 }]}
					getRowId={getRowId}
					enableNavigation={false}
					persistence='grid-b'
					rowOverscanPx={120}
					showStatusBar={false}
					rowSelection='multiple'
					onGridReady={onGridReady}
				/>
			</div>
		);

		await waitFor(() => {
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Prop "persistence" is initial-only'));
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Prop "rowOverscanPx" is initial-only'));
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Prop "showStatusBar" is initial-only'));
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Prop "rowSelection" is initial-only'));
		});
	});
});

describe('Grid theme configuration', () => {
	it('applies initialState.themeName and themeOverrides declaratively, with no imperative onGridReady call needed', async () => {
		let api: GridApi<TestRow> | undefined;

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid<TestRow>
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 120 }]}
					getRowId={(row) => row.id}
					enableNavigation={false}
					initialState={{ themeName: 'light', themeOverrides: { focusRing: '#1e2148' } }}
					onGridReady={(event) => {
						api = event.api;
					}}
				/>
			</div>
		);

		await waitFor(() => expect(api).toBeDefined());
		// By the time onGridReady fires the theme is already fully resolved — no separate
		// mergeTheme() call was made anywhere in this test.
		expect(api!.getThemeName()).toBe('light');
		expect(api!.getTheme().focusRing).toBe('#1e2148');
	});

	it('supports runtime theme changes via the standard GridApi methods', async () => {
		let api: GridApi<TestRow> | undefined;

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid<TestRow>
					rowModelType='client'
					rows={[{ id: '1', name: 'Alice' }]}
					columns={[{ field: 'name', header: 'Name', width: 120 }]}
					getRowId={(row) => row.id}
					enableNavigation={false}
					onGridReady={(event) => {
						api = event.api;
					}}
				/>
			</div>
		);

		await waitFor(() => expect(api).toBeDefined());

		act(() => api!.switchTheme('dark'));
		expect(api!.getThemeName()).toBe('dark');

		act(() => api!.mergeTheme({ focusRing: '#00ff00' }));
		expect(api!.getTheme().focusRing).toBe('#00ff00');

		const custom = { ...api!.getTheme(), bgColor: '#010203' };
		act(() => api!.setTheme(custom));
		expect(api!.getTheme().bgColor).toBe('#010203');
	});
});

describe('Grid quick filter (search across columns)', () => {
	it('setQuickFilter narrows visible rows by matching across every column, without hand-rolled row filtering', async () => {
		let api: GridApi<TestRow> | undefined;
		const rows = [
			{ id: '1', name: 'Alice' },
			{ id: '2', name: 'Bob' },
			{ id: '3', name: 'Cara' },
		];

		render(
			<div style={{ width: 400, height: 300 }}>
				<Grid<TestRow>
					rowModelType='client'
					rows={rows}
					columns={[{ field: 'name', header: 'Name', width: 120 }]}
					getRowId={(row) => row.id}
					enableNavigation={false}
					onGridReady={(event) => {
						api = event.api;
					}}
				/>
			</div>
		);

		await waitFor(() => expect(api).toBeDefined());
		await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());

		act(() => api!.setQuickFilter('a'));
		await waitFor(() => {
			expect(screen.getByText('Alice')).toBeTruthy();
			expect(screen.getByText('Cara')).toBeTruthy();
			expect(screen.queryByText('Bob')).toBeNull();
		});

		act(() => api!.setQuickFilter(''));
		await waitFor(() => expect(screen.getByText('Bob')).toBeTruthy());
	});
});
