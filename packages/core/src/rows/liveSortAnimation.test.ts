import { describe, expect, it } from 'vitest';
import { GridStore, GridEventName } from '../store.js';
import { ClientRowModelController } from '../rowModel.js';

type Row = { id: string; price: number };

function makeSortedGrid() {
	const rows: Row[] = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, price: i * 10 }));
	const store = new GridStore<Row>({
		columns: [
			{ field: 'id', header: 'Id' },
			{ field: 'price', header: 'Price' },
		],
		getRowId: (r) => r.id,
	});
	new ClientRowModelController<Row>(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns, getRowId: (r) => r.id });
	store.setSortModel([{ colId: 'price', sort: 'desc' } as never]);
	store.engine.invalidation.consume();
	return store;
}

describe('rows moving under the current sort animate', () => {
	it('a row update that changes the sort key (every row, as a live feed does) takes the animated sort path', () => {
		const store = makeSortedGrid();
		const captures: string[] = [];
		store.engine.eventBus.addEventListener(GridEventName.layoutTransitionCaptureRequested, (event: { payload: { reason: string } }) =>
			captures.push(event.payload.reason)
		);
		const update = (store.rows().getAll() as Row[]).map((row, i) => ({ ...row, price: (i * 37) % 100 }));
		store.transaction({ rows: { update } });
		const frame = store.engine.invalidation.consume();
		expect(captures).toContain('live-reorder');
		expect(frame.reasons).toContain('sort');
		expect(frame.full).toBe(false);
		store.destroy();
	});
});

describe('a live reorder of many rows', () => {
	it('matches a full sort (small and large batches, repeated rows), ties in source order, and every row resolves to its index', () => {
		const rows: Row[] = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, price: i % 50 }));
		const store = new GridStore<Row>({
			columns: [
				{ field: 'id', header: 'Id' },
				{ field: 'price', header: 'Price' },
			],
			getRowId: (r) => r.id,
		});
		const model = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), {
			rows,
			columns: store.getState().columns,
			getRowId: (r) => r.id,
		});
		store.setSortModel([{ colId: 'price', sort: 'desc' } as never]);
		let seed = 7;
		const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		for (let round = 0; round < 5; round++) {
			const current = store.rows().getAll() as Row[];
			const update: Row[] = [];
			// Odd rounds take the per-row splice path; each batch updates one row twice (the last write wins).
			for (let k = 0; k < (round % 2 ? 10 : 120); k++)
				update.push({ ...current[Math.floor(random() * current.length)], price: Math.floor(random() * 50) });
			update.push({ ...update[0], price: (update[0].price + 7) % 50 });
			store.transaction({ rows: { update } });
			const all = store.rows().getAll() as Row[];
			const expected = all
				.map((row, source) => ({ id: row.id, price: row.price, source }))
				.sort((a, b) => b.price - a.price || a.source - b.source)
				.map((row) => row.id);
			const actual = Array.from({ length: model.getVisualRowCount() }, (_, i) => (model.getVisualRow(i) as { rowId: string }).rowId);
			expect(actual).toEqual(expected);
			const bad = expected.flatMap((id, i) =>
				model.getVisualIndexByRowId(id) === i ? [] : [`${round}:${id}@${i}->${model.getVisualIndexByRowId(id)}`]
			);
			expect(bad).toEqual([]);
		}
		store.destroy();
	});
});
