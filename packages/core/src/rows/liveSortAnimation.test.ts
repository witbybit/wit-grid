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
