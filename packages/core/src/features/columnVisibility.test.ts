import { describe, expect, it } from 'vitest';
import { createClientGrid } from '../createGrid.js';

interface Row {
	id: string;
	a: string;
	b: string;
	c: string;
	d: string;
}

function grid(pins = { left: 2, right: 1 }) {
	return createClientGrid<Row>({
		rows: [
			{ id: '1', a: 'Ava', b: 'x', c: '1', d: 'p' },
			{ id: '2', a: 'Liam', b: 'y', c: '2', d: 'q' },
		],
		columns: ['a', 'b', 'c', 'd'].map((field) => ({ field })),
		initialState: { pinnedColumns: pins },
	});
}

const shown = (api: ReturnType<typeof grid>) => api.getDisplayedColumns().map((c) => c.field);

describe('hiding columns', () => {
	it('keeps a hidden column’s filter, still filtering; showing it again changes nothing', () => {
		const api = grid({ left: 0, right: 0 });
		api.setFilterModel({ a: { type: 'text', operator: 'equals', value: 'Ava' } });
		api.setColumnVisible('a', false);
		expect(api.getStateSnapshot().filterModel).toEqual({ a: { type: 'text', operator: 'equals', value: 'Ava' } });
		expect(
			api
				.rows()
				.getAll()
				.map((r) => r.id)
		).toEqual(['1']);
		api.setColumnVisible('a', true);
		expect(
			api
				.rows()
				.getAll()
				.map((r) => r.id)
		).toEqual(['1']);
		api.destroy();
	});

	it('hiding a pinned column does not pin its neighbour; showing it pins it again', () => {
		const api = grid();
		expect(api.getPinnedColumns()).toEqual({ left: 2, right: 1 });
		api.setColumnVisible('a', false);
		expect(shown(api)).toEqual(['b', 'c', 'd']);
		expect(api.getPinnedColumns()).toEqual({ left: 1, right: 1 }); // b alone on the left, c still scrolls
		api.setColumnVisible('d', false);
		expect(api.getPinnedColumns()).toEqual({ left: 1, right: 0 });
		api.setColumnsVisible(['a', 'd'], true);
		expect(api.getPinnedColumns()).toEqual({ left: 2, right: 1 });
		api.destroy();
	});

	it('hiding a scrolling column leaves the pins alone', () => {
		const api = grid();
		api.setColumnVisible('c', false);
		expect(api.getPinnedColumns()).toEqual({ left: 2, right: 1 });
		api.destroy();
	});
});
