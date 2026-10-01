// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RowCtrlStore } from './RowCtrlStore.js';
import { getOrCreateCellCtrl } from './RowCtrl.js';
import { isControllerWorkStillValid, type ControllerWorkToken } from './CellCtrl.js';
import { ClientRowModelController } from '../../rowModel.js';
import { GridStore, type ColumnDef } from '../../store.js';
import { RenderEngine } from '../renderEngine.js';
import { CellSlot } from '../cellSlot.js';

const COL = 'coli1' as never;

function attached(store: RowCtrlStore, rowId: string, slot = 'ci-1') {
	const rowCtrl = store.getOrCreate(rowId);
	const { cellCtrl } = getOrCreateCellCtrl(rowCtrl, store.cellCtrls, COL, { colField: 'name' });
	cellCtrl.lifecycle.attachedSlotInstanceId = slot;
	return cellCtrl;
}

describe('rekeyDetachedCellCtrl', () => {
	it('moves a slot controller to the new row: indexes follow, old row is dropped, old tokens die', () => {
		const store = new RowCtrlStore();
		const cellCtrl = attached(store, 'r1');
		cellCtrl.visualState.className = 'og-cell stale-class';
		const token: ControllerWorkToken = {
			epoch: 1,
			cellControllerKey: cellCtrl.key,
			rowId: cellCtrl.rowId,
			columnInstanceId: cellCtrl.columnInstanceId,
			freshness: cellCtrl.presentationState.freshness,
		};
		expect(isControllerWorkStillValid({ token, cellCtrl })).toBe(true);
		store.getOrCreate('r2');

		expect(store.rekeyDetachedCellCtrl(cellCtrl, 'ci-1', { rowId: 'r2', columnInstanceId: COL, colField: 'name' })).toBe(true);
		expect(cellCtrl.rowId).toBe('r2');
		expect(store.cellCtrls.getByRowAndColumn('r2', COL)).toBe(cellCtrl);
		expect(store.cellCtrls.getByRowAndColumn('r1', COL)).toBeUndefined();
		expect(store.get('r1')).toBeUndefined(); // no controllers left for it
		expect(cellCtrl.visualState.className).toBe(''); // fresh state, nothing of r1
		expect(isControllerWorkStillValid({ token, cellCtrl })).toBe(false);
		expect(store.stats.cellCtrlsRekeyed).toBe(1);
	});

	it('refuses exactly where a release would be refused, or when the new row already has one', () => {
		const store = new RowCtrlStore();
		const focused = attached(store, 'r1');
		focused.visualState.focused = true;
		expect(store.rekeyDetachedCellCtrl(focused, 'ci-1', { rowId: 'r9', columnInstanceId: COL, colField: 'name' })).toBe(false);

		const otherSlot = attached(store, 'r2', 'ci-2');
		expect(store.rekeyDetachedCellCtrl(otherSlot, 'ci-1', { rowId: 'r9', columnInstanceId: COL, colField: 'name' })).toBe(false);

		const plain = attached(store, 'r3');
		attached(store, 'r4', 'ci-4');
		expect(store.rekeyDetachedCellCtrl(plain, 'ci-1', { rowId: 'r4', columnInstanceId: COL, colField: 'name' })).toBe(false);
		expect(plain.rowId).toBe('r3');
		expect(store.stats.cellCtrlsRekeyed).toBe(0);
	});
});

describe('scrolling recycles controllers with the slots', () => {
	it('re-keys instead of churning, and every slot presents its own row', () => {
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			cb(0);
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		const columns: ColumnDef<{ id: string; name: string }>[] = [{ field: 'name', header: 'Name', width: 150 }];
		const store = new GridStore<{ id: string; name: string }>({ columns, defaultRowHeight: 40, defaultColWidth: 150, getRowId: (row) => row.id });
		const controller = new ClientRowModelController(store.getClientRowModelRuntime(), {
			rows: Array.from({ length: 2000 }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` })),
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
		const viewport = container.querySelector('.og-scroll-viewport') as HTMLDivElement;
		for (const top of [4000, 8000, 12000, 400]) {
			viewport.scrollTop = top;
			viewport.dispatchEvent(new Event('scroll'));
		}
		const rowCtrls = store.engine.rowCtrls;
		expect(rowCtrls.stats.cellCtrlsRekeyed).toBeGreaterThan(0);
		const cells = [...container.querySelectorAll<HTMLDivElement>('.og-rows-container .og-cell')];
		expect(cells.length).toBeGreaterThan(0);
		for (const el of cells) {
			const slot = CellSlot.fromElement(el);
			if (!slot.boundCellCtrl || slot.rowId === undefined || slot.rowId === '') continue;
			expect(slot.boundCellCtrl.rowId).toBe(slot.rowId);
			expect(rowCtrls.cellCtrls.getByRowAndColumn(slot.rowId, slot.boundCellCtrl.columnInstanceId)).toBe(slot.boundCellCtrl);
		}
		// Bounded by the slot pool, not by every row visited.
		expect(rowCtrls.cellCtrls.size()).toBeLessThan(200);
		renderer.unmount();
		controller.dispose();
		store.destroy();
		vi.unstubAllGlobals();
	});
});
