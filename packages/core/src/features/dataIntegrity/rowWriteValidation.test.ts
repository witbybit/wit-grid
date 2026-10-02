import { describe, expect, it } from 'vitest';
import { GridStore } from '../../store.js';
import { ClientRowModelController } from '../../rowModel.js';
import type { GridDataIntegrityConfig } from './integrityTypes.js';

interface Row {
	id: string;
	name: string;
	score: number;
}

const ROWS: Row[] = [
	{ id: '1', name: 'Alpha', score: 1 },
	{ id: '2', name: 'Beta', score: 2 },
];

function makeGrid(validation: NonNullable<GridDataIntegrityConfig<Row>['validation']> = {}) {
	const config: GridDataIntegrityConfig<Row> = {
		validation: {
			cellRules: [{ id: 'required-name', field: 'name', validate: ({ value }) => (value ? null : { message: 'Name is required' }) }],
			rowRules: [{ id: 'score-range', validate: ({ row }) => (row.score > 100 ? { message: 'Score too high', fields: ['score'] } : null) }],
			...validation,
		},
	};
	const store = new GridStore<Row>({ getRowId: (row) => row.id, columns: [{ field: 'name' }, { field: 'score' }] }, { dataIntegrity: config });
	const controller = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), { rows: ROWS, columns: store.getState().columns });
	const errors = () => {
		const index = store.engine.getState().integrity.validation.cellErrorIndex;
		return Object.keys(index).sort();
	};
	const settle = async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	};
	return { store, errors, settle, destroy: () => (controller.dispose(), store.destroy()) };
}

describe('data integrity follows row-level writes', () => {
	it('flags bad data arriving by transaction, and clears the error when a later transaction fixes it', async () => {
		const grid = makeGrid();
		grid.store.applyTransaction({ update: [{ id: '1', name: '', score: 1 }] });
		await grid.settle();
		expect(grid.errors()).toEqual(['1:name']);
		grid.store.applyTransaction({ update: [{ id: '1', name: 'Fixed', score: 1 }] });
		await grid.settle();
		expect(grid.errors()).toEqual([]);
		grid.destroy();
	});

	it("runs row rules too, validates rows added after the initial load, and drops removed rows' issues", async () => {
		const grid = makeGrid();
		grid.store.applyTransaction({ add: [{ id: '3', name: '', score: 500 }] });
		await grid.settle();
		expect(grid.errors()).toEqual(['3:name', '3:score']);
		grid.store.applyTransaction({ remove: [{ id: '3', name: '', score: 500 }] });
		await grid.settle();
		expect(grid.errors()).toEqual([]);
		grid.destroy();
	});

	it('validates edited copies passed to setRows and async transactions', async () => {
		const grid = makeGrid();
		grid.store.setRows(ROWS.map((r) => (r.id === '2' ? { ...r, name: '' } : r)));
		await grid.settle();
		expect(grid.errors()).toEqual(['2:name']);
		grid.store.applyTransactionAsync({ update: [{ id: '1', name: '', score: 1 }] });
		grid.store.flushAsyncTransactions();
		await grid.settle();
		expect(grid.errors()).toEqual(['1:name', '2:name']);
		grid.destroy();
	});

	it("validateOnTransaction: false skips validation but still drops removed rows' issues", async () => {
		const grid = makeGrid({ validateOnTransaction: false });
		await grid.store.integrity.validateCell('1', 'name');
		grid.store.applyTransaction({ update: [{ id: '1', name: '', score: 1 }] });
		await grid.settle();
		expect(grid.errors()).toEqual([]);
		await grid.store.integrity.validateCell('1', 'name');
		expect(grid.errors()).toEqual(['1:name']);
		grid.store.applyTransaction({ remove: [{ id: '1', name: '', score: 1 }] });
		await grid.settle();
		expect(grid.errors()).toEqual([]);
		grid.destroy();
	});
});
