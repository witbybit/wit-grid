// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ClientRowModelController } from '../../rowModel.js';
import { GridStore, type ColumnDef } from '../../store.js';

interface Row {
	id: string;
	name: string;
}

describe('RowCtrlStore — row-removal hook wired into GridEngine', () => {
	it('a row removed via transaction is swept from RowCtrlStore, not leaked forever', () => {
		const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
		const store = new GridStore<Row>({ columns, getRowId: (r) => r.id });
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [
				{ id: 'r1', name: 'A' },
				{ id: 'r2', name: 'B' },
			],
			columns: store.getState().columns,
		});

		// Simulate a controller having attached RowCtrl/CellCtrl identity for r1 (as bindCellFull/
		// bindCellDuringScroll would during a real render pass).
		const rowCtrl = store.engine.rowCtrls.getOrCreate('r1');
		const cellCtrl = store.engine.rowCtrls.cellCtrls.getOrCreate({
			rowId: 'r1',
			columnInstanceId: 'x' as any,
			colField: 'name',
		}).cellCtrl;
		rowCtrl.cellKeysByColumnInstanceId.set('x' as any, cellCtrl.key);
		expect(store.engine.rowCtrls.get('r1')).toBeDefined();

		store.transaction({ rows: { remove: [{ id: 'r1', name: 'A' }] } });

		expect(store.engine.rowCtrls.get('r1')).toBeUndefined();
		// r2 was never removed — its slot (if any) is untouched by the sweep.
		expect(store.engine.rowCtrls.get('r2')).toBeUndefined(); // never attached in this test, just confirms no crash

		controller.dispose();
		store.destroy();
	});

	it('adding/updating rows (no removal) does not touch RowCtrlStore', () => {
		const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name' }];
		const store = new GridStore<Row>({ columns, getRowId: (r) => r.id });
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: [{ id: 'r1', name: 'A' }],
			columns: store.getState().columns,
		});

		const rowCtrl = store.engine.rowCtrls.getOrCreate('r1');
		store.transaction({ rows: { add: [{ id: 'r2', name: 'B' }] } });
		store.transaction({ rows: { update: [{ id: 'r1', name: 'A-updated' }] } });

		expect(store.engine.rowCtrls.get('r1')).toBe(rowCtrl);

		controller.dispose();
		store.destroy();
	});
});
