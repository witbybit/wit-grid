// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ClientRowModelController } from '../../rowModel.js';
import { GridStore, type ColumnDef } from '../../store.js';
import { RenderEngine } from '../renderEngine.js';

interface Row {
	id: string;
	name: string;
}

describe('CellCtrl freshness - full bind resolves controller state before binding', () => {
	it('after a full bind, CellCtrl carries authoritative freshness and presentation state for the physical slot showing that row', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});

		const columns: ColumnDef<Row>[] = [{ field: 'name', header: 'Name', width: 150 }];
		const store = new GridStore<Row>({ columns, defaultRowHeight: 40, defaultColWidth: 150, getRowId: (r) => r.id });
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` })),
			columns: store.getState().columns,
		});
		const container = document.createElement('div');
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 300,
			bottom: 400,
			width: 300,
			height: 400,
			toJSON: () => ({}),
		} as DOMRect);
		document.body.appendChild(container);

		const renderer = new RenderEngine(store.engine, store);
		renderer.mount(container);

		const rowCtrl = store.engine.rowCtrls.get('row-0');
		expect(rowCtrl).toBeDefined();
		const column = store.engine.columns.getPrimaryColumnByField('name');
		expect(column).toBeDefined();
		const cellCtrl = store.engine.rowCtrls.cellCtrls.getByRowAndColumn('row-0', column!.instanceId);
		expect(cellCtrl).toBeDefined();
		expect(cellCtrl!.freshness).not.toBeUndefined();
		expect(cellCtrl!.presentationState.kind).toBe('primitive');
		expect(cellCtrl!.lifecycle.attachedSlotInstanceId).toBeDefined();

		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});
});
