import { describe, expect, it } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import { toDataVisualRowId } from '../rows/visualRowIds.js';
import type { GridInitialState } from '../state/GridState.js';

interface Row {
	id: string;
	region: string;
	name: string;
	parentId?: string;
}

const ROWS: Row[] = [
	{ id: '1', region: 'EMEA', name: 'Ann' },
	{ id: '2', region: 'EMEA', name: 'Bo' },
	{ id: '3', region: 'APAC', name: 'Cy' },
];

function makeGrid(initial: Partial<GridInitialState<Row>>, rows: Row[] = ROWS) {
	const store = new GridStore<Row>({
		getRowId: (row) => row.id,
		columns: [
			{ field: 'region', header: 'Region' },
			{ field: 'name', header: 'Name' },
		],
		...initial,
	});
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	const press = (key: string) => {
		let prevented = false;
		store.interactionController.handleKeyDown({
			key,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			preventDefault: () => (prevented = true),
		} as KeyboardEvent);
		return prevented;
	};
	const focusedRowId = () => store.getState().selection.focus?.rowId ?? null;
	const focusedField = () => store.getState().selection.focus?.colField ?? null;
	const destroy = () => {
		controller.dispose();
		store.destroy();
	};
	return { store, press, focusedRowId, focusedField, destroy };
}

describe('keyboard on grouped rows', () => {
	it('moves focus onto group rows and back with the arrow keys', () => {
		const grid = makeGrid({ grouping: { by: ['region'], defaultExpanded: true } });
		// Rows: 0 EMEA, 1 Ann, 2 Bo, 3 APAC, 4 Cy.
		grid.store.selectCell({ rowId: '2', colField: 'name' });
		grid.press('ArrowDown');
		expect(grid.focusedRowId()).toBe('group:region=APAC');
		grid.press('ArrowDown');
		expect(grid.focusedRowId()).toBe('3');
		grid.press('ArrowUp');
		expect(grid.focusedRowId()).toBe('group:region=APAC');
		grid.destroy();
	});

	it('opens, closes and steps in and out of groups on the hierarchy cell', () => {
		const grid = makeGrid({ grouping: { by: ['region'] } });
		grid.store.selectCell({ rowId: 'group:region=EMEA', colField: '__hierarchy__' });
		expect(grid.focusedRowId()).toBe('group:region=EMEA');

		expect(grid.press('ArrowRight')).toBe(true);
		expect(grid.store.isExpanded('group:region=EMEA')).toBe(true);
		grid.press('ArrowRight'); // open: into the first child
		expect(grid.focusedRowId()).toBe('1');
		expect(grid.focusedField()).toBe('__hierarchy__');
		grid.press('ArrowLeft'); // leaf: out to the parent
		expect(grid.focusedRowId()).toBe('group:region=EMEA');
		grid.press('ArrowLeft'); // open: closes
		expect(grid.store.isExpanded('group:region=EMEA')).toBe(false);
		grid.press('Enter'); // toggles
		expect(grid.store.isExpanded('group:region=EMEA')).toBe(true);
		grid.destroy();
	});

	it('never edits or writes a group cell', () => {
		const grid = makeGrid({ grouping: { by: ['region'] } });
		grid.store.selectCell({ rowId: 'group:region=EMEA', colField: 'name' });
		grid.press('Enter');
		grid.press('x');
		grid.press('Delete');
		expect(grid.store.getState().activeEdit ?? null).toBeNull();
		grid.press('ArrowLeft'); // off the hierarchy cell: ordinary navigation
		expect(grid.focusedField()).toBe('region');
		grid.destroy();
	});
});

describe('keyboard on tree rows', () => {
	it('opens a tree parent and steps between parent and child', () => {
		const tree: Row[] = [
			{ id: 'root', region: '', name: 'Root' },
			{ id: 'child', region: '', name: 'Child', parentId: 'root' },
		];
		const grid = makeGrid({ treeData: { getParentId: (row) => row.parentId, column: 'name' } }, tree);
		grid.store.selectCell({ rowId: 'root', colField: '__hierarchy__' });
		grid.press('ArrowRight');
		expect(grid.store.isExpanded(toDataVisualRowId('root'))).toBe(true);
		grid.press('ArrowRight');
		expect(grid.focusedRowId()).toBe('child');
		grid.press('ArrowLeft');
		expect(grid.focusedRowId()).toBe('root');
		grid.destroy();
	});
});
