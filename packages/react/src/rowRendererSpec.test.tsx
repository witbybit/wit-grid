import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createClientGrid } from '@eregister/wit-grid-core';

interface Row {
	id: string;
	category: string;
}

afterEach(cleanup);

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
