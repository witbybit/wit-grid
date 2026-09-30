import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClientGrid, type GroupVisualRow } from '@eregister/wit-grid-core';
import { DefaultGroupRowRenderer } from './gridPortalHosts.js';

interface Row {
	id: string;
	category: string;
}

afterEach(cleanup);

/** The collapsed `category = A` group row as the grid emits it. */
const GROUP_A: GroupVisualRow<Row> = {
	kind: 'group',
	id: 'group:category=A',
	groupId: 'group:category=A',
	field: 'category',
	key: 'A',
	keyString: 'A',
	path: [{ field: 'category', key: 'A', keyString: 'A' }],
	hierarchy: { level: 0, parentId: null, hasChildren: true, expanded: false, childCount: 2, leafCount: 2, posInSet: 1, setSize: 2 },
	aggregates: {},
	selectable: false,
};

function makeGrid() {
	return createClientGrid<Row>({
		rows: [
			{ id: '1', category: 'A' },
			{ id: '2', category: 'A' },
			{ id: '3', category: 'B' },
		],
		columns: [{ field: 'category', header: 'Category' }],
		getRowId: (row) => row.id,
		// Collapsed: none of the group's rows are rendered.
		initialState: { grouping: { by: ['category'] }, rowSelection: { mode: 'multiple' } },
	});
}

describe('DefaultGroupRowRenderer selection', () => {
	it('reflects the selection of every row in a collapsed group, not only visible rows', () => {
		const api = makeGrid();
		expect(api.isExpanded(GROUP_A.id)).toBe(false);
		render(<DefaultGroupRowRenderer visualRow={GROUP_A} api={api} />);
		const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
		expect(checkbox.checked).toBe(false);

		act(() => api.selectRows(['1']));
		expect(checkbox.checked).toBe(false);
		expect(checkbox.indeterminate).toBe(true);

		act(() => api.selectRows(['2']));
		expect(checkbox.checked).toBe(true);
		expect(checkbox.indeterminate).toBe(false);
		api.destroy();
	});

	it('selects every row of a collapsed group from its checkbox', () => {
		const api = makeGrid();
		render(<DefaultGroupRowRenderer visualRow={GROUP_A} api={api} />);
		act(() => {
			fireEvent.click(screen.getByRole('checkbox'));
		});
		expect(api.getSelectedRowIds().sort()).toEqual(['1', '2']);
		act(() => {
			fireEvent.click(screen.getByRole('checkbox'));
		});
		expect(api.getSelectedRowIds()).toEqual([]);
		api.destroy();
	});
});

describe('row renderer specs in the adapter', () => {
	it('renders the React spec a row was mounted with, over the detailRowRenderer prop', async () => {
		const { createPortalStore, PortalManager } = await import('./GridPortal.js');
		const api = makeGrid();
		const store = createPortalStore<Row>();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const Spec = ({ visualRow }: { visualRow: { id: string } }) => <span data-testid='spec'>spec for {visualRow.id}</span>;
		act(() => {
			store.mountRow('detail:1', container, { kind: 'detail', id: 'detail:1', parentId: '1', height: 40 } as never, {
				kind: 'react',
				component: Spec,
			});
		});
		render(<PortalManager store={store} api={api} detailRowRenderer={() => <span data-testid='prop'>prop</span>} />);
		expect(screen.getByTestId('spec').textContent).toBe('spec for detail:1');
		expect(screen.queryByTestId('prop')).toBeNull();
		container.remove();
		api.destroy();
	});
});
