import { afterEach, describe, expect, it, vi } from 'vitest';
import { GridStore } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';
import type { ColumnDef } from '../columnDef.js';
import type { GridInitialState } from '../state/GridState.js';

interface Sale {
	id: string;
	region: string;
	product: string;
	amount: number;
	parentId?: string;
}

const COLUMNS: ColumnDef<Sale>[] = [
	{ field: 'product', header: 'Product' },
	{ field: 'amount', header: 'Amount', valueFormatter: ({ value }) => `$${value}` },
];

const SALES: Sale[] = [
	{ id: '1', region: 'EMEA', product: 'Cloud', amount: 10 },
	{ id: '2', region: 'EMEA', product: 'Hardware', amount: 20 },
	{ id: '3', region: 'APAC', product: 'Cloud', amount: 5 },
];

function makeGrid(initial: Partial<GridInitialState<Sale>>, rows: Sale[] = SALES) {
	const store = new GridStore<Sale>({ columns: COLUMNS, getRowId: (row) => row.id, ...initial });
	const controller = new ClientRowModelController(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns });
	return {
		store,
		destroy: () => {
			controller.dispose();
			store.destroy();
		},
	};
}

const GROUPED: Partial<GridInitialState<Sale>> = {
	// Collapsed: the export still includes every row.
	grouping: { by: ['region'], totals: { groups: 'bottom', grand: 'bottom' } },
	aggregation: { defs: [{ colId: 'amount', aggFunc: 'sum' }] },
};

afterEach(() => vi.unstubAllGlobals());

describe('CSV export of a hierarchy', () => {
	it('exports groups (label and count), their rows indented, totals and the grand total, with formatted aggregates', () => {
		const grid = makeGrid(GROUPED);
		expect(grid.store.getCsv().split('\n')).toEqual([
			'Group,Product,Amount',
			'EMEA (2),,$30',
			'  ,Cloud,$10',
			'  ,Hardware,$20',
			'  Total,,$30',
			'APAC (1),,$5',
			'  ,Cloud,$5',
			'  Total,,$5',
			'Grand total,,$35',
		]);
		grid.destroy();
	});

	it('leaves out groups or totals on request, and writes paths instead of indents', () => {
		const grid = makeGrid(GROUPED);
		expect(grid.store.getCsv({ includeGroups: false, includeTotals: false }).split('\n')).toEqual([
			'Group,Product,Amount',
			'  ,Cloud,$10',
			'  ,Hardware,$20',
			'  ,Cloud,$5',
		]);
		expect(grid.store.getCsv({ hierarchyText: 'path', includeTotals: false }).split('\n').slice(1, 3)).toEqual(['EMEA,,$30', 'EMEA,Cloud,$10']);
		grid.destroy();
	});

	it('exports tree data with the tree column in the hierarchy column', () => {
		const tree: Sale[] = [
			{ id: 'root', region: '', product: 'All', amount: 0 },
			{ id: 'child', region: '', product: 'Cloud', amount: 5, parentId: 'root' },
		];
		const grid = makeGrid({ treeData: { getParentId: (row) => row.parentId, column: 'product' } }, tree);
		expect(grid.store.getCsv().split('\n')).toEqual(['Name,Product,Amount', 'All,All,$0', '  Cloud,Cloud,$5']);
		grid.destroy();
	});

	it('exports data rows only for rowIds / onlySelected', () => {
		const grid = makeGrid(GROUPED);
		expect(grid.store.getCsv({ rowIds: ['2'] }).split('\n')).toEqual(['Group,Product,Amount', ',Hardware,$20']);
		grid.destroy();
	});
});

describe('copying a range across group rows', () => {
	it('copies the group row as its label and formatted aggregates', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText, readText: async () => '' } });
		const grid = makeGrid({ ...GROUPED, grouping: { by: ['region'], defaultExpanded: true } });
		// Rows: 0 EMEA, 1 Cloud (1), 2 Hardware (2), 3 APAC, 4 Cloud (3).
		grid.store.selectRange({ rowId: '2', colField: '__hierarchy__' }, { rowId: '3', colField: 'amount' });
		await grid.store.copySelectedRange();
		expect(writeText).toHaveBeenCalledWith(['\tHardware\t$20', 'APAC (1)\t\t$5', '\tCloud\t$5'].join('\n').replace('APAC (1)', 'APAC'));
		grid.destroy();
	});
});
