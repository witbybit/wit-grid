import { describe, expect, it } from 'vitest';
import { createClientGrid } from './createGrid.js';

interface Row {
	id: string;
	name: string;
}

describe('remote-origin transactions', () => {
	const grid = () =>
		createClientGrid<Row>({
			rows: [
				{ id: '1', name: 'a' },
				{ id: '2', name: 'b' },
			],
			columns: [{ field: 'name', header: 'Name' }],
			getRowId: (row) => row.id,
		});

	it('apply a collaborator’s edit without putting it on this user’s undo stack', () => {
		const api = grid();
		const result = api.transaction({ cells: [{ rowId: '1', colField: 'name', value: 'remote' }], origin: 'remote' });
		expect(result.status).toBe('applied');
		expect(api.getCellValue('1', 'name')).toBe('remote');
		expect(api.canUndo()).toBe(false);
		api.destroy();
	});

	it('leave local edits undoable across interleaved remote edits', () => {
		const api = grid();
		api.transaction({ cells: [{ rowId: '1', colField: 'name', value: 'mine' }] });
		api.transaction({ cells: [{ rowId: '2', colField: 'name', value: 'theirs' }], origin: 'remote' });
		api.undo();
		expect(api.getCellValue('1', 'name')).toBe('a');
		expect(api.getCellValue('2', 'name')).toBe('theirs');
		api.destroy();
	});
});
