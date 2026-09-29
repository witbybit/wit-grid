import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientGrid } from '../createGrid.js';
import { GridEventName } from '../api/GridEvents.js';

type Row = { id: string; price: number };

function makeGrid(rowCount = 50) {
	return createClientGrid<Row>({
		columns: [
			{ field: 'id', header: 'ID' },
			{ field: 'price', header: 'Price' },
		],
		rows: Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}`, price: i })),
		getRowId: (row) => row.id,
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe('applyTransactionAsync', () => {
	it('applies nothing until the flush, then applies a burst of updates as one commit', () => {
		vi.useFakeTimers();
		const api = makeGrid();
		const rowsUpdated = vi.fn();
		api.addEventListener(GridEventName.rowsUpdated, rowsUpdated);
		for (let i = 0; i < 20; i++) api.applyTransactionAsync({ update: [{ id: `r${i}`, price: 1000 + i }] });
		expect(api.getCellValue('r0', 'price')).toBe(0);
		expect(rowsUpdated).not.toHaveBeenCalled();

		vi.runOnlyPendingTimers(); // no rAF in this environment: the scheduler falls back to a timeout
		expect(api.getCellValue('r0', 'price')).toBe(1000);
		expect(api.getCellValue('r19', 'price')).toBe(1019);
		expect(rowsUpdated).toHaveBeenCalledTimes(1);
		api.destroy();
	});

	it('keeps call order: a synchronous write applies the queue first', () => {
		const api = makeGrid();
		api.applyTransactionAsync({ update: [{ id: 'r1', price: 111 }] });
		// A later synchronous write to the same cell must win, as if both were synchronous.
		api.applyTransaction({ update: [{ id: 'r1', price: 222 }] });
		expect(api.getCellValue('r1', 'price')).toBe(222);

		api.applyTransactionAsync({ update: [{ id: 'r2', price: 5 }] });
		api.setCellValue('r2', 'price', 6);
		expect(api.getCellValue('r2', 'price')).toBe(6);
		api.destroy();
	});

	it("calls back with each transaction's own result", () => {
		const api = makeGrid();
		const first = vi.fn();
		const second = vi.fn();
		api.applyTransactionAsync({ update: [{ id: 'r3', price: 1 }] }, first);
		api.applyTransactionAsync({ add: [{ id: 'new', price: 2 }] }, second);
		api.flushAsyncTransactions();
		expect(first.mock.calls[0][0].update.map((n: { id: string }) => n.id)).toEqual(['r3']);
		expect(second.mock.calls[0][0].add.map((n: { id: string }) => n.id)).toEqual(['new']);
		expect(api.getCellValue('new', 'price')).toBe(2);
		api.destroy();
	});

	it('honours asyncTransactionWaitMs', () => {
		vi.useFakeTimers();
		const api = createClientGrid<Row>({
			columns: [{ field: 'price', header: 'Price' }],
			rows: [{ id: 'a', price: 1 }],
			getRowId: (row) => row.id,
			initialState: { asyncTransactionWaitMs: 50 },
		});
		api.applyTransactionAsync({ update: [{ id: 'a', price: 2 }] });
		vi.advanceTimersByTime(49);
		expect(api.getCellValue('a', 'price')).toBe(1);
		vi.advanceTimersByTime(1);
		expect(api.getCellValue('a', 'price')).toBe(2);
		api.destroy();
	});

	it('drops pending transactions when the grid is destroyed', () => {
		vi.useFakeTimers();
		const api = makeGrid();
		const callback = vi.fn();
		api.applyTransactionAsync({ update: [{ id: 'r0', price: 9 }] }, callback);
		api.destroy();
		vi.runAllTimers();
		expect(callback).not.toHaveBeenCalled();
	});
});
