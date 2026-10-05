import { describe, expect, it } from 'vitest';
import { GridEventName } from '../api/GridEvents.js';
import { ClientRowModelController } from '../rowModel.js';
import { GridStore } from '../store.js';

type Row = { id: string; name: string };

describe('re-applying the current sort or filter model', () => {
	it('is a no-op: no event and no pipeline run (apps sync these from effects)', () => {
		const rows: Row[] = [
			{ id: '1', name: 'b' },
			{ id: '2', name: 'a' },
		];
		const store = new GridStore<Row>({ columns: [{ field: 'name' }] as never, getRowId: (r) => r.id });
		const model = new ClientRowModelController<Row>(store.getClientRowModelRuntime(), { rows, columns: store.getState().columns, getRowId: (r) => r.id });
		let runs = 0;
		const refresh = model.refresh.bind(model);
		model.refresh = (...args) => (runs++, refresh(...args));
		const events: string[] = [];
		store.engine.eventBus.addEventListener(GridEventName.filterChanged, () => events.push('filter'));
		store.engine.eventBus.addEventListener(GridEventName.sortChanged, () => events.push('sort'));

		store.setFilterModel(null);
		store.setFilterModel({} as never);
		store.setSortModel(null);
		store.setSortModel([]);
		expect(runs).toBe(0);
		expect(events).toEqual([]);

		store.setSortModel([{ colId: 'name', sort: 'asc' }] as never);
		store.setSortModel([{ colId: 'name', sort: 'asc' }] as never);
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'a' } } as never);
		store.setFilterModel({ name: { type: 'text', operator: 'contains', value: 'a' } } as never);
		expect(events).toEqual(['sort', 'filter']);
		expect(runs).toBe(2);
		store.destroy();
	});
});
