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
