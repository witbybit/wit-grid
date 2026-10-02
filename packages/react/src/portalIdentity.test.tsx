// @vitest-environment jsdom
import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, act, waitFor } from '@testing-library/react';
import { createClientGrid, type CellRendererProps, type ColumnDef } from '@eregister/wit-grid-core';
import { GridProvider } from './gridContext.js';
import { GridView } from './GridView.js';
import { createPortalStore } from './GridPortal.js';
import { PortalCell } from './gridPortalHosts.js';
import type { CellPortalPhysicalIdentity } from './gridPortalTypes.js';

afterEach(cleanup);

class MockResizeObserver {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}
globalThis.ResizeObserver = MockResizeObserver;

interface Row {
	id: string;
	name: string;
}

const IDENTITY: CellPortalPhysicalIdentity = {
	cellInstanceId: 'ci-1',
	rowSlotId: 'slot-0',
	slotGeneration: 2,
	rowBindingGeneration: 3,
	portalHostId: 'ci-1-ph',
};

describe('React portal physical identity', () => {
	it('unmounts a React renderer destroyed with no intermediate update (no detached-subtree leak)', async () => {
		let live = 0;
		const Tracked = ({ value }: { value: unknown }) => {
			useEffect(() => {
				live++;
				return () => {
					live--;
				};
			}, []);
			return <span data-testid='tracked'>{String(value)}</span>;
		};
		const api = createClientGrid<Row>({
			rows: [
				{ id: '1', name: 'A' },
				{ id: '2', name: 'B' },
			],
			columns: [{ field: 'name', header: 'Name', width: 100, renderer: { kind: 'react', component: Tracked } }],
			getRowId: (row) => row.id,
		});

		render(
			<GridProvider api={api}>
				<GridView api={api} enableNavigation={false} />
			</GridProvider>
		);
		await waitFor(() => expect(screen.getAllByTestId('tracked')).toHaveLength(2));
		expect(live).toBe(2);

		act(() => {
			api.setRows([]);
		});
		await waitFor(() => expect(live).toBe(0));
		api.destroy();
	});

	it('delivers the first data update after mount through the imperative handle', async () => {
		const updates: CellRendererProps<Row>[] = [];
		let renders = 0;
		const ImperativeRenderer = forwardRef<{ update(p: CellRendererProps<Row>): void }, CellRendererProps<Row>>((props, ref) => {
			renders++;
			useImperativeHandle(ref, () => ({ update: (p) => updates.push(p) }), []);
			return <span data-testid='imperative'>{String(props.value)}</span>;
		});
		const columns: ColumnDef<Row>[] = [
			{
				field: 'name',
				header: 'Name',
				width: 100,
				renderer: {
					kind: 'imperativeReact',
					component: ImperativeRenderer,
				},
			},
		];
		const api = createClientGrid<Row>({ rows: [{ id: '1', name: 'A' }], columns, getRowId: (row) => row.id });

		render(
			<GridProvider api={api}>
				<GridView api={api} enableNavigation={false} />
			</GridProvider>
		);
		await screen.findByTestId('imperative');
		const rendersAfterMount = renders;

		act(() => {
			api.setCellValue('1', 'name', 'B');
		});
		await waitFor(() => expect(updates.some((p) => p.value === 'B')).toBe(true));
		expect(renders).toBe(rendersAfterMount);
		api.destroy();
	});
});

describe('portal store imperative write-back', () => {
	it('writes the imperative payload back to the store so later React renders are not stale', () => {
		const store = createPortalStore<Row>();
		const container = document.createElement('div');
		const col = { field: 'name', header: 'Name' } as ColumnDef<Row>;
		const node = { id: '1', data: { id: '1', name: 'A' } };
		store.mountCell('k', container, 'A', node, col, false, false, 'initial', false, false, false, IDENTITY);
		const notified = vi.fn();
		store.subscribeToCell('k', notified);
		store.registerImperativeUpdater('k', () => true);

		const node2 = { id: '1', data: { id: '1', name: 'B' } };
		expect(store.tryImperativeUpdate('k', 'B', node2, col, false, false, 'scroll-live', true, true, false, IDENTITY)).toBe(true);

		expect(store.getCellData('k')).toMatchObject({ value: 'B', node: node2, phase: 'scroll-live', isScrolling: true, isFocused: true });
		expect(notified).not.toHaveBeenCalled();
		// The mountCell no-op check now compares against the written-back payload.
		store.mountCell('k', container, 'B', node2, col, false, false, 'scroll-live', true, true, false, IDENTITY);
		expect(notified).not.toHaveBeenCalled();
	});

	it('leaves the store untouched when the imperative updater declines', () => {
		const store = createPortalStore<Row>();
		const col = { field: 'name', header: 'Name' } as ColumnDef<Row>;
		const node = { id: '1', data: { id: '1', name: 'A' } };
		store.mountCell('k', document.createElement('div'), 'A', node, col, false, false, 'initial', false, false, false, IDENTITY);
		store.registerImperativeUpdater('k', () => false);

		expect(store.tryImperativeUpdate('k', 'B', node, col, false, false, 'initial', false, false, false, IDENTITY)).toBe(false);
		expect(store.getCellData('k')?.value).toBe('A');
	});

	it('is empty after an unmount carrying the mount identity', () => {
		const store = createPortalStore<Row>();
		const container = document.createElement('div');
		const col = { field: 'name', header: 'Name' } as ColumnDef<Row>;
		store.mountCell('k', container, 'A', { id: '1', data: { id: '1', name: 'A' } }, col, false, false, 'initial', false, false, false, IDENTITY);
		store.unmountCell('k', container, false, { ...IDENTITY });
		expect(store.getDebugStats().cellPortalCount).toBe(0);
	});
});

describe('renderer column ids and formattedValue', () => {
	it('passes the real colId and the valueFormatter output', () => {
		const received: Record<string, unknown>[] = [];
		const api = createClientGrid<Row>({
			rows: [{ id: '1', name: 'A' }],
			columns: [
				{
					field: 'name',
					colId: 'nameCol',
					header: 'Name',
					valueFormatter: ({ value }) => `<${String(value)}>`,
					renderer: {
						kind: 'react',
						component: (props: Record<string, unknown>) => {
							received.push(props);
							return null;
						},
					},
				},
			],
		});
		const col = api.getColumnDef('nameCol') ?? api.getColumnDef('name')!;
		render(
			<GridProvider api={api}>
				<PortalCell
					rowId='1'
					colField='name'
					value='A'
					col={col}
					node={{ id: '1', data: { id: '1', name: 'A' } }}
					isEditing={false}
					isLoading={false}
				/>
			</GridProvider>
		);
		expect(received[0]).toMatchObject({ colId: 'nameCol', colField: 'name', formattedValue: '<A>' });
		api.destroy();
	});

	it('falls back to field for colId and String(value) for formattedValue', () => {
		const received: Record<string, unknown>[] = [];
		const api = createClientGrid<Row>({
			rows: [{ id: '1', name: 'A' }],
			columns: [
				{
					field: 'name',
					header: 'Name',
					renderer: {
						kind: 'react',
						component: (props: Record<string, unknown>) => {
							received.push(props);
							return null;
						},
					},
				},
			],
		});
		render(
			<GridProvider api={api}>
				<PortalCell
					rowId='1'
					colField='name'
					value={42}
					col={api.getColumnDef('name')!}
					node={{ id: '1', data: { id: '1', name: 'A' } }}
					isEditing={false}
					isLoading={false}
				/>
			</GridProvider>
		);
		expect(received[0]).toMatchObject({ colId: 'name', formattedValue: '42' });
		api.destroy();
	});
});
